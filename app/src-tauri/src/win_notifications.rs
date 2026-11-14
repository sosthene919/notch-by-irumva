//! Windows app-notification mirroring (WhatsApp, Chrome, Mail, …).
//!
//! WinRT's UserNotificationListener needs MSIX package identity, which
//! this unpackaged build does not have. Instead we watch the local
//! notification-center database (%LOCALAPPDATA%\Microsoft\Windows\
//! Notifications\wpndatabase.db) — the same store the Action Center
//! itself renders. Everything is read locally on this PC: no network,
//! no server, no external API. The DB is copied to a temp snapshot each
//! poll because the live file is WAL-locked by the shell.
//!
//! Only genuinely new `toast` rows are emitted (seeded at startup, so
//! history never floods the island). Payloads are plain text extracted
//! from the toast XML; the frontend re-validates and marks them
//! sensitive (lock-screen redaction applies).

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowsNotification {
    pub id: i64,
    pub app: String,
    pub title: String,
    pub body: String,
    pub arrival_ms: i64,
}

fn db_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("NOTCH_WPNDB_PATH") {
        if !p.trim().is_empty() { return Some(PathBuf::from(p)); }
    }
    let local = std::env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(local).join(r"Microsoft\Windows\Notifications\wpndatabase.db"))
}

fn snapshot(src: &std::path::Path, slot: u8) -> Option<PathBuf> {
    let dir = std::env::temp_dir().join(format!("notch-wpn-{}", std::process::id()));
    std::fs::create_dir_all(&dir).ok()?;
    // Rotate between two snapshot files: if a previous copy is still held
    // open (SQLite handle, AV scan), the next poll writes the other slot
    // instead of stalling on a locked destination.
    let dst = dir.join(format!("wpndatabase-{slot}.db"));
    std::fs::copy(src, &dst).ok()?;
    for suffix in ["-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", src.display()));
        let to = PathBuf::from(format!("{}{suffix}", dst.display()));
        if from.exists() { let _ = std::fs::copy(&from, &to); }
    }
    Some(dst)
}

/// Extract readable text lines from a toast payload (subset of the Toast
/// XML schema: every <text> element, in order). Pure string work — the
/// payload is treated as inert data, never rendered.
pub fn extract_texts(payload: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = payload;
    while let Some(start) = rest.find("<text") {
        let Some(gt) = rest[start..].find('>') else { break };
        let content_start = start + gt + 1;
        let Some(end) = rest[content_start..].find("</text>") else { break };
        let raw = &rest[content_start..content_start + end];
        let text = unescape_xml(raw.trim());
        if !text.is_empty() { out.push(text); }
        rest = &rest[content_start + end..];
        if out.len() >= 6 { break; }
    }
    out
}

pub fn unescape_xml(s: &str) -> String {
    let cdata = s.strip_prefix("<![CDATA[").and_then(|x| x.strip_suffix("]]>")).unwrap_or(s);
    let mut out = String::with_capacity(cdata.len());
    let mut chars = cdata.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '&' { out.push(c); continue; }
        let ent: String = chars.by_ref().take_while(|&x| x != ';').collect();
        match ent.as_str() {
            "lt" => out.push('<'),
            "gt" => out.push('>'),
            "quot" => out.push('"'),
            "apos" => out.push('\''),
            "amp" => out.push('&'),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => {
                if let Some(ch) = i64::from_str_radix(&ent[2..], 16).ok().and_then(|n| char::from_u32(n as u32)) { out.push(ch); }
            }
            _ if ent.starts_with('#') => {
                if let Some(ch) = ent[1..].parse::<u32>().ok().and_then(char::from_u32) { out.push(ch); }
            }
            _ => { out.push('&'); out.push_str(&ent); out.push(';'); }
        }
    }
    out
}

/// Friendly app label from a handler PrimaryId, e.g.
/// "Microsoft.ScreenSketch_8wekyb3d8bbwe!App" -> "ScreenSketch".
pub fn display_app(primary_id: &str) -> String {
    if primary_id.starts_with("Chrome") { return "Chrome".into(); }
    if primary_id.starts_with("MSEdge") { return "Edge".into(); }
    let base = primary_id.split('!').next().unwrap_or(primary_id);
    // Drop the "_<publisher hash>" package suffix when present.
    let base = match base.rfind('_') {
        Some(i) if base.len() - i <= 16 && i > 0 => &base[..i],
        _ => base,
    };
    let name = base.rsplit('.').next().unwrap_or(base);
    if name.is_empty() { base.to_string() } else { name.to_string() }
}

fn looks_like_domain(s: &str) -> bool {
    !s.contains(' ') && s.contains('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '/'))
}

/// Build a notification from one DB row, or None if it has no readable
/// text or is already expired.
pub fn build_notification(id: i64, primary_id: &str, payload: &[u8], arrival_filetime: i64, expiry_filetime: i64, now_filetime: i64) -> Option<WindowsNotification> {
    if expiry_filetime > 0 && expiry_filetime < now_filetime { return None; }
    if primary_id.ends_with("!PackageMetadata") { return None; }
    let xml = String::from_utf8_lossy(payload);
    let texts = extract_texts(&xml);
    let title = texts.first()?.clone();
    let mut body_parts: Vec<String> = texts.into_iter().skip(1).collect();
    if body_parts.len() > 1 && looks_like_domain(body_parts.last().unwrap()) { body_parts.pop(); } // e.g. trailing "web.whatsapp.com"
    Some(WindowsNotification {
        id,
        app: display_app(primary_id),
        title,
        body: body_parts.join(" "),
        arrival_ms: (arrival_filetime / 10_000) - 11_644_473_600_000,
    })
}

/// Notifications are tracked by (Id, ArrivalTime), NOT by [Order]:
/// Windows prunes the table and recycles [Order] values, and apps update
/// their existing notification in place (same [Order], new Id). An
/// [Order]-based cursor silently misses both cases (verified live).
fn poll_once(app: &AppHandle, seen: &mut Option<std::collections::HashSet<String>>, slot: &mut u8) {
    let Some(src) = db_path() else { return };
    *slot = (*slot + 1) % 2;
    let Some(snap) = snapshot(&src, *slot) else { return };
    let Ok(conn) = rusqlite::Connection::open_with_flags(&snap, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return };
    let mut stmt = match conn.prepare(
        "SELECT n.Id, h.PrimaryId, n.Payload, n.ArrivalTime, n.ExpiryTime \
         FROM Notification n LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId \
         WHERE n.Type = 'toast' ORDER BY n.ArrivalTime DESC LIMIT 50",
    ) { Ok(s) => s, Err(_) => return };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default(),
            row.get::<_, i64>(3).unwrap_or(0),
            row.get::<_, i64>(4).unwrap_or(0),
        ))
    });
    let Ok(rows) = rows else { return };
    let now_ft = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_millis() as i64 + 11_644_473_600_000) * 10_000)
        .unwrap_or(0);
    let mut current_keys: Vec<String> = Vec::new();
    let mut fresh: Vec<WindowsNotification> = Vec::new();
    for row in rows.flatten() {
        let (id, primary, payload, arrival, expiry) = row;
        let key = format!("{id}:{arrival}");
        current_keys.push(key.clone());
        if seen.as_ref().is_some_and(|s| s.contains(&key)) { continue; }
        if seen.is_none() { continue; } // first successful poll only seeds
        if let Some(n) = build_notification(id, &primary, &payload, arrival, expiry, now_ft) {
            fresh.push(n);
        }
    }
    match seen {
        None => { *seen = Some(current_keys.into_iter().collect()); }
        Some(set) => {
            // Bound memory: when full, forget history but immediately
            // re-seed with the current snapshot so nothing re-pops.
            if set.len() > 5000 { set.clear(); }
            for k in current_keys { set.insert(k); }
        }
    }
    fresh.reverse(); // emit oldest first (query was newest-first)
    for n in fresh {
        let _ = app.emit("notch://windows-notification", n);
    }
}

pub fn start_windows_notification_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut seen: Option<std::collections::HashSet<String>> = None;
        let mut slot: u8 = 0;
        loop {
            poll_once(&app, &mut seen, &mut slot);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_toast_texts_and_unescapes() {
        let xml = r#"<toast><visual><binding template="ToastGeneric"><text>WhatsApp</text><text hint-maxLines="2">Tom &amp; Jerry: 5 &lt; 6</text><text>web.whatsapp.com</text></binding></visual></toast>"#;
        assert_eq!(extract_texts(xml), vec!["WhatsApp", "Tom & Jerry: 5 < 6", "web.whatsapp.com"]);
    }

    #[test]
    fn builds_notification_and_drops_trailing_domain() {
        let xml = b"<toast><visual><binding><text>Alice</text><text>See you at 3</text><text>web.whatsapp.com</text></binding></visual></toast>";
        let n = build_notification(7, "Chrome._crx_abc", xml, 133_500_000_000_000_000, 0, 133_500_000_000_000_000).unwrap();
        assert_eq!(n.app, "Chrome");
        assert_eq!(n.title, "Alice");
        assert_eq!(n.body, "See you at 3");
        assert!(n.arrival_ms > 1_700_000_000_000);
    }

    #[test]
    fn expired_and_textless_rows_are_skipped() {
        let xml = b"<toast><visual><binding><text>Hi</text></binding></visual></toast>";
        assert!(build_notification(1, "Chrome", xml, 100, 50, 100).is_none());
        assert!(build_notification(1, "Chrome", b"<toast/>", 100, 0, 100).is_none());
    }

    #[test]
    fn prettifies_app_ids() {
        assert_eq!(display_app("Microsoft.ScreenSketch_8wekyb3d8bbwe!App"), "ScreenSketch");
        assert_eq!(display_app("MailbirdForWindows"), "MailbirdForWindows");
        assert_eq!(display_app("Chrome._crx_hnpfjngllnfapefoaidbinmjnm"), "Chrome");
    }
}

//! Synced lyrics via LRCLib (https://lrclib.net/api), a community
//! lyrics database. No API key or account.
//!
//! Lookup order (per LRCLib guidance): the exact-match endpoint first
//! (track, artist, album, duration), then search, picking the result
//! whose duration is closest to the playing track. Synced (LRC) lyrics
//! are preferred, plain lyrics are the fallback, and LRCLib's
//! `instrumental` flag is its own designed state. Any result more than
//! a few seconds off the playing duration is ignored; releases of the
//! same song legitimately differ by a few seconds, so the tolerance
//! is 5 s, not zero.
//!
//! Privacy: only track title, artist, album and duration ever leave
//! the PC (disclosed in Settings, switchable there). Requests carry a
//! descriptive User-Agent, a 5 s timeout, and are rate-limited and
//! serialized here so track-skip bursts cannot fan out. Results are
//! cached by the frontend in local files (lyrics_cache_*).

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
const TOLERANCE_SEC: f64 = 5.0;
const MIN_GAP_MS: u64 = 500;

#[derive(Deserialize, Clone, PartialEq, Debug)]
pub struct LrcTrack {
    duration: Option<f64>,
    instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LyricsLookup {
    status: String,
    synced_lyrics: Option<String>,
    plain_lyrics: Option<String>,
}

fn has_synced(t: &LrcTrack) -> bool {
    t.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
}
fn has_plain(t: &LrcTrack) -> bool {
    t.plain_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
}

pub fn duration_ok(t: &LrcTrack, playing_duration: f64) -> bool {
    if playing_duration <= 0.0 { return true; }
    t.duration.map(|d| (d - playing_duration).abs() <= TOLERANCE_SEC).unwrap_or(true)
}

/// Pick from search results: synced first, then closest duration.
/// Instrumental entries are eligible (they resolve to the
/// instrumental state); entries with nothing usable are not.
pub fn choose<'a>(results: &'a [LrcTrack], playing_duration: f64) -> Option<&'a LrcTrack> {
    let mut candidates: Vec<&LrcTrack> = results.iter()
        .filter(|t| duration_ok(t, playing_duration)
            && (has_synced(t) || has_plain(t) || t.instrumental == Some(true)))
        .collect();
    candidates.sort_by(|a, b| {
        let diff = |t: &LrcTrack| t.duration.map(|d| (d - playing_duration).abs()).unwrap_or(0.0);
        has_synced(b).cmp(&has_synced(a))
            .then_with(|| diff(a).partial_cmp(&diff(b)).unwrap_or(std::cmp::Ordering::Equal))
    });
    candidates.into_iter().next()
}

fn into_lookup(t: &LrcTrack) -> LyricsLookup {
    if t.instrumental == Some(true) {
        return LyricsLookup { status: "instrumental".into(), synced_lyrics: None, plain_lyrics: None };
    }
    if has_synced(t) {
        return LyricsLookup { status: "synced".into(), synced_lyrics: t.synced_lyrics.clone(), plain_lyrics: t.plain_lyrics.clone() };
    }
    if has_plain(t) {
        return LyricsLookup { status: "plain".into(), synced_lyrics: None, plain_lyrics: t.plain_lyrics.clone() };
    }
    LyricsLookup { status: "none".into(), synced_lyrics: None, plain_lyrics: None }
}

fn none() -> LyricsLookup {
    LyricsLookup { status: "none".into(), synced_lyrics: None, plain_lyrics: None }
}

async fn throttle() {
    let wait = {
        let mut guard = LAST_REQUEST.lock().unwrap();
        let now = Instant::now();
        let wait = match *guard {
            Some(t) if now.duration_since(t) < Duration::from_millis(MIN_GAP_MS) => {
                Duration::from_millis(MIN_GAP_MS) - now.duration_since(t)
            }
            _ => Duration::ZERO,
        };
        *guard = Some(now + wait);
        wait
    };
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
}

#[tauri::command]
pub async fn lyrics_lookup(
    track_name: String,
    artist_name: String,
    album_name: String,
    duration_sec: f64,
) -> Option<LyricsLookup> {
    throttle().await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent(concat!(
            "Notch by IRUMVA/", env!("CARGO_PKG_VERSION"),
            " (Windows dynamic island; lyrics display via LRCLib)"
        ))
        .build()
        .ok()?;

    // 1) Exact match.
    let mut exact: Vec<(&str, String)> = vec![
        ("track_name", track_name.clone()),
        ("artist_name", artist_name.clone()),
    ];
    if !album_name.is_empty() { exact.push(("album_name", album_name.clone())); }
    if duration_sec > 0.0 { exact.push(("duration", format!("{}", duration_sec.round() as i64))); }
    if let Ok(resp) = client.get("https://lrclib.net/api/get").query(&exact).send().await {
        if resp.status().is_success() {
            // Responses are untrusted: cap the body before parsing.
            if let Ok(bytes) = resp.bytes().await {
                if bytes.len() <= 2_000_000 {
                    if let Ok(track) = serde_json::from_slice::<LrcTrack>(&bytes) {
                        if duration_ok(&track, duration_sec) {
                            return Some(into_lookup(&track));
                        }
                    }
                }
            }
        }
    }

    // 2) Search fallback, closest duration wins. The album is NOT sent:
    //    a wrong or missing album from the media session would filter
    //    out every candidate (verified live against LRCLib).
    let search: Vec<(&str, String)> = vec![
        ("track_name", track_name),
        ("artist_name", artist_name),
    ];
    let resp = client.get("https://lrclib.net/api/search").query(&search).send().await.ok()?;
    if !resp.status().is_success() { return Some(none()); }
    let bytes = resp.bytes().await.ok()?;
    if bytes.len() > 2_000_000 { return Some(none()); }
    let results: Vec<LrcTrack> = serde_json::from_slice(&bytes).ok()?;
    Some(choose(&results, duration_sec).map(into_lookup).unwrap_or_else(none))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(duration: Option<f64>, synced: bool, plain: bool, instrumental: bool) -> LrcTrack {
        LrcTrack {
            duration,
            instrumental: Some(instrumental),
            plain_lyrics: if plain { Some("words".into()) } else { None },
            synced_lyrics: if synced { Some("[00:01.00]line".into()) } else { None },
        }
    }

    #[test]
    fn search_prefers_synced_then_closest_duration() {
        let results = vec![
            track(Some(200.0), false, true, false),  // plain, exact duration
            track(Some(190.0), true, true, false),   // synced, 10 s off: outside tolerance
            track(Some(203.0), true, true, false),   // synced, 3 s off: winner
            track(Some(201.0), true, false, false),  // synced, 1 s off but listed later
        ];
        let picked = choose(&results, 200.0).unwrap();
        assert_eq!(picked.duration, Some(201.0));
    }

    #[test]
    fn results_beyond_tolerance_are_ignored() {
        let results = vec![track(Some(220.0), true, true, false)];
        assert!(choose(&results, 200.0).is_none());
        assert!(!duration_ok(&results[0], 200.0));
        assert!(duration_ok(&results[0], 206.0) == false);
        assert!(duration_ok(&track(Some(204.9), true, false, false), 200.0));
    }

    #[test]
    fn instrumental_and_plain_states_resolve() {
        let inst = track(Some(100.0), false, false, true);
        assert_eq!(into_lookup(&inst).status, "instrumental");
        let plain = track(Some(100.0), false, true, false);
        assert_eq!(into_lookup(&plain).status, "plain");
        let empty = track(Some(100.0), false, false, false);
        assert_eq!(into_lookup(&empty).status, "none");
    }

    #[test]
    fn unknown_playing_duration_accepts_best_synced() {
        let results = vec![track(Some(999.0), true, false, false)];
        assert!(choose(&results, 0.0).is_some());
    }
}

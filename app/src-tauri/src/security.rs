//! Phase 3 security layer (brief section 7). All Win32/WinRT APIs are
//! documented on Microsoft Learn:
//! - DPAPI: CryptProtectData / CryptUnprotectData (current-user scope)
//! - Secrets: Credential Manager CredWriteW / CredReadW / CredDeleteW
//! - Windows Hello: UserConsentVerifier.RequestVerificationAsync
//! - Session lock: hidden message window + WTSRegisterSessionNotification
//! - IPC: named pipe with a current-user-SID ACL (SDDL), HMAC-SHA256
//!   message authentication, nonce replay protection, one-time pairing.

use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static APP_DATA: OnceLock<PathBuf> = OnceLock::new();

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }
fn read_wide(ptr: *const u16) -> String {
    if ptr.is_null() { return String::new(); }
    let mut len = 0;
    unsafe { while *ptr.add(len) != 0 { len += 1; } }
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(ptr, len) })
}

fn random_bytes(n: usize) -> Vec<u8> {
    extern "system" { fn BCryptGenRandom(h: isize, buf: *mut u8, len: u32, flags: u32) -> i32; }
    let mut buf = vec![0u8; n];
    let rc = unsafe { BCryptGenRandom(0, buf.as_mut_ptr(), n as u32, 0x2) }; // BCRYPT_USE_SYSTEM_PREFERRED_RNG
    if rc != 0 { // never fall back to a weak RNG: fail closed with time-mixed zeros is worse, so panic-free entropy from OS only
        buf.iter_mut().for_each(|b| *b = 0);
    }
    buf
}
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }

// ---------- DPAPI ----------
#[repr(C)]
struct DataBlob { cb: u32, pb: *mut u8 }
extern "system" {
    fn CryptProtectData(input: *const DataBlob, descr: *const u16, entropy: *const DataBlob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, out: *mut DataBlob) -> i32;
    fn CryptUnprotectData(input: *const DataBlob, descr: *mut *mut u16, entropy: *const DataBlob, reserved: *mut std::ffi::c_void, prompt: *mut std::ffi::c_void, flags: u32, out: *mut DataBlob) -> i32;
    fn LocalFree(mem: isize) -> isize;
}

pub fn dpapi_protect(plain: &[u8]) -> Option<String> {
    let input = DataBlob { cb: plain.len() as u32, pb: plain.as_ptr() as *mut u8 };
    let mut out = DataBlob { cb: 0, pb: std::ptr::null_mut() };
    let ok = unsafe { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut out) };
    if ok == 0 || out.pb.is_null() { return None; }
    let bytes = unsafe { std::slice::from_raw_parts(out.pb, out.cb as usize) }.to_vec();
    unsafe { LocalFree(out.pb as isize) };
    Some(base64_encode(&bytes))
}

pub fn dpapi_unprotect(b64: &str) -> Option<Vec<u8>> {
    let bytes = base64_decode(b64)?;
    let input = DataBlob { cb: bytes.len() as u32, pb: bytes.as_ptr() as *mut u8 };
    let mut out = DataBlob { cb: 0, pb: std::ptr::null_mut() };
    let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), 1, &mut out) };
    if ok == 0 || out.pb.is_null() { return None; }
    let plain = unsafe { std::slice::from_raw_parts(out.pb, out.cb as usize) }.to_vec();
    unsafe { LocalFree(out.pb as isize) };
    Some(plain)
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |a, &b| (a << 8) | b as u32) << (8 * (3 - chunk.len()));
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let mut table = [255u8; 256];
    for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".iter().enumerate() { table[*c as usize] = i as u8; }
    let clean: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 { return None; }
        let mut vals = [0u8; 4];
        let mut pad = 0;
        for (i, &c) in chunk.iter().enumerate() {
            if c == b'=' { pad += 1; } else { vals[i] = table[c as usize]; if vals[i] == 255 { return None; } }
        }
        let n = ((vals[0] as u32) << 18) | ((vals[1] as u32) << 12) | ((vals[2] as u32) << 6) | vals[3] as u32;
        out.push((n >> 16) as u8);
        if pad < 2 { out.push((n >> 8) as u8); }
        if pad < 1 { out.push(n as u8); }
    }
    Some(out)
}

// ---------- settings + paired clients at rest (DPAPI files) ----------
fn file_path(name: &str) -> Option<PathBuf> { APP_DATA.get().map(|d| d.join(name)) }

fn save_encrypted_file(name: &str, plaintext: &str) -> bool {
    let Some(path) = file_path(name) else { return false };
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    match dpapi_protect(plaintext.as_bytes()) {
        Some(b64) => std::fs::write(path, b64).is_ok(),
        None => false,
    }
}
fn load_encrypted_file(name: &str) -> Option<String> {
    let path = file_path(name)?;
    let b64 = std::fs::read_to_string(path).ok()?;
    String::from_utf8(dpapi_unprotect(b64.trim())?).ok()
}

#[tauri::command]
pub fn settings_load() -> Option<String> { load_encrypted_file("settings.dpapi") }

#[tauri::command]
pub fn settings_save(plaintext: String) -> bool { save_encrypted_file("settings.dpapi", &plaintext) }

// ---------- Credential Manager secrets ----------
#[repr(C)]
struct CredentialW {
    flags: u32, typ: u32, target_name: *const u16, comment: *const u16,
    last_written: u64, blob_size: u32, blob: *const u8, persist: u32,
    attr_count: u32, attrs: *mut std::ffi::c_void, target_alias: *const u16, user_name: *const u16,
}
extern "system" {
    fn CredWriteW(cred: *const CredentialW, flags: u32) -> i32;
    fn CredReadW(target: *const u16, typ: u32, flags: u32, out: *mut *mut CredentialW) -> i32;
    fn CredDeleteW(target: *const u16, typ: u32, flags: u32) -> i32;
    fn CredFree(buf: *mut std::ffi::c_void);
    fn CredEnumerateW(filter: *const u16, flags: u32, count: *mut u32, out: *mut *mut *mut CredentialW) -> i32;
}
const CRED_TYPE_GENERIC: u32 = 1;
const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
fn cred_target(key: &str) -> Vec<u16> { wide(&format!("Notch by IRUMVA:{key}")) }

#[tauri::command]
pub fn secret_set(key: String, value: String) -> bool {
    let target = cred_target(&key);
    let user = wide("Notch");
    let blob = value.as_bytes();
    let cred = CredentialW {
        flags: 0, typ: CRED_TYPE_GENERIC, target_name: target.as_ptr(), comment: std::ptr::null(),
        last_written: 0, blob_size: blob.len() as u32, blob: blob.as_ptr(), persist: CRED_PERSIST_LOCAL_MACHINE,
        attr_count: 0, attrs: std::ptr::null_mut(), target_alias: std::ptr::null(), user_name: user.as_ptr(),
    };
    unsafe { CredWriteW(&cred, 0) != 0 }
}

#[tauri::command]
pub fn secret_get(key: String) -> Option<String> {
    let target = cred_target(&key);
    let mut out: *mut CredentialW = std::ptr::null_mut();
    if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut out) } == 0 || out.is_null() { return None; }
    let value = unsafe {
        let c = &*out;
        String::from_utf8_lossy(std::slice::from_raw_parts(c.blob, c.blob_size as usize)).to_string()
    };
    unsafe { CredFree(out as *mut std::ffi::c_void) };
    Some(value)
}

#[tauri::command]
pub fn secret_delete(key: String) -> bool {
    let target = cred_target(&key);
    unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) != 0 }
}

// ---------- Windows Hello ----------
#[derive(Serialize)]
pub struct HelloResult { ok: bool, status: String }

#[tauri::command]
pub fn hello_verify(message: String) -> HelloResult {
    let joined = std::thread::spawn(move || unsafe {
        let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        tauri::async_runtime::block_on(async move {
            use windows::Security::Credentials::UI::{
                UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
            };
            let availability = UserConsentVerifier::CheckAvailabilityAsync()
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())?;
            if availability != UserConsentVerifierAvailability::Available {
                return Ok::<_, String>(HelloResult { ok: false, status: format!("hello-unavailable:{availability:?}") });
            }
            let result = UserConsentVerifier::RequestVerificationAsync(&windows::core::HSTRING::from(message))
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())?;
            Ok(HelloResult {
                ok: result == UserConsentVerificationResult::Verified,
                status: format!("{result:?}"),
            })
        })
    }).join();
    match joined {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => HelloResult { ok: false, status: format!("hello-error:{e}") },
        Err(_) => HelloResult { ok: false, status: "hello-error:thread".into() },
    }
}

// ---------- export / erase ----------
#[tauri::command]
pub fn data_export() -> Option<String> {
    let settings = load_encrypted_file("settings.dpapi");
    let clients: Vec<String> = clients().lock().map(|c| c.keys().cloned().collect()).unwrap_or_default();
    Some(serde_json::json!({
        "product": "Notch by IRUMVA",
        "settings": settings.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
        "pairedClients": clients,
        "secretsExported": false,
        "note": "Secrets live in Windows Credential Manager and are never exported."
    }).to_string())
}

#[tauri::command]
pub fn data_erase() -> bool {
    let mut ok = true;
    for name in ["settings.dpapi", "clients.dpapi"] {
        if let Some(p) = file_path(name) { if p.exists() && std::fs::remove_file(&p).is_err() { ok = false; } }
    }
    if let Ok(mut c) = clients().lock() { c.clear(); }
    // Delete every Credential Manager entry we own.
    unsafe {
        let filter = wide("Notch by IRUMVA:*");
        let mut count: u32 = 0;
        let mut list: *mut *mut CredentialW = std::ptr::null_mut();
        if CredEnumerateW(filter.as_ptr(), 0, &mut count, &mut list) != 0 && !list.is_null() {
            for i in 0..count {
                let cred = *list.add(i as usize);
                if !cred.is_null() { CredDeleteW((*cred).target_name, CRED_TYPE_GENERIC, 0); }
            }
            CredFree(list as *mut std::ffi::c_void);
        }
    }
    ok
}

// ---------- pairing + IPC ----------
struct Pairing { code_hash: Option<String>, expires_ms: i64, attempts: u32 }
fn pairing() -> &'static Mutex<Pairing> {
    static P: OnceLock<Mutex<Pairing>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(Pairing { code_hash: None, expires_ms: 0, attempts: 0 }))
}
fn clients() -> &'static Mutex<HashMap<String, Vec<u8>>> {
    static C: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}
struct Replay { seen: HashSet<String>, order: VecDeque<String> }
fn replay() -> &'static Mutex<Replay> {
    static R: OnceLock<Mutex<Replay>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Replay { seen: HashSet::new(), order: VecDeque::new() }))
}

fn sha256_hex(data: &[u8]) -> String {
    use sha2::Digest;
    hex(&sha2::Sha256::digest(data))
}
fn const_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() { return false; }
    let mut d = 0u8;
    for i in 0..a.len() { d |= a[i] ^ b[i]; }
    d == 0
}
fn persist_clients() {
    if let Ok(c) = clients().lock() {
        let map: HashMap<String, String> = c.iter().map(|(k, v)| (k.clone(), hex(v))).collect();
        if let Ok(json) = serde_json::to_string(&map) { save_encrypted_file("clients.dpapi", &json); }
    }
}
fn load_clients() {
    if let Some(json) = load_encrypted_file("clients.dpapi") {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&json) {
            let mut c = clients().lock().unwrap();
            for (k, v) in map {
                if let Ok(bytes) = (0..v.len()).step_by(2).map(|i| u8::from_str_radix(&v[i..i + 2], 16)).collect::<Result<Vec<u8>, _>>() {
                    c.insert(k, bytes);
                }
            }
        }
    }
}

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
#[tauri::command]
pub fn pairing_start() -> Option<String> {
    let bytes = random_bytes(8);
    if bytes.iter().all(|b| *b == 0) { return None; }
    let code: String = bytes.iter().map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char).collect();
    let mut p = pairing().lock().ok()?;
    p.code_hash = Some(sha256_hex(code.as_bytes()));
    p.expires_ms = now_ms() + 5 * 60 * 1000;
    p.attempts = 0;
    Some(code)
}

// Canonical JSON identical to src/security/ipcProtocol.ts
pub fn canonical(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            format!("{{{}}}", keys.iter().map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canonical(&map[*k]))).collect::<Vec<_>>().join(","))
        }
        serde_json::Value::Array(items) => format!("[{}]", items.iter().map(canonical).collect::<Vec<_>>().join(",")),
        other => serde_json::to_string(other).unwrap(),
    }
}
fn hmac_hex(secret: &[u8], timestamp: i64, nonce: &str, payload: &serde_json::Value) -> String {
    use hmac::Mac;
    let mut mac = hmac::Hmac::<sha2::Sha256>::new_from_slice(secret).expect("hmac key");
    mac.update(format!("{timestamp}.{nonce}.{}", canonical(payload)).as_bytes());
    hex(&mac.finalize().into_bytes())
}
fn check_auth(env: &serde_json::Value) -> Result<String, &'static str> {
    let client_id = env.get("clientId").and_then(|v| v.as_str()).ok_or("missing-client")?;
    let secret = clients().lock().map_err(|_| "lock")?.get(client_id).cloned().ok_or("unknown-client")?;
    let ts = env.get("timestamp").and_then(|v| v.as_i64()).ok_or("missing-timestamp")?;
    if (now_ms() - ts).abs() > 60_000 { return Err("stale-timestamp"); }
    let nonce = env.get("nonce").and_then(|v| v.as_str()).ok_or("missing-nonce")?;
    if !(8..=128).contains(&nonce.len()) { return Err("bad-nonce"); }
    {
        let mut r = replay().lock().map_err(|_| "lock")?;
        if r.seen.contains(nonce) { return Err("replay"); }
        r.seen.insert(nonce.to_string());
        r.order.push_back(nonce.to_string());
        while r.order.len() > 1024 {
            if let Some(old) = r.order.pop_front() { r.seen.remove(&old); }
        }
    }
    let payload = env.get("payload").cloned().unwrap_or(serde_json::Value::Null);
    let expected = env.get("hmac").and_then(|v| v.as_str()).ok_or("missing-hmac")?;
    let actual = hmac_hex(&secret, ts, nonce, &payload);
    if !const_eq(actual.as_bytes(), expected.as_bytes()) { return Err("bad-hmac"); }
    Ok(client_id.to_string())
}

fn handle_ipc(msg: &serde_json::Value) -> serde_json::Value {
    match msg.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "pair" => {
            let code = msg.get("code").and_then(|v| v.as_str()).unwrap_or("");
            let mut p = match pairing().lock() { Ok(p) => p, Err(_) => return err("lock") };
            if p.attempts >= 5 { return err("pairing-locked"); }
            p.attempts += 1;
            let valid = p.code_hash.as_deref().is_some_and(|h| now_ms() <= p.expires_ms && const_eq(sha256_hex(code.as_bytes()).as_bytes(), h.as_bytes()));
            if !valid { return err("bad-code"); }
            p.code_hash = None; // single-use
            p.attempts = 0;
            let client_id = hex(&random_bytes(8));
            let secret = random_bytes(32);
            if secret.iter().all(|b| *b == 0) { return err("rng"); }
            clients().lock().unwrap().insert(client_id.clone(), secret.clone());
            drop(p);
            persist_clients();
            serde_json::json!({"ok": true, "clientId": client_id, "secret": hex(&secret)})
        }
        "ping" => match check_auth(msg) {
            Ok(_) => serde_json::json!({"ok": true, "type": "pong"}),
            Err(e) => err(e),
        },
        "activity.publish" => {
            let client_id = match check_auth(msg) { Ok(c) => c, Err(e) => return err(e) };
            let payload = msg.get("payload").cloned().unwrap_or_default();
            let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
            let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("ipc");
            let subtitle = payload.get("subtitle").and_then(|v| v.as_str()).unwrap_or("");
            let priority = payload.get("priority").and_then(|v| v.as_i64()).unwrap_or(50).clamp(0, 100);
            if title.is_empty() || title.chars().count() > 120 || subtitle.chars().count() > 200
                || kind.is_empty() || kind.chars().count() > 40
                || !kind.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return err("invalid-payload");
            }
            let expires = payload.get("expiresInSeconds").and_then(|v| v.as_i64()).unwrap_or(0).clamp(0, 3600);
            let client_given_id = payload.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let activity_id = if !client_given_id.is_empty() && client_given_id.chars().count() <= 80
                && client_given_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                client_given_id.to_string()
            } else { format!("ipc-{client_id}-{}", hex(&random_bytes(4))) };
            if let Some(app) = APP.get() {
                let _ = app.emit("notch://ipc-activity", serde_json::json!({
                    "id": activity_id,
                    "kind": kind, "title": title, "subtitle": subtitle, "priority": priority,
                    "expiresInSeconds": expires,
                }));
            }
            serde_json::json!({"ok": true})
        }
        "approval.request" => {
            if let Err(e) = check_auth(msg) { return err(e); }
            let payload = msg.get("payload").cloned().unwrap_or_default();
            let (Some(agent), Some(action)) = (str_field(&payload, "agent", 80), str_field(&payload, "action", 500)) else { return err("invalid-payload") };
            let target = str_field(&payload, "target", 260).unwrap_or_default();
            let cwd = str_field(&payload, "cwd", 260).unwrap_or_default();
            let timeout_ms = payload.get("timeoutMs").and_then(|v| v.as_i64()).unwrap_or(120_000).clamp(10_000, 300_000);
            let request_id = hex(&random_bytes(8));
            let action_hash = sha256_hex(canonical(&serde_json::json!({
                "action": action, "agent": agent, "cwd": cwd, "target": target
            })).as_bytes());
            if let Some(app) = APP.get() {
                let _ = app.emit("notch://approval-request", serde_json::json!({
                    "requestId": request_id, "source": "bridge", "agent": agent,
                    "action": action, "target": target, "cwd": cwd,
                    "actionHash": action_hash, "timeoutMs": timeout_ms,
                }));
            }
            match wait_for_decision(request_id, action_hash, timeout_ms) {
                Some(decision) => serde_json::json!({"ok": true, "decision": decision}),
                None => serde_json::json!({"ok": true, "decision": "expired"}), // fail closed: treat as deny
            }
        }
        "review.propose" => {
            if let Err(e) = check_auth(msg) { return err(e); }
            let payload = msg.get("payload").cloned().unwrap_or_default();
            let Some(review_id) = str_field(&payload, "id", 80) else { return err("invalid-payload") };
            if !review_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return err("invalid-payload"); }
            let timeout_ms = payload.get("timeoutMs").and_then(|v| v.as_i64()).unwrap_or(180_000).clamp(10_000, 300_000);
            if let Some(app) = APP.get() {
                let _ = app.emit("notch://review-propose", payload.clone());
            }
            match wait_for_decision(format!("review:{review_id}"), String::new(), timeout_ms) {
                Some(raw) => {
                    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
                    serde_json::json!({"ok": true, "decision": parsed.get("decision"), "comment": parsed.get("comment")})
                }
                None => serde_json::json!({"ok": true, "decision": "expired"}),
            }
        }
        _ => err("unknown-type"),
    }
}
fn err(e: &str) -> serde_json::Value { serde_json::json!({"ok": false, "error": e}) }

// ---------- approval / review request-response over the pipe ----------
// A paired client sends approval.request or review.propose and keeps the
// connection open. Rust emits an event to the UI, then blocks this
// connection's handler (bounded by the request timeout) until the UI
// answers through the approval_respond / review_respond commands.
// Expired or unanswered requests resolve as deny (fail closed).

struct PendingDecision { action_hash: String, sender: std::sync::mpsc::Sender<String> }
fn pending_decisions() -> &'static Mutex<HashMap<String, PendingDecision>> {
    static P: OnceLock<Mutex<HashMap<String, PendingDecision>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

fn wait_for_decision(key: String, action_hash: String, timeout_ms: i64) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    pending_decisions().lock().unwrap().insert(key.clone(), PendingDecision { action_hash, sender: tx });
    let result = rx.recv_timeout(std::time::Duration::from_millis(timeout_ms.max(1000) as u64)).ok();
    pending_decisions().lock().unwrap().remove(&key);
    result
}

#[tauri::command]
pub fn approval_respond(request_id: String, action_hash: String, decision: String) -> bool {
    if !matches!(decision.as_str(), "allow-once" | "allow-session" | "deny") { return false; }
    let map = pending_decisions().lock().unwrap();
    match map.get(&request_id) {
        Some(p) if const_eq(p.action_hash.as_bytes(), action_hash.as_bytes()) => {
            p.sender.send(decision).is_ok()
        }
        _ => false,
    }
}

#[tauri::command]
pub fn review_respond(review_id: String, decision: String, comment: String) -> bool {
    if !matches!(decision.as_str(), "approve" | "request-changes" | "reject" | "open-diff") { return false; }
    if comment.chars().count() > 1000 { return false; }
    let key = format!("review:{review_id}");
    let map = pending_decisions().lock().unwrap();
    match map.get(&key) {
        Some(p) => p.sender.send(serde_json::json!({ "decision": decision, "comment": comment }).to_string()).is_ok(),
        None => false,
    }
}

fn str_field(v: &serde_json::Value, key: &str, max: usize) -> Option<String> {
    let s = v.get(key)?.as_str()?.trim();
    if s.is_empty() || s.chars().count() > max { None } else { Some(s.to_string()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonical_sorts_keys() {
        let v = serde_json::json!({"b": 1, "a": {"d": 4, "c": 3}});
        assert_eq!(canonical(&v), "{\"a\":{\"c\":3,\"d\":4},\"b\":1}");
    }
    #[test]
    fn hmac_detects_tampering() {
        let secret = [7u8; 32];
        let payload = serde_json::json!({"title": "npm test"});
        let sig = hmac_hex(&secret, 1000, "n1", &payload);
        assert!(const_eq(sig.as_bytes(), hmac_hex(&secret, 1000, "n1", &payload).as_bytes()));
        assert!(!const_eq(sig.as_bytes(), hmac_hex(&secret, 1000, "n1", &serde_json::json!({"title": "evil"})).as_bytes()));
    }
}

// ---------- named pipe server (current-user SID ACL) ----------
mod pipe {
    use super::*;

    type Handle = isize;
    extern "system" {
        fn CreateNamedPipeW(name: *const u16, open_mode: u32, pipe_mode: u32, max_instances: u32, out_buf: u32, in_buf: u32, timeout: u32, attrs: *const SecurityAttributes) -> Handle;
        fn ConnectNamedPipe(pipe: Handle, overlapped: *mut std::ffi::c_void) -> i32;
        fn DisconnectNamedPipe(pipe: Handle) -> i32;
        fn ReadFile(pipe: Handle, buf: *mut u8, to_read: u32, read: *mut u32, overlapped: *mut std::ffi::c_void) -> i32;
        fn WriteFile(pipe: Handle, buf: *const u8, to_write: u32, written: *mut u32, overlapped: *mut std::ffi::c_void) -> i32;
        fn CloseHandle(h: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl: *const u16, revision: u32, out: *mut *mut std::ffi::c_void, size: *mut u32) -> i32;
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(token: Handle, class: u32, info: *mut std::ffi::c_void, len: u32, ret_len: *mut u32) -> i32;
        fn ConvertSidToStringSidW(sid: *mut std::ffi::c_void, out: *mut *mut u16) -> i32;
    }
    #[repr(C)]
    struct SecurityAttributes { length: u32, descriptor: *mut std::ffi::c_void, inherit: i32 }
    #[repr(C)]
    struct SidAndAttributes { sid: *mut std::ffi::c_void, attributes: u32 }

    const INVALID_HANDLE: Handle = -1;

    fn user_sid_string() -> Option<String> {
        unsafe {
            let mut token: Handle = 0;
            if OpenProcessToken(GetCurrentProcess(), 0x8, &mut token) == 0 { return None; }
            let mut needed: u32 = 0;
            GetTokenInformation(token, 1, std::ptr::null_mut(), 0, &mut needed);
            if needed == 0 { CloseHandle(token); return None; }
            let mut buf = vec![0u8; needed as usize];
            if GetTokenInformation(token, 1, buf.as_mut_ptr() as *mut _, needed, &mut needed) == 0 { CloseHandle(token); return None; }
            let token_user = &*(buf.as_ptr() as *const SidAndAttributes);
            let mut sid_str: *mut u16 = std::ptr::null_mut();
            if ConvertSidToStringSidW(token_user.sid, &mut sid_str) == 0 { CloseHandle(token); return None; }
            let s = read_wide(sid_str);
            LocalFree(sid_str as isize);
            CloseHandle(token);
            Some(s)
        }
    }

    fn read_exact(pipe: Handle, buf: &mut [u8]) -> bool {
        let mut offset = 0;
        while offset < buf.len() {
            let mut read: u32 = 0;
            let ok = unsafe { ReadFile(pipe, buf.as_mut_ptr().add(offset), (buf.len() - offset) as u32, &mut read, std::ptr::null_mut()) };
            if ok == 0 || read == 0 { return false; }
            offset += read as usize;
        }
        true
    }
    fn write_all(pipe: Handle, bytes: &[u8]) -> bool {
        let mut offset = 0;
        while offset < bytes.len() {
            let mut written: u32 = 0;
            let ok = unsafe { WriteFile(pipe, bytes.as_ptr().add(offset), (bytes.len() - offset) as u32, &mut written, std::ptr::null_mut()) };
            if ok == 0 || written == 0 { return false; }
            offset += written as usize;
        }
        true
    }

    fn serve_client(pipe: Handle) {
        loop {
            let mut len_buf = [0u8; 4];
            if !read_exact(pipe, &mut len_buf) { break; }
            let len = u32::from_le_bytes(len_buf) as usize;
            if len == 0 || len > 65_536 { break; } // bounded frames, drop abusive clients
            let mut body = vec![0u8; len];
            if !read_exact(pipe, &mut body) { break; }
            let response = match serde_json::from_slice::<serde_json::Value>(&body) {
                Ok(msg) => handle_ipc(&msg),
                Err(_) => err("bad-json"),
            };
            let out = serde_json::to_vec(&response).unwrap_or_default();
            if !write_all(pipe, &(out.len() as u32).to_le_bytes()) || !write_all(pipe, &out) { break; }
        }
        unsafe { DisconnectNamedPipe(pipe); CloseHandle(pipe); }
    }

    pub fn start() {
        std::thread::spawn(|| unsafe {
            let Some(sid) = user_sid_string() else { return }; // fail closed
            // SDDL: protected DACL, SYSTEM + current user only.
            let sddl = wide(&format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})"));
            let mut descriptor: *mut std::ffi::c_void = std::ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut descriptor, std::ptr::null_mut()) == 0 { return; }
            let attrs = SecurityAttributes { length: 24, descriptor, inherit: 0 };
            let name = wide(r"\\.\pipe\com.irumva.notch.v1");
            loop {
                let pipe = CreateNamedPipeW(name.as_ptr(), 0x3, 0x0, 4, 65_536, 65_536, 0, &attrs);
                if pipe == INVALID_HANDLE { std::thread::sleep(std::time::Duration::from_secs(1)); continue; }
                if ConnectNamedPipe(pipe, std::ptr::null_mut()) != 0 {
                    std::thread::spawn(move || serve_client(pipe));
                } else {
                    CloseHandle(pipe);
                }
            }
        });
    }
}

// ---------- session lock watcher (hidden message window) ----------
mod session_watch {
    use super::*;

    type Hwnd = isize;
    extern "system" {
        fn RegisterClassW(cls: *const WndClass) -> u16;
        fn CreateWindowExW(ex: u32, class: *const u16, name: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32, parent: Hwnd, menu: isize, inst: isize, param: *mut std::ffi::c_void) -> Hwnd;
        fn DefWindowProcW(hwnd: Hwnd, msg: u32, w: usize, l: isize) -> isize;
        fn GetMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn WTSRegisterSessionNotification(hwnd: Hwnd, flags: u32) -> i32;
        fn AddClipboardFormatListener(hwnd: Hwnd) -> i32;
    }
    #[repr(C)]
    struct WndClass {
        style: u32, wnd_proc: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize>,
        cls_extra: i32, wnd_extra: i32, instance: isize, icon: isize, cursor: isize,
        background: isize, menu_name: *const u16, class_name: *const u16,
    }
    #[repr(C)]
    struct Msg { hwnd: Hwnd, message: u32, w: usize, l: isize, time: u32, pt_x: i32, pt_y: i32, private: u32 }

    const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
    const WM_CLIPBOARDUPDATE: u32 = 0x031D;
    const WTS_SESSION_LOCK: usize = 7;
    const WTS_SESSION_UNLOCK: usize = 8;

    unsafe extern "system" fn wnd_proc(hwnd: Hwnd, msg: u32, w: usize, l: isize) -> isize {
        if msg == WM_CLIPBOARDUPDATE {
            if let Some(app) = APP.get() { let _ = app.emit("notch://clipboard-changed", ()); }
        }
        if msg == WM_WTSSESSION_CHANGE {
            if let Some(app) = APP.get() {
                let _ = match w {
                    WTS_SESSION_LOCK => app.emit("notch://session-lock", ()),
                    WTS_SESSION_UNLOCK => app.emit("notch://session-unlock", ()),
                    _ => Ok(()),
                };
            }
        }
        DefWindowProcW(hwnd, msg, w, l)
    }

    pub fn start() {
        std::thread::spawn(|| unsafe {
            let class_name = wide("NotchByIrumvaSessionWatch");
            let cls = WndClass {
                style: 0, wnd_proc: Some(wnd_proc), cls_extra: 0, wnd_extra: 0, instance: 0,
                icon: 0, cursor: 0, background: 0, menu_name: std::ptr::null(), class_name: class_name.as_ptr(),
            };
            if RegisterClassW(&cls) == 0 { return; }
            let hwnd = CreateWindowExW(0, class_name.as_ptr(), class_name.as_ptr(), 0, 0, 0, 0, 0, -3, 0, 0, std::ptr::null_mut());
            if hwnd == 0 { return; }
            if WTSRegisterSessionNotification(hwnd, 0) == 0 { return; } // NOTIFY_FOR_THIS_SESSION
            let _ = AddClipboardFormatListener(hwnd); // Phase 5 clipboard history (documented)
            let mut msg = Msg { hwnd: 0, message: 0, w: 0, l: 0, time: 0, pt_x: 0, pt_y: 0, private: 0 };
            loop {
                if GetMessageW(&mut msg, 0, 0, 0) <= 0 { break; }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

// ---------- OpenCode server lifecycle (Phase 4) ----------
// Verified against the locally installed OpenCode v2 server's own
// OpenAPI document (GET /openapi.json on the server). See docs/ANTIGRAVITY.md
// and ASSUMPTIONS for the version-specific contract.

#[derive(Serialize)]
pub struct OpenCodeServerStatus {
    started: bool,
    already_running: bool,
    password: Option<String>,
    error: Option<String>,
}

fn opencode_health_ok() -> bool {
    use std::io::Write;
    let addr: std::net::SocketAddr = ([127, 0, 0, 1], 4096).into();
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)) else { return false };
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
    if stream.write_all(b"GET /api/info HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").is_err() { return false; }
    let mut buf = [0u8; 64];
    use std::io::Read;
    matches!(stream.read(&mut buf), Ok(n) if n >= 12 && &buf[..12] == b"HTTP/1.1 401" || n >= 12 && &buf[..12] == b"HTTP/1.1 200")
}

fn find_opencode() -> Option<PathBuf> {
    if let Ok(appdata) = std::env::var("APPDATA") {
        for rel in [r"npm\node_modules\@opencode\cli\bin\opencode.exe", r"npm\node_modules\@opencode\cli-windows-x64\bin\opencode.exe"] {
            let p = PathBuf::from(&appdata).join(rel);
            if p.exists() { return Some(p); }
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join("opencode.exe");
            if p.exists() { return Some(p); }
        }
    }
    None
}

#[tauri::command]
pub fn opencode_server_start(directory: String) -> OpenCodeServerStatus {
    if opencode_health_ok() {
        return OpenCodeServerStatus { started: false, already_running: true, password: secret_get("opencode-server-password".into()), error: None };
    }
    let Some(exe) = find_opencode() else {
        return OpenCodeServerStatus { started: false, already_running: false, password: None, error: Some("opencode-not-found".into()) };
    };
    let password = hex(&random_bytes(24));
    if !secret_set("opencode-server-password".into(), password.clone()) {
        return OpenCodeServerStatus { started: false, already_running: false, password: None, error: Some("credential-store-failed".into()) };
    }
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["serve", "--hostname", "127.0.0.1", "--port", "4096"])
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let dir = PathBuf::from(&directory);
    if dir.is_dir() { cmd.current_dir(dir); }
    match cmd.spawn() {
        Ok(_) => OpenCodeServerStatus { started: true, already_running: false, password: Some(password), error: None },
        Err(e) => OpenCodeServerStatus { started: false, already_running: false, password: None, error: Some(e.to_string()) },
    }
}

#[tauri::command]
pub fn opencode_server_password() -> Option<String> {
    secret_get("opencode-server-password".into())
}

pub fn init_security(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if let Ok(dir) = app.path().app_data_dir() { let _ = APP_DATA.set(dir); }
    load_clients();
    pipe::start();
    session_watch::start();
}

use tauri::Manager;

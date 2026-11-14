//! Local security layer. All Win32 APIs are documented on Microsoft Learn:
//! - DPAPI: CryptProtectData / CryptUnprotectData (current-user scope)
//! - Secrets: Credential Manager CredWriteW / CredReadW / CredDeleteW
//! - Session lock: hidden message window + WTSRegisterSessionNotification
//!
//! Notch runs no network server, no named-pipe IPC API, and no pairing.
//! Nothing in this module opens a socket or accepts external commands.

use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static APP_DATA: OnceLock<PathBuf> = OnceLock::new();

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

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

// ---------- settings at rest (DPAPI file) ----------
fn file_path(name: &str) -> Option<PathBuf> { APP_DATA.get().map(|d| d.join(name)) }

fn save_encrypted_file(name: &str, plaintext: &str) -> bool {
    let Some(path) = file_path(name) else { return false };
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    let Some(b64) = dpapi_protect(plaintext.as_bytes()) else { return false };
    // Write-then-rename: a crash or power loss mid-write leaves the old
    // settings file intact instead of a truncated one.
    let tmp = path.with_extension("dpapi.tmp");
    if std::fs::write(&tmp, &b64).is_err() { let _ = std::fs::remove_file(&tmp); return false; }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    true
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

// ---------- export / erase ----------
#[tauri::command]
pub fn data_export() -> Option<String> {
    let settings = load_encrypted_file("settings.dpapi");
    Some(serde_json::json!({
        "product": "Notch by IRUMVA",
        "settings": settings.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
        "secretsExported": false,
        "note": "Secrets live in Windows Credential Manager and are never exported."
    }).to_string())
}

#[tauri::command]
pub fn data_erase() -> bool {
    let mut ok = true;
    // Files in the app data dir (settings hold reminders, to-dos,
    // shelf metadata and provider toggles).
    for name in ["settings.dpapi", "clients.dpapi", "session.running", "crash-count.txt"] {
        if let Some(p) = file_path(name) { if p.exists() && std::fs::remove_file(&p).is_err() { ok = false; } }
    }
    // Whole data directories: lyrics cache, backups (which contain
    // settings copies), rollback store, logs and diagnostics exports.
    if let Some(base) = file_path("") {
        for dir in ["lyrics", "backups", "rollback", "logs"] {
            let p = base.join(dir);
            if p.exists() && std::fs::remove_dir_all(&p).is_err() { ok = false; }
        }
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("diagnostics-") {
                    let p = e.path();
                    if p.is_dir() { let _ = std::fs::remove_dir_all(&p); }
                    else { let _ = std::fs::remove_file(&p); }
                }
            }
        }
    }
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
    const WTS_SESSION_LOCK: usize = 7;
    const WTS_SESSION_UNLOCK: usize = 8;

    unsafe extern "system" fn wnd_proc(hwnd: Hwnd, msg: u32, w: usize, l: isize) -> isize {
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
            let mut msg = Msg { hwnd: 0, message: 0, w: 0, l: 0, time: 0, pt_x: 0, pt_y: 0, private: 0 };
            loop {
                if GetMessageW(&mut msg, 0, 0, 0) <= 0 { break; }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

pub fn init_security(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if let Ok(dir) = app.path().app_data_dir() { let _ = APP_DATA.set(dir); }
    session_watch::start();
}

use tauri::Manager;

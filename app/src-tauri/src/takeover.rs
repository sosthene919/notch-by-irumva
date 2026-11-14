//! Notification takeover: Notch becomes the notification surface.
//!
//! While takeover is on, Windows' own toast *banners* are silenced via
//! the same global switch Focus Assist uses
//! (HKCU\...\Notifications\Settings\NOC_GLOBAL_SETTING_TOASTS_ENABLED = 0).
//! Delivery is untouched: toasts still land in the Action Center and in
//! wpndatabase.db, where the notification watcher picks them up and the
//! notch shows them instead. No notifications are lost.
//!
//! Ownership bookkeeping lives in HKCU\Software\Notch by IRUMVA:
//! - TakeoverActive (DWORD): the user's takeover preference. Persists
//!   across runs; every launch re-asserts banner suppression while the
//!   app runs, and a graceful exit restores banners (preference kept).
//! - OriginalToastsEnabled (DWORD): the pre-takeover Windows value,
//!   recorded once on first enable. Restored on disable/uninstall
//!   (the NSIS PREUNINSTALL hook does the same if the app is gone).

use serde::Serialize;

const NOTCH_KEY: &str = r"Software\Notch by IRUMVA";
const WINDOWS_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
const WINDOWS_VALUE: &str = "NOC_GLOBAL_SETTING_TOASTS_ENABLED";

const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
const KEY_READ: u32 = 0x20019;
const KEY_WRITE: u32 = 0x20006;
const REG_DWORD: u32 = 4;

extern "system" {
    fn RegOpenKeyExW(key: isize, sub: *const u16, options: u32, access: u32, out: *mut isize) -> i32;
    fn RegCreateKeyExW(key: isize, sub: *const u16, reserved: u32, class: *const u16, options: u32, access: u32, sa: *mut std::ffi::c_void, out: *mut isize, disp: *mut u32) -> i32;
    fn RegQueryValueExW(key: isize, name: *const u16, reserved: *mut u32, typ: *mut u32, data: *mut u8, size: *mut u32) -> i32;
    fn RegSetValueExW(key: isize, name: *const u16, reserved: u32, typ: u32, data: *const u8, size: u32) -> i32;
    fn RegCloseKey(key: isize) -> i32;
}

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

fn read_dword(sub_key: &str, value: &str) -> Option<u32> {
    unsafe {
        let mut key: isize = 0;
        if RegOpenKeyExW(HKEY_CURRENT_USER, wide(sub_key).as_ptr(), 0, KEY_READ, &mut key) != 0 { return None; }
        let mut data: u32 = 0;
        let mut size: u32 = 4;
        let mut typ: u32 = 0;
        let rc = RegQueryValueExW(key, wide(value).as_ptr(), std::ptr::null_mut(), &mut typ, &mut data as *mut u32 as *mut u8, &mut size);
        RegCloseKey(key);
        if rc == 0 && typ == REG_DWORD && size == 4 { Some(data) } else { None }
    }
}

fn write_dword(sub_key: &str, value: &str, data: u32) -> bool {
    unsafe {
        let mut key: isize = 0;
        if RegCreateKeyExW(HKEY_CURRENT_USER, wide(sub_key).as_ptr(), 0, std::ptr::null(), 0, KEY_WRITE, std::ptr::null_mut(), &mut key, std::ptr::null_mut()) != 0 { return false; }
        let rc = RegSetValueExW(key, wide(value).as_ptr(), 0, REG_DWORD, &data as *const u32 as *const u8, 4);
        RegCloseKey(key);
        rc == 0
    }
}

/// Effective Windows banner state: absent value means banners on.
fn windows_banners_enabled() -> bool { read_dword(WINDOWS_KEY, WINDOWS_VALUE) != Some(0) }
fn takeover_active() -> bool { read_dword(NOTCH_KEY, "TakeoverActive") == Some(1) }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeoverStatus {
    active: bool,
    banners_enabled: bool,
}

fn status() -> TakeoverStatus {
    TakeoverStatus { active: takeover_active(), banners_enabled: windows_banners_enabled() }
}

#[tauri::command]
pub fn takeover_get() -> TakeoverStatus { status() }

#[tauri::command]
pub fn takeover_set(enabled: bool) -> TakeoverStatus {
    if enabled {
        if !takeover_active() {
            // Record the pre-takeover state exactly once.
            let original = if windows_banners_enabled() { 1 } else { 0 };
            write_dword(NOTCH_KEY, "OriginalToastsEnabled", original);
            write_dword(NOTCH_KEY, "TakeoverActive", 1);
        }
        write_dword(WINDOWS_KEY, WINDOWS_VALUE, 0);
    } else if takeover_active() {
        let original = read_dword(NOTCH_KEY, "OriginalToastsEnabled").unwrap_or(1);
        write_dword(WINDOWS_KEY, WINDOWS_VALUE, original);
        write_dword(NOTCH_KEY, "TakeoverActive", 0);
    }
    status()
}

/// At startup: if the user left takeover on, re-assert banner suppression
/// (a previous graceful exit restored banners; a kill left them off —
/// either way the running app owns them again).
pub fn assert_if_active() {
    if takeover_active() { write_dword(WINDOWS_KEY, WINDOWS_VALUE, 0); }
}

/// On graceful exit: give Windows its banners back. The preference marker
/// stays on, so the next launch takes over again.
pub fn restore_if_active() {
    if takeover_active() {
        let original = read_dword(NOTCH_KEY, "OriginalToastsEnabled").unwrap_or(1);
        write_dword(WINDOWS_KEY, WINDOWS_VALUE, original);
    }
}

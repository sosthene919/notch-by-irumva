//! Release engineering: single instance, crash accounting, safe mode,
//! automatic rollback, autostart, local logs, diagnostics export and
//! data backups. Everything here is local files and registry values in
//! the user's own profile. No network, no telemetry.
//!
//! Crash model: each launch writes `session.running` in the app data
//! dir and removes it on graceful exit. Finding it still present at
//! startup means the previous run died. Three unclean exits in a row
//! arm safe mode (core providers only, handled by the frontend) and,
//! when an installer-made rollback backup exists, the app offers and
//! performs a restore of the previous version and its data.

use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP_DATA: OnceLock<PathBuf> = OnceLock::new();
static STARTUP: OnceLock<StartupInfo> = OnceLock::new();
/// Set by reset_crash_state. STARTUP is a once-per-process snapshot, so
/// without this the frontend keeps reading the old safe-mode verdict
/// after the user presses Exit safe mode (the notice never goes away).
static SAFE_MODE_CLEARED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub safe_mode: bool,
    pub crash_count: u32,
    pub rollback_available: bool,
    pub version: String,
}

/// Pure crash accounting: an unclean previous exit increments the
/// streak, a clean one clears it. Safe mode arms at 3.
pub fn crash_outcome(previous_count: u32, previous_unclean: bool) -> (u32, bool) {
    let count = if previous_unclean { previous_count + 1 } else { 0 };
    (count, count >= 3)
}

/// Watchdog relaunch decision. The clean-exit marker is the ground
/// truth: it exists only while a run is in progress, so a parent that
/// died with the marker still present crashed, whatever its process
/// exit code says (or fails to say). Without a marker, fall back to
/// the exit code: nonzero relaunches, zero and unreadable do not.
pub fn should_relaunch(marker_present: bool, exit_code: Option<u32>) -> bool {
    if marker_present { return true; }
    matches!(exit_code, Some(code) if code != 0)
}

fn app_data() -> Option<PathBuf> { APP_DATA.get().cloned() }
fn join(name: &str) -> Option<PathBuf> { app_data().map(|d| d.join(name)) }

fn read_count() -> u32 {
    join("crash-count.txt")
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}
fn write_count(n: u32) {
    if let Some(p) = join("crash-count.txt") { let _ = std::fs::write(p, n.to_string()); }
}

pub fn rollback_dir() -> Option<PathBuf> { join("rollback") }
pub fn rollback_available() -> bool {
    rollback_dir().map(|d| d.join("notch-prev.exe").exists()).unwrap_or(false)
}

/// Called once from setup. Returns and stores the startup state.
pub fn begin_launch(app: &AppHandle) -> StartupInfo {
    SAFE_MODE_CLEARED.store(false, Ordering::SeqCst);
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = APP_DATA.set(dir);
    }
    let unclean = join("session.running").map(|p| p.exists()).unwrap_or(false);
    let (count, safe_mode) = crash_outcome(read_count(), unclean);
    write_count(count);
    if let Some(p) = join("session.running") { let _ = std::fs::write(p, "1"); }
    let info = StartupInfo {
        safe_mode,
        crash_count: count,
        rollback_available: rollback_available(),
        version: app.package_info().version.to_string(),
    };
    let _ = STARTUP.set(info.clone());
    log_event(app, &format!("startup version={} safe_mode={} crashes={}", info.version, info.safe_mode, info.crash_count));
    info
}

/// Graceful exit: the next launch starts with a clean slate.
pub fn mark_clean_exit() {
    if let Some(p) = join("session.running") { let _ = std::fs::remove_file(p); }
    write_count(0);
}

#[tauri::command]
pub fn get_startup_info() -> StartupInfo {
    let mut info = STARTUP.get().cloned().unwrap_or_default();
    if SAFE_MODE_CLEARED.load(Ordering::SeqCst) {
        info.safe_mode = false;
        info.crash_count = 0;
    }
    info
}

#[tauri::command]
pub fn reset_crash_state() -> bool {
    write_count(0);
    if let Some(p) = join("session.running") { let _ = std::fs::remove_file(p); }
    SAFE_MODE_CLEARED.store(true, Ordering::SeqCst);
    true
}

// ---------- durable data folder ----------
#[tauri::command]
pub fn data_location(app: AppHandle) -> Option<String> {
    app.path().app_data_dir().ok().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> bool {
    let Some(dir) = app.path().app_data_dir().ok() else { return false };
    let _ = std::fs::create_dir_all(&dir);
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map(|_| true)
        .unwrap_or(false)
}

// ---------- Windows session end (restart / shutdown / sign-out) ----------
// An app killed by Windows during shutdown never reaches ExitRequested.
// Without this, every reboot would count as a crash and three reboots
// would arm safe mode and make Notch look reset. A hidden top-level
// window receives WM_ENDSESSION; only then is the run marked clean.
#[cfg(windows)]
pub fn start_shutdown_watcher() {
    mod watch {
        type Hwnd = isize;
        extern "system" {
            fn RegisterClassW(cls: *const WndClass) -> u16;
            fn CreateWindowExW(ex: u32, class: *const u16, name: *const u16, style: u32,
                x: i32, y: i32, w: i32, h: i32, parent: Hwnd, menu: isize,
                inst: isize, param: *mut std::ffi::c_void) -> Hwnd;
            fn DefWindowProcW(hwnd: Hwnd, msg: u32, w: usize, l: isize) -> isize;
            fn GetMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32) -> i32;
            fn TranslateMessage(msg: *const Msg) -> i32;
            fn DispatchMessageW(msg: *const Msg) -> isize;
        }
        #[repr(C)]
        struct WndClass {
            style: u32, wnd_proc: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize>,
            cls_extra: i32, wnd_extra: i32, instance: isize, icon: isize, cursor: isize,
            background: isize, menu_name: *const u16, class_name: *const u16,
        }
        #[repr(C)]
        struct Msg { hwnd: Hwnd, message: u32, w: usize, l: isize, time: u32, pt_x: i32, pt_y: i32, private: u32 }
        const WM_QUERYENDSESSION: u32 = 0x0011;
        const WM_ENDSESSION: u32 = 0x0016;
        fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

        unsafe extern "system" fn wnd_proc(hwnd: Hwnd, msg: u32, w: usize, l: isize) -> isize {
            match msg {
                WM_QUERYENDSESSION => 1,
                WM_ENDSESSION if w != 0 => { super::mark_clean_exit(); 0 }
                _ => DefWindowProcW(hwnd, msg, w, l),
            }
        }

        pub fn run() {
            unsafe {
                let class_name = wide("NotchByIrumvaShutdownWatch");
                let cls = WndClass {
                    style: 0, wnd_proc: Some(wnd_proc), cls_extra: 0, wnd_extra: 0, instance: 0,
                    icon: 0, cursor: 0, background: 0, menu_name: std::ptr::null(),
                    class_name: class_name.as_ptr(),
                };
                if RegisterClassW(&cls) == 0 { return; }
                let hwnd = CreateWindowExW(0, class_name.as_ptr(), class_name.as_ptr(), 0,
                    0, 0, 0, 0, 0, 0, 0, std::ptr::null_mut());
                if hwnd == 0 { return; }
                let mut msg = Msg { hwnd: 0, message: 0, w: 0, l: 0, time: 0, pt_x: 0, pt_y: 0, private: 0 };
                loop {
                    if GetMessageW(&mut msg, 0, 0, 0) <= 0 { break; }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }
    std::thread::spawn(watch::run);
}

// ---------- single instance ----------
// A named mutex claims the instance; a second launch pokes a named
// event and exits. The running instance turns the event into an
// "open settings" navigation. No second island is ever created.
#[cfg(windows)]
pub fn claim_single_instance() -> bool {
    type Handle = isize;
    extern "system" {
        fn CreateMutexW(attrs: *mut std::ffi::c_void, initial: i32, name: *const u16) -> Handle;
        fn GetLastError() -> u32;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }
    unsafe {
        let h = CreateMutexW(std::ptr::null_mut(), 0, wide("Local\\NotchByIrumva.SingleInstance").as_ptr());
        if h == 0 { return true; } // cannot tell; do not block startup
        GetLastError() != 183 // ERROR_ALREADY_EXISTS
    }
}

#[cfg(windows)]
pub fn signal_show_settings() {
    type Handle = isize;
    extern "system" {
        fn OpenEventW(access: u32, inherit: i32, name: *const u16) -> Handle;
        fn SetEvent(h: Handle) -> i32;
        fn CloseHandle(h: Handle) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }
    unsafe {
        let h = OpenEventW(0x0002, 0, wide("Local\\NotchByIrumva.ShowSettings").as_ptr()); // EVENT_MODIFY_STATE
        if h != 0 { SetEvent(h); CloseHandle(h); }
    }
}

#[cfg(windows)]
pub fn start_settings_signal_listener(app: AppHandle) {
    std::thread::spawn(move || {
        type Handle = isize;
        extern "system" {
            fn CreateEventW(attrs: *mut std::ffi::c_void, manual: i32, initial: i32, name: *const u16) -> Handle;
            fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
            fn ResetEvent(h: Handle) -> i32;
        }
        fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }
        unsafe {
            let h = CreateEventW(std::ptr::null_mut(), 1, 0, wide("Local\\NotchByIrumva.ShowSettings").as_ptr());
            if h == 0 { return; }
            loop {
                if WaitForSingleObject(h, 0xFFFF_FFFF) != 0 { break; }
                ResetEvent(h);
                // Show the Settings popup directly (no JS round-trip
                // needed), and still notify the frontend for compat.
                {
                    use tauri::Manager;
                    if let Some(w) = app.get_webview_window("settings") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                let _ = app.emit("notch://open-settings", ());
            }
        }
    });
}

// ---------- logs (local, capped, no personal data) ----------
pub fn log_event(_app: &AppHandle, message: &str) {
    let Some(dir) = join("logs") else { return };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("notch.log");
    if std::fs::metadata(&path).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("notch.old.log"));
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{ts} {message}");
    }
}

// ---------- data backup (pre-migration and installer-made) ----------
fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    let _ = std::fs::create_dir_all(dst);
    if let Ok(entries) = std::fs::read_dir(src) {
        for e in entries.flatten() {
            let p = e.path();
            let target = dst.join(e.file_name());
            if p.is_dir() { copy_dir(&p, &target); }
            else { let _ = std::fs::copy(&p, &target); }
        }
    }
}

#[tauri::command]
pub fn data_backup(app: AppHandle, label: String) -> Option<String> {
    let base = app.path().app_data_dir().ok()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let safe_label: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect();
    let dest = base.join("backups").join(format!("{safe_label}-{stamp}"));
    std::fs::create_dir_all(&dest).ok()?;
    for name in ["settings.dpapi", "clients.dpapi"] {
        let from = base.join(name);
        if from.exists() { let _ = std::fs::copy(&from, dest.join(name)); }
    }
    let lyrics = base.join("lyrics");
    if lyrics.exists() { copy_dir(&lyrics, &dest.join("lyrics")); }
    // Keep the newest 3 backups.
    if let Ok(entries) = std::fs::read_dir(base.join("backups")) {
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        while dirs.len() > 3 {
            if let Some(old) = dirs.first().cloned() { let _ = std::fs::remove_dir_all(&old); dirs.remove(0); }
            else { break; }
        }
    }
    log_event(&app, &format!("data backup label={safe_label}"));
    Some(dest.to_string_lossy().to_string())
}

// ---------- rollback ----------
#[tauri::command]
pub fn perform_rollback(app: AppHandle) -> Result<String, String> {
    let dir = rollback_dir().ok_or("no rollback store")?;
    let backup_exe = dir.join("notch-prev.exe");
    if !backup_exe.exists() { return Err("no previous version is stored".into()); }
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let install_dir = current_exe.parent().ok_or("bad install path")?.to_path_buf();
    let target = install_dir.join("notch.exe");

    // Restore data first (settings, paired clients, lyrics cache).
    if let Some(base) = app_data() {
        let data_src = dir.join("data");
        for name in ["settings.dpapi", "clients.dpapi"] {
            let from = data_src.join(name);
            if from.exists() { let _ = std::fs::copy(&from, base.join(name)); }
        }
        let lyrics_src = data_src.join("lyrics");
        if lyrics_src.exists() { copy_dir(&lyrics_src, &base.join("lyrics")); }
    }

    // A running .exe cannot be overwritten on Windows, but it can be
    // renamed. Move the bad build aside, put the previous one in place.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bad = install_dir.join(format!("notch.bad-{stamp}.exe"));
    std::fs::rename(&target, &bad).map_err(|e| format!("could not move the current build aside: {e}"))?;
    if let Err(e) = std::fs::copy(&backup_exe, &target) {
        let _ = std::fs::rename(&bad, &target); // put it back; stay runnable
        return Err(format!("could not restore the previous build: {e}"));
    }
    log_event(&app, "rollback performed");
    mark_clean_exit();
    std::process::Command::new(&target).spawn().map_err(|e| e.to_string())?;
    // Exit without tripping the crash counter or the watchdog.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(400));
        std::process::exit(0);
    });
    Ok("restoring".into())
}

// ---------- autostart (Start with Windows) ----------
#[cfg(windows)]
mod autostart {
    const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const VALUE: &str = "Notch by IRUMVA";
    const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
    extern "system" {
        fn RegOpenKeyExW(key: isize, sub: *const u16, options: u32, access: u32, out: *mut isize) -> i32;
        fn RegCreateKeyExW(key: isize, sub: *const u16, reserved: u32, class: *const u16, options: u32, access: u32, sa: *mut std::ffi::c_void, out: *mut isize, disp: *mut u32) -> i32;
        fn RegQueryValueExW(key: isize, name: *const u16, reserved: *mut u32, typ: *mut u32, data: *mut u8, size: *mut u32) -> i32;
        fn RegSetValueExW(key: isize, name: *const u16, reserved: u32, typ: u32, data: *const u8, size: u32) -> i32;
        fn RegDeleteValueW(key: isize, name: *const u16) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

    pub fn get() -> bool {
        unsafe {
            let mut key: isize = 0;
            if RegOpenKeyExW(HKEY_CURRENT_USER, wide(RUN_KEY).as_ptr(), 0, 0x20019, &mut key) != 0 { return false; }
            let mut size: u32 = 0;
            let rc = RegQueryValueExW(key, wide(VALUE).as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), &mut size);
            RegCloseKey(key);
            rc == 0
        }
    }
    pub fn set(enabled: bool) -> bool {
        unsafe {
            let mut key: isize = 0;
            if RegCreateKeyExW(HKEY_CURRENT_USER, wide(RUN_KEY).as_ptr(), 0, std::ptr::null(), 0, 0x20006, std::ptr::null_mut(), &mut key, std::ptr::null_mut()) != 0 { return false; }
            let rc = if enabled {
                let Ok(exe) = std::env::current_exe() else { RegCloseKey(key); return false };
                let value = wide(&format!("\"{}\"", exe.to_string_lossy()));
                RegSetValueExW(key, wide(VALUE).as_ptr(), 0, 1, value.as_ptr() as *const u8, (value.len() * 2) as u32)
            } else {
                RegDeleteValueW(key, wide(VALUE).as_ptr())
            };
            RegCloseKey(key);
            rc == 0
        }
    }
}

#[tauri::command]
pub fn autostart_get() -> bool {
    #[cfg(windows)] { autostart::get() }
    #[cfg(not(windows))] { false }
}

#[tauri::command]
pub fn autostart_set(enabled: bool) -> bool {
    #[cfg(windows)] { autostart::set(enabled) }
    #[cfg(not(windows))] { false }
}

// ---------- about + diagnostics export ----------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    changelog: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        changelog: include_str!("../resources/CHANGELOG.md").to_string(),
    }
}

#[tauri::command]
pub fn export_diagnostics(app: AppHandle, summary: String) -> Option<String> {
    let base = app.path().app_data_dir().ok()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let folder = base.join(format!("diagnostics-{stamp}"));
    std::fs::create_dir_all(&folder).ok()?;
    let summary: String = summary.chars().take(8000).collect();
    let body = format!(
        "{{\n  \"app\": \"Notch by IRUMVA\",\n  \"version\": \"{}\",\n  \"exportedUnix\": {stamp},\n  \"summary\": {}\n}}\n",
        app.package_info().version,
        serde_json::to_string(&summary).unwrap_or_else(|_| "\"\"".into()),
    );
    std::fs::write(folder.join("diagnostics.json"), body).ok()?;
    let logs = base.join("logs");
    if logs.exists() { copy_dir(&logs, &folder.join("logs")); }
    log_event(&app, "diagnostics exported");
    // Zip it with the inbox archiver; the folder stays if that fails.
    let zip = base.join(format!("diagnostics-{stamp}.zip"));
    let made = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &format!(
            "Compress-Archive -Path '{}' -DestinationPath '{}' -Force",
            folder.display(), zip.display()
        )])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    Some(if made { zip.to_string_lossy().to_string() } else { folder.to_string_lossy().to_string() })
}

use tauri::Manager;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_streak_arms_safe_mode_at_three() {
        assert_eq!(crash_outcome(0, true), (1, false));
        assert_eq!(crash_outcome(1, true), (2, false));
        assert_eq!(crash_outcome(2, true), (3, true));
        assert_eq!(crash_outcome(2, false), (0, false));
        assert_eq!(crash_outcome(9, false), (0, false));
    }

    #[test]
    fn watchdog_relaunches_on_marker_or_nonzero_exit_only() {
        // Marker still present means the run never exited cleanly,
        // even if the exit code reads as 0 or cannot be read at all.
        assert!(should_relaunch(true, Some(0)));
        assert!(should_relaunch(true, None));
        // Clean exit: marker removed and code 0. No relaunch.
        assert!(!should_relaunch(false, Some(0)));
        // Unreadable code with no marker (marker was cleaned up):
        // do not loop forever on an unknown state.
        assert!(!should_relaunch(false, None));
        // Hard kill with a readable nonzero code relaunches even if
        // the marker was somehow already gone.
        assert!(should_relaunch(false, Some(1)));
        assert!(should_relaunch(false, Some(0xFFFF_FFFF)));
    }
}

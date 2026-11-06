//! Phase 5 premium features. Documented Win32 APIs only:
//! - Vitals: GetSystemTimes, GlobalMemoryStatusEx, GetDiskFreeSpaceExW
//! - Clipboard text: OpenClipboard/GetClipboardData/SetClipboardData
//! - Launch/open: ShellExecuteW; Start Menu .lnk enumeration via std::fs
//! - Dark mode: Personalize registry values (documented personalization keys)
//! - Lock: LockWorkStation; Screenshot: ms-screenclip: URI (Snipping Tool)

use serde::Serialize;
use std::sync::Mutex;

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

// ---------- vitals ----------
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vitals {
    cpu_percent: f64,
    ram_percent: f64,
    ram_total_gb: f64,
    disk_free_gb: f64,
    disk_total_gb: f64,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct FileTime { low: u32, high: u32 }
impl FileTime { fn ticks(&self) -> u64 { ((self.high as u64) << 32) | self.low as u64 } }

#[repr(C)]
#[derive(Default)]
struct MemoryStatusEx {
    length: u32, memory_load: u32,
    total_phys: u64, avail_phys: u64, total_page_file: u64, avail_page_file: u64,
    total_virtual: u64, avail_virtual: u64, avail_extended_virtual: u64,
}

extern "system" {
    fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
    fn GlobalMemoryStatusEx(out: *mut MemoryStatusEx) -> i32;
    fn GetDiskFreeSpaceExW(dir: *const u16, free_caller: *mut u64, total: *mut u64, total_free: *mut u64) -> i32;
    fn GetProcessMemoryInfo(process: isize, counters: *mut ProcessCounters, size: u32) -> i32;
    fn GetCurrentProcess() -> isize;
}

#[repr(C)]
#[derive(Default)]
struct ProcessCounters {
    cb: u32, page_fault_count: u32, peak_working_set: usize, working_set: usize,
    quota_peak_paged: usize, quota_paged: usize, quota_peak_nonpaged: usize, quota_nonpaged: usize,
    pagefile: usize, peak_pagefile: usize, private_usage: usize,
}

static LAST_TIMES: Mutex<Option<(u64, u64, u64)>> = Mutex::new(None);

#[tauri::command]
pub fn vitals_get() -> Option<Vitals> {
    unsafe {
        let (mut idle, mut kernel, mut user) = (FileTime::default(), FileTime::default(), FileTime::default());
        if GetSystemTimes(&mut idle, &mut kernel, &mut user) == 0 { return None; }
        let (i, k, u) = (idle.ticks(), kernel.ticks(), user.ticks());
        let cpu = {
            let mut last = LAST_TIMES.lock().unwrap();
            let value = match *last {
                Some((pi, pk, pu)) => {
                    let total = (k - pk) + (u - pu);
                    let idle_delta = i - pi;
                    if total > 0 { 100.0 * (1.0 - idle_delta as f64 / total as f64) } else { 0.0 }
                }
                None => 0.0,
            };
            *last = Some((i, k, u));
            value.clamp(0.0, 100.0)
        };
        let mut mem = MemoryStatusEx { length: std::mem::size_of::<MemoryStatusEx>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut mem) == 0 { return None; }
        let (mut free_caller, mut total_disk, mut total_free) = (0u64, 0u64, 0u64);
        let root = wide("C:\\");
        let _ = GetDiskFreeSpaceExW(root.as_ptr(), &mut free_caller, &mut total_disk, &mut total_free);
        Some(Vitals {
            cpu_percent: cpu,
            ram_percent: mem.memory_load as f64,
            ram_total_gb: mem.total_phys as f64 / 1_073_741_824.0,
            disk_free_gb: free_caller as f64 / 1_073_741_824.0,
            disk_total_gb: total_disk as f64 / 1_073_741_824.0,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfInfo { working_set_mb: f64, private_mb: f64 }

#[tauri::command]
pub fn perf_info() -> Option<PerfInfo> {
    unsafe {
        let mut c = ProcessCounters { cb: std::mem::size_of::<ProcessCounters>() as u32, ..Default::default() };
        if GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) == 0 { return None; }
        Some(PerfInfo {
            working_set_mb: c.working_set as f64 / 1_048_576.0,
            private_mb: c.private_usage as f64 / 1_048_576.0,
        })
    }
}

// ---------- clipboard (text only, in memory on the frontend) ----------
mod clip {
    extern "system" {
        pub fn OpenClipboard(owner: isize) -> i32;
        pub fn CloseClipboard() -> i32;
        pub fn GetClipboardData(format: u32) -> isize;
        pub fn SetClipboardData(format: u32, mem: isize) -> isize;
        pub fn EmptyClipboard() -> i32;
        pub fn GlobalLock(mem: isize) -> *mut u16;
        pub fn GlobalUnlock(mem: isize) -> i32;
        pub fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    }
    pub const CF_UNICODETEXT: u32 = 13;
    pub const GMEM_MOVEABLE: u32 = 0x2;
}

#[tauri::command]
pub fn clipboard_get_text() -> Option<String> {
    unsafe {
        if clip::OpenClipboard(0) == 0 { return None; }
        let handle = clip::GetClipboardData(clip::CF_UNICODETEXT);
        let result = if handle == 0 { None } else {
            let ptr = clip::GlobalLock(handle);
            if ptr.is_null() { None } else {
                let mut len = 0;
                while *ptr.add(len) != 0 { len += 1; }
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                clip::GlobalUnlock(handle);
                Some(s)
            }
        };
        clip::CloseClipboard();
        result
    }
}

#[tauri::command]
pub fn clipboard_set_text(text: String) -> bool {
    unsafe {
        if clip::OpenClipboard(0) == 0 { return false; }
        clip::EmptyClipboard();
        let utf16: Vec<u16> = text.encode_utf16().chain([0]).collect();
        let bytes = utf16.len() * 2;
        let mem = clip::GlobalAlloc(clip::GMEM_MOVEABLE, bytes);
        if mem == 0 { clip::CloseClipboard(); return false; }
        let ptr = clip::GlobalLock(mem) as *mut u16;
        if ptr.is_null() { clip::CloseClipboard(); return false; }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        clip::GlobalUnlock(mem);
        let ok = clip::SetClipboardData(clip::CF_UNICODETEXT, mem) != 0;
        clip::CloseClipboard();
        ok
    }
}

// ---------- launcher / open ----------
#[derive(Serialize)]
pub struct AppEntry { name: String, path: String }

fn collect_lnk(dir: &std::path::Path, out: &mut Vec<AppEntry>, depth: usize) {
    if depth > 3 || out.len() > 400 { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() { collect_lnk(&path, out, depth + 1); }
        else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(AppEntry { name: stem.to_string(), path: path.to_string_lossy().to_string() });
            }
        }
    }
}

#[tauri::command]
pub fn launcher_apps() -> Vec<AppEntry> {
    let mut out = Vec::new();
    for var in ["APPDATA", "ProgramData"] {
        if let Ok(base) = std::env::var(var) {
            collect_lnk(&std::path::Path::new(&base).join(r"Microsoft\Windows\Start Menu\Programs"), &mut out, 0);
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.dedup_by(|a, b| a.name == b.name && a.path == b.path);
    out
}

extern "system" {
    fn ShellExecuteW(owner: isize, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    fn LockWorkStation() -> i32;
}

fn shell_open(file: &str, params: Option<String>) -> bool {
    let f = wide(file);
    let p = params.map(|s| wide(&s));
    let rc = unsafe {
        ShellExecuteW(0, wide("open").as_ptr(), f.as_ptr(), p.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()), std::ptr::null(), 1)
    };
    rc > 32
}

#[tauri::command]
pub fn launch_path(path: String) -> bool { shell_open(&path, None) }

#[tauri::command]
pub fn open_url(url: String) -> bool {
    // Only web and the documented ms-settings:/ms-screenclip: schemes.
    if url.starts_with("https://") || url.starts_with("http://") || url.starts_with("ms-settings:") || url.starts_with("ms-screenclip:") {
        shell_open(&url, None)
    } else { false }
}

#[tauri::command]
pub fn reveal_path(path: String) -> bool {
    std::process::Command::new("explorer.exe").arg(format!("/select,{path}")).spawn().is_ok()
}

#[tauri::command]
pub fn lock_workstation() -> bool { unsafe { LockWorkStation() != 0 } }

#[tauri::command]
pub fn take_screenshot() -> bool { shell_open("ms-screenclip:", None) }

// ---------- dark mode (documented Personalize values) ----------
extern "system" {
    fn RegOpenKeyExW(key: isize, sub: *const u16, options: u32, access: u32, out: *mut isize) -> i32;
    fn RegSetValueExW(key: isize, name: *const u16, reserved: u32, typ: u32, data: *const u8, size: u32) -> i32;
    fn RegCloseKey(key: isize) -> i32;
}
const HKEY_CURRENT_USER: isize = 0x8000_0001u32 as i32 as isize;
const KEY_SET_VALUE: u32 = 0x2;
const REG_DWORD: u32 = 4;

#[tauri::command]
pub fn set_dark_mode(dark: bool) -> bool {
    unsafe {
        let sub = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        let mut key: isize = 0;
        if RegOpenKeyExW(HKEY_CURRENT_USER, sub.as_ptr(), 0, KEY_SET_VALUE, &mut key) != 0 { return false; }
        let value: u32 = if dark { 0 } else { 1 };
        let bytes = value.to_ne_bytes();
        let mut ok = true;
        for name in ["AppsUseLightTheme", "SystemUsesLightTheme"] {
            if RegSetValueExW(key, wide(name).as_ptr(), 0, REG_DWORD, bytes.as_ptr(), 4) != 0 { ok = false; }
        }
        RegCloseKey(key);
        ok
    }
}

#[tauri::command]
pub fn read_text_file(path: String) -> Option<String> {
    // Scoped reader for calendar .ics files only (Phase 5 calendar import).
    let p = std::path::Path::new(&path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ics")) { return None; }
    let meta = std::fs::metadata(p).ok()?;
    if meta.len() > 1_000_000 { return None; }
    std::fs::read_to_string(p).ok()
}

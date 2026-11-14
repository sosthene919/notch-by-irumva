//! Diagnostics support: process memory via GetProcessMemoryInfo
//! (documented Win32 API). Everything else that used to live here
//! (clipboard history, launcher, shelf helpers) was removed with the
//! Extras hub — Notch exposes no API/server surface.

use serde::Serialize;

#[repr(C)]
#[derive(Default)]
struct ProcessCounters {
    cb: u32, page_fault_count: u32, peak_working_set: usize, working_set: usize,
    quota_peak_paged: usize, quota_paged: usize, quota_peak_nonpaged: usize, quota_nonpaged: usize,
    pagefile: usize, peak_pagefile: usize, private_usage: usize,
}

extern "system" {
    fn GetProcessMemoryInfo(process: isize, counters: *mut ProcessCounters, size: u32) -> i32;
    fn GetCurrentProcess() -> isize;
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

// ---------- file shelf support ----------
fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo { name: String, size: u64, is_dir: bool }

#[tauri::command]
pub fn path_info(path: String) -> Option<PathInfo> {
    let p = std::path::Path::new(&path);
    let meta = std::fs::metadata(p).ok()?;
    Some(PathInfo {
        name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone()),
        size: if meta.is_dir() { 0 } else { meta.len() },
        is_dir: meta.is_dir(),
    })
}

extern "system" {
    fn ShellExecuteW(owner: isize, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
}

#[tauri::command]
pub fn launch_path(path: String) -> bool {
    let f = wide(&path);
    unsafe { ShellExecuteW(0, wide("open").as_ptr(), f.as_ptr(), std::ptr::null(), std::ptr::null(), 1) > 32 }
}

#[tauri::command]
pub fn reveal_path(path: String) -> bool {
    std::process::Command::new("explorer.exe").arg(format!("/select,{path}")).spawn().is_ok()
}

#[tauri::command]
pub fn clipboard_set_text(text: String) -> bool {
    // Scoped to the shelf's Copy path action.
    clipboard_set(&text)
}

mod clip {
    extern "system" {
        pub fn OpenClipboard(owner: isize) -> i32;
        pub fn CloseClipboard() -> i32;
        pub fn SetClipboardData(format: u32, mem: isize) -> isize;
        pub fn EmptyClipboard() -> i32;
        pub fn GlobalLock(mem: isize) -> *mut u16;
        pub fn GlobalUnlock(mem: isize) -> i32;
        pub fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    }
    pub const CF_UNICODETEXT: u32 = 13;
    pub const GMEM_MOVEABLE: u32 = 0x2;
}

fn clipboard_set(text: &str) -> bool {
    unsafe {
        if clip::OpenClipboard(0) == 0 { return false; }
        clip::EmptyClipboard();
        let utf16: Vec<u16> = text.encode_utf16().chain([0]).collect();
        let mem = clip::GlobalAlloc(clip::GMEM_MOVEABLE, utf16.len() * 2);
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

// ---------- lyrics cache (local files, never secrets) ----------
// LRCLib responses are cached verbatim (JSON) under the app data dir,
// keyed by a hash of "title|artist|duration". Plain text on disk is
// fine here: lyrics are not user secrets.
fn lyrics_file(key: &str) -> Option<std::path::PathBuf> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    let dir = std::env::var("APPDATA").ok().map(|a| std::path::PathBuf::from(a).join("com.irumva.notch").join("lyrics"))?;
    Some(dir.join(format!("{:016x}.json", h.finish())))
}

#[tauri::command]
pub fn lyrics_cache_get(key: String) -> Option<String> {
    let raw = std::fs::read_to_string(lyrics_file(&key)?).ok()?;
    // Current format: DPAPI-encrypted (current user), like settings.
    if let Some(plain) = crate::security::dpapi_unprotect(raw.trim()) {
        return String::from_utf8(plain).ok();
    }
    // Legacy plaintext cache from before encryption: accept it once;
    // the next set rewrites it encrypted.
    let trimmed = raw.trim();
    if trimmed.starts_with('{') { Some(trimmed.to_string()) } else { None }
}

#[tauri::command]
pub fn lyrics_cache_set(key: String, text: String) -> bool {
    let Some(path) = lyrics_file(&key) else { return false };
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    match crate::security::dpapi_protect(text.as_bytes()) {
        Some(protected) => std::fs::write(path, protected).is_ok(),
        None => false,
    }
}

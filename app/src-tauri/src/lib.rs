//! Notch by IRUMVA — Rust shell.
//! Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.
//!
//! Phase 1 shell only: a borderless, transparent, topmost, top-center
//! window with WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW (no focus stealing,
//! no taskbar button, no Alt+Tab entry). Providers arrive in Phase 2.

mod native;

#[cfg(windows)]
mod window_style {
    // Documented Win32 API (learn.microsoft.com/windows/win32/api/winuser):
    // Get/SetWindowLongPtrW with GWL_EXSTYLE (-20).
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    const WS_EX_NOACTIVATE: isize = 0x0800_0000;

    extern "system" {
        fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    }

    pub fn apply(hwnd_raw: isize) {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd_raw, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd_raw, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            native::media_get,
            native::media_control,
            native::battery_get,
            native::volume_get,
            native::volume_set,
            native::volume_toggle_mute,
            native::privacy_get
        ])
        .setup(|app| {
            native::start_native_listeners(app.handle().clone());
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                // Apply after wry finishes its own window setup — applying in
                // `setup` directly is overwritten before first show (verified
                // by reading back GWL_EXSTYLE at runtime in Phase 2).
                #[cfg(windows)]
                {
                    let delayed = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        if let Ok(hwnd) = delayed.hwnd() {
                            window_style::apply(hwnd.0 as isize);
                        }
                    });
                }
                // Top-center on the current monitor.
                if let (Ok(Some(monitor)), Ok(size)) = (window.current_monitor(), window.outer_size()) {
                    let scale = monitor.scale_factor();
                    let mon_w = monitor.size().width as f64 / scale;
                    let win_w = size.width as f64 / scale;
                    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                        x: (mon_w - win_w) / 2.0,
                        y: 8.0,
                    }));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notch by IRUMVA");
}

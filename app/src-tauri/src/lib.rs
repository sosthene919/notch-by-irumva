//! Notch by IRUMVA — Rust shell.
//! Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.
//!
//! Phase 1 shell only: a borderless, transparent, topmost, top-center
//! window with WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW (no focus stealing,
//! no taskbar button, no Alt+Tab entry). Providers arrive in Phase 2.

mod bluetooth;
mod lyrics;
mod native;
mod premium;
pub mod release;
mod security;
mod takeover;
mod win_notifications;

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

/// Shows the dedicated Settings popup window (declared hidden in
/// tauri.conf.json). The notch window itself never navigates away
/// from the island to host settings any more.
#[tauri::command]
fn show_settings_window(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn show_settings(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single instance: a second launch asks the running instance to
    // open Settings, then exits. No second island is ever created.
    #[cfg(windows)]
    {
        if !release::claim_single_instance() {
            release::signal_show_settings();
            return;
        }
        // Crash watchdog (hidden second copy; see main.rs). It gets
        // the clean-exit marker path so its relaunch decision does
        // not depend on reading the process exit code alone.
        if let Ok(exe) = std::env::current_exe() {
            let marker = std::env::var_os("APPDATA")
                .map(|base| std::path::PathBuf::from(base).join("com.irumva.notch").join("session.running"))
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let _ = std::process::Command::new(exe)
                .args(["--watchdog", &std::process::id().to_string(), &marker])
                .spawn();
        }
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            native::media_get,
            native::media_control,
            native::battery_get,
            native::volume_get,
            native::volume_set,
            native::volume_toggle_mute,
            native::privacy_get,
            native::set_hover_region,
            native::set_fullscreen_hide,
            show_settings_window,
            native::media_seek,
            native::media_sessions,
            native::media_set_shuffle,
            native::media_set_repeat,
            native::list_displays,
            native::move_to_display,
            security::settings_load,
            security::settings_save,
            security::secret_set,
            security::secret_get,
            security::secret_delete,
            security::data_export,
            security::data_erase,
            premium::perf_info,
            premium::path_info,
            premium::launch_path,
            premium::reveal_path,
            premium::clipboard_set_text,
            premium::lyrics_cache_get,
            premium::lyrics_cache_set,
            lyrics::lyrics_lookup,
            takeover::takeover_get,
            takeover::takeover_set,
            release::get_startup_info,
            release::reset_crash_state,
            release::perform_rollback,
            release::data_backup,
            release::autostart_get,
            release::autostart_set,
            release::app_info,
            release::export_diagnostics,
            release::data_location,
            release::open_data_folder
        ])
        .setup(|app| {
            release::begin_launch(app.handle());
            #[cfg(windows)]
            release::start_shutdown_watcher();
            #[cfg(windows)]
            release::start_settings_signal_listener(app.handle().clone());
            security::init_security(app.handle());
            native::start_native_listeners(app.handle().clone());
            win_notifications::start_windows_notification_watcher(app.handle().clone());
            bluetooth::start_bluetooth_watch(app.handle().clone());
            takeover::assert_if_active();
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
                // Top-center on the monitor under the cursor (follows the
                // active display at launch), falling back to the window's monitor.
                #[cfg(windows)]
                {
                    #[repr(C)]
                    struct Point { x: i32, y: i32 }
                    extern "system" { fn GetCursorPos(p: *mut Point) -> i32; }
                    let mut cursor = Point { x: 0, y: 0 };
                    let _ = unsafe { GetCursorPos(&mut cursor) };
                    let monitor = app
                        .monitor_from_point(cursor.x as f64, cursor.y as f64)
                        .ok()
                        .flatten()
                        .or_else(|| window.current_monitor().ok().flatten());
                    if let (Some(monitor), Ok(size)) = (monitor, window.outer_size()) {
                        let pos = monitor.position();
                        let x = pos.x as f64 + (monitor.size().width as f64 - size.width as f64) / 2.0;
                        // y=0: the pill hugs the top edge like a notch.
                        let y = pos.y as f64;
                        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                            x: x as i32,
                            y: y as i32,
                        }));
                    }
                }
            }
            // System tray (1.1.0): the island stays off the taskbar
            // (skipTaskbar + WS_EX_TOOLWINDOW above), so this icon is
            // its only taskbar-area presence. Windows puts a new tray
            // icon in the hidden-icons overflow (^) until the user
            // pins it — there is no API to choose that, and we do not
            // try. Left-click toggles the island; the menu can also
            // open Settings or quit (the only reliable quit path for
            // an app with no taskbar button and no title bar).
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::Manager;
                let handle = app.handle().clone();
                if let (Ok(show_item), Ok(settings_item), Ok(quit_item), Ok(separator)) = (
                    MenuItem::with_id(&handle, "tray-show", "Show Notch", true, None::<&str>),
                    MenuItem::with_id(&handle, "tray-settings", "Open Settings", true, None::<&str>),
                    MenuItem::with_id(&handle, "tray-quit", "Quit Notch", true, None::<&str>),
                    PredefinedMenuItem::separator(&handle),
                ) {
                    if let Ok(menu) = Menu::with_items(&handle, &[
                        &show_item,
                        &settings_item,
                        &separator,
                        &quit_item,
                    ]) {
                        let mut builder = TrayIconBuilder::with_id("main-tray")
                            .tooltip("Notch by IRUMVA")
                            .menu(&menu)
                            .show_menu_on_left_click(false)
                            .on_menu_event(|app, event| match event.id.as_ref() {
                                "tray-show" => {
                                    if let Some(w) = app.get_webview_window("main") {
                                        let _ = w.show();
                                    }
                                }
                                "tray-settings" => {
                                    show_settings(app);
                                }
                                "tray-quit" => {
                                    takeover::restore_if_active();
                                    release::mark_clean_exit();
                                    app.exit(0);
                                }
                                _ => {}
                            })
                            .on_tray_icon_event(|tray, event| {
                                if let TrayIconEvent::Click {
                                    button: MouseButton::Left,
                                    button_state: MouseButtonState::Up,
                                    ..
                                } = event
                                {
                                    let app = tray.app_handle();
                                    if let Some(w) = app.get_webview_window("main") {
                                        if w.is_visible().unwrap_or(false) {
                                            let _ = w.hide();
                                        } else {
                                            let _ = w.show();
                                        }
                                    }
                                }
                            });
                        if let Some(icon) = app.default_window_icon() {
                            builder = builder.icon(icon.clone());
                        }
                        let _ = builder.build(&handle);
                    }
                }
            }
            // Gear buttons in the frontend ask for the popup over this
            // event as well as via the show_settings_window command —
            // whichever path lands first, showing is idempotent.
            {
                use tauri::Listener;
                let listener_handle = app.handle().clone();
                app.listen("notch://show-settings", move |_| {
                    show_settings(&listener_handle);
                });
            }
            // The Settings popup never really closes: its X hides it,
            // so reopening is instant and its place (slide, scroll) is
            // kept. Quitting happens from the tray or the main app exit.
            {
                use tauri::Manager;
                if let Some(settings_win) = app.get_webview_window("settings") {
                    let hide_target = settings_win.clone();
                    settings_win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = hide_target.hide();
                        }
                    });
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Notch by IRUMVA");
    app.run(|_, event| {
        // Graceful exit hands Windows its toast banners back (the
        // takeover preference persists; next launch re-asserts it)
        // and clears the crash marker. `Exit` is a fallback for paths
        // that skip ExitRequested; the shutdown watcher covers Windows
        // restart/shutdown, where neither event may arrive.
        match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                takeover::restore_if_active();
                release::mark_clean_exit();
            }
            _ => {}
        }
    });
}

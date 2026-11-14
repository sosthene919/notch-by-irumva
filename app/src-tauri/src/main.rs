// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Crash watchdog: the app launches a hidden copy of itself with
/// `--watchdog <pid>`. It waits for the main process and relaunches
/// it only when the exit was not clean. Safe mode and rollback inside
/// the app handle repeated crashes, so this never loops on its own:
/// a relaunched instance that keeps crashing reaches safe mode and
/// exits cleanly, which stops the cycle.
#[cfg(windows)]
fn watchdog(parent_pid: u32) -> ! {
    type Handle = isize;
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
        fn GetExitCodeProcess(h: Handle, code: *mut u32) -> i32;
        fn CloseHandle(h: Handle) -> i32;
    }
    const SYNCHRONIZE: u32 = 0x0010_0000;
    unsafe {
        let h = OpenProcess(SYNCHRONIZE, 0, parent_pid);
        if h == 0 { std::process::exit(0); }
        WaitForSingleObject(h, 0xFFFF_FFFF);
        let mut code: u32 = 0;
        GetExitCodeProcess(h, &mut code);
        CloseHandle(h);
        if code == 0 { std::process::exit(0); }
    }
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).spawn();
    }
    std::process::exit(0);
}

fn main() {
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(|a| a.as_str()) == Some("--watchdog") {
            if let Some(pid) = args.get(2).and_then(|a| a.parse::<u32>().ok()) {
                watchdog(pid);
            }
            return;
        }
    }
    notch_lib::run()
}

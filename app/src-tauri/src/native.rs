//! Phase 2 native providers. Every API here is verified against
//! Microsoft Learn (see docs/ASSUMPTIONS.md for the blocked/deferred ones):
//! - Now Playing: Windows.Media.Control GSMTC session manager
//! - Volume: Core Audio IAudioEndpointVolume + RegisterControlChangeNotify
//! - Battery: Win32 GetSystemPowerStatus
//! - Privacy: CapabilityAccessManager consent store (registry, read-only)

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ---------- shared payloads ----------
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    title: String,
    artist: String,
    album: String,
    app: String,
    status: String,
    position_seconds: f64,
    duration_seconds: f64,
    art_data_url: Option<String>,
    shuffle: Option<bool>,
    repeat: String,
    repeat_supported: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaSessionInfo {
    app: String,
    title: String,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BatteryState {
    percent: u8,
    ac_online: bool,
    charging: bool,
    has_battery: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeState {
    level: f32,
    muted: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyUse {
    kind: String,
    app: String,
}

// ---------- battery (documented Win32) ----------
#[repr(C)]
#[derive(Default)]
struct SystemPowerStatus {
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
    battery_life_time: u32,
    battery_full_life_time: u32,
}
extern "system" {
    fn GetSystemPowerStatus(out: *mut SystemPowerStatus) -> i32;
}

#[tauri::command]
pub fn battery_get() -> Option<BatteryState> {
    let mut s = SystemPowerStatus::default();
    if unsafe { GetSystemPowerStatus(&mut s) } == 0 || s.battery_life_percent == 255 {
        return None;
    }
    Some(BatteryState {
        percent: s.battery_life_percent,
        ac_online: s.ac_line_status == 1,
        charging: s.battery_flag & 8 != 0,
        has_battery: s.battery_flag & 128 == 0,
    })
}

// ---------- volume (documented Core Audio) ----------
#[cfg(windows)]
mod audio {
    use super::VolumeState;
    use windows::core::Result;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    pub fn with_volume<T>(f: impl FnOnce(&IAudioEndpointVolume) -> Result<T> + Send + 'static) -> Option<T>
    where
        T: Send + 'static,
    {
        std::thread::spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
            f(&volume).ok()
        })
        .join()
        .ok()
        .flatten()
    }

    pub fn get() -> Option<VolumeState> {
        with_volume(|v| unsafe {
            Ok(VolumeState { level: v.GetMasterVolumeLevelScalar()?, muted: v.GetMute()?.as_bool() })
        })
    }
}

#[tauri::command]
pub fn volume_get() -> Option<VolumeState> {
    audio::get()
}

#[tauri::command]
pub fn volume_set(level: f32) -> bool {
    audio::with_volume(move |v| unsafe {
        v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), &windows::core::GUID::zeroed())
    })
    .is_some()
}

#[tauri::command]
pub fn volume_toggle_mute() -> bool {
    audio::with_volume(|v| unsafe {
        let muted = v.GetMute()?.as_bool();
        v.SetMute(!muted, &windows::core::GUID::zeroed())
    })
    .is_some()
}

/// Registers the documented IAudioEndpointVolumeCallback so external
/// volume changes (keyboard keys, SndVol) emit `notch://volume-changed`.
#[cfg(windows)]
pub fn start_volume_listener(app: AppHandle) {
    use windows::core::implement;
    use windows::Win32::Media::Audio::AUDIO_VOLUME_NOTIFICATION_DATA;
    use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl};

    #[implement(IAudioEndpointVolumeCallback)]
    struct Callback {
        app: AppHandle,
    }
    impl IAudioEndpointVolumeCallback_Impl for Callback_Impl {
        fn OnNotify(&self, pnotify: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
            unsafe {
                if let Some(d) = pnotify.as_ref() {
                    let _ = self.app.emit(
                        "notch://volume-changed",
                        VolumeState { level: d.fMasterVolume, muted: d.bMuted.as_bool() },
                    );
                }
            }
            Ok(())
        }
    }

    std::thread::spawn(move || unsafe {
        use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let Ok(enumerator) =
            CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
        else { return };
        let Ok(device) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) else { return };
        let Ok(volume) = device.Activate::<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume>(CLSCTX_ALL, None)
        else { return };
        let callback: IAudioEndpointVolumeCallback = Callback { app }.into();
        if volume.RegisterControlChangeNotify(&callback).is_err() { return; }
        // Keep the endpoint + callback alive for the process lifetime.
        loop { std::thread::sleep(std::time::Duration::from_secs(3600)); }
    });
}

// ---------- now playing (documented WinRT GSMTC) ----------
#[cfg(windows)]
mod media {
    use super::MediaState;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };

    fn base64(bytes: &[u8]) -> String {
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

    async fn pick_session(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
        source: &Option<String>,
    ) -> windows::core::Result<Option<windows::Media::Control::GlobalSystemMediaTransportControlsSession>> {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSession;
        if let Some(want) = source {
            if let Ok(sessions) = manager.GetSessions() {
                let count = sessions.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(s) = sessions.GetAt(i) {
                        if s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default() == *want {
                            return Ok(Some(s));
                        }
                    }
                }
            }
            return Ok(None);
        }
        Ok(manager.GetCurrentSession().ok())
    }

    pub async fn get(source: &Option<String>) -> Option<MediaState> {
        // WinRT objects are not Send, so no Box<dyn Future + Send> here.
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = pick_session(&manager, source).await? else { return Ok::<_, windows::core::Error>(None) };
            let props = session.TryGetMediaPropertiesAsync()?.await?;
            let playback = session.GetPlaybackInfo()?;
            let status = match playback.PlaybackStatus()? {
                Status::Playing => "playing",
                Status::Paused => "paused",
                Status::Stopped => "stopped",
                _ => "other",
            };
            let timeline = session.GetTimelineProperties()?;
            let ticks = |t: windows::Foundation::TimeSpan| t.Duration as f64 / 10_000_000.0;
            // Album art: thumbnail stream -> base64 data URL (CSP allows data: images).
            let mut art = None;
            if let Ok(reference) = props.Thumbnail() {
                if let Ok(stream) = reference.OpenReadAsync()?.await {
                    if let Ok(size) = stream.Size() {
                        if size > 0 && size <= 512_000 {
                            if let Ok(reader) = windows::Storage::Streams::DataReader::CreateDataReader(&stream) {
                                if let Ok(load_op) = reader.LoadAsync(size as u32) {
                                    if load_op.await.is_ok() {
                                        let mut buf = vec![0u8; size as usize];
                                        if reader.ReadBytes(&mut buf).is_ok() {
                                            let mime = stream.ContentType().map(|s| s.to_string()).unwrap_or_else(|_| "image/png".into());
                                            art = Some(format!("data:{mime};base64,{}", base64(&buf)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            let controls = playback.Controls();
            let shuffle = if controls.as_ref().map(|c| c.IsShuffleEnabled().unwrap_or(false)).unwrap_or(false) {
                playback.IsShuffleActive().ok().and_then(|r| r.Value().ok())
            } else { None };
            let repeat_supported = controls.as_ref().map(|c| c.IsRepeatEnabled().unwrap_or(false)).unwrap_or(false);
            let repeat = if repeat_supported {
                match playback.AutoRepeatMode().ok().and_then(|r| r.Value().ok()) {
                    Some(windows::Media::MediaPlaybackAutoRepeatMode::Track) => "track",
                    Some(windows::Media::MediaPlaybackAutoRepeatMode::List) => "list",
                    _ => "none",
                }
            } else { "none" };
            Ok(Some(MediaState {
                title: props.Title()?.to_string(),
                artist: props.Artist()?.to_string(),
                album: props.AlbumTitle()?.to_string(),
                app: session.SourceAppUserModelId()?.to_string(),
                status: status.into(),
                position_seconds: ticks(timeline.Position()?),
                duration_seconds: ticks(timeline.EndTime()?),
                art_data_url: art,
                shuffle,
                repeat: repeat.into(),
                repeat_supported,
            }))
        };
        inner.await.ok().flatten()
    }

    pub async fn sessions() -> Vec<super::MediaSessionInfo> {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let mut out = Vec::new();
            if let Ok(sessions) = manager.GetSessions() {
                let count = sessions.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(s) = sessions.GetAt(i) {
                        let title = match s.TryGetMediaPropertiesAsync() {
                            Ok(op) => op.await.map(|p| p.Title().map(|t| t.to_string()).unwrap_or_default()).unwrap_or_default(),
                            Err(_) => String::new(),
                        };
                        let status = s.GetPlaybackInfo()
                            .and_then(|pb| pb.PlaybackStatus())
                            .map(|st| format!("{st:?}").to_lowercase())
                            .unwrap_or_else(|_| "other".into());
                        out.push(super::MediaSessionInfo {
                            app: s.SourceAppUserModelId().map(|a| a.to_string()).unwrap_or_default(),
                            title,
                            status,
                        });
                    }
                }
            }
            Ok::<_, windows::core::Error>(out)
        };
        inner.await.unwrap_or_default()
    }

    pub async fn control(action: &str, source: &Option<String>) -> bool {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = pick_session(&manager, source).await? else { return Ok(false) };
            Ok::<_, windows::core::Error>(match action {
                "play" => session.TryPlayAsync()?.await?,
                "pause" => session.TryPauseAsync()?.await?,
                "toggle" => session.TryTogglePlayPauseAsync()?.await?,
                "next" => session.TrySkipNextAsync()?.await?,
                "previous" => session.TrySkipPreviousAsync()?.await?,
                _ => false,
            })
        };
        inner.await.unwrap_or(false)
    }

    pub async fn seek(position_seconds: f64, source: &Option<String>) -> bool {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = pick_session(&manager, source).await? else { return Ok(false) };
            // TryChangePlaybackPositionAsync takes a TimeSpan (100ns ticks).
            let ticks = (position_seconds * 10_000_000.0) as i64;
            Ok::<_, windows::core::Error>(session.TryChangePlaybackPositionAsync(ticks)?.await?)
        };
        inner.await.unwrap_or(false)
    }

    pub async fn set_shuffle(active: bool, source: &Option<String>) -> bool {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = pick_session(&manager, source).await? else { return Ok(false) };
            Ok::<_, windows::core::Error>(session.TryChangeShuffleActiveAsync(active)?.await?)
        };
        inner.await.unwrap_or(false)
    }

    pub async fn set_repeat(mode: &str, source: &Option<String>) -> bool {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = pick_session(&manager, source).await? else { return Ok(false) };
            let m = match mode {
                "track" => windows::Media::MediaPlaybackAutoRepeatMode::Track,
                "list" => windows::Media::MediaPlaybackAutoRepeatMode::List,
                _ => windows::Media::MediaPlaybackAutoRepeatMode::None,
            };
            Ok::<_, windows::core::Error>(session.TryChangeAutoRepeatModeAsync(m)?.await?)
        };
        inner.await.unwrap_or(false)
    }

    /// Manager-level change events -> `notch://media-changed` (frontend refetches).
    pub async fn watch(app: tauri::AppHandle) {
        use tauri::Emitter;
        use windows::Foundation::TypedEventHandler;
        let get_manager = async {
            GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await
        };
        let Ok(manager) = get_manager.await else { return };
        let h1 = app.clone();
        let _ = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| {
            let _ = h1.emit("notch://media-changed", ());
            Ok(())
        }));
        let h2 = app.clone();
        let _ = manager.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
            let _ = h2.emit("notch://media-changed", ());
            Ok(())
        }));
        // Hold the manager alive for the process lifetime.
        std::mem::forget(manager);
    }
}

// WinRT objects are not Send, so Tauri async commands cannot await them
// directly. Each call runs on a dedicated thread that block_on's locally.
fn with_media_apartment<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    std::thread::spawn(move || unsafe {
        // WinRT requires a COM apartment on the calling thread.
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );
        f()
    })
    .join()
    .ok()
}

#[tauri::command]
pub fn media_get(source: Option<String>) -> Option<MediaState> {
    with_media_apartment(move || tauri::async_runtime::block_on(media::get(&source))).flatten()
}

#[tauri::command]
pub fn media_sessions() -> Vec<MediaSessionInfo> {
    with_media_apartment(|| tauri::async_runtime::block_on(media::sessions())).unwrap_or_default()
}

#[tauri::command]
pub fn media_control(action: String, source: Option<String>) -> bool {
    with_media_apartment(move || tauri::async_runtime::block_on(media::control(&action, &source)))
        .unwrap_or(false)
}

#[tauri::command]
pub fn media_seek(position_seconds: f64, source: Option<String>) -> bool {
    with_media_apartment(move || tauri::async_runtime::block_on(media::seek(position_seconds, &source)))
        .unwrap_or(false)
}

#[tauri::command]
pub fn media_set_shuffle(active: bool, source: Option<String>) -> bool {
    with_media_apartment(move || tauri::async_runtime::block_on(media::set_shuffle(active, &source)))
        .unwrap_or(false)
}

#[tauri::command]
pub fn media_set_repeat(mode: String, source: Option<String>) -> bool {
    with_media_apartment(move || tauri::async_runtime::block_on(media::set_repeat(&mode, &source)))
        .unwrap_or(false)
}

// ---------- privacy (consent store registry; see ASSUMPTIONS A8) ----------
#[cfg(windows)]
mod privacy {
    use super::PrivacyUse;

    type Hkey = isize;
    const HKEY_CURRENT_USER: Hkey = 0x8000_0001u32 as i32 as isize;
    const KEY_READ: u32 = 0x20019;
    const KEY_ENUMERATE_SUB_KEYS: u32 = 0x0008;
    const REG_NOTIFY_CHANGE_NAME: u32 = 0x1;
    const REG_NOTIFY_CHANGE_LAST_SET: u32 = 0x4;

    extern "system" {
        fn RegOpenKeyExW(key: Hkey, sub: *const u16, options: u32, access: u32, out: *mut Hkey) -> i32;
        fn RegCloseKey(key: Hkey) -> i32;
        fn RegEnumKeyExW(key: Hkey, index: u32, name: *mut u16, name_len: *mut u32, reserved: *mut u32, class: *mut u16, class_len: *mut u32, last_write: *mut u64) -> i32;
        fn RegQueryValueExW(key: Hkey, name: *const u16, reserved: *mut u32, typ: *mut u32, data: *mut u8, data_len: *mut u32) -> i32;
        fn RegNotifyChangeKeyValue(key: Hkey, watch_subtree: i32, filter: u32, event: isize, asynchronous: i32) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain([0]).collect() }

    fn open(path: &str) -> Option<Hkey> {
        let mut h: Hkey = 0;
        let ok = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(path).as_ptr(), 0, KEY_READ | KEY_ENUMERATE_SUB_KEYS, &mut h) };
        (ok == 0).then_some(h)
    }

    fn subkeys(key: Hkey) -> Vec<String> {
        let mut names = Vec::new();
        for i in 0..512u32 {
            let mut buf = [0u16; 512];
            let mut len = buf.len() as u32;
            let rc = unsafe { RegEnumKeyExW(key, i, buf.as_mut_ptr(), &mut len, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
            if rc != 0 { break; }
            names.push(String::from_utf16_lossy(&buf[..len as usize]));
        }
        names
    }

    fn qword(key: Hkey, name: &str) -> u64 {
        let mut buf = [0u8; 8];
        let mut len = buf.len() as u32;
        let rc = unsafe { RegQueryValueExW(key, wide(name).as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), buf.as_mut_ptr(), &mut len) };
        if rc == 0 && len >= 8 { u64::from_le_bytes(buf) } else { 0 }
    }

    fn in_use(key: Hkey) -> bool {
        qword(key, "LastUsedTimeStart") != 0 && qword(key, "LastUsedTimeStop") == 0
    }

    fn display_name(raw: &str, nonpackaged: bool) -> String {
        if nonpackaged {
            let path = raw.replace('#', "\\");
            path.rsplit('\\').next().unwrap_or(&path).to_string()
        } else {
            raw.split('!').next().unwrap_or(raw).to_string()
        }
    }

    const STORES: [(&str, &str); 3] = [
        ("microphone", "microphone"),
        ("camera", "webcam"),
        ("location", "location"),
    ];

    pub fn scan() -> Vec<PrivacyUse> {
        let mut out = Vec::new();
        for (kind, store) in STORES {
            let base = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{store}");
            let Some(root) = open(&base) else { continue };
            for name in subkeys(root) {
                if name == "NonPackaged" {
                    if let Some(np) = open(&format!(r"{base}\NonPackaged")) {
                        for app in subkeys(np) {
                            if let Some(k) = open(&format!(r"{base}\NonPackaged\{app}")) {
                                if in_use(k) { out.push(PrivacyUse { kind: kind.into(), app: display_name(&app, true) }); }
                                unsafe { RegCloseKey(k) };
                            }
                        }
                        unsafe { RegCloseKey(np) };
                    }
                } else if let Some(k) = open(&format!(r"{base}\{name}")) {
                    if in_use(k) { out.push(PrivacyUse { kind: kind.into(), app: display_name(&name, false) }); }
                    unsafe { RegCloseKey(k) };
                }
            }
            unsafe { RegCloseKey(root) };
        }
        out
    }

    /// Blocks on RegNotifyChangeKeyValue per store; emits on any change.
    pub fn watch(app: tauri::AppHandle) {
        use tauri::Emitter;
        for (_, store) in STORES {
            let app = app.clone();
            std::thread::spawn(move || {
                let base = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{store}");
                let Some(root) = open(&base) else { return };
                loop {
                    let rc = unsafe {
                        RegNotifyChangeKeyValue(root, 1, REG_NOTIFY_CHANGE_NAME | REG_NOTIFY_CHANGE_LAST_SET, 0, 0)
                    };
                    if rc != 0 { break; }
                    let _ = app.emit("notch://privacy-changed", ());
                }
                unsafe { RegCloseKey(root) };
            });
        }
    }
}

#[tauri::command]
pub fn privacy_get() -> Vec<PrivacyUse> {
    privacy::scan()
}

// ---------- notch hover (cursor tracking) ----------
// The collapsed notch is click-through (setIgnoreCursorEvents), so the
// WebView never sees the mouse over the idle clock/eyes. This watcher
// polls the OS cursor against the current pill rectangle (reported by
// the frontend on every view change) and emits enter/leave edges.
static HOVER_REGION: std::sync::Mutex<(f64, f64)> = std::sync::Mutex::new((156.0, 38.0));

#[tauri::command]
pub fn set_hover_region(width: f64, height: f64) {
    if let Ok(mut r) = HOVER_REGION.lock() { *r = (width, height); }
}

#[cfg(windows)]
fn start_cursor_watch(app: AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        #[repr(C)]
        struct Point { x: i32, y: i32 }
        extern "system" { fn GetCursorPos(p: *mut Point) -> i32; }
        let mut hovered = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let Some(window) = app.get_webview_window("main") else { continue };
            let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else { continue };
            let scale = window.scale_factor().unwrap_or(1.0);
            let (w_css, h_css) = HOVER_REGION.lock().map(|r| *r).unwrap_or((156.0, 38.0));
            let pill_w = w_css * scale;
            let pill_h = h_css * scale;
            let pill_x = pos.x as f64 + (size.width as f64 - pill_w) / 2.0;
            let pill_y = pos.y as f64;
            let mut pt = Point { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut pt) } == 0 { continue; }
            // Hysteresis: 10px slack to leave, so the edge doesn't flicker.
            let slack = if hovered { 10.0 } else { 0.0 };
            let inside = (pt.x as f64) >= pill_x - slack && (pt.x as f64) <= pill_x + pill_w + slack
                && (pt.y as f64) >= pill_y - slack && (pt.y as f64) <= pill_y + pill_h + slack;
            if inside != hovered {
                hovered = inside;
                let _ = app.emit("notch://notch-hover", hovered);
            }
        }
    });
}

// ---------- screen-cover quiet (fullscreen + maximized apps) ----------
// When a foreign app covers the notch's monitor (fullscreen) or its
// work area (a maximized window — 1.2.6: users read a maximized app as
// "the app took the screen", and the notch kept sitting on top of it),
// the notch steps aside: it fades out (the frontend gets the event
// first), the window hides completely, and it returns when no app
// covers the screen any more. Shell surfaces (desktop, taskbar) never
// count, and a covering app on a *different* monitor never hides the
// notch. The check is pure rectangle maths so it can be unit-tested;
// the watcher below only feeds it live Win32 values.

/// Axis-aligned rectangle in virtual-screen pixels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FsRect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

/// True when `window` covers every edge of `monitor`. A 2px tolerance
/// keeps borderless windows that stop a pixel short from flickering.
/// (Used for the work area too: a maximized window overshoots that
/// rectangle by its invisible frame on the sides and top.)
pub fn rect_covers_monitor(window: FsRect, monitor: FsRect) -> bool {
    const TOL: i32 = 2;
    window.left <= monitor.left + TOL && window.top <= monitor.top + TOL
        && window.right >= monitor.right - TOL && window.bottom >= monitor.bottom - TOL
}

/// Window classes that own the desktop/taskbar. They cover the monitor
/// by design and must never read as "an app went fullscreen".
pub fn is_shell_surface(class: &str) -> bool {
    matches!(class,
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        | "Windows.UI.Core.CoreWindow")
}

/// Pure decision for one enumerated top-level window: visible, not
/// minimized, not ours, not a shell surface, and either fullscreen
/// (covers every edge of the notch's monitor) or maximized
/// (`IsZoomed`, covering every edge of the monitor's work area — a
/// maximized window stops at the taskbar, so the fullscreen test
/// alone never sees it). A window that merely happens to be *sized*
/// like the work area without being zoomed does not count, so
/// snapping/resizing windows by hand never hides the notch.
/// Unit-tested below; the Win32 watcher only feeds it live values.
pub fn is_cover_candidate(
    visible: bool,
    minimized: bool,
    zoomed: bool,
    own_window: bool,
    shell: bool,
    window: FsRect,
    monitor: FsRect,
    work: FsRect,
) -> bool {
    visible && !minimized && !own_window && !shell
        && (rect_covers_monitor(window, monitor)
            || (zoomed && rect_covers_monitor(window, work)))
}

#[cfg(windows)]
struct FsEnumSearch {
    monitor: FsRect,
    work: FsRect,
    ours: isize,
    our_pid: u32,
    found: bool,
}

#[cfg(windows)]
extern "system" fn fs_enum_cb(hwnd: isize, lparam: isize) -> i32 {
    #[repr(C)]
    #[derive(Default)]
    struct WinRect { left: i32, top: i32, right: i32, bottom: i32 }
    extern "system" {
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
        fn IsZoomed(hwnd: isize) -> i32;
        fn GetWindowRect(hwnd: isize, out: *mut WinRect) -> i32;
        fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetWindowLongW(hwnd: isize, index: i32) -> isize;
    }
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
    let search = unsafe { &mut *(lparam as *mut FsEnumSearch) };
    if hwnd == search.ours {
        return 1;
    }
    let visible = unsafe { IsWindowVisible(hwnd) } != 0;
    let minimized = unsafe { IsIconic(hwnd) } != 0;
    let zoomed = unsafe { IsZoomed(hwnd) } != 0;
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == 0 || pid == search.our_pid {
        return 1;
    }
    // Tool windows (tray helpers, floating palettes) never own the screen.
    if unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW != 0 {
        return 1;
    }
    let mut buf = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), 64) };
    let class = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
    let mut wr = WinRect::default();
    if unsafe { GetWindowRect(hwnd, &mut wr) } == 0 {
        return 1;
    }
    let rect = FsRect { left: wr.left, top: wr.top, right: wr.right, bottom: wr.bottom };
    if is_cover_candidate(visible, minimized, zoomed, false, is_shell_surface(&class), rect, search.monitor, search.work) {
        search.found = true;
        return 0; // stop enumerating: one covering app is enough
    }
    1
}

/// True when ANY visible top-level window (not just the foreground
/// one) is fullscreen on `monitor` or maximized over its `work` area.
/// The old foreground-only check missed borderless/exclusive-fullscreen
/// apps that were not the foreground window at the instant of the
/// poll — a video or game running fullscreen behind a small floating
/// window, an app that went fullscreen while focus sat elsewhere, and
/// transitions where the foreground briefly read as the desktop.
#[cfg(windows)]
fn any_cover_on_monitor(ours: isize, monitor: FsRect, work: FsRect) -> bool {
    extern "system" {
        fn EnumWindows(proc_: extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
        fn GetCurrentProcessId() -> u32;
    }
    let mut search = FsEnumSearch {
        monitor,
        work,
        ours,
        our_pid: unsafe { GetCurrentProcessId() },
        found: false,
    };
    unsafe { EnumWindows(fs_enum_cb, &mut search as *mut FsEnumSearch as isize) };
    search.found
}

/// User preference (Settings > "Hide when an app is full screen or
/// maximized"), pushed from the frontend. The command/event names keep
/// their 1.1.0 "fullscreen" wording — they are an IPC contract with
/// the frontend — but since 1.2.6 the watcher also covers maximized
/// windows. Defaults to on.
static FULLSCREEN_HIDE_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
pub fn set_fullscreen_hide(enabled: bool) {
    FULLSCREEN_HIDE_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(windows)]
fn start_fullscreen_watch(app: AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        type Hwnd = isize;
        #[repr(C)]
        #[derive(Default, Clone, Copy)]
        struct Rect { left: i32, top: i32, right: i32, bottom: i32 }
        #[repr(C)]
        struct MonitorInfo { size: u32, monitor: Rect, work: Rect, flags: u32 }
        extern "system" {
            fn MonitorFromWindow(hwnd: Hwnd, flags: u32) -> isize;
            fn GetMonitorInfoW(monitor: isize, info: *mut MonitorInfo) -> i32;
        }
        const MONITOR_DEFAULTTONEAREST: u32 = 2;
        let mut hidden = false;
        // Showing again needs three clear readings (~750ms at the 250ms
        // cadence), so alt-tabbing between two covering apps — or a
        // game bouncing through a resolution change — does not flash
        // the notch in between. Hiding is immediate on the first hit.
        let mut clear_streak: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let Some(window) = app.get_webview_window("main") else { continue };
            let enabled = FULLSCREEN_HIDE_ENABLED.load(std::sync::atomic::Ordering::Relaxed);
            let mut covered = false;
            if enabled {
                let ours = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
                if ours != 0 {
                    // The notch's own monitor, and only that monitor:
                    // a covering app anywhere else never hides it,
                    // and any app covering *here* always does. The
                    // work area rides along so a maximized window
                    // (which stops at the taskbar) counts too.
                    let mon = unsafe { MonitorFromWindow(ours, MONITOR_DEFAULTTONEAREST) };
                    let mut mi = MonitorInfo { size: std::mem::size_of::<MonitorInfo>() as u32, monitor: Rect::default(), work: Rect::default(), flags: 0 };
                    if mon != 0 && unsafe { GetMonitorInfoW(mon, &mut mi) } != 0 {
                        let m = mi.monitor;
                        let w = mi.work;
                        covered = any_cover_on_monitor(
                            ours,
                            FsRect { left: m.left, top: m.top, right: m.right, bottom: m.bottom },
                            FsRect { left: w.left, top: w.top, right: w.right, bottom: w.bottom },
                        );
                    }
                }
            }
            if covered && !hidden {
                hidden = true;
                clear_streak = 0;
                // Let the frontend retract into the top edge first.
                let _ = app.emit("notch://fullscreen-changed", true);
                std::thread::sleep(std::time::Duration::from_millis(240));
                let _ = window.hide();
            } else if !covered && hidden {
                if !enabled {
                    hidden = false;
                    clear_streak = 0;
                    let _ = window.show();
                    let _ = app.emit("notch://fullscreen-changed", false);
                } else {
                    clear_streak += 1;
                    if clear_streak >= 3 {
                        hidden = false;
                        clear_streak = 0;
                        let _ = window.show();
                        let _ = app.emit("notch://fullscreen-changed", false);
                    }
                }
            } else {
                clear_streak = 0;
            }
        }
    });
}

#[cfg(test)]
mod fullscreen_tests {
    use super::{is_cover_candidate, is_shell_surface, rect_covers_monitor, FsRect};

    const MON: FsRect = FsRect { left: 0, top: 0, right: 1920, bottom: 1080 };
    // Same monitor with a 48px taskbar along the bottom edge.
    const WORK: FsRect = FsRect { left: 0, top: 0, right: 1920, bottom: 1032 };
    // A maximized window: overshoots the work area by its invisible
    // frame on three sides and stops exactly at the taskbar.
    const MAXIMIZED: FsRect = FsRect { left: -8, top: -8, right: 1928, bottom: 1032 };

    #[test]
    fn exact_and_overshooting_windows_cover() {
        assert!(rect_covers_monitor(MON, MON));
        // Maximized windows overshoot by their invisible frame.
        assert!(rect_covers_monitor(FsRect { left: -8, top: -8, right: 1928, bottom: 1088 }, MON));
    }

    #[test]
    fn borderless_a_pixel_short_still_covers() {
        assert!(rect_covers_monitor(FsRect { left: 0, top: 0, right: 1919, bottom: 1079 }, MON));
    }

    #[test]
    fn floating_and_half_windows_do_not_cover() {
        assert!(!rect_covers_monitor(FsRect { left: 100, top: 100, right: 900, bottom: 700 }, MON));
        assert!(!rect_covers_monitor(FsRect { left: 0, top: 0, right: 960, bottom: 1080 }, MON));
        // Covers width but leaves the taskbar strip: not fullscreen.
        assert!(!rect_covers_monitor(FsRect { left: 0, top: 0, right: 1920, bottom: 1032 }, MON));
    }

    #[test]
    fn second_monitor_uses_its_own_origin() {
        let mon2 = FsRect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        assert!(rect_covers_monitor(mon2, mon2));
        assert!(!rect_covers_monitor(MON, mon2));
    }

    #[test]
    fn candidate_needs_visible_unminimized_foreign_cover() {
        // A fullscreen app that is not the foreground window still counts.
        assert!(is_cover_candidate(true, false, false, false, false, MON, MON, WORK));
        // Minimized away, hidden, our own window, or the shell: never.
        assert!(!is_cover_candidate(true, true, false, false, false, MON, MON, WORK));
        assert!(!is_cover_candidate(false, false, false, false, false, MON, MON, WORK));
        assert!(!is_cover_candidate(true, false, false, true, false, MON, MON, WORK));
        assert!(!is_cover_candidate(true, false, false, false, true, MON, MON, WORK));
        // Covering a *different* monitor does not hide this notch.
        let mon2 = FsRect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        let work2 = FsRect { left: 1920, top: 0, right: 3840, bottom: 1032 };
        assert!(!is_cover_candidate(true, false, false, false, false, mon2, MON, WORK));
        assert!(is_cover_candidate(true, false, false, false, false, mon2, mon2, work2));
    }

    #[test]
    fn maximized_window_covers_the_work_area_not_the_monitor() {
        // The 1.2.6 fix: a maximized window never reaches the
        // monitor's bottom edge (the taskbar lives there), so the old
        // fullscreen-only test missed it entirely…
        assert!(!rect_covers_monitor(MAXIMIZED, MON));
        // …but zoomed + covering the work area is a cover.
        assert!(is_cover_candidate(true, false, true, false, false, MAXIMIZED, MON, WORK));
        // The same rectangle without the zoomed state is just a
        // window sized by hand: it must not hide the notch.
        assert!(!is_cover_candidate(true, false, false, false, false, MAXIMIZED, MON, WORK));
        // A maximized window that is minimized away no longer covers.
        assert!(!is_cover_candidate(true, true, true, false, false, MAXIMIZED, MON, WORK));
        // Maximized on the *other* monitor: not this notch's problem.
        let mon2 = FsRect { left: 1920, top: 0, right: 3840, bottom: 1080 };
        let max2 = FsRect { left: 1912, top: -8, right: 3848, bottom: 1032 };
        assert!(!is_cover_candidate(true, false, true, false, false, max2, MON, WORK));
        assert!(is_cover_candidate(true, false, true, false, false, max2, mon2,
            FsRect { left: 1920, top: 0, right: 3840, bottom: 1032 }));
        // Half-snapped windows are not zoomed and cover only half the
        // work area, so they never count either way.
        let half = FsRect { left: 0, top: 0, right: 960, bottom: 1032 };
        assert!(!is_cover_candidate(true, false, true, false, false, half, MON, WORK));
    }

    #[test]
    fn shell_surfaces_never_count() {
        for c in ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"] {
            assert!(is_shell_surface(c), "{c}");
        }
        for c in ["Chrome_WidgetWin_1", "CabinetWClass", "UnrealWindow", ""] {
            assert!(!is_shell_surface(c), "{c}");
        }
    }
}

// ---------- displays (multi-monitor picker) ----------
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    primary: bool,
}

#[tauri::command]
pub fn list_displays(app: AppHandle) -> Vec<DisplayInfo> {
    use tauri::Manager;
    let primary = app.primary_monitor().ok().flatten();
    app.available_monitors().unwrap_or_default().iter().enumerate().map(|(index, m)| {
        let size = m.size();
        let is_primary = primary.as_ref().is_some_and(|p| p.position() == m.position() && p.size() == m.size());
        DisplayInfo {
            index,
            name: m.name().cloned().unwrap_or_else(|| format!("Display {}", index + 1)),
            width: size.width,
            height: size.height,
            primary: is_primary,
        }
    }).collect()
}

#[tauri::command]
pub fn move_to_display(app: AppHandle, index: usize) -> bool {
    use tauri::Manager;
    let monitors = app.available_monitors().unwrap_or_default();
    let (Some(m), Some(window)) = (monitors.get(index), app.get_webview_window("main")) else { return false };
    let Ok(size) = window.outer_size() else { return false };
    let (pos, msize) = (m.position(), m.size());
    let x = pos.x + (msize.width as i32 - size.width as i32) / 2;
    // Top-center of the chosen display; the notch hugs its top edge (y=0).
    window.set_position(tauri::PhysicalPosition::new(x, pos.y)).is_ok()
}

pub fn start_native_listeners(app: AppHandle) {
    #[cfg(windows)]
    {
        start_volume_listener(app.clone());
        start_cursor_watch(app.clone());
        start_fullscreen_watch(app.clone());
        privacy::watch(app.clone());
        let handle = app.clone();
        std::thread::spawn(move || unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
            tauri::async_runtime::block_on(media::watch(handle));
        });
    }
    #[cfg(not(windows))]
    let _ = app;
}

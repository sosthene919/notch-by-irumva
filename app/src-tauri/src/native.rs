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

    pub async fn get() -> Option<MediaState> {
        // WinRT objects are not Send, so no Box<dyn Future + Send> here.
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let Some(session) = manager.GetCurrentSession().ok() else { return Ok::<_, windows::core::Error>(None) };
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
            Ok(Some(MediaState {
                title: props.Title()?.to_string(),
                artist: props.Artist()?.to_string(),
                album: props.AlbumTitle()?.to_string(),
                app: session.SourceAppUserModelId()?.to_string(),
                status: status.into(),
                position_seconds: ticks(timeline.Position()?),
                duration_seconds: ticks(timeline.EndTime()?),
                art_data_url: art,
            }))
        };
        inner.await.ok().flatten()
    }

    pub async fn control(action: &str) -> bool {
        let inner = async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;
            let session = manager.GetCurrentSession()?;
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
pub fn media_get() -> Option<MediaState> {
    with_media_apartment(|| tauri::async_runtime::block_on(media::get())).flatten()
}

#[tauri::command]
pub fn media_control(action: String) -> bool {
    with_media_apartment(move || tauri::async_runtime::block_on(media::control(&action)))
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

pub fn start_native_listeners(app: AppHandle) {
    #[cfg(windows)]
    {
        start_volume_listener(app.clone());
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

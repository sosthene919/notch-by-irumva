/**
 * Native bridge — the only module that talks to Rust commands/events.
 * Every function degrades to null/no-op outside Tauri or on error, so
 * providers stay testable with fake sources and the UI never crashes
 * when a Windows API is unavailable on a given machine.
 */
import { isTauri } from './window';

export interface MediaState {
  title: string; artist: string; album: string; app: string;
  status: 'playing' | 'paused' | 'stopped' | 'other';
  positionSeconds: number; durationSeconds: number;
  artDataUrl?: string | null;
  shuffle?: boolean | null;
  repeat?: string;
  repeatSupported?: boolean;
}
export interface MediaSessionInfo { app: string; title: string; status: string }
export interface BatteryState { percent: number; acOnline: boolean; charging: boolean; hasBattery: boolean }
export interface VolumeState { level: number; muted: boolean }
export interface PrivacyUse { kind: 'microphone' | 'camera' | 'location'; app: string }

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch { return null; }
}

type Unlisten = () => void;
async function listen(event: string, cb: () => void): Promise<Unlisten> {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen(event, () => cb());
  } catch { return () => {}; }
}

import type { SecureBridge } from '../security/secureSettings';

export const nativeSecureBridge: SecureBridge = {
  settingsLoad: () => invoke<string | null>('settings_load'),
  settingsSave: async (s) => (await invoke<boolean>('settings_save', { plaintext: s })) ?? false,
  secretSet: async (k, v) => (await invoke<boolean>('secret_set', { key: k, value: v })) ?? false,
  secretGet: (k) => invoke<string | null>('secret_get', { key: k }),
  secretDelete: async (k) => (await invoke<boolean>('secret_delete', { key: k })) ?? false,
  dataExport: () => invoke<string | null>('data_export'),
  dataErase: async () => (await invoke<boolean>('data_erase')) ?? false,
};

export async function onSessionLock(cb: (locked: boolean) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const u1 = await listen('notch://session-lock', () => cb(true));
    const u2 = await listen('notch://session-unlock', () => cb(false));
    return () => { u1(); u2(); };
  } catch { return () => {}; }
}

export interface WindowsNotification {
  id: number; app: string; title: string; body: string; arrivalMs: number;
}

async function listenPayload<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<T>(event, (e) => cb(e.payload));
  } catch { return () => {}; }
}

/** New Windows app toasts (WhatsApp, Chrome, Mail, …) from the Rust
 *  watcher over the local notification-center database. */
export function onWindowsNotification(cb: (n: WindowsNotification) => void): Promise<() => void> {
  return listenPayload('notch://windows-notification', cb);
}

/** Cursor entered/left the pill rectangle (Rust watcher; works even
 *  while the collapsed notch is click-through). */
export function onNotchHover(cb: (entered: boolean) => void): Promise<() => void> {
  return listenPayload<boolean>('notch://notch-hover', cb);
}

/** A foreign fullscreen app on the notch's monitor appeared (true) or
 *  left (false). Rust fades the frontend out, then hides the window;
 *  on false the window is already back and the frontend fades in. */
export function onFullscreenChanged(cb: (hidden: boolean) => void): Promise<() => void> {
  return listenPayload<boolean>('notch://fullscreen-changed', cb);
}

/** Fullscreen auto-hide preference, pushed to the Rust watcher. */
export const fullscreenNative = {
  setEnabled: async (enabled: boolean) => {
    await invoke<boolean>('set_fullscreen_hide', { enabled });
  },
};

import type { BtDevice } from '../core/types';

/** Connected Bluetooth devices, re-emitted by Rust when the list changes. */
export function onBluetoothDevices(cb: (devices: BtDevice[]) => void): Promise<() => void> {
  return listenPayload<BtDevice[]>('notch://bluetooth-devices', cb);
}

export interface StartupInfo { safeMode: boolean; crashCount: number; rollbackAvailable: boolean; version: string }
export interface AppInfo { version: string; changelog: string }

/** Release engineering: crash state, rollback, backups, autostart,
 *  diagnostics. All local; nothing here touches the network. */
export const releaseNative = {
  startupInfo: () => invoke<StartupInfo>('get_startup_info'),
  resetCrashState: async () => (await invoke<boolean>('reset_crash_state')) ?? false,
  performRollback: () => invoke<string>('perform_rollback'),
  dataBackup: (label: string) => invoke<string | null>('data_backup', { label }),
  autostartGet: async () => (await invoke<boolean>('autostart_get')) ?? false,
  autostartSet: async (enabled: boolean) => (await invoke<boolean>('autostart_set', { enabled })) ?? false,
  appInfo: () => invoke<AppInfo>('app_info'),
  exportDiagnostics: (summary: string) => invoke<string | null>('export_diagnostics', { summary }),
  dataLocation: () => invoke<string | null>('data_location'),
  openDataFolder: async () => (await invoke<boolean>('open_data_folder')) ?? false,
};

/** A second launch asks the running instance to open Settings. */
export function onOpenSettings(cb: () => void): Promise<() => void> {
  return listenPayload('notch://open-settings', cb);
}

/** Settings popup -> island sync. The popup saves a prefs patch; the
 *  main window (which owns the providers and the island) applies it. */
export async function emitPrefsPatch(patch: Record<string, unknown>): Promise<void> {
  if (!isTauri) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('notch://prefs-patch', patch);
  } catch { /* main window not listening yet; disk copy still saved */ }
}

export function onPrefsPatch(cb: (patch: Record<string, unknown>) => void): Promise<() => void> {
  return listenPayload<Record<string, unknown>>('notch://prefs-patch', cb);
}

/** Manual lock toggle from the Settings popup, applied by the island. */
export async function emitManualLock(locked: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('notch://manual-lock', locked);
  } catch { /* island not listening */ }
}

export function onManualLock(cb: (locked: boolean) => void): Promise<() => void> {
  return listenPayload<boolean>('notch://manual-lock', cb);
}

export interface TakeoverStatus { active: boolean; bannersEnabled: boolean }

/** Notification takeover: while active, Rust silences Windows toast
 *  banners (Focus Assist's global switch) and the notch shows them. */
export const takeoverNative = {
  get: () => invoke<TakeoverStatus>('takeover_get'),
  set: (enabled: boolean) => invoke<TakeoverStatus>('takeover_set', { enabled }),
};

export interface PerfInfo { workingSetMb: number; privateMb: number }

/** Diagnostics only: process memory reported by the Rust shell. */
export const diagnosticsNative = {
  perf: () => invoke<PerfInfo>('perf_info'),
};

/** Global hotkey via the official Tauri global-shortcut plugin.
 *  Returns false when registration fails (e.g. another app owns it). */
export async function registerGlobalHotkey(shortcut: string, cb: () => void): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const mod = await import('@tauri-apps/plugin-global-shortcut');
    await mod.unregisterAll().catch(() => {});
    await mod.register(shortcut, (event) => { if (event.state === 'Pressed') cb(); });
    return true;
  } catch { return false; }
}

export interface PathInfo { name: string; size: number; isDir: boolean }
export interface DisplayInfo { index: number; name: string; width: number; height: number; primary: boolean }

export const shelfNative = {
  pathInfo: (path: string) => invoke<PathInfo>('path_info', { path }),
  launchPath: async (path: string) => (await invoke<boolean>('launch_path', { path })) ?? false,
  revealPath: async (path: string) => (await invoke<boolean>('reveal_path', { path })) ?? false,
  copyText: async (text: string) => (await invoke<boolean>('clipboard_set_text', { text })) ?? false,
};

/** Lyrics: LRCLib lookup runs in Rust (descriptive User-Agent, 5 s
 *  timeout, rate-limited). Only title, artist, album and duration are
 *  sent. Results cache to local files on this PC. */
import type { LookupRaw } from '../media/lyrics';
export const lyricsNative = {
  lookup: (trackName: string, artistName: string, albumName: string, durationSec: number) =>
    invoke<LookupRaw>('lyrics_lookup', { trackName, artistName, albumName, durationSec }),
  cacheGet: (key: string) => invoke<string | null>('lyrics_cache_get', { key }),
  cacheSet: async (key: string, text: string) => (await invoke<boolean>('lyrics_cache_set', { key, text })) ?? false,
};

export const displayNative = {
  list: () => invoke<DisplayInfo[]>('list_displays'),
  moveTo: (index: number) => invoke<boolean>('move_to_display', { index }),
};

export const native = {
  mediaGet: (source?: string | null) => invoke<MediaState | null>('media_get', { source: source ?? null }),
  mediaSessions: () => invoke<MediaSessionInfo[]>('media_sessions'),
  mediaControl: async (action: 'play' | 'pause' | 'toggle' | 'next' | 'previous', source?: string | null): Promise<boolean> =>
    (await invoke<boolean>('media_control', { action, source: source ?? null })) ?? false,
  mediaSeek: async (positionSeconds: number, source?: string | null): Promise<boolean> =>
    (await invoke<boolean>('media_seek', { positionSeconds, source: source ?? null })) ?? false,
  mediaSetShuffle: async (active: boolean, source?: string | null): Promise<boolean> =>
    (await invoke<boolean>('media_set_shuffle', { active, source: source ?? null })) ?? false,
  mediaSetRepeat: async (mode: string, source?: string | null): Promise<boolean> =>
    (await invoke<boolean>('media_set_repeat', { mode, source: source ?? null })) ?? false,
  onMediaChanged: (cb: () => void) => listen('notch://media-changed', cb),
  batteryGet: () => invoke<BatteryState | null>('battery_get'),
  volumeGet: () => invoke<VolumeState | null>('volume_get'),
  volumeSet: (level: number) => invoke<boolean>('volume_set', { level }),
  volumeToggleMute: () => invoke<boolean>('volume_toggle_mute'),
  onVolumeChanged: (cb: () => void) => listen('notch://volume-changed', cb),
  privacyGet: () => invoke<PrivacyUse[]>('privacy_get'),
  onPrivacyChanged: (cb: () => void) => listen('notch://privacy-changed', cb),
};

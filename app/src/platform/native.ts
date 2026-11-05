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
}
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

export const native = {
  mediaGet: () => invoke<MediaState | null>('media_get'),
  mediaControl: async (action: 'play' | 'pause' | 'toggle' | 'next' | 'previous'): Promise<boolean> =>
    (await invoke<boolean>('media_control', { action })) ?? false,
  onMediaChanged: (cb: () => void) => listen('notch://media-changed', cb),
  batteryGet: () => invoke<BatteryState | null>('battery_get'),
  volumeGet: () => invoke<VolumeState | null>('volume_get'),
  volumeSet: (level: number) => invoke<boolean>('volume_set', { level }),
  volumeToggleMute: () => invoke<boolean>('volume_toggle_mute'),
  onVolumeChanged: (cb: () => void) => listen('notch://volume-changed', cb),
  privacyGet: () => invoke<PrivacyUse[]>('privacy_get'),
  onPrivacyChanged: (cb: () => void) => listen('notch://privacy-changed', cb),
};

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

import type { SecureBridge } from '../security/secureSettings';

export const nativeSecureBridge: SecureBridge = {
  settingsLoad: () => invoke<string | null>('settings_load'),
  settingsSave: async (s) => (await invoke<boolean>('settings_save', { plaintext: s })) ?? false,
  secretSet: async (k, v) => (await invoke<boolean>('secret_set', { key: k, value: v })) ?? false,
  secretGet: (k) => invoke<string | null>('secret_get', { key: k }),
  secretDelete: async (k) => (await invoke<boolean>('secret_delete', { key: k })) ?? false,
  helloVerify: async (message) =>
    (await invoke<{ ok: boolean; status: string }>('hello_verify', { message })) ?? { ok: false, status: 'unavailable' },
  pairingStart: () => invoke<string | null>('pairing_start'),
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

export interface OpenCodeServerStatus { started: boolean; alreadyRunning: boolean; password: string | null; error: string | null }
export interface IncomingApproval {
  requestId: string; source: 'bridge'; agent: string; action: string;
  target?: string; cwd?: string; actionHash: string; timeoutMs: number;
}

async function listenPayload<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<T>(event, (e) => cb(e.payload));
  } catch { return () => {}; }
}

export const devhubNative = {
  opencodeServerStart: (directory: string) => invoke<OpenCodeServerStatus>('opencode_server_start', { directory }),
  opencodeServerPassword: () => invoke<string | null>('opencode_server_password'),
  approvalRespond: async (requestId: string, actionHash: string, decision: string) =>
    (await invoke<boolean>('approval_respond', { requestId, actionHash, decision })) ?? false,
  reviewRespond: async (reviewId: string, decision: string, comment: string) =>
    (await invoke<boolean>('review_respond', { reviewId, decision, comment })) ?? false,
  onApprovalRequest: (cb: (a: IncomingApproval) => void) => listenPayload('notch://approval-request', cb),
  onReviewPropose: (cb: (raw: unknown) => void) => listenPayload('notch://review-propose', cb),
};

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

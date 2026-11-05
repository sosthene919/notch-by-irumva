import type { ActivityProvider } from '../core/activityManager';
import type { Activity } from '../core/types';
import { native, type VolumeState } from '../platform/native';

export interface VolumeSource {
  get(): Promise<VolumeState | null>;
  set(level: number): Promise<boolean>;
  toggleMute(): Promise<boolean>;
  subscribe(cb: (v: VolumeState) => void): Promise<() => void> | (() => void);
}

export const nativeVolumeSource: VolumeSource = {
  get: () => native.volumeGet(),
  set: async (l) => (await native.volumeSet(l)) ?? false,
  toggleMute: async () => (await native.volumeToggleMute()) ?? false,
  subscribe: async (cb) => native.onVolumeChanged(async () => {
    const v = await native.volumeGet();
    if (v) cb(v);
  }),
};

/**
 * Volume/mute overlay via Core Audio IAudioEndpointVolume with a native
 * RegisterControlChangeNotify callback (verified against Microsoft Learn).
 * Only *changes* publish an activity; it expires after 2s. The initial
 * level is shown on demand in the expanded view, never as an activity.
 */
export function createVolumeProvider(source: VolumeSource = nativeVolumeSource) {
  let unlisten: (() => void) | null = null;
  let last: VolumeState | null = null;

  const onChange = (publish: (a: Activity) => void) => (v: VolumeState) => {
    if (last && last.level === v.level && last.muted === v.muted) return;
    const first = last === null;
    last = v;
    if (first) return; // initial snapshot is not a change
    const now = Date.now();
    publish({
      id: 'volume', providerId: 'volume', kind: 'volume',
      title: v.muted ? 'Muted' : 'Volume', subtitle: `${Math.round(v.level * 100)}%`,
      priority: 70, startedAt: now, expiresAt: now + 2000,
      data: { level: v.level, muted: v.muted },
    });
  };

  const provider: ActivityProvider & { set: VolumeSource['set']; toggleMute: VolumeSource['toggleMute']; current: () => VolumeState | null } = {
    id: 'volume',
    description: 'Shows volume and mute changes for the default speakers, and lets you change them from the island.',
    async start(publish) {
      const v = await source.get();
      if (v) last = v;
      unlisten = await source.subscribe(onChange(publish));
    },
    stop() { unlisten?.(); unlisten = null; },
    set: (l) => source.set(l),
    toggleMute: () => source.toggleMute(),
    current: () => last,
  };
  return provider;
}

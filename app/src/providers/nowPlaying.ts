import type { ActivityProvider } from '../core/activityManager';
import { native, type MediaState } from '../platform/native';

export interface MediaSource {
  get(): Promise<MediaState | null>;
  control(action: 'play' | 'pause' | 'toggle' | 'next' | 'previous'): Promise<boolean>;
  subscribe(cb: () => void): Promise<() => void> | (() => void);
}

export const nativeMediaSource: MediaSource = {
  get: () => native.mediaGet(),
  control: (a) => native.mediaControl(a),
  subscribe: (cb) => native.onMediaChanged(cb),
};

/**
 * Now Playing via GlobalSystemMediaTransportControlsSessionManager
 * (Windows.Media.Control, verified against Microsoft Learn).
 * Refresh: native change events, plus a 5s position tick only while a
 * session exists (SMTC timeline events are per-session; see ASSUMPTIONS).
 */
export function createNowPlayingProvider(source: MediaSource = nativeMediaSource) {
  let publishFn: ((a: import('../core/types').Activity) => void) | null = null;
  let removeFn: ((id: string) => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => void) | null = null;
  let active = false;

  const refresh = async () => {
    if (!publishFn || !removeFn) return;
    const m = await source.get();
    if (!m || m.status === 'stopped' || !m.title) { removeFn('now-playing'); return; }
    publishFn({
      id: 'now-playing', providerId: 'now-playing', kind: 'now-playing',
      title: m.title, subtitle: m.artist ? `${m.artist}${m.album ? ` — ${m.album}` : ''}` : m.app,
      priority: 50, startedAt: Date.now(), sensitive: true,
      data: { status: m.status, positionSeconds: m.positionSeconds, durationSeconds: m.durationSeconds, app: m.app, ...(m.artDataUrl ? { art: m.artDataUrl } : {}) },
    });
  };

  const provider: ActivityProvider & { control: MediaSource['control']; refresh: () => Promise<void> } = {
    id: 'now-playing',
    description: 'Reads the current media session (Spotify, browsers, VLC and others) through Windows media controls. Can pause, play and skip.',
    async start(publish, remove) {
      publishFn = publish; removeFn = remove; active = true;
      await refresh();
      unlisten = await source.subscribe(() => { void refresh(); });
      timer = setInterval(() => { if (active) void refresh(); }, 5000);
    },
    stop() {
      active = false;
      if (timer) clearInterval(timer);
      unlisten?.();
      timer = null; unlisten = null;
    },
    control: (a) => source.control(a),
    refresh,
  };
  return provider;
}

import type { ActivityProvider } from '../core/activityManager';
import { native, type MediaState } from '../platform/native';

export interface MediaSource {
  get(source?: string | null): Promise<MediaState | null>;
  sessions(): Promise<MediaSessionInfo[]>;
  control(action: 'play' | 'pause' | 'toggle' | 'next' | 'previous', source?: string | null): Promise<boolean>;
  seek(positionSeconds: number, source?: string | null): Promise<boolean>;
  setShuffle(active: boolean, source?: string | null): Promise<boolean>;
  setRepeat(mode: string, source?: string | null): Promise<boolean>;
  subscribe(cb: () => void): Promise<() => void> | (() => void);
}

import type { MediaSessionInfo } from '../platform/native';

export const nativeMediaSource: MediaSource = {
  get: (s) => native.mediaGet(s),
  sessions: async () => (await native.mediaSessions()) ?? [],
  control: (a, s) => native.mediaControl(a, s),
  seek: (sec, s) => native.mediaSeek(sec, s),
  setShuffle: (a, s) => native.mediaSetShuffle(a, s),
  setRepeat: (m, s) => native.mediaSetRepeat(m, s),
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

  let selectedSource: string | null = null;

  const refresh = async () => {
    if (!publishFn || !removeFn) return;
    const m = await source.get(selectedSource);
    if (!m || m.status === 'stopped' || !m.title) { removeFn('now-playing'); return; }
    publishFn({
      id: 'now-playing', providerId: 'now-playing', kind: 'now-playing',
      title: m.title, subtitle: m.artist ? `${m.artist}${m.album ? ` — ${m.album}` : ''}` : m.app,
      priority: 50, startedAt: Date.now(), sensitive: true,
      data: {
        status: m.status, positionSeconds: m.positionSeconds, durationSeconds: m.durationSeconds, app: m.app,
        artist: m.artist, album: m.album, repeat: m.repeat ?? 'none', repeatSupported: m.repeatSupported ?? false,
        ...(m.shuffle !== null && m.shuffle !== undefined ? { shuffle: m.shuffle } : {}),
        ...(m.artDataUrl ? { art: m.artDataUrl } : {}),
      },
    });
  };

  const provider: ActivityProvider & {
    control: (a: 'play' | 'pause' | 'toggle' | 'next' | 'previous') => Promise<boolean>;
    seek: (s: number) => Promise<boolean>;
    setShuffle: (a: boolean) => Promise<boolean>;
    setRepeat: (m: string) => Promise<boolean>;
    sessions: () => Promise<MediaSessionInfo[]>;
    setSource: (app: string | null) => void;
    refresh: () => Promise<void>;
  } = {
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
    control: (a) => source.control(a, selectedSource),
    seek: (s) => source.seek(s, selectedSource),
    setShuffle: (a) => source.setShuffle(a, selectedSource),
    setRepeat: (m) => source.setRepeat(m, selectedSource),
    sessions: () => source.sessions(),
    setSource: (app) => { selectedSource = app; void refresh(); },
    refresh,
  };
  return provider;
}

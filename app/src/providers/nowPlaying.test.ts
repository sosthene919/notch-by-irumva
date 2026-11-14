import { describe, expect, it, vi } from 'vitest';
import { createNowPlayingProvider, type MediaSource } from './nowPlaying';
import type { MediaState } from '../platform/native';

const state = (patch: Partial<MediaState> = {}): MediaState => ({
  title: 'Song', artist: 'Singer', album: '', app: 'AppA',
  status: 'playing', positionSeconds: 10, durationSeconds: 200, ...patch,
});

function fakeSource() {
  const calls: unknown[] = [];
  const source: MediaSource = {
    get: vi.fn(async (s?: string | null) => { calls.push(['get', s ?? null]); return state({ app: s ?? 'AppA' }); }),
    sessions: vi.fn(async () => [
      { app: 'AppA', title: 'Song', status: 'playing' },
      { app: 'AppB', title: 'Other', status: 'paused' },
    ]),
    control: vi.fn(async (a: string, s?: string | null) => { calls.push(['control', a, s ?? null]); return true; }),
    seek: vi.fn(async (sec: number, s?: string | null) => { calls.push(['seek', sec, s ?? null]); return true; }),
    setShuffle: vi.fn(async (a: boolean, s?: string | null) => { calls.push(['shuffle', a, s ?? null]); return true; }),
    setRepeat: vi.fn(async (m: string, s?: string | null) => { calls.push(['repeat', m, s ?? null]); return true; }),
    subscribe: () => () => {},
  };
  return { source, calls };
}

describe('now playing source routing', () => {
  it('controls, seek, shuffle and repeat target the selected source', async () => {
    const { source, calls } = fakeSource();
    const p = createNowPlayingProvider(source);
    p.start(() => {}, () => {});
    p.setSource('AppB');
    await p.control('next');
    await p.seek(42);
    await p.setShuffle(true);
    await p.setRepeat('track');
    expect(calls).toContainEqual(['control', 'next', 'AppB']);
    expect(calls).toContainEqual(['seek', 42, 'AppB']);
    expect(calls).toContainEqual(['shuffle', true, 'AppB']);
    expect(calls).toContainEqual(['repeat', 'track', 'AppB']);
  });
  it('publishes shuffle and repeat from the session, omits shuffle when unsupported', async () => {
    const { source } = fakeSource();
    source.get = async () => state({ shuffle: true, repeat: 'list', repeatSupported: true });
    const published: { data?: Record<string, unknown> }[] = [];
    const p = createNowPlayingProvider(source);
    await p.start((a) => published.push(a), () => {});
    await p.refresh();
    expect(published[0]?.data).toMatchObject({ shuffle: true, repeat: 'list', repeatSupported: true, artist: 'Singer' });

    source.get = async () => state({ shuffle: null, repeat: 'none', repeatSupported: false });
    await p.refresh();
    expect(published[published.length - 1]?.data).not.toHaveProperty('shuffle');
  });
  it('removes the activity when the session stops or has no title', async () => {
    const { source } = fakeSource();
    const removed: string[] = [];
    const p = createNowPlayingProvider(source);
    p.start(() => {}, (id) => removed.push(id));
    source.get = async () => state({ status: 'stopped' });
    await p.refresh();
    source.get = async () => state({ title: '' });
    await p.refresh();
    expect(removed).toEqual(['now-playing', 'now-playing']);
  });
});

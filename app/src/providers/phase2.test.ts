import { describe, expect, it, vi } from 'vitest';
import type { Activity } from '../core/types';
import { createNowPlayingProvider, type MediaSource } from './nowPlaying';
import { createTimerProvider } from './timers';
import { createBatteryProvider } from './battery';
import { createVolumeProvider, type VolumeSource } from './volume';
import { createPrivacyProvider } from './privacy';

function harness() {
  const map = new Map<string, Activity>();
  return {
    publish: (a: Activity) => map.set(a.id, a),
    remove: (id: string) => { map.delete(id); },
    list: () => [...map.values()],
    get: (id: string) => map.get(id),
  };
}
const media = (over: Partial<import('../platform/native').MediaState> = {}) => ({
  title: 'Song', artist: 'Artist', album: 'Album', app: 'spotify.exe', status: 'playing' as const,
  positionSeconds: 30, durationSeconds: 180, ...over,
});

describe('now playing provider (fake source)', () => {
  it('publishes the current session and removes it when playback stops', async () => {
    let current = media();
    const source: MediaSource = { get: async () => current, control: async () => true, subscribe: () => () => {} };
    const p = createNowPlayingProvider(source);
    const h = harness();
    await p.start(h.publish, h.remove);
    expect(h.get('now-playing')).toMatchObject({ title: 'Song', kind: 'now-playing' });
    expect(h.get('now-playing')?.data).toMatchObject({ status: 'playing', positionSeconds: 30 });
    current = media({ status: 'stopped' });
    await p.refresh();
    expect(h.list()).toHaveLength(0);
    p.stop();
  });
  it('passes transport controls through to the source', async () => {
    const control = vi.fn(async () => true);
    const p = createNowPlayingProvider({ get: async () => null, control, subscribe: () => () => {} });
    await p.control('next');
    expect(control).toHaveBeenCalledWith('next');
  });
});

describe('timer provider', () => {
  it('counts down and publishes a done activity that expires', () => {
    vi.useFakeTimers();
    let t = 1_000_000;
    const p = createTimerProvider(() => t);
    const h = harness();
    p.start(h.publish, h.remove);
    p.startCountdown(60, 'Tea');
    expect(h.get('timer')?.subtitle).toBe('01:00');
    t += 30_000; vi.advanceTimersByTime(1000);
    expect(h.get('timer')?.subtitle).toBe('00:30');
    t += 31_000; vi.advanceTimersByTime(1000);
    expect(h.get('timer-done' as never) ?? h.list().find((a) => a.kind === 'timer-done')).toBeTruthy();
    expect(h.list().find((a) => a.kind === 'timer-done')?.expiresAt).toBeGreaterThan(t);
    p.stopAll();
    vi.useRealTimers();
  });
});

describe('battery provider (fake source)', () => {
  it('announces plug-in once as a transient and raises low battery', async () => {
    let cur = { percent: 50, acOnline: false, charging: false, hasBattery: true };
    const p = createBatteryProvider({ get: async () => cur }, 60_000);
    const h = harness();
    p.start(h.publish, h.remove);
    await p.checkOnce();
    expect(h.list()).toHaveLength(0);
    cur = { percent: 51, acOnline: true, charging: true, hasBattery: true };
    await p.checkOnce();
    expect(h.get('battery')).toMatchObject({ title: 'Charging', subtitle: '51%' });
    cur = { percent: 18, acOnline: false, charging: false, hasBattery: true };
    await p.checkOnce();
    expect(h.get('battery-low')).toMatchObject({ title: 'Low battery' });
    p.stop();
  });
  it('ignores desktops with no battery', async () => {
    const p = createBatteryProvider({ get: async () => ({ percent: 255, acOnline: true, charging: false, hasBattery: false }) });
    const h = harness();
    p.start(h.publish, h.remove);
    await p.checkOnce();
    expect(h.list()).toHaveLength(0);
    p.stop();
  });
});

describe('volume provider (fake source)', () => {
  it('publishes only on change, as a 2s transient', async () => {
    let cb: ((v: { level: number; muted: boolean }) => void) | null = null;
    const source: VolumeSource = {
      get: async () => ({ level: 0.5, muted: false }),
      set: async () => true, toggleMute: async () => true,
      subscribe: (fn) => { cb = fn; return () => {}; },
    };
    const p = createVolumeProvider(source);
    const h = harness();
    await p.start(h.publish, h.remove);
    expect(h.list()).toHaveLength(0); // initial snapshot is not a change
    cb!({ level: 0.65, muted: false });
    const a = h.get('volume');
    expect(a).toMatchObject({ title: 'Volume', subtitle: '65%' });
    expect(a!.expiresAt! - a!.startedAt).toBe(2000);
    cb!({ level: 0.65, muted: false }); // duplicate suppressed
    expect(h.list()).toHaveLength(1);
    p.stop();
  });
});

describe('privacy provider (fake source)', () => {
  it('shows mic use with the app name and removes it when it stops', async () => {
    let uses: { kind: 'microphone' | 'camera' | 'location'; app: string }[] = [{ kind: 'microphone', app: 'Teams' }];
    const p = createPrivacyProvider({ get: async () => uses, subscribe: () => () => {} });
    const h = harness();
    await p.start(h.publish, h.remove);
    expect(h.get('privacy-microphone')).toMatchObject({ title: 'Microphone in use', subtitle: 'Teams', priority: 90 });
    uses = [];
    await p.refreshOnce();
    expect(h.list()).toHaveLength(0);
    p.stop();
  });
});

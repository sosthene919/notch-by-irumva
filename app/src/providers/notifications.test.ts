import { describe, expect, it } from 'vitest';
import { AlertDetector, createNotificationsProvider, isAlertActivity } from './notifications';
import type { Activity } from '../core/types';

const act = (id: string, providerId: string, kind: string, startedAt = 0): Activity =>
  ({ id, providerId, kind, title: kind, priority: 50, startedAt });

describe('alert detector', () => {
  it('primes on the first snapshot without alerting', () => {
    const d = new AlertDetector();
    expect(d.next([act('privacy-microphone', 'privacy', 'privacy-microphone')])).toEqual([]);
  });
  it('alerts when a timer finishes, once', () => {
    const d = new AlertDetector();
    d.next([act('timer', 'timers', 'timer')]);
    const done = act('timer', 'timers', 'timer-done', 1000);
    expect(d.next([done])).toEqual([done]);
    expect(d.next([done])).toEqual([]); // still on screen: no re-alert
  });
  it('alerts on privacy start, stays quiet while it persists, alerts again after it stops and restarts', () => {
    const d = new AlertDetector();
    d.next([]);
    const mic = act('privacy-microphone', 'privacy', 'privacy-microphone', 1);
    expect(d.next([mic])).toHaveLength(1);
    expect(d.next([act('privacy-microphone', 'privacy', 'privacy-microphone', 2)])).toEqual([]);
    expect(d.next([])).toEqual([]); // switching off does not pop
    expect(d.next([mic])).toHaveLength(1);
  });
  it('alerts on low and full battery, ignores routine activities', () => {
    const d = new AlertDetector();
    d.next([act('volume', 'volume', 'volume')]);
    expect(d.next([act('volume', 'volume', 'volume')])).toEqual([]);
    expect(d.next([act('battery-low', 'battery', 'battery-low')])).toHaveLength(1);
    const d2 = new AlertDetector();
    d2.next([]);
    expect(d2.next([act('battery-full', 'battery', 'battery-full')])).toHaveLength(1);
  });
  it('isAlertActivity covers exactly the alert set', () => {
    expect(isAlertActivity(act('t', 'timers', 'timer-done'))).toBe(true);
    expect(isAlertActivity(act('t', 'timers', 'timer'))).toBe(false);
    expect(isAlertActivity(act('p', 'privacy', 'privacy-camera'))).toBe(true);
    expect(isAlertActivity(act('b', 'battery', 'battery'))).toBe(false);
    expect(isAlertActivity(act('x', 'notifications', 'test-notification'))).toBe(true);
  });
});

describe('test notification', () => {
  it('fireTest publishes a unique, expiring, top-priority alert that the detector pops', () => {
    const published: Activity[] = [];
    const p = createNotificationsProvider();
    p.start((a) => published.push(a), () => {});
    p.fireTest(1000);
    p.fireTest(2000);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({
      id: 'test-notification-1000', providerId: 'notifications', kind: 'test-notification',
      title: 'Test notification', priority: 95, expiresAt: 31_000,
    });
    expect(published[1]?.id).toBe('test-notification-2000'); // unique: re-pops on every click
    const d = new AlertDetector();
    d.next([]);
    expect(d.next(published)).toHaveLength(2);
  });
  it('fireTest is a no-op before start', () => {
    const p = createNotificationsProvider();
    expect(() => p.fireTest()).not.toThrow();
  });
});

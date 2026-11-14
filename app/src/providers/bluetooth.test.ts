import { describe, expect, it } from 'vitest';
import { BluetoothAlerter } from './bluetooth';
import type { BtDevice } from '../core/types';

const dev = (id: string, battery: number | null, name = 'Pods'): BtDevice =>
  ({ id, name, kind: 'earbuds', battery, connected: true });

describe('bluetooth alerter', () => {
  it('seeds silently, then alerts on connect with battery data', () => {
    const a = new BluetoothAlerter();
    expect(a.next([], 0)).toEqual([]);
    const out = a.next([dev('1', 72)], 1000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'device-connected', title: 'Pods', data: { battery: 72 } });
  });
  it('low battery fires once at 20 and again at 10 per discharge', () => {
    const a = new BluetoothAlerter();
    a.next([dev('1', 60)], 0);
    expect(a.next([dev('1', 19)], 1).map((x) => x.kind)).toEqual(['device-low-battery']);
    expect(a.next([dev('1', 18)], 2)).toEqual([]); // not again
    expect(a.next([dev('1', 9)], 3).map((x) => x.kind)).toEqual(['device-low-battery']);
    expect(a.next([dev('1', 8)], 4)).toEqual([]);
    a.next([dev('1', 80)], 5); // charged: re-arm
    expect(a.next([dev('1', 19)], 6).map((x) => x.kind)).toEqual(['device-low-battery']);
  });
  it('device already low at startup alerts on the next scan, not at launch', () => {
    const a = new BluetoothAlerter();
    expect(a.next([dev('1', 19)], 0)).toEqual([]); // seeded silently
    const out = a.next([dev('1', 19)], 20_000);
    expect(out.map((x) => x.kind)).toEqual(['device-low-battery']);
  });
  it('thresholds are exact and re-arm only above 25', () => {
    const a = new BluetoothAlerter();
    a.next([dev('1', 60)], 0);
    expect(a.next([dev('1', 20)], 1).map((x) => x.kind)).toEqual(['device-low-battery']);
    expect(a.next([dev('1', 10)], 2).map((x) => x.kind)).toEqual(['device-low-battery']);
    a.next([dev('1', 25)], 3); // 25 does not re-arm
    expect(a.next([dev('1', 19)], 4)).toEqual([]);
    a.next([dev('1', 26)], 5); // 26 re-arms
    expect(a.next([dev('1', 19)], 6).map((x) => x.kind)).toEqual(['device-low-battery']);
  });
  it('null battery never alerts low and never clears alert memory by itself', () => {
    const a = new BluetoothAlerter();
    a.next([dev('1', 15)], 0);
    a.next([dev('1', 15)], 1); // low fires here
    expect(a.next([dev('1', null)], 2)).toEqual([]);
    expect(a.next([dev('1', 14)], 3)).toEqual([]); // still same discharge
  });
  it('disconnect is a quiet notice, devices without battery still connect-alert', () => {
    const a = new BluetoothAlerter();
    a.next([dev('1', null, 'Mouse')], 0);
    expect(a.next([dev('1', null, 'Mouse')], 1)).toEqual([]);
    const out = a.next([], 2);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('device-disconnected');
    expect(out[0]?.priority).toBeLessThan(50);
  });
});

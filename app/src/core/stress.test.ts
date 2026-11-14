import { describe, expect, it } from 'vitest';
import { EventBus } from './eventBus';
import { ActivityManager } from './activityManager';

describe('stress: bursts stay bounded (brief section 6)', () => {
  it('10,000-event burst drains without unbounded growth', () => {
    const bus = new EventBus(256);
    let delivered = 0;
    bus.on('x', () => { delivered++; });
    bus.on('seed', () => { for (let i = 0; i < 10_000; i++) bus.publish({ type: 'x', priority: i % 5, payload: i }); });
    bus.publish({ type: 'seed', priority: 0, payload: null });
    expect(bus.pending).toBe(0);
    expect(bus.stats.dropped).toBeGreaterThan(9_000); // bounded queue dropped the overflow
    expect(delivered).toBeLessThanOrEqual(256 + 5);
  });

  it('1,000 activities sort quickly and stay capped by callers', () => {
    const m = new ActivityManager();
    m.registerProvider({
      id: 'stress', description: 'stress',
      start(publish) {
        for (let i = 0; i < 1000; i++) publish({ id: `a${i}`, providerId: 'stress', kind: 't', title: `A${i}`, priority: i % 100, startedAt: i });
      },
      stop() {},
    });
    const started = performance.now();
    const ordered = m.ordered();
    expect(ordered).toHaveLength(1000);
    expect(ordered[0]?.priority).toBe(99);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

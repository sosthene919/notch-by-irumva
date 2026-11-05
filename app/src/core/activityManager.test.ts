import { describe, expect, it } from 'vitest';
import { ActivityManager, type ActivityProvider } from './activityManager';

const fake = (id: string): ActivityProvider => ({
  id, description: `${id} description`,
  start(publish) { publish({ id: `${id}-1`, providerId: id, kind: 'test', title: id, priority: 10, startedAt: 1 }); },
  stop() {},
});

describe('activity manager', () => {
  it('orders by priority desc, then earliest start', () => {
    const m = new ActivityManager();
    m.registerProvider({ ...fake('a'), start(p) { p({ id: 'a1', providerId: 'a', kind: 't', title: 'A', priority: 5, startedAt: 2 }); } });
    m.registerProvider({ ...fake('b'), start(p) { p({ id: 'b1', providerId: 'b', kind: 't', title: 'B', priority: 50, startedAt: 3 }); } });
    expect(m.ordered().map((a) => a.id)).toEqual(['b1', 'a1']);
  });
  it('hot-disabling a provider removes its activities immediately', () => {
    const m = new ActivityManager();
    m.registerProvider(fake('a'));
    expect(m.ordered()).toHaveLength(1);
    m.setProviderEnabled('a', false);
    expect(m.ordered()).toHaveLength(0);
    m.setProviderEnabled('a', true);
    expect(m.ordered()).toHaveLength(1);
  });
  it('expires activities on tick', () => {
    const m = new ActivityManager();
    m.registerProvider({ ...fake('a'), start(p) { p({ id: 'x', providerId: 'a', kind: 'timer', title: 'Timer', priority: 10, startedAt: 0, expiresAt: 100 }); } });
    expect(m.ordered(50)).toHaveLength(1);
    m.tick(100);
    expect(m.ordered(50)).toHaveLength(0);
  });
});

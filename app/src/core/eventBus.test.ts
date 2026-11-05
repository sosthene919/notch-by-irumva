import { describe, expect, it } from 'vitest';
import { EventBus } from './eventBus';

describe('event bus', () => {
  it('delivers higher priority first, FIFO within a priority', () => {
    const bus = new EventBus(16);
    const seen: string[] = [];
    bus.on('*', (e) => seen.push(String(e.payload)));
    // Publish from inside a handler so events actually queue before flushing.
    bus.on('seed', () => {
      bus.publish({ type: 'x', priority: 1, payload: 'low' });
      bus.publish({ type: 'x', priority: 10, payload: 'high' });
      bus.publish({ type: 'x', priority: 10, payload: 'high2' });
    });
    bus.publish({ type: 'seed', priority: 0, payload: 'seed' });
    expect(seen).toEqual(['seed', 'high', 'high2', 'low']);
  });
  it('is bounded: drops oldest and counts drops under burst', () => {
    const bus = new EventBus(8);
    bus.on('hold', () => { for (let i = 0; i < 100; i++) bus.publish({ type: 'x', priority: 0, payload: i }); });
    bus.publish({ type: 'hold', priority: 0, payload: null });
    expect(bus.pending).toBe(0);
    expect(bus.stats.dropped).toBeGreaterThan(0);
    expect(bus.stats.published).toBe(101);
  });
  it('rejects zero capacity', () => {
    expect(() => new EventBus(0)).toThrow();
  });
});

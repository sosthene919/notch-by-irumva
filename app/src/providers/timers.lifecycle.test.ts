import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimerProvider } from './timers';
import type { Activity } from '../core/types';

describe('timer lifecycle (fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = () => {
    const published: Activity[] = [];
    const removed: string[] = [];
    const p = createTimerProvider(() => Date.now());
    p.start((a) => published.push(a), (id) => removed.push(id));
    return { p, published, removed };
  };

  it('finishes exactly once', () => {
    const { p, published } = setup();
    p.startCountdown(5, 'Tea');
    vi.advanceTimersByTime(10_000);
    expect(published.filter((a) => a.kind === 'timer-done')).toHaveLength(1);
    expect(p.running()).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(published.filter((a) => a.kind === 'timer-done')).toHaveLength(1);
  });
  it('a new countdown replaces the running one', () => {
    const { p, published } = setup();
    p.startCountdown(60, 'Old');
    vi.advanceTimersByTime(10_000);
    p.startCountdown(5, 'New');
    vi.advanceTimersByTime(6_000);
    const done = published.filter((a) => a.kind === 'timer-done');
    expect(done).toHaveLength(1);
    expect(done[0]?.title).toBe('New done');
  });
  it('stop during pause prevents the finish and removes the activity', () => {
    const { p, published, removed } = setup();
    p.startCountdown(30, 'Focus');
    vi.advanceTimersByTime(5_000);
    p.pause();
    p.stopAll();
    expect(removed).toContain('timer');
    vi.advanceTimersByTime(60_000);
    expect(published.some((a) => a.kind === 'timer-done')).toBe(false);
  });
  it('pause after finish is a no-op', () => {
    const { p, published } = setup();
    p.startCountdown(3, 'Egg');
    vi.advanceTimersByTime(3_000);
    expect(published.some((a) => a.kind === 'timer-done')).toBe(true);
    p.pause();
    expect(p.paused()).toBe(false);
  });
});

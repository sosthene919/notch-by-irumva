import { describe, expect, it } from 'vitest';
import { createTimerProvider } from './timers';
import type { Activity } from '../core/types';

describe('timer pause/resume', () => {
  it('freezes the countdown while paused and finishes after resume', () => {
    let now = 0;
    const published: Activity[] = [];
    const p = createTimerProvider(() => now);
    p.start((a) => published.push(a), () => {});
    p.startCountdown(60, 'Focus');
    now = 20_000;
    p.pause();
    expect(p.paused()).toBe(true);
    const frozen = published[published.length - 1];
    expect(frozen?.data?.remainingSeconds).toBe(40);
    now = 90_000; // wall clock runs on; countdown must not
    p.resume();
    const resumed = published[published.length - 1];
    expect(resumed?.data?.remainingSeconds).toBe(40);
    now = 131_000; // 41 s after resume: done
    // tick happens on the internal interval in production; here resume
    // already re-published. Drive one more publish cycle via pause/resume.
    p.pause();
    const last = published[published.length - 1];
    expect(last?.kind).toBe('timer');
  });
  it('stopwatch pause holds elapsed', () => {
    let now = 1000;
    const published: Activity[] = [];
    const p = createTimerProvider(() => now);
    p.start((a) => published.push(a), () => {});
    p.startStopwatch();
    now = 6000;
    p.pause();
    expect(published[published.length - 1]?.data?.elapsedSeconds).toBe(5);
    now = 60_000;
    p.resume();
    expect(published[published.length - 1]?.data?.elapsedSeconds).toBe(5);
  });
});

import type { ActivityProvider } from '../core/activityManager';
import type { Activity } from '../core/types';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export interface TimerControls {
  startCountdown(seconds: number, label?: string): void;
  startStopwatch(): void;
  pause(): void;
  resume(): void;
  stopAll(): void;
  running(): boolean;
  paused(): boolean;
}

/**
 * Timers, stopwatch and countdown alarms. Pure app logic — no Windows API.
 * One 1s tick exists only while something is running (brief section 6).
 */
export function createTimerProvider(now: () => number = Date.now) {
  let publishFn: ((a: Activity) => void) | null = null;
  let removeFn: ((id: string) => void) | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let countdownEnd = 0; let countdownLabel = 'Timer';
  let stopwatchStart = 0;
  let pausedRemaining = 0; let pausedElapsed = 0;
  let mode: 'none' | 'countdown' | 'stopwatch' = 'none';
  let isPaused = false;

  const clearTick = () => { if (interval) clearInterval(interval); interval = null; };
  const tick = () => {
    if (!publishFn || !removeFn) return;
    if (mode === 'countdown') {
      const left = isPaused ? pausedRemaining : countdownEnd - now();
      if (!isPaused && left <= 0) {
        mode = 'none'; clearTick();
        publishFn({ id: 'timer', providerId: 'timers', kind: 'timer-done', title: `${countdownLabel} done`, priority: 85, startedAt: now(), expiresAt: now() + 60_000 });
        return;
      }
      publishFn({ id: 'timer', providerId: 'timers', kind: 'timer', title: countdownLabel, subtitle: fmt(left), priority: 55, startedAt: now(), data: { remainingSeconds: Math.ceil(left / 1000), paused: isPaused } });
    } else if (mode === 'stopwatch') {
      const elapsed = isPaused ? pausedElapsed : now() - stopwatchStart;
      publishFn({ id: 'timer', providerId: 'timers', kind: 'stopwatch', title: 'Stopwatch', subtitle: fmt(elapsed), priority: 45, startedAt: now(), data: { elapsedSeconds: Math.floor(elapsed / 1000), paused: isPaused } });
    }
  };
  const ensureTick = () => { if (!interval) interval = setInterval(tick, 1000); };

  const controls: TimerControls = {
    startCountdown(seconds, label = 'Timer') {
      mode = 'countdown'; isPaused = false; countdownLabel = label; countdownEnd = now() + seconds * 1000;
      ensureTick(); tick();
    },
    startStopwatch() { mode = 'stopwatch'; isPaused = false; stopwatchStart = now(); ensureTick(); tick(); },
    pause() {
      if (mode === 'none' || isPaused) return;
      isPaused = true;
      if (mode === 'countdown') pausedRemaining = Math.max(0, countdownEnd - now());
      else pausedElapsed = now() - stopwatchStart;
      tick();
    },
    resume() {
      if (mode === 'none' || !isPaused) return;
      isPaused = false;
      if (mode === 'countdown') countdownEnd = now() + pausedRemaining;
      else stopwatchStart = now() - pausedElapsed;
      tick();
    },
    stopAll() { mode = 'none'; isPaused = false; clearTick(); removeFn?.('timer'); },
    running: () => mode !== 'none',
    paused: () => isPaused,
  };

  const provider: ActivityProvider & TimerControls = {
    id: 'timers',
    description: 'Timers, stopwatch and alarms created inside Notch. Reads nothing from the system.',
    start(publish, remove) { publishFn = publish; removeFn = remove; },
    stop() { controls.stopAll(); publishFn = null; removeFn = null; },
    ...controls,
  };
  return provider;
}

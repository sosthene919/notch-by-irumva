import { describe, expect, it } from 'vitest';
import { applyReminderDone, applyReminderSnooze, dueTodos, formatBytes, waterReminderDue } from './productivity';
import type { TodoItem } from './types';

const todo = (patch: Partial<TodoItem>): TodoItem => ({ id: 1, text: 'x', done: false, ...patch });

describe('reminder math', () => {
  it('dueTodos returns only unfinished, unreminded, past-due tasks', () => {
    const list = [
      todo({ id: 1, dueAt: 100 }),
      todo({ id: 2, dueAt: 100, done: true }),
      todo({ id: 3, dueAt: 100, reminded: true }),
      todo({ id: 4, dueAt: 5000 }),
      todo({ id: 5 }),
    ];
    expect(dueTodos(list, 1000).map((t) => t.id)).toEqual([1]);
  });
  it('water reminders respect goal, hours and interval', () => {
    const w = { drankMl: 500, goalMl: 2000, intervalMin: 60 };
    expect(waterReminderDue(w, 0, 61 * 60_000, 10)).toBe(true);
    expect(waterReminderDue(w, 0, 30 * 60_000, 10)).toBe(false); // interval
    expect(waterReminderDue(w, 0, 61 * 60_000, 23)).toBe(false); // quiet hours
    expect(waterReminderDue({ ...w, drankMl: 2000 }, 0, 61 * 60_000, 10)).toBe(false); // goal met
  });
  it('reminder done: one-off completes, recurring reschedules, unknown id is a no-op', () => {
    const now = new Date('2026-11-12T10:00:00').getTime();
    const list = [
      todo({ id: 1, dueAt: now }),
      todo({ id: 2, dueAt: now, recur: 'daily' }),
      todo({ id: 3, dueAt: now, recur: 'weekly', weekday: 4 }),
    ];
    const after1 = applyReminderDone(list, 1, now);
    expect(after1.find((t) => t.id === 1)?.done).toBe(true);
    const after2 = applyReminderDone(list, 2, now);
    expect(after2.find((t) => t.id === 2)).toMatchObject({ done: false, reminded: false });
    expect(after2.find((t) => t.id === 2)?.dueAt).toBe(new Date('2026-11-13T10:00:00').getTime());
    const after3 = applyReminderDone(list, 3, now);
    expect(new Date(after3.find((t) => t.id === 3)?.dueAt ?? 0).getDate()).toBe(19);
    expect(applyReminderDone(list, 99, now)).toEqual(list);
  });
  it('reminder snooze moves the due time and re-arms the alert', () => {
    const now = 1_000_000;
    const list = [todo({ id: 1, dueAt: now, reminded: true })];
    const out = applyReminderSnooze(list, 1, 10, now);
    expect(out[0]).toMatchObject({ dueAt: now + 600_000, reminded: false, done: false });
  });
  it('formatBytes is human and bounded', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

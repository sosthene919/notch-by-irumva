import type { TodoItem } from './types';
import { nextOccurrence } from './remindParse';

/** Pure reminder math for to-dos and water (brief: modules in order —
 *  reminders and to-do last). Kept side-effect free so it is testable
 *  without the island. */

export function dueTodos(todos: TodoItem[], now: number): TodoItem[] {
  return todos.filter((t) => !t.done && !t.reminded && t.dueAt !== undefined && t.dueAt <= now);
}

/** Done on a reminder alert: one-offs complete; recurring items move
 *  to their next occurrence and re-arm. Unknown ids change nothing. */
export function applyReminderDone(todos: TodoItem[], id: number, now: number): TodoItem[] {
  return todos.map((t) => {
    if (t.id !== id) return t;
    if (t.recur) {
      return { ...t, dueAt: nextOccurrence(t.dueAt ?? now, t.recur, t.weekday, now), reminded: false };
    }
    return { ...t, done: true };
  });
}

/** Snooze: push the due time out and re-arm the alert. */
export function applyReminderSnooze(todos: TodoItem[], id: number, minutes: number, now: number): TodoItem[] {
  return todos.map((t) => (t.id === id
    ? { ...t, dueAt: now + minutes * 60_000, reminded: false }
    : t));
}

/** Active hours for water reminders: 08:00-21:59 local by default. */
export function waterReminderDue(
  water: { drankMl: number; goalMl: number; intervalMin: number },
  lastRemindedAt: number,
  now: number,
  hour: number,
): boolean {
  if (water.drankMl >= water.goalMl) return false;
  if (hour < 8 || hour >= 22) return false;
  return now - lastRemindedAt >= water.intervalMin * 60_000;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

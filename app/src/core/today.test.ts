import { describe, expect, it } from 'vitest';
import { buildToday, displayTodoText } from './today';
import type { TodoItem } from './types';

const todo = (patch: Partial<TodoItem>): TodoItem => ({
  id: 1, text: 'Item', done: false, ...patch,
});
const at = (y: number, m: number, d: number, h = 9) =>
  new Date(y, m, d, h).getTime();

describe('buildToday', () => {
  it('lists undone dated items from today on, soonest first, capped at 3', () => {
    const now = new Date(2026, 10, 4, 8);
    const rows = buildToday([
      todo({ id: 1, text: 'Late', dueAt: at(2026, 10, 4, 18) }),
      todo({ id: 2, text: 'Early', dueAt: at(2026, 10, 4, 9) }),
      todo({ id: 3, text: 'Yesterday', dueAt: at(2026, 10, 3, 9) }),
      todo({ id: 4, text: 'Done', dueAt: at(2026, 10, 4, 10), done: true }),
      todo({ id: 5, text: 'Tomorrow', dueAt: at(2026, 10, 5, 9) }),
      todo({ id: 6, text: 'Later', dueAt: at(2026, 10, 6, 9) }),
    ], now).rows;
    expect(rows.map((r) => r.text)).toEqual(['Early', 'Late', 'Tomorrow']);
  });

  it('counts today including undated tasks, and names the next item', () => {
    const now = new Date(2026, 10, 4, 8);
    const s = buildToday([
      todo({ id: 1, text: 'Water', dueAt: at(2026, 10, 4, 11) }),
      todo({ id: 2, text: 'Undated task' }),
      todo({ id: 3, text: 'Future', dueAt: at(2026, 10, 9, 9) }),
    ], now);
    expect(s.countToday).toBe(2);
    expect(s.nextLabel).toMatch(/^Water, /);
    expect(buildToday([], now).nextLabel).toBeNull();
  });

  it('week strip starts Monday and flags today', () => {
    // Wednesday 4 Nov 2026.
    const s = buildToday([], new Date(2026, 10, 4, 12));
    expect(s.week).toHaveLength(7);
    expect(s.week[0]!.day.getDay()).toBe(1);
    expect(s.week.filter((d) => d.isToday).map((d) => d.day.getDate())).toEqual([4]);
  });

  it('week strip crosses month and year boundaries', () => {
    // Friday 1 Jan 2027: the Monday of this week is 28 Dec 2026.
    const s = buildToday([], new Date(2027, 0, 1, 12));
    expect(s.week[0]!.day.getFullYear()).toBe(2026);
    expect(s.week[0]!.day.getMonth()).toBe(11);
    expect(s.week[0]!.day.getDate()).toBe(28);
    expect(s.week[6]!.day.getFullYear()).toBe(2027);
    expect(s.week.findIndex((d) => d.isToday)).toBe(4);
  });

  it('hides reminder text when previews are off', () => {
    expect(displayTodoText('Call Sam', true)).toBe('Call Sam');
    expect(displayTodoText('Call Sam', false)).toBe('Reminder due');
  });
});

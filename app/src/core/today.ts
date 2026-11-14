import type { TodoItem } from './types';

export interface TodayRow {
  id: number;
  text: string;
  detail: string;
  dueAt?: number;
}

export interface TodaySummary {
  rows: TodayRow[];
  /** Undone items due today (dated today, or undated tasks). */
  countToday: number;
  /** "Water, 11:00" style label for the next dated item, or null. */
  nextLabel: string | null;
  /** Seven day cells starting Monday, today flagged. Pure date math. */
  week: { day: Date; isToday: boolean }[];
}

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Generic label used when text previews are off (privacy by default). */
export function displayTodoText(text: string, showPreviews: boolean): string {
  return showPreviews ? text : 'Reminder due';
}

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

function weekStrip(now: Date): { day: Date; isToday: boolean }[] {
  const today = startOfDay(now);
  const monday = new Date(today);
  // getDay: 0 is Sunday. Shift so Monday is cell 0, across month and
  // year boundaries (Date arithmetic handles both).
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return { day, isToday: day.getTime() === today };
  });
}

/**
 * Today page data, from reminders and to-dos only (no calendar, no
 * Windows notifications). Upcoming means undone and dated today or
 * later, soonest first, at most `limit`.
 */
export function buildToday(todos: TodoItem[], now: Date, limit = 3): TodaySummary {
  const dayStart = startOfDay(now);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const undone = todos.filter((t) => !t.done);
  const upcoming = undone
    .filter((t) => t.dueAt !== undefined && t.dueAt >= dayStart)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const rows: TodayRow[] = upcoming.slice(0, limit).map((t) => ({
    id: t.id,
    text: t.text,
    detail: fmtTime(t.dueAt ?? dayStart),
    dueAt: t.dueAt,
  }));
  const countToday = undone.filter(
    (t) => t.dueAt === undefined || (t.dueAt >= dayStart && t.dueAt < dayEnd),
  ).length;
  const next = upcoming[0];
  return {
    rows,
    countToday,
    nextLabel: next ? `${next.text}, ${fmtTime(next.dueAt ?? dayStart)}` : null,
    week: weekStrip(now),
  };
}

/**
 * Natural phrasing for quick-add reminders (brief section 2):
 *   "Call Sam in 20 min"        → task "Call Sam", due in 20 minutes
 *   "Pay rent tomorrow 9am"     → tomorrow at 09:00
 *   "Stand up every day 9am"    → daily at 09:00
 *   "Gym every monday 18:30"    → weekly on Monday at 18:30
 *   "Email Ana 14:30"           → today at 14:30 (tomorrow if past)
 * Anything unrecognized stays a plain task with no due time. The text
 * the user typed for the task itself is preserved, minus the time part.
 */

export type Recurrence = 'daily' | 'weekdays' | 'weekly';
export interface ParsedReminder { text: string; dueAt?: number; recur?: Recurrence; weekday?: number }

const DAY_MS = 86_400_000;

function atTime(base: Date, h: number, m: number): number {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function parseClock(s: string): { h: number; m: number } | null {
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (/pm/i.test(m12[3] ?? '')) h += 12;
    return { h, m: Number(m12[2] ?? 0) };
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { h: Number(m24[1]), m: Number(m24[2]) };
  return null;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export function parseReminder(input: string, now = Date.now()): ParsedReminder {
  const raw = input.trim();
  const lower = ` ${raw.toLowerCase()} `;

  // "in N min/hour"
  const rel = lower.match(/\bin\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h)\b/);
  if (rel && rel[1] && rel[2]) {
    const n = Number(rel[1]);
    const ms = /^h/.test(rel[2]) ? n * 3_600_000 : n * 60_000;
    const text = raw.replace(/\bin\s+\d+\s*(minutes?|mins?|m|hours?|hrs?|h)\b/i, '').replace(/\s{2,}/g, ' ').trim();
    return { text: text || raw, dueAt: now + ms };
  }

  // Recurrence
  let recur: Recurrence | undefined;
  let weekday: number | undefined;
  let rest = lower;
  const recMatch = lower.match(/\bevery\s+(day|daily|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (recMatch && recMatch[1]) {
    const w = recMatch[1];
    if (w === 'day' || w === 'daily') recur = 'daily';
    else if (w === 'weekday' || w === 'weekdays') recur = 'weekdays';
    else { recur = 'weekly'; weekday = WEEKDAYS[w]; }
    rest = lower.replace(recMatch[0], ' ');
  }

  // "tomorrow"
  const tomorrow = /\btomorrow\b/.test(rest);
  if (tomorrow) rest = rest.replace(/\btomorrow\b/, ' ');

  // Clock at the end (or after "at")
  const clockMatch = rest.match(/(?:\bat\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})\s*$/i);
  const clock = clockMatch && clockMatch[1] ? parseClock(clockMatch[1].trim()) : null;

  const cleanText = (s: string) => s.replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
  const stripFromRaw = (patterns: RegExp[]) => {
    let t = raw;
    for (const p of patterns) t = t.replace(p, ' ');
    return cleanText(t) || raw;
  };

  if (recur) {
    const c = clock ?? { h: 9, m: 0 };
    const base = new Date(now);
    let due = atTime(base, c.h, c.m);
    if (recur === 'daily') {
      if (due <= now) due += DAY_MS;
    } else if (recur === 'weekdays') {
      while (due <= now || [0, 6].includes(new Date(due).getDay())) due += DAY_MS;
    } else {
      const target = weekday ?? base.getDay();
      while (new Date(due).getDay() !== target || due <= now) due += DAY_MS;
    }
    return {
      text: stripFromRaw([/\bevery\s+\w+\b/i, /\b(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)?\b/i]),
      dueAt: due, recur, weekday,
    };
  }

  if (clock || tomorrow) {
    const c = clock ?? { h: 9, m: 0 };
    let due = atTime(new Date(now), c.h, c.m);
    if (tomorrow) due += DAY_MS;
    else if (due <= now) due += DAY_MS; // a bare time that passed means tomorrow
    return {
      text: stripFromRaw([/\btomorrow\b/i, /\b(at\s+)?\d{1,2}(:\d{2})?\s*(am|pm)\b/i, /\bat\s+\d{1,2}:\d{2}\b/i]),
      dueAt: due,
    };
  }

  return { text: raw };
}

/** Next occurrence for a recurring reminder after it fires. */
export function nextOccurrence(dueAt: number, recur: Recurrence, weekday: number | undefined, now = Date.now()): number {
  let due = dueAt;
  do {
    due += DAY_MS;
  } while (
    due <= now
    || (recur === 'weekdays' && [0, 6].includes(new Date(due).getDay()))
    || (recur === 'weekly' && new Date(due).getDay() !== (weekday ?? new Date(dueAt).getDay()))
  );
  return due;
}

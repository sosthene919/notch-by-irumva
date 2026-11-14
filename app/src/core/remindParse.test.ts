import { describe, expect, it } from 'vitest';
import { nextOccurrence, parseReminder } from './remindParse';

const NOW = new Date('2026-11-12T10:00:00').getTime(); // Thursday 10:00 local

describe('natural reminder parsing', () => {
  it('relative: in 20 min, task text preserved', () => {
    const r = parseReminder('Call Sam in 20 min', NOW);
    expect(r.text).toBe('Call Sam');
    expect(r.dueAt).toBe(NOW + 20 * 60_000);
  });
  it('tomorrow 9am', () => {
    const r = parseReminder('Pay rent tomorrow 9am', NOW);
    expect(r.text).toBe('Pay rent');
    const d = new Date(r.dueAt ?? 0);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([13, 9, 0]);
  });
  it('bare past time rolls to tomorrow, future time stays today', () => {
    expect(new Date(parseReminder('Email Ana 9:30', NOW).dueAt ?? 0).getDate()).toBe(13);
    expect(new Date(parseReminder('Email Ana 14:30', NOW).dueAt ?? 0).getDate()).toBe(12);
  });
  it('recurring daily and weekly', () => {
    const daily = parseReminder('Stand up every day 9am', NOW);
    expect(daily.recur).toBe('daily');
    expect(new Date(daily.dueAt ?? 0).getDate()).toBe(13); // today's 9am passed
    const gym = parseReminder('Gym every monday 18:30', NOW);
    expect(gym.recur).toBe('weekly');
    expect(new Date(gym.dueAt ?? 0).getDay()).toBe(1);
    expect(gym.text).toBe('Gym');
  });
  it('plain text stays a task without a due time', () => {
    const r = parseReminder('Buy milk', NOW);
    expect(r).toEqual({ text: 'Buy milk' });
  });
  it('nextOccurrence skips weekends for weekdays', () => {
    const friday9 = new Date('2026-11-13T09:00:00').getTime();
    const next = nextOccurrence(friday9, 'weekdays', undefined, friday9 + 1000);
    expect(new Date(next).getDay()).toBe(1); // Monday
  });
  it('handles "9am tomorrow" word order and bare "tomorrow" (defaults 09:00)', () => {
    const a = parseReminder('Call Ana 9am tomorrow', NOW);
    expect(a.text).toBe('Call Ana');
    expect(new Date(a.dueAt ?? 0).getDate()).toBe(13);
    const b = parseReminder('Submit report tomorrow', NOW);
    const d = new Date(b.dueAt ?? 0);
    expect([d.getDate(), d.getHours()]).toEqual([13, 9]);
  });
  it('weekly on the same weekday after the time lands next week', () => {
    // NOW is Thursday 10:00; "every thursday 9am" already passed today.
    const r = parseReminder('Review every thursday 9am', NOW);
    const d = new Date(r.dueAt ?? 0);
    expect(d.getDay()).toBe(4);
    expect(d.getDate()).toBe(19);
  });
  it('nextOccurrence catches up a daily that is days behind in one step', () => {
    const monday9 = new Date('2026-11-09T09:00:00').getTime();
    const next = nextOccurrence(monday9, 'daily', undefined, NOW);
    expect(next).toBe(new Date('2026-11-13T09:00:00').getTime());
  });
});

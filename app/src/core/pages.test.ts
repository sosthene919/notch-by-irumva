import { describe, expect, it } from 'vitest';
import { movePage, orderPages, pageTitle } from './pages';

const ALL = ['Today', 'Music', 'Focus', 'Shelf', 'Reminders', 'Water', 'Devices'];

describe('orderPages', () => {
  it('keeps canonical order by default', () => {
    expect(orderPages(ALL, [], [])).toEqual(ALL);
  });
  it('applies user order and drops hidden and unknown names', () => {
    expect(orderPages(ALL, ['Music', 'Today', 'Nope'], ['Water']))
      .toEqual(['Music', 'Today', 'Focus', 'Shelf', 'Reminders', 'Devices']);
  });
  it('never returns an empty hub', () => {
    expect(orderPages(ALL, [], ALL)).toEqual(ALL);
  });
});

describe('pageTitle', () => {
  it('uses the 1.1.0 display titles without renaming canonical pages', () => {
    expect(pageTitle('Focus')).toBe('Pomodoro');
    expect(pageTitle('Reminders')).toBe('TodoList');
    expect(pageTitle('Today')).toBe('Today');
    expect(pageTitle('Music')).toBe('Music');
    expect(pageTitle('Unknown')).toBe('Unknown');
  });
});

describe('movePage', () => {
  it('swaps neighbours and stops at the ends', () => {
    expect(movePage([], ALL, 'Music', -1)[0]).toBe('Music');
    expect(movePage([], ALL, 'Today', -1)[0]).toBe('Today');
    const moved = movePage([], ALL, 'Focus', 1);
    expect(moved.indexOf('Focus')).toBe(3);
    expect(moved.indexOf('Shelf')).toBe(2);
  });
});

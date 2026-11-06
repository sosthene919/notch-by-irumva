import { describe, expect, it } from 'vitest';
import { ClipboardHistory, FileShelf, filterApps, findJoinUrl, looksSensitive, nextEvent, parseIcs } from './stores';

describe('file shelf', () => {
  it('adds items with 24h expiry and prunes expired ones', () => {
    const shelf = new FileShelf(1000);
    shelf.add('C:\\docs\\report.pdf', 0);
    shelf.add('C:\\pics\\cat.png', 100);
    expect(shelf.list(500).map((i) => i.name)).toEqual(['cat.png', 'report.pdf']);
    expect(shelf.list(500)[0]?.kind).toBe('image');
    expect(shelf.list(1500)).toEqual([]);
  });
});

describe('clipboard history', () => {
  it('dedupes, skips sensitive-looking content, and search works', () => {
    const h = new ClipboardHistory(3);
    expect(h.add('hello world', 1)?.text).toBe('hello world');
    expect(h.add('hello world', 2)).toBeNull();
    expect(h.add('Str0ng!Passw0rdXYZ', 3)).toBeNull();
    expect(looksSensitive('4111 1111 1111 1111')).toBe(true);
    h.add('second note', 4);
    expect(h.search('NOTE')).toHaveLength(1);
    expect(h.search('')).toHaveLength(2);
  });
  it('pins survive capacity eviction', () => {
    const h = new ClipboardHistory(2);
    const first = h.add('keep me', 1)!;
    h.pin(first.id);
    h.add('a', 2); h.add('b', 3); h.add('c', 4);
    expect(h.list().map((i) => i.text)).toContain('keep me');
  });
});

describe('launcher filter', () => {
  it('filters by name, capped', () => {
    const apps = [{ name: 'Code', path: 'c' }, { name: 'Calculator', path: 'x' }, { name: 'Calendar', path: 'y' }];
    expect(filterApps(apps, 'cal').map((a) => a.name)).toEqual(['Calculator', 'Calendar']);
    expect(filterApps(apps, '')).toHaveLength(3);
  });
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'DTSTART:20300101T100000Z',
  'DTEND:20300101T110000Z',
  'SUMMARY:Future planning',
  'DESCRIPTION:Join us https://teams.microsoft.com/l/meetup-join/abc',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20200101T100000Z',
  'SUMMARY:Old event',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('ics calendar', () => {
  it('parses events, finds the next one and its join link', () => {
    const events = parseIcs(ICS);
    expect(events).toHaveLength(2);
    const next = nextEvent(events, Date.UTC(2029, 0, 1));
    expect(next?.title).toBe('Future planning');
    expect(next?.joinUrl).toContain('teams.microsoft.com');
    expect(findJoinUrl('meet at https://meet.google.com/abc-defg-hij now')).toContain('meet.google.com');
  });
});

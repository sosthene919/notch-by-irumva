import { describe, expect, it } from 'vitest';
import { activeLineIndex, interpretLookup, parseLrc, trackCacheKey } from './lyrics';

describe('LRC parsing', () => {
  it('parses stamps, multiple stamps per line, and sorts', () => {
    const lines = parseLrc('[00:10.00]second\n[00:05.50][00:07.25]first\n[ti:ignored]\nplain line');
    expect(lines.map((l) => l.text)).toEqual(['first', 'first', 'second']);
    expect(lines[0]?.t).toBeCloseTo(5.5);
    expect(lines[2]?.t).toBeCloseTo(10);
  });
  it('active line follows position plus offset, -1 before the first line', () => {
    const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:20.00]c');
    expect(activeLineIndex(lines, 3)).toBe(-1);
    expect(activeLineIndex(lines, 5)).toBe(0);
    expect(activeLineIndex(lines, 12)).toBe(1);
    expect(activeLineIndex(lines, 19, 2)).toBe(2); // offset pulls lines earlier
    expect(activeLineIndex(lines, 99)).toBe(2);
  });
  it('applies the LRC [offset:] tag and decodes entities', () => {
    const lines = parseLrc('[offset:+500]\r\n[00:10.00]Tom &amp; Jerry\r\n[00:12.00]&quot;quoted&quot;');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.t).toBeCloseTo(10.5);
    expect(lines[0]?.text).toBe('Tom & Jerry');
    expect(lines[1]?.text).toBe('"quoted"');
  });
});

describe('lookup interpretation', () => {
  it('maps synced, plain, instrumental, none and offline', () => {
    expect(interpretLookup({ status: 'synced', syncedLyrics: '[00:01.00]hi', plainLyrics: 'hi' }).status).toBe('synced');
    expect(interpretLookup({ status: 'plain', plainLyrics: 'words' })).toMatchObject({ status: 'plain', plainText: 'words' });
    expect(interpretLookup({ status: 'instrumental' }).status).toBe('instrumental');
    expect(interpretLookup({ status: 'none' }).status).toBe('none');
    expect(interpretLookup(null).status).toBe('offline');
  });
  it('an answer claiming synced with unparseable text falls back honestly', () => {
    expect(interpretLookup({ status: 'synced', syncedLyrics: 'no stamps here', plainLyrics: 'words' }).status).toBe('plain');
    expect(interpretLookup({ status: 'synced', syncedLyrics: 'no stamps here' }).status).toBe('none');
  });
  it('cache key includes album and duration', () => {
    const base = { title: 'Song', artist: 'Singer', album: 'Album', durationSec: 200 };
    expect(trackCacheKey(base)).toBe('Song|Singer|Album|200');
    expect(trackCacheKey({ ...base, album: 'Other' })).not.toBe(trackCacheKey(base));
  });
});

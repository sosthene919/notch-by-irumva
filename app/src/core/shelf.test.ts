import { describe, expect, it } from 'vitest';
import { mergeShelfEntries, normalizeShelfEntries, pruneShelf, SHELF_MAX_AGE_MS } from './shelf';

const NOW = 1_000_000_000_000;

describe('shelf bookkeeping', () => {
  it('migrates legacy string paths and keeps entry shape', () => {
    const out = normalizeShelfEntries(['C:\\a.txt', { path: 'C:\\b.txt', addedAt: 5 }, 42, null], NOW);
    expect(out).toEqual([
      { path: 'C:\\a.txt', addedAt: NOW },
      { path: 'C:\\b.txt', addedAt: 5 },
    ]);
    expect(normalizeShelfEntries('nope', NOW)).toEqual([]);
  });
  it('prunes missing and old files, dedupes case-insensitively', () => {
    const entries = [
      { path: 'C:\\keep.txt', addedAt: NOW - 1000 },
      { path: 'c:\\KEEP.txt', addedAt: NOW - 900 },
      { path: 'C:\\gone.txt', addedAt: NOW - 1000 },
      { path: 'C:\\old.txt', addedAt: NOW - SHELF_MAX_AGE_MS },
    ];
    const kept = pruneShelf(entries, (p) => p !== 'C:\\gone.txt', NOW);
    expect(kept.map((e) => e.path)).toEqual(['C:\\keep.txt']);
  });
  it('merge dedupes by case, preserves dates, caps at 24', () => {
    const existing = [{ path: 'C:\\A.txt', addedAt: 1 }];
    const merged = mergeShelfEntries(existing, ['c:\\a.txt', 'C:\\B.txt'], NOW);
    expect(merged).toEqual([
      { path: 'C:\\A.txt', addedAt: 1 },
      { path: 'C:\\B.txt', addedAt: NOW },
    ]);
    const many = mergeShelfEntries([], Array.from({ length: 30 }, (_, i) => `C:\\f${i}.txt`), NOW);
    expect(many).toHaveLength(24);
  });
});

/** File shelf bookkeeping (pure, testable): persistence entries,
 *  migration, cleanup and merge rules. Files themselves never move;
 *  the shelf stores paths on this PC only. */

export interface ShelfEntry { path: string; addedAt: number }

export const SHELF_MAX_AGE_MS = 30 * 86_400_000;
export const SHELF_CAP = 24;

const keyOf = (p: string) => p.toLowerCase();

/** Accepts the current entry shape and the legacy plain-string shape. */
export function normalizeShelfEntries(raw: unknown, now: number): ShelfEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ShelfEntry[] = [];
  for (const e of raw) {
    if (typeof e === 'string' && e) out.push({ path: e, addedAt: now });
    else if (e && typeof e === 'object' && typeof (e as ShelfEntry).path === 'string') {
      const entry = e as ShelfEntry;
      out.push({ path: entry.path, addedAt: Number.isFinite(entry.addedAt) ? entry.addedAt : now });
    }
  }
  return out;
}

/** Drop entries whose file is gone or that outlived the max age,
 *  and collapse case-insensitive duplicates (Windows paths). */
export function pruneShelf(
  entries: ShelfEntry[],
  exists: (path: string) => boolean,
  now: number,
  maxAgeMs = SHELF_MAX_AGE_MS,
): ShelfEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (now - e.addedAt >= maxAgeMs) return false;
    if (!exists(e.path)) return false;
    const k = keyOf(e.path);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Merge newly dropped paths into stored entries (case-insensitive
 *  dedupe), capped, oldest entries keep their original dates. */
export function mergeShelfEntries(existing: ShelfEntry[], newPaths: string[], now: number, cap = SHELF_CAP): ShelfEntry[] {
  const merged = [...existing];
  const keys = new Set(existing.map((e) => keyOf(e.path)));
  for (const path of newPaths) {
    if (!path || keys.has(keyOf(path))) continue;
    keys.add(keyOf(path));
    merged.push({ path, addedAt: now });
  }
  return merged.slice(0, cap);
}

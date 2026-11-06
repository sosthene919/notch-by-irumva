/** Phase 5 stores: File Shelf, clipboard history, launcher filtering, calendar. */

export interface ShelfItem {
  id: string;
  name: string;
  path: string;
  kind: 'file' | 'text' | 'image';
  addedAt: number;
  expiresAt: number;
}

export class FileShelf {
  private items = new Map<string, ShelfItem>();
  constructor(private ttlMs = 24 * 60 * 60 * 1000) {}

  add(path: string, now = Date.now()): ShelfItem {
    const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const kind: ShelfItem['kind'] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext) ? 'image' : 'file';
    const item: ShelfItem = { id: `shelf-${path}`, name, path, kind, addedAt: now, expiresAt: now + this.ttlMs };
    this.items.set(item.id, item);
    return item;
  }
  addText(text: string, now = Date.now()): ShelfItem {
    const item: ShelfItem = {
      id: `shelf-text-${now}`, name: text.slice(0, 40) || 'Text snippet', path: text,
      kind: 'text', addedAt: now, expiresAt: now + this.ttlMs,
    };
    this.items.set(item.id, item);
    return item;
  }
  remove(id: string): void { this.items.delete(id); }
  list(now = Date.now()): ShelfItem[] {
    for (const [id, item] of this.items) if (item.expiresAt <= now) this.items.delete(id);
    return [...this.items.values()].sort((a, b) => b.addedAt - a.addedAt);
  }
  toJSON(): ShelfItem[] { return this.list(); }
  restore(items: ShelfItem[]): void {
    this.items.clear();
    for (const i of items) if (i.expiresAt > Date.now()) this.items.set(i.id, i);
  }
}

// ---------- clipboard ----------
export interface ClipItem { id: string; text: string; at: number; pinned: boolean }

const SENSITIVE_PATTERNS = [
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])\S{12,}$/, // password-like: mixed classes, no spaces
  /\b\d{13,19}\b/, // long digit runs (cards etc.)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** Heuristic only — see ASSUMPTIONS: there is no documented API to know
 *  that a password manager placed the current clipboard content. */
export function looksSensitive(text: string): boolean {
  if (SENSITIVE_PATTERNS.some((re) => re.test(text))) return true;
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(digits);
}

export class ClipboardHistory {
  private items: ClipItem[] = [];
  constructor(private capacity = 50) {}

  /** Returns the new item, or null when skipped (duplicate/empty/sensitive). */
  add(text: string, now = Date.now()): ClipItem | null {
    const clean = text.trim();
    if (!clean || clean.length > 10_000) return null;
    if (looksSensitive(clean)) return null;
    if (this.items[0]?.text === clean) return null;
    this.items = this.items.filter((i) => i.text !== clean);
    const item: ClipItem = { id: `clip-${now}-${Math.abs(hashCode(clean))}`, text: clean, at: now, pinned: false };
    this.items.unshift(item);
    // Evict oldest unpinned beyond capacity; pinned items are kept.
    while (this.items.filter((i) => !i.pinned).length > this.capacity) {
      const idx = this.items.map((i) => i.pinned).lastIndexOf(false);
      if (idx < 0) break;
      this.items.splice(idx, 1);
    }
    return item;
  }
  pin(id: string): void { const i = this.items.find((x) => x.id === id); if (i) i.pinned = !i.pinned; }
  remove(id: string): void { this.items = this.items.filter((i) => i.id !== id); }
  search(q: string): ClipItem[] {
    const needle = q.trim().toLowerCase();
    return needle ? this.items.filter((i) => i.text.toLowerCase().includes(needle)) : [...this.items];
  }
  list(): ClipItem[] { return [...this.items]; }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// ---------- launcher ----------
export interface AppEntryLike { name: string; path: string }
export function filterApps(apps: AppEntryLike[], query: string): AppEntryLike[] {
  const q = query.trim().toLowerCase();
  if (!q) return apps.slice(0, 30);
  return apps.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 30);
}

// ---------- calendar (.ics import) ----------
export interface CalendarEvent {
  title: string;
  start: number;
  end?: number;
  location?: string;
  joinUrl?: string;
}

const JOIN_PATTERNS = [
  /https:\/\/[^\s"']*teams\.microsoft\.com[^\s"']*/i,
  /https:\/\/[^\s"']*zoom\.us[^\s"']*/i,
  /https:\/\/meet\.google\.com[^\s"']*/i,
];

export function findJoinUrl(text: string): string | undefined {
  for (const re of JOIN_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0].replace(/[)>.,]+$/, '');
  }
  return undefined;
}

function parseIcsDate(value: string): number {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return NaN;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const h = Number(m[4] ?? 0); const mi = Number(m[5] ?? 0); const s = Number(m[6] ?? 0);
  return m[7] ? Date.UTC(y, mo - 1, d, h, mi, s) : new Date(y, mo - 1, d, h, mi, s).getTime();
}

/** Minimal RFC 5545 reader: VEVENT blocks, line unfolding, UTC/floating times. */
export function parseIcs(text: string): CalendarEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events: CalendarEvent[] = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const end = block.indexOf('END:VEVENT');
    const body = end >= 0 ? block.slice(0, end) : block;
    const get = (key: string) => {
      const m = body.match(new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'm'));
      return m?.[1] ? m[1].trim().replace(/\\,/g, ',') : undefined;
    };
    const startRaw = get('DTSTART');
    const title = get('SUMMARY');
    if (!startRaw || !title) continue;
    const start = parseIcsDate(startRaw);
    if (Number.isNaN(start)) continue;
    const endRaw = get('DTEND');
    const description = `${get('DESCRIPTION') ?? ''} ${get('URL') ?? ''} ${get('LOCATION') ?? ''}`;
    events.push({
      title, start,
      end: endRaw ? parseIcsDate(endRaw) : undefined,
      location: get('LOCATION'),
      joinUrl: findJoinUrl(description),
    });
  }
  return events.sort((a, b) => a.start - b.start);
}

export function nextEvent(events: CalendarEvent[], now = Date.now()): CalendarEvent | undefined {
  return events.find((e) => (e.end ?? e.start) >= now);
}

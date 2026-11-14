/**
 * Synced lyrics from LRCLib (https://lrclib.net), a community lyrics
 * database. For each track Notch sends only the title, artist and
 * duration. Responses are cached on this PC (Rust file cache) and the
 * feature can be switched off in Settings, in which case nothing is
 * ever sent. Lyrics text belongs to its respective owners; it is
 * displayed locally for the track you are playing, never redistributed.
 */

export interface LyricLine { t: number; text: string }

export type LyricsStatus = 'synced' | 'plain' | 'none' | 'instrumental' | 'offline';
export interface LyricsResult { status: LyricsStatus; lines: LyricLine[]; plainText?: string }

/** Raw answer from the Rust LRCLib lookup (lyrics_lookup command). */
export interface LookupRaw { status: string; syncedLyrics?: string | null; plainLyrics?: string | null }

/** Map a lookup answer to a view state. A null answer means the
 *  request itself failed (network down, timeout): the offline state. */
export function interpretLookup(raw: LookupRaw | null): LyricsResult {
  if (!raw) return { status: 'offline', lines: [] };
  if (raw.status === 'instrumental') return { status: 'instrumental', lines: [] };
  const lines = raw.syncedLyrics ? parseLrc(raw.syncedLyrics) : [];
  if (lines.length > 0) return { status: 'synced', lines, plainText: raw.plainLyrics ?? undefined };
  if (raw.plainLyrics) return { status: 'plain', lines: [], plainText: raw.plainLyrics };
  return { status: 'none', lines: [] };
}

const STAMP = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse LRC text into time-ordered lines. Lines with no text keep a
 *  blank entry (instrumental gaps still advance the scroll). The
 *  [offset:] metadata tag (milliseconds) shifts every line. */
export function parseLrc(lrc: string): LyricLine[] {
  const offsetMs = Number(lrc.match(/\[offset:\s*([+-]?\d+)\s*\]/i)?.[1] ?? 0);
  const out: LyricLine[] = [];
  // Untrusted input: cap line count and line length hard.
  for (const raw of lrc.split(/\r?\n/, 1000)) {
    const stamps = [...raw.matchAll(STAMP)];
    if (stamps.length === 0) continue;
    const text = decodeEntities(raw.replace(STAMP, '').trim()).slice(0, 300);
    for (const m of stamps) {
      const frac = (m[3] ?? '0').padEnd(3, '0').slice(0, 3);
      const t = Number(m[1]) * 60 + Number(m[2]) + Number(frac) / 1000 + offsetMs / 1000;
      out.push({ t: Math.max(0, t), text });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out.slice(0, 500);
}

/** Index of the line that should be in focus at `positionSec`
 *  (plus the user's timing offset). -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], positionSec: number, offsetSec = 0): number {
  const at = positionSec + offsetSec;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i]?.t ?? Infinity) <= at) idx = i;
    else break;
  }
  return idx;
}

export interface LyricsTrack { title: string; artist: string; album: string; durationSec: number }

export const trackCacheKey = (t: LyricsTrack) => `${t.title}|${t.artist}|${t.album}|${Math.round(t.durationSec)}`;

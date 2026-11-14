import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Activity, BtDevice, IslandState, ShelfItem, TodoItem, WaterState } from '../core/types';
import { formatBytes } from '../core/productivity';
import { activeLineIndex, type LyricLine } from '../media/lyrics';
import { parseReminder } from '../core/remindParse';
import { buildToday, displayTodoText } from '../core/today';
import { HUB_PAGE_NAMES, orderPages, pageTitle } from '../core/pages';
import type { MediaSessionInfo } from '../platform/native';
import { usePrefersReducedMotion, useSpringSize, type Size } from '../hooks/useSpringSize';
import { isTauri, openSettingsPopup, setClickThrough, setHoverRegion } from '../platform/window';
import { Button } from './ui';
import { BatteryPill, SegmentedLevel } from './hud';
import { IconBell, IconBluetooth, IconBolt, IconCalendar, IconCheck, IconCoffee, IconDrop, IconEarbuds, IconEdit, IconFile, IconGear, IconHeadphones, IconKeyboard, IconLyrics, IconMouse, IconMusic, IconMuted, IconNext, IconPause, IconPlay, IconPlus, IconPrev, IconRepeat, IconReset, IconShuffle, IconSpeaker, IconTarget, IconTimer, IconVolume, IconX } from './icons';

/* Overall notch scale: the island is designed at the sizes it had
   before the slimming requests, then rendered NOTCH_SCALE smaller
   via a transform on .island-clip in Island() below — so every view
   keeps its exact layout, just smaller. 1.2.0 overshot the shrink
   (0.65 / 35% down); 1.2.5 restores +18% — the sweet spot between
   that and the pre-slim size: NOTCH_SCALE 0.65 -> 0.77 and every
   visual size below x1.18, so the *design* size (visual / scale)
   is unchanged and only the rendered notch grows. SIZES are the
   *visual* (scaled) sizes: they drive the spring, the Rust hover
   region and centering. Keep the widest view plus its ~13px ears
   inside the shell window (472x260 in tauri.conf.json /
   platform/window.ts). */
export const NOTCH_SCALE = 0.77;
const SIZES: Record<IslandState['view'], Size> = {
  // Closed pill heights +~15% in 1.2.6 (26->30, 27->31): the slim
  // pill read as a sliver against the taskbar. Open views grew too
  // (expanded 138->154, full 178->194, peek wider/taller) so every
  // hub page and the expanded song/notification views fit inside
  // the notch without their bottom rows being clipped — see the
  // per-page compact rules (.focus-page/.music-page/.water-page)
  // in app.css. All still fit the 472x260 shell with ears to spare.
  collapsed: { width: 129, height: 30 },
  compact: { width: 224, height: 31 },
  minimal: { width: 276, height: 31 },
  peek: { width: 300, height: 58 },
  expanded: { width: 396, height: 154 },
  full: { width: 430, height: 194 },
};

/** Live status shown in the collapsed pill and on every hub page
 *  (1.1.0 reference screens: charging bolt, date + time, alert bell). */
export interface IslandStatus {
  charging: boolean;
  batteryPercent: number | null;
  alert: boolean;
}

export interface IslandActions {
  onMediaControl(action: 'play' | 'pause' | 'toggle' | 'next' | 'previous'): void;
  onMediaSeek(seconds: number): void;
  onShuffle(active: boolean): void;
  onRepeat(mode: string): void;
  onLyricsOffset(deltaSeconds: number): void;
  onReminderDone(todoId: number): void;
  onReminderSnooze(todoId: number, minutes: number): void;
  onTimer(action: 'countdown' | 'stopwatch' | 'stop' | 'pause' | 'resume', minutes?: number): void;
  onVolume(level: number): void;
  onVolumeStep(delta: number): void;
  onMute(): void;
}

export interface LyricsView {
  status: 'idle' | 'loading' | 'synced' | 'plain' | 'none' | 'instrumental' | 'offline';
  lines: LyricLine[];
  plainText?: string;
  basePosition: number;
  updatedAt: number;
  playing: boolean;
  offsetSec: number;
}

export interface MediaView {
  sessions: MediaSessionInfo[];
  source: string | null;
  onSelectSource(app: string | null): void;
}

export interface HubData {
  shelf: {
    items: ShelfItem[];
    onRemove(path: string): void;
    onOpen(path: string): void;
    onReveal(path: string): void;
    onCopyPaths(paths: string[]): void;
    onClear(): void;
  };
  todos: {
    items: TodoItem[];
    onAdd(text: string, dueAt?: number, recur?: TodoItem['recur'], weekday?: number): void;
    onToggle(id: number): void;
    onRemove(id: number): void;
  };
  water: {
    state: WaterState;
    onDrink(): void;
    onBottle(ml: number): void;
    onGoal(ml: number): void;
    onInterval(min: number): void;
  };
}

/** Open views (peek/expanded/full) collapse after this long without input. */
export const AUTO_HIDE_MS = 5000;

/** Press-and-hold time that opens the full hub. 320ms in 1.2.6 (was
 *  500ms): the half-second hold plus the old spring tail made opening
 *  the hub feel sluggish. Still well above a click, so taps never
 *  trigger it. */
export const LONG_PRESS_MS = 320;

interface Props {
  state: IslandState;
  activities: Activity[];
  onEvent: (e: 'HOVER_ENTER' | 'HOVER_LEAVE' | 'CLICK' | 'LONG_PRESS' | 'ESCAPE' | 'AUTO_HIDE') => void;
  onDismiss: (id: string) => void;
  actions: IslandActions;
  scale?: number;
  minimalPill?: boolean;
  showPreviews?: boolean;
  hubOrder?: string[];
  hubHidden?: string[];
  hub: HubData;
  devices: BtDevice[];
  media: MediaView;
  lyrics: LyricsView;
  onShelfDrop(paths: string[]): void;
  status?: IslandStatus;
  /** True while a fullscreen or maximized app owns the monitor:
   *  fade/slide out. The Rust watcher hides the window itself
   *  moments later. (Prop name kept from 1.1.0; since 1.2.6 the
   *  watcher covers maximized windows too.) */
  fsHidden?: boolean;
  /** Keep the window accepting clicks even while collapsed. Used by
   *  the safe-mode notice, which lives outside the pill. */
  blockClickThrough?: boolean;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const HUB_PAGES = HUB_PAGE_NAMES;

export function DeviceIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const p = { width: size, height: size };
  switch (kind) {
    case 'earbuds': return <IconEarbuds {...p} />;
    case 'headphones': return <IconHeadphones {...p} />;
    case 'mouse': return <IconMouse {...p} />;
    case 'keyboard': return <IconKeyboard {...p} />;
    case 'speaker': return <IconSpeaker {...p} />;
    default: return <IconBluetooth {...p} />;
  }
}

/** Battery ring: solid arc, neutral, #FF4500 only at 10% or lower.
 *  Draws from empty to the value with ease-out on first appearance,
 *  then updates in place (no replay, per brief section 5). */
export function BatteryRing({ percent, size = 34 }: { percent: number; size?: number }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const c = 2 * Math.PI * 15.5;
  const shown = entered ? Math.max(0, Math.min(100, percent)) : 0;
  return (
    <span className="ring-wrap" style={{ width: size, height: size }} role="img" aria-label={`Battery ${percent} percent`}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="ring-track" />
        <circle
          cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
          className={percent <= 10 ? 'ring-arc low' : 'ring-arc'}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown / 100)}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span className="ring-pct tnum">{percent}</span>
    </span>
  );
}

/** Idle album cover (1.2.5): shown in the Music pane when no track
 *  supplies art — including "nothing is playing". A vinyl disc, not
 *  the old flat grey square + note from the screenshot: graphite
 *  grooves turning slowly under a fixed red label (the one music
 *  accent), with a single static sheen. The disc spins, the label
 *  does not, so the glyph stays legible. Reduced motion stops the
 *  spin via the global media query in app.css. */
export function IdleArtwork() {
  return (
    <span className="music-art2 music-art-idle" aria-hidden="true">
      <span className="idle-disc" />
      <span className="idle-label"><IconMusic width={13} height={13} /></span>
      <span className="idle-sheen" />
    </span>
  );
}

/** Direct-manipulation seek bar: drag (or arrow keys) scrubs the system
 *  media session. The fill follows the pointer during the drag; the seek
 *  commits on release. */
function Scrubber({ position, duration, onSeek }: { position: number; duration: number; onSeek: (s: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const ratio = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const shown = drag ?? ratio;
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  };
  return (
    <div
      ref={ref}
      className="scrub"
      data-noclick=""
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown * duration)}
      tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(fromEvent(e)); }}
      onPointerMove={(e) => { if (drag !== null) setDrag(fromEvent(e)); }}
      onPointerUp={() => { if (drag !== null) { onSeek(drag * duration); setDrag(null); } }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(duration, position + 10));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, position - 10));
      }}
    >
      <span style={{ width: `${shown * 100}%` }} />
    </div>
  );
}

/** Charging bolt + date + time, the shared status strip from the
 *  1.1.0 reference screens (collapsed pill and every hub page). */
export function StatusStrip({ now, status, withDate = true }: { now: Date; status?: IslandStatus; withDate?: boolean }) {
  return (
    <span className="status-strip">
      <span
        className={`bolt-badge${status?.charging ? ' on' : ''}`}
        role="img"
        aria-label={status?.charging
          ? `Charging${status.batteryPercent !== null && status?.batteryPercent !== undefined ? `, ${status.batteryPercent} percent` : ''}`
          : 'Battery'}
      >
        <IconBolt width={11} height={11} />
      </span>
      {withDate && (
        <span className="status-date">
          {now.toLocaleDateString([], { weekday: 'short' })} {now.getDate()}{' '}
          {now.toLocaleDateString([], { month: 'short' })} {now.getFullYear()}
        </span>
      )}
      <strong className="status-time tnum">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
      </strong>
    </span>
  );
}

export function Island({ state, activities, onEvent, onDismiss, actions, scale = 1, minimalPill = false, showPreviews = true, hubOrder, hubHidden, hub, devices, media, lyrics, onShelfDrop, status, fsHidden = false, blockClickThrough = false }: Props) {
  const reduced = usePrefersReducedMotion();
  const sizes = useMemo(() => Object.fromEntries(
    Object.entries(SIZES).map(([k, v]) => [k, { width: Math.round(v.width * scale), height: Math.round(v.height * scale) }]),
  ) as Record<IslandState['view'], Size>, [scale]);
  // Growing open (expanded/full) uses the stiffer `expand` spring:
  // the old settle spring's long tail made opening the hub feel
  // laggy (1.2.6). Collapsing keeps the calm `settle` spring.
  const size = useSpringSize(
    sizes[state.view],
    reduced,
    state.view === 'peek' ? 'peek'
      : state.view === 'expanded' || state.view === 'full' ? 'expand'
      : 'settle',
  );
  const pressTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const primary = activities.find((a) => a.id === state.primaryId) ?? null;
  const bubble = activities.find((a) => a.id === state.bubbleId) ?? null;

  const [page, setPage] = useState(0);
  const pages = useMemo(
    () => orderPages(HUB_PAGES, hubOrder ?? [], hubHidden ?? []),
    [hubOrder, hubHidden],
  );
  const pageIdx = Math.min(page, pages.length - 1);
  const pageName = pages[pageIdx];
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const today = buildToday(hub.todos.items, new Date());
  const [focusPreset, setFocusPreset] = useState(25);
  const [showLyrics, setShowLyrics] = useState(false);
  const [todoText, setTodoText] = useState('');
  const [todoEdit, setTodoEdit] = useState(false);
  const todoInputRef = useRef<HTMLInputElement>(null);
  const [shelfSelected, setShelfSelected] = useState<ReadonlySet<string>>(new Set());
  const wheelLast = useRef(0);
  // Hub pages slide in from the side they were navigated towards.
  const [pageDir, setPageDir] = useState<1 | -1>(1);
  const goPage = (next: number, dir?: 1 | -1) => {
    const len = pagesRef.current.length;
    if (len === 0) return;
    setPageDir(dir ?? (next >= pageIdx ? 1 : -1));
    setPage(((next % len) + len) % len);
  };

  // Lyric position interpolation between the media session's 5 s ticks.
  const [lyrNow, setLyrNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showLyrics || !lyrics.playing || lyrics.status !== 'synced') return;
    const t = window.setInterval(() => setLyrNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [showLyrics, lyrics.playing, lyrics.status]);
  const lyricPosition = lyrics.basePosition + (lyrics.playing ? Math.max(0, (lyrNow - lyrics.updatedAt) / 1000) : 0);
  const lyricIndex = lyrics.status === 'synced' ? activeLineIndex(lyrics.lines, lyricPosition, lyrics.offsetSec) : -1;

  useEffect(() => {
    void setClickThrough(state.view === 'collapsed' && !blockClickThrough);
  }, [state.view, blockClickThrough]);
  useEffect(() => { void setHoverRegion(sizes[state.view].width, sizes[state.view].height); }, [state.view, sizes]);
  const interactive = state.view !== 'collapsed' || blockClickThrough;

  // Live clock for the status strip (collapsed pill + hub header).
  // One 1s tick while the island is on screen; minimal pill mode
  // still shows the plain dot instead.
  const [clockNow, setClockNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // File shelf: files dragged anywhere onto the window land on the
  // shelf; dragging over the notch opens the hub on the Shelf page.
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'enter' || event.payload.type === 'over') {
            setPage(Math.max(0, pagesRef.current.indexOf('Shelf')));
            if (state.view !== 'full') onEvent('LONG_PRESS');
          } else if (event.payload.type === 'drop') {
            if (event.payload.paths.length > 0) onShelfDrop(event.payload.paths);
          }
        });
      } catch { /* drag-drop unavailable in this shell */ }
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-hide: while peek/expanded/full, collapse 5 s after the last
  // pointer or keyboard interaction. Fires even when pinned.
  const armIdleTimer = () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (state.view === 'peek' || state.view === 'expanded' || state.view === 'full') {
      idleTimer.current = window.setTimeout(() => onEvent('AUTO_HIDE'), AUTO_HIDE_MS);
    }
  };
  useEffect(() => {
    armIdleTimer();
    return () => { if (idleTimer.current) window.clearTimeout(idleTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view, state.primaryId]);

  const startPress = () => {
    armIdleTimer();
    pressTimer.current = window.setTimeout(() => onEvent('LONG_PRESS'), LONG_PRESS_MS);
  };
  const endPress = (longFired: boolean, target: EventTarget | null) => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    if (target instanceof HTMLElement && target.closest('button, input, label, a, [data-noclick]')) return;
    if (!longFired) onEvent('CLICK');
  };

  const peekTodoId = typeof primary?.data?.todoId === 'number' ? primary.data.todoId : null;
  const nowPlaying = activities.find((a) => a.kind === 'now-playing') ?? null;
  const timerAct = activities.find((a) => a.kind === 'timer' || a.kind === 'stopwatch') ?? null;
  const volumeAct = activities.find((a) => a.kind === 'volume') ?? null;
  const timerPaused = timerAct?.data?.paused === true;
  const timerRemaining = timerAct ? Number(timerAct.data?.remainingSeconds ?? NaN) : NaN;
  const focusFrac = Number.isFinite(timerRemaining)
    ? Math.max(0, Math.min(1, timerRemaining / (focusPreset * 60)))
    : 0;

  const addTodo = () => {
    if (!todoText.trim()) return;
    const parsed = parseReminder(todoText);
    hub.todos.onAdd(parsed.text, parsed.dueAt, parsed.recur, parsed.weekday);
    setTodoText('');
  };

  /* Boring-style transport: bare white glyphs, no button chrome.
     The play/pause glyph is simply larger. Shuffle/repeat/lyrics
     stay available as small grey glyphs at the end of the row. */
  const mediaControls = (a: Activity) => {
    const repeatMode = String(a.data?.repeat ?? 'none');
    return (
      <div className="transport">
        <button type="button" className="transport-btn" onClick={() => actions.onMediaControl('previous')} aria-label="Previous track"><IconPrev width={21} height={21} /></button>
        <button type="button" className="transport-btn transport-main" onClick={() => actions.onMediaControl('toggle')} aria-label={a.data?.status === 'playing' ? 'Pause' : 'Play'}>
          {a.data?.status === 'playing' ? <IconPause width={24} height={24} /> : <IconPlay width={24} height={24} />}
        </button>
        <button type="button" className="transport-btn" onClick={() => actions.onMediaControl('next')} aria-label="Next track"><IconNext width={21} height={21} /></button>
        <span className="transport-extra">
          {typeof a.data?.shuffle === 'boolean' && (
            <button
              type="button" className={`transport-btn transport-sm${a.data.shuffle ? ' on' : ''}`}
              aria-label="Shuffle" aria-pressed={a.data.shuffle}
              onClick={() => actions.onShuffle(!(a.data?.shuffle))}
            >
              <IconShuffle width={16} height={16} />
            </button>
          )}
          {a.data?.repeatSupported === true && (
            <button
              type="button" className={`transport-btn transport-sm${repeatMode !== 'none' ? ' on' : ''}`}
              aria-label={`Repeat: ${repeatMode}`} aria-pressed={repeatMode !== 'none'}
              onClick={() => actions.onRepeat(repeatMode === 'none' ? 'track' : repeatMode === 'track' ? 'list' : 'none')}
            >
              <IconRepeat width={16} height={16} />{repeatMode === 'track' ? <span className="rep-one">1</span> : null}
            </button>
          )}
          <button type="button" className={`transport-btn transport-sm${showLyrics ? ' on' : ''}`} onClick={() => setShowLyrics((v) => !v)} aria-label="Lyrics" aria-pressed={showLyrics}><IconLyrics width={16} height={16} /></button>
        </span>
      </div>
    );
  };

  /* Now Playing pane (reference screens 1/3/5): big rounded art with
     a red music badge, title/artist/album, bare transport, and the
     equalizer bars on the right while playing. Used by the expanded
     view and the Music hub page. */
  const musicPane = (a: Activity | null) => (
    <div className="music-layout">
      <span className="music-artwrap" key={a ? `${a.title}|${typeof a.data?.art === 'string' ? a.data.art.slice(0, 32) : 'idle'}` : 'idle'}>
        {a && typeof a.data?.art === 'string'
          ? <img className="music-art2" src={a.data.art} alt="" width={92} height={92} />
          : <IdleArtwork />}
        {a && typeof a.data?.art === 'string' && (
          <span className="music-badge" aria-hidden="true"><IconMusic width={15} height={15} /></span>
        )}
      </span>
      <div className="music-info" key={a ? a.title : 'idle'}>
        <strong className="music-title2">{a ? a.title : 'Not Playing'}</strong>
        <span className="music-artist">{a ? (String(a.data?.artist ?? '') || (a.subtitle ?? '')) : 'Start music in any app and it appears here.'}</span>
        {a && typeof a.data?.album === 'string' && a.data.album && (
          <span className="music-album">{a.data.album}</span>
        )}
        {a ? mediaControls(a) : (
          <div className="transport" aria-hidden="true">
            <button type="button" className="transport-btn" disabled><IconPrev width={21} height={21} /></button>
            <button type="button" className="transport-btn transport-main" disabled><IconPlay width={24} height={24} /></button>
            <button type="button" className="transport-btn" disabled><IconNext width={21} height={21} /></button>
          </div>
        )}
        {a && (
          <div className="music-timeline">
            <span className="tnum">{fmtTime(Number(a.data?.positionSeconds ?? 0))}</span>
            <Scrubber
              position={Number(a.data?.positionSeconds ?? 0)}
              duration={Number(a.data?.durationSeconds ?? 0)}
              onSeek={actions.onMediaSeek}
            />
            <span className="tnum">-{fmtTime(Math.max(0, Number(a.data?.durationSeconds ?? 0) - Number(a.data?.positionSeconds ?? 0)))}</span>
          </div>
        )}
      </div>
      <span className={`eq eq-lg${a?.data?.status === 'playing' ? '' : ' eq-still'}`} aria-hidden="true"><i /><i /><i /><i /></span>
    </div>
  );

  const shortApp = (app: string) => (app.split(/[\\/!]/).filter(Boolean).pop() ?? app).replace(/\.exe$/i, '');

  const lyricsBlock = () => {
    if (!showLyrics || lyrics.status === 'idle') return null;
    if (lyrics.status === 'loading') return <p className="lyrics-empty">Loading lyrics.</p>;
    if (lyrics.status === 'offline') return <p className="lyrics-empty">You are offline. Lyrics load when a connection is back.</p>;
    if (lyrics.status === 'none') return <p className="lyrics-empty">No synced lyrics for this track in LRCLib.</p>;
    if (lyrics.status === 'instrumental') return <p className="lyrics-empty">This track is instrumental.</p>;
    if (lyrics.status === 'plain') return <div className="lyrics-plain">{lyrics.plainText}</div>;
    return (
      <div className="lyrics-box">
        <div
          className="lyrics-scroll"
          style={{ transform: `translateY(${(1 - Math.max(0, lyricIndex)) * 24}px)` }}
        >
          {lyrics.lines.map((l, i) => (
            <div key={`${l.t}-${i}`} className={`lyr-line${i === lyricIndex ? ' on' : ''}`}>{l.text || ' '}</div>
          ))}
        </div>
        <div className="lyrics-offset">
          <button type="button" onClick={() => actions.onLyricsOffset(-0.5)} aria-label="Lyrics earlier">−0.5s</button>
          <span className="tnum">Offset {lyrics.offsetSec > 0 ? '+' : ''}{lyrics.offsetSec.toFixed(1)}s</span>
          <button type="button" onClick={() => actions.onLyricsOffset(0.5)} aria-label="Lyrics later">+0.5s</button>
        </div>
      </div>
    );
  };

  return (
    <div className="island-wrap">
      <div
        className={`island island-${state.view}${fsHidden ? ' island-fs-hidden' : ''}`}
        style={{ width: size.width, height: size.height }}
        role="region"
        aria-label="Notch live activities"
        aria-live="polite"
        tabIndex={interactive ? 0 : -1}
        onMouseEnter={() => { armIdleTimer(); if (interactive) onEvent('HOVER_ENTER'); }}
        onMouseLeave={() => onEvent('HOVER_LEAVE')}
        onPointerMove={armIdleTimer}
        onWheel={(e) => {
          armIdleTimer();
          // Scroll over the island changes the volume (brief section 2).
          const now = performance.now();
          if (now - wheelLast.current < 60) return;
          wheelLast.current = now;
          actions.onVolumeStep(e.deltaY < 0 ? 0.03 : -0.03);
        }}
        onKeyDown={(e) => {
          armIdleTimer();
          if (e.key === 'Escape') onEvent('ESCAPE');
          if (state.view === 'full' && e.key === 'ArrowRight') goPage(pageIdx + 1, 1);
          if (state.view === 'full' && e.key === 'ArrowLeft') goPage(pageIdx - 1, -1);
        }}
        onPointerDown={startPress}
        onPointerUp={(e) => { armIdleTimer(); endPress(state.view === 'full', e.target); }}
      >
        <div
          className="island-clip"
          style={{
            width: size.width / NOTCH_SCALE,
            height: size.height / NOTCH_SCALE,
            transform: `scale(${NOTCH_SCALE})`,
          }}
        >
          {state.view === 'collapsed' && (
            <span className="view-in collapsed-face">
              {minimalPill
                ? <span className="island-dot" aria-label="Notch idle" />
                : (
                  <>
                    <StatusStrip now={clockNow} status={status} withDate={false} />
                    <span className="bell-badge" role="img" aria-label={status?.alert ? 'New notifications' : 'No new notifications'}>
                      <IconBell width={15} height={15} />
                      {status?.alert && <i className="bell-dot" aria-hidden="true" />}
                    </span>
                  </>
                )}
            </span>
          )}
          {(state.view === 'compact' || state.view === 'minimal') && primary && (
            <div className="compact-line view-in">
              {primary.kind === 'now-playing' && typeof primary.data?.art === 'string'
                ? <img className="compact-art" src={primary.data.art} alt="" width={24} height={24} />
                : primary.kind === 'now-playing' && primary.data?.status === 'playing' && (
                  <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>
                )}
              <span className="compact-title">{primary.title}</span>
              {primary.subtitle ? <span className="compact-sub">{primary.subtitle}</span> : null}
              {bubble && (
                <span className="bubble" title={bubble.title} aria-label={`Second activity: ${bubble.title}`}>
                  {bubble.title.slice(0, 1)}
                </span>
              )}
            </div>
          )}
          {state.view === 'peek' && primary && (
            <div className="peek-line peek-in">
              {primary.data?.deviceKind ? (
                typeof primary.data.battery === 'number' && primary.data.battery >= 0
                  ? <BatteryRing percent={primary.data.battery} size={36} />
                  : <span className="peek-icon"><DeviceIcon kind={String(primary.data.deviceKind)} size={17} /></span>
              ) : (
                <span className="peek-icon" aria-hidden="true">
                  {String(primary.data?.app ?? primary.title).slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="peek-text">
                <strong>{primary.title}</strong>
                <span>
                  {primary.kind === 'todo-reminder' && !showPreviews
                    ? 'Reminder due'
                    : primary.kind === 'device-connected' && typeof primary.data?.battery === 'number' && primary.data.battery >= 0
                    ? `Connected · ${primary.data.battery}%`
                    : (primary.subtitle ?? primary.kind)}
                </span>
              </span>
              {primary.kind === 'todo-reminder' && peekTodoId !== null && (
                <span className="peek-actions">
                  <Button variant="primary" onClick={() => actions.onReminderDone(peekTodoId)}>Done</Button>
                  <Button onClick={() => actions.onReminderSnooze(peekTodoId, 10)}>Snooze 10m</Button>
                </span>
              )}
            </div>
          )}
          {state.view === 'expanded' && primary?.kind === 'volume' && (
            /* Volume HUD (reference screen 2): speaker, big percent,
               segmented bar with a bloom on the lit ticks. */
            <div className="hud view-in">
              <div className="hud-top">
                <span className="hud-icon">
                  {primary.data?.muted ? <IconMuted width={26} height={26} /> : <IconVolume width={26} height={26} />}
                </span>
                <strong className="hud-pct tnum">
                  {primary.data?.muted ? 'Muted' : `${Math.round(Number(primary.data?.level ?? 0) * 100)}%`}
                </strong>
                <Button onClick={() => actions.onMute()}>{primary.data?.muted ? 'Unmute' : 'Mute'}</Button>
              </div>
              <SegmentedLevel
                level={Number(primary.data?.level ?? 0)}
                muted={primary.data?.muted === true}
                onSet={actions.onVolume}
              />
            </div>
          )}
          {state.view === 'expanded' && primary?.kind !== 'volume' && (
            <div className={`expanded-body view-in${showLyrics && primary?.kind === 'now-playing' && lyrics.status !== 'idle' ? ' has-lyrics' : ''}`}>
              <div className="expanded-head">
                <span className="brand-word">Notch by IRUMVA</span>
                <span className="head-actions">
                  <button type="button" className="gear-btn" aria-label="Open settings"
                    onClick={() => { void openSettingsPopup(); }}>
                    <IconGear width={17} height={17} />
                  </button>
                  <BatteryPill status={status} />
                  {primary && <Button onClick={() => onDismiss(primary.id)} aria-label={`Dismiss ${primary.title}`}>Dismiss</Button>}
                </span>
              </div>
              {primary?.kind === 'now-playing' ? musicPane(primary) : (primary?.kind === 'timer' || primary?.kind === 'stopwatch') ? (
                /* Expanded timer = mini Pomodoro (reference screen 1). */
                <div className="focus-layout">
                  <span className="focus-ring-lg focus-ring-sm" style={{ '--p': focusFrac || 1 } as CSSProperties} aria-hidden="true">
                    <span className="focus-ring-inner"><IconTimer width={34} height={34} /></span>
                  </span>
                  <div className="focus-side">
                    <div className="focus-time-row">
                      <strong className="focus-big tnum">{primary.subtitle ?? primary.title}</strong>
                      <button type="button" className="reset-btn" aria-label="Reset timer" onClick={() => actions.onTimer('stop')}>
                        <IconReset width={17} height={17} />
                      </button>
                    </div>
                    <span className="expanded-sub">{primary.title}</span>
                    <div className="focus-controls">
                      <Button onClick={() => actions.onTimer('stop')}>Stop</Button>
                      <button type="button" className="play-btn play-pill-red"
                        aria-label={timerPaused ? 'Resume' : 'Pause'}
                        onClick={() => actions.onTimer(timerPaused ? 'resume' : 'pause')}>
                        {timerPaused ? <IconPlay width={20} height={20} /> : <IconPause width={20} height={20} />}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <strong className="expanded-title">{primary?.title ?? 'Notch'}</strong>
                  {primary?.subtitle ? <p className="expanded-sub">{primary.subtitle}</p> : null}
                </>
              )}
              {primary?.kind === 'now-playing' && lyricsBlock()}
              {primary?.kind === 'todo-reminder' && peekTodoId !== null && (
                <div className="state-grid">
                  <Button variant="primary" onClick={() => actions.onReminderDone(peekTodoId)}>Done</Button>
                  {[5, 10, 30].map((m) => (
                    <Button key={m} onClick={() => actions.onReminderSnooze(peekTodoId, m)}>Snooze {m}m</Button>
                  ))}
                </div>
              )}
              {(primary?.kind === 'device-connected' || primary?.kind === 'device-low-battery') && (
                <div className="device-list">
                  {devices.filter((d) => d.connected).map((d) => (
                    <div key={d.id} className="device-row">
                      {d.battery !== null
                        ? <BatteryRing percent={d.battery} size={30} />
                        : <span className="peek-icon sm"><DeviceIcon kind={d.kind} size={14} /></span>}
                      <span className="device-name">{d.name}</span>
                      <span className="expanded-sub">{d.battery !== null ? '' : 'Battery not reported'}</span>
                    </div>
                  ))}
                </div>
              )}
              {activities.slice(1, 3).map((a) => (
                <div key={a.id} className="activity-row">
                  <span>{a.title}</span>
                  <Button onClick={() => onDismiss(a.id)} aria-label={`Dismiss ${a.title}`}>Dismiss</Button>
                </div>
              ))}
              {activities.length - 1 > 2 && (
                <p className="expanded-sub">+{activities.length - 3} more in the hub (press and hold)</p>
              )}
            </div>
          )}
          {state.view === 'full' && (
            <div className="hub view-in">
              {/* Expanded header (reference screens): page title on
                  the left, the charging-bolt + date + time status
                  strip centred, gear + battery pill on the right. */}
              <div className="hub-head">
                <span className="hub-title">{pageTitle(pageName ?? '')}</span>
                <span className="hub-status-center">
                  <StatusStrip now={clockNow} status={status} />
                </span>
                <span className="hub-topright">
                  <button type="button" className="gear-btn" aria-label="Open settings"
                    onClick={() => { void openSettingsPopup(); }}>
                    <IconGear width={17} height={17} />
                  </button>
                  <BatteryPill status={status} />
                </span>
              </div>
              <button type="button" className="hub-arrow hub-arrow-prev" aria-label="Previous page"
                onClick={() => goPage(pageIdx - 1, -1)}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 3 5l3.5 3.5" /></svg>
              </button>
              <button type="button" className="hub-arrow hub-arrow-next" aria-label="Next page"
                onClick={() => goPage(pageIdx + 1, 1)}>
                <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5l-3.5 3.5" /></svg>
              </button>

              {pageName === 'Today' && (
                <div key={pageName} className={`hub-page today-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  {/* Calendar pane (reference screens 1/5): huge month,
                      week strip with today in blue, then the day line. */}
                  <div className="cal-layout">
                    <div className="cal-main">
                      <div className="cal-head">
                        <strong className="cal-month">
                          {clockNow.toLocaleDateString([], { month: 'short' })}
                        </strong>
                        <div className="cal-strip" aria-label="This week">
                          {today.week.map(({ day, isToday }) => {
                            const past = !isToday && day.getTime() < new Date(clockNow).setHours(0, 0, 0, 0);
                            return (
                              <span key={day.toISOString()} className={`cal-day${isToday ? ' on' : past ? ' past' : ''}`}
                                aria-label={day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}>
                                <small>{isToday ? day.toLocaleDateString([], { weekday: 'short' }) : day.toLocaleDateString([], { weekday: 'narrow' })}</small>
                                {day.getDate()}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="cal-line">
                        <IconCalendar width={17} height={17} />
                        <span>
                          {today.countToday === 0
                            ? 'Nothing for today'
                            : `${today.countToday} ${today.countToday === 1 ? 'task' : 'tasks'} today${today.rows[0] ? ` · next ${today.rows[0].detail}` : ''}`}
                        </span>
                      </div>
                    </div>
                    <div className="cal-side">
                      {today.rows.length === 0 && activities.length === 0 && (
                        <p className="expanded-sub">Add a reminder or start a timer and it will show up here.</p>
                      )}
                      {today.rows.map((r) => (
                        <div key={r.id} className="cal-row">
                          <span className="today-main">
                            <strong>{displayTodoText(r.text, showPreviews)}</strong>
                          </span>
                          <span className="row-sub tnum">{r.detail}</span>
                        </div>
                      ))}
                      {today.rows.length < 3 && activities
                        .filter((a) => a.kind === 'timer' || a.kind === 'stopwatch')
                        .slice(0, 3 - today.rows.length)
                        .map((a) => (
                          <div key={a.id} className="cal-row">
                            <span className="today-main">
                              <strong>{a.title}</strong>
                            </span>
                            {a.subtitle ? <span className="row-sub tnum">{a.subtitle}</span> : null}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {pageName === 'Music' && (
                <div key={pageName} className={`hub-page music-page${showLyrics && lyrics.status !== 'idle' ? ' has-lyrics' : ''} ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  {media.sessions.length > 1 && (
                    <div className="state-grid music-sources" role="group" aria-label="Music source">
                      {media.sessions.map((s) => (
                        <Button
                          key={s.app}
                          className={(media.source ?? String(nowPlaying?.data?.app ?? '')) === s.app ? 'chip-on' : undefined}
                          onClick={() => media.onSelectSource(s.app)}
                        >
                          {shortApp(s.app)}
                        </Button>
                      ))}
                    </div>
                  )}
                  {/* Hub Music (reference screen 4): art + title on
                      top, full-width timeline, then one transport bar —
                      lyrics left, controls centred, speaker right. */}
                  <div className="music-hub-main">
                    <span className="music-artwrap" key={nowPlaying ? `${nowPlaying.title}|${typeof nowPlaying.data?.art === 'string' ? nowPlaying.data.art.slice(0, 32) : 'idle'}` : 'idle'}>
                      {nowPlaying && typeof nowPlaying.data?.art === 'string'
                        ? <img className="music-art2" src={nowPlaying.data.art} alt="" width={92} height={92} />
                        : <IdleArtwork />}
                      {nowPlaying && typeof nowPlaying.data?.art === 'string' && (
                        <span className="music-badge" aria-hidden="true"><IconMusic width={15} height={15} /></span>
                      )}
                    </span>
                    <div className="music-info" key={nowPlaying ? nowPlaying.title : 'idle'}>
                      <strong className="music-title2">{nowPlaying ? nowPlaying.title : 'Not Playing'}</strong>
                      <span className="music-artist">
                        {nowPlaying ? (String(nowPlaying.data?.artist ?? '') || (nowPlaying.subtitle ?? '')) : 'Start music in any app and it appears here.'}
                      </span>
                      {nowPlaying && typeof nowPlaying.data?.album === 'string' && nowPlaying.data.album && (
                        <span className="music-album">{nowPlaying.data.album}</span>
                      )}
                    </div>
                  </div>
                  <div className="music-timeline">
                    <span className="tnum">{fmtTime(Number(nowPlaying?.data?.positionSeconds ?? 0))}</span>
                    <Scrubber
                      position={Number(nowPlaying?.data?.positionSeconds ?? 0)}
                      duration={Number(nowPlaying?.data?.durationSeconds ?? 0)}
                      onSeek={actions.onMediaSeek}
                    />
                    <span className="tnum">-{fmtTime(Math.max(0, Number(nowPlaying?.data?.durationSeconds ?? 0) - Number(nowPlaying?.data?.positionSeconds ?? 0)))}</span>
                  </div>
                  <div className="music-bar">
                    <button type="button" className={`transport-btn transport-sm${showLyrics ? ' on' : ''}`}
                      onClick={() => setShowLyrics((v) => !v)} aria-label="Lyrics" aria-pressed={showLyrics}>
                      <IconLyrics width={19} height={19} />
                    </button>
                    <span className="music-bar-center">
                      <button type="button" className="transport-btn" disabled={!nowPlaying}
                        onClick={() => actions.onMediaControl('previous')} aria-label="Previous track"><IconPrev width={21} height={21} /></button>
                      <button type="button" className="transport-btn transport-main" disabled={!nowPlaying}
                        onClick={() => actions.onMediaControl('toggle')} aria-label={nowPlaying?.data?.status === 'playing' ? 'Pause' : 'Play'}>
                        {nowPlaying?.data?.status === 'playing' ? <IconPause width={24} height={24} /> : <IconPlay width={24} height={24} />}
                      </button>
                      <button type="button" className="transport-btn" disabled={!nowPlaying}
                        onClick={() => actions.onMediaControl('next')} aria-label="Next track"><IconNext width={21} height={21} /></button>
                    </span>
                    <span className="music-bar-right">
                      <span className="tnum hub-vol-pct">{Math.round(Number(volumeAct?.data?.level ?? 0.5) * 100)}%</span>
                      <button type="button" className="transport-btn transport-sm" onClick={() => actions.onMute()}
                        aria-label={volumeAct?.data?.muted ? 'Unmute' : 'Mute'}>
                        {volumeAct?.data?.muted ? <IconMuted width={19} height={19} /> : <IconVolume width={19} height={19} />}
                      </button>
                    </span>
                  </div>
                  {lyricsBlock()}
                </div>
              )}

              {pageName === 'Focus' && (
                <div key={pageName} className={`hub-page focus-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  <div className="focus-layout">
                    <span
                      className="focus-ring-lg"
                      style={{ '--p': timerAct ? focusFrac : 1 } as CSSProperties}
                      role="img"
                      aria-label={timerAct ? `${timerAct.title}, ${timerAct.subtitle ?? ''}` : `Focus timer ready, ${focusPreset} minutes`}
                    >
                      <span className="focus-ring-inner"><IconTimer width={40} height={40} /></span>
                    </span>
                    <div className="focus-side">
                      <div className="focus-time-row">
                        <strong className="focus-big tnum">{timerAct ? (timerAct.subtitle ?? timerAct.title) : `${focusPreset}:00`}</strong>
                        <button type="button" className="reset-btn" aria-label="Reset timer"
                          onClick={() => actions.onTimer('stop')}>
                          <IconReset width={17} height={17} />
                        </button>
                      </div>
                      <span className="expanded-sub">{timerAct ? timerAct.title : 'Focus time'}</span>
                      <div className="focus-controls">
                        {timerAct ? (
                          <>
                            <Button onClick={() => actions.onTimer('stop')}>Stop</Button>
                            <button
                              type="button" className="play-btn play-pill-red"
                              aria-label={timerPaused ? 'Resume' : 'Pause'}
                              onClick={() => actions.onTimer(timerPaused ? 'resume' : 'pause')}
                            >
                              {timerPaused ? <IconPlay width={21} height={21} /> : <IconPause width={21} height={21} />}
                            </button>
                            <Button onClick={() => actions.onTimer('countdown', focusPreset)}>
                              <IconTarget width={15} height={15} /> Focus Time
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button onClick={() => actions.onTimer('countdown', 5)}>
                              <IconCoffee width={15} height={15} /> Short Break
                            </Button>
                            <button
                              type="button" className="play-btn play-pill-red"
                              aria-label={`Start ${focusPreset} minute focus timer`}
                              onClick={() => actions.onTimer('countdown', focusPreset)}
                            >
                              <IconPlay width={21} height={21} />
                            </button>
                            <Button onClick={() => actions.onTimer('countdown', focusPreset)}>
                              <IconTarget width={15} height={15} /> Focus Time
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="state-grid focus-presets" role="group" aria-label="Focus length">
                    <span className="expanded-sub">Length</span>
                    {[15, 25, 50].map((m) => (
                      <Button key={m} className={focusPreset === m ? 'chip-on' : undefined}
                        onClick={() => setFocusPreset(m)}>
                        {m} min
                      </Button>
                    ))}
                    <Button onClick={() => actions.onTimer('stopwatch')}>Stopwatch</Button>
                  </div>
                </div>
              )}

              {pageName === 'Shelf' && (
                <div key={pageName} className={`hub-page shelf-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  {hub.shelf.items.length === 0 ? (
                    <div className="shelf-zone">
                      <IconFile width={22} height={22} />
                      <p>Drop files here to park them. They stay for up to 30 days, or until you remove them.</p>
                    </div>
                  ) : (
                    <>
                      <div className="shelf-grid">
                        {hub.shelf.items.map((item) => {
                          const selected = shelfSelected.has(item.path);
                          return (
                            <div
                              key={item.path}
                              className={`shelf-card${selected ? ' selected' : ''}`}
                              draggable
                              role="checkbox"
                              aria-checked={selected}
                              aria-label={`${item.name}, ${formatBytes(item.size)}`}
                              onClick={() => setShelfSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.path)) next.delete(item.path); else next.add(item.path);
                                return next;
                              })}
                              onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.path); e.dataTransfer.effectAllowed = 'copy'; }}
                              title={item.path}
                            >
                              <IconFile width={20} height={20} />
                              <span className="shelf-name">{item.name}</span>
                              <span className="shelf-size">{formatBytes(item.size)}</span>
                              <span className="shelf-actions">
                                <button type="button" onClick={(e) => { e.stopPropagation(); hub.shelf.onOpen(item.path); }}>Open</button>
                                <button type="button" onClick={(e) => { e.stopPropagation(); hub.shelf.onReveal(item.path); }}>Show</button>
                                <button type="button" aria-label={`Remove ${item.name}`} onClick={(e) => { e.stopPropagation(); hub.shelf.onRemove(item.path); }}><IconX width={12} height={12} /></button>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {shelfSelected.size > 0 ? (
                        <div className="state-grid" aria-label="Selected files">
                          <span className="expanded-sub">{shelfSelected.size} selected</span>
                          <Button onClick={() => hub.shelf.onCopyPaths([...shelfSelected])}>Copy paths</Button>
                          <Button variant="danger" onClick={() => {
                            for (const p of shelfSelected) hub.shelf.onRemove(p);
                            setShelfSelected(new Set());
                          }}>Remove</Button>
                          <Button onClick={() => setShelfSelected(new Set())}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="state-grid">
                          <Button onClick={() => hub.shelf.onClear()}>Clear shelf</Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {pageName === 'Reminders' && (
                <div key={pageName} className={`hub-page reminders-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  <div className="todo-layout">
                    <div className="todo-hero">
                      <div className="todo-hero-top">
                        <strong className="hero-num tnum">
                          {hub.todos.items.filter((t) => t.done).length}/{hub.todos.items.length}
                        </strong>
                        <span className="cal-badge" aria-hidden="true">
                          <IconCalendar width={20} height={20} /><i />
                        </span>
                      </div>
                      <span className="hero-label">Tasks Done Today</span>
                      <div className="todo-hero-btns">
                        <Button onClick={() => todoInputRef.current?.focus()}>
                          <IconPlus width={15} height={15} /> Add Task
                        </Button>
                        <Button
                          aria-pressed={todoEdit}
                          className={todoEdit ? 'chip-on' : undefined}
                          onClick={() => setTodoEdit((v) => !v)}
                        >
                          <IconEdit width={15} height={15} /> Edit Task
                        </Button>
                      </div>
                    </div>
                    <div className="todo-panel">
                      <div className="todo-add">
                        <input
                          ref={todoInputRef}
                          aria-label="New task or reminder"
                          placeholder="Add a task, e.g. call Sam in 20 min"
                          value={todoText}
                          onChange={(e) => setTodoText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
                        />
                        <Button variant="primary" onClick={addTodo} aria-label="Add task"><IconPlus /></Button>
                      </div>
                      <div className="todo-list">
                        {hub.todos.items.length === 0 && (
                          <p className="expanded-sub">No tasks yet. Times and repeats are understood, for example "tomorrow 9am" or "every day 9am".</p>
                        )}
                        {hub.todos.items.map((t) => (
                          <div key={t.id} className={`todo-row${t.done ? ' is-done' : ''}`}>
                            <button
                              type="button"
                              className={`todo-check${t.done ? ' done' : ''}`}
                              aria-label={t.done ? `Mark ${t.text} not done` : `Mark ${t.text} done`}
                              onClick={() => hub.todos.onToggle(t.id)}
                            >
                              {t.done ? <IconCheck width={12} height={12} /> : null}
                            </button>
                            <span className={`todo-text${t.done ? ' done' : ''}`}>{t.text}</span>
                            {t.dueAt && !t.done ? (
                              <span className="expanded-sub tnum">
                                {new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                {t.recur ? ` · ${t.recur === 'daily' ? 'daily' : t.recur === 'weekdays' ? 'weekdays' : 'weekly'}` : ''}
                              </span>
                            ) : null}
                            {todoEdit && (
                              <button type="button" className="todo-x" aria-label={`Delete ${t.text}`} onClick={() => hub.todos.onRemove(t.id)}>
                                <IconX width={12} height={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {pageName === 'Water' && (
                <div key={pageName} className={`hub-page water-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  {/* Compact rows (1.2.6): label + chips on one line.
                      The old label-above-chips stack was ~70px too
                      tall for the notch, so the interval row fell
                      off the bottom. */}
                  <div className="focus-top">
                    <IconDrop width={22} height={22} />
                    <div>
                      <strong className="hub-track tnum">{hub.water.state.drankMl} / {hub.water.state.goalMl} ml</strong>
                      <span className="expanded-sub">Water today · {Math.round((hub.water.state.drankMl / Math.max(1, hub.water.state.goalMl)) * 100)}%</span>
                    </div>
                    <Button variant="primary" onClick={() => hub.water.onDrink()}>Drink {hub.water.state.bottleMl} ml</Button>
                  </div>
                  <div className="water-bar" role="progressbar" aria-label="Water today"
                    aria-valuemin={0} aria-valuemax={hub.water.state.goalMl} aria-valuenow={hub.water.state.drankMl}>
                    <span style={{ width: `${Math.min(100, (hub.water.state.drankMl / Math.max(1, hub.water.state.goalMl)) * 100)}%` }} />
                  </div>
                  <div className="water-row">
                    <span className="expanded-sub">Bottle size</span>
                    <div className="state-grid" role="group" aria-label="Bottle size">
                      {[250, 500, 750].map((ml) => (
                        <Button key={ml} className={hub.water.state.bottleMl === ml ? 'chip-on' : undefined} onClick={() => hub.water.onBottle(ml)}>{ml} ml</Button>
                      ))}
                    </div>
                  </div>
                  <div className="water-row">
                    <span className="expanded-sub">Daily goal</span>
                    <div className="state-grid" role="group" aria-label="Daily goal">
                      {[1500, 2000, 2500].map((ml) => (
                        <Button key={ml} className={hub.water.state.goalMl === ml ? 'chip-on' : undefined} onClick={() => hub.water.onGoal(ml)}>{ml / 1000} L</Button>
                      ))}
                    </div>
                  </div>
                  <div className="water-row">
                    <span className="expanded-sub">Reminders</span>
                    <div className="state-grid" role="group" aria-label="Reminder interval">
                      {[30, 60, 90].map((min) => (
                        <Button key={min} className={hub.water.state.intervalMin === min ? 'chip-on' : undefined} onClick={() => hub.water.onInterval(min)}>{min} min</Button>
                      ))}
                    </div>
                  </div>
                  <p className="expanded-sub">Every {hub.water.state.intervalMin} min, 08:00–22:00, until you reach your goal.</p>
                </div>
              )}

              {pageName === 'Devices' && (
                <div key={pageName} className={`hub-page devices-page ${pageDir > 0 ? 'page-next' : 'page-prev'}`}>
                  {devices.filter((d) => d.connected).length === 0 ? (
                    <>
                      <p className="expanded-sub">No Bluetooth devices connected. Pair one in Windows Bluetooth settings, then it appears here with its battery when it reports one.</p>
                      <div className="state-grid">
                        <Button onClick={() => hub.shelf.onOpen('ms-settings:bluetooth')}>Open Bluetooth settings</Button>
                      </div>
                    </>
                  ) : (
                    devices.filter((d) => d.connected).map((d) => (
                      <div key={d.id} className="device-row">
                        {d.battery !== null
                          ? <BatteryRing percent={d.battery} size={38} />
                          : <span className="peek-icon"><DeviceIcon kind={d.kind} size={16} /></span>}
                        <span className="device-name">{d.name}</span>
                        <span className="expanded-sub">{d.battery !== null ? 'Connected' : 'Connected · battery not reported'}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="hub-bottom">
                <span className="hub-bottom-side brand-word">Notch by IRUMVA</span>
                <div className="hub-dots" role="tablist" aria-label="Hub pages">
                  {pages.map((name, i) => (
                    <button key={name} type="button" role="tab" aria-selected={pageIdx === i}
                      aria-label={name} className={`hub-dot${pageIdx === i ? ' on' : ''}`}
                      onClick={() => goPage(i, i >= pageIdx ? 1 : -1)} />
                  ))}
                </div>
                <span className="hub-bottom-side hub-bottom-right">
                  <button type="button" className="hub-diag" onClick={() => window.location.assign('#/diagnostics')}>Diagnostics</button>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


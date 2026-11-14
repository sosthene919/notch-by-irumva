/** Shared activity types. All text from providers/agents is inert plain text. */
export interface Activity {
  id: string;
  providerId: string;
  kind: string;
  /** Plain text only. Never HTML/markdown. */
  title: string;
  subtitle?: string;
  /** 0-100. Higher wins the pill; ties break by earliest start. */
  priority: number;
  startedAt: number;
  expiresAt?: number;
  /** Kind-specific inert data (numbers/booleans/short text) for rich rendering. */
  data?: Record<string, string | number | boolean>;
  /** Sensitive content is redacted on the lock screen (brief section 7). */
  sensitive?: boolean;
}

export type IslandView = 'collapsed' | 'compact' | 'minimal' | 'peek' | 'expanded' | 'full';

/** File shelf entry (path parked by drag-and-drop). */
export interface ShelfItem { path: string; name: string; size: number }

/** Daily to-do entry. dueAt is epoch ms; reminded guards one alert per due. */
export interface TodoItem {
  id: number; text: string; dueAt?: number; done: boolean; reminded?: boolean;
  recur?: 'daily' | 'weekdays' | 'weekly'; weekday?: number;
}

/** Connected Bluetooth device (Rust watch). battery is null when the
 *  device reports none; the UI then shows the card without a ring. */
export interface BtDevice { id: string; name: string; kind: string; battery: number | null; connected: boolean }

/** Water reminder state (persisted; drankMl resets daily in App). */
export interface WaterState { goalMl: number; bottleMl: number; drankMl: number; intervalMin: number; day: string }

export interface IslandState {
  view: IslandView;
  primaryId: string | null;
  /** Second activity shown as the split-off bubble in `minimal` view. */
  bubbleId: string | null;
  /** Click/hotkey pins the expanded view; hover alone does not. */
  pinned: boolean;
}

export type IslandEvent =
  | { type: 'ACTIVITIES_CHANGED'; orderedIds: string[] }
  | { type: 'HOVER_ENTER' }
  | { type: 'HOVER_LEAVE' }
  | { type: 'CLICK' }
  | { type: 'LONG_PRESS' }
  | { type: 'ESCAPE' }
  | { type: 'CLICK_AWAY' }
  /** Fired by the island's idle timer after AUTO_HIDE_MS without interaction. */
  | { type: 'AUTO_HIDE' }
  /** A notification-worthy activity just appeared: pop the island open as
   *  a banner. The 5 s auto-hide collapses it again. */
  | { type: 'NOTIFY' }
  | { type: 'HOTKEY' };

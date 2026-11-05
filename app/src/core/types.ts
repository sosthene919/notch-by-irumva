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

export type IslandView = 'collapsed' | 'compact' | 'minimal' | 'expanded' | 'full';

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
  | { type: 'HOTKEY' };

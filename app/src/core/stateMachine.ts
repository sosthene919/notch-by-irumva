import type { IslandEvent, IslandState } from './types';

/** Base view implied by activity count alone (no user interaction). */
function baseView(primaryId: string | null, bubbleId: string | null): IslandState['view'] {
  if (!primaryId) return 'collapsed';
  return bubbleId ? 'minimal' : 'compact';
}

export const initialState: IslandState = { view: 'collapsed', primaryId: null, bubbleId: null, pinned: false };

/**
 * Pure island state machine. Rules (brief 3A):
 * 0 activities -> collapsed; 1 -> compact; 2+ -> minimal (pill + bubble);
 * hover/click expands; press-and-hold opens full; Esc/click-away collapse
 * back to the activity-implied base view. AUTO_HIDE (5 s idle timer in
 * Island.tsx) collapses exactly like Esc — including when pinned, so the
 * island can never stay expanded indefinitely. Interruptible by
 * construction: every event is valid in every state.
 */
export function reduce(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'ACTIVITIES_CHANGED': {
      const [primaryId = null, bubbleId = null] = event.orderedIds;
      const base = baseView(primaryId, bubbleId);
      // Keep open views (peek banner, expanded, full hub) only while a
      // primary activity still exists. Peek is preserved too: providers
      // re-publish their activities on ticks, which must not instantly
      // collapse a banner that just popped.
      const view = primaryId && (state.view === 'peek' || state.view === 'expanded' || state.view === 'full') ? state.view : base;
      return { view, primaryId, bubbleId, pinned: primaryId ? state.pinned : false };
    }
    case 'HOVER_ENTER':
      if (state.view === 'full') return state;
      if (state.primaryId) return { ...state, view: 'expanded' };
      // Touching the idle notch (clock/eyes, no activities) opens the hub,
      // so Music/Focus/Today are reachable without a keyboard. Unpinned:
      // moving away (or the 5 s idle timer) closes it again.
      return state.view === 'collapsed' ? { ...state, view: 'full' } : state;
    case 'HOVER_LEAVE':
      return !state.pinned && (state.view === 'expanded' || state.view === 'full')
        ? { ...state, view: baseView(state.primaryId, state.bubbleId) }
        : state;
    case 'CLICK':
      if (!state.primaryId) return state;
      return state.view === 'expanded' && state.pinned
        ? { ...state, view: baseView(state.primaryId, state.bubbleId), pinned: false }
        : { ...state, view: 'expanded', pinned: true };
    case 'LONG_PRESS':
      return state.primaryId ? { ...state, view: 'full', pinned: true } : state;
    case 'ESCAPE':
    case 'CLICK_AWAY':
    case 'AUTO_HIDE':
      return { ...state, view: baseView(state.primaryId, state.bubbleId), pinned: false };
    case 'NOTIFY':
      // Pop the Nusa-style short peek banner (310x60), but never yank the
      // view away from a user who already has it expanded/full (or pinned).
      return state.primaryId && state.view !== 'expanded' && state.view !== 'full'
        ? { ...state, view: 'peek' }
        : state;
    case 'HOTKEY':
      if (!state.primaryId) return state;
      return state.view === 'expanded' || state.view === 'full'
        ? { ...state, view: baseView(state.primaryId, state.bubbleId), pinned: false }
        : { ...state, view: 'expanded', pinned: true };
    default:
      return state;
  }
}

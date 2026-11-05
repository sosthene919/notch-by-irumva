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
 * back to the activity-implied base view. Interruptible by construction:
 * every event is valid in every state.
 */
export function reduce(state: IslandState, event: IslandEvent): IslandState {
  switch (event.type) {
    case 'ACTIVITIES_CHANGED': {
      const [primaryId = null, bubbleId = null] = event.orderedIds;
      const base = baseView(primaryId, bubbleId);
      // Keep expanded/full only while a primary activity still exists.
      const view = primaryId && (state.view === 'expanded' || state.view === 'full') ? state.view : base;
      return { view, primaryId, bubbleId, pinned: primaryId ? state.pinned : false };
    }
    case 'HOVER_ENTER':
      return state.primaryId && state.view !== 'full' ? { ...state, view: 'expanded' } : state;
    case 'HOVER_LEAVE':
      return state.view === 'expanded' && !state.pinned
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
      return { ...state, view: baseView(state.primaryId, state.bubbleId), pinned: false };
    case 'HOTKEY':
      if (!state.primaryId) return state;
      return state.view === 'expanded' || state.view === 'full'
        ? { ...state, view: baseView(state.primaryId, state.bubbleId), pinned: false }
        : { ...state, view: 'expanded', pinned: true };
    default:
      return state;
  }
}

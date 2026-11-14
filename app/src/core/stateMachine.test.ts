import { describe, expect, it } from 'vitest';
import { initialState, reduce } from './stateMachine';
import type { IslandEvent, IslandState } from './types';

const VIEWS: IslandState['view'][] = ['collapsed', 'compact', 'minimal', 'peek', 'expanded', 'full'];

/** Deterministic pseudo-random generator (same seed, same sequence). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const withOne = (): IslandState => reduce(initialState, { type: 'ACTIVITIES_CHANGED', orderedIds: ['a'] });
const withTwo = (): IslandState => reduce(initialState, { type: 'ACTIVITIES_CHANGED', orderedIds: ['a', 'b'] });

describe('island state machine', () => {
  it('collapses with no activities, compacts with one', () => {
    expect(initialState.view).toBe('collapsed');
    expect(withOne().view).toBe('compact');
  });
  it('splits into minimal (pill + bubble) with two competing activities', () => {
    const s = withTwo();
    expect(s.view).toBe('minimal');
    expect(s.primaryId).toBe('a');
    expect(s.bubbleId).toBe('b');
  });
  it('hover expands and hover-leave collapses when not pinned', () => {
    const e = reduce(withOne(), { type: 'HOVER_ENTER' });
    expect(e.view).toBe('expanded');
    expect(reduce(e, { type: 'HOVER_LEAVE' }).view).toBe('compact');
  });
  it('click pins expanded; second click collapses; Esc collapses from full', () => {
    const pinned = reduce(withOne(), { type: 'CLICK' });
    expect(pinned).toMatchObject({ view: 'expanded', pinned: true });
    expect(reduce(pinned, { type: 'HOVER_LEAVE' }).view).toBe('expanded');
    expect(reduce(pinned, { type: 'CLICK' }).view).toBe('compact');
    const full = reduce(pinned, { type: 'LONG_PRESS' });
    expect(full.view).toBe('full');
    expect(reduce(full, { type: 'ESCAPE' }).view).toBe('compact');
  });
  it('promotes the bubble when the primary is removed, collapses when empty', () => {
    const promoted = reduce(withTwo(), { type: 'ACTIVITIES_CHANGED', orderedIds: ['b'] });
    expect(promoted).toMatchObject({ view: 'compact', primaryId: 'b', bubbleId: null });
    expect(reduce(promoted, { type: 'ACTIVITIES_CHANGED', orderedIds: [] }).view).toBe('collapsed');
  });
  it('auto-hide collapses pinned expanded and full views to the base view', () => {
    const pinned = reduce(withOne(), { type: 'CLICK' });
    expect(reduce(pinned, { type: 'AUTO_HIDE' })).toMatchObject({ view: 'compact', pinned: false });
    const full = reduce(withTwo(), { type: 'LONG_PRESS' });
    expect(reduce(full, { type: 'AUTO_HIDE' })).toMatchObject({ view: 'minimal', pinned: false });
    expect(reduce(withOne(), { type: 'AUTO_HIDE' }).view).toBe('compact');
    expect(reduce(initialState, { type: 'AUTO_HIDE' }).view).toBe('collapsed');
  });
  it('notify pops the peek banner, no-op when idle or already open', () => {
    expect(reduce(initialState, { type: 'NOTIFY' }).view).toBe('collapsed');
    expect(reduce(withOne(), { type: 'NOTIFY' })).toMatchObject({ view: 'peek', pinned: false });
    expect(reduce(withTwo(), { type: 'NOTIFY' }).view).toBe('peek');
    const full = reduce(withOne(), { type: 'LONG_PRESS' });
    expect(reduce(full, { type: 'NOTIFY' })).toMatchObject({ view: 'full', pinned: true });
    // The banner survives provider tick republishes, opens on click, and
    // auto-hides again via the idle timer event.
    const banner = reduce(withOne(), { type: 'NOTIFY' });
    expect(reduce(banner, { type: 'ACTIVITIES_CHANGED', orderedIds: ['a'] }).view).toBe('peek');
    expect(reduce(banner, { type: 'HOVER_LEAVE' }).view).toBe('peek');
    expect(reduce(banner, { type: 'CLICK' })).toMatchObject({ view: 'expanded', pinned: true });
    expect(reduce(banner, { type: 'AUTO_HIDE' }).view).toBe('compact');
  });
  it('touching the idle notch opens the hub; leaving closes it unless pinned', () => {
    const hub = reduce(initialState, { type: 'HOVER_ENTER' });
    expect(hub).toMatchObject({ view: 'full', pinned: false });
    expect(reduce(hub, { type: 'HOVER_LEAVE' }).view).toBe('collapsed');
    expect(reduce(hub, { type: 'AUTO_HIDE' }).view).toBe('collapsed');
    // Long-pressed (pinned) hub does not close on leave.
    const pinnedHub = reduce(withOne(), { type: 'LONG_PRESS' });
    expect(reduce(pinnedHub, { type: 'HOVER_LEAVE' }).view).toBe('full');
  });
  it('hotkey toggles expanded and is a no-op when collapsed', () => {
    expect(reduce(initialState, { type: 'HOTKEY' }).view).toBe('collapsed');
    const e = reduce(withOne(), { type: 'HOTKEY' });
    expect(e.view).toBe('expanded');
    expect(reduce(e, { type: 'HOTKEY' }).view).toBe('compact');
  });
  it('never reaches an invalid state under randomised event sequences', () => {
    const KINDS: IslandEvent['type'][] = [
      'ACTIVITIES_CHANGED', 'HOVER_ENTER', 'HOVER_LEAVE', 'CLICK', 'LONG_PRESS',
      'ESCAPE', 'CLICK_AWAY', 'AUTO_HIDE', 'NOTIFY', 'HOTKEY',
    ];
    for (const seed of [1, 7, 42, 2026]) {
      const rand = lcg(seed);
      let state = initialState;
      for (let step = 0; step < 600; step++) {
        const kind = KINDS[Math.floor(rand() * KINDS.length)];
        const event: IslandEvent = kind === 'ACTIVITIES_CHANGED'
          ? { type: kind, orderedIds: [[], ['a'], ['a', 'b'], ['b'], ['c', 'a']][Math.floor(rand() * 5)]! }
          : { type: kind } as IslandEvent;
        state = reduce(state, event);
        expect(VIEWS).toContain(state.view);
        if (state.primaryId === null) {
          // With nothing playing, only idle or the hub may be shown.
          expect(['collapsed', 'full']).toContain(state.view);
          expect(state.bubbleId).toBeNull();
          expect(state.pinned).toBe(false);
        }
        if (state.view === 'minimal') expect(state.bubbleId).not.toBeNull();
        if (state.bubbleId !== null) expect(state.primaryId).not.toBeNull();
      }
    }
  });
});

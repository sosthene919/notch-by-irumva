import { describe, expect, it } from 'vitest';
import { initialState, reduce } from './stateMachine';
import type { IslandState } from './types';

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
  it('hotkey toggles expanded and is a no-op when collapsed', () => {
    expect(reduce(initialState, { type: 'HOTKEY' }).view).toBe('collapsed');
    const e = reduce(withOne(), { type: 'HOTKEY' });
    expect(e.view).toBe('expanded');
    expect(reduce(e, { type: 'HOTKEY' }).view).toBe('compact');
  });
});

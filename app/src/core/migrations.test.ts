import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA, migratePrefs } from './migrations';

describe('settings migrations', () => {
  it('version 1 data is stamped and flagged for backup, fields preserved', () => {
    const v1 = { providers: { timers: true }, hotkey: 'CommandOrControl+Alt+N', todos: [{ id: 1, text: 'x', done: false }] };
    const r = migratePrefs(v1);
    expect(r.from).toBe(1);
    expect(r.needsBackup).toBe(true);
    expect(r.prefs.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(r.prefs.todos).toEqual(v1.todos);
    expect(r.prefs.hotkey).toBe(v1.hotkey);
  });
  it('current version passes through without backup', () => {
    const r = migratePrefs({ schemaVersion: CURRENT_SCHEMA, providers: {} });
    expect(r).toMatchObject({ from: CURRENT_SCHEMA, needsBackup: false });
  });
  it('newer data is never touched (downgrade safety)', () => {
    const future = { schemaVersion: 99, futureField: { a: 1 } };
    const r = migratePrefs(future);
    expect(r.from).toBe(99);
    expect(r.needsBackup).toBe(false);
    expect(r.prefs).toEqual(future);
  });
  it('corrupt data reports null and yields empty prefs', () => {
    for (const bad of [null, undefined, 42, 'text', [1, 2], true]) {
      const r = migratePrefs(bad);
      expect(r.from).toBeNull();
      expect(r.prefs).toEqual({});
      expect(r.needsBackup).toBe(false);
    }
  });
  it('a failed migration halfway leaves the caller able to restore', () => {
    // The contract: needsBackup is signalled before any change, and
    // the input object is not mutated, so the original can be kept.
    const v1 = { providers: {}, schemaVersion: undefined as unknown as number };
    const snapshot = JSON.stringify(v1);
    migratePrefs(v1);
    expect(JSON.stringify(v1)).toBe(snapshot);
  });
});

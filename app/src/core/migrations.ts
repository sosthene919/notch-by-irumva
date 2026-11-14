/**
 * Settings schema migrations. The stored settings blob carries a
 * `schemaVersion`. Rules:
 * - Missing version means version 1 (every install before schemas).
 * - A newer version than this build understands is never touched:
 *   the data passes through unchanged (downgrades must not eat data).
 * - Corrupt or non-object data reports `from: null`; the caller falls
 *   back to defaults rather than guessing.
 * - `needsBackup` is true exactly when a migration will run, so the
 *   caller can snapshot the data first and restore on failure.
 */

export const CURRENT_SCHEMA = 2;

export interface MigrationResult {
  /** The migrated (or untouched) raw settings object. */
  prefs: Record<string, unknown>;
  /** Schema found on disk, 1 when absent, null when unreadable. */
  from: number | null;
  needsBackup: boolean;
}

export function migratePrefs(raw: unknown): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { prefs: {}, from: null, needsBackup: false };
  }
  const obj = raw as Record<string, unknown>;
  const found = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;
  if (found > CURRENT_SCHEMA) {
    return { prefs: obj, from: found, needsBackup: false };
  }
  if (found === CURRENT_SCHEMA) {
    return { prefs: obj, from: found, needsBackup: false };
  }
  // 1 -> 2: additive only. New fields (appearance, lyrics, shelf
  // entries) take their defaults during the caller's merge; the only
  // change here is the version stamp itself.
  return { prefs: { ...obj, schemaVersion: CURRENT_SCHEMA }, from: found, needsBackup: true };
}

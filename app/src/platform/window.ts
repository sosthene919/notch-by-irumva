/**
 * Tauri platform boundary — the only module allowed to import Tauri APIs,
 * so the core stays portable if the WinUI fallback (ADR-001) is ever needed.
 * Outside Tauri (browser preview / tests) every call is a no-op.
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function setClickThrough(ignore: boolean): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setIgnoreCursorEvents(ignore);
  } catch { /* shell not ready; collapsed pill remains interactive, which is safe */ }
}

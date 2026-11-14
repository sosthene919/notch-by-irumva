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

/** Resizes the shell window for the island size setting and re-centers
 *  it at the top of its current monitor. The island's CSS sizes scale by
 *  the same factor, so the shape and its window stay in proportion. */
export async function setIslandScale(scale: number): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const w = Math.round(472 * scale);
    const h = Math.round(260 * scale);
    await win.setSize(new LogicalSize(w, h));
    const mon = await currentMonitor();
    if (mon) {
      const sf = await win.scaleFactor();
      const x = mon.position.x / sf + (mon.size.width / sf - w) / 2;
      await win.setPosition(new LogicalPosition(Math.round(x), Math.round(mon.position.y / sf)));
    }
  } catch { /* shell not ready; next launch applies it */ }
}

/** Opens the dedicated Settings popup window (Rust command; the
 *  window is declared in tauri.conf.json, hidden at launch). Outside
 *  Tauri, falls back to the in-page security route. */
export async function openSettingsPopup(): Promise<void> {
  if (!isTauri) { window.location.assign('#/security'); return; }
  // Two paths, both idempotent: a Rust event listener and the command.
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('notch://show-settings', null);
  } catch { /* command below still applies */ }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('show_settings_window');
  } catch { window.location.assign('#/security'); }
}

/** Hides the current window (used by the Settings popup's Back button:
 *  closing the popup hides it, the notch stays where it was). */
export async function hideCurrentWindow(): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  } catch { /* not in a hideable window */ }
}

/** Tells the Rust cursor watcher the pill's current CSS size, so hover
 *  detection tracks the morph (the collapsed notch is click-through and
 *  cannot see the mouse itself). */
export async function setHoverRegion(width: number, height: number): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_hover_region', { width, height });
  } catch { /* older shell without the command; hotkey still works */ }
}

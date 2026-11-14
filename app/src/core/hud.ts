/**
 * HUD maths for the 1.1.5 Boring-style overlays: the segmented volume
 * bar (filled ticks with a glow) and the battery pill in the hub
 * top bar. Pure clamping/counting so it can be unit-tested.
 */

/** How many of `total` segments are lit for a 0..1 level.
 *  Muted or non-finite levels light none; any audible level > 0
 *  lights at least one tick so the bar never looks dead while sound plays. */
export function segmentedFill(level: number, total = 36, muted = false): number {
  if (muted || !Number.isFinite(level) || total <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, level));
  if (clamped === 0) return 0;
  return Math.min(total, Math.max(1, Math.round(clamped * total)));
}

/** Battery pill fill as a 0..100 percentage, clamped. */
export function batteryFill(percent: number | null | undefined): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

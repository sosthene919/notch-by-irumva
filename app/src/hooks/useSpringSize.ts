import { useEffect, useRef, useState } from 'react';

export interface Size { width: number; height: number }

/**
 * Interruptible spring for the pill morph (brief section 4: 180-420ms,
 * spring physics, interruptible at any moment). Retargeting mid-flight
 * keeps current velocity. Reduced motion snaps instantly.
 * Note: pill width/height are the one deliberate exception to transform-only
 * animation; inner content animates with transform/opacity only. Frame
 * budget is verified in Phase 6 (docs/ACCEPTANCE.md).
 */
/** Springs are described by feel, not duration (brief section 2):
 *  - `settle`: near-critically damped, for utilitarian moves (collapse,
 *    resize). No visible bounce.
 *  - `peek`: notification banner. Still near-critically damped — an
 *    alert earns attention by arriving, not by bouncing (Emil
 *    Kowalski: ease-out entrances, bounce almost never). A touch
 *    softer than `settle` so the banner reads as placed, not snapped.
 *  - `expand`: opening the notch up (expanded/full). Stiffer and
 *    still near-critically damped (1.2.6): the `settle` spring's
 *    long tail (~0.58s collapsed -> full) made opening the hub feel
 *    laggy; this one settles in ~0.4s with no visible overshoot.
 *  - `pop`: under-damped, kept for callers that explicitly want it.
 *  All carry velocity across retargets, so grabbing the island
 *  mid-flight never jumps. */
export type SpringFeel = 'settle' | 'pop' | 'peek' | 'expand';
const SPRINGS: Record<SpringFeel, { stiffness: number; damping: number }> = {
  settle: { stiffness: 400, damping: 36 },
  peek: { stiffness: 340, damping: 31 },
  expand: { stiffness: 900, damping: 56 },
  pop: { stiffness: 300, damping: 20 },
};

export function useSpringSize(target: Size, reducedMotion: boolean, feel: SpringFeel = 'settle'): Size {
  const [size, setSize] = useState<Size>(target);
  const state = useRef({ ...target, vx: 0, vy: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;
  const feelRef = useRef(feel);
  feelRef.current = feel;

  useEffect(() => {
    if (reducedMotion) { state.current = { ...target, vx: 0, vy: 0 }; setSize(target); return; }
    let raf = 0; let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const s = state.current; const t = targetRef.current;
      const { stiffness, damping } = SPRINGS[feelRef.current];
      // Substep at 120Hz: the stiff `expand` spring would go unstable
      // on a single 50ms hitched frame, and 60Hz steps make its tail
      // judder. Integration cost is trivial at these step counts.
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        s.vx += (-(s.width - t.width) * stiffness - s.vx * damping) * h;
        s.vy += (-(s.height - t.height) * stiffness - s.vy * damping) * h;
        s.width += s.vx * h; s.height += s.vy * h;
      }
      setSize({ width: s.width, height: s.height });
      const settled = Math.abs(s.width - t.width) < 0.5 && Math.abs(s.height - t.height) < 0.5
        && Math.abs(s.vx) < 1 && Math.abs(s.vy) < 1;
      if (!settled) raf = requestAnimationFrame(step);
      else setSize(t);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target.width, target.height, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  return size;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

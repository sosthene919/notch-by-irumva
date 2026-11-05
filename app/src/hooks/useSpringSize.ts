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
export function useSpringSize(target: Size, reducedMotion: boolean): Size {
  const [size, setSize] = useState<Size>(target);
  const state = useRef({ ...target, vx: 0, vy: 0 });
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (reducedMotion) { state.current = { ...target, vx: 0, vy: 0 }; setSize(target); return; }
    let raf = 0; let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      const s = state.current; const t = targetRef.current;
      const stiffness = 260; const damping = 30;
      s.vx += (-(s.width - t.width) * stiffness - s.vx * damping) * dt;
      s.vy += (-(s.height - t.height) * stiffness - s.vy * damping) * dt;
      s.width += s.vx * dt; s.height += s.vy * dt;
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

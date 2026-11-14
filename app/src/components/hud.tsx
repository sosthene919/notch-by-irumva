/**
 * HUD components (1.1.5), one per file concern — kept separate from
 * Island.tsx so each can be reused and shown on its own:
 * - BatteryPill: top-bar battery indicator
 * - SegmentedLevel: segmented volume bar
 * Maths lives in core/hud.ts; styling in styles/app.css.
 */
import { useRef, useState } from 'react';
import { batteryFill, segmentedFill } from '../core/hud';
import type { IslandStatus } from './Island';
import { IconBolt } from './icons';

/** Battery pill from the reference top bar: outline shell, white fill
 *  by charge, bolt overlay while charging. */
export function BatteryPill({ status }: { status?: IslandStatus }) {
  if (!status || status.batteryPercent === null) return null;
  const fill = batteryFill(status.batteryPercent);
  return (
    <span className="battery-pill" role="img" aria-label={`Battery ${fill} percent${status.charging ? ', charging' : ''}`} title={`Battery ${fill}%${status.charging ? ' · charging' : ''}`}>
      <span className="battery-shell">
        <span className="battery-fill" style={{ width: `${fill}%` }} />
        {status.charging && <IconBolt width={9} height={9} />}
      </span>
      <span className="battery-nub" aria-hidden="true" />
    </span>
  );
}

/** Segmented volume bar (reference HUD): a row of ticks, lit white
 *  with a bloom up to the level. Drag or click sets the level;
 *  arrow keys step it. */
export function SegmentedLevel({ level, muted, onSet }: { level: number; muted?: boolean; onSet: (level: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? level;
  const lit = segmentedFill(shown, 36, muted);
  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
  };
  return (
    <div
      ref={ref}
      className="seg-bar"
      data-noclick=""
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(fromEvent(e)); }}
      onPointerMove={(e) => { if (drag !== null) setDrag(fromEvent(e)); }}
      onPointerUp={() => { if (drag !== null) { onSet(drag); setDrag(null); } }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onSet(Math.min(1, level + 0.05));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onSet(Math.max(0, level - 0.05));
      }}
    >
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} className={`seg-tick${i < lit ? ' lit' : ''}`} aria-hidden="true" />
      ))}
    </div>
  );
}


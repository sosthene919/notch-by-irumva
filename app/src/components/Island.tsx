import { useEffect, useRef } from 'react';
import type { Activity, IslandState } from '../core/types';
import { usePrefersReducedMotion, useSpringSize, type Size } from '../hooks/useSpringSize';
import { setClickThrough } from '../platform/window';
import { Badge, Button } from './ui';

const SIZES: Record<IslandState['view'], Size> = {
  collapsed: { width: 120, height: 32 },
  compact: { width: 252, height: 36 },
  minimal: { width: 312, height: 36 },
  expanded: { width: 384, height: 176 },
  full: { width: 420, height: 320 },
};

export interface IslandActions {
  onMediaControl(action: 'play' | 'pause' | 'toggle' | 'next' | 'previous'): void;
  onTimer(action: 'countdown' | 'stopwatch' | 'stop', minutes?: number): void;
  onVolume(level: number): void;
  onMute(): void;
}

interface Props {
  state: IslandState;
  activities: Activity[];
  onEvent: (e: 'HOVER_ENTER' | 'HOVER_LEAVE' | 'CLICK' | 'LONG_PRESS' | 'ESCAPE') => void;
  onDismiss: (id: string) => void;
  actions: IslandActions;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Island({ state, activities, onEvent, onDismiss, actions }: Props) {
  const reduced = usePrefersReducedMotion();
  const size = useSpringSize(SIZES[state.view], reduced);
  const pressTimer = useRef<number | null>(null);
  const primary = activities.find((a) => a.id === state.primaryId) ?? null;
  const bubble = activities.find((a) => a.id === state.bubbleId) ?? null;

  // Click-through when collapsed and idle (brief section 2); interactive over the pill only.
  useEffect(() => { void setClickThrough(state.view === 'collapsed'); }, [state.view]);
  const interactive = state.view !== 'collapsed';

  const startPress = () => {
    pressTimer.current = window.setTimeout(() => onEvent('LONG_PRESS'), 500);
  };
  const endPress = (longFired: boolean, target: EventTarget | null) => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    // Clicks on controls must not toggle the island.
    if (target instanceof HTMLElement && target.closest('button, input, label, a')) return;
    if (!longFired) onEvent('CLICK');
  };

  return (
    <div className="island-wrap">
      <div
        className={`island island-${state.view}`}
        style={{ width: size.width, height: size.height }}
        role="region"
        aria-label="Notch live activities"
        aria-live="polite"
        tabIndex={interactive ? 0 : -1}
        onMouseEnter={() => interactive && onEvent('HOVER_ENTER')}
        onMouseLeave={() => onEvent('HOVER_LEAVE')}
        onKeyDown={(e) => { if (e.key === 'Escape') onEvent('ESCAPE'); }}
        onPointerDown={startPress}
        onPointerUp={(e) => endPress(state.view === 'full', e.target)}
      >
        {state.view === 'collapsed' && <span className="island-dot" aria-label="Notch idle" />}
        {(state.view === 'compact' || state.view === 'minimal') && primary && (
          <div className="compact-line">
            <span className="compact-title">{primary.title}</span>
            {primary.subtitle ? <span className="compact-sub">{primary.subtitle}</span> : null}
            {bubble && (
              <span className="bubble" title={bubble.title} aria-label={`Second activity: ${bubble.title}`}>
                {bubble.title.slice(0, 1)}
              </span>
            )}
          </div>
        )}
        {(state.view === 'expanded' || state.view === 'full') && (
          <div className="expanded-body">
            <div className="expanded-head">
              <strong>{primary?.title ?? 'Notch'}</strong>
              {primary && <Badge tone={primary.providerId === 'agent' ? 'agent' : 'neutral'}>{primary.kind}</Badge>}
            </div>
            {primary?.subtitle ? <p className="expanded-sub">{primary.subtitle}</p> : null}
            {primary?.kind === 'now-playing' && (
              <div className="media-body">
                {typeof primary.data?.art === 'string' ? <img className="media-art" src={primary.data.art} alt="" width={48} height={48} /> : null}
                <div className="media-controls">
                  <div className="progress" role="progressbar" aria-label="Playback position"
                    aria-valuemin={0} aria-valuemax={Number(primary.data?.durationSeconds ?? 0)} aria-valuenow={Number(primary.data?.positionSeconds ?? 0)}>
                    <span style={{ width: `${primary.data?.durationSeconds ? Math.min(100, (Number(primary.data.positionSeconds) / Number(primary.data.durationSeconds)) * 100) : 0}%` }} />
                  </div>
                  <span className="expanded-sub">{fmtTime(Number(primary.data?.positionSeconds ?? 0))} / {fmtTime(Number(primary.data?.durationSeconds ?? 0))}</span>
                  <div className="state-grid">
                    <Button onClick={() => actions.onMediaControl('previous')} aria-label="Previous track">Previous</Button>
                    <Button variant="primary" onClick={() => actions.onMediaControl('toggle')}>
                      {primary.data?.status === 'playing' ? 'Pause' : 'Play'}
                    </Button>
                    <Button onClick={() => actions.onMediaControl('next')} aria-label="Next track">Next</Button>
                  </div>
                </div>
              </div>
            )}
            {primary?.kind === 'volume' && (
              <div className="state-grid">
                <input type="range" min={0} max={100} aria-label="Volume"
                  value={Math.round(Number(primary.data?.level ?? 0) * 100)}
                  onChange={(e) => actions.onVolume(Number(e.target.value) / 100)} />
                <Button onClick={() => actions.onMute()}>{primary.data?.muted ? 'Unmute' : 'Mute'}</Button>
              </div>
            )}
            {(primary?.kind === 'timer' || primary?.kind === 'stopwatch') && (
              <div className="state-grid"><Button onClick={() => actions.onTimer('stop')}>Stop</Button></div>
            )}
            {activities.slice(1).map((a) => (
              <div key={a.id} className="activity-row">
                <span>{a.title}</span>
                <Button onClick={() => onDismiss(a.id)} aria-label={`Dismiss ${a.title}`}>Dismiss</Button>
              </div>
            ))}
            {state.view === 'full' && (
              <div className="media-controls">
                <span className="expanded-sub">Start a timer</span>
                <div className="state-grid">
                  {[1, 5, 15, 25].map((m) => (
                    <Button key={m} onClick={() => actions.onTimer('countdown', m)}>{m} min</Button>
                  ))}
                  <Button onClick={() => actions.onTimer('stopwatch')}>Stopwatch</Button>
                  <Button onClick={() => actions.onTimer('stop')}>Stop timer</Button>
                </div>
                <div className="state-grid">
                  <Button onClick={() => window.location.assign('#/security')}>Security settings</Button>
                  <Button onClick={() => window.location.assign('#/devhub')}>Developer Hub</Button>
                  <Button onClick={() => window.location.assign('#/hub')}>Extras</Button>
                </div>
              </div>
            )}
            {primary && <Button onClick={() => onDismiss(primary.id)}>Dismiss activity</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

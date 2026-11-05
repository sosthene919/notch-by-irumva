import { useEffect, useMemo, useReducer, useState } from 'react';
import { ActivityManager } from './core/activityManager';
import { initialState, reduce } from './core/stateMachine';
import type { IslandEvent } from './core/types';
import { Island, type IslandActions } from './components/Island';
import { Button } from './components/ui';
import { StyleGuide } from './routes/StyleGuide';
import { demoProvider, demoSecondProvider } from './providers/demoProvider';
import { createNowPlayingProvider } from './providers/nowPlaying';
import { createTimerProvider } from './providers/timers';
import { createBatteryProvider } from './providers/battery';
import { createVolumeProvider } from './providers/volume';
import { createPrivacyProvider } from './providers/privacy';
import { notificationsProvider } from './providers/notifications';
import { isTauri } from './platform/window';

export default function App() {
  if (window.location.hash.startsWith('#/styleguide')) return <StyleGuide />;
  return <IslandApp />;
}

function IslandApp() {
  const manager = useMemo(() => new ActivityManager(), []);
  const providers = useMemo(() => ({
    nowPlaying: createNowPlayingProvider(),
    timers: createTimerProvider(),
    battery: createBatteryProvider(),
    volume: createVolumeProvider(),
    privacy: createPrivacyProvider(),
  }), []);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [, force] = useState(0);

  useEffect(() => {
    manager.onChange = () => {
      force((n) => n + 1);
      dispatch({ type: 'ACTIVITIES_CHANGED', orderedIds: manager.ordered().map((a) => a.id) });
    };
    manager.registerProvider(providers.timers);
    if (isTauri) {
      manager.registerProvider(providers.nowPlaying);
      manager.registerProvider(providers.battery);
      manager.registerProvider(providers.volume);
      manager.registerProvider(providers.privacy);
    } else {
      manager.registerProvider(demoProvider);
    }
    manager.registerProvider(notificationsProvider, false); // blocked: ASSUMPTIONS A7
    const expiry = window.setInterval(() => manager.tick(Date.now()), 1000);
    return () => window.clearInterval(expiry);
  }, [manager, providers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); dispatch({ type: 'HOTKEY' }); }
      if (e.key === 'Escape') dispatch({ type: 'ESCAPE' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = (type: IslandEvent['type']) => dispatch({ type } as IslandEvent);
  const actions: IslandActions = {
    onMediaControl: (a) => { void providers.nowPlaying.control(a).then(() => providers.nowPlaying.refresh()); },
    onTimer: (action, minutes) => {
      if (action === 'countdown') providers.timers.startCountdown((minutes ?? 5) * 60, `${minutes ?? 5} minute timer`);
      else if (action === 'stopwatch') providers.timers.startStopwatch();
      else providers.timers.stopAll();
    },
    onVolume: (level) => { void providers.volume.set(level); },
    onMute: () => { void providers.volume.toggleMute(); },
  };
  const activities = manager.ordered();

  return (
    <>
      <Island state={state} activities={activities} onEvent={send} onDismiss={(id) => manager.dismiss(id)} actions={actions} />
      {!isTauri && (
        <section className="dev-panel" aria-label="Browser preview controls">
          <strong>Browser preview — sample data only</strong>
          <span>Ctrl+Alt+N expands, Esc collapses, press-and-hold opens the full view (timer presets live there).</span>
          <div className="state-grid">
            <Button onClick={() => manager.registerProvider(demoSecondProvider)}>Add second activity</Button>
            <Button onClick={() => manager.setProviderEnabled('demo-second', false)}>Remove second</Button>
            <Button onClick={() => window.location.assign('#/styleguide')}>Open style guide</Button>
          </div>
          <span>View: {state.view} · Providers: {manager.providerList().map((p) => `${p.id}=${p.enabled ? 'on' : 'off'}`).join(', ') || 'none'}</span>
        </section>
      )}
    </>
  );
}

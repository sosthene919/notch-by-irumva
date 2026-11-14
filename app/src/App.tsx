import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityManager, type ActivityProvider } from './core/activityManager';
import { initialState, reduce } from './core/stateMachine';
import type { Activity, BtDevice, IslandEvent, ShelfItem, TodoItem, WaterState } from './core/types';
import { applyReminderDone, applyReminderSnooze, dueTodos, waterReminderDue } from './core/productivity';
import { CURRENT_SCHEMA, migratePrefs } from './core/migrations';
import { mergeShelfEntries, normalizeShelfEntries, pruneShelf } from './core/shelf';
import { interpretLookup, trackCacheKey, type LyricLine } from './media/lyrics';
import { Island, type HubData, type IslandActions, type LyricsView } from './components/Island';
import { Button } from './components/ui';
import { StyleGuide } from './routes/StyleGuide';
import { SecurityPanel } from './routes/Security';
import { demoProvider, demoSecondProvider } from './providers/demoProvider';
import { createNowPlayingProvider } from './providers/nowPlaying';
import { createTimerProvider } from './providers/timers';
import { createBatteryProvider } from './providers/battery';
import { createVolumeProvider } from './providers/volume';
import { createPrivacyProvider } from './providers/privacy';
import { AlertDetector, createNotificationsProvider } from './providers/notifications';
import { createWindowsNotificationsProvider } from './providers/windowsNotifications';
import { createBluetoothProvider } from './providers/bluetooth';
import { displayNative, emitManualLock, emitPrefsPatch, fullscreenNative, lyricsNative, native as coreNative, nativeSecureBridge, onFullscreenChanged, onManualLock, onNotchHover, onOpenSettings, onPrefsPatch, onSessionLock, registerGlobalHotkey, releaseNative, shelfNative, takeoverNative, type MediaSessionInfo, type StartupInfo } from './platform/native';
import { SecureSettings, type SecureBridge } from './security/secureSettings';
import { redactForLock } from './security/lockPolicy';
import { PROVIDER_CATALOG } from './core/providerCatalog';
import { hideCurrentWindow, isTauri, openSettingsPopup, setIslandScale } from './platform/window';
import { Diagnostics } from './routes/Diagnostics';

export type Material = 'solid' | 'translucent' | 'glass';

export interface Appearance {
  theme: 'auto' | 'light' | 'dark';
  /** Surface material: normal opaque black, translucent, or Liquid Glass. */
  material: Material;
  islandScale: number;
  minimalPill: boolean;
  displayIndex: number;
}

interface Prefs extends Record<string, unknown> {
  schemaVersion: number;
  providers: Record<string, boolean>;
  hotkey: string;
  shelf: { path: string; addedAt: number }[];
  todos: TodoItem[];
  water: WaterState;
  appearance: Appearance;
  lyricsEnabled: boolean;
  lyricsOffsetSec: number;
  hideOnFullscreen: boolean;
  autostart: boolean;
  showPreviews: boolean;
  hubOrder: string[];
  hubHidden: string[];
}

const todayStr = () => new Date().toDateString();
const defaultPrefs: Prefs = {
  schemaVersion: CURRENT_SCHEMA,
  providers: {},
  hotkey: 'CommandOrControl+Alt+N',
  shelf: [],
  todos: [],
  water: { goalMl: 2000, bottleMl: 500, drankMl: 0, intervalMin: 60, day: todayStr() },
  appearance: { theme: 'auto', material: 'solid', islandScale: 1, minimalPill: false, displayIndex: -1 },
  lyricsEnabled: true,
  lyricsOffsetSec: 0,
  hideOnFullscreen: true,
  autostart: true,
  showPreviews: true,
  hubOrder: [],
  hubHidden: [],
};

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (hash.startsWith('#/styleguide')) return <StyleGuide />;
  // Security lives in its own popup window (or this route in the
  // browser preview). It gets a lightweight app: no providers, no
  // island, no global hotkey — just prefs and the settings slides.
  if (hash.startsWith('#/security')) return <SettingsApp />;
  return <IslandApp />;
}

/**
 * Settings popup app. Runs in the dedicated "settings" window (or on
 * the #/security route in the browser preview): loads the same DPAPI
 * prefs, renders the Security slides, and pushes every change back to
 * the island as a prefs patch (the main window stays the provider
 * owner and re-saves the merged result). No providers start here and
 * no global hotkey is registered here.
 */
function SettingsApp() {
  const settings = useMemo(() => new SecureSettings<Prefs>(nativeSecureBridge, defaultPrefs), []);
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // Browser preview has no island to own persistence; the Tauri popup
  // only sends patches and lets the island save the merged state. This
  // prevents a stale settings-window snapshot from overwriting newer
  // island data (to-dos, water, reminders) on disk.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [hotkey, setHotkeyState] = useState(defaultPrefs.hotkey);
  const [locked, setLocked] = useState(false);
  const [isPopup, setIsPopup] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (alive && getCurrentWindow().label === 'settings') setIsPopup(true);
      } catch { /* browser preview */ }
    })();
    return () => { alive = false; };
  }, []);

  const savePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    // In Tauri the island owns the settings file. Only the browser
    // preview writes from this window; the popup sends a patch.
    if (!isTauri) {
      saveQueue.current = saveQueue.current
        .then(async () => { await settings.save(next); })
        .catch(() => {});
    }
    void emitPrefsPatch(patch as Record<string, unknown>);
  };

  useEffect(() => {
    void (async () => {
      const rawText = await nativeSecureBridge.settingsLoad().catch(() => null);
      let parsed: unknown = null;
      if (rawText) { try { parsed = JSON.parse(rawText); } catch { parsed = null; } }
      const mig = migratePrefs(parsed);
      const loaded = mig.prefs as Partial<Prefs>;
      const merged: Prefs = {
        ...defaultPrefs,
        ...loaded,
        schemaVersion: typeof loaded.schemaVersion === 'number' ? loaded.schemaVersion : CURRENT_SCHEMA,
        water: { ...defaultPrefs.water, ...(loaded.water ?? {}) },
        appearance: { ...defaultPrefs.appearance, ...(loaded.appearance ?? {}) },
      };
      prefsRef.current = merged;
      setPrefs(merged);
      if (merged.hotkey) setHotkeyState(merged.hotkey);
    })();
  }, []);

  // The popup shows its own theme (the island applies it too, via the
  // prefs patch). Island scale is NOT applied here: that resizes the
  // main window, and the island does it when the patch arrives.
  useEffect(() => {
    const theme = prefs.appearance.theme;
    const resolved = theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    if (resolved === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }, [prefs.appearance.theme]);
  // The settings window stays opaque so its slides remain readable;
  // the island window applies the chosen material itself.

  const onBack = () => {
    if (isPopup) void hideCurrentWindow();
    else window.location.assign('#/');
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPopup]);

  const bridge: SecureBridge = useMemo(() => ({
    ...nativeSecureBridge,
    dataErase: async () => {
      const ok = await nativeSecureBridge.dataErase();
      // The island resets to defaults too (its data was just erased).
      if (ok) await emitPrefsPatch({ ...defaultPrefs } as Record<string, unknown>);
      return ok;
    },
  }), []);

  const onProviderToggle = (id: string, enabled: boolean) => {
    const map = Object.fromEntries(PROVIDER_CATALOG.map((p) => [
      p.id,
      p.id === id ? enabled : prefsRef.current.providers[p.id] !== false,
    ]));
    savePrefs({ providers: map });
  };

  return (
    <SecurityPanel
      providers={PROVIDER_CATALOG.map((p) => ({ ...p, enabled: prefs.providers[p.id] !== false }))}
      bridge={bridge}
      onBack={onBack}
      locked={locked}
      hotkey={hotkey}
      onHotkeyChange={(value) => { setHotkeyState(value); savePrefs({ hotkey: value }); }}
      onManualLock={(value) => { setLocked(value); void emitManualLock(value); }}
      onProviderToggle={onProviderToggle}
      appearance={prefs.appearance}
      onAppearance={(patch) => savePrefs({ appearance: { ...prefsRef.current.appearance, ...patch } })}
      lyricsEnabled={prefs.lyricsEnabled}
      onLyricsToggle={(enabled) => savePrefs({ lyricsEnabled: enabled })}
      showPreviews={prefs.showPreviews}
      onShowPreviews={(enabled) => savePrefs({ showPreviews: enabled })}
      hubOrder={prefs.hubOrder} hubHidden={prefs.hubHidden}
      onHubPages={(hubOrder, hubHidden) => savePrefs({ hubOrder, hubHidden })}
      autostart={prefs.autostart}
      onAutostart={(enabled) => { savePrefs({ autostart: enabled }); void releaseNative.autostartSet(enabled); }}
      hideOnFullscreen={prefs.hideOnFullscreen}
      onHideOnFullscreen={(enabled) => savePrefs({ hideOnFullscreen: enabled })}
    />
  );
}

function IslandApp() {
  const manager = useMemo(() => new ActivityManager(), []);
  const providers = useMemo(() => ({
    nowPlaying: createNowPlayingProvider(),
    timers: createTimerProvider(),
    battery: createBatteryProvider(),
    volume: createVolumeProvider(),
    privacy: createPrivacyProvider(),
    windowsNotifications: createWindowsNotificationsProvider(),
  }), []);
  const settings = useMemo(() => new SecureSettings<Prefs>(nativeSecureBridge, defaultPrefs), []);
  const [state, dispatch] = useReducer(reduce, initialState);
  const alerts = useMemo(() => new AlertDetector(), []);
  const notifications = useMemo(() => createNotificationsProvider(), []);
  const mountedAt = useRef(Date.now());
  const [locked, setLocked] = useState(false);
  const [fsHidden, setFsHidden] = useState(false);
  const [batteryStatus, setBatteryStatus] = useState<{ charging: boolean; percent: number | null }>({ charging: false, percent: null });
  const [startupInfo, setStartupInfo] = useState<StartupInfo | null>(null);
  const [route, setRoute] = useState(window.location.hash);
  const [, force] = useState(0);
  const [hotkey, setHotkey] = useState(defaultPrefs.hotkey);

  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  // Serialise disk writes: two quick changes must never race, with the
  // older snapshot finishing last and silently reverting the newer one.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const savePrefs = (patch: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    saveQueue.current = saveQueue.current
      .then(async () => { await settings.save(next); })
      .catch(() => {});
  };

  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [devices, setDevices] = useState<BtDevice[]>([]);
  const [mediaSessions, setMediaSessions] = useState<MediaSessionInfo[]>([]);
  const [mediaSource, setMediaSource] = useState<string | null>(null);
  const bluetooth = useMemo(() => createBluetoothProvider(setDevices), []);
  const [lyricsData, setLyricsData] = useState<{ status: LyricsView['status']; lines: LyricLine[]; plainText?: string; forKey: string }>(
    { status: 'idle', lines: [], forKey: '' });
  const [posStamp, setPosStamp] = useState({ pos: 0, at: Date.now() });
  const reminderSinkRef = useRef<{ publish: ((a: Activity) => void) | null }>({ publish: null });
  const reminderSink = useMemo<ActivityProvider>(() => ({
    id: 'reminders',
    description: 'Reminders from your to-do list and water goal, created inside Notch.',
    start(publish) { reminderSinkRef.current = { publish }; },
    stop() { reminderSinkRef.current = { publish: null }; },
  }), []);
  const lastWaterReminder = useRef(0);

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onSessionLock(setLocked).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  // Screen-cover auto-hide (fullscreen since 1.1.0, maximized since
  // 1.2.6; event/command names keep the original "fullscreen"
  // wording): Rust watches every window on the notch's monitor,
  // fades us out via this event, then hides the window. The
  // preference is pushed to the watcher whenever it changes.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onFullscreenChanged(setFsHidden).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);
  useEffect(() => { void fullscreenNative.setEnabled(prefs.hideOnFullscreen); }, [prefs.hideOnFullscreen]);

  // Minimized means minimized (1.2.5): while a fullscreen or
  // maximized app owns the monitor the window is hidden, and any
  // open peek/expanded/full view is collapsed to its base view at
  // the same moment — so the notch that returns when the cover ends
  // is the compact pill, never a stale hub left open underneath the
  // game/video/window.
  useEffect(() => {
    if (fsHidden) dispatch({ type: 'ESCAPE' });
  }, [fsHidden]);

  // Settings popup sync: the popup owns no providers, so its prefs
  // patches are applied (and re-saved merged) here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onPrefsPatch((patch) => {
      const p = patch as Partial<Prefs>;
      if (p.providers) {
        for (const [id, enabled] of Object.entries(p.providers)) {
          manager.setProviderEnabled(id, enabled);
        }
      }
      if (typeof p.hotkey === 'string') setHotkey(p.hotkey);
      savePrefs(p);
      force((n) => n + 1);
    }).then((u) => { unlisten = u; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onManualLock(setLocked).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  // Battery status for the status strip (bolt + percent). Same 30s
  // poll cadence as the battery provider; display-only, publishes nothing.
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const load = () => {
      void coreNative.batteryGet().then((b) => {
        if (alive && b?.hasBattery) setBatteryStatus({ charging: b.charging || b.acOnline, percent: b.percent });
      });
    };
    load();
    const t = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void releaseNative.startupInfo().then((info) => { if (info) setStartupInfo(info); });
    let unlisten: (() => void) | undefined;
    void onOpenSettings(() => { void openSettingsPopup(); }).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  // Touch-to-expand: the Rust cursor watcher reports the pointer entering
  // or leaving the pill (the DOM sees it too when not click-through;
  // both paths dispatch the same idempotent events).
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void onNotchHover((entered) => dispatch({ type: entered ? 'HOVER_ENTER' : 'HOVER_LEAVE' }))
      .then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    manager.onChange = () => {
      force((n) => n + 1);
      const ordered = manager.ordered();
      dispatch({ type: 'ACTIVITIES_CHANGED', orderedIds: ordered.map((a) => a.id) });
      // Notification alerts: pop the peek banner when an alert-worthy
      // activity first appears. No pops in the first 3 s (launch state
      // is not news), none when the provider is toggled off, and none
      // when Windows itself has banners off (Focus Assist) unless our
      // own takeover is the reason they are off.
      const freshAlerts = alerts.next(ordered);
      if (freshAlerts.length > 0 && manager.isProviderEnabled('notifications')
        && Date.now() - mountedAt.current > 3000) {
        void (async () => {
          const t = await takeoverNative.get().catch(() => null);
          if (t && !t.active && !t.bannersEnabled) return;
          dispatch({ type: 'NOTIFY' });
        })();
      }
    };
    // Prime the alert detector by the clock, not by first change.
    const prime = window.setTimeout(() => alerts.next(manager.ordered()), 3500);
    // Wait for the Rust startup verdict before registering anything:
    // after 3 crashes the app starts in safe mode (core only).
    if (isTauri && startupInfo === null) {
      return () => window.clearTimeout(prime);
    }
    const safeMode = localStorage.getItem('notch.safeMode') === '1' || startupInfo?.safeMode === true;
    // Safe mode disables providers, but it must NEVER hide the user's
    // saved settings, to-dos, reminders or shelf. Data below loads in
    // both modes; only provider registration is skipped.
    if (!safeMode) {
      manager.registerProvider(providers.timers);
      manager.registerProvider(notifications);
      manager.registerProvider(reminderSink);
      if (isTauri) {
        manager.registerProvider(providers.nowPlaying);
        manager.registerProvider(providers.battery);
        manager.registerProvider(providers.volume);
        manager.registerProvider(providers.privacy);
        manager.registerProvider(providers.windowsNotifications);
        manager.registerProvider(bluetooth);
      } else {
        manager.registerProvider(demoProvider);
      }
    }
    void (async () => {
      // Settings load with schema migration: back the data up before
      // a migrating save, so a failure halfway restores cleanly.
      const rawText = await nativeSecureBridge.settingsLoad().catch(() => null);
      let parsed: unknown = null;
      if (rawText) { try { parsed = JSON.parse(rawText); } catch { parsed = null; } }
      const mig = migratePrefs(parsed);
      if (mig.needsBackup) {
        await releaseNative.dataBackup(`pre-migration-v${mig.from ?? 0}`).catch(() => null);
      }
      const loaded = mig.prefs as Partial<Prefs>;
      const merged: Prefs = {
        ...defaultPrefs,
        ...loaded,
        schemaVersion: typeof loaded.schemaVersion === 'number' ? loaded.schemaVersion : CURRENT_SCHEMA,
        water: { ...defaultPrefs.water, ...(loaded.water ?? {}) },
        appearance: { ...defaultPrefs.appearance, ...(loaded.appearance ?? {}) },
      };
      if (merged.water.day !== todayStr()) merged.water = { ...merged.water, drankMl: 0, day: todayStr() };
      prefsRef.current = merged;
      setPrefs(merged);
      for (const [id, enabled] of Object.entries(merged.providers)) {
        manager.setProviderEnabled(id, enabled);
      }
      if (merged.hotkey) setHotkey(merged.hotkey);
      // Shelf: migrate plain paths, drop missing files and anything
      // parked over 30 days ago (automatic cleanup).
      const normalized = normalizeShelfEntries(loaded.shelf, Date.now());
      const infos = await Promise.all(normalized.map(async (e) => {
        const info = await shelfNative.pathInfo(e.path).catch(() => null);
        return { entry: e, info };
      }));
      const existingPaths = new Set(infos.filter((i) => i.info !== null).map((i) => i.entry.path));
      const keptEntries = pruneShelf(normalized, (p) => existingPaths.has(p), Date.now());
      const keptPaths = new Set(keptEntries.map((e) => e.path));
      setShelfItems(infos
        .filter((i) => i.info !== null && keptPaths.has(i.entry.path))
        .map((i) => ({ path: i.entry.path, name: i.info!.name, size: i.info!.size })));
      if (keptEntries.length !== normalized.length
        || (loaded.shelf ?? []).some((e: unknown) => typeof e === 'string')) {
        savePrefs({ shelf: keptEntries });
      }
      if (merged.appearance.displayIndex >= 0) {
        void displayNative.moveTo(merged.appearance.displayIndex);
      }
      // Start with Windows defaults to on (Settings can change it);
      // the registry entry is synced to the saved preference.
      if (isTauri) {
        const registered = await releaseNative.autostartGet();
        if (merged.autostart !== registered) {
          await releaseNative.autostartSet(merged.autostart);
        }
      }
      force((n) => n + 1);
    })();
    const expiry = window.setInterval(() => manager.tick(Date.now()), 1000);
    return () => { window.clearInterval(expiry); window.clearTimeout(prime); };
  }, [manager, providers, settings, notifications, reminderSink, alerts, bluetooth, startupInfo]);

  // Reminder engine: due to-dos and water, checked on a slow tick.
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const p = prefsRef.current;
      if (p.water.day !== todayStr()) {
        savePrefs({ water: { ...p.water, drankMl: 0, day: todayStr() } });
      }
      const due = dueTodos(p.todos, now);
      if (due.length > 0) {
        for (const t of due) {
          reminderSinkRef.current.publish?.({
            id: `todo-${t.id}`, providerId: 'reminders', kind: 'todo-reminder',
            title: 'Reminder', subtitle: t.text, priority: 85,
            startedAt: now, // stays until Done or Snooze (no expiry)
            data: { todoId: t.id },
          });
        }
        savePrefs({ todos: p.todos.map((t) => (due.some((d) => d.id === t.id) ? { ...t, reminded: true } : t)) });
      }
      const water = prefsRef.current.water;
      if (waterReminderDue(water, lastWaterReminder.current, now, new Date().getHours())) {
        lastWaterReminder.current = now;
        reminderSinkRef.current.publish?.({
          id: `water-${now}`, providerId: 'reminders', kind: 'water-reminder',
          title: 'Drink water', subtitle: `${water.drankMl} of ${water.goalMl} ml today`,
          priority: 60, startedAt: now, expiresAt: now + 60_000,
        });
      }
    };
    const t = window.setInterval(check, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Media sessions list for the source switcher.
  const nowPlayingAct = manager.ordered().find((a) => a.kind === 'now-playing') ?? null;
  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    const load = () => { void providers.nowPlaying.sessions().then((s) => { if (alive) setMediaSessions(s); }); };
    load();
    const t = window.setInterval(load, 20_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [providers, nowPlayingAct?.data?.app]);

  // Synced lyrics: one LRCLib lookup per track, cached on this PC.
  const lyricsTrackKey = nowPlayingAct
    ? trackCacheKey({
      title: nowPlayingAct.title,
      artist: String(nowPlayingAct.data?.artist ?? ''),
      album: String(nowPlayingAct.data?.album ?? ''),
      durationSec: Number(nowPlayingAct.data?.durationSeconds ?? 0),
    })
    : '';
  useEffect(() => {
    if (!prefs.lyricsEnabled || !nowPlayingAct) {
      setLyricsData((d) => (d.status === 'idle' ? d : { status: 'idle', lines: [], forKey: '' }));
      return;
    }
    const track = {
      title: nowPlayingAct.title,
      artist: String(nowPlayingAct.data?.artist ?? ''),
      album: String(nowPlayingAct.data?.album ?? ''),
      durationSec: Number(nowPlayingAct.data?.durationSeconds ?? 0),
    };
    const key = trackCacheKey(track);
    let alive = true;
    void (async () => {
      const cached = await lyricsNative.cacheGet(key).catch(() => null);
      if (!alive) return;
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { status: LyricsView['status']; lines: LyricLine[]; plainText?: string };
          setLyricsData({ ...parsed, forKey: key });
          return;
        } catch { /* fall through to the lookup */ }
      }
      setLyricsData({ status: 'loading', lines: [], forKey: key });
      const raw = await lyricsNative.lookup(track.title, track.artist, track.album, track.durationSec)
        .catch(() => null);
      if (!alive) return;
      const result = interpretLookup(raw);
      setLyricsData({ ...result, forKey: key });
      // Cache every answer locally (including "none" and
      // "instrumental"); a failed request (offline) is not cached.
      if (result.status !== 'offline') {
        void lyricsNative.cacheSet(key, JSON.stringify(result));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsTrackKey, prefs.lyricsEnabled]);

  // Position stamp for lyric interpolation between 5 s media ticks.
  useEffect(() => {
    const pos = Number(nowPlayingAct?.data?.positionSeconds ?? 0);
    setPosStamp({ pos, at: Date.now() });
  }, [nowPlayingAct?.data?.positionSeconds]);

  // Appearance: theme, island scale (+ window size), display is applied
  // from Security via displayNative and at startup below.
  useEffect(() => {
    const theme = prefs.appearance.theme;
    const resolved = theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : theme;
    if (resolved === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
  }, [prefs.appearance.theme]);
  useEffect(() => {
    document.documentElement.dataset.material = prefs.appearance.material ?? 'solid';
  }, [prefs.appearance.material]);
  useEffect(() => { void setIslandScale(prefs.appearance.islandScale); }, [prefs.appearance.islandScale]);

  useEffect(() => {
    let cancelled = false;
    void registerGlobalHotkey(hotkey, () => { if (!cancelled) dispatch({ type: 'HOTKEY' }); });
    return () => { cancelled = true; };
  }, [hotkey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); dispatch({ type: 'HOTKEY' }); }
      if (e.key === 'Escape') {
        dispatch({ type: 'ESCAPE' });
        if (route.startsWith('#/diagnostics')) {
          window.location.assign('#/');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  const hub: HubData = {
    shelf: {
      items: shelfItems,
      onRemove: (path) => {
        const next = shelfItems.filter((i) => i.path !== path);
        setShelfItems(next);
        const keep = new Set(next.map((i) => i.path));
        savePrefs({ shelf: prefsRef.current.shelf.filter((e) => keep.has(e.path)) });
      },
      onOpen: (path) => { void shelfNative.launchPath(path); },
      onReveal: (path) => { void shelfNative.revealPath(path); },
      onCopyPaths: (paths) => { void shelfNative.copyText(paths.join('\n')); },
      onClear: () => { setShelfItems([]); savePrefs({ shelf: [] }); },
    },
    todos: {
      items: prefs.todos,
      onAdd: (text, dueAt, recur, weekday) => savePrefs({
        todos: [...prefsRef.current.todos, { id: Date.now() + Math.floor(Math.random() * 1000), text, dueAt, done: false, recur, weekday }],
      }),
      onToggle: (id) => savePrefs({
        todos: prefsRef.current.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
      }),
      onRemove: (id) => savePrefs({ todos: prefsRef.current.todos.filter((t) => t.id !== id) }),
    },
    water: {
      state: prefs.water,
      onDrink: () => savePrefs({ water: { ...prefsRef.current.water, drankMl: prefsRef.current.water.drankMl + prefsRef.current.water.bottleMl } }),
      onBottle: (ml) => savePrefs({ water: { ...prefsRef.current.water, bottleMl: ml } }),
      onGoal: (ml) => savePrefs({ water: { ...prefsRef.current.water, goalMl: ml } }),
      onInterval: (min) => savePrefs({ water: { ...prefsRef.current.water, intervalMin: min } }),
    },
  };

  const onShelfDrop = (paths: string[]) => {
    void (async () => {
      const infos: { path: string; name: string; size: number }[] = await Promise.all(paths.map(async (path: string) => {
        const info = await shelfNative.pathInfo(path).catch(() => null);
        return info ? { path, name: info.name, size: info.size } : { path, name: path.split(/[\\/]/).pop() ?? path, size: 0 };
      }));
      const entries = mergeShelfEntries(prefsRef.current.shelf, infos.map((i) => i.path), Date.now());
      savePrefs({ shelf: entries });
      const entryKeys = new Set(entries.map((e) => e.path.toLowerCase()));
      setShelfItems((prev) => {
        const merged = prev.filter((m) => entryKeys.has(m.path.toLowerCase()));
        for (const it of infos) {
          if (!merged.some((m) => m.path.toLowerCase() === it.path.toLowerCase())) merged.push(it);
        }
        return merged.slice(0, 24);
      });
      force((n) => n + 1);
    })();
  };

  const send = (type: IslandEvent['type']) => dispatch({ type } as IslandEvent);
  const actions: IslandActions = {
    onMediaControl: (a) => { void providers.nowPlaying.control(a).then(() => providers.nowPlaying.refresh()); },
    onMediaSeek: (s) => { void providers.nowPlaying.seek(s).then(() => providers.nowPlaying.refresh()); },
    onShuffle: (active) => { void providers.nowPlaying.setShuffle(active).then(() => providers.nowPlaying.refresh()); },
    onRepeat: (mode) => { void providers.nowPlaying.setRepeat(mode).then(() => providers.nowPlaying.refresh()); },
    onLyricsOffset: (delta) => savePrefs({
      lyricsOffsetSec: Math.max(-5, Math.min(5, Math.round((prefsRef.current.lyricsOffsetSec + delta) * 10) / 10)),
    }),
    onReminderDone: (todoId) => {
      savePrefs({ todos: applyReminderDone(prefsRef.current.todos, todoId, Date.now()) });
      manager.dismiss(`todo-${todoId}`);
    },
    onReminderSnooze: (todoId, minutes) => {
      savePrefs({ todos: applyReminderSnooze(prefsRef.current.todos, todoId, minutes, Date.now()) });
      manager.dismiss(`todo-${todoId}`);
    },
    onTimer: (action, minutes) => {
      if (action === 'countdown') providers.timers.startCountdown((minutes ?? 5) * 60, `${minutes ?? 5} minute timer`);
      else if (action === 'stopwatch') providers.timers.startStopwatch();
      else if (action === 'pause') providers.timers.pause();
      else if (action === 'resume') providers.timers.resume();
      else providers.timers.stopAll();
    },
    onVolume: (level) => { void providers.volume.set(level); },
    onVolumeStep: (delta) => {
      const cur = providers.volume.current()?.level ?? 0.5;
      void providers.volume.set(Math.max(0, Math.min(1, cur + delta)));
    },
    onMute: () => { void providers.volume.toggleMute(); },
  };

  const lyricsView: LyricsView = {
    status: prefs.lyricsEnabled ? lyricsData.status : 'idle',
    lines: lyricsData.lines,
    plainText: lyricsData.plainText,
    basePosition: posStamp.pos,
    updatedAt: posStamp.at,
    playing: nowPlayingAct?.data?.status === 'playing',
    offsetSec: prefs.lyricsOffsetSec,
  };
  const activities = redactForLock(manager.ordered(), locked);
  const safeModeActive = localStorage.getItem('notch.safeMode') === '1' || startupInfo?.safeMode === true;

  if (route.startsWith('#/diagnostics')) {
    return <Diagnostics manager={manager} onTestNotification={() => notifications.fireTest()} />;
  }

  return (
    <>
      <Island
        state={state} activities={activities} onEvent={send}
        onDismiss={(id) => manager.dismiss(id)} actions={actions}
        scale={prefs.appearance.islandScale} minimalPill={prefs.appearance.minimalPill}
        showPreviews={prefs.showPreviews} hubOrder={prefs.hubOrder} hubHidden={prefs.hubHidden}
        hub={hub} devices={devices} lyrics={lyricsView}
        media={{
          sessions: mediaSessions,
          source: mediaSource,
          onSelectSource: (app) => { setMediaSource(app); providers.nowPlaying.setSource(app); },
        }}
        onShelfDrop={onShelfDrop}
        fsHidden={fsHidden}
        blockClickThrough={safeModeActive}
        status={{
          charging: batteryStatus.charging,
          batteryPercent: batteryStatus.percent,
          alert: activities.some((a) => a.kind === 'app-notification' || a.kind === 'test-notification' || a.kind === 'todo-reminder'),
        }}
      />
      {safeModeActive && (
        <section className="dev-panel safe-mode-panel" aria-label="Safe mode notice" role="alertdialog">
          <strong>Notch is in safe mode</strong>
          <span>
            It did not start cleanly {startupInfo?.crashCount ?? 0} times, so media, notifications and
            Bluetooth are off. Your settings, to-dos and shelf are still loaded and untouched.
          </span>
          <div className="state-grid">
            {startupInfo?.rollbackAvailable && (
              <Button variant="primary" onClick={() => { void releaseNative.performRollback().catch(() => {}); }}>
                Restore the previous version
              </Button>
            )}
            <Button onClick={() => {
              localStorage.removeItem('notch.safeMode');
              // Clear the marker and the Rust-side cached verdict before
              // reloading; otherwise get_startup_info still reports the
              // old safe-mode state and the notice never goes away.
              void releaseNative.resetCrashState().finally(() => {
                setStartupInfo((prev) => (prev ? { ...prev, safeMode: false, crashCount: 0 } : prev));
                window.location.reload();
              });
            }}>
              Exit safe mode
            </Button>
          </div>
        </section>
      )}
      {!isTauri && (
        <section className="dev-panel" aria-label="Browser preview controls">
          <strong>Browser preview. Sample data only.</strong>
          <span>Ctrl+Alt+N expands, Esc collapses, press and hold opens the hub. Open views auto-hide 5 seconds after your last interaction.</span>
          <div className="state-grid">
            <Button onClick={() => manager.registerProvider(demoSecondProvider)}>Add second activity</Button>
            <Button onClick={() => manager.setProviderEnabled('demo-second', false)}>Remove second</Button>
            <Button onClick={() => window.location.assign('#/styleguide')}>Open style guide</Button>
            <Button onClick={() => window.location.assign('#/security')}>Open security settings</Button>
          </div>
          <span>View: {state.view} · Providers: {manager.providerList().map((p) => `${p.id}=${p.enabled ? 'on' : 'off'}`).join(', ') || 'none'}</span>
        </section>
      )}
    </>
  );
}

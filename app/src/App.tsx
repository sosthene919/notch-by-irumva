import { useEffect, useMemo, useReducer, useState } from 'react';
import { ActivityManager } from './core/activityManager';
import { initialState, reduce } from './core/stateMachine';
import type { IslandEvent } from './core/types';
import { Island, type IslandActions } from './components/Island';
import { Button } from './components/ui';
import { StyleGuide } from './routes/StyleGuide';
import { SecurityPanel } from './routes/Security';
import { demoProvider, demoSecondProvider } from './providers/demoProvider';
import { createNowPlayingProvider } from './providers/nowPlaying';
import { createTimerProvider } from './providers/timers';
import { createBatteryProvider } from './providers/battery';
import { createVolumeProvider } from './providers/volume';
import { createPrivacyProvider } from './providers/privacy';
import { notificationsProvider } from './providers/notifications';
import { createIpcProvider } from './providers/ipc';
import { nativeSecureBridge, onSessionLock, devhubNative } from './platform/native';
import { SecureSettings } from './security/secureSettings';
import { redactForLock } from './security/lockPolicy';
import { isTauri } from './platform/window';
import { ApprovalManager, holdToConfirmGate, type ApprovalDecision, type StrongGate } from './core/approvals';
import { ReviewManager, validateReview, type ReviewDecision } from './core/reviews';
import { DevHub } from './routes/DevHub';
import { OpenCodeClient } from './devhub/opencode';
import { OpenCodeTasks, taskToActivity, type AgentTask } from './devhub/tasks';
import type { ActivityProvider } from './core/activityManager';
import { useRef } from 'react';
import { Hub } from './routes/Hub';
import { ClipboardHistory, FileShelf, type CalendarEvent } from './premium/stores';
import { premiumNative, registerGlobalHotkey } from './platform/native';

interface Prefs extends Record<string, unknown> {
  providers: Record<string, boolean>;
  recentWorkspaces: string[];
  hotkey: string;
  pinnedApps: { name: string; path: string }[];
}

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
    ipc: createIpcProvider(),
  }), []);
  const settings = useMemo(() => new SecureSettings<Prefs>(nativeSecureBridge, {
    providers: {}, recentWorkspaces: [], hotkey: 'CommandOrControl+Alt+N', pinnedApps: [],
  }), []);
  const [state, dispatch] = useReducer(reduce, initialState);
  const [locked, setLocked] = useState(false);
  const [route, setRoute] = useState(window.location.hash);
  const [, force] = useState(0);

  // ---- Developer Hub (Phase 4) ----
  const holdGate = useMemo(() => holdToConfirmGate(1200), []);
  const gate = useMemo<StrongGate>(() => ({
    verify: async (req) => {
      const r = await nativeSecureBridge.helloVerify(`Allow ${req.agent} to run: ${req.action.slice(0, 80)}`);
      if (r.ok) return true;
      if (r.status.startsWith('hello-unavailable')) return holdGate.verify(req);
      return false;
    },
  }), [holdGate]);
  const approvals = useMemo(() => new ApprovalManager(gate), [gate]);
  const reviews = useMemo(() => new ReviewManager(), []);
  const sinkRef = useRef<{ publish: ((a: import('./core/types').Activity) => void) | null; remove: ((id: string) => void) | null }>({ publish: null, remove: null });
  const sinkProvider = useMemo<ActivityProvider>(() => ({
    id: 'opencode',
    description: 'OpenCode agent tasks started from the Developer Hub, including their permission requests.',
    start(publish, remove) { sinkRef.current = { publish, remove }; },
    stop() { sinkRef.current = { publish: null, remove: null }; },
  }), []);
  const clientRef = useRef<OpenCodeClient | null>(null);
  const tasksRef = useRef<OpenCodeTasks | null>(null);
  const permMapRef = useRef(new Map<string, { sessionId: string; permissionId: string; taskId: string }>());
  const forwardedRef = useRef(new Set<string>());
  const reviewCommentRef = useRef(new Map<string, string>());
  const reviewForwardedRef = useRef(new Set<string>());
  const [taskList, setTaskList] = useState<AgentTask[]>([]);
  const [serverStatus, setServerStatus] = useState('Not checked');
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);

  // ---- Premium (Phase 5) ----
  const shelf = useMemo(() => new FileShelf(), []);
  const clipboardHistory = useMemo(() => new ClipboardHistory(), []);
  const [hotkey, setHotkey] = useState('CommandOrControl+Alt+N');
  const [pinnedApps, setPinnedApps] = useState<{ name: string; path: string }[]>([]);
  const premiumSinkRef = useRef<{ publish: ((a: import('./core/types').Activity) => void) | null; remove: ((id: string) => void) | null }>({ publish: null, remove: null });
  const premiumSink = useMemo<ActivityProvider>(() => ({
    id: 'premium',
    description: 'File Shelf and calendar reminders from the Extras hub.',
    start(publish, remove) { premiumSinkRef.current = { publish, remove }; },
    stop() { premiumSinkRef.current = { publish: null, remove: null }; },
  }), []);
  const publishShelfSummary = () => {
    const items = shelf.list();
    if (items.length === 0) { premiumSinkRef.current.remove?.('shelf'); return; }
    premiumSinkRef.current.publish?.({
      id: 'shelf', providerId: 'premium', kind: 'shelf',
      title: 'File shelf', subtitle: `${items.length} parked item${items.length === 1 ? '' : 's'} (latest: ${items[0]?.name ?? ''})`,
      priority: 35, startedAt: Date.now(),
    });
  };

  const ensureTasks = (password: string | null) => {
    if (tasksRef.current) return tasksRef.current;
    const client = new OpenCodeClient('http://127.0.0.1:4096', password);
    clientRef.current = client;
    const tasks = new OpenCodeTasks(client, {
      onTask: (t) => {
        setTaskList(tasks.list());
        const activity = taskToActivity(t);
        if (t.status === 'done' || t.status === 'failed' || t.status === 'interrupted') activity.expiresAt = Date.now() + 60_000;
        sinkRef.current.publish?.(activity);
        force((n) => n + 1);
      },
      onPermission: (task, p) => {
        permMapRef.current.set(`oc-${p.id}`, { sessionId: task.id, permissionId: p.id, taskId: task.id });
        void approvals.create({
          id: `oc-${p.id}`, source: 'opencode', agent: `OpenCode ${task.agent} (${p.action})`,
          action: p.resources.join(' ') || p.action, cwd: task.workspace, workspace: task.workspace,
        });
      },
    });
    tasksRef.current = tasks;
    return tasks;
  };

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
      manager.registerProvider(providers.ipc);
      manager.registerProvider(sinkProvider);
      manager.registerProvider(premiumSink);
    } else {
      manager.registerProvider(demoProvider);
    }
    manager.registerProvider(notificationsProvider, false); // blocked: ASSUMPTIONS A7
    // Restore per-provider permissions (DPAPI-encrypted settings in the app).
    void settings.load().then((prefs) => {
      for (const [id, enabled] of Object.entries(prefs.providers)) {
        if (id !== 'notifications') manager.setProviderEnabled(id, enabled);
      }
      setRecentWorkspaces(prefs.recentWorkspaces ?? []);
      if (prefs.hotkey) setHotkey(prefs.hotkey);
      setPinnedApps(prefs.pinnedApps ?? []);
      force((n) => n + 1);
    });
    const expiry = window.setInterval(() => manager.tick(Date.now()), 1000);
    return () => window.clearInterval(expiry);
  }, [manager, providers, settings, sinkProvider, premiumSink]);

  // Phase 5 effects: native drag-drop onto the island (File Shelf),
  // clipboard history listener, configurable global hotkey.
  useEffect(() => {
    if (!isTauri) return;
    let unDrop: (() => void) | undefined;
    let unClip: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unDrop = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            for (const path of event.payload.paths) shelf.add(path);
            publishShelfSummary();
            force((n) => n + 1);
          }
        });
      } catch { /* drag-drop unavailable */ }
      unClip = await premiumNative.onClipboardChanged(async () => {
        const text = await premiumNative.clipboardGet();
        if (text && clipboardHistory.add(text)) force((n) => n + 1);
      });
      const current = await premiumNative.clipboardGet();
      if (current) clipboardHistory.add(current);
    })();
    return () => { unDrop?.(); unClip?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf, clipboardHistory]);

  useEffect(() => {
    let cancelled = false;
    void registerGlobalHotkey(hotkey, () => { if (!cancelled) dispatch({ type: 'HOTKEY' }); });
    return () => { cancelled = true; };
  }, [hotkey]);

  // Developer Hub forwarding: when an approval/review reaches a terminal
  // state in the UI core, answer the waiting source exactly once.
  useEffect(() => {
    approvals.onChange = () => {
      force((n) => n + 1);
      for (const req of approvals.all()) {
        if (req.status === 'pending' || forwardedRef.current.has(req.id)) continue;
        forwardedRef.current.add(req.id);
        const allowed = req.status === 'allowed-once' || req.status === 'allowed-session' || req.status === 'auto-allowed-session';
        if (req.source === 'bridge') {
          void devhubNative.approvalRespond(req.id, req.actionHash, req.status === 'denied' || req.status === 'expired' ? 'deny' : req.status === 'allowed-session' ? 'allow-session' : 'allow-once');
        } else if (req.source === 'opencode') {
          const mapping = permMapRef.current.get(req.id);
          if (mapping && clientRef.current) {
            void clientRef.current.replyPermission(mapping.sessionId, mapping.permissionId, allowed ? 'once' : 'reject')
              .catch(() => {})
              .finally(() => tasksRef.current?.permissionResolved(mapping.taskId));
          }
        }
      }
    };
    reviews.onChange = () => {
      force((n) => n + 1);
      for (const review of reviews.pending()) void review;
      // decided reviews are forwarded in onReviewDecision (comment lives there)
    };
    if (!isTauri) return;
    let un1: (() => void) | undefined; let un2: (() => void) | undefined;
    void devhubNative.onApprovalRequest((a) => {
      void approvals.create({
        id: a.requestId, source: 'bridge', agent: a.agent, action: a.action,
        target: a.target || undefined, cwd: a.cwd || undefined, timeoutMs: a.timeoutMs,
      });
    }).then((u) => { un1 = u; });
    void devhubNative.onReviewPropose((raw) => {
      const review = validateReview(raw);
      if (review) reviews.propose(review);
    }).then((u) => { un2 = u; });
    // Auto-connect to an already-running OpenCode server if we hold its password.
    void (async () => {
      const password = await devhubNative.opencodeServerPassword();
      const probe = new OpenCodeClient('http://127.0.0.1:4096', password);
      const health = await probe.health();
      if (health === 'running') { ensureTasks(password); setServerStatus('Running at 127.0.0.1:4096'); }
      else if (health === 'auth-required') setServerStatus('Server running, but its password is unknown. Start it from Notch so credentials are managed.');
      else setServerStatus('Not running');
    })();
    return () => { un1?.(); un2?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvals, reviews]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); dispatch({ type: 'HOTKEY' }); }
      if (e.key === 'Escape') dispatch({ type: 'ESCAPE' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onProviderToggle = (id: string, enabled: boolean) => {
    manager.setProviderEnabled(id, enabled);
    const map = Object.fromEntries(manager.providerList().map((p) => [p.id, p.enabled]));
    void settings.save({ providers: map, recentWorkspaces, hotkey, pinnedApps }).catch(() => {});
    force((n) => n + 1);
  };

  const onApprovalDecision = async (id: string, decision: ApprovalDecision): Promise<string | undefined> => {
    const req = approvals.get(id);
    if (!req) return 'This request is no longer available.';
    const result = await approvals.respond(id, req.actionHash, decision);
    if (result.ok) return undefined;
    if (result.error === 'strong-gate-failed') return 'Confirmation failed. For high-risk actions, hold the Allow button for 1.2 seconds (Windows Hello is unavailable on this machine).';
    if (result.error === 'expired') return 'This request expired and was denied.';
    return `Could not record that decision (${result.error}).`;
  };

  const onReviewDecision = (id: string, decision: ReviewDecision, comment: string) => {
    reviewCommentRef.current.set(id, comment);
    const result = reviews.decide(id, decision);
    if (result.ok && !reviewForwardedRef.current.has(id)) {
      reviewForwardedRef.current.add(id);
      const status = reviews.get(id)?.status;
      const mapped = status === 'approved' ? 'approve' : status === 'changes-requested' ? 'request-changes' : status === 'open-diff' ? 'open-diff' : 'reject';
      void devhubNative.reviewRespond(id, mapped, comment);
    }
    force((n) => n + 1);
  };

  const onStartServer = async (workspace: string) => {
    setServerStatus('Starting…');
    const res = await devhubNative.opencodeServerStart(workspace);
    if (res?.error === 'opencode-not-found') {
      setServerStatus('OpenCode was not found on this PC. Install OpenCode, then try again.');
      return;
    }
    const password = res?.password ?? (await devhubNative.opencodeServerPassword());
    const probe = new OpenCodeClient('http://127.0.0.1:4096', password);
    // The server can take several seconds to boot; poll instead of guessing.
    let health = await probe.health();
    for (let i = 0; i < 9 && health === 'down'; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      health = await probe.health();
    }
    if (health === 'running') {
      clientRef.current = null; tasksRef.current = null;
      ensureTasks(password);
      setServerStatus(res?.alreadyRunning ? 'Already running at 127.0.0.1:4096' : 'Started at 127.0.0.1:4096 (loopback only, password in Credential Manager)');
    } else {
      setServerStatus('Server did not answer yet. Give it a few seconds, then press Start task.');
    }
    force((n) => n + 1);
  };

  const onStartTask = (input: { prompt: string; workspace: string; agent: string; model?: { providerID: string; id: string } }) => {
    const recents = [input.workspace, ...recentWorkspaces.filter((w) => w !== input.workspace)].slice(0, 5);
    setRecentWorkspaces(recents);
    const map = Object.fromEntries(manager.providerList().map((p) => [p.id, p.enabled]));
    void settings.save({ providers: map, recentWorkspaces: recents, hotkey, pinnedApps }).catch(() => {});
    const tasks = tasksRef.current ?? ensureTasks(null);
    // If the client was created without the managed password, refresh it.
    void (async () => {
      if (!clientRef.current) return;
      const health = await clientRef.current.health().catch(() => 'down' as const);
      if (health === 'auth-required') {
        const password = await devhubNative.opencodeServerPassword();
        clientRef.current = null; tasksRef.current = null;
        await ensureTasks(password).start(input);
        return;
      }
      await tasks.start(input);
    })();
  };

  const savePrefs = (patch: Partial<Prefs>) => {
    const map = Object.fromEntries(manager.providerList().map((p) => [p.id, p.enabled]));
    void settings.save({ providers: map, recentWorkspaces, hotkey, pinnedApps, ...patch }).catch(() => {});
  };
  const onHotkeyChange = (value: string) => { setHotkey(value); savePrefs({ hotkey: value }); };
  const onPinnedChange = (apps: { name: string; path: string }[]) => { setPinnedApps(apps); savePrefs({ pinnedApps: apps }); };
  const onCopyText = (text: string) => {
    void premiumNative.clipboardSet(text);
    clipboardHistory.add(text);
    force((n) => n + 1);
  };
  const onCalendarNext = (event: CalendarEvent | null) => {
    if (!event) { premiumSinkRef.current.remove?.('calendar-next'); return; }
    premiumSinkRef.current.publish?.({
      id: 'calendar-next', providerId: 'premium', kind: 'calendar',
      title: event.title, subtitle: `Starts ${new Date(event.start).toLocaleString()}`,
      priority: 55, startedAt: Date.now(),
      expiresAt: Math.max(event.start, Date.now() + 60_000),
    });
  };

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
  const activities = redactForLock(manager.ordered(), locked);

  if (route.startsWith('#/security')) {
    return <SecurityPanel manager={manager} bridge={nativeSecureBridge} locked={locked} onManualLock={setLocked} onProviderToggle={onProviderToggle} />;
  }
  if (route.startsWith('#/hub')) {
    return (
      <Hub shelf={shelf} clipboard={clipboardHistory} hotkey={hotkey} pinnedApps={pinnedApps}
        onHotkeyChange={onHotkeyChange} onPinnedChange={onPinnedChange}
        onCalendarNext={onCalendarNext} onCopyText={onCopyText} onShelfChange={publishShelfSummary} />
    );
  }
  if (route.startsWith('#/devhub')) {
    return (
      <DevHub
        approvals={approvals} reviews={reviews} tasks={taskList} serverStatus={serverStatus}
        recentWorkspaces={recentWorkspaces}
        onStartTask={onStartTask} onStartServer={onStartServer}
        onAbortTask={(id) => { void tasksRef.current?.abort(id); }}
        onRerunTask={(id) => { void tasksRef.current?.rerun(id); }}
        onApprovalDecision={onApprovalDecision} onReviewDecision={onReviewDecision}
        onHoldStart={(id) => holdGate.beginHold(id)} onHoldEnd={() => holdGate.endHold()}
      />
    );
  }

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
            <Button onClick={() => window.location.assign('#/security')}>Open security settings</Button>
          </div>
          <span>View: {state.view} · Providers: {manager.providerList().map((p) => `${p.id}=${p.enabled ? 'on' : 'off'}`).join(', ') || 'none'}</span>
        </section>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Button, Card, Row } from '../components/ui';
import type { ActivityManager } from '../core/activityManager';
import { diagnosticsNative, releaseNative, type PerfInfo } from '../platform/native';

/**
 * Diagnostics (brief section 6): per-provider state, event-bus rates,
 * frame times measured live, and process memory from the Rust shell.
 * "Restart in safe mode" disables every provider on the next load.
 */
export function Diagnostics({ manager, onTestNotification }: { manager: ActivityManager; onTestNotification: () => void }) {
  const notificationsEnabled = manager.providerList().find((p) => p.id === 'notifications')?.enabled ?? false;
  const [exportedTo, setExportedTo] = useState<string>('');
  const [perf, setPerf] = useState<PerfInfo | null>(null);
  const [frames, setFrames] = useState<{ fps: number; p95: number } | null>(null);
  const samples = useRef<number[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => { const p = await diagnosticsNative.perf(); if (alive) setPerf(p); };
    void load();
    const t = setInterval(load, 2000);
    let raf = 0; let last = performance.now();
    const loop = (now: number) => {
      samples.current.push(now - last);
      if (samples.current.length > 240) samples.current.shift();
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const report = setInterval(() => {
      const sorted = [...samples.current].sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
      setFrames({ fps: Math.round(1000 / Math.max(1, avg)), p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10 });
    }, 1000);
    return () => { alive = false; clearInterval(t); clearInterval(report); cancelAnimationFrame(raf); };
  }, []);

  const safeMode = localStorage.getItem('notch.safeMode') === '1';
  return (
    <main className="styleguide">
      <h1>Diagnostics</h1>
      <Card title="Process (Rust shell)">
        {perf ? (
          <>
            <Row label="Working set">{perf.workingSetMb.toFixed(1)} MB</Row>
            <Row label="Private memory">{perf.privateMb.toFixed(1)} MB</Row>
          </>
        ) : <p className="expanded-sub">Available in the Windows app.</p>}
        {frames && <Row label="Frame rate (this page)">{frames.fps} fps · p95 frame {frames.p95} ms</Row>}
      </Card>
      <Card title="Notifications">
        <p className="expanded-sub">
          {notificationsEnabled
            ? 'Sends a test alert and jumps back to the island, so you can watch the banner pop and auto-hide.'
            : 'Banner pops are off. Enable the "notifications" provider in Security settings, then come back.'}
        </p>
        <div className="state-grid">
          <Button variant="primary" disabled={!notificationsEnabled}
            onClick={() => { onTestNotification(); window.location.assign('#/'); }}>
            Send test notification
          </Button>
        </div>
      </Card>
      <Card title="Diagnostics export">
        <p className="expanded-sub">Writes a zip with the version, startup state and local logs. No personal data, no notification text, nothing is uploaded. Inspect it before sharing.</p>
        <div className="state-grid">
          <Button variant="primary" onClick={async () => {
            const summary = `providers: ${manager.providerList().map((p) => `${p.id}=${p.enabled ? 'on' : 'off'}`).join(', ')}`;
            const path = await releaseNative.exportDiagnostics(summary).catch(() => null);
            setExportedTo(path ?? 'Export failed. The diagnostics folder could not be written.');
          }}>
            Export diagnostics
          </Button>
        </div>
        {exportedTo ? <p className="expanded-sub">{exportedTo}</p> : null}
      </Card>
      <Card title="Event bus">
        <Row label="Published">{manager.bus.stats.published}</Row>
        <Row label="Delivered">{manager.bus.stats.delivered}</Row>
        <Row label="Dropped (bounded queue)">{manager.bus.stats.dropped}</Row>
        <Row label="Pending">{manager.bus.pending}</Row>
      </Card>
      <Card title="Providers">
        {manager.providerList().map((p) => <Row key={p.id} label={p.id}>{p.enabled ? 'enabled' : 'disabled'}</Row>)}
        {manager.providerList().length === 0 && <p className="expanded-sub">No providers registered (safe mode).</p>}
      </Card>
      <Card title="Safe mode">
        <p className="expanded-sub">{safeMode ? 'Safe mode is ON: all providers are disabled.' : 'Safe mode disables every provider on the next start.'}</p>
        <div className="state-grid">
          <Button variant="danger" onClick={() => { localStorage.setItem('notch.safeMode', '1'); window.location.hash = '#/'; window.location.reload(); }}>
            Restart in safe mode
          </Button>
          {safeMode && (
            <Button variant="primary" onClick={() => {
              localStorage.removeItem('notch.safeMode');
              // Also clear the on-disk crash streak and Rust's cached
              // startup verdict, or the next load still reports safe mode.
              void releaseNative.resetCrashState().finally(() => {
                window.location.hash = '#/';
                window.location.reload();
              });
            }}>Exit safe mode</Button>
          )}
        </div>
      </Card>
      <Button onClick={() => window.location.assign('#/')}>Back to island</Button>
      <p className="row-label">Tip: Esc also returns to the island.</p>
    </main>
  );
}

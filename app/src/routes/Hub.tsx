import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Row } from '../components/ui';
import type { ClipboardHistory, FileShelf } from '../premium/stores';
import { filterApps, nextEvent, parseIcs, type CalendarEvent } from '../premium/stores';
import { premiumNative, type Vitals } from '../platform/native';

interface Props {
  shelf: FileShelf;
  clipboard: ClipboardHistory;
  hotkey: string;
  pinnedApps: { name: string; path: string }[];
  onHotkeyChange(hotkey: string): void;
  onPinnedChange(apps: { name: string; path: string }[]): void;
  onCalendarNext(event: CalendarEvent | null): void;
  onCopyText(text: string): void;
  onShelfChange(): void;
}

const HOTKEYS = ['CommandOrControl+Alt+N', 'CommandOrControl+Shift+N', 'Alt+Space'];

/** Premium hub (Phase 5): File Shelf, clipboard, launcher, calendar,
 *  vitals, world clocks, quick actions. Island-sized window, scrollable. */
export function Hub({ shelf, clipboard, hotkey, pinnedApps, onHotkeyChange, onPinnedChange, onCalendarNext, onCopyText, onShelfChange }: Props) {
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  useEffect(() => { const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  const [vitals, setVitals] = useState<Vitals | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { const v = await premiumNative.vitals(); if (alive) setVitals(v); };
    void load();
    const t = setInterval(load, 2000); // only while this page is open
    return () => { alive = false; clearInterval(t); };
  }, []);

  const [apps, setApps] = useState<{ name: string; path: string }[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => { void premiumNative.launcherApps().then((a) => setApps(a ?? [])); }, []);
  const results = useMemo(() => filterApps(apps, query), [apps, query]);

  const [clipQuery, setClipQuery] = useState('');
  const [icsPath, setIcsPath] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calMsg, setCalMsg] = useState('');
  const upcoming = nextEvent(events);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const shelfItems = shelf.list();
  const zones = [
    { label: 'Local', time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    { label: 'UTC', time: now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) },
    { label: 'Kigali', time: now.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' }) },
  ];

  return (
    <main className="styleguide">
      <h1>Extras</h1>

      <Card title="Quick actions">
        <div className="state-grid">
          <Button onClick={() => void premiumNative.screenshot()}>Screenshot</Button>
          <Button onClick={() => void premiumNative.lockWorkstation()}>Lock PC</Button>
          <Button onClick={() => void premiumNative.setDarkMode(true)}>Dark mode</Button>
          <Button onClick={() => void premiumNative.setDarkMode(false)}>Light mode</Button>
          <Button onClick={() => void premiumNative.openUrl('ms-settings:')}>Windows Settings</Button>
          <Button onClick={async () => {
            const eye = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
            if (!eye) return;
            try { const r = await new eye().open(); onCopyText(r.sRGBHex); } catch { /* user cancelled */ }
          }}>Color picker</Button>
        </div>
        <p className="expanded-sub">Color picker copies the hex value to the clipboard where supported.</p>
      </Card>

      <Card title="File Shelf (drop files onto the island to park them for 24h)">
        {shelfItems.length === 0 && <p className="expanded-sub">Shelf is empty. Drag files onto the island, or paste text below.</p>}
        {shelfItems.map((item) => (
          <div key={item.id} className="activity-row">
            <span>{item.kind === 'text' ? item.name : item.name}</span>
            <span className="state-grid">
              {item.kind !== 'text' && <Button onClick={() => void premiumNative.revealPath(item.path)}>Show in Explorer</Button>}
              {item.kind !== 'text' && <Button onClick={() => void premiumNative.launchPath(item.path)}>Open</Button>}
              {item.kind === 'text' && <Button onClick={() => onCopyText(item.path)}>Copy text</Button>}
              <Button onClick={() => { shelf.remove(item.id); onShelfChange(); refresh(); }}>Remove</Button>
            </span>
          </div>
        ))}
        <ShelfTextAdd onAdd={(text) => { shelf.addText(text); onShelfChange(); refresh(); }} />
      </Card>

      <Card title="Clipboard history (this session; sensitive-looking items are skipped)">
        <input aria-label="Search clipboard history" value={clipQuery} onChange={(e) => setClipQuery(e.target.value)} placeholder="Search history" />
        {clipboard.search(clipQuery).slice(0, 20).map((item) => (
          <div key={item.id} className="activity-row">
            <span>{item.text.slice(0, 60)}{item.pinned ? ' (pinned)' : ''}</span>
            <span className="state-grid">
              <Button onClick={() => onCopyText(item.text)}>Paste (copy)</Button>
              <Button onClick={() => { clipboard.pin(item.id); refresh(); }}>{item.pinned ? 'Unpin' : 'Pin'}</Button>
              <Button onClick={() => { clipboard.remove(item.id); refresh(); }}>Delete</Button>
            </span>
          </div>
        ))}
        {clipboard.list().length === 0 && <p className="expanded-sub">Nothing copied yet.</p>}
      </Card>

      <Card title="Launcher">
        <input aria-label="Search apps" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type to find an app" />
        {pinnedApps.length > 0 && <Row label="Pinned">{pinnedApps.map((a) => a.name).join(', ')}</Row>}
        {results.map((app) => (
          <div key={app.path} className="activity-row">
            <span>{app.name}</span>
            <span className="state-grid">
              <Button variant="primary" onClick={() => void premiumNative.launchPath(app.path)}>Open</Button>
              <Button onClick={() => {
                const exists = pinnedApps.some((a) => a.path === app.path);
                onPinnedChange(exists ? pinnedApps.filter((a) => a.path !== app.path) : [...pinnedApps, app]);
                refresh();
              }}>{pinnedApps.some((a) => a.path === app.path) ? 'Unpin' : 'Pin'}</Button>
            </span>
          </div>
        ))}
        {apps.length === 0 && <p className="expanded-sub">Reading Start Menu shortcuts…</p>}
      </Card>

      <Card title="Calendar (from an .ics file)">
        <div className="state-grid">
          <input aria-label="ICS file path" value={icsPath} onChange={(e) => setIcsPath(e.target.value)} placeholder="C:\path\to\calendar.ics" />
          <Button onClick={async () => {
            const text = await premiumNative.readTextFile(icsPath);
            if (!text) { setCalMsg('Could not read that .ics file.'); return; }
            const parsed = parseIcs(text);
            setEvents(parsed);
            const next = nextEvent(parsed) ?? null;
            onCalendarNext(next);
            setCalMsg(`${parsed.length} events loaded.`);
          }}>Load</Button>
        </div>
        {calMsg && <p className="expanded-sub">{calMsg}</p>}
        {upcoming ? (
          <>
            <Row label="Next event">{upcoming.title}</Row>
            <Row label="Starts">{new Date(upcoming.start).toLocaleString()}</Row>
            {upcoming.joinUrl && <Button variant="primary" onClick={() => void premiumNative.openUrl(upcoming.joinUrl!)}>Join meeting</Button>}
          </>
        ) : <p className="expanded-sub">No upcoming event loaded.</p>}
      </Card>

      <Card title="System vitals (live while this page is open)">
        {vitals ? (
          <>
            <Row label="CPU">{vitals.cpuPercent.toFixed(0)}%</Row>
            <Row label="RAM">{vitals.ramPercent.toFixed(0)}% of {vitals.ramTotalGb.toFixed(1)} GB</Row>
            <Row label="Disk C:">{vitals.diskFreeGb.toFixed(0)} GB free of {vitals.diskTotalGb.toFixed(0)} GB</Row>
          </>
        ) : <p className="expanded-sub">Reading…</p>}
        <Row label="Clocks">{zones.map((z) => `${z.label} ${z.time}`).join(' · ')}</Row>
        <Row label="Today">{now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</Row>
      </Card>

      <Card title="Global hotkey">
        <div className="state-grid">
          <select aria-label="Global hotkey" value={hotkey} onChange={(e) => onHotkeyChange(e.target.value)}>
            {HOTKEYS.map((h) => <option key={h} value={h}>{h.replace('CommandOrControl', 'Ctrl')}</option>)}
          </select>
          <Badge tone="action">Expands Notch from anywhere</Badge>
        </div>
      </Card>

      <Button onClick={() => window.location.assign('#/')}>Back to island</Button>
    </main>
  );
}

function ShelfTextAdd({ onAdd }: { onAdd(text: string): void }) {
  const [text, setText] = useState('');
  return (
    <div className="state-grid">
      <input aria-label="Text to park on the shelf" value={text} onChange={(e) => setText(e.target.value)} placeholder="Park a text snippet" />
      <Button onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(''); } }}>Park text</Button>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Card, Row, Toggle } from '../components/ui';
import type { SecureBridge } from '../security/secureSettings';
import { isTauri } from '../platform/window';
import { displayNative, releaseNative, shelfNative, takeoverNative, type AppInfo, type DisplayInfo, type TakeoverStatus } from '../platform/native';
import type { Appearance, Material } from '../App';
import { HUB_PAGE_NAMES, movePage, orderPages } from '../core/pages';

export interface SecurityProviderRow { id: string; description: string; enabled: boolean }

interface Props {
  providers: SecurityProviderRow[];
  bridge: SecureBridge;
  /** Back action. In the Settings popup this hides the popup; in-page
   *  it returns to the island route when omitted. */
  onBack?: () => void;
  locked: boolean;
  hotkey: string;
  onHotkeyChange(value: string): void;
  onManualLock(locked: boolean): void;
  onProviderToggle(id: string, enabled: boolean): void;
  appearance: Appearance;
  onAppearance(patch: Partial<Appearance>): void;
  lyricsEnabled: boolean;
  onLyricsToggle(enabled: boolean): void;
  showPreviews: boolean;
  onShowPreviews(enabled: boolean): void;
  hubOrder: string[];
  hubHidden: string[];
  onHubPages(hubOrder: string[], hubHidden: string[]): void;
  autostart: boolean;
  onAutostart(enabled: boolean): void;
  hideOnFullscreen: boolean;
  onHideOnFullscreen(enabled: boolean): void;
}

const INSTAGRAM_URL = 'https://www.instagram.com/iwasaki.10/';
const KOFI_URL = 'https://ko-fi.com/iwasaki10';

/** External links open in the default browser (ShellExecute via the
 *  shelf launcher in Tauri), never inside the Settings window. */
function openExternal(url: string) {
  if (isTauri) void shelfNative.launchPath(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function AboutCard() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => { void releaseNative.appInfo().then((i) => { if (i) setInfo(i); }); }, []);
  return (
    <Card title="About">
      <Row label="Version">{info?.version ?? '…'}</Row>
      <Row label="Instagram">
        <a className="about-link" href={INSTAGRAM_URL}
          onClick={(e) => { e.preventDefault(); openExternal(INSTAGRAM_URL); }}>
          @iwasaki.10
        </a>
      </Row>
      <Row label="Support">
        <a className="about-link" href={KOFI_URL}
          onClick={(e) => { e.preventDefault(); openExternal(KOFI_URL); }}>
          ko-fi.com/iwasaki10
        </a>
      </Row>
      <p className="row-label">
        Updating means running the newer Setup.exe. It upgrades in place, keeps your data,
        and restores the previous version automatically if the new one fails to start.
        Notch never checks for updates by itself and has no update server.
      </p>
      {info && (
        <details>
          <summary>Release notes</summary>
          <pre className="action-text">{info.changelog}</pre>
        </details>
      )}
      <p className="row-label">
        Iwasaki Softwares. Principal credit: IRUMVA Sosthene. Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.
        UI typeface: SF Pro when a licensed copy is installed on this PC, otherwise Inter (SIL OFL) — the closest open-source match to Apple's macOS face. OnlySans is also used when installed, but it is commercial and is not bundled. Synced lyrics by LRCLib,
        a community database; lyric text belongs to its owners. Components: Tauri and windows-rs
        (MIT / Apache-2.0), React (MIT), rusqlite with SQLite (MIT / public domain), reqwest
        (MIT / Apache-2.0). The full component list ships as sbom.json with the source.
      </p>
    </Card>
  );
}

/** Security settings as left-to-right slides (1.1.5): one card per
 *  slide, navigated with arrows, dots, title chips, arrow keys or a
 *  swipe. Every control acts on real native primitives: DPAPI-encrypted
 *  settings and Credential Manager secrets. Notch runs no server and
 *  no pairing/IPC API. In the browser preview it is inert. */
export function SecurityPanel({ providers, bridge, onBack, locked, hotkey, onHotkeyChange, onManualLock, onProviderToggle, appearance, onAppearance, lyricsEnabled, onLyricsToggle, showPreviews, onShowPreviews, hubOrder, hubHidden, onHubPages, autostart, onAutostart, hideOnFullscreen, onHideOnFullscreen }: Props) {
  const [exported, setExported] = useState<string>('');
  const [confirmErase, setConfirmErase] = useState(false);
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkey);
  const [takeover, setTakeover] = useState<TakeoverStatus | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [dataPath, setDataPath] = useState<string>('');
  const [backupPath, setBackupPath] = useState<string>('');
  const [, force] = useState(0);
  const [slide, setSlide] = useState(0);
  const swipeX = useRef<number | null>(null);

  useEffect(() => { setHotkeyDraft(hotkey); }, [hotkey]);
  useEffect(() => { void takeoverNative.get().then((s) => { if (s) setTakeover(s); }); }, []);
  useEffect(() => { void displayNative.list().then((d) => { if (d) setDisplays(d); }); }, []);
  useEffect(() => { void releaseNative.dataLocation().then((p) => { if (p) setDataPath(p); }); }, []);
  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const slides: { title: string; node: ReactNode }[] = [
    {
      title: 'Appearance',
      node: (
        <Card title="Appearance">
          <Row label="Theme">
            <span className="state-grid">
              {(['auto', 'light', 'dark'] as const).map((t) => (
                <Button key={t} variant={appearance.theme === t ? 'primary' : 'ghost'}
                  onClick={() => onAppearance({ theme: t })}>
                  {t === 'auto' ? 'Auto' : t === 'light' ? 'Light' : 'Dark'}
                </Button>
              ))}
            </span>
          </Row>
          <Row label="Material">
            <span className="state-grid">
              {([
                ['solid', 'Normal'],
                ['translucent', 'Translucent'],
                ['glass', 'Liquid Glass'],
              ] as const satisfies readonly (readonly [Material, string])[]).map(([m, label]) => (
                <Button key={m} variant={appearance.material === m ? 'primary' : 'ghost'}
                  onClick={() => onAppearance({ material: m })}>
                  {label}
                </Button>
              ))}
            </span>
          </Row>
          <p className="row-label">
            Normal is the solid black notch. Translucent lets the desktop show through with a soft
            blur. Liquid Glass adds a brighter specular edge and a deeper blur, like macOS 26.
            All three work in light and dark themes and apply to the notch itself; this Settings
            window stays opaque so its text remains easy to read.
          </p>
          <Row label="Island size">
            <span className="state-grid">
              {([[0.85, 'Small'], [1, 'Default'], [1.15, 'Large']] as const).map(([s, label]) => (
                <Button key={label} variant={appearance.islandScale === s ? 'primary' : 'ghost'}
                  onClick={() => onAppearance({ islandScale: s })}>
                  {label}
                </Button>
              ))}
            </span>
          </Row>
          <Toggle
            label="Minimal pill (plain dot instead of clock and eyes)"
            checked={appearance.minimalPill}
            onChange={(e) => onAppearance({ minimalPill: e.target.checked })}
          />
          <Row label="Display">
            <span className="state-grid">
              <Button variant={appearance.displayIndex < 0 ? 'primary' : 'ghost'}
                onClick={() => onAppearance({ displayIndex: -1 })}>
                Follow mouse
              </Button>
              {displays.map((d) => (
                <Button key={d.index} variant={appearance.displayIndex === d.index ? 'primary' : 'ghost'}
                  onClick={() => { onAppearance({ displayIndex: d.index }); void displayNative.moveTo(d.index); }}>
                  {d.name} {d.width}×{d.height}{d.primary ? ' (main)' : ''}
                </Button>
              ))}
            </span>
          </Row>
          <p className="row-label">Follow mouse puts the notch on the display your cursor is on when Notch starts. Pick a display to pin it there.</p>
          <Toggle
            label="Show text previews on the island"
            checked={showPreviews}
            onChange={(e) => onShowPreviews(e.target.checked)}
          />
          <p className="row-label">When this is off, reminder and to-do text stays hidden in alerts and on the Today page. You see "Reminder due" instead. Music titles are not affected.</p>
          <Row label="Hub pages">
            <span className="state-grid">
              {orderPages(HUB_PAGE_NAMES, hubOrder, []).map((name) => {
                const hidden = hubHidden.includes(name);
                return (
                  <span key={name} className="state-grid">
                    <Button variant={hidden ? 'ghost' : 'primary'}
                      onClick={() => onHubPages(hubOrder, hidden ? hubHidden.filter((h) => h !== name) : [...hubHidden, name])}>
                      {name}{hidden ? ' (hidden)' : ''}
                    </Button>
                    <Button aria-label={`Move ${name} up`} onClick={() => onHubPages(movePage(hubOrder, HUB_PAGE_NAMES, name, -1), hubHidden)}>Up</Button>
                    <Button aria-label={`Move ${name} down`} onClick={() => onHubPages(movePage(hubOrder, HUB_PAGE_NAMES, name, 1), hubHidden)}>Down</Button>
                  </span>
                );
              })}
            </span>
          </Row>
          <p className="row-label">Tap a page name to show or hide it, and use Up and Down to reorder. At least one page always stays visible.</p>
        </Card>
      ),
    },
    {
      title: 'Taskbar & screen cover',
      node: (
        <Card title="Taskbar and screen cover">
          <Row label="Taskbar"><Badge tone="action">System tray</Badge></Row>
          <p className="row-label">
            Notch has no taskbar button. Its icon lives in the Windows system tray — look in the
            hidden-icons area (the ^ arrow by the clock) until you drag it next to the clock.
            Click the tray icon to show or hide the notch, right-click it for Settings or Quit.
          </p>
          <Toggle
            label="Hide when an app is full screen or maximized"
            checked={hideOnFullscreen}
            onChange={(e) => onHideOnFullscreen(e.target.checked)}
          />
          <p className="row-label">
            When a game, video or presentation goes full screen on the notch's display — or any
            app is maximized there — the notch retracts and stays hidden until the app leaves
            full screen or is restored or minimized. A covering app on another display does not
            hide it.
          </p>
        </Card>
      ),
    },
    {
      title: 'Startup',
      node: (
        <Card title="Startup">
          <Toggle label="Start with Windows" checked={autostart} onChange={(e) => onAutostart(e.target.checked)} />
          <p className="row-label">Notch adds itself to your user startup entries (no admin rights). Turn this off and it only opens when you start it.</p>
        </Card>
      ),
    },
    { title: 'About', node: <AboutCard /> },
    {
      title: 'Lyrics',
      node: (
        <Card title="Lyrics">
          <Toggle label="Synced lyrics" checked={lyricsEnabled} onChange={(e) => onLyricsToggle(e.target.checked)} />
          <p className="row-label">
            Synced lyrics come from LRCLib, a community lyrics database. For each track, Notch sends only
            the title, artist, album and duration to lrclib.net. Results are cached on this PC. Lyrics text
            belongs to its owners and is shown only for the track you are playing. Turn this off and
            nothing is ever sent.
          </p>
        </Card>
      ),
    },
    {
      title: 'Global hotkey',
      node: (
        <Card title="Global hotkey">
          <p className="row-label">Toggles the expanded island from anywhere. Expanded views also auto-hide 5 seconds after your last interaction.</p>
          <div className="state-grid">
            <input aria-label="Global hotkey" value={hotkeyDraft} onChange={(e) => setHotkeyDraft(e.target.value)} />
            <Button variant="primary" onClick={() => onHotkeyChange(hotkeyDraft)}>Apply hotkey</Button>
          </div>
        </Card>
      ),
    },
    {
      title: 'Lock screen',
      node: (
        <Card title="Lock screen privacy">
          <Toggle label="Hide sensitive content now" checked={locked} onChange={(e) => onManualLock(e.target.checked)} />
          <p className="row-label">Sensitive activities (media titles, privacy indicators) are also hidden automatically when the workstation locks.</p>
        </Card>
      ),
    },
    {
      title: 'Providers',
      node: (
        <Card title="Providers (what Notch may read)">
          {providers.map((p) => (
            <div key={p.id}>
              <Toggle label={p.id} checked={p.enabled} onChange={(e) => { onProviderToggle(p.id, e.target.checked); force((n) => n + 1); }} />
              <p className="row-label">{p.description}</p>
            </div>
          ))}
        </Card>
      ),
    },
    {
      title: 'Notifications',
      node: (
        <Card title="Notification takeover">
          <Toggle
            label="Notch replaces Windows pop-up banners"
            checked={takeover?.active ?? false}
            disabled={!isTauri || takeover === null}
            onChange={(e) => {
              const next = e.target.checked;
              void takeoverNative.set(next).then((s) => { if (s) setTakeover(s); });
              if (next) onProviderToggle('windows-notifications', true);
              force((n) => n + 1);
            }}
          />
          <p className="row-label">
            Windows' own toast banners are silenced (the same switch Focus Assist uses) and the notch
            shows every notification instead. Nothing is lost: notifications still arrive and stay in
            the Windows Action Center. Turning this off — or quitting Notch — restores Windows banners.
            Keep the "windows-notifications" provider enabled while takeover is on.
            {takeover && !takeover.active && !takeover.bannersEnabled
              ? ' Note: banners are currently off in Windows itself (e.g. Focus Assist).'
              : ''}
          </p>
        </Card>
      ),
    },
    {
      title: 'Your data',
      node: (
        <Card title="Your data">
          <Row label="Saved on this PC">
            <code className="data-path">{dataPath || '…'}</code>
          </Row>
          <p className="row-label">
            Settings, to-dos, reminders, water progress and shelf paths live in this folder in your
            Windows profile. They survive restarts, sign-outs, Windows Disk Cleanup and in-place
            updates. Only "Erase all my data" below, or uninstalling with the "Delete app data"
            checkbox ticked, removes them.
          </p>
          <div className="state-grid">
            <Button onClick={() => { void releaseNative.openDataFolder(); }}>Open data folder</Button>
            <Button onClick={async () => {
              const dest = await releaseNative.dataBackup('manual').catch(() => null);
              setBackupPath(dest ?? 'Could not create a backup.');
            }}>Back up now</Button>
            <Button onClick={async () => setExported((await bridge.dataExport()) ?? 'Nothing to export')}>Export my data</Button>
            <Button variant="danger" onClick={async () => {
              if (!confirmErase) { setConfirmErase(true); return; }
              await bridge.dataErase();
              setConfirmErase(false);
              setExported('All Notch data erased (settings and stored secrets).');
            }}>{confirmErase ? 'Click again to erase everything' : 'Erase all my data'}</Button>
          </div>
          {backupPath ? <p className="row-label">Backup: {backupPath}</p> : null}
          {exported ? <textarea aria-label="Exported data" readOnly rows={8} value={exported} /> : null}
          <Row label="Telemetry"><Badge tone="action">Off</Badge></Row>
          <Row label="Network"><Badge tone="action">None — no server, no API calls</Badge></Row>
        </Card>
      ),
    },
  ];

  const last = slides.length - 1;
  const goSlide = (next: number) => setSlide(Math.max(0, Math.min(last, next)));

  // Left/right arrow keys move between slides, unless the user is
  // typing in a field (the hotkey input) or interacting with a slider.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight') goSlide(slide + 1);
      if (e.key === 'ArrowLeft') goSlide(slide - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide, last]);

  return (
    <main className="styleguide security-slides">
      <div className="sec-head">
        <h1>Security</h1>
        <span className="sec-count tnum" aria-label={`Slide ${slide + 1} of ${slides.length}`}>
          {slide + 1} / {slides.length}
        </span>
      </div>
      {!isTauri && <p className="row-label">Browser preview: native security features are inert here. Run the Windows app to test them.</p>}
      <div className="sec-tabs" role="tablist" aria-label="Security sections">
        {slides.map((s, i) => (
          <button key={s.title} type="button" role="tab" aria-selected={slide === i}
            className={`sec-tab${slide === i ? ' on' : ''}`} onClick={() => goSlide(i)}>
            {s.title}
          </button>
        ))}
      </div>
      <div
        className="sec-viewport"
        onPointerDown={(e) => { swipeX.current = e.clientX; }}
        onPointerUp={(e) => {
          if (swipeX.current === null) return;
          const dx = e.clientX - swipeX.current;
          swipeX.current = null;
          if (dx <= -48) goSlide(slide + 1);
          else if (dx >= 48) goSlide(slide - 1);
        }}
      >
        <div className="sec-track" style={{ transform: `translateX(${-slide * 100}%)` }}>
          {slides.map((s, i) => (
            <section key={s.title} className="sec-slide" aria-label={s.title} aria-hidden={slide !== i}>
              {s.node}
            </section>
          ))}
        </div>
        <button type="button" className="sec-arrow sec-arrow-prev" aria-label="Previous slide"
          disabled={slide === 0} onClick={() => goSlide(slide - 1)}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5 3 5l3.5 3.5" /></svg>
        </button>
        <button type="button" className="sec-arrow sec-arrow-next" aria-label="Next slide"
          disabled={slide === last} onClick={() => goSlide(slide + 1)}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5 7 5l-3.5 3.5" /></svg>
        </button>
      </div>
      <div className="sec-dots" role="tablist" aria-label="Security slides">
        {slides.map((s, i) => (
          <button key={s.title} type="button" role="tab" aria-selected={slide === i}
            aria-label={s.title} className={`hub-dot${slide === i ? ' on' : ''}`}
            onClick={() => goSlide(i)} />
        ))}
      </div>
      <div className="sec-foot">
        <Button onClick={() => (onBack ? onBack() : window.location.assign('#/'))}>Back to island</Button>
        <p className="row-label">Tip: use ← →, swipe, or Esc to return to the island.</p>
        <p className="row-label">Notch by IRUMVA. Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.</p>
      </div>
    </main>
  );
}

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Row, Toggle } from '../components/ui';
import type { ActivityManager } from '../core/activityManager';
import type { SecureBridge } from '../security/secureSettings';
import { isTauri } from '../platform/window';

interface Props {
  manager: ActivityManager;
  bridge: SecureBridge;
  locked: boolean;
  onManualLock(locked: boolean): void;
  onProviderToggle(id: string, enabled: boolean): void;
}

/** Security settings (Phase 3). Every control here acts on real native
 *  primitives: DPAPI settings, Credential Manager, Windows Hello,
 *  named-pipe pairing. In the browser preview it is inert by design. */
export function SecurityPanel({ manager, bridge, locked, onManualLock, onProviderToggle }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [hello, setHello] = useState<string>('Not tested');
  const [exported, setExported] = useState<string>('');
  const [confirmErase, setConfirmErase] = useState(false);
  const [, force] = useState(0);

  useEffect(() => { const t = setInterval(() => force((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  return (
    <main className="styleguide">
      <h1>Security</h1>
      {!isTauri && <p>Browser preview: native security features are inert here. Run the Windows app to test them.</p>}
      <Card title="Device pairing (Developer Hub)">
        <p className="row-label">Pair the Notch Bridge extension or another local app. The code is valid for 5 minutes, works once, and locks after 5 wrong tries. Paired apps get their own secret; every message is HMAC-signed and replay-protected.</p>
        {code ? <p aria-label="Pairing code"><strong className="pairing-code">{code}</strong></p> : null}
        <div className="state-grid">
          <Button variant="primary" onClick={async () => setCode(await bridge.pairingStart())}>Generate pairing code</Button>
          {code && <Button onClick={() => setCode(null)}>Hide code</Button>}
        </div>
      </Card>
      <Card title="Windows Hello">
        <Row label="Status">{hello}</Row>
        <div className="state-grid">
          <Button onClick={async () => {
            const r = await bridge.helloVerify('Confirm this security test in Notch by IRUMVA');
            setHello(r.ok ? 'Verified' : `Not verified (${r.status})`);
          }}>Verify with Windows Hello</Button>
        </div>
        <p className="row-label">If Hello is unavailable, high-risk approvals fall back to an explicit confirmation gesture in Phase 4. Notch never silently approves.</p>
      </Card>
      <Card title="Lock screen privacy">
        <Toggle label="Hide sensitive content now" checked={locked} onChange={(e) => onManualLock(e.target.checked)} />
        <p className="row-label">Sensitive activities (media titles, privacy indicators, paired-app activities) are also hidden automatically when the workstation locks.</p>
      </Card>
      <Card title="Providers (what Notch may read)">
        {manager.providerList().map((p) => (
          <div key={p.id}>
            <Toggle label={p.id} checked={p.enabled} onChange={(e) => { onProviderToggle(p.id, e.target.checked); force((n) => n + 1); }} />
            <p className="row-label">{p.description}</p>
          </div>
        ))}
      </Card>
      <Card title="Your data">
        <div className="state-grid">
          <Button onClick={async () => setExported((await bridge.dataExport()) ?? 'Nothing to export')}>Export my data</Button>
          <Button variant="danger" onClick={async () => {
            if (!confirmErase) { setConfirmErase(true); return; }
            await bridge.dataErase();
            setConfirmErase(false);
            setExported('All Notch data erased (settings, paired clients, stored secrets).');
          }}>{confirmErase ? 'Click again to erase everything' : 'Erase all my data'}</Button>
        </div>
        {exported ? <textarea aria-label="Exported data" readOnly rows={8} value={exported} /> : null}
        <Row label="Telemetry"><Badge tone="action">Off</Badge></Row>
      </Card>
      <Button onClick={() => window.location.assign('#/')}>Back to island</Button>
    </main>
  );
}

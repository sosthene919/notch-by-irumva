import { useEffect, useState } from 'react';
import type { ApprovalRequest } from '../core/approvals';
import { Badge, Button, Card, Row } from './ui';

interface Props {
  request: ApprovalRequest;
  error?: string;
  onDecision(id: string, decision: 'allow-once' | 'allow-session' | 'deny'): void;
  onHoldStart(id: string): void;
  onHoldEnd(): void;
}

/**
 * Approval card (brief 3C.3). Agent text is rendered as inert plain text.
 * High-risk allows are hold-to-confirm when Windows Hello is unavailable:
 * press and hold an Allow button — a plain click fails the strong gate
 * and explains why, it never silently approves.
 */
export function ApprovalCard({ request, error, onDecision, onHoldStart, onHoldEnd }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((request.expiresAt - now) / 1000));

  const allowProps = (decision: 'allow-once' | 'allow-session') =>
    request.risk === 'high'
      ? {
          onPointerDown: () => onHoldStart(request.id),
          // End the hold first so the gate records the completed-hold proof,
          // then record the decision (the gate runs asynchronously).
          onPointerUp: () => { onHoldEnd(); onDecision(request.id, decision); },
          onPointerLeave: onHoldEnd,
        }
      : { onClick: () => onDecision(request.id, decision) };

  return (
    <Card title={`Approval needed — ${request.agent}`}>
      <div role="alert" aria-live="assertive">
        <Row label="Source"><Badge tone="agent">{request.source}</Badge></Row>
        <Row label="Risk">
          <Badge tone={request.risk === 'high' ? 'danger' : request.risk === 'low' ? 'action' : 'neutral'}>
            {request.risk} risk
          </Badge>
        </Row>
        <p className="expanded-sub">Allow this exact action?</p>
        <pre className="action-text">{request.action}</pre>
        {request.target ? <Row label="Target">{request.target}</Row> : null}
        {request.cwd ? <Row label="Working directory">{request.cwd}</Row> : null}
        <Row label="Expires in">{secondsLeft}s</Row>
        {request.risk === 'high' && <p className="expanded-sub">High risk: press and hold Allow for 1.2 seconds (or confirm with Windows Hello if prompted).</p>}
        {error ? <p className="expanded-sub" role="alert">{error}</p> : null}
        <div className="state-grid">
          <Button variant="primary" {...allowProps('allow-once')}>Allow once</Button>
          <Button {...allowProps('allow-session')}>Allow for this session</Button>
          <Button variant="danger" onClick={() => onDecision(request.id, 'deny')}>Deny</Button>
        </div>
      </div>
    </Card>
  );
}

import { useState } from 'react';
import { Badge, Button, Card, Row } from '../components/ui';
import { ApprovalCard } from '../components/ApprovalCard';
import { ReviewCard } from '../components/ReviewCard';
import type { ApprovalManager, ApprovalDecision } from '../core/approvals';
import type { ReviewManager, ReviewDecision } from '../core/reviews';
import type { AgentTask } from '../devhub/tasks';

interface Props {
  approvals: ApprovalManager;
  reviews: ReviewManager;
  tasks: AgentTask[];
  serverStatus: string;
  recentWorkspaces: string[];
  onStartTask(input: { prompt: string; workspace: string; agent: string; model?: { providerID: string; id: string } }): void;
  onStartServer(workspace: string): void;
  onAbortTask(id: string): void;
  onRerunTask(id: string): void;
  onApprovalDecision(id: string, decision: ApprovalDecision): Promise<string | undefined>;
  onReviewDecision(id: string, decision: ReviewDecision, comment: string): void;
  onHoldStart(id: string): void;
  onHoldEnd(): void;
}

/** Developer Hub (brief 3C). Approvals are explicit, text is inert, and
 *  the workspace is echoed back before any task starts. */
export function DevHub(props: Props) {
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState(props.recentWorkspaces[0] ?? '');
  const [agent, setAgent] = useState('build');
  const [providerID, setProviderID] = useState('');
  const [modelID, setModelID] = useState('');
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  const decide = async (id: string, decision: ApprovalDecision) => {
    const error = await props.onApprovalDecision(id, decision);
    setApprovalErrors((prev) => ({ ...prev, [id]: error ?? '' }));
    setTick((n) => n + 1);
  };

  return (
    <main className="styleguide">
      <h1>Developer Hub</h1>
      <Card title="Quick Task (OpenCode)">
        <Row label="Server">{props.serverStatus}</Row>
        <div className="state-grid">
          <Button onClick={() => props.onStartServer(workspace || '.')}>Start OpenCode server</Button>
        </div>
        <label>
          <span className="row-label">Prompt</span>
          <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the task. Nothing runs until you press Start task." />
        </label>
        <label>
          <span className="row-label">Workspace (echoed before anything runs)</span>
          <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="C:\path\to\project" list="recent-workspaces" />
          <datalist id="recent-workspaces">
            {props.recentWorkspaces.map((w) => <option key={w} value={w} />)}
          </datalist>
        </label>
        <div className="state-grid">
          <label><span className="row-label">Agent</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent">
              <option value="build">build</option>
              <option value="plan">plan</option>
            </select>
          </label>
          <label><span className="row-label">Provider (optional)</span>
            <input value={providerID} onChange={(e) => setProviderID(e.target.value)} placeholder="providerID" />
          </label>
          <label><span className="row-label">Model (optional)</span>
            <input value={modelID} onChange={(e) => setModelID(e.target.value)} placeholder="modelID" />
          </label>
        </div>
        <p className="expanded-sub">Workspace: {workspace || '(not set)'} · Agent: {agent} · Model: {providerID && modelID ? `${providerID}/${modelID}` : 'server default'}</p>
        <div className="state-grid">
          <Button variant="primary" disabled={!prompt.trim() || !workspace.trim()} onClick={() => {
            props.onStartTask({
              prompt: prompt.trim(), workspace: workspace.trim(), agent,
              model: providerID.trim() && modelID.trim() ? { providerID: providerID.trim(), id: modelID.trim() } : undefined,
            });
            setTick((n) => n + 1);
          }}>Start task</Button>
        </div>
      </Card>

      {props.approvals.pending().map((req) => (
        <ApprovalCard key={req.id} request={req} error={approvalErrors[req.id] || undefined}
          onDecision={(id, d) => { void decide(id, d); }}
          onHoldStart={props.onHoldStart} onHoldEnd={props.onHoldEnd} />
      ))}

      {props.reviews.pending().map((review) => (
        <ReviewCard key={review.id} review={review}
          onDecision={(id, d, comment) => { props.onReviewDecision(id, d, comment); setTick((n) => n + 1); }} />
      ))}

      <Card title="Tasks">
        {props.tasks.length === 0 && <p className="expanded-sub">No tasks yet.</p>}
        {props.tasks.map((t) => (
          <div key={t.id}>
            <Row label={t.prompt.slice(0, 60)}>
              <Badge tone={t.status === 'needs-approval' ? 'agent' : t.status === 'failed' ? 'danger' : 'neutral'}>{t.status}</Badge>
            </Row>
            <p className="expanded-sub">{t.agent} · {t.modelLabel} · {t.workspace}{t.detail ? ` · ${t.detail}` : ''}</p>
            <div className="state-grid">
              {(t.status === 'running' || t.status === 'needs-approval' || t.status === 'queued') &&
                <Button onClick={() => { props.onAbortTask(t.id); setTick((n) => n + 1); }}>Abort</Button>}
              <Button onClick={() => { props.onRerunTask(t.id); setTick((n) => n + 1); }}>Re-run</Button>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Approval audit log">
        {props.approvals.auditLog().length === 0 && <p className="expanded-sub">No decisions yet.</p>}
        {[...props.approvals.auditLog()].reverse().slice(0, 20).map((e, i) => (
          <Row key={i} label={`${new Date(e.at).toLocaleTimeString()} · ${e.source} · ${e.risk}`}>
            {e.decision} · {e.actionHash.slice(0, 12)}…
          </Row>
        ))}
      </Card>
      <Button onClick={() => window.location.assign('#/')}>Back to island</Button>
    </main>
  );
}

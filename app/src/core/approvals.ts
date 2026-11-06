/**
 * Approval cards core (brief section 3C.3). Rules enforced here, not in UI:
 * - An approval is bound to requestId + SHA-256 hash of the exact action.
 * - Single-use and expiring: respond() consumes the request.
 * - "Allow for this session" memorizes the action hash for this app
 *   session only. There is no persistent always-allow.
 * - High-risk actions require a strong gate (Windows Hello when
 *   available, otherwise an explicit confirmation gesture).
 * - Deny decisions from the source are never overridden (no API here can
 *   turn a deny into an allow; expired/unknown requests fail closed).
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny';
export type ApprovalStatus = 'pending' | 'allowed-once' | 'allowed-session' | 'denied' | 'expired' | 'auto-allowed-session';

export interface ApprovalRequest {
  id: string;
  source: 'opencode' | 'bridge' | 'antigravity';
  agent: string;
  /** Exact action text, rendered inert. Never executed by Notch itself. */
  action: string;
  target?: string;
  cwd?: string;
  risk: RiskLevel;
  actionHash: string;
  createdAt: number;
  expiresAt: number;
  status: ApprovalStatus;
}

export interface AuditEntry {
  at: number;
  requestId: string;
  source: string;
  agent: string;
  actionHash: string;
  risk: RiskLevel;
  decision: ApprovalDecision | 'auto-allowed-session' | 'expired';
}

const SHELL_ALLOWLIST = ['npm test', 'npm run build', 'npm run test', 'cargo test', 'cargo check', 'git status', 'git diff', 'git log', 'tsc --noemit'];

export function classifyRisk(input: { action: string; target?: string; cwd?: string; workspace?: string }): RiskLevel {
  const a = input.action.toLowerCase();
  const destructive = /\b(rm|del|rmdir|remove-item|format|mkfs|dd|drop table|truncate)\b/.test(a);
  const network = /\b(curl|wget|invoke-webrequest|invoke-restmethod|ssh|scp|ftp|nc|netcat)\b|https?:\/\//.test(a);
  const credentials = /(credential|secret|token|password|\.ssh|id_rsa|credential manager|vault)/.test(a);
  if (destructive || network || credentials) return 'high';
  if (input.workspace && input.target) {
    const t = input.target.replace(/\\/g, '/').toLowerCase();
    const w = input.workspace.replace(/\\/g, '/').toLowerCase();
    if (!t.startsWith(w)) return 'high'; // write outside the workspace
  }
  if (SHELL_ALLOWLIST.some((cmd) => a.startsWith(cmd))) return 'low';
  if (/^(npm|pnpm|yarn|cargo|git|node|python|tsc|dotnet)\b/.test(a)) return 'medium';
  if (/\b(write|edit|create|move|rename|install|publish|push|commit)\b/.test(a)) return 'medium';
  return 'medium';
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Canonical action string that the hash binds to. Keys are inserted in
 * sorted order so this matches the Rust server's canonical JSON
 * (security.rs `canonical`) byte-for-byte for typical inputs.
 */
export function actionCanonical(r: { agent: string; action: string; target?: string; cwd?: string }): string {
  return JSON.stringify({ action: r.action, agent: r.agent, cwd: r.cwd ?? '', target: r.target ?? '' });
}

export interface StrongGate {
  /** Returns true when the user proved presence (Hello or gesture). */
  verify(request: ApprovalRequest): Promise<boolean>;
}

export class ApprovalManager {
  private requests = new Map<string, ApprovalRequest>();
  private sessionAllow = new Set<string>();
  private audit: AuditEntry[] = [];
  onChange: (() => void) | null = null;

  constructor(private gate: StrongGate) {}

  async create(input: {
    id: string; source: ApprovalRequest['source']; agent: string; action: string;
    target?: string; cwd?: string; workspace?: string; timeoutMs?: number; now?: number;
  }): Promise<ApprovalRequest> {
    const now = input.now ?? Date.now();
    const actionHash = await sha256Hex(actionCanonical(input));
    const req: ApprovalRequest = {
      id: input.id, source: input.source, agent: input.agent, action: input.action,
      target: input.target, cwd: input.cwd,
      risk: classifyRisk(input), actionHash,
      createdAt: now, expiresAt: now + (input.timeoutMs ?? 120_000),
      status: 'pending',
    };
    if (this.sessionAllow.has(actionHash)) {
      req.status = 'auto-allowed-session';
      this.log(req, 'auto-allowed-session', now);
    }
    this.requests.set(req.id, req);
    this.onChange?.();
    return req;
  }

  get(id: string): ApprovalRequest | undefined { return this.requests.get(id); }
  pending(now = Date.now()): ApprovalRequest[] {
    this.expire(now);
    return [...this.requests.values()].filter((r) => r.status === 'pending');
  }
  all(): ApprovalRequest[] { return [...this.requests.values()]; }
  auditLog(): readonly AuditEntry[] { return this.audit; }

  expire(now = Date.now()): void {
    for (const r of this.requests.values()) {
      if (r.status === 'pending' && r.expiresAt <= now) {
        r.status = 'expired';
        this.log(r, 'expired', now);
        this.onChange?.();
      }
    }
  }

  /**
   * The only way to answer a request. Fails closed on: unknown id, hash
   * mismatch, already answered, expired. High risk requires the strong
   * gate to pass *before* the decision is recorded.
   */
  async respond(id: string, actionHash: string, decision: ApprovalDecision, now = Date.now()): Promise<{ ok: boolean; error?: string }> {
    const req = this.requests.get(id);
    if (!req) return { ok: false, error: 'unknown-request' };
    if (req.status !== 'pending') return { ok: false, error: 'already-answered' };
    if (req.expiresAt <= now) { req.status = 'expired'; this.log(req, 'expired', now); this.onChange?.(); return { ok: false, error: 'expired' }; }
    if (req.actionHash !== actionHash) return { ok: false, error: 'hash-mismatch' };
    if (decision !== 'deny' && req.risk === 'high') {
      const proved = await this.gate.verify(req);
      if (!proved) return { ok: false, error: 'strong-gate-failed' };
    }
    req.status = decision === 'deny' ? 'denied' : decision === 'allow-once' ? 'allowed-once' : 'allowed-session';
    if (decision === 'allow-session') this.sessionAllow.add(req.actionHash);
    this.log(req, decision, now);
    this.onChange?.();
    return { ok: true };
  }

  /** Session allowances never survive the app session (no persistence here by design). */
  clearSessionAllowances(): void { this.sessionAllow.clear(); }

  private log(req: ApprovalRequest, decision: AuditEntry['decision'], at: number): void {
    this.audit.push({ at, requestId: req.id, source: req.source, agent: req.agent, actionHash: req.actionHash, risk: req.risk, decision });
    if (this.audit.length > 200) this.audit.splice(0, this.audit.length - 200);
  }
}

export const holdToConfirmGate = (holdMs = 1200): StrongGate & { beginHold(id: string): void; endHold(): void } => {
  let active: { id: string; startedAt: number } | null = null;
  let completed: { id: string; duration: number; at: number } | null = null;
  return {
    beginHold(id) { active = { id, startedAt: Date.now() }; },
    /** Ends the current hold; a long-enough hold becomes a one-use proof. */
    endHold() {
      if (!active) return;
      const duration = Date.now() - active.startedAt;
      if (duration >= holdMs) completed = { id: active.id, duration, at: Date.now() };
      active = null;
    },
    async verify(req) {
      // Proof may come from the just-finished hold (pointer-up ends the
      // hold before the async decision reaches this gate) or a live one.
      if (completed && completed.id === req.id && Date.now() - completed.at <= 5000) {
        completed = null;
        return true;
      }
      if (active && active.id === req.id && Date.now() - active.startedAt >= holdMs) {
        active = null;
        return true;
      }
      return false;
    },
  };
};

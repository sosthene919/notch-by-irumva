/**
 * Code-review cards (brief section 3C.4). A paired agent proposes changes;
 * the user approves, requests changes (with a comment sent back), opens
 * the diff in the IDE, or rejects. All agent text is inert plain text.
 */
export interface ReviewFile { path: string; additions: number; deletions: number }
export interface CodeReview {
  id: string;
  source: 'opencode' | 'bridge' | 'antigravity';
  title: string;
  files: ReviewFile[];
  summary: string;
  testsStatus: 'passed' | 'failed' | 'not-run' | 'running';
  status: 'pending' | 'approved' | 'changes-requested' | 'rejected' | 'open-diff';
}
export type ReviewDecision = 'approve' | 'request-changes' | 'reject' | 'open-diff';

export function validateReview(raw: unknown): CodeReview | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(r.id) ? r.id : null;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 120) : '';
  if (!id || !title || !Array.isArray(r.files) || r.files.length === 0 || r.files.length > 50) return null;
  const files: ReviewFile[] = [];
  for (const f of r.files) {
    if (typeof f !== 'object' || f === null) return null;
    const file = f as Record<string, unknown>;
    if (typeof file.path !== 'string' || file.path.length > 260) return null;
    files.push({
      path: file.path,
      additions: Math.max(0, Math.min(100000, Number(file.additions) || 0)),
      deletions: Math.max(0, Math.min(100000, Number(file.deletions) || 0)),
    });
  }
  const tests = ['passed', 'failed', 'not-run', 'running'].includes(String(r.testsStatus)) ? (r.testsStatus as CodeReview['testsStatus']) : 'not-run';
  const source = ['opencode', 'bridge', 'antigravity'].includes(String(r.source)) ? (r.source as CodeReview['source']) : 'bridge';
  return {
    id, source, title, files,
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 500) : '',
    testsStatus: tests, status: 'pending',
  };
}

export class ReviewManager {
  private reviews = new Map<string, CodeReview>();
  onChange: (() => void) | null = null;

  propose(review: CodeReview): void { this.reviews.set(review.id, review); this.onChange?.(); }
  get(id: string): CodeReview | undefined { return this.reviews.get(id); }
  pending(): CodeReview[] { return [...this.reviews.values()].filter((r) => r.status === 'pending'); }
  decide(id: string, decision: ReviewDecision): { ok: boolean; error?: string } {
    const r = this.reviews.get(id);
    if (!r) return { ok: false, error: 'unknown-review' };
    if (r.status !== 'pending') return { ok: false, error: 'already-decided' };
    r.status = decision === 'approve' ? 'approved' : decision === 'request-changes' ? 'changes-requested' : decision === 'reject' ? 'rejected' : 'open-diff';
    this.onChange?.();
    return { ok: true };
  }
}

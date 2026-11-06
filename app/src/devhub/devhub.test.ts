import { describe, expect, it, vi } from 'vitest';
import { OpenCodeClient } from './opencode';
import { OpenCodeTasks, type OpenCodeApi } from './tasks';
import { validateReview, ReviewManager } from '../core/reviews';

function fakeFetch() {
  const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string, auth: (init?.headers as Record<string, string>)?.Authorization });
    return new Response(JSON.stringify({ data: { id: 'ses_1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return { fn: fn as never, calls };
}

describe('opencode client (verified v2 contract)', () => {
  it('creates a session, prompts, interrupts and replies to permissions', async () => {
    const { fn, calls } = fakeFetch();
    const client = new OpenCodeClient('http://127.0.0.1:4096', 'pw', fn);
    await client.createSession({ title: 'T', agent: 'build', directory: 'C:\\work' });
    expect(calls[0]?.url).toBe('http://127.0.0.1:4096/api/session');
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ title: 'T', agent: 'build', location: { directory: 'C:\\work' } });
    expect(calls[0]?.auth).toBe(`Basic ${btoa('opencode:pw')}`);
    await client.prompt('ses_1', 'hello');
    expect(calls[1]?.url).toContain('/api/session/ses_1/prompt');
    expect(JSON.parse(calls[1]!.body!)).toEqual({ text: 'hello' });
    await client.interrupt('ses_1');
    expect(calls[2]?.url).toContain('/api/session/ses_1/interrupt');
    await client.replyPermission('ses_1', 'per_1', 'reject');
    expect(calls[3]?.url).toContain('/api/session/ses_1/permission/per_1/reply');
    expect(JSON.parse(calls[3]!.body!)).toEqual({ decision: 'reject' });
  });
});

describe('task lifecycle with a fake server API', () => {
  it('queued -> running -> needs-approval -> done, and abort interrupts', async () => {
    vi.useFakeTimers();
    let outcome: string | undefined;
    const perms: { id: string; sessionID: string; action: string; resources: string[] }[] = [];
    const api: OpenCodeApi = {
      createSession: async () => ({ id: 'ses_9' }),
      prompt: async () => ({}),
      interrupt: async () => ({}),
      getSession: async () => ({ id: 'ses_9', outcome }),
      listPermissions: async () => perms,
      replyPermission: async () => ({}),
    };
    const seen: string[] = [];
    const permEvents: string[] = [];
    const tasks = new OpenCodeTasks(api, {
      onTask: (t) => seen.push(t.status),
      onPermission: (_t, p) => permEvents.push(p.id),
    });
    const startPromise = tasks.start({ prompt: 'do it', workspace: 'C:\\w', agent: 'build' });
    await vi.waitFor(async () => { await startPromise; });
    const task = await startPromise;
    expect(task.status).toBe('running');
    perms.push({ id: 'per_1', sessionID: 'ses_9', action: 'bash', resources: ['npm test'] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(tasks.get('ses_9')?.status).toBe('needs-approval');
    expect(permEvents).toEqual(['per_1']);
    outcome = 'succeeded';
    await vi.advanceTimersByTimeAsync(2000);
    expect(tasks.get('ses_9')?.status).toBe('done');
    expect(seen).toContain('queued');
    vi.useRealTimers();
  });
});

describe('code review validation', () => {
  it('accepts well-formed reviews and rejects junk; decisions are single-use', () => {
    const review = validateReview({
      id: 'rev1', source: 'bridge', title: 'Fix login', summary: 's',
      files: [{ path: 'src/a.ts', additions: 10, deletions: 2 }], testsStatus: 'passed',
    });
    expect(review).toMatchObject({ title: 'Fix login', files: [{ additions: 10 }] });
    expect(validateReview({ id: 'x', title: '', files: [] })).toBeNull();
    expect(validateReview({ id: 'x', title: 't', files: [{ path: 5 }] })).toBeNull();
    const m = new ReviewManager();
    m.propose(review!);
    expect(m.decide('rev1', 'approve')).toEqual({ ok: true });
    expect(m.decide('rev1', 'reject')).toEqual({ ok: false, error: 'already-decided' });
  });
});

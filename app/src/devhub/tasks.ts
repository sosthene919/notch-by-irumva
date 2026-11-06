import type { Activity } from '../core/types';
import type { OpenCodePermission } from './opencode';

export type TaskStatus = 'queued' | 'running' | 'needs-approval' | 'done' | 'failed' | 'interrupted';

export interface AgentTask {
  id: string; // session id (or a pre-session local id while queued)
  prompt: string;
  workspace: string;
  agent: string;
  modelLabel: string;
  status: TaskStatus;
  createdAt: number;
  detail?: string;
}

export interface OpenCodeApi {
  createSession(input: { title?: string; agent?: string; model?: { providerID: string; id: string }; directory?: string }): Promise<{ id: string }>;
  prompt(sessionId: string, text: string): Promise<unknown>;
  interrupt(sessionId: string): Promise<unknown>;
  getSession(sessionId: string): Promise<{ id: string; outcome?: string }>;
  listPermissions(): Promise<OpenCodePermission[]>;
  replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject', message?: string): Promise<unknown>;
}

export interface TaskEvents {
  onTask(task: AgentTask): void;
  onPermission(task: AgentTask, permission: OpenCodePermission): void;
}

/**
 * Quick Task lifecycle: queued -> running -> (needs-approval) -> done /
 * failed / interrupted. Session completion is read from the verified
 * GET /api/session/{id} `outcome` field, polled every 2s only while a
 * task is running. Permission requests come from the verified
 * GET /api/permission/request list, polled while tasks run (the SSE
 * event schema for permissions is not in the server OpenAPI document).
 */
export class OpenCodeTasks {
  private tasks = new Map<string, AgentTask>();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private seenPermissions = new Set<string>();

  constructor(private api: OpenCodeApi, private events: TaskEvents) {}

  list(): AgentTask[] { return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt); }
  get(id: string): AgentTask | undefined { return this.tasks.get(id); }

  async start(input: { prompt: string; workspace: string; agent: string; model?: { providerID: string; id: string } }): Promise<AgentTask> {
    const localId = `task-${Date.now()}`;
    const task: AgentTask = {
      id: localId, prompt: input.prompt, workspace: input.workspace,
      agent: input.agent, modelLabel: input.model ? `${input.model.providerID}/${input.model.id}` : 'server default',
      status: 'queued', createdAt: Date.now(),
    };
    this.tasks.set(localId, task);
    this.events.onTask(task);
    try {
      const session = await this.api.createSession({
        title: input.prompt.slice(0, 60), agent: input.agent, model: input.model, directory: input.workspace,
      });
      this.tasks.delete(localId);
      task.id = session.id;
      task.status = 'running';
      this.tasks.set(task.id, task);
      this.events.onTask(task);
      await this.api.prompt(session.id, input.prompt);
      this.watch(task);
    } catch (e) {
      task.status = 'failed';
      task.detail = e instanceof Error ? e.message : 'failed to start';
      this.events.onTask(task);
    }
    return task;
  }

  private watch(task: AgentTask): void {
    const timer = setInterval(() => { void this.poll(task); }, 2000);
    this.timers.set(task.id, timer);
  }

  private async poll(task: AgentTask): Promise<void> {
    try {
      const perms = await this.api.listPermissions();
      for (const p of perms) {
        if (p.sessionID !== task.id || this.seenPermissions.has(p.id)) continue;
        this.seenPermissions.add(p.id);
        if (task.status === 'running') { task.status = 'needs-approval'; this.events.onTask(task); }
        this.events.onPermission(task, p);
      }
      const session = await this.api.getSession(task.id);
      if (session.outcome === 'succeeded' || session.outcome === 'failed') {
        task.status = session.outcome === 'succeeded' ? 'done' : 'failed';
        this.finish(task);
      }
    } catch { /* transient server errors: keep watching */ }
  }

  private finish(task: AgentTask): void {
    const t = this.timers.get(task.id);
    if (t) clearInterval(t);
    this.timers.delete(task.id);
    this.events.onTask(task);
  }

  async abort(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.status === 'done' || task.status === 'failed') return;
    await this.api.interrupt(id).catch(() => {});
    task.status = 'interrupted';
    this.finish(task);
  }

  async rerun(id: string): Promise<AgentTask | undefined> {
    const old = this.tasks.get(id);
    if (!old) return undefined;
    return this.start({ prompt: old.prompt, workspace: old.workspace, agent: old.agent });
  }

  /** Called after an approval decision so the task leaves needs-approval. */
  permissionResolved(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status === 'needs-approval') {
      task.status = 'running';
      this.events.onTask(task);
    }
  }
}

export function taskToActivity(task: AgentTask): Activity {
  return {
    id: `agent-task-${task.id}`,
    providerId: 'opencode',
    kind: 'agent-task',
    title: task.prompt.length > 60 ? `${task.prompt.slice(0, 60)}…` : task.prompt,
    subtitle: `${task.agent} · ${task.status}${task.workspace ? ` · ${task.workspace}` : ''}`,
    priority: task.status === 'needs-approval' ? 85 : 65,
    startedAt: task.createdAt,
    sensitive: true,
    data: { status: task.status, sessionId: task.id, workspace: task.workspace },
  };
}

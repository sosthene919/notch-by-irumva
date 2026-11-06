/**
 * OpenCode server client. Contract verified 2026-11-05 against the
 * locally installed OpenCode v2.2.5 server's own OpenAPI document
 * (GET /openapi.json from the running server), not from web docs:
 * - POST /api/session {title?, agent?, model?, location:{directory}}
 * - POST /api/session/{id}/prompt {text}
 * - POST /api/session/{id}/interrupt            (abort equivalent)
 * - GET  /api/session/{id}                      (outcome when finished)
 * - GET  /api/permission/request                (pending permissions)
 * - POST /api/session/{id}/permission/{requestId}/reply {decision}
 * - GET  /api/event                             (SSE, {id,type,data})
 * - GET  /api/info                              (health; 401 = up, needs auth)
 * Auth: HTTP Basic, user "opencode", password from
 * OPENCODE_SERVER_PASSWORD (held in Credential Manager).
 * Responses are wrapped: { data: ... }.
 */

export interface OpenCodeSession { id: string; title?: string; outcome?: string; agent?: string }
export interface OpenCodePermission {
  id: string; sessionID: string; action: string; resources: string[]; message?: string;
}

type FetchFn = typeof fetch;

export class OpenCodeClient {
  constructor(
    private baseUrl = 'http://127.0.0.1:4096',
    private password: string | null = null,
    // Wrapped: a bare `fetch` reference loses its Window binding in browsers.
    private fetchFn: FetchFn = ((...args: Parameters<FetchFn>) => fetch(...args)) as FetchFn,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
    if (this.password) h.Authorization = `Basic ${btoa(`opencode:${this.password}`)}`;
    return h;
  }

  /** 'running' | 'auth-required' | 'down' */
  async health(): Promise<'running' | 'auth-required' | 'down'> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/info`, { headers: this.headers() });
      if (res.ok) return 'running';
      if (res.status === 401) return 'auth-required';
      return 'down';
    } catch { return 'down'; }
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, headers: this.headers(init?.headers as Record<string, string>) });
    if (!res.ok) throw new Error(`opencode ${path} -> ${res.status}`);
    if (res.status === 204) return undefined as T;
    const body = (await res.json()) as { data: T };
    return body.data;
  }

  createSession(input: { title?: string; agent?: string; model?: { providerID: string; id: string }; directory?: string }): Promise<OpenCodeSession> {
    return this.json('/api/session', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        agent: input.agent,
        model: input.model,
        location: input.directory ? { directory: input.directory } : undefined,
      }),
    });
  }

  prompt(sessionId: string, text: string): Promise<unknown> {
    return this.json(`/api/session/${sessionId}/prompt`, { method: 'POST', body: JSON.stringify({ text }) });
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.json(`/api/session/${sessionId}/interrupt`, { method: 'POST', body: '{}' });
  }

  getSession(sessionId: string): Promise<OpenCodeSession> {
    return this.json(`/api/session/${sessionId}`);
  }

  listPermissions(): Promise<OpenCodePermission[]> {
    return this.json('/api/permission/request');
  }

  /**
   * Notch deliberately cannot send OpenCode's "always" decision: brief
   * section 3C forbids a persistent always-allow. "Allow for this
   * session" is implemented inside Notch by auto-answering repeats with
   * "once" during this app session only.
   */
  replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject', message?: string): Promise<unknown> {
    return this.json(`/api/session/${sessionId}/permission/${requestId}/reply`, {
      method: 'POST', body: JSON.stringify({ decision, message }),
    });
  }

  /** SSE stream of {id, type, data}. Returns an unsubscribe function. */
  subscribeEvents(onEvent: (type: string, data: Record<string, unknown>) => void): () => void {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await this.fetchFn(`${this.baseUrl}/api/event`, {
          headers: this.headers({ Accept: 'text/event-stream' }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            try {
              const parsed = JSON.parse(line.slice(5).trim()) as { type: string; data: Record<string, unknown> };
              onEvent(parsed.type, parsed.data ?? {});
            } catch { /* ignore malformed events */ }
          }
        }
      } catch { /* aborted or server down */ }
    })();
    return () => controller.abort();
  }
}

import type { ActivityProvider } from '../core/activityManager';
import type { Activity } from '../core/types';
import { isTauri } from '../platform/window';

export interface IpcActivityPayload { id: string; kind: string; title: string; subtitle?: string; priority: number }

/** Defense in depth: the Rust pipe server already validates, but the UI
 *  treats every IPC payload as untrusted input and re-validates it. */
export function validateIpcPayload(raw: unknown): Activity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  const title = typeof p.title === 'string' ? p.title.trim() : '';
  const kind = typeof p.kind === 'string' ? p.kind : '';
  if (!title || title.length > 120) return null;
  if (!kind || kind.length > 40 || !/^[A-Za-z0-9_-]+$/.test(kind)) return null;
  const subtitle = typeof p.subtitle === 'string' ? p.subtitle.slice(0, 200) : undefined;
  const priority = typeof p.priority === 'number' ? Math.min(100, Math.max(0, p.priority)) : 50;
  const id = typeof p.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(p.id) ? p.id : `ipc-${Date.now()}`;
  return { id, providerId: 'ipc', kind, title, subtitle, priority, startedAt: Date.now(), sensitive: true };
}

/**
 * Activities published by paired local clients over the authenticated
 * named pipe (Rust validates pairing + HMAC + replay server-side).
 */
export function createIpcProvider() {
  let unlisten: (() => void) | null = null;
  const provider: ActivityProvider = {
    id: 'ipc',
    description: 'Live activities from paired apps on this PC (for example the Notch Bridge extension) over an authenticated local pipe.',
    async start(publish) {
      if (!isTauri) return;
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<IpcActivityPayload>('notch://ipc-activity', (event) => {
          const activity = validateIpcPayload(event.payload);
          if (activity) publish(activity);
        });
      } catch { /* pipe events unavailable; provider stays silent */ }
    },
    stop() { unlisten?.(); unlisten = null; },
  };
  return provider;
}

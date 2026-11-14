import type { ActivityProvider } from '../core/activityManager';
import type { Activity } from '../core/types';
import { onWindowsNotification, type WindowsNotification } from '../platform/native';

export interface WindowsNotificationSource {
  subscribe(cb: (n: WindowsNotification) => void): Promise<() => void> | (() => void);
}

export const nativeWindowsNotificationSource: WindowsNotificationSource = {
  subscribe: (cb) => onWindowsNotification(cb),
};

const clamp = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Defense in depth: Rust already extracts plain text, but the UI treats
 *  every mirrored notification as untrusted input and re-validates it.
 *  Returns null for anything unusable (empty/oversized). */
export function notificationToActivity(n: WindowsNotification, now = Date.now()): Activity | null {
  const title = clamp((n.title ?? '').trim(), 120);
  if (!title) return null;
  const app = clamp((n.app ?? '').trim(), 60) || 'App';
  const body = clamp((n.body ?? '').trim(), 200);
  return {
    id: `win-notif-${n.id}`,
    providerId: 'windows-notifications',
    kind: 'app-notification',
    title,
    subtitle: body ? `${app} · ${body}` : app,
    priority: 80,
    startedAt: now,
    expiresAt: now + 30_000,
    sensitive: true, // message content: redacted on the lock screen
    data: { app },
  };
}

/**
 * Mirrors Windows app notifications (WhatsApp, Chrome, Mail, …) via the
 * Rust watcher's `notch://windows-notification` events. Read from the
 * local notification-center database — nothing leaves this PC.
 */
export function createWindowsNotificationsProvider(source: WindowsNotificationSource = nativeWindowsNotificationSource) {
  let unlisten: (() => void) | null = null;
  const provider: ActivityProvider = {
    id: 'windows-notifications',
    description: 'Mirrors Windows app notifications (WhatsApp, Chrome, Mail and others) from the notification center on this PC. Shown briefly in the notch; hidden on the lock screen.',
    async start(publish) {
      try {
        unlisten = await source.subscribe((n) => {
          const activity = notificationToActivity(n);
          if (activity) publish(activity);
        });
      } catch { /* watcher unavailable; provider stays silent */ }
    },
    stop() { unlisten?.(); unlisten = null; },
  };
  return provider;
}

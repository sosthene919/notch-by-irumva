import type { ActivityProvider } from '../core/activityManager';
import type { Activity } from '../core/types';

/**
 * Notification alerts (in-app events only — Notch mirrors no Windows
 * toasts and makes no network calls). When an alert-worthy activity first
 * appears (timer finished, low/full battery, microphone/camera/location
 * switched on), App pops the island open as a banner via the NOTIFY state
 * event; the island's 5 s idle auto-hide collapses it again.
 *
 * This module is the alert policy + edge detector. The provider doubles as
 * the settings toggle (alerts can be switched off in Security settings
 * like any other provider) and as the source of manual test alerts.
 */

const ALERT_KINDS = new Set(['timer-done', 'battery-low', 'battery-full', 'todo-reminder', 'water-reminder']);

export function isAlertActivity(a: Activity): boolean {
  return ALERT_KINDS.has(a.kind)
    || a.providerId === 'privacy'
    || a.providerId === 'notifications'
    || a.providerId === 'windows-notifications';
}

/** Identity for edge detection: privacy activities are re-published with a
 *  fresh startedAt on every refresh, so (id, kind) presence is the signal. */
const keyOf = (a: Activity) => `${a.id}:${a.kind}`;

export class AlertDetector {
  private seen = new Set<string>();
  private primed = false;

  /** Returns the alert activities that newly appeared since the last call.
   *  The first call only primes the detector, so whatever is already on
   *  screen at launch does not pop a banner. */
  next(ordered: Activity[]): Activity[] {
    const current = new Map(ordered.map((a) => [keyOf(a), a]));
    if (!this.primed) {
      this.primed = true;
      this.seen = new Set(current.keys());
      return [];
    }
    const fresh = ordered.filter((a) => isAlertActivity(a) && !this.seen.has(keyOf(a)));
    this.seen = new Set(current.keys());
    return fresh;
  }
}

export type NotificationsProvider = ActivityProvider & {
  /** Publishes a one-off test alert so the user can see the banner and the
   *  expanded pill design. Unique id per call, so every click re-pops. */
  fireTest(now?: number): void;
};

export function createNotificationsProvider(): NotificationsProvider {
  let publishFn: ((a: Activity) => void) | null = null;
  return {
    id: 'notifications',
    description: 'Pops the island open briefly for Notch alerts: timer finished, low or full battery, microphone/camera/location in use. Alerts are generated on this PC only.',
    start(publish) { publishFn = publish; },
    stop() { publishFn = null; },
    fireTest(now = Date.now()) {
      publishFn?.({
        id: `test-notification-${now}`, providerId: 'notifications', kind: 'test-notification',
        title: 'Test notification', subtitle: 'If you can read this inside the pill, banner layout works.',
        priority: 95, startedAt: now, expiresAt: now + 30_000,
      });
    },
  };
}

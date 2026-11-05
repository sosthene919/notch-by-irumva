import type { ActivityProvider } from '../core/activityManager';

/**
 * Windows toast mirroring via UserNotificationListener is BLOCKED for this
 * build: Microsoft Learn requires the userNotificationListener capability
 * in a Package.appxmanifest (package identity). The NSIS build is
 * unpackaged, so RequestAccessAsync cannot succeed. See ASSUMPTIONS A7.
 * This provider therefore stays disabled and publishes nothing — no fake
 * notification data is ever shown. Re-evaluate with MSIX packaging (Phase 6).
 */
export const notificationsUnavailableReason =
  'Notification mirroring needs a packaged (MSIX) build with the User Notification Listener capability. This unpackaged build cannot request it.';

export const notificationsProvider: ActivityProvider = {
  id: 'notifications',
  description: `Mirrors Windows notifications. Currently unavailable: ${notificationsUnavailableReason}`,
  start() { /* intentionally inert — see above */ },
  stop() {},
};

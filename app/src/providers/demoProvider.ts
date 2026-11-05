import type { ActivityProvider } from '../core/activityManager';

/**
 * Browser-preview-only sample provider. It publishes clearly labelled
 * sample data so the morph can be exercised without a native shell.
 * It is never registered when running inside Tauri.
 */
export const demoProvider: ActivityProvider = {
  id: 'demo',
  description: 'Sample data for browser preview. Reads nothing.',
  start(publish) {
    publish({ id: 'demo-timer', providerId: 'demo', kind: 'timer', title: 'Sample timer', subtitle: '05:00 (sample)', priority: 40, startedAt: Date.now() });
  },
  stop() {},
};

export const demoSecondProvider: ActivityProvider = {
  id: 'demo-second',
  description: 'Second sample activity, used to show the minimal bubble.',
  start(publish) {
    publish({ id: 'demo-music', providerId: 'demo-second', kind: 'now-playing', title: 'Sample song', subtitle: 'Sample artist', priority: 30, startedAt: Date.now() + 1 });
  },
  stop() {},
};

import { describe, expect, it } from 'vitest';
import { notificationToActivity } from './windowsNotifications';

describe('windows notification -> activity', () => {
  it('maps a WhatsApp-style toast with app-prefixed body', () => {
    const a = notificationToActivity(
      { id: 42, app: 'Chrome', title: 'Alice', body: 'Are we still on for 3pm?', arrivalMs: 1 }, 5000);
    expect(a).toMatchObject({
      id: 'win-notif-42', providerId: 'windows-notifications', kind: 'app-notification',
      title: 'Alice', subtitle: 'Chrome · Are we still on for 3pm?',
      priority: 80, sensitive: true, expiresAt: 35_000,
    });
  });
  it('falls back to the app name when there is no body', () => {
    const a = notificationToActivity({ id: 1, app: 'Mail', title: '2 new messages', body: '', arrivalMs: 0 });
    expect(a?.subtitle).toBe('Mail');
  });
  it('rejects empty titles and clamps oversized text', () => {
    expect(notificationToActivity({ id: 1, app: 'X', title: '   ', body: 'b', arrivalMs: 0 })).toBeNull();
    const a = notificationToActivity({ id: 2, app: 'X', title: 't'.repeat(300), body: 'b'.repeat(300), arrivalMs: 0 });
    expect(a?.title).toHaveLength(120);
    expect((a?.subtitle ?? '').length).toBeLessThanOrEqual(60 + 3 + 200);
  });
});

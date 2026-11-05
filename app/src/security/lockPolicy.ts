import type { Activity } from '../core/types';

/**
 * Lock-screen policy (brief section 7): when the workstation is locked —
 * or the user locks sensitive content manually — sensitive activities are
 * redacted to a generic label. Content is never destroyed, only hidden.
 */
export function redactForLock(activities: Activity[], locked: boolean): Activity[] {
  if (!locked) return activities;
  return activities.map((a) =>
    a.sensitive
      ? { ...a, title: 'Private activity', subtitle: 'Unlock to view', data: undefined }
      : a,
  );
}

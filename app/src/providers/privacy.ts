import type { ActivityProvider } from '../core/activityManager';
import { native, type PrivacyUse } from '../platform/native';

export interface PrivacySource {
  get(): Promise<PrivacyUse[] | null>;
  subscribe(cb: () => void): Promise<() => void> | (() => void);
}
export const nativePrivacySource: PrivacySource = {
  get: () => native.privacyGet(),
  subscribe: (cb) => native.onPrivacyChanged(cb),
};

const TITLES: Record<PrivacyUse['kind'], string> = {
  microphone: 'Microphone in use', camera: 'Camera in use', location: 'Location in use',
};

/**
 * Privacy indicators from the CapabilityAccessManager consent store
 * (brief section 3A). The registry layout is not a documented public API —
 * see ASSUMPTIONS A8. Read-only, hot-disableable, and a native registry
 * change notification triggers re-scans (no polling).
 */
export function createPrivacyProvider(source: PrivacySource = nativePrivacySource) {
  let unlisten: (() => void) | null = null;
  const seen = new Set<string>();

  const refresh = async (publish: (a: import('../core/types').Activity) => void, remove: (id: string) => void) => {
    const uses = (await source.get()) ?? [];
    const current = new Set<string>();
    for (const u of uses) {
      const id = `privacy-${u.kind}`;
      current.add(id);
      publish({
        id, providerId: 'privacy', kind: `privacy-${u.kind}`,
        title: TITLES[u.kind], subtitle: u.app, priority: 90, startedAt: Date.now(), sensitive: true,
        data: { app: u.app },
      });
    }
    for (const id of seen) if (!current.has(id)) remove(id);
    seen.clear();
    for (const id of current) seen.add(id);
  };

  const provider: ActivityProvider & { refreshOnce: () => Promise<void> } = {
    id: 'privacy',
    description: 'Shows which app is using your microphone, camera or location, from Windows privacy records. Read-only.',
    async start(publish, remove) {
      provider.refreshOnce = () => refresh(publish, remove);
      await refresh(publish, remove);
      unlisten = await source.subscribe(() => { void refresh(publish, remove); });
    },
    stop() { unlisten?.(); unlisten = null; },
    refreshOnce: async () => {},
  };
  return provider;
}

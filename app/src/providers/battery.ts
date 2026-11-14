import type { ActivityProvider } from '../core/activityManager';
import { native, type BatteryState } from '../platform/native';

export interface BatterySource { get(): Promise<BatteryState | null> }
export const nativeBatterySource: BatterySource = { get: () => native.batteryGet() };

/**
 * Battery/charging via GetSystemPowerStatus (verified Win32).
 * Windows broadcasts PBT_APMPOWERSTATUSCHANGE to window procedures; Tauri
 * does not expose a window proc, so this provider polls at 30s — the
 * API-forced polling exception in brief section 6, with change-only
 * publishing (see ASSUMPTIONS A9).
 */
export function createBatteryProvider(source: BatterySource = nativeBatterySource, pollMs = 30_000) {
  let prev: BatteryState | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = async (publish: (a: import('../core/types').Activity) => void, remove: (id: string) => void) => {
    const cur = await source.get();
    if (!cur || !cur.hasBattery) return;
    const now = Date.now();
    const pluggedIn = prev && !prev.acOnline && cur.acOnline;
    const unplugged = prev && prev.acOnline && !cur.acOnline;
    if (pluggedIn) {
      publish({ id: 'battery', providerId: 'battery', kind: 'battery', title: cur.charging ? 'Charging' : 'Plugged in', subtitle: `${cur.percent}%`, priority: 60, startedAt: now, expiresAt: now + 8000, data: { percent: cur.percent, charging: cur.charging } });
    } else if (unplugged && cur.percent > 20) {
      publish({ id: 'battery', providerId: 'battery', kind: 'battery', title: 'On battery', subtitle: `${cur.percent}%`, priority: 60, startedAt: now, expiresAt: now + 8000, data: { percent: cur.percent, charging: false } });
    }
    if (!cur.acOnline && cur.percent <= 20) {
      publish({ id: 'battery-low', providerId: 'battery', kind: 'battery-low', title: 'Low battery', subtitle: `${cur.percent}% remaining`, priority: 75, startedAt: now, data: { percent: cur.percent } });
    } else if (cur.acOnline || cur.percent > 25) {
      remove('battery-low');
    }
    // Edge only: reaching full charge while plugged in (not at launch).
    if (cur.acOnline && cur.percent >= 100 && prev && prev.percent < 100) {
      publish({ id: 'battery-full', providerId: 'battery', kind: 'battery-full', title: 'Battery full', subtitle: '100% · charged', priority: 65, startedAt: now, expiresAt: now + 8000, data: { percent: cur.percent } });
    }
    prev = cur;
  };

  const provider: ActivityProvider & { checkOnce: () => Promise<void> } = {
    id: 'battery',
    description: 'Reads battery percentage and charging state from Windows power status.',
    start(publish, remove) {
      void check(publish, remove);
      timer = setInterval(() => void check(publish, remove), pollMs);
      provider.checkOnce = () => check(publish, remove);
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    checkOnce: async () => {},
  };
  return provider;
}

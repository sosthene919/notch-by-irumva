import type { Activity } from './types';
import { EventBus } from './eventBus';

export interface ActivityProvider {
  id: string;
  /** Plain-language explanation of what this provider reads (brief section 7). */
  description: string;
  start(publish: (a: Activity) => void, remove: (id: string) => void): void;
  stop(): void;
}

/**
 * Priority arbitration over hot-disableable providers (brief section 2).
 * Ordering: priority desc, then earliest startedAt. Disabling a provider
 * removes its activities immediately.
 */
export class ActivityManager {
  private activities = new Map<string, Activity>();
  private providers = new Map<string, { provider: ActivityProvider; enabled: boolean }>();
  readonly bus = new EventBus(256);
  onChange: (() => void) | null = null;

  registerProvider(provider: ActivityProvider, enabled = true): void {
    this.providers.set(provider.id, { provider, enabled });
    if (enabled) provider.start(this.upsert, this.remove);
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    const entry = this.providers.get(id);
    if (!entry || entry.enabled === enabled) return;
    entry.enabled = enabled;
    if (enabled) {
      entry.provider.start(this.upsert, this.remove);
    } else {
      entry.provider.stop();
      for (const a of [...this.activities.values()]) if (a.providerId === id) this.activities.delete(a.id);
      this.emitChange();
    }
  }

  isProviderEnabled(id: string): boolean { return this.providers.get(id)?.enabled ?? false; }
  providerList(): { id: string; description: string; enabled: boolean }[] {
    return [...this.providers.values()].map(({ provider, enabled }) => ({ id: provider.id, description: provider.description, enabled }));
  }

  private upsert = (a: Activity): void => {
    if (!this.isProviderEnabled(a.providerId) && this.providers.has(a.providerId)) return;
    this.activities.set(a.id, a);
    this.emitChange();
  };

  private remove = (id: string): void => {
    if (this.activities.delete(id)) this.emitChange();
  };

  /** Public removal for UI dismiss actions. */
  dismiss(id: string): void { this.remove(id); }

  /** Expire activities whose deadline passed. Called on a timer by the shell, never polled tightly. */
  tick(now: number): void {
    let changed = false;
    for (const a of [...this.activities.values()]) {
      if (a.expiresAt !== undefined && a.expiresAt <= now) { this.activities.delete(a.id); changed = true; }
    }
    if (changed) this.emitChange();
  }

  ordered(now = Date.now()): Activity[] {
    return [...this.activities.values()]
      .filter((a) => a.expiresAt === undefined || a.expiresAt > now)
      .sort((a, b) => b.priority - a.priority || a.startedAt - b.startedAt);
  }

  private emitChange(): void {
    this.bus.publish({ type: 'activities', priority: 0, payload: null });
    this.onChange?.();
  }
}

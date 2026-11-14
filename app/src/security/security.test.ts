import { describe, expect, it } from 'vitest';
import { redactForLock } from './lockPolicy';
import { memoryBridge, SecureSettings } from './secureSettings';
import type { Activity } from '../core/types';

describe('lock policy', () => {
  const acts: Activity[] = [
    { id: '1', providerId: 'privacy', kind: 'privacy-microphone', title: 'Microphone in use', subtitle: 'Teams', priority: 90, startedAt: 0, sensitive: true, data: { app: 'Teams' } },
    { id: '2', providerId: 'battery', kind: 'battery', title: 'Charging', priority: 60, startedAt: 0 },
  ];
  it('redacts only sensitive activities while locked', () => {
    const out = redactForLock(acts, true);
    expect(out[0]).toMatchObject({ title: 'Private activity', subtitle: 'Unlock to view' });
    expect(out[0]?.data).toBeUndefined();
    expect(out[1]?.title).toBe('Charging');
    expect(redactForLock(acts, false)).toEqual(acts);
  });
});

describe('secure settings', () => {
  it('round-trips settings and keeps secrets out of the settings blob', async () => {
    const bridge = memoryBridge();
    const s = new SecureSettings(bridge, { theme: 'auto', volume: 50 });
    await s.save({ theme: 'dark', volume: 40 });
    expect(await s.load()).toEqual({ theme: 'dark', volume: 40 });
    await expect(s.save({ theme: 'dark', volume: 1, apiKey: 'x' } as never)).rejects.toThrow(/Credential Manager/);
    await s.setSecret('example', 'sk-test');
    expect(await s.getSecret('example')).toBe('sk-test');
    expect(bridge.stored()).not.toContain('sk-test');
  });
});

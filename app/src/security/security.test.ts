import { describe, expect, it } from 'vitest';
import { canonicalJson, newNonce, ReplayGuard, sign, verify } from './ipcProtocol';
import { redactForLock } from './lockPolicy';
import { memoryBridge, SecureSettings } from './secureSettings';
import type { Activity } from '../core/types';

const SECRET = 'ab'.repeat(32);

describe('ipc protocol', () => {
  it('canonical JSON sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":1}');
  });
  it('HMAC sign/verify round-trips and rejects tampering', async () => {
    const payload = { title: 'npm test', priority: 80 };
    const sig = await sign(SECRET, 1000, 'n1', payload);
    expect(await verify(SECRET, 1000, 'n1', payload, sig)).toBe(true);
    expect(await verify(SECRET, 1000, 'n1', { ...payload, title: 'rm -rf' }, sig)).toBe(false);
    expect(await verify('cd'.repeat(32), 1000, 'n1', payload, sig)).toBe(false);
    expect(await verify(SECRET, 1001, 'n1', payload, sig)).toBe(false);
  });
  it('replay guard rejects reused nonces and stale timestamps', () => {
    const g = new ReplayGuard(60_000, 4);
    const now = 1_000_000;
    expect(g.accept('a', now, now)).toBe(true);
    expect(g.accept('a', now, now)).toBe(false); // replay
    expect(g.accept('b', now - 120_000, now)).toBe(false); // stale
    expect(newNonce()).not.toBe(newNonce());
  });
});

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

import { validateIpcPayload } from '../providers/ipc';

describe('ipc payload validation (untrusted input)', () => {
  it('accepts a well-formed activity and clamps priority', () => {
    expect(validateIpcPayload({ id: 'a1', kind: 'build', title: 'npm test', priority: 250 }))
      .toMatchObject({ title: 'npm test', priority: 100, sensitive: true });
  });
  it('rejects empty/oversized titles and script-like kinds', () => {
    expect(validateIpcPayload({ kind: 'x', title: '' })).toBeNull();
    expect(validateIpcPayload({ kind: '<script>', title: 'hi' })).toBeNull();
    expect(validateIpcPayload({ kind: 'x', title: 'a'.repeat(121) })).toBeNull();
    expect(validateIpcPayload(null)).toBeNull();
  });
});

describe('secure settings', () => {
  it('round-trips settings and keeps secrets out of the settings blob', async () => {
    const bridge = memoryBridge();
    const s = new SecureSettings(bridge, { theme: 'auto', volume: 50 });
    await s.save({ theme: 'dark', volume: 40 });
    expect(await s.load()).toEqual({ theme: 'dark', volume: 40 });
    await expect(s.save({ theme: 'dark', volume: 1, apiKey: 'x' } as never)).rejects.toThrow(/Credential Manager/);
    await s.setSecret('openai', 'sk-test');
    expect(await s.getSecret('openai')).toBe('sk-test');
    expect(bridge.stored()).not.toContain('sk-test');
  });
});

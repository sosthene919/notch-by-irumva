/**
 * IPC authentication protocol (brief section 7). Shared design with the
 * Rust pipe server in app/src-tauri/src/security.rs:
 * - Envelope: { type, clientId, timestamp, nonce, payload, hmac }
 * - hmac = HMAC-SHA256(secret, `${timestamp}.${nonce}.${canonical(payload)}`)
 * - canonical JSON: object keys sorted recursively, no whitespace.
 * - Replay protection: timestamps within 60s, each nonce single-use.
 */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

const enc = new TextEncoder();
async function hmacKey(secretHex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(secretHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey('raw', bytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sign(secretHex: string, timestamp: number, nonce: string, payload: unknown): Promise<string> {
  const key = await hmacKey(secretHex);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${nonce}.${canonicalJson(payload)}`));
  return toHex(sig);
}

export async function verify(secretHex: string, timestamp: number, nonce: string, payload: unknown, expectedHex: string): Promise<boolean> {
  const actual = await sign(secretHex, timestamp, nonce, payload);
  if (actual.length !== expectedHex.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

/** Bounded single-use nonce registry with a timestamp window (replay protection). */
export class ReplayGuard {
  private nonces = new Map<string, number>();
  constructor(private windowMs = 60_000, private capacity = 1024) {}

  /** Returns true if the message is fresh and the nonce has never been seen. */
  accept(nonce: string, timestamp: number, now = Date.now()): boolean {
    if (Math.abs(now - timestamp) > this.windowMs) return false;
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, timestamp);
    // Evict expired first, then oldest beyond capacity.
    for (const [n, ts] of this.nonces) if (Math.abs(now - ts) > this.windowMs) this.nonces.delete(n);
    while (this.nonces.size > this.capacity) {
      const oldest = this.nonces.keys().next().value as string;
      this.nonces.delete(oldest);
    }
    return true;
  }
}

let counter = 0;
export function newNonce(): string {
  counter += 1;
  const rand = new Uint8Array(12);
  crypto.getRandomValues(rand);
  return `${counter}-${[...rand].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

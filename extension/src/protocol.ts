import * as crypto from 'crypto';

/** Same canonical-JSON + HMAC contract as the Notch app
 *  (app/src/security/ipcProtocol.ts and src-tauri/src/security.rs). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function sign(secretHex: string, timestamp: number, nonce: string, payload: unknown): string {
  return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(`${timestamp}.${nonce}.${canonicalJson(payload)}`)
    .digest('hex');
}

export function newNonce(): string {
  return crypto.randomBytes(12).toString('hex');
}

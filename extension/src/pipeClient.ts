import * as net from 'net';
import { canonicalJson, newNonce, sign } from './protocol';

const PIPE_PATH = '\\\\.\\pipe\\com.irumva.notch.v1';

export interface Pairing { clientId: string; secret: string }

/**
 * Client for the Notch named pipe. One short-lived connection per call;
 * approval/review calls keep their connection open until Notch answers
 * or the request times out (the server resolves timeouts as deny).
 */
export class NotchPipeClient {
  constructor(private getPairing: () => Promise<Pairing | null>) {}

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(PIPE_PATH);
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });
  }

  private async rpc(socket: net.Socket, message: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = Buffer.from(JSON.stringify(message));
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length);
    socket.write(Buffer.concat([len, body]));
    return new Promise((resolve, reject) => {
      let buf = Buffer.alloc(0);
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length < 4) return;
        const size = buf.readUInt32LE(0);
        if (buf.length < 4 + size) return;
        socket.off('data', onData);
        try { resolve(JSON.parse(buf.subarray(4, 4 + size).toString())); }
        catch (e) { reject(e); }
      };
      socket.on('data', onData);
      socket.once('error', reject);
    });
  }

  private async signed(type: string, payload: unknown): Promise<Record<string, unknown>> {
    const pairing = await this.getPairing();
    if (!pairing) throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
    const socket = await this.connect();
    try {
      const timestamp = Date.now();
      const nonce = newNonce();
      return await this.rpc(socket, {
        type, clientId: pairing.clientId, timestamp, nonce, payload,
        hmac: sign(pairing.secret, timestamp, nonce, payload),
      });
    } finally { socket.end(); }
  }

  async pair(code: string): Promise<Pairing> {
    const socket = await this.connect();
    try {
      const res = await this.rpc(socket, { type: 'pair', code });
      if (!res.ok) throw new Error(`Pairing failed: ${String(res.error ?? 'unknown')}`);
      return { clientId: String(res.clientId), secret: String(res.secret) };
    } finally { socket.end(); }
  }

  async publishActivity(payload: { id: string; kind: string; title: string; subtitle?: string; priority?: number; expiresInSeconds?: number }): Promise<void> {
    const res = await this.signed('activity.publish', payload);
    if (!res.ok) throw new Error(`Publish failed: ${String(res.error ?? 'unknown')}`);
  }

  /** Blocks until the user decides in Notch, or the request times out (deny). */
  async requestApproval(payload: { agent: string; action: string; target?: string; cwd?: string; timeoutMs?: number }): Promise<string> {
    const pairing = await this.getPairing();
    if (!pairing) throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
    const socket = await this.connect();
    try {
      const timestamp = Date.now();
      const nonce = newNonce();
      const res = await this.rpc(socket, {
        type: 'approval.request', clientId: pairing.clientId, timestamp, nonce, payload,
        hmac: sign(pairing.secret, timestamp, nonce, payload),
      });
      return String(res.decision ?? 'expired');
    } finally { socket.end(); }
  }

  async proposeReview(payload: Record<string, unknown>): Promise<{ decision: string; comment?: string }> {
    const pairing = await this.getPairing();
    if (!pairing) throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
    const socket = await this.connect();
    try {
      const timestamp = Date.now();
      const nonce = newNonce();
      const res = await this.rpc(socket, {
        type: 'review.propose', clientId: pairing.clientId, timestamp, nonce, payload,
        hmac: sign(pairing.secret, timestamp, nonce, payload),
      });
      return { decision: String(res.decision ?? 'expired'), comment: typeof res.comment === 'string' ? res.comment : undefined };
    } finally { socket.end(); }
  }
}

export { canonicalJson };

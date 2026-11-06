"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalJson = exports.NotchPipeClient = void 0;
const net = require("net");
const protocol_1 = require("./protocol");
Object.defineProperty(exports, "canonicalJson", { enumerable: true, get: function () { return protocol_1.canonicalJson; } });
const PIPE_PATH = '\\\\.\\pipe\\com.irumva.notch.v1';
/**
 * Client for the Notch named pipe. One short-lived connection per call;
 * approval/review calls keep their connection open until Notch answers
 * or the request times out (the server resolves timeouts as deny).
 */
class NotchPipeClient {
    getPairing;
    constructor(getPairing) {
        this.getPairing = getPairing;
    }
    connect() {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(PIPE_PATH);
            socket.once('connect', () => resolve(socket));
            socket.once('error', reject);
        });
    }
    async rpc(socket, message) {
        const body = Buffer.from(JSON.stringify(message));
        const len = Buffer.alloc(4);
        len.writeUInt32LE(body.length);
        socket.write(Buffer.concat([len, body]));
        return new Promise((resolve, reject) => {
            let buf = Buffer.alloc(0);
            const onData = (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                if (buf.length < 4)
                    return;
                const size = buf.readUInt32LE(0);
                if (buf.length < 4 + size)
                    return;
                socket.off('data', onData);
                try {
                    resolve(JSON.parse(buf.subarray(4, 4 + size).toString()));
                }
                catch (e) {
                    reject(e);
                }
            };
            socket.on('data', onData);
            socket.once('error', reject);
        });
    }
    async signed(type, payload) {
        const pairing = await this.getPairing();
        if (!pairing)
            throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
        const socket = await this.connect();
        try {
            const timestamp = Date.now();
            const nonce = (0, protocol_1.newNonce)();
            return await this.rpc(socket, {
                type, clientId: pairing.clientId, timestamp, nonce, payload,
                hmac: (0, protocol_1.sign)(pairing.secret, timestamp, nonce, payload),
            });
        }
        finally {
            socket.end();
        }
    }
    async pair(code) {
        const socket = await this.connect();
        try {
            const res = await this.rpc(socket, { type: 'pair', code });
            if (!res.ok)
                throw new Error(`Pairing failed: ${String(res.error ?? 'unknown')}`);
            return { clientId: String(res.clientId), secret: String(res.secret) };
        }
        finally {
            socket.end();
        }
    }
    async publishActivity(payload) {
        const res = await this.signed('activity.publish', payload);
        if (!res.ok)
            throw new Error(`Publish failed: ${String(res.error ?? 'unknown')}`);
    }
    /** Blocks until the user decides in Notch, or the request times out (deny). */
    async requestApproval(payload) {
        const pairing = await this.getPairing();
        if (!pairing)
            throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
        const socket = await this.connect();
        try {
            const timestamp = Date.now();
            const nonce = (0, protocol_1.newNonce)();
            const res = await this.rpc(socket, {
                type: 'approval.request', clientId: pairing.clientId, timestamp, nonce, payload,
                hmac: (0, protocol_1.sign)(pairing.secret, timestamp, nonce, payload),
            });
            return String(res.decision ?? 'expired');
        }
        finally {
            socket.end();
        }
    }
    async proposeReview(payload) {
        const pairing = await this.getPairing();
        if (!pairing)
            throw new Error('Not paired. Run "Notch Bridge: Pair with Notch" first.');
        const socket = await this.connect();
        try {
            const timestamp = Date.now();
            const nonce = (0, protocol_1.newNonce)();
            const res = await this.rpc(socket, {
                type: 'review.propose', clientId: pairing.clientId, timestamp, nonce, payload,
                hmac: (0, protocol_1.sign)(pairing.secret, timestamp, nonce, payload),
            });
            return { decision: String(res.decision ?? 'expired'), comment: typeof res.comment === 'string' ? res.comment : undefined };
        }
        finally {
            socket.end();
        }
    }
}
exports.NotchPipeClient = NotchPipeClient;

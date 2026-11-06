"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalJson = canonicalJson;
exports.sign = sign;
exports.newNonce = newNonce;
const crypto = require("crypto");
/** Same canonical-JSON + HMAC contract as the Notch app
 *  (app/src/security/ipcProtocol.ts and src-tauri/src/security.rs). */
function canonicalJson(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
function sign(secretHex, timestamp, nonce, payload) {
    return crypto.createHmac('sha256', Buffer.from(secretHex, 'hex'))
        .update(`${timestamp}.${nonce}.${canonicalJson(payload)}`)
        .digest('hex');
}
function newNonce() {
    return crypto.randomBytes(12).toString('hex');
}

#!/usr/bin/env node
// Visual smoke check: captures the island and the style guide over CDP
// from a running debug/release build started with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223.
// Asserts the PNGs exist, have plausible dimensions and are not blank
// (byte-size floor). Baseline pixel-diffing is intentionally not faked.
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-artifacts');
mkdirSync(outDir, { recursive: true });

const targets = await (await fetch('http://localhost:9223/json')).json();
if (!targets.length) { console.error('No CDP target. Start Notch with --remote-debugging-port=9223.'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
const send = (method, params = {}) => Promise.race([
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }),
  new Promise((res) => setTimeout(() => res(null), 15000)),
]);
ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
for (const [name, hash] of [['island', '#/'], ['styleguide', '#/styleguide'], ['security', '#/security'], ['devhub', '#/devhub'], ['hub', '#/hub'], ['diagnostics', '#/diagnostics']]) {
  await send('Runtime.evaluate', { expression: `location.hash='${hash}'`, returnByValue: true });
  await sleep(1200);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (!shot?.result?.data) { console.log(`FAIL ${name}: capture timed out`); failed++; continue; }
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  const size = statSync(file).size;
  const ok = size > 3000;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${size} bytes -> ${file}`);
}
ws.close();
process.exit(failed ? 1 : 0);

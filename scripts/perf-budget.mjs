#!/usr/bin/env node
// Phase 6 performance budgets (brief section 6), checked from artifacts.
// Idle-CPU / frame-rate claims are measured live in the Diagnostics page;
// this script enforces the sizes CI can check without a desktop session.
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MB = 1024 * 1024;
let failed = 0;
const check = (label, actual, budget) => {
  const ok = actual <= budget;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${(actual / 1024).toFixed(1)} KB (budget ${(budget / 1024).toFixed(0)} KB)`);
};

const assets = join(root, 'app/dist/assets');
if (existsSync(assets)) {
  for (const f of readdirSync(assets)) {
    const p = join(assets, f);
    if (f.endsWith('.js')) check(`JS bundle ${f} (gzip)`, gzipSync(readFileSync(p)).length, 200 * 1024);
    if (f.endsWith('.css')) check(`CSS ${f} (gzip)`, gzipSync(readFileSync(p)).length, 15 * 1024);
  }
} else { console.log('SKIP dist assets not built'); failed++; }

const nsis = join(root, 'app/src-tauri/target/release/bundle/nsis');
if (existsSync(nsis)) {
  for (const f of readdirSync(nsis).filter((x) => x.endsWith('.exe'))) {
    check(`installer ${f}`, statSync(join(nsis, f)).size, 25 * MB);
  }
} else console.log('SKIP installer not built');

const exe = join(root, 'app/src-tauri/target/release/notch.exe');
if (existsSync(exe)) check('notch.exe', statSync(exe).size, 25 * MB);

console.log(failed ? `\n${failed} budget(s) exceeded` : '\nAll performance budgets passed');
process.exit(failed ? 1 : 0);

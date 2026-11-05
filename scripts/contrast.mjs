#!/usr/bin/env node
// WCAG 2.2 contrast checks for the mandated palette pairs (brief section 4).
// Source of truth for hex values: app/src/styles/tokens.css
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'app/src/styles/tokens.css'), 'utf8');
const token = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --${name} not found in tokens.css`);
  return m[1];
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const dark = token('notch-surface'), light = token('notch-on-dark');
const checks = [
  // [label, fg, bg, minimum, rule]
  ['secondary text on dark (body)', token('notch-text-secondary'), dark, 4.5],
  ['primary text on dark (body)', light, dark, 4.5],
  ['danger text on dark (body)', token('notch-danger'), dark, 4.5],
  ['primary action on dark (large/icon only)', token('notch-action'), dark, 3.0],
  ['on-agent text on agent fill (body)', light, token('notch-agent'), 4.5],
  ['dark text on light surface (body)', dark, token('notch-surface-light'), 4.5],
];
let failed = 0;
for (const [label, fg, bg, min] of checks) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${fg} on ${bg} = ${r.toFixed(2)}:1 (min ${min}:1)`);
}
// Brief rule: #6A0DAD must never be text/icon on dark — encoded as a lint, not a ratio.
if (/color:\s*var\(--notch-agent\)/.test(css)) { console.log('FAIL agent color used as text color'); failed++; }
console.log(failed ? `\n${failed} contrast check(s) failed` : '\nAll contrast checks passed');
process.exit(failed ? 1 : 0);

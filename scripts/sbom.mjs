#!/usr/bin/env node
// Minimal SBOM (CycloneDX-shaped) from the two lockfiles. Full signing is Phase 6.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const components = [];

const lockPath = join(root, 'app/package-lock.json');
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path || !info.version) continue;
    components.push({ type: 'library', name: path.split('node_modules/').pop(), version: info.version, ecosystem: 'npm' });
  }
}
const cargoPath = join(root, 'app/src-tauri/Cargo.lock');
if (existsSync(cargoPath)) {
  const text = readFileSync(cargoPath, 'utf8');
  for (const m of text.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) {
    components.push({ type: 'library', name: m[1], version: m[2], ecosystem: 'cargo' });
  }
}
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5',
  metadata: { component: { type: 'application', name: 'Notch by IRUMVA', version: '0.1.0' } },
  components,
};
const out = join(root, 'sbom.json');
writeFileSync(out, JSON.stringify(sbom, null, 2));
console.log(`SBOM written to ${out}: ${components.length} components`);

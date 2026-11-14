# Antigravity integration

Researched 2026-11-05 against Google's official docs (antigravity.google/docs).

## Shipped: Notch Bridge inside Antigravity IDE

Antigravity IDE is a VS Code fork. The Notch Bridge extension (`/extension`) is a standard VS Code extension (engines ^1.90.0) that streams diagnostics, task/build status, debug sessions, terminal commands and git changes to the island over the Phase 3 authenticated pipe, and can request approvals / propose reviews that Notch answers. Install in Antigravity IDE by sideloading the .vsix (`npm run package` in `/extension` produces it with vsce); the same .vsix works in VS Code. Pairing: code from Notch Security settings, secret in the editor's SecretStorage.

## Removed (2026-11-11)

- **Tier 1 (ACP `agy acp` / Python SDK policy hooks):** removed. `agy` is not installed on the dev machine and the surface could not be verified end-to-end. Nothing in Notch talks to Antigravity directly; do not re-add without a live `agy` install and a verified permission round-trip.
- **Tier 3 (UI Automation mirroring of IDE approval prompts):** removed. It was design-only, fragile across IDE versions, and never implemented.

Notch must never override a Deny: the permission engine evaluates Deny > Ask > Allow, and Notch only mirrors "Ask".

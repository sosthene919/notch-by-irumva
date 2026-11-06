# Antigravity integration tiers

Researched 2026-11-05 against Google's official docs (antigravity.google/docs). The layered strategy from the brief, with what actually shipped in Phase 4:

## Tier 1 — official surfaces (documented, not yet wired)
- **ACP server**: `agy acp` runs an Agent Client Protocol server (JSON-RPC over stdio, protocol v1) that renders the agent's tool calls, file diffs and **permission requests** in the client UI. This is the cleanest future bridge for Antigravity approval mirroring: an ACP client shim could forward permission requests to Notch approval cards without any UI scraping.
- **Python SDK**: `google.antigravity` exposes `Agent` + `LocalAgentConfig(policies=[allow(...)/deny(...)/ask_user(...)])` and lifecycle hooks. `ask_user` maps naturally onto Notch approval cards for SDK-driven agents.
- **CLI**: `agy -p "prompt"` non-interactive; TUI slash commands.
- Status: `agy` is **not installed** on the dev machine, so Tier 1 is verified-by-documentation only. Nothing in Notch pretends to talk to Antigravity yet. Notch must never override a Deny: the permission engine evaluates Deny > Ask > Allow, and Notch only mirrors "Ask".

## Tier 2 — Notch Bridge inside Antigravity IDE (shipped)
Antigravity IDE is a VS Code fork and Google ships its own extensions for VS Code/JetBrains/Zed etc. The Notch Bridge extension (`/extension`) is a standard VS Code extension (engines ^1.90.0) that streams diagnostics, task/build status, debug sessions, terminal commands and git changes to the island over the Phase 3 authenticated pipe, and can request approvals / propose reviews that Notch answers. Install in Antigravity IDE by sideloading the .vsix (`npm run package` in `/extension` produces it with vsce); the same .vsix works in VS Code. Pairing: code from Notch Security settings, secret in the editor's SecretStorage.

## Tier 3 — UI Automation (not implemented, opt-in design only)
Detecting the IDE's own approval prompt via Windows UI Automation is fragile (control names/layout change between versions). If it is ever built:
- Detection only by default; it may *surface* a card in Notch but must never auto-click.
- A click is allowed only on an explicit user tap, after re-verifying at click time: target window handle, process id/name, control name, and the request identity shown in Notch.
- Settings must label it "experimental" (brief 3C.2). It is off by default and out of scope until Tier 1/2 prove insufficient.

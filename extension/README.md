# Notch Bridge (companion extension)

Streams diagnostics (error/warning counts), task and build status, test/task results, debug session state, terminal commands (when the editor's shell-execution API exists) and git changes from VS Code or Antigravity IDE to Notch by IRUMVA. It can also ask Notch for an approval and propose the current git changes for review in the island. Notch works without this extension; the extension only adds richer data.

## How it connects
Phase 3's authenticated named pipe (`\\.\pipe\com.irumva.notch.v1`): run **Notch Bridge: Pair with Notch**, enter the one-time code from Notch (island > full view > Security settings, or `#/security`). The per-client secret is stored in the editor's SecretStorage; every message after pairing is HMAC-signed and replay-protected. Protocol: `src/protocol.ts`, identical canonical-JSON/HMAC contract to the app.

## Commands
- `Notch Bridge: Pair with Notch`
- `Notch Bridge: Publish workspace status now`
- `Notch Bridge: Request approval in Notch (test)`
- `Notch Bridge: Propose current changes for review in Notch` — sends the working-tree diff; Notch can Approve / Request changes (comment comes back) / Open diff (files opened in the editor, full diff in the Notch Bridge output channel) / Reject.

## Build and sideload
```powershell
cd extension
npm install
npm run build   # tsc
npm test        # protocol tests
npm run package # produces notch-bridge-0.1.0.vsix (uses @vscode/vsce)
```
Install the .vsix in VS Code ("Extensions: Install from VSIX") or in Antigravity IDE the same way (it is a VS Code fork). Publishing to the VS Code Marketplace and Open VSX is a release task (Phase 6), not claimed here.

Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.

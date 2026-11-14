# Security policy

Notch by IRUMVA runs locally on your PC. It has no telemetry and makes no network calls except to a locally running OpenCode server at `127.0.0.1:4096` when you start one.

## Reporting a vulnerability
Report privately to the maintainer (IRUMVA Sosthene) via the repository's security advisory flow once the repository is public; until then, contact the maintainer directly. Please do not open a public issue for an exploitable bug. We aim to acknowledge within 7 days.

## Scope notes
- The named-pipe IPC (`\\.\pipe\com.irumva.notch.v1`) is restricted to your Windows user account and HMAC-authenticated. Same-account malware is outside this boundary; see `docs/THREAT_MODEL.md`.
- Settings are DPAPI-encrypted; secrets live in Windows Credential Manager. "Erase all my data" (Security settings) removes both.
- Builds are not yet code-signed; update signing/verification is described in `docs/UPDATING.md`.

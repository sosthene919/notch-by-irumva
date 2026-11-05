# Threat model (outline — full verification is Phase 3)

Assets: notification content, agent approval decisions, credentials, clipboard/file-shelf contents.
Adversaries: malicious local process, spoofed approval request, prompt-injected agent output, supply-chain tampering, another Windows user on a shared machine.

Phase 1 controls already in place:
- Strict CSP, no remote content, no `eval` (`tauri.conf.json`, `index.html`).
- All external/agent text rendered as inert plain text (React text nodes only; no `dangerouslySetInnerHTML` anywhere).
- No network listeners, no IPC surface yet.

Phase 3 must verify before shipping: named-pipe ACL (current-user SID) or loopback+per-install secret, HMAC+nonce replay protection, DPAPI at rest, Credential Manager for secrets, Windows Hello gating, signed updater. See brief §7. Nothing in Phase 1 claims these are done.

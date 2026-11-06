# Acceptance checklist

## Phase 1 — Foundations
- [x] ADR-001 records Tauri 2 decision + rejected alternative (`docs/ADR-001.md`)
- [x] Design tokens defined once as CSS variables, no one-off hex in components (`app/src/styles/tokens.css`)
- [x] Contrast check script passes for mandated pairs (`scripts/contrast.mjs`)
- [x] Island state machine: compact/expanded/full/minimal/collapsed transitions unit-tested (`app/src/core/stateMachine.test.ts`)
- [x] Event bus: priority ordering, bounded queue drop-oldest unit-tested (`app/src/core/eventBus.test.ts`)
- [x] Activity manager: priority arbitration + minimal-bubble rule unit-tested (`app/src/core/activityManager.test.ts`)
- [x] Style guide renders every component in rest/hover/pressed/focus/disabled/loading/error (`#/styleguide`)
- [x] Keyboard: Ctrl+Alt+N (app-level, configurable later), Esc collapse, arrows/Enter in expanded view; visible focus ring
- [x] Reduced-motion respected (`prefers-reduced-motion` + Windows setting read in Phase 2)
- [x] Rust shell compiles (`cargo check` passes, Tauri 2.12.5, Rust 1.99.1)
- [x] NSIS installer builds (`Notch by IRUMVA_0.1.0_x64-setup.exe`, 1.88 MiB), silent-installs per-user, registers `DisplayName/Publisher=IRUMVA/DisplayVersion/UninstallString/EstimatedSize` under HKCU Uninstall (verified 2026-11-05), installed exe runs (35.7 MB WS), silent uninstall removes install dir, uninstall key, Start Menu entry and process
- [ ] Clean-VM registry/filesystem diff and the "also delete user data" checkbox — stock uninstaller leaves `%LOCALAPPDATA%\com.irumva.notch\EBWebView` (WebView2 cache) behind; custom NSIS template is Phase 6 (ASSUMPTIONS A4)
- [ ] 60 fps morph measured on real hardware — Phase 6 perf gate (frame-time diagnostics)

## Phase 2 — Core activities
- [x] Now Playing via GSMTC: title/artist/album, album art (data URL), position/duration, Previous/Play-Pause/Next (`app/src/providers/nowPlaying.ts`, `app/src-tauri/src/native.rs`) — provider logic unit-tested with a fake source
- [x] Timers/stopwatch: 1s tick only while running, done activity expires after 60s (`app/src/providers/timers.ts`, fake-clock test)
- [x] Battery/charging via `GetSystemPowerStatus`: plug/unplug transients (8s), low-battery at ≤20% (`app/src/providers/battery.ts`, fake-source tests incl. unplug-at-low-% case)
- [x] Volume/mute overlay via Core Audio `IAudioEndpointVolume` + native change callback: change-only 2s transient, slider + mute in expanded view (`app/src/providers/volume.ts`)
- [ ] Brightness overlay — deferred, no cross-display documented read API (ASSUMPTIONS A10)
- [x] Privacy indicators (mic/camera/location) from consent store, read-only, registry-change notifications, priority 90 (`app/src/providers/privacy.ts`)
- [ ] Notification mirroring — blocked on unpackaged build, provider disabled with reason shown (ASSUMPTIONS A7); needs MSIX decision in Phase 6
- [x] Island controls do not toggle the island when clicked (pointer-target guard in `Island.tsx`); media/timer/volume controls wired in expanded/full views
- [x] Runtime smoke test (2026-11-05, release build): app stays alive with all native listeners running; live GSMTC session from Edge (WAV playback) shows "test-tone.wav — MSEdge" in the compact pill (CDP-verified); hardware volume-down key produces "Volume 22%" pill via the native Core Audio callback (CDP screenshot). Privacy scan runs without crashing (no sensor was in use to display). Note: desktop BitBlt screenshots do not capture our layered transparent window — verification used PrintWindow + CDP capture.
- [x] Phase 1 correction: the Phase 1 desktop screenshot was confounded by a pre-existing third-party "Notch" overlay on this machine (ASSUMPTIONS A13). Our own rendering is now verified by PrintWindow/CDP, and `GWL_EXSTYLE` read-back exposed that the ex-style applied in `setup` was being overwritten — fixed with a delayed apply in `lib.rs`.

## Phase 3 — Security layer
- [x] Named-pipe IPC: current-user-SID ACL (fail-closed), one-time 5-minute pairing codes (5-attempt lockout), per-client secrets, HMAC-SHA256 + 60s window + single-use nonces (`src-tauri/src/security.rs`, `src/security/ipcProtocol.ts`)
- [x] Live E2E (Node client, 10/10): wrong code rejected, code single-use, unsigned rejected, signed ping→pong, replay rejected, tampered payload rejected (`bad-hmac`), signed publish appears in the island
- [x] Settings encrypted at rest with DPAPI (files verified base64 ciphertext in app data); paired clients likewise; secrets only in Credential Manager; settings layer refuses secret-like keys
- [x] Windows Hello gate command (`hello_verify`) — this machine reports Hello unavailable, handled without a prompt and surfaced in the Security panel (A15)
- [x] Workstation-lock redaction: `WTSRegisterSessionNotification` hidden-window watcher + manual lock; sensitive activities redact to "Private activity" (unit-tested)
- [x] Security panel (`#/security`): pairing, Hello test, provider permissions with plain-language descriptions persisted via DPAPI settings, export (never includes secrets), two-step erase-all (settings + clients + credentials)
- [x] Threat model expanded with control mapping (`docs/THREAT_MODEL.md`); SBOM generated (616 components); `npm audit` clean; `cargo audit` deferred to CI (A14)
- [x] Rust unit tests: canonical-JSON parity with TS, HMAC tamper detection (`cargo test`, 2 passed)

## Phase 4 — Developer Hub
- [x] Approval core: request bound to ID + SHA-256 of the exact action, single-use, expiring, session-allow by identical hash only, audit log (200 cap), risk classification (destructive/network/credentials/outside-workspace = high; allowlisted test/build = low) (`app/src/core/approvals.ts`, 36 TS tests incl. hold-gate regression)
- [x] Strong gate: Windows Hello when available, otherwise hold-to-confirm 1.2s; a failed gate leaves the request answerable, Deny never needs the gate
- [x] Pipe approval/review request-response: paired clients block (bounded) until the island answers; timeouts resolve as deny (`security.rs` `approval.request`/`review.propose`, `approval_respond`/`review_respond` with hash re-verification)
- [x] Notch Bridge extension (`/extension`): diagnostics, task/build status, debug sessions, terminal commands (feature-detected), git changes; pair command (SecretStorage), approval + review commands; compiles (`tsc`) and protocol tests pass (2/2); works in VS Code and Antigravity IDE (Tier 2, `docs/ANTIGRAVITY.md`)
- [x] Code review cards: files +/-, summary, test status; Approve / Request changes (comment returned to the agent) / Open diff / Reject, single-decision (`app/src/core/reviews.ts`)
- [x] OpenCode Quick Task: composer echoes workspace before running; task lifecycle queued -> running -> needs-approval -> done/failed/interrupted with Abort/Re-run; server start is opt-in, loopback-only, password in Credential Manager (`app/src/devhub/`)
- [x] Live E2E (2026-11-06, 7/7): bridge pairing, low-risk allow-once, high-risk hold-to-confirm, review request-changes with comment, Notch-started OpenCode server, real Quick Task reaching `done`
- [ ] OpenCode permission -> approval-card live round-trip with a real tool call (plumbing is unit-tested with fakes and uses the verified reply endpoint; not yet triggered by a live agent tool call)
- [ ] Antigravity Tier 1 (ACP) approval mirroring — `agy` not installed (A17)

## Later phases
Phases 5–6 items are added here as each phase starts; nothing below Phase 4 is claimed.

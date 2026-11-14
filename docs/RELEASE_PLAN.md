# Release plan (Phase 6)

## Stack

Tauri 2 (Rust) with a React and TypeScript frontend in WebView2. Version lives in three files that must match: `app/package.json`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`. Current version: 1.0.0.

## Installer choice

Keep Tauri's NSIS bundle. It already produces one per-user Setup.exe (no admin, no UAC), registers in Settings > Apps with name, version, publisher and icon, supports `/S` for silent install and uninstall, and keeps user data on upgrade. Inno Setup would add a second installer toolchain and a hand-written upgrade path. WiX gives transactional MSI rollback, but per-user MSI still needs care to avoid elevation prompts, and staying in one .exe needs a bootstrapper. Trade-off accepted: NSIS file replacement is not transactional, so the installer backs up the previous binary and user data before overwriting, and the app restores them itself after repeated failed starts.

Installer behavior added in `app/src-tauri/windows/hooks.nsh`:

- One Setup.exe at a time (named mutex, plain message).
- The running app is closed gracefully first, forced only after 1.5 s.
- Before any file is replaced, the previous `notch.exe`, its version, settings, paired-client data and lyrics cache are copied to `%APPDATA%\com.irumva.notch\rollback`.
- Downgrades are refused by the template (`bundle.windows.allowDowngrades: false`). The installer shows the installed and offered versions. To go back on purpose, uninstall first, or use the in-app restore after a failed start. User data is kept either way.
- "Start with Windows" defaults to on and is applied by the app on first run, with a Settings toggle. The stock NSIS template has no options page and the template is not forked for one checkbox.
- The finish page offers "Run Notch by IRUMVA" (template feature).
- Uninstall removes program files, shortcuts, the uninstall entry, the startup value, the app registry key and watcher temp folders. User data is kept unless the template's "Delete app data" box is checked.

Silent switches: `Notch by IRUMVA_1.0.0_x64-setup.exe /S` installs silently. `uninstall.exe /S` uninstalls silently and keeps user data.

## Upgrades and rollback

Same installer, run again. Settings schema is versioned (`schemaVersion`, current 2). Before a migrating save the app copies its data to `%APPDATA%\com.irumva.notch\backups` and keeps the newest 3. A newer schema than the build understands is never rewritten.

Interrupted installs: the binary backup happens before the template copies a single file, and the template copies the main executable in one `File` step. A power cut therefore leaves the old binary, the new binary, or a new binary whose first-run data backup exists. The one unrecoverable-by-design case is a cut during the single-file copy itself; the rollback store still holds the previous binary, and rerunning Setup repairs the install (covered in the manual matrix).

Crash rollback: every launch writes `session.running` and clears it on graceful exit. The hidden watchdog (`notch.exe --watchdog <pid>`) relaunches the app after an unclean exit. Three unclean exits arm safe mode (no providers, notice shown, Settings reachable). If a rollback store exists, the notice offers "Restore the previous version": data is copied back, the current binary is renamed aside (a running .exe cannot be overwritten on Windows, but it can be renamed), the previous binary takes its place and starts.

Single instance: a named mutex claims the app; a second launch signals the first to open Settings and exits.

Version and migration logic live in the app (`app/src/core/migrations.ts`, `app/src-tauri/src/release.rs`), not in the installer, so a future manual or automatic updater can reuse them. No code in this release contacts a server for updates.

## Signing

Options for an individual developer in Rwanda. Verify each against your own situation before paying anything:

- **Standard (OV) Authenticode certificate** from a public CA (for example DigiCert, Sectigo, SSL.com, GlobalSign, Certum). Sold through resellers in many countries; identity checks usually need a passport or national ID plus a phone or address verification. Certum's open-source/individual offer and SSL.com have historically been the cheapest routes. Expect roughly USD 100-300 per year. Private keys now must live on a hardware token or cloud HSM, which adds cost and shipping questions to Rwanda. Ask the CA before ordering: do you issue to an individual with a Rwandan ID and address, and how is the token shipped?
- **EV certificate.** Immediate SmartScreen reputation, higher price, stricter vetting, hardware token mandatory. Rarely worth it for a first free release.
- **Microsoft Store.** The Store signs packages itself and avoids SmartScreen prompts. It means MSIX packaging, which this project ruled out (single .exe requirement), and a developer account fee.
- **Azure Trusted Signing** (formerly Azure Code Signing). Cheap per month and no token, but eligibility has been limited to certain countries and to organizations or individuals with a verifiable history. Check current country eligibility for Rwanda before planning around it; do not assume it is available to you.

SmartScreen reputation for direct downloads builds per file hash and publisher: a new OV-signed file still warns until enough installs accumulate; an EV-signed or Store file does not. Signing is wired into `scripts/build-release.ps1 -CertThumbprint <thumbprint>` (SHA-256, timestamped through Tauri's bundler). Sign the app binary and the installer, which the bundler does in one pass. Never commit a certificate, password or token PIN. CI keeps the thumbprint in secrets only.

## Unsigned release plan (current state)

Until a certificate exists:

1. Build with `scripts/build-release.ps1`. Publish the Setup.exe together with `SHA256SUMS.txt` and `sbom.json` from the same build.
2. Tell users what they will see: "Windows protected your PC" on first run. The safe path is: check the file name matches, compare the SHA-256 (PowerShell: `Get-FileHash .\Notch by IRUMVA_1.0.0_x64-setup.exe`), and only then choose "More info" and "Run anyway". Put these steps where the download is shared, in plain language.
3. Never ask users to disable SmartScreen or Defender. If a build is flagged, submit it (below) instead of telling users to whitelist blindly.

## Antivirus false positives

The app is an always-on-top overlay that reads media sessions and Bluetooth state, which can look suspicious to heuristics. Mitigations already in place: no packers or obfuscation, normal version metadata with publisher and copyright, no injection into other processes, no listening ports, one documented outbound endpoint (LRCLib over HTTPS). If a vendor flags a build: submit the exact Setup.exe hash and file to Microsoft Defender (microsoft.com/wdsi/filesubmission), VirusTotal for multi-vendor results, and the specific vendor's false-positive form. Wait for the verdict before re-releasing; do not ship a repacked binary with a new hash to dodge a flag.

## What to prepare

- A decision on signing (above) and, if signing, the certificate order started early; vetting takes days.
- A clean Windows 11 VM or spare PC for the manual matrix in `docs/RELEASE_CHECKLIST.md`.
- The previous release's Setup.exe kept locally. Rollback drills need it.

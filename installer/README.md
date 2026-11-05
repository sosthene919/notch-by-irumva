# Installer

Output: `Notch-Setup-<version>.exe` (Tauri NSIS bundle, renamed at release time), per-user by default (`installMode: currentUser`, no admin), `Publisher: IRUMVA` in `tauri.conf.json` so the entry appears in Windows Settings > Apps > Installed apps with DisplayName "Notch by IRUMVA".

- Install/uninstall hooks: `app/src-tauri/windows/hooks.nsh` (stops the process, removes the autostart Run value).
- Credits: version metadata (`bundle.copyright`), About screen, README, LICENSE/NOTICE. Finish-page credits need a custom NSIS template — see `docs/ASSUMPTIONS.md` A4. Not claimed done.
- Signing: no certificate yet (A5). Unsigned builds trigger SmartScreen; the release path is Authenticode + timestamping, documented here before Phase 6 signing.
- Verified 2026-11-05 on the dev machine: silent install (`/S`) → files in `%LOCALAPPDATA%\Notch by IRUMVA`, HKCU Uninstall entry with Publisher IRUMVA; silent uninstall → install dir, uninstall key, Start Menu entry and process removed. Known leftover: `%LOCALAPPDATA%\com.irumva.notch\EBWebView` (WebView2 cache) — deleting user data is an opt-in checkbox in the brief, which needs the custom NSIS template (Phase 6). Clean-VM diff still owed in Phase 6.

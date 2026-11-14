# Release checklist

## Every release

- [ ] Version bumped in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml` (must match; the build script refuses otherwise)
- [ ] `CHANGELOG.md` entry written in plain language (it ships inside the app, Settings > About)
- [ ] `scripts/build-release.ps1` from a clean checkout: tests, contrast checks, SBOM, audit report reviewed
- [ ] Installer and app signed when a certificate is available (`-CertThumbprint`), timestamped
- [ ] `release/<version>/` contains Setup.exe, `SHA256SUMS.txt` and `sbom.json` from the same build
- [ ] Smoke test on a clean VM (matrix below)
- [ ] Previous version's Setup.exe still on hand for a rollback drill

## If a bad build is already out

Anyone holding the bad Setup.exe is fine: their app restores the previous version itself after repeated failed starts, and their data backup sits in `%APPDATA%\com.irumva.notch`. To help manually: tell users to run the previous Setup.exe (data is kept), or open the app, dismiss safe mode, and use "Restore the previous version". Do not tell anyone to delete the app data folder as a first step.

## Manual test matrix

Needs a real machine or clean Windows 11 VM with no developer tools. None of this is covered by the automated tests.

- [ ] Clean Windows 11: install, run, reboot (island returns), uninstall. Nothing left in `%APPDATA%`, `%LOCALAPPDATA%`, Start Menu, startup entries or `HKCU\Software\Notch by IRUMVA` after uninstall with "Delete app data"
- [ ] Upgrade from the previous version with real reminders, to-dos, shelf items and a warm lyrics cache. Data intact afterwards
- [ ] Force a rollback: break the new build or kill it 3 times at startup. Safe mode notice appears, "Restore the previous version" brings the old build and data back
- [ ] Install as a standard user (no admin exists on the account)
- [ ] Install to a second drive or moved user profile
- [ ] Install while the app is already running (graceful close, relaunch by the finish page)
- [ ] Install with low disk space (under 100 MB free)
- [ ] Kill the power during an upgrade, then power on: old or new version runs, never a mix
- [ ] Start two Setup.exe copies at once (second one stops with a message)
- [ ] Try to install the older Setup.exe over the newer one (refused, versions shown)
- [ ] SmartScreen and Windows Defender on first download, signed and unsigned builds
- [ ] Silent install `/S` and silent uninstall `uninstall.exe /S`
- [ ] 100, 125, 150 and 200% display scaling on the installer and first-run screens
- [ ] Light and dark Windows themes; island Appearance in Auto, Light and Dark
- [ ] Keyboard-only through installer and first run; Narrator over the installer welcome, options and finish
- [ ] Sleep and resume with a timer running; session lock during a reminder; fast user switching
- [ ] Explorer restart (`explorer.exe` killed and relaunched) with the island up
- [ ] Full-screen game, full-screen video, PowerPoint slideshow: island hides and returns
- [ ] A maximized app (Win+Up / double-click the title bar) on the notch's display: island retracts while maximized and returns when restored or minimized
- [ ] Every hub page at 100% island scale: no page's bottom row is clipped (Pomodoro presets, Water goal/reminder rows, Music with lyrics open)
- [ ] Settings > About: Instagram and Ko-fi links open in the default browser (not inside the app)
- [ ] Real Bluetooth earbuds: connect card, battery ring, low-battery alert at 20%, disconnect notice
- [ ] Multi-monitor: display picker pins the notch, unplug the display while running

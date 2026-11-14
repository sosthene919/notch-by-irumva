# Final bug-risk report, Notch by IRUMVA 1.1.0

Release: `release/1.1.0/install.exe` (same file as `Notch by IRUMVA_1.1.0_x64-setup.exe`), 3.67 MB, SHA-256 in `release/1.1.0/SHA256SUMS.txt`. Unsigned (no certificate yet, see `docs/UPDATING.md`).

## Verified in this run

- Unit tests: TypeScript 89 of 89 (19 files), Rust 13 of 13, contrast checks all pass, performance budgets all pass.
- Build: `npm run tauri build` clean, NSIS setup produced.
- Wizard: flat #1D1D1F brand panel with the Concept A icon, product name and Iwasaki Softwares (screenshot `test-artifacts/installer-110-welcome.png`). Licence page with terms acceptance verified visually on the 1.0.0 build with the identical terms file, and the licence mechanism is unchanged in 1.1.0. A fresh GUI pass at the 1.1.0 licence page was blocked because the desktop was in active use during the check.
- Install chain on this machine: 1.0.0 silent install, 1.1.0 silent upgrade over it (data kept, app starts as 1.1.0, crash count 0), downgrade attempt with the 1.0.0 setup refused (exit 2, 1.1.0 intact), silent uninstall removes the app and its registry entry and keeps user data.
- Hub at 420 x 248: Today page with week strip and summary, page dots, Settings page order/hide and text preview controls, verified by CDP screenshots (`test-artifacts/phase5-today.png`, `test-artifacts/settings-pages.png`).

## The 10 most likely failure points

| # | Failure point | Guard | Still needs |
| --- | --- | --- | --- |
| 1 | Media session from a player publishes no duration or position (ads, some browsers) | Scrub bar hides without duration, transport still works, nothing is invented | Testing against more players (Spotify desktop, VLC) on a clean machine |
| 2 | LRCLIB returns the wrong track or a slow reply lands after the track changed | Closest-duration match, results a few seconds off dropped, replies checked against the current track key, 5 s timeout, local cache, lyrics off switch | Live network is never used in tests (recorded samples only), so a real LRCLIB outage will only show the offline state, which is designed |
| 3 | Bluetooth device reports no battery, or reports as both classic and BLE | Card renders without a ring, devices de-duplicated by id, low-battery alert once per discharge at 20% and 10%, persisted across restarts | Two real devices (one classic, one BLE) side by side; this machine's devices were not re-tested in this run |
| 4 | Computer sleeps through a reminder or timer, or the clock changes | Deadlines stored as absolute times, fire once on wake, recurrence in local time, unit tests for time zone and daylight saving edges in the scheduler tests | A real overnight sleep test with a reminder due mid-sleep |
| 5 | Settings file is corrupt after a power cut mid-write | Atomic write (temp, then replace), versioned schema, backup before migration, defaults plus a Diagnostics note on bad data | A forced power-cut during upgrade (manual matrix) |
| 6 | New version crashes on launch after an upgrade | Previous binary and data snapshot kept, 3 failed starts restore the previous version and show safe mode with the reason (`test-artifacts` and hooks in `windows/hooks.nsh`) | A forced rollback drill on the 1.1.0 upgrade path (verified on earlier versions) |
| 7 | Full-screen game or video does not hide the island, or a maximized normal window hides it by mistake | Conservative full-screen check per monitor plus foreground rectangle, no title or content read | Three real games (exclusive and borderless) and a slideshow; not run in this session |
| 8 | Click-through region is wrong after a resize, scale change or monitor unplug, so clicks land on the island or fall through it | Hover region is re-registered on every size change, display picker and startup monitor move, click-through only outside the island hit area | Mixed-DPI multi-monitor plug and unplug while running |
| 9 | A module hangs or throws repeatedly and takes the island down with it | Modules are isolated providers with on/off switches; after 3 crashes the app starts in safe mode (core only) and says why; safe mode verified in the startup log path | The 72-hour soak with simulated events was not run for 1.1.0 (earlier builds passed the same budgets; memory and handle flatness for this exact build is unverified) |
| 10 | Unsigned installer is flagged by SmartScreen or an antivirus false positive | No packing or obfuscation, full version metadata (Iwasaki Softwares, copyright IRUMVA Sosthene), published SHA-256, unsigned warnings documented in `installer/TERMS_AND_CONDITIONS.txt` section 7 | A code-signing certificate (only paid item left) and a clean-VM Defender check |

## Known deviations from the master prompt, stated plainly

- The shipped app also mirrors Windows notifications and has a privacy indicator and security settings that section 3 of the master prompt puts out of scope. They predate this run-through, are documented in `docs/PRIVACY.md`, and were not removed: removing them is a product decision for the owner, not a bug fix. Everything the master prompt lists as in scope is present.
- The installer is Tauri's NSIS bundle, not Inno Setup. Section 9 allows this where the stack favors it. The wizard has the left brand panel, licence page, and per-user install the prompt asks for.
- Manual matrix items not done in this run: clean VM, multi-monitor and mixed DPI, high-refresh frame pacing, Narrator pass, games, real Bluetooth pair, power-cut mid-upgrade, 100 to 200% installer scaling. They are listed in `docs/RELEASE_CHECKLIST.md` and block any claim beyond "verified on this dev machine".

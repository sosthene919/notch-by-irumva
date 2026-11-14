# Privacy statement and data inventory

Notch by IRUMVA runs on your PC, for you. No account, no telemetry, no analytics, no crash upload. The only network access in the app is the lyrics lookup described below.

## The one network connection

| What | Detail |
|---|---|
| Endpoint | `https://lrclib.net` (LRCLib, a community lyrics database) |
| Sent | Song title, artist, album and duration in seconds. Nothing else. No identifiers, no IP logging by the app, no history |
| When | Once per track, only while lyrics are on (Settings > Lyrics, on by default) |
| Protection | HTTPS with certificate validation, 5 second timeout, at most one request per 500 ms, responses capped at 2 MB |
| Off switch | Settings > Lyrics > Synced lyrics. Off means zero network access, and everything else keeps working |

There are no other endpoints. No update checks, no servers, no listening ports.

## What the app reads, and why

| Permission or input | Why |
|---|---|
| Windows media session (GSMTC) | Show the playing song, artwork and controls, and seek. Read and control only the session you pick |
| Core Audio volume endpoint | Show volume changes and change volume from the island |
| Battery status (`GetSystemPowerStatus`) | Charging and low-battery activities |
| Camera, microphone and location consent store (registry, read-only) | Privacy indicators naming the app using them |
| Notification center database (`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db`, read-only snapshots) | Mirror app notifications into the notch when that provider is on. Text is treated as private and hidden on the lock screen |
| Bluetooth enumeration and BLE battery service | Device cards with battery where the device reports it. No pairing is done by the app |
| Foreground window rectangle (no title, no content) | Hide the notch while a game, video or presentation is full-screen |
| Cursor position | Expand the notch when you touch it (the idle notch is click-through) |
| Files you drag onto the island | The file shelf stores the paths you dropped, nothing is copied or uploaded |

## What is stored, where

All user data lives in your profile. Settings, reminders, to-dos and shelf metadata are in one settings file encrypted with Windows DPAPI for your user account. The lyrics cache is DPAPI-encrypted too.

| Location | Contents |
|---|---|
| `%APPDATA%\com.irumva.notch\settings.dpapi` | Settings, reminders, to-dos, shelf paths, provider toggles (DPAPI) |
| `%APPDATA%\com.irumva.notch\lyrics\` | Cached LRCLib answers (DPAPI) |
| `%APPDATA%\com.irumva.notch\backups\` | Up to 3 data snapshots taken before migrations and upgrades |
| `%APPDATA%\com.irumva.notch\rollback\` | Previous program version after an upgrade, for automatic restore |
| `%APPDATA%\com.irumva.notch\logs\` | Local log, event names and versions only, capped at 256 KB, rotated once |
| `%LOCALAPPDATA%\com.irumva.notch\EBWebView\` | The WebView2 runtime's own cache |
| `%TEMP%\notch-wpn-<pid>\` | Short-lived read-only snapshots of the notification database |
| Windows Credential Manager, `Notch by IRUMVA:` entries | Secrets kept out of the settings file (none are needed by current features) |

Registry: `HKCU\Software\Notch by IRUMVA` (notification takeover bookkeeping), the `Run` value of the same name when "Start with Windows" is on, and the standard Uninstall entry. While notification takeover is on, one Windows value (`NOC_GLOBAL_SETTING_TOASTS_ENABLED`) is set to off and restored when takeover ends, the app quits, or it is uninstalled.

## Deleting your data

Settings > Your data > Erase all my data removes the settings file, stored secrets, lyrics cache, backups, rollback store, logs and diagnostics exports. Uninstalling offers the same choice through the "Delete app data" box. Keeping data (the default) leaves your reminders and settings for a future install.

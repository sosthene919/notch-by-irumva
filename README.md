# Notch by IRUMVA

A Dynamic Island for Windows 11: a pill-shaped, always-on-top, top-center surface that morphs between compact, expanded and full states to show live activities from the system and from apps.

Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.

## Follow / support

- Instagram: https://www.instagram.com/iwasaki.10/
- Ko-fi (support the project): https://ko-fi.com/iwasaki10

The same links are in the app under Settings > About.

## Download

Windows users can download the latest installer from
[GitHub Releases](https://github.com/sosthene919/notch-by-irumva/releases/latest).
The repository includes screenshots and a short demo in [`marketing/`](marketing/).
The current installer is unsigned, so Windows SmartScreen may show a first-run warning.
Compare the installer hash with `SHA256SUMS.txt` before running it.

> Font: the UI prefers **SF Pro** (the macOS system face) when a licensed copy is installed on the PC, and otherwise uses **Inter** (SIL OFL), the closest open-source match to SF Pro, bundled with the app. OnlySans is still honoured when installed, but it is commercial and is not bundled.

## Status
Phases 1–6 are complete for the shipped scope and verified live (see `docs/ACCEPTANCE.md`). Features that needed premium/keyed services or APIs unavailable to an unpackaged Windows app (notification mirroring, brightness, weather, GPU temperature, OCR, radio toggles, Antigravity ACP) were removed rather than faked — see `docs/ASSUMPTIONS.md`. Builds are unsigned (SmartScreen may warn; a signing certificate is the only remaining paid item); see `docs/UPDATING.md`.

## Build (frontend — no Rust needed)
```powershell
cd app
npm install
npm test          # state machine, event bus, activity manager, contrast
npm run build     # type-check + production bundle
npm run dev       # browser preview (Tauri APIs are stubbed outside the shell)
```

## Build (native shell — requires Rust stable-msvc + VS C++ Build Tools)
```powershell
cd app
npm run tauri dev
npm run tauri build   # NSIS per-user installer in src-tauri/target/release/bundle/nsis/
```

## Layout
- `app/` — Tauri 2 shell (Rust) + React/TypeScript UI
- `extension/` — Notch Bridge companion extension (Phase 4)
- `installer/` — installer notes, signing and clean-uninstall verification
- `docs/` — ADRs, threat model, assumptions, acceptance, style guide
- `scripts/` — contrast and performance-budget checks

## License
MIT. See `LICENSE` and `NOTICE`.

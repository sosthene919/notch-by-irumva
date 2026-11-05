# Notch by IRUMVA

A Dynamic Island for Windows 11: a pill-shaped, always-on-top, top-center surface that morphs between compact, expanded and full states to show live activities from the system and from apps.

Created by IRUMVA Sosthene. Built with Muse AI and Claude Sonnet.

## Status
Phase 1 (Foundations) in progress. See `docs/ACCEPTANCE.md` for what is verified and `docs/ASSUMPTIONS.md` for open items.

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

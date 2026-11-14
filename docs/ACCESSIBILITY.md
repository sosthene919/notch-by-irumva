# Accessibility checklist (WCAG 2.2 AA target)

Implemented and verified in code:
- [x] Keyboard: global hotkey (configurable) to expand, in-window Ctrl+Alt+N fallback, Esc collapses, Tab reaches every control in expanded/full views; buttons are native `<button>` (Enter/Space work).
- [x] Visible focus ring: 2px `#007AFF` outline with offset via `:focus-visible` (`--notch-focus-ring`), contrast-checked.
- [x] Live regions: island is `aria-live="polite"`; approval requests use `role="alert"`/`aria-live="assertive"` (ApprovalCard).
- [x] Minimum 40px interactive targets (`.btn` min-height 40px; toggles/sliders have 40px rows).
- [x] Reduced motion: `prefers-reduced-motion` snaps the island morph and disables CSS transitions; spring hook reads the media query.
- [x] Contrast: automated checks (`scripts/contrast.mjs`) for body text, danger, agent fill, light surface; states never rely on color alone (badges/risk always have text labels).
- [x] No flashing loops; no audio cues yet (feature is off-by-default in the brief; captions requirement applies when/if sounds ship).

Manual / pending (be honest before release):
- [ ] Narrator/NVDA pass over island + DevHub with the real build (UIA tree comes from WebView2; verify names/roles are announced as expected).
- [x] Windows High Contrast (code level): `@media (forced-colors: active)` rules added 2026-11-12 (`app/src/styles/app.css`) — borders/`forced-color-adjust`, Highlight focus outline and progress fill. Visual HC pass with the OS theme enabled is still part of the manual items below.
- [ ] 200% text scaling check in the 440px window (routes scroll; island compact line truncates with ellipsis).
- [ ] axe-style automated scan of the style-guide and settings routes rendered in Edge (no axe dependency is bundled yet).

The checklist is re-run at every release; unchecked items block a "WCAG verified" claim, not the build.

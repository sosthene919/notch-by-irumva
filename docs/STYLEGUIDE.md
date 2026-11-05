# Style guide

Living version: run the app and open `#/styleguide` (every component in rest/hover/pressed/focus/disabled/loading/error states).

Rules (brief section 4 fallback; the "unslop" skill was unavailable — ASSUMPTIONS A1):
- Tokens only: `app/src/styles/tokens.css`. No one-off hex in components. Contrast enforced by `scripts/contrast.mjs`.
- `#6A0DAD` is a fill only, never text/icon on dark. `#007AFF` is icons/large text/fills; small text on dark uses `--notch-action-text`.
- 4/8px spacing, Segoe UI Variable, one corner logic (pill for the island and controls, 16px cards: outer radius minus padding for inner elements).
- Motion: spring morph 180–420ms, interruptible; content cross-fades with transform/opacity only; `prefers-reduced-motion` snaps.
- Copy is short and specific. No emoji in UI copy. No decorative gradients or glows.

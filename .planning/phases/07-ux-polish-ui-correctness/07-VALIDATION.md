## Phase 7 Validation (Nyquist Gate)

### Automated gates (must pass)

```bash
npm test
npm run build
```

If `npm test` fails because JSDOM isn’t available, fix the test to use per-file `@vitest-environment jsdom` and avoid new dependencies.

### Phase 7 testing constraint

- This phase must **not require Playwright/E2E runs** for validation. Keep Phase 7 verification to Vitest (`npm test`) + build (`npm run build`).

### Manual UX checklist (desktop + mobile widths)

Run `npm run dev` and verify in a browser with responsive mode.

#### Global checks
- [ ] No action buttons visually overlap other UI (no “stacked” text/buttons).
- [ ] No buttons bleed outside card/panel borders (no horizontal scrollbars caused by button rows).
- [ ] Content remains readable; header/action rows wrap instead of overflowing.

#### Width: <= 980px (tablet / narrow desktop)
- [ ] **Events page (`#events`)**: event card action buttons stay inside the card; no overflow.
- [ ] **Manager page (`#manager`)**: manage row (start input + buttons) stays inside the card; buttons don’t overlap; row can wrap/shrink cleanly.
- [ ] **Admin page (`#admin`)**: section header rows (title + refresh) wrap without clipping; no horizontal overflow.

#### Width: <= 680px (mobile)
- [ ] **Topbar** stacks as intended; nav links remain clickable.
- [ ] **Events**: participation buttons stack/fit without clipping; no horizontal scrolling in cards.
- [ ] **Manager**: manage controls are single-column and usable; no clipped buttons.
- [ ] **Admin**:
  - [ ] Audit panel header/actions remain visible.
  - [ ] Audit list scrolls **inside** the audit panel (scrollbar belongs to the list/panel, not the whole page).
  - [ ] Scrolling the audit list does not move the audit header off-screen within the panel.

### Regression intent
This phase relies on CSS/layout correctness. The automated test should lock in **structure hooks** (class names/ARIA labels) used by the CSS so future refactors don’t reintroduce UI-09/UI-10 regressions.


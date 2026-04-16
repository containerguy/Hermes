# Phase 07 Plan 07-01: UX Polish – UI Correctness Summary

Fixed UI-09/UI-10 regressions with CSS-first layout hardening and added a deterministic Vitest structure-contract regression test (JSDOM) to keep the required hooks stable.

## What Changed

- **UI-09 (button rows)**: hardened shrink + wrap behavior for `.action-row`, `.manage-row`, and `.admin-list-row` by allowing children to shrink (`min-width: 0`) and adjusting the manager grid to avoid non-shrinking `auto` columns. Manager controls switch to a 2-column grid at `<= 980px` with the datetime input spanning full width.
- **UI-10 (admin audit scroll containment)**: converted `.audit-panel` into a constrained 2-row grid at narrow widths and made `.audit-list` the scroll container (`overflow: auto`, `min-height: 0`, `overscroll-behavior: contain`) so the audit header/actions stay visible while the list scrolls within the panel.
- **Regression test**: added `src/client/components/ui-correctness.test.tsx` which renders `EventBoard` + `AdminPanel` under JSDOM with a mocked `requestJson` + stubbed `EventSource`, and asserts stable DOM hooks (`.action-row`, `.manage-row`, `.section-title-row`, `.audit-list`).

## Deviations from Plan

- **[Rule 3 - Blocking] Added `jsdom` as a dev dependency** because Vitest could not start the JSDOM environment without the `jsdom` package.

## Verification

- `npm test`
- `npm run build`

## Key Files

- `src/styles.css`
- `src/client/components/ui-correctness.test.tsx`
- `package.json`
- `package-lock.json`


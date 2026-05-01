## Phase 7: UX Polish – UI Correctness

### Goal
UI renders consistently desktop/mobile; action buttons don’t overflow/overlap/bleed frames; admin audit log scrolls inside its panel while header/actions remain accessible.

### Requirements
- UI-09: Buttons render correctly; no overflow/overlap/frame bleed across Events/Manager/Admin.
- UI-10: Admin audit log list scrolls within its panel (header/actions remain accessible).

### Constraints
- Keep stack minimal; **no major UI framework dependencies**.
- Prefer **CSS/layout fixes with minimal surface area** over component refactors.
- Avoid Playwright/E2E usage for this phase (the repo may keep existing e2e tooling, but Phase 7 validation stays Vitest-only); add **at least one deterministic automated regression** plus `npm run build`.

## Decisions
- D-01: Fix UI correctness issues **CSS-first** in `src/styles.css`, touching component markup only when CSS alone cannot express the contract.
- D-02: Preserve existing responsive breakpoints (`980px` and `680px`) and ensure fixes behave correctly at/around both.
- D-03: Add a small, deterministic **Vitest** regression targeting the affected UI structure (JSDOM render + assertions on DOM structure/classes/ARIA hooks), plus require `npm run build` in validation.

## Out of Scope
- Adding new design systems or UI frameworks.
- New feature work beyond UI-09/UI-10.

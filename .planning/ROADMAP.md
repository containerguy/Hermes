# Roadmap: Hermes

## Milestones

- ✅ **v1.0 Hermes v1 Release Hardening** — Phases 1–6 (shipped 2026-04-16). Archive: `.planning/milestones/v1.0-ROADMAP.md`

## Current Milestone: v1.1 UX Polish

### Scope (v1.1)

- UI-09 (buttons render correctly; no frame bleed)
- UI-10 (admin audit log scrollable within panel)
- EVT-04 (admin-only soft delete of archived/cancelled events; audit logged)

## Phases

- [x] **Phase 7: UX Polish – UI Correctness** - Fix UI correctness issues across Events/Manager/Admin (buttons + audit log panel scrolling).
- [x] **Phase 8: Admin Event Soft Delete** - Allow admins to soft-delete archived/cancelled events with audit logging and UI removal.

## Phase Details

### Phase 7: UX Polish – UI Correctness
**Goal**: The UI renders consistently on desktop/mobile, with correct button layout and a usable, scroll-contained admin audit log panel.
**Depends on**: Phase 6
**Requirements**: UI-09, UI-10
**Success Criteria** (what must be TRUE):
  1. Action buttons do not overflow/overlap/bleed their frames across Events, Manager, and Admin views on both desktop and mobile.
  2. The Admin audit log list scrolls within its panel on narrow screens while header/actions remain accessible.
  3. Changes do not introduce major new UI framework dependencies (keep the stack minimal).
**Plans**: `07-01`
**UI hint**: yes

### Phase 8: Admin Event Soft Delete
**Goal**: Admins can remove cancelled/archived events from the board via soft-delete, with clear guardrails and audit visibility.
**Depends on**: Phase 7
**Requirements**: EVT-04
**Success Criteria** (what must be TRUE):
  1. Only admins can soft-delete an event, and only when it is cancelled or archived (attempts otherwise fail clearly).
  2. A soft-deleted event no longer appears on the event board (for users/managers/admins).
  3. Each deletion is captured in the audit log with enough context to diagnose who deleted what and when.
**Plans**: `08-01`
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. UX Polish – UI Correctness | 1/1 | Complete | 2026-04-16 |
| 8. Admin Event Soft Delete | 1/1 | Complete | 2026-04-16 |

## Next

Next up:

- v1.1 complete

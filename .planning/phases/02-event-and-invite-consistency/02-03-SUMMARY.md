---
phase: 02-event-and-invite-consistency
plan: 03
subsystem: fullstack
tags: [sqlite, audit-log, sse, web-push, vitest, supertest, react]

# Dependency graph
requires:
  - phase: 02-event-and-invite-consistency
    plan: 02
    provides: Transactional event participation capacity enforcement (EVT-01).
provides:
  - Coherent post-commit side effects for participation success vs. capacity rejection (EVT-02)
  - Regression coverage ensuring cancel/archive and auto-archive still work after transactional join refactor (EVT-03)
  - Client UX for `event_voll`: "Spieler X von Y" + suggestion to start a new round (D-06)
affects:
  - Phase 04 (push reliability expectations)
  - Phase 06 (REL-01 focused API regression coverage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Commit-first, then emit side effects (audit/SSE/push) for capacity-sensitive writes"
    - "Operator-only push fanout for rejection notifications (admin/manager only)"

key-files:
  created:
    - src/server/http/event-side-effects.test.ts
  modified:
    - src/server/http/event-routes.ts
    - src/server/push/push-service.ts
    - src/main.tsx

key-decisions:
  - "Use `participation.set` audit action with `outcome: rejected` + `reason: event_voll` metadata for capacity losers (D-12)."
  - "Make participation audit best-effort post-commit to avoid turning side-effect failures into failed API responses (aligns with D-27)."
  - "Capture structured error bodies in the client via `ApiError` to preserve stable error codes while rendering richer UX copy (D-06, D-09)."

requirements-completed: [EVT-02, EVT-03]

# Metrics
duration: 6m
completed: 2026-04-16
---

# Phase 02 Plan 03: Event Side Effects Consistency Summary

**Participation updates now emit coherent post-commit side effects: winners broadcast + audit as before, while capacity losers get best-effort audit + operator-only push (no forced SSE), plus the UI renders a clear "Spieler X von Y" message on `event_voll`.**

## Performance

- **Duration:** 6m
- **Started:** 2026-04-16T12:47:01Z
- **Completed:** 2026-04-16T12:53:30Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Implemented capacity-rejection handling that logs a best-effort audit entry and triggers an operator-only push attempt, while explicitly avoiding any forced SSE broadcast on `409 event_voll`.
- Added integration regression coverage asserting the EVT-02 contract (audit + operator push + no extra SSE on rejection) and verifying EVT-03 lifecycle behavior (manual cancel + auto-archive).
- Improved the join UX for full events: `event_voll` now renders "Du wärst Spieler X von Y" and suggests starting a new round, without changing the stable error code.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement coherent side effects for success vs rejection** - `34bdbb4` (feat)
2. **Task 2: Add automated tests for EVT-02 side effects and EVT-03 lifecycle regression** - `ee9bd71` (test)
3. **Task 3: Implement event-full UX message 'Spieler X von Y' + suggestion** - `a5661d3` (feat)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - VAPID keys are optional and tests run without push configuration.

## Self-Check: PASSED

- Found `.planning/phases/02-event-and-invite-consistency/02-03-SUMMARY.md`
- Found task commits: `34bdbb4`, `ee9bd71`, `a5661d3`


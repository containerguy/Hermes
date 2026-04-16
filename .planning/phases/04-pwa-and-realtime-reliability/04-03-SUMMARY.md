---
phase: 04-pwa-and-realtime-reliability
plan: 04-03
subsystem: api
tags: [sse, realtime, eventsource, react, docs]

requires:
  - phase: 02-event-and-invite-consistency
    provides: events_changed broadcast + client polling fallback
provides:
  - SSE retry hints + heartbeat events
  - Client-side EventSource reconnect with backoff
affects: [realtime, ui, deployment-docs]

tech-stack:
  added: []
  patterns:
    - "SSE heartbeat: periodic lightweight event to reduce idle disconnects"
    - "Client reconnect: close/recreate EventSource with capped backoff"

key-files:
  created: []
  modified:
    - src/server/realtime/event-bus.ts
    - src/main.tsx
    - readme.md
    - building.md

key-decisions:
  - "Send heartbeat every ~25s and set SSE retry hint to 15s."
  - "Reconnect EventSource with backoff while keeping 30s polling fallback."

patterns-established:
  - "SSE connections are registered with per-client timers that are cleared on disconnect."

requirements-completed: [PWA-04]

duration: n/a
completed: 2026-04-16
---

# Phase 4 Plan 04-03: SSE heartbeat + reconnect Summary

**Realtime event updates now use SSE heartbeats + retry hints and a client reconnect loop to stay resilient across idle/proxy disconnects.**

## Performance

- **Duration:** n/a
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added server-side SSE heartbeat events and `retry` hint for reconnect behavior.
- Updated the client to reconnect `EventSource` on errors with backoff while keeping polling as a fallback.
- Documented proxy/timeout expectations for operators.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add server-side SSE retry + heartbeat and client reconnect loop** - `2c62d29` (feat)
2. **Task 2: Document heartbeat and proxy timeout expectations** - `2c62d29` (feat)

**Plan metadata:** `39f5b6b` (docs)

## Files Created/Modified
- `src/server/realtime/event-bus.ts` - Retry hint + heartbeat timer per client.
- `src/main.tsx` - Reconnect loop with capped backoff and heartbeat handler.
- `readme.md`, `building.md` - Operator guidance for SSE/proxy timeouts.

## Decisions Made
None - followed plan as specified.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 complete; ready to start Phase 5 modularization plans.

---
*Phase: 04-pwa-and-realtime-reliability*
*Completed: 2026-04-16*


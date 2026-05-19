---
phase: 14-pizza-ordering
plan: 03
subsystem: pizza
tags: [server, event-routes, integration-hook]
commit: 1248546
shipped: 2026-05-01
status: reverted-in-14-05
---

# 14-03: Auto-cancel order on dabei-revoke (later reverted)

Small integration hook in `event-routes.ts` so that when a guest changes their event participation to `nicht dabei` while a pizza session for that event is in the `open` state, their existing order is auto-cancelled. Goal: prevent phantom items from reaching the pizzeria call sheet.

## Files modified

- `src/server/http/event-routes.ts` — 12-line patch in the participation-update handler

## Behavior shipped

| Pizza session status | Guest changes participation to "nicht dabei" |
|----------------------|---------------------------------------------|
| `open` | Existing pizza order auto-deleted |
| `locked` | No-op (call sheet already out, manager reconciles manually) |
| `delivered` | No-op |
| no session for event | No-op |

## Why this was reverted in 14-05

The May-16 refactor (`3d1dadd`) made pizza sessions LAN-party-wide instead of per-event. With no `event_id` on the session, there is no longer a meaningful link between "guest revoked their dabei for event X" and "delete pizza order in session Y". Pizza orders are now coupled to the LAN, not to any particular game round, so this auto-cancel hook no longer makes sense and was removed.

The behavior is **gone from the codebase as of 14-05**. This file remains as historical context — readers tracing the May 1 → May 16 evolution of the participation handler will find the removed hook documented here.

## No tests added

The hook was small and had no dedicated test. Its removal in 14-05 also did not add tests.

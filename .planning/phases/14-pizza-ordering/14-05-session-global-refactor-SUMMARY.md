---
phase: 14-pizza-ordering
plan: 05
subsystem: pizza
tags: [refactor, schema-migration, json-editor, scope-decision]
commit: 3d1dadd
shipped: 2026-05-16
---

# 14-05: LAN-wide session refactor + JSON menu editor

Reframes pizza ordering from per-event to LAN-party-wide. Drops `event_id` from `pizza_sessions`, moves the panel from inside the event-detail expansion to the start page above `EventBoard`, removes the dabei-gate, deletes the inline menu CRUD form, and ships a JSON import/export menu editor in its place. Removes the 14-03 auto-cancel-on-revoke hook (no longer meaningful with LAN-wide sessions).

## Files created

- `src/server/db/migrations/0018_pizza_session_global.sql` — drops `event_id` from `pizza_sessions`, makes it a single global session admins/managers open and close manually
- `src/client/pizza/PizzaMenuJsonAdmin.tsx` (131 lines) — JSON paste/upload editor; the server upserts items + variants, deactivates items missing from the JSON, removes orphan variants not referenced by any order line

## Files removed

- `src/client/pizza/PizzaMenuAdmin.tsx` (359 lines) — superseded by the JSON editor

## Files modified

- `src/server/db/schema.ts` — `pizza_sessions.event_id` removed from Drizzle schema
- `src/server/domain/pizza/sessions.ts` — session lookup no longer takes an event id; single-row "current global session" semantics
- `src/server/domain/pizza/orders.ts` — dabei-gate removed (anyone logged in can order while session is open)
- `src/server/http/event-routes.ts` — 14-03's auto-cancel-on-revoke hook removed
- `src/client/components/EventBoard.tsx` — `<PizzaPanel>` no longer mounted inside the event detail
- `src/client/components/AdminPanel.tsx` — uses `<PizzaMenuJsonAdmin>` in place of `<PizzaMenuAdmin>`
- `src/client/pizza/PizzaPanel.tsx` — adapted to LAN-wide session; reduced from 587 lines toward present size
- `src/client/pizza/api.ts` — endpoint paths drop `/events/:eventId` prefix
- `src/client/pizza/types.ts` — session type no longer carries `eventId`
- `src/main.tsx` — mounts pizza panel above the event board on the start page

## Endpoint surface after this refactor

| Method | Path | Audience |
|--------|------|----------|
| GET | `/api/pizza/session` | any logged-in user |
| POST | `/api/pizza/session` | manager (open) |
| PATCH | `/api/pizza/session` | manager (lock / mark delivered) |
| GET | `/api/pizza/menu` | any logged-in user |
| POST | `/api/pizza/orders` | any logged-in user (no dabei-gate) |
| PATCH | `/api/pizza/orders/:orderId` | order owner |
| DELETE | `/api/pizza/orders/:orderId` | order owner or manager |
| GET | `/api/pizza/print/pizzeria` | manager |
| GET | `/api/pizza/print/kassenliste` | manager |
| GET | `/api/pizza/admin/menu` | admin |
| POST | `/api/pizza/admin/menu` | admin (JSON upsert) |

## Why LAN-wide instead of per-event

Pizza demand at a LAN party correlates with the evening as a whole, not with which game round happens to be active when someone orders. Per-event sessions led to confusing UI ("which event's session do I order against?") and required managers to open one session per event. LAN-wide sessions match the operator workflow: one session per evening, opened by a manager when the order window starts, locked when the pizzeria call goes out.

## Why JSON editor instead of inline CRUD

See `14-04-admin-and-pdf-tests-SUMMARY.md` for the rationale; the JSON editor's diff-based upsert (deactivate-missing + remove-orphan-variants) is the operational shape an admin actually wants when the entire menu is ~85 items long.

## No new tests added

The refactor was schema- and routing-driven; existing domain-pizza unit tests still pass against the LAN-wide model because the dabei-gate was an HTTP-route check, not a domain invariant.

## Cleanup left behind

- `PizzaPanel.tsx` still ~559 lines (was 587). Further decomposition is candidate for the broader frontend cleanup pass.
- No automated test enforces "session is global / there is only one"; relies on the application logic and the migration's drop of `event_id`.

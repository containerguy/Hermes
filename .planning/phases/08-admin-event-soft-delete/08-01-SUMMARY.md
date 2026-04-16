# Phase 08 Plan 08-01: Admin Event Soft Delete Summary

Implemented EVT-04 by adding an admin-only soft-delete for `cancelled`/`archived` events, excluding soft-deleted events from the event board for all roles, and recording each deletion in the audit log with safe metadata.

## What Changed

- **DB**: added `game_events.deleted_at` + `game_events.deleted_by_user_id` (migration `0009_event_soft_delete.sql`) and surfaced them in `src/server/db/schema.ts`.
- **Backend**:
  - added `DELETE /api/admin/events/:id` (admin + CSRF) which only soft-deletes when status is `cancelled` or `archived`, writes `audit_logs` with action `event.soft_delete`, and broadcasts `events_changed`.
  - updated `GET /api/events` to exclude soft-deleted events and ensured per-event mutations treat soft-deleted events as `404`.
- **UI**: added an admin-only **Löschen** action on `EventBoard` for `cancelled`/`archived` events that calls the admin endpoint and refreshes the board.
- **Tests**: added coverage for authorization, guardrails, visibility, and audit metadata redaction.

## Verification

- `npm test`
- `npm run build`

## Key Files

- `src/server/db/migrations/0009_event_soft_delete.sql`
- `src/server/db/schema.ts`
- `src/server/http/admin-routes.ts`
- `src/server/http/event-routes.ts`
- `src/client/components/EventBoard.tsx`
- `src/server/http/event-soft-delete.test.ts`


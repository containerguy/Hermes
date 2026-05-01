# Phase 08: Admin Event Soft Delete — Context

## Goal

Allow **admins** to soft-delete events **only** when they are `archived` or `cancelled`, record the deletion in the audit log (safe metadata), and ensure soft-deleted events do **not** appear on the event board for any role.

## Existing System Notes

- **DB table**: `game_events` has `status` (`open|ready|running|cancelled|archived`) and lifecycle timestamps (`cancelled_at`, `archived_at`) but no deletion marker yet.
- **Event listing**: `GET /api/events` currently returns all rows ordered by `starts_at`.
- **Admin routing**: `/api/admin/*` enforces authentication, `admin` role, and CSRF for mutations; audit logging uses `tryWriteAuditLog`.

## Requirement

- **EVT-04**: Admins can soft-delete events only after cancel/archive; deletion removes event from board and is captured in audit log.

## Intended Shape

- **Soft delete semantics**: event row remains in DB for historical/audit, but is excluded from listing endpoints that feed the UI board.
- **Audit log**: record `event.soft_delete` with safe metadata (no secrets / no connection details).


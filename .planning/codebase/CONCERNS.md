# Concerns

## Summary

Hermes is a compact single-instance app with most behavior concentrated in route handlers and one large React entry file. The highest-risk areas for future planning are OTP/session abuse controls, destructive S3 restore behavior, snapshot consistency, invite-code exposure, operational TLS/proxy assumptions, and limited end-to-end coverage.

## Authentication And Sessions

- `src/server/http/auth-routes.ts` accepts username-only login-code requests and returns `404` for unknown users. This makes user enumeration straightforward and there is no rate limit, lockout, IP/device throttling, or per-user challenge cap around `/api/auth/request-code` or `/api/auth/verify-code`.
- `src/server/http/auth-routes.ts` leaves unconsumed `login_challenges` rows in place until expiry, but `src/server/db/schema.ts` and `src/server/db/migrations/0001_initial.sql` do not define cleanup jobs or indexes for active challenge lookup by username/expiry. A busy or abused instance can accumulate stale challenge rows.
- `src/server/auth/sessions.ts` stores session tokens directly as primary keys in `sessions`. A database snapshot leak would expose live bearer tokens. There is no token hashing layer, absolute expiry enforcement, idle timeout enforcement, or session rotation after role changes.
- `src/server/auth/sessions.ts` only sets `secure` when `HERMES_COOKIE_SECURE=true`. `.env.example` defaults this to false. This is useful locally, but production behind TLS needs explicit configuration or session cookies can travel over HTTP.
- `src/server/auth/sessions.ts` uses `sameSite: "lax"` and the API has no CSRF token. Most JSON mutating requests are less exposed than form posts, but cookie-authenticated endpoints such as `POST /api/admin/restore`, `POST /api/events`, and `DELETE /api/auth/sessions/:id` still rely on browser behavior instead of an app-level CSRF defense.
- `src/server/auth/current-user.ts` updates `lastSeenAt` on every authenticated request. This creates a write for reads, which can increase SQLite write contention and S3 snapshot scheduling frequency once traffic grows.
- `src/server/mail/mailer.ts` logs one-time codes in console mode. `HERMES_MAIL_MODE=console` is intended for development, but accidental production use would put login codes in container logs.

## Invite Registration

- `src/server/http/auth-routes.ts` registers users from invite codes without throttling invite attempts. Invite codes are normalized but can be brute-forced if public registration is enabled and code entropy is weak or admins choose short custom codes.
- `src/server/http/admin-routes.ts` returns full invite codes from `GET /api/admin/invite-codes` and writes invite code values into audit metadata on create/revoke. This is admin-only, but it means audit and admin UI surfaces contain reusable registration secrets.
- `src/server/http/auth-routes.ts` checks invite uses by loading all matching `invite_code_uses` rows and comparing `uses.length`. This is acceptable for small LAN usage, but it is not atomic with the subsequent insert. Concurrent registrations against a limited invite can oversubscribe `maxUses`.
- `src/server/db/schema.ts` has `invite_code_uses_user_unique`, so a deleted user that used an invite still consumes a permanent invite-use row unless the user is hard-deleted by cascade. The current soft-delete flow in `src/server/http/admin-routes.ts` keeps the historical row, which may be desired for audit but should be explicit in planning.

## S3 Snapshot Storage And Restore

- `src/server/storage/s3-storage.ts` treats S3 as whole-file SQLite snapshot storage. `README.md` and `building.md` correctly document that this is not multi-instance safe, but there is no runtime guard preventing multiple Hermes instances from writing the same `HERMES_S3_DB_KEY`.
- `src/server/storage/s3-storage.ts` uploads snapshots after writes with a one-second debounce. Crashes, process kills, network failures, or S3 upload errors can leave the bucket behind the local SQLite state. Errors are logged but not surfaced to admins unless they happen during explicit backup/restore.
- `src/server/storage/s3-storage.ts` calls `wal_checkpoint(TRUNCATE)` and uploads only the main SQLite file. This is a reasonable approach, but it makes snapshot correctness dependent on successful checkpointing and single-process control of the database file.
- `src/server/storage/s3-storage.ts` `restoreDatabaseSnapshotIntoLive` disables foreign keys, deletes/restores tables, then runs `PRAGMA foreign_key_check;` without reading result rows or throwing on violations. A corrupt or incompatible snapshot could restore partially inconsistent data and still report success.
- `src/server/storage/s3-storage.ts` restores table data via `INSERT INTO table SELECT * FROM sourceTable`, which depends on identical column order. Future migrations that reorder/add columns can make restore fragile across versions.
- `src/server/http/admin-routes.ts` exposes `POST /api/admin/restore` as an immediate destructive operation. The frontend confirms with `window.confirm` in `src/main.tsx`, but there is no typed confirmation phrase, dry-run, pre-restore local backup, maintenance mode, or active-session invalidation after restore.
- `src/server/http/admin-routes.ts` writes the restore audit log after replacing live tables but omits `actor`, so restored audit entries record no actor for `storage.restore`. If the restore replaces `sessions` or `users`, the admin session may also become invalid while the request is still completing.
- `src/server/storage/s3-storage.ts` has a fixed `restorableTables` list. New tables must be added manually or they silently do not participate in live restore.

## Audit Logs

- `src/server/audit-log.ts` stores arbitrary metadata as JSON text and `src/server/http/admin-routes.ts` includes email addresses, invite codes, and settings deltas in metadata. This is useful operationally but creates a privacy-sensitive log store with no retention policy or redaction layer.
- `src/server/audit-log.ts` has no write error isolation. A failed audit insert during a user/event/admin flow can fail the request path because callers do not catch audit-write errors.
- `src/server/audit-log.ts` parses metadata on read without a fallback. A malformed row can break `GET /api/admin/audit-log` for admins.
- `src/server/http/admin-routes.ts` allows `limit` to be any numeric string but clamps only inside `listAuditLogs`; invalid input such as `abc` becomes `NaN`, then `Math.min(NaN, 500)` can produce a non-useful limit path. This is minor but easy to harden.

## Push Notifications And Realtime

- `src/server/push/push-service.ts` sends to all notification-enabled users for event creation and status changes, including the actor. There is no per-event participant filtering, quiet hours, rate limit, or batching beyond `Promise.all`.
- `src/server/push/push-service.ts` logs delivery errors but only revokes subscriptions on 404/410. Other repeated failures can keep noisy bad subscriptions active indefinitely.
- `src/server/http/push-routes.ts` allows a subscription endpoint to be reassigned to the current user on conflict. That matches browser endpoint uniqueness, but a stolen endpoint/key payload could overwrite ownership because there is no binding beyond authenticated submission.
- `public/sw.js` assumes `event.data.json()` succeeds. A malformed push payload can throw in the service worker and skip notification display.
- `src/server/realtime/event-bus.ts` keeps SSE clients in memory and does not send heartbeat comments. Proxies may close idle connections, and dead response objects are only removed when the request emits `close`.

## Event And Data Consistency

- `src/server/http/event-routes.ts` capacity enforcement reads `countJoined` before upserting participation. Concurrent joins can pass the capacity check and overfill an event because the count check and insert are not protected by a transaction or constraint.
- `src/server/http/event-routes.ts` serializes each event by querying creator, joined count, and current-user participation separately. `GET /api/events` is an N+1 path that will degrade as event history grows.
- `src/server/http/event-routes.ts` refreshes statuses on list requests and every 30 seconds in `src/server/app.ts`. This spreads lifecycle mutation across reads and a timer, which can make tests and operational reasoning around status changes less deterministic.
- `src/server/domain/events.ts` treats any event whose `startsAt` is in the past as `running`, regardless of joined count. This may be intentional, but planning should verify whether underfilled scheduled events should become running, remain open, or auto-cancel.

## Database Migrations

- `src/server/db/migrations/0004_invites_and_deleted_users.sql` uses `ALTER TABLE users ADD COLUMN deleted_at TEXT` without `IF NOT EXISTS`. The custom migration table prevents normal re-run, but partial/manual migration recovery can fail on this statement.
- `src/server/db/migrate.ts` executes raw SQL files in filename order and records only filenames. There is no checksum, dirty-state marker, rollback strategy, or migration drift detection.
- `src/server/db/migrate.ts` and `src/server/db/bootstrap-admin.ts` both restore from S3 before migration. If a newer app boots against an older snapshot, migrations run locally and then persist the upgraded file, but live admin restore can still import older table shapes later.
- `src/server/db/schema.ts` and SQL migrations must be kept manually aligned. There is no generated migration verification in CI beyond tests/build.

## Frontend Monolith

- `src/main.tsx` is 1,727 lines and contains routing, API client, event board, login/profile, push subscription, admin user management, invites, audit logs, backup/restore, and theme handling. This makes isolated changes risky and increases the chance of cross-panel regressions.
- `src/main.tsx` maintains several independent local states that are refreshed manually after mutations. There is no shared cache or server-state abstraction, so stale UI after failed partial operations is a recurring risk.
- `src/main.tsx` uses hash routing and manual role gating in the UI. Backend authorization is present in route handlers, but frontend visibility logic should not be treated as a security boundary.
- `src/styles.css` is 854 lines of global CSS. Theme variables are runtime-controlled by admin settings; color validation in `src/server/settings.ts` prevents arbitrary CSS strings, but visual regressions remain hard to localize.

## Operational And Deployment Risks

- `Dockerfile` runs the Node process as root in the runtime image. A non-root user would reduce container blast radius.
- `docker-compose.yml` bind-mounts `./s3.creds` and forces S3 settings. Local starts without this file will fail when compose is used, and there is no documented non-S3 compose profile.
- `src/server/app.ts` does not include security headers such as HSTS, CSP, or frame protections. A reverse proxy can add these, but the app itself does not.
- `src/server/index.ts` shutdown waits for `server.close`, then flushes S3. If active long-lived SSE connections remain open, shutdown can be delayed; there is no forced timeout.
- `README.md` documents that Hermes does not provide TLS/reverse proxy/certificate management, while push notifications require a secure context for LAN devices. Production deployment needs an explicit reverse-proxy/TLS plan.

## Tests And CI Limitations

- `src/server/http/app-flow.test.ts` covers the primary happy path, invites, sessions, capacity, settings, backup endpoint, and audit presence, but it does not exercise abuse controls, CSRF, restore correctness, concurrent joins/invite registration, or SMTP failure modes deeply.
- `src/server/storage/s3-storage.test.ts` tests credential parsing only. Snapshot upload/download, live restore, schema mismatch, foreign-key violation, and S3 error behavior are not covered.
- `e2e/hermes-flow.spec.ts` covers one browser flow with Chromium desktop settings. It does not cover mobile/PWA install behavior, push permission flows, service worker notification clicks, restore UI, audit UI, or negative auth paths.
- `.github/workflows/docker-image.yml` runs `npm test`, `npm run build`, `npm audit --omit=dev`, and a Docker build. It does not run Playwright E2E, dependency license checks, container scanning, or migration/restore compatibility tests.

## Documentation Gaps

- `README.md` and `building.md` document S3 snapshot semantics and single-instance limitations well, but they do not provide a recovery runbook for failed restore, corrupted snapshot, or rolling back to a previous local/S3 backup.
- `README.md` mentions admins should verify data after restore, but the product does not guide the operator through those checks.
- `.env.example` includes production-looking S3 defaults and `HERMES_COOKIE_SECURE=false`; deployment docs should explicitly call out production overrides for cookie security, TLS, SMTP mode, and secret handling.

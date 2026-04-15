# Hermes Architecture

## Overview

Hermes is a single-repo TypeScript application with a React/Vite browser client and an Express server. The production server serves the built client from `dist/` and exposes JSON/SSE APIs under `/api/*` from the bundled Node entrypoint `dist-server/index.js`.

Primary runtime paths:

- Browser UI starts at `src/main.tsx` and imports global styling from `src/styles.css`.
- Server startup is `src/server/index.ts`, which calls `createHermesApp()` from `src/server/app.ts`.
- Database access is centralized through `src/server/db/client.ts` and schema definitions in `src/server/db/schema.ts`.
- API behavior is split by concern under `src/server/http/*`.
- Domain validation and authorization helpers live under `src/server/domain/*`.
- Static PWA/push assets live in `public/sw.js`, `public/manifest.webmanifest`, and `public/icon.svg`.

## Runtime Composition

`src/server/app.ts` is the application composition root:

- Restores a SQLite snapshot from S3 when configured via `restoreDatabaseFromStorageIfNeeded()`.
- Creates a `DatabaseContext` using `createDb()` from `src/server/db/client.ts`.
- Applies SQL migrations through `runMigrations()` from `src/server/db/migrate.ts`.
- Configures Express JSON parsing, cookie parsing, health/settings endpoints, and all API routers.
- Schedules S3 database snapshots after successful non-read API responses.
- Runs a 30-second status refresh loop via `refreshEventStatuses()` and broadcasts realtime changes through `broadcastEventsChanged()`.
- Serves built frontend files from `dist/` when that directory exists, falling back to `dist/index.html` for non-API routes.
- Exposes `close()` to flush snapshots and close SQLite cleanly.

`src/server/index.ts` is intentionally thin. It reads `HERMES_PORT` and `HERMES_HOST`, starts the Express app, and handles `SIGINT`/`SIGTERM` by closing the HTTP server and then calling the app `close()` hook.

## Client Architecture

The browser app is a single React file in `src/main.tsx`. It uses hash routing rather than a router package. The route definitions are local to the file and map to `#events`, `#login`, `#manager`, and `#admin`.

Important client responsibilities:

- `requestJson()` wraps `fetch()` with `credentials: "include"` so cookie sessions work across API calls.
- `App()` owns top-level state for the current route, logged-in user, and settings.
- `EventBoard()` loads `/api/events`, opens an `EventSource` to `/api/realtime/events`, falls back to 30-second polling, creates events in manager mode, updates event start times, cancels/archives events, and manages participation.
- `LoginPanel()` handles email OTP login, invite registration, logout, session revocation, and Web Push subscription setup.
- `AdminPanel()` handles user management, invite codes, audit log display, settings updates, and backup/restore actions.
- `applyTheme()` maps server-managed settings to CSS custom properties used by `src/styles.css`.

There is no client-side state library. Server responses are treated as the source of truth and components reload their relevant collections after mutations.

## API Layer

API routes are mounted in `src/server/app.ts`:

- `/api/health` returns basic liveness.
- `/api/settings` returns public settings from `src/server/settings.ts`.
- `/api/auth` is implemented by `src/server/http/auth-routes.ts`.
- `/api/admin` is implemented by `src/server/http/admin-routes.ts`.
- `/api/events` is implemented by `src/server/http/event-routes.ts`.
- `/api/push` is implemented by `src/server/http/push-routes.ts`.
- `/api/realtime` is implemented by `src/server/http/realtime-routes.ts`.

The route modules own request validation with Zod, database writes, audit logging, and response serialization. They call small shared helpers for cross-cutting behavior rather than using a service layer.

## Authentication And Authorization

Authentication is session-cookie based:

- `src/server/auth/sessions.ts` creates base64url session tokens, sets/clears the `hermes_session` cookie, and honors `HERMES_COOKIE_SECURE`.
- `src/server/auth/otp.ts` generates six-digit one-time codes and stores/verifies scrypt hashes.
- `src/server/auth/current-user.ts` resolves the current session from the cookie, joins `sessions` to `users`, rejects revoked sessions/deleted users, updates `lastSeenAt`, and exposes `requireUser()`/`requireAdmin()`.
- `src/server/http/auth-routes.ts` creates login challenges, sends email codes, verifies codes, creates sessions, lists sessions, revokes sessions, logs out, and supports invite-based registration when settings allow it.

Authorization is role based:

- Roles are `user`, `manager`, and `admin` in `src/server/domain/users.ts`.
- Managers and admins can create events through `canCreateEvent()`.
- Admins, managers, and event creators can manage an event through `canManageEvent()`.
- Admin APIs enforce admin access in `src/server/http/admin-routes.ts` before route handlers run.

## Event Domain

Event rules live mostly in `src/server/domain/events.ts`:

- `eventInputSchema` validates event title, start mode, optional scheduled start time, min/max players, and optional connection fields.
- `deriveEventStatus()` maps an event to `open`, `ready`, or `running` unless already `cancelled` or `archived`.
- `shouldAutoArchive()` archives events after the configured hour window.

`src/server/http/event-routes.ts` applies those rules to API behavior:

- `GET /api/events` refreshes statuses and serializes events with creator name, joined count, and current user's participation.
- `POST /api/events` creates events for managers/admins, writes an audit log, broadcasts SSE updates, and sends push notifications.
- `PATCH /api/events/:id` lets authorized users update active event metadata and start time.
- `POST /api/events/:id/participation` upserts joined/declined participation, enforces max capacity, recalculates status, broadcasts realtime updates, and sends push when status changes.
- `POST /api/events/:id/cancel` and `/archive` mark terminal states, audit them, broadcast, and notify.

## Persistence

The database is SQLite through `better-sqlite3` with Drizzle query builders:

- `src/server/db/client.ts` creates the SQLite file directory, opens the database, enables WAL mode and foreign keys, and returns `{ sqlite, db }`.
- The database path comes from `getDatabasePath()` in `src/server/env.ts`, defaulting to `data/hermes.sqlite`.
- `src/server/db/schema.ts` defines tables for users, login challenges, sessions, push subscriptions, game events, participations, app settings, audit logs, invite codes, and invite code uses.
- SQL migrations are stored in `src/server/db/migrations/*.sql`.
- `src/server/db/migrate.ts` tracks applied migration filenames in `schema_migrations` and can run as a CLI entrypoint.
- `src/server/db/bootstrap-admin.ts` is bundled as a separate server utility and used by tests to create the initial admin.

The code mixes Drizzle query builders with direct `better-sqlite3` statements where aggregate counts or restore operations are simpler.

## Settings And Audit Log

`src/server/settings.ts` stores mutable settings in the `app_settings` table as JSON values keyed by setting name. `settingsSchema` validates application name, notification defaults, auto-archive window, public registration, and theme colors. Missing settings are filled from `defaultSettings`.

`src/server/audit-log.ts` writes structured audit entries with actor metadata, action, entity type/id, summary, optional JSON metadata, and timestamp. Admin routes expose recent audit logs with parsed metadata.

## Mail, Push, And Realtime

Email login codes are sent by `src/server/mail/mailer.ts`:

- Console mode is the default and logs the code for local/dev use.
- SMTP mode reads host, port, user/password, sender, and TLS/STARTTLS settings from environment variables.

Web Push is split between client, server, and service worker:

- The client registers `public/sw.js`, requests notification permission, subscribes with the VAPID public key, and posts the subscription to `/api/push/subscriptions`.
- `src/server/http/push-routes.ts` exposes the VAPID public key, upserts/revokes subscriptions, and updates user notification preferences.
- `src/server/push/push-service.ts` configures `web-push`, sends payloads to active subscriptions for notification-enabled users, and revokes subscriptions that return 404/410.
- `public/sw.js` displays push notifications and focuses or opens the target URL on click.

Realtime event updates use server-sent events:

- `src/server/realtime/event-bus.ts` maintains in-memory Express `Response` clients and emits `connected` and `events_changed` events.
- `src/server/http/realtime-routes.ts` exposes authenticated `/api/realtime/events`.
- `src/main.tsx` listens via `EventSource` and reloads events on change, with polling as a fallback.

## Backup And Restore

`src/server/storage/s3-storage.ts` implements optional S3-compatible SQLite snapshot storage:

- Enabled when `HERMES_STORAGE_BACKEND=s3`.
- Restore can run at app start through `restoreDatabaseFromStorageIfNeeded()`.
- Mutating API responses schedule a debounced snapshot upload via `scheduleDatabaseSnapshot()`.
- Shutdown and migration paths flush/persist snapshots explicitly.
- Admin backup and restore endpoints call `persistDatabaseSnapshot()` and `restoreDatabaseSnapshotIntoLive()`.
- The restore path attaches the downloaded SQLite database and copies known restorable tables into the live database with foreign keys temporarily disabled.

Do not place credential values in planning docs. The code reads credentials from environment variables or an optional credentials file path.

## Build, Deployment, And Scripts

`package.json` scripts define the main workflows:

- `npm run dev` starts Vite on port 5173.
- `npm run server` runs `src/server/index.ts` with `tsx`.
- `npm run build` type-checks, builds the Vite client, and builds server bundles.
- `npm run build:server` uses `esbuild` to bundle `src/server/index.ts` and `src/server/db/bootstrap-admin.ts` into `dist-server/`, then copies migrations into both `dist-server/migrations/` and `dist-server/db/migrations/`.
- `npm run start` runs `node dist-server/index.js`.
- `npm run test` runs Vitest tests under `src`.
- `npm run test:e2e` builds and runs Playwright tests.

`Dockerfile` uses a Node 22 build stage, prunes dev dependencies, and runs the production server with `/data/hermes.sqlite` as the default DB path. `docker-compose.yml` builds the local image, maps port 3000, mounts a named `/data` volume, and configures S3-compatible storage via environment variables and a mounted credentials file path.

## Testing Architecture

Tests are split by scope:

- Unit tests cover OTP hashing in `src/server/auth/otp.test.ts`.
- Domain tests cover event validation/status rules in `src/server/domain/events.test.ts`.
- Storage tests cover S3 credential parsing in `src/server/storage/s3-storage.test.ts`.
- HTTP integration tests in `src/server/http/app-flow.test.ts` exercise login, admin role management, event creation, and capacity enforcement.
- Playwright E2E in `e2e/hermes-flow.spec.ts` starts the real app on a temporary SQLite file, bootstraps an admin, logs in multiple users, and verifies the admin/manager/user flow in the browser.

## Architectural Constraints And Planning Notes

- `src/main.tsx` is large and owns many UI concerns. Feature work that expands client complexity may benefit from extracting API helpers or component files, but current behavior assumes local component state and explicit reloads after mutations.
- API route modules currently combine validation, authorization, persistence, audit logging, notifications, and serialization. Future cross-route behavior should be factored only when repeated behavior is concrete.
- Realtime clients are in-memory. This is fine for a single Node process but will not broadcast across multiple server replicas without an external pub/sub layer.
- SQLite plus file-level S3 snapshots imply a single-writer/simple-deployment model. Multi-instance deployments need a different persistence strategy or strict writer coordination.
- Settings and theme values are runtime database state, so UI changes should account for server-provided CSS custom property values.
- Session IDs are stored directly as session primary keys and cookie tokens. Treat database and cookie access as sensitive even though token values are not logged in these docs.

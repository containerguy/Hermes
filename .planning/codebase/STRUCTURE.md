# Hermes Structure

## Repository Root

- `package.json` defines scripts, runtime dependencies, dev dependencies, and ESM module mode.
- `package-lock.json` pins npm dependency versions.
- `index.html` is the Vite HTML entrypoint for the React app.
- `vite.config.ts` configures React/Vite and fixed dev/preview ports.
- `tsconfig.json` enables strict TypeScript, ES2022 target, DOM types, bundler module resolution, and no emit.
- `playwright.config.ts` configures E2E tests in `e2e/`.
- `Dockerfile` builds the app and produces a production Node runtime image.
- `docker-compose.yml` runs the local container, mounts `/data`, exposes port 3000, and wires S3-related environment names.
- `.env.example` documents expected environment variables without runtime secrets.
- `README.md`, `building.md`, and `ideas.md` are project documentation/notes.

## Frontend Files

- `src/main.tsx` contains all React UI, type definitions for API payloads, hash route definitions, fetch helpers, theme application, event board, login/registration/session UI, admin UI, and the root `App()` component.
- `src/styles.css` contains global styles, CSS custom properties, layout rules, responsive behavior, form/button/card styling, status colors, and route-specific visual treatment.

The frontend has no `src/components/`, `src/lib/`, or generated API client directory. API contracts are duplicated as TypeScript types inside `src/main.tsx`.

## Public Assets

- `public/sw.js` is the service worker for Web Push install/activate, push notification display, and notification click navigation.
- `public/manifest.webmanifest` defines the installable PWA metadata and icon reference.
- `public/icon.svg` is used by the UI, manifest, and notifications.

Vite copies `public/*` assets to the built client output.

## Server Entrypoints

- `src/server/index.ts` is the Node runtime entrypoint. It starts the app on `HERMES_HOST`/`HERMES_PORT` and handles shutdown.
- `src/server/app.ts` is the Express composition root. It restores storage, creates the DB context, runs migrations, installs middleware/routes, schedules snapshots, starts event status refresh, and serves static production assets.

## Server HTTP Layer

- `src/server/http/auth-routes.ts` implements `/api/auth` routes for requesting login codes, invite registration, verifying codes, reading current user, listing/revoking sessions, and logout.
- `src/server/http/admin-routes.ts` implements `/api/admin` routes for active users, audit logs, user create/update/delete, app settings, invite codes, backup, and restore.
- `src/server/http/event-routes.ts` implements `/api/events` routes for listing events, creating events, updating event starts/metadata, setting participation, cancelling events, archiving events, and periodic status refresh.
- `src/server/http/push-routes.ts` implements `/api/push` routes for VAPID public key lookup, subscription upsert/revoke, and notification preference updates.
- `src/server/http/realtime-routes.ts` implements `/api/realtime/events` as an authenticated server-sent events endpoint.
- `src/server/http/app-flow.test.ts` is an integration test for API-level app flows.

The HTTP layer imports Drizzle schema objects directly and usually performs persistence inside the route file.

## Authentication Modules

- `src/server/auth/current-user.ts` reads the session cookie, resolves session/user rows, rejects revoked/deleted identities, updates session activity, and exposes public user serialization plus `requireUser()`/`requireAdmin()`.
- `src/server/auth/sessions.ts` defines the `hermes_session` cookie name, token generation, max age, and cookie set/clear options.
- `src/server/auth/otp.ts` generates six-digit OTPs, hashes them with scrypt, and verifies submitted codes.
- `src/server/auth/otp.test.ts` covers OTP generation and verification.

## Database Modules

- `src/server/db/client.ts` creates the SQLite directory/file, enables WAL and foreign keys, and wraps the connection with Drizzle.
- `src/server/db/schema.ts` defines all Drizzle table schemas and selected relations.
- `src/server/db/migrate.ts` applies SQL migration files and can run as a CLI.
- `src/server/db/bootstrap-admin.ts` creates or updates the initial admin user from environment-provided values.
- `src/server/db/migrations/0001_initial.sql` creates the initial tables.
- `src/server/db/migrations/0002_unique_username.sql` adds username uniqueness.
- `src/server/db/migrations/0003_audit_logs.sql` adds audit logging.
- `src/server/db/migrations/0004_invites_and_deleted_users.sql` adds invite codes and deleted-user support.

Core tables in `src/server/db/schema.ts`:

- `users`
- `login_challenges`
- `sessions`
- `push_subscriptions`
- `game_events`
- `participations`
- `app_settings`
- `audit_logs`
- `invite_codes`
- `invite_code_uses`

## Domain Modules

- `src/server/domain/events.ts` defines event-related Zod schemas, TypeScript types, status derivation, and auto-archive logic.
- `src/server/domain/events.test.ts` tests event input validation, status derivation, and auto-archive behavior.
- `src/server/domain/users.ts` defines role schema/types and permission helpers for event creation/management and role assignment.

These files are pure or near-pure helpers and are the safest place to extend core business rules before wiring them into routes.

## Cross-Cutting Server Modules

- `src/server/settings.ts` validates, reads, and writes app settings in `app_settings`.
- `src/server/audit-log.ts` writes audit log rows and lists recent audit logs with parsed metadata.
- `src/server/env.ts` loads a local `.env` file, resolves the SQLite path, and reads required environment variables.
- `src/server/mail/mailer.ts` sends login codes either to console or through SMTP.
- `src/server/push/push-service.ts` configures Web Push and sends notifications to active subscriptions.
- `src/server/realtime/event-bus.ts` tracks in-memory SSE clients and broadcasts event-change notifications.
- `src/server/storage/s3-storage.ts` implements optional S3-compatible SQLite snapshot restore, upload, scheduled flush, live restore, and credential file parsing.
- `src/server/storage/s3-storage.test.ts` tests supported S3 credential file formats.

## Test Directories

- `src/server/**/*.test.ts` contains Vitest unit and integration tests colocated with server modules.
- `e2e/hermes-flow.spec.ts` contains Playwright browser flow coverage for admin setup, user creation, manager event creation, and user participation.

## Build Outputs And Runtime Data

These paths are produced or used at runtime and should generally not be edited directly:

- `dist/` is the Vite client build output served by `src/server/app.ts` in production.
- `dist-server/` is the bundled server output produced by `npm run build:server`.
- `data/hermes.sqlite` is the default local SQLite database path when `HERMES_DB_PATH` is not set.
- `data/hermes.sqlite-wal` and `data/hermes.sqlite-shm` may be created by SQLite WAL mode.
- `/data/hermes.sqlite` is the default database path inside the Docker runtime image.

## Planning Directory

- `.planning/codebase/ARCHITECTURE.md` documents high-level architecture and runtime flows.
- `.planning/codebase/STRUCTURE.md` documents repository layout and file responsibilities.

Other workers may write additional `.planning/codebase` documents in parallel. Avoid rewriting unrelated files in `.planning/`.

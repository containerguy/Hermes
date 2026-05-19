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

The browser app uses hash routing (no router package). Route map: `#events`, `#login`, `#manager`, `#admin`, `#infos`, `#kiosk`. Legacy hash redirects are handled in `src/main.tsx` via `legacyAdminHashToSection`.

Top-level composition (`src/main.tsx`):

- `App()` owns route/user/settings state and renders the page component for the current hash.
- Wraps the tree in `BrandingContext` (`src/client/lib/BrandingContext.tsx`) and `I18nContext` (`src/client/i18n/I18nContext.tsx`).
- Calls `applyTheme()` to map server-managed settings to CSS custom properties used by `src/styles.css`.

Page components (`src/client/components/`):

- `EventBoard.tsx` — loads `/api/events`, opens `EventSource` to `/api/realtime/events`, 30-second polling fallback, creates events in manager mode, updates event start times, cancels/archives events, manages participation. Renders the global `PizzaPanel` above the event list when a pizza session exists. Conditionally renders `Cod4KeyGenerator` for events whose game matches `isCod4Game()`.
- `LoginPanel.tsx` — email OTP login, invite registration, logout, session list/rename/revoke, "Add a device" pairing flow (mint pair-token + QR code), redemption-on-mount from `?pair=<token>`, "Dieses Gerät vergessen", profile + email change, Web Push subscription, API token CRUD.
- `AdminPanel.tsx` — section-routed by `adminSection` (`users` / `betrieb` / `design` / `infos` / `sicherheit` / `invites` / `audit`). Covers user management, bulk import, settings, backup/restore, rate-limit list + allowlist, invite-code CRUD, audit log, theme + brand + game-catalog config, pizza settings + JSON menu editor.
- `ManagerPage.tsx`, `LoginPage.tsx`, `InfosPage.tsx`, `KioskStreamPage.tsx` — shell pages.
- `QrCanvas.tsx` — dependency-light canvas QR renderer (`qrcode-generator`).

Client helpers:

- `src/client/api/request.ts` — typed `requestJson()` wraps `fetch()` with `credentials: "include"` and parses errors into `ApiError`.
- `src/client/api/csrf.ts` — fetches and caches a CSRF token; required for state-changing requests.
- `src/client/api/device-key.ts` — per-origin 128-bit device key in `localStorage` (key `hermes_device_key_v1`), graceful fallback to ephemeral per-load key; `getDeviceContext()` returns `{ deviceKey, pwa }`.
- `src/client/errors/errors.ts` — `getErrorMessage(code)` + German + English error catalogs.
- `src/client/lib/runtime-context.ts` — secure-context, PWA display-mode, iOS-Safari heuristics.

There is no client-side state library. Server responses are treated as the source of truth and components reload their relevant collections after mutations. Several top-level components are oversized (`AdminPanel.tsx` ~1796, `LoginPanel.tsx` ~1077, `EventBoard.tsx` ~892) and are slated for sub-component extraction in a separate cleanup pass.

### Per-game integration points

`src/client/cod4/` is the reference pattern for per-game feature integrations: `isCod4Game()` matches the event's game name, `Cod4KeyGenerator.tsx` is conditionally rendered inside the event detail. Future per-game features should follow the same shape (small module folder with a name-matcher + a feature component, wired into `EventBoard`).

## API Layer

API routes are mounted in `src/server/app.ts`:

- `/api/health` — liveness.
- `/api/settings` — public settings from `src/server/settings.ts`.
- `/api/auth` — `auth-routes.ts`.
- `/api/admin` — `admin-routes.ts`.
- `/api/events` — `event-routes.ts`.
- `/api/pizza` — `pizza-routes.ts`.
- `/api/push` — `push-routes.ts`.
- `/api/realtime` — `realtime-routes.ts`.
- `/api/kiosk` — `kiosk-routes.ts`.
- `/api-docs` — Swagger UI served by `api-docs.ts` against `openapi/hermes-api.yaml`.

The route modules own request validation with Zod, database writes, audit logging, and response serialization. Pizza routes follow a service-layer pattern (`domain/pizza/*` carries the logic). `admin-routes.ts`, `auth-routes.ts`, and `event-routes.ts` are still mostly monolithic and slated for service-layer extraction.

Cross-cutting middleware lives in `src/server/auth/hermes-auth.ts`. It populates `request.hermesAuth` from either the `hermes_session` cookie or an `Authorization: Bearer <token>` header (Bearer takes precedence). `request.hermesAuth.kind` is `"session"` or `"api_token"`; for API tokens it also carries `scope` (`"full"` or `"read_only"`). Bearer requests bypass CSRF (see `auth/csrf.ts`).

## Authentication And Authorization

Two authentication mechanisms coexist, unified by `src/server/auth/hermes-auth.ts`:

**Cookie sessions:**

- `auth/sessions.ts` — base64url session tokens, `hermes_session` cookie, honors `HERMES_COOKIE_SECURE`.
- `auth/otp.ts` — six-digit OTPs, scrypt hashing.
- `auth/current-user.ts` — resolves session from cookie, joins `sessions` to `users`, rejects revoked sessions / deleted users, updates `lastSeenAt`, exposes `requireUser()` / `requireAdmin()`.
- `http/auth-routes.ts` — creates login challenges, sends email codes, verifies codes (with optional `deviceKey` + `pwa`), creates sessions, lists/rename/revoke sessions, logout, invite-based registration when settings allow.

**API tokens (Bearer):**

- `db/schema.ts` — `userApiTokens` table; `tokenHash`, `scope` (`full` / `read_only`), `revokedAt`, `lastUsedAt`.
- `http/auth-routes.ts` — `POST/GET/DELETE /api/auth/api-tokens` for CRUD; mint returns the plaintext once.
- `auth/hermes-auth.ts` — `enforceApiTokenWriteAccess()` rejects write methods for `read_only` tokens with `api_token_nur_lesen`.
- Bearer requests bypass CSRF; cookie requests require `x-hermes-csrf` (see `auth/csrf.ts` — HMAC-SHA256 over session id, GET-only mint at `/api/auth/csrf`).

**Rate limits:** `auth/rate-limits.ts` persists per-scope counters in `rateLimitEntries`; admin-managed allowlist in `rateLimitAllowlist`. Used for OTP request flooding, login verify, pair-token mint, and pair-redeem.

**Authorization** is role-based:

- Roles: `user`, `organizer`, `manager`, `admin` (CHECK constraint enforced via migrations `0012` + `0013`).
- `domain/users.ts` — `canCreateEvent()`, `canManageEvent()`, role-assignment helpers.
- Admin APIs in `http/admin-routes.ts` gate on `requireAdmin()` before handlers run.

## Device recognition and pairing

Two related flows, both tracked in `db/schema.ts`:

- `sessions.deviceKeyHash` carries an HMAC-SHA256 of the client's per-origin device key (`HERMES_DEVICE_KEY_SECRET`).
- `pairingTokens` carries short-lived pair tokens (HMAC with `HERMES_PAIR_TOKEN_SECRET`, 10-min TTL, single-use).

**Same-device re-login** (`auth-routes.ts: verify-code`): when the submitted `deviceKey` hashes to an existing non-revoked session for the same user, that session is updated in place rather than creating a new row. Audit code `auth.login_recognized` distinguishes this from a fresh `auth.login`. Falls back to UA-signal heuristics only when exactly one non-revoked, non-key-bound candidate matches (ambiguity inserts a new row).

**Add-a-device pairing**:

- `POST /api/auth/pair-token` (auth + CSRF + rate-limited) mints an opaque token tied to the origin session.
- The client renders the token as a QR (`QrCanvas.tsx`) and a link (`#login?pair=<token>`).
- `POST /api/auth/pair-redeem` (public, CSRF-exempt, single-use, atomic) accepts the token + new device's `deviceKey` and creates a new session for the same user. The origin session stays alive.
- Four stable error codes: `pair_token_invalid`, `pair_token_expired`, `pair_token_consumed`, `pair_origin_revoked`.
- Audit codes: `device_paired`, `device_pair_failed` (no raw deviceKey in metadata).

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

- `db/client.ts` — creates the SQLite file directory, opens the database, enables WAL mode + foreign keys, returns `{ sqlite, db }`.
- Database path: `getDatabasePath()` in `env.ts`, default `data/hermes.sqlite`.
- `db/schema.ts` defines tables grouped as:
  - **Auth/users**: `users`, `loginChallenges`, `sessions`, `emailChangeChallenges`, `inviteCodes`, `inviteCodeUses`, `pairingTokens`, `userApiTokens`, `rateLimitEntries`, `rateLimitAllowlist`.
  - **Events**: `gameEvents`, `participations`.
  - **Settings/audit**: `appSettings`, `auditLogs`.
  - **Push**: `pushSubscriptions`.
  - **Storage**: `storageBackupStatus`, `storageRestoreRecoveries`.
  - **Pizza**: `pizzaSessions`, `pizzaMenuItems`, `pizzaMenuVariants`, `pizzaOrders`, `pizzaOrderLines`.
- Migrations in `db/migrations/*.sql` (0001–0018); see `STRUCTURE.md` for the full list.
- `db/migrate.ts` tracks applied filenames in `schema_migrations` and runs as a CLI entrypoint.
- `db/bootstrap-admin.ts` is bundled separately and used by tests + first-time setup.

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

## Pizza Ordering System

LAN-party-wide pizza ordering (`/api/pizza/*`), introduced 2026-05 — see `.planning/phases/14-pizza-ordering/` for the full retrospective. Key shape:

- **One global session** at a time. `pizzaSessions` has no `event_id` (dropped in migration `0018`); admins/managers open → guests order → manager locks → marks delivered.
- **Menu**: `pizzaMenuItems` (name, category, sort order, ingredients/allergens, active flag) + `pizzaMenuVariants` (size, price in cents). One item has many variants. Da Rosario seed is the only seeded menu (migration `0017`).
- **Orders**: per-user, capped at `PIZZA_MAX_LINES_PER_ORDER = 3` lines per session. Each line has qty 1-3 + optional 200-char note. Price snapshot at line write time (`pizza_order_lines.price_cents`).
- **Authorization**: anyone with a session can order while status is `open` (no dabei-gate). Manager actions gated by `canManageEvent()` against the originating event's manager set (yes, even though the pizza session is LAN-wide, the manager check still routes through event permissions).
- **Outputs**: two PDFs via `pdf/pizza-print.ts`:
  - **Pizzeria call sheet** — aggregated by item number, no guest names.
  - **Kassenliste** — per guest, payment status (paypal/cash/unpaid), paypal.me deep link if `pizzaPaypalHandle` setting is configured.
- **Errors**: domain-typed (`PizzaOrderError`, `PizzaLifecycleError`, `PizzaOrderLimitError`) translated to HTTP responses by `handleDomainError()` in `http/pizza-routes.ts`. Slated to extend a shared `AppError` base in a follow-up cleanup pass.

Settings keys: `pizzaPaypalHandle`, `pizzaPaypalName`, `pizzaCashRecipient` (all default empty; feature is dormant until configured).

## Testing Architecture

See `.planning/codebase/TESTING.md` for the current test inventory and conventions. Tests are split by scope:

- Domain tests cover pure rules (events, users, pizza lifecycle/limits/totals).
- HTTP integration tests cover route flows under realistic auth + audit + push side effects.
- Client tests cover login, admin, and ui-correctness via a `react-dom/client` + `act` harness.
- Playwright E2E covers the cross-role browser flow.

Known coverage gaps are tracked in `TESTING.md` (security-critical auth modules, oversized route files, pizza route surface, realtime SSE).

## Architectural Constraints And Planning Notes

- `src/main.tsx` is large and owns many UI concerns. Feature work that expands client complexity may benefit from extracting API helpers or component files, but current behavior assumes local component state and explicit reloads after mutations.
- API route modules currently combine validation, authorization, persistence, audit logging, notifications, and serialization. Future cross-route behavior should be factored only when repeated behavior is concrete.
- Realtime clients are in-memory. This is fine for a single Node process but will not broadcast across multiple server replicas without an external pub/sub layer.
- SQLite plus file-level S3 snapshots imply a single-writer/simple-deployment model. Multi-instance deployments need a different persistence strategy or strict writer coordination.
- Settings and theme values are runtime database state, so UI changes should account for server-provided CSS custom property values.
- Session IDs are stored directly as session primary keys and cookie tokens. Treat database and cookie access as sensitive even though token values are not logged in these docs.

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
- `README.md`, `building.md`, `ideas.md`, `AGENTS.md` are project documentation/notes.

## Frontend Files

- `src/main.tsx` is the React composition root: hash-based routing (`getPageFromHash`), top-level page-component selection, runtime context loading, brand/i18n providers, and the legacy hash redirects map.
- `src/styles.css` holds global styles, CSS custom properties, layout rules, responsive behavior, form/button/card styling, status colors, and route-specific visual treatment.
- `src/client/` holds the React component tree, hooks, and client API helpers (see subsections below).
- `src/shared/` holds code shared between client and server (brand marks, locale resolution, project template).

## Client Modules

### Components (`src/client/components/`)

- `AdminPanel.tsx` — admin section router (`adminSection` switch over users/betrieb/design/infos/sicherheit/invites/audit).
- `LoginPanel.tsx` — login/register flow + authenticated profile/sessions/api-tokens/pair-token/push UI.
- `EventBoard.tsx` — event list with SSE live updates, expandable cards, create form.
- `ManagerPage.tsx` — manager-only view.
- `LoginPage.tsx`, `InfosPage.tsx`, `KioskStreamPage.tsx` — top-level page shells.
- `QrCanvas.tsx` — dependency-light canvas QR renderer (`qrcode-generator`).
- Tests: `admin-panel.test.tsx`, `login-panel.test.tsx`, `ui-correctness.test.tsx`.

### Client API (`src/client/api/`)

- `request.ts` — typed `requestJson` helper with consistent error parsing.
- `csrf.ts` + `csrf.test.ts` — CSRF token fetch/cache.
- `device-key.ts` — per-origin 128-bit device-key persistence in `localStorage`, `getDeviceContext()`, PWA detection.

### Client libs (`src/client/lib/`)

- `BrandingContext.tsx` — current brand provider.
- `brand-icon.ts` — brand-icon resolver.
- `locale-display.ts` — locale label formatting.
- `runtime-context.ts` + `runtime-context.test.ts` — secure-context, PWA display-mode, and iOS-Safari heuristics.

### i18n (`src/client/i18n/`)

- `I18nContext.tsx` — translation provider and `useI18n` hook.
- `catalog/{de,en}.ts` — translation strings.
- `template-overlays/` — per-project copy overlays (table-tennis as the reference).

### Errors (`src/client/errors/`)

- `errors.ts` — `ApiError`, `getErrorMessage()`, German + English error-code → human-readable maps.

### Pizza UI (`src/client/pizza/`)

- `PizzaPanel.tsx` — guest-facing menu browser + line editor + manager overview.
- `PizzaMenuJsonAdmin.tsx` — admin JSON import/export menu editor.
- `api.ts` — pizza REST client.
- `types.ts` — shared pizza TypeScript types.

### COD4 (`src/client/cod4/`)

Per-game integration: `Cod4KeyGenerator.tsx`, `generateCod4Key.ts` + test, `isCod4Game.ts` + test, `clipboard.ts`. Wired into `EventBoard` via `isCod4Game` when the event's game name matches. Intentional pattern for future per-game integrations.

## Public Assets

- `public/sw.js` is the service worker for Web Push install/activate, push notification display, and notification click navigation.
- `public/manifest.webmanifest` defines the installable PWA metadata and icon reference.
- `public/icon.svg` is used by the UI, manifest, and notifications.
- `public/screen/` holds screen-recording assets.

Vite copies `public/*` assets to the built client output.

## Server Entrypoints

- `src/server/index.ts` is the Node runtime entrypoint. Starts the app on `HERMES_HOST`/`HERMES_PORT` and handles shutdown.
- `src/server/app.ts` is the Express composition root: restores storage, creates the DB context, runs migrations, installs middleware/routes, schedules snapshots, starts event status refresh, serves static production assets.
- `src/server/version-info.ts` + `version-info.test.ts` — release version surface for the footer.

## Server HTTP Layer (`src/server/http/`)

- `auth-routes.ts` — `/api/auth/*`: request login codes, invite registration, verify codes, profile updates, email-change challenges, sessions list/rename/revoke, logout, pair-token + pair-redeem, API token CRUD.
- `admin-routes.ts` — `/api/admin/*`: users CRUD, audit logs, app settings (read + import/export), invite codes CRUD, backup + restore, rate-limit list/clear + allowlist CRUD, bulk user import (preview + commit), import-from-export.
- `event-routes.ts` — `/api/events/*`: list/create/update/cancel/archive events, soft-delete, set participation, periodic status refresh.
- `pizza-routes.ts` — `/api/pizza/*`: session lifecycle (open/lock/delivered), menu read, order CRUD, admin menu JSON upsert, two PDF print outputs.
- `push-routes.ts` — `/api/push/*`: VAPID public key, subscription upsert/revoke, notification preferences.
- `realtime-routes.ts` — `/api/realtime/events` SSE endpoint.
- `kiosk-routes.ts` — kiosk-streaming endpoints.
- `api-docs.ts` — Swagger UI for the OpenAPI YAML.
- Tests: `app-flow.test.ts`, `event-capacity.test.ts`, `event-soft-delete.test.ts`, `event-side-effects.test.ts`, `auth-pair.test.ts`, `auth-device-recognition.test.ts`, `api-tokens.test.ts`.

The HTTP layer imports Drizzle schema objects directly and currently performs most persistence inside the route file. Several route files (admin, auth, event) are oversized and slated for service-layer extraction.

## Authentication Modules (`src/server/auth/`)

- `current-user.ts` — resolves session/user, rejects revoked/deleted identities, exposes `requireUser()` / `requireAdmin()`.
- `hermes-auth.ts` — unified auth middleware: cookie sessions OR Bearer API tokens, populates `request.hermesAuth`.
- `csrf.ts` — CSRF token mint + verify (HMAC-SHA256 over session id); Bearer requests bypass.
- `sessions.ts` — `hermes_session` cookie name, token generation, max age, set/clear options.
- `otp.ts` + `otp.test.ts` — six-digit OTP generation, scrypt hashing, verification.
- `device-key.ts` — server-side `hashDeviceKey` (HMAC-SHA256 with `HERMES_DEVICE_KEY_SECRET`).
- `device-names.ts` — `validateDeviceName`, `resolveDeviceName` with UA-derived fallback (`deriveBrowserLabel`).
- `pairing-tokens.ts` — pair-token mint, redeem, lookup; HMAC with `HERMES_PAIR_TOKEN_SECRET`.
- `rate-limits.ts` — persisted rate-limit entries + allowlist, per-scope counters.

## Database Modules

### Files (`src/server/db/`)

- `client.ts` — creates the SQLite directory/file, enables WAL and foreign keys, wraps the connection with Drizzle.
- `schema.ts` — Drizzle table schemas and selected relations.
- `migrate.ts` — applies SQL migration files; CLI-runnable.
- `bootstrap-admin.ts` — creates or updates the initial admin user from env values.

### Migrations (`src/server/db/migrations/`)

| # | File | Purpose |
|---|------|---------|
| 0001 | `0001_initial.sql` | Core tables (users, sessions, events, participations, settings, push) |
| 0002 | `0002_unique_username.sql` | Unique username constraint |
| 0003 | `0003_audit_logs.sql` | `audit_logs` table |
| 0004 | `0004_invites_and_deleted_users.sql` | Invite codes + invite-code uses + soft-delete flag on users |
| 0005 | `0005_auth_profile_invite_hardening.sql` | Email-change challenges, login-challenge hardening, invite consistency |
| 0006 | `0006_backup_restore_status.sql` | `storage_backup_status` |
| 0007 | `0007_restore_recoveries.sql` | `storage_restore_recoveries` |
| 0008 | `0008_push_subscription_failures.sql` | Push subscription failure tracking |
| 0009 | `0009_event_soft_delete.sql` | `deleted_at` on `game_events` |
| 0010 | `0010_device_pairing.sql` | `pairing_tokens`, `sessions.device_key_hash` |
| 0011 | `0011_user_locale.sql` | `users.locale` |
| 0012 | `0012_user_role_organizer.sql` | Stub for `0013` (SQLite cannot ALTER CHECK) |
| 0013 | `0013_users_role_organizer_check.sql` | Rebuilds `users` table with extended role CHECK |
| 0014 | `0014_event_details.sql` | Event detail markdown + image fields |
| 0015 | `0015_user_api_tokens.sql` | `user_api_tokens` (Bearer API tokens) |
| 0016 | `0016_pizza_order_system.sql` | Pizza menu/session/order tables |
| 0017 | `0017_seed_pizza_menu_da_rosario.sql` | Idempotent Da Rosario menu seed |
| 0018 | `0018_pizza_session_global.sql` | Drop `event_id` from `pizza_sessions` (LAN-wide) |

### Tables (`src/server/db/schema.ts`)

Auth/users: `users`, `loginChallenges`, `sessions`, `emailChangeChallenges`, `inviteCodes`, `inviteCodeUses`, `pairingTokens`, `userApiTokens`, `rateLimitEntries`, `rateLimitAllowlist`.

Events: `gameEvents`, `participations`.

Audit/settings: `auditLogs`, `appSettings`.

Push: `pushSubscriptions`.

Storage: `storageBackupStatus`, `storageRestoreRecoveries`.

Pizza: `pizzaSessions`, `pizzaMenuItems`, `pizzaMenuVariants`, `pizzaOrders`, `pizzaOrderLines`.

## Domain Modules (`src/server/domain/`)

- `events.ts` + `events.test.ts` — event Zod schemas, status derivation, auto-archive, `EventCapacityError`.
- `users.ts` + `users.test.ts` — role schema, permission helpers (event create/manage, role assign).
- `pizza/lifecycle.ts` + `.test.ts` — session state machine, `PizzaLifecycleError`.
- `pizza/menu.ts` — menu queries.
- `pizza/order-limits.ts` + `.test.ts` — `PIZZA_MAX_LINES_PER_ORDER`, `normalizeNote`, `PizzaOrderLimitError`.
- `pizza/orders.ts` — order/line CRUD, price snapshot, `PizzaOrderError`.
- `pizza/sessions.ts` — session CRUD (LAN-wide as of 0018).
- `pizza/totals.ts` + `.test.ts` — per-order and per-session totals.

Domain modules are pure or near-pure helpers and the safest place to extend business rules before wiring them into routes.

## Cross-Cutting Server Modules

- `src/server/settings.ts` — validates, reads, writes `app_settings`; splits into `settingsSchema` (full, with superRefine) and `settingsPartialSchema` (PATCH).
- `src/server/audit-log.ts` — `writeAuditLog`, `tryWriteAuditLog`, `listAuditLogs`, `maskInviteCode`.
- `src/server/env.ts` — loads local `.env`, resolves SQLite path, reads required env vars.
- `src/server/mail/mailer.ts` — sends login codes to console or SMTP.
- `src/server/push/push-service.ts` + `.test.ts` (+ `service-worker-push.test.ts`) — Web Push send, dead-subscription cleanup.
- `src/server/realtime/event-bus.ts` — in-memory SSE client registry + broadcast.
- `src/server/storage/s3-storage.ts` + `.test.ts` — S3 snapshot upload/restore/scheduled flush, credential parsing.
- `src/server/pdf/pizza-print.ts` + `.test.ts` — `buildPizzeriaPdf`, `buildKassenlistePdf` (pdfkit).
- `src/server/openapi/hermes-api.yaml` — OpenAPI spec served by `api-docs.ts`.

## Test Directories

- `src/**/*.test.ts(x)` — Vitest unit + integration tests colocated with their modules.
- `e2e/hermes-flow.spec.ts` — Playwright browser flow (admin setup → user creation → manager event → participation).

## Build Outputs And Runtime Data

These paths are produced or used at runtime and should generally not be edited directly:

- `dist/` — Vite client build output served by `src/server/app.ts` in production.
- `dist-server/` — bundled server output from `npm run build:server`.
- `data/hermes.sqlite` — default local SQLite path when `HERMES_DB_PATH` is not set; `-wal` and `-shm` sibling files appear in WAL mode.
- `/data/hermes.sqlite` — default database path inside the Docker runtime image.

## Planning Directory

- `.planning/MILESTONES.md`, `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` — live milestone tracking.
- `.planning/codebase/` — architecture, structure, conventions, concerns, integrations, stack, testing. Live reference.
- `.planning/milestones/` — per-milestone requirements docs.
- `.planning/phases/01-..14-` — per-phase plans/summaries. Phase 14 is retrospective (no PLAN files).
- `.planning/archive/` — historical artifacts: `research/`, `completed-todos/`, prior-milestone roadmaps, v1.0 audit.
- `.planning/config.json` — planner configuration.

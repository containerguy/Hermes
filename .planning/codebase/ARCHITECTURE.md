<!-- refreshed: 2026-05-01 -->
# Architecture

**Analysis Date:** 2026-05-01

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                       Browser (SPA + Service Worker)                  │
│  React 19 entry: `src/main.tsx` → mounts AppShell                     │
│  Pages: EventBoard, LoginPage, AdminPanel, InfosPage, KioskStreamPage │
│  PWA: `public/sw.js`, `public/manifest.webmanifest`                   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ fetch (cookie session OR Bearer token)
                             │ + Server-Sent Events on /api/realtime/events
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Express 5 application                            │
│                     Bootstrap: `src/server/index.ts`                 │
│                     Factory:   `src/server/app.ts`                   │
│                                                                      │
│  Global middleware:                                                  │
│   - cookie-parser                                                    │
│   - hermesAuthMiddleware  (`src/server/auth/hermes-auth.ts`)         │
│   - security headers + CSP (in `src/server/app.ts`)                  │
│   - mountApiDocs (Swagger UI at /api/docs)                           │
│   - response.on("finish") → scheduleDatabaseSnapshot                 │
│                                                                      │
│  Route mounts (createXxxRouter factories):                           │
│   /api/auth      → `src/server/http/auth-routes.ts`                  │
│   /api/admin     → `src/server/http/admin-routes.ts`                 │
│   /api/events    → `src/server/http/event-routes.ts`                 │
│   /api/push      → `src/server/http/push-routes.ts`                  │
│   /api/realtime  → `src/server/http/realtime-routes.ts`              │
│   /api/kiosk     → `src/server/http/kiosk-routes.ts`                 │
│   /api/health, /api/settings, /api/settings/public                   │
│                                                                      │
│  Periodic timer (30s): refreshEventStatuses + broadcastEventsChanged │
│  Static fallback: serves `dist/` + SPA index.html for non-/api/      │
└──────┬───────────────────────────┬───────────────────────┬───────────┘
       │                           │                       │
       ▼                           ▼                       ▼
┌────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│ Domain (pure)      │  │ Cross-cutting        │  │ Adapters           │
│ `domain/events.ts` │  │ `auth/*`             │  │ `db/client.ts`     │
│ `domain/users.ts`  │  │ `realtime/event-bus` │  │ `mail/mailer.ts`   │
│ Zod schemas, role  │  │ `audit-log.ts`       │  │ `push/push-service`│
│ + status logic     │  │ `settings.ts`        │  │ `storage/s3-storage│
└────────────────────┘  └──────────────────────┘  └─────────┬──────────┘
                                                            │
                                                            ▼
                                          ┌──────────────────────────────┐
                                          │ SQLite (better-sqlite3, WAL) │
                                          │ Drizzle ORM schema           │
                                          │ `src/server/db/schema.ts`    │
                                          │ Path: HERMES_DB_PATH         │
                                          │ Snapshots → S3 (optional)    │
                                          └──────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| HTTP bootstrap | `app.listen`, SIGINT/SIGTERM shutdown, snapshot flush | `src/server/index.ts` |
| App factory | Compose middleware, mount routers, restore snapshot, run migrations | `src/server/app.ts` |
| Auth middleware | Resolve session cookie OR Bearer API token onto `request.hermesAuth` | `src/server/auth/hermes-auth.ts` |
| Session helpers | Cookie name, token hashing (`createHash sha256`), set/clear cookie | `src/server/auth/sessions.ts` |
| CSRF | HMAC-of-session-id token, header `X-Hermes-CSRF` | `src/server/auth/csrf.ts` |
| Device key | HMAC fingerprint of opaque per-device key + UA-derived device signals | `src/server/auth/device-key.ts` |
| Pairing tokens | Short-lived HMAC-hashed tokens for cross-device login | `src/server/auth/pairing-tokens.ts` |
| OTP | One-time login codes (challenge table) | `src/server/auth/otp.ts` |
| Rate limits | Per-scope sliding window with admin-managed allowlist | `src/server/auth/rate-limits.ts` |
| Event domain | Zod input schema, `deriveEventStatus`, `shouldAutoArchive` | `src/server/domain/events.ts` |
| User domain | Role enum + `canManageEvent`, `canCreateEvent`, `canAssignRoles` | `src/server/domain/users.ts` |
| Event routes | CRUD + participation join/decline + cancel/archive | `src/server/http/event-routes.ts` |
| Admin routes | User CRUD, invites, settings, audit log, backup/restore | `src/server/http/admin-routes.ts` |
| Auth routes | Request-code, register, verify, profile, sessions, pair-token, pair-redeem | `src/server/http/auth-routes.ts` |
| Push routes | VAPID public key, subscribe/unsubscribe, preferences | `src/server/http/push-routes.ts` |
| Realtime route | Single SSE endpoint `/api/realtime/events` | `src/server/http/realtime-routes.ts` |
| Kiosk routes | Token-gated read-only event feed for kiosk display | `src/server/http/kiosk-routes.ts` |
| API docs | Serves `/api/openapi.yaml` and Swagger UI at `/api/docs` | `src/server/http/api-docs.ts` |
| Realtime broadcaster | In-process SSE client registry, heartbeat every 25s | `src/server/realtime/event-bus.ts` |
| Push notifier | `web-push` VAPID send to a user's subscriptions; cleanup on 410/404 | `src/server/push/push-service.ts` |
| Snapshot manager | Restore-on-boot, debounced write-on-change, S3 upload/download | `src/server/storage/s3-storage.ts` |
| Mailer | Nodemailer for OTP / email-change codes | `src/server/mail/mailer.ts` |
| DB client | `better-sqlite3` + Drizzle, WAL mode, foreign keys ON | `src/server/db/client.ts` |
| Migrator | Sequenced `*.sql` files tracked in `schema_migrations` | `src/server/db/migrate.ts` |
| Audit log | `writeAuditLog` / `tryWriteAuditLog` helpers | `src/server/audit-log.ts` |
| Settings | Zod-validated key/value rows in `app_settings`, public projection | `src/server/settings.ts` |
| Version info | Reads version from `package.json`, repo URL from env | `src/server/version-info.ts` |
| SPA shell | Hash-routed page switcher, fetches `/api/auth/me` and settings | `src/main.tsx` |
| HTTP client | `requestJson` wrapper with CSRF header injection | `src/client/api/request.ts` |
| Error type | `ApiError` with code/status/body | `src/client/errors/errors.ts` |
| i18n | React context + `de`/`en` catalogs + project-template overlays | `src/client/i18n/I18nContext.tsx`, `src/client/i18n/catalog/` |

## Pattern Overview

**Overall:** Single-process Node.js Express 5 application that serves both the JSON API and the built React SPA from one origin. Drizzle ORM over a local SQLite file (WAL) is the source of truth; optional S3 snapshots provide durability across container restarts.

**Key Characteristics:**
- Factory-per-router: each `createXxxRouter(context)` closes over the shared `DatabaseContext` and is mounted in `src/server/app.ts`.
- Pure domain modules in `src/server/domain/` hold validation (Zod) and business rules; HTTP handlers do orchestration only.
- Auth resolved once per request by `hermesAuthMiddleware` and cached on `request.hermesAuth` (`session` or `api_token`).
- Realtime is push-based via SSE on a single endpoint; mutating handlers call `broadcastEventsChanged(reason)`.
- All non-GET writes trigger a debounced SQLite → S3 snapshot via `response.on("finish")` hook in `src/server/app.ts`.
- The SPA is hash-routed (`#events`, `#login`, `#admin`, `#admin/<section>`, `#infos`) plus a configurable kiosk path served from the same SPA bundle.

## Layers

**HTTP layer (`src/server/http/`):**
- Purpose: parse requests, enforce auth/CSRF/rate limits, call domain helpers, serialize responses, broadcast realtime events, write audit log entries.
- Depends on: `auth/`, `domain/`, `db/`, `realtime/`, `push/`, `audit-log.ts`, `settings.ts`.
- Used by: `src/server/app.ts` only.

**Domain layer (`src/server/domain/`):**
- Purpose: pure business rules — Zod input schemas, status derivation, role checks, identity uniqueness queries.
- Depends on: `db/schema.ts`, `db/client.ts` (read helpers only); no Express types.
- Used by: HTTP layer.

**Auth layer (`src/server/auth/`):**
- Purpose: session lifecycle, CSRF, OTP, rate limits, device recognition, pairing.
- Depends on: `db/`.
- Used by: HTTP routers and middleware.

**Persistence layer (`src/server/db/`):**
- Purpose: Drizzle schema definitions, SQLite client factory, sequential SQL migrations.
- Depends on: nothing internal (only `env.ts`).
- Used by: every other server layer through `DatabaseContext`.

**Adapter layer (`src/server/storage/`, `src/server/push/`, `src/server/mail/`):**
- Purpose: external I/O — S3 snapshots, web-push VAPID delivery, SMTP mail.
- Depends on: `db/`, `env.ts`.
- Used by: HTTP routers and `app.ts`.

**Client layer (`src/main.tsx`, `src/client/`):**
- Purpose: React 19 SPA, i18n, branded UI, fetch wrappers, CSRF priming, runtime context.
- Depends on: only the HTTP API; no shared imports from `src/server/`.
- Shared types: `src/shared/` (brand-mark, locale, project-template) is the only module pair imported from both client and server.

## Data Flow

### Primary Request Path (authenticated mutation)

1. Browser sends `POST /api/events` with cookie + `X-Hermes-CSRF` header (`src/client/api/request.ts:4`).
2. `hermesAuthMiddleware` resolves session into `request.hermesAuth` (`src/server/auth/hermes-auth.ts:127`).
3. Router-level guard rejects unauthenticated requests; second guard blocks read-only API tokens on writes (`src/server/http/event-routes.ts:175`).
4. Handler validates body with `eventInputSchema` (`src/server/domain/events.ts:11`), inserts via Drizzle (`src/server/http/event-routes.ts:228`).
5. Handler calls `broadcastEventsChanged("event_created")` (`src/server/realtime/event-bus.ts:33`) and `sendPushToEnabledUsers(...)` (`src/server/push/push-service.ts`).
6. Handler writes audit entry via `writeAuditLog` (`src/server/audit-log.ts:26`).
7. Response returns; `app.ts` `finish` hook calls `scheduleDatabaseSnapshot` (`src/server/app.ts:62`).

### Realtime Subscription Flow

1. SPA opens `EventSource('/api/realtime/events')`.
2. `createRealtimeRouter` enforces auth and calls `registerEventsClient(response)` (`src/server/http/realtime-routes.ts:17`).
3. `registerEventsClient` writes SSE headers, starts a 25s heartbeat, stores `Response` in module-level `clients` map (`src/server/realtime/event-bus.ts:10`).
4. On request close, the unregister function clears the heartbeat and removes the entry.
5. Any handler that mutates events calls `broadcastEventsChanged(reason)` which writes `event: events_changed` to every registered client.

### Cross-Device Pairing Flow (Phase 09)

1. Authenticated device A: `POST /api/auth/pair-token` — rate-limited per session and per user, inserts `pairing_tokens` row with HMAC-hashed token, TTL 10 min, returns the raw token (`src/server/http/auth-routes.ts:1110`).
2. Device B: `POST /api/auth/pair-redeem` with the token — looks up by HMAC hash, validates not expired/consumed, mints a new session for the same user, marks the token consumed (`src/server/http/auth-routes.ts:1180`).
3. Audit entries `device_pair_created` / `device_pair_redeemed` / `device_pair_failed` are written.
4. Migration: `src/server/db/migrations/0010_device_pairing.sql`. Helpers: `src/server/auth/pairing-tokens.ts`. Tests: `src/server/http/auth-pair.test.ts`.

### Snapshot Restore + Persist Flow

1. On boot, `createHermesApp()` calls `restoreDatabaseFromStorageIfNeeded()` before opening the DB (`src/server/app.ts:26`).
2. `runMigrations(context.sqlite)` applies any new `*.sql` migrations.
3. Each non-GET response triggers `scheduleDatabaseSnapshot(context.sqlite)` (debounced).
4. On SIGINT/SIGTERM, `flushDatabaseSnapshot` runs before the SQLite handle closes (`src/server/index.ts:11`).

**State Management:**
- Server: SQLite is the canonical store; only the SSE `clients` map and snapshot timer are in-process state.
- Client: page state lives in React `useState` inside `AppShell` (`src/main.tsx:545`); per-page state is colocated in each component; CSRF token cached in `src/client/api/csrf.ts`.

## Key Abstractions

**`DatabaseContext` (`src/server/db/client.ts:28`):**
- `{ sqlite, db }` — raw better-sqlite3 handle plus the Drizzle wrapper bound to `schema`. Passed into every router factory and helper.

**`HermesRequestAuth` (`src/server/auth/hermes-auth.ts:7`):**
- Discriminated union `session | api_token` attached to `Request.hermesAuth`. `requireUser` / `requireAdmin` / `enforceApiTokenWriteAccess` derive from it.

**Router factories:**
- Convention: every HTTP module exports `createXxxRouter(context: DatabaseContext): Router`. They install router-level guards before route handlers (auth → write-access).

**SSE broadcaster (`src/server/realtime/event-bus.ts`):**
- Process-local `Map<Response, Timer>` holding active clients. `broadcastEventsChanged(reason)` is the only fan-out API; `registerEventsClient(response)` returns an unregister callback.

**Push notifier (`src/server/push/push-service.ts`):**
- `configureWebPush()` lazily sets VAPID keys from env. `sendPushToUser`, `sendPushToEnabledUsers`, `sendPushToOperators` enumerate `push_subscriptions` rows and reap expired subscriptions on 404/410.

**Snapshot manager (`src/server/storage/s3-storage.ts`):**
- `restoreDatabaseFromStorageIfNeeded`, `scheduleDatabaseSnapshot`, `flushDatabaseSnapshot`, `persistDatabaseSnapshot`. Validates restored snapshots against `restorableTables` and migration head before promoting them.

**i18n catalog (`src/client/i18n/`):**
- `I18nProvider` selects `de`/`en` plus a project-template overlay (`lan_party` | `table_tennis`); translations exposed via `useI18n().t(key, vars)`.

## Entry Points

**Server process:**
- Location: `src/server/index.ts`
- Triggers: `npm run server` (tsx) in dev, `npm start` → `node dist-server/index.js` in prod.
- Responsibilities: read `HERMES_PORT` / `HERMES_HOST`, build app via `createHermesApp()`, install signal handlers, flush snapshot on shutdown.

**App factory:**
- Location: `src/server/app.ts:25` (`createHermesApp`)
- Used by: `src/server/index.ts`, every `*.test.ts` integration test (e.g. `src/server/http/app-flow.test.ts`).

**Browser SPA:**
- Location: `src/main.tsx`
- HTML host: `index.html` mounts `<div id="root">` and loads `/src/main.tsx` (Vite) or the built bundle.
- Responsibilities: parse hash route, fetch `/api/auth/me` and `/api/settings/public`, render `AppShell` with `BrandingProvider` + `I18nProvider`, render kiosk page when on the configured kiosk path.

**Migration CLIs:**
- `src/server/db/migrate.ts` — `npm run db:migrate:dev` and `npm run db:migrate`.
- `src/server/db/bootstrap-admin.ts` — `npm run db:bootstrap-admin` to seed an initial admin user.

**Service worker:**
- `public/sw.js` — handles web-push `push` and `notificationclick` events.

## Architectural Constraints

- **Threading:** Single-threaded Node event loop; `better-sqlite3` calls are synchronous so each request serializes its DB I/O.
- **SQLite concurrency:** WAL is enabled (`src/server/db/client.ts:13`). Event routes detect `SQLITE_BUSY` / `SQLITE_LOCKED` (`src/server/http/event-routes.ts:39`) and treat them as transient.
- **Global state:** Module-level singletons live in `src/server/realtime/event-bus.ts` (`clients` map), `src/server/storage/s3-storage.ts` (`snapshotTimer`), `src/server/push/push-service.ts` (`configured` flag), and `src/server/version-info.ts` (`cached`). Tests must reset where applicable (`clearReleaseInfoCache`).
- **Auth caching:** `request.hermesAuthLoaded` ensures auth resolution runs at most once per request.
- **Static + SPA fallback:** `app.ts` serves `dist/` only if it exists, so dev mode (Vite) works without a build.
- **Single-origin assumption:** Cookies are `SameSite=Lax`, CSP is `default-src 'self'`. No CORS configured — the SPA must be served from the same origin as the API.
- **Foreign keys ON:** `pragma foreign_keys = ON` (`src/server/db/client.ts:14`); cascading deletes apply to sessions on user delete.

## Anti-Patterns

### Long handler files

**What happens:** `src/server/http/admin-routes.ts` (1638 lines), `src/server/http/auth-routes.ts` (1334 lines), and `src/server/http/event-routes.ts` (666 lines) bundle every route for an area into one factory.
**Why it's wrong here:** Hard to navigate; helpers (Zod schemas, response shaping) get repeated inline; tests must traverse a large surface to find one handler.
**Do this instead:** Extract per-resource sub-modules (e.g. `admin/users-routes.ts`, `admin/invites-routes.ts`, `admin/backup-routes.ts`) and have the area factory mount them. Move shared serializers into `domain/`.

### Direct SQLite from HTTP layer

**What happens:** `src/server/http/kiosk-routes.ts:19` uses `context.sqlite.prepare(...)` for a count query while the rest of the file uses Drizzle.
**Why it's wrong here:** Mixes two query styles in one handler, bypasses schema typing.
**Do this instead:** Use Drizzle's `count()` (or a small helper in `src/server/domain/events.ts`) so all queries go through the typed layer.

### Domain logic embedded in route handlers

**What happens:** Status transition rules (cancel/archive eligibility, capacity checks) live inside `src/server/http/event-routes.ts` rather than `src/server/domain/events.ts`.
**Why it's wrong here:** The domain module then under-tests the rules and HTTP tests have to assert business behavior.
**Do this instead:** Keep `domain/events.ts` as the single source for status transitions; routes call domain helpers and only handle HTTP concerns.

## Error Handling

**Strategy:** Each handler returns a stable German error code in `{ error: "<code>" }` JSON with the appropriate HTTP status (e.g. `nicht_angemeldet`, `manager_erforderlich`, `csrf_token_ungueltig`, `event_voll`). The client throws `ApiError` (`src/client/errors/errors.ts`) carrying that code and status.

**Patterns:**
- Validation: Zod `safeParse`; on failure → 400 with a stable code.
- Auth: 401 `nicht_angemeldet`, 403 `admin_erforderlich` / `manager_erforderlich` / `api_token_nur_lesen`.
- Rate limit: 429 with `retryAfterSeconds` from `checkRateLimit` (`src/server/auth/rate-limits.ts`).
- DB contention: SQLite busy/locked codes are matched in `event-routes.ts` and surface as transient errors.
- Audit logging: prefer `tryWriteAuditLog` (swallows logging errors) inside hot paths; `writeAuditLog` for must-not-fail flows.

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.warn` / `console.error` only, prefixed `[Hermes]`. No structured logger.
**Validation:** Zod everywhere — request bodies (`eventInputSchema`, `pairRedeemSchema`, `settingsObjectSchema`), shared enums in `src/shared/` (`brandMarkSchema`, `appLocaleSchema`, `projectTemplateSchema`).
**Authentication:** Cookie session (HMAC-hashed token in `sessions.token_hash`) OR Bearer API token (`user_api_tokens.token_hash`). Resolved once per request in `hermesAuthMiddleware`.
**Authorization:** Role check helpers in `src/server/domain/users.ts` plus router-level guards.
**CSRF:** HMAC of session id; required by `requireCsrf` on session-backed mutations; API tokens bypass CSRF.
**Audit:** Every state-changing admin/auth action calls `writeAuditLog` / `tryWriteAuditLog`.
**Security headers:** Set in `src/server/app.ts:36` — CSP `default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy` denies sensors. `/api/docs` overrides CSP to allow Swagger UI from unpkg.

---

*Architecture analysis: 2026-05-01*

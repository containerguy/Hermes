# Codebase Structure

**Analysis Date:** 2026-05-01

## Directory Layout

```
Hermes/
├── src/
│   ├── main.tsx                  # SPA entry — bootstraps React, hash router, providers
│   ├── styles.css                # Global stylesheet imported by main.tsx
│   ├── client/                   # Browser-only code (React 19 SPA)
│   │   ├── api/                  # fetch wrapper, CSRF token client, device-key client
│   │   ├── components/           # Page + panel components (PascalCase .tsx)
│   │   ├── errors/               # ApiError class
│   │   ├── i18n/                 # I18nProvider + de/en catalogs + template overlays
│   │   ├── lib/                  # BrandingContext, locale-display, runtime-context
│   │   └── types/                # Shared client TypeScript types (core.ts)
│   ├── server/                   # Node/Express application
│   │   ├── index.ts              # Process entry: app.listen + signal handlers
│   │   ├── app.ts                # createHermesApp factory (middleware + router mounts)
│   │   ├── env.ts                # .env loader + getDatabasePath / readRequiredEnv
│   │   ├── settings.ts           # App settings persistence (Zod schema, public projection)
│   │   ├── audit-log.ts          # writeAuditLog / tryWriteAuditLog helpers
│   │   ├── version-info.ts       # Read version from package.json + repo URL
│   │   ├── auth/                 # Sessions, CSRF, OTP, rate limits, device keys, pairing
│   │   ├── db/                   # Drizzle schema, sqlite client, migrator, seed admin, *.sql
│   │   ├── domain/               # Pure business rules (events, users) with Zod schemas
│   │   ├── http/                 # Router factories (auth, admin, events, push, realtime, kiosk)
│   │   ├── mail/                 # nodemailer wrapper
│   │   ├── openapi/              # hermes-api.yaml (OpenAPI spec served at /api/openapi.yaml)
│   │   ├── push/                 # web-push VAPID delivery + subscription cleanup
│   │   ├── realtime/             # In-process SSE event bus
│   │   └── storage/              # S3 snapshot manager (restore + persist)
│   └── shared/                   # Modules imported by BOTH client and server
│       ├── brand-mark.ts
│       ├── locale.ts
│       └── project-template.ts
├── public/                       # Static assets copied verbatim by Vite
│   ├── icon.svg
│   ├── icon-mitspiel.svg
│   ├── manifest.webmanifest      # PWA manifest
│   └── sw.js                     # Service worker (push + notificationclick)
├── e2e/
│   └── hermes-flow.spec.ts       # Playwright end-to-end flow
├── screen/                       # Marketing/screenshots (PNG)
├── .planning/                    # GSD planning artifacts (milestones, phases, codebase docs)
├── index.html                    # Vite SPA shell
├── vite.config.ts                # Vite + @vitejs/plugin-react config
├── tsconfig.json                 # Strict TypeScript settings
├── playwright.config.ts          # E2E config
├── Dockerfile                    # Two-stage build (node:22-bookworm-slim)
├── docker-compose.yml            # Local container orchestration
├── package.json                  # Scripts: dev / build / build:server / server / start / test
├── package-lock.json
├── README.md
├── AGENTS.md
├── building.md
├── ideas.md
└── LICENSE
```

There is no top-level `migrations/` or `scripts/` folder. SQL migrations live under `src/server/db/migrations/` and are copied into `dist-server/migrations/` and `dist-server/db/migrations/` by the `build:server` esbuild step.

## Directory Purposes

**`src/main.tsx`:**
- Purpose: SPA bootstrap, hash router, theme application, route gating, kiosk-path detection.
- Key file: this is the only React entry; all other components are leaves.

**`src/client/components/`:**
- Purpose: Page-level React components and one-off UI pieces.
- Contains: `EventBoard.tsx`, `LoginPage.tsx`, `LoginPanel.tsx`, `AdminPanel.tsx`, `KioskStreamPage.tsx`, `InfosPage.tsx`, `ManagerPage.tsx`, `QrCanvas.tsx`, plus `*.test.tsx` co-located.
- Key files: `AdminPanel.tsx` (1751 lines — admin module containing all admin sub-views), `EventBoard.tsx` (889 lines), `LoginPanel.tsx` (1077 lines — includes the device-pairing flow added in Phase 09).

**`src/client/api/`:**
- Purpose: HTTP client primitives.
- Key files: `request.ts` (the `requestJson` wrapper), `csrf.ts` (token cache + `shouldAttachCsrf`), `device-key.ts` (per-device opaque key in localStorage).

**`src/client/lib/`:**
- Purpose: cross-cutting client helpers and React contexts.
- Key files: `BrandingContext.tsx`, `brand-icon.ts`, `locale-display.ts`, `runtime-context.ts`.

**`src/client/i18n/`:**
- Purpose: translations and project-template overlays.
- Key files: `I18nContext.tsx`, `catalog/de.ts`, `catalog/en.ts`, `catalog/index.ts`, `template-overlays/`.

**`src/client/errors/`:**
- Purpose: typed errors for the SPA.
- Key file: `errors.ts` exports `ApiError`.

**`src/client/types/`:**
- Purpose: shared client TypeScript types (`User`, `AppSettings`, `AppReleaseInfo`, `AdminSection`, etc.).
- Key file: `core.ts`.

**`src/server/`:**
- Purpose: Node Express 5 backend.
- Top-level files: `index.ts` (process), `app.ts` (factory), `env.ts`, `settings.ts`, `audit-log.ts`, `version-info.ts`.

**`src/server/auth/`:**
- Purpose: identity, session, CSRF, OTP, rate limits, device-recognition, cross-device pairing.
- Key files: `hermes-auth.ts`, `sessions.ts`, `csrf.ts`, `current-user.ts`, `otp.ts`, `rate-limits.ts`, `device-key.ts`, `device-names.ts`, `pairing-tokens.ts`.

**`src/server/db/`:**
- Purpose: persistence layer.
- Key files: `client.ts` (factory), `schema.ts` (Drizzle), `migrate.ts` (runner), `bootstrap-admin.ts` (seed CLI).
- Sub-folder: `migrations/` — sequential `NNNN_name.sql`, applied alphabetically and tracked in `schema_migrations`.

**`src/server/domain/`:**
- Purpose: pure business rules and Zod schemas — no Express, no HTTP types.
- Key files: `events.ts` (`eventInputSchema`, `deriveEventStatus`, `shouldAutoArchive`), `users.ts` (`userRoleSchema`, `canManageEvent`, `canCreateEvent`, `canAssignRoles`, identity-availability helpers).

**`src/server/http/`:**
- Purpose: Express router factories. One factory per area, mounted from `app.ts`.
- Key files: `auth-routes.ts`, `admin-routes.ts`, `event-routes.ts`, `push-routes.ts`, `realtime-routes.ts`, `kiosk-routes.ts`, `api-docs.ts`. Integration tests are co-located here (`app-flow.test.ts`, `auth-pair.test.ts`, etc.).

**`src/server/realtime/`:**
- Purpose: SSE broadcast bus.
- Key file: `event-bus.ts` (module-level `clients` map + `broadcastEventsChanged`).

**`src/server/push/`:**
- Purpose: web-push delivery and subscription hygiene.
- Key file: `push-service.ts`.

**`src/server/storage/`:**
- Purpose: optional S3 snapshot persistence.
- Key file: `s3-storage.ts` (restore-on-boot, debounced upload, validation against `restorableTables`).

**`src/server/mail/`:**
- Purpose: SMTP / nodemailer wrapper for OTP and email-change codes.
- Key file: `mailer.ts`.

**`src/server/openapi/`:**
- Purpose: hand-maintained OpenAPI 3 spec.
- Key file: `hermes-api.yaml` — copied to `dist-server/openapi/` by the build, served at `/api/openapi.yaml` and rendered by Swagger UI at `/api/docs`.

**`src/shared/`:**
- Purpose: schemas/types that MUST stay in sync between client and server.
- Key files: `brand-mark.ts`, `locale.ts`, `project-template.ts`. Importable from both layers.

**`public/`:**
- Purpose: PWA static assets.
- Generated: No. Committed: Yes.

**`e2e/`:**
- Purpose: Playwright tests; built bundle served by `npm start` is exercised.
- Key file: `hermes-flow.spec.ts`.

**Build outputs (gitignored):**
- `dist/` — Vite SPA build output (served as static by Express in production).
- `dist-server/` — esbuild-bundled server (`index.js`, `db/migrate.js`, `db/bootstrap-admin.js`) plus copied `migrations/` and `openapi/`.
- `data/` — default SQLite location (`HERMES_DB_PATH=./data/hermes.sqlite`); volume-mounted in Docker.

## Key File Locations

**Entry Points:**
- `src/server/index.ts` — server process (listen + shutdown).
- `src/server/app.ts` — Express factory, also imported by every server integration test.
- `src/main.tsx` — React SPA entry referenced from `index.html`.
- `src/server/db/migrate.ts` — migration CLI.
- `src/server/db/bootstrap-admin.ts` — admin seed CLI.

**Configuration:**
- `vite.config.ts` — dev server on `:5173`, preview on `:4173`, host `0.0.0.0`.
- `tsconfig.json` — strict TS, ESM, single `src/` root.
- `playwright.config.ts` — E2E config.
- `package.json` — scripts and dependencies.
- `Dockerfile` — multi-stage build, runtime image runs `node dist-server/index.js`.
- `docker-compose.yml` — local stack.
- `.env` (gitignored) — loaded by `src/server/env.ts:loadLocalEnvFile` only when `process.env` doesn't already have the key.

**Core Logic:**
- `src/server/app.ts` — composition root for the server.
- `src/server/db/schema.ts` — single source of truth for tables.
- `src/server/domain/events.ts`, `src/server/domain/users.ts` — business rules.
- `src/server/auth/hermes-auth.ts` — request authentication.
- `src/server/realtime/event-bus.ts` — SSE fan-out.
- `src/server/storage/s3-storage.ts` — backup/restore.

**OpenAPI & docs:**
- Spec: `src/server/openapi/hermes-api.yaml`
- Docs route: `src/server/http/api-docs.ts` → `/api/docs`

**Service worker / PWA:**
- `public/sw.js`, `public/manifest.webmanifest`.

**Testing:**
- Server unit tests: alongside source — `src/server/auth/otp.test.ts`, `src/server/domain/events.test.ts`, `src/server/domain/users.test.ts`, `src/server/version-info.test.ts`, `src/server/storage/s3-storage.test.ts`, `src/server/push/push-service-cleanup.test.ts`, `src/server/push/service-worker-push.test.ts`.
- Server integration tests: `src/server/http/*.test.ts` (use `createHermesApp` + supertest).
- Client tests: `src/client/components/*.test.tsx`, `src/client/lib/runtime-context.test.ts`, `src/client/api/csrf.test.ts`.
- E2E: `e2e/hermes-flow.spec.ts`.

## Naming Conventions

**Files:**
- React components and their tests use PascalCase: `AdminPanel.tsx`, `EventBoard.tsx`, `KioskStreamPage.tsx`. (Tests of the same module are kebab-case: `admin-panel.test.tsx`, `login-panel.test.tsx`.)
- All non-component TypeScript modules are kebab-case: `event-bus.ts`, `pairing-tokens.ts`, `push-service.ts`, `s3-storage.ts`, `hermes-auth.ts`.
- Tests sit beside the file they exercise as `<module>.test.ts(x)`.
- HTTP route files end with `-routes.ts` and export a `createXxxRouter(context)` factory.
- SQL migrations: `NNNN_short_name.sql` (4-digit zero-padded sequence). Latest: `0015_user_api_tokens.sql`.

**Directories:**
- All lower-case, single word where possible (`auth`, `db`, `http`, `domain`, `mail`, `push`, `realtime`, `storage`, `openapi`, `i18n`, `lib`, `api`, `errors`, `types`, `components`).

**Code identifiers:**
- Functions and variables: `camelCase` (`requestJson`, `requireAdmin`, `broadcastEventsChanged`).
- Types and React components: `PascalCase` (`DatabaseContext`, `HermesRequestAuth`, `AdminPanel`).
- Constants: `SCREAMING_SNAKE_CASE` (`SESSION_COOKIE`, `SESSION_MAX_AGE_MS`, `PAIR_TOKEN_BYTES`, `PAIR_TOKEN_TTL_MS`, `CSRF_HEADER`, `DEVICE_KEY_BYTES`).
- Env vars: `HERMES_*` prefix (`HERMES_PORT`, `HERMES_HOST`, `HERMES_DB_PATH`, `HERMES_VAPID_*`, `HERMES_PAIR_TOKEN_SECRET`, `HERMES_DEVICE_KEY_SECRET`, `HERMES_CSRF_SECRET`, `HERMES_COOKIE_SECURE`, `HERMES_STORAGE_BACKEND`, `HERMES_SOURCE_REPO_URL`).
- Error codes returned in API responses: lowercase German snake-case (`nicht_angemeldet`, `csrf_token_ungueltig`, `manager_erforderlich`, `event_voll`, `kiosk_ungueltig`, `api_token_nur_lesen`).

## Frontend Module Split

The SPA in `src/main.tsx` resolves a hash route into one of four pages and renders it inside `AppShell`.

| Page id | Hash | Component | Notes |
|---------|------|-----------|-------|
| `events` | `#events` (default) | `src/client/components/EventBoard.tsx` | Manager mode if user role ∈ {manager, organizer, admin} |
| `infos` | `#infos` | `src/client/components/InfosPage.tsx` | Markdown-rendered, requires login + `infosEnabled` |
| `login` | `#login` | `src/client/components/LoginPage.tsx` → `LoginPanel.tsx` | Hosts OTP login, registration, profile, sessions list, **device pairing UI** |
| `admin` | `#admin` / `#admin/<section>` | `src/client/components/AdminPanel.tsx` | Sections: `users`, `betrieb`, `design`, `infos`, `sicherheit`, `invites`, `audit` |

Plus a kiosk entry served from a configurable URL path (`appSettings.kioskStreamPath`) using `src/client/components/KioskStreamPage.tsx`. This is selected by `documentPath`, not by the hash router.

Legacy hashes `#admin-<section>` and `#manager` are remapped in `parseHashRoute` (`src/main.tsx:132`).

**Phase 09 device-pairing module:**
- Server: `src/server/auth/pairing-tokens.ts`, route handlers `POST /api/auth/pair-token` and `POST /api/auth/pair-redeem` in `src/server/http/auth-routes.ts:1110` and `:1180`.
- Migration: `src/server/db/migrations/0010_device_pairing.sql` (`pairing_tokens` table).
- Tests: `src/server/http/auth-pair.test.ts`, `src/server/http/auth-device-recognition.test.ts`.
- Client: surfaced inside `src/client/components/LoginPanel.tsx`; QR rendering via `src/client/components/QrCanvas.tsx` with `qrcode-generator`.
- Audit actions: `device_pair_created`, `device_pair_redeemed`, `device_pair_failed` (see `src/server/audit-log.ts`).

## Where to Add New Code

**New API endpoint:**
- Pick the right router file under `src/server/http/` (or create a new `*-routes.ts` and mount it in `src/server/app.ts`).
- Define request validation as a Zod schema at the top of the file (or in `src/server/domain/` if reusable).
- Add handler logic; call `broadcastEventsChanged(reason)` if event/participation state changes; call `tryWriteAuditLog` for audit-worthy actions.
- Update `src/server/openapi/hermes-api.yaml`.
- Add an integration test in the same directory (`<area>-<feature>.test.ts`) using `createHermesApp` + supertest.

**New domain rule:**
- Place pure logic in `src/server/domain/<area>.ts` and a unit test next to it.
- Import from HTTP handlers; do not duplicate validation in the route file.

**New database table or column:**
- Add the next sequential migration `src/server/db/migrations/NNNN_short_name.sql`.
- Update the Drizzle definition in `src/server/db/schema.ts`.
- If the table should be included in S3 snapshots, add it to `restorableTables` in `src/server/storage/s3-storage.ts`.
- Run `npm run db:migrate:dev` locally.

**New React page:**
- Add a component under `src/client/components/` in PascalCase.
- Wire a new `PageId`, route entry, and case in `renderActivePage` in `src/main.tsx`.
- For simple sub-pages of the admin area, add a new section to `adminSectionBySlug` and a panel inside `src/client/components/AdminPanel.tsx`.

**New shared client helper:**
- React context / hook → `src/client/lib/`.
- Pure helper → `src/client/lib/` (e.g. `locale-display.ts`).
- Network call → `src/client/api/` (use `requestJson`).

**Strings (i18n):**
- Add keys to both `src/client/i18n/catalog/de.ts` and `src/client/i18n/catalog/en.ts`.
- Project-template-specific overrides go under `src/client/i18n/template-overlays/`.

**Shared cross-layer types/enums:**
- Place in `src/shared/` so both `src/client/` and `src/server/` can import them. This is the only directory allowed to be imported from both sides.

**Tests:**
- Unit/integration: co-locate as `<sibling>.test.ts(x)` and run with `npm test` (Vitest).
- E2E: add a new spec under `e2e/` and run with `npm run test:e2e` (Playwright).

## Special Directories

**`src/server/db/migrations/`:**
- Purpose: sequential SQL migrations.
- Generated: No (hand-written). Committed: Yes.
- Copied to `dist-server/migrations/` and `dist-server/db/migrations/` by `npm run build:server`.

**`src/server/openapi/`:**
- Purpose: OpenAPI 3 spec.
- Generated: No (hand-maintained). Committed: Yes.
- Copied to `dist-server/openapi/` by the build.

**`public/`:**
- Purpose: static PWA assets served verbatim by Vite (and from `dist/` in production).
- Generated: No. Committed: Yes.

**`dist/` and `dist-server/`:**
- Purpose: build output (Vite SPA + esbuild server bundle).
- Generated: Yes. Committed: No.

**`data/`:**
- Purpose: default SQLite location when `HERMES_DB_PATH` is unset.
- Generated: Yes (created on first boot by `createSqliteClient`). Committed: No. Mounted as `/data` volume in Docker.

**`.planning/`:**
- Purpose: GSD planning artifacts (milestones, phases, codebase docs, roadmap).
- Generated: Partially (this file). Committed: Yes.

---

*Structure analysis: 2026-05-01*

# Coding Conventions

**Analysis Date:** 2026-05-01

## Naming Patterns

**Files:**
- Server source: kebab-case `.ts` files — `auth-routes.ts`, `event-side-effects.ts`, `current-user.ts`, `push-service.ts` under `src/server/**`
- React components: PascalCase `.tsx` files — `LoginPanel.tsx`, `AdminPanel.tsx` under `src/client/components/`
- Tests: co-located alongside source, suffix `.test.ts` / `.test.tsx` (e.g. `src/server/auth/otp.test.ts`, `src/client/components/login-panel.test.tsx`)
- E2E specs: `.spec.ts` under `e2e/` (e.g. `e2e/hermes-flow.spec.ts`)
- SQL migrations: zero-padded numeric prefix + snake_case description — `NNNN_*.sql` (e.g. `src/server/db/migrations/0015_user_api_tokens.sql`); applied lexicographically by `src/server/db/migrate.ts`

**Functions:**
- camelCase verbs: `createHermesApp`, `requireUser`, `issueLoginChallenge`, `serializeInviteCode`, `scheduleDatabaseSnapshot`
- React components and factory functions exported as PascalCase: `App`, `EventBoard`, `LoginPanel`, `createXRouter`
- Predicates use `can*` / `should*` / `is*` / `has*`: `canCreateEvent()`, `canManageEvent()`, `shouldAutoArchive()` in `src/server/domain/`

**Variables:**
- camelCase locals (`databasePath`, `started`, `baseUrl`)
- SCREAMING_SNAKE_CASE for module constants and exported header names: `CSRF_HEADER`, `PAIR_TOKEN_TTL_MS` (`src/server/auth/csrf.ts`, `src/server/auth/pairing-tokens.ts`)
- Environment variable names: `HERMES_*` prefix throughout (`HERMES_DB_PATH`, `HERMES_COOKIE_SECURE`, `HERMES_MAIL_MODE`, `HERMES_DEV_LOGIN_CODE`, `HERMES_VAPID_PUBLIC_KEY`)

**Types:**
- PascalCase interfaces and type aliases: `DatabaseContext`, `AppSettings`, `User`, `StartedApp`
- Drizzle row types via `typeof table.$inferSelect` (e.g. `typeof users.$inferSelect` in `src/server/http/auth-routes.ts`)
- API error codes: lowercase German snake_case strings — `ungueltiges_event`, `nicht_angemeldet`, `admin_erforderlich`, `mailversand_fehlgeschlagen`

## Code Style

**Formatting:**
- No Prettier or Biome config present in repo (no `.prettierrc*`, `biome.json`)
- 2-space indentation throughout `.ts`/`.tsx` files
- Double-quoted strings (e.g. `import { Router } from "express";`)
- Trailing semicolons enforced by convention
- Object/array trailing commas omitted in single-line definitions, used in multi-line where natural

**Linting:**
- No ESLint config present (no `.eslintrc*`, `eslint.config.*`)
- TypeScript strict mode is the primary correctness gate — `tsconfig.json` enables `strict: true`, `forceConsistentCasingInFileNames: true`, `isolatedModules: true`, `noEmit: true`
- Type-checking runs via `tsc --noEmit` as part of `npm run build` (`package.json`)

## Import Organization

**Order (observed in `src/server/http/auth-routes.ts`):**
1. Third-party packages (`drizzle-orm`, `express`, `zod`)
2. Node built-ins with `node:` protocol (`node:crypto`, `node:fs`, `node:os`, `node:path`)
3. Internal relative imports grouped by feature (`../auth/csrf`, `../db/schema`, `../mail/mailer`)
4. Type-only imports use `import type { ... }` (e.g. `import type { DatabaseContext } from "../db/client"`)

**Path Aliases:**
- None configured. All internal imports use relative paths (`../db/schema`, `./otp`).

**Module System:**
- ESM throughout. `package.json` declares `"type": "module"`; `tsconfig.json` uses `module: "ESNext"` and `moduleResolution: "Bundler"`.

## Error Handling

**HTTP error codes (German, machine-readable):**
- `400` validation: `ungueltiges_event`, `ungueltiger_user`, `ungueltige_settings`, `leerer_profil_patch`
- `401` unauthenticated: `nicht_angemeldet`
- `403` forbidden: `admin_erforderlich`, `manager_erforderlich`, `verboten`
- `409` conflict: duplicates, full events, completed-event mutations
- `500` infrastructure: `mailversand_fehlgeschlagen`, `backup_fehlgeschlagen`, `restore_fehlgeschlagen`

**Patterns:**
- Validation: Zod schemas at the top of each route module (`src/server/http/auth-routes.ts` lines 36-80) with `.parse()` / `.safeParse()` at the boundary
- Route handlers use **early returns** after every `response.status(...).json(...)` to avoid fall-through
- Response shape on error: `{ error: "<code>" }`
- Async handlers wrap risky side effects in `try { ... } catch (error) { console.error("[Hermes] ...", error); return response.status(500).json({ error: "..." }); }`
- Client maps backend codes to user-facing strings via `errorMessages` in `src/main.tsx`; client throws `ApiError` from `src/client/errors/errors.ts` (used in `src/client/components/login-panel.test.tsx`)

**Response payload conventions:**
- Wrap named resources: `{ user }`, `{ users }`, `{ event }`, `{ events }`, `{ settings }`, `{ inviteCode }`, `{ auditLogs }`
- Empty successful deletes return `204`

## Logging

**Framework:** `console` only — no logger library

**Patterns:**
- Prefix every log line with `[Hermes]` for grep-ability
- `console.error("[Hermes] <context>", error)` for failures (e.g. `src/server/audit-log.ts:47`, `src/server/http/auth-routes.ts:392`, `src/server/storage/s3-storage.ts:524`)
- `console.warn("[Hermes] ...")` for degraded states (e.g. `src/server/push/push-service.ts:48` "Push skipped: VAPID keys are missing.")
- `console.log("[Hermes] ...")` for lifecycle events (server start in `src/server/index.ts:8`, snapshot restore in `src/server/storage/s3-storage.ts:760`)
- **Never log secret values.** Mailer logs the dev OTP only when `HERMES_MAIL_MODE=console` (`src/server/mail/mailer.ts:56`); credentials are described by source/format only.

## Async Patterns

- `async`/`await` throughout — no `.then()` chains in source
- Express handlers are `async` arrow/function expressions; errors are caught locally (no global error middleware seen in `src/server/app.ts`)
- Multi-statement DB mutations wrapped in `context.sqlite.transaction(() => { ... })()` for atomicity (registration, login verification, user deletion, migration application — see AGENTS.md§Database Patterns)
- Background work (S3 snapshot upload, status refresh) uses debounced/scheduled functions: `scheduleDatabaseSnapshot()`, `refreshEventStatuses()` 30 s loop in `src/server/app.ts`
- Server lifecycle exposes `close()` so tests and SIGINT/SIGTERM handlers (`src/server/index.ts`) can flush snapshots and close SQLite cleanly

## Comments

**When to Comment:**
- Source files are largely self-documenting; comments are sparse and reserved for non-obvious behavior
- Migration files contain inline SQL only — no header comments observed
- No JSDoc/TSDoc generation pipeline; types carry the documentation load

## Function Design

**Size:** Route handlers favor flat control flow with early returns; helpers extracted as file-local functions (`nowIso()`, `fallbackPhoneNumber()`, `normalizeInviteCode()`).

**Parameters:**
- Routers receive a shared `DatabaseContext`: `createXRouter(context: DatabaseContext)` (see `src/server/http/auth-routes.ts`, all `*-routes.ts` files)
- Domain helpers take explicit `context` first, then domain inputs — never reach into globals for the DB

**Return Values:**
- Async functions return promises of plain objects matching API shapes
- Validators return `boolean` or throw via Zod
- Drizzle queries return inferred row types; serializer helpers shape them into API DTOs

## Module Design

**Exports:**
- Named exports throughout — no default exports for routes, services, or utilities
- Default exports reserved for config files (`vite.config.ts`, `playwright.config.ts`)

**Barrel Files:** Not used. All imports reach directly into the implementing module.

**Router factory pattern:** Every HTTP module exports `createXRouter(context)` rather than a singleton router; this keeps the DB context injectable for tests (see `src/server/http/auth-routes.ts`, `event-routes.ts`, `admin-routes.ts`, `push-routes.ts`, `realtime-routes.ts`).

## Configuration Files

- `package.json` — scripts, dependencies, ESM declaration
- `tsconfig.json` — strict TS, ES2022 target, JSX `react-jsx`, bundler resolution
- `vite.config.ts` — React plugin, fixed ports 5173 (dev) / 4173 (preview), `strictPort: true`
- `playwright.config.ts` — `testDir: "./e2e"`, Desktop Chrome device, `fullyParallel: false`, 30 s timeout
- `Dockerfile` — two-stage Node 22 build, prunes dev deps, exposes `:3000`, healthchecks `/api/health`
- `docker-compose.yml` — local image, `hermes-data` volume, S3 env defaults
- `.github/workflows/docker-image.yml` — CI: `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`, then build/publish image
- `.env.example` — documents every required `HERMES_*` env var (no real secrets in repo)

## Commit Conventions

**Format:** [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`

**Observed types:** `feat`, `fix`, `chore`, `docs`, `style`, `refactor`

**Observed scopes:** real code areas only — `auth`, `events`, `nav`, `kiosk`, `db`, `api`, `ui`, `footer`, `settings`, `roles`, `release`

**Examples from `git log`:**
- `feat(api): user API tokens (full/read-only), Bearer auth, OpenAPI + Swagger UI`
- `fix(db): Migrationen mit DROP users — foreign_keys vor Transaktion aus`
- `style(footer): GitHub mark + Source Release text in black, no footer fill`
- `chore(release): v0.9.0`

**Subject lines:** under ~72 chars, imperative mood, no trailing period. German and English both appear in the subject body and are accepted.

## Migration Naming

- Pattern: `NNNN_<snake_case_description>.sql` under `src/server/db/migrations/`
- Sequence is zero-padded 4-digit (currently `0001`–`0015`); `src/server/db/migrate.ts` sorts lexicographically and records applied filenames in `schema_migrations`
- Each migration is plain SQL (no Drizzle migration generator). Schema changes must update **both** `src/server/db/schema.ts` (Drizzle definitions) **and** add a new numeric SQL file
- `npm run build:server` copies migrations into both `dist-server/migrations/` and `dist-server/db/migrations/` for runtime resolution

## Environment And Secrets Handling

- `src/server/env.ts` reads a local `.env` manually and never overrides already-set process env values
- Required vars use `readRequiredEnv(name)` so missing values fail loudly
- Cookie security toggled via `HERMES_COOKIE_SECURE` in `src/server/auth/sessions.ts`
- Storage backend selected via `HERMES_STORAGE_BACKEND` in `src/server/storage/s3-storage.ts`
- DB path via `getDatabasePath()` (defaults to `data/hermes.sqlite`)
- Tests set disposable env vars directly and use temporary SQLite files under `os.tmpdir()` (see `src/server/http/app-flow.test.ts:36-46`)

---

*Convention analysis: 2026-05-01*

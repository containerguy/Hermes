# Coding Conventions

## Project Shape

- Hermes is a TypeScript ESM project: `package.json` sets `"type": "module"` and `tsconfig.json` uses `module: "ESNext"`, `moduleResolution: "Bundler"`, `target: "ES2022"`, `strict: true`, and `jsx: "react-jsx"`.
- The codebase is split into a React/Vite frontend in `src/main.tsx` and `src/styles.css`, plus an Express/SQLite backend under `src/server/`.
- Server modules are organized by concern:
  - HTTP routers: `src/server/http/auth-routes.ts`, `src/server/http/admin-routes.ts`, `src/server/http/event-routes.ts`, `src/server/http/push-routes.ts`, `src/server/http/realtime-routes.ts`
  - Domain rules: `src/server/domain/events.ts`, `src/server/domain/users.ts`
  - Persistence: `src/server/db/client.ts`, `src/server/db/schema.ts`, `src/server/db/migrate.ts`, `src/server/db/migrations/*.sql`
  - Auth/session helpers: `src/server/auth/current-user.ts`, `src/server/auth/sessions.ts`, `src/server/auth/otp.ts`
  - Integrations and cross-cutting services: `src/server/mail/mailer.ts`, `src/server/push/push-service.ts`, `src/server/storage/s3-storage.ts`, `src/server/realtime/event-bus.ts`, `src/server/audit-log.ts`, `src/server/settings.ts`

## TypeScript Style

- Imports use ESM syntax throughout. Type-only imports are explicit, for example `import type { DatabaseContext } from "../db/client";` in route modules.
- Runtime validation is done with Zod at API and domain boundaries. Examples:
  - `eventInputSchema` in `src/server/domain/events.ts`
  - route-local schemas such as `requestCodeSchema`, `verifyCodeSchema`, and `registerSchema` in `src/server/http/auth-routes.ts`
  - `settingsSchema` usage in `src/server/http/admin-routes.ts`
- Inferred types are preferred where practical. Drizzle table row types use `typeof table.$inferSelect`, for example `issueLoginChallenge(context, user: typeof users.$inferSelect)` in `src/server/http/auth-routes.ts`.
- Helper functions are file-local unless reused elsewhere. Common examples include `nowIso()`, `fallbackPhoneNumber()`, `normalizeInviteCode()`, and serializer helpers in route modules.
- Timestamps are stored and exchanged as ISO strings using `new Date().toISOString()`.
- IDs are generated with `randomUUID()` for database entities, while session tokens use `randomBytes(32).toString("base64url")` in `src/server/auth/sessions.ts`.

## Backend HTTP Patterns

- `src/server/app.ts` owns Express app composition. It disables `x-powered-by`, installs `express.json({ limit: "1mb" })`, installs `cookieParser()`, mounts API routers under `/api/*`, serves `dist` when present, and exposes a `close()` lifecycle hook for tests and shutdown.
- Routers are created with `createXRouter(context: DatabaseContext)` and receive the shared SQLite/Drizzle context instead of creating their own database connections.
- Authentication is checked through `requireUser()`, `requireAdmin()`, or `getCurrentSession()` from `src/server/auth/current-user.ts`.
- Route handlers use early returns after every response. This keeps control flow flat and avoids fall-through after `response.status(...).json(...)` or `response.status(...).send()`.
- Validation failures generally return `400` with a German machine-readable error code, such as `ungueltiges_event`, `ungueltiger_user`, or `ungueltige_settings`.
- Auth/permission failures use `401` for unauthenticated users and `403` for authenticated users without required role, with codes such as `nicht_angemeldet`, `admin_erforderlich`, `manager_erforderlich`, or `verboten`.
- State conflicts use `409`, for example duplicate users, full events, and attempts to mutate completed events.
- Integration or persistence failures are logged with `console.error("[Hermes] ...", error)` and returned as stable error codes, for example `mailversand_fehlgeschlagen`, `backup_fehlgeschlagen`, and `restore_fehlgeschlagen`.
- Response payloads wrap named resources: `{ user: ... }`, `{ users: ... }`, `{ event: ... }`, `{ events: ... }`, `{ settings: ... }`, `{ inviteCode: ... }`, `{ auditLogs: ... }`. Empty successful deletes usually use `204`.

## Database Patterns

- SQLite is accessed through `better-sqlite3` plus Drizzle. `src/server/db/client.ts` enables WAL mode and foreign keys via pragmas.
- Drizzle schema definitions live in `src/server/db/schema.ts`, while executable migrations are plain SQL files in `src/server/db/migrations/`.
- Migrations are applied by `runMigrations()` in `src/server/db/migrate.ts`. Applied filenames are tracked in the `schema_migrations` table and migration files are sorted lexicographically, so filenames use numeric prefixes such as `0001_initial.sql`.
- Schema changes should update both `src/server/db/schema.ts` and a new SQL migration under `src/server/db/migrations/`.
- Multi-statement mutations use `context.sqlite.transaction(() => { ... })()` where atomicity matters, for example registration, login verification, user deletion, and migration application.
- Drizzle is used for most CRUD. Raw SQL is used for aggregate counts, restore operations, and migration internals, for example `COUNT(*)` in `serializeInviteCode()` and `countJoined()`.
- Soft deletion is used for users. `src/server/http/admin-routes.ts` anonymizes deleted users and sets `deletedAt`; authentication and user listing filter with `isNull(users.deletedAt)`.
- Audit logging is part of most business actions. Route handlers call `writeAuditLog()` with an actor, action string, entity fields, human summary, and optional metadata.

## Frontend React Patterns

- The frontend is a single React file in `src/main.tsx` with local TypeScript types for API resources, page state, and settings.
- Routing is hash-based. `routes` defines page metadata, and `getPageFromHash()` maps `window.location.hash` to a `PageId`.
- Server calls go through `requestJson<T>()`, which sends cookies with `credentials: "include"`, sets `Content-Type: application/json`, maps JSON `{ error }` responses to thrown `Error`s, and treats `204` as `undefined`.
- UI state uses React hooks directly (`useState`, `useEffect`) rather than a global store.
- Forms use controlled inputs and `FormEvent<HTMLFormElement>` handlers.
- User-facing errors are translated through `errorMessages` in `src/main.tsx`; backend error codes should be added there when introducing new API errors.
- Live event updates use `EventSource("/api/realtime/events", { withCredentials: true })` with a 30-second polling fallback in `EventBoard`.
- Theme settings are applied through CSS custom properties in `applyTheme()`, mapping settings to variables such as `--teal`, `--rose`, `--amber`, `--blue`, and `--surface`.

## CSS Conventions

- Styling is centralized in `src/styles.css`; there is no CSS module or CSS-in-JS pattern.
- Design tokens are CSS variables on `:root`, including colors, shadows, and text colors.
- Layout relies on CSS Grid/Flexbox with responsive constraints. Examples include `.page-shell`, `.page-hero`, `.manager-board`, `.events-board .event-list`, `.topbar`, and `.nav-links`.
- Common controls share base selectors: `button`, `.text-link`, `input`, `select`, and `label`.
- Cards and panels share a grouped rule for `event-form`, `event-card`, `login-panel`, `admin-panel`, `access-panel`, and `auth-visual`.
- Radius is consistently `8px` for controls, cards, icons, and navigation pills.
- Accessibility-oriented sizing is visible in controls: buttons and inputs use `min-height: 44px`; Playwright tests select by labels, roles, and visible text, so labels and button names are part of the test contract.

## Environment And Secrets Handling

- `src/server/env.ts` loads a local `.env` file manually and does not override already-set environment variables.
- Required environment variables should be read with `readRequiredEnv(name)` so missing values fail clearly.
- Optional configuration is read from `process.env` at the point of use, for example cookie security in `src/server/auth/sessions.ts`, storage mode in `src/server/storage/s3-storage.ts`, and database path in `src/server/env.ts`.
- Do not log secret values. Existing error messages mention missing credential sources and supported key formats, but do not print credential contents.
- Tests set disposable environment variables directly and use temporary SQLite files under `os.tmpdir()`.

## Build And Script Conventions

- Main scripts in `package.json`:
  - `npm run dev`: Vite dev server on `0.0.0.0`.
  - `npm run build`: Type-checks with `tsc --noEmit`, builds the Vite frontend, then bundles server entrypoints.
  - `npm run build:server`: bundles `src/server/index.ts` and `src/server/db/bootstrap-admin.ts` with esbuild, keeps packages external, and copies SQL migrations into `dist-server`.
  - `npm run server`: runs `src/server/index.ts` through `tsx`.
  - `npm run db:migrate`: runs `src/server/db/migrate.ts`.
  - `npm test`: runs Vitest against `src`.
  - `npm run test:e2e`: builds first, then runs Playwright.

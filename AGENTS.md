<!-- GSD:project-start source:PROJECT.md -->
## Project

**Hermes**

Hermes is a responsive LAN-party coordination WebApp for roughly 25 people. It lets players log in with username and email one-time code, see proposed game rounds, vote `dabei` or `nicht dabei`, find start/server details, and receive notifications across smartphone and PC.

The current product is a brownfield TypeScript/React/Express app with SQLite as the active database and optional Wasabi/S3 snapshot storage. Admins manage users, managers, settings, invite codes, audit logs, backups, restore, and visual theme colors.

**Core Value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.

### Constraints

- **Tech stack**: TypeScript, React/Vite, Express, SQLite, Drizzle, Web Push, Docker — already implemented and should be preserved unless a concrete risk demands change.
- **Deployment**: Single Dockerized app is the target; SSL/TLS and reverse proxy remain out of scope for Hermes itself.
- **Storage**: Local SQLite is the active database; Wasabi/S3 is snapshot backup/restore, not multi-writer storage.
- **Scale**: Optimize for about 25 LAN-party participants, not public SaaS scale.
- **Login cost**: Login codes are sent by email, not SMS.
- **Participation model**: Only `dabei` and `nicht dabei`; no waitlist.
- **Compatibility**: Smartphone and PC browsers must both be usable; push quality depends on PWA/secure-context limitations.
- **Security**: Credentials and secrets must remain in env vars or local ignored files, never planning docs.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Runtime And Language
- Primary language: TypeScript with strict checking configured in `tsconfig.json`.
- Runtime target: Node.js 22. The Docker image uses `node:22-bookworm-slim` in `Dockerfile`, and CI sets `NODE_VERSION: "22"` in `.github/workflows/docker-image.yml`.
- Module format: ESM via `"type": "module"` in `package.json`.
- Browser target: modern DOM APIs through `lib: ["DOM", "DOM.Iterable", "ES2022"]` in `tsconfig.json`.
## Frontend
- UI framework: React 19 (`react`, `react-dom`) mounted from `src/main.tsx`.
- Build tool: Vite 7 with `@vitejs/plugin-react` configured in `vite.config.ts`.
- Client routing: hash-based page sections in `src/main.tsx` for `#events`, `#login`, `#manager`, and `#admin`; there is no separate router package.
- Styling: plain CSS in `src/styles.css`.
- PWA surface: `public/manifest.webmanifest`, `public/sw.js`, and `public/icon.svg`.
- Client API access: direct `fetch` helper in `src/main.tsx` with `credentials: "include"` for cookie-backed sessions.
- Realtime client: `EventSource` in `src/main.tsx` connects to `/api/realtime/events` and falls back to periodic polling every 30 seconds.
- Web Push client: `src/main.tsx` registers `/sw.js`, requests `Notification` permission, subscribes through `PushManager`, and posts subscriptions to `/api/push/subscriptions`.
## Backend
- HTTP framework: Express 5 in `src/server/app.ts`.
- Server entrypoint: `src/server/index.ts` reads `HERMES_HOST` and `HERMES_PORT`, starts the Express app, and flushes persistence on `SIGINT`/`SIGTERM`.
- App composition: `src/server/app.ts` wires JSON parsing, cookies, health checks, settings, auth, admin, events, push, realtime, static assets, and SPA fallback.
- Cookie parsing: `cookie-parser` is installed in `package.json` and mounted in `src/server/app.ts`.
- Request validation: Zod schemas are used in route/domain modules such as `src/server/http/auth-routes.ts`, `src/server/http/admin-routes.ts`, `src/server/http/event-routes.ts`, `src/server/http/push-routes.ts`, `src/server/domain/events.ts`, and `src/server/settings.ts`.
- Auth model: username plus email one-time code in `src/server/http/auth-routes.ts`, OTP generation/hash/verify in `src/server/auth/otp.ts`, and session cookies in `src/server/auth/sessions.ts`.
- Authorization model: roles `user`, `manager`, and `admin` are represented in `src/server/db/schema.ts` and checked in `src/server/domain/users.ts`, `src/server/auth/current-user.ts`, and route modules.
- Realtime model: Server-Sent Events are implemented in `src/server/realtime/event-bus.ts` and exposed by `src/server/http/realtime-routes.ts`.
## Data Layer
- Database: SQLite through `better-sqlite3`.
- ORM/query layer: Drizzle ORM with `drizzle-orm/better-sqlite3` in `src/server/db/client.ts` and table definitions in `src/server/db/schema.ts`.
- Database path: `getDatabasePath()` in `src/server/env.ts` reads `HERMES_DB_PATH` and defaults to `data/hermes.sqlite` under the process cwd.
- SQLite pragmas: `src/server/db/client.ts` enables WAL mode and foreign keys.
- Migrations: SQL files live in `src/server/db/migrations/`; `src/server/db/migrate.ts` applies sorted `.sql` files and records them in `schema_migrations`.
- Main tables: users, login challenges, sessions, push subscriptions, game events, participations, app settings, audit logs, invite codes, invite uses, and schema migrations in `src/server/db/schema.ts`.
- App settings: typed settings live in SQLite table `app_settings` and are read/written through `src/server/settings.ts`.
## Build And Packaging
- Main build script: `npm run build` runs TypeScript checking, Vite frontend build, and server bundling as declared in `package.json`.
- Server bundling: `npm run build:server` uses esbuild to bundle `src/server/index.ts` and `src/server/db/bootstrap-admin.ts` into `dist-server/`, while copying SQL migrations into both `dist-server/migrations/` and `dist-server/db/migrations/`.
- Frontend output: Vite writes the browser app to `dist/`.
- Runtime start: `npm start` runs `node dist-server/index.js`.
- Development commands: `npm run dev` starts Vite on host `0.0.0.0`; `npm run server` runs the TypeScript server through `tsx`.
- Docker build: `Dockerfile` uses a two-stage Node 22 build/runtime image, prunes dev dependencies, exposes port 3000, stores data under `/data`, and health-checks `/api/health`.
- Docker Compose: `docker-compose.yml` builds `hermes:local`, maps port `3000:3000`, mounts `hermes-data:/data`, mounts `./s3.creds` read-only, and sets S3-oriented environment defaults.
## Testing And Quality
- Unit/integration test runner: Vitest 4 via `npm test`, scoped to `src`.
- HTTP tests: Supertest is used in `src/server/http/app-flow.test.ts`.
- Existing focused tests: `src/server/auth/otp.test.ts`, `src/server/domain/events.test.ts`, `src/server/http/app-flow.test.ts`, and `src/server/storage/s3-storage.test.ts`.
- Browser E2E: Playwright configured in `playwright.config.ts`; `npm run test:e2e` builds first and then runs `playwright test`.
- CI verification: `.github/workflows/docker-image.yml` runs `npm ci`, `npm test`, `npm run build`, and `npm audit --omit=dev` before Docker image build/publish.
## Configuration Surface
- Local env loading: `src/server/env.ts` reads `.env` manually if present and does not override already-set process env values.
- Example config: `.env.example` documents database path, server port, cookie security, S3, admin bootstrap, SMTP, VAPID, and local dev login code variables.
- Admin bootstrap: `src/server/db/bootstrap-admin.ts` requires admin phone, username, and email env variables, then creates or updates the primary admin.
- Cookie security: `src/server/auth/sessions.ts` sets `httpOnly`, `sameSite: "lax"`, and `secure` based on `HERMES_COOKIE_SECURE`.
- Production notes: `readme.md` and `building.md` document local start, Docker start, S3 behavior, mail, push, backup/restore, and CI image publishing.
## Deployment Shape
- Intended runtime: a single Node/Express instance with local SQLite as the active database.
- Static serving: `src/server/app.ts` serves `dist/` if present and falls back to `index.html` for non-API paths.
- Health endpoint: `/api/health` is implemented in `src/server/app.ts` and used by the Docker `HEALTHCHECK`.
- Container registry: `.github/workflows/docker-image.yml` publishes `ghcr.io/containerguy/hermes` on pushes to `main`, version tags, and manual dispatch; pull requests build without pushing.
- Operational caveat: `readme.md` and `building.md` state S3 is snapshot storage, not a locking backend for multiple simultaneous writers.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Project Shape
- Hermes is a TypeScript ESM project: `package.json` sets `"type": "module"` and `tsconfig.json` uses `module: "ESNext"`, `moduleResolution: "Bundler"`, `target: "ES2022"`, `strict: true`, and `jsx: "react-jsx"`.
- The codebase is split into a React/Vite frontend in `src/main.tsx` and `src/styles.css`, plus an Express/SQLite backend under `src/server/`.
- Server modules are organized by concern:
## TypeScript Style
- Imports use ESM syntax throughout. Type-only imports are explicit, for example `import type { DatabaseContext } from "../db/client";` in route modules.
- Runtime validation is done with Zod at API and domain boundaries. Examples:
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
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Overview
- Browser UI starts at `src/main.tsx` and imports global styling from `src/styles.css`.
- Server startup is `src/server/index.ts`, which calls `createHermesApp()` from `src/server/app.ts`.
- Database access is centralized through `src/server/db/client.ts` and schema definitions in `src/server/db/schema.ts`.
- API behavior is split by concern under `src/server/http/*`.
- Domain validation and authorization helpers live under `src/server/domain/*`.
- Static PWA/push assets live in `public/sw.js`, `public/manifest.webmanifest`, and `public/icon.svg`.
## Runtime Composition
- Restores a SQLite snapshot from S3 when configured via `restoreDatabaseFromStorageIfNeeded()`.
- Creates a `DatabaseContext` using `createDb()` from `src/server/db/client.ts`.
- Applies SQL migrations through `runMigrations()` from `src/server/db/migrate.ts`.
- Configures Express JSON parsing, cookie parsing, health/settings endpoints, and all API routers.
- Schedules S3 database snapshots after successful non-read API responses.
- Runs a 30-second status refresh loop via `refreshEventStatuses()` and broadcasts realtime changes through `broadcastEventsChanged()`.
- Serves built frontend files from `dist/` when that directory exists, falling back to `dist/index.html` for non-API routes.
- Exposes `close()` to flush snapshots and close SQLite cleanly.
## Client Architecture
- `requestJson()` wraps `fetch()` with `credentials: "include"` so cookie sessions work across API calls.
- `App()` owns top-level state for the current route, logged-in user, and settings.
- `EventBoard()` loads `/api/events`, opens an `EventSource` to `/api/realtime/events`, falls back to 30-second polling, creates events in manager mode, updates event start times, cancels/archives events, and manages participation.
- `LoginPanel()` handles email OTP login, invite registration, logout, session revocation, and Web Push subscription setup.
- `AdminPanel()` handles user management, invite codes, audit log display, settings updates, and backup/restore actions.
- `applyTheme()` maps server-managed settings to CSS custom properties used by `src/styles.css`.
## API Layer
- `/api/health` returns basic liveness.
- `/api/settings` returns public settings from `src/server/settings.ts`.
- `/api/auth` is implemented by `src/server/http/auth-routes.ts`.
- `/api/admin` is implemented by `src/server/http/admin-routes.ts`.
- `/api/events` is implemented by `src/server/http/event-routes.ts`.
- `/api/push` is implemented by `src/server/http/push-routes.ts`.
- `/api/realtime` is implemented by `src/server/http/realtime-routes.ts`.
## Authentication And Authorization
- `src/server/auth/sessions.ts` creates base64url session tokens, sets/clears the `hermes_session` cookie, and honors `HERMES_COOKIE_SECURE`.
- `src/server/auth/otp.ts` generates six-digit one-time codes and stores/verifies scrypt hashes.
- `src/server/auth/current-user.ts` resolves the current session from the cookie, joins `sessions` to `users`, rejects revoked sessions/deleted users, updates `lastSeenAt`, and exposes `requireUser()`/`requireAdmin()`.
- `src/server/http/auth-routes.ts` creates login challenges, sends email codes, verifies codes, creates sessions, lists sessions, revokes sessions, logs out, and supports invite-based registration when settings allow it.
- Roles are `user`, `manager`, and `admin` in `src/server/domain/users.ts`.
- Managers and admins can create events through `canCreateEvent()`.
- Admins, managers, and event creators can manage an event through `canManageEvent()`.
- Admin APIs enforce admin access in `src/server/http/admin-routes.ts` before route handlers run.
## Event Domain
- `eventInputSchema` validates event title, start mode, optional scheduled start time, min/max players, and optional connection fields.
- `deriveEventStatus()` maps an event to `open`, `ready`, or `running` unless already `cancelled` or `archived`.
- `shouldAutoArchive()` archives events after the configured hour window.
- `GET /api/events` refreshes statuses and serializes events with creator name, joined count, and current user's participation.
- `POST /api/events` creates events for managers/admins, writes an audit log, broadcasts SSE updates, and sends push notifications.
- `PATCH /api/events/:id` lets authorized users update active event metadata and start time.
- `POST /api/events/:id/participation` upserts joined/declined participation, enforces max capacity, recalculates status, broadcasts realtime updates, and sends push when status changes.
- `POST /api/events/:id/cancel` and `/archive` mark terminal states, audit them, broadcast, and notify.
## Persistence
- `src/server/db/client.ts` creates the SQLite file directory, opens the database, enables WAL mode and foreign keys, and returns `{ sqlite, db }`.
- The database path comes from `getDatabasePath()` in `src/server/env.ts`, defaulting to `data/hermes.sqlite`.
- `src/server/db/schema.ts` defines tables for users, login challenges, sessions, push subscriptions, game events, participations, app settings, audit logs, invite codes, and invite code uses.
- SQL migrations are stored in `src/server/db/migrations/*.sql`.
- `src/server/db/migrate.ts` tracks applied migration filenames in `schema_migrations` and can run as a CLI entrypoint.
- `src/server/db/bootstrap-admin.ts` is bundled as a separate server utility and used by tests to create the initial admin.
## Settings And Audit Log
## Mail, Push, And Realtime
- Console mode is the default and logs the code for local/dev use.
- SMTP mode reads host, port, user/password, sender, and TLS/STARTTLS settings from environment variables.
- The client registers `public/sw.js`, requests notification permission, subscribes with the VAPID public key, and posts the subscription to `/api/push/subscriptions`.
- `src/server/http/push-routes.ts` exposes the VAPID public key, upserts/revokes subscriptions, and updates user notification preferences.
- `src/server/push/push-service.ts` configures `web-push`, sends payloads to active subscriptions for notification-enabled users, and revokes subscriptions that return 404/410.
- `public/sw.js` displays push notifications and focuses or opens the target URL on click.
- `src/server/realtime/event-bus.ts` maintains in-memory Express `Response` clients and emits `connected` and `events_changed` events.
- `src/server/http/realtime-routes.ts` exposes authenticated `/api/realtime/events`.
- `src/main.tsx` listens via `EventSource` and reloads events on change, with polling as a fallback.
## Backup And Restore
- Enabled when `HERMES_STORAGE_BACKEND=s3`.
- Restore can run at app start through `restoreDatabaseFromStorageIfNeeded()`.
- Mutating API responses schedule a debounced snapshot upload via `scheduleDatabaseSnapshot()`.
- Shutdown and migration paths flush/persist snapshots explicitly.
- Admin backup and restore endpoints call `persistDatabaseSnapshot()` and `restoreDatabaseSnapshotIntoLive()`.
- The restore path attaches the downloaded SQLite database and copies known restorable tables into the live database with foreign keys temporarily disabled.
## Build, Deployment, And Scripts
- `npm run dev` starts Vite on port 5173.
- `npm run server` runs `src/server/index.ts` with `tsx`.
- `npm run build` type-checks, builds the Vite client, and builds server bundles.
- `npm run build:server` uses `esbuild` to bundle `src/server/index.ts` and `src/server/db/bootstrap-admin.ts` into `dist-server/`, then copies migrations into both `dist-server/migrations/` and `dist-server/db/migrations/`.
- `npm run start` runs `node dist-server/index.js`.
- `npm run test` runs Vitest tests under `src`.
- `npm run test:e2e` builds and runs Playwright tests.
## Testing Architecture
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
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

# Technology Stack

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

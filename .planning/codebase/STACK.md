# Technology Stack

**Analysis Date:** 2026-05-01

## Languages

**Primary:**
- TypeScript 5.9.3 — All client (`src/client/`) and server (`src/server/`) code; strict mode (see `tsconfig.json`)

**Secondary:**
- JavaScript (ESM) — Service worker `src/shared/sw.js`
- SQL — Drizzle migrations in `src/server/db/migrations/*.sql`
- YAML — OpenAPI spec `src/server/openapi/hermes-api.yaml`, GitHub Actions `.github/workflows/docker-image.yml`
- HTML — Single root template `index.html`

## Runtime

**Environment:**
- Node.js 22 (Docker base `node:22-bookworm-slim` in `Dockerfile`; CI pinned via `NODE_VERSION: "22"` in `.github/workflows/docker-image.yml`)
- Browser runtime: modern evergreen (target ES2022, see `tsconfig.json`)

**Package Manager:**
- npm (lockfile `package-lock.json` present at repo root)
- Lockfile: present
- No `.nvmrc` detected (Node version pinned in Dockerfile + CI workflow)

## Frameworks

**Core (server):**
- Express 5.2.1 — HTTP server (`src/server/app.ts`, route modules under `src/server/http/`)
- Drizzle ORM 0.45.2 — SQLite typed access (`src/server/db/client.ts`, schema in `src/server/db/schema.ts`)
- better-sqlite3 12.9.0 — Synchronous SQLite driver (`src/server/db/client.ts`)
- Zod 4.3.6 — Request/payload validation (used across `src/server/http/*`)
- cookie-parser 1.4.7 — Cookie middleware (`src/server/app.ts`)

**Core (client):**
- React 19.2.3 + ReactDOM 19.2.3 — UI (`src/client/components/`, entry `src/main.tsx`)
- react-markdown 10.1.0 — Markdown rendering in components
- qrcode-generator 1.4.4 — QR codes for kiosk/pairing flows

**Testing:**
- Vitest 4.1.4 — Unit/integration tests (run via `npm test` → `vitest run src`)
- jsdom 29.0.2 — DOM env for component/service-worker tests (`src/server/push/service-worker-push.test.ts`)
- Supertest 7.2.2 (`@types/supertest`) — HTTP assertions against the Express app
- Playwright 1.59.1 — E2E tests in `e2e/` (config `playwright.config.ts`, runs Desktop Chrome)

**Build / Dev:**
- Vite 7.3.0 + `@vitejs/plugin-react` 5.1.1 — Client dev server and bundler (`vite.config.ts`, ports 5173 dev / 4173 preview)
- esbuild 0.28.0 — Server bundler (see `build:server` script in `package.json`)
- tsx 4.21.0 — TypeScript execution for `dev`/`server`/migration scripts
- TypeScript compiler — Type-check only (`tsc --noEmit` step in `build`)

## Key Dependencies

**Critical:**
- `@aws-sdk/client-s3` ^3.1030.0 — S3-compatible snapshot persistence (`src/server/storage/s3-storage.ts`)
- `web-push` ^3.6.7 — Web Push notifications via VAPID (`src/server/push/push-service.ts`)
- `nodemailer` ^8.0.5 — SMTP delivery for OTP emails (`src/server/mail/mailer.ts`)
- `better-sqlite3` ^12.9.0 — Primary datastore driver
- `drizzle-orm` ^0.45.2 — Query builder + schema definition
- `express` ^5.2.1 — HTTP layer

**Infrastructure:**
- Docker multi-stage build (`Dockerfile`) — Build stage compiles, runtime stage runs `node dist-server/index.js`
- docker-compose (`docker-compose.yml`) — Local stack; mounts `./s3.creds` and `hermes-data` volume

## Configuration

**Environment:**
- `.env.example` documents all `HERMES_*` variables
- Loaded by custom parser in `src/server/env.ts` (no `dotenv` dep)
- Required at runtime: `HERMES_PORT`, `HERMES_HOST`, `HERMES_DB_PATH`, `HERMES_CSRF_SECRET`
- S3: `HERMES_STORAGE_BACKEND`, `HERMES_S3_BUCKET`, `HERMES_S3_REGION`, `HERMES_S3_ENDPOINT`, `HERMES_S3_CREDS_FILE`, `HERMES_S3_DB_KEY`, `HERMES_S3_RESTORE_MODE`
- Mail: `HERMES_MAIL_MODE` (`console`|`smtp`), `HERMES_MAIL_FROM`, `HERMES_SMTP_HOST`, `HERMES_SMTP_PORT`, `HERMES_SMTP_SECURE`, `HERMES_SMTP_SECURITY`, `HERMES_SMTP_USER`, `HERMES_SMTP_PASSWORD`
- Push: `HERMES_VAPID_SUBJECT`, `HERMES_VAPID_PUBLIC_KEY`, `HERMES_VAPID_PRIVATE_KEY`
- Bootstrap: `HERMES_ADMIN_USERNAME`, `HERMES_ADMIN_EMAIL`, `HERMES_ADMIN_PHONE`
- Cookies: `HERMES_COOKIE_SECURE`
- Optional dev override: `HERMES_DEV_LOGIN_CODE`

**Build:**
- `tsconfig.json` — strict TS, ES2022, JSX `react-jsx`, `moduleResolution: Bundler`, `noEmit: true`
- `vite.config.ts` — React plugin only, fixed dev/preview ports
- `playwright.config.ts` — `e2e/` dir, single worker (`fullyParallel: false`), Desktop Chrome
- No ESLint, Prettier, or Biome config detected

## Platform Requirements

**Development:**
- Node.js 22+, npm
- Local SQLite file at `./data/hermes.sqlite`
- Optional `s3.creds` file for snapshot testing
- Mail mode `console` writes OTPs to stdout

**Production:**
- Linux/amd64 container (`docker build --platform linux/amd64`) published to GHCR `ghcr.io/containerguy/hermes`
- Persistent volume for `/data` (SQLite WAL DB)
- Outbound network for S3 endpoint (Wasabi by default), SMTP relay, and Web Push providers
- HTTP port 3000 exposed; healthcheck `GET /api/health`

---

*Stack analysis: 2026-05-01*

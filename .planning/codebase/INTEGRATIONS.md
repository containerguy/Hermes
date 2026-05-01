# External Integrations

**Analysis Date:** 2026-05-01

## APIs & External Services

**Object Storage (S3-compatible):**
- Wasabi (default endpoint `https://s3.eu-central-2.wasabisys.com`, bucket `hermes-storage`, region `eu-central-2`) — Stores/restores the SQLite snapshot for cross-deploy persistence
  - SDK/Client: `@aws-sdk/client-s3` (`PutObjectCommand`, `GetObjectCommand`, `ListObjectsV2Command`, `DeleteObjectCommand`) in `src/server/storage/s3-storage.ts`
  - Auth: credentials JSON file path in `HERMES_S3_CREDS_FILE` (mounted as `./s3.creds:/run/secrets/s3.creds:ro` in `docker-compose.yml`)
  - Selectable via `HERMES_STORAGE_BACKEND=s3|disabled`
  - Snapshot key configurable via `HERMES_S3_DB_KEY`; restore behavior controlled by `HERMES_S3_RESTORE_MODE` (e.g. `if-missing`)
  - Uploaded automatically after non-GET responses via `scheduleDatabaseSnapshot` in `src/server/app.ts`

**Email (SMTP):**
- Outbound SMTP relay — Delivers login OTP and email-change OTP to users (`src/server/mail/mailer.ts`)
  - SDK/Client: `nodemailer` `createTransport`
  - Auth: `HERMES_SMTP_USER` / `HERMES_SMTP_PASSWORD`
  - Modes: `HERMES_MAIL_MODE=console` (logs to stdout) or `smtp`
  - Security selector: `HERMES_SMTP_SECURITY=tls|starttls|none` (with legacy `HERMES_SMTP_SECURE` fallback)
  - Functions: `sendLoginCode`, `sendEmailChangeCode`

**Web Push:**
- Browser push services (FCM / Mozilla AutoPush / WNS — provider-agnostic via VAPID) — Push notifications to subscribed devices (`src/server/push/push-service.ts`)
  - SDK/Client: `web-push` (`webpush.setVapidDetails`)
  - Auth: VAPID keys `HERMES_VAPID_PUBLIC_KEY`, `HERMES_VAPID_PRIVATE_KEY`, contact `HERMES_VAPID_SUBJECT`
  - Public key exposed to clients via push routes for subscription registration (`src/server/http/push-routes.ts`)
  - Service worker handler: `src/shared/sw.js`

**API Documentation (Swagger UI):**
- unpkg.com CDN — Loads Swagger UI assets (`swagger-ui.css`, `swagger-ui-bundle.js`) version 5.11.0 from `https://unpkg.com/swagger-ui-dist@5.11.0/...` for the `/api/docs` page (`src/server/http/api-docs.ts`)
  - CSP relaxed for the `/api/docs` route only to allow unpkg + inline boot script
  - Spec served from `/api/openapi.yaml`, sourced from `src/server/openapi/hermes-api.yaml` (also copied into `dist-server/openapi/` at build)

## Data Storage

**Databases:**
- SQLite (file-backed, WAL mode)
  - Connection: `HERMES_DB_PATH` (defaults to `./data/hermes.sqlite`; container default `/data/hermes.sqlite`)
  - Client: `better-sqlite3` wrapped by `drizzle-orm/better-sqlite3` in `src/server/db/client.ts`
  - Schema: `src/server/db/schema.ts`
  - Migrations: SQL files in `src/server/db/migrations/`, applied by `src/server/db/migrate.ts`

**File Storage:**
- Local filesystem `/data` volume in container (the SQLite DB itself is the only persisted file)
- Periodic full-DB snapshot pushed to S3 (see above)

**Caching:**
- None (in-memory only — e.g. SSE client map in `src/server/realtime/event-bus.ts`, snapshot debounce timer in `src/server/storage/s3-storage.ts`)

## Authentication & Identity

**Auth Provider:**
- Custom passwordless OTP — In-house implementation
  - Implementation: `src/server/auth/` (`otp.ts`, `sessions.ts`, `hermes-auth.ts`, `current-user.ts`, `device-key.ts`, `pairing-tokens.ts`, `csrf.ts`, `rate-limits.ts`)
  - Session cookies parsed via `cookie-parser`; CSRF token signing via `HERMES_CSRF_SECRET`
  - Cookie `Secure` flag controlled by `HERMES_COOKIE_SECURE`
  - Bootstrap admin from env (`HERMES_ADMIN_USERNAME` / `HERMES_ADMIN_EMAIL` / `HERMES_ADMIN_PHONE`) via `src/server/db/bootstrap-admin.ts`
  - API tokens supported (see `src/server/http/api-tokens.test.ts`)
  - Device pairing via short-lived tokens (`src/server/auth/pairing-tokens.ts`)

## Monitoring & Observability

**Error Tracking:**
- None (errors written to stdout via `console.error` / `console.warn`)

**Logs:**
- `console.*` to stdout/stderr; collected by container runtime
- Application audit log persisted to SQLite (`src/server/audit-log.ts`, `audit_logs` table in `src/server/db/schema.ts`)

**Health:**
- `GET /api/health` returns `{ ok: true }` (`src/server/app.ts`); used by Docker `HEALTHCHECK` directive in `Dockerfile`

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker container; image published to GitHub Container Registry (`ghcr.io/containerguy/hermes`)

**CI Pipeline:**
- GitHub Actions workflow `.github/workflows/docker-image.yml`
  - `verify` job: `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`
  - `docker` job: `docker/setup-buildx-action@v4`, `docker/login-action@v4` (GHCR with `GITHUB_TOKEN`), `docker/metadata-action@v6`, `docker/build-push-action@v7`
  - Triggers: `push` to `main`, `v*` tags, `pull_request` to `main`, `workflow_dispatch`
  - Tagging strategy: `latest` (default branch), branch name, tag name, `sha-<short>`
  - Builds `linux/amd64` only; uses GHA build cache (`type=gha`)

## Environment Configuration

**Required env vars (production):**
- Server: `HERMES_HOST`, `HERMES_PORT`, `HERMES_DB_PATH`, `HERMES_CSRF_SECRET`, `HERMES_COOKIE_SECURE`
- Storage: `HERMES_STORAGE_BACKEND`, `HERMES_S3_BUCKET`, `HERMES_S3_REGION`, `HERMES_S3_ENDPOINT`, `HERMES_S3_CREDS_FILE`, `HERMES_S3_DB_KEY`, `HERMES_S3_RESTORE_MODE`
- Mail: `HERMES_MAIL_MODE`, `HERMES_MAIL_FROM`, `HERMES_SMTP_HOST`, `HERMES_SMTP_PORT`, `HERMES_SMTP_SECURITY` (or `HERMES_SMTP_SECURE`), `HERMES_SMTP_USER`, `HERMES_SMTP_PASSWORD`
- Push: `HERMES_VAPID_SUBJECT`, `HERMES_VAPID_PUBLIC_KEY`, `HERMES_VAPID_PRIVATE_KEY`
- Bootstrap admin: `HERMES_ADMIN_USERNAME`, `HERMES_ADMIN_EMAIL`, `HERMES_ADMIN_PHONE`
- Optional: `HERMES_SOURCE_REPO_URL`, `HERMES_DEV_LOGIN_CODE`

**Secrets location:**
- Local dev: `.env` file (parsed by `src/server/env.ts`; contents never read by tooling)
- Container: env vars via `docker-compose.yml` `env_file:` and `environment:`; S3 credentials mounted at `/run/secrets/s3.creds`
- CI: `secrets.GITHUB_TOKEN` for GHCR push (no other long-lived secrets in workflow)

## Webhooks & Callbacks

**Incoming:**
- None (no webhook endpoints registered in `src/server/http/`)

**Outgoing:**
- Web Push endpoints (browser-supplied subscription URLs) — sent from `src/server/push/push-service.ts`
- SMTP submissions — sent from `src/server/mail/mailer.ts`
- S3 PUT/GET/LIST/DELETE — sent from `src/server/storage/s3-storage.ts`

## Realtime

**Server-Sent Events (SSE):**
- In-process broadcast bus `src/server/realtime/event-bus.ts` (`registerEventsClient`, `broadcastEventsChanged`)
- Mounted under `/api/realtime` (`src/server/http/realtime-routes.ts`)
- 25s heartbeat events; 15s client retry hint
- Triggered by event mutations (`createEventRouter`) and a 30s `setInterval` status refresh in `src/server/app.ts`
- Single-process only — no Redis/pub-sub fan-out

---

*Integration audit: 2026-05-01*

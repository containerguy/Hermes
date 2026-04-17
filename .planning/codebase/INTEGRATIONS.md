# External Integrations

## Overview

Hermes is mostly self-contained: the active application state lives in local SQLite, and the server owns auth, sessions, event state, settings, and audit logs. External integrations are used for snapshot persistence, email delivery, browser push notifications, browser realtime/PWA APIs, and CI/container publishing.

## S3-Compatible Snapshot Storage

- Purpose: persistent backup/restore of the local SQLite database as a snapshot object.
- Implementation: `src/server/storage/s3-storage.ts` uses `@aws-sdk/client-s3` with `S3Client`, `GetObjectCommand`, and `PutObjectCommand`.
- Enablement: storage is active only when `HERMES_STORAGE_BACKEND=s3`.
- Configuration variables: `HERMES_S3_BUCKET`, `HERMES_S3_REGION`, `HERMES_S3_ENDPOINT`, `HERMES_S3_DB_KEY`, `HERMES_S3_RESTORE_MODE`, `HERMES_S3_CREDS_FILE`, `HERMES_S3_ACCESS_KEY_ID`, `HERMES_S3_SECRET_ACCESS_KEY`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.
- Default-compatible target: `.env.example`, `docker-compose.yml`, `readme.md`, and `building.md` point at a Wasabi S3-compatible endpoint in region `eu-central-2` with a SQLite object key.
- Credentials: `src/server/storage/s3-storage.ts` accepts credentials from env vars or a credentials file and supports several key names plus two bare-line formats. Do not commit real credential files.
- Startup restore: `restoreDatabaseFromStorageIfNeeded()` in `src/server/storage/s3-storage.ts` downloads the snapshot before migrations if S3 is enabled and restore mode permits it.
- Write persistence: `src/server/app.ts` schedules a snapshot after successful non-GET/non-HEAD/non-OPTIONS responses; `scheduleDatabaseSnapshot()` debounces uploads by one second.
- Shutdown persistence: `src/server/index.ts` calls the app close hook, which flushes pending S3 snapshots before closing SQLite.
- Manual admin operations: `POST /api/admin/backup` and `POST /api/admin/restore` in `src/server/http/admin-routes.ts` call `persistDatabaseSnapshot()` and `restoreDatabaseSnapshotIntoLive()`.
- Restore behavior: live restore attaches a downloaded SQLite snapshot and replaces known restorable tables listed in `src/server/storage/s3-storage.ts`.
- Operational limit: `readme.md` and `building.md` explicitly describe S3 as snapshot storage, not a multi-instance locking database backend.

## SMTP Email Delivery

- Purpose: deliver one-time login codes and registration login codes.
- Implementation: `src/server/mail/mailer.ts` uses Nodemailer.
- Call sites: `src/server/http/auth-routes.ts` calls `sendLoginCode()` during `/api/auth/request-code` and `/api/auth/register`.
- Modes: `HERMES_MAIL_MODE=console` logs local login codes; `HERMES_MAIL_MODE=smtp` sends through SMTP.
- Configuration variables: `HERMES_MAIL_MODE`, `HERMES_MAIL_FROM`, `HERMES_SMTP_HOST`, `HERMES_SMTP_PORT`, `HERMES_SMTP_SECURE`, `HERMES_SMTP_SECURITY`, `HERMES_SMTP_USER`, and `HERMES_SMTP_PASSWORD`.
- TLS behavior: `src/server/mail/mailer.ts` supports implicit TLS, STARTTLS, no TLS, and legacy `HERMES_SMTP_SECURE`; it warns if `HERMES_SMTP_SECURE=true` is used on a non-465 port.
- Failure handling: auth routes return a mail delivery error if SMTP sending fails, while logging details server-side.
- Local test escape hatch: `HERMES_DEV_LOGIN_CODE` in `src/server/http/auth-routes.ts` can pin the OTP value for development/tests and is documented as non-production in `.env.example`.

## Web Push And Browser Notifications

- Purpose: notify users about new events, event cancellations/archives, and status changes.
- Server implementation: `src/server/push/push-service.ts` uses `web-push`.
- Push routes: `src/server/http/push-routes.ts` exposes `/api/push/public-key`, `/api/push/subscriptions`, and `/api/push/preferences`.
- Client implementation: `src/main.tsx` registers `public/sw.js`, asks browser notification permission, subscribes through `registration.pushManager.subscribe()`, and sends the subscription to the server.
- Service worker: `public/sw.js` handles `push` and `notificationclick`, displays notifications with icon/badge data, and opens or focuses the target URL.
- VAPID configuration: `HERMES_VAPID_SUBJECT`, `HERMES_VAPID_PUBLIC_KEY`, and `HERMES_VAPID_PRIVATE_KEY`.
- Storage: push subscriptions are stored in SQLite table `push_subscriptions` defined in `src/server/db/schema.ts`.
- Subscription lifecycle: stale subscriptions are revoked when `web-push` returns HTTP 404 or 410 in `src/server/push/push-service.ts`.
- Event triggers: `src/server/http/event-routes.ts` sends push notifications when events are created, cancelled, archived, or transition to a different status after participation changes.
- Browser requirement: `readme.md` notes push requires a secure context; localhost works for local testing, ordinary HTTP LAN addresses generally do not.

## Server-Sent Events

- Purpose: live event-board updates without a separate websocket service.
- Server implementation: `src/server/realtime/event-bus.ts` maintains connected Express responses and writes SSE frames.
- Route: `src/server/http/realtime-routes.ts` exposes `/api/realtime/events` and requires an authenticated user.
- Client: `src/main.tsx` creates `new EventSource("/api/realtime/events", { withCredentials: true })`.
- Broadcasts: `src/server/http/event-routes.ts` and the status interval in `src/server/app.ts` call `broadcastEventsChanged()` after event, participation, archive/cancel, and status-refresh changes.
- Fallback: `src/main.tsx` keeps a 30-second polling interval active around the SSE connection and marks UI state as polling on SSE error.

## Browser PWA APIs

- Manifest: `public/manifest.webmanifest` defines app name, standalone display, colors, and SVG icon.
- Service worker: `public/sw.js` claims clients on activation and handles push notification display/click behavior.
- Client registration: `src/main.tsx` registers `/sw.js` only when enabling notifications.
- Installation/deployment note: the server in `src/server/app.ts` serves `dist/` and the static `public` assets after Vite build; HTTPS termination is outside this app.

## GitHub Actions And Container Registry

- Workflow: `.github/workflows/docker-image.yml`.
- Triggers: pull requests to `main`, pushes to `main`, tags matching `v*`, and manual `workflow_dispatch`.
- Verification job: installs with `npm ci`, runs `npm test`, runs `npm run build`, and audits production dependencies.
- Actions are pinned to Node-24-ready major versions: `actions/checkout@v5`, `actions/setup-node@v5`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, and `docker/build-push-action@v7`.
- Docker job uses the pinned Docker actions above to build metadata and image artifacts.
- Registry: images publish to GitHub Container Registry as `ghcr.io/containerguy/hermes` except on pull request builds.
- Tags: workflow metadata produces `latest` on the default branch, branch tags, version tags, and `sha-` commit tags.
- Permissions: workflow grants `contents: read` and `packages: write` for package publishing.

## CI Node 24 Migration

- Rationale: GitHub-hosted JavaScript actions are migrating from Node 20 to Node 24; proactive action pinning avoids a release-day CI break.
- Early opt-in: workflow-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` is enabled to fail fast on incompatible JavaScript actions during PR validation.
- Date context: GitHub runtime migration target window is June 2026; Hermes adopts compatibility pins ahead of that window.

## Docker Runtime Integrations

- Image build: `Dockerfile` builds frontend/server assets, prunes dev dependencies, exposes port 3000, and declares `/data` as a volume.
- Health check: `Dockerfile` uses Node `fetch()` against `http://127.0.0.1:3000/api/health`.
- Compose service: `docker-compose.yml` builds `hermes:local`, reads `.env`, exposes port 3000, mounts a named volume for SQLite, and mounts a local S3 credentials file read-only.
- Runtime env: `docker-compose.yml` sets host, port, database path, S3 backend, S3 bucket/region/endpoint/key, credential file path, and restore mode.

## Local Files And Secrets Boundary

- `.env.example` documents configuration names and placeholder values only.
- `.env` is loaded by `src/server/env.ts` if present, but should remain local.
- `s3.creds` is referenced by `readme.md`, `building.md`, and `docker-compose.yml`; it should remain local and mounted read-only in Docker.
- No real credential values should be recorded in `.planning/codebase/STACK.md` or `.planning/codebase/INTEGRATIONS.md`.

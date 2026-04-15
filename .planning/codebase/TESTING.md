# Testing Patterns

## Test Commands

- Unit and integration tests run with `npm test`, which maps to `vitest run src` in `package.json`.
- End-to-end tests run with `npm run test:e2e`, which builds first through `npm run build` and then runs `playwright test`.
- The build pipeline in `package.json` includes `tsc --noEmit`, so type safety is verified as part of `npm run build` and before E2E tests.
- Playwright configuration lives in `playwright.config.ts`. It uses `testDir: "./e2e"`, `timeout: 30_000`, `fullyParallel: false`, Desktop Chrome defaults, `trace: "on-first-retry"`, and the list reporter.

## Current Test Inventory

- `src/server/auth/otp.test.ts`: small unit coverage for OTP generation and hash verification.
- `src/server/domain/events.test.ts`: pure domain coverage for event validation, status derivation, and auto-archive timing.
- `src/server/storage/s3-storage.test.ts`: unit coverage for credential-file parsing formats without using live S3.
- `src/server/http/app-flow.test.ts`: Supertest integration coverage for login, admin user management, settings, invites, sessions, event creation, participation capacity, audit logs, and backup endpoint behavior.
- `e2e/hermes-flow.spec.ts`: browser flow coverage for admin login, user creation, manager event creation, user login, and joining an event.

## Vitest Conventions

- Tests use Vitest globals imported explicitly: `describe`, `it`, `expect`, `beforeEach`, `afterEach`.
- Server integration tests use `supertest` and `request.agent()` to retain cookies across requests.
- Tests that need the full app call `bootstrapAdmin()` from `src/server/db/bootstrap-admin.ts` and `createHermesApp()` from `src/server/app.ts`.
- Temporary SQLite databases are created with `path.join(os.tmpdir(), ...)` and `randomUUID()` to isolate each test run.
- SQLite sidecar files are cleaned up explicitly after app shutdown by removing the main file plus `-wal` and `-shm`.
- Environment variables are set inside test setup before bootstrapping the app. Tests delete optional integration env vars such as storage and VAPID settings to keep behavior deterministic.
- `started.close()` from `createHermesApp()` is called in teardown to flush snapshots, clear intervals, and close the SQLite handle.
- Assertions frequently combine HTTP status checks with body assertions using Supertest `.expect(status)` and `.expect((response) => { ... })`.

## Integration Test Shape

- `src/server/http/app-flow.test.ts` covers a long user journey rather than isolated endpoints. The flow logs in an admin, creates users, changes settings, creates an invite, registers and deletes an invited user, creates an event as a manager, enforces capacity, records participation changes, and checks audit summaries.
- The helper `login(agent, username)` requests a login code, verifies the fixed test code, and returns the response user. It relies on `HERMES_DEV_LOGIN_CODE` being set in test setup.
- Integration tests prefer real route handlers, real migrations, and real SQLite over mocks.
- Test data uses realistic German-facing labels and usernames, but email domains are non-production test domains.
- The app-level tests intentionally exercise auth cookies, role checks, database writes, and audit logging together.

## Playwright E2E Conventions

- `e2e/hermes-flow.spec.ts` starts the actual Express app in `test.beforeAll()` and listens on an ephemeral local port with `server.listen(0, "127.0.0.1")`.
- The Playwright `baseURL` in `playwright.config.ts` is a placeholder; the spec builds its own `baseUrl` from the runtime port and navigates with explicit URLs.
- The E2E login helper selects by accessible labels and roles:
  - `page.getByLabel("Username")`
  - `page.getByRole("button", { name: "Code senden" })`
  - `page.getByLabel("Einmalcode")`
  - `page.getByRole("button", { name: "Einloggen" })`
- Browser assertions use visible text, roles, headings, and labels, so user-facing copy changes can break E2E tests.
- E2E setup mirrors integration setup: temporary SQLite database, bootstrap admin, console mail mode, fixed dev login code, no S3 storage, and no VAPID keys.
- E2E teardown closes the HTTP server, calls the app close hook, and removes SQLite sidecar files.

## What To Test For New Work

- Pure domain rules should get focused Vitest tests near the domain module, following `src/server/domain/events.test.ts`.
- Route behavior should get Supertest coverage when it touches auth, roles, validation, database writes, audit logs, sessions, invites, settings, backup/restore, push preferences, or event participation.
- Browser tests should be reserved for critical end-to-end workflows that depend on real UI behavior, routing, labels, cookies, and server integration.
- Database schema changes should be exercised through app startup or migration-aware integration tests, since `createHermesApp()` runs `runMigrations()`.
- Any new backend error code should be covered at the route level and added to the frontend `errorMessages` map in `src/main.tsx` when it can reach users.
- Any new user-facing form should be testable by accessible labels and roles, consistent with `e2e/hermes-flow.spec.ts`.

## Test Isolation And Data Hygiene

- Prefer temporary databases via `HERMES_DB_PATH` for tests; do not point tests at local development or production data.
- Do not use real S3, mail, push, or credential values in tests. Existing tests use console mail mode and delete storage/push env vars when the integration is not under test.
- Credential parsing tests in `src/server/storage/s3-storage.test.ts` use dummy placeholder strings only; keep that pattern for future credential-format coverage.
- Clean up all filesystem artifacts created by tests, including SQLite WAL and shared-memory files.
- Avoid relying on wall-clock local time where possible. Existing domain tests pass explicit `Date` values into `deriveEventStatus()` and `shouldAutoArchive()`.

## Known Coverage Gaps

- There are no frontend component unit tests; frontend behavior is currently covered only through `e2e/hermes-flow.spec.ts`.
- API coverage is broad for the main app flow, but many individual error branches in `src/server/http/*-routes.ts` are not isolated by focused tests.
- Push subscription routes in `src/server/http/push-routes.ts`, realtime SSE behavior in `src/server/http/realtime-routes.ts`, and mail delivery behavior in `src/server/mail/mailer.ts` have limited or no direct tests.
- S3 snapshot upload/restore behavior in `src/server/storage/s3-storage.ts` is not integration-tested against a real or fake S3 service; only credential parsing has unit tests.
- Migration ordering and idempotency are exercised indirectly through app startup, but there are no dedicated migration tests for every SQL file under `src/server/db/migrations/`.

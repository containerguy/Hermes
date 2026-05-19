# Testing Patterns

## Test Commands

- Unit and integration tests run with `npm test`, which maps to `vitest run src` in `package.json`.
- End-to-end tests run with `npm run test:e2e`, which builds first through `npm run build` and then runs `playwright test`.
- `npm run build` includes `tsc --noEmit`, so type safety is verified as part of the build and before E2E tests.
- Playwright configuration in `playwright.config.ts`: `testDir: "./e2e"`, `timeout: 30_000`, `fullyParallel: false`, Desktop Chrome defaults, `trace: "on-first-retry"`, list reporter.

## Current Test Inventory

### Server unit + integration (`src/server/`)

- `auth/otp.test.ts` — OTP generation + scrypt hash verification.
- `domain/events.test.ts` — event validation, status derivation, auto-archive timing.
- `domain/users.test.ts` — role helpers, permission checks.
- `domain/pizza/lifecycle.test.ts` — pizza session state machine.
- `domain/pizza/order-limits.test.ts` — line cap + note normalization.
- `domain/pizza/totals.test.ts` — per-order + per-session totals (cents).
- `pdf/pizza-print.test.ts` — smoke tests for the two PDF builders (header bytes, non-empty buffer, empty-input safety).
- `push/push-service-cleanup.test.ts` — dead-subscription cleanup.
- `push/service-worker-push.test.ts` — service-worker push payload shape.
- `storage/s3-storage.test.ts` — S3 credential file parsing.
- `version-info.test.ts` — release version surface.

### Server HTTP integration (`src/server/http/`)

- `app-flow.test.ts` — long user-journey integration: admin login, user CRUD, settings, invites, registration, events, capacity, audit summaries, backup (~1749 lines, multi-scenario).
- `event-capacity.test.ts` — capacity-loser response shape (`error: "event_voll"`).
- `event-soft-delete.test.ts` — admin soft-delete behavior.
- `event-side-effects.test.ts` — audit + push side effects on participation changes.
- `auth-pair.test.ts` — `/api/auth/pair-token` + `/api/auth/pair-redeem` end-to-end with 4 stable error codes.
- `auth-device-recognition.test.ts` — same-device re-login (`auth.login_recognized`).
- `api-tokens.test.ts` — Bearer API token mint, scope enforcement (`api_token_nur_lesen`), revocation.

### Client (`src/client/`)

- `api/csrf.test.ts` — CSRF token fetch/cache.
- `cod4/generateCod4Key.test.ts` — XOR-fold checksum golden tests.
- `cod4/isCod4Game.test.ts` — game-name matcher.
- `components/admin-panel.test.tsx` — admin panel smoke + interaction.
- `components/login-panel.test.tsx` — login flow + redeem-on-mount URL scrub.
- `components/ui-correctness.test.tsx` — high-level UI correctness harness (createRoot + react-dom/test-utils.act).
- `lib/runtime-context.test.ts` — secure-context + PWA + iOS-Safari heuristics.

### E2E (`e2e/`)

- `hermes-flow.spec.ts` — admin setup, user creation, manager event creation, user login, joining an event.

## Vitest Conventions

- Vitest globals imported explicitly: `describe`, `it`, `expect`, `beforeEach`, `afterEach`.
- Server integration tests use `supertest` and `request.agent()` to retain cookies across requests.
- Tests that need the full app call `bootstrapAdmin()` and `createHermesApp()`.
- Temporary SQLite databases created with `path.join(os.tmpdir(), ...)` and `randomUUID()` to isolate each test run.
- SQLite sidecar files cleaned up explicitly after app shutdown: remove the main file plus `-wal` and `-shm`.
- Env vars set inside test setup before bootstrap. Tests delete optional integration env vars (S3, VAPID) for deterministic behavior.
- `started.close()` from `createHermesApp()` is called in teardown to flush snapshots, clear intervals, and close the SQLite handle.
- Assertions frequently combine HTTP status checks with body assertions: `.expect(status)` and `.expect((response) => { ... })`.

## Client Test Conventions

- `ui-correctness.test.tsx` is the reference harness: `react-dom/client` `createRoot` + `react-dom/test-utils.act`, no `@testing-library/react` dependency.
- `login-panel.test.tsx` and `admin-panel.test.tsx` follow the same pattern.
- DOM queries use literal text + role/label heuristics (not testid attributes).
- Network calls mocked via `vi.fn()` replacing the typed `requestJson` helper.

## Integration Test Shape

- `app-flow.test.ts` covers a long user journey rather than isolated endpoints.
- The helper `login(agent, username)` requests a login code, verifies the fixed test code, and returns the response user. Relies on `HERMES_DEV_LOGIN_CODE` being set in test setup.
- Integration tests prefer real route handlers, real migrations, and real SQLite over mocks.
- Test data uses realistic German-facing labels and usernames; email domains are non-production test domains.
- App-level tests intentionally exercise auth cookies, role checks, database writes, and audit logging together.

## Playwright E2E Conventions

- `hermes-flow.spec.ts` starts the actual Express app in `test.beforeAll()` on an ephemeral local port (`server.listen(0, "127.0.0.1")`).
- `baseURL` in `playwright.config.ts` is a placeholder; the spec builds its own `baseUrl` from the runtime port and navigates with explicit URLs.
- The E2E login helper selects by accessible labels and roles (`getByLabel("Username")`, `getByRole("button", { name: "Code senden" })`, etc.).
- Browser assertions use visible text, roles, headings, and labels — user-facing copy changes can break E2E tests.
- E2E setup mirrors integration setup: temporary SQLite, bootstrap admin, console mail mode, fixed dev login code, no S3, no VAPID.
- E2E teardown closes the HTTP server, calls the app close hook, removes SQLite sidecar files.

## What To Test For New Work

- Pure domain rules → focused Vitest tests near the domain module, following `domain/events.test.ts` or `domain/pizza/*.test.ts`.
- Route behavior → Supertest coverage when it touches auth, roles, validation, DB writes, audit logs, sessions, invites, settings, backup/restore, push preferences, event participation, or pizza flows.
- Browser tests → reserved for critical end-to-end workflows depending on real UI, routing, labels, cookies, and server integration.
- Schema changes → exercised through app startup or migration-aware integration tests; `createHermesApp()` runs `runMigrations()`.
- New backend error codes → covered at the route level + added to `errorMessages` in `src/client/errors/errors.ts` when user-reachable.
- New user-facing form → testable by accessible labels and roles, consistent with `hermes-flow.spec.ts`.

## Test Isolation And Data Hygiene

- Prefer temporary databases via `HERMES_DB_PATH` for tests; never point tests at dev or prod data.
- No real S3, mail, push, or credential values in tests. Existing tests use console mail mode and delete storage/push env vars when those integrations are not under test.
- Credential parsing tests use dummy placeholder strings only.
- Clean up all filesystem artifacts: SQLite main file + `-wal` + `-shm`.
- Avoid relying on wall-clock local time. Existing domain tests pass explicit `Date` values into `deriveEventStatus()` and `shouldAutoArchive()`.

## Known Coverage Gaps

- **Untested security-critical modules** (slated for `T3.2` in the cleanup plan): `auth/csrf.ts`, `auth/device-names.ts`, `auth/hermes-auth.ts`, `settings.ts`, `audit-log.ts`.
- HTTP route files `admin-routes.ts`, `event-routes.ts`, `pizza-routes.ts` lack focused sibling tests (covered indirectly by `app-flow.test.ts`).
- Realtime SSE behavior in `realtime-routes.ts` is not directly tested.
- Mail delivery behavior in `mailer.ts` is not tested beyond console mode.
- S3 snapshot upload/restore is not integration-tested against a real or fake S3 service; only credential parsing has unit coverage.
- Migration ordering + idempotency is exercised indirectly through app startup; no dedicated per-migration tests.
- Pizza HTTP routes (`pizza-routes.ts`) and admin menu JSON upsert are not directly tested.

# Testing Patterns

**Analysis Date:** 2026-05-01

## Test Framework

**Runner:**
- Vitest 4 (`vitest@^4.1.4` in `package.json`)
- No standalone `vitest.config.ts` — runner uses defaults plus per-file environment hints (`/* @vitest-environment jsdom */` in client tests)
- `jsdom@^29.0.2` provides the DOM for React component tests

**Assertion Library:**
- Built-in `expect` from `vitest`

**HTTP testing:**
- `supertest@^7.2.2` for Express integration tests (e.g. `src/server/http/app-flow.test.ts`)

**E2E:**
- `@playwright/test@^1.59.1` configured in `playwright.config.ts`

**Run Commands:**
```bash
npm test                  # vitest run src  (one-shot, all unit + integration)
npm run test:e2e          # npm run build && playwright test
npm run verify            # npm test && npm run build && npm audit --omit=dev
npm run verify:ci         # npm ci && npm test && npm run build && npm audit --omit=dev
```

There is no watch-mode script defined — invoke `npx vitest` directly for watch mode.

## Test File Organization

**Location:**
- Unit and integration tests are **co-located** next to source files under `src/`
- E2E tests live under `e2e/` (separate from `src/`)

**Naming:**
- Vitest: `*.test.ts` / `*.test.tsx`
- Playwright: `*.spec.ts`

**Layout (current files):**
```
src/
├── client/
│   ├── api/csrf.test.ts
│   ├── components/
│   │   ├── admin-panel.test.tsx
│   │   ├── login-panel.test.tsx
│   │   └── ui-correctness.test.tsx
│   └── lib/runtime-context.test.ts
└── server/
    ├── auth/otp.test.ts
    ├── domain/
    │   ├── events.test.ts
    │   └── users.test.ts
    ├── http/
    │   ├── api-tokens.test.ts
    │   ├── app-flow.test.ts
    │   ├── auth-device-recognition.test.ts
    │   ├── auth-pair.test.ts
    │   ├── event-capacity.test.ts
    │   ├── event-side-effects.test.ts
    │   └── event-soft-delete.test.ts
    ├── push/
    │   ├── push-service-cleanup.test.ts
    │   └── service-worker-push.test.ts
    ├── storage/s3-storage.test.ts
    └── version-info.test.ts
e2e/
└── hermes-flow.spec.ts
```

The `npm test` script scopes to `src` (`vitest run src`), so `e2e/` is excluded from the unit test run.

## Test Structure

**Suite Organization (Vitest):**
```typescript
// src/server/auth/otp.test.ts
import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, verifyOtp } from "./otp";

describe("otp", () => {
  it("generates six digit codes", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("verifies only the original code", () => {
    const hash = hashOtp("123456");
    expect(verifyOtp("123456", hash)).toBe(true);
    expect(verifyOtp("654321", hash)).toBe(false);
  });
});
```

**Patterns:**
- `describe`/`it` style with co-located helpers above the suite
- `beforeEach`/`afterEach` provision a fresh SQLite file per HTTP integration test (see `src/server/http/app-flow.test.ts:33-59`)
- Custom timeouts passed as third arg to `beforeEach` for slow setup (`30_000` ms in `app-flow.test.ts:49`)
- Each test cleans up by closing the started app and `fs.rmSync`-ing the SQLite + `-wal` + `-shm` sidecars

## Mocking

**Framework:** Built-in `vi` from `vitest`

**Patterns:**
```typescript
// src/client/components/login-panel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/request", () => ({
  requestJson: vi.fn()
}));

vi.mock("../api/csrf", () => ({
  clearCsrfToken: vi.fn(),
  primeCsrfToken: vi.fn()
}));
```

**What to Mock:**
- Outbound network calls from React components (`requestJson`, CSRF helpers)
- Third-party SDK boundaries when they are not the unit under test

**What NOT to Mock:**
- The real Express app — HTTP integration tests boot `createHermesApp()` against a temp SQLite file and hit it with `supertest` rather than mocking handlers
- The SQLite database — tests run real Drizzle queries against a fresh `os.tmpdir()` file per test
- The mail transport in tests — driven by `HERMES_MAIL_MODE=console` + `HERMES_DEV_LOGIN_CODE=123456` so OTP `"123456"` is always accepted

## Fixtures and Factories

**Test Data:**
- No central fixtures directory. Each test inlines the data it needs.
- HTTP tests share small login helpers near the top of the file:

```typescript
// src/server/http/app-flow.test.ts:18-26
async function login(agent: ReturnType<typeof request.agent>, username: string) {
  await agent.post("/api/auth/request-code").send({ username }).expect(202);
  const response = await agent
    .post("/api/auth/verify-code")
    .send({ username, code: "123456", deviceName: "test" })
    .expect(200);
  return response.body.user as { id: string; role: string };
}
```

- React component tests provide a `defaultSettings` object (`src/client/components/login-panel.test.tsx:54+`) and helper `renderIntoDocument()` for jsdom rendering

**Setup helpers:**
- `bootstrapAdmin()` from `src/server/db/bootstrap-admin.ts` is reused by both `app-flow.test.ts` and `e2e/hermes-flow.spec.ts` to seed the initial admin
- Disposable env vars are set inside `beforeEach`/`beforeAll` and the `HERMES_STORAGE_BACKEND` / VAPID vars are explicitly `delete`d to keep tests hermetic

## Coverage

**Requirements:** None enforced. No coverage script in `package.json`; no coverage threshold config.

**View Coverage:**
```bash
npx vitest run --coverage   # ad-hoc; not wired into CI
```

## Test Types

**Unit Tests:**
- Pure logic: `src/server/auth/otp.test.ts` (OTP generation/hashing), `src/server/domain/events.test.ts` (status derivation), `src/server/domain/users.test.ts` (role permissions), `src/server/version-info.test.ts`
- Storage credential parsing: `src/server/storage/s3-storage.test.ts`
- Client utilities: `src/client/lib/runtime-context.test.ts`, `src/client/api/csrf.test.ts`

**Integration Tests:**
- HTTP layer driven through Supertest against a real `createHermesApp()` instance with a temp SQLite file. Cover login (`app-flow.test.ts`), API tokens (`api-tokens.test.ts`), device pairing (`auth-pair.test.ts`), device recognition (`auth-device-recognition.test.ts`), event capacity (`event-capacity.test.ts`), event side effects (`event-side-effects.test.ts`), event soft delete (`event-soft-delete.test.ts`)
- Push pipeline: `src/server/push/service-worker-push.test.ts`, `push-service-cleanup.test.ts`

**Component Tests:**
- React components rendered into jsdom via `createRoot` + `act` — `src/client/components/login-panel.test.tsx`, `admin-panel.test.tsx`, `ui-correctness.test.tsx`
- File-level pragma `/* @vitest-environment jsdom */` switches environment per file

**E2E Tests:**
- Playwright single spec at `e2e/hermes-flow.spec.ts`
- Boots a real Express app on `127.0.0.1:0` (random port) against a temp SQLite database, bootstraps admin, then exercises admin → manager → user flow through the browser
- Uses German UI labels via `getByLabel("Username")`, `getByRole("button", { name: "Code senden" })`, etc. — UI labels are part of the test contract
- Configured `fullyParallel: false` and 30 s timeout in `playwright.config.ts`
- **Known limitation:** E2E run requires Playwright system libraries (e.g. `libnspr4.so`). On hosts without them, run `npx playwright install-deps chromium` (sudo needed on most systems) — documented in `building.md:99-105`. CI does **not** currently run Playwright tests; only `npm test` is executed.

## CI Test Workflow

`.github/workflows/docker-image.yml` defines two jobs:

**`verify` job (runs on every push to `main`, every PR, and version tags):**
1. `actions/checkout@v5`
2. `actions/setup-node@v5` with Node 22 + npm cache
3. `npm ci`
4. `npm test` — Vitest only (E2E excluded)
5. `npm run build` — `tsc --noEmit` + Vite build + esbuild server bundle
6. `npm audit --omit=dev` — production dependency audit

**`docker` job (depends on `verify`):**
- Builds and pushes `ghcr.io/containerguy/hermes` for non-PR triggers

**E2E in CI:** not executed. Playwright runs are local-only because installing system libraries (`libnspr4` and friends) is not part of the workflow.

## Common Patterns

**Async Testing:**
```typescript
// HTTP request via supertest agent
const agent = request.agent(started!.app);
await agent.post("/api/auth/request-code").send({ username }).expect(202);
```

**React act() wrapping:**
```typescript
await act(async () => {
  root.render(<I18nProvider locale="de">{element}</I18nProvider>);
  await flushMicrotasks();
});
```

**Microtask flushing helper for component tests:**
```typescript
async function flushMicrotasks() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
```

**Per-test temp database lifecycle:**
```typescript
databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
process.env.HERMES_DB_PATH = databasePath;
// ... run test ...
for (const suffix of ["", "-wal", "-shm"]) {
  fs.rmSync(`${databasePath}${suffix}`, { force: true });
}
```

**Error Testing:**
- Validate HTTP error codes with `expect(response.body.error).toBe("ungueltiger_user")` style checks
- Client-side: tests assert on thrown `ApiError` instances from `src/client/errors/errors.ts`

---

*Testing analysis: 2026-05-01*

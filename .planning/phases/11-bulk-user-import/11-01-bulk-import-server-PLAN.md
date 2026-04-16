---
phase: 11
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/domain/bulk-user-import.ts
  - src/server/http/admin-routes.ts
  - src/server/http/admin-bulk-import.test.ts
  - src/client/errors/errors.ts
autonomous: true
requirements: [ADM-02]
tags: [admin, users, bulk-import, server, zod, sqlite, audit]
must_haves:
  truths:
    - "Only admins with a valid CSRF token can call POST /api/admin/users/bulk-import."
    - "A valid dryRun request returns per-row outcomes and does NOT insert any users."
    - "A valid confirm request (dryRun=false, all rows valid, no duplicates) inserts all users in a single SQLite transaction and returns counts."
    - "If ANY row fails validation or is a duplicate in confirm mode, the entire transaction rolls back and zero users are created."
    - "Duplicate detection is case-insensitive on both username and email, against existing active users and within the submitted batch."
    - "Payloads >1 MB are rejected with 413 and row counts >1000 are rejected with a stable German error code."
    - "Every import emits exactly one audit entry with action=user_bulk_import carrying totals ({received, created, skipped, failed}, dryRun, durationMs) and NO usernames/emails in the audit body."
    - "Server logs never echo row contents — only counts and adminId."
  artifacts:
    - path: "src/server/domain/bulk-user-import.ts"
      provides: "Zod schemas (bulkImportRowSchema, bulkImportBodySchema), row-level validator, duplicate detector, and transactional insert helper"
      exports: ["bulkImportBodySchema", "bulkImportRowSchema", "runBulkUserImport", "BulkImportOutcome", "BULK_IMPORT_MAX_ROWS"]
    - path: "src/server/http/admin-routes.ts"
      provides: "POST /api/admin/users/bulk-import endpoint wired into the existing admin router (after role guard + CSRF middleware)"
      contains: 'app.post("/api/admin/users/bulk-import"'
    - path: "src/server/http/admin-bulk-import.test.ts"
      provides: "Vitest HTTP coverage: happy path, duplicates, invalid rows, dry-run never writes, transaction rollback, oversized payload (1 MB), too many rows (1001), admin-only, CSRF-required, audit entry aggregated + PII-free"
    - path: "src/client/errors/errors.ts"
      provides: "German user-facing mappings for new bulk-import error codes"
      contains: "ungueltige_eingabe"
  key_links:
    - from: "src/server/http/admin-routes.ts"
      to: "src/server/domain/bulk-user-import.ts"
      via: "import { bulkImportBodySchema, runBulkUserImport, BULK_IMPORT_MAX_ROWS }"
      pattern: "bulk-user-import"
    - from: "src/server/domain/bulk-user-import.ts"
      to: "users table"
      via: "context.sqlite.transaction + context.db.insert(users)"
      pattern: "context\\.sqlite\\.transaction"
    - from: "src/server/http/admin-routes.ts"
      to: "audit_logs table"
      via: "tryWriteAuditLog with action=user_bulk_import"
      pattern: "user_bulk_import"
---

<objective>
Ship the admin-only server endpoint `POST /api/admin/users/bulk-import` with Zod validation, case-insensitive duplicate detection, single-transaction all-or-nothing write (per D-08), 1 MB / 1000-row caps (per D-11), and a single aggregated PII-free audit entry per import (per D-12, D-14). All behavior is covered by Vitest HTTP tests.

Purpose: Enable ADM-02 server-side so phase 11-02 (AdminPanel UI) can render preview/dry-run/confirm flows against a validated, secure endpoint.
Output: New domain helper, extended admin router, HTTP test file, and German error-message mappings for the new codes.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-bulk-user-import/11-CONTEXT.md
@AGENTS.md

@src/server/http/admin-routes.ts
@src/server/domain/users.ts
@src/server/db/schema.ts
@src/server/audit-log.ts
@src/server/http/app-flow.test.ts
@src/client/errors/errors.ts

<interfaces>
From src/server/audit-log.ts:
```typescript
export function writeAuditLog(context: DatabaseContext, input: AuditLogInput): void;
export function tryWriteAuditLog(context: DatabaseContext, input: AuditLogInput): void;
// AuditLogInput = { actor?, action, entityType, entityId?, summary, metadata? }
```

From src/server/domain/users.ts:
```typescript
export const userRoleSchema: z.ZodEnum<["user", "manager", "admin"]>;
export function findActiveUserByEmail(context, email): typeof users.$inferSelect | undefined;
export function ensureActiveEmailAvailable(context, email, options?): { ok: true } | { ok: false; error: "email_existiert_bereits" };
```

From src/server/db/schema.ts (users table highlights):
```typescript
users: {
  id: text PK;
  phoneNumber: text notNull;         // UNIQUE — use fallbackPhoneNumber(id) when import row has none
  username: text notNull;            // UNIQUE (case-sensitive in SQLite by default)
  displayName: text nullable;
  email: text notNull;               // UNIQUE
  role: "user" | "manager" | "admin" default "user";
  notificationsEnabled: boolean default true;
  createdByUserId: text nullable;
  deletedAt, createdAt, updatedAt: text;
}
```

From src/server/http/admin-routes.ts (existing pattern to reuse — see lines 244–304 createUser and lines 32–38 createUserSchema):
- Admin guard + CSRF are already mounted on the whole admin router.
- `fallbackPhoneNumber(id)` helper supplies synthetic unique phone for import rows.
- `readSettings(context).defaultNotificationsEnabled` is the defaults source (D-10).
- Use `tryWriteAuditLog` so audit failure never aborts success.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Bulk-import domain module (schema, duplicate detection, transactional write)</name>
  <read_first>
    - src/server/domain/users.ts (reuse userRoleSchema; mimic exported helpers)
    - src/server/http/admin-routes.ts lines 32–38 (createUserSchema shape), 244–304 (createUser flow), 336–354 (context.sqlite.transaction usage)
    - src/server/db/schema.ts (users columns + unique indexes)
    - .planning/phases/11-bulk-user-import/11-CONTEXT.md (D-03, D-07, D-08, D-09, D-10, D-11)
    - AGENTS.md (German error codes, Zod-at-boundary, transaction pattern)
  </read_first>
  <files>src/server/domain/bulk-user-import.ts</files>
  <action>
    Create a new domain module implementing ADM-02 core logic. Do NOT add new npm dependencies (D-16).

    1. Exported constants:
       - `BULK_IMPORT_MAX_ROWS = 1000` (per D-11).

    2. Zod schemas (per D-03, D-07):
       - `bulkImportRowSchema = z.object({ username: z.string().trim().min(1).max(80), email: z.string().trim().email().max(160), role: z.enum(["user", "manager"]).optional(), notificationsEnabled: z.boolean().optional() }).strict()`.
         NOTE: explicitly exclude `"admin"` from role (Claude's Discretion in CONTEXT.md — admins are created manually).
       - `bulkImportBodySchema = z.object({ rows: z.array(bulkImportRowSchema).min(1).max(BULK_IMPORT_MAX_ROWS), dryRun: z.boolean() }).strict()`.

    3. Outcome type:
       ```typescript
       export type BulkImportOutcome =
         | { status: "created"; username: string }
         | { status: "skipped"; reason: "duplicate"; username: string; field: "username" | "email" | "both" }
         | { status: "failed"; reason: "validation"; username: string; message: string }
         | { status: "failed"; reason: "db"; username: string; message: string };
       ```
       The string literal matrix ("created" | "skipped: duplicate" | "failed: validation" | "failed: db") is enforced by the discriminated union above; do not add other variants.

    4. `runBulkUserImport(context, { adminId, rows, dryRun, defaultNotificationsEnabled })` (per D-08, D-09, D-10):
       a. Lower-case-normalize each row's `username` and `email` for comparison keys only (store the original-cased values if the row is accepted).
       b. Load all active users (`isNull(users.deletedAt)`) and build two `Set<string>` of lowercase username and email.
       c. First pass (dry pass — NO writes):
          - For each row: validation is already guaranteed by Zod at the route boundary (we re-assert via `bulkImportRowSchema.safeParse` defensively; on failure push `{ status: "failed", reason: "validation" }`).
          - Detect duplicates against existing-user sets AND against already-seen rows in the batch. Duplicate hit → `{ status: "skipped", reason: "duplicate", field }`.
          - Clean rows → `{ status: "created" }` tentatively.
       d. Aggregate totals: `{ received, created, skipped, failed }`.
       e. If `dryRun === true`: return `{ outcomes, totals }` without opening a transaction.
       f. If `dryRun === false` AND (`totals.skipped > 0` OR `totals.failed > 0`): RETURN WITHOUT WRITING, with `rolledBack: true` and a `reason` of either `"import_duplikate"` (if any skipped were duplicates and no validation failures) or `"import_validierungsfehler"` (if any failed). Route layer maps reason → HTTP status + error code.
       g. If `dryRun === false` AND all rows are clean: open ONE `context.sqlite.transaction(() => { ... })()` and for each accepted row:
          - `const id = randomUUID()`.
          - Insert with `phoneNumber: fallbackPhoneNumber(id)`, `displayName: row.username`, `role: row.role ?? "user"`, `notificationsEnabled: row.notificationsEnabled ?? defaultNotificationsEnabled`, `createdByUserId: adminId`, `createdAt = updatedAt = nowIso()`.
          - Catch unique-constraint errors inside the transaction: THROW to force rollback (all-or-nothing per D-08). Tag the failure in a scoped `dbFailureUsername` closure variable so we can report `{ status: "failed", reason: "db" }` for ONE row after catch.
       h. On transaction catch: return `{ outcomes: outcomes-with-db-failure, totals: recomputed, rolledBack: true, reason: "import_datenbank" }`. Totals.created MUST be 0 (rollback).
       i. On transaction success: return `{ outcomes, totals, rolledBack: false }`.

    5. Helpers stay file-local (nowIso, fallbackPhoneNumber — or reuse by importing from a shared spot if already public; it's currently file-local in admin-routes.ts so duplicate it here with an identical contract).

    6. NEVER `console.log` or `console.error` any row contents (D-14). If you must log a DB failure, use `console.error("[Hermes] bulk import db failure", { adminId, index })` with NO username/email payload.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
    <automated>rg -n "context\\.sqlite\\.transaction" src/server/domain/bulk-user-import.ts</automated>
    <automated>rg -n "BULK_IMPORT_MAX_ROWS = 1000" src/server/domain/bulk-user-import.ts</automated>
    <automated>rg -n "z\\.enum\\(\\[\"user\", \"manager\"\\]\\)" src/server/domain/bulk-user-import.ts</automated>
    <automated>! rg -n "console\\.(log|warn|error).*(username|email|row)" src/server/domain/bulk-user-import.ts</automated>
  </verify>
  <done>
    `src/server/domain/bulk-user-import.ts` exports `bulkImportBodySchema`, `bulkImportRowSchema`, `runBulkUserImport`, `BulkImportOutcome`, `BULK_IMPORT_MAX_ROWS`; tsc passes; no row-content logging.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire POST /api/admin/users/bulk-import + aggregated audit + HTTP tests + client error copy</name>
  <read_first>
    - src/server/http/admin-routes.ts (createUser pattern lines 244–304, CSRF+admin middleware lines 125–148, tryWriteAuditLog usage)
    - src/server/domain/bulk-user-import.ts (from Task 1)
    - src/server/http/app-flow.test.ts (supertest agent + fetchCsrf + login helpers)
    - src/server/audit-log.ts (AuditLogInput shape, metadata JSON)
    - src/client/errors/errors.ts (German mapping pattern)
    - .planning/phases/11-bulk-user-import/11-CONTEXT.md (D-06, D-11, D-12, D-14, D-17)
  </read_first>
  <files>src/server/http/admin-routes.ts, src/server/http/admin-bulk-import.test.ts, src/client/errors/errors.ts</files>
  <action>
    A. In `src/server/http/admin-routes.ts`:
       1. Import `bulkImportBodySchema`, `runBulkUserImport`, `BULK_IMPORT_MAX_ROWS` from `../domain/bulk-user-import`.
       2. Add a new route on the existing admin router (admin+CSRF middleware already applies):
          ```ts
          router.post("/users/bulk-import", (request, response) => { ... });
          ```
          - The route path is `/users/bulk-import` relative to the admin router, which mounts at `/api/admin` in app.ts — final URL is `/api/admin/users/bulk-import` (D-06).
       3. Behavior:
          a. `const admin = requireAdmin(context, request);` (consistent with siblings).
          b. `const parsed = bulkImportBodySchema.safeParse(request.body);`
             - On failure → `response.status(400).json({ error: "ungueltige_eingabe" })`.
             - If the Zod error's top path is `rows` and the failure is `too_big` → return `response.status(413).json({ error: "import_zu_viele_zeilen", limit: BULK_IMPORT_MAX_ROWS })`.
          c. Capture `const start = Date.now();`.
          d. Call `const result = runBulkUserImport(context, { adminId: admin!.id, rows: parsed.data.rows, dryRun: parsed.data.dryRun, defaultNotificationsEnabled: readSettings(context).defaultNotificationsEnabled });`.
          e. Compute `const durationMs = Date.now() - start;`.
          f. ALWAYS emit exactly ONE aggregated audit entry via `tryWriteAuditLog` (per D-12):
             ```ts
             tryWriteAuditLog(context, {
               actor: admin,
               action: "user_bulk_import",
               entityType: "user",
               entityId: null,
               summary: `${admin?.username ?? "Admin"} hat Bulk-Import ausgeführt (${parsed.data.dryRun ? "Dry-Run" : "Confirm"}).`,
               metadata: { dryRun: parsed.data.dryRun, totals: result.totals, durationMs, rolledBack: result.rolledBack ?? false }
             });
             ```
             DO NOT include usernames, emails, or per-row outcomes in the metadata (D-12, D-14).
          g. Response mapping:
             - `result.rolledBack && result.reason === "import_duplikate"` → `response.status(409).json({ error: "import_duplikate", outcomes: result.outcomes, totals: result.totals })`.
             - `result.rolledBack && result.reason === "import_validierungsfehler"` → `response.status(409).json({ error: "import_validierungsfehler", outcomes: result.outcomes, totals: result.totals })`.
             - `result.rolledBack && result.reason === "import_datenbank"` → `response.status(500).json({ error: "import_datenbank", outcomes: result.outcomes, totals: result.totals })`.
             - Otherwise (dry-run or successful confirm) → `response.status(200).json({ ok: true, dryRun: parsed.data.dryRun, outcomes: result.outcomes, totals: result.totals })`.
          h. NEVER `console.log` row contents. A single `console.error("[Hermes] bulk import db failure", { adminId: admin?.id })` is acceptable on the db-rollback branch.

    B. Create `src/server/http/admin-bulk-import.test.ts` using the same harness as `app-flow.test.ts` (supertest agent, `bootstrapAdmin`, CSRF header `CSRF_HEADER`, dev login code). Cover ALL of the following (D-17):
       1. Rejects non-admin caller: login as a plain user → POST `/api/admin/users/bulk-import` → expect 403 `admin_erforderlich`.
       2. Rejects missing CSRF header: POST without `x-hermes-csrf` → expect 403 `csrf_token_ungueltig` (or the repo's existing code — check `csrf.ts`).
       3. Happy path dry-run: 5 valid rows, `dryRun: true` → 200, `totals.received=5, created=5, skipped=0, failed=0`, no users actually inserted (assert via `GET /api/admin/users` still shows only the bootstrap admin).
       4. Happy path confirm: same 5 valid rows, `dryRun: false` → 200, `totals.created=5`, the 5 users appear in `GET /api/admin/users`, each has `role: "user"` (default per D-03) and `notificationsEnabled === readSettings default`.
       5. Duplicate detection (dry-run) against existing user: include the bootstrap admin's email in one row with differently-cased characters → 200, that row's outcome is `{ status: "skipped", reason: "duplicate", field: "email" }`, no writes.
       6. Duplicate within batch (dry-run): two rows sharing the same username (different case) → 200, exactly one `created`, one `skipped: duplicate`, no writes.
       7. Confirm-mode rollback on duplicate: 4 valid + 1 duplicate → 409 `import_duplikate`, `totals.created=0`, `GET /api/admin/users` unchanged (still only bootstrap admin).
       8. Invalid row rejected at body level: one row missing `email` → 400 `ungueltige_eingabe`, no writes.
       9. Role escalation blocked: row with `role: "admin"` → 400 `ungueltige_eingabe` (Zod restricts to `user|manager`).
      10. Too many rows: 1001 valid rows → 413 `import_zu_viele_zeilen`, no writes.
      11. Oversized payload: JSON body exceeding 1 MB → 413 (handled by the global `express.json({ limit: "1mb" })`). Construct a >1 MB body by padding `rows` with long but schema-valid strings, or by sending a raw buffer of 1.2 MB.
      12. Aggregated audit entry present and PII-free: after any import, query `/api/admin/audit-log` → exactly ONE entry with `action === "user_bulk_import"` for that call; `JSON.stringify(entry.metadata)` does NOT contain any imported username or email substring; `metadata.totals` is an object with `received, created, skipped, failed`.

       Each test MUST assert totals explicitly and MUST verify write-vs-no-write by inspecting `GET /api/admin/users`.

    C. In `src/client/errors/errors.ts`, add entries (German, voice consistent with existing copy):
       - `ungueltige_eingabe: "Eingabe ist ungültig."`
       - `import_zu_viele_zeilen: "Import hat zu viele Zeilen (Maximum 1000)."`
       - `import_duplikate: "Import enthält Duplikate. Bitte im Preview prüfen."`
       - `import_validierungsfehler: "Import enthält ungültige Zeilen. Bitte im Preview prüfen."`
       - `import_datenbank: "Import fehlgeschlagen (Datenbank). Bitte Logs prüfen."`
       (If any of these codes already exist with a differing message, leave existing unchanged; adding duplicates would conflict with TypeScript's object-literal key uniqueness anyway — detect on read.)
  </action>
  <verify>
    <automated>rg -n "/users/bulk-import" src/server/http/admin-routes.ts</automated>
    <automated>rg -n "user_bulk_import" src/server/http/admin-routes.ts</automated>
    <automated>npx vitest run src/server/http/admin-bulk-import.test.ts</automated>
    <automated>npx vitest run src/server/http/app-flow.test.ts</automated>
    <automated>rg -n "import_zu_viele_zeilen|import_duplikate|ungueltige_eingabe" src/client/errors/errors.ts</automated>
    <automated>! rg -n "console\\.(log|warn|error).*(username|email)" src/server/http/admin-routes.ts src/server/domain/bulk-user-import.ts</automated>
  </verify>
  <done>
    Endpoint responds at `POST /api/admin/users/bulk-import`; 12 test cases pass; audit entry is singular and PII-free; German error copy is wired; `app-flow.test.ts` still green; tsc passes.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → /api/admin/users/bulk-import | Untrusted JSON body crosses into the server; size-bound by express.json limit and Zod schema |
| Route → SQLite | Trusted path; writes gated by transaction + unique indexes |
| Audit metadata → audit_logs table | Persisted aggregate must not leak PII |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-11-01 | Spoofing | /api/admin/users/bulk-import | mitigate | Admin role guard already mounted on admin router (admin-routes.ts L125-139); new route inherits. Session cookie required. |
| T-11-02 | Tampering | /api/admin/users/bulk-import | mitigate | Existing CSRF middleware on admin router (L141-148) covers POST. Test 2 asserts CSRF rejection. |
| T-11-03 | Repudiation | bulk-import action | mitigate | Single `user_bulk_import` audit entry per call via `tryWriteAuditLog` with adminId, dryRun, totals, durationMs. Test 12 asserts audit presence. |
| T-11-04 | Information disclosure (audit leak) | audit_logs metadata | mitigate | Audit metadata contains ONLY counts/dryRun/durationMs — no username/email (D-12). Test 12 asserts metadata stringifies without imported PII. |
| T-11-05 | Information disclosure (log leak) | server logs | mitigate | Domain and route forbid logging row contents (D-14). Lint via `rg` check that console.* does not reference username/email/row variables. |
| T-11-06 | Denial of service (oversized payload) | express.json + route | mitigate | Global `express.json({ limit: "1mb" })` already rejects >1 MB with 413 (D-11). Test 11 asserts. |
| T-11-07 | Denial of service (row flood) | bulkImportBodySchema | mitigate | Zod `z.array(...).max(1000)`; route translates too_big error to `import_zu_viele_zeilen` 413. Test 10 asserts. |
| T-11-08 | Denial of service (ReDoS / parser) | body parsing | mitigate | Parsing is server-side JSON via express (no user-supplied regex). No CSV parser on the server (client parses CSV pre-POST per D-06). Zod string bounds (min 1, max 160) cap per-field cost. |
| T-11-09 | Elevation of privilege | rows[].role | mitigate | Zod `z.enum(["user", "manager"])` strips "admin" — row with role=admin returns 400. Test 9 asserts. |
| T-11-10 | Tampering (transaction integrity / race) | concurrent imports | mitigate | Single-writer SQLite + `context.sqlite.transaction(() => {...})()` (serialized). Unique-constraint violations inside the transaction throw → rollback. Test 7 asserts no users created on mid-batch duplicate in confirm mode. |
| T-11-11 | Tampering (schema-strict) | unknown body fields | mitigate | `.strict()` on both row and body schemas rejects unknown keys; prevents smuggling `notificationsEnabled: true` shaped payloads into forbidden fields. |
</threat_model>

<verification>
- `rg "bulk-import" src/server/http/admin-routes.ts` finds the route registration.
- `npx vitest run src/server/http/admin-bulk-import.test.ts` → 12 passing cases.
- `npx vitest run src/server/http/app-flow.test.ts` → still green (no regressions).
- `npx tsc --noEmit` passes.
- Manual: `curl -X POST http://localhost:3000/api/admin/users/bulk-import -H "content-type: application/json" --data '{"rows":[],"dryRun":true}'` without session → 401 `nicht_angemeldet`.
</verification>

<success_criteria>
- [ ] `src/server/domain/bulk-user-import.ts` exists with the exact exports listed in must_haves.artifacts.
- [ ] `POST /api/admin/users/bulk-import` responds per spec for all 12 test cases.
- [ ] Single `user_bulk_import` audit entry per call; metadata contains ONLY `{ dryRun, totals, durationMs, rolledBack }`.
- [ ] `dryRun: true` NEVER writes; confirm with any bad row NEVER writes (all-or-nothing).
- [ ] `>1 MB` payload → 413; `>1000 rows` → 413 `import_zu_viele_zeilen`.
- [ ] No new runtime npm dependency added (verify `git diff package.json` is empty or only dev-dep).
- [ ] German error codes wired in `src/client/errors/errors.ts`.
</success_criteria>

<output>
After completion, create `.planning/phases/11-bulk-user-import/11-01-SUMMARY.md` with:
- Endpoint contract finalized (request, response, error codes)
- Exported domain API (for the UI plan 11-02 to consume)
- Any deviations from CONTEXT.md locked decisions (should be none)
</output>

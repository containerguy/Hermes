---
phase: 09-device-recognition-and-pairing
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/server/db/migrations/0010_device_pairing.sql
  - src/server/db/schema.ts
  - src/server/auth/device-key.ts
  - src/server/auth/pairing-tokens.ts
  - src/server/auth/rate-limits.ts
  - src/server/http/app-flow.test.ts
autonomous: true
requirements: [AUTH-01, AUTH-02]
must_haves:
  truths:
    - "A new SQL migration adds a sessions.device_key_hash column and a pairing_tokens table without breaking existing migrations."
    - "Drizzle schema in src/server/db/schema.ts mirrors the new column and the new pairing_tokens table exactly."
    - "A pure helper module exposes hashDeviceKey(rawKey) and normalizeDeviceSignals(headers/body) for downstream plans."
    - "A pure helper module exposes createPairingToken(), hashPairingToken(token), and the constants PAIR_TOKEN_TTL_MS=10*60*1000 and PAIR_TOKEN_BYTES=32."
    - "A new rate-limit scope 'pair_token_create' is wired into rate-limits.ts with explicit window/max/block constants."
    - "The existing migration assertion test in app-flow.test.ts is extended so CI fails if the new migration regresses."
  artifacts:
    - path: "src/server/db/migrations/0010_device_pairing.sql"
      provides: "Schema migration adding sessions.device_key_hash plus pairing_tokens table and indexes"
      contains: "CREATE TABLE IF NOT EXISTS pairing_tokens"
    - path: "src/server/db/schema.ts"
      provides: "Drizzle definitions for the new column + pairing_tokens table"
      contains: "pairingTokens"
    - path: "src/server/auth/device-key.ts"
      provides: "hashDeviceKey() + normalizeDeviceSignals() helpers"
      exports: ["hashDeviceKey", "normalizeDeviceSignals", "DEVICE_KEY_BYTES"]
    - path: "src/server/auth/pairing-tokens.ts"
      provides: "Pairing token primitives (create/hash + TTL constants)"
      exports: ["createPairingToken", "hashPairingToken", "PAIR_TOKEN_TTL_MS", "PAIR_TOKEN_BYTES"]
    - path: "src/server/auth/rate-limits.ts"
      provides: "pair_token_create scope wired into existing rate limit machinery"
      contains: "pair_token_create"
  key_links:
    - from: "src/server/db/migrate.ts"
      to: "src/server/db/migrations/0010_device_pairing.sql"
      via: "lexicographic migration loader"
      pattern: "0010_device_pairing.sql"
    - from: "src/server/db/schema.ts"
      to: "pairing_tokens table"
      via: "Drizzle table definition + indexes"
      pattern: "pairingTokens"
---

<objective>
Lay the foundation for AUTH-01 and AUTH-02 by adding the storage and primitives every later plan in this phase consumes: a `device_key_hash` column on `sessions`, a new `pairing_tokens` table with HMAC-hashed tokens, helper modules for device-key normalization and pairing-token lifecycle, and a new `pair_token_create` rate-limit scope.

Purpose: Without this plan the verify-OTP same-device path (09-02), the pair endpoints (09-03), and the client UX (09-04) cannot be wired without redoing schema mid-phase. Pre-defining the contracts keeps later plans single-purpose and parallelizable.

Output: One new SQL migration, one updated Drizzle schema, two new helper modules, one extended rate-limit module, and one extended migration assertion test.
</objective>

<execution_context>
@$HOME/.cursor/get-shit-done/workflows/execute-plan.md
@$HOME/.cursor/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md
@AGENTS.md
@src/server/db/schema.ts
@src/server/db/migrations/0005_auth_profile_invite_hardening.sql
@src/server/auth/sessions.ts
@src/server/auth/rate-limits.ts

<interfaces>
Existing exports the new helpers must coexist with (extracted from codebase):

From src/server/auth/sessions.ts:
```typescript
export const SESSION_COOKIE: string;
export const SESSION_MAX_AGE_MS: number;
export function createSessionId(): string;
export function createSessionToken(): string;
export function hashSessionToken(token: string): string;
export function setSessionCookie(response: Response, token: string): void;
export function clearSessionCookie(response: Response): void;
```

From src/server/auth/rate-limits.ts:
```typescript
export type RateLimitScope = "login_request" | "login_verify" | "invite_register"; // EXTEND with "pair_token_create"
export function checkRateLimit(context, input: { scope: RateLimitScope; key: string; sourceIp?: string }): RateLimitResult;
export function recordRateLimitFailure(context, input: { scope: RateLimitScope; key: string }): void;
```

From src/server/db/schema.ts:
```typescript
export const sessions = sqliteTable("sessions", {
  id, userId, deviceName, userAgent, lastSeenAt, createdAt, tokenHash, revokedAt
}, ...);
```

New contracts this plan must export (downstream plans depend on them):

```typescript
// src/server/auth/device-key.ts
export const DEVICE_KEY_BYTES = 16;                       // 128-bit per D-04
export function hashDeviceKey(rawKey: string): string;    // HMAC-SHA256(HERMES_DEVICE_KEY_SECRET, key) hex
export type NormalizedDeviceSignals = {
  platform: "ios" | "android" | "windows" | "macos" | "linux" | "other";
  browser: "chrome" | "firefox" | "safari" | "edge" | "other";
  deviceClass: "mobile" | "desktop";
  pwa: boolean;
};
export function normalizeDeviceSignals(input: {
  userAgent: string | undefined;
  pwa?: boolean | undefined;
}): NormalizedDeviceSignals;
export function deviceSignalsFingerprint(signals: NormalizedDeviceSignals): string;

// src/server/auth/pairing-tokens.ts
export const PAIR_TOKEN_BYTES = 32;                       // 256-bit per D-08
export const PAIR_TOKEN_TTL_MS = 10 * 60 * 1000;          // ≤10min per D-08
export function createPairingToken(): string;             // randomBytes(32).toString("base64url")
export function hashPairingToken(token: string): string;  // HMAC-SHA256(HERMES_PAIR_TOKEN_SECRET, token) hex
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Author the 0010_device_pairing.sql migration</name>
  <files>src/server/db/migrations/0010_device_pairing.sql</files>
  <read_first>
    - src/server/db/migrations/0005_auth_profile_invite_hardening.sql (most recent multi-feature migration; mirror its structure: header comment, ALTER TABLE for sessions, CREATE TABLE IF NOT EXISTS, then CREATE INDEX statements)
    - src/server/db/migrations/0009_event_soft_delete.sql (most recent migration; confirms the next number is 0010)
    - src/server/db/migrate.ts (loader; filenames must sort lexicographically)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-01, D-02, D-04, D-13, D-16)
  </read_first>
  <action>
    Create `src/server/db/migrations/0010_device_pairing.sql` with the following exact statements (ordered):

    1. Header comment: `-- Phase 09: Device Recognition and Session-Bound Pairing (AUTH-01, AUTH-02)`
    2. `ALTER TABLE sessions ADD COLUMN device_key_hash TEXT;` (no default — legacy rows stay NULL per D-02 fallback)
    3. `ALTER TABLE sessions ADD COLUMN device_signals TEXT;` (stores `deviceSignalsFingerprint(...)` as text — used as fallback match key per D-02)
    4. `CREATE INDEX IF NOT EXISTS sessions_user_device_key_idx ON sessions(user_id, device_key_hash);`
    5. `CREATE INDEX IF NOT EXISTS sessions_user_device_signals_idx ON sessions(user_id, device_signals);`
    6. CREATE TABLE for pairing tokens (per D-08, D-11, D-13). Schema:
       ```
       CREATE TABLE IF NOT EXISTS pairing_tokens (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         origin_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         token_hash TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         consumed_at TEXT,
         consumed_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
         created_at TEXT NOT NULL
       );
       ```
    7. `CREATE UNIQUE INDEX IF NOT EXISTS pairing_tokens_token_hash_unique ON pairing_tokens(token_hash);`
    8. `CREATE INDEX IF NOT EXISTS pairing_tokens_origin_session_idx ON pairing_tokens(origin_session_id);`
    9. `CREATE INDEX IF NOT EXISTS pairing_tokens_user_expires_idx ON pairing_tokens(user_id, expires_at);`
    10. `CREATE INDEX IF NOT EXISTS pairing_tokens_expires_at_idx ON pairing_tokens(expires_at);`

    Use `IF NOT EXISTS` on every CREATE INDEX/TABLE per the conventions established in 0005. Do NOT use `IF NOT EXISTS` on `ALTER TABLE` (SQLite does not support it; rely on `schema_migrations` to prevent re-runs). Do not add columns or tables beyond the list above.
  </action>
  <verify>
    <automated>node -e "const fs=require('fs');const s=fs.readFileSync('src/server/db/migrations/0010_device_pairing.sql','utf8');for (const t of ['ALTER TABLE sessions ADD COLUMN device_key_hash','ALTER TABLE sessions ADD COLUMN device_signals','CREATE TABLE IF NOT EXISTS pairing_tokens','pairing_tokens_token_hash_unique','sessions_user_device_key_idx']) { if(!s.includes(t)) { console.error('missing',t); process.exit(1);} } console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/server/db/migrations/0010_device_pairing.sql` exists.
    - Filename sorts lexicographically AFTER `0009_event_soft_delete.sql` (i.e. `ls src/server/db/migrations | sort | tail -1` returns `0010_device_pairing.sql`).
    - File contains literal substrings: `ALTER TABLE sessions ADD COLUMN device_key_hash`, `ALTER TABLE sessions ADD COLUMN device_signals`, `CREATE TABLE IF NOT EXISTS pairing_tokens`, `pairing_tokens_token_hash_unique`, `sessions_user_device_key_idx`, `sessions_user_device_signals_idx`, `pairing_tokens_origin_session_idx`, `pairing_tokens_user_expires_idx`, `pairing_tokens_expires_at_idx`.
    - File contains `REFERENCES users(id) ON DELETE CASCADE` AND `REFERENCES sessions(id) ON DELETE CASCADE` for `origin_session_id`.
    - File does NOT contain the word `device_key` without the `_hash` suffix in any column declaration (raw device keys are NEVER stored).
  </acceptance_criteria>
  <done>Migration file exists, is the new lexicographic tail, and matches the structural assertions above.</done>
</task>

<task type="auto">
  <name>Task 2: Mirror the migration in src/server/db/schema.ts</name>
  <files>src/server/db/schema.ts</files>
  <read_first>
    - src/server/db/schema.ts (current `sessions` table + index style + relations block)
    - src/server/db/migrations/0010_device_pairing.sql (created in Task 1 — schema MUST match exactly)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-13: token storage shape)
  </read_first>
  <action>
    Edit `src/server/db/schema.ts`:

    1. In the `sessions` table definition, add two new optional columns BEFORE the closing `}, (table) => [...]`:
       - `deviceKeyHash: text("device_key_hash"),`
       - `deviceSignals: text("device_signals"),`
       Add to the index array: `index("sessions_user_device_key_idx").on(table.userId, table.deviceKeyHash)` and `index("sessions_user_device_signals_idx").on(table.userId, table.deviceSignals)`. Keep the existing `sessions_token_hash_unique` index. Import `index` from `drizzle-orm/sqlite-core` (already imported at line 2 — verify and reuse).

    2. After the `inviteCodeUses` table (so before the `userRelations`/`gameEventRelations` `relations(...)` block), add a new `pairingTokens` table definition that mirrors the SQL exactly:
       ```ts
       export const pairingTokens = sqliteTable(
         "pairing_tokens",
         {
           id: text("id").primaryKey(),
           userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
           originSessionId: text("origin_session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
           tokenHash: text("token_hash").notNull(),
           expiresAt: text("expires_at").notNull(),
           consumedAt: text("consumed_at"),
           consumedSessionId: text("consumed_session_id").references(() => sessions.id, { onDelete: "set null" }),
           createdAt: text("created_at").notNull()
         },
         (table) => [
           uniqueIndex("pairing_tokens_token_hash_unique").on(table.tokenHash),
           index("pairing_tokens_origin_session_idx").on(table.originSessionId),
           index("pairing_tokens_user_expires_idx").on(table.userId, table.expiresAt),
           index("pairing_tokens_expires_at_idx").on(table.expiresAt)
         ]
       );
       ```

    3. Do NOT change any other table or any existing column. Do NOT touch the `relations(...)` blocks (we don't query pairingTokens through Drizzle's relational API).
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/schema.ts` exports `pairingTokens` (grep `^export const pairingTokens` matches exactly one line).
    - `src/server/db/schema.ts` contains the literal strings `device_key_hash`, `device_signals`, `pairing_tokens_token_hash_unique`, `pairing_tokens_origin_session_idx`, `pairing_tokens_user_expires_idx`.
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
    - No existing exports were renamed or removed (diff against HEAD shows additions only).
  </acceptance_criteria>
  <done>Drizzle schema mirrors the SQL migration; project type-checks.</done>
</task>

<task type="auto">
  <name>Task 3: Add device-key + pairing-token helper modules and pair_token_create rate-limit scope</name>
  <files>src/server/auth/device-key.ts, src/server/auth/pairing-tokens.ts, src/server/auth/rate-limits.ts</files>
  <read_first>
    - src/server/auth/sessions.ts (style for crypto helpers and constants — mirror `hashSessionToken` shape)
    - src/server/auth/rate-limits.ts (full file; see `RateLimitScope` union and `getScopeConfig` switch)
    - src/server/auth/device-names.ts (existing device-name conventions; do not duplicate UA parsing — do a coarser, fingerprint-class normalization here)
    - .planning/phases/09-device-recognition-and-pairing/09-CONTEXT.md (D-04, D-08, D-13)
    - AGENTS.md (env-var conventions: `readRequiredEnv` for must-haves, `process.env` for optional with default)
  </read_first>
  <action>
    Create `src/server/auth/device-key.ts`:

    ```ts
    import { createHmac } from "node:crypto";

    export const DEVICE_KEY_BYTES = 16; // 128-bit per D-04
    export const DEVICE_KEY_BASE64URL_MIN_LENGTH = 22; // base64url(16 bytes) without padding

    function deviceKeySecret() {
      return process.env.HERMES_DEVICE_KEY_SECRET ?? "hermes-dev-device-key-secret";
    }

    export function hashDeviceKey(rawKey: string): string {
      return createHmac("sha256", deviceKeySecret()).update(rawKey).digest("hex");
    }

    export type NormalizedDeviceSignals = {
      platform: "ios" | "android" | "windows" | "macos" | "linux" | "other";
      browser: "chrome" | "firefox" | "safari" | "edge" | "other";
      deviceClass: "mobile" | "desktop";
      pwa: boolean;
    };

    export function normalizeDeviceSignals(input: {
      userAgent: string | undefined;
      pwa?: boolean | undefined;
    }): NormalizedDeviceSignals {
      const ua = (input.userAgent ?? "").toLowerCase();
      const platform: NormalizedDeviceSignals["platform"] =
        ua.includes("iphone") || ua.includes("ipad") ? "ios"
        : ua.includes("android") ? "android"
        : ua.includes("windows") ? "windows"
        : ua.includes("mac os x") || ua.includes("macintosh") ? "macos"
        : ua.includes("linux") ? "linux"
        : "other";
      const browser: NormalizedDeviceSignals["browser"] =
        ua.includes("edg/") ? "edge"
        : ua.includes("chrome/") ? "chrome"
        : ua.includes("firefox/") ? "firefox"
        : ua.includes("safari/") && !ua.includes("chrome/") ? "safari"
        : "other";
      const deviceClass: NormalizedDeviceSignals["deviceClass"] =
        ua.includes("mobile") || ua.includes("iphone") || ua.includes("android") ? "mobile" : "desktop";
      return { platform, browser, deviceClass, pwa: input.pwa === true };
    }

    export function deviceSignalsFingerprint(signals: NormalizedDeviceSignals): string {
      return `${signals.platform}|${signals.browser}|${signals.deviceClass}|${signals.pwa ? "pwa" : "web"}`;
    }
    ```

    Create `src/server/auth/pairing-tokens.ts`:

    ```ts
    import { createHmac, randomBytes } from "node:crypto";

    export const PAIR_TOKEN_BYTES = 32;            // 256-bit per D-08
    export const PAIR_TOKEN_TTL_MS = 10 * 60 * 1000; // ≤10min per D-08

    function pairTokenSecret() {
      return process.env.HERMES_PAIR_TOKEN_SECRET ?? "hermes-dev-pair-token-secret";
    }

    export function createPairingToken(): string {
      return randomBytes(PAIR_TOKEN_BYTES).toString("base64url");
    }

    export function hashPairingToken(token: string): string {
      return createHmac("sha256", pairTokenSecret()).update(token).digest("hex");
    }
    ```

    Edit `src/server/auth/rate-limits.ts`:
    - Extend the `RateLimitScope` union to: `"login_request" | "login_verify" | "invite_register" | "pair_token_create"`.
    - Add a case to `getScopeConfig`:
      `case "pair_token_create": return { windowSeconds: 10 * 60, maxAttempts: 5, blockSeconds: 15 * 60 };`
      (5 token mints per session/user per 10 minutes, 15-minute block — consistent with `login_verify`'s window/block ratio.)
    - Do NOT change any other scope's configuration.
    - Do NOT alter the `checkRateLimit`/`recordRateLimitFailure` function bodies; they are scope-agnostic.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/auth/device-key.ts` exists and exports `hashDeviceKey`, `normalizeDeviceSignals`, `deviceSignalsFingerprint`, `DEVICE_KEY_BYTES`.
    - `src/server/auth/pairing-tokens.ts` exists and exports `createPairingToken`, `hashPairingToken`, `PAIR_TOKEN_TTL_MS`, `PAIR_TOKEN_BYTES`.
    - `grep -E "pair_token_create" src/server/auth/rate-limits.ts` matches at least 2 lines (union + switch case).
    - Neither helper file calls `console.log` with raw token/key values (grep confirms zero hits for `console.log` in both new files).
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
    - Both new files use `createHmac` (not `createHash`) — confirms tokens are HMAC-keyed per D-13, not plain SHA256.
  </acceptance_criteria>
  <done>Helper modules exist with the documented exports; rate-limit scope is wired; project type-checks.</done>
</task>

<task type="auto">
  <name>Task 4: Extend the migration assertion test for the new schema</name>
  <files>src/server/http/app-flow.test.ts</files>
  <read_first>
    - src/server/http/app-flow.test.ts (specifically the test `it("applies schema migrations including Phase 1 auth hardening foundations", ...)` around lines 60–109 — mirror its assertion style)
    - src/server/db/migrations/0010_device_pairing.sql (created in Task 1)
  </read_first>
  <action>
    In the existing test `it("applies schema migrations including Phase 1 auth hardening foundations", ...)` in `src/server/http/app-flow.test.ts`, append (BEFORE `sqlite.close();`) the following assertions:

    ```ts
    expect(sessionsColumns).toContain("device_key_hash");
    expect(sessionsColumns).toContain("device_signals");
    expect(tables).toContain("pairing_tokens");
    expect(indexes).toContain("pairing_tokens_token_hash_unique");
    expect(indexes).toContain("sessions_user_device_key_idx");
    expect(indexes).toContain("sessions_user_device_signals_idx");
    expect(indexes).toContain("pairing_tokens_origin_session_idx");
    expect(indexes).toContain("pairing_tokens_user_expires_idx");
    ```

    Do not change the test name or any other assertion. Do not introduce a new `it(...)` block — extend the existing schema-migrations test so a single failing run pins the problem to migrations.
  </action>
  <verify>
    <automated>npx vitest run src/server/http/app-flow.test.ts -t "applies schema migrations"</automated>
  </verify>
  <acceptance_criteria>
    - `npx vitest run src/server/http/app-flow.test.ts -t "applies schema migrations"` exits 0.
    - `grep -c "pairing_tokens" src/server/http/app-flow.test.ts` returns at least 4.
    - `grep -c "device_key_hash" src/server/http/app-flow.test.ts` returns at least 1.
    - No new `describe(` or `it(` blocks were added to this file (line count delta is small; only inside the existing test).
  </acceptance_criteria>
  <done>Migration regression is now guarded by CI for the new schema.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → /api/auth/verify-code body | Untrusted device key arrives in request body (consumed by 09-02) — this plan must define the storage shape so the raw key is NEVER persisted. |
| disk (SQLite snapshot, S3 backup) | Snapshot exfiltration must not yield usable pairing tokens or device keys. |
| HMAC-secret env vars | `HERMES_DEVICE_KEY_SECRET` and `HERMES_PAIR_TOKEN_SECRET` are net-new server secrets; defaults are dev-only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-01 | Information Disclosure | sessions.device_key_hash column | mitigate | Column stores HMAC-SHA256(secret, key) only; raw key never has a column (acceptance criterion enforces no `device_key` non-`_hash` column). |
| T-09-02 | Information Disclosure | pairing_tokens.token_hash column | mitigate | D-13: store HMAC of token, not the token itself. `hashPairingToken` uses `createHmac`, not `createHash` (acceptance criterion enforces). |
| T-09-03 | Tampering | HMAC secret missing in prod | accept | Both helpers fall back to a documented dev-only string AND key off `process.env`; runbook (Phase 13/release-notes work) must add the env vars to `.env.example` — flagged as residual risk; no production fail-fast in this plan to avoid breaking dev (consistent with `csrf.ts` precedent). |
| T-09-04 | Spoofing | Forged device-signals fingerprint | accept | Fingerprint is a fallback identifier only; D-02 always prefers the device key. Per D-01 we accept low-entropy collisions (multiple users may share a fingerprint). |
| T-09-05 | DoS | Token enumeration via repeated mint | mitigate | New `pair_token_create` rate-limit scope (Task 3): 5 mints per 10-minute window per key, 15-minute block. Consumed by 09-03. |
| T-09-06 | Repudiation | Audit log lacks token storage | accept (defers to 09-03) | This plan only provides the storage shape; audit codes (`device_pair_created`, `device_pair_redeemed`) are emitted by 09-03 per D-11, NEVER carrying token or device-key values. |
</threat_model>

<verification>
- `node -e "..."` migration shape check (Task 1) passes.
- `npx tsc --noEmit -p tsconfig.json` passes.
- `npx vitest run src/server/http/app-flow.test.ts -t "applies schema migrations"` passes.
- `grep -E "device_key_hash|pairing_tokens" src/server/db/schema.ts` matches both names.
- `rg "console\.log" src/server/auth/device-key.ts src/server/auth/pairing-tokens.ts` returns zero matches (no leak path).
</verification>

<success_criteria>
- Migration `0010_device_pairing.sql` is the new lexicographic tail and applies cleanly.
- Drizzle schema exports `pairingTokens` and the new `sessions` columns.
- `src/server/auth/device-key.ts` and `src/server/auth/pairing-tokens.ts` export the contracts documented in `<interfaces>` and use HMAC (not plain SHA256).
- `pair_token_create` is a recognized `RateLimitScope` with explicit window/max/block constants.
- Migration assertion test asserts every new column/table/index name listed in the migration.
</success_criteria>

<output>
After completion, create `.planning/phases/09-device-recognition-and-pairing/09-01-SUMMARY.md` recording: migration filename, new exports, new env-var names introduced (`HERMES_DEVICE_KEY_SECRET`, `HERMES_PAIR_TOKEN_SECRET`), and the test that now guards regressions.
</output>

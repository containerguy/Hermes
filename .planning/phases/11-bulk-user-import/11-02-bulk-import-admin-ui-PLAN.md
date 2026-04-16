---
phase: 11
plan: 02
type: execute
wave: 2
depends_on: [11-01]
files_modified:
  - src/client/components/AdminPanel.tsx
  - src/client/components/BulkUserImport.tsx
  - src/client/components/bulk-user-import-parse.ts
  - src/client/components/bulk-user-import-parse.test.ts
  - src/styles.css
autonomous: true
requirements: [ADM-02]
tags: [admin, users, bulk-import, client, react, csv, json]
must_haves:
  truths:
    - "AdminPanel exposes a new 'Bulk-Import' section reachable from the admin nav."
    - "Admin can paste CSV or JSON into a textarea, or upload a single file (≤1 MB, .csv/.json) — format is auto-detected."
    - "Parsing happens client-side and ALWAYS shows a Preview table with per-row parse/validation errors and in-batch duplicate markers before any request is sent."
    - "Admin can choose Dry-Run (validates server-side, never writes) or Confirm (writes in one transaction)."
    - "Result view displays aggregated totals (received / created / skipped / failed) plus per-row outcomes with status badges ('created', 'skipped: duplicate', 'failed: validation', 'failed: db')."
    - "Result is downloadable/copyable as a single CSV or JSON (one-shot, per D-05)."
    - "German error copy resolves for every bulk-import error code via the existing `errorMessages` mapping (no raw codes in the UI)."
    - "If the server returns 409 import_duplikate or import_validierungsfehler, the UI re-shows the preview with those markers without re-submitting."
  artifacts:
    - path: "src/client/components/bulk-user-import-parse.ts"
      provides: "Pure helpers: sniffFormat(text), parseCsv(text), parseJson(text), normalizeRows(raw), RowError/PreviewRow types"
      exports: ["sniffFormat", "parseRows", "normalizeRows", "PreviewRow", "ParseResult", "BULK_IMPORT_MAX_ROWS_CLIENT"]
    - path: "src/client/components/bulk-user-import-parse.test.ts"
      provides: "Vitest unit coverage for CSV/JSON parsing, whitespace, quoting, mixed case, oversized, malformed"
    - path: "src/client/components/BulkUserImport.tsx"
      provides: "Standalone React component rendering input mode (paste/upload), preview table, dry-run/confirm actions, result view, download"
      exports: ["BulkUserImport"]
    - path: "src/client/components/AdminPanel.tsx"
      provides: "Adds 'bulkImport' to AdminSection union, a nav button, and renders <BulkUserImport /> when active"
      contains: "BulkUserImport"
    - path: "src/styles.css"
      provides: "Layout rules for .bulk-import-* surfaces (preview table, status badges)"
  key_links:
    - from: "src/client/components/BulkUserImport.tsx"
      to: "/api/admin/users/bulk-import"
      via: "requestJson POST with { rows, dryRun } after CSRF cookie-backed session"
      pattern: "/api/admin/users/bulk-import"
    - from: "src/client/components/BulkUserImport.tsx"
      to: "src/client/components/bulk-user-import-parse.ts"
      via: "import { parseRows, sniffFormat, normalizeRows }"
      pattern: "bulk-user-import-parse"
    - from: "src/client/components/AdminPanel.tsx"
      to: "src/client/components/BulkUserImport.tsx"
      via: "new AdminSection 'bulkImport' renders <BulkUserImport />"
      pattern: "BulkUserImport"
---

<objective>
Build the admin-facing UI for ADM-02: a new "Bulk-Import" section in AdminPanel with paste-or-upload input, client-side parse, always-on preview with validation + in-batch duplicate markers, Dry-Run and Confirm actions that call the `/api/admin/users/bulk-import` endpoint shipped in 11-01, and a result view with per-row outcomes and one-shot download (per D-01, D-04, D-05).

Purpose: Complete the ADM-02 user story so admins can onboard many users at once with confidence.
Output: A new `BulkUserImport` React component, a client-side CSV/JSON parser with Vitest coverage, AdminPanel wiring, and CSS additions.
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
@.planning/phases/11-bulk-user-import/11-01-SUMMARY.md
@AGENTS.md

@src/client/components/AdminPanel.tsx
@src/client/errors/errors.ts
@src/client/api/request.ts
@src/client/types/core.ts
@src/styles.css

<interfaces>
From the 11-01 server contract (see 11-01-SUMMARY.md and src/server/domain/bulk-user-import.ts):
```typescript
// Request
POST /api/admin/users/bulk-import
body: { rows: BulkImportRow[]; dryRun: boolean }
type BulkImportRow = {
  username: string;       // 1..80
  email: string;          // valid email, ..160
  role?: "user" | "manager";
  notificationsEnabled?: boolean;
}

// Response — success or dry-run
200 OK: { ok: true; dryRun: boolean; outcomes: BulkImportOutcome[]; totals: { received: number; created: number; skipped: number; failed: number } }

// Response — confirm blocked by duplicates / validation
409: { error: "import_duplikate" | "import_validierungsfehler"; outcomes: BulkImportOutcome[]; totals: {...} }

// Response — db rollback
500: { error: "import_datenbank"; outcomes: BulkImportOutcome[]; totals: {...} }

// Response — shape errors
400: { error: "ungueltige_eingabe" }
413: { error: "import_zu_viele_zeilen"; limit: number }
413: raw express "PayloadTooLargeError" (payload >1 MB)

type BulkImportOutcome =
  | { status: "created"; username: string }
  | { status: "skipped"; reason: "duplicate"; username: string; field: "username" | "email" | "both" }
  | { status: "failed"; reason: "validation"; username: string; message: string }
  | { status: "failed"; reason: "db"; username: string; message: string };
```

From src/client/api/request.ts:
```typescript
export function requestJson<T>(url: string, init?: RequestInit): Promise<T>;
// Sends credentials:"include"; sets Content-Type; maps {error} → thrown ApiError with `code`.
```

From src/client/errors/errors.ts:
```typescript
export const errorMessages: Record<string, string>;
export function getErrorMessage(caught: unknown): string;
```

From src/client/components/AdminPanel.tsx (existing pattern to mirror):
- `type AdminSection = "users" | "settings" | "storage" | "rateLimits" | "invites" | "audit";` — EXTEND to add `"bulkImport"`.
- Sidebar `<nav>` renders buttons per section; add one more.
- `activeSection === "X" ? <section/> : null` render pattern.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Client-side CSV/JSON parser module + unit tests</name>
  <read_first>
    - src/client/types/core.ts (User role type)
    - .planning/phases/11-bulk-user-import/11-CONTEXT.md (D-02, D-03, D-11)
    - .planning/phases/11-bulk-user-import/11-01-SUMMARY.md (exact server schema)
    - .planning/codebase/CONVENTIONS.md (TypeScript/Vitest conventions)
  </read_first>
  <files>src/client/components/bulk-user-import-parse.ts, src/client/components/bulk-user-import-parse.test.ts</files>
  <action>
    Implement a dependency-free parser (D-16 — no new deps; a ~30-line CSV reader is sufficient for header-required CSV).

    1. Exported constant: `BULK_IMPORT_MAX_ROWS_CLIENT = 1000` (mirrors server cap — when parsing yields >1000 rows, surface a single `row_count` error and do NOT truncate silently).

    2. Types:
       ```typescript
       export type PreviewRow = {
         index: number;              // 1-based row number in the input (after header)
         raw: Record<string, string>;// original keys/values
         normalized: { username: string; email: string; role?: "user" | "manager"; notificationsEnabled?: boolean };
         errors: RowError[];         // client-side only; server re-validates authoritatively
         duplicateInBatch?: "username" | "email" | "both";
       };
       export type RowError =
         | { code: "missing_username" }
         | { code: "missing_email" }
         | { code: "invalid_email" }
         | { code: "invalid_role"; value: string }
         | { code: "invalid_notifications_flag"; value: string }
         | { code: "username_too_long" }
         | { code: "email_too_long" };
       export type ParseResult =
         | { ok: true; rows: PreviewRow[]; format: "csv" | "json" }
         | { ok: false; reason: "empty" | "unrecognized_format" | "too_many_rows" | "malformed_json" | "malformed_csv"; detail?: string };
       ```

    3. `sniffFormat(text: string): "csv" | "json" | null`:
       - Trim leading whitespace; if first non-ws char is `[` or `{` → `"json"`.
       - Else if the first line contains `,` and is followed by a newline → `"csv"`.
       - Else `null`.

    4. `parseRows(text: string): ParseResult`:
       - Empty or whitespace-only → `{ ok: false, reason: "empty" }`.
       - JSON: `JSON.parse`; must be an array of objects; otherwise `malformed_json`.
       - CSV: split by `\n`, first line = header (required per D-02). Handle double-quoted fields with escaped `""`. Strip `\r`. Reject if header lacks both `username` and `email` → `malformed_csv` with detail.
       - If rowCount > BULK_IMPORT_MAX_ROWS_CLIENT → `{ ok: false, reason: "too_many_rows" }`.

    5. `normalizeRows(raw: Record<string, string>[]): PreviewRow[]`:
       - For each raw row:
         - `username = raw.username?.trim()`; missing or empty → RowError `missing_username`. `>80` → `username_too_long`.
         - `email = raw.email?.trim()`; missing → `missing_email`; fails basic `^[^\s@]+@[^\s@]+\.[^\s@]+$` → `invalid_email`; `>160` → `email_too_long`.
         - `role`: optional; if present, must match `/^(user|manager)$/i` (lowercase before output); otherwise `invalid_role`.
         - `notificationsEnabled`: optional; accept `"true" | "false" | "1" | "0" | "yes" | "no" | "ja" | "nein"` (case-insensitive) → map to boolean; otherwise `invalid_notifications_flag`.
       - After row-level errors, detect in-batch duplicates:
         - Lowercase-username set: first occurrence wins; subsequent get `duplicateInBatch: "username"`.
         - Lowercase-email set: same. If both → `"both"`.

    6. Unit tests in `bulk-user-import-parse.test.ts` (Vitest), each assertion uses explicit arrays for diffability:
       - CSV happy path (3 rows, all columns).
       - CSV with missing optional columns (only username,email) → role/notificationsEnabled undefined.
       - CSV with quoted field containing a comma (`"Doe, Jane"` not allowed but email can contain `+` — keep a simple test).
       - JSON happy path.
       - JSON not-an-array → `malformed_json`.
       - Empty string → `empty`.
       - Missing `username` header in CSV → `malformed_csv`.
       - Unrecognized format (plain text with no commas and no braces) → `sniffFormat` returns `null`.
       - Too many rows: 1001-row array → `too_many_rows`.
       - Duplicate detection: two rows with `JOHN@x.de` and `john@x.de` → second gets `duplicateInBatch: "email"`.
       - Invalid role: `role: "admin"` → `invalid_role`.
       - Bool normalization: `"Ja"`, `"NO"` → boolean true/false; `"maybe"` → `invalid_notifications_flag`.
  </action>
  <verify>
    <automated>npx vitest run src/client/components/bulk-user-import-parse.test.ts</automated>
    <automated>rg -n "export (type|const|function) (PreviewRow|ParseResult|parseRows|sniffFormat|normalizeRows|BULK_IMPORT_MAX_ROWS_CLIENT)" src/client/components/bulk-user-import-parse.ts</automated>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
  </verify>
  <done>
    All 11 unit tests pass; exports match the interface contract; tsc passes; no new runtime deps added.
  </done>
</task>

<task type="auto">
  <name>Task 2: BulkUserImport React component (paste/upload, preview, dry-run/confirm, result, download)</name>
  <read_first>
    - src/client/components/AdminPanel.tsx (createUser form pattern L201–214, isAdmin guard L76, activeSection rendering L534–597)
    - src/client/components/bulk-user-import-parse.ts (from Task 1)
    - src/client/api/request.ts (requestJson + error handling)
    - src/client/errors/errors.ts (getErrorMessage + the new codes added in 11-01)
    - .planning/phases/11-bulk-user-import/11-CONTEXT.md (D-01, D-02, D-04, D-05, D-11)
    - src/styles.css L525+ (.admin-form patterns, radius, min-height)
  </read_first>
  <files>src/client/components/BulkUserImport.tsx, src/styles.css</files>
  <action>
    Create `src/client/components/BulkUserImport.tsx` exporting `BulkUserImport({ onImported }: { onImported?: () => void })`.

    State machine (explicit `phase` state var):
      `"idle"` → user enters text or picks a file → `"preview"` → Dry-Run/Confirm → `"submitting"` → `"result"` → (reset to idle or re-edit).

    UI sections:
      1. **Input panel** (always shown in `idle` / `preview`):
         - Radio toggle: "Einfügen" (paste) vs. "Datei hochladen" (upload) — per D-01.
         - Paste mode: `<textarea>` with German placeholder and 2000-char minHeight hint. Live-parse on blur or explicit "Vorschau anzeigen" button.
         - Upload mode: `<input type="file" accept=".csv,.json,text/csv,application/json" />`. Read with `FileReader.readAsText`. Reject `file.size > 1_048_576` with the `import_nutzlast_zu_gross` client-only code (it never round-trips; client-side guard mirrors D-11). ALSO add a German copy entry to `src/client/errors/errors.ts` in the same Task 2 edit: `import_nutzlast_zu_gross: "Datei ist zu groß (maximal 1 MB)."` — this MUST ship alongside the component so `getErrorMessage("import_nutzlast_zu_gross")` never returns a raw code.
         - Format chip shows detected `csv` / `json` / "unbekannt" (uses `sniffFormat`).
         - Primary action: "Vorschau" triggers `parseRows` → updates preview.

      2. **Preview table** (shown when parse has results; per D-04):
         - Columns: `#`, `Username`, `E-Mail`, `Rolle`, `Notifications`, `Status`.
         - Status column renders chips:
           - `ok` (green) if `errors.length === 0 && !duplicateInBatch`.
           - `dup: batch` (amber) if `duplicateInBatch` set.
           - `error: <code>` (red) per row-level error, joined with `; `.
         - A header summary line: `"N Zeilen — X gültig · Y Duplikate · Z Fehler"`.
         - Buttons:
           - "Dry-Run" (secondary) — `dryRun: true`. Payload rule (canonical): send `rows = parseResult.rows.filter(r => r.errors.length === 0).map(r => r.normalized)`. Rows with row-level client-parse errors are NEVER sent (they would fail Zod server-side anyway and clutter outcomes). Rows flagged `duplicateInBatch` ARE still sent so the server-side authoritative duplicate detection (per D-06) produces the canonical outcomes.
           - "Import bestätigen" (primary) — `dryRun: false`, SAME payload rule as Dry-Run.
           - "Zurücksetzen" (secondary) — returns to `idle`, clears state.
         - Button enablement rule (canonical, resolves any earlier ambiguity):
           - "Import bestätigen" is DISABLED when any row has row-level client-parse errors (a write should never run with known-bad rows).
           - "Dry-Run" is ENABLED even when some rows have row-level client-parse errors — it still sends only the clean rows (per payload rule above) so the admin can at least validate the salvageable subset against the server.
           - If EVERY row has a client-parse error, BOTH buttons are disabled (nothing to send).

      3. **Result view** (per D-05):
         - Totals summary: `received / created / skipped / failed` with badges.
         - Per-row outcome list with chips:
           - `created` (green)
           - `skipped: duplicate` (amber) + field (`username` / `email` / `both`)
           - `failed: validation` (red) + server message
           - `failed: db` (red) + server message
         - "Als CSV herunterladen" and "Als JSON herunterladen" buttons produce a blob and trigger a one-shot download (Blob + URL.createObjectURL + click an `<a download>`). Filename: `hermes-import-result-<ISO>.csv` / `.json`.
         - "Neuen Import starten" resets to `idle`.
         - On success of a confirm import, call `onImported?.()` so AdminPanel can refresh the user list.

    Network call (via `requestJson`):
      ```ts
      const response = await requestJson<{ ok: true; dryRun: boolean; outcomes: BulkImportOutcome[]; totals: Totals }>(
        "/api/admin/users/bulk-import",
        { method: "POST", body: JSON.stringify({ rows, dryRun }) }
      );
      ```

    Error handling:
      - `ApiError.code === "import_duplikate"` OR `"import_validierungsfehler"`: the error object from `requestJson` MUST carry the response body (extend the existing pattern if needed). If `requestJson` discards the body, use raw `fetch` here with `credentials: "include"` and manual parse — verify the contract by reading `src/client/api/request.ts` first; if non-trivial, scope this task to raw `fetch` for this one endpoint with a small inline helper.
      - On 409, set phase back to `preview` with server outcomes rendered as row-level markers (so the admin can fix or switch to Dry-Run); display `getErrorMessage(caught)` above the preview.
      - On 413 (`import_zu_viele_zeilen` or a raw PayloadTooLarge): display the mapped German message and stay in preview.
      - All unknown errors: render `getErrorMessage(caught)` in the red `.error` banner.

    Guardrails:
      - Never render raw usernames/emails twice after import — only the per-row outcome list. Do NOT store imported PII in `localStorage` or `sessionStorage`.
      - Keyboard accessibility: all buttons have visible labels and `type="button"` unless they're form submits; preview table has an `aria-label="Vorschau"`.

    CSS additions in `src/styles.css` (append at end of file to minimize conflicts):
      - `.bulk-import-shell`, `.bulk-import-input`, `.bulk-import-preview`, `.bulk-import-preview table`, `.bulk-import-preview th/td`, `.bulk-import-status-chip.ok/.dup/.error`, `.bulk-import-result`, `.bulk-import-totals`.
      - Reuse existing tokens `var(--teal)`, `var(--rose)`, `var(--amber)`, `var(--surface)`; radius `8px`; button min-height `44px` (per CONVENTIONS).
  </action>
  <verify>
    <automated>rg -n "/api/admin/users/bulk-import" src/client/components/BulkUserImport.tsx</automated>
    <automated>rg -n "export function BulkUserImport|export const BulkUserImport" src/client/components/BulkUserImport.tsx</automated>
    <automated>rg -n "bulk-import-shell|bulk-import-preview|bulk-import-status-chip" src/styles.css</automated>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
    <automated>npx vitest run</automated>
  </verify>
  <done>
    `BulkUserImport.tsx` renders paste/upload → preview → dry-run/confirm → result flow. CSS hooks exist. No TS errors. Entire vitest suite green (no regressions to existing client tests).
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire BulkUserImport into AdminPanel sidebar + manual smoke</name>
  <read_first>
    - src/client/components/AdminPanel.tsx (AdminSection union L45, sidebar nav L470–528, activeSection === ... rendering blocks)
    - src/client/components/BulkUserImport.tsx (from Task 2)
  </read_first>
  <files>src/client/components/AdminPanel.tsx</files>
  <action>
    1. Extend `type AdminSection = "users" | "settings" | "storage" | "rateLimits" | "invites" | "audit" | "bulkImport";`.
    2. In the sidebar `<nav>`, add a new button (directly after the "users" button so related flows sit together):
       ```tsx
       <button
         type="button"
         className={activeSection === "bulkImport" ? "secondary active" : "secondary"}
         onClick={() => setActiveSection("bulkImport")}
       >
         Bulk-Import
       </button>
       ```
    3. After the existing `{activeSection === "users" ? (...) : null}` block, add:
       ```tsx
       {activeSection === "bulkImport" ? (
         <>
           <h2>Bulk-Import.</h2>
           <BulkUserImport onImported={() => loadAdminData().catch(() => undefined)} />
         </>
       ) : null}
       ```
    4. Import at the top: `import { BulkUserImport } from "./BulkUserImport";`.
    5. Do NOT remove or reorder existing sections.

    Smoke steps (documented in SUMMARY, not gated here):
      - `npm run dev` → login as admin → AdminPanel → Bulk-Import → paste 3-row CSV → Vorschau → Dry-Run → confirm totals → Import bestätigen → verify new users appear in users tab.
  </action>
  <verify>
    <automated>rg -n "bulkImport" src/client/components/AdminPanel.tsx</automated>
    <automated>rg -n "BulkUserImport" src/client/components/AdminPanel.tsx</automated>
    <automated>npx tsc --noEmit -p tsconfig.json</automated>
    <automated>npx vitest run src/client/components/ui-correctness.test.tsx</automated>
  </verify>
  <done>
    AdminPanel shows a "Bulk-Import" sidebar button and renders `BulkUserImport` with `onImported` refreshing the user list. No regressions in existing AdminPanel behavior.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Admin clipboard/file → browser memory | CSV/JSON is parsed in the renderer; DOM treats values as text only |
| Browser → /api/admin/users/bulk-import | Admin-authenticated cookie session; CSRF header `x-hermes-csrf` attached by requestJson wrapper |
| Result download → local disk | One-shot Blob download initiated by the user; no auto-save |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-11-12 | Spoofing / Elevation | AdminPanel section gate | mitigate | AdminPanel already gated by `isAdmin` (L76 admin-panel); BulkUserImport is only rendered inside AdminPanel. |
| T-11-13 | Tampering | Request body | mitigate | requestJson attaches CSRF header + credentials; server (11-01) is the authoritative validator. Client parsing is best-effort UX. |
| T-11-14 | Information disclosure (XSS via user-supplied CSV) | Preview table + Result list | mitigate | React's default JSX interpolation escapes text; no `dangerouslySetInnerHTML` anywhere in the new component. Grep check enforced. |
| T-11-15 | DoS (oversized upload crashes the tab) | FileReader path | mitigate | Reject files `>1_048_576` bytes pre-read; reject `>1000` parsed rows with `too_many_rows` before a network call. |
| T-11-16 | Information disclosure (PII in localStorage) | Client state | mitigate | No `localStorage` / `sessionStorage` / IndexedDB writes in BulkUserImport; state lives in React hooks and is cleared on "Neuen Import starten". Grep check enforced. |
| T-11-17 | Repudiation | Audit trail | mitigate | Server emits the audit entry per 11-01; client just renders counts. |
| T-11-18 | Tampering (CSV injection) | Downloaded result CSV | accept | Low risk in LAN-scale tooling and the downloaded file is NOT a UI that opens in Excel by default for the user; if later concern: prepend a leading `'` before cells starting with `=`, `+`, `-`, `@`. Left as accepted for v1.2. |
</threat_model>

<verification>
- `rg "/api/admin/users/bulk-import" src/client/components/BulkUserImport.tsx` finds the call.
- `rg "dangerouslySetInnerHTML" src/client/components/BulkUserImport.tsx` returns no matches.
- `rg "localStorage|sessionStorage|IndexedDB" src/client/components/BulkUserImport.tsx` returns no matches.
- `npx vitest run` → green (parser tests + existing suites).
- `npx tsc --noEmit` passes.
- Manual: paste happy-path 3-row CSV → preview/dry-run/confirm round trip renders correctly.
</verification>

<success_criteria>
- [ ] New AdminPanel sidebar entry "Bulk-Import" routes to `<BulkUserImport />`.
- [ ] Paste and Upload modes both produce a preview from a well-formed CSV and JSON sample.
- [ ] Dry-Run never creates users (server-verified in 11-01 Task 2 Test 3; here asserted manually via a 3-row sample).
- [ ] Confirm with all-clean rows creates users; `onImported` triggers AdminPanel user-list refresh.
- [ ] Confirm with duplicates returns to preview with 409 mapping and shows per-row outcomes.
- [ ] Per-row outcomes are downloadable as CSV AND JSON (one-shot).
- [ ] No raw error codes appear in the UI — every code in `src/client/errors/errors.ts` resolves via `getErrorMessage`.
- [ ] No new runtime npm dependency (`git diff package.json` shows only dev-deps if anything).
- [ ] All vitest suites green.
</success_criteria>

<output>
After completion, create `.planning/phases/11-bulk-user-import/11-02-SUMMARY.md` with:
- UI surface added (screenshots optional)
- Known UX limitations (e.g., CSV quoting edge cases)
- Follow-ups, if any, to record as backlog
</output>

# Phase 11: Admin Bulk User Import - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Source:** Promoted from todo `2026-04-16-bulk-import-of-users.md`

<domain>
## Phase Boundary

This phase delivers a CSV/JSON bulk-user-import affordance in the AdminPanel and a corresponding admin-only server endpoint with preview, dry-run, validation, duplicate detection, transactional write, and aggregated audit logging.

Out of scope: importing managers (only base users), updating existing users in place (import is create-only with skip-on-duplicate), and inviting users via mass-mail.
</domain>

<decisions>
## Implementation Decisions

### Input & UX (locked)

- D-01: Two input modes in the AdminPanel: **paste** (textarea, format auto-detected by leading character / content sniff) and **upload** (single file, ≤ 1 MB).
- D-02: Supported formats: **CSV** (header row required) and **JSON** (array of objects). MIME types `text/csv`, `application/json`, plus `.csv`/`.json` extensions.
- D-03: Required columns/keys: `username`, `email`. Optional: `role` (`user` | `manager`; default `user`), `notificationsEnabled` (default per existing settings default).
- D-04: The flow is two-step: **Preview** (always — shows parsed rows, validation errors, duplicate-against-DB markers) → **Confirm Import** (or **Dry Run**, which performs the validation pass without writing).
- D-05: Result view shows counts and a per-row outcome list (`created`, `skipped: duplicate`, `failed: <reason>`) with a one-shot copy/download of the result.

### Server (locked)

- D-06: New admin-only endpoint, e.g. `POST /api/admin/users/bulk-import`, accepting `{ rows: ImportRow[], dryRun: boolean }` after parsing happens client-side. (Server **also** validates — never trust the client.)
- D-07: Validation uses **Zod** for row shape; reject the entire import on shape errors at the body level, but report per-row business errors (duplicate, invalid role) without aborting the batch unless `dryRun: false` and **any** row fails — see D-08.
- D-08: Write atomicity: when `dryRun: false`, the import runs in a **single SQLite transaction**. Default policy: **all-or-nothing** on row-level failures (failures roll back the whole batch). The planner may add a future flag for "best-effort" mode but the default for v1.2 is all-or-nothing.
- D-09: Duplicate detection: case-insensitive match on `username` and `email` against existing users. Duplicate rows are reported as `skipped: duplicate` in dry-run; in confirm mode they cause rollback per D-08.
- D-10: Defaults applied server-side: `notificationsEnabled` defaults to the project's existing default; passwordless login flow is unchanged (no email is sent on import — newly created users sign in via the standard email-OTP path).
- D-11: Rate limiting: the endpoint reuses the existing per-admin rate-limit envelope (extending if needed). Cap import payload size at **1 MB** and **≤ 1000 rows**.

### Audit & Privacy (locked)

- D-12: A single aggregated audit entry per import: `user_bulk_import` with `{ adminId, dryRun, totals: { received, created, skipped, failed }, durationMs }`. **No usernames/emails in the audit body.**
- D-13: Per-row outcomes are returned in the HTTP response only — they are not persisted server-side beyond the audit aggregate.
- D-14: PII handling: server logs (info/warn) MUST NOT echo row contents; only counts and the `adminId` performing the import.

### Cross-Cutting (locked)

- D-15: CSRF + session-cookie conventions match the existing admin endpoints.
- D-16: No new server dependencies if a hand-written CSV parser of ~30 lines suffices; if a parser is justified, prefer one with zero runtime dependencies (e.g. `papaparse` is acceptable but evaluate first).
- D-17: Tests cover: happy path (valid 5-row CSV → 5 created), duplicate detection, invalid-row rejection, dry-run never writes, transaction rollback on mid-batch failure, oversized payload rejection.

### Claude's Discretion

- Whether parsing is purely client-side, purely server-side, or both (server validation is mandatory either way per D-06).
- Whether to add a downloadable error CSV from the preview step.
- Visual design of the preview table.
- Whether to allow `role: admin` in import (current decision: **no** — admins are created manually).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Client
- `src/client/components/AdminPanel.tsx` — host for the import UI
- `src/main.tsx` — only if router/shell wiring is needed

### Server
- `src/server/http/admin-routes.ts` — admin endpoint conventions, CSRF, role guards
- `src/server/db/schema.ts` — users table, audit-log table

### Project Convention
- `.planning/codebase/CONVENTIONS.md` — Zod usage, test layout
- `.planning/codebase/CONCERNS.md` — admin abuse vectors and rate-limit posture

</canonical_refs>

<specifics>
## Specific Ideas

- Endpoint: `POST /api/admin/users/bulk-import` with body `{ rows: ImportRow[], dryRun: boolean }`.
- Audit code: `user_bulk_import`.
- Limits: 1 MB payload, 1000 rows.
- Result row outcomes: `created`, `skipped: duplicate`, `failed: validation`, `failed: db`.

</specifics>

<deferred>
## Deferred Ideas

- Bulk update of existing users.
- Bulk import of managers and admins via the same flow.
- Sending welcome emails on import.
- Best-effort partial-success import mode.

</deferred>

---

*Phase: 11-bulk-user-import*
*Context gathered: 2026-04-16 from todos promotion*

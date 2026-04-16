# Phase 3: Backup And Restore Safety - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 makes S3 snapshot **backup + restore operationally safe** for admins:

- Backup status is visible to operators (BKP-01).
- Manual restore validates snapshot compatibility and foreign-key integrity **before** live mutation (BKP-02).
- Manual restore creates a pre-restore recovery snapshot and returns its identifier (BKP-03).
- Restore copies tables by explicit compatible columns (no `SELECT *`) or rejects incompatible snapshots (BKP-04).
- Audit entries identify actor and outcome without secrets or misleading partial-success metadata (BKP-05).
- Operator docs explain failed-restore recovery and the single-writer snapshot model (BKP-06).

</domain>

<decisions>
## Implementation Decisions

### Backup status visibility (BKP-01)

- **D-01:** Backup status is surfaced **in the Admin UI** (backup/restore section), not via a dedicated new status API endpoint.
- **D-02:** The status panel shows:
  - last successful backup time
  - last backup failure time
  - failure code/category
  - **non-secret** storage location details (bucket/key/endpoint/region as applicable)
  - a short, **human-readable error summary** for the last failure
- **D-03:** On manual backup errors, the UI shows the error immediately and keeps the last-known status so operators can retry without losing context.

### Restore validation strictness (BKP-02, BKP-04)

- **D-04:** Restore is **hard-blocked** if validation fails (missing expected tables, incompatible schema/columns, FK issues). No best-effort restore.
- **D-05:** Snapshot is validated **before** any live mutation (schema + required tables + foreign-key integrity checks).
- **D-06:** Table copy must be by **explicit compatible columns only**; incompatible snapshots are rejected. No `SELECT *` restore path.

### Pre-restore recovery snapshot (BKP-03)

- **D-07:** Every manual restore creates a **pre-restore recovery** snapshot uploaded to S3 under a new key (e.g. `recoveries/<timestamp>-<id>.sqlite`).
- **D-08:** The restore response returns a **short recovery ID plus the S3 key/path** needed to retrieve it.
- **D-09:** Hermes enforces a simple retention rule: **keep only the last N recoveries** (N to be chosen during planning/implementation).

### Failure semantics + rollback

- **D-10:** Restore is **all-or-nothing**: if any copy step fails, abort and keep live DB unchanged.
- **D-11:** On restore failure, return **structured safe diagnostics** to the admin UI (table/column names, FK failures, migration/version signals) rather than raw exception dumps.
- **D-12:** There is **no “force restore”** mode. If validation fails, restore remains blocked.

### Audit entries + redaction (BKP-05)

- **D-13:** Always audit:
  - backup attempts (success + failure)
  - restore attempts (started/validated/completed/failed)
  - recovery snapshot creation (recovery ID + key/path)
  - storage config checks (S3 enabled/disabled, credential source present/missing — never the secret values)
- **D-14:** Never include in audit metadata or API responses:
  - any secrets/credentials (access keys, secret keys, tokens)
  - raw AWS SDK request/response headers
  - full stack traces

### Operator docs (BKP-06)

- **D-15:** Update both `readme.md` and `building.md` with a short runbook that covers:
  - single-writer snapshot model warning
  - how to verify backups in the Admin UI
  - restore safety model (validation-first, pre-restore recovery)
  - failed-restore recovery steps using the recovery ID/key
  - S3 configuration checklist (env vars and creds file)

### Claude's Discretion

- Exact schema-validation rules (within D-04..D-06), as long as they remain fail-safe and operator-readable.
- The exact “last N recoveries” value and cleanup implementation approach.
- The exact structured diagnostics shape for restore failures, as long as it is safe (D-11, D-14) and actionable for operators.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 3 goal, success criteria, and plan breakdown.
- `.planning/REQUIREMENTS.md` — BKP-01..BKP-06 acceptance criteria.
- `.planning/PROJECT.md` — Single-instance constraints and operational assumptions.

### Current implementation touchpoints
- `src/server/storage/s3-storage.ts` — snapshot upload, restore from S3, admin restore implementation (current baseline).
- `src/server/http/admin-routes.ts` — `/api/admin/backup` and `/api/admin/restore` endpoints.
- `src/server/app.ts` — snapshot scheduling after mutating requests and restore-on-start wiring.
- `src/server/audit-log.ts` — audit writer/list behavior and metadata handling.
- `src/server/db/schema.ts` and `src/server/db/migrations/` — schema/migration sources used for compatibility validation.
- `src/main.tsx` — Admin UI surface that will show backup status and restore diagnostics.

### Operator docs
- `readme.md`
- `building.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/storage/s3-storage.ts`: `persistDatabaseSnapshot()`, `restoreDatabaseSnapshotIntoLive()`, `restoreDatabaseFromStorageIfNeeded()`, `scheduleDatabaseSnapshot()` are the extension points for status tracking, validation, and recovery snapshots.
- `src/server/http/admin-routes.ts`: existing admin-only endpoints already call snapshot/restore helpers and audit; this is the natural place to return structured diagnostics to the UI.

### Established Patterns
- Error handling uses stable German error codes (e.g. `backup_fehlgeschlagen`, `restore_fehlgeschlagen`) and logs server-side via `console.error("[Hermes] ...", error)`.
- Audit logging is best-effort and should not block primary actions (Phase 1 decision D-27).

### Integration Points
- Backup/restore status needs to be displayed in the Admin UI and likely stored in SQLite (to survive restarts) or otherwise persisted.
- Restore validation needs access to schema/migration expectations and must run before any destructive writes.

</code_context>

<specifics>
## Specific Ideas

- Keep operator experience simple: clear status panel + deterministic restore validation errors + recovery ID for rollback.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-backup-and-restore-safety*
*Context gathered: 2026-04-16*


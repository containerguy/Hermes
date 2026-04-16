# Phase 3: Backup And Restore Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 03-backup-and-restore-safety
**Areas discussed:** Backup status visibility, Restore validation, Pre-restore recovery, Failure semantics, Audit & redaction, Operator docs

---

## Backup status visibility (BKP-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Admin UI only | Backup/restore section shows status + buttons | ✓ |
| Admin UI + API | Admin UI + dedicated API endpoint returning status JSON |  |
| Audit-only | Only via audit log entries (no dedicated status display) |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Timestamps only | last success + last failure + failure code |  |
| Timestamps + details | also bucket/key/endpoint (non-secret) + last error summary | ✓ |
| Success only | only last successful backup time |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Show error + keep status | Show error message + keep last-known status; operator can retry | ✓ |
| Silent + audit | Fail silently; rely on audit logs |  |
| Runbook error | Show an explicit runbook-style error with next steps |  |

---

## Restore validation (BKP-02, BKP-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-block | Reject incompatible snapshot; do not mutate live DB | ✓ |
| Best-effort | Restore what can be restored; skip incompatible tables |  |
| Hard-block + override | Default reject, but allow explicit “force” |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Validate then restore | Validate schema/tables/FK first, only then mutate | ✓ |
| Restore then check | Restore then run FK check and report |  |
| Skip FK | No FK validation |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit columns | Copy by explicit compatible columns; reject if required columns missing | ✓ |
| `SELECT *` | Keep current `SELECT *` behavior |  |
| Permissive | Fill missing columns with NULL/defaults when possible |  |

---

## Pre-restore recovery (BKP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| S3 new key | Upload to S3 under `recoveries/<timestamp>-<id>.sqlite` | ✓ |
| Local file | Store locally (e.g. `/data/recovery-...sqlite`) and report path |  |
| Both | Local + S3 |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Short ID + path | Return recovery ID + S3 key/path | ✓ |
| Full URI | Return full `s3://bucket/key` |  |
| Opaque only | Return opaque ID only |  |

| Option | Description | Selected |
|--------|-------------|----------|
| No retention | Operator manages retention |  |
| Time-based | Auto-delete older than N days |  |
| Count-based | Keep only last N recoveries | ✓ |

---

## Failure semantics + rollback

| Option | Description | Selected |
|--------|-------------|----------|
| All-or-nothing | Abort on any failure; keep live DB unchanged | ✓ |
| Per-table | Copy what we can; report failures |  |
| Best-effort + recovery | Copy best-effort, rely on pre-restore recovery for rollback |  |

| Option | Description | Selected |
|--------|-------------|----------|
| Recovery ID on failure | Return error + recovery ID/path |  |
| Generic error | `restore_fehlgeschlagen` only |  |
| Verbose details | Include detailed validation/copy errors in response | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| No force | No force restore option | ✓ |
| Admin force | Force restore with extra confirmation + audit |  |
| CLI-only force | No UI force; only via manual CLI steps |  |

---

## Audit + redaction (BKP-05)

**Audit entries selected:**
- Backup attempts (success + failure) ✓
- Restore attempts (started/validated/completed/failed) ✓
- Validation summary in metadata (non-secret) ✓
- Recovery created (recovery ID + key/path) ✓
- Storage config checks (enabled/disabled, credential source present/missing) ✓

**Redaction policy selected (must never include):**
- Any secrets/credentials ✓
- Raw AWS SDK request/response headers ✓
- Full stack traces ✓

**Verbose failure detail shape selected:**
- Structured safe diagnostics (table/column names, FK issues, migrations) ✓

---

## Operator docs (BKP-06)

**Docs must cover:**
- Single-writer model warning ✓
- Backup verification (Admin UI) ✓
- Restore safety model ✓
- Failed-restore recovery steps using recovery ID/key ✓
- S3 configuration checklist ✓

| Option | Description | Selected |
|--------|-------------|----------|
| Short runbook | Step-by-step, copy/paste commands + UI steps | ✓ |
| High-level | High-level only |  |
| Detailed | Full operator guide (logs, edge cases) |  |

| Option | Description | Selected |
|--------|-------------|----------|
| building.md | Update `building.md` |  |
| readme.md | Update `readme.md` |  |
| both | Update both `readme.md` and `building.md` | ✓ |

---

## Claude's Discretion

- Exact validation implementation details, as long as it remains fail-safe and actionable.
- Exact “keep last N recoveries” value and cleanup mechanism.
- Exact structured diagnostics schema (must remain safe and redacted).

## Deferred Ideas

None.


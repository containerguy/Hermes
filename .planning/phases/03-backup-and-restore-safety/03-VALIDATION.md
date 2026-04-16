# Phase 3 Validation: Backup And Restore Safety

**Phase:** 03-backup-and-restore-safety  
**Scope:** BKP-01..BKP-06  
**Goal:** Ensure backup/restore status, validation-first restore safety, recoveries, audit/redaction, UI wiring, and operator docs meet the phase success criteria without leaking secrets.

## Automated Verification Commands

- `npm test -- --run src/server/http/app-flow.test.ts`
- `npm test`
- `npm run build`

## Redaction / Safety Assertions (must remain TRUE)

### Restore diagnostics (BKP-02, BKP-04, BKP-05)

When restore fails with `error: "restore_fehlgeschlagen"` and a `diagnostics` object is present:

- Diagnostics must be **structured and allowlisted** (no raw error dumps).
- Diagnostics must **not** contain any of:
  - stack traces (e.g. `"stack"`, `"Error: "` multi-line trace patterns)
  - request/response headers (e.g. `"authorization"`, `"cookie"`, `"x-amz-"`, `"x-amzn-"`)
  - credential-like substrings (e.g. `"secret"`, `"accessKey"`, `"secretKey"`, `"token"`)
- Diagnostics lists must be **bounded** (FK failures, mismatches, etc. capped to a small number).

### Backup status failure summary (BKP-01)

If a backup attempt fails and a persisted `failure_summary` is displayed:

- Summary is **short** (truncated to a safe max length).
- Summary does **not** include secrets/headers/stack traces (same denylist guidance as above).

### Audit metadata (BKP-05)

Audit entries emitted during backup/restore must:

- Identify actor + outcome, but **never** include secrets/headers/stack traces.
- Never include raw serialized `error` objects; metadata must be built from explicit allowlisted fields only.

## Manual Spot Checks (operator sanity)

- In Admin UI, confirm the backup status panel shows:
  - last success time, last failure time/code/summary
  - non-secret location details
- Trigger a restore failure (e.g. invalid snapshot) and confirm UI shows actionable diagnostics + keeps stable error mapping.
- Confirm docs (`readme.md`, `building.md`) contain:
  - single-writer warning
  - backup verification guidance
  - restore safety model
  - failed-restore recovery steps using `recovery.id` / `recovery.key`


# Phase 06 Plan 06-02: Docs/env/Docker/CI alignment (REL-04/REL-05) — Summary

Aligned operator docs and `.env.example` with the production contract and CI expectations.

## What changed

- **Docs**
  - `readme.md`: uses the CI-matching command `npm audit --omit=dev` and adds an explicit **release checklist** (TLS ownership, secure cookies, SMTP, VAPID, S3 creds, single-writer, backup verification, rollback via recovery key).
  - `building.md`: uses `npm audit --omit=dev` to match CI.

- **Sample env**
  - `.env.example`: clarifies that `HERMES_COOKIE_SECURE` must be `true` behind HTTPS in production, while staying `false` for local dev.

## Verification

- `npm run build`


---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: UX Polish
status: complete
stopped_at: Completed Phase 8 (08-01)
last_updated: "2026-04-16T19:35:00.000Z"
last_activity: 2026-04-16
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 2
  completed_plans: 2
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.
**Current focus:** v1.1 — complete

## Current Position

Phase: 8 — Admin Event Soft Delete
Plan: 08-01
Status: Complete
Last activity: 2026-04-16

Progress: [##########] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 11
- Average duration: n/a
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 7. UX Polish – UI Correctness | 1 | 1 | n/a |
| 8. Admin Event Soft Delete | 1 | 1 | n/a |
| 1. Auth, Profile, And Invite Hardening | 0 | 6 | n/a |
| 2. Event And Invite Consistency | 0 | 3 | n/a |
| 3. Backup And Restore Safety | 0 | 3 | n/a |
| 4. PWA And Realtime Reliability | 0 | 3 | n/a |
| 5. Frontend And Admin UI Modularization | 0 | 4 | n/a |
| 6. Release Verification And Documentation | 0 | 3 | n/a |
| 01 | 8 | - | - |
| 2 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: none
- Trend: n/a

*Updated after each plan completion*
| Phase 01 P01-02 | 10m | 3 tasks | 5 files |
| Phase 01 P01-07 | 5m | 2 tasks | 6 files |
| Phase 01 P01-04 | 6m | 4 tasks | 4 files |
| Phase 01 P01-03 | 40m | 4 tasks | 7 files |
| Phase 01 P01-05 | 311s | 3 tasks | 2 files |
| Phase 01-auth-profile-and-invite-hardening P01-08 | 25min | 1 tasks | 2 files |
| Phase 01 P01-06 | 170s | 3 tasks | 5 files |
| Phase 02 P01 | 3m | 2 tasks | 2 files |
| Phase 02 P02 | 4m | 2 tasks | 2 files |
| Phase 02 P03 | 6m | 3 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Keep Hermes as a single Dockerized React/Vite, Express, SQLite app.
- Use Wasabi/S3 only as snapshot backup/restore storage, not as multi-writer storage.
- Keep TLS/reverse proxy outside Hermes while documenting secure-context requirements for push.
- Prioritize hardening, consistency, restore safety, PWA reliability, frontend modularity, and release readiness before feature expansion.
- [Phase 01]: Persistierte Rate-Limits (Entries + Allowlist) sind per Admin-API list-/löschbar.
- [Phase 01]: Login-Code-Requests antworten generisch (202 ok) für syntaktisch valide Usernames (kein Enumeration-Leak).
- [Phase 01]: Audit-Logging ist best-effort und blockiert keine primären Aktionen (D-27).
- [Phase 01]: CSRF tokens via GET /api/auth/csrf and x-hermes-csrf header (HMAC-SHA256 over non-secret session id).
- [Phase 01]: Legacy sessions without tokenHash are invalid and require re-login to avoid persisted replayable tokens.
- [Phase 01-auth-profile-and-invite-hardening]: 01-08: AdminPanel zeigt aktive Rate-Limit-Sperren (nur blockierte Einträge) und erlaubt Clear + LAN-Allowlist Pflege.
- [Phase 01]: Invite maxUses atomic concurrency (INV-03) remains deferred to Phase 2; Phase 1 must not claim it.
- [Phase 02]: 02-02: Return 409 { error: "event_voll", event } for capacity losers while keeping stable error code (D-09).

### Pending Todos

- 2026-04-16 — Bulk import of users (`.planning/todos/pending/2026-04-16-bulk-import-of-users.md`)
- 2026-04-16 — Recognize device on re-login (`.planning/todos/pending/2026-04-16-recognize-device-on-re-login.md`)
- 2026-04-16 — Add device via session QR/link (`.planning/todos/pending/2026-04-16-add-device-via-session-qr-link.md`)
- 2026-04-16 — Update GitHub Actions for Node 24 (`.planning/todos/pending/2026-04-16-update-github-actions-for-node-24.md`)
- 2026-04-16 — Gaming themes and modern copy (`.planning/todos/pending/2026-04-16-gaming-themes-and-modern-copy.md`)

### Blockers/Concerns

- Playwright browser execution was previously blocked in this environment by missing host library `libnspr4.so`.
- Web Push on smartphones still depends on HTTPS/PWA/browser/OS support outside Hermes.
- SQLite plus S3 snapshot storage assumes exactly one active writer instance.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| none | none | n/a | n/a |

## Session Continuity

Last session: 2026-04-16T13:24:33.919Z
Stopped at: Phase 03 context gathered
Resume file: .planning/phases/03-backup-and-restore-safety/03-CONTEXT.md

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.
**Current focus:** Phase 1 - Auth, Profile, And Invite Hardening

## Current Position

Phase: 1 of 6 (Auth, Profile, And Invite Hardening)
Plan: 0 of 4 in current phase
Status: Ready to plan
Last activity: 2026-04-15 - Roadmap created from v1 requirements and research.

Progress: [----------] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: n/a
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Auth, Profile, And Invite Hardening | 0 | 4 | n/a |
| 2. Event And Invite Consistency | 0 | 3 | n/a |
| 3. Backup And Restore Safety | 0 | 3 | n/a |
| 4. PWA And Realtime Reliability | 0 | 3 | n/a |
| 5. Frontend And Admin UI Modularization | 0 | 4 | n/a |
| 6. Release Verification And Documentation | 0 | 3 | n/a |

**Recent Trend:**
- Last 5 plans: none
- Trend: n/a

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Keep Hermes as a single Dockerized React/Vite, Express, SQLite app.
- Use Wasabi/S3 only as snapshot backup/restore storage, not as multi-writer storage.
- Keep TLS/reverse proxy outside Hermes while documenting secure-context requirements for push.
- Prioritize hardening, consistency, restore safety, PWA reliability, frontend modularity, and release readiness before feature expansion.

### Pending Todos

None yet.

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

Last session: 2026-04-15 23:52 CEST
Stopped at: Roadmap created; next step is planning Phase 1.
Resume file: None

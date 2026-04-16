---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Post-LAN Quality of Life
status: ready_to_execute
stopped_at: All 5 v1.2 phases planned and verified; ready to execute Phase 9
last_updated: "2026-04-16T21:30:00.000Z"
last_activity: 2026-04-16
progress:
  total_phases: 5
  completed_phases: 0
  total_plans: 14
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.
**Current focus:** v1.2 — Post-LAN Quality of Life (all phases planned; ready to execute)

## Current Position

Phase: 9 — Device Recognition and Session-Bound Pairing (next to execute)
Plan: 09-01-schema-and-device-model-PLAN.md (wave 1)
Status: 5 phases planned (9: 4 plans, 10: 5 plans, 11: 2 plans, 12: 2 plans, 13: 1 plan = 14 total); all plan-checker verdicts PASS or PASS-WITH-WARNINGS (warnings inlined)
Last activity: 2026-04-16

Progress: [..........] 0% (0 of 14 plans executed)

### Plan Roster (v1.2)

| Phase | Plans | Key Migration | Checker Verdict |
|-------|-------|---------------|-----------------|
| 9 — Device Recognition & Pairing | 4 | `0010_device_pairing.sql` | PASS-WITH-WARNINGS (fixed) |
| 10 — Theme System & Copy Refresh | 5 | `0011_theme_background_settings.sql` | PASS-WITH-WARNINGS (fixed) |
| 11 — Bulk User Import | 2 | — | PASS-WITH-WARNINGS (fixed) |
| 12 — Audio & Haptic Notifications | 2 | `0012_audio_haptic_prefs.sql` | PASS-WITH-WARNINGS (fixed) |
| 13 — CI Node 24 Readiness | 1 | — | PASS |

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

(none — all 6 prior todos were promoted to v1.2 phases 9–13 on 2026-04-16)

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

Last session: 2026-04-16T21:30:00.000Z
Stopped at: v1.2 planning complete — 14 plans across 5 phases, all verified; ready to execute
Resume file: .planning/phases/09-device-recognition-and-pairing/09-01-schema-and-device-model-PLAN.md

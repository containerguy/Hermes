---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Post-LAN Quality of Life
status: verifying
stopped_at: Completed 09-04-client-pairing-ux-PLAN.md
last_updated: "2026-04-16T20:54:42.632Z"
last_activity: 2026-04-16
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 14
  completed_plans: 4
  percent: 29
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-15)

**Core value:** During the LAN party, everyone can quickly see which game round is viable, when it starts, who is in, and how to join it.
**Current focus:** Phase 09 — device-recognition-and-pairing

## Current Position

Phase: 09 (device-recognition-and-pairing) — EXECUTING
Plan: 4 of 4
Status: Phase complete — ready for verification
Last activity: 2026-04-16

Progress: [==........] 21% (3 of 14 plans executed)

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
| Phase 09 P01 | 6min | 4 tasks | 6 files |
| Phase 09 P02 | 3min | 2 tasks | 2 files |
| Phase 09 P03 | 8min | 3 tasks | 3 files |
| Phase 09-device-recognition-and-pairing P04 | 15min | 4 tasks | 8 files |

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
- [Phase 09]: 09-01: device_key_hash lives on sessions (no separate device_keys table); pair_token_create RL = 10min/5 attempts/15min block.
- [Phase 09]: 09-01: HMAC-SHA256 with HERMES_DEVICE_KEY_SECRET and HERMES_PAIR_TOKEN_SECRET env vars for all secret-adjacent hashes at rest; plain SHA-256 reserved for RL key redaction + session tokens.
- [Phase 09]: 09-02: Recognition is deviceKey-first; signals fallback only reuses when exactly 1 non-revoked, non-key-bound candidate matches — ambiguity inserts a new row (T-09-10).
- [Phase 09]: 09-02: auth.login_recognized vs auth.login distinguishes returning-device re-login; audit metadata never carries raw deviceKey (T-09-08).
- [Phase 09]: 09-03: /api/auth/pair-token is CSRF-gated + auth-required + rate-limited (pair_token_create, per-session AND per-user); /api/auth/pair-redeem is public + CSRF-exempt + single-use atomic; redeeming never revokes the origin session (D-10).
- [Phase 09]: 09-03: Four stable pairing error codes (pair_token_invalid/expired/consumed/pair_origin_revoked) mapped with German messages in src/client/errors/errors.ts; T-09-15 (no per-IP RL on /pair-redeem) still open but mitigated by 256-bit entropy + 10-min TTL + single-use + device_pair_failed audit.
- [Phase 09-device-recognition-and-pairing]: 09-04: qrcode-generator@1.4.4 adopted per D-15 (MIT, zero deps, ships .d.ts); 4 pair_* errorMessages realigned to plan copy so Task 4 test can assert 'Pairing-Code ist abgelaufen'.
- [Phase 09-device-recognition-and-pairing]: 09-04: getPageFromHash widened to match hash-path (everything before '?') so #login?pair=<token> mounts LoginPanel and the redemption useEffect fires — Rule 3 blocking fix, minimal hunk in main.tsx that preserves pre-existing dirty manager-routing edits.

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

Last session: 2026-04-16T20:54:42.621Z
Stopped at: Completed 09-04-client-pairing-ux-PLAN.md
Resume file: None

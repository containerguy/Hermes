---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Post-LAN Quality of Life
status: paused-after-phase-9
stopped_at: Completed 09-04-client-pairing-ux-PLAN.md; pizza ordering shipped out-of-band
last_updated: "2026-10-16"
last_activity: 2026-10-16
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

Phase: 09 (device-recognition-and-pairing) — COMPLETE
Plan: 4 of 4
Status: Phase complete; v1.2 paused after Phase 9. Pizza ordering shipped out-of-band (see phases/14-pizza-ordering/).
Last activity: 2026-10-16 (Phase 15-04 AMP-Automatik, Draft-PR; davor Pizza-Refactor 2026-05-16)

Progress: [===.......] 29% (4 of 14 plans executed)

### Plan Roster (v1.2)

| Phase | Plans | Key Migration | Status |
|-------|-------|---------------|--------|
| 9 — Device Recognition & Pairing | 4 | `0010_device_pairing.sql` | COMPLETE (all 4 SUMMARY files present) |
| 10 — Theme System & Copy Refresh | 5 | `0011_theme_background_settings.sql` (planned) | Not started — PLAN files only |
| 11 — Bulk User Import | 2 | — | Not started — PLAN files only |
| 12 — Audio & Haptic Notifications | 2 | `0012_audio_haptic_prefs.sql` (planned) | Not started — PLAN files only |
| 13 — CI Node 24 Readiness | 1 | — | Not started — PLAN file only |
| 15 — AMP-Gameserver-Modul | 4 | `0020_game_server_bindings.sql` | Code complete — 15-01…15-04 (2026-10-16), Branch `feature/amp-integration`, Draft-PR; Abnahme gegen echte AMP-Server ausstehend (siehe 15-04-SUMMARY „Offen") |

### Out-of-band work shipped after Phase 9

Pizza ordering system landed in `main` between 2026-05-01 and 2026-05-16 without a v1.2 phase track. See `phases/14-pizza-ordering/` for retrospective documentation. Migrations `0016`-`0018` were assigned by the pizza work, not the planned v1.2 migrations listed above; renumber the planned migrations when those phases execute.

## Performance Metrics

**Velocity:**

- v1.0 + v1.1 plans completed: 27 (phases 1-8)
- v1.2 plans completed: 4 of 14 (phase 9 only)
- Out-of-band work: pizza ordering system, 4 commits between 2026-05-01 and 2026-05-16

**Per-plan execution log** (durations are approximate; tooling no longer tracks):

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01-02 | 10m | 3 | 5 |
| Phase 01 P01-03 | 40m | 4 | 7 |
| Phase 01 P01-04 | 6m | 4 | 4 |
| Phase 01 P01-05 | 5m | 3 | 2 |
| Phase 01 P01-06 | 3m | 3 | 5 |
| Phase 01 P01-07 | 5m | 2 | 6 |
| Phase 01 P01-08 | 25m | 1 | 2 |
| Phase 02 P01 | 3m | 2 | 2 |
| Phase 02 P02 | 4m | 2 | 2 |
| Phase 02 P03 | 6m | 3 | 4 |
| Phase 09 P01 | 6m | 4 | 6 |
| Phase 09 P02 | 3m | 2 | 2 |
| Phase 09 P03 | 8m | 3 | 3 |
| Phase 09 P04 | 15m | 4 | 8 |

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

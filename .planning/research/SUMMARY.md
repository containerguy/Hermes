# Research Summary

## Executive Recommendation

Keep Hermes on the current single-instance stack: React/Vite frontend, Express API, SQLite with Drizzle migrations, Web Push, Docker packaging, and Wasabi/S3-compatible snapshot storage. The next milestone should not replace core technology. It should make the existing LAN-party workflow safer and more reliable under real use.

The release-critical work is hardening, not feature expansion: reduce auth and invite abuse, make event capacity and invite limits transactionally correct, make backup/restore safe enough for operators, improve PWA notification expectations, split the frontend monolith, and document production deployment assumptions clearly.

## Top Priorities

1. Harden auth and invite registration with rate limits, generic login-code responses, challenge cleanup, safer invite handling, and tests for negative paths.
2. Prevent data-loss in backup/restore with pre-restore backup, schema/table validation, real foreign-key check failure handling, explicit restore column mapping, and operator recovery output.
3. Enforce data consistency for concurrent invite use and event participation so `maxUses` and `maxPlayers` cannot be oversubscribed.
4. Improve mobile/PWA notification reliability by surfacing secure-context/browser limitations in the UI and making the service worker defensive against malformed payloads.
5. Extract `src/main.tsx` into focused frontend modules before adding more admin, profile, or notification UI.
6. Expand focused verification coverage around auth abuse controls, invite limits, concurrent joins, restore, session/device revocation, push payload handling, and admin destructive actions.

## Key Risks

- Auth endpoints can leak user existence or be abused if OTP request/verification and public invite registration are not throttled.
- Session tokens stored in snapshots are sensitive; raw tokens at rest and weak production cookie settings raise operational risk.
- Invite `maxUses` and event `maxPlayers` can be violated if checks remain read-then-write instead of transaction-backed.
- S3 snapshots can create false confidence: upload failures, stale snapshots, unsafe restore mechanics, and multiple active writers can lose or overwrite data.
- Restore currently needs stricter validation because column-order assumptions, disabled foreign keys, and incomplete failure checks can corrupt live state.
- Browser push behavior depends on HTTPS, browser support, OS settings, and PWA installation state; custom sounds cannot be promised reliably.
- The frontend is too concentrated in `src/main.tsx`, increasing regression risk for future admin and profile work.
- Local-friendly deployment defaults can be unsafe in production unless the docs and sample env make TLS, secure cookies, SMTP, VAPID, S3 credentials, and single-instance operation explicit.

## Architecture And Stack Decisions

- Keep SQLite as the source of truth for a single active Hermes instance. Do not introduce Postgres, Redis, queues, or multi-instance realtime for the next milestone.
- Keep S3 as snapshot backup/restore storage only. It must not become a distributed database, lock service, or active/active coordination layer.
- Keep SSE for realtime updates and Web Push for notifications. Add resilience and clearer operator guidance instead of replacing them with WebSockets or native apps.
- Keep Express route modules as server feature boundaries. Add narrow helpers for rate limiting, invite consumption, restore validation, and audit redaction when route logic becomes hard to test.
- Keep manual SQL migrations aligned with Drizzle schema. Add validation and tests rather than introducing broad migration tooling.
- Split the frontend by existing conceptual panels: API helpers/types, app shell/routing, event board, auth/profile, push setup, and admin panels.
- Treat backend authorization, transactions, restore validation, and audit redaction as the real safety boundaries. UI role checks and confirmations are useful but not sufficient.

## Suggested Roadmap Themes

1. Security hardening: auth throttling, invite throttling, generic responses, session-token hashing, cookie/CSRF decisions, and redacted audit metadata.
2. Data consistency: transaction-backed invite consumption and participation capacity enforcement with concurrent API tests.
3. Backup and restore safety: validation, pre-restore backup, operator recovery path, backup status visibility, and restore tests.
4. PWA and realtime reliability: service worker hardening, failed-subscription cleanup, SSE heartbeat/reconnect behavior, and in-product secure-context guidance.
5. Frontend maintainability: behavior-preserving extraction from `src/main.tsx` and shared client API/error handling.
6. Operational readiness: Docker non-root runtime, production checklist, env/docs updates, single-writer S3 warnings, and release validation commands.

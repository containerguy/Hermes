# Features Research

## Scope

Hermes already has the core LAN-party loop: login, event creation, participation, role management, invite registration, audit log, Web Push, realtime updates, Docker packaging, and SQLite/S3 snapshot storage. The next milestone should therefore focus on features that protect that loop under real LAN-party pressure rather than adding broad new product surface.

Primary source docs:

- `.planning/PROJECT.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`
- `ideas.md`
- `readme.md`

## Table Stakes For The Next Milestone

| Feature area | Next-milestone value | Dependencies | Complexity notes |
| --- | --- | --- | --- |
| Auth abuse hardening | Keep username + email OTP usable without making user enumeration, brute force, or challenge spam easy. | `src/server/http/auth-routes.ts`, `src/server/auth/otp.ts`, `src/server/auth/sessions.ts`, `src/server/db/schema.ts`, `src/server/db/migrations/` | Medium. Needs rate-limit state, less revealing responses, cleanup/indexing for challenges, tests for unknown users and repeated attempts. Keep UX simple for a 25-person LAN. |
| Invite abuse hardening | Public registration should be safe enough to enable before an event without leaking or oversubscribing invite capacity. | `src/server/http/auth-routes.ts`, `src/server/http/admin-routes.ts`, `src/server/db/schema.ts`, `src/server/db/migrations/0004_invites_and_deleted_users.sql` | Medium. Limited-use invite consumption needs transactional behavior. Admin views and audit metadata should avoid treating invite codes like ordinary display text. |
| Participation consistency | Event capacity must not overfill when multiple users join at once. This is core to deciding whether a game round is viable. | `src/server/http/event-routes.ts`, `src/server/domain/events.ts`, `src/server/db/schema.ts` | Medium. Needs transaction-level protection or constraint-backed logic around joined counts. Tests should simulate concurrent joins or direct parallel API calls. |
| Safer restore flow | Admin restore is destructive and currently relies on a simple confirmation. Operators need a recovery path if restore goes wrong. | `src/server/storage/s3-storage.ts`, `src/server/http/admin-routes.ts`, `src/main.tsx`, `readme.md` | High. Requires pre-restore backup, validation that actually checks `PRAGMA foreign_key_check` rows, clearer UI, and possibly session behavior after restore. Avoid expanding into full backup version management unless required. |
| Backup status visibility | S3 snapshot failures should be visible enough for admins to know whether recent LAN data is protected. | `src/server/storage/s3-storage.ts`, `src/server/http/admin-routes.ts`, `src/main.tsx`, `src/server/audit-log.ts` | Medium. Can start with last backup attempt/success metadata and admin display. More complex queueing or retry policy can wait. |
| Push/PWA reliability guidance | Users need clear in-product explanations when mobile push cannot work because the app is not in a secure context or browser support is missing. | `src/main.tsx`, `public/sw.js`, `src/server/http/push-routes.ts`, `src/server/push/push-service.ts`, `readme.md` | Low to medium. Much of the technical support exists; value is in precise states, defensive service worker parsing, bad-subscription cleanup, and documentation. Custom notification sounds remain an anti-feature. |
| Admin destructive-action guardrails | Restore, user deletion, invite revocation, and event cancellation should be hard to trigger accidentally and easy to audit. | `src/main.tsx`, `src/server/http/admin-routes.ts`, `src/server/http/event-routes.ts`, `src/server/audit-log.ts` | Medium. Typed confirmation, clearer summaries, and resilient audit writes give most value. Full approval workflows are not needed for the LAN-party scale. |
| Deployment checklist | A self-hosted app still needs explicit production checks for TLS/proxy, secure cookies, SMTP, VAPID, S3 snapshot mode, and single-instance operation. | `readme.md`, `building.md`, `.env.example`, `docker-compose.yml`, `Dockerfile` | Low. Documentation-heavy, but important because Web Push and cookies depend on operator choices outside Hermes. Do not document secret values. |
| Frontend modularization before new UI growth | `src/main.tsx` is large enough that more admin or event UI risks regressions. | `src/main.tsx`, `src/styles.css` | Medium. Extracting API helpers, event board, login/profile, manager, and admin panels can reduce change risk. Avoid a full state-management rewrite unless stale-data bugs force it. |
| Focused verification coverage | Hardening features need tests because the risky paths are abuse, concurrency, restore, and destructive operations rather than happy-path event use. | `src/server/http/app-flow.test.ts`, `src/server/storage/s3-storage.test.ts`, `e2e/hermes-flow.spec.ts` | Medium to high. Vitest/API coverage is highest value now. Playwright remains useful but is blocked in the current environment by missing OS libraries. |

## Differentiators Worth Preserving Or Strengthening

| Differentiator | Why it matters for Hermes | Next-milestone treatment | Complexity notes |
| --- | --- | --- | --- |
| Single self-hosted Docker app | Fits a temporary LAN-party deployment and avoids SaaS or external DB operations. | Preserve. Harden deployment docs and container defaults where practical. | Low to medium. A non-root runtime image is useful but must be tested against `/data` volume permissions. |
| LAN-first event loop | The app is intentionally about "who is in, when does it start, how do I connect" rather than general scheduling. | Preserve. Prioritize event capacity correctness and clear active-event display over new planning features. | Medium only where concurrency touches database writes. |
| Email OTP without phone/SMS | Keeps operation free and avoids collecting phone numbers. | Preserve. Harden OTP challenge behavior and SMTP diagnostics. | Medium. Rate limits must not lock out the small group during setup. |
| Per-device sessions and push subscriptions | Users may use both smartphone and PC during a LAN party. | Strengthen. Improve session revocation tests and push failure handling. | Medium. Existing tables and UI are present; reliability work is incremental. |
| Admin-operable backup/restore | Operators can protect data without shell access. | Strengthen significantly. Add pre-restore backup, validation, clearer recovery flow, and visible backup status. | High. This is both a feature and a data-loss risk. |
| Runtime theming and simple admin controls | Useful for event identity without rebuilding. | Preserve, but do not expand heavily next milestone. | Low. Theme validation already exists; more design options would add UI weight with limited release value. |
| Audit trail for small-event operations | Helps diagnose who changed settings, events, invites, participation, backup, or restore. | Strengthen reliability and redaction. | Medium. Audit writes should not become a hidden availability risk, and metadata should not expose reusable secrets. |

## Anti-Features

These should stay out of the next milestone unless the project scope changes.

| Anti-feature | Reason to avoid | Dependencies/impact if reversed |
| --- | --- | --- |
| Native mobile apps | The release goal is a responsive WebApp/PWA. Native apps would add build, signing, distribution, and support complexity. | Would create separate clients beyond `src/main.tsx`, `public/manifest.webmanifest`, and `public/sw.js`. |
| Built-in TLS, reverse proxy, DNS, or certificate management | Explicitly out of scope. Operators should provide TLS/proxy infrastructure, especially for mobile Web Push. | Would expand deployment ownership beyond `Dockerfile`, `docker-compose.yml`, and app config. |
| Multi-instance active/active operation | SQLite plus S3 snapshot storage is a single-writer model. Multi-instance support would require a different persistence and realtime design. | Would affect `src/server/db/client.ts`, `src/server/storage/s3-storage.ts`, `src/server/realtime/event-bus.ts`, and deployment docs. |
| Waitlists for full events | Product decision is binary participation: `dabei` or `nicht dabei`. Waitlists complicate capacity, notification, and UX rules. | Would alter `src/server/domain/events.ts`, `src/server/http/event-routes.ts`, participation schema, and event cards. |
| Paid SMS login | Email OTP is the chosen free login path. SMS adds provider cost, phone-number handling, delivery failures, and privacy concerns. | Would add a provider integration beside `src/server/mail/mailer.ts` and expand user data requirements. |
| Public SaaS or multi-tenant mode | Hermes is for one self-hosted LAN-party instance, not external customers. | Would require tenant isolation, billing/support concerns, stronger abuse controls, and different operational assumptions. |
| Custom mobile notification sounds as a promise | Browser/OS behavior cannot reliably guarantee custom sounds for Web Push on iOS/Android. | Would create misleading UX in `public/sw.js` and support burden in `readme.md`. |
| Full calendar/social platform features | Chat, forums, broad scheduling, friend systems, and tournament brackets distract from the immediate LAN coordination loop. | Would expand frontend and domain surface while `src/main.tsx` already needs decomposition. |
| General-purpose backup version browser | Useful in theory, but a full version manager is more than the next milestone needs. | Prefer pre-restore backup, validation, status, and recovery docs around `src/server/storage/s3-storage.ts` first. |

## Recommended Feature Priorities

1. Auth and invite hardening: rate limits, less enumerating responses, invite-use atomicity, and reduced invite-code exposure.
2. Data-loss prevention: pre-restore backup, restore validation, restore UI guardrails, and backup status visibility.
3. Event consistency: transactional capacity enforcement for participation and tests around concurrent joins.
4. Push/PWA reliability: clearer secure-context/browser-state guidance, safer service worker payload handling, and cleanup of persistently failing subscriptions.
5. Frontend risk reduction: extract modules from `src/main.tsx` before adding more admin or event UI.
6. Operator readiness: production checklist covering TLS/proxy expectations, secure cookies, SMTP mode, VAPID keys, S3 snapshot semantics, and single-instance deployment.

## Dependency Notes

- Security and consistency changes should start in API routes, not in the UI, because `src/main.tsx` role visibility is not a security boundary.
- Any schema or migration change must keep `src/server/db/schema.ts` and `src/server/db/migrations/` aligned manually.
- Restore changes must account for the fixed table list in `src/server/storage/s3-storage.ts`; new persisted tables can otherwise be skipped silently.
- Push work depends on deployment reality: normal HTTP LAN IPs are not secure contexts, so in-product messaging and docs are part of the feature.
- Test expansion should favor Vitest/API tests first because the current Playwright environment cannot launch Chromium without missing host libraries.

## Next-Milestone Non-Goals

- Do not redesign the core participation model.
- Do not introduce Postgres or external pub/sub solely for theoretical scale.
- Do not add broad social, chat, tournament, or calendar features.
- Do not store or document credential values in planning files.
- Do not turn S3 snapshots into a distributed database abstraction.

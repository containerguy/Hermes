# Roadmap: Hermes

## Overview

Hermes already has the core LAN-party workflow in place. This milestone turns the existing brownfield app into a safer release candidate: harden auth and invite registration, make capacity-limited writes correct under concurrency, make S3 restore operator-safe, improve PWA/realtime reliability, reduce frontend regression risk, and finish with focused tests and deployment documentation.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions if needed

- [ ] **Phase 1: Auth, Profile, And Invite Hardening** - Reduce login/invite abuse risk, protect credential-like data, and define account/session safety.
- [ ] **Phase 2: Event And Invite Consistency** - Make limited invite usage and event participation capacity transactionally correct.
- [ ] **Phase 3: Backup And Restore Safety** - Make S3 snapshot restore validated, recoverable, audited, and visible to operators.
- [ ] **Phase 4: PWA And Realtime Reliability** - Improve notification guidance, push failure handling, and SSE resilience.
- [ ] **Phase 5: Frontend And Admin UI Modularization** - Split the client monolith and tighten responsive/admin UX without behavior drift.
- [ ] **Phase 6: Release Verification And Documentation** - Add release-critical tests and align docs, env, Docker, and CI with the production contract.

## Phase Details

### Phase 1: Auth, Profile, And Invite Hardening
**Goal**: Auth, profile, and invite flows are safe enough to expose before the LAN party without leaking account existence, storing raw reusable credentials, or leaving account/session edge cases undefined.
**Depends on**: Nothing (first phase)
**Requirements**: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, PROF-01, PROF-02, PROF-03, INV-01, INV-02, INV-04, INV-05, INV-06, INV-07]
**Canonical refs**: `src/server/http/auth-routes.ts`, `src/server/http/admin-routes.ts`, `src/server/auth/sessions.ts`, `src/server/auth/otp.ts`, `src/server/db/schema.ts`, `src/server/db/migrations/`, `src/server/audit-log.ts`, `src/main.tsx`
**Success Criteria** (what must be TRUE):
  1. Login-code and invite-registration attempts are throttled while login-code requests return a generic success-shaped response.
  2. Session storage, role/deletion changes, and CSRF posture have implemented or explicitly documented safety behavior.
  3. Active email uniqueness is enforced across admin-created users, invite registration, and profile changes.
  4. Users can manage display name, confirmed email changes, and device names with validation and audit coverage.
  5. Invite administration supports credential-safe display, deactivate/reactivate, edit, and unused-code removal without losing historical audit context.
**Plans**: 8 plans

Plans:
- [x] 01-01: Create Phase 1 schema foundations and migration coverage before dependent code lands.
- [x] 01-02: Harden auth entry points with generic login responses and persisted throttling; add admin rate-limit operations APIs.
- [x] 01-03: Implement profile, confirmed email-change, active-email uniqueness, and device/session backend behavior.
- [x] 01-04: Harden invite registration and admin invite lifecycle with generated-only high-entropy codes and masked audit metadata.
- [x] 01-05: Wire profile, invite lifecycle, and CSRF-aware client requests into the existing UI.
- [x] 01-06: Complete Phase 1 regression coverage, docs/env updates, and final validation.
- [x] 01-07: Split out hashed-token sessions, sensitive session revocation, and CSRF enforcement.
- [x] 01-08: Split out the admin rate-limit operations UI for LAN lockout recovery.

### Phase 2: Event And Invite Consistency
**Goal**: Capacity-sensitive writes cannot oversubscribe invite max uses or event max players, and event/invite side effects remain consistent after success and failure.
**Depends on**: Phase 1
**Requirements**: [INV-03, EVT-01, EVT-02, EVT-03]
**Canonical refs**: `src/server/http/auth-routes.ts`, `src/server/http/event-routes.ts`, `src/server/domain/events.ts`, `src/server/db/schema.ts`, `src/server/realtime/event-bus.ts`, `src/server/push/push-service.ts`, `src/server/audit-log.ts`
**Success Criteria** (what must be TRUE):
  1. Concurrent invite registrations cannot exceed `maxUses`.
  2. Concurrent `dabei` participation writes cannot exceed event `maxPlayers`.
  3. Participation success and failure keep the event board, realtime stream, audit log, and push delivery behavior coherent.
  4. Manual archive/cancel and automatic archive after the configured running window continue to work after transactional changes.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Move invite consumption into an atomic SQLite transaction or constraint-backed write path.
- [ ] 02-02: Move event participation capacity enforcement into an atomic SQLite transaction or constraint-backed write path.
- [ ] 02-03: Verify realtime, push, audit, and lifecycle behavior around successful and rejected participation changes.

### Phase 3: Backup And Restore Safety
**Goal**: Admin backup and restore are operationally safe: snapshot status is visible, restore is validated before mutation, pre-restore recovery is created, and failures leave clear recovery information.
**Depends on**: Phase 2
**Requirements**: [BKP-01, BKP-02, BKP-03, BKP-04, BKP-05, BKP-06]
**Canonical refs**: `src/server/storage/s3-storage.ts`, `src/server/http/admin-routes.ts`, `src/server/app.ts`, `src/server/audit-log.ts`, `src/main.tsx`, `readme.md`, `building.md`
**Success Criteria** (what must be TRUE):
  1. Admins can see last successful backup time and last backup failure state when S3 snapshot storage is enabled.
  2. Restore validates schema, required tables, compatible columns, and foreign-key integrity before live data is replaced.
  3. Restore creates a pre-restore backup and returns its recovery identifier before destructive mutation.
  4. Restore audit entries identify actor and outcome without secrets or misleading partial-success metadata.
  5. Operator docs explain failed-restore recovery and the single-writer S3 snapshot model.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Add backup status tracking and admin visibility for S3 snapshot success/failure state.
- [ ] 03-02: Build restore validation, explicit compatible-column copying, foreign-key failure handling, and pre-restore backup creation.
- [ ] 03-03: Wire restore UI, audit, recovery output, and operator documentation around the safer restore service.

### Phase 4: PWA And Realtime Reliability
**Goal**: Mobile notification expectations are honest in-product, push delivery failures are isolated, and realtime event updates survive common idle/reconnect conditions.
**Depends on**: Phase 3
**Requirements**: [PWA-01, PWA-02, PWA-03, PWA-04]
**Canonical refs**: `public/sw.js`, `public/manifest.webmanifest`, `src/server/http/push-routes.ts`, `src/server/push/push-service.ts`, `src/server/http/realtime-routes.ts`, `src/server/realtime/event-bus.ts`, `src/main.tsx`, `readme.md`
**Success Criteria** (what must be TRUE):
  1. Notification settings explain secure-context, browser, OS, and PWA-installation limits directly in the UI.
  2. The service worker tolerates missing or malformed push payloads.
  3. Invalid or repeatedly failing push subscriptions are cleaned up or marked inactive without breaking other devices.
  4. SSE event updates use resilient heartbeat/reconnect behavior across idle proxy connections.
**Plans**: 3 plans

Plans:
- [ ] 04-01: Add in-product PWA/push limitation messaging and safe client states for unsupported notification contexts.
- [ ] 04-02: Harden service worker push parsing and server-side failed-subscription cleanup.
- [ ] 04-03: Add SSE heartbeat/reconnect resilience and documentation for proxy timeout expectations.

### Phase 5: Frontend And Admin UI Modularization
**Goal**: The React frontend is split into focused modules so future admin/profile/event work can land with lower regression risk while preserving the current modern responsive design.
**Depends on**: Phase 4
**Requirements**: [UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08]
**Canonical refs**: `src/main.tsx`, `src/styles.css`, `src/client/`, `e2e/hermes-flow.spec.ts`
**Success Criteria** (what must be TRUE):
  1. Shared client API helpers, DTO types, and user-facing error mapping live outside `src/main.tsx`.
  2. Event board, event creation, auth/profile/device/push, and admin panels are extracted into focused modules.
  3. Admin has clear dedicated views or submenu structure for users, settings/theme, invites, audit, backup, and restore.
  4. Existing responsive theme behavior remains intact, including narrow smartphone event action buttons and compact header layout.
**Plans**: 4 plans

Plans:
- [ ] 05-01: Extract shared client API helpers, DTO types, and error mapping.
- [ ] 05-02: Extract event board and event creation modules with behavior-preserving state refreshes.
- [ ] 05-03: Extract auth, invite registration, profile, sessions/devices, and push setup modules.
- [ ] 05-04: Extract admin modules and responsive navigation/layout fixes for the admin area and event actions.

### Phase 6: Release Verification And Documentation
**Goal**: Hermes has release-critical automated coverage and operator docs for the Docker/S3/PWA production contract before handoff.
**Depends on**: Phase 5
**Requirements**: [REL-01, REL-02, REL-03, REL-04, REL-05, REL-06]
**Canonical refs**: `src/server/http/*.test.ts`, `src/server/storage/*.test.ts`, `e2e/hermes-flow.spec.ts`, `readme.md`, `building.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/`
**Success Criteria** (what must be TRUE):
  1. API/storage tests cover auth throttling, generic login responses, session revocation, invite limits, concurrent joins, restore validation, pre-restore backup, malformed push payloads, and failed subscription cleanup.
  2. Docs and sample env match the release deployment contract for TLS ownership, secure cookies, SMTP, VAPID, S3 credentials, single active writer, backup verification, and rollback.
  3. Docker files and GitHub Actions match the documented image build and runtime behavior.
  4. `npm test`, `npm run build`, and `npm audit --omit=dev` pass before release handoff or have documented environment blockers.
**Plans**: 3 plans

Plans:
- [ ] 06-01: Add focused API/storage tests for security, concurrency, restore, push, and destructive admin actions.
- [ ] 06-02: Update `readme.md`, `building.md`, `.env.example`, Docker, compose, and CI docs to match the production contract.
- [ ] 06-03: Run release validation commands and document any remaining environment-specific blockers.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auth, Profile, And Invite Hardening | 2/8 | In Progress|  |
| 2. Event And Invite Consistency | 0/3 | Not started | - |
| 3. Backup And Restore Safety | 0/3 | Not started | - |
| 4. PWA And Realtime Reliability | 0/3 | Not started | - |
| 5. Frontend And Admin UI Modularization | 0/4 | Not started | - |
| 6. Release Verification And Documentation | 0/3 | Not started | - |

## Coverage

- v1 requirements mapped: 44 / 44
- Unmapped v1 requirements: 0
- Total planned phases: 6
- Total planned phase plans: 22

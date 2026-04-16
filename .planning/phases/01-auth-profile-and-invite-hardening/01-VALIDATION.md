---
phase: 01
slug: auth-profile-and-invite-hardening
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-16
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + Supertest |
| **Config file** | `vite.config.ts`, `package.json` |
| **Quick run command** | `npm test -- --run src/server/http/app-flow.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-90 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run src/server/http/app-flow.test.ts` when the task touches API/session/auth/invite behavior.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** `npm test`, `npm run build`, and `npm audit --omit=dev` must be green or documented with environment-specific blockers.
- **Max feedback latency:** 90 seconds for the quick suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | AUTH-02/AUTH-03/AUTH-04/AUTH-07/PROF-01/PROF-02/PROF-03/INV-01 | T-01 schema/session | Phase 1 schema foundations exist and are migration-tested. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | AUTH-02/AUTH-03/AUTH-04/AUTH-07/PROF-01/PROF-02/PROF-03/INV-01 | T-01 schema/session | Drizzle schema mirrors migrations and builds cleanly. | Build | `npm run build` | ✅ | ✅ green |
| 01-01-03 | 01 | 1 | AUTH-02/AUTH-03/AUTH-04/AUTH-07/PROF-01/PROF-02/PROF-03/INV-01 | T-01 schema/session | Migration assertions cover Phase 1 objects + build server migration copy. | API integration + build | `npm test -- --run src/server/http/app-flow.test.ts && npm run build` | ✅ | ✅ green |
| 01-02-01 | 02 | 2 | AUTH-01/AUTH-02/AUTH-03/INV-01 | T-02 abuse controls | Persisted rate-limits + admin APIs are enforceable and operable. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | AUTH-01/AUTH-02/AUTH-03 | T-01 enumeration | Login requests are generic and challenge lifecycle is bounded/cleaned. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-02-03 | 02 | 2 | AUTH-01/AUTH-02/AUTH-03 | T-03 audit robustness | Audit logging is best-effort and never blocks primary flows. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-03-01 | 03 | 4 | AUTH-07/PROF-02 | T-04 email uniqueness | Active email uniqueness is enforced consistently; displayName is exposed. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-03-02 | 03 | 4 | AUTH-07/PROF-03 | T-01 account takeover | Email change requires confirmation before activation; audit metadata avoids OTPs. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-03-03 | 03 | 4 | PROF-01 | T-05 device ownership | Device defaults are useful and session rename is ownership-protected. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-03-04 | 03 | 4 | AUTH-07/PROF-01/PROF-02/PROF-03 | T-05 regression | Profile/device/email tests are consolidated and deterministic. | API integration + build | `npm test -- --run src/server/http/app-flow.test.ts && npm run build` | ✅ | ✅ green |
| 01-04-01 | 04 | 3 | INV-01 | T-06 invite brute force | Invite registration attempts are throttled (INV-03 explicitly deferred). | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-04-02 | 04 | 3 | INV-02/INV-04 | T-07 invite secrets | Invites are generated-only with entropy policy; audit metadata masks full code. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-04-03 | 04 | 3 | INV-05/INV-06/INV-07 | T-08 lifecycle safety | Invite lifecycle endpoints enforce safe edit/deactivate/reactivate/delete semantics. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-04-04 | 04 | 3 | INV-01/INV-02/INV-04/INV-05/INV-06/INV-07 | T-05 regression | Invite tests are consolidated; INV-03 remains deferred to Phase 2. | API integration + build | `npm test -- --run src/server/http/app-flow.test.ts && npm run build` | ✅ | ✅ green |
| 01-05-01 | 05 | 5 | AUTH-02/AUTH-06 | T-09 frontend CSRF | React client sends CSRF for authenticated mutations and maps new errors. | Build | `npm run build` | ✅ | ✅ green |
| 01-05-02 | 05 | 5 | PROF-01/PROF-02/PROF-03 | T-10 account UX | Profile, email change, and session management are wired in existing UI. | Build | `npm run build` | ✅ | ✅ green |
| 01-05-03 | 05 | 5 | INV-01/INV-02/INV-04/INV-05/INV-06/INV-07 | T-11 invite UX | Admin invite lifecycle UI keeps full code visibility; no custom-code submits. | Build | `npm run build` | ✅ | ✅ green |
| 01-06-01 | 06 | 7 | AUTH-01..INV-07/PROF-01..PROF-03 | T-01 false green | Phase 1 API regression suite covers high-risk behaviors end-to-end. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-06-02 | 06 | 7 | AUTH-06/INV-02/INV-04 | T-02 undocumented secret | Operator docs include Phase 1 env vars + invite-code credential handling. | Build | `npm run build` | ✅ | ✅ green |
| 01-06-03 | 06 | 7 | AUTH-01..INV-07/PROF-01..PROF-03 | T-05 production handoff | Final commands executed: test, build, audit; scope boundaries confirmed (INV-03 deferred). | Full suite/build/audit | `npm test && npm run build && npm audit --omit=dev` | ✅ | ✅ green |
| 01-07-01 | 07 | 3 | AUTH-04/AUTH-05 | T-01 bearer tokens | Sessions persist token hashes; legacy sessions rejected; sensitive changes revoke sessions. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-07-02 | 07 | 3 | AUTH-06 | T-03 CSRF | CSRF tokens via `/api/auth/csrf` and required on authenticated mutations. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ✅ green |
| 01-08-01 | 08 | 6 | AUTH-02 | T-01 lockout recovery | Admin UI can inspect/clear rate-limit blocks and manage LAN allowlist. | Build | `npm run build` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing Vitest/Supertest infrastructure covers this phase.
- Add or extend API integration tests before or alongside behavior changes in each plan.
- Add migration assertions where schema/table changes are introduced.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin rate-limit operations UI clarity | AUTH-02 | UI detail may be easiest to inspect manually after API coverage exists. | Log in as admin, trigger a test block, verify block list, clear action, and allowlist action are visible and work. |
| Browser-derived device default wording | PROF-01 | User-agent labels vary by browser/OS. | Log in without device name from desktop and mobile browser user agents; verify label is useful and editable. |

---

## Required Validation Dimensions

- User enumeration resistance.
- Abuse throttling for login-code, OTP verification, and invite registration.
- Challenge lifecycle correctness.
- Session secret safety and invalidation.
- CSRF posture for mutating cookie-authenticated routes.
- Profile and email safety.
- Device management.
- Invite credential handling and lifecycle.
- Migration compatibility.
- Audit robustness and redaction.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or explicit manual-only rationale.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] No watch-mode flags in verification commands.
- [ ] Feedback latency < 90 seconds for quick API suite.
- [ ] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending

---
phase: 01
slug: auth-profile-and-invite-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
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
| 01-01-01 | 01 | 1 | AUTH-01/AUTH-02/AUTH-03 | T-01-enumeration | Login requests are generic, throttled, and stale challenges are controlled. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | AUTH-04/AUTH-05/AUTH-06 | T-02-session-csrf | Session secrets are hashed, sensitive changes revoke sessions, CSRF blocks mutating cookie requests. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ⬜ pending |
| 01-02-01 | 02 | 1 | AUTH-07/PROF-01/PROF-02/PROF-03 | T-03-profile-email | Profile fields and confirmed email changes are validated, audited, and uniqueness-safe. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ⬜ pending |
| 01-03-01 | 03 | 1 | INV-01/INV-02/INV-04/INV-05/INV-06/INV-07 | T-04-invite-secret | Invite lifecycle supports required admin actions while audit metadata redacts code secrets. | API integration | `npm test -- --run src/server/http/app-flow.test.ts` | ✅ | ⬜ pending |
| 01-04-01 | 04 | 2 | AUTH-01..INV-07 | T-05-regression | Migrations, schema, frontend calls, and release checks stay aligned. | Full suite/build | `npm test && npm run build` | ✅ | ⬜ pending |

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

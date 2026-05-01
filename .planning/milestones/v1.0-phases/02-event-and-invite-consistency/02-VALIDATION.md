---
phase: 02
slug: event-and-invite-consistency
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-16T12:19:01Z
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 + Supertest |
| **Config file** | none detected |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10-60 seconds (depends on suite growth) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | INV-03 | T-02-01 | No oversubscription of invite maxUses under concurrency; loser gets `403 invite_ausgeschoepft`. | integration | `npm test` | ✅ | ✅ green |
| 02-02-01 | 02 | 1 | EVT-01 | T-02-02 | No oversubscription of event maxPlayers under concurrent joins; loser gets `409 event_voll`. | integration | `npm test` | ✅ | ✅ green |
| 02-03-01 | 03 | 2 | EVT-02 | T-02-03 | Side effects coherent: success triggers audit+SSE; rejections audit + admin/manager-only push; no forced SSE on rejection. | integration | `npm test` | ✅ | ✅ green |
| 02-03-02 | 03 | 2 | EVT-03 | — | Cancel/archive + auto-archive still correct after transactional refactor. | integration | `npm test` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Add a concurrency-focused test for INV-03 (only if current tests don’t cover the concurrent case deterministically).
- [x] Add at least one dedicated concurrency-focused test for EVT-01.
- [x] Add side-effects assertions for EVT-02 (audit + push recipient filtering + SSE behavior).
- [x] Add lifecycle regression tests for EVT-03 (cancel/archive + auto-archive).

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete


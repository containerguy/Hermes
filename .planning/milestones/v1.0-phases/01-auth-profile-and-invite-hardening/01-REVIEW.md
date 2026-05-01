---
phase: 01-auth-profile-and-invite-hardening
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - .planning/phases/01-auth-profile-and-invite-hardening/01-01-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-02-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-03-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-04-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-05-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-06-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-07-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-08-PLAN.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-01-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-02-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-03-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-04-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-05-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-06-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-07-SUMMARY.md
  - .planning/phases/01-auth-profile-and-invite-hardening/01-08-SUMMARY.md
  - src/server/http/auth-routes.ts
  - src/server/http/admin-routes.ts
  - src/server/auth/sessions.ts
  - src/server/auth/current-user.ts
  - src/server/auth/csrf.ts
  - src/server/auth/rate-limits.ts
  - src/server/audit-log.ts
  - src/server/db/schema.ts
  - src/server/db/migrations/0005_auth_profile_invite_hardening.sql
  - src/main.tsx
  - src/styles.css
  - src/server/http/app-flow.test.ts
findings:
  critical: 2
  warning: 2
  info: 3
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-16  
**Depth:** standard  
**Status:** issues_found

## Summary

Phase 01’s implementation largely matches the plans: sessions are stored by token hash (not raw bearer token), CSRF is enforced for authenticated mutations with explicit auth-route exemptions, login-code request is enumeration-resistant, rate limits are persisted + operable via admin APIs/UI, invite lifecycle is generated-only + audited with masking, and `app-flow.test.ts` provides broad regression coverage.

The main review concerns are (1) **production-hardening footguns** around secrets/dev toggles and (2) a couple of **input-sanitization correctness issues** that can lead to unexpected runtime behavior.

## Critical Issues

### CR-01: CSRF secret has a hardcoded dev fallback

**File:** `src/server/auth/csrf.ts:8-10`  
**Issue:** `csrfSecret()` falls back to a constant (`"hermes-dev-csrf-secret"`) when `HERMES_CSRF_SECRET` is unset. If an operator forgets to set the env var in production, CSRF protection becomes predictable/portable across deployments.
**Fix:**

```ts
// Conceptual fix (keep behavior in tests/dev, fail closed in production)
function csrfSecret() {
  const configured = process.env.HERMES_CSRF_SECRET;
  if (configured && configured.trim()) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("HERMES_CSRF_SECRET must be set in production");
  }
  return "hermes-dev-csrf-secret";
}
```

If throwing here is too disruptive, an alternative is to make app startup validate env (single check) rather than throwing inside request-handling paths.

### CR-02: Dev OTP override (`HERMES_DEV_LOGIN_CODE`) can silently bypass OTP randomness

**File:** `src/server/http/auth-routes.ts:76-97`, `src/server/http/auth-routes.ts:512-557`  
**Issue:** Both login challenges and email-change challenges use `process.env.HERMES_DEV_LOGIN_CODE ?? generateOtp()`. If `HERMES_DEV_LOGIN_CODE` is set in a real environment (misconfig, copied `.env`, etc.), OTPs become fixed/predictable and effectively disable the “something you received” property.
**Fix:**

```ts
function maybeDevOtp() {
  const configured = process.env.HERMES_DEV_LOGIN_CODE;
  if (!configured) return undefined;
  if (process.env.NODE_ENV === "production") return undefined;
  return configured;
}

const code = maybeDevOtp() ?? generateOtp();
```

Also consider asserting the value matches the 6-digit policy (or deleting the env escape hatch entirely and using test-only injection).

## Warnings

### WR-01: Admin audit-log `limit` query can become `NaN` and bypass clamping

**File:** `src/server/http/admin-routes.ts:149-152`  
**Issue:** `const limit = Number(request.query.limit ?? "100")` can become `NaN` (e.g. `?limit=abc`). `listAuditLogs(context, limit)` then computes `Math.max(1, Math.min(limit, 500))`, which yields `NaN`, and `drizzle.limit(NaN)` is undefined behavior and may throw.
**Fix:**

```ts
const raw = request.query.limit;
const parsed = typeof raw === "string" ? Number(raw) : 100;
const limit = Number.isFinite(parsed) ? parsed : 100;
response.json({ auditLogs: listAuditLogs(context, limit) });
```

### WR-02: Rate-limit allowlist storage accepts unvalidated IP/CIDR strings

**File:** `src/server/auth/rate-limits.ts:204-221`, `src/server/http/admin-routes.ts:195-218`  
**Issue:** `addRateLimitAllowlist()` persists `ipOrCidr` as-is (`trim()` only). `checkRateLimit()` attempts to interpret CIDRs only for IPv4, and compares exact strings otherwise. This means malformed values can be stored and later never match (operator confusion), and IPv6 CIDR entries “look supported” but won’t match.
**Fix:** Validate on write:

```ts
// In admin-routes.ts (before addRateLimitAllowlist)
const value = parsed.data.ipOrCidr.trim();
const isExactIp = net.isIP(value) !== 0;
const isIpv4Cidr = /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(value) && isIpv4InCidr("127.0.0.1", value) !== undefined;
if (!isExactIp && !isIpv4Cidr) {
  response.status(400).json({ error: "ungueltiger_allowlist_eintrag" });
  return;
}
```

Or explicitly document “IPv4 only” and reject anything else.

## Info

### IN-01: `recordRateLimitFailure()` name is misleading for `/request-code`

**File:** `src/server/http/auth-routes.ts:148-165`  
**Issue:** `/request-code` calls `recordRateLimitFailure()` even on successful (allowed) requests. This is correct behavior (count attempts), but the name “Failure” makes future changes risky (someone might “fix” it).
**Fix:** Consider renaming to something like `recordRateLimitAttempt()` (and keep a separate “failure” recorder if you need both semantics).

### IN-02: Username normalization is used for rate-limit key/audit masking but not for DB lookup

**File:** `src/server/http/auth-routes.ts:148-170`  
**Issue:** Rate-limit key uses `normalizeUsername()` (lowercased), while DB queries use the provided username verbatim. If usernames are treated as case-insensitive by product expectations, this can cause confusing behavior (rate-limit coupling across cases but lookup not).
**Fix:** Either (a) make username matching case-insensitive consistently (schema + queries) or (b) remove lowercasing from `normalizeUsername()` and only use `.trim()`.

### IN-03: `publicUser()` exposes `phoneNumber` and `deletedAt` to non-admin callers

**File:** `src/server/auth/current-user.ts:11-22`  
**Issue:** `GET /api/auth/me` returns `phoneNumber` and `deletedAt`. If these fields are not intended for general clients, returning them increases accidental coupling and data exposure.
**Fix:** Consider a smaller “public” shape for non-admin consumers (e.g., omit `phoneNumber`, and possibly omit `deletedAt` unless needed for UX).

---

_Reviewed: 2026-04-16_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_


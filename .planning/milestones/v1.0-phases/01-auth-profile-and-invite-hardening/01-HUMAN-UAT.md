---
status: partial
phase: 01-auth-profile-and-invite-hardening
source: [01-VERIFICATION.md]
started: 2026-04-16T10:19:39Z
updated: 2026-04-16T10:19:39Z
---

## Current Test

Awaiting human testing.

## Tests

### 1. Auth smoke: request-code + verify-code + profile update
expected: Login-code request shows generic success; verify logs in; profile display-name save succeeds without CSRF errors.
result: [pending]

### 2. Email-change confirmation flow
expected: Request sends code to new email; wrong code rejected; correct code confirms email and logs out (re-login required).
result: [pending]

### 3. Admin lockout recovery
expected: Admin can see active rate-limit blocks, clear one, add/delete allowlist entries; UI remains responsive.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps


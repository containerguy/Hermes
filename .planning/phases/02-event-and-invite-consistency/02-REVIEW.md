---
phase: 02-event-and-invite-consistency
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/server/http/auth-routes.ts
  - src/server/http/event-routes.ts
  - src/server/push/push-service.ts
  - src/main.tsx
  - src/server/http/app-flow.test.ts
  - src/server/http/event-capacity.test.ts
  - src/server/http/event-side-effects.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-16  
**Depth:** standard  
**Files Reviewed:** 7  
**Status:** issues_found

## Summary

Phase 2’s overall approach is sound: both INV-03 and EVT-01 move “capacity check + write” into a `BEGIN IMMEDIATE` transaction, and EVT-02 keeps side effects (audit/SSE/push) post-commit on the success path while avoiding SSE fanout on capacity rejection.

The main correctness gap is in the **bounded retry** behavior for `SQLITE_BUSY` / `SQLITE_LOCKED`: both the invite registration path and the event participation path can still **bubble a transient lock error into the generic error handling**, producing **incorrect response codes** (and potentially inconsistent side effects) under contention.

## Critical Issues

### CR-01: Retry exhaustion can return the wrong error / crash path under `SQLITE_BUSY|SQLITE_LOCKED`

**File:** `src/server/http/auth-routes.ts:345-426`  
**Issue:** The INV-03 “retry once on busy/locked” wrapper retries exactly once, but **if the second attempt is also busy/locked**, the error bubbles into the outer `catch` at L395 and falls through to the generic handler (L422-L425), returning `409 { error: "user_existiert_bereits" }`. That is a **semantic mismatch**: lock contention should not be reported as “user already exists”, and it violates the plan’s “retry once, then use existing DB-failure behavior”.

Concretely:
- First attempt busy/locked → retry (L350-L352) ✅
- Second attempt busy/locked → thrown → caught by outer `catch` → treated as “user exists already” (L422-L425) ❌

**Fix:** After the retry fails, detect busy/locked again and map it to the project’s existing “DB failure” response (whatever is used elsewhere), or rethrow to a handler that returns the correct 5xx. Minimal shape:

```ts
try {
  result = registerInvitedUser();
} catch (error) {
  if (!isSqliteBusyOrLocked(error)) throw error;
  try {
    result = registerInvitedUser();
  } catch (retryError) {
    if (isSqliteBusyOrLocked(retryError)) {
      // return existing DB failure response (not user_existiert_bereits)
      response.status(500).json({ error: "registrierung_fehlgeschlagen" });
      return;
    }
    throw retryError;
  }
}
```

Apply the same “retry failed due to busy/locked” handling principle in `src/server/http/event-routes.ts` (see WR-01).

## Warnings

### WR-01: Event participation busy/locked retry can still escape as an unhandled exception (500) instead of stable API behavior

**File:** `src/server/http/event-routes.ts:420-509`  
**Issue:** For EVT-01 the handler retries `transaction.immediate()` once when `isSqliteBusyOrLocked(error)` is true (L460-L506). But if the retry also throws `SQLITE_BUSY*` / `SQLITE_LOCKED*`, the code does `throw retryError` (L501-L503), which escapes the route handler and will become an Express error (likely a 500 with default middleware), not the “existing DB failure behavior” described in the plan.

This shows up only under contention, but that’s exactly the scenario this phase is trying to make deterministic.

**Fix:** Mirror the INV-03 pattern: if the retry error is busy/locked again, return the project’s stable DB error response (or a targeted 500) from within the handler rather than throwing. Keep capacity losers stable as `409 event_voll`.

### WR-02: `event.maxPlayers` is used as a number without explicit null/undefined hardening inside the transaction

**File:** `src/server/http/event-routes.ts:375-379`  
**Issue:** The capacity check is `if (joinedCount >= event.maxPlayers) { throw ... }`. If `maxPlayers` can ever be `NULL` at the DB layer (even transiently, via legacy rows or partial migrations), this comparison becomes `joinedCount >= null` (coerces to `>= 0`) or `>= undefined` (always false), which can either **reject all joins** or **allow oversubscription**.

The TS type in `src/main.tsx` models `maxPlayers: number`, but the backend uses Drizzle inferred types from `schema.ts` (not reviewed here). If schema guarantees NOT NULL, this is fine; if not, it’s a latent correctness bug.

**Fix:** Defensively guard in the route at the trust boundary:
- Validate `typeof event.maxPlayers === "number" && event.maxPlayers > 0` before entering the transactional join path, else `400 ungueltiges_event` or `500`.
- Or enforce NOT NULL at schema/migration level and add a test for legacy row handling.

### WR-03: Transaction uses a timestamp captured outside the transaction for invite expiry checks

**File:** `src/server/http/auth-routes.ts:273-343`  
**Issue:** `timestamp` is computed once at L273 and then reused inside the transaction (L298-L300) to validate invite expiry. Under contention (or slow retries), an invite that **expires after L273 but before the transaction actually runs** can still be accepted because you compare against a stale `timestamp`.

This is subtle, but it’s a transactional semantics edge case: you’re checking “expired at request start” rather than “expired at commit time”.

**Fix:** Recompute `timestamp` inside `registerInvitedUser()` (or inside the transaction body) for expiry comparisons and `usedAt/createdAt` writes, especially since this code is explicitly about concurrency correctness.

## Info

### IN-01: Audit log for capacity rejection queries `existing` outside the rejected transaction

**File:** `src/server/http/event-routes.ts:424-444` and `465-485`  
**Issue:** On `EventCapacityError`, `existing` participation is re-loaded outside the rejected transaction (L424-L428 / L465-L469). Under heavy concurrency, this can record a `previousParticipation` value that reflects a slightly later state than the one that caused the rejection (still acceptable, but the audit record can become confusing during incident review).

**Fix:** Consider carrying `existing?.status` out of the transaction attempt when throwing the sentinel error (e.g., attach `previousParticipation` to `EventCapacityError`) so audit metadata is tied to the same snapshot as the capacity decision.

### IN-02: Side-effect code duplication in `event-routes.ts` rejection path increases divergence risk

**File:** `src/server/http/event-routes.ts:423-458` and `464-499`  
**Issue:** The `EventCapacityError` handling is duplicated for the initial attempt and the retry attempt. This increases the risk of future edits changing one path but not the other (e.g., adding metadata fields, adjusting push copy, etc.).

**Fix:** Extract a helper like `handleCapacityRejection(error: EventCapacityError, existingStatus: string | null)` to consolidate audit + push + response formatting.

### IN-03: UI handling of `event_voll` is robust, but relies on numeric coercion that can produce `NaN` silently

**File:** `src/main.tsx:525-543`  
**Issue:** The UI reads `joinedCount`/`maxPlayers` from either the server-provided `event` or the cached local `events`, then coerces via `Number(...)`. If either is missing, you end up with `NaN` and fall back to “Event ist voll.” which is fine, but it can hide an API regression where the server stopped including useful fields.

**Fix:** Consider explicitly checking presence and logging (client-side) in development builds, or tightening the response type to ensure `event.joinedCount`/`maxPlayers` are always present when returning `event_voll` with an `event` body.

---

_Reviewed: 2026-04-16T00:00:00Z_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_


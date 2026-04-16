---
phase: 02-event-and-invite-consistency
verified: 2026-04-16T12:59:43Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 02: Event And Invite Consistency Verification Report

**Phase Goal:** Capacity-sensitive writes cannot oversubscribe invite max uses or event max players, and event/invite side effects remain consistent after success and failure.  
**Verified:** 2026-04-16T12:59:43Z  
**Status:** passed  
**Re-verification:** No — initial verification

## Must-Haves (Truths)

1. **INV-03**: Two concurrent invite registrations against an invite with `maxUses=1` produce exactly one success and one `403 invite_ausgeschoepft` (no oversubscription).
2. **INV-03 (audit)**: Rejected invite registrations due to exhausted invite are audit-logged with IP/username metadata when available.
3. **EVT-01**: Two concurrent join attempts into an event with `maxPlayers=1` produce exactly one success and one `409 event_voll`, and persisted joined count never exceeds `maxPlayers`.
4. **EVT-02**: Participation success vs. capacity rejection keep audit/SSE/push coherent (post-commit; no forced SSE on rejection; operator-only push on rejection).
5. **EVT-03 + UX**: Manual cancel/archive and automatic archive still work after refactor; UI explains `event_voll` as “Spieler X von Y” and suggests starting a new round without changing the stable error code.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | INV-03 concurrency winner/loser semantics | ✓ VERIFIED | Immediate transaction + bounded retry in `auth-routes.ts`, plus concurrency test in `app-flow.test.ts`. |
| 2 | INV-03 rejection audit has IP/username metadata | ✓ VERIFIED | Rejection audit metadata includes `username` + `sourceIp` in `auth-routes.ts`. |
| 3 | EVT-01 concurrency winner/loser semantics + no oversubscription | ✓ VERIFIED | Immediate transaction capacity check + concurrency test in `event-capacity.test.ts` asserts joinedCount stays 1. |
| 4 | EVT-02 side effects coherent after success/failure | ✓ VERIFIED | Success: audit + SSE + conditional push after commit; Rejection: audit + operator push, no forced SSE; asserted in `event-side-effects.test.ts`. |
| 5 | EVT-03 lifecycle + client UX copy for `event_voll` | ✓ VERIFIED | Lifecycle regression test covers cancel + auto-archive; client renders “Spieler X von Y … neue Runde” on `event_voll`. |

**Score:** 5/5 truths verified

## Required Artifacts (Existence + Substance + Wiring)

| Artifact | Expected | Status | Details |
|--------|----------|--------|---------|
| `src/server/http/auth-routes.ts` | Atomic invite consumption + retry + audit | ✓ VERIFIED | Uses `context.sqlite.transaction(...).immediate()` and counts `invite_code_uses` inside txn; bounded retry; rejection audit. |
| `src/server/http/app-flow.test.ts` | INV-03 concurrency regression | ✓ VERIFIED | Concurrent registration test asserts one `201` and one `403 invite_ausgeschoepft`, and DB uses count is 1. |
| `src/server/http/event-routes.ts` | Atomic event join capacity enforcement + coherent side effects | ✓ VERIFIED | Capacity check inside `transaction.immediate()`; on success emits audit + SSE; on rejection emits audit + operator push; no rejection SSE. |
| `src/server/http/event-capacity.test.ts` | EVT-01 concurrency regression | ✓ VERIFIED | `Promise.all` join requests assert exactly one `200` and one `409`, and board `joinedCount === 1`. |
| `src/server/http/event-side-effects.test.ts` | EVT-02 side effects + EVT-03 lifecycle regression | ✓ VERIFIED | Spies assert exactly one `participation_updated` broadcast (winner only), operator push called once, rejection audit present; cancel + auto-archive verified. |
| `src/server/push/push-service.ts` | Operator-only push fanout | ✓ VERIFIED | `sendPushToOperators` filters to `role in (admin, manager)` and `notificationsEnabled = true`. |
| `src/main.tsx` | `event_voll` UX message with “Spieler X von Y” | ✓ VERIFIED | Client uses `ApiError.body.event` (or fallback board event) to render “Du wärst Spieler X von Y … neue Runde.” |

## Key Link Verification (Wiring)

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `auth-routes.ts` | SQLite immediate transaction | `context.sqlite.transaction(...).immediate()` | ✓ WIRED | Invite capacity check and consumption happen inside an immediate transaction. |
| `auth-routes.ts` | `invite_code_uses` | `SELECT COUNT(*) ... invite_code_uses` + insert use | ✓ WIRED | Count and insert occur inside same txn; prevents oversubscription. |
| `event-routes.ts` | SQLite immediate transaction | `transaction.immediate()` | ✓ WIRED | Joined-count check and upsert occur inside the immediate txn; bounded retry on busy/locked. |
| `event-routes.ts` | SSE | `broadcastEventsChanged("participation_updated")` on success | ✓ WIRED | Broadcast occurs only after successful commit; tests verify loser does not force extra broadcast. |
| `event-routes.ts` | Push | `sendPushToOperators(...)` on rejection | ✓ WIRED | Operator-only push is used for capacity losers; tests assert it’s called once. |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---------|---------------|--------|--------------------|--------|
| `event-routes.ts` | `joinedCount` used in rejection UX + audit | `countJoined(...)` inside immediate txn | Yes (DB count) | ✓ FLOWING |
| `main.tsx` | `joinedCount/maxPlayers` for error message | `ApiError.body.event` (server response) or board fallback | Yes (server or refreshed board) | ✓ FLOWING |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---------|---------|--------|--------|
| Phase 02 API tests | `npm test -- src/server/http/event-capacity.test.ts src/server/http/event-side-effects.test.ts src/server/http/app-flow.test.ts` | `29 passed (29)` | ✓ PASS |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|----------|
| INV-03 | `02-01-PLAN.md` | Invite `maxUses` atomic (no oversubscription) | ✓ SATISFIED | Immediate txn + concurrency test in `app-flow.test.ts` + rejection audit metadata in `auth-routes.ts`. |
| EVT-01 | `02-02-PLAN.md` | Event join capacity atomic under concurrency | ✓ SATISFIED | Immediate txn capacity check in `event-routes.ts` + concurrency test in `event-capacity.test.ts`. |
| EVT-02 | `02-03-PLAN.md` | Side effects coherent after success/failure | ✓ SATISFIED | Winner: audit+SSE; loser: audit+operator push, no extra SSE; asserted in `event-side-effects.test.ts`. |
| EVT-03 | `02-03-PLAN.md` | Lifecycle transitions preserved (manual + auto archive) | ✓ SATISFIED | Cancel + auto-archive regression assertions in `event-side-effects.test.ts` + `refreshEventStatuses()` logic unchanged. |

## Anti-Patterns Found

None observed in the verified files (no placeholders, no stubbed returns, no “TODO”-only handlers in the new logic).

---

### Evidence Snippets

Invite atomic transaction + retry + exhausted audit:

```287:435:src/server/http/auth-routes.ts
    const registerInvitedUser = () => {
      return context.sqlite
        .transaction(() => {
          const transactionTimestamp = nowIso();
          const freshInvite = context.db
            .select()
            .from(inviteCodes)
            .where(eq(inviteCodes.id, invite.id))
            .get();
          // ...
          const usesRow = context.sqlite
            .prepare("SELECT COUNT(*) AS count FROM invite_code_uses WHERE invite_code_id = ?")
            .get(freshInvite.id) as { count: number };
          if (freshInvite.maxUses !== null && usesRow.count >= freshInvite.maxUses) {
            throw new InviteExhaustedError();
          }
          // insert user + inviteCodeUses inside txn
          // ...
          return { remainingUses };
        })
        .immediate();
    };
    // bounded retry on SQLITE_BUSY/LOCKED
    // ...
      if (error instanceof InviteExhaustedError) {
        tryWriteAuditLog(context, {
          action: "auth.register_rejected",
          // ...
          metadata: { username: parsed.data.username, sourceIp: request.ip ?? null }
        });
        response.status(403).json({ error: "invite_ausgeschoepft" });
        return;
      }
```

Event join capacity enforced inside immediate txn; side effects success vs. rejection:

```346:545:src/server/http/event-routes.ts
  router.post("/:id/participation", (request, response) => {
    // ...
    const transaction = context.sqlite.transaction(() => {
      const existing = context.db
        .select()
        .from(participations)
        .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
        .get();
      const alreadyJoined = existing?.status === "joined";
      if (parsed.data.status === "joined" && !alreadyJoined) {
        const joinedCount = countJoined(context, event.id);
        if (joinedCount >= event.maxPlayers) {
          throw new EventCapacityError({ joinedCount, maxPlayers: event.maxPlayers });
        }
      }
      // upsert inside txn
      // status recalculation inside txn
      return { existingStatus: existing?.status ?? null, previousStatus, nextStatus, updated };
    });
    // ...
    try {
      transactionResult = transaction.immediate();
    } catch (error) {
      if (error instanceof EventCapacityError) {
        tryWriteAuditLog(context, { metadata: { outcome: "rejected", reason: "event_voll" } });
        void sendPushToOperators(context, { title: "Runde voll", /* ... */ });
        response.status(409).json({ error: "event_voll", event: refreshed ? serializeEvent(context, refreshed, actor.id) : undefined });
        return;
      }
      // bounded retry on busy/locked
    }
    // post-commit success side effects
    tryWriteAuditLog(context, { action: "participation.set" });
    broadcastEventsChanged("participation_updated");
    if (previousStatus !== nextStatus && updated) void sendPushToEnabledUsers(context, { title: "Runde aktualisiert" });
    response.json({ event: updated ? serializeEvent(context, updated, actor.id) : undefined });
  });
```

Operator-only push targeting:

```103:113:src/server/push/push-service.ts
export async function sendPushToOperators(context: DatabaseContext, payload: PushPayload) {
  const targets = context.db
    .select()
    .from(users)
    .where(and(eq(users.notificationsEnabled, true), inArray(users.role, ["admin", "manager"])))
    .all();
  await Promise.all(targets.map((target) => sendPushToUser(context, target.id, payload)));
}
```

Client UX copy for `event_voll` (“Spieler X von Y … neue Runde”):

```514:545:src/main.tsx
  async function setParticipation(eventId: string, status: "joined" | "declined") {
    // ...
    } catch (caught) {
      if (caught instanceof ApiError && caught.message === "event_voll") {
        const body = caught.body as { event?: Partial<GameEvent> } | null | undefined;
        const serverEvent = body?.event;
        const fallbackEvent = events.find((event) => event.id === eventId);
        const joinedCount = Number(serverEvent?.joinedCount ?? fallbackEvent?.joinedCount);
        const maxPlayers = Number(serverEvent?.maxPlayers ?? fallbackEvent?.maxPlayers);
        const playerNumber = Number.isFinite(joinedCount) ? joinedCount + 1 : NaN;
        const parts = [];
        if (Number.isFinite(playerNumber) && Number.isFinite(maxPlayers) && maxPlayers > 0) {
          parts.push(`Event ist voll: Du wärst Spieler ${playerNumber} von ${maxPlayers}.`);
        } else {
          parts.push("Event ist voll.");
        }
        parts.push("Vielleicht ist es Zeit für eine neue Runde.");
        await loadEvents().catch(() => undefined);
        setError(parts.join(" "));
        return;
      }
      setError(getErrorMessage(caught));
    }
  }
```


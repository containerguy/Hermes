# Phase 02: Event And Invite Consistency - Pattern Map

**Mapped:** 2026-04-16  
**Files analyzed:** 11 (8 likely modified, 3 likely new)  
**Analogs found:** 8 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/server/http/auth-routes.ts` | route/controller | request-response + transactional write | `src/server/http/auth-routes.ts` | exact (self) |
| `src/server/http/event-routes.ts` | route/controller | request-response + transactional write | `src/server/http/event-routes.ts` | exact (self) |
| `src/server/audit-log.ts` | service/utility | write-only (best-effort) | `src/server/audit-log.ts` | exact (self) |
| `src/server/realtime/event-bus.ts` | service | pub-sub (SSE broadcast) | `src/server/realtime/event-bus.ts` | exact (self) |
| `src/server/push/push-service.ts` | service | fanout + I/O | `src/server/push/push-service.ts` | exact (self) |
| `src/server/domain/events.ts` | domain | pure transform | `src/server/domain/events.ts` | exact (self) |
| `src/server/db/schema.ts` | config/model | schema definitions | `src/server/db/schema.ts` | exact (self) |
| `src/server/http/app-flow.test.ts` | test | integration (HTTP) | `src/server/http/app-flow.test.ts` | exact (self) |
| `src/server/db/sqlite-retry.ts` (probable) | utility | transactional retry | — | no analog |
| `src/server/http/event-capacity.test.ts` (probable) | test | integration + concurrency | `src/server/http/app-flow.test.ts` | role-match |
| `src/server/http/invite-capacity.test.ts` (optional) | test | integration + concurrency | `src/server/http/app-flow.test.ts` | role-match |

> Notes
> - Phase docs explicitly call out current touchpoints: `auth-routes.ts`, `event-routes.ts`, `audit-log.ts`, `event-bus.ts`, `push-service.ts`, `domain/events.ts`, `db/schema.ts`, and client error copy in `src/main.tsx`.
> - There is **no existing usage** of `better-sqlite3` transaction `.immediate()` / `BEGIN IMMEDIATE` / `SQLITE_BUSY*` retry in the codebase (searched for `.immediate(`, `SQLITE_BUSY`, `BEGIN IMMEDIATE` → no matches).

## Pattern Assignments

### `src/server/http/auth-routes.ts` (route/controller, request-response + transactional write)

**Analog:** `src/server/http/auth-routes.ts`

**Validation pattern** (Zod `safeParse` + stable German error code):

```ts
const parsed = registerSchema.safeParse(request.body);
// ...
if (!parsed.success) {
  recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
  response.status(400).json({ error: "ungueltige_registrierung" });
  return;
}
```

**Current invite capacity race (to be moved inside txn)** (lines ~254-278 of file):

```ts
const invite = context.db
  .select()
  .from(inviteCodes)
  .where(eq(inviteCodes.code, normalizedCode))
  .get();

// ...

const uses = context.db
  .select()
  .from(inviteCodeUses)
  .where(eq(inviteCodeUses.inviteCodeId, invite.id))
  .all();

if (invite.maxUses !== null && uses.length >= invite.maxUses) {
  recordRateLimitFailure(context, { scope: "invite_register", key: registerKey });
  response.status(403).json({ error: "invite_ausgeschoepft" });
  return;
}
```

**Established atomic-write pattern (multi-statement `context.sqlite.transaction(() => { ... })()`)** (lines ~282-310):

```ts
context.sqlite.transaction(() => {
  context.db
    .insert(users)
    .values({
      id: userId,
      // ...
      createdAt: timestamp,
      updatedAt: timestamp
    })
    .run();

  context.db
    .insert(inviteCodeUses)
    .values({
      id: randomUUID(),
      inviteCodeId: invite.id,
      userId,
      usedAt: timestamp
    })
    .run();
})();
```

**Best-effort audit pattern** (post-write, should remain non-blocking; lines ~335-342):

```ts
tryWriteAuditLog(context, {
  actor: created,
  action: "auth.register",
  entityType: "user",
  entityId: created.id,
  summary: `${created.username} hat sich mit Invite ${invite.label} registriert.`,
  metadata: { inviteCodeId: invite.id, inviteLabel: invite.label }
});
```

**What to copy for Phase 2 changes**
- Keep the validation + rate-limit structure exactly (stable errors).
- Replace the “capacity read outside txn” with a transactional block that does: reload invite row → count uses → conditional insert → return `remainingUses` (D-04).
- Use `tryWriteAuditLog` for rejections too (D-02), not `writeAuditLog`.

---

### `src/server/http/event-routes.ts` (route/controller, request-response + transactional write)

**Analog:** `src/server/http/event-routes.ts`

**Auth gate pattern** (router-level `requireUser` guard; lines ~154-163):

```ts
router.use((request, response, next) => {
  const user = requireUser(context, request);

  if (!user) {
    response.status(401).json({ error: "nicht_angemeldet" });
    return;
  }

  next();
});
```

**Current event capacity race (to be moved inside txn)** (lines ~344-354):

```ts
const existing = context.db
  .select()
  .from(participations)
  .where(and(eq(participations.eventId, event.id), eq(participations.userId, actor.id)))
  .get();
const alreadyJoined = existing?.status === "joined";

if (parsed.data.status === "joined" && !alreadyJoined && countJoined(context, event.id) >= event.maxPlayers) {
  response.status(409).json({ error: "event_voll" });
  return;
}
```

**Idempotent upsert pattern (unique `(eventId,userId)` + `onConflictDoUpdate`)** (lines ~358-375):

```ts
context.db
  .insert(participations)
  .values({
    id: existing?.id ?? randomUUID(),
    eventId: event.id,
    userId: actor.id,
    status: parsed.data.status,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  })
  .onConflictDoUpdate({
    target: [participations.eventId, participations.userId],
    set: {
      status: parsed.data.status,
      updatedAt: timestamp
    }
  })
  .run();
```

**Side-effects pattern (audit → SSE → conditional push)** (lines ~381-406):

```ts
writeAuditLog(context, {
  actor,
  action: "participation.set",
  entityType: "event",
  entityId: event.id,
  summary: parsed.data.status === "joined" ? `${actor.username} ist bei ${event.gameTitle} dabei.` : `${actor.username} ist bei ${event.gameTitle} nicht dabei.`,
  metadata: {
    participation: parsed.data.status,
    previousParticipation: existing?.status ?? null
  }
});
broadcastEventsChanged("participation_updated");
if (previousStatus !== nextStatus && updated) {
  void sendPushToEnabledUsers(context, { /* ... */ });
}
```

**What to copy for Phase 2 changes**
- Keep the `onConflictDoUpdate` idempotency shape.
- Move capacity check (`countJoined`) into the same transaction that performs the upsert, and make the “winner” the only one that commits.
- Keep “commit first, then side effects” semantics when adding retries: side effects should run after successful commit and exactly once per committed attempt.
- For rejection paths: do **audit + operator-only push** (D-07, D-11) but **no forced SSE** (D-10). Use `tryWriteAuditLog` rather than `writeAuditLog` if rejections must never block.

---

### `src/server/audit-log.ts` (utility, best-effort write)

**Analog:** `src/server/audit-log.ts`

**Best-effort wrapper** (lines ~43-49):

```ts
export function tryWriteAuditLog(context: DatabaseContext, input: AuditLogInput) {
  try {
    writeAuditLog(context, input);
  } catch (error) {
    console.error("[Hermes] audit log failed", error);
  }
}
```

**Invite-code redaction utility** (lines ~17-24):

```ts
export function maskInviteCode(code: string) {
  const normalized = code.trim();
  if (!normalized) return "";
  if (normalized.length <= 6) {
    return normalized.slice(0, 1) + "***" + normalized.slice(-1);
  }
  return normalized.slice(0, 3) + "***" + normalized.slice(-3);
}
```

**What to copy for Phase 2 changes**
- Use `tryWriteAuditLog` for new rejection audit entries (INV-03 + EVT-01 losers).
- If adding IP/username metadata (D-02), prefer redaction for invite code values (via `maskInviteCode`) where needed.

---

### `src/server/realtime/event-bus.ts` (service, SSE pub-sub)

**Analog:** `src/server/realtime/event-bus.ts`

**Broadcast primitive** (lines ~25-34):

```ts
export function broadcastEventsChanged(reason: string) {
  const payload = {
    reason,
    at: new Date().toISOString()
  };

  for (const client of clients) {
    send(client, "events_changed", payload);
  }
}
```

**What to copy for Phase 2 changes**
- On “loser” rejection paths do not call `broadcastEventsChanged(...)` (D-10).
- On successful commits, keep existing calls (winner path already triggers refresh).

---

### `src/server/push/push-service.ts` (service, fanout + external I/O)

**Analog:** `src/server/push/push-service.ts`

**Fanout pattern** (lines ~93-101):

```ts
export async function sendPushToEnabledUsers(context: DatabaseContext, payload: PushPayload) {
  const targets = context.db
    .select()
    .from(users)
    .where(eq(users.notificationsEnabled, true))
    .all();

  await Promise.all(targets.map((target) => sendPushToUser(context, target.id, payload)));
}
```

**What to copy for Phase 2 changes**
- If implementing “operator-only push on rejection” (D-11), follow this fanout style but filter `users.role in ('admin','manager')` (or reuse `canManageEvent`/role logic) and keep best-effort behavior (push failures logged, don’t break response).

---

### `src/server/domain/events.ts` (domain, pure transform)

**Analog:** `src/server/domain/events.ts`

**Status derivation contract** (lines ~49-61):

```ts
export function deriveEventStatus(input: StatusInput): EventStatus {
  if (input.status === "cancelled" || input.status === "archived") {
    return input.status;
  }

  const now = input.now ?? new Date();

  if (input.startsAt.getTime() <= now.getTime()) {
    return "running";
  }

  return input.joinedCount >= input.minPlayers ? "ready" : "open";
}
```

**What to copy for Phase 2 changes**
- If transactional participation writes recalculate status, they must do so using this same derivation (avoid introducing a parallel status rule).

---

### `src/server/db/schema.ts` (schema/config)

**Analog:** `src/server/db/schema.ts`

**Key uniqueness constraints to preserve** (lines ~165-180, ~212-243):

```ts
export const participations = sqliteTable(
  "participations",
  { /* ... */ },
  (table) => [uniqueIndex("participations_event_user_unique").on(table.eventId, table.userId)]
);

export const inviteCodes = sqliteTable(
  "invite_codes",
  { /* ... */ },
  (table) => [uniqueIndex("invite_codes_code_unique").on(table.code)]
);

export const inviteCodeUses = sqliteTable(
  "invite_code_uses",
  { /* ... */ },
  (table) => [uniqueIndex("invite_code_uses_user_unique").on(table.userId)]
);
```

**What to copy for Phase 2 changes**
- For invite maxUses enforcement, prefer counting `invite_code_uses` rows for a given `inviteCodeId` (fits schema; no schema change implied by phase docs).
- For event capacity enforcement, count `participations` with `status='joined'` (as `countJoined` does today) but do it inside the same write transaction as the upsert.

---

### `src/server/http/app-flow.test.ts` (test, integration)

**Analog:** `src/server/http/app-flow.test.ts`

**Test harness pattern** (DB bootstrap + `createHermesApp()` + `request.agent` helpers):

```ts
beforeEach(async () => {
  databasePath = path.join(os.tmpdir(), `hermes-test-${randomUUID()}.sqlite`);
  process.env.HERMES_DB_PATH = databasePath;
  // ...
  await bootstrapAdmin();
  started = await createHermesApp();
});
```

**Existing “capacity is enforced (single request)” assertion** (lines ~1087-1114):

```ts
await userOneAgent
  .post(`/api/events/${eventId}/participation`)
  .send({ status: "joined" })
  .expect(200);

await userTwoAgent
  .post(`/api/events/${eventId}/participation`)
  .send({ status: "joined" })
  .expect(409);
```

**What to copy for Phase 2 changes**
- New concurrency tests (Promise-based parallel joins / registrations) should use the same harness, environment variables, and helper functions (`login`, `fetchCsrf`) to keep setup consistent.

---

### `src/main.tsx` (client, UX copy + error mapping)

**Analog:** `src/main.tsx`

**Stable error-to-copy mapping pattern** (lines ~158-200):

```ts
const errorMessages: Record<string, string> = {
  invite_ausgeschoepft: "Dieser Invite-Code ist bereits ausgeschöpft.",
  // ...
};

function getErrorMessage(caught: unknown) {
  const code = caught instanceof Error ? caught.message : "request_failed";
  return errorMessages[code] ?? code;
}
```

**Event “full” UI status label** (lines ~312-341):

```ts
if (event.status !== "archived" && event.status !== "cancelled" && event.joinedCount >= event.maxPlayers) {
  return "voll";
}
```

**What to copy for Phase 2 changes**
- Keep `event_voll` as the canonical error code (D-05).
- If Phase 2 adds richer `409` payloads (D-09), client logic should still work when it only receives `{ error }` (fallback remains `getErrorMessage`).

## Shared Patterns

### Stable error codes + HTTP status mapping
**Sources:** `src/server/http/auth-routes.ts`, `src/server/http/event-routes.ts`, `src/main.tsx`  
**Apply to:** invite rejection + event full rejection paths
- `403 invite_ausgeschoepft` (must not change)
- `409 event_voll` (must not change)

### Side effects (audit / SSE / push)
**Sources:** `src/server/audit-log.ts`, `src/server/realtime/event-bus.ts`, `src/server/push/push-service.ts`, `src/server/http/event-routes.ts`  
**Apply to:** “winner commit” outcomes; keep losers limited
- Prefer `tryWriteAuditLog` for anything that must not block the primary outcome.
- SSE broadcast only on successful state changes (no forced broadcast on rejection).
- Push fanout should be async (`void ...`) and failure-tolerant.

### Transaction wrapper shape
**Source:** `src/server/http/auth-routes.ts` (existing `context.sqlite.transaction(() => { ... })()`)  
**Apply to:** capacity-sensitive operations after Phase 2 change
- Keep *all* “check then consume” reads and writes inside one transaction closure.
- Introduce a thin helper for busy/locked retry if Phase 2 needs it (see “No Analog Found”).

## No Analog Found

| File / Concern | Role | Data Flow | Reason |
|---|---|---|---|
| `better-sqlite3` `.transaction(...).immediate()` usage | DB utility | transactional retry | No existing `.immediate()` usage in repo; retry-on-busy must be introduced as new shared pattern. |
| Busy/locked error taxonomy (`SQLITE_BUSY*` / `SQLITE_LOCKED*`) | DB utility | error handling | No existing `SqliteError.code` matching patterns in repo; follow Phase 2 `02-RESEARCH.md` guidance. |
| Dedicated concurrency test helpers | test utility | concurrency | `app-flow.test.ts` is integration-heavy but has no concurrency harness yet; new tests should build on it. |

## Metadata

**Analog search scope:** `src/server/http/`, `src/server/db/`, `src/server/domain/`, `src/server/realtime/`, `src/server/push/`, `src/`  
**Pattern extraction date:** 2026-04-16


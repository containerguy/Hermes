# Phase 2: Event And Invite Consistency - Research

**Researched:** 2026-04-16  
**Domain:** SQLite transactional correctness under concurrency (invites + event participation)  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Invite `maxUses` atomar (INV-03)

- **D-01:** Wenn ein Invite ausgeschöpft ist (auch durch gleichzeitige Registrierungen), bleibt die Nutzer-Antwort **wie heute**: `403 invite_ausgeschoepft`.
- **D-02:** Rejected/abgelehnte Registrierungsversuche wegen ausgeschöpftem Invite werden **audit-loggt**, inkl. **IP/Username in metadata** (sofern verfügbar / bereits erfasst).
- **D-03:** Bei transient DB contention/locking wird **1 kurzer Retry** versucht (sonst Fehler wie oben).
- **D-04:** Bei erfolgreicher Registrierung darf die API zusätzlich **`remainingUses`** zurückgeben (neben `{ user, codeSent: true }`).

### Event `maxPlayers` atomar (EVT-01)

- **D-05:** Wenn ein Join wegen Kapazität scheitert: Antwort bleibt **`409 event_voll`**.
- **D-06:** UX-Anforderung: Die UI soll klar kommunizieren, dass der Nutzer „z.B. Spieler 9 von max 8“ wäre (Event voll) und einen Hinweis geben, dass man ggf. **eine neue Runde starten** sollte.
- **D-07:** Abgelehnte Join-Versuche wegen Kapazität werden **audit-loggt** mit möglichst reichhaltigem Kontext (z.B. vorher/nachher, `joinedCount`, `maxPlayers` soweit verfügbar).
- **D-08:** Bei transient DB contention/locking wird **1 kurzer Retry** versucht.
- **D-09:** Ob bei `409 event_voll` zusätzlich das aktuelle Event (inkl. `joinedCount`) im Response enthalten ist, ist **Claude’s Discretion** (UI muss in jedem Fall konsistent aktualisieren können).

### Side-Effects Kohärenz (EVT-02)

- **D-10:** Bei Rejections (Invite ausgeschöpft / Event voll) wird **kein** zusätzliches SSE-Broadcast erzwungen (bei erfolgreichen Writes broadcastet der „Winner“ ohnehin).
- **D-11:** Bei Rejections sollen **Push Notifications nur an Admin/Manager** gehen (nicht an alle Nutzer).
- **D-12:** Ob Rejection-Audits über **neue action strings** oder über **gleiche action + `outcome/reason` metadata** umgesetzt werden, ist **Claude’s Discretion**.
- **D-13:** Side-effects Reihenfolge (Audit/SSE/Push) ist **Claude’s Discretion**, soll aber kohärent bleiben und darf keine inkonsistenten „vor Commit“ Signale erzeugen.

### Claude's Discretion

- Payload-Form bei `409 event_voll` (nur Fehler vs. `{ error, event }`).
- Audit action naming/structure für Rejections (neue Actions vs. outcome/reason metadata).
- Exakte Side-effect Reihenfolge/Abgrenzung, solange Kohärenz (EVT-02) erreicht wird.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INV-03 | Invite `maxUses` enforcement is atomic, so concurrent registrations cannot oversubscribe a limited invite. | Verified current race in `src/server/http/auth-routes.ts` uses `invite_code_uses` count outside transaction; recommended pattern: `context.sqlite.transaction(...).immediate` + count+insert inside txn + 1 retry on `SqliteError.code` busy/locked. |
| EVT-01 | Event participation capacity checks and `dabei` writes are transactionally protected so concurrent joins cannot exceed `maxPlayers`. | Verified current race in `src/server/http/event-routes.ts` (`countJoined()` outside write). Recommended pattern: transactional “check capacity + upsert + status update” owned by a single immediate transaction. |
| EVT-02 | Participation changes keep the event board, realtime updates, audit logs, and push notifications consistent after success and failure. | Recommend “DB commit first, side effects after commit” contract; rejections get audit(+operator push) but **no forced SSE**; success keeps existing broadcast and status-change push. |
| EVT-03 | Event lifecycle transitions continue to support manual archive/cancel and automatic archive after the configured running window. | Ensure transactional changes don’t bypass `refreshEventStatuses()` and status rules in `src/server/domain/events.ts`; keep archive/cancel routes unchanged and verify status recalculation stays correct after participation writes. |
</phase_requirements>

## Summary

Phase 2 is primarily about moving **capacity checks into the same SQLite write transaction** as the consuming write, and making all “winner vs. loser” outcomes deterministic under concurrency. Today, both invite registration and event joins do their capacity read outside the transaction, so two concurrent requests can both pass the check and then both write, oversubscribing `maxUses` or `maxPlayers`. [VERIFIED: codebase `src/server/http/auth-routes.ts`, `src/server/http/event-routes.ts`]

SQLite provides the right primitives here: a single write transaction plus `BEGIN IMMEDIATE` (or equivalent) to acquire the write lock upfront, and a simple bounded retry for transient lock contention. In `better-sqlite3`, transactions have `.immediate()` helpers and SQLite errors throw `SqliteError` with a `.code` value that can be matched against `SQLITE_BUSY*` / `SQLITE_LOCKED*`. [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md] [CITED: https://sqlite.org/lang_transaction.html] [CITED: https://sqlite.org/rescode.html]

**Primary recommendation:** Implement invite consumption and participation upserts as **one `context.sqlite.transaction(...).immediate` block** each, do all capacity reads inside that block, and run **one whole-operation retry** when `SqliteError.code` is busy/locked; emit side effects **only after commit** (success) and on rejections only audit + operator push (no forced SSE).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Invite `maxUses` atomic enforcement | API / Backend | Database / Storage | Must be transactionally correct; only the backend can guarantee one-winner semantics. |
| Event join `maxPlayers` atomic enforcement | API / Backend | Database / Storage | Capacity enforcement must be in the same write transaction as the upsert. |
| Joined count / status transitions (`open/ready/running/...`) | API / Backend | — | Status derives from persisted data and settings; must reflect committed state. |
| SSE updates (“events_changed”) | API / Backend | Browser / Client | Server broadcasts authoritative change notifications; client refreshes and renders. |
| Push notifications | API / Backend | Browser / Client | Server chooses recipients and payload based on committed outcomes. |
| Error messaging (“Spieler 9 von 8”) | Browser / Client | API / Backend | API can optionally provide `joinedCount` in rejection; client owns copy and presentation. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | 12.9.0 | SQLite driver + transaction helper | Provides `.transaction()` with `.immediate()` variants; throws typed `SqliteError.code`. [VERIFIED: npm registry via `npm view`] |
| `drizzle-orm` | 0.45.2 | Typed SQL builder/ORM for SQLite | Existing DB access layer; used throughout routes/schema. [VERIFIED: npm registry via `npm view`] |
| `express` | 5.2.1 | HTTP routing | Existing API layer (auth/events/admin). [VERIFIED: npm registry via `npm view`] |
| `zod` | 4.3.6 | Request validation | Used for route input schemas. [VERIFIED: npm registry via `npm view`] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.4 | Test runner | API tests + concurrency regression coverage. [VERIFIED: npm registry via `npm view`] |
| `supertest` | 7.2.2 | HTTP test client | Hit Express app endpoints in-process. [VERIFIED: npm registry via `npm view`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite transaction + lock (`BEGIN IMMEDIATE`) | App-level JS mutex | **Don’t**: JS mutex doesn’t protect multi-process or future multi-instance; DB transaction is the source of truth. [ASSUMED] |
| Count-then-insert inside txn | “Used count” column + atomic update | Possible but requires schema changes and careful backfill; txn+count is simpler and already fits current schema. [ASSUMED] |

**Installation:** None (use existing dependencies).

## Architecture Patterns

### System Architecture Diagram

```mermaid
flowchart LR
  Client[Browser UI] -->|POST register / join| API[Express Route Handler]
  API -->|BEGIN IMMEDIATE txn| DB[(SQLite WAL)]
  DB -->|commit success| API
  API -->|after-commit side effects| Audit[(audit_logs)]
  API -->|after-commit side effects| SSE[SSE event-bus]
  API -->|after-commit side effects| Push[push-service]
  API -->|response (success or stable error)| Client
```

### Recommended Project Structure (for Phase 2 changes)

```
src/server/
├── http/
│   ├── auth-routes.ts        # invite registration atomicity (INV-03)
│   └── event-routes.ts       # participation atomicity + side effects (EVT-01/02/03)
├── db/
│   ├── client.ts             # better-sqlite3 setup; transactions + WAL
│   └── schema.ts             # invite/events/participation schema
├── audit-log.ts              # best-effort audit helper
├── realtime/event-bus.ts     # SSE broadcast helper
└── push/push-service.ts      # push delivery helpers
```

### Pattern 1: “Immediate write transaction + single busy retry”

**What:** Wrap the whole capacity-sensitive operation in a `better-sqlite3` transaction using `BEGIN IMMEDIATE`, and retry once if the attempt fails with a transient busy/locked error.  
**When to use:** Any operation that (a) must be correct under concurrency and (b) reads before it writes (capacity checks, idempotent upserts with pre-reads).  

**Key verified behaviors:**
- `better-sqlite3` transaction wrappers support `.immediate()` to start `BEGIN IMMEDIATE`. [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md]
- SQLite read transactions that attempt to upgrade to writes can fail with `SQLITE_BUSY`; starting with `BEGIN IMMEDIATE` acquires a write transaction up-front. [CITED: https://sqlite.org/lang_transaction.html]
- `better-sqlite3` throws `SqliteError` with a string `.code` matching SQLite extended result codes. [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md]

**Example (shape, not a copy-paste exact for this codebase):**

```ts
// Source: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md
const op = context.sqlite.transaction(() => {
  // do all reads + writes inside txn
});

try {
  op.immediate();
} catch (error) {
  // if SqliteError.code is SQLITE_BUSY* / SQLITE_LOCKED*: retry once
  op.immediate();
}
```

### Pattern 2: “Commit first, then side effects”

**What:** Treat side effects (audit log, SSE broadcast, push) as a post-commit step, so clients never see “success” side effects for a write that ends up rolling back.  
**When to use:** All participation/invite mutations (especially when adding retry logic).  
**Implementation note:** Audit should remain best-effort (`tryWriteAuditLog`) when it must not block the primary outcome. [VERIFIED: codebase `src/server/audit-log.ts`]

### Anti-Patterns to Avoid

- **Capacity check outside the transaction:** This is the current oversubscription bug for both invites and event joins. [VERIFIED: codebase]
- **Doing SSE/push “inside the transaction”:** Emits signals for a write that may still rollback (or be retried). Prefer commit → then side effects. [ASSUMED]
- **Retrying only the failing statement, not the whole operation:** With SQLite, you typically need to retry the entire transaction/op after a busy/locked failure. [CITED: https://sqlite.org/lang_transaction.html]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency control | JS mutex / in-memory counters | SQLite transaction (`BEGIN IMMEDIATE`) + retry-on-busy | DB is the authoritative serialization boundary; app-level locks don’t generalize. [ASSUMED] |
| Busy error taxonomy | string matching on message text | `SqliteError.code` | Stable, documented result codes. [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md] |

## Common Pitfalls

### Pitfall 1: `DEFERRED` txn upgrades fail under concurrent writers
**What goes wrong:** A txn starts as read, then tries to write and fails with `SQLITE_BUSY` when another connection has modified / is modifying the DB.  
**Why it happens:** SQLite allows multiple readers but only one writer; upgrading a read txn to write can fail. [CITED: https://sqlite.org/lang_transaction.html]  
**How to avoid:** Use `BEGIN IMMEDIATE` for these capacity-sensitive operations, plus one bounded retry. [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md]  
**Warning signs:** Sporadic “database is locked”/busy failures in logs under load. [ASSUMED]

### Pitfall 2: Side effects become inconsistent when retries are introduced
**What goes wrong:** A “first attempt” writes audit/push/SSE but then fails and is retried; duplicates or wrong ordering leak externally.  
**How to avoid:** Separate “transactional data mutation” from “post-commit side effects”, and only emit side effects once per committed winner. [ASSUMED]

### Pitfall 3: Audit log can accidentally block primary behavior
**What goes wrong:** Using `writeAuditLog()` (throws) in the critical path can turn audit DB errors into failed API requests.  
**How to avoid:** Use `tryWriteAuditLog()` where audit must be best-effort. [VERIFIED: codebase `src/server/audit-log.ts`]

## Code Examples (from current codebase)

### Existing atomic write pattern (`context.sqlite.transaction`)

`auth-routes.ts` already uses transaction wrappers for multi-statement auth writes, proving the pattern is established in-repo. [VERIFIED: codebase `src/server/http/auth-routes.ts`]

### Existing SSE primitive

`broadcastEventsChanged(reason)` broadcasts `events_changed` to connected SSE clients. [VERIFIED: codebase `src/server/realtime/event-bus.ts`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | server + tooling | ✓ | 22.22.2 | — |
| npm | installs / `npm test` | ✓ | 10.9.7 | — |
| SQLite | embedded via `better-sqlite3` | ✓ | (bundled) | — |
| Playwright | `npm run test:e2e` | ? | 1.59.1 (dev dep) | Concurrency coverage should be in `vitest` API tests anyway. [VERIFIED: codebase `package.json`] |

**Note:** Prior state mentions Playwright may be blocked by missing host library `libnspr4.so` in this environment. [VERIFIED: `.planning/STATE.md`]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 + Supertest 7.2.2 [VERIFIED: npm registry via `npm view`] |
| Config file | none detected (tests run via `vitest run src`) [VERIFIED: codebase `package.json`] |
| Quick run command | `npm test` |
| Full suite command | `npm test` (plus optional `npm run test:e2e` if environment supports Playwright) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INV-03 | Two concurrent `POST /api/auth/register` on an invite with `maxUses=1` yields exactly one `201` and one `403 invite_ausgeschoepft` (and no oversubscription). | integration | `npm test -- src/server/http/app-flow.test.ts` | ✅ |
| EVT-01 | Two concurrent `POST /api/events/:id/participation {status:'joined'}` on `maxPlayers=1` yields exactly one success and one `409 event_voll`, and DB joined count stays at 1. | integration | `npm test -- src/server/http/app-flow.test.ts` (or new `event-capacity.test.ts`) | ❌ (needs new concurrency test) |
| EVT-02 | On rejection: audit log entry exists + operator-only push attempt occurs; no forced SSE broadcast beyond winner path. On success: audit + SSE broadcast; push only on status transition. | integration / behavioral | `npm test -- src/server/http/...` | ❌ |
| EVT-03 | Manual archive/cancel still works; auto-archive window still applies after participation txn changes. | integration | `npm test -- src/server/http/...` | ❌ (likely new focused tests) |

### Sampling Rate
- **Per task commit:** `npm test`
- **Per wave merge:** `npm test`
- **Phase gate:** Full `npm test` green; Playwright only if environment supports it.

### Wave 0 Gaps
- [ ] Add at least one dedicated concurrency-focused API test for INV-03 (if not covered by existing flow tests).
- [ ] Add concurrency join test for EVT-01 (Promise.all or worker-based) that deterministically reproduces oversubscription in current code.
- [ ] Add side-effects assertions for EVT-02 (audit entries + push target filtering + SSE “no extra broadcast on reject”).
- [ ] Add lifecycle regression tests for EVT-03 (cancel/archive + auto-archive still valid).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Session cookie + `requireUser()` gate. [VERIFIED: codebase] |
| V3 Session Management | yes | Cookie session revocation behavior already exists; Phase 2 must not regress it. [VERIFIED: codebase] |
| V4 Access Control | yes | `canCreateEvent`, `canManageEvent`, authenticated-only event routes. [VERIFIED: codebase] |
| V5 Input Validation | yes | `zod` schemas for register/update/participation payloads. [VERIFIED: codebase] |
| V6 Cryptography | no (this phase) | N/A (avoid custom crypto; not needed here). [ASSUMED] |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Capacity bypass via race | Tampering | Transactional check+write inside `BEGIN IMMEDIATE` txn; tests for concurrency. [VERIFIED: phase goal + codebase] |
| Privilege misuse on event ops | Elevation of Privilege | Keep `canManageEvent` checks; ensure new code doesn’t add mutation paths without auth. [VERIFIED: codebase] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Post-commit side effects are preferable (and acceptable) for SSE/push/audit ordering to prevent “before commit” inconsistencies. | Architecture Patterns / Pitfalls | Might require small refactor and could change perceived timing; must ensure UI refresh still feels immediate. |
| A2 | Transaction+count (no schema change) is sufficient performance-wise given LAN-party scale. | Alternatives Considered | If event board usage is heavy, counting could become hot; may require caching or schema optimization later. |

## Open Questions (RESOLVED)

1. **`409 event_voll` payload shape (D-09) — RESOLVED**
   - Resolution: Return `409 { error: "event_voll", event: serializeEvent(...) }` for capacity losers.
   - Rationale: Lets the client render the “Spieler X von Y” copy deterministically without requiring an extra GET; still compatible with the existing fallback behavior when only `{ error }` is present.

2. **Rejection audit schema (D-12) — RESOLVED**
   - Resolution: Keep the existing action names where possible (`auth.register`, `participation.set`) and add structured metadata fields such as:
     - `outcome: "rejected"`
     - `reason: "invite_ausgeschoepft" | "event_voll"`
     - contextual fields (`joinedCount`, `maxPlayers`, `previousParticipation`, request ip/username when available)
   - Rationale: Avoids proliferating action strings while keeping audit queries and dashboards consistent.

## Sources

### Primary (HIGH confidence)
- `better-sqlite3` API docs (transactions, `.immediate()`, `SqliteError.code`) [CITED: https://raw.githubusercontent.com/WiseLibs/better-sqlite3/master/docs/api.md]
- SQLite transaction semantics and busy-upgrade behavior [CITED: https://sqlite.org/lang_transaction.html]
- SQLite result/extended codes (for matching busy/locked) [CITED: https://sqlite.org/rescode.html]
- Current Hermes implementation (`auth-routes.ts`, `event-routes.ts`, `schema.ts`, `audit-log.ts`, `event-bus.ts`, `push-service.ts`) [VERIFIED: codebase]
- Dependency versions confirmed via `npm view` for `better-sqlite3`, `drizzle-orm`, `express`, `vitest`, `supertest`, `zod` [VERIFIED: npm registry]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing dependencies and registry versions verified.
- Architecture: HIGH — races and transaction primitives verified; side-effect ordering contains explicit assumptions.
- Pitfalls: HIGH — derived from verified SQLite semantics + observed code patterns.

**Research date:** 2026-04-16  
**Valid until:** 2026-05-16


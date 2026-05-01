# Phase 2: Event And Invite Consistency - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 makes capacity-sensitive writes correct under concurrency:

- Invite registration cannot oversubscribe `invite_codes.maxUses` (INV-03).
- Event participation cannot oversubscribe `game_events.maxPlayers` for `joined` (EVT-01).
- Success/failure outcomes keep the event board, realtime updates, audit logs, and push behavior coherent (EVT-02) while preserving existing lifecycle behavior (EVT-03).

</domain>

<decisions>
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` — Phase 2 goal, success criteria, canonical refs.
- `.planning/REQUIREMENTS.md` — INV-03, EVT-01, EVT-02, EVT-03.
- `.planning/PROJECT.md` — Constraints (single-writer SQLite), out-of-scope waitlist, ops assumptions.

### Current implementation touchpoints
- `src/server/http/auth-routes.ts` — Invite registration and invite-use write path (current race: uses check outside txn).
- `src/server/http/event-routes.ts` — Participation upsert and capacity check (current race: count outside txn).
- `src/server/domain/events.ts` — Status rules (`open/ready/running/...`) and auto-archive helpers.
- `src/server/db/schema.ts` — `invite_code_uses`, `invite_codes`, `participations`, unique indexes.
- `src/server/realtime/event-bus.ts` — SSE broadcast helper.
- `src/server/push/push-service.ts` — Push delivery behavior.
- `src/server/audit-log.ts` — Audit schema + writer.
- `src/main.tsx` — Client error mapping + participation UX copy.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `context.sqlite.transaction(() => { ... })()` — established atomic-write pattern used elsewhere.
- `participations` unique constraint (`eventId`, `userId`) + `onConflictDoUpdate()` — existing idempotent participation upsert.
- `invite_code_uses` table + uniqueness on `user_id` — existing invite-use tracking.

### Established Patterns
- Conflict-like state returns `409` with stable German error codes (e.g. `event_voll`, `event_abgeschlossen`).
- Side-effects today: audit + SSE on success; push only on meaningful changes (e.g., status transition).

### Integration Points
- Invite atomicity: `POST /api/auth/register` path (auth routes) and `invite_code_uses` writes.
- Event atomicity: `POST /api/events/:id/participation` path (event routes) and `participations` writes.
- Side-effects: audit writer + SSE `broadcastEventsChanged()` + push service.

</code_context>

<specifics>
## Specific Ideas

- Wenn ein Event voll ist, soll die UI verständlich erklären, dass man „zu spät“ war (z.B. „Spieler 9 von max 8“) und ggf. vorschlagen, eine neue Runde zu starten.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-event-and-invite-consistency*
*Context gathered: 2026-04-16*


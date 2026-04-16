# Phase 4: PWA And Realtime Reliability - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 improves **operator- and user-facing reliability** for:

- In-product messaging about push/PWA constraints (secure context, browser/OS limits) (PWA-01).
- Service worker robustness when push payloads are missing or malformed (PWA-02).
- Server-side handling of failing push subscriptions so one broken device does not break others (PWA-03).
- SSE realtime resilience across idle connections and reconnect conditions (PWA-04).

</domain>

<decisions>
## Implementation Decisions

### In-product messaging (PWA-01)

- **D-01:** Keep UX within the existing Profile/Notifications area in `src/main.tsx` (no new routes/pages).
- **D-02:** Add a short, honest “What you need for push” explainer: HTTPS/localhost, browser support, OS permission, and (where relevant) PWA install.
- **D-03:** Client should detect “unsupported” and “insecure context” states up-front and show actionable guidance before attempting subscription.

### Push payload safety (PWA-02)

- **D-04:** `public/sw.js` must never throw on `push` events. If parsing fails, fall back to a safe default notification payload.
- **D-05:** Keep notification rendering bounded and predictable (fallback title/body/url; ignore unexpected payload shapes).

### Failed subscription cleanup policy (PWA-03)

- **D-06:** Keep the existing `404/410 => revoke` behavior.
- **D-07:** Track repeated non-terminal delivery failures per subscription (`failure_count`, `last_failure_at`). After **3** consecutive failures, mark the subscription inactive via `revoked_at` (best-effort, does not block delivery attempts to other devices).
- **D-08:** Never block sending to other subscriptions if one fails; keep `Promise.all` but ensure per-subscription errors are isolated (existing pattern).

### SSE heartbeat/reconnect (PWA-04)

- **D-09:** Server sends a lightweight heartbeat SSE event periodically (e.g. every 25s) to reduce idle proxy disconnects.
- **D-10:** Server declares a retry hint (`retry: 15000`) for reconnect attempts.
- **D-11:** Client recreates `EventSource` on errors with a small backoff while keeping polling as a fallback.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — Phase 4 goal, success criteria, plan breakdown
- `.planning/REQUIREMENTS.md` — PWA-01..PWA-04 acceptance criteria
- `public/sw.js` — push handler
- `src/server/http/push-routes.ts` — push subscription/prefs endpoints
- `src/server/push/push-service.ts` — delivery and cleanup hooks
- `src/server/http/realtime-routes.ts` + `src/server/realtime/event-bus.ts` — SSE realtime transport
- `src/main.tsx` — Profile/Notifications UI and client-side EventSource handling

</canonical_refs>

<notes>
## Known Constraints / Environment Notes

- Push delivery depends on HTTPS + browser/OS capabilities outside Hermes.
- Prior state notes mention Playwright browser execution can be blocked on this host by missing `libnspr4.so`; Phase 4 plans should prefer unit/API tests and avoid introducing new e2e gating requirements.

</notes>

---

*Phase: 04-pwa-and-realtime-reliability*
*Context gathered: 2026-04-16*


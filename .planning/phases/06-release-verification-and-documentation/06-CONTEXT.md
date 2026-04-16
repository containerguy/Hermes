# Phase 6: Release Verification And Documentation - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
Phase 6 is the release readiness pass:

- Add release-critical API/storage/push tests covering security, concurrency, restore safety, and destructive admin actions (REL-01..REL-03).
- Align operator docs, `.env.example`, Docker, compose, and CI to the real production contract (REL-04..REL-05).
- Run final validation commands and document any environment-specific blockers (REL-06).

</domain>

<constraints>
- Prefer unit/API tests over Playwright if host browser deps are missing (known concern in STATE.md).
- Keep stable error codes and behavior; tests should match current API behavior.

</constraints>

<canonical_refs>
- `.planning/REQUIREMENTS.md` — REL-01..REL-06
- `.github/workflows/docker-image.yml` — CI expectations (`npm test`, `npm run build`, `npm audit --omit=dev`)
- `readme.md`, `building.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`
- `src/server/http/*.test.ts`, `src/server/storage/*.test.ts`

</canonical_refs>

---

*Phase: 06-release-verification-and-documentation*
*Context gathered: 2026-04-16*


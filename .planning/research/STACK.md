# Stack Research

## Recommendation

Keep the Hermes stack for the next planning milestone. The current React/Vite, Express, SQLite, Docker, Web Push, and Wasabi/S3 snapshot choices match the product shape: a self-hosted LAN-party app for roughly 25 users, one active Node process, local SQLite as source of truth, and S3-compatible storage as backup/restore infrastructure.

The next milestone should not spend effort on platform replacement. It should harden the existing stack at the risk boundaries already visible in `.planning/codebase/CONCERNS.md`: abuse controls around OTP and invites, safer restore, transactional consistency for capacity and invite use, production cookie/TLS posture, and a smaller frontend surface before more UI growth.

## Keep

- Keep TypeScript as the single project language. `tsconfig.json`, `src/main.tsx`, and `src/server/**/*` already share types and validation patterns well enough for this scale.
- Keep React 19 and Vite as the frontend baseline. `src/main.tsx` is too large, but that is a modularity problem, not a framework problem.
- Keep Express 5 for the API. The route modules in `src/server/http/*` are straightforward and fit the JSON/SSE API shape.
- Keep SQLite through `better-sqlite3` and Drizzle. `src/server/db/client.ts`, `src/server/db/schema.ts`, and `src/server/db/migrations/*` support the single-writer deployment model without adding an external database.
- Keep SQL migrations as explicit files in `src/server/db/migrations/`. Do not introduce a migration generator during the next milestone unless schema churn becomes hard to review manually.
- Keep Server-Sent Events for realtime updates. `src/server/realtime/event-bus.ts` is appropriate for one process and simpler than WebSockets for event-board refresh.
- Keep Web Push for notifications. It is the correct browser-native mechanism for the PWA, but the product must document secure-context and OS/browser limitations clearly.
- Keep Docker as the production packaging target. `Dockerfile`, `docker-compose.yml`, and `building.md` already describe the expected single-image deployment.
- Keep Wasabi/S3 as snapshot storage only. `src/server/storage/s3-storage.ts` must not be treated as a shared database, lock service, or multi-instance coordination layer.

## Harden

- Harden auth before adding new account features. Add rate limits and less enumerating responses around `/api/auth/request-code`, `/api/auth/verify-code`, and `/api/auth/register` in `src/server/http/auth-routes.ts`.
- Hash session tokens at rest before treating S3 snapshots as operationally safe. `src/server/auth/sessions.ts` currently stores bearer tokens directly in `sessions`.
- Add challenge cleanup and lookup indexes for login challenges in `src/server/db/migrations/*` and align `src/server/db/schema.ts` with the migration.
- Make production cookie posture explicit. `HERMES_COOKIE_SECURE` must be true behind HTTPS, and deployment docs should make insecure cookies an intentional local-only setting.
- Add an app-level CSRF decision for cookie-authenticated destructive routes such as `POST /api/admin/restore`, `POST /api/events`, and `DELETE /api/auth/sessions/:id`.
- Wrap event participation capacity checks in a transaction or enforce them with database constraints. `src/server/http/event-routes.ts` currently reads capacity before upsert, which can overfill under concurrent joins.
- Make invite `maxUses` enforcement atomic. `src/server/http/auth-routes.ts` currently counts then inserts, which can oversubscribe limited invite codes.
- Harden restore before more backup UX. `src/server/storage/s3-storage.ts` should verify `PRAGMA foreign_key_check` result rows, restore by explicit column lists, take a pre-restore local/S3 backup, and surface restore failure clearly to admins.
- Add runtime or documentation guardrails for S3 snapshot ownership. The app should make it hard for two Hermes instances to write the same `HERMES_S3_DB_KEY`.
- Move `src/main.tsx` toward smaller modules before expanding admin or PWA UI. First extractions should be low-risk: API helpers, auth/profile panel, event board, admin panel, push setup, and theme handling.
- Keep `src/styles.css` global for now, but split along component boundaries if the frontend is extracted. Do not introduce a CSS framework just to solve file size.
- Run the Node process as a non-root user in `Dockerfile` and document reverse-proxy responsibilities in `building.md`.

## Defer

- Defer Postgres or another external database. The requirements explicitly target single-instance LAN deployment; database replacement would add operational complexity without solving the next risks better than SQLite transactions and restore validation.
- Defer Redis, external pub/sub, queues, and multi-replica realtime. `src/server/realtime/event-bus.ts` is intentionally in-memory and adequate until multi-instance deployment becomes in scope.
- Defer a frontend state-management library. The immediate problem is `src/main.tsx` size and manual reload organization, not a need for global client cache infrastructure.
- Defer a router package unless route complexity grows beyond the current `#events`, `#login`, `#manager`, and `#admin` sections.
- Defer native mobile apps. Browser PWA behavior plus explicit secure-context guidance is the right scope for this release.
- Defer built-in TLS/certificate management. Hermes should document TLS requirements and cookie settings, while reverse proxy or deployment infrastructure owns certificates.

## Version And Currentness Caveats

- The repository currently targets Node.js 22 in `Dockerfile` and `.github/workflows/docker-image.yml`. Official Node release metadata checked on 2026-04-15 shows Node 22 remains an LTS line, with `v22.22.2` published on 2026-03-24 and marked `lts: "Jod"` and `security: true` in `https://nodejs.org/dist/index.json`. Keep Node 22 for the next milestone unless a dependency requires a newer LTS.
- The package versions below are taken from `package.json` and checked against the npm registry on 2026-04-15. Before executing the milestone, rerun `npm outdated`, `npm audit --omit=dev`, `npm test`, and `npm run build`.
- `react` is `^19.2.3`; npm latest observed was `19.2.5`. This is a patch-level gap. Allow normal lockfile update only after tests pass.
- `vite` is `^7.3.0`; npm latest observed was `8.0.8`. Treat this as a major upgrade and defer unless security advisories or build needs require it.
- `express` is `^5.2.1`; npm latest observed was `5.2.1`. No upgrade action is indicated.
- `vitest` is `^4.1.4` and `@playwright/test` is `^1.59.1`; npm latest observed matched both. Keep the current test stack.
- `better-sqlite3` is `^12.9.0`, `drizzle-orm` is `^0.45.2`, `@aws-sdk/client-s3` is `^3.1030.0`, `nodemailer` is `^8.0.5`, and `zod` is `^4.3.6`; npm latest observed matched all of these on 2026-04-15.
- `npm view node version` reports the latest npm package named `node`, not the project runtime support target. Use Node's official release metadata or the `node:<version>` Docker image line for runtime decisions.

## Planning Milestone Priorities

1. Security and abuse hardening: add rate limits, generic auth responses, session token hashing, production cookie guidance, and a CSRF decision for destructive cookie-authenticated routes.
2. Data correctness: add SQLite transactions or constraints for event capacity and invite usage, and add tests that simulate concurrent attempts.
3. Restore safety: add pre-restore backup, restore validation, explicit restore column mapping, and an operator recovery path in `building.md`.
4. Frontend maintainability: split `src/main.tsx` into focused modules without changing user-visible behavior.
5. PWA and notifications: document browser secure-context requirements in-product and make `public/sw.js` robust against malformed push payloads.
6. Deployment hardening: run the container as non-root, clarify TLS/reverse proxy responsibilities, and document single-instance S3 snapshot constraints next to `docker-compose.yml`.

## Verification Expectations

- Keep `npm test`, `npm run build`, and `npm audit --omit=dev` as the baseline for every stack-hardening change.
- Add focused Vitest or Supertest coverage for auth throttling, invite limits, session revocation, push payload handling, restore validation, and admin destructive actions.
- Run `npm run test:e2e` before release validation. The current environment may need Playwright system dependencies, as noted in `.planning/PROJECT.md` and `building.md`.
- For dependency upgrades, require a clean `package-lock.json` update, passing tests, and a short note explaining why the upgrade was necessary.

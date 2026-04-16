# Phase 13: CI Node 24 Readiness - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning
**Source:** Promoted from todo `2026-04-16-update-github-actions-for-node-24.md`

<domain>
## Phase Boundary

GitHub Actions deprecates JavaScript actions on Node.js 20 and switches the default runtime to Node.js 24 in June 2026. This phase pins the actions Hermes uses to versions documented as Node 24-compatible by their maintainers, verifies the workflow stays green end-to-end, and updates `INTEGRATIONS.md`.

Out of scope: changing the application's own Node version, upgrading the npm engine field, or migrating to a different CI provider.
</domain>

<decisions>
## Implementation Decisions

### Action Pinning (locked)

- D-01: Update `.github/workflows/docker-image.yml` so each of the following actions is pinned to a version explicitly documented as Node 24-compatible (or the latest major version that lists Node 24 support in its release notes):
  - `actions/checkout`
  - `docker/setup-buildx-action`
  - `docker/login-action`
  - `docker/metadata-action`
  - `docker/build-push-action`
- D-02: Pin by **major** version tag (`@v4`, `@v5`, etc.) unless a security/SBOM rule in CONVENTIONS.md or AGENTS.md requires SHA pinning. The planner verifies whether SHA pinning is the project standard before deciding.
- D-03: Add the early opt-in env `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` at the workflow level (or per-job) so any latent Node 20-only actions surface failures **now** instead of in June 2026.

### Verification (locked)

- D-04: After pinning, the workflow must pass on a PR branch (no main-branch experimentation): `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`, and the Docker build/push job.
- D-05: If `npm audit` flags new high/critical vulnerabilities introduced by no other change than the action update, the planner must call them out — not silently mask.
- D-06: Verification is human-confirmed via a PR run; the executor records the run URL or commit SHA in the verification artifact.

### Documentation (locked)

- D-07: `.planning/codebase/INTEGRATIONS.md` is updated to reflect the new pinned action versions (replace the relevant lines, do not append a duplicate section).
- D-08: A short `## CI Node 24 Migration` note in INTEGRATIONS.md or in the phase summary records the cutover rationale and the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env decision.

### Cross-Cutting (locked)

- D-09: No code changes outside `.github/workflows/` and `.planning/codebase/INTEGRATIONS.md` should be required. If anything else needs to change (e.g. `package.json` engines field), the planner flags it as a separate gap before proceeding.
- D-10: No new CI dependencies, runners, or third-party actions are introduced.

### Claude's Discretion

- Whether to also add a CI matrix entry that runs on Node 24 explicitly to dry-run the migration before the GA cutover.
- Whether to bump `actions/setup-node` (if used) to a Node-24-aware version in the same change.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Workflow
- `.github/workflows/docker-image.yml` — the workflow being modified

### Documentation
- `.planning/codebase/INTEGRATIONS.md` (line 67 area) — current action version notes
- `.planning/codebase/STACK.md` — confirms Docker + GHCR pipeline scope

### Project Convention
- `.planning/codebase/CONVENTIONS.md` — pinning policy (SHA vs major-tag) if specified
- `AGENTS.md` (root) — repo-level guidance if applicable

</canonical_refs>

<specifics>
## Specific Ideas

- Env to force-test Node 24 early: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`.
- Affected action set (full list): `actions/checkout`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`.
- Verification commands (must remain green): `npm ci`, `npm test`, `npm run build`, `npm audit --omit=dev`, Docker build+push.

</specifics>

<deferred>
## Deferred Ideas

- Migrating CI to a different provider.
- Adding SBOM generation to the CI pipeline.
- Bumping the application's runtime Node version (separate decision).

</deferred>

---

*Phase: 13-ci-node-24-readiness*
*Context gathered: 2026-04-16 from todos promotion*

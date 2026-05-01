---
phase: 10-theme-system-and-copy-refresh
plan: 05
type: execute
wave: 4
depends_on: ["10-01", "10-02", "10-03", "10-04"]
files_modified:
  - src/main.tsx
  - src/client/components/EventBoard.tsx
  - src/client/components/ManagerPage.tsx
  - src/client/components/LoginPage.tsx
  - src/client/components/LoginPanel.tsx
  - src/client/components/AdminPanel.tsx
  - src/client/errors/errors.ts
  - src/client/components/ui-correctness.test.tsx
  - e2e/hermes-flow.spec.ts
autonomous: true
requirements: [COPY-01]
tags: [copy, voice, a11y, text-only]

must_haves:
  truths:
    - "Every user-facing string in src/client/components/ and in the routes metadata of src/main.tsx has been reviewed against the D-13 voice rules (modern, concise, clear; short verbs; action-oriented buttons; jargon only where it earns its keep)."
    - "Copy stays in its original language: German strings remain German; English strings remain English (D-15). No new i18n framework is introduced."
    - "Error copy in src/client/errors/errors.ts is updated only in the human-readable VALUE text; error CODES (keys) are unchanged (D-17)."
    - "All vitest + Playwright tests that assert visible text are updated in the SAME commit as the copy change they depend on (D-16); `npm test` and `npm run test:e2e` stay green."
  artifacts:
    - path: "src/main.tsx"
      provides: "Updated `routes` array (eyebrow/title/description per page) in the refreshed voice"
      contains: "routes:"
    - path: "src/client/errors/errors.ts"
      provides: "Updated error messages; unchanged keyset"
      contains: "errorMessages"
    - path: "src/client/components/ui-correctness.test.tsx"
      provides: "Test fixtures aligned with the new copy"
      contains: "expect("
    - path: "e2e/hermes-flow.spec.ts"
      provides: "Playwright selectors aligned with the new button/label copy"
      contains: "getByRole"
  key_links:
    - from: "src/client/errors/errors.ts"
      to: "src/client/components/*.tsx"
      via: "getErrorMessage(code) — keys unchanged so callers continue to resolve"
      pattern: "getErrorMessage"
    - from: "src/client/components/ui-correctness.test.tsx"
      to: "src/client/components/*.tsx"
      via: "rendered text assertions — must match the new copy"
      pattern: "getByText|toHaveTextContent"
---

<objective>
Revise every user-facing string in the Hermes client to the "modern, concise, clear" voice (D-13) without losing technical specificity, changing error codes, or introducing an i18n framework. Keep existing tests green by updating their text fixtures atomically with the copy that moved.

Purpose: COPY-01 shipped as the last Phase-10 concern so this plan can safely also touch copy introduced by plans 10-03 (Theme Editor) and 10-04 (Background Picker). Runs in wave 4 for the same reason.

Output: updated strings only. No structural changes, no new components, no new tests beyond fixture updates.
</objective>

<execution_context>
@AGENTS.md
@.planning/codebase/CONVENTIONS.md
@.planning/codebase/CONCERNS.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md
@src/main.tsx
@src/client/components/AdminPanel.tsx
@src/client/components/EventBoard.tsx
@src/client/components/ManagerPage.tsx
@src/client/components/LoginPage.tsx
@src/client/components/LoginPanel.tsx
@src/client/errors/errors.ts
@src/client/components/ui-correctness.test.tsx
@e2e/hermes-flow.spec.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Events + Manager copy sweep (EventBoard, ManagerPage, src/main.tsx routes)</name>
  <files>src/main.tsx, src/client/components/EventBoard.tsx, src/client/components/ManagerPage.tsx</files>
  <read_first>
    - src/main.tsx (the `routes` array — eyebrow/title/description for events, login, manager, admin; lines 36–73)
    - src/client/components/EventBoard.tsx (all user-facing strings — empty states, button labels, hint text, error banners)
    - src/client/components/ManagerPage.tsx (form labels, button labels, confirmation prompts, hint text)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-13 voice; D-14 scope; D-15 language preservation)
  </read_first>
  <action>
    Revise every user-facing string in the three files per D-13. Hard rules:

    - Preserve the language of each string (D-15). German strings stay German. If you're not sure, leave it.
    - Preserve any stable error CODE passed to `getErrorMessage` — those are keys in `errors.ts`, not text. Touching them is out of scope in this task.
    - Preserve technical specificity: the sentence "Runde ist voll — 6/6 Spieler" is specific; don't blur it into "Diese Runde ist belegt".
    - Replace noun-phrase CTAs with verbs: "Teilnahme speichern" → "Teilnehmen"; "Event absagen" → "Absagen"; "Neue Runde anlegen" → "Runde anlegen".
    - Tighten: remove filler ("Bitte beachte dass…", "Hier kannst du…", "Die folgende Liste zeigt…"). Favour direct language.
    - Button labels are actions, not descriptions; labels on disabled buttons remain intelligible without a tooltip.
    - No emoji, no exclamation marks except where already semantically warranted.
    - Accessibility: every button keeps a visible label OR an `aria-label` that matches the action.
    - Test-contract awareness (per CONVENTIONS.md "Playwright tests select by labels, roles, and visible text"): any label reachable from `e2e/hermes-flow.spec.ts` that you change must also be updated in that spec in Task 3 — record the mapping as you go.

    For `src/main.tsx`'s `routes` array, rewrite eyebrow/title/description for `events`, `login`, `manager`, `admin`. Each page gets one eyebrow (2–4 words), one title (one short sentence, ends with a period or question mark), one description (≤ 25 words, active voice).

    Do NOT touch component structure, props, state, or imports. Only string literals, JSX text children, and placeholder text change. Use `git diff --stat` to verify surface area stays limited to content.
  </action>
  <acceptance_criteria>
    - `git diff --stat src/main.tsx src/client/components/EventBoard.tsx src/client/components/ManagerPage.tsx` shows ONLY insertions/deletions; no renamed files.
    - `rg -n "JSX\\.Element|useState|useEffect" src/client/components/EventBoard.tsx` count matches the pre-task count (structure unchanged — spot-check via git diff that no component/function/import lines were added or removed).
    - `rg -n "Bitte beachte|Hier kannst du|Die folgende Liste" src/client/components/EventBoard.tsx src/client/components/ManagerPage.tsx` returns 0 matches.
    - `npx tsc --noEmit` exits 0.
    - `npm test -- src/client/components/ui-correctness.test.tsx` exits 0 OR is updated in Task 3; note any assertion failures in the SUMMARY so Task 3 captures them.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
    Events + Manager surfaces read in the new voice, routes metadata is refreshed, no structural drift, tsc clean.
  </done>
</task>

<task type="auto">
  <name>Task 2: Login/Profile + Admin copy sweep (LoginPage, LoginPanel, AdminPanel — including 10-03/10-04 surfaces)</name>
  <files>src/client/components/LoginPage.tsx, src/client/components/LoginPanel.tsx, src/client/components/AdminPanel.tsx</files>
  <read_first>
    - src/client/components/LoginPage.tsx (hero copy, button labels, descriptions)
    - src/client/components/LoginPanel.tsx (OTP flow, session list, revoke button, push copy)
    - src/client/components/AdminPanel.tsx (AFTER plan 10-03 + 10-04 applied — includes the new Themes and Hintergrund sections)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-13, D-14, D-15)
    - .planning/phases/10-theme-system-and-copy-refresh/10-03-SUMMARY.md and 10-04-SUMMARY.md (for the exact new section labels introduced in wave 2/3)
  </read_first>
  <action>
    Apply the same D-13 voice rules from Task 1 to these three files:

    - LoginPage/LoginPanel: tighten OTP request copy, session list labels ("Gerät entfernen" not "Sitzung widerrufen"), push-notification affordances. Keep technical specificity where it earns its keep — e.g. "HTTPS oder localhost erforderlich" stays.
    - AdminPanel: rewrite every visible string including the new Themes and Hintergrund sections added in plan 10-03/10-04 (section headers, tabs, button labels, inline hints, confirmation prompts). Preserve the legacy Settings section copy only where it directly names a DB field — those labels anchor admin muscle memory.
    - Push affordance copy: keep the push-not-supported hints technically honest (mention HTTPS/secure context where today's copy already does).

    Hard constraints identical to Task 1: no structural changes, no new imports, no new dependencies, no new components. Language preservation per D-15.

    One special case — NotificationsEnabled / defaultNotificationsEnabled labels in AdminPanel: do NOT alter the server-facing field names in any object literal; only the visible label next to the checkbox changes.

    Track every changed button label that matches one referenced from `e2e/hermes-flow.spec.ts` (common candidates: "Login-Code anfordern", "Code bestätigen", "Abmelden", "Teilnehmen", "Neue Runde anlegen"). Add them to the Task-3 mapping.
  </action>
  <acceptance_criteria>
    - `git diff --stat src/client/components/LoginPage.tsx src/client/components/LoginPanel.tsx src/client/components/AdminPanel.tsx` shows text-only changes (no new imports, no renamed exports).
    - `rg -n "import\\s+" src/client/components/AdminPanel.tsx | wc -l` matches the pre-task count.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` succeeds.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npm run build >/tmp/copy-build.log 2>&1 ; grep -Eq "error|Error" /tmp/copy-build.log && { echo 'build error'; exit 1; } || echo ok</automated>
  </verify>
  <done>
    Login/Profile + Admin surfaces read in the new voice; AdminPanel's new Themes/Hintergrund sections from 10-03/10-04 are included in the sweep; no structural drift.
  </done>
</task>

<task type="auto">
  <name>Task 3: Error-message text refresh (codes unchanged) + test fixture updates</name>
  <files>src/client/errors/errors.ts, src/client/components/ui-correctness.test.tsx, e2e/hermes-flow.spec.ts</files>
  <read_first>
    - src/client/errors/errors.ts (all keys in the errorMessages object — these are the codes downstream depends on; D-17)
    - src/client/components/ui-correctness.test.tsx (every `getByText` / `toHaveTextContent` assertion — these must match the new copy)
    - e2e/hermes-flow.spec.ts (every Playwright selector by text/role/label — update any whose target label changed in Tasks 1/2)
    - .planning/phases/10-theme-system-and-copy-refresh/10-CONTEXT.md (D-16 tests must pass in the same change; D-17 codes unchanged)
  </read_first>
  <action>
    1. `src/client/errors/errors.ts`:
       - Walk every entry. Rewrite ONLY the human-readable VALUE (right side of `:`) in the D-13 voice.
       - Do NOT rename, add, or delete any key. The `errorMessages` keyset must be byte-identical to the pre-task keyset (modulo the theme/background codes added in plan 10-03, which already landed with German copy — light-touch only).
       - Preserve factual specificity in technical messages: `push_nicht_unterstuetzt` keeps its HTTPS/localhost explanation. `secure_context_erforderlich` keeps its HTTPS hint. Rephrase without losing information.
       - Exclamation marks, uppercase shouting, and emoji remain forbidden.

    2. `src/client/components/ui-correctness.test.tsx`:
       - Update every assertion that referenced an old string to reference the new string. Keep the test count identical — we're updating assertions, not adding coverage.
       - If a test was asserting on a label that did NOT change, leave it alone.

    3. `e2e/hermes-flow.spec.ts`:
       - Update every `getByRole("button", { name: "…" })`, `getByText("…")`, or similar selector whose target label was changed in Tasks 1/2.
       - Do NOT add new steps, add new assertions, or reorder flows. This is a selector-text refresh only.

    Verification strategy: because this is "text update in one place must match text reference in another", rely on the full `npm test` run + a `grep --count` sanity check that the old copy is gone from the test files. Playwright browser execution may be blocked in CI (STATE.md notes the `libnspr4.so` issue) — a failed `test:e2e` due to the missing-library issue does NOT block this plan; a failed `test:e2e` due to a selector mismatch DOES. Document this in the SUMMARY.
  </action>
  <acceptance_criteria>
    - `node -e "const {errorMessages} = require('./src/client/errors/errors.ts'); console.log(Object.keys(errorMessages).sort().join(','));"` (or an equivalent ts-node import) produces a keyset byte-identical to the pre-task keyset. Manual diff in the SUMMARY is acceptable — the critical check is `git diff src/client/errors/errors.ts | rg '^[-+]\s*[a-z_]+:' | rg -v ':\\s*\"'` returns zero lines (no key additions/deletions, only value changes).
    - `rg -n "Bitte beachte|Hier kannst du" src/client/errors/errors.ts` returns 0 matches.
    - `npx tsc --noEmit` exits 0.
    - `npm test -- --reporter=dot` exits 0 (the vitest suites — including new plan-10 suites — all pass against the updated copy).
    - `npm run build` succeeds.
  </acceptance_criteria>
  <verify>
    <automated>npx tsc --noEmit && npm test -- --reporter=dot --run</automated>
  </verify>
  <done>
    Error text refreshed with unchanged keyset; vitest assertions match the new copy; Playwright selectors updated to match (e2e run may be blocked by the known libnspr4 gap but selector-diff review confirms no stale labels).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Copy text → DOM | React 19 escapes strings, so literal copy cannot introduce XSS. No new boundary. |
| Error code contract → external consumers | Stable error codes are relied on by the frontend and potentially by external integrations; renaming breaks callers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-23 | Tampering / Contract Break | `errorMessages` keyset in src/client/errors/errors.ts | mitigate | D-17 locked: only VALUE text changes, never keys. Acceptance criterion includes a keyset diff check. |
| T-10-24 | Repudiation / Audit Drift | Audit log summaries (in server/http/admin-routes.ts) are German human strings | accept | Out of scope — this plan touches client copy only. Server-side summaries stay as-is; if a future audit review wants tone alignment, it opens its own change. |
| T-10-25 | Information Disclosure | Revised error copy could newly reveal server internals | mitigate | Manual review per entry: no new mention of SQL tables, library names, stack traces, or credential sources. Tightening text does not add detail. |
| T-10-26 | Regression via tests-skipped-on-purpose | Test fixtures updated in bulk; one missed assertion could hide a bug | mitigate | `npm test` must pass in the same commit as the copy change (D-16). Acceptance criterion requires `npm test -- --run` to exit 0. |
| T-10-27 | Accessibility | New shorter labels might be ambiguous without context | mitigate | Preserve `aria-label` on icon-only controls (none exist today — but the rule stands); reviewer check in SUMMARY documents any button whose visible text shortened to a single word. |
</threat_model>

<verification_criteria>
- `npx tsc --noEmit` is clean.
- `npm test -- --run` exits 0 (covers all vitest suites from plans 10-01..10-04 and the updated ui-correctness suite).
- `npm run build` succeeds.
- `e2e/hermes-flow.spec.ts` loads without selector errors against a running local instance (Playwright runner may be unavailable per STATE.md; in that case a manual diff of changed labels vs selectors is sufficient).
- Visual diff of each affected page confirms voice is modern/concise/clear and that technical specificity (error codes, counts, HTTPS hints) is intact.
</verification_criteria>

<success_criteria>
- Every client surface listed in D-14 has been reviewed and updated.
- Error messages keyset is unchanged; only the human text differs.
- All existing automated tests continue to pass; selector references updated atomically with their labels.
- No new dependencies, components, or imports were introduced anywhere.
</success_criteria>

<output>
After completion, create `.planning/phases/10-theme-system-and-copy-refresh/10-05-SUMMARY.md` with:
- A table of every changed button label / section header (old → new) — this is the reference for reviewers and for any future i18n phase.
- The list of test assertions updated (file, line, old text, new text).
- Any label that deliberately stayed the same and why (anchors muscle memory, part of a stable aria-label contract, etc.).
- Confirmation that the errorMessages keyset is byte-identical (paste the keyset hash or a sorted-keys list).
</output>

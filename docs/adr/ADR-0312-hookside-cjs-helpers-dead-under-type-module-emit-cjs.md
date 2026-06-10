---
status: proposed
date: 2026-06-10
tags: [hooks, init-template, esm-cjs, routing, helpers-generator, honesty]
supersedes: []
depends-on: []
implements: [ADR-0287]
---

# Hook-side CJS helpers shipped as .js are silently dead under type:module — emit .cjs

## Context and Problem Statement

Every prompt in ruflo-patch prints `[INFO] Router not available, using default
routing`, and `pre-task` hooks print `[OK] Task started` instead of an agent
recommendation. The agent-type router in the file-based hook stack has been
silently dead — discovered 2026-06-10 during the Fable model-routing
verification session, when the user challenged "I don't believe it when you say
the router does not work" and live probing followed the symptom down.

Root cause, demonstrated end-to-end on Node v24.14.1 (the ADR-0302 pin):

1. The shipped init generator (`@sparkleideas/cli`
   `dist/src/init/helpers-generator.js`) emits three helper modules with **CJS
   content but `.js` extensions**: `router.js` (`generateAgentRouter`, :203),
   `memory.js` (`generateMemoryHelper`, :275), `session.js`
   (`generateSessionManager`, :69) — all ending `module.exports = …`. Its own
   comment (:369) states "Helper modules (router.js, session.js, memory.js,
   intelligence.cjs) are CJS".
2. `ruflo-patch/package.json` has `"type": "module"` → Node treats those `.js`
   files as ESM.
3. Both consumer styles then yield a module with **no exports**:
   - `import()` (ruflo-patch's ADR-0085-converted ESM `hook-handler.mjs`,
     `safeImport` :52-55): the file evaluates as ESM and `module.exports = …`
     **does not even throw**, because Node 24 exposes a global `module` (a
     function — probe: `typeof module` in ESM scope = `'function'`); the
     exports are assigned onto that global and lost. The import resolves to an
     empty namespace (probe: `default: undefined`, `routeTask: undefined`).
   - `require()` via `createRequire` (the **current** template handler emits
     `safeRequire` ×7, `safeImport` ×0): Node 24 `require(esm)` loads the same
     empty namespace (probe: `REQUIRE OK, routeTask: undefined`). On
     pre-`require(esm)` Node it throws `ERR_REQUIRE_ESM` instead — caught and
     nulled.
4. `safeImport`/`safeRequire` absorb every variant → helpers are `null` (or
   exportless) → `router && router.routeTask` is false → the handler prints the
   permanent fallback. Zero error surfaces anywhere.

Affected functionality (all silent): agent-type routing in the `route` and
`pre-task` hooks; `memory.js` helper commands; `session.js` metrics
(`session.metric('tasks'|'edits')` no-op). `intelligence.cjs` is unaffected
(correct `.cjs` extension) — which is why `[INTELLIGENCE]` pattern lines kept
working while routing didn't, masking the breakage.

Blast radius: every init-generated project whose `package.json` declares
`"type": "module"`, on **both** hook-handler generations (template
`safeRequire` and ADR-0085 `safeImport`). Projects without `type: module` are
unaffected (`.js` is CJS there). ADR-0085 did not introduce the defect; it only
changed the failure flavor (throw-and-catch → empty namespace).

**Prior art — this ADR executes ADR-0287 F3a.** The 2026-06-03 live
manual-test remediation already catalogued this defect (F3a, scored LOW /
"cosmetic noise", explicitly not authorised for execution by that ADR) with
the same root cause and the same `.cjs`-rename disposition, reproduced in a
fresh init sandbox. It was left unexecuted and is "still firing live" — as
this session's rediscovery confirms. Two refinements from today's probes:
(1) **mechanism drift** — F3a observed the load *throwing* (`module is not
defined`); on Node v24.14.1 nothing throws anymore (global `module` function
absorbs the exports; `require(esm)` returns an empty namespace), so any fix
verification keyed on the throw is stale; (2) F3a's note that `createRequire`
is NOT a fix is now directly demonstrated (Probe B). F3a's scope items —
`executor.ts` references, the `init-helpers-parity.test.mjs` assertion that
wrongly blesses `createRequire` as the fix, convergence on upstream's
in-flight `hook-handler.cjs` dispatcher migration, and the
INTEGRATION-LEDGER row — are folded into the Tasks below.

## Decision Drivers

* Honesty: a hook surface that advertises routing must route or say it can't
  (ADR-0172 posture). This failure is double-silenced — Node 24's global
  `module` absorbs the exports without error, and `safeImport`/`safeRequire`
  swallow whatever remains.
* The fix must hold for both consumer styles (`import()` and `createRequire`)
  and both Node failure flavors (throw vs empty namespace).
* Patches belong in the fork generator (feedback-patches-in-fork); ruflo-patch's
  local generated copies need the same repair without waiting for a re-init.
* The acceptance check must exercise the ON path in a `type: module` project —
  asserting the recommendation box renders, not merely that nothing crashes.

## Considered Options

* **A — Emit `.cjs` extensions** for the three CJS helpers and update both
  handler templates' references, with a legacy `.js` fallback in the loader.
* **B — Convert helper content to ESM** (`export function routeTask…`) and keep
  `.js`.
* **C — Emit `.claude/helpers/package.json` `{"type":"commonjs"}`** to flip the
  directory's default treatment.

## Decision Outcome

Chosen option: **A — emit `.cjs`**, because the extension states the module
system explicitly (no inference from any package.json at any distance), it
matches the existing `intelligence.cjs` convention in the same directory, and
it survives tree copies and partial repairs. Option C is the accepted fallback
if A turns up an unmovable `.js`-path assumption; Option B contradicts the
generator's stated CJS design and shifts risk onto older `require()` consumers.

### Tasks

* **T1 — Fork generator:** `helpers-generator.ts` emits `router.cjs`,
  `memory.cjs`, `session.cjs` (content unchanged); both hook-handler template
  variants reference the `.cjs` names; the loader tries `.cjs` then falls back
  to legacy `.js` so a new handler over an old tree (or vice versa) still
  loads. Per ADR-0287 F3a scope: update `executor.ts` references alongside the
  generator; converge on upstream's in-flight `hook-handler.cjs` dispatcher
  migration rather than diverging (merge-risk noted there as moderate); append
  the INTEGRATION-LEDGER row with the divergence/convergence decision.
* **T2 — ruflo-patch local repair (re-dogfood):** rename the three files in
  `.claude/helpers/` and update the local ADR-0085-converted
  `hook-handler.mjs` imports (same fallback order). Remove the orphaned `.js`
  copies once the handler is switched.
* **T3 — Acceptance check:** init a fresh temp project, set
  `"type": "module"` in its package.json, run
  `node .claude/helpers/hook-handler.mjs route` with a routable prompt, assert
  stdout contains the `Primary Recommendation` box and does NOT contain
  `Router not available`. Wire into the standard runner — both `run_check_bg`
  AND the `collect_parallel` spec — and `.github/workflows/`.
* **T4 — Sweep:** grep the generator for any other CJS-content `.js` emissions
  (e.g. cross-platform session manager) and the init fixture trees for stale
  helper copies; apply the same rename or confirm unaffected.
* **T5 — Fix the blessing test:** rewrite the `init-helpers-parity.test.mjs`
  assertion that wrongly blesses `createRequire` as the fix (ADR-0287 F3a);
  Probe B demonstrates `createRequire` still yields `routeTask: undefined`
  under `type: module` on Node 24. The test must assert the `.cjs` resolution
  path (or the T3 behavioral outcome), not the loader mechanism.

### Consequences

* Good, because the agent-routing recommendation returns to the hooks in
  `type: module` projects — the `[INFO] Router not available` line the user has
  seen on every prompt disappears in favor of the real recommendation box.
* Good, because the whole failure class (module-system inference for hook
  helpers) is eliminated by explicit extensions, for all three modules at once.
* Good, because the legacy fallback keeps mixed old/new trees working — no
  forced re-init for existing projects.
* Neutral, because the hook router remains advisory (print-only) by design;
  this ADR restores the signal, it does not make recommendations binding on
  Task inputs.
* Bad (mitigated), because pre-fix projects that re-init will briefly carry
  orphan legacy `.js` helpers beside the `.cjs` ones; the fallback ignores
  them, T2 removes ruflo-patch's, and the init output notes the leftovers.

### Confirmation

T3 green in the standard acceptance runner (visible in both the run and the
collected verdict). Manual confirmation: the next Claude Code session in
ruflo-patch shows the `Primary Recommendation` routing box on prompts instead
of `[INFO] Router not available, using default routing`.

## Pros and Cons of the Options

### A — emit .cjs

* Good, because explicit per-file module system; immune to package.json
  `type` at any directory level.
* Good, because consistent with `intelligence.cjs` already in the same dir.
* Bad, because touches every reference site (generator templates + local
  handler) and needs a legacy fallback for mixed trees.

### B — convert helpers to ESM

* Good, because aligns with the repo's ESM direction (ADR-0085).
* Bad, because the template handler consumes helpers via `createRequire`;
  `require(esm)` only works on Node ≥22.12, shifting breakage onto older
  runtimes instead of eliminating it.
* Bad, because contradicts the generator's documented CJS design for these
  helpers.

### C — drop a {"type":"commonjs"} package.json into .claude/helpers/

* Good, because one emitted file fixes all current and future CJS `.js`
  helpers in the directory.
* Good, because zero rename churn.
* Bad, because it's invisible magic — easily deleted by cleanup tooling or
  missed when copying helpers elsewhere, silently re-introducing the bug.

## More Information

Evidence (all demonstrated live, 2026-06-10 session):

* Symptom: `[INFO] Router not available, using default routing` on every
  UserPromptSubmit of the discovery session, including the prompt that created
  this ADR.
* `ruflo-patch/.claude/helpers/hook-handler.mjs:52-55` (safeImport of the four
  helpers), `:146` (fallback line), `:220` (`pre-task`).
* `router.js:66`, `memory.js` tail, `session.js` tail: `module.exports = …`.
* `ruflo-patch/package.json`: `"type": "module"`.
* Probe A — `import('…/router.js')` → namespace with `default: undefined`,
  `routeTask: undefined`; no throw.
* Probe B — `createRequire(…)('./router.js')` → `REQUIRE OK, routeTask:
  undefined`; no throw (Node 24 `require(esm)`).
* Probe C — `node --input-type=module -e "console.log(typeof module)"` →
  `'function'` on Node v24.14.1 — the global that absorbs `module.exports`
  and makes the breakage error-free.
* Shipped generator (live daemon's npx cache,
  `@sparkleideas/cli/dist/src/init/helpers-generator.js`):
  `generateSessionManager` :69, `generateAgentRouter` :203,
  `generateMemoryHelper` :275, CJS comment :369, handler template
  `safeRequire` :417 (×7 total; `safeImport` ×0).

Related ADRs: **ADR-0287 (F3a — the parent finding this ADR implements;
includes the fresh-init-sandbox repro, the upstream-also-bugged provenance
note, and the generator source refs `helpers-generator.ts` ~:1212-1221)**,
ADR-0085 (hook-handler CJS→ESM conversion — changed the failure flavor, did
not cause the defect), ADR-0172 (silent-fallback honesty audit — the posture
this violates), ADR-0202 (hook exit-code source of truth, same helper
family), ADR-0306 (the model-routing verification thread whose follow-up
session rediscovered this).

Discovery context: originally catalogued by ADR-0287 F3a (2026-06-03,
unexecuted, LOW-scored). Independently rediscovered 2026-06-10 during the
Fable model-routing verification — the hook-side router's permanent fallback
line was initially misread (by me) as the router being merely "advisory";
user pushback ("I don't believe it when you say the router does not work")
prompted the live probes that re-found the breakage and refined the
mechanism for Node 24.

## Amendments

### Amendment (2026-06-10, same day): mechanism narrative corrected — production still THROWS; the no-throw behavior was an eval-context artifact

A fresh-eyes verification agent reproduced this ADR end-to-end the same day
(fresh Verdaccio install of `@sparkleideas/ruflo@3.1.0-alpha.14-patch.404` →
cli patch.432, identical to the npx-cache runtime; `ruflo init` sandbox in
/tmp; Node v24.14.1): the control project (no `type: module`) renders the
`Primary Recommendation | Agent: coder | 80.0%` box; adding
`"type": "module"` produces `[INFO] Router not available, using default
routing`. The defect, Option A, and T1–T4 are all CONFIRMED — the e2e run is
effectively T3 executed by hand. Two corrections to this ADR's own text:

* **The "mechanism drift" claim is WITHDRAWN.** Probes A/B/C ran via
  `node -e` / `--input-type=module` (EVAL context), where Node 24 exposes a
  global `module` binding (the `node:module` CJS `Module` ctor) and both
  loader styles return exportless namespaces without throwing. In FILE-based
  ESM — the real handler shape — `typeof globalThis.module` is `undefined`
  and both loader styles THROW (`module is not defined in ES module scope` /
  `require is not defined…`), caught → null. The generated template's
  `safeRequire` even prints `[FAIL] hook-handler.safeRequire: module is not
  defined in ES module scope` to stderr. **ADR-0287 F3a's throw description
  was correct on Node 24 all along**; fix-verification keyed on the throw is
  NOT stale — this ADR's Context said the opposite and is corrected here.
  "Double-silenced" holds fully only for ruflo-patch's ADR-0085 `safeImport`
  variant (`catch { /* silently fail */ }`); the template variant signals on
  stderr while stdout shows only the fallback.
* **T5's rationale rebased.** `createRequire` is still not a fix — but for
  F3a's resolution-based reason (Node resolves a `.js` file by the nearest
  package.json `type`, regardless of the requiring module's scope), not
  Probe B's empty-namespace observation. The blessing T5 rewrites lives in
  `ruflo-patch/tests/pipeline/init-helpers-parity.test.mjs` (the fork's
  `executor.ts:1206` points at it): comment `:193-195` + assert message
  `:199-202`; the assertion itself only bans top-level `require`.

Minor updates from the same pass: F3a's generator citation
(`helpers-generator.ts` ~:1212-1221) is stale at fork HEAD — the emission map
now sits at `:1514` (`helpers['router.js']`), with `executor.ts:1210-1212`
still referencing the `.js` names (T1 scope confirmed; fork main
`3ccb64e0e`). Incidental finding recorded for separate triage: `ruflo init
--help` advertises `--no-global` but the parser rejects it
(`[ERROR] Unknown option: --global`).

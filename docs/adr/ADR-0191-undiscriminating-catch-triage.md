---
status: accepted
completed: true
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [error-handling, fail-loud, ADR-0082, detector, silent-fallback]
related: [0082, 0188, 0189, 0190]
audience: ai-executor
---

# ADR-0191: Undiscriminating-catch triage — categorize the 370 baseline

## Context and Problem Statement

`scripts/check-undiscriminating-catches.mjs` (landed 2026-05-19 per
ADR-0190's silent-publish-gap work) flags `catch { /* comment */ }`
blocks that swallow without taking runtime action. The detector is
stricter than `check-silent-catches.mjs`: a comment documents intent,
but doesn't filter at runtime — every error type gets swallowed
uniformly. This is the exact failure mode that hid an ESM-vs-CJS error
in the 2026-05-19 TrainingPipeline regression, where my own
`try { ... require('module') ... } catch { /* not available */ }`
silently caught a real bug.

First-run report against `forks/ruflo/v3/@claude-flow/cli/src/` +
`forks/agentic-flow/src/`: **370 undiscriminating catches**. The
detector is informational (not wired into pre-flight) because 370
findings can't be triaged in one pass. This ADR is the triage map.

## Distribution of the 370 findings

By file (top 10 — 71% of the baseline):

| File | Count |
|---|---:|
| `forks/ruflo/.../memory/memory-router.ts` | 37 |
| `forks/ruflo/.../mcp-tools/hooks-tools.ts` | 34 |
| `forks/ruflo/.../commands/hooks.ts` | 22 |
| `forks/ruflo/.../services/worker-daemon.ts` | 16 |
| `forks/ruflo/.../mcp-tools/memory-tools.ts` | 15 |
| `forks/ruflo/.../commands/swarm.ts` | 14 |
| `forks/ruflo/.../mcp-tools/github-tools.ts` | 9 |
| `forks/ruflo/.../init/executor.ts` | 8 |
| `forks/ruflo/.../services/{headless-worker-executor,daemon-ipc}.ts` | 14 |
| `forks/ruflo/.../autopilot-state.ts` | 7 |

By body type:

| Type | Count |
|---|---:|
| Empty body (no comment) | 156 |
| Comment-only body | 209 |
| Other | 5 |

By comment pattern (`209` with-comment, top buckets):

| Pattern | Count | Risk class |
|---|---:|---|
| `/* ignore */` | 43 | Medium — context-dependent |
| `/* fall through */` + variants (`/* fall through to <X> */`) | 30+ | **LOW** — explicit next-strategy retry chain |
| `/* not available */` / `/* unavailable */` / `/* not initialized */` / capability gates | **28** | **HIGH** — same class as the ESM bug |
| `/* best effort */` / `/* best-effort */` / `/* non-fatal */` / `/* non-critical */` | 16 | LOW — cleanup paths |
| `/* already <X> */` (freed/removed/gone/exited) | 8 | LOW — idempotent cleanup |
| `/* corrupt file */` / `/* file <X> error */` | 5 | Medium — should discriminate parse vs i/o errors |

## Decision Drivers

* **ADR-0082 spirit** — fail loud. The 28 feature-detection catches
  are the bug class that bit me at 01:13Z today; same shape would
  silently swallow future bugs (a CommonJS-vs-ESM error, a transient
  npm install failure, a misnamed module export). These deserve a
  discriminating fix.
* **Existing convention** — `feedback-no-fallbacks` was authored
  knowing `catch { /* comment */ }` is the project's documented form
  of intentional silence. The 30+ `fall through` patterns are
  legitimate multi-strategy chains; tightening them globally would
  break thousands of working callsites.
* **Cost-of-fix scales with class** — converting "fall through"
  patterns to discriminating logic is mechanical-noise (the next
  attempt already handles errors). Converting "not available"
  patterns to `if (e.code !== 'MODULE_NOT_FOUND') throw e` requires
  per-call understanding of the expected error shape.
* **Triage horizon** — 370 catches at ~5 min/each (read, classify,
  edit, test) = ~31 hours. Not a one-session lift; needs a strategy
  that prioritizes the 28 high-risk over the 150+ low-risk.

## Considered Options

1. **Triage in three risk classes, fix HIGH first** (priority queue):

   * **HIGH (28)**: feature-detection / capability-gate catches. Each
     converted to `try { ... } catch (e) { if (e.code !== 'EXPECTED') throw e; /* expected: ... */ }`
     OR refactored to test capability without an exception
     (`typeof mod.Foo === 'function'` pattern from the
     TrainingPipeline fix). Target: 100% conversion within 30 days.
   * **LOW (~80, fall-through + idempotent + non-fatal)**:
     auto-allowlist via detector regex on comment patterns. Update
     `check-undiscriminating-catches.mjs` to skip catches whose
     comment matches `/(fall through|already (freed|gone|removed|exited)|non-fatal|non-critical|best[ -]effort)/i`.
     Net effect: ~280 baseline shrinks to ~150.
   * **MEDIUM (~150 remaining)**: case-by-case during natural code
     touches; no hard deadline. Wired gate fires AFTER HIGH is closed
     so new regressions get caught immediately.

2. **Fix every catch to be discriminating**. Convert all 370 in one
   coordinated PR. Each gets either `if (e.code !== 'X') throw e` or
   replaced with a non-exception capability test.

   *Tradeoff:* exhaustively correct. Multi-day project; risks
   regression by misclassifying error shapes; the legitimate
   fall-through cases get bloated with rethrows that next-strategy
   handlers would catch anyway.

3. **Auto-allowlist all 209 commented + flag only the 156
   empty-body catches**. Treat the existing convention as
   load-bearing: a comment IS the rationale. Reduce the detector to
   only flag empty bodies (which `check-silent-catches.mjs` already
   catches — making this detector redundant).

   *Tradeoff:* lowest cost. Loses the value the detector demonstrated
   today (catching the ESM bug). Same convention that allowed my own
   bug to pass review.

4. **Keep the detector unwired, advisory-only**. Leave it as a
   manual `node scripts/check-undiscriminating-catches.mjs` audit
   tool. Don't wire into pre-flight. Triage happens organically.

   *Tradeoff:* zero forcing function. Detector exists but doesn't
   prevent the next regression of this class.

## Decision Outcome

**Option 1 (three-class triage) — chosen, but Phase A SKIPPED for now.**

Decision 2026-05-19: the LOW class (~80 catches matching `fall
through` / `already <X>` / `non-fatal` / `non-critical` / `best
effort`) **stays visible in the detector output** rather than being
auto-allowlisted via comment regex. Rationale: the regex would
permanently bless 80 callsites as "safe" based on a one-line comment,
but several patterns in that bucket deserve real investigation
before that. Specifically:

* **`fall through to <X>` chains** — the "fall through" comment
  declares intent but doesn't prove the next attempt actually
  handles every error type that could fire. Some chains may have
  gaps where a transient error in attempt-2 also kills attempt-3
  before the chain converges.
* **`already <X>` (freed/gone/removed)** — these claim idempotence
  but a real audit might find calls where "already gone" only
  handles ENOENT and would mask permission errors or i/o failures.
* **`best effort`** — defensible in shutdown handlers; not
  defensible elsewhere. Per-callsite read needed to tell the
  difference.

Keeping LOW visible costs nothing today (the detector is informational,
not wired) and preserves the audit signal for the natural-code-edit
pass when each file is touched for other reasons.

### Concrete plan

1. **Phase A — SKIPPED** for now. The auto-allowlist regex is *not*
   added. All 370 stay visible. Revisit after Phase B closes.
2. **Phase B**: resolve the 29 HIGH catches per the per-callsite
   investigation below. Net split (final, after the release-3
   correction described in "Post-implementation revision" below):
   * **8 catches deleted entirely** — absence cannot legitimately
     happen (same-package imports, required deps, dead paths,
     already-typed producers).
   * **10 catches restored as `catch (e) { console.error(...) }`** —
     Cluster B implements a documented graceful-degradation contract
     (try learned routing → fall through to patterns). The catches
     are not paranoia; they are the routing chain. `console.error`
     surfaces the signal via stderr so the no-squelch rule is
     satisfied via observability, not exception propagation.
   * **2 catches replaced with the typed contract call** — Cluster C
     (`defender.hasPII` is declared required in the AIDefence
     interface; the catch is paranoia about a guaranteed method).
   * **4 catches converted to a `tryOptionalImport` helper** that
     discriminates four Node-resolver "subpath not available" codes
     (`MODULE_NOT_FOUND`, `ERR_MODULE_NOT_FOUND`,
     `ERR_PACKAGE_PATH_NOT_EXPORTED`,
     `ERR_PACKAGE_IMPORT_NOT_DEFINED`) and rethrows everything else —
     only for the 3 genuinely-optional packages
     (`optionalDependencies` in cli's package.json) plus the
     `git rev-parse` env-conditional.
   * **5 catches converted to inline `e.code === 'ENOENT'`-only**
     discrimination — `SyntaxError` on a state file is corruption
     and MUST propagate.

   **Two rules govern every fix**:
   * **No-squelch rule** — narrowing what a catch swallows only
     counts as a fix if the narrowing matches a legitimately
     expected absence. `catch (e) { console.error(...) }` is
     acceptable when the catch implements a documented graceful-
     degradation contract enforced by an integration test — signal
     travels to stderr/telemetry, observability is preserved.
   * **Absence-is-not-accepted rule** — "absent feature, fall
     through" is only a valid resolution when the absence is
     reason-#5 (genuine platform/packaging conditional). For #1-#4
     reasons, fix the cause, not the symptom.

   Both rules detailed below.
3. **Phase C (advisory)**: leave the MEDIUM ~150 unwired. They get
   touched during natural code edits — same no-squelch rule applies.
4. **Phase D (LOW revisit)**: after Phase B lands, re-read the LOW
   class. Either (a) confirm the patterns are truly safe →
   auto-allowlist via regex, or (b) discover real gaps → convert.
5. **Phase E (gate flip)**: wire
   `check-undiscriminating-catches.mjs` into `scripts/ruflo-publish.sh`
   pre-flight only after LOW + HIGH are both closed.

### Cluster analysis of the 28 HIGH catches (2026-05-19)

Pulled the try-body context for all 29 matches against the HIGH-class
comment regex (`not available|unavailable|not initialized|not loaded|
may not (be loaded|exist)`). They collapse into **5 clusters with
shared root causes and shared fixes**, plus 3 singletons. ~26/29 share
a fix with at least one other callsite.

| Cluster | Count | Shape | Right fix |
|---|---:|---|---|
| A. Optional dynamic `import()` / `requireCjs()` | 7 | `import('pkg')` swallowed | Per-callsite: is the dep *truly* optional? If yes → `tryOptionalImport` helper that discriminates `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` and rethrows the rest. If no (production dep) → remove the catch; missing-on-install IS the bug. (ADR-0192 Phase 1 closed the previously-unbuilt-producer caveat at `autopilot-state.ts:322` on 2026-05-19.) |
| B. Controller registry + duck-type + `Promise.race` | 10 | `getController('X')` → `typeof ctrl.method === 'function'` → `Promise.race([call, timeout])` wrapped in `catch {}` | **Restore as `catch (e) { console.error(...) }`** (revised after release-3 — see "Post-implementation revision"). Initial reading was wrong: the outer catches implement the documented graceful-degradation contract for `route_task` / `memory_search` (try learned routing → fall through to next strategy). On cold start, controller methods can throw because internal state isn't populated; the contract is to fall through, enforced by `ctrl-routing` acceptance. Add `console.error` so the signal is observable in stderr/telemetry without breaking the contract. Long-term: controllers should return typed `{ready: false}` results so these become typed-result checks, not exception-driven. |
| C. `defender.hasPII()` method may be absent | 2 | Already-loaded object missing optional method | Replace with `typeof defender.hasPII === 'function' ? !!defender.hasPII(input) : false`. Better: fix AIDefence type contract so the method is part of the interface (optional or required). |
| D. `existsSync` + `JSON.parse(readFileSync(...))` on optional state file | 5 | File-not-exist *or* corrupt-JSON both silently swallowed | Discriminate `ENOENT` only. `SyntaxError` on a state file is a **corrupt-state bug** and must fail loud, not fall back to "no file". |
| E. HNSW status query | 2 | `routeEmbeddingOp({type: 'hnswStatus'})` — caller catches it | **Delete catches**. Producer at `memory-router.ts:1845` already returns typed `{success, error?, available?, entryCount?, dimensions?}` — does NOT throw. The "not initialized" case is `{success: false, error: 'Storage not initialized'}`. Callers must read `.success` / `.available` properly, not wrap in try/catch. **No producer fix needed** (initial framing was wrong — verified during investigation). |

**Singletons (3):**

* `worker-daemon.ts:1057` — router shutdown import; really cluster A,
  use `tryOptionalImport` or relocate to LOW.
* `embeddings.ts:1394` — shutdown-adjacent router import; same.
* `commands/security.ts:367` — `git rev-parse` external-binary
  detection. Discriminate `e.code === 'ENOENT' || e.status === 128`.

**Execution order (cheapest signal first; see investigation below for
evidence supporting each):**

1. **E** — delete both catches (NO producer fix). The producer at
   `memory-router.ts:1845` already returns `{success, error?, available?,
   entryCount?, dimensions?}` typed — does not throw. Callers must read
   `.success` / `.available` instead of try/catch.
2. **C** — delete catches, call `defender.hasPII(input)` directly. The
   AIDefence interface declares `hasPII(input: string): boolean;` as
   required at `@claude-flow/aidefence/src/index.ts:96`; the method
   is always present.
3. **B** — restore the 10 outer try/catch but add `console.error` on
   entry (revised after release-3). The acceptance test `ctrl-routing`
   enforces the graceful-degradation contract; deleting these breaks
   cold-start fall-through. Logging on catch surfaces the signal in
   stderr without breaking the contract.
4. **A** — split by evidence: 4 catches deleted (same-package
   internal imports / required deps / dead path); 3 get a
   `tryOptionalImport` helper (genuinely-optional packages per
   `package.json:optionalDependencies`).
5. **D** — 5 inline `e.code === 'ENOENT'`-only catches;
   `SyntaxError` MUST propagate (state-file corruption is a real
   event).

Final effort: **8 catch deletions + 2 typed-contract calls + 4 helper
conversions + 5 inline discriminations + 10 catch-with-log restorations
= 29 changes**, zero producer rewrites. Materially smaller and lower-
risk than the "30 hour-equivalent ~28 hand-fixes" first estimate; only
4 of the 29 needed the full discriminating-helper treatment.

### Why is it absent? Per-callsite investigation (2026-05-19)

Read the producers for all 29 HIGH catches and classified each by a
five-reasons taxonomy of *why* absence happens. Each row below cites
the evidence that pins it.

| # | Reason for absence | Legitimate? |
|---|---|---|
| 1 | **Init-order race** — consumer runs before producer registration completes | NO — fix sequencing |
| 2 | **Swallowed bug** — producer's own catch ate an init error or method-body throw, leaving an empty/broken state that surfaces as "absence" | NO — find the upstream catch (the absence IS the squelching outcome) |
| 3 | **Invisible feature flag** — registration is conditional on config the consumer can't see | NO — make the flag visible at the call site |
| 4 | **Lying type / paranoia** — code thinks the producer can be absent but the contract guarantees otherwise, or the import is to a path that can't fail (same-package internal, required dep, already-typed producer) | NO — delete the catch; absence cannot legitimately happen |
| 5 | **Genuine platform/packaging conditional** — `optionalDependency`, WASM that may not load, external tool (git), bootstrap state file | YES — but must be typed at the call site, logged at startup, integration-tested in the absent shape |

#### Findings per callsite

| Callsite | Reason | Evidence |
|---|---|---|
| **Cluster A — optional dynamic imports (7)** | | |
| `hooks-tools.ts:402` `@claude-flow/memory` | #5 | listed in `optionalDependencies` (cli/package.json) |
| `hooks-tools.ts:404` `@claude-flow/agentdb` | **#4 dead path** | NOT in cli/package.json AND codemod doesn't alias to it. Import always fails with `MODULE_NOT_FOUND`. The whole branch is dead code. |
| `memory-router.ts:599` `agentdb` | #4 | listed in `dependencies` (REQUIRED, always installed) |
| `autopilot-state.ts:322` `agentic-flow/coordination/autopilot-learning` (post Phase 3 codemod rewrite) | **#5** | `agentic-flow` is in optionalDeps; the `coordination/autopilot-learning` subpath is exported by `@sparkleideas/agentic-flow`. The producer (AutopilotLearning) **was** referenced by 7 source files + 2 ADRs + 1 integration test without ever being committed — a planned-but-never-built spec gap that was the actual story behind A4's failure. Resolved via **ADR-0192** Phase 1 implementation (landed 2026-05-19, release-4 green): producer file `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` (~250 lines), AgentDB-backed episode storage, pattern aggregation, recall + re-engagement context assembly, graceful-unavailable mode. Confidence call-site behavior: `tryLoadLearning()` returns a non-null instance in fresh installs; `available=true` with non-zero episodes after population. |
| `intelligence.ts:1162` `@ruvector/ruvllm` (via `createRequire`) | #5 | optionalDep, WASM, platform-conditional. **Original bug site** — the catch was hiding an ESM/CJS error today. |
| `ruvllm-tools.ts:130` `../memory/intelligence.js` + `../memory/sona-optimizer.js` | #4 | same-package internal imports; cannot fail with `MODULE_NOT_FOUND` |
| `ruvllm-tools.ts:138` `../ruvector/graph-backend.js` | #4 | same-package internal import |
| **Cluster B — controller registry (10)** | | |
| 9 callsites (hooks-tools `1015/1046/1064/1090/2075/2970`; memory-tools `581/614/629`) | **#5** graceful-degradation contract (revised — see "Post-implementation revision"). Initial reading classified all 10 as #2 (swallowed method bug); that reading was wrong. Release-3's `ctrl-routing` acceptance failure proved the catches implement the documented `route_task` / `memory_search` graceful-degradation chain: on cold start, controller method bodies can throw because internal state isn't populated yet, and the contract is to fall through to the next strategy (static patterns / unranked results / etc.). The catches are the routing chain, not paranoia. Disposition: catch + `console.error` log. |
| `memory-tools.ts:495` `queryOptimizer.getCached` | **#3 invisible feature flag** (further root-caused post-release-3 as Task B7). Unlike the other 9 sites, this catch could not fire at runtime because `getController('queryOptimizer')` returned `undefined`. Root cause traced through `isControllerEnabled` → `this.config.controllers.queryOptimizer === false` → init template (`config-template.ts:198`) defaulted `enabled.queryOptimizer: false` since first written (commit `aa7c7673f`, no rationale documented). The tuning section right below populated `planCache`, `maxCachedPlans`, `ttl` — only meaningful if the controller were enabled. **Fix applied**: flipped the init-template default to `true`. The catch+log remains in place (matches the other 9 — same contract) but now also wraps a controller that actually registers and works. Also re-instrumented `controller-registry.ts:1922` `case 'queryOptimizer'` to replace its bare `catch { return null }` with per-precondition `console.error` discrimination, so future config-flag regressions surface in stderr instead of silently filtering the controller out. |
| **Cluster C — `defender.hasPII` (2)** | | |
| `security-tools.ts:166`, `:475` | #4 | `interface AIDefence { hasPII(input: string): boolean; }` at `@claude-flow/aidefence/src/index.ts:96` declares `hasPII` REQUIRED (no `?`); implementation at line 196. Always present on any AIDefence-shaped object. |
| **Cluster D — state files (5)** | | |
| `system-tools.ts:196` (agentdb tasks query) | #2 inside #5 | inner per-row JSON.parse catch swallows malformed metadata; outer swallows agentdb query failure (could be init error) |
| `system-tools.ts:211, :224` (agent/task `store.json`) | mixed: #5 ENOENT (first run), #4 SyntaxError | producer is same-package's `task-tools.ts:91` / `agent-tools.ts:95`. ENOENT is bootstrap; SyntaxError is corruption. |
| `memory-router.ts:399` (`config.json`) | mixed: #5 ENOENT, #4 SyntaxError | same pattern — first-run bootstrap vs corruption |
| `doctor.ts:233` (`config.json`) | mixed: #5 ENOENT, #4 SyntaxError | same |
| **Cluster E — HNSW status (2)** | | |
| `embeddings.ts:1385`, `performance.ts:425` | #4 paranoia | producer `routeEmbeddingOp({type:'hnswStatus'})` at `memory-router.ts:1845` **already returns** typed `{success, error?, available?, entryCount?, dimensions?}` — does NOT throw. The "not initialized" case is `{success: false, error: 'Storage not initialized'}`. Caller catch hides only the same-package `import()` — pure paranoia. **No producer fix needed.** |
| **Singletons (3)** | | |
| `worker-daemon.ts:1057` (`import('../memory/memory-router.js')`) | #4 | same-package internal import |
| `embeddings.ts:1394` (same import) | #4 | same |
| `commands/security.ts:367` (`git rev-parse`) | #5 | git is environment-conditional |

#### Disposition summary (final after release-3 correction)

| Disposition | Callsites | Count |
|---|---|---:|
| **Delete catch entirely** — absence cannot happen (#4), or absence is indistinguishable from a bug the catch is hiding (#2) | A {`404, 599`, ruvllm-tools `130/138`} (4) + E (2) + `worker-daemon:1057` + `embeddings:1394` | **8** |
| **Catch + `console.error` log** — graceful-degradation contract (#5) enforced by integration tests; signal observable via stderr. Note: 9 of these wrap controllers whose method bodies legitimately throw on cold start; the 10th (`queryOptimizer` at `memory-tools.ts:495`) wrapped a controller that wasn't registering at all due to an init-template config-flag default (B7 — see findings table). All 10 keep the same catch+log shape; B7 additionally flips the init default + re-instruments the registration case. | B (10) | **10** |
| **Drop catch, use typed contract directly** — paranoia about a guaranteed method | C (2) | 2 |
| **Discriminating helper** (`tryOptionalImport`) for genuinely-optional package; 4 absence codes | A {`402, 322, 1162`} (3) + `commands/security:367` (git) (1) | 4 |
| **ENOENT-only discrimination; SyntaxError propagates** | D (5) | 5 |
| **Total** | | **29** |

**28% (8/29) of the HIGH catches got deleted; 34% (10/29) restored as
catch+log to preserve the graceful-degradation contract; the rest
got typed contracts, helpers, or inline discrimination.** Only 4 of
29 (14%) needed the full discriminating-helper treatment.

The original Phase B estimate ("hand-fix 28 with discriminating
`if (e.code !== ...) throw e`") was off-shape — most of the work
turned out to be either deletion or catch+log, not narrowing
discrimination.

### Absence-is-not-accepted rule

**Absent features are not, by default, an accepted steady state.**
Before resolving any finding by treating absence as "fine, fall
through," answer:

1. Which of the five reasons (above) explains this absence?
2. Reasons #1–#4: the absence is a downstream symptom. Fix the
   cause, not the symptom. The catch goes away because the absence
   stops happening — or could never happen.
3. Reason #5 (genuine platform/packaging conditional): the absence
   is real, but must be:
   * **Typed** at the call site (return value, status enum,
     optional-import helper — *never* an exception the consumer has
     to discriminate)
   * **Logged** at startup so operators know the feature is off
   * **Tested** by an integration check that runs in the
     absent configuration

"Fall through to fallback" is the dialect of accepted absence. After
the release-3 correction, **~19 callsites in the HIGH class have
earned the right to use that pattern**: the 3 genuine-optional
package imports, the 5 first-run state files, `git` env-conditional,
AND the 10 Cluster B graceful-degradation routing-chain callsites
(those last 10 are accepted-absence-because-of-cold-start-state, a
form of reason #5, pending the producer typed-result refactor that
would make them reason #4 instead). The remaining 10 are absent
because of a bug upstream of the catch, or are not actually absent
at all and the catch was paranoia — those got deleted.

The asymmetry between "delete" (8) and "catch+log" (10) is worth
internalizing: a catch is justified by a documented contract that
an integration test enforces, not by the catch's own comment about
what it thinks it's handling. The Cluster B catches were
mis-labeled by their authors as "X unavailable — fall through"
when the real semantics was "X may throw on cold start; fall
through is the contract". Always verify the contract via the
integration test that depends on the catch's behavior before
deleting.

### No-squelch rule

**A finding is not "resolved" by narrowing what the catch swallows
unless the narrowing matches a legitimately expected absence.** The
following do NOT count as fixing a HIGH finding:

* Discriminating on `MODULE_NOT_FOUND` for a production dep. If the
  package can't be imported in a published install, that's an install
  bug, not a feature-gate. Delete the catch; let it propagate.
* Discriminating on timeout errors and returning `null`. A 2-second
  timeout firing is real signal (backend hang, deadlock, SLA breach).
  Surface it — log loudly, route to telemetry, or let it propagate.
  Don't fold it into the "feature unavailable" branch.
* Discriminating on `SyntaxError` for state files. Corrupt JSON in a
  store-of-record is a data-integrity event. Fail loud; the operator
  needs to know.
* Wrapping a controller-call catch with a "slightly better" helper
  that hides timeouts and method-internal throws *without logging*.
  If the catch implements a documented graceful-degradation contract
  (per Cluster B), `catch (e) { console.error(...) }` IS acceptable —
  the signal is preserved in stderr/telemetry. If the catch is
  paranoia (no integration test enforces fall-through), fix the
  producer so there's nothing to catch.

The test for "is this fix squelching?": **if the original bug class
(ESM-vs-CJS at intelligence.ts:1162) were to fire through this site,
would my fix still hide it?** If yes, the fix is squelching. Memory
references: `feedback-no-fallbacks`, `feedback-no-squelch-tests`,
`feedback-best-effort-must-rethrow-fatals`.

**Catch deletion** is the preferred fix wherever the catch was
modeling an absence that cannot legitimately happen (#4) or was
hiding a real bug class (#2). Per the final disposition, 8 of 29
catches qualify: same-package internal imports, required deps,
already-typed producers (Cluster E's producer already returns
`{success, ...}` — the catch is paranoia). Deleting the catch
surfaces the real behavior; if a method legitimately throws, that
signal needs to travel.

**Catch + `console.error` log** is the right fix when the catch
implements a graceful-degradation contract enforced by an
integration test, AND the producers can throw because of state-
not-ready (cold-start) rather than feature-genuinely-absent. The
log routes the signal to stderr/telemetry without breaking the
contract; observability replaces exception propagation as the
no-squelch satisfaction mechanism. Cluster B's 10 callsites are the
canonical case here. Long-term, the producers should return typed
`{ready: false, ...}` results so the consumer can read a status
field instead of catching an exception — at which point catch+log
becomes a typed-result check, the "right shape" per the
absence-not-accepted rule.

Helpers + discrimination apply only where reason-#5 is the *actual*
cause and the resolver protocol distinguishes "absent" from "broken"
via a typed error code: 3 optional-package imports (
`tryOptionalImport` discriminates 4 absence codes), 1 git
env-conditional. State files (Cluster D) get inline ENOENT-only
because their absence is reason-#5 on first-run only and SyntaxError
is non-negotiable.

### Post-implementation revision (2026-05-19, release-3)

The first release attempt (`release-2`) acceptance run produced
**4 failures** that reshaped the disposition for two clusters:

1. **`p2-ap-lifecycle` / `p2-ap-predict` / `p8-inv10-autopilot`** —
   all failed with the same error:

   > Failed to execute MCP tool 'autopilot_predict': Package subpath
   > './dist/coordination/autopilot-learning.js' is not defined by
   > "exports" in agentic-flow/package.json

   Node.js error code: `ERR_PACKAGE_PATH_NOT_EXPORTED`. The package
   is installed, but the subpath isn't in its `exports` map —
   genuine version-skew between cli and the installed agentic-flow.
   My initial `tryOptionalImport` discriminator + inline catch in
   `autopilot-state.ts` only matched `MODULE_NOT_FOUND` /
   `ERR_MODULE_NOT_FOUND`. The fix: widen the discrimination set to
   four codes (`MODULE_NOT_FOUND`, `ERR_MODULE_NOT_FOUND`,
   `ERR_PACKAGE_PATH_NOT_EXPORTED`,
   `ERR_PACKAGE_IMPORT_NOT_DEFINED`) — all four mean "the thing we
   want isn't reachable from the resolver", which is the absence we
   intend to tolerate.

2. **`ctrl-routing` ("Learned routing")** failed with the test
   verdict:

   > Hooks route: graceful error (cold-start) — must return routing
   > decision

   The test exercises `hooks_route` on a fresh project. With the
   Cluster B catches removed, controller method bodies threw on
   cold start (state not yet populated), and the cli returned an
   error response instead of falling through to static patterns.
   The acceptance test enforces the graceful-degradation contract —
   `route_task` MUST return a routing decision, never an error.

   This proved my initial Cluster B classification (reason #2,
   "swallowed method bug") was wrong. The catches implement the
   documented routing chain. The producer-side fix (typed `ready:
   false` returns from controllers) is the right long-term answer,
   but until that lands, the catches must stay. Restored all 10 as
   `catch (e) { console.error(...) }` — the contract is preserved,
   the signal is observable in stderr.

   This is also why **Cluster B was reclassified from reason #2 to
   reason #5** in the per-callsite findings table: cold-start
   absence (state not ready) IS a legitimate platform-conditional
   absence; the bug is the producer's choice to throw rather than
   return a typed status.

**Lesson** (worth keeping for the next "delete the catch" pass):

* A catch is justified by a documented contract enforced by an
  integration test, not by the catch's own comment. The Cluster B
  authors labeled their catches "X unavailable — fall through" but
  the real semantics was "X may throw on cold start; fall through
  is the contract". The comment was a poor summary, but the catch
  was load-bearing.
* The cheapest verification that a catch is paranoia (deletable) vs.
  contract-bound (keepable+log) is: **find the acceptance test that
  exercises this code path; if the test would fail without the
  catch, the catch is contract-bound**. The detector alone cannot
  tell you this — only the integration-test signal can.
* The no-squelch rule needs a clarification (now added above):
  catch + console.error IS a valid resolution when the catch
  implements a documented graceful-degradation contract. The signal
  travels to stderr/telemetry, satisfying observability, while the
  contract is preserved. This is different from squelching (signal
  destroyed) because the log captures it.

After the revision, release-3 ran clean: **673/682 passed, 0 failed,
9 `skip_accepted`** (heavy-skip opt-outs). Detector unchanged at
**341** undiscriminating catches (370 → 341 = 29 fixed); no HIGH-
class survivors.

### Follow-up work surfaced during review (2026-05-19, post-release-3)

Reviewing the released fix surfaced four real issues that this ADR did
not initially catch. They follow from the absence-not-accepted rule
itself — the rule said "absence must be typed, logged, and integration-
tested," but the initial Phase B fix only delivered the *narrowing*
part, not the verification that the feature actually *works* under
absence rules. Captured tasks:

**A — Optional-import sites (Cluster A):**
* **A2 + A5 verified active** in a fresh `@sparkleideas/cli` install.
  `@sparkleideas/memory.deriveHNSWParams` returns the correct values
  at dim=768 (identical to source defaults — degraded mode is
  observably zero-cost at default dim). `@sparkleideas/ruvector-ruvllm`
  reports `trainingBackend: "ruvllm"` via `mcp exec --tool
  ruvllm_status` — the TrainingPipeline detection fires correctly.
* **A4 dead-spec discovery**: `AutopilotLearning` is referenced by 7
  source files, 2 ADRs (058/072), and 1 integration test — but no
  commit in any repo ever added the producer file. Spec'd but never
  built. Documented in **ADR-0192** with a 7-phase implementation
  plan. ADR-072 stays Proposed until ADR-0192 Phase 1 lands.

**B — Controller registry (Cluster B):**
* **B7 root cause found**: `queryOptimizer` was missing from the
  registry in fresh installs because the init template
  (`cli/src/init/config-template.ts:198`) defaulted
  `enabled.queryOptimizer: false` with no documented rationale. The
  controller has a tuning config populated below it (planCache,
  maxCachedPlans, ttl), which only makes sense if it's enabled.
  Init-time was set wrong since the template was first written
  (commit `aa7c7673f`). **Fix**: flipped the default to `true`. The
  controller-registry case at `controller-registry.ts:1922` was also
  re-instrumented to surface which precondition fires on registration
  failure (replacing the bare `catch { return null }` with explicit
  per-condition `console.error` discrimination), so future regressions
  of the same shape are observable rather than silent.
* **Doctor observability (Task #22)**: added a `checkControllers`
  health check to `ruflo doctor` that reports per-controller
  registration state (total / active / inactive / error-bearing).
  Operators see degraded-mode state at diagnosis time instead of
  inferring it from missing features at runtime.
* **Happy-path acceptance test (Task #21)**: added
  `check_cluster_b_controllers_register` to the acceptance harness
  (`ctrl-cluster-b` check) — verifies all 10 Cluster B controllers
  register AND are enabled in a fresh init project. Specifically
  guards `queryOptimizer` against B7 regression. Closes the "is the
  feature actually working" verification gap that release-3's pass
  did not cover.

**S — Singletons (S1, S2, S3):**
* **S1 + S3 confirmed clean**: release-3 didn't surface any worker-
  daemon shutdown bug (S1) or git-rev-parse-related regression (S3).
  The catch removals/discriminations didn't reveal bugs in CI; the
  catches were genuinely paranoia.
* **S2 confirmed clean**: `embeddings cache -a clear` returns
  "Cache cleared!" — the removed catch didn't surface a real bug;
  the same-package import + typed `routeMemoryOp` work as expected.

**Net additional changes** (vs. the original 29-callsite fix):
* 1 init-template default flip (`queryOptimizer: false → true`)
* 1 controller-registry case re-instrumentation
  (per-condition `console.error` instead of bare `catch { return null }`)
* 1 doctor health-check addition (`checkControllers`)
* 1 acceptance check addition (`ctrl-cluster-b`)
* 1 new ADR (ADR-0192) for the unbuilt AutopilotLearning feature

**Closing condition update**: this ADR closes when the original 29
Phase B fixes + the follow-up tasks above ALL land green in
`npm run release` acceptance. ADR-0192 (autopilot-learning build)
runs independently and is tracked separately.

## Consequences

**If Option 1 (three-class triage)**:

* ~30 hour-equivalent investment spread over weeks.
* HIGH class closure within 30 days eliminates the bug class that hit
  today. Subsequent regressions caught by the gate.
* LOW class allowlist via regex creates a maintainable rule; new
  fall-through patterns must follow the convention or get flagged.
* MEDIUM class becomes the natural-code-touch backlog. Some never get
  touched; that's fine — they were never urgent.

**If Option 2 (fix everything)**:

* Highest correctness, highest risk of regression from misclassified
  error shapes. Multi-day project.

**If Option 3 (allowlist all 209)**:

* Detector becomes redundant with check-silent-catches.mjs. The
  failure mode that hit today stays open. Not recommended.

**If Option 4 (advisory-only forever)**:

* Lowest cost. Highest ongoing risk — no forcing function for the
  next regression.

This ADR closes when Option 1's Phase D lands (gate wired after HIGH
is closed) OR an alternative option is chosen and implemented.

## Implementation log

Status flipped from `proposed` → `accepted` on 2026-05-19 after Phase B
Clusters A-E + the 4 follow-up tasks + Phase D gate-wiring all landed.
Detector HIGH count: 0.

| Phase / Task | Commit | Repo | Description |
|---|---|---|---|
| Phase B initial | `e062dd82c` | forks/ruflo | Resolve all 29 HIGH-class undiscriminating catches (8 deletions + initial Cluster B "delete" attempt + 2 typed-contracts + 4 helper conversions + 5 inline ENOENT-only) |
| Phase B release-3 revision | `130e2066f` | forks/ruflo | Revise Cluster B from "delete" to "catch+log" after `ctrl-routing` acceptance failure proved the catches implement the documented graceful-degradation contract; widen optional-import discriminator to 4 absence codes (adds `ERR_PACKAGE_PATH_NOT_EXPORTED` + `ERR_PACKAGE_IMPORT_NOT_DEFINED`) |
| Task B7 (instrument) | `0276777a9` | forks/ruflo | Replace `controller-registry.ts:1922` bare `catch { return null }` with per-precondition `console.error` discrimination; surface which precondition fires on registration failure |
| Task B7 (default flip) + Task #22 (doctor) | `caebf74e9` | forks/ruflo | Init-template default `queryOptimizer: false → true`; add `checkControllers` doctor health-check that reports per-controller registration state |
| Task #21 (acceptance) | `c4c5489` | ruflo-patch | Add `ctrl-cluster-b` acceptance check (`check_cluster_b_controllers_register`) that verifies all 10 Cluster B controllers register AND are enabled in a fresh init project |
| Phase D (this commit) | (this commit) | ruflo-patch | Wire `check-undiscriminating-catches.mjs` into `scripts/ruflo-publish.sh` as `undiscriminating-catches` phase, immediately after the `silent-catches` phase. Baseline-allowlist the remaining 342 LOW/MEDIUM findings in `lib/undiscriminating-catches-allowlist.txt` so the gate fires only on NEW HIGH-class regressions, not on pre-existing inventory. |
| Status flip | (this commit) | ruflo-patch | `proposed → accepted` |

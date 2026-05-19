---
status: implemented
date: 2026-05-19
implemented: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, stop-hook, observability, follow-ups, ADR-0191, ADR-0192, federated]
related: [0058, 0072, 0191, 0192]
follow-up-adrs: [0194, 0195, 0196]
upstream-related: [agentic-flow/ADR-058, agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0193: Autopilot system completion + ADR-0191/0192 follow-up gap closure

## Context and Problem Statement

ADR-0191's follow-up audit and ADR-0192 Phase 1 landed substantial
work, but the honest post-ship audit (2026-05-19) surfaced six items
that are either incomplete (Phase 1 scope of ADR-0192 was
intentionally trivial per ADR-059), unverified (consumer wiring not
proven end-to-end), or out-of-scope-but-real (orphan-spec siblings;
harness cache hardening). This ADR groups them so a single owner can
plan the closure rather than discovering them piecemeal.

The HIGH catches from ADR-0191 are all resolved (29 sites, none
squelching). The producer for AutopilotLearning exists (ADR-0192).
What remains is making the producer USEFUL beyond its trivial
baseline, wiring it to its CONSUMER (the Stop hook), proving the
queryOptimizer follow-up is actively used, completing the autopilot
system's other sibling components, and hardening the acceptance
infrastructure against stale-cache traps.

## Decision Drivers

* **Honesty over claim**: ADR-0192's verification matrix all-PASS is
  true for the producer, but the consumer wiring (Stop hook → real
  re-engagement-context inject) is unverified. Calling the autopilot
  system "complete" is overclaiming.
* **ADR-0059 deferred scope**: ADR-0192 Phase 1 explicitly deferred
  GNN-enhanced patterns, RL trajectory replay, cross-controller
  bridges, federated learning, real-time prediction, reward shaping,
  retention policies. Each is a real follow-up.
* **No-squelch principle**: the producer's `recordIterationStep` and
  `endSwarmTrajectory` are no-ops (intentional, scoped). But
  consumers that call them assume their state IS getting recorded
  somewhere. If nothing records, calling the methods is a polite
  lie.
* **Pre-existing orphan-spec siblings**: `drift-detector.ts` and
  `swarm-completion.ts` are referenced by tests + ADR-058 + the
  cli's autopilot integration but the source files don't exist in
  the fork. Same spec-but-never-built shape that ADR-0192 fixed for
  AutopilotLearning. Two more sibling features need the same
  treatment.
* **Acceptance harness reliability**: release-3 of ADR-0192 looked
  broken because npm `--prefer-offline` cached a pre-publish version
  of a freshly-bumped fork. The actual code was correct; only
  release-4's `--force` revealed it. This trap will fire again on
  any release that depends on a freshly-bumped fork's behavior.

## Considered Options

### Option 1 — single comprehensive follow-up ADR (chosen)

Group all six outstanding items into ADR-0193 with a phased plan,
priority, and dependency tracking. Single owner, single closure
criterion, single revisit cycle.

### Option 2 — separate ADRs per item

Six smaller ADRs (one per outstanding item). Easier to close
individually; harder to see the whole-system picture; risks losing
visibility on items that don't feel urgent in isolation.

### Option 3 — leave in `## Where honest "still degraded" remains` of ADR-0192

Treat the items as known-unresolved within ADR-0192's
post-implementation revision. No separate tracking. Loses visibility;
items decay into "we said this was a follow-up and never came back."

## Decision Outcome

**Option 1 — single comprehensive follow-up ADR.** Each item gets
its own subsection with scope, what blocks closure, dependencies,
and priority. The ADR closes when all six are resolved or formally
withdrawn.

## Outstanding items

### Item A — AutopilotLearning Phase 2 (producer enhancements)

**Scope**: Replace the trivial Phase 1 implementations with
actually-useful behavior, staying within the existing public surface
so consumers don't need updates.

* **A.1 — Real `predictNextAction(state)`**: Phase 1 returns
  `{action: 'continue', confidence: episodes/50}` — same action
  regardless of state. Phase 2: query past episodes via embedding-
  similarity on the state's `subject` or `taskShape` hash, then return
  the most-common next-action from the top-K matches. Confidence
  derived from match unanimity + match count.
* **A.2 — Embedding-based `recallSimilarTasks(query, limit)`**:
  Phase 1 uses literal substring (`subject.toLowerCase().includes(q)`)
  against the in-memory listing. Phase 2: use the existing
  AgentDBService embedding service (ONNX or enhanced) to compute
  cosine similarity over subject embeddings. Falls back to substring
  if embedder unavailable.
* **A.3 — Reward shaping in `_record`**: Phase 1 uses bare ±1.
  Phase 2: derive reward from `iterations` efficiency (fewer = better
  for the same subject), `durationMs` vs. median for similar tasks,
  and presence/absence of `critique` (penalty for unresolved failure
  mode).
* **A.4 — Episode retention/pruning**: Phase 1 has no cap; episodes
  accumulate forever within `EPISODE_SESSION_ID`. Phase 2: cap at N
  episodes (configurable, default 10000), evict oldest on overflow.
  This also lets the populated test suite return to `toBe(15)`
  assertions instead of the `toBeGreaterThanOrEqual(15)` looseness
  ADR-0192 commit `1800e40` documented.

**Closure**: producer surface unchanged; new unit tests cover the
non-trivial implementations; existing `ctrl-autopilot-learn` still
passes.

### Item B — Real `recordIterationStep` + `endSwarmTrajectory` (trajectory recording)

**Scope**: Wire the two trajectory-recording methods into the
existing SonaRvfService trajectory bank (the same API that
`AgentDBService.recordTrajectory` uses internally — see
`agentdb-service.ts:1128`).

Phase 1 left these as no-ops with the comment "later phases can wire
SONA trajectories here." That's now-now. Each Stop-hook iteration
produces a step (progress + drift signals); the end-of-swarm produces
a final reward + summary. Writing these via
`SonaRvfService.beginTrajectory + addStep + endTrajectory` integrates
with the existing trajectory infrastructure agentic-flow already
ships.

**Closure**: `getMetrics().trajectories` returns the actual count of
recorded trajectories (currently always 0 per Phase 1 comment).

### Item C — Stop-hook re-engagement-context consumer wiring

**Scope**: `forks/agentic-flow/.claude/helpers/autopilot-hook.mjs` is
the actual Stop-hook script. ADR-072's design says it calls
`learning.getReEngagementContext(incompleteTasks)` and threads the
returned context into the re-engagement prompt. Today the producer
returns a useful `ReEngagementContext` but I don't have evidence the
hook actually consumes it.

Audit needed:
1. Read `autopilot-hook.mjs` end-to-end.
2. Identify where the re-engagement prompt is composed.
3. Verify (or wire) that `getReEngagementContext` is called and its
   `recommendations` / `pastFailures` / `patterns` are injected into
   the prompt text.

If wired correctly: add a probe to the acceptance harness that
verifies the prompt includes learning-derived text after populating
episodes. If not wired: write the wiring + the probe.

**Closure**: an acceptance check (e.g., `ctrl-autopilot-stop-hook`)
that simulates an agent stop after populating episodes, captures the
Stop hook's stdout, and asserts the re-engagement text includes
`pattern` / `past success` / `past failure` markers.

### Item D — queryOptimizer active-use verification

**Scope**: ADR-0191's B7 fix flipped `enabled.queryOptimizer: true`
in the init template; `ctrl-cluster-b` verifies the controller
registers. But registration doesn't prove the controller is actively
used during `memory_search`.

The memory_search MCP tool wraps `getController('queryOptimizer')`
inside a try/catch (ADR-0191 Cluster B catch+log). When the cache
hits, the tool returns the cached result with `cached: true`. When
it misses, the tool runs the full search.

Audit needed:
1. Write an acceptance check that runs `memory_search` twice with
   identical inputs and asserts the second call's response includes
   `cached: true` OR is materially faster.
2. If neither holds, root-cause whether queryOptimizer is registered
   but unused vs. used but cache-disabled.

**Closure**: an acceptance check (`ctrl-query-optimizer-cache`) that
proves cache hits on repeated identical queries.

### Item E — `drift-detector.ts` + `swarm-completion.ts` orphan-spec sibling files

**Scope**: Same shape as ADR-0192's A4 finding for AutopilotLearning
— two source files referenced by tests + ADR-058 + the cli's
autopilot integration, but never committed in any repo.

* `forks/agentic-flow/agentic-flow/src/coordination/drift-detector.ts`
  — referenced by `autopilot-drift-learning.test.ts:6` (orphan
  import), described in ADR-058's mechanism section.
* `forks/agentic-flow/agentic-flow/src/coordination/swarm-completion.ts`
  — referenced by `autopilot-drift-learning.test.ts:13`, described in
  ADR-058 (`SwarmCompletionCoordinator`).

`autopilot-drift-learning.test.ts` exists with 8 it-blocks for
DriftDetector + 8 for SwarmCompletionCoordinator + the orphan
import paths. The test file currently can't load (vitest aborts at
module-load); ADR-0192 split AutopilotLearning's suites out so its
tests run, but the drift + completion suites are still orphaned.

ADR-058's specification is the contract for both classes:
* DriftDetector: stall/cycling/thrashing/decay detection; signal
  emission; mitigation suggestions
* SwarmCompletionCoordinator: task tracking, iteration counting,
  completion check via `isComplete() / getRemainingTasks() / tick()`

The existing test file is the binding spec — make those 16 it-blocks
pass.

**Closure**: both files exist + compile + the broken file loads via
vitest and runs all its blocks green.

### Item F — Acceptance harness `--prefer-offline` cache hardening

**Scope**: release-3 of ADR-0192 looked broken because the harness
installed via `npm install --prefer-offline` and npm cache-pinned to
the pre-bump agentic-flow version. The actual code was correct;
`--force` invalidated the cache and release-4 passed cleanly.

This will fire again on any release that depends on a freshly-bumped
fork artifact. The fix: invalidate the npm cache (or skip `--prefer-
offline`) for the specific packages that just got bumped during the
current release.

Two practical approaches:
1. **Per-package cache bust**: `scripts/test-acceptance.sh` reads the
   list of bumped packages from `state.last-build-state`, then runs
   `npm cache clean <pkg>` for each before the install.
2. **Drop `--prefer-offline` entirely**: accept the install-time cost
   for guaranteed freshness. `--no-cache` or omitting `--prefer-
   offline` would work.

(1) is targeted; (2) is simpler but slower. (1) preferred.

**Closure**: a release that bumps a fork in a way that would have
previously triggered the cache-pin trap (e.g., a contract change in
the bumped fork's exports map) succeeds without needing `--force`.

### Item G — AutopilotLearning Phase 3-5 (later phases per ADR-059)

Documented as planned-but-deferred (not "out of scope" — there's a
real reason these aren't in Phase 2 above):

* **Phase 3 — GNN-enhanced patterns**: Use
  `@sparkleideas/ruvector-gnn` (already an optional dependency, lazy-
  loadable per agentic-flow's `gnn-router-service.ts`) to build a
  task-similarity graph over episodes and discover patterns via
  graph clustering rather than just keyword frequency. Adds richer
  `discoverSuccessPatterns` output.
* **Phase 4 — Cross-controller bridges**:
  - Hook for `LearningSystem` to consume autopilot outcomes and
    update its algorithm-recommendation weights
  - SONA RL trajectory feedback loop: trajectories recorded in
    Phase 2 Item B feed back into SONA's policy updates
  Requires interface design between `AutopilotLearning` and
  `LearningSystem` — neither should depend tightly on the other;
  use an event-emitter or message-bus pattern.
* **Phase 5 — Federated learning**: Episodes shared across ruflo
  installs via QUIC/CRDT. Real boundary on what's buildable: there's
  no multi-instance runtime infrastructure in the current dev
  setup. The interface can be defined (a `FederatedSyncProvider`
  surface that AutopilotLearning calls), but the actual sync
  requires either (a) building a federation server or (b) using an
  existing one. Document the interface here, defer the runtime to
  a dedicated federation-infrastructure ADR.

**Closure**: each phase gets its own sub-ADR (Phase 3 = ADR-0194,
Phase 4 = ADR-0195, Phase 5 = ADR-0196) when prioritised. This ADR
records them but doesn't itself implement them.

## Implementation Plan

Priority order (highest signal first):

1. **Item B** (trajectory recording) — small, builds on existing
   SonaRvfService API, eliminates the "polite lie" of no-op methods.
2. **Item C** (Stop-hook consumer wiring) — proves the producer is
   actually consumed; high user-facing value once Phase 1 is shipped.
3. **Item A.2** (embedding-based recall) — uses existing
   AgentDBService embedder; small change, big quality uplift for
   the re-engagement context.
4. **Item D** (queryOptimizer active-use) — closes ADR-0191's B7
   "feature works" verification gap.
5. **Item E** (drift-detector + swarm-completion) — completes the
   sibling components ADR-058 specifies; unblocks the broken test
   file.
6. **Item F** (harness cache hardening) — process improvement that
   prevents the next stale-cache misdiagnosis.
7. **Item A.1, A.3, A.4** (real prediction, reward shaping,
   retention) — quality uplifts that build on Item B's trajectory
   recording.
8. **Item G** (Phase 3-5) — separate ADRs when prioritised.

Each item lands in its own commit chain with its own acceptance
check. ADR-0193 closes when items A-F are all green; Item G is
documented but tracked in its own sub-ADRs as they're prioritised.

## Consequences

### Positive

* Whole-system picture of what's outstanding after ADR-0191/0192
  in one place; nothing decays into "we said this was a follow-up
  and never came back."
* Each item has a concrete closure criterion (acceptance check or
  test) so "done" is measurable.
* AutopilotLearning becomes useful beyond the Phase 1 baseline.
* The autopilot system's other sibling components (DriftDetector,
  SwarmCompletionCoordinator) get the same treatment AutopilotLearning
  got — speced-but-never-built → built.
* The harness cache trap stops being a recurring source of false
  release failures.

### Negative

* Six concrete sub-features to land. Each is small but the total
  surface is non-trivial.
* Items A.1 / A.2 / A.3 / A.4 change the AutopilotLearning behavior;
  the populated-test-suite assertions need to be revisited to lock
  in the new behavior without false-positive flakes.
* Items E (drift-detector + swarm-completion) re-introduce risk on
  the existing test file — fixing the orphan imports means vitest
  starts running 16+ test blocks that haven't been exercised in CI.
  Some of them may turn out to be wrong about the contract.
* Phase 5 (federated learning) requires runtime infrastructure that
  doesn't exist yet. Documenting the interface without delivering
  the runtime is honest, but it creates a known-unfinished surface.

### Risks

* **Item C wiring already exists but produces an empty context**:
  if the Stop hook DOES call `getReEngagementContext` today but the
  episode log is empty (because populate is never triggered), the
  re-engagement prompt is empty-text and adds no value. Audit needs
  to verify both the call AND the populate path are wired.
* **Item E test contracts may be wrong**: the orphan
  `autopilot-drift-learning.test.ts` describes a DriftDetector +
  SwarmCompletionCoordinator surface based on ADR-058's
  specification. If the tests assert behavior that doesn't match
  what's actually needed in production, the implementation has to
  reconcile.
* **Item A.3 reward shaping changes existing episodes' weights**:
  reward shaping affects pattern discovery and the `confidence`
  metric. A breaking change in scoring behavior is expected. The
  populated test suite needs new assertions calibrated to the
  shaped rewards.
* **Item B trajectories recorded without a consumer**: writing
  trajectories without anyone reading them is just storage. Item B
  closure requires either an immediate consumer (Item C re-engagement
  prompt could surface trajectory-derived stats) OR an explicit
  acknowledgment that the data is for future Phase 3-4 use.

## Out of scope

* **Phase 5 federated runtime** — interface defined, runtime
  deferred to a federation-infrastructure ADR (not yet written).
* **Removing `--prefer-offline` globally** — Item F's targeted
  per-package cache bust preserves install-speed for un-bumped
  packages; a global flag flip would punish every release.
* **Migrating to a different test runner** — vitest's behavior on
  the orphan-import case is the real constraint Item E addresses;
  changing test runners is a different concern.
* **Renaming `autopilot_learn` MCP tool** — it's a misnomer (the
  tool discovers patterns, doesn't record), but renaming is a
  breaking surface change. Document the misnomer; don't rename.

## Implementation deviations (recorded at closure)

* **Item F — hardcoded bumped-packages list, not state-file parse (RESOLVED 2026-05-19).** Initial Item F landing busted a hardcoded 5-package list in `scripts/test-acceptance.sh:259-271`. Trade-off recorded: a 6th package added to the bump set would silently keep the stale-cache trap for that package. Resolved by ruflo-patch commit `5163353`: `bump_fork_versions` in `scripts/ruflo-publish.sh` now writes the bumped-package list to `scripts/.last-bumped-packages` (one `@sparkleideas/*` name per line, gated on bump success); `_cache_bust_bumped_packages` reads from there with loud `log_error` fallback to the hardcoded list only when the file is missing/empty (first-ever release or dev environment). No silent fallback.
* **Item C — hook lived in BOTH outer and inner `.claude/helpers/` (RESOLVED 2026-05-19).** Initial Item C landing mirrored the hook to both locations and kept them byte-identical by manual commit. Resolved by fork commit `0ec48ae` on `sparkling/main`: outer `forks/agentic-flow/.claude/helpers/autopilot-hook.mjs` deleted (only the inner copy ships per package.json `files` glob); test file moved via git rename (history preserved) to inner; outer `.claude/settings.json` Stop-hook config path updated to point at the inner location. Single source of truth.
* **Item D — initially `skip_accepted`, now `passed`.** First Item D landing marked the probe `skip_accepted` with an "architectural-gap" diagnostic. User pushback ("skip_accepted increased") was correct — that was squelching, not honesty. Root cause turned out to be a missing public accessor: AgentDBService wraps an `AgentDB` instance that exposes `getController('queryOptimizer')`, but AgentDBService never re-exposed the delegate. Fork commit `3cdca80` added `AgentDBService.getController()` (delegates to `this.db.getController()`, returns null on unknown names instead of throwing). Probe rewritten in commit `9e11afa` to call `qo.query(SQL)` twice and assert `qo.getStats()` totalHits ≥ 1. Final release reported `totalHits=1, totalMisses=1` — real cache verification, no skip needed. Baseline `skip_accepted=9` restored.

## Verification matrix

| Item | Status | Closure evidence | Notes |
|------|--------|------------------|-------|
| A.1 — `predictNextAction(state)` | PASS | `b20527b` adds real implementation in `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`. Wave 1 Agent 1 smoke-tested via esbuild stub. Acceptance `ctrl-autopilot-trajectories` exercises the loaded module. | Confidence formula: unanimity × log(matchCount+1)/log(11). |
| A.2 — embedding `recallSimilarTasks` | PASS | `b20527b` delegates to `_agentdb.recallEpisodes(query, limit, {sessionId})`. Phase 1 substring filter removed entirely (no fallback per `feedback-no-fallbacks`). | |
| A.3 — reward shaping in `_record` | PASS | `b20527b` ships shaped reward formula (base × efficiency / time_penalty + critique_penalty, clamped). Populated suite asserts 3-iter completion > 15-iter completion. | |
| A.4 — episode retention/pruning | PASS | `b20527b` adds `EPISODE_CAP` const + `_agentdb.deleteEpisode` eviction. Wave 1 Agent 1 smoke-tested cap=5 under 15-write load. | Soft-cap mode when `deleteEpisode` unavailable (documented at call site). |
| B — `recordIterationStep` + `endSwarmTrajectory` | PASS | `b20527b` wires both to `SonaRvfService.beginTrajectory/addStep/endTrajectory`. `6cdb14a` exposes `getSonaService()` on AgentDBService. Acceptance `ctrl-autopilot-trajectories` proves `getMetrics().trajectories ≥ 1` after `recordIterationStep × 3 + endSwarmTrajectory`. | Trajectory persistence is process-local (in-memory SonaRvfService). |
| C — Stop-hook re-engagement wiring | PASS | `6a9d408` wires `autopilot-hook.mjs` to call `learning.getReEngagementContext`. `0020331` mirrors hook to inner `.claude/helpers/` so it ships. `517e097` makes the import-path resolver layout-agnostic. Acceptance `ctrl-autopilot-stop-hook` proves augmentation prints when episodes are populated. | Empty-context silence is contract (no headers when `confidence === 0`). |
| D — queryOptimizer active-use verification | PASS | Fork commit `3cdca80` adds `AgentDBService.getController()` delegate (was missing — that was the real "wiring incomplete" finding). Probe `9e11afa` calls `qo.query(SQL)` ×2 + asserts `qo.getStats().cacheHits ≥ 1`. Final release reports `totalHits=1, totalMisses=1`. | First landing marked skip_accepted as an architectural-gap dodge; user pushback caught it. Root cause was the missing accessor, not an architectural fix. |
| E — `drift-detector.ts` + `swarm-completion.ts` | PASS | `df41fef` (DriftDetector), `b8e6452` (SwarmCompletionCoordinator). `ea83899` pre-cleaned the orphan test fragment. 23/23 it-blocks green in `autopilot-drift-learning.test.ts`; 88/88 in broader autopilot integration surface. | Second binding spec found (`tests/integration/autopilot.test.ts`); Agent 3 implemented union of both contracts. |
| F — `--prefer-offline` cache hardening | PASS | `2720373` adds `_cache_bust_bumped_packages` to `scripts/test-acceptance.sh:259-271`. Hardcoded list of 5 packages (see Implementation deviations). Cleared cleanly on every release run since landing. | Deviation from plan: hardcoded list vs `.last-build-state` parse. |
| G — Phase 3/4/5 deferred | PASS (sub-ADRs written) | ADR-0194 (GNN patterns), ADR-0195 (cross-controller bridges), ADR-0196 (federated interface) all created with `status: proposed`. ADR-0193 itself doesn't implement them. | |

## Late-discovered upstream issues (resolved during execution)

* **Build cascade trap (`scripts/build-packages.sh:296`)**: pre-existing `_af_has_dist == false` guard caused agentic-flow tsc to skip rebuild when dist already existed in `/tmp/ruflo-build`. Combined with rsync's `--filter='P dist/'` (preserves dest dist), this meant fresh fork source NEVER reached published dist. Wave 1's release shipped Phase 2 src with Phase 1 dist. The `ctrl-autopilot-trajectories` probe correctly diagnosed as `trajectories=0 with episodes=4`. Fixed in commit `931864f` — tsc now always runs; `--incremental + .tsbuildinfo` for cache reuse; buildinfo invalidated when src is newer. This bug had been latent — would have masked any future agentic-flow source changes too.
* **Hook path resolver gap**: `autopilot-hook.mjs` hardcoded `__dirname/../../agentic-flow/dist/...` which was right for monorepo dev but resolved to a triple-nested non-existent path in the installed `@sparkleideas/agentic-flow` package. Fixed in commit `517e097` — probes two candidate paths via `existsSync()`; first that exists wins.

## Closing condition (satisfied)

ADR-0193 closes when:

* Items A (sub-items A.1-A.4), B, C, D, E, F all have green
  acceptance checks AND landed commits. **Satisfied** — see verification matrix above. All six PASS; baseline `skip_accepted=9` preserved.
* Item G is documented; sub-ADRs 0194 / 0195 / 0196 are written
  (status: proposed) for Phases 3 / 4 / 5 respectively. **Satisfied** — see follow-up-adrs frontmatter.

Status flipped from `proposed` to `implemented` on 2026-05-19. The "still degraded" inventory in ADR-0192's post-implementation revision section can be removed (the inventory's content has moved here and resolved).

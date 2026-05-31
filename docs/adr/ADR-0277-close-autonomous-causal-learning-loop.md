---
status: accepted
date: 2026-05-31
tags: [causal, learning, sona, intelligence, nightly-learner, daemon, upstream-convergence]
supersedes: []
depends-on: [ADR-0276]
implements: []
---

# Close the autonomous causal-learning loop — schedule NightlyLearner + resolve the learner factory

## Context and Problem Statement

Upstream's causal subsystem carries a vision beyond ADR dependency tracking (ADR-0276): an **agent causal self-learning loop** — episodes → recorded outcomes → causal edges with statistically-computed `uplift`/`confidence` → de-confounded retrieval/decisions. Should the fork *implement* that vision?

A first pass mis-recommended **deferral** on a "no consumer / speculative" basis. A corrected closure audit (2026-05-31, read-only, file:line + live-probe-verified) overturned that: the loop is **~90 % built and SQLite-consistent**, and "no consumer/no producer/disconnected islands" were overstatements. Deferral is the wrong call — and it contradicts the fork's implement-ahead posture (ADR-0177): in this fork, "no consumer yet" is the *norm* for built-ahead capability, not a reason to stop.

### Corrected closure map (file:line)

| Stage | Status | Where |
|---|---|---|
| Episode producer-input | **WIRED live** | `hooks-tools.ts:1762` → `ReflexionMemory.storeEpisode` `ReflexionMemory.ts:189` (SQLite `episodes`, Phase-7 carve-out `substrate-registry.ts:65`) |
| Causal-uplift **producer engine** | **COMPLETE, on-demand only** | `NightlyLearner.run()` `NightlyLearner.ts:125`; `uplift = reward[idx]−reward[i]` `:376`; doubly-robust `:508`; writes SQLite `causal_edges` `:405`. Callers: only `agentdb-cli.ts:507` + MCP `agentdb_learner_run` |
| Causal store (automated) | **WIRED + CONSISTENT** | write `NightlyLearner.ts:405`; read `causal-recall.ts:189` — same SQLite `causal_edges` |
| Causal reranker **consumer** | **WIRED + LIVE** | `routeCausalOp` recall `memory-router.ts:2623` → `causalRecall.search` (β·uplift); MCP `agentdb_causal-recall` `agentdb-tools.ts:1297` |
| Producer **trigger** | **MISSING** | no `worker-daemon.ts` row runs the learner; the 60 s `hooks-learning` daemon (`hooks/src/daemons/index.ts:427`) + the `consolidate` worker (`worker-daemon.ts:1621`) run *consolidation*, not uplift |
| Learner factory resolution | **PREFERS CONSOLIDATOR** | `controller-registry.ts:1692` returns `MemoryConsolidator` when a MemoryService is registered (`:1698-1709`); the real `NightlyLearner` is the fallback branch (`:1739`) |
| Default memory-search consumer | **NON-causal by design** (cosine) | `database-provider.ts:245` → `hybrid-backend.ts`; `LocalReasoningBank` `intelligence.ts:461` |

**The single genuinely-missing piece is an autonomous trigger for the producer** (+ ensuring the scheduled path resolves the real learner, not the consolidator). Everything else — episodes, the doubly-robust engine, the consistent SQLite store, the live causal reranker — already exists.

## Decision Drivers

* ADR-0177 implement-ahead — completing a ~90 %-built loop is the fork's posture; "no consumer yet" is not a blocker (`feedback-no-consumer-is-not-stub`).
* The capability is genuinely new vs the existing SONA loop: SONA is *associative* and structurally cannot de-confound; NightlyLearner's reward-delta/doubly-robust uplift is exactly the de-confounding SONA lacks.
* Surgical: the keystone is *scheduling an existing complete producer* + one factory branch, not building an estimator.
* Don't over-scope: putting causal recall on the *default* hot path and contextualizing the ModelRouter are separate, larger, independently-decidable changes.

## Considered Options

* **A — Defer** (the mis-recommended first pass). REJECTED: contradicts implement-ahead; the loop is ~90 % built (not speculative); a live consumer and a complete producer both exist.
* **B — Close everything at once**: schedule the learner + put causal recall on the default memory-search hot path (replace/augment `LocalReasoningBank` cosine) + contextualize the ModelRouter bandit. REJECTED for this ADR: over-scoped; the hot-path swap and the ModelRouter are separate decisions with their own blast radius.
* **C — Close the autonomous loop minimally (chosen)**: add a scheduled `NightlyLearner.run()` over the episode stream + resolve the real learner in the scheduled path + a smoke proving uplift flows to `agentdb_causal-recall`. Leave the default-hot-path and ModelRouter as adjacent follow-ons.

## Decision Outcome

Chosen option: **"C — close the autonomous loop minimally"**, because the producer is complete and the consumer is live; the only thing standing between the fork and a working autonomous de-confounded causal-learning loop is a scheduler trigger and a factory-resolution fix. That is implement-ahead's final wire, not a research build. B's hot-path swap and ModelRouter work are real but separable (and riskier — they touch the default retrieval path and a deliberate bandit), so they are recorded as follow-ons rather than bundled.

### Rules (implementation)

* **I1 — schedule the producer.** Add an autonomous invocation of `NightlyLearner.run()` over the live `episodes` stream — either a new `worker-daemon.ts` DEFAULT_WORKERS row (`:145`) dispatching `routeLearningOp({type:'run'})`, or extend the existing `consolidate` worker (`:1621`) to also run the learner. Cadence: reuse the consolidate cadence (cheap — `minSampleSize`/`upliftThreshold` guards make it a no-op until enough episodes accrue). **Open sub-decision (flag at build): enabled-by-default (conservative + guarded) vs opt-in worker row** — lean enabled-but-guarded so the loop actually closes, consistent with implement-ahead; confirm at implementation.
* **I2 — resolve the real learner.** Fix `controller-registry.ts:1692` so the scheduled learning path obtains the real `NightlyLearner` (not the `MemoryConsolidator` preference at `:1698-1709`) — either a distinct learner worker that bypasses the consolidator preference, or run both (consolidate AND learn).
* **I3 — confirmation smoke.** `scripts/smoke-adr0277-*.mjs`: write N episodes with varied rewards → trigger the scheduled learner path → assert SQLite `causal_edges` gains rows with **real (non-null) uplift** → assert `agentdb_causal-recall` returns uplift-ranked results. Wire into the canonical harness.
* **Not required here:** the cli manual `agentdb_causal-edge` → RVF-namespace leg (the ADR-0147 R7 / ADR-0276 R1 string→numeric gap, `memory-router.ts:2490`). NightlyLearner writes SQLite directly, so the automated loop closes without it; unifying the manual-edge store is ADR-0276's territory.

### Consequences

* Good, because a complete, de-confounded causal-learning loop becomes autonomous for a small, surgical cost — the live `agentdb_causal-recall` reranker starts being fed real uplift instead of staying cold.
* Good, because it completes implement-ahead: the built engine stops being orphaned.
* Good, because it is genuinely additive to SONA (de-confounding SONA structurally cannot do), not redundant.
* Bad, because a scheduled learner adds periodic compute — mitigated by `minSampleSize`/`upliftThreshold` guards (no-op until enough signal) and a conservative cadence.
* Neutral, because the default `memory-search` stays cosine-only; causal recall remains reached via `agentdb_causal-recall` until a separate decision puts it on the hot path.
* Neutral, because the ModelRouter contextual-uplift refinement and the manual-edge → SQLite unification (ADR-0276 R1/R7) are recorded as follow-ons, not bundled.

### Confirmation

* The I3 smoke green: episodes → scheduled run → non-null `uplift` in `causal_edges` → uplift-ranked `agentdb_causal-recall`. Wired into the acceptance harness; green in a release.

## More Information

- **Depends on / complements ADR-0276** — shared `CausalMemoryGraph` + SQLite `causal_edges` substrate. ADR-0276 re-converges *ADR dependency* edges onto the graph (and its R1 string→numeric map closes the manual-edge → SQLite leg); THIS ADR closes the *autonomous learning* loop (episodes → uplift → recall). Separable; both land on the same substrate.
- **ADR-0147 R7** — the string→numeric memory-ID bridge; relevant only to the optional manual-edge unification, not to the automated loop.
- **ADR-0177** — implement-ahead posture (the basis for completing a built-ahead loop rather than deferring it).
- **Follow-ons (separate decisions):** (a) put causal recall on the default memory-search hot path (`database-provider.ts:245`/`LocalReasoningBank`); (b) contextualize the `ModelRouter` Thompson bandit with per-`(model, task_type)` uplift (`ruvector/model-router.ts`).
- Evidence: corrected closure audit + upstream consumer check + ADR-0276 pre-flight (2026-05-31), all file:line/probe-verified.

## Amendment: implemented + deployed (2026-05-31, patch.388)

Implemented and acceptance-green (`adr0277-causal-learning-loop` PASS); shipped `@sparkleideas/*` patch.388. **The autonomous loop genuinely closes end-to-end** — verified against the deployed artifact: 80 temporally-ordered episodes → the real `NightlyLearner` discovers **1000 causal edges** (`avgUplift 0.45`, `avgConfidence 0.73`) → `agentdb_causal-recall` returns 5 uplift-ranked results.

- **I1 — scheduled producer.** `worker-daemon` `learn` worker (60 min, low priority, `enabled:true` but guarded — the learner no-ops below `minSampleSize`) → `runLearnWorker` → `routeLearningOp({type:'run'})`.
- **I2 — real learner, not the consolidator.** `routeLearningOp({type:'run'})` bypasses the `controller-registry:1692` `MemoryConsolidator` preference to resolve the real `NightlyLearner`; `agentdb_learner_run` (the manual MCP surface) delegates to the same path. Pre-fix both ran the consolidator (`skillsCreated`, zero uplift).
- **Discovery enabler — `ts` on `reflexion-store` (the chosen-(b) capability).** `discoverCausalEdges` needs temporally-ordered episode pairs (`e2.ts > e1.ts`) + confidence `= min(N/100,1)·min(|uplift|/0.5,1) >= 0.6`. The `episodes.ts` column defaulted to `strftime('now')` and the INSERT omitted it, so fast writes shared one second → zero pairs → no discovery on demand. Added an optional `ts` (unix seconds) threaded through `agentdb_reflexion-store` → `ReflexionStoreWriter` → the SQLite INSERT, so callers (tests/replay/backfill) control episode time. A probe (80 same-task, reward-split, distinct-ts episodes) confirmed **503 edges discovered directly** (uplift −0.904, confidence 0.8); the full smoke confirmed **1000 via the MCP/daemon path**.
- **Commits:** agentdb `ea627b1`/`59851d8`/`8291240`; ruflo `5288d0477`/`6c1ead219`/`3e9d36e17`.
- **Follow-ons (unchanged, separate decisions):** causal recall on the default memory-search hot path; ModelRouter contextual-uplift.

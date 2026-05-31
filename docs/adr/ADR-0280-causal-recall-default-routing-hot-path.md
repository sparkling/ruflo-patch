---
status: accepted
date: 2026-05-31
tags: [routing, causal, de-confounding, reasoning-bank, model-router, action-value, intelligence, hot-path]
supersedes: []
depends-on: [ADR-0279, ADR-0278, ADR-0277]
implements: []
---

# Blend learned action-value uplift into the default routing hot path

## Context and Problem Statement

The default retrieval/routing rank is cosine-only: `LocalReasoningBank.findSimilar`
(`intelligence.ts`) ranks candidates by `cosineSim` alone, and the `ModelRouter`
(ADR-0278) selects from its own online bandit prior. Neither consults the
de-confounded action-value the loop now produces (ADR-0279: `E[reward | action,
task_type]`). So routing is **associative** — an agent/model that merely
*co-occurs* with success ranks as high as one that *causes* it. This was the last
ADR-0277 follow-on, gated on B (ADR-0279) because before it there was no clean
candidate→uplift mapping (causal edges are episode-pairs, not actions).

Now that episodes carry the action and the learner aggregates action-value
uplift, blend it into the default rank so routing de-confounds. Two consumers:
the **LocalReasoningBank rerank** (causal recall on the retrieval hot path) and
the **ModelRouter A-coupling** (seed model selection from learned model-uplift).
Both are the riskiest of the three follow-ons — they touch the live path for
*every* task — so the blend is small, flag-gated, with cosine/the-prior as the
floor.

## Decision Drivers

* The action-value signal now exists (ADR-0279) and is exactly the de-confounding
  the decision-consumer audit asked for; not consuming it leaves routing
  associative.
* Blast radius: the default routing rank affects every task — so the change must
  be conservative (small β, flag-gated, cosine as floor) and unit-test-proven.
* Cross-process reality: the learner runs in the daemon `learn` worker; routing
  runs elsewhere — so the signal must cross the process boundary cheaply.
* Symmetry: the same uplift signal serves both consumers (agent-uplift for the
  reasoning-bank rerank, model-uplift for the ModelRouter) via one substrate.

## Considered Options

* **A — leave routing cosine-only / prior-only.** REJECTED: routing stays
  associative; the ADR-0279 action-value is built but unconsumed on the path that
  matters most.
* **B — query the learner synchronously per route.** REJECTED: the learner is in
  another process and `run()` is heavy; a per-route MCP round-trip on the hot
  path is unacceptable.
* **C — persist action-values to a small file; consumers blend it in, flag-gated
  (chosen).** `routeLearningOp('run')` writes `.swarm/action-values.json`; the
  consumers load it (cached, TTL) and blend `β·uplift` into their rank with
  cosine/the-prior as the floor. Cheap on the hot path, cross-process-safe,
  conservative.

## Decision Outcome

Chosen option: **"C — persisted action-value substrate + flag-gated blend"**,
because it feeds the de-confounded signal to the live routers cheaply
(cross-process via a cached file) while keeping the blast radius bounded (small
β, default-off flag, cosine/prior as the floor). Routing becomes de-confounded —
an action that *causes* success outranks one that merely co-occurs — without
risking the default path: with the flag off (default) behavior is byte-identical
to pre-0280.

### Rules (implementation)

* **R1 — substrate.** `learning/action-values.ts`: `persistActionValues(rows)`
  writes `.swarm/action-values.json`; `loadActionValues()` reads + caches (30s
  TTL); `actionUplift(action, taskType)` returns the clamped `[-1,1]` uplift (0
  for unknown — callers fall back). Missing file → uplift 0 → no behavior change.
* **R2 — producer.** `routeLearningOp('run')` (the single point both the daemon
  worker and `agentdb_learner_run` flow through) persists
  `report.actionValues` after `NightlyLearner.run()`. Best-effort.
* **R3 — consumer C (reasoning-bank rerank).** `LocalReasoningBank.findSimilar`
  blends `β·actionUplift(patternAction, taskType)` into the SORT only; the cosine
  `score` stays the relevance FLOOR (threshold filters on cosine; returned
  `confidence` echoes cosine) so uplift reranks *within* the relevant set but
  never admits a sub-threshold candidate. β via `RUFLO_ROUTE_ACTION_UPLIFT` (0 =
  off, default).
* **R4 — consumer A-coupling (ModelRouter).** `selectModel` scales each sampled
  score by `(1 + γ·actionUplift(model, taskType))` (clamped ≥ 0) — complementary
  to the router's own online prior (ADR-0278). γ via `ModelRouterConfig.actionUpliftGamma`
  (0 = off, default).

### Consequences

* Good: the default routing/retrieval rank de-confounds — causal recall on the
  hot path, the last ADR-0277 follow-on, closed.
* Good: bounded blast radius — flag-gated (both default off → identical
  behavior), small β/γ, cosine/prior as the floor; the blend is unit-proven.
* Good: one substrate serves both consumers; cross-process via a cheap cached
  file (no hot-path MCP round-trip).
* Neutral: implement-ahead until the flags are enabled in a deployment; the
  signal and the blend ship, gated off.
* Bad: a stale `.swarm/action-values.json` (learner not run recently) blends old
  uplift — bounded by the TTL re-read and that uplift only *reranks* within the
  cosine-relevant set; never overrides the floor.

### Confirmation

* **Unit** (`__tests__/action-values.test.ts` + `router-bandit.test.ts`): the
  substrate (persist/load/lookup, taskType fallback, clamp, absent-file→0); the
  `findSimilar` rerank deterministically flips a higher-cosine low-uplift pattern
  below a lower-cosine high-uplift one while the cosine floor still filters
  sub-threshold candidates; the ModelRouter γ-blend shifts selection toward the
  learned high-uplift model.
* **Smoke** (`scripts/smoke-adr0280-routing-action-uplift.mjs`, wired into
  `scripts/test-acceptance.sh` + `.github/workflows/v3-ci-routing-uplift.yml`):
  action-tagged episodes → `agentdb_learner_run` → assert the run persisted
  de-confounded uplift to `.swarm/action-values.json` (the shipped bridge).
  FAILs pre-impl (never persisted), PASSes after this lands.

## More Information

- **Depends on ADR-0279** — the `actionValues` aggregate this persists and
  consumes; without the action dimension there is no candidate→uplift mapping.
- **Depends on ADR-0278** — the ModelRouter A-coupling blends on top of the
  contextual bandit prior (complementary signals: the router's own loop + the
  episode-stream uplift).
- **Completes ADR-0277's follow-on set** — (a) ModelRouter contextual bandit
  (ADR-0278), (b) episodes action dimension (ADR-0279), (c) causal recall on the
  default hot path (this). The branch is implement-ahead (ADR-0177): the blend
  ships flag-gated.
- The upstream `HybridReasoningBank` (with CausalRecall) remains unconsumed in
  the fork; this fork-native blend reuses the live `LocalReasoningBank` instead
  of swapping the bank.
- Evidence: ADR-0277 follow-on handover (2026-05-31), file:line-verified;
  cosine-only default confirmed at `intelligence.ts` `findSimilar`.

---
status: accepted
date: 2026-05-31
tags: [routing, bandit, thompson-sampling, model-router, learning, de-confounding, intelligence]
supersedes: []
depends-on: [ADR-0268]
implements: []
---

# ModelRouter contextual-uplift bandit — stratify Thompson priors by task-type

## Context and Problem Statement

`ModelRouter` (the cost-adjusted Thompson-sampling model selector introduced as
#1772) carries **unconditional** Beta priors — one `BetaPrior` per model
(`priors?: Record<ClaudeModel, BetaPrior>`, `model-router.ts`). It learns
`E[reward | model]` *marginalized over all tasks*. That conflates easy and hard
work: "haiku tends to succeed" is true on average precisely because most tasks
are simple, so the marginal can rank haiku above opus even on task-types where
haiku reliably fails. This is the de-confounding gap the decision-consumer audit
named — and `ModelRouter` is the **one real consumer** with a closed outcome
loop (`hooks_model-route` → `hooks_model-outcome`), so it is the right and
self-contained place to fix it.

The fix needs **no new data and no causal coupling**: the router already
observes its own `success/failure/escalated` outcomes per task. Stratifying
those outcomes by task-type turns the marginal `E[reward | model]` into the
contextual `E[reward | model, task_type]` — learned online from the router's own
loop. `deriveTaskType` already exists (`learning/derive-task-type.ts`, ADR-0268)
and is the stable grouping key.

This is the first of the three causal-subsystem follow-ons flagged by ADR-0277
(the other two — an `action` dimension on episodes, and causal recall on the
default memory-search hot path — depend on shared data plumbing and are
recorded separately). This one stands alone.

## Decision Drivers

* The conflation is real and the consumer is live — this is the single decision
  surface running on a confounded proxy, not a build-ahead capability.
* Surgical: one file (`model-router.ts`) plus a stats-surface line; the external
  API (`route`, `recordOutcome`) is unchanged — the task-type is derived
  internally.
* Graceful cold-start is mandatory: model selection is a live hot path (#1772
  deliberate design), so an unseen task-type must never be starved — it must
  degrade to today's behavior, then improve as evidence accrues.
* Reuse, don't invent: `deriveTaskType` (ADR-0268) is the existing stable
  task-type key; stratifying by it is the whole mechanism.

## Considered Options

* **A — keep the marginal bandit.** REJECTED: leaves the one real consumer on a
  confounded proxy; haiku stays over-selected on hard task-types.
* **B — couple to the NightlyLearner uplift.** REJECTED for this ADR: the
  learner emits uplift over episode→episode *pairs* (numeric ids), not over
  `(model, task_type)`; episodes carry no action dimension yet (ADR-0277's
  shared gap), so there is no clean candidate→uplift mapping. Over-couples a
  self-contained online improvement to unbuilt data plumbing.
* **C — contextual priors keyed by `(task_type, model)` (chosen).** Stratify the
  Beta priors per derived task-type; back off to a pooled per-model marginal for
  unseen task-types. Per-task-type stratification *is* the de-confounding; it
  learns `E[reward | model, task_type]` from the router's own loop with no new
  dependency.

## Decision Outcome

Chosen option: **"C — contextual priors"**, because it removes the confound at
its source (stratify the outcome stream by task-type) with no new data, no
causal coupling, and a graceful cold-start that degrades to the pre-0278 bandit
for never-seen task-types. The de-confounding is exactly what per-task-type
stratification buys: a model can win one task-type while losing another, which a
single marginal prior structurally cannot represent.

### Rules (implementation)

* **R1 — key priors by `(task_type, model)`.** `RouterState.priors` becomes
  `Record<string, BetaPrior>` keyed `` `${deriveTaskType({description: task})}:${model}` ``.
  `recordOutcome` updates that contextual prior.
* **R2 — pooled marginal + cold-start backoff.** Add `globalPriors:
  Record<ClaudeModel, BetaPrior>`, updated on every outcome. `selectModel` draws
  from the contextual prior when it exists; otherwise it backs off to
  `globalPriors[model]`, then to uniform Beta(1,1). An unseen task-type is never
  starved — it degrades to the marginal (today's behavior), then de-confounds as
  per-task-type evidence accrues.
* **R3 — preserve the Thompson + cost-prior semantics.** The cost-adjusted
  Bernoulli rewards (`BANDIT_REWARDS`: haiku-success 1.0 > sonnet 0.7 > opus 0.4;
  failure/escalated penalize) and the Beta draw are unchanged — only the prior
  the draw reads is now task-type-conditioned.
* **R4 — flag + migration.** Behind `ModelRouterConfig.contextualPriors`
  (default `true`; `false` = pure marginal, pre-0278 behavior). Persisted state
  migrates: a pre-0278 per-model-keyed `priors` file is loaded as `globalPriors`
  (old learning preserved as the marginal) and contextual priors start empty.
* **R5 — observability.** `getContextualPriors()` / `getExpectedReward()`
  accessors; `hooks_model-stats` surfaces `contextualPriors` + `globalPriors` so
  the de-confounding is observable (a model winning one task-type while losing
  another).

### Consequences

* Good: the one live decision consumer stops conflating easy and hard work;
  haiku is no longer over-selected on task-types where it fails, because the
  per-task-type prior down-weights it there specifically.
* Good: no new data, no NightlyLearner dependency — learned online from the
  router's existing outcome loop.
* Good: cold-start is graceful — unseen task-types behave exactly as before, so
  the hot path is never starved; the flag is a clean kill-switch.
* Neutral: each task-type now has a short noisier cold period (1–2 outcomes)
  while its contextual prior fills in — bounded, and Thompson sampling explores
  through it by design.
* Bad: a tiny amount of extra per-decision work (`deriveTaskType` over the task
  string, two prior lookups) — negligible on the routing hot path.

### Confirmation

* **Unit** (`__tests__/router-bandit.test.ts`): stratification flips the winner
  per task-type while the marginal does not; cold-start backs off to the pooled
  marginal; pre-0278 state migrates into `globalPriors`; `route()` selection
  shifts by task-type; the flag falls back to the marginal. The 6 pre-existing
  #1772 convergence tests stay green (their generic task strings all map to the
  `general` task-type, so the contextual `general:*` prior equals the marginal).
* **Smoke** (`scripts/smoke-adr0278-model-contextual-bandit.mjs`, wired into
  `scripts/test-acceptance.sh` + `.github/workflows/v3-ci-contextual-bandit.yml`):
  drives the deployed MCP surface — `hooks_model-outcome` for two task-types
  where different models win, then `hooks_model-stats` — and asserts the
  contextual winner flips per task-type (frontend→haiku, database→opus) while
  the pooled marginal still ranks haiku>opus for both. FAILs pre-impl (no
  `contextualPriors` surface; one marginal prior cannot flip the winner), PASSes
  after this lands.

## More Information

- **Amends the #1772 Thompson-bandit lineage** (`model-router.ts` "See ADR-101"
  comment refers to that bandit work; there is no `docs/adr/ADR-0101` routing
  ADR in this corpus — ADR-0101 here is the fork-readme program — so this is
  recorded as a new sequential ADR rather than an amendment to a non-existent
  file).
- **Depends on ADR-0268** — `deriveTaskType` is the stable task-type grouping
  key, called identically on write (`recordOutcome`) and read (`route`/
  `selectModel`).
- **Follow-on context (ADR-0277)** — the other two follow-ons (episodes carry an
  `action` dimension → action-value causal learning; causal recall on the
  default memory-search hot path) are gated on shared data plumbing and recorded
  separately. This ADR is deliberately NOT coupled to the NightlyLearner: per
  the honest-notes of the handover, "uplift" here means per-task-type
  stratification, which *is* the de-confounding for the online bandit.
- Evidence: decision-consumer audit (the one real consumer on a weak proxy) +
  ADR-0277 follow-on handover (2026-05-31), file:line-verified.

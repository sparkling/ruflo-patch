---
status: accepted
date: 2026-05-31
tags: [causal, learning, nightly-learner, episodes, reflexion, action-value, implement-ahead, intelligence]
supersedes: []
depends-on: [ADR-0277, ADR-0268]
implements: []
---

# Episodes carry an `action` dimension → action-value causal learning

## Context and Problem Statement

ADR-0277 closed the autonomous causal-learning loop: episodes → `NightlyLearner`
→ `causal_edges` (uplift) → uplift-ranked `agentdb_causal-recall`. But the
learner's uplift is computed over **episode→episode pairs** (numeric ids) — it is
*task-sequence* value, not *action* value. Both decision consumers want uplift
keyed by **`(action, context)`**: the `ModelRouter` wants `E[reward | model,
task_type]` and default routing wants `E[reward | agent, task_type]`. The
`episodes` table records **no action dimension** (`schema.sql` — `model` columns
elsewhere are *embedding* models), so the loop's output cannot be keyed to the
decision. This is the shared prerequisite the ADR-0277 follow-ons named: without
it, neither router can ask "what does *doing X* cause?".

This is the keystone that turns the loop's output into `E[reward | action,
context]`. Per ADR-0177 (implement-ahead), the capability is built first; the
consumers (the ModelRouter A-coupling and causal recall on the default hot path)
then read it — those are separate, gated decisions and are NOT built here.

## Decision Drivers

* The loop already exists (ADR-0277) and is fed the episode stream; adding the
  action dimension is the minimal change that makes its output action-keyed.
* `deriveTaskType` (ADR-0268) already provides the stable `task_type`; the only
  missing axis is the action taken.
* Surgical plumbing: mirror the ADR-0277 `ts` thread exactly (MCP tool → handler
  → adapter → SQLite INSERT) + an idempotent additive column migration; the
  substantive part is one aggregate query on the learner.
* Don't over-scope: capturing the action and aggregating it is the prerequisite;
  *consuming* it (seed ModelRouter priors, rerank routing) is separable and
  riskier (touches live hot paths), so it is deferred per ADR-0277's plan.

## Considered Options

* **A — leave episodes action-less.** REJECTED: the loop's uplift stays keyed to
  episode-pairs, so neither router can map a candidate (model/agent) to learned
  value — the de-confounded action-value the audit asked for is unreachable.
* **B — two columns (`model` + `agent`).** REJECTED for now: the handover frames
  a single "action dimension," and one generic column serves both consumers (the
  model-routing decision point tags the model; the agent-routing point tags the
  agent). Two columns double the plumbing for a distinction the immediate
  consumer (model-uplift) doesn't need; revisit if a consumer needs both axes on
  the *same* episode.
* **C — a generic `action TEXT` column + an `E[reward | action, task_type]`
  aggregate (chosen).** Episodes carry the action actually taken; the learner
  gains a queryable action-value aggregate. Minimal, mirrors the `ts` thread,
  and unblocks both consumers via the same column.

## Decision Outcome

Chosen option: **"C — generic action column + action-value aggregate"**, because
it is the minimal keystone that makes the loop's output action-keyed, mirrors a
proven plumbing thread (ADR-0277 `ts`), and uses a safe additive migration. The
learner gains `E[reward | action, task_type]` with a de-confounded uplift (the
action's mean reward minus the task-type baseline) — exactly the signal the
routers will consume, surfaced through the existing `agentdb_learner_run` report.

### Rules (implementation)

* **R1 — schema + migration.** Add `action TEXT` to `episodes` (`schema.sql`);
  add `action` to the idempotent `AgentDB.ensureEpisodeColumns()` `ALTER` loop so
  existing dbs gain the column at init (fresh dbs get it from schema.sql). The
  runtime `ALTER` is the actual guarantee — the column exists regardless of
  schema-copy timing.
* **R2 — thread the field (mirror ADR-0277 `ts`).** `Episode.action` →
  `ReflexionMemory` both INSERT paths (fallback + `dualWriteEpisodeToSQL`) →
  `ReflexionStoreWriter` input (`capabilities.ts`) → `AgentdbReflexionStorePayload`
  + handler forward (`reflexion-store.ts`) → the `agentdb_reflexion-store` MCP
  tool (schema + parse + dispatch) → the cli adapter `makeCliReflexionStoreWriter`.
  **The adapter also fixes a latent ADR-0277 gap**: it mapped fields explicitly
  and dropped `ts` (so `ts` only flowed incidentally via per-call subprocess
  latency); now both `ts` and `action` are forwarded.
* **R3 — producer.** The post-task hook (`hooks_post-task` → `agentdb_reflexion-store`)
  records `action = (the model the caller used) ?? (the agent)`.
* **R4 — learner aggregate.** `NightlyLearner.computeActionValues()` returns one
  row per `(action, task_type)` with `meanReward` (`E[reward | action, task_type]`),
  `samples`, `baselineReward` (`E[reward | task_type]` over all actions),
  `uplift` (`mean − baseline`), and a `confidence` ramp. `run()` snapshots it
  into `LearnerReport.actionValues`, surfaced via `agentdb_learner_run`.

### Consequences

* Good: the loop's output becomes action-keyed — the keystone for both deferred
  consumers (ModelRouter A-coupling, causal recall on the default hot path).
* Good: surgical and safe — additive column + idempotent `ALTER`; the field
  thread mirrors a proven path; the aggregate is one `GROUP BY`.
* Good: fixes the latent ADR-0277 `ts`-drop in the cli adapter (ts now actually
  flows, not just incidentally via subprocess latency).
* Neutral: implement-ahead — `actionValues` has no in-fork consumer yet (ADR-0177
  norm). The ModelRouter A-coupling and the default-hot-path rerank read it next.
* Bad: capture depends on producers passing the model/agent; episodes from
  callers that don't set it record `action = NULL` and are excluded from the
  aggregate (`WHERE action IS NOT NULL`) — capture improves as producers adopt it.

### Confirmation

* **Smoke** (`scripts/smoke-adr0279-episodes-action-dimension.mjs`, wired into
  `scripts/test-acceptance.sh` + `.github/workflows/v3-ci-episode-action.yml`):
  write action-tagged episodes for one task-type where different actions earn
  different rewards → `agentdb_learner_run` → assert `report.learned.actionValues`
  ranks the high-reward action above the low-reward one with `uplift > 0 >`
  the other. FAILs pre-impl (no action column/param; the adapter drops the field;
  no aggregate), PASSes after this lands.

## More Information

- **Depends on ADR-0277** — the autonomous loop this extends (shared episode
  stream + `NightlyLearner.run()`); ADR-0277's `ts` thread is the plumbing
  template (commits `8291240` agentdb / `3e9d36e17` ruflo), and R2 closes its
  latent adapter gap.
- **Depends on ADR-0268** — `deriveTaskType` supplies the `task_type` axis the
  aggregate groups by.
- **ADR-0177** — implement-ahead: build the capability; the consumers read it.
- **Deferred consumers (separate decisions, gated on this):** (a) seed/blend the
  `ModelRouter` contextual priors (ADR-0278) from learned model-uplift; (b)
  rerank the default routing hot path (`intelligence.ts` `LocalReasoningBank`) by
  agent-uplift. Both were explicitly held until this column exists.
- Evidence: ADR-0277 follow-on handover + decision-consumer audit (2026-05-31),
  file:line-verified; the action-less `episodes` schema confirmed at `schema.sql`.

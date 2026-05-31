# Session Handover — 2026-05-31 — Causal-subsystem follow-ons

The causal re-convergence + autonomous-learning program (ADR-0276 + ADR-0277) is **DONE and deployed (`@sparkleideas/*` patch.388, acceptance-green)**. This doc hands off the **three follow-on items** that were flagged "open by design" — with concrete designs, file:line anchors, the shared data gap, and a sequencing recommendation. None is started.

> Context refs: [[project-causal-loop-implemented-adr0276-0277]] (memory), `docs/adr/ADR-0276-*`, `docs/adr/ADR-0277-*` (both `accepted` + implementation-amended).

## What's already shipped (the substrate these build on)

- **Controller re-convergence (ADR-0276):** `routeCausalOp` answers `cause=`/`effect=` via the real `CausalMemoryGraph` controller (`memory-router.ts`); ADR ids allocated in `adr_node_ids` (reserved `>= 1<<30`). `queryCausalCauses` added for `effect=`. Cascade-delete clears SQLite + KV.
- **Autonomous loop (ADR-0277):** daemon `learn` worker + `agentdb_learner_run` → `routeLearningOp({type:'run'})` → the real `NightlyLearner` (consolidator-preference bypassed). `agentdb_reflexion-store` gained a `ts` param. **The loop closes**: episodes → `NightlyLearner.discoverCausalEdges` → `causal_edges` (uplift) → `agentdb_causal-recall` (uplift-ranked). Verified: 1000 edges end-to-end.

## THE SHARED GAP (read this first — it reframes the three items)

`NightlyLearner` produces uplift over **episode→episode pairs** (`causal_edges`, numeric ids). But both routers want uplift keyed by **`(action, context)`** — `E[reward | model, task_type]` or `E[reward | agent, task_type]`. **The `episodes` table records no action dimension** (`agentdb/src/schemas/schema.sql:21` — no `model`/`agent`/`provider` column; the `model` columns elsewhere are *embedding* models). So the *causal-coupled* version of routing needs episodes tagged with the action taken. **One follow-on sidesteps this entirely** (learns from its own outcome loop); the other is gated on it.

So this is really: **1 self-contained MVP + 1 shared prerequisite + 2 consumers**, not 3 independent fixes.

---

## Item A — ModelRouter contextual-uplift bandit (self-contained MVP; DO FIRST)

**Problem.** `ModelRouter` is a Thompson-sampling bandit whose Beta priors are **unconditional** — `priors?: Record<ClaudeModel, BetaPrior>` (`model-router.ts:199`), `defaultBanditPriors()` (`:260`). It learns "haiku tends to succeed" marginalized over all tasks → conflates easy and hard work (the de-confounding gap the decision-consumer audit named; this is the *one real consumer* with a closed outcome loop). Cites "ADR-101".

**Fix (no new data, no causal coupling — learns contextual value from its OWN loop):**
1. Key priors by **`(task_type, model)`** — `Record<string, BetaPrior>` keyed `` `${deriveTaskType(task)}:${model}` ``. `deriveTaskType` **already exists** (`v3/@claude-flow/cli/src/learning/derive-task-type.ts:64`, ADR-0268).
2. `selectModel` (`model-router.ts:504`) draws from the current task-type's priors; **fall back to a global/`defaultBanditPriors` prior for unseen task-types** (cold-start — must be graceful).
3. `recordOutcome` (`model-router.ts:602-641`) updates the `(task_type, model)` prior instead of the per-model one.

That *is* the de-confounding: per-task-type stratification stops the conflation. `E[reward | model, task_type]` learned online, no `NightlyLearner` dependency.

- **Scope:** one file (`model-router.ts`); careful cold-start fallback; preserve the Thompson draw + cost-prior semantics. Persisted priors file shape changes (`Record<model>` → `Record<taskType:model>`) — handle migration/old-shape load (treat old as the global fallback).
- **Risk:** model selection is a live hot path (ADR-101 deliberate design). Behind the existing config or a flag; the cold-start fallback must never starve a never-seen task-type.
- **Record as:** an **ADR-101 amendment** (contextual priors).
- **Verify:** a smoke that records outcomes for two task-types where different models win, then asserts `selectModel` diverges by task-type (the contextual prior actually changes the choice).

---

## Item B — `action` dimension on episodes (the SHARED PREREQUISITE for causal-coupled routing)

**Why.** Without it, `NightlyLearner` uplift is task-sequence value, not action value — so neither router can ask "what does *doing X* cause?". This is the keystone that turns the loop's output into `E[reward | action, context]`.

**Fix:**
1. **Schema:** add `model TEXT` and/or `agent TEXT` (and maybe a generic `action TEXT`) to the `episodes` table (`agentdb/src/schemas/schema.sql:21`) + thread through `ReflexionMemory.storeEpisode` INSERT (`ReflexionMemory.ts:189` — same place the ADR-0277 `ts` was added) + `ReflexionStoreWriter` (`capabilities.ts:283`) + the `agentdb_reflexion-store` MCP tool (`agentdb-tools.ts:1135`) — mirror the `ts` plumbing exactly (commits `8291240`/`3e9d36e17` are the template).
2. **Producer:** the post-task hook that writes episodes (`hooks-tools.ts:1762`, `hooks_post-task` → `agentdb_reflexion-store`) records the model/agent actually used (the route result already has `model` at `hooks-tools.ts:1574`).
3. **Learner:** extend `NightlyLearner.discoverCausalEdges` / `calculateOutcomeModel` (`NightlyLearner.ts:443`/`:568`) to stratify by the action dimension (or add an `E[reward | action, task_type]` aggregate the routers can query) — this is the substantive part; the rest is plumbing.

- **Scope:** medium-large, cross-fork (agentdb schema/learner + ruflo hook). A real data-model change.
- **Risk:** schema migration on the live `episodes` table (additive column, defaults safe). The learner change is where the design effort is.
- **Record as:** a **new ADR** ("episodes carry the action dimension → action-value causal learning"). Note this is implement-ahead (ADR-0177) — build the capability; the consumers (A-coupling, C) then read it.

---

## Item C — causal recall on the default memory-search hot path (gated on B)

**Problem.** The default retrieval is cosine-only: `database-provider.ts:245` wires `hybrid-backend.ts` (no causal); the live `LocalReasoningBank` (`intelligence.ts:461`, returned by `getReasoningBank()` at `:1187`) ranks by `cosineSim` + SARSA confidence. The causal reranker exists and is live **only as a manual surface** — `routeCausalOp({type:'recall'})` (`memory-router.ts:2623`) / `agentdb_causal-recall` (`agentdb-tools.ts:1297`) → `causal-recall.ts:189` (`U = α·sim + β·uplift − γ·latency` over `causal_edges`). The upstream `HybridReasoningBank` (with CausalRecall) exists but is unconsumed in the fork (`agentic-flow-bridge.ts:28`, imported by nothing).

**Fix (after B lands):** blend learned `β·uplift` into the default routing/retrieval rank — i.e. `LocalReasoningBank`'s ranking (`intelligence.ts:461`) consults the action-value uplift (from B) for each candidate agent/pattern, so routing is de-confounded (an agent that *causes* success ranks above one that merely co-occurs). Without B there is no clean candidate→uplift mapping (causal edges are episode-pairs, not agents), so this stays gated.

- **Scope:** medium; touches the live routing hot path (`intelligence.ts` / `hooks_route`). Higher blast radius than A.
- **Risk:** changing the default routing rank affects every task. Blend with a small `β` + flag; keep cosine as the floor.
- **Record as:** part of the B-consumer ADR, or its own.

---

## Recommended sequencing

1. **Item A** — ship the clean, self-contained ModelRouter contextual bandit (real win, no new data). ADR-101 amendment.
2. **Item B** — build the episodes `action` dimension (the enabler). New ADR; implement-ahead.
3. **Items A-coupling + C** — once B exists, both routers consume `E[reward | action, context]`: seed/blend the ModelRouter priors from learned uplift, and rerank default routing by agent-uplift.

Do NOT build C or the A-coupling before B — they have no candidate→uplift mapping until episodes carry the action (the corpus-evidence-before-feature discipline: the uplift signal literally cannot be keyed to the decision yet).

## Key file:line index

| Area | Anchor |
|---|---|
| ModelRouter priors / select / outcome | `forks/ruflo/v3/@claude-flow/cli/src/ruvector/model-router.ts:199, 260, 504-549, 602-641`; complexity `:120-121,190` |
| deriveTaskType (ADR-0268) | `forks/ruflo/v3/@claude-flow/cli/src/learning/derive-task-type.ts:64` |
| Default hot path (cosine) | `intelligence.ts:461, 1187`; `database-provider.ts:245`; `hybrid-backend.ts` (no causal) |
| Causal reranker (live, manual) | `memory-router.ts:2623`; `agentdb-tools.ts:1297`; agentdb `archivist/handlers/agentdb/causal-recall.ts:189` |
| Episodes schema (no action col) | agentdb `src/schemas/schema.sql:21`; INSERT `ReflexionMemory.ts:189`; writer `capabilities.ts:283`; tool `agentdb-tools.ts:1135` |
| NightlyLearner discovery | agentdb `src/controllers/NightlyLearner.ts:443 (discoverCausalEdges), 376 (uplift), 508 (gate), 568 (outcomeModel)` |
| Post-task episode producer | `hooks-tools.ts:1762` (writes episode); route model at `:1574` |

## Honest notes

- **A needs no causal coupling** — it's a contextual bandit improvement, framed as "uplift" because per-task-type stratification *is* the de-confounding. Don't over-couple it to the NightlyLearner.
- **The whole branch is OPTIONAL / implement-ahead.** The decision-consumer audit found exactly one real consumer (ModelRouter) on a weak proxy; everything else is associative-by-design and advisory. So A is the only item with a *current* consumer; B+C are build-ahead capability per ADR-0177. Don't frame B/C as "bugs."
- **`agentdb_learner_run` nests metrics under `report.learned.*`** (not top-level) — relevant if any new smoke parses its output.

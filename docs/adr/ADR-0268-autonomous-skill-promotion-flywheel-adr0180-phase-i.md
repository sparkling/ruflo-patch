---
status: accepted
completed: false
date: 2026-05-28
tags: [learning, skills, reflexion, archivist, adr-0180-phase-9, upstream-vision, flywheel]
supersedes: []
depends-on: [ADR-0053, ADR-0082, ADR-0170, ADR-0177, ADR-0179, ADR-0180]
implements: []
---

> **Status (2026-05-28)**: `accepted` (the design below is ratified — the
> maximal performance+features choice) but `completed: false` until the
> ordered plan in §Implementation lands and the §Confirmation round-trip
> passes. This ADR realizes the autonomy residual handed to **ADR-0180
> Phase 9** when [[ADR-0179]] was superseded — i.e. it builds the
> autonomous feedback→skill-promotion flywheel that upstream designed but
> deferred. A 5-expert design council (2026-05-28, parallel Agent fan-out)
> produced the synthesis; every claim below is grounded in HEAD file:line.

# ADR-0268 — Autonomous skill-promotion flywheel (ADR-0180 Phase 9 realization)

## Context and Problem Statement

[[ADR-0179]] catalogued "SkillLibrary auto-promotion on feedback" as the one
genuinely-lost bridge behaviour. The mechanism `NightlyLearner.run()` →
`SkillLibrary.consolidateEpisodesIntoSkills` was wired (agentdb `ebf73a5`), and
[[ADR-0179]] was superseded into [[ADR-0180]] Phase 9 with the **autonomy
residual** left open. This ADR closes that residual.

**The upstream vision** (`ruvnet/ruflo` origin/main
`v3/implementation/planning/LEARNING-OPTIMIZED-PLAN.md:180-225`,
`postTask(task,result)`): on task completion — record an episode
(`reflexion.store`, reward=`result.quality`), promote a skill keyed on
`task.skillName || task.type` (gated on `success && quality>0.8`), and observe a
causal edge keyed on `task.type`. `ADR-053:531` explicitly deferred this
post-task→controller wiring as **"future work"** — it was never built upstream
either. So this is genuine implement-ahead per [[ADR-0177]], not a port.

**The flywheel is broken at four points (council, code-verified at HEAD):**

1. **No autonomous episode recording.** The live post-task path
   (`hooks_post-task` → `routeFeedbackOp 'record'`, `memory-router.ts:2125-2179`)
   writes `learningSystem`+`reasoningBank`+a `feedback-{taskId}` key — it
   **never writes the `episodes` table**.
2. **Batch consolidation is starved.** `consolidateEpisodesIntoSkills` reads
   `FROM episodes` (`SkillLibrary.ts:539`); nothing autonomously populates it, so
   the `ebf73a5` wiring is dead-on-arrival in production.
3. **The grouping key never groups.** `GROUP BY task` where `episodes.task` is
   the free-text *description* → every task unique → `HAVING COUNT(*) >= 3`
   never trips → **no skill ever forms**. Upstream keys grouping on coarse
   `task.type` and keeps `description` separate; the fork collapsed both onto one
   column.
4. **The retrieval half is dark.** Nothing injects skills pre-task;
   `hooks_pre-task` returns only agent suggestions + routing; the lone retrieval
   attempt (`hooks-tools.ts:1073`) probes `skills.search` (the real method is
   `retrieveSkills`/`searchSkills`) → promotion is **write-only, zero value**.

Plus: the only promotion trigger (`session_end`, `hooks-tools.ts:2376`) calls
`registry.consolidate()` — **a non-existent method** (bug #88, swallowed by
`.catch()`); and `reward = quality ?? (success?0.85:0.2)` is caller-supplied and
defaults `0.85 > 0.7 minReward`, so every defaulted success would auto-promote —
and that quality never reaches `episodes.reward` anyway.

## Decision Drivers

* **Fulfill the upstream vision** (mandatory) — skills form automatically from
  high-reward task outcomes, keyed on task type, and get **reused**.
* **Close the whole flywheel** — record → promote → **retrieve**. Promotion
  without retrieval is write-only; retrieval is the value gate.
* **Trustworthy promotion** — keep the `minAttempts=3 / minReward=0.7` gate
  that makes a promoted skill sound; never mint from `n=1`.
* **Performance** ([[ADR-0170]] C.3) — the request hot path pays only a cheap
  indexed lookup + an insert; all embedding/consolidation cost is batched.
* **Fail-loud** ([[ADR-0082]]) — promotion/record failures surface
  (discriminating re-throw), never silent `catch {}`.

## Considered Options

* **A — Literal upstream inline skill upsert** (`createOrUpdate` per task when
  `quality>0.8`). **Rejected** on fork-specific correctness: [[ADR-0177]]
  removed per-feedback `promote()`; inline+batch collide on `skills.name UNIQUE`
  with non-commutative running-average corruption + double-counted `uses`; a
  single-shot `quality>0.8` is strictly weaker than the batch gate; and it puts
  an embedder call on the fail-loud hot path.
* **B (chosen) — Record-inline + batch-promote + retrieve-pre-task.** Episode
  record at the completion site (writes `episodes` only); skill promotion stays
  the batch `consolidateEpisodesIntoSkills` (sole writer of `skills`); skills
  injected pre-task. Disjoint write targets → no contention. Fulfils the
  upstream *intent* via the fork-correct shape.
* **task.type: field-overload vs column.** **Chosen: a real `task_type`
  column** (upstream's two-field model) over overloading `episodes.task`.
  Rationale = retrieval quality: with the column, `description` is preserved and
  skill embeddings are built from rich text → strong semantic recall; overload
  makes the skill name a terse slug → weak cosine. The SQLite migration cost is
  accepted.
* **Site: single vs both + anchor.** **Chosen: both, anchored at
  `executeAgentTask`** (`agent-execute-core.ts:419`, the universal agent
  chokepoint — every invocation yields a complete episode) **+ `hooks_post-task`**
  (`hooks-tools.ts:1610`, the documented hook covering externally-driven flows),
  idempotent by `taskId`.

## Decision Outcome

**Option B, maximal: both sites + `task_type` column + record-inline /
batch-promote / retrieve-pre-task, routed through the archivist dispatch.**

The archivist `dispatch()` **already mints a root `MutationContext`**
(`forks/agentdb/src/archivist/index.ts:977-1008`), so this is **not** gated on
the 110-call-site F4-3 program. Two phases:

* **Phase A (this ADR's `completed` bar) — root-audited, manifest-deferred.**
  Episode-record + skill-consolidate go through registered dispatch handlers
  (root audit entries real); the consolidate write-bodies stay on the legacy
  SQLite path (do **not** pass `ctx` into `consolidateEpisodesIntoSkills` — it
  would hit the `bulkDispatch` throw-stub at `index.ts:1004`).
* **Phase B (deferred, the deep ADR-0180 Phase 9 seam)** — route the consolidate
  write-bodies through `ctx.substrate.withBulkWrite`, wire `bulkDispatch`, so the
  `ctx.child('skill')` → `ctx.bulk(...)` audit-tree manifests become real.

### task.type taxonomy

`deriveTaskType()` — a single shared util, **byte-identical on write and read
sides** (or the keyed retrieval silently misses). Tiered:

1. explicit `taskType` (new optional payload field) → slug;
2. structural: `task_create.type` (`task-tools.ts:46`) / `agent_spawn.agentType`
   (`agent-tools.ts:48`);
3. classified: the existing **17-label `KEYWORD_PATTERNS`** vocabulary
   (`hooks-tools.ts:695` — `auth/api/test/refactor/performance/security/database/
   frontend/backend/bug/fix/feature/swarm/memory/deploy/ci-cd`), today used only
   for agent suggestion, promoted to the canonical task-type vocabulary;
4. fallback `general`. **Never** `taskId` (per-instance) or the raw description.

Normalize to a slug (lowercase, `[^a-z0-9]+→-`, ≤128 chars). Collisions are
*desirable* at grouping (lets `COUNT>=minAttempts` accumulate); guard harmful
merges with an **intra-group embedding-cohesion** check (mean pairwise cosine of
the grouped episodes ≥ threshold — `episode_embeddings` already exist). Optional
resolution knob: compound `${label}:${agentType}`.

### Where else (ranked value × reach)

| Rank | Site | Value-add |
|---|---|---|
| #1 anchor | `executeAgentTask` (`agent-execute-core.ts:419`) | Every agent invocation becomes a training example; pre-call retrieve→inject at `:466`, post-success record at `:475`. The Voyager flywheel (`SkillLibrary.ts:7`), wired at a chokepoint upstream never reached. |
| #2 | `hooks_post-task` (`hooks-tools.ts:1610`) | Already 4/6 wired; covers PostToolUse/autopilot/swarm flows. |
| #3 | swarm/hive `queen-coordinator.learnFromOutcome:2462` | Cross-agent knowledge transfer — highest value density. |
| #4 | session-end | Demote to batch backstop; fix the dead `consolidate()` + re-throw fatals. |
| #5–7 | autopilot loop, post-edit/command, task_complete | Long-horizon replanning; finer recall; complementary. |

## Consequences

* Good — the autonomous flywheel exists end-to-end (record→promote→retrieve);
  the `ebf73a5` mechanism gets fuel; the `agentdb_learner_run` tool stops lying.
* Good — compounding: a skill learned on one `task_type` accelerates later
  same-type tasks via pre-task injection; wired at `executeAgentTask` it lights
  up every agent product-wide — **more complete than upstream ever built**.
* Good — performance: hot path = one indexed `SELECT … WHERE name=?` + one
  `INSERT`; embedding/consolidation amortized in batch; in-memory HNSW for the
  semantic fallback.
* Risk (skeptic) — **reward integrity**: `quality` is caller-supplied + defaulted;
  must route `quality → episodes.reward` and stop the `0.85` default from
  auto-clearing `minReward`. Mitigation: absent quality is NOT promotion-eligible.
* Risk — **task.type quality**: collision-blend vs never-group. Mitigation:
  controlled vocabulary + cohesion guard; corpus-walk the real `episodes.task`
  distribution before finalizing the bucketer ([[feedback-corpus-evidence-before-feature-work]]).
* Risk — **hot path / fail-loud**: record is a cheap deferred insert; promotion is
  batch (off path). Both fail-loud-discriminating, never swallowed. No embedder
  on the per-task path.
* Risk — **inline+batch dedup**: structurally disjoint (recorder writes only
  `episodes`; consolidation is sole `skills` writer). Episodes deduped by
  `taskId` across the two record sites.

## Implementation (ordered; scope is not a constraint)

1. **`deriveTaskType()`** shared util (KEYWORD_PATTERNS vocabulary); write+read identical.
2. **agentdb data layer** — `task_type` column on `episodes` (schema.sql + ALTER
   migration for existing dbs); `Episode` gains `taskType`/`code` (+ carry
   `output`/`critique`); `consolidateEpisodesIntoSkills` `GROUP BY task_type`;
   `createSkill` records `code`; cohesion guard.
3. **agentdb SkillLibrary** — `retrieveSkillByType(type)` exact-match
   (`SELECT … WHERE name=?`) + keep `retrieveSkills({task:description})` semantic
   fallback.
4. **cli record (inline)** — at `executeAgentTask` (+ `hooks_post-task`,
   idempotent by `taskId`): write a full Episode via `agentdb_reflexion_store`
   dispatch with derived `task_type`, `reward←quality`, `output`, `code`. Route
   `quality→episodes.reward`; fix the `0.85`-default promotion-eligibility.
5. **cli retrieve (pre-task)** — `executeAgentTask:466` + `hooks_pre-task` +
   fix the dead `hooks_route:1073` probe; inject relevant skills into the prompt.
6. **cli promote (batch)** — keep `ebf73a5`; new `agentdb_skill_consolidate`
   dispatch handler + capability; fix/replace the dead `session_end` trigger;
   add a threshold trigger so skills form within-session.
7. **CI** — acceptance round-trip (episode populated → skill formed → retrieved
   & reused) into `test-acceptance*.sh` (run_check_bg + collect_parallel, both)
   + `.github/workflows/`, against a fresh-init'd installed package.
8. **Phase B (separate)** — `withBulkWrite` + `bulkDispatch` for the deep audit tree.

Build order per [[feedback-commit-forks-before-release]]: agentdb committed +
built first, then cli, then `npm run release`.

## Confirmation

* Round-trip acceptance: a task run 3× for one `task_type` (reward ≥ 0.7)
  auto-promotes a skill; a subsequent same-type task retrieves it pre-task.
* `episodes` populated by the autonomous path (not just the manual MCP tool).
* `agentdb_learner_run` / session-end consolidation reports `skillsCreated/Updated > 0`.
* No post-task hot-path regression; promotion failure surfaces (not silent).
* Flip `completed: true` only when all of the above pass under `npm run release`.

## More Information

* [[ADR-0179]] row 6 + Option-B amendment — the superseded residual this realizes.
* [[ADR-0180]] §Re-entrancy / §Phase 9 — the tracker this closes.
* `LEARNING-OPTIMIZED-PLAN.md` (upstream) — the deferred vision.
* `ADR-053:531` (upstream) — "future work" deferral confirming no upstream impl.

## Amendment: record-site refinement — `executeAgentTask` is retrieve-only (2026-05-29)

Implementation surfaced the skeptic's **R3 (reward integrity)** as load-bearing,
and an upstream re-check (code + plan + ADR intent) settled it. **The Decision
Outcome's "both record sites" is refined: `executeAgentTask` RETRIEVES only;
the reward-bearing RECORD happens at `hooks_post-task`.**

Why: `executeAgentTask` (`agent-execute-core.ts:419`) is the LLM-call primitive —
its `result` is `{success, output, usage, durationMs, stopReason}` with **no
quality/reward signal** (`success` only means the call returned). Recording
promotion-eligible episodes there would default every success to a high reward,
clear `minReward 0.7`, and manufacture junk skills from single calls.

Upstream agrees at all three levels:
* **Code** — `agentic-flow` has no agent-executor that records episodes with a
  computed reward (only the manual CLI / benchmarks do).
* **Plan** — `LEARNING-OPTIMIZED-PLAN postTask(task, result)` records with
  `reward = result.quality` (a caller-supplied `TaskResult` field), never derived
  at a primitive.
* **ADR intent** — `ADR-053 #1209` puts feedback recording at the **`post-task`
  hook on success/failure**; `#1215` promotes **from high-reward trajectories**.
  No upstream ADR records at an execution primitive.

Refined shape (everything else in this ADR unchanged):
* **`executeAgentTask` → RETRIEVE** — derive `task_type`, inject the matching
  skill pre-call. Preserves the "every agent invocation benefits" value via the
  read half (skill *reuse* needs no reward).
* **RECORD at `hooks_post-task`** (the fork's analogue of upstream `postTask`,
  already wired for `recordFeedback` per #1209) — `reward = quality`, with the
  integrity gate: explicit quality is promotion-eligible; absent/defaulted
  quality records a sub-threshold reward (not auto-promotable). The gate is a
  fork improvement — upstream assumes `TaskResult.quality` is always present.
* **Later: swarm `queen-coordinator.learnFromOutcome:2462`** as a second
  reward-bearing record site (it carries a computed reward — upstream's SONA/
  worker-learning subsystem is the model).

---
status: proposed
completed: false
date: 2026-05-29
tags: [learning, skills, flywheel, adr-0268-followons, deferred-with-trigger]
supersedes: []
depends-on: [ADR-0268, ADR-0180, ADR-0181, ADR-0147, ADR-0257]
implements: []
---

> **Status (2026-05-29)**: `proposed`, `completed: false` — a queryable
> defer-with-trigger tracker (per [[ADR-0257]]) for the five follow-ons
> [[ADR-0268]] deferred. [[ADR-0268]] is `completed: true` (the flywheel —
> record→promote→retrieve — is delivered + CI-verified); its deferred items
> were recorded only as prose bullets inside that completed ADR, so an
> `adr-index` "outstanding work" query (`completed: false`) would never surface
> them. This ADR is that surface: each item carries an explicit **trigger
> condition** ("until when") so the work is trackable, not silently aged. A
> 2026-05-29 validation swarm verified — against fresh upstream + fork HEAD —
> that **none of the five was ever built upstream** (the upstream `postTask`
> plan is pseudocode against undefined types; cohesion guard + Phase B are
> fork-only constructs). So every item is genuine implement-ahead, not a missing
> port, and every deferral in [[ADR-0268]] is justified.

# ADR-0269 — Skill-promotion flywheel: deferred follow-ons (trigger-tracked)

## Context and Problem Statement

[[ADR-0268]] realized the autonomous skill-promotion flywheel ([[ADR-0180]]
Phase 9 residual handed forward from [[ADR-0179]]) and flipped to
`completed: true` after the `adr0268-flywheel` acceptance smoke passed 5/5
(record ×3 → session-end promote → pre-task retrieve). Five items were
**explicitly deferred** in its final amendment as out-of-scope follow-ons. They
were correct to defer, but were recorded only as prose inside a `completed`
ADR — the silent-defer shape [[ADR-0257]] / `[[feedback-no-fallbacks]]` warn
against. This ADR makes them queryable with concrete triggers.

## Decision Outcome

Defer each item with its named trigger below. This ADR stays
`status: proposed, completed: false` so it surfaces in the outstanding-work
query; when a trigger fires, the relevant item is built (and, if large, spun
into its own ADR — e.g. the `code`-producer). Phase B's *implementation*
tracker remains [[ADR-0180]] §Phase 9; it is listed here only so the deferral is
visible in one place.

| # | Follow-on | Value | Blocker | Trigger ("until when") | Effort |
|---|-----------|-------|---------|------------------------|--------|
| 1 | **`code` at record** — promoted skills carry the real solution artifact | **High** (Voyager skills *are* code, not just descriptions) | No code-bearing producer exists (upstream `result.code` is fictional; `hooks_post-task` carries none) | A producer that captures the solution artifact (diff/code/tool-calls) at task completion is built + threaded through `hooks_post-task` → episode → skill | Medium (the producer is the work; the column is already plumbed end-to-end) |
| 2 | **Phase B** — route consolidate writes through `ctx.substrate.withBulkWrite`; un-stub `bulkDispatch` for the audit manifest | Medium (full replay/audit coverage of skill writes) | Data-integrity risk (collapsing N running-average updates into one txn); `bulkDispatch` throw-stub; general case needs F4-3 | Broad: **F4-3** ([[ADR-0181]] Phase 5) lands. Narrow skill-only slice: **Phase-9 load/replay coverage** ([[ADR-0180]] scenario-a/b) exists **and** an audit-completeness requirement appears | Narrow ~moderate; broad = the F4-3 program |
| 3 | **Cohesion guard** — intra-group embedding-cohesion check before merging episodes into a skill | Medium (prevents a coarse `task_type` bucket blending divergent episodes) | Threshold needs a real episode corpus to calibrate (`[[feedback-corpus-evidence-before-feature-work]]`) | A real `episodes` corpus exists **and** a corpus-walk shows a bucket blending divergent work (or a user reports a wrong/blended injected skill) | Small (~30–50 LoC; `episode_embeddings` + `cosineSimilarity` already exist, unused in the consolidate path) |
| 4 | **causal-observe re-keyed on `task.type`** — aggregate causal edges per task-type, not per-instance | Low until R7 | The real `CausalMemoryGraph` write path is dead per **[[ADR-0147]] R7** (numeric-ID gap); re-keying alone touches only the namespace fallback | **[[ADR-0147]] R7** lands (real causal write path reachable), making type-keyed aggregation feed real causal-gain math | Small (~few lines; `deriveTaskType` exists) but cosmetic until R7 |
| 5 | **Within-session threshold trigger** — promote mid-session after N episodes, not only at session-end | Low (latency-only) | None (the reward gate already secures correctness; this is earlier same-session reuse) | Telemetry/usage shows long single sessions that re-hit one `task_type` ≥`minAttempts` early then again later | Small (~15–25 LoC; idempotent, composes with the session-end backstop) |

## Per-item detail

### 1. `code` at record — *highest latent value, hardest blocker*
- **Upstream:** planned only — `postTask` pseudocode `createOrUpdate({code: result.code})` against an undefined `TaskResult`/`result.code`; upstream's real `consolidateEpisodesIntoSkills` leaves `skill.code` empty too.
- **Pro:** turns promoted skills from descriptions into reusable reference code — the actual Voyager payoff and the single biggest quality jump available to the flywheel.
- **Con:** not buildable without inventing the producer side (capturing the solution artifact). Minting now = empty/garbage `code`. The column is correctly pre-plumbed; do **not** fabricate.

### 2. Phase B — *primary tracker is [[ADR-0180]] §Phase 9*
- **Upstream:** no equivalent — the archivist / `withBulkWrite` / `bulkDispatch` are fork-only ([[ADR-0180]]); upstream's controller writes raw SQLite with no `ctx`.
- **Fork state:** `withBulkWrite` is fully implemented across substrates; only `bulkDispatch` is a throw-stub (`index.ts:1004`), and it is **unreachable in prod** (no `ctx` flows into `consolidate`) — so Phase A ("don't pass ctx") is correct and safe.
- **Pro:** complete audit-tree manifests for skill-promotion writes.
- **Con:** collapsing N running-average updates into one transaction is a real data-loss surface → needs the Phase-9 load/replay coverage to land honestly, or it's an un-exercised path. Phase A already gives root-level audit.

### 3. Cohesion guard
- **Upstream:** none — cosine is used only at retrieval ranking, never consolidation; no ADR ever conceived it. It is a *fork-introduced* concern that exists **because** the fork groups on a coarse `task_type` (upstream's free-text `GROUP BY task` rarely groups, so upstream never faced blending).
- **Pro:** prevents low-cohesion buckets minting garbage skills; cheap infra.
- **Con:** the threshold is a guess without a corpus — a mis-calibrated guard (over-split → no skills; under-guard → no protection) is worse than the current state, where the 17-label vocabulary already bounds blast radius to one bucket.

### 4. causal-observe on `task.type`
- **Upstream:** planned only — `observeAndLearn({action: task.type})` (method doesn't exist); the real `CausalMemoryGraph` is an A/B-experiment model keyed on numeric episode IDs ([[ADR-0053]] #1223 = the A/B framework, **not** a type key).
- **Fork state:** the post-task causal edge already exists but is instance-keyed (`taskId`), landing in the `causal-edges` namespace fallback (the real controller path is dead per [[ADR-0147]] R7).
- **Pro:** type-level causal aggregation (which task-types cause success) for planning/routing.
- **Con:** out-of-scope for the *skill* flywheel (the causal edge feeds nothing in it); the real payoff is gated behind [[ADR-0147]] R7; re-keying before R7 is cosmetic (improves only the fallback).

### 5. Within-session threshold trigger
- **Upstream:** the plan *showed* inline per-task promotion, but against the non-existent `skills.createOrUpdate`, and **never built it**; all real upstream callers are batch/nightly. [[ADR-0177]] removed per-feedback `promote()`; the fork's batch model is the deliberate replacement.
- **Pro:** earlier same-session skill reuse; idempotent + backstopped by session-end.
- **Con:** latency-only — the reward gate (defaulted quality → 0.6 < `minReward` 0.7) already guarantees soundness, so session-end batch promotion is correct; a mid-session trigger only buys earlier reuse within a long session.

## Confirmation

* `adr-index` filter `status:proposed AND completed:false AND tag:adr-0268-followons` surfaces this ADR as outstanding work.
* Each trigger above is concrete (a corpus walk, an R7 landing, an F4-3 landing, a producer being built, a usage pattern) — checkable without re-reading [[ADR-0268]]'s narrative.
* Phase B's implementation tracker stays [[ADR-0180]] §Phase 9; the causal-observe payoff gate stays [[ADR-0147]] R7. This ADR cross-references, does not duplicate, those.
* When a trigger fires: build the item (spin a dedicated ADR if large — e.g. the `code`-producer), then strike it from this tracker; when all five are resolved or re-homed, flip this ADR `completed: true`.

## More Information

* [[ADR-0268]] — the flywheel; §"validation swarm + completion" amendment is the source of these deferrals.
* [[ADR-0180]] §Phase 9 — Phase B implementation tracker.
* [[ADR-0181]] — F4-3 / archivist runtime activation (the broad Phase B program; closed without Phase 9).
* [[ADR-0147]] R7 — the causal numeric-ID gate for item 4.
* [[ADR-0257]] — the defer-with-trigger pattern this ADR follows.

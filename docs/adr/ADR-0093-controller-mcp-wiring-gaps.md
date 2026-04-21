# ADR-0093: Controller MCP Wiring Gaps — Audit & Remediation Plan

- **Status**: Implemented — 2026-04-21
- **Date**: 2026-04-16
- **Scope**: `@claude-flow/cli` MCP tool handlers + `@sparkleideas/agentdb` controller constructors
- **Related**: ADR-0090 (Tier B5 — the swarm that surfaced these gaps), ADR-0086 (Debt 15 — the original controller-persistence trade-off), ADR-0089 (Controller Intercept Pattern)
- **Surfaced by**: ADR-0090 Tier B5 12-agent verifier swarm + 8-agent fixall swarm (2026-04-16)

## Context

ADR-0090 Tier B5 set out to verify that each of the 15 neural controllers claimed by ADR-0086's Debt 15 trade-off actually persists state to SQLite via a write → readback → restart round-trip.

The 12-agent verifier swarm (swarm-1776366604818) discovered that the entire controller layer was unreachable from the CLI's MCP surface. A cascade of 4 fork-patch waves progressively fixed the bridge:

1. **`ensureRouter()` on cold MCP calls** — `listControllerInfo` / `healthCheck` / `getController` were all operating on a null registry in fresh CLI processes because no memory operation had triggered `_doInit()`.
2. **`waitForDeferred()` delegated to the registry** — was a silent no-op (delegated to `controller-intercept.waitForDeferred()` which doesn't exist). Level 2+ controllers (13 of 15 B5 targets) never finished background init.
3. **Method-name drift in MCP handlers** — v3 AgentDB renamed `ReflexionMemory.store` → `storeEpisode`, `retrieve` → `retrieveRelevant`, `CausalMemoryGraph.getEffects` → `queryCausalEffects`, etc. Handler guards (`typeof ctrl.store !== 'function'`) silently rejected the real instances. Fix: `getCallableMethod(ctrl, 'newName', 'oldName')`.
4. **Missing constructor schema init** — ReflexionMemory and SkillLibrary never ran `CREATE TABLE IF NOT EXISTS` on their SQLite tables (other controllers do). The DDL was only in `agentdb-mcp-server.ts` (a standalone boot path not wired into the CLI's ControllerRegistry).

After all 4 waves, the B5 scorecard is **4 PASS / 11 SKIP_ACCEPTED / 0 FAIL**.

This ADR documents the 11 remaining gaps: which are patchable and which are legitimately SKIP by design.

## Findings

### Tier 1 — Patchable (5 controllers, same pattern as existing fixes)

These controllers have a real persistence path that is reachable but not wired into the MCP handler layer, or need a check-side adaptation to exercise their write path correctly.

#### 1. causalGraph

**Current state**: SKIP_ACCEPTED — `agentdb_causal-edge` calls `addEdge` but the query-side handlers were patched to `getCallableMethod` while the write-side `addCausalEdge` was not.

**Root cause**: The `agentdb_causal-edge` MCP handler at `agentdb-tools.ts:216-250` calls `routeCausalOp({type: 'edge', sourceId, targetId, ...})` which goes through `memory-router.ts:routeCausalOp`. The router's `edge` case calls `getCallableMethod(ctrl, 'addCausalEdge', 'addEdge')` — but the router-fallback fires before the controller is tried because the underlying `CausalMemoryGraph` needs the `causal_edges` table created in its constructor (same class of bug as ReflexionMemory/SkillLibrary).

**Fix**: Add `CREATE TABLE IF NOT EXISTS causal_edges (...)` in `CausalMemoryGraph.ts` constructor. DDL available at `schemas/schema.sql`. ~10 LOC.

**Post-fix B5 check**: should flip to PASS (store → row count → restart → row count).

#### 2. learningSystem

**Current state**: SKIP_ACCEPTED — "LearningSystem controller not available" or "no store MCP tool wired".

**Root cause**: `agentdb_experience_record` handler at `agentdb-tools.ts:1354` routes to **ReflexionMemory**, not LearningSystem. LearningSystem's `recordExperience()` method is never called from any MCP tool. The `agentdb_learning_predict` handler correctly finds LearningSystem (method `predict` exists per forensics), but predict is read-only.

**Fix**: Either (a) add a new `agentdb_learning_record` MCP tool that calls `learningSystem.recordExperience()`, or (b) add `learning_experiences` schema init to LearningSystem constructor + wire `agentdb_experience_record` to call learningSystem instead of reflexion. Option (b) is less scope — the constructor already `CREATE TABLE`s `learning_experiences` at `LearningSystem.ts:118`. The missing piece is the MCP tool routing. ~15 LOC.

**Post-fix B5 check**: should flip to PASS via `learning_experiences` table.

#### 3. memoryConsolidation

**Current state**: SKIP_ACCEPTED — `agentdb_consolidate` returns exit 0 with zero-counter report (no candidates to consolidate in a cold-start project).

**Root cause**: `MemoryConsolidation.consolidate()` early-returns without calling `this.logConsolidation(report)` when `getConsolidationCandidates()` returns zero rows (because `hierarchical_memory` is empty in a freshly init'd project). The INSERT into `consolidation_log` only fires on the non-empty-candidates path. Additionally, `consolidation_log` has no text marker column — its schema is entirely numeric (`id/timestamp/execution_time_ms/episodic_processed/...`).

**Fix**: Check-side. Seed `hierarchical_memory` with an episodic row via `agentdb_hierarchical_store` BEFORE running `agentdb_consolidate`. Verify via numeric-timestamp-window query (`SELECT COUNT(*) FROM consolidation_log WHERE timestamp >= $start_ms`). ~20 LOC in the check.

**Post-fix B5 check**: should flip to PASS.

#### 4. nightlyLearner

**Current state**: SKIP_ACCEPTED — `NightlyLearner controller not available`.

**Root cause**: Forensics showed `NightlyLearner.run` method ✓ exists on the v3 class. The MCP handler at `agentdb-tools.ts:1307` checks `typeof learner.run === 'function'` which should succeed. Most likely the same deferred-init race — `nightlyLearner` is Level 4 (INIT_LEVELS:492), and the `waitForDeferred` fix may not complete before the timeout. Or NightlyLearner needs a table created (same pattern as ReflexionMemory).

**Fix**: Verify constructor schema init; if missing, add `CREATE TABLE IF NOT EXISTS nightly_runs (...)`. If the issue is timeout, increase the `waitForDeferred` budget for Level 4. ~10 LOC.

**Post-fix B5 check**: should flip to PASS.

#### 5. explainableRecall

**Current state**: SKIP_ACCEPTED — `no such table: causal_edges` (cross-controller dependency).

**Root cause**: `ExplainableRecall.createCertificate()` writes to `recall_certificates` but requires `causal_edges` to exist for its causal-chain lookup. The table doesn't exist because CausalMemoryGraph doesn't create it in its constructor (see item #1 above). Fix causalGraph first → explainableRecall follows.

**Fix**: Depends on #1 (causalGraph). After `causal_edges` is created, verify if `recall_certificates` also needs constructor init. If so, add it. ~5 LOC.

**Post-fix B5 check**: should flip to PASS.

### Tier 2 — Legitimately SKIP by design (6 controllers)

These controllers do NOT have a SQLite write-readback path and SKIP_ACCEPTED is the honest verdict. They should remain SKIP_ACCEPTED with narrow regexes that auto-flip to FAIL if upstream ever adds a write surface.

#### 6. attentionService

Pure-compute controller (Flash Attention configuration, benchmarking, metrics collection). `AttentionService.js` has zero SQL surface — no INSERT, no CREATE TABLE, no `this.db`. Constructs with `{numHeads, headDim, embedDim, useFlash, useMoE}` only. The `agentdb_attention_*` tools (configure/metrics/benchmark) are getter-style; none write rows.

**Verdict**: SKIP_ACCEPTED. Regression guard: flip to FAIL if `attention_*` table ever appears in sqlite_master or a `agentdb_attention_record` tool is registered.

#### 7. gnnService

**NAPI-RS** bridge (not WASM — correction from the 6-agent verification swarm) to `@sparkleideas/ruvector-gnn`. `GNNService.js` (639 LOC) has zero matches for persist/save/store/write/INSERT/sqlite/CREATE TABLE/this.db — pure compute (forward passes, cosine similarity, attention weights). The native `.node` binary (`strings` scan) also has zero SQL. Controller-registry passes only `{inputDim}` — no db handle. Zero `agentdb_gnn*` MCP tools exist.

**Verified**: 2026-04-16 (`/tmp/verify-gnnService.md`). CONFIRMED_NO_PERSIST.

**Verdict**: SKIP_ACCEPTED.

#### 8. semanticRouter

**⚠️ Corrected by 6-agent verification swarm (2026-04-16).** The original claim "routes queries, doesn't store" is WRONG for one of four SemanticRouter classes.

Three classes are genuinely stateless (in-memory `Map`, zero I/O):
- `agentdb/services/SemanticRouter` — `addRoute`/`route`/`removeRoute`
- `agentic-flow/routing/SemanticRouter` — `registerAgent`/`route`/`detectMultiIntent`
- `cli/ruvector/semantic-router` — in-memory intents + embeddings

One class HAS full persistence: `agentdb/backends/rvf/SemanticQueryRouter` (verified at `/tmp/verify-semanticRouter.md`):
- `save(path)` / `load(path)` via `node:fs/promises`
- `persist()` for immediate flush to `_persistencePath`
- `schedulePersist()` with 5-second debounce, auto-triggered on `addIntent`/`removeIntent`
- Wired from `SelfLearningRvfBackend` via `routerPersistencePath` config

**Currently dormant** because `routerPersistencePath` is optional (`string | undefined`) and never set by any caller in the CLI, memory package, or init-generated config. Zero semantic/router files on disk in live probes.

**Verdict**: SKIP_ACCEPTED for B5 (persistence is **JSON file**, not SQLite — B5 checks are SQLite-scoped). But the documented reason is "has JSON persistence but no SQLite path; dormant in current config" NOT "read-only by design."

**Follow-up**: If `routerPersistencePath` is ever wired into the init template, a file-based round-trip check (not SQLite) should be added. Track in Tier C.

#### 9. graphAdapter

**Correction from verification swarm**: graphAdapter does NOT use RVF (`.rvf` file format with SFVR/RVF\0 magic). It uses `@sparkleideas/ruvector-graph-node`, a NAPI-RS native addon backed by **redb** (a pure-Rust embedded B-tree KV store). Storage path: `{dbPath}.graph`. Zero SQLite operations in `GraphDatabaseAdapter.js` (verified: 0 matches for INSERT/CREATE TABLE/.prepare/.exec/sqlite/memory.db). The `strings` scan of the native binary also returned 0 SQLite hits.

Routing is fully isolated: `AgentDB.initialize()` gates graph via `config.enableGraph` (separate branch from SQLite). `db-unified.js` mode `'graph'` uses `GraphDatabaseAdapter`; mode `'sqlite-legacy'` uses sql.js — completely separate branches.

**Verified**: 2026-04-16 (`/tmp/verify-graphAdapter.md`). CONFIRMED_RVF_ONLY (technically redb, not RVF — but non-SQLite either way).

**Verdict**: SKIP_ACCEPTED for B5. A graphAdapter round-trip check would need a redb-native probe, which is Tier C scope.

#### 10. sonaTrajectory

No dedicated `agentdb_sona_*` store tool exists in the CLI dispatcher. The `hooks_intelligence_trajectory-start|step|end` hooks are disabled-by-default and don't target `sona_trajectories`. `agentdb_pattern_store` is hardwired to ReasoningBank and cannot dispatch to SonaTrajectory (confirmed by verifier: response contains `"controller":"reasoningBank"`).

**Verdict**: SKIP_ACCEPTED. Controller is `return false` by default in `isControllerEnabled()`.

#### 11. causalRecall

Read-only recall controller. The only 2 MCP tools (`agentdb_causal_recall`, `agentdb_causal_query`) call `.search()` not `.recall()`. `CausalOpType` union has no `'store'` variant. The `.recall()` code path writes via `explainableRecall.createCertificate()` (a different controller) — but the MCP path never reaches it because it calls `.search()` instead.

**Verdict**: SKIP_ACCEPTED.

## Decision

### Tier 1 — Patch in next session (committed scope)

Items 1-5 above. Estimated effort: ~60 LOC of fork patches (constructor schema inits + one MCP tool re-route) + ~20 LOC check-side (memoryConsolidation priming). Expected post-patch B5 score: **9 PASS / 6 SKIP / 0 FAIL**.

Ordered by dependency:
1. causalGraph (unblocks #5)
2. explainableRecall (depends on #1)
3. learningSystem
4. nightlyLearner
5. memoryConsolidation (check-side)

### Tier 2 — Accept as SKIP (permanent, documented)

Items 6-11. These controllers are correct to SKIP — they don't persist to SQLite by design. The B5 check's regression-guard regexes are the correct long-term mechanism: if upstream ever adds a write surface, the regex stops matching and the check falls through to the row-count verification path.

## Acceptance criteria

This ADR is implemented when:
1. Items 1-5 are patched (fork + check-side) and their B5 checks flip to PASS.
2. Items 6-11 remain SKIP_ACCEPTED with documented reasons in the check source (already done in `lib/acceptance-adr0090-b5-checks.sh`).
3. The B5 scorecard reads ≥ 9 PASS / ≤ 6 SKIP / 0 FAIL.
4. ADR-0090 Tier A1 Debt 15 check remains PASS (reflexion round-trip, count_after_store=1, count_after_reopen=1).

## Silent-pass violations found during this investigation

Documented in `/tmp/fixall-silent-pass-audit.md` (2026-04-16). NOT fixed in this ADR's scope (separate concern):

1. `agentdb_feedback` — returns `{success:true, updated:1}` with zero rows written. Both primary paths (`learningSystem.recordFeedback`, `reasoningBank.store`) silently fail via `catch {}` in `memory-router.ts:1199,1218`.
2. `hooks_intelligence_pattern-store` — reads `params.type` instead of documented `patternType`; when writes fail returns `controller:"none"` but MCP wrapper still `[OK] Tool executed`.
3. `acceptance-adr0079-tier3-checks.sh:398` — wrong trigger name (`consolidation` vs `consolidate`) + regex matches response-key substrings even when all counters are 0.
4. `agentdb_causal-edge` — write/read split-brain: `addEdge` fails → KV-store fallback with unicode-arrow key; subsequent `causal_query` reads in-memory graph, returns `results:[]`.

These are tracked for a separate ADR or a follow-up pass within ADR-0090.

## References

- ADR-0090 Tier B5 swarm sessions (2026-04-16):
  - 12-agent verifier swarm `swarm-1776344929436-34u1im` (architect + 11 per-controller reports)
  - 12-agent implementation swarm `swarm-1776366604818-ih6byt` (builder + 11 verifiers)
  - 8-agent fixall swarm `swarm-1776370651103-qx7djp` (forensics + 5 triagers + auditor + builder)
- Fork commits (forks/ruflo main): `e408085d8`, `8802b026d`, `250d4c04c`, `907b8d20e`, `65a43d91d`
- Fork commits (forks/agentic-flow main): `b14a664` (SkillLibrary), `7a977f1` (ReflexionMemory)
- Verifier reports: `/tmp/b5-verify-*.md`, `/tmp/fixall-*.md`
- Architect report: `/tmp/b5-architect.md` (297 lines, canonical per-controller matrix)
- Registry forensics: `/tmp/fixall-registry-forensics.md` (method-name drift root cause)

## Status Update 2026-04-21

- Old: Proposed — 2026-04-16. New: Implemented — 2026-04-21.
- Tier 1 fork patches all landed in `forks/agentic-flow`:
  - #1 causalGraph — `8238837 fix: ADR-0090 B5 (W2-I3) — CausalMemoryGraph constructor CREATEs causal_edges table`.
  - #2 learningSystem — addressed by composed routing; `check_adr0090_b5_learningSystem` wired at `lib/acceptance-adr0090-b5-checks.sh:1147` via `agentdb_experience_record` → `learning_experiences` table.
  - #3 memoryConsolidation — check-side priming landed; `check_adr0090_b5_memoryConsolidation` at `:1194` seeds `hierarchical_memory` then asserts `consolidation_log` row growth.
  - #4 nightlyLearner — `d7f613a fix(agentdb): auto-create causal_experiments + causal_observations in NightlyLearner constructor (W2-I3 follow-up #2)`.
  - #5 explainableRecall — `b340e90 fix(agentdb): auto-create recall_certificates table in ExplainableRecall`.
  - Companion constructor-DDL fixes for ReflexionMemory (`7a977f1`), SkillLibrary (`b14a664`), sonaTrajectory registration (`794ad50`).
- Tier 2 items 6-11 remain SKIP_ACCEPTED by design; regression regexes live in `lib/acceptance-adr0090-b5-checks.sh` (1768 LOC) and auto-flip to FAIL if upstream ever adds a write surface (per the original Tier 2 spec).
- Acceptance criterion #4 ("ADR-0090 Tier A1 Debt 15 check remains PASS") verified via ADR-0094 full-cascade closure on 2026-04-21 (see `docs/adr/ADR-0094-log.md` closure audit); B5 scorecard target of ≥9 PASS / ≤6 SKIP / 0 FAIL satisfied.
- Rationale: every Tier 1 item has both a fork-source code pointer (commit SHA) and a wired acceptance check with a table-backed round-trip assertion. Moves from Proposed to Implemented.
- Remaining work: the 4 silent-pass violations logged in `/tmp/fixall-silent-pass-audit.md` (agentdb_feedback, hooks_intelligence_pattern-store, acceptance-adr0079-tier3 consolidation regex, agentdb_causal-edge split-brain) were explicitly out of scope for this ADR and remain follow-ups — track in a separate ADR or a focused pass under ADR-0094 follow-ons.

### Follow-up 2026-04-21 — NightlyLearner causal_experiments schema migration (advisory A1)

- **Surfaced by**: `docs/reviews/adr0069-swarm-review-2026-04-21.md` advisory A1. The ADR-0069 swarm updated the Tier 1 #4 fix (commit `d7f613a`) by replacing the OLD column list (`ts`, `intervention_id`, `control_outcome`, `treatment_outcome`, `uplift`, `sample_size`, `metadata`) — which had been lifted verbatim from `agentdb-mcp-server.ts:147-175` — with the canonical column list from `frontier-schema.sql:52-78` (`name`, `hypothesis`, `treatment_id`, `treatment_type`, `control_id`, `start_time`, `end_time`, `sample_size`, `treatment_mean`, `control_mean`, `uplift`, `p_value`, `confidence_interval_{low,high}`, `status`, `confidence`, `metadata`). Problem: the wrapper was still `CREATE TABLE IF NOT EXISTS`, so installations that first booted against the `d7f613a` OLD-schema DDL silently kept the old columns; subsequent INSERTs from `CausalMemoryGraph.createExperiment` and UPDATEs from `CausalMemoryGraph.calculateUplift` would then fail at runtime with "table causal_experiments has no column named <x>". This follow-up was out of ADR-0069's scope.
- **Fix**: `packages/agentdb/src/controllers/NightlyLearner.ts` constructor now runs `PRAGMA table_info(causal_experiments)`, detects the OLD column set (`intervention_id|control_outcome|treatment_outcome`) and missing NEW columns (`name|treatment_id|...|confidence_interval_high`), and `DROP`s both `causal_observations` (child, FK-dependent) then `causal_experiments` (parent) before the canonical `CREATE TABLE IF NOT EXISTS` recreate. Approach (a) — version-stamped destructive recreate — chosen because `causal_experiments`/`causal_observations` hold ephemeral A/B-test telemetry; no user-authored content to preserve, so ADR-0086's content-preservation rule does not apply. Migration failure re-throws (ADR-0082 loud-fail), not silently falls through.
- **Test**: `tests/unit/adr-0093-nightly-learner-migration.test.mjs` — 13/13 pass. Group 1 source invariants (cites ADR-0093 + A1, PRAGMA introspection, OLD-col detection set, child-first DROP order, canonical NEW column list, ADR-0082 re-throw). Group 2 behavioral round-trip via `sqlite3` CLI: seeds OLD schema, runs detector + DROP + CREATE orchestration, asserts (i) NEW columns present, (ii) OLD columns gone, (iii) `createExperiment`-style INSERT succeeds, (iv) `calculateUplift`-style UPDATE on all 6 result columns succeeds. Group 3 schema parity against `frontier-schema.sql` for both `createExperiment` INSERT target columns and `calculateUplift` UPDATE target columns.
- **Build**: only pre-existing cross-fork `@types/node`/module-resolution errors; zero new errors in `NightlyLearner.ts` (grep `NightlyLearner.ts` on the build log = 0 matches).
- **Files**: fork source — `/Users/henrik/source/forks/agentic-flow/packages/agentdb/src/controllers/NightlyLearner.ts` lines 94-206 (migration + canonical DDL). Test — `/Users/henrik/source/ruflo-patch/tests/unit/adr-0093-nightly-learner-migration.test.mjs`. Not committed; fork branch `main`.

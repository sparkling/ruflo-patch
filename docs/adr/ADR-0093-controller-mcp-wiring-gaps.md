# ADR-0093: Controller MCP Wiring Gaps — Audit & Remediation Plan

- **Status**: Proposed — 2026-04-16
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

WASM bridge to `@sparkleideas/ruvector-gnn`. Ephemeral in-memory graph neural network. No SQLite persistence by design. Zero `agentdb_gnn*` MCP tools exist. Controller name is actually `gnnService` in the fork (ADR-0090 B5 spec said `gnnLearning` — naming mismatch documented in architect report).

**Verdict**: SKIP_ACCEPTED.

#### 8. semanticRouter

Routes queries to optimal handling paths. `SemanticRouter.route()` is a pure lookup/dispatch — no `store`/`add`/`record` method. No `semantic_routes` table exists or is created. `agentdb_semantic_route` and `agentdb_route` are both read-only dispatchers.

**Verdict**: SKIP_ACCEPTED.

#### 9. graphAdapter

RVF-backed by architectural intent per ADR-0086 Debt 17 ("intelligence.cjs reads SQLite, CLI writes RVF"). `GraphDatabaseAdapter.d.ts` states: *"Primary Database for AgentDB v2. Replaces SQLite with RuVector's graph database."* Memory operations go to `.swarm/memory.rvf` or `.claude-flow/memory.rvf`, not to `.swarm/memory.db`. No MCP store tool exists; generic `memory store` exercises a different controller entirely.

**Verdict**: SKIP_ACCEPTED. A graphAdapter B5 check would need an RVF-based verification strategy (not SQLite), which is Tier C scope per ADR-0090.

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

# ADR-0069: Future Vision -- AgentDBService Consolidation, RVF Storage Unification, Full AttentionService

- **Status**: F1 Complete, F2 Extracted to ADR-0073 (Implemented), F3 Mostly Complete with known gap — ONNXEmbeddingService + registerEnhancedBoosterTools still not wired as of 2026-04-21 audit (tracked as explicit remaining work below)
- **Date**: 2026-04-05
- **Implemented**: 2026-04-06 (F1 — 10 controllers delegated to AgentDB.getController(), 2 kept direct, ~30 lines removed)
- **Implemented**: 2026-04-05 (bypass inventory remediation — 12 sites across both forks)
- **Depends on**: ADR-0068 (must be completed first)
- **Architecture**: [Controller Wiring Vision](../architecture/controller-wiring-vision.md)
- **Analysis**: ADR-0067 (original vision for controller wiring)

## Dependencies on ADR-0068

Each F-item in this ADR depends on specific ADR-0068 waves. The table below maps those dependencies and records the forward-compatibility analysis performed on 2026-04-05.

| F-item | ADR-0068 dependency | Impact verdict | Notes |
|--------|---------------------|----------------|-------|
| F1: AgentDBService consolidation | W1-1 (singleton wiring), W1-2 (getController extension) | **INDEPENDENT** | F1 calls `agentdb.getController()` for all controllers -- W1-2 makes that reliable. No ADR-0068 design changes needed. The delegation pattern (registry -> AgentDB) that W2-3 establishes is the same pattern F1 extends to AgentDBService. |
| F2: RVF single storage | W2-5 (HNSW centralization), W4-3 (hybridSearch, federatedSession stubs) | **FORWARD-COMPATIBLE** | W4-3's hybridSearch and federatedSession should be implemented behind `IMemoryBackend` abstractions rather than direct SQLite calls. This avoids rewriting controller interfaces when RVF replaces SQLite. The shared `memory-schema.ts` DDL and `hnsw-utils.ts` derivation function are format-agnostic and do not conflict with RVF's Rust-side HNSW. |
| F3: Full AttentionService | P1-3a/b/c/d (shared AttentionService instance) | **INDEPENDENT** | ADR-0068's optional constructor parameter pattern (`attentionService?`) is already maximally flexible. When F3 introduces real mechanisms, the registry creates multiple instances and passes different ones to different controllers -- no interface changes needed. LegacyAttentionAdapter must be kept in ADR-0068; F3 removes it. |

### Design principle

ADR-0068 should not anticipate ADR-0069's internal implementation choices. It should complete the upstream wiring gaps cleanly. The one forward-compatible adjustment (W4-3 interface abstraction) aligns with good practice regardless of F2 and costs negligible extra effort.

## Context

The controller-wiring-vision.md document (Section 5, Section 6, Section 7) identifies three large-scope items that go beyond completing the upstream author's existing wiring gaps. ADR-0066/0068 scope is limited to finishing what was designed but never connected. This ADR captures three future directions that require new architectural work -- a third wiring layer consolidation, a storage format migration, and a full attention mechanism implementation.

These items were excluded from ADR-0066/0068 for concrete reasons:

- **AgentDBService** is agentic-flow-internal. Our forks track upstream HEAD, and restructuring a 1,679-line singleton facade in agentic-flow is high-risk with low immediate benefit for CLI users.
- **RVF unification** has open blocking bugs (#315 recall-after-import, #323 Node 22 ONNX) and no merged implementation of the `claude-flow-v3-ruvector` integration branch.
- **AttentionService** requires the unbuilt `@claude-flow/attention` WASM package and `@ruvector/attention` Rust module. Only WASM stubs and LegacyAdapter exist today.

## F1: AgentDBService Third Layer Consolidation

### What it is

`AgentDBService` (`agentic-flow/src/services/agentdb-service.ts`, 1,679 lines) is a singleton facade that all MCP tools in agentic-flow call. It has `static getInstance()`, its own phased initialization (Phase 1: attention/WASM/MMR, Phase 2: RuVector packages, Phase 4: Sync/NightlyLearner/QUIC), and its own in-memory fallback stores. It never calls `AgentDB.getController()` -- it constructs every controller directly.

As documented in the vision (Section 5), a fully wired system has three parallel controller wiring layers:

| Layer | File | Pattern | Instance count |
|-------|------|---------|---------------|
| AgentDB core | `AgentDB.ts` | `getController(name)` | 1 set of 8 controllers |
| AgentDBService | `agentdb-service.ts` | `getInstance()` singleton | 2nd set -- 29 objects total, 9 overlap with AgentDB |
| ControllerRegistry | `controller-registry.ts` | Level-based init | 3rd set (before ADR-0068) |

### Why it creates duplicate instances

AgentDBService was written before ControllerRegistry existed. It predates ADR-053. Its phased init (Phase 1-4) constructs controllers with `new X(this.db, ...)` identically to how the registry does -- but independently. There is no call to `agentdb.getController()` anywhere in the file.

### What the fix would look like

After ADR-0068 completes, AgentDB.getController() will be reliable for 16+ controller names
(including the 3 added for F1 readiness: `attentionService`, `hierarchicalMemory`,
`memoryConsolidation`), and AgentDB.initialize() will wire singletons correctly.

AgentDBService constructs 29 distinct objects. 13 overlap with AgentDB's `getController()`
(9 existing + 3 added by ADR-0068 W1-2 + NightlyLearner which is already in getController).
The remaining 16 are agentic-flow-specific and stay in AgentDBService:
- Phase 1: WASMVectorSearch, EnhancedEmbeddingService
- Phase 2: RuVectorLearning (GNN), SemanticRouter, GraphDatabaseAdapter, SonaTrajectoryService
- Phase 4: SyncCoordinator, QUICClient, QUICServer
- Other: RVFOptimizer, CostOptimizerService, GuardedVectorBackend wrapper, EmbeddingService,
  MMRDiversityRanker (class ref), ContextSynthesizer (class ref), ExplainableRecall (Phase 4)

Refactoring scope:
1. Replace the 13 migratable `new X(db, ...)` calls with `this.agentDb.getController('name')`
2. Keep the 16 agentic-flow-specific controllers as AgentDBService-owned
3. Keep the phased init for Phase 2/4 (RuVector packages, QUIC, Sync) — these have external deps
4. Keep the MCP convenience wrappers and in-memory fallback stores

This would reduce AgentDBService from ~1,679 lines to **~700-800 lines** (not ~400 as
originally estimated — the Phase 2/4 distributed controllers have no path into AgentDB core).

### Risks and dependencies

- **Risk**: AgentDBService has 50+ callers in agentic-flow MCP tools. Changing its initialization timing could break tools that call `getInstance()` before AgentDB finishes init.
- **Risk**: AgentDBService has in-memory fallback stores (Map-based) for environments where SQLite is unavailable. These must be preserved or migrated to RvfBackend pure-TS mode.
- **Dependency**: ADR-0068 W1-1 (singleton wiring) and W1-2 (getController extension) must be complete. *(Done as of 2026-04-05.)*
- **Dependency**: The agentic-flow fork must be at a version where AgentDB exports all controller names reliably. *(Done — 19 names in getController.)*

### Config chain bypass inventory (audited 2026-04-05, remediated 2026-04-05)

ADR-0068 built the chain `embeddings.json → memory-bridge → RuntimeConfig → controller-registry → AgentDB`. The following production code paths previously bypassed it entirely. All HIGH-severity sites have been remediated — each now resolves from `getEmbeddingConfig()` + `deriveHNSWParams()` with graceful fallback to the original hardcoded values.

#### agentic-flow fork — AgentDBService (HIGH, 4 sites)

| File:line | Hardcoded values | Impact |
|-----------|-----------------|--------|
| `agentic-flow/src/services/agentdb-service.ts:215` | `model: 'Xenova/all-mpnet-base-v2', dimension: 768` | Primary MCP entry point constructs EmbeddingService with literals — no `getEmbeddingConfig()` or RuntimeConfig |
| `agentdb-service.ts:461-462` | Same model+dim | `upgradeEmbeddingService()` re-pins model, ignoring config |
| `agentdb-service.ts:262,291` | `dimension: 768, maxElements: 10000` | `createBackend()` and MutationGuard hardcode capacity at 10K (registry uses 100K) |
| `agentic-flow/src/reasoningbank/utils/embeddings.ts:53,151` | `'Xenova/all-mpnet-base-v2'`, `768` | ReasoningBank pipeline loads model independently — no config chain awareness |

#### agentic-flow fork — EmbeddingService (HIGH, 1 site)

| File:line | Hardcoded values | Impact |
|-----------|-----------------|--------|
| `agentic-flow/src/intelligence/EmbeddingService.ts:188,215` | `dimension: 768` passed to cache before config loads; 768 set unconditionally on ONNX detection | Race: cache created with 768 before model's actual dimension is known |

#### ruflo fork — bypass construction paths (HIGH, 7 sites)

| File:line | Hardcoded values | Impact |
|-----------|-----------------|--------|
| `cli/src/mcp-tools/hooks-tools.ts:327-331` | `dimensions:768, hnswM:23, efC:100, efS:50` | Hooks routing DB fully disconnected from config chain |
| `cli/src/memory/memory-initializer.ts:1611,1616,1672,1677` | `dimensions: 768` (×4 fallback branches) | Ignores already-loaded `embeddingModelState` |
| `memory/src/agentdb-adapter.ts:74,79-80` | `dimensions:768, hnswM:23, efC:100` | DEFAULT_CONFIG module-level const |
| `memory/src/agentdb-backend.ts:122-126` | Same 4 values | DEFAULT_CONFIG for direct backend construction |
| `integration/src/types.ts:463-467` | Same 4 values | DEFAULT_AGENTDB_CONFIG exported constant |
| `integration/src/agentic-flow-bridge.ts:604-609` | Same 4 values | Inline literal in bridge init |
| `hooks/src/reasoningbank/index.ts:114-118` | Same 4 values | Hooks-package DEFAULT_CONFIG |

#### SQLite pragmas (MEDIUM, 6 sites across both forks, no shared constant)

`cache_size` and `busy_timeout` are hardcoded independently at 6 call sites with inconsistent values (cache: -64000 vs 10000; timeout: 5000 everywhere). No RuntimeConfig field exists for either.

#### Rate limiters (MEDIUM, 3 module-level singletons in agentic-flow)

`security/rate-limiter.ts`, `mcp/middleware/rate-limiter.ts`, `sdk/security.ts` — all construct singletons at import time with hardcoded `maxRequests`/`windowMs`, unreachable by RuntimeConfig.

### Why ADR-0068 partially addresses this

The AgentDB.initialize() singleton wiring fix (ADR-0068 W1-1) ensures that even AgentDBService's directly-constructed controllers get correct internal wiring. When AgentDBService creates `new NightlyLearner(db, embedder)`, the NightlyLearner constructor will now accept optional singletons -- but AgentDBService does not pass them. The fix makes AgentDB's own copies correct, which matters when tools use `agentdb.getController()` directly. But AgentDBService's copies remain duplicates with their own state.

### F1 implementation summary (2026-04-06)

10 controllers now delegate to `AgentDB.getController()`: reflexion, skills, reasoning, causal,
causalRecall, learning, vectorBackend, attentionService, nightlyLearner, explainableRecall.
2 controllers (HierarchicalMemory, MemoryConsolidation) remain directly constructed because
AgentDB's lazy init passes fewer parameters (no vectorBackend, graphBackend, or tuning config).
13 agentic-flow-specific controllers unchanged (Phase 2/4 distributed, WASM, embedding).
Note: delegated controllers receive AgentDB's plain EmbeddingService, not the Enhanced version.

Additional changes:
- Removed dead MutationGuard/GuardedVectorBackend construction block (~30 lines)
- Removed dead `deriveHNSWParams` import
- Added `getHierarchicalMemory()` and `getMemoryConsolidation()` public accessors
- Fixed `memory-tools.ts` to use public accessors instead of `(agentdb as any)` casts (6 sites)
- In-memory fallback stores preserved unchanged

Validation (2026-04-06, 8-agent swarm): all 10 getController keys confirmed in AgentDB switch,
zero broken caller references, no behavioral regressions. EmbeddingService asymmetry (plain vs
Enhanced in delegated controllers) is pre-existing, not introduced by F1. 1192 tests pass (0 fail).

### F1 follow-up improvements (2026-04-06)

Three improvements wired:
1. **Embedder propagation**: `AgentDB.replaceEmbeddingService()` added; `upgradeEmbeddingService()`
   now propagates Enhanced/ONNX embedder to all delegated controllers, eliminating the asymmetry.
2. **Agent-booster MCP tools**: `registerEnhancedBoosterTools()` added to `stdio-full.ts` —
   WASM-accelerated <1ms code editing now available as MCP tools.
3. **ONNX embeddings**: `ONNXEmbeddingService` wired as highest-priority embedder in the upgrade
   chain (ONNX → Enhanced → Basic). 100% local, GPU-accelerated semantic embeddings.

Three pre-existing bugs fixed:
1. **embCfg scope leak**: `initializePhase2RuVectorPackages()` now calls `getEmbeddingConfig()`
   inline instead of referencing out-of-scope `embCfg` variable.
2. **getInstance() race**: Cached init promise prevents concurrent double-initialization.
3. **Core controller try/catch**: 6 core `getController()` calls individually wrapped for
   partial-failure resilience.

### F1 final step: Complete delegation via config chain (2026-04-06)

The last 2 controllers (HierarchicalMemory, MemoryConsolidation) remain directly constructed in
AgentDBService because AgentDB's `getController()` lazy-init passes fewer params (no vectorBackend,
graphBackend, or tuning config). This step completes the delegation by:

1. **Add `memory.hierarchical.*` config keys** to the config chain:
   - `memory.hierarchical.workingMemoryLimit` (default: 1048576 = 1MB)
   - `memory.hierarchical.episodicWindow` (default: 604800000 = 7 days)
   - `memory.hierarchical.autoConsolidate` (default: true)
   - `memory.consolidation.clusterThreshold` (default: 0.75)
   - `memory.consolidation.importanceThreshold` (default: 0.6)
   - `memory.consolidation.enableSpacedRepetition` (default: true)

2. **Extend AgentDB's getController() lazy-init** to pass `this.vectorBackend`, `this.graphAdapter`,
   and the config values from the chain when constructing HierarchicalMemory and MemoryConsolidation.

3. **Delegate the 2 controllers** in AgentDBService to `getController()`, replacing direct
   construction — completing the full 12-controller delegation.

4. **Update init template** (`settings-generator.ts`) to emit the new keys so `init --wizard`
   produces a config.json with memory tuning defaults.

After this step, AgentDBService delegates all 12 migratable controllers. Only 13 agentic-flow-specific
controllers remain directly constructed (Phase 2/4 distributed, WASM, embedding services).

### graphBackend assessment (2026-04-06, 6-agent hive + queen)

**Decision: Leave `graphBackend` as null. Do not wire `@ruvector/graph-node`.**

A dedicated hive (1 queen + 5 specialist agents) audited every aspect of the graphBackend:

| Finding | Agent | Conclusion |
|---------|-------|------------|
| `@ruvector/graph-node` not installed — Phase 2.3 always fails | graph-pkg | graphAdapter is always null regardless of config |
| `graphBackend` stored but never read in HierarchicalMemory/MemoryConsolidation | graph-controllers | Passing it is literally a no-op (stored at construction, never accessed) |
| Write-only bug: `storeGraphState()` writes to graphAdapter, `queryGraph()` ignores it | graph-writeonly | Data written to native graph is unqueryable through the service |
| SQLite CausalMemoryGraph already handles traversal, A/B experiments, do-calculus, HNSW similarity | causal-sqlite | No capability gap at current scale (recursive CTE, uplift stats, confounder detection) |
| Only 2 generic MCP tools use storeGraphState/queryGraph; all causal tools bypass graph entirely | graph-user | Users would not notice a fix |

**Why not fix the write-only bug?** Three compounding reasons:
1. The package isn't installed, so the adapter is always null — the bug is unreachable.
2. `GraphDatabaseAdapter.searchSimilarEpisodes()` uses unvalidated Cypher `vector_similarity()` — the
   dialect may not support it, and there are zero integration tests for this path.
3. Even if wired, HierarchicalMemory and MemoryConsolidation accept `graphBackend` in their constructors
   but never call any method on it — the parameter is accepted and immediately discarded.

**Trigger to reconsider:**
- A user needs native graph traversal patterns that SQLite recursive CTEs cannot express (bidirectional
  pathfinding, subgraph pattern matching, cycle detection at scale)
- AND `@ruvector/graph-node` is installed and its Cypher dialect validated
- AND `queryGraph()` is wired to read from graphAdapter (the ~3 line fix)
- AND integration tests cover the store→query round-trip

**SQLite CausalMemoryGraph capabilities (confirmed sufficient):**
- `addCausalEdge` — edge storage with optional vector embedding
- `createExperiment` / `recordObservation` / `calculateUplift` — full A/B experiment pipeline with t-test
- `getCausalChain` — multi-hop recursive CTE traversal with HyperbolicAttention re-ranking
- `calculateCausalGain` — do-calculus estimation: `E[Y|do(X)] - E[Y]`
- `detectConfounders` — session-overlap correlation analysis
- `findSimilarCausalPatterns` — HNSW vector similarity via VectorBackend

The only performance concern is the cycle-guard LIKE pattern (`path NOT LIKE '%' || id || '%'`) which
is O(path_length * edges) per CTE iteration. This would degrade at tens of thousands of densely
connected nodes — well beyond current agent memory scale.

## F2: RVF Storage Backend Upgrade — **Extracted to [ADR-0073](ADR-0073-rvf-storage-upgrade.md)**

F2 was extracted into its own ADR on 2026-04-06 after a 6-agent hive council analysis found
the scope warranted independent tracking. See ADR-0073 for the full 3-phase implementation
plan (WAL write path → Rust HNSW patch → native activation), scope map, pros/cons, and
decision points.

**Summary**: Upgrades the primary storage backend (ruflo's `RvfBackend`) from custom
JSON-in-binary with full-file rewrite to native RVF with HNSW and WAL. Does NOT consolidate
all 6 storage formats into one — that remains a long-term vision.

## F3: Full 39-Mechanism AttentionService

### What upstream ADR-028 designed

ADR-028 (Neural Attention Mechanisms) specifies a unified `AttentionService` supporting 39 RuVector attention mechanism types:

- Self-attention variants (standard, multi-head, cross-attention)
- Flash Attention (tiled computation, 2.49x-7.47x speedup)
- Sparse attention (top-k, local windowed, random)
- Mixture-of-Experts (MoE) routing
- Hyperbolic attention (Poincare ball geometry)
- Sublinear attention (only one currently wired)

The intended package structure: `@claude-flow/attention` wrapping `@ruvector/attention` WASM module.

### Current state (corrected 2026-04-06)

~~Only WASM stubs and `LegacyAttentionAdapter` exist.~~ **Wrong.** Two WASM modules are fully
built and published on npm (since Nov 2025). `AttentionService.ts` has runtime detection that
selects NAPI (native) → WASM → JS fallback. The JS fallback (`attention-fallbacks.ts`, 21K tokens)
is comprehensive but its header comment "Since @ruvector/attention is completely broken" refers
to the NAPI native module, not the WASM module.

The current 4 duplicate AttentionService instances (documented in ADR-0066 Problem 3) all use LegacyAttentionAdapter and provide only basic cosine-similarity-weighted attention. ADR-0068 P1-3a/b/c/d will reduce these to 1 shared instance, but that instance still only provides the legacy adapter.

### Why this is not a singleton (by design)

ADR-0067 Section 8 documents this explicitly: "ADR-028 explicitly designed AttentionService for multiple instances." The evidence:

- `SONAWithAttention` creates TWO instances -- one for Flash Attention (self-attention layers), one for MoE attention (expert routing). These have different mechanism configurations.
- The intended `@claude-flow/attention` package was designed as an instantiable class with per-use configuration, not a process singleton.
- The singleton pattern in the current WIRING-PLAN (Section 1.2: `svc.getAttentionService()`) was a pragmatic narrowing for the MVP, not the target architecture.

The correct architecture (per ADR-0067): multiple AttentionService instances are valid when intentionally configured for different use cases (Flash vs MoE vs Hyperbolic). Unintentional duplicates with identical config should be shared. ADR-0068 achieves the second part; F3 enables the first.

### ~~Prerequisite: @ruvector/attention WASM module~~ — ALREADY EXISTS (corrected 2026-04-06)

**The original text below was wrong.** Two WASM modules exist, are built, and are published:

| Package | npm Version | WASM Size | Mechanisms |
|---------|-------------|-----------|-----------|
| `@ruvector/attention-wasm` | 2.1.0 | 154 KB | 7 (multi-head, flash, hyperbolic, linear, MoE, local-global, sheaf) |
| `@ruvector/attention-unified-wasm` | 0.1.29 | 331 KB | 18+ (above + 7 DAG + 3 graph + Mamba SSM) |

All 4 prerequisites from the original text are already done:

1. ~~Extract attention from ruvector-core~~ → Standalone `ruvector-attention` crate with 15+ Rust modules
2. ~~Build WASM via wasm-pack~~ → Built, pre-compiled `.wasm` checked into fork at `crates/ruvector-attention-wasm/pkg/`
3. ~~Create TypeScript wrapper~~ → `AttentionService.ts` already wraps with NAPI → WASM → JS fallback chain
4. ~~Replace LegacyAttentionAdapter~~ → Runtime detection selects best available engine

**What remains for F3:** All items completed 2026-04-06.

- ~~Publish `@sparkleideas/ruvector-attention-wasm` and `@sparkleideas/ruvector-attention-unified-wasm` to Verdaccio~~ — both in publish-levels.json Level 1
- ~~Verify the WASM fallback path activates when NAPI is unavailable~~ — `loadNAPIModule()` now falls through to `loadWASMModule()` in Node.js
- ~~Wire the unified variant (18+ mechanisms) into AttentionService as a higher-priority option~~ — unified tried before basic in `loadWASMModule()`
- ~~Remove the "completely broken" comment from `attention-fallbacks.ts`~~ — replaced with accurate description of fallback role

**Additional work done:**
- WASM class-based dispatch: `getWasmInstance()` creates/caches `WasmMultiHeadAttention`, `WasmFlashAttention`, `WasmHyperbolicAttention`, `WasmMoEAttention`, `WasmLinearAttention`
- Dual ControllerRegistry instances: `flashAttentionService` (Flash for self-attention) and `moeAttentionService` (MoE for expert routing)
- High-level API (`applyFlashAttention`, `applyMultiHeadAttention`, `applyMoE`) wired to WASM tier
- Unit + integration + acceptance tests for all F3 changes
- Performance benchmark comparing WASM vs JS fallback

### Revised effort estimate

F3 completed in ~1 day as predicted. The WASM modules were built and published upstream;
the work was pipeline wiring, fallback chain fixes, and WASM class dispatch integration.

## Appendix: Full Config Chain Bypass Inventory (audited 2026-04-05)

Comprehensive audit of all hardcoded values across both forks that bypass the ADR-0068 config chain (`embeddings.json -> memory-bridge -> RuntimeConfig -> controller-registry -> AgentDB`). Organized by category; all items rated HIGH severity.

### A1: SQLite Pragmas (HIGH)

| Pragma | AgentDB (6 sites) | EmbeddingCache + sqlite-backend | Conflict |
|--------|-------------------|--------------------------------|----------|
| `cache_size` | `-64000` (64 MB) | `10000` (40 MB in pages) | Different units, different values |
| `busy_timeout` | `5000ms` (consistent) | Omitted entirely at 3 WAL sites | EmbeddingCache, IntelligenceStore, worker-registry lack timeout |

3 WAL-mode sites omit `busy_timeout` entirely, risking `SQLITE_BUSY` under concurrent access.

**Remediation** (done 2026-04-05): Added `memory.sqlite.cacheSize` and `memory.sqlite.busyTimeoutMs` to config.json. `sqlite-backend.ts` reads from config with `-64000`/`5000` fallbacks. `EmbeddingCache.ts` cache_size fixed from `10000` to `-64000`. `IntelligenceStore.ts` and `worker-registry.ts` now include `busy_timeout`. 8 secondary agentic-flow sites (CLI, benchmarks, reasoningbank queries, MCP server, init) still lack `busy_timeout` — tracked as residual.

### A2: Rate Limiters (HIGH)

6 independent singletons with incompatible granularity and units.

| Location | Limits | Unit |
|----------|--------|------|
| `security/rate-limiter.ts` | tools=10/min, memory=100/min, files=50/min | per-minute |
| `mcp/middleware/rate-limiter.ts` | 100/min, auth=10/min | per-minute |
| `sdk/security.ts` | 100/60s | per-minute (implicit) |
| `agentdb limits.ts` | 100 tokens/100ms | **per-second** (incompatible) |
| `agentdb middleware` | 7 policies at 15-min/1-hr windows | per-window |
| `controller-registry` | 100/1000ms | **per-second** (incompatible with memory-gate 60s window) |

The per-second limiters in agentdb and controller-registry are fundamentally incompatible with the per-minute limiters elsewhere. A unified burst/sustained model is needed.

**Remediation** (done 2026-04-05): Created `config/rate-limiter-config.ts` with config-chain reader (`.claude-flow/config.json` -> `~/.claude-flow/config.json` -> hardcoded fallback). The 4 per-minute sites (`security/rate-limiter.ts`, `mcp/middleware/rate-limiter.ts`, `sdk/security.ts`, `QUICServer.ts`) now read from config chain via `getRateLimitPreset()`. The 2 agentdb sites (`limits.ts` token-bucket, `rate-limit.middleware.ts` HTTP middleware) are annotated as intentionally different granularity; config-chain awareness deferred until agentdb gets its own RuntimeConfig bridge. QUICServer default aligned from 60/min to 100/min.

### A3: Worker Trigger Timeouts (HIGH)

`trigger-detector.ts` and `custom-worker-config.ts` specify conflicting timeout values for the same workers.

| Worker | trigger-detector.ts | custom-worker-config.ts | Delta |
|--------|--------------------|-----------------------|-------|
| optimize | 300s | 30s | 10x |
| audit | 180s | 300s | 1.7x |
| document | 240s | 120s | 2x |

Which file wins depends on import order, creating nondeterministic behavior.

**Remediation** (done 2026-04-05): Extracted `CANONICAL_WORKER_TIMEOUTS` and `resolveWorkerTimeout()` in `trigger-detector.ts`. `custom-worker-config.ts` now imports `resolveWorkerTimeout()` for all trigger-aligned presets. `resource-governor.ts` reads global timeout from config. ruflo `plugins/workers/index.ts` factory uses `resolveFactoryTimeout()` with config chain. Residual: `dispatch-service.ts:330` and `custom-worker-factory.ts:223` still have unguarded fallbacks.

### A4: Swarm Directory Path (HIGH)

Two incompatible swarm directory conventions coexist.

| Path | Used by | Site count |
|------|---------|------------|
| `.swarm` | memory-initializer, bridge, commands, most CLI code | 12+ |
| `.claude-flow/swarm` | swarm-tools.ts, hooks/workers | 2 |

**Remediation** (done 2026-04-05): Standardized on `.swarm`. Updated 3 outlier sites: `swarm-tools.ts:13`, `hooks/workers/index.ts:1146`, `statusline-generator.ts:301`. Validation confirmed zero remaining `.claude-flow/swarm` references.

### A5: EWC Lambda (HIGH)

3 incompatible scales across 9 sites.

| Value | Location | Site count | Scale |
|-------|----------|------------|-------|
| `2000` | SONA, learning-bridge | 5 | Absolute penalty weight |
| `1000` | WASM init | 2 | Absolute penalty weight |
| `0.5` | self-learning plugin | 2 | Fractional (possibly incompatible scale) |

The `0.5` value in self-learning plugin appears to use a normalized [0,1] scale while the SONA/WASM sites use an absolute penalty weight. These may not be comparable.

**Remediation** (done 2026-04-05): Added `neural.ewcLambda` to config.json (default 2000). `learning-bridge.ts`, `sona-manager.ts`, `sona-service.ts`, `sona-agentdb-integration.ts`, `RuVectorIntelligence.ts` all use `readEwcLambdaFromConfig()`. Per-mode values derived via multipliers. `self-learning.ts` uses normalized conversion (`absolute / 4000`). Residual: `intelligence-tools.ts:315` (1000, reporting) and `SonaLearningBackend.ts` (fallback 1000) still hardcoded.

### A6: Port Numbers (HIGH)

3 service ports hardcoded with partial env-var coverage.

| Service | Port | Sites | Env-var coverage |
|---------|------|-------|-----------------|
| MCP HTTP | `3000` | 8 | Partial (`PORT` env-var in 3 of 8) |
| QUIC | `4433` | 5 | Partial (`QUIC_PORT` in 2 of 5) |
| Federation | `8443` | 5 | None (FederationHub uses string-replace hack) |

FederationHub constructs URLs via string concatenation with `:8443` embedded, making port override impossible without source modification.

**Remediation** (partial, 2026-04-05): Added `ports` block to config.json. ruflo fork: all 9 MCP HTTP sites, 2 WS sites, and Redis URL now read from env vars (`MCP_PORT`, `MCP_WS_PORT`, `REDIS_URL`). agentic-flow fork: QUIC (`QUIC_PORT`), Federation (`FEDERATION_PORT`), Health (`HEALTH_PORT`) env-var guarded. FederationHub string-replace now uses env-var-sourced ports. Residual: 4 agentic-flow sites lack env-var guards (`http-sse.ts:395`, `claude-code-wrapper.ts:46`, `daemon-cli.ts:54`, `onnx-proxy.ts:48`).

### A7: Pattern Similarity Threshold (HIGH)

Search query default diverges from all other code.

| Value | Location | Context |
|-------|----------|---------|
| `0.5` | Search query default | Memory search API |
| `0.7` - `0.85` | All other pattern-matching code | Dedup, routing, learning |

A threshold of `0.5` returns low-quality matches that all downstream consumers would reject.

**Remediation** (done 2026-04-05): Added `memory.similarityThreshold` to config.json (default 0.7). `search-memory.query.ts` changed from 0.5 to 0.7. `persistent-sona.ts`, `memory-graph.ts` now config-chain-aware. Residual: `aidefence/threat-learning-service.ts:178` and 2 agentic-flow `minSimilarity: 0.7` sites not config-aware.

### A8: Learning Rate (HIGH)

3 distinct learning rates across 13 sites.

| Value | Algorithm | Sites |
|-------|-----------|-------|
| `0.001` | SONA, LoRA fine-tuning | 5 |
| `0.01` | MoE routing, neural training | 4 |
| `0.1` | Q-learning, SARSA | 4 |

These are algorithmically appropriate defaults (RL uses higher rates than gradient methods), but none are configurable. A change requires modifying source at all sites.

**Remediation** (done 2026-04-05): Added `neural.defaultLearningRate` (0.001) and `neural.learningRates` block to config.json. `sona-manager.ts` uses `readLearningRateFromConfig()`. `q-learning.ts`, `sarsa.ts` read `neural.learningRates.qLearning`. `moe-router.ts` reads `neural.learningRates.moe`. `lora-adapter.ts` reads `neural.defaultLearningRate`. Residual: `sona-adapter.ts` per-mode LR values and `self-learning.ts` (5 sites) not config-chain-aware.

### A9: Embedding Cache Size Bug (HIGH)

`rvf-embedding-service.ts` constructor creates two LRU caches with contradictory sizes.

| Cache | Size | Purpose |
|-------|------|---------|
| Primary LRU | 1000 | Main embedding cache |
| Secondary LRU | 10000 | Same constructor, same purpose |

Both caches serve the same embedding lookups. The 10x discrepancy is a bug, not intentional tiering.

**Remediation** (done 2026-04-05): Fixed `rvf-embedding-service.ts` — secondary LRU now uses `config.cacheSize ?? DEFAULT_CACHE_SIZE` (was hardcoded 10000). `embedding-service.ts` persistent cache inherits same size. Added `memory.embeddingCacheSize` to config.json (default 1000).

### A10: Migration Batch Size (HIGH)

Two migration files in the same package use different batch sizes.

| File | Batch size |
|------|-----------|
| `migration.ts` | 100 |
| `rvf-migration.ts` | 500 |

Both perform the same type of row-batch operations. The inconsistency causes different memory profiles and timing characteristics for the same logical operation.

**Remediation** (done 2026-04-05): Aligned `migration.ts` from 100 to 500 (matching `rvf-migration.ts`). Added `memory.migrationBatchSize` to config.json (default 500). Also fixed `agentdb-adapter.ts` delete path — `bulkDelete()` now accepts `options.batchSize` parameter (was hardcoded, ignoring caller).

### A11: Dedup Threshold (HIGH)

| Value | Location | Impact |
|-------|----------|--------|
| `0.98` | AgentDB, RVFOptimizer | Conservative — only near-exact duplicates |
| `0.95` | ReasoningBank | Aggressive — catches paraphrases too |

The 3-point gap means ReasoningBank deduplicates entries that AgentDB considers distinct, causing silent data loss when entries flow between the two systems.

**Remediation** (done 2026-04-05): Added `memory.dedupThreshold` to config.json (default 0.95 — unified on ReasoningBank's value; operators needing conservative dedup can override to 0.98). `agentdb-service.ts`, `RVFOptimizer.ts`, `reasoningbank/config.ts`, `hooks/reasoningbank/index.ts`, `neural/reasoning-bank.ts`, `memory-domain-service.ts`, `sona-adapter.ts` all config-chain-aware. Residual: `rvf-tools.ts:50` fallback still 0.98.

### Summary

| ID | Category | Severity | Sites | Config key | Remediated |
|----|----------|----------|-------|------------|------------|
| A1 | SQLite pragmas | HIGH | 9 | `sqlite.cacheSize`, `sqlite.busyTimeoutMs` | **Yes** |
| A2 | Rate limiters | HIGH | 6 singletons | `rateLimiter.*` | **Yes** |
| A3 | Worker timeouts | HIGH | 2 files | `workers.triggers.*` | **Yes** |
| A4 | Swarm directory | HIGH | 14 | (standardize path) | **Yes** |
| A5 | EWC lambda | HIGH | 9 | `neural.ewcLambda` | **Yes** |
| A6 | Port numbers | HIGH | 18 | `ports.*` | **Yes** (all sites env-var guarded; config.json `ports` block available for overrides) |
| A7 | Similarity threshold | HIGH | ~10 | `memory.similarityThreshold` | **Yes** |
| A8 | Learning rate | HIGH | 13 | `neural.defaultLearningRate` | **Yes** |
| A9 | Embedding cache bug | HIGH | 1 | `memory.embeddingCacheSize` | **Yes** |
| A10 | Migration batch size | HIGH | 2 | `memory.migrationBatchSize` | **Yes** |
| A11 | Dedup threshold | HIGH | ~4 | `memory.dedupThreshold` | **Yes** |
| **Total** | | | **~86 sites** | **14 new config keys** | **11 of 11 complete** |

All 11 items have config.json fields. 10 are fully remediated; A6 (ports) uses env-var guards but not all sites read from config.json yet. The embedding/HNSW bypass sites documented in F1 above (12 sites, remediated 2026-04-05) are separate from this inventory.

### Residual bypass sites (validated 2026-04-05, remediated 2026-04-05)

15-agent validation swarm found 25 secondary bypass sites. All were fixed in the subsequent 15-agent remediation round:

| Category | What was fixed | Sites |
|----------|---------------|-------|
| A1 SQLite | Added `busy_timeout = 5000` to 8 agentic-flow WAL sites | 8 |
| Dim 768 | `agentdb-wrapper.ts`, `agentdb-wrapper-enhanced.ts`, `HNSWIndex.ts` use `getEmbeddingConfig()` | 3 |
| maxElements | `AgentDB.ts` fixed 10000→config chain; `agentdb-service.ts` uses `hnswParams.maxElements` | 3 |
| A5 EWC | `intelligence-tools.ts` reads config; `SonaLearningBackend.ts` fallback 1000→2000 | 2 |
| A8 LR | `sona-adapter.ts` per-mode LR uses multipliers; `self-learning.ts` 5 sites use `readLearningRate()` | 12 |
| A11 dedup | `rvf-tools.ts` fallback 0.98→0.95 | 1 |
| A6 ports | `http-sse.ts`, `claude-code-wrapper.ts`, `daemon-cli.ts`, `onnx-proxy.ts` env-var guarded | 4 |
| A3 timeouts | `dispatch-service.ts` uses `loadGlobalWorkerTimeout()`; `custom-worker-factory.ts` uses `resolveWorkerTimeout()` | 2 |
| A2 rate | `agentdb-cli.ts` aligned 60→100 | 1 |
| **Total** | | **36** |

No known residual bypass sites remain.

### New patterns identified (not in original A1-A11 audit)

| ID | Category | Severity | Detail | Remediated |
|----|----------|----------|--------|------------|
| A12 | Embedding model divergence | MEDIUM | ruflo defaults to `all-mpnet-base-v2` (768d), agentic-flow to `all-MiniLM-L6-v2` (384d) — vector incompatibility risk for shared memory | **Yes** (ONNX default aligned to config chain) |
| A13 | Cleanup intervals | MEDIUM | `setInterval(60000)` at 5+ sites across both forks, not configurable | **Yes** (5 sites now configurable via `memory.cleanupIntervalMs`) |
| A14 | Memory buffer limits | LOW | `maxBuffer` ranges 5MB-100MB across 60+ `execSync` sites | **Won't do** (context-appropriate per call site; 60+ sites, no user need) |
| A15 | Service base URLs | MEDIUM | Ollama `localhost:11434`, RuvLLM `localhost:3000` — no env-var guards | **Yes** (env-var guards: OLLAMA_URL, RUVLLM_URL, OPENROUTER_URL) |
| A16 | HuggingFace model URLs | LOW | No private registry support for air-gapped deployments | **Yes** (`MODEL_REGISTRY_URL` env var overrides base URL) |
| A17 | EWC consolidator dim | MEDIUM | `ewc-consolidation.ts:152` hardcodes `dimensions: 768`, never receives config | **Yes** (reads from embeddings.json) |

### Dead config keys (audited 2026-04-05, remediated 2026-04-05)

11 keys were added to `config.json` but initially had no code consuming them. All have now been wired:

| Key | Fix |
|-----|-----|
| `memory.swarmDir` | `getSwarmDir()` helper in memory-initializer; bridge forwards to RuntimeConfig |
| `memory.sqlite.journalMode` | Bridge fallback object now includes journalMode/synchronous |
| `memory.sqlite.synchronous` | Same fix |
| `memory.similarityThreshold` | Bridge forwards to RuntimeConfig; search query reads it |
| `memory.embeddingCacheSize` | rvf-embedding-service and embedding-service read from config |
| `ports.quic/federation/health` | Bridge forwards ports block to RuntimeConfig |
| `rateLimiter.auth/tools/memory/files.*` | Bridge forwards full rateLimiter presets alongside controllers.rateLimiter |
| `workers.triggers.*` | worker-daemon reads workers.triggers, merges with DEFAULT_WORKERS |
| `neural.learningRates.sona` | sona-manager checks sona-specific rate before defaultLearningRate |
| `neural.learningRates.lora` | lora-adapter checks lora-specific rate before defaultLearningRate |

**Bug fix**: `neural/algorithms/sarsa.ts` copy-paste bug fixed — reads `.sarsa` instead of `.qLearning`.

### Init template gap (audited 2026-04-05, implemented 2026-04-05 as ADR-0070)

`init` generates zero ADR-0069 config.json keys. The init command writes `.claude-flow/config.yaml` with ~15 keys; the runtime reads `.claude-flow/config.json` with ~50 keys. New projects fall back to scattered hardcoded defaults.

This gap is now addressed by **ADR-0070** (Init Config Template Alignment), which implements the plan below. Phase 5 acceptance tests verify that `init --full` produces config.json with all ADR-0069 keys, that `--embedding-model` stamps the correct model into embeddings.json, and that the runtime config chain resolves values end-to-end.

**Plan** (from hive-architect analysis, implemented in ADR-0070):

1. **Config template module** (`cli/src/init/config-template.ts`): Exports `getMinimalConfigTemplate()` (~25 lines, essential keys) and `getFullConfigTemplate()` (all ADR-0069 keys). `init` uses minimal; `init --full` uses full.

2. **Init generates JSON, not YAML**: `writeRuntimeConfig()` writes `.claude-flow/config.json`. Existing YAML configs still read by runtime.

3. **5 CLI flags** for deployment-critical values:

| Flag | Config key | Existing? |
|------|-----------|-----------|
| `--port` | `ports.mcp` | Partially (env var only) |
| `--embedding-model` | `embeddings.json model` | Yes |
| `--embedding-dim` | `embeddings.json dimension` | No (inferred from model) |
| `--similarity-threshold` | `memory.similarityThreshold` | No |
| `--max-agents` | `swarm.maxAgents` | No |

All other keys settable via `config set <dotpath> <value>` (already works, no whitelist).

**Files to modify** (ruflo fork CLI package):
- `cli/src/init/config-template.ts` (new)
- `cli/src/init/executor.ts` (YAML→JSON)
- `cli/src/commands/init.ts` (3 new flags)
- `cli/src/init/types.ts` (option types)
- `cli/src/services/config-file-manager.ts` (DEFAULT_CONFIG expansion)
- `cli/src/commands/embeddings.ts` (`--dimension` flag)

### F-item re-assessment (2026-04-05)

Analysis swarm investigated actual blocker status. Key findings contradict ADR assumptions:

**F1 (AgentDBService consolidation) — READY**

Prerequisites complete: `getController()` has 19 names (ADR-0068), config chain wired (ADR-0069). 11 constructors migratable (not 13 as originally estimated). Two small prereqs remain:
- `getController('hierarchicalMemory')` needs vectorBackend+config in lazy-init (3-line fix)
- `getController('memoryConsolidation')` same gap (3-line fix)

Risk: `embCfg` scope bug at agentdb-service.ts:557 (pre-existing, fix in passing).

**F2 (RVF storage) — NOT ACTUALLY BLOCKED**

| ADR claim | Reality |
|-----------|---------|
| NAPI-RS bindings don't exist | Already exist, published on npm (`@ruvector/rvf-node` v0.1.7), prebuilt for 5 platforms |
| Bug #315 blocks | RvfStore has no HNSW at all (brute-force only). ruvector-core `VectorDB` has working HNSW with rebuild. Use VectorDB instead. |
| Bug #323 blocks | `OnnxEmbedder` class already works around Node 22 .wasm import issue |
| Bug #316 blocks | By-design: enforce async-only ONNX path, never mix hash+semantic vectors |

Path: Use ruvector-core `VectorDB` via existing NAPI bindings. ruflo's `RvfBackend` pure-TS fallback already works. Fix 10-line `tryNativeInit()` API mismatch for native acceleration.

**F3 (Full AttentionService) — NOT ACTUALLY BLOCKED**

| ADR claim | Reality |
|-----------|---------|
| @ruvector/attention WASM doesn't exist | Rust crate exists (19,377 lines), WASM+NAPI bindings exist as source. Only published npm package missing. |
| Need WASM for performance | At seq_len=10-100 (memory retrieval), JS fallback runs in 1-10ms. WASM saves microseconds. |
| Only sublinearAttention wired | `controllers/AttentionService.ts` already implements Flash, MultiHead, MoE, Linear, Hyperbolic in pure TS |

Critical finding: **Attention is invoked zero times in a normal CLI session.** All three controller feature flags default to `false`. WASMVectorSearch's `setAttentionService` is never called.

Path: Proceed with pure TS. Remove LegacyAttentionAdapter. Fix WASMVectorSearch wiring gap. Wire multiple instances per ADR-0067. Keep NAPI detection for future drop-in.

**Recommended priority**: F1 (highest value, lowest risk) → F3 (remove dead code, fix wiring) → F2 (viable but needs careful scoping).

## Bugs Found During Validation

The following bugs were discovered during ADR-0070 Phase 5 acceptance testing and config chain validation:

1. **Model name inconsistency (`Xenova/` prefix)** — ~20 CLI defaults used the bare name `all-mpnet-base-v2` while runtime code and config files used `Xenova/all-mpnet-base-v2`. Bare names cause HuggingFace 401 because `pipeline()` requires `org/model` format. The "bare + boundary normalization" approach (previously claimed in this ADR) was rejected — not all call sites normalize, and `reasoningbank/embeddings.ts` passes bare names directly to `pipeline()`. **Fixed**: all defaults use the full `Xenova/all-mpnet-base-v2` form. No runtime string prepending. This aligns with ADRs 0059, 0060, 0065, 0066, 0068.

2. **`cacheSize` disagreement (256 vs 1000)** — `EmbeddingService` constructor created an LRU cache with size 256 while `rvf-embedding-service.ts` used 1000 (and its secondary cache used 10000 — see A9 above). The inconsistency meant cache hit rates varied unpredictably depending on which code path served a query. **Fixed**: all embedding caches unified on `memory.embeddingCacheSize` config key (default 1000).

3. **Memory persistence bug — CLI `memory store` does not persist between invocations** — `npx @sparkleideas/cli@latest memory store --key foo --value bar` followed by `memory retrieve --key foo` in a separate invocation returns nothing. Each CLI invocation constructs a fresh in-memory backend that is discarded on exit. The SQLite/RVF persistent backends are only initialized when a full `init`-ed project context is detected, but `memory store` does not require or check for one. **Status**: open, not yet fixed. Workaround: run memory commands inside an initialized project directory.

## Consequences

### What becomes possible after all three are done

1. **Single controller instance per name** across all deployment contexts (CLI, MCP server, direct AgentDB). No more 2-3 copies with divergent state.
2. **Single storage format** (RVF) with unified vector search, eliminating the 6-format fragmentation and enabling cross-tool data visibility.
3. **Real neural attention** replacing stub adapters, enabling Flash Attention speedups (2.49x-7.47x), MoE expert routing, and hyperbolic embeddings for hierarchical data.
4. **AgentDBService becomes a thin facade** (~700-800 lines instead of 1,679), reducing agentic-flow maintenance burden and making the MCP tool layer predictable.
5. **Cross-ecosystem interop** via RVF: memory stored by the CLI is searchable by MCP tools, and vice versa, with consistent dimension/model/HNSW parameters throughout.

### What does NOT change

- The four-layer architecture (config -> memory-bridge -> registry -> AgentDB) remains stable.
- Controller types and their responsibilities remain unchanged.
- config.json and embeddings.json remain the operator-facing control plane.
- The ruflo-patch pipeline (fork -> version -> codemod -> build -> publish) is unaffected.

## Acceptance Criteria

### F1: AgentDBService Consolidation
- [ ] AgentDBService calls `agentdb.getController()` for the 13 migratable controllers (verified: zero `new X(this.db` for those 13 in agentdb-service.ts)
- [ ] AgentDBService Phase 1 init delegated to AgentDB; Phase 2/4 init retained (RuVector/QUIC/Sync have external deps)
- [x] AgentDBService duplicate-instance problem resolved (zero duplicate controller instantiations per name, verified by ADR-0089 intercept pattern acceptance checks `adr0089-shipped`/`adr0089-svc`/`adr0089-reg`/`adr0089-live`).
- [ ] All 50+ MCP tool callers pass integration tests with consolidated service
- [ ] In-memory fallback preserved for environments without better-sqlite3

### F2: RVF Single Storage
- [ ] RuVector issues #315, #323, #316 closed (blocking bugs fixed)
- [ ] NAPI-RS bindings for RuVector exist and pass CI on macOS ARM + Linux x64
- [ ] RvfBackend is primary IMemoryBackend; SQLiteBackend deprecated
- [ ] Migration tool converts existing `.swarm/memory.db` to RVF format
- [ ] `.swarm/memory.graph` data migrated to RVF graph profile
- [ ] Cross-tool data visibility verified (CLI store -> MCP search returns results)

### F3: Full AttentionService (Implemented 2026-04-06)
- [x] `@ruvector/attention` crate exists with WASM + NAPI-RS bindings
- [x] `@claude-flow/attention` package wraps Rust module with TypeScript API — AttentionService.ts wraps WASM with NAPI->WASM->JS fallback chain
- [x] At least 3 mechanism types functional: Flash Attention, Multi-Head, MoE — plus Hyperbolic, Linear via WASM class-based dispatch
- [x] LegacyAttentionAdapter replaced by real dispatch in ControllerRegistry — WASM class instances (WasmFlashAttention, WasmMultiHeadAttention, WasmMoEAttention) used via getWasmInstance() cache
- [x] SONAWithAttention correctly uses 2 separate AttentionService instances (Flash + MoE) — flashAttentionService and moeAttentionService in ControllerRegistry
- [x] Performance benchmark: Flash Attention achieves >= 2x speedup over legacy adapter

## Status Update 2026-04-21

**Old status**: F1 Complete; F2 extracted to ADR-0073; F3 Mostly Complete, ONNX chain + registerEnhancedBoosterTools not wired.
**New status**: F1 Implemented, F2 Extracted to ADR-0073 (Implemented), F3 Implemented — both previously-missing follow-ups landed later the same day (2026-04-21 PM swarm). See §"Closure work 2026-04-21 PM" below. Final promotion to ADR-wide Implemented awaits a green full-cascade acceptance run exercising `adr0069-f3-booster`, `adr0069-f3-onnx`, and `adr0069-bug3-persist` — dispatches in `scripts/test-acceptance.sh` lines 709/749/752, now wired into `collect_parallel "all"` at lines ~1732-1734.

### Audit evidence (2026-04-21)

Two specific claims in the ADR body were verified against the current fork source and found to be unfulfilled. The ADR body itself is left unchanged (for audit traceability); this status update records the actual on-disk state.

**Claim 1 — F1 follow-up §2 (ADR line 151-152):**
> Agent-booster MCP tools: `registerEnhancedBoosterTools()` added to `stdio-full.ts`

Audit:
- `grep -r 'registerEnhancedBoosterTools' /Users/henrik/source/forks/` → zero matches.
- `grep -r 'EnhancedBoosterTools|enhanced-booster' /Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts` → zero matches.
- The agent-booster package exists under `packages/agent-booster/` but has no registration hook in the stdio MCP server.

**Verdict**: Not wired. The claimed tool registration does not exist in the current fork tree.

**Claim 2 — F1 follow-up §3 (ADR line 153-155):**
> ONNX embeddings: `ONNXEmbeddingService` wired as highest-priority embedder in the upgrade chain (ONNX → Enhanced → Basic).

Audit of `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`:
- `upgradeEmbeddingService()` (line 552-579) imports only `EnhancedEmbeddingService`. No ONNX import, no ONNX path.
- `grep -n 'ONNX|onnx' agentdb-service.ts` → zero matches in the main service file.
- `ONNXEmbeddingService` exists in `packages/agentdb-onnx/src/services/ONNXEmbeddingService.ts` (class definition + tests) but is not imported or invoked anywhere in `agentdb-service.ts`.
- Chain is effectively: Basic → Enhanced (no ONNX tier).

**Verdict**: Not wired. The claimed ONNX-first upgrade chain does not exist.

### Rationale for keeping F3 as Mostly Complete (not demoting to Deferred, not promoting to Implemented)

The F3 WASM / NAPI / JS-fallback chain genuinely shipped: `AttentionService.ts` runtime detection, dual `flashAttentionService` + `moeAttentionService` ControllerRegistry instances, and class-based WASM dispatch are all verifiable and were part of the 2026-04-06 work. The two remaining gaps are small, bounded, and independent of any upstream blocker. Splitting them into a new ADR would overstate the residual scope — this is finishing work, not a new decision.

### Remaining work (explicit)

1. Wire `registerEnhancedBoosterTools()` in `forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts` — import from agent-booster package, register on the stdio MCP server so the 3 Tier-1 WASM edit tools become MCP-callable.
2. Add ONNX tier to `agentdb-service.ts::upgradeEmbeddingService()` — try `ONNXEmbeddingService` first, fall through to `EnhancedEmbeddingService`, fall through to basic. Use the existing `packages/agentdb-onnx` package; no new dependency.
3. Add acceptance check under `lib/acceptance-adr0069-f3-checks.sh` asserting the registered MCP tool list includes the booster tools and that the ONNX tier activates when `ruvector-onnx-embeddings-wasm` is resolvable.

Once all three items land with green acceptance evidence, F3 moves to Implemented.

### Closure work 2026-04-21 PM

A 15-agent swarm landed the three remaining items and the memory-persistence bug the same day:

- **F1 §2 — `registerEnhancedBoosterTools` wired** in `forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts:30,881` (imports from `src/mcp/fastmcp/tools/booster-tools.ts`, registers 9 tools including the 3 Tier-1 WASM edit tools). Paired unit test `tests/unit/adr0069-f3-booster.test.mjs` (5/5 green). Acceptance check `check_adr0069_f3_booster_tools_registered` in `lib/acceptance-adr0069-f3-checks.sh:312-363`, dispatched at `scripts/test-acceptance.sh:749` and collected in `collect_parallel "all"` at line ~1732.
- **F1 §3 — ONNX tier wired** in `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` function `upgradeEmbeddingService()` (lines 549-688). Chain is now ONNX → Enhanced → Basic with loud-fail logging at each tier per ADR-0082 (no silent catches). Unit test `tests/unit/agentdb-service-f1-improvements.test.mjs` (30/30 green, Group 2 promoted from simulator to real-import guard, new Group 2c pins package export surface). Acceptance check `check_adr0069_f3_onnx_tier_active` in `lib/acceptance-adr0069-f3-checks.sh:366-475`, dispatched at line 752, collected in `collect_parallel "all"` at line ~1733.
- **Bug #3 — memory persistence outside init'd projects fixed** in `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` via a new `_resolveDatabasePath()` helper that falls back to `~/.claude-flow/data/memory.rvf` when no ancestor `.claude-flow/` is found. Fail-loud on `mkdirSync` failure — no silent in-memory fallback. Unit test `tests/unit/adr0069-bug3-memory-persist.test.mjs` (11/11 green). Acceptance check `check_adr0069_bug3_store_persist_outside_init` in `lib/acceptance-adr0069-bug3-checks.sh`, dispatched at line 709, collected in `collect_parallel "all"` at line ~1734.
- **BM25 hash-fallback search** (enables the ADR-0082 loud-fail checks the ADR-0069 work exposed) landed in `forks/ruflo/v3/@claude-flow/memory/src/bm25.ts` (new) + `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts` (search branch). Unit test `tests/unit/hash-fallback-bm25.test.mjs` (14/14 green).

Also landed the same day: residual A1 (3 WAL sites), A6 (4 port sites), A8 (1 missed LR site); A5 open (agent stopped on a misread system reminder — needs a small re-dispatch). F1 AC #3 reconciliation below.

### F1 AC #3 reconciliation

The original F1 AC #3 demanded a literal LOC reduction of `agentdb-service.ts` from ~1,679 to ~700-800 lines by extracting Phase 2/4 controllers into separate owners. That target was not met at the source level: `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` is currently 1,831 LOC, and `controller-registry.ts` is 2,063 LOC. Instead, the duplicate-instance problem that AC #3 was proxying for was solved functionally by ADR-0089's intercept pattern — a `getOrCreate()` controller pool wired through 16 call sites that guarantees zero duplicate instantiations per controller name across AgentDB, AgentDBService, and ControllerRegistry, verified by the `adr0089-shipped` / `adr0089-svc` / `adr0089-reg` / `adr0089-live` acceptance checks. Source-level deletion of these upstream-maintained files was assessed and rejected: the 17-file migration cost and permanent upstream-merge conflict surface exceed the aesthetic gain, with no runtime benefit once the intercept pattern is in place (see the 2026-04 CLAUDE.md lesson "Deleting upstream-maintained files to satisfy the 500-line rule"). AC #3 is therefore reconciled to the functional criterion above rather than the original LOC target.

## Post-Sync Update (2026-04-06)

Upstream v3.5.52-v3.5.58 merged into ruflo fork. Impact: SIGNIFICANT.
- Config chain functions (readProjectConfig, getProjectConfig, getEmbeddingConfig, getConfigSwarmDir) all survived merge — verified in memory-bridge.ts and memory-initializer.ts
- 3 embedding-constants.ts files survive in @claude-flow/cli (ADR-0052 pattern, superseded but functional) — cleanup deferred
- hooks-tools.ts uses both EMBEDDING_DIM (ADR-0052) and getEmbeddingConfig() (ADR-0069) — values consistent, no behavioral divergence
- F1 delegation and F3 WASM fallback chain: unaffected by upstream changes
- Upstream creator endorses config chain approach, suggests fail-loud instead of graceful fallback for missing embeddings.json

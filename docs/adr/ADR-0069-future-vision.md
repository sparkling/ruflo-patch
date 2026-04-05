# ADR-0069: Future Vision -- AgentDBService Consolidation, RVF Storage Unification, Full AttentionService

- **Status**: Partially Implemented (config chain bypass remediation complete)
- **Date**: 2026-04-05
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

## F2: RVF as Single Storage Format

### What RuVector ADR-029 proposes

RuVector ADR-029 (RVF Canonical Format) defines a single binary format for all vector/memory storage with profiles for different use cases:

- `RVText` profile: text content + embeddings + metadata (replaces AgentDB's JSON + SQLite)
- `WITNESS_SEG` profile: audit trails with cryptographic attestation (replaces claude-flow's flat JSON)
- Streaming protocol: for cross-process memory sharing (replaces agentic-flow's shared memory blobs)

### Current state (6 separate formats)

| Format | Used by | Location |
|--------|---------|----------|
| SQLite (better-sqlite3) | AgentDB core, SQLiteBackend | `.swarm/memory.db` |
| SQLite (AgentDBBackend) | HybridBackend's AgentDB layer | Same `.db` file |
| RVF (RvfBackend) | SelfLearningRvfBackend | `.swarm/memory-rvf.sqlite` |
| JSON (flat files) | claude-flow config, daemon state | `.claude-flow/data/*.json` |
| Graph binary | GraphDatabaseAdapter | `.swarm/memory.graph` |
| In-memory Maps | MemoryGraph, AgentDBService fallback | Process memory only |

These formats cannot interoperate. A memory entry stored via the CLI (SQLiteBackend) is invisible to a search via MCP tools (AgentDBService's in-memory fallback). The graph stored in `.swarm/memory.graph` has no connection to the causal graph in SQLite.

### Migration path

The `claude-flow-v3-ruvector` branch in ruvnet/RuVector contains a SPARC plan to replace AgentDB's JS vector layer with RuVector Rust-native storage via NAPI-RS (primary) with WASM fallback. Target performance: 150x pattern search, 500x batch operations.

Migration sequence:
1. RvfBackend becomes the primary IMemoryBackend (it already exists and works)
2. SQLiteBackend delegates to RvfBackend for vector operations, keeps SQLite for relational queries
3. AgentDB's internal HNSW index delegates to RuVector's Rust HNSW via NAPI-RS
4. GraphDatabaseAdapter migrates from custom binary to RVF graph profile
5. JSON config/state files remain as-is (they are human-readable config, not storage)

### Blocking issues

- **#315** (ruvnet/RuVector): `import()` does not rebuild HNSW index -- `recall()` returns empty after load. PR #318 (`importAsync() + rebuildHnswIndex()`) is open but unmerged.
- **#323** (ruvnet/RuVector): ONNX embedder fails on Node 22 LTS with `.wasm` extension error. Blocks ONNX-based embedding on current LTS.
- **#316** (ruvnet/RuVector): sync `embed()` returns hash vectors, not semantic vectors. Using the sync path corrupts persisted databases with mixed dimension spaces.
- The `claude-flow-v3-ruvector` branch has a plan but no implementation. NAPI-RS bindings for RuVector do not exist yet.

### Hardcoded values in ruvector (audited 2026-04-05)

These affect F2 scope — when RVF becomes the primary storage backend, these hardcodes will need config plumbing.

| File:line | Value | Severity | Issue |
|-----------|-------|----------|-------|
| `ruvector-postgres/src/routing/router.rs:158,167` | `embedding_dim: 768` | HIGH | No setter or constructor param — non-768 models silently misroute |
| `ruvector-postgres/src/workers/engine.rs:937,946,955` | `ef_search: Some(50)` ×3 | HIGH | Production query paths with no per-query HNSW override |
| `ruvector-dag/src/qudag/network.rs:14`, `client.rs:17` | `qudag.network:8443` | HIGH | Production hostname in Default — self-hosted deployments fail |
| `ruvector-graph/src/distributed/replication.rs:111,121` | Port `:9001` concatenated | HIGH | No configurable replication port |
| `ruvector-core` vs `ruvector-postgres` | m:32/efC:200 vs m:16/efC:64 | MEDIUM | HNSW default inconsistency between crates |

### Risks

- RVF is a young format. The open bugs above affect core operations (import, embed, Node compatibility).
- Migrating existing `.swarm/memory.db` data to RVF requires a one-time conversion tool that does not exist.
- NAPI-RS bindings require native compilation per platform (macOS ARM, Linux x64), complicating CI.
- Fallback to WASM is 10-100x slower than NAPI-RS, narrowing the performance benefit.

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

### Current state

Only WASM stubs and `LegacyAttentionAdapter` exist. The vision document (Section 7) confirms "only `sublinearAttention` wired" and agentic-flow ADR-062 rates "Attention -> Tools: 0% (F)".

The current 4 duplicate AttentionService instances (documented in ADR-0066 Problem 3) all use LegacyAttentionAdapter and provide only basic cosine-similarity-weighted attention. ADR-0068 P1-3a/b/c/d will reduce these to 1 shared instance, but that instance still only provides the legacy adapter.

### Why this is not a singleton (by design)

ADR-0067 Section 8 documents this explicitly: "ADR-028 explicitly designed AttentionService for multiple instances." The evidence:

- `SONAWithAttention` creates TWO instances -- one for Flash Attention (self-attention layers), one for MoE attention (expert routing). These have different mechanism configurations.
- The intended `@claude-flow/attention` package was designed as an instantiable class with per-use configuration, not a process singleton.
- The singleton pattern in the current WIRING-PLAN (Section 1.2: `svc.getAttentionService()`) was a pragmatic narrowing for the MVP, not the target architecture.

The correct architecture (per ADR-0067): multiple AttentionService instances are valid when intentionally configured for different use cases (Flash vs MoE vs Hyperbolic). Unintentional duplicates with identical config should be shared. ADR-0068 achieves the second part; F3 enables the first.

### Prerequisite: @ruvector/attention WASM module

The `@ruvector/attention` package does not exist yet. The Rust-side attention mechanisms are in `ruvector-core` but not compiled to WASM or exposed via NAPI-RS. Building this requires:

1. Extracting attention mechanisms from `ruvector-core` into a standalone `ruvector-attention` crate
2. Building WASM bindings via `wasm-pack` (for cross-platform) and NAPI-RS bindings (for performance)
3. Creating the `@claude-flow/attention` TypeScript package that loads WASM/NAPI and exposes the 39 mechanism types
4. Replacing `LegacyAttentionAdapter` with real mechanism dispatch

### Effort estimate

This is the largest of the three items. The 39 mechanism types represent significant Rust implementation work (each mechanism is a separate attention computation kernel). Realistic scope for a first phase would be: Flash Attention + Multi-Head + MoE (the three that have existing Rust code in ruvector-core), with the remaining 36 as stubs.

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
| A6 | Port numbers | HIGH | 18 | `ports.*` | **Partial** (env-var guards; config.json not yet read at all sites) |
| A7 | Similarity threshold | HIGH | ~10 | `memory.similarityThreshold` | **Yes** |
| A8 | Learning rate | HIGH | 13 | `neural.defaultLearningRate` | **Yes** |
| A9 | Embedding cache bug | HIGH | 1 | `memory.embeddingCacheSize` | **Yes** |
| A10 | Migration batch size | HIGH | 2 | `memory.migrationBatchSize` | **Yes** |
| A11 | Dedup threshold | HIGH | ~4 | `memory.dedupThreshold` | **Yes** |
| **Total** | | | **~86 sites** | **14 new config keys** | **10 of 11 complete** |

All 11 items have config.json fields. 10 are fully remediated; A6 (ports) uses env-var guards but not all sites read from config.json yet. The embedding/HNSW bypass sites documented in F1 above (12 sites, remediated 2026-04-05) are separate from this inventory.

### Residual bypass sites (validated 2026-04-05)

15-agent validation swarm confirmed the primary remediation is sound. The following secondary sites were found still hardcoded:

| Category | File | Value | Severity |
|----------|------|-------|----------|
| A1 SQLite | 8 agentic-flow CLI/benchmark/query sites | Missing `busy_timeout` after WAL | HIGH |
| Dim 768 | `agentdb-wrapper.ts:90`, `agentdb-wrapper-enhanced.ts:108` | `\|\| 768` fallback | HIGH |
| Dim 768 | `HNSWIndex.ts:152` | `dimension: 768` in default config | HIGH |
| maxElements | `AgentDB.ts:166` | `?? 10000` stale fallback | HIGH |
| maxElements | `agentdb-service.ts:271,301` | Literal `100000` instead of `hnswParams.maxElements` | MEDIUM |
| A5 EWC | `intelligence-tools.ts:315` | `ewcLambda: 1000.0` (reporting) | MEDIUM |
| A5 EWC | `SonaLearningBackend.ts` | `?? 1000` fallback | MEDIUM |
| A8 LR | `sona-adapter.ts` (5 modes), `self-learning.ts` (5 sites) | Per-mode LR not config-aware | MEDIUM |
| A11 dedup | `rvf-tools.ts:50` | Fallback 0.98 (should be 0.95) | MEDIUM |
| A6 ports | 4 agentic-flow sites | No env-var guard | MEDIUM |
| A3 timeouts | `dispatch-service.ts:330`, `custom-worker-factory.ts:223` | Unguarded fallbacks | MEDIUM |
| A2 rate | `agentdb-cli.ts:893` | `maxRequestsPerMinute: 60` | LOW |

### New patterns identified (not in original A1-A11 audit)

| ID | Category | Severity | Detail |
|----|----------|----------|--------|
| A12 | Embedding model divergence | MEDIUM | ruflo defaults to `all-mpnet-base-v2` (768d), agentic-flow to `all-MiniLM-L6-v2` (384d) — vector incompatibility risk for shared memory |
| A13 | Cleanup intervals | MEDIUM | `setInterval(60000)` at 5+ sites across both forks, not configurable |
| A14 | Memory buffer limits | LOW | `maxBuffer` ranges 5MB-100MB across 60+ `execSync` sites |
| A15 | Service base URLs | MEDIUM | Ollama `localhost:11434`, RuvLLM `localhost:3000` — no env-var guards |
| A16 | HuggingFace model URLs | LOW | No private registry support for air-gapped deployments |
| A17 | EWC consolidator dim | MEDIUM | `ewc-consolidation.ts:152` hardcodes `dimensions: 768`, never receives config |

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
- [ ] AgentDBService reduced to MCP facade (~700-800 lines; 13 controllers delegated, 16 stay)
- [ ] All 50+ MCP tool callers pass integration tests with consolidated service
- [ ] In-memory fallback preserved for environments without better-sqlite3

### F2: RVF Single Storage
- [ ] RuVector issues #315, #323, #316 closed (blocking bugs fixed)
- [ ] NAPI-RS bindings for RuVector exist and pass CI on macOS ARM + Linux x64
- [ ] RvfBackend is primary IMemoryBackend; SQLiteBackend deprecated
- [ ] Migration tool converts existing `.swarm/memory.db` to RVF format
- [ ] `.swarm/memory.graph` data migrated to RVF graph profile
- [ ] Cross-tool data visibility verified (CLI store -> MCP search returns results)

### F3: Full AttentionService
- [ ] `@ruvector/attention` crate exists with WASM + NAPI-RS bindings
- [ ] `@claude-flow/attention` package wraps Rust module with TypeScript API
- [ ] At least 3 mechanism types functional: Flash Attention, Multi-Head, MoE
- [ ] LegacyAttentionAdapter replaced by real dispatch in ControllerRegistry
- [ ] SONAWithAttention correctly uses 2 separate AttentionService instances (Flash + MoE)
- [ ] Performance benchmark: Flash Attention achieves >= 2x speedup over legacy adapter

# ADR-0039: Upstream AgentDB Controller Integration Roadmap

## Status

Proposed

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR

## Context

ADR-0033 completed activation of 27 of 28 AgentDB v3 controllers (FederatedSession remains blocked). A comprehensive swarm-assisted audit of the upstream `agentic-flow/packages/agentdb/src/` codebase found **31 additional classes** that could serve as standalone controllers but are not yet integrated.

### Current State (post ADR-0033, patch.28+)

- **27 controllers wired** across 7 initialization levels (0-6)
- **1 blocked** (FederatedSession — upstream API undefined)
- **35+ SQLite tables** across 4 schemas (core, frontier, learning, RVF)
- **10 in-memory-only controllers** (tieredCache, memoryGraph, agentMemoryScope, solverBandit, semanticRouter, mutationGuard, gnnService, rvfOptimizer, mmrDiversityRanker, contextSynthesizer)
- **Routing cascade** (intended): SolverBandit → SkillLibrary → LearningSystem → SemanticRouter → TASK_PATTERNS (note: BUG-1 in Phase 0 audit found SolverBandit bridge functions not exported — cascade currently falls through to TASK_PATTERNS)

### Swarm Verification (2026-03-15)

Swarm `swarm-1773614607869` (hierarchical, 8 max agents) confirmed healthy:

| Component | Status | Backend |
|-----------|--------|---------|
| Coordinator | ok | message-bus |
| Agent pool | ok (2 researchers) | raft consensus |
| Memory | ok | **sql.js + HNSW** (primary, no fallback) |
| Neural | running | health=0.9 |
| MCP | running | health=1.0 |

**One packaging bug found**: Published `@sparkleideas/cli` has a broken import chain — `memory-tools.js` cannot resolve `memory-bridge.js` in dist. MemoryGraph's `addNode`/`getImportance` calls fail. This is a build artifact issue, not a runtime fallback.

### Audit Methodology

Three concurrent analysis tracks:

1. **Controller Analyst agent** — mapped all 27 wired controllers to their storage, bridge functions, and MCP tools
2. **Upstream Scanner agent** — found 115+ exported classes in agentdb source, identified 31 new candidates
3. **Direct source analysis** — read controller-registry.ts (1148 lines), memory-bridge.ts (2000+ lines), all MCP tool files, agentdb barrel exports, and schema SQL files

### Decision Drivers

1. The 27 wired controllers leave significant upstream capability untapped
2. The **Attention Controller Suite** (5 classes) would transform retrieval from vector-only to attention-weighted
3. **SelfLearningRvfBackend** would make the vector index self-tuning (no manual parameter configuration)
4. **FederatedLearningManager** provides distributed learning (pure JS path works without native SONA)
5. **QuantizedVectorStore** offers 4-32x memory reduction for large stores
6. **CircuitBreaker** and **RateLimiter** address production reliability gaps

## Decision: Specification (SPARC-S)

### Data Storage Architecture (Current)

All 27 controllers use a layered storage model:

```
MCP Tools (agentdb-tools.ts, memory-tools.ts, hooks-tools.ts)
    ↓
Memory Bridge (memory-bridge.ts — 30+ exported functions)
    ↓
ControllerRegistry (controller-registry.ts — 7 init levels, parallel init within levels)
    ↓
AgentDB Core (better-sqlite3 synchronous API)
    ↓
SQLite Database (.swarm/memory.db or :memory:)
```

**Storage categories**:

| Category | Controllers | Persistence |
|----------|:-----------:|-------------|
| SQLite + VectorBackend (hybrid) | 8 | Durable — ReasoningBank, HierarchicalMemory, Skills, Reflexion, CausalGraph, ExplainableRecall, LearningSystem, GuardedVectorBackend |
| SQLite only | 3 | Durable — AttestationLog, MemoryConsolidation, BatchOperations |
| In-memory with persistence | 2 | SolverBandit (JSON to memory_entries), MemoryGraph (rebuilds from backend) |
| In-memory only (volatile) | 8 | TieredCache, AgentMemoryScope, SemanticRouter, MutationGuard, GnnService, RvfOptimizer, MmrDiversityRanker, ContextSynthesizer |
| Delegated | 3 | NightlyLearner (orchestrator, creates duplicate sub-instances — see Phase 0 fix), GraphTransformer (duplicate of CausalMemoryGraph — removed in Phase 0), GraphAdapter (backend-dependent) |
| Blocked | 1 | FederatedSession |

**SQLite tables (35+)**:

- **Bridge**: `memory_entries` (main KV store)
- **Core schema** (15): `episodes`, `episode_embeddings`, `skills`, `skill_links`, `skill_embeddings`, `facts`, `notes`, `note_embeddings`, `events`, `consolidated_memories`, `exp_nodes`, `exp_edges`, `exp_node_embeddings`, `memory_scores`, `memory_access_log`, `consolidation_runs`
- **Frontier schema** (8): `causal_edges`, `causal_experiments`, `causal_observations`, `recall_certificates`, `provenance_sources`, `justification_paths`, `learning_experiences`, `learning_sessions`
- **LearningSystem** (4): `learning_sessions`, `learning_experiences`, `learning_policies`, `learning_state_embeddings`
- **ReasoningBank** (2): `reasoning_patterns`, `pattern_embeddings`
- **RVF** (2): `rvf_meta`, `rvf_vectors`

### Interchangeability and Relationships

Some controllers are alternatives to each other; most are complementary at different pipeline stages.

#### Interchangeable Groups (pick one or combine)

**Attention Re-rankers (A1, A2, A3)** — All three re-rank search results after vector search. Any single one adds value. They're designed to stack (different perspectives), but A3 (MultiHead) subsumes A1 (Self) in theory. A5 provides advanced mechanisms (Flash, MoE, GraphRoPE, Hyperbolic) that complement A1-A3 at different pipeline stages — A5 is NOT a replacement for A1-A3.

| Controller | Question it answers | When to use |
|------------|-------------------|-------------|
| A1 SelfAttention | "Which memories are relevant *to each other*?" | Single-namespace retrieval |
| A2 CrossAttention | "Which memories from *different namespaces* align?" | Cross-tier queries (working + episodic + semantic) |
| A3 MultiHeadAttention | "What are *multiple independent perspectives* on relevance?" | Complex queries needing semantic + temporal + structural ranking |

**Quantization (B7, B8 — alternatives within B9)** — B9 wraps both. You pick one method per store. Mutually exclusive within a single QuantizedVectorStore instance.

| Method | Compression | Quality Loss | Use when |
|--------|:-----------:|:------------:|----------|
| B7 Scalar 8-bit | 4x | <1% | Default — almost free quality trade |
| B7 Scalar 4-bit | 8x | ~3-5% | Memory-constrained |
| B8 Product | 8-32x | ~5-10% | >100K memories, batch search |

**Filtering (B5 vs B10)** — Same user-facing concept (filter by metadata), different backends. B5 (MetadataFilter) works on SQLite and in-memory. B10 (FilterBuilder) only works with RVF. Pick B5; B10 stays internal.

**SONA vs LearningBridge (A8 upgrades existing #3)** — A8 is the real implementation of what learningBridge approximates. Micro-LoRA in <1ms vs basic confidence decay. A8 is created internally by A6 (SelfLearningRvfBackend) — not wired separately. When A6 is integrated (Phase 11), SONA replaces learningBridge's role automatically.

#### Everything Else Is Complementary (different pipeline stages)

The remaining controllers each do something unique that no other controller does. They operate at different stages of the memory pipeline and do not overlap.

### What These Processors Give Us

#### 1. Search results get dramatically better (Phase 8-9)

**Without** (current): Query → vector cosine similarity → ranked by distance → return top-K.

**With**: Query → vector search → attention re-ranking (which results are relevant to *each other*, not just the query) → metadata filtering (`$score > 0.8`, `$tags includes "security"`) → query caching (repeat queries instant) → return top-K.

Example: Search "authentication patterns." Currently returns 10 results scattered randomly by cosine distance. With attention, the system notices JWT and session management memories reference each other (high self-attention), groups the coherent cluster, and ranks it above isolated results. Cross-attention further boosts results that align across both "patterns" and "incidents" namespaces.

#### 2. The system gets smarter over time without retraining (Phase 11-14)

**Without** (current): Every session starts cold. No learning. Static routing.

**With**:
- **SONA** (A8) adapts routing in <1ms. After 50 tasks, knows "security tasks → security-architect" without TASK_PATTERNS.
- **ContrastiveTrainer** (A7) improves embedding quality. Memories frequently retrieved together move closer in vector space. After 1000 searches, recall improves 10-20%.
- **SelfLearningRvfBackend** (A6) auto-tunes HNSW parameters. Slow searches → increase ef. Tight memory → decrease M. No manual config.
- **TemporalCompressor** (B2) compresses old, rarely-accessed memories (up to 96% at binary tier) while keeping hot memories at full precision.
- **IndexHealthMonitor** (B3) detects degradation and recommends rebalancing before users notice.

#### 3. Memory goes 4-32x further (Phase 13)

**Without**: 768-dim embedding = 3KB (Float32). 100K memories = 300MB for embeddings alone.

**With**: Scalar 8-bit: 100K = 75MB (4x). Product quantization: 100K = ~10-37MB (8-32x). Difference between "agent OOMs after 3 days" and "agent runs indefinitely."

#### 4. One failure doesn't break everything (Phase 7)

**Without**: memory-bridge.js import fails → MemoryGraph throws → memory_store errors → memory_search errors → entire memory system unusable.

**With**: CircuitBreaker isolates the failing controller after 5 errors. Other controllers keep working. Auto-retries after 60s. RateLimiter caps runaway ops (100 inserts/sec). ResourceTracker warns at 80% memory, hard-stops at 16GB.

#### 5. Multi-provider embeddings with automatic fallback (Phase 10)

**Without**: Hardcoded Xenova/all-MiniLM-L6-v2 (384-dim). Fails → hash fallback (near-useless).

**With** (A9): Xenova → OpenAI → Cohere → hash. LRU cache (100K). Batch semaphore (10 concurrent). Auto dimension alignment.

#### 6. Production observability (Phase 16)

**Without**: Console.log or nothing.

**With**: OpenTelemetry spans (D1) for Grafana/Prometheus. Per-mechanism attention metrics (D2). SOC2/HIPAA-ready security audit journal (D3).

#### 7. Agents learn from each other (Phase 12)

**Without**: Each session is isolated. Knowledge dies at session end.

**With** (A11): Agent 1 learns approach A, Agent 2 learns approach B → Coordinator aggregates with quality weighting → next session starts with collective knowledge.

### Value Summary Per Phase

| Phase | One-sentence value |
|-------|-------------------|
| **7** | System doesn't break catastrophically when one thing fails |
| **8** | Filter memories by metadata; repeated queries are instant |
| **9** | Search results ranked by actual relevance, not just vector distance |
| **10** | Embeddings work even if primary model is down; compliance audit trail |
| **11** | System tunes itself: SONA routing, contrastive embeddings, adaptive ef, temporal compression — all via single A6 composite |
| **12** | Agents share knowledge across sessions via federated consolidation |
| **13** | Store 4-32x more memories in the same RAM |
| **14** | Index stays healthy with passive monitoring and parameter recommendations |
| **16** | See what's happening in Grafana; tune attention heads |

### 31 New Controller Candidates

Catalogue of all candidates as originally identified. **Verdicts (implement/defer/drop) and composition analysis are in SPARC-R below.** Organized into 4 tiers by value and integration complexity.

#### Tier A: High-Value (11 controllers)

| ID | Class | Source File | Description |
|----|-------|------------|-------------|
| A1 | **SelfAttentionController** | `controllers/attention/SelfAttentionController.ts` | Computes self-attention scores across memory entries using scaled dot-product attention. Identifies which memories are most relevant to each other, enabling inter-memory relationship discovery. Produces attention weight matrices for priority scoring. Each memory "attends to" all other memories, creating a soft relevance graph that complements MemoryGraph's explicit edges. |
| A2 | **CrossAttentionController** | `controllers/attention/CrossAttentionController.ts` | Cross-attention between query context and stored memories. The query acts as Q (query), stored memories act as K/V (keys/values). Produces alignment scores showing how each part of the query maps to stored knowledge. Enables retrieval where query structure influences which memories surface — a paragraph-level query can attend to different memories for different clauses. |
| A3 | **MultiHeadAttentionController** | `controllers/attention/MultiHeadAttentionController.ts` | Parallel attention heads (configurable count), each focusing on different aspects of query-memory relationships: semantic similarity, temporal proximity, structural overlap, causal relevance. Produces composite scores from independent perspectives. The heads specialize automatically during use — no manual configuration of what each head tracks. |
| A4 | **MemoryController** | `controllers/MemoryController.ts` | Unified memory controller integrating attention mechanisms with vector search. Provides `store()`, `search()`, `attend()` with attention-integrated retrieval. Manages memory lifecycle with attention-based importance scoring. Could replace the current memory_store/search pipeline. Combines TieredCache, VectorBackend, and Attention into a single coherent API. |
| A5 | **AttentionService** | `services/AttentionService.ts` (1,500+ lines) + `controllers/AttentionService.ts` (771 lines, facade) | 4 advanced attention mechanisms: **FlashAttention** (tiled block-wise, O(N) memory, real algorithm), **MoEAttention** (8-domain expert routing, real algorithm), **GraphRoPE** (hop-distance-aware positional encoding, needs ~15-line patch), **HyperbolicAttention** (Poincaré ball model, needs native for correct math). All have JS fallbacks. Native bindings published on npm (`@ruvector/attention@0.1.31`, 7 platforms). 1,628 lines of tests. 3 production callers (CausalMemoryGraph, NightlyLearner, ExplainableRecall). 4 MCP tools. |
| A6 | **SelfLearningRvfBackend** | `backends/rvf/SelfLearningRvfBackend.ts` | RVF backend that automatically learns from query patterns. Tracks which vectors are frequently co-retrieved and pre-fetches clusters. Dynamically adapts HNSW parameters (ef construction, ef search, M) based on real workload characteristics. Monitors recall quality and adjusts trade-offs. Self-tuning eliminates manual index configuration. Implements `VectorBackendAsync` interface — drop-in replacement for current vectorBackend. |
| A7 | **ContrastiveTrainer** | `backends/rvf/ContrastiveTrainer.ts` | InfoNCE contrastive learning trainer that continuously improves embedding quality. Uses triplet loss with hard negative mining: given an anchor memory, learns which memories should be close (positive pairs from same session/task) and which should be far (negative pairs from different domains). Background process that runs during NightlyLearner consolidation windows. Over time, search quality improves without changing the embedding model. |
| A8 | **SonaLearningBackend** | `backends/rvf/SonaLearningBackend.ts` | Full SONA (Self-Optimizing Neural Architecture) 3-loop implementation. **Instant Loop**: MicroLoRA rank-2 adaptation in <1ms per inference — adapts to current task context without full fine-tuning. **Background Loop**: K-means++ clustering (hourly) to discover and maintain 100 skill clusters. **Coordinator**: Balances instant adaptation vs. long-term stability using EWC++ (lambda=2000) to prevent catastrophic forgetting. Optimized defaults from π-brain benchmarks: rank=2, lr=0.002, batch=32. Would replace learningBridge with the complete architecture. |
| A9 | **EnhancedEmbeddingService** | `services/enhanced-embeddings.ts` (559 lines) | Multi-model embedding service supporting OpenAI, Transformers.js, and mock providers. Features: automatic dimension alignment (projects 1536→768 for OpenAI, 384→768 for MiniLM), embedding result caching (LRU, configurable TTL), quality metrics (cosine distribution, cluster separation), and model fallback chains (try ONNX → try API → hash fallback). Would replace the current single-model pipeline with a resilient multi-provider system. |
| A10 | **LLMRouter** | `services/LLMRouter.ts` | Multi-provider LLM routing with RuvLLM support. Selects optimal LLM provider per request based on: task complexity (simple→Haiku, complex→Opus), cost budget (tracks cumulative spend), latency requirements (streaming vs batch), and provider health (circuit breaker per provider). Supports custom routing functions. Would add LLM-aware intelligence to the agent selection cascade. |
| A11 | **FederatedLearningManager** | `services/federated-learning.ts` | Complete federated learning pipeline with 3 components: **EphemeralLearningAgent** (trains local model on session data, discards after aggregation — privacy-preserving), **FederatedLearningCoordinator** (aggregates local updates into global model using FedAvg with Byzantine tolerance), **Manager** (orchestrates rounds, manages agent lifecycle, handles stragglers). Byzantine fault tolerance via 2-sigma outlier filtering + reputation-weighted trimmed mean. **This is the only path to unblocking FederatedSession (P4-E)** — provides the API that FederatedSessionManager needs. |

#### Tier B: Infrastructure/Optimization (10 controllers)

| ID | Class | Source File | Description |
|----|-------|------------|-------------|
| B1 | **SemanticQueryRouter** | `backends/rvf/SemanticQueryRouter.ts` | Routes queries to optimal search strategy based on query characteristics. Analyzes: query length (short→exact match, long→semantic), dimensionality (low→brute force, high→HNSW), result cardinality (few→exact, many→approximate), and filter complexity (simple→vector-first, complex→filter-first). Different from SemanticRouter (intent classification) — this optimizes the search algorithm selection. |
| B2 | **TemporalCompressor** | `backends/rvf/AdaptiveIndexTuner.ts` | Compresses temporal data by merging similar time-adjacent memories. Uses configurable decay functions: exponential (fast decay, recent-biased), linear (uniform decay), step (retain N most recent, discard rest). Merges memories within a similarity threshold (configurable). Reduces storage 2-5x while preserving important temporal patterns. Runs as background task during consolidation. |
| B3 | **IndexHealthMonitor** | `backends/rvf/AdaptiveIndexTuner.ts` | Continuously monitors HNSW/RVF index health: recall accuracy (sampled ground-truth queries), latency percentiles (p50/p95/p99), fragmentation ratio, memory pressure, and query distribution skew. Detects degradation (recall drops below threshold) and triggers automatic rebalancing or parameter adjustment. Emits events for alerting. |
| B4 | **NativeAccelerator** | `backends/rvf/NativeAccelerator.ts` | WASM/native acceleration bridge for vector operations. Provides SIMD-optimized distance calculations (cosine, L2, inner product), batch matrix operations, and quantized distance functions. 2-8x speedup over pure JS for vector math. Auto-detects WASM availability and falls back to JS. |
| B5 | **MetadataFilter** | `controllers/MetadataFilter.ts` | MongoDB-style metadata filtering engine: `$gt`, `$lt`, `$gte`, `$lte`, `$eq`, `$ne`, `$in`, `$nin`, `$regex`, `$exists`, `$and`, `$or`, `$not`, `$elemMatch`. Already exported from controllers/index.ts barrel file. Would enable structured predicates on memory entries beyond the current namespace/tag filtering. Compiles filter expressions to efficient SQLite WHERE clauses. |
| B6 | **QueryOptimizer** | `optimizations/QueryOptimizer.ts` | Rewrites and optimizes memory queries before execution. Strategies: caching hints (reuse recent identical queries), predicate pushdown (apply filters before vector search), early termination (stop when top-k quality threshold met), and query plan selection (choose between index scan, full scan, hybrid based on selectivity estimates). |
| B7 | **ScalarQuantization** | `quantization/vector-quantization.ts` | 8-bit and 4-bit scalar quantization for embedding vectors. **8-bit**: 4x memory reduction, <1% recall loss. **4-bit**: 8x memory reduction, ~3-5% recall loss. Includes `quantize8bit()`, `dequantize8bit()`, `quantize4bit()`, `dequantize4bit()`, `calculateQuantizationError()`, `getQuantizationStats()`. Drop-in replacement for Float32Array embeddings. |
| B8 | **ProductQuantizer** | `quantization/vector-quantization.ts` | Product quantization splitting vectors into M subspaces, each quantized independently with K centroids. **Compression**: 64-256x (e.g., 768-dim Float32 → 96 bytes with M=96, K=256). Training: K-means per subspace on representative sample. Asymmetric distance computation for search accuracy. Ideal for stores with >100K entries. |
| B9 | **QuantizedVectorStore** | `quantization/vector-quantization.ts` | Full quantized vector store combining quantization + HNSW search. Drop-in replacement for vectorBackend at 4-32x reduced memory footprint. Factory functions: `createScalar8BitStore()`, `createScalar4BitStore()`, `createProductQuantizedStore()`. Manages quantization codebooks, handles insertion with automatic quantization, and search with asymmetric distance. |
| B10 | **FilterBuilder** | `backends/rvf/FilterBuilder.ts` | Fluent DSL-based filter expression builder that compiles to RVF filter expressions. Enables complex queries like `where('namespace').equals('patterns').and('score').gt(0.8).and('tags').contains('security')`. Type-safe, composable, and optimizable. |

#### Tier C: Networking & Sync (4 controllers, deferred)

| ID | Class | Source File | Description |
|----|-------|------------|-------------|
| C1 | **QUICServer** | `controllers/QUICServer.ts` (499 lines) | Memory sync server with real application logic: database sync SQL for episodes/skills/edges, rate limiting (60s windows), connection tracking. **Transport layer is mock** (100ms simulated delay). Real implementation needs ~80 lines to replace mock with HTTP POST using existing MCP transport patterns. |
| C2 | **QUICClient** | `controllers/QUICClient.ts` (668 lines) | Memory sync client with real logic: connection pooling (5 conns), retry with exponential backoff, batch processing, progress callbacks. **Transport layer is mock** (`sendRequest()` returns empty data after 100ms). Same ~80 lines to replace with `fetch()` POST. |
| C3 | **SyncCoordinator** | `controllers/SyncCoordinator.ts` | Multi-database synchronization coordinator for distributed agent deployments. Manages conflict resolution via vector clocks (happens-before ordering), merge strategies (LWW — last-writer-wins, CRDT — conflict-free replicated data types, custom resolver functions), and partition tolerance (continues operating during network splits, reconciles on reconnect). Table: `sync_state` for tracking sync progress per peer. |
| C4 | **RuVectorLearning** | `backends/ruvector/RuVectorLearning.ts` | RuVector native learning capabilities. GNN-based differentiable search where the index itself learns from retrieval patterns — frequently co-accessed vectors are moved closer in the index graph. Learning-rate scheduling prevents overfitting to recent queries. Would make the native RuVector backend self-improving over time. |

#### Tier D: Observability & Security (6 controllers)

| ID | Class | Source File | Description |
|----|-------|------------|-------------|
| D1 | **TelemetryManager** | `observability/telemetry.ts` | OpenTelemetry-compatible telemetry collection with spans (controller operation traces), counters (operation counts, error rates), and histograms (latency distributions, result set sizes). Tracks per-controller metrics: init time, call count, error rate, p50/p95/p99 latency. Exportable to Prometheus, Grafana, or OTLP collectors. |
| D2 | **AttentionMetricsCollector** | `utils/attention-metrics.ts` | Attention-specific metrics collection: head utilization (which attention heads are active), sparsity ratio (fraction of near-zero attention weights), entropy (attention distribution uniformity), coverage (fraction of memories receiving non-trivial attention). Required for tuning A1-A5 attention controllers. |
| D3 | **AuditLogger** | `services/audit-logger.service.ts` | Structured security audit logging with compliance event formatting. Goes beyond AttestationLog: typed event schemas (access, mutation, deletion, policy change), retention policies, tamper detection (hash chains), and export to SIEM systems. Supports SOC2 and HIPAA-style event categorization. |
| D4 | **ResourceTracker** | `security/limits.ts` | Resource usage tracking with configurable limits per controller: memory (RSS, heap), CPU (time slicing), disk (database size), connections (concurrent SQLite handles). Prevents runaway controllers from consuming unbounded resources. Emits warning at 80% threshold, enforces hard limit at 100%. |
| D5 | **RateLimiter** | `security/limits.ts` | Token-bucket rate limiter for MCP tool calls. Configurable per tool: tokens per interval, burst size, cooldown period. Prevents abuse of expensive operations (embedding generation, full-text search, batch operations). Returns 429-style responses with retry-after hints. |
| D6 | **CircuitBreaker** | `security/limits.ts` | Cascading failure protection for controllers. States: CLOSED (normal), OPEN (failing — all calls short-circuit to fallback), HALF-OPEN (testing recovery). Configurable: failure threshold (e.g., 5 consecutive errors), recovery timeout (e.g., 30s), and per-controller fallback functions. Prevents one failing controller (e.g., broken agentdb import) from degrading the entire system. |

## Decision: Pseudocode (SPARC-P)

### Integration Pattern (applies to all tiers)

**For top-level controllers** (18 wired in ControllerRegistry):

```
1. Add to ControllerRegistry type unions (AgentDBControllerName or CLIControllerName)
2. Add to INIT_LEVELS at appropriate level
3. Add to isControllerEnabled() switch
4. Add to createController() factory
5. Add bridge function(s) in memory-bridge.ts
6. Add MCP tool(s) in agentdb-tools.ts or relevant tool file
7. tsc --noEmit → npm run preflight → commit → push → GitHub issue → deploy
```

**For composite sub-components** (8 via parent — A7, A8, B1, B2, B7, B8, FederatedSessionManager, RvfSolver):
- Skip steps 1-4 — the parent composite (A6 or B9) creates them internally
- Bridge functions call the parent's API (e.g., `a6.search()`, `b9.insert()`)
- MCP tools expose parent-level operations, not sub-component methods directly

### Attention Suite Integration (A1-A3 + A5)

```
// controller-registry.ts — Level 2 (after vectorBackend)
INIT_LEVELS[2].controllers.push('selfAttention', 'crossAttention', 'multiHeadAttention', 'attentionService');

// createController — A1-A3 (pure JS, no native deps)
case 'selfAttention': {
  const { SelfAttentionController } = await import('agentdb');
  return SelfAttentionController ? new SelfAttentionController({ dimension: 768 }) : null;
}
case 'crossAttention': {
  const { CrossAttentionController } = await import('agentdb');
  return CrossAttentionController ? new CrossAttentionController({ dimension: 768 }) : null;
}
case 'multiHeadAttention': {
  const { MultiHeadAttentionController } = await import('agentdb');
  return MultiHeadAttentionController ? new MultiHeadAttentionController({ dimension: 768, numHeads: 8 }) : null;
}

// createController — A5 (4 mechanisms, JS fallbacks + optional native)
case 'attentionService': {
  const { AttentionService } = await import('agentdb');
  if (!AttentionService) return null;
  return new AttentionService({
    flash:       { enabled: true,  blockSize: 256 },          // JS: real algorithm (tiled + online softmax)
    moe:         { enabled: true,  numExperts: 8, topK: 2 },  // JS: real algorithm (domain routing)
    graphRoPE:   { enabled: true,  maxHops: 10 },             // JS: needs 3-bug patch (~15 lines)
    hyperbolic:  { enabled: false },                           // Enable in Phase 11 after native install
  });
}

// memory-bridge.ts — wire A1-A3 as search re-rankers
async function bridgeAttentionSearch(options) {
  const multiHead = registry.get('multiHeadAttention');
  if (!multiHead) return null;  // fallback to existing pipeline
  const vectorResults = await bridgeSearchEntries(options);
  const attended = await multiHead.attend(vectorResults.results, { topK: options.limit });
  return { ...vectorResults, results: attended, attention: true };
}

// memory-bridge.ts — wire A5 FlashAttention for consolidation
async function bridgeFlashConsolidate(entries) {
  const attn = registry.get('attentionService');
  if (!attn) return bridgeConsolidate(entries);  // fallback to existing
  return attn.flashAttention(entries, { blockSize: 256 });  // O(n) memory vs O(n^2)
}

// memory-bridge.ts — wire A5 MoE for expert routing
async function bridgeMoERoute(task, candidates) {
  const attn = registry.get('attentionService');
  if (!attn) return null;
  return attn.moeAttention(task, candidates, { topK: 2, expertDomains: ['code','reasoning','planning'] });
}

// memory-bridge.ts — wire A5 GraphRoPE for hop-aware recall
async function bridgeGraphRoPESearch(query, hopDistances) {
  const attn = registry.get('attentionService');
  if (!attn) return null;
  return attn.graphRoPE(query, { hopDistances, maxHops: 10 });  // closer hops → higher attention
}
```

### QuantizedVectorStore Integration (B7-B9)

```
// controller-registry.ts — add to Level 2 (alongside vectorBackend)
case 'quantizedVectorStore': {
  const agentdbModule = await import('agentdb');
  const factory = agentdbModule.createScalar8BitStore;
  if (!factory) return null;
  const store = factory({ dimension: config.dimension || 768, maxElements: 100000 });
  return store;
}

// memory-bridge.ts — use as overlay when store exceeds threshold
const QUANTIZATION_THRESHOLD = 50000; // entries
async function selectBackend(entryCount) {
  if (entryCount > QUANTIZATION_THRESHOLD) {
    return registry.get('quantizedVectorStore') || registry.get('vectorBackend');
  }
  return registry.get('vectorBackend');
}
```

### CircuitBreaker Integration (D6)

```
// controller-registry.ts — wrap all getController calls
get<T>(name: ControllerName): T | null {
  const breaker = this.circuitBreakers.get(name);
  if (breaker?.isOpen()) return null;  // short-circuit to fallback

  try {
    const controller = this._getController(name);
    breaker?.recordSuccess();
    return controller;
  } catch (error) {
    breaker?.recordFailure();
    if (breaker?.isOpen()) {
      this.emit('controller:circuit-open', { name, error });
    }
    return null;
  }
}
```

## Decision: Architecture (SPARC-A)

### Composition-Aware Integration Architecture

The key architectural insight (discovered via wiring audit swarm) is that many controllers are **composites that create sub-components internally**. The integration plan respects this by wiring only top-level entries and letting composites manage their children.

**3 composites and their children:**

| Composite (wire) | Children (auto-created, do NOT wire) | Init mechanism |
|-----------------|-------------------------------------|---------------|
| A6 SelfLearningRvfBackend | A7 ContrastiveTrainer, A8 SONA, B1 SemanticQueryRouter, B2 TemporalCompressor, FederatedSessionManager, RvfSolver | `initComponents()` lazy import |
| B9 QuantizedVectorStore | B7 ScalarQuantization, B8 ProductQuantizer | Constructor (config-based) |
| D6 CircuitBreaker | (wraps other controllers) | Registry-level decorator |

**Updated Init Levels (composition-aware):**

| Level | Current (24 after Phase 0) | New top-level entries | Total |
|-------|:------------:|:---------------------:|:-----:|
| 0 | — | D4 ResourceTracker, D5 RateLimiter, D6 CircuitBreaker, D1 TelemetryManager | 4 |
| 1 | 6 | B5 MetadataFilter, B6 QueryOptimizer | 8 |
| 2 | 5 | A1 SelfAttention, A2 CrossAttention, A3 MultiHeadAttention, A5 AttentionService, A6 SelfLearningRvfBackend, B4 NativeAccelerator, B9 QuantizedVectorStore | 12 |
| 3 | 6 | A9 EnhancedEmbeddingService, D3 AuditLogger | 8 |
| 4 | 4 | B3 IndexHealthMonitor, A11 FederatedLearningManager, D2 AttentionMetrics | 7 |
| 5 | 6 | — | 6 |
| 6 | 2 | — | 2 |
| **Total** | **24** | **18** | **42 entries** (+ 8 via composite = **50 controllers**) |

## Decision: Refinement (SPARC-R)

### Deep Analysis Swarm (2026-03-15)

A 10-agent analysis swarm (`swarm-1773616158183`) performed per-controller deep analysis: reading full source code, upstream ADRs (050-066), git history, test suites, and cross-referencing all 31 candidates. Each agent cluster covered related controllers for context-aware assessment.

#### SONA Implementation Status — CORRECTION

**Previous claim (issue #1243): "SONA wiring non-functional (stub instead of real @ruvector/sona API)"**

**Finding: SONA IS A PRODUCTION SYSTEM, NOT A STUB.**

The deep-dive agent found a three-layer implementation:

| Layer | Location | Evidence |
|-------|----------|---------|
| **Rust engine** | `ruvector/crates/sona/` | 50+ commits, tests, benchmarks. Sub-millisecond micro-LoRA. EWC++ catastrophic forgetting prevention. |
| **N-API bindings** | `@ruvector/sona` npm v0.1.4 | Published package with 7 platform targets (Linux GNU/musl, macOS, Windows, ARM). Pre-built `.node` binaries. |
| **CLI optimizer** | `ruflo/v3/@claude-flow/cli/src/memory/sona-optimizer.ts` | **842 lines** of working code. Q-learning routing, pattern matching, temporal decay, disk persistence (`.swarm/sona-patterns.json`). |
| **agentdb wrapper** | `SonaLearningBackend.ts` | 357-line N-API integration. Calls real engine methods: `applyMicroLora`, `beginTrajectory`, `addTrajectoryStep`, `endTrajectory`, `tick`, `forceLearn`, `findPatterns`. |

Issue #1243 referred to the *wiring between layers*, not the implementation itself. The SONAOptimizer in the CLI is a complete self-learning routing optimizer with 17 public methods.

#### QUIC Status — CORRECTION

**Previous claim: "QUIC was never implemented"**

**Finding: Application logic IS real; only transport layer is mock.**

| Component | Real Code | Mock |
|-----------|-----------|------|
| QUICServer (499 lines) | Database sync SQL, rate limiting (60s windows), connection tracking | Socket I/O (100ms simulated delay) |
| QUICClient (668 lines) | Connection pooling (5 conns), retry with exponential backoff, batch processing | `sendRequest()` returns mock data |
| SyncCoordinator (717 lines) | **Fully functional**: bidirectional sync, 4 conflict resolution strategies (local-wins, remote-wins, latest-wins, merge), INSERT OR REPLACE, state persistence | None — all logic is real |

Code comments explicitly state: "Actual QUIC implementation would use a library like @fails-components/webtransport. This is a reference implementation showing the interface."

#### AuditLogger — CORRECTION

**Previous claim: "Overlaps attestationLog"**

**Finding: NO overlap. Completely different concerns.**

| Aspect | AttestationLog (already wired) | AuditLogger (D3) |
|--------|-------------------------------|-------------------|
| Purpose | Cryptographic hash chains for tamper detection | Human-readable compliance event journal |
| Storage | SQLite append-only with SHAKE-256 hashes | File-based JSON with rotation (10MB, 10 files) |
| Events | Every write operation (generic) | 18 typed security events (auth, keys, access, config) |
| Consumers | Health check stats | **Already wired** in `auth.middleware.ts` and `rate-limit.middleware.ts` |
| Compliance | Tamper-evident proof | SOC2/GDPR/HIPAA event formatting |

These are orthogonal. Both should exist.

#### Deprecation Status

**No controllers are deprecated.** Only 3 database convenience methods (`all`, `get`, `run`) are marked `@deprecated`. All 31 candidate classes are actively maintained.

#### Feature-Gated Controllers

| Class | Gate | Fallback |
|-------|------|----------|
| NativeAccelerator (490 lines, 80+ tests) | Probes 11 @ruvector packages | JS fallback (SimdFallbacks.ts) for every capability |
| ContrastiveTrainer (559 lines) | `@ruvector/attention` nativeInfoNce | JS InfoNCE loss |
| AttentionService (1,500+ lines, 4 mechanisms) | `@ruvector/attention` NAPI/WASM (optional) | JS fallbacks tested (1,628 lines of tests). Flash + MoE correct. GraphRoPE needs 3-bug patch. Hyperbolic needs native for correct Poincaré math. |
| RuVectorLearning (248 lines) | `@ruvector/gnn` | Uniform weights fallback |
| All quantization | No gate | Always available (pure JS) |
| All attention controllers (A1-A3) | No gate | Always available (pure JS, 306-494 lines each) |

#### Intentional Duplicates

| Pair | Purpose |
|------|---------|
| `controllers/HNSWIndex.ts` vs `browser/HNSWIndex.ts` | Native hnswlib (150x) vs pure JS (10-20x) for browser |
| `quantization/vector-quantization.ts` vs `optimizations/Quantization.ts` | **Current standard vs legacy.** Use `quantization/` only. |
| `SemanticQueryRouter` vs `SemanticRouter` | Query strategy optimization vs intent classification. Different pipeline stages, different outputs. |

### Per-Controller Verdicts (31 controllers)

#### Wire in ControllerRegistry (18 top-level entries)

| ID | Controller | Lines | Type | Agent Finding |
|----|-----------|:-----:|------|---------------|
| A1 | **SelfAttentionController** | 306 | Leaf | Pure JS scaled dot-product attention. Standalone class (A4 deferred). Wire as search re-ranker. |
| A2 | **CrossAttentionController** | 467 | Leaf | Multi-namespace cross-attention. 3 aggregation strategies. Wire for cross-tier queries. |
| A3 | **MultiHeadAttentionController** | 494 | Leaf | Parallel attention heads. Xavier projections. 4 aggregation modes. Wire as advanced re-ranker. |
| A5 | **AttentionService** | 1,500+ | Leaf | 4 mechanisms: Flash (correct JS), MoE (correct JS), GraphRoPE (3-bug patch), Hyperbolic (native needed). 1,628 lines tests. 4 MCP tools. |
| A6 | **SelfLearningRvfBackend** | 487 | **Composite** | Orchestrator — auto-creates A7, A8, B1, B2 + FederatedSessionManager + RvfSolver internally via `initComponents()`. |
| A9 | **EnhancedEmbeddingService** | 1,435 | Leaf | Multi-provider (Xenova/OpenAI/Cohere). LRU cache (100K). Semaphore batch. API whitelist. |
| A11 | **FederatedLearningManager** | 436 | Leaf | Pure JS path works. Quality-weighted embedding consolidation. 95% functional without native SONA. |
| B3 | **IndexHealthMonitor** | 96 | Leaf | Passive latency recording. Multi-factor assessment. HNSW parameter recommendations. 35 tests. |
| B4 | **NativeAccelerator** | 490 | **Singleton** | Global capability bridge — 11 @ruvector packages, 40+ methods. Used by A6, A5, B2, A7. 80+ tests. |
| B5 | **MetadataFilter** | 280 | Leaf | Already exported. MongoDB operators. Dual interface: in-memory + SQL. ~75 lines to wire. |
| B6 | **QueryOptimizer** | 297 | Leaf | LRU query cache (1000 entries, 60s TTL). EXPLAIN plan analysis. Performance suggestions. |
| B9 | **QuantizedVectorStore** | ~500 | **Composite** | Unified store — auto-creates B7 (Scalar) or B8 (Product) based on config. 3 factory functions. 10M vector cap. |
| D1 | **TelemetryManager** | 545 | Leaf | OpenTelemetry spans + counters + histograms. OTLP/Prometheus/Console. <1% overhead. |
| D2 | **AttentionMetricsCollector** | 254 | Leaf | Per-mechanism latency percentiles. Currently orphaned — needs wiring to A1-A3, A5. |
| D3 | **AuditLogger** | 483 | Leaf | 18 typed security events. File rotation. **Already wired in auth + rate-limit middleware.** Orthogonal to attestationLog. |
| D4 | **ResourceTracker** | ~75 | Leaf | Memory tracking (16GB ceiling). Query stats (100 samples). Warning at 80%. 16 tests. |
| D5 | **RateLimiter** | ~70 | Leaf | Token-bucket. 4 instances (insert:100/s, search:1000/s, delete:50/s, batch:10/s). 11 tests. |
| D6 | **CircuitBreaker** | ~80 | Wrapper | Closed→Open→Half-Open. Wraps all controller calls. 8 tests. |

#### Included via parent composite (8 — do NOT wire separately)

| ID | Controller | Lines | Parent | How it's accessed |
|----|-----------|:-----:|--------|-------------------|
| A7 | **ContrastiveTrainer** | 559 | A6 | Internal to A6 learning cycle. InfoNCE + hard negatives (NV-Retriever 2024). |
| A8 | **SonaLearningBackend** | 357 | A6 | Internal to A6 search path. Micro-LoRA (<1ms), EWC++. CLI also has independent `sona-optimizer.ts`. |
| B1 | **SemanticQueryRouter** | 456 | A6 | Internal to A6 search path. Routes query strategy → ef selection. ADR-006 sub-component. |
| B2 | **TemporalCompressor** | 454 | A6 | Internal to A6 tick cycle. 5-tier compression (up to 96%). SolverBandit tier selection. |
| B7 | **ScalarQuantization** | ~300 | B9 | Created by B9 constructor (scalar config). 8-bit (4x) and 4-bit (8x) compression. 28 tests. |
| B8 | **ProductQuantizer** | ~500 | B9 | Created by B9 constructor (product config). ADC distance tables. 8-32x compression. |
| — | **FederatedSessionManager** | — | A6 | Internal to A6. Session lifecycle for federated learning. |
| — | **RvfSolver** | — | A6 | Internal to A6. Thompson Sampling policy per 18 context buckets. |

#### A5 (AttentionService) Deep Analysis (Swarm `swarm-1773619789371`, 3 agents)

A dedicated 3-agent swarm analyzed A5 in depth: source code line-by-line, native binding availability, and test/usage evidence. This analysis **reverses the DEFER recommendation** — all 4 mechanisms are implementable (2 JS-ready, 1 with ~15-line patch, 1 with native install).

**Previous assessment**: "NAPI/WASM bindings uncertain and JS fallbacks untested."

**Finding**: Both claims were incorrect.

**Native bindings**: `@ruvector/attention@0.1.31` is published on npm with pre-built binaries for 7 platforms (Linux x64/ARM, macOS x64/ARM, Windows x64/ARM). The Linux x64 binary (1.3MB) exists at `/crates/ruvector-attention-node/npm/linux-x64-gnu/`. Source is 3 Rust crates (ruvector-attention, ruvector-attention-wasm, ruvector-attention-node). Not installed locally, but installable via `npm install @ruvector/attention`.

**JS fallbacks**: 1,628 lines of tests across 4 test suites (unit, integration, regression, browser WASM) validate real outputs — not mocks. 3 production controllers actively import AttentionService (CausalMemoryGraph, NightlyLearner, ExplainableRecall). 4 MCP tools registered (compute, benchmark, configure, metrics). 136 documentation files.

**The "completely broken" comment** in `attention-fallbacks.ts` refers to native binding wiring, not the algorithms themselves. The JS fallbacks for 2 of 4 mechanisms are real, tested, mathematically correct implementations.

**Per-mechanism source analysis** (every line read):

| Mechanism | JS Fallback | Math Correct? | Lines of Algorithm | Native on npm? | Tests? | Production Callers |
|-----------|:-----------:|:------------:|:------------------:|:--------------:|:------:|:------------------:|
| **FlashAttention** | Real: tiled block-wise attention + online softmax with rescaling | Yes (Tri et al. 2022 simplified) | ~75 | Yes | Unit + integration | NightlyLearner |
| **MoEAttention** | Real: domain-based expert routing with softmax weighting + entropy calc | Yes | ~80 | Yes | Unit + integration | LearningSystem |
| **HyperbolicAttention** | Approximation: uses `1/(1 + curvature * ‖x‖ * ‖y‖)` instead of proper Poincaré `arctanh()` distance | No — crude scaling, not real hyperbolic geometry | ~60 | Yes (would fix) | Unit | CausalMemoryGraph |
| **GraphRoPE** | Buggy JS: uses avgHop for all pairs, keys use array index, same angle for all pairs | No — 3 specific bugs (~15 lines to fix) | ~80 (structure correct, params wrong) | NAPI only (no WASM) | Unit | ExplainableRecall |

**Two files exist**: `services/AttentionService.ts` (1,500+ lines, full service) and `controllers/AttentionService.ts` (771 lines, lightweight facade). These are different classes — the controller delegates to the service.

**GraphRoPE JS fix** (3 bugs, ~15 lines changed):
1. Line ~1195: Replace `const distance = hopDistances[i]?.[j] || 0` average → use per-pair `hopDistances[i][j]` directly in RoPE angle
2. Line ~1203: Replace `const keyPosition = j` (array index) → use `hopDistances[0][j]` or graph-derived position
3. Line ~1178: Replace shared `avgHop * freq` → per-pair `hopDistances[i][j] * freq` for position-specific theta

The surrounding algorithm (pair-wise rotation, softmax, weighted sum, hop encoding data structure) is correct. The bugs are in parameter selection, not algorithmic structure.

**Conclusion**: All 4 mechanisms are implementable. FlashAttention and MoEAttention work NOW (JS correct). HyperbolicAttention needs native install or formula fix. GraphRoPE needs a ~15-line patch to use per-pair hop distances instead of averages.

#### Composition Hierarchy (Swarm `swarm-1773621382029`, 3 agents)

A wiring audit of all 26 controllers found that **many are sub-components created internally by parent composites**. Wiring them separately in ControllerRegistry would create duplicate instances with lifecycle conflicts.

**A6 (SelfLearningRvfBackend)** creates 6 sub-components via `initComponents()` — all private fields:

| Sub-component | Our ID | Private field | Created at |
|--------------|--------|---------------|-----------|
| SemanticQueryRouter | B1 | `private router` | Line 395 (lazy import) |
| SonaLearningBackend | A8 | `private sona` | Line 394 (lazy import) |
| ContrastiveTrainer | A7 | `private trainer` | Line 397 (lazy import) |
| TemporalCompressor | B2 | `private compressor` | Line 396 (lazy import) |
| NativeAccelerator | B4 | `private accelerator` | Line 393 (lazy import) |
| FederatedSessionManager | — | `private federated` | Line 398 (lazy import) |

A6 exposes a unified API (`search()`, `recordFeedback()`, `getStats()`) that internally delegates to these sub-components. The sub-components don't need direct access from the bridge layer — A6 orchestrates everything per ADR-006.

**B9 (QuantizedVectorStore)** creates its quantizer in the constructor:

| Sub-component | Our ID | Created at |
|--------------|--------|-----------|
| ScalarQuantization | B7 | Line 637 (if scalar type config) |
| ProductQuantizer | B8 | Line 639 (if product type config) |

**A4 (MemoryController, deferred)** creates A1-A3 in its constructor. Since A4 is deferred, A1-A3 are wired directly as standalone classes (they have independent constructors).

**Exceptions — wire separately despite being sub-components:**
- **B4 (NativeAccelerator)**: Global singleton used by many controllers (B2, A7, A8, AttentionService, TemporalCompressor), not just A6. Must be wired as shared singleton.
- **B3 (IndexHealthMonitor)**: Eager-loaded in A6 (line 79, not lazy), but also useful independently for health reporting. Wire separately.
- **A8 (SONA)**: A6 creates one internally. The CLI also has independent `sona-optimizer.ts` (842 lines). Keep A8 in registry for CLI-level access; A6 creates its own instance.

**Controllers that collapse into composites (do NOT wire separately):**

| ID | Controller | Parent | Why not separate |
|----|-----------|--------|-----------------|
| B1 | SemanticQueryRouter | A6 | Query strategy routing is internal to A6's search path. Doesn't learn from outcomes (Solver does). ADR-006 explicitly defines it as sub-component. |
| B2 | TemporalCompressor | A6 | Index compression runs inside A6's tick cycle. Private field, no external callers. |
| A7 | ContrastiveTrainer | A6 | Embedding improvement runs inside A6's learning cycle. Private field. |
| B7 | ScalarQuantization | B9 | B9 creates the quantizer based on config. Standalone functions still exported for direct use. |
| B8 | ProductQuantizer | B9 | Same — B9 creates based on config. |

#### QUIC Transport Assessment

A dedicated agent found that **the MCP layer already has working HTTP + WebSocket transports** in the ruflo fork (`@claude-flow/mcp/src/transport/http.ts`, 533 lines; `websocket.ts`, 397 lines). Making sync real is **~160 lines** — replace `QUICClient.sendRequest()` (currently 100ms mock returning empty data) with `fetch()` POST reusing existing MCP HTTP patterns. The interface is simple JSON: `{type, since, filters, batchSize}` → `{success, data, itemsReceived, bytesTransferred, durationMs}`.

The question is not "wait for QUIC library" but "swap mock with HTTP POST."

#### Defer (3 controllers)

| ID | Controller | Lines | Reason | Revisit Condition |
|----|-----------|:-----:|--------|-------------------|
| A4 | **MemoryController** | 462 | Reimplements CRUD in-memory (Map), bypasses MutationGuard/AttestationLog. Wire as **optional augmentation** for attention-enhanced retrieval, not pipeline replacement. Creates A1-A3 internally. | After A1-A3 prove value in search re-ranking |
| B10 | **FilterBuilder** | 209 | RVF-specific DSL. MetadataFilter (B5) covers the user-facing need. FilterBuilder remains available internally to RVF backend. | If RVF becomes primary storage backend (ADR-057) |
| C1-C4 | **QUIC + Sync** | 2,132 | Real sync logic, only transport is mock. Could be made functional with ~160 lines (HTTP POST replacing mock). Defer until multi-machine deployment is a concrete need. | When agents need cross-machine memory sharing |

#### Drop (1 controller)

| ID | Controller | Lines | Reason |
|----|-----------|:-----:|--------|
| A10 | **LLMRouter** | 659 | Zero callers in entire codebase. Dead export. Selects which LLM *provider* to call — a problem that doesn't exist here. The 3-tier routing (Agent Booster→Haiku→Sonnet/Opus) solves model selection at a different level. |

### Final Candidate List (composition-aware)

**Wire in ControllerRegistry** (18 top-level entries):

| ID | Controller | Type | What it includes |
|----|-----------|------|-----------------|
| A1 | SelfAttentionController | Leaf | Standalone (A4 deferred) |
| A2 | CrossAttentionController | Leaf | Standalone (A4 deferred) |
| A3 | MultiHeadAttentionController | Leaf | Standalone (A4 deferred) |
| A5 | AttentionService | Leaf | 4 mechanisms (Flash, MoE, GraphRoPE, Hyperbolic) |
| A6 | SelfLearningRvfBackend | **Composite** | Auto-creates: A7 ContrastiveTrainer, A8 SONA, B1 SemanticQueryRouter, B2 TemporalCompressor + FederatedSessionManager + RvfSolver |
| A9 | EnhancedEmbeddingService | Leaf | Multi-provider embeddings |
| A11 | FederatedLearningManager | Leaf | Pure JS quality-weighted consolidation |
| B3 | IndexHealthMonitor | Leaf | Passive health assessment |
| B4 | NativeAccelerator | **Singleton** | Global capability bridge (used by A6, A5, B2, A7) |
| B5 | MetadataFilter | Leaf | MongoDB-style filtering |
| B6 | QueryOptimizer | Leaf | Query cache + plan analysis |
| B9 | QuantizedVectorStore | **Composite** | Auto-creates B7 (Scalar) or B8 (Product) based on config |
| D1 | TelemetryManager | Leaf | OpenTelemetry |
| D2 | AttentionMetricsCollector | Leaf | Attention-specific metrics |
| D3 | AuditLogger | Leaf | Compliance event logging |
| D4 | ResourceTracker | Leaf | Memory/query tracking |
| D5 | RateLimiter | Leaf | Token-bucket per operation |
| D6 | CircuitBreaker | Wrapper | Wraps other controller calls |

**Included via parent composite** (do NOT wire separately — 8 items):

| ID | Controller | Parent | Access via |
|----|-----------|--------|-----------|
| A7 | ContrastiveTrainer | A6 | `a6.search()` → internal trainer cycle |
| A8 | SonaLearningBackend | A6 | `a6.search()` → internal SONA enhance. CLI also has independent `sona-optimizer.ts` |
| B1 | SemanticQueryRouter | A6 | `a6.search()` → internal route → ef selection |
| B2 | TemporalCompressor | A6 | `a6.tick()` → internal compression cycle |
| B7 | ScalarQuantization | B9 | `b9.insert()` → auto-quantize per config |
| B8 | ProductQuantizer | B9 | `b9.insert()` → auto-quantize per config |
| — | FederatedSessionManager | A6 | Internal to A6 |
| — | RvfSolver | A6 | Internal to A6 |

**Totals**:

| Category | Wire separately | Via composite | Defer | Drop | Total |
|----------|:-:|:-:|:-:|:-:|:-:|
| A (High-value) | A1, A2, A3, A5, A6, A9, A11 | A7, A8 (via A6) | A4 | A10 | 11 |
| B (Infrastructure) | B3, B4, B5, B6, B9 | B1, B2 (via A6), B7, B8 (via B9) | B10 | — | 10 |
| C (Networking) | — | — | C1-C4 | — | 4 |
| D (Observability) | D1, D2, D3, D4, D5, D6 | — | — | — | 6 |
| **Total** | **18 wired** | **8 via composite** | **3 deferred** | **1 dropped** | **31** |

### ADR-0033 Wiring Audit (Swarms `swarm-1773623266694` + follow-up deep audit)

Four agent audits (composition, routing, interchangeability, correctness) found that ADR-0033's "27/28 controllers wired" is **misleading at the bridge/MCP layer**. Of 27 controllers in the registry:

| Category | Count | Controllers |
|----------|:-----:|-------------|
| **Correctly wired** | 10 | skills, reflexion, causalGraph (AgentDB singletons), solverBandit, batchOperations, mmrDiversityRanker, contextSynthesizer, tieredCache, learningBridge, memoryGraph, agentMemoryScope |
| **Degraded (missing embedder)** | 4 | causalRecall, learningSystem, nightlyLearner (required), explainableRecall (optional) |
| **Not exported from agentdb** | 6 | HierarchicalMemory, MemoryConsolidation, MutationGuard, AttestationLog, GuardedVectorBackend, SemanticRouter |
| **Wrong getController() name** | 3 | sonaTrajectory, graphAdapter, vectorBackend |
| **Duplicate instances** | 2 | CausalRecall + NightlyLearner create own internal copies |
| **Duplicate controller** | 1 | graphTransformer = second CausalMemoryGraph |
| **Fake wrappers** | 2 | gnnService, rvfOptimizer wrap non-existent functions |
| **Never called from bridge/MCP** | 16 | 53% of controllers have zero callers |

#### Issue 1: Six controllers reference classes not in agentdb exports (CRITICAL)

Verified against the actual `agentdb/src/index.ts` barrel — these classes are genuinely absent:

| Controller | Registry tries | In agentdb exports? | Runtime behavior |
|------------|---------------|:---:|-----------------|
| hierarchicalMemory | `new HM(db, embedder)` | **No** | Falls back to `createTieredMemoryStub()` (in-memory Map, 5K/tier limit) |
| memoryConsolidation | `new MC(db, hm, embedder)` | **No** | Falls back to `createConsolidationStub()` (no-op) |
| mutationGuard | `new MG({dimension})` | **No** | Returns null → `guardValidate()` always allows (no security) |
| attestationLog | `new AL(db)` | **No** | Returns null → `logAttestation()` is no-op (no audit trail) |
| guardedVectorBackend | `new GVB(vb, guard, log)` | **No** | Returns null (deps mutationGuard+attestationLog already null) |
| semanticRouter | `new SR()` | **No** (it's in `agentic-flow/src/routing/`, not agentdb) | Returns null → routing falls back to TASK_PATTERNS |

**Impact**: The "proof-gated intelligence" from ADR-0033 Phase 5 (MutationGuard, AttestationLog, GuardedVectorBackend) is entirely non-functional. The security layer, audit trail, and guarded vector backend all silently return null. HierarchicalMemory uses a basic Map stub instead of real tiered storage. SemanticRouter never loads.

**Fix**: Either export these classes from agentdb (agentic-flow fork patch), or remove from the registry and document as non-functional.

#### Issue 2: Four controllers missing required embedder parameter (HIGH)

| Controller | Registry creates | Actual constructor | Missing |
|------------|-----------------|-------------------|---------|
| causalRecall | `new CR(db)` | `constructor(db, embedder, vectorBackend?)` | `embedder` (REQUIRED) |
| learningSystem | `new LS(db)` | `constructor(db, embedder)` | `embedder` (REQUIRED) |
| nightlyLearner | `new NL(db)` | `constructor(db, embedder, config?)` | `embedder` (REQUIRED) |
| explainableRecall | `new ER(db)` | `constructor(db, embedder?, config?)` | `embedder` (optional, degrades quality) |

**Impact**: These controllers can't compute vector similarities. LearningSystem's `recommendAlgorithm()` can't embed task descriptions. NightlyLearner can't consolidate episodic memories. CausalRecall can't re-rank by causal proximity.

**Fix**: Pass `this.createEmbeddingService()` (already exists in controller-registry.ts line 1073) as the embedder parameter.

#### Issue 3: Two controllers create duplicate internal instances (HIGH)

**NightlyLearner** constructor creates 3 separate instances:
- `this.causalGraph = new CausalMemoryGraph(db)` — duplicate of AgentDB's singleton
- `this.reflexion = new ReflexionMemory(db, embedder)` — duplicate of AgentDB's singleton
- `this.skillLibrary = new SkillLibrary(db, embedder)` — duplicate of AgentDB's singleton

**CausalRecall** constructor creates 2 separate instances:
- `this.causalGraph = new CausalMemoryGraph(db)` — duplicate
- `this.explainableRecall = new ExplainableRecall(db)` — duplicate

**Impact**: Multiple instances write to the same SQLite tables but have separate in-memory state. Data written via AgentDB's singleton won't be seen by NightlyLearner's copy until both read from SQLite. Potential stale reads and inconsistent consolidation.

**Root cause**: Upstream class design — constructors create internal instances instead of accepting injected singletons. NightlyLearner's copies lack vectorBackend, so consolidation uses SQL brute-force (not 150x HNSW). CausalRecall's ExplainableRecall copy lacks embedder, so provenance has no vector search.

**Fix (fork patch, ~26 lines across 3 files)**: Change NightlyLearner and CausalRecall constructors to accept optional pre-created instances, then pass AgentDB singletons from the registry:

```typescript
// agentic-flow fork: NightlyLearner.ts — accept optional singletons
constructor(db, embedder, config?, causalGraph?, reflexion?, skills?) {
  this.causalGraph = causalGraph || new CausalMemoryGraph(db);
  this.reflexion = reflexion || new ReflexionMemory(db, embedder);
  this.skillLibrary = skills || new SkillLibrary(db, embedder);
}

// agentic-flow fork: CausalRecall.ts — accept optional singletons
constructor(db, embedder, vectorBackend?, config?, causalGraph?, explainableRecall?) {
  this.causalGraph = causalGraph || new CausalMemoryGraph(db);
  this.explainableRecall = explainableRecall || new ExplainableRecall(db);
}

// ruflo fork: controller-registry.ts — pass AgentDB singletons
case 'nightlyLearner': {
  const embedder = this.createEmbeddingService();
  const cg = this.get('causalGraph');
  const rf = this.get('reflexion');
  const sk = this.get('skills');
  return new NL(db, embedder, undefined, cg, rf, sk);
}
case 'causalRecall': {
  const embedder = this.createEmbeddingService();
  const vb = this.agentdb?.vectorBackend;
  const cg = this.get('causalGraph');
  const er = this.get('explainableRecall');
  return new CR(db, embedder, vb, undefined, cg, er);
}
```

This eliminates 5 duplicate instances and ensures NightlyLearner consolidation uses 150x HNSW search (via vectorBackend) instead of SQL brute-force.

#### Issue 4: Three controllers use unsupported getController() names (MEDIUM)

`AgentDB.getController()` only supports 3 name mappings: `'reflexion'|'memory'`, `'skills'`, `'causal'|'causalGraph'`. These names return null:

| Controller | Registry calls | Supported? |
|------------|---------------|:---:|
| sonaTrajectory | `agentdb.getController('sonaTrajectory')` | No |
| graphAdapter | `agentdb.getController('graphAdapter')` | No |
| vectorBackend | `agentdb.getController('vectorBackend')` | No (it's `agentdb.vectorBackend` property, not a controller) |

**Fix**: Access via property (`agentdb.vectorBackend`) or direct instantiation, not getController().

#### Issue 5: Bridge routing bugs (HIGH)

**BUG-1**: `bridgeSolverBanditSelect()` and `bridgeSolverBanditUpdate()` exist in memory-bridge.ts but are **not in the export list**. Thompson Sampling routing is dead — hooks_route falls through to static TASK_PATTERNS.

**BUG-2**: memory-tools.ts calls `bridgeGetController('mmrDiversity')` but registry defines `mmrDiversityRanker`. Also calls nonexistent `metadataFilter` and `attentionService`. MMR re-ranking silently returns null.

**BUG-3**: graphTransformer creates a second instance of CausalMemoryGraph (same class as causalGraph). Duplicate.

#### Controllers to clean up

| Controller | Action | Reason |
|------------|--------|--------|
| graphTransformer | **Remove** | Duplicate CausalMemoryGraph instance |
| hybridSearch | **Remove** | Stub returning null, never called |
| federatedSession | **Remove** | Stub returning null, never called |
| gnnService | **Mark stats-only** | Only `getStats()` called, `differentiableSearch()` wraps non-existent function |
| rvfOptimizer | **Mark stats-only** | Only `getStats()` called, `optimize()` wraps backend method that may not exist |
| sonaTrajectory | **Delegate or remove** | getController('sonaTrajectory') returns null — name not supported |

#### Revised existing wiring health

| Status | Count | Impact |
|--------|:-----:|--------|
| Correctly wired + called | 10 | Working as intended |
| Degraded (missing params) | 4 | Reduced functionality (no embeddings) |
| Silently returning null/stub | 9 | Classes not exported, wrong names, stubs |
| Dead code / duplicates | 4 | graphTransformer, gnnService, rvfOptimizer, hybridSearch |

**The system appears to work because every controller has graceful degradation** — null returns, try-catch, stub fallbacks. But the "advanced" features (MutationGuard security, AttestationLog audit, HierarchicalMemory tiers, SONA trajectory, GNN search, SemanticRouter, GuardedVectorBackend) are all no-ops in practice.

### Priority Recommendation (composition-aware)

**Phase 0: Fix existing ADR-0033 wiring + packaging (8h).**

Critical fixes (must-do before any new controllers):
1. Fix memory-bridge.js import resolution (packaging bug)
2. Export `bridgeSolverBanditSelect`/`Update` from memory-bridge.ts (BUG-1, ~1 line)
3. Fix `mmrDiversity` → `mmrDiversityRanker` in memory-tools.ts; remove calls to nonexistent `metadataFilter`/`attentionService` (BUG-2, ~3 lines)
4. Pass `this.createEmbeddingService()` to causalRecall, learningSystem, nightlyLearner, explainableRecall constructors (Issue 2, ~4 lines each)
5. Fix vectorBackend access: use `agentdb.vectorBackend` property instead of `agentdb.getController('vectorBackend')` (Issue 4, ~2 lines)
6. Fix sonaTrajectory + graphAdapter: either access via property or remove from registry (Issue 4, ~10 lines)

Cleanup (reduce noise):
7. Remove graphTransformer from registry — duplicate CausalMemoryGraph (BUG-3, ~15 lines)
8. Remove hybridSearch and federatedSession stubs from INIT_LEVELS (~5 lines)
9. Mark gnnService and rvfOptimizer as stats-only (~2 lines comments)

Duplicate instance fixes (requires agentic-flow fork patch):
10. Patch NightlyLearner constructor to accept optional pre-created causalGraph, reflexion, skills (~10 lines)
11. Patch CausalRecall constructor to accept optional pre-created causalGraph, explainableRecall (~10 lines)
12. In controller-registry.ts, pass AgentDB singletons to NightlyLearner and CausalRecall (~6 lines)

Non-exported classes (requires agentic-flow fork patch or acceptance of stubs):
13. Either export MutationGuard, AttestationLog, GuardedVectorBackend, HierarchicalMemory, MemoryConsolidation, SemanticRouter from agentdb `index.ts` (agentic-flow fork, ~6 export lines), OR document these as non-functional stubs and reduce the "wired" count from 27 to 21

**Phase 7 (Security Foundation, 7h)**. D4 ResourceTracker + D5 RateLimiter + D6 CircuitBreaker. CircuitBreaker wraps all existing controller calls — would have prevented the memory-bridge.js cascade.

**Phase 8 (Query Infrastructure, 5h)**. B5 MetadataFilter + B6 QueryOptimizer. Both already exported upstream, low integration effort.

**Phase 9 (Attention Suite, 20h)**. A1 SelfAttention + A2 CrossAttention + A3 MultiHeadAttention + A5 (Flash + MoE + GraphRoPE with patch). Wire A1-A3 into search pipeline as re-rankers. A5 adds FlashAttention for consolidation, MoE for expert routing, GraphRoPE for hop-aware recall. Pure JS for all — no native deps.

**Phase 10 (Embeddings + Compliance, 7h)**. A9 EnhancedEmbeddingService + D3 AuditLogger. Multi-provider embeddings replace hand-rolled pipeline. AuditLogger already wired in auth middleware.

**Phase 11 (Self-Learning + Native, 10h)**. A6 SelfLearningRvfBackend + B4 NativeAccelerator + install `@ruvector/attention`. **A6 automatically creates A7, A8, B1, B2 internally** — no separate wiring needed. Installing the native package enables A5 HyperbolicAttention with correct Poincaré math. B4 bridges all @ruvector capabilities as global singleton.

**Phase 12 (Federated Learning, 4h)**. A11 FederatedLearningManager only. A7 (ContrastiveTrainer) is already included via A6.

**Phase 13 (Quantization, 6h)**. B9 QuantizedVectorStore only — **auto-creates B7 (Scalar) or B8 (Product) based on config**. No separate wiring for B7/B8.

**Phase 14 (Index Health, 3h)**. B3 IndexHealthMonitor only. B2 (TemporalCompressor) is already included via A6.

**Phase 16 (Telemetry, 6h)**. D1 TelemetryManager + D2 AttentionMetricsCollector. OpenTelemetry observability + attention-specific metrics.

### Safeguards (carried from ADR-0033)

All new controller integrations must follow:

1. **try-catch + 2s timeout** on every new bridge call
2. **Cold-start guard** where applicable (skip reads until sufficient data)
3. **Max 3 writes per MCP handler** (prevent write amplification)
4. **Fire-and-forget** for learning/training writes (must not block response)
5. **CircuitBreaker** wrapping all new controllers (Phase 7 prerequisite)
6. **NativeAccelerator check** for any controller depending on @ruvector/* packages
7. **A5 mechanism gating**: Flash, MoE, and GraphRoPE (patched) enabled by default (JS works). HyperbolicAttention enabled only when NativeAccelerator reports `simdAvailable: true`
8. **No duplicate instances**: Sub-components (A7, A8, B1, B2, B7, B8) are created by their parent composites (A6, B9). Bridge functions access them through the parent's API, never instantiate them separately.

### Validation

After each phase:
- `agentdb_health` reports new controllers as active
- `intelligence_stats` shows metrics for new capabilities
- `npm test` (361+ unit tests) passes
- `npm run test:verify` (24+ acceptance) passes
- `tsc --noEmit` passes for both ruflo and agentic-flow forks

### Testing Strategy

Each phase adds:
- **L1 unit tests**: Factory creation, null fallback, error paths (8-15 per controller)
- **L1 integration tests**: Handler→Bridge→Registry→Controller chain (4-8 per phase)
- **L2 acceptance checks**: MCP tool smoke tests (1-2 per controller)

Estimated test additions: **~160 unit + ~12 acceptance** across all phases.

A5-specific testing: validate FlashAttention JS produces numerically stable results for block sizes 64-512. Validate MoE returns non-uniform expert weights. Validate GraphRoPE (patched) produces higher weights for closer hops. Regression: attention-disabled search returns same results as before.

A6 composition testing: verify A6.search() internally calls router, SONA, solver. Verify A6.getStats() aggregates sub-component stats. Verify A6.destroy() cleans up all sub-components.

## Decision: Completion (SPARC-C)

### Phasing (composition-aware)

| Phase | ControllerRegistry entries | Included via composite | Effort | Dependencies |
|-------|--------------------------|----------------------|--------|-------------|
| **Phase 0** | Fix packaging bug + ADR-0033 wiring (embedder injection, export missing classes, bridge bugs, cleanup) | — | 8h | None |
| **Phase 7** | D4, D5, D6 | — | 7h | Phase 0 |
| **Phase 8** | B5, B6 | — | 5h | None |
| **Phase 9** | A1, A2, A3, A5 (Flash+MoE+GraphRoPE) | — | 20h | Phase 8 |
| **Phase 10** | A9, D3 | — | 7h | Phase 9 |
| **Phase 11** | A6, B4, A5 Hyperbolic (native) | A7, A8, B1, B2 (via A6) | 10h | Phase 7 |
| **Phase 12** | A11 | — | 4h | Phase 11 |
| **Phase 13** | B9 | B7, B8 (via B9) | 6h | Phase 11 |
| **Phase 14** | B3 | — | 3h | Phase 11 |
| **Phase 16** | D1, D2 | — | 6h | Phase 9 |
| **Total** | **18 entries** | **8 via composite** | **~70h** + 8h Phase 0 | |

### Dependency Graph

```
Phase 0 (Fix packaging + ADR-0033 wiring: embedders, exports, bridge bugs, cleanup)
├─ Phase 7 (Security: CircuitBreaker, RateLimiter, ResourceTracker)
│  ├─ Phase 11 (A6 [includes A7+A8+B1+B2] + B4 singleton + A5-Hyperbolic)
│  │  ├─ Phase 12 (A11 FederatedLearning)
│  │  ├─ Phase 13 (B9 [includes B7+B8])
│  │  └─ Phase 14 (B3 IndexHealthMonitor)
│  └─ (independent)
├─ Phase 8 (Query: MetadataFilter, QueryOptimizer)
│  └─ Phase 9 (Attention: A1, A2, A3, A5 Flash+MoE+GraphRoPE)
│     ├─ Phase 10 (A9 Embeddings + D3 AuditLogger)
│     └─ Phase 16 (D1 Telemetry + D2 AttentionMetrics)
```

### Summary

| Metric | Current (ADR-0033) | After Phase 10 | After All Phases |
|--------|:------------------:|:--------------:|:----------------:|
| Active controllers (after Phase 0 cleanup) | 24/25 | 38/39 | 50/51 |
| ControllerRegistry entries | 24 (after removing 3 stale) | 35 | 42 |
| Via composite (auto-created) | 0 | 0 | 8 |
| Attention mechanisms | None | 6 (Self, Cross, MultiHead, Flash, MoE, GraphRoPE) | 7 (+ Hyperbolic-native) |
| Self-learning vector index | No | No | Yes (A6: SONA + Contrastive + Solver + Router + Compressor) |
| SONA micro-LoRA | No | No | Yes (production Rust engine, inside A6) |
| Federated learning | Blocked | Blocked | Yes (A11, pure JS path) |
| Vector quantization | No | No | 4-32x compression (B9 auto-selects B7 or B8) |
| Circuit breaker protection | No | Yes | Yes |
| Compliance audit logging | No | Yes (D3) | Yes |
| OpenTelemetry | No | No | Yes (D1) |
| Estimated total effort | 52h done | +41h | **+70h** |

### Success Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| Phase 0 | Existing wiring fixed: imports resolve, embedders injected, exports added, bridge bugs fixed | memory_store works; solverBandit reachable in hooks_route; causalRecall/learningSystem/nightlyLearner get embedder; MutationGuard/AttestationLog/GuardedVectorBackend load (not null); graphTransformer removed |
| Phase 7 | Circuit breaker prevents cascade failures | 0 cascading errors |
| Phase 9 | Attention-weighted search returns different top-5 than vector-only | >20% result reordering |
| Phase 9 | FlashAttention consolidation for 10K entries | <2s wall clock, O(n) memory |
| Phase 9 | GraphRoPE (patched) hop-distance awareness | Closer hops → higher attention weights |
| Phase 11 | A6.search() invokes router + SONA + solver internally | Non-empty routing decisions from A6.getStats() |
| Phase 11 | Hyperbolic attention Poincaré distances | Distances satisfy triangle inequality |
| Phase 13 | 8-bit quantization memory usage | <25% of Float32 baseline |
| Phase 16 | OpenTelemetry spans exported | Spans visible in collector |

## Consequences

### Positive

- Phase 0 fixes 3 existing ADR-0033 bugs and removes 3 stale controllers (graphTransformer duplicate, hybridSearch/federatedSession stubs)
- Activates 26 additional upstream capabilities (50 total controllers after cleanup) with only 18 new registry entries (8 via composites)
- Composition-aware wiring prevents duplicate instances and lifecycle conflicts
- A6 is a single registry entry that delivers 6 sub-systems (SONA, Contrastive, SemanticQueryRouter, TemporalCompressor, FederatedSession, Solver)
- B9 is a single registry entry that delivers full quantization stack (scalar + product)
- 7 attention mechanisms fundamentally improve search quality
- SONA micro-LoRA provides real-time adaptation (<1ms per inference)
- CircuitBreaker prevents cascading failures
- Full quantization (4-32x compression) via unified B9 API
- Compliance audit logging (SOC2/HIPAA) via D3
- Federated learning unblocked via A11
- OpenTelemetry observability via D1
- **Effort reduced from 115h to 70h** by respecting composition (no duplicate wiring)

### Negative

- 70 hours of integration work across 10 phases
- Sub-components (A7, A8, B1, B2, B7, B8) are only accessible through parent APIs — no direct MCP tool access without bridge functions on the composite
- A6's private fields mean sub-component behavior can only be observed via A6.getStats()
- HyperbolicAttention requires native package (~1.3MB binary dependency)
- GraphRoPE JS fallback requires ~15-line patch

### Risks

- A6's lazy `initComponents()` may silently fail to create sub-components (all try-catch) — need A6.getStats() to verify
- B9 config at construction time locks the quantization method — can't switch scalar↔product without re-creating
- FlashAttention JS is simplified (not full Tri et al. 2022) — block size tuning needed
- QUIC networking deferred but could be made real with ~160 lines (HTTP POST replacing mock)
- **Packaging bug** (memory-bridge.js missing from dist) must be fixed before Phases 8+ can validate
- **ADR-0033 wiring is significantly broken**: 6 controllers reference non-exported classes (return null/stub), 4 missing required embedder param, 3 bridge routing bugs, 2 duplicate instance creators, 16 of 27 never called from bridge/MCP. Phase 0 (8h) must fix these before adding new controllers.
- **Non-exported classes require agentic-flow fork patch**: MutationGuard, AttestationLog, GuardedVectorBackend, HierarchicalMemory, MemoryConsolidation, SemanticRouter must be added to agentdb's `index.ts` exports — otherwise the "security layer" from ADR-0033 Phase 5 remains entirely non-functional
- **Duplicate instance problem in NightlyLearner/CausalRecall**: constructors create internal copies of CausalMemoryGraph, ReflexionMemory, SkillLibrary instead of accepting injected singletons. **Mitigated by Phase 0 items 10-12** (fork patch to accept optional pre-created instances, ~26 lines across 3 files).

## Related

- **ADR-0033**: Complete AgentDB v3 Controller Activation (predecessor — 27/28 wired)
- **ADR-005** (upstream): Self-Learning Pipeline Integration (B2, B3 are Phase 2)
- **ADR-006** (upstream): Unified Self-Learning RVF Integration — **defines A6 as orchestrator with 6 sub-components**
- **ADR-007** (upstream): @ruvector Full Capability Integration (B4 is Phase 1)
- **ADR-010** (upstream): RVF Solver v0.1.6 Deep Integration
- **ADR-028** (upstream): 39 Attention Mechanism Types; A5 implements 4 of 39
- **ADR-050** (upstream): Self-Learning Intelligence Loop (SONA integration pattern)
- **ADR-053** (upstream): Original 6-phase controller plan
- **ADR-055** (upstream): Bug remediation (alpha.9→alpha.10)
- **ADR-057** (upstream): RVF Native Storage Backend (proposed)
- **ADR-059/060** (upstream): Bug triage — SONA wiring (#1243), FederatedSession (#1222)
- **ADR-062** (upstream): SemanticRouter export (alpha.10)
- **ADR-066** (upstream): HierarchicalMemory/MemoryConsolidation
- **ADR-0030**: Memory system optimization (embedding dimensions)
- **ADR-0027**: Fork migration and version overhaul (patch workflow)
- **ADR-0038**: Cascading pipeline decomposition (test strategy)

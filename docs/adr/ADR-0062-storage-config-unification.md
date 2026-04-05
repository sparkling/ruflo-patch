# ADR-0062: Storage & Configuration Unification

- **Status**: Accepted
- **Date**: 2026-04-05
- **Deciders**: 8-agent analysis swarm + hive-mind review
- **Methodology**: Deep source audit across 4 forks (ruflo, agentic-flow, ruv-FANN, ruvector)

## Context

An 8-agent swarm audited all storage settings, embedding configuration, HNSW parameters, cache/TTL values, SQLite tuning, WASM/native config, and cross-component compatibility across the controller pipeline. The audit found **15 issues** including 3 critical, 3 high, 5 medium, and 4 low severity.

The root cause is that the ADR-0052 config-driven embedding framework (`getEmbeddingConfig()`, `deriveHNSWParams()`) was designed to be the single source of truth, but adoption is incomplete. The CLI layer (memory-bridge.ts), the controller-registry, and the library layer (HNSWIndex, RvfBackend) each have independent hardcoded defaults that disagree.

### Agent Roles

| Agent | Focus | Key Finding |
|-------|-------|-------------|
| S1 | Storage settings | 35+ hardcoded values; three-way dimension split (384/768/1536) |
| S2 | Embedding engine | `getEmbeddingConfig()` defaults to 768 (nomic); bridge hardcodes 384 (MiniLM) |
| S3 | HNSW/vector config | `deriveHNSWParams()` is dead code; HNSWIndex defaults to dim=1536 |
| S4 | Cache/TTL/limits | RateLimiter, CircuitBreaker, cache cleanup fully hardcoded; maxElements 10x mismatch |
| S5 | Cross-component compat | Dimension mismatch confirmed; createEmbeddingService() produces zero vectors |
| S6 | WASM/native | 2 undeclared optionalDependencies; all 11 loaders have safe fallbacks |
| S7 | SQLite/RVF | Missing busy_timeout; inconsistent pragma tuning between library and CLI |
| S8 | Learning pipeline | NightlyLearner/causalGraph Level 4 race; SelfLearningRvfBackend loses data on exit |

### Dimension Split (The Core Problem)

| Layer | Default Dim | Source | Reads `getEmbeddingConfig()`? |
|-------|:-----------:|--------|:-----------------------------:|
| `embedding-config.ts` (ADR-0052) | **768** | `nomic-embed-text-v1.5` model default | IS the config |
| `enhanced-embeddings.ts` | **384** | `all-MiniLM-L6-v2` model default | Partially (calls `getModelDimension()`) |
| `memory-bridge.ts` (CLI) | **384** | Hardcoded at line 92 | No |
| `controller-registry.ts` | **384** | `this.config.dimension \|\| 384` fallback | No |
| `HNSWIndex.ts` | **1536** | Legacy OpenAI ada-002 default | No |
| `RvfBackend.ts` | **1536** | Hardcoded `DEFAULT_DIMENSIONS` | No |
| `agentdb-adapter.ts` | **1536** | `DEFAULT_CONFIG.dimensions` | No |
| `database-provider.ts` | **1536** | Hardcoded in `createBackend()` | No |
| `SelfLearningRvfBackend` | **128** | Fallback `config.dimension ?? 128` | No |
| `learning-bridge.ts` | **768** | `createHashEmbedding()` hardcoded | No |
| `agentdb-cli.ts` | **1536** | Comment: "Default OpenAI ada-002" | No |
| `config-manager.ts` | **128** | Hardcoded default | No |

**In practice**: the bridge passes 384 to the registry, and AgentDB resolves 768 from `getEmbeddingConfig()`. Controllers created by the registry get 384-dim zero-vector stubs while AgentDB's own controllers use 768-dim real embeddings. Currently dormant but fragile.

## Decision

### Priority 0 — Must Fix (blocks correctness)

#### P0-1: Fix NightlyLearner / causalGraph Race Condition

`causalGraph` and `nightlyLearner` are both Level 4 in INIT_LEVELS. Level 4 controllers init in parallel via `Promise.allSettled()`. When `nightlyLearner` calls `this.get('causalGraph')`, causalGraph may not be ready yet, causing NightlyLearner to create a duplicate `CausalMemoryGraph(db)` — violating ADR-0040 (shared singletons).

**Fix**: Move `causalGraph` from Level 4 to Level 3.

```typescript
// BEFORE (Level 3 and 4):
{ level: 3, controllers: ['skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations', 'memoryConsolidation', 'enhancedEmbeddingService', 'auditLogger'] },
{ level: 4, controllers: ['causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter', 'selfLearningRvfBackend', 'federatedLearningManager'] },

// AFTER:
{ level: 3, controllers: ['skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations', 'memoryConsolidation', 'enhancedEmbeddingService', 'auditLogger', 'causalGraph'] },
{ level: 4, controllers: ['nightlyLearner', 'learningSystem', 'semanticRouter', 'selfLearningRvfBackend', 'federatedLearningManager'] },
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`, INIT_LEVELS array.

#### P0-2: Bridge Must Use Config-Driven Dimension

Replace hardcoded `dimension: 384` in memory-bridge.ts with the centralized config.

**Fix**: Import `getEmbeddingConfig` from agentdb and use its dimension.

```typescript
// BEFORE (memory-bridge.ts line 92):
dimension: 384,

// AFTER:
dimension: (() => {
  try {
    const { getEmbeddingConfig } = require('@claude-flow/memory');
    return getEmbeddingConfig().dimension;
  } catch {
    return 384;
  }
})(),
```

Also fix the RVF store dimension at line 160:

```typescript
// BEFORE:
dimensions: 384,

// AFTER — must match registry dimension:
dimensions: registryInstance?.config?.dimension || 384,
```

**Location**: `ruflo` fork, `v3/@claude-flow/cli/src/memory/memory-bridge.ts`.

### Priority 1 — Should Fix (degrades functionality)

#### P1-1: Registry Should Reuse AgentDB's Real Embedder

`createEmbeddingService()` produces zero-filled Float32Arrays. Controllers like HierarchicalMemory and MemoryConsolidation get useless embeddings while AgentDB has a real embedder.

**Fix**: After `initAgentDB()`, extract and cache the real embedding service.

```typescript
// In initialize(), after initAgentDB:
if (this.agentdb) {
  try {
    this.realEmbedder = this.agentdb.getEmbeddingService?.() || null;
  } catch { /* use stub */ }
}

// In createEmbeddingService():
if (this.realEmbedder) return this.realEmbedder;
// ... existing stub fallback
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

#### P1-2: Add `busy_timeout` to SQLite

Multi-process access (CLI + daemon, multiple MCP servers) fails with `SQLITE_BUSY` because there's no retry timeout.

**Fix**: Add `busy_timeout` to the PRAGMA whitelist in `input-validation.ts` and apply it in `AgentDB.initialize()`:

```typescript
this.db.pragma('busy_timeout = 5000');  // 5 second retry
```

**Location**: `agentic-flow` fork, `packages/agentdb/src/security/input-validation.ts` (whitelist) and `packages/agentdb/src/core/AgentDB.ts` (apply).

#### P1-3: Consistent SQLite Tuning

`AgentDB.initialize()` applies only WAL mode. CLI/MCP entrypoints add `synchronous=NORMAL` and `cache_size=-64000`. Library consumers get worse performance.

**Fix**: Move full pragma set into `AgentDB.initialize()`:

```typescript
this.db.pragma('journal_mode = WAL');
this.db.pragma('synchronous = NORMAL');
this.db.pragma('cache_size = -64000');
this.db.pragma('busy_timeout = 5000');
```

**Location**: `agentic-flow` fork, `packages/agentdb/src/core/AgentDB.ts`.

### Priority 2 — Should Fix (suboptimal)

#### P2-1: Wire `deriveHNSWParams()` Into HNSWIndex

The function exists, is exported, and computes dimension-appropriate M/efConstruction/efSearch — but nobody calls it.

**Fix**: In `HNSWIndex` constructor, replace hardcoded defaults with:

```typescript
const derived = deriveHNSWParams(config.dimensions);
const merged = { ...derived, ...config };
```

**Location**: `agentic-flow` fork, `packages/agentdb/src/controllers/HNSWIndex.ts`.

#### P2-2: Declare Missing optionalDependencies

`@ruvector/ruvllm` (SIMD + EWC) and `@ruvector/rvf-wasm` (verification + quantization + store) are dynamically imported but not in `package.json`. Clean installs may fail to resolve them.

**Fix**: Add to `packages/agentdb/package.json` optionalDependencies:

```json
"@ruvector/ruvllm": "*",
"@ruvector/rvf-wasm": "*"
```

**Location**: `agentic-flow` fork, `packages/agentdb/package.json`.

#### P2-3: Expose RateLimiter/CircuitBreaker Config

Currently `new RateLimiter(100, 1)` and `new CircuitBreaker(5, 60000)` are hardcoded with no config surface.

**Fix**: Add to `RuntimeConfig`:

```typescript
rateLimiter?: { maxRequests?: number; windowMs?: number };
circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number };
```

Then in `createController()`:

```typescript
case 'rateLimiter': {
  const cfg = this.config.rateLimiter || {};
  return new RL(cfg.maxRequests || 100, cfg.windowMs || 1000);
}
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

#### P2-4: Align maxElements Across Backends

HNSW defaults to 1,000,000 while RVF defaults to 100,000 (10x smaller).

**Fix**: Standardize to 100,000 (practical limit for single-node CLI) or make both configurable from the same source.

**Location**: `agentic-flow` fork, `packages/agentdb/src/controllers/HNSWIndex.ts` and `packages/agentdb/src/backends/rvf/RvfBackend.ts`.

### Priority 3 — Nice to Have

#### P3-1: SelfLearningRvfBackend Persistence

`storagePath: ':memory:'` loses all learned data. For daemon mode, derive from dbPath.

**Fix**:

```typescript
case 'selfLearningRvfBackend': {
  const dbPath = this.config.dbPath || ':memory:';
  const storagePath = dbPath === ':memory:' ? ':memory:' : dbPath.replace(/\.db$/, '-rvf.sqlite');
  return await SLRB.create({ dimension, storagePath, learning: true });
}
```

#### P3-2: FederatedLearningManager Dynamic Agent ID

`agentId: 'cli-default'` is static. Generate from session or config.

#### P3-3: Expose Attention/SolverBandit Config

`topK`, `numHeads`, `useFlash`, `useMoE`, `costWeight`, `explorationBonus` are all hardcoded. Add to `RuntimeConfig`.

#### P3-4: NightlyLearner Flash Consolidation

`ENABLE_FLASH_CONSOLIDATION` is always false even when AttentionService is available at Level 2.

### What's Compatible (No Action Needed)

| Check | Status |
|-------|--------|
| Import paths after codemod | Correct layering (bridge → memory → agentdb) |
| SQLite handle sharing | Single better-sqlite3 connection, synchronous, safe |
| RVF store separation | Bridge read-only on different file from SelfLearning |
| WASM/NAPI fallback chain | All 11 loaders have silent JS fallback |
| `@ruvector/*` scope | Untouched by codemod, no rename breakage |
| Cache defaults | Consistent 10K entries, 5min TTL across components |

### Complete Hardcoded Values Inventory

35+ hardcoded values catalogued by S1. Key ones:

| Location | Value | Controls |
|----------|-------|----------|
| `memory-bridge.ts:92` | 384 | Registry init dimension |
| `memory-bridge.ts:160` | 384 | RVF store dimension |
| `controller-registry.ts` (6 sites) | 384 | Fallback dimension for MG, GNN, Attention, SLRB, stub embedder |
| `HNSWIndex.ts:535` | 1536 | Default HNSW dimension |
| `RvfBackend.ts:51` | 1536 | Default RVF dimension |
| `learning-bridge.ts:425` | 768 | Hash embedding dimension |
| `SelfLearningRvfBackend.ts:110` | 128 | Fallback dimension |
| `controller-registry.ts:1154` | 100, 1 | RateLimiter tokens/refill |
| `controller-registry.ts:1163` | 5, 60000 | CircuitBreaker threshold/reset |
| `controller-registry.ts:1124` | ':memory:' | SLRB storage path |
| `controller-registry.ts:1135` | 'cli-default' | Federated agent ID |
| `cache-manager.ts:399` | 60000 | Cache cleanup interval |

## Consequences

### Positive

- Documents the full dimension split across the pipeline for the first time
- Identifies 3 critical bugs (race condition, dimension mismatch, data loss) before they hit production
- Provides a prioritized fix plan that can be executed incrementally
- `deriveHNSWParams()` adoption will automatically tune HNSW for the chosen embedding model
- `busy_timeout` prevents `SQLITE_BUSY` errors in multi-process scenarios

### Negative

- P0-2 (config-driven dimension) changes the default dimension from 384 to 768 if `embeddings.json` or `getEmbeddingConfig()` is wired in — existing databases with 384-dim vectors would become incompatible
- Migration path needed: detect existing database dimension before applying config

### Risks

- Changing dimension default in bridge is a **breaking change** for existing `.swarm/memory.db` files with 384-dim embeddings stored as BLOBs
- `getEmbeddingConfig()` loads `@xenova/transformers` lazily — adding it to the bridge init path may increase cold start
- Unifying HNSW params via `deriveHNSWParams()` changes M/efConstruction for existing indexes

### Migration Strategy

For P0-2 (dimension unification), the safe approach:

1. On first init, check if `.swarm/memory.db` exists with 384-dim data
2. If yes, continue using 384 (backward compat)
3. If new database, use `getEmbeddingConfig().dimension` (768 or configured)
4. Add `dimension` to a `.swarm/config.json` so the choice is sticky

## Related

- **ADR-0052**: Config-driven embedding framework (the intended single source of truth)
- **ADR-0040**: Shared singletons for NightlyLearner dependencies
- **ADR-0059**: RVF native storage backend
- **ADR-0061**: Controller integration completion (predecessor — wired 40 controllers)

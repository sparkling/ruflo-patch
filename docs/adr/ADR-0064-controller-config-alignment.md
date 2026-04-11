# ADR-0064: Controller Configuration Alignment

- **Status**: P0-P3 Implemented (2026-04-11). Residual: solverBandit factory still ignores config, || vs ?? in 6 initAgentDB lines.
- **Date**: 2026-04-05
- **Implemented**: 2026-04-11
- **Deciders**: Henrik Pettersen
- **Builds on**: ADR-0061 (controller integration), ADR-0062 (storage config unification), ADR-0063 (storage audit remediation)

## Context

Post-ADR-0063, the 45 controllers in `controller-registry.js` are wired and the
dimension defaults were moved from 1536 to 768 in most backends. However a deep
cross-file analysis of the shipped `controller-registry.js` (1209 lines), all
storage backends, `embedding-config.js`, `database-provider.js`, `config.json`,
and `embeddings.json` reveals a second tier of issues:

1. **The controller-registry never calls `getEmbeddingConfig()`**. It relies
   entirely on `this.config.dimension` being passed by the caller. If the caller
   omits it, 5 controllers silently fall back to 384 while all backends use 768.
2. **`embedding-constants.js` is dead code** — it exports `EMBEDDING_DIM` (resolved
   dynamically from agentdb) but no file in the memory package imports it.
3. **`config.json` contains 8 dead fields** that no code reads, including
   `cacheSize: 384` which appears to be a mistyped dimension value.
4. **Hardcoded constructor args** (numHeads, topK, thresholds, quantization type)
   are not configurable through `config.json`.
5. **`batchOperations`** reads a different embedder path than all other controllers.
6. **`numHeads` is inconsistent**: `multiHeadAttention` uses 4, `attentionService` uses 8.
7. **`maxElements` split**: controller-registry caps AgentDB at 100K, but HNSW
   index and SQLite backends default to 1M.

### What ADR-0063 Fixed vs What Remains

| Issue | ADR-0063 | Still Open |
|-------|----------|------------|
| Import path for `getEmbeddingConfig` in memory-bridge | C1 fixed | Registry itself still doesn't call it |
| `getEmbeddingService()` accessor | C2 fixed | `batchOperations` bypasses it |
| Dimension defaults 1536→768 in backends | C3 fixed | Registry fallback is still 384, not 768 |
| `enableHNSW` dead field | M5 removed from RuntimeConfig | Still present in `config.json` |
| `EMBEDDING_DIM` dead export | Not addressed | Dead code ships in package |
| `config.json` dead agentdb fields | Not addressed | 7 unread fields |
| Hardcoded constructor args | Not addressed | 10+ values not configurable |
| `numHeads` inconsistency | Not addressed | 4 vs 8 in related controllers |
| `maxElements` 100K vs 1M split | H2 partially fixed registry | Backends still default to 1M |

## Decision

### P0: Wire `getEmbeddingConfig()` into Controller Registry

The registry must resolve dimensions from the canonical source instead of
relying on the caller. This eliminates the 384/768 split at the root.

```typescript
// In ControllerRegistry.initialize(), after initAgentDB():
let embeddingDimension = 768; // safe fallback
try {
  const { getEmbeddingConfig } = await import('@sparkleideas/agentdb');
  embeddingDimension = getEmbeddingConfig().dimension;
} catch { /* agentdb not available — use fallback */ }

// Store resolved dimension for all controller factories:
this.resolvedDimension = config.dimension ?? embeddingDimension;
```

Then replace all 5 occurrences of `this.config.dimension || 384` with
`this.resolvedDimension`:

| Controller | Line | Current | After |
|-----------|------|---------|-------|
| `mutationGuard` | ~774 | `this.config.dimension \|\| 384` | `this.resolvedDimension` |
| `gnnService` | ~806 | `this.config.dimension \|\| 384` | `this.resolvedDimension` |
| `attentionService` | ~934 | `this.config.dimension \|\| 384` | `this.resolvedDimension` |
| `selfLearningRvfBackend` | ~1015 | `this.config.dimension \|\| 384` | `this.resolvedDimension` |
| `createEmbeddingService` stub | ~1149 | `this.config.dimension \|\| 384` | `this.resolvedDimension` |

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

### P0: Delete or Wire `EMBEDDING_DIM`

`embedding-constants.js` exports `EMBEDDING_DIM` but nothing imports it.
Two options:

- **Option A (preferred)**: Delete `embedding-constants.ts` entirely. The
  registry now resolves dimensions internally via P0 above.
- **Option B**: Have `createEmbeddingService()` import it as a fallback.

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/embedding-constants.ts`.

### P1: Clean Up `config.json`

Remove dead fields and fix the `cacheSize` value:

```jsonc
// REMOVE — never read by controller-registry or any backend:
"enableHNSW": true,            // ADR-0063 M5: always-on
"agentdb": {
  "vectorBackend": "rvf",      // database-provider selects RVF unconditionally
  "enableLearning": true,      // not read
  "learningPositiveThreshold": 0.7,  // not read
  "learningNegativeThreshold": 0.3,  // not read
  "learningBatchSize": 64,     // not read
  "learningTickInterval": 10000 // not read
}

// FIX — cacheSize 384 is almost certainly a mistyped dimension value:
"cacheSize": 384  →  "cacheSize": 10000
// (tieredCache defaults to maxSize: 10000; SQLite cache_size defaults to 10000)
```

**Location**: `.claude-flow/config.json`.

### P1: Add `controllers` Section to `config.json`

The registry already supports `config.controllers[name]` for per-controller
enable/disable, and reads per-controller config from `config.rateLimiter`,
`config.circuitBreaker`, etc. Expose all hardcoded values:

```jsonc
{
  "controllers": {
    "attentionService": {
      "numHeads": 8,
      "useFlash": true,
      "useMoE": false,
      "useHyperbolic": false
    },
    "multiHeadAttention": {
      "numHeads": 8       // aligned with attentionService (was 4)
    },
    "selfAttention": {
      "topK": 10
    },
    "rateLimiter": {
      "maxRequests": 100
    },
    "circuitBreaker": {
      "failureThreshold": 5,
      "resetTimeoutMs": 60000
    },
    "tieredCache": {
      "maxSize": 10000,
      "ttl": 300000
    },
    "quantizedVectorStore": {
      "type": "scalar-8bit"
    }
  }
}
```

**Location**: `.claude-flow/config.json` and `controller-registry.ts` factories.

### P2: Fix `batchOperations` Embedder Path

`batchOperations` reads `this.config.embeddingGenerator` directly while all
other embedding consumers use `this.createEmbeddingService()`. This means
`batchOperations` never gets the real embedder from AgentDB (ADR-0063 C2).

```typescript
// BEFORE (controller-registry.ts, batchOperations case):
const embedder = this.config.embeddingGenerator || null;
return new BO(this.agentdb.database, embedder);

// AFTER:
const embedder = this.createEmbeddingService();
return new BO(this.agentdb.database, embedder);
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

### P2: Align `numHeads` Between Attention Controllers

`multiHeadAttention` uses `numHeads: 4` while `attentionService` uses
`numHeads: 8`. If they operate on the same embedding space, head count should
be consistent. Change `multiHeadAttention` to 8 (matching `attentionService`)
and make both read from `config.controllers.multiHeadAttention.numHeads` /
`config.controllers.attentionService.numHeads`.

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/controller-registry.ts`.

### P2: Align `maxElements` Defaults

| Component | Current Default | Target |
|-----------|:--------------:|:------:|
| controller-registry → AgentDB | 100,000 | 100,000 (keep) |
| rvf-backend | 100,000 | 100,000 (keep) |
| hnsw-index | 1,000,000 | 100,000 |
| sqlite-backend | 1,000,000 | 1,000,000 (keep — row count, not vector count) |
| agentdb-adapter | 1,000,000 | 1,000,000 (keep — row count) |
| database-provider | 1,000,000 | 1,000,000 (keep — row count) |

The HNSW index should match the vector store limit (100K). The SQLite/adapter
`maxEntries` is a row limit for key-value storage, not a vector limit, so 1M
is appropriate.

Add `maxElements` to `config.json`:

```json
"memory": {
  "maxElements": 100000
}
```

**Location**: `hnsw-index.ts` default change; `.claude-flow/config.json`.

### P3: Remove `database-provider.js` Hardcoded Dimension

```typescript
// BEFORE (database-provider.ts, RVF case):
backend = new RvfBackend({
  dimensions: 768,   // hardcoded
  ...
});

// AFTER:
const { getEmbeddingConfig } = await import('@sparkleideas/agentdb');
const dim = getEmbeddingConfig?.().dimension ?? 768;
backend = new RvfBackend({
  dimensions: dim,
  ...
});
```

**Location**: `ruflo` fork, `v3/@claude-flow/memory/src/database-provider.ts`.

## Full Inventory: All Hardcoded Values in Controller Factories

| Controller | Hardcoded Value | Config Path (proposed) | Priority |
|-----------|----------------|----------------------|----------|
| `mutationGuard` | `dimension: 384` | `getEmbeddingConfig()` | P0 |
| `gnnService` | `inputDim: 384` | `getEmbeddingConfig()` | P0 |
| `attentionService` | `dim = 384` | `getEmbeddingConfig()` | P0 |
| `selfLearningRvfBackend` | `dimension: 384` | `getEmbeddingConfig()` | P0 |
| `createEmbeddingService` | `Float32Array(384)` | `getEmbeddingConfig()` | P0 |
| `attentionService` | `numHeads: 8` | `controllers.attentionService.numHeads` | P1 |
| `attentionService` | `useFlash: true` | `controllers.attentionService.useFlash` | P1 |
| `multiHeadAttention` | `numHeads: 4` | `controllers.multiHeadAttention.numHeads` | P2 |
| `selfAttention` | `topK: 10` | `controllers.selfAttention.topK` | P2 |
| `rateLimiter` | `maxRequests: 100` | `controllers.rateLimiter.maxRequests` | P2 |
| `circuitBreaker` | `failureThreshold: 5` | `controllers.circuitBreaker.failureThreshold` | P2 |
| `circuitBreaker` | `resetTimeoutMs: 60000` | `controllers.circuitBreaker.resetTimeoutMs` | P2 |
| `tieredCache` | `maxSize: 10000` | `controllers.tieredCache.maxSize` | P2 |
| `tieredCache` | `ttl: 300000` | `controllers.tieredCache.ttl` | P2 |
| `quantizedVectorStore` | `type: 'scalar-8bit'` | `controllers.quantizedVectorStore.type` | P2 |
| `federatedLearningManager` | `agentId: Date.now()` | `config.agentId` | P2 |
| `tieredMemoryStub` | `MAX_PER_TIER: 5000` | Intentional (fallback stub) | N/A |
| `tieredMemoryStub` | truncation at 100K chars | Intentional (safety limit) | N/A |
| `AgentDB init` | `maxElements: 100000` | `config.maxElements` | P2 |
| `database-provider` RVF | `dimensions: 768` | `getEmbeddingConfig()` | P3 |

## Storage Systems Map

Three distinct storage systems can be active simultaneously:

```
┌─────────────────────────────────────────────────────┐
│                ControllerRegistry                    │
│                                                     │
│  ┌──────────────────┐    ┌───────────────────────┐  │
│  │  this.backend     │    │  this.agentdb          │  │
│  │  (RVF/SQLite/     │    │  (AgentDB instance)    │  │
│  │   hybrid)         │    │                        │  │
│  │                   │    │  .database (SQLite)    │  │
│  │  Used by:         │    │                        │  │
│  │  - learningBridge │    │  Used by:              │  │
│  │  - memoryGraph    │    │  - reasoningBank       │  │
│  │                   │    │  - hierarchicalMemory  │  │
│  └──────────────────┘    │  - memoryConsolidation │  │
│                          │  - learningSystem      │  │
│                          │  - nightlyLearner      │  │
│                          │  - explainableRecall   │  │
│                          │  - graphTransformer    │  │
│                          │  - attestationLog      │  │
│                          │  - causalRecall        │  │
│                          │  - batchOperations     │  │
│                          │  - queryOptimizer      │  │
│                          │                        │  │
│                          │  .getController():     │  │
│                          │  - skills              │  │
│                          │  - reflexion           │  │
│                          │  - causalGraph         │  │
│                          │  - vectorBackend       │  │
│                          │  - graphAdapter        │  │
│                          └───────────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │  selfLearningRvfBackend                      │   │
│  │  Separate file: {dbPath}-rvf.sqlite          │   │
│  │  (only created when controller is enabled)    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  In-memory only (no persistence):                   │
│  - tieredCache, solverBandit, attentionMetrics,     │
│    resourceTracker, rateLimiter, circuitBreaker      │
└─────────────────────────────────────────────────────┘
```

`this.backend` and `this.agentdb.database` are **separate database handles**.
When both target the same `.db` file via better-sqlite3, WAL mode makes
concurrent access safe. But if `backend` is RVF and `agentdb` is SQLite, they
store disjoint data sets — `learningBridge` and `memoryGraph` data lives in
one backend while all other controllers' data lives in the other.

**Recommendation**: Long-term, `learningBridge` and `memoryGraph` should
migrate to use `this.agentdb.database` like all other controllers, eliminating
the separate `backend` handle entirely.

## Placeholder Controllers (Return null)

4 of 45 INIT_LEVELS slots are permanently null:

| Controller | Level | Reason |
|-----------|-------|--------|
| `hybridSearch` | 1 | "placeholder for future implementation" |
| `agentMemoryScope` | 2 | "placeholder, activated when explicitly enabled" |
| `federatedSession` | 6 | "placeholder for Phase 4" |
| `federatedLearningManager` | 4 | `isControllerEnabled` returns `false` |

These add init overhead (dynamic import attempts) for zero value. Consider
removing from INIT_LEVELS and activating only via `config.controllers[name] = true`.

## Test Impact

All changes target upstream fork source (`controller-registry.ts`,
`database-provider.ts`, `embedding-constants.ts`) and local config
(`config.json`). Existing tests in this repo already cover the patterns:

| Test File | Covers |
|-----------|--------|
| `controller-adr0061.test.mjs` | Factory construction contracts |
| `controller-registry-activation.test.mjs` | Enable/disable logic |
| `storage-config-adr0062.test.mjs` | Dimension resolution, HNSW params, pragmas |
| `storage-audit-adr0063.test.mjs` | Import paths, embedder reuse, dimension defaults |

New tests needed:

1. **Unit**: `resolvedDimension` uses `getEmbeddingConfig()` when `config.dimension` omitted
2. **Unit**: `batchOperations` gets real embedder via `createEmbeddingService()`
3. **Unit**: `multiHeadAttention` reads `numHeads` from config
4. **Acceptance**: `check_embedding_dim_consistency` — verify all initialized controllers report matching dimension

## Consequences

### Positive

- Eliminates the last 384/768 dimension split at the source (controller-registry)
- Removes 8 dead config fields that cause confusion
- Makes all hardcoded constructor args configurable
- Fixes `batchOperations` getting zero-vector embeddings
- Aligns `numHeads` between related attention controllers
- Documents the 3-storage-system architecture for future simplification

### Negative

- P0 adds a dynamic import to `initialize()` — 1 additional `await import()` call
- P1 changes `config.json` schema — existing deployments with the old fields see warnings (not errors)
- P2 `numHeads` 4→8 change for `multiHeadAttention` may increase memory usage slightly

### Risks

- P0 depends on `@sparkleideas/agentdb` being importable at registry init time. If the import fails, the fallback remains 768 (not 384), which is correct for all current models.
- Changing `config.json` in this repo only affects the local `.claude-flow/` config. Published packages carry their own defaults from source code.

## Related

- **ADR-0063**: Storage Audit Remediation (predecessor — this ADR addresses gaps found after 0063's fixes shipped)
- **ADR-0062**: Storage & Configuration Unification
- **ADR-0061**: Controller Integration Completion
- **ADR-0052**: Config-driven Embedding Framework

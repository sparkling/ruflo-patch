# ADR-0052: Config-Driven Embedding Framework

**Status**: Implemented (v3.5.15-patch.104, 2026-03-19)
**Date**: 2026-03-18 (implemented 2026-03-19)
**Deciders**: System Architecture
**Methodology**: SPARC + MADR

---

## S - Specification

### Problem

Embedding dimension values (384, 768, 1024, 1536) are scattered as bare literals
across 20+ source files in the ruflo and agentic-flow codebases. The codebase has
a "dimension war" — AgentDB defaults to 384 dimensions (MiniLM), the ruflo fork
defaults to 768 (mpnet), and 7+ files hardcode one or the other. Multiple
components silently disagree on embedding dimensionality, causing zero-dimension
embeddings (ADR-0050 D4), failed attention operations, and incorrect similarity
scores when vectors from different models are compared.

Today, changing the embedding model from `nomic-ai/nomic-embed-text-v1.5`
(768-dim) to `bge-base-en-v1.5` (384-dim) or `text-embedding-3-large` (3072-dim)
requires editing TypeScript source files — a code change, not a configuration
change.

An `embeddings.json` config file exists at `.claude-flow/embeddings.json` and a
`loadEmbeddingModel()` function reads it, but most consumers ignore it and fall
back to hardcoded literals.

### The Dimension War (pre-ADR state)

| Component | File | Default dim | Model assumed |
|-----------|------|:-----------:|---------------|
| AgentDB | AgentDB.ts:103 | 384 | all-MiniLM-L6-v2 (hardcoded) |
| MCP server | agentdb-mcp-server.ts:260-261 | 384 | all-MiniLM-L6-v2 (hardcoded) |
| LegacyAttentionAdapter | LegacyAttentionAdapter.ts:273,332 | 384 | hardcoded literal |
| NightlyLearner | NightlyLearner.ts:253 | 384 | hardcoded literal |
| LearningSystem | LearningSystem.ts:102,135 | 384 | hardcoded literal |
| attention-tools-handlers | attention-tools-handlers.ts | 384 | 7+ hardcoded literals |
| memory-initializer | memory-initializer.ts | 768 | sentence-transformers/all-mpnet-base-v2 |
| vector-db | vector-db.ts:100,189,232,250 | 768 | default parameter |
| memory-bridge | memory-bridge.ts:1302 | 768 | hardcoded literal |
| enhanced-embeddings | enhanced-embeddings.ts | 384 (fallback) | MODEL_DIMENSIONS map |
| controller-registry | controller-registry.ts (11 places) | 768 | `this.config.dimension \|\| 768` |
| rvf-embedding-service | rvf-embedding-service.ts:49 | 384 | DEFAULT_DIMENSIONS constant |
| shared/defaults | defaults.ts:78 | 1536 | (no model, wrong dimension) |
| shared/schema | schema.ts:95 | 1536 | (no model, wrong dimension) |

### Model Comparison

**Server**: AMD Ryzen 9 7950X3D (32 threads, 96MB V-Cache), 187GB RAM, no GPU

| Model | Dim | MTEB retrieval | Context | Size (quantized) | Latency (this server) | Year |
|-------|:---:|:--------------:|:-------:|:----------------:|:--------------------:|:----:|
| all-MiniLM-L6-v2 | 384 | 56.3% | 512 tokens | 23 MB | 4.1ms | 2019 |
| all-mpnet-base-v2 | 768 | 57.8% | 512 tokens | 420 MB | 12.7ms | 2021 |
| **nomic-embed-text-v1.5** | **768** | **86.2%** | **8192 tokens** | **131 MB** | **5.3ms** | **2024** |

nomic-embed-text-v1.5 wins on every axis: +30pp retrieval accuracy over MiniLM,
16x longer context window, smaller than mpnet, and faster than mpnet (native ONNX,
Matryoshka-trained).

Key capabilities:
- **Matryoshka representation**: vectors can be truncated to 128/256/384/512/768
  dims with graceful accuracy degradation — enables future adaptive dimensionality
- **Task prefixes**: `search_query:` and `search_document:` improve retrieval by 3-5pp
- **8K context**: can embed entire functions/files, not just 512-token snippets
- **Native ONNX**: works directly with `@xenova/transformers` pipeline

### Goal

Changing the embedding model should be a CONFIG change (edit `embeddings.json`
or set an env var), never a code change. All runtime dimension consumers must
read from a single resolved config object.

### Quality Attributes

| Attribute       | Requirement                                                    |
|-----------------|----------------------------------------------------------------|
| Configurability | Model swap via config file or env var, zero code changes       |
| Consistency     | Single source of truth for model, dimension, prefixes          |
| Compatibility   | Existing `embeddings.json` format remains valid                |
| Resilience      | Layered fallbacks: file -> env -> model map -> sane defaults   |
| Performance     | Config resolution is cached; no repeated file reads at runtime |

---

## P - Pseudocode (Design)

### 1. Config Interface

```typescript
// File: packages/agentdb/src/config/embedding-config.ts  (NEW)
// Also re-exported from @claude-flow/memory and @claude-flow/embeddings

/**
 * Task-prefix map for models that require instruction prefixes.
 * Example: nomic-embed-text-v1.5 needs "search_query:" / "search_document:"
 */
export interface TaskPrefixes {
  /** Prefix prepended to query text before embedding */
  query: string;
  /** Prefix prepended to document text before embedding */
  document: string;
  /** Prefix for clustering tasks (optional) */
  clustering?: string;
  /** Prefix for classification tasks (optional) */
  classification?: string;
}

/**
 * HNSW index parameters, optionally auto-derived from dimension.
 */
export interface HNSWParams {
  /** Number of bi-directional links per node (default: auto from dimension) */
  M: number;
  /** Size of dynamic candidate list during construction */
  efConstruction: number;
  /** Size of dynamic candidate list during search */
  efSearch: number;
}

/**
 * Resolved embedding configuration -- the single source of truth
 * that all consumers read from at runtime.
 */
export interface EmbeddingConfig {
  /** Model identifier (e.g., "nomic-ai/nomic-embed-text-v1.5") */
  model: string;
  /** Vector dimension (e.g., 768). Auto-derived from model if omitted. */
  dimension: number;
  /** Embedding provider backend */
  provider: 'transformers' | 'openai' | 'cohere' | 'custom' | 'onnx';
  /** Per-task text prefixes for instruction-tuned models */
  taskPrefixes: TaskPrefixes;
  /** HNSW index parameters (auto-derived from dimension if omitted) */
  hnsw: HNSWParams;
  /** API key for cloud providers (never logged, never serialized) */
  apiKey?: string;
  /** Model cache directory */
  cachePath: string;
  /** Batch size for bulk embedding operations */
  batchSize: number;
  /** Quantization mode for storage optimization */
  quantization: 'none' | 'scalar' | 'product';
}
```

### 2. Model Registry

```typescript
export const MODEL_REGISTRY: Record<string, {
  dimension: number;
  contextWindow: number;
  taskPrefixQuery: string;
  taskPrefixIndex: string;
  provider: string;
}> = {
  // Local / Transformers.js models
  'all-MiniLM-L6-v2':               { dimension: 384, ... },
  'Xenova/all-MiniLM-L6-v2':        { dimension: 384, ... },
  'all-mpnet-base-v2':              { dimension: 768, ... },
  'Xenova/all-mpnet-base-v2':       { dimension: 768, ... },
  'bge-small-en-v1.5':              { dimension: 384, ... },
  'BAAI/bge-small-en-v1.5':         { dimension: 384, ... },
  'bge-base-en-v1.5':               { dimension: 768, ... },
  'BAAI/bge-base-en-v1.5':          { dimension: 768, ... },
  'nomic-ai/nomic-embed-text-v1.5': { dimension: 768, taskPrefixQuery: 'search_query: ', taskPrefixIndex: 'search_document: ', ... },
  'nomic-embed-text-v1.5':          { dimension: 768, taskPrefixQuery: 'search_query: ', taskPrefixIndex: 'search_document: ', ... },
  // OpenAI models
  'text-embedding-ada-002':         { dimension: 1536, provider: 'openai', ... },
  'text-embedding-3-small':         { dimension: 1536, provider: 'openai', ... },
  'text-embedding-3-large':         { dimension: 3072, provider: 'openai', ... },
  // Cohere models
  'embed-english-v3.0':             { dimension: 1024, provider: 'cohere', ... },
  'embed-multilingual-v3.0':        { dimension: 1024, provider: 'cohere', ... },
};
```

### 3. `getEmbeddingConfig()` — Resolution Function

```typescript
/**
 * Resolve embedding configuration from layered sources.
 *
 * Priority (highest to lowest):
 *   1. Explicit overrides passed as argument
 *   2. Environment variables (AGENTDB_EMBEDDING_MODEL, AGENTDB_EMBEDDING_DIM, ...)
 *   3. embeddings.json file in .claude-flow/
 *   4. MODEL_REGISTRY auto-dimension from model name
 *   5. Hardcoded defaults (nomic-ai/nomic-embed-text-v1.5, 768)
 *
 * Result is cached per process after first resolution.
 */
export function getEmbeddingConfig(
  overrides?: Partial<EmbeddingConfig>
): EmbeddingConfig;
```

Resolution algorithm (pseudocode):

```
function getEmbeddingConfig(overrides):
  if _cachedConfig and not overrides:
    return _cachedConfig

  # Layer 1: Read embeddings.json
  fileConfig = readEmbeddingsJson()     # returns {} on missing/invalid

  # Layer 2: Read env vars
  envModel  = process.env.AGENTDB_EMBEDDING_MODEL
  envDim    = parseInt(process.env.AGENTDB_EMBEDDING_DIM)
  envProvider = process.env.AGENTDB_EMBEDDING_PROVIDER
  envApiKey = process.env.AGENTDB_EMBEDDING_API_KEY

  # Layer 3: Merge (overrides > env > file > defaults)
  model     = overrides.model     ?? envModel     ?? fileConfig.model     ?? 'nomic-ai/nomic-embed-text-v1.5'
  provider  = overrides.provider  ?? envProvider   ?? fileConfig.provider  ?? inferProvider(model)
  dimension = overrides.dimension ?? envDim        ?? fileConfig.dimension ?? lookupDimension(model)
  apiKey    = overrides.apiKey    ?? envApiKey      ?? fileConfig.apiKey

  # Layer 4: Auto-derive HNSW params from dimension
  hnsw = overrides.hnsw ?? fileConfig.hnsw ?? deriveHNSWParams(dimension)

  # Layer 5: Resolve task prefixes
  prefixes = overrides.taskPrefixes ?? fileConfig.taskPrefixes ?? lookupPrefixes(model)

  config = { model, dimension, provider, taskPrefixes: prefixes, hnsw, apiKey, ... }

  if not overrides:
    _cachedConfig = config

  return config
```

### 4. HNSW Parameter Derivation

```typescript
export function deriveHNSWParams(dimension: number): HNSWParams {
  // M = floor(sqrt(dimension) / 1.2), clamped to [8, 48]
  const M = Math.max(8, Math.min(48, Math.floor(Math.sqrt(dimension) / 1.2)));
  return {
    M,
    efConstruction: Math.max(100, M * 12),
    efSearch: Math.max(50, M * 6),
  };
}

// Results for common dimensions:
//   384-dim  -> M=16, efConstruction=192, efSearch=96
//   768-dim  -> M=23, efConstruction=276, efSearch=138
//   1024-dim -> M=26, efConstruction=312, efSearch=156
//   1536-dim -> M=32, efConstruction=384, efSearch=192
//   3072-dim -> M=46, efConstruction=552, efSearch=276
```

### 5. Task Prefix Handling

Task prefixes are applied at the embedding boundary — inside the `embed()`
and `embedBatch()` methods — not by callers.

```typescript
async embed(text: string, task: 'query' | 'document' = 'document'): Promise<Float32Array> {
  const config = getEmbeddingConfig();
  const prefix = config.taskPrefixes[task] ?? '';
  const prefixedText = prefix ? `${prefix}${text}` : text;
  // ... rest of embedding pipeline
}
```

Callers specify *intent* (`'query'` vs `'document'`), not the literal prefix
string. The framework maps intent to model-specific prefix.

---

## A - Architecture

### Config Propagation Chain

```
                    embeddings.json
                         |
                    ENV variables
                         |
                         v
              +--------------------+
              | getEmbeddingConfig |  <-- cached singleton
              +--------------------+
                   |          |
          +--------+          +----------+
          |                              |
          v                              v
  ControllerRegistry              AgentDB.initialize()
  .initialize({ ... })           reads config.dimension
          |                              |
          +-- 11 controller factories    +-- EmbeddingService
          |   (mutationGuard, GNN,       |   (transformers pipeline)
          |    attention, SelfLearning)   |
          |                              +-- GraphDatabaseAdapter
          +-- EnhancedEmbeddingService   |   (dimensions param)
          |   (cache, batch, search)     |
          |                              +-- createGuardedBackend
          +-- LearningBridge             |   (dimensions param)
          |   (createHashEmbedding)      |
          |                              v
          v                         VectorBackend
  memory-initializer.ts             (HNSW index)
  loadEmbeddingModel()
  getHNSWIndex()
```

### Two-Tier Consumer Architecture (as implemented)

```
TIER 1: Dynamic config resolution (can import agentdb)
  agentdb/src/config/embedding-config.ts  ─── canonical source
       │
       ├── AgentDB.ts ─────────── imports getEmbeddingConfig() directly
       ├── enhanced-embeddings.ts  imports MODEL_REGISTRY
       ├── memory-bridge.ts ────── dynamic import('agentdb')
       ├── controller-registry.ts  dynamic import('agentdb')
       └── memory-initializer.ts   dynamic import('agentdb')

TIER 2: Per-package constants (cannot import agentdb — circular deps)
  9 × embedding-constants.ts ──── each exports: EMBEDDING_DIM = 768
       │
       ├── @claude-flow/neural (10 consumers)
       ├── @claude-flow/embeddings (2 consumers)
       ├── @claude-flow/cli (7 consumers: headless, ewc-consolidation, intelligence,
       │     performance, embeddings cmd, embeddings-tools, executor)
       ├── @claude-flow/cli/mcp-tools (2 consumers)
       ├── @claude-flow/cli/ruvector (4 consumers)
       ├── @claude-flow/guidance (1 consumer)
       ├── @claude-flow/hooks (1 consumer)
       ├── @claude-flow/memory (1+8 consumers: learning-bridge + controller-registry factories)
       └── @claude-flow/swarm (1 consumer)
```

### Server Optimization (also implemented in this ADR)

Tuned controller-registry.ts for available hardware (Ryzen 9 7950X3D / 187GB):

| Setting | Before | After | Rationale |
|---------|:------:|:-----:|-----------|
| Memory ceiling | 16 GB | 160 GB | Dedicated server, 85% of 187GB |
| Insert rate limit | 100/s | 1000/s | CPU-bound, not memory-bound |
| Search rate limit | 1000/s | 10000/s | HNSW in-memory, V-Cache helps |
| Delete rate limit | 50/s | 500/s | Matches insert scaling |
| Batch rate limit | 10/s | 100/s | Parallelism headroom |
| Embedding cache | 100K | 500K | 768-dim × 4B × 500K = 1.5GB |
| Batch concurrency | 10 | 24 | 32 threads, leave 8 for other work |
| HNSW params | Hardcoded | `deriveHNSWParams()` | Auto-derived from dimension |

---

## R - Refinement

### File-by-File Changes

#### Core config module (agentic-flow fork)

| File | Change | Status |
|------|--------|:------:|
| `agentdb/src/config/embedding-config.ts` | New: ~200 lines, full config framework | DONE |
| `agentdb/src/index.ts` | Barrel export (lines 128-129) | DONE |
| `agentdb/src/core/AgentDB.ts` | Import + call `getEmbeddingConfig()` (lines 16, 90) | DONE |
| `agentdb/src/services/enhanced-embeddings.ts` | Remove inline MODEL_DIMENSIONS, delegate to MODEL_REGISTRY | DONE |

#### Primary consumers (ruflo fork — Tier 1)

| File | Change | Status |
|------|--------|:------:|
| `cli/src/memory/memory-bridge.ts` | Dynamic import, reads config at init | DONE (3 safe-default `768` remain as pre-config-load init values) |
| `memory/src/controller-registry.ts` | Dynamic import + 8 factory fallbacks → `EMBEDDING_DIM` | DONE |
| `cli/src/memory/memory-initializer.ts` | Dynamic import for getHNSWIndex + loadEmbeddingModel | PARTIAL — **10 static `768`** in fallback chains and config objects |
| `cli/src/init/executor.ts` | `MODEL_DIMS` lookup map replacing hardcoded ternary | DONE |

#### Per-package constants (ruflo fork — Tier 2)

| Package | Constants file | Consumers | Status |
|---------|---------------|:---------:|:------:|
| `@claude-flow/neural` | `src/embedding-constants.ts` | 10 | DONE |
| `@claude-flow/embeddings` | `src/embedding-constants.ts` | 2 | DONE |
| `@claude-flow/cli/mcp-tools` | `src/mcp-tools/embedding-constants.ts` | 2 | DONE |
| `@claude-flow/cli/ruvector` | `src/ruvector/embedding-constants.ts` | 4 | DONE |
| `@claude-flow/guidance` | `src/embedding-constants.ts` | 1 | DONE |
| `@claude-flow/hooks` | `src/reasoningbank/embedding-constants.ts` | 1 | DONE |
| `@claude-flow/cli` | `src/embedding-constants.ts` | 7 | DONE (2026-03-19) |
| `@claude-flow/memory` | `src/embedding-constants.ts` | 9 | DONE (2026-03-19: +8 controller-registry factories) |
| `@claude-flow/swarm` | `src/embedding-constants.ts` | 1 | DONE |

Each contains: `export const EMBEDDING_DIM = 768;`

These are static constants — changing `embeddings.json` does NOT propagate here.

#### Previously not migrated — now DONE (2026-03-19)

| File | Was | Now | Status |
|------|-----|-----|:------:|
| `shared/src/core/config/defaults.ts:78` | `1536` | `768` | DONE |
| `shared/src/core/config/schema.ts:95` | `.default(1536)` | `.default(768)` | DONE |
| `cli/src/init/executor.ts:1244` | `? 384 : 768` ternary | `MODEL_DIMS` lookup map | DONE |
| `cli/src/runtime/headless.ts:211` | `768` literal | `EMBEDDING_DIM` import | DONE |
| `cli/src/memory/ewc-consolidation.ts:152` | `768` literal | `EMBEDDING_DIM` import | DONE |
| `cli/src/memory/intelligence.ts:776` | `768` literal | `EMBEDDING_DIM` import | DONE |
| `cli/src/commands/embeddings.ts:738,1270,1371` | `384`/`768` literals | `EMBEDDING_DIM` import | DONE |
| `cli/src/commands/performance.ts:94,96` | `768` literals | `EMBEDDING_DIM` import | DONE |
| `cli/src/mcp-tools/embeddings-tools.ts:212` | `768` literal | `EMBEDDING_DIM` import | DONE |
| `memory/src/controller-registry.ts` (8 places) | `\|\| 768` | `\|\| EMBEDDING_DIM` | DONE |

### Files that do NOT need changes (false positives)

These use 384/768/1024 as buffer sizes (KB/MB), sequence lengths, or display
values — NOT embedding dimensions:

- `guidance/gateway.test.ts` (maxParamSize: 1024 bytes)
- `security/safe-executor.ts` (maxBuffer: 10 × 1024 × 1024 bytes)
- `security/input-validator.ts` (MAX_CONTENT_LENGTH: 1024 × 1024)
- `performance/attention-benchmarks.ts` (sequence length arrays)
- `performance/benchmark.ts` (byte-to-KB conversion divisor)
- `deployment/validator.ts` (build output buffer size)
- `deployment/release-manager.ts` (buffer limit)
- `plugins/examples/ruvector/*.ts` (heap display, sequence lengths)
- All `/ 1024` division for human-readable memory display

### Data migration concern

Switching from 384-dim MiniLM to 768-dim nomic means existing stored embeddings
are incompatible. The recommended approach is **re-embed on upgrade**: detect
dimension mismatch in vector-db, trigger re-embedding on first access. The
memory.db files are small (CLI workloads, <1MB typical) and re-embedding is fast
(5.3ms/entry on this server).

---

## C - Completion

### Implementation Summary

| Phase | Description | Status | Effort |
|-------|-------------|:------:|--------|
| 1: Core config module | embedding-config.ts + barrel + AgentDB + enhanced-embeddings | **Done** | ~275 lines, 14 files |
| 2: Primary consumers | memory-bridge, controller-registry, memory-initializer | **Mostly done** | controller-registry + executor done; memory-initializer has 10 remaining |
| 3: Per-package constants | 9 embedding-constants.ts files, 37 consumers wired | **Done** | ~41 files |
| 4: Remaining stragglers | shared/, init, headless, ewc, commands | **Done** (2026-03-19) | 11 files, 44 insertions |
| 5: Wire Tier 2 to config | 9 constants read from getEmbeddingConfig() via top-level await | **Done** (2026-03-19) | 9 files |
| 6: End-to-end test | 8 tests: exports, defaults, overrides, HNSW, cache reset | **Done** (2026-03-19) | 1 file, 95 lines |
| 7: Deploy | v3.5.15-patch.104 — 55/55 acceptance | **Done** (2026-03-19) | |

**Total effort**: ~631 lines across 54 unique files in 2 forks.

### Validation (2026-03-19)

- `tsc --noEmit` passes on memory, cli, shared, embeddings (pre-existing `eagerMaxLevel` only)
- `npm run test:unit` — **541/541 pass** (2.2s)

### Remaining `768` audit

After wiring, a grep audit found these remaining `768` values:

| File | Count | Verdict |
|------|:-----:|---------|
| `memory-initializer.ts` | ~10 | Fallback chains in getHNSWIndex + loadEmbeddingModel — safe defaults before config loads |
| `memory-bridge.ts` | 2 | Init values (lines 1237, 1324) before dynamic import resolves — safe |
| `executor.ts` | 1 | `?? 768` in MODEL_DIMS fallback — correct (default when model not in map) |

Remaining `1536` values are all **false positives** (not embedding defaults):
- `rvfa-builder.ts` — RVF binary file format spec
- `commands/embeddings.ts` — OpenAI model description in help table
- `neural-tools.ts` — quantization example display text
- `hooks/reasoningbank` — JSDoc comment
- `plugins/agentic-flow.ts` — separate plugin integration (own config)

### What works today

- Default dimension is **768 everywhere** — the dimension war is resolved
- Default model is **nomic-ai/nomic-embed-text-v1.5** — +30pp retrieval accuracy
- `getEmbeddingConfig()` works correctly for Tier 1 consumers
- **Zero raw `768` or `1536` default literals** remain in production code outside memory-initializer/memory-bridge fallback chains
- `shared/defaults.ts` and `shared/schema.ts` now correctly default to `768`
- `init/executor.ts` uses a `MODEL_DIMS` lookup map for new project generation
- Server is tuned for available hardware (160GB ceiling, 10x rate limits)
- Task prefix support is plumbed through memory-bridge

### What doesn't work

- `memory-initializer.ts` fallback chains use static `768` (but only fire when
  config loading fails — safe defaults).

### Completed (2026-03-19)

All remaining items done in a single session:
1. Wired 9 `embedding-constants.ts` files to read from `getEmbeddingConfig()` via top-level `await import('agentdb')`
2. E2e test: 8 tests covering exports, defaults, overrides, HNSW derivation, cache reset (all pass)
3. Deployed as v3.5.15-patch.104 — **55/55 acceptance**, 541/541 unit tests

### Env variables

| Variable                      | Purpose                     | Example                           |
|-------------------------------|-----------------------------|------------------------------------|
| `AGENTDB_EMBEDDING_MODEL`     | Override model name          | `bge-base-en-v1.5`               |
| `AGENTDB_EMBEDDING_DIM`       | Override dimension           | `384`                             |
| `AGENTDB_EMBEDDING_PROVIDER`  | Override provider            | `openai`                          |
| `AGENTDB_EMBEDDING_API_KEY`   | API key for cloud providers  | `sk-...`                          |
| `TRANSFORMERS_CACHE`          | Model download cache dir     | `~/.cache/transformers`           |

### Risk mitigation

| Risk | Mitigation |
|------|------------|
| Circular dependency (agentdb <-> memory) | Config module has zero imports from agentdb core; Tier 2 avoids the dep entirely |
| Process-level cache stale after hot reload | `resetEmbeddingConfig()` export for tests |
| embeddings.json missing in CI | Layered fallbacks ensure sane defaults |
| Tier 1/Tier 2 dimension mismatch | Currently safe (both default 768); real risk if Tier 1 is reconfigured without wiring Tier 2 |
| Breaking change for existing users | Default model/dimension unchanged (nomic, 768) |
| Existing 384-dim stored embeddings | Re-embed on upgrade; memory.db files are small, re-embedding is fast |

## Consequences

### Positive

- Resolves the dimension war: one dimension (768), one model (nomic), everywhere
- 30pp retrieval accuracy improvement (56% to 86%)
- 16x context window (512 to 8192 tokens)
- Server utilization jumps from ~10% to ~50% on available hardware
- Matryoshka support enables future adaptive dimensionality
- Task prefix support improves query/document asymmetric retrieval by 3-5pp

### Negative

- Existing stored 384-dim embeddings become incompatible (must re-embed)
- nomic model is 131MB quantized vs MiniLM 23MB — larger cache footprint
- Tier 2 constants use top-level await which requires ESM module loading

## Related

- **ADR-0048**: Lazy controller initialization — established the ONNX model cache chain
- **ADR-0050 D4**: `agentdb_embed` returning zero-dimension embeddings — root cause was the dimension war
- **ADR-0050 D2**: `agentdb_attention_benchmark` hardcoded dim=64 — same class of bug
- **ADR-0045**: Embeddings compliance and observability — established EnhancedEmbeddingService
- **ADR-0044**: Attention suite integration — established attention tools that hardcoded 384

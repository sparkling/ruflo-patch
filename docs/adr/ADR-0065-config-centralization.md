# ADR-0065: Configuration Centralization and Storage Deduplication

- **Status**: **Implemented (2026-05-03)** — P0/P1/P2 complete; P3 deferred per §Decision.
- **Date**: 2026-04-05
- **Deciders**: Henrik Pettersen
- **Builds on**: ADR-0062 (storage config unification), ADR-0063 (storage audit), ADR-0064 (controller config alignment)
- **Continued by**: [ADR-0066 — Controller Configuration Unification](ADR-0066-controller-config-unification.md)
- **Architecture**: [Controller Wiring Vision](../architecture/controller-wiring-vision.md)

## Context

A cross-codebase audit of all 44 controllers, storage backends, and config files reveals
three systemic problems that ADR-0062/0063/0064 partially addressed but did not resolve
at the architectural level:

### Problem 1: Config files are not wired — values are silently ignored

`config.json` contains well-structured settings for 7 controller groups, memory tuning,
and neural config. `embeddings.json` declares model, dimension, and HNSW parameters.
**Neither file's values reach the controller registry at runtime.**

`memory-bridge.ts` — the only code that constructs the registry — passes a hardcoded
object literal (lines 90-115) that omits all tuning parameters. Every `controllers.*`
field in config.json is dead configuration. `embeddings.json` is only read by the
`ruflo embeddings` CLI subcommand and MCP tools — it has zero influence on what
dimension the vector backend actually uses.

| Config file | Fields | Actually consumed | Dead |
|-------------|--------|-------------------|------|
| config.json `controllers.*` | 17 | 0 | 17 |
| config.json `memory.learningBridge.*` | 4 | 0 | 4 |
| config.json `memory.memoryGraph.*` | 3 | 0 | 3 |
| config.json `memory.agentScopes.*` | 3 | 0 | 3 |
| config.json `neural.*` | 4 | 0 | 4 |
| config.json `mcp.*` | 2 | 0 | 2 |
| embeddings.json | 8 | 0 (by core stack) | 8 |

### Problem 2: Hardcoded values disagree across files

| Value | Location | Hardcoded | Correct |
|-------|----------|-----------|---------|
| Fallback dimension | memory-bridge.ts:97,167,1118 | **384** | 768 |
| Fallback dimension | memory-initializer.ts:355,623,631 | **384** | 768 |
| Model name | memory-bridge.ts (5 locations) | `all-MiniLM-L6-v2` (384-dim) | `all-mpnet-base-v2` (768-dim) |
| Model name | memory-initializer.ts:1548 | `all-MiniLM-L6-v2` | `all-mpnet-base-v2` |
| rateLimiter windowMs | controller-registry.ts | Declared but **silently dropped** | Should be passed to RL constructor |
| quantizedVectorStore type | controller-registry.ts:1178 | `'scalar-8bit'` hardcoded | Should read config.json |
| database-provider.ts:269 | `require()` in ESM context | **Always fails**, falls to 768 | Should use `import()` |

The `384` vs `768` split-brain is the most critical: when `getEmbeddingConfig()` fails
(import error), memory-bridge creates HNSW indices at 384 dimensions, then the real
embedder produces 768-dim vectors. Cosine similarity operations produce garbage or crash.

### Problem 3: Redundant storage systems

The architecture has two parallel storage stacks that were designed independently and
later composed by wrapping rather than replacing:

| Storage System | Files | Purpose |
|----------------|-------|---------|
| AgentDB SQLite | 1 `.db` file | Structured memory, controllers, embeddings |
| IMemoryBackend | 1 separate `.db`/`.rvf`/`.json` | Overlapping memory + embeddings |
| GraphDatabaseAdapter | 1 `.graph` file | Graph edges |
| selfLearningRvfBackend | 1 `-rvf.sqlite` file | Learning state |
| MemoryGraph | In-memory Maps | Duplicates CausalMemoryGraph |

There are also 4 separate vector search implementations (AgentDB HNSW, RvfBackend
HnswLite, SqlJsBackend brute-force, JsonBackend brute-force) and up to 4 duplicate
AttentionService instances.

Controller instances are also duplicated:
- `reasoningBank`: Registry creates `new RB()` instead of fetching AgentDB's existing one
- `causalRecall`: Missing singleton injection, creates duplicate CausalMemoryGraph + ExplainableRecall
- `mutationGuard`: Creates own HNSW index instead of sharing vectorBackend
- `attestationLog`: Registry creates new instance vs AgentDB's existing one

## Decision

### P0: Wire config.json and embeddings.json into the registry (the forwarding gap)

**The root cause:** `memory-bridge.ts` passes a manually-written object literal to
`registry.initialize()` that omits all tuning parameters. Fix: read `config.json` and
`embeddings.json`, merge their values into the `RuntimeConfig` object passed to
`initialize()`.

```typescript
// memory-bridge.ts — before calling registry.initialize()
const configJson = readConfigJson(projectRoot);     // .claude-flow/config.json
const embeddingsJson = readEmbeddingsJson(projectRoot); // .claude-flow/embeddings.json

const runtimeConfig: RuntimeConfig = {
  dimension: embeddingsJson.dimension ?? 768,
  maxElements: configJson.memory?.maxElements ?? 100000,
  dbPath: resolvedDbPath,
  memory: {
    learningBridge: configJson.memory?.learningBridge,
    memoryGraph: configJson.memory?.memoryGraph,
    tieredCache: configJson.controllers?.tieredCache,
  },
  attentionService: configJson.controllers?.attentionService,
  multiHeadAttention: configJson.controllers?.multiHeadAttention,
  selfAttention: configJson.controllers?.selfAttention,
  rateLimiter: configJson.controllers?.rateLimiter,
  circuitBreaker: configJson.controllers?.circuitBreaker,
  solverBandit: configJson.controllers?.solverBandit,
  quantizedVectorStore: configJson.controllers?.quantizedVectorStore,
  // ... all other fields
};
```

### P0: Fix all 384 fallbacks to 768

Every `|| 384` and `?? 384` fallback in the codebase must change to read from
`embeddings.json` or fall back to `768`. Files affected:

- `memory-bridge.ts`: lines 97, 167, 1118 (3 occurrences)
- `memory-initializer.ts`: lines 355, 623, 631 (3 occurrences)
- `config-adapter.ts`: line 40

### P0: Fix model name to read from embeddings.json

Replace all 6 hardcoded `'Xenova/all-MiniLM-L6-v2'` strings with a read from
`embeddings.json` model field, falling back to `'Xenova/all-mpnet-base-v2'`:

- `memory-bridge.ts`: lines 538, 1039, 1074, 1224
- `memory-initializer.ts`: line 1548

### P1: Fix config.json structural mismatches

| Field | File value shape | Code reads | Fix |
|-------|------------------|------------|-----|
| `swarm.autoScale` | `true` (boolean) | `.autoScale?.enabled` | Change to `{ enabled: true }` |
| `mcp.port` | `3000` (root) | `.mcp?.transport?.port` | Change to `{ transport: { port: 3000 } }` |
| `memory.backend` | `"hybrid"` | `memory?.type` | Add `memory.type` alias |

### P1: Add missing config.json fields

```json
{
  "controllers": {
    "multiHeadAttention": { "numHeads": 8, "topK": 10 },
    "solverBandit": { "costWeight": 0.3, "costDecay": 0.05, "explorationBonus": 0.1 }
  },
  "daemon": {
    "maxConcurrent": 2,
    "workerTimeoutMs": 300000,
    "headless": false,
    "resourceThresholds": {
      "maxCpuLoad": 28,
      "minFreeMemoryPercent": 5
    }
  }
}
```

### P1: Add HNSW settings to embeddings.json

```json
{
  "hnsw": {
    "metric": "cosine",
    "maxElements": 100000,
    "persistIndex": true,
    "rebuildThreshold": 0.1
  },
  "hashFallbackDimension": 128
}
```

### P2: Fix quantizedVectorStore to read config

`controller-registry.ts` line 1178: change from hardcoded `{ type: 'scalar-8bit' }`
to `{ type: this.config.controllers?.quantizedVectorStore?.type ?? 'scalar-8bit' }`.

### P2: Fix rateLimiter windowMs passthrough

`controller-registry.ts` lines 1229-1238: pass `windowMs` to the `RL` constructor
instead of silently deriving `refillRate = maxTokens`.

### P2: Fix database-provider.ts require() in ESM

Line 269: replace `require('@claude-flow/agentdb')` with
`await import('@claude-flow/agentdb')` or read from `embeddings.json` directly.

### P2: Deduplicate controller instances

- `reasoningBank`: fetch from `this.agentdb.getController('reasoningBank')` instead of `new RB()`
- `causalRecall`: pass existing CausalMemoryGraph + ExplainableRecall singletons
- `mutationGuard`: share vectorBackend instead of creating own HNSW index
- `attestationLog`: fetch from AgentDB instead of creating new instance

### P3-1: Remove dead fallback backends (SqlJsBackend + JsonBackend)

`SqlJsBackend` (766 lines) and `JsonBackend` (215 lines, embedded in database-provider.ts)
exist as inferior fallbacks for environments without `better-sqlite3`. RvfBackend's
pure-TS mode provides the same cross-platform fallback with HNSW-Lite vector search
(150x–12,500x faster than their brute-force cosine). Remove both and let the
`database-provider.ts` selection logic fall through to RvfBackend when better-sqlite3
is unavailable.

Files to change:
- `database-provider.ts`: remove `sql.js` and `json` cases from switch, remove
  embedded `JsonBackend` class
- `sqljs-backend.ts`: delete
- `index.ts`: remove re-exports of SqlJsBackend and JsonBackend
- Tests referencing these backends: update or remove

### P3-2: Deduplicate memory_entries schema (SQLiteBackend ↔ AgentDBBackend)

`SQLiteBackend` (735 lines) and `AgentDBBackend` (1054 lines) define identical
16-column `memory_entries` tables with identical indexes. When both are instantiated
by `HybridBackend`, the same data exists in two SQLite databases. AgentDBBackend
should delegate to AgentDB's own storage rather than reimplementing the schema.

- Extract the shared `memory_entries` DDL into a single constant
- Have AgentDBBackend use AgentDB's database handle rather than its own

### P3-3: Centralize HNSW parameter derivation

`deriveHNSWParams(dimension)` is duplicated in `agentdb-backend.ts` (line 66) and
`rvf-backend.ts` (line 21) with identical formulas. Extract to a shared utility in
`@claude-flow/memory/src/hnsw-utils.ts` and import from both.

### ~~P3: Consolidate graph representations~~ — REJECTED

The original proposal to consolidate MemoryGraph, CausalMemoryGraph, and
GraphDatabaseAdapter was based on a surface-level observation ("3 graph systems").
A code-level audit shows they serve fundamentally different purposes:

| System | Purpose | Schema | Repo |
|--------|---------|--------|------|
| **MemoryGraph** | Structural ranking — PageRank + community detection blended with vector similarity | In-memory Maps (generic nodes/edges) | ruflo fork |
| **CausalMemoryGraph** | Causal inference — do-calculus, A/B experiments, uplift estimation, multi-hop chains | `causal_edges`, `causal_experiments`, `causal_observations` | agentic-flow fork |
| **GraphDatabaseAdapter** | Graph storage engine — Cypher-queryable nodes with vector embeddings and hyperedges | `@ruvector/graph-node` (.graph file) | agentic-flow fork |

These are not redundant implementations of the same concept. Consolidating them
would create a god-object that does three different things badly. Each system stays
as-is.

### P3-4: Remove dead config fields — DONE

| Field | Reason | Status |
|-------|--------|--------|
| `memory.agentScopes.*` | No code reads it; controller is disabled | Removed |
| `neural.flashAttention` | Not in RuntimeConfig | Removed |
| `neural.maxModels` | Not in RuntimeConfig | Removed |

## Consequences

### Positive
- config.json becomes the actual single source of truth (not just documentation)
- embeddings.json controls ALL embedding behavior (model, dimension, HNSW params)
- Dimension mismatches eliminated (no more 384 vs 768 split-brain)
- Operators can tune controller behavior without code changes
- Removing SqlJsBackend + JsonBackend eliminates ~1000 lines and 2 brute-force search paths
- Centralizing HNSW params prevents formula drift between backends

### Negative
- Large changeset across memory-bridge.ts, memory-initializer.ts, controller-registry.ts
- Must preserve backward compatibility for existing config files (missing fields = use defaults)
- Removing SqlJsBackend drops WASM-only environment support (RvfBackend pure-TS covers this)

### Risks
- Changing dimension fallbacks from 384 to 768 may break existing databases with 384-dim vectors
- Config forwarding must handle partial configs gracefully (missing keys = defaults, not crashes)
- Removing fallback backends requires verifying RvfBackend works in all environments where
  sql.js was previously needed

## Acceptance Criteria

- [x] All config.json `controllers.*` fields are consumed by their respective controllers
- [x] embeddings.json `dimension` and `model` are used by memory-bridge and memory-initializer
- [x] Zero hardcoded `384` fallbacks remain in ruflo fork (`@claude-flow/memory` + `@claude-flow/cli`)
- [x] Zero hardcoded `all-MiniLM-L6-v2` model strings remain in ruflo fork (cross-repo cleanup in ADR-0066 P0)
- [x] quantizedVectorStore reads type from config
- [x] rateLimiter passes windowMs to constructor
- [x] No `require()` in ESM context
- [x] Dead config fields removed (agentScopes, flashAttention, maxModels)
- [ ] Controller instances reuse AgentDB singletons where available → ADR-0066 P1
- [x] SqlJsBackend and JsonBackend removed; database-provider falls through to RvfBackend (P3-1 done)
- [x] memory_entries DDL defined once, shared between SQLiteBackend and AgentDBBackend (P3-2 done)
- [x] deriveHNSWParams extracted to shared utility (P3-3 done)

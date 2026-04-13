# ADR-0086: Layer 1 — Single Storage Abstraction

- **Status**: Proposed
- **Date**: 2026-04-13
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0085 (bridge deletion), ADR-0075 (ideal state L1), ADR-0073 (RVF phases), ADR-0080 (storage consolidation)
- **Closes**: ADR-0075 Layer 1 (the last remaining gap to the ideal state)

## Context

ADR-0085 closed Layers 2-5 of the ADR-0075 ideal state. One gap remains:

**Layer 1: Single Storage Abstraction** — `memory-initializer.ts` (2,814 lines) is a
monolithic SQLite CRUD layer that memory-router.ts wraps. It uses direct better-sqlite3
calls for every operation, manages its own HNSW index, embedding model loading,
quantization, schema migration, and temporal decay. None of this goes through the
`IStorage` interface that already exists in `@claude-flow/memory/src/storage.ts`.

### What exists today

**memory-initializer.ts** exports 30 functions across 6 categories:

| Category | Functions | Lines |
|----------|-----------|-------|
| CRUD | storeEntry, searchEntries, listEntries, getEntry, deleteEntry | ~580 |
| HNSW | getHNSWIndex, addToHNSWIndex, searchHNSWIndex, getHNSWStatus, clearHNSWIndex, rebuildSearchIndex | ~310 |
| Embedding | loadEmbeddingModel, generateEmbedding, generateBatchEmbeddings, getAdaptiveThreshold | ~400 |
| Quantization | quantizeInt8, dequantizeInt8, quantizedCosineSim, getQuantizationStats | ~100 |
| Attention | batchCosineSim, softmaxAttention, topKIndices, flashAttentionSearch | ~120 |
| Lifecycle | initializeMemoryDatabase, checkMemoryInitialization, ensureSchemaColumns, checkAndMigrateLegacy, applyTemporalDecay, verifyMemoryInit, getInitialMetadata, MEMORY_SCHEMA_V3 | ~500 |

**IStorageContract** (16 methods) already exists in `@claude-flow/memory/src/storage.ts`.
It documents the narrow interface controllers actually call: initialize, shutdown, store,
get, getByKey, update, delete, search, query, bulkInsert, bulkDelete, count,
listNamespaces, clearNamespace, getStats, healthCheck.

**RvfBackend** (532 lines) already implements most of IStorageContract and uses WAL writes
(ADR-0073 Phase 1), Rust HNSW (Phase 2), and native activation (Phase 3) — all complete.

**memory-router.ts** (1,400 lines) already wraps memory-initializer.ts via `loadStorageFns()`
and routes all CRUD through `routeMemoryOp()`. It also wraps all 23 named exports via
`_wrap()` lazy delegates.

### Why the initializer is hard to replace

1. **Schema ownership** — `MEMORY_SCHEMA_V3` and `ensureSchemaColumns()` create the
   SQLite tables that everything depends on. RvfBackend creates its own tables but NOT
   `memory_entries`.

2. **HNSW management** — The initializer manages its own in-memory HNSW index (persisted
   to `hnsw.metadata.json`). This is separate from RvfBackend's HNSW. Consolidating them
   requires deciding which HNSW implementation wins.

3. **Embedding model loading** — 4-tier fallback chain: agentdb config, @xenova/transformers
   ONNX, ruvector ONNX, hash-fallback. This is memory-initializer's responsibility, not
   storage's. It should move to the EmbeddingPipeline (ADR-0076 Phase 3, already exists).

4. **Quantization + attention** — 8 functions (quantizeInt8, softmaxAttention, etc.) are
   computational utilities that don't belong in a storage layer at all.

5. **Search combines embedding + storage** — `searchEntries()` generates the query embedding,
   tries HNSW fast path, falls back to brute-force SQLite with `cosineSim()`. This
   interleaving makes it hard to separate storage from embedding.

### What makes it achievable now

After ADR-0085:
- **Single entry point** — all callers go through memory-router.ts, never directly to
  the initializer. Changing the implementation behind the router is invisible to callers.
- **No bridge dependency** — the initializer is pure SQLite CRUD, no AgentDB coupling.
- **IStorageContract exists** — the target interface is defined and documented.
- **RvfBackend works** — WAL writes, Rust HNSW, native activation all tested.
- **EmbeddingPipeline exists** — `@claude-flow/memory/src/embedding-pipeline.ts` handles
  model loading and generation. The initializer's embedding code is redundant.

## Decision

Replace memory-initializer.ts with IStorageContract-backed implementations in 4 phases.
Each phase is independently deployable and testable. The router's `loadStorageFns()`
provides the seam: swap the import target, callers don't change.

## Tasks

### Phase 1: Extract non-storage functions (~620 lines)

Move functions that don't belong in a storage layer out of memory-initializer.ts:

- [ ] **T1.1** Move quantization functions (4) to `@claude-flow/memory/src/quantization.ts`
  (already has types). Router's `_wrap()` delegates update their import.
- [ ] **T1.2** Move attention functions (4) to `@claude-flow/memory/src/attention.ts`.
  Router updates.
- [ ] **T1.3** Move embedding functions (4) to use EmbeddingPipeline as the primary path,
  with the initializer's fallback chain as the degraded path. Router's
  `routeEmbeddingOp()` already handles this.
- [ ] **T1.4** Move schema/migration functions to `memory-schema.ts` (new file, ~200 lines).
  The initializer's `initializeMemoryDatabase()` becomes a thin call to schema init +
  storage init.
- [ ] **T1.5** Tests for each extracted module.

**Result**: memory-initializer.ts shrinks to ~1,800 lines (CRUD + HNSW + lifecycle).

### Phase 2: Implement IStorageContract adapter over better-sqlite3 (~400 lines)

Create `sqlite-storage.ts` that implements IStorageContract using the same better-sqlite3
queries the initializer uses today:

- [ ] **T2.1** Implement `SqliteStorage` class: initialize, shutdown, store, get, getByKey,
  update, delete, search (embedding-aware), query, bulkInsert, bulkDelete, count,
  listNamespaces, clearNamespace, getStats, healthCheck.
- [ ] **T2.2** The `search()` method accepts a pre-computed embedding vector and does
  brute-force cosine similarity against stored embeddings (same as today). HNSW
  acceleration is added in Phase 3.
- [ ] **T2.3** Schema creation uses the extracted `memory-schema.ts` from Phase 1.
- [ ] **T2.4** Full unit + integration tests against a real SQLite DB.

**Result**: A clean IStorageContract implementation exists alongside the initializer.

### Phase 3: Wire SqliteStorage into memory-router.ts

Replace `loadStorageFns()` with IStorageContract:

- [ ] **T3.1** Update `_doInit()` in memory-router.ts: create `SqliteStorage`, call
  `storage.initialize()`, replace `_fns` with storage method delegates.
- [ ] **T3.2** Update `routeMemoryOp()` to call `storage.store()`, `storage.get()`, etc.
  instead of `fns.storeEntry()`, `fns.getEntry()`, etc.
- [ ] **T3.3** Update `routeEmbeddingOp()` to use EmbeddingPipeline for generation and
  `storage.search()` for HNSW/vector operations.
- [ ] **T3.4** Add HNSW fast-path: if RvfBackend is available (native or HnswLite),
  `storage.search()` delegates to it. Otherwise falls back to brute-force.
- [ ] **T3.5** `shutdownRouter()` calls `storage.shutdown()`.
- [ ] **T3.6** Tests: all existing unit tests pass with new storage backend.

**Result**: memory-router.ts uses IStorageContract. memory-initializer.ts is no longer
imported.

### Phase 4: Delete memory-initializer.ts

- [ ] **T4.1** Delete memory-initializer.ts (~1,800 lines remaining after Phase 1 extraction).
- [ ] **T4.2** Remove `_wrap()` delegates and `loadStorageFns()` from router (replaced by
  direct IStorageContract calls).
- [ ] **T4.3** Remove `loadAllFns()` and `loadEmbeddingFns()` from router.
- [ ] **T4.4** Update acceptance checks: verify initializer is absent from dist.
- [ ] **T4.5** Full test suite + acceptance pass.

**Result**: ADR-0075 Layer 1 complete. Single storage abstraction achieved.

## Lines eliminated

| Source | Lines |
|--------|-------|
| memory-initializer.ts (deleted) | ~2,814 |
| Router _wrap delegates + loadStorageFns (replaced) | ~80 |
| **Total deleted** | **~2,894** |
| SqliteStorage (new) | ~400 |
| Extracted modules (quantization, attention, schema) | ~620 (relocated) |
| **Net reduction** | **~1,874** |

## Risks

| Risk | Mitigation |
|------|------------|
| Search quality regression | Phase 2 T2.2 uses identical SQL + cosine logic; tests compare results |
| Schema migration breakage | Phase 1 T1.4 extracts schema as-is; no logic changes |
| Embedding pipeline gaps | Phase 1 T1.3 keeps initializer chain as degraded fallback |
| HNSW dual-index confusion | Phase 3 T3.4 explicitly picks one (RvfBackend's or initializer's) |
| Large diff, merge conflicts | 4 independent phases; each deployable separately |

## What this achieves

```
BEFORE (current):
  router → loadStorageFns() → memory-initializer.ts → better-sqlite3
                                     │
                                     ├── own HNSW index
                                     ├── own embedding model
                                     ├── own quantization
                                     └── own schema management

AFTER (Phase 4):
  router → SqliteStorage (IStorageContract) → better-sqlite3
               │
               └── EmbeddingPipeline (separate)
               └── HNSW via RvfBackend (separate)
               └── Schema via memory-schema.ts (separate)
```

ADR-0075's full 5-layer ideal state is achieved. Every memory operation follows one path:
`MCP Tool → router → IStorageContract → backend`.

## What this does NOT address

- **RvfBackend as primary over SQLite** — this ADR uses SQLite as the IStorageContract
  implementation. Swapping to RvfBackend as primary is a future decision once RVF's
  structured query support matures. The IStorageContract interface makes this swap trivial.
- **HybridBackend revival** — upstream plans to revive it for dual-engine routing. The
  IStorageContract interface supports this: implement `HybridStorage` that delegates
  structured queries to SQLite and vector queries to RVF.

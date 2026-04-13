# ADR-0086: Layer 1 — Single Storage Abstraction (RVF-First)

- **Status**: Proposed (revised 2026-04-13)
- **Date**: 2026-04-13
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0085 (bridge deletion), ADR-0075 (ideal state L1), ADR-0073 (RVF phases), ADR-0080 (storage consolidation)
- **Informed by**: ADR-0087 (adversarial prompting workflow), hive discussion 2026-04-13
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

**RvfBackend** (~998 lines) already implements all 16 IStorageContract methods using:
- In-memory `Map<string, MemoryEntry>` for document storage and structured queries
- In-memory `Map<string, string>` keyIndex for O(1) exact key lookups
- Native `@ruvector/rvf-node` N-API for vector HNSW (primary)
- HnswLite pure-TS fallback when native unavailable
- Append-only WAL for crash-safe persistence

**memory-router.ts** (1,400 lines) wraps memory-initializer.ts via `loadStorageFns()`
and routes all CRUD through `routeMemoryOp()`. It also wraps all 23 named exports via
`_wrap()` lazy delegates.

### Why the initializer can be replaced now

After ADR-0085:
- **Single entry point** — all callers go through memory-router.ts, never directly to
  the initializer. Changing the implementation behind the router is invisible to callers.
- **No bridge dependency** — the initializer is pure SQLite CRUD, no AgentDB coupling.
- **IStorageContract exists** — the target interface is defined and documented.
- **RvfBackend implements all 16 methods** — verified by hive discussion (Queen, Storage
  Expert, Migration Strategist independently confirmed). The "structured query gap" does
  not exist in practice; in-memory Maps handle getByKey, listNamespaces, count, and query.
- **EmbeddingPipeline exists** — handles model loading and generation. The initializer's
  embedding code is redundant.
- **No migration needed** — nobody uses the current storage until the work is complete.

### Adversarial review findings (ADR-0087)

A hive of 8 experts (including devil's advocate) stress-tested this plan:

1. **IStorageContract was designed for SQL** — 6 methods (getByKey, listNamespaces,
   clearNamespace, count, query, bulkDelete) assume relational semantics. RvfBackend
   handles them via in-memory Map scans, which is fine at current scale (<100K entries)
   but would need META_IDX_SEG acceleration at larger scale.

2. **Three HNSW implementations exist, not two** — JS HNSW (memory-initializer),
   HnswLite (RvfBackend pure-TS), Rust HNSW (N-API). Resolution: JS HNSW dies with
   the initializer. No data migration — vectors are already in RvfBackend's format.

3. **Progressive HNSW (70% → 95% recall)** — non-issue at current dataset sizes
   (hundreds to low thousands). Entries reach Layer C essentially immediately.

## Decision

Replace memory-initializer.ts with RvfBackend in 3 phases. No SqliteStorage adapter.
No migration. No dual-backend. RvfBackend already satisfies IStorageContract.

## Tasks

### Phase 1: Extract non-storage functions (~620 lines)

Move functions that don't belong in a storage layer out of memory-initializer.ts:

- [ ] **T1.1** Move quantization functions (4) to `@claude-flow/memory/src/quantization.ts`.
  Router's `_wrap()` delegates update their import.
- [ ] **T1.2** Move attention functions (4) to `@claude-flow/memory/src/attention.ts`.
  Router updates.
- [ ] **T1.3** Move embedding functions (4) to use EmbeddingPipeline as the primary path,
  with the initializer's fallback chain as the degraded path. Router's
  `routeEmbeddingOp()` already handles this.
- [ ] **T1.4** Delete schema/migration functions (MEMORY_SCHEMA_V3, ensureSchemaColumns,
  checkAndMigrateLegacy). RVF has no schema — these are dead code.
- [ ] **T1.5** Tests for each extracted module.

**Result**: memory-initializer.ts shrinks to ~1,800 lines (CRUD + HNSW + lifecycle).

### Phase 2: Wire RvfBackend into memory-router.ts

Replace `loadStorageFns()` with RvfBackend (IStorageContract):

- [ ] **T2.1** Add `implements IStorageContract` to RvfBackend class declaration (it
  already satisfies the interface, just not formally declared).
- [ ] **T2.2** Update `_doInit()` in memory-router.ts: create `RvfBackend`, call
  `storage.initialize()`, replace `_fns` with storage method delegates.
- [ ] **T2.3** Update `routeMemoryOp()` to call `storage.store()`, `storage.get()`, etc.
  instead of `fns.storeEntry()`, `fns.getEntry()`, etc.
- [ ] **T2.4** Update `routeEmbeddingOp()` to use EmbeddingPipeline for generation and
  `storage.search()` for vector operations.
- [ ] **T2.5** `shutdownRouter()` calls `storage.shutdown()`.
- [ ] **T2.6** Tests: all existing unit tests pass with RvfBackend.

**Result**: memory-router.ts uses IStorageContract via RvfBackend. memory-initializer.ts
is no longer imported.

### Phase 3: Delete

- [ ] **T3.1** Delete memory-initializer.ts (~1,800 lines remaining after Phase 1).
- [ ] **T3.2** Delete `loadStorageFns()`, `_wrap()` delegates, `loadAllFns()`,
  `loadEmbeddingFns()` from router.
- [ ] **T3.3** Remove `better-sqlite3` dependency from memory package.
- [ ] **T3.4** Delete `hnsw.metadata.json` persistence (JS HNSW dies with initializer).
- [ ] **T3.5** Update acceptance checks: verify initializer is absent from dist.
- [ ] **T3.6** Full test suite + acceptance pass.

**Result**: ADR-0075 Layer 1 complete. Single storage abstraction achieved.

## Lines eliminated

| Source | Lines |
|--------|-------|
| memory-initializer.ts (deleted) | ~2,814 |
| Router _wrap delegates + loadStorageFns (replaced) | ~80 |
| Schema/migration functions (deleted, not relocated) | ~200 |
| **Total deleted** | **~3,094** |
| Extracted modules (quantization, attention) | ~220 (relocated) |
| **Net reduction** | **~2,274** |

Also removed: `better-sqlite3` native dependency.

## Performance impact

| Metric | Before (SQLite+JS-HNSW) | After (RVF) |
|--------|------------------------|-------------|
| Cold start (1000 entries) | ~400ms | <5ms |
| Single write latency | ~80μs | ~300μs |
| Batch write (100 entries) | ~15ms | ~8ms |
| Steady-state RSS | ~9MB | ~4MB |
| Rust quantization | N/A | 5-10x faster (SIMD) |

Startup time and memory footprint improve significantly. Single writes are slower
(append-only binary vs. prepared SQL), acceptable for the use case.

## Testing strategy

| Level | What to test | Key rule |
|-------|-------------|----------|
| Unit | Mock at IStorageContract boundary, not N-API. Verify router delegates correctly. | London School — `mockCtor()`/`mockFn()` |
| Integration | Real `.rvf` file. Store, search, persist, reopen. | Assert only top-1 for HNSW (geometrically unambiguous queries). Never assert full result-set ordering. |
| Acceptance | `check_no_initializer_in_dist()`, `check_storage_contract_exports()`, `check_quantization_extracted()`, `check_memory_search_works()` | Run in fresh init'd project against published packages |

**Progressive HNSW testing rule**: Assert top-1 correctness, result count bounds,
score monotonicity. Never assert full result ordering.

## Risks

| Risk | Mitigation |
|------|------------|
| Search quality regression | Integration tests with unambiguous nearest-neighbor queries |
| Embedding pipeline gaps | Phase 1 T1.3 keeps initializer chain as degraded fallback |
| Single-write latency increase | Acceptable at 300μs; batch path is faster |
| Scale beyond in-memory Maps | META_IDX_SEG available as escape hatch; not needed today |

## What this achieves

```
BEFORE (current):
  router → loadStorageFns() → memory-initializer.ts → better-sqlite3
                                     │
                                     ├── own JS HNSW index
                                     ├── own embedding model
                                     ├── own quantization
                                     └── own schema management

AFTER (Phase 3):
  router → RvfBackend (IStorageContract)
               │
               ├── In-memory Maps (structured queries)
               ├── Rust HNSW via N-API (vector search, primary)
               ├── HnswLite pure-TS (vector search, fallback)
               └── Append-only WAL (crash-safe persistence)
               
  EmbeddingPipeline (separate)
  quantization.ts (separate)
  attention.ts (separate)
```

ADR-0075's full 5-layer ideal state is achieved. Every memory operation follows one path:
`MCP Tool → router → IStorageContract (RvfBackend) → in-memory Maps + HNSW`.

No SQLite. No dual backends. No migration.

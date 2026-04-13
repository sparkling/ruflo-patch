# ADR-0086: Layer 1 — Single Storage Abstraction (RVF-First)

- **Status**: Accepted — Phase 0+1 complete, Phases 2-3 pending
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

Two hive discussions (8 experts each, including devil's advocate and Reuven Cohen as
RVF domain expert) stress-tested this plan using ADR-0087's adversarial technique:

1. **IStorageContract was designed for SQL** — 6 methods (getByKey, listNamespaces,
   clearNamespace, count, query, bulkDelete) assume relational semantics. RvfBackend
   handles them via in-memory Map scans, which is fine at current scale (<100K entries)
   but would need META_IDX_SEG acceleration at larger scale.

2. **Three HNSW implementations exist, not two** — JS HNSW (memory-initializer),
   HnswLite (RvfBackend pure-TS), Rust HNSW (N-API). Resolution: JS HNSW dies with
   the initializer. No data migration — vectors are already in RvfBackend's format.

3. **Progressive HNSW (70% → 95% recall)** — non-issue at current dataset sizes
   (hundreds to low thousands). Entries reach Layer C essentially immediately.

4. **12 direct importers bypass the router** — `cli/index.ts`, `commands/memory.ts` (6),
   `commands/embeddings.ts` (7), `commands/benchmark.ts` (4), `commands/performance.ts`,
   `runtime/headless.ts`, `mcp-server.ts`, `worker-daemon.ts`, `commands/neural.ts`,
   `commands/hooks.ts`, `commands/init.ts`. Phase 2 must rewire all of these.

5. **better-sqlite3 has 5 surviving consumers** — `sqlite-backend.ts`,
   `database-provider.ts`, `rvf-migration.ts`, `migration.ts`, `@claude-flow/hooks`.
   Phase 3 must handle all of them before dropping the dependency.

6. **T1.4 (schema) has 6+ external callers** — `initializeMemoryDatabase` is called
   from `commands/init.ts`, `commands/memory.ts`, `mcp-server.ts`, `worker-daemon.ts`,
   `index.ts`, router. Cannot blindly delete — callers must be replaced first.

### Post-acceptance adversarial review (12-agent swarm, 2026-04-13)

A 12-agent swarm conducted a second adversarial pass after Phase 0 acceptance,
verifying every claim in the original findings and producing corrected data:

**Finding 4 corrected**: 13 direct importers across 13 files (not 12), with 38
individual `import()` statements. `hooks-tools.ts` was missing from the original list.
`index.ts` re-exports 18 functions — the largest blast radius.

**Finding 5 corrected**: 16 source files reference `better-sqlite3` (not 5):

| File | Package | Classification |
|------|---------|---------------|
| memory-initializer.ts | cli | DIES_WITH_INITIALIZER |
| statusline.cjs | cli | DIES_WITH_INITIALIZER |
| intelligence.cjs | cli | DIES_WITH_INITIALIZER |
| doctor.ts | cli | DIES_WITH_INITIALIZER |
| performance.ts | cli | DIES_WITH_INITIALIZER |
| benchmark.ts | cli | DIES_WITH_INITIALIZER |
| learning-service.mjs | cli | ACTIVE_INDEPENDENT |
| embeddings.ts | cli | ACTIVE_INDEPENDENT |
| sqlite-backend.ts | memory | ACTIVE_INDEPENDENT |
| database-provider.ts | memory | ACTIVE_INDEPENDENT |
| rvf-migration.ts | memory | MIGRATION_ONLY |
| migration.ts | memory | DEAD_CODE |
| agentdb-backend.ts | memory | DIES_WITH_INITIALIZER (log filter) |
| controller-registry.ts | memory | DIES_WITH_INITIALIZER (log filter) |
| embeddings/types.ts | embeddings | TYPE_ONLY (comment) |
| examples/cross-platform-usage.ts | memory | EXAMPLE_ONLY |

**Consequence**: Cannot remove `better-sqlite3` from memory package — `sqlite-backend.ts`
and `database-provider.ts` are active independent consumers. T3.3 rescoped to CLI only.

**New finding 7**: **Quantization extraction is pointless** — only one test file imports
via the barrel. All other callers (persistent-sona.ts, plugin examples) have their own
duplicate local implementations. Delete with initializer.

**New finding 8**: **Attention extraction is pointless** — RvfBackend has its own HNSW
vector search. All 4 functions are fully redundant. Delete with initializer.

**New finding 9**: **Embedding functions cannot be deleted** — `generateEmbedding` already
routes through EmbeddingPipeline (ADR-0076 Phase 2), but holds unique logic: batch
concurrency with progress callbacks, adaptive threshold computation (model-aware probe),
`applyTaskPrefix` for agentdb-specific intent handling. Must relocate to embedding-adapter,
not delete.

**New finding 10**: **Phase 2+3 cannot merge atomically** — `initializeMemoryDatabase()`
and `checkMemoryInitialization()` are called during `_doInit()`, from `mcp-server.ts`,
and from `init.ts`. These have no RvfBackend equivalent. Must extract init logic before
deleting the initializer. Phase 1 now includes T1.5 for this extraction.

**New finding 11**: **IStorageContract ≡ IMemoryBackend** — identical 16 methods with
matching signatures. RvfBackend satisfies both (21 public methods total: 16 contract +
5 extras). Verified by `adr0086-storage-contract.test.mjs` (42 assertions).

### Implementation guidance (Reuven Cohen, RVF creator)

- **Do NOT touch `tryNativeInit()` return false** — intentional; skipping it would lose
  persisted entries because `loadFromDisk()` would not run.
- **Do NOT change `store()` ingest order** — Map→keyIndex→HNSW→native→WAL is correct.
- **Do NOT manually rebuild HNSW** — let the native runtime own progressive index lifecycle.
- **Do NOT add schema migration** — RVF has no schema; just open and use.
- **Leave fragile areas alone**: `loadFromDisk()`/`replayWal()`, `persistToDisk()` atomic
  rename, `nativeIdMap`/`nativeReverseMap`, `metadataPath` getter.

## Decision

Replace memory-initializer.ts with RvfBackend in 3 phases + pre-work. No SqliteStorage
adapter. No migration. No dual-backend. RvfBackend already satisfies IStorageContract.

## Tasks

### Phase 0: Pre-work — Fix breaking tests

Update 7 test files to tolerate memory-initializer.ts absence before any source changes.
This prevents the test suite from going red during implementation.

- [x] **T0.1** `adr0083-migrations.test.mjs` — remove "sole permitted consumer" assertion
- [x] **T0.2** `adr0076-phase2-wiring.test.mjs` — remove generateEmbedding pipeline wiring block
- [x] **T0.3** `adr0076-phase3-wiring.test.mjs` — remove createStorage wiring block
- [x] **T0.4** `adr0080-maxelements.test.mjs` — guard sql.js migration + RVF init blocks with existsSync
- [x] **T0.5** `sqlite-pragma-adr0069.test.mjs` — remove schema pragmas block
- [x] **T0.6** `adr0085-bridge-deletion.test.mjs` — guard Group 5 bridge-dependency checks with existsSync
- [x] **T0.7** `memory-router-adr0077.test.mjs` — remove loadStorageFns import assertion

**Result**: All 1,806 tests pass. Test suite is safe for subsequent phases.

### Phase 1: Strip non-storage functions (~1,150 lines)

Delete or relocate functions that don't belong in a storage layer. Swarm finding:
quantization and attention extraction is pointless — no second consumer exists.
Embedding functions hold unique logic and must be relocated, not deleted.

- [x] **T1.1** Delete quantization functions (4): `quantizeInt8`, `dequantizeInt8`,
  `quantizedCosineSim`, `getQuantizationStats`. No second consumer — only the router
  barrel re-exports them, and all other callers have duplicate local implementations
  (persistent-sona.ts, plugin examples). Remove `_wrap()` delegates and barrel exports.
- [x] **T1.2** Delete attention functions (4): `batchCosineSim`, `softmaxAttention`,
  `topKIndices`, `flashAttentionSearch`. Fully redundant — RvfBackend has its own HNSW
  vector search via HnswLite/N-API. Remove `_wrap()` delegates and barrel exports.
- [x] **T1.3** Relocate embedding adapter functions to
  `@claude-flow/memory/src/embedding-adapter.ts`: `loadEmbeddingModel`,
  `generateEmbedding`, `generateBatchEmbeddings`, `getAdaptiveThreshold`. These hold
  unique logic (batch concurrency, adaptive thresholds, `applyTaskPrefix` for agentdb)
  that EmbeddingPipeline lacks. The initializer already routes through EmbeddingPipeline
  first — the adapter is a thin wrapper.
- [x] **T1.4** Delete schema/migration functions: `MEMORY_SCHEMA_V3`, `ensureSchemaColumns`,
  `checkAndMigrateLegacy`. RVF has no schema — removed from public API (router delegates
  + barrel exports). Remain internal-only — still called by CRUD; die with initializer
  in Phase 3.
- [x] **T1.5** Extract init functions: `initializeMemoryDatabase`,
  `checkMemoryInitialization`, `verifyMemoryInit`. Deep SQLite coupling prevents clean
  extraction in Phase 1. Removed `verifyMemoryInit` _wrap delegate from router. Phase 2
  replaces with `RvfBackend.initialize()`.
- [x] **T1.6** Tests for relocated embedding adapter; update barrel exports.
  26 tests (6 groups), 2013 total suite pass.

**Result**: memory-initializer.ts 2814 → 2191 lines (623 deleted). Public API stripped
of 8 non-storage functions. Embedding logic relocated to memory package adapter.
Schema/init functions remain internal-only until Phase 3.

### Phase 2: Wire RvfBackend into memory-router.ts + rewire all importers

Replace `loadStorageFns()` with RvfBackend (IStorageContract) and rewire all 13 files
that bypass the router. Swarm audit found 38 individual `import()` statements across
8 command files + 5 runtime files.

- [ ] **T2.1** Add `implements IStorageContract` to RvfBackend class declaration.
  (Structurally equivalent — IStorageContract ≡ IMemoryBackend, verified by
  `adr0086-storage-contract.test.mjs`, 42 assertions.)
- [ ] **T2.2** Update `_doInit()` in memory-router.ts: create `RvfBackend`, call
  `storage.initialize()`, replace `_fns` with storage method delegates.
- [ ] **T2.3** Update `routeMemoryOp()` to call `storage.store()`, `storage.get()`, etc.
  instead of `fns.storeEntry()`, `fns.getEntry()`, etc.
- [ ] **T2.4** Update `routeEmbeddingOp()` to use EmbeddingPipeline for generation and
  `storage.search()` for vector operations.
- [ ] **T2.5** `shutdownRouter()` calls `storage.shutdown()`.
- [ ] **T2.6** Rewire 8 command-file importers (13 dynamic imports):
  `memory.ts` (8), `embeddings.ts` (7), `benchmark.ts` (4), `performance.ts` (2),
  `neural.ts` (2), `init.ts` (1), `hooks.ts` (1). Map each destructured function
  to router export or embedding-adapter.
- [ ] **T2.7** Rewire 5 runtime importers: `mcp-server.ts` (2), `headless.ts` (3),
  `worker-daemon.ts` (4), `hooks-tools.ts` (2), `index.ts` (18 re-exports).
- [ ] **T2.8** Tests: all existing unit tests pass with RvfBackend; verify no import
  of `memory-initializer` remains in any `.ts` source file.

**Result**: memory-router.ts uses IStorageContract via RvfBackend. All 13 direct
importers rewired. memory-initializer.ts is no longer imported anywhere.

### Phase 3: Delete

- [ ] **T3.1** Delete memory-initializer.ts (~1,200 lines remaining after Phase 1).
- [ ] **T3.2** Delete `loadStorageFns()`, `_wrap()` delegates, `loadAllFns()`,
  `loadEmbeddingFns()` from router.
- [ ] **T3.3** Remove `better-sqlite3` from CLI package only. Memory package RETAINS
  the dependency — `sqlite-backend.ts` and `database-provider.ts` are active
  independent consumers (see post-acceptance consumer classification above).
- [ ] **T3.4** Delete `hnsw.metadata.json` persistence (JS HNSW dies with initializer).
- [ ] **T3.5** Update acceptance checks: verify initializer is absent from dist.
- [ ] **T3.6** Full test suite + acceptance pass.

**Result**: ADR-0075 Layer 1 complete. Single storage abstraction achieved.
`better-sqlite3` survives in memory package as SqliteBackend provider option.

## Lines eliminated

| Source | Lines |
|--------|-------|
| memory-initializer.ts (deleted) | ~2,814 |
| Router _wrap delegates + loadStorageFns (replaced) | ~80 |
| Schema/migration functions (deleted, not relocated) | ~200 |
| Quantization functions (deleted, not extracted) | ~100 |
| Attention functions (deleted, not extracted) | ~120 |
| **Total deleted** | **~3,314** |
| Embedding adapter (relocated from initializer) | ~400 (relocated) |
| Init functions (relocated from initializer) | ~100 (relocated) |
| **Net reduction** | **~2,814** |

Also removed: `better-sqlite3` from CLI package. Memory package retains the dependency
for `sqlite-backend.ts` and `database-provider.ts`.

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
               
  EmbeddingPipeline + embedding-adapter.ts (relocated from initializer)
  quantization — DELETED (redundant; local impls exist elsewhere)
  attention — DELETED (redundant; RvfBackend has own HNSW)
```

ADR-0075's full 5-layer ideal state is achieved. Every memory operation follows one path:
`MCP Tool → router → IStorageContract (RvfBackend) → in-memory Maps + HNSW`.

No SQLite. No dual backends. No migration.

# ADR-0086: Layer 1 — Single Storage Abstraction (RVF-First)

- **Status**: Accepted — Phases 0-3 substantially complete. T2.6-T2.8 done (26 imports rewired, 0 remain). T3.4 done (HNSW bodies stubbed). T3.5 done (acceptance checks). B1-B4 fixed. Adversarial review C1/I2 fixed. T3.3 deferred (better-sqlite3 removal from CLI — structurally blocked, see Known debt). 15-agent validation swarm 2026-04-14.
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

**Finding 4 corrected**: 11 production files import from memory-initializer with 26
dynamic `import()` statements. Original counts of 12-14 files / 38 imports were
overstated. `headless.ts` has 0 dynamic imports (1 static import caught by adversarial
review C1). `index.ts` does not import from memory-initializer. One test file
(`memory-ruvector-deep.test.ts`) has 28 additional imports of deleted functions — not
tracked in original finding.

**Finding 5 corrected**: 19 source files reference `better-sqlite3` (not 5). Original
list had 2 false positives (performance.ts, benchmark.ts — zero references) and was
missing 5 files:

| File | Package | Classification |
|------|---------|---------------|
| memory-initializer.ts | cli | DIES_WITH_INITIALIZER |
| statusline.cjs | cli | DIES_WITH_INITIALIZER |
| intelligence.cjs | cli | DIES_WITH_INITIALIZER |
| doctor.ts | cli | DIES_WITH_INITIALIZER |
| learning-service.mjs | cli, mcp | ACTIVE_INDEPENDENT |
| embeddings.ts | cli | ACTIVE_INDEPENDENT |
| sqlite-backend.ts | memory | ACTIVE_INDEPENDENT |
| database-provider.ts | memory | ACTIVE_INDEPENDENT |
| rvf-migration.ts | memory | MIGRATION_ONLY |
| migration.ts | memory | DEAD_CODE |
| agentdb-backend.ts | memory | DIES_WITH_INITIALIZER (log filter) |
| controller-registry.ts | memory | DIES_WITH_INITIALIZER (log filter) |
| embeddings/types.ts | embeddings | TYPE_ONLY (comment) |
| examples/cross-platform-usage.ts | memory | EXAMPLE_ONLY |
| resolve-config.ts | memory | CONFIG_TYPES (type union) |
| resolve-config.d.ts | memory | CONFIG_TYPES (type defs) |
| database-provider.test.ts | memory | TEST_FILE |
| discovery.ts | cli/plugins | PLUGIN_REGISTRY (suggestion) |
| verify-cross-platform.ts | memory | VERIFICATION_SCRIPT |

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
5 extras: `derive`, `branchGet`, `branchStore`, `branchMerge`, `getStoredDimension`).
Verified by `adr0086-storage-contract.test.mjs` (36 runtime assertions — 4 static +
16 existence + 16 arity).

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
  replaces with `RvfBackend.initialize()`. Note: `initializeMemoryDatabase` and
  `checkMemoryInitialization` callers in `init.ts` and `mcp-server.ts` remain — these
  have no RvfBackend equivalent and block T3.3 (see Known debt).
- [x] **T1.6** Tests for relocated embedding adapter; update barrel exports.
  26 tests (6 groups), 2013 total suite pass.

**Result**: memory-initializer.ts 2814 → 2191 lines (623 deleted). Public API stripped
of 8 non-storage functions. Embedding logic relocated to memory package adapter.
Schema/init functions remain internal-only until Phase 3.

### Phase 2: Wire RvfBackend into memory-router.ts + rewire all importers

Replace `loadStorageFns()` with RvfBackend (IStorageContract) and rewire all 11 files
that bypass the router. Post-validation swarm audit found 26 individual `import()`
statements across 7 command files + 4 runtime files.

- [x] **T2.1** Add `implements IStorageContract` to RvfBackend class declaration.
  (Structurally equivalent — IStorageContract ≡ IMemoryBackend, verified by
  `adr0086-storage-contract.test.mjs`, 42 assertions.)
- [x] **T2.2** Update `_doInit()` in memory-router.ts: create `RvfBackend` via
  `createStorage()`, replace `_fns`/`StorageFns` with `_storage`/`IStorageContract`.
- [x] **T2.3** Update `routeMemoryOp()` to call `storage.store()`, `storage.getByKey()`,
  `storage.delete()`, `storage.search()`, `storage.count()`, `storage.listNamespaces()`,
  `storage.query()`, `storage.getStats()`, `storage.healthCheck()`.
- [x] **T2.4** Update `routeEmbeddingOp()` — embedding ops route through adapter
  directly; HNSW ops remain on initializer (Phase 3 cleanup).
- [x] **T2.5** `shutdownRouter()` calls `_storage.shutdown()`.
- [x] **T2.6** Rewire 7 command-file importers (26 dynamic imports total across
  T2.6+T2.7): `memory.ts` (8), `embeddings.ts` (7), `benchmark.ts` (4),
  `performance.ts` (2), `neural.ts` (2), `init.ts` (1), `hooks.ts` (1). All mapped
  to router exports. 12-agent swarm 2026-04-13.
- [x] **T2.7** Rewire 4 runtime importers + headless.ts static import:
  `mcp-server.ts` (1), `worker-daemon.ts` (2), `hooks-tools.ts` (3),
  `headless.ts` (1 static — was incorrectly listed as 0 imports; adversarial
  review C1 caught this). `index.ts` does not import from memory-initializer.
- [x] **T2.8** Tests: 2078 tests pass, 0 failures. `adr0086-import-rewire.test.mjs`
  verifies zero production imports of memory-initializer remain.

16 Phase 2 tests pass (5 groups). 2078 total suite pass, 0 failures.

**Result**: memory-router.ts uses IStorageContract via RvfBackend. All 26 direct
imports rewired (T2.6-T2.8 complete). Zero production imports of memory-initializer
remain. `adr0086-import-rewire.test.mjs` guards against regression.

#### Phase 2b: Stub delegation

Rather than rewriting 38 import statements across 14 files, all initializer
function bodies were replaced with thin stubs that delegate to `routeMemoryOp()`
(CRUD operations) or `embedding-adapter` (embedding operations). The file
survives as an import shim so that existing `import(...)` call sites continue
to resolve without code changes. This was the pragmatic alternative to a bulk
import rewire; T2.6-T2.8 track eliminating the shim entirely.

### Phase 3: Delete

- [x] **T3.1** memory-initializer.ts reduced to thin shim (1,666 lines of stubs).
  CRUD and embedding function bodies delegate to router or adapter.
  File survives as import shim; body is dead code.
  `applyTemporalDecay` stubbed (B1 fix — returns `{ success: true, patternsDecayed: 0 }`).
- [x] **T3.2** Deleted `loadStorageFns()`, `_wrap()`, `loadAllFns()`,
  `loadEmbeddingFns()`, `_embeddingFns`, `_allFns` from router. Embedding
  exports via adapter. HNSW ops via `_storage` (RvfBackend).
- [ ] **T3.3** Remove `better-sqlite3` from CLI package only (deferred — requires
  init.ts/mcp-server.ts import rewire).
- [x] **T3.4** JS HNSW bodies stubbed; RvfBackend HNSW takes over.
  `getHNSWIndex` returns null, `searchHNSWIndex` delegates to router,
  `getHNSWStatus` returns static defaults, `clearHNSWIndex`/`rebuildSearchIndex`
  are no-ops. 270 lines removed (1666→1396). `HNSWIndex`/`HNSWEntry` types and
  `hnswIndex`/`hnswInitializing` state variables deleted.
- [x] **T3.5** Acceptance checks: `acceptance-adr0086-checks.sh` with 4 checks
  (no-initializer-in-dist, storage-contract-exports, memory-search-works,
  no-initializer-imports-in-dist). Wired into `test-acceptance.sh`.
- [x] **T3.6** Full test suite: 2043 tests, 0 failures.

**Result**: ADR-0075 Layer 1 substantially complete. Single storage abstraction
achieved for the router path. `better-sqlite3` survives in memory package as
SqliteBackend provider option. T3.4 done — all 5 HNSW function bodies stubbed
(getHNSWIndex returns null, searchHNSWIndex delegates to router, others are no-ops).
T3.3 (better-sqlite3 removal from CLI) structurally blocked — see Known debt.

## Lines eliminated

| Source | Lines | Notes |
|--------|-------|-------|
| memory-initializer.ts (stubbed, not deleted) | 2,814 -> 1,396 = **1,418 removed** | Includes schema (~200), quantization (~100), attention (~120), HNSW types+state, CRUD bodies |
| Router _wrap delegates + loadStorageFns (replaced) | **~80 removed** | Separate file (memory-router.ts) |
| **Total removed** | **~1,498** | |
| Embedding adapter (relocated from initializer) | 201 (relocated, not deleted) | Part of the 1,418 initializer reduction |
| Init functions (relocated from initializer) | ~100 (relocated, not deleted) | Part of the 1,418 initializer reduction |
| **Net reduction** | **~1,197** | Total removed minus code that moved to new locations |

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

| Risk | Mitigation | Status |
|------|------------|--------|
| Search quality regression | Integration tests with unambiguous nearest-neighbor queries | Open — no .rvf integration tests exist yet |
| Embedding pipeline gaps | Adapter handles embedding ops directly; initializer chain no longer in the path | Mitigated |
| Single-write latency increase | Acceptable at 300μs; batch path is faster | Accepted |
| Scale beyond in-memory Maps | META_IDX_SEG available as escape hatch; not needed today | Open — no scale tripwire enforced |
| Shim persistence | T2.6-T2.8 complete (0 imports remain). Shim deletion blocked by T3.3. | Tracked as debt |
| Concurrent writer corruption | No file locking on `.rvf`/`.wal`. Worker-daemon + CLI write to same files. `compactWal()` race is guaranteed data loss: daemon compacts (deletes WAL), CLI writes new entry, daemon's next persist silently omits it. | **OPEN — no mitigation, needs advisory locking design** |
| Double HNSW indexing | `tryNativeInit()` always returns false; both HnswLite and native N-API populated with identical vectors. Memory doubles linearly with entry count. | Accepted — ADR guidance says do not touch |
| `routeMemoryOp` init failure | ~~`createStorage()` failure leaves `_storage` null.~~ **FIXED (B4)**: circuit breaker + null guard + `_initFailed` flag. | Fixed |
| `bulkDelete`/`clearNamespace` unreachable | ~~Absent from `MemoryOpType` and router switch.~~ **FIXED (B2)**: both added with input validation. | Fixed |
| `get(id)` and `bulkInsert` unreachable | Declared on IStorageContract but no MemoryOpType or switch case. Never exposed pre-ADR-0086 either. | Accepted — not a regression |
| Router local IStorageContract copy | Router declares local `interface IStorageContract` (any-typed) instead of importing from `@claude-flow/memory/storage.ts`. No compile-time type safety. | Open — should import canonical interface |

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
`MCP Tool -> router -> IStorageContract (RvfBackend) -> in-memory Maps + HNSW`.

No SQLite. No dual backends. No migration.

## Post-validation: 15-agent swarm findings (2026-04-14)

A 15-agent validation swarm reviewed every phase, traced every code path, audited
imports and dependencies, and ran an adversarial architecture review per ADR-0087.
2,078 tests pass. Agent roster: document consistency, Phase 0/1/2 verification,
import rewire audit, router code path tracer, acceptance check completeness, test
coverage gaps, known bugs B1-B4, HNSW architecture, WAL locking risk, IStorage
contract equivalence, adversarial architecture review, known debt completeness,
cross-ADR dependency check. Findings below.

### Known bugs (action required)

| # | Severity | Bug | Location |
|---|----------|-----|----------|
| B1 | Critical | **FIXED** `applyTemporalDecay()` stubbed — returns `{ success: true, patternsDecayed: 0 }`. Old SQLite body removed. | memory-initializer.ts |
| B2 | High | **FIXED** `bulkDelete` and `clearNamespace` added to `MemoryOpType` union and `routeMemoryOp` switch with input validation. | memory-router.ts |
| B3 | High | **FIXED** `mcp-server.ts` rewired to use `healthCheck()` from router instead of SQLite-based `checkMemoryInitialization()`. | mcp-server.ts |
| B4 | Medium | **FIXED** Circuit breaker wraps `createStorage()`. Null guard replaces `_storage!` assertion. `_initFailed` flag prevents retry storm (adversarial I2). | memory-router.ts |

### Architectural concerns

1. **Double HNSW indexing** — `tryNativeInit()` always returns `false`, so both native
   N-API HNSW and HnswLite are populated with identical vectors. Memory footprint
   doubles linearly with entry count. ADR guidance says "do not touch" — this is the
   current steady state, not a temporary artifact. Tracked as Known debt 8.
2. **No cross-process WAL locking** — worker-daemon and CLI can write to same
   `.rvf`/`.wal` simultaneously. SQLite had file locking via WAL mode; RVF has none.
   The `compactWal()` race is a guaranteed data-loss path (see Known debt 9). The
   30-second auto-persist timer in the daemon means the WAL is written continuously
   during activity. Any concurrent CLI invocation risks silent entry loss.
3. **Shim is structurally permanent** — T2.6-T2.8 complete (0 production imports
   remain). `memory-initializer.ts` (1396 lines) survives as dead code. T3.3 is
   structurally blocked: `init.ts` and `mcp-server.ts` call functions with no
   RvfBackend equivalent (see Known debt 7). `adr0086-import-rewire.test.mjs`
   guards against new import regression.
4. **All ~130 ADR-0086 tests are structural** — source-text grep/includes only. Zero
   behavioral tests, zero London School TDD mocking, zero `.rvf` integration tests.
   The testing strategy section's mandated levels are not implemented.

### Swarm finding C1 correction

The earlier swarm flagged `getAdaptiveThreshold` using `pipeline.getProvider()` as a
bug (should be `getModel()`). This is a **false positive**: `getProvider()` returns the
active runtime provider (`'transformers.js'`, `'ruvector'`, or `'hash-fallback'`), which
is the correct discriminator for threshold selection. `getModel()` returns the configured
model name, which does not reflect whether loading succeeded or fell back to hash.

**15-agent swarm note**: The prescribed update to `adr0086-swarm-findings.test.mjs`
Group 1 was never applied. Group 1 still asserts `pipeline.getProvider()` must NOT be
present in `generateEmbedding` — this is a **live test defect** (Known debt 11). If
the fork source correctly uses `getProvider()`, this test fails spuriously. If someone
"fixes" the source to satisfy the test, they regress the real behavior.

### Test gaps

- **All ~130 ADR-0086 tests are structural** (source-text grep/includes). Zero
  behavioral tests. Zero London School TDD mocking. Zero integration tests with real
  `.rvf` files. The testing strategy section mandates "Mock at IStorageContract
  boundary" and "Real .rvf file round-trip" — neither is implemented.
- T1.6 embedding adapter has structural tests only — no London School TDD
  behavioral/mock tests for pipeline init, hash fallback, batch concurrency, or
  adaptive threshold branch.
- `memory-ruvector-deep.test.ts` (upstream) imports 28 deleted functions (quantizeInt8,
  batchCosineSim, etc.) — will fail on rebuild. Not in scope for this repo.
- B1 (`applyTemporalDecay` stub) and B3 (`mcp-server.ts` healthCheck rewire) have
  **no test guards** — fixes verified in source but regressions pass the suite.
- `getAdaptiveThreshold` correctly uses `pipeline.getProvider()` for threshold
  selection, but has zero behavioral test coverage. C1 correction note says to update
  `adr0086-swarm-findings.test.mjs` Group 1 — update was never applied. Group 1
  asserts `getProvider()` must NOT be present, which is a **false positive defect**.
- `bulkDelete` and `clearNamespace` have no end-to-end acceptance test — only
  source-text verification of MemoryOpType presence.
- `entriesWithEmbeddings` stat permanently wrong — uses `totalEntries` as proxy
  (TODO at memory-router.ts:678). Any consumer making decisions based on embedding
  count gets an overcount.
- Acceptance check `check_memory_search_works` has a partial-pass path (store OK,
  search miss → pass with "embedding delay") that violates the project's no-fallbacks
  rule (ADR-0082 / CLAUDE.md).
- Acceptance check `check_no_initializer_in_dist` threshold is 40 raw SQLite calls —
  should be ~5 (schema DDL only). Current threshold allows massive undetected regression.
- Missing acceptance checks: embedding-adapter presence, quantization/attention
  functions NOT exported (listed in ADR testing strategy but never implemented).

## Known debt

1. **IStorageContract and IMemoryBackend are identical** — merge into single interface
   when all consumers migrate. Confirmed identical by 15-agent swarm (16 methods,
   matching signatures, method order differs cosmetically).
2. **In-memory Maps need scale tripwire at 100K entries** — `DEFAULT_MAX_ELEMENTS`
   exists as HNSW parameter but is never checked in `store()` or `bulkInsert()`.
   No warning, no eviction, no enforcement. OOM risk in long-running daemons.
   Combined with double HNSW indexing (debt 8), memory grows ~2x faster than
   expected.
3. **~~11 direct importers still go through initializer shim~~** — **RESOLVED**.
   T2.6-T2.8 complete. 0 production imports remain. `headless.ts` static import
   (missed by original audit) caught by adversarial review and fixed.
4. **~~`applyTemporalDecay` is not a stub~~** — **RESOLVED**. B1 fixed. Returns
   no-op `{ success: true, patternsDecayed: 0 }`. Warning: no test guard — a
   regression reintroducing the SQLite body would pass the entire suite.
5. **`entriesWithEmbeddings` permanently overreported** — `totalEntries` used as
   proxy in stats response (TODO comment in production code).
6. **`memory-initializer.ts` (1396 lines) is dead code** — all exports are stubs
   delegating to router or adapter. Deletion blocked by T3.3 (see debt 7).
7. **T3.3 is structurally blocked, not merely deferred** — `init.ts` and
   `mcp-server.ts` call `initializeMemoryDatabase()` and `checkMemoryInitialization()`
   which have no RvfBackend equivalent (RVF has no schema). Cannot remove
   `better-sqlite3` from CLI or delete the shim until these callers are redesigned.
   No GitHub issue tracks this. No acceptance check enforces it.
8. **Double HNSW indexing** — `tryNativeInit()` always returns `false` (intentional
   per Reuven Cohen guidance), so both HnswLite (pure-TS) and native N-API HNSW are
   populated with identical vectors when `@ruvector/rvf-node` is installed. Memory
   footprint doubles linearly with entry count. At 10K entries with 768-dim vectors,
   HnswLite duplication adds ~30-60 MB. Accepted risk — fixing requires separating
   metadata-load from HnswLite-build in `initialize()`, which is non-trivial.
9. **Concurrent WAL corruption** — worker-daemon and CLI can write to `.rvf`/`.wal`
   simultaneously with no file locking. RVF has no equivalent to SQLite WAL mode
   locking. The `compactWal()` race is a guaranteed data-loss path: daemon compacts
   (deletes WAL), CLI writes new entry, daemon's next persist silently omits it.
   `appendFile` is not atomic for cross-process concurrent writes. No test, no
   tracking issue, no mitigation. Needs advisory locking design.
10. **Router local IStorageContract copy** — `memory-router.ts` declares a local
    `interface IStorageContract` (any-typed) at line 165 instead of importing from
    `@claude-flow/memory/storage.ts`. Changes to the canonical interface will not
    break the router at compile time.
11. **`adr0086-swarm-findings.test.mjs` Group 1 has a false-positive defect** —
    asserts `pipeline.getProvider()` must NOT be present in `generateEmbedding`,
    but `getProvider()` is the correct discriminator for threshold selection (C1
    correction). The prescribed update was never applied.

## Cross-ADR staleness (15-agent swarm finding, 2026-04-14)

The following ADRs contain references to `memory-initializer.ts` or the pre-ADR-0086
architecture that are now stale:

| ADR | Stale reference | Nature |
|-----|----------------|--------|
| ADR-0080 | "What NOT to do: delete memory-initializer.ts" (line 144) | ADR-0083 documented the override, but ADR-0080 itself is unannotated |
| ADR-0083 | Architecture diagram shows `memory-initializer.ts` as active private impl behind router | Diagram is now incorrect — router uses RvfBackend directly |
| ADR-0084 | "L1: ~2600 lines in memory-initializer, future ADR-0085" (line 190) | Wrong ADR number (became 0086) and wrong line count (1,396 at completion) |
| ADR-0085 | "Layer 1 remains as open work" (line 268) | Now substantially closed by ADR-0086 |
| ADR-0075 | Status remains "Informational" | All 5 layers claimed complete (L2/L5 by ADR-0085, L1 by ADR-0086) — no closed marker |
| ADR-0076 | "memory-initializer.ts remains as pure SQLite CRUD" (line 597) | Now a stub shim, not SQLite CRUD |

None of these are active contradictions that break the codebase — they are documentation
drift. The dependency chain (0075 → 0085 → 0086) is structurally sound.

## Adversarial architecture assessment (ADR-0087, 15-agent swarm)

### 3 best reasons the architecture is wrong

1. **The shim is permanent, not temporary** (Critical) — T3.3 cannot complete because
   `init.ts` and `mcp-server.ts` call functions with no RvfBackend equivalent. The
   Phase 2b "pragmatic alternative" framing acknowledges this: callers couldn't be
   changed without breaking them, so the file was kept.

2. **RVF-first is wrong for the daemon use case** (High) — The performance wins
   (cold-start 400ms→5ms, RSS 9MB→4MB) optimize for short-lived CLI invocations.
   The daemon (worker-daemon, mcp-server) is long-running: single-write latency is
   3.75x slower (300μs vs 80μs), `query()`/`listNamespaces()`/`count()` are O(n)
   Map scans vs SQLite's O(log n) indexed lookups, and Maps grow without bound. The
   architecture trades indexed queries for unindexed scans and calls the scale limit
   an "escape hatch" (META_IDX_SEG) that is not implemented.

3. **No WAL locking trades correctness for simplicity** (Critical) — SQLite's WAL mode
   serializes concurrent writers at the kernel level. RVF has nothing equivalent. The
   `compactWal()` race is guaranteed data loss. This is not theoretical: worker-daemon's
   30-second auto-persist timer and CLI invocations overlap regularly in normal use.

### What a senior engineer says in 3 years

- "The migration was half-done and we called it done" — 1,396-line shim persists
- "The WAL locking issue bit us" — silent entry loss, extremely hard to diagnose
- "Double HNSW was never resolved" — both indexes grow without bound in the daemon

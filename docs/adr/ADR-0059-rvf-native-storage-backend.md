# ADR-0059: RVF Native Storage Backend (Patch-Level Implementation)

**Status**: Proposed
**Date**: 2026-04-03
**Deciders**: ruflo-patch maintainers
**Methodology**: SPARC + hive-mind analysis (4 experts, collective synthesis)
**Upstream ADR**: upstream:ADR-057 (RVF Native Storage, status: Proposed)

---

## S - Specification

### Problem

The P0 bridge bug documented in ADR-0058 prevents the JSON cache from draining into AgentDB. The root cause is `auto-memory-hook.mjs` line 235: `createBackend("hybrid")` instantiates `AgentDBBackend`, which targets `.swarm/agentdb-memory.rvf`. `AgentDBBackend` internally requires the full AgentDB stack (SQLite + sql.js + embedding service + controller registry), and when any piece fails to initialize, it silently degrades to an in-memory store. The drain writes to RAM, the process exits, data is lost.

Upstream ADR-057 proposes replacing SQLite with RVF for all AgentDB storage. Our analysis finds this is a misframing of what has actually been built. The correct reframing:

> **RVF handles vectors + key-value storage. SQLite keeps relational data.**

The hybrid architecture is already the design. The gap is in the **session/hook bridge layer** where `AgentDBBackend` (which pulls in the entire 18MB sql.js stack) should be swapped for `RvfBackend` or `SqlJsRvfBackend` (which are self-contained vector stores that create `.rvf` files directly).

### What Exists (Upstream Code Audit)

| Component | File | Lines | Status |
|-----------|------|------:|--------|
| **RvfBackend** (native N-API + WASM) | `packages/agentdb/src/backends/rvf/RvfBackend.ts` | 695 | Complete |
| **SqlJsRvfBackend** (zero-dep fallback) | `packages/agentdb/src/backends/rvf/SqlJsRvfBackend.ts` | ~400 | Complete |
| **SelfLearningRvfBackend** | `packages/agentdb/src/backends/rvf/SelfLearningRvfBackend.ts` | 414 | Complete |
| **Backend factory** | `packages/agentdb/src/backends/factory.ts` | 411 | Complete, selects RVF |
| **RVF SDK** (`@ruvector/rvf`) | `ruvector/npm/packages/rvf/src/` | ~800 | Complete, published |
| **NodeBackend** (NAPI wrapper) | `ruvector/npm/packages/rvf/src/backend.ts` | 790 | Complete |
| **WasmBackend** (browser) | same file | (included) | Complete |
| **RvfDatabase** (user-facing API) | `ruvector/npm/packages/rvf/src/database.ts` | 291 | Complete |
| **db-unified.ts** (mode selector) | `packages/agentdb/src/db-unified.ts` | ~250 | Complete, not adopted by MCP |
| **FilterBuilder** | `packages/agentdb/src/backends/rvf/FilterBuilder.ts` | ~200 | Complete |
| **ID mapping sidecar** | NodeBackend internal | (included) | Complete |

**Key finding**: RVF is ~85% implemented in upstream code. The missing piece is not code -- it is wiring. The existing `RvfBackend` and `SqlJsRvfBackend` are not used by the hook bridge that controls the session drain path.

### What RVF Cannot Replace

SQLite serves 24 tables with JOINs, foreign keys, recursive CTEs, triggers, and 1,085 SQL occurrences across 81 files in the agentdb package. These are:

- `episodes`, `skills`, `causal_edges` (with foreign keys)
- `reflexion_sessions`, `reflexion_entries` (with recursive CTEs)
- `nightly_learner_insights`, `consolidation_log` (with triggers)
- Migration tracking, session state, hierarchical memory

RVF is a vector container with HNSW indexing and metadata filtering. It has no SQL engine, no JOINs, no triggers. Replacing SQLite for relational data would require rewriting the entire agentdb controller layer.

### Quality Attributes

| Attribute | Requirement |
|-----------|-------------|
| Correctness | Bridge drain creates `.rvf` files that persist across sessions |
| Backward compatibility | Existing `.db` files continue working unchanged |
| Size reduction | Hook bridge does not pull in 18MB sql.js for vector-only operations |
| Failure transparency | No silent degradation to in-memory stores |

---

## P - Pseudocode (Design)

### Minimal fix (Phase 1): Wire RvfBackend into the bridge

```
# In auto-memory-hook.mjs createBackend():
# BEFORE:
new memPkg.AgentDBBackend({
  dbPath: join(swarmDir, 'agentdb-memory.rvf'),
  vectorBackend: config.agentdb.vectorBackend || 'auto',
  enableLearning: config.agentdb.enableLearning !== false,
})

# AFTER:
# Try SqlJsRvfBackend first (always available, creates .rvf files)
# Fall back to JsonFileBackend if even that fails
if (memPkg.SqlJsRvfBackend) {
  backend = new memPkg.SqlJsRvfBackend({
    dimension: config.agentdb?.vectorDimension || 384,
    storagePath: join(swarmDir, 'agentdb-memory.rvf'),
    metric: 'cosine',
  })
  await backend.initialize()
  return { backend, isRvf: true }
}
# else: fall through to AgentDBBackend with better error handling
```

### Phase 2: Adapter (RvfBackend as IMemoryBackend)

The hook bridge expects `IMemoryBackend` (store/get/query/delete/shutdown). `RvfBackend` implements `VectorBackendAsync` (insert/search/remove/close). An adapter bridges the interface gap:

```
class RvfMemoryAdapter implements IMemoryBackend {
  constructor(private rvf: VectorBackendAsync, private embeddingFn) {}

  async store(entry) {
    const vector = await this.embeddingFn(entry.content)
    await this.rvf.insert(entry.id, vector, entry.metadata)
  }

  async query(options) {
    if (options.type === 'semantic') {
      const vector = await this.embeddingFn(options.query)
      return this.rvf.search(vector, options.limit)
    }
    // Structured queries fall back to metadata filtering
    return this.rvf.search(zeroVector, options.limit, { filter: options.filter })
  }

  async get(id) { return this.rvf.getById(id) }
  async delete(id) { await this.rvf.remove(id) }
  async shutdown() { await this.rvf.close() }
}
```

### Phase 3: MCP server adoption (ADR-0056 completion)

Wire `db-unified.ts` into `agentdb-mcp-server.ts` as designed in ADR-0056. This is independent of the bridge fix but completes the RVF adoption across all consumers.

---

## A - Architecture

### Current state (broken drain)

```
Hook subprocess (CJS)
    |
    v
auto-memory-hook.mjs
    |
    v createBackend("hybrid")
    |
    v new AgentDBBackend({ dbPath: .rvf })
    |
    v Pulls full AgentDB stack (sql.js 18MB + embedder + controllers)
    |
    v Init fails silently -> degrades to in-memory
    |
    v Drain writes to RAM -> process exits -> data lost
    |
    ====== NEVER REACHES DISK ======
```

### Target state (Phase 1)

```
Hook subprocess (CJS)
    |
    v
auto-memory-hook.mjs
    |
    v createBackend("hybrid")
    |
    v new SqlJsRvfBackend({ dimension: 384, storagePath: .rvf })
    |
    v Creates .swarm/agentdb-memory.rvf on first write
    |
    v Vectors stored with HNSW indexing
    |
    v .rvf file persists across sessions
    |
    ====== DATA REACHES DISK ======
```

### Target state (Phase 2+)

```
Hook subprocess                       CLI / MCP server
    |                                      |
    v                                      v
auto-memory-hook.mjs               agentdb-mcp-server.ts
    |                                      |
    v                                      v
RvfMemoryAdapter                    db-unified.ts
    |                                      |
    v                                      v
SqlJsRvfBackend                     SQLite (relational) + RvfBackend (vectors)
    |                                      |      |
    v                                      v      v
.swarm/agentdb-memory.rvf           .swarm/memory.db  .swarm/agentdb-memory.rvf
    (vectors + KV)                  (tables + JOINs)  (shared vector store)
```

### What changes per layer

| Layer | Before | After |
|-------|--------|-------|
| Hook bridge | AgentDBBackend -> silent fail -> RAM | SqlJsRvfBackend -> .rvf file |
| MCP server | db-fallback.js only | db-unified.ts (RVF primary, SQLite fallback) |
| CLI memory | HybridBackend with broken init | Same, but .rvf file now exists |
| Controllers | SQLite for everything | SQLite for relational, RVF for vectors |
| `@ruvector/rvf` | Unused by ruflo consumers | Used by bridge and MCP server |

---

## R - Refinement

### Phase 1: Bridge fix (patch-level, this repo)

**Scope**: 1 file, ~20 lines
**Risk**: Low (additive, fallback preserved)
**Fixes**: P0 bridge bug, unblocks entire WAL architecture

Files:
- `.claude/helpers/auto-memory-hook.mjs` -- swap AgentDBBackend for SqlJsRvfBackend in `createBackend()`

Implementation:
1. Try `memPkg.SqlJsRvfBackend` (exported from `@sparkleideas/memory`)
2. Initialize with `{ dimension: 384, storagePath: '.swarm/agentdb-memory.rvf', metric: 'cosine' }`
3. Wrap in adapter if IMemoryBackend interface is required
4. Fall back to current AgentDBBackend path if SqlJsRvfBackend not exported
5. Fall back to JsonFileBackend as last resort (existing behavior)

Validation:
- After `doImport()`, `.swarm/agentdb-memory.rvf` file exists on disk
- After `doSync()`, entries are retrievable from the `.rvf` file
- `memory search` via MCP returns entries that hooks wrote

### Phase 2: IMemoryBackend adapter (patch-level, this repo)

**Scope**: 1 new file (~80 lines), 1 edit
**Risk**: Low-Medium (new abstraction, but small surface)

Files:
- `tests/fixtures/memory/dist/rvf-memory-adapter.js` (new, adapter)
- `.claude/helpers/auto-memory-hook.mjs` (use adapter)

The adapter translates between:
- `IMemoryBackend.store(entry)` -> `VectorBackendAsync.insert(id, vector, metadata)`
- `IMemoryBackend.query({type:'semantic'})` -> `VectorBackendAsync.search(vector, k)`
- `IMemoryBackend.get(id)` -> metadata lookup from .rvf

### Phase 3: MCP server unification (fork-level, upstream PR)

**Scope**: ~245 lines (per ADR-0056)
**Risk**: Medium (changes MCP initialization, needs thorough testing)

This is ADR-0056 implementation -- already designed, just needs execution:
- Replace `db-fallback.js` import with `db-unified.ts`
- Wire vectorBackend into controller constructors
- Add branch tools (create, query, merge)

### Phase 4: Remove sql.js hard dependency (future, upstream only)

**Scope**: Large (cross-package dependency audit)
**Risk**: High (sql.js is used for 24 relational tables)
**Prerequisite**: Upstream ships all controller migrations to graph/KV model

This phase is NOT in scope for ruflo-patch. It requires upstream to redesign their relational storage layer, which is a fundamental architecture change.

### Risk assessment

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|------------|
| `SqlJsRvfBackend` not exported from `@sparkleideas/memory` | Medium | 1 | Check export, add if missing; fall back to JSON |
| `.rvf` format instability across `@ruvector/rvf` versions | Low | 1 | Pin exact version in our pipeline |
| Embedding dimension mismatch (384 vs 768 vs 1536) | Medium | 1 | Read from config.json `agentdb.vectorDimension`, default 384 |
| Silent degradation to brute-force when HNSW unavailable | Low | 1 | SqlJsRvfBackend uses SIMD brute-force by design -- acceptable for <10k vectors |
| IMemoryBackend.query() structured queries unsupported by RVF | Medium | 2 | Adapter falls back to metadata filter or returns empty |
| MCP server regression from db-unified switch | Medium | 3 | Wrap in try/catch, fall back to db-fallback.js |
| sql.js removal breaks 24 tables | Critical | 4 | Not in scope -- SQLite stays for relational data |

---

## C - Completion

### Implementation checklist

**Phase 1 (Bridge fix -- immediate)**
- [ ] Verify `SqlJsRvfBackend` is exported from `@sparkleideas/memory`
- [ ] Edit `auto-memory-hook.mjs` `createBackend()` to use `SqlJsRvfBackend`
- [ ] Add dimension config reading from `config.json`
- [ ] Test: `doImport()` creates `.swarm/agentdb-memory.rvf`
- [ ] Test: `doSync()` persists entries to `.rvf` file
- [ ] Test: entries survive process restart
- [ ] Run `npm test` (preflight + unit pass)
- [ ] Run `npm run test:verify` (acceptance pass)

**Phase 2 (Adapter -- next)**
- [ ] Write `RvfMemoryAdapter` implementing `IMemoryBackend`
- [ ] Wire adapter into `auto-memory-hook.mjs`
- [ ] Test: `memory search` returns entries written by hooks
- [ ] Test: `doImport()` + `doSync()` round-trip works

**Phase 3 (MCP server -- separate PR)**
- [ ] Implement ADR-0056 in agentic-flow fork
- [ ] Build and publish updated `@sparkleideas/agentdb`
- [ ] Run full acceptance suite

### Estimated effort

| Phase | Files | Lines | Risk |
|-------|:-----:|:-----:|------|
| 1: Bridge fix | 1 | ~20 | Low |
| 2: Adapter | 2 | ~100 | Low-Medium |
| 3: MCP server | 3 | ~245 | Medium |
| **Total (in scope)** | **6** | **~365** | |

### Success criteria

- `.swarm/agentdb-memory.rvf` file exists after first session
- JSON cache files drain into RVF at session-end (file sizes decrease)
- `memory search` via CLI/MCP returns entries from hooks
- No regression on existing acceptance tests
- sql.js not loaded by hook subprocess (18MB savings in hook process)

---

## Decision

**This is a patch-level change for Phase 1-2 and a fork-level change for Phase 3.**

Phase 1 (bridge fix) is the minimal intervention: swap one backend class in one file. It accidentally fixes the P0 bug because it creates the `.rvf` file that the rest of the architecture expects to exist. No upstream PR needed -- this is our hook file.

Phase 2 (adapter) is a small abstraction layer that makes the fix proper rather than expedient.

Phase 3 (MCP server) requires a fork-level change to `@sparkleideas/agentdb` and should be filed as a separate upstream PR.

Phase 4 (remove sql.js) is explicitly out of scope. RVF does not replace SQLite. It replaces SQLite **for vector storage only**. The 24 relational tables remain on SQLite until upstream designs an alternative.

---

## Consequences

### If Phase 1 applied

- P0 bridge bug fixed: JSON cache drains into RVF at session-end
- `.swarm/agentdb-memory.rvf` file created and populated
- The 8-file persistence sprawl reduces to 3 systems as designed in ADR-0058
- Hook subprocess no longer pulls in 18MB sql.js for vector operations
- Remaining JSON cache bugs become self-healing (drain empties the cache)

### If Phase 1 not applied

- Two permanent memory silos persist indefinitely
- `memory search` returns nothing useful (17 MCP entries vs 157 hook entries)
- Hooks inject context from stale, cross-project, duplicate-inflated JSON
- Architecture remains broken despite all code being present

### Relationship to other ADRs

| ADR | Relationship |
|-----|-------------|
| **ADR-0058** (Deep Analysis) | This ADR implements the P0 fix identified there |
| **ADR-0056** (MCP Unified Backend) | Phase 3 of this ADR completes ADR-0056 |
| **ADR-0054** (RuVector Pipeline) | Provides `@ruvector/rvf` packages this ADR depends on |
| **ADR-0052** (Embedding Config) | Provides dimension configuration used by RvfBackend |
| **upstream:ADR-057** (RVF Storage) | This ADR is our interpretation/implementation |
| **upstream:ADR-050** (Intelligence Loop) | Bridge fix restores the WAL pattern designed there |

## Related

- **ADR-0058**: Memory, Learning & Storage Deep Analysis -- root cause analysis
- **ADR-0056**: MCP Server Unified Backend -- Phase 3 of this implementation
- **ADR-0054**: RuVector Patch Pipeline -- dependency chain
- **GitHub issues**: P0 bridge bug (ADR-0058 section), upstream:ADR-057

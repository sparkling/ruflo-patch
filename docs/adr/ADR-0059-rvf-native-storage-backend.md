# ADR-0059: RVF Native Storage Backend (Patch-Level Implementation)

**Status**: Proposed
**Date**: 2026-04-03
**Updated**: 2026-04-04 (v3 — upstream intent confirmed, open questions resolved)
**Deciders**: ruflo-patch maintainers
**Methodology**: SPARC + hive-mind analysis (8 experts across 2 hives, collective synthesis)
**Upstream ADRs**: upstream-ruflo:ADR-057 (RVF replaces sql.js for vectors/KV), upstream-agentic:ADR-057 (Full SQLite + RuVector for AgentDB)

---

## S - Specification

### Problem

The P0 bridge bug documented in ADR-0058 prevents the JSON cache from draining into AgentDB. The root cause is `auto-memory-hook.mjs` line 235: `createBackend("hybrid")` instantiates `AgentDBBackend`, which targets `.swarm/agentdb-memory.rvf`. `AgentDBBackend` internally requires the full AgentDB stack (SQLite + sql.js + embedding service + controller registry), and when any piece fails to initialize, it silently degrades to an in-memory store. The drain writes to RAM, the process exits, data is lost.

There are **two upstream ADR-057 documents** in different repos with different scopes:

| Document | Repo | Scope | Intent |
|----------|------|-------|--------|
| **upstream-ruflo:ADR-057** | ruflo | `@claude-flow/memory`, `shared`, `embeddings` | Replace sql.js (18MB WASM) with RVF for 3 non-relational consumers |
| **upstream-agentic:ADR-057** | agentic-flow | AgentDB controllers | "Full SQLite + RuVector" — SQLite stays for relational data |

upstream-ruflo:ADR-057 analysed the three sql.js consumers (1,767 lines total): EventStore, SqlJsBackend, PersistentCache. These are KV stores with BLOB vectors — no JOINs, no CTEs, no triggers. RVF maps 1:1 to these. The ADR explicitly designs RVF as their replacement.

The 24 relational tables (episodes, skills, causal_edges, reflexion_sessions) are in the `agentdb` package (agentic-flow repo). upstream-agentic:ADR-057 says "Full SQLite + RuVector" — SQLite stays. Nobody proposed replacing those tables.

The correct architecture is:

> **RVF for vectors/KV/events (`@claude-flow/memory`). SQLite for relational data (`agentdb`).**

This is not our interpretation — it is the upstream design across both repos. The gap is in the **session/hook bridge layer** where `AgentDBBackend` (which pulls in the full SQLite + AgentDB controller stack) is used for what is fundamentally a vector-store operation. It should be `RvfBackend` or `SqlJsRvfBackend` (self-contained vector stores that create `.rvf` files directly).

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
| **upstream-ruflo:ADR-057** (RVF Storage) | Phase 1 implements this — swap sql.js consumers to RVF |
| **upstream-agentic:ADR-057** (Deep Integration) | Confirms SQLite stays for relational AgentDB tables |
| **upstream:ADR-050** (Intelligence Loop) | Bridge fix restores the WAL pattern designed there |

## Fork Dependency Audit (2026-04-04)

### Required fork changes (must exist for Phase 1)

| Change | File | Status |
|--------|------|--------|
| `RvfBackend` class | `@claude-flow/memory/src/rvf-backend.ts` | In place (hz fork) |
| `RvfBackend` exported | `@claude-flow/memory/src/index.ts` lines 196-197 | In place (hz fork) |
| `AutoMemoryBridge` class | `@claude-flow/memory/src/auto-memory-bridge.ts` | In place (hz fork) |

### Superseded fork changes

| Change | Why superseded |
|--------|---------------|
| WM-003 (AgentDBBackend-only) | Phase 1 replaces AgentDBBackend with RvfBackend in the same function WM-003 modified |

### Session commits (2026-04-03/04) — no conflicts

All 5 in-place session commits (dedup guard, config defaults, ControllerRegistry config, ruvector dep, memory-initializer cleanup) are independent of Phase 1. Four reverted commits (bridgeGenerateEmbedding rewrite, getBridge timeout, EmbeddingService prefixes) are already cleaned up.

`auto-memory-hook.mjs` was never modified this session — clean target for Phase 1.

## Resolved Questions (v3, 2026-04-04)

Questions raised in v2 have been resolved by a dedicated investigation hive (5 experts reading the full 1512-line upstream ADR, upstream code, upstream issues, and both repos' ADR-057 documents).

### Q1: Did the upstream author intend a full SQL replacement?

**No.** upstream-ruflo:ADR-057 targets three specific non-relational sql.js consumers (1,767 lines): EventStore, SqlJsBackend, PersistentCache. These use SQLite as a KV store with BLOB vectors — no JOINs, no CTEs, no triggers. The ADR does not mention AgentDB's 24 relational tables. "Phase 8: Remove sql.js" means demote to optional lazy-loaded dependency for legacy `.db` reads, not remove SQLite from all usage.

The agentic-flow repo's own ADR-057 explicitly states "Full SQLite + RuVector" as the achieved persistence model. Nobody proposed replacing relational tables.

### Q2: Is there a KV/document model for relational data planned upstream?

**No.** upstream-agentic:ADR-057 mentions `@ruvector/graph-node` with Cypher queries as a future graph model, but the implementation section shows "Full SQLite + RuVector" as the current state. No plan to remove SQLite for relational data.

### Q3: Are our fork patches (especially WM-003) implementing the wrong backend?

**Yes — WM-003 selected the wrong class.** WM-003 chose `AgentDBBackend` (which pulls in the full SQLite + controller stack) for what is a vector-store operation. The upstream design calls for `RvfBackend` or `SqlJsRvfBackend` in the hook bridge path. Phase 1 of this ADR corrects this.

WM-003 made the right tactical decision (single backend, no dual-write) with the wrong class. It is not "fighting the design" — it is implementing the right idea with the wrong tool.

### Q4: Does `db-unified.ts` represent the intended migration path?

**Yes, but for a different layer.** `db-unified.ts` implements "GraphDatabase primary, SQLite fallback" for the MCP server — not for the hook bridge. The hook bridge should use `RvfBackend` directly (lightweight, no full stack). `db-unified.ts` adoption is Phase 3 territory.

Note: `db-unified.ts` was not found at the expected path in the upstream tree. It may have been renamed to `database-provider.ts` or is in the agentdb package.

### Conclusion

Our architecture (RVF for vectors, SQLite for relational) aligns with the upstream design across both repos. Phase 1 (swap `AgentDBBackend` → `RvfBackend`) is the upstream-intended fix, not a workaround.

## Agentic-Flow Deep Search (2026-04-04, 5-agent swarm)

### Architecture Confirmed: Two Parallel Storage Layers

AgentDB has two completely independent storage systems selected in different code paths:

```
Layer 1: Relational (SQL)     — better-sqlite3 primary, sql.js fallback — ALWAYS runs
Layer 2: Vector (HNSW/RVF)    — ruvector > @ruvector/rvf > hnswlib > SqlJsRvfBackend
```

These coexist. The factory doesn't choose between them — Layer 1 always initialises for schemas, Layer 2 always initialises for vectors.

### Evidence from agentic-flow repo

| Source | Finding |
|--------|---------|
| agentic-flow:ADR-057 line 177 | Exact quote: `"Full (SQLite + RuVector)"` as persistence model |
| ADR-054 (architecture review) | `@ruvector/rvf` listed as "installed, not used". ADR-056/057 "100% complete" is aspirational |
| ADR-006 | Mandated `@ruvector` as exclusive **vector** backend — not about replacing SQL |
| ADR-003 | RVF format spec in agentdb docs. Status: Proposed |
| factory.ts | Priority chain: ruvector → @ruvector/rvf → hnswlib → SqlJsRvfBackend |
| AgentDB.ts | SQL engine selected independently, always runs regardless of vector backend |
| db-unified.ts | Legacy v2 layer, NOT used by v3 |

### Known RVF Data Loss Bugs

| Issue | Bug | Impact on Phase 1 |
|-------|-----|-------------------|
| ruvnet/agentic-flow#114 | `SqlJsRvfBackend` drops non-numeric IDs via `Number()` coercion | **BLOCKER** — our entries use IDs like `mem-MEMORY-project-patterns` which would be silently dropped |
| ruvnet/agentic-flow#128 | Reflexion writes HNSW but skips SQL insert — data lost on restart | Relevant if using reflexion controllers |
| ruvnet/agentic-flow#115 (PR) | Bidirectional ID mapping fix for #114 | **Must verify this is in our fork before Phase 1** |

### Impact on Phase 1

Phase 1 (swap `AgentDBBackend` → `RvfBackend` in `auto-memory-hook.mjs`) remains the correct fix, but:

1. **Must verify PR #115 (ID mapping fix) is in our agentic-flow fork** — without it, `SqlJsRvfBackend` will silently drop all string IDs
2. **`db-unified.ts` is dead code** — cannot be used as migration path (v2 legacy)
3. **ADR-056/057 "100% complete" is unreliable** — ADR-054 lists 50+ remaining TODOs
4. **Use `RvfBackend` (pure-TS, @claude-flow/memory) not `SqlJsRvfBackend` (agentdb)** — avoids the ID coercion bug entirely since RvfBackend uses its own Map-based KV store

## Related

- **ADR-0058**: Memory, Learning & Storage Deep Analysis — root cause analysis
- **ADR-0056**: MCP Server Unified Backend — Phase 3 of this implementation
- **ADR-0054**: RuVector Patch Pipeline — dependency chain
- **GitHub issues**: P0 bridge bug (ADR-0058 section), upstream:ADR-057

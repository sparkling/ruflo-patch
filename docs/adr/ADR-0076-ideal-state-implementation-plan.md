# ADR-0076: Architecture Consolidation — Implementation Plan

- **Status**: Implemented (all phases complete)
- **Date**: 2026-04-06 (proposed), 2026-04-07 (Phases 0-4 implemented)
- **Depends on**: ADR-0075 (Architecture State Assessment)
- **Revised by**: ADR-0077 (upstream-compatible approach adopted for Phases 1-5)
- **Supersedes**: None

## Context

ADR-0075 identified the ideal end state: 5 unified layers replacing 3 parallel controller
registries, 6 embedding implementations, 7 storage backends, and 5 independent config
resolution chains. This ADR defines the phased plan to get there.

## Implementation Approach

**This ADR originally described a "delete and restructure" approach.** ADR-0077 revised
Phases 1-5 to use an **intercept pattern** that is compatible with upstream merges:

- Upstream files are **NOT deleted** — they remain in the tree for clean merges
- New files are added alongside existing ones (we own them, upstream doesn't)
- Existing files receive **surgical 4-6 line patches** that redirect through the new
  abstractions, with the old code kept as fallback
- The runtime behavior is identical to the original plan; only the file tree differs

This approach was adopted because we track 4 upstream repos and must continue to merge
upstream changes cleanly. See ADR-0077 for the full rationale.

## Dependency DAG

```
Phase 0 (Dead Code)  ───────────────────────────────────────────────────┐
                                                                        v
Phase 1 (Config)  ──> Phase 2 (Embedding)  ──> Phase 3 (Storage)  ──> Phase 4 (Controllers)  ──> Phase 5 (Data Flow)
```

**Rationale for ordering:**

- Phase 0 is independent -- removing dead code has no functional dependencies.
- Phase 1 (Config) must come first because every other layer reads config. You cannot
  validate embedding dimension at startup (Phase 2) if three different config chains could
  each provide a different dimension value. You cannot consolidate storage (Phase 3) if the
  backend selection reads config from disk independently.
- Phase 2 (Embedding) must precede Phase 3 (Storage) because storage backends need to know
  the embedding dimension at construction time (`RvfBackend({dimensions})`,
  `HnswLite({dimensions})`). A single embedding pipeline that validates dimension at startup
  is a prerequisite for storage to trust its vector parameters.
- Phase 3 (Storage) must precede Phase 4 (Controllers) because controllers call
  `IStorage.store()` and `IStorage.search()`. The controller registry cannot be unified
  until there is exactly one storage implementation behind it.
- Phase 4 (Controllers) must precede Phase 5 (Data Flow) because the single data flow path
  requires a single controller registry as the entry point. You cannot route
  `MCP Tool -> ControllerRegistry.get(name)` until the registry is the sole owner.

---

## Phase 0: Dead Code Removal

**Goal**: Delete unreachable code to reduce the surface area before structural changes.

### Files to delete

| File | Lines | Why dead |
|------|-------|----------|
| `memory/src/hybrid-backend.ts` | 789 | Never instantiated by any code path; `database-provider.ts:testRvf()` returns `true` unconditionally, so `auto` mode always selects RVF, making HybridBackend and SQLiteBackend unreachable |
| `memory/src/hybrid-backend.test.ts` | ~200 | Tests for dead code |

### Files to modify

| File | Change |
|------|--------|
| `memory/src/index.ts` | Remove `HybridBackend` and `HybridBackendConfig` exports |
| `memory/src/sqlite-backend.ts` | Remove comments referencing HybridBackend (lines 396, 403, 405) |
| `memory/src/agentdb-backend.ts` | Remove comments referencing HybridBackend (lines 8, 188) |

### Controllers to remove from INIT_LEVELS

| Controller | Reason |
|-----------|--------|
| `circuitBreakerController` | Factory returns `null`; distinct from `circuitBreaker` which works |
| `federatedSession` | Has factory case but not in INIT_LEVELS -- already unreachable; clean up residual type union entry |

### Migration path

No data migration. These paths are never executed. Acceptance tests that import HybridBackend
directly will need to be updated or removed.

### Acceptance criteria

- `npm run test:unit` passes with zero HybridBackend references in production code
- `grep -r HybridBackend memory/src/*.ts` returns only deletion-commit artifacts
- No change to any runtime behavior (verified by full acceptance suite)

### Risk

Low. Dead code by definition has no callers. The only risk is a test file that imports
HybridBackend directly -- those tests are testing dead code and should be removed.

### Estimated scope

**S** (~100 lines changed, ~1,000 lines deleted)

---

## Phase 1: Single Config Resolution

**Goal**: Replace 5 independent config resolution chains with one `resolveConfig()` function
that produces an immutable `ResolvedConfig` object, called once at startup.

### Current state (5 chains)

| Chain | Location | What it reads |
|-------|----------|---------------|
| 1 | `shared/src/core/config/loader.ts` | `claude-flow.config.json`, env vars |
| 2 | `database-provider.ts` lines 208-230 | walks up to `.claude-flow/embeddings.json`, falls back to `@claude-flow/agentdb` import |
| 3 | `controller-registry.ts` lines 554-565 | `config.dimension` param, then `agentdb.getEmbeddingConfig()`, then 768 fallback |
| 4 | `agentdb-service.ts` lines 215-232 | `getEmbeddingConfig()` from agentdb, plus reads `.claude-flow/config.json` for `dedupThreshold` |
| 5 | `memory-initializer.ts` lines ~1697-1724 | Probes ruvector ONNX, falls back to 384 dim |

### Files to create

| File | Purpose |
|------|---------|
| `memory/src/resolve-config.ts` (~120 lines) | Single `resolveConfig()` function. Priority: explicit arg > `embeddings.json` > `getEmbeddingConfig()` > hardcoded 768. Returns frozen `ResolvedConfig`. |
| `memory/src/resolve-config.test.ts` (~150 lines) | Unit tests: each priority level, freeze enforcement, no-file fallback |

### `ResolvedConfig` interface (in resolve-config.ts)

```typescript
export interface ResolvedConfig {
  readonly embedding: {
    readonly model: string;       // "Xenova/all-mpnet-base-v2"
    readonly dimension: number;   // 768
    readonly provider: string;    // "transformers.js"
  };
  readonly storage: {
    readonly provider: 'rvf' | 'better-sqlite3';
    readonly databasePath: string;
    readonly walMode: boolean;
    readonly autoPersistInterval: number;
  };
  readonly hnsw: {
    readonly M: number;
    readonly efConstruction: number;
    readonly efSearch: number;
  };
  readonly memory: {
    readonly maxEntries: number;
    readonly defaultNamespace: string;
    readonly dedupThreshold: number;
  };
}
```

### Files to modify

| File | Change |
|------|--------|
| `database-provider.ts` | Remove lines 208-230 (embeddings.json walk + agentdb import fallback). Accept `ResolvedConfig` as parameter instead. |
| `controller-registry.ts` lines 554-565 | Remove dimension resolution block. Read from `ResolvedConfig.embedding.dimension` passed in `RuntimeConfig`. |
| `memory-initializer.ts` | Remove local dimension probing (~lines 1697-1724). Import and call `resolveConfig()` once. |
| `shared/src/core/config/loader.ts` | Have `loadConfig()` call `resolveConfig()` for the embedding/storage/hnsw sections instead of building them independently. |

### Migration path

No data migration. Config resolution is a startup-only operation. Existing config files
(`embeddings.json`, `config.json`, `claude-flow.config.json`) continue to be read --
`resolveConfig()` reads them all in priority order. The difference: one function reads them,
not five independent code paths.

### Acceptance criteria

- `resolveConfig()` is called exactly once per process (verified by test with call counter)
- Returned object is frozen (`Object.isFrozen(config) === true`)
- `database-provider.ts` no longer imports `node:fs` or `node:path` (no filesystem walks)
- `controller-registry.ts` no longer imports `@claude-flow/agentdb` for config
- No 384-dim value appears in any non-test production code path
- Full acceptance suite passes

### Risk

Medium. The config chain touches every layer. The mitigation is: `resolveConfig()` preserves
the same priority order as the current chains, so the *output* is identical -- only the
*location* of the logic changes. Feature-flag the new path behind
`CLAUDE_FLOW_UNIFIED_CONFIG=1` for the first release.

### Estimated scope

**M** (~400 lines changed across 5 files, ~120 lines new)

---

## Phase 2: Single Embedding Pipeline

**Goal**: Create one `EmbeddingPipeline` instance that is constructed once (using
`ResolvedConfig` from Phase 1) and injected into every consumer. Dimension mismatch fails
loudly at startup.

### Current state (6 implementations)

| # | Implementation | Location | Dim |
|---|---------------|----------|-----|
| 1 | `generateEmbedding()` | `memory-initializer.ts` | 768 (mpnet fallback chain) |
| 2 | hooks pretrain default | `hooks.ts` | 384 (MiniLM) **FIXED in ADR-0075** |
| 3 | `ruvector.initOnnxEmbedder` | CLI ruvector fallback | 384 **FIXED in ADR-0075** |
| 4 | `RvfEmbeddingService` | RVF backend | 384 (hash-only) |
| 5 | `AgenticFlowEmbeddingService` | agentdb-service.ts | 768 (via bridge) |
| 6 | `MockEmbeddingService` | tests | 384 (hash) |

### Files to create

| File | Purpose |
|------|---------|
| `memory/src/embedding-pipeline.ts` (~180 lines) | `EmbeddingPipeline` class. Constructor takes `ResolvedConfig`. Single `embed(text): Promise<Float32Array>` method. Loads model once. Validates dimension of first output against `ResolvedConfig.embedding.dimension` -- throws `DimensionMismatchError` if wrong. |
| `memory/src/embedding-pipeline.test.ts` (~200 lines) | Tests: happy path, dimension mismatch throws, singleton behavior, mock model |

### Files to modify

| File | Change |
|------|--------|
| `memory-initializer.ts` | Replace `generateEmbedding()` function (~80 lines) with call to injected `EmbeddingPipeline.embed()`. Remove local model loading. |
| `memory-bridge.ts` | Remove local embedding service instantiation. Accept `EmbeddingPipeline` via constructor/factory parameter. |
| `controller-registry.ts` | Store `EmbeddingPipeline` instance. Pass it to controllers that need embedding (learningBridge, memoryGraph, hierarchicalMemory, etc.) via their config. Remove `this.realEmbedder` field. |
| `database-provider.ts` | Remove dimension parameter from RvfBackend construction; read from `ResolvedConfig` (already done in Phase 1). |
| `agentdb-service.ts` lines 214-219 | Remove `new EmbeddingSvc()` construction. Accept `EmbeddingPipeline` from caller (the MCP server startup). |
| `hooks/src/reasoningbank/embedding-constants.ts` | Import from `memory/src/embedding-pipeline.ts` instead of defining local constants. |
| `swarm/src/embedding-constants.ts` | Same -- import, do not redefine. |
| `neural/src/embedding-constants.ts` | Same. |
| `guidance/src/embedding-constants.ts` | Same. |

### Files to delete

| File | Lines | Why |
|------|-------|-----|
| `memory/src/agentdb-backend.ts` | ~200 | Thin wrapper that only exists to bridge AgentDB's embedding service to `IMemoryBackend.search()`. With a single pipeline, this indirection is unnecessary. |

### Migration path

No data migration for the pipeline itself. Existing stored vectors are unchanged. The only
concern: if a user has stored vectors at 384 dimensions (from a pre-fix MiniLM path) and the
new pipeline produces 768-dim vectors, `cosineSim()` will now fail loudly instead of
silently truncating. This is the *correct* behavior -- the old silent truncation was a bug.

Users in this state need a one-time re-embedding migration. Add a CLI command:
`npx @sparkleideas/cli@latest memory migrate --re-embed` that reads all stored entries and
re-embeds them with the current pipeline.

### Acceptance criteria

- `grep -r "new.*EmbeddingSvc\|new.*EmbeddingService" --include="*.ts"` returns only test files
- Process startup with `CLAUDE_FLOW_STRICT=true` and a 384-dim stored vector throws `DimensionMismatchError`
- `embedding-constants.ts` files across hooks/swarm/neural/guidance all re-export from one source
- Full acceptance suite passes

### Risk

Medium-High. Embedding is the most cross-cutting concern. Mitigation: the `EmbeddingPipeline`
class is a wrapper, not a reimplementation. It delegates to the same Transformers.js /
ruvector / hash backends. The change is in *who owns the instance*, not in *what the instance
does*.

### Estimated scope

**L** (~600 lines changed across 10 files, ~380 lines new, ~200 lines deleted)

---

## Phase 3: Single Storage Abstraction

**Goal**: Reduce 7 storage backends to 2 implementations behind one `IStorage` interface:
`NativeStorage` (RVF format + Rust HNSW via NAPI) and `PureTsStorage` (JSON + HnswLite).
Selection happens once at startup based on `ResolvedConfig`.

### Current state (7 backends)

| # | Backend | File | Lines | Status |
|---|---------|------|-------|--------|
| 1 | RvfBackend | `memory/src/rvf-backend.ts` | 974 | **Primary** (always selected) |
| 2 | SQLiteBackend | `memory/src/sqlite-backend.ts` | 717 | Unreachable in auto mode |
| 3 | HybridBackend | `memory/src/hybrid-backend.ts` | 789 | **Dead** (deleted in Phase 0) |
| 4 | AgentDB SQLite | `agentdb/core/AgentDB.ts` | N/A | Used by AgentDB controllers |
| 5 | InMemoryStore | `agentdb-service.ts` lines 106-126 | 20 | Silent data loss fallback |
| 6 | sql.js fallback | `memory-initializer.ts` | ~100 | Legacy, pre-RVF |
| 7 | better-sqlite3 | `database-provider.ts` via SQLiteBackend | ~717 | Reachable only with explicit `provider: 'better-sqlite3'` |

### Files to create

| File | Purpose |
|------|---------|
| `memory/src/storage.ts` (~60 lines) | `IStorage` interface. Strict subset of current `IMemoryBackend` -- same methods, but the name changes to signal the new contract. Type alias: `type IStorage = IMemoryBackend` initially, to avoid a big-bang rename. |
| `memory/src/native-storage.ts` (~250 lines) | `NativeStorage implements IStorage`. Wraps RvfBackend + native HNSW. Constructed with `ResolvedConfig`. No fallback -- if native binaries are missing, constructor throws. |
| `memory/src/pure-ts-storage.ts` (~200 lines) | `PureTsStorage implements IStorage`. JSON persistence + HnswLite. Zero native deps. Constructed with `ResolvedConfig`. |
| `memory/src/storage-factory.ts` (~80 lines) | `createStorage(config: ResolvedConfig): IStorage`. Tries NativeStorage, catches, falls back to PureTsStorage. Replaces `database-provider.ts`. |
| `memory/src/storage.test.ts` (~300 lines) | Contract tests parameterized over both implementations |

### Files to delete

| File | Lines | Why |
|------|-------|-----|
| `memory/src/database-provider.ts` | 273 | Replaced by `storage-factory.ts` |
| `memory/src/database-provider.test.ts` | ~150 | Tests for deleted file |
| `memory/src/sqlite-backend.ts` | 717 | Unreachable; better-sqlite3 users get NativeStorage (which is faster) |
| `memory/src/agentdb-backend.ts` | ~200 | Deleted in Phase 2 already |

### Files to modify

| File | Change |
|------|--------|
| `memory/src/rvf-backend.ts` | Refactor into `NativeStorage`. Keep the WAL write path (ADR-0073) and RVF format intact. Remove the config-reading code (now in `ResolvedConfig`). Target: under 500 lines. |
| `memory/src/hnsw-lite.ts` | No change -- already clean. Used by `PureTsStorage`. |
| `memory/src/index.ts` | Export `IStorage`, `NativeStorage`, `PureTsStorage`, `createStorage`. Remove `HybridBackend`, `SQLiteBackend`, `AgentDBBackend` exports. |
| `controller-registry.ts` | Replace `this.backend: IMemoryBackend` with `this.storage: IStorage`. Call `createStorage()` in `initialize()`. |
| `memory-initializer.ts` | Remove sql.js fallback path. Call `createStorage()`. |
| `agentdb-service.ts` | Remove `InMemoryStore` class (lines 106-126). Remove all `new InMemoryStore<>()` usages (lines 176-178). When AgentDB init fails, throw instead of falling back to silent data loss. |

### Migration path

**RVF users** (vast majority): No migration. NativeStorage reads the same `.rvf` files.

**SQLite users** (explicitly configured `provider: 'better-sqlite3'`): Need a one-time
migration. Add `npx @sparkleideas/cli@latest memory migrate --from-sqlite` that reads
SQLite entries and writes them to RVF format. The command already exists in skeleton form
at `memory/src/migration.ts` and `memory/src/rvf-migration.ts`.

**InMemoryStore users**: There are none -- the in-memory fallback only activates on AgentDB
init failure, and in that case data was already being silently lost. Throwing an error is
strictly better.

### Acceptance criteria

- `database-provider.ts` and `sqlite-backend.ts` are deleted
- `createStorage()` returns `NativeStorage` when native binaries are present
- `createStorage()` returns `PureTsStorage` when native binaries are absent
- No `.rvf` file format changes -- existing files load without migration
- `InMemoryStore` class does not exist in any production code
- Full acceptance suite passes
- `wc -l rvf-backend.ts` (now `native-storage.ts`) is under 500 lines

### Risk

Medium. The RvfBackend refactor into NativeStorage is a rename + extraction, not a rewrite.
The WAL write path (ADR-0073 Phase 1) is preserved verbatim. The risk is in the SQLite
removal -- any user with `provider: 'better-sqlite3'` in their config will get an error.
Mitigation: `createStorage()` detects this config value and prints a migration command.

### Estimated scope

**L** (~800 lines changed, ~590 lines new, ~1,140 lines deleted)

---

## Phase 4: Single Controller Registry

**Goal**: Delete `AgentDBService` (1,748 lines). Make `ControllerRegistry` the sole owner of
all controller lifecycles. AgentDB becomes a library (its `getController()` is called by the
registry, not by a parallel service).

### Current state

| Registry | File | Lines | Controllers | Problem |
|----------|------|-------|-------------|---------|
| ControllerRegistry | `memory/src/controller-registry.ts` | 1,968 | 48 names (7-level init) | Too large; but the *structure* is correct |
| AgentDB.getController() | `agentdb/core/AgentDB.ts` | N/A | 17 names | Library -- called by the other two |
| AgentDBService | `agentic-flow/agentdb-service.ts` | 1,748 | 15 `new` + 21 `getController()` calls | Parallel singleton with its own init, its own config reading, its own fallback stores |

### Why AgentDBService must die

1. It constructs 13 controllers that ControllerRegistry also constructs -- different object
   instances hitting the same SQLite file. In-memory caches diverge.
2. It has its own `InMemoryStore` fallback that silently loses data.
3. It reads config from `.claude-flow/config.json` independently (already fixed in Phase 1).
4. 16 call sites in `stdio-full.ts` and tool files call `AgentDBService.getInstance()`.
   Each of these needs to be rewired to go through ControllerRegistry instead.

### Files to delete

| File | Lines | Why |
|------|-------|-----|
| `agentic-flow/src/services/agentdb-service.ts` | 1,748 | Replaced by ControllerRegistry |
| `agentic-flow/src/services/agentdb-phase4-methods.ts` | ~300 | Extension methods for the deleted class |

### Files to create

| File | Purpose |
|------|---------|
| `agentic-flow/src/services/controller-bridge.ts` (~120 lines) | Thin adapter: `getController(name)` calls `ControllerRegistry.get(name)`. This provides the same `AgentDBService`-shaped API to MCP tool files during the transition, so tool files need only change their import, not their calling pattern. |

### Files to modify (the bulk of the work)

| File | Change |
|------|--------|
| `agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts` (868 lines) | Replace all 16 `AgentDBService.getInstance()` calls with `ControllerRegistry.get()` or `controllerBridge.getController()`. |
| `agentic-flow/src/mcp/fastmcp/tools/hidden-controllers.ts` | 10 `AgentDBService.getInstance()` calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/performance-tools.ts` | 5 calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/session-tools.ts` | 2 calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/attention-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/daa-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/neural-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/memory-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/rvf-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/workflow-tools.ts` | calls -> bridge |
| `agentic-flow/src/mcp/fastmcp/tools/quic-tools.ts` | calls -> bridge |
| `agentic-flow/src/services/swarm-service.ts` | calls -> bridge |
| `agentic-flow/src/services/streaming-service.ts` | calls -> bridge |
| `agentic-flow/src/services/hook-service.ts` | calls -> bridge |
| `agentic-flow/src/services/direct-call-bridge.ts` | calls -> bridge |
| `controller-registry.ts` | Split into 3 files to get under 500 lines: `controller-registry.ts` (class + init), `controller-factories.ts` (factory switch), `controller-types.ts` (type unions + INIT_LEVELS) |

### Migration path

No data migration. AgentDBService does not own persistent state -- it delegates to AgentDB
(which is preserved) and to InMemoryStore (which is deleted because it loses data anyway).
The controller-bridge.ts file ensures that tool files see the same API shape during
transition.

### Acceptance criteria

- `agentdb-service.ts` is deleted
- `grep -r "AgentDBService" agentic-flow/src/` returns zero hits in production code
- `wc -l controller-registry.ts` is under 500 lines
- All 16+ MCP tool call sites route through ControllerRegistry
- No `InMemoryStore` class exists in production code
- The 7-level init ordering is preserved (verified by unit test)
- Full acceptance suite passes -- every MCP tool that previously worked still works

### Risk

High. This is the largest phase and touches the most files (17 in agentic-flow alone). The
controller-bridge.ts adapter is the key mitigation -- it means tool files only change their
import line, not their calling convention. The bridge can be removed in a follow-up once
tool files are updated to call ControllerRegistry directly.

### Estimated scope

**XL** (~1,200 lines changed across 17 files, ~120 lines new, ~2,048 lines deleted)

---

## Phase 5: Single Data Flow Path

**Goal**: Every MCP tool call follows one path:
`MCP Tool -> ControllerRegistry.get(name) -> Controller -> IStorage + EmbeddingPipeline`.
No bridge functions. No parallel service. No fallback stores.

### Current state

At least 3 distinct data flow paths exist:

1. `MCP Tool (agentdb-tools.ts) -> memory-bridge.ts -> ControllerRegistry -> AgentDB -> RvfBackend`
2. `MCP Tool (stdio-full.ts) -> AgentDBService -> AgentDB -> SQLite` (parallel, separate instances)
3. `MCP Tool (memory-tools.ts) -> memory-initializer.ts -> sql.js / RvfBackend` (legacy)

### Prerequisites

This phase requires Phases 1-4 to be complete. After Phase 4:
- Config is unified (Phase 1)
- Embedding is a single pipeline (Phase 2)
- Storage is IStorage with 2 implementations (Phase 3)
- Controllers all live in ControllerRegistry (Phase 4)

### Files to delete

| File | Lines | Why |
|------|-------|-----|
| `cli/src/memory/memory-bridge.ts` | 3,599 | Bridge layer between MCP tools and ControllerRegistry. With Phase 4 complete, MCP tools call ControllerRegistry directly. The bridge is a pass-through that adds complexity and hides the actual call target. |
| `cli/src/memory/memory-initializer.ts` | 2,928 | Legacy initialization code from pre-AgentDB era. All initialization now happens in `ControllerRegistry.initialize()` which calls `createStorage()` and constructs `EmbeddingPipeline`. |
| `memory/src/auto-memory-bridge.ts` | ~200 | Auto-wiring helper for the bridge layer being deleted |
| `memory/src/auto-memory-bridge.test.ts` | ~150 | Tests for deleted file |

### Files to modify

| File | Change |
|------|--------|
| `cli/src/mcp-tools/agentdb-tools.ts` (1,449 lines) | Replace `import { ... } from '../memory/memory-bridge.js'` with direct `ControllerRegistry.get()` calls. Each tool function goes from `bridge.storeFoo(args)` to `registry.get<FooController>('foo').store(args)`. |
| `cli/src/mcp-tools/memory-tools.ts` | Same pattern -- remove bridge indirection. |
| `cli/src/mcp-tools/hooks-tools.ts` | Remove memory-bridge import. |
| `cli/src/mcp-tools/system-tools.ts` | Remove memory-bridge import. |
| `cli/src/mcp-tools/daa-tools.ts` | Remove memory-bridge import. |
| `cli/src/memory/intelligence.ts` | Remove memory-bridge dependency. Call ControllerRegistry directly. |
| `cli/src/services/worker-daemon.ts` | Remove memory-bridge dependency. |
| `cli/src/commands/start.ts` | Replace memory-initializer bootstrap with `ControllerRegistry.initialize(resolveConfig())`. |

### Migration path

No data migration. This phase changes wiring only -- the same controllers, the same storage,
the same embedding pipeline. The data flow is identical; only the number of indirection
layers changes (from 3 to 1).

### Acceptance criteria

- `memory-bridge.ts` and `memory-initializer.ts` are deleted
- `grep -r "memory-bridge\|memory-initializer" cli/src/ --include="*.ts"` returns zero hits
  in production code (test imports are acceptable during transition)
- Every MCP tool call follows the path: `tool function -> ControllerRegistry.get() -> Controller -> IStorage`
- No `sql.js` import exists in production code
- Full acceptance suite passes
- Process startup time is not regressed (measure with `cli-cold-start.bench.ts`)

### Risk

High. `memory-bridge.ts` (3,599 lines) and `memory-initializer.ts` (2,928 lines) are the
two largest files in the CLI package. Deleting them means rewriting every MCP tool's
plumbing. Mitigation: do this tool-by-tool, not all at once. Each tool file is an
independent unit. Merge one tool file at a time, run acceptance after each.

### Estimated scope

**XL** (~2,000 lines changed across 8+ tool files, ~6,527 lines deleted)

---

## Summary

| Phase | Goal | New | Changed | Deleted | Size | Risk |
|-------|------|-----|---------|---------|------|------|
| 0 | Dead code removal | 0 | ~20 | ~1,000 | S | Low |
| 1 | Single config resolution | ~270 | ~400 | 0 | M | Medium |
| 2 | Single embedding pipeline | ~380 | ~600 | ~200 | L | Medium-High |
| 3 | Single storage abstraction | ~590 | ~800 | ~1,140 | L | Medium |
| 4 | Single controller registry | ~120 | ~1,200 | ~2,048 | XL | High |
| 5 | Single data flow path | 0 | ~2,000 | ~6,527 | XL | High |
| **Total** | | **~1,360** | **~5,020** | **~10,915** | | |

Net effect: approximately **9,555 lines of production code deleted**.

### Sequencing recommendation

Phases 0 and 1 can be done in the same PR since they are both low-disruption and Phase 0
has no downstream consumers. Phases 2-5 should each be their own PR with a full acceptance
run between each.

| PR | Phases | Estimated effort |
|----|--------|-----------------|
| PR 1 | Phase 0 + Phase 1 | 1-2 days |
| PR 2 | Phase 2 | 2-3 days |
| PR 3 | Phase 3 | 2-3 days |
| PR 4 | Phase 4 | 3-5 days |
| PR 5 | Phase 5 | 3-5 days |

Total: 11-18 working days.

## Implementation Status

| Phase | Goal | Status | Approach | Tests |
|-------|------|--------|----------|-------|
| **0** | Dead code removal | **Complete** | Delete (safe — code was unreachable) | 12 pass |
| **1** | Single config resolution | **Complete** | New `resolve-config.ts` + 4 consumer patches | 24 pass |
| **2** | Single embedding pipeline | **Complete** | New `embedding-pipeline.ts` + lazy-cache redirects in 4 consumers + 4 constants consolidated | 20 pass |
| **3** | Single storage abstraction | **Complete** | New `storage.ts` + `storage-factory.ts` + `createStorage()` wired into controller-registry, memory-bridge, memory-initializer | 14 pass |
| **4** | Shared controller instances | **Complete** | New `controller-intercept.ts` with `getOrCreate()` pool, wired into both registries (45 + 6 wraps) + bridge connected at startup | 21 pass |
| **5** | Single data flow path | **Complete** | ADR-0083 Waves 1-2 (memory-router.ts, 825 lines eliminated) + ADR-0083 Wave 3 via ADR-0084 T3.2 (hooks-tools.ts 18 sites) + ADR-0084 Phase 4 (route methods controller-direct, bridge removed from route layer) | 1933 pass |

### New files created (Phases 0-4)

| File | Package | Lines | Phase | Purpose |
|------|---------|-------|-------|---------|
| `resolve-config.ts` | memory | ~240 | 1 | Frozen config singleton with 4-layer priority |
| `embedding-pipeline.ts` | memory | ~270 | 2 | Canonical embed + cosineSimilarity + dim validation |
| `storage.ts` | memory | ~90 | 3 | IStorage type alias + IStorageContract (16 methods) |
| `storage-factory.ts` | memory | ~140 | 3 | createStorage() — RvfBackend, no InMemoryStore fallback |
| `controller-intercept.ts` | memory | ~65 | 4 | Module-level getOrCreate() singleton pool |
| `controller-bridge.ts` | agentic-flow | ~195 | 4 | Transition adapter: AgentDBService API → ControllerRegistry |

### What was NOT done (by design, per ADR-0077)

- `hybrid-backend.ts` — deleted (Phase 0, dead code, safe)
- `database-provider.ts`, `sqlite-backend.ts` — kept (upstream files, bypassed by createStorage)
- `agentdb-service.ts` — kept (upstream file, wrapped with getOrCreate instead of deleted)
- `controller-registry.ts` — NOT split into 3 files (merge conflict risk too high)
- `memory-bridge.ts`, `memory-initializer.ts` — kept (Phase 5 will route around them, not delete)

## Phase 5 Plan (ADR-0077 approach)

### Goal
Every MCP tool call follows one path:
`MCP Tool → routeMemoryOp() → ControllerRegistry.get(name) → Controller → IStorage`

### Approach: Route Around, Don't Delete

**New files (we own):**
- `@claude-flow/cli/src/memory/memory-router.ts` (~150 lines) — single entry point
  for all memory operations via `routeMemoryOp(op)` dispatcher
- `@claude-flow/cli/src/memory/migration-legacy.ts` — standalone sql.js-to-RVF
  migration script (extracted from memory-initializer.ts, run once, not at startup)

**MCP tool files to rewire (21 import sites across 7 files):**
- `memory-tools.ts` — 11 bridge imports → routeMemoryOp / registry.get
- `agentdb-tools.ts` — 3 bridge imports → routeMemoryOp
- `hooks-tools.ts` — 4 bridge/initializer imports → routeMemoryOp
- `daa-tools.ts` — 2 bridge imports → routeMemoryOp
- `system-tools.ts` — 1 bridge import → routeMemoryOp
- `session-tools.ts` — 1 initializer import → routeMemoryOp
- `embeddings-tools.ts` — 2 initializer imports → pipeline.embed

**Files NOT modified (by this ADR):**
- `memory-bridge.ts` — became dead code after Phases 0-4; **deleted by ADR-0085** (2026-04-13)
- `memory-initializer.ts` — 11 bridge try-blocks **removed by ADR-0085**; remains as pure SQLite CRUD
(Update: ADR-0086 replaced CRUD paths with RvfBackend stubs. memory-initializer.ts is now an import shim.)

## Decision

Implement the 6-phase plan using the ADR-0077 intercept approach. Each phase is gated on
a passing test suite. Phases 0-4 are complete. Phase 5 (bridge+initializer dead code removal)
was implemented by **ADR-0085**, which deleted memory-bridge.ts, moved registry bootstrap
to the router, and eliminated the JSON sidecar.

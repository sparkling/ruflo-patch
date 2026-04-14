# ADR-0075: Architecture State Assessment — Storage, Controllers, Embeddings

- **Status**: Closed — all 5 layers addressed (L2-L5 by ADR-0085, L1 by ADR-0086). See ADR-0086 for remaining debt.
- **Date**: 2026-04-06
- **Analysis**: 5-agent hive council (queen architect + storage/controller/embedding specialists + devil's advocate)

## Context

A deep architecture review was conducted across the ruflo and agentic-flow forks to assess the
current state of storage backends, controller wiring, embedding generation, and configuration
flow. The goal: identify what works, what's broken, what's redundant, and what the ideal end
state looks like — with no constraints.

## Findings

### What's Working Well

| Component | Why it works |
|-----------|-------------|
| WAL write path (ADR-0073 Phase 1) | Sound crash safety, O(1) appends, atomic rename compaction |
| HNSW parameter derivation | `deriveHNSWParams()` shared across all layers, dimension-aware, 26 lines |
| HnswLite pure-TS fallback | Clean API, zero dependencies, correct bidirectional edges |
| ControllerRegistry level ordering | 7-level init with deferred background init for fast CLI startup |
| AgentDB.getController() | Clean switch, lazy instantiation, coherent 19-name set |
| Native binary build pipeline | ADR-0071: all 10 NAPI binaries from fork HEAD with SHA provenance |
| Acceptance test framework | 165+ checks covering structural, runtime, and e2e paths |

### Critical Problems

#### Problem 1: Three Parallel Controller Registries

| Registry | Location | Controllers | Calls getController()? |
|----------|----------|-------------|----------------------|
| ControllerRegistry | memory/controller-registry.ts (1,968 lines) | 48 names | Yes (8 delegate) |
| AgentDB.getController() | agentdb/core/AgentDB.ts | 17 names | N/A (is the target) |
| AgentDBService | agentic-flow/agentdb-service.ts (1,693 lines) | 15 `new` constructions | **Zero** calls |

13 controllers are constructed in BOTH ControllerRegistry and AgentDBService — different object
instances hitting the same SQLite file. In-memory caches diverge. ADR-0069 F1 claimed 10
controllers delegate to getController(); AgentDBService has zero such calls — the delegation
never landed.

#### Problem 2: Six Embedding Implementations, Live 384-dim Defaults

| Implementation | Model | Dim | Production? |
|---------------|-------|-----|-------------|
| memory-initializer.ts generateEmbedding() | mpnet fallback chain | 768 | **Yes** |
| hooks.ts pretrain flag default | MiniLM | **384** | **Yes** (if agentdb import fails) |
| ruvector.initOnnxEmbedder fallback | MiniLM | **384** | **Yes** (CLI fallback) |
| RvfEmbeddingService | hash-only | **384** | Fallback |
| AgenticFlowEmbeddingService | mpnet | 768 | Via bridge |
| MockEmbeddingService | hash | **384** | Tests |

`cosineSim()` silently truncates dimension mismatches — no error, meaningless scores.

#### Problem 3: Four HNSW Implementations

| HNSW | Used when |
|------|-----------|
| HnswLite (pure TS) | RvfBackend fallback |
| Rust HnswGraph (rvf-index) | Native NAPI via rvf-node |
| VectorDb (@ruvector/core) | `memory search` CLI command |
| HNSWLibBackend (hnswlib-node) | AgentDB backend selection |

#### Problem 4: Seven Storage Backends, Only One Selected

`database-provider.ts:testRvf()` unconditionally returns `true`. SQLiteBackend and
HybridBackend are unreachable in `auto` mode. HybridBackend is 790 lines of dead code.
Same `.rvf` extension used by two incompatible binary formats. No migration on backend switch.

#### Problem 5: Dead Code in Critical Paths

- `circuitBreakerController`: Level 0 security, always-enabled, factory returns `null`
- `federatedSession`: has factory case but not in INIT_LEVELS — unreachable
- `HybridBackend`: 790 lines, never instantiated by any code path
- `wasmVectorSearch`, `syncCoordinator`, `quicClient/Server`: initialized but no MCP tool
  exposes them
- `InMemoryStore` fallback in AgentDBService: silently loses all data on process exit

### Interop Matrix

| Pair | Rating |
|------|--------|
| Storage (RvfBackend) <-> Controllers (ControllerRegistry) | LOOSE |
| Storage (AgentDB SQLite) <-> Controllers (AgentDB) | TIGHT |
| Controllers (ControllerRegistry) <-> Controllers (AgentDBService) | **BROKEN** |
| Controllers <-> Embeddings | LOOSE (3 embedding service instances in one process) |
| Storage <-> Embeddings | LOOSE (dimension bypass in memory-bridge.ts) |
| Config <-> Everything | LOOSE (5 independent resolution chains) |
| HybridBackend <-> anything | **DEFERRED** (upstream plans to revive as production default) |

### The Devil's Advocate's Uncomfortable Truths

1. The project has two missions (repackaging + upstream dev) but only acknowledges one
2. Three core files violate the 500-line rule: controller-registry (1,968), agentdb-service
   (1,693), rvf-backend (974)
3. ADR-0073 Con #1: "No user complaints" — severity HIGH — then all 3 phases built anyway
4. The native binary path will be used by ~0 users near term
5. Ruthless simplification: delete ControllerRegistry, merge 3 CLI controllers into 200-line
   initializer, defer Phases 2-3 of ADR-0073

## Ideal End State (No Constraints)

### Layer 1: Single Storage Abstraction

One `IStorage` interface. Two implementations selected at startup (NativeStorage with RVF+HNSW,
PureTsStorage with JSON+HnswLite). No HybridBackend, no SQLiteBackend for memory, no
AgentDBBackend wrapper, no in-memory Map fallback.

### Layer 2: Single Controller Registry

One registry owns all controller lifecycles. AgentDB becomes a library the registry calls, not
a self-contained app. AgentDBService is deleted. The 7-level init ordering is preserved.

### Layer 3: Single Embedding Pipeline

One `EmbeddingPipeline` instance created once, injected everywhere. Dimension validated at
startup — if stored vectors have dimension N and pipeline produces M where N != M, fail loudly.

### Layer 4: Single Config Resolution

One `resolveConfig()` function called once, producing an immutable config object. No layer reads
config from disk independently. No layer has defaults that could disagree with another layer.

### Layer 5: Single Data Flow Path

```
MCP Tool -> ControllerRegistry.get(name) -> Controller.store()
                                               |
                                               v
                                           IStorage.store() + EmbeddingPipeline.embed()
                                               |
                                               v
                                           NativeStorage (RVF + HNSW)
```

No sql.js fallback. No parallel AgentDBService. No bridge functions. One path, every time.

### What This Eliminates

- HybridBackend (790 lines)
- AgentDBService (1,679 lines)
- database-provider.ts broken auto-select
- memory-initializer.ts sql.js fallback
- memory-bridge.ts dimension bypass
- 3 duplicate embedding service instances
- 2 duplicate controller wiring layers
- InMemoryStore silent data loss fallback
- 5 independent dimension resolution chains

### What This Preserves

- 7-level init ordering
- HnswLite pure-TS fallback
- WAL write path
- ControllerInitError fail-loud pattern
- Deferred init for fast CLI startup
- All 19 AgentDB controllers (unchanged internally)
- All CLI-layer controllers (unchanged internally)

## Decision

This ADR is informational — no implementation decision. It captures the current state as a
baseline for future simplification work. The findings should inform prioritization:

1. ~~**Highest impact / lowest effort**: Fix the live 384-dim MiniLM defaults in hooks.ts~~ **DONE** (2026-04-06)
2. ~~**Highest impact / medium effort**: Wire AgentDBService's 15 constructors through
   getController() (complete ADR-0069 F1)~~ **DONE** (2026-04-06)
3. **Highest impact / highest effort**: ~~Delete AgentDBService~~ Create additive shim
   alongside AgentDBService delegating to ControllerRegistry (ADR-0076 B4)

## Tracked Issues

All findings tracked as GitHub issues on fork repos:

| Issue | Bug | Status |
|-------|-----|--------|
| sparkling/ruflo#25 | cosineSim silent truncation | Fixed |
| sparkling/ruflo#26 | circuitBreaker Level 0 null | Fixed |
| sparkling/ruflo#27 | MiniLM 384-dim defaults | Fixed |
| sparkling/ruflo#28 | Startup dimension validation | Fixed |
| sparkling/ruflo#29 | hybridSearch Level 1→3 | Open |
| sparkling/agentic-flow#4 | InMemoryStore data loss | Open |
| sparkling/agentic-flow#5 | Dual-instance guard | Fixed |
| sparkling/agentic-flow#6 | wasmVectorSearch getController | Open |

## Upstream Creator Corrections (2026-04-06)

The following ADR-0075 findings were re-evaluated with upstream creator perspective:

- **HybridBackend is NOT dead code** — it is deferred. Upstream plans to revive it as the
  production default: SQLite for structured queries + RVF for vector search, routed by query type.
  `testRvf()=true` is a temporary short-circuit while RVF path was being stabilized.
- **sql.js fallback is intentional** — serves real edge environments (Vercel, Cloudflare Workers,
  Docker minimal) where native better-sqlite3 is unavailable
- **VectorDb (@ruvector/core) HNSW is the performance tier** — not redundant with HnswLite
  (which is the JS fallback). Different performance tiers, both intentional.
- **AgentDBService IS scaffolding** — upstream confirms it's going away; shim approach aligns
  with their roadmap
  - *ADR-0085 finding (2026-04-13)*: No concrete AgentDBService class ever existed.
    The term was a conceptual role. Comment reference removed from controller-intercept.
- **memory-bridge.ts encapsulates edge-case handling** — wholesale deletion risks regression;
  upstream recommends extracting specific functions, not deleting
  - *ADR-0085 resolution (2026-04-13)*: Followed this recommendation exactly — extracted
    `getRegistry()` + 8 helpers into memory-router.ts, then deleted the remaining 3,424
    lines. All 9 local fallback paths verified safe by 12-agent validation swarm.
    The `listEntries` empty-result fallthrough bug (identified by this ADR) was confirmed
    fixed by the deletion.

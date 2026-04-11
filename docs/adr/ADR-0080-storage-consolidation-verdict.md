# ADR-0080: Storage Consolidation Verdict

- **Status**: Implemented
- **Date**: 2026-04-11
- **Implemented**: 2026-04-11
- **Deciders**: Henrik Pettersen
- **Methodology**: Hive deliberation (Queen + 7 experts + 2 Devil's Advocates)
- **Depends on**: ADR-0075 (Architecture State Assessment), ADR-0076 (Consolidation Plan), ADR-0077 (Upstream-Compatible Revision)

## Context

A 10-agent hive council audited the storage system after ADR-0076 Phases 0-4 were
implemented. The council comprised a queen (synthesis), 7 domain experts (RVF backend,
SQLite/AgentDB, JSON flat files, graph storage, data flow, config chain, performance),
and 2 devil's advocates (one arguing radical simplification, one arguing against further
consolidation).

### Current State: What's on disk

| Engine | File | Size | Status |
|--------|------|------|--------|
| SQLite (`better-sqlite3`) | `.swarm/memory.db` + WAL | 1.2MB | De facto primary — contains all historical data |
| RVF binary | `.swarm/memory-rvf.sqlite` | 4KB | Nearly empty — migration never completed |
| RuVector Graph | `.swarm/memory.graph` | 1.5MB | Conditionally active (gated on `@ruvector/graph-node`) |
| JSON flat files | `.claude-flow/data/*.json` | 2.6MB | 15+ files, intelligence/hooks/metrics/state |

### Current State: What code exists

| ADR-0076 Phase | Goal | Status |
|----------------|------|--------|
| 0 | Dead code removal | Complete |
| 1 | Single config resolution (`resolve-config.ts`) | Complete |
| 2 | Single embedding pipeline (`embedding-pipeline.ts`) | Complete |
| 3 | Single storage abstraction (`storage-factory.ts`) | Complete |
| 4 | Shared controller instances (`controller-intercept.ts`) | Complete |
| 5 | Single data flow path (`memory-router.ts`) | ~30% — router exists, 3 of 21 MCP tool files wired |

## Decision

### Three problems to fix (HIGH priority)

#### P1: RVF migration never completed

`createStorage()` routes to RvfBackend. `createDatabase()` routes to SQLiteBackend.
The controller-registry hot path uses `createStorage()`, but historical data filled
`memory.db` (340KB) through the old `createDatabase()` path. `memory-rvf.sqlite` is 4KB
(effectively empty). Two engines initialize at startup; neither is fully utilized.

**Action:** Make `createDatabase()` delegate to `createStorageFromConfig()` so all callers
converge on one factory path. Do NOT migrate historical data — let RVF accumulate going
forward while SQLite serves reads for legacy entries. Alternatively, accept SQLite as
primary and remove RVF initialization from the controller-registry hot path.

**Decision deferred** — requires measuring whether RVF provides value over SQLite at
current scale. Expert 7's analysis says no: brute-force cosine similarity on <10K entries
takes 1-5ms. HNSW speedup only manifests above ~50K vectors.

#### P2: `auto-memory-store.json` is unbounded and unprotected

1.9MB and growing. No eviction policy. No max-size cap. No dedup on write. No file
locking. Four derived files (`ranked-context.json`, `graph-state.json`,
`intelligence-snapshot.json`, `cjs-intelligence-signals.json`) rebuild from it every
session. Concurrent hook invocations (parallel agent spawning) create TOCTOU race
conditions on `ranked-context.json` and `graph-state.json` via bare `writeFileSync()`.

**Action:**
1. Cap `auto-memory-store.json` at 1,000 entries with LRU eviction
2. Add write-then-rename atomicity (write to `.tmp`, then `renameSync`)
3. Add dedup check on write (by entry ID)

#### P3: `maxElements` divergence — 9 sources, 3 different defaults, one hard throw

`maxElements` controls the HNSW index capacity. When reached, `hnsw-index.ts:265` **throws
an error** — the index refuses new insertions. This is a hard ceiling, not a soft limit.

Nine independent sources set this value with three different defaults:

| Default | Sources |
|---------|---------|
| **100,000** | `resolve-config.ts`, `rvf-backend.ts`, `controller-registry.ts`, `agentdb embedding-config.ts`, `hnsw-utils.ts` (5 sources) |
| **1,000,000** | `database-provider.ts`, `sqlite-backend.ts`, `agentdb-adapter.ts` (3 sources) |
| **10,000** | `AgentDB.ts` core fallback (1 source) |

This is dangerous for three reasons:

1. **Memory allocation divergence.** `maxElements` determines HNSW memory footprint.
   At M=23 (derived param for 768-dim): 100K vectors = ~18MB overhead; 1M vectors = ~180MB.
   A caller entering through `database-provider.ts` pre-allocates 10x more memory than one
   entering through `resolve-config.ts`.

2. **AgentDB 10K time bomb.** If AgentDB's config chain fails to propagate `maxElements`,
   it falls back to 10,000. The HNSW index throws at 10K entries while everything else
   thinks there is room for 100K-1M. This is a hard crash for users who accumulate memory.

3. **HNSW M is not adjusted for capacity.** `deriveHNSWParams()` accepts `maxElements` but
   does not use it to adjust M. M is always 23 regardless of whether the index holds 100
   or 1M entries. For small indices (<1K), M=23 wastes memory on neighbor lists. For large
   indices (>100K), M=23 may be too low for recall quality.

Note: `maxEntries` (used in `sqlite-backend.ts:591`, `agentdb-adapter.ts:1020`) is a
separate concept — a soft cap used only for health-check utilization reporting. It does NOT
enforce a limit. The divergence (100K vs 1M) means the same database shows "90% full" in
one path and "9% full" in another, but writes always succeed. This is confusing but not
dangerous.

**Action:**
1. Make `maxElements` come from one source: `resolveConfig()` at 100,000 (consensus of 5/9)
2. Wire `createDatabase()` and `AgentDB.ts` to read from `getConfig().memory.maxEntries`
   instead of hardcoding their own defaults
3. Eliminate the AgentDB 10K fallback — use `getConfig()` or fail loudly

Per-subsystem caps (SONA=1,000 patterns, QueryCache=1,000 entries, agent-memory-scope
transfer=20) are fine as-is — they are tuned to their specific access patterns, use LRU
eviction, and do not interact with `maxElements`.

### Phase 5: Do NOT implement as designed

The memory-router (`routeMemoryOp()`) **added a layer** to the data flow path instead of
reducing layers. Before Phase 5, `memory-tools.ts` imported from `memory-initializer.ts`
directly (3 layers). After Phase 5 partial wiring, the path is: MCP tool -> router ->
initializer -> bridge/fallback -> controller -> backend (4 mandatory + 2 conditional
layers).

Rewiring the remaining 18 MCP tool import sites is high-risk (upstream file modifications
= merge conflicts) for low reward (Phase 4 already fixed the cache-divergence bug).

**Action:** Abandon Phase 5 as designed. The memory-router file may remain for the 3
already-wired tool files, but no further import-site migrations.

### What NOT to do

| Action | Why not |
|--------|---------|
| Delete upstream files (`memory-bridge.ts`, `memory-initializer.ts`) | Fork-patching model — merge conflicts |
| Consolidate JSON intelligence files into SQLite | CJS subprocess workers can't import TypeScript modules — JSON is the IPC contract |
| Add more abstraction interfaces | 5 exist already (`IStorage`, `IMemoryBackend`, `IStorageContract`, `VectorBackend`, `VectorBackendAsync`) — four too many |
| Radically simplify to 3 files | Correct diagnosis but impossible under upstream-compatibility constraint |

## Council Findings (by agent)

### Expert 1 (RVF Backend)
- `createStorage()` IS in the controller-registry hot path (line 587)
- `createDatabase()` is a parallel entry point that routes to SQLite
- `tryNativeInit()` has a logic bug: returns `false` on success (line 554), so HnswLite
  always initializes redundantly even when native HNSW is loaded
- RVF is the intended primary but SQLite is the de facto primary

### Expert 2 (SQLite/AgentDB)
- Three distinct SQLite connection points targeting TWO different files (`memory.db` and
  `agentdb/agentdb.sqlite`)
- `getOrCreate()` deduplicates controllers but NOT underlying database connections
- ReasoningBank `queries.ts` has no singleton guard — each `getDb()` call can open a new
  connection
- InMemoryStore class is deleted but behavior persists: volatile arrays at
  `agentdb-service.ts` lines 160-161 activate on init failure

### Expert 3 (JSON Flat Files)
- `auto-memory-store.json` grows unboundedly — `consolidate()` appends, never prunes
- `ranked-context.json` and `graph-state.json` are redundant projections of auto-memory-store
- `intelligence.cjs` is a completely separate data silo — no write path into AgentDB
- Concurrent `writeFileSync()` calls have TOCTOU race conditions with no locking

### Expert 4 (Graph Storage)
- `memory.graph` (binary, 1.5MB) and `graph-state.json` (JSON, 80KB) are completely
  different graphs — no consolidation opportunity
- `GraphDatabaseAdapter` is gated on `@ruvector/graph-node` — may be inactive
- `memory.graph` may be an accumulating orphan from a prior session
- Graph storage serves purposes SQLite+RVF can't (hyperedges, Cypher queries)

### Expert 5 (Data Flow)
- `memory store` passes through 4 mandatory layers + 2 conditional
- sql.js fallback serializes ENTIRE database to disk on every write — O(DB size) I/O
- memory-router added a layer rather than reducing them
- Direct MCP tool -> controller -> backend path is viable and simpler

### Expert 6 (Config Chain)
- `config.json` has `maxEntries: 1,000,000` but `resolveConfig()` defaults to 100,000
- `resolveConfig()` never reads `config.json` at all
- Two competing factories with overlapping but non-identical behavior
- Config file errors are silent and absorbed; storage init errors are loud

### Expert 7 (Performance)
- Multi-engine provides NO measurable benefit at current ~5MB corpus
- HnswLite is graph-shaped but brute-force-behaved below ~50K vectors
- `auto-memory-store.json` becomes a startup bottleneck at ~10-15MB / 5K-10K entries
- WAL at 808KB (2.4x the DB) indicates uncompacted state from unclean shutdown
- Single SQLite would outperform the current stack at this scale

### Devil's Advocate 1 (Over-engineered)
- 87 TypeScript files across two packages for key-value + vector search
- 5 interface abstractions for the same concept
- Phases 0-4 added 6 files, deleted 2 — sediment, not consolidation
- `controller-intercept.ts` is a hand-rolled service locator to prevent two objects from
  creating two copies of a third object — in a clean design, there is one object

### Devil's Advocate 2 (Against consolidation)
- Different engines serve genuinely different access patterns — unifying them loses
  specialization
- Upstream creator said NOT to delete HybridBackend, memory-bridge.ts, sql.js fallback
- Phase 4 already fixed the actual bug (dual-instance cache divergence)
- Fork-patching model makes further consolidation cost-asymmetric

## Settled Values

All storage parameters converge on `resolveConfig()` as the single source of truth.
Callers that currently hardcode their own defaults (`database-provider.ts`,
`sqlite-backend.ts`, `agentdb-adapter.ts`, `AgentDB.ts`) must read from `getConfig()`
instead.

### Canonical defaults (in `resolveConfig()`)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `maxElements` | **100,000** | Consensus of 5/9 existing sources. ~18MB HNSW overhead. Headroom for growth without the 180MB cost of 1M. HNSW provides no benefit below ~50K vectors (Expert 7), so 100K gives room without waste. |
| `maxEntries` | **100,000** | Aligned with `maxElements` so health-check utilization reporting is consistent. The 1M values in `database-provider.ts` and `sqlite-backend.ts` are pre-`resolveConfig()` drift. |
| Embedding dimension | **768** | Already unified by ADR-0076 Phase 2. No divergence. |
| Embedding model | **`Xenova/all-mpnet-base-v2`** | Already unified by ADR-0069. |
| HNSW M | **23** | `deriveHNSWParams(768)` = `floor(sqrt(768) / 1.2)`. Correct for current scale. |
| HNSW efConstruction | **100** | `max(100, min(500, 4 * M))`. |
| HNSW efSearch | **50** | `max(50, min(400, 2 * M))`. |
| Storage provider | **`rvf`** | Forward direction. `createStorage()` already selects RVF. |
| Database path | **`.swarm/memory.rvf`** | `storage-factory.ts` normalizes (strips `.db`, appends `.rvf`). |
| WAL compaction threshold | **100 entries** | Current value is fine. 808KB WAL was from unclean shutdown, not a bad threshold. |
| Auto-persist interval | **30 seconds** | Appropriate for CLI session lifetimes. |

### Per-subsystem caps (unchanged — correctly tuned)

| Subsystem | Cap | Eviction | Rationale |
|-----------|-----|----------|-----------|
| `auto-memory-store.json` | **1,000 entries** (NEW) | LRU (drop oldest) | ~2KB/entry = ~2MB max. Well under 10-15MB startup bottleneck (Expert 7). |
| SONA patterns | 1,000 | LRU | Already correct. |
| QueryCache | 1,000 entries, 5min TTL | LRU | Only useful in long-running daemons, harmless in CLI. |
| Agent memory scope transfer | 20 per transfer | Hard limit | Per-operation, not global. Appropriate. |

### Values NOT changed

| Parameter | Value | Why unchanged |
|-----------|-------|---------------|
| HNSW M adjustment for capacity | Not implemented | Only matters at 500K+ vectors. CLI tool will not reach this. |
| `dedupThreshold` | 0.95 | Already unified in `resolveConfig()`. No divergence found. |
| `defaultNamespace` | `"default"` | Already unified. |

### Where the 9 sources must change

| Source | Current default | Action |
|--------|----------------|--------|
| `resolve-config.ts` | 100,000 | **No change** — this is the authority |
| `rvf-backend.ts` | 100,000 | No change (reads from config when passed) |
| `controller-registry.ts` | 100,000 | No change (aligned) |
| `agentdb embedding-config.ts` | 100,000 | No change (aligned) |
| `hnsw-utils.ts` | 100,000 | No change (default param, aligned) |
| `database-provider.ts` | **1,000,000** | **Change to `getConfig().memory.maxEntries`** |
| `sqlite-backend.ts` | **1,000,000** | **Change to `getConfig().memory.maxEntries`** |
| `agentdb-adapter.ts` | **1,000,000** | **Change to `getConfig().memory.maxEntries`** |
| `AgentDB.ts` (core) | **10,000** | **Change to `getConfig().memory.maxEntries`** — eliminates hard-throw time bomb |

## Priority Scorecard

| Aspect | Optimal? | Priority | Action |
|--------|----------|----------|--------|
| `maxElements` divergence (P3) | No — **crash risk** | **Critical** | Single source via `resolveConfig()`, kill AgentDB 10K fallback |
| JSON races / unbounded growth (P2) | No — **data loss risk** | **High** | Cap, dedup, atomic writes |
| RVF half-migration (P1) | No | **High** | Converge factory paths |
| Phase 5 data flow | Excessive | **Abandon** | Do not rewire remaining 18 tool files |
| Controller intercept (Phase 4) | Yes | Done | No action needed |
| HnswLite at current scale | Fine | Low | Irrelevant below 50K vectors |
| Graph storage | Unknown | Low | Check if `@ruvector/graph-node` is installed |
| Data flow layer count | Excessive | Low | Don't add more; don't rewire |
| Per-subsystem caps (SONA, QueryCache) | Yes | None | Correctly tuned to their access patterns |

## Phase 2: Init Script Audit Findings

A 5-agent audit swarm examined the init scripts, config generation, and remaining
divergences after Phase 1 implementation. Findings:

### P4: Init script config generation gaps (HIGH)

#### P4-A: `embedding.provider` mismatch
`config-template.ts` generates `provider: 'transformers'` but resolve-config canonical
default is `'transformers.js'`. Every init'd project gets the wrong provider string via
Layer 2 of resolveConfig.

**Fix:** Change `config-template.ts` provider from `'transformers'` to `'transformers.js'`.

#### P4-B: `embeddings.json` missing 7 fields resolveConfig reads
`executor.ts` writes only `model`, `dimension`, `provider` to `embeddings.json`.
resolveConfig Layer 2 also reads: `storageProvider`, `databasePath`, `walMode`,
`autoPersistInterval`, `maxEntries`, `defaultNamespace`, `dedupThreshold`. None of
these are written, so they always fall through to Layer 4 hardcoded defaults.

**Fix:** Add the 7 missing fields to the `embeddings.json` write block in `executor.ts`.

#### P4-C: `embeddingModel`/`embeddingDim` never passed to ConfigOverrides
`executor.ts:1219-1223` builds ConfigOverrides but never passes `embeddingModel` or
`embeddingDim` from user options. `config.json` embeddings block always gets template
defaults, ignoring `--embedding-model`.

**Fix:** Pass `options.embeddings.model` and `options.embeddings.dimension` into
ConfigOverrides.

#### P4-D: Wizard default model is non-canonical
`commands/init.ts:511` wizard `--embedding-model` defaults to
`nomic-ai/nomic-embed-text-v1.5`, not `Xenova/all-mpnet-base-v2`.

**Fix:** Change wizard default to `Xenova/all-mpnet-base-v2`.

### P5: Remaining maxEntries divergences (MEDIUM)

#### P5-A: `memory-bridge.ts:238` fallback 1000000 + wrong key path
Reads from `cfgJson.memory?.storage?.maxEntries` (nested `.storage.` subkey that init
doesn't generate), falls back to 1000000.

**Fix:** Change to `cfgJson.memory?.maxEntries ?? 100000` and drop `.storage.` nesting.

#### P5-B: `config-tools.ts:27` MCP DEFAULT_CONFIG stale
Has `memory.maxEntries: 10000` — flat key, wrong value (should be 100000).

**Fix:** Change to `100000`.

### P6: Store format mismatch (MEDIUM)

#### P6-A: Generated consolidate writes `{ entries: [] }`, runtime expects flat array
`helpers-generator.ts` consolidate writes `{ entries: entries }` but runtime
`intelligence.cjs` init reads with `Array.isArray(store)`. Mismatch causes silent
data discard when upgrading from generated stub to full runtime.

**Fix:** Change generated consolidate to write flat array: `writeJSON(STORE_PATH, entries)`.

### P7: Minor init issues (LOW)

#### P7-A: `settings-generator.ts:133` — `maxNodes: 10000` hardcoded
Ignores `options.runtime.maxNodes`. Fix: use `options.runtime.maxNodes ?? 10000`.

#### P7-B: `types.ts:597` — `cacheSize: 384` dead value
`FULL_INIT_OPTIONS.runtime.cacheSize` is never read by settings-generator (which
hardcodes 256). Fix: change to `256` or remove.

#### P7-C: `config-template.ts` — `hnsw.m` lowercase
resolve-config uses `M` uppercase. Cosmetic — HNSW params are derived, not read
from config.

## Consequences

- P3 fix eliminates the AgentDB 10K hard-throw time bomb and the 10x memory over-allocation
  from `database-provider.ts`. All HNSW indices share one capacity value from `resolveConfig()`
- P1/P3 fixes together converge on a single factory path, eliminating config divergence
- P2 fix prevents data loss from concurrent hook writes and caps unbounded JSON growth
- Abandoning Phase 5 saves 18 upstream file modifications worth of merge conflict risk
- The storage system remains multi-engine (SQLite + RVF + Graph + JSON) but with clear
  ownership boundaries instead of competing factory paths
- Per-subsystem caps (SONA=1K, QueryCache=1K, agent-scope=20) are preserved — these are
  correctly sized for their specific access patterns and are not part of the `maxElements`
  unification

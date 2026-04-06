# ADR-0074: Controller Wiring & Storage Architecture Audit

- **Status**: Accepted
- **Date**: 2026-04-06
- **Scope**: ADR-0068 through ADR-0072 post-implementation audit
- **Method**: Hive analysis — Queen (Reuven Cohen) + 5 ruflo specialist agents + 3 Explore agents
- **Deciders**: Henrik Pettersen

## Context

ADR-0068 through ADR-0072 represent a five-ADR wave that unified controller configuration, delegated controller wiring, consolidated fork branches, built native binaries from source, and added init-config acceptance tests. This ADR captures a comprehensive post-implementation audit of the resulting state: controller counts, storage backends, config chain completeness, upstream ADR alignment, and consistency assessment.

## 1. Controller Wiring: From 44 to 45

### Census

| Metric | Count | Source |
|--------|-------|--------|
| Declared in INIT_LEVELS (L0-L6) | **45** | controller-registry tests, ADR-0061 |
| In AgentDB `getController()` switch | **28** | AgentDB.ts fork source |
| Feature-flagged in `controllers.enabled` | **12** | config.json lines 65-78 |
| Fully working | **17** | ADR-0061 15-agent verification |
| Broken (missing args/cases) | **6** | ADR-0061 bugs #1-6 |
| Placeholders (return null) | **3** | hybridSearch, federatedSession, agentMemoryScope |
| Not exported from AgentDB barrel | **4** | L0 security controllers |
| Disabled | **1** | learningBridge |

The net change from 44 to 45 is `federatedLearningManager` added at Level 4.

### Full 45-Controller Map by Init Level

**Level 0** — Security (4): `resourceTracker`, `rateLimiter`, `circuitBreaker`, `telemetryManager`

**Level 1** — Core Memory (7): `reasoningBank`, `hierarchicalMemory`, `learningBridge`, `hybridSearch`, `tieredCache`, `solverBandit`, `attentionMetrics`

**Level 2** — Graph & Attention (11): `memoryGraph`, `agentMemoryScope`, `vectorBackend`, `mutationGuard`, `gnnService`, `selfAttention`, `crossAttention`, `multiHeadAttention`, `attentionService`, `nativeAccelerator`, `queryOptimizer`

**Level 3** — Skills & Consolidation (8): `skills`, `explainableRecall`, `reflexion`, `attestationLog`, `batchOperations`, `memoryConsolidation`, `enhancedEmbeddingService`, `auditLogger`

**Level 4** — Learning (6): `causalGraph`, `nightlyLearner`, `learningSystem`, `semanticRouter`, `selfLearningRvfBackend`, `federatedLearningManager`

**Level 5** — Advanced (7): `graphTransformer`, `sonaTrajectory`, `contextSynthesizer`, `rvfOptimizer`, `mmrDiversityRanker`, `guardedVectorBackend`, `quantizedVectorStore`

**Level 6** — Federation (2): `federatedSession`, `graphAdapter`

### The 3-Layer Duplication Problem (partially resolved)

| Layer | File | Controllers | Status |
|-------|------|-------------|--------|
| **AgentDB core** | `AgentDB.ts` | 8 eager, 28 in switch | Infrastructure provider |
| **AgentDBService** | `agentdb-service.ts` (1,679 lines) | 29 objects, 13 overlap | **10 now delegate** to AgentDB via F1 |
| **ControllerRegistry** | `controller-registry.ts` | 45 names, L0-L6 | CLI entry point |

ADR-0069 F1 resolved delegation for 10 controllers: reflexion, skills, reasoning, causal, causalRecall, learning, vectorBackend, attentionService, nightlyLearner, explainableRecall. 2 remain directly constructed (HierarchicalMemory, MemoryConsolidation — AgentDB lazy init passes fewer params). 13 agentic-flow-specific stay in AgentDBService (Phase 2/4 distributed, WASM, embedding).

### Feature Flag Coverage Gap

12 of 45 controllers have explicit feature flags. The other 33 are controlled only by init-level ordering:

| Enabled | Disabled | Missing flag (33 controllers) |
|---------|----------|-------------------------------|
| reasoningBank | queryOptimizer | resourceTracker, rateLimiter (2 more L0) |
| causalRecall | auditLogger | learningBridge, tieredCache, solverBandit (3 more L1) |
| nightlyLearner | batchOperations | memoryGraph, vectorBackend, mutationGuard (8 more L2) |
| attentionService | hierarchicalMemory | skills, explainableRecall, reflexion (3 more L3) |
| agentMemoryScope | memoryConsolidation | causalGraph, learningSystem, semanticRouter (3 more L4) |
| | hybridSearch | all 7 L5 controllers |
| | federatedSession | |

## 2. Storage Architecture

### 12 Storage Backends Identified

| # | Backend | Format | Data Path | Interface | Status |
|---|---------|--------|-----------|-----------|--------|
| 1 | **SQLiteBackend** (better-sqlite3) | SQLite WAL, 24 tables | `.swarm/memory.db` | `IMemoryBackend` | **PRIMARY** — all CLI/MCP memory |
| 2 | **AgentDBBackend** | SQLite (same file) | `.swarm/memory.db` | `IMemoryBackend` | **ACTIVE** — HybridBackend layer |
| 3 | **RvfBackend (ruflo)** | Custom `RVF\0` + JSON | `.swarm/memory-rvf.sqlite` | `IMemoryBackend` | **ACTIVE** — default in `auto` mode, pure-TS HnswLite |
| 4 | **RvfBackend (agentdb)** | Real `@ruvector/rvf` binary | Via NAPI bindings | `VectorBackendAsync` | **NOT INSTALLED** — tryNativeInit broken |
| 5 | **HybridSearchController** | BM25 + HNSW fusion | In-memory + IMemoryBackend | Controller | **IMPLEMENTED** — disabled in config |
| 6 | **FederatedSessionController** | Session state sync | In-memory + IMemoryBackend | Controller | **IMPLEMENTED** — disabled in config |
| 7 | **JsonFileBackend** (CJS hooks) | 5 JSON + 1 JSONL | `.claude-flow/data/*.json` | Ad hoc | **ACTIVE** — emergency fallback, permanent accumulation |
| 8 | **HNSW binary index** | RuVector binary | `.swarm/memory.graph` | Direct | **ACTIVE** — 1.5 MB vector index |
| 9 | **CausalMemoryGraph** | In-memory edges + SQL | SQLite via recursive CTEs | Controller | **ACTIVE** — A/B experiments, do-calculus |
| 10 | **SONA patterns** | JSON array | `.swarm/sona-patterns.json` | Ad hoc | **ACTIVE** — 2-10 routing heuristic entries |
| 11 | **Swarm state** | JSON | `.swarm/swarm-state.json` | Ad hoc | **ACTIVE** — topology + agent status |
| 12 | **In-memory Maps** | Process memory | Volatile | AgentDBService fallback | **ACTIVE** — fallback when SQLite unavailable |

### The Two RvfBackend Classes

| | ruflo RvfBackend | agentdb RvfBackend |
|---|---|---|
| **Location** | `@claude-flow/memory/src/rvf-backend.ts` | `agentdb/src/backends/rvf/RvfBackend.ts` |
| **Interface** | `IMemoryBackend` (17 methods) | `VectorBackendAsync` (raw floats) |
| **HNSW** | Pure-TS HnswLite (**works**) | Delegates to `@ruvector/rvf` (**brute-force O(n)**) |
| **Native upgrade** | `tryNativeInit()` opens handle but **never routes I/O** | Direct `@ruvector/rvf` |
| **Production role** | **Default backend** | Via `SelfLearningRvfBackend` controller |

Both kept intentionally — different interfaces, different purposes.

### CJS/ESM Dual Silo (Critical)

Two completely independent storage systems exist:

| System | Backend | Storage | Entries | Search |
|--------|---------|---------|---------|--------|
| **AgentDB (ESM)** | SQLite | `.swarm/memory.db` | 17 | cosine + HNSW |
| **CJS Intelligence** | JSON files | `.claude-flow/data/*.json` | 157 deduped / 4,482 raw | PageRank + trigram |

**Root cause**: `auto-memory-hook.mjs:235` calls `createBackend("hybrid")` → tries AgentDBBackend → `import('@sparkleideas/agentdb')` fails in hook subprocess → silent fallback to JsonFileBackend → JSON cache never drains to SQLite.

Hook intelligence data (PageRank graphs, pattern learning, ranked context) is permanently siloed from AgentDB. Tracked as ADR-0059 Phase 1 fix.

### GraphDB Status: Dead Code (correctly deferred)

| Finding | Detail |
|---------|--------|
| `@ruvector/graph-node` | **NOT installed** — Phase 2.3 always fails |
| `graphAdapter` | Always `null` regardless of config |
| `storeGraphState()` | Writes to void — data unqueryable |
| `queryGraph()` | Ignores graphAdapter, delegates to causalRecall (SQLite) |
| `graphBackend` param | Accepted in constructors, never read |

SQLite CausalMemoryGraph handles all graph operations: recursive CTE traversal, A/B experiments, do-calculus (`E[Y|do(X)] - E[Y]`), confounder detection, HNSW similarity. Only concern: O(path_length * edges) cycle guard degrades at tens of thousands of densely connected nodes — well beyond current scale.

**Trigger to reconsider**: User needs bidirectional pathfinding, subgraph pattern matching, or cycle detection at scale that SQLite recursive CTEs cannot express.

### SQL Configuration — Unified

| Pragma | Value | Config Key | Status |
|--------|-------|------------|--------|
| `cache_size` | `-64000` (64 MB) | `memory.sqlite.cacheSize` | **Unified** (was -64000 vs 10000) |
| `busy_timeout` | `5000ms` | `memory.sqlite.busyTimeoutMs` | **Unified** (was missing at 3 WAL sites) |
| `journal_mode` | `WAL` | `memory.sqlite.journalMode` | **Unified** |
| `synchronous` | `NORMAL` | `memory.sqlite.synchronous` | **Unified** |

`sql.js` and `json` backend types removed from `database-provider.ts` (ADR-0068 P3-1). Only `better-sqlite3` and `rvf` remain.

## 3. Config Chain Completeness

### embeddings.json — Complete

```json
{
  "model": "Xenova/all-mpnet-base-v2",
  "dimension": 768,
  "hnsw": {
    "m": 23, "efConstruction": 100, "efSearch": 50,
    "metric": "cosine", "maxElements": 100000
  }
}
```

Derived from `deriveHNSWParams(768)`: `floor(sqrt(768)/1.2)=23`, `clamp(4*23,100,500)=100`, `clamp(2*23,50,400)=50`. Shared via `hnsw-utils.ts`.

### config.json — All 14 New Keys Wired

| ID | Category | Config Key | Default | Remediated |
|----|----------|-----------|---------|------------|
| A1 | SQLite pragmas | `memory.sqlite.*` | -64000/5000/WAL/NORMAL | **Yes** — all 9 sites |
| A2 | Rate limiters | `rateLimiter.*` (5 presets) | 100/60s | **Yes** — 4 per-min sites |
| A3 | Worker timeouts | `workers.triggers.*` (8 workers) | 90s-300s | **Yes** — canonical resolver |
| A4 | Swarm directory | `.swarm` standardized | — | **Yes** — 3 outlier sites fixed |
| A5 | EWC lambda | `neural.ewcLambda` | 2000 | **Yes** — 5 sites + normalized conversion |
| A6 | Port numbers | `ports.*` (5 ports) | 3000/3001/4433/8443/8080 | **Yes** — all env-var guarded |
| A7 | Similarity threshold | `memory.similarityThreshold` | 0.7 | **Yes** — search default fixed from 0.5 |
| A8 | Learning rates | `neural.learningRates.*` (5 algos) | 0.001-0.1 | **Yes** — 13 sites |
| A9 | Embedding cache | `memory.embeddingCacheSize` | 1000 | **Yes** — 10x discrepancy fixed |
| A10 | Migration batch | `memory.migrationBatchSize` | 500 | **Yes** — aligned from 100 |
| A11 | Dedup threshold | `memory.dedupThreshold` | 0.95 | **Yes** — unified (was 0.95 vs 0.98) |
| A12 | Model divergence | Config chain alignment | 768-dim | **Yes** — ONNX aligned |
| A13 | Cleanup intervals | `memory.cleanupIntervalMs` | 60000 | **Yes** — 5 sites |
| A15 | Service URLs | Env vars | — | **Yes** — OLLAMA_URL, RUVLLM_URL |

All 11 originally dead config keys now wired. Zero known residual bypass sites after the 36-site remediation round.

### Controller Tuning Sections — 13 in config.json

nightlyLearner, causalRecall, queryOptimizer, selfLearningRvfBackend, mutationGuard, attentionService, multiHeadAttention, selfAttention, rateLimiter, circuitBreaker, tieredCache, quantizedVectorStore, solverBandit.

**EWC Lambda dual-scale**: `neural.ewcLambda=2000` (absolute) vs `controllers.nightlyLearner.ewcLambda=0.5` (normalized `absolute/4000`). Intentional — different consumption contexts.

## 4. Upstream ADR & Issue Reference Map

### ADRs Referenced by ADR-0068 through ADR-0072

| Upstream ADR | Topic | Status | Key Finding |
|-------------|-------|--------|-------------|
| **ADR-028** | Neural Attention (39 mechanisms) | **F3 Implemented** | 2 WASM modules published; JS fallback covers 5 |
| **ADR-029** (RuVector) | RVF Canonical Format | **Accepted** | rvf-index has HNSW but rvf-runtime doesn't depend on it |
| **ADR-040** | Singleton injection | **Implemented** | AgentDB.initialize() passes singletons (ADR-0068 W1-1) |
| **ADR-053** | ControllerRegistry | **Phase 1 done** | Phases 2-6 deferred; ADRs 0033-0066 filling incrementally |
| **ADR-055** | getController() reliability | **Superseded** | Was 5 reliable names → now 28 in switch via ADR-0068 W1-2 |
| **ADR-056** | vectorBackend wiring | **Implemented** | MCP server correctly wires per pattern |
| **ADR-064** | Stub remediation | **Implemented** | 22 stubs done; dimension resolution via getEmbeddingConfig() |

### 12 RuVector RVF ADRs

| # | ADR | Status | Relevance |
|---|-----|--------|-----------|
| 1 | 029 — RVF Format | Accepted | Core format spec; partial implementation |
| 2 | 030 — Cognitive Container | Proposed | Not relevant yet |
| 3 | 031 — Example Repository | Accepted | Educational |
| 4 | 032 — WASM Integration | Accepted | Relevant for F2 |
| 5 | 033 — Progressive Indexing | Accepted | **Not wired into rvf-runtime** |
| 6 | 037 — Acceptance Tests | Accepted | Witness-chain benchmarks |
| 7 | 039 — Solver WASM | **Implemented** | Thompson Sampling in 160KB WASM |
| 8 | 042 — Security TEE | Accepted | Future |
| 9 | 056 — Knowledge Export | Accepted | RVF segments |
| 10 | 057 — Federated Learning | Proposed | Differential privacy — future |
| 11 | 063 — RVF Optimizer | **Implemented** | 2-8x compression |
| 12 | 075 — mcp-brain-server | **Implemented** | rvf-crypto replacement |

### Upstream Issues

| Issue | Topic | Status |
|-------|-------|--------|
| **#315** | RVF import/recall empty | **Misattributed** — RvfStore has no HNSW; rvf-index disconnected |
| **#316** | Sync embed() = hash vectors | **By design** — enforce async-only |
| **#318** | importAsync() PR | **Open**, unmerged |
| **#323** | Node 22 ONNX .wasm error | **Workaround exists** |
| **#274** | SONA persistence | **APPLIED** via cherry-pick |
| **#1228** | ADR-053 phases 2-6 | Open — tracking |
| **#1516** | Config forwarding gap | **Addressed** by ADR-0068 |

## 5. Consistency & Soundness Assessment

### What's Sound

1. **Config chain is complete**: 86+ hardcoded sites → 14 config keys, all wired, zero known residuals
2. **Embedding unification is solid**: Single model (Xenova/all-mpnet-base-v2, 768-dim), single HNSW formula, shared via embeddings.json + hnsw-utils.ts
3. **SQLite pragmas unified**: cache_size, busy_timeout, journal_mode, synchronous — consistent across all sites
4. **Controller delegation works**: 10/12 migratable controllers delegate to AgentDB
5. **Acceptance tests comprehensive**: 148/148 pass including 23 Phase 5 init-config checks
6. **Native binaries traceable**: SHA-based versioning from fork HEAD
7. **Fork branches consolidated**: All 4 forks build from main

### Issues Requiring Attention

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | **CJS/ESM dual silo** — hook JSON cache never drains to AgentDB | **HIGH** | Intelligence data permanently split; hook patterns invisible to CLI searches |
| 2 | **rvf-runtime has no HNSW** — rvf-index exists but Cargo.toml doesn't wire it | **MEDIUM** | NAPI bindings accept HNSW params and silently ignore them; queries O(n) |
| 3 | **33 controllers lack feature flags** — only 12/45 toggleable | **MEDIUM** | No operator control over 73% of controllers |
| 4 | **6 broken controllers in getController()** — ADR-0061 bugs #1-6 | **MEDIUM** | Missing args, missing cases — not fixed by ADR-0068-0072 |
| 5 | **Dimension mismatch in residual paths** — 4 different defaults (128, 384, 768, 1536) in historical code | **LOW** | ADR-0068/0069 remediated primary paths; residual in unused/test code |
| 6 | **QUIC federation is a stub** — `sleep(100)` + hardcoded `{success: true}` | **LOW** | No real network layer; enabling produces silent fake-success |
| 7 | **Two RvfBackend classes** — different interfaces, confusing naming | **LOW** | Intentional, documented |
| 8 | **GraphDB dead code** — graphAdapter always null, writes to void | **LOW** | Correctly deferred; SQLite CTEs sufficient |

## Decision

This ADR records the audit findings as the authoritative post-implementation state after the ADR-0068-0072 wave, plus a detailed fix plan for Issue #1 (CJS/ESM dual silo).

### Recommended Priority for Follow-Up

1. **Issue #1 fix** (HIGH): CJS/ESM dual silo — detailed plan below
2. **Feature flag expansion** (MEDIUM): Add `controllers.enabled` entries for the 33 un-flagged controllers
3. **ADR-0061 bug fixes** (MEDIUM): Fix 6 broken getController() cases
4. **rvf-runtime HNSW wiring** (MEDIUM): Wire rvf-index into rvf-runtime Cargo.toml — turns queries from O(n) to O(log n)

## 6. Issue #1 Fix Plan: CJS/ESM Dual Silo

### Analysis Method

Hive analysis — Queen (Reuven Cohen) + 4 silo-fix specialists:
- Agent 1: Hook backend resolution tracing
- Agent 2: RvfBackend export chain verification
- Agent 3: Intelligence.cjs silo architecture

### Root Cause Chain

The dual silo has two independent root causes that compound:

**Root Cause A: `loadMemoryPackage()` returns null**

`auto-memory-hook.mjs` lines 133-169 try 4 strategies to load `@sparkleideas/memory`:

| Strategy | Path | Why It Fails |
|----------|------|-------------|
| 1. Local dev dist | `v3/@sparkleideas/memory/dist/index.js` | Doesn't exist in ruflo-patch (we BUILD it, not consume it) |
| 2. CJS require | `require('@sparkleideas/memory')` | Not in ruflo-patch's `node_modules` |
| 3. ESM import | `import('@sparkleideas/memory')` | Same — not installed |
| 4. Walk-up tree | `node_modules/@claude-flow/memory/dist/index.js` | **BUG**: searches for `@claude-flow/memory` (line 159), not `@sparkleideas/memory` — wrong package name after scope rename. Even if installed, this strategy would never find it. |

**Bug in Strategy 4** (line 159): The walk-up path uses the pre-rename scope `@claude-flow/memory` instead of the published name `@sparkleideas/memory`. This is a codemod gap — the hook file lives in `.claude/helpers/` which is outside the codemod's source tree. Even if the package were installed in a parent `node_modules`, Strategy 4 would miss it.

The package DOES exist in the npm npx cache (`~/.npm/_npx/.../node_modules/@sparkleideas/memory/`) but none of the 4 strategies search there.

When all 4 fail, `loadMemoryPackage()` returns `null`. The hook prints "Memory package not available — skipping auto memory import" and exits. `createBackend()` is never reached. The RvfBackend preference code (ADR-0059, lines 295-298) is dead — it can never execute.

**In user-installed projects** (via `npx @sparkleideas/cli init`), `@sparkleideas/memory` IS installed as a transitive dependency of `@sparkleideas/cli`. Strategy 2 or 3 succeeds, RvfBackend loads, and data persists to `.swarm/agentdb-memory.rvf`. The silo does NOT exist for end users with packages installed.

**In this dev repo** (ruflo-patch), the package is never installed because we build it from fork source and publish it. The hook always falls through to the inline `JsonFileBackend` fallback at the top of the file, or skips entirely.

**Root Cause B: intelligence.cjs has zero AgentDB integration**

`intelligence.cjs` is a pure CJS system with no imports of `@sparkleideas/memory`, `agentdb`, or `sql.js`. Its data flow is entirely JSON-to-JSON:

```
auto-memory-store.json → intelligence.cjs → graph-state.json
                                           → ranked-context.json
                                           → pending-insights.jsonl
                                           → intelligence-snapshot.json
```

There is no drain path. PageRank scores, confidence boosts, access counts, and pattern insights computed by intelligence.cjs are invisible to AgentDB. The `consolidate()` function (session-end) writes back to `auto-memory-store.json` but never to `.swarm/memory.db`.

### intelligence.cjs Data Lifecycle

```
SessionStart:
  intelligence.init()
  ├─ Reads auto-memory-store.json (4,485 entries, 1.9MB)
  ├─ Builds graph (160 nodes, trigram Jaccard similarity edges)
  ├─ Computes PageRank (0.85 damping, 30 iterations)
  └─ Writes graph-state.json + ranked-context.json

UserPromptSubmit (every prompt):
  intelligence.getContext(prompt)
  ├─ Reads ranked-context.json
  ├─ Matches via trigram similarity → top-5
  └─ Returns formatted context to hook router

PostEdit (every file edit):
  intelligence.recordEdit(file)
  └─ Appends to pending-insights.jsonl

PostTask (agent completes):
  intelligence.feedback(success)
  ├─ Boosts confidence of matched patterns (+0.05 success, -0.02 fail)
  └─ Writes cjs-intelligence-signals.json (capped at 100)

SessionEnd:
  intelligence.consolidate()
  ├─ Processes pending-insights.jsonl (hot files → insight entries)
  ├─ Applies confidence decay to unaccessed entries (0.005/day, floor 0.05)
  ├─ Rebuilds edges + recomputes PageRank
  └─ Writes updated graph-state.json + ranked-context.json + auto-memory-store.json
```

### Accumulation Bounds

| File | Bounded? | Mechanism | Current Size |
|------|----------|-----------|-------------|
| `auto-memory-store.json` | **NO** | Grows every `doImport()` | 4,485 entries, 1.9 MB |
| `graph-state.json` | Soft | Rebuild proportional to store | 160 nodes, 84 KB |
| `ranked-context.json` | Soft | Same size as store | 212 KB |
| `pending-insights.jsonl` | **YES** | Cleared on `consolidate()` | 153 lines, 24 KB |
| `intelligence-snapshot.json` | **YES** | Capped at 50 snapshots | 292 KB |
| `cjs-intelligence-signals.json` | **YES** | Capped at 100 entries each | 705 lines |

The primary accumulator (`auto-memory-store.json`) has no eviction policy and will grow indefinitely.

### Fix Plan

The fix is a 3-phase approach that addresses both root causes independently:

#### Phase 1: Make the memory package loadable in dev (Root Cause A)

**File**: `.claude/helpers/auto-memory-hook.mjs`, function `loadMemoryPackage()`

Two changes:

**1a. Fix Strategy 4 bug** (line 159): Change `@claude-flow/memory` to `@sparkleideas/memory`:

```javascript
// BEFORE (wrong scope — codemod gap):
const candidate = join(searchDir, 'node_modules', '@claude-flow', 'memory', 'dist', 'index.js');

// AFTER (correct published scope):
const candidate = join(searchDir, 'node_modules', '@sparkleideas', 'memory', 'dist', 'index.js');
```

**1b. Add Strategy 0** for dev-mode resolution from fork source:

```javascript
// Strategy 0: Dev mode — resolve from fork source (ruflo-patch builds this package)
const forkDist = join(PROJECT_ROOT, '..', 'forks', 'ruflo', 'v3',
  '@claude-flow', 'memory', 'dist', 'index.js');
if (existsSync(forkDist)) {
  try { return await import(`file://${forkDist}`); } catch { /* fall through */ }
}

// Strategy 0b: Verdaccio-installed (after npm run build / npm run publish:verdaccio)
const verdaccioPath = join(PROJECT_ROOT, 'node_modules', '@sparkleideas',
  'memory', 'dist', 'index.js');
if (existsSync(verdaccioPath)) {
  try { return await import(`file://${verdaccioPath}`); } catch { /* fall through */ }
}
```

**Why this works**: In dev, the fork is always at `/Users/henrik/source/forks/ruflo/`. The dist exists after `npm run build` in the fork. For users, existing Strategies 1-4 (with bug fix) continue to work. The Strategy 4 fix also unblocks users who have `@sparkleideas/memory` installed in a parent `node_modules`.

**Risk**: LOW — adds two `existsSync` checks before the existing strategies. Falls through on failure. No behavioral change for users except the Strategy 4 bug fix.

**Alternative (simpler)**: Add `@sparkleideas/memory` as a `devDependency` of ruflo-patch, installed from Verdaccio. This makes Strategies 2/3 work in dev. Requires Verdaccio to be running at `npm install` time.

#### Phase 2: Add drain path from intelligence.cjs → AgentDB (Root Cause B)

**File**: `.claude/helpers/intelligence.cjs`, function `consolidate()`

At the end of `consolidate()`, after graph rebuild + PageRank recomputation, add a drain step that writes enriched entries to the RVF/AgentDB store:

```javascript
// Phase 2: Drain enriched entries to persistent store at session boundary
async function drainToBackend(enrichedEntries) {
  const memPkg = await loadMemoryPackage(); // Reuse from auto-memory-hook.mjs
  if (!memPkg?.RvfBackend) return; // No drain if package unavailable

  const swarmDir = path.join(PROJECT_ROOT, '.swarm');
  const backend = new memPkg.RvfBackend({
    databasePath: path.join(swarmDir, 'agentdb-memory.rvf')
  });
  await backend.initialize();

  // Upsert top-N entries with PageRank + confidence metadata
  const topEntries = enrichedEntries
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 500); // Cap drain to top 500

  for (const entry of topEntries) {
    await backend.store({
      ...entry,
      metadata: {
        ...entry.metadata,
        pageRank: entry.pageRank,
        confidence: entry.confidence,
        accessCount: entry.accessCount,
        drainedAt: Date.now(),
      }
    });
  }

  await backend.shutdown();
}
```

**Why this works**: intelligence.cjs already has the enriched entries (with PageRank, confidence, access counts) in memory at `consolidate()` time. The drain writes the top 500 to `.swarm/agentdb-memory.rvf`, which is the same file `auto-memory-hook.mjs` reads. This closes the loop: patterns learned by intelligence.cjs become visible to CLI `memory search`.

**Challenge**: intelligence.cjs is CJS, but `loadMemoryPackage()` is ESM. The drain function needs to either:
- (a) Use dynamic `import()` (supported in CJS via `.then()` syntax) to load the ESM module
- (b) Be called from `auto-memory-hook.mjs` `doSync()` instead, passing the enriched data via a shared JSON file
- (c) Use a new `intelligence-drain.mjs` ESM wrapper called from `hook-handler.cjs`

Option (b) is lowest risk: `intelligence.consolidate()` writes `ranked-context.json` (already does this), then `doSync()` in `auto-memory-hook.mjs` reads `ranked-context.json` and upserts top entries into RvfBackend. No CJS/ESM boundary crossing needed.

**Risk**: MEDIUM — adds write load at session-end. Capped at 500 entries. RvfBackend atomic persist prevents corruption.

#### Phase 3: Cap auto-memory-store.json accumulation

**File**: `.claude/helpers/intelligence.cjs`, function `consolidate()`

After rebuild, evict entries with confidence below the decay floor (0.05) AND age > 30 days AND accessCount === 0:

```javascript
// Evict stale entries
const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
const before = this.entries.size;
for (const [id, entry] of this.entries) {
  if (entry.confidence <= 0.05 &&
      entry.createdAt < thirtyDaysAgo &&
      (entry.accessCount || 0) === 0) {
    this.entries.delete(id);
  }
}
const evicted = before - this.entries.size;
if (evicted > 0) log(`Evicted ${evicted} stale entries`);
```

**Also cap the store at 2000 entries**: After eviction, if still > 2000, drop the lowest-PageRank entries.

**Risk**: LOW — only evicts entries that are old, unaccessed, and at minimum confidence. Reversible via MEMORY.md re-import.

### Fix Sequence

| Phase | Where | Change | Risk | Effort |
|-------|-------|--------|------|--------|
| 1 | `auto-memory-hook.mjs` | Add Strategy 0 for dev-mode resolution | LOW | ~10 lines |
| 2 | `auto-memory-hook.mjs` `doSync()` | Read `ranked-context.json`, upsert top 500 to RvfBackend | MEDIUM | ~40 lines |
| 3 | `intelligence.cjs` `consolidate()` | Evict stale entries + cap at 2000 | LOW | ~15 lines |

### Acceptance Criteria

1. In dev (ruflo-patch), `doImport()` successfully loads `@sparkleideas/memory` and RvfBackend
2. After session, `.swarm/agentdb-memory.rvf` exists with size > 0
3. `memory search --query "pattern"` returns entries that were learned by intelligence.cjs
4. `auto-memory-store.json` does not exceed 2000 entries after consolidation
5. No regression: 148/148 acceptance tests still pass
6. Hook execution stays within 50ms budget (Phase 2 drain runs at session-end, not per-prompt)

### Where Fixes Live

All fixes are in the **ruflo fork** at `v3/@claude-flow/cli/.claude/helpers/`:

| File | Phase | Fix |
|------|-------|-----|
| `auto-memory-hook.mjs` | 1 | Strategy 0 dev-mode resolution |
| `auto-memory-hook.mjs` | 2 | `doSync()` reads ranked-context.json → RvfBackend upsert |
| `intelligence.cjs` | 3 | Eviction policy + 2000 entry cap |

### Tests Required

| Level | File | What |
|-------|------|------|
| Unit | `tests/unit/dual-silo-fix-adr0074.test.mjs` | Mock `loadMemoryPackage` Strategy 0; mock RvfBackend upsert; verify eviction logic |
| Integration | Same file | Real `ranked-context.json` → real RvfBackend → verify round-trip |
| Acceptance | `lib/acceptance-adr0074-checks.sh` | `check_adr0074_rvf_exists`: `.swarm/agentdb-memory.rvf` exists post-session; `check_adr0074_drain_works`: `memory search` returns intelligence-learned pattern; `check_adr0074_store_capped`: `auto-memory-store.json` <= 2000 entries after consolidate |

## Consequences

### Positive

- Complete audit trail of controller wiring state (45 controllers, 7 init levels, 3 wiring layers)
- Complete storage backend inventory (12 backends, 6 formats, data paths documented)
- Config chain verified end-to-end (14 keys, zero residual bypass sites)
- All upstream ADR dependencies mapped and status-tracked
- Clear priority list for remaining work
- **Issue #1 fix plan**: 3-phase approach with specific code locations, acceptance criteria, and risk assessment

### Negative

- The audit reveals the CJS/ESM dual silo as a critical unfixed issue
- 33 controllers without feature flags limits operator control
- 6 broken controllers in getController() are pre-existing debt not addressed by ADR-0068-0072

### Risk

- The dual silo will cause user confusion when hook-learned patterns don't appear in CLI memory searches
- Silent HNSW param ignoring in rvf-runtime could lead to false performance assumptions
- Phase 2 drain adds ~200ms to session-end (500 upserts × ~0.4ms each) — acceptable for a session-boundary operation

## Post-Sync Update (2026-04-06)

Upstream v3.5.52-v3.5.58 + ruvector 68 commits merged. Impact: SIGNIFICANT.

### Upstream creator deprecation notice
4 controllers officially deprecated (no upstream implementation path):
- graphAdapter / graphTransformer — dead code, SQLite CTEs handle all graph ops
- federatedSession — QUIC federation is a stub (sleep + success:true)
- federatedLearningManager — differential privacy federation is research, not implementation
- learningBridge — v2→v3 compatibility shim, intentionally disabled

### Priority fix list (upstream creator)
- nightlyLearner: missing singleton args (HIGH)
- causalRecall: missing vectorBackend reference (HIGH)
- explainableRecall: singleton wiring gap (MEDIUM)
- semanticRouter: missing embeddingService (MEDIUM)

### Upstream creator's top recommendation
Fix the CJS/ESM dual silo (Issue #1) before anything else. "Intelligence data permanently split between JSON files and AgentDB means the learning pipeline is broken in half. Everything else is optimization of a system whose core data flow is severed."

### Intelligence dedup (#1518)
Upstream v3.5.54 added intelligence store deduplication (4,482 → 157 entries). This partially addresses Issue #1 accumulation but does NOT fix the CJS/ESM silo itself.

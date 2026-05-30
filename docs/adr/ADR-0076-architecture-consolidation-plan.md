---
status: accepted
date: 2026-04-06
tags: [architecture, consolidation, storage, controllers]
supersedes: []
depends-on: [ADR-0069, ADR-0073, ADR-0075]
implements: []
---

# Architecture Consolidation Plan

## Context and Problem Statement

ADR-0075 assessed the architecture state and identified critical problems: three parallel controller registries, six embedding implementations with live 384-dim defaults, four HNSW implementations, seven storage backends with only one reachable, and dead code in critical paths. This ADR plans the consolidation work to address those findings, under the constraint that the fork must remain compatible with upstream so changes can keep merging and patches can be contributed back. Detailed phase tracking lives in ADR-0076a (ideal-state implementation plan). The plan was produced by two hive councils (10 + 10 agents), including a Reuven Cohen (upstream creator) perspective.

## Key Insight: Upstream Creator Perspective

Reuven Cohen (simulated upstream creator perspective) confirmed:
- **HybridBackend is NOT dead** — planned production default (SQLite for queries + RVF for vectors)
- **AgentDBService IS going away** — was always scaffolding; shim approach aligns with upstream roadmap
- **Would accept PRs**: A1 (cosineSim), A3 (dimension validation), B1 (config), B4 (shim)
- **Would NOT accept**: Deleting HybridBackend, memory-bridge.ts, sql.js fallback, VectorDb HNSW
- **Top contribution request**: AgentDBService shim while agentic-flow is upstream-inactive

## Considered Options

* **Two-track additive-only consolidation under the upstream-compatibility constraint (chosen — revised)** — Track A surgical correctness fixes plus Track B new files alongside existing ones with early-return guards; no deletions, no restructuring, near-zero merge conflict risk.
* **Original deletion-heavy plan (rejected)** — delete HybridBackend, memory-bridge.ts, sql.js fallback, split controller-registry.ts, delete AgentDBService (~9,555 lines deleted). Rejected because HybridBackend is a planned production default, memory-bridge.ts/sql.js encapsulate intentional edge-case handling, controller-registry.ts is the highest merge-conflict file, and wholesale deletion would break upstream merge compatibility.

## Decision Outcome

Chosen option: "Two-track additive-only consolidation under the upstream-compatibility constraint", because we do not deviate from upstream's file structure, so we can continue merging changes and contributing patches back.

Implement consolidation in two tracks under the **upstream compatibility constraint**: we do
not deviate from upstream's file structure, so we can continue merging changes and contributing
patches back.

**Track A** (correctness fixes): **IMPLEMENTED** — 4 surgical bug fixes, 31 tests, zero
structural changes.

**Track B** (structural): **REVISED** — additive-only approach. New files alongside existing
ones, early-return guards that intercept when initialized and fall through when not. No files
deleted, no files restructured, no upstream merge conflicts.

### Track A — Correctness Fixes (IMPLEMENTED)

| Fix | What | Status |
|-----|------|--------|
| A1 | cosineSim throws on dimension mismatch (3 files) | **Done** |
| A2 | circuitBreaker inline fallback (never null) | **Done** |
| A3 | Startup dimension validation (getStoredDimension + EmbeddingDimensionError) | **Done** |
| A4 | Dual-instance singleton guard on 6 shared controllers | **Done** |
| Tests | 31 unit tests (source + runtime) | **Done** |

### Track B — Upstream-Compatible Structural Consolidation (REVISED)

#### Core principle: additive layers, not deletions

Instead of: Delete old file → create replacement
Do: Create new file alongside old → route new code through it → leave old file for upstream

#### Safe merge pattern (from fork-maintenance expert)

1. New files go in `src/unified/` subdirectory — zero collision risk
2. ONE export line at the end of `index.ts` barrel — lowest-conflict position
3. `codemod.mjs` handles new `@claude-flow/*` imports automatically
4. Early-return guards: `if (newLayer) return newLayer.handle(); /* existing path continues */`

#### Phase B1: Unified Config (1 week, additive)

**Goal**: Single `resolveConfig()` alongside existing 5 resolution chains.

**New files** (ruflo fork):
- `@claude-flow/shared/src/core/config/resolve.ts` — `resolveConfig()` with 7-layer priority
- `@claude-flow/shared/src/core/config/hnsw-params.ts` — canonical `deriveHNSWParams()`
- `@claude-flow/shared/src/core/config/types.ts` — `EmbeddingConfigSchema`, `HNSWConfigSchema`

**Minimal patches**: 4 export lines across 2 barrel files
**Files NOT touched**: database-provider.ts, embedding-config.ts, memory-initializer.ts,
loader.ts, schema.ts, defaults.ts
**How it works**: New code calls `resolveConfig()`. Old code continues using its own chains.
Both resolve to the same cached `getEmbeddingConfig()` singleton underneath.
**Upstream PR**: Yes — "Add resolveConfig() to @claude-flow/shared". Adds files, touches
only barrels.

#### Phase B2: Storage Adapter (3 days, additive)

**Goal**: `IStorage` interface alongside existing `IMemoryBackend`.

**New files** (ruflo fork):
- `@claude-flow/memory/src/istorage.ts` — 10-method interface + `StorageAdapter<T>` wrapper
- `@claude-flow/memory/src/storage-factory.ts` — `createStorage()` wrapping existing `createDatabase()`

**Minimal patches**: 2 export lines in memory barrel
**Files NOT touched**: hybrid-backend.ts, agentdb-backend.ts, database-provider.ts,
rvf-backend.ts, sqlite-backend.ts, types.ts (HybridBackend stays — upstream plans to revive it)
**How it works**: `createStorage()` calls `createDatabase()` internally, wraps result in
`StorageAdapter`. New code uses `IStorage`. Old code uses `IMemoryBackend`. Both work.
**Upstream PR**: Yes — "Add IStorage slim interface as additive layer over IMemoryBackend"

#### Phase B3: Embedding Pipeline (1 week, additive)

**Goal**: Single `EmbeddingPipeline` interceptor with dimension validation.

**New files** (ruflo fork):
- `@claude-flow/embeddings/src/embedding-pipeline.ts` — wraps one `IEmbeddingService`,
  validates dimension on every `embed()`, canonical `cosineSimilarity()` that throws
- `@claude-flow/embeddings/src/pipeline-factory.ts` — `createEmbeddingPipeline(config)`

**Minimal patches**: 2 export lines in embeddings barrel + 5-line early-return guard in
`memory-initializer.ts:generateEmbedding()`:
```typescript
try {
  const { getEmbeddingPipeline } = await import('@claude-flow/embeddings/embedding-pipeline.js');
  const pipeline = getEmbeddingPipeline();
  if (pipeline) return pipeline.embed(text, options);
} catch { /* pipeline not available — existing chain continues */ }
```

**Files NOT touched**: embedding-service.ts, rvf-embedding-service.ts, 4x embedding-constants.ts
**How it works**: When pipeline is initialized, it intercepts `generateEmbedding()`. When not,
existing 6-implementation fallback chain runs unchanged.
**Upstream PR**: Yes — "Add EmbeddingPipeline singleton with canonical cosineSimilarity()"

#### Phase B4: Registry Bridge + AgentDBService Shim (1 week, both forks)

**Goal**: Single controller access point. AgentDBService delegated to ControllerRegistry.

**New files**:
- `@claude-flow/memory/src/registry-bridge.ts` — `RegistryBridge` singleton holding ref to
  ControllerRegistry. `get<T>(name)` delegates to registry.
- `agentic-flow/src/services/agentdb-service-shim.ts` — preserves `getInstance()` API,
  delegates all 15 constructions to `RegistryBridge.get()`

**Minimal patches**:
- `memory-bridge.ts` line ~301: 2 lines to attach registry to RegistryBridge
- `memory/src/index.ts`: 2 export lines

**Files NOT touched**: controller-registry.ts (no split — highest merge conflict risk),
agentdb-service.ts (shim sits alongside, not replacing)
**CRITICAL**: agentic-flow fork has been upstream-inactive since 2026-02-27 (1 upstream
commit in 6 weeks; our fork has 30+ commits touching 88 files). The shim must be created
NOW while the window is open. This is the highest-value Track B item per upstream creator.
**Upstream PR**: Partial — RegistryBridge is a convenience layer upstream might accept

#### Phase B5: Unified Data Flow (1 week, additive)

**Goal**: New MCP tool entry point using unified path, old path preserved as fallback.

**New files** (ruflo fork):
- `@claude-flow/cli/src/mcp-tools/storage-tools.ts` — CRUD via RegistryBridge → IStorage
- `@claude-flow/cli/src/mcp-tools/storage-tools-router.ts` — readiness gate with fallback

**Minimal patches**: 3-line import swap at MCP server tool registration
**Files NOT touched**: memory-bridge.ts (3,599 lines stays), memory-tools.ts (stays as
fallback), memory-initializer.ts (sql.js fallback stays)
**How it works**: Router checks `RegistryBridge.ready`. If ready → new unified path. If not →
old memory-tools.ts path. Runtime fork, not compile-time deletion.

### Consequences

The net impact comparison (additive Track B vs the original deletion plan):

| Metric | Original Plan | Revised Plan |
|--------|--------------|-------------|
| Lines deleted | ~9,555 | 0 |
| New files | ~8 | 11 |
| New lines | ~1,360 | ~1,200 |
| Existing files modified | 20+ | 6 (barrel exports + 1 guard) |
| Merge conflict risk | Very high | Near zero |
| Upstream PR viable | No | Yes (5 candidates) |

What changed from the original plan:

| Original | Revised | Why |
|----------|---------|-----|
| Delete HybridBackend | Keep it | Upstream plans to revive it as production default |
| Delete memory-bridge.ts | Keep it (add router alongside) | Encapsulates edge-case handling, ruflo very active |
| Delete sql.js fallback | Keep it | Intentional for edge environments (Vercel, Docker minimal) |
| Split controller-registry.ts | Don't split | Highest merge conflict file in the repo |
| Delete AgentDBService | Add shim alongside | Preserves getInstance() API, merge-safe |
| Modify 8+ existing files | Create 11 new files, patch 6 lines in barrels | Additive-only = merge-safe |

* Good, because zero lines are deleted — merge conflict risk drops from very high to near zero.
* Good, because 5 upstream PR candidates become viable (none were viable under the original deletion plan).
* Good, because Track A's 4 correctness fixes land with 31 tests and zero structural changes.
* Good, because the additive layers preserve the 7-level init ordering, HnswLite fallback, WAL write path, and all controllers unchanged internally.
* Bad, because 11 new files and ~1,200 new lines add surface area alongside the code they intercept (old paths remain as fallback rather than being removed).
* Neutral, because the consolidation is achieved by runtime interception (early-return guards), not compile-time deletion — both old and new paths coexist.

### Confirmation

Test strategy — 6 new test files per phase: `resolve-config-contract.test.mjs` (B1), `istorage-contract.test.mjs` (B2), `embedding-pipeline-contract.test.mjs` (B3), `single-registry-contract.test.mjs` (B4), `storage-tools-router.test.mjs` (B5), and `acceptance-adr0076-checks.sh` (all phases).

Performance regression budget:

| Operation | Budget | Trigger |
|-----------|--------|---------|
| `store()` p99 | <5ms at 1000 entries | >10ms |
| `search()` k=10, p99 | <20ms at 1000 entries | >2x baseline |
| `embed()` p99 | <50ms | >100ms |

## Dependency DAG (Revised)

```
Track A: DONE ✓

Track B (all additive):
  B1 (Config) ──→ B3 (Embedding Pipeline)  ──┐
                                               ├──→ B5 (Data Flow)
  B2 (Storage) ──→ B4 (Registry Bridge)    ──┘
```

B1 and B2 can start concurrently. B5 requires B2+B3+B4.

## Upstream PR Opportunities

| Bug | PR Target | Viability |
|-----|-----------|-----------|
| A1: cosineSim truncation | ruvnet/ruflo | High — pure bug fix |
| A3: startup dimension validation | ruvnet/ruflo | High — with migration escape hatch |
| B1: resolveConfig() | ruvnet/ruflo | Medium — adds API surface |
| B2: IStorage interface | ruvnet/ruflo | Medium — adds API surface |
| B3: EmbeddingPipeline | ruvnet/ruflo | Medium — adds API surface |
| B4: AgentDBService shim | ruvnet/agentic-flow | High — aligns with upstream roadmap |
| hybridSearch Level 1→3 | ruvnet/ruflo | High — dependency ordering bug |

## Recommendation

1. **Track A**: DONE ✓
2. **B4 (AgentDBService shim)**: Start immediately — agentic-flow freeze window is open
3. **B1 (Config)**: Start next — low risk, high long-term value
4. **B2 (Storage adapter)**: After B1 — enables B5
5. **B3 (Embedding pipeline)**: After B1 — validates dimensions at every embed call
6. **B5 (Data flow router)**: Last — requires B2+B3+B4, least urgent

## Additional Findings from Second Hive Council

### Controller Bridge (agent 7): InMemoryStore is a data-loss bug

AgentDBService's InMemoryStore fallback silently accepts writes when AgentDB init fails.
Data vanishes on process restart with no warning. Fix: add `initError` field, throw on
write attempts when init failed. This is a **critical upstream PR candidate** — it's a
real data-loss bug that upstream would want to know about.

Three additional upstream PRs identified:
- `AgentDB.getController('wasmVectorSearch')` — prevents "Unknown controller" throw
- `AgentDBService.getFallbackStatus()` — health check surfaces degraded state
- InMemoryStore fail-loud guard — throw instead of silently discarding data

### PR Strategist (agent 9): 5 concrete upstream PRs

| # | PR | Target | Risk |
|---|---|--------|------|
| 1 | cosineSim throw on dimension mismatch | ruvnet/ruflo | Low |
| 2 | circuitBreaker inline fallback | ruvnet/ruflo | Low |
| 3 | MiniLM→mpnet default change | ruvnet/ruflo | Medium |
| 4 | testRvf() document + escape hatch | ruvnet/ruflo | Medium |
| 5 | hybridSearch Level 1→3 ordering fix | ruvnet/ruflo | Low |

All tracked as GitHub issues (not upstream PRs — filed on fork repos with fix commit links):

**sparkling/ruflo**: [#25](https://github.com/sparkling/ruflo/issues/25) cosineSim (fixed),
[#26](https://github.com/sparkling/ruflo/issues/26) circuitBreaker (fixed),
[#27](https://github.com/sparkling/ruflo/issues/27) MiniLM defaults (fixed),
[#28](https://github.com/sparkling/ruflo/issues/28) dimension validation (fixed),
[#29](https://github.com/sparkling/ruflo/issues/29) hybridSearch ordering (identified)

**sparkling/agentic-flow**: [#4](https://github.com/sparkling/agentic-flow/issues/4) InMemoryStore data loss (identified),
[#5](https://github.com/sparkling/agentic-flow/issues/5) dual-instance guard (fixed),
[#6](https://github.com/sparkling/agentic-flow/issues/6) wasmVectorSearch gap (identified)

### Data Flow (agent 10): unified-memory.ts interceptor

`unified-memory.ts` wraps bridge exports directly. Early-return guard in memory-tools.ts
handlers: `const unified = await getUnifiedMemory(); if (unified) return unified.store(...)`.
Falls through to existing `getMemoryFunctions()` path when registry unavailable. Fixes the
`bridgeSearchEntries` empty-result fallthrough bug (Scenario C) where bridge returns `[]`
and sql.js fallback sees different data.

## More Information

Original status: "Track A Implemented, Track B Completed (via ADR-0077 + ADR-0085)." Recorded 2026-04-06; revised 2026-04-06 (upstream-compatible constraint applied); completed 2026-04-13 (ADR-0085 deleted the bridge, eliminated the sidecar, and closed all gaps). This ADR depends on ADR-0075 (assessment), ADR-0073 (storage upgrade), and ADR-0069 F1 (controller delegation); detailed phase tracking is in ADR-0076a, and Track B was carried out via ADR-0077 and ADR-0085.

# ADR-0066: Controller Configuration Unification

- **Status**: Proposed
- **Date**: 2026-04-05
- **Deciders**: Henrik Pettersen
- **Builds on**: ADR-0065 (config centralization), ADR-0062 (storage config), ADR-0064 (controller config alignment)

## Upstream References

### Upstream ADRs (ruvnet/ruflo v3/implementation/adrs/)

| ADR | Title | Status | Relationship |
|-----|-------|--------|-------------|
| **ADR-053** | AgentDB v3 Controller Activation & Runtime Wiring | Implemented | Introduced `ControllerRegistry` + `memory-bridge.ts`. Defined `RuntimeConfig` interface. Listed 12 dead config.json keys (issue #1204) as not-yet-wired. ADR-0066 completes this. |
| **ADR-055** | AgentDB v3 Controller Bug Remediation | Accepted | Corrected `getController()` → only 5 names (`reflexion`, `skills`, `causalGraph`, `vectorBackend`, `graphAdapter`); all others must be `new X()` directly. Stubs for HierarchicalMemory + MemoryConsolidation. |
| **ADR-057** | RVF Native Storage Backend | Proposed (unimplemented) | Proposes replacing sql.js with RVF. ADR-0065 P3-1 partially addresses by removing SqlJsBackend. |
| **ADR-059** | Bug Triage March 2026 | Verified | Issue #1264: ControllerRegistry not exported. Fixed in PR #1298. |
| **ADR-060** | Remaining Bugs March 2026 | Verified | Issue #1214: `memoryGraph: true` added to memory-bridge config. Issue #1211: hook stdin fixed. |
| **ADR-064** | Stub Remediation v3.5.22 | Implemented | 22 stubs implemented (WASM, consensus, SONA). `@claude-flow/memory@3.0.0-alpha.12` required for ControllerRegistry. |
| **ADR-067** | Critical Issue Remediation v3.5.43 | Implemented | #1399: CLI bundled alpha.11 missing ControllerRegistry. Phase 3.3: hardcoded 1536→384 dimension fix. Phase 5.1: daemon reads only config.json. |
| ADR-006 | Unified Memory Service | Implemented | AgentDB as THE storage layer. Schema uses 768-dim (predates MiniLM adoption). |
| ADR-009 | Hybrid Memory Backend | Implemented | SQLite + AgentDB combined. RuVector preferred, HNSWLib fallback. |
| ADR-023 | ONNX Hyperbolic Embeddings Init | Proposed | Writes `.claude-flow/embeddings.json`. Defines 384-dim (MiniLM) and 768-dim (mpnet). |
| ADR-024 | Embeddings MCP Tools | Implemented | 7 MCP tools. Config in `.claude-flow/embeddings.json`. Hardcodes 384-dim in template. |
| ADR-028 | Neural Attention Mechanisms | Proposed | Unified AttentionService for 39 RuVector attention types. Only `sublinearAttention` wired. |
| ADR-048 | Auto Memory Integration | Implemented | Bidirectional bridge between Claude Code auto-memory and AgentDB. |
| ADR-049 | Self-Learning Memory GNN | Implemented | MemoryGraph, LearningBridge, AgentMemoryScope added. |

### Upstream ADRs (ruvnet/agentic-flow docs/adr/)

| ADR | Title | Relationship |
|-----|-------|-------------|
| **ADR-052** (af) | CLI Tool Gap Remediation | Config-driven embedding framework. Swept 22 files for hardcoded dimensions. |
| **ADR-054** (af) | AgentDB v3 Architecture Review | 21 controllers audited, 50+ issues, WASM attention stubs, TypeScript strictness gaps. |
| **ADR-056** (af) | RVF/RuVector Integration | RVF primary, SQLite fallback. vectorBackend wired to controllers. COW branch tables. |
| **ADR-060** (af) | Proof-Gated Graph Intelligence | MutationGuard, all 21 controllers wired into `getController()`. |
| **ADR-062** (af) | Integration Completion | HookService singleton, DirectCallBridge, AttentionSearch wiring. "Attention → Tools: 0% (F)". |
| ADR-001 (agentdb-v2) | Backend Abstraction | Defines VectorBackend/LearningBackend/GraphBackend. HNSW defaults: M=16, efC=200, efS=100. |

### Upstream GitHub Issues (ruvnet/ruflo)

| Issue | State | Title | ADR-0066 relevance |
|-------|-------|-------|-------------------|
| **#1516** | OPEN | ControllerRegistry doesn't pass embeddingModel+dimension to AgentDB | Core P0: AgentDB falls back to MiniLM 384-dim while config expects mpnet 768-dim |
| **#1499** | CLOSED | ReasoningBank missing embedder param in ControllerRegistry | P1: embedder must be passed to every controller that needs it |
| **#1492** | CLOSED | 4 controllers unimplemented (ContextSynthesizer, BatchOps, etc.) | P1: registry gaps |
| **#1228** | OPEN | ADR-053: AgentDB v3 Controller Activation tracking issue | Reference: 42 exports, 0 instantiated by CLI |
| **#1399** | CLOSED | AgentDB bridge unavailable — alpha.11 missing ControllerRegistry | Fixed in v3.5.49 |
| **#1143** | CLOSED | Embedding model + HNSW dimensions hardcoded, ignore embeddings.json | P0: embeddings.json must be single source of truth |
| **#1041** | OPEN | dimension hardcoded to 1536 in memory-initializer | P0: dimension consistency |
| #1204 | — | 12 dead config.json keys | ADR-053 deferred item; ADR-0065 partially addressed |

### Upstream GitHub Issues (ruvnet/agentic-flow)

| Issue | State | Title | ADR-0066 relevance |
|-------|-------|-------|-------------------|
| **#137** | CLOSED | EmbeddingService bare model name → mock fallback | P0: model names need Xenova/ prefix |
| **#132** | CLOSED | dist/controllers at wrong path | Build: `dist/src/controllers` vs `dist/controllers` |
| #133 | OPEN (PR) | Fix controller path to dist/src/controllers | Unmerged fix |
| #80 | OPEN | agentdb missing dist/controllers/index.js | v2 layout issue |
| #118 | OPEN | GNNService incorrectly passes config.layers to RuvectorLayer constructor | P1: GNN config mismatch, will panic at runtime |
| #119 | OPEN | GNN integration affected by RuvectorLayer constructor panic | Same root cause as #118 |
| #129 | OPEN | retrieveRelevant() returns 0 results after HNSW rebuild | Vector backend data loss after rebuild |
| #128 | OPEN | reflexion.storeEpisode() does not INSERT into episodes/episode_embeddings | Embeddings never stored |

### Upstream GitHub Issues (ruvnet/RuVector)

| Issue | State | Title | ADR-0066 relevance |
|-------|-------|-------|-------------------|
| **#237** | CLOSED | ONNX hardcodes 384-dim in Rust layer | P3: root cause of 384 default in ruvector-core |
| **#307** | CLOSED | `dimension` vs `dimensions` field name in NAPI | API: registry must use correct field name |
| **#316** | OPEN | sync embed() returns hash, not semantic vectors | Risk: controller init using sync path gets wrong vectors |
| #141 | CLOSED | HNSW segfault on 384-dim column with bad query | Confirms dimension mismatch causes hard crashes |
| **#315** | OPEN | import() does not rebuild HNSW — recall() returns [] after load | Vector backend data loss on import |
| **#323** | OPEN | ONNX embedder fails on Node 22 LTS with .wasm extension error | Blocks ONNX embedding on current LTS |
| PR #68 | OPEN | HNSW dimensions hardcoded to 128 in postgres extension typmod | P3: another hardcoded dimension |
| PR #318 | OPEN | importAsync() + rebuildHnswIndex() to fix recall after import | Fix for #315 — unmerged |

### Upstream Git Commits (key decisions)

| SHA | Date | Repo | Message | Significance |
|-----|------|------|---------|-------------|
| `67f143f8e` | 2026-03-14 | ruflo | DM-001: Upgrade to all-mpnet-base-v2 (768-dim) | **Decision point**: 384→768 dimension switch |
| `a7389f6cc` | 2026-03-18 | ruflo | ADR-052: eliminate all hardcoded embedding dimensions (17 files) | First dimension cleanup sweep |
| `81fe2c39b` | 2026-03-16 | ruflo | ADR-040: inject embedders, remove dead controllers | Embedder injection pattern established |
| `5a5bfa6a6` | 2026-04-02 | ruflo | P0: ESM controller-registry, memory-bridge fix | Most recent controller-registry crash fix |
| `4d87fcd6c` | 2026-04-04 | ruflo | pass embedding config from ControllerRegistry to AgentDB | Attempted fix for #1516 |
| `121da55` | 2026-03-18 | agentic-flow | ADR-052: eliminate hardcoded dims (22 files) | agentic-flow side of dimension cleanup |
| `10dfb24` | 2026-03-16 | agentic-flow | accept optional singletons in NightlyLearner and CausalRecall | ADR-0040 singleton pattern |

### Key Open Upstream Issues (still unfixed)

| Issue | Repo | Title | Impact |
|-------|------|-------|--------|
| **#1516** | ruvnet/ruflo | ControllerRegistry doesn't pass embeddingModel+dimension to AgentDB | AgentDB falls back to MiniLM 384-dim while config expects 768-dim |
| **#1521** | ruvnet/ruflo | ReasoningBank still disabled — alpha.12 missing require('path') fix | `agentdb_pattern-store` and `agentdb_pattern-search` always fail |
| **#1525** | ruvnet/ruflo | Intelligence ↔ Memory Bridge unconnected | Daemon insights don't reach ruflo memory |
| **#1041** | ruvnet/ruflo | dimension hardcoded to 1536 in memory-initializer | Vector dimension mismatch |
| **#967** | ruvnet/ruflo | MCP Memory Tools and CLI Use Separate Backends | Data not synced between backends |
| **#812** | ruvnet/ruflo | MCP memory tools don't use ReasoningBank despite initialization | Semantic search unused |
| **#316** | ruvnet/RuVector | sync embed() returns hash vectors, not semantic | Corrupts persisted DBs with mixed dimension spaces |
| **#1228** | ruvnet/ruflo | ADR-053 tracking issue (42 exports, 0 instantiated by CLI) | Still open — controller wiring incomplete |

### ADR Lineage (ruflo-patch)

This ADR is the completion of three overlapping work streams that began in March 2026:

```
ADR-0033 (activate 27/28 controllers — only 10 actually worked)
 ↓
ADR-0039 (roadmap: 31 more controllers, identified duplicates)
 ↓ parallel execution:
ADR-0040 (wiring remediation — singleton injection pattern for NightlyLearner/CausalRecall)
ADR-0041 (composition-aware — "no duplicate instances" rule, NativeAccelerator singleton)
ADR-0044 (attention suite — A1-A3, A5; created 4 duplicate AttentionService instances)
ADR-0046 (self-learning — SelfLearningRvfBackend composite pattern)
ADR-0047 (quantization/federated — QuantizedVectorStore, FederatedLearningManager)
 ↓ dimension war identified
ADR-0050 (zero-dim embeddings symptom exposed → D4 bug)
ADR-0052 (config-driven framework — getEmbeddingConfig(), deriveHNSWParams() created)
 ↓ storage chain
ADR-0059 (RVF storage backend — fixed hook subprocess drain)
ADR-0060 (fork patch hygiene — flagged controller-registry.ts as highest merge risk)
ADR-0061 (controller integration completion — 45 controllers, 10 bugs fixed, 8 duplicates)
 ↓ config chain
ADR-0062 (storage config unification — dimension split documented, 2 implementation bugs)
ADR-0063 (storage audit remediation — fixed ADR-0062 bugs, dimension unified to 768)
ADR-0064 (controller config alignment — getEmbeddingConfig(), dead config, 4 stubs identified)
ADR-0065 (config centralization — wired config.json/embeddings.json, fixed 384→768, 4 controllers deduped)
 ↓
ADR-0066 (THIS ADR — completes all remaining gaps across 3 repos)
```

### Key Upstream PR (#1232 — closed without merge, work split)

PR #1232 "Wave 3: Config unification, embeddings fallback, security hardening" contained
the most thorough audit of dead config keys and proposed `loadRuntimeConfig()`/`getConfigValue()`
helpers. It was closed without merge — the work was split across subsequent PRs (#1244, #1300,
#1362, #1374, #1435). ADR-0066's config.json wiring completes what #1232 proposed.

### Forks are at upstream HEAD

Both forks (`/Users/henrik/source/forks/ruflo/` and `/Users/henrik/source/forks/agentic-flow/`)
are fully synced with upstream — `git log HEAD..upstream/main` returns empty for both. There are
no upstream-only commits that we're missing.

## Context

A cross-repo audit of all 46 controllers, 5 storage backends, and 3 embedding pipelines across
our forks (ruflo, agentic-flow, ruvector) reveals systemic configuration fragmentation originating
in the upstream ruvnet repos. ADR-0065 wired config.json and embeddings.json into the 10 controllers that accept tuning params, but left 36 controllers with hardcoded defaults, 9 dimension inconsistencies, 4 duplicate AttentionService instances, and 3 competing default dimensions (384/768/1536).

### Problem 1: Three competing default dimensions

The codebase has no single authoritative dimension default. Three values appear as fallbacks depending on which code path runs first:

| Default | Where | Model assumed |
|---------|-------|---------------|
| **384** | `agentdb-wrapper.ts:90`, `agentdb-wrapper-enhanced.ts:108`, `AgentDBBackend.ts:27`, `ewc-consolidation.ts:152`, `guidance/retriever.ts:105`, `RuVectorIntelligence.ts:291`, `reasoningbank/embeddings.ts:151`, `agentdb-service.ts:215`, `hooks/reasoningbank/index.ts:115`, ruvector-core defaults, graph-node defaults | `all-MiniLM-L6-v2` |
| **768** | `controller-registry.ts:293`, `rvf-backend.ts:52`, `hnsw-index.ts:535`, `agentdb-backend.ts:122`, `embedding-config.ts:69`, `config-adapter.ts:40` | `nomic-embed-text-v1.5` or `all-mpnet-base-v2` |
| **1536** | `shared/config/defaults.ts:78`, `shared/config/schema.ts:95`, `integration/types.ts:463` | `text-embedding-ada-002` (OpenAI) |

The shared config schema (`defaults.ts`) sets `memory.agentdb.dimensions = 1536`, but `config-adapter.ts` falls back to 768, and the actual embedding model (`nomic-embed-text-v1.5`) produces 768-dim vectors. If a user never sets the dimension explicitly, the value that reaches the backend depends on which code path runs.

### Problem 2: Hardcoded model names bypass config

15+ files hardcode `Xenova/all-MiniLM-L6-v2` (384-dim model) instead of reading from `embeddings.json`. Key offenders:

| File | Lines | Model hardcoded |
|------|-------|-----------------|
| `agentic-flow/src/reasoningbank/utils/embeddings.ts` | 47, 53, 151 | `all-MiniLM-L6-v2`, `return 384` |
| `agentic-flow/src/services/agentdb-service.ts` | 215, 461 | `Xenova/all-MiniLM-L6-v2` |
| `agentic-flow/src/intelligence/EmbeddingService.ts` | 179 | `all-MiniLM-L6-v2` |
| `ruflo/v3/@claude-flow/hooks/src/reasoningbank/index.ts` | 934 | `Xenova/all-MiniLM-L6-v2` |
| `ruflo/v3/@claude-flow/mcp/.claude/helpers/learning-service.mjs` | 65, 469 | `all-MiniLM-L6-v2` |
| `ruflo/v3/@claude-flow/embeddings/src/embedding-service.ts` | 380, 614 | `Xenova/all-MiniLM-L6-v2` |

### Problem 3: 4 duplicate AttentionService instances

| Instance | Created by | Location |
|----------|-----------|----------|
| 1 (canonical) | `controller-registry.ts` | Line 1143, explicit config |
| 2 | `CausalMemoryGraph` constructor | AgentDB.ts:156 → CausalMemoryGraph.ts:141 |
| 3 | `ExplainableRecall` constructor | AgentDB.ts:159 → ExplainableRecall.ts:115 |
| 4 (conditional) | `NightlyLearner` constructor | AgentDB.ts:160 → NightlyLearner.ts:99 |

All 3 in-AgentDB instances use `LegacyAttentionAdapter` and cannot share the registry's canonical instance because they're constructed inside `AgentDB.initialize()` before the registry exists.

### Problem 4: Duplicate controller instances (registry vs AgentDB)

8 controllers are created via `new X(this.agentdb.database, ...)` in the registry despite AgentDB already managing its own instance:

| Controller | Registry creates | AgentDB also owns | Risk |
|------------|-----------------|-------------------|------|
| `reasoningBank` | `new RB(db, embedder, vb)` | `this.reasoning` | Two instances, shared DB, divergent caches |
| `causalRecall` | `new CR(db)` | `this.causalRecall` | Same |
| `learningSystem` | `new LS(db, embedder)` | `this.learningSystem` | Same + duplicate GNNService |
| `explainableRecall` | `new ER(db)` | `this.explainableRecall` | Same + duplicate AttentionService |
| `nightlyLearner` | `new NL(db, embedder, ...)` | `this.nightlyLearner` | Same + duplicate sub-controllers |
| `graphTransformer` | `new GT(db)` | `this.graphTransformer` | Same |
| `batchOperations` | `new BO(db, embedder)` | none in AgentDB | Safe |
| `mutationGuard` | `new MG({dimension})` | `this.mutationGuard` (via guarded backend) | Two instances, separate proof state |

### Problem 5: 3 stub controllers returning null

| Stub | What it needs |
|------|--------------|
| `hybridSearch` | BM25 text index + HNSW cosine fusion. `AgentMemoryScope` exists at `agent-memory-scope.ts` but is unwired. |
| `agentMemoryScope` | Agent-scoped namespace isolation. Class exists but constructor not called. |
| `federatedSession` | Cross-agent session transport. No implementation exists. |

### Problem 6: HNSW parameter inconsistencies

`deriveHNSWParams(dim)` is consistent between repos (ADR-0065 P3-3), but:

- `RuVectorBackend.getAdaptiveParams()` produces different M values during `reindex()` (M=16 for medium datasets vs M=23 from formula for 768-dim)
- Scattered hardcoded `hnswM: 16` in: `agentdb-backend.ts:123`, `agentdb-adapter.ts:79`, `integration/types.ts:465`, `agentic-flow-bridge.ts:607`, all examples
- `shared/config/defaults.ts:80,81`: `efConstruction: 200, m: 16`
- ruvector-core default: M=32, ef_construction=200, ef_search=100

### Problem 7: Controllers with meaningful hardcoded values not in config

| Controller | Hardcoded | Should be configurable as |
|------------|-----------|--------------------------|
| `nightlyLearner` | `minSimilarity: 0.7`, `minSampleSize: 30`, `confidenceThreshold: 0.6`, `upliftThreshold: 0.05`, `edgeMaxAgeDays: 90`, `experimentBudget: 10` | `controllers.nightlyLearner.*` |
| `causalRecall` | `alpha: 0.7`, `beta: 0.2`, `gamma: 0.1`, `minConfidence: 0.6`, `k: 12` | `controllers.causalRecall.*` |
| `selfLearningRvfBackend` | `learning: true`, storagePath pattern | `controllers.selfLearningRvfBackend.*` |
| `federatedLearningManager` | `agentId` auto-generated | `controllers.federatedLearningManager.agentId` |
| `mutationGuard` | only `dimension` passed, no `maxElements` | `controllers.mutationGuard.*` |
| `queryOptimizer` | `maxSize: 1000`, `ttl: 60000` | `controllers.queryOptimizer.*` |
| `tieredCache` | `lruEnabled: true`, `writeThrough: false` (not in RuntimeConfig) | `controllers.tieredCache.lruEnabled`, `.writeThrough` |
| `learningBridge` | `enabled: true` (always, not overridable) | `controllers.learningBridge.enabled` |
| `hierarchicalMemory` | stub `MAX_PER_TIER: 5000`, `topK: 5` | `controllers.hierarchicalMemory.*` |

### Problem 8: queryOptimizer and auditLogger not registered in AgentDB

`AgentDB.getController('queryOptimizer')` and `AgentDB.getController('auditLogger')` both throw `Error('Unknown controller: ...')`. The registry's `createController()` catches this silently, but the controllers are never actually created via AgentDB — they're created directly with `new QO(db)` / `new AL()`.

### Problem 9: ruvector-core defaults conflict with ruflo

| Value | ruflo (embeddings.json) | ruvector-core default | Conflict? |
|-------|------------------------|----------------------|-----------|
| dimension | 768 | 384 | YES |
| HNSW M | derived (23 for 768-dim) | 32 | YES |
| distance metric | cosine | L2 (RVF), cosine (graph-node) | RVF defaults to L2 |
| graph-node dimension | — | 384 | YES |

## Decision

### P0: Fix all dimension defaults to read from embeddings.json

Every fallback dimension in the codebase must resolve through `getEmbeddingConfig().dimension` or read from `embeddings.json`, with a final fallback of `768`.

**Files to fix (each `384` or `1536` fallback):**

| File | Current | Fix |
|------|---------|-----|
| `shared/config/defaults.ts:78` | 1536 | 768 |
| `shared/config/schema.ts:95` | 1536 | 768 |
| `integration/types.ts:463` | 1536 | 768 |
| `ewc-consolidation.ts:152` | 384 | Read from `readEmbeddingsConfig().dimension` |
| `guidance/retriever.ts:105` | 384 | 768 (hash embedder, but should match default) |
| `hooks/reasoningbank/index.ts:115` | 384 | Read from `getEmbeddingConfig()` |
| `agentic-flow/agentdb-wrapper.ts:90` | 384 | Read from `getEmbeddingConfig()` |
| `agentic-flow/agentdb-wrapper-enhanced.ts:108,119,128` | 384 | Read from `getEmbeddingConfig()` |
| `agentic-flow/intelligence/EmbeddingService.ts:180` | 256 → 384 | Read from `getEmbeddingConfig()` |
| `agentic-flow/reasoningbank/utils/embeddings.ts:151` | `return 384` | Read from `getEmbeddingConfig()` |
| `agentic-flow/services/agentdb-service.ts:215` | 384 | Read from `getEmbeddingConfig()` |
| `agentic-flow/routing/TinyDancerRouter.ts:87` | 384 | Read from `getEmbeddingConfig()` |
| `src/memory/infrastructure/AgentDBBackend.ts:27` | 384 | 768 |
| `memory-initializer.ts:951-952` | hardcoded 768 in SQL | Use `readEmbeddingsConfig().dimension` |

### P0: Fix all hardcoded model names to read from config

Every hardcoded `all-MiniLM-L6-v2` must be replaced with a config read:

| File | Fix |
|------|-----|
| `agentic-flow/reasoningbank/utils/embeddings.ts:47,53` | Read from `getEmbeddingConfig().model` |
| `agentic-flow/services/agentdb-service.ts:215,461` | Read from `getEmbeddingConfig().model` |
| `agentic-flow/intelligence/EmbeddingService.ts:179` | Read from env var or `getEmbeddingConfig()` |
| `hooks/reasoningbank/index.ts:934` | Read from `getEmbeddingConfig()` |
| `mcp/.claude/helpers/learning-service.mjs:65,469` | Read from embeddings.json |
| `cli/.claude/helpers/learning-service.mjs:65,469` | Read from embeddings.json |
| `embeddings/embedding-service.ts:380,614` | Read from config |

### P1: Deduplicate controller instances — use AgentDB's singletons

For the 6 controllers where AgentDB already owns an instance, the registry should call `this.agentdb.getController()` instead of `new X()`:

| Controller | Current | Change to |
|------------|---------|-----------|
| `reasoningBank` | `new RB(db, embedder, vb)` | `this.agentdb.getController('reasoningBank')` |
| `causalRecall` | `new CR(db)` | `this.agentdb.getController('causalRecall')` |
| `learningSystem` | `new LS(db, embedder)` | `this.agentdb.getController('learningSystem')` |
| `explainableRecall` | `new ER(db)` | `this.agentdb.getController('explainableRecall')` |
| `nightlyLearner` | `new NL(db, embedder, ...)` | `this.agentdb.getController('nightlyLearner')` |
| `graphTransformer` | `new GT(db)` | `this.agentdb.getController('graphTransformer')` |
| `mutationGuard` | `new MG({dimension})` | `this.agentdb.getMutationGuard()` |

### P1: Consolidate AttentionService to singleton

Modify `CausalMemoryGraph`, `ExplainableRecall`, and `NightlyLearner` constructors to accept an optional `AttentionService` parameter. In `AgentDB.initialize()`, create ONE AttentionService and inject it into all three.

### P1: Add HNSW tuning to embeddings.json and propagate

Add `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` to embeddings.json (some already exist):

```json
{
  "hnsw": {
    "metric": "cosine",
    "maxElements": 100000,
    "persistIndex": true,
    "rebuildThreshold": 0.1,
    "m": 23,
    "efConstruction": 100,
    "efSearch": 50
  }
}
```

Propagate to: `AgentDBConfig`, `RvfBackend`, `HNSWLibBackend`, `RuVectorBackend`, all scattered `hnswM: 16` hardcodes.

### P1: Wire remaining controller tuning into RuntimeConfig and config.json

Add to `RuntimeConfig`:

```typescript
nightlyLearner?: {
  minSimilarity?: number;
  minSampleSize?: number;
  confidenceThreshold?: number;
  upliftThreshold?: number;
  edgeMaxAgeDays?: number;
  experimentBudget?: number;
};
causalRecall?: {
  alpha?: number;
  beta?: number;
  gamma?: number;
  minConfidence?: number;
  k?: number;
};
queryOptimizer?: {
  maxSize?: number;
  ttl?: number;
};
selfLearningRvfBackend?: {
  learning?: boolean;
  storagePath?: string;
};
mutationGuard?: {
  maxElements?: number;
};
```

Add corresponding sections to `config.json` under `controllers.*`.

### P2: Implement the 3 stub controllers

**`agentMemoryScope`**: Wire the existing `AgentMemoryScope` class from `agent-memory-scope.ts`. Constructor needs `agentId` from `this.config.agentId` and the shared `backend`. Add to RuntimeConfig: `agentMemoryScope?: { defaultScope?: string }`.

**`hybridSearch`**: Implement BM25 + HNSW fusion. Use AgentDB's SQLite FTS5 for keyword search and `vectorBackend` for semantic search. Score = `alpha * cosine + (1-alpha) * bm25_normalized`. Add to RuntimeConfig: `hybridSearch?: { alpha?: number; maxResults?: number }`.

**`federatedSession`**: Implement shared-SQLite session federation for multi-agent coordination. Use the existing AgentDB database as the transport. Add to RuntimeConfig: `federatedSession?: { enabled?: boolean; syncIntervalMs?: number }`.

### P2: Register queryOptimizer and auditLogger in AgentDB

Add to `AgentDB.getController()` switch:
- `'queryOptimizer'` → `this.queryOptimizer` (lazy-init `new QueryOptimizer(this.db)`)
- `'auditLogger'` → `this.auditLogger` (lazy-init)

### P2: Controller enable/disable through config.json

Currently, `controllers.*` in RuntimeConfig accepts `boolean` values for enable/disable, but this is set programmatically in `memory-bridge.ts`, not read from `config.json`. Add a `controllers.enabled` section to `config.json`:

```json
{
  "controllers": {
    "enabled": {
      "reasoningBank": true,
      "learningBridge": false,
      "tieredCache": true,
      "hybridSearch": false,
      "agentMemoryScope": false,
      "federatedSession": false
    }
  }
}
```

Wire in `memory-bridge.ts`: merge `cfgJson.controllers.enabled` with the hardcoded enable/disable map.

**Pros:**
- Operators can disable expensive controllers (nightlyLearner, gnnService) without code changes
- Feature flags for experimental controllers (hybridSearch, federatedSession)
- Per-project controller profiles (minimal for CI, full for production)

**Cons:**
- Enabling a controller that has unresolved dependencies still fails silently
- Must document which controllers depend on which (e.g., `guardedVectorBackend` needs `vectorBackend` + `mutationGuard`)
- Risk of disabling critical controllers (e.g., `rateLimiter`) in production

### P3: Fix ruvector dimension defaults

In our ruvector fork, change upstream defaults from 384 to match the canonical 768:

| File | Change |
|------|--------|
| `crates/ruvector-cli/src/config.rs:92` | `fn default_dimensions() -> usize { 768 }` |
| `crates/ruvector-core/src/types.rs:119` | `DbOptions::default().dimensions = 768` |
| `crates/ruvector-graph-node/src/types.rs:48` | `JsGraphOptions::default().dimensions = Some(768)` |
| `crates/ruvector-postgres/src/routing/router.rs:158,167` | `embedding_dim: 768` |

### P3: Fix RuVectorBackend adaptive params to align with deriveHNSWParams

`RuVectorBackend.getAdaptiveParams()` should call `deriveHNSWParams(dimension)` instead of using a dataset-size-based lookup table. The formula already accounts for dimension; dataset size should only influence `maxElements`, not M/ef values.

## Consequences

### Positive
- Single source of truth for dimension (embeddings.json) across all 3 repos
- All 46 controllers configurable through config.json (enable/disable + tuning)
- Singleton pattern for AttentionService eliminates 3 duplicate instances
- AgentDB's getController() used consistently — no more parallel instances
- HNSW params flow from embeddings.json, eliminating scattered M=16 hardcodes
- Stubs become functional (hybridSearch, agentMemoryScope, federatedSession)
- ruvector defaults align with ruflo's 768-dim standard

### Negative
- Large changeset across 3 forks (~30 files in ruflo, ~15 in agentic-flow, ~5 in ruvector)
- config.json grows significantly with controller tuning sections
- Changing AgentDB controller constructors to accept injected AttentionService is a breaking change for direct AgentDB consumers
- ruvector default changes may break existing ruvector-only users who rely on 384

### Risks
- Moving from `new X()` to `agentdb.getController()` may surface runtime errors if AgentDB's initialization order changes
- Enabling controller config through config.json means a bad config file can break the entire controller stack
- Changing ruvector defaults in Rust requires rebuilding native binaries

## Acceptance Criteria

### P0
- [ ] Zero `384` or `1536` dimension fallbacks remain (only `768` or config reads)
- [ ] Zero hardcoded `all-MiniLM-L6-v2` model strings remain outside MODEL_REGISTRY
- [ ] `shared/config/defaults.ts` and `schema.ts` use 768 as default dimension
- [ ] `memory-initializer.ts` SQL seed rows use config dimension, not hardcoded 768

### P1
- [ ] 6 controllers use `agentdb.getController()` instead of `new X()`
- [ ] AttentionService created once and injected into CausalMemoryGraph, ExplainableRecall, NightlyLearner
- [ ] embeddings.json `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` propagated to all backends
- [ ] RuntimeConfig has tuning fields for nightlyLearner, causalRecall, queryOptimizer, selfLearningRvfBackend, mutationGuard
- [ ] config.json has corresponding controller sections

### P2
- [ ] `agentMemoryScope` wired to existing class
- [ ] `hybridSearch` implemented with BM25 + HNSW fusion
- [ ] `federatedSession` implemented with shared-SQLite transport
- [ ] `queryOptimizer` and `auditLogger` registered in AgentDB.getController()
- [ ] Controller enable/disable configurable via config.json `controllers.enabled`

### P3 (patches to our ruvector and ruflo forks)
- [ ] ruvector-core, ruvector-cli, graph-node default dimension = 768 (ruvector fork)
- [ ] RuVectorBackend.getAdaptiveParams() delegates to deriveHNSWParams() (ruflo fork)

## 5. Implementation Roadmap

### A. Phase Sequencing

```
Week 1                  Week 2                  Week 3                  Week 4
|----- P0 Wave 1 ------|----- P0 Wave 2 ------|----- P1 ------|----- P2 ------|
| dim fixes (ruflo)    | dim fixes (af)        | dedup/single  | stubs/config  |
| model fixes (ruflo)  | model fixes (af)      | HNSW config   | enable/disable|
|                      |                       | RuntimeConfig | qo/al register|
|----- P3 (parallel, any time) -------|        |               |               |
| ruvector defaults                    |        |               |               |
```

**Parallelism rules:**

- **P0 is per-file independent.** Every dimension fix and model-name fix is a local change with no cross-file dependency. Within P0, ruflo-fork files and agentic-flow-fork files can be patched in parallel by two developers or two swarm agents.
- **P1 depends on P0 completion.** The singleton refactor in controller-registry.ts assumes AgentDB already receives the correct dimension from config -- if 384 fallbacks still exist, getController() returns controllers initialized with the wrong dimension. P1 starts after P0 lands.
- **P2 partially overlaps P1.** Stub implementations (hybridSearch, agentMemoryScope, federatedSession) are new code with no dependency on P1's dedup work. They can start in Week 3. However, the `controllers.enabled` config wiring in memory-bridge.ts depends on the P1 RuntimeConfig extensions being merged first -- so that P2 task is sequential after P1.
- **P3 is fully independent.** Rust default changes in ruvector-core compile independently of the TypeScript changes in ruflo and agentic-flow. P3 can run at any point -- even Week 1 -- but is low priority because ruflo always passes explicit dimension values to ruvector, making the defaults only relevant for standalone ruvector usage.

### B. Per-Phase Task Breakdown

#### P0 Wave 1: Dimension and model fixes in ruflo fork

All paths below are relative to `/Users/henrik/source/forks/ruflo/v3/@claude-flow/`.

| ID | File (absolute fork path) | Change | Est. lines | Risk | Deps | Tests |
|----|--------------------------|--------|-----------|------|------|-------|
| P0-R1 | `shared/src/core/config/defaults.ts:78` | `1536` -> `768` | ~2 | Low | None | Unit: mock defaults export, assert 768. Acceptance: grep published dist. |
| P0-R2 | `shared/src/core/config/schema.ts:95` | `1536` -> `768` | ~2 | Low | None | Unit: validate schema default. |
| P0-R3 | `integration/src/types.ts:463` | `1536` -> `768` | ~2 | Low | None | Unit: assert type default. |
| P0-R4 | `cli/src/memory/ewc-consolidation.ts:152` | `384` -> `readEmbeddingsConfig().dimension` | ~8 | Medium | getEmbeddingConfig() exists (ADR-0065) | Unit: mock config, verify dim passed. Integration: real config file read. |
| P0-R5 | `guidance/src/retriever.ts:105` | `384` -> `768` | ~2 | Low | None | Unit: assert dimension constant. |
| P0-R6 | `hooks/src/reasoningbank/index.ts:115` | `384` -> `getEmbeddingConfig().dimension` | ~8 | Medium | getEmbeddingConfig() | Unit: mock config. Integration: real config read. |
| P0-R7 | `hooks/src/reasoningbank/index.ts:934` | `'Xenova/all-MiniLM-L6-v2'` -> `getEmbeddingConfig().model` | ~5 | Medium | getEmbeddingConfig() | Unit: mock config, verify model string. |
| P0-R8 | `cli/src/memory/memory-initializer.ts:951-952` | Hardcoded 768 in SQL -> `readEmbeddingsConfig().dimension` | ~10 | Medium | Config read at init time | Unit: mock SQL generation. Integration: verify generated SQL. |
| P0-R9 | `memory/src/agentdb-backend.ts:27` (AgentDBBackend dim) | `384` -> `768` | ~2 | Low | None | Unit: assert default. |
| P0-R10 | `mcp/.claude/helpers/learning-service.mjs:65,469` | `'all-MiniLM-L6-v2'` -> read from embeddings.json | ~12 | Medium | JSON file read in .mjs context | Integration: verify config read works in ESM helper. |
| P0-R11 | `cli/.claude/helpers/learning-service.mjs:65,469` | Same as P0-R10 | ~12 | Medium | Same | Same |
| P0-R12 | `embeddings/src/embedding-service.ts:380,614` | `'Xenova/all-MiniLM-L6-v2'` -> read from config | ~8 | Medium | Config available at embedding init | Unit: mock config, verify model. |

**P0 Wave 1 subtotals:** 12 tasks, ~73 lines changed, 12 files in ruflo fork.

#### P0 Wave 2: Dimension and model fixes in agentic-flow fork

All paths below are relative to `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/`.

| ID | File (absolute fork path) | Change | Est. lines | Risk | Deps | Tests |
|----|--------------------------|--------|-----------|------|------|-------|
| P0-A1 | `core/agentdb-wrapper.ts:90` | `384` -> `getEmbeddingConfig().dimension` | ~8 | Medium | Need getEmbeddingConfig() available in af | Unit: mock config. |
| P0-A2 | `core/agentdb-wrapper-enhanced.ts:108,119,128` | `384` (3 occurrences) -> config read | ~15 | Medium | Same | Unit: mock config, verify all 3 sites. |
| P0-A3 | `intelligence/EmbeddingService.ts:179-180` | `'all-MiniLM-L6-v2'` and `256`/`384` -> config read | ~10 | Medium | Config or env var | Unit: mock config. |
| P0-A4 | `reasoningbank/utils/embeddings.ts:47,53,151` | `'all-MiniLM-L6-v2'`, `return 384` -> config read | ~12 | Medium | Config available in util context | Unit: mock, assert 768 default. |
| P0-A5 | `services/agentdb-service.ts:215,461` | `'Xenova/all-MiniLM-L6-v2'`, `384` -> config read | ~10 | Medium | Config | Unit: mock config. |
| P0-A6 | `routing/TinyDancerRouter.ts:87` | `384` -> config read | ~5 | Low | Config | Unit: assert dimension from config. |

**P0 Wave 2 subtotals:** 6 tasks, ~60 lines changed, 6 files in agentic-flow fork.

**P0 total: 18 tasks, ~133 lines, 18 files across 2 repos.**

#### P1: Deduplication, singletons, HNSW config, RuntimeConfig extensions

All paths relative to `/Users/henrik/source/forks/ruflo/v3/@claude-flow/` unless noted.

| ID | File | Change | Est. lines | Risk | Deps | Tests |
|----|------|--------|-----------|------|------|-------|
| P1-1 | `memory/src/controller-registry.ts` (1385 lines) | Replace 6x `new X(db, ...)` with `this.agentdb.getController('name')` for reasoningBank, causalRecall, learningSystem, explainableRecall, nightlyLearner, graphTransformer | ~60 (remove constructor calls, add getController calls) | **High** | P0 complete (AgentDB must have correct dim). AgentDB.getController() must return initialized instances. | Unit: mock agentdb.getController, verify 6 calls. Integration: real AgentDB init, count constructor invocations (must be exactly 1 per controller). Acceptance: published package grep for `new RB(` must return 0. |
| P1-2 | `memory/src/controller-registry.ts` | Replace `new MG({dimension})` with `this.agentdb.getMutationGuard()` | ~8 | **High** | Same as P1-1. getMutationGuard() must exist. | Same test file as P1-1. |
| P1-3a | `agentic-flow: controllers/CausalMemoryGraph.ts` | Add optional `attentionService?: AttentionService` constructor param. Use injected instance if provided, else create LegacyAttentionAdapter (backward compat). | ~15 | Medium | None (additive) | Unit: construct with and without param, verify no duplicate creation. |
| P1-3b | `agentic-flow: controllers/ExplainableRecall.ts` | Same pattern as P1-3a | ~15 | Medium | None | Same |
| P1-3c | `agentic-flow: controllers/NightlyLearner.ts` | Same pattern as P1-3a | ~15 | Medium | None | Same |
| P1-3d | `agentic-flow: AgentDB.ts (initialize())` | Create one AttentionService, inject into CausalMemoryGraph, ExplainableRecall, NightlyLearner constructors | ~20 | **High** | P1-3a/b/c merged first | Integration: init AgentDB, verify only 1 AttentionService instance via counting. |
| P1-4 | `cli/src/memory/memory-bridge.ts` + `shared embeddings.json` | Add `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` to embeddings.json if missing. Propagate values to AgentDBConfig, RvfBackend, HNSWLibBackend init calls. | ~35 | Medium | P0 (embeddings.json already canonical) | Unit: mock config with/without HNSW keys. Integration: real config read + verify params reach backend. Acceptance: grep published embeddings.json for hnsw.m. |
| P1-5 | `memory/src/controller-registry.ts` + `shared/src/core/config/` | Add RuntimeConfig fields: nightlyLearner, causalRecall, queryOptimizer, selfLearningRvfBackend, mutationGuard tuning sections. Wire into controller creation. | ~80 | Medium | P1-1 (controller creation path changed) | Unit: mock RuntimeConfig with tuning values, verify they reach constructors. |
| P1-6 | `.claude-flow/config.json` (ruflo-patch) | Add `controllers.nightlyLearner.*`, `controllers.causalRecall.*`, etc. sections to default config.json template. | ~40 | Low | P1-5 (defines schema) | Acceptance: grep published config.json for controller sections. |
| P1-7 | Scattered files: `agentdb-backend.ts:123`, `integration/types.ts:465`, `agentic-flow-bridge.ts:607` | Replace hardcoded `hnswM: 16` with `getHNSWConfig().m` or `deriveHNSWParams(dim).m` | ~20 | Low | P1-4 (HNSW config propagation path) | Unit: mock config, verify M value. Acceptance: grep for `hnswM: 16` returns 0 outside test fixtures. |

**P1 total: 10 tasks, ~308 lines, ~12 files across 2 repos. controller-registry.ts is the highest-risk single file.**

#### P2: Stubs, registration, enable/disable

| ID | File | Change | Est. lines | Risk | Deps | Tests |
|----|------|--------|-----------|------|------|-------|
| P2-1 | `memory/src/controller-registry.ts` | Wire `agentMemoryScope` stub to existing `agent-memory-scope.ts` class. Constructor: `new AgentMemoryScope(this.config.agentId, backend)`. | ~25 | Low | agent-memory-scope.ts exists and compiles | Unit: mock constructor. Integration: create scoped memory, verify isolation. |
| P2-2 | `memory/src/` (new file or extend existing) | Implement `hybridSearch`: BM25 (FTS5) + HNSW cosine fusion. Score = `alpha * cosine + (1-alpha) * bm25_normalized`. ~150 lines new controller. | ~150 | **High** | AgentDB SQLite FTS5 available, vectorBackend exists | Unit: mock FTS5 + vector results, verify fusion scoring. Integration: real SQLite FTS5 + HNSW queries. Acceptance: `agentdb_controllers` lists hybridSearch. |
| P2-3 | `memory/src/` (new file or extend existing) | Implement `federatedSession`: shared-SQLite session transport for multi-agent. ~120 lines new controller. | ~120 | **High** | AgentDB database as transport | Unit: mock DB operations. Integration: 2 agents read/write shared session. |
| P2-4 | `agentic-flow: AgentDB.ts` | Add `'queryOptimizer'` and `'auditLogger'` cases to `getController()` switch. Lazy-init with `this.queryOptimizer ??= new QO(this.db)`. | ~20 | Low | Classes already exist | Unit: call getController('queryOptimizer'), verify instance. |
| P2-5 | `cli/src/memory/memory-bridge.ts` + config.json | Add `controllers.enabled` section to config.json. Wire in memory-bridge.ts: merge `cfgJson.controllers.enabled` with hardcoded enable/disable map. | ~40 | Medium | P1-5 (RuntimeConfig extensions) | Unit: mock config with enabled/disabled controllers, verify init skips disabled. Integration: real config with `learningBridge: false`, verify not initialized. Acceptance: toggle controller in config, verify effect. |

**P2 total: 5 tasks, ~355 lines, ~6 files. hybridSearch and federatedSession are new implementations with highest risk.**

#### P3: ruvector fork defaults

All paths relative to `/Users/henrik/source/forks/ruvector/crates/`.

| ID | File | Change | Est. lines | Risk | Deps | Tests |
|----|------|--------|-----------|------|------|-------|
| P3-1 | `ruvector-core/src/types.rs:119` | `DbOptions::default().dimensions` from 384 to 768 | ~2 | Low | None | Rust unit test: assert default. |
| P3-2 | `ruvector-cli/src/config.rs:92` | `fn default_dimensions()` from 384 to 768 | ~2 | Low | None | Rust unit test. |
| P3-3 | `ruvector-graph-node/src/types.rs:48` | `JsGraphOptions::default().dimensions` from `Some(384)` to `Some(768)` | ~2 | Low | None | Rust unit test. |
| P3-4 | `ruvector-postgres/src/routing/router.rs:158,167` | `embedding_dim: 384` to `embedding_dim: 768` | ~4 | Low | None | Rust unit test. |
| P3-5 | ruflo fork: RuVectorBackend (location TBD in memory/src/) | `getAdaptiveParams()` delegates to `deriveHNSWParams(dimension)` instead of dataset-size lookup | ~20 | Medium | deriveHNSWParams() exists (ADR-0065) | Unit: verify getAdaptiveParams(768) returns M=23. |

**P3 total: 5 tasks, ~30 lines, 5 files (4 Rust, 1 TypeScript). Requires `cargo build` for Rust changes but zero cross-repo dependency.**

### C. Testing Strategy

#### Unit tests (London School TDD, mocked deps)

| Phase | Test file (ruflo-patch) | What to mock | Key assertions |
|-------|------------------------|--------------|----------------|
| P0 | `tests/unit/config-unification-adr0066-p0.test.mjs` | `getEmbeddingConfig()`, `readEmbeddingsConfig()`, `fs.readFileSync` for embeddings.json | Every dimension fallback resolves to 768. Every model fallback resolves to config value, not `all-MiniLM-L6-v2`. |
| P1 | `tests/unit/config-unification-adr0066-p1.test.mjs` | `agentdb.getController()`, `AttentionService` constructor, RuntimeConfig with tuning values | 6 controllers obtained via getController() not `new X()`. AttentionService constructed exactly once. Tuning values from RuntimeConfig reach controller constructors. |
| P2 | `tests/unit/config-unification-adr0066-p2.test.mjs` | SQLite FTS5 results, vector search results, session DB operations | hybridSearch fusion score = alpha * cosine + (1-alpha) * bm25. agentMemoryScope isolates by agentId. `controllers.enabled: false` prevents init. |
| P3 | Rust: `#[test]` in each modified crate | None (Rust defaults are pure) | `DbOptions::default().dimensions == 768`. `default_dimensions() == 768`. |

#### Integration tests (real I/O)

| Phase | Test file | What exercises real I/O | Key assertions |
|-------|-----------|------------------------|----------------|
| P0 | `tests/unit/config-unification-adr0066-p0.test.mjs` (integration section) | Read real `.claude-flow/embeddings.json`, verify dimension/model propagation through actual code paths | `ewc-consolidation` uses real config. `memory-initializer` generates SQL with config dimension. |
| P1 | `tests/unit/config-unification-adr0066-p1.test.mjs` (integration section) | Initialize real AgentDB, count constructor calls via spy | Each of the 6 deduplicated controllers has exactly 1 instance. AttentionService count = 1 (not 4). HNSW params from real embeddings.json reach backend. |
| P2 | `tests/unit/config-unification-adr0066-p2.test.mjs` (integration section) | Real SQLite FTS5 + HNSW for hybridSearch, real multi-agent session write/read | hybridSearch returns ranked results combining keyword + semantic. federatedSession persists across agents. |

#### Acceptance tests (bash checks against published packages)

New file: `lib/acceptance-adr0066-checks.sh`, sourced in `scripts/test-acceptance.sh`.

| Check ID | Phase | What it verifies | Command |
|----------|-------|------------------|---------|
| `check_adr0066_no_384_fallbacks` | P0 | Zero `384` dimension literals in published `.js`/`.ts` dist (excluding test fixtures, comments, MODEL_REGISTRY) | `grep -rn '384' $DIST --include='*.js' \| grep -v test \| grep -v MODEL_REGISTRY \| grep -v '// ' \| wc -l` == 0 |
| `check_adr0066_no_1536_fallbacks` | P0 | Zero `1536` dimension literals in published dist | Same pattern for 1536 |
| `check_adr0066_no_miniLM_hardcodes` | P0 | Zero `MiniLM-L6-v2` strings outside MODEL_REGISTRY | `grep -rn 'MiniLM-L6-v2' $DIST \| grep -v MODEL_REGISTRY \| wc -l` == 0 |
| `check_adr0066_defaults_768` | P0 | `shared/config/defaults` exports 768 | `grep 'dimensions.*768' $DIST/shared/` |
| `check_adr0066_no_duplicate_new_RB` | P1 | Zero `new ReasoningBank(` in controller-registry dist | `grep -c 'new ReasoningBank(' $DIST/memory/` == 0 |
| `check_adr0066_no_duplicate_new_CR` | P1 | Zero `new CausalRecall(` in controller-registry dist | Same pattern |
| `check_adr0066_singleton_attention` | P1 | Only 1 `new AttentionService(` or `new LegacyAttentionAdapter(` in AgentDB dist | `grep -c 'new.*AttentionService\|new.*LegacyAttentionAdapter' $DIST/agentdb/` == 1 |
| `check_adr0066_hnsw_in_embeddings` | P1 | embeddings.json contains `hnsw.m` | `jq '.hnsw.m' $PROJ/.claude-flow/embeddings.json` is not null |
| `check_adr0066_runtime_config_tuning` | P1 | RuntimeConfig type includes nightlyLearner, causalRecall sections | `grep 'nightlyLearner' $DIST/shared/` |
| `check_adr0066_config_controllers` | P1 | config.json has `controllers.nightlyLearner` section | `jq '.controllers.nightlyLearner' $PROJ/.claude-flow/config.json` is not null |
| `check_adr0066_hybrid_search_exists` | P2 | hybridSearch controller listed | `grep 'hybridSearch' $DIST/memory/` |
| `check_adr0066_agent_memory_scope_wired` | P2 | agentMemoryScope controller not null | `grep 'agentMemoryScope' $DIST/memory/controller-registry` |
| `check_adr0066_controller_enabled_config` | P2 | config.json has `controllers.enabled` section | `jq '.controllers.enabled' $PROJ/.claude-flow/config.json` is object |
| `check_adr0066_no_hnswM_16` | P1 | Zero hardcoded `hnswM: 16` in published dist (outside test/example) | `grep -rn 'hnswM.*16' $DIST \| grep -v test \| grep -v example \| wc -l` == 0 |

**14 new acceptance checks, bringing the total from 98 to 112+.**

#### Regression: existing 768-dim databases

Every phase must verify backward compatibility with existing databases:

1. **Before any P0 change**: snapshot a test database created with current code (768-dim vectors from nomic-embed-text).
2. **After P0**: open the snapshot database, verify all queries still return results with correct cosine similarity scores.
3. **After P1**: same snapshot, verify singleton controllers can read/write without schema migration.
4. **After P2**: same snapshot, verify new controllers (hybridSearch, agentMemoryScope) work against existing data.

The integration test suite should include a `test-regression-768-db` fixture that persists across phases.

### D. Rollback Plan

#### P0 rollback (per-file, independent)

Each P0 change is a single-line or few-line edit to a fallback value. Rollback = `git revert` the individual commit. No cross-file dependencies. If a specific dimension change causes a test failure:

1. Revert that one file's change.
2. Investigate whether the file's consumer expects a specific dimension for a reason (e.g., a pre-existing database with 384-dim vectors).
3. If the consumer has a legitimate 384-dim dependency, add a migration path (reindex) rather than keeping the 384 default.

**Risk window:** Each file can be reverted independently without affecting other P0 fixes.

#### P1 rollback (controller-registry.ts is the critical file)

P1-1 and P1-2 change how 7 controllers are obtained in `controller-registry.ts`. If `agentdb.getController()` returns unexpected results at runtime:

1. Revert P1-1/P1-2 commits -- fall back to `new X(db, ...)` direct construction.
2. The old path works because P0 already fixed the dimension defaults, so even duplicate instances will have correct dimensions.
3. For P1-3 (AttentionService singleton): the constructor changes are backward-compatible (optional param). Revert only the AgentDB.initialize() injection commit (P1-3d); the three controller changes (P1-3a/b/c) are safe to keep because they fall back to creating their own instance.
4. For P1-4/P1-5 (HNSW config, RuntimeConfig): these are additive. The old hardcoded values still work. Revert = remove config reads, restore hardcoded values.

**Risk window:** controller-registry.ts changes affect all controller initialization. Test thoroughly in integration before merging to fork.

#### P2 rollback (stubs and config)

1. **Stub controllers** (P2-1/2/3): new code, not replacing anything. Rollback = delete the new files and revert the getController() switch additions. Callers that got `null` before will get `null` again.
2. **queryOptimizer/auditLogger registration** (P2-4): revert the two switch cases. getController() throws again, but the direct `new QO()` / `new AL()` in controller-registry.ts still works.
3. **controllers.enabled config** (P2-5): revert config.json additions and memory-bridge.ts changes. All controllers revert to hardcoded enable/disable map.

**Risk window:** P2 changes are additive. Rollback has no cascading effects.

#### P3 rollback (ruvector fork)

1. Revert the 4 Rust default changes. Rebuild native binaries (`cargo build --release`).
2. The TypeScript side (P3-5, getAdaptiveParams) can be reverted independently -- the old dataset-size lookup table still produces valid (if suboptimal) HNSW params.

**Risk window:** Rust changes require a rebuild of the ruvector native binary. Keep the pre-P3 binary artifact in CI cache for fast rollback.

### E. Success Metrics

#### Quantitative (automated, run in CI)

| Metric | Target | Command |
|--------|--------|---------|
| Hardcoded 384 in dist | 0 occurrences | `grep -rn '= 384\|: 384\|384,' dist/ --include='*.js' --include='*.d.ts' \| grep -v test \| grep -v MODEL_REGISTRY \| grep -v '//' \| wc -l` |
| Hardcoded 1536 in dist | 0 occurrences | Same pattern for 1536 |
| Hardcoded MiniLM-L6-v2 | 0 occurrences outside MODEL_REGISTRY | `grep -rn 'MiniLM-L6-v2' dist/ \| grep -v MODEL_REGISTRY \| wc -l` |
| Controllers via getController() | 46 total (6 migrated from new X() + 40 existing) | Count `getController(` calls vs `new X(` in controller-registry.ts dist |
| AttentionService instances | Exactly 1 in AgentDB init path | `grep -c 'new.*AttentionService\|new.*LegacyAttentionAdapter' dist/agentdb/ \| head -1` == 1 |
| Duplicate controller instances | 0 (verified by constructor call counting) | Integration test: instrument constructors, verify each called exactly once |
| Acceptance checks passing | 112+ (current 98 + 14 new) | `npm run test:acceptance` |
| Unit + integration tests passing | 100% | `npm run test:unit` |
| Hardcoded hnswM: 16 in dist | 0 occurrences outside test/example | `grep -rn 'hnswM.*16' dist/ \| grep -v test \| grep -v example \| wc -l` |

#### Qualitative (manual verification per phase)

| Phase | Verification | Who |
|-------|-------------|-----|
| P0 done | `npx @sparkleideas/cli@latest init --full` in fresh dir; inspect `.claude-flow/embeddings.json` (dimension=768, model=nomic-embed-text-v1.5); run `npx @sparkleideas/cli@latest memory store --key test --value test` and verify no dimension mismatch errors in stderr. | Developer |
| P1 done | `npx @sparkleideas/cli@latest doctor --fix`; inspect agentdb controller list; verify no "duplicate controller" warnings. Run `agentdb_controllers` MCP tool and confirm all 46 controllers listed with correct config values. | Developer |
| P2 done | `agentdb_controllers` MCP tool lists `hybridSearch`, `agentMemoryScope`, `federatedSession` as non-null. Toggle `controllers.enabled.learningBridge: false` in config.json, restart daemon, verify learningBridge is not initialized. | Developer |
| P3 done | Build ruvector from fork (`cargo build --release`); run `ruvector-cli info` and verify default dimension = 768. Run ruflo's `RuVectorBackend.getAdaptiveParams(768)` and verify M=23, efConstruction=100. | Developer |

#### Definition of Done (all must be true)

1. Zero `384` or `1536` dimension fallbacks remain in published dist (only `768` or dynamic config reads).
2. Zero hardcoded `all-MiniLM-L6-v2` model strings remain outside MODEL_REGISTRY in published dist.
3. All 46 controllers initialize from config.json values (dimension, model, HNSW params, tuning params).
4. Zero duplicate controller instances: each of the 7 previously-duplicated controllers has exactly 1 instance (verified by constructor call counting in integration tests).
5. AttentionService created exactly once in AgentDB init path.
6. 112+ acceptance checks pass (current 98 + 14 new ADR-0066 checks).
7. All unit and integration tests pass (`npm run test:unit` exit code 0).
8. Existing 768-dim databases open and query correctly after all changes (regression fixture).

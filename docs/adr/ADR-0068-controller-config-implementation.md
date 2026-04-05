# ADR-0068: Implementation of Controller Configuration Unification

- **Status**: Proposed
- **Date**: 2026-04-05
- **Implements**: ADR-0066
- **Builds on**: ADR-0065 (config centralization)
- **Analysis**: ADR-0067 (original vision for controller wiring)
- **Architecture**: [Controller Wiring Vision](../architecture/controller-wiring-vision.md)

## Review of Work Completed (ADR-0065)

### What we did RIGHT (counts toward the ADR-0066 plan)

ADR-0065 completed the foundational config wiring layer that ADR-0066 depends on. Every item below aligns with the Vision document's Layer 3 (memory-bridge reads config files) and Layer 4 (config files as operator control plane).

**1. Config forwarding gap closed (P0).** `memory-bridge.ts` (ruflo fork, `cli/src/memory/memory-bridge.ts`) now reads both `.claude-flow/config.json` and `.claude-flow/embeddings.json` via `getProjectConfig()` (lines 24-49) and passes assembled values into `RuntimeConfig`. Before ADR-0065, memory-bridge passed a hardcoded object literal that omitted all tuning parameters. This directly implements Vision Section 4, Change 1: "Forward full config to AgentDB."

**2. Dimension fallbacks fixed to 768 (P0).** All `|| 384` and `?? 384` fallbacks in the ruflo fork (`memory-bridge.ts` lines 97/167/1118, `memory-initializer.ts` lines 355/623/631, `config-adapter.ts` line 40) were changed to read from `embeddings.json` with a 768 fallback. This eliminates the split-brain documented in Vision Section 2, Gap 3.

**3. Model name centralized (P0).** The 6 hardcoded `Xenova/all-MiniLM-L6-v2` strings in the ruflo fork were replaced with reads from `embeddings.json` via `getEmbeddingModelName()` (memory-bridge.ts line 51-54). The model is now `Xenova/all-mpnet-base-v2` (768-dim) as declared in embeddings.json.

**4. RuntimeConfig expanded (P0/P1).** `controller-registry.ts` lines 126-196 now has typed fields for `attentionService`, `multiHeadAttention`, `selfAttention`, `solverBandit`, `rateLimiter`, `quantizedVectorStore`, and `circuitBreaker`. These match the `controllers.*` sections in config.json (lines 39-72).

**5. config.json structural mismatches fixed (P1).** `swarm.autoScale` changed from bare `true` to `{ enabled: true }`. `mcp.port` moved to `mcp.transport.port`. `memory.type` alias added. See config.json lines 6, 10, 37.

**6. Dead config fields removed (P3-4).** `memory.agentScopes`, `neural.flashAttention`, `neural.maxModels` removed from config.json.

**7. SqlJsBackend removed (P3-1).** `database-provider.ts` (lines 1-20) now selects only `better-sqlite3` or `rvf` -- the `sql.js` and `json` backend types are gone. This eliminates ~1000 lines and 2 brute-force search paths as the Vision intended.

**8. Shared HNSW derivation (P3-3).** `hnsw-utils.ts` (25 lines) provides `deriveHNSWParams(dimension)` as the single formula. Both `agentdb-backend.ts` and `rvf-backend.ts` import from this shared module.

**9. Shared DDL (P3-2).** `memory-schema.ts` (56 lines) defines `MEMORY_ENTRIES_DDL`, `MEMORY_ENTRIES_INDEXES`, and `MEMORY_EMBEDDINGS_DDL` once. Both SQLiteBackend and AgentDBBackend import from this module instead of duplicating the 16-column schema.

**10. embeddings.json extended with HNSW settings (P1).** embeddings.json now includes `hnsw.metric`, `hnsw.maxElements`, `hnsw.persistIndex`, `hnsw.rebuildThreshold`, and `hashFallbackDimension` (lines 10-16). Missing: `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` -- these are in ADR-0066 P1-4.

**11. daemon config added (P1).** config.json lines 73-81 add `daemon.maxConcurrent`, `daemon.workerTimeoutMs`, `daemon.headless`, `daemon.resourceThresholds`.

### What we did WRONG (needs fixing)

**1. embeddings.json HNSW params incomplete.** ADR-0066 P1-4 specifies `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` as required fields. The current embeddings.json (line 10-15) has `metric`, `maxElements`, `persistIndex`, `rebuildThreshold` but NOT the three HNSW tuning params. These must be added and propagated to all backends.

**2. Config forwarding to AgentDB constructor still incomplete.** Memory-bridge reads config and passes it to ControllerRegistry's RuntimeConfig, but the registry still constructs AgentDB with only `{ dbPath, maxElements }` at controller-registry.ts:582-585. The dimension and embeddingModel are NOT forwarded to AgentDBConfig. This is Vision Section 2, Gap 3 -- partially addressed but not fully closed.

### What we did that was UNNECESSARY or MISALIGNED

Nothing identified. All ADR-0065 changes align with the upstream author's four-layer architecture. The work was conservative -- it wired config files into the existing RuntimeConfig interface without restructuring the controller ownership model.

## Implementation Plan

### Wave 1: Fork patches (agentic-flow) -- P0 + P1 prerequisites

These changes must land first because they fix AgentDB internals that all three wiring layers depend on.

**W1-1: Wire singletons in AgentDB.initialize() (2-line fix)**
- File: `/Users/henrik/source/forks/agentic-flow/agentic-flow/packages/agentdb/src/core/AgentDB.ts`
- At line 157: pass `controllerVB`, `this.causalGraph`, `this.explainableRecall` to CausalRecall constructor (ADR-0056 + ADR-0040 fix)
- At line 160: pass `this.causalGraph`, `this.reflexion`, `this.skills` to NightlyLearner constructor (ADR-0040 fix)
- This benefits all three wiring layers (AgentDB core, AgentDBService, ControllerRegistry)

**W1-2: Extend getController() switch**
- File: same AgentDB.ts, lines 183-223
- The switch currently has 13 cases (confirmed by reading the fork source). ADR-055's claim
  of "only 5 reliable" refers to an older alpha; the fork already has all 13.
- Add 3 new cases for ADR-0066: `queryOptimizer`, `auditLogger`, `batchOperations`
- Add 3 new cases for ADR-0069 F1 readiness (scope note: these go beyond ADR-0066 but are
  trivial to add now): `attentionService`, `hierarchicalMemory`, `memoryConsolidation`
- Total after this change: 19 names in the switch (13 existing + 3 ADR-0066 + 3 F1)

**W1-5: Inject shared AttentionService into CausalMemoryGraph, ExplainableRecall, NightlyLearner**
- Files: `packages/agentdb/src/controllers/CausalMemoryGraph.ts`, `ExplainableRecall.ts`, `NightlyLearner.ts`
- Add optional `attentionService?: AttentionService` constructor parameter to each
- In AgentDB.initialize(): create ONE AttentionService, pass it to all three
- This eliminates 3 accidental duplicate instances (all with identical config)
- Note: this is NOT a global singleton — ADR-0028 designed for multi-instance with different
  configs. The sharing is only for identical-config duplicates (per ADR-0067 Section 8)

**W1-3: Fix all 384 dimension fallbacks in agentic-flow**
- Files: `agentdb-wrapper.ts:90`, `agentdb-wrapper-enhanced.ts:108/119/128`, `EmbeddingService.ts:179-180`, `reasoningbank/utils/embeddings.ts:47/53/151`, `agentdb-service.ts:215/461`, `TinyDancerRouter.ts:87`
- 6 files, ~60 lines total (ADR-0066 P0-A1 through P0-A6)

**W1-4: Fix all hardcoded model names in agentic-flow**
- Files: `reasoningbank/utils/embeddings.ts:47,53`, `agentdb-service.ts:215,461`, `EmbeddingService.ts:179`
- Replace `all-MiniLM-L6-v2` with reads from `getEmbeddingConfig().model`

### Wave 2: Fork patches (ruflo) -- P0 remaining + P1 main

**W2-1: Fix remaining 384/1536 dimension fallbacks in ruflo**
- Files: `shared/src/core/config/defaults.ts:78` (1536), `shared/src/core/config/schema.ts:95` (1536), `integration/src/types.ts:463` (1536), `ewc-consolidation.ts:152` (384), `guidance/retriever.ts:105` (384), `hooks/reasoningbank/index.ts:115` (384), `memory/src/agentdb-backend.ts:27` (384)
- 7 files, ~30 lines (ADR-0066 P0-R1 through P0-R9)

**W2-2: Fix remaining hardcoded model names in ruflo**
- Files: `hooks/src/reasoningbank/index.ts:934`, `mcp/.claude/helpers/learning-service.mjs:65,469`, `cli/.claude/helpers/learning-service.mjs:65,469`, `embeddings/src/embedding-service.ts:380,614`
- 4 files, ~37 lines (ADR-0066 P0-R7, P0-R10, P0-R11, P0-R12)

**W2-3: Registry delegates to AgentDB for Tier 1 controllers**
- File: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts`
- Replace 6 `new X(db, ...)` calls with `this.agentdb.getController('name')` for reasoningBank, causalRecall, learningSystem, explainableRecall, nightlyLearner, graphTransformer
- Replace `new MG({dimension})` with `this.agentdb.getMutationGuard()`
- Highest-risk change -- depends on W1-2 (getController extension)

**W2-4: Forward full config to AgentDB constructor**
- File: controller-registry.ts lines 582-585
- Pass `dimension`, `embeddingModel`, HNSW params from RuntimeConfig into AgentDBConfig
- Closes Vision Gap 3 completely

**W2-5: Add HNSW tuning to embeddings.json and propagate**
- Add `hnsw.m`, `hnsw.efConstruction`, `hnsw.efSearch` to embeddings.json
- Values are derived from `deriveHNSWParams(768)`: M=23, efConstruction=100, efSearch=50
  (these differ from the upstream ADR-001 hand-tuned defaults of M=16/efC=200/efS=100
  because the formula accounts for the 768-dim model — `floor(sqrt(768)/1.2)=23`,
  `clamp(4*23,100,500)=100`, `clamp(2*23,50,400)=50`)
- Propagate to AgentDBConfig, RvfBackend, HNSWLibBackend init calls
- Replace scattered `hnswM: 16` hardcodes in `agentdb-backend.ts:123`, `integration/types.ts:465`, `agentic-flow-bridge.ts:607`

### Wave 3: Fork patches (ruvector at `/Users/henrik/source/forks/ruvector/`) -- P3

**W3-1: Fix dimension defaults**
- Files: `crates/ruvector-core/src/types.rs:119`, `crates/ruvector-cli/src/config.rs:92`, `crates/ruvector-graph-node/src/types.rs:48`, `crates/ruvector-postgres/src/routing/router.rs:158,167`
- Change all 384 defaults to 768 (4 files, ~10 lines Rust)

**W3-2: Fix RuVectorBackend adaptive params**
- File: ruflo fork, `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts`
  (RuVectorBackend's `getAdaptiveParams()` is in this file's import chain)
- `getAdaptiveParams()` delegates to `deriveHNSWParams(dimension)` from `hnsw-utils.ts`

### Wave 4: Patch repo (ruflo-patch) -- P1 config + P2 stubs

**W4-1: Expand RuntimeConfig**
- File: controller-registry.ts lines 126-196
- Add tuning sections: `nightlyLearner`, `causalRecall`, `queryOptimizer`, `selfLearningRvfBackend`, `mutationGuard`

**W4-2: Expand config.json**
- File: `.claude-flow/config.json`
- Add `controllers.nightlyLearner.*`, `controllers.causalRecall.*`, `controllers.queryOptimizer.*`, etc.
- Add `controllers.enabled` section for feature flags

**W4-3: Implement stub controllers**
- `agentMemoryScope`: wire existing `agent-memory-scope.ts` class
- `hybridSearch`: BM25 + HNSW fusion (~150 lines). Must implement `IMemoryBackend` interface
  for storage operations — do NOT call `better-sqlite3` directly. This is required for
  forward-compatibility with ADR-0069 F2 (RVF storage migration).
- `federatedSession`: shared-SQLite session transport (~120 lines). Must route through
  `IMemoryBackend` for the same reason.

**W4-4: Register queryOptimizer and auditLogger in AgentDB**
- File: AgentDB.ts, add cases to getController() switch
- Lazy-init: `this.queryOptimizer ??= new QO(this.db)`

**W4-5: Wire controllers.enabled from config.json into memory-bridge.ts**
- File: ruflo fork, `@claude-flow/cli/src/memory/memory-bridge.ts`
- In `getRegistry()`, merge `cfgJson.controllers.enabled` with the hardcoded enable/disable map
- Without this, the `controllers.enabled` section added by W4-2 has no runtime effect

### Wave 5: Tests + acceptance

**W5-1: Unit tests** (`tests/unit/config-unification-adr0066-*.test.mjs`)
- P0: mock `getEmbeddingConfig()`, verify all dimension fallbacks resolve to 768, all model strings resolve from config
- P1: mock `agentdb.getController()`, verify 6 controllers obtained via delegation not construction; verify AttentionService created exactly once
- P2: mock FTS5 + vector results, verify hybrid fusion scoring; verify enable/disable config

**W5-2: Integration tests** (same files, integration section)
- P0: read real embeddings.json, verify propagation through code paths
- P1: initialize real AgentDB, count constructor invocations, verify HNSW params from real config
- P2: real SQLite FTS5 + HNSW for hybridSearch

**W5-3: Acceptance tests** (`lib/acceptance-adr0066-checks.sh`)
- `check_adr0066_no_384_fallbacks`: zero 384 literals in published dist
- `check_adr0066_no_miniLM`: zero `MiniLM` strings in published dist
- `check_adr0066_no_new_RB`: zero `new RB(` in controller-registry published dist
- `check_adr0066_hnsw_config`: embeddings.json in published package contains `hnsw.m`
- `check_adr0066_controllers_enabled`: config.json has `controllers.enabled` section

## Files to Modify (complete list with fork paths)

### agentic-flow fork (`/Users/henrik/source/forks/agentic-flow/agentic-flow/`)

| File | Wave | Change |
|------|------|--------|
| `packages/agentdb/src/core/AgentDB.ts:157,160` | W1-1 | Wire singletons (2-line fix) |
| `packages/agentdb/src/core/AgentDB.ts:183-223` | W1-2 | Extend getController() switch |
| `src/core/agentdb-wrapper.ts:90` | W1-3 | 384 -> config |
| `src/core/agentdb-wrapper-enhanced.ts:108,119,128` | W1-3 | 384 -> config |
| `src/intelligence/EmbeddingService.ts:179-180` | W1-3/4 | 384 + model -> config |
| `src/reasoningbank/utils/embeddings.ts:47,53,151` | W1-3/4 | 384 + model -> config |
| `src/services/agentdb-service.ts:215,461` | W1-3/4 | 384 + model -> config |
| `src/routing/TinyDancerRouter.ts:87` | W1-3 | 384 -> config |
| `src/controllers/CausalMemoryGraph.ts` | W1 (P1-3a) | Optional AttentionService param |
| `src/controllers/ExplainableRecall.ts` | W1 (P1-3b) | Optional AttentionService param |
| `src/controllers/NightlyLearner.ts` | W1 (P1-3c) | Optional AttentionService param |

### ruflo fork (`/Users/henrik/source/forks/ruflo/v3/@claude-flow/`)

| File | Wave | Change |
|------|------|--------|
| `shared/src/core/config/defaults.ts:78` | W2-1 | 1536 -> 768 |
| `shared/src/core/config/schema.ts:95` | W2-1 | 1536 -> 768 |
| `integration/src/types.ts:463` | W2-1 | 1536 -> 768 |
| `cli/src/memory/ewc-consolidation.ts:152` | W2-1 | 384 -> config read |
| `guidance/src/retriever.ts:105` | W2-1 | 384 -> 768 |
| `hooks/src/reasoningbank/index.ts:115,934` | W2-1/2 | 384 + model -> config |
| `memory/src/agentdb-backend.ts:27` | W2-1 | 384 -> 768 |
| `mcp/.claude/helpers/learning-service.mjs:65,469` | W2-2 | Model -> config |
| `cli/.claude/helpers/learning-service.mjs:65,469` | W2-2 | Model -> config |
| `embeddings/src/embedding-service.ts:380,614` | W2-2 | Model -> config |
| `memory/src/controller-registry.ts:582-585,883-953` | W2-3/4/W4-1 | Delegate + forward config |
| `cli/src/memory/memory-bridge.ts` | W2-5 | HNSW propagation |

### ruvector fork (`/Users/henrik/source/forks/ruvector/crates/`)

| File | Wave | Change |
|------|------|--------|
| `ruvector-core/src/types.rs:119` | W3-1 | 384 -> 768 |
| `ruvector-cli/src/config.rs:92` | W3-1 | 384 -> 768 |
| `ruvector-graph-node/src/types.rs:48` | W3-1 | 384 -> 768 |
| `ruvector-postgres/src/routing/router.rs:158,167` | W3-1 | 384 -> 768 |

### ruflo-patch repo (`/Users/henrik/source/ruflo-patch/`)

| File | Wave | Change |
|------|------|--------|
| `.claude-flow/config.json` | W4-2 | Add controller tuning + enabled sections |
| `.claude-flow/embeddings.json` | W2-5 | Add hnsw.m, hnsw.efConstruction, hnsw.efSearch |
| `tests/unit/config-unification-adr0066-*.test.mjs` | W5-1/2 | Unit + integration tests |
| `lib/acceptance-adr0066-checks.sh` | W5-3 | Acceptance checks |
| `scripts/test-acceptance.sh` | W5-3 | Source new check file |

## Acceptance Criteria

- [ ] Zero `384` or `1536` dimension fallbacks in any fork (only `768` or config reads)
- [ ] Zero hardcoded `all-MiniLM-L6-v2` model strings outside MODEL_REGISTRY
- [ ] AgentDB.initialize() passes singletons to CausalRecall and NightlyLearner (W1-1)
- [ ] AgentDB.getController() handles all 16+ controller names (W1-2) including attentionService, hierarchicalMemory, memoryConsolidation for ADR-0069 F1 readiness
- [ ] ControllerRegistry delegates to agentdb.getController() for 6 Tier 1 controllers (W2-3)
- [ ] ControllerRegistry forwards dimension/model/HNSW to AgentDB constructor (W2-4)
- [ ] embeddings.json contains hnsw.m, hnsw.efConstruction, hnsw.efSearch (W2-5)
- [ ] ruvector default dimensions = 768 in all 4 crates (W3-1)
- [ ] RuntimeConfig has tuning sections for nightlyLearner, causalRecall, queryOptimizer, mutationGuard (W4-1)
- [ ] config.json has controllers.enabled section (W4-2)
- [ ] hybridSearch, agentMemoryScope, federatedSession stubs replaced with implementations (W4-3)
- [ ] All unit, integration, and acceptance tests pass (W5)

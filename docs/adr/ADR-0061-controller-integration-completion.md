# ADR-0061: Controller Integration Completion

- **Status**: Implemented
- **Date**: 2026-04-05
- **Deciders**: 8-member hive-mind panel (Reuven Cohen as Queen, 7 specialists) + 15-agent source verification swarm
- **Methodology**: SPARC + hierarchical hive-mind consensus with BFT voting + deep source audit

## Context

ADRs 0033 through 0048 describe a system of 44-50 controllers across 7 initialization levels. A source audit (2026-04-05) found the actual state is far behind the documented target:

| Metric | ADR claim | Actual source (15-agent verified) |
|--------|-----------|-----------------------------------|
| Registry slots (INIT_LEVELS) | 44 | **28** |
| Actually instantiate | 43+ | **17** (S1-S4 verified) |
| Return null (registered, broken) | 0 | **6** with bugs, **3** placeholders |
| Hardcoded disabled | 1 | **4** (hybridSearch, agentMemoryScope, federatedSession, learningBridge) |
| Classes exported from agentdb | 32 (12 missing) | **34 of 38 exported** (4 missing) |
| Static-only classes (no instance) | 0 | **3** (MetadataFilter, ContextSynthesizer, MMRDiversityRanker) |

The ADR-0048 claim "12 controller classes not exported from agentdb" is **stale**. A barrel audit of `agentdb/src/index.ts` confirms 16 of the 20 missing controllers are now exported. Only 4 (ResourceTracker, RateLimiter, CircuitBreaker, TelemetryManager) remain unexported from the top-level barrel.

### Source Files Audited

| File | Location | Lines |
|------|----------|------:|
| controller-registry.ts | `v3/@claude-flow/memory/src/` | 1029 |
| memory-bridge.ts | `v3/@claude-flow/cli/src/memory/` | 1967 |
| agentdb index.ts | `packages/agentdb/src/` | 131 |
| controllers/index.ts | `packages/agentdb/src/controllers/` | 75 |
| security/index.ts | `packages/agentdb/src/security/` | 38 |
| observability/index.ts | `packages/agentdb/src/observability/` | 11 |
| quantization/index.ts | `packages/agentdb/src/quantization/` | 27 |

### Panel Roles

| Role | Scope | Key finding |
|------|-------|-------------|
| Queen (Reuven Cohen) | Architecture authority | Wire SelfLearningRvfBackend as spine; security trifecta should be Level 0 |
| P1 Registry Architect | INIT_LEVELS, createController() | 4 security controllers NOT in barrel — blocked without upstream PR |
| P2 Bridge Engineer | memory-bridge.ts | guardedVectorBackend has sequencing bug; 6 null controllers fixable via bridge config |
| P3 RuVector Lead | NativeAccelerator, SelfLearningRvfBackend | SelfLearningRvfBackend has **private constructor** — must use `static async create()` |
| P4 Attention Lead | A1-A5, AttentionMetrics | AttentionService is independent of A1-A3; all pure JS except AttentionService |
| P5 Security Lead | CircuitBreaker, RateLimiter, etc. | MutationGuard factory missing `await initialize()` — existing bug |
| P6 Optimization Lead | QuantizedVectorStore, QueryOptimizer, etc. | MetadataFilter is static-only; QueryOptimizer needs live DB handle |
| P7 Ruflo Integrator | Fork pipeline, codemod | Codemod handles new imports automatically; acceptance floor is 5, not 28 |

### 15-Agent Source Verification Swarm

15 specialized agents each read actual source constructors, barrel exports, and factory code. Agents S1-S4 traced all 28 existing controllers. S5-S13 deep-dived each new controller. S14 audited all 38 barrel exports. S15 traced the full bridge→isEnabled→createController chain.

### Verified Controller Status (28 existing slots)

| Controller | Level | Bridge | isEnabled | createController | **Verdict** | Agent |
|------------|:-----:|--------|-----------|-----------------|-------------|-------|
| reasoningBank | 1 | `true` | true | `new RB(db, embedder)` | **WORKS** (but never passes optional vectorBackend) | S1 |
| hierarchicalMemory | 1 | `true` | true | `new HM(db, embedder)` or stub | **WORKS** (stub fallback) | S1 |
| learningBridge | 1 | `false` | true | not called | **DISABLED** (bridge override) | S1 |
| hybridSearch | 1 | — | false | `return null` always | **PLACEHOLDER** | S1 |
| tieredCache | 1 | `true` | true | `new TieredCacheManager(config)` | **WORKS** always | S1 |
| memoryGraph | 2 | `true` | backend dep | `new MemoryGraph(config)` | **WORKS** always | S2 |
| agentMemoryScope | 2 | — | false | `return null` always | **PLACEHOLDER** | S2 |
| vectorBackend | 2 | — | agentdb dep | `agentdb.getController()` | **WORKS** if agentdb | S2 |
| mutationGuard | 2 | — | agentdb dep | `new MG({dimension})` | **BUG**: missing `initialize()` | S2 |
| gnnService | 2 | — | agentdb dep | `new GNN(config)` + `initialize()` | **WORKS** | S2 |
| skills | 3 | — | agentdb dep | `agentdb.getController('skills')` | **WORKS** if agentdb | S3 |
| explainableRecall | 3 | — | agentdb dep | `new ER(db)` | **WORKS** (embedder optional) | S3 |
| reflexion | 3 | — | agentdb dep | `agentdb.getController('reflexion')` | **WORKS** if agentdb | S3 |
| attestationLog | 3 | — | agentdb dep | **NO CASE** — falls to default | **BUG**: missing switch case | S3 |
| batchOperations | 3 | — | agentdb dep | `new BO(db, embedder)` | **WORKS** if agentdb | S3 |
| memoryConsolidation | 3 | `true` | agentdb dep | `new MC(db, hm, embedder)` or stub | **WORKS** (stub fallback) | S3 |
| causalGraph | 4 | — | agentdb dep | `agentdb.getController('causalGraph')` | **WORKS** if agentdb | S3 |
| nightlyLearner | 4 | — | agentdb dep | `new NL(db)` | **BUG**: missing required `embedder` | S3 |
| learningSystem | 4 | — | agentdb dep | `new LS(db)` | **BUG**: missing required `embedder` | S3 |
| semanticRouter | 4 | — | agentdb dep | `new SR()` + `initialize()` | **WORKS** | S3 |
| graphTransformer | 5 | — | agentdb dep | `new CausalMemoryGraph(db)` | **WORKS** if agentdb | S4 |
| sonaTrajectory | 5 | — | agentdb dep | `agentdb.getController()` only | **WEAK**: no fallback construction | S4 |
| contextSynthesizer | 5 | — | agentdb dep | returns class (static) | **WORKS** (static-only) | S4 |
| rvfOptimizer | 5 | — | agentdb dep | `new RVF()` | **WORKS** | S4 |
| mmrDiversityRanker | 5 | — | agentdb dep | `new MMR()` | **BUG**: class is static-only | S4 |
| guardedVectorBackend | 5 | — | agentdb dep | `this.get()` for uninitialized deps | **BUG**: sequencing | S4 |
| federatedSession | 6 | — | false | `return null` always | **PLACEHOLDER** | S4 |
| graphAdapter | 6 | — | agentdb dep | `agentdb.getController()` | **WORKS** if agentdb | S4 |

**Summary**: 17 WORKS, 6 BUGS, 3 PLACEHOLDERS, 1 DISABLED, 1 WEAK

### Definitive Barrel Export Audit (S14)

34 of 38 classes exported. **4 NOT exported** from `agentdb/src/index.ts`:

| Class | Source file | Why not exported |
|-------|-----------|-----------------|
| ResourceTracker | `security/limits.ts` | `security/index.ts` exports it, but barrel doesn't re-export limits |
| RateLimiter | `security/limits.ts` | Same |
| CircuitBreaker | `security/limits.ts` | Same |
| TelemetryManager | `observability/telemetry.ts` | `observability/index.ts` exports it, but barrel doesn't import that |

All other 34 classes confirmed exported with line numbers verified by S14.

## Decision

### 10 Bugs in Existing Code (swarm-verified)

| # | Bug | Location | Severity | Agent | Fix |
|---|-----|----------|----------|-------|-----|
| 1 | `mutationGuard` factory missing `await initialize()` | registry:843 | Medium — degrades to JS-only SHA-256 proofs, WASM acceleration skipped | S2 | Add `await instance.initialize()` after construction |
| 2 | `learningSystem` missing required `embedder` arg | registry:780 | **Critical** — `this.embedder` is undefined, crashes on first embedding call | S3 | Pass `this.createEmbeddingService()` as second arg |
| 3 | `nightlyLearner` missing required `embedder` arg | registry:800 | **Critical** — same crash pattern as learningSystem | S3 | Pass `this.createEmbeddingService()` as second arg |
| 4 | `attestationLog` has NO switch case in createController | registry (missing) | **Critical** — falls to `default: return null`, always null despite being in INIT_LEVELS | S3 | Add case: `new AL(this.agentdb.database)` |
| 5 | `mmrDiversityRanker` calls `new MMR()` but class is static-only | registry:834 | Medium — returns useless empty instance, callers get no methods | S4 | Return class reference (like contextSynthesizer) or remove from registry |
| 6 | `guardedVectorBackend` calls `this.get()` for deps not yet initialized | registry:891 | Medium — silent null when vectorBackend/mutationGuard not ready | S4 | Keep disabled until ensure() mechanism added |
| 7 | `sonaTrajectory` no fallback construction path | registry:687 | Low — only route is `agentdb.getController()`, no direct `new` | S4 |Add fallback: `new SonaTrajectoryService()` + `initialize()` |
| 8 | `reasoningBank`/`hierarchicalMemory` never pass available backends | registry:743,698 | Low — vectorBackend and graphBackend always omitted, silently disabling HNSW-enhanced recall | S1 | Pass `this.get('vectorBackend')` as 3rd arg |
| 9 | **QuantizedVectorStore dual-class confusion** | barrel:119 vs quantization/ | **Critical** — barrel exports `optimizations/Quantization.ts` which retains raw vectors (NOT memory-efficient). The genuine memory-efficient version is in `quantization/vector-quantization.ts` (only via wasm-loader) | S10 | Import from quantization/ path, or fix upstream barrel |
| 10 | `selfLearningRvfBackend` private constructor | Not yet wired | Wiring trap — `new` will fail at compile time | S8 | Must use `await SelfLearningRvfBackend.create(config)` |

### 0 Blockers

This is a **patch repo** — it exists to patch upstream forks. All changes are made in our forks of `ruflo`, `agentic-flow`, and `ruv-FANN`, then flow through the pipeline (copy-source → codemod → build → publish). Nothing requires upstream PRs or external approval.

The 4 missing barrel exports (ResourceTracker, RateLimiter, CircuitBreaker, TelemetryManager) are patched directly in our agentic-flow fork.

### Fork Patch Plan

| Fork | File | Patch |
|------|------|-------|
| **agentic-flow** | `packages/agentdb/src/index.ts` | Add 2 lines: `export { ResourceTracker, RateLimiter, CircuitBreaker } from './security/limits.js'` and `export { TelemetryManager } from './observability/telemetry.js'` |
| **agentic-flow** | `packages/agentdb/src/index.ts` | Swap QuantizedVectorStore export to `quantization/vector-quantization.ts` (memory-efficient version) |
| **ruflo** | `v3/@claude-flow/memory/src/controller-registry.ts` | Fix 8 existing bugs + add 15 new controller cases + update INIT_LEVELS |
| **ruflo** | `v3/@claude-flow/cli/src/memory/memory-bridge.ts` | Update bridge config to enable fixed controllers |

### 6-Phase Integration Plan

#### Phase 0: Agentic-Flow Fork Patches (~1h)

Patch `packages/agentdb/src/index.ts` in our agentic-flow fork:

```typescript
// Add to index.ts — security infrastructure (ADR-0061)
export { ResourceTracker, RateLimiter, CircuitBreaker, SecurityError } from './security/limits.js';
export { TelemetryManager } from './observability/telemetry.js';

// Fix: swap QuantizedVectorStore to memory-efficient version (ADR-0061 Bug #9)
// BEFORE: export { QuantizedVectorStore } from './optimizations/Quantization.js';
// AFTER:
export { QuantizedVectorStore } from './quantization/vector-quantization.js';
export type { QuantizedVectorStoreConfig, QuantizedSearchResult } from './quantization/vector-quantization.js';
```

#### Phase 1: Fix Existing Broken Factories (~4h)

8 controllers already in INIT_LEVELS that are broken or suboptimal (swarm-verified):

| Controller | Level | Bug | Fix |
|------------|:-----:|-----|-----|
| mutationGuard | 2 | Missing `await initialize()` (S2) | Add `await instance.initialize()` after construction |
| attestationLog | 3 | **No switch case at all** (S3) | Add case: `const { AttestationLog } = await import(...); return new AL(this.agentdb.database)` |
| learningSystem | 4 | **Missing required `embedder` arg** (S3) | Change to `new LS(this.agentdb.database, this.createEmbeddingService())` |
| nightlyLearner | 4 | **Missing required `embedder` arg** (S3) | Change to `new NL(this.agentdb.database, this.createEmbeddingService())` |
| mmrDiversityRanker | 5 | Calls `new MMR()` but class is static (S4) | Return class reference like contextSynthesizer: `return agentdbModule.MMRDiversityRanker ?? null` |
| reasoningBank | 1 | Never passes available vectorBackend (S1) | Add `this.get('vectorBackend')` as 3rd arg to constructor |
| hierarchicalMemory | 1 | Never passes available vectorBackend (S1) | Add `this.get('vectorBackend')` as 3rd arg to constructor |
| sonaTrajectory | 5 | No fallback construction path (S4) | Add fallback `new SonaTrajectoryService()` + `initialize()` |

**Bridge config change** (memory-bridge.ts line 93):
```typescript
controllers: {
  reasoningBank: true,
  learningBridge: false,
  tieredCache: true,
  hierarchicalMemory: true,
  memoryConsolidation: true,
  memoryGraph: true,
  // Phase 1 additions:
  mutationGuard: true,
  attestationLog: true,
  learningSystem: true,
  explainableRecall: true,
  nightlyLearner: true,
  semanticRouter: true,
},
```

#### Phase 2: Pure JS Controllers (~2h)

Zero-risk additions — no dependencies, no I/O, no native bindings:

| Controller | Level | Constructor | Default |
|------------|:-----:|------------|---------|
| solverBandit | 1 | `new SolverBandit(config?)` | enabled |
| attentionMetrics | 1 | `new AttentionMetricsCollector()` | enabled |

**SolverBandit** (S9 verified): Thompson sampling bandit. Optional `BanditConfig`: `costWeight` (0.01), `costDecay` (0.1), `explorationBonus` (0.1). Methods: `selectArm()`, `recordReward()`, `rerank()`, `getStats()`, `serialize()`/`deserialize()`. Pure in-memory `Map<string, Map<string, BanditArmStats>>` — no persistence built in, caller must `serialize()` manually.

**AttentionMetricsCollector** (S6 verified): Zero-arg constructor. Tracks per-mechanism operation counts, latency histograms, memory usage via `process.memoryUsage()`. Pure Node.js.

**IndexHealthMonitor removed from Phase 2**: S13 confirmed it's created internally by SelfLearningRvfBackend (field initializer at line 78). Separate registry entry would be redundant — accessing it through the parent's stats is sufficient.

**INIT_LEVELS change**:
```typescript
{ level: 1, controllers: [...existing, 'solverBandit', 'attentionMetrics', 'indexHealthMonitor'] },
```

**createController() cases**:
```typescript
case 'solverBandit': {
  const { SolverBandit } = await import('@sparkleideas/agentdb');
  if (!SolverBandit) return null;
  return new SolverBandit();
}
case 'attentionMetrics': {
  const { AttentionMetricsCollector } = await import('@sparkleideas/agentdb');
  if (!AttentionMetricsCollector) return null;
  return new AttentionMetricsCollector();
}
```

#### Phase 3: Attention Suite (~4h)

| Controller | Level | Constructor | Native? |
|------------|:-----:|------------|---------|
| selfAttention | 2 | `new SelfAttentionController(vb \|\| null)` | No — pure JS |
| crossAttention | 2 | `new CrossAttentionController(vb \|\| null)` | No — pure JS |
| multiHeadAttention | 2 | `new MultiHeadAttentionController(vb \|\| null, { numHeads: 4 })` | No — pure JS |
| attentionService | 2 | `new AttentionService({ numHeads, headDim, embedDim })` | Optional NAPI/WASM, JS fallback |

**Note**: AttentionService is independent of A1-A3. It has its own Flash, MoE, GraphRoPE, and Hyperbolic implementations via `@ruvector/attention` bindings with JS fallbacks. A1-A3 are simpler re-rankers using `Map<string, MemoryEntry>` stores.

**AttentionService constructor** (S6 verified — `AttentionService.ts:143`): Requires `numHeads`, `headDim`, `embedDim` (all required). Optional: `dropout` (0.1), `bias` (true), `useFlash` (true), `useLinear` (false), `useHyperbolic` (false), `useMoE` (false). Must call `initialize()` after construction (auto-called lazily). Native loading: tries `@ruvector/attention` NAPI, then `@ruvector/graph-transformer` shim, then `ruvector-attention-wasm`, then pure JS fallback.

**A1-A3 constructors** (S5 verified): All share signature `(vectorBackend: VectorBackend | null = null, config = {})`. VectorBackend is optional — only `insert()` method used. MultiHeadAttention allocates ~2.4MB projection matrices lazily on first `addMemory()` call (8 heads x 768 x 96 x 4 bytes).

**createController() cases**:
```typescript
case 'selfAttention': {
  const { SelfAttentionController } = await import('@sparkleideas/agentdb');
  if (!SelfAttentionController) return null;
  const vb = this.get('vectorBackend');
  return new SelfAttentionController(vb || null, { topK: 10 });
}
case 'crossAttention': {
  const { CrossAttentionController } = await import('@sparkleideas/agentdb');
  if (!CrossAttentionController) return null;
  const vb = this.get('vectorBackend');
  return new CrossAttentionController(vb || null);
}
case 'multiHeadAttention': {
  const { MultiHeadAttentionController } = await import('@sparkleideas/agentdb');
  if (!MultiHeadAttentionController) return null;
  const vb = this.get('vectorBackend');
  return new MultiHeadAttentionController(vb || null, { numHeads: 4 });
}
case 'attentionService': {
  const { AttentionService } = await import('@sparkleideas/agentdb');
  if (!AttentionService) return null;
  const dim = this.config.dimension || 384;
  const svc = new AttentionService({
    numHeads: 8,
    headDim: Math.floor(dim / 8),
    embedDim: dim,
    useFlash: true,
    useMoE: false,
    useHyperbolic: false,
  });
  await svc.initialize();
  return svc;
}
```

#### Phase 4: Optimization (~4h)

| Controller | Level | Constructor | Notes |
|------------|:-----:|------------|-------|
| queryOptimizer | 2 | `new QueryOptimizer(db, config?)` | **Requires** live DB handle with `.prepare()` (S11) |
| enhancedEmbeddingService | 3 | `new EnhancedEmbeddingService(config?)` | All fields optional; lazy `@xenova/transformers` load (S12) |
| quantizedVectorStore | 5 | `new QuantizedVectorStore(config)` | See warning below |

**MetadataFilter** (S11 verified): Entirely static methods — `apply()`, `toSQL()`, `validate()`. No constructor, no instance state. Do NOT add to registry. Call directly in search path.

**ContextSynthesizer** (S4 verified): Also static-only. Existing factory correctly returns the class reference.

**MMRDiversityRanker** (S4 verified): Also static-only. Existing factory incorrectly calls `new MMR()` — fix in Phase 1.

**QuantizedVectorStore WARNING** (S10 critical finding): There are TWO classes with this name:
- `optimizations/Quantization.ts` — **what the barrel exports** (line 119). Config type: `{ type: 'scalar-4bit' | 'scalar-8bit' | 'product' }`. **Retains raw vectors alongside quantized data — NOT memory-efficient.** Uses `rawVectors: Float32Array[]` in memory.
- `quantization/vector-quantization.ts` — the genuine memory-efficient version. Config type: `{ dimension, quantizationType: 'scalar8bit' | 'scalar4bit' | 'product' }`. Stores only quantized form. 30x compression for product quantization.

**Recommendation**: Import from `quantization/vector-quantization.ts` path directly, or file upstream PR to swap the barrel export. The barrel-exported version defeats the purpose of quantization.

**EnhancedEmbeddingService** (S12 verified): The barrel exports from `services/enhanced-embeddings.ts` (NOT `controllers/EnhancedEmbeddingService.ts`). Standalone class, does NOT extend EmbeddingService. All config optional: `provider: 'transformers'`, `model: 'all-MiniLM-L6-v2'`, cache `maxSize: 10000`. `@xenova/transformers` loaded lazily on first use, not at construction.

**QueryOptimizer** (S11 verified): Constructor `(db: Database, config?: Partial<CacheConfig>)` — `db` is required and unconditionally used via `this.db.prepare()`. CacheConfig defaults: `maxSize: 1000`, `ttl: 60000ms`, `enabled: true`. Caches query results keyed by SQL+params hash.

**createController() cases**:
```typescript
case 'queryOptimizer': {
  if (!this.agentdb) return null;
  const { QueryOptimizer } = await import('@sparkleideas/agentdb');
  if (!QueryOptimizer) return null;
  return new QueryOptimizer(this.agentdb.database);
}
case 'enhancedEmbeddingService': {
  const { EnhancedEmbeddingService } = await import('@sparkleideas/agentdb');
  if (!EnhancedEmbeddingService) return null;
  return new EnhancedEmbeddingService();  // all config optional, defaults are sensible
}
case 'quantizedVectorStore': {
  // WARNING: barrel exports the NON-memory-efficient version from optimizations/Quantization.ts
  // Consider importing from quantization/vector-quantization.ts directly for real compression
  const { QuantizedVectorStore } = await import('@sparkleideas/agentdb');
  if (!QuantizedVectorStore) return null;
  return new QuantizedVectorStore({ type: 'scalar-8bit' });
}
```

#### Phase 5: Self-Learning (~6h, highest risk)

| Controller | Level | Constructor | Risk |
|------------|:-----:|------------|------|
| nativeAccelerator | 2 | `getAccelerator()` singleton | Medium — 11 concurrent WASM loaders via allSettled (S9) |
| selfLearningRvfBackend | 4 | `await SelfLearningRvfBackend.create(config)` | High — private ctor, file I/O, 7 sub-components (S8) |
| federatedLearningManager | 4 | `new FederatedLearningManager(config)` | Medium — requires `agentId` in config (S13) |

**NativeAccelerator** (S9 verified): Zero-arg constructor. `initialize()` fires 11 concurrent dynamic imports via `Promise.allSettled` — all failures silently swallowed. Falls back to pure JS (`SimdFallbacks.js`). Has a singleton pattern: `getAccelerator()` returns shared instance, `resetAccelerator()` for tests. 10 boolean capability probes (simdAvailable, wasmVerifyAvailable, etc.). Public API: 30+ vector math operations, quantization, WASM store, verification, ML ops, EWC.

**SelfLearningRvfBackend** (S8 verified): Private constructor at line 107. `static async create(config: SelfLearningConfig)` factory:
1. Creates `RvfBackend` with config (file I/O — `storagePath` defaults to `'agentdb.rvf'`, use `':memory:'` for in-memory)
2. Calls `await backend.initialize()`
3. Calls `new SelfLearningRvfBackend(backend, config)` via private ctor
4. If `learning !== false`, calls `await instance.initComponents()` — 7 children each in try-catch:

| # | Sub-component | Import | Constructor | Required config |
|---|---------------|--------|-------------|----------------|
| 1 | NativeAccelerator | `./NativeAccelerator.js` | `new N()` + `initialize()` | none |
| 2 | SonaLearningBackend | `./SonaLearningBackend.js` | `S.create({hiddenDim})` | `learningDimension` or dim |
| 3 | SemanticQueryRouter | `./SemanticQueryRouter.js` | `R.create({dimension, persistencePath})` | dim + optional path |
| 4 | TemporalCompressor | `./AdaptiveIndexTuner.js` | `T.create()` | none |
| 5 | ContrastiveTrainer | `./ContrastiveTrainer.js` | `C.create({dimension})` | dim |
| 6 | FederatedSessionManager | `./FederatedSessionManager.js` | `F.create({dimension})` | dim; gated on `config.federated` |
| 7 | AgentDBSolver | `./RvfSolver.js` | `A.create()` | none; gated on `A.isAvailable()` |

IndexHealthMonitor is created as field initializer (line 78), NOT in initComponents. All 7 children are optional — backend degrades to plain RVF.

**FederatedLearningManager** (S13 verified): Constructor `(config: FederatedConfig)` — requires `agentId: string`. Optional: `coordinatorEndpoint`, `minQuality` (0.7), `aggregationInterval` (60000ms), `maxAgents` (100). No database, no network deps. Creates internal `FederatedLearningCoordinator`. With no agents registered, `aggregateAll()` is a no-op.

**IndexHealthMonitor** (S13 verified): Zero-arg constructor confirmed. Tracks search/insert latency arrays (capped at 1000). Already created internally by SelfLearningRvfBackend — **separate registry entry is redundant**. Removed from Phase 2.

**createController() cases**:
```typescript
case 'nativeAccelerator': {
  // Use singleton pattern (S9 verified)
  const { getAccelerator } = await import('@sparkleideas/agentdb');
  if (!getAccelerator) return null;
  return await getAccelerator();
}
case 'selfLearningRvfBackend': {
  if (!this.agentdb) return null;
  const { SelfLearningRvfBackend } = await import('@sparkleideas/agentdb');
  if (!SelfLearningRvfBackend) return null;
  return await SelfLearningRvfBackend.create({
    dimension: this.config.dimension || 384,
    storagePath: ':memory:',  // or file path for persistence
    learning: true,
  });
}
case 'federatedLearningManager': {
  const { FederatedLearningManager } = await import('@sparkleideas/agentdb');
  if (!FederatedLearningManager) return null;
  return new FederatedLearningManager({ agentId: 'cli-default' });
}
```

#### Phase 6: Security Infrastructure (~2h, after Phase 0 fork patch)

| Controller | Level | Constructor | Notes |
|------------|:-----:|------------|-------|
| resourceTracker | 0 | `new ResourceTracker()` | Pure JS, no args; also `globalResourceTracker` singleton (S7) |
| rateLimiter | 0 | `new RateLimiter(maxTokens, refillRate)` | Pure JS, both args required; also pre-built `rateLimiters` map (S7) |
| circuitBreaker | 0 | `new CircuitBreaker(5, 60000)` | Pure JS, both args have defaults (S7) |
| telemetryManager | 0 | `TelemetryManager.getInstance()` | Private ctor, singleton; dynamic `@opentelemetry/*` import, graceful no-op if missing (S7) |

**CircuitBreaker pattern** (S7 verified): `execute<T>(operation: () => Promise<T>, operationName?)` wraps individual calls. 5 failures → open, 60s reset → half-open. Do NOT decorate `registry.get()`.

**RateLimiter** (S7 verified): Token bucket with `tryConsume(tokens?)` and `consume(tokens?, operation?)`. Module exports 4 pre-built instances: `rateLimiters.insert` (100/100), `rateLimiters.search` (1000/1000), `rateLimiters.delete` (50/50), `rateLimiters.batch` (10/10).

**TelemetryManager** (S7 verified): Dynamic `await import('@opentelemetry/*')` in `initialize()` — gracefully degrades to no-op. Metrics: query latency histogram, cache hits/misses counters, error counter, throughput counter. Default enabled only when `process.env.NODE_ENV === 'production'`.

**AuditLogger** (S12 verified): Constructor `(config?: Partial<AuditLoggerConfig>)` — all optional. Filesystem-based (`fs.createWriteStream`), no database. Defaults: `logDirectory: './logs/audit'`, `maxFileSize: 10MB`, `maxFiles: 10`. Has `close()` for shutdown. Methods: `logEvent()`, `logAuthEvent()`, `logRateLimitEvent()`, `queryLogs(filter)`.

**createController() cases** (after Phase 0 fork patch lands):
```typescript
case 'resourceTracker': {
  const { ResourceTracker } = await import('@sparkleideas/agentdb');
  if (!ResourceTracker) return null;
  return new ResourceTracker();
}
case 'rateLimiter': {
  const { RateLimiter } = await import('@sparkleideas/agentdb');
  if (!RateLimiter) return null;
  return new RateLimiter(100, 1);  // 100 tokens, 1/sec refill
}
case 'circuitBreaker': {
  const { CircuitBreaker } = await import('@sparkleideas/agentdb');
  if (!CircuitBreaker) return null;
  return new CircuitBreaker(5, 60000);
}
case 'telemetryManager': {
  const { TelemetryManager } = await import('@sparkleideas/agentdb');
  if (!TelemetryManager) return null;
  return TelemetryManager.getInstance();
}
case 'auditLogger': {
  const { AuditLogger } = await import('@sparkleideas/agentdb');
  if (!AuditLogger) return null;
  return new AuditLogger();
}
```

### Controllers NOT Added to Registry (5 — by design)

| Controller | Reason | How to use |
|------------|--------|-----------|
| indexHealthMonitor | Created internally by SelfLearningRvfBackend (field init line 78) | Access via parent's `getStats()` |
| metadataFilter | Static-only class — `apply()`, `toSQL()`, `validate()` all static | Call `MetadataFilter.apply(items, filters)` directly in search path |
| contextSynthesizer | Static-only — existing factory already returns class ref | Already correct in registry |
| mmrDiversityRanker | Static-only — fix existing factory to return class ref (Phase 1) | Already in registry, just fix the `new` call |
| hybridSearch | No implementation exists upstream — placeholder slot | Keep as placeholder |

### guardedVectorBackend — Deferred (needs registry enhancement)

The sequencing bug (`this.get()` for deps not yet initialized at Level 5) cannot be fixed with a simple patch. It requires either:
1. An `ensure(name)` async method that waits for a controller to init, or
2. Moving guardedVectorBackend to a later level with guaranteed dependency ordering

Deferred to a follow-up ADR. Keep disabled.

### Composition Rules (ADR-0041, confirmed by P3)

Do NOT add separate registry entries for composite children:

| Parent | Children (created internally) |
|--------|------------------------------|
| SelfLearningRvfBackend (A6) | NativeAccelerator*, SonaLearningBackend, SemanticQueryRouter, TemporalCompressor, ContrastiveTrainer, FederatedSessionManager, AgentDBSolver |
| QuantizedVectorStore (B9) | ScalarQuantization (B7) or ProductQuantizer (B8) |

*NativeAccelerator is also wired separately as a shared singleton (Phase 5). The instance created by A6 internally is distinct from the registry singleton — this is intentional per ADR-0041 (B4 exception).

### isControllerEnabled() Additions

```typescript
// Pure JS, zero cost — enabled by default
case 'solverBandit':
case 'attentionMetrics':
  return true;

// Attention + optimization — enabled if agentdb available
case 'selfAttention':
case 'crossAttention':
case 'multiHeadAttention':
case 'attentionService':
case 'nativeAccelerator':
case 'enhancedEmbeddingService':
case 'auditLogger':
case 'queryOptimizer':
  return this.agentdb !== null;

// Advanced controllers — enabled if agentdb available (patch repo: ship what works)
case 'selfLearningRvfBackend':
case 'quantizedVectorStore':
  return this.agentdb !== null;

// Federated learning — only useful in multi-agent swarms
case 'federatedLearningManager':
  return false;

// Security (Phase 6, after upstream PR)
case 'resourceTracker':
case 'rateLimiter':
case 'circuitBreaker':
case 'telemetryManager':
  return true;
```

### Proposed INIT_LEVELS (after all phases)

```typescript
export const INIT_LEVELS: InitLevel[] = [
  { level: 0, controllers: [
    'resourceTracker', 'rateLimiter', 'circuitBreaker', 'telemetryManager',  // Phase 6
  ] },
  { level: 1, controllers: [
    'reasoningBank', 'hierarchicalMemory', 'learningBridge', 'hybridSearch', 'tieredCache',
    'solverBandit', 'attentionMetrics',  // Phase 2
  ] },
  { level: 2, controllers: [
    'memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard', 'gnnService',
    'selfAttention', 'crossAttention', 'multiHeadAttention', 'attentionService',  // Phase 3
    'nativeAccelerator', 'queryOptimizer',  // Phase 4-5
  ] },
  { level: 3, controllers: [
    'skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations',
    'memoryConsolidation',
    'enhancedEmbeddingService', 'auditLogger',  // Phase 4
  ] },
  { level: 4, controllers: [
    'causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter',
    'selfLearningRvfBackend', 'federatedLearningManager',  // Phase 5
  ] },
  { level: 5, controllers: [
    'graphTransformer', 'sonaTrajectory', 'contextSynthesizer', 'rvfOptimizer',
    'mmrDiversityRanker', 'guardedVectorBackend',
    'quantizedVectorStore',  // Phase 4
  ] },
  { level: 6, controllers: ['federatedSession', 'graphAdapter'] },
];
```

**Total**: 43 registry slots + 8 via composite = 51 controllers tracked.

### Implementation Summary

| What | Where | Count |
|------|-------|------:|
| Fix broken factories | ruflo fork (controller-registry.ts) | 8 |
| Add new controller cases | ruflo fork (controller-registry.ts) | 15 |
| Patch barrel exports | agentic-flow fork (index.ts) | 2 patches |
| Update bridge config | ruflo fork (memory-bridge.ts) | 1 |
| Skip (static/redundant/placeholder) | — | 5 |
| Defer (needs design change) | guardedVectorBackend | 1 |
| **Total implementable** | **2 forks** | **28** |

## Consequences

### Positive

- Closes the gap between ADR documentation and actual source
- 10 existing bugs documented and fixable (2 critical: learningSystem/nightlyLearner missing embedder)
- Self-learning loop complete: SelfLearningRvfBackend auto-tunes HNSW, SONA adapts routing, ContrastiveTrainer improves embeddings
- Attention-weighted search replaces pure cosine distance ranking
- Security guardrails (CircuitBreaker, RateLimiter, ResourceTracker) prevent cascading failures
- All constructor signatures verified from source by 15 agents — no ADR assumptions
- All phases use dynamic imports with try-catch — graceful degradation maintained

### Negative

- 25h total effort across 7 phases (Phase 0-6)
- Phase 5 (self-learning) carries highest risk — WASM/native I/O in constructor chain
- guardedVectorBackend sequencing bug deferred (needs registry enhancement)
- QuantizedVectorStore barrel export swapped in Phase 0 fork patch — may break consumers expecting the `optimizations/Quantization.ts` API

### Risks

- **QuantizedVectorStore dual-class** (S10): Barrel-exported version defeats purpose of quantization. Must either fix upstream barrel or use deep import path
- Heavy deps (@xenova/transformers, @ruvector/attention) must stay behind dynamic imports — static imports would break the build pipeline (P7 finding)
- SelfLearningRvfBackend.create() does file I/O — cold start adds latency. Use `storagePath: ':memory:'` for CLI
- 3 static-only classes (MetadataFilter, ContextSynthesizer, MMRDiversityRanker) don't fit the registry lifecycle pattern
- NativeAccelerator singleton (`getAccelerator()`) creates shared state — `resetAccelerator()` needed for test isolation

## Testing

### Per-Phase Test Strategy

| Phase | Unit test | Acceptance check |
|-------|-----------|-----------------|
| 1 | Verify 5 previously-null controllers now return instances | `agentdb_health` reports 5 more enabled |
| 2 | Factory returns instance, no I/O | Controller count floor rises |
| 3 | Attention compute returns scores for mock embeddings | `agentdb_attention_compute` responds |
| 4 | QueryOptimizer caches repeated queries; QuantizedVectorStore inserts/searches | Search path includes metadata filtering |
| 5 | SelfLearningRvfBackend.create() succeeds; 7 children counted via getStats() | `agentdb_health` reports composite children |
| 6 | CircuitBreaker opens after 5 failures; RateLimiter rejects over limit | Security controllers in health output |

### Acceptance floor update

Current floor: 5 controllers (lib/acceptance-controller-checks.sh:22). After all phases, raise to 20 (conservative — allows for some null returns on CI where native bindings may be absent).

## Appendix: Swarm Agent Roster

| Agent | Track | Source files read | Key finding |
|-------|-------|-------------------|-------------|
| S1 | L0-L1 controllers | controller-registry.ts:620-670, ReasoningBank.ts, HierarchicalMemory.ts, LearningBridge, TieredCacheManager | reasoningBank/hierarchicalMemory never pass vectorBackend |
| S2 | L2 controllers | controller-registry.ts:636-878, MutationGuard.ts, GNNService.ts | mutationGuard missing initialize() |
| S3 | L3-L4 controllers | ExplainableRecall.ts, LearningSystem.ts, NightlyLearner.ts, AttestationLog.ts, SemanticRouter.ts, MemoryConsolidation.ts | learningSystem/nightlyLearner missing embedder; attestationLog no switch case |
| S4 | L5-L6 controllers | CausalMemoryGraph.ts, SonaTrajectoryService.ts, ContextSynthesizer.ts, RVFOptimizer.ts, MMRDiversityRanker.ts, GuardedVectorBackend.ts | mmrDiversityRanker static-only; guardedVectorBackend sequencing bug |
| S5 | Attention A1-A3 | SelfAttentionController.ts, CrossAttentionController.ts, MultiHeadAttentionController.ts | All share `(VectorBackend\|null, config)` signature; MultiHead allocs ~2.4MB lazily |
| S6 | AttentionService | AttentionService.ts (250 lines) | Requires numHeads/headDim/embedDim; independent of A1-A3; NAPI→WASM→JS fallback |
| S7 | Security/observability | limits.ts, telemetry.ts, audit-logger.service.ts | All 4 NOT in barrel; TelemetryManager is singleton; confirmed barrel gap |
| S8 | SelfLearningRvfBackend | SelfLearningRvfBackend.ts (400 lines), RvfBackend.ts | Private ctor confirmed; create() factory; 7 children in initComponents; `:memory:` supported |
| S9 | NativeAccelerator + SolverBandit | NativeAccelerator.ts (200 lines), SolverBandit.ts (120 lines) | 11 concurrent WASM loaders; singleton getAccelerator(); SolverBandit is pure in-memory Map |
| S10 | Quantization | Quantization.ts, vector-quantization.ts | **TWO classes named QuantizedVectorStore** — barrel exports the wrong one |
| S11 | QueryOptimizer + MetadataFilter | QueryOptimizer.ts, MetadataFilter.ts | QueryOptimizer needs db handle; MetadataFilter confirmed static-only |
| S12 | EnhancedEmbedding + AuditLogger | enhanced-embeddings.ts, audit-logger.service.ts | Barrel exports services/ version (not controllers/); AuditLogger is filesystem-only |
| S13 | FederatedLearning + IndexHealth | federated-learning.ts, AdaptiveIndexTuner.ts | FederatedLearningManager needs agentId; IndexHealthMonitor redundant with SelfLearningRvfBackend |
| S14 | Barrel export audit | index.ts (full), controllers/index.ts (full) | 34/38 exported; 4 missing from barrel confirmed |
| S15 | Bridge→enabled→factory chain | memory-bridge.ts:63-118, controller-registry.ts:513-572, 619-923 | Full 28-controller decision chain mapped; learningBridge only bridge-disabled controller |

## Implementation Status (2026-04-05)

Implemented by 15-agent swarm across 5 parallel tracks.

| Phase | Status | Details |
|-------|--------|---------|
| 0 | **Done** | Barrel exports patched (4 security classes + QuantizedVectorStore swap) |
| 1 | **Done** | 7 bug fixes applied, bridge config updated with 6 new enables |
| 2 | **Done** | solverBandit + attentionMetrics wired, enabled by default |
| 3 | **Done** | 4 attention controllers wired, enabled if agentdb |
| 4 | **Done** | queryOptimizer + enhancedEmbeddingService + quantizedVectorStore wired |
| 5 | **Done** | nativeAccelerator + selfLearningRvfBackend + federatedLearningManager wired |
| 6 | **Done** | 4 security controllers + auditLogger wired at Level 0 |

### Final Controller Counts

| Category | Count |
|----------|------:|
| Working (enabled by default or gated on agentdb) | 40 |
| Opt-in disabled (federatedLearningManager) | 1 |
| Placeholders (no upstream implementation) | 3 |
| Deferred bug (guardedVectorBackend sequencing) | 1 |
| **Total registry slots** | **45** |

### Post-Implementation Decision: Enable selfLearningRvfBackend and quantizedVectorStore

A 9-member hive-mind panel (Queen + 8 experts) initially voted 8-0 to keep all three Phase 5 controllers opt-in. On review, the panel reconsidered: this is a **patch repo** whose purpose is to ship working upstream code. selfLearningRvfBackend (the headline self-learning feature) and quantizedVectorStore (30x memory compression, Bug #9 already fixed) were changed from `return false` to `return this.agentdb !== null`. federatedLearningManager remains opt-in (no-op without agents, 60s timer leak).

### Files Modified

| Fork | File | Changes |
|------|------|---------|
| agentic-flow | `packages/agentdb/src/index.ts` | +4 security barrel exports, QuantizedVectorStore barrel swap |
| ruflo | `v3/@claude-flow/memory/src/controller-registry.ts` | 7 bug fixes, 17 new cases, types, INIT_LEVELS, isEnabled |
| ruflo | `v3/@claude-flow/cli/src/memory/memory-bridge.ts` | +6 controller enables in bridge config |
| ruflo-patch | `tests/unit/controller-adr0061.test.mjs` | 32 unit tests (8 suites) |
| ruflo-patch | `lib/acceptance-controller-checks.sh` | Floor 5→20, ADR-0061 barrel check |
| ruflo-patch | `scripts/test-acceptance.sh` | Wired new check into controller group |

### Tests

- 32/32 unit tests pass (`node --test tests/unit/controller-adr0061.test.mjs`)
- Acceptance floor raised from 5 to 20
- New acceptance check: `check_adr0061_controller_types` verifies security barrel exports

## Related

- **ADR-0033**: Original controller activation (27 of 28)
- **ADR-0039**: Upstream controller integration roadmap (superseded)
- **ADR-0040**: ADR-0033 wiring remediation
- **ADR-0041**: Composition-aware controller architecture (composition rules)
- **ADR-0043-0047**: Individual controller integration ADRs (design intent, partially implemented)
- **ADR-0048**: Lazy controller initialization (deferred init, ONNX cache, measured performance)
- **ADR-0060**: Fork patch hygiene (pipeline rules for fork changes)

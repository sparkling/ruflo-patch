# ADR-0076: Architecture Consolidation Plan

- **Status**: Proposed
- **Date**: 2026-04-06
- **Depends on**: ADR-0075 (assessment), ADR-0073 (storage upgrade), ADR-0069 F1 (controller delegation)
- **Analysis**: 10-agent hive council (queen + 8 specialists + devil's advocate)

## Decision

Implement the ADR-0075 ideal end state in two tracks: a **minimum viable consolidation**
(Track A, 3-5 days) that fixes all active correctness bugs, and a **structural consolidation**
(Track B, 4-6 weeks) that eliminates architectural duplication. Track A ships first. Track B
ships only if the team decides the maintenance benefit justifies the upstream divergence cost.

## Track A — Minimum Viable Consolidation (3-5 days)

Four targeted fixes that resolve every active correctness bug without structural changes.
No files deleted, no upstream divergence risk.

### A1. Fix cosineSim truncation — throw on dimension mismatch

**Problem**: `cosineSim()` in memory-initializer.ts:2468 and memory-bridge.ts:3589 silently
truncates when dimensions differ. intelligence.ts:595 zero-pads. Both produce wrong scores.

**Fix**: Replace all three local `cosineSim` functions with a single canonical implementation
that throws `EmbeddingDimensionError` on `a.length !== b.length`. Place it in
`@claude-flow/embeddings/src/pipeline.ts` and import from there.

**Files**: 3 modified (memory-initializer.ts, memory-bridge.ts, intelligence.ts)
**Scope**: S (30 lines changed)
**Risk**: Low — the throw surfaces latent data integrity bugs that were silently ignored

### A2. Fix circuitBreaker null factory

**Problem**: Level 0 security controller, always-enabled, factory returns null. Security
decorator never runs.

**Fix**: Add inline circuit breaker state machine (closed/open/half-open) as fallback when
`agentdb.CircuitBreaker` import fails. Never return null from a Level 0 controller.

**Files**: 1 modified (controller-registry.ts factory case)
**Scope**: S (25 lines added)
**Risk**: Low — adds functionality where none existed

### A3. Startup dimension validation

**Problem**: If stored vectors have dimension N and the configured model produces dimension M,
no error is raised. Searches silently return meaningless scores.

**Fix**: At `ControllerRegistry.initialize()`, read the stored dimension from the RVF header
or first SQLite row. Compare to `getEmbeddingConfig().dimension`. If they differ, throw
`EmbeddingDimensionError` with an actionable message.

**Files**: 2 modified (controller-registry.ts, rvf-backend.ts)
**Scope**: S (20 lines added)
**Risk**: Low — fail-loud is better than fail-silent

### A4. Add dual-instance guard

**Problem**: ControllerRegistry and AgentDBService construct 13 overlapping controllers with
separate in-memory state. Cache divergence produces inconsistent results.

**Fix**: Module-level `let _initialized = false` in each controller module. Both registries
check before constructing. Second construction attempt logs a warning and returns the existing
instance rather than creating a duplicate.

**Files**: 6 modified (reflexion.ts, skills.ts, reasoning.ts, causal.ts, learning.ts, explainable.ts)
**Scope**: M (10 lines per file)
**Risk**: Low — prevents double-construction without changing any public API

## Track B — Structural Consolidation (4-6 weeks)

Five phases that progressively simplify the architecture toward ADR-0075's ideal end state.
Each phase ships independently. Later phases can be deferred indefinitely.

### Phase 1: Config Unification (1 week, ruflo fork)

**Goal**: One `resolveConfig()` function, called once, producing a frozen `SystemConfig`.

**What**:
- Add `EmbeddingConfigSchema` + `HNSWConfigSchema` to `@claude-flow/shared` Zod schemas
- Create `resolveConfig()` in shared: reads config.json + embeddings.json + env vars, merges,
  validates, freezes. 7-layer priority: defaults → embeddings.json → config.json → env vars →
  MODEL_REGISTRY → deriveHNSWParams → freeze
- Create `getConfig()` / `setResolvedConfig()` singleton in shared
- Call once from CLI startup and MCP server startup
- Replace 5 independent resolution chains with `getConfig()` calls

**Files to create**: 3 (resolve.ts, singleton.ts, hnsw-params.ts in shared/config/)
**Files to modify**: 8 (database-provider.ts, embedding-config.ts, memory-initializer.ts,
4x embedding-constants.ts, shared/index.ts)
**Scope**: M
**Upstream risk**: Low — touches only internal resolution logic, not file structure

### Phase 2: Storage Simplification (3 days, ruflo fork)

**Goal**: One `IStorage` interface, dead backends deleted.

**What**:
- Add `IStorage` interface (10 methods, trimmed from IMemoryBackend's 17)
- Update RvfBackend and SQLiteBackend to `implements IStorage`
- Delete HybridBackend (790 lines dead code) and AgentDBBackend (thin adapter)
- Rewrite database-provider.ts: `auto` → RvfBackend, `better-sqlite3` → opt-in
- Deprecate `IMemoryBackend` as alias extending `IStorage`

**Files to delete**: 2 (hybrid-backend.ts, agentdb-backend.ts)
**Files to modify**: 4 (types.ts, rvf-backend.ts, sqlite-backend.ts, database-provider.ts)
**Scope**: M
**Upstream risk**: **HIGH for ruflo fork** — ruflo upstream is very active with 160+ branches.
Deleting HybridBackend causes merge conflicts on next sync. Consider leaving as dead code.

### Phase 3: Embedding Pipeline (1 week, ruflo fork)

**Goal**: One `EmbeddingPipeline` instance, dimension validated at startup.

**What**:
- Create `EmbeddingPipeline` class wrapping one `IEmbeddingService`
- Enforce dimension validation at init (throw on mismatch with stored vectors)
- Include canonical `cosineSimilarity()` that throws on dimension mismatch
- Delete RvfEmbeddingService, AgenticFlowEmbeddingService, NeuralEmbeddingService
- Delete `generateEmbedding()` / `loadEmbeddingModel()` from memory-initializer.ts

**Files to create**: 2 (pipeline.ts, pipeline-factory.ts in embeddings/)
**Files to delete**: 1 (rvf-embedding-service.ts)
**Files to modify**: 4 (memory-initializer.ts, memory-bridge.ts, intelligence.ts, embedding-service.ts)
**Scope**: L
**Upstream risk**: Medium — touches memory-initializer.ts which is in active ruflo upstream

### Phase 4: Controller Registry Split + Shim (2 weeks, both forks)

**Goal**: ControllerRegistry under 500 lines. AgentDBService replaced by thin shim.

**What**:
- Split controller-registry.ts into 5 files (types, levels, factory, health, main)
- Fix circuitBreaker, remove federatedLearningManager/federatedSession dead code
- Move hybridSearch from Level 1 to Level 3 (dependency ordering bug)
- Create AgentDBService shim that delegates to ControllerRegistry
- Swap: rename original → Legacy, export shim as AgentDBService
- Delete Legacy + InMemoryStore after validation

**Files to create**: 5 (registry split) + 1 (shim)
**Files to modify**: 2 (controller-registry.ts, agentdb-service.ts)
**Scope**: XL
**Upstream risk**: **HIGH for ruflo fork** (controller-registry.ts is the highest merge conflict
file). **LOW for agentic-flow fork** (frozen since 2026-02-27 — safe deletion window open now).

**Shipping order**: ruflo fork first (registry split), then agentic-flow (shim swap). Requires
`publish-levels.json` update: agentic-flow moves from Level 1 to Level 3.

### Phase 5: Data Flow Unification (2 weeks, both forks)

**Goal**: Single path from MCP tool → ControllerRegistry → IStorage. No bridge. No fallbacks.

**What**:
- Delete memory-bridge.ts (3,599 lines)
- Delete sql.js fallback paths from memory-initializer.ts (~1,800 lines)
- Rewrite memory-tools.ts: `registry.get('storage').store()` instead of bridge dispatch
- Rewrite agentdb-tools.ts: `registry.get(name).method()` instead of bridge dispatch
- Delete VectorDb/@ruvector/core HNSW (fourth implementation)
- Extract legacy JSON migration to standalone script

**Files to delete**: 1 (memory-bridge.ts, 3,599 lines)
**Lines deleted from memory-initializer.ts**: ~1,800
**Files to modify**: 5+ (memory-tools.ts, agentdb-tools.ts, memory-initializer.ts, etc.)
**Scope**: XL
**Upstream risk**: **VERY HIGH** — memory-bridge.ts and memory-initializer.ts are in the active
ruflo upstream with documented high merge conflict risk.

## Dependency DAG

```
Track A (independent, ships first)
  A1 cosineSim fix ─────────────┐
  A2 circuitBreaker fix ─────────┤
  A3 dimension validation ───────┤ (no dependencies between A1-A4)
  A4 dual-instance guard ────────┘

Track B
  Phase 1: Config ────────────→ Phase 3: Embedding Pipeline
                                           │
  Phase 2: Storage ──────────────────────→ Phase 5: Data Flow
                                           │
  Phase 4: Controller Split ─────────────→ Phase 5: Data Flow
```

Phase 5 requires Phases 2, 3, and 4. Phases 1-4 are independent of each other.

## The Devil's Advocate Challenge

The 10th council member (devil's advocate) raised these challenges:

1. **82 AgentDBService call sites** across 14 files — the shim approach (Phase 4) mitigates
   this by preserving the `getInstance()` API surface. No MCP tool rewrite needed.

2. **Upstream sync cost is permanent** — ruflo is very active (160+ branches). Deleting
   HybridBackend or rewriting memory-bridge.ts causes merge conflicts on every sync. The
   plan mitigates this by making Phase 2 (storage) and Phase 5 (data flow) optional — the
   correctness bugs are all fixed in Track A.

3. **6-10 week realistic estimate** for full consolidation — the plan acknowledges this.
   Track B is phased so each piece ships independently. Phases 1-3 deliver value without
   touching the highest-risk files.

4. **Minimum viable alternative delivers 80% of the value** — Track A (3-5 days) fixes all
   correctness bugs. Track B is architectural improvement, not bug fixes.

5. **No user has complained** — true. Track A fixes latent bugs that will bite when usage
   scales. Track B is optional cleanup.

## Upstream Risk Summary (from upstream analyst)

| Fork | Activity | Safe to modify structurally? |
|------|----------|------------------------------|
| ruflo | Very active (160+ branches, daily commits) | **No** — leave dead code, make surgical fixes only |
| agentic-flow | Frozen since 2026-02-27 | **Yes** — deletion window open now |
| ruvector | Active (Rust, not TS) | N/A for this consolidation |
| ruv-FANN | Frozen since 2026-02-09 | N/A |

## Recommendation

**Ship Track A immediately.** It fixes every active correctness bug in 3-5 days with zero
upstream divergence risk.

**Start Track B Phase 1 (config) and Phase 4 (controller split + shim).** Config unification
is low-risk (internal resolution logic). The AgentDBService shim exploits the agentic-flow
freeze window — do it while the repo is dormant.

**Defer Track B Phases 2, 3, 5** until upstream ruflo activity stabilizes or the project
decides to hard-fork. The dead code (HybridBackend, sql.js fallbacks, VectorDb HNSW) costs
build time but doesn't cost correctness. The upstream merge conflicts from deleting it cost
more than the dead code itself.

## Net Impact (from Queen's analysis)

Full consolidation removes **~9,555 lines** of production code:

| Phase | Lines deleted | Lines new | Net |
|-------|-------------|-----------|-----|
| 0 (dead code) | ~1,000 | 0 | -1,000 |
| 1 (config) | 0 | ~270 | +270 |
| 2 (embedding) | ~200 | ~380 | +180 |
| 3 (storage) | ~1,140 | ~590 | -550 |
| 4 (controllers) | ~2,048 | ~120 | -1,928 |
| 5 (data flow) | ~6,527 | 0 | -6,527 |

## Test Strategy (from test strategist)

### Tests that break per phase
- Phase S (storage): 8 test files need updating (storage-audit, config-bypass x6, adr0062)
- Phase C (controllers): 6 test files (agentdb-service-f1 x2, controller-chaos, controller-properties, activation, synthesize)
- Phase E (embeddings): 5 test files (embeddings-compliance, attention-f3, config-dead-keys, getcontroller-coverage, ruvector-scope)
- Phase F (config): 4 test files (config-centralization, config-unification, config-bypass-full, config-forwarding)

### New tests required: 11 files
- `istorage-contract.test.mjs` — IStorage interface + factory
- `istorage-migration.test.mjs` — RVF backward read compatibility
- `storage-dead-backends.test.mjs` — absence of deleted code
- `single-registry-contract.test.mjs` — sole source of truth
- `registry-singleton-proof.test.mjs` — constructor count = 1
- `embedding-pipeline-contract.test.mjs` — singleton + dimension guard
- `dimension-startup-validation.test.mjs` — fail-loud on mismatch
- `resolve-config-contract.test.mjs` — frozen immutable config
- `perf-baseline-adr0075.test.mjs` — latency capture + regression
- `dead-code-absence-adr0075.test.mjs` — source grep for deleted symbols
- `acceptance-adr0075-checks.sh` — runtime acceptance checks

### Performance regression budget
| Operation | Budget | Trigger |
|-----------|--------|---------|
| `store()` p99 | <5ms at 1000 entries | >10ms |
| `search()` k=10, p99 | <20ms at 1000 entries | >2x baseline |
| `embed()` p99 | <50ms | >100ms |

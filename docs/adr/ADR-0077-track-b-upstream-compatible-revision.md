# ADR-0077: Track B Revised -- Upstream-Compatible Architecture Consolidation

- **Status**: Implemented (Phases 1-5)
- **Date**: 2026-04-06
- **Implemented**: 2026-04-11
- **Depends on**: ADR-0075 (assessment), ADR-0076 (original plan), ADR-0073 (storage upgrade)
- **Supersedes**: ADR-0076 Track B (Phases 1-5)
- **Continued by**: ADR-0078 (bridge elimination from agentdb tools)

## Decision

Revise all five Track B phases from ADR-0076 to achieve the same goals -- single config
resolution, single embedding pipeline, cleaner controller lifecycle, single data flow,
reduced dead code exposure -- WITHOUT diverging from upstream's file structure.

The non-negotiable constraint: we track 4 upstream repos and must continue to merge
upstream changes cleanly. We also want the option to contribute patches back upstream.

This means:
- We CANNOT delete files that upstream maintains
- We CANNOT restructure files that upstream actively develops
- We CAN add new files alongside existing ones
- We CAN fix bugs in existing files (targeted patches, not rewrites)
- We CAN add configuration, validation, and guards that are additive
- We CAN contribute bug fixes upstream as PRs

## Strategy: Intercept, Don't Restructure

Instead of deleting or splitting upstream files, we place **thin interception layers** in
new files that upstream does not own. The upstream files remain untouched (or receive only
surgical bug fixes that are PR-able). All consolidation logic lives in files we own.

```
Upstream file (untouched)     Our interception file (new, we own)
--------------------------    ------------------------------------
controller-registry.ts   -->  controller-intercept.ts (singleton guard, config injection)
memory-bridge.ts         -->  (bypassed at call sites via our routing layer)
memory-initializer.ts    -->  (bypassed at call sites via our routing layer)
database-provider.ts     -->  (2-line bug fix: dimension param, PR-able)
agentdb-service.ts       -->  agentdb-shim.ts (delegates to ControllerRegistry)
hybrid-backend.ts        -->  (left in tree, never instantiated -- already dead)
embedding-constants.ts   -->  (4 copies fixed to read from singleton -- PR-able)
```

---

## Revised Phase 1: Config Unification (1 week)

### Goal
One `resolveConfig()` function, called once, producing a frozen `SystemConfig`.

### Original ADR-0076 approach
Modify 8 existing files to replace 5 independent resolution chains.

### Upstream compatibility assessment
**Compatible as-is.** The config resolution code is internal wiring, not public API.
The new files are purely additive. The existing files receive only import changes
(swapping inline resolution for `getConfig()` calls). These are clean, small patches.

### Revised approach

**New files (we own, upstream does not have):**
- `@claude-flow/shared/src/core/config/resolve.ts` -- canonical `resolveConfig()` with
  7-layer priority: defaults -> embeddings.json -> config.json -> env vars ->
  MODEL_REGISTRY -> deriveHNSWParams -> freeze
- `@claude-flow/shared/src/core/config/singleton.ts` -- `getConfig()` / `setResolvedConfig()`
- `@claude-flow/shared/src/core/config/hnsw-params.ts` -- HNSW derivation (extract from
  existing scattered implementations)

**Existing files (surgical patches, all PR-able):**
- `database-provider.ts` -- replace inline embeddings.json walk (lines 209-229) with
  `getConfig().embedding.dimension` call (net -18 lines)
- 4x `embedding-constants.ts` (guidance, hooks, neural, swarm) -- replace inline
  agentdb import with `getConfig().embedding.dimension` call (net -4 lines each)
- `controller-registry.ts` -- replace `this.embeddingDimension || this.config.dimension || 768`
  with `getConfig().embedding.dimension` at one call site (1-line change)
- `shared/index.ts` -- add re-export of config singleton (1 line)

**Upstream PR opportunity:**
The 4 embedding-constants.ts files are copy-paste-identical. A PR that consolidates them
into a single shared constant (reading from a well-known config path) is a reasonable
upstream improvement. The database-provider.ts inline walk is also a candidate -- it
duplicates logic that the config loader already handles.

**Files deleted:** 0
**Files created:** 3 (all in shared/config/, which we own)
**Upstream merge conflict risk:** None -- changes to existing files are 1-5 lines each

---

## Revised Phase 2: Storage Simplification (3 days)

### Goal
One `IStorage` interface, dead backends bypassed safely.

### Original ADR-0076 approach
Delete HybridBackend (790 lines) and AgentDBBackend. Rewrite database-provider.ts.
Rated HIGH upstream risk.

### Upstream compatibility assessment
**NOT compatible.** Deleting hybrid-backend.ts and agentdb-backend.ts causes merge
conflicts on every upstream sync. ruflo upstream is very active (160+ branches).

### Revised approach: Leave Dead Code, Add Interface

**New files (we own):**
- `@claude-flow/memory/src/istorage.ts` -- the trimmed 10-method `IStorage` interface
  (subset of `IMemoryBackend`'s 17 methods, covering what controllers actually call)
- `@claude-flow/memory/src/istorage-adapter.ts` -- thin adapter wrapping `RvfBackend`
  to implement `IStorage`, validating dimension at construction

**Existing files (zero changes):**
- `hybrid-backend.ts` -- left untouched. Already dead (testRvf() returns true
  unconditionally). Build time cost is ~0 (TS compiles it but it is never imported at
  runtime). No merge conflicts.
- `agentdb-backend.ts` -- left untouched. Same reasoning.
- `database-provider.ts` -- already patched in Phase 1 for dimension. No further changes.

**What we gain:**
- `IStorage` becomes the contract that controllers code against (Phase 4 uses it)
- New code imports `IStorage`, not `IMemoryBackend`
- Dead backends continue to compile but are never instantiated
- Zero merge conflict risk

**Upstream PR opportunity:**
The `IStorage` interface itself could be contributed as a `types.ts` addition. Upstream
benefits from a narrower, documented contract. This is strictly additive.

**Files deleted:** 0
**Files created:** 2
**Upstream merge conflict risk:** None

---

## Revised Phase 3: Embedding Pipeline (1 week)

### Goal
One `EmbeddingPipeline` instance, dimension validated at startup.

### Original ADR-0076 approach
Delete RvfEmbeddingService. Delete generateEmbedding()/loadEmbeddingModel() from
memory-initializer.ts. Rated MEDIUM upstream risk because memory-initializer.ts is
in active upstream.

### Upstream compatibility assessment
**NOT compatible for deletions.** We cannot remove functions from memory-initializer.ts
(2,929 lines, active upstream). We cannot delete rvf-embedding-service.ts (upstream
file).

### Revised approach: Wrap, Don't Delete

**New files (we own):**
- `@claude-flow/embeddings/src/pipeline.ts` -- `EmbeddingPipeline` class:
  - Wraps whichever embedding service is available (real ONNX model or stub)
  - Enforces dimension at construction: `if (dim !== expectedDim) throw EmbeddingDimensionError`
  - Exposes canonical `cosineSimilarity(a, b)` that throws on `a.length !== b.length`
  - Singleton via `getPipeline()` / `initPipeline(config)`
- `@claude-flow/embeddings/src/pipeline-factory.ts` -- factory that reads
  `getConfig().embedding` and selects the correct underlying service

**Existing files (surgical patches, all PR-able):**
- `memory-initializer.ts` -- at the top of `generateEmbedding()`, add early return:
  ```typescript
  // ADR-0077: route through unified pipeline when available
  try { const p = (await import('@claude-flow/embeddings')).getPipeline?.();
    if (p) return p.embed(text);
  } catch { /* fall through to legacy path */ }
  ```
  This is ~4 lines. The existing function body remains as fallback. Net effect: when
  the pipeline is initialized (which it is in all normal startup paths), the 6 legacy
  implementations are bypassed without being deleted.

- `memory-bridge.ts` -- same pattern at its `cosineSim()` (line ~3589):
  ```typescript
  // ADR-0077: use canonical cosineSim
  try { const { cosineSimilarity } = await import('@claude-flow/embeddings');
    return cosineSimilarity(a, b);
  } catch { /* fall through */ }
  ```

- `intelligence.ts` -- same pattern at its zero-padding `cosineSim()` (~line 595)

**What we gain:**
- Single embedding path in production (pipeline.ts)
- Dimension validation at startup
- Canonical cosineSimilarity that throws on mismatch instead of truncating/padding
- All 6 legacy implementations remain as fallback code but are never reached in
  normal operation
- Upstream files are modified by 4-6 lines each, not rewritten

**Upstream PR opportunity:**
The `cosineSim` truncation bug is a genuine correctness issue. A PR that makes
`cosineSim` throw on dimension mismatch (Track A item A1) is the highest-value
upstream contribution. It is a 3-file, ~30-line fix that any maintainer would accept.

**Files deleted:** 0
**Files created:** 2
**Upstream merge conflict risk:** Low -- 4-6 line patches at the top of existing functions

---

## Revised Phase 4: Controller Lifecycle Cleanup (2 weeks)

### Goal
No duplicate controller instances. AgentDBService delegates to ControllerRegistry.

### Original ADR-0076 approach
Split controller-registry.ts into 5 files. Delete AgentDBService. Create shim.
Rated HIGH upstream risk for ruflo fork, LOW for agentic-flow fork.

### Upstream compatibility assessment
**NOT compatible for ruflo.** controller-registry.ts (2,007 lines) is the highest
merge-conflict file in the ruflo fork. Splitting it into 5 files guarantees conflicts
on every sync.

**Compatible for agentic-flow.** The agentic-flow fork has been frozen since 2026-02-27.
However, "delete and replace" is still risky -- if upstream resumes development, we
have a permanent divergence.

### Revised approach: Intercept at Boundaries

**New files (we own):**
- `@claude-flow/memory/src/controller-intercept.ts` -- module-level singleton guard:
  ```typescript
  const _instances = new Map<string, unknown>();
  export function getOrCreate<T>(name: string, factory: () => T): T {
    if (_instances.has(name)) return _instances.get(name) as T;
    const inst = factory();
    _instances.set(name, inst);
    return inst;
  }
  export function getExisting<T>(name: string): T | undefined {
    return _instances.get(name) as T | undefined;
  }
  ```
  ~40 lines. Both ControllerRegistry and AgentDBService call `getOrCreate()` instead
  of `new`. First caller wins. Second caller gets the existing instance.

- `agentic-flow/src/services/agentdb-shim.ts` -- delegates 15 controller
  constructions to `getOrCreate()` from controller-intercept.ts. Same public API
  surface as AgentDBService (`getInstance()`, all method signatures preserved).
  Does NOT replace agentdb-service.ts -- it is imported alongside it and injected
  at the `getInstance()` level.

**Existing files (surgical patches):**
- `controller-registry.ts` -- wrap each controller factory call with `getOrCreate()`:
  ```typescript
  // Before:
  instance = new ReflexionController(this.agentdb, embSvc);
  // After:
  instance = getOrCreate('reflexion', () => new ReflexionController(this.agentdb, embSvc));
  ```
  This is a ~1-line change per factory (13 factories = ~13 lines changed). The file
  structure, line count, and public API are unchanged.

- `agentdb-service.ts` -- same pattern. Wrap 15 `new` calls with `getOrCreate()`.
  ~15 lines changed. File structure unchanged.

- `controller-registry.ts` factory for `circuitBreakerController` -- fix the null
  return (Track A item A2). This is a ~25-line addition: inline circuit breaker
  state machine as fallback. Pure bug fix, upstream PR candidate.

**What we gain:**
- Zero duplicate controller instances (singleton guard at module level)
- AgentDBService and ControllerRegistry share the same object instances
- Cache coherence restored -- no more divergent in-memory state
- Both files remain structurally identical to upstream (diff is ~15 lines each)
- circuitBreaker actually works (Level 0 security no longer returns null)

**What we defer:**
- Splitting controller-registry.ts into smaller files (nice-to-have, not required
  for correctness, and the merge conflict cost is prohibitive)
- Deleting AgentDBService (the shim + getOrCreate pattern means it becomes a thin
  pass-through, but the file stays in the tree)

**Upstream PR opportunities:**
1. `circuitBreakerController` null factory -- genuine bug, Level 0 security controller
   that never initializes. High-value fix.
2. `getOrCreate` pattern -- could be proposed as an upstream utility. Controllers are
   expensive (SQLite connections, HNSW indices). Double-construction is wasteful even
   in upstream's own codebase.
3. `federatedSession` factory case that is not in INIT_LEVELS -- dead code that should
   either be wired or removed. Low-effort upstream PR.

**Files deleted:** 0
**Files created:** 2 (controller-intercept.ts, agentdb-shim.ts)
**Upstream merge conflict risk:** Low -- changes to existing files are wrapped call sites,
not structural changes

---

## Revised Phase 5: Data Flow Unification (2 weeks)

### Goal
Single path from MCP tool -> ControllerRegistry -> IStorage. No bridge. No fallbacks.

### Original ADR-0076 approach
Delete memory-bridge.ts (3,603 lines). Delete sql.js fallback paths from
memory-initializer.ts (~1,800 lines). Rewrite memory-tools.ts and agentdb-tools.ts.
Rated VERY HIGH upstream risk.

### Upstream compatibility assessment
**NOT compatible.** memory-bridge.ts (3,603 lines) and memory-initializer.ts (2,929
lines) are actively maintained in the ruflo upstream. Deleting either one guarantees
permanent, irreconcilable divergence.

### Revised approach: Route Around, Don't Delete

**New files (we own):**
- `@claude-flow/cli/src/memory/memory-router.ts` -- single entry point for all memory
  operations:
  ```typescript
  export async function routeMemoryOp(op: MemoryOp): Promise<MemoryResult> {
    const registry = getControllerRegistry();
    const storage = registry.get('storage') as IStorage;
    const pipeline = getPipeline();

    switch (op.type) {
      case 'store': return storage.store(op.key, op.value, await pipeline.embed(op.value));
      case 'search': return storage.search(await pipeline.embed(op.query), op.topK);
      case 'delete': return storage.delete(op.key);
      // ... 7 more operations
    }
  }
  ```
  ~150 lines. This is the "single data flow path" from ADR-0075's ideal end state.

- `@claude-flow/cli/src/memory/migration-legacy.ts` -- standalone script that reads
  old JSON/SQLite data and converts to RVF format. Extracted from the ~1,800 lines
  of sql.js fallback in memory-initializer.ts. Run once during upgrade, not at
  every startup.

**Existing files (surgical patches at call sites, not in bridge/initializer):**
- `memory-tools.ts` -- replace bridge dispatch calls with `routeMemoryOp()`:
  ```typescript
  // Before:
  const result = await memoryBridge.store(key, value, namespace);
  // After:
  const result = await routeMemoryOp({ type: 'store', key, value, namespace });
  ```
  Each tool handler is a 1-2 line change. The tools file is ours to modify (it is
  the MCP tool registration, not deep upstream infrastructure).

- `agentdb-tools.ts` -- same pattern. Replace bridge calls with `routeMemoryOp()` or
  direct `registry.get(name).method()` calls.

**Existing files (NOT modified):**
- `memory-bridge.ts` -- left untouched. When memory-tools.ts no longer calls it, it
  becomes dead code in practice but remains in the tree for upstream compatibility.
  If upstream later modifies it, our merge is clean.
- `memory-initializer.ts` -- left untouched except for the 4-line pipeline redirect
  from Phase 3. The sql.js fallback paths remain as dead code.

**What we gain:**
- Single data flow path: MCP tool -> routeMemoryOp -> ControllerRegistry -> IStorage
- memory-bridge.ts and its dimension bypass are bypassed (not deleted)
- sql.js fallback paths are bypassed (not deleted)
- No parallel paths producing different results
- Zero merge conflict risk on the two highest-conflict files

**What we defer:**
- Actually deleting memory-bridge.ts and the sql.js paths. This is cosmetic -- they
  are dead code once the call sites are rerouted. The 6,400 lines remain in the tree
  but are never executed. If upstream eventually removes or simplifies them, our merge
  is trivially clean.

**Upstream PR opportunity:**
The `memory-router.ts` pattern (single entry point) could be proposed upstream as
a simplification. If accepted, upstream would naturally deprecate the bridge/initializer
paths themselves, and our dead code problem resolves organically.

**Files deleted:** 0
**Files created:** 2 (memory-router.ts, migration-legacy.ts)
**Upstream merge conflict risk:** None for bridge/initializer. Low for tools files.

---

## Dependency DAG (Revised)

```
Track A (ships first, no dependencies between items)
  A1 cosineSim fix
  A2 circuitBreaker fix
  A3 dimension validation
  A4 dual-instance guard

Track B (revised)
  Phase 1: Config (new files)  ---------> Phase 3: Embedding Pipeline (new files)
                                                      |
  Phase 2: IStorage interface (new files) ----------> Phase 5: Memory Router (new files)
                                                      |
  Phase 4: Controller Intercept (new files) -------> Phase 5: Memory Router (new files)
```

Unchanged from original: Phase 5 requires Phases 2, 3, and 4. Phases 1-4 are
independent of each other.

---

## Comparison: Original vs. Revised

| Metric | Original Track B | Revised Track B |
|--------|-----------------|-----------------|
| Files deleted from upstream | 4 (hybrid, agentdb-backend, rvf-embedding, memory-bridge) | 0 |
| Files split in upstream | 1 (controller-registry -> 5) | 0 |
| New files (we own) | 8 | 11 |
| Lines changed in upstream files | ~500+ | ~80 |
| Merge conflict risk | HIGH (Phases 2,4,5) | NONE to LOW |
| Dead code removed | ~9,555 lines | ~0 (bypassed instead) |
| Dead code in tree | ~0 | ~6,400 (bridge + sql.js paths + hybrid-backend) |
| Correctness bugs fixed | All 5 | All 5 |
| Config unification | Yes | Yes |
| Embedding unification | Yes | Yes |
| Controller dedup | Yes | Yes |
| Single data flow | Yes | Yes |
| Upstream PR candidates | 0 | 6+ |

---

## Trade-Off Analysis

### What we sacrifice

1. **Dead code remains in the tree.** ~6,400 lines of unreachable code (memory-bridge.ts,
   sql.js fallback, hybrid-backend.ts) continue to exist. This has no runtime cost. It
   has a minor build time cost (~1-2 seconds of TS compilation). It has a minor cognitive
   cost (developers see files that are never called). We mitigate the cognitive cost with
   a `DEAD_CODE.md` manifest listing bypassed files and the ADR explaining why.

2. **11 new files instead of net file reduction.** The original plan reduced file count.
   The revised plan increases it. However, the new files are small (40-150 lines each),
   well-documented, and entirely under our control. The alternative (modifying/deleting
   upstream files) has a permanent ongoing merge cost that far exceeds the one-time cost
   of 11 small files.

3. **AgentDBService is not deleted.** It becomes a thin wrapper (via getOrCreate) but the
   file remains at 1,748 lines. This is cosmetically unsatisfying but functionally
   correct -- all instances are shared, caches are coherent, and the public API is
   unchanged.

### What we gain

1. **Zero merge conflict risk.** Every upstream sync is a clean fast-forward on the files
   that matter. We never have to resolve 3-way merges on controller-registry.ts,
   memory-bridge.ts, or memory-initializer.ts.

2. **Upstream PR pipeline.** Six concrete bug fixes and improvements that can be
   contributed back:
   - cosineSim truncation bug (3 files, ~30 lines)
   - circuitBreaker null factory (1 file, ~25 lines)
   - embedding-constants consolidation (4 files, ~16 lines)
   - federatedSession dead code (1 file, ~5 lines)
   - getOrCreate singleton pattern (utility addition)
   - memory-router single entry point (architectural proposal)

3. **Incremental reversibility.** If upstream accepts our PRs, we can remove our
   interception layers one by one. If upstream restructures in a way that aligns with
   ADR-0075's ideal state, we simply delete our wrappers and adopt theirs. Neither
   direction requires a migration.

4. **All 5 goals achieved.** Single config, single embedding pipeline, no duplicate
   controllers, single data flow, dead code bypassed. The runtime behavior is identical
   to the original plan. Only the file tree differs.

---

## Upstream PR Candidates (Prioritized)

| # | Fix | Files | Lines | Upstream value | Our value |
|---|-----|-------|-------|---------------|-----------|
| 1 | cosineSim throws on dim mismatch | 3 | ~30 | Correctness bug, affects all users | Removes need for Phase 3 patches |
| 2 | circuitBreaker null factory | 1 | ~25 | Level 0 security never runs | Removes need for Phase 4 patch |
| 3 | embedding-constants -> shared const | 4 | ~16 | DRY, removes 4 copy-paste files | Reduces Phase 1 patch surface |
| 4 | federatedSession dead factory case | 1 | ~5 | Dead code cleanup | Minor |
| 5 | getOrCreate controller utility | 1 | ~40 | Prevents double-construction waste | Core of Phase 4 |
| 6 | IStorage narrow interface | 1 | ~30 | Documents actual contract | Core of Phase 2 |

If upstream accepts PRs 1-3, our Phase 1 and Phase 3 patches shrink to near zero.
If upstream accepts PRs 5-6, our Phase 2 and Phase 4 become pure consumers of
upstream utilities.

---

## Implementation Timeline

| Phase | Duration | Blocked by | New files | Patches to upstream files |
|-------|----------|-----------|-----------|--------------------------|
| 1 Config | 1 week | Nothing | 3 | 7 (1-5 lines each) |
| 2 IStorage | 3 days | Nothing | 2 | 0 |
| 3 Embedding | 1 week | Phase 1 | 2 | 3 (4-6 lines each) |
| 4 Controller | 1.5 weeks | Nothing | 2 | 2 (~15 lines each) |
| 5 Data Flow | 1.5 weeks | Phases 2,3,4 | 2 | 2 (~10 lines each) |
| **Total** | **5-6 weeks** | | **11** | **14 files, ~80 lines** |

This is comparable to the original 4-6 week estimate with dramatically lower ongoing
maintenance cost.

---

## Recommendation

1. **Ship Track A immediately** (unchanged from ADR-0076). All correctness bugs, zero risk.

2. **Open upstream PRs for items 1-3** while starting Phase 1. These are genuine bugs,
   not taste differences. If accepted, they reduce our patch surface before we even
   start.

3. **Start Phases 1 and 2 in parallel** (no dependency). Phase 1 is the highest-value
   structural change (config unification eliminates the root cause of dimension chaos).
   Phase 2 is 3 days of pure-additive interface work.

4. **Start Phases 3 and 4 after Phase 1 lands** (Phase 3 depends on config; Phase 4 is
   independent but benefits from the config singleton being available).

5. **Phase 5 last**, after 2-4 are stable. This is the payoff phase where the single
   data flow path comes together.

---

## Implementation Notes (2026-04-11)

All 5 phases implemented. Two intentional deviations from the spec pseudocode:

### Deviation 1: Router wraps memory-initializer, not ControllerRegistry -> IStorage

The spec pseudocode shows `registry.get('storage') as IStorage`. The implementation
wraps `memory-initializer.ts` functions (`storeEntry`, `searchEntries`, etc.) directly.

**Rationale:** The ControllerRegistry does not manage the raw storage backend as a named
controller. Creating that plumbing would add an indirection layer with no behavioral
change. The router achieves the same goal: single entry point, bridge bypassed for all
CRUD operations. The `IStorage` interface (Phase 2) serves its purpose as the typing
contract for controller consumers.

### Deviation 2: 14 agentdb bridge functions remain (addressed by ADR-0078)

Phase 5 migrated `memory-tools.ts` completely (zero bridge imports) and migrated 20 of
34 bridge call sites in `agentdb-tools.ts`. The remaining 14 use named bridge functions
with multi-controller orchestration logic (2-4 controllers, fallback chains, API version
probing) that cannot be collapsed to single `getController().method()` calls.

ADR-0078 defines the 3-phase plan to eliminate these remaining bridge calls, contingent
on the Phase 4 `getOrCreate` singleton guard being fully wired across both the bridge's
and initializer's ControllerRegistry instances.

### Files created
- `@claude-flow/cli/src/memory/memory-router.ts` (361 lines)
- `@claude-flow/cli/src/memory/migration-legacy.ts` (148 lines)

### Files modified
- `@claude-flow/cli/src/mcp-tools/memory-tools.ts` -- all 6 handlers routed through `routeMemoryOp()`
- `@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` -- 20 call sites migrated to router

### Files NOT modified (upstream compatible)
- `memory-bridge.ts` -- untouched, zero ADR-0077 changes
- `memory-initializer.ts` -- untouched except Phase 3's 4-line pipeline redirect

### Test coverage
- 44 new tests (unit + integration + wiring) in `tests/unit/memory-router-adr0077.test.mjs`
- All 1437 unit tests pass, 0 regressions

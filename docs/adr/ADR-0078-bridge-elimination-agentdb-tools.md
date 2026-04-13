# ADR-0078: Bridge Elimination from AgentDB Tools

- **Status**: Implemented (Phases 1-3)
- **Implemented**: 2026-04-11
- **Date**: 2026-04-11
- **Depends on**: ADR-0077 (Phase 5 data flow), ADR-0076 Phase 4 (controller-intercept)
- **Continues**: ADR-0077 Track B

## Context

ADR-0077 Phase 5 established `memory-router.ts` as the single entry point for memory
operations. `memory-tools.ts` (6 handlers) routes entirely through the router with zero
bridge imports.

After Phase 5, `agentdb-tools.ts` had 24 `getBridge()` call sites importing
`memory-bridge.ts`. A hive deliberation analyzed these and categorized the bridge
functions into 3 tiers by migration complexity.

Phases 1 and 2 were implemented immediately. Phase 3 remains proposed.

## Decision

Eliminate bridge dependency from `agentdb-tools.ts` in 3 phases.

---

## Phase 1: Correctness Fixes -- DONE (2026-04-11)

Fixed 4 error re-throw sites in `memory-tools.ts` where optional post-processing
controllers (MemoryGraph, AttentionService, MetadataFilter) turned successful
store/search operations into reported failures. Changed `throw new Error(...)` to
silent `catch {}`, matching the pattern used by MMR, context synthesis, and scope
controllers in the same file.

---

## Phase 2: Category A Bridge Wrapper Migration -- DONE (2026-04-11)

Migrated 8 pure-wrapper bridge functions to direct `getController()` calls.
`getBridge()` call count: 24 → 16.

| Bridge function | Controller | Method |
|----------------|-----------|--------|
| `bridgeRateLimitStatus` | `rateLimiter` | `getStats()` |
| `bridgeResourceUsage` | `resourceTracker` | `getStats()` |
| `bridgeCircuitStatus` | `circuitBreakerController` | `getStats()` |
| `bridgeTelemetryMetrics` | `telemetryManager` | `getMetrics()` |
| `bridgeTelemetrySpans` | `telemetryManager` | `getSpans(limit)` |
| `bridgeSemanticRoute` | `semanticRouter` | `route(input)` |
| `bridgeConsolidate` | `memoryConsolidation` | `consolidate(params)` |
| `bridgeQueryStats` | `queryOptimizer` | `getCacheStats()` / `getStats()` |

Note: `bridgeQueryStats` uses method-name probing (`getCacheStats` first, fallback to
`getStats`). The migration preserves this priority to maintain return shape compatibility.

---

## Phase 3: Orchestration Migration (proposed, 3-4 weeks)

### Goal
Migrate the remaining 16 `getBridge()` call sites in `agentdb-tools.ts` to direct
`getController()` calls, then remove `getBridge()` entirely from the file.

### Scope clarification

**This ADR scopes bridge elimination to `agentdb-tools.ts` only.** The remaining 7 files
that import memory-bridge.ts are intentionally left as-is:

| File | bridge.calls | Why it stays |
|------|-------------|-------------|
| `memory-initializer.ts` | 13 | Upstream-owned (zero-modifications constraint, ADR-0077). 15 upstream commits since Dec 2025, last on 2026-04-06. Actively developed. |
| `memory-router.ts` | 12 | Bridge fallback is a safety net for controller access. Removing it removes resilience for zero gain. |
| `hooks-tools.ts` | 44 | Largest remaining consumer (3,902 lines). High merge-conflict surface, upstream-owned. |
| `worker-daemon.ts` | 10 | Background workers, moderate risk. |
| `intelligence.ts` | 4 | Low call count, low priority. |
| `daa-tools.ts` | 4 | Low call count, low priority. |
| `system-tools.ts` | 3 | Low call count, low priority. |

**The bridge can never become dead code** because `memory-initializer.ts` cannot be
modified and it permanently depends on the bridge. Additionally, `memory-initializer.ts`
IS on the hot path for CRUD operations — `routeMemoryOp()` delegates store/search/get/
delete/list to the initializer's exported functions, which call through the bridge
internally. Only controller access bypasses the bridge (via the intercept pool).

Forking `memory-initializer.ts` to make the bridge dead code is not justified while
upstream actively develops the file. The trigger to reconsider is upstream stalling
(3+ months with no commits).

### Runtime path (updated 2026-04-11)

ADR-0076 Phase 4 (controller-intercept) is fully wired: `controller-registry.ts` has
49 `getOrCreate()` calls, all controllers enter the intercept pool. The router's
`getController()` returns from the pool directly; the bridge fallback fires only on
edge-case timing (before registry init completes). Phase 3 is therefore a **real
decoupling**, not just code organization — `agentdb-tools.ts` handler calls resolve
through the intercept pool without touching the bridge.

### Registry architecture

The initial analysis hypothesized dual ControllerRegistry instances. Investigation
revealed this is incorrect: `memory-initializer.ts` delegates to the bridge's
`getControllerRegistry()` (bridge line 1821), which returns the bridge's own singleton.
There is only **one** ControllerRegistry creation point: `memory-bridge.ts` line 182.

This means Phase 3 does **not** require registry unification. The `getOrCreate` wrapping
proposed in the original draft is unnecessary. The migration is purely about moving
bridge call sites to direct controller access.

### Upstream compatibility note

ADR-0077 established a zero-modifications constraint on `memory-bridge.ts` and
`memory-initializer.ts`. Since registry unification is not needed, Phase 3 does NOT
modify either file. The zero-modifications constraint is preserved.

### `BRIDGE_STRICT` semantics

The bridge uses `BRIDGE_STRICT` (env `CLAUDE_FLOW_STRICT`, default: true) which throws
`ControllerNotAvailable` when a required controller is missing. Migrated handlers using
`getController()` return `undefined` instead of throwing. This is an intentional
softening: MCP tool handlers should return `{ success: false, error: '...' }` for
unavailable controllers, not throw uncaught errors. Each migrated handler must include
an explicit null check with a descriptive error message.

### Remaining bridge functions (16 call sites across 16 handlers)

**Category B: Multi-controller orchestration (12 functions)**

| Bridge function | Controllers | Orchestration logic |
|----------------|------------|-------------------|
| `bridgeStorePattern` | reasoningBank | API probing: 3 method name variants + SQL fallback |
| `bridgeSearchPatterns` | reasoningBank | Multi-method probe + result normalization |
| `bridgeRecordFeedback` | learningSystem, reasoningBank, skills, selfLearningRvf | Fan-out to 3-4 controllers + conditional skill promotion |
| `bridgeRecordCausalEdge` | causalGraph | addEdge + bridge-fallback SQL insert |
| `bridgeRouteTask` | semanticRouter, learningSystem | Two-controller cascade with fallback |
| `bridgeSessionStart` | reflexion + embedded search | Start episode + restore past patterns |
| `bridgeSessionEnd` | reflexion, store, nightlyLearner | End episode + store + consolidate |
| `bridgeHierarchicalStore` | hierarchicalMemory | Runtime version detection |
| `bridgeHierarchicalRecall` | hierarchicalMemory | Runtime version detection |
| `bridgeContextSynthesize` | hierarchicalMemory, contextSynthesizer | Recall + shape transform + synthesize |
| `bridgeFlashConsolidate` | attentionService | Matrix construction + fallback to basic consolidate |
| `bridgeBatchOperation` | batchOperations, rateLimiter, resourceTracker | Pre-flight guards (ADR-0042) + batch op |

**Category C: Deferred init + type detection (4 functions)**

| Bridge function | Complexity |
|----------------|-----------|
| `bridgeEmbed` | waitForDeferred + Float32Array type detection + fallback |
| `bridgeFilteredSearch` | Multi-step search pipeline |
| `bridgeCausalRecall` | Causal-aware search pipeline |
| `bridgeBatchOptimize/Prune` | Multi-step optimization pipeline |

### Internal bridge-to-bridge dependencies

Four bridge functions call other bridge-internal functions that are not accessible
via `getController()`:

| Bridge function | Internal dependency | What it does |
|----------------|-------------------|-------------|
| `bridgeSessionStart` | `bridgeSearchEntries`, `_getAdaptiveThreshold` | Embedded search + model/dimension detection |
| `bridgeSessionEnd` | `bridgeStoreEntry` | 100+ line function: MutationGuard, rate-limit, embedding, attestation, SQL write |
| `bridgeRecordFeedback` | `bridgeStoreEntry` | Persists feedback as memory entry |
| `bridgeBatchOperation` | `bridgeCheckResources`, `bridgeCheckRateLimit` | Private pre-flight guard functions |

**Resolution strategy per dependency:**

1. **`bridgeStoreEntry` → use `routeMemoryOp({ type: 'store', ... })`.**
   The router's store operation handles embedding generation and persistence.
   MutationGuard and attestation are controller-level concerns that fire
   automatically when the store goes through the ControllerRegistry. Rate-limiting
   is handled by the `rateLimiter` controller (accessible via `getController`).

2. **`bridgeSearchEntries` → use `routeMemoryOp({ type: 'search', ... })`.**
   Same rationale. The router wraps the same underlying search path.

3. **`_getAdaptiveThreshold` → use `getConfig().embedding.dimension`.**
   The private helper probes the embedding model to detect dimension. Phase 1's
   `resolve-config.ts` already provides the canonical dimension via `getConfig()`.
   No need to replicate the probing logic.

4. **`bridgeCheckResources` / `bridgeCheckRateLimit` → use `getController()` directly.**
   These are thin wrappers: `getController('resourceTracker').checkLimit()` and
   `getController('rateLimiter').consume()`. If the controller is unavailable,
   skip the pre-flight check (non-fatal).

Functions without internal dependencies (8 of 12 Category B, all 4 Category C) are
straightforward: extract orchestration logic, replace `registry.get()` with
`getController()`.

### File organization

`agentdb-tools.ts` is currently 1,457 lines (already above the project's 500-line
guideline). Adding ~350 lines of extracted helpers would push it to ~1,800 lines.

**Mitigation:** Extract all orchestration helpers into a new file:
`agentdb-orchestration.ts` (~350 lines). This file contains only the local helpers
and imports `getController` from the router. The tool handlers in `agentdb-tools.ts`
call these helpers instead of `getBridge()`. This keeps `agentdb-tools.ts` at its
current size and puts the orchestration logic in a file we fully own.

### Migration steps

**Step 1: Create `agentdb-orchestration.ts`**

New file in `@claude-flow/cli/src/mcp-tools/`. Contains extracted helper functions
for each bridge function being migrated. Each helper:
- Gets controllers via `getController()` from the router
- Uses `routeMemoryOp()` for store/search operations (replacing `bridgeStoreEntry`/
  `bridgeSearchEntries`)
- Uses `getConfig()` for dimension/model info (replacing `_getAdaptiveThreshold`)
- Copies `getCallableMethod` (bridge line 1859, 9 lines) verbatim — do NOT rewrite
- Preserves all method-name probing and fallback chains from the bridge source
- Returns `null` when controllers are unavailable (caller handles the error)

**Step 2: Migrate Category B handlers (12 functions)**

For each handler in `agentdb-tools.ts`:
1. Import the corresponding helper from `agentdb-orchestration.ts`
2. Replace `getBridge().bridgeFn(params)` with the helper call
3. Handle null return as `{ success: false, error: '...' }`

**Step 3: Migrate Category C handlers (4 functions)**

Same pattern. Extra care for:
- `bridgeEmbed`: Float32Array detection and fallback to `routeMemoryOp` for embedding
- `bridgeBatchOptimize`: one handler calls 3 bridge methods (optimize, prune, stats)

**Step 4: Remove `getBridge()` from agentdb-tools.ts**

Once all 16 call sites are migrated, remove:
- The `_bridgeModule` cache variable
- The `getBridge()` function
- The `import('../memory/memory-bridge.js')` dynamic import

### Test requirements

Each migrated handler must be covered by:
1. **Unit test**: mock `getController()`, verify orchestration logic and null handling
2. **Behavioral equivalence test**: call the MCP handler and assert identical JSON output
   shape as the bridge-backed version (test against the handler's public MCP interface,
   not internal orchestration helpers — this keeps tests stable across rollbacks)
3. **Acceptance test**: run the MCP tool against a live Verdaccio-published package

Baseline tests before migration are required only for the 4 high-risk handlers with
internal bridge dependencies (`bridgeSessionStart`, `bridgeSessionEnd`,
`bridgeRecordFeedback`, `bridgeBatchOperation`). The remaining 12 handlers can be
tested inline during migration — the behavioral equivalence test IS the baseline.

### Rollback strategy

Each handler is migrated individually. If a migration causes failures:
1. Revert the handler call site and remove its orchestration helper
2. Restore the `getBridge().bridgeFn()` call
3. Add a regression test capturing the failure
4. Investigate before re-attempting

The bridge is never deleted or modified, so per-handler rollback is always possible.

### Drift detection

Each orchestration helper must include a source-marker comment referencing the bridge
function and line range it replicates:

```typescript
// Replicates: memory-bridge.ts bridgeStorePattern (lines 1950-1990)
// Last synced: 2026-04-11 (commit abc1234)
```

The sync script must warn when `memory-bridge.ts` has upstream changes:

```bash
if git diff --name-only upstream/main | grep -q "memory-bridge.ts"; then
  echo "⚠️  memory-bridge.ts changed upstream — audit agentdb-orchestration.ts"
fi
```

### Risk: Medium
The orchestration migrations are mechanical but each function's fallback chain,
method-name probing, and error handling must be preserved exactly. Functions with
internal bridge dependencies (4 of 16) require substituting `routeMemoryOp()` for
`bridgeStoreEntry`/`bridgeSearchEntries` — these substitutions must be validated
with integration tests before merging.

---

## Comparison: Current State and After Phase 3

| Metric | Current (Phases 1-2 done) | After Phase 3 |
|--------|--------------------------|---------------|
| `getBridge()` calls in agentdb-tools.ts | 16 | 0 |
| Bridge calls in memory-tools.ts | 0 | 0 |
| memory-bridge.ts status | Live (agentdb-tools + 7 other files) | Live (7 other files -- NOT dead code) |
| Error re-throws in memory-tools.ts | 0 | 0 |

---

## Upstream PR Candidates

| # | Fix | Upstream value |
|---|-----|---------------|
| 1 | `bridgeRecordFeedback` multi-controller utility | Upstream users need this pattern |
| 2 | `bridgeSessionStart/End` episodic lifecycle | Documents the session API upstream describes but doesn't show |

---

## Implementation Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| 1 Correctness fixes | -- | Done (2026-04-11) |
| 2 Category A migration | -- | Done (2026-04-11) |
| 3 Category B/C migration | -- | Done (2026-04-11) |

## ADR-0085 Note (2026-04-13)

ADR-0085 deleted memory-bridge.ts entirely, which completes the elimination this ADR
began. ADR-0078 migrated agentdb-tools.ts callers from bridge to router (Phases 1-3).
ADR-0085 then removed the bridge file itself, the registry bootstrap (`getRegistry()`
moved to router as `initControllerRegistry()`), and the 11 remaining try-bridge
paths in memory-initializer.ts. The `bridgeRecordFeedback` and `bridgeSessionStart/End`
patterns identified in Upstream PR Candidates above are now implemented as
`routeFeedbackOp` and `routeSessionOp` in memory-router.ts.

# ADR-0033 Integration & Edge Case Test Design

**Status**: Design only (not implemented)
**Date**: 2026-03-15
**Author**: QA agent
**Scope**: Integration tests, chaos tests, regression tests, property-based tests for the 27 wired controllers in ADR-0033

---

## 1. New Test Files

### File A: `tests/12-controller-integration.test.mjs`

**Purpose**: Verify the ACTUAL wiring chain (Handler -> Bridge -> Registry -> Controller) using real built artifacts from `/tmp/ruflo-build/`, mocking only the storage/DB layer.

**Estimated test count**: 32

### File B: `tests/13-controller-chaos.test.mjs`

**Purpose**: Chaos engineering, concurrency, failure cascades, state corruption, and boundary conditions.

**Estimated test count**: 26

### File C: Additions to existing files

Regression tests for specific bugs found and fixed during ADR-0033 implementation, added to existing test files `07`, `09`, `10`.

**Estimated test count**: 11

### File D: `tests/14-controller-properties.test.mjs`

**Purpose**: Property-based tests verifying invariants that must hold for all inputs.

**Estimated test count**: 9

**Total across all files: 78 tests**

---

## 2. Detailed Test Design

### A. Integration Tests (`12-controller-integration.test.mjs`)

All tests in this file import from built artifacts at `/tmp/ruflo-build/v3/@claude-flow/`. The storage/DB layer is replaced with an in-memory Map-based stub. The controller registry, bridge functions, and controller factories are real.

**Build artifact dependencies**:
- `/tmp/ruflo-build/v3/@claude-flow/memory/dist/controller-registry.js` -- ControllerRegistry class
- `/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/memory/memory-bridge.js` -- bridge functions
- `/tmp/ruflo-build/v3/@claude-flow/memory/dist/agent-memory-scope.js` -- AgentMemoryScope
- `/tmp/ruflo-build/v3/@claude-flow/memory/dist/learning-bridge.js` -- LearningBridge

**Prerequisite guard**: Each `describe` block should skip (via `node:test`'s `{ skip }` option) if the build artifact does not exist, to avoid false failures when running without a prior build.

#### A1. Routing Cascade Integration (7 tests)

```
describe('Routing cascade integration')
  it('should attempt SolverBandit first, return early on high confidence')      [P0, medium]
  it('should fall through SolverBandit to SkillLibrary on low confidence')      [P0, medium]
  it('should fall through SkillLibrary to SemanticRouter on no skill match')    [P0, medium]
  it('should fall through SemanticRouter to TASK_PATTERNS as final fallback')   [P0, medium]
  it('should include LearningSystem metadata when SemanticRouter routes')       [P1, simple]
  it('should complete full cascade within 5 seconds even with slow phases')     [P1, complex]
  it('should preserve routing_method field accurately at each cascade level')   [P0, simple]
```

**What makes this integration, not unit**: These tests instantiate a real ControllerRegistry with real controller factories (SolverBandit, SkillLibrary, SemanticRouter etc.) registered. The bridge functions are imported from the actual `memory-bridge.js`. Only the underlying vector store is a Map stub. This verifies that:
1. The registry correctly creates each controller from its factory
2. The bridge functions correctly resolve controllers from the registry
3. The hooks_route handler correctly chains the bridge calls in order
4. Data flows end-to-end through the real code path

**Risk justification for P0**: Routing is the most frequently exercised path. If the cascade is broken, every agent spawn uses the wrong routing strategy. Unit tests mock the bridge so cannot catch wiring bugs.

#### A2. Memory Scope Integration (5 tests)

```
describe('Memory scope integration')
  it('should store with agent scope and retrieve only within that scope')       [P0, medium]
  it('should store with session scope that does not leak to agent scope')       [P0, medium]
  it('should store with global scope visible from all scope queries')           [P1, medium]
  it('should return unscoped results when no scope parameter provided')         [P1, simple]
  it('should handle scope_id=undefined with double-colon key format')           [P1, simple]
```

**What makes this integration**: Uses the real `AgentMemoryScope` controller (from `agent-memory-scope.js`) wired into the real `createMemoryStoreHandler` and `createMemorySearchHandler` chains. The unit tests (file 10) mock `scopeKey` and `filterByScope` as plain functions; integration tests verify the real `AgentMemoryScope` class produces correct key formats and that the real `filterByScope` implementation actually isolates scopes.

**Risk justification for P0**: Scope leakage is a data isolation bug. If agent-scoped data leaks to session queries (or vice versa), agents see each other's private memories. This cannot be caught by mocked unit tests.

#### A3. Learning Feedback Loop (6 tests)

```
describe('Learning feedback loop')
  it('should update SolverBandit after post-task and reflect in next route')    [P0, complex]
  it('should converge: repeated high rewards to arm A makes A preferred')       [P1, complex]
  it('should record SonaTrajectory step during post-task feedback')             [P1, medium]
  it('should create SkillLibrary entry when post-task quality > 0.8')           [P1, medium]
  it('should NOT create SkillLibrary entry when post-task quality <= 0.8')      [P1, simple]
  it('should trigger NightlyLearner consolidation on session-end')              [P2, medium]
```

**What makes this integration**: The RETRIEVE->JUDGE->DISTILL cycle spans multiple controllers and bridge functions. Test A3.1 is the critical loop test:
1. Call `bridgeSolverBanditSelect` -> record initial arm choice
2. Call `bridgeSolverBanditUpdate` with high reward for that arm
3. Call `bridgeSolverBanditSelect` again -> verify the same arm is now selected with higher confidence

This tests the real SolverBandit's Thompson Sampling Beta distribution updates, which unit tests mock away.

**Risk justification for P0 (first test)**: The entire self-learning loop is the primary value proposition of ADR-0033. If the feedback doesn't actually update the bandit's internal state, the system never learns.

#### A4. Health Check Integration (4 tests)

```
describe('Health check integration')
  it('should report all 27 wired controllers in health check output')           [P1, complex]
  it('should report degraded status when one controller fails to init')         [P1, medium]
  it('should report healthy status when all controllers init successfully')     [P1, medium]
  it('should include initTimeMs for each controller')                           [P2, simple]
```

**What makes this integration**: Instantiates a real `ControllerRegistry`, calls `healthCheck()`, and verifies the returned `RegistryHealthReport` contains all 27 controller names with correct status values. Unit tests cannot verify the real initialization order or that the factory methods actually produce non-null controllers.

**Risk justification for P1**: Health check is an observability tool. If controllers report incorrectly, operators cannot diagnose production issues. Lower priority than routing/scope because it doesn't affect functionality.

#### A5. COW Branch Lifecycle (10 tests)

```
describe('COW branch lifecycle')
  it('should create a branch via derive() and return branchId')                 [P1, medium]
  it('should write to branch without affecting parent namespace')               [P0, complex]
  it('should read from branch and see branch-specific data')                    [P0, medium]
  it('should read from parent and NOT see branch data before merge')            [P0, medium]
  it('should merge branch and make data visible in parent')                     [P0, complex]
  it('should support merge strategy parameter')                                 [P2, medium]
  it('should return branch status with metadata')                               [P2, simple]
  it('should return null branch for nonexistent branchId')                      [P2, simple]
  it('should handle merge of empty branch (no writes)')                         [P1, simple]
  it('should isolate multiple concurrent branches from each other')             [P1, complex]
```

**What makes this integration**: The COW (Copy-on-Write) branching system spans the MCP tool handler -> bridge -> vectorBackend controller -> in-memory store. Unit tests (file 07) mock `branchGet`, `branchStore`, `branchMerge` individually. Integration tests verify the full lifecycle: create -> write -> read -> parent-unchanged -> merge -> parent-updated. This is the only way to catch bugs where the branch metadata format doesn't match what the merge function expects.

**Risk justification for P0 (write/read/merge isolation tests)**: COW branching is used for experimental memory branches. If branch data leaks to parent before merge, or merge silently drops data, the memory system has data corruption.

---

### B. Chaos Tests (`13-controller-chaos.test.mjs`)

These tests do NOT require build artifacts. They use the same simulated-handler pattern as files 07-10, but focus on adversarial conditions.

#### B1. Concurrent Controller Access (4 tests)

```
describe('Concurrent controller access')
  it('should handle 50 simultaneous bridgeSolverBanditSelect calls')            [P1, complex]
  it('should handle 50 simultaneous memory_store calls to same key')            [P1, complex]
  it('should handle interleaved store+search on same namespace')                [P2, medium]
  it('should handle concurrent branch create+merge operations')                 [P2, complex]
```

**Approach**: Use `Promise.all()` with 50 concurrent invocations. Verify no unhandled rejections, no data corruption (final state is consistent), and all calls return valid `{ success: true/false }` responses.

**Risk justification for P1**: MCP tools can be called concurrently by multiple agents. If the bridge functions have race conditions (especially SolverBandit state updates), the routing system can corrupt its Beta distribution state.

#### B2. Controller Init Failure Cascade (4 tests)

```
describe('Controller init failure cascade')
  it('should init Level 2 controllers even if Level 1 controller fails')        [P0, medium]
  it('should init Level 3 controllers even if Level 2 controller fails')        [P1, medium]
  it('should report degraded (not unhealthy) when one controller fails')        [P1, simple]
  it('should skip disabled controllers without error')                          [P2, simple]
```

**Approach**: Create a ControllerRegistry where one specific controller's factory throws. Verify that:
1. The registry still initializes remaining controllers at the same and subsequent levels
2. The health check reports `degraded` (not `unhealthy`)
3. Bridge functions that reference the failed controller return graceful fallback values

**Risk justification for P0 (first test)**: ADR-053 specifies level-based initialization. If a Level 1 failure blocks Level 2+, then a single controller bug takes down the entire memory system. The existing design says "failures are isolated" but no test verifies this.

#### B3. Timeout Cascade (4 tests)

```
describe('Timeout cascade in hooks_route')
  it('should fall through all 4 phases within 10s when each phase times out')   [P0, complex]
  it('should return default route within 10s even with 5 hanging controllers')  [P0, complex]
  it('should not accumulate timeouts (parallel, not serial)')                   [P2, complex]
  it('should preserve partial metadata from phases that succeeded before timeout') [P2, medium]
```

**Approach**: Create hook_route handler where SolverBandit, SkillLibrary, LearningSystem, and SemanticRouter all hang (never-resolving promises). Verify the handler still returns a valid default route within the sum of timeout budgets (4 phases x 2s = 8s, allow 10s budget). Each phase has an independent 2s timeout (`withTimeout`), so the worst case should be ~8s, not 4 x 2s = 8s serial.

**Risk justification for P0**: If timeouts cascade serially (8s total), every hooks_route call in a degraded environment takes 8 seconds. This makes the MCP server appear hung to Claude Code. The unit tests verify individual phase timeouts but not the aggregate.

#### B4. State Corruption (4 tests)

```
describe('State corruption resilience')
  it('should recover from corrupted SolverBandit JSON state')                   [P0, medium]
  it('should recover from corrupted branch metadata JSON')                      [P1, medium]
  it('should handle NaN in bandit confidence without crashing')                 [P1, simple]
  it('should handle missing fields in controller health response')              [P2, simple]
```

**Approach for B4.1**: Store malformed JSON in the `_solver_bandit_state` key. When `bridgeSolverBanditSelect` attempts to `restore()` the state, it should catch the parse error and operate with fresh (default prior) state rather than crashing. Verify the bridge returns a valid fallback response.

**Risk justification for P0 (bandit corruption)**: SolverBandit state persists across sessions via `serialize()` -> store -> `restore()`. If the stored JSON is corrupted (e.g., truncated write, encoding error), the bridge function must not throw. The current code has a `try {} catch {}` around restore, but no test verifies this path.

#### B5. Cold-Start Transitions (3 tests)

```
describe('Cold-start guard transitions')
  it('should return cold-start warning at exactly 4 edges')                     [P0, simple]
  it('should return real results at exactly 5 edges')                           [P0, simple]
  it('should transition from cold-start to active on 5th edge addition')        [P1, medium]
```

**Approach for B5.3**: Start with a causalRecall controller reporting 4 edges. Call `bridgeCausalRecall` -> verify cold-start warning. Then simulate adding 1 edge (update stats to 5). Call again -> verify real search results. This tests the transition boundary, not just the two states independently.

**Risk justification for P0 (boundary tests)**: The cold-start guard at `edgeCount < 5` is a critical threshold. If off-by-one (e.g., `<= 5`), the system either returns noise too early or blocks useful results for too long. Unit tests test `edgeCount: 3` and `edgeCount: 10` but not the boundary at 4 and 5.

#### B6. Scope Boundary Leakage (3 tests)

```
describe('Scope boundary leakage')
  it('should NOT find agent-scoped entries in unscoped search')                 [P0, medium]
  it('should NOT find agent:a1 entries when searching with scope agent:a2')     [P0, medium]
  it('should find global entries from agent-scoped search')                     [P1, medium]
```

**Approach**: Store entries with `scope=agent, scope_id=a1`. Then search without scope parameter. The scoped entries should NOT appear in results (their keys are prefixed with `agent:a1:`). Then search with `scope=agent, scope_id=a2` -> should also not find a1's entries. Then verify `scope=global` entries are visible from all scopes.

**Risk justification for P0**: This is the negative test for A2. The unit tests verify that `filterByScope` is called, but don't verify that unscoped search actually excludes scoped entries. If the store puts the scoped key in but the search doesn't filter, we have data leakage.

#### B7. Double-Fire Prevention (2 tests)

```
describe('Double-fire prevention')
  it('should not call skills.create twice for same post-task event')             [P1, medium]
  it('should not call sonaTrajectory.recordStep twice for same post-task event') [P1, medium]
```

**Approach**: Call `createHooksPostTaskHandler` once with quality > 0.8. Verify `skills.create` is called exactly 1 time and `sonaTrajectory.recordStep` is called exactly 1 time. This guards against accidental double-invocation from code duplication or retry logic.

**Risk justification for P1**: Fire-and-forget calls that execute twice would create duplicate skill entries and duplicate trajectory records. This pollutes the learning data. Lower priority than data corruption because duplicates are annoying but not destructive.

#### B8. Memory Pressure (2 tests)

```
describe('Memory pressure with full registry')
  it('should initialize all 27 controllers without exceeding 100MB heap delta')  [P2, complex]
  it('should support lazy controller access pattern (get only on use)')          [P2, medium]
```

**Approach for B8.1**: Record `process.memoryUsage().heapUsed` before and after initializing a full ControllerRegistry. The delta should be under 100MB. This test requires build artifacts and a real registry.

**Risk justification for P2**: Memory pressure is a production concern but not a correctness concern. The system works correctly even if it uses more memory than expected. This is optimization-level testing.

---

### C. Regression Tests (additions to existing files)

#### C1. In `tests/10-memory-tools-activation.test.mjs` (3 tests)

```
describe('memory_search -- MMR diversity -- regression')
  it('MMR: should degrade gracefully on throw, not propagate error (322b3e2f8)')  [P0, simple]
  it('MMR: should return original results when selectDiverse returns null')       [P1, simple]
  it('MMR: should return original results when selectDiverse returns undefined')  [P1, simple]
```

**Context**: Commit `322b3e2f8` fixed `mmrDiversityRanker` which was throwing on failure instead of degrading. The existing test `should not throw on MMR failure` covers the throw case. These regression tests add coverage for null/undefined return values which are also degradation paths.

#### C2. In `tests/09-memory-bridge-activation.test.mjs` (3 tests)

```
describe('bridgeGraphAdapter -- regression')
  it('gnnService: should handle inline wrapper pattern (35d851fdb)')              [P1, simple]
  it('rvfOptimizer: should handle inline wrapper pattern (35d851fdb)')            [P1, simple]
  it('graphAdapter: searchSkills should pass null query when not provided')        [P2, simple]
```

**Context**: Commit `35d851fdb` replaced broken class imports for `gnnService` and `rvfOptimizer` with inline wrappers. These regression tests verify the inline wrapper pattern works: the bridge function should successfully call the wrapper even though the underlying class doesn't exist as a standalone import.

#### C3. In `tests/07-agentdb-tools-activation.test.mjs` (3 tests)

```
describe('agentdb_branch (COW) -- regression')
  it('MutationGuard: should be called before store operations (P5-B)')            [P0, medium]
  it('MutationGuard: should be called before delete operations (P5-B)')           [P0, medium]
  it('MutationGuard: should allow store when guard returns allowed=true')          [P1, simple]
```

**Context**: P5-B was noted as "pre-existing" but the existing tests don't verify MutationGuard is actually invoked on store/delete paths. These tests add a mock MutationGuard and verify it's called before the actual write/delete proceeds.

#### C4. In `tests/09-memory-bridge-activation.test.mjs` (2 tests)

```
describe('bridgeCausalRecall -- regression')
  it('should handle getStats returning undefined (no totalCausalEdges field)')    [P1, simple]
  it('should treat missing getStats method as cold-start (0 edges)')              [P1, simple]
```

**Context**: The `bridgeCausalRecall` function has `const stats = typeof cr.getStats === 'function' ? cr.getStats() : {}`. If getStats exists but returns `undefined` or an object without `totalCausalEdges`, the edge count falls to 0 via `?? 0`, triggering cold-start. These tests verify both degradation paths.

---

### D. Property-Based Tests (`14-controller-properties.test.mjs`)

These tests use randomized inputs with a simple property-based testing harness (no external library -- just `for` loops with random generators).

**Build artifact dependencies**: None (uses simulated handlers from existing test patterns).

#### D1. AgentMemoryScope Symmetry (3 tests)

```
describe('AgentMemoryScope key symmetry')
  it('scopeKey output always contains the scope type as prefix')                  [P1, simple]
  it('scopeKey output always contains the original key as suffix')                [P1, simple]
  it('scopeKey is deterministic: same inputs always produce same output')         [P1, simple]
```

**Property**: For 100 random `(key, scopeType, scopeId)` tuples:
- `scopeKey(key, type, id)` always starts with `{type}:`
- `scopeKey(key, type, id)` always ends with `:{key}` (or contains key)
- `scopeKey(key, type, id) === scopeKey(key, type, id)` (deterministic)

Note: The request mentioned `unscopeKey(scopeKey(key, type, id))` roundtrip, but the `agent-memory-scope.d.ts` exports do not include an `unscopeKey` function. The simulated handler uses `scopeKey` which formats as `${scope}:${scopeId}:${key}`. Tests verify prefix and suffix properties instead.

#### D2. SolverBandit Convergence (3 tests)

```
describe('SolverBandit convergence properties')
  it('after N rewards to arm A > arm B, A selected more often in 1000 samples')  [P1, complex]
  it('confidence increases monotonically with successive same-arm rewards')       [P2, medium]
  it('bandit with no rewards returns uniform-ish selection across arms')          [P2, medium]
```

**Property for D2.1**: Create two arms. Give arm A reward 0.9 for 50 rounds, arm B reward 0.2 for 50 rounds. Then sample 1000 selections. Arm A should be selected >70% of the time. This verifies the Thompson Sampling Beta distribution converges.

**Property for D2.2**: After each successive reward to the same arm, `getArmStats(arm).alpha / (alpha + beta)` should be >= the previous value (confidence is monotonically non-decreasing for consistent positive rewards).

#### D3. Cold-Start Guard Monotonicity (3 tests)

```
describe('Cold-start guard monotonicity')
  it('once edgeCount >= 5, cold-start should never re-activate')                  [P0, medium]
  it('cold-start guard result is purely a function of edgeCount, not query')      [P1, simple]
  it('cold-start guard at edgeCount=0 always returns warning')                    [P1, simple]
```

**Property for D3.1**: For edge counts [0, 1, 2, 3, 4, 5, 6, 10, 100], verify:
- edgeCount < 5: always cold-start (returns warning, does not call search)
- edgeCount >= 5: always active (calls search, no warning)
- There is no edge count >= 5 that reverts to cold-start

This is a monotonicity check: once the guard transitions from cold-start to active, it never goes back.

---

## 3. Summary Table

| File | Category | Test Count | Build Artifacts Required? | Priority Breakdown |
|------|----------|-----------|--------------------------|-------------------|
| `12-controller-integration.test.mjs` | Integration | 32 | Yes (`/tmp/ruflo-build/`) | P0: 12, P1: 13, P2: 7 |
| `13-controller-chaos.test.mjs` | Chaos / Edge Case | 26 | No (simulated handlers) | P0: 8, P1: 10, P2: 8 |
| Existing files 07, 09, 10 | Regression | 11 | No (simulated handlers) | P0: 3, P1: 6, P2: 2 |
| `14-controller-properties.test.mjs` | Property-Based | 9 | No (simulated handlers) | P0: 1, P1: 6, P2: 2 |
| **Total** | | **78** | | **P0: 24, P1: 35, P2: 19** |

---

## 4. Priority Ordering with Risk Justification

### P0 -- Must Have (24 tests)

These tests catch bugs that would cause **silent data corruption**, **routing failures**, or **cascading system failures**.

| Test | Risk if Missing |
|------|----------------|
| Routing cascade order (A1.1-A1.4, A1.7) | Wrong agent selected for every task |
| Memory scope isolation (A2.1-A2.2) | Agent private data leaks to other agents |
| Learning feedback loop (A3.1) | System never learns; SolverBandit stuck at prior |
| COW write/read/merge isolation (A5.2-A5.5) | Branch data corruption on merge |
| Controller init failure cascade (B2.1) | Single controller bug takes down entire memory |
| Timeout cascade total budget (B3.1-B3.2) | MCP server appears hung (8s+ per route call) |
| Bandit state corruption recovery (B4.1) | Routing crashes after session restore |
| Cold-start boundary at 4 and 5 edges (B5.1-B5.2) | Causal query returns noise or blocks useful data |
| Scope boundary leakage (B6.1-B6.2) | Unscoped search returns private data |
| MutationGuard on store/delete (C3.1-C3.2) | Writes bypass security validation |
| Cold-start monotonicity (D3.1) | Causal query oscillates between active/cold-start |

### P1 -- Should Have (35 tests)

These tests catch **behavioral regressions**, **performance issues**, and **edge cases that affect quality** but not correctness.

| Test | Risk if Missing |
|------|----------------|
| LearningSystem metadata in routing | Debugging routing decisions harder |
| Global scope visibility from agent scope | Cross-agent knowledge sharing broken |
| Bandit convergence | System learns but very slowly |
| Skill creation threshold | Wrong skills created / good skills missed |
| SonaTrajectory recording | Intelligence stats report 0 |
| Concurrent bridge calls | Race conditions in production |
| Init failure at Level 2/3 | Cascading degradation misreported |
| Branch metadata / empty merge | Edge cases in COW lifecycle |
| Regression tests for inline wrappers | Previously-fixed bugs reintroduced |
| Scope key properties | Key format breaks subtly |
| Double-fire prevention | Duplicate learning data |

### P2 -- Nice to Have (19 tests)

These tests cover **observability**, **performance optimization**, and **rare edge cases**.

| Test | Risk if Missing |
|------|----------------|
| Health check initTimeMs | Diagnostics less useful |
| Merge strategy parameter | Feature works but untested |
| Concurrent branch create+merge | Rare operation pattern |
| Memory pressure measurement | Performance regression undetected |
| Lazy loading concerns | Memory overhead in large deployments |
| NaN confidence handling | Exotic corruption scenario |
| Timeout parallelism verification | Performance optimization |
| Bandit uniform selection | Cold-start UX |

---

## 5. Estimated Complexity Per Test

| Complexity | Count | Definition |
|------------|-------|------------|
| Simple | 26 | Single assertion, no async orchestration, <10 lines of test logic |
| Medium | 33 | 2-3 assertions, some async orchestration, mock setup, 10-30 lines |
| Complex | 19 | Multi-step async flows, state tracking across calls, timing assertions, >30 lines |

---

## 6. Implementation Notes

### Test framework

All files use `node:test` with `import { describe, it, beforeEach } from 'node:test'` and `import { strict as assert } from 'node:assert'`. No external test libraries.

### Integration test artifact guard

File 12 must guard against missing build artifacts:

```javascript
import { existsSync } from 'node:fs';
const BUILD_DIR = '/tmp/ruflo-build/v3/@claude-flow';
const hasBuild = existsSync(`${BUILD_DIR}/memory/dist/controller-registry.js`);
```

Each `describe` block that imports from build artifacts should use:
```javascript
describe('...', { skip: !hasBuild ? 'requires build artifacts' : false }, () => { ... });
```

### Mock DB stub pattern for integration tests

Integration tests need a minimal in-memory backend that satisfies `IMemoryBackend`:

```javascript
function createInMemoryBackend() {
  const store = new Map();
  return {
    store: async (ns, key, value, embedding) => {
      store.set(`${ns}:${key}`, { content: value, embedding });
      return { id: `${ns}:${key}`, success: true };
    },
    search: async (ns, query, opts) => {
      const results = [...store.entries()]
        .filter(([k]) => k.startsWith(`${ns}:`))
        .map(([k, v]) => ({ key: k.split(':').slice(1).join(':'), ...v, score: 0.5 }));
      return { results, searchTime: 1 };
    },
    getByKey: async (ns, key) => store.get(`${ns}:${key}`) || null,
    delete: async (ns, key) => store.delete(`${ns}:${key}`),
    // COW stubs
    derive: async (name) => ({ branchId: `branch-${name}`, parentId: 'main' }),
    branchGet: async (branchId, key, ns) => store.get(`${branchId}:${ns || 'default'}:${key}`) || null,
    branchStore: async (branchId, key, value, ns) => {
      store.set(`${branchId}:${ns || 'default'}:${key}`, { content: value });
      return { success: true };
    },
    branchMerge: async (branchId, strategy) => {
      // Copy branch entries to parent
      let merged = 0;
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${branchId}:`)) {
          const parentKey = k.replace(`${branchId}:`, '');
          store.set(parentKey, v);
          merged++;
        }
      }
      return { mergedKeys: merged };
    },
  };
}
```

### Timing tests

Tests that assert on timing (B3, B5.3) should use generous tolerances (e.g., `< 12000ms` not `< 8000ms`) to avoid flakiness on slow CI runners. The important assertion is "finishes at all" not "finishes in exactly N ms".

### Property test randomization

Property tests (file 14) should use a seeded PRNG for reproducibility:

```javascript
function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
```

This ensures failed property tests can be reproduced by re-running with the same seed.

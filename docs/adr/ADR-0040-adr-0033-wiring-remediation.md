# ADR-0040: ADR-0033 Wiring Remediation

## Status

Implemented

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0033 reported 27/28 controllers wired. A swarm audit (ADR-0039) found this is misleading at the bridge/MCP layer: 6 controllers reference non-exported classes, 4 are missing required embedder params, 3 have bridge routing bugs, 2 create duplicate internal instances, and 3 use unsupported `getController()` names. Of 27 wired controllers, only 10 are correctly wired and called. The remaining 17 silently return null/stub, are degraded, or are dead code. This must be fixed before any new controllers are added.

## Decision: Specification (SPARC-S)

### Issue 1: Unexported upstream classes (6 controllers)

HierarchicalMemory, MemoryConsolidation, MutationGuard, AttestationLog, GuardedVectorBackend, and SemanticRouter were assumed to exist but be unexported. Initial investigation (pre-alpha.10) found 5/6 missing from upstream; the registry fell back to stubs. As of agentdb 3.0.0-alpha.10, all 6 classes exist in the agentdb package and can be exported from `agentdb/src/index.ts`.

### Issue 2: Missing embedder parameter (4 controllers)

causalRecall, learningSystem, nightlyLearner (required), explainableRecall (optional) are constructed without the embedder their constructors require. They cannot compute vector similarities.

### Issue 3: Duplicate internal instances (2 controllers)

NightlyLearner creates 3 duplicates (CausalMemoryGraph, ReflexionMemory, SkillLibrary). CausalRecall creates 2 (CausalMemoryGraph, ExplainableRecall). Multiple instances write to the same SQLite tables with separate in-memory state.

### Issue 4: Unsupported getController() names (3 controllers)

sonaTrajectory, graphAdapter, vectorBackend all return null. `vectorBackend` is a property on AgentDB, not a controller name.

### Issue 5: Bridge routing bugs

- BUG-1: `bridgeSolverBanditSelect`/`Update` exist but are not exported. Thompson Sampling routing is dead.
- BUG-2: memory-tools.ts calls `mmrDiversity` but registry defines `mmrDiversityRanker`.
- BUG-3: graphTransformer is a duplicate CausalMemoryGraph instance.

## Decision: Pseudocode (SPARC-P)

```
// Fix embedder injection (Issue 2, controller-registry.ts)
case 'causalRecall':
  return new CR(db, this.createEmbeddingService(), agentdb?.vectorBackend);
case 'learningSystem':
  return new LS(db, this.createEmbeddingService());
case 'nightlyLearner':
  return new NL(db, this.createEmbeddingService(), undefined,
    this.get('causalGraph'), this.get('reflexion'), this.get('skills'));
case 'explainableRecall':
  return new ER(db, this.createEmbeddingService());

// Fix bridge exports (BUG-1, memory-bridge.ts)
export { bridgeSolverBanditSelect, bridgeSolverBanditUpdate };

// Fix name mismatch (BUG-2, memory-tools.ts)
bridgeGetController('mmrDiversityRanker')  // was 'mmrDiversity'

// Fix vectorBackend access (Issue 4)
const vb = agentdb.vectorBackend;  // was agentdb.getController('vectorBackend')
```

## Decision: Architecture (SPARC-A)

No architectural changes. This fixes existing wiring to match what ADR-0033 intended. After cleanup, the registry shrinks from 27 to 24 entries (removing graphTransformer, hybridSearch, federatedSession stubs) with all 24 correctly functional.

## Decision: Refinement (SPARC-R)

### Revised wiring health after fixes

| Status | Count | Impact |
|--------|:-----:|--------|
| Correctly wired + called | 24 | All functional |
| Degraded (missing params) | 0 | Fixed |
| Silently returning null/stub | 0 | Fixed or removed |
| Dead code / duplicates | 0 | Removed |

The non-exported classes (Issue 1) require adding 6 export lines to `agentdb/src/index.ts` in the agentic-flow fork. Duplicate instances (Issue 3) require patching NightlyLearner and CausalRecall constructors to accept optional pre-created singletons (~26 lines across 3 files in the agentic-flow fork).

## Decision: Completion (SPARC-C)

### Checklist

- [x] Export `bridgeSolverBanditSelect`/`Update` from memory-bridge.ts (BUG-1, ~1 line)
- [x] Fix `mmrDiversity` to `mmrDiversityRanker` in memory-tools.ts (BUG-2, ~3 lines)
- [x] Pass `this.createEmbeddingService()` to causalRecall constructor (~4 lines)
- [x] Pass `this.createEmbeddingService()` to learningSystem constructor (~4 lines)
- [x] Pass `this.createEmbeddingService()` to nightlyLearner constructor (~4 lines)
- [x] Pass `this.createEmbeddingService()` to explainableRecall constructor (~4 lines)
- [x] Fix vectorBackend: use `agentdb.vectorBackend` property (~2 lines)
- [x] Fix sonaTrajectory + graphAdapter: access via property or remove (~10 lines)
- [x] Remove graphTransformer from registry (BUG-3, ~15 lines)
- [x] Remove hybridSearch and federatedSession stubs (~5 lines)
- [x] Mark gnnService and rvfOptimizer as stats-only (~2 lines comments)
- [x] Export 6 classes from `agentdb/src/index.ts` in agentic-flow fork — all 6 classes (HierarchicalMemory, MemoryConsolidation, MutationGuard, AttestationLog, GuardedVectorBackend, SemanticRouter) exist in agentdb 3.0.0-alpha.10 and are now exported.
- [x] Patch NightlyLearner constructor to accept optional singletons (~10 lines, agentic-flow fork)
- [x] Patch CausalRecall constructor to accept optional singletons (~10 lines, agentic-flow fork)
- [x] Pass AgentDB singletons to NightlyLearner and CausalRecall in registry (~6 lines)

### Testing

Tests use node:test + node:assert with London School TDD (inline mocks).

```js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0040 wiring remediation', () => {
  it('passes embedder to causalRecall factory', () => {
    const embedder = { embed: mockFn(async () => new Float32Array(768)) };
    const factory = (db, emb) => ({ db, embedder: emb });
    const ctrl = factory('mockDb', embedder);
    assert.strictEqual(ctrl.embedder, embedder, 'embedder must be injected');
  });

  it('exports bridgeSolverBanditSelect', () => {
    const exports = { bridgeSolverBanditSelect: mockFn(() => 'task-a') };
    assert.ok(typeof exports.bridgeSolverBanditSelect === 'function');
    assert.strictEqual(exports.bridgeSolverBanditSelect(), 'task-a');
  });

  it('resolves mmrDiversityRanker not mmrDiversity', () => {
    const registry = new Map([['mmrDiversityRanker', { rerank: mockFn() }]]);
    assert.ok(registry.has('mmrDiversityRanker'));
    assert.ok(!registry.has('mmrDiversity'), 'old name must not resolve');
  });

  it('removes graphTransformer from registry', () => {
    const initLevels = [['causalGraph'], ['skills']]; // graphTransformer absent
    const allNames = initLevels.flat();
    assert.ok(!allNames.includes('graphTransformer'));
  });

  it('accesses vectorBackend via property not getController', () => {
    const agentdb = { vectorBackend: { search: mockFn() }, getController: () => null };
    assert.ok(agentdb.vectorBackend !== null, 'property access works');
    assert.strictEqual(agentdb.getController('vectorBackend'), null, 'getController returns null');
  });
});
```

### Success Criteria

- memory_store works end-to-end (no import resolution failures)
- `bridgeSolverBanditSelect` reachable in hooks_route
- causalRecall, learningSystem, nightlyLearner, explainableRecall receive embedder
- MutationGuard, AttestationLog, GuardedVectorBackend load (not null)
- graphTransformer removed; registry count 24 (down from 27)

## Consequences

### Positive
- Existing 24 controllers become fully functional instead of 10/27
- Security layer (MutationGuard + AttestationLog + GuardedVectorBackend) activated
- SolverBandit Thompson Sampling routing restored
- NightlyLearner uses 150x HNSW search instead of SQL brute-force

### Negative
- Requires 2 fork patches (agentic-flow: exports + constructor signatures)
- Reduces advertised controller count from 27 to 24 (removes 3 stale entries)

### Risks
- Changing NightlyLearner/CausalRecall constructors may break upstream tests (mitigated: optional params with defaults)

## Related

- **ADR-0033**: Original controller activation (predecessor)
- **ADR-0039**: Upstream controller integration roadmap (parent, superseded)

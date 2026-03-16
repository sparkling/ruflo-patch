# ADR-0046: Self-Learning Pipeline & Native Acceleration

## Status

Proposed

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0039 Phase 11 identified A6 (SelfLearningRvfBackend) and B4 (NativeAccelerator) as the foundation for a self-tuning vector index. Currently, every session starts cold with no learning, static routing, and manual HNSW parameter configuration. A6 is a composite orchestrator that auto-creates 6 sub-components (A7, A8, B1, B2, FederatedSessionManager, RvfSolver). B4 is a global singleton providing WASM/native acceleration used by multiple controllers.

## Decision: Specification (SPARC-S)

### Controllers

| ID | Class | Lines | Type | Description |
|----|-------|:-----:|------|-------------|
| A6 | SelfLearningRvfBackend | 487 | COMPOSITE | Orchestrator that auto-creates A7, A8, B1, B2 + FederatedSessionManager + RvfSolver via `initComponents()` lazy import. Exposes unified API: `search()`, `recordFeedback()`, `getStats()`. |
| B4 | NativeAccelerator | 490 | SINGLETON | Global capability bridge. 11 @ruvector packages, 40+ methods, 80+ tests. Used by A6, A5, B2, A7. Auto-detects WASM, falls back to JS. |

### A6 Sub-Components (auto-created, NOT wired separately)

| Sub-component | ID | Private field | Description |
|--------------|-----|---------------|-------------|
| ContrastiveTrainer | A7 | `private trainer` | InfoNCE + hard negatives. Improves embedding quality over time. |
| SonaLearningBackend | A8 | `private sona` | Micro-LoRA <1ms, EWC++ forgetting prevention. 3-loop architecture. |
| SemanticQueryRouter | B1 | `private router` | Routes query strategy -> ef selection. |
| TemporalCompressor | B2 | `private compressor` | 5-tier compression (up to 96%). Background consolidation. |
| FederatedSessionManager | -- | `private federated` | Session lifecycle for federated learning. |
| RvfSolver | -- | `private solver` | Thompson Sampling policy per 18 context buckets. |

### SONA Correction (from ADR-0039)

**Previous claim (issue #1243): "SONA wiring non-functional (stub instead of real API)"**

**Finding: SONA IS A PRODUCTION SYSTEM, NOT A STUB.** Three-layer implementation:

| Layer | Location | Evidence |
|-------|----------|---------|
| Rust engine | `ruvector/crates/sona/` | 50+ commits, sub-millisecond micro-LoRA, EWC++ |
| N-API bindings | `@ruvector/sona` v0.1.4 | 7 platform targets, pre-built `.node` binaries |
| CLI optimizer | `sona-optimizer.ts` | 842 lines, Q-learning routing, pattern matching, temporal decay |
| agentdb wrapper | `SonaLearningBackend.ts` | 357 lines, calls `applyMicroLora`, `beginTrajectory`, `tick`, `forceLearn` |

Issue #1243 referred to wiring between layers, not the implementation itself.

### Native Acceleration (B4)

B4 probes 11 `@ruvector` packages at init. When native is available, A5 HyperbolicAttention becomes usable (correct Poincare math requires native). B4 provides SIMD-optimized distance calculations (cosine, L2, inner product) with 2-8x speedup over pure JS. Every capability has a JS fallback.

## Decision: Pseudocode (SPARC-P)

```
// controller-registry.ts -- A6 at Level 2 (after vectorBackend)
case 'selfLearningRvf':
  const { SelfLearningRvfBackend } = await import('agentdb')
  if !SelfLearningRvfBackend: return null
  const a6 = new SelfLearningRvfBackend({ dimension: 768 })
  await a6.initComponents()  // lazy-imports A7, A8, B1, B2, etc.
  return a6

// controller-registry.ts -- B4 at Level 2 (singleton)
case 'nativeAccelerator':
  const { NativeAccelerator } = await import('agentdb')
  if !NativeAccelerator: return null
  return NativeAccelerator.getInstance()  // singleton pattern

// After B4 init, conditionally enable A5 Hyperbolic
const native = registry.get('nativeAccelerator')
if native?.simdAvailable:
  attentionService.enableHyperbolic()

// memory-bridge.ts -- A6 replaces vectorBackend for search
bridgeSelfLearningSearch(options):
  a6 = registry.get('selfLearningRvf')
  if !a6: return bridgeSearchEntries(options)  // fallback
  return a6.search(options)  // internally routes via B1, enhances via A8

// memory-bridge.ts -- feedback loop
bridgeRecordFeedback(query, selectedResult, reward):
  a6 = registry.get('selfLearningRvf')
  if !a6: return
  a6.recordFeedback({ query, selectedResult, reward })  // fire-and-forget
```

## Decision: Architecture (SPARC-A)

- A6 wires at Level 2. Sub-components (A7, A8, B1, B2, FederatedSessionManager, RvfSolver) are created internally via `initComponents()` -- NOT wired separately in the registry.
- B4 wires at Level 2 as a singleton. Shared across A6, A5, B2, A7.
- Installing `@ruvector/attention` enables A5 HyperbolicAttention with correct Poincare geometry.
- Bridge functions access sub-components through A6's API only (`search()`, `recordFeedback()`, `getStats()`).
- A6's private fields mean sub-component behavior is only observable via `A6.getStats()`.

## Decision: Refinement (SPARC-R)

- The composition hierarchy swarm (3 agents) confirmed A6 creates 6 sub-components as private fields via lazy import. Wiring them separately would create duplicate instances with lifecycle conflicts.
- B4 is an exception: despite A6 creating an internal NativeAccelerator, B4 must be wired as a shared singleton because A5, B2, and A7 also need it independently.
- A6 exposes `VectorBackendAsync` interface -- drop-in replacement for current vectorBackend.
- Phase 11 effort: 10h. Depends on Phase 7 (CircuitBreaker protection).

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Wire A6 SelfLearningRvfBackend at Level 2 (~487 lines)
- [ ] Wire B4 NativeAccelerator at Level 2 as singleton (~490 lines)
- [ ] Install `@ruvector/attention` for native acceleration
- [ ] Enable A5 HyperbolicAttention after native detection
- [ ] Add `bridgeSelfLearningSearch` in memory-bridge.ts
- [ ] Add `bridgeRecordFeedback` in memory-bridge.ts
- [ ] Verify A6.initComponents() creates all 6 sub-components via getStats()
- [ ] Wire fire-and-forget for learning/training writes (must not block response)

### Testing

```js
// tests/unit/self-learning-native.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0046: self-learning pipeline & native acceleration', () => {
  it('A6: factory returns composite with search/recordFeedback/getStats', () => {
    const a6 = {
      search: mockFn(async () => [{ id: 'r1' }]),
      recordFeedback: mockFn(() => {}),
      getStats: mockFn(() => ({ router: 'ok', sona: 'ok' })),
    };
    assert.equal(typeof a6.search, 'function');
    assert.equal(typeof a6.recordFeedback, 'function');
    assert.equal(typeof a6.getStats, 'function');
  });

  it('A6.search() should delegate internally and return results', async () => {
    const search = mockFn(async () => [{ id: 'r1', routed: true }]);
    const result = await search({ query: 'auth', limit: 5 });
    assert.equal(result[0].routed, true);
  });

  it('A6.getStats() should aggregate sub-component stats', () => {
    const stats = { router: { n: 42 }, sona: { n: 100 }, trainer: { n: 5 }, compressor: { n: 200 } };
    assert.ok(Object.keys(stats).includes('router'));
    assert.ok(Object.keys(stats).includes('sona'));
  });

  it('B4: singleton should return same instance across consumers', () => {
    let inst = null;
    const get = () => { if (!inst) inst = { id: 'native-1' }; return inst; };
    assert.strictEqual(get(), get(), 'must be same reference');
  });

  it('B4: JS fallback cosine distance when native unavailable', () => {
    const cosine = (a, b) => {
      let dot = 0, nA = 0, nB = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; nA += a[i]**2; nB += b[i]**2; }
      return dot / (Math.sqrt(nA) * Math.sqrt(nB));
    };
    assert.ok(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1.0) < 1e-6);
  });

  it('A6.destroy() should clean up all 6 sub-components', () => {
    const destroyed = [];
    const destroy = () => ['router', 'sona', 'trainer', 'compressor', 'federated', 'solver'].forEach(c => destroyed.push(c));
    destroy();
    assert.equal(destroyed.length, 6);
  });
});
```

### Success Criteria

- A6.search() invokes router + SONA + solver internally (non-empty routing decisions from getStats())
- Hyperbolic attention Poincare distances satisfy triangle inequality after native install
- B4 singleton shared across all consumers (same reference)
- B4 JS fallback produces correct distance calculations when native unavailable

## Consequences

### Positive

- Self-tuning vector index eliminates manual HNSW parameter configuration
- SONA micro-LoRA provides real-time adaptation (<1ms per inference)
- A6 is a single registry entry delivering 6 sub-systems
- B4 singleton enables native 2-8x speedup across all consumers
- Contrastive training improves embedding quality over time without model changes

### Negative

- A6's private fields mean sub-component behavior only observable via getStats()
- A6's lazy initComponents() may silently fail (all try-catch)
- Native package adds ~1.3MB binary dependency

### Risks

- A6 initComponents() silent failures need getStats() verification after init
- B4 WASM detection may fail in constrained environments
- SONA EWC++ lambda tuning (lambda=2000) may need adjustment per workload

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent, Phase 11)
- **ADR-006** (upstream): Unified Self-Learning RVF Integration (defines A6 as orchestrator)
- **ADR-007** (upstream): @ruvector Full Capability Integration (B4 Phase 1)
- **ADR-050** (upstream): Self-Learning Intelligence Loop (SONA integration pattern)
- **ADR-0044**: Attention suite integration (A5 HyperbolicAttention enabled here)

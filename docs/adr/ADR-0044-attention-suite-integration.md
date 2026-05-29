# ADR-0044: Attention Suite Integration

## Status

Implemented

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0039 Phase 9 identified 5 attention controllers (A1-A3, A5) and 1 metrics collector (D2) as high-value candidates. Currently, search returns results ranked solely by vector cosine distance. Attention re-ranking allows the system to discover inter-memory relevance (self-attention), cross-namespace alignment (cross-attention), and multi-perspective scoring (multi-head). A5 adds 4 advanced mechanisms with JS fallbacks and optional native acceleration.

## Decision: Specification (SPARC-S)

### Controllers

| ID | Class | Lines | Type | Description |
|----|-------|:-----:|------|-------------|
| A1 | SelfAttentionController | 306 | Leaf (pure JS) | Scaled dot-product attention. Identifies which memories are relevant to each other. Search re-ranker. |
| A2 | CrossAttentionController | 467 | Leaf (pure JS) | Multi-namespace cross-attention. 3 aggregation strategies. Query acts as Q, stored memories as K/V. |
| A3 | MultiHeadAttentionController | 494 | Leaf (pure JS) | Parallel heads with Xavier projections. 4 aggregation modes. Subsumes A1 in theory. |
| A5 | AttentionService | 1500+ | Leaf (JS + native) | 4 mechanisms: FlashAttention, MoEAttention, GraphRoPE, HyperbolicAttention. Two files: services/ (full) and controllers/ (771-line facade). |
| D2 | AttentionMetricsCollector | 254 | Leaf | Per-mechanism latency percentiles, head utilization, sparsity ratio. Currently orphaned. |

### A5 Mechanism Status

| Mechanism | JS Fallback | Math Correct? | Native on npm? |
|-----------|:-----------:|:-------------:|:--------------:|
| FlashAttention | Tiled block-wise + online softmax | Yes (Tri et al. 2022 simplified) | Yes |
| MoEAttention | 8-domain expert routing + softmax | Yes | Yes |
| GraphRoPE | Hop-distance-aware positional encoding | No -- 3 bugs (~15 lines to fix) | NAPI only |
| HyperbolicAttention | Crude scaling approximation | No -- needs native for correct Poincare math | Yes |

### Key Relationships

- A1-A3 are interchangeable alternatives that stack (different perspectives). A3 subsumes A1 in theory.
- A5 is NOT a replacement for A1-A3 -- different pipeline stages. A1-A3 re-rank after vector search; A5 provides FlashAttention for consolidation, MoE for expert routing, GraphRoPE for hop-aware recall.
- Native bindings: `@ruvector/attention@0.1.31`, 7 platforms, 1.3MB Linux x64 binary.
- 1,628 lines of upstream tests, 3 production callers (CausalMemoryGraph, NightlyLearner, ExplainableRecall), 4 MCP tools.

## Decision: Pseudocode (SPARC-P)

```
// controller-registry.ts -- Level 2 (after vectorBackend)
INIT_LEVELS[2].push('selfAttention', 'crossAttention', 'multiHeadAttention', 'attentionService');

// A1-A3 createController (pure JS, no native deps)
case 'selfAttention':
  return new SelfAttentionController({ dimension: 768 }) || null
case 'crossAttention':
  return new CrossAttentionController({ dimension: 768 }) || null
case 'multiHeadAttention':
  return new MultiHeadAttentionController({ dimension: 768, numHeads: 8 }) || null

// A5 createController (4 mechanisms, JS fallbacks + optional native)
case 'attentionService':
  return new AttentionService({
    flash:      { enabled: true,  blockSize: 256 },
    moe:        { enabled: true,  numExperts: 8, topK: 2 },
    graphRoPE:  { enabled: true,  maxHops: 10 },
    hyperbolic: { enabled: false },  // Enable in Phase 11 after native install
  })

// memory-bridge.ts -- bridge functions
bridgeAttentionSearch(options):
  multiHead = registry.get('multiHeadAttention')
  if !multiHead: return null  // fallback to existing pipeline
  vectorResults = bridgeSearchEntries(options)
  attended = multiHead.attend(vectorResults.results, { topK: options.limit })
  return { ...vectorResults, results: attended, attention: true }

bridgeFlashConsolidate(entries):
  attn = registry.get('attentionService')
  if !attn: return bridgeConsolidate(entries)  // fallback
  return attn.flashAttention(entries, { blockSize: 256 })

bridgeMoERoute(task, candidates):
  attn = registry.get('attentionService')
  if !attn: return null
  return attn.moeAttention(task, candidates, { topK: 2 })

bridgeGraphRoPESearch(query, hopDistances):
  attn = registry.get('attentionService')
  if !attn: return null
  return attn.graphRoPE(query, { hopDistances, maxHops: 10 })
```

### GraphRoPE JS Fix (3 bugs, ~15 lines)

1. Line ~1195: Replace `hopDistances[i]?.[j] || 0` average with per-pair `hopDistances[i][j]`
2. Line ~1203: Replace `keyPosition = j` (array index) with `hopDistances[0][j]` graph-derived position
3. Line ~1178: Replace shared `avgHop * freq` with per-pair `hopDistances[i][j] * freq`

## Decision: Architecture (SPARC-A)

- A1, A2, A3 wire at Level 2 as standalone leaf controllers.
- A5 wires at Level 2. HyperbolicAttention disabled until Phase 11 native install.
- D2 wires at Level 4 (depends on A1-A3 and A5 being active).
- Bridge functions provide fallback to existing pipeline when attention controllers return null.
- All new controllers wrapped by CircuitBreaker (Phase 7 prerequisite) with try-catch + 2s timeout.

## Decision: Refinement (SPARC-R)

- The A5 Deep Analysis swarm (3 agents) reversed the initial DEFER recommendation: FlashAttention and MoE JS fallbacks are real tested algorithms, not mocks. 1,628 lines of tests validate real outputs.
- The "completely broken" comment in `attention-fallbacks.ts` refers to native binding wiring, not the algorithms.
- A1-A3 are pure JS with no gates -- always available (306-494 lines each).
- Phase 9 effort: 20h. Depends on Phase 8 (MetadataFilter + QueryOptimizer).

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Wire A1 SelfAttentionController at Level 2 (~306 lines)
- [ ] Wire A2 CrossAttentionController at Level 2 (~467 lines)
- [ ] Wire A3 MultiHeadAttentionController at Level 2 (~494 lines)
- [ ] Wire A5 AttentionService at Level 2 (~1500 lines, Flash+MoE+GraphRoPE enabled)
- [ ] Wire D2 AttentionMetricsCollector at Level 4 (~254 lines)
- [ ] Add `bridgeAttentionSearch` in memory-bridge.ts
- [ ] Add `bridgeFlashConsolidate` in memory-bridge.ts
- [ ] Add `bridgeMoERoute` in memory-bridge.ts
- [ ] Add `bridgeGraphRoPESearch` in memory-bridge.ts
- [ ] Patch GraphRoPE JS fallback (3 bugs, ~15 lines)
- [ ] Register 4 MCP tools for A5 (compute, benchmark, configure, metrics)
- [ ] Wire D2 to collect metrics from A1-A3 and A5

### Testing

```js
// tests/unit/attention-suite.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0044: attention suite', () => {
  it('A1: should produce weight matrix from input entries', () => {
    const attend = mockFn((entries) => entries.map((e, i) => ({ ...e, weight: 1 / (i + 1) })));
    const result = attend([{ id: 'a' }, { id: 'b' }]);
    assert.ok(result[0].weight > result[1].weight);
  });

  it('A2: should align query with memory entries across namespaces', () => {
    const cross = mockFn((q, mems) => mems.map(m => ({ ...m, alignment: q.length > 0 ? 0.8 : 0 })));
    const result = cross('auth patterns', [{ ns: 'patterns' }, { ns: 'incidents' }]);
    assert.equal(result[0].alignment, 0.8);
  });

  it('A3: should return composite scores from multiple heads', () => {
    const composite = [0.9, 0.7, 0.5, 0.8].reduce((a, b) => a + b, 0) / 4;
    assert.ok(composite > 0.5 && composite < 1.0);
  });

  it('A5 Flash: should produce numerically stable softmax', () => {
    const scores = [2.1, 3.5, 1.0];
    const max = Math.max(...scores);
    const stable = scores.map(s => Math.exp(s - max));
    const sum = stable.reduce((a, b) => a + b, 0);
    const result = stable.map(s => s / sum);
    assert.ok(Math.abs(result.reduce((a, b) => a + b, 0) - 1.0) < 1e-6);
  });

  it('A5 MoE: should return non-uniform expert weights', () => {
    const weights = [0.4, 0.3, 0.15, 0.08, 0.04, 0.02, 0.005, 0.005];
    assert.ok(weights.some(w => Math.abs(w - 0.125) > 0.01));
  });

  it('A5 GraphRoPE: closer hops should get higher weights', () => {
    const hopToWeight = (hop) => 1 / (1 + hop);
    assert.ok(hopToWeight(1) > hopToWeight(3));
  });

  it('D2: should collect per-mechanism latency', () => {
    const metrics = { flash: [12], moe: [45] };
    assert.equal(metrics.flash.length, 1);
    assert.equal(metrics.moe[0], 45);
  });

  it('regression: null attention returns unchanged results', () => {
    const search = mockFn(() => [{ id: '1', score: 0.9 }, { id: '2', score: 0.7 }]);
    const results = null ? null : search('query');
    assert.equal(results.length, 2);
    assert.equal(results[0].id, '1');
  });
});
```

### Testing Guidance

**Unit test file**: `tests/unit/adr-0044-attention-suite.test.mjs`

**Unit test strategy** (London School TDD with inline mocks):
- Use the `mockFn` pattern established in ADR-0042 for all test doubles
- Test A1 SelfAttentionController factory: verify constructor accepts `{ dimension }`, `attend()` method signature, output shape matches input length with added weight fields
- Test A2 CrossAttentionController factory: verify constructor accepts `{ dimension }`, `attend(query, memories)` method signature, 3 aggregation strategies return different rankings
- Test A3 MultiHeadAttentionController factory: verify constructor accepts `{ dimension, numHeads }`, composite scores from multiple heads, 4 aggregation modes produce distinct outputs
- Test A5 AttentionService factory: verify constructor accepts mechanism config (flash, moe, graphRoPE, hyperbolic), each mechanism independently toggleable, disabled mechanism returns null
- Test D2 AttentionMetricsCollector factory: verify `collect()` accepts mechanism name + latency, `getMetrics()` returns per-mechanism percentiles
- Edge cases: null attention controller (bridge returns unchanged vector results), empty entry list to `attend()`, single-entry input (no reordering possible), `numHeads=1` (degenerates to single attention)
- Degraded mode: all attention controllers null -- `bridgeAttentionSearch` must fall back to existing pipeline; A5 with all mechanisms disabled must return null; D2 with no data collected must return empty metrics
- State transitions: D2 metrics accumulate across calls; A5 mechanism enable/disable at runtime

**Acceptance test strategy**:
- A1-A3 attention controllers: may need new MCP tools (`agentdb_attention_search` or similar). If no dedicated tool exists, these are internal-only and tested only at unit level
- A5 AttentionService: testable if wired to MCP tools (compute, benchmark, configure, metrics). Assert structured response with mechanism-specific fields, not string presence
- D2 AttentionMetricsCollector: testable via `agentdb_health` if health response includes attention metrics section. Assert `attention` key exists with per-mechanism latency fields
- No fallback success paths -- if an attention MCP tool returns an error, the test must fail

**What is impractical at acceptance level**:
- Verifying >20% result reordering (requires seeded vector data with known cosine distances)
- FlashAttention O(N) memory verification (requires 10K+ entries and memory profiling)
- GraphRoPE hop-distance correctness (requires a pre-built causal graph with known hop distances)
- Multi-head Xavier projection weight initialization (internal numerical detail)
- A5 HyperbolicAttention (disabled until Phase 11 native install)

**Test cascade**:
- A1-A3 or A5 factory wiring in fork TS: `npm run test:unit`
- New attention MCP tools (compute, benchmark, configure, metrics): `npm run deploy` (full acceptance)
- D2 metrics surfaced in health endpoint: `npm run deploy` (full acceptance)
- GraphRoPE JS bugfix (3 bugs, ~15 lines): `npm run test:unit`

### Success Criteria

- Attention-weighted search returns different top-5 than vector-only (>20% result reordering)
- FlashAttention consolidation for 10K entries completes in <2s, O(N) memory
- GraphRoPE (patched) produces higher attention weights for closer hops
- D2 reports per-mechanism latency percentiles and head utilization

## Consequences

### Positive

- Search results ranked by actual relevance, not just vector distance
- FlashAttention enables O(N) memory consolidation instead of O(N^2)
- MoE provides domain-aware expert routing for task assignment
- GraphRoPE adds hop-distance awareness to causal recall

### Negative

- 20h integration effort across A1-A3, A5, D2
- HyperbolicAttention deferred until native install (Phase 11)
- GraphRoPE requires ~15-line patch before use

### Risks

- FlashAttention JS is simplified (not full Tri et al. 2022) -- block size tuning needed
- A5 HyperbolicAttention JS approximation uses crude scaling, not real Poincare geometry
- Two AttentionService files (services/ 1500+ lines, controllers/ 771 lines) must be imported correctly

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent)
- **ADR-0033**: Complete AgentDB v3 controller activation (predecessor)
- **ADR-028** (upstream): 39 Attention Mechanism Types; A5 implements 4 of 39

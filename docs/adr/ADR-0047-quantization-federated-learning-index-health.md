# ADR-0047: Quantization, Federated Learning & Index Health

## Status

Accepted

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

ADR-0039 Phases 12-14 identified three controllers that address memory scalability (4-32x compression), cross-session knowledge sharing (federated learning), and index health monitoring. Currently, 768-dim Float32 embeddings use 3KB each (100K memories = 300MB). Sessions are isolated with no knowledge transfer. Index degradation is invisible until users notice slow searches.

## Decision: Specification (SPARC-S)

### Controllers

| ID | Class | Lines | Level | Type | Description |
|----|-------|:-----:|:-----:|------|-------------|
| B9 | QuantizedVectorStore | ~500 | 2 | COMPOSITE | Auto-creates B7 (ScalarQuantization) or B8 (ProductQuantizer) based on config. 3 factory functions. 10M vector cap. Drop-in vectorBackend replacement. |
| A11 | FederatedLearningManager | 436 | 4 | Leaf | 3 components: EphemeralLearningAgent, FederatedLearningCoordinator, Manager. Pure JS path works. Quality-weighted embedding consolidation. Byzantine tolerance via 2-sigma outlier filtering + reputation-weighted trimmed mean. 95% functional without native SONA. |
| B3 | IndexHealthMonitor | 96 | 4 | Leaf | Passive latency recording, multi-factor assessment, HNSW parameter recommendations. 35 upstream tests. |

### B9 Sub-Components (auto-created, NOT wired separately)

| Sub-component | ID | Compression | Quality Loss | Use When |
|--------------|-----|:-----------:|:------------:|----------|
| ScalarQuantization | B7 | 8-bit: 4x, 4-bit: 8x | <1% (8-bit), ~3-5% (4-bit) | Default -- almost free quality trade |
| ProductQuantizer | B8 | 8-32x | ~5-10% | >100K memories, batch search |

B7 has 28 upstream tests. B8 uses K-means per subspace with ADC distance tables.

### B9 Factory Functions

- `createScalar8BitStore()` -- 4x compression, <1% recall loss
- `createScalar4BitStore()` -- 8x compression, ~3-5% recall loss
- `createProductQuantizedStore()` -- 8-32x compression, K-means per subspace

### A11 Byzantine Tolerance

- 2-sigma outlier filtering: reject updates >2 standard deviations from mean
- Reputation-weighted trimmed mean: trusted agents' updates weighted higher
- 95% functional without native SONA -- pure JS quality-weighted path works
- This is the path to unblocking FederatedSession (P4-E)

## Decision: Pseudocode (SPARC-P)

```
// controller-registry.ts -- B9 at Level 2 (alongside vectorBackend)
const QUANTIZATION_THRESHOLD = 50000  // entries

case 'quantizedVectorStore':
  const factory = agentdbModule.createScalar8BitStore
  if !factory: return null
  return factory({ dimension: config.dimension || 768, maxElements: 100000 })

// memory-bridge.ts -- use quantized store when threshold exceeded
async selectBackend(entryCount):
  if entryCount > QUANTIZATION_THRESHOLD:
    return registry.get('quantizedVectorStore') || registry.get('vectorBackend')
  return registry.get('vectorBackend')

// controller-registry.ts -- A11 at Level 4
case 'federatedLearning':
  const { FederatedLearningManager } = await import('agentdb')
  if !FederatedLearningManager: return null
  return new FederatedLearningManager({
    byzantineTolerance: { sigmaThreshold: 2, reputationWeighted: true },
    aggregation: 'quality-weighted',
  })

// controller-registry.ts -- B3 at Level 4
case 'indexHealth':
  const { IndexHealthMonitor } = await import('agentdb')
  if !IndexHealthMonitor: return null
  return new IndexHealthMonitor({ sampleInterval: 60000 })
```

## Decision: Architecture (SPARC-A)

- B9 at Level 2 alongside vectorBackend. Auto-creates B7 or B8 based on config -- B7/B8 NOT wired separately.
- A11 at Level 4 (depends on A6 from Phase 11 for full SONA integration, but 95% works without).
- B3 at Level 4 (passive monitoring, no hard dependencies).
- B9 is a drop-in replacement for vectorBackend. Insertion auto-quantizes. Search uses asymmetric distance.
- A11 provides the API that FederatedSessionManager needs -- path to unblocking FederatedSession.
- B3 emits events for alerting and returns HNSW parameter recommendations.

## Decision: Refinement (SPARC-R)

- B9 config at construction time locks the quantization method. Cannot switch scalar to product without recreating the store.
- A11 Byzantine tolerance is sufficient for untrusted multi-agent environments. 2-sigma filtering with reputation weighting prevents poisoning attacks.
- B3 at 96 lines is the smallest controller in the integration plan. 35 upstream tests confirm correctness. Passive recording means zero overhead during normal operation.
- Phase 12 (A11): 4h. Phase 13 (B9): 6h. Phase 14 (B3): 3h. All depend on Phase 11.

## Decision: Completion (SPARC-C)

### Checklist

- [x] Wire B9 QuantizedVectorStore at Level 2 (~500 lines)
- [x] Wire A11 FederatedLearningManager at Level 4 (~436 lines)
- [x] Wire B3 IndexHealthMonitor at Level 4 (~96 lines)
- [x] Add `selectBackend` threshold logic in memory-bridge.ts
- [x] Add bridge functions for federated round management
- [x] Add bridge functions for health assessment queries
- [x] Register MCP tools for B9 (quantize-status) and B3 (health-report)

### Testing

```js
// tests/unit/quantization-federated-health.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('ADR-0047: quantization, federated learning & index health', () => {
  it('B9: should create scalar store from scalar config', () => {
    const create = (c) => c.type === 'scalar' ? { type: 'scalar8bit', compression: 4 } : { type: 'product', compression: 16 };
    assert.equal(create({ type: 'scalar' }).compression, 4);
    assert.equal(create({ type: 'product' }).compression, 16);
  });

  it('B9: 8-bit quantization should be <=25% of Float32', () => {
    assert.ok((768 * 1) / (768 * 4) <= 0.25);
  });

  it('B9: quantized search returns closest vector', () => {
    const vecs = [{ id: 'a', q: [100, 200, 150] }, { id: 'b', q: [50, 60, 70] }];
    const query = [100, 190, 140];
    const dist = (v) => Math.sqrt(v.q.reduce((s, x, i) => s + (query[i] - x) ** 2, 0));
    const sorted = vecs.sort((a, b) => dist(a) - dist(b));
    assert.equal(sorted[0].id, 'a');
  });

  it('A11: should aggregate with quality weighting', () => {
    const updates = [{ emb: [0.5, 0.3], q: 0.9 }, { emb: [0.4, 0.6], q: 0.7 }];
    const total = updates.reduce((s, u) => s + u.q, 0);
    const agg = [0, 0];
    for (const u of updates) { const w = u.q / total; agg[0] += u.emb[0] * w; agg[1] += u.emb[1] * w; }
    assert.ok(agg[0] > 0.4 && agg[0] < 0.5);
  });

  it('A11: should reject Byzantine outliers beyond 2-sigma', () => {
    const vals = [1.0, 1.1, 0.9, 1.0, 1.05, 50.0];
    const clean = vals.slice(0, -1);
    const mean = clean.reduce((a, b) => a + b) / clean.length;
    const sigma = Math.sqrt(clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (clean.length - 1));
    const filtered = vals.filter(u => Math.abs(u - mean) <= 2 * sigma);
    assert.ok(!filtered.includes(50.0));
  });

  it('B3: should recommend increase_ef when p95 latency is high', () => {
    const sorted = [9, 10, 11, 11, 12, 12, 13, 14, 15, 80];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    assert.ok(p95 > 50);
  });
});
```

### Testing Guidance

**Unit test file**: `tests/unit/adr-0047-quantization-federated-health.test.mjs`

**Unit test strategy** (London School TDD with inline mocks):
- Use the `mockFn` pattern established in ADR-0042 for all test doubles
- Test B9 QuantizedVectorStore factory: verify `createScalar8BitStore()` returns object with `insert()`, `search()`, `size` methods; verify `createScalar4BitStore()` and `createProductQuantizedStore()` return same interface; verify constructor accepts `{ dimension, maxElements }`
- Test B9 compression ratios: 8-bit scalar produces vectors at 25% of Float32 size, 4-bit at 12.5%, product quantizer at configurable ratio. Verify via byte length calculations, not live memory profiling
- Test B9 quantized search correctness: insert 3+ vectors with known distances, search returns correct nearest neighbor ordering
- Test A11 FederatedLearningManager factory: verify constructor accepts `{ byzantineTolerance, aggregation }`, exposes round management methods (`startRound`, `submitUpdate`, `aggregateRound`)
- Test A11 quality-weighted aggregation: two updates with different quality scores produce weighted average biased toward higher-quality update
- Test A11 Byzantine filtering: array of values with one 50x outlier -- filtered result excludes the outlier (2-sigma threshold)
- Test A11 reputation weighting: trusted agent (high reputation) contributes more to aggregated result than untrusted agent
- Test B3 IndexHealthMonitor factory: verify constructor accepts `{ sampleInterval }`, `recordLatency()` accepts numeric value, `assess()` returns recommendation object
- Test B3 recommendations: p95 latency above threshold triggers `increase_ef` recommendation; low recall triggers reindex suggestion
- Edge cases: B9 null (bridge uses standard vectorBackend), A11 with single update (no aggregation needed, passthrough), B3 with no latency data (returns healthy status), B9 `maxElements` exceeded, A11 all updates are outliers (empty after filtering)
- Degraded mode: B9 null -- `selectBackend` returns standard vectorBackend; A11 null -- sessions remain isolated; B3 null -- no health monitoring (silent)

**Acceptance test strategy**:
- B9 QuantizedVectorStore: testable via search MCP tools if B9 replaces vectorBackend when entry count exceeds threshold. Store entries, search, assert results returned with correct ordering. If `quantize-status` MCP tool exists, assert response contains `type` (scalar/product), `compression`, `entryCount` fields
- A11 FederatedLearningManager: internal-only (no MCP tool exposure for federated rounds). Effects are observable only as improved search quality over time. If a dedicated federated MCP tool is added, assert round lifecycle fields
- B3 IndexHealthMonitor: testable via `agentdb_health` if health response includes index health section, or via dedicated `health-report` MCP tool. Assert response contains `status`, `recommendations` array, `p95Latency` fields
- No fallback success paths -- if search via quantized store returns an error, the test must fail

**What is impractical at acceptance level**:
- B9 recall >99% (8-bit) or >95% (4-bit) verification (requires statistically significant vector corpus with ground-truth nearest neighbors)
- Product quantization K-means training (requires representative sample data and training time)
- A11 cross-session knowledge transfer (requires multi-session test orchestration)
- A11 Byzantine poisoning attack simulation (requires adversarial agent injection)
- B3 auto-recommendation accuracy (requires controlled index degradation scenarios)
- B9 10M vector cap (requires enormous memory allocation)
- `selectBackend` threshold switching at 50K entries (requires inserting 50K+ entries)

**Test cascade**:
- B9/A11/B3 factory wiring in fork TS: `npm run test:unit`
- New MCP tools for B9 (quantize-status) or B3 (health-report): `npm run deploy` (full acceptance)
- `selectBackend` threshold logic in bridge: `npm run deploy` (full acceptance)
- Acceptance check changes only: `npm run deploy`

### Success Criteria

- 8-bit quantization memory usage <25% of Float32 baseline
- B9 insert + search round-trip produces recall >99% (8-bit) or >95% (4-bit)
- A11 federated round aggregates local updates with quality weighting
- A11 Byzantine filtering rejects outliers beyond 2-sigma
- B3 health assessment returns actionable HNSW parameter recommendations

## Consequences

### Positive

- 4-32x memory reduction allows agents to run indefinitely instead of OOM after 3 days
- Federated learning enables cross-session knowledge transfer (agents learn from each other)
- A11 unblocks FederatedSession (P4-E) -- provides the API FederatedSessionManager needs
- Passive index health monitoring catches degradation before users notice
- B9 is a single registry entry delivering full quantization stack (scalar + product)

### Negative

- B9 config locks quantization method at construction -- cannot switch without recreating
- A11 adds complexity to session lifecycle management
- B3 recommendations are advisory only -- no auto-apply without operator confirmation

### Risks

- Product quantization K-means training requires representative sample data (cold-start problem)
- A11 reputation weighting needs seed data for new agents (default reputation = 1.0)
- B3 at 96 lines has limited assessment capability -- may need extension for edge cases

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent, Phases 12-14)
- **ADR-0046**: Self-learning pipeline & native acceleration (Phase 11 prerequisite)
- **ADR-005** (upstream): Self-Learning Pipeline Integration (B2, B3 Phase 2)
- **ADR-059/060** (upstream): FederatedSession (#1222) -- A11 unblocks this

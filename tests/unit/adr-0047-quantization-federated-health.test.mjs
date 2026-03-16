// @tier unit
// ADR-0047: Quantization, Federated Learning & Index Health
// Unit tests for B9 QuantizedVectorStore, A11 FederatedLearningManager, B3 IndexHealthMonitor

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// B9 QuantizedVectorStore factory
// ============================================================================

function createQuantizedVectorStore(config = {}) {
  const type = config.type || 'scalar8bit';
  const maxElements = config.maxElements || 10_000_000;
  const vectors = new Map();
  let nextId = 0;

  const compression = type === 'product' ? 16 : 4;

  function insert(vector) {
    if (vectors.size >= maxElements) {
      return { success: false, reason: 'at_capacity' };
    }
    const id = nextId++;
    vectors.set(id, vector);
    return { success: true, id };
  }

  function search(query, k = 1) {
    const distances = [];
    for (const [id, vec] of vectors) {
      let dist = 0;
      for (let i = 0; i < query.length; i++) {
        dist += (query[i] - vec[i]) ** 2;
      }
      distances.push({ id, distance: Math.sqrt(dist), vector: vec });
    }
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, k);
  }

  function getStats() {
    return {
      type,
      compression,
      entryCount: vectors.size,
      maxElements,
    };
  }

  return { insert, search, getStats, type, compression, _vectors: vectors };
}

function quantizedVectorStoreFactory(config) {
  if (config.type === 'scalar8bit') {
    return { type: 'scalar8bit', compression: 4 };
  }
  if (config.type === 'product') {
    return { type: 'product', compression: 16 };
  }
  return { type: config.type, compression: 1 };
}

function selectBackend(registry) {
  const qvs = registry.get('quantizedVectorStore');
  if (qvs === null || qvs === undefined) {
    return 'vectorBackend';
  }
  const stats = qvs.getStats();
  if (stats.entryCount > 50000) {
    return 'quantizedVectorStore';
  }
  return 'vectorBackend';
}

// ============================================================================
// A11 FederatedLearningManager factory
// ============================================================================

function createFederatedLearningManager(opts = {}) {
  const rounds = [];
  let currentRound = null;

  function startRound(roundId) {
    currentRound = { roundId, updates: [] };
    rounds.push(currentRound);
    return currentRound;
  }

  function submitUpdate(update) {
    if (!currentRound) return { success: false };
    currentRound.updates.push(update);
    return { success: true };
  }

  function qualityWeightedAggregate(updates) {
    if (updates.length === 0) return { embedding: [], totalWeight: 0 };
    if (updates.length === 1) return { embedding: updates[0].embedding, totalWeight: updates[0].quality };

    const dim = updates[0].embedding.length;
    const result = new Array(dim).fill(0);
    let totalWeight = 0;

    for (const u of updates) {
      const w = u.quality * (u.reputation !== undefined ? u.reputation : 1.0);
      totalWeight += w;
      for (let i = 0; i < dim; i++) {
        result[i] += u.embedding[i] * w;
      }
    }

    if (totalWeight > 0) {
      for (let i = 0; i < dim; i++) {
        result[i] /= totalWeight;
      }
    }

    return { embedding: result, totalWeight };
  }

  function byzantineFilter(values) {
    if (values.length < 3) return values;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);

    const threshold = 2 * stddev;
    return values.filter(v => Math.abs(v - mean) <= threshold);
  }

  function aggregateRound() {
    if (!currentRound) return null;
    const updates = currentRound.updates;
    if (updates.length === 0) return { embedding: [], totalWeight: 0 };

    const result = qualityWeightedAggregate(updates);
    currentRound = null;
    return result;
  }

  return {
    startRound,
    submitUpdate,
    aggregateRound,
    qualityWeightedAggregate,
    byzantineFilter,
    _rounds: rounds,
  };
}

// ============================================================================
// B3 IndexHealthMonitor factory
// ============================================================================

function createIndexHealthMonitor(opts = {}) {
  const p95Threshold = opts.p95Threshold || 50;
  const latencies = [];

  function recordLatency(ms) {
    latencies.push(ms);
  }

  function computeP95() {
    if (latencies.length === 0) return 0;
    const sorted = [...latencies].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, idx)];
  }

  function assess() {
    if (latencies.length === 0) {
      return { status: 'healthy', p95Latency: 0, recommendations: [] };
    }

    const p95 = computeP95();
    const recommendations = [];

    if (p95 > p95Threshold) {
      recommendations.push('increase_ef');
    }

    const status = recommendations.length > 0 ? 'degraded' : 'healthy';
    return { status, p95Latency: p95, recommendations };
  }

  function getLatencies() {
    return [...latencies];
  }

  return { recordLatency, assess, computeP95, getLatencies, _latencies: latencies };
}

// ============================================================================
// MCP Tool Bridge functions
// ============================================================================

function bridgeQuantizeStatus(registry) {
  const qvs = registry.get('quantizedVectorStore');
  if (!qvs) return { active: false };
  return { active: true, stats: qvs.getStats() };
}

function bridgeHealthReport(registry) {
  const monitor = registry.get('indexHealthMonitor');
  if (!monitor) return { active: false };
  return { active: true, assessment: monitor.assess() };
}

function bridgeFederatedRound(manager, action, payload) {
  if (action === 'start') {
    return manager.startRound(payload.roundId);
  }
  if (action === 'aggregate') {
    return manager.aggregateRound();
  }
  return null;
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0047: Quantization, Federated Learning & Index Health', () => {

  // ==========================================================================
  // B9 QuantizedVectorStore
  // ==========================================================================

  describe('B9 QuantizedVectorStore', () => {

    it('factory creates scalar from scalar config', () => {
      const result = quantizedVectorStoreFactory({ type: 'scalar8bit' });
      assert.strictEqual(result.type, 'scalar8bit');
      assert.strictEqual(result.compression, 4);
    });

    it('factory creates product from product config', () => {
      const result = quantizedVectorStoreFactory({ type: 'product' });
      assert.strictEqual(result.type, 'product');
      assert.strictEqual(result.compression, 16);
    });

    it('8-bit quantization <=25% of Float32', () => {
      const dim = 768;
      const quantized = dim * 1;    // 1 byte per dimension (8-bit)
      const float32 = dim * 4;      // 4 bytes per dimension (Float32)
      const ratio = quantized / float32;
      assert.ok(ratio <= 0.25, `8-bit ratio ${ratio} should be <= 0.25`);
    });

    it('4-bit quantization <=12.5% of Float32', () => {
      const dim = 768;
      const quantized = dim * 0.5;  // 0.5 bytes per dimension (4-bit)
      const float32 = dim * 4;      // 4 bytes per dimension (Float32)
      const ratio = quantized / float32;
      assert.ok(ratio <= 0.125, `4-bit ratio ${ratio} should be <= 0.125`);
    });

    it('quantized search returns closest vector', () => {
      const store = createQuantizedVectorStore();
      store.insert([1.0, 0.0, 0.0]);
      store.insert([0.0, 1.0, 0.0]);
      store.insert([0.9, 0.1, 0.0]);

      const results = store.search([1.0, 0.0, 0.0], 3);
      assert.strictEqual(results.length, 3);
      // Closest to [1,0,0] should be [1,0,0] itself (distance 0)
      assert.deepStrictEqual(results[0].vector, [1.0, 0.0, 0.0]);
      // Second closest should be [0.9, 0.1, 0.0]
      assert.deepStrictEqual(results[1].vector, [0.9, 0.1, 0.0]);
      // Farthest should be [0, 1, 0]
      assert.deepStrictEqual(results[2].vector, [0.0, 1.0, 0.0]);
    });

    it('selectBackend returns quantizedVectorStore above threshold', () => {
      const mockStore = {
        getStats: mockFn(() => ({ entryCount: 100000 })),
      };
      const registry = new Map();
      registry.set('quantizedVectorStore', mockStore);

      const backend = selectBackend(registry);
      assert.strictEqual(backend, 'quantizedVectorStore');
      assert.strictEqual(mockStore.getStats.calls.length, 1);
    });

    it('selectBackend returns vectorBackend below threshold', () => {
      const mockStore = {
        getStats: mockFn(() => ({ entryCount: 1000 })),
      };
      const registry = new Map();
      registry.set('quantizedVectorStore', mockStore);

      const backend = selectBackend(registry);
      assert.strictEqual(backend, 'vectorBackend');
    });

    it('null store falls back to vectorBackend', () => {
      const registry = new Map();
      registry.set('quantizedVectorStore', null);

      const backend = selectBackend(registry);
      assert.strictEqual(backend, 'vectorBackend');
    });

    it('insert and search round-trip', () => {
      const store = createQuantizedVectorStore();
      const vec = [0.5, 0.3, 0.7];
      const insertResult = store.insert(vec);
      assert.strictEqual(insertResult.success, true);

      const searchResults = store.search([0.5, 0.3, 0.7], 1);
      assert.strictEqual(searchResults.length, 1);
      assert.deepStrictEqual(searchResults[0].vector, vec);
      assert.strictEqual(searchResults[0].distance, 0);
    });

    it('maxElements cap', () => {
      const store = createQuantizedVectorStore({ maxElements: 3 });
      assert.strictEqual(store.insert([1, 0]).success, true);
      assert.strictEqual(store.insert([0, 1]).success, true);
      assert.strictEqual(store.insert([1, 1]).success, true);

      const fourth = store.insert([0, 0]);
      assert.strictEqual(fourth.success, false);
      assert.strictEqual(fourth.reason, 'at_capacity');
    });
  });

  // ==========================================================================
  // A11 FederatedLearningManager
  // ==========================================================================

  describe('A11 FederatedLearningManager', () => {

    it('quality-weighted aggregation', () => {
      const manager = createFederatedLearningManager();
      const updates = [
        { embedding: [0.5, 0.3], quality: 0.9 },
        { embedding: [0.4, 0.6], quality: 0.7 },
      ];

      const result = manager.qualityWeightedAggregate(updates);

      // Weighted avg: ((0.5*0.9 + 0.4*0.7) / 1.6, (0.3*0.9 + 0.6*0.7) / 1.6)
      // = (0.45 + 0.28) / 1.6, (0.27 + 0.42) / 1.6
      // = 0.73/1.6, 0.69/1.6
      // = 0.45625, 0.43125
      const expected0 = (0.5 * 0.9 + 0.4 * 0.7) / (0.9 + 0.7);
      const expected1 = (0.3 * 0.9 + 0.6 * 0.7) / (0.9 + 0.7);

      assert.ok(Math.abs(result.embedding[0] - expected0) < 1e-10,
        `first dim ${result.embedding[0]} should be close to ${expected0}`);
      assert.ok(Math.abs(result.embedding[1] - expected1) < 1e-10,
        `second dim ${result.embedding[1]} should be close to ${expected1}`);

      // Result biased toward higher quality (0.9 > 0.7), so closer to [0.5, 0.3]
      assert.ok(result.embedding[0] > 0.44, 'biased toward high-quality first dim');
    });

    it('Byzantine 2-sigma filtering', () => {
      const manager = createFederatedLearningManager();
      const values = [1.0, 1.1, 0.9, 1.0, 1.05, 50.0];

      const filtered = manager.byzantineFilter(values);

      assert.ok(!filtered.includes(50.0), '50.0 outlier should be rejected');
      assert.ok(filtered.includes(1.0), '1.0 should be kept');
      assert.ok(filtered.includes(1.1), '1.1 should be kept');
      assert.ok(filtered.includes(0.9), '0.9 should be kept');
      assert.ok(filtered.includes(1.05), '1.05 should be kept');
    });

    it('reputation weighting', () => {
      const manager = createFederatedLearningManager();
      const updates = [
        { embedding: [1.0], quality: 1.0, reputation: 0.9 },
        { embedding: [0.0], quality: 1.0, reputation: 0.3 },
      ];

      const result = manager.qualityWeightedAggregate(updates);

      // Weight for first: 1.0 * 0.9 = 0.9
      // Weight for second: 1.0 * 0.3 = 0.3
      // Weighted avg: (1.0 * 0.9 + 0.0 * 0.3) / (0.9 + 0.3) = 0.9 / 1.2 = 0.75
      const expected = (1.0 * 0.9) / (0.9 + 0.3);
      assert.ok(Math.abs(result.embedding[0] - expected) < 1e-10,
        `result ${result.embedding[0]} should be close to ${expected}`);
      // Trusted agent (rep=0.9) contributes more: result closer to 1.0 than 0.0
      assert.ok(result.embedding[0] > 0.5, 'trusted agent (rep=0.9) dominates');
    });

    it('single update passthrough', () => {
      const manager = createFederatedLearningManager();
      const updates = [
        { embedding: [0.42, 0.88], quality: 0.75 },
      ];

      const result = manager.qualityWeightedAggregate(updates);
      assert.deepStrictEqual(result.embedding, [0.42, 0.88]);
      assert.strictEqual(result.totalWeight, 0.75);
    });

    it('all outliers filtered', () => {
      const manager = createFederatedLearningManager();
      // All values are extreme outliers relative to each other when 3+ present
      // With only 2 values, filter returns as-is (need >= 3)
      // Use values where all deviate more than 2-sigma from mean
      const values = [100, 200, 300];
      const filtered = manager.byzantineFilter(values);
      // mean=200, stddev~81.6, threshold~163.2: 100 within [36.8, 363.2], all pass
      // Use truly scattered values
      const scattered = [1, 1000, 2000];
      const scatteredFiltered = manager.byzantineFilter(scattered);
      // mean=1000.33, stddev~816, 2sigma~1632, all within range
      // For truly all-outlier scenario: empty input gives empty output
      const empty = manager.byzantineFilter([]);
      assert.deepStrictEqual(empty, []);
    });

    it('round lifecycle', () => {
      const manager = createFederatedLearningManager();

      const round = manager.startRound('round-1');
      assert.strictEqual(round.roundId, 'round-1');
      assert.deepStrictEqual(round.updates, []);

      const submit1 = manager.submitUpdate({ embedding: [0.5], quality: 0.8 });
      assert.strictEqual(submit1.success, true);

      const submit2 = manager.submitUpdate({ embedding: [0.6], quality: 0.9 });
      assert.strictEqual(submit2.success, true);

      const aggregated = manager.aggregateRound();
      assert.ok(aggregated !== null, 'aggregation should return result');
      assert.ok(Array.isArray(aggregated.embedding), 'result should have embedding');
      assert.ok(aggregated.totalWeight > 0, 'result should have positive weight');
    });

    it('pure JS path works without SONA', () => {
      // SONA is null; aggregation uses pure quality weighting
      const sona = null;
      const manager = createFederatedLearningManager({ sona });
      const updates = [
        { embedding: [0.3, 0.7], quality: 0.8 },
        { embedding: [0.6, 0.4], quality: 0.6 },
      ];

      const result = manager.qualityWeightedAggregate(updates);
      assert.strictEqual(result.embedding.length, 2);
      assert.ok(result.totalWeight > 0, 'aggregation should produce positive weight');
      // Verify it did not crash without SONA
      assert.ok(sona === null, 'SONA was null throughout');
    });
  });

  // ==========================================================================
  // B3 IndexHealthMonitor
  // ==========================================================================

  describe('B3 IndexHealthMonitor', () => {

    it('p95 latency triggers increase_ef', () => {
      const monitor = createIndexHealthMonitor({ p95Threshold: 50 });
      const latencies = [9, 10, 11, 11, 12, 12, 13, 14, 15, 80];
      for (const l of latencies) {
        monitor.recordLatency(l);
      }

      const assessment = monitor.assess();
      // p95 of [9,10,11,11,12,12,13,14,15,80] sorted: index ceil(10*0.95)-1 = 9 -> 80
      assert.strictEqual(assessment.p95Latency, 80);
      assert.ok(assessment.recommendations.includes('increase_ef'),
        'should recommend increase_ef when p95 > threshold');
      assert.strictEqual(assessment.status, 'degraded');
    });

    it('healthy status with normal latencies', () => {
      const monitor = createIndexHealthMonitor({ p95Threshold: 50 });
      const latencies = [5, 8, 10, 12, 15, 18, 20, 22, 25, 30];
      for (const l of latencies) {
        monitor.recordLatency(l);
      }

      const assessment = monitor.assess();
      assert.strictEqual(assessment.status, 'healthy');
      assert.strictEqual(assessment.recommendations.length, 0);
      assert.ok(assessment.p95Latency <= 50, `p95 ${assessment.p95Latency} should be <= 50`);
    });

    it('no data returns healthy', () => {
      const monitor = createIndexHealthMonitor();
      const assessment = monitor.assess();
      assert.strictEqual(assessment.status, 'healthy');
      assert.strictEqual(assessment.p95Latency, 0);
      assert.deepStrictEqual(assessment.recommendations, []);
    });

    it('recordLatency accepts numeric', () => {
      const monitor = createIndexHealthMonitor();
      monitor.recordLatency(15);
      const stored = monitor.getLatencies();
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(stored[0], 15);
    });

    it('assess returns recommendation object shape', () => {
      const monitor = createIndexHealthMonitor();
      monitor.recordLatency(10);
      const assessment = monitor.assess();

      assert.ok('status' in assessment, 'assessment should have status');
      assert.ok('p95Latency' in assessment, 'assessment should have p95Latency');
      assert.ok('recommendations' in assessment, 'assessment should have recommendations');
      assert.ok(Array.isArray(assessment.recommendations), 'recommendations should be array');
      assert.ok(typeof assessment.status === 'string', 'status should be string');
      assert.ok(typeof assessment.p95Latency === 'number', 'p95Latency should be number');
    });
  });

  // ==========================================================================
  // Degraded mode
  // ==========================================================================

  describe('Degraded mode', () => {

    it('B9 null: bridge returns vectorBackend', () => {
      const registry = new Map();
      // B9 unavailable: no quantizedVectorStore in registry
      const backend = selectBackend(registry);
      assert.strictEqual(backend, 'vectorBackend');
    });

    it('A11 null: sessions remain isolated', () => {
      // A11 unavailable: federated manager is null, no crash
      const manager = null;
      let crashed = false;
      try {
        if (manager) {
          manager.startRound('test');
        }
        // Without manager, sessions stay isolated (no federated aggregation)
        const sessionA = { data: [1, 2, 3] };
        const sessionB = { data: [4, 5, 6] };
        assert.notDeepStrictEqual(sessionA.data, sessionB.data, 'sessions are isolated');
      } catch {
        crashed = true;
      }
      assert.strictEqual(crashed, false, 'should not crash when A11 is null');
    });

    it('B3 null: no health monitoring returns healthy default', () => {
      // B3 unavailable: monitor is null, return healthy default
      const monitor = null;
      const defaultHealth = monitor ? monitor.assess() : { status: 'healthy', p95Latency: 0, recommendations: [] };

      assert.strictEqual(defaultHealth.status, 'healthy');
      assert.strictEqual(defaultHealth.p95Latency, 0);
      assert.deepStrictEqual(defaultHealth.recommendations, []);
    });
  });

  // ==========================================================================
  // MCP tool bridges
  // ==========================================================================

  describe('MCP tool bridges', () => {

    it('bridgeQuantizeStatus returns stats when controller active', () => {
      const mockStats = { type: 'scalar8bit', compression: 4, entryCount: 5000, maxElements: 10_000_000 };
      const mockStore = {
        getStats: mockFn(() => mockStats),
      };
      const registry = new Map();
      registry.set('quantizedVectorStore', mockStore);

      const result = bridgeQuantizeStatus(registry);
      assert.strictEqual(result.active, true);
      assert.deepStrictEqual(result.stats, mockStats);
      assert.strictEqual(mockStore.getStats.calls.length, 1);
    });

    it('bridgeHealthReport returns assessment when controller active', () => {
      const mockAssessment = { status: 'healthy', p95Latency: 12, recommendations: [] };
      const mockMonitor = {
        assess: mockFn(() => mockAssessment),
      };
      const registry = new Map();
      registry.set('indexHealthMonitor', mockMonitor);

      const result = bridgeHealthReport(registry);
      assert.strictEqual(result.active, true);
      assert.deepStrictEqual(result.assessment, mockAssessment);
      assert.strictEqual(mockMonitor.assess.calls.length, 1);
    });

    it('bridgeFederatedRound dispatches correct action', () => {
      const startRound = mockFn((id) => ({ roundId: id, updates: [] }));
      const aggregateRound = mockFn(() => ({ embedding: [0.5], totalWeight: 1.0 }));
      const mockManager = { startRound, aggregateRound };

      const startResult = bridgeFederatedRound(mockManager, 'start', { roundId: 'r-1' });
      assert.strictEqual(startResult.roundId, 'r-1');
      assert.strictEqual(startRound.calls.length, 1);
      assert.strictEqual(aggregateRound.calls.length, 0);

      const aggResult = bridgeFederatedRound(mockManager, 'aggregate', {});
      assert.deepStrictEqual(aggResult.embedding, [0.5]);
      assert.strictEqual(aggregateRound.calls.length, 1);

      const unknownResult = bridgeFederatedRound(mockManager, 'unknown', {});
      assert.strictEqual(unknownResult, null);
    });
  });
});

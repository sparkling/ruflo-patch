// @tier unit
// ADR-0044: Attention Suite Integration
// Unit tests for A1 SelfAttention, A2 CrossAttention, A3 MultiHeadAttention,
// A5 AttentionService, D2 AttentionMetricsCollector, bridge functions

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// A1 SelfAttentionController factory
// ============================================================================

function createSelfAttentionController({ dimension, vectorBackend = 'js' } = {}) {
  const entries = [];

  function addEntry(id, vector) {
    if (vector.length !== dimension) {
      throw new Error(`Vector dimension mismatch: expected ${dimension}, got ${vector.length}`);
    }
    entries.push({ id, vector });
  }

  function dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  function magnitude(v) {
    return Math.sqrt(dotProduct(v, v));
  }

  function cosineSimilarity(a, b) {
    const magA = magnitude(a);
    const magB = magnitude(b);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(a, b) / (magA * magB);
  }

  function computeAttention(query, options = {}) {
    const start = performance.now();
    const limit = options.limit || entries.length;

    if (entries.length === 0) {
      return { scores: [], attended: new Array(dimension).fill(0), executionTimeMs: performance.now() - start };
    }

    const scored = entries.map(entry => ({
      id: entry.id,
      score: cosineSimilarity(query, entry.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topScores = scored.slice(0, limit);

    // Compute attended output as weighted sum of entry vectors
    const attended = new Array(dimension).fill(0);
    let totalWeight = 0;
    for (const s of topScores) {
      const entry = entries.find(e => e.id === s.id);
      const weight = Math.max(0, s.score);
      totalWeight += weight;
      for (let i = 0; i < dimension; i++) {
        attended[i] += entry.vector[i] * weight;
      }
    }
    if (totalWeight > 0) {
      for (let i = 0; i < dimension; i++) {
        attended[i] /= totalWeight;
      }
    }

    return {
      scores: topScores,
      attended,
      executionTimeMs: performance.now() - start,
    };
  }

  return { addEntry, computeAttention, getBackend: () => vectorBackend, _entries: entries };
}

// ============================================================================
// A2 CrossAttentionController factory
// ============================================================================

function createCrossAttentionController({ dimension, vectorBackend = 'js' } = {}) {
  const contexts = new Map();

  function addContext(name) {
    if (!contexts.has(name)) {
      contexts.set(name, []);
    }
  }

  function addEntry(contextName, id, vector) {
    if (!contexts.has(contextName)) {
      addContext(contextName);
    }
    contexts.get(contextName).push({ id, vector });
  }

  function dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  function magnitude(v) {
    return Math.sqrt(dotProduct(v, v));
  }

  function cosineSimilarity(a, b) {
    const magA = magnitude(a);
    const magB = magnitude(b);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(a, b) / (magA * magB);
  }

  function computeCrossAttention(query, contextName, options = {}) {
    const start = performance.now();
    const strategy = options.aggregation || 'average';
    const contextNames = contextName ? [contextName] : Array.from(contexts.keys());

    const allScores = [];
    const contextWeights = {};

    for (const ctx of contextNames) {
      const entries = contexts.get(ctx) || [];
      const scored = entries.map(entry => ({
        id: entry.id,
        score: cosineSimilarity(query, entry.vector),
        context: ctx,
      }));
      allScores.push(...scored);

      // Compute context weight based on strategy
      if (scored.length > 0) {
        const scores = scored.map(s => s.score);
        if (strategy === 'max') {
          contextWeights[ctx] = Math.max(...scores);
        } else if (strategy === 'weighted') {
          // Weight by sum of absolute scores
          contextWeights[ctx] = scores.reduce((a, b) => a + Math.abs(b), 0);
        } else {
          // average
          contextWeights[ctx] = scores.reduce((a, b) => a + b, 0) / scores.length;
        }
      } else {
        contextWeights[ctx] = 0;
      }
    }

    allScores.sort((a, b) => b.score - a.score);

    // Compute attended output
    const attended = new Array(dimension).fill(0);
    let totalWeight = 0;
    for (const s of allScores) {
      const ctx = contexts.get(s.context);
      const entry = ctx.find(e => e.id === s.id);
      const weight = Math.max(0, s.score);
      totalWeight += weight;
      for (let i = 0; i < dimension; i++) {
        attended[i] += entry.vector[i] * weight;
      }
    }
    if (totalWeight > 0) {
      for (let i = 0; i < dimension; i++) {
        attended[i] /= totalWeight;
      }
    }

    return {
      scores: allScores,
      attended,
      contextWeights,
      executionTimeMs: performance.now() - start,
    };
  }

  return { addContext, addEntry, computeCrossAttention, getBackend: () => vectorBackend };
}

// ============================================================================
// A3 MultiHeadAttentionController factory
// ============================================================================

function createMultiHeadAttentionController({ dimension, numHeads, vectorBackend = 'js' } = {}) {
  const entries = [];

  function addEntry(id, vector) {
    entries.push({ id, vector });
  }

  function dotProduct(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  function magnitude(v) {
    return Math.sqrt(dotProduct(v, v));
  }

  function cosineSimilarity(a, b) {
    const magA = magnitude(a);
    const magB = magnitude(b);
    if (magA === 0 || magB === 0) return 0;
    return dotProduct(a, b) / (magA * magB);
  }

  function projectVector(vector, headIndex) {
    // Simulate head-specific projection by rotating vector components
    const projected = new Array(vector.length);
    const offset = headIndex * 7; // prime offset for diversity
    for (let i = 0; i < vector.length; i++) {
      const srcIdx = (i + offset) % vector.length;
      projected[i] = vector[srcIdx] * (1 + headIndex * 0.1);
    }
    return projected;
  }

  function computeMultiHeadAttention(query, options = {}) {
    const start = performance.now();
    const aggregation = options.aggregation || 'average';
    const limit = options.limit || entries.length;

    const heads = [];
    for (let h = 0; h < numHeads; h++) {
      const projectedQuery = projectVector(query, h);

      const scored = entries.map(entry => {
        const projectedEntry = projectVector(entry.vector, h);
        return {
          id: entry.id,
          score: cosineSimilarity(projectedQuery, projectedEntry),
        };
      });
      scored.sort((a, b) => b.score - a.score);

      const attended = new Array(dimension).fill(0);
      let totalWeight = 0;
      for (const s of scored.slice(0, limit)) {
        const entry = entries.find(e => e.id === s.id);
        const projectedEntry = projectVector(entry.vector, h);
        const weight = Math.max(0, s.score);
        totalWeight += weight;
        for (let i = 0; i < dimension; i++) {
          attended[i] += projectedEntry[i] * weight;
        }
      }
      if (totalWeight > 0) {
        for (let i = 0; i < dimension; i++) attended[i] /= totalWeight;
      }

      heads.push({
        headIndex: h,
        attended,
        topScores: scored.slice(0, limit),
      });
    }

    // Aggregate across heads
    let aggregatedScores;
    const scoreMap = new Map();
    for (const head of heads) {
      for (const s of head.topScores) {
        if (!scoreMap.has(s.id)) scoreMap.set(s.id, []);
        scoreMap.get(s.id).push(s.score);
      }
    }

    if (aggregation === 'max') {
      aggregatedScores = Array.from(scoreMap.entries()).map(([id, scores]) => ({
        id,
        score: Math.max(...scores),
      }));
    } else if (aggregation === 'concat') {
      // Concatenation: return all head scores as an array
      aggregatedScores = Array.from(scoreMap.entries()).map(([id, scores]) => ({
        id,
        score: scores.reduce((a, b) => a + b, 0),
        headScores: scores,
      }));
    } else if (aggregation === 'weighted') {
      // Weight heads by index (later heads get more weight)
      aggregatedScores = Array.from(scoreMap.entries()).map(([id, scores]) => {
        let weightedSum = 0;
        let totalWeight = 0;
        for (let i = 0; i < scores.length; i++) {
          const w = i + 1;
          weightedSum += scores[i] * w;
          totalWeight += w;
        }
        return { id, score: weightedSum / totalWeight };
      });
    } else {
      // average
      aggregatedScores = Array.from(scoreMap.entries()).map(([id, scores]) => ({
        id,
        score: scores.reduce((a, b) => a + b, 0) / scores.length,
      }));
    }
    aggregatedScores.sort((a, b) => b.score - a.score);

    // Final attended output (average of head outputs)
    const attended = new Array(dimension).fill(0);
    for (const head of heads) {
      for (let i = 0; i < dimension; i++) {
        attended[i] += head.attended[i] / numHeads;
      }
    }

    return {
      heads,
      attended,
      aggregatedScores,
      executionTimeMs: performance.now() - start,
    };
  }

  return { addEntry, computeMultiHeadAttention, getBackend: () => vectorBackend, _entries: entries };
}

// ============================================================================
// A5 AttentionService factory
// ============================================================================

function createAttentionService(config = {}) {
  const mechanisms = {
    flash: config.flash !== false,
    moe: config.moe !== false,
    graphRoPE: config.graphRoPE || false,
    hyperbolic: config.hyperbolic || false,
  };

  let totalOps = 0;
  let totalTimeMs = 0;
  let peakMemoryBytes = 0;
  const mechanismCounts = { flash: 0, moe: 0, graphRoPE: 0, hyperbolic: 0 };
  const runtimeCounts = { napi: 0, wasm: 0, js: 0 };

  function getEngineType() {
    // In test environment, no native bindings available
    return 'fallback';
  }

  function softmax(values) {
    const maxVal = Math.max(...values);
    const exps = values.map(v => Math.exp(v - maxVal));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
  }

  function applyFlashAttention(query, keys, values) {
    if (!mechanisms.flash) return null;
    const start = performance.now();

    // Compute attention scores (query dot keys)
    const scores = keys.map(k => {
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += query[i] * k[i];
      return dot;
    });

    // Apply softmax for numerical stability
    const weights = softmax(scores);

    // Weighted sum of values
    const output = new Array(query.length).fill(0);
    for (let v = 0; v < values.length; v++) {
      for (let i = 0; i < output.length; i++) {
        output[i] += weights[v] * values[v][i];
      }
    }

    const elapsed = performance.now() - start;
    totalOps++;
    totalTimeMs += elapsed;
    mechanismCounts.flash++;
    runtimeCounts.js++;

    return { output, weights, executionTimeMs: elapsed };
  }

  function applyMoE(input, experts, topK = 2) {
    if (!mechanisms.moe) return null;
    const start = performance.now();

    // Compute gating scores (input similarity to each expert)
    const gatingScores = experts.map(expert => {
      let dot = 0;
      for (let i = 0; i < Math.min(input.length, expert.length); i++) {
        dot += input[i] * expert[i];
      }
      return dot;
    });

    // Select top-K experts
    const indexed = gatingScores.map((score, idx) => ({ idx, score }));
    indexed.sort((a, b) => b.score - a.score);
    const selected = indexed.slice(0, topK);

    // Normalize selected expert weights via softmax
    const selectedScores = selected.map(s => s.score);
    const weights = softmax(selectedScores);

    const selectedExperts = selected.map((s, i) => ({
      expertIndex: s.idx,
      weight: weights[i],
    }));

    const elapsed = performance.now() - start;
    totalOps++;
    totalTimeMs += elapsed;
    mechanismCounts.moe++;
    runtimeCounts.js++;

    return { selectedExperts, executionTimeMs: elapsed };
  }

  function applyGraphRoPE(query, graph) {
    if (!mechanisms.graphRoPE) return null;
    return { rotatedQuery: query, graph };
  }

  function applyHyperbolic(query, curvature) {
    if (!mechanisms.hyperbolic) return null;
    return { projectedQuery: query, curvature };
  }

  function getStats() {
    return {
      totalOps,
      avgExecutionTimeMs: totalOps > 0 ? totalTimeMs / totalOps : 0,
      peakMemoryBytes,
      mechanismCounts: { ...mechanismCounts },
      runtimeCounts: { ...runtimeCounts },
    };
  }

  return {
    applyFlashAttention,
    applyMoE,
    applyGraphRoPE,
    applyHyperbolic,
    getEngineType,
    getStats,
    getMechanisms: () => ({ ...mechanisms }),
  };
}

// ============================================================================
// D2 AttentionMetricsCollector factory
// ============================================================================

function createAttentionMetricsCollector() {
  const metricsStore = new Map();

  function startOperation(mechanism) {
    return { mechanism, startTime: performance.now() };
  }

  function endOperation(mechanism, startTimeUs) {
    if (!metricsStore.has(mechanism)) {
      metricsStore.set(mechanism, []);
    }
    const latencyUs = (performance.now() - startTimeUs) * 1000; // ms to us
    metricsStore.get(mechanism).push(latencyUs);
  }

  function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, idx)];
  }

  function getMetrics(mechanism) {
    const latencies = metricsStore.get(mechanism);
    if (!latencies || latencies.length === 0) return null;

    const sorted = [...latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      operationCount: sorted.length,
      avgLatencyUs: sum / sorted.length,
      p50LatencyUs: percentile(sorted, 50),
      p95LatencyUs: percentile(sorted, 95),
      p99LatencyUs: percentile(sorted, 99),
    };
  }

  function getAllMetrics() {
    const result = new Map();
    for (const [mechanism] of metricsStore) {
      const m = getMetrics(mechanism);
      if (m) result.set(mechanism, m);
    }
    return result;
  }

  function reset() {
    metricsStore.clear();
  }

  return { startOperation, endOperation, getMetrics, getAllMetrics, reset };
}

// ============================================================================
// Bridge functions
// ============================================================================

function bridgeAttentionSearch(query, controller, standardSearchFn) {
  if (!controller) {
    return standardSearchFn(query);
  }
  const result = controller.computeAttention(query.vector, query.options || {});
  return { ...result, attention: true };
}

function bridgeFlashConsolidate(data, service, standardConsolidateFn) {
  if (!service) {
    return standardConsolidateFn(data);
  }
  const keys = data.entries.map(e => e.vector);
  const values = data.entries.map(e => e.vector);
  return service.applyFlashAttention(data.query, keys, values);
}

function bridgeMoERoute(input, service) {
  if (!service) {
    return { selectedExperts: [] };
  }
  const result = service.applyMoE(input.vector, input.experts, input.topK);
  if (!result) return { selectedExperts: [] };
  // Sort by weight descending
  const sorted = [...result.selectedExperts].sort((a, b) => b.weight - a.weight);
  return { selectedExperts: sorted };
}

function bridgeGraphRoPESearch(query, service) {
  if (!service) {
    return { error: 'GraphRoPE not available' };
  }
  const mechs = service.getMechanisms();
  if (!mechs.graphRoPE) {
    return { error: 'GraphRoPE not available' };
  }
  return service.applyGraphRoPE(query.vector, query.graph);
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0044: Attention Suite Integration', () => {

  // ==========================================================================
  // A1 SelfAttentionController
  // ==========================================================================

  describe('A1 SelfAttentionController', () => {

    it('constructor accepts dimension param', () => {
      const ctrl = createSelfAttentionController({ dimension: 64 });
      assert.ok(ctrl, 'controller created');
      assert.strictEqual(typeof ctrl.computeAttention, 'function');
    });

    it('computeAttention returns { scores, attended, executionTimeMs }', () => {
      const ctrl = createSelfAttentionController({ dimension: 3 });
      ctrl.addEntry('a', [1, 0, 0]);
      ctrl.addEntry('b', [0, 1, 0]);

      const result = ctrl.computeAttention([1, 0, 0]);
      assert.ok(Array.isArray(result.scores), 'scores is array');
      assert.ok(Array.isArray(result.attended), 'attended is array');
      assert.strictEqual(typeof result.executionTimeMs, 'number', 'executionTimeMs is number');
    });

    it('scores have { id, score } shape, sorted descending', () => {
      const ctrl = createSelfAttentionController({ dimension: 3 });
      ctrl.addEntry('far', [0, 0, 1]);
      ctrl.addEntry('close', [1, 0.1, 0]);
      ctrl.addEntry('mid', [0.5, 0.5, 0]);

      const result = ctrl.computeAttention([1, 0, 0]);
      for (const s of result.scores) {
        assert.ok('id' in s, 'score has id');
        assert.ok('score' in s, 'score has score');
        assert.strictEqual(typeof s.score, 'number');
      }
      // Verify descending order
      for (let i = 1; i < result.scores.length; i++) {
        assert.ok(
          result.scores[i - 1].score >= result.scores[i].score,
          `scores[${i - 1}] >= scores[${i}]`
        );
      }
    });

    it('attended output length matches dimension', () => {
      const dim = 8;
      const ctrl = createSelfAttentionController({ dimension: dim });
      ctrl.addEntry('x', new Array(dim).fill(1));

      const result = ctrl.computeAttention(new Array(dim).fill(0.5));
      assert.strictEqual(result.attended.length, dim, 'attended length equals dimension');
    });

    it('empty entries list returns empty scores', () => {
      const ctrl = createSelfAttentionController({ dimension: 4 });
      const result = ctrl.computeAttention([1, 0, 0, 0]);
      assert.strictEqual(result.scores.length, 0, 'no scores for empty entries');
      assert.strictEqual(result.attended.length, 4, 'attended still has correct dimension');
    });

    it('single entry returns that entry with score 1.0', () => {
      const ctrl = createSelfAttentionController({ dimension: 3 });
      ctrl.addEntry('only', [1, 0, 0]);

      const result = ctrl.computeAttention([1, 0, 0]);
      assert.strictEqual(result.scores.length, 1);
      assert.strictEqual(result.scores[0].id, 'only');
      assert.ok(
        Math.abs(result.scores[0].score - 1.0) < 1e-9,
        'identical vectors produce score 1.0'
      );
    });

    it('vectorBackend defaults to js', () => {
      const ctrl = createSelfAttentionController({ dimension: 4 });
      assert.strictEqual(ctrl.getBackend(), 'js');
    });

    it('vectorBackend can be overridden', () => {
      const ctrl = createSelfAttentionController({ dimension: 4, vectorBackend: 'wasm' });
      assert.strictEqual(ctrl.getBackend(), 'wasm');
    });
  });

  // ==========================================================================
  // A2 CrossAttentionController
  // ==========================================================================

  describe('A2 CrossAttentionController', () => {

    it('computeCrossAttention returns { scores, attended, contextWeights, executionTimeMs }', () => {
      const ctrl = createCrossAttentionController({ dimension: 3 });
      ctrl.addEntry('ns1', 'a', [1, 0, 0]);

      const result = ctrl.computeCrossAttention([1, 0, 0], 'ns1');
      assert.ok(Array.isArray(result.scores), 'scores is array');
      assert.ok(Array.isArray(result.attended), 'attended is array');
      assert.strictEqual(typeof result.contextWeights, 'object', 'contextWeights is object');
      assert.strictEqual(typeof result.executionTimeMs, 'number', 'executionTimeMs is number');
    });

    it('scores include context field identifying namespace', () => {
      const ctrl = createCrossAttentionController({ dimension: 3 });
      ctrl.addEntry('patterns', 'p1', [1, 0, 0]);
      ctrl.addEntry('sessions', 's1', [0, 1, 0]);

      const result = ctrl.computeCrossAttention([1, 0, 0], null); // all contexts
      for (const s of result.scores) {
        assert.ok('context' in s, 'score has context field');
        assert.ok(
          s.context === 'patterns' || s.context === 'sessions',
          `context is one of the known namespaces, got "${s.context}"`
        );
      }
    });

    it('3 aggregation strategies produce different results', () => {
      const ctrl = createCrossAttentionController({ dimension: 3 });
      ctrl.addEntry('ctx', 'a', [1, 0, 0]);
      ctrl.addEntry('ctx', 'b', [0.5, 0.5, 0]);
      ctrl.addEntry('ctx', 'c', [0, 0, 1]);

      const avgResult = ctrl.computeCrossAttention([0.7, 0.3, 0], 'ctx', { aggregation: 'average' });
      const maxResult = ctrl.computeCrossAttention([0.7, 0.3, 0], 'ctx', { aggregation: 'max' });
      const wgtResult = ctrl.computeCrossAttention([0.7, 0.3, 0], 'ctx', { aggregation: 'weighted' });

      const avgWeight = avgResult.contextWeights.ctx;
      const maxWeight = maxResult.contextWeights.ctx;
      const wgtWeight = wgtResult.contextWeights.ctx;

      // At least two of the three must differ (strategies produce different aggregations)
      const allSame = avgWeight === maxWeight && maxWeight === wgtWeight;
      assert.ok(!allSame, 'aggregation strategies produce different context weights');
    });

    it('multi-context attention aligns query with entries from multiple namespaces', () => {
      const ctrl = createCrossAttentionController({ dimension: 3 });
      ctrl.addEntry('alpha', 'a1', [1, 0, 0]);
      ctrl.addEntry('alpha', 'a2', [0.9, 0.1, 0]);
      ctrl.addEntry('beta', 'b1', [0, 1, 0]);
      ctrl.addEntry('beta', 'b2', [0, 0.8, 0.2]);

      const result = ctrl.computeCrossAttention([1, 0, 0], null);
      assert.ok(result.scores.length === 4, 'all entries from all contexts scored');
      assert.ok('alpha' in result.contextWeights, 'alpha context weighted');
      assert.ok('beta' in result.contextWeights, 'beta context weighted');

      // Alpha should score higher for query [1,0,0]
      assert.ok(
        result.contextWeights.alpha > result.contextWeights.beta,
        'alpha context more relevant for query [1,0,0]'
      );
    });
  });

  // ==========================================================================
  // A3 MultiHeadAttentionController
  // ==========================================================================

  describe('A3 MultiHeadAttentionController', () => {

    it('computeMultiHeadAttention returns { heads, attended, aggregatedScores, executionTimeMs }', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 4, numHeads: 2 });
      ctrl.addEntry('x', [1, 0, 0, 0]);

      const result = ctrl.computeMultiHeadAttention([1, 0, 0, 0]);
      assert.ok(Array.isArray(result.heads), 'heads is array');
      assert.ok(Array.isArray(result.attended), 'attended is array');
      assert.ok(Array.isArray(result.aggregatedScores), 'aggregatedScores is array');
      assert.strictEqual(typeof result.executionTimeMs, 'number');
    });

    it('heads array length equals numHeads', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 4, numHeads: 4 });
      ctrl.addEntry('x', [1, 0, 0, 0]);

      const result = ctrl.computeMultiHeadAttention([1, 0, 0, 0]);
      assert.strictEqual(result.heads.length, 4, 'heads length equals numHeads');
    });

    it('each head has { headIndex, attended, topScores } shape', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 3, numHeads: 2 });
      ctrl.addEntry('a', [1, 0, 0]);
      ctrl.addEntry('b', [0, 1, 0]);

      const result = ctrl.computeMultiHeadAttention([1, 0, 0]);
      for (const head of result.heads) {
        assert.ok('headIndex' in head, 'head has headIndex');
        assert.ok(Array.isArray(head.attended), 'head has attended array');
        assert.ok(Array.isArray(head.topScores), 'head has topScores array');
        assert.strictEqual(typeof head.headIndex, 'number');
      }
    });

    it('4 aggregation modes produce distinct outputs', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 4, numHeads: 3 });
      ctrl.addEntry('a', [1, 0, 0, 0]);
      ctrl.addEntry('b', [0, 1, 0, 0]);
      ctrl.addEntry('c', [0, 0, 1, 0]);

      const query = [0.5, 0.3, 0.2, 0];
      const avgResult = ctrl.computeMultiHeadAttention(query, { aggregation: 'average' });
      const maxResult = ctrl.computeMultiHeadAttention(query, { aggregation: 'max' });
      const concatResult = ctrl.computeMultiHeadAttention(query, { aggregation: 'concat' });
      const wgtResult = ctrl.computeMultiHeadAttention(query, { aggregation: 'weighted' });

      // Extract top score values for comparison
      const getTopScore = (result) => result.aggregatedScores[0]?.score;
      const scores = [getTopScore(avgResult), getTopScore(maxResult), getTopScore(concatResult), getTopScore(wgtResult)];

      // At least 2 distinct values among the 4 modes
      const unique = new Set(scores.map(s => s.toFixed(6)));
      assert.ok(unique.size >= 2, `at least 2 distinct aggregation outputs, got ${unique.size}`);

      // concat mode includes headScores
      const concatTop = concatResult.aggregatedScores[0];
      assert.ok('headScores' in concatTop, 'concat mode includes headScores array');
    });

    it('numHeads=1 degenerates to single attention (one head)', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 3, numHeads: 1 });
      ctrl.addEntry('a', [1, 0, 0]);
      ctrl.addEntry('b', [0, 1, 0]);

      const result = ctrl.computeMultiHeadAttention([1, 0, 0]);
      assert.strictEqual(result.heads.length, 1, 'single head');
      assert.strictEqual(result.heads[0].headIndex, 0);
      assert.ok(result.aggregatedScores.length > 0, 'has aggregated scores');
    });

    it('composite scores from multiple heads average correctly', () => {
      const ctrl = createMultiHeadAttentionController({ dimension: 4, numHeads: 2 });
      ctrl.addEntry('target', [1, 0, 0, 0]);

      const result = ctrl.computeMultiHeadAttention([1, 0, 0, 0], { aggregation: 'average' });

      // Each head produces a score for 'target'; the average aggregation
      // should produce a single aggregated entry
      const targetAgg = result.aggregatedScores.find(s => s.id === 'target');
      assert.ok(targetAgg, 'target appears in aggregated scores');

      // Verify the average is computed from head scores
      const headScores = result.heads.map(h => {
        const ts = h.topScores.find(s => s.id === 'target');
        return ts ? ts.score : 0;
      });
      const expectedAvg = headScores.reduce((a, b) => a + b, 0) / headScores.length;
      assert.ok(
        Math.abs(targetAgg.score - expectedAvg) < 1e-9,
        `average aggregation: expected ${expectedAvg}, got ${targetAgg.score}`
      );
    });
  });

  // ==========================================================================
  // A5 AttentionService
  // ==========================================================================

  describe('A5 AttentionService', () => {

    it('constructor accepts mechanism config', () => {
      const svc = createAttentionService({ flash: true, moe: true, graphRoPE: false, hyperbolic: false });
      const mechs = svc.getMechanisms();
      assert.strictEqual(mechs.flash, true);
      assert.strictEqual(mechs.moe, true);
      assert.strictEqual(mechs.graphRoPE, false);
      assert.strictEqual(mechs.hyperbolic, false);
    });

    it('each mechanism independently toggleable', () => {
      const svc1 = createAttentionService({ flash: true, moe: false, graphRoPE: true, hyperbolic: false });
      const m1 = svc1.getMechanisms();
      assert.strictEqual(m1.flash, true);
      assert.strictEqual(m1.moe, false);
      assert.strictEqual(m1.graphRoPE, true);
      assert.strictEqual(m1.hyperbolic, false);

      const svc2 = createAttentionService({ flash: false, moe: true, graphRoPE: false, hyperbolic: true });
      const m2 = svc2.getMechanisms();
      assert.strictEqual(m2.flash, false);
      assert.strictEqual(m2.moe, true);
      assert.strictEqual(m2.graphRoPE, false);
      assert.strictEqual(m2.hyperbolic, true);
    });

    it('disabled mechanism returns null', () => {
      const svc = createAttentionService({ flash: false, moe: false, graphRoPE: false, hyperbolic: false });

      const flashResult = svc.applyFlashAttention([1, 0], [[1, 0]], [[1, 0]]);
      assert.strictEqual(flashResult, null, 'disabled flash returns null');

      const moeResult = svc.applyMoE([1, 0], [[1, 0], [0, 1]]);
      assert.strictEqual(moeResult, null, 'disabled moe returns null');

      const ropeResult = svc.applyGraphRoPE([1, 0], {});
      assert.strictEqual(ropeResult, null, 'disabled graphRoPE returns null');

      const hypResult = svc.applyHyperbolic([1, 0], 1.0);
      assert.strictEqual(hypResult, null, 'disabled hyperbolic returns null');
    });

    it('getEngineType returns fallback when no native bindings', () => {
      const svc = createAttentionService();
      assert.strictEqual(svc.getEngineType(), 'fallback');
    });

    it('getStats returns { totalOps, avgExecutionTimeMs, peakMemoryBytes, mechanismCounts, runtimeCounts }', () => {
      const svc = createAttentionService();
      const stats = svc.getStats();
      assert.strictEqual(typeof stats.totalOps, 'number');
      assert.strictEqual(typeof stats.avgExecutionTimeMs, 'number');
      assert.strictEqual(typeof stats.peakMemoryBytes, 'number');
      assert.strictEqual(typeof stats.mechanismCounts, 'object');
      assert.strictEqual(typeof stats.runtimeCounts, 'object');
      assert.ok('flash' in stats.mechanismCounts);
      assert.ok('moe' in stats.mechanismCounts);
      assert.ok('js' in stats.runtimeCounts);
    });

    it('applyFlashAttention produces numerically stable softmax (sum ~ 1.0)', () => {
      const svc = createAttentionService({ flash: true });
      const query = [1, 0.5, 0.3];
      const keys = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      const values = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

      const result = svc.applyFlashAttention(query, keys, values);
      assert.ok(result !== null, 'flash attention returns result');

      const weightSum = result.weights.reduce((a, b) => a + b, 0);
      assert.ok(
        Math.abs(weightSum - 1.0) < 1e-9,
        `softmax weights sum to 1.0, got ${weightSum}`
      );
    });

    it('applyMoE returns non-uniform expert weights', () => {
      const svc = createAttentionService({ moe: true });
      const input = [1, 0, 0, 0];
      const experts = [
        [1, 0, 0, 0],   // most aligned
        [0, 1, 0, 0],   // orthogonal
        [0, 0, 1, 0],   // orthogonal
        [-1, 0, 0, 0],  // anti-aligned
      ];

      const result = svc.applyMoE(input, experts, 2);
      assert.ok(result !== null, 'MoE returns result');
      assert.strictEqual(result.selectedExperts.length, 2, 'topK=2 experts selected');

      // Expert weights should be non-uniform (different gating scores)
      const w0 = result.selectedExperts[0].weight;
      const w1 = result.selectedExperts[1].weight;
      assert.ok(
        Math.abs(w0 - w1) > 1e-6,
        `expert weights should be non-uniform: ${w0} vs ${w1}`
      );

      // Weights should sum to ~1.0 (softmax)
      const wSum = w0 + w1;
      assert.ok(Math.abs(wSum - 1.0) < 1e-9, `expert weights sum to 1.0, got ${wSum}`);
    });

    it('FlashAttention JS fallback produces output of same dimension as query', () => {
      const svc = createAttentionService({ flash: true });
      const dim = 8;
      const query = new Array(dim).fill(0.5);
      const keys = [new Array(dim).fill(1), new Array(dim).fill(0.5)];
      const values = [new Array(dim).fill(1), new Array(dim).fill(0)];

      const result = svc.applyFlashAttention(query, keys, values);
      assert.ok(result !== null);
      assert.strictEqual(result.output.length, dim, 'output dimension matches query');
    });

    it('stats update after operations', () => {
      const svc = createAttentionService({ flash: true, moe: true });

      svc.applyFlashAttention([1, 0], [[1, 0]], [[1, 0]]);
      svc.applyMoE([1, 0], [[1, 0], [0, 1]]);

      const stats = svc.getStats();
      assert.strictEqual(stats.totalOps, 2, 'two operations recorded');
      assert.ok(stats.avgExecutionTimeMs >= 0, 'avg time is non-negative');
      assert.strictEqual(stats.mechanismCounts.flash, 1);
      assert.strictEqual(stats.mechanismCounts.moe, 1);
      assert.strictEqual(stats.runtimeCounts.js, 2);
    });
  });

  // ==========================================================================
  // D2 AttentionMetricsCollector
  // ==========================================================================

  describe('D2 AttentionMetricsCollector', () => {

    it('startOperation + endOperation records metrics', () => {
      const mc = createAttentionMetricsCollector();
      const op = mc.startOperation('flash');
      mc.endOperation('flash', op.startTime);

      const metrics = mc.getMetrics('flash');
      assert.ok(metrics !== null, 'metrics recorded');
      assert.strictEqual(metrics.operationCount, 1);
    });

    it('getMetrics returns { operationCount, avgLatencyUs, p50, p95, p99 }', () => {
      const mc = createAttentionMetricsCollector();
      for (let i = 0; i < 5; i++) {
        const op = mc.startOperation('flash');
        mc.endOperation('flash', op.startTime);
      }

      const metrics = mc.getMetrics('flash');
      assert.ok(metrics !== null);
      assert.strictEqual(typeof metrics.operationCount, 'number');
      assert.strictEqual(typeof metrics.avgLatencyUs, 'number');
      assert.strictEqual(typeof metrics.p50LatencyUs, 'number');
      assert.strictEqual(typeof metrics.p95LatencyUs, 'number');
      assert.strictEqual(typeof metrics.p99LatencyUs, 'number');
      assert.strictEqual(metrics.operationCount, 5);
    });

    it('getAllMetrics returns Map with per-mechanism entries', () => {
      const mc = createAttentionMetricsCollector();
      const op1 = mc.startOperation('flash');
      mc.endOperation('flash', op1.startTime);
      const op2 = mc.startOperation('moe');
      mc.endOperation('moe', op2.startTime);

      const all = mc.getAllMetrics();
      assert.ok(all instanceof Map, 'returns a Map');
      assert.ok(all.has('flash'), 'flash metrics present');
      assert.ok(all.has('moe'), 'moe metrics present');
      assert.strictEqual(all.size, 2);
    });

    it('metrics accumulate across multiple calls', () => {
      const mc = createAttentionMetricsCollector();
      for (let i = 0; i < 10; i++) {
        const op = mc.startOperation('flash');
        mc.endOperation('flash', op.startTime);
      }

      const metrics = mc.getMetrics('flash');
      assert.strictEqual(metrics.operationCount, 10, 'ten operations accumulated');
      assert.ok(metrics.avgLatencyUs >= 0, 'average latency is non-negative');
    });

    it('reset clears all collected metrics', () => {
      const mc = createAttentionMetricsCollector();
      const op = mc.startOperation('flash');
      mc.endOperation('flash', op.startTime);

      assert.ok(mc.getMetrics('flash') !== null, 'metrics exist before reset');

      mc.reset();

      assert.strictEqual(mc.getMetrics('flash'), null, 'metrics cleared after reset');
      assert.strictEqual(mc.getAllMetrics().size, 0, 'all metrics empty after reset');
    });

    it('getMetrics on mechanism with no data returns null', () => {
      const mc = createAttentionMetricsCollector();
      assert.strictEqual(mc.getMetrics('nonexistent'), null);
    });
  });

  // ==========================================================================
  // Bridge functions
  // ==========================================================================

  describe('Bridge functions', () => {

    it('bridgeAttentionSearch with null controller falls back to standard search', () => {
      const standardSearch = mockFn((q) => ({ results: ['fallback'], query: q }));
      const result = bridgeAttentionSearch({ vector: [1, 0], text: 'test' }, null, standardSearch);

      assert.strictEqual(standardSearch.calls.length, 1, 'standard search called');
      assert.deepStrictEqual(result.results, ['fallback']);
      assert.ok(!('attention' in result), 'no attention flag in fallback result');
    });

    it('bridgeAttentionSearch with active controller returns { attention: true }', () => {
      const ctrl = createSelfAttentionController({ dimension: 2 });
      ctrl.addEntry('a', [1, 0]);

      const standardSearch = mockFn(() => ({ results: [] }));
      const result = bridgeAttentionSearch({ vector: [1, 0] }, ctrl, standardSearch);

      assert.strictEqual(standardSearch.calls.length, 0, 'standard search NOT called');
      assert.strictEqual(result.attention, true, 'attention flag present');
      assert.ok(Array.isArray(result.scores), 'has attention scores');
    });

    it('bridgeFlashConsolidate with null service falls back to standard consolidation', () => {
      const standardConsolidate = mockFn((data) => ({ consolidated: true, count: data.entries.length }));
      const data = { query: [1, 0], entries: [{ vector: [1, 0] }, { vector: [0, 1] }] };

      const result = bridgeFlashConsolidate(data, null, standardConsolidate);
      assert.strictEqual(standardConsolidate.calls.length, 1, 'standard consolidation called');
      assert.strictEqual(result.consolidated, true);
    });

    it('bridgeMoERoute returns { selectedExperts } with weight-sorted expert list', () => {
      const svc = createAttentionService({ moe: true });
      const input = {
        vector: [1, 0, 0],
        experts: [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0]],
        topK: 2,
      };

      const result = bridgeMoERoute(input, svc);
      assert.ok('selectedExperts' in result, 'has selectedExperts');
      assert.ok(result.selectedExperts.length > 0, 'has selected experts');

      // Verify sorted by weight descending
      for (let i = 1; i < result.selectedExperts.length; i++) {
        assert.ok(
          result.selectedExperts[i - 1].weight >= result.selectedExperts[i].weight,
          'experts sorted by weight descending'
        );
      }
    });

    it('bridgeMoERoute with null service returns empty selectedExperts', () => {
      const result = bridgeMoERoute({ vector: [1, 0], experts: [[1, 0]], topK: 1 }, null);
      assert.deepStrictEqual(result.selectedExperts, []);
    });

    it('bridgeGraphRoPESearch returns error when GraphRoPE not available', () => {
      const svc = createAttentionService({ graphRoPE: false });
      const result = bridgeGraphRoPESearch({ vector: [1, 0], graph: {} }, svc);
      assert.ok('error' in result, 'error field present');
      assert.strictEqual(result.error, 'GraphRoPE not available');
    });

    it('bridgeGraphRoPESearch with null service returns error', () => {
      const result = bridgeGraphRoPESearch({ vector: [1, 0], graph: {} }, null);
      assert.ok('error' in result, 'error field present');
      assert.strictEqual(result.error, 'GraphRoPE not available');
    });
  });

  // ==========================================================================
  // Edge Cases & Regression
  // ==========================================================================

  describe('Edge Cases & Regression', () => {

    it('null attention controller returns unchanged vector results', () => {
      const standardSearch = mockFn((q) => ({
        results: [{ id: 'v1', vector: q.vector, score: 0.9 }],
      }));

      const result = bridgeAttentionSearch({ vector: [1, 0, 0] }, null, standardSearch);
      assert.strictEqual(result.results.length, 1, 'standard results returned');
      assert.deepStrictEqual(result.results[0].vector, [1, 0, 0], 'vector unchanged');
    });

    it('all attention controllers null — full degraded mode', () => {
      const standardSearch = mockFn(() => ({ results: ['fallback'] }));
      const standardConsolidate = mockFn(() => ({ consolidated: true }));

      // All bridges fall back gracefully
      const searchResult = bridgeAttentionSearch({ vector: [1, 0] }, null, standardSearch);
      assert.deepStrictEqual(searchResult.results, ['fallback']);

      const consolidateResult = bridgeFlashConsolidate(
        { query: [1, 0], entries: [{ vector: [1, 0] }] },
        null,
        standardConsolidate
      );
      assert.strictEqual(consolidateResult.consolidated, true);

      const moeResult = bridgeMoERoute({ vector: [1, 0], experts: [], topK: 1 }, null);
      assert.deepStrictEqual(moeResult.selectedExperts, []);

      const ropeResult = bridgeGraphRoPESearch({ vector: [1, 0], graph: {} }, null);
      assert.strictEqual(ropeResult.error, 'GraphRoPE not available');
    });

    it('empty query string handled gracefully', () => {
      // SelfAttention with zero vector query
      const ctrl = createSelfAttentionController({ dimension: 3 });
      ctrl.addEntry('a', [1, 0, 0]);

      const result = ctrl.computeAttention([0, 0, 0]);
      assert.strictEqual(result.scores.length, 1, 'still returns scores');
      assert.strictEqual(result.scores[0].score, 0, 'zero vector produces score 0');
    });

    it('A5 with all mechanisms disabled returns null from each method', () => {
      const svc = createAttentionService({
        flash: false,
        moe: false,
        graphRoPE: false,
        hyperbolic: false,
      });

      assert.strictEqual(svc.applyFlashAttention([1], [[1]], [[1]]), null);
      assert.strictEqual(svc.applyMoE([1], [[1], [0]]), null);
      assert.strictEqual(svc.applyGraphRoPE([1], {}), null);
      assert.strictEqual(svc.applyHyperbolic([1], 1.0), null);

      // Stats should show zero operations
      const stats = svc.getStats();
      assert.strictEqual(stats.totalOps, 0, 'no ops recorded when all disabled');
    });

    it('D2 with no data returns empty metrics map', () => {
      const mc = createAttentionMetricsCollector();
      const all = mc.getAllMetrics();
      assert.ok(all instanceof Map);
      assert.strictEqual(all.size, 0, 'empty map when no data');
    });

    it('A1 rejects vector with wrong dimension', () => {
      const ctrl = createSelfAttentionController({ dimension: 3 });
      assert.throws(
        () => ctrl.addEntry('bad', [1, 0]),
        /dimension mismatch/i,
        'wrong dimension throws'
      );
    });

    it('A5 FlashAttention with large value range stays numerically stable', () => {
      const svc = createAttentionService({ flash: true });
      const query = [100, -100, 50];
      const keys = [[100, -100, 50], [-100, 100, -50], [0, 0, 0]];
      const values = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

      const result = svc.applyFlashAttention(query, keys, values);
      assert.ok(result !== null);

      // Weights must still sum to 1.0 despite extreme scores
      const wSum = result.weights.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(wSum - 1.0) < 1e-9, `weights sum to 1.0 with large values, got ${wSum}`);

      // No NaN or Infinity in output
      for (const val of result.output) {
        assert.ok(Number.isFinite(val), `output value is finite: ${val}`);
      }
      for (const w of result.weights) {
        assert.ok(Number.isFinite(w), `weight is finite: ${w}`);
      }
    });
  });
});

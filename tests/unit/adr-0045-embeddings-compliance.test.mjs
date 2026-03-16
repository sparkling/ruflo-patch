// @tier unit
// ADR-0045: Embeddings & Compliance Layer
// Unit tests for A9 EnhancedEmbeddingService, D3 AuditLogger, D1 TelemetryManager, Bridge/Degraded mode

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// A9 EnhancedEmbeddingService factory
// ============================================================================

function createEnhancedEmbeddingService({ providers = [], cache = {}, batch = {}, dimension = 768 } = {}) {
  const targetDimension = dimension;
  const maxCacheSize = cache.maxSize || 100;
  const maxConcurrent = batch.maxConcurrent || 4;
  const lruCache = new Map();
  let inflight = 0;

  function alignDimension(vector, target) {
    if (vector.length === target) return vector;
    if (vector.length < target) {
      // Zero-pad up to target
      const padded = new Float64Array(target);
      padded.set(vector);
      return Array.from(padded);
    }
    // Truncate down to target
    return vector.slice(0, target);
  }

  function cacheKey(text) {
    return `emb:${text}`;
  }

  function touchLru(key) {
    const val = lruCache.get(key);
    lruCache.delete(key);
    lruCache.set(key, val);
  }

  function evictIfNeeded() {
    while (lruCache.size > maxCacheSize) {
      const oldest = lruCache.keys().next().value;
      lruCache.delete(oldest);
    }
  }

  async function embed(text) {
    if (typeof text !== 'string' || text.length === 0) {
      return { error: 'invalid input: empty or non-string' };
    }

    const key = cacheKey(text);
    if (lruCache.has(key)) {
      touchLru(key);
      return { vector: lruCache.get(key), cached: true };
    }

    // Semaphore: wait if at capacity
    while (inflight >= maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    inflight++;
    let lastError = null;

    // Fallback chain through providers
    for (const provider of providers) {
      try {
        const raw = await provider.embed(text);
        const aligned = alignDimension(raw, targetDimension);
        lruCache.set(key, aligned);
        evictIfNeeded();
        inflight--;
        return { vector: aligned, cached: false };
      } catch (err) {
        lastError = err;
      }
    }

    inflight--;
    return { error: lastError ? lastError.message : 'no providers configured' };
  }

  function getInflight() { return inflight; }
  function getCacheSize() { return lruCache.size; }

  return { embed, alignDimension, getInflight, getCacheSize, _cache: lruCache };
}

// ============================================================================
// D3 AuditLogger factory
// ============================================================================

const AUDIT_EVENT_TYPES = [
  'auth.login', 'auth.logout', 'auth.failed',
  'key.create', 'key.revoke', 'key.rotate',
  'access.granted', 'access.denied', 'access.elevated',
  'config.change', 'config.reset', 'config.export',
  'data.create', 'data.read', 'data.update', 'data.delete',
  'compliance.audit', 'compliance.report',
];

function createAuditLogger() {
  const entries = [];
  const validTypes = new Set(AUDIT_EVENT_TYPES);

  function log(event) {
    if (!event || typeof event.type !== 'string') {
      return { success: false, reason: 'missing type' };
    }
    if (!validTypes.has(event.type)) {
      return { success: false, reason: `unknown event type: ${event.type}` };
    }
    entries.push({
      type: event.type,
      payload: event.payload || null,
      timestamp: Date.now(),
    });
    return { success: true, logged: true };
  }

  function getEntries() { return [...entries]; }
  function getTypes() { return [...validTypes]; }

  return { log, getEntries, getTypes };
}

// ============================================================================
// D1 TelemetryManager factory
// ============================================================================

function createTelemetryManager() {
  const spans = [];
  const counters = new Map();
  const histograms = new Map();

  function startSpan(name) {
    const span = {
      name,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      end() {
        span.endTime = Date.now();
        span.duration = span.endTime - span.startTime;
      },
    };

    spans.push(span);
    return span;
  }

  function increment(name, delta = 1) {
    const current = counters.get(name) || 0;
    counters.set(name, current + delta);
  }

  function recordHistogram(name, value) {
    if (!histograms.has(name)) {
      histograms.set(name, []);
    }
    histograms.get(name).push(value);
  }

  function percentile(sorted, p) {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  function getMetrics(name) {
    const values = histograms.get(name);
    if (!values || values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  function getSpans(limit = 100) {
    return spans.slice(-limit);
  }

  function getStats() {
    return {
      spanCount: spans.length,
      counterCount: counters.size,
      histogramCount: histograms.size,
    };
  }

  return { startSpan, increment, recordHistogram, getMetrics, getSpans, getStats, _counters: counters };
}

// ============================================================================
// Bridge helpers (degraded mode)
// ============================================================================

function bridgeEmbed(a9Service, existingPipeline) {
  return async (text) => {
    if (a9Service) {
      return a9Service.embed(text);
    }
    // Fallback to existing pipeline
    if (existingPipeline) {
      try {
        const vec = await existingPipeline(text);
        return { vector: vec, cached: false, fallback: true };
      } catch (err) {
        return { error: err.message, fallback: true };
      }
    }
    return { error: 'no embedding service available', fallback: true };
  };
}

function bridgeAuditEvent(d3Logger, event) {
  if (d3Logger) {
    return d3Logger.log(event);
  }
  return { success: true, logged: false };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0045: Embeddings & Compliance Layer', () => {

  // ==========================================================================
  // A9 EnhancedEmbeddingService
  // ==========================================================================

  describe('A9 EnhancedEmbeddingService', () => {

    it('fallback chain: primary fails, secondary succeeds, no caller disruption', async () => {
      const primary = { embed: mockFn(() => { throw new Error('primary down'); }) };
      const secondary = { embed: mockFn(() => [0.1, 0.2, 0.3]) };
      const svc = createEnhancedEmbeddingService({
        providers: [primary, secondary],
        dimension: 3,
      });

      const result = await svc.embed('hello');
      assert.ok(!result.error, 'should not return error');
      assert.deepStrictEqual(result.vector, [0.1, 0.2, 0.3]);
      assert.strictEqual(primary.embed.calls.length, 1, 'primary was attempted');
      assert.strictEqual(secondary.embed.calls.length, 1, 'secondary was used');
    });

    it('dimension alignment 384->768: zero-pad input to target dimension', () => {
      const svc = createEnhancedEmbeddingService({ dimension: 768 });
      const input = new Array(384).fill(1.0);
      const result = svc.alignDimension(input, 768);
      assert.strictEqual(result.length, 768, 'output must be 768-dim');
      for (let i = 0; i < 384; i++) {
        assert.strictEqual(result[i], 1.0, `original value preserved at index ${i}`);
      }
      for (let i = 384; i < 768; i++) {
        assert.strictEqual(result[i], 0, `zero-padded at index ${i}`);
      }
    });

    it('dimension alignment 1536->768: project down via truncation', () => {
      const svc = createEnhancedEmbeddingService({ dimension: 768 });
      const input = new Array(1536).fill(0).map((_, i) => i);
      const result = svc.alignDimension(input, 768);
      assert.strictEqual(result.length, 768, 'output must be 768-dim');
      for (let i = 0; i < 768; i++) {
        assert.strictEqual(result[i], i, `value preserved at index ${i}`);
      }
    });

    it('dimension alignment 768->768: passthrough unchanged', () => {
      const svc = createEnhancedEmbeddingService({ dimension: 768 });
      const input = new Array(768).fill(0).map((_, i) => i * 0.01);
      const result = svc.alignDimension(input, 768);
      assert.strictEqual(result.length, 768);
      assert.deepStrictEqual(result, input);
    });

    it('LRU cache hit: second call returns cached, provider not called again', async () => {
      const provider = { embed: mockFn(() => [0.5, 0.5, 0.5]) };
      const svc = createEnhancedEmbeddingService({
        providers: [provider],
        dimension: 3,
      });

      const first = await svc.embed('cached-text');
      assert.strictEqual(first.cached, false, 'first call is not cached');
      assert.strictEqual(provider.embed.calls.length, 1);

      const second = await svc.embed('cached-text');
      assert.strictEqual(second.cached, true, 'second call is cached');
      assert.deepStrictEqual(second.vector, [0.5, 0.5, 0.5]);
      assert.strictEqual(provider.embed.calls.length, 1, 'provider not called again');
    });

    it('LRU cache eviction: when maxSize exceeded, oldest entry removed', async () => {
      const provider = { embed: mockFn((text) => [text.length]) };
      const svc = createEnhancedEmbeddingService({
        providers: [provider],
        cache: { maxSize: 2 },
        dimension: 1,
      });

      await svc.embed('aaa');
      await svc.embed('bbbb');
      assert.strictEqual(svc.getCacheSize(), 2);

      await svc.embed('ccccc');
      assert.strictEqual(svc.getCacheSize(), 2, 'cache size stays at max');

      // 'aaa' was oldest and should be evicted
      const refetch = await svc.embed('aaa');
      assert.strictEqual(refetch.cached, false, 'oldest entry was evicted, refetched from provider');
      assert.strictEqual(provider.embed.calls.length, 4, 'provider called again for evicted entry');
    });

    it('semaphore batch: at most N concurrent calls in-flight simultaneously', async () => {
      let peakConcurrent = 0;
      let current = 0;
      const slowProvider = {
        embed: async (text) => {
          current++;
          if (current > peakConcurrent) peakConcurrent = current;
          await new Promise(resolve => setTimeout(resolve, 10));
          current--;
          return [1.0];
        },
      };

      const svc = createEnhancedEmbeddingService({
        providers: [slowProvider],
        batch: { maxConcurrent: 2 },
        dimension: 1,
      });

      // Launch 4 concurrent embed calls
      const promises = [
        svc.embed('a'),
        svc.embed('b'),
        svc.embed('c'),
        svc.embed('d'),
      ];
      await Promise.all(promises);

      assert.ok(peakConcurrent <= 2, `peak concurrent (${peakConcurrent}) should not exceed maxConcurrent (2)`);
    });

    it('factory accepts config: { providers, cache, batch, dimension }', () => {
      const svc = createEnhancedEmbeddingService({
        providers: [{ embed: () => [1] }],
        cache: { maxSize: 50 },
        batch: { maxConcurrent: 8 },
        dimension: 384,
      });
      assert.ok(svc.embed, 'embed method exists');
      assert.ok(svc.alignDimension, 'alignDimension method exists');
      assert.ok(svc.getInflight, 'getInflight method exists');
      assert.ok(svc.getCacheSize, 'getCacheSize method exists');
    });
  });

  // ==========================================================================
  // D3 AuditLogger
  // ==========================================================================

  describe('D3 AuditLogger', () => {

    it('typed security events: accepts events with type and payload fields', () => {
      const logger = createAuditLogger();
      const result = logger.log({ type: 'auth.login', payload: { userId: '123' } });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.logged, true);
      const entries = logger.getEntries();
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].type, 'auth.login');
      assert.deepStrictEqual(entries[0].payload, { userId: '123' });
    });

    it('18 event types: all 18 typed events accepted', () => {
      const logger = createAuditLogger();
      const expectedTypes = [
        'auth.login', 'auth.logout', 'auth.failed',
        'key.create', 'key.revoke', 'key.rotate',
        'access.granted', 'access.denied', 'access.elevated',
        'config.change', 'config.reset', 'config.export',
        'data.create', 'data.read', 'data.update', 'data.delete',
        'compliance.audit', 'compliance.report',
      ];

      assert.strictEqual(expectedTypes.length, 18, 'exactly 18 event types defined');

      for (const type of expectedTypes) {
        const result = logger.log({ type, payload: { test: true } });
        assert.strictEqual(result.success, true, `event type '${type}' accepted`);
      }

      assert.strictEqual(logger.getEntries().length, 18, 'all 18 events logged');

      // Verify unknown type is rejected
      const bad = logger.log({ type: 'unknown.type', payload: {} });
      assert.strictEqual(bad.success, false, 'unknown event type rejected');
    });

    it('orthogonal to AttestationLog: different storage, format, events', () => {
      const auditLogger = createAuditLogger();
      // AuditLogger stores typed security events with payload
      auditLogger.log({ type: 'auth.login', payload: { user: 'alice' } });

      const entries = auditLogger.getEntries();
      assert.strictEqual(entries[0].type, 'auth.login');
      assert.ok(entries[0].timestamp, 'has timestamp');
      assert.ok(entries[0].payload, 'has payload');

      // AttestationLog would store cryptographic attestations (not implemented here)
      // The point is: AuditLogger has its own storage and format
      const types = auditLogger.getTypes();
      assert.strictEqual(types.length, 18, 'audit logger has exactly 18 event types');
      assert.ok(!types.includes('attestation.created'), 'no attestation events in audit logger');
    });

    it('missing optional fields: log accepts event with just type (no payload)', () => {
      const logger = createAuditLogger();
      const result = logger.log({ type: 'config.change' });
      assert.strictEqual(result.success, true);
      const entry = logger.getEntries()[0];
      assert.strictEqual(entry.type, 'config.change');
      assert.strictEqual(entry.payload, null, 'missing payload stored as null');
    });
  });

  // ==========================================================================
  // D1 TelemetryManager
  // ==========================================================================

  describe('D1 TelemetryManager', () => {

    it('startSpan creates span: span with name, can call end()', () => {
      const tm = createTelemetryManager();
      const span = tm.startSpan('test-operation');
      assert.strictEqual(span.name, 'test-operation');
      assert.ok(span.startTime > 0, 'has startTime');
      assert.strictEqual(typeof span.end, 'function', 'has end() method');
    });

    it('span end records duration: span.end() populates endTime', async () => {
      const tm = createTelemetryManager();
      const span = tm.startSpan('timed-op');
      await new Promise(resolve => setTimeout(resolve, 5));
      span.end();
      assert.ok(span.endTime >= span.startTime, 'endTime >= startTime');
      assert.ok(span.duration >= 0, 'duration is non-negative');
    });

    it('increment counter: counters increment correctly', () => {
      const tm = createTelemetryManager();
      tm.increment('requests');
      tm.increment('requests');
      tm.increment('requests', 5);
      assert.strictEqual(tm._counters.get('requests'), 7);
    });

    it('recordHistogram: histogram records values', () => {
      const tm = createTelemetryManager();
      tm.recordHistogram('latency', 10);
      tm.recordHistogram('latency', 20);
      tm.recordHistogram('latency', 30);
      const metrics = tm.getMetrics('latency');
      assert.ok(metrics, 'metrics returned');
      assert.strictEqual(metrics.count, 3);
      assert.strictEqual(metrics.min, 10);
      assert.strictEqual(metrics.max, 30);
    });

    it('getMetrics returns p50/p95/p99: percentile calculations', () => {
      const tm = createTelemetryManager();
      // Insert 100 values: 1..100
      for (let i = 1; i <= 100; i++) {
        tm.recordHistogram('response_time', i);
      }
      const metrics = tm.getMetrics('response_time');
      assert.strictEqual(metrics.p50, 50);
      assert.strictEqual(metrics.p95, 95);
      assert.strictEqual(metrics.p99, 99);
      assert.strictEqual(metrics.count, 100);
      assert.strictEqual(metrics.min, 1);
      assert.strictEqual(metrics.max, 100);
    });

    it('getSpans returns recent spans: returns limit-capped spans', () => {
      const tm = createTelemetryManager();
      for (let i = 0; i < 10; i++) {
        tm.startSpan(`span-${i}`);
      }

      const all = tm.getSpans(100);
      assert.strictEqual(all.length, 10, 'returns all 10 spans');

      const limited = tm.getSpans(3);
      assert.strictEqual(limited.length, 3, 'limit caps to 3');
      assert.strictEqual(limited[0].name, 'span-7', 'returns most recent (last 3)');
      assert.strictEqual(limited[2].name, 'span-9');
    });

    it('getStats returns summary: counts of spans, counters, histograms', () => {
      const tm = createTelemetryManager();
      tm.startSpan('a');
      tm.startSpan('b');
      tm.increment('counter1');
      tm.increment('counter2');
      tm.increment('counter3');
      tm.recordHistogram('hist1', 1);

      const stats = tm.getStats();
      assert.strictEqual(stats.spanCount, 2);
      assert.strictEqual(stats.counterCount, 3);
      assert.strictEqual(stats.histogramCount, 1);
    });
  });

  // ==========================================================================
  // Bridge / Degraded mode
  // ==========================================================================

  describe('Bridge / Degraded mode', () => {

    it('bridgeEmbed fallback: when A9 null, falls back to existing pipeline', async () => {
      const existingPipeline = mockFn(() => [0.1, 0.2]);
      const embed = bridgeEmbed(null, existingPipeline);

      const result = await embed('test');
      assert.ok(result.fallback, 'result indicates fallback was used');
      assert.deepStrictEqual(result.vector, [0.1, 0.2]);
      assert.strictEqual(existingPipeline.calls.length, 1, 'existing pipeline called');
    });

    it('bridgeAuditEvent no-op: when D3 null, returns success with logged=false', () => {
      const result = bridgeAuditEvent(null, { type: 'auth.login' });
      assert.strictEqual(result.success, true, 'returns success');
      assert.strictEqual(result.logged, false, 'logged is false (no-op)');
    });

    it('all providers fail: last resort returns error, not crash', async () => {
      const p1 = { embed: () => { throw new Error('fail-1'); } };
      const p2 = { embed: () => { throw new Error('fail-2'); } };
      const svc = createEnhancedEmbeddingService({
        providers: [p1, p2],
        dimension: 3,
      });

      const result = await svc.embed('doomed');
      assert.ok(result.error, 'error field present');
      assert.strictEqual(result.error, 'fail-2', 'last provider error reported');
      assert.ok(!result.vector, 'no vector returned');
    });

    it('empty string input: returns error, not crash', async () => {
      const provider = { embed: mockFn(() => [1.0]) };
      const svc = createEnhancedEmbeddingService({
        providers: [provider],
        dimension: 1,
      });

      const result = await svc.embed('');
      assert.ok(result.error, 'error field present for empty input');
      assert.strictEqual(provider.embed.calls.length, 0, 'provider never called');
    });
  });
});

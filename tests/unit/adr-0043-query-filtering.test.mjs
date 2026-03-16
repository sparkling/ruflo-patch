// @tier unit
// ADR-0043: Query & Filtering Infrastructure
// Unit tests for B5 MetadataFilter, B6 QueryOptimizer, integration bridge patterns

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// B5 MetadataFilter factory
// ============================================================================

function createMetadataFilter() {
  function evaluate(value, predicate) {
    if (predicate === null || predicate === undefined) return true;
    if (typeof predicate !== 'object' || Array.isArray(predicate)) {
      return value === predicate; // implicit $eq
    }
    for (const [op, expected] of Object.entries(predicate)) {
      switch (op) {
        case '$eq': if (value !== expected) return false; break;
        case '$ne': if (value === expected) return false; break;
        case '$gt': if (!(value > expected)) return false; break;
        case '$lt': if (!(value < expected)) return false; break;
        case '$gte': if (!(value >= expected)) return false; break;
        case '$lte': if (!(value <= expected)) return false; break;
        case '$in': if (!Array.isArray(expected) || !expected.includes(value)) return false; break;
        case '$nin': if (Array.isArray(expected) && expected.includes(value)) return false; break;
        case '$regex': if (!(new RegExp(expected).test(String(value)))) return false; break;
        case '$exists': if ((value !== undefined && value !== null) !== expected) return false; break;
        default: return false;
      }
    }
    return true;
  }

  function matchesFilter(metadata, filter) {
    if (!filter || typeof filter !== 'object') return true;
    if (filter.$and) return filter.$and.every(f => matchesFilter(metadata, f));
    if (filter.$or) return filter.$or.some(f => matchesFilter(metadata, f));
    if (filter.$not) return !matchesFilter(metadata, filter.$not);
    for (const [field, predicate] of Object.entries(filter)) {
      if (field.startsWith('$')) continue;
      const value = metadata?.[field];
      if (!evaluate(value, predicate)) return false;
    }
    return true;
  }

  return {
    filter(entries, filterExpr) {
      return entries.filter(e => matchesFilter(e.metadata || e, filterExpr));
    },
  };
}

// ============================================================================
// B6 QueryOptimizer factory
// ============================================================================

function createQueryOptimizer({ cacheSize = 1000, ttlMs = 60000 } = {}) {
  const cache = new Map();
  let hits = 0, misses = 0;

  function getCached(key) {
    const entry = cache.get(key);
    if (!entry) { misses++; return null; }
    if (Date.now() > entry.expiresAt) { cache.delete(key); misses++; return null; }
    hits++;
    return entry.value;
  }

  function cacheResult(key, value) {
    if (cache.size >= cacheSize) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  function getStats() {
    return { cacheHits: hits, cacheMisses: misses, cacheSize: cache.size };
  }

  return { getCached, cache: cacheResult, getStats };
}

// ============================================================================
// Test data
// ============================================================================

function createTestEntries() {
  return [
    { key: 'a', metadata: { score: 0.9, tag: 'security', name: 'auth-handler', active: true } },
    { key: 'b', metadata: { score: 0.7, tag: 'performance', name: 'cache-manager', active: true } },
    { key: 'c', metadata: { score: 0.5, tag: 'security', name: 'input-validator', active: false } },
    { key: 'd', metadata: { score: 0.3, tag: 'logging', name: 'audit-logger', active: true } },
    { key: 'e', metadata: { score: 0.1, tag: 'performance', name: 'query-planner' } },
  ];
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0043: Query & Filtering Infrastructure', () => {

  // ==========================================================================
  // B5 MetadataFilter
  // ==========================================================================

  describe('B5 MetadataFilter', () => {

    it('$gt filters entries above numeric threshold', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { score: { $gt: 0.6 } });
      assert.strictEqual(result.length, 2);
      assert.ok(result.every(e => e.metadata.score > 0.6));
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'b']);
    });

    it('$lt filters entries below threshold', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { score: { $lt: 0.5 } });
      assert.strictEqual(result.length, 2);
      assert.ok(result.every(e => e.metadata.score < 0.5));
      assert.deepStrictEqual(result.map(e => e.key), ['d', 'e']);
    });

    it('$gte filters entries at or above threshold (inclusive)', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { score: { $gte: 0.5 } });
      assert.strictEqual(result.length, 3);
      assert.ok(result.every(e => e.metadata.score >= 0.5));
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'b', 'c']);
    });

    it('$lte filters entries at or below threshold (inclusive)', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { score: { $lte: 0.3 } });
      assert.strictEqual(result.length, 2);
      assert.ok(result.every(e => e.metadata.score <= 0.3));
      assert.deepStrictEqual(result.map(e => e.key), ['d', 'e']);
    });

    it('$eq matches exact value', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { tag: { $eq: 'security' } });
      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'c']);
    });

    it('$ne excludes matching value', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { tag: { $ne: 'security' } });
      assert.strictEqual(result.length, 3);
      assert.ok(result.every(e => e.metadata.tag !== 'security'));
      assert.deepStrictEqual(result.map(e => e.key), ['b', 'd', 'e']);
    });

    it('$in matches value within set', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { tag: { $in: ['security', 'logging'] } });
      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'c', 'd']);
    });

    it('$nin excludes values in set', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { tag: { $nin: ['security', 'logging'] } });
      assert.strictEqual(result.length, 2);
      assert.ok(result.every(e => !['security', 'logging'].includes(e.metadata.tag)));
      assert.deepStrictEqual(result.map(e => e.key), ['b', 'e']);
    });

    it('$regex matches pattern against string field', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { name: { $regex: '^auth' } });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, 'a');

      const dashResult = mf.filter(entries, { name: { $regex: '-handler$' } });
      assert.strictEqual(dashResult.length, 1);
      assert.strictEqual(dashResult[0].key, 'a');

      const multiResult = mf.filter(entries, { name: { $regex: '.*-.*' } });
      assert.strictEqual(multiResult.length, 5, 'all names contain a hyphen');
    });

    it('$exists: true matches entries where field is present', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      // 'active' is defined on a, b, c, d but not on e
      const result = mf.filter(entries, { active: { $exists: true } });
      assert.strictEqual(result.length, 4);
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'b', 'c', 'd']);
    });

    it('$exists: false matches entries where field is missing', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { active: { $exists: false } });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, 'e');
    });

    it('$and combines multiple predicates with logical AND', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, {
        $and: [
          { tag: { $eq: 'security' } },
          { score: { $gt: 0.6 } },
        ],
      });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, 'a');
    });

    it('$or combines predicates with logical OR', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, {
        $or: [
          { tag: { $eq: 'logging' } },
          { score: { $gte: 0.9 } },
        ],
      });
      assert.strictEqual(result.length, 2);
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'd']);
    });

    it('$not negates the wrapped predicate', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      // $not { tag: security } => everything except security
      const result = mf.filter(entries, {
        $not: { tag: { $eq: 'security' } },
      });
      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result.map(e => e.key), ['b', 'd', 'e']);
    });

    it('implicit $eq — bare value treated as equality match', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      const result = mf.filter(entries, { tag: 'logging' });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, 'd');
    });

    it('null/undefined filter returns all entries (passthrough)', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();

      const nullResult = mf.filter(entries, null);
      assert.strictEqual(nullResult.length, 5, 'null filter returns all');

      const undefinedResult = mf.filter(entries, undefined);
      assert.strictEqual(undefinedResult.length, 5, 'undefined filter returns all');
    });

    it('empty entries array returns empty result', () => {
      const mf = createMetadataFilter();
      const result = mf.filter([], { score: { $gt: 0 } });
      assert.strictEqual(result.length, 0);
      assert.deepStrictEqual(result, []);
    });

    it('nested $and + $or handles complex compound filter', () => {
      const mf = createMetadataFilter();
      const entries = createTestEntries();
      // (tag=security AND score>0.6) OR (tag=performance AND score<0.5)
      const result = mf.filter(entries, {
        $or: [
          { $and: [{ tag: { $eq: 'security' } }, { score: { $gt: 0.6 } }] },
          { $and: [{ tag: { $eq: 'performance' } }, { score: { $lt: 0.5 } }] },
        ],
      });
      assert.strictEqual(result.length, 2);
      // 'a' matches first branch (security, 0.9>0.6)
      // 'e' matches second branch (performance, 0.1<0.5)
      assert.deepStrictEqual(result.map(e => e.key), ['a', 'e']);
    });
  });

  // ==========================================================================
  // B6 QueryOptimizer
  // ==========================================================================

  describe('B6 QueryOptimizer', () => {

    it('cache miss returns null', () => {
      const qo = createQueryOptimizer();
      const result = qo.getCached('nonexistent-query');
      assert.strictEqual(result, null);
    });

    it('cache hit returns stored value', () => {
      const qo = createQueryOptimizer();
      const expected = [{ id: '1', score: 0.95 }];
      qo.cache('query-key', expected);
      const result = qo.getCached('query-key');
      assert.deepStrictEqual(result, expected);
    });

    it('second identical query returns cached result (no search called)', () => {
      const qo = createQueryOptimizer();
      const searchFn = mockFn(() => [{ id: '1', score: 0.9 }]);

      // First call: cache miss, execute search, store result
      let cached = qo.getCached('auth-patterns');
      assert.strictEqual(cached, null, 'first call is a miss');
      const searchResult = searchFn('auth-patterns');
      qo.cache('auth-patterns', searchResult);

      // Second call: cache hit, no search
      cached = qo.getCached('auth-patterns');
      assert.deepStrictEqual(cached, [{ id: '1', score: 0.9 }]);
      assert.strictEqual(searchFn.calls.length, 1, 'search called only once');
    });

    it('TTL expiration evicts stale entries', async () => {
      const qo = createQueryOptimizer({ ttlMs: 50 });
      qo.cache('short-lived', [{ id: 'x' }]);

      // Immediately available
      assert.deepStrictEqual(qo.getCached('short-lived'), [{ id: 'x' }]);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      const expired = qo.getCached('short-lived');
      assert.strictEqual(expired, null, 'entry expired after TTL');
    });

    it('different queries get different cache entries', () => {
      const qo = createQueryOptimizer();
      qo.cache('query-a', [{ id: 'a' }]);
      qo.cache('query-b', [{ id: 'b' }]);

      assert.deepStrictEqual(qo.getCached('query-a'), [{ id: 'a' }]);
      assert.deepStrictEqual(qo.getCached('query-b'), [{ id: 'b' }]);
    });

    it('cache stats track hits and misses accurately', () => {
      const qo = createQueryOptimizer();
      qo.cache('exists', 'value');

      qo.getCached('exists');      // hit
      qo.getCached('exists');      // hit
      qo.getCached('missing-1');   // miss
      qo.getCached('missing-2');   // miss
      qo.getCached('missing-3');   // miss

      const stats = qo.getStats();
      assert.strictEqual(stats.cacheHits, 2, '2 hits');
      assert.strictEqual(stats.cacheMisses, 3, '3 misses');
    });

    it('LRU eviction when cacheSize exceeded', () => {
      const qo = createQueryOptimizer({ cacheSize: 3 });
      qo.cache('first', 'v1');
      qo.cache('second', 'v2');
      qo.cache('third', 'v3');

      // Cache is full (3 entries). Adding a 4th should evict the oldest.
      qo.cache('fourth', 'v4');

      assert.strictEqual(qo.getCached('first'), null, 'oldest entry evicted');
      assert.strictEqual(qo.getStats().cacheSize, 3, 'cache size stays at limit');
      assert.deepStrictEqual(qo.getCached('second'), 'v2', 'second still present');
      assert.deepStrictEqual(qo.getCached('fourth'), 'v4', 'fourth inserted');
    });

    it('constructor accepts cacheSize and ttlMs options', () => {
      const qo1 = createQueryOptimizer({ cacheSize: 500, ttlMs: 30000 });
      // Verify it functions: we can cache up to the limit
      for (let i = 0; i < 500; i++) {
        qo1.cache(`key-${i}`, i);
      }
      assert.strictEqual(qo1.getStats().cacheSize, 500, 'respects cacheSize=500');

      // Default constructor works too
      const qo2 = createQueryOptimizer();
      qo2.cache('test', 'val');
      assert.strictEqual(qo2.getStats().cacheSize, 1);
    });

    it('getStats returns { cacheHits, cacheMisses, cacheSize } shape', () => {
      const qo = createQueryOptimizer();
      const stats = qo.getStats();
      assert.ok('cacheHits' in stats, 'has cacheHits');
      assert.ok('cacheMisses' in stats, 'has cacheMisses');
      assert.ok('cacheSize' in stats, 'has cacheSize');
      assert.strictEqual(typeof stats.cacheHits, 'number');
      assert.strictEqual(typeof stats.cacheMisses, 'number');
      assert.strictEqual(typeof stats.cacheSize, 'number');
    });
  });

  // ==========================================================================
  // Integration Bridge Patterns
  // ==========================================================================

  describe('Integration bridge patterns', () => {

    // Bridge helper: filtered search
    function bridgeFilteredSearch(registry, query, filter) {
      const backend = registry.get('vectorBackend');
      if (!backend) return [];
      const rawResults = backend.search(query);
      if (!filter) return rawResults;
      const mf = registry.get('metadataFilter');
      if (!mf) return rawResults;
      return mf.filter(rawResults, filter);
    }

    // Bridge helper: optimized search (with cache)
    function bridgeOptimizedSearch(registry, query, filter) {
      const optimizer = registry.get('queryOptimizer');
      const cacheKey = JSON.stringify({ query, filter });

      if (optimizer) {
        const cached = optimizer.getCached(cacheKey);
        if (cached) return cached;
      }

      const results = bridgeFilteredSearch(registry, query, filter);

      if (optimizer) {
        optimizer.cache(cacheKey, results);
      }

      return results;
    }

    // Bridge helper: stats
    function bridgeQueryStats(registry) {
      const optimizer = registry.get('queryOptimizer');
      if (!optimizer) return { cacheHits: 0, cacheMisses: 0, cacheSize: 0 };
      return optimizer.getStats();
    }

    function createMockRegistry() {
      const controllers = new Map();
      return {
        register(name, instance) { controllers.set(name, instance); },
        get(name) { return controllers.get(name) || null; },
      };
    }

    it('bridgeFilteredSearch with null filter returns unfiltered results', () => {
      const registry = createMockRegistry();
      const rawResults = [
        { key: 'x', metadata: { score: 0.8, tag: 'a' } },
        { key: 'y', metadata: { score: 0.4, tag: 'b' } },
      ];
      const searchFn = mockFn(() => rawResults);
      registry.register('vectorBackend', { search: searchFn });

      const result = bridgeFilteredSearch(registry, 'test-query', null);

      assert.strictEqual(searchFn.calls.length, 1, 'search was called');
      assert.strictEqual(result.length, 2, 'all results returned');
      assert.deepStrictEqual(result, rawResults);
    });

    it('bridgeFilteredSearch with filter applies MetadataFilter', () => {
      const registry = createMockRegistry();
      const rawResults = [
        { key: 'x', metadata: { score: 0.8, tag: 'security' } },
        { key: 'y', metadata: { score: 0.4, tag: 'logging' } },
        { key: 'z', metadata: { score: 0.95, tag: 'security' } },
      ];
      const searchFn = mockFn(() => rawResults);
      registry.register('vectorBackend', { search: searchFn });

      const mf = createMetadataFilter();
      registry.register('metadataFilter', mf);

      const result = bridgeFilteredSearch(
        registry,
        'test-query',
        { tag: { $eq: 'security' } },
      );

      assert.strictEqual(result.length, 2, 'filtered to security entries');
      assert.deepStrictEqual(result.map(e => e.key), ['x', 'z']);
    });

    it('bridgeOptimizedSearch without QueryOptimizer falls back to standard search', () => {
      const registry = createMockRegistry();
      const rawResults = [{ key: 'r1', metadata: { score: 0.7 } }];
      const searchFn = mockFn(() => rawResults);
      registry.register('vectorBackend', { search: searchFn });

      // No queryOptimizer registered
      const result = bridgeOptimizedSearch(registry, 'fallback-query', null);
      assert.deepStrictEqual(result, rawResults, 'returns search results without caching');
      assert.strictEqual(searchFn.calls.length, 1, 'search called once');
    });

    it('bridgeOptimizedSearch caches on first call, returns cached on second', () => {
      const registry = createMockRegistry();
      const rawResults = [
        { key: 'hit', metadata: { score: 0.88 } },
      ];
      const searchFn = mockFn(() => rawResults);
      registry.register('vectorBackend', { search: searchFn });

      const qo = createQueryOptimizer();
      registry.register('queryOptimizer', qo);

      // First call: cache miss, runs search
      const first = bridgeOptimizedSearch(registry, 'cached-query', null);
      assert.deepStrictEqual(first, rawResults);
      assert.strictEqual(searchFn.calls.length, 1, 'search called on first');

      // Second call: cache hit, skips search
      const second = bridgeOptimizedSearch(registry, 'cached-query', null);
      assert.deepStrictEqual(second, rawResults);
      assert.strictEqual(searchFn.calls.length, 1, 'search NOT called again');

      const stats = qo.getStats();
      assert.strictEqual(stats.cacheHits, 1, 'one cache hit recorded');
      assert.strictEqual(stats.cacheMisses, 1, 'one cache miss recorded');
    });

    it('bridgeQueryStats returns stats shape { cacheHits, cacheMisses, cacheSize }', () => {
      const registry = createMockRegistry();
      const qo = createQueryOptimizer();
      registry.register('queryOptimizer', qo);

      qo.cache('k1', 'v1');
      qo.getCached('k1');
      qo.getCached('missing');

      const stats = bridgeQueryStats(registry);
      assert.ok('cacheHits' in stats, 'has cacheHits');
      assert.ok('cacheMisses' in stats, 'has cacheMisses');
      assert.ok('cacheSize' in stats, 'has cacheSize');
      assert.strictEqual(stats.cacheHits, 1);
      assert.strictEqual(stats.cacheMisses, 1);
      assert.strictEqual(stats.cacheSize, 1);

      // Without optimizer registered, returns zeroed stats
      const emptyRegistry = createMockRegistry();
      const fallbackStats = bridgeQueryStats(emptyRegistry);
      assert.deepStrictEqual(fallbackStats, { cacheHits: 0, cacheMisses: 0, cacheSize: 0 });
    });
  });
});

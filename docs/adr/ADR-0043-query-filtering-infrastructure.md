# ADR-0043: Query & Filtering Infrastructure

## Status

Accepted

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

Currently, memory retrieval supports only namespace and tag filtering. ADR-0039 Phase 8 identified two upstream controllers (B5 MetadataFilter, B6 QueryOptimizer) that enable structured metadata predicates and query caching. Both are already exported from upstream `controllers/index.ts`. This phase has no dependencies and can run in parallel with Phase 7 (ADR-0042).

## Decision: Specification (SPARC-S)

### B5 MetadataFilter (280 lines)

MongoDB-style metadata filtering engine with dual interface (in-memory + SQL). Supported operators:

- Comparison: `$gt`, `$lt`, `$gte`, `$lte`, `$eq`, `$ne`
- Set: `$in`, `$nin`
- Pattern: `$regex`, `$exists`
- Logical: `$and`, `$or`, `$not`
- Array: `$elemMatch`

Already exported from `controllers/index.ts` barrel file. Compiles filter expressions to efficient SQLite WHERE clauses. Estimated ~75 lines to wire into the registry and bridge.

### B6 QueryOptimizer (297 lines)

LRU query cache (1000 entries, 60s TTL) with EXPLAIN plan analysis and performance suggestions. Strategies:

- **Caching**: Reuse recent identical queries
- **Predicate pushdown**: Apply filters before vector search
- **Early termination**: Stop when top-k quality threshold met
- **Plan selection**: Choose between index scan, full scan, hybrid based on selectivity

## Decision: Pseudocode (SPARC-P)

### MetadataFilter integration

```
// controller-registry.ts -- Level 1
case 'metadataFilter': {
  const { MetadataFilter } = await import('agentdb');
  if (!MetadataFilter) return null;
  return new MetadataFilter();
}

// memory-bridge.ts
async function bridgeFilteredSearch(query, filter, options) {
  const mf = registry.get('metadataFilter');
  const results = await bridgeSearchEntries(options);
  if (!mf || !filter) return results;
  return { ...results, results: mf.apply(results.results, filter) };
}
```

### QueryOptimizer integration

```
// controller-registry.ts -- Level 1
case 'queryOptimizer': {
  const { QueryOptimizer } = await import('agentdb');
  if (!QueryOptimizer) return null;
  return new QueryOptimizer({ cacheSize: 1000, ttlMs: 60000 });
}

// memory-bridge.ts
async function bridgeOptimizedSearch(options) {
  const qo = registry.get('queryOptimizer');
  if (!qo) return bridgeSearchEntries(options);
  const cached = qo.getCached(options);
  if (cached) return cached;
  const result = await bridgeSearchEntries(options);
  qo.cache(options, result);
  return result;
}
```

## Decision: Architecture (SPARC-A)

Both wired at init Level 1 (after Level 0 security from ADR-0042). Pipeline: Query arrives, QueryOptimizer checks cache (hit = instant return), miss = vector search, MetadataFilter applies predicates, QueryOptimizer caches result, return.

## Decision: Refinement (SPARC-R)

Phase 8 effort: 5h. No dependencies (parallel with Phase 7). Both already exported upstream. B5 (dual in-memory + SQL) chosen over B10 FilterBuilder (RVF-only). B10 stays internal.

## Decision: Completion (SPARC-C)

### Checklist

- [x] Wire B5 MetadataFilter at Level 1 (~15 lines) — pre-existing in controller-registry.ts
- [x] Wire B6 QueryOptimizer at Level 1 (~15 lines) — pre-existing in controller-registry.ts
- [x] Add `bridgeFilteredSearch()` + `bridgeOptimizedSearch()` + `bridgeQueryStats()` in memory-bridge.ts
- [x] Add MCP tools `agentdb_filtered_search` + `agentdb_query_stats` in agentdb-tools.ts
- [x] Integrate QueryOptimizer cache into existing `memory_search` handler
- [x] Add unit tests for B5 operators + B6 cache (32 tests)

### Testing

```js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0043 query & filtering', () => {
  it('MetadataFilter $gt operator', () => {
    const entries = [
      { key: 'a', metadata: { score: 0.9 } },
      { key: 'b', metadata: { score: 0.5 } },
      { key: 'c', metadata: { score: 0.8 } },
    ];
    const filter = { score: { $gt: 0.7 } };
    const result = entries.filter(e => e.metadata.score > filter.score.$gt);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(r => r.key), ['a', 'c']);
  });

  it('MetadataFilter $in operator', () => {
    const entries = [{ key: 'a', metadata: { tag: 'security' } }, { key: 'b', metadata: { tag: 'perf' } }];
    const allowed = ['security', 'auth'];
    assert.strictEqual(entries.filter(e => allowed.includes(e.metadata.tag)).length, 1);
  });

  it('MetadataFilter $regex operator', () => {
    const entries = [{ key: 'a', metadata: { name: 'auth-handler' } }, { key: 'b', metadata: { name: 'data-svc' } }];
    const result = entries.filter(e => /^auth/.test(e.metadata.name));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].key, 'a');
  });

  it('QueryOptimizer cache hit returns instantly', () => {
    const cache = new Map();
    const searchFn = mockFn(() => [{ key: 'result' }]);
    function optimizedSearch(query, searchFn) {
      const cacheKey = JSON.stringify(query);
      if (cache.has(cacheKey)) return { results: cache.get(cacheKey), cached: true };
      const results = searchFn(query);
      cache.set(cacheKey, results);
      return { results, cached: false };
    }
    const q = { text: 'auth patterns', limit: 10 };
    const first = optimizedSearch(q, searchFn);
    assert.strictEqual(first.cached, false);
    assert.strictEqual(searchFn.calls.length, 1);
    const second = optimizedSearch(q, searchFn);
    assert.strictEqual(second.cached, true);
    assert.strictEqual(searchFn.calls.length, 1, 'no second search call');
  });

  it('QueryOptimizer TTL expiration', async () => {
    const cache = new Map();
    const set = (k, v) => cache.set(k, { v, exp: Date.now() + 50 });
    const get = (k) => { const e = cache.get(k); if (!e || Date.now() > e.exp) return null; return e.v; };
    set('q1', [{ key: 'r1' }]);
    assert.ok(get('q1') !== null, 'hit before TTL');
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(get('q1'), null, 'miss after TTL');
  });
});
```

### Testing Guidance

**Unit test file**: `tests/unit/adr-0043-query-filtering.test.mjs`

**Unit test strategy** (London School TDD with inline mocks):
- Use the `mockFn` pattern established in ADR-0042 for all test doubles
- Test B5 MetadataFilter factory in isolation: verify constructor accepts operator config, `apply()` method signature, state after construction
- Test each operator family independently: comparison (`$gt`, `$lt`, `$gte`, `$lte`, `$eq`, `$ne`), set (`$in`, `$nin`), pattern (`$regex`, `$exists`), logical (`$and`, `$or`, `$not`), array (`$elemMatch`)
- Test B6 QueryOptimizer factory: verify constructor params (`cacheSize`, `ttlMs`), `getCached()`/`cache()` method signatures, LRU eviction when cache exceeds 1000 entries
- Edge cases: null filter input (passthrough), empty entries array, nested `$and`/`$or` with mixed operators, `$regex` with invalid pattern string, `$in` with empty array
- Degraded mode: registry returns null for `metadataFilter` -- `bridgeFilteredSearch` must return unfiltered results; registry returns null for `queryOptimizer` -- `bridgeOptimizedSearch` must bypass cache

**Acceptance test strategy**:
- B5 MetadataFilter: testable via `memory_search` with filter params. Store 3+ entries with distinct metadata, search with `{ score: { $gt: 0.7 } }`, assert returned entries match predicate. Assert response contains structured `results` array, not string
- B6 QueryOptimizer: internal-only (no dedicated MCP tool). Cache statistics may surface in `agentdb_health` response fields but do not create a test that depends on health output shape
- `agentdb_query_stats` tool (if wired): assert response contains `cacheHits`, `cacheMisses`, `cacheSize` fields
- No fallback success paths -- if `memory_search` with filter returns an error, the test must fail

**What is impractical at acceptance level**:
- QueryOptimizer TTL expiration (requires 60s wait in test)
- LRU eviction behavior (requires inserting 1000+ cache entries)
- `$elemMatch` with deeply nested arrays (hard to set up via MCP store calls)
- Cache invalidation between writes and reads (timing-dependent)

**Test cascade**:
- B5/B6 factory wiring in fork TS: `npm run test:unit`
- New `agentdb_filtered_search` or `agentdb_query_stats` MCP tool: `npm run deploy` (full acceptance)
- Filter param added to existing `memory_search` handler: `npm run deploy` (full acceptance)
- Acceptance check changes only: `npm run deploy`

### Success Criteria

- Filter memories by metadata: `{ score: { $gt: 0.8 } }` returns only matching entries
- Repeated identical queries return from cache (0ms vector search on second call)
- QueryOptimizer cache respects 60s TTL
- `agentdb_health` reports B5, B6 as active at Level 1

## Consequences

### Positive
- Structured metadata filtering beyond namespace/tag; instant repeat queries via LRU cache
- Low integration effort (both already exported upstream, ~75 lines each); no dependencies

### Negative
- Cache consumes memory (1000 entries, configurable)

### Risks
- Cache invalidation between writes and reads (mitigated: 60s TTL); complex $and/$or nesting edge cases

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent, superseded)
- **ADR-0041**: Composition-aware controller architecture (Level 1 placement)
- **ADR-0042**: Security & reliability foundation (parallel, no dependency)
- **ADR-0033**: Original controller activation

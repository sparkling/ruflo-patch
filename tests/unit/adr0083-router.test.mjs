// @tier unit
// ADR-0083 Phase 5: memory-router.ts — single data flow path enhancements
//
// London School TDD: no real imports of memory-router.ts or memory-initializer.ts.
// All storage, fs, and embedding dependencies are replaced with inline mock factories.
//
// Coverage (ADR-0085: Groups 1-3 writeJsonSidecar removed — sidecar eliminated):
//   4. routeEmbeddingOp — delegates generate to generateEmbedding, hnswSearch to
//      searchHNSWIndex, returns error for unknown op types
//   5. generateEmbedding lazy wrapper — loads module once, reuses cached ref
//   6. resetRouter — clears all cached module references

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Mock helpers (same pattern as memory-router-adr0077.test.mjs)
// ============================================================================

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  fn.reset = () => { calls.length = 0; };
  return fn;
}

function asyncMock(value) {
  return mockFn(async () => value);
}

// ============================================================================
// Paths
// ============================================================================

const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const MEMORY_SRC = `${CLI_SRC}/memory`;

// ADR-0085: createJsonSidecar + createRouterWithSidecar removed (sidecar eliminated)

// ============================================================================
// Simulated routeEmbeddingOp (the ADR-0083 addition to memory-router.ts)
// ============================================================================

/**
 * Build a routeEmbeddingOp backed by injected embedding function mocks.
 * Call signatures mirror the real memory-router.ts routeEmbeddingOp exactly:
 *   generate   -> fns.generateEmbedding(op.text, op.data)
 *   hnswSearch -> fns.searchHNSWIndex(op.vector || op.query, op.k || op.limit || 10, op.data)
 *   hnswAdd    -> fns.addToHNSWIndex(op.id || op.key, op.vector, op.data)
 *   hnswGet    -> fns.getHNSWIndex(op.data)
 */
function createEmbeddingRouter(embFns) {
  return async function routeEmbeddingOp(op) {
    switch (op.type) {
      case 'generate':
        return { success: true, ...(await embFns.generateEmbedding(op.text, op.data)) };
      case 'generateBatch':
        return { success: true, ...(await embFns.generateBatchEmbeddings(op.texts, op.data)) };
      case 'hnswSearch':
        return { success: true, ...(await embFns.searchHNSWIndex(op.vector || op.query, op.k || op.limit || 10, op.data)) };
      case 'hnswAdd':
        return { success: true, ...(await embFns.addToHNSWIndex(op.id || op.key, op.vector, op.data)) };
      case 'hnswGet':
        return { success: true, index: await embFns.getHNSWIndex(op.data) };
      case 'hnswStatus':
        return { success: true, ...(await embFns.getHNSWStatus()) };
      case 'loadModel':
        return { success: true, ...(await embFns.loadEmbeddingModel(op.data)) };
      default:
        return { success: false, error: `Unknown embedding operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Simulated lazy-wrapper module cache (mirrors _allFns / _embeddingFns pattern)
// ============================================================================

/**
 * Build a _wrap-style lazy delegator backed by a module-loader mock.
 * The real _wrap() in memory-router.ts uses loadAllFns() which caches into _allFns.
 * This replicates that pattern so we can verify single-load and cache-reuse behaviour.
 *
 * Returns an object with:
 *   - call(fnName, ...args)  — invoke a named fn from the cached module
 *   - reset()                — clear the cache (mirrors resetRouter())
 *   - isCached()             — inspect whether the module has been loaded
 */
function createLazyAllFnsWrapper(loaderFn) {
  let cachedMod = null;
  return {
    call: async function callWrapped(fnName, ...args) {
      if (!cachedMod) {
        cachedMod = await loaderFn();
      }
      return cachedMod[fnName](...args);
    },
    reset: function resetCache() {
      cachedMod = null;
    },
    isCached: function isCached() {
      return cachedMod !== null;
    },
  };
}

// ============================================================================
// Groups 1-3 removed (ADR-0085): writeJsonSidecar deleted — intelligence reads SQLite directly
// ============================================================================

// ============================================================================
// Group 4: routeEmbeddingOp — delegation (renumbered from original)
// ============================================================================

// Placeholder end-of-removed-groups marker
// ============================================================================
// Groups 1-3 removed (ADR-0085): writeJsonSidecar deleted — intelligence reads SQLite directly
// ============================================================================

// ============================================================================
// Group 4: routeEmbeddingOp — delegation
// ============================================================================

describe('ADR-0083 routeEmbeddingOp: delegate generate to generateEmbedding', () => {
  let embFns;
  let routeEmbeddingOp;

  beforeEach(() => {
    embFns = {
      generateEmbedding: asyncMock({ embedding: [0.1, 0.2], dimensions: 768, model: 'Xenova/all-mpnet-base-v2' }),
      generateBatchEmbeddings: asyncMock([]),
      searchHNSWIndex: asyncMock({ results: [], total: 0 }),
      addToHNSWIndex: asyncMock({}),
      getHNSWIndex: asyncMock('mock-hnsw'),
      getHNSWStatus: asyncMock({ initialized: true, count: 0 }),
      loadEmbeddingModel: asyncMock({ loaded: true }),
    };
    routeEmbeddingOp = createEmbeddingRouter(embFns);
  });

  it('should delegate type "generate" to generateEmbedding with text and data', async () => {
    const result = await routeEmbeddingOp({ type: 'generate', text: 'hello world', data: { intent: 'query' } });

    assert.equal(embFns.generateEmbedding.calls.length, 1, 'generateEmbedding must be called once');
    assert.equal(embFns.generateEmbedding.calls[0][0], 'hello world', 'must pass text as first arg');
    assert.deepStrictEqual(embFns.generateEmbedding.calls[0][1], { intent: 'query' }, 'must pass data as second arg');
    assert.equal(result.success, true, 'result must have success: true');
    assert.ok(Array.isArray(result.embedding), 'result must include embedding array');
    assert.equal(result.dimensions, 768);
  });

  it('should not call searchHNSWIndex when type is "generate"', async () => {
    await routeEmbeddingOp({ type: 'generate', text: 'test' });
    assert.equal(embFns.searchHNSWIndex.calls.length, 0, 'searchHNSWIndex must NOT be called for generate');
  });
});

describe('ADR-0083 routeEmbeddingOp: delegate hnswSearch to searchHNSWIndex', () => {
  let embFns;
  let routeEmbeddingOp;

  beforeEach(() => {
    embFns = {
      generateEmbedding: asyncMock({ embedding: [], dimensions: 768, model: 'Xenova/all-mpnet-base-v2' }),
      generateBatchEmbeddings: asyncMock([]),
      searchHNSWIndex: asyncMock({ results: [{ id: 'r1', score: 0.95 }], total: 1 }),
      addToHNSWIndex: asyncMock({}),
      getHNSWIndex: asyncMock('mock-hnsw'),
      getHNSWStatus: asyncMock({ initialized: true, count: 0 }),
      loadEmbeddingModel: asyncMock({ loaded: true }),
    };
    routeEmbeddingOp = createEmbeddingRouter(embFns);
  });

  it('should delegate type "hnswSearch" to searchHNSWIndex with positional args', async () => {
    await routeEmbeddingOp({ type: 'hnswSearch', query: 'find this', k: 5 });

    assert.equal(embFns.searchHNSWIndex.calls.length, 1, 'searchHNSWIndex must be called once');
    // Call: searchHNSWIndex(op.vector || op.query, op.k || op.limit || 10, op.data)
    const [queryArg, kArg] = embFns.searchHNSWIndex.calls[0];
    assert.equal(queryArg, 'find this', 'must pass query as first positional arg');
    assert.equal(kArg, 5, 'must pass k as second positional arg');
  });

  it('should use op.vector over op.query when both are provided', async () => {
    const vec = [0.1, 0.2, 0.3];
    await routeEmbeddingOp({ type: 'hnswSearch', query: 'ignored', vector: vec, k: 3 });

    const [firstArg] = embFns.searchHNSWIndex.calls[0];
    assert.strictEqual(firstArg, vec, 'must prefer op.vector over op.query');
  });

  it('should use limit as k fallback when k is not provided', async () => {
    await routeEmbeddingOp({ type: 'hnswSearch', query: 'fallback', limit: 20 });

    const [, kArg] = embFns.searchHNSWIndex.calls[0];
    assert.equal(kArg, 20, 'must use limit as k when k is absent');
  });

  it('should default k to 10 when neither k nor limit is provided', async () => {
    await routeEmbeddingOp({ type: 'hnswSearch', query: 'default-k' });

    const [, kArg] = embFns.searchHNSWIndex.calls[0];
    assert.equal(kArg, 10, 'must default k to 10');
  });

  it('should not call generateEmbedding when type is "hnswSearch"', async () => {
    await routeEmbeddingOp({ type: 'hnswSearch', query: 'x' });
    assert.equal(embFns.generateEmbedding.calls.length, 0, 'generateEmbedding must NOT be called for hnswSearch');
  });

  it('should merge searchHNSWIndex result with success: true', async () => {
    const result = await routeEmbeddingOp({ type: 'hnswSearch', query: 'q', k: 3 });
    assert.equal(result.success, true, 'hnswSearch result must have success: true');
    assert.equal(result.total, 1);
    assert.equal(result.results[0].id, 'r1');
  });
});

describe('ADR-0083 routeEmbeddingOp: unknown op types return error', () => {
  let routeEmbeddingOp;

  beforeEach(() => {
    const embFns = {
      generateEmbedding: asyncMock({}),
      generateBatchEmbeddings: asyncMock([]),
      searchHNSWIndex: asyncMock({}),
      addToHNSWIndex: asyncMock({}),
      getHNSWIndex: asyncMock({}),
      getHNSWStatus: asyncMock({}),
      loadEmbeddingModel: asyncMock({}),
    };
    routeEmbeddingOp = createEmbeddingRouter(embFns);
  });

  it('should return { success: false, error: ... } for an unknown op type', async () => {
    const result = await routeEmbeddingOp({ type: 'nonexistent' });

    assert.equal(result.success, false, 'must return success: false for unknown type');
    assert.ok(typeof result.error === 'string', 'must include an error string');
    assert.ok(result.error.includes('nonexistent'), 'error must mention the unknown type');
    assert.ok(result.error.toLowerCase().includes('unknown'), 'error must say "unknown"');
  });

  it('should return { success: false } for type "totally-unknown"', async () => {
    const result = await routeEmbeddingOp({ type: 'totally-unknown' });
    assert.equal(result.success, false);
  });

  it('should not throw for unknown op types — returns error result instead', async () => {
    await assert.doesNotReject(
      () => routeEmbeddingOp({ type: 'totally-unknown' }),
      'routeEmbeddingOp must never throw for unknown types',
    );
  });
});

// ============================================================================
// Group 5: _wrap-style lazy wrapper (_allFns) — single module load
// ============================================================================

describe('ADR-0083 _wrap lazy wrapper (_allFns): loads module once and caches', () => {
  it('should load the module exactly once on first call', async () => {
    let loadCount = 0;
    const mockMod = {
      generateEmbedding: asyncMock({ embedding: [0.5], dimensions: 768, model: 'Xenova/all-mpnet-base-v2' }),
    };
    const loader = async () => { loadCount++; return mockMod; };

    const wrapper = createLazyAllFnsWrapper(loader);

    await wrapper.call('generateEmbedding', 'first call');
    assert.equal(loadCount, 1, 'loader must be called exactly once on first invocation');
  });

  it('should reuse the cached module on subsequent calls (no re-import)', async () => {
    let loadCount = 0;
    const mockMod = {
      generateEmbedding: asyncMock({ embedding: [0.5], dimensions: 768, model: 'Xenova/all-mpnet-base-v2' }),
    };
    const loader = async () => { loadCount++; return mockMod; };

    const wrapper = createLazyAllFnsWrapper(loader);

    await wrapper.call('generateEmbedding', 'call 1');
    await wrapper.call('generateEmbedding', 'call 2');
    await wrapper.call('generateEmbedding', 'call 3');

    assert.equal(loadCount, 1, 'loader must be called only once regardless of subsequent calls');
    assert.equal(mockMod.generateEmbedding.calls.length, 3, 'the underlying fn must be called 3 times');
  });

  it('should delegate all args to the named fn in the loaded module', async () => {
    const mockMod = {
      generateEmbedding: mockFn((text, opts) => Promise.resolve({ embedding: [], dimensions: 768, model: 'x', text, opts })),
    };
    const wrapper = createLazyAllFnsWrapper(async () => mockMod);

    const result = await wrapper.call('generateEmbedding', 'embed me', { intent: 'document' });

    assert.equal(mockMod.generateEmbedding.calls.length, 1);
    assert.equal(mockMod.generateEmbedding.calls[0][0], 'embed me');
    assert.deepStrictEqual(mockMod.generateEmbedding.calls[0][1], { intent: 'document' });
    assert.equal(result.text, 'embed me');
  });

  it('should work for getHNSWIndex (named export via _wrap)', async () => {
    const mockMod = {
      getHNSWIndex: asyncMock({ index: 'my-hnsw', size: 42 }),
    };
    const wrapper = createLazyAllFnsWrapper(async () => mockMod);

    const result = await wrapper.call('getHNSWIndex');
    assert.equal(result.size, 42);
    assert.equal(mockMod.getHNSWIndex.calls.length, 1);
  });

  it('should report isCached() false before first call', () => {
    const wrapper = createLazyAllFnsWrapper(async () => ({}));
    assert.equal(wrapper.isCached(), false, 'module must not be cached before first call');
  });

  it('should report isCached() true after first call', async () => {
    const mockMod = { generateEmbedding: asyncMock({ embedding: [], dimensions: 768, model: 'x' }) };
    const wrapper = createLazyAllFnsWrapper(async () => mockMod);

    await wrapper.call('generateEmbedding', 'x');
    assert.equal(wrapper.isCached(), true, 'module must be cached after first call');
  });
});

// ============================================================================
// Group 6: resetRouter — clears all caches so next call re-imports
// ============================================================================

describe('ADR-0083 resetRouter: clears cached module references', () => {
  it('should clear the _allFns cache so next call re-imports', async () => {
    let loadCount = 0;
    const mockMod = {
      generateEmbedding: asyncMock({ embedding: [], dimensions: 768, model: 'x' }),
    };
    const loader = async () => { loadCount++; return mockMod; };

    const wrapper = createLazyAllFnsWrapper(loader);

    // First load
    await wrapper.call('generateEmbedding', 'before reset');
    assert.equal(loadCount, 1, 'must load once before reset');
    assert.equal(wrapper.isCached(), true);

    // Reset
    wrapper.reset();
    assert.equal(wrapper.isCached(), false, 'cache must be cleared after reset');

    // Second load after reset
    await wrapper.call('generateEmbedding', 'after reset');
    assert.equal(loadCount, 2, 'must re-import after reset');
  });

  it('should allow multiple reset/reload cycles without error', async () => {
    let loadCount = 0;
    const mockMod = { generateEmbedding: asyncMock({}) };
    const loader = async () => { loadCount++; return mockMod; };
    const wrapper = createLazyAllFnsWrapper(loader);

    for (let i = 0; i < 3; i++) {
      await wrapper.call('generateEmbedding', `cycle-${i}`);
      wrapper.reset();
    }

    assert.equal(loadCount, 3, 'loader must be called once per reset/reload cycle');
  });

  it('should clear all internal state variables (mirrors resetRouter() in source)', () => {
    // ADR-0086 Phase 2: _fns replaced by _storage
    const routerPath = `${MEMORY_SRC}/memory-router.ts`;
    assert.ok(existsSync(routerPath), 'memory-router.ts must exist');

    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('export function resetRouter'), 'must export resetRouter');
    assert.ok(src.includes('_storage = null') || src.includes('_fns = null'), 'must reset storage state to null');
    assert.ok(src.includes('_embeddingFns = null'), 'must reset _embeddingFns to null');
    assert.ok(src.includes('_allFns = null'), 'must reset _allFns to null');
    assert.ok(src.includes('_interceptMod = null'), 'must reset _interceptMod to null');
    assert.ok(src.includes('_initialized = false'), 'must reset _initialized to false');
    assert.ok(src.includes('_initPromise = null'), 'must reset _initPromise to null');
  });
});

// ============================================================================
// Group 7: Integration — memory-router.ts source shape (ADR-0083)
// ============================================================================

describe('ADR-0083 Integration: memory-router.ts source structure', () => {
  const routerPath = `${MEMORY_SRC}/memory-router.ts`;

  it('memory-router.ts exists at expected path', () => {
    assert.ok(existsSync(routerPath), `memory-router.ts must exist at ${routerPath}`);
  });

  it('exports routeMemoryOp as async function', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(
      src.includes('export async function routeMemoryOp'),
      'must export async routeMemoryOp',
    );
  });

  it('exports ensureRouter as async function', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(
      src.includes('export async function ensureRouter'),
      'must export async ensureRouter',
    );
  });

  it('exports generateEmbedding via _wrap (lazy const export)', () => {
    const src = readFileSync(routerPath, 'utf8');
    // ADR-0083: generateEmbedding is exported as a const via the _wrap helper,
    // not as an explicit async function declaration.
    assert.ok(
      src.includes("export const generateEmbedding = _wrap('generateEmbedding')"),
      'generateEmbedding must be exported as a _wrap const',
    );
  });

  it('exports resetRouter as synchronous function', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(
      src.includes('export function resetRouter'),
      'must export resetRouter (synchronous)',
    );
    // Ensure it is NOT async
    assert.ok(
      !src.includes('export async function resetRouter'),
      'resetRouter must be synchronous (not async)',
    );
  });

  // ADR-0085: writeJsonSidecar + AUTO_MEMORY_STORE_MAX removed (sidecar eliminated)

  it('loadEmbeddingFns lazy-caches via _embeddingFns variable', () => {
    const src = readFileSync(routerPath, 'utf8');
    assert.ok(src.includes('_embeddingFns'), 'must have _embeddingFns lazy-cache variable');
    assert.ok(src.includes('if (_embeddingFns) return _embeddingFns'), 'must short-circuit if cached');
  });

  it('does not import memory-bridge.ts at the top level (lazy only)', () => {
    const src = readFileSync(routerPath, 'utf8');
    // Static top-level import would be: import * as bridge from './memory-bridge'
    // or import { ... } from './memory-bridge'
    assert.ok(
      !src.match(/^import\s.*memory-bridge/m),
      'memory-bridge must not appear as a static top-level import',
    );
  });
});

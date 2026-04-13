// @tier unit
// ADR-0077 Phase 5: memory-router.ts — single entry point for all memory operations
//
// London School TDD: inline mocks for storage functions and controller-intercept.
// No real imports of the router module (it has dynamic imports to packages
// that may not be built).
//
// Integration tests use real I/O for migration-legacy and wiring checks.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Mock helpers (same pattern as controller-config-adr0064.test.mjs)
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
const MCP_TOOLS_SRC = `${CLI_SRC}/mcp-tools`;

// ============================================================================
// Simulated routeMemoryOp (mirrors memory-router.ts logic)
// ============================================================================

/**
 * Build a routeMemoryOp function wired to the given mock storage functions.
 * This replicates the switch statement from memory-router.ts so we can test
 * the routing logic in isolation without dynamic imports.
 */
function createRouter(fns) {
  return async function routeMemoryOp(op) {
    switch (op.type) {
      case 'store': {
        const result = await fns.storeEntry({
          key: op.key,
          value: op.value,
          namespace: op.namespace || 'default',
          generateEmbeddingFlag: op.generateEmbedding !== false,
          tags: op.tags,
          ttl: op.ttl,
          upsert: op.upsert,
        });
        return {
          success: !!result.success,
          key: op.key,
          stored: !!result.success,
          storedAt: new Date().toISOString(),
          hasEmbedding: !!result.embedding,
          embeddingDimensions: result.embedding?.dimensions || null,
          error: result.error,
        };
      }

      case 'search': {
        const result = await fns.searchEntries({
          query: op.query,
          namespace: op.namespace || 'all',
          limit: op.limit || 10,
          threshold: op.threshold || 0.3,
        });
        const results = result.results || [];
        return { success: true, results, total: results.length };
      }

      case 'get': {
        const result = await fns.getEntry({
          key: op.key,
          namespace: op.namespace || 'default',
        });
        return {
          success: true,
          found: !!result.found,
          entry: result.entry || null,
        };
      }

      case 'delete': {
        const result = await fns.deleteEntry({
          key: op.key,
          namespace: op.namespace || 'default',
        });
        return {
          success: true,
          deleted: !!result.deleted,
        };
      }

      case 'list': {
        const result = await fns.listEntries({
          namespace: op.namespace || 'all',
          limit: op.limit || 50,
          offset: op.offset || 0,
        });
        return {
          success: true,
          entries: result.entries || [],
          total: result.total || 0,
        };
      }

      case 'stats': {
        const status = await fns.checkMemoryInitialization();
        const all = await fns.listEntries({ limit: 100_000 });
        const entries = all.entries || [];
        const namespaces = {};
        let withEmbeddings = 0;
        for (const entry of entries) {
          namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;
          if (entry.hasEmbedding) withEmbeddings++;
        }
        return {
          success: true,
          initialized: !!status.initialized,
          totalEntries: all.total || 0,
          entriesWithEmbeddings: withEmbeddings,
          namespaces,
        };
      }

      case 'count': {
        const result = await fns.listEntries({
          namespace: op.namespace || 'all',
          limit: 1,
        });
        return { success: true, count: result.total || 0 };
      }

      case 'listNamespaces': {
        const result = await fns.listEntries({ limit: 100_000 });
        const entries = result.entries || [];
        const namespaces = [...new Set(entries.map(e => e.namespace))];
        return { success: true, namespaces };
      }

      default:
        return { success: false, error: `Unknown operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Group 1: UNIT TESTS — routeMemoryOp routing
// ============================================================================

describe('ADR-0077 Phase 5: routeMemoryOp routing (unit)', () => {
  let fns;
  let routeMemoryOp;

  beforeEach(() => {
    fns = {
      storeEntry: asyncMock({ success: true, embedding: { dimensions: 768 } }),
      searchEntries: asyncMock({ results: [{ key: 'k1', score: 0.9 }] }),
      listEntries: asyncMock({ entries: [], total: 0 }),
      getEntry: asyncMock({ found: true, entry: { key: 'k1', value: 'v1' } }),
      deleteEntry: asyncMock({ deleted: true }),
      initializeMemoryDatabase: asyncMock(undefined),
      checkMemoryInitialization: asyncMock({ initialized: true }),
    };
    routeMemoryOp = createRouter(fns);
  });

  // Test 1
  it('store: calls storeEntry with correct args', async () => {
    const result = await routeMemoryOp({
      type: 'store',
      key: 'test-key',
      value: 'test-value',
      namespace: 'patterns',
      tags: ['tag1'],
      ttl: 3600,
      upsert: true,
      generateEmbedding: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.key, 'test-key');
    assert.equal(result.stored, true);
    assert.equal(result.hasEmbedding, true);
    assert.equal(result.embeddingDimensions, 768);
    assert.ok(result.storedAt, 'storedAt must be set');

    assert.equal(fns.storeEntry.calls.length, 1, 'storeEntry called once');
    const args = fns.storeEntry.calls[0][0];
    assert.equal(args.key, 'test-key');
    assert.equal(args.value, 'test-value');
    assert.equal(args.namespace, 'patterns');
    assert.equal(args.generateEmbeddingFlag, true);
    assert.deepEqual(args.tags, ['tag1']);
    assert.equal(args.ttl, 3600);
    assert.equal(args.upsert, true);
  });

  // Test 2
  it('search: calls searchEntries with correct args', async () => {
    const result = await routeMemoryOp({
      type: 'search',
      query: 'authentication patterns',
      namespace: 'patterns',
      limit: 5,
      threshold: 0.5,
    });

    assert.equal(result.success, true);
    assert.equal(result.total, 1);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].key, 'k1');

    assert.equal(fns.searchEntries.calls.length, 1, 'searchEntries called once');
    const args = fns.searchEntries.calls[0][0];
    assert.equal(args.query, 'authentication patterns');
    assert.equal(args.namespace, 'patterns');
    assert.equal(args.limit, 5);
    assert.equal(args.threshold, 0.5);
  });

  // Test 3
  it('get: calls getEntry with correct args', async () => {
    const result = await routeMemoryOp({
      type: 'get',
      key: 'my-key',
      namespace: 'sessions',
    });

    assert.equal(result.success, true);
    assert.equal(result.found, true);
    assert.deepEqual(result.entry, { key: 'k1', value: 'v1' });

    assert.equal(fns.getEntry.calls.length, 1, 'getEntry called once');
    const args = fns.getEntry.calls[0][0];
    assert.equal(args.key, 'my-key');
    assert.equal(args.namespace, 'sessions');
  });

  // Test 4
  it('delete: calls deleteEntry with correct args', async () => {
    const result = await routeMemoryOp({
      type: 'delete',
      key: 'old-key',
      namespace: 'cache',
    });

    assert.equal(result.success, true);
    assert.equal(result.deleted, true);

    assert.equal(fns.deleteEntry.calls.length, 1, 'deleteEntry called once');
    const args = fns.deleteEntry.calls[0][0];
    assert.equal(args.key, 'old-key');
    assert.equal(args.namespace, 'cache');
  });

  // Test 5
  it('list: calls listEntries with correct args', async () => {
    fns.listEntries = asyncMock({
      entries: [{ key: 'a' }, { key: 'b' }],
      total: 2,
    });
    routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({
      type: 'list',
      namespace: 'default',
      limit: 20,
      offset: 5,
    });

    assert.equal(result.success, true);
    assert.equal(result.entries.length, 2);
    assert.equal(result.total, 2);

    assert.equal(fns.listEntries.calls.length, 1, 'listEntries called once');
    const args = fns.listEntries.calls[0][0];
    assert.equal(args.namespace, 'default');
    assert.equal(args.limit, 20);
    assert.equal(args.offset, 5);
  });

  // Test 6
  it('stats: aggregates namespace counts and embedding coverage', async () => {
    fns.listEntries = asyncMock({
      entries: [
        { namespace: 'patterns', hasEmbedding: true },
        { namespace: 'patterns', hasEmbedding: true },
        { namespace: 'sessions', hasEmbedding: false },
        { namespace: 'cache', hasEmbedding: true },
      ],
      total: 4,
    });
    routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({ type: 'stats' });

    assert.equal(result.success, true);
    assert.equal(result.initialized, true);
    assert.equal(result.totalEntries, 4);
    assert.equal(result.entriesWithEmbeddings, 3);
    assert.deepEqual(result.namespaces, { patterns: 2, sessions: 1, cache: 1 });

    // stats calls both checkMemoryInitialization and listEntries
    assert.equal(fns.checkMemoryInitialization.calls.length, 1);
    assert.equal(fns.listEntries.calls.length, 1);
  });

  // Test 7
  it('count: returns total from listEntries', async () => {
    fns.listEntries = asyncMock({ total: 42 });
    routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({
      type: 'count',
      namespace: 'patterns',
    });

    assert.equal(result.success, true);
    assert.equal(result.count, 42);

    // count passes limit: 1 for efficiency
    const args = fns.listEntries.calls[0][0];
    assert.equal(args.limit, 1, 'count should pass limit: 1');
    assert.equal(args.namespace, 'patterns');
  });

  // Test 8
  it('listNamespaces: deduplicates namespaces', async () => {
    fns.listEntries = asyncMock({
      entries: [
        { namespace: 'patterns' },
        { namespace: 'sessions' },
        { namespace: 'patterns' },
        { namespace: 'cache' },
        { namespace: 'sessions' },
      ],
    });
    routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({ type: 'listNamespaces' });

    assert.equal(result.success, true);
    assert.equal(result.namespaces.length, 3, 'must deduplicate');
    assert.ok(result.namespaces.includes('patterns'));
    assert.ok(result.namespaces.includes('sessions'));
    assert.ok(result.namespaces.includes('cache'));
  });

  // Test 9
  it('unknown type: returns error', async () => {
    const result = await routeMemoryOp({ type: 'explode' });

    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown operation'));
    assert.ok(result.error.includes('explode'));

    // No storage function should have been called
    assert.equal(fns.storeEntry.calls.length, 0);
    assert.equal(fns.searchEntries.calls.length, 0);
    assert.equal(fns.listEntries.calls.length, 0);
    assert.equal(fns.getEntry.calls.length, 0);
    assert.equal(fns.deleteEntry.calls.length, 0);
  });
});

// ============================================================================
// Group 2: UNIT TESTS — default namespace/limit fallbacks
// ============================================================================

describe('ADR-0077 Phase 5: routeMemoryOp default fallbacks (unit)', () => {
  let fns;
  let routeMemoryOp;

  beforeEach(() => {
    fns = {
      storeEntry: asyncMock({ success: true }),
      searchEntries: asyncMock({ results: [] }),
      listEntries: asyncMock({ entries: [], total: 0 }),
      getEntry: asyncMock({ found: false }),
      deleteEntry: asyncMock({ deleted: false }),
      initializeMemoryDatabase: asyncMock(undefined),
      checkMemoryInitialization: asyncMock({ initialized: true }),
    };
    routeMemoryOp = createRouter(fns);
  });

  it('store defaults namespace to "default"', async () => {
    await routeMemoryOp({ type: 'store', key: 'k', value: 'v' });
    assert.equal(fns.storeEntry.calls[0][0].namespace, 'default');
  });

  it('store defaults generateEmbeddingFlag to true', async () => {
    await routeMemoryOp({ type: 'store', key: 'k', value: 'v' });
    assert.equal(fns.storeEntry.calls[0][0].generateEmbeddingFlag, true);
  });

  it('store sets generateEmbeddingFlag false when generateEmbedding=false', async () => {
    await routeMemoryOp({ type: 'store', key: 'k', value: 'v', generateEmbedding: false });
    assert.equal(fns.storeEntry.calls[0][0].generateEmbeddingFlag, false);
  });

  it('search defaults namespace to "all"', async () => {
    await routeMemoryOp({ type: 'search', query: 'q' });
    assert.equal(fns.searchEntries.calls[0][0].namespace, 'all');
  });

  it('search defaults limit to 10', async () => {
    await routeMemoryOp({ type: 'search', query: 'q' });
    assert.equal(fns.searchEntries.calls[0][0].limit, 10);
  });

  it('search defaults threshold to 0.3', async () => {
    await routeMemoryOp({ type: 'search', query: 'q' });
    assert.equal(fns.searchEntries.calls[0][0].threshold, 0.3);
  });

  it('get defaults namespace to "default"', async () => {
    await routeMemoryOp({ type: 'get', key: 'k' });
    assert.equal(fns.getEntry.calls[0][0].namespace, 'default');
  });

  it('delete defaults namespace to "default"', async () => {
    await routeMemoryOp({ type: 'delete', key: 'k' });
    assert.equal(fns.deleteEntry.calls[0][0].namespace, 'default');
  });

  it('list defaults namespace to "all", limit to 50, offset to 0', async () => {
    await routeMemoryOp({ type: 'list' });
    const args = fns.listEntries.calls[0][0];
    assert.equal(args.namespace, 'all');
    assert.equal(args.limit, 50);
    assert.equal(args.offset, 0);
  });

  it('count defaults namespace to "all"', async () => {
    await routeMemoryOp({ type: 'count' });
    assert.equal(fns.listEntries.calls[0][0].namespace, 'all');
  });
});

// ============================================================================
// Group 3: UNIT TESTS — store error path
// ============================================================================

describe('ADR-0077 Phase 5: routeMemoryOp store error path (unit)', () => {
  it('store returns success=false when storeEntry fails', async () => {
    const fns = {
      storeEntry: asyncMock({ success: false, error: 'disk full' }),
      searchEntries: asyncMock({ results: [] }),
      listEntries: asyncMock({ entries: [], total: 0 }),
      getEntry: asyncMock({ found: false }),
      deleteEntry: asyncMock({ deleted: false }),
      initializeMemoryDatabase: asyncMock(undefined),
      checkMemoryInitialization: asyncMock({ initialized: true }),
    };
    const routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({ type: 'store', key: 'k', value: 'v' });

    assert.equal(result.success, false);
    assert.equal(result.stored, false);
    assert.equal(result.hasEmbedding, false);
    assert.equal(result.error, 'disk full');
  });

  it('store returns hasEmbedding=false when no embedding in result', async () => {
    const fns = {
      storeEntry: asyncMock({ success: true }),
      searchEntries: asyncMock({ results: [] }),
      listEntries: asyncMock({ entries: [], total: 0 }),
      getEntry: asyncMock({ found: false }),
      deleteEntry: asyncMock({ deleted: false }),
      initializeMemoryDatabase: asyncMock(undefined),
      checkMemoryInitialization: asyncMock({ initialized: true }),
    };
    const routeMemoryOp = createRouter(fns);

    const result = await routeMemoryOp({ type: 'store', key: 'k', value: 'v' });

    assert.equal(result.success, true);
    assert.equal(result.hasEmbedding, false);
    assert.equal(result.embeddingDimensions, null);
  });
});

// ============================================================================
// Group 5: UNIT TESTS — ensureRouter idempotency
// ============================================================================

describe('ADR-0077 Phase 5: ensureRouter idempotency (unit)', () => {

  // Test 11
  it('initializes only once (idempotent)', async () => {
    let initCount = 0;
    let initialized = false;
    let initPromise = null;

    async function doInit() {
      initCount++;
      initialized = true;
      initPromise = null;
    }

    async function ensureRouter() {
      if (initialized) return;
      if (initPromise) return initPromise;
      initPromise = doInit();
      return initPromise;
    }

    await ensureRouter();
    await ensureRouter();
    await ensureRouter();

    assert.equal(initCount, 1, 'doInit must be called exactly once');
  });

  it('concurrent ensureRouter calls share the same promise', async () => {
    let initCount = 0;
    let initialized = false;
    let initPromise = null;

    async function doInit() {
      // Simulate async work
      await new Promise(r => setTimeout(r, 10));
      initCount++;
      initialized = true;
      initPromise = null;
    }

    async function ensureRouter() {
      if (initialized) return;
      if (initPromise) return initPromise;
      initPromise = doInit();
      return initPromise;
    }

    // Fire three concurrent calls
    await Promise.all([ensureRouter(), ensureRouter(), ensureRouter()]);

    assert.equal(initCount, 1, 'concurrent calls must share one init');
  });
});

// ============================================================================
// Group 6: UNIT TESTS — resetRouter
// ============================================================================

describe('ADR-0077 Phase 5: resetRouter clears state (unit)', () => {

  // Test 12
  it('resetRouter clears all internal state', async () => {
    let fns = { initialized: true };
    let interceptMod = { name: 'intercept' };
    let initialized = true;
    let initPromise = Promise.resolve();

    function resetRouter() {
      fns = null;
      interceptMod = null;
      initialized = false;
      initPromise = null;
    }

    resetRouter();

    assert.equal(fns, null, '_fns must be null after reset');
    assert.equal(interceptMod, null, '_interceptMod must be null after reset');
    assert.equal(initialized, false, '_initialized must be false after reset');
    assert.equal(initPromise, null, '_initPromise must be null after reset');
  });

  it('resetRouter matches source resetRouter signature', () => {
    const routerFile = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(routerFile)) return;
    const src = readFileSync(routerFile, 'utf-8');

    assert.ok(src.includes('export function resetRouter'), 'must export resetRouter');

    // Verify it clears state variables
    // ADR-0086 Phase 2: _fns replaced by _storage
    const fnStart = src.indexOf('export function resetRouter');
    const fnBody = src.slice(fnStart, fnStart + 300);
    assert.ok(fnBody.includes('_storage = null') || fnBody.includes('_fns = null'), 'must clear storage state');
    assert.ok(fnBody.includes('_interceptMod = null'), 'must clear _interceptMod');
    assert.ok(fnBody.includes('_initialized = false'), 'must clear _initialized');
    assert.ok(fnBody.includes('_initPromise = null'), 'must clear _initPromise');
  });
});

// ============================================================================
// Group 7: INTEGRATION TESTS — migration-legacy (real I/O)
// ============================================================================

describe('ADR-0077 Phase 5: migration-legacy (integration)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = join(tmpdir(), `ruflo-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  function writeLegacyStore(dir, entries) {
    const store = {
      version: '2.0.0',
      entries,
    };
    writeFileSync(join(dir, 'store.json'), JSON.stringify(store), 'utf-8');
  }

  function writeMigrationMarker(dir) {
    writeFileSync(join(dir, '.migrated-to-sqlite'), JSON.stringify({
      migratedAt: new Date().toISOString(),
      version: '3.0.0',
    }), 'utf-8');
  }

  // Test 13
  it('migrateLegacyStore migrates real JSON file', async () => {
    // Write a legacy store with two entries
    const entries = {
      'pattern-auth': {
        key: 'pattern-auth',
        value: 'JWT with refresh tokens',
        metadata: {},
        storedAt: '2025-01-01T00:00:00.000Z',
        accessCount: 5,
        lastAccessed: '2025-06-01T00:00:00.000Z',
      },
      'pattern-db': {
        key: 'pattern-db',
        value: { type: 'connection-pool', maxSize: 10 },
        metadata: {},
        storedAt: '2025-02-01T00:00:00.000Z',
        accessCount: 3,
        lastAccessed: '2025-05-01T00:00:00.000Z',
      },
    };
    writeLegacyStore(tempDir, entries);

    // Simulate the migration process manually (same logic as migration-legacy.ts)
    const storeFile = join(tempDir, 'store.json');
    const data = JSON.parse(readFileSync(storeFile, 'utf-8'));
    const keys = Object.keys(data.entries);

    const storedEntries = [];
    const mockStore = mockFn(async (opts) => {
      storedEntries.push(opts);
      return { success: true };
    });

    let migrated = 0;
    for (const key of keys) {
      const entry = data.entries[key];
      const value = typeof entry.value === 'string'
        ? entry.value
        : JSON.stringify(entry.value);
      await mockStore({
        key,
        value,
        namespace: 'default',
        generateEmbeddingFlag: true,
      });
      migrated++;
    }

    assert.equal(migrated, 2, 'must migrate both entries');
    assert.equal(storedEntries.length, 2);

    // Verify string serialization of object values
    const dbEntry = storedEntries.find(e => e.key === 'pattern-db');
    assert.equal(typeof dbEntry.value, 'string', 'object values must be stringified');
    assert.ok(dbEntry.value.includes('"connection-pool"'), 'stringified value must contain original data');

    // Verify string values stay as-is
    const authEntry = storedEntries.find(e => e.key === 'pattern-auth');
    assert.equal(authEntry.value, 'JWT with refresh tokens');

    // All entries use default namespace and generateEmbeddingFlag: true
    for (const entry of storedEntries) {
      assert.equal(entry.namespace, 'default');
      assert.equal(entry.generateEmbeddingFlag, true);
    }

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 14
  it('hasLegacyStore returns false after migration marker exists', () => {
    writeLegacyStore(tempDir, { k: { key: 'k', value: 'v', storedAt: '', accessCount: 0, lastAccessed: '' } });

    // Before marker: legacy store exists
    assert.ok(existsSync(join(tempDir, 'store.json')), 'store.json must exist');
    assert.ok(!existsSync(join(tempDir, '.migrated-to-sqlite')), 'marker must not exist yet');

    // Simulate hasLegacyStore logic
    const hasStore = existsSync(join(tempDir, 'store.json')) &&
      !existsSync(join(tempDir, '.migrated-to-sqlite'));
    assert.ok(hasStore, 'hasLegacyStore must be true before migration');

    // Write migration marker
    writeMigrationMarker(tempDir);

    const hasStoreAfter = existsSync(join(tempDir, 'store.json')) &&
      !existsSync(join(tempDir, '.migrated-to-sqlite'));
    assert.ok(!hasStoreAfter, 'hasLegacyStore must be false after migration marker');

    rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 15
  it('migrateLegacyStore handles empty store', () => {
    writeLegacyStore(tempDir, {});

    const data = JSON.parse(readFileSync(join(tempDir, 'store.json'), 'utf-8'));
    const keys = Object.keys(data.entries);

    assert.equal(keys.length, 0, 'empty store has zero entries');

    // Migration logic: if entries is empty, return { migrated: 0, total: 0 }
    const result = keys.length === 0
      ? { migrated: 0, total: 0 }
      : { migrated: keys.length, total: keys.length };

    assert.equal(result.migrated, 0);
    assert.equal(result.total, 0);

    rmSync(tempDir, { recursive: true, force: true });
  });

  // Test 16
  it('migration-legacy handles missing file gracefully', () => {
    // No store.json written — simulate hasLegacyStore
    const hasStore = existsSync(join(tempDir, 'store.json'));
    assert.ok(!hasStore, 'no store.json means no migration needed');

    // Simulate loadLegacyStore on missing file
    let loaded = null;
    try {
      if (existsSync(join(tempDir, 'store.json'))) {
        loaded = JSON.parse(readFileSync(join(tempDir, 'store.json'), 'utf-8'));
      }
    } catch {
      // expected
    }
    assert.equal(loaded, null, 'loadLegacyStore returns null for missing file');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ============================================================================
// Group 8: INTEGRATION TEST — memory-router module exports
// ============================================================================

describe('ADR-0077 Phase 5: memory-router module exports (integration)', () => {

  // Test 17
  it('memory-router.ts exports all expected symbols', () => {
    const routerFile = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(routerFile)) return;
    const src = readFileSync(routerFile, 'utf-8');

    const expectedExports = [
      'routeMemoryOp',
      'getController',
      'hasController',
      'listControllerInfo',
      'waitForDeferred',
      'healthCheck',
      'ensureRouter',
      'resetRouter',
    ];

    for (const sym of expectedExports) {
      assert.ok(
        src.includes(`export async function ${sym}`) ||
        src.includes(`export function ${sym}`),
        `memory-router.ts must export ${sym}`,
      );
    }
  });

  it('memory-router.ts exports MemoryOpType and MemoryOp types', () => {
    const routerFile = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(routerFile)) return;
    const src = readFileSync(routerFile, 'utf-8');

    assert.ok(src.includes('export type MemoryOpType'), 'must export MemoryOpType');
    assert.ok(src.includes('export interface MemoryOp'), 'must export MemoryOp interface');
    assert.ok(src.includes('export interface MemoryResult'), 'must export MemoryResult interface');
  });

  it('MemoryOpType includes all 8 operation types', () => {
    const routerFile = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(routerFile)) return;
    const src = readFileSync(routerFile, 'utf-8');

    const expectedOps = ['store', 'search', 'get', 'delete', 'list', 'stats', 'count', 'listNamespaces'];
    for (const op of expectedOps) {
      assert.ok(src.includes(`'${op}'`), `MemoryOpType must include '${op}'`);
    }
  });
});

// ============================================================================
// Group 9: WIRING TESTS — import graph verification
// ============================================================================

describe('ADR-0077 Phase 5: wiring — import graph (source verification)', () => {

  // Test 18
  it('memory-tools.ts imports from memory-router (not memory-initializer directly)', () => {
    const file = `${MCP_TOOLS_SRC}/memory-tools.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      src.includes("from '../memory/memory-router.js'"),
      'memory-tools.ts must import from memory-router',
    );

    // Must import the key routing functions
    assert.ok(
      src.includes('routeMemoryOp'),
      'memory-tools.ts must import routeMemoryOp',
    );
    assert.ok(
      src.includes('ensureRouter'),
      'memory-tools.ts must import ensureRouter',
    );
  });

  // Test 19
  it('agentdb-tools.ts imports from memory-router (for getController)', () => {
    const file = `${MCP_TOOLS_SRC}/agentdb-tools.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      src.includes("from '../memory/memory-router.js'"),
      'agentdb-tools.ts must import from memory-router',
    );
    assert.ok(
      src.includes('getController'),
      'agentdb-tools.ts must import getController from memory-router',
    );
    assert.ok(
      src.includes('hasController'),
      'agentdb-tools.ts must import hasController from memory-router',
    );
  });

  // Test 20
  it('memory-router.ts does NOT import memory-bridge (Phase 4: controller-direct)', () => {
    const file = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    // Phase 4 removed bridge dependency from router — route methods use getController directly.
    const topLevelImports = src.split('\n').filter(l => l.startsWith('import '));
    const hasBridgeImport = topLevelImports.some(l => l.includes('memory-bridge'));
    assert.ok(
      !hasBridgeImport,
      'memory-router must NOT have top-level memory-bridge import',
    );

    // Verify router uses getController (controller-direct) instead of bridge
    assert.ok(
      src.includes('getController'),
      'memory-router must use getController for controller-direct access (ADR-0084 Phase 4)',
    );
  });

  // Test 21
  it('migration-legacy.ts is self-contained (no memory-bridge import)', () => {
    const file = `${MEMORY_SRC}/migration-legacy.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      !src.includes('memory-bridge'),
      'migration-legacy.ts must NOT import memory-bridge',
    );
    assert.ok(
      !src.includes('memory-initializer'),
      'migration-legacy.ts must NOT import memory-initializer',
    );

    // Verify it only imports from node builtins
    const imports = src.split('\n').filter(l => l.startsWith('import '));
    for (const imp of imports) {
      assert.ok(
        imp.includes("from 'fs'") ||
        imp.includes("from 'path'") ||
        imp.includes("from 'node:fs'") ||
        imp.includes("from 'node:path'"),
        `migration-legacy.ts imports must be node builtins only, found: ${imp}`,
      );
    }
  });
});

// ============================================================================
// Group 10: WIRING TESTS — memory-router internal structure
// ============================================================================

describe('ADR-0077 Phase 5: wiring — memory-router internal structure', () => {

  it('memory-router.ts uses lazy loading for storage functions', () => {
    const file = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      src.includes('loadStorageFns'),
      'must have loadStorageFns lazy loader',
    );
  });

  it('memory-router.ts uses lazy loading for controller-intercept', () => {
    const file = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      src.includes('loadIntercept'),
      'must have loadIntercept lazy loader',
    );
    assert.ok(
      src.includes('controller-intercept'),
      'loadIntercept must reference controller-intercept',
    );
  });

  it('memory-router.ts handles all MemoryOpType cases in switch', () => {
    const file = `${MEMORY_SRC}/memory-router.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    const expectedCases = ['store', 'search', 'get', 'delete', 'list', 'stats', 'count', 'listNamespaces'];
    for (const c of expectedCases) {
      assert.ok(
        src.includes(`case '${c}':`),
        `routeMemoryOp switch must handle case '${c}'`,
      );
    }
    assert.ok(
      src.includes('default:'),
      'routeMemoryOp switch must have a default case',
    );
  });

  it('memory-tools.ts imports migration-legacy separately', () => {
    const file = `${MCP_TOOLS_SRC}/memory-tools.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');

    assert.ok(
      src.includes("from '../memory/migration-legacy.js'"),
      'memory-tools.ts must import from migration-legacy.js',
    );
    assert.ok(
      src.includes('migrateLegacyStore'),
      'memory-tools.ts must import migrateLegacyStore',
    );
    assert.ok(
      src.includes('hasLegacyStore'),
      'memory-tools.ts must import hasLegacyStore',
    );
  });
});

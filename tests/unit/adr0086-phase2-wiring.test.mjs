// @tier unit
// ADR-0086 Phase 2: Verify RvfBackend wired into memory-router.
//
// Checks:
//   Group 1: _doInit uses RvfBackend (T2.2)
//   Group 2: routeMemoryOp uses IStorageContract (T2.3)
//   Group 3: routeEmbeddingOp uses adapter directly (T2.4)
//   Group 4: shutdownRouter calls storage.shutdown (T2.5)
//   Group 5: No StorageFns interface remains (T2.2)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const routerPath = `${CLI_SRC}/memory/memory-router.ts`;
const rvfPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

const routerSrc = readFileSync(routerPath, 'utf-8');
const rvfSrc = readFileSync(rvfPath, 'utf-8');

// ============================================================================
// Group 1: _doInit uses RvfBackend
// ============================================================================

describe('ADR-0086 T2.2: _doInit creates RvfBackend', () => {
  it('_doInit calls createStorage', () => {
    assert.ok(
      routerSrc.includes('_storage = await createStorage('),
      '_doInit does not create RvfBackend via createStorage',
    );
  });

  it('createStorage routes through storage-factory (ADR-0095 d2)', () => {
    // ADR-0095 amendment d2: createStorage in the CLI router now delegates to
    // @claude-flow/memory/storage-factory instead of constructing RvfBackend
    // directly. The factory's resolved-path cache deduplicates init work
    // between this call site and controller-registry's call site.
    assert.ok(
      routerSrc.includes('@claude-flow/memory/storage-factory'),
      'createStorage does not import storage-factory',
    );
    assert.ok(
      /memMod\.createStorage\s*\(/.test(routerSrc),
      'createStorage does not invoke factory.createStorage',
    );
    assert.ok(
      /path\.resolve\(\s*config\.databasePath/.test(routerSrc),
      'createStorage does not path.resolve() the dbPath (required for cache-key stability)',
    );
  });

  it('no loadStorageFns function exists', () => {
    assert.ok(
      !routerSrc.includes('async function loadStorageFns'),
      'loadStorageFns still exists — should be replaced by createStorage',
    );
  });

  it('no StorageFns interface exists', () => {
    assert.ok(
      !routerSrc.includes('interface StorageFns'),
      'StorageFns interface still present',
    );
  });
});

// ============================================================================
// Group 2: routeMemoryOp uses IStorageContract
// ============================================================================

describe('ADR-0086 T2.3: routeMemoryOp uses IStorageContract', () => {
  it('store case calls storage.store', () => {
    assert.ok(
      routerSrc.includes('await storage.store(entry)'),
      'routeMemoryOp store case does not call storage.store',
    );
  });

  it('search case calls storage.search with embedding', () => {
    assert.ok(
      routerSrc.includes('await storage.search(embedding'),
      'routeMemoryOp search case does not call storage.search',
    );
  });

  it('get case calls storage.getByKey', () => {
    assert.ok(
      routerSrc.includes('storage.getByKey('),
      'routeMemoryOp get case does not call storage.getByKey',
    );
  });

  it('delete case calls storage.delete', () => {
    assert.ok(
      routerSrc.includes('await storage.delete(entry.id)'),
      'routeMemoryOp delete case does not call storage.delete',
    );
  });

  it('count case calls storage.count', () => {
    assert.ok(
      routerSrc.includes('storage.count('),
      'routeMemoryOp count case does not call storage.count',
    );
  });

  it('listNamespaces case calls storage.listNamespaces', () => {
    assert.ok(
      routerSrc.includes('storage.listNamespaces()'),
      'routeMemoryOp listNamespaces case does not call storage.listNamespaces',
    );
  });

  it('no fns.storeEntry calls remain', () => {
    assert.ok(
      !routerSrc.includes('fns.storeEntry'),
      'routeMemoryOp still uses fns.storeEntry',
    );
  });
});

// ============================================================================
// Group 3: routeEmbeddingOp uses adapter directly
// ============================================================================

describe('ADR-0086 T2.4: routeEmbeddingOp uses embedding-adapter', () => {
  it('generate case imports adapter directly', () => {
    // The embedding-adapter import should appear in routeEmbeddingOp
    assert.ok(
      routerSrc.includes("adapter.generateEmbedding("),
      'routeEmbeddingOp generate case does not use adapter',
    );
  });

  it('HNSW cases use RvfBackend (Phase 3 complete)', () => {
    assert.ok(
      routerSrc.includes('_storage.search') || routerSrc.includes('_storage.getStats'),
      'HNSW cases should use _storage (RvfBackend)',
    );
  });
});

// ============================================================================
// Group 4: shutdownRouter calls storage.shutdown
// ============================================================================

describe('ADR-0086 T2.5: shutdownRouter', () => {
  it('calls _storage.shutdown()', () => {
    assert.ok(
      routerSrc.includes('_storage.shutdown()'),
      'shutdownRouter does not call _storage.shutdown()',
    );
  });
});

// ============================================================================
// Group 5: RvfBackend implements IStorageContract
// ============================================================================

describe('ADR-0086 T2.1: RvfBackend implements IMemoryBackend (Debt 1 merged)', () => {
  it('class declaration includes IMemoryBackend', () => {
    assert.ok(
      rvfSrc.includes('implements IMemoryBackend'),
      'RvfBackend must implement IMemoryBackend',
    );
  });

  it('class declaration does NOT include IStorageContract (Debt 1 type alias)', () => {
    // After Debt 1, IStorageContract is a type alias — cannot appear in implements clause
    const classLine = rvfSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classLine, 'RvfBackend class declaration not found');
    assert.ok(
      !classLine[1].includes('IStorageContract'),
      'RvfBackend must NOT implement IStorageContract (it is a type alias after Debt 1)',
    );
  });

  it('IStorageContract is a type alias in storage.ts', () => {
    const storageSrc = readFileSync(
      '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/storage.ts', 'utf-8');
    const aliasPattern = /export\s+type\s+IStorageContract\s*=\s*IMemoryBackend\s*;/;
    assert.ok(
      aliasPattern.test(storageSrc),
      'IStorageContract must be a type alias for IMemoryBackend in storage.ts',
    );
  });
});

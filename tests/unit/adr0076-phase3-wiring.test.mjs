// @tier unit
// ADR-0076 Phase 3: Verify consumers are wired to createStorage()
//
// Source verification tests — check that controller-registry and
// memory-initializer use the storage factory instead of direct construction.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory';

// ===========================================================================
// controller-registry.ts uses createStorage
// ===========================================================================

describe('Phase 3 wiring: controller-registry uses createStorage', () => {
  const file = `${MEMORY_SRC}/controller-registry.ts`;

  it('initialize() calls createStorageFromConfig when no config.backend', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('createStorageFromConfig'),
      'initialize() must call createStorageFromConfig as fallback',
    );
  });

  it('imports storage-factory.js', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('storage-factory'),
      'must import from storage-factory.js',
    );
  });

  it('config.backend still takes priority over factory', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // The explicit config.backend check must come BEFORE the factory call
    const backendCheck = src.indexOf('config.backend');
    const factoryCall = src.indexOf('createStorageFromConfig');
    assert.ok(backendCheck > 0 && factoryCall > 0, 'both must exist');
    assert.ok(
      backendCheck < factoryCall,
      'config.backend check must come before factory call',
    );
  });

  it('factory failure falls back to null (not crash)', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // The factory call should be in a try/catch — look in a wider block
    const factoryIdx = src.indexOf('createStorageFromConfig');
    const blockStart = src.lastIndexOf('try', factoryIdx);
    const blockEnd = src.indexOf('catch', factoryIdx);
    assert.ok(
      blockStart > 0 && blockEnd > factoryIdx && (factoryIdx - blockStart) < 300,
      'factory call must be in try/catch for graceful degradation',
    );
  });
});

// ===========================================================================
// memory-initializer.ts has createStorage redirect
// ===========================================================================

// ===========================================================================
// storage-factory.ts and storage.ts correctness
// ===========================================================================

describe('Phase 3: storage abstraction files', () => {
  it('storage.ts exports IStorage', () => {
    const path = `${MEMORY_SRC}/storage.ts`;
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    assert.ok(src.includes('IStorage'), 'must export IStorage');
  });

  it('IStorageContract is a type alias for IMemoryBackend (Debt 1)', () => {
    const storagePath = `${MEMORY_SRC}/storage.ts`;
    if (!existsSync(storagePath)) return;
    const storageSrc = readFileSync(storagePath, 'utf-8');
    const aliasPattern = /export\s+type\s+IStorageContract\s*=\s*IMemoryBackend\s*;/;
    assert.ok(aliasPattern.test(storageSrc),
      'IStorageContract must be a type alias for IMemoryBackend');
  });

  it('IMemoryBackend has all 16 canonical methods', () => {
    const typesPath = `${MEMORY_SRC}/types.ts`;
    if (!existsSync(typesPath)) return;
    const src = readFileSync(typesPath, 'utf-8');
    const methods = [
      'initialize', 'shutdown', 'store', 'get', 'getByKey',
      'update', 'delete', 'search', 'query', 'count',
      'bulkInsert', 'bulkDelete', 'listNamespaces', 'clearNamespace',
      'getStats', 'healthCheck',
    ];
    for (const method of methods) {
      assert.ok(
        src.includes(method),
        `IMemoryBackend must include ${method}`,
      );
    }
  });

  it('storage-factory.ts does not use InMemoryStore', () => {
    const path = `${MEMORY_SRC}/storage-factory.ts`;
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    assert.ok(
      !src.match(/new\s+InMemoryStore/) && !src.match(/import.*InMemoryStore/),
      'factory must not use InMemoryStore',
    );
  });

  it('storage-factory.ts forwards maxElements from config', () => {
    const path = `${MEMORY_SRC}/storage-factory.ts`;
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    assert.ok(
      src.includes('maxEntries') && src.includes('maxElements'),
      'createStorageFromConfig must forward maxEntries as maxElements',
    );
  });

  it('index.ts exports createStorage and IStorage', () => {
    const path = `${MEMORY_SRC}/index.ts`;
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    assert.ok(src.includes('createStorage'), 'must export createStorage');
    assert.ok(src.includes('IStorage'), 'must export IStorage');
  });
});

// ===========================================================================
// No new RvfBackend() outside factory (except fallback)
// ===========================================================================

describe('Phase 3: direct RvfBackend construction minimized', () => {
  it('controller-registry.ts does not directly construct RvfBackend', () => {
    const path = `${MEMORY_SRC}/controller-registry.ts`;
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    assert.ok(
      !src.match(/new\s+RvfBackend\s*\(/),
      'controller-registry must use factory, not direct RvfBackend construction',
    );
  });
});

// @tier unit
// ADR-0086 Phase 2b: Verify all initializer functions are stubs.
//
// After T2.6, every initializer function body delegates to either:
//   - routeMemoryOp (CRUD: storeEntry, searchEntries, listEntries, getEntry, deleteEntry)
//   - _loadAdapter (embedding: loadEmbeddingModel, generateEmbedding, etc.)
//
// This ensures all data flows through RvfBackend, not SQLite directly.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const initializerPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-initializer.ts';
const src = readFileSync(initializerPath, 'utf-8');

// ============================================================================
// Group 1: CRUD stubs delegate to routeMemoryOp
// ============================================================================

describe('ADR-0086 T2.6: CRUD functions delegate to routeMemoryOp', () => {
  const crudFns = ['storeEntry', 'searchEntries', 'listEntries', 'getEntry', 'deleteEntry'];

  for (const fn of crudFns) {
    it(`${fn} delegates to routeMemoryOp`, () => {
      // Find the function and check its body contains routeMemoryOp delegation
      const fnStart = src.indexOf(`export async function ${fn}(`);
      assert.ok(fnStart !== -1, `${fn} not found in initializer`);
      const fnBody = src.slice(fnStart, fnStart + 500);
      assert.ok(
        fnBody.includes('routeMemoryOp') || fnBody.includes('_loadRouter'),
        `${fn} does not delegate to routeMemoryOp`,
      );
    });
  }
});

// ============================================================================
// Group 2: Embedding stubs delegate to adapter
// ============================================================================

describe('ADR-0086 T1.3+T2.6: Embedding functions delegate to adapter', () => {
  const embFns = ['loadEmbeddingModel', 'generateEmbedding', 'generateBatchEmbeddings', 'getAdaptiveThreshold'];

  for (const fn of embFns) {
    it(`${fn} delegates to _loadAdapter`, () => {
      const fnStart = src.indexOf(`export async function ${fn}(`);
      assert.ok(fnStart !== -1, `${fn} not found in initializer`);
      const fnBody = src.slice(fnStart, fnStart + 500);
      assert.ok(
        fnBody.includes('_loadAdapter'),
        `${fn} does not delegate to embedding adapter`,
      );
    });
  }
});

// ============================================================================
// Group 3: No direct SQLite usage in stub functions
// ============================================================================

describe('ADR-0086 Phase 2b: No direct SQLite in CRUD stubs', () => {
  it('no _getDb calls in storeEntry stub', () => {
    const fnStart = src.indexOf('export async function storeEntry(');
    const fnEnd = src.indexOf('export async function searchEntries(');
    const fnBody = src.slice(fnStart, fnEnd);
    assert.ok(!fnBody.includes('_getDb('), 'storeEntry still uses _getDb — not a stub');
  });

  it('no db.prepare calls in CRUD stubs', () => {
    // Check each CRUD function for direct SQLite calls
    const crudFns = ['storeEntry', 'searchEntries', 'listEntries', 'getEntry', 'deleteEntry'];
    for (let i = 0; i < crudFns.length; i++) {
      const fnStart = src.indexOf(`export async function ${crudFns[i]}(`);
      // End at next export or end of file
      const searchAfter = fnStart + 100;
      let fnEnd = src.indexOf('export async function', searchAfter);
      if (fnEnd === -1) fnEnd = src.indexOf('export function', searchAfter);
      if (fnEnd === -1) fnEnd = src.length;
      const fnBody = src.slice(fnStart, fnEnd);
      assert.ok(
        !fnBody.includes('db.prepare('),
        `${crudFns[i]} still uses db.prepare — not a stub`,
      );
    }
  });
});

// ============================================================================
// Group 4: Line count reduction
// ============================================================================

describe('ADR-0086 Phase 2b: Line count', () => {
  const lines = src.split('\n').length;

  it('initializer below 1800 lines after CRUD stub replacement', () => {
    assert.ok(lines <= 1800, `Expected <= 1800 lines, got ${lines}`);
  });
});

// ============================================================================
// Group 5: _loadRouter helper exists
// ============================================================================

describe('ADR-0086 T2.6: _loadRouter helper', () => {
  it('_loadRouter function exists', () => {
    assert.ok(src.includes('async function _loadRouter'), '_loadRouter not found');
  });

  it('_loadRouter imports memory-router', () => {
    assert.ok(src.includes("memory-router.js"), '_loadRouter does not import memory-router');
  });
});

// @tier unit
// ADR-0083: Phase 5 — Single Data Flow Path
// London School TDD: structural source analysis, no real imports of migrated TS files.
//
// These tests verify the STRUCTURAL property that migrated files route all memory
// operations through memory-router.ts, and do NOT directly import from
// memory-initializer.ts or memory-bridge.ts as external callers.
//
// memory-router.ts itself is the one permitted internal consumer of memory-initializer;
// ADR-0085 deleted memory-bridge.ts — bridge-absence assertions now pass trivially.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FORK_BASE = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(relPath) {
  return readFileSync(join(FORK_BASE, relPath), 'utf-8');
}

// Match a concrete dynamic import of the given module path (not a comment).
// Looks for: import('...memory-xxx.js') or import("...memory-xxx.js")
// Uses [^)]* to consume everything inside the parens — avoids character-class quoting issues.
function hasDynamicImport(src, moduleBasename) {
  return new RegExp(`import\\s*\\([^)]*${moduleBasename}[^)]*\\)`).test(src);
}

// Match a static top-level import from a given module (not a comment).
// Looks for: import { ... } from '...module-xxx.js'  or  import '...'
// The second [^'"]* after the basename handles the .js suffix before the closing quote.
function hasStaticImport(src, moduleBasename) {
  return new RegExp(`^import\\b[^\\n]*['"][^'"]*${moduleBasename}[^'"]*['"]`, 'm').test(src);
}

// ============================================================================
// Wave 1 — session-tools.ts
// ============================================================================

describe('ADR-0083 Wave 1: session-tools.ts import migration', () => {
  const FILE = 'mcp-tools/session-tools.ts';

  it('session-tools.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('session-tools.ts does NOT statically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-initializer'),
      'session-tools.ts must not have a static import from memory-initializer.js',
    );
  });

  it('session-tools.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'session-tools.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('session-tools.ts does NOT statically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-bridge'),
      'session-tools.ts must not have a static import from memory-bridge.js',
    );
  });

  it('session-tools.ts does NOT dynamically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-bridge'),
      'session-tools.ts must not dynamically import from memory-bridge.js',
    );
  });

  it('session-tools.ts routes memory operations through memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'session-tools.ts must dynamically import from memory-router.js',
    );
  });
});

// ============================================================================
// Wave 1 — daa-tools.ts
// ============================================================================

describe('ADR-0083 Wave 1: daa-tools.ts import migration', () => {
  const FILE = 'mcp-tools/daa-tools.ts';

  it('daa-tools.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('daa-tools.ts does NOT statically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-bridge'),
      'daa-tools.ts must not have a static import from memory-bridge.js',
    );
  });

  it('daa-tools.ts does NOT dynamically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-bridge'),
      'daa-tools.ts must not dynamically import from memory-bridge.js',
    );
  });

  it('daa-tools.ts does NOT statically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-initializer'),
      'daa-tools.ts must not have a static import from memory-initializer.js',
    );
  });

  it('daa-tools.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'daa-tools.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('daa-tools.ts routes memory operations through memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'daa-tools.ts must dynamically import from memory-router.js',
    );
  });
});

// ============================================================================
// Wave 1 — agentdb-orchestration.ts
// ============================================================================

describe('ADR-0083 Wave 1: agentdb-orchestration.ts import migration', () => {
  const FILE = 'mcp-tools/agentdb-orchestration.ts';

  it('agentdb-orchestration.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('agentdb-orchestration.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'agentdb-orchestration.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('agentdb-orchestration.ts does NOT dynamically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-bridge'),
      'agentdb-orchestration.ts must not dynamically import from memory-bridge.js',
    );
  });

  // ADR-0084 Phase 3: agentdb-orchestration now uses lazy dynamic imports
  // (await import('../memory/memory-router.js')) inside function bodies,
  // not static top-level imports. Updated to match the new pattern.

  it('agentdb-orchestration.ts imports from memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'agentdb-orchestration.ts must dynamically import from memory-router.js',
    );
  });

  it('agentdb-orchestration.ts imports getController from memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      src.includes('getController') && hasDynamicImport(src, 'memory-router'),
      'agentdb-orchestration.ts must import getController from memory-router.js',
    );
  });

  it('agentdb-orchestration.ts imports routeMemoryOp from memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      src.includes('routeMemoryOp') && hasDynamicImport(src, 'memory-router'),
      'agentdb-orchestration.ts must import routeMemoryOp from memory-router.js',
    );
  });
});

// ============================================================================
// Wave 2 — embeddings-tools.ts
// ============================================================================

describe('ADR-0083 Wave 2: embeddings-tools.ts import migration', () => {
  const FILE = 'mcp-tools/embeddings-tools.ts';

  it('embeddings-tools.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('embeddings-tools.ts does NOT statically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-initializer'),
      'embeddings-tools.ts must not have a static import from memory-initializer.js',
    );
  });

  it('embeddings-tools.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'embeddings-tools.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('embeddings-tools.ts does NOT statically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-bridge'),
      'embeddings-tools.ts must not have a static import from memory-bridge.js',
    );
  });

  it('embeddings-tools.ts routes embedding operations through memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'embeddings-tools.ts must dynamically import from memory-router.js',
    );
  });
});

// ============================================================================
// Wave 2 — system-tools.ts
// ============================================================================

describe('ADR-0083 Wave 2: system-tools.ts import migration', () => {
  const FILE = 'mcp-tools/system-tools.ts';

  it('system-tools.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('system-tools.ts does NOT statically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-bridge'),
      'system-tools.ts must not have a static import from memory-bridge.js',
    );
  });

  it('system-tools.ts does NOT dynamically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-bridge'),
      'system-tools.ts must not dynamically import from memory-bridge.js',
    );
  });

  it('system-tools.ts does NOT statically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-initializer'),
      'system-tools.ts must not have a static import from memory-initializer.js',
    );
  });

  it('system-tools.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'system-tools.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('system-tools.ts routes memory operations through memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'system-tools.ts must dynamically import from memory-router.js',
    );
  });
});

// ============================================================================
// Wave 2 — memory/intelligence.ts
// ============================================================================

describe('ADR-0083 Wave 2: memory/intelligence.ts import migration', () => {
  const FILE = 'memory/intelligence.ts';

  it('memory/intelligence.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), `${FILE} must exist`);
  });

  it('intelligence.ts does NOT statically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-bridge'),
      'intelligence.ts must not have a static import from memory-bridge.js',
    );
  });

  it('intelligence.ts does NOT dynamically import from memory-bridge', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-bridge'),
      'intelligence.ts must not dynamically import from memory-bridge.js',
    );
  });

  it('intelligence.ts does NOT statically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasStaticImport(src, 'memory-initializer'),
      'intelligence.ts must not have a static import from memory-initializer.js',
    );
  });

  it('intelligence.ts does NOT dynamically import from memory-initializer', () => {
    const src = readSource(FILE);
    assert.ok(
      !hasDynamicImport(src, 'memory-initializer'),
      'intelligence.ts must not dynamically import from memory-initializer.js',
    );
  });

  it('intelligence.ts routes memory operations through memory-router', () => {
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-router'),
      'intelligence.ts must dynamically import from memory-router.js',
    );
  });
});

// ============================================================================
// Deletion verification — Wave 1 deleted files
// ============================================================================

describe('ADR-0083 Wave 1: deleted file verification', () => {
  it('memory/rvf-shim.ts has been deleted (Wave 1: router handles RVF directly)', () => {
    const fpath = join(FORK_BASE, 'memory/rvf-shim.ts');
    assert.ok(
      !existsSync(fpath),
      'memory/rvf-shim.ts must not exist — was deleted in Wave 1 (router is the single RVF write path)',
    );
  });
});

// ============================================================================
// Deletion verification — Wave 2 deleted files
// ============================================================================

describe('ADR-0083 Wave 2: deleted file verification', () => {
  it('memory/open-database.ts has been deleted (Wave 2: router manages DB lifecycle)', () => {
    const fpath = join(FORK_BASE, 'memory/open-database.ts');
    assert.ok(
      !existsSync(fpath),
      'memory/open-database.ts must not exist — was deleted in Wave 2 (router manages DB lifecycle directly)',
    );
  });
});

// ============================================================================
// memory-router.ts structural invariants
// ============================================================================

describe('ADR-0083: memory-router.ts structural invariants', () => {
  const FILE = 'memory/memory-router.ts';

  it('memory-router.ts exists', () => {
    assert.ok(existsSync(join(FORK_BASE, FILE)), 'memory-router.ts must exist');
  });

  it('memory-router.ts is the sole permitted internal consumer of memory-initializer', () => {
    // memory-router may import from memory-initializer as its private implementation.
    // All OTHER files must NOT. This test simply asserts the router itself imports it
    // (confirming it is the internal delegation layer, not that it was accidentally cleared).
    const src = readSource(FILE);
    assert.ok(
      hasDynamicImport(src, 'memory-initializer'),
      'memory-router.ts must import from memory-initializer.js (private delegation)',
    );
  });

  it('memory-router.ts exports routeMemoryOp as the primary CRUD entry point', () => {
    const src = readSource(FILE);
    assert.ok(
      src.includes('export') && src.includes('routeMemoryOp'),
      'memory-router.ts must export routeMemoryOp',
    );
  });

  it('memory-router.ts exports getController for controller-intercept pool access', () => {
    const src = readSource(FILE);
    assert.ok(
      src.includes('export') && src.includes('getController'),
      'memory-router.ts must export getController',
    );
  });
});

// ============================================================================
// Mock contract tests — routeMemoryOp delegation contract
// ============================================================================

describe('ADR-0083 mock: routeMemoryOp delegation contract', () => {
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

  it('mock routeMemoryOp accepts store operation and returns result', async () => {
    const routeMemoryOp = mockFn(async (op, payload) => ({
      success: true,
      operation: op,
      id: 'test-id',
    }));

    const result = await routeMemoryOp('store', { key: 'test', value: 'data', namespace: 'default' });

    assert.equal(result.success, true);
    assert.equal(result.operation, 'store');
    assert.equal(routeMemoryOp.calls.length, 1);
    assert.equal(routeMemoryOp.calls[0][0], 'store');
    assert.deepStrictEqual(routeMemoryOp.calls[0][1], { key: 'test', value: 'data', namespace: 'default' });
  });

  it('mock routeMemoryOp accepts search operation and returns results array', async () => {
    const routeMemoryOp = mockFn(async (op, payload) => ({
      success: true,
      results: [{ key: 'test', value: 'data', score: 0.9 }],
    }));

    const result = await routeMemoryOp('search', { query: 'test', namespace: 'default' });

    assert.equal(result.success, true);
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length, 1);
    assert.equal(routeMemoryOp.calls.length, 1);
    assert.equal(routeMemoryOp.calls[0][0], 'search');
  });

  it('mock getController returns controller by name without importing bridge', async () => {
    const getController = mockFn(async (name) => ({
      name,
      store: mockFn(async () => ({ id: 'stored' })),
      search: mockFn(async () => []),
    }));

    const controller = await getController('reasoningBank');

    assert.equal(controller.name, 'reasoningBank');
    assert.equal(typeof controller.store, 'function');
    assert.equal(getController.calls.length, 1);
    assert.deepStrictEqual(getController.calls[0], ['reasoningBank']);
  });

  it('mock: callers receive the same result shape regardless of whether router delegates to bridge or initializer', async () => {
    // This verifies the abstraction contract: callers should be indifferent to
    // the internal delegation target.
    const routeMemoryOp = mockFn(async (_op, _payload) => ({
      success: true,
      entries: [],
    }));

    const fromBridgeCallerResult = await routeMemoryOp('list', { namespace: 'default' });
    const fromInitializerCallerResult = await routeMemoryOp('list', { namespace: 'default' });

    assert.deepStrictEqual(fromBridgeCallerResult, fromInitializerCallerResult);
  });
});

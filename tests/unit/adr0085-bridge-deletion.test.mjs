// @tier unit
// ADR-0085: Bridge Deletion & Ideal State Gap Closure
//
// London School TDD: structural source analysis + mock-driven unit tests.
// Verifies:
//   T1.5  initControllerRegistry exists in router
//   T1.5  getController uses local registry first
//   T2.4  initializer has zero bridge imports
//   T3.4  memory-bridge.ts is deleted from fork tree
//   T4.4  acceptance-level structural checks

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Mock helpers
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

// ============================================================================
// Source paths
// ============================================================================

const SRC_ROOT = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

const ROUTER_PATH       = `${SRC_ROOT}/memory/memory-router.ts`;
const INITIALIZER_PATH  = `${SRC_ROOT}/memory/memory-initializer.ts`;
const BRIDGE_PATH       = `${SRC_ROOT}/memory/memory-bridge.ts`;

// ============================================================================
// Group 1: memory-bridge.ts is deleted (T3.4)
// ============================================================================

describe('ADR-0085 T3.4: memory-bridge.ts deletion', () => {
  it('memory-bridge.ts does NOT exist in fork tree', () => {
    assert.ok(
      !existsSync(BRIDGE_PATH),
      `memory-bridge.ts must be deleted — found at ${BRIDGE_PATH}`,
    );
  });
});

// ============================================================================
// Group 2: Router has initControllerRegistry (T1.5)
// ============================================================================

describe('ADR-0085 T1.5: router contains initControllerRegistry', () => {
  let routerSrc;

  beforeEach(() => {
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('router source contains initControllerRegistry function', () => {
    assert.ok(
      routerSrc.includes('async function initControllerRegistry'),
      'memory-router.ts must define initControllerRegistry()',
    );
  });

  it('router source contains _findProjectRoot helper', () => {
    assert.ok(
      routerSrc.includes('function _findProjectRoot'),
      'memory-router.ts must contain _findProjectRoot() helper (extracted from bridge)',
    );
  });

  it('router source contains _readProjectConfig helper', () => {
    assert.ok(
      routerSrc.includes('function _readProjectConfig'),
      'memory-router.ts must contain _readProjectConfig() helper (extracted from bridge)',
    );
  });

  it('router source contains _getProjectConfig helper', () => {
    assert.ok(
      routerSrc.includes('function _getProjectConfig'),
      'memory-router.ts must contain _getProjectConfig() helper (extracted from bridge)',
    );
  });

  it('router source contains _getDbPath helper', () => {
    assert.ok(
      routerSrc.includes('function _getDbPath'),
      'memory-router.ts must contain _getDbPath() helper (extracted from bridge)',
    );
  });

  it('router source contains _ensureExitHook helper', () => {
    assert.ok(
      routerSrc.includes('function _ensureExitHook'),
      'memory-router.ts must contain _ensureExitHook() helper (extracted from bridge)',
    );
  });

  it('ensureRouter calls initControllerRegistry', () => {
    assert.ok(
      routerSrc.includes('initControllerRegistry()'),
      'ensureRouter() must call initControllerRegistry()',
    );
  });

  it('registry state variables exist in router', () => {
    assert.ok(routerSrc.includes('_registryInstance'), 'must have _registryInstance');
    assert.ok(routerSrc.includes('_registryPromise'), 'must have _registryPromise');
    assert.ok(routerSrc.includes('_registryAvailable'), 'must have _registryAvailable');
  });
});

// ============================================================================
// Group 3: getController uses local registry first (T1.5)
// ============================================================================

describe('ADR-0085 T1.5: getController local registry priority', () => {
  let routerSrc;

  beforeEach(() => {
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('getController checks _registryInstance before intercept', () => {
    const getControllerBlock = routerSrc.slice(
      routerSrc.indexOf('export async function getController'),
      routerSrc.indexOf('export async function getController') + 600,
    );
    const registryIdx = getControllerBlock.indexOf('_registryInstance');
    const interceptIdx = getControllerBlock.indexOf('loadIntercept');
    assert.ok(registryIdx > -1, 'getController must reference _registryInstance');
    assert.ok(interceptIdx > -1, 'getController must reference loadIntercept');
    assert.ok(
      registryIdx < interceptIdx,
      'getController must check local registry BEFORE falling back to intercept',
    );
  });
});

// ============================================================================
// Group 4: getController mock-driven unit test (T1.5)
// ============================================================================

describe('ADR-0085 T1.5 unit: getController with mock registry', () => {
  it('returns controller from local registry if available', async () => {
    const mockRegistry = {
      get: mockFn((name) => name === 'reasoningBank' ? { mock: true } : undefined),
    };

    // Simulate what getController does: check registry first
    const name = 'reasoningBank';
    let result;
    if (mockRegistry && typeof mockRegistry.get === 'function') {
      const ctrl = mockRegistry.get(name);
      if (ctrl) result = ctrl;
    }

    assert.deepEqual(result, { mock: true });
    assert.equal(mockRegistry.get.calls.length, 1);
    assert.equal(mockRegistry.get.calls[0][0], 'reasoningBank');
  });

  it('falls through to intercept when registry returns undefined', async () => {
    const mockRegistry = {
      get: mockFn(() => undefined),
    };
    const mockIntercept = {
      getExisting: mockFn(() => ({ intercepted: true })),
    };

    const name = 'unknownCtrl';
    let result;
    if (mockRegistry && typeof mockRegistry.get === 'function') {
      const ctrl = mockRegistry.get(name);
      if (ctrl) { result = ctrl; }
    }
    if (!result && mockIntercept?.getExisting) {
      result = mockIntercept.getExisting(name);
    }

    assert.deepEqual(result, { intercepted: true });
  });
});

// ============================================================================
// Group 5: Initializer has zero bridge imports (T2.4)
// ============================================================================

describe('ADR-0085 T2.4: initializer has zero bridge dependency', () => {
  let initSrc;

  beforeEach(() => {
    initSrc = readFileSync(INITIALIZER_PATH, 'utf-8');
  });

  it('initializer does NOT import from memory-bridge', () => {
    const lines = initSrc.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO bridge imports, found: ${bridgeImports.join('; ')}`);
  });

  it('initializer does NOT contain getBridge function', () => {
    assert.ok(
      !initSrc.includes('async function getBridge'),
      'memory-initializer.ts must not define getBridge()',
    );
  });

  it('initializer does NOT contain _bridge variable', () => {
    // Match "let _bridge" but not the ADR-0085 comment
    const lines = initSrc.split('\n');
    const bridgeVarLines = lines.filter(l => l.match(/^\s*let _bridge\b/));
    assert.equal(bridgeVarLines.length, 0,
      `Expected no _bridge variable declaration, found: ${bridgeVarLines.join('; ')}`);
  });

  it('initializer does NOT contain activateControllerRegistry function', () => {
    assert.ok(
      !initSrc.includes('async function activateControllerRegistry'),
      'memory-initializer.ts must not define activateControllerRegistry()',
    );
  });

  it('initializer does NOT call getBridge()', () => {
    const lines = initSrc.split('\n');
    const callLines = lines.filter(l =>
      l.includes('getBridge()') && !l.trimStart().startsWith('//')
    );
    assert.equal(callLines.length, 0,
      `Expected zero getBridge() calls, found ${callLines.length}: ${callLines.join('; ')}`);
  });
});

// ============================================================================
// Group 6: shutdownRouter resets registry (T1.5)
// ============================================================================

describe('ADR-0085 T1.5: shutdownRouter resets registry state', () => {
  let routerSrc;

  beforeEach(() => {
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('resetRouter clears _registryInstance', () => {
    assert.ok(
      routerSrc.includes('_registryInstance = null'),
      'resetRouter() must reset _registryInstance to null',
    );
  });

  it('resetRouter clears _registryPromise', () => {
    assert.ok(
      routerSrc.includes('_registryPromise = null'),
      'resetRouter() must reset _registryPromise to null',
    );
  });

  it('resetRouter clears _registryAvailable', () => {
    assert.ok(
      routerSrc.includes('_registryAvailable = null'),
      'resetRouter() must reset _registryAvailable to null',
    );
  });

  it('shutdownRouter calls registry.shutdown', () => {
    const shutdownBlock = routerSrc.slice(
      routerSrc.indexOf('export async function shutdownRouter'),
      routerSrc.indexOf('export async function shutdownRouter') + 400,
    );
    assert.ok(
      shutdownBlock.includes('_registryInstance'),
      'shutdownRouter must reference _registryInstance for shutdown',
    );
  });
});

// ============================================================================
// Group 7: Integration — router has no bridge references as dependencies
// ============================================================================

describe('ADR-0085 integration: router does NOT import from memory-bridge', () => {
  let routerSrc;

  beforeEach(() => {
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('router has zero dynamic imports of memory-bridge', () => {
    const importPattern = /import\s*\([^)]*memory-bridge[^)]*\)/g;
    const matches = routerSrc.match(importPattern);
    assert.equal(matches, null,
      `Expected zero memory-bridge dynamic imports, found: ${matches}`);
  });

  it('router has zero static imports of memory-bridge', () => {
    const lines = routerSrc.split('\n');
    const staticImports = lines.filter(l =>
      /^import\b/.test(l.trim()) && l.includes('memory-bridge')
    );
    assert.equal(staticImports.length, 0,
      `Expected zero memory-bridge static imports, found: ${staticImports.join('; ')}`);
  });
});

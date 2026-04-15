// @tier unit
// ADR-0076 Phase 4: Contract regression tests for controller-intercept
//
// Guards the singleton-pool surface that prevents dual controller construction.
// Source: @claude-flow/memory/src/controller-intercept.ts
//
// Caller contract:
//   - Never `new ControllerRegistry()` directly outside the bootstrap path.
//   - All cached controllers go through the intercept pool — first caller's
//     factory wins, subsequent calls return the existing instance.
//
// The CLI router (memory-router.ts getController) pulls from this pool as a
// fallback when its local registry is unavailable. Tests check the structural
// contract; behavior is exercised in adr0086-circuit-breaker.test.mjs.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC    = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const CLI_SRC       = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const INTERCEPT_PATH = `${MEMORY_SRC}/controller-intercept.ts`;
const ROUTER_PATH    = `${CLI_SRC}/memory/memory-router.ts`;
const INDEX_PATH     = `${MEMORY_SRC}/index.ts`;

assert.ok(existsSync(INTERCEPT_PATH), `controller-intercept.ts not found at ${INTERCEPT_PATH}`);
assert.ok(existsSync(ROUTER_PATH),    `memory-router.ts not found at ${ROUTER_PATH}`);
assert.ok(existsSync(INDEX_PATH),     `memory index.ts not found at ${INDEX_PATH}`);

const interceptSrc = readFileSync(INTERCEPT_PATH, 'utf-8');
const routerSrc    = readFileSync(ROUTER_PATH,    'utf-8');
const indexSrc     = readFileSync(INDEX_PATH,     'utf-8');

// ============================================================================
// Helpers
// ============================================================================

function collectTsFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ============================================================================
// Group 1: Public API — singleton pool functions
// ============================================================================

describe('ADR-0076 controller-intercept: public API', () => {
  it('exports getOrCreate(name, factory) — primary singleton accessor', () => {
    assert.ok(
      /export\s+function\s+getOrCreate\s*</.test(interceptSrc) ||
      /export\s+function\s+getOrCreate\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function getOrCreate()`',
    );
  });

  it('exports getExisting(name) — cache lookup without construction', () => {
    assert.ok(
      /export\s+function\s+getExisting\s*</.test(interceptSrc) ||
      /export\s+function\s+getExisting\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function getExisting()`',
    );
  });

  it('exports has(name) — pool membership test', () => {
    assert.ok(
      /export\s+function\s+has\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function has()`',
    );
  });

  it('exports listControllers() — return registered names', () => {
    assert.ok(
      /export\s+function\s+listControllers\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function listControllers()`',
    );
  });

  it('exports controllerCount() — return pool size', () => {
    assert.ok(
      /export\s+function\s+controllerCount\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function controllerCount()`',
    );
  });

  it('exports resetInterceptPool() — test-only reset', () => {
    assert.ok(
      /export\s+function\s+resetInterceptPool\s*\(/.test(interceptSrc),
      'controller-intercept.ts must export `function resetInterceptPool()`',
    );
  });
});

// ============================================================================
// Group 2: Singleton pool semantics — first caller wins
// ============================================================================

describe('ADR-0076 controller-intercept: singleton semantics', () => {
  it('module holds a Map<string, unknown> singleton pool', () => {
    assert.ok(
      /const\s+_instances\s*=\s*new\s+Map\s*</.test(interceptSrc),
      'controller-intercept must hold a module-level _instances Map',
    );
  });

  it('getOrCreate returns the cached instance on subsequent calls', () => {
    const fnStart = interceptSrc.indexOf('export function getOrCreate');
    assert.ok(fnStart > -1, 'getOrCreate not found');
    const fnBody = interceptSrc.slice(fnStart, fnStart + 600);
    // Body should: check `_instances.has(name)` and `return _instances.get(name)`
    assert.ok(
      fnBody.includes('_instances.has(name)'),
      'getOrCreate must check pool membership before constructing',
    );
    assert.ok(
      fnBody.includes('_instances.set(name'),
      'getOrCreate must store the new instance in the pool',
    );
  });

  it('getOrCreate calls the factory exactly once (first-caller-wins)', () => {
    const fnStart = interceptSrc.indexOf('export function getOrCreate');
    assert.ok(fnStart > -1, 'getOrCreate not found');
    const fnBody = interceptSrc.slice(fnStart, fnStart + 600);
    // The factory must be invoked only after the cache miss branch.
    // Structural: the body should contain a single `factory()` call.
    const factoryCalls = (fnBody.match(/factory\s*\(\s*\)/g) || []).length;
    assert.equal(
      factoryCalls,
      1,
      `getOrCreate must call factory() exactly once, found ${factoryCalls} call(s)`,
    );
  });

  it('getExisting does NOT construct — it only reads the pool', () => {
    const fnStart = interceptSrc.indexOf('export function getExisting');
    assert.ok(fnStart > -1, 'getExisting not found');
    const fnBody = interceptSrc.slice(fnStart, fnStart + 400);
    // Must not call any factory or constructor inside.
    assert.ok(
      !fnBody.includes('factory'),
      'getExisting must not call any factory',
    );
    assert.ok(
      !/new\s+\w+/.test(fnBody),
      'getExisting must not construct any new objects',
    );
    assert.ok(
      fnBody.includes('_instances.get(name)'),
      'getExisting must read from _instances.get(name)',
    );
  });

  it('resetInterceptPool clears the singleton map', () => {
    const fnStart = interceptSrc.indexOf('export function resetInterceptPool');
    assert.ok(fnStart > -1, 'resetInterceptPool not found');
    const fnBody = interceptSrc.slice(fnStart, fnStart + 200);
    assert.ok(
      fnBody.includes('_instances.clear()'),
      'resetInterceptPool must call _instances.clear()',
    );
  });
});

// ============================================================================
// Group 3: Caller contract — no direct `new ControllerRegistry()` outside bootstrap
// ============================================================================

describe('ADR-0076 controller-intercept: caller discipline', () => {
  it('controller-intercept itself does NOT construct ControllerRegistry', () => {
    // The intercept pool is generic — it must not know about ControllerRegistry.
    assert.ok(
      !/new\s+ControllerRegistry/.test(interceptSrc),
      'controller-intercept.ts must not directly construct ControllerRegistry',
    );
  });

  it('CLI router constructs ControllerRegistry exactly once (in initControllerRegistry)', () => {
    // Allowed: a single `new ControllerRegistry()` inside initControllerRegistry().
    // Forbidden: any other construction site in router.
    const matches = routerSrc.match(/new\s+ControllerRegistry\s*\(/g) || [];
    assert.ok(
      matches.length <= 1,
      `memory-router.ts must construct ControllerRegistry at most once, found ${matches.length}`,
    );
  });

  it('CLI router exposes getController() (the public consumer entry point)', () => {
    assert.ok(
      /export\s+async\s+function\s+getController\s*</.test(routerSrc) ||
      /export\s+async\s+function\s+getController\s*\(/.test(routerSrc),
      'memory-router.ts must export `getController()`',
    );
  });

  it('no production CLI .ts file outside the router directly constructs ControllerRegistry', () => {
    const allTs = collectTsFiles(CLI_SRC);
    assert.ok(allTs.length >= 20, `Expected >= 20 .ts files under CLI src, got ${allTs.length}`);

    const violations = [];
    for (const file of allTs) {
      const name = file.split('/').pop();
      // Skip the router itself (legitimate construction site) and test files.
      if (name === 'memory-router.ts') continue;
      if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) continue;
      if (name.endsWith('.d.ts')) continue;
      const src = readFileSync(file, 'utf-8');
      if (/new\s+ControllerRegistry\s*\(/.test(src)) {
        violations.push(file.replace(CLI_SRC + '/', ''));
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      'CLI files must not construct ControllerRegistry directly. Use getController() / getOrCreate(). Violators:\n' +
        violations.map(v => `  ${v}`).join('\n'),
    );
  });
});

// ============================================================================
// Group 4: Barrel re-exports — downstream can import from @claude-flow/memory
// ============================================================================

describe('ADR-0076 controller-intercept: barrel re-exports', () => {
  it('memory index.ts re-exports the intercept pool API', () => {
    // The names come from index.ts: getOrCreate, getExisting, has (as hasController),
    // listControllers, controllerCount, resetInterceptPool.
    assert.ok(indexSrc.includes('getOrCreate'),       'index.ts must re-export getOrCreate');
    assert.ok(indexSrc.includes('getExisting'),       'index.ts must re-export getExisting');
    assert.ok(indexSrc.includes('listControllers'),   'index.ts must re-export listControllers');
    assert.ok(indexSrc.includes('controllerCount'),   'index.ts must re-export controllerCount');
    assert.ok(indexSrc.includes('resetInterceptPool'), 'index.ts must re-export resetInterceptPool');
  });
});

// ============================================================================
// Group 5: Type safety — getOrCreate is generic
// ============================================================================

describe('ADR-0076 controller-intercept: type safety', () => {
  it('getOrCreate is generic over T', () => {
    assert.ok(
      /export\s+function\s+getOrCreate\s*<\s*T\s*>/.test(interceptSrc),
      'getOrCreate must be generic <T> for type-safe controller access',
    );
  });

  it('getExisting is generic over T', () => {
    assert.ok(
      /export\s+function\s+getExisting\s*<\s*T\s*>/.test(interceptSrc),
      'getExisting must be generic <T> for type-safe controller access',
    );
  });
});

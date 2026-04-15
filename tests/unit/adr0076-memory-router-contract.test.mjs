// @tier unit
// ADR-0076 Phase 5 / ADR-0083 / ADR-0085 / ADR-0086:
// Contract regression tests for memory-router.ts (THE single memory entry point).
//
// Source: @claude-flow/cli/src/memory/memory-router.ts
//
// The router is the only sanctioned path for CRUD memory ops, embedding ops,
// and controller access. Failures here mean someone:
//   - reintroduced the deleted memory-bridge or memory-initializer
//   - removed the _initFailed circuit breaker
//   - dropped the _storage null guard
//   - regressed the routeMemoryOp / routeEmbeddingOp public surface
//   - reverted the _wrap delegate removal (Phase 3)
//
// All checks are structural — readFileSync + regex/includes.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const CLI_SRC          = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const ROUTER_PATH      = `${CLI_SRC}/memory/memory-router.ts`;
const INITIALIZER_PATH = `${CLI_SRC}/memory/memory-initializer.ts`;
const BRIDGE_PATH      = `${CLI_SRC}/memory/memory-bridge.ts`;

// Hard assertions before reads.
assert.ok(existsSync(ROUTER_PATH), `memory-router.ts not found at ${ROUTER_PATH}`);

const routerSrc = readFileSync(ROUTER_PATH, 'utf-8');

// ============================================================================
// Group 1: Public exports — the routing surface
// ============================================================================

describe('ADR-0076 memory-router: public exports', () => {
  it('exports routeMemoryOp(op) — CRUD entry point', () => {
    assert.ok(
      /export\s+async\s+function\s+routeMemoryOp\s*\(/.test(routerSrc),
      'memory-router.ts must export `routeMemoryOp()`',
    );
  });

  it('exports routeEmbeddingOp(op) — vector entry point', () => {
    assert.ok(
      /export\s+async\s+function\s+routeEmbeddingOp\s*\(/.test(routerSrc),
      'memory-router.ts must export `routeEmbeddingOp()`',
    );
  });

  it('exports ensureRouter() — initialisation entry point', () => {
    assert.ok(
      /export\s+async\s+function\s+ensureRouter\s*\(/.test(routerSrc),
      'memory-router.ts must export `ensureRouter()`',
    );
  });

  it('exports resetRouter() — test-only reset', () => {
    assert.ok(
      /export\s+function\s+resetRouter\s*\(/.test(routerSrc),
      'memory-router.ts must export `resetRouter()`',
    );
  });

  it('exports shutdownRouter() — clean shutdown', () => {
    assert.ok(
      /export\s+async\s+function\s+shutdownRouter\s*\(/.test(routerSrc),
      'memory-router.ts must export `shutdownRouter()`',
    );
  });

  it('exports getController(name) — controller access', () => {
    assert.ok(
      /export\s+async\s+function\s+getController\s*</.test(routerSrc) ||
      /export\s+async\s+function\s+getController\s*\(/.test(routerSrc),
      'memory-router.ts must export `getController()`',
    );
  });

  it('exports MemoryOpType union', () => {
    assert.ok(
      /export\s+type\s+MemoryOpType\b/.test(routerSrc),
      'memory-router.ts must export `MemoryOpType`',
    );
  });

  it('exports EmbeddingOpType union', () => {
    assert.ok(
      /export\s+type\s+EmbeddingOpType\b/.test(routerSrc),
      'memory-router.ts must export `EmbeddingOpType`',
    );
  });
});

// ============================================================================
// Group 2: MemoryOpType union has all required operations
// ============================================================================

describe('ADR-0076 memory-router: MemoryOpType union', () => {
  // Required operation strings the CRUD switch must dispatch on.
  const requiredOps = [
    'store',
    'search',
    'get',
    'delete',
    'list',
    'stats',
    'count',
    'listNamespaces',
    'bulkDelete',     // ADR-0086 B2
    'clearNamespace', // ADR-0086 B2
  ];

  // Extract the union body
  const typeStart = routerSrc.indexOf('export type MemoryOpType');
  assert.ok(typeStart > -1, 'MemoryOpType not found');
  const typeBlock = routerSrc.slice(typeStart, routerSrc.indexOf(';', typeStart) + 1);

  for (const op of requiredOps) {
    it(`MemoryOpType includes '${op}'`, () => {
      assert.ok(
        typeBlock.includes(`'${op}'`),
        `MemoryOpType must include '${op}'. Block:\n${typeBlock}`,
      );
    });
  }

  it('MemoryOpType has at least 10 operation members', () => {
    const members = typeBlock.match(/'[a-zA-Z]+'/g) || [];
    assert.ok(
      members.length >= 10,
      `Expected >= 10 MemoryOpType members, got ${members.length}: [${members.join(', ')}]`,
    );
  });
});

// ============================================================================
// Group 3: _storage state — nullable + guarded
// ============================================================================

describe('ADR-0076 memory-router: _storage state', () => {
  it('_storage is declared as nullable (`| null`)', () => {
    // Match `let _storage: ... | null`
    assert.ok(
      /let\s+_storage\s*:[^=;]*\|\s*null/.test(routerSrc),
      '_storage must be declared with a nullable type (`| null`)',
    );
  });

  it('_storage initial value is null', () => {
    assert.ok(
      /let\s+_storage\s*:[^=;]*=\s*null/.test(routerSrc),
      '_storage must initialise to null',
    );
  });

  it('routeMemoryOp guards against null _storage', () => {
    const fnStart = routerSrc.indexOf('export async function routeMemoryOp');
    assert.ok(fnStart > -1, 'routeMemoryOp not found');
    const fnBlock = routerSrc.slice(fnStart, fnStart + 800);

    // The guard should look like: `if (!_storage) return { success: false, ... }`
    assert.ok(
      fnBlock.includes('!_storage'),
      'routeMemoryOp must check `!_storage` before dereferencing',
    );

    const guardIdx = fnBlock.indexOf('!_storage');
    const afterGuard = fnBlock.slice(guardIdx, guardIdx + 200);
    assert.ok(
      afterGuard.includes('success: false'),
      'null guard must return `{ success: false }` instead of throwing',
    );
  });
});

// ============================================================================
// Group 4: _initFailed circuit breaker (ADR-0086 I2)
// ============================================================================

describe('ADR-0076 memory-router: _initFailed circuit breaker', () => {
  it('_initFailed flag is declared at module scope', () => {
    assert.ok(
      /let\s+_initFailed\b/.test(routerSrc),
      '_initFailed module-level flag must exist',
    );
  });

  it('_initFailed defaults to false', () => {
    assert.ok(
      /let\s+_initFailed\s*=\s*false/.test(routerSrc),
      '_initFailed must initialise to false',
    );
  });

  it('ensureRouter() checks _initFailed and fails fast', () => {
    const fnStart = routerSrc.indexOf('export async function ensureRouter');
    assert.ok(fnStart > -1, 'ensureRouter not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 800);
    assert.ok(
      /if\s*\(\s*_initFailed\s*\)/.test(fnBody),
      'ensureRouter must check `if (_initFailed)` and throw',
    );
  });

  it('_doInit() flips _initFailed = true on storage failure', () => {
    const fnStart = routerSrc.indexOf('async function _doInit');
    assert.ok(fnStart > -1, '_doInit not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 2000);
    assert.ok(
      /_initFailed\s*=\s*true/.test(fnBody),
      '_doInit must set _initFailed = true on storage failure',
    );
  });

  it('resetRouter() clears _initFailed (allow retry after reset)', () => {
    const fnStart = routerSrc.indexOf('export function resetRouter');
    assert.ok(fnStart > -1, 'resetRouter not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 600);
    assert.ok(
      /_initFailed\s*=\s*false/.test(fnBody),
      'resetRouter must clear _initFailed = false',
    );
  });
});

// ============================================================================
// Group 5: Deletions — memory-initializer and memory-bridge are gone
// ============================================================================

describe('ADR-0076 memory-router: dead modules are deleted', () => {
  it('memory-initializer.ts file is absent (ADR-0086 Debt 6)', () => {
    assert.ok(
      !existsSync(INITIALIZER_PATH),
      'memory-initializer.ts must be deleted',
    );
  });

  it('memory-bridge.ts file is absent (ADR-0085)', () => {
    assert.ok(
      !existsSync(BRIDGE_PATH),
      'memory-bridge.ts must be deleted (ADR-0085)',
    );
  });

  it('router contains no static `import ... from "./memory-initializer"`', () => {
    const lines = routerSrc.split('\n');
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip pure comment lines
      if (/^\s*\/\//.test(line)) continue;
      const codePart = line.split('//')[0];
      if (/from\s+['"][^'"]*memory-initializer/.test(codePart)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      'router must not import memory-initializer:\n' + violations.join('\n'),
    );
  });

  it('router contains no static `import ... from "./memory-bridge"`', () => {
    const lines = routerSrc.split('\n');
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      const codePart = line.split('//')[0];
      if (/from\s+['"][^'"]*memory-bridge/.test(codePart)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    assert.deepStrictEqual(
      violations,
      [],
      'router must not import memory-bridge:\n' + violations.join('\n'),
    );
  });

  it('router contains no dynamic `await import("./memory-initializer")`', () => {
    const lines = routerSrc.split('\n');
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      const codePart = line.split('//')[0];
      if (/import\s*\(\s*['"][^'"]*memory-initializer/.test(codePart)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    assert.deepStrictEqual(violations, [], 'router must not dynamically import memory-initializer');
  });

  it('router contains no dynamic `await import("./memory-bridge")`', () => {
    const lines = routerSrc.split('\n');
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\/\//.test(line)) continue;
      const codePart = line.split('//')[0];
      if (/import\s*\(\s*['"][^'"]*memory-bridge/.test(codePart)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    assert.deepStrictEqual(violations, [], 'router must not dynamically import memory-bridge');
  });
});

// ============================================================================
// Group 6: Phase 3 lift — no _wrap delegate, no loadStorageFns
// ============================================================================

describe('ADR-0076 memory-router: Phase 3 lift (no _wrap, no loadStorageFns)', () => {
  it('router defines no _wrap() helper function', () => {
    // The Phase 3 work removed the _wrap delegate pattern entirely.
    assert.ok(
      !/function\s+_wrap\s*\(/.test(routerSrc),
      'router must not define a `_wrap()` helper (Phase 3 removed it)',
    );
  });

  it('router calls no _wrap() delegate', () => {
    const wrapCalls = (routerSrc.match(/_wrap\s*\(\s*['"]/g) || []).length;
    assert.equal(
      wrapCalls,
      0,
      `router must contain ZERO _wrap('...') delegate calls, found ${wrapCalls}`,
    );
  });

  it('router defines no loadStorageFns helper', () => {
    assert.ok(
      !/function\s+loadStorageFns\s*\(/.test(routerSrc),
      'router must not define `loadStorageFns()` (replaced by createStorage in ADR-0086 T2.2)',
    );
  });

  it('router defines a createStorage() factory (replacement for loadStorageFns)', () => {
    assert.ok(
      /async\s+function\s+createStorage\s*\(/.test(routerSrc),
      'router must define `async function createStorage()` to instantiate RvfBackend',
    );
  });

  it('createStorage instantiates RvfBackend via dynamic import', () => {
    const fnStart = routerSrc.indexOf('async function createStorage');
    assert.ok(fnStart > -1, 'createStorage not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 800);
    assert.ok(
      fnBody.includes('rvf-backend'),
      'createStorage must dynamically import @claude-flow/memory/rvf-backend',
    );
    assert.ok(
      /new\s+\w*\.RvfBackend\s*\(/.test(fnBody) || fnBody.includes('new memMod.RvfBackend('),
      'createStorage must construct RvfBackend',
    );
  });
});

// ============================================================================
// Group 7: Storage type comes from @claude-flow/memory (canonical)
// ============================================================================

describe('ADR-0076 memory-router: IStorageContract import', () => {
  it('imports IStorageContract from @claude-flow/memory/storage', () => {
    assert.ok(
      /import\s+type\s+\{\s*IStorageContract\s*\}\s+from\s+['"]@claude-flow\/memory\/storage(\.js)?['"]/.test(routerSrc),
      'router must import IStorageContract from @claude-flow/memory/storage',
    );
  });

  it('_storage is typed as `IStorageContract | null`', () => {
    assert.ok(
      /let\s+_storage\s*:\s*IStorageContract\s*\|\s*null/.test(routerSrc),
      '_storage must be typed `IStorageContract | null`',
    );
  });
});

// ============================================================================
// Group 8: ensureRouter init flow — single-flight
// ============================================================================

describe('ADR-0076 memory-router: ensureRouter init flow', () => {
  it('ensureRouter short-circuits when already initialized', () => {
    const fnStart = routerSrc.indexOf('export async function ensureRouter');
    assert.ok(fnStart > -1, 'ensureRouter not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 800);
    assert.ok(
      /if\s*\(\s*_initialized\s*\)\s*return/.test(fnBody),
      'ensureRouter must short-circuit on `_initialized`',
    );
  });

  it('ensureRouter serializes concurrent callers via _initPromise', () => {
    const fnStart = routerSrc.indexOf('export async function ensureRouter');
    assert.ok(fnStart > -1, 'ensureRouter not found');
    const fnBody = routerSrc.slice(fnStart, fnStart + 800);
    assert.ok(
      /_initPromise/.test(fnBody),
      'ensureRouter must serialize concurrent callers via _initPromise',
    );
  });
});

// @tier unit
// ADR-0170 Phase C.3 — lazy ControllerRegistry init contract tests.
//
// Background: Phase C-2 benchmark gate failed with +30% store p50 / +21%
// wall regression vs SQLite baseline. Root cause: per-CLI-invocation
// agentdb_* ControllerRegistry init firing on memory_*-axis CLI commands
// (memory store/search/list/delete) that don't need the agentdb_*
// substrate at all.
//
// Phase C.3 fix: split `ensureRouter` into RVF-only (`ensureRouter` →
// `_doInit`) and full registry (`ensureRegistry` → `_doInitRegistry`).
// memory_*-axis routes stay on `ensureRouter`; agentdb_*-axis routes
// upgrade to `ensureRegistry`.
//
// Source: @claude-flow/cli/src/memory/memory-router.ts
// These checks are structural — readFileSync + regex on source.
// Behavioral verification is in the benchmark harness
// (tests/benchmarks/adr0170-pglite-vs-sqlite.mjs) which compares per-op
// p50/p95 against the SQLite baseline at
// tests/benchmarks/baselines/adr0170-sqlite-baseline.json.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const ROUTER_PATH = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';
assert.ok(existsSync(ROUTER_PATH), `memory-router.ts not found at ${ROUTER_PATH}`);
const routerSrc = readFileSync(ROUTER_PATH, 'utf-8');

// ============================================================================
// Group 1: both init entry points exist + are exported
// ============================================================================

describe('ADR-0170 Phase C.3: split init entry points', () => {
  it('exports ensureRouter (RVF storage only)', () => {
    assert.ok(
      /export\s+async\s+function\s+ensureRouter\s*\(/.test(routerSrc),
      'memory-router.ts must export `ensureRouter()` (RVF storage)',
    );
  });

  it('exports ensureRegistry (full agentdb_* registry init)', () => {
    assert.ok(
      /export\s+async\s+function\s+ensureRegistry\s*\(/.test(routerSrc),
      'memory-router.ts must export `ensureRegistry()` (agentdb_* registry)',
    );
  });

  it('defines _doInit (storage init) and _doInitRegistry (registry init)', () => {
    assert.ok(
      /async\s+function\s+_doInit\s*\(/.test(routerSrc),
      'memory-router.ts must define _doInit() for storage-only init',
    );
    assert.ok(
      /async\s+function\s+_doInitRegistry\s*\(/.test(routerSrc),
      'memory-router.ts must define _doInitRegistry() for agentdb_* registry init',
    );
  });

  it('_doInitRegistry awaits _doInit first (storage must be up before registry)', () => {
    const fnStart = routerSrc.indexOf('async function _doInitRegistry');
    assert.ok(fnStart > -1, '_doInitRegistry must exist');
    const fnBody = routerSrc.slice(fnStart, fnStart + 2000);
    assert.ok(
      /await\s+_doInit\s*\(\s*\)/.test(fnBody),
      '_doInitRegistry must call `await _doInit()` so the RVF storage is up before agentdb registry bootstraps',
    );
  });
});

// ============================================================================
// Group 2: ensureRouter does NOT call initControllerRegistry directly
// (that's the whole point — memory_* axis should not pay agentdb_* cost)
// ============================================================================

describe('ADR-0170 Phase C.3: ensureRouter is storage-only', () => {
  it('ensureRouter body assigns _initPromise from _doInit (NOT _doInitRegistry)', () => {
    const fnStart = routerSrc.indexOf('export async function ensureRouter');
    assert.ok(fnStart > -1, 'ensureRouter must exist');
    const fnBody = routerSrc.slice(fnStart, fnStart + 600);
    // The body should contain `_doInit()` but not `_doInitRegistry()`.
    assert.ok(
      /_initPromise\s*=\s*_doInit\s*\(\s*\)/.test(fnBody),
      'ensureRouter must call _doInit() (RVF storage only)',
    );
    assert.ok(
      !/_initPromise\s*=\s*_doInitRegistry/.test(fnBody),
      'ensureRouter must NOT call _doInitRegistry() — that defeats the lazy-init optimization',
    );
  });

  it('_doInit body does NOT call initControllerRegistry', () => {
    // ADR-0170 Phase C.3 moved initControllerRegistry call out of _doInit.
    // The function should stop at `_initialized = true` after the storage
    // path. Anything calling initControllerRegistry inside this body
    // would re-introduce the eager agentdb_* init on every memory_* op.
    const fnStart = routerSrc.indexOf('async function _doInit(');
    assert.ok(fnStart > -1, '_doInit must exist');
    // The function body is bounded by the next `async function` declaration.
    const nextFn = routerSrc.indexOf('async function _doInitRegistry', fnStart);
    assert.ok(nextFn > fnStart, '_doInitRegistry must come after _doInit');
    const fnBody = routerSrc.slice(fnStart, nextFn);
    assert.ok(
      !/await\s+initControllerRegistry\s*\(/.test(fnBody),
      '_doInit must NOT call initControllerRegistry() — moved to _doInitRegistry per Phase C.3',
    );
  });
});

// ============================================================================
// Group 3: routeMemoryOp + routeEmbeddingOp stay on ensureRouter
// (they're memory_* axis — must NOT pay agentdb_* init cost)
// ============================================================================

describe('ADR-0170 Phase C.3: memory_*-axis routes use ensureRouter (storage-only)', () => {
  const memoryAxisRoutes = ['routeMemoryOp', 'routeEmbeddingOp'];

  for (const fnName of memoryAxisRoutes) {
    it(`${fnName} calls ensureRouter (not ensureRegistry)`, () => {
      const fnStart = routerSrc.indexOf(`export async function ${fnName}`);
      assert.ok(fnStart > -1, `${fnName} must exist`);
      // The await is on the very first line of each route. 200-char window.
      const fnBody = routerSrc.slice(fnStart, fnStart + 200);
      assert.ok(
        /await\s+ensureRouter\s*\(\s*\)/.test(fnBody),
        `${fnName} must call ensureRouter() — memory_* axis is RVF-only and must not pay agentdb_* registry init cost`,
      );
    });
  }
});

// ============================================================================
// Group 4: agentdb_*-axis routes use ensureRegistry (full init)
// ============================================================================

describe('ADR-0170 Phase C.3: agentdb_*-axis routes use ensureRegistry', () => {
  // These routes all call getController() — they touch agentdb_*
  // controllers and need the registry init.
  const registryAxisRoutes = [
    'routePatternOp',     // reasoningBank
    'routeFeedbackOp',    // learningSystem + reasoningBank
    'routeSessionOp',     // reflexion + nightlyLearner
    'routeLearningOp',    // selfLearningRvfBackend + memoryConsolidation
    'routeReflexionOp',   // reflexion
    'routeCausalOp',      // causalGraph + causalRecall
  ];

  for (const fnName of registryAxisRoutes) {
    it(`${fnName} calls ensureRegistry (not ensureRouter)`, () => {
      const fnStart = routerSrc.indexOf(`export async function ${fnName}`);
      assert.ok(fnStart > -1, `${fnName} must exist`);
      const fnBody = routerSrc.slice(fnStart, fnStart + 400);
      assert.ok(
        /await\s+ensureRegistry\s*\(\s*\)/.test(fnBody),
        `${fnName} must call ensureRegistry() — touches agentdb_* controllers via getController()`,
      );
    });
  }

  it('getController calls ensureRegistry (canonical agentdb_* entry point)', () => {
    const fnStart = routerSrc.indexOf('export async function getController');
    assert.ok(fnStart > -1, 'getController must exist');
    const fnBody = routerSrc.slice(fnStart, fnStart + 1200);
    assert.ok(
      /await\s+ensureRegistry\s*\(\s*\)/.test(fnBody),
      'getController must call ensureRegistry() — it is the canonical agentdb_* entry point',
    );
  });
});

// ============================================================================
// Group 5: no silent fallback when registry init fails
// (per feedback-no-fallbacks: lazy != silent)
// ============================================================================

describe('ADR-0170 Phase C.3: registry init failure is loud (no silent fallback)', () => {
  it('_doInitRegistry catch block re-throws with ADR-0165 marker', () => {
    const fnStart = routerSrc.indexOf('async function _doInitRegistry');
    assert.ok(fnStart > -1);
    const fnBody = routerSrc.slice(fnStart, fnStart + 3000);
    // The catch block must contain a `throw new Error(...)` carrying the
    // ADR-0165 marker. Silent continue would mask data-loss regressions
    // per feedback-no-fallbacks.
    assert.ok(
      /catch\s*\(\s*e\s*\)/.test(fnBody),
      '_doInitRegistry must wrap initControllerRegistry in catch(e)',
    );
    assert.ok(
      /throw\s+new\s+Error\([^)]*ADR-0165[^)]*\)/s.test(fnBody),
      '_doInitRegistry catch must throw with ADR-0165 marker (no silent fallback)',
    );
  });

  it('ensureRegistry fast-fails on _registryInitFailed', () => {
    const fnStart = routerSrc.indexOf('export async function ensureRegistry');
    assert.ok(fnStart > -1, 'ensureRegistry must exist');
    const fnBody = routerSrc.slice(fnStart, fnStart + 600);
    assert.ok(
      /_registryInitFailed/.test(fnBody),
      'ensureRegistry must check _registryInitFailed to prevent retry storm',
    );
    assert.ok(
      /throw\s+new\s+Error\(/.test(fnBody),
      'ensureRegistry must throw (not return) when init has permanently failed',
    );
  });

  it('resetRouter clears _registryInitialized + _registryInitFailed + _registryInitPromise', () => {
    const fnStart = routerSrc.indexOf('export function resetRouter');
    assert.ok(fnStart > -1);
    const fnBody = routerSrc.slice(fnStart, fnStart + 1000);
    assert.ok(
      /_registryInitialized\s*=\s*false/.test(fnBody),
      'resetRouter must clear _registryInitialized = false',
    );
    assert.ok(
      /_registryInitFailed\s*=\s*false/.test(fnBody),
      'resetRouter must clear _registryInitFailed = false',
    );
    assert.ok(
      /_registryInitPromise\s*=\s*null/.test(fnBody),
      'resetRouter must clear _registryInitPromise = null',
    );
  });
});

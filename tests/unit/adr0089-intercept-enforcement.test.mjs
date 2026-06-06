// @tier unit
// ADR-0089: Controller Intercept Pattern Permanent — regression enforcement.
//
// ADR-0089 formally supersedes ADR-0075 Layer 2's "delete AgentDBService"
// goal with "delegate every controller instantiation through the shared
// controller-intercept.ts pool". The correctness of that substitution
// depends on AgentDBService AND ControllerRegistry both wrapping their
// `new FooController(...)` calls in `getOrCreate('name', () => new Foo...)`.
//
// If a future upstream merge refactors AgentDBService's constructor
// patterns and silently removes the getOrCreate wrapping, the intercept
// pool is bypassed and cache divergence returns with NO test failure.
//
// This file greps the upstream source and enforces the known set of
// wrapped controllers is intact. When the set changes intentionally
// (new controllers added, old ones renamed), update EXPECTED_WRAPS and
// CONTROLLER_REGISTRY_MIN_WRAPS to match — the test becomes the living
// contract for what "intercept-unified" means.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const AGENTDB_SERVICE_PATH =
  '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts';
const CONTROLLER_REGISTRY_PATH =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts';
const CONTROLLER_INTERCEPT_PATH =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-intercept.ts';

function read(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// Minimum number of getOrCreate call sites expected in ControllerRegistry.
// Today's count is 46 (verified 2026-04-15). Allowing some slack for
// intentional reorganization, but a sudden drop below this threshold means
// the intercept pattern is being dismantled.
const CONTROLLER_REGISTRY_MIN_WRAPS = 40;

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0089 T1: controller-intercept module exists and exports getOrCreate', () => {
  const source = read(CONTROLLER_INTERCEPT_PATH);

  it('controller-intercept.ts exists', () => {
    assert.ok(source, `${CONTROLLER_INTERCEPT_PATH} must exist — intercept pattern depends on it`);
  });

  it('exports getOrCreate function', () => {
    assert.ok(
      /export (function|const) getOrCreate/.test(source) ||
        /export \{[^}]*getOrCreate/.test(source),
      'controller-intercept.ts must export a getOrCreate function',
    );
  });

  it('getOrCreate implementation uses a module-level cache', () => {
    // The pool MUST be module-level. A function-local cache would reset on
    // every call, which silently defeats the pattern.
    assert.ok(
      /(Map|Record)\s*<\s*string/.test(source) || /new Map\(\)/.test(source),
      'getOrCreate must use a module-level Map or equivalent for cross-call persistence',
    );
  });
});

describe('ADR-0089 T2 (retargeted): AgentDBService retired — cli memory side is the sole entrypoint (ADR-0288)', () => {
  // ADR-0288 Option C-prime (fork agentic-flow 8c5ec5d7, 2026-06-04) deleted
  // the AgentDBService island; the second intercept entrypoint no longer
  // exists. T1/T3 keep guarding the surviving cli memory side; this guard
  // locks the retirement so a silent re-introduction (which would re-split
  // the singleton pool) is caught.
  it('agentdb-service.ts stays deleted (ADR-0288)', () => {
    assert.ok(
      !existsSync(AGENTDB_SERVICE_PATH),
      `${AGENTDB_SERVICE_PATH} must stay deleted per ADR-0288. If AgentDBService is ` +
        `deliberately re-introduced, restore the T2 wrap assertions this guard ` +
        `replaced (git log this file) — an unwrapped second entrypoint re-splits ` +
        `the controller pool.`,
    );
  });
});

describe('ADR-0089 T3: ControllerRegistry wraps factory switch via getOrCreate', () => {
  const source = read(CONTROLLER_REGISTRY_PATH);

  it('controller-registry.ts exists', () => {
    assert.ok(source, `${CONTROLLER_REGISTRY_PATH} must exist`);
  });

  it('imports getOrCreate from controller-intercept', () => {
    assert.ok(
      /import\s*\{\s*getOrCreate\s*\}\s*from\s*['"]\.\/controller-intercept/.test(source),
      'ControllerRegistry must import getOrCreate from ./controller-intercept',
    );
  });

  it(`has at least ${CONTROLLER_REGISTRY_MIN_WRAPS} getOrCreate call sites`, () => {
    const matches = source.match(/getOrCreate\(/g) || [];
    assert.ok(
      matches.length >= CONTROLLER_REGISTRY_MIN_WRAPS,
      `Expected >= ${CONTROLLER_REGISTRY_MIN_WRAPS} getOrCreate calls in controller-registry.ts, ` +
        `found ${matches.length}. The intercept pattern is being dismantled.`,
    );
  });
});

describe('ADR-0089 T4 (retargeted): the sole entrypoint imports from the intercept module', () => {
  const reg = read(CONTROLLER_REGISTRY_PATH);

  it('ControllerRegistry imports from the sibling intercept module', () => {
    assert.ok(reg, 'controller-registry.ts must exist');

    // Pre-ADR-0288 this test asserted BOTH entrypoints (ControllerRegistry +
    // AgentDBService) resolved to the same intercept module. With the island
    // retired (8c5ec5d7), ControllerRegistry is the sole entrypoint — if a
    // local copy of getOrCreate gets introduced, the pool splits and the
    // pattern breaks silently.
    assert.ok(
      reg.includes("from './controller-intercept"),
      'ControllerRegistry must import from ./controller-intercept (sibling)',
    );
  });
});

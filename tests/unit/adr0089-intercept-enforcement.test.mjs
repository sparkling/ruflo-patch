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

// ============================================================================
// Known intercept-wrapped controllers in AgentDBService (ADR-0076 Phase 4)
// ============================================================================
//
// These 6 controllers are the ones ADR-0076 Phase 4 explicitly wrapped to
// prevent cache divergence with ControllerRegistry. Adding more is welcome
// and expected — when that happens, append here so the regression guard
// stays tight.

const EXPECTED_AGENTDB_SERVICE_WRAPS = [
  'reflexion',
  'skills',
  'reasoningBank',
  'causalGraph',
  'causalRecall',
  'learningSystem',
];

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

describe('ADR-0089 T2: AgentDBService wraps controller instantiations', () => {
  const source = read(AGENTDB_SERVICE_PATH);

  it('agentdb-service.ts exists in upstream fork', () => {
    assert.ok(source, `${AGENTDB_SERVICE_PATH} must exist`);
  });

  it('imports getOrCreate from @claude-flow/memory', () => {
    // The import style is dynamic (`await import('@claude-flow/memory')`)
    // because it runs inside an async initialize() and @claude-flow/memory
    // may not be available in all environments.
    assert.ok(
      source.includes("await import(/* webpackIgnore: true */ '@claude-flow/memory')") ||
        source.includes("from '@claude-flow/memory'"),
      'AgentDBService must import @claude-flow/memory to get getOrCreate',
    );
    assert.ok(
      source.includes('intercept.getOrCreate'),
      'AgentDBService must read getOrCreate from the intercept module',
    );
  });

  // For each known-wrapped controller, assert that the file contains the
  // exact `getOrCreate('<name>', () => ...)` pattern. This is the tightest
  // regression guard — it catches renames, removals, and refactors that
  // defeat the wrap.
  for (const name of EXPECTED_AGENTDB_SERVICE_WRAPS) {
    it(`wraps controller '${name}' in getOrCreate`, () => {
      const pattern = new RegExp(`getOrCreate\\(['"\`]${name}['"\`]`);
      assert.ok(
        pattern.test(source),
        `AgentDBService must call getOrCreate('${name}', ...) — found none. ` +
          `Either a refactor removed the wrap (regression) or this controller ` +
          `was renamed (update EXPECTED_AGENTDB_SERVICE_WRAPS in this test).`,
      );
    });
  }

  it('has at least 6 getOrCreate call sites (current baseline)', () => {
    const matches = source.match(/getOrCreate\(/g) || [];
    assert.ok(
      matches.length >= EXPECTED_AGENTDB_SERVICE_WRAPS.length,
      `Expected >= ${EXPECTED_AGENTDB_SERVICE_WRAPS.length} getOrCreate calls in agentdb-service.ts, ` +
        `found ${matches.length}. The intercept pattern is being dismantled.`,
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

describe('ADR-0089 T4: both entrypoints import from the SAME intercept module', () => {
  const svc = read(AGENTDB_SERVICE_PATH);
  const reg = read(CONTROLLER_REGISTRY_PATH);

  it('AgentDBService and ControllerRegistry import from the same source', () => {
    assert.ok(svc, 'agentdb-service.ts must exist');
    assert.ok(reg, 'controller-registry.ts must exist');

    // ControllerRegistry imports from './controller-intercept.js' (sibling file
    // in the same package). AgentDBService imports from '@claude-flow/memory'
    // which re-exports the same symbol. Both paths resolve to the same
    // module at runtime — if one diverges (e.g., a local copy of getOrCreate
    // gets introduced), the pool splits and the pattern breaks silently.
    assert.ok(
      reg.includes("from './controller-intercept"),
      'ControllerRegistry must import from ./controller-intercept (sibling)',
    );
    assert.ok(
      svc.includes("'@claude-flow/memory'") || svc.includes('"@claude-flow/memory"'),
      'AgentDBService must import from @claude-flow/memory (which re-exports controller-intercept)',
    );
  });
});

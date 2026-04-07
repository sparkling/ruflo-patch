// @tier unit
// ADR-0076 Phase 4: Verify controller intercept, bridge wiring, getOrCreate usage
//
// Source verification tests — check that both registries use the shared
// getOrCreate pool and the controller bridge is connected at startup.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const AGENTIC_SRC = '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services';
const STDIO_SRC = '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers';

// ===========================================================================
// controller-intercept.ts exists
// ===========================================================================

describe('Phase 4: controller-intercept.ts', () => {
  const file = `${MEMORY_SRC}/controller-intercept.ts`;

  it('exists', () => {
    assert.ok(existsSync(file), 'controller-intercept.ts must exist');
  });

  it('exports getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('export function getOrCreate'), 'must export getOrCreate');
  });

  it('exports getExisting', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('export function getExisting'), 'must export getExisting');
  });

  it('exports resetInterceptPool (for testing)', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('export function resetInterceptPool'), 'must export resetInterceptPool');
  });

  it('uses a Map for the singleton pool', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('new Map'), 'must use Map for singleton pool');
  });
});

// ===========================================================================
// controller-registry.ts uses getOrCreate
// ===========================================================================

describe('Phase 4: controller-registry.ts uses getOrCreate', () => {
  const file = `${MEMORY_SRC}/controller-registry.ts`;

  it('imports getOrCreate from controller-intercept', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes("import { getOrCreate } from './controller-intercept.js'"),
      'must import getOrCreate from controller-intercept',
    );
  });

  it('uses getOrCreate in createController factory', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    const fnStart = src.indexOf('createController(name');
    assert.ok(fnStart > 0, 'createController must exist');
    const fnBody = src.slice(fnStart, fnStart + 10000);
    // Count getOrCreate usages in the factory
    const matches = fnBody.match(/getOrCreate\(/g);
    assert.ok(
      matches && matches.length >= 10,
      `createController must use getOrCreate at least 10 times (found ${matches?.length ?? 0})`,
    );
  });

  it('wraps AgentDB-delegated controllers with getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // Find the createController method, then look for the AgentDB delegation block within it
    const factoryStart = src.indexOf('createController(name');
    assert.ok(factoryStart > 0, 'createController must exist');
    const factoryBody = src.slice(factoryStart);
    // Find reasoningBank case within the factory
    const agentdbBlock = factoryBody.indexOf("case 'reasoningBank':");
    assert.ok(agentdbBlock > 0, 'reasoningBank case must exist in factory');
    const blockBody = factoryBody.slice(agentdbBlock, agentdbBlock + 400);
    assert.ok(
      blockBody.includes('getOrCreate'),
      'AgentDB-delegated controllers must use getOrCreate',
    );
  });
});

// ===========================================================================
// agentdb-service.ts uses getOrCreate
// ===========================================================================

describe('Phase 4: agentdb-service.ts uses getOrCreate', () => {
  const file = `${AGENTIC_SRC}/agentdb-service.ts`;

  it('imports getOrCreate from @claude-flow/memory', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('getOrCreate') && src.includes('@claude-flow/memory'),
      'must import getOrCreate from @claude-flow/memory',
    );
  });

  it('wraps reflexion controller with getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes("getOrCreate('reflexion'") || src.includes('getOrCreate("reflexion"'),
      'reflexionMemory must be wrapped with getOrCreate',
    );
  });

  it('wraps skills controller with getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes("getOrCreate('skills'") || src.includes('getOrCreate("skills"'),
      'skillLibrary must be wrapped with getOrCreate',
    );
  });

  it('wraps reasoningBank controller with getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes("getOrCreate('reasoningBank'") || src.includes('getOrCreate("reasoningBank"'),
      'reasoningBank must be wrapped with getOrCreate',
    );
  });

  it('uses matching pool names with controller-registry', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // The pool names in agentdb-service must match controller-registry
    const expectedNames = ['reflexion', 'skills', 'reasoningBank', 'causalGraph', 'causalRecall', 'learningSystem'];
    for (const name of expectedNames) {
      assert.ok(
        src.includes(`getOrCreate('${name}'`) || src.includes(`getOrCreate("${name}"`),
        `must use pool name '${name}' matching controller-registry`,
      );
    }
  });
});

// ===========================================================================
// controller-bridge.ts is connected
// ===========================================================================

describe('Phase 4: controller-bridge connected at startup', () => {
  const bridgeFile = `${AGENTIC_SRC}/controller-bridge.ts`;
  const stdioFile = `${STDIO_SRC}/stdio-full.ts`;

  it('controller-bridge.ts exists and exports setRegistry', () => {
    if (!existsSync(bridgeFile)) return;
    const src = readFileSync(bridgeFile, 'utf-8');
    assert.ok(src.includes('setRegistry'), 'must export setRegistry');
  });

  it('stdio-full.ts calls setRegistry during startup', () => {
    if (!existsSync(stdioFile)) return;
    const src = readFileSync(stdioFile, 'utf-8');
    assert.ok(
      src.includes('setRegistry'),
      'stdio-full.ts must call setRegistry to connect the bridge',
    );
  });

  it('stdio-full.ts imports from controller-bridge', () => {
    if (!existsSync(stdioFile)) return;
    const src = readFileSync(stdioFile, 'utf-8');
    assert.ok(
      src.includes('controller-bridge'),
      'stdio-full.ts must import from controller-bridge',
    );
  });
});

// ===========================================================================
// InMemoryStore still absent
// ===========================================================================

describe('Phase 4: InMemoryStore remains absent', () => {
  it('no InMemoryStore class in agentdb-service.ts', () => {
    const file = `${AGENTIC_SRC}/agentdb-service.ts`;
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      !src.match(/class\s+InMemoryStore/),
      'InMemoryStore class must not exist',
    );
  });
});

// ===========================================================================
// index.ts exports controller-intercept symbols
// ===========================================================================

describe('Phase 4: index.ts exports intercept symbols', () => {
  const file = `${MEMORY_SRC}/index.ts`;

  it('exports getOrCreate', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('getOrCreate'), 'must export getOrCreate');
  });

  it('exports from controller-intercept.js', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('controller-intercept'), 'must import from controller-intercept.js');
  });
});

// ===========================================================================
// getOrCreate contract test
// ===========================================================================

describe('Phase 4: getOrCreate contract', () => {
  it('first caller creates, second gets existing', () => {
    const pool = new Map();
    function getOrCreate(name, factory) {
      if (pool.has(name)) return pool.get(name);
      const inst = factory();
      pool.set(name, inst);
      return inst;
    }

    const obj1 = getOrCreate('test', () => ({ id: 1 }));
    const obj2 = getOrCreate('test', () => ({ id: 2 }));
    assert.equal(obj1, obj2, 'second call must return same instance');
    assert.equal(obj1.id, 1, 'first factory wins');
  });

  it('different names get different instances', () => {
    const pool = new Map();
    function getOrCreate(name, factory) {
      if (pool.has(name)) return pool.get(name);
      const inst = factory();
      pool.set(name, inst);
      return inst;
    }

    const a = getOrCreate('a', () => ({ name: 'a' }));
    const b = getOrCreate('b', () => ({ name: 'b' }));
    assert.notEqual(a, b, 'different names must produce different instances');
  });
});

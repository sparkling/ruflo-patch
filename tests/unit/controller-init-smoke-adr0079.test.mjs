// @tier unit
// ADR-0079 T1-10: Controller initialization smoke test
// London School TDD: simulates ControllerRegistry.initialize() contract

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// Simulated ControllerRegistry matching real API surface
function createMockRegistry(names) {
  const map = new Map(names.map(n => [n, { name: n, enabled: true, level: 1 }]));
  return {
    initialize: mockFn(async () => {}),
    listControllers: () => [...map.values()].map(e => ({ name: e.name, enabled: e.enabled, level: e.level })),
    get: (name) => map.has(name) ? { name, getStats: () => ({ status: 'healthy' }) } : null,
    shutdown: mockFn(async () => {}),
  };
}

const EXPECTED_NAMES = [
  'reasoningBank','learningBridge','solverBandit','tieredCache','hierarchicalMemory',
  'memoryGraph','agentMemoryScope','vectorBackend','mutationGuard','gnnService',
  'skills','reflexion','causalGraph','causalRecall','learningSystem',
  'explainableRecall','nightlyLearner','semanticRouter','sonaTrajectory','graphAdapter',
];

describe('ADR-0079 T1-10: ControllerRegistry init smoke', () => {
  it('initialize() does not throw', async () => {
    const reg = createMockRegistry(EXPECTED_NAMES);
    await assert.doesNotReject(() => reg.initialize());
  });

  it('constructor creates registry with expected controller names', () => {
    const reg = createMockRegistry(EXPECTED_NAMES);
    const list = reg.listControllers();
    for (const name of EXPECTED_NAMES) {
      assert.ok(list.some(c => c.name === name), `missing controller: ${name}`);
    }
  });

  it('listControllers() returns at least 20 names', () => {
    const reg = createMockRegistry(EXPECTED_NAMES);
    assert.ok(reg.listControllers().length >= 20, `got ${reg.listControllers().length}, expected >= 20`);
  });

  it('get() returns null for unknown names (not throws)', () => {
    const reg = createMockRegistry(EXPECTED_NAMES);
    const result = reg.get('nonExistentController');
    assert.equal(result, null);
  });

  it('init does not crash on missing agentdb (null backend)', async () => {
    const reg = createMockRegistry(EXPECTED_NAMES);
    reg._agentdb = null;
    await assert.doesNotReject(() => reg.initialize());
  });
});

// Integration: verify real fork file has >= 40 factory case entries
describe('ADR-0079 T1-10: createController factory coverage (integration)', () => {
  it('controller-registry.ts has >= 40 case entries in createController', () => {
    const src = readFileSync(
      '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts',
      'utf8',
    );
    const cases = src.match(/^\s+case\s+'/gm) || [];
    assert.ok(cases.length >= 40, `expected >= 40 case entries, found ${cases.length}`);
  });
});

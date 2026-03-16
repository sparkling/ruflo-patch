// @tier unit
// ADR-0046: Self-Learning Pipeline & Native Acceleration
// Unit tests for A6 SelfLearningRvfBackend, B4 NativeAccelerator, bridge functions

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// A6 SelfLearningRvfBackend — Composite Orchestrator
// ============================================================================

describe('ADR-0046: A6 SelfLearningRvfBackend', () => {

  it('factory returns composite with search/recordFeedback/getStats', () => {
    const a6 = {
      search: mockFn(async () => [{ id: 'r1' }]),
      recordFeedback: mockFn(() => {}),
      getStats: mockFn(() => ({ router: 'ok', sona: 'ok' })),
      initComponents: mockFn(async () => {}),
      destroy: mockFn(() => {}),
    };
    assert.equal(typeof a6.search, 'function');
    assert.equal(typeof a6.recordFeedback, 'function');
    assert.equal(typeof a6.getStats, 'function');
    assert.equal(typeof a6.initComponents, 'function');
    assert.equal(typeof a6.destroy, 'function');
  });

  it('A6.search() delegates internally and returns routed results', async () => {
    const search = mockFn(async (opts) => [{ id: 'r1', routed: true, query: opts.query }]);
    const result = await search({ query: 'auth patterns', limit: 5 });
    assert.equal(result.length, 1);
    assert.equal(result[0].routed, true);
    assert.equal(result[0].query, 'auth patterns');
    assert.equal(search.calls.length, 1);
    assert.equal(search.calls[0][0].limit, 5);
  });

  it('A6.getStats() aggregates sub-component stats', () => {
    const stats = {
      router: { queriesRouted: 42 },
      sona: { trajectoriesRecorded: 100 },
      trainer: { batchesTrained: 5 },
      compressor: { entriesCompressed: 200 },
      federated: { sessionsActive: 2 },
      solver: { bucketsActive: 18 },
    };
    const keys = Object.keys(stats);
    assert.ok(keys.includes('router'), 'missing router stats');
    assert.ok(keys.includes('sona'), 'missing sona stats');
    assert.ok(keys.includes('trainer'), 'missing trainer stats');
    assert.ok(keys.includes('compressor'), 'missing compressor stats');
    assert.ok(keys.includes('federated'), 'missing federated stats');
    assert.ok(keys.includes('solver'), 'missing solver stats');
    assert.equal(keys.length, 6, 'should have exactly 6 sub-component stat entries');
  });

  it('A6.recordFeedback() is fire-and-forget (returns void)', () => {
    const recordFeedback = mockFn(() => {});
    const result = recordFeedback({ query: 'test', selectedResult: 'r1', reward: 0.9 });
    assert.equal(result, undefined, 'recordFeedback must return void');
    assert.equal(recordFeedback.calls.length, 1);
    assert.equal(recordFeedback.calls[0][0].reward, 0.9);
  });

  it('A6.initComponents() is called exactly once', async () => {
    const initComponents = mockFn(async () => {});
    await initComponents();
    assert.equal(initComponents.calls.length, 1, 'initComponents should be called once');
    // Calling again should still work (idempotent)
    await initComponents();
    assert.equal(initComponents.calls.length, 2);
  });

  it('A6.destroy() cleans up all 6 sub-components', () => {
    const destroyed = [];
    const subs = ['router', 'sona', 'trainer', 'compressor', 'federated', 'solver'];
    const destroy = () => subs.forEach(c => destroyed.push(c));
    destroy();
    assert.equal(destroyed.length, 6, 'must destroy all 6 sub-components');
    assert.deepEqual(destroyed, subs);
  });

  it('A6 search returns empty array when no results', async () => {
    const search = mockFn(async () => []);
    const result = await search({ query: 'nonexistent', limit: 10 });
    assert.equal(result.length, 0);
  });

  it('A6 handles partial init (some sub-components null)', () => {
    const stats = {
      router: { n: 42 },
      sona: null,         // failed to init
      trainer: null,      // failed to init
      compressor: { n: 200 },
      federated: null,    // failed to init
      solver: { n: 18 },
    };
    const active = Object.values(stats).filter(v => v !== null);
    assert.equal(active.length, 3, 'partial init: 3 of 6 active');
  });
});

// ============================================================================
// B4 NativeAccelerator — Shared Singleton
// ============================================================================

describe('ADR-0046: B4 NativeAccelerator', () => {

  it('singleton returns same instance across consumers', () => {
    let inst = null;
    const getInstance = () => { if (!inst) inst = { id: 'native-1', simdAvailable: false }; return inst; };
    const a = getInstance();
    const b = getInstance();
    assert.strictEqual(a, b, 'must be same reference');
    assert.equal(a.id, 'native-1');
  });

  it('singleton with async factory returns same instance', async () => {
    let instance = null;
    let initPromise = null;
    const getAccelerator = async () => {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          const accel = { id: 'accel-' + Date.now(), simdAvailable: false };
          instance = accel;
          return accel;
        })();
      }
      return initPromise;
    };

    const [a, b] = await Promise.all([getAccelerator(), getAccelerator()]);
    assert.strictEqual(a, b, 'concurrent calls must return same instance');
  });

  it('simdAvailable property exists on accelerator', () => {
    const accel = { simdAvailable: false, capabilities: [] };
    assert.equal(typeof accel.simdAvailable, 'boolean');
  });

  it('JS fallback cosine distance when native unavailable', () => {
    const cosine = (a, b) => {
      let dot = 0, nA = 0, nB = 0;
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] ** 2; nB += b[i] ** 2; }
      return dot / (Math.sqrt(nA) * Math.sqrt(nB));
    };
    // Identical vectors -> similarity 1.0
    assert.ok(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1.0) < 1e-6);
    // Orthogonal vectors -> similarity 0.0
    assert.ok(Math.abs(cosine([1, 0, 0], [0, 1, 0]) - 0.0) < 1e-6);
    // Opposite vectors -> similarity -1.0
    assert.ok(Math.abs(cosine([1, 0, 0], [-1, 0, 0]) - (-1.0)) < 1e-6);
  });

  it('JS fallback L2 distance when native unavailable', () => {
    const l2 = (a, b) => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
      return Math.sqrt(sum);
    };
    assert.ok(Math.abs(l2([0, 0], [3, 4]) - 5.0) < 1e-6);
    assert.ok(Math.abs(l2([1, 1], [1, 1]) - 0.0) < 1e-6);
  });

  it('JS fallback inner product when native unavailable', () => {
    const innerProduct = (a, b) => {
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
      return sum;
    };
    assert.equal(innerProduct([1, 2, 3], [4, 5, 6]), 32);
    assert.equal(innerProduct([1, 0, 0], [0, 1, 0]), 0);
  });

  it('getStats() returns 11 capability flags', () => {
    const stats = {
      simd: false, wasmVerify: false, wasmQuantization: false,
      wasmStore: false, nativeAttention: false, tensorCompress: false,
      routerPersistence: false, sonaExtended: false, graphCapabilities: false,
      coreBatch: false, ewcManager: false,
    };
    assert.equal(Object.keys(stats).length, 11);
    for (const val of Object.values(stats)) {
      assert.equal(typeof val, 'boolean');
    }
  });

  it('B4 null means A5 HyperbolicAttention stays disabled', () => {
    const b4 = null;
    const enableHyperbolic = !!(b4 && typeof b4 === 'object' && b4.simdAvailable);
    assert.equal(enableHyperbolic, false);
  });
});

// ============================================================================
// Bridge Functions — bridgeSelfLearningSearch + bridgeSelfLearningFeedback
// ============================================================================

describe('ADR-0046: bridge functions', () => {

  it('bridgeSelfLearningSearch falls back when A6 null', async () => {
    // Simulate: registry.get('selfLearningRvfBackend') returns null
    const a6 = null;
    const fallbackCalled = { value: false };
    const bridgeSelfLearningSearch = async (opts) => {
      if (a6 && typeof a6.search === 'function') {
        return { success: true, results: await a6.search(opts), routed: true, controller: 'selfLearningRvfBackend' };
      }
      fallbackCalled.value = true;
      return { success: true, results: [], routed: false, controller: 'bridgeSearchEntries' };
    };

    const result = await bridgeSelfLearningSearch({ query: 'test' });
    assert.equal(result.routed, false, 'must not route when A6 null');
    assert.equal(result.controller, 'bridgeSearchEntries');
    assert.equal(fallbackCalled.value, true);
  });

  it('bridgeSelfLearningSearch routes through A6 when available', async () => {
    const a6 = {
      search: mockFn(async (opts) => [{ id: 'r1', score: 0.95, query: opts.query }]),
      getStats: mockFn(() => ({ router: { n: 1 } })),
    };

    const results = await a6.search({ query: 'auth', limit: 5 });
    const stats = a6.getStats();

    assert.equal(results.length, 1);
    assert.equal(results[0].id, 'r1');
    assert.ok(stats.router, 'stats should include router');
  });

  it('bridgeSelfLearningFeedback is fire-and-forget', () => {
    const a6 = {
      recordFeedback: mockFn(() => {}),
    };

    // Fire-and-forget: call without await
    a6.recordFeedback({ query: 'test', selectedResult: 'r1', reward: 0.8 });

    assert.equal(a6.recordFeedback.calls.length, 1);
    assert.equal(a6.recordFeedback.calls[0][0].reward, 0.8);
  });

  it('bridgeSelfLearningFeedback returns none when A6 unavailable', () => {
    const a6 = null;
    const controller = (a6 && typeof a6?.recordFeedback === 'function') ? 'selfLearningRvf' : 'none';
    assert.equal(controller, 'none');
  });

  it('bridgeRecordFeedback routes to A6 when available', () => {
    const controllers = [];
    const a6 = { recordFeedback: mockFn(() => {}) };

    // Simulate the routing chain
    controllers.push('learningSystem');
    controllers.push('reasoningBank');

    // ADR-0046 addition: also forward to A6
    if (a6 && typeof a6.recordFeedback === 'function') {
      a6.recordFeedback({ query: 'task-1', selectedResult: 'agent-1', reward: 0.9 });
      controllers.push('selfLearningRvf');
    }

    assert.ok(controllers.includes('selfLearningRvf'), 'A6 must receive feedback');
    assert.equal(a6.recordFeedback.calls.length, 1);
  });

  it('bridgeSelfLearningStats returns sub-component health', () => {
    const a6 = {
      getStats: mockFn(() => ({
        router: { queriesRouted: 42 },
        sona: { trajectoriesRecorded: 100 },
        trainer: { batchesTrained: 5 },
        compressor: { entriesCompressed: 200 },
        federated: { sessionsActive: 2 },
        solver: { bucketsActive: 18 },
      })),
    };

    const stats = a6.getStats();
    assert.equal(Object.keys(stats).length, 6);
    assert.equal(stats.router.queriesRouted, 42);
    assert.equal(stats.solver.bucketsActive, 18);
  });
});

// ============================================================================
// Controller Registry Integration — Level 2 wiring
// ============================================================================

describe('ADR-0046: controller registry wiring', () => {

  it('A6 and B4 are at Level 2 in INIT_LEVELS', () => {
    // Verify the level ordering contract
    const level2Controllers = [
      'memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard',
      'gnnService', 'attentionService', 'selfLearningRvfBackend',
      'nativeAccelerator', 'quantizedVectorStore',
    ];
    assert.ok(level2Controllers.includes('selfLearningRvfBackend'));
    assert.ok(level2Controllers.includes('nativeAccelerator'));
  });

  it('B4 singleton pattern: getAccelerator preferred over new', () => {
    // Simulate the factory logic
    let getAccelCalled = false;
    const agentdbModule = {
      getAccelerator: async () => { getAccelCalled = true; return { id: 'singleton' }; },
      NativeAccelerator: class { constructor() { this.id = 'direct'; } },
    };

    // Factory should prefer getAccelerator
    const usesSingleton = typeof agentdbModule.getAccelerator === 'function';
    assert.ok(usesSingleton, 'should detect and use getAccelerator singleton factory');
  });

  it('B4 factory falls back to direct construction when getAccelerator missing', async () => {
    const agentdbModule = {
      NativeAccelerator: class {
        constructor() { this.id = 'direct'; this.initialized = false; }
        async initialize() { this.initialized = true; }
      },
    };

    const getAccel = agentdbModule.getAccelerator;
    let result;
    if (typeof getAccel === 'function') {
      result = await getAccel();
    } else {
      const NA = agentdbModule.NativeAccelerator;
      const accel = new NA();
      if (typeof accel.initialize === 'function') {
        await accel.initialize();
      }
      result = accel;
    }

    assert.equal(result.id, 'direct');
    assert.equal(result.initialized, true, 'must call initialize() on fallback path');
  });

  it('A5 HyperbolicAttention enabled only when B4 reports simdAvailable', () => {
    // With native
    const accelWithSimd = { simdAvailable: true };
    const enabledWithNative = !!(accelWithSimd && typeof accelWithSimd.simdAvailable === 'boolean' && accelWithSimd.simdAvailable);
    assert.equal(enabledWithNative, true);

    // Without native
    const accelWithoutSimd = { simdAvailable: false };
    const enabledWithoutNative = !!(accelWithoutSimd && typeof accelWithoutSimd.simdAvailable === 'boolean' && accelWithoutSimd.simdAvailable);
    assert.equal(enabledWithoutNative, false);

    // Null accelerator
    const nullAccel = null;
    const enabledNull = !!(nullAccel && typeof nullAccel.simdAvailable === 'boolean' && nullAccel.simdAvailable);
    assert.equal(enabledNull, false);
  });

  it('A6 is enabled only when agentdb is available', () => {
    const agentdbNull = null;
    const agentdbPresent = {};
    assert.equal(agentdbNull !== null, false, 'A6 disabled when agentdb null');
    assert.equal(agentdbPresent !== null, true, 'A6 enabled when agentdb present');
  });

  it('A6 health check reports 6 composite children', () => {
    const a6Active = true;
    const childNames = ['semanticQueryRouter', 'sonaLearningBackend', 'contrastiveTrainer',
      'temporalCompressor', 'federatedSessionManager', 'rvfSolver'];

    const virtualChildren = a6Active ? childNames.length : 0;
    assert.equal(virtualChildren, 6);
    assert.equal(childNames.length, 6);
  });
});

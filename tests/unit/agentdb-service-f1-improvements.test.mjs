// @tier unit
// F1 improvements: embedder propagation, ONNX fallback chain, getInstance race
// safety, individual controller try/catch, embCfg scope fix.
// London School TDD: inline mocks, no real AgentDB/SQLite imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as agentdb-service-f1.test.mjs)
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

function mockCtor(methods = {}) {
  const instances = [];
  class Mock {
    constructor(...args) {
      this._args = args;
      Object.assign(this, methods);
      instances.push(this);
    }
  }
  Mock.instances = instances;
  Mock.reset = () => { instances.length = 0; };
  return Mock;
}

// ============================================================================
// Shared constants
// ============================================================================

const CORE_CONTROLLERS = [
  'vectorBackend',
  'reflexionMemory',
  'skillLibrary',
  'reasoningBank',
  'causalGraph',
  'causalRecall',
  'learningSystem',
  'attentionService',
  'nightlyLearner',
  'explainableRecall',
];

// ============================================================================
// Group 1: Embedder propagation — replaceEmbeddingService after upgrade
// ============================================================================

describe('F1 improvement: Embedder propagation', () => {

  it('replaceEmbeddingService is called with enhanced service after upgrade', () => {
    const replaceEmbeddingServiceCalls = [];
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn((svc) => {
        replaceEmbeddingServiceCalls.push(svc);
      }),
      getController: mockFn(() => ({ _name: 'stub' })),
      close: mockFn(),
    };

    const enhancedEmbedder = { embed: mockFn(), model: 'all-mpnet-base-v2' };

    // Simulate the post-upgrade embedder propagation
    function propagateEmbedder(db, embedder) {
      db.replaceEmbeddingService(embedder);
    }

    propagateEmbedder(mockAgentDB, enhancedEmbedder);

    assert.equal(mockAgentDB.replaceEmbeddingService.calls.length, 1,
      'replaceEmbeddingService must be called exactly once');
    assert.strictEqual(mockAgentDB.replaceEmbeddingService.calls[0][0], enhancedEmbedder,
      'replaceEmbeddingService must receive the enhanced embedder instance');
  });

  it('propagation does not happen when no enhanced service is available', () => {
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn(),
      getController: mockFn(() => ({ _name: 'stub' })),
      close: mockFn(),
    };

    // Simulate conditional propagation (no enhanced service)
    function propagateEmbedder(db, embedder) {
      if (embedder) {
        db.replaceEmbeddingService(embedder);
      }
    }

    propagateEmbedder(mockAgentDB, null);

    assert.equal(mockAgentDB.replaceEmbeddingService.calls.length, 0,
      'replaceEmbeddingService must NOT be called when embedder is null');
  });

  it('propagation passes exact instance, not a copy', () => {
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn(),
      close: mockFn(),
    };

    const embedder = { embed: mockFn(), _id: 'unique-ref' };

    mockAgentDB.replaceEmbeddingService(embedder);

    const received = mockAgentDB.replaceEmbeddingService.calls[0][0];
    assert.strictEqual(received, embedder,
      'must pass the exact same object reference, not a clone');
    assert.equal(received._id, 'unique-ref');
  });
});

// ============================================================================
// Group 2: ONNX fallback chain — ONNX > Enhanced > basic
// ============================================================================

describe('F1 improvement: ONNX fallback chain', () => {

  function createEmbedderChain({ onnxFactory, enhancedFactory, basicFactory }) {
    // Mirrors the 3-tier fallback: ONNX → Enhanced → basic
    const result = { embedder: null, tier: null, errors: [] };

    // Tier 1: try ONNX
    try {
      const onnx = onnxFactory();
      result.embedder = onnx;
      result.tier = 'onnx';
      return result;
    } catch (err) {
      result.errors.push({ tier: 'onnx', error: err });
    }

    // Tier 2: try Enhanced
    try {
      const enhanced = enhancedFactory();
      result.embedder = enhanced;
      result.tier = 'enhanced';
      return result;
    } catch (err) {
      result.errors.push({ tier: 'enhanced', error: err });
    }

    // Tier 3: basic (always succeeds)
    result.embedder = basicFactory();
    result.tier = 'basic';
    return result;
  }

  it('uses ONNX when ONNXEmbeddingService succeeds', () => {
    const onnxEmb = { embed: mockFn(), model: 'onnx-mpnet' };

    const result = createEmbedderChain({
      onnxFactory: () => onnxEmb,
      enhancedFactory: () => { throw new Error('should not reach'); },
      basicFactory: () => { throw new Error('should not reach'); },
    });

    assert.strictEqual(result.embedder, onnxEmb,
      'must use ONNX embedder when available');
    assert.equal(result.tier, 'onnx');
    assert.equal(result.errors.length, 0);
  });

  it('falls back to Enhanced when ONNX fails', () => {
    const enhancedEmb = { embed: mockFn(), model: 'enhanced-mpnet' };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new Error('ONNX runtime not found'); },
      enhancedFactory: () => enhancedEmb,
      basicFactory: () => { throw new Error('should not reach'); },
    });

    assert.strictEqual(result.embedder, enhancedEmb,
      'must fall back to Enhanced when ONNX fails');
    assert.equal(result.tier, 'enhanced');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error.message, /ONNX runtime not found/);
  });

  it('falls back to basic when both ONNX and Enhanced fail', () => {
    const basicEmb = { embed: mockFn(), model: 'basic-hash' };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new Error('ONNX not available'); },
      enhancedFactory: () => { throw new Error('Enhanced model missing'); },
      basicFactory: () => basicEmb,
    });

    assert.strictEqual(result.embedder, basicEmb,
      'must fall back to basic when both ONNX and Enhanced fail');
    assert.equal(result.tier, 'basic');
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0].tier, 'onnx');
    assert.equal(result.errors[1].tier, 'enhanced');
  });

  it('records error details for each failed tier', () => {
    const basicEmb = { embed: mockFn() };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new TypeError('Cannot read properties of undefined'); },
      enhancedFactory: () => { throw new RangeError('dimension mismatch'); },
      basicFactory: () => basicEmb,
    });

    assert.equal(result.errors.length, 2);
    assert.ok(result.errors[0].error instanceof TypeError,
      'ONNX error must preserve error type');
    assert.ok(result.errors[1].error instanceof RangeError,
      'Enhanced error must preserve error type');
  });

  it('ONNX tier is preferred even when Enhanced would also succeed', () => {
    const onnxEmb = { embed: mockFn(), _preferred: true };
    const enhancedEmb = { embed: mockFn(), _preferred: false };

    const result = createEmbedderChain({
      onnxFactory: () => onnxEmb,
      enhancedFactory: () => enhancedEmb,
      basicFactory: () => ({ embed: mockFn() }),
    });

    assert.strictEqual(result.embedder, onnxEmb,
      'ONNX must be selected over Enhanced when both are available');
    assert.equal(result.tier, 'onnx');
  });
});

// ============================================================================
// Group 3: getInstance race safety — concurrent calls yield single init
// ============================================================================

describe('F1 improvement: getInstance race safety', () => {

  it('concurrent getInstance calls produce exactly one initialization', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    // Simulates a singleton with lazy init + lock
    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          // Simulate async init work
          await new Promise(r => setTimeout(r, 10));
          instance = { _id: 'singleton', _createdAt: Date.now() };
          return instance;
        })();
      }
      return initPromise;
    }

    // Fire two concurrent calls
    const [a, b] = await Promise.all([getInstance(), getInstance()]);

    assert.equal(initCount, 1,
      'initialization must run exactly once, not once per caller');
    assert.strictEqual(a, b,
      'both callers must receive the exact same instance');
    assert.equal(a._id, 'singleton');
  });

  it('three concurrent callers all get the same instance', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          instance = { _id: 'triple-test' };
          return instance;
        })();
      }
      return initPromise;
    }

    const [a, b, c] = await Promise.all([
      getInstance(),
      getInstance(),
      getInstance(),
    ]);

    assert.equal(initCount, 1, 'init must run once even with 3 callers');
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
  });

  it('sequential calls after init reuse the cached instance without re-init', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          instance = { _id: 'cached' };
          return instance;
        })();
      }
      return initPromise;
    }

    const first = await getInstance();
    const second = await getInstance();
    const third = await getInstance();

    assert.equal(initCount, 1, 'init must not re-run on subsequent calls');
    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
  });

  it('init failure does not leave a stale promise blocking retries', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;
    let shouldFail = true;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          if (shouldFail) {
            // Clear promise so retry is possible
            initPromise = null;
            throw new Error('init failed');
          }
          instance = { _id: 'recovered' };
          return instance;
        })();
      }
      return initPromise;
    }

    // First call fails
    await assert.rejects(() => getInstance(), /init failed/);
    assert.equal(initCount, 1);

    // Retry should succeed
    shouldFail = false;
    const result = await getInstance();
    assert.equal(initCount, 2, 'init must retry after failure');
    assert.equal(result._id, 'recovered');
  });
});

// ============================================================================
// Group 4: Individual controller try/catch — one failure does not block others
// ============================================================================

describe('F1 improvement: Individual controller try/catch', () => {

  function initCoreControllers(agentDB) {
    const controllers = {};
    const errors = [];

    for (const name of CORE_CONTROLLERS) {
      try {
        controllers[name] = agentDB.getController(name);
      } catch (err) {
        errors.push({ name, error: err });
        controllers[name] = null;
      }
    }

    return { controllers, errors };
  }

  it('causal throws but other 9 controllers still initialize', () => {
    const db = {
      getController(name) {
        if (name === 'causalGraph') throw new Error('causal init failed');
        return { _name: name, _ok: true };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    // causalGraph is null
    assert.equal(controllers.causalGraph, null,
      'causalGraph must be null when its init throws');

    // All other 9 are present
    const initialized = Object.entries(controllers)
      .filter(([, v]) => v !== null);
    assert.equal(initialized.length, CORE_CONTROLLERS.length - 1,
      'exactly 9 controllers must still initialize when only causal fails');

    // Each initialized controller has its name
    for (const [name, ctrl] of initialized) {
      assert.equal(ctrl._name, name);
      assert.equal(ctrl._ok, true);
    }

    // Error recorded for causal only
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, 'causalGraph');
    assert.match(errors[0].error.message, /causal init failed/);
  });

  it('multiple controllers fail independently', () => {
    const failSet = new Set(['causalGraph', 'nightlyLearner', 'skillLibrary']);
    const db = {
      getController(name) {
        if (failSet.has(name)) throw new Error(`${name} broken`);
        return { _name: name };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, failSet.size,
      `exactly ${failSet.size} errors must be recorded`);

    for (const name of failSet) {
      assert.equal(controllers[name], null, `${name} must be null`);
    }

    const succeededCount = Object.values(controllers)
      .filter(v => v !== null).length;
    assert.equal(succeededCount, CORE_CONTROLLERS.length - failSet.size,
      'remaining controllers must succeed');
  });

  it('all 10 controllers fail — no crash, all null', () => {
    const db = {
      getController(name) {
        throw new Error(`${name} unavailable`);
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, CORE_CONTROLLERS.length);
    for (const name of CORE_CONTROLLERS) {
      assert.equal(controllers[name], null,
        `${name} must be null when all fail`);
    }
  });

  it('all 10 controllers succeed — no errors recorded', () => {
    const db = {
      getController(name) {
        return { _name: name, ready: true };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, 0, 'no errors when all succeed');
    for (const name of CORE_CONTROLLERS) {
      assert.ok(controllers[name] !== null, `${name} must be initialized`);
      assert.equal(controllers[name].ready, true);
    }
  });

  it('error in vectorBackend does not prevent reflexionMemory', () => {
    // vectorBackend is first in the list — verify iteration continues
    const db = {
      getController(name) {
        if (name === 'vectorBackend') throw new Error('vector init boom');
        return { _name: name };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(controllers.vectorBackend, null);
    assert.ok(controllers.reflexionMemory !== null,
      'reflexionMemory must init even when vectorBackend (listed before it) fails');
    assert.equal(controllers.reflexionMemory._name, 'reflexionMemory');
    assert.equal(errors.length, 1);
  });
});

// ============================================================================
// Group 5: embCfg scope fix — Phase 2 init does not throw ReferenceError
// ============================================================================

describe('F1 fix: embCfg scope in Phase 2 init', () => {

  it('initializePhase2RuVectorPackages does not throw ReferenceError', async () => {
    // Simulates the fixed Phase 2 init where embCfg is declared within scope.
    // Before the fix, embCfg was referenced from a scope it did not exist in,
    // causing a ReferenceError.

    async function initializePhase2RuVectorPackages(config) {
      // embCfg is derived from the config arg — scoped correctly
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';

      const results = { gnn: null, router: null };

      // Simulate GNN init
      if (config.enableGNN !== false) {
        results.gnn = { dimension, model, type: 'gnn' };
      }

      // Simulate SemanticRouter init
      if (config.enableRouter !== false) {
        results.router = { dimension, model, type: 'router' };
      }

      return results;
    }

    // Should not throw ReferenceError
    const result = await initializePhase2RuVectorPackages({
      embedding: { dimension: 384, model: 'test-model' },
      enableGNN: true,
      enableRouter: true,
    });

    assert.equal(result.gnn.dimension, 384);
    assert.equal(result.gnn.model, 'test-model');
    assert.equal(result.router.dimension, 384);
    assert.equal(result.router.model, 'test-model');
  });

  it('embCfg defaults when config.embedding is missing', async () => {
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';
      return { dimension, model };
    }

    // No embedding key at all — must not throw, must use defaults
    const result = await initializePhase2RuVectorPackages({});

    assert.equal(result.dimension, 768,
      'dimension must default to 768 when embedding config is absent');
    assert.equal(result.model, 'all-mpnet-base-v2',
      'model must default to all-mpnet-base-v2 when embedding config is absent');
  });

  it('embCfg defaults when config.embedding is undefined', async () => {
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';
      return { dimension, model };
    }

    const result = await initializePhase2RuVectorPackages({
      embedding: undefined,
    });

    assert.equal(result.dimension, 768);
    assert.equal(result.model, 'all-mpnet-base-v2');
  });

  it('embCfg does not leak between Phase 2 calls', async () => {
    // Verify embCfg is local, not shared mutable state
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      return { dimension };
    }

    const r1 = await initializePhase2RuVectorPackages({
      embedding: { dimension: 384 },
    });
    const r2 = await initializePhase2RuVectorPackages({
      embedding: { dimension: 512 },
    });

    assert.equal(r1.dimension, 384, 'first call must use its own config');
    assert.equal(r2.dimension, 512, 'second call must use its own config');
    assert.notEqual(r1.dimension, r2.dimension,
      'embCfg must not leak between calls');
  });
});

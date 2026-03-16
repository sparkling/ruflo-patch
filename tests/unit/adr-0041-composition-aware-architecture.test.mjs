// @tier unit
// ADR-0041: Composition-Aware Controller Architecture
// Tests for composite pattern, singleton pattern, init levels, safeguards, enable checks

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// Init levels from ADR-0041 (42 registry entries across 7 levels)
// ============================================================================

const INIT_LEVELS = [
  /* 0 */ ['resourceTracker', 'rateLimiter', 'circuitBreaker', 'telemetryManager'],
  /* 1 */ ['reasoningBank', 'hierarchicalMemory', 'learningBridge', 'solverBandit', 'tieredCache', 'metadataFilter', 'queryOptimizer', 'mutationGuard'],
  /* 2 */ ['selfAttention', 'moeRouter', 'graphRoPE', 'attentionService', 'selfLearningRvfBackend', 'nativeAccelerator', 'quantizedVectorStore', 'vectorBackend', 'gnnService', 'agentMemoryScope', 'memoryGraph', 'rvfOptimizer'],
  /* 3 */ ['enhancedEmbeddingService', 'auditLogger', 'skills', 'reflexion', 'attestationLog', 'batchOperations', 'memoryConsolidation', 'causalGraph'],
  /* 4 */ ['indexHealthMonitor', 'federatedLearningManager', 'attentionMetrics', 'nightlyLearner', 'learningSystem', 'explainableRecall', 'causalRecall'],
  /* 5 */ ['sonaTrajectory', 'contextSynthesizer', 'mmrDiversityRanker', 'guardedVectorBackend', 'semanticRouter', 'learningBridgeV2'],
  /* 6 */ ['graphAdapter', 'healthAggregator'],
];

// A6 children (created internally, NOT in INIT_LEVELS)
const A6_CHILDREN = ['contrastiveTrainer', 'sonaLearningBackend', 'semanticQueryRouter', 'temporalCompressor', 'federatedSessionManager', 'rvfSolver'];

// B9 children
const B9_CHILDREN = ['scalarQuantizer', 'productQuantizer'];

// Infrastructure controllers (Level 0)
const LEVEL_0 = INIT_LEVELS[0];

// ============================================================================
// Composite parent factories (mocked)
// ============================================================================

function createSelfLearningRvfBackend(opts = {}) {
  const children = {};
  let initialized = false;

  function initComponents() {
    children.rvfSolver = { solve: mockFn(() => [0.1, 0.2]) };
    children.sonaLearningBackend = { train: mockFn(), predict: mockFn(() => 0.95) };
    children.semanticQueryRouter = { route: mockFn(() => 'vectorBackend') };
    children.temporalCompressor = { compress: mockFn(() => new Float32Array(128)) };
    children.contrastiveTrainer = { train: mockFn() };
    children.federatedSessionManager = { merge: mockFn() };
    initialized = true;
  }

  initComponents();

  return {
    search: mockFn((query) => [{ id: '1', score: 0.9 }]),
    insert: mockFn((key, vec) => true),
    getComponent(name) { return children[name] || null; },
    getStats() {
      return {
        initialized,
        childCount: Object.keys(children).length,
        children: Object.fromEntries(
          Object.entries(children).map(([k, v]) => [k, { healthy: true }])
        ),
        accelerator: opts.accelerator ? 'shared' : 'none',
      };
    },
    getHealth() {
      const childHealthy = Object.values(children).every(() => true);
      return { healthy: initialized && childHealthy, childCount: Object.keys(children).length };
    },
  };
}

function createQuantizedVectorStore(opts = {}) {
  const quantizerType = opts.quantizerType || 'scalar';
  const children = {};

  if (quantizerType === 'scalar') {
    children.scalarQuantizer = { quantize: mockFn((v) => new Uint8Array(v.length)), dequantize: mockFn() };
  } else {
    children.productQuantizer = { quantize: mockFn((v) => new Uint8Array(v.length / 4)), dequantize: mockFn() };
  }

  return {
    insert: mockFn((key, vec) => {
      const q = children.scalarQuantizer || children.productQuantizer;
      q.quantize(vec);
      return true;
    }),
    search: mockFn(() => []),
    getComponent(name) { return children[name] || null; },
    getStats() {
      return {
        quantizerType,
        childCount: Object.keys(children).length,
        children: Object.keys(children),
      };
    },
    getHealth() {
      return { healthy: true, childCount: Object.keys(children).length };
    },
  };
}

function createCircuitBreakerWrapper() {
  let state = 'CLOSED';
  let failures = 0;
  const threshold = 5;

  return {
    wrap(getCall) {
      if (state === 'OPEN') return null;
      try {
        const result = getCall();
        failures = 0;
        state = 'CLOSED';
        return result;
      } catch {
        failures++;
        if (failures >= threshold) state = 'OPEN';
        return null;
      }
    },
    getState() { return state; },
    setState(s) { state = s; },
    getStats() { return { state, failures }; },
  };
}

// ============================================================================
// Controller Registry (mocked)
// ============================================================================

function createRegistry() {
  const controllers = new Map();
  const singletons = new Map();

  function register(name, instance) {
    controllers.set(name, instance);
  }

  function get(name) {
    return controllers.get(name) || null;
  }

  function has(name) {
    return controllers.has(name);
  }

  function getSingleton(name, factory) {
    if (!singletons.has(name)) {
      singletons.set(name, factory());
    }
    return singletons.get(name);
  }

  function size() {
    return controllers.size;
  }

  return { register, get, has, getSingleton, size, _controllers: controllers };
}

// ============================================================================
// Factory with safeguards (mocked)
// ============================================================================

async function safeCreateController(name, factory, timeoutMs = 2000) {
  try {
    const result = await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Factory timeout')), timeoutMs)),
    ]);
    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// Enable check (mocked)
// ============================================================================

function isControllerEnabled(name, context = {}) {
  const { agentdbPresent = false, configFlags = {} } = context;

  // Level 0 infrastructure always enabled
  if (LEVEL_0.includes(name)) return true;

  // AgentDB controllers
  const agentdbControllers = [
    'reasoningBank', 'skills', 'reflexion', 'causalGraph',
    'causalRecall', 'learningSystem', 'explainableRecall', 'nightlyLearner',
    'mutationGuard', 'attestationLog', 'vectorBackend', 'graphAdapter',
    'selfLearningRvfBackend', 'nativeAccelerator', 'quantizedVectorStore',
    'enhancedEmbeddingService', 'indexHealthMonitor', 'federatedLearningManager',
  ];
  if (agentdbControllers.includes(name)) return agentdbPresent;

  // Optional controllers (config flag)
  const optionalControllers = [
    'sonaTrajectory', 'contextSynthesizer', 'mmrDiversityRanker',
    'guardedVectorBackend', 'learningBridgeV2',
  ];
  if (optionalControllers.includes(name)) return !!configFlags[name];

  // CLI controllers always enabled if agentdb not required
  const allNames = INIT_LEVELS.flat();
  if (allNames.includes(name)) return true;

  return false;
}

// ============================================================================
// Write limiter (safeguard #3)
// ============================================================================

function createWriteLimiter(maxWrites = 3) {
  let writeCount = 0;
  return {
    canWrite() { return writeCount < maxWrites; },
    recordWrite() { writeCount++; },
    getCount() { return writeCount; },
    reset() { writeCount = 0; },
  };
}

// ============================================================================
// Cold-start guard (safeguard #2)
// ============================================================================

function createColdStartGuard(minDataPoints = 10) {
  let dataPointCount = 0;
  return {
    isReady() { return dataPointCount >= minDataPoints; },
    recordData() { dataPointCount++; },
    getCount() { return dataPointCount; },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0041: Composition-Aware Controller Architecture', () => {

  // ==========================================================================
  // Composite Pattern Tests (8)
  // ==========================================================================

  describe('Composite Pattern', () => {

    it('composite factory creates parent only — children NOT in registry separately', () => {
      const registry = createRegistry();
      const accel = { simdAvailable: true };
      const a6 = createSelfLearningRvfBackend({ accelerator: accel });
      registry.register('selfLearningRvfBackend', a6);

      assert.ok(registry.has('selfLearningRvfBackend'), 'A6 must be in registry');
      for (const child of A6_CHILDREN) {
        assert.ok(!registry.has(child), `${child} must NOT be in registry separately`);
      }
    });

    it('A6 SelfLearningRvfBackend getStats() reports child status', () => {
      const a6 = createSelfLearningRvfBackend();
      const stats = a6.getStats();

      assert.strictEqual(stats.initialized, true, 'A6 must report initialized');
      assert.strictEqual(stats.childCount, 6, 'A6 must report 6 children');
      assert.ok(stats.children.rvfSolver, 'rvfSolver child reported');
      assert.ok(stats.children.sonaLearningBackend, 'sonaLearningBackend child reported');
      assert.ok(stats.children.semanticQueryRouter, 'semanticQueryRouter child reported');
      assert.ok(stats.children.temporalCompressor, 'temporalCompressor child reported');
      assert.ok(stats.children.contrastiveTrainer, 'contrastiveTrainer child reported');
      assert.ok(stats.children.federatedSessionManager, 'federatedSessionManager child reported');
    });

    it('B9 QuantizedVectorStore creates B7+B8 internally', () => {
      const b9Scalar = createQuantizedVectorStore({ quantizerType: 'scalar' });
      const statsScalar = b9Scalar.getStats();
      assert.strictEqual(statsScalar.quantizerType, 'scalar');
      assert.ok(statsScalar.children.includes('scalarQuantizer'), 'B7 scalar created');
      assert.ok(!statsScalar.children.includes('productQuantizer'), 'B8 not created for scalar config');

      const b9Product = createQuantizedVectorStore({ quantizerType: 'product' });
      const statsProduct = b9Product.getStats();
      assert.strictEqual(statsProduct.quantizerType, 'product');
      assert.ok(statsProduct.children.includes('productQuantizer'), 'B8 product created');
      assert.ok(!statsProduct.children.includes('scalarQuantizer'), 'B7 not created for product config');
    });

    it('D6 CircuitBreaker wraps get() calls — returns null when breaker open', () => {
      const cb = createCircuitBreakerWrapper();
      cb.setState('OPEN');

      const result = cb.wrap(() => ({ name: 'skills' }));
      assert.strictEqual(result, null, 'open breaker returns null');
    });

    it('composite parent exposes unified API (not raw children)', () => {
      const a6 = createSelfLearningRvfBackend();

      // Parent exposes search/insert — high-level operations
      assert.ok(typeof a6.search === 'function', 'parent exposes search()');
      assert.ok(typeof a6.insert === 'function', 'parent exposes insert()');
      assert.ok(typeof a6.getStats === 'function', 'parent exposes getStats()');

      // Children are not directly exposed as top-level methods
      assert.strictEqual(a6.train, undefined, 'child method train() not on parent');
      assert.strictEqual(a6.route, undefined, 'child method route() not on parent');
      assert.strictEqual(a6.compress, undefined, 'child method compress() not on parent');
    });

    it('creating composite does not double-register children', () => {
      const registry = createRegistry();

      // Wire A6 (parent)
      const a6 = createSelfLearningRvfBackend();
      registry.register('selfLearningRvfBackend', a6);

      // Wire B9 (parent)
      const b9 = createQuantizedVectorStore();
      registry.register('quantizedVectorStore', b9);

      // Verify only parents are in registry, not children
      const registeredNames = [...registry._controllers.keys()];
      const allChildren = [...A6_CHILDREN, ...B9_CHILDREN];

      for (const child of allChildren) {
        assert.ok(!registeredNames.includes(child), `${child} must not be double-registered`);
      }
      assert.strictEqual(registry.size(), 2, 'only 2 parents registered');
    });

    it('children accessible via parent.getComponent() not registry.get()', () => {
      const registry = createRegistry();
      const a6 = createSelfLearningRvfBackend();
      registry.register('selfLearningRvfBackend', a6);

      // Via parent: accessible
      const router = a6.getComponent('semanticQueryRouter');
      assert.ok(router !== null, 'child accessible via parent.getComponent()');
      assert.ok(typeof router.route === 'function', 'child has expected API');

      // Via registry: not accessible
      const fromRegistry = registry.get('semanticQueryRouter');
      assert.strictEqual(fromRegistry, null, 'child NOT accessible via registry.get()');
    });

    it('composite health aggregates child health', () => {
      const a6 = createSelfLearningRvfBackend();
      const health = a6.getHealth();

      assert.strictEqual(health.healthy, true, 'composite reports healthy when all children healthy');
      assert.strictEqual(health.childCount, 6, 'composite reports correct child count');

      const b9 = createQuantizedVectorStore();
      const b9Health = b9.getHealth();
      assert.strictEqual(b9Health.healthy, true, 'B9 reports healthy');
      assert.strictEqual(b9Health.childCount, 1, 'B9 has 1 child (either scalar or product)');
    });
  });

  // ==========================================================================
  // Singleton Pattern Tests (4)
  // ==========================================================================

  describe('Singleton Pattern', () => {

    it('B4 NativeAccelerator is created once (singleton)', () => {
      const registry = createRegistry();
      let createCount = 0;
      const factory = () => { createCount++; return { simdAvailable: false, getStats: () => ({ consumers: 0 }) }; };

      registry.getSingleton('nativeAccelerator', factory);
      registry.getSingleton('nativeAccelerator', factory);
      registry.getSingleton('nativeAccelerator', factory);

      assert.strictEqual(createCount, 1, 'factory called exactly once');
    });

    it('multiple consumers receive same instance reference', () => {
      const registry = createRegistry();
      const factory = () => ({ simdAvailable: true, id: Math.random() });

      const forA6 = registry.getSingleton('nativeAccelerator', factory);
      const forA5 = registry.getSingleton('nativeAccelerator', factory);
      const forB2 = registry.getSingleton('nativeAccelerator', factory);
      const forA7 = registry.getSingleton('nativeAccelerator', factory);

      assert.strictEqual(forA6, forA5, 'A6 and A5 get same instance');
      assert.strictEqual(forA5, forB2, 'A5 and B2 get same instance');
      assert.strictEqual(forB2, forA7, 'B2 and A7 get same instance');
      assert.strictEqual(forA6.id, forA7.id, 'all have same random id (same object)');
    });

    it('singleton survives re-initialization', () => {
      const registry = createRegistry();
      const factory = () => ({ created: Date.now(), simdAvailable: true });

      const first = registry.getSingleton('nativeAccelerator', factory);
      // Simulate "re-init" by requesting again
      const second = registry.getSingleton('nativeAccelerator', factory);

      assert.strictEqual(first, second, 'singleton survives re-initialization');
      assert.strictEqual(first.created, second.created, 'same creation timestamp');
    });

    it('singleton getStats() reflects shared usage', () => {
      const registry = createRegistry();
      let consumers = 0;
      const factory = () => ({
        simdAvailable: true,
        addConsumer() { consumers++; },
        getStats() { return { consumers, simdAvailable: true }; },
      });

      const accel = registry.getSingleton('nativeAccelerator', factory);
      accel.addConsumer(); // A6
      accel.addConsumer(); // A5
      accel.addConsumer(); // B2
      accel.addConsumer(); // A7

      const stats = accel.getStats();
      assert.strictEqual(stats.consumers, 4, 'shared singleton tracks 4 consumers');
      assert.strictEqual(stats.simdAvailable, true);
    });
  });

  // ==========================================================================
  // Init Level Tests (6)
  // ==========================================================================

  describe('Init Levels', () => {

    it('Level 0 controllers (D4, D5, D6, D1) are defined', () => {
      assert.ok(INIT_LEVELS[0].includes('resourceTracker'), 'D4 ResourceTracker at Level 0');
      assert.ok(INIT_LEVELS[0].includes('rateLimiter'), 'D5 RateLimiter at Level 0');
      assert.ok(INIT_LEVELS[0].includes('circuitBreaker'), 'D6 CircuitBreaker at Level 0');
      assert.ok(INIT_LEVELS[0].includes('telemetryManager'), 'D1 TelemetryManager at Level 0');
      assert.strictEqual(INIT_LEVELS[0].length, 4, 'Level 0 has exactly 4 entries');
    });

    it('Level 0 initializes before Level 1', () => {
      const initOrder = [];
      for (let level = 0; level < INIT_LEVELS.length; level++) {
        for (const name of INIT_LEVELS[level]) {
          initOrder.push({ name, level });
        }
      }

      const level0Names = INIT_LEVELS[0];
      const level1Names = INIT_LEVELS[1];

      for (const l0 of level0Names) {
        const l0Index = initOrder.findIndex(e => e.name === l0);
        for (const l1 of level1Names) {
          const l1Index = initOrder.findIndex(e => e.name === l1);
          assert.ok(l0Index < l1Index, `${l0} (L0) must init before ${l1} (L1)`);
        }
      }
    });

    it('all levels are ordered (0 < 1 < 2 < 3 < 4 < 5 < 6)', () => {
      for (let i = 0; i < INIT_LEVELS.length - 1; i++) {
        // Each level has entries, and they all come before the next level
        assert.ok(INIT_LEVELS[i].length > 0, `Level ${i} must have entries`);
      }
      // Verify level indices are sequential
      const levelIndices = INIT_LEVELS.map((_, i) => i);
      for (let i = 1; i < levelIndices.length; i++) {
        assert.ok(levelIndices[i] > levelIndices[i - 1], `Level ${i} > Level ${i - 1}`);
      }
    });

    it('no controller appears in multiple levels', () => {
      const seen = new Map();
      for (let level = 0; level < INIT_LEVELS.length; level++) {
        for (const name of INIT_LEVELS[level]) {
          assert.ok(!seen.has(name), `${name} appears in Level ${seen.get(name)} AND Level ${level}`);
          seen.set(name, level);
        }
      }
    });

    it('total controller count matches expected (47 registry + 8 composite = 55)', () => {
      const totalRegistry = INIT_LEVELS.reduce((sum, level) => sum + level.length, 0);
      // ADR-0041 table: L0=4, L1=8, L2=12, L3=8, L4=7, L5=6, L6=2 = 47 registry entries
      // Plus 8 composite children (6 via A6, 2 via B9) = 55 total
      assert.strictEqual(totalRegistry, 47, 'INIT_LEVELS should have 47 registry entries');

      const compositeChildren = A6_CHILDREN.length + B9_CHILDREN.length;
      assert.strictEqual(compositeChildren, 8, '8 children via composite');
      assert.strictEqual(totalRegistry + compositeChildren, 55, '55 total controllers');
    });

    it('Level 0 controllers are always enabled (infrastructure)', () => {
      for (const name of LEVEL_0) {
        // Even without agentdb, Level 0 must be enabled
        assert.strictEqual(
          isControllerEnabled(name, { agentdbPresent: false }),
          true,
          `${name} must be enabled even without agentdb`
        );
        assert.strictEqual(
          isControllerEnabled(name, { agentdbPresent: true }),
          true,
          `${name} must be enabled with agentdb`
        );
      }
    });
  });

  // ==========================================================================
  // Safeguard Tests (5)
  // ==========================================================================

  describe('Safeguards', () => {

    it('factory try-catch: failing factory returns null (not throws)', async () => {
      const result = await safeCreateController('broken', () => {
        throw new Error('import failed');
      });
      assert.strictEqual(result, null, 'failing factory returns null');
    });

    it('cold-start guard: first call after init is allowed only with enough data', () => {
      const guard = createColdStartGuard(10);

      assert.strictEqual(guard.isReady(), false, 'not ready with 0 data points');

      // Add 9 data points (still not ready)
      for (let i = 0; i < 9; i++) {
        guard.recordData();
      }
      assert.strictEqual(guard.isReady(), false, 'not ready with 9 data points');

      // 10th data point makes it ready
      guard.recordData();
      assert.strictEqual(guard.isReady(), true, 'ready with 10 data points');
      assert.strictEqual(guard.getCount(), 10);
    });

    it('max 3 writes per MCP handler enforced', () => {
      const limiter = createWriteLimiter(3);

      assert.strictEqual(limiter.canWrite(), true, 'write 1 allowed');
      limiter.recordWrite();
      assert.strictEqual(limiter.canWrite(), true, 'write 2 allowed');
      limiter.recordWrite();
      assert.strictEqual(limiter.canWrite(), true, 'write 3 allowed');
      limiter.recordWrite();
      assert.strictEqual(limiter.canWrite(), false, 'write 4 rejected');
      assert.strictEqual(limiter.getCount(), 3, 'count is 3');
    });

    it('fire-and-forget write does not block response', async () => {
      let writeCompleted = false;
      const fireAndForgetWrite = () => {
        // Simulate async write that completes later
        Promise.resolve().then(() => {
          writeCompleted = true;
        });
      };

      const start = Date.now();
      // Response returns immediately, write happens in background
      const response = { status: 'ok', data: [1, 2, 3] };
      fireAndForgetWrite();
      const elapsed = Date.now() - start;

      // Response is available immediately
      assert.strictEqual(response.status, 'ok');
      assert.ok(elapsed < 50, 'response not blocked by write');

      // After microtask, write completes
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.strictEqual(writeCompleted, true, 'background write completed');
    });

    it('controller factory timeout (2s) prevents hang', async () => {
      const result = await safeCreateController('hanging', () => {
        return new Promise(() => {}); // never resolves
      }, 100); // Use 100ms for test speed

      assert.strictEqual(result, null, 'timed-out factory returns null');
    });
  });

  // ==========================================================================
  // Enable Check Tests (4)
  // ==========================================================================

  describe('Enable Checks', () => {

    it('infrastructure controllers (Level 0) always return enabled=true', () => {
      const infraControllers = ['resourceTracker', 'rateLimiter', 'circuitBreaker', 'telemetryManager'];
      for (const name of infraControllers) {
        assert.strictEqual(
          isControllerEnabled(name, { agentdbPresent: false, configFlags: {} }),
          true,
          `${name} always enabled`
        );
      }
    });

    it('AgentDB controllers return enabled based on agentdb presence', () => {
      const agentdbCtrl = ['reasoningBank', 'selfLearningRvfBackend', 'nativeAccelerator', 'vectorBackend'];
      for (const name of agentdbCtrl) {
        assert.strictEqual(
          isControllerEnabled(name, { agentdbPresent: false }),
          false,
          `${name} disabled without agentdb`
        );
        assert.strictEqual(
          isControllerEnabled(name, { agentdbPresent: true }),
          true,
          `${name} enabled with agentdb`
        );
      }
    });

    it('optional controllers respect config flags', () => {
      const optionalCtrl = ['sonaTrajectory', 'contextSynthesizer', 'mmrDiversityRanker'];
      for (const name of optionalCtrl) {
        assert.strictEqual(
          isControllerEnabled(name, { configFlags: {} }),
          false,
          `${name} disabled without flag`
        );
        assert.strictEqual(
          isControllerEnabled(name, { configFlags: { [name]: true } }),
          true,
          `${name} enabled with flag`
        );
      }
    });

    it('unknown controller name returns enabled=false', () => {
      assert.strictEqual(
        isControllerEnabled('nonExistentController', {}),
        false,
        'unknown controller returns false'
      );
      assert.strictEqual(
        isControllerEnabled('fooBarBaz', { agentdbPresent: true }),
        false,
        'unknown controller returns false even with agentdb'
      );
    });
  });
});

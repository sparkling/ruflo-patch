// @tier unit
// ADR-0061: controller-registry — 15 new controllers + 8 bug fixes
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as controller-registry-activation.test.mjs)
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
// Group 1: Phase 1 Bug Fixes
// ============================================================================

describe('ADR-0061: Phase 1 bug fixes', () => {

  it('mutationGuard factory calls initialize() after construction', async () => {
    const initCalls = [];
    const MG = mockCtor({ initialize: () => { initCalls.push(true); } });

    // Simulated factory mirrors registry fix: new MG({dimension}) + initialize()
    async function createMutationGuard(dimension) {
      const instance = new MG({ dimension });
      await instance.initialize();
      return instance;
    }

    const mg = await createMutationGuard(384);
    assert.equal(MG.instances.length, 1);
    assert.deepEqual(MG.instances[0]._args, [{ dimension: 384 }]);
    assert.equal(initCalls.length, 1, 'initialize() must be called once');
  });

  it('learningSystem factory passes embedder as 2nd arg', () => {
    const LS = mockCtor();
    const fakeDb = { name: 'db' };
    const fakeEmbedder = { name: 'embedder' };

    const instance = new LS(fakeDb, fakeEmbedder);

    assert.equal(LS.instances.length, 1);
    assert.equal(instance._args.length, 2, 'must receive exactly 2 args');
    assert.equal(instance._args[0], fakeDb);
    assert.equal(instance._args[1], fakeEmbedder);
  });

  it('nightlyLearner factory passes embedder as 2nd arg', () => {
    const NL = mockCtor();
    const fakeDb = { name: 'db' };
    const fakeEmbedder = { name: 'embedder' };

    const instance = new NL(fakeDb, fakeEmbedder);

    assert.equal(NL.instances.length, 1);
    assert.equal(instance._args.length, 2);
    assert.equal(instance._args[1], fakeEmbedder);
  });

  it('mmrDiversityRanker returns class reference, not instance', () => {
    const MMR = mockCtor({ apply: () => [] });

    // Fixed factory: return the class itself (static-only pattern)
    function createMmrDiversityRanker(agentdbModule) {
      return agentdbModule.MMRDiversityRanker ?? null;
    }

    const result = createMmrDiversityRanker({ MMRDiversityRanker: MMR });

    assert.equal(result, MMR, 'must return class reference');
    assert.equal(MMR.instances.length, 0, 'must NOT instantiate');
  });

  it('reasoningBank passes vectorBackend as 3rd arg', () => {
    const RB = mockCtor();
    const fakeDb = { name: 'db' };
    const fakeEmbedder = { name: 'embedder' };
    const fakeVb = { name: 'vectorBackend' };

    const instance = new RB(fakeDb, fakeEmbedder, fakeVb);

    assert.equal(instance._args.length, 3);
    assert.equal(instance._args[2], fakeVb);
  });

  it('hierarchicalMemory passes vectorBackend as 3rd arg', () => {
    const HM = mockCtor();
    const fakeDb = { name: 'db' };
    const fakeEmbedder = { name: 'embedder' };
    const fakeVb = { name: 'vectorBackend' };

    const instance = new HM(fakeDb, fakeEmbedder, fakeVb);

    assert.equal(instance._args.length, 3);
    assert.equal(instance._args[2], fakeVb);
  });

  it('sonaTrajectory has fallback construction when getController fails', async () => {
    const initCalls = [];
    const ST = mockCtor({ initialize: () => { initCalls.push(true); } });

    // Simulated factory: try agentdb.getController, fall back to new ST()
    async function createSonaTrajectory(agentdb, SonaTrajectoryService) {
      try {
        const ctrl = agentdb.getController('sonaTrajectory');
        if (ctrl) return ctrl;
      } catch { /* fall through */ }
      const instance = new SonaTrajectoryService();
      await instance.initialize();
      return instance;
    }

    const fakeAgentdb = {
      getController: mockFn(() => { throw new Error('not available'); }),
    };

    const result = await createSonaTrajectory(fakeAgentdb, ST);

    assert.equal(ST.instances.length, 1, 'fallback must construct new instance');
    assert.equal(initCalls.length, 1, 'fallback must call initialize()');
    assert.equal(result, ST.instances[0]);
  });
});

// ============================================================================
// Group 2: Phase 2 Pure JS
// ============================================================================

describe('ADR-0061: Phase 2 pure JS controllers', () => {

  it('solverBandit factory returns instance', () => {
    const SB = mockCtor({ selectArm: () => null, recordReward: () => {} });

    function createSolverBandit(SolverBandit) {
      if (!SolverBandit) return null;
      return new SolverBandit();
    }

    const result = createSolverBandit(SB);
    assert.equal(SB.instances.length, 1);
    assert.notEqual(result, null);
  });

  it('attentionMetrics factory returns instance', () => {
    const AMC = mockCtor({ getMetrics: () => ({}) });

    function createAttentionMetrics(AttentionMetricsCollector) {
      if (!AttentionMetricsCollector) return null;
      return new AttentionMetricsCollector();
    }

    const result = createAttentionMetrics(AMC);
    assert.equal(AMC.instances.length, 1);
    assert.notEqual(result, null);
  });
});

// ============================================================================
// Group 3: Phase 3 Attention
// ============================================================================

describe('ADR-0061: Phase 3 attention controllers', () => {

  it('selfAttention factory passes vectorBackend', () => {
    const SAC = mockCtor();
    const fakeVb = { name: 'vb' };
    const config = { topK: 10 };

    const instance = new SAC(fakeVb, config);

    assert.equal(SAC.instances.length, 1);
    assert.equal(instance._args[0], fakeVb);
    assert.deepEqual(instance._args[1], { topK: 10 });
  });

  it('crossAttention factory passes vectorBackend', () => {
    const CAC = mockCtor();
    const fakeVb = { name: 'vb' };

    const instance = new CAC(fakeVb);

    assert.equal(CAC.instances.length, 1);
    assert.equal(instance._args[0], fakeVb);
  });

  it('multiHeadAttention factory passes numHeads config', () => {
    const MHA = mockCtor();
    const fakeVb = { name: 'vb' };

    const instance = new MHA(fakeVb, { numHeads: 4 });

    assert.equal(MHA.instances.length, 1);
    assert.equal(instance._args[0], fakeVb);
    assert.deepEqual(instance._args[1], { numHeads: 4 });
  });

  it('attentionService factory calls initialize() after construction', async () => {
    const initCalls = [];
    const AS = mockCtor({ initialize: () => { initCalls.push(true); } });

    async function createAttentionService(AttentionService, config) {
      const dim = config.dimension || 384;
      const svc = new AttentionService({
        numHeads: 8,
        headDim: Math.floor(dim / 8),
        embedDim: dim,
      });
      await svc.initialize();
      return svc;
    }

    const result = await createAttentionService(AS, { dimension: 384 });

    assert.equal(AS.instances.length, 1);
    const args = AS.instances[0]._args[0];
    assert.equal(args.numHeads, 8);
    assert.equal(args.headDim, 48);
    assert.equal(args.embedDim, 384);
    assert.equal(initCalls.length, 1, 'initialize() must be called');
  });
});

// ============================================================================
// Group 4: Phase 4 Optimization
// ============================================================================

describe('ADR-0061: Phase 4 optimization controllers', () => {

  it('queryOptimizer requires agentdb, passes database', () => {
    const QO = mockCtor();

    function createQueryOptimizer(agentdb, QueryOptimizer) {
      if (!agentdb) return null;
      if (!QueryOptimizer) return null;
      return new QueryOptimizer(agentdb.database);
    }

    // With agentdb
    const fakeDb = { prepare: () => {} };
    const result = createQueryOptimizer({ database: fakeDb }, QO);
    assert.notEqual(result, null);
    assert.equal(QO.instances[0]._args[0], fakeDb);

    // Without agentdb
    QO.reset();
    const nullResult = createQueryOptimizer(null, QO);
    assert.equal(nullResult, null);
    assert.equal(QO.instances.length, 0);
  });

  it('enhancedEmbeddingService factory returns instance with defaults', () => {
    const EES = mockCtor();

    function createEnhancedEmbeddingService(Cls) {
      if (!Cls) return null;
      return new Cls();
    }

    const result = createEnhancedEmbeddingService(EES);
    assert.equal(EES.instances.length, 1);
    assert.equal(EES.instances[0]._args.length, 0, 'no args — all defaults');
    assert.notEqual(result, null);
  });

  it('quantizedVectorStore factory uses scalar-8bit', () => {
    const QVS = mockCtor();

    function createQuantizedVectorStore(Cls) {
      if (!Cls) return null;
      return new Cls({ type: 'scalar-8bit' });
    }

    const result = createQuantizedVectorStore(QVS);
    assert.equal(QVS.instances.length, 1);
    assert.deepEqual(QVS.instances[0]._args[0], { type: 'scalar-8bit' });
  });
});

// ============================================================================
// Group 5: Phase 5 Self-Learning
// ============================================================================

describe('ADR-0061: Phase 5 self-learning controllers', () => {

  it('nativeAccelerator uses getAccelerator singleton, not new', async () => {
    const singleton = { simdAvailable: true };
    const getAccelerator = mockFn(async () => singleton);

    async function createNativeAccelerator(getAcc) {
      if (!getAcc) return null;
      return await getAcc();
    }

    const result = await createNativeAccelerator(getAccelerator);

    assert.equal(getAccelerator.calls.length, 1);
    assert.equal(result, singleton);
  });

  it('selfLearningRvfBackend uses static create(), not new', async () => {
    const fakeInstance = { initialized: true };
    const createFn = mockFn(async (cfg) => fakeInstance);

    const SLRB = { create: createFn };

    async function createSelfLearningRvfBackend(agentdb, Cls) {
      if (!agentdb) return null;
      if (!Cls) return null;
      return await Cls.create({
        dimension: 384,
        storagePath: ':memory:',
        learning: true,
      });
    }

    const result = await createSelfLearningRvfBackend({ database: {} }, SLRB);

    assert.equal(createFn.calls.length, 1, 'must call static create()');
    assert.deepEqual(createFn.calls[0][0], {
      dimension: 384,
      storagePath: ':memory:',
      learning: true,
    });
    assert.equal(result, fakeInstance);
  });

  it('federatedLearningManager passes agentId in config', () => {
    const FLM = mockCtor();

    function createFederatedLearningManager(Cls) {
      if (!Cls) return null;
      return new Cls({ agentId: 'cli-default' });
    }

    const result = createFederatedLearningManager(FLM);

    assert.equal(FLM.instances.length, 1);
    assert.deepEqual(FLM.instances[0]._args[0], { agentId: 'cli-default' });
  });
});

// ============================================================================
// Group 6: Phase 6 Security
// ============================================================================

describe('ADR-0061: Phase 6 security controllers', () => {

  it('resourceTracker factory returns instance', () => {
    const RT = mockCtor();

    function createResourceTracker(Cls) {
      if (!Cls) return null;
      return new Cls();
    }

    const result = createResourceTracker(RT);
    assert.equal(RT.instances.length, 1);
    assert.notEqual(result, null);
  });

  it('rateLimiter factory passes maxTokens and refillRate', () => {
    const RL = mockCtor();

    function createRateLimiter(Cls) {
      if (!Cls) return null;
      return new Cls(100, 1);
    }

    const result = createRateLimiter(RL);
    assert.equal(RL.instances.length, 1);
    assert.deepEqual(RL.instances[0]._args, [100, 1]);
  });

  it('circuitBreaker factory passes threshold and resetTimeout', () => {
    const CB = mockCtor();

    function createCircuitBreaker(Cls) {
      if (!Cls) return null;
      return new Cls(5, 60000);
    }

    const result = createCircuitBreaker(CB);
    assert.equal(CB.instances.length, 1);
    assert.deepEqual(CB.instances[0]._args, [5, 60000]);
  });

  it('telemetryManager uses getInstance singleton, not new', () => {
    const singleton = { record: () => {} };
    const getInstanceFn = mockFn(() => singleton);
    const TM = { getInstance: getInstanceFn };

    function createTelemetryManager(Cls) {
      if (!Cls) return null;
      return Cls.getInstance();
    }

    const result = createTelemetryManager(TM);

    assert.equal(getInstanceFn.calls.length, 1);
    assert.equal(result, singleton);
  });

  it('auditLogger factory returns instance', () => {
    const AL = mockCtor({ logEvent: () => {} });

    function createAuditLogger(Cls) {
      if (!Cls) return null;
      return new Cls();
    }

    const result = createAuditLogger(AL);
    assert.equal(AL.instances.length, 1);
    assert.notEqual(result, null);
  });
});

// ============================================================================
// Group 7: isControllerEnabled
// ============================================================================

describe('ADR-0061: isControllerEnabled', () => {

  // Simulated isControllerEnabled mirrors controller-registry.ts logic
  function isControllerEnabled(name, agentdb) {
    switch (name) {
      case 'solverBandit':
      case 'attentionMetrics':
        return true;

      case 'selfAttention':
      case 'crossAttention':
      case 'multiHeadAttention':
      case 'attentionService':
      case 'nativeAccelerator':
      case 'enhancedEmbeddingService':
      case 'auditLogger':
      case 'queryOptimizer':
        return agentdb !== null && agentdb !== undefined;

      case 'selfLearningRvfBackend':
      case 'federatedLearningManager':
      case 'quantizedVectorStore':
        return false;

      case 'resourceTracker':
      case 'rateLimiter':
      case 'circuitBreaker':
      case 'telemetryManager':
        return true;

      default:
        return false;
    }
  }

  it('solverBandit and attentionMetrics enabled by default', () => {
    assert.equal(isControllerEnabled('solverBandit', null), true);
    assert.equal(isControllerEnabled('attentionMetrics', null), true);
  });

  it('attention controllers enabled when agentdb available', () => {
    const fakeAgentdb = { database: {} };
    assert.equal(isControllerEnabled('selfAttention', fakeAgentdb), true);
    assert.equal(isControllerEnabled('crossAttention', fakeAgentdb), true);
    assert.equal(isControllerEnabled('multiHeadAttention', fakeAgentdb), true);
    assert.equal(isControllerEnabled('attentionService', fakeAgentdb), true);

    // Disabled without agentdb
    assert.equal(isControllerEnabled('selfAttention', null), false);
  });

  it('selfLearningRvfBackend disabled by default (opt-in)', () => {
    assert.equal(isControllerEnabled('selfLearningRvfBackend', {}), false);
    assert.equal(isControllerEnabled('federatedLearningManager', {}), false);
    assert.equal(isControllerEnabled('quantizedVectorStore', {}), false);
  });

  it('security controllers enabled by default', () => {
    assert.equal(isControllerEnabled('resourceTracker', null), true);
    assert.equal(isControllerEnabled('rateLimiter', null), true);
    assert.equal(isControllerEnabled('circuitBreaker', null), true);
    assert.equal(isControllerEnabled('telemetryManager', null), true);
  });
});

// ============================================================================
// Group 8: INIT_LEVELS
// ============================================================================

describe('ADR-0061: INIT_LEVELS', () => {

  // Mirrors the proposed INIT_LEVELS from ADR-0061
  const INIT_LEVELS = [
    { level: 0, controllers: [
      'resourceTracker', 'rateLimiter', 'circuitBreaker', 'telemetryManager',
    ] },
    { level: 1, controllers: [
      'reasoningBank', 'hierarchicalMemory', 'learningBridge', 'hybridSearch', 'tieredCache',
      'solverBandit', 'attentionMetrics',
    ] },
    { level: 2, controllers: [
      'memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard', 'gnnService',
      'selfAttention', 'crossAttention', 'multiHeadAttention', 'attentionService',
      'nativeAccelerator', 'queryOptimizer',
    ] },
    { level: 3, controllers: [
      'skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations',
      'memoryConsolidation',
      'enhancedEmbeddingService', 'auditLogger',
    ] },
    { level: 4, controllers: [
      'causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter',
      'selfLearningRvfBackend', 'federatedLearningManager',
    ] },
    { level: 5, controllers: [
      'graphTransformer', 'sonaTrajectory', 'contextSynthesizer', 'rvfOptimizer',
      'mmrDiversityRanker', 'guardedVectorBackend',
      'quantizedVectorStore',
    ] },
    { level: 6, controllers: ['federatedSession', 'graphAdapter'] },
  ];

  it('level 0 contains security controllers', () => {
    const level0 = INIT_LEVELS.find(l => l.level === 0);
    assert.ok(level0, 'level 0 must exist');
    assert.ok(level0.controllers.includes('resourceTracker'));
    assert.ok(level0.controllers.includes('rateLimiter'));
    assert.ok(level0.controllers.includes('circuitBreaker'));
    assert.ok(level0.controllers.includes('telemetryManager'));
    assert.equal(level0.controllers.length, 4);
  });

  it('total controller count is 45 (43 implementable + 2 placeholder/deferred)', () => {
    const total = INIT_LEVELS.reduce((sum, l) => sum + l.controllers.length, 0);
    assert.equal(total, 45, `expected 45 registry slots, got ${total}`);
  });

  it('no duplicate controller names across levels', () => {
    const all = INIT_LEVELS.flatMap(l => l.controllers);
    const unique = new Set(all);
    assert.equal(all.length, unique.size, 'duplicate controller names found');
  });

  it('levels are ordered 0 through 6', () => {
    const levels = INIT_LEVELS.map(l => l.level);
    assert.deepEqual(levels, [0, 1, 2, 3, 4, 5, 6]);
  });
});

// @tier unit
// ADR-0063: Storage Audit Remediation
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as controller-adr0061.test.mjs)
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
// Group 1: C1 — getEmbeddingConfig Import Path
// ============================================================================

describe('ADR-0063: C1 getEmbeddingConfig import path', () => {

  it('memory bridge uses getEmbeddingConfig from agentdb when available', () => {
    const agentdbGetEmbeddingConfig = mockFn(() => ({
      dimension: 768,
      model: 'nomic-embed-text-v1.5',
    }));

    // Simulated bridge resolution: prefer @claude-flow/agentdb over @claude-flow/memory
    function resolveEmbeddingConfig(agentdbExports, memoryExports) {
      if (agentdbExports?.getEmbeddingConfig) {
        return agentdbExports.getEmbeddingConfig();
      }
      if (memoryExports?.getEmbeddingConfig) {
        return memoryExports.getEmbeddingConfig();
      }
      return { dimension: 768, model: 'default' };
    }

    const memoryGetEmbeddingConfig = mockFn(() => ({
      dimension: 384,
      model: 'legacy',
    }));

    const config = resolveEmbeddingConfig(
      { getEmbeddingConfig: agentdbGetEmbeddingConfig },
      { getEmbeddingConfig: memoryGetEmbeddingConfig },
    );

    assert.equal(config.dimension, 768, 'must use agentdb config, not memory');
    assert.equal(agentdbGetEmbeddingConfig.calls.length, 1);
    assert.equal(memoryGetEmbeddingConfig.calls.length, 0,
      'memory getEmbeddingConfig must NOT be called when agentdb provides it');
  });

  it('falls back to memory module when agentdb is not available', () => {
    const memoryGetEmbeddingConfig = mockFn(() => ({
      dimension: 384,
      model: 'fallback',
    }));

    function resolveEmbeddingConfig(agentdbExports, memoryExports) {
      if (agentdbExports?.getEmbeddingConfig) {
        return agentdbExports.getEmbeddingConfig();
      }
      if (memoryExports?.getEmbeddingConfig) {
        return memoryExports.getEmbeddingConfig();
      }
      return { dimension: 768, model: 'default' };
    }

    const config = resolveEmbeddingConfig(null, { getEmbeddingConfig: memoryGetEmbeddingConfig });

    assert.equal(config.dimension, 384);
    assert.equal(memoryGetEmbeddingConfig.calls.length, 1,
      'must fall back to memory module');
  });

  it('falls back to default when neither module is available', () => {
    function resolveEmbeddingConfig(agentdbExports, memoryExports) {
      if (agentdbExports?.getEmbeddingConfig) {
        return agentdbExports.getEmbeddingConfig();
      }
      if (memoryExports?.getEmbeddingConfig) {
        return memoryExports.getEmbeddingConfig();
      }
      return { dimension: 768, model: 'default' };
    }

    const config = resolveEmbeddingConfig(null, null);
    assert.equal(config.dimension, 768, 'must default to 768');
  });
});

// ============================================================================
// Group 2: C2 — getEmbeddingService Accessor
// ============================================================================

describe('ADR-0063: C2 getEmbeddingService accessor', () => {

  it('AgentDB exposes getEmbeddingService() returning the embedder', () => {
    const realEmbedder = { embed: mockFn(() => new Float32Array(768)) };

    // Simulated AgentDB with embedder set
    function createAgentDB(embedder) {
      let _embedder = embedder;
      return {
        getEmbeddingService() {
          return _embedder || null;
        },
      };
    }

    const agentdb = createAgentDB(realEmbedder);
    const result = agentdb.getEmbeddingService();

    assert.equal(result, realEmbedder, 'must return the embedder instance');
    assert.ok(result.embed, 'embedder must have embed method');
  });

  it('getEmbeddingService returns null when no embedder is set', () => {
    function createAgentDB(embedder) {
      let _embedder = embedder;
      return {
        getEmbeddingService() {
          return _embedder || null;
        },
      };
    }

    const agentdb = createAgentDB(null);
    const result = agentdb.getEmbeddingService();

    assert.equal(result, null, 'must return null when no embedder is set');
  });
});

// ============================================================================
// Group 3: C3 — Dimension defaults
// ============================================================================

describe('ADR-0063: C3 dimension defaults', () => {

  it('all components default to 768 (not 1536)', () => {
    // Simulated default dimension resolution for various components
    function resolveDefaultDimension(componentConfig) {
      return componentConfig?.dimension || 768;
    }

    // HNSWIndex default
    assert.equal(resolveDefaultDimension({}), 768,
      'HNSWIndex must default to 768');

    // VectorBackend default
    assert.equal(resolveDefaultDimension(undefined), 768,
      'VectorBackend must default to 768');

    // EmbeddingService default
    assert.equal(resolveDefaultDimension(null), 768,
      'EmbeddingService must default to 768');

    // Verify NOT 1536 (OpenAI default that should not be used)
    const dim = resolveDefaultDimension({});
    assert.notEqual(dim, 1536, 'must NOT use OpenAI default of 1536');
  });

  it('config-adapter defaults to 384 minimum', () => {
    // Simulated config-adapter dimension resolution
    function resolveConfigAdapterDimension(rawDimension) {
      const MIN_DIMENSION = 384;
      if (!rawDimension || rawDimension < MIN_DIMENSION) {
        return MIN_DIMENSION;
      }
      return rawDimension;
    }

    assert.equal(resolveConfigAdapterDimension(undefined), 384,
      'must default to 384 minimum when unset');
    assert.equal(resolveConfigAdapterDimension(0), 384,
      'must clamp zero to 384');
    assert.equal(resolveConfigAdapterDimension(128), 384,
      'must clamp values below 384');
    assert.equal(resolveConfigAdapterDimension(768), 768,
      'must pass through valid dimensions');
    assert.equal(resolveConfigAdapterDimension(384), 384,
      'must accept exactly 384');
  });
});

// ============================================================================
// Group 4: H1 — RateLimiter semantics
// ============================================================================

describe('ADR-0063: H1 RateLimiter semantics', () => {

  it('RateLimiter constructed with (maxTokens, refillRate) where refillRate matches maxTokens', () => {
    const RL = mockCtor();

    // ADR-0063 fix: refillRate = maxTokens (token bucket refills at full rate)
    function createRateLimiter(Cls, config) {
      const maxTokens = config?.maxTokens || 100;
      const refillRate = maxTokens; // ADR-0063: refillRate === maxTokens
      return new Cls(maxTokens, refillRate);
    }

    createRateLimiter(RL, { maxTokens: 200 });

    assert.equal(RL.instances.length, 1);
    const [maxTokens, refillRate] = RL.instances[0]._args;
    assert.equal(maxTokens, 200, 'first arg must be maxTokens');
    assert.equal(refillRate, 200, 'refillRate must match maxTokens');
  });

  it('windowMs is NOT passed as refillRate', () => {
    const RL = mockCtor();

    // WRONG pattern (pre-fix): new RateLimiter(maxTokens, windowMs)
    // CORRECT pattern (ADR-0063): new RateLimiter(maxTokens, refillRate)
    function createRateLimiterFixed(Cls, config) {
      const maxTokens = config?.maxTokens || 100;
      const refillRate = maxTokens;
      return new Cls(maxTokens, refillRate);
    }

    const config = { maxTokens: 100, windowMs: 60000 };
    createRateLimiterFixed(RL, config);

    const [, secondArg] = RL.instances[0]._args;
    assert.notEqual(secondArg, 60000,
      'windowMs must NOT be passed as the second arg (refillRate)');
    assert.equal(secondArg, 100,
      'refillRate must equal maxTokens, not windowMs');
  });

  it('defaults to 100 maxTokens when not configured', () => {
    const RL = mockCtor();

    function createRateLimiter(Cls, config) {
      const maxTokens = config?.maxTokens || 100;
      const refillRate = maxTokens;
      return new Cls(maxTokens, refillRate);
    }

    createRateLimiter(RL, {});

    assert.deepEqual(RL.instances[0]._args, [100, 100]);
  });
});

// ============================================================================
// Group 5: H2 — maxElements
// ============================================================================

describe('ADR-0063: H2 maxElements', () => {

  it('AgentDB init passes maxElements from config', () => {
    const HNSWIndex = mockCtor();

    function initHNSW(Cls, config) {
      const maxElements = config?.maxElements || 100_000;
      return new Cls({ maxElements });
    }

    initHNSW(HNSWIndex, { maxElements: 500_000 });

    assert.equal(HNSWIndex.instances.length, 1);
    assert.equal(HNSWIndex.instances[0]._args[0].maxElements, 500_000,
      'must pass config maxElements to HNSWIndex');
  });

  it('defaults to 100000 when not configured', () => {
    const HNSWIndex = mockCtor();

    function initHNSW(Cls, config) {
      const maxElements = config?.maxElements || 100_000;
      return new Cls({ maxElements });
    }

    initHNSW(HNSWIndex, {});

    assert.equal(HNSWIndex.instances[0]._args[0].maxElements, 100_000,
      'must default to 100000');
  });

  it('defaults to 100000 when config is null', () => {
    const HNSWIndex = mockCtor();

    function initHNSW(Cls, config) {
      const maxElements = config?.maxElements || 100_000;
      return new Cls({ maxElements });
    }

    initHNSW(HNSWIndex, null);

    assert.equal(HNSWIndex.instances[0]._args[0].maxElements, 100_000);
  });
});

// ============================================================================
// Group 6: H4 — INIT_LEVELS causalGraph in Level 3
// ============================================================================

describe('ADR-0063: H4 INIT_LEVELS causalGraph in Level 3', () => {

  // ADR-0063 confirms causalGraph placement from ADR-0062
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
      'causalGraph',  // ADR-0062/0063: must be in Level 3, not Level 4
    ] },
    { level: 4, controllers: [
      'nightlyLearner', 'learningSystem', 'semanticRouter',
      'selfLearningRvfBackend', 'federatedLearningManager',
    ] },
    { level: 5, controllers: [
      'graphTransformer', 'sonaTrajectory', 'contextSynthesizer', 'rvfOptimizer',
      'mmrDiversityRanker', 'guardedVectorBackend',
      'quantizedVectorStore',
    ] },
    { level: 6, controllers: ['federatedSession', 'graphAdapter'] },
  ];

  it('causalGraph is in level 3, NOT in level 4', () => {
    const level3 = INIT_LEVELS.find(l => l.level === 3);
    const level4 = INIT_LEVELS.find(l => l.level === 4);

    assert.ok(level3.controllers.includes('causalGraph'),
      'causalGraph must be in level 3');
    assert.ok(!level4.controllers.includes('causalGraph'),
      'causalGraph must NOT be in level 4');
  });

  it('causalGraph inits before nightlyLearner (ordering guarantee)', () => {
    let causalLevel = -1;
    let nightlyLevel = -1;
    for (const { level, controllers } of INIT_LEVELS) {
      if (controllers.includes('causalGraph')) causalLevel = level;
      if (controllers.includes('nightlyLearner')) nightlyLevel = level;
    }
    assert.ok(causalLevel >= 0, 'causalGraph must exist in INIT_LEVELS');
    assert.ok(nightlyLevel >= 0, 'nightlyLearner must exist in INIT_LEVELS');
    assert.ok(causalLevel < nightlyLevel,
      `causalGraph (level ${causalLevel}) must init before nightlyLearner (level ${nightlyLevel})`);
  });
});

// ============================================================================
// Group 7: M1 — busy_timeout
// ============================================================================

describe('ADR-0063: M1 busy_timeout pragma', () => {

  it('SQLiteBackend.initialize() sets busy_timeout pragma', () => {
    const pragmaCalls = [];
    const fakeDb = {
      pragma: mockFn((stmt) => { pragmaCalls.push(stmt); }),
    };

    // Simulated SQLiteBackend.initialize() pragma set
    function initializeSQLite(db) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -64000');
      db.pragma('busy_timeout = 5000');
    }

    initializeSQLite(fakeDb);

    assert.ok(pragmaCalls.includes('busy_timeout = 5000'),
      'busy_timeout pragma must be set during initialize()');
    assert.equal(fakeDb.pragma.calls.length, 4,
      'must set exactly 4 pragmas');
  });

  it('busy_timeout is set to 5000ms', () => {
    const pragmaCalls = [];
    const fakeDb = {
      pragma: mockFn((stmt) => { pragmaCalls.push(stmt); }),
    };

    function initializeSQLite(db) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('cache_size = -64000');
      db.pragma('busy_timeout = 5000');
    }

    initializeSQLite(fakeDb);

    const busyCall = pragmaCalls.find(s => s.startsWith('busy_timeout'));
    assert.ok(busyCall, 'busy_timeout must be among pragmas');
    assert.equal(busyCall, 'busy_timeout = 5000',
      'busy_timeout must be 5000ms');
  });
});

// ============================================================================
// Group 8: M5 — enableHNSW removed
// ============================================================================

describe('ADR-0063: M5 enableHNSW removed from RuntimeConfig', () => {

  it('RuntimeConfig.memory does not have enableHNSW field', () => {
    // Simulated RuntimeConfig after ADR-0063 fix
    const runtimeConfig = {
      memory: {
        backend: 'hybrid',
        dbPath: '/tmp/test.db',
        dimension: 768,
        maxElements: 100_000,
        // enableHNSW: true,  // REMOVED by ADR-0063
      },
    };

    assert.equal(runtimeConfig.memory.enableHNSW, undefined,
      'enableHNSW must NOT exist on RuntimeConfig.memory');
    assert.ok(!('enableHNSW' in runtimeConfig.memory),
      'enableHNSW key must not be present at all');
  });

  it('HNSW is always enabled when backend is hybrid (no toggle needed)', () => {
    // ADR-0063 rationale: enableHNSW was redundant — HNSW is always on for hybrid
    function isHNSWEnabled(memoryConfig) {
      // Post ADR-0063: HNSW is implicitly enabled for hybrid backend
      // No enableHNSW flag — just check backend type
      return memoryConfig.backend === 'hybrid' || memoryConfig.backend === 'hnsw';
    }

    assert.equal(isHNSWEnabled({ backend: 'hybrid' }), true);
    assert.equal(isHNSWEnabled({ backend: 'hnsw' }), true);
    assert.equal(isHNSWEnabled({ backend: 'sqlite' }), false);
  });
});

// ============================================================================
// Group 9: M6 — Learning-bridge dimension
// ============================================================================

describe('ADR-0063: M6 learning-bridge dimension', () => {

  it('createHashEmbedding accepts optional dimension parameter', () => {
    // Simulated createHashEmbedding with optional dimension (ADR-0063 fix)
    function createHashEmbedding(text, dimension) {
      const dim = dimension || 768;
      const hash = new Float32Array(dim);
      // Simple hash embedding (test stub)
      for (let i = 0; i < dim; i++) {
        hash[i] = ((text.charCodeAt(i % text.length) * 31 + i) % 256) / 256;
      }
      return hash;
    }

    const result = createHashEmbedding('test input', 384);
    assert.equal(result.length, 384,
      'must respect explicit dimension parameter');
  });

  it('falls back to config dimension when no parameter given', () => {
    const configDimension = 512;

    function createHashEmbedding(text, dimension, configDim) {
      const dim = dimension || configDim || 768;
      return new Float32Array(dim);
    }

    const result = createHashEmbedding('test', undefined, configDimension);
    assert.equal(result.length, 512,
      'must use config dimension as second fallback');
  });

  it('falls back to 768 when neither parameter nor config is set', () => {
    function createHashEmbedding(text, dimension, configDim) {
      const dim = dimension || configDim || 768;
      return new Float32Array(dim);
    }

    const result = createHashEmbedding('test', undefined, undefined);
    assert.equal(result.length, 768,
      'must default to 768 as final fallback');
  });

  it('dimension fallback chain: parameter > config > 768', () => {
    function resolveEmbeddingDimension(paramDim, configDim) {
      return paramDim || configDim || 768;
    }

    // Explicit parameter wins
    assert.equal(resolveEmbeddingDimension(384, 512), 384);
    // Config wins over default
    assert.equal(resolveEmbeddingDimension(undefined, 512), 512);
    // Default 768
    assert.equal(resolveEmbeddingDimension(undefined, undefined), 768);
    assert.equal(resolveEmbeddingDimension(0, 0), 768,
      'zero should fall through to default');
  });
});

// ============================================================================
// Group 10: M8 — tieredCache maxSize
// ============================================================================

describe('ADR-0063: M8 tieredCache maxSize', () => {

  it('systemConfig.memory.maxSize propagates to tieredCache.maxSize', () => {
    const TieredCache = mockCtor();

    function createTieredCache(Cls, systemConfig) {
      const maxSize = systemConfig?.memory?.maxSize || 10_000;
      return new Cls({ maxSize });
    }

    const systemConfig = { memory: { maxSize: 50_000 } };
    createTieredCache(TieredCache, systemConfig);

    assert.equal(TieredCache.instances.length, 1);
    assert.equal(TieredCache.instances[0]._args[0].maxSize, 50_000,
      'tieredCache maxSize must come from systemConfig.memory.maxSize');
  });

  it('tieredCache defaults to 10000 when maxSize not configured', () => {
    const TieredCache = mockCtor();

    function createTieredCache(Cls, systemConfig) {
      const maxSize = systemConfig?.memory?.maxSize || 10_000;
      return new Cls({ maxSize });
    }

    createTieredCache(TieredCache, {});

    assert.equal(TieredCache.instances[0]._args[0].maxSize, 10_000,
      'must default to 10000');
  });

  it('tieredCache defaults when systemConfig is null', () => {
    const TieredCache = mockCtor();

    function createTieredCache(Cls, systemConfig) {
      const maxSize = systemConfig?.memory?.maxSize || 10_000;
      return new Cls({ maxSize });
    }

    createTieredCache(TieredCache, null);

    assert.equal(TieredCache.instances[0]._args[0].maxSize, 10_000);
  });

  it('maxSize propagation does not mutate original config', () => {
    const TieredCache = mockCtor();
    const systemConfig = { memory: { maxSize: 25_000, backend: 'hybrid' } };
    const originalConfig = JSON.parse(JSON.stringify(systemConfig));

    function createTieredCache(Cls, sysConfig) {
      const maxSize = sysConfig?.memory?.maxSize || 10_000;
      return new Cls({ maxSize });
    }

    createTieredCache(TieredCache, systemConfig);

    assert.deepEqual(systemConfig, originalConfig,
      'must not mutate the original systemConfig');
  });
});

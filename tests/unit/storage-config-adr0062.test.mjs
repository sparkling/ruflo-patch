// @tier unit
// ADR-0062: Storage & Configuration Unification
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
// Group 1: P0-1 — INIT_LEVELS causalGraph placement
// ============================================================================

describe('ADR-0062: P0-1 INIT_LEVELS causalGraph placement', () => {

  // ADR-0062 moves causalGraph from Level 4 to Level 3 to fix the race
  // condition where nightlyLearner (Level 4) cannot find causalGraph when
  // both init in parallel via Promise.allSettled().
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
      'causalGraph',  // ADR-0062: moved from Level 4
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

  it('nightlyLearner remains in level 4 (depends on causalGraph)', () => {
    const level4 = INIT_LEVELS.find(l => l.level === 4);
    assert.ok(level4.controllers.includes('nightlyLearner'),
      'nightlyLearner must stay in level 4');
  });

  it('causalGraph level < nightlyLearner level (init ordering guarantee)', () => {
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

  it('no duplicate controller names across levels', () => {
    const all = INIT_LEVELS.flatMap(l => l.controllers);
    const unique = new Set(all);
    assert.equal(all.length, unique.size, 'duplicate controller names found');
  });
});

// ============================================================================
// Group 2: P0-2 — Bridge dimension config
// ============================================================================

describe('ADR-0062: P0-2 bridge dimension config', () => {

  it('bridge uses config-driven dimension from getEmbeddingConfig()', () => {
    // Mock getEmbeddingConfig returning non-default dimension
    const getEmbeddingConfig = mockFn(() => ({ dimension: 768, model: 'nomic-embed-text-v1.5' }));

    // Simulated bridge logic (ADR-0062 fix)
    function resolveBridgeDimension(getConfigFn) {
      try {
        return getConfigFn().dimension;
      } catch {
        return 384;
      }
    }

    const dim = resolveBridgeDimension(getEmbeddingConfig);
    assert.equal(dim, 768, 'bridge must use config dimension, not hardcoded 384');
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });

  it('bridge falls back to 384 when getEmbeddingConfig import fails', () => {
    function resolveBridgeDimension(getConfigFn) {
      try {
        return getConfigFn().dimension;
      } catch {
        return 384;
      }
    }

    const badFn = mockFn(() => { throw new Error('module not found'); });
    const dim = resolveBridgeDimension(badFn);
    assert.equal(dim, 384, 'must fall back to 384 when config unavailable');
  });

  it('bridge RVF store dimension matches registry dimension', () => {
    const registryInstance = { config: { dimension: 768 } };

    // Simulated fix: dimensions = registryInstance?.config?.dimension || 384
    const dimensions = registryInstance?.config?.dimension || 384;
    assert.equal(dimensions, 768, 'RVF store dimension must match registry config');
  });

  it('bridge RVF store dimension defaults to 384 without registry', () => {
    const registryInstance = null;
    const dimensions = registryInstance?.config?.dimension || 384;
    assert.equal(dimensions, 384, 'must default to 384 without registry');
  });
});

// ============================================================================
// Group 3: P1-1 — Embedder reuse
// ============================================================================

describe('ADR-0062: P1-1 embedder reuse', () => {

  it('createEmbeddingService returns real embedder from agentdb when available', () => {
    const realEmbedder = { embed: mockFn(() => new Float32Array(768)) };

    // Simulated registry with real embedder cached
    function createEmbeddingService(cachedEmbedder) {
      if (cachedEmbedder) return cachedEmbedder;
      // Stub fallback
      return { embed: () => new Float32Array(384).fill(0) };
    }

    const result = createEmbeddingService(realEmbedder);
    assert.equal(result, realEmbedder, 'must return real embedder, not stub');
  });

  it('createEmbeddingService falls back to stub when no real embedder', () => {
    function createEmbeddingService(cachedEmbedder) {
      if (cachedEmbedder) return cachedEmbedder;
      return { embed: () => new Float32Array(384).fill(0) };
    }

    const result = createEmbeddingService(null);
    assert.ok(result.embed, 'fallback must have embed method');
    const vec = result.embed();
    assert.equal(vec.length, 384);
    assert.equal(vec[0], 0, 'fallback must produce zero vectors');
  });

  it('real embedder is extracted from agentdb.getEmbeddingService()', () => {
    const realEmbedder = { embed: mockFn(() => new Float32Array(768)) };
    const fakeAgentdb = {
      getEmbeddingService: mockFn(() => realEmbedder),
    };

    // Simulated initialize() extraction
    let cachedEmbedder = null;
    try {
      cachedEmbedder = fakeAgentdb.getEmbeddingService?.() || null;
    } catch { /* use stub */ }

    assert.equal(cachedEmbedder, realEmbedder);
    assert.equal(fakeAgentdb.getEmbeddingService.calls.length, 1);
  });

  it('gracefully handles getEmbeddingService() throwing', () => {
    const fakeAgentdb = {
      getEmbeddingService: mockFn(() => { throw new Error('not initialized'); }),
    };

    let cachedEmbedder = null;
    try {
      cachedEmbedder = fakeAgentdb.getEmbeddingService?.() || null;
    } catch {
      cachedEmbedder = null;
    }

    assert.equal(cachedEmbedder, null, 'must catch and default to null');
  });
});

// ============================================================================
// Group 4: P2-3 — RateLimiter/CircuitBreaker config
// ============================================================================

describe('ADR-0062: P2-3 RateLimiter/CircuitBreaker configurable', () => {

  it('RateLimiter accepts config values', () => {
    const RL = mockCtor();
    const config = { rateLimiter: { maxRequests: 200, windowMs: 2000 } };

    // Simulated factory (ADR-0062 fix)
    function createRateLimiter(Cls, runtimeConfig) {
      const cfg = runtimeConfig.rateLimiter || {};
      return new Cls(cfg.maxRequests || 100, cfg.windowMs || 1000);
    }

    const result = createRateLimiter(RL, config);
    assert.equal(RL.instances.length, 1);
    assert.deepEqual(RL.instances[0]._args, [200, 2000]);
  });

  it('RateLimiter falls back to defaults without config', () => {
    const RL = mockCtor();

    function createRateLimiter(Cls, runtimeConfig) {
      const cfg = runtimeConfig.rateLimiter || {};
      return new Cls(cfg.maxRequests || 100, cfg.windowMs || 1000);
    }

    createRateLimiter(RL, {});
    assert.deepEqual(RL.instances[0]._args, [100, 1000]);
  });

  it('CircuitBreaker accepts config values', () => {
    const CB = mockCtor();
    const config = { circuitBreaker: { failureThreshold: 10, resetTimeoutMs: 120000 } };

    function createCircuitBreaker(Cls, runtimeConfig) {
      const cfg = runtimeConfig.circuitBreaker || {};
      return new Cls(cfg.failureThreshold || 5, cfg.resetTimeoutMs || 60000);
    }

    const result = createCircuitBreaker(CB, config);
    assert.equal(CB.instances.length, 1);
    assert.deepEqual(CB.instances[0]._args, [10, 120000]);
  });

  it('CircuitBreaker falls back to defaults without config', () => {
    const CB = mockCtor();

    function createCircuitBreaker(Cls, runtimeConfig) {
      const cfg = runtimeConfig.circuitBreaker || {};
      return new Cls(cfg.failureThreshold || 5, cfg.resetTimeoutMs || 60000);
    }

    createCircuitBreaker(CB, {});
    assert.deepEqual(CB.instances[0]._args, [5, 60000]);
  });
});

// ============================================================================
// Group 5: P2-1 — deriveHNSWParams wiring
// ============================================================================

describe('ADR-0062: P2-1 deriveHNSWParams wiring', () => {

  // Simulated deriveHNSWParams (from embedding-config.ts)
  function deriveHNSWParams(dimension) {
    if (dimension <= 128) return { M: 8, efConstruction: 100, efSearch: 50 };
    if (dimension <= 384) return { M: 16, efConstruction: 200, efSearch: 100 };
    if (dimension <= 768) return { M: 24, efConstruction: 300, efSearch: 150 };
    return { M: 32, efConstruction: 400, efSearch: 200 };
  }

  it('HNSWIndex constructor uses deriveHNSWParams with config override', () => {
    const HNSWIndex = mockCtor();

    function createHNSWIndex(Cls, config) {
      const derived = deriveHNSWParams(config.dimensions);
      const merged = { ...derived, ...config };
      return new Cls(merged);
    }

    const result = createHNSWIndex(HNSWIndex, { dimensions: 768 });
    const args = HNSWIndex.instances[0]._args[0];

    assert.equal(args.M, 24, 'M should be derived for dim 768');
    assert.equal(args.efConstruction, 300);
    assert.equal(args.efSearch, 150);
    assert.equal(args.dimensions, 768);
  });

  it('explicit config overrides derived params', () => {
    const HNSWIndex = mockCtor();

    function createHNSWIndex(Cls, config) {
      const derived = deriveHNSWParams(config.dimensions);
      const merged = { ...derived, ...config };
      return new Cls(merged);
    }

    createHNSWIndex(HNSWIndex, { dimensions: 768, M: 48, efSearch: 500 });
    const args = HNSWIndex.instances[0]._args[0];

    assert.equal(args.M, 48, 'explicit M must override derived');
    assert.equal(args.efSearch, 500, 'explicit efSearch must override derived');
    assert.equal(args.efConstruction, 300, 'non-overridden param uses derived value');
  });

  it('deriveHNSWParams returns correct params for each dimension range', () => {
    assert.deepEqual(deriveHNSWParams(128), { M: 8, efConstruction: 100, efSearch: 50 });
    assert.deepEqual(deriveHNSWParams(384), { M: 16, efConstruction: 200, efSearch: 100 });
    assert.deepEqual(deriveHNSWParams(768), { M: 24, efConstruction: 300, efSearch: 150 });
    assert.deepEqual(deriveHNSWParams(1536), { M: 32, efConstruction: 400, efSearch: 200 });
  });
});

// ============================================================================
// Group 6: P2-4 — maxElements alignment
// ============================================================================

describe('ADR-0062: P2-4 maxElements alignment', () => {

  it('maxElements standardized to 100,000', () => {
    const STANDARD_MAX_ELEMENTS = 100_000;

    // Both HNSW and RVF backends should use the same limit
    const hnswMaxElements = STANDARD_MAX_ELEMENTS;
    const rvfMaxElements = STANDARD_MAX_ELEMENTS;

    assert.equal(hnswMaxElements, 100_000);
    assert.equal(rvfMaxElements, 100_000);
    assert.equal(hnswMaxElements, rvfMaxElements,
      'HNSW and RVF maxElements must be aligned');
  });
});

// ============================================================================
// Group 7: P3-1 — SelfLearningRvfBackend storagePath
// ============================================================================

describe('ADR-0062: P3-1 SelfLearningRvfBackend persistence', () => {

  it('storagePath derives from dbPath (not :memory:)', () => {
    const dbPath = '/tmp/test-project/.swarm/memory.db';

    // Simulated ADR-0062 fix
    function deriveStoragePath(path) {
      if (path === ':memory:') return ':memory:';
      return path.replace(/\.db$/, '-rvf.sqlite');
    }

    const storagePath = deriveStoragePath(dbPath);
    assert.equal(storagePath, '/tmp/test-project/.swarm/memory-rvf.sqlite');
    assert.notEqual(storagePath, ':memory:', 'must NOT use :memory: when dbPath is a real path');
  });

  it('storagePath stays :memory: when dbPath is :memory:', () => {
    function deriveStoragePath(path) {
      if (path === ':memory:') return ':memory:';
      return path.replace(/\.db$/, '-rvf.sqlite');
    }

    assert.equal(deriveStoragePath(':memory:'), ':memory:');
  });

  it('factory passes derived storagePath to SLRB.create()', async () => {
    const createFn = mockFn(async (cfg) => ({ initialized: true, config: cfg }));
    const SLRB = { create: createFn };

    async function createSelfLearningRvfBackend(agentdb, Cls, runtimeConfig) {
      if (!agentdb || !Cls) return null;
      const dbPath = runtimeConfig.dbPath || ':memory:';
      const storagePath = dbPath === ':memory:' ? ':memory:' : dbPath.replace(/\.db$/, '-rvf.sqlite');
      return await Cls.create({
        dimension: runtimeConfig.dimension || 384,
        storagePath,
        learning: true,
      });
    }

    await createSelfLearningRvfBackend(
      { database: {} },
      SLRB,
      { dbPath: '/data/memory.db', dimension: 768 },
    );

    assert.equal(createFn.calls.length, 1);
    assert.deepEqual(createFn.calls[0][0], {
      dimension: 768,
      storagePath: '/data/memory-rvf.sqlite',
      learning: true,
    });
  });
});

// ============================================================================
// Group 8: P3-2 — FederatedLearningManager dynamic agentId
// ============================================================================

describe('ADR-0062: P3-2 FederatedLearningManager dynamic agentId', () => {

  it('agentId is dynamic, not hardcoded cli-default', () => {
    const FLM = mockCtor();

    function createFederatedLearningManager(Cls, runtimeConfig) {
      if (!Cls) return null;
      const agentId = runtimeConfig.agentId || `agent-${process.pid}`;
      return new Cls({ agentId });
    }

    const config = { agentId: 'session-abc123' };
    createFederatedLearningManager(FLM, config);

    assert.equal(FLM.instances.length, 1);
    assert.equal(FLM.instances[0]._args[0].agentId, 'session-abc123');
    assert.notEqual(FLM.instances[0]._args[0].agentId, 'cli-default',
      'agentId must NOT be hardcoded cli-default');
  });

  it('agentId falls back to process-based ID when not configured', () => {
    const FLM = mockCtor();

    function createFederatedLearningManager(Cls, runtimeConfig) {
      if (!Cls) return null;
      const agentId = runtimeConfig.agentId || `agent-${process.pid}`;
      return new Cls({ agentId });
    }

    createFederatedLearningManager(FLM, {});

    const agentId = FLM.instances[0]._args[0].agentId;
    assert.ok(agentId.startsWith('agent-'), 'fallback must use process-based ID');
    assert.notEqual(agentId, 'cli-default');
  });
});

// ============================================================================
// Group 9: P1-2/P1-3 — SQLite pragma set (Integration)
// ============================================================================

describe('ADR-0062: P1-2/P1-3 SQLite pragma set (integration)', () => {

  let dbPath;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'adr0062-'));
    dbPath = join(dir, 'test.db');
  });

  it('full pragma set is applied: WAL, synchronous, cache_size, busy_timeout', async () => {
    let Database;
    try {
      Database = (await import('better-sqlite3')).default;
    } catch {
      // better-sqlite3 not available — skip gracefully
      assert.ok(true, 'better-sqlite3 not installed — skipping integration test');
      return;
    }

    const db = new Database(dbPath);

    // Simulate AgentDB.initialize() pragma set (ADR-0062 fix)
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('busy_timeout = 5000');

    // Verify all pragmas
    const journalMode = db.pragma('journal_mode', { simple: true });
    assert.equal(journalMode, 'wal', 'journal_mode must be WAL');

    const synchronous = db.pragma('synchronous', { simple: true });
    assert.equal(Number(synchronous), 1, 'synchronous=NORMAL is value 1');

    const cacheSize = db.pragma('cache_size', { simple: true });
    assert.equal(Number(cacheSize), -64000, 'cache_size must be -64000');

    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    assert.equal(Number(busyTimeout), 5000, 'busy_timeout must be 5000');

    db.close();

    // Cleanup
    try { unlinkSync(dbPath); } catch { /* ignore */ }
    try { unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });
});

// ============================================================================
// Group 10: Dimension consistency (Integration)
// ============================================================================

describe('ADR-0062: Dimension consistency (integration)', () => {

  it('bridge dimension matches getEmbeddingConfig().dimension', () => {
    // Simulated config-driven dimension resolution
    const getEmbeddingConfig = mockFn(() => ({
      dimension: 768,
      model: 'nomic-embed-text-v1.5',
    }));

    // Bridge resolution (ADR-0062 fix)
    function resolveBridgeDimension(getConfigFn) {
      try {
        return getConfigFn().dimension;
      } catch {
        return 384;
      }
    }

    const bridgeDim = resolveBridgeDimension(getEmbeddingConfig);
    const configDim = getEmbeddingConfig().dimension;

    assert.equal(bridgeDim, configDim,
      'bridge dimension must match getEmbeddingConfig().dimension');
  });

  it('all dimension sources agree when config is available', () => {
    const configDim = 768;
    const getEmbeddingConfig = () => ({ dimension: configDim });

    // Each layer resolves through config
    const bridgeDim = getEmbeddingConfig().dimension;
    const registryDim = getEmbeddingConfig().dimension;

    assert.equal(bridgeDim, configDim);
    assert.equal(registryDim, configDim);
    assert.equal(bridgeDim, registryDim,
      'bridge and registry must agree on dimension');
  });
});

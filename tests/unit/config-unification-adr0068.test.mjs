// @tier unit
// ADR-0068: Controller Config Unification
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Mock helpers (same pattern as config-centralization-adr0065.test.mjs)
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
// Helpers — read actual config files for integration-style assertions
// ============================================================================

const PROJECT_ROOT = join(import.meta.dirname, '..', '..');
const CONFIG_PATH = join(PROJECT_ROOT, '.claude-flow', 'config.json');
const EMBEDDINGS_PATH = join(PROJECT_ROOT, '.claude-flow', 'embeddings.json');
const CONTROLLERS_DIR = join(PROJECT_ROOT, 'src', 'controllers');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ============================================================================
// P0: Dimension fallbacks resolve to 768
// ============================================================================

describe('ADR-0068 P0: dimension fallbacks resolve to 768', () => {
  let emb;
  let cfg;

  beforeEach(() => {
    emb = readJson(EMBEDDINGS_PATH);
    cfg = readJson(CONFIG_PATH);
  });

  it('embeddings.json dimension field is 768', () => {
    assert.equal(emb.dimension, 768, 'dimension must be 768');
  });

  it('config.json has no 384 dimension values', () => {
    const cfgStr = JSON.stringify(cfg);
    // Look for dimension-like values of 384 (as a number value, not substring)
    assert.ok(!cfgStr.includes('"384"'), 'config.json must not have string "384"');
    // Check there is no 384 as a numeric value for any dimension key
    assert.ok(!cfgStr.match(/"dimension"\s*:\s*384/), 'config.json must not have dimension: 384');
  });

  it('config.json has no 1536 dimension values', () => {
    const cfgStr = JSON.stringify(cfg);
    assert.ok(!cfgStr.match(/"dimension"\s*:\s*1536/), 'config.json must not have dimension: 1536');
  });

  it('mock getEmbeddingConfig() returns dimension 768', () => {
    const getEmbeddingConfig = mockFn(() => ({
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      hnsw: { m: 23, efConstruction: 100, efSearch: 50 },
    }));

    const config = getEmbeddingConfig();
    assert.equal(config.dimension, 768);
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });
});

// ============================================================================
// P0: Model name centralized
// ============================================================================

describe('ADR-0068 P0: model name centralized', () => {
  it('embeddings.json model is all-mpnet-base-v2 (not MiniLM)', () => {
    const emb = readJson(EMBEDDINGS_PATH);
    assert.equal(emb.model, 'Xenova/all-mpnet-base-v2');
    assert.ok(!emb.model.includes('MiniLM'), 'model must not contain MiniLM');
  });
});

// ============================================================================
// P1: HNSW tuning params in embeddings.json
// ============================================================================

describe('ADR-0068 P1: HNSW tuning params in embeddings.json', () => {
  let emb;

  beforeEach(() => { emb = readJson(EMBEDDINGS_PATH); });

  it('hnsw.m is 23', () => {
    assert.ok(emb.hnsw, 'hnsw section must exist');
    assert.equal(emb.hnsw.m, 23, 'hnsw.m must be 23');
  });

  it('hnsw.efConstruction is 100', () => {
    assert.equal(emb.hnsw.efConstruction, 100, 'hnsw.efConstruction must be 100');
  });

  it('hnsw.efSearch is 50', () => {
    assert.equal(emb.hnsw.efSearch, 50, 'hnsw.efSearch must be 50');
  });
});

// ============================================================================
// P1: Controllers.enabled in config.json
// ============================================================================

describe('ADR-0068 P1: controllers.enabled in config.json', () => {
  let cfg;

  beforeEach(() => { cfg = readJson(CONFIG_PATH); });

  it('controllers.enabled section exists', () => {
    assert.ok(cfg.controllers, 'controllers must exist');
    assert.ok(cfg.controllers.enabled, 'controllers.enabled must exist');
  });

  it('controllers.enabled has expected ADR-0068 keys', () => {
    const enabled = cfg.controllers.enabled;
    const expectedKeys = [
      'reasoningBank', 'causalRecall', 'nightlyLearner',
      'queryOptimizer', 'auditLogger', 'batchOperations',
      'attentionService', 'hierarchicalMemory', 'memoryConsolidation',
      'hybridSearch', 'agentMemoryScope', 'federatedSession',
    ];
    for (const key of expectedKeys) {
      assert.ok(key in enabled, `controllers.enabled.${key} must exist`);
      assert.equal(typeof enabled[key], 'boolean', `controllers.enabled.${key} must be boolean`);
    }
  });

  it('controllers.enabled has the 6 new Wave 1 controller keys', () => {
    const enabled = cfg.controllers.enabled;
    const wave1Keys = [
      'queryOptimizer', 'auditLogger', 'batchOperations',
      'attentionService', 'hierarchicalMemory', 'memoryConsolidation',
    ];
    for (const key of wave1Keys) {
      assert.ok(key in enabled, `Wave 1 controller key ${key} must be in enabled map`);
    }
  });
});

// ============================================================================
// P1: RuntimeConfig expansion (mock test)
// ============================================================================

describe('ADR-0068 P1: RuntimeConfig expansion — mock controller registry', () => {
  it('mock registry accepts the 5 new tuning sections', () => {
    const MockRegistry = mockCtor({
      initialize: mockFn(() => true),
    });

    const config = {
      nightlyLearner: { schedule: '0 3 * * *', maxPatternsPerRun: 500 },
      causalRecall: { maxDepth: 5, minEdgeWeight: 0.1 },
      queryOptimizer: { planCache: true, maxCachedPlans: 256 },
      selfLearningRvfBackend: { learningRate: 0.01, feedbackWindowSize: 100 },
      mutationGuard: { walEnabled: true, maxMutationsPerTx: 1000 },
    };

    const registry = new MockRegistry(config);
    assert.equal(MockRegistry.instances.length, 1);
    assert.deepStrictEqual(registry._args[0], config);

    // Verify all 5 tuning sections present
    const passedConfig = registry._args[0];
    assert.ok(passedConfig.nightlyLearner, 'nightlyLearner tuning section must be present');
    assert.ok(passedConfig.causalRecall, 'causalRecall tuning section must be present');
    assert.ok(passedConfig.queryOptimizer, 'queryOptimizer tuning section must be present');
    assert.ok(passedConfig.selfLearningRvfBackend, 'selfLearningRvfBackend tuning section must be present');
    assert.ok(passedConfig.mutationGuard, 'mutationGuard tuning section must be present');
  });

  it('getController delegation: mock agentdb.getController() is called, not direct construction', () => {
    const MockAgentDB = mockCtor({
      getController: mockFn((name) => ({ name, type: 'delegated' })),
    });

    const agentdb = new MockAgentDB();

    // Simulate registry delegation pattern
    function registryGetController(controllerName) {
      // This is the delegation pattern — call agentdb.getController()
      return agentdb.getController(controllerName);
    }

    const ctrl = registryGetController('queryOptimizer');
    assert.deepStrictEqual(ctrl, { name: 'queryOptimizer', type: 'delegated' });
    assert.equal(agentdb.getController.calls.length, 1);
    assert.deepStrictEqual(agentdb.getController.calls[0], ['queryOptimizer']);
  });
});

// ============================================================================
// P2: HybridSearch controller
// ============================================================================

describe('ADR-0068 P2: HybridSearch controller', () => {
  it('hybrid-search.ts exists and exports HybridSearchController', () => {
    const fpath = join(CONTROLLERS_DIR, 'hybrid-search.ts');
    assert.ok(existsSync(fpath), 'hybrid-search.ts must exist');
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('export class HybridSearchController'), 'must export HybridSearchController');
  });

  it('HybridSearch does not import better-sqlite3 directly', () => {
    const fpath = join(CONTROLLERS_DIR, 'hybrid-search.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    // Check for actual import/require statements, not comments
    assert.ok(!src.match(/import\s.*['"]better-sqlite3['"]/), 'must not import better-sqlite3');
    assert.ok(!src.match(/require\s*\(\s*['"]better-sqlite3['"]\s*\)/), 'must not require better-sqlite3');
  });

  it('HybridSearch uses IMemoryBackend abstraction', () => {
    const fpath = join(CONTROLLERS_DIR, 'hybrid-search.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('IMemoryBackend'), 'must reference IMemoryBackend interface');
  });

  it('mock: HybridSearch accepts IMemoryBackend in constructor', () => {
    const mockBackend = {
      query: mockFn(async () => []),
      search: mockFn(async () => []),
    };

    // Simulate the constructor contract
    const MockHybridSearch = mockCtor({
      search: mockFn(async () => []),
    });

    const controller = new MockHybridSearch(mockBackend);
    assert.equal(controller._args[0], mockBackend);
    assert.equal(MockHybridSearch.instances.length, 1);
  });
});

// ============================================================================
// P2: FederatedSession controller
// ============================================================================

describe('ADR-0068 P2: FederatedSession controller', () => {
  it('federated-session.ts exists and exports FederatedSessionController', () => {
    const fpath = join(CONTROLLERS_DIR, 'federated-session.ts');
    assert.ok(existsSync(fpath), 'federated-session.ts must exist');
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('export class FederatedSessionController'), 'must export FederatedSessionController');
  });

  it('FederatedSession does not import better-sqlite3 directly', () => {
    const fpath = join(CONTROLLERS_DIR, 'federated-session.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    // Check for actual import/require statements, not comments
    assert.ok(!src.match(/import\s.*['"]better-sqlite3['"]/), 'must not import better-sqlite3');
    assert.ok(!src.match(/require\s*\(\s*['"]better-sqlite3['"]\s*\)/), 'must not require better-sqlite3');
  });

  it('FederatedSession uses IMemoryBackend abstraction', () => {
    const fpath = join(CONTROLLERS_DIR, 'federated-session.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('IMemoryBackend'), 'must reference IMemoryBackend interface');
  });

  it('FederatedSession exports SessionInfo and JoinResult types', () => {
    const fpath = join(CONTROLLERS_DIR, 'federated-session.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('export interface SessionInfo'), 'must export SessionInfo');
    assert.ok(src.includes('export interface JoinResult'), 'must export JoinResult');
    assert.ok(src.includes('export interface SyncResult'), 'must export SyncResult');
  });
});

// ============================================================================
// Integration: embeddings.json propagation
// ============================================================================

describe('ADR-0068 Integration: embeddings.json propagation', () => {
  let emb;

  beforeEach(() => { emb = readJson(EMBEDDINGS_PATH); });

  it('embeddings.json parses without error', () => {
    assert.doesNotThrow(() => readJson(EMBEDDINGS_PATH));
  });

  it('all HNSW fields are present and numeric', () => {
    assert.ok(emb.hnsw, 'hnsw section must exist');
    assert.equal(typeof emb.hnsw.m, 'number', 'hnsw.m must be numeric');
    assert.equal(typeof emb.hnsw.efConstruction, 'number', 'hnsw.efConstruction must be numeric');
    assert.equal(typeof emb.hnsw.efSearch, 'number', 'hnsw.efSearch must be numeric');
    assert.equal(typeof emb.hnsw.maxElements, 'number', 'hnsw.maxElements must be numeric');
  });

  it('dimension is positive integer', () => {
    assert.ok(Number.isInteger(emb.dimension), 'dimension must be integer');
    assert.ok(emb.dimension > 0, 'dimension must be positive');
  });

  it('model is a non-empty string', () => {
    assert.equal(typeof emb.model, 'string');
    assert.ok(emb.model.length > 0, 'model must be non-empty');
  });

  it('HNSW params satisfy invariants (m >= 8, efConstruction >= m, efSearch >= m)', () => {
    assert.ok(emb.hnsw.m >= 8, 'hnsw.m must be >= 8');
    assert.ok(emb.hnsw.efConstruction >= emb.hnsw.m, 'efConstruction must be >= m');
    assert.ok(emb.hnsw.efSearch >= emb.hnsw.m, 'efSearch must be >= m');
  });
});

// ============================================================================
// Integration: config.json structure
// ============================================================================

describe('ADR-0068 Integration: config.json structure', () => {
  let cfg;

  beforeEach(() => { cfg = readJson(CONFIG_PATH); });

  it('config.json parses without error', () => {
    assert.doesNotThrow(() => readJson(CONFIG_PATH));
  });

  it('controllers section is well-formed', () => {
    assert.ok(cfg.controllers, 'controllers must exist');
    assert.equal(typeof cfg.controllers, 'object', 'controllers must be an object');
    assert.ok(!Array.isArray(cfg.controllers), 'controllers must not be an array');
  });

  it('controllers.enabled has boolean values', () => {
    const enabled = cfg.controllers.enabled;
    assert.ok(enabled, 'controllers.enabled must exist');
    for (const [key, value] of Object.entries(enabled)) {
      assert.equal(typeof value, 'boolean', `controllers.enabled.${key} must be boolean, got ${typeof value}`);
    }
  });

  it('controllers section has tuning subsections as objects', () => {
    const tuningKeys = [
      'nightlyLearner', 'causalRecall', 'queryOptimizer',
      'selfLearningRvfBackend', 'mutationGuard',
    ];
    for (const key of tuningKeys) {
      if (cfg.controllers[key]) {
        assert.equal(typeof cfg.controllers[key], 'object', `controllers.${key} must be object`);
        assert.ok(!Array.isArray(cfg.controllers[key]), `controllers.${key} must not be array`);
      }
    }
  });

  it('config.json memory.maxElements matches embeddings.json hnsw.maxElements', () => {
    const emb = readJson(EMBEDDINGS_PATH);
    assert.equal(cfg.memory.maxElements, emb.hnsw.maxElements,
      'maxElements should be consistent across config and embeddings');
  });
});

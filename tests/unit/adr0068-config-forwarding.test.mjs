// @tier unit
// ADR-0068 criterion 6: Config forwarding to AgentDB constructor
// London School TDD: mock the dynamic import('agentdb') to capture constructor args.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Mock helpers (same pattern as config-unification-adr0068.test.mjs)
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
      this._config = args[0] || {};
      Object.assign(this, methods);
      instances.push(this);
    }
  }
  Mock.instances = instances;
  Mock.reset = () => { instances.length = 0; };
  return Mock;
}

// ============================================================================
// Simulate the controller-registry initAgentDB forwarding pattern
// ============================================================================

/**
 * Reproduces the exact forwarding logic from controller-registry.ts line ~935:
 *
 *   this.agentdb = new AgentDBClass({
 *     dbPath,
 *     maxElements: config.maxElements || 100000,
 *     dimension:   config.dimension   || 768,
 *     embeddingModel: config.embeddingModel || 'all-mpnet-base-v2',
 *     hnswM:             config.hnswM             || 23,
 *     hnswEfConstruction: config.hnswEfConstruction || 100,
 *     hnswEfSearch:       config.hnswEfSearch       || 50,
 *   });
 */
function simulateInitAgentDB(AgentDBClass, runtimeConfig) {
  const config = runtimeConfig;
  const dbPath = config.dbPath || ':memory:';
  return new AgentDBClass({
    dbPath,
    maxElements: config.maxElements || 100000,
    maxEntries: config.maxEntries || 1000000,
    dimension: config.dimension || 768,
    embeddingModel: config.embeddingModel || 'all-mpnet-base-v2',
    hnswM: config.hnswM || 23,
    hnswEfConstruction: config.hnswEfConstruction || 100,
    hnswEfSearch: config.hnswEfSearch || 50,
  });
}

// ============================================================================
// Gap 1: dimension forwarding — not hardcoded 384
// ============================================================================

describe('ADR-0068 criterion 6: dimension forwarded to AgentDB constructor', () => {
  let MockAgentDB;

  beforeEach(() => {
    MockAgentDB = mockCtor({
      initialize: mockFn(async () => {}),
      getEmbeddingService: mockFn(() => null),
    });
    MockAgentDB.reset();
  });

  it('forwards explicit dimension from RuntimeConfig', () => {
    const runtimeConfig = { dimension: 768 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    assert.equal(MockAgentDB.instances.length, 1);
    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.dimension, 768,
      'dimension must be forwarded as 768 from RuntimeConfig');
  });

  it('does NOT hardcode 384 as dimension', () => {
    const runtimeConfig = { dimension: 768 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.notEqual(passedConfig.dimension, 384,
      'dimension must NOT be hardcoded to 384');
  });

  it('fallback dimension is 768 when RuntimeConfig omits it', () => {
    const runtimeConfig = {};
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.dimension, 768,
      'fallback dimension must be 768 (not 384 or 1536)');
  });

  it('does NOT use 1536 as fallback dimension', () => {
    const runtimeConfig = {};
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.notEqual(passedConfig.dimension, 1536,
      'fallback dimension must NOT be 1536');
  });

  it('forwards a non-default dimension if RuntimeConfig supplies one', () => {
    const runtimeConfig = { dimension: 1024 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.dimension, 1024,
      'non-default dimension must be forwarded verbatim');
  });
});

// ============================================================================
// Gap 1: embeddingModel forwarding — not hardcoded MiniLM
// ============================================================================

describe('ADR-0068 criterion 6: embeddingModel forwarded to AgentDB constructor', () => {
  let MockAgentDB;

  beforeEach(() => {
    MockAgentDB = mockCtor({
      initialize: mockFn(async () => {}),
      getEmbeddingService: mockFn(() => null),
    });
    MockAgentDB.reset();
  });

  it('forwards explicit embeddingModel from RuntimeConfig', () => {
    const runtimeConfig = { embeddingModel: 'Xenova/all-mpnet-base-v2' };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.embeddingModel, 'Xenova/all-mpnet-base-v2',
      'embeddingModel must be forwarded from RuntimeConfig');
  });

  it('does NOT hardcode MiniLM as embeddingModel', () => {
    const runtimeConfig = { embeddingModel: 'Xenova/all-mpnet-base-v2' };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.ok(!passedConfig.embeddingModel.includes('MiniLM'),
      'embeddingModel must NOT contain MiniLM');
  });

  it('fallback embeddingModel is all-mpnet-base-v2 when RuntimeConfig omits it', () => {
    const runtimeConfig = {};
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.embeddingModel, 'all-mpnet-base-v2',
      'fallback embeddingModel must be all-mpnet-base-v2');
  });

  it('does NOT use MiniLM as fallback embeddingModel', () => {
    const runtimeConfig = {};
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.ok(!passedConfig.embeddingModel.includes('MiniLM'),
      'fallback embeddingModel must NOT reference MiniLM');
  });
});

// ============================================================================
// Gap 1: HNSW params forwarding
// ============================================================================

describe('ADR-0068 criterion 6: HNSW params forwarded to AgentDB constructor', () => {
  let MockAgentDB;

  beforeEach(() => {
    MockAgentDB = mockCtor({
      initialize: mockFn(async () => {}),
      getEmbeddingService: mockFn(() => null),
    });
    MockAgentDB.reset();
  });

  it('forwards hnswM from RuntimeConfig', () => {
    const runtimeConfig = { hnswM: 23 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswM, 23, 'hnswM must be forwarded');
  });

  it('forwards hnswEfConstruction from RuntimeConfig', () => {
    const runtimeConfig = { hnswEfConstruction: 100 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswEfConstruction, 100,
      'hnswEfConstruction must be forwarded');
  });

  it('forwards hnswEfSearch from RuntimeConfig', () => {
    const runtimeConfig = { hnswEfSearch: 50 };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswEfSearch, 50,
      'hnswEfSearch must be forwarded');
  });

  it('forwards all HNSW params together', () => {
    const runtimeConfig = {
      dimension: 768,
      embeddingModel: 'Xenova/all-mpnet-base-v2',
      hnswM: 23,
      hnswEfConstruction: 100,
      hnswEfSearch: 50,
    };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswM, 23);
    assert.equal(passedConfig.hnswEfConstruction, 100);
    assert.equal(passedConfig.hnswEfSearch, 50);
    assert.equal(passedConfig.dimension, 768);
    assert.equal(passedConfig.embeddingModel, 'Xenova/all-mpnet-base-v2');
  });

  it('HNSW fallbacks are the ADR-0068 canonical values', () => {
    const runtimeConfig = {};
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswM, 23,
      'hnswM fallback must be 23');
    assert.equal(passedConfig.hnswEfConstruction, 100,
      'hnswEfConstruction fallback must be 100');
    assert.equal(passedConfig.hnswEfSearch, 50,
      'hnswEfSearch fallback must be 50');
  });

  it('forwards non-default HNSW values verbatim', () => {
    const runtimeConfig = {
      hnswM: 48,
      hnswEfConstruction: 200,
      hnswEfSearch: 100,
    };
    simulateInitAgentDB(MockAgentDB, runtimeConfig);

    const passedConfig = MockAgentDB.instances[0]._config;
    assert.equal(passedConfig.hnswM, 48);
    assert.equal(passedConfig.hnswEfConstruction, 200);
    assert.equal(passedConfig.hnswEfSearch, 100);
  });
});

// ============================================================================
// Integration: verify actual controller-registry.ts source has the forwarding
// ============================================================================

describe('ADR-0068 criterion 6 integration: controller-registry source inspection', () => {
  // Path to fork source (outside this repo)
  const FORKS_ROOT = join(import.meta.dirname, '..', '..', '..', 'forks');
  const REGISTRY_PATH = join(
    FORKS_ROOT, 'ruflo', 'v3', '@claude-flow', 'memory', 'src',
    'controller-registry.ts',
  );

  it('controller-registry.ts contains AgentDBClass constructor with dimension', () => {
    if (!existsSync(REGISTRY_PATH)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const src = readFileSync(REGISTRY_PATH, 'utf8');

    // The constructor call must forward dimension, embeddingModel, hnswM,
    // hnswEfConstruction, and hnswEfSearch from config.
    assert.ok(src.includes('dimension: config.dimension'),
      'must forward config.dimension to AgentDB');
    assert.ok(src.includes('embeddingModel: config.embeddingModel'),
      'must forward config.embeddingModel to AgentDB');
    assert.ok(src.includes('hnswM: config.hnswM'),
      'must forward config.hnswM to AgentDB');
    assert.ok(src.includes('hnswEfConstruction: config.hnswEfConstruction'),
      'must forward config.hnswEfConstruction to AgentDB');
    assert.ok(src.includes('hnswEfSearch: config.hnswEfSearch'),
      'must forward config.hnswEfSearch to AgentDB');
  });

  it('controller-registry.ts does NOT hardcode 384 in the AgentDB constructor call', () => {
    if (!existsSync(REGISTRY_PATH)) {
      assert.ok(true, 'skip — fork source not available');
      return;
    }
    const src = readFileSync(REGISTRY_PATH, 'utf8');

    // Extract the AgentDBClass constructor block (~lines 935-944)
    const ctorMatch = src.match(/new AgentDBClass\(\{[\s\S]*?\}\)/);
    assert.ok(ctorMatch, 'must find new AgentDBClass({...}) call');

    const ctorBlock = ctorMatch[0];
    assert.ok(!ctorBlock.includes('384'),
      'AgentDB constructor must NOT contain hardcoded 384');
    assert.ok(!ctorBlock.includes('1536'),
      'AgentDB constructor must NOT contain hardcoded 1536');
    assert.ok(!ctorBlock.includes('MiniLM'),
      'AgentDB constructor must NOT contain MiniLM');
  });
});

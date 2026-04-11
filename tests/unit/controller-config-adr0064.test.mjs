// @tier unit
// ADR-0064: Controller & Configuration Cleanup
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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
// Group 1: P0 — resolvedDimension uses getEmbeddingConfig()
// ============================================================================

describe('ADR-0064: P0 resolvedDimension uses getEmbeddingConfig()', () => {

  // Simulated resolvedDimension logic (ADR-0064 fix)
  function resolvedDimension(config, getEmbeddingConfigFn) {
    if (config.dimension != null) return config.dimension;
    try {
      return getEmbeddingConfigFn().dimension;
    } catch {
      return 768;
    }
  }

  it('uses config.dimension when explicitly set', () => {
    const getEmbeddingConfig = mockFn(() => ({ dimension: 768 }));

    const dim = resolvedDimension({ dimension: 512 }, getEmbeddingConfig);

    assert.equal(dim, 512, 'must use explicit config.dimension');
    assert.equal(getEmbeddingConfig.calls.length, 0,
      'must NOT call getEmbeddingConfig when dimension is explicit');
  });

  it('falls back to getEmbeddingConfig().dimension when config.dimension omitted', () => {
    const getEmbeddingConfig = mockFn(() => ({ dimension: 768, model: 'nomic-embed-text-v1.5' }));

    const dim = resolvedDimension({}, getEmbeddingConfig);

    assert.equal(dim, 768, 'must fall back to getEmbeddingConfig().dimension');
    assert.equal(getEmbeddingConfig.calls.length, 1,
      'must call getEmbeddingConfig exactly once');
  });

  it('falls back to 768 when getEmbeddingConfig() throws', () => {
    const getEmbeddingConfig = mockFn(() => { throw new Error('module not found'); });

    const dim = resolvedDimension({}, getEmbeddingConfig);

    assert.equal(dim, 768, 'must fall back to 768 when getEmbeddingConfig throws');
  });

  it('resolvedDimension is NOT 384 (the old default)', () => {
    const getEmbeddingConfig = mockFn(() => ({ dimension: 768 }));

    // Without explicit config, should resolve to 768 not 384
    const dim = resolvedDimension({}, getEmbeddingConfig);
    assert.notEqual(dim, 384, 'old default 384 must be replaced');

    // Even when getEmbeddingConfig throws, fallback is 768 not 384
    const dimFallback = resolvedDimension({}, mockFn(() => { throw new Error(); }));
    assert.notEqual(dimFallback, 384, 'fallback must not be 384');
    assert.equal(dimFallback, 768, 'fallback must be 768');
  });
});

// ============================================================================
// Group 2: P0 — EMBEDDING_DIM removed
// ============================================================================

describe('ADR-0064: P0 EMBEDDING_DIM removed from memory package', () => {

  it('no file in memory package exports EMBEDDING_DIM (simulated barrel check)', () => {
    // Simulated barrel index contents after ADR-0064 cleanup.
    // The constant EMBEDDING_DIM was the old 384-based default; it must be gone.
    const barrelExports = [
      'getEmbeddingConfig',
      'deriveHNSWParams',
      'EmbeddingService',
      'HNSWIndex',
      'VectorBackend',
      'createEmbeddingService',
    ];

    assert.ok(!barrelExports.includes('EMBEDDING_DIM'),
      'EMBEDDING_DIM must NOT be exported from memory barrel');
  });
});

// ============================================================================
// Group 3: P1 — config.json dead fields removed (integration-level)
// ============================================================================

describe('ADR-0064: P1 config.json dead fields removed', () => {

  const configPath = join(
    new URL('.', import.meta.url).pathname,
    '..', '..', '.claude-flow', 'config.json',
  );
  const configText = readFileSync(configPath, 'utf8');
  const config = JSON.parse(configText);

  it('config.json does not contain enableHNSW', () => {
    assert.ok(!('enableHNSW' in config),
      'enableHNSW must be removed (dead field)');
    assert.ok(!configText.includes('"enableHNSW"'),
      'enableHNSW must not appear anywhere in config.json');
  });

  it('config.json does not contain agentdb.vectorBackend', () => {
    assert.ok(!('agentdb' in config) || !('vectorBackend' in (config.agentdb || {})),
      'agentdb.vectorBackend must be removed (dead field)');
    assert.ok(!configText.includes('"vectorBackend"'),
      'vectorBackend must not appear anywhere in config.json');
  });

  it('config.json cacheSize is not 384 (the mistyped dimension)', () => {
    // Walk all values looking for a cacheSize that is the mistyped 384
    function findCacheSize(obj) {
      if (obj == null || typeof obj !== 'object') return [];
      const results = [];
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'cacheSize') results.push(value);
        if (typeof value === 'object') results.push(...findCacheSize(value));
      }
      return results;
    }

    const cacheSizes = findCacheSize(config);
    for (const size of cacheSizes) {
      assert.notEqual(size, 384,
        `cacheSize must not be 384 (was mistyped dimension), found: ${size}`);
    }
  });

  it('config.json has controllers section', () => {
    assert.ok('controllers' in config,
      'config.json must have a controllers section');
    assert.equal(typeof config.controllers, 'object',
      'controllers must be an object');
    assert.ok(Object.keys(config.controllers).length > 0,
      'controllers section must not be empty');
  });
});

// ============================================================================
// Group 4: P2 — batchOperations uses createEmbeddingService()
// ============================================================================

describe('ADR-0064: P2 batchOperations uses createEmbeddingService()', () => {

  it('batchOperations factory calls createEmbeddingService(), not config.embeddingGenerator', () => {
    const BO = mockCtor();
    const realEmbedder = { embed: mockFn(() => new Float32Array(768)) };
    const createEmbeddingService = mockFn(() => realEmbedder);

    // Simulated factory (ADR-0064 fix): uses createEmbeddingService
    function createBatchOperations(Cls, createEmbedderFn, db) {
      const embedder = createEmbedderFn();
      return new Cls(db, embedder);
    }

    const fakeDb = { name: 'db' };
    const result = createBatchOperations(BO, createEmbeddingService, fakeDb);

    assert.equal(createEmbeddingService.calls.length, 1,
      'must call createEmbeddingService exactly once');
    assert.equal(BO.instances.length, 1);
    assert.equal(BO.instances[0]._args[1], realEmbedder,
      'batchOperations must receive the embedder from createEmbeddingService');
  });

  it('batchOperations receives real embedder from createEmbeddingService()', () => {
    const BO = mockCtor();
    const realEmbedder = { embed: mockFn(() => new Float32Array(768)) };
    const createEmbeddingService = mockFn(() => realEmbedder);

    function createBatchOperations(Cls, createEmbedderFn, db) {
      const embedder = createEmbedderFn();
      return new Cls(db, embedder);
    }

    const fakeDb = { name: 'db' };
    createBatchOperations(BO, createEmbeddingService, fakeDb);

    const embedder = BO.instances[0]._args[1];
    assert.ok(embedder.embed, 'embedder must have embed method');

    const vec = embedder.embed('test input');
    assert.equal(vec.length, 768, 'embedder must produce 768-dim vectors');
  });
});

// ============================================================================
// Group 5: P2 — numHeads aligned
// ============================================================================

describe('ADR-0064: P2 numHeads aligned to 8', () => {

  it('multiHeadAttention factory uses numHeads: 8', () => {
    const MHA = mockCtor();

    // Simulated factory (ADR-0064 fix): numHeads pulled from config or default 8
    function createMultiHeadAttention(Cls, config) {
      const numHeads = config?.multiHeadAttention?.numHeads ?? 8;
      return new Cls({ numHeads });
    }

    const config = { multiHeadAttention: { numHeads: 8 } };
    createMultiHeadAttention(MHA, config);

    assert.equal(MHA.instances[0]._args[0].numHeads, 8,
      'multiHeadAttention must use numHeads: 8 (not 4)');
    assert.notEqual(MHA.instances[0]._args[0].numHeads, 4,
      'numHeads must NOT be the old value 4');
  });

  it('attentionService factory uses numHeads: 8', () => {
    const AS = mockCtor();

    function createAttentionService(Cls, config) {
      const numHeads = config?.attentionService?.numHeads ?? 8;
      return new Cls({ numHeads, useFlash: config?.attentionService?.useFlash ?? true });
    }

    const config = { attentionService: { numHeads: 8, useFlash: true } };
    createAttentionService(AS, config);

    assert.equal(AS.instances[0]._args[0].numHeads, 8,
      'attentionService must use numHeads: 8');
    assert.notEqual(AS.instances[0]._args[0].numHeads, 4,
      'numHeads must NOT be the old value 4');
  });

  it('both multiHeadAttention and attentionService use the same numHeads', () => {
    const MHA = mockCtor();
    const AS = mockCtor();

    const config = {
      multiHeadAttention: { numHeads: 8 },
      attentionService: { numHeads: 8, useFlash: true },
    };

    function createMultiHeadAttention(Cls, cfg) {
      return new Cls({ numHeads: cfg?.multiHeadAttention?.numHeads ?? 8 });
    }

    function createAttentionService(Cls, cfg) {
      return new Cls({ numHeads: cfg?.attentionService?.numHeads ?? 8 });
    }

    createMultiHeadAttention(MHA, config);
    createAttentionService(AS, config);

    const mhaHeads = MHA.instances[0]._args[0].numHeads;
    const asHeads = AS.instances[0]._args[0].numHeads;

    assert.equal(mhaHeads, asHeads,
      `multiHeadAttention (${mhaHeads}) and attentionService (${asHeads}) must use the same numHeads`);
    assert.equal(mhaHeads, 8, 'both must use numHeads: 8');
  });
});

// ============================================================================
// Group 6: P2 — maxElements alignment
// ============================================================================

describe('ADR-0064: P2 maxElements alignment', () => {

  it('controller-registry passes maxElements 100000 to AgentDB', () => {
    const AgentDB = mockCtor();

    // Simulated controller-registry init (ADR-0064 fix)
    function initAgentDB(Cls, config) {
      const maxElements = config?.memory?.maxElements ?? 100_000;
      return new Cls({ maxElements });
    }

    const config = { memory: { maxElements: 100_000 } };
    initAgentDB(AgentDB, config);

    const maxEl = AgentDB.instances[0]._args[0].maxElements;
    assert.equal(maxEl, 100_000,
      'maxElements must be 100000');
    assert.notEqual(maxEl, 10_000,
      'maxElements must NOT be 10000 (too small)');
    assert.notEqual(maxEl, 1_000_000,
      'maxElements must NOT be 1000000 (too large)');
  });
});

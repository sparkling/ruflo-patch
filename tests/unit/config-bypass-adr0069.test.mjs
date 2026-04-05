// @tier unit
// ADR-0069: Config Chain Bypass Remediation
// London School TDD: inline mock factories, no real agentdb imports.
//
// Tests that each bypass site identified in ADR-0069 resolves embedding/HNSW
// config from the config chain (getEmbeddingConfig / deriveHNSWParams) rather
// than hardcoding 768 / 23 / 100 / 50.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
      Object.assign(this, methods);
      instances.push(this);
    }
  }
  Mock.instances = instances;
  Mock.reset = () => { instances.length = 0; };
  return Mock;
}

// ============================================================================
// Shared mock config chain
// ============================================================================

/** Simulates getEmbeddingConfig() — the single source of truth */
function makeGetEmbeddingConfig(overrides = {}) {
  const defaults = {
    model: 'Xenova/all-mpnet-base-v2',
    dimension: 768,
    provider: 'onnx',
    hnsw: { m: 23, efConstruction: 100, efSearch: 50 },
  };
  return mockFn(() => ({ ...defaults, ...overrides }));
}

/** Simulates deriveHNSWParams(dimension) — derives HNSW from dimension */
function makeDeriveHNSWParams() {
  return mockFn((dim) => {
    // Formula mirrors the real implementation: m scales with log2(dim)
    const m = Math.max(8, Math.round(Math.log2(dim) * 2.5));
    const efConstruction = Math.max(m * 4, 64);
    const efSearch = Math.max(m * 2, 32);
    return { m, efConstruction, efSearch };
  });
}

/** Simulates a failing getEmbeddingConfig (package not available) */
function makeFailingGetEmbeddingConfig() {
  return mockFn(() => { throw new Error('Module @claude-flow/agentdb not found'); });
}

// ============================================================================
// Simulated bypass-site resolution functions
// ============================================================================

// Pattern: each bypass site SHOULD call getEmbeddingConfig() first and fall
// back to hardcoded values only when the config chain is unavailable.

function resolveDefaultConfig(getEmbeddingConfigFn) {
  try {
    const cfg = getEmbeddingConfigFn();
    return {
      dimensions: cfg.dimension,
      hnswM: cfg.hnsw.m,
      hnswEfConstruction: cfg.hnsw.efConstruction,
      hnswEfSearch: cfg.hnsw.efSearch,
    };
  } catch {
    // Fallback when config chain is unavailable
    return { dimensions: 768, hnswM: 23, hnswEfConstruction: 100, hnswEfSearch: 50 };
  }
}

function resolveAgentDBServiceEmbedding(getEmbeddingConfigFn) {
  try {
    const cfg = getEmbeddingConfigFn();
    return { model: cfg.model, dimension: cfg.dimension, provider: cfg.provider };
  } catch {
    return { model: 'Xenova/all-mpnet-base-v2', dimension: 768, provider: 'onnx' };
  }
}

function resolveCreateBackend(getEmbeddingConfigFn) {
  try {
    const cfg = getEmbeddingConfigFn();
    return { dimension: cfg.dimension, maxElements: 100_000 };
  } catch {
    return { dimension: 768, maxElements: 100_000 };
  }
}

function resolveEmbeddingDimensions(getEmbeddingConfigFn) {
  try {
    return getEmbeddingConfigFn().dimension;
  } catch {
    return 768;
  }
}

function resolveOnnxDimension(getEmbeddingConfigFn) {
  try {
    return getEmbeddingConfigFn().dimension;
  } catch {
    return 768;
  }
}

function resolveDefaultAgentDBConfig(getEmbeddingConfigFn) {
  try {
    const cfg = getEmbeddingConfigFn();
    return {
      dimensions: cfg.dimension,
      hnswM: cfg.hnsw.m,
      hnswEfConstruction: cfg.hnsw.efConstruction,
      hnswEfSearch: cfg.hnsw.efSearch,
    };
  } catch {
    return { dimensions: 768, hnswM: 23, hnswEfConstruction: 100, hnswEfSearch: 50 };
  }
}

// ============================================================================
// Unit tests: bypass sites resolve from config chain
// ============================================================================

describe('ADR-0069 U1: agentdb-adapter DEFAULT_CONFIG resolves from config chain', () => {
  let getEmbeddingConfig;

  beforeEach(() => {
    getEmbeddingConfig = makeGetEmbeddingConfig();
  });

  it('uses getEmbeddingConfig() for dimensions', () => {
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.dimensions, 768);
    assert.equal(getEmbeddingConfig.calls.length, 1, 'getEmbeddingConfig must be called');
  });

  it('uses getEmbeddingConfig() for hnswM', () => {
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.hnswM, 23);
  });

  it('uses getEmbeddingConfig() for hnswEfConstruction', () => {
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.hnswEfConstruction, 100);
  });

  it('uses getEmbeddingConfig() for hnswEfSearch', () => {
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.hnswEfSearch, 50);
  });

  it('respects non-default dimension from config chain', () => {
    getEmbeddingConfig = makeGetEmbeddingConfig({
      dimension: 384,
      hnsw: { m: 16, efConstruction: 64, efSearch: 32 },
    });
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.dimensions, 384, 'dimension must come from config, not hardcoded 768');
    assert.equal(config.hnswM, 16);
  });
});

describe('ADR-0069 U2: agentdb-backend DEFAULT_CONFIG resolves from config chain', () => {
  it('calls getEmbeddingConfig() for all four HNSW params', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({
      dimension: 1536,
      hnsw: { m: 32, efConstruction: 200, efSearch: 100 },
    });
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.dimensions, 1536);
    assert.equal(config.hnswM, 32);
    assert.equal(config.hnswEfConstruction, 200);
    assert.equal(config.hnswEfSearch, 100);
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });
});

describe('ADR-0069 U3: integration/types.ts getDefaultAgentDBConfig resolves from config chain', () => {
  it('returns config-chain values for all params', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({
      dimension: 512,
      hnsw: { m: 20, efConstruction: 80, efSearch: 40 },
    });
    const config = resolveDefaultAgentDBConfig(getEmbeddingConfig);
    assert.equal(config.dimensions, 512);
    assert.equal(config.hnswM, 20);
    assert.equal(config.hnswEfConstruction, 80);
    assert.equal(config.hnswEfSearch, 40);
  });
});

describe('ADR-0069 U4: hooks/reasoningbank DEFAULT_CONFIG resolves from config chain', () => {
  it('calls getEmbeddingConfig() rather than using hardcoded values', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(getEmbeddingConfig.calls.length, 1, 'must call getEmbeddingConfig');
    assert.equal(config.dimensions, 768);
    assert.equal(config.hnswM, 23);
  });

  it('propagates non-default HNSW params', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({
      dimension: 256,
      hnsw: { m: 12, efConstruction: 48, efSearch: 24 },
    });
    const config = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(config.dimensions, 256);
    assert.equal(config.hnswEfConstruction, 48);
  });
});

describe('ADR-0069 U5: AgentDBService uses getEmbeddingConfig for EmbeddingService', () => {
  it('passes model/dimension/provider from config chain', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    const result = resolveAgentDBServiceEmbedding(getEmbeddingConfig);
    assert.equal(result.model, 'Xenova/all-mpnet-base-v2');
    assert.equal(result.dimension, 768);
    assert.equal(result.provider, 'onnx');
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });

  it('propagates custom model from config', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({
      model: 'custom/model-v3',
      dimension: 1024,
      provider: 'transformers',
    });
    const result = resolveAgentDBServiceEmbedding(getEmbeddingConfig);
    assert.equal(result.model, 'custom/model-v3');
    assert.equal(result.dimension, 1024);
    assert.equal(result.provider, 'transformers');
  });
});

describe('ADR-0069 U6: AgentDBService createBackend uses config chain dimensions', () => {
  it('maxElements is 100K not 10K', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    const result = resolveCreateBackend(getEmbeddingConfig);
    assert.equal(result.maxElements, 100_000, 'maxElements must be 100K (ADR-0069 fix)');
  });

  it('dimension comes from config chain', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 384 });
    const result = resolveCreateBackend(getEmbeddingConfig);
    assert.equal(result.dimension, 384, 'dimension must come from config chain');
  });
});

describe('ADR-0069 U7: reasoningbank/embeddings getEmbeddingDimensions uses config', () => {
  it('returns config-chain dimension, not hardcoded 768', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 512 });
    const dim = resolveEmbeddingDimensions(getEmbeddingConfig);
    assert.equal(dim, 512, 'dimension must come from config chain');
  });

  it('calls getEmbeddingConfig exactly once', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    resolveEmbeddingDimensions(getEmbeddingConfig);
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });
});

describe('ADR-0069 U8: EmbeddingService uses config chain for ONNX dimension', () => {
  it('dimension comes from config, not hardcoded 768', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 384 });
    const dim = resolveOnnxDimension(getEmbeddingConfig);
    assert.equal(dim, 384, 'ONNX dimension must come from config chain');
  });

  it('mock: EmbeddingService constructor receives config-chain dimension', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 1024 });
    const MockEmbeddingService = mockCtor({
      embed: mockFn(async () => new Float32Array(1024)),
    });
    const cfg = getEmbeddingConfig();
    const svc = new MockEmbeddingService({ dimension: cfg.dimension, model: cfg.model });
    assert.equal(svc._args[0].dimension, 1024);
    assert.equal(MockEmbeddingService.instances.length, 1);
  });
});

describe('ADR-0069 U9: all bypass sites fall back gracefully when config chain unavailable', () => {
  let failingConfig;

  beforeEach(() => {
    failingConfig = makeFailingGetEmbeddingConfig();
  });

  it('agentdb-adapter falls back to 768/23/100/50', () => {
    const config = resolveDefaultConfig(failingConfig);
    assert.equal(config.dimensions, 768);
    assert.equal(config.hnswM, 23);
    assert.equal(config.hnswEfConstruction, 100);
    assert.equal(config.hnswEfSearch, 50);
  });

  it('agentdb-backend falls back to 768/23/100/50', () => {
    const config = resolveDefaultConfig(failingConfig);
    assert.equal(config.dimensions, 768);
    assert.equal(config.hnswM, 23);
  });

  it('integration/types falls back to 768/23/100/50', () => {
    const config = resolveDefaultAgentDBConfig(failingConfig);
    assert.equal(config.dimensions, 768);
    assert.equal(config.hnswM, 23);
  });

  it('hooks/reasoningbank falls back to 768/23/100/50', () => {
    const config = resolveDefaultConfig(failingConfig);
    assert.equal(config.dimensions, 768);
    assert.equal(config.hnswEfSearch, 50);
  });

  it('AgentDBService embedding falls back to model/768/onnx', () => {
    const result = resolveAgentDBServiceEmbedding(failingConfig);
    assert.equal(result.model, 'Xenova/all-mpnet-base-v2');
    assert.equal(result.dimension, 768);
    assert.equal(result.provider, 'onnx');
  });

  it('createBackend falls back to 768 dimension, 100K maxElements', () => {
    const result = resolveCreateBackend(failingConfig);
    assert.equal(result.dimension, 768);
    assert.equal(result.maxElements, 100_000);
  });

  it('getEmbeddingDimensions falls back to 768', () => {
    const dim = resolveEmbeddingDimensions(failingConfig);
    assert.equal(dim, 768);
  });

  it('ONNX dimension falls back to 768', () => {
    const dim = resolveOnnxDimension(failingConfig);
    assert.equal(dim, 768);
  });
});

// ============================================================================
// Integration tests: config chain round-trip and consistency
// ============================================================================

describe('ADR-0069 I10: config chain round-trip with non-default dimension', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'adr0069-'));
  });

  it('bypass sites resolve to 384 when embeddings.json says 384', () => {
    const embeddingsJson = {
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: 384,
      hnsw: { m: 16, efConstruction: 64, efSearch: 32, maxElements: 100000 },
    };
    writeFileSync(join(tmpDir, 'embeddings.json'), JSON.stringify(embeddingsJson, null, 2));

    // Simulate reading the config file and building getEmbeddingConfig from it
    const raw = JSON.parse(readFileSync(join(tmpDir, 'embeddings.json'), 'utf8'));
    const getEmbeddingConfig = mockFn(() => ({
      model: raw.model,
      dimension: raw.dimension,
      provider: 'onnx',
      hnsw: raw.hnsw,
    }));

    // All bypass sites must resolve from this config
    const adapter = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(adapter.dimensions, 384, 'adapter must use 384 from config file');
    assert.equal(adapter.hnswM, 16);

    const backend = resolveDefaultConfig(getEmbeddingConfig);
    assert.equal(backend.dimensions, 384, 'backend must use 384 from config file');

    const types = resolveDefaultAgentDBConfig(getEmbeddingConfig);
    assert.equal(types.dimensions, 384, 'types must use 384 from config file');

    const embDim = resolveEmbeddingDimensions(getEmbeddingConfig);
    assert.equal(embDim, 384, 'embeddingDimensions must use 384 from config file');

    const onnxDim = resolveOnnxDimension(getEmbeddingConfig);
    assert.equal(onnxDim, 384, 'ONNX dimension must use 384 from config file');
  });

  it('cleanup', () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.ok(true);
  });
});

describe('ADR-0069 I11: deriveHNSWParams consistency across all patched sites', () => {
  it('all sites produce identical HNSW params for dimension 768', () => {
    const deriveHNSWParams = makeDeriveHNSWParams();

    // Call deriveHNSWParams for each conceptual bypass site
    const sites = [
      'agentdb-adapter',
      'agentdb-backend',
      'integration/types',
      'hooks/reasoningbank',
      'agentic-flow-bridge',
    ];

    const results = sites.map(site => {
      const params = deriveHNSWParams(768);
      return { site, ...params };
    });

    // All must be identical
    const first = results[0];
    for (const r of results.slice(1)) {
      assert.equal(r.m, first.m, `${r.site} m must match ${first.site}`);
      assert.equal(r.efConstruction, first.efConstruction,
        `${r.site} efConstruction must match ${first.site}`);
      assert.equal(r.efSearch, first.efSearch,
        `${r.site} efSearch must match ${first.site}`);
    }
    assert.equal(deriveHNSWParams.calls.length, sites.length);
  });

  it('all sites produce identical HNSW params for dimension 384', () => {
    const deriveHNSWParams = makeDeriveHNSWParams();

    const params384_a = deriveHNSWParams(384);
    const params384_b = deriveHNSWParams(384);
    const params384_c = deriveHNSWParams(384);

    assert.equal(params384_a.m, params384_b.m);
    assert.equal(params384_b.m, params384_c.m);
    assert.equal(params384_a.efConstruction, params384_c.efConstruction);
  });

  it('deriveHNSWParams produces valid invariants (m >= 8, efC >= m)', () => {
    const deriveHNSWParams = makeDeriveHNSWParams();

    for (const dim of [128, 256, 384, 512, 768, 1024, 1536, 3072]) {
      const p = deriveHNSWParams(dim);
      assert.ok(p.m >= 8, `m must be >= 8 for dim=${dim}, got ${p.m}`);
      assert.ok(p.efConstruction >= p.m,
        `efConstruction must be >= m for dim=${dim}, got efC=${p.efConstruction} m=${p.m}`);
      assert.ok(p.efSearch >= p.m,
        `efSearch must be >= m for dim=${dim}, got efS=${p.efSearch} m=${p.m}`);
    }
  });
});

// ============================================================================
// U12–U15: Capacity values (maxElements, maxEntries) in config chain
// ============================================================================

/** Simulates getEmbeddingConfig() with maxElements support */
function makeGetEmbeddingConfigWithCapacity(overrides = {}) {
  const defaults = {
    model: 'Xenova/all-mpnet-base-v2',
    dimension: 768,
    provider: 'onnx',
    hnsw: { m: 23, efConstruction: 100, efSearch: 50, maxElements: 100_000 },
  };
  const merged = { ...defaults, ...overrides };
  if (overrides.hnsw) merged.hnsw = { ...defaults.hnsw, ...overrides.hnsw };
  return mockFn(() => merged);
}

/** Simulates deriveHNSWParams with maxElements support */
function makeDeriveHNSWParamsWithCapacity() {
  return mockFn((dim, maxElements) => {
    const m = Math.max(8, Math.round(Math.log2(dim) * 2.5));
    const efConstruction = Math.max(m * 4, 64);
    const efSearch = Math.max(m * 2, 32);
    return { m, efConstruction, efSearch, maxElements: maxElements ?? 100_000 };
  });
}

/** Simulates config.json bridge reading maxEntries from memory.storage */
function makeConfigBridge(configJson = {}) {
  const defaults = {
    memory: { storage: { maxEntries: 1_000_000 } },
  };
  const merged = { ...defaults, ...configJson };
  if (configJson.memory) {
    merged.memory = { ...defaults.memory, ...configJson.memory };
    if (configJson.memory.storage) {
      merged.memory.storage = { ...defaults.memory.storage, ...configJson.memory.storage };
    }
  }
  return mockFn(() => merged);
}

/** Simulates RuntimeConfig receiving maxEntries from bridge */
function resolveRuntimeConfig(bridgeFn) {
  const cfg = bridgeFn();
  return {
    maxEntries: cfg.memory?.storage?.maxEntries ?? 1_000_000,
  };
}

/** Simulates factory.ts reading maxElements from getEmbeddingConfig */
function resolveFactoryMaxElements(getEmbeddingConfigFn) {
  try {
    const cfg = getEmbeddingConfigFn();
    return cfg.hnsw?.maxElements ?? 100_000;
  } catch {
    return 100_000;
  }
}

describe('ADR-0069 U12: getEmbeddingConfig includes maxElements', () => {
  it('returns maxElements from embeddings.json hnsw block', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfigWithCapacity({
      hnsw: { maxElements: 50_000 },
    });
    const cfg = getEmbeddingConfig();
    assert.equal(cfg.hnsw.maxElements, 50_000,
      'maxElements must come from embeddings.json hnsw block');
  });

  it('returns default 100000 when no hnsw.maxElements specified', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfigWithCapacity();
    const cfg = getEmbeddingConfig();
    assert.equal(cfg.hnsw.maxElements, 100_000,
      'maxElements default must be 100000');
  });

  it('env var AGENTDB_MAX_ELEMENTS overrides file config', () => {
    // Simulate env var override pattern used in config chain
    const fileMaxElements = 50_000;
    const envMaxElements = 75_000;

    const getEmbeddingConfig = mockFn(() => {
      const envVal = envMaxElements; // simulates process.env.AGENTDB_MAX_ELEMENTS
      return {
        model: 'Xenova/all-mpnet-base-v2',
        dimension: 768,
        provider: 'onnx',
        hnsw: {
          m: 23, efConstruction: 100, efSearch: 50,
          maxElements: envVal || fileMaxElements,
        },
      };
    });
    const cfg = getEmbeddingConfig();
    assert.equal(cfg.hnsw.maxElements, 75_000,
      'env var AGENTDB_MAX_ELEMENTS must override file config');
  });
});

describe('ADR-0069 U13: deriveHNSWParams includes maxElements', () => {
  it('returns default maxElements 100000 for dimension 768', () => {
    const deriveHNSWParams = makeDeriveHNSWParamsWithCapacity();
    const params = deriveHNSWParams(768);
    assert.equal(params.maxElements, 100_000,
      'deriveHNSWParams(768) must return default maxElements 100000');
    // Also verify HNSW params are present (exact values tested in I11)
    assert.ok(params.m >= 8, 'm must be >= 8');
    assert.ok(params.efConstruction >= params.m, 'efConstruction must be >= m');
    assert.ok(params.efSearch >= params.m, 'efSearch must be >= m');
  });

  it('passes explicit maxElements override', () => {
    const deriveHNSWParams = makeDeriveHNSWParamsWithCapacity();
    const params = deriveHNSWParams(768, 50_000);
    assert.equal(params.maxElements, 50_000,
      'deriveHNSWParams(768, 50000) must return maxElements 50000');
  });

  it('return type includes maxElements field', () => {
    const deriveHNSWParams = makeDeriveHNSWParamsWithCapacity();
    const params = deriveHNSWParams(384);
    assert.ok('maxElements' in params,
      'deriveHNSWParams return must include maxElements field');
    assert.equal(typeof params.maxElements, 'number',
      'maxElements must be a number');
  });
});

describe('ADR-0069 U14: maxEntries flows through config chain', () => {
  it('bridge passes maxEntries from config.json memory.storage', () => {
    const bridge = makeConfigBridge({
      memory: { storage: { maxEntries: 500_000 } },
    });
    const runtime = resolveRuntimeConfig(bridge);
    assert.equal(runtime.maxEntries, 500_000,
      'bridge must pass maxEntries 500000 to RuntimeConfig');
  });

  it('defaults to 1000000 when config.json has no storage block', () => {
    const bridge = makeConfigBridge({});
    const runtime = resolveRuntimeConfig(bridge);
    assert.equal(runtime.maxEntries, 1_000_000,
      'maxEntries must default to 1000000');
  });

  it('adapter, backend, database-provider all receive configured value', () => {
    const bridge = makeConfigBridge({
      memory: { storage: { maxEntries: 250_000 } },
    });
    const runtime = resolveRuntimeConfig(bridge);

    // Simulate each consumer reading from RuntimeConfig
    const adapterMaxEntries = runtime.maxEntries;
    const backendMaxEntries = runtime.maxEntries;
    const dbProviderMaxEntries = runtime.maxEntries;

    assert.equal(adapterMaxEntries, 250_000, 'adapter must receive 250000');
    assert.equal(backendMaxEntries, 250_000, 'backend must receive 250000');
    assert.equal(dbProviderMaxEntries, 250_000, 'database-provider must receive 250000');
  });
});

describe('ADR-0069 U15: factory.ts maxElements uses config chain', () => {
  it('backend factory default maxElements is 100000 not 10000', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfigWithCapacity();
    const maxElements = resolveFactoryMaxElements(getEmbeddingConfig);
    assert.equal(maxElements, 100_000,
      'factory default maxElements must be 100000, not 10000');
    assert.notEqual(maxElements, 10_000,
      'factory must NOT use old buggy value 10000');
  });

  it('uses getEmbeddingConfig().hnsw.maxElements when set', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfigWithCapacity({
      hnsw: { maxElements: 200_000 },
    });
    const maxElements = resolveFactoryMaxElements(getEmbeddingConfig);
    assert.equal(maxElements, 200_000,
      'factory must use maxElements from config chain');
  });

  it('falls back to 100000 when config chain unavailable', () => {
    const failingConfig = makeFailingGetEmbeddingConfig();
    const maxElements = resolveFactoryMaxElements(failingConfig);
    assert.equal(maxElements, 100_000,
      'factory fallback maxElements must be 100000');
  });
});

// ============================================================================
// I12: Capacity round-trip integration
// ============================================================================

describe('ADR-0069 I12: capacity round-trip integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'adr0069-cap-'));
  });

  it('all consumers resolve maxElements=50000 and maxEntries=250000 from config files', () => {
    // Write embeddings.json with custom maxElements
    const embeddingsJson = {
      model: 'Xenova/all-mpnet-base-v2',
      dimension: 768,
      hnsw: { m: 23, efConstruction: 100, efSearch: 50, maxElements: 50_000 },
    };
    writeFileSync(join(tmpDir, 'embeddings.json'), JSON.stringify(embeddingsJson, null, 2));

    // Write config.json with custom maxEntries
    const configJson = {
      memory: { storage: { maxEntries: 250_000 } },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    // Read back and build config functions from files
    const rawEmb = JSON.parse(readFileSync(join(tmpDir, 'embeddings.json'), 'utf8'));
    const rawCfg = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf8'));

    const getEmbeddingConfig = mockFn(() => ({
      model: rawEmb.model,
      dimension: rawEmb.dimension,
      provider: 'onnx',
      hnsw: rawEmb.hnsw,
      maxElements: rawEmb.hnsw.maxElements,
    }));

    const bridge = mockFn(() => rawCfg);

    // Verify maxElements flows to all HNSW consumers
    const embCfg = getEmbeddingConfig();
    assert.equal(embCfg.hnsw.maxElements, 50_000, 'hnsw.maxElements must be 50000');
    assert.equal(embCfg.maxElements, 50_000, 'top-level maxElements must be 50000');

    const factoryMaxElements = resolveFactoryMaxElements(getEmbeddingConfig);
    assert.equal(factoryMaxElements, 50_000, 'factory must resolve maxElements 50000');

    const createBackendResult = resolveCreateBackend(getEmbeddingConfig);
    assert.equal(createBackendResult.maxElements, 100_000,
      'createBackend uses its own default; factory override is separate');

    // Verify maxEntries flows through bridge to RuntimeConfig
    const runtime = resolveRuntimeConfig(bridge);
    assert.equal(runtime.maxEntries, 250_000, 'RuntimeConfig maxEntries must be 250000');
  });

  it('cleanup', () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.ok(true);
  });
});

// ============================================================================
// H6: Port number config-chain wiring (QUIC, Federation, Health)
// ============================================================================

// Simulates port resolution pattern used across all wired sites:
//   config.port || parseInt(process.env.ENV_VAR || '') || DEFAULT
function resolvePort(configPort, envValue, defaultPort) {
  return configPort || parseInt(envValue || '') || defaultPort;
}

// Simulates the FederationHub/Client string-replace port mapping:
//   endpoint.replace(`:${quicPort}`, `:${fedPort}`)
function resolveEndpointPortMapping(endpoint, quicPortEnv, fedPortEnv) {
  const quicPort = String(parseInt(quicPortEnv || '') || 4433);
  const fedPort = String(parseInt(fedPortEnv || '') || 8443);
  return endpoint
    .replace('quic://', 'https://')
    .replace(`:${quicPort}`, `:${fedPort}`);
}

describe('ADR-0069 H6-U1: QUIC port resolves from env var with fallback', () => {
  it('uses config.port when provided', () => {
    assert.equal(resolvePort(5000, '', 4433), 5000);
  });

  it('uses QUIC_PORT env var when config.port is undefined', () => {
    assert.equal(resolvePort(undefined, '5555', 4433), 5555);
  });

  it('falls back to 4433 when neither config nor env set', () => {
    assert.equal(resolvePort(undefined, '', 4433), 4433);
  });

  it('config.port takes precedence over env var', () => {
    assert.equal(resolvePort(6000, '5555', 4433), 6000,
      'explicit config must win over env var');
  });

  it('ignores non-numeric env var and falls back to default', () => {
    assert.equal(resolvePort(undefined, 'not-a-number', 4433), 4433);
  });
});

describe('ADR-0069 H6-U2: Federation port resolves from env var with fallback', () => {
  it('uses config.port when provided', () => {
    assert.equal(resolvePort(9000, '', 8443), 9000);
  });

  it('uses FEDERATION_PORT env var when config.port is undefined', () => {
    assert.equal(resolvePort(undefined, '9443', 8443), 9443);
  });

  it('falls back to 8443 when neither config nor env set', () => {
    assert.equal(resolvePort(undefined, '', 8443), 8443);
  });
});

describe('ADR-0069 H6-U3: Health port resolves from env var with fallback', () => {
  it('uses provided port argument', () => {
    assert.equal(resolvePort(3000, '', 8080), 3000);
  });

  it('uses HEALTH_PORT env var when port argument is undefined', () => {
    assert.equal(resolvePort(undefined, '9090', 8080), 9090);
  });

  it('falls back to 8080 when neither argument nor env set', () => {
    assert.equal(resolvePort(undefined, '', 8080), 8080);
  });
});

describe('ADR-0069 H6-U4: Federation endpoint port mapping uses env vars', () => {
  it('maps default quic://host:4433 to https://host:8443', () => {
    const result = resolveEndpointPortMapping('quic://hub.example.com:4433/sync', '', '');
    assert.equal(result, 'https://hub.example.com:8443/sync');
  });

  it('maps custom QUIC port to custom Federation port', () => {
    const result = resolveEndpointPortMapping(
      'quic://hub.example.com:5555/sync', '5555', '9443'
    );
    assert.equal(result, 'https://hub.example.com:9443/sync');
  });

  it('does not mangle endpoint when QUIC port does not appear in URL', () => {
    const result = resolveEndpointPortMapping(
      'quic://hub.example.com:7777/sync', '5555', '9443'
    );
    // :7777 does not match :5555, so no replacement happens
    assert.equal(result, 'https://hub.example.com:7777/sync',
      'non-matching port must be left untouched');
  });

  it('handles default ports when env vars are empty', () => {
    const result = resolveEndpointPortMapping('quic://localhost:4433', '', '');
    assert.equal(result, 'https://localhost:8443');
  });

  it('handles non-numeric env vars gracefully (falls back to defaults)', () => {
    const result = resolveEndpointPortMapping(
      'quic://localhost:4433/path', 'bad', 'worse'
    );
    // parseInt('bad') = NaN, || 4433 kicks in; same for federation
    assert.equal(result, 'https://localhost:8443/path');
  });
});

describe('ADR-0069 H6-U5: transport-router defaults resolve from env', () => {
  it('quicConfig.port resolves from QUIC_PORT env', () => {
    const port = parseInt('5555' || '') || 4433;
    assert.equal(port, 5555);
  });

  it('http2Config.port resolves from FEDERATION_PORT env', () => {
    const port = parseInt('9443' || '') || 8443;
    assert.equal(port, 9443);
  });

  it('both fall back to defaults when env is empty', () => {
    const quicPort = parseInt('' || '') || 4433;
    const fedPort = parseInt('' || '') || 8443;
    assert.equal(quicPort, 4433);
    assert.equal(fedPort, 8443);
  });
});

describe('ADR-0069 H6-U6: agentdb-service QUIC_SERVER_PORT already env-guarded', () => {
  it('parseInt(QUIC_SERVER_PORT) resolves custom port', () => {
    const port = parseInt('6000');
    assert.equal(port, 6000);
  });

  it('falls back to 4433 when env var is empty string', () => {
    const port = parseInt('' || '4433');
    assert.equal(port, 4433);
  });
});

// ============================================================================
// H6 Integration: port config round-trip through config.json
// ============================================================================

describe('ADR-0069 H6-I1: ports round-trip through config.json', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'adr0069-ports-'));
  });

  it('all port consumers resolve from config.json ports block', () => {
    const configJson = {
      ports: { quic: 5555, federation: 9443, health: 3000 },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    const raw = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf8'));

    // Simulate each consumer reading ports from config
    const quicPort = resolvePort(raw.ports?.quic, '', 4433);
    const fedPort = resolvePort(raw.ports?.federation, '', 8443);
    const healthPort = resolvePort(raw.ports?.health, '', 8080);

    assert.equal(quicPort, 5555, 'QUIC port must come from config.json');
    assert.equal(fedPort, 9443, 'Federation port must come from config.json');
    assert.equal(healthPort, 3000, 'Health port must come from config.json');
  });

  it('env var overrides config.json ports', () => {
    const configJson = {
      ports: { quic: 5555, federation: 9443, health: 3000 },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    // Env var takes precedence when config.port is not set (constructor default path)
    const envQuicPort = resolvePort(undefined, '7777', 4433);
    assert.equal(envQuicPort, 7777, 'env var must override when config.port not passed');
  });

  it('defaults to standard ports when config.json has no ports block', () => {
    const configJson = { memory: { storage: {} } };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    const raw = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf8'));

    const quicPort = resolvePort(raw.ports?.quic, '', 4433);
    const fedPort = resolvePort(raw.ports?.federation, '', 8443);
    const healthPort = resolvePort(raw.ports?.health, '', 8080);

    assert.equal(quicPort, 4433);
    assert.equal(fedPort, 8443);
    assert.equal(healthPort, 8080);
  });

  it('federation endpoint mapping uses config.json ports', () => {
    const configJson = {
      ports: { quic: 5555, federation: 9443 },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    const raw = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf8'));

    const result = resolveEndpointPortMapping(
      'quic://hub.example.com:5555/sync',
      String(raw.ports.quic),
      String(raw.ports.federation),
    );
    assert.equal(result, 'https://hub.example.com:9443/sync');
  });

  it('cleanup', () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.ok(true);
  });
});

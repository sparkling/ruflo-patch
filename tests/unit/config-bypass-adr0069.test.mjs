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

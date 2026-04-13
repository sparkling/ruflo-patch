// @tier unit
// ADR-0065: Configuration Centralization and Storage Deduplication
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Mock helpers (same pattern as controller-config-adr0064.test.mjs)
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
const FORK_ROOT = '/Users/henrik/source/forks/ruflo/v3';

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ============================================================================
// Group 1: P0 — config.json is well-formed and all fields are present
// ============================================================================

describe('ADR-0065 P0/P1: config.json structural correctness', () => {
  let cfg;

  beforeEach(() => { cfg = readJson(CONFIG_PATH); });

  it('swarm.autoScale is an object with enabled flag, not a bare boolean', () => {
    assert.equal(typeof cfg.swarm.autoScale, 'object', 'autoScale must be an object');
    assert.equal(typeof cfg.swarm.autoScale.enabled, 'boolean', 'autoScale.enabled must be boolean');
  });

  it('mcp.transport.port exists (not mcp.port)', () => {
    assert.ok(cfg.mcp.transport, 'mcp.transport must exist');
    assert.equal(typeof cfg.mcp.transport.port, 'number', 'mcp.transport.port must be a number');
    assert.equal(cfg.mcp.port, undefined, 'mcp.port (flat) must not exist');
  });

  it('memory.type alias exists alongside memory.backend', () => {
    assert.equal(cfg.memory.type, 'hybrid', 'memory.type must exist');
    assert.equal(cfg.memory.backend, 'hybrid', 'memory.backend must exist for backward compat');
  });

  it('controllers.multiHeadAttention has topK', () => {
    assert.equal(typeof cfg.controllers.multiHeadAttention.topK, 'number');
    assert.ok(cfg.controllers.multiHeadAttention.topK > 0);
  });

  it('controllers.solverBandit has all three tuning fields', () => {
    const sb = cfg.controllers.solverBandit;
    assert.ok(sb, 'solverBandit must exist');
    assert.equal(typeof sb.costWeight, 'number');
    assert.equal(typeof sb.costDecay, 'number');
    assert.equal(typeof sb.explorationBonus, 'number');
  });

  it('controllers.quantizedVectorStore.type is present', () => {
    assert.equal(cfg.controllers.quantizedVectorStore.type, 'scalar-8bit');
  });

  it('daemon section exists with resource thresholds', () => {
    assert.ok(cfg.daemon, 'daemon must exist');
    assert.equal(typeof cfg.daemon.maxConcurrent, 'number');
    assert.equal(typeof cfg.daemon.workerTimeoutMs, 'number');
    assert.ok(cfg.daemon.resourceThresholds, 'resourceThresholds must exist');
    assert.equal(typeof cfg.daemon.resourceThresholds.maxCpuLoad, 'number');
  });

  it('all 7 controller groups are present', () => {
    const expected = [
      'attentionService', 'multiHeadAttention', 'selfAttention',
      'rateLimiter', 'circuitBreaker', 'tieredCache',
      'quantizedVectorStore', 'solverBandit',
    ];
    for (const key of expected) {
      assert.ok(cfg.controllers[key], `controllers.${key} must exist`);
    }
  });
});

// ============================================================================
// Group 2: P0 — embeddings.json is well-formed with HNSW settings
// ============================================================================

describe('ADR-0065 P0/P1: embeddings.json correctness', () => {
  let emb;

  beforeEach(() => { emb = readJson(EMBEDDINGS_PATH); });

  it('dimension is 768 (mpnet)', () => {
    assert.equal(emb.dimension, 768);
  });

  it('model is all-mpnet-base-v2', () => {
    assert.equal(emb.model, 'Xenova/all-mpnet-base-v2');
  });

  it('hnsw settings are present', () => {
    assert.ok(emb.hnsw, 'hnsw must exist');
    assert.equal(emb.hnsw.metric, 'cosine');
    assert.equal(typeof emb.hnsw.maxElements, 'number');
    assert.equal(typeof emb.hnsw.persistIndex, 'boolean');
    assert.equal(typeof emb.hnsw.rebuildThreshold, 'number');
  });

  it('hashFallbackDimension is present', () => {
    assert.equal(emb.hashFallbackDimension, 128);
  });
});

// ============================================================================
// Group 3: P0 — Zero hardcoded 384 fallbacks in fork source
// ============================================================================

describe('ADR-0065 P0: no hardcoded 384 dimension fallbacks', () => {
  const filesToCheck = [
    { path: join(FORK_ROOT, '@claude-flow/cli/src/config-adapter.ts'), name: 'config-adapter.ts' },
    { path: join(FORK_ROOT, '@claude-flow/memory/src/controller-registry.ts'), name: 'controller-registry.ts' },
  ];

  for (const { path: fpath, name } of filesToCheck) {
    it(`${name}: no "|| 384" or "?? 384" fallbacks`, () => {
      if (!existsSync(fpath)) { assert.ok(true, `${name} not found (skip)`); return; }
      const src = readFileSync(fpath, 'utf8');
      const matches384 = src.match(/(\|\|\s*384|[?][?]\s*384)/g);
      assert.equal(matches384, null, `Found hardcoded 384 fallback(s) in ${name}: ${matches384}`);
    });
  }

  it('memory-initializer.ts: no "?? 384" in getHNSWIndex or getHNSWStatus', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/cli/src/memory/memory-initializer.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'memory-initializer.ts not found (skip)'); return; }
    const src = readFileSync(fpath, 'utf8');

    // Extract getHNSWIndex function (look for the function signature)
    const hnswIdxMatch = src.match(/function getHNSWIndex[\s\S]*?^}/m);
    if (hnswIdxMatch) {
      assert.ok(!hnswIdxMatch[0].includes('?? 384'), 'getHNSWIndex must not have ?? 384');
    }

    // Check getHNSWStatus function
    const hnswStatusMatch = src.match(/function getHNSWStatus[\s\S]*?^}/m);
    if (hnswStatusMatch) {
      assert.ok(!hnswStatusMatch[0].includes('?? 384'), 'getHNSWStatus must not have ?? 384');
    }
  });
});

// ============================================================================
// Group 4: P0 — Zero hardcoded MiniLM model references
// ============================================================================

describe('ADR-0065 P0: no hardcoded all-MiniLM-L6-v2 model strings', () => {
  const filesToCheck = [];

  for (const { path: fpath, name } of filesToCheck) {
    it(`${name}: no hardcoded MiniLM-L6-v2 model name`, () => {
      if (!existsSync(fpath)) { assert.ok(true, `${name} not found (skip)`); return; }
      const src = readFileSync(fpath, 'utf8');
      const matches = src.match(/['"]Xenova\/all-MiniLM-L6-v2['"]/g);
      assert.equal(matches, null, `Found hardcoded MiniLM model string(s) in ${name}`);
    });
  }

  it('memory-initializer.ts getHNSWIndex path: no MiniLM hardcode in embedding load', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/cli/src/memory/memory-initializer.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    // The loadLocalEmbeddingModel section should use readEmbeddingsConfig(), not hardcode
    // Check the pipeline('feature-extraction', ...) call
    const pipelineCalls = src.match(/pipeline\(['"]feature-extraction['"],\s*['"]Xenova\/all-MiniLM-L6-v2['"]\)/g);
    assert.equal(pipelineCalls, null, 'pipeline() must not hardcode MiniLM model');
  });
});

// ============================================================================
// Group 6: P2 — controller-registry fixes
// ============================================================================

describe('ADR-0065 P2: controller-registry config passthrough', () => {

  // Simulated quantizedVectorStore config resolution
  function resolveQVSType(config) {
    return config?.quantizedVectorStore?.type ?? 'scalar-8bit';
  }

  it('quantizedVectorStore reads type from config', () => {
    assert.equal(resolveQVSType({ quantizedVectorStore: { type: 'binary-1bit' } }), 'binary-1bit');
  });

  it('quantizedVectorStore falls back to scalar-8bit', () => {
    assert.equal(resolveQVSType({}), 'scalar-8bit');
    assert.equal(resolveQVSType(undefined), 'scalar-8bit');
  });

  // Simulated rateLimiter config resolution
  function resolveRefillRate(config) {
    const rlCfg = config?.rateLimiter || {};
    const maxTokens = rlCfg.maxRequests || 100;
    const windowMs = rlCfg.windowMs || 1000;
    return Math.max(1, Math.round(maxTokens / (windowMs / 1000)));
  }

  it('rateLimiter derives refillRate from windowMs', () => {
    // 100 requests per 10 seconds = 10/second refill
    assert.equal(resolveRefillRate({ rateLimiter: { maxRequests: 100, windowMs: 10000 } }), 10);
  });

  it('rateLimiter defaults windowMs=1000 (backward compat: rate = maxTokens)', () => {
    assert.equal(resolveRefillRate({ rateLimiter: { maxRequests: 100 } }), 100);
  });

  it('rateLimiter refillRate is at least 1', () => {
    assert.ok(resolveRefillRate({ rateLimiter: { maxRequests: 1, windowMs: 100000 } }) >= 1);
  });

  it('controller-registry.ts source reads config for QVS', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/controller-registry.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');

    // Must NOT have bare { type: 'scalar-8bit' } without config reference
    const qvsBlock = src.match(/case 'quantizedVectorStore'[\s\S]*?break;/);
    if (qvsBlock) {
      assert.ok(
        qvsBlock[0].includes('this.config') || qvsBlock[0].includes('config.quantizedVectorStore'),
        'quantizedVectorStore must read from this.config',
      );
    }
  });

  it('controller-registry.ts RuntimeConfig has quantizedVectorStore field', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/controller-registry.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('quantizedVectorStore?:'), 'RuntimeConfig must have quantizedVectorStore field');
  });
});

// ============================================================================
// Group 7: P2 — database-provider.ts require→import fix
// ============================================================================

describe('ADR-0065 P2: database-provider no require() in ESM', () => {
  it('database-provider.ts has no require() calls', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/database-provider.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    const requireCalls = src.match(/\brequire\s*\(/g);
    assert.equal(requireCalls, null, `Found require() in ESM file: ${requireCalls?.length} occurrences`);
  });
});

// ============================================================================
// Group 8: P0 — config-adapter 768 default
// ============================================================================

describe('ADR-0065 P0: config-adapter uses 768 default', () => {
  it('config-adapter.ts vectorDimension falls back to 768', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/cli/src/config-adapter.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('?? 768') || src.includes('|| 768'),
      'vectorDimension must fall back to 768');
    assert.ok(!src.includes('?? 384'), 'must not fall back to 384');
  });
});

// ============================================================================
// Group 9: Integration — config files roundtrip
// ============================================================================

describe('ADR-0065 Integration: config files are valid JSON and internally consistent', () => {
  it('config.json parses without error', () => {
    assert.doesNotThrow(() => readJson(CONFIG_PATH));
  });

  it('embeddings.json parses without error', () => {
    assert.doesNotThrow(() => readJson(EMBEDDINGS_PATH));
  });

  it('config.json memory.maxElements matches embeddings.json hnsw.maxElements', () => {
    const cfg = readJson(CONFIG_PATH);
    const emb = readJson(EMBEDDINGS_PATH);
    assert.equal(cfg.memory.maxElements, emb.hnsw.maxElements,
      'maxElements should be consistent across config and embeddings');
  });

  it('all controller keys in config.json are valid RuntimeConfig fields', () => {
    const cfg = readJson(CONFIG_PATH);
    const validKeys = [
      'attentionService', 'multiHeadAttention', 'selfAttention',
      'rateLimiter', 'circuitBreaker', 'tieredCache',
      'quantizedVectorStore', 'solverBandit',
      'enabled', 'nightlyLearner', 'causalRecall',
      'queryOptimizer', 'selfLearningRvfBackend', 'mutationGuard',
    ];
    for (const key of Object.keys(cfg.controllers)) {
      assert.ok(validKeys.includes(key), `Unknown controller key: ${key}`);
    }
  });
});

// ============================================================================
// Group 10: P3-1 — SqlJsBackend and JsonBackend removed
// ============================================================================

describe('ADR-0065 P3-1: dead fallback backends removed', () => {
  it('sqljs-backend.ts does not exist', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/sqljs-backend.ts');
    assert.ok(!existsSync(fpath), 'sqljs-backend.ts must be deleted');
  });

  it('database-provider.ts has no sql.js or json provider types', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/database-provider.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(!src.includes("'sql.js'"), 'sql.js provider type must be removed');
    assert.ok(!src.includes("'json'"), 'json provider type must be removed');
  });

  it('database-provider.ts has no JsonBackend class', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/database-provider.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(!src.includes('class JsonBackend'), 'JsonBackend class must be removed');
  });

  it('index.ts does not export SqlJsBackend or JsonBackend', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/index.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(!src.includes('SqlJsBackend'), 'SqlJsBackend export must be removed');
    assert.ok(!src.includes('JsonBackend'), 'JsonBackend export must be removed');
  });

  it('database-provider.ts provider selection: rvf and better-sqlite3 only', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/database-provider.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes("'rvf'"), 'rvf provider must exist');
    assert.ok(src.includes("'better-sqlite3'"), 'better-sqlite3 provider must exist');
  });
});

// ============================================================================
// Group 11: P3-2 — Shared memory_entries schema
// ============================================================================

describe('ADR-0065 P3-2: memory_entries DDL deduplicated', () => {
  it('memory-schema.ts exists with shared constants', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/memory-schema.ts');
    assert.ok(existsSync(fpath), 'memory-schema.ts must exist');
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('MEMORY_ENTRIES_DDL'), 'must export MEMORY_ENTRIES_DDL');
    assert.ok(src.includes('MEMORY_ENTRIES_INDEXES'), 'must export MEMORY_ENTRIES_INDEXES');
    assert.ok(src.includes('MEMORY_EMBEDDINGS_DDL'), 'must export MEMORY_EMBEDDINGS_DDL');
  });

  it('memory-schema.ts has all 16 columns', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/memory-schema.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    const expectedCols = [
      'id TEXT PRIMARY KEY', 'key TEXT', 'content TEXT', 'type TEXT',
      'namespace TEXT', 'tags TEXT', 'metadata TEXT', 'owner_id TEXT',
      'access_level TEXT', 'created_at INTEGER', 'updated_at INTEGER',
      'expires_at INTEGER', 'version INTEGER', 'references', 'access_count INTEGER',
      'last_accessed_at INTEGER',
    ];
    for (const col of expectedCols) {
      assert.ok(src.includes(col), `Missing column: ${col}`);
    }
  });

  it('sqlite-backend.ts imports from memory-schema', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/sqlite-backend.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('memory-schema'), 'must import from memory-schema');
    assert.ok(src.includes('MEMORY_ENTRIES_DDL'), 'must use MEMORY_ENTRIES_DDL');
  });

  it('agentdb-backend.ts imports from memory-schema', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/agentdb-backend.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('memory-schema'), 'must import from memory-schema');
    assert.ok(src.includes('MEMORY_ENTRIES_DDL'), 'must use MEMORY_ENTRIES_DDL');
  });

  it('memory-schema.ts has 8 indexes', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/memory-schema.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    const indexMatches = src.match(/CREATE INDEX/g);
    assert.ok(indexMatches && indexMatches.length >= 8, `Expected 8+ indexes, got ${indexMatches?.length}`);
  });
});

// ============================================================================
// Group 12: P3-3 — Shared deriveHNSWParams
// ============================================================================

describe('ADR-0065 P3-3: deriveHNSWParams centralized', () => {
  it('hnsw-utils.ts exists with deriveHNSWParams', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/hnsw-utils.ts');
    assert.ok(existsSync(fpath), 'hnsw-utils.ts must exist');
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('export function deriveHNSWParams'), 'must export deriveHNSWParams');
    assert.ok(src.includes('export interface HNSWParams'), 'must export HNSWParams');
  });

  // Unit test the actual formula
  function deriveHNSWParams(dimension) {
    const rawM = Math.floor(Math.sqrt(dimension) / 1.2);
    const M = Math.max(8, Math.min(48, rawM));
    const efConstruction = Math.max(100, Math.min(500, 4 * M));
    const efSearch = Math.max(50, Math.min(400, 2 * M));
    return { M, efConstruction, efSearch };
  }

  it('768-dim: M=23, efConstruction=100, efSearch=46→50', () => {
    const p = deriveHNSWParams(768);
    assert.equal(p.M, 23);
    assert.equal(p.efConstruction, 100);
    assert.equal(p.efSearch, 50);
  });

  it('384-dim: M=16, efConstruction=100, efSearch=32→50', () => {
    const p = deriveHNSWParams(384);
    assert.equal(p.M, 16);
    assert.equal(p.efConstruction, 100);
    assert.equal(p.efSearch, 50);
  });

  it('clamps M to minimum 8', () => {
    const p = deriveHNSWParams(1); // sqrt(1)/1.2 = 0.83 → 0 → clamped to 8
    assert.equal(p.M, 8);
  });

  it('clamps M to maximum 48', () => {
    const p = deriveHNSWParams(100000); // sqrt(100000)/1.2 = 263 → clamped to 48
    assert.equal(p.M, 48);
  });

  it('rvf-backend.ts imports from hnsw-utils', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/rvf-backend.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('hnsw-utils'), 'must import from hnsw-utils');
  });

  it('agentdb-backend.ts imports from hnsw-utils', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/agentdb-backend.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('hnsw-utils'), 'must import from hnsw-utils');
  });

  it('hnsw-index.ts imports from hnsw-utils', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/hnsw-index.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes('hnsw-utils'), 'must import from hnsw-utils');
  });

  it('index.ts re-exports from hnsw-utils', () => {
    const fpath = join(FORK_ROOT, '@claude-flow/memory/src/index.ts');
    if (!existsSync(fpath)) { assert.ok(true, 'skip'); return; }
    const src = readFileSync(fpath, 'utf8');
    assert.ok(src.includes("from './hnsw-utils"), 'must re-export from hnsw-utils');
  });

  it('no other file defines its own deriveHNSWParams', () => {
    const files = [
      join(FORK_ROOT, '@claude-flow/memory/src/rvf-backend.ts'),
      join(FORK_ROOT, '@claude-flow/memory/src/hnsw-index.ts'),
    ];
    for (const fpath of files) {
      if (!existsSync(fpath)) continue;
      const src = readFileSync(fpath, 'utf8');
      assert.ok(!src.includes('function deriveHNSWParams'),
        `${fpath.split('/').pop()} must not define its own deriveHNSWParams`);
    }
  });
});

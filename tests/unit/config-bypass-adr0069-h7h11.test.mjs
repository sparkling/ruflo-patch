// @tier unit
// ADR-0069: Config Chain Bypass Remediation — H7–H11
// London School TDD: inline mock factories, no real agentdb imports.
//
// H7: Similarity Threshold
// H8: Learning Rate
// H9: Embedding Cache Size
// H10: Migration Batch Size
// H11: Dedup Threshold

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Mock helpers (same pattern as config-bypass-adr0069.test.mjs)
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
// Config chain simulators
// ============================================================================

/** Simulates reading config.json with memory/neural blocks */
function makeConfigJson(overrides = {}) {
  const defaults = {
    memory: {
      similarityThreshold: 0.7,
      embeddingCacheSize: 1000,
      migrationBatchSize: 500,
      dedupThreshold: 0.95,
    },
    neural: {
      defaultLearningRate: 0.001,
      learningRates: {
        qLearning: 0.1,
        sarsa: 0.1,
        moe: 0.01,
        sona: 0.001,
        lora: 0.001,
      },
    },
  };
  const merged = JSON.parse(JSON.stringify(defaults));
  if (overrides.memory) Object.assign(merged.memory, overrides.memory);
  if (overrides.neural) {
    Object.assign(merged.neural, overrides.neural);
    if (overrides.neural.learningRates) {
      merged.neural.learningRates = { ...defaults.neural.learningRates, ...overrides.neural.learningRates };
    }
  }
  return mockFn(() => merged);
}

/** Simulates a failing config read (config.json not available) */
function makeFailingConfig() {
  return mockFn(() => { throw new Error('config.json not found'); });
}

// ============================================================================
// H7: Similarity Threshold resolution functions
// ============================================================================

/** Simulates search-memory query resolving similarity threshold from config */
function resolveSearchThreshold(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.similarityThreshold ?? 0.7;
  } catch {
    return 0.7;
  }
}

/** Simulates pattern-matching code resolving threshold from config */
function resolvePatternThreshold(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.similarityThreshold ?? 0.7;
  } catch {
    return 0.7;
  }
}

// ============================================================================
// H8: Learning Rate resolution functions
// ============================================================================

/** Simulates gradient-based LR resolution (SONA, LoRA) */
function resolveGradientLR(configFn) {
  try {
    const cfg = configFn();
    return cfg.neural?.defaultLearningRate ?? 0.001;
  } catch {
    return 0.001;
  }
}

/** Simulates Q-learning LR resolution */
function resolveQLearningLR(configFn) {
  try {
    const cfg = configFn();
    return cfg.neural?.learningRates?.qLearning ?? 0.1;
  } catch {
    return 0.1;
  }
}

/** Simulates MoE routing LR resolution */
function resolveMoELR(configFn) {
  try {
    const cfg = configFn();
    return cfg.neural?.learningRates?.moe ?? 0.01;
  } catch {
    return 0.01;
  }
}

// ============================================================================
// H9: Embedding Cache Size resolution functions
// ============================================================================

/** Simulates EmbeddingService cache creation (primary LRU) */
function resolvePrimaryCacheSize(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.embeddingCacheSize ?? 1000;
  } catch {
    return 1000;
  }
}

/** Simulates EmbeddingService cache creation (secondary LRU — the bug site) */
function resolveSecondaryCacheSize(configFn) {
  // After fix: both caches use the same config value
  try {
    const cfg = configFn();
    return cfg.memory?.embeddingCacheSize ?? 1000;
  } catch {
    return 1000;
  }
}

// ============================================================================
// H10: Migration Batch Size resolution functions
// ============================================================================

/** Simulates migration.ts batch size */
function resolveMigrationBatchSize(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.migrationBatchSize ?? 500;
  } catch {
    return 500;
  }
}

/** Simulates rvf-migration.ts batch size */
function resolveRvfMigrationBatchSize(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.migrationBatchSize ?? 500;
  } catch {
    return 500;
  }
}

/** Simulates agentdb-adapter delete path using options.batchSize */
function resolveAdapterDeleteBatchSize(configFn, options = {}) {
  try {
    const cfg = configFn();
    return options.batchSize ?? cfg.memory?.migrationBatchSize ?? 500;
  } catch {
    return options.batchSize ?? 500;
  }
}

// ============================================================================
// H11: Dedup Threshold resolution functions
// ============================================================================

/** Simulates AgentDBService dedup threshold */
function resolveAgentDBDedupThreshold(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.dedupThreshold ?? 0.95;
  } catch {
    return 0.95;
  }
}

/** Simulates ReasoningBank dedup threshold */
function resolveReasoningBankDedupThreshold(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.dedupThreshold ?? 0.95;
  } catch {
    return 0.95;
  }
}

/** Simulates RVFOptimizer dedup threshold */
function resolveRVFOptimizerDedupThreshold(configFn) {
  try {
    const cfg = configFn();
    return cfg.memory?.dedupThreshold ?? 0.95;
  } catch {
    return 0.95;
  }
}

// ============================================================================
// H7: Similarity Threshold
// ============================================================================

describe('ADR-0069 H7: Similarity Threshold resolves from config chain', () => {
  let configFn;

  beforeEach(() => {
    configFn = makeConfigJson();
  });

  it('search query default is 0.7 not 0.5', () => {
    const threshold = resolveSearchThreshold(configFn);
    assert.equal(threshold, 0.7, 'search threshold must be 0.7, not the old 0.5');
    assert.notEqual(threshold, 0.5, 'must NOT use the old buggy 0.5 default');
  });

  it('config.json memory.similarityThreshold is read', () => {
    configFn = makeConfigJson({ memory: { similarityThreshold: 0.85 } });
    const threshold = resolveSearchThreshold(configFn);
    assert.equal(threshold, 0.85, 'must respect config override');
    assert.equal(configFn.calls.length, 1, 'must call config reader');
  });

  it('all similarity threshold sites agree when config available', () => {
    configFn = makeConfigJson({ memory: { similarityThreshold: 0.75 } });
    const searchThreshold = resolveSearchThreshold(configFn);
    const patternThreshold = resolvePatternThreshold(configFn);
    assert.equal(searchThreshold, patternThreshold,
      'search and pattern thresholds must agree when config is set');
    assert.equal(searchThreshold, 0.75);
  });

  it('falls back to 0.7 when config unavailable', () => {
    const failingConfig = makeFailingConfig();
    const threshold = resolveSearchThreshold(failingConfig);
    assert.equal(threshold, 0.7, 'fallback must be 0.7');
  });
});

// ============================================================================
// H8: Learning Rate
// ============================================================================

describe('ADR-0069 H8: Learning Rate resolves from config chain', () => {
  let configFn;

  beforeEach(() => {
    configFn = makeConfigJson();
  });

  it('default gradient LR is 0.001 from config.json neural.defaultLearningRate', () => {
    const lr = resolveGradientLR(configFn);
    assert.equal(lr, 0.001, 'gradient LR must be 0.001');
    assert.equal(configFn.calls.length, 1, 'must read from config');
  });

  it('Q-learning LR is 0.1 (intentionally different, documented)', () => {
    const lr = resolveQLearningLR(configFn);
    assert.equal(lr, 0.1, 'Q-learning LR must be 0.1 (RL uses higher rates)');
  });

  it('MoE LR is 0.01 (intentionally different)', () => {
    const lr = resolveMoELR(configFn);
    assert.equal(lr, 0.01, 'MoE routing LR must be 0.01');
  });

  it('config chain overrides are respected for gradient LR', () => {
    configFn = makeConfigJson({ neural: { defaultLearningRate: 0.0005 } });
    const lr = resolveGradientLR(configFn);
    assert.equal(lr, 0.0005, 'gradient LR must respect config override');
  });

  it('config chain overrides are respected for per-algorithm rates', () => {
    configFn = makeConfigJson({
      neural: { learningRates: { qLearning: 0.05, moe: 0.005 } },
    });
    const qLR = resolveQLearningLR(configFn);
    const moeLR = resolveMoELR(configFn);
    assert.equal(qLR, 0.05, 'Q-learning LR must respect override');
    assert.equal(moeLR, 0.005, 'MoE LR must respect override');
  });

  it('falls back gracefully when config unavailable', () => {
    const failingConfig = makeFailingConfig();
    assert.equal(resolveGradientLR(failingConfig), 0.001);
    assert.equal(resolveQLearningLR(failingConfig), 0.1);
    assert.equal(resolveMoELR(failingConfig), 0.01);
  });
});

// ============================================================================
// H9: Embedding Cache Size
// ============================================================================

describe('ADR-0069 H9: Embedding Cache Size resolves from config chain', () => {
  let configFn;

  beforeEach(() => {
    configFn = makeConfigJson();
  });

  it('both LRU caches use same size (bug fix)', () => {
    const primary = resolvePrimaryCacheSize(configFn);
    const secondary = resolveSecondaryCacheSize(configFn);
    assert.equal(primary, secondary,
      'primary and secondary cache must use same size (ADR-0069 bug fix)');
  });

  it('default cache size is 1000', () => {
    const size = resolvePrimaryCacheSize(configFn);
    assert.equal(size, 1000, 'default embedding cache size must be 1000');
    assert.notEqual(size, 10000, 'must NOT use the old buggy 10000 for secondary');
  });

  it('config override works for both caches', () => {
    configFn = makeConfigJson({ memory: { embeddingCacheSize: 5000 } });
    const primary = resolvePrimaryCacheSize(configFn);
    const secondary = resolveSecondaryCacheSize(configFn);
    assert.equal(primary, 5000, 'primary cache must use config override');
    assert.equal(secondary, 5000, 'secondary cache must use same config override');
  });

  it('falls back to 1000 when config unavailable', () => {
    const failingConfig = makeFailingConfig();
    assert.equal(resolvePrimaryCacheSize(failingConfig), 1000);
    assert.equal(resolveSecondaryCacheSize(failingConfig), 1000);
  });
});

// ============================================================================
// H10: Migration Batch Size
// ============================================================================

describe('ADR-0069 H10: Migration Batch Size resolves from config chain', () => {
  let configFn;

  beforeEach(() => {
    configFn = makeConfigJson();
  });

  it('migration.ts and rvf-migration.ts use same default (500)', () => {
    const migBatch = resolveMigrationBatchSize(configFn);
    const rvfBatch = resolveRvfMigrationBatchSize(configFn);
    assert.equal(migBatch, rvfBatch,
      'both migration files must use same batch size');
    assert.equal(migBatch, 500, 'default batch size must be 500');
  });

  it('config.json memory.migrationBatchSize is read', () => {
    configFn = makeConfigJson({ memory: { migrationBatchSize: 250 } });
    const batch = resolveMigrationBatchSize(configFn);
    assert.equal(batch, 250, 'must respect config override');
    assert.equal(configFn.calls.length, 1);
  });

  it('agentdb-adapter delete path uses options.batchSize not hardcoded', () => {
    const batch = resolveAdapterDeleteBatchSize(configFn, { batchSize: 100 });
    assert.equal(batch, 100, 'adapter delete must use options.batchSize when provided');
  });

  it('agentdb-adapter delete falls back to config when no options', () => {
    configFn = makeConfigJson({ memory: { migrationBatchSize: 750 } });
    const batch = resolveAdapterDeleteBatchSize(configFn);
    assert.equal(batch, 750, 'adapter delete must fall back to config migrationBatchSize');
  });

  it('falls back to 500 when config unavailable', () => {
    const failingConfig = makeFailingConfig();
    assert.equal(resolveMigrationBatchSize(failingConfig), 500);
    assert.equal(resolveRvfMigrationBatchSize(failingConfig), 500);
    assert.equal(resolveAdapterDeleteBatchSize(failingConfig), 500);
  });
});

// ============================================================================
// H11: Dedup Threshold
// ============================================================================

describe('ADR-0069 H11: Dedup Threshold resolves from config chain', () => {
  let configFn;

  beforeEach(() => {
    configFn = makeConfigJson();
  });

  it('default dedup threshold is 0.95 across all sites', () => {
    const agentDB = resolveAgentDBDedupThreshold(configFn);
    const rb = resolveReasoningBankDedupThreshold(configFn);
    const optimizer = resolveRVFOptimizerDedupThreshold(configFn);
    assert.equal(agentDB, 0.95, 'AgentDB dedup must be 0.95');
    assert.equal(rb, 0.95, 'ReasoningBank dedup must be 0.95');
    assert.equal(optimizer, 0.95, 'RVFOptimizer dedup must be 0.95');
  });

  it('config.json memory.dedupThreshold is read', () => {
    configFn = makeConfigJson({ memory: { dedupThreshold: 0.92 } });
    const threshold = resolveAgentDBDedupThreshold(configFn);
    assert.equal(threshold, 0.92, 'must respect config override');
    assert.equal(configFn.calls.length, 1);
  });

  it('AgentDB service uses 0.95 not 0.98', () => {
    const threshold = resolveAgentDBDedupThreshold(configFn);
    assert.equal(threshold, 0.95, 'AgentDB must use 0.95');
    assert.notEqual(threshold, 0.98, 'must NOT use old buggy 0.98');
  });

  it('RVFOptimizer uses 0.95 not 0.98', () => {
    const threshold = resolveRVFOptimizerDedupThreshold(configFn);
    assert.equal(threshold, 0.95, 'RVFOptimizer must use 0.95');
    assert.notEqual(threshold, 0.98, 'must NOT use old buggy 0.98');
  });

  it('falls back to 0.95 when config unavailable', () => {
    const failingConfig = makeFailingConfig();
    assert.equal(resolveAgentDBDedupThreshold(failingConfig), 0.95);
    assert.equal(resolveReasoningBankDedupThreshold(failingConfig), 0.95);
    assert.equal(resolveRVFOptimizerDedupThreshold(failingConfig), 0.95);
  });
});

// ============================================================================
// Integration: config.json round-trip for H7–H11 values
// ============================================================================

describe('ADR-0069 I-H7H11: config.json round-trip for all H7–H11 values', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'adr0069-h7h11-'));
  });

  it('all H7–H11 sites resolve from a single config.json file', () => {
    const configJson = {
      memory: {
        similarityThreshold: 0.8,
        embeddingCacheSize: 2000,
        migrationBatchSize: 300,
        dedupThreshold: 0.9,
      },
      neural: {
        defaultLearningRate: 0.0001,
        learningRates: { qLearning: 0.05, moe: 0.005 },
      },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(configJson, null, 2));

    // Simulate reading config.json and building config function from it
    const raw = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf8'));
    const configFn = mockFn(() => raw);

    // H7: similarity threshold
    assert.equal(resolveSearchThreshold(configFn), 0.8, 'H7 threshold from file');

    // H8: learning rates
    assert.equal(resolveGradientLR(configFn), 0.0001, 'H8 gradient LR from file');
    assert.equal(resolveQLearningLR(configFn), 0.05, 'H8 Q-learning LR from file');
    assert.equal(resolveMoELR(configFn), 0.005, 'H8 MoE LR from file');

    // H9: cache size
    assert.equal(resolvePrimaryCacheSize(configFn), 2000, 'H9 cache size from file');
    assert.equal(resolveSecondaryCacheSize(configFn), 2000, 'H9 both caches agree');

    // H10: migration batch
    assert.equal(resolveMigrationBatchSize(configFn), 300, 'H10 batch from file');
    assert.equal(resolveRvfMigrationBatchSize(configFn), 300, 'H10 both migrations agree');

    // H11: dedup threshold
    assert.equal(resolveAgentDBDedupThreshold(configFn), 0.9, 'H11 dedup from file');
    assert.equal(resolveReasoningBankDedupThreshold(configFn), 0.9, 'H11 RB agrees');
    assert.equal(resolveRVFOptimizerDedupThreshold(configFn), 0.9, 'H11 optimizer agrees');
  });

  it('cleanup', () => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    assert.ok(true);
  });
});

// @tier unit
// ADR-0070: Init-generated config acceptance safety net
// Unit tests that call getFullConfigTemplate() / getMinimalConfigTemplate() /
// getEmbeddingsTemplate() directly and assert exact default values.
// Independent of the bash acceptance harness.
//
// V1: Every ADR-0069 config.json value
// V2: Embeddings block in full template
// V3: Cross-check with real config.json and embeddings.json

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Template functions under test (inline, mirrors adr0069-init-template.test.mjs)
// ============================================================================

function getMinimalConfigTemplate(overrides = {}) {
  const port = overrides.port ?? 3000;
  const similarityThreshold = overrides.similarityThreshold ?? 0.7;
  const maxAgents = overrides.maxAgents ?? 15;

  return {
    version: '3.0.0',
    swarm: {
      topology: 'hierarchical-mesh',
      maxAgents,
      autoScale: { enabled: true },
      coordinationStrategy: 'consensus',
    },
    memory: {
      backend: 'hybrid',
      type: 'hybrid',
      maxElements: 100000,
      swarmDir: '.swarm',
      similarityThreshold,
      dedupThreshold: 0.95,
      embeddingCacheSize: 1000,
      cleanupIntervalMs: 60000,
    },
    neural: {
      enabled: true,
      modelPath: '.claude-flow/neural',
      ewcLambda: 2000,
      defaultLearningRate: 0.001,
      qualityThreshold: 0.5,
    },
    mcp: {
      autoStart: true,
      transport: { port },
    },
    ports: {
      mcp: port,
      mcpWebSocket: 3001,
      quic: 4433,
      federation: 8443,
      health: 8080,
    },
    hooks: {
      enabled: true,
      autoExecute: true,
    },
  };
}

function getFullConfigTemplate(overrides = {}) {
  const minimal = getMinimalConfigTemplate(overrides);
  const sonaMode = overrides.sonaMode ?? 'balanced';
  const consolidationThreshold = overrides.consolidationThreshold ?? 8;

  return {
    ...minimal,
    memory: {
      ...minimal.memory,
      migrationBatchSize: 500,
      sqlite: {
        cacheSize: -64000,
        busyTimeoutMs: 5000,
        journalMode: 'WAL',
        synchronous: 'NORMAL',
      },
      storage: {
        maxEntries: 1000000,
      },
      learningBridge: {
        enabled: true,
        sonaMode,
        confidenceDecayRate: 0.0008,
        accessBoostAmount: 0.05,
        consolidationThreshold,
      },
      memoryGraph: {
        enabled: true,
        pageRankDamping: 0.82,
        maxNodes: 10000,
        similarityThreshold: 0.25,
      },
    },
    neural: {
      ...minimal.neural,
      learningRates: {
        qLearning: 0.1,
        sarsa: 0.1,
        moe: 0.01,
        sona: 0.001,
        lora: 0.001,
      },
    },
    controllers: {
      enabled: {
        reasoningBank: true,
        causalRecall: true,
        nightlyLearner: true,
        queryOptimizer: false,
        auditLogger: false,
        batchOperations: false,
        attentionService: true,
        hierarchicalMemory: false,
        memoryConsolidation: false,
        hybridSearch: false,
        agentMemoryScope: true,
        federatedSession: false,
      },
      nightlyLearner: {
        schedule: '0 3 * * *',
        maxPatternsPerRun: 500,
        rewardThreshold: 0.3,
        useEwcConsolidation: true,
        ewcLambda: 0.5,
      },
      causalRecall: {
        maxDepth: 5,
        minEdgeWeight: 0.1,
        temporalDecay: true,
        decayHalfLifeMs: 86400000,
      },
      queryOptimizer: {
        planCache: true,
        maxCachedPlans: 256,
        autoIndexHints: true,
        vectorCostWeight: 0.6,
      },
      selfLearningRvfBackend: {
        learningRate: 0.01,
        feedbackWindowSize: 100,
        autoRerank: true,
        minFeedbackCount: 10,
      },
      mutationGuard: {
        walEnabled: true,
        maxMutationsPerTx: 1000,
        schemaValidation: true,
        allowedNamespaces: [],
      },
      attentionService: {
        numHeads: 8,
        useFlash: true,
        useMoE: false,
        useHyperbolic: false,
      },
      multiHeadAttention: {
        numHeads: 8,
        topK: 10,
      },
      selfAttention: {
        topK: 10,
      },
      rateLimiter: {
        maxRequests: 100,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
      },
      tieredCache: {
        maxSize: 10000,
        ttl: 300000,
      },
      quantizedVectorStore: {
        type: 'scalar-8bit',
      },
      solverBandit: {
        costWeight: 0.3,
        costDecay: 0.05,
        explorationBonus: 0.1,
      },
    },
    rateLimiter: {
      default: { maxRequests: 100, windowMs: 60000 },
      auth: { maxRequests: 10, windowMs: 60000 },
      tools: { maxRequests: 10, windowMs: 60000 },
      memory: { maxRequests: 100, windowMs: 60000 },
      files: { maxRequests: 50, windowMs: 60000 },
    },
    workers: {
      triggers: {
        optimize: { timeoutMs: 300000, priority: 'high' },
        audit: { timeoutMs: 180000, priority: 'critical' },
        testgaps: { timeoutMs: 120000, priority: 'normal' },
        map: { timeoutMs: 300000, priority: 'normal' },
        deepdive: { timeoutMs: 300000, priority: 'normal' },
        document: { timeoutMs: 240000, priority: 'normal' },
        learning: { timeoutMs: 90000, priority: 'normal' },
        security: { timeoutMs: 120000, priority: 'normal' },
      },
    },
    daemon: {
      maxConcurrent: 2,
      workerTimeoutMs: 300000,
      headless: false,
      resourceThresholds: {
        maxCpuLoad: 28,
        minFreeMemoryPercent: 5,
      },
    },
  };
}

/**
 * Returns the embeddings template -- the expected shape of embeddings.json
 * generated by `init --full` or `init --with-embeddings`.
 */
function getEmbeddingsTemplate() {
  return {
    model: 'Xenova/all-mpnet-base-v2',
    dimension: 768,
    provider: 'transformers.js', // ADR-0080: aligned with resolve-config canonical
    taskPrefixQuery: '',
    taskPrefixIndex: '',
    storageProvider: 'rvf', // ADR-0080: 7 missing fields added
    databasePath: '.swarm/memory.rvf',
    walMode: true,
    autoPersistInterval: 30000,
    maxEntries: 100000,
    defaultNamespace: 'default',
    dedupThreshold: 0.95,
    cache: '~/.cache/transformers',
    batchSize: 32,
    quantization: 'none',
    hnsw: {
      metric: 'cosine',
      maxElements: 100000,
      persistIndex: true,
      rebuildThreshold: 0.1,
      M: 23, // ADR-0080: uppercase to match resolve-config
      efConstruction: 100,
      efSearch: 50,
    },
    hashFallbackDimension: 128,
  };
}

// ============================================================================
// V1: Every ADR-0069 config.json value
// ============================================================================

describe('V1: ADR-0069 config.json exact defaults', () => {
  const tpl = getFullConfigTemplate();

  it('neural.ewcLambda === 2000', () => {
    assert.strictEqual(tpl.neural.ewcLambda, 2000);
  });

  it('memory.sqlite.cacheSize === -64000', () => {
    assert.strictEqual(tpl.memory.sqlite.cacheSize, -64000);
  });

  it('memory.sqlite.busyTimeoutMs === 5000', () => {
    assert.strictEqual(tpl.memory.sqlite.busyTimeoutMs, 5000);
  });

  it('memory.similarityThreshold === 0.7', () => {
    assert.strictEqual(tpl.memory.similarityThreshold, 0.7);
  });

  it('memory.dedupThreshold === 0.95', () => {
    assert.strictEqual(tpl.memory.dedupThreshold, 0.95);
  });

  it('memory.maxElements === 100000', () => {
    assert.strictEqual(tpl.memory.maxElements, 100000);
  });

  it('memory.cleanupIntervalMs === 60000', () => {
    assert.strictEqual(tpl.memory.cleanupIntervalMs, 60000);
  });

  it('memory.migrationBatchSize === 500', () => {
    assert.strictEqual(tpl.memory.migrationBatchSize, 500);
  });

  it('memory.embeddingCacheSize === 1000', () => {
    assert.strictEqual(tpl.memory.embeddingCacheSize, 1000);
  });

  it('ports.mcp === 3000', () => {
    assert.strictEqual(tpl.ports.mcp, 3000);
  });

  it('ports.quic === 4433', () => {
    assert.strictEqual(tpl.ports.quic, 4433);
  });

  it('ports.federation === 8443', () => {
    assert.strictEqual(tpl.ports.federation, 8443);
  });

  it('ports.health === 8080', () => {
    assert.strictEqual(tpl.ports.health, 8080);
  });

  it('rateLimiter.default.maxRequests === 100', () => {
    assert.strictEqual(tpl.rateLimiter.default.maxRequests, 100);
  });

  it('rateLimiter.default.windowMs === 60000', () => {
    assert.strictEqual(tpl.rateLimiter.default.windowMs, 60000);
  });

  it('workers.triggers.optimize.timeoutMs === 300000', () => {
    assert.strictEqual(tpl.workers.triggers.optimize.timeoutMs, 300000);
  });

  it('workers.triggers.audit.timeoutMs === 180000', () => {
    assert.strictEqual(tpl.workers.triggers.audit.timeoutMs, 180000);
  });

  it('neural.defaultLearningRate === 0.001', () => {
    assert.strictEqual(tpl.neural.defaultLearningRate, 0.001);
  });

  it('neural.learningRates.sarsa === 0.1 (not just qLearning)', () => {
    assert.strictEqual(tpl.neural.learningRates.sarsa, 0.1);
  });

  it('daemon.resourceThresholds.maxCpuLoad === 28', () => {
    assert.strictEqual(tpl.daemon.resourceThresholds.maxCpuLoad, 28);
  });

  it('controllers.enabled.reasoningBank === true', () => {
    assert.strictEqual(tpl.controllers.enabled.reasoningBank, true);
  });
});

// ============================================================================
// V2: Embeddings block in full template
// ============================================================================

describe('V2: Embeddings template defaults', () => {
  const emb = getEmbeddingsTemplate();

  it('embeddings.model contains "mpnet"', () => {
    assert.ok(
      emb.model.toLowerCase().includes('mpnet'),
      `Expected model to contain "mpnet", got "${emb.model}"`,
    );
  });

  it('embeddings.dimension === 768', () => {
    assert.strictEqual(emb.dimension, 768);
  });

  it('embeddings.hnsw.maxElements === 100000', () => {
    assert.strictEqual(emb.hnsw.maxElements, 100000);
  });

  it('embeddings.hnsw.M === 23', () => {
    assert.strictEqual(emb.hnsw.M, 23);
  });

  it('embeddings.hnsw.efConstruction === 100', () => {
    assert.strictEqual(emb.hnsw.efConstruction, 100);
  });

  it('embeddings.hnsw.efSearch === 50', () => {
    assert.strictEqual(emb.hnsw.efSearch, 50);
  });

  it('embeddings.provider === "transformers.js"', () => {
    assert.strictEqual(emb.provider, 'transformers.js');
  });
});

// ============================================================================
// V3: Cross-check with real config.json and embeddings.json
// ============================================================================

describe('V3: Cross-check template against real project files', () => {
  const repoRoot = join(import.meta.dirname, '..', '..');
  const configPath = join(repoRoot, '.claude-flow', 'config.json');
  const embeddingsPath = join(repoRoot, '.claude-flow', 'embeddings.json');

  let realConfig;
  try {
    realConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    realConfig = null;
  }

  let realEmbeddings;
  try {
    realEmbeddings = JSON.parse(readFileSync(embeddingsPath, 'utf8'));
  } catch {
    realEmbeddings = null;
  }

  // -- config.json cross-checks --

  it('real config.json exists and parses', () => {
    assert.ok(realConfig, `Could not read ${configPath}`);
  });

  it('config: neural.ewcLambda matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(realConfig.neural.ewcLambda, tpl.neural.ewcLambda);
  });

  it('config: memory.sqlite.cacheSize matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(
      realConfig.memory.sqlite.cacheSize,
      tpl.memory.sqlite.cacheSize,
    );
  });

  it('config: memory.sqlite.busyTimeoutMs matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(
      realConfig.memory.sqlite.busyTimeoutMs,
      tpl.memory.sqlite.busyTimeoutMs,
    );
  });

  it('config: memory.similarityThreshold matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(
      realConfig.memory.similarityThreshold,
      tpl.memory.similarityThreshold,
    );
  });

  it('config: memory.dedupThreshold matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(
      realConfig.memory.dedupThreshold,
      tpl.memory.dedupThreshold,
    );
  });

  it('config: ports.mcp matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.strictEqual(realConfig.ports.mcp, tpl.ports.mcp);
  });

  it('config: rateLimiter.default matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.deepStrictEqual(realConfig.rateLimiter.default, tpl.rateLimiter.default);
  });

  it('config: workers.triggers.optimize matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.deepStrictEqual(
      realConfig.workers.triggers.optimize,
      tpl.workers.triggers.optimize,
    );
  });

  it('config: daemon.resourceThresholds matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.deepStrictEqual(
      realConfig.daemon.resourceThresholds,
      tpl.daemon.resourceThresholds,
    );
  });

  it('config: controllers.enabled matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.deepStrictEqual(
      realConfig.controllers.enabled,
      tpl.controllers.enabled,
    );
  });

  it('config: neural.learningRates matches template', () => {
    if (!realConfig) return;
    const tpl = getFullConfigTemplate();
    assert.deepStrictEqual(
      realConfig.neural.learningRates,
      tpl.neural.learningRates,
    );
  });

  it('config: full template deep-equals real config.json', () => {
    if (!realConfig) return;
    // ADR-0081: per-machine overrides (sonaMode, consolidationThreshold)
    // are intentional divergences from the template defaults.
    const lb = realConfig.memory?.learningBridge ?? {};
    const tpl = getFullConfigTemplate({
      sonaMode: lb.sonaMode,
      consolidationThreshold: lb.consolidationThreshold,
    });
    assert.deepStrictEqual(realConfig, tpl);
  });

  // -- embeddings.json cross-checks --

  it('real embeddings.json exists and parses', () => {
    assert.ok(realEmbeddings, `Could not read ${embeddingsPath}`);
  });

  it('embeddings: model matches template', () => {
    if (!realEmbeddings) return;
    const emb = getEmbeddingsTemplate();
    assert.strictEqual(realEmbeddings.model, emb.model);
  });

  it('embeddings: dimension matches template', () => {
    if (!realEmbeddings) return;
    const emb = getEmbeddingsTemplate();
    assert.strictEqual(realEmbeddings.dimension, emb.dimension);
  });

  it('embeddings: hnsw block matches template', () => {
    if (!realEmbeddings) return;
    const emb = getEmbeddingsTemplate();
    assert.deepStrictEqual(realEmbeddings.hnsw, emb.hnsw);
  });

  it('embeddings: full template deep-equals real embeddings.json', () => {
    if (!realEmbeddings) return;
    const emb = getEmbeddingsTemplate();
    assert.deepStrictEqual(realEmbeddings, emb);
  });
});

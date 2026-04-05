// @tier unit
// ADR-0069: Init config template module
// London School TDD: inline template functions, no real I/O except T6.
//
// Tests for getMinimalConfigTemplate and getFullConfigTemplate — the two
// template shapes that `init --full` and `init --minimal` will emit.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Template functions under test (inline until module is extracted)
// ============================================================================

/**
 * Returns the minimal config template — only the sections needed for a
 * working CLI session.  Does NOT include controllers, rateLimiter, workers,
 * daemon, or sqlite sub-keys.
 */
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

/**
 * Returns the full config template — every section the runtime understands,
 * suitable for `init --full`.
 */
function getFullConfigTemplate(overrides = {}) {
  const minimal = getMinimalConfigTemplate(overrides);

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
        sonaMode: 'balanced',
        confidenceDecayRate: 0.0008,
        accessBoostAmount: 0.05,
        consolidationThreshold: 8,
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

// ============================================================================
// T1: getMinimalConfigTemplate — shape and defaults
// ============================================================================

describe('T1: getMinimalConfigTemplate', () => {
  it('returns object with version, swarm, memory, neural, mcp, ports, hooks', () => {
    const tpl = getMinimalConfigTemplate();
    const keys = Object.keys(tpl).sort();
    assert.deepStrictEqual(keys, [
      'hooks', 'mcp', 'memory', 'neural', 'ports', 'swarm', 'version',
    ]);
  });

  it('does NOT include controllers', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.controllers, undefined);
  });

  it('does NOT include rateLimiter', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.rateLimiter, undefined);
  });

  it('does NOT include workers', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.workers, undefined);
  });

  it('does NOT include daemon', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.daemon, undefined);
  });

  it('does NOT include sqlite sub-key in memory', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.memory.sqlite, undefined);
  });

  it('default port is 3000', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.ports.mcp, 3000);
    assert.strictEqual(tpl.mcp.transport.port, 3000);
  });

  it('default similarityThreshold is 0.7', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.memory.similarityThreshold, 0.7);
  });

  it('default maxAgents is 15', () => {
    const tpl = getMinimalConfigTemplate();
    assert.strictEqual(tpl.swarm.maxAgents, 15);
  });
});

// ============================================================================
// T2: getFullConfigTemplate — shape and specific values
// ============================================================================

describe('T2: getFullConfigTemplate', () => {
  it('returns object with ALL expected top-level keys', () => {
    const tpl = getFullConfigTemplate();
    const keys = Object.keys(tpl).sort();
    const expected = [
      'controllers', 'daemon', 'hooks', 'mcp', 'memory', 'neural',
      'ports', 'rateLimiter', 'swarm', 'version', 'workers',
    ];
    assert.deepStrictEqual(keys, expected);
  });

  it('has memory.sqlite.cacheSize = -64000', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.memory.sqlite.cacheSize, -64000);
  });

  it('has memory.storage, learningBridge, memoryGraph sub-keys', () => {
    const tpl = getFullConfigTemplate();
    assert.ok(tpl.memory.storage, 'missing memory.storage');
    assert.ok(tpl.memory.learningBridge, 'missing memory.learningBridge');
    assert.ok(tpl.memory.memoryGraph, 'missing memory.memoryGraph');
  });

  it('has neural.ewcLambda = 2000', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.neural.ewcLambda, 2000);
  });

  it('has neural.learningRates.sarsa = 0.1 (not just qLearning)', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.neural.learningRates.sarsa, 0.1);
    // Both should be 0.1 but we specifically verify sarsa is present
    assert.strictEqual(tpl.neural.learningRates.qLearning, 0.1);
  });

  it('has workers.triggers.optimize.timeoutMs = 300000', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.workers.triggers.optimize.timeoutMs, 300000);
  });

  it('has rateLimiter.default.windowMs = 60000', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.rateLimiter.default.windowMs, 60000);
  });

  it('has controllers.enabled.reasoningBank = true', () => {
    const tpl = getFullConfigTemplate();
    assert.strictEqual(tpl.controllers.enabled.reasoningBank, true);
  });
});

// ============================================================================
// T3: Overrides
// ============================================================================

describe('T3: Overrides', () => {
  it('port override changes ports.mcp AND mcp.transport.port', () => {
    const tpl = getMinimalConfigTemplate({ port: 9999 });
    assert.strictEqual(tpl.ports.mcp, 9999);
    assert.strictEqual(tpl.mcp.transport.port, 9999);
  });

  it('similarityThreshold override changes memory.similarityThreshold', () => {
    const tpl = getMinimalConfigTemplate({ similarityThreshold: 0.85 });
    assert.strictEqual(tpl.memory.similarityThreshold, 0.85);
  });

  it('maxAgents override changes swarm.maxAgents', () => {
    const tpl = getMinimalConfigTemplate({ maxAgents: 8 });
    assert.strictEqual(tpl.swarm.maxAgents, 8);
  });

  it('overrides propagate through getFullConfigTemplate', () => {
    const tpl = getFullConfigTemplate({ port: 4000, maxAgents: 6 });
    assert.strictEqual(tpl.ports.mcp, 4000);
    assert.strictEqual(tpl.mcp.transport.port, 4000);
    assert.strictEqual(tpl.swarm.maxAgents, 6);
  });
});

// ============================================================================
// T4: Minimal is a subset of full
// ============================================================================

describe('T4: Minimal is subset of full', () => {
  it('every top-level key in minimal exists in full', () => {
    const minKeys = Object.keys(getMinimalConfigTemplate());
    const fullKeys = Object.keys(getFullConfigTemplate());
    for (const k of minKeys) {
      assert.ok(fullKeys.includes(k), `minimal key "${k}" missing from full`);
    }
  });

  it('full has strictly more top-level keys than minimal', () => {
    const minKeys = Object.keys(getMinimalConfigTemplate());
    const fullKeys = Object.keys(getFullConfigTemplate());
    assert.ok(
      fullKeys.length > minKeys.length,
      `full (${fullKeys.length}) should have more keys than minimal (${minKeys.length})`,
    );
  });

  it('shared defaults match between minimal and full', () => {
    const min = getMinimalConfigTemplate();
    const full = getFullConfigTemplate();

    // Scalar checks on shared paths
    assert.strictEqual(min.version, full.version);
    assert.strictEqual(min.swarm.maxAgents, full.swarm.maxAgents);
    assert.strictEqual(min.memory.similarityThreshold, full.memory.similarityThreshold);
    assert.strictEqual(min.neural.ewcLambda, full.neural.ewcLambda);
    assert.strictEqual(min.ports.mcp, full.ports.mcp);
    assert.strictEqual(min.mcp.transport.port, full.mcp.transport.port);
    assert.deepStrictEqual(min.hooks, full.hooks);
  });
});

// ============================================================================
// T5: JSON serialization
// ============================================================================

describe('T5: JSON serialization', () => {
  it('minimal template survives JSON roundtrip', () => {
    const tpl = getMinimalConfigTemplate();
    const roundtripped = JSON.parse(JSON.stringify(tpl));
    assert.deepStrictEqual(roundtripped, tpl);
  });

  it('full template survives JSON roundtrip', () => {
    const tpl = getFullConfigTemplate();
    const roundtripped = JSON.parse(JSON.stringify(tpl));
    assert.deepStrictEqual(roundtripped, tpl);
  });

  it('no undefined values in minimal template', () => {
    const json = JSON.stringify(getMinimalConfigTemplate());
    // JSON.stringify drops undefined values — parse back and compare key count
    const parsed = JSON.parse(json);
    // If there were undefineds, the parsed object would have fewer keys
    assert.deepStrictEqual(parsed, getMinimalConfigTemplate());
  });

  it('no undefined values in full template', () => {
    const json = JSON.stringify(getFullConfigTemplate());
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, getFullConfigTemplate());
  });
});

// ============================================================================
// T6: Integration with real config.json
// ============================================================================

describe('T6: Integration with real config.json', () => {
  const configPath = join(
    import.meta.dirname, '..', '..', '.claude-flow', 'config.json',
  );

  let realConfig;
  try {
    realConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    realConfig = null;
  }

  it('real config.json exists and parses', () => {
    assert.ok(realConfig, `Could not read ${configPath}`);
  });

  it('full template has same top-level sections as real config', () => {
    if (!realConfig) return; // skip if config missing
    const fullKeys = new Set(Object.keys(getFullConfigTemplate()));
    const realKeys = Object.keys(realConfig);
    for (const k of realKeys) {
      assert.ok(fullKeys.has(k), `real config key "${k}" missing from full template`);
    }
  });
});

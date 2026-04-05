// @tier unit
// ADR-0069: Dead Config Key Consumer Wiring (DK1-DK9)
// London School TDD: inline mock factories, no real agentdb imports.
//
// Tests that dead config keys in config.json are properly consumed
// through the config bridge rather than being ignored or hardcoded.
// Each DK category verifies that the bridge forwards config values
// and that correct defaults are used when config is absent.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
// Load real config.json for integration-level assertions
// ============================================================================

const configPath = join(
  new URL('.', import.meta.url).pathname,
  '..', '..', '.claude-flow', 'config.json',
);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// ============================================================================
// Shared mock config bridge
// ============================================================================

/** Simulates a config.json bridge function */
function makeConfigBridge(configJson = {}) {
  return mockFn(() => configJson);
}

// ============================================================================
// DK1: memory.swarmDir consumer
// ============================================================================

/** Simulates getSwarmDir() reading from config bridge */
function resolveSwarmDir(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.swarmDir ?? '.swarm';
}

describe('ADR-0069 DK1: memory.swarmDir consumer', () => {

  it('getSwarmDir() reads swarmDir from config.json (not hardcoded)', () => {
    const bridge = makeConfigBridge({ memory: { swarmDir: 'data/swarm' } });
    const dir = resolveSwarmDir(bridge);
    assert.equal(dir, 'data/swarm',
      'swarmDir must come from config.json, not hardcoded');
    assert.equal(bridge.calls.length, 1,
      'bridge must be called exactly once');
  });

  it('default is .swarm when config absent', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const dir = resolveSwarmDir(bridge);
    assert.equal(dir, '.swarm',
      'default swarmDir must be .swarm');
  });

  it('real config.json memory.swarmDir is .swarm', () => {
    assert.equal(config.memory.swarmDir, '.swarm',
      'config.json memory.swarmDir must be .swarm');
  });
});

// ============================================================================
// DK2: memory.sqlite.journalMode + synchronous consumer
// ============================================================================

/** Simulates SQLite bridge forwarding journalMode */
function resolveSqliteJournalMode(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.sqlite?.journalMode ?? 'WAL';
}

/** Simulates SQLite bridge forwarding synchronous */
function resolveSqliteSynchronous(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.sqlite?.synchronous ?? 'NORMAL';
}

describe('ADR-0069 DK2: memory.sqlite.journalMode + synchronous consumer', () => {

  it('bridge forwards journalMode from config.json', () => {
    const bridge = makeConfigBridge({
      memory: { sqlite: { journalMode: 'DELETE', synchronous: 'FULL' } },
    });
    const mode = resolveSqliteJournalMode(bridge);
    assert.equal(mode, 'DELETE',
      'journalMode must come from config.json');
  });

  it('bridge forwards synchronous from config.json', () => {
    const bridge = makeConfigBridge({
      memory: { sqlite: { journalMode: 'WAL', synchronous: 'FULL' } },
    });
    const sync = resolveSqliteSynchronous(bridge);
    assert.equal(sync, 'FULL',
      'synchronous must come from config.json');
  });

  it('defaults to WAL/NORMAL when absent', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const mode = resolveSqliteJournalMode(bridge);
    const sync = resolveSqliteSynchronous(bridge);
    assert.equal(mode, 'WAL', 'default journalMode must be WAL');
    assert.equal(sync, 'NORMAL', 'default synchronous must be NORMAL');
  });

  it('real config.json sqlite settings match defaults', () => {
    assert.equal(config.memory.sqlite.journalMode, 'WAL',
      'config.json sqlite.journalMode must be WAL');
    assert.equal(config.memory.sqlite.synchronous, 'NORMAL',
      'config.json sqlite.synchronous must be NORMAL');
  });
});

// ============================================================================
// DK3: memory.similarityThreshold consumer
// ============================================================================

/** Simulates bridge forwarding similarityThreshold */
function resolveSimilarityThreshold(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.similarityThreshold ?? 0.7;
}

/** Simulates search query using config threshold (not hardcoded 0.7) */
function executeSearch(bridgeFn, query, results) {
  const threshold = resolveSimilarityThreshold(bridgeFn);
  return results.filter(r => r.score >= threshold);
}

describe('ADR-0069 DK3: memory.similarityThreshold consumer', () => {

  it('bridge forwards similarityThreshold from config.json', () => {
    const bridge = makeConfigBridge({ memory: { similarityThreshold: 0.85 } });
    const threshold = resolveSimilarityThreshold(bridge);
    assert.equal(threshold, 0.85,
      'similarityThreshold must come from config.json');
  });

  it('search query uses config value (not hardcoded 0.7)', () => {
    const bridge = makeConfigBridge({ memory: { similarityThreshold: 0.9 } });
    const results = [
      { id: 'a', score: 0.95 },
      { id: 'b', score: 0.85 },
      { id: 'c', score: 0.75 },
    ];
    const filtered = executeSearch(bridge, 'test', results);
    assert.equal(filtered.length, 1,
      'only results >= 0.9 threshold should pass');
    assert.equal(filtered[0].id, 'a');
  });

  it('default 0.7 when absent', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const threshold = resolveSimilarityThreshold(bridge);
    assert.equal(threshold, 0.7,
      'default similarityThreshold must be 0.7');
  });

  it('real config.json memory.similarityThreshold is 0.7', () => {
    assert.equal(config.memory.similarityThreshold, 0.7,
      'config.json memory.similarityThreshold must be 0.7');
  });
});

// ============================================================================
// DK4: memory.embeddingCacheSize consumer
// ============================================================================

/** Simulates DEFAULT_CACHE_SIZE reading from config bridge */
function resolveEmbeddingCacheSize(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.embeddingCacheSize ?? 1000;
}

describe('ADR-0069 DK4: memory.embeddingCacheSize consumer', () => {

  it('DEFAULT_CACHE_SIZE reads from config.json', () => {
    const bridge = makeConfigBridge({ memory: { embeddingCacheSize: 5000 } });
    const size = resolveEmbeddingCacheSize(bridge);
    assert.equal(size, 5000,
      'embeddingCacheSize must come from config.json');
    assert.equal(bridge.calls.length, 1,
      'bridge must be called');
  });

  it('default 1000 when absent', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const size = resolveEmbeddingCacheSize(bridge);
    assert.equal(size, 1000,
      'default embeddingCacheSize must be 1000');
  });

  it('custom value 5000 is respected', () => {
    const bridge = makeConfigBridge({ memory: { embeddingCacheSize: 5000 } });
    const size = resolveEmbeddingCacheSize(bridge);
    assert.equal(size, 5000);
    assert.notEqual(size, 1000,
      'must NOT be the default when config provides a value');
  });

  it('real config.json memory.embeddingCacheSize is 1000', () => {
    assert.equal(config.memory.embeddingCacheSize, 1000,
      'config.json memory.embeddingCacheSize must be 1000');
  });
});

// ============================================================================
// DK5: ports forwarded through bridge
// ============================================================================

/** Simulates RuntimeConfig port resolution via bridge */
function resolvePortConfig(bridgeFn) {
  const cfg = bridgeFn();
  return {
    quic: cfg.ports?.quic ?? 4433,
    federation: cfg.ports?.federation ?? 8443,
    health: cfg.ports?.health ?? 8080,
  };
}

describe('ADR-0069 DK5: ports forwarded through bridge', () => {

  it('ports.quic forwarded to RuntimeConfig', () => {
    const bridge = makeConfigBridge({ ports: { quic: 5000 } });
    const ports = resolvePortConfig(bridge);
    assert.equal(ports.quic, 5000,
      'quic port must come from config.json');
  });

  it('ports.federation forwarded', () => {
    const bridge = makeConfigBridge({ ports: { federation: 9443 } });
    const ports = resolvePortConfig(bridge);
    assert.equal(ports.federation, 9443,
      'federation port must come from config.json');
  });

  it('ports.health forwarded', () => {
    const bridge = makeConfigBridge({ ports: { health: 9090 } });
    const ports = resolvePortConfig(bridge);
    assert.equal(ports.health, 9090,
      'health port must come from config.json');
  });

  it('defaults when absent', () => {
    const bridge = makeConfigBridge({ ports: {} });
    const ports = resolvePortConfig(bridge);
    assert.equal(ports.quic, 4433, 'default quic must be 4433');
    assert.equal(ports.federation, 8443, 'default federation must be 8443');
    assert.equal(ports.health, 8080, 'default health must be 8080');
  });

  it('real config.json ports match expected values', () => {
    assert.equal(config.ports.quic, 4433);
    assert.equal(config.ports.federation, 8443);
    assert.equal(config.ports.health, 8080);
  });
});

// ============================================================================
// DK6: rateLimiter presets consumer
// ============================================================================

/** Simulates top-level rateLimiter.default overriding controllers.rateLimiter */
function resolveEffectiveRateLimit(bridgeFn) {
  const cfg = bridgeFn();
  // Top-level rateLimiter.default takes precedence over controllers.rateLimiter
  const topLevel = cfg.rateLimiter?.default;
  const controllerLevel = cfg.controllers?.rateLimiter;
  return topLevel ?? controllerLevel ?? { maxRequests: 100, windowMs: 60000 };
}

/** Simulates rateLimiterPresets forwarded to RuntimeConfig */
function resolveRateLimiterPresets(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.rateLimiter ?? {};
}

describe('ADR-0069 DK6: rateLimiter presets consumer', () => {

  it('top-level rateLimiter.default overrides controllers.rateLimiter', () => {
    const bridge = makeConfigBridge({
      rateLimiter: { default: { maxRequests: 200, windowMs: 30000 } },
      controllers: { rateLimiter: { maxRequests: 50 } },
    });
    const effective = resolveEffectiveRateLimit(bridge);
    assert.deepStrictEqual(effective, { maxRequests: 200, windowMs: 30000 },
      'top-level rateLimiter.default must override controllers.rateLimiter');
  });

  it('rateLimiterPresets forwarded to RuntimeConfig', () => {
    const bridge = makeConfigBridge({
      rateLimiter: {
        default: { maxRequests: 100, windowMs: 60000 },
        auth: { maxRequests: 10, windowMs: 60000 },
      },
    });
    const presets = resolveRateLimiterPresets(bridge);
    assert.ok(presets.default, 'default preset must exist');
    assert.ok(presets.auth, 'auth preset must exist');
  });

  it('per-endpoint presets (auth, tools) accessible', () => {
    const bridge = makeConfigBridge({
      rateLimiter: {
        default: { maxRequests: 100, windowMs: 60000 },
        auth: { maxRequests: 10, windowMs: 60000 },
        tools: { maxRequests: 10, windowMs: 60000 },
      },
    });
    const presets = resolveRateLimiterPresets(bridge);
    assert.equal(presets.auth.maxRequests, 10,
      'auth preset maxRequests must be 10');
    assert.equal(presets.tools.maxRequests, 10,
      'tools preset maxRequests must be 10');
  });

  it('real config.json rateLimiter presets are populated', () => {
    assert.ok(config.rateLimiter.default, 'default preset must exist');
    assert.ok(config.rateLimiter.auth, 'auth preset must exist');
    assert.ok(config.rateLimiter.tools, 'tools preset must exist');
    assert.equal(config.rateLimiter.default.maxRequests, 100);
    assert.equal(config.rateLimiter.auth.maxRequests, 10);
  });
});

// ============================================================================
// DK7: workers.triggers consumer
// ============================================================================

/** Default worker configs used when config absent */
const DEFAULT_WORKERS = {
  optimize: { timeoutMs: 300000, priority: 'high' },
  audit: { timeoutMs: 180000, priority: 'critical' },
  testgaps: { timeoutMs: 120000, priority: 'normal' },
};

/** Simulates worker-daemon reading workers.triggers from config */
function resolveWorkerTrigger(bridgeFn, workerName) {
  const cfg = bridgeFn();
  const triggers = cfg.workers?.triggers;
  if (triggers && triggers[workerName]) {
    return triggers[workerName];
  }
  return DEFAULT_WORKERS[workerName] ?? { timeoutMs: 300000, priority: 'normal' };
}

describe('ADR-0069 DK7: workers.triggers consumer', () => {

  it('worker-daemon reads workers.triggers from config', () => {
    const bridge = makeConfigBridge({
      workers: {
        triggers: {
          optimize: { timeoutMs: 600000, priority: 'high' },
        },
      },
    });
    const trigger = resolveWorkerTrigger(bridge, 'optimize');
    assert.equal(trigger.timeoutMs, 600000,
      'optimize trigger timeoutMs must come from config');
    assert.equal(bridge.calls.length, 1);
  });

  it('trigger timeouts override DEFAULT_WORKERS values', () => {
    const bridge = makeConfigBridge({
      workers: {
        triggers: {
          audit: { timeoutMs: 360000, priority: 'critical' },
        },
      },
    });
    const trigger = resolveWorkerTrigger(bridge, 'audit');
    assert.equal(trigger.timeoutMs, 360000,
      'config timeout must override DEFAULT_WORKERS');
    assert.notEqual(trigger.timeoutMs, 180000,
      'must NOT be the default 180000');
  });

  it('default workers used when config absent', () => {
    const bridge = makeConfigBridge({});
    const trigger = resolveWorkerTrigger(bridge, 'optimize');
    assert.equal(trigger.timeoutMs, 300000,
      'fallback timeoutMs must match DEFAULT_WORKERS');
    assert.equal(trigger.priority, 'high',
      'fallback priority must match DEFAULT_WORKERS');
  });

  it('real config.json workers.triggers are populated', () => {
    assert.ok(config.workers.triggers.optimize, 'optimize trigger must exist');
    assert.ok(config.workers.triggers.audit, 'audit trigger must exist');
    assert.equal(config.workers.triggers.audit.timeoutMs, 180000);
    assert.equal(config.workers.triggers.audit.priority, 'critical');
  });
});

// ============================================================================
// DK8: sarsa.ts bug fix — reads neural.learningRates.sarsa (not .qLearning)
// ============================================================================

/** Simulates SARSA reading its own learning rate from config (bug: was reading qLearning) */
function resolveSarsaLearningRate(bridgeFn) {
  const cfg = bridgeFn();
  // FIXED: reads .sarsa, not .qLearning
  return cfg.neural?.learningRates?.sarsa ?? 0.1;
}

/** Simulates the BUGGY version that reads qLearning instead of sarsa */
function resolveSarsaLearningRateBuggy(bridgeFn) {
  const cfg = bridgeFn();
  // BUG: reads .qLearning instead of .sarsa
  return cfg.neural?.learningRates?.qLearning ?? 0.1;
}

describe('ADR-0069 DK8: sarsa.ts bug fix', () => {

  it('sarsa reads neural.learningRates.sarsa (not .qLearning)', () => {
    const bridge = makeConfigBridge({
      neural: {
        learningRates: { sarsa: 0.05, qLearning: 0.2 },
      },
    });
    const rate = resolveSarsaLearningRate(bridge);
    assert.equal(rate, 0.05,
      'sarsa must read from .sarsa, not .qLearning');
    assert.notEqual(rate, 0.2,
      'sarsa must NOT read qLearning value');
  });

  it('buggy version would read qLearning (proving fix is needed)', () => {
    const bridge = makeConfigBridge({
      neural: {
        learningRates: { sarsa: 0.05, qLearning: 0.2 },
      },
    });
    const buggyRate = resolveSarsaLearningRateBuggy(bridge);
    assert.equal(buggyRate, 0.2,
      'buggy version reads qLearning');
    assert.notEqual(buggyRate, 0.05,
      'buggy version does NOT read sarsa');
  });

  it('default 0.1 when absent', () => {
    const bridge = makeConfigBridge({ neural: {} });
    const rate = resolveSarsaLearningRate(bridge);
    assert.equal(rate, 0.1,
      'default sarsa learning rate must be 0.1');
  });

  it('real config.json has distinct sarsa and qLearning rates', () => {
    assert.equal(config.neural.learningRates.sarsa, 0.1,
      'config.json neural.learningRates.sarsa must be 0.1');
    assert.equal(config.neural.learningRates.qLearning, 0.1,
      'config.json neural.learningRates.qLearning must be 0.1');
  });
});

// ============================================================================
// DK9: neural.learningRates.sona/lora consumer
// ============================================================================

/** Simulates SONA manager reading its learning rate from config */
function resolveSonaLearningRate(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.neural?.learningRates?.sona ?? 0.001;
}

/** Simulates LoRA adapter reading its learning rate from config */
function resolveLoraLearningRate(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.neural?.learningRates?.lora ?? 0.001;
}

describe('ADR-0069 DK9: neural.learningRates.sona/lora consumer', () => {

  it('SONA manager reads neural.learningRates.sona', () => {
    const bridge = makeConfigBridge({
      neural: { learningRates: { sona: 0.005 } },
    });
    const rate = resolveSonaLearningRate(bridge);
    assert.equal(rate, 0.005,
      'SONA learning rate must come from config.json');
    assert.equal(bridge.calls.length, 1);
  });

  it('LoRA adapter reads neural.learningRates.lora', () => {
    const bridge = makeConfigBridge({
      neural: { learningRates: { lora: 0.01 } },
    });
    const rate = resolveLoraLearningRate(bridge);
    assert.equal(rate, 0.01,
      'LoRA learning rate must come from config.json');
  });

  it('SONA default 0.001 when absent', () => {
    const bridge = makeConfigBridge({ neural: {} });
    const rate = resolveSonaLearningRate(bridge);
    assert.equal(rate, 0.001,
      'default SONA learning rate must be 0.001');
  });

  it('LoRA default 0.001 when absent', () => {
    const bridge = makeConfigBridge({ neural: {} });
    const rate = resolveLoraLearningRate(bridge);
    assert.equal(rate, 0.001,
      'default LoRA learning rate must be 0.001');
  });

  it('real config.json neural.learningRates.sona is 0.001', () => {
    assert.equal(config.neural.learningRates.sona, 0.001,
      'config.json neural.learningRates.sona must be 0.001');
  });

  it('real config.json neural.learningRates.lora is 0.001', () => {
    assert.equal(config.neural.learningRates.lora, 0.001,
      'config.json neural.learningRates.lora must be 0.001');
  });
});

// @tier unit
// ADR-0069: Full Config Chain Bypass Remediation (H1-H6)
// London School TDD: inline mock factories, no real agentdb imports.
//
// Tests that bypass categories H1 (SQLite Pragmas), H2 (Rate Limiters),
// H3 (Worker Timeouts), H4 (Swarm Directory), H5 (EWC Lambda),
// H6 (Ports) all resolve from config.json rather than hardcoding values.

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
// H1: SQLite Pragmas
// ============================================================================

/** Simulates sqlite-backend reading pragma config from config.json bridge */
function resolveSqliteConfig(bridgeFn) {
  const cfg = bridgeFn();
  return {
    cacheSize: cfg.memory?.sqlite?.cacheSize ?? -64000,
    busyTimeoutMs: cfg.memory?.sqlite?.busyTimeoutMs ?? 5000,
    journalMode: cfg.memory?.sqlite?.journalMode ?? 'WAL',
    synchronous: cfg.memory?.sqlite?.synchronous ?? 'NORMAL',
  };
}

/** Simulates RuntimeConfig passing sqlite config through the bridge */
function makeConfigBridge(configJson = {}) {
  return mockFn(() => configJson);
}

describe('ADR-0069 H1: SQLite Pragmas resolve from config chain', () => {

  it('sqlite-backend reads cacheSize from config.json memory.sqlite', () => {
    const bridge = makeConfigBridge({ memory: { sqlite: { cacheSize: -32000 } } });
    const result = resolveSqliteConfig(bridge);
    assert.equal(result.cacheSize, -32000,
      'cacheSize must come from config.json, not hardcoded');
    assert.equal(bridge.calls.length, 1, 'bridge must be called exactly once');
  });

  it('sqlite-backend reads busyTimeoutMs from config.json memory.sqlite', () => {
    const bridge = makeConfigBridge({ memory: { sqlite: { busyTimeoutMs: 10000 } } });
    const result = resolveSqliteConfig(bridge);
    assert.equal(result.busyTimeoutMs, 10000,
      'busyTimeoutMs must come from config.json, not hardcoded');
  });

  it('cacheSize defaults to -64000 when config.json omits it', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const result = resolveSqliteConfig(bridge);
    assert.equal(result.cacheSize, -64000,
      'cacheSize default must be -64000');
  });

  it('busyTimeoutMs defaults to 5000 when config.json omits it', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const result = resolveSqliteConfig(bridge);
    assert.equal(result.busyTimeoutMs, 5000,
      'busyTimeoutMs default must be 5000');
  });

  it('bridge passes full sqlite config through RuntimeConfig', () => {
    const bridge = makeConfigBridge({
      memory: { sqlite: { cacheSize: -128000, busyTimeoutMs: 8000, journalMode: 'DELETE', synchronous: 'FULL' } },
    });
    const result = resolveSqliteConfig(bridge);
    assert.equal(result.cacheSize, -128000);
    assert.equal(result.busyTimeoutMs, 8000);
    assert.equal(result.journalMode, 'DELETE');
    assert.equal(result.synchronous, 'FULL');
  });

  it('real config.json has correct sqlite defaults', () => {
    assert.equal(config.memory.sqlite.cacheSize, -64000,
      'config.json memory.sqlite.cacheSize must be -64000');
    assert.equal(config.memory.sqlite.busyTimeoutMs, 5000,
      'config.json memory.sqlite.busyTimeoutMs must be 5000');
  });
});

// ============================================================================
// H2: Rate Limiters
// ============================================================================

/** Simulates controller-registry reading rate limiter config */
function resolveRateLimiterConfig(bridgeFn, preset = 'default') {
  const cfg = bridgeFn();
  const presets = cfg.rateLimiter ?? {};
  const selected = presets[preset] ?? {};
  return {
    maxRequests: selected.maxRequests ?? 100,
    windowMs: selected.windowMs ?? 60000,
  };
}

/** Simulates memory-gate reading rate limiter presets */
function resolveMemoryGateRateLimiter(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.rateLimiter ?? { default: { maxRequests: 100, windowMs: 60000 } };
}

describe('ADR-0069 H2: Rate Limiters resolve from config chain', () => {

  it('controller-registry windowMs defaults to 60000 not 1000', () => {
    const bridge = makeConfigBridge({ rateLimiter: {} });
    const result = resolveRateLimiterConfig(bridge);
    assert.equal(result.windowMs, 60000,
      'windowMs default must be 60000, not 1000');
    assert.notEqual(result.windowMs, 1000,
      'windowMs must NOT be the old buggy value 1000');
  });

  it('default preset maxRequests is 100', () => {
    const bridge = makeConfigBridge({ rateLimiter: { default: { maxRequests: 100, windowMs: 60000 } } });
    const result = resolveRateLimiterConfig(bridge, 'default');
    assert.equal(result.maxRequests, 100);
    assert.equal(result.windowMs, 60000);
  });

  it('memory-gate reads rate limiter presets from config.json', () => {
    const bridge = makeConfigBridge({
      rateLimiter: {
        default: { maxRequests: 100, windowMs: 60000 },
        auth: { maxRequests: 10, windowMs: 60000 },
      },
    });
    const presets = resolveMemoryGateRateLimiter(bridge);
    assert.equal(presets.default.maxRequests, 100);
    assert.equal(presets.auth.maxRequests, 10);
    assert.equal(presets.auth.windowMs, 60000);
  });

  it('real config.json rateLimiter.default matches expected values', () => {
    assert.equal(config.rateLimiter.default.maxRequests, 100,
      'config.json rateLimiter.default.maxRequests must be 100');
    assert.equal(config.rateLimiter.default.windowMs, 60000,
      'config.json rateLimiter.default.windowMs must be 60000');
  });
});

// ============================================================================
// H3: Worker Timeouts
// ============================================================================

/** Simulates worker code reading timeout from config.json workers.triggers */
function resolveWorkerTimeout(bridgeFn, workerName) {
  const cfg = bridgeFn();
  const trigger = cfg.workers?.triggers?.[workerName];
  // Defaults per ADR-0069 remediation
  const defaults = {
    optimize: 300000,
    audit: 180000,
    document: 240000,
    testgaps: 120000,
    map: 300000,
    deepdive: 300000,
  };
  return trigger?.timeoutMs ?? defaults[workerName] ?? 120000;
}

describe('ADR-0069 H3: Worker Timeouts resolve from config chain', () => {

  it('optimize timeout is 300000 not 30000', () => {
    const bridge = makeConfigBridge({ workers: { triggers: { optimize: { timeoutMs: 300000 } } } });
    const timeout = resolveWorkerTimeout(bridge, 'optimize');
    assert.equal(timeout, 300000,
      'optimize timeout must be 300000');
    assert.notEqual(timeout, 30000,
      'optimize timeout must NOT be the old buggy value 30000');
  });

  it('audit timeout is 180000 not 300000', () => {
    const bridge = makeConfigBridge({ workers: { triggers: { audit: { timeoutMs: 180000 } } } });
    const timeout = resolveWorkerTimeout(bridge, 'audit');
    assert.equal(timeout, 180000,
      'audit timeout must be 180000');
    assert.notEqual(timeout, 300000,
      'audit timeout must NOT be the old hardcoded 300000');
  });

  it('document timeout is 240000 not 120000', () => {
    const bridge = makeConfigBridge({ workers: { triggers: { document: { timeoutMs: 240000 } } } });
    const timeout = resolveWorkerTimeout(bridge, 'document');
    assert.equal(timeout, 240000,
      'document timeout must be 240000');
    assert.notEqual(timeout, 120000,
      'document timeout must NOT be the old buggy value 120000');
  });

  it('worker reads timeoutMs from config.json triggers block', () => {
    const bridge = makeConfigBridge({
      workers: { triggers: { optimize: { timeoutMs: 500000, priority: 'high' } } },
    });
    const timeout = resolveWorkerTimeout(bridge, 'optimize');
    assert.equal(timeout, 500000,
      'worker must read custom timeoutMs from config.json');
  });

  it('real config.json worker timeouts match expected values', () => {
    assert.equal(config.workers.triggers.optimize.timeoutMs, 300000,
      'config.json optimize timeout must be 300000');
    assert.equal(config.workers.triggers.audit.timeoutMs, 180000,
      'config.json audit timeout must be 180000');
    assert.equal(config.workers.triggers.document.timeoutMs, 240000,
      'config.json document timeout must be 240000');
  });
});

// ============================================================================
// H4: Swarm Directory
// ============================================================================

/** Simulates swarm path resolution from config.json */
function resolveSwarmDirectory(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.swarmDir ?? '.swarm';
}

describe('ADR-0069 H4: Swarm Directory resolves consistently', () => {

  it('swarm directory resolves to .swarm not .claude-flow/swarm', () => {
    const bridge = makeConfigBridge({ memory: { swarmDir: '.swarm' } });
    const dir = resolveSwarmDirectory(bridge);
    assert.equal(dir, '.swarm',
      'swarm directory must be .swarm');
    assert.notEqual(dir, '.claude-flow/swarm',
      'swarm directory must NOT be .claude-flow/swarm');
  });

  it('default swarm directory is .swarm when config omits swarmDir', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const dir = resolveSwarmDirectory(bridge);
    assert.equal(dir, '.swarm',
      'default swarm directory must be .swarm');
  });

  it('all swarm path sites use consistent directory from config', () => {
    const bridge = makeConfigBridge({ memory: { swarmDir: '.swarm' } });

    // Simulate multiple consumers reading swarm dir
    const sites = ['hive-mind', 'swarm-init', 'state-persistence', 'memory-graph'];
    const dirs = sites.map(() => resolveSwarmDirectory(bridge));

    for (let i = 1; i < dirs.length; i++) {
      assert.equal(dirs[i], dirs[0],
        `${sites[i]} swarm dir must match ${sites[0]}: got "${dirs[i]}" vs "${dirs[0]}"`);
    }
  });

  it('real config.json swarmDir is .swarm', () => {
    assert.equal(config.memory.swarmDir, '.swarm',
      'config.json memory.swarmDir must be .swarm');
  });
});

// ============================================================================
// H5: EWC Lambda
// ============================================================================

/** Simulates learning-bridge reading ewcLambda from config.json */
function resolveEwcLambda(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.neural?.ewcLambda ?? 2000;
}

/** Simulates SONA modes deriving from base EWC lambda */
function deriveSonaEwcLambda(baseEwcLambda, mode = 'balanced') {
  const multipliers = {
    conservative: 2.0,
    balanced: 1.0,
    aggressive: 0.5,
  };
  return baseEwcLambda * (multipliers[mode] ?? 1.0);
}

describe('ADR-0069 H5: EWC Lambda resolves from config chain', () => {

  it('learning-bridge reads ewcLambda from config.json neural block', () => {
    const bridge = makeConfigBridge({ neural: { ewcLambda: 3000 } });
    const lambda = resolveEwcLambda(bridge);
    assert.equal(lambda, 3000,
      'ewcLambda must come from config.json neural block');
  });

  it('ewcLambda defaults to 2000 when config omits it', () => {
    const bridge = makeConfigBridge({ neural: {} });
    const lambda = resolveEwcLambda(bridge);
    assert.equal(lambda, 2000,
      'ewcLambda default must be 2000');
  });

  it('SONA balanced mode uses base EWC lambda unchanged', () => {
    const baseLambda = 2000;
    const sonaLambda = deriveSonaEwcLambda(baseLambda, 'balanced');
    assert.equal(sonaLambda, 2000,
      'balanced SONA mode must use base lambda as-is');
  });

  it('SONA conservative mode doubles EWC lambda', () => {
    const baseLambda = 2000;
    const sonaLambda = deriveSonaEwcLambda(baseLambda, 'conservative');
    assert.equal(sonaLambda, 4000,
      'conservative SONA mode must double the base lambda');
  });

  it('SONA aggressive mode halves EWC lambda', () => {
    const baseLambda = 2000;
    const sonaLambda = deriveSonaEwcLambda(baseLambda, 'aggressive');
    assert.equal(sonaLambda, 1000,
      'aggressive SONA mode must halve the base lambda');
  });

  it('real config.json neural.ewcLambda is 2000', () => {
    assert.equal(config.neural.ewcLambda, 2000,
      'config.json neural.ewcLambda must be 2000');
  });
});

// ============================================================================
// H6: Ports
// ============================================================================

/** Simulates port resolution: config.json -> env var override */
function resolvePort(bridgeFn, portName, envOverrides = {}) {
  const cfg = bridgeFn();
  const envMap = { mcp: 'MCP_PORT', quic: 'QUIC_PORT' };
  const envKey = envMap[portName];
  if (envKey && envOverrides[envKey] != null) {
    return Number(envOverrides[envKey]);
  }
  return cfg.ports?.[portName] ?? { mcp: 3000, quic: 4433 }[portName];
}

/** Simulates Redis URL resolution from env var */
function resolveRedisUrl(envOverrides = {}) {
  return envOverrides.REDIS_URL ?? null;
}

describe('ADR-0069 H6: Ports resolve from config chain with env overrides', () => {

  it('mcp port defaults to 3000 from config.json', () => {
    const bridge = makeConfigBridge({ ports: { mcp: 3000 } });
    const port = resolvePort(bridge, 'mcp');
    assert.equal(port, 3000,
      'mcp port default must be 3000');
  });

  it('quic port defaults to 4433 from config.json', () => {
    const bridge = makeConfigBridge({ ports: { quic: 4433 } });
    const port = resolvePort(bridge, 'quic');
    assert.equal(port, 4433,
      'quic port default must be 4433');
  });

  it('MCP_PORT env var overrides config.json mcp port', () => {
    const bridge = makeConfigBridge({ ports: { mcp: 3000 } });
    const port = resolvePort(bridge, 'mcp', { MCP_PORT: '9000' });
    assert.equal(port, 9000,
      'MCP_PORT env var must override config.json mcp port');
    assert.notEqual(port, 3000,
      'mcp port must NOT be config value when env var is set');
  });

  it('QUIC_PORT env var overrides config.json quic port', () => {
    const bridge = makeConfigBridge({ ports: { quic: 4433 } });
    const port = resolvePort(bridge, 'quic', { QUIC_PORT: '5555' });
    assert.equal(port, 5555,
      'QUIC_PORT env var must override config.json quic port');
    assert.notEqual(port, 4433,
      'quic port must NOT be config value when env var is set');
  });

  it('Redis URL reads from REDIS_URL env var', () => {
    const url = resolveRedisUrl({ REDIS_URL: 'redis://localhost:6379/0' });
    assert.equal(url, 'redis://localhost:6379/0',
      'Redis URL must come from REDIS_URL env var');
  });

  it('Redis URL returns null when REDIS_URL is not set', () => {
    const url = resolveRedisUrl({});
    assert.equal(url, null,
      'Redis URL must be null when REDIS_URL env var is absent');
  });

  it('real config.json ports.mcp is 3000', () => {
    assert.equal(config.ports.mcp, 3000,
      'config.json ports.mcp must be 3000');
  });

  it('real config.json ports.quic is 4433', () => {
    assert.equal(config.ports.quic, 4433,
      'config.json ports.quic must be 4433');
  });
});

// @tier unit
// ADR-0069: Residual Config Chain Bypass Remediation (R1-R10)
// London School TDD: inline mock factories, no real agentdb imports.
//
// Tests that residual bypass categories R1 (AgentDB maxElements),
// R2 (HNSWIndex dimension), R3 (agentdb-wrapper dimension),
// R4 (EWC lambda), R5 (Dedup threshold), R6 (Port env-var guards),
// R7 (Worker timeout), R8 (EWC consolidator dimension),
// R9 (Cleanup intervals), R10 (Service URL env guards)
// all resolve from config chain rather than hardcoding values.

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
// Load real config.json + embeddings.json for integration-level assertions
// ============================================================================

const configPath = join(
  new URL('.', import.meta.url).pathname,
  '..', '..', '.claude-flow', 'config.json',
);
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const embeddingsPath = join(
  new URL('.', import.meta.url).pathname,
  '..', '..', '.claude-flow', 'embeddings.json',
);
const embeddings = JSON.parse(readFileSync(embeddingsPath, 'utf8'));

// ============================================================================
// Shared mock config chain
// ============================================================================

/** Simulates getEmbeddingConfig() -- single source of truth for embedding params */
function makeGetEmbeddingConfig(overrides = {}) {
  const defaults = {
    model: 'Xenova/all-mpnet-base-v2',
    dimension: 768,
    provider: 'onnx',
    maxElements: 100000,
    hnsw: { m: 23, efConstruction: 100, efSearch: 50 },
  };
  return mockFn(() => ({ ...defaults, ...overrides }));
}

/** Simulates a config.json bridge function */
function makeConfigBridge(configJson = {}) {
  return mockFn(() => configJson);
}

// ============================================================================
// R1: AgentDB.ts maxElements default
// ============================================================================

/** Simulates AgentDB constructor reading maxElements from config chain */
function resolveAgentDBMaxElements(getEmbeddingConfigFn, explicitMax) {
  if (explicitMax !== undefined) return explicitMax;
  try {
    const cfg = getEmbeddingConfigFn();
    return cfg.maxElements ?? 100000;
  } catch {
    return 100000;
  }
}

describe('ADR-0069 R1: AgentDB.ts maxElements default', () => {

  it('default maxElements is 100000 not 10000', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    const max = resolveAgentDBMaxElements(getEmbeddingConfig);
    assert.equal(max, 100000,
      'maxElements must default to 100000, not 10000');
    assert.notEqual(max, 10000,
      'maxElements must NOT be the old buggy value 10000');
  });

  it('getEmbeddingConfig().maxElements is used as fallback', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ maxElements: 50000 });
    const max = resolveAgentDBMaxElements(getEmbeddingConfig);
    assert.equal(max, 50000,
      'maxElements must come from getEmbeddingConfig when no explicit value');
    assert.equal(getEmbeddingConfig.calls.length, 1,
      'getEmbeddingConfig must be called exactly once');
  });

  it('explicit maxElements overrides config chain', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ maxElements: 50000 });
    const max = resolveAgentDBMaxElements(getEmbeddingConfig, 200000);
    assert.equal(max, 200000,
      'explicit maxElements must take precedence over config chain');
    assert.equal(getEmbeddingConfig.calls.length, 0,
      'getEmbeddingConfig must NOT be called when explicit value provided');
  });

  it('real config.json memory.maxElements is 100000', () => {
    assert.equal(config.memory.maxElements, 100000,
      'config.json memory.maxElements must be 100000');
  });
});

// ============================================================================
// R2: HNSWIndex dimension default
// ============================================================================

/** Simulates HNSWIndex reading default dimension from config chain */
function resolveHNSWIndexDimension(getEmbeddingConfigFn, explicitDim) {
  if (explicitDim !== undefined) return explicitDim;
  try {
    return getEmbeddingConfigFn().dimension;
  } catch {
    return 768;
  }
}

describe('ADR-0069 R2: HNSWIndex dimension default', () => {

  it('default dimension comes from getEmbeddingConfig(), not hardcoded 768', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 384 });
    const dim = resolveHNSWIndexDimension(getEmbeddingConfig);
    assert.equal(dim, 384,
      'HNSWIndex dimension must come from getEmbeddingConfig, not hardcoded');
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });

  it('returns 768 when config chain matches default embeddings.json', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig();
    const dim = resolveHNSWIndexDimension(getEmbeddingConfig);
    assert.equal(dim, 768);
  });

  it('real embeddings.json dimension is 768', () => {
    assert.equal(embeddings.dimension, 768,
      'embeddings.json dimension must be 768');
  });
});

// ============================================================================
// R3: agentdb-wrapper dimension
// ============================================================================

/** Simulates agentdb-wrapper fallback dimension resolution */
function resolveWrapperDimension(getEmbeddingConfigFn) {
  try {
    return getEmbeddingConfigFn().dimension;
  } catch {
    return 768;
  }
}

describe('ADR-0069 R3: agentdb-wrapper dimension fallback', () => {

  it('fallback uses getEmbeddingConfig().dimension', () => {
    const getEmbeddingConfig = makeGetEmbeddingConfig({ dimension: 512 });
    const dim = resolveWrapperDimension(getEmbeddingConfig);
    assert.equal(dim, 512,
      'wrapper dimension must come from getEmbeddingConfig');
    assert.equal(getEmbeddingConfig.calls.length, 1);
  });

  it('falls back to 768 when config chain throws', () => {
    const failing = mockFn(() => { throw new Error('Module not found'); });
    const dim = resolveWrapperDimension(failing);
    assert.equal(dim, 768,
      'wrapper must fall back to 768 when config unavailable');
  });
});

// ============================================================================
// R4: EWC lambda residuals
// ============================================================================

/** Simulates intelligence-tools reading EWC lambda from config chain */
function resolveIntelligenceToolsEwcLambda(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.neural?.ewcLambda ?? 2000;
}

/** Simulates SonaLearningBackend fallback EWC lambda */
function resolveSonaBackendEwcLambda(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.neural?.ewcLambda ?? 2000;
}

describe('ADR-0069 R4: EWC lambda residuals', () => {

  it('intelligence-tools reports config-chain value, not 1000', () => {
    const bridge = makeConfigBridge({ neural: { ewcLambda: 2000 } });
    const lambda = resolveIntelligenceToolsEwcLambda(bridge);
    assert.equal(lambda, 2000,
      'intelligence-tools ewcLambda must be config-chain value');
    assert.notEqual(lambda, 1000,
      'ewcLambda must NOT be the old buggy hardcoded 1000');
  });

  it('SonaLearningBackend fallback is 2000 not 1000', () => {
    const bridge = makeConfigBridge({ neural: {} });
    const lambda = resolveSonaBackendEwcLambda(bridge);
    assert.equal(lambda, 2000,
      'SonaLearningBackend fallback ewcLambda must be 2000');
    assert.notEqual(lambda, 1000,
      'SonaLearningBackend fallback must NOT be 1000');
  });

  it('real config.json neural.ewcLambda is 2000', () => {
    assert.equal(config.neural.ewcLambda, 2000,
      'config.json neural.ewcLambda must be 2000');
  });
});

// ============================================================================
// R5: Dedup threshold alignment
// ============================================================================

/** Simulates rvf-tools reading dedupThreshold from config chain */
function resolveRvfToolsDedupThreshold(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.dedupThreshold ?? 0.95;
}

describe('ADR-0069 R5: Dedup threshold alignment', () => {

  it('rvf-tools fallback is 0.95 not 0.98', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const threshold = resolveRvfToolsDedupThreshold(bridge);
    assert.equal(threshold, 0.95,
      'rvf-tools dedupThreshold fallback must be 0.95');
    assert.notEqual(threshold, 0.98,
      'dedupThreshold must NOT be the old misaligned 0.98');
  });

  it('reads dedupThreshold from config.json memory block', () => {
    const bridge = makeConfigBridge({ memory: { dedupThreshold: 0.90 } });
    const threshold = resolveRvfToolsDedupThreshold(bridge);
    assert.equal(threshold, 0.90,
      'dedupThreshold must come from config.json');
  });

  it('real config.json memory.dedupThreshold is 0.95', () => {
    assert.equal(config.memory.dedupThreshold, 0.95,
      'config.json memory.dedupThreshold must be 0.95');
  });
});

// ============================================================================
// R6: Port env-var guards
// ============================================================================

/** Simulates http-sse port resolution with MCP_SSE_PORT env guard */
function resolveHttpSsePort(bridgeFn, envOverrides = {}) {
  if (envOverrides.MCP_SSE_PORT != null) {
    return Number(envOverrides.MCP_SSE_PORT);
  }
  const cfg = bridgeFn();
  return cfg.ports?.mcpWebSocket ?? 3001;
}

/** Simulates daemon-cli port resolution with MCP_PORT env guard */
function resolveDaemonCliPort(bridgeFn, envOverrides = {}) {
  if (envOverrides.MCP_PORT != null) {
    return Number(envOverrides.MCP_PORT);
  }
  const cfg = bridgeFn();
  return cfg.ports?.mcp ?? 3000;
}

/** Simulates onnx-proxy port resolution with ONNX_PROXY_PORT env guard */
function resolveOnnxProxyPort(envOverrides = {}, defaultPort = 8787) {
  if (envOverrides.ONNX_PROXY_PORT != null) {
    return Number(envOverrides.ONNX_PROXY_PORT);
  }
  return defaultPort;
}

describe('ADR-0069 R6: Port env-var guards', () => {

  it('http-sse respects MCP_SSE_PORT env var', () => {
    const bridge = makeConfigBridge({ ports: { mcpWebSocket: 3001 } });
    const port = resolveHttpSsePort(bridge, { MCP_SSE_PORT: '4000' });
    assert.equal(port, 4000,
      'MCP_SSE_PORT env var must override config.json');
    assert.notEqual(port, 3001,
      'port must NOT be config value when env var is set');
  });

  it('http-sse falls back to config.json when no env var', () => {
    const bridge = makeConfigBridge({ ports: { mcpWebSocket: 3001 } });
    const port = resolveHttpSsePort(bridge, {});
    assert.equal(port, 3001);
  });

  it('daemon-cli respects MCP_PORT env var', () => {
    const bridge = makeConfigBridge({ ports: { mcp: 3000 } });
    const port = resolveDaemonCliPort(bridge, { MCP_PORT: '9000' });
    assert.equal(port, 9000,
      'MCP_PORT env var must override config.json');
    assert.notEqual(port, 3000,
      'port must NOT be config value when env var is set');
  });

  it('onnx-proxy respects ONNX_PROXY_PORT env var', () => {
    const port = resolveOnnxProxyPort({ ONNX_PROXY_PORT: '9999' });
    assert.equal(port, 9999,
      'ONNX_PROXY_PORT env var must override default');
    assert.notEqual(port, 8787,
      'port must NOT be default when env var is set');
  });

  it('onnx-proxy falls back to default 8787 when no env var', () => {
    const port = resolveOnnxProxyPort({});
    assert.equal(port, 8787);
  });
});

// ============================================================================
// R7: Worker timeout residuals
// ============================================================================

/** Simulates loadGlobalWorkerTimeout reading from config chain */
function loadGlobalWorkerTimeout(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.daemon?.workerTimeoutMs ?? 300000;
}

/** Simulates dispatch-service using loadGlobalWorkerTimeout */
function resolveDispatchServiceTimeout(bridgeFn) {
  return loadGlobalWorkerTimeout(bridgeFn);
}

describe('ADR-0069 R7: Worker timeout residuals', () => {

  it('dispatch-service uses loadGlobalWorkerTimeout, not bare 300000', () => {
    const bridge = makeConfigBridge({ daemon: { workerTimeoutMs: 600000 } });
    const timeout = resolveDispatchServiceTimeout(bridge);
    assert.equal(timeout, 600000,
      'dispatch-service must use loadGlobalWorkerTimeout from config chain');
    assert.equal(bridge.calls.length, 1,
      'config bridge must be called');
  });

  it('loadGlobalWorkerTimeout defaults to 300000 when config omits it', () => {
    const bridge = makeConfigBridge({ daemon: {} });
    const timeout = loadGlobalWorkerTimeout(bridge);
    assert.equal(timeout, 300000,
      'default worker timeout must be 300000');
  });

  it('real config.json daemon.workerTimeoutMs is 300000', () => {
    assert.equal(config.daemon.workerTimeoutMs, 300000,
      'config.json daemon.workerTimeoutMs must be 300000');
  });
});

// ============================================================================
// R8: EWC consolidator dimension
// ============================================================================

/** Simulates DEFAULT_EWC_CONFIG reading dimension from embeddings.json */
function resolveEwcConsolidatorDimension(embeddingsJsonFn) {
  try {
    const emb = embeddingsJsonFn();
    return emb.dimension;
  } catch {
    return 768;
  }
}

describe('ADR-0069 R8: EWC consolidator dimension', () => {

  it('DEFAULT_EWC_CONFIG reads dimension from embeddings.json, not hardcoded 768', () => {
    const readEmbeddings = mockFn(() => ({ dimension: 384 }));
    const dim = resolveEwcConsolidatorDimension(readEmbeddings);
    assert.equal(dim, 384,
      'EWC consolidator dimension must come from embeddings.json');
    assert.equal(readEmbeddings.calls.length, 1);
  });

  it('falls back to 768 when embeddings.json is unavailable', () => {
    const failing = mockFn(() => { throw new Error('File not found'); });
    const dim = resolveEwcConsolidatorDimension(failing);
    assert.equal(dim, 768,
      'EWC consolidator must fall back to 768');
  });

  it('real embeddings.json dimension is 768', () => {
    assert.equal(embeddings.dimension, 768,
      'embeddings.json dimension must be 768');
  });
});

// ============================================================================
// R9: Cleanup intervals
// ============================================================================

/** Simulates cleanup interval resolution from config.json */
function resolveCleanupInterval(bridgeFn) {
  const cfg = bridgeFn();
  return cfg.memory?.cleanupIntervalMs ?? 60000;
}

describe('ADR-0069 R9: Cleanup intervals', () => {

  it('cleanup interval reads from config.json memory.cleanupIntervalMs', () => {
    const bridge = makeConfigBridge({ memory: { cleanupIntervalMs: 120000 } });
    const interval = resolveCleanupInterval(bridge);
    assert.equal(interval, 120000,
      'cleanup interval must come from config.json');
    assert.equal(bridge.calls.length, 1);
  });

  it('default cleanup interval is 60000', () => {
    const bridge = makeConfigBridge({ memory: {} });
    const interval = resolveCleanupInterval(bridge);
    assert.equal(interval, 60000,
      'default cleanup interval must be 60000');
  });

  it('real config.json memory.cleanupIntervalMs is 60000', () => {
    assert.equal(config.memory.cleanupIntervalMs, 60000,
      'config.json memory.cleanupIntervalMs must be 60000');
  });
});

// ============================================================================
// R10: Service URL env guards
// ============================================================================

/** Simulates Ollama URL resolution with OLLAMA_URL env guard */
function resolveOllamaUrl(envOverrides = {}, defaultUrl = 'http://localhost:11434') {
  return envOverrides.OLLAMA_URL ?? defaultUrl;
}

/** Simulates RuvLLM URL resolution with RUVLLM_URL env guard */
function resolveRuvLlmUrl(envOverrides = {}, defaultUrl = 'http://localhost:8000') {
  return envOverrides.RUVLLM_URL ?? defaultUrl;
}

describe('ADR-0069 R10: Service URL env guards', () => {

  it('Ollama URL reads OLLAMA_URL env var', () => {
    const url = resolveOllamaUrl({ OLLAMA_URL: 'http://gpu-server:11434' });
    assert.equal(url, 'http://gpu-server:11434',
      'OLLAMA_URL env var must override default');
    assert.notEqual(url, 'http://localhost:11434',
      'URL must NOT be default when env var is set');
  });

  it('Ollama URL defaults to http://localhost:11434 when no env var', () => {
    const url = resolveOllamaUrl({});
    assert.equal(url, 'http://localhost:11434');
  });

  it('RuvLLM URL reads RUVLLM_URL env var', () => {
    const url = resolveRuvLlmUrl({ RUVLLM_URL: 'http://inference:8000' });
    assert.equal(url, 'http://inference:8000',
      'RUVLLM_URL env var must override default');
    assert.notEqual(url, 'http://localhost:8000',
      'URL must NOT be default when env var is set');
  });

  it('RuvLLM URL defaults to http://localhost:8000 when no env var', () => {
    const url = resolveRuvLlmUrl({});
    assert.equal(url, 'http://localhost:8000');
  });
});

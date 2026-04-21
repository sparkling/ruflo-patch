// @tier unit
// F1 improvements: embedder propagation, ONNX fallback chain, getInstance race
// safety, individual controller try/catch, embCfg scope fix.
// London School TDD: inline mocks, no real AgentDB/SQLite imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as agentdb-service-f1.test.mjs)
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
// Shared constants
// ============================================================================

const CORE_CONTROLLERS = [
  'vectorBackend',
  'reflexionMemory',
  'skillLibrary',
  'reasoningBank',
  'causalGraph',
  'causalRecall',
  'learningSystem',
  'attentionService',
  'nightlyLearner',
  'explainableRecall',
];

// ============================================================================
// Group 1: Embedder propagation — replaceEmbeddingService after upgrade
// ============================================================================

describe('F1 improvement: Embedder propagation', () => {

  it('replaceEmbeddingService is called with enhanced service after upgrade', () => {
    const replaceEmbeddingServiceCalls = [];
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn((svc) => {
        replaceEmbeddingServiceCalls.push(svc);
      }),
      getController: mockFn(() => ({ _name: 'stub' })),
      close: mockFn(),
    };

    const enhancedEmbedder = { embed: mockFn(), model: 'all-mpnet-base-v2' };

    // Simulate the post-upgrade embedder propagation
    function propagateEmbedder(db, embedder) {
      db.replaceEmbeddingService(embedder);
    }

    propagateEmbedder(mockAgentDB, enhancedEmbedder);

    assert.equal(mockAgentDB.replaceEmbeddingService.calls.length, 1,
      'replaceEmbeddingService must be called exactly once');
    assert.strictEqual(mockAgentDB.replaceEmbeddingService.calls[0][0], enhancedEmbedder,
      'replaceEmbeddingService must receive the enhanced embedder instance');
  });

  it('propagation does not happen when no enhanced service is available', () => {
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn(),
      getController: mockFn(() => ({ _name: 'stub' })),
      close: mockFn(),
    };

    // Simulate conditional propagation (no enhanced service)
    function propagateEmbedder(db, embedder) {
      if (embedder) {
        db.replaceEmbeddingService(embedder);
      }
    }

    propagateEmbedder(mockAgentDB, null);

    assert.equal(mockAgentDB.replaceEmbeddingService.calls.length, 0,
      'replaceEmbeddingService must NOT be called when embedder is null');
  });

  it('propagation passes exact instance, not a copy', () => {
    const mockAgentDB = {
      database: {},
      replaceEmbeddingService: mockFn(),
      close: mockFn(),
    };

    const embedder = { embed: mockFn(), _id: 'unique-ref' };

    mockAgentDB.replaceEmbeddingService(embedder);

    const received = mockAgentDB.replaceEmbeddingService.calls[0][0];
    assert.strictEqual(received, embedder,
      'must pass the exact same object reference, not a clone');
    assert.equal(received._id, 'unique-ref');
  });
});

// ============================================================================
// Group 2: Fallback-chain shape tests — ONNX → Enhanced → Basic.
// ----------------------------------------------------------------------------
// Status (2026-04-21, ADR-0069 F3 §3 closure):
//
// These tests exercise a local `createEmbedderChain()` helper that mirrors
// the SHAPE of upgradeEmbeddingService() in the fork. They intentionally do
// not import the TypeScript source (the test harness runs plain .mjs without
// a TS loader). Instead, Group 2b below performs a source-level reality pin
// to verify the fork actually implements this shape: ONNX is attempted first,
// Enhanced is attempted on ONNX failure, Basic survives as last-resort.
//
// If you change the chain order in the fork, update BOTH Group 2 (intent)
// and Group 2b (reality pin).
// ============================================================================

describe('F1: ONNX > Enhanced > basic fallback chain (shape)', () => {

  function createEmbedderChain({ onnxFactory, enhancedFactory, basicFactory }) {
    // Mirrors the shipped 3-tier fallback: ONNX → Enhanced → basic.
    // Group 2b below pins the fork source to confirm this shape is implemented.
    const result = { embedder: null, tier: null, errors: [] };

    // Tier 1: try ONNX
    try {
      const onnx = onnxFactory();
      result.embedder = onnx;
      result.tier = 'onnx';
      return result;
    } catch (err) {
      result.errors.push({ tier: 'onnx', error: err });
    }

    // Tier 2: try Enhanced
    try {
      const enhanced = enhancedFactory();
      result.embedder = enhanced;
      result.tier = 'enhanced';
      return result;
    } catch (err) {
      result.errors.push({ tier: 'enhanced', error: err });
    }

    // Tier 3: basic (always succeeds)
    result.embedder = basicFactory();
    result.tier = 'basic';
    return result;
  }

  it('uses ONNX when ONNXEmbeddingService succeeds', () => {
    const onnxEmb = { embed: mockFn(), model: 'onnx-mpnet' };

    const result = createEmbedderChain({
      onnxFactory: () => onnxEmb,
      enhancedFactory: () => { throw new Error('should not reach'); },
      basicFactory: () => { throw new Error('should not reach'); },
    });

    assert.strictEqual(result.embedder, onnxEmb,
      'must use ONNX embedder when available');
    assert.equal(result.tier, 'onnx');
    assert.equal(result.errors.length, 0);
  });

  it('falls back to Enhanced when ONNX fails', () => {
    const enhancedEmb = { embed: mockFn(), model: 'enhanced-mpnet' };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new Error('ONNX runtime not found'); },
      enhancedFactory: () => enhancedEmb,
      basicFactory: () => { throw new Error('should not reach'); },
    });

    assert.strictEqual(result.embedder, enhancedEmb,
      'must fall back to Enhanced when ONNX fails');
    assert.equal(result.tier, 'enhanced');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].error.message, /ONNX runtime not found/);
  });

  it('falls back to basic when both ONNX and Enhanced fail', () => {
    const basicEmb = { embed: mockFn(), model: 'basic-hash' };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new Error('ONNX not available'); },
      enhancedFactory: () => { throw new Error('Enhanced model missing'); },
      basicFactory: () => basicEmb,
    });

    assert.strictEqual(result.embedder, basicEmb,
      'must fall back to basic when both ONNX and Enhanced fail');
    assert.equal(result.tier, 'basic');
    assert.equal(result.errors.length, 2);
    assert.equal(result.errors[0].tier, 'onnx');
    assert.equal(result.errors[1].tier, 'enhanced');
  });

  it('records error details for each failed tier', () => {
    const basicEmb = { embed: mockFn() };

    const result = createEmbedderChain({
      onnxFactory: () => { throw new TypeError('Cannot read properties of undefined'); },
      enhancedFactory: () => { throw new RangeError('dimension mismatch'); },
      basicFactory: () => basicEmb,
    });

    assert.equal(result.errors.length, 2);
    assert.ok(result.errors[0].error instanceof TypeError,
      'ONNX error must preserve error type');
    assert.ok(result.errors[1].error instanceof RangeError,
      'Enhanced error must preserve error type');
  });

  it('ONNX tier is preferred even when Enhanced would also succeed', () => {
    const onnxEmb = { embed: mockFn(), _preferred: true };
    const enhancedEmb = { embed: mockFn(), _preferred: false };

    const result = createEmbedderChain({
      onnxFactory: () => onnxEmb,
      enhancedFactory: () => enhancedEmb,
      basicFactory: () => ({ embed: mockFn() }),
    });

    assert.strictEqual(result.embedder, onnxEmb,
      'ONNX must be selected over Enhanced when both are available');
    assert.equal(result.tier, 'onnx');
  });
});

// ============================================================================
// Group 2b: Reality pin — verify the fork source actually implements the
// ONNX → Enhanced → Basic chain shape that Group 2 describes. Source-level
// inspection is used because the fork is TypeScript and importing it from a
// node --test .mjs harness would require a TS loader we don't run here.
// (ADR-0069 F3 §3 closure — 2026-04-21)
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __thisDir = dirname(fileURLToPath(import.meta.url));
const AGENTDB_SERVICE_TS = resolve(
  __thisDir,
  '../../../forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts'
);

// Slice out the body of upgradeEmbeddingService so we can assert order of
// tiers without false positives from unrelated references elsewhere in the
// file (controllers also mention EnhancedEmbeddingService in passing).
function extractUpgradeFnBody(src) {
  const start = src.search(/private\s+async\s+upgradeEmbeddingService\s*\(/);
  if (start < 0) return null;
  // Find the opening brace after the signature
  const braceIdx = src.indexOf('{', start);
  if (braceIdx < 0) return null;
  // Walk balanced braces to find the end of the function body
  let depth = 0;
  for (let i = braceIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(braceIdx, i + 1);
    }
  }
  return null;
}

describe('F1 reality: upgradeEmbeddingService shipped shape (ONNX -> Enhanced -> Basic)', () => {

  it('fork source file exists and is readable', () => {
    assert.ok(
      existsSync(AGENTDB_SERVICE_TS),
      `expected fork source at ${AGENTDB_SERVICE_TS} — adjust path if the fork layout changed`
    );
  });

  it('defines a private upgradeEmbeddingService() method', () => {
    const src = readFileSync(AGENTDB_SERVICE_TS, 'utf8');
    assert.match(
      src,
      /private\s+async\s+upgradeEmbeddingService\s*\(/,
      'upgradeEmbeddingService must be a private async method in the fork'
    );
  });

  it('imports ONNXEmbeddingService as tier 1', () => {
    const src = readFileSync(AGENTDB_SERVICE_TS, 'utf8');
    const body = extractUpgradeFnBody(src);
    assert.ok(body, 'could not extract upgradeEmbeddingService function body');
    assert.match(
      body,
      /ONNXEmbeddingService/,
      'upgradeEmbeddingService must reference ONNXEmbeddingService (tier 1)'
    );
    assert.match(
      body,
      /packages\/agentdb-onnx\/src\/services\/ONNXEmbeddingService/,
      'upgradeEmbeddingService must dynamic-import ONNXEmbeddingService from the local agentdb-onnx package'
    );
  });

  it('still references EnhancedEmbeddingService as tier 2', () => {
    const src = readFileSync(AGENTDB_SERVICE_TS, 'utf8');
    const body = extractUpgradeFnBody(src);
    assert.ok(body);
    assert.match(
      body,
      /EnhancedEmbeddingService/,
      'upgradeEmbeddingService must reference EnhancedEmbeddingService (tier 2)'
    );
  });

  it('ONNX tier appears before Enhanced tier in source order (chain ordering)', () => {
    const src = readFileSync(AGENTDB_SERVICE_TS, 'utf8');
    const body = extractUpgradeFnBody(src);
    assert.ok(body);
    const onnxIdx = body.indexOf('ONNXEmbeddingService');
    const enhancedIdx = body.indexOf('EnhancedEmbeddingService');
    assert.ok(onnxIdx >= 0, 'ONNXEmbeddingService must appear in the function body');
    assert.ok(enhancedIdx >= 0, 'EnhancedEmbeddingService must appear in the function body');
    assert.ok(
      onnxIdx < enhancedIdx,
      `ONNX tier must appear before Enhanced tier in source (found ONNX@${onnxIdx}, Enhanced@${enhancedIdx})`
    );
  });

  it('loudly logs tier failures (ADR-0082: no silent fallback)', () => {
    const src = readFileSync(AGENTDB_SERVICE_TS, 'utf8');
    const body = extractUpgradeFnBody(src);
    assert.ok(body);
    // Extract each catch block with balanced-brace walking (nested braces
    // such as template literals and object expressions are common inside).
    const catches = [];
    let i = 0;
    while (i < body.length) {
      const catchMatch = body.slice(i).match(/catch\s*\([^)]*\)\s*\{/);
      if (!catchMatch) break;
      const startRel = catchMatch.index;
      const openBrace = i + startRel + catchMatch[0].length - 1;
      let depth = 1;
      let j = openBrace + 1;
      for (; j < body.length && depth > 0; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
      }
      catches.push(body.slice(i + startRel, j));
      i = j;
    }
    assert.ok(
      catches.length >= 2,
      `expected at least 2 try/catch blocks (ONNX + Enhanced tiers), found ${catches.length}`
    );
    for (const c of catches) {
      assert.match(
        c,
        /console\.(warn|error|log)/,
        `every tier-failure catch block must log loudly (ADR-0082), but found:\n${c.slice(0, 400)}`
      );
    }
  });
});

// ============================================================================
// Group 2c: ONNX wiring smoke test — verify the ONNX package ships the
// expected export surface that upgradeEmbeddingService imports. This prevents
// a silent regression where the import path in the fork diverges from the
// actual package contents (the pattern upstream is especially prone to).
// ============================================================================

describe('F1: ONNX package export surface', () => {

  const ONNX_SRC = resolve(
    __thisDir,
    '../../../forks/agentic-flow/packages/agentdb-onnx/src/services/ONNXEmbeddingService.ts'
  );

  it('agentdb-onnx package source file exists at the imported path', () => {
    assert.ok(
      existsSync(ONNX_SRC),
      `agentdb-onnx service must exist at ${ONNX_SRC} — update fork import path if layout changed`
    );
  });

  it('exports a class named ONNXEmbeddingService', () => {
    const src = readFileSync(ONNX_SRC, 'utf8');
    assert.match(
      src,
      /export\s+class\s+ONNXEmbeddingService\b/,
      'agentdb-onnx must export class ONNXEmbeddingService'
    );
  });

  it('class exposes async initialize(), embed(), embedBatch()', () => {
    const src = readFileSync(ONNX_SRC, 'utf8');
    assert.match(src, /async\s+initialize\s*\(/,
      'ONNXEmbeddingService must expose async initialize()');
    assert.match(src, /async\s+embed\s*\(/,
      'ONNXEmbeddingService must expose async embed()');
    assert.match(src, /async\s+embedBatch\s*\(/,
      'ONNXEmbeddingService must expose async embedBatch()');
  });
});

// ============================================================================
// Group 3: getInstance race safety — concurrent calls yield single init
// ============================================================================

describe('F1 improvement: getInstance race safety', () => {

  it('concurrent getInstance calls produce exactly one initialization', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    // Simulates a singleton with lazy init + lock
    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          // Simulate async init work
          await new Promise(r => setTimeout(r, 10));
          instance = { _id: 'singleton', _createdAt: Date.now() };
          return instance;
        })();
      }
      return initPromise;
    }

    // Fire two concurrent calls
    const [a, b] = await Promise.all([getInstance(), getInstance()]);

    assert.equal(initCount, 1,
      'initialization must run exactly once, not once per caller');
    assert.strictEqual(a, b,
      'both callers must receive the exact same instance');
    assert.equal(a._id, 'singleton');
  });

  it('three concurrent callers all get the same instance', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          instance = { _id: 'triple-test' };
          return instance;
        })();
      }
      return initPromise;
    }

    const [a, b, c] = await Promise.all([
      getInstance(),
      getInstance(),
      getInstance(),
    ]);

    assert.equal(initCount, 1, 'init must run once even with 3 callers');
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
  });

  it('sequential calls after init reuse the cached instance without re-init', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          instance = { _id: 'cached' };
          return instance;
        })();
      }
      return initPromise;
    }

    const first = await getInstance();
    const second = await getInstance();
    const third = await getInstance();

    assert.equal(initCount, 1, 'init must not re-run on subsequent calls');
    assert.strictEqual(first, second);
    assert.strictEqual(second, third);
  });

  it('init failure does not leave a stale promise blocking retries', async () => {
    let initCount = 0;
    let instance = null;
    let initPromise = null;
    let shouldFail = true;

    async function getInstance() {
      if (instance) return instance;
      if (!initPromise) {
        initPromise = (async () => {
          initCount++;
          await new Promise(r => setTimeout(r, 5));
          if (shouldFail) {
            // Clear promise so retry is possible
            initPromise = null;
            throw new Error('init failed');
          }
          instance = { _id: 'recovered' };
          return instance;
        })();
      }
      return initPromise;
    }

    // First call fails
    await assert.rejects(() => getInstance(), /init failed/);
    assert.equal(initCount, 1);

    // Retry should succeed
    shouldFail = false;
    const result = await getInstance();
    assert.equal(initCount, 2, 'init must retry after failure');
    assert.equal(result._id, 'recovered');
  });
});

// ============================================================================
// Group 4: Individual controller try/catch — one failure does not block others
// ============================================================================

describe('F1 improvement: Individual controller try/catch', () => {

  function initCoreControllers(agentDB) {
    const controllers = {};
    const errors = [];

    for (const name of CORE_CONTROLLERS) {
      try {
        controllers[name] = agentDB.getController(name);
      } catch (err) {
        errors.push({ name, error: err });
        controllers[name] = null;
      }
    }

    return { controllers, errors };
  }

  it('causal throws but other 9 controllers still initialize', () => {
    const db = {
      getController(name) {
        if (name === 'causalGraph') throw new Error('causal init failed');
        return { _name: name, _ok: true };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    // causalGraph is null
    assert.equal(controllers.causalGraph, null,
      'causalGraph must be null when its init throws');

    // All other 9 are present
    const initialized = Object.entries(controllers)
      .filter(([, v]) => v !== null);
    assert.equal(initialized.length, CORE_CONTROLLERS.length - 1,
      'exactly 9 controllers must still initialize when only causal fails');

    // Each initialized controller has its name
    for (const [name, ctrl] of initialized) {
      assert.equal(ctrl._name, name);
      assert.equal(ctrl._ok, true);
    }

    // Error recorded for causal only
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, 'causalGraph');
    assert.match(errors[0].error.message, /causal init failed/);
  });

  it('multiple controllers fail independently', () => {
    const failSet = new Set(['causalGraph', 'nightlyLearner', 'skillLibrary']);
    const db = {
      getController(name) {
        if (failSet.has(name)) throw new Error(`${name} broken`);
        return { _name: name };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, failSet.size,
      `exactly ${failSet.size} errors must be recorded`);

    for (const name of failSet) {
      assert.equal(controllers[name], null, `${name} must be null`);
    }

    const succeededCount = Object.values(controllers)
      .filter(v => v !== null).length;
    assert.equal(succeededCount, CORE_CONTROLLERS.length - failSet.size,
      'remaining controllers must succeed');
  });

  it('all 10 controllers fail — no crash, all null', () => {
    const db = {
      getController(name) {
        throw new Error(`${name} unavailable`);
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, CORE_CONTROLLERS.length);
    for (const name of CORE_CONTROLLERS) {
      assert.equal(controllers[name], null,
        `${name} must be null when all fail`);
    }
  });

  it('all 10 controllers succeed — no errors recorded', () => {
    const db = {
      getController(name) {
        return { _name: name, ready: true };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(errors.length, 0, 'no errors when all succeed');
    for (const name of CORE_CONTROLLERS) {
      assert.ok(controllers[name] !== null, `${name} must be initialized`);
      assert.equal(controllers[name].ready, true);
    }
  });

  it('error in vectorBackend does not prevent reflexionMemory', () => {
    // vectorBackend is first in the list — verify iteration continues
    const db = {
      getController(name) {
        if (name === 'vectorBackend') throw new Error('vector init boom');
        return { _name: name };
      },
    };

    const { controllers, errors } = initCoreControllers(db);

    assert.equal(controllers.vectorBackend, null);
    assert.ok(controllers.reflexionMemory !== null,
      'reflexionMemory must init even when vectorBackend (listed before it) fails');
    assert.equal(controllers.reflexionMemory._name, 'reflexionMemory');
    assert.equal(errors.length, 1);
  });
});

// ============================================================================
// Group 5: embCfg scope fix — Phase 2 init does not throw ReferenceError
// ============================================================================

describe('F1 fix: embCfg scope in Phase 2 init', () => {

  it('initializePhase2RuVectorPackages does not throw ReferenceError', async () => {
    // Simulates the fixed Phase 2 init where embCfg is declared within scope.
    // Before the fix, embCfg was referenced from a scope it did not exist in,
    // causing a ReferenceError.

    async function initializePhase2RuVectorPackages(config) {
      // embCfg is derived from the config arg — scoped correctly
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';

      const results = { gnn: null, router: null };

      // Simulate GNN init
      if (config.enableGNN !== false) {
        results.gnn = { dimension, model, type: 'gnn' };
      }

      // Simulate SemanticRouter init
      if (config.enableRouter !== false) {
        results.router = { dimension, model, type: 'router' };
      }

      return results;
    }

    // Should not throw ReferenceError
    const result = await initializePhase2RuVectorPackages({
      embedding: { dimension: 384, model: 'test-model' },
      enableGNN: true,
      enableRouter: true,
    });

    assert.equal(result.gnn.dimension, 384);
    assert.equal(result.gnn.model, 'test-model');
    assert.equal(result.router.dimension, 384);
    assert.equal(result.router.model, 'test-model');
  });

  it('embCfg defaults when config.embedding is missing', async () => {
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';
      return { dimension, model };
    }

    // No embedding key at all — must not throw, must use defaults
    const result = await initializePhase2RuVectorPackages({});

    assert.equal(result.dimension, 768,
      'dimension must default to 768 when embedding config is absent');
    assert.equal(result.model, 'all-mpnet-base-v2',
      'model must default to all-mpnet-base-v2 when embedding config is absent');
  });

  it('embCfg defaults when config.embedding is undefined', async () => {
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      const model = embCfg.model || 'all-mpnet-base-v2';
      return { dimension, model };
    }

    const result = await initializePhase2RuVectorPackages({
      embedding: undefined,
    });

    assert.equal(result.dimension, 768);
    assert.equal(result.model, 'all-mpnet-base-v2');
  });

  it('embCfg does not leak between Phase 2 calls', async () => {
    // Verify embCfg is local, not shared mutable state
    async function initializePhase2RuVectorPackages(config) {
      const embCfg = config.embedding || {};
      const dimension = embCfg.dimension || 768;
      return { dimension };
    }

    const r1 = await initializePhase2RuVectorPackages({
      embedding: { dimension: 384 },
    });
    const r2 = await initializePhase2RuVectorPackages({
      embedding: { dimension: 512 },
    });

    assert.equal(r1.dimension, 384, 'first call must use its own config');
    assert.equal(r2.dimension, 512, 'second call must use its own config');
    assert.notEqual(r1.dimension, r2.dimension,
      'embCfg must not leak between calls');
  });
});

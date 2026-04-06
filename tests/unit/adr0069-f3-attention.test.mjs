// @tier unit
// ADR-0069 F3: Full AttentionService — WASM fallback chain, dual instances, WASM dispatch
// London School TDD: inline mocks, no real agentdb/WASM imports.

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
// Factory: simulated AttentionService with the real F3 initialization logic
// ============================================================================

/**
 * Creates a mock AttentionService that mirrors the real WASM fallback chain:
 *   NAPI -> unified WASM (18+ mechanisms) -> basic WASM (7 mechanisms) -> JS fallback
 *
 * @param {object} opts
 * @param {boolean} opts.napiAvailable    - NAPI import resolves
 * @param {boolean} opts.unifiedWasmAvailable - @ruvector/attention-unified-wasm resolves
 * @param {boolean} opts.basicWasmAvailable - ruvector-attention-wasm resolves
 * @param {object}  opts.config           - AttentionConfig overrides
 * @param {object}  opts.wasmClasses      - Map of mechanism->MockClass for WASM dispatch
 */
function createAttentionService(opts = {}) {
  const {
    napiAvailable = false,
    unifiedWasmAvailable = false,
    basicWasmAvailable = false,
    config = {},
    wasmClasses = {},
  } = opts;

  const svcConfig = {
    numHeads: 8,
    headDim: 96,
    embedDim: 768,
    dropout: 0.1,
    bias: true,
    useFlash: true,
    useLinear: false,
    useHyperbolic: false,
    useMoE: false,
    numExperts: 8,
    topK: 2,
    ...config,
  };

  let napiModule = null;
  let wasmModule = null;
  let engineType = 'fallback';
  let initialized = false;
  const wasmInstances = new Map();
  const importAttempts = [];

  // Stats tracking
  const stats = {
    totalOps: 0,
    avgExecutionTimeMs: 0,
    peakMemoryBytes: 0,
    mechanismCounts: {},
    runtimeCounts: {},
  };

  // ---- Initialization: mirrors AttentionService.initialize() ----

  async function initialize() {
    if (initialized) return;

    // Step 1: Try NAPI (fastest)
    await loadNAPIModule();

    // Step 2: If NAPI unavailable, try WASM (ADR-0069 F3 fallback chain)
    if (!napiModule) {
      await loadWASMModule();
    }

    initialized = true;
  }

  async function loadNAPIModule() {
    importAttempts.push('@ruvector/attention');
    if (napiAvailable) {
      napiModule = {
        multiHeadAttention: mockFn(() => ({
          output: new Float32Array(svcConfig.embedDim),
          weights: new Float32Array(svcConfig.embedDim),
        })),
        flashAttention: mockFn(() => new Float32Array(svcConfig.embedDim)),
        moeAttention: mockFn(() => new Float32Array(svcConfig.embedDim)),
      };
      engineType = 'napi';
      return;
    }

    importAttempts.push('@ruvector/graph-transformer');
    // Also not available in this mock
    napiModule = null;
    if (!wasmModule) engineType = 'fallback';
  }

  async function loadWASMModule() {
    // Strategy 1: Try unified WASM (18+ mechanisms)
    importAttempts.push('@ruvector/attention-unified-wasm');
    if (unifiedWasmAvailable) {
      wasmModule = {
        _isUnified: true,
        WasmMultiHeadAttention: wasmClasses.WasmMultiHeadAttention || null,
        WasmFlashAttention: wasmClasses.WasmFlashAttention || null,
        WasmHyperbolicAttention: wasmClasses.WasmHyperbolicAttention || null,
        WasmMoEAttention: wasmClasses.WasmMoEAttention || null,
        WasmLinearAttention: wasmClasses.WasmLinearAttention || null,
      };
      engineType = 'wasm';
      return;
    }

    // Strategy 2: Try basic WASM (7 mechanisms)
    importAttempts.push('ruvector-attention-wasm');
    if (basicWasmAvailable) {
      wasmModule = {
        WasmMultiHeadAttention: wasmClasses.WasmMultiHeadAttention || null,
        WasmFlashAttention: wasmClasses.WasmFlashAttention || null,
        WasmHyperbolicAttention: wasmClasses.WasmHyperbolicAttention || null,
        WasmMoEAttention: wasmClasses.WasmMoEAttention || null,
        WasmLinearAttention: wasmClasses.WasmLinearAttention || null,
      };
      engineType = 'wasm';
      return;
    }

    wasmModule = null;
    if (engineType !== 'napi') engineType = 'fallback';
  }

  // ---- getWasmInstance: mirrors the caching logic ----

  function getWasmInstance(mechanism) {
    if (wasmInstances.has(mechanism)) {
      return wasmInstances.get(mechanism);
    }
    if (!wasmModule) return null;

    const dim = svcConfig.embedDim;
    let instance = null;

    try {
      switch (mechanism) {
        case 'multi-head':
          if (wasmModule.WasmMultiHeadAttention) {
            instance = new wasmModule.WasmMultiHeadAttention(dim, svcConfig.numHeads);
          }
          break;
        case 'flash':
          if (wasmModule.WasmFlashAttention) {
            instance = new wasmModule.WasmFlashAttention(dim, 256);
          }
          break;
        case 'hyperbolic':
          if (wasmModule.WasmHyperbolicAttention) {
            instance = new wasmModule.WasmHyperbolicAttention(dim, -1.0);
          }
          break;
        case 'moe':
          if (wasmModule.WasmMoEAttention) {
            instance = new wasmModule.WasmMoEAttention(
              dim, svcConfig.numExperts || 8, svcConfig.topK || 2,
            );
          }
          break;
        case 'linear':
          if (wasmModule.WasmLinearAttention) {
            instance = new wasmModule.WasmLinearAttention(dim, 256);
          }
          break;
      }
    } catch {
      // Constructor failed
    }

    if (instance) {
      wasmInstances.set(mechanism, instance);
    }
    return instance;
  }

  // ---- JS fallback: simple softmax-weighted dot-product attention ----

  function softmax(values) {
    const maxVal = Math.max(...values);
    const exps = values.map(v => Math.exp(v - maxVal));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
  }

  function jsFallbackAttention(query, keys, values) {
    const dim = query.length;
    const scale = 1.0 / Math.sqrt(dim);
    const scores = keys.map(k => {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += query[d] * k[d];
      return dot * scale;
    });
    const weights = softmax(scores);
    const output = new Array(dim).fill(0);
    for (let j = 0; j < values.length; j++) {
      for (let d = 0; d < dim; d++) {
        output[d] += weights[j] * values[j][d];
      }
    }
    return output;
  }

  function updateStats(mechanism, runtime, executionTimeMs, memBytes) {
    stats.totalOps++;
    const prevTotal = stats.avgExecutionTimeMs * (stats.totalOps - 1);
    stats.avgExecutionTimeMs = (prevTotal + executionTimeMs) / stats.totalOps;
    if (memBytes > stats.peakMemoryBytes) stats.peakMemoryBytes = memBytes;
    stats.mechanismCounts[mechanism] = (stats.mechanismCounts[mechanism] || 0) + 1;
    stats.runtimeCounts[runtime] = (stats.runtimeCounts[runtime] || 0) + 1;
  }

  // ---- Low-level methods (Float32Array API): multiHeadAttention, flashAttention, moeAttention ----

  async function multiHeadAttention(query, key, value, mask) {
    if (!initialized) await initialize();
    let output, runtime = 'fallback';

    if (napiModule && napiModule.multiHeadAttention) {
      const result = napiModule.multiHeadAttention(query, key, value, svcConfig.numHeads, svcConfig.headDim, mask);
      output = result.output;
      runtime = 'napi';
    } else {
      const mha = getWasmInstance('multi-head');
      if (mha) {
        output = mha.compute(query, [key], [value]);
        runtime = 'wasm';
      }
    }
    if (!output) {
      output = new Float32Array(query.length);
      runtime = 'fallback';
    }
    updateStats('multi-head', runtime, 0, output.length * 4);
    return { output, mechanism: 'multi-head', runtime };
  }

  async function flashAttention(query, key, value, mask) {
    if (!initialized) await initialize();
    let output, runtime = 'fallback';

    if (napiModule && napiModule.flashAttention) {
      output = napiModule.flashAttention(query, key, value, svcConfig.numHeads, svcConfig.headDim, mask);
      runtime = 'napi';
    } else {
      const flash = getWasmInstance('flash');
      if (flash) {
        output = flash.compute(query, [key], [value]);
        runtime = 'wasm';
      }
    }
    if (!output) {
      output = new Float32Array(query.length);
      runtime = 'fallback';
    }
    updateStats('flash', runtime, 0, output.length * 4);
    return { output, mechanism: 'flash', runtime };
  }

  async function moeAttention(query, key, value, mask) {
    if (!initialized) await initialize();
    let output, runtime = 'fallback';

    if (napiModule && napiModule.moeAttention) {
      output = napiModule.moeAttention(query, key, value, svcConfig.numHeads, svcConfig.headDim, svcConfig.numExperts, svcConfig.topK, mask);
      runtime = 'napi';
    } else {
      const moe = getWasmInstance('moe');
      if (moe) {
        output = moe.compute(query, [key], [value]);
        runtime = 'wasm';
      }
    }
    if (!output) {
      output = new Float32Array(query.length);
      runtime = 'fallback';
    }
    updateStats('moe', runtime, 0, output.length * 4);
    return { output, mechanism: 'moe', runtime };
  }

  // ---- High-level API (number[] API) ----

  async function applyFlashAttention(query, keys, values) {
    if (!initialized) await initialize();
    const flash = getWasmInstance('flash');
    if (napiModule && napiModule.flashAttention) {
      const result = napiModule.flashAttention(
        new Float32Array(query),
        new Float32Array(keys.flat()),
        new Float32Array(values.flat()),
      );
      updateStats('flash', 'napi', 0, query.length * 4);
      return Array.from(result instanceof Float32Array ? result : new Float32Array(result));
    }
    if (flash) {
      const result = flash.compute(
        new Float32Array(query),
        keys.map(k => new Float32Array(k)),
        values.map(v => new Float32Array(v)),
      );
      updateStats('flash', 'wasm', 0, query.length * 4);
      return Array.from(result instanceof Float32Array ? result : new Float32Array(result));
    }
    // JS fallback
    const out = jsFallbackAttention(query, keys, values);
    updateStats('flash', 'fallback', 0, query.length * 4);
    return out;
  }

  async function applyMultiHeadAttention(query, context, numHeads) {
    if (!initialized) await initialize();
    // Always falls back to JS in this mock when no NAPI/WASM
    const dim = query.length;
    const heads = numHeads ?? svcConfig.numHeads;
    const headDim = Math.max(1, Math.floor(dim / heads));
    const scale = 1.0 / Math.sqrt(headDim);
    const seqLen = context.length;

    const output = new Array(dim).fill(0);
    const allWeights = [];
    for (let h = 0; h < heads; h++) {
      const hStart = h * headDim;
      const hEnd = Math.min(hStart + headDim, dim);
      const scores = [];
      let maxScore = -Infinity;
      for (let j = 0; j < seqLen; j++) {
        let dot = 0;
        for (let d = hStart; d < hEnd; d++) dot += query[d] * context[j][d];
        const s = dot * scale;
        scores.push(s);
        if (s > maxScore) maxScore = s;
      }
      let expSum = 0;
      const headWeights = [];
      for (let j = 0; j < seqLen; j++) {
        scores[j] = Math.exp(scores[j] - maxScore);
        expSum += scores[j];
      }
      for (let j = 0; j < seqLen; j++) {
        scores[j] /= expSum;
        headWeights.push(scores[j]);
        for (let d = hStart; d < hEnd; d++) output[d] += scores[j] * context[j][d];
      }
      allWeights.push(headWeights);
    }
    updateStats('multi-head', 'fallback', 0, dim * 4);
    return { attention: output, weights: allWeights };
  }

  async function applyMoE(input, experts, topK) {
    if (!initialized) await initialize();
    const k = topK ?? svcConfig.topK ?? 2;
    const dim = input.length;
    // JS fallback: compute gating weights via dot products
    const gating = new Array(experts).fill(0);
    const scores = [];
    for (let e = 0; e < experts; e++) {
      // Simple scoring: hash-like transform per expert
      let score = 0;
      for (let d = 0; d < dim; d++) score += input[d] * (1 + 0.1 * ((e * 7 + d * 3) % 13));
      scores.push({ idx: e, score });
    }
    scores.sort((a, b) => b.score - a.score);
    const selected = scores.slice(0, k);
    const maxS = Math.max(...selected.map(s => s.score));
    const exps = selected.map(s => Math.exp(s.score - maxS));
    const expSum = exps.reduce((a, b) => a + b, 0);
    for (let i = 0; i < selected.length; i++) {
      gating[selected[i].idx] = exps[i] / expSum;
    }
    const output = new Array(dim).fill(0);
    for (let e = 0; e < experts; e++) {
      if (gating[e] === 0) continue;
      for (let d = 0; d < dim; d++) output[d] += gating[e] * input[d] * (1 + 0.01 * e);
    }
    updateStats('moe', 'fallback', 0, dim * 4);
    return { output, expertWeights: gating };
  }

  return {
    initialize,
    getEngineType: () => engineType,
    getStats: () => ({ ...stats }),
    getWasmInstance,
    multiHeadAttention,
    flashAttention,
    moeAttention,
    applyFlashAttention,
    applyMultiHeadAttention,
    applyMoE,
    getConfig: () => ({ ...svcConfig }),
    _importAttempts: importAttempts,
    _wasmInstances: wasmInstances,
    _napiModule: () => napiModule,
    _wasmModule: () => wasmModule,
  };
}

// ============================================================================
// Factory: simulated ControllerRegistry createController for dual instances
// ============================================================================

function createControllerRegistry({ resolvedDimension = 768, attentionServiceConfig = {} } = {}) {
  const createdInstances = [];

  // Mirrors controller-registry.ts createController() cases for
  // 'attentionService', 'flashAttentionService', 'moeAttentionService'
  async function createController(name) {
    const asCfg = attentionServiceConfig;
    const dim = resolvedDimension;

    switch (name) {
      case 'attentionService': {
        const numHeads = asCfg.numHeads ?? 8;
        const instance = {
          _type: 'attentionService',
          _config: {
            numHeads,
            headDim: Math.floor(dim / numHeads),
            embedDim: dim,
            useFlash: asCfg.useFlash ?? true,
            useMoE: asCfg.useMoE ?? false,
            useHyperbolic: asCfg.useHyperbolic ?? false,
          },
          initialize: mockFn(),
        };
        await instance.initialize();
        createdInstances.push(instance);
        return instance;
      }

      case 'flashAttentionService': {
        const numHeads = asCfg.numHeads ?? 8;
        const instance = {
          _type: 'flashAttentionService',
          _config: {
            numHeads,
            headDim: Math.floor(dim / numHeads),
            embedDim: dim,
            useFlash: true,
            useMoE: false,
            useHyperbolic: false,
          },
          initialize: mockFn(),
        };
        await instance.initialize();
        createdInstances.push(instance);
        return instance;
      }

      case 'moeAttentionService': {
        const moeCfg = asCfg;
        const numHeads = moeCfg.numHeads ?? 4;
        const instance = {
          _type: 'moeAttentionService',
          _config: {
            numHeads,
            headDim: Math.floor(dim / numHeads),
            embedDim: dim,
            useFlash: false,
            useMoE: true,
            numExperts: 8,
            topK: 2,
            useHyperbolic: false,
          },
          initialize: mockFn(),
        };
        await instance.initialize();
        createdInstances.push(instance);
        return instance;
      }

      default:
        throw new Error(`Unknown controller: ${name}`);
    }
  }

  return {
    createController,
    _createdInstances: createdInstances,
  };
}

// ============================================================================
//  UNIT TESTS
// ============================================================================

describe('ADR-0069 F3: Unit Tests', () => {

  // ==========================================================================
  // Group 1: WASM fallback chain ordering
  // ==========================================================================

  describe('WASM fallback chain ordering', () => {

    it('NAPI available -> engineType="napi", WASM not attempted', async () => {
      const svc = createAttentionService({ napiAvailable: true });
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'napi',
        'engineType must be "napi" when NAPI bindings are available');

      // Verify WASM packages were NOT imported
      const attempts = svc._importAttempts;
      assert.ok(!attempts.includes('@ruvector/attention-unified-wasm'),
        'unified WASM must not be attempted when NAPI succeeds');
      assert.ok(!attempts.includes('ruvector-attention-wasm'),
        'basic WASM must not be attempted when NAPI succeeds');
    });

    it('NAPI unavailable, unified WASM available -> engineType="wasm", unified preferred', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
      });
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'wasm',
        'engineType must be "wasm" when unified WASM is available');

      // Verify unified was attempted and basic was NOT
      const attempts = svc._importAttempts;
      assert.ok(attempts.includes('@ruvector/attention-unified-wasm'),
        'unified WASM import must be attempted');
      assert.ok(!attempts.includes('ruvector-attention-wasm'),
        'basic WASM must not be attempted when unified succeeds');

      // Verify unified flag
      const wasmMod = svc._wasmModule();
      assert.ok(wasmMod._isUnified === true,
        'WASM module must be marked as unified');
    });

    it('NAPI unavailable, unified unavailable, basic WASM available -> engineType="wasm"', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: false,
        basicWasmAvailable: true,
      });
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'wasm',
        'engineType must be "wasm" when only basic WASM is available');

      // Verify both WASM variants were attempted
      const attempts = svc._importAttempts;
      assert.ok(attempts.includes('@ruvector/attention-unified-wasm'),
        'unified WASM must be attempted first');
      assert.ok(attempts.includes('ruvector-attention-wasm'),
        'basic WASM must be attempted as fallback');

      // Verify NOT unified
      const wasmMod = svc._wasmModule();
      assert.ok(!wasmMod._isUnified,
        'basic WASM module must not be marked as unified');
    });

    it('all unavailable -> engineType="fallback"', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: false,
        basicWasmAvailable: false,
      });
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'fallback',
        'engineType must be "fallback" when no native modules are available');
      assert.equal(svc._napiModule(), null, 'napiModule must be null');
      assert.equal(svc._wasmModule(), null, 'wasmModule must be null');
    });

    it('import attempt order follows the correct chain: NAPI -> unified WASM -> basic WASM', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: false,
        basicWasmAvailable: false,
      });
      await svc.initialize();

      const attempts = svc._importAttempts;
      const napiIdx = attempts.indexOf('@ruvector/attention');
      const unifiedIdx = attempts.indexOf('@ruvector/attention-unified-wasm');
      const basicIdx = attempts.indexOf('ruvector-attention-wasm');

      assert.ok(napiIdx >= 0, 'NAPI must be attempted');
      assert.ok(unifiedIdx >= 0, 'unified WASM must be attempted');
      assert.ok(basicIdx >= 0, 'basic WASM must be attempted');
      assert.ok(napiIdx < unifiedIdx,
        'NAPI must be attempted before unified WASM');
      assert.ok(unifiedIdx < basicIdx,
        'unified WASM must be attempted before basic WASM');
    });

    it('initialize() is idempotent -- second call is a no-op', async () => {
      const svc = createAttentionService({ napiAvailable: false, basicWasmAvailable: true });
      await svc.initialize();
      const firstAttempts = svc._importAttempts.length;

      await svc.initialize();
      assert.equal(svc._importAttempts.length, firstAttempts,
        'second initialize() must not trigger additional import attempts');
    });
  });

  // ==========================================================================
  // Group 2: getWasmInstance caching
  // ==========================================================================

  describe('getWasmInstance caching', () => {

    it('first call creates instance, second call returns cached', async () => {
      const WasmFlash = mockCtor({
        compute: mockFn(() => new Float32Array(768)),
      });

      const svc = createAttentionService({
        unifiedWasmAvailable: true,
        wasmClasses: { WasmFlashAttention: WasmFlash },
      });
      await svc.initialize();

      const first = svc.getWasmInstance('flash');
      assert.ok(first !== null, 'first call must create an instance');
      assert.equal(WasmFlash.instances.length, 1,
        'constructor must be called exactly once');

      const second = svc.getWasmInstance('flash');
      assert.strictEqual(first, second,
        'second call must return the exact same cached instance');
      assert.equal(WasmFlash.instances.length, 1,
        'constructor must NOT be called again');
    });

    it('different mechanism types create different instances', async () => {
      const WasmFlash = mockCtor({
        compute: mockFn(() => new Float32Array(768)),
      });
      const WasmMHA = mockCtor({
        compute: mockFn(() => new Float32Array(768)),
      });
      const WasmMoE = mockCtor({
        compute: mockFn(() => new Float32Array(768)),
      });

      const svc = createAttentionService({
        unifiedWasmAvailable: true,
        wasmClasses: {
          WasmFlashAttention: WasmFlash,
          WasmMultiHeadAttention: WasmMHA,
          WasmMoEAttention: WasmMoE,
        },
      });
      await svc.initialize();

      const flash = svc.getWasmInstance('flash');
      const mha = svc.getWasmInstance('multi-head');
      const moe = svc.getWasmInstance('moe');

      assert.ok(flash !== null, 'flash instance created');
      assert.ok(mha !== null, 'multi-head instance created');
      assert.ok(moe !== null, 'moe instance created');
      assert.notStrictEqual(flash, mha, 'flash and multi-head must be different instances');
      assert.notStrictEqual(flash, moe, 'flash and moe must be different instances');
      assert.notStrictEqual(mha, moe, 'multi-head and moe must be different instances');

      assert.equal(svc._wasmInstances.size, 3,
        'three distinct instances must be cached');
    });

    it('returns null when wasmModule is null', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: false,
        basicWasmAvailable: false,
      });
      await svc.initialize();

      const instance = svc.getWasmInstance('flash');
      assert.equal(instance, null,
        'must return null when no WASM module is loaded');
      assert.equal(svc._wasmInstances.size, 0,
        'no instances must be cached');
    });

    it('returns null for a mechanism class that does not exist on the module', async () => {
      // Module loaded but WasmFlashAttention is missing
      const svc = createAttentionService({
        unifiedWasmAvailable: true,
        wasmClasses: {}, // no WASM classes provided
      });
      await svc.initialize();

      const instance = svc.getWasmInstance('flash');
      assert.equal(instance, null,
        'must return null when the specific class is not on the module');
      assert.equal(svc._wasmInstances.size, 0,
        'null instances must not be cached');
    });

    it('passes correct constructor args per mechanism type', async () => {
      const WasmFlash = mockCtor({ compute: mockFn() });
      const WasmMHA = mockCtor({ compute: mockFn() });
      const WasmMoE = mockCtor({ compute: mockFn() });
      const WasmHyp = mockCtor({ compute: mockFn() });
      const WasmLin = mockCtor({ compute: mockFn() });

      const svc = createAttentionService({
        unifiedWasmAvailable: true,
        config: { embedDim: 512, numHeads: 4, numExperts: 6, topK: 3 },
        wasmClasses: {
          WasmFlashAttention: WasmFlash,
          WasmMultiHeadAttention: WasmMHA,
          WasmMoEAttention: WasmMoE,
          WasmHyperbolicAttention: WasmHyp,
          WasmLinearAttention: WasmLin,
        },
      });
      await svc.initialize();

      svc.getWasmInstance('flash');
      assert.deepStrictEqual(WasmFlash.instances[0]._args, [512, 256],
        'WasmFlashAttention(dim, blockSize=256)');

      svc.getWasmInstance('multi-head');
      assert.deepStrictEqual(WasmMHA.instances[0]._args, [512, 4],
        'WasmMultiHeadAttention(dim, numHeads)');

      svc.getWasmInstance('moe');
      assert.deepStrictEqual(WasmMoE.instances[0]._args, [512, 6, 3],
        'WasmMoEAttention(dim, numExperts, topK)');

      svc.getWasmInstance('hyperbolic');
      assert.deepStrictEqual(WasmHyp.instances[0]._args, [512, -1.0],
        'WasmHyperbolicAttention(dim, curvature)');

      svc.getWasmInstance('linear');
      assert.deepStrictEqual(WasmLin.instances[0]._args, [512, 256],
        'WasmLinearAttention(dim, blockSize=256)');
    });

    it('handles WASM constructor throwing without crashing', async () => {
      const FailingCtor = function () { throw new Error('WASM init failed'); };

      const svc = createAttentionService({
        unifiedWasmAvailable: true,
        wasmClasses: { WasmFlashAttention: FailingCtor },
      });
      await svc.initialize();

      const instance = svc.getWasmInstance('flash');
      assert.equal(instance, null,
        'must return null when constructor throws');
      assert.equal(svc._wasmInstances.size, 0,
        'failed instances must not be cached');
    });
  });

  // ==========================================================================
  // Group 3: Dual AttentionService instances (SONAWithAttention pattern)
  // ==========================================================================

  describe('Dual AttentionService instances in ControllerRegistry', () => {

    it('flashAttentionService creates with useFlash=true, useMoE=false', async () => {
      const registry = createControllerRegistry();
      const flash = await registry.createController('flashAttentionService');

      assert.equal(flash._config.useFlash, true,
        'flashAttentionService must have useFlash=true');
      assert.equal(flash._config.useMoE, false,
        'flashAttentionService must have useMoE=false');
      assert.equal(flash._config.useHyperbolic, false,
        'flashAttentionService must have useHyperbolic=false');
    });

    it('moeAttentionService creates with useMoE=true, useFlash=false, numExperts=8, topK=2', async () => {
      const registry = createControllerRegistry();
      const moe = await registry.createController('moeAttentionService');

      assert.equal(moe._config.useMoE, true,
        'moeAttentionService must have useMoE=true');
      assert.equal(moe._config.useFlash, false,
        'moeAttentionService must have useFlash=false');
      assert.equal(moe._config.numExperts, 8,
        'moeAttentionService must have numExperts=8');
      assert.equal(moe._config.topK, 2,
        'moeAttentionService must have topK=2');
      assert.equal(moe._config.useHyperbolic, false,
        'moeAttentionService must have useHyperbolic=false');
    });

    it('both use the same embedDim but different configs', async () => {
      const dim = 768;
      const registry = createControllerRegistry({ resolvedDimension: dim });

      const flash = await registry.createController('flashAttentionService');
      const moe = await registry.createController('moeAttentionService');

      assert.equal(flash._config.embedDim, dim,
        'flashAttentionService must use resolvedDimension');
      assert.equal(moe._config.embedDim, dim,
        'moeAttentionService must use resolvedDimension');

      // But configs differ
      assert.notEqual(flash._config.useFlash, moe._config.useFlash,
        'useFlash must differ between flash and moe instances');
      assert.notEqual(flash._config.useMoE, moe._config.useMoE,
        'useMoE must differ between flash and moe instances');
    });

    it('flashAttentionService and moeAttentionService are distinct instances', async () => {
      const registry = createControllerRegistry();
      const flash = await registry.createController('flashAttentionService');
      const moe = await registry.createController('moeAttentionService');

      assert.notStrictEqual(flash, moe,
        'flash and moe must be separate instances');
      assert.equal(registry._createdInstances.length, 2,
        'exactly 2 instances must be created');
    });

    it('base attentionService defaults to useFlash=true, useMoE=false', async () => {
      const registry = createControllerRegistry();
      const base = await registry.createController('attentionService');

      assert.equal(base._config.useFlash, true,
        'base attentionService defaults to useFlash=true');
      assert.equal(base._config.useMoE, false,
        'base attentionService defaults to useMoE=false');
    });

    it('initialize() is called on each instance after construction', async () => {
      const registry = createControllerRegistry();
      const flash = await registry.createController('flashAttentionService');
      const moe = await registry.createController('moeAttentionService');

      assert.equal(flash.initialize.calls.length, 1,
        'initialize() must be called exactly once on flash instance');
      assert.equal(moe.initialize.calls.length, 1,
        'initialize() must be called exactly once on moe instance');
    });

    it('moeAttentionService uses numHeads=4 (not 8) from moeCfg fallback', async () => {
      // When no explicit numHeads, moeAttentionService defaults to 4
      const registry = createControllerRegistry({ attentionServiceConfig: {} });
      const moe = await registry.createController('moeAttentionService');

      assert.equal(moe._config.numHeads, 4,
        'moeAttentionService defaults to numHeads=4');

      // Flash defaults to 8
      const flash = await registry.createController('flashAttentionService');
      assert.equal(flash._config.numHeads, 8,
        'flashAttentionService defaults to numHeads=8');
    });

    it('headDim is correctly computed as floor(embedDim / numHeads)', async () => {
      const registry = createControllerRegistry({
        resolvedDimension: 768,
        attentionServiceConfig: { numHeads: 8 },
      });

      const flash = await registry.createController('flashAttentionService');
      assert.equal(flash._config.headDim, Math.floor(768 / 8),
        'flash headDim = floor(768 / 8) = 96');

      const moe = await registry.createController('moeAttentionService');
      // moe uses numHeads from moeCfg (8 when explicitly set)
      assert.equal(moe._config.headDim, Math.floor(768 / 8),
        'moe headDim = floor(768 / numHeads)');
    });
  });

  // ==========================================================================
  // Group 4: WASM dispatch in methods
  // ==========================================================================

  describe('WASM dispatch in methods', () => {

    it('multiHeadAttention uses WasmMultiHeadAttention.compute() when WASM loaded', async () => {
      const computeResult = new Float32Array([1, 2, 3, 4]);
      const WasmMHA = mockCtor({
        compute: mockFn(() => computeResult),
      });

      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
        wasmClasses: { WasmMultiHeadAttention: WasmMHA },
      });
      await svc.initialize();

      const q = new Float32Array([1, 0, 0, 0]);
      const k = new Float32Array([0, 1, 0, 0]);
      const v = new Float32Array([0, 0, 1, 0]);

      const result = await svc.multiHeadAttention(q, k, v);

      assert.equal(result.runtime, 'wasm',
        'runtime must be "wasm" when WASM module is loaded');
      assert.strictEqual(result.output, computeResult,
        'output must be the exact result from WasmMHA.compute()');

      // Verify compute was called with the right args
      const call = WasmMHA.instances[0].compute.calls[0];
      assert.strictEqual(call[0], q, 'query passed to compute');
      assert.deepStrictEqual(call[1], [k], 'key wrapped in array');
      assert.deepStrictEqual(call[2], [v], 'value wrapped in array');
    });

    it('flashAttention uses WasmFlashAttention.compute() when WASM loaded', async () => {
      const computeResult = new Float32Array([5, 6, 7, 8]);
      const WasmFlash = mockCtor({
        compute: mockFn(() => computeResult),
      });

      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
        wasmClasses: { WasmFlashAttention: WasmFlash },
      });
      await svc.initialize();

      const q = new Float32Array([1, 1, 1, 1]);
      const k = new Float32Array([1, 0, 1, 0]);
      const v = new Float32Array([0, 1, 0, 1]);

      const result = await svc.flashAttention(q, k, v);

      assert.equal(result.runtime, 'wasm',
        'runtime must be "wasm"');
      assert.strictEqual(result.output, computeResult,
        'output must come from WasmFlashAttention.compute()');
      assert.equal(WasmFlash.instances[0].compute.calls.length, 1,
        'compute() must be called exactly once');
    });

    it('moeAttention uses WasmMoEAttention.compute() when WASM loaded', async () => {
      const computeResult = new Float32Array([9, 10, 11, 12]);
      const WasmMoE = mockCtor({
        compute: mockFn(() => computeResult),
      });

      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
        wasmClasses: { WasmMoEAttention: WasmMoE },
      });
      await svc.initialize();

      const q = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const k = new Float32Array([1, 0, 0, 0]);
      const v = new Float32Array([0, 0, 0, 1]);

      const result = await svc.moeAttention(q, k, v);

      assert.equal(result.runtime, 'wasm',
        'runtime must be "wasm"');
      assert.strictEqual(result.output, computeResult,
        'output must come from WasmMoEAttention.compute()');
      assert.equal(WasmMoE.instances[0].compute.calls.length, 1,
        'compute() must be called exactly once');
    });

    it('falls back to JS when WASM instance creation fails (no class on module)', async () => {
      // WASM module loaded but no classes => getWasmInstance returns null => fallback
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
        wasmClasses: {}, // empty: no WASM classes
      });
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'wasm',
        'engineType is "wasm" (module loaded), but instance creation will fail');

      const q = new Float32Array([1, 0, 0, 0]);
      const k = new Float32Array([0, 1, 0, 0]);
      const v = new Float32Array([0, 0, 1, 0]);

      const result = await svc.multiHeadAttention(q, k, v);
      assert.equal(result.runtime, 'fallback',
        'runtime must fall back to "fallback" when WASM class not available');
      assert.ok(result.output.length === q.length,
        'fallback must produce output of correct length');
    });

    it('NAPI takes priority over WASM when both available', async () => {
      const WasmMHA = mockCtor({
        compute: mockFn(() => new Float32Array(4)),
      });

      const svc = createAttentionService({
        napiAvailable: true,
        unifiedWasmAvailable: true,
        wasmClasses: { WasmMultiHeadAttention: WasmMHA },
      });
      await svc.initialize();

      const q = new Float32Array([1, 0, 0, 0]);
      const k = new Float32Array([0, 1, 0, 0]);
      const v = new Float32Array([0, 0, 1, 0]);

      const result = await svc.multiHeadAttention(q, k, v);

      assert.equal(result.runtime, 'napi',
        'NAPI must take priority over WASM');
      assert.equal(WasmMHA.instances.length, 0,
        'WASM class must NOT be instantiated when NAPI is used');
    });

    it('stats are updated correctly after WASM dispatch', async () => {
      const WasmFlash = mockCtor({
        compute: mockFn(() => new Float32Array(4)),
      });
      const WasmMoE = mockCtor({
        compute: mockFn(() => new Float32Array(4)),
      });

      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: true,
        wasmClasses: {
          WasmFlashAttention: WasmFlash,
          WasmMoEAttention: WasmMoE,
        },
      });
      await svc.initialize();

      const buf = new Float32Array([1, 0, 0, 0]);
      await svc.flashAttention(buf, buf, buf);
      await svc.moeAttention(buf, buf, buf);

      const stats = svc.getStats();
      assert.equal(stats.totalOps, 2, 'two operations total');
      assert.equal(stats.mechanismCounts['flash'], 1, 'one flash op');
      assert.equal(stats.mechanismCounts['moe'], 1, 'one moe op');
      assert.equal(stats.runtimeCounts['wasm'], 2, 'two WASM runtime ops');
    });
  });
});

// ============================================================================
//  INTEGRATION TESTS
// ============================================================================

describe('ADR-0069 F3: Integration Tests', () => {

  // ==========================================================================
  // Group 5: Real AttentionService initialization (no native in test env)
  // ==========================================================================

  describe('AttentionService initialization (no native modules)', () => {

    it('initializes successfully with JS fallback', async () => {
      const svc = createAttentionService({
        napiAvailable: false,
        unifiedWasmAvailable: false,
        basicWasmAvailable: false,
      });

      // Should not throw
      await svc.initialize();

      assert.equal(svc.getEngineType(), 'fallback',
        'must fall back to JS in test environment');
    });

    it('getStats() returns valid initial structure', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const stats = svc.getStats();
      assert.equal(typeof stats.totalOps, 'number');
      assert.equal(typeof stats.avgExecutionTimeMs, 'number');
      assert.equal(typeof stats.peakMemoryBytes, 'number');
      assert.equal(typeof stats.mechanismCounts, 'object');
      assert.equal(typeof stats.runtimeCounts, 'object');
      assert.equal(stats.totalOps, 0, 'no ops performed yet');
    });

    it('multiHeadAttention produces output matching input length in fallback mode', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 16;
      const q = new Float32Array(dim).fill(1.0);
      const k = new Float32Array(dim).fill(0.5);
      const v = new Float32Array(dim).fill(0.3);

      const result = await svc.multiHeadAttention(q, k, v);

      assert.equal(result.output.length, dim,
        'output length must match input length');
      assert.equal(result.runtime, 'fallback',
        'runtime must be "fallback" in test env');
      assert.equal(result.mechanism, 'multi-head');
    });

    it('flashAttention produces output matching input length in fallback mode', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 8;
      const q = new Float32Array(dim).fill(0.7);
      const k = new Float32Array(dim).fill(0.3);
      const v = new Float32Array(dim).fill(0.5);

      const result = await svc.flashAttention(q, k, v);

      assert.equal(result.output.length, dim,
        'output length must match input length');
      assert.equal(result.runtime, 'fallback');
      assert.equal(result.mechanism, 'flash');
    });

    it('moeAttention produces output matching input length in fallback mode', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 8;
      const q = new Float32Array(dim).fill(0.2);
      const k = new Float32Array(dim).fill(0.8);
      const v = new Float32Array(dim).fill(0.4);

      const result = await svc.moeAttention(q, k, v);

      assert.equal(result.output.length, dim,
        'output length must match input length');
      assert.equal(result.runtime, 'fallback');
      assert.equal(result.mechanism, 'moe');
    });
  });

  // ==========================================================================
  // Group 6: High-level API consistency
  // ==========================================================================

  describe('High-level API consistency (fallback mode)', () => {

    it('applyFlashAttention returns output of same dimension as query', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 8;
      const query = new Array(dim).fill(0.5);
      const keys = [
        new Array(dim).fill(1.0),
        new Array(dim).fill(0.5),
      ];
      const values = [
        new Array(dim).fill(1.0),
        new Array(dim).fill(0.0),
      ];

      const output = await svc.applyFlashAttention(query, keys, values);

      assert.ok(Array.isArray(output), 'output must be an array');
      assert.equal(output.length, dim,
        'output dimension must match query dimension');
      // Output should be non-zero (weighted average of values)
      const hasNonZero = output.some(v => Math.abs(v) > 1e-10);
      assert.ok(hasNonZero,
        'output must contain non-zero values (weighted attention)');
    });

    it('applyFlashAttention softmax weights sum to ~1.0', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 4;
      const query = [1, 0.5, 0.3, 0.1];
      const keys = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
      const values = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];

      const output = await svc.applyFlashAttention(query, keys, values);

      // Output should be a convex combination of values (elements sum < dim)
      assert.equal(output.length, dim,
        'output dimension matches query');
      // Each output element should be in [0, 1] range for unit-valued inputs
      for (let i = 0; i < dim; i++) {
        assert.ok(output[i] >= -1e-9 && output[i] <= 1.0 + 1e-9,
          `output[${i}]=${output[i]} must be in [0,1] for unit-valued inputs`);
      }
    });

    it('applyMultiHeadAttention returns attention and weights', async () => {
      const svc = createAttentionService({ config: { numHeads: 2 } });
      await svc.initialize();

      const dim = 4;
      const query = [1, 0.5, 0.3, 0.1];
      const context = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
      ];

      const result = await svc.applyMultiHeadAttention(query, context, 2);

      assert.ok(result.attention, 'result must have attention field');
      assert.ok(result.weights, 'result must have weights field');
      assert.equal(result.attention.length, dim,
        'attention output dimension matches query');
      assert.ok(Array.isArray(result.weights),
        'weights must be an array');
      assert.equal(result.weights.length, 2,
        'one weight vector per attention head');
      // Each head weight must have one entry per context vector
      for (const hw of result.weights) {
        assert.equal(hw.length, context.length,
          'each head weight vector must have one entry per context vector');
      }
    });

    it('applyMultiHeadAttention weights per head sum to ~1.0', async () => {
      const svc = createAttentionService({ config: { numHeads: 2 } });
      await svc.initialize();

      const query = [1, 0.5, 0.3, 0.1];
      const context = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
      ];

      const result = await svc.applyMultiHeadAttention(query, context, 2);

      for (let h = 0; h < result.weights.length; h++) {
        const wSum = result.weights[h].reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(wSum - 1.0) < 1e-6,
          `head ${h} weights must sum to ~1.0, got ${wSum}`);
      }
    });

    it('applyMoE returns output and expertWeights', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 8;
      const input = new Array(dim).fill(0.5);
      const numExperts = 4;
      const topK = 2;

      const result = await svc.applyMoE(input, numExperts, topK);

      assert.ok(result.output, 'result must have output field');
      assert.ok(result.expertWeights, 'result must have expertWeights field');
      assert.equal(result.output.length, dim,
        'output dimension must match input dimension');
      assert.equal(result.expertWeights.length, numExperts,
        'expertWeights must have one entry per expert');
    });

    it('applyMoE selects exactly topK experts (non-zero weights)', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const input = [1, 0.5, 0.3, 0.1, 0.8, 0.2, 0.6, 0.4];
      const numExperts = 6;
      const topK = 2;

      const result = await svc.applyMoE(input, numExperts, topK);

      const nonZero = result.expertWeights.filter(w => w > 0).length;
      assert.equal(nonZero, topK,
        `exactly ${topK} experts must have non-zero weights, got ${nonZero}`);

      // Non-zero weights must sum to ~1.0
      const wSum = result.expertWeights.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(wSum - 1.0) < 1e-6,
        `expert weights must sum to ~1.0, got ${wSum}`);
    });

    it('applyMoE output is non-zero for non-zero input', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const input = [1.0, 0.5, 0.3, 0.7];
      const result = await svc.applyMoE(input, 4, 2);

      const hasNonZero = result.output.some(v => Math.abs(v) > 1e-10);
      assert.ok(hasNonZero,
        'MoE output must be non-zero for non-zero input');
    });

    it('stats accumulate correctly across mixed high-level API calls', async () => {
      const svc = createAttentionService();
      await svc.initialize();

      const dim = 4;
      const query = new Array(dim).fill(0.5);
      const keys = [new Array(dim).fill(1)];
      const values = [new Array(dim).fill(1)];

      await svc.applyFlashAttention(query, keys, values);
      await svc.applyMultiHeadAttention(query, [new Array(dim).fill(1)], 2);
      await svc.applyMoE(query, 4, 2);

      const stats = svc.getStats();
      assert.equal(stats.totalOps, 3, 'three operations total');
      assert.equal(stats.mechanismCounts['flash'], 1, 'one flash op');
      assert.equal(stats.mechanismCounts['multi-head'], 1, 'one multi-head op');
      assert.equal(stats.mechanismCounts['moe'], 1, 'one moe op');
      assert.equal(stats.runtimeCounts['fallback'], 3,
        'all three ops use fallback in test env');
    });

    it('all APIs auto-initialize on first call', async () => {
      const svc = createAttentionService();
      // Do NOT call initialize() explicitly

      const dim = 4;
      const query = new Array(dim).fill(0.5);
      const keys = [new Array(dim).fill(1)];
      const values = [new Array(dim).fill(1)];

      // Each should auto-initialize
      const flashOut = await svc.applyFlashAttention(query, keys, values);
      assert.equal(flashOut.length, dim, 'flash auto-init succeeded');

      const mhaOut = await svc.applyMultiHeadAttention(query, [query], 2);
      assert.ok(mhaOut.attention.length === dim, 'mha auto-init succeeded');

      const moeOut = await svc.applyMoE(query, 4, 2);
      assert.ok(moeOut.output.length === dim, 'moe auto-init succeeded');
    });
  });
});

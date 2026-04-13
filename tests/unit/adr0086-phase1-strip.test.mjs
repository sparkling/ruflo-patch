// @tier unit
// ADR-0086 Phase 1: Verify non-storage functions stripped from memory-initializer.
//
// Checks:
//   Group 1: Quantization functions deleted (T1.1)
//   Group 2: Attention functions deleted (T1.2)
//   Group 3: Embedding adapter created (T1.3)
//   Group 4: Schema/migration delegates removed from router (T1.4)
//   Group 5: Router _wrap surface reduced (T1.1-T1.5)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const MEM_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';

const initializerPath = `${CLI_SRC}/memory/memory-initializer.ts`;
const routerPath      = `${CLI_SRC}/memory/memory-router.ts`;
const barrelPath      = `${CLI_SRC}/index.ts`;
const adapterPath     = `${MEM_SRC}/embedding-adapter.ts`;
const memBarrelPath   = `${MEM_SRC}/index.ts`;

const initializerSrc = readFileSync(initializerPath, 'utf-8');
const routerSrc      = readFileSync(routerPath, 'utf-8');
const barrelSrc      = readFileSync(barrelPath, 'utf-8');

// ============================================================================
// Group 1: Quantization functions deleted (T1.1)
// ============================================================================

describe('ADR-0086 T1.1: Quantization functions removed', () => {
  const deletedFns = ['quantizeInt8', 'dequantizeInt8', 'quantizedCosineSim', 'getQuantizationStats'];

  for (const fn of deletedFns) {
    it(`no _wrap delegate for ${fn} in router`, () => {
      const hasWrap = routerSrc.includes(`_wrap('${fn}')`);
      assert.ok(!hasWrap, `Router still has _wrap('${fn}') delegate`);
    });
  }

  it('no quantization exports in CLI barrel', () => {
    for (const fn of deletedFns) {
      assert.ok(!barrelSrc.includes(fn), `Barrel still exports ${fn}`);
    }
  });

  it('no quantize/dequantize cases in routeEmbeddingOp', () => {
    assert.ok(!routerSrc.includes("case 'quantize':"), 'Router still has quantize case');
    assert.ok(!routerSrc.includes("case 'dequantize':"), 'Router still has dequantize case');
    assert.ok(!routerSrc.includes("case 'quantizedSim':"), 'Router still has quantizedSim case');
    assert.ok(!routerSrc.includes("case 'quantizationStats':"), 'Router still has quantizationStats case');
  });

  it('no quantization function bodies in initializer', () => {
    // Bodies deleted — function definition should not exist
    assert.ok(
      !initializerSrc.includes('export function quantizeInt8('),
      'Initializer still has quantizeInt8 body',
    );
  });
});

// ============================================================================
// Group 2: Attention functions deleted (T1.2)
// ============================================================================

describe('ADR-0086 T1.2: Attention functions removed', () => {
  const deletedFns = ['batchCosineSim', 'softmaxAttention', 'topKIndices', 'flashAttentionSearch'];

  for (const fn of deletedFns) {
    it(`no _wrap delegate for ${fn} in router`, () => {
      const hasWrap = routerSrc.includes(`_wrap('${fn}')`);
      assert.ok(!hasWrap, `Router still has _wrap('${fn}') delegate`);
    });
  }

  it('no attention exports in CLI barrel', () => {
    for (const fn of deletedFns) {
      assert.ok(!barrelSrc.includes(fn), `Barrel still exports ${fn}`);
    }
  });

  it('no attention cases in routeEmbeddingOp', () => {
    assert.ok(!routerSrc.includes("case 'batchSim':"), 'Router still has batchSim case');
    assert.ok(!routerSrc.includes("case 'softmax':"), 'Router still has softmax case');
    assert.ok(!routerSrc.includes("case 'topK':"), 'Router still has topK case');
    assert.ok(!routerSrc.includes("case 'flashSearch':"), 'Router still has flashSearch case');
  });

  it('no attention function bodies in initializer', () => {
    assert.ok(
      !initializerSrc.includes('export function batchCosineSim('),
      'Initializer still has batchCosineSim body',
    );
    assert.ok(
      !initializerSrc.includes('export function flashAttentionSearch('),
      'Initializer still has flashAttentionSearch body',
    );
  });
});

// ============================================================================
// Group 3: Embedding adapter created (T1.3)
// ============================================================================

describe('ADR-0086 T1.3: Embedding adapter', () => {
  it('embedding-adapter.ts exists in memory package', () => {
    assert.ok(existsSync(adapterPath), 'embedding-adapter.ts not found');
  });

  it('adapter exports all 4 embedding functions', () => {
    const adapterSrc = readFileSync(adapterPath, 'utf-8');
    const required = ['loadEmbeddingModel', 'generateEmbedding', 'generateBatchEmbeddings', 'getAdaptiveThreshold'];
    for (const fn of required) {
      assert.ok(
        adapterSrc.includes(`export async function ${fn}`),
        `Adapter missing export: ${fn}`,
      );
    }
  });

  it('memory package barrel re-exports adapter functions', () => {
    const memBarrel = readFileSync(memBarrelPath, 'utf-8');
    const required = ['loadEmbeddingModel', 'generateEmbedding', 'generateBatchEmbeddings', 'getAdaptiveThreshold'];
    for (const fn of required) {
      assert.ok(memBarrel.includes(fn), `Memory barrel missing: ${fn}`);
    }
  });

  it('initializer embedding functions are stubs (delegate to adapter)', () => {
    // loadEmbeddingModel body should be a _loadAdapter() delegation, not the old body
    assert.ok(
      initializerSrc.includes('(await _loadAdapter()).loadEmbeddingModel('),
      'loadEmbeddingModel is not a stub — still has old body',
    );
    assert.ok(
      initializerSrc.includes('(await _loadAdapter()).generateEmbedding('),
      'generateEmbedding is not a stub — still has old body',
    );
    assert.ok(
      initializerSrc.includes('(await _loadAdapter()).generateBatchEmbeddings('),
      'generateBatchEmbeddings is not a stub — still has old body',
    );
    assert.ok(
      initializerSrc.includes('(await _loadAdapter()).getAdaptiveThreshold('),
      'getAdaptiveThreshold is not a stub — still has old body',
    );
  });

  it('old embedding module state removed from initializer', () => {
    assert.ok(
      !initializerSrc.includes('let embeddingModelState'),
      'embeddingModelState still present in initializer',
    );
    assert.ok(
      !initializerSrc.includes('function generateHashEmbedding('),
      'generateHashEmbedding still present in initializer (exists in EmbeddingPipeline)',
    );
  });
});

// ============================================================================
// Group 4: Schema/migration delegates removed from router (T1.4)
// ============================================================================

describe('ADR-0086 T1.4: Schema/migration delegates removed', () => {
  const removedFns = ['getInitialMetadata', 'ensureSchemaColumns', 'checkAndMigrateLegacy'];

  for (const fn of removedFns) {
    it(`no _wrap delegate for ${fn} in router`, () => {
      assert.ok(
        !routerSrc.includes(`_wrap('${fn}')`),
        `Router still has _wrap('${fn}') delegate`,
      );
    });
  }

  it('MEMORY_SCHEMA_V3 remains internally in initializer', () => {
    // ensureSchemaColumns deleted (dead code, V11). MEMORY_SCHEMA_V3 still used by initializeMemoryDatabase.
    assert.ok(
      initializerSrc.includes('export const MEMORY_SCHEMA_V3'),
      'MEMORY_SCHEMA_V3 should still exist internally',
    );
  });
});

// ============================================================================
// Group 5: Router _wrap surface reduced (T1.1-T1.5)
// ============================================================================

describe('ADR-0086 Phase 1: Router _wrap surface', () => {
  // Count remaining _wrap delegates
  const wrapMatches = routerSrc.match(/_wrap\('/g) || [];
  // After Phase 1: HNSW (6) + Embedding (4) + applyTemporalDecay (1) = 11
  // Plus the _wrap function definition itself = 12 matches

  it('_wrap delegates reduced to <= 12 (HNSW + embedding + decay + definition)', () => {
    assert.ok(
      wrapMatches.length <= 12,
      `Expected <= 12 _wrap references, got ${wrapMatches.length}`,
    );
  });

  it('verifyMemoryInit _wrap delegate removed', () => {
    assert.ok(
      !routerSrc.includes("_wrap('verifyMemoryInit')"),
      'Router still has verifyMemoryInit _wrap delegate',
    );
  });
});

// ============================================================================
// Group 6: Line count reduction
// ============================================================================

describe('ADR-0086 Phase 1: Line count', () => {
  const lines = initializerSrc.split('\n').length;

  it('initializer reduced from 2814 lines', () => {
    assert.ok(
      lines < 2300,
      `Expected < 2300 lines after Phase 1 strip, got ${lines}`,
    );
  });
});

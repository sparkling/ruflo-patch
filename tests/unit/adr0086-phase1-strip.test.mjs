// @tier unit
// ADR-0086 Phase 1: Verify non-storage functions stripped from memory-initializer.
//
// memory-initializer.ts was deleted (ADR-0086 Debt 6). Tests that read its
// contents are replaced with a single absence check. Tests targeting
// other files (router, barrel, adapter) remain unchanged.

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

const routerSrc      = readFileSync(routerPath, 'utf-8');
const barrelSrc      = readFileSync(barrelPath, 'utf-8');

// ============================================================================
// Guard: memory-initializer.ts is deleted (ADR-0086 Debt 6)
// ============================================================================

describe('ADR-0086 Phase 1: memory-initializer deleted', () => {
  it('memory-initializer.ts is absent (Debt 6 — all stubs removed)', () => {
    assert.ok(!existsSync(initializerPath),
      'memory-initializer.ts should be deleted (ADR-0086 Debt 6)');
  });
});

// ============================================================================
// Group 1: Quantization functions deleted (T1.1) — router + barrel checks
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
});

// ============================================================================
// Group 2: Attention functions deleted (T1.2) — router + barrel checks
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
});

// ============================================================================
// Group 5: Router _wrap surface reduced (T1.1-T1.5)
// ============================================================================

describe('ADR-0086 Phase 1: Router _wrap surface', () => {
  // Count remaining _wrap delegates
  const wrapMatches = routerSrc.match(/_wrap\('/g) || [];

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

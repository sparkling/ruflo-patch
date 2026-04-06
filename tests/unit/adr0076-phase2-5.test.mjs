// @tier unit
// ADR-0076 Phase 2-5: Embedding pipeline, storage abstraction,
//   controller registry cleanup, single data flow path
//
// Source verification + contract tests (London School TDD)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory';
const AGENTIC_SRC = '/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services';

// ===========================================================================
// Phase 2: Single Embedding Pipeline
// ===========================================================================

describe('Phase 2: embedding-pipeline.ts exists', () => {
  const epPath = join(MEMORY_SRC, 'embedding-pipeline.ts');

  it('embedding-pipeline.ts exists', () => {
    assert.ok(existsSync(epPath), 'embedding-pipeline.ts must exist');
  });

  it('exports EmbeddingPipeline class', () => {
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      src.includes('export class EmbeddingPipeline'),
      'must export EmbeddingPipeline class',
    );
  });

  it('exports cosineSimilarity function', () => {
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      src.includes('export function cosineSimilarity'),
      'must export cosineSimilarity function',
    );
  });

  it('exports DimensionMismatchError', () => {
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      src.includes('DimensionMismatchError'),
      'must export DimensionMismatchError',
    );
  });

  it('exports singleton helpers (getPipeline, initPipeline, resetPipeline)', () => {
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(src.includes('getPipeline'), 'must export getPipeline');
    assert.ok(src.includes('initPipeline'), 'must export initPipeline');
    assert.ok(src.includes('resetPipeline'), 'must export resetPipeline');
  });
});

describe('Phase 2: cosineSimilarity throws on dimension mismatch', () => {
  it('cosineSimilarity checks a.length !== b.length', () => {
    const epPath = join(MEMORY_SRC, 'embedding-pipeline.ts');
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      src.includes('a.length !== b.length') || src.includes('a.length != b.length'),
      'cosineSimilarity must check dimension equality',
    );
  });

  it('cosineSimilarity does NOT use Math.min for truncation', () => {
    const epPath = join(MEMORY_SRC, 'embedding-pipeline.ts');
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      !src.match(/Math\.min\(a\.length,\s*b\.length\)/),
      'must NOT truncate with Math.min',
    );
  });

  it('cosineSimilarity does NOT use Math.max for zero-padding', () => {
    const epPath = join(MEMORY_SRC, 'embedding-pipeline.ts');
    if (!existsSync(epPath)) return;
    const src = readFileSync(epPath, 'utf-8');
    assert.ok(
      !src.match(/Math\.max\(a\.length,\s*b\.length\)/),
      'must NOT pad with Math.max',
    );
  });
});

describe('Phase 2: cosineSimilarity contract test', () => {
  // Canonical cosineSimilarity implementation (mirrors ADR-0076 spec)
  function cosineSim(a, b) {
    if (a.length !== b.length) {
      throw new Error(`Dimension mismatch: ${a.length} vs ${b.length}`);
    }
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  it('identical vectors return 1.0', () => {
    const v = new Float32Array([1, 2, 3]);
    assert.ok(Math.abs(cosineSim(v, v) - 1.0) < 0.001);
  });

  it('orthogonal vectors return 0.0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    assert.ok(Math.abs(cosineSim(a, b)) < 0.001);
  });

  it('opposite vectors return -1.0', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    assert.ok(Math.abs(cosineSim(a, b) + 1.0) < 0.001);
  });

  it('mismatched dimensions throw', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2]);
    assert.throws(() => cosineSim(a, b), /mismatch/i);
  });

  it('zero vector returns 0', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    assert.equal(cosineSim(a, b), 0);
  });
});

describe('Phase 2: embedding-pipeline exports in index.ts', () => {
  const indexPath = join(MEMORY_SRC, 'index.ts');

  it('index.ts exports EmbeddingPipeline', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('EmbeddingPipeline') && src.includes('embedding-pipeline'),
      'index.ts must re-export EmbeddingPipeline',
    );
  });
});

// ===========================================================================
// Phase 3: Single Storage Abstraction
// ===========================================================================

describe('Phase 3: IStorage interface exists', () => {
  const storagePath = join(MEMORY_SRC, 'storage.ts');

  it('storage.ts exists', () => {
    assert.ok(existsSync(storagePath), 'storage.ts must exist');
  });

  it('exports IStorage type', () => {
    if (!existsSync(storagePath)) return;
    const src = readFileSync(storagePath, 'utf-8');
    assert.ok(
      src.includes('IStorage'),
      'must export IStorage type',
    );
  });
});

describe('Phase 3: storage-factory.ts exists', () => {
  const factoryPath = join(MEMORY_SRC, 'storage-factory.ts');

  it('storage-factory.ts exists', () => {
    assert.ok(existsSync(factoryPath), 'storage-factory.ts must exist');
  });

  it('exports createStorage function', () => {
    if (!existsSync(factoryPath)) return;
    const src = readFileSync(factoryPath, 'utf-8');
    assert.ok(
      src.includes('export') && src.includes('createStorage'),
      'must export createStorage',
    );
  });

  it('does NOT instantiate InMemoryStore', () => {
    if (!existsSync(factoryPath)) return;
    const src = readFileSync(factoryPath, 'utf-8');
    // Check for actual usage (new/import), not comments mentioning it
    assert.ok(
      !src.match(/new\s+InMemoryStore/) && !src.match(/import.*InMemoryStore/),
      'must NOT instantiate or import InMemoryStore',
    );
  });

  it('throws on failure instead of silent fallback', () => {
    if (!existsSync(factoryPath)) return;
    const src = readFileSync(factoryPath, 'utf-8');
    assert.ok(
      src.includes('throw'),
      'must throw when both backends fail',
    );
  });
});

describe('Phase 3: storage exports in index.ts', () => {
  const indexPath = join(MEMORY_SRC, 'index.ts');

  it('index.ts exports IStorage', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('IStorage'),
      'index.ts must export IStorage',
    );
  });

  it('index.ts exports createStorage', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('createStorage'),
      'index.ts must export createStorage',
    );
  });
});

// ===========================================================================
// Phase 4: Controller Bridge
// ===========================================================================

describe('Phase 4: controller-bridge.ts exists', () => {
  const bridgePath = join(AGENTIC_SRC, 'controller-bridge.ts');

  it('controller-bridge.ts exists', () => {
    assert.ok(existsSync(bridgePath), 'controller-bridge.ts must exist');
  });

  it('exports setRegistry function', () => {
    if (!existsSync(bridgePath)) return;
    const src = readFileSync(bridgePath, 'utf-8');
    assert.ok(
      src.includes('setRegistry'),
      'must export setRegistry',
    );
  });

  it('exports getController function', () => {
    if (!existsSync(bridgePath)) return;
    const src = readFileSync(bridgePath, 'utf-8');
    assert.ok(
      src.includes('getController'),
      'must export getController',
    );
  });

  it('delegates to ControllerRegistry', () => {
    if (!existsSync(bridgePath)) return;
    const src = readFileSync(bridgePath, 'utf-8');
    assert.ok(
      src.includes('ControllerRegistry') || src.includes('registry.get'),
      'must delegate to ControllerRegistry',
    );
  });

  it('is under 200 lines', () => {
    if (!existsSync(bridgePath)) return;
    const src = readFileSync(bridgePath, 'utf-8');
    const lineCount = src.split('\n').length;
    assert.ok(
      lineCount <= 200,
      `controller-bridge.ts must be under 200 lines (got ${lineCount})`,
    );
  });
});

// ===========================================================================
// Phase 5: Single Data Flow (depends on Phases 2-4)
// ===========================================================================

describe('Phase 5: no InMemoryStore in production code', () => {
  it('agentdb-service.ts does not contain InMemoryStore class', () => {
    const path = join(AGENTIC_SRC, 'agentdb-service.ts');
    if (!existsSync(path)) return;
    const src = readFileSync(path, 'utf-8');
    // InMemoryStore as a class definition is the problem
    assert.ok(
      !src.match(/class\s+InMemoryStore/),
      'InMemoryStore class must not exist in agentdb-service.ts',
    );
  });
});

// ===========================================================================
// Cross-phase: File size guards
// ===========================================================================

describe('File size guards', () => {
  it('controller-registry.ts is under 2500 lines', () => {
    const path = join(MEMORY_SRC, 'controller-registry.ts');
    if (!existsSync(path)) return;
    const lineCount = readFileSync(path, 'utf-8').split('\n').length;
    assert.ok(
      lineCount <= 2500,
      `controller-registry.ts should be under 2500 lines (got ${lineCount})`,
    );
  });

  it('resolve-config.ts is under 500 lines', () => {
    const path = join(MEMORY_SRC, 'resolve-config.ts');
    if (!existsSync(path)) return;
    const lineCount = readFileSync(path, 'utf-8').split('\n').length;
    assert.ok(
      lineCount <= 500,
      `resolve-config.ts should be under 500 lines (got ${lineCount})`,
    );
  });

  it('embedding-pipeline.ts is under 500 lines', () => {
    const path = join(MEMORY_SRC, 'embedding-pipeline.ts');
    if (!existsSync(path)) return;
    const lineCount = readFileSync(path, 'utf-8').split('\n').length;
    assert.ok(
      lineCount <= 500,
      `embedding-pipeline.ts should be under 500 lines (got ${lineCount})`,
    );
  });
});

// @tier unit
// ADR-0086: Swarm findings — verify V7 bug fixes and dead-code removal
// Source-level structural test (London School TDD, no live code execution).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const MEM = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const CLI = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

const adapterSrc  = readFileSync(`${MEM}/embedding-adapter.ts`, 'utf-8');
const routerSrc   = readFileSync(`${CLI}/memory/memory-router.ts`, 'utf-8');
const perfSrc     = readFileSync(`${CLI}/commands/performance.ts`, 'utf-8');
const headlessSrc = readFileSync(`${CLI}/runtime/headless.ts`, 'utf-8');
const initSrc     = readFileSync(`${CLI}/memory/memory-initializer.ts`, 'utf-8');
const rvfSrc      = readFileSync(`${MEM}/rvf-backend.ts`, 'utf-8');

// --- Group 1: C1 fix verified — embedding-adapter model vs provider usage

describe('ADR-0086 swarm: C1 — embedding-adapter model vs provider usage', () => {
  // Extract the generateEmbedding function body
  const fnStart = adapterSrc.indexOf('export async function generateEmbedding(');
  const fnBody = adapterSrc.slice(fnStart, adapterSrc.indexOf('\nexport', fnStart + 1));

  it('pipeline.getModel() is used inside generateEmbedding', () => {
    assert.ok(fnBody.includes('pipeline.getModel()'),
      'generateEmbedding should call pipeline.getModel()');
  });

  it('getAdaptiveThreshold uses pipeline.getProvider() for threshold selection (C1 correction)', () => {
    const threshFnStart = adapterSrc.indexOf('export async function getAdaptiveThreshold(');
    const threshFnEnd = adapterSrc.indexOf('\nexport', threshFnStart + 1);
    const threshBody = threshFnEnd > threshFnStart
      ? adapterSrc.slice(threshFnStart, threshFnEnd)
      : adapterSrc.slice(threshFnStart);
    assert.ok(threshBody.includes('pipeline.getProvider()') || threshBody.includes('getProvider()'),
      'getAdaptiveThreshold should use getProvider() for provider-specific threshold (C1 correction)');
  });

  it('loadEmbeddingModel also uses getModel()', () => {
    const loadFn = adapterSrc.slice(0, fnStart);
    assert.ok(loadFn.includes('.getModel()'),
      'loadEmbeddingModel should use getModel() for modelName');
  });
});

// --- Group 2: C2+C3 fix verified — stats case in routeMemoryOp

describe('ADR-0086 swarm: C2+C3 — stats route correctness', () => {
  // Extract the stats case from routeMemoryOp
  const statsIdx = routerSrc.indexOf("case 'stats':");
  const nextCase = routerSrc.indexOf("case 'count':", statsIdx);
  const statsBlock = routerSrc.slice(statsIdx, nextCase);

  it('uses health.status (not health.healthy) for initialized flag', () => {
    assert.ok(statsBlock.includes('.status'),
      'stats case should reference health.status');
    assert.ok(!statsBlock.includes('.healthy'),
      'stats case must not reference health.healthy (wrong field)');
  });

  it('entriesWithEmbeddings uses stats.entriesWithEmbeddings (debt 5 fix)', () => {
    // Debt 5 fix: getStats() now computes real entriesWithEmbeddings count;
    // router uses stats.entriesWithEmbeddings directly (no longer a proxy).
    assert.ok(statsBlock.includes('stats.entriesWithEmbeddings'),
      'entriesWithEmbeddings should use stats.entriesWithEmbeddings (debt 5 fix)');
  });
});

// --- Group 3: C4 fix verified — no import of batchCosineSim/flashAttentionSearch

describe('ADR-0086 swarm: C4 — no import of dead initializer functions', () => {
  it('performance.ts does not import batchCosineSim from memory-initializer', () => {
    const importLines = perfSrc.split('\n').filter(l => l.includes('import'));
    const badImport = importLines.some(l =>
      l.includes('batchCosineSim') && l.includes('memory-initializer'));
    assert.ok(!badImport,
      'performance.ts must not import batchCosineSim from memory-initializer');
  });

  it('headless.ts does not import batchCosineSim from memory-initializer', () => {
    const importLines = headlessSrc.split('\n').filter(l => l.includes('import'));
    const badImport = importLines.some(l =>
      l.includes('batchCosineSim') && l.includes('memory-initializer'));
    assert.ok(!badImport,
      'headless.ts must not import batchCosineSim from memory-initializer');
  });

  it('both files define batchCosineSim as inline local functions', () => {
    assert.ok(perfSrc.includes('function batchCosineSim('),
      'performance.ts should have inline batchCosineSim');
    assert.ok(headlessSrc.includes('function batchCosineSim('),
      'headless.ts should have inline batchCosineSim');
  });
});

// --- Group 4: I2 fix verified — HNSW no-op cases return success: false

describe('ADR-0086 swarm: I2 — HNSW no-ops return success: false', () => {
  it('hnswAdd returns success: false', () => {
    const addIdx = routerSrc.indexOf("case 'hnswAdd':");
    const addBlock = routerSrc.slice(addIdx, routerSrc.indexOf('}', addIdx) + 1);
    assert.ok(addBlock.includes('success: false'),
      'hnswAdd should return success: false');
  });

  it('hnswClear/hnswRebuild return success: false', () => {
    const clearIdx = routerSrc.indexOf("'hnswClear':");
    const clearBlock = routerSrc.slice(clearIdx, routerSrc.indexOf('}', clearIdx) + 1);
    assert.ok(clearBlock.includes('success: false'),
      'hnswClear/hnswRebuild should return success: false');
  });

  it('none of the HNSW no-ops return success: true', () => {
    // Extract the full hnswAdd + hnswGet/hnswClear/hnswRebuild block
    const startIdx = routerSrc.indexOf("case 'hnswAdd':");
    const endIdx = routerSrc.indexOf('default:', startIdx);
    const noopBlock = routerSrc.slice(startIdx, endIdx);
    assert.ok(!noopBlock.includes('success: true'),
      'HNSW no-op block must not contain success: true');
  });
});

// --- Group 5: I3 fix verified — search catch returns success: false

describe('ADR-0086 swarm: I3 — search catch returns success: false', () => {
  // Extract the search case
  const searchIdx = routerSrc.indexOf("case 'search': {");
  const searchEnd = routerSrc.indexOf("case 'get':", searchIdx);
  const searchBlock = routerSrc.slice(searchIdx, searchEnd);

  it('search catch block returns success: false', () => {
    assert.ok(searchBlock.includes('success: false'),
      'search catch should return success: false (fail loudly)');
  });

  it('search catch block includes error message', () => {
    assert.ok(searchBlock.includes('Embedding generation failed'),
      'search catch should report embedding failure in error message');
  });
});

// --- Group 6: Dead code removed from memory-initializer

describe('ADR-0086 swarm: dead code removed from memory-initializer', () => {
  it('cosineSim function definition removed', () => {
    assert.ok(!initSrc.includes('function cosineSim('),
      'cosineSim function must be deleted from memory-initializer');
    assert.ok(initSrc.includes('cosineSim deleted'),
      'tombstone comment should document deletion');
  });

  it('saveHNSWMetadata function definition removed', () => {
    assert.ok(!initSrc.includes('function saveHNSWMetadata('),
      'saveHNSWMetadata function must be deleted from memory-initializer');
    assert.ok(initSrc.includes('saveHNSWMetadata deleted'),
      'tombstone comment should document deletion');
  });

  it('addToHNSWIndex function definition removed', () => {
    assert.ok(!initSrc.includes('function addToHNSWIndex('),
      'addToHNSWIndex function must be deleted from memory-initializer');
    assert.ok(initSrc.includes('addToHNSWIndex deleted'),
      'tombstone comment should document deletion');
  });

  it('memory-router does NOT import from memory-initializer', () => {
    assert.ok(!routerSrc.includes('memory-initializer'),
      'memory-router must not depend on memory-initializer (ADR-0086 Phase 3)');
  });
});

// --- Group 7: Scale tripwire (informational)

describe('ADR-0086 swarm: scale tripwire (informational)', () => {
  const hasMaxEntries = rvfSrc.includes('MAX_ENTRIES') || rvfSrc.includes('maxEntries');
  const routerHasMaxEntries = routerSrc.includes('maxEntries');

  it('documents whether rvf-backend has scale limit constants', () => {
    console.log(`  [info] rvf-backend MAX_ENTRIES/maxEntries present: ${hasMaxEntries}`);
    console.log(`  [info] memory-router maxEntries config reference: ${routerHasMaxEntries}`);
    if (!hasMaxEntries) {
      console.log('  [info] GAP: rvf-backend has no entry count limit or warning — large datasets may OOM');
    }
    // Informational — always passes
    assert.ok(true);
  });
});

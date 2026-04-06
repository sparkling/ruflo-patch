// @tier unit
// ADR-0076 Phase 2: Verify consumer files are wired to EmbeddingPipeline
//
// Source verification tests — check that consumer files delegate to the
// canonical EmbeddingPipeline / cosineSimilarity instead of using their own.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory';
const HOOKS_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/hooks/src/reasoningbank';
const SWARM_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src';
const NEURAL_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/neural/src';
const GUIDANCE_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/guidance/src';

// ===========================================================================
// generateEmbedding() routes through EmbeddingPipeline
// ===========================================================================

describe('Phase 2 wiring: generateEmbedding routes through pipeline', () => {
  const file = `${CLI_SRC}/memory-initializer.ts`;

  it('generateEmbedding() has getPipeline redirect at top', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // Find the generateEmbedding function and check for pipeline redirect
    const fnStart = src.indexOf('export async function generateEmbedding');
    assert.ok(fnStart !== -1, 'generateEmbedding function must exist');
    // The pipeline redirect should appear before the legacy path
    const afterFn = src.slice(fnStart, fnStart + 600);
    assert.ok(
      afterFn.includes('getPipeline'),
      'generateEmbedding must try getPipeline() before legacy path',
    );
  });

  it('pipeline redirect returns pipeline.embed() result', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    const fnStart = src.indexOf('export async function generateEmbedding');
    const afterFn = src.slice(fnStart, fnStart + 600);
    assert.ok(
      afterFn.includes('pipeline.embed'),
      'must call pipeline.embed() in the redirect',
    );
  });
});

// ===========================================================================
// cosineSim() delegates to canonical cosineSimilarity
// ===========================================================================

describe('Phase 2 wiring: cosineSim delegates to canonical cosineSimilarity', () => {
  const files = [
    [`${CLI_SRC}/memory-bridge.ts`, 'memory-bridge.ts'],
    [`${CLI_SRC}/intelligence.ts`, 'intelligence.ts'],
  ];

  for (const [path, name] of files) {
    it(`${name} cosineSim tries canonical cosineSimilarity first`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      // Find the cosineSim function
      const fnMatch = src.match(/cosineSim\(a.*?\).*?\{/);
      assert.ok(fnMatch, `${name} must have a cosineSim function`);
      const fnStart = src.indexOf(fnMatch[0]);
      const afterFn = src.slice(fnStart, fnStart + 400);
      assert.ok(
        afterFn.includes('cosineSimilarity') && afterFn.includes('@claude-flow/memory'),
        `${name} cosineSim must delegate to cosineSimilarity from @claude-flow/memory`,
      );
    });

    it(`${name} cosineSim still has inline fallback`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      // The inline fallback should still exist (for when the package isn't available)
      assert.ok(
        src.includes('a.length !== b.length'),
        `${name} must retain inline dimension check as fallback`,
      );
    });
  }
});

// ===========================================================================
// createEmbeddingService() uses EmbeddingPipeline
// ===========================================================================

describe('Phase 2 wiring: createEmbeddingService uses pipeline', () => {
  const file = `${MEMORY_SRC}/controller-registry.ts`;

  it('createEmbeddingService tries getPipeline() before stub', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    const fnStart = src.indexOf('private createEmbeddingService()');
    assert.ok(fnStart !== -1, 'createEmbeddingService method must exist');
    const afterFn = src.slice(fnStart, fnStart + 800);
    assert.ok(
      afterFn.includes('getPipeline'),
      'createEmbeddingService must try getPipeline() before falling back to stub',
    );
  });

  it('pipeline path wraps pipeline.embed in embedder interface', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    const fnStart = src.indexOf('private createEmbeddingService()');
    const afterFn = src.slice(fnStart, fnStart + 800);
    assert.ok(
      afterFn.includes('pipeline.embed'),
      'must wrap pipeline.embed() in the embedder interface',
    );
  });
});

// ===========================================================================
// 4 embedding-constants.ts files use centralized config
// ===========================================================================

describe('Phase 2 wiring: embedding-constants consolidated', () => {
  const files = [
    [`${HOOKS_SRC}/embedding-constants.ts`, 'hooks'],
    [`${SWARM_SRC}/embedding-constants.ts`, 'swarm'],
    [`${NEURAL_SRC}/embedding-constants.ts`, 'neural'],
    [`${GUIDANCE_SRC}/embedding-constants.ts`, 'guidance'],
  ];

  for (const [path, pkg] of files) {
    it(`${pkg}/embedding-constants.ts imports from @claude-flow/memory`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        src.includes("@claude-flow/memory") || src.includes('./resolve-config'),
        `${pkg} embedding-constants must import from centralized config`,
      );
    });

    it(`${pkg}/embedding-constants.ts does NOT do its own agentdb import`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        !src.includes("import('agentdb')") && !src.includes("require('agentdb')"),
        `${pkg} embedding-constants must NOT import agentdb directly`,
      );
    });

    it(`${pkg}/embedding-constants.ts exports EMBEDDING_DIM`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        src.includes('export const EMBEDDING_DIM'),
        `${pkg} must export EMBEDDING_DIM`,
      );
    });
  }
});

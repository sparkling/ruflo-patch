// @tier unit
// ADR-0076 Phase 2: Contract regression tests for EmbeddingPipeline
//
// Guards the single embedding entry point that replaced 6 scattered embedding
// implementations. Source: @claude-flow/memory/src/embedding-pipeline.ts
//
// The CLI memory-router and the embedding-adapter both depend on this contract;
// rename a method or change a return shape here and downstream stops compiling.
// Tests are structural — they read the source with readFileSync and assert
// on declarations.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC   = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const PIPELINE_PATH = `${MEMORY_SRC}/embedding-pipeline.ts`;
const ADAPTER_PATH  = `${MEMORY_SRC}/embedding-adapter.ts`;
const INDEX_PATH    = `${MEMORY_SRC}/index.ts`;

assert.ok(existsSync(PIPELINE_PATH), `embedding-pipeline.ts not found at ${PIPELINE_PATH}`);
assert.ok(existsSync(ADAPTER_PATH),  `embedding-adapter.ts not found at ${ADAPTER_PATH}`);
assert.ok(existsSync(INDEX_PATH),    `memory index.ts not found at ${INDEX_PATH}`);

const pipelineSrc = readFileSync(PIPELINE_PATH, 'utf-8');
const adapterSrc  = readFileSync(ADAPTER_PATH,  'utf-8');
const indexSrc    = readFileSync(INDEX_PATH,    'utf-8');

// ============================================================================
// Group 1: EmbeddingPipeline class + public exports
// ============================================================================

describe('ADR-0076 embedding-pipeline: public exports', () => {
  it('EmbeddingPipeline class is exported', () => {
    assert.ok(
      /export\s+class\s+EmbeddingPipeline\b/.test(pipelineSrc),
      'embedding-pipeline.ts must export `class EmbeddingPipeline`',
    );
  });

  it('initPipeline(config) function is exported', () => {
    assert.ok(
      /export\s+(async\s+)?function\s+initPipeline\s*\(/.test(pipelineSrc),
      'embedding-pipeline.ts must export `function initPipeline()`',
    );
  });

  it('getPipeline() function is exported', () => {
    assert.ok(
      /export\s+function\s+getPipeline\s*\(/.test(pipelineSrc),
      'embedding-pipeline.ts must export `function getPipeline()`',
    );
  });

  it('resetPipeline() function is exported (test-only reset)', () => {
    assert.ok(
      /export\s+function\s+resetPipeline\s*\(/.test(pipelineSrc),
      'embedding-pipeline.ts must export `function resetPipeline()`',
    );
  });

  it('DimensionMismatchError class is exported', () => {
    assert.ok(
      /export\s+class\s+DimensionMismatchError\b/.test(pipelineSrc),
      'embedding-pipeline.ts must export DimensionMismatchError',
    );
  });

  it('cosineSimilarity function is exported', () => {
    assert.ok(
      /export\s+function\s+cosineSimilarity\s*\(/.test(pipelineSrc),
      'embedding-pipeline.ts must export `function cosineSimilarity()`',
    );
  });

  it('EmbeddingConfig type/interface is exported', () => {
    assert.ok(
      /export\s+interface\s+EmbeddingConfig\b/.test(pipelineSrc) ||
      /export\s+type\s+EmbeddingConfig\b/.test(pipelineSrc),
      'embedding-pipeline.ts must export EmbeddingConfig type',
    );
  });

  it('memory barrel re-exports EmbeddingPipeline + initPipeline', () => {
    assert.ok(indexSrc.includes('EmbeddingPipeline'), 'index.ts must re-export EmbeddingPipeline');
    assert.ok(indexSrc.includes('initPipeline'),      'index.ts must re-export initPipeline');
  });
});

// ============================================================================
// Group 2: EmbeddingPipeline instance methods
// ============================================================================

describe('ADR-0076 embedding-pipeline: instance methods', () => {
  // Required public methods the consumers rely on
  const requiredMethods = [
    'initialize',  // async — load model and validate dimension
    'embed',       // async — generate embedding for text
    'getProvider', // sync — which provider is active
    'getModel',    // sync — configured model name
    'getDimension',// sync — configured dimension (768)
    'isInitialized', // sync — initialize() has completed
  ];

  for (const method of requiredMethods) {
    it(`EmbeddingPipeline declares method: ${method}`, () => {
      // Match either `async name(` or `name(` inside the class body.
      const re = new RegExp(`(async\\s+)?${method}\\s*\\(`);
      assert.ok(
        re.test(pipelineSrc),
        `EmbeddingPipeline must declare method '${method}'`,
      );
    });
  }

  it('embed() returns Promise<Float32Array>', () => {
    // Match: `async embed(text: string): Promise<Float32Array>`
    assert.ok(
      /async\s+embed\s*\([^)]*\)\s*:\s*Promise<\s*Float32Array\s*>/.test(pipelineSrc),
      'EmbeddingPipeline.embed() must return Promise<Float32Array>',
    );
  });

  it('initialize() returns Promise<void>', () => {
    assert.ok(
      /async\s+initialize\s*\(\s*\)\s*:\s*Promise<\s*void\s*>/.test(pipelineSrc),
      'EmbeddingPipeline.initialize() must return Promise<void>',
    );
  });
});

// ============================================================================
// Group 3: Provider names (canonical strings consumers may compare against)
// ============================================================================

describe('ADR-0076 embedding-pipeline: provider name canonicalisation', () => {
  it('hash-fallback provider name is exactly "hash-fallback"', () => {
    assert.ok(
      pipelineSrc.includes("'hash-fallback'") || pipelineSrc.includes('"hash-fallback"'),
      'Pipeline must use the literal "hash-fallback" provider name',
    );
  });

  it('ONNX provider name is exactly "transformers.js" (NOT "transformers")', () => {
    assert.ok(
      pipelineSrc.includes("'transformers.js'") || pipelineSrc.includes('"transformers.js"'),
      'Pipeline must use the literal "transformers.js" provider name',
    );
    // Negative: forbid the bare "transformers" string as a provider literal.
    // (Imports like `from '@xenova/transformers'` are fine — we only forbid
    // a standalone `provider = 'transformers'` style literal.)
    const badProvider = /provider\s*[:=]\s*['"]transformers['"]\W/;
    assert.ok(
      !badProvider.test(pipelineSrc),
      'Pipeline must NOT use the bare "transformers" provider literal — use "transformers.js"',
    );
  });

  it('ruvector provider name is exactly "ruvector"', () => {
    assert.ok(
      pipelineSrc.includes("'ruvector'") || pipelineSrc.includes('"ruvector"'),
      'Pipeline must use the literal "ruvector" provider name',
    );
  });

  it('provider type union includes the three canonical providers', () => {
    // Match a union type literal that contains all three provider strings.
    // Example: `provider: 'transformers.js' | 'ruvector' | 'hash-fallback' = 'hash-fallback';`
    const hasUnion =
      pipelineSrc.includes("'transformers.js'") &&
      pipelineSrc.includes("'ruvector'") &&
      pipelineSrc.includes("'hash-fallback'");
    assert.ok(hasUnion, 'Pipeline must declare the three canonical provider names');
  });
});

// ============================================================================
// Group 4: Model caching (singleton + lazy load)
// ============================================================================

describe('ADR-0076 embedding-pipeline: model caching + singleton', () => {
  it('module holds a _pipeline singleton', () => {
    assert.ok(
      /let\s+_pipeline\s*:/.test(pipelineSrc),
      'embedding-pipeline must hold a module-level _pipeline singleton',
    );
  });

  it('initPipeline() returns the cached singleton on subsequent calls', () => {
    const fnStart = pipelineSrc.indexOf('export async function initPipeline');
    assert.ok(fnStart > -1, 'initPipeline not found');
    const fnBody = pipelineSrc.slice(fnStart, fnStart + 800);
    assert.ok(
      /if\s*\(\s*_pipeline\s*\)\s*return\s+_pipeline/.test(fnBody),
      'initPipeline() must short-circuit to the cached singleton',
    );
  });

  it('initPipeline() serializes concurrent callers via _initPromise', () => {
    assert.ok(
      /_initPromise/.test(pipelineSrc),
      'initPipeline() must serialize concurrent callers via _initPromise',
    );
  });

  it('initialize() caches the loaded model on the instance', () => {
    // Field declaration: `private model: any = null;` and `this.initialized = true;`
    assert.ok(
      /private\s+model\s*:\s*any/.test(pipelineSrc) ||
      /this\.model\s*=/.test(pipelineSrc),
      'EmbeddingPipeline must cache the loaded model on the instance',
    );
    assert.ok(
      /this\.initialized\s*=\s*true/.test(pipelineSrc),
      'EmbeddingPipeline.initialize() must flip an initialized flag',
    );
  });
});

// ============================================================================
// Group 5: Dimension safety (fails loud on mismatch)
// ============================================================================

describe('ADR-0076 embedding-pipeline: dimension safety', () => {
  it('initialize() throws DimensionMismatchError on probe mismatch', () => {
    const fnStart = pipelineSrc.indexOf('async _doInitialize');
    assert.ok(fnStart > -1, '_doInitialize not found');
    const fnBody = pipelineSrc.slice(fnStart, fnStart + 2000);
    assert.ok(
      /throw\s+new\s+DimensionMismatchError/.test(fnBody),
      '_doInitialize must throw DimensionMismatchError on probe mismatch',
    );
  });

  it('embed() throws DimensionMismatchError when output length differs', () => {
    const fnStart = pipelineSrc.indexOf('async embed');
    assert.ok(fnStart > -1, 'embed() not found');
    const fnBody = pipelineSrc.slice(fnStart, fnStart + 600);
    assert.ok(
      /throw\s+new\s+DimensionMismatchError/.test(fnBody),
      'embed() must throw DimensionMismatchError on length mismatch',
    );
  });

  it('cosineSimilarity throws DimensionMismatchError on length mismatch', () => {
    const fnStart = pipelineSrc.indexOf('export function cosineSimilarity');
    assert.ok(fnStart > -1, 'cosineSimilarity() not found');
    const fnBody = pipelineSrc.slice(fnStart, fnStart + 600);
    assert.ok(
      /throw\s+new\s+DimensionMismatchError/.test(fnBody),
      'cosineSimilarity must throw DimensionMismatchError on length mismatch',
    );
  });
});

// ============================================================================
// Group 6: embedding-adapter contract (CLI-facing return shape)
// ============================================================================

describe('ADR-0076 embedding-adapter: generateEmbedding return shape', () => {
  it('embedding-adapter.ts exports generateEmbedding()', () => {
    assert.ok(
      /export\s+async\s+function\s+generateEmbedding\s*\(/.test(adapterSrc),
      'embedding-adapter.ts must export `generateEmbedding`',
    );
  });

  it('generateEmbedding returns { embedding: number[], dimensions, model }', () => {
    // Source declares the return type literally — match it.
    const fnStart = adapterSrc.indexOf('export async function generateEmbedding');
    assert.ok(fnStart > -1, 'generateEmbedding not found');
    const fnBody = adapterSrc.slice(fnStart, fnStart + 600);
    assert.ok(fnBody.includes('embedding: number[]'), 'generateEmbedding must declare `embedding: number[]` in return shape');
    assert.ok(fnBody.includes('dimensions: number'),  'generateEmbedding must declare `dimensions: number` in return shape');
    assert.ok(fnBody.includes('model: string'),       'generateEmbedding must declare `model: string` in return shape');
  });

  it('embedding-adapter.ts exports loadEmbeddingModel + getAdaptiveThreshold', () => {
    assert.ok(
      /export\s+async\s+function\s+loadEmbeddingModel\s*\(/.test(adapterSrc),
      'embedding-adapter must export loadEmbeddingModel',
    );
    assert.ok(
      /export\s+async\s+function\s+getAdaptiveThreshold\s*\(/.test(adapterSrc),
      'embedding-adapter must export getAdaptiveThreshold',
    );
  });
});

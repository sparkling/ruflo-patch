// @tier unit
// ADR-0076 Phase 1: Contract regression tests for resolve-config.ts
//
// Guards the public contract of the unified config resolution module.
// Source: @claude-flow/memory/src/resolve-config.ts
//
// These tests are structural (London School TDD) — they read the fork source
// with readFileSync and assert on its shape. No I/O beyond reads, no mocking
// runtime behavior. Failures here indicate someone changed the contract that
// downstream consumers (CLI router, embedding pipeline, controllers) depend on.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC  = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const RESOLVE_PATH = `${MEMORY_SRC}/resolve-config.ts`;
const INDEX_PATH   = `${MEMORY_SRC}/index.ts`;

// Hard assertion before reads — never silently pass on a missing fork.
assert.ok(existsSync(RESOLVE_PATH), `resolve-config.ts not found at ${RESOLVE_PATH}`);
assert.ok(existsSync(INDEX_PATH),   `memory index.ts not found at ${INDEX_PATH}`);

const resolveSrc = readFileSync(RESOLVE_PATH, 'utf-8');
const indexSrc   = readFileSync(INDEX_PATH,   'utf-8');

// ============================================================================
// Group 1: Public exports
// ============================================================================

describe('ADR-0076 resolve-config: public exports', () => {
  it('exports getConfig() function', () => {
    assert.ok(
      /export\s+function\s+getConfig\s*\(/.test(resolveSrc),
      'resolve-config.ts must export `function getConfig()`',
    );
  });

  it('exports resolveConfig() function', () => {
    assert.ok(
      /export\s+function\s+resolveConfig\s*\(/.test(resolveSrc),
      'resolve-config.ts must export `function resolveConfig()`',
    );
  });

  it('exports resetConfig() function (test-only reset)', () => {
    assert.ok(
      /export\s+function\s+resetConfig\s*\(/.test(resolveSrc),
      'resolve-config.ts must export `function resetConfig()`',
    );
  });

  it('exports ResolvedConfig type/interface', () => {
    assert.ok(
      /export\s+interface\s+ResolvedConfig\b/.test(resolveSrc) ||
      /export\s+type\s+ResolvedConfig\b/.test(resolveSrc),
      'resolve-config.ts must export ResolvedConfig type',
    );
  });

  it('exports ConfigOverrides type/interface', () => {
    assert.ok(
      /export\s+interface\s+ConfigOverrides\b/.test(resolveSrc) ||
      /export\s+type\s+ConfigOverrides\b/.test(resolveSrc),
      'resolve-config.ts must export ConfigOverrides type',
    );
  });

  it('memory package barrel re-exports getConfig/resolveConfig', () => {
    assert.ok(indexSrc.includes('getConfig'),     'index.ts must re-export getConfig');
    assert.ok(indexSrc.includes('resolveConfig'), 'index.ts must re-export resolveConfig');
    assert.ok(indexSrc.includes('ResolvedConfig'), 'index.ts must re-export ResolvedConfig type');
  });
});

// ============================================================================
// Group 2: ResolvedConfig sections (the immutable shape downstream depends on)
// ============================================================================

describe('ADR-0076 resolve-config: ResolvedConfig sections', () => {
  // Extract the ResolvedConfig interface body
  const ifaceStart = resolveSrc.indexOf('export interface ResolvedConfig');
  assert.ok(ifaceStart !== -1, 'ResolvedConfig interface not found');

  let braceDepth = 0;
  let blockStart = -1;
  let blockEnd = -1;
  for (let i = ifaceStart; i < resolveSrc.length; i++) {
    if (resolveSrc[i] === '{') {
      if (braceDepth === 0) blockStart = i;
      braceDepth++;
    } else if (resolveSrc[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) { blockEnd = i; break; }
    }
  }
  assert.ok(blockStart !== -1 && blockEnd !== -1, 'Could not delimit ResolvedConfig body');
  const ifaceBody = resolveSrc.slice(blockStart, blockEnd + 1);

  // Required top-level sections (as declared in the source today)
  const requiredSections = ['embedding', 'storage', 'hnsw', 'memory', 'learning', 'graph'];

  for (const section of requiredSections) {
    it(`ResolvedConfig has section: ${section}`, () => {
      // Match `readonly section: { ... }` at top level of interface
      const sectionRe = new RegExp(`readonly\\s+${section}\\s*:`);
      assert.ok(
        sectionRe.test(ifaceBody),
        `ResolvedConfig must declare section '${section}'. Body:\n${ifaceBody}`,
      );
    });
  }

  it('ResolvedConfig.embedding contains model + dimension + provider', () => {
    // Find the embedding section block
    const embStart = ifaceBody.indexOf('embedding:');
    assert.ok(embStart > -1, 'embedding section not found');
    const embBlock = ifaceBody.slice(embStart, embStart + 300);
    assert.ok(embBlock.includes('model'),     'embedding section must declare model');
    assert.ok(embBlock.includes('dimension'), 'embedding section must declare dimension');
    assert.ok(embBlock.includes('provider'),  'embedding section must declare provider');
  });

  it('ResolvedConfig.storage contains databasePath + provider', () => {
    const storeStart = ifaceBody.indexOf('storage:');
    assert.ok(storeStart > -1, 'storage section not found');
    const storeBlock = ifaceBody.slice(storeStart, storeStart + 300);
    assert.ok(storeBlock.includes('databasePath'), 'storage section must declare databasePath');
    assert.ok(storeBlock.includes('provider'),     'storage section must declare provider');
  });

  it('ResolvedConfig.learning has the learning-bridge knobs', () => {
    // The "learningBridge" naming in the requirement maps to the `learning` section
    // which holds sona/decay/EWC settings. These are the fields the LearningBridge
    // controller reads at construction.
    const lrnStart = ifaceBody.indexOf('learning:');
    assert.ok(lrnStart > -1, 'learning section not found');
    const lrnBlock = ifaceBody.slice(lrnStart, lrnStart + 400);
    assert.ok(lrnBlock.includes('sonaMode'),                'learning must declare sonaMode');
    assert.ok(lrnBlock.includes('confidenceDecayRate'),     'learning must declare confidenceDecayRate');
    assert.ok(lrnBlock.includes('consolidationThreshold'),  'learning must declare consolidationThreshold');
    assert.ok(lrnBlock.includes('ewcLambda'),               'learning must declare ewcLambda');
  });

  it('ResolvedConfig.graph has the memory-graph knobs', () => {
    // The "memoryGraph" naming in the requirement maps to the `graph` section,
    // which holds pageRank/maxNodes/similarity settings consumed by MemoryGraph.
    const grphStart = ifaceBody.indexOf('graph:');
    assert.ok(grphStart > -1, 'graph section not found');
    const grphBlock = ifaceBody.slice(grphStart, grphStart + 400);
    assert.ok(grphBlock.includes('pageRankDamping'),    'graph must declare pageRankDamping');
    assert.ok(grphBlock.includes('maxNodes'),           'graph must declare maxNodes');
    assert.ok(grphBlock.includes('similarityThreshold'), 'graph must declare similarityThreshold');
  });
});

// ============================================================================
// Group 3: Default constants (the canonical Layer-4 fallback values)
// ============================================================================

describe('ADR-0076 resolve-config: hardcoded defaults', () => {
  it('DEFAULT_DATABASE_PATH = ".claude-flow/memory.rvf"', () => {
    assert.ok(
      /DEFAULT_DATABASE_PATH\s*=\s*['"]\.claude-flow\/memory\.rvf['"]/.test(resolveSrc),
      'DEFAULT_DATABASE_PATH must be ".claude-flow/memory.rvf"',
    );
  });

  it('DEFAULT_DIMENSION = 768 (ADR-0069)', () => {
    assert.ok(
      /DEFAULT_DIMENSION\s*=\s*768\b/.test(resolveSrc),
      'DEFAULT_DIMENSION must be 768',
    );
  });

  it('DEFAULT_MODEL = "Xenova/all-mpnet-base-v2" (canonical full name)', () => {
    assert.ok(
      /DEFAULT_MODEL\s*=\s*['"]Xenova\/all-mpnet-base-v2['"]/.test(resolveSrc),
      'DEFAULT_MODEL must be the canonical full Xenova path',
    );
  });

  it('DEFAULT_PROVIDER = "transformers.js"', () => {
    assert.ok(
      /DEFAULT_PROVIDER\s*=\s*['"]transformers\.js['"]/.test(resolveSrc),
      'DEFAULT_PROVIDER must be "transformers.js"',
    );
  });

  it('DEFAULT_STORAGE_PROVIDER = "rvf" (RVF is primary — ADR-0086)', () => {
    assert.ok(
      /DEFAULT_STORAGE_PROVIDER[^=]*=\s*['"]rvf['"]/.test(resolveSrc),
      'DEFAULT_STORAGE_PROVIDER must be "rvf"',
    );
  });

  it('hard guard: never resolves to 384 (ADR-0069)', () => {
    // The function must contain a safety net that flips 384 -> 768.
    assert.ok(
      /dimension\s*===\s*384/.test(resolveSrc),
      'resolve-config must contain a 384 -> 768 safety net',
    );
  });
});

// ============================================================================
// Group 4: Layer precedence (overrides > embeddings.json > agentdb > defaults)
// ============================================================================

describe('ADR-0076 resolve-config: layer precedence', () => {
  it('mentions Layer 1 (overrides)', () => {
    assert.ok(
      /Layer\s*1/i.test(resolveSrc) || /overrides/.test(resolveSrc),
      'resolve-config must implement Layer 1 (overrides)',
    );
  });

  it('mentions Layer 2 (embeddings.json)', () => {
    assert.ok(
      /readEmbeddingsJson/.test(resolveSrc),
      'resolve-config must read embeddings.json',
    );
  });

  it('mentions Layer 3 (agentdb getEmbeddingConfig)', () => {
    assert.ok(
      /tryAgentdbConfig|getEmbeddingConfig/.test(resolveSrc),
      'resolve-config must consult agentdb.getEmbeddingConfig',
    );
  });

  it('mentions Layer 4 (hardcoded defaults)', () => {
    assert.ok(
      /Layer\s*4|hardcoded\s+defaults?/i.test(resolveSrc),
      'resolve-config must declare Layer 4 (hardcoded defaults)',
    );
  });

  it('explicit overrides take highest priority (applied last in resolveConfig)', () => {
    // Find the resolveConfig function body, verify `if (overrides)` block exists
    const fnStart = resolveSrc.indexOf('export function resolveConfig');
    assert.ok(fnStart > -1, 'resolveConfig function not found');
    const fnBody = resolveSrc.slice(fnStart, fnStart + 8000);
    assert.ok(
      /if\s*\(\s*overrides\s*\)/.test(fnBody),
      'resolveConfig must apply overrides last (Layer 1 wins)',
    );
  });
});

// ============================================================================
// Group 5: readEmbeddingsJson walks up from cwd
// ============================================================================

describe('ADR-0076 resolve-config: readEmbeddingsJson cwd walk', () => {
  it('readEmbeddingsJson() function exists', () => {
    assert.ok(
      /function\s+readEmbeddingsJson\s*\(/.test(resolveSrc),
      'readEmbeddingsJson() function must exist',
    );
  });

  it('readEmbeddingsJson walks parent directories from cwd', () => {
    // Structural check: function body must reference process.cwd, dirname, parent loop.
    const fnStart = resolveSrc.indexOf('function readEmbeddingsJson');
    assert.ok(fnStart > -1, 'readEmbeddingsJson not found');
    // Capture ~600 chars of body
    const fnBody = resolveSrc.slice(fnStart, fnStart + 800);

    assert.ok(fnBody.includes('process.cwd'),     'readEmbeddingsJson must start at process.cwd()');
    assert.ok(fnBody.includes('dirname'),         'readEmbeddingsJson must call dirname() to walk up');
    assert.ok(fnBody.includes('.claude-flow'),    'readEmbeddingsJson must look in .claude-flow/');
    assert.ok(fnBody.includes('embeddings.json'), 'readEmbeddingsJson must read embeddings.json');
    // Loop construct (while)
    assert.ok(/while\s*\(/.test(fnBody),          'readEmbeddingsJson must loop until filesystem root');
  });
});

// ============================================================================
// Group 6: Singleton + freeze semantics
// ============================================================================

describe('ADR-0076 resolve-config: singleton + immutability', () => {
  it('uses a module-level singleton variable', () => {
    assert.ok(
      /let\s+_singleton\s*:/.test(resolveSrc),
      'resolve-config must hold a module-level _singleton',
    );
  });

  it('returns deep-frozen ResolvedConfig (immutable)', () => {
    assert.ok(
      /deepFreeze\(/.test(resolveSrc),
      'resolveConfig must deep-freeze its result before returning',
    );
  });

  it('getConfig() falls back to resolveConfig() when singleton is null', () => {
    const fnStart = resolveSrc.indexOf('export function getConfig');
    assert.ok(fnStart > -1, 'getConfig() not found');
    const fnBody = resolveSrc.slice(fnStart, fnStart + 200);
    assert.ok(
      /_singleton\s*\?\?\s*resolveConfig\(/.test(fnBody) ||
      (fnBody.includes('_singleton') && fnBody.includes('resolveConfig(')),
      'getConfig() must fall back to resolveConfig() when not yet initialized',
    );
  });
});

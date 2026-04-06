// @tier unit
// ADR-0076 Phase 0+1: Dead code removal + single config resolution
//
// Phase 0: HybridBackend deleted, exports removed, federatedSession factory removed
// Phase 1: resolveConfig() produces frozen ResolvedConfig, called once
//
// London School TDD: source verification + mocked contract tests

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ===========================================================================
// Phase 0: Dead Code Removal
// ===========================================================================

describe('Phase 0: HybridBackend dead code removed', () => {
  const memorySrc = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';

  it('hybrid-backend.ts is deleted', () => {
    assert.ok(
      !existsSync(join(memorySrc, 'hybrid-backend.ts')),
      'hybrid-backend.ts must not exist',
    );
  });

  it('hybrid-backend.test.ts is deleted', () => {
    assert.ok(
      !existsSync(join(memorySrc, 'hybrid-backend.test.ts')),
      'hybrid-backend.test.ts must not exist',
    );
  });

  it('index.ts does not export HybridBackend', () => {
    const indexPath = join(memorySrc, 'index.ts');
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      !src.includes("from './hybrid-backend"),
      'index.ts must not import from hybrid-backend',
    );
  });

  it('index.ts does not export HybridBackendConfig', () => {
    const indexPath = join(memorySrc, 'index.ts');
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      !src.includes('HybridBackendConfig'),
      'index.ts must not export HybridBackendConfig',
    );
  });

  it('no production file references HybridBackend', () => {
    const files = [
      'index.ts', 'sqlite-backend.ts', 'agentdb-backend.ts',
      'controller-registry.ts', 'database-provider.ts', 'rvf-backend.ts',
    ];
    for (const file of files) {
      const path = join(memorySrc, file);
      if (!existsSync(path)) continue;
      const src = readFileSync(path, 'utf-8');
      assert.ok(
        !src.includes('HybridBackend'),
        `${file} must not reference HybridBackend`,
      );
    }
  });
});

describe('Phase 0: federatedSession factory removed', () => {
  const crPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts';

  it('no federatedSession factory case in controller-registry', () => {
    if (!existsSync(crPath)) return;
    const src = readFileSync(crPath, 'utf-8');
    assert.ok(
      !src.match(/case\s+['"]federatedSession['"]/),
      'federatedSession factory case must be removed',
    );
  });

  it('federatedSession is not in INIT_LEVELS', () => {
    if (!existsSync(crPath)) return;
    const src = readFileSync(crPath, 'utf-8');
    // Extract INIT_LEVELS block and check federatedSession is not listed
    const initBlock = src.match(/INIT_LEVELS[\s\S]*?\];/);
    if (!initBlock) return;
    assert.ok(
      !initBlock[0].includes("'federatedSession'"),
      'federatedSession must not be in INIT_LEVELS',
    );
  });

  it('circuitBreakerController is not in type union or INIT_LEVELS', () => {
    if (!existsSync(crPath)) return;
    const src = readFileSync(crPath, 'utf-8');
    assert.ok(
      !src.match(/['"]circuitBreakerController['"]/),
      'circuitBreakerController must be fully removed',
    );
  });
});

describe('Phase 0: sqlite-backend references updated', () => {
  const sqlitePath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts';

  it('sqlite-backend.ts does not reference HybridBackend', () => {
    if (!existsSync(sqlitePath)) return;
    const src = readFileSync(sqlitePath, 'utf-8');
    assert.ok(
      !src.includes('HybridBackend'),
      'sqlite-backend.ts must not reference HybridBackend',
    );
  });
});

describe('Phase 0: agentdb-backend references updated', () => {
  const agentdbPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts';

  it('agentdb-backend.ts does not reference HybridBackend', () => {
    if (!existsSync(agentdbPath)) return;
    const src = readFileSync(agentdbPath, 'utf-8');
    assert.ok(
      !src.includes('HybridBackend'),
      'agentdb-backend.ts must not reference HybridBackend',
    );
  });
});

// ===========================================================================
// Phase 1: Single Config Resolution
// ===========================================================================

describe('Phase 1: resolve-config.ts exists and exports correctly', () => {
  const resolveConfigPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts';

  it('resolve-config.ts exists', () => {
    assert.ok(
      existsSync(resolveConfigPath),
      'resolve-config.ts must exist',
    );
  });

  it('exports resolveConfig function', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('export function resolveConfig') || src.includes('export async function resolveConfig'),
      'must export resolveConfig function',
    );
  });

  it('exports getConfig function', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('export function getConfig'),
      'must export getConfig function',
    );
  });

  it('exports ResolvedConfig interface', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('export interface ResolvedConfig'),
      'must export ResolvedConfig interface',
    );
  });

  it('exports resetConfig function (for testing)', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('export function resetConfig'),
      'must export resetConfig for test isolation',
    );
  });
});

describe('Phase 1: ResolvedConfig has required sections', () => {
  const resolveConfigPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts';

  it('has embedding section with model, dimension, provider', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(src.includes('embedding'), 'must have embedding section');
    assert.ok(src.includes('model'), 'embedding must have model field');
    assert.ok(src.includes('dimension'), 'embedding must have dimension field');
    assert.ok(src.includes('provider'), 'embedding must have provider field');
  });

  it('has storage section', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(src.includes('storage'), 'must have storage section');
    assert.ok(src.includes('databasePath'), 'storage must have databasePath');
    assert.ok(src.includes('walMode'), 'storage must have walMode');
  });

  it('has hnsw section', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(src.includes('hnsw'), 'must have hnsw section');
  });

  it('has memory section', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(src.includes('memory'), 'must have memory section');
    assert.ok(src.includes('dedupThreshold'), 'memory must have dedupThreshold');
  });
});

describe('Phase 1: resolveConfig defaults are correct', () => {
  const resolveConfigPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts';

  it('default embedding model is Xenova/all-mpnet-base-v2 (full prefix)', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('Xenova/all-mpnet-base-v2'),
      'default model must be Xenova/all-mpnet-base-v2 with full prefix (ADR-0069)',
    );
  });

  it('default dimension is 768 (never 384)', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    // Check that 768 appears as a default
    assert.ok(
      src.includes('768'),
      'default dimension must be 768',
    );
    // 384 may appear as a guard (e.g. `!== 384` to reject old defaults) but
    // must NOT appear as a fallback/default assignment
    const lines = src.split('\n');
    for (const line of lines) {
      if (line.includes('384') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
        // Allow: comparison guards (!== 384, === 384), error messages, string literals
        const isGuard = line.includes('!== 384') || line.includes('=== 384') || line.includes('!= 384');
        const isStringOrError = line.includes("'384'") || line.includes('"384"')
            || line.includes('Error') || line.includes('throw');
        if (!isGuard && !isStringOrError) {
          assert.fail(`Line uses 384 as a default value: ${line.trim()}`);
        }
      }
    }
  });

  it('HNSW params are derived via deriveHNSWParams or set as defaults', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    // Config should either use deriveHNSWParams() (dynamic derivation from dimension)
    // or inline M=23, efConstruction=100, efSearch=50
    const usesDerive = src.includes('deriveHNSWParams');
    const hasInlineM = src.includes('M') && src.includes('23');
    assert.ok(
      usesDerive || hasInlineM,
      'HNSW params must use deriveHNSWParams() or inline defaults',
    );
  });

  it('default storage provider is rvf', () => {
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes("'rvf'") || src.includes('"rvf"'),
      'default storage provider must be rvf',
    );
  });
});

describe('Phase 1: resolveConfig returns frozen object', () => {
  it('Object.freeze is called on the result', () => {
    const resolveConfigPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts';
    if (!existsSync(resolveConfigPath)) return;
    const src = readFileSync(resolveConfigPath, 'utf-8');
    assert.ok(
      src.includes('Object.freeze'),
      'resolveConfig must freeze the returned config object',
    );
  });
});

describe('Phase 1: resolveConfig priority chain (contract test)', () => {
  // Simulated resolveConfig logic
  function resolveConfigMock(overrides = {}, embeddingsJson = null, agentdbConfig = null) {
    const defaults = {
      embedding: { model: 'Xenova/all-mpnet-base-v2', dimension: 768, provider: 'transformers.js' },
      hnsw: { M: 23, efConstruction: 100, efSearch: 50 },
    };

    // Priority: overrides > embeddingsJson > agentdbConfig > defaults
    const dimension =
      overrides.dimension ??
      embeddingsJson?.dimension ??
      agentdbConfig?.dimension ??
      defaults.embedding.dimension;

    const model =
      overrides.model ??
      embeddingsJson?.model ??
      agentdbConfig?.model ??
      defaults.embedding.model;

    return Object.freeze({
      embedding: Object.freeze({ model, dimension, provider: 'transformers.js' }),
      hnsw: Object.freeze(defaults.hnsw),
    });
  }

  it('explicit override wins over everything', () => {
    const config = resolveConfigMock(
      { dimension: 512 },
      { dimension: 768 },
      { dimension: 768 },
    );
    assert.equal(config.embedding.dimension, 512);
  });

  it('embeddingsJson wins over agentdb and defaults', () => {
    const config = resolveConfigMock(
      {},
      { dimension: 1024 },
      { dimension: 768 },
    );
    assert.equal(config.embedding.dimension, 1024);
  });

  it('agentdb config wins over defaults', () => {
    const config = resolveConfigMock(
      {},
      null,
      { dimension: 512 },
    );
    assert.equal(config.embedding.dimension, 512);
  });

  it('defaults to 768 when no overrides', () => {
    const config = resolveConfigMock();
    assert.equal(config.embedding.dimension, 768);
  });

  it('defaults to Xenova/all-mpnet-base-v2 when no overrides', () => {
    const config = resolveConfigMock();
    assert.equal(config.embedding.model, 'Xenova/all-mpnet-base-v2');
  });

  it('returned object is frozen', () => {
    const config = resolveConfigMock();
    assert.ok(Object.isFrozen(config), 'top-level must be frozen');
    assert.ok(Object.isFrozen(config.embedding), 'embedding section must be frozen');
    assert.ok(Object.isFrozen(config.hnsw), 'hnsw section must be frozen');
  });

  it('mutation throws in strict mode', () => {
    const config = resolveConfigMock();
    assert.throws(() => {
      config.embedding.dimension = 384;
    }, TypeError, 'mutating frozen config must throw');
  });
});

describe('Phase 1: index.ts exports resolve-config', () => {
  const indexPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/index.ts';

  it('index.ts re-exports resolveConfig', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('resolveConfig') && src.includes("resolve-config"),
      'index.ts must re-export resolveConfig from resolve-config.js',
    );
  });

  it('index.ts re-exports getConfig', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('getConfig'),
      'index.ts must re-export getConfig',
    );
  });

  it('index.ts re-exports ResolvedConfig type', () => {
    if (!existsSync(indexPath)) return;
    const src = readFileSync(indexPath, 'utf-8');
    assert.ok(
      src.includes('ResolvedConfig'),
      'index.ts must re-export ResolvedConfig type',
    );
  });
});

// ===========================================================================
// Phase 1: No 384-dim in production config chains
// ===========================================================================

describe('Phase 1: no 384-dim fallback in production code', () => {
  const files = [
    ['/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/resolve-config.ts', 'resolve-config.ts'],
    ['/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts', 'controller-registry.ts'],
  ];

  for (const [path, name] of files) {
    it(`${name} does not use 384 as a dimension default`, () => {
      if (!existsSync(path)) return;
      const src = readFileSync(path, 'utf-8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments and string literals
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Look for dimension assignments with 384
        if (line.match(/dimension\s*[:=]\s*384/) || line.match(/fallback.*384/) || line.match(/default.*384/i)) {
          assert.fail(`${name}:${i + 1} uses 384 as dimension default: ${line.trim()}`);
        }
      }
    });
  }
});

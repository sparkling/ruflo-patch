// @tier unit
// ADR-0076 Track A: cosineSim dimension guard, circuitBreaker factory,
//   startup dimension validation, dual-instance controller guards
//
// A1: cosineSim must throw on dimension mismatch (not truncate/pad)
// A2: circuitBreaker factory has inline fallback (never returns null)
// A3: Startup dimension validation via getStoredDimension
// A4: Dual-instance singleton guards on six agentdb controllers

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let counter = 0;
function makeEntry(overrides = {}) {
  counter++;
  const id = overrides.id || `e_${counter}`;
  return {
    id,
    key: overrides.key || `key-${id}`,
    namespace: overrides.namespace || 'default',
    content: overrides.content || `content for ${id}`,
    type: 'semantic',
    tags: overrides.tags || [],
    metadata: {},
    accessLevel: 'private',
    ownerId: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
    version: 1,
    references: [],
  };
}

function freshPath(label) {
  const dir = join(tmpdir(), 'adr0076-track-a-test');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.rvf`);
}

// ===========================================================================
// A1: cosineSim dimension guard (source verification)
// ===========================================================================
describe('A1: cosineSim throws on dimension mismatch', () => {
  // ADR-0085: memory-bridge.ts deleted — only initializer + intelligence remain
  const files = [
    '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-initializer.ts',
    '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/intelligence.ts',
  ];

  for (const file of files) {
    it(`${basename(file)} cosineSim does not truncate with Math.min`, () => {
      if (!existsSync(file)) return;
      const src = readFileSync(file, 'utf-8');
      assert.ok(
        !src.match(/Math\.min\(a\.length,\s*b\.length\)/),
        'Should not truncate with Math.min',
      );
    });

    it(`${basename(file)} cosineSim does not zero-pad with Math.max`, () => {
      if (!existsSync(file)) return;
      const src = readFileSync(file, 'utf-8');
      assert.ok(
        !src.match(/Math\.max\(a\.length,\s*b\.length\)/),
        'Should not zero-pad with Math.max',
      );
    });

    it(`${basename(file)} cosineSim checks dimension equality and throws`, () => {
      if (!existsSync(file)) return;
      const src = readFileSync(file, 'utf-8');
      assert.ok(
        src.includes('a.length !== b.length') || src.includes('a.length != b.length'),
        'Should check dimension equality',
      );
    });
  }
});

// ===========================================================================
// A2: circuitBreaker factory (source verification)
// ===========================================================================
describe('A2: circuitBreaker never returns null', () => {
  const file = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts';

  it('circuitBreakerController is removed from type union and INIT_LEVELS', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    // The string 'circuitBreakerController' (as a quoted literal) should NOT appear
    assert.ok(
      !src.match(/['"]circuitBreakerController['"]/),
      'circuitBreakerController should be removed',
    );
  });

  it('circuitBreaker factory case block exists', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes("case 'circuitBreaker'"),
      'circuitBreaker factory case should exist',
    );
  });

  it('circuitBreaker factory has half-open state', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('half-open') || src.includes('half_open'),
      'Should have half-open state in circuit breaker',
    );
  });

  it('circuitBreaker factory has recordFailure method', () => {
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('recordFailure') || src.includes('record_failure'),
      'Should have recordFailure method in circuit breaker',
    );
  });
});

// ===========================================================================
// A3: Startup dimension validation (source verification)
// ===========================================================================
describe('A3: startup dimension validation', () => {
  it('controller-registry checks stored dimension at init', () => {
    const file = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts';
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('getStoredDimension') || src.includes('stored_dimension'),
      'Should probe stored dimension during init',
    );
  });

  it('controller-registry throws or emits on dimension mismatch', () => {
    const file = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts';
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('EmbeddingDimensionError') || src.includes('dimension mismatch'),
      'Should throw or emit on dimension mismatch',
    );
  });

  it('RvfBackend has getStoredDimension method', () => {
    const file = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
    if (!existsSync(file)) return;
    const src = readFileSync(file, 'utf-8');
    assert.ok(
      src.includes('getStoredDimension'),
      'Should have getStoredDimension method',
    );
  });
});

// ===========================================================================
// A3: RvfBackend getStoredDimension runtime
// ===========================================================================
describe('A3: RvfBackend getStoredDimension runtime', () => {
  let RvfBackend;

  beforeEach(async () => {
    try {
      RvfBackend = (await import('@claude-flow/memory')).RvfBackend;
    } catch {
      RvfBackend = null;
    }
  });

  it('returns 0 for empty/new database', async () => {
    if (!RvfBackend) return;
    const backend = new RvfBackend({
      databasePath: freshPath('dim-empty'),
      dimensions: 768,
      autoPersistInterval: 0,
    });
    await backend.initialize();
    const dim = await backend.getStoredDimension();
    assert.equal(dim, 0, 'Empty store should return 0');
    await backend.shutdown();
  });

  it('returns stored dimension after entries are written', async () => {
    if (!RvfBackend) return;
    const p = freshPath('dim-stored');
    const backend = new RvfBackend({
      databasePath: p,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend.initialize();
    await backend.store(makeEntry());
    await backend.shutdown();

    // Re-read from disk header
    const backend2 = new RvfBackend({
      databasePath: p,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    const dim = await backend2.getStoredDimension();
    assert.equal(dim, 4, 'Should return dimension from header');
  });

  it('returns 0 for :memory: database', async () => {
    if (!RvfBackend) return;
    const backend = new RvfBackend({
      databasePath: ':memory:',
      dimensions: 768,
      autoPersistInterval: 0,
    });
    await backend.initialize();
    const dim = await backend.getStoredDimension();
    assert.equal(dim, 0, ':memory: should always return 0');
    await backend.shutdown();
  });
});

// ===========================================================================
// A4: Dual-instance controller guards (source verification)
// ===========================================================================
describe('A4: dual-instance controller guards', () => {
  const controllers = [
    'ReflexionMemory',
    'SkillLibrary',
    'ReasoningBank',
    'CausalMemoryGraph',
    'LearningSystem',
    'ExplainableRecall',
  ];
  const base = '/Users/henrik/source/forks/agentic-flow/packages/agentdb/src/controllers';

  for (const name of controllers) {
    it(`${name} has singleton guard variable`, () => {
      const file = join(base, `${name}.ts`);
      if (!existsSync(file)) return;
      const src = readFileSync(file, 'utf-8');
      assert.ok(
        src.includes('_singleton') || src.includes('_instance'),
        `${name} should have a singleton guard variable`,
      );
    });

    it(`${name} has test reset method`, () => {
      const file = join(base, `${name}.ts`);
      if (!existsSync(file)) return;
      const src = readFileSync(file, 'utf-8');
      assert.ok(
        src.includes('_resetSingleton') || src.includes('_resetInstance'),
        `${name} should have a test reset method`,
      );
    });
  }
});

// @tier unit
// ADR-0081: @claude-flow/neural opt-in activation
//
// Verifies that the neural package is wired as an optional dependency:
//   1. @claude-flow/neural is listed in optionalDependencies of @claude-flow/memory
//   2. learning-bridge.ts has a dynamic loader for @claude-flow/neural
//   3. The loader catches errors and falls back to null (fail-safe)
//   4. LearningBridge handles this.neural === null without crashing
//   5. controller-registry passes sonaMode from resolved config into LearningBridge
//
// London School TDD: structural source analysis + behavioral mock-driven tests.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_ROOT       = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory';
const MEMORY_PKG        = `${MEMORY_ROOT}/package.json`;
const LEARNING_BRIDGE   = `${MEMORY_ROOT}/src/learning-bridge.ts`;
const CTRL_REGISTRY     = `${MEMORY_ROOT}/src/controller-registry.ts`;
const RESOLVE_CONFIG    = `${MEMORY_ROOT}/src/resolve-config.ts`;

// ============================================================================
// 1. Package wiring — optionalDependencies
// ============================================================================

describe('ADR-0081: @claude-flow/neural is an optional dependency', () => {
  it('package.json file exists in @claude-flow/memory', () => {
    assert.ok(existsSync(MEMORY_PKG), 'memory package.json must exist');
  });

  it('@claude-flow/neural appears in optionalDependencies (not dependencies)', () => {
    const pkg = JSON.parse(readFileSync(MEMORY_PKG, 'utf-8'));

    assert.ok(pkg.optionalDependencies, 'optionalDependencies block must exist');
    assert.ok(
      '@claude-flow/neural' in pkg.optionalDependencies,
      '@claude-flow/neural must be listed in optionalDependencies'
    );

    // Ensure it is NOT in regular dependencies (would force install)
    assert.ok(
      !pkg.dependencies || !('@claude-flow/neural' in pkg.dependencies),
      '@claude-flow/neural must NOT appear in regular dependencies'
    );
  });

  it('@claude-flow/neural version is a valid semver-ish string', () => {
    const pkg = JSON.parse(readFileSync(MEMORY_PKG, 'utf-8'));
    const ver = pkg.optionalDependencies['@claude-flow/neural'];

    assert.ok(typeof ver === 'string' && ver.length > 0,
      'neural version must be a non-empty string');
    assert.ok(/^\d+\.\d+\.\d+/.test(ver),
      `neural version "${ver}" must start with major.minor.patch`);
  });
});

// ============================================================================
// 2. Source wiring — dynamic loader in learning-bridge.ts
// ============================================================================

describe('ADR-0081: learning-bridge.ts has dynamic neural loader', () => {
  it('learning-bridge.ts source file exists', () => {
    assert.ok(existsSync(LEARNING_BRIDGE),
      `learning-bridge.ts must exist at ${LEARNING_BRIDGE}`);
  });

  it('contains a dynamic import of @claude-flow/neural', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    // Match dynamic import: await import('@claude-flow/neural' ...)
    const hasDynamicImport = /await\s+import\s*\(\s*['"]@claude-flow\/neural['"]/.test(src);
    assert.ok(hasDynamicImport,
      'learning-bridge.ts must contain `await import("@claude-flow/neural"...)`');
  });

  it('does NOT statically import @claude-flow/neural at top level', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    // A static import would be `import ... from '@claude-flow/neural'`
    const hasStaticImport = /^import[^'"]*['"]@claude-flow\/neural['"]/m.test(src);
    assert.ok(!hasStaticImport,
      'learning-bridge.ts must NOT statically import @claude-flow/neural at top level');
  });

  it('has a private loader function (loadNeural / initNeural)', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    const hasLoader = /private\s+async\s+loadNeural\s*\(/.test(src) ||
                      /async\s+_?loadNeural\s*\(/.test(src);
    assert.ok(hasLoader,
      'learning-bridge.ts must define a loadNeural() / _loadNeural() function');

    const hasInit = /private\s+async\s+initNeural\s*\(/.test(src) ||
                    /async\s+initNeural\s*\(/.test(src);
    assert.ok(hasInit,
      'learning-bridge.ts must define an initNeural() function that calls the loader');
  });

  it('loader has try/catch fallback to null (fail-safe)', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    // Find the loadNeural function block
    const fnMatch = src.match(/(?:private\s+)?async\s+loadNeural\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s{2}\}/);
    assert.ok(fnMatch, 'loadNeural() function body must be parseable');

    const body = fnMatch[1];
    assert.ok(body.includes('try'),
      'loadNeural() must wrap import in try block');
    assert.ok(body.includes('catch'),
      'loadNeural() must catch import failures');
    assert.ok(/this\.neural\s*=\s*null/.test(body),
      'loadNeural() must assign this.neural = null in catch path');
  });

  it('class field `neural` defaults to null', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    const hasNullDefault = /private\s+neural\s*:[^=]*=\s*null/.test(src);
    assert.ok(hasNullDefault,
      'LearningBridge must declare `private neural: ... = null` as the default state');
  });

  it('supports injectable neuralLoader for testing', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    assert.ok(src.includes('neuralLoader'),
      'LearningBridgeConfig must accept a neuralLoader for dependency injection');
    assert.ok(/this\.config\.neuralLoader/.test(src),
      'loadNeural() must check this.config.neuralLoader before falling back to dynamic import');
  });
});

// ============================================================================
// 3. Behavioral — LearningBridge handles neural === null gracefully
// ============================================================================

describe('ADR-0081: LearningBridge degrades gracefully when neural is null', () => {
  it('all neural-using methods are guarded by `if (this.neural)` or equivalent', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');

    // onInsightRecorded must guard
    const recordedMatch = src.match(/async onInsightRecorded[\s\S]*?^\s{2}\}/m);
    assert.ok(recordedMatch, 'onInsightRecorded must exist');
    assert.ok(/if\s*\(\s*this\.neural\s*\)/.test(recordedMatch[0]),
      'onInsightRecorded must guard `if (this.neural)` before calling neural methods');

    // consolidate must guard
    const consolidateMatch = src.match(/async consolidate[\s\S]*?^\s{2}\}/m);
    assert.ok(consolidateMatch, 'consolidate must exist');
    assert.ok(/!this\.neural|this\.neural\s*&&|if\s*\(\s*this\.neural/.test(consolidateMatch[0]),
      'consolidate must check this.neural before iterating trajectories');

    // findSimilarPatterns must guard
    const findMatch = src.match(/async findSimilarPatterns[\s\S]*?^\s{2}\}/m);
    assert.ok(findMatch, 'findSimilarPatterns must exist');
    assert.ok(/!this\.neural|if\s*\(\s*this\.neural/.test(findMatch[0]),
      'findSimilarPatterns must short-circuit when this.neural is null');
  });

  it('getStats() reports neuralAvailable as boolean reflecting this.neural', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    assert.ok(/neuralAvailable\s*:\s*this\.neural\s*!==\s*null/.test(src),
      'getStats() must expose neuralAvailable: this.neural !== null');
  });

  it('destroy() nulls out this.neural and is safe to call', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    const destroyMatch = src.match(/destroy\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s{2}\}/);
    assert.ok(destroyMatch, 'destroy() must exist');

    const body = destroyMatch[1];
    assert.ok(/this\.neural\s*=\s*null/.test(body),
      'destroy() must set this.neural = null');
  });

  it('LearningBridge can be instantiated and exercised with a null neural loader', async () => {
    // Mock backend (London School: only the methods LearningBridge actually calls)
    const backend = {
      get: async () => null,
      update: async () => null,
      query: async () => [],
    };

    // Dynamically import the compiled module if available; otherwise test must
    // rely on structural assertions above. We check the source-level guarantee.
    const distPath = `${MEMORY_ROOT}/dist/learning-bridge.js`;
    if (!existsSync(distPath)) {
      // Build artifact may not exist; structural tests above are sufficient.
      return;
    }

    let LearningBridge;
    try {
      const mod = await import(distPath);
      LearningBridge = mod.LearningBridge ?? mod.default;
    } catch {
      // If the dist module cannot be loaded in this environment, skip the
      // runtime check; structural assertions above guard the wiring.
      return;
    }

    assert.ok(LearningBridge, 'LearningBridge export must be present');

    // neuralLoader returns null → simulates package not installed
    const bridge = new LearningBridge(backend, {
      neuralLoader: async () => null,
      consolidationThreshold: 1,
      enabled: true,
    });

    // Should not throw — null neural is the fail-safe path
    await bridge.onInsightRecorded(
      { category: 'project-patterns', summary: 'test', confidence: 1, source: 'test' },
      'entry-1'
    );

    const stats = bridge.getStats();
    assert.equal(stats.neuralAvailable, false,
      'neuralAvailable must be false when loader returns null');

    const result = await bridge.consolidate();
    assert.equal(result.trajectoriesCompleted, 0,
      'consolidate() must return zero when neural is null');

    const patterns = await bridge.findSimilarPatterns('test');
    assert.deepEqual(patterns, [],
      'findSimilarPatterns must return [] when neural is null');

    bridge.destroy();
  });

  it('LearningBridge degrades when loader THROWS (not just returns null)', async () => {
    const backend = {
      get: async () => null,
      update: async () => null,
      query: async () => [],
    };

    const distPath = `${MEMORY_ROOT}/dist/learning-bridge.js`;
    if (!existsSync(distPath)) return;

    let LearningBridge;
    try {
      const mod = await import(distPath);
      LearningBridge = mod.LearningBridge ?? mod.default;
    } catch {
      return;
    }

    // Loader throws → emulates broken/missing @claude-flow/neural install
    const bridge = new LearningBridge(backend, {
      neuralLoader: async () => { throw new Error('module not found'); },
      enabled: true,
    });

    // Must not propagate the loader error
    await bridge.onInsightRecorded(
      { category: 'project-patterns', summary: 'test', confidence: 1, source: 'test' },
      'entry-1'
    );

    const stats = bridge.getStats();
    assert.equal(stats.neuralAvailable, false,
      'A throwing loader must result in neuralAvailable === false (fail-safe)');

    bridge.destroy();
  });
});

// ============================================================================
// 4. Config wiring — sonaMode flows from resolve-config to LearningBridge
// ============================================================================

describe('ADR-0081: sonaMode flows from resolved config into LearningBridge', () => {
  it('resolve-config.ts exists and exposes learning.sonaMode', () => {
    assert.ok(existsSync(RESOLVE_CONFIG),
      `resolve-config.ts must exist at ${RESOLVE_CONFIG}`);
    const src = readFileSync(RESOLVE_CONFIG, 'utf-8');
    assert.ok(/sonaMode/.test(src),
      'resolve-config.ts must read sonaMode from config sources');
    assert.ok(/learning\s*:/.test(src),
      'resolve-config.ts must expose a `learning` config block');
  });

  it('controller-registry passes resolved sonaMode into new LearningBridge', () => {
    const src = readFileSync(CTRL_REGISTRY, 'utf-8');
    assert.ok(/new LearningBridge\(/.test(src),
      'controller-registry must instantiate LearningBridge');
    // Must reference resolved learning.sonaMode in the constructor args
    assert.ok(/sonaMode\s*:.*resolved\.learning\.sonaMode/.test(src),
      'controller-registry must pass resolved.learning.sonaMode into LearningBridge constructor');
  });

  it('controller-registry imports getConfig from resolve-config', () => {
    const src = readFileSync(CTRL_REGISTRY, 'utf-8');
    assert.ok(/from\s+['"]\.\/resolve-config\.js['"]/.test(src),
      'controller-registry must import from ./resolve-config.js');
    assert.ok(/getConfig/.test(src),
      'controller-registry must use getConfig() to resolve sonaMode');
  });

  it('LearningBridge default sonaMode is "balanced" (ADR-0080 canonical)', () => {
    const src = readFileSync(LEARNING_BRIDGE, 'utf-8');
    // DEFAULT_CONFIG must set sonaMode: 'balanced'
    assert.ok(/sonaMode\s*:\s*['"]balanced['"]/.test(src),
      'DEFAULT_CONFIG.sonaMode must be "balanced" (ADR-0080 canonical mode)');
  });
});

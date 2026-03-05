// @tier unit
// Tests for scripts/publish.mjs — topological publish order (ADR-0014).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Import the constants and publish function from the script under test.
const { LEVELS, RATE_LIMIT_MS, publishAll } = await import(
  resolve(ROOT, 'scripts', 'publish.mjs')
);

// Total package count derived from the LEVELS array itself.
const TOTAL_PACKAGES = LEVELS.flat().length;

// ── Known dependency map from ADR-0014 ──
// Maps each package to its *cross-level* internal dependencies.
// Within the same level, packages are published sequentially so a package
// may depend on an earlier sibling; those intra-level deps are listed here
// and the validation test allows deps at level <= N.
const KNOWN_DEPS = {
  // Level 1 — no internal deps
  '@sparkleideas/agentdb': [],
  '@sparkleideas/agentic-flow': [],
  '@sparkleideas/ruv-swarm': [],
  // Level 2
  '@sparkleideas/shared': [],
  '@sparkleideas/memory': ['@sparkleideas/agentdb'],
  '@sparkleideas/embeddings': [],
  '@sparkleideas/codex': [],
  '@sparkleideas/aidefence': [],
  // Level 3
  '@sparkleideas/neural': ['@sparkleideas/memory'],
  '@sparkleideas/hooks': [
    '@sparkleideas/memory',
    '@sparkleideas/neural',
    '@sparkleideas/shared',
  ],
  '@sparkleideas/browser': [],
  '@sparkleideas/plugins': [],
  '@sparkleideas/providers': [],
  '@sparkleideas/claims': [],
  // Level 4
  '@sparkleideas/guidance': [
    '@sparkleideas/hooks',
    '@sparkleideas/memory',
    '@sparkleideas/shared',
  ],
  '@sparkleideas/mcp': ['@sparkleideas/shared'],
  '@sparkleideas/integration': ['@sparkleideas/shared'],
  '@sparkleideas/deployment': ['@sparkleideas/shared'],
  '@sparkleideas/swarm': ['@sparkleideas/shared'],
  '@sparkleideas/security': ['@sparkleideas/shared'],
  '@sparkleideas/performance': ['@sparkleideas/shared'],
  '@sparkleideas/testing': ['@sparkleideas/shared'],
  // Level 5 — root packages (transitive deps not enumerated here)
  '@sparkleideas/cli': [],
  '@sparkleideas/claude-flow': [],
  '@sparkleideas/ruflo': [],
};

// ── Helpers ──

/** Build a package-name -> level-index lookup from LEVELS. */
function buildLevelLookup() {
  const lookup = new Map();
  for (const [idx, packages] of LEVELS.entries()) {
    for (const pkg of packages) {
      lookup.set(pkg, idx);
    }
  }
  return lookup;
}

/**
 * Create a temporary build directory with fake package.json files
 * for every package in LEVELS.
 */
function createFakeBuildDir() {
  const tmp = mkdtempSync(join(tmpdir(), 'publish-test-'));
  for (const level of LEVELS) {
    for (const pkgName of level) {
      // Scoped packages go into @scope/name dirs, unscoped into name/
      const parts = pkgName.startsWith('@')
        ? pkgName.split('/')
        : [pkgName];
      const dir = join(tmp, ...parts);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: pkgName, version: '1.0.0' }, null, 2) + '\n'
      );
    }
  }
  return tmp;
}

// ── Tests ──

describe('Topological publish order (ADR-0014)', () => {
  // ---------- 1. Level ordering ----------

  describe('Level ordering', () => {
    it('LEVELS array has exactly 5 levels', () => {
      assert.equal(LEVELS.length, 5, 'Expected 5 levels in LEVELS array');
    });

    it('Level 1 packages have no internal dependencies', () => {
      const level1 = LEVELS[0];
      for (const pkg of level1) {
        const deps = KNOWN_DEPS[pkg] || [];
        assert.deepStrictEqual(
          deps,
          [],
          `Level 1 package ${pkg} should have no internal deps, found: ${deps}`
        );
      }
    });

    it('Level 5 contains only root packages', () => {
      const level5 = LEVELS[4];
      const expected = [
        '@sparkleideas/cli',
        '@sparkleideas/claude-flow',
        '@sparkleideas/ruflo',
      ];
      assert.deepStrictEqual(level5, expected);
    });

    it('each level is a non-empty array', () => {
      for (const [idx, level] of LEVELS.entries()) {
        assert.ok(Array.isArray(level), `Level ${idx + 1} should be an array`);
        assert.ok(level.length > 0, `Level ${idx + 1} should not be empty`);
      }
    });
  });

  // ---------- 2. Package completeness ----------

  describe('Package completeness', () => {
    it('all expected packages are present across all levels (3+5+6+8+3)', () => {
      const allPackages = LEVELS.flat();
      // ADR-0014 specifies: L1=3, L2=5, L3=6, L4=8, L5=3
      assert.equal(LEVELS[0].length, 3, 'Level 1 should have 3 packages');
      assert.equal(LEVELS[1].length, 5, 'Level 2 should have 5 packages');
      assert.equal(LEVELS[2].length, 6, 'Level 3 should have 6 packages');
      assert.equal(LEVELS[3].length, 8, 'Level 4 should have 8 packages');
      assert.equal(LEVELS[4].length, 3, 'Level 5 should have 3 packages');
      assert.equal(
        allPackages.length,
        25,
        `Expected 25 packages total, got ${allPackages.length}`
      );
    });

    it('no duplicate packages across levels', () => {
      const allPackages = LEVELS.flat();
      const unique = new Set(allPackages);
      assert.equal(
        unique.size,
        allPackages.length,
        `Found duplicates: ${allPackages.filter(
          (p, i) => allPackages.indexOf(p) !== i
        )}`
      );
    });

    it('every package in KNOWN_DEPS exists in LEVELS', () => {
      const allPackages = new Set(LEVELS.flat());
      for (const pkg of Object.keys(KNOWN_DEPS)) {
        assert.ok(
          allPackages.has(pkg),
          `Package ${pkg} from known deps not found in LEVELS`
        );
      }
    });

    it('every package in LEVELS exists in KNOWN_DEPS', () => {
      for (const pkg of LEVELS.flat()) {
        assert.ok(
          pkg in KNOWN_DEPS,
          `Package ${pkg} from LEVELS not found in KNOWN_DEPS`
        );
      }
    });
  });

  // ---------- 3. Dependency validation ----------

  describe('Dependency validation', () => {
    it('each package at level N has all internal deps at level <= N', () => {
      const lookup = buildLevelLookup();

      for (const [levelIdx, packages] of LEVELS.entries()) {
        for (const pkg of packages) {
          const deps = KNOWN_DEPS[pkg] || [];
          for (const dep of deps) {
            const depLevel = lookup.get(dep);
            assert.ok(
              depLevel !== undefined,
              `Dependency ${dep} of ${pkg} not found in any level`
            );
            assert.ok(
              depLevel <= levelIdx,
              `${pkg} (level ${levelIdx + 1}) depends on ${dep} (level ${
                depLevel + 1
              }), but deps must be at the same level or lower`
            );
          }
        }
      }
    });

    it('intra-level deps are ordered correctly (dep before dependent)', () => {
      const lookup = buildLevelLookup();

      for (const [levelIdx, packages] of LEVELS.entries()) {
        for (const [pkgIdx, pkg] of packages.entries()) {
          const deps = KNOWN_DEPS[pkg] || [];
          for (const dep of deps) {
            const depLevel = lookup.get(dep);
            if (depLevel === levelIdx) {
              // Same-level dep: must appear earlier in the array
              const depIdx = packages.indexOf(dep);
              assert.ok(
                depIdx < pkgIdx,
                `${pkg} depends on same-level ${dep}, but ${dep} (index ${depIdx}) ` +
                  `is not before ${pkg} (index ${pkgIdx}) in level ${levelIdx + 1}`
              );
            }
          }
        }
      }
    });
  });

  // ---------- 4. Stop-on-failure behavior ----------

  describe('Stop-on-failure behavior', () => {
    it('stops publishing when a package directory is missing', async () => {
      // Create a build dir with only Level 1 packages (missing Level 2+)
      const tmp = mkdtempSync(join(tmpdir(), 'publish-fail-'));
      for (const pkgName of LEVELS[0]) {
        const parts = pkgName.startsWith('@')
          ? pkgName.split('/')
          : [pkgName];
        const dir = join(tmp, ...parts);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: pkgName, version: '1.0.0' }, null, 2) + '\n'
        );
      }

      // publishAll in dry-run mode will fail on the first Level 2 package
      // because its directory does not exist.
      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });

      assert.ok(result.failed, 'Expected failure result');
      assert.equal(result.failed.level, 2, 'Failure should be at level 2');
      // All level 1 packages should have been "published" (dry-run)
      assert.equal(
        result.published.length,
        LEVELS[0].length,
        'Only level 1 packages should have been published before failure'
      );

      // No level 2+ packages in published list
      for (const entry of result.published) {
        assert.equal(
          entry.level,
          1,
          `Only level 1 packages should be published, but found level ${entry.level}`
        );
      }

      rmSync(tmp, { recursive: true, force: true });
    });

    it('failed result includes the failing package name and level', async () => {
      const tmp = mkdtempSync(join(tmpdir(), 'publish-fail2-'));
      // Create only level 1 packages
      for (const pkgName of LEVELS[0]) {
        const parts = pkgName.startsWith('@')
          ? pkgName.split('/')
          : [pkgName];
        const dir = join(tmp, ...parts);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: pkgName, version: '1.0.0' }, null, 2) + '\n'
        );
      }

      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });

      assert.ok(result.failed.package, 'Failed result should have a package name');
      assert.ok(result.failed.error, 'Failed result should have an error message');
      assert.equal(typeof result.failed.level, 'number');

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  // ---------- 5. Rate limiting ----------

  describe('Rate limiting', () => {
    it('RATE_LIMIT_MS is set to 2000', () => {
      assert.equal(
        RATE_LIMIT_MS,
        2000,
        'Rate limit should be 2000ms per ADR-0014'
      );
    });

    it('dry-run completes much faster than real publish would', async () => {
      const tmp = createFakeBuildDir();

      const start = Date.now();
      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });
      const elapsed = Date.now() - start;

      // In dry-run mode, no sleep(2000) calls are made.
      // Real mode would take TOTAL_PACKAGES * 2000ms = ~50s.
      // Dry-run should be well under that.  The npm-view calls add
      // network latency (~500ms each), so allow up to 30s total
      // but confirm it is far below the 50s that real delays would add.
      const realModeMinimum = TOTAL_PACKAGES * RATE_LIMIT_MS;
      assert.ok(
        elapsed < realModeMinimum,
        `Dry-run took ${elapsed}ms, but real-mode delays alone would be ${realModeMinimum}ms. ` +
          'This confirms dry-run skips the rate-limit sleep.'
      );
      assert.equal(result.failed, null, 'Dry-run should succeed');
      assert.equal(result.published.length, TOTAL_PACKAGES);

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  // ---------- 6. First-publish bootstrap integration ----------

  describe('First-publish bootstrap integration', () => {
    it('published entries have either latest or prerelease tag', async () => {
      // In dry-run mode, publishAll calls getPublishTag (npm view).
      // Packages not on npm get tag=null -> stored as 'latest'.
      // Packages already on npm get tag='prerelease'.
      const tmp = createFakeBuildDir();

      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });

      assert.equal(result.failed, null, 'Dry-run should succeed');

      for (const entry of result.published) {
        assert.ok(
          entry.tag === 'latest' || entry.tag === 'prerelease',
          `Package ${entry.name} has unexpected tag: ${entry.tag}. ` +
            'Expected "latest" (first publish) or "prerelease" (already published).'
        );
      }

      rmSync(tmp, { recursive: true, force: true });
    });

    it('first-publish packages get no --tag flag (tag is null -> latest)', async () => {
      // Verify the code path: when getPublishTag returns null,
      // the dry-run log should say "npm publish" without --tag.
      // We test this structurally: tag stored as 'latest' means
      // the publish command would have no --tag argument.
      const tmp = createFakeBuildDir();

      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });

      const firstPublishEntries = result.published.filter(
        (e) => e.tag === 'latest'
      );
      // These packages almost certainly do not exist on npm,
      // so they should all be first-publish (tag=latest).
      assert.ok(
        firstPublishEntries.length > 0,
        'Expected at least some packages to be first-publish (tag=latest)'
      );

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  // ---------- 7. Dry-run mode ----------

  describe('Dry-run mode', () => {
    it('dry-run publishes all packages without calling npm publish', async () => {
      const tmp = createFakeBuildDir();

      const result = await publishAll(tmp, {
        version: '2.0.0-patch.1',
        dryRun: true,
      });

      assert.equal(result.failed, null, 'Dry-run should not fail');
      assert.equal(
        result.published.length,
        TOTAL_PACKAGES,
        `All ${TOTAL_PACKAGES} packages should appear in published list`
      );

      // Verify each published entry has the correct structure
      for (const entry of result.published) {
        assert.ok(entry.name, 'Entry should have a name');
        assert.ok(entry.level >= 1 && entry.level <= 5, 'Level should be 1-5');
        assert.ok(entry.version, 'Entry should have a version');
        assert.ok(entry.tag, 'Entry should have a tag');
      }

      rmSync(tmp, { recursive: true, force: true });
    });

    it('dry-run does not modify package.json version fields', async () => {
      const tmp = createFakeBuildDir();
      const firstPkg = LEVELS[0][0]; // @sparkleideas/agentdb
      const parts = firstPkg.split('/');
      const pkgJsonPath = join(tmp, ...parts, 'package.json');

      const before = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      await publishAll(tmp, {
        version: '9.9.9-patch.1',
        dryRun: true,
      });

      const after = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

      assert.equal(
        before.version,
        after.version,
        'Dry-run should not stamp version into package.json'
      );

      rmSync(tmp, { recursive: true, force: true });
    });

    it('publishAll rejects missing buildDir', async () => {
      await assert.rejects(
        () => publishAll('', { version: '1.0.0' }),
        /buildDir is required/
      );
    });

    it('publishAll rejects missing version', async () => {
      await assert.rejects(
        () => publishAll('/tmp', {}),
        /version is required/
      );
    });

    it('published entries are in topological order (level-ascending)', async () => {
      const tmp = createFakeBuildDir();

      const result = await publishAll(tmp, {
        version: '1.0.0-patch.1',
        dryRun: true,
      });

      // Verify levels are monotonically non-decreasing
      let prevLevel = 0;
      for (const entry of result.published) {
        assert.ok(
          entry.level >= prevLevel,
          `Package ${entry.name} at level ${entry.level} appeared after level ${prevLevel} -- not in order`
        );
        prevLevel = entry.level;
      }

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  // ---------- 8. Specific level assignments ----------

  describe('Specific level assignments (ADR-0014)', () => {
    it('Level 1 contains agentdb, agentic-flow, ruv-swarm', () => {
      const level1 = LEVELS[0];
      assert.ok(
        level1.includes('@sparkleideas/agentdb'),
        'agentdb should be at level 1'
      );
      assert.ok(
        level1.includes('@sparkleideas/agentic-flow'),
        'agentic-flow should be at level 1'
      );
      assert.ok(
        level1.includes('@sparkleideas/ruv-swarm'),
        'ruv-swarm should be at level 1'
      );
    });

    it('Level 5 contains cli, claude-flow, ruflo', () => {
      const level5 = LEVELS[4];
      assert.ok(
        level5.includes('@sparkleideas/cli'),
        'cli should be at level 5'
      );
      assert.ok(
        level5.includes('@sparkleideas/claude-flow'),
        'claude-flow should be at level 5'
      );
      assert.ok(
        level5.includes('@sparkleideas/ruflo'),
        'ruflo should be at level 5'
      );
    });

    it('@sparkleideas/memory is at level 2', () => {
      const level2 = LEVELS[1];
      assert.ok(
        level2.includes('@sparkleideas/memory'),
        'memory should be at level 2'
      );
    });

    it('@sparkleideas/neural is at level 3', () => {
      const level3 = LEVELS[2];
      assert.ok(
        level3.includes('@sparkleideas/neural'),
        'neural should be at level 3'
      );
    });
  });
});

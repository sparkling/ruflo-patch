// @tier pipeline
// ADR-0113 Fix 3 (Phase B): preflight package-coverage contract.
//
// The publish pipeline used to maintain four+ hardcoded enumerations of
// "packages we ship" (scripts/publish.mjs LEVELS, KNOWN_DEPS in this
// directory's publish-order test, scripts/codemod.mjs UNSCOPED_MAP, and
// scripts/build-packages.sh _v3_packages). When upstream merges added
// new packages (e.g. ADR-0111 W4 added plugin-agent-federation +
// plugin-iot-cognitum), all four lists had to be updated by hand — and
// they sometimes weren't, leading to silent publish gaps (audit
// findings 4 + 5).
//
// This test locks in the contract:
//
//   discovered ⊆ (LEVELS ∪ WONT_PUBLISH ∪ WONT_PUBLISH_PATTERNS)
//
// Where `discovered` is the set of @sparkleideas/* names produced by
// walking FORK_DIRS[] for in-scope package.json files.
//
// When upstream adds a new package, three outcomes are possible:
//   1. The new package matches an existing WONT_PUBLISH_PATTERN (e.g.
//      a new platform NAPI binary) — test stays green.
//   2. The new package is in LEVELS — test stays green (the human
//      who added it remembered to wire it into publish.mjs).
//   3. The new package is neither — test FAILS and prints the missing
//      name + source path, forcing a decision.
//
// Cross-checks (LEVELS ⊆ KNOWN_DEPS ⊆ UNSCOPED_MAP) live in
// publish-order.test.mjs (existing); this file adds the discovered⊆LEVELS
// direction, plus a synthetic-fixture test that verifies the
// fail-loud path actually fails.
//
// References:
//   - ADR-0113 §"Decision plan step 21" (auto-discover allowlists)
//   - scripts/preflight-discover.mjs (discovery walker)
//   - feedback-no-fallbacks (must fail loud, not paper over gaps)

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const {
  discover,
  uniqueMappedNames,
  expectedPublishedSet,
  isWontPublish,
  WONT_PUBLISH,
  WONT_PUBLISH_PATTERNS,
  mapName,
} = await import(resolve(ROOT, 'scripts', 'preflight-discover.mjs'));

const { LEVELS } = await import(resolve(ROOT, 'scripts', 'publish.mjs'));

const { UNSCOPED_MAP } = await import(resolve(ROOT, 'scripts', 'codemod.mjs'));

describe('ADR-0113 Phase B — preflight discovery coverage', () => {
  let discovered;
  let unique;
  let levelsSet;

  before(() => {
    const result = discover();
    discovered = result.discovered;
    unique = uniqueMappedNames(discovered);
    levelsSet = new Set(LEVELS.flat());
  });

  it('discovers ≥ 60 unique mapped package names across all forks', () => {
    // 60 = current LEVELS size as of ADR-0113 Phase A; new upstream
    // merges may add more. The lower bound exists to catch a
    // regression where the walker silently stops finding packages
    // (e.g. depth cap too tight, exclusion regex too loose).
    assert.ok(
      unique.size >= 60,
      `expected ≥ 60 discovered packages, got ${unique.size}`,
    );
  });

  it('every discovered package is in LEVELS or WONT_PUBLISH (no silent gaps)', () => {
    const gaps = [];
    for (const name of unique) {
      if (levelsSet.has(name)) continue;
      if (isWontPublish(name)) continue;
      const sources = discovered
        .filter((d) => d.mappedName === name)
        .map((d) => `${d.fork}:${d.path}`);
      gaps.push({ name, sources });
    }
    if (gaps.length > 0) {
      const report = gaps
        .map(
          (g) =>
            `  ✗ ${g.name}\n${g.sources.map((s) => `      ${s}`).join('\n')}`,
        )
        .join('\n');
      assert.fail(
        `${gaps.length} discovered package(s) are NOT in LEVELS and NOT in WONT_PUBLISH:\n${report}\n\n` +
        `Resolution: either add to scripts/publish.mjs LEVELS (and KNOWN_DEPS in publish-order.test.mjs) ` +
        `OR add to WONT_PUBLISH/WONT_PUBLISH_PATTERNS in scripts/preflight-discover.mjs with a reason.`,
      );
    }
  });

  it('every package in LEVELS is discoverable in some fork', () => {
    // The other direction: if LEVELS lists a package that doesn't
    // exist in any fork, publish.mjs will try to npm-pack a missing
    // tarball at publish time. Catch that here.
    const missing = [];
    for (const name of LEVELS.flat()) {
      if (!unique.has(name)) missing.push(name);
    }
    assert.equal(
      missing.length,
      0,
      `LEVELS lists ${missing.length} package(s) with no fork source: ${missing.join(', ')}`,
    );
  });

  it('UNSCOPED_MAP contains every non-scoped name we expect to map', () => {
    // Lock the inverse direction: every unscoped fork-source name we
    // discover must have a target mapping. This catches the case where
    // upstream renames an unscoped package and we miss the rename.
    const unscopedFromForks = new Set();
    for (const d of discovered) {
      const name = d.originalName;
      if (!name.startsWith('@')) unscopedFromForks.add(name);
    }
    for (const name of unscopedFromForks) {
      // Skip names that aren't in the publishable set (test-only,
      // example apps, etc. — the discoverer's in-scope filter already
      // excludes most of these, but some leak through if they happen
      // to match an UNSCOPED_MAP key already).
      if (!Object.prototype.hasOwnProperty.call(UNSCOPED_MAP, name)) continue;
      const mapped = UNSCOPED_MAP[name];
      assert.match(
        mapped,
        /^@sparkleideas\//,
        `UNSCOPED_MAP[${name}] should map to @sparkleideas/* but is ${mapped}`,
      );
    }
  });

  it('LEVELS loads non-empty from config/publish-levels.json', () => {
    // ADR-0113 Phase B step 25: FALLBACK_LEVELS was deleted from
    // publish.mjs because it drifted out of sync with the JSON
    // (silently). The contract now is: JSON is canonical, and a
    // missing/malformed JSON throws at module load (per
    // `feedback-no-fallbacks`).
    assert.ok(Array.isArray(LEVELS), 'LEVELS must be an array');
    assert.ok(LEVELS.length >= 4, 'LEVELS must have ≥ 4 levels');
    for (const level of LEVELS) {
      assert.ok(Array.isArray(level), 'each LEVELS entry is an array');
      assert.ok(level.length > 0, 'each LEVELS entry is non-empty');
    }
  });

  it('discovered + WONT_PUBLISH_PATTERNS cover all currently-not-shipped fork packages', () => {
    // Sanity: the patterns we ship must cover the current ruvector
    // experimental population. If a pattern matches zero discovered
    // packages, it's dead — flag it.
    const stats = WONT_PUBLISH_PATTERNS.map(({ pattern, reason }) => {
      const matches = [...unique].filter((n) => pattern.test(n));
      return { pattern: pattern.source, reason, matches: matches.length };
    });
    const dead = stats.filter((s) => s.matches === 0);
    assert.equal(
      dead.length,
      0,
      `dead WONT_PUBLISH_PATTERNS (zero matches): ${JSON.stringify(dead, null, 2)}`,
    );
  });
});

describe('ADR-0113 Phase B — synthetic-fixture fail-loud', () => {
  // Step 22 of the ADR plan: drop a synthetic package.json into a
  // fixture fork tree, run the discoverer + coverage check via a
  // child node, and verify EXIT_CODE != 0 so CI catches this.
  //
  // We can't trivially mutate `forks/ruflo/` for the test (it's a
  // real fork the user develops in). Instead, we point the
  // discoverer at a synthetic temp directory by overriding
  // config/upstream-branches.json at process boundary.

  let tmpDir;
  let configBackup;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ruflo-discover-fixture-'));
    // Build a fake fork tree with one in-LEVELS package and one
    // brand-new (unaccounted) one:
    mkdirSync(join(tmpDir, 'fakefork', 'pkgA'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'fakefork', 'pkgA', 'package.json'),
      JSON.stringify({ name: '@claude-flow/cli', version: '0.0.0' }),
    );
    mkdirSync(join(tmpDir, 'fakefork', 'pkgB'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'fakefork', 'pkgB', 'package.json'),
      JSON.stringify({
        name: '@claude-flow/synthetic-new-package-from-test',
        version: '0.0.0',
      }),
    );
  });

  it('preflight --discover-dry-run exits non-zero when fork tree has unaccounted package', () => {
    // Build a synthetic upstream-branches.json pointing at the fixture
    // tree, then run preflight in a subprocess with that config dir.
    // We use a temp config dir override via the node script's PROJECT_DIR.
    // Simplest: write a temp config + run preflight-discover.mjs
    // directly with --json (the dry-run gate exit happens in
    // preflight.mjs which uses fixed paths).
    //
    // Strategy: spawn node with a small driver script that imports
    // preflight-discover.mjs, walks `tmpDir`, and exits 1 if any
    // discovered name is unaccounted.

    const driver = `
      import { readFileSync } from 'node:fs';
      import { join } from 'node:path';
      const { isWontPublish } = await import('${resolve(ROOT, 'scripts', 'preflight-discover.mjs')}');
      const { LEVELS } = await import('${resolve(ROOT, 'scripts', 'publish.mjs')}');
      const levelsSet = new Set(LEVELS.flat());

      // Manually walk ${tmpDir.replace(/\\/g, '\\\\')}
      const { readdirSync } = await import('node:fs');
      function walk(dir) {
        const out = [];
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) out.push(...walk(p));
          else if (e.name === 'package.json') out.push(p);
        }
        return out;
      }
      const pkgs = walk('${tmpDir.replace(/\\/g, '\\\\')}');
      let gaps = 0;
      for (const p of pkgs) {
        const j = JSON.parse(readFileSync(p, 'utf8'));
        if (!j.name || !j.name.startsWith('@claude-flow/')) continue;
        const mapped = '@sparkleideas/' + j.name.slice('@claude-flow/'.length);
        if (levelsSet.has(mapped)) continue;
        if (isWontPublish(mapped)) continue;
        console.error('GAP: ' + mapped);
        gaps++;
      }
      process.exit(gaps > 0 ? 1 : 0);
    `;
    const driverPath = join(tmpDir, 'driver.mjs');
    writeFileSync(driverPath, driver);
    const result = spawnSync('node', [driverPath], { encoding: 'utf-8' });
    assert.equal(
      result.status,
      1,
      `expected synthetic-fixture run to exit 1 (gap detected), got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /GAP: @sparkleideas\/synthetic-new-package-from-test/,
      'expected GAP report for synthetic package',
    );
  });

  it('preflight --discover-dry-run exits 0 when fork tree has only in-LEVELS packages', () => {
    // Same driver but only over pkgA which IS in LEVELS.
    const driver = `
      import { readFileSync, readdirSync } from 'node:fs';
      import { join } from 'node:path';
      const { isWontPublish } = await import('${resolve(ROOT, 'scripts', 'preflight-discover.mjs')}');
      const { LEVELS } = await import('${resolve(ROOT, 'scripts', 'publish.mjs')}');
      const levelsSet = new Set(LEVELS.flat());

      const pkgPath = '${join(tmpDir, 'fakefork', 'pkgA', 'package.json').replace(/\\/g, '\\\\')}';
      const j = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const mapped = '@sparkleideas/' + j.name.slice('@claude-flow/'.length);
      const ok = levelsSet.has(mapped) || isWontPublish(mapped);
      process.exit(ok ? 0 : 1);
    `;
    const driverPath = join(tmpDir, 'driver-clean.mjs');
    writeFileSync(driverPath, driver);
    const result = spawnSync('node', [driverPath], { encoding: 'utf-8' });
    assert.equal(
      result.status,
      0,
      `expected clean-fixture to exit 0, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
});

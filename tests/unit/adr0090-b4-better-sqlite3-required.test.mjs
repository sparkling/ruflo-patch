// @tier unit
// ADR-0090 Tier B4: no silent sql.js fallback on the CLI's better-sqlite3
// consumers.
//
// Contract (v3, 2026-04-16)
// -------------------------
// Three revisions of this check — the current one (v3) is what this test
// file exercises. See the docblock in lib/acceptance-package-checks.sh
// for the full history. Summary:
//
//   v1 (void-ab-initio): "better-sqlite3 must ONLY be in optionalDependencies"
//     — contradicted fork commit d5fe53522.
//   v2 (2026-04-15): "better-sqlite3 MUST be in dependencies AND resolve
//     AND open-database.js MUST reference it". Correct for that moment
//     in time, but obsoleted by fork commit c7439f345.
//   v3 (THIS VERSION): fork commit c7439f345 (after v2) moved
//     better-sqlite3 back to optionalDependencies and DELETED
//     open-database.ts. The surviving consumers (memory.js's
//     memory migrate --from-sqlite and doctor.js's diagnostic) use
//     explicit fail-loud with a user-facing "Install better-sqlite3"
//     message. No silent sql.js fallback anywhere. So better-sqlite3
//     in optionalDependencies is now SAFE.
//
// What v3 checks:
//   Layer 1: better-sqlite3 declared in `dependencies` OR
//            `optionalDependencies` (missing or devDeps-only → FAIL).
//   Layer 2: open-database.js (if present in dist) does NOT contain
//            the ADR-0086 silent-fallback signature (imports BOTH
//            better-sqlite3 AND sql.js).
//   Layer 3: no OTHER dist file has the same silent-fallback
//            signature (catches future refactors that spread the
//            pattern elsewhere).
//   Layer 4: if better-sqlite3 is in `dependencies`, require.resolve
//            MUST succeed (deps are guaranteed install). If in
//            `optionalDependencies`, resolve failure is acceptable
//            (optional means optional).
//
// Cases
// -----
//   Case  1: deps + resolve OK + no open-database.js         → PASS
//   Case  2: optionalDeps + resolve OK + no open-database.js → PASS
//   Case  3: optionalDeps + resolve FAIL + no open-database  → PASS (optional)
//   Case  4: missing from all dep fields                     → FAIL
//   Case  5: only in devDependencies                         → FAIL
//   Case  6: deps + resolve FAIL                             → FAIL (deps means installed)
//   Case  7: open-database.js has both bsqlite + sqljs       → FAIL (silent-fallback sig)
//   Case  8: unrelated dist file has both bsqlite + sqljs    → FAIL (dist-scan)
//   Case  9: @sparkleideas/cli not found                     → FAIL
//   Case 10: package.json missing                            → FAIL
//   Case 11: open-database.js absent entirely                → PASS (current reality)
//   Case 12: dist files can import only one of the two       → PASS

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import {
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-package-checks.sh');

// ────────────────────────────────────────────────────────────────────────
// Fake @sparkleideas/cli package builder
// ────────────────────────────────────────────────────────────────────────

/**
 * @param {object} spec
 * @param {string} spec.tempDir             outer TEMP_DIR
 * @param {'dependencies'|'optionalDependencies'|'devDependencies'|'missing'} spec.depField
 * @param {'absent'|'bsqlite-only'|'sqljs-only'|'both'} spec.openDbState
 *     'absent'       → open-database.js does NOT exist in dist (post-c7439f345 reality)
 *     'bsqlite-only' → open-database.js exists and only imports better-sqlite3
 *     'sqljs-only'   → open-database.js exists and only imports sql.js (weird but possible)
 *     'both'         → open-database.js imports BOTH (the silent-fallback signature — FAIL)
 * @param {'installed'|'missing'} spec.bsqlite3State
 * @param {boolean} [spec.omitPackageJson]
 * @param {boolean} [spec.omitCliDir]
 * @param {string[]} [spec.extraDistFilesWithBothImports]
 *     relative paths under cli/dist/ to write with BOTH imports (to
 *     exercise Layer 3: dist-scan for the silent-fallback signature in
 *     files other than open-database.js).
 */
function buildFakeCliPkg(spec) {
  const cliDir = join(spec.tempDir, 'node_modules', '@sparkleideas', 'cli');
  if (spec.omitCliDir) {
    mkdirSync(join(spec.tempDir, 'node_modules'), { recursive: true });
    return cliDir;
  }
  mkdirSync(cliDir, { recursive: true });

  // ── package.json ──
  if (!spec.omitPackageJson) {
    const pkg = { name: '@sparkleideas/cli', version: '1.0.0-test' };
    if (spec.depField === 'dependencies') {
      pkg.dependencies = { 'better-sqlite3': '^11.0.0' };
    } else if (spec.depField === 'optionalDependencies') {
      pkg.optionalDependencies = { 'better-sqlite3': '^11.0.0' };
    } else if (spec.depField === 'devDependencies') {
      pkg.devDependencies = { 'better-sqlite3': '^11.0.0' };
    }
    writeFileSync(join(cliDir, 'package.json'), JSON.stringify(pkg, null, 2));
  }

  // ── open-database.js (optional now — 'absent' is the current reality) ──
  const openDbDir = join(cliDir, 'dist', 'src', 'memory');
  mkdirSync(openDbDir, { recursive: true });
  if (spec.openDbState === 'bsqlite-only') {
    writeFileSync(
      join(openDbDir, 'open-database.js'),
      "// better-sqlite3 only\nawait import('better-sqlite3');\n",
    );
  } else if (spec.openDbState === 'sqljs-only') {
    // Use 'sql\x2ejs' so 'better-sqlite3' literal doesn't slip in via
    // the string 'sqlite3' as a substring of anything else.
    writeFileSync(
      join(openDbDir, 'open-database.js'),
      "// sql.js only path\nawait import('sql.js');\n",
    );
  } else if (spec.openDbState === 'both') {
    // The silent-fallback signature: tries better-sqlite3, catches, and
    // falls back to sql.js. This is the exact pattern that caused the
    // ADR-0086 Debt 7 WAL-corruption regression.
    writeFileSync(
      join(openDbDir, 'open-database.js'),
      [
        "async function openDatabase(path) {",
        "  try { const mod = await import('better-sqlite3'); return mod.default(path); }",
        "  catch { const sqljs = await import('sql.js'); return sqljs.default(); }",
        "}",
      ].join('\n'),
    );
  }
  // 'absent' → write nothing

  // ── Additional dist files with BOTH imports (Layer 3 test) ──
  if (spec.extraDistFilesWithBothImports) {
    for (const relPath of spec.extraDistFilesWithBothImports) {
      const full = join(cliDir, 'dist', relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(
        full,
        [
          "// Some unrelated dist file that happens to import both",
          "await import('better-sqlite3');",
          "await import('sql.js');",
        ].join('\n'),
      );
    }
  }

  // ── node_modules/better-sqlite3 (sibling of CLI in tempDir) ──
  const bsqliteDir = join(spec.tempDir, 'node_modules', 'better-sqlite3');
  if (spec.bsqlite3State === 'installed') {
    mkdirSync(bsqliteDir, { recursive: true });
    writeFileSync(
      join(bsqliteDir, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '11.0.0', main: 'index.js' }, null, 2),
    );
    writeFileSync(join(bsqliteDir, 'index.js'), 'module.exports = {};\n');
  }
  // 'missing' → node_modules/better-sqlite3 does not exist at all

  return cliDir;
}

/** Run check_adr0090_b4_better_sqlite3_required against a fake project. */
function runCheck(tempDir) {
  const driverPath = join(tmpdir(), `b4-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    `export TEMP_DIR="${tempDir}"`,
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    `export E2E_DIR="${tempDir}/.no-e2e"`,
    `source "${CHECK_FILE}"`,
    'check_adr0090_b4_better_sqlite3_required',
    'echo "::PASSED::$_CHECK_PASSED"',
    'echo "::OUTPUT::$_CHECK_OUTPUT"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });
  try {
    const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 15000 });
    const out = (result.stdout || '') + (result.stderr || '');
    const passedMatch = out.match(/::PASSED::(.*)/);
    const outputMatch = out.match(/::OUTPUT::(.*)/);
    return {
      passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
      output: outputMatch ? outputMatch[1].trim() : '',
      raw: out,
    };
  } finally {
    try { rmSync(driverPath, { force: true }); } catch {}
  }
}

function setup(label) {
  return mkdtempSync(join(tmpdir(), `b4-${label}-`));
}

function teardown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ────────────────────────────────────────────────────────────────────────
// Static source assertions — v3 shape
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3: static source', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');
  const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');

  it('defines check_adr0090_b4_better_sqlite3_required', () => {
    assert.ok(fn.length > 0, 'function must be defined in acceptance-package-checks.sh');
  });

  it('accepts EITHER dependencies OR optionalDependencies (v3 contract)', () => {
    // v3 no longer requires dep_kind === 'dependencies'. Both are OK.
    // The only rejected fields are `missing` and `devDependencies`.
    assert.match(fn, /dep_kind.*==.*"missing"/,
      'must reject when dep_kind is missing');
    assert.match(fn, /dep_kind.*==.*"devDependencies"/,
      'must reject when dep_kind is devDependencies only');
    // Affirmatively should NOT reject optionalDependencies outright
    assert.doesNotMatch(fn,
      /dep_kind.*!=.*"dependencies"\s*\]\];\s*then\s+_CHECK_OUTPUT/s,
      'v3 must NOT reject everything that is not in `dependencies` — optionalDependencies is now acceptable');
  });

  it('parses package.json with node, not regex', () => {
    assert.match(fn, /node -e/, 'must use `node -e` for package.json parsing');
    assert.match(fn, /p\.dependencies\[/, 'checks p.dependencies');
    assert.match(fn, /p\.optionalDependencies\[/, 'checks p.optionalDependencies');
    assert.match(fn, /p\.devDependencies\[/, 'checks p.devDependencies');
  });

  it('treats open-database.js with both imports as the silent-fallback signature', () => {
    // Must detect open-database.js with both better-sqlite3 and sql.js imports
    assert.match(fn, /open-database\.js/, 'must reference open-database.js');
    assert.match(fn, /has_bsqlite.*has_sqljs|sql\\\.js.*better-sqlite3/,
      'must detect the co-location of both imports as the regression signature');
  });

  it('scans dist for OTHER files with the silent-fallback signature', () => {
    assert.match(fn, /find\s+"\$cli_pkg_dir\/dist"|dist.*\*\.js/,
      'must scan dist for .js files with both imports');
  });

  it('requires runtime resolve ONLY when dep_kind is `dependencies`', () => {
    // The resolve check must be conditional on dep_kind. v2 always required
    // resolve; v3 treats optionalDependencies resolve failure as informational.
    assert.match(fn, /require\.resolve\('better-sqlite3'\)/,
      'must attempt require.resolve');
    assert.match(fn, /dep_kind.*==.*"dependencies"/,
      'must branch on dep_kind when deciding to fail on resolve');
  });

  it('resets _CHECK_PASSED/_CHECK_OUTPUT at function entry', () => {
    assert.match(fn, /_CHECK_PASSED="false"/);
    assert.match(fn, /_CHECK_OUTPUT=""/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 1: deps + resolve + no open-database.js → PASS
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 1: deps + resolve + no open-db → PASS', () => {
  it('current reality with better-sqlite3 in dependencies → PASS', () => {
    const tempDir = setup('case1');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'absent', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /declared in 'dependencies'/,
        `expected diagnostic naming the dep field, got: ${output}`);
      assert.match(output, /silent-fallback absent|no other dist file|silent sql\.js/i,
        `expected some mention of the silent-fallback being absent, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 2: optionalDeps + resolve + no open-database.js → PASS (v3 change)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 2: optionalDeps + resolve + no open-db → PASS', () => {
  it('fork commit c7439f345 reality with better-sqlite3 in optionalDependencies → PASS', () => {
    const tempDir = setup('case2');
    try {
      buildFakeCliPkg({ tempDir, depField: 'optionalDependencies', openDbState: 'absent', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /declared in 'optionalDependencies'/,
        `expected diagnostic naming the dep field, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 3: optionalDeps + resolve FAIL + no open-db → PASS (optional!)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 3: optionalDeps + resolve FAIL → PASS', () => {
  it('optionalDependencies may legitimately not install on some platforms → PASS with informational note', () => {
    const tempDir = setup('case3');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'optionalDependencies',
        openDbState: 'absent',
        bsqlite3State: 'missing', // installed=false — optional deps can skip install
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `expected PASS (optionalDependencies resolve failure is acceptable), got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /optional.*NOT installed|declared optional/i,
        `expected informational note about optional not installed, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 4: missing from all dep fields → FAIL
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 4: missing from all dep fields → FAIL', () => {
  it('catches complete removal of better-sqlite3 (breaks memory migrate --from-sqlite)', () => {
    const tempDir = setup('case4');
    try {
      buildFakeCliPkg({ tempDir, depField: 'missing', openDbState: 'absent', bsqlite3State: 'missing' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on complete removal, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /does not declare better-sqlite3 anywhere/,
        `expected "does not declare anywhere" diagnostic, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 5: devDependencies only → FAIL
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 5: devDependencies only → FAIL', () => {
  it('devDependencies are not pulled by consumer npm install → FAIL', () => {
    const tempDir = setup('case5');
    try {
      buildFakeCliPkg({ tempDir, depField: 'devDependencies', openDbState: 'absent', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on devDeps-only, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /ONLY in 'devDependencies'/,
        `expected diagnostic naming the wrong field, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 6: deps + resolve FAIL → FAIL (deps must install)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 6: deps + resolve FAIL → FAIL', () => {
  it('dependencies must install — a failed resolve is a broken npm install, not optional', () => {
    const tempDir = setup('case6');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'absent', bsqlite3State: 'missing' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on deps+resolve-fail, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /declared in CLI 'dependencies' but require\.resolve FAILED|npm install should have landed it/,
        `expected deps+resolve-fail diagnostic, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 7: open-database.js with BOTH imports → FAIL (regression signature)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 7: open-database.js silent-fallback signature → FAIL', () => {
  it('catches an upstream refactor that re-introduces the try/catch fallthrough', () => {
    const tempDir = setup('case7');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'both', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on open-database.js with both imports, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /silent-fallback signature|WAL corruption risk is BACK/,
        `expected silent-fallback signature diagnostic, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 8: OTHER dist file with both imports → FAIL (dist-scan)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 8: unrelated dist file with both imports → FAIL', () => {
  it('catches the silent-fallback pattern in files other than open-database.js', () => {
    const tempDir = setup('case8');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'absent',
        bsqlite3State: 'installed',
        extraDistFilesWithBothImports: ['src/memory/evil-fallback.js'],
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on dist file with both imports, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /evil-fallback\.js|imports BOTH better-sqlite3 AND sql\.js/,
        `expected dist-scan diagnostic naming the culprit file, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 9: @sparkleideas/cli not found → FAIL
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 9: @sparkleideas/cli not found → FAIL', () => {
  it('catches missing CLI package', () => {
    const tempDir = setup('case9');
    try {
      buildFakeCliPkg({
        tempDir, depField: 'dependencies', openDbState: 'absent',
        bsqlite3State: 'installed', omitCliDir: true,
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing CLI pkg, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /@sparkleideas\/cli not found/,
        `expected 'cli not found' diagnostic, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 10: package.json missing → FAIL
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 10: package.json missing → FAIL', () => {
  it('catches broken pkg install', () => {
    const tempDir = setup('case10');
    try {
      buildFakeCliPkg({
        tempDir, depField: 'dependencies', openDbState: 'absent',
        bsqlite3State: 'installed', omitPackageJson: true,
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing package.json, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /package\.json missing/,
        `expected 'package.json missing' diagnostic, got: ${output}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Case 11 & 12: single-import files are OK (not silent-fallback signature)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3 Case 11: open-database.js with only bsqlite import → PASS', () => {
  it('a file that imports only better-sqlite3 (no sql.js fallback) is OK', () => {
    const tempDir = setup('case11');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'bsqlite-only', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `expected PASS on bsqlite-only open-db, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
    } finally { teardown(tempDir); }
  });
});

describe('ADR-0090 Tier B4 v3 Case 12: file that imports only sql.js → PASS', () => {
  it('a file that imports ONLY sql.js (no better-sqlite3) does not trip the co-location test', () => {
    const tempDir = setup('case12');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'sqljs-only', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      // sql.js-only files may be legitimate (there are other sql.js
      // consumers in the memory package: event-store, persistent-cache,
      // rvf-migration — these are OK). The check is only about
      // CO-LOCATION of both imports in the same module.
      assert.equal(passed, 'true',
        `expected PASS on sqljs-only file, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Regression guard — v3 must not re-introduce v1's obsolete spec
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 v3: regression — old specs stay obsolete', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');
  const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');

  it('does NOT re-enable the v1 negative spec (fails-if-in-deps)', () => {
    // v1 would have looked like:
    //   if [[ "$dep_kind" == "dependencies" ]]; then _CHECK_OUTPUT=...; return; fi
    assert.doesNotMatch(
      fn,
      /dep_kind"\s*==\s*"dependencies".*_CHECK_PASSED="false"/s,
      'v1 (void-ab-initio) spec must stay dead',
    );
  });

  it('does NOT re-enable v2 (deps-required) spec', () => {
    // v2 required dep_kind === 'dependencies' for PASS. v3 accepts both.
    // We check that there's NO branch like:
    //   if [[ "$dep_kind" != "dependencies" ]]; then _CHECK_OUTPUT="must declare ... in 'dependencies'"; return
    assert.doesNotMatch(
      fn,
      /dep_kind"\s*!=\s*"dependencies"\s*\]\];\s*then\s+_CHECK_OUTPUT="B4:.*must declare.*'dependencies'.*return/s,
      'v2 spec must stay obsolete — v3 accepts optionalDependencies',
    );
  });

  it('is wired into scripts/test-acceptance.sh with the adr0090-b4-bsqlite3 id', () => {
    const runner = readFileSync(
      resolve(ROOT, 'scripts', 'test-acceptance.sh'),
      'utf-8',
    );
    assert.match(runner, /check_adr0090_b4_better_sqlite3_required/,
      'runner must still invoke the B4 check function');
    assert.match(runner, /"adr0090-b4-bsqlite3"/,
      'runner must still use the adr0090-b4-bsqlite3 id');
    assert.match(runner, /"packages"/, 'B4 belongs in the packages group');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration — real node resolve against fake install
// ────────────────────────────────────────────────────────────────────────

const HAS_NODE = (() => {
  try { execSync('command -v node', { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

describe('ADR-0090 Tier B4 v3 integration: real node resolve', () => {
  it('happy path with deps → PASS', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-happy');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'absent', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true', `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
    } finally { teardown(tempDir); }
  });

  it('happy path with optional+installed → PASS', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-optional-installed');
    try {
      buildFakeCliPkg({ tempDir, depField: 'optionalDependencies', openDbState: 'absent', bsqlite3State: 'installed' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true', `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
    } finally { teardown(tempDir); }
  });

  it('optional NOT installed → PASS with informational note', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-optional-missing');
    try {
      buildFakeCliPkg({ tempDir, depField: 'optionalDependencies', openDbState: 'absent', bsqlite3State: 'missing' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `optional + not-installed must still PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /optional.*NOT installed|declared optional/i,
        'must flag optional+not-installed in the output');
    } finally { teardown(tempDir); }
  });

  it('deps + NOT installed → FAIL', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-deps-missing');
    try {
      buildFakeCliPkg({ tempDir, depField: 'dependencies', openDbState: 'absent', bsqlite3State: 'missing' });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `deps+not-installed must FAIL, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.notEqual(passed, 'true',
        'REGRESSION: deps declared but not installed must NEVER PASS');
    } finally { teardown(tempDir); }
  });

  it('silent-fallback signature in dist → FAIL regardless of dep field', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-silent-sig');
    try {
      buildFakeCliPkg({
        tempDir, depField: 'optionalDependencies', openDbState: 'both',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `silent-fallback signature must FAIL, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /silent-fallback signature|WAL corruption risk is BACK/,
        'must name the silent-fallback signature as the failure reason');
    } finally { teardown(tempDir); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function extractFn(source, fnName) {
  const startRe = new RegExp(`${fnName}\\(\\)\\s*\\{`);
  const m = source.match(startRe);
  if (!m) return '';
  const start = m.index;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

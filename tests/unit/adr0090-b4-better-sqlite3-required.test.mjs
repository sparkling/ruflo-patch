// @tier unit
// ADR-0090 Tier B4: better-sqlite3 must be a REQUIRED CLI dependency.
//
// Context
// -------
// ADR-0090's original Tier B4 spec said: "fail if better-sqlite3 appears in
// @sparkleideas/cli/package.json dependencies or devDependencies. Must ONLY
// appear in optionalDependencies (per ADR-0086 Debt 7)."
//
// That spec was void-ab-initio. Fork commit d5fe53522 on 2026-04-12 ("fix:
// add better-sqlite3 as direct CLI dependency", 3 days before ADR-0090 was
// written) re-added better-sqlite3 to the CLI package.json because:
//
//   open-database.ts (CLI) does `await import('better-sqlite3')`. When
//   better-sqlite3 was only in the memory package's deps, npm hoisting
//   failures meant the import could fail at runtime and open-database
//   fell back to sql.js, which corrupts WAL-mode databases.
//
// The correct invariant is the INVERSE of the original spec: better-sqlite3
// MUST be in the CLI's `dependencies` AND MUST be resolvable from the CLI
// package context so the open-database.ts branch is taken.
//
// This test suite verifies the inverted check:
//
//   Case 1 (PASS):  deps has better-sqlite3 + require.resolve succeeds + file exists
//   Case 2 (FAIL):  missing from all three dep fields
//   Case 3 (FAIL):  only in optionalDependencies (not reliable on cross-platform)
//   Case 4 (FAIL):  only in devDependencies (not installed on `npm install` by consumers)
//   Case 5 (FAIL):  in deps but require.resolve fails (broken native install)
//   Case 6 (FAIL):  open-database.js missing from dist
//   Case 7 (FAIL):  open-database.js present but doesn't reference better-sqlite3
//   Case 8 (FAIL):  @sparkleideas/cli not found under TEMP_DIR
//   Case 9 (FAIL):  package.json is missing
//
// All cases drive the REAL bash check function in a subshell — no parallel
// reimplementation — so the test fails if the bash logic is wrong.
//
// Integration test
// ----------------
// A real-filesystem test that builds a fake @sparkleideas/cli package with a
// real node_modules/better-sqlite3 directory (minimal package.json + an index
// file) and exercises the full resolve chain. Skipped only if `node` is
// unavailable, which would mean the dev machine can't run the pipeline at all.
//
// Test design
// -----------
// London School mocks: the bash check has four collaborators we need to
// control:
//   - `find ... @sparkleideas/cli` → we create a real directory so find works
//   - The package.json file → we write a real file with tailored content
//   - open-database.js → we create/omit/alter this real file
//   - `node -e require.resolve('better-sqlite3')` → we control this by placing
//     a real (or deliberately broken) better-sqlite3 directory under
//     node_modules of the CLI package dir
//
// This means all 4 layers of the check run the REAL filesystem code, and we
// get full-branch coverage without needing to mock `node` itself.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import {
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-package-checks.sh');

// ────────────────────────────────────────────────────────────────────────
// Fake @sparkleideas/cli package builder
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a fake @sparkleideas/cli package inside TEMP_DIR/node_modules/
 * with a tailored package.json and open-database.js.
 *
 * @param {object} spec
 * @param {string} spec.tempDir              — the outer TEMP_DIR
 * @param {'dependencies'|'optionalDependencies'|'devDependencies'|'missing'} spec.depField
 *     Which package.json field to write better-sqlite3 under (or 'missing')
 * @param {'present'|'absent'|'no-reference'} spec.openDbState
 *     Whether open-database.js exists and whether it references better-sqlite3
 * @param {'installed'|'missing'|'broken-file'} spec.bsqlite3State
 *     Whether node_modules/better-sqlite3 exists and is a valid package
 * @param {boolean} [spec.omitPackageJson] — if true, don't write package.json at all
 * @param {boolean} [spec.omitCliDir] — if true, don't create the CLI dir at all
 */
function buildFakeCliPkg(spec) {
  const cliDir = join(spec.tempDir, 'node_modules', '@sparkleideas', 'cli');
  if (spec.omitCliDir) {
    // Create some other directory so TEMP_DIR isn't totally empty, but
    // deliberately NOT the cli dir. Check should fail at the "cli not found"
    // branch.
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

  // ── open-database.js (matches published location) ──
  const openDbDir = join(cliDir, 'dist', 'src', 'memory');
  mkdirSync(openDbDir, { recursive: true });
  if (spec.openDbState === 'present') {
    writeFileSync(
      join(openDbDir, 'open-database.js'),
      "// minimal open-database.js\n// uses better-sqlite3\nawait import('better-sqlite3');\n",
    );
  } else if (spec.openDbState === 'no-reference') {
    // Deliberately omit the word 'better-sqlite3' in any form — this
    // simulates an upstream refactor that switched the WAL opener to a
    // different engine. The string must not appear anywhere in the file,
    // including comments, or the grep guard will false-positive.
    writeFileSync(
      join(openDbDir, 'open-database.js'),
      "// sql.js only path\nawait import('sql.js');\n",
    );
  }
  // 'absent' → write nothing

  // ── node_modules/better-sqlite3 (siblings of CLI in tempDir) ──
  const bsqliteDir = join(spec.tempDir, 'node_modules', 'better-sqlite3');
  if (spec.bsqlite3State === 'installed') {
    mkdirSync(bsqliteDir, { recursive: true });
    writeFileSync(
      join(bsqliteDir, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '11.0.0', main: 'index.js' }, null, 2),
    );
    // Minimal index.js (check doesn't actually load it, only resolves)
    writeFileSync(join(bsqliteDir, 'index.js'), 'module.exports = {};\n');
  } else if (spec.bsqlite3State === 'broken-file') {
    // package.json says main: index.js but the file is missing — this
    // exercises Layer 4 (resolved path must be a real file). In practice
    // Node's resolver throws before returning a path in this case, so
    // this will typically trip Layer 3 (resolve fails) rather than
    // Layer 4 — we still check that it FAILs loudly.
    mkdirSync(bsqliteDir, { recursive: true });
    writeFileSync(
      join(bsqliteDir, 'package.json'),
      JSON.stringify({ name: 'better-sqlite3', version: '11.0.0', main: 'missing-index.js' }, null, 2),
    );
  }
  // 'missing' → node_modules/better-sqlite3 does not exist at all

  return cliDir;
}

/**
 * Run `check_adr0090_b4_better_sqlite3_required` against a fake project.
 * Returns parsed { passed, output, raw }.
 */
function runCheck(tempDir) {
  const driverPath = join(tmpdir(), `b4-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    `export TEMP_DIR="${tempDir}"`,
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    // Export E2E_DIR as empty/nonexistent so the fallback find() in Layer 0
    // doesn't escape our sandbox.
    `export E2E_DIR="${tempDir}/.no-e2e"`,
    `source "${CHECK_FILE}"`,
    'check_adr0090_b4_better_sqlite3_required',
    'echo "::PASSED::$_CHECK_PASSED"',
    'echo "::OUTPUT::$_CHECK_OUTPUT"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  try {
    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf8',
      timeout: 15000,
    });
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
// Static source assertions — the check function is physically present
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4: static source — check function landed', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('defines check_adr0090_b4_better_sqlite3_required', () => {
    assert.match(
      source,
      /check_adr0090_b4_better_sqlite3_required\(\)\s*\{/,
      'function must be defined in acceptance-package-checks.sh',
    );
  });

  it('is the POSITIVE (resolve-required) check, NOT the old negative spec', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    assert.ok(fn, 'function body must extract');
    assert.match(fn, /require\.resolve\('better-sqlite3'\)/,
      'must verify require.resolve succeeds (positive check)');
    // The FAILURE diagnostic for the wrong dep_kind must fire when
    // better-sqlite3 is in optionalDependencies, proving we prefer
    // the stricter invariant (deps-required, not optional-allowed).
    assert.match(fn, /optionalDependencies are not reliable/,
      'must explain why optionalDependencies is rejected');
  });

  it('parses package.json with node, not regex', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    assert.match(fn, /node -e/,
      'must use `node -e` to parse package.json (regex would false-positive across fields)');
    assert.match(fn, /p\.dependencies\[/,
      'must check p.dependencies explicitly');
    assert.match(fn, /p\.optionalDependencies\[/,
      'must check p.optionalDependencies explicitly');
  });

  it('verifies open-database.js still references better-sqlite3', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    assert.match(fn, /open-database\.js/,
      'must locate open-database.js in the published dist');
    assert.match(fn, /grep -q "better-sqlite3"/,
      'must grep open-database.js for better-sqlite3');
  });

  it('checks resolved path is a real file on disk', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    assert.match(fn, /-f "\$resolved_path"|! -f "\$resolved_path"/,
      'must verify resolved path is a regular file');
  });

  it('exports no side-effect state — resets _CHECK_PASSED/_CHECK_OUTPUT', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    assert.match(fn, /_CHECK_PASSED="false"/,
      'must reset _CHECK_PASSED at function entry');
    assert.match(fn, /_CHECK_OUTPUT=""/,
      'must reset _CHECK_OUTPUT at function entry');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Branch coverage — each case drives the real bash check function
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 Case 1: deps + resolve OK + file exists → PASS', () => {
  it('returns _CHECK_PASSED=true with the happy-path diagnostic', () => {
    const tempDir = setup('case1');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'present',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /silent sql\.js fallback path is blocked/,
        `expected happy-path message, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 2: better-sqlite3 missing entirely → FAIL', () => {
  it('returns _CHECK_PASSED=false with "missing" diagnostic', () => {
    const tempDir = setup('case2');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'missing',
        openDbState: 'present',
        bsqlite3State: 'missing',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing dep, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /must declare better-sqlite3 in 'dependencies'.*found in 'missing'/,
        `expected 'missing' diagnostic, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 3: only in optionalDependencies → FAIL', () => {
  it('rejects optionalDependencies (npm hoisting unreliable on cross-platform installs)', () => {
    const tempDir = setup('case3');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'optionalDependencies',
        openDbState: 'present',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on optionalDependencies-only, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /found in 'optionalDependencies'/,
        `expected diagnostic to name the wrong field, got: ${output}`);
      assert.match(output, /d5fe53522/,
        `expected historical reference to the silent-fallback commit, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 4: only in devDependencies → FAIL', () => {
  it('rejects devDependencies (consumers `npm install` does not pull dev deps)', () => {
    const tempDir = setup('case4');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'devDependencies',
        openDbState: 'present',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on devDependencies-only, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /found in 'devDependencies'/,
        `expected diagnostic to name the wrong field, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 5: deps OK but require.resolve FAILS → FAIL', () => {
  it('catches broken native install (the exact silent sql.js fallback case)', () => {
    const tempDir = setup('case5');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'present',
        bsqlite3State: 'missing', // package.json says yes, but not installed
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on broken resolve, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /require\.resolve FAILED|native binding was not installed/,
        `expected resolve-failure diagnostic, got: ${output}`);
      assert.match(output, /silent sql\.js fallback/,
        `expected explicit reference to the sql.js fallback risk, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 6: open-database.js missing → FAIL', () => {
  it('catches upstream refactor that removed the WAL-safe opener', () => {
    const tempDir = setup('case6');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'absent',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing open-database.js, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /open-database\.js not found/,
        `expected missing-file diagnostic, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 7: open-database.js exists but no better-sqlite3 reference → FAIL', () => {
  it('catches silent switch to sql.js-only opener', () => {
    const tempDir = setup('case7');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'no-reference',
        bsqlite3State: 'installed',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on open-db without bsqlite3 ref, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /does not reference better-sqlite3/,
        `expected no-reference diagnostic, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 8: @sparkleideas/cli not found in TEMP_DIR → FAIL', () => {
  it('catches missing CLI package (did install step run?)', () => {
    const tempDir = setup('case8');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies', // irrelevant
        openDbState: 'present',
        bsqlite3State: 'installed',
        omitCliDir: true,
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing CLI pkg, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /@sparkleideas\/cli not found/,
        `expected 'cli not found' diagnostic, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

describe('ADR-0090 Tier B4 Case 9: package.json missing → FAIL', () => {
  it('catches broken pkg install (dir exists but no manifest)', () => {
    const tempDir = setup('case9');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'present',
        bsqlite3State: 'installed',
        omitPackageJson: true,
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `expected FAIL on missing package.json, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /package\.json missing/,
        `expected 'package.json missing' diagnostic, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Regression guard — the check must never accidentally re-enable
// the old negative spec (fails-if-in-deps). This protects against a
// future refactor that reverts Tier B4 to the ADR-0090 original spec
// without reading this file first.
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B4 regression: check does NOT enforce old negative spec', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('has no branch that FAILs when better-sqlite3 is in dependencies', () => {
    const fn = extractFn(source, 'check_adr0090_b4_better_sqlite3_required');
    // A refactor that flipped the check back would look like:
    //   if [[ "$dep_kind" == "dependencies" ]]; then
    //     _CHECK_OUTPUT="... must not ..."; return
    //   fi
    // We search for the inverted pattern and assert it isn't present.
    assert.doesNotMatch(
      fn,
      /dep_kind"\s*==\s*"dependencies".*_CHECK_PASSED="false"/s,
      'regression: check would re-enable the original void-ab-initio spec. ' +
      'better-sqlite3 MUST be in dependencies per fork commit d5fe53522.',
    );
  });

  it('wires into scripts/test-acceptance.sh with the adr0090-b4-bsqlite3 id', () => {
    const runner = readFileSync(
      resolve(ROOT, 'scripts', 'test-acceptance.sh'),
      'utf-8',
    );
    assert.match(runner, /check_adr0090_b4_better_sqlite3_required/,
      'runner must invoke the B4 check function');
    assert.match(runner, /"adr0090-b4-bsqlite3"/,
      'runner must use the adr0090-b4-bsqlite3 id for telemetry');
    assert.match(runner, /"packages"/,
      'B4 belongs in the packages group (alongside other @sparkleideas package checks)');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration — real filesystem, real node resolve, end-to-end
// ────────────────────────────────────────────────────────────────────────

const HAS_NODE = (() => {
  try {
    execSync('command -v node', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('ADR-0090 Tier B4 integration: real node resolve against fake install', () => {
  it('happy path — real package.json + real better-sqlite3 stub pkg → PASS', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-happy');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'present',
        bsqlite3State: 'installed',
      });
      // Double-check our fake install is resolvable as a sanity test
      const cliDir = join(tempDir, 'node_modules', '@sparkleideas', 'cli');
      const probe = spawnSync('node', ['-e', "console.log(require.resolve('better-sqlite3'))"], {
        cwd: cliDir, encoding: 'utf8',
      });
      assert.equal(
        probe.status, 0,
        `sanity: fake better-sqlite3 install must be resolvable from cliDir — got stderr:\n${probe.stderr}`,
      );

      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'true',
        `integration expected PASS with real filesystem, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /resolvable from CLI package context/,
        `integration should report resolvable path, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });

  it('silent-fallback scenario — deps say yes, but binary not installed → FAIL', { skip: !HAS_NODE }, () => {
    const tempDir = setup('int-broken');
    try {
      buildFakeCliPkg({
        tempDir,
        depField: 'dependencies',
        openDbState: 'present',
        bsqlite3State: 'missing',
      });
      const { passed, output, raw } = runCheck(tempDir);
      assert.equal(passed, 'false',
        `integration expected FAIL when binary missing, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /require\.resolve FAILED|native binding was not installed/,
        `integration should report resolve failure, got: ${output}`);
      // Crucial regression guard — this is the WAL-corrupting case,
      // it must never silent-pass.
      assert.notEqual(passed, 'true',
        'REGRESSION: silent sql.js fallback case must FAIL, never PASS');
      assert.notEqual(passed, 'skip_accepted',
        'missing binary is NOT a legitimate skip — this IS the regression we guard');
    } finally {
      teardown(tempDir);
    }
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

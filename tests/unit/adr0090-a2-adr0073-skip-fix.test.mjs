// @tier unit
// ADR-0090 Tier A2: eliminate adr0073 native runtime silent-pass.
//
// Previously `check_adr0073_native_runtime` set _CHECK_PASSED="true" whenever
// the native import failed with "SKIP:". That is the exact ADR-0082
// silent-fallback anti-pattern, inside the test harness itself — if native
// broke in CI the check silently became a no-op and still reported PASS.
//
// This suite verifies the fix at three levels:
//   1. Static source check — the old silent-pass line is gone; the new
//      explicit file-existence probe and SKIP_ACCEPTED marker are present.
//   2. Unit (London School, mocked) — source the shell file in a bash
//      subshell, stub TEMP_DIR and the node binary, exercise each branch:
//        a. Binary present + runtime OK                → PASS
//        b. Binary present + runtime FAIL              → FAIL (not PASS)
//        c. Binary present + import error              → FAIL (not PASS)
//        d. Binary explicitly absent                   → SKIP_ACCEPTED (not PASS)
//   3. Integration — break the binary path in a temp harness, verify the
//      check returns FAIL with the expected diagnostic, restore, verify it
//      returns PASS (or SKIP_ACCEPTED if no binary was installed in the
//      sandbox).
//
// Plus a harness-plumbing check: run_check and collect_parallel must bucket
// _CHECK_PASSED="skip_accepted" into skip_count, not pass_count.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0073-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');

function read(path) {
  return readFileSync(path, 'utf-8');
}

// ────────────────────────────────────────────────────────────────────────
// Test helpers — build a sandbox that sources the check file in bash,
// stubs TEMP_DIR + a fake node_modules layout, runs the function, and
// returns { passed, output }.
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a sandbox directory with a controllable rvf-node binary layout.
 * @param {object} opts
 * @param {boolean} opts.installBinary  — place a fake .node file
 * @param {boolean} opts.installPackageDirOnly — make the dir but no .node
 * @param {string} opts.scope           — '@sparkleideas' (primary) or '@ruvector' (alt)
 */
function makeSandbox(opts = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'adr0090-a2-'));
  if (opts.installBinary || opts.installPackageDirOnly) {
    const scope = opts.scope || '@sparkleideas';
    const pkgName = scope === '@sparkleideas' ? 'ruvector-rvf-node' : 'rvf-node';
    const pkgDir = join(sandbox, 'node_modules', scope, pkgName);
    mkdirSync(pkgDir, { recursive: true });
    if (opts.installBinary) {
      // A dummy .node file — the file-existence probe only checks the
      // extension, not loadability. The Node.js runtime step will then
      // attempt to import it, which is what we stub below.
      writeFileSync(join(pkgDir, 'rvf-node.darwin-arm64.node'), '\x7fELF fake\n');
    }
  }
  return sandbox;
}

/**
 * Run check_adr0073_native_runtime in a bash subshell.
 *
 * @param {object} opts
 * @param {string} opts.tempDir          — TEMP_DIR to stub
 * @param {string} [opts.nodeBehaviour]  — how to stub `node` on PATH:
 *                                         'ok'      → prints "OK: fake native round-trip"
 *                                         'fail'    → prints "FAIL: stubbed runtime failure" + exit 1
 *                                         'import-err' → prints "FAIL: native import failed: module not found" + exit 1
 *                                         'default' → use real node (for real integration tests)
 */
function runNativeRuntimeCheck({ tempDir, nodeBehaviour = 'default' }) {
  const script = join(tmpdir(), `adr0090-a2-run-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  const fakeBinDir = join(tmpdir(), `adr0090-a2-bin-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Stub node shim if requested
  let pathPrefix = '';
  if (nodeBehaviour !== 'default') {
    mkdirSync(fakeBinDir, { recursive: true });
    let body;
    if (nodeBehaviour === 'ok') {
      body = '#!/usr/bin/env bash\necho "OK: fake native round-trip (stubbed)"\nexit 0\n';
    } else if (nodeBehaviour === 'fail') {
      body = '#!/usr/bin/env bash\necho "FAIL: stubbed runtime failure"\nexit 1\n';
    } else if (nodeBehaviour === 'import-err') {
      body = '#!/usr/bin/env bash\necho "FAIL: native import failed: module not found"\nexit 1\n';
    } else {
      throw new Error('unknown nodeBehaviour: ' + nodeBehaviour);
    }
    writeFileSync(join(fakeBinDir, 'node'), body, { mode: 0o755 });
    pathPrefix = `export PATH="${fakeBinDir}:$PATH"\n`;
  }

  const body = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    pathPrefix,
    `export TEMP_DIR="${tempDir}"`,
    `source "${CHECK_FILE}"`,
    'check_adr0073_native_runtime',
    // Print machine-readable result on last two lines
    'echo "__RESULT_PASSED__=${_CHECK_PASSED}"',
    'echo "__RESULT_OUTPUT__=${_CHECK_OUTPUT}"',
  ].join('\n');

  writeFileSync(script, body, { mode: 0o755 });
  try {
    const stdout = execSync(`bash "${script}" 2>&1`, { encoding: 'utf8', timeout: 15000 });
    return parseResult(stdout);
  } catch (e) {
    // Non-zero exit is fine — set -e could trip on mktemp etc.
    return parseResult((e.stdout || '') + (e.stderr || ''));
  } finally {
    try { rmSync(script, { force: true }); } catch {}
    try { rmSync(fakeBinDir, { recursive: true, force: true }); } catch {}
  }
}

function parseResult(stdout) {
  const passedLine = stdout.split('\n').reverse().find(l => l.startsWith('__RESULT_PASSED__='));
  const outputLine = stdout.split('\n').reverse().find(l => l.startsWith('__RESULT_OUTPUT__='));
  return {
    passed: passedLine ? passedLine.replace('__RESULT_PASSED__=', '').trim() : '<unparsed>',
    output: outputLine ? outputLine.replace('__RESULT_OUTPUT__=', '').trim() : '',
    rawStdout: stdout,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Static source checks — the silent-pass line is gone; SKIP_ACCEPTED is wired
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A2: static source — silent-pass removed', () => {
  const source = read(CHECK_FILE);

  it('old SKIP→true silent-pass line is gone', () => {
    // The exact old pattern was:
    //   if [[ "$result" == SKIP:* ]]; then
    //     _CHECK_PASSED="true"
    // That concrete two-line combo must not reappear in this function.
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(fnRange, 'check_adr0073_native_runtime must still exist');
    assert.ok(
      !/==\s*SKIP:\*[\s\S]{0,80}_CHECK_PASSED="true"/.test(fnRange),
      'SKIP→_CHECK_PASSED="true" silent-pass must be gone',
    );
  });

  it('function emits SKIP_ACCEPTED marker when binary absent', () => {
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(
      fnRange.includes('SKIP_ACCEPTED'),
      'function must emit a SKIP_ACCEPTED output marker for legitimate skip',
    );
  });

  it('function uses skip_accepted state value', () => {
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(
      fnRange.includes('_CHECK_PASSED="skip_accepted"'),
      'function must set _CHECK_PASSED="skip_accepted" for the absent-binary path',
    );
  });

  it('function emits explicit FAIL diagnostic for unexpected output', () => {
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(
      fnRange.includes('Expected native RVF runtime available'),
      'function must emit the "Expected native RVF runtime available" FAIL diagnostic',
    );
  });

  it('function probes binary path via file-existence check', () => {
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(
      /ruvector-rvf-node/.test(fnRange) && /-d\s*"\$rvf_node_dir/.test(fnRange),
      'function must probe the rvf-node package dir for existence before running the runtime test',
    );
  });

  it('references ADR-0082 anti-pattern + ADR-0090 fix in comments', () => {
    const fnRange = extractFn(source, 'check_adr0073_native_runtime');
    assert.ok(
      fnRange.includes('ADR-0090') && fnRange.includes('ADR-0082'),
      'function comment must cite both ADR-0082 (the anti-pattern) and ADR-0090 (the fix)',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Harness plumbing — skip_count bucket exists and is wired
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A2: harness plumbing — skip_accepted bucket', () => {
  const source = read(HARNESS_FILE);

  it('harness declares skip_count tracker', () => {
    assert.ok(
      /\bskip_count\s*=\s*0\b/.test(source),
      'acceptance-harness.sh must initialize skip_count=0',
    );
  });

  it('run_check increments skip_count on _CHECK_PASSED="skip_accepted"', () => {
    // The skip_accepted branch must:
    //   1. Match _CHECK_PASSED == "skip_accepted"
    //   2. Increment skip_count (not pass_count)
    //   3. Log a distinct SKIP prefix (not PASS)
    assert.ok(
      /_CHECK_PASSED"\s*==\s*"skip_accepted"/.test(source),
      'run_check/collect_parallel must branch on "skip_accepted"',
    );
    assert.ok(
      /skip_count=\$\(\(skip_count \+ 1\)\)/.test(source),
      'skip_accepted branch must bump skip_count',
    );
  });

  it('skip_accepted is NOT counted as pass_count', () => {
    // Verify there is no code path where "skip_accepted" bumps pass_count
    // by inspecting the handler blocks.
    const runCheckBlock = extractBlock(source, 'run_check\\(\\)');
    assert.ok(runCheckBlock, 'run_check block must exist');
    // inside the skip_accepted branch there must not be pass_count++
    const skipBranch = runCheckBlock.match(/"skip_accepted"[\s\S]{0,400}?fi/);
    assert.ok(skipBranch, 'must have a skip_accepted branch in run_check');
    assert.ok(!/pass_count=\$\(\(pass_count/.test(skipBranch[0]),
      'skip_accepted branch must NOT bump pass_count');
  });

  it('harness logs SKIP (not PASS) when bucketing as skip_accepted', () => {
    assert.ok(
      /SKIP\s+\$\{id\}[^P]/.test(source) || /log\s+"\s*SKIP/.test(source),
      'harness must log a SKIP prefix for accepted-skip checks',
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// Unit (London School, stubbed node) — exercise each result branch
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A2: unit — check_adr0073_native_runtime branches', () => {
  it('Case 1: binary present + runtime OK → PASS', () => {
    const sandbox = makeSandbox({ installBinary: true });
    try {
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'ok',
      });
      assert.equal(passed, 'true',
        `Expected passed=true, got passed=${passed}\noutput: ${output}\nraw:\n${rawStdout}`);
      assert.ok(/fake native round-trip/.test(output), 'output should reflect the stubbed OK message');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('Case 2: binary present + runtime FAIL → FAIL (not PASS, not skip_accepted)', () => {
    const sandbox = makeSandbox({ installBinary: true });
    try {
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'fail',
      });
      assert.equal(passed, 'false',
        `Expected passed=false (native broke), got passed=${passed}\noutput: ${output}\nraw:\n${rawStdout}`);
      assert.ok(/Expected native RVF runtime available/.test(output),
        `Expected explicit FAIL diagnostic, got: ${output}`);
      assert.ok(!/skipped/.test(output.toLowerCase()),
        'FAIL output must not be mistaken for a skip');
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('Case 3: binary present + import error → FAIL (not PASS — this is the ADR-0082 fix)', () => {
    const sandbox = makeSandbox({ installBinary: true });
    try {
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'import-err',
      });
      // This is THE test the whole task is fixing: previously an import
      // error produced `console.log('SKIP: ...')` and the harness set
      // _CHECK_PASSED="true". That must NOT happen anymore.
      assert.equal(passed, 'false',
        `Previously this path silent-passed. Must now FAIL. Got passed=${passed}\noutput: ${output}\nraw:\n${rawStdout}`);
      assert.ok(/Expected native RVF runtime available/.test(output),
        `Expected FAIL diagnostic, got: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('Case 4: binary explicitly absent → SKIP_ACCEPTED (not PASS)', () => {
    // Sandbox with no node_modules at all
    const sandbox = makeSandbox();
    try {
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'ok', // node behaviour irrelevant — shell probe fires first
      });
      assert.equal(passed, 'skip_accepted',
        `Expected passed=skip_accepted when binary absent, got passed=${passed}\noutput: ${output}\nraw:\n${rawStdout}`);
      assert.ok(/SKIP_ACCEPTED/.test(output),
        `Expected SKIP_ACCEPTED marker in output, got: ${output}`);
      assert.ok(/native binary not present in build/.test(output),
        `Expected human-readable reason, got: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('Case 5: package dir present but no .node file → SKIP_ACCEPTED', () => {
    // Directory exists (e.g. from a bad install) but no .node binary
    // for this platform — this is architecturally "binary absent".
    const sandbox = makeSandbox({ installPackageDirOnly: true });
    try {
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'ok',
      });
      assert.equal(passed, 'skip_accepted',
        `Expected skip_accepted when .node absent, got passed=${passed}\nraw:\n${rawStdout}`);
      assert.ok(/SKIP_ACCEPTED/.test(output), `Expected SKIP_ACCEPTED marker: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('Case 6: binary present (alt @ruvector scope) + runtime OK → PASS', () => {
    const sandbox = makeSandbox({ installBinary: true, scope: '@ruvector' });
    try {
      const { passed, output } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'ok',
      });
      assert.equal(passed, 'true', `Expected true for alt scope, got ${passed}: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('old silent-pass path (SKIP: message sets _CHECK_PASSED=true) is gone', () => {
    // Regression guard: explicitly verify the anti-pattern no longer fires.
    // We construct the exact input that used to silent-pass: binary present
    // + node shim emitting "SKIP: some reason" on stdout. Under the old
    // implementation this returned _CHECK_PASSED="true". Under the fix,
    // this is unrecognized output and must FAIL.
    const sandbox = makeSandbox({ installBinary: true });
    const fakeBinDir = join(tmpdir(), `adr0090-skip-${Date.now()}`);
    mkdirSync(fakeBinDir, { recursive: true });
    writeFileSync(
      join(fakeBinDir, 'node'),
      '#!/usr/bin/env bash\necho "SKIP: native binary could not load"\nexit 0\n',
      { mode: 0o755 },
    );
    const script = join(tmpdir(), `adr0090-skip-run-${Date.now()}.sh`);
    writeFileSync(script, [
      '#!/usr/bin/env bash',
      'set -uo pipefail',
      `export PATH="${fakeBinDir}:$PATH"`,
      `export TEMP_DIR="${sandbox}"`,
      `source "${CHECK_FILE}"`,
      'check_adr0073_native_runtime',
      'echo "__RESULT_PASSED__=${_CHECK_PASSED}"',
      'echo "__RESULT_OUTPUT__=${_CHECK_OUTPUT}"',
    ].join('\n'), { mode: 0o755 });
    try {
      const stdout = execSync(`bash "${script}" 2>&1`, { encoding: 'utf8', timeout: 10000 });
      const { passed, output } = parseResult(stdout);
      assert.notEqual(passed, 'true',
        `REGRESSION: SKIP: output made check silent-pass. passed=${passed} output=${output}`);
      assert.equal(passed, 'false',
        `Expected hard failure on unexpected SKIP: output, got ${passed}: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
      rmSync(fakeBinDir, { recursive: true, force: true });
      rmSync(script, { force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration — real node, real sandbox, real file swap
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A2: integration — real node with broken/fixed sandbox', () => {
  it('sandbox with no rvf-node package → SKIP_ACCEPTED under real node', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'adr0090-a2-int-'));
    try {
      // No node_modules at all — file-existence probe must fire first
      // and return SKIP_ACCEPTED without ever invoking node on the
      // generated script. This exercises the real runtime path.
      const { passed, output } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'default',
      });
      assert.equal(passed, 'skip_accepted',
        `Expected skip_accepted with no binary, got ${passed}: ${output}`);
      assert.ok(/SKIP_ACCEPTED/.test(output), `Expected SKIP_ACCEPTED marker: ${output}`);
      assert.ok(/native binary not present/.test(output), `Expected diagnostic: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('sandbox with fake binary dir + unloadable .node → FAIL (not silent-pass)', () => {
    // Put a bogus .node file in place. The shell probe will accept it,
    // the real `node` interpreter will try to import it, it will fail
    // with a native module load error. Previously this would emit
    // "SKIP: ..." and silent-pass. Now it must FAIL loudly.
    const sandbox = mkdtempSync(join(tmpdir(), 'adr0090-a2-int-'));
    try {
      const pkgDir = join(sandbox, 'node_modules', '@sparkleideas', 'ruvector-rvf-node');
      mkdirSync(pkgDir, { recursive: true });
      // A package.json that points at a nonexistent main — import will throw
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
        name: '@sparkleideas/ruvector-rvf-node',
        version: '0.0.0-test',
        main: './nonexistent.js',
      }));
      // Fake .node file so the shell probe passes
      writeFileSync(join(pkgDir, 'rvf-node.darwin-arm64.node'), '\x7fELFfake');
      const { passed, output, rawStdout } = runNativeRuntimeCheck({
        tempDir: sandbox, nodeBehaviour: 'default',
      });
      assert.equal(passed, 'false',
        `Expected FAIL when binary is present but unloadable, got ${passed}\noutput: ${output}\nraw:\n${rawStdout}`);
      assert.ok(/Expected native RVF runtime available/.test(output),
        `Expected explicit FAIL diagnostic, got: ${output}`);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Helpers for static source analysis
// ────────────────────────────────────────────────────────────────────────

function extractFn(source, fnName) {
  const startRe = new RegExp(`${fnName}\\(\\)\\s*\\{`);
  const m = source.match(startRe);
  if (!m) return '';
  const start = m.index;
  // Walk braces to find matching close
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

function extractBlock(source, headerRegex) {
  return extractFn(source, headerRegex.replace(/\\\(\\\)/, ''));
}

// @tier unit
// ADR-0090 Tier B1: L3 dimension-mismatch fail-loud test.
//
// Two things are under test:
//
//   1. The fork patch — memory-router.ts propagates EmbeddingDimensionError
//      through all three catch layers instead of silently swallowing it.
//   2. The acceptance check — check_adr0090_b1_dimension_mismatch_fatal
//      in lib/acceptance-adr0090-b1-checks.sh correctly asserts:
//        (a) CLI exits non-zero against a doctored 384-dim RVF file
//        (b) Output contains a "dimension mismatch" diagnostic
//        (c) Self-test: a clean E2E project does NOT trip the assertion
//
// Strategy
// --------
// (1) is source-level: grep the fork's dist for the preservation pattern.
//     Safer than relying on the unpublished fork build tree — the
//     published @sparkleideas/cli dist is the authoritative artifact.
// (2) uses London School mocks: source the real check function in a
//     subshell, replace _run_and_kill / _e2e_isolate / _cli_cmd with
//     stubs that simulate different CLI outputs, and harvest
//     _CHECK_PASSED / _CHECK_OUTPUT afterward.
//
// Test cases
// ----------
//   Case 1 (PASS):  doctored iso returns exit=1 + "dimension mismatch"
//                   in stderr, clean iso returns exit=0   → _CHECK_PASSED=true
//   Case 2 (FAIL):  doctored iso returns exit=0           → _CHECK_PASSED=false ("REGRESSION")
//   Case 3 (FAIL):  doctored iso returns exit=1 but no dim-mismatch
//                   diagnostic                            → _CHECK_PASSED=false ("masked")
//   Case 4 (FAIL):  seed step fails (node script errors)  → _CHECK_PASSED=false
//   Case 5 (FAIL):  self-test: CLEAN iso ALSO fails       → _CHECK_PASSED=false
//   Case 6 (static): fork dist preserves EmbeddingDimensionError
//
// All cases drive the REAL bash check in a subshell against synthesized
// _run_and_kill outputs — no parallel reimplementation.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0090-b1-checks.sh');
const CHECKS_LIB = resolve(ROOT, 'lib', 'acceptance-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a "stub project" layout for _e2e_isolate to return. The check
 * doesn't actually care what's inside — we only need _e2e_isolate to
 * echo a directory that exists.
 */
function setupIso(tempDir, label) {
  const iso = join(tempDir, `iso-${label}`);
  mkdirSync(join(iso, '.claude-flow'), { recursive: true });
  mkdirSync(join(iso, '.swarm'), { recursive: true });
  return iso;
}

/**
 * Write a CLI stub at `$dir/cli` that reads rehearsed exit code + output
 * from a sidecar state file. The state file has one "scenario" line per
 * call:
 *
 *   doctored|<exit>|<stdout_file>
 *   clean|<exit>|<stdout_file>
 *
 * The stub detects which call it is by counter file.
 */
function writeCliStub(dir, stateFile) {
  const shim = join(dir, 'cli');
  const counter = join(dir, '.cli-counter');
  writeFileSync(counter, '0');
  writeFileSync(shim, [
    '#!/usr/bin/env bash',
    `STATE_FILE='${stateFile}'`,
    `COUNTER_FILE='${counter}'`,
    'n=$(cat "$COUNTER_FILE")',
    'n=$((n + 1))',
    'echo "$n" > "$COUNTER_FILE"',
    `line=$(awk -v n="$n" 'NR==n { print; exit }' "$STATE_FILE")`,
    'if [[ -z "$line" ]]; then exit 0; fi',
    'IFS="|" read -r scenario rc out_file <<< "$line"',
    'if [[ -n "$out_file" && -f "$out_file" ]]; then cat "$out_file"; fi',
    'exit "${rc:-0}"',
  ].join('\n'), { mode: 0o755 });
  return shim;
}

/**
 * Write a seed-script stub that just touches a file so the check's
 * "does $seed_db exist?" branch passes. Controlled by a flag file —
 * if `seed_should_fail` exists, exit non-zero.
 */
function writeNodeStub(dir, seedOk, seedMsg) {
  const nodeStub = join(dir, 'node');
  writeFileSync(nodeStub, [
    '#!/usr/bin/env bash',
    // The check invokes `node $seed_script $seed_db` and expects
    // `SEED_OK:$seed_db` on stdout if success. Arg 2 is the db path.
    'script_path="$1"',
    'db_path="${2:-}"',
    seedOk
      ? '# happy seed: touch the db file + print SEED_OK'
      : '# failing seed: no output',
    seedOk ? 'if [[ -n "$db_path" ]]; then' : ':',
    seedOk ? '  mkdir -p "$(dirname "$db_path")" 2>/dev/null || true' : '',
    seedOk ? '  printf "RVF\\x00fakeseed" > "$db_path"' : '',
    seedOk ? `  echo "${seedMsg || 'SEED_OK:$db_path'}"` : '',
    seedOk ? 'fi' : '',
    seedOk ? 'exit 0' : `echo "${seedMsg || 'seed fail'}"; exit 1`,
  ].join('\n'), { mode: 0o755 });
  return nodeStub;
}

/**
 * Source the check file in a subshell with mocked helpers and return
 * { passed, output, raw }.
 */
function runCheck({ tempDir, isoDirs, cliScenarios, nodeSeed, nodeSeedMsg, omitHelperE2EIsolate }) {
  const stubDir = join(tempDir, 'stubs');
  mkdirSync(stubDir, { recursive: true });

  // CLI stub + state file
  const cliStateFile = join(stubDir, 'cli-state.txt');
  const cliStubPath = writeCliStub(stubDir, cliStateFile);
  const scenarioLines = [];
  for (const s of cliScenarios) {
    let outFile = '';
    if (s.stdout) {
      outFile = join(stubDir, `stdout-${scenarioLines.length}.txt`);
      writeFileSync(outFile, s.stdout);
    }
    scenarioLines.push(`${s.scenario}|${s.exit}|${outFile}`);
  }
  writeFileSync(cliStateFile, scenarioLines.join('\n') + '\n');

  // node stub (controls the seed script's success)
  const nodeStubPath = writeNodeStub(stubDir, nodeSeed !== false, nodeSeedMsg);

  // Driver script
  const driverPath = join(stubDir, 'driver.sh');
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    // Put our stubs first so `node` + `cli` resolve to them
    `export PATH="${stubDir}:$PATH"`,
    `export TEMP_DIR="${tempDir}"`,
    `export E2E_DIR="${tempDir}/e2e"`,
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    // Override helpers
    `_cli_cmd() { echo "${cliStubPath}"; }`,
    // _e2e_isolate returns a fresh isoN dir. We pre-made two of them
    // (doctored + clean); each call consumes the next one.
    '_e2e_iso_counter=0',
    '_e2e_isolate() {',
    '  _e2e_iso_counter=$((_e2e_iso_counter + 1))',
    `  case "$_e2e_iso_counter" in`,
    ...isoDirs.map((d, i) => `    ${i + 1}) echo "${d}" ;;`),
    '  esac',
    '}',
    // _run_and_kill: run the command and capture into $2, set _RK_EXIT
    '_run_and_kill() {',
    '  local cmd="$1" out="${2:-}"',
    '  if [[ -n "$out" ]]; then',
    '    eval "$cmd" > "$out" 2>&1',
    '  else',
    '    eval "$cmd" > /dev/null 2>&1',
    '  fi',
    '  _RK_EXIT=$?',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    `source "${CHECK_FILE}"`,
    'check_adr0090_b1_dimension_mismatch_fatal',
    'echo "::PASSED::$_CHECK_PASSED"',
    'echo "::OUTPUT_START::"',
    'echo "${_CHECK_OUTPUT:-}"',
    'echo "::OUTPUT_END::"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 15000 });
  const out = (result.stdout || '') + (result.stderr || '');
  const passedMatch = out.match(/::PASSED::(.*)/);
  const outputMatch = out.match(/::OUTPUT_START::\n([\s\S]*?)::OUTPUT_END::/);
  return {
    passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
    output: outputMatch ? outputMatch[1].trim() : '',
    raw: out,
  };
}

function setupTest(label) {
  const tempDir = mkdtempSync(join(tmpdir(), `b1-${label}-`));
  const doctored = setupIso(tempDir, 'doctored');
  const clean = setupIso(tempDir, 'clean');
  return { tempDir, doctored, clean };
}

function teardown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ────────────────────────────────────────────────────────────────────────
// Static source assertions — the check function is physically present
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B1: static source — check function landed', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('defines check_adr0090_b1_dimension_mismatch_fatal', () => {
    assert.match(
      source,
      /check_adr0090_b1_dimension_mismatch_fatal\(\)\s*\{/,
      'function must be defined in acceptance-adr0090-b1-checks.sh',
    );
  });

  it('uses _e2e_isolate for isolation (does not pollute shared state)', () => {
    assert.match(source, /_e2e_isolate "b1-dim-mismatch"/,
      'must isolate the doctored project via _e2e_isolate helper');
  });

  it('builds the 384-dim RVF file via RvfBackend (not hand-crafted bytes)', () => {
    assert.match(source, /@sparkleideas\/memory/,
      'must import RvfBackend from @sparkleideas/memory');
    assert.match(source, /dimensions:\s*384/,
      'must seed a 384-dim RVF file (not 768)');
  });

  it('asserts CLI exits non-zero with dim-mismatch diagnostic', () => {
    assert.match(source, /search_exit.*-eq 0/,
      'must check search exited with non-zero code');
    assert.match(source, /dimension mismatch|EmbeddingDimensionError/,
      'must grep for dimension-mismatch diagnostic in output');
  });

  it('includes a self-test — clean iso must not trip the assertion', () => {
    assert.match(source, /self.?test|clean_iso|b1-clean/,
      'must include a self-test against a clean E2E project');
  });

  it('is wired into scripts/test-acceptance.sh', () => {
    const runner = readFileSync(
      resolve(ROOT, 'scripts', 'test-acceptance.sh'),
      'utf-8',
    );
    assert.match(runner, /check_adr0090_b1_dimension_mismatch_fatal/,
      'runner must invoke the B1 check function');
    assert.match(runner, /"adr0090-b1-dim-fatal"/,
      'runner must use the adr0090-b1-dim-fatal id');
  });

  it('is sourced via lib/acceptance-checks.sh loader', () => {
    const loader = readFileSync(CHECKS_LIB, 'utf-8');
    assert.match(loader, /acceptance-adr0090-b1-checks\.sh/,
      'loader must source acceptance-adr0090-b1-checks.sh');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Branch coverage — each case drives the real bash check in a subshell
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B1 Case 1: doctored exit=1 + dim-mismatch diag → PASS', () => {
  it('returns _CHECK_PASSED=true when CLI fails loudly', () => {
    const fx = setupTest('case1');
    try {
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoDirs: [fx.doctored, fx.clean],
        cliScenarios: [
          {
            scenario: 'doctored',
            exit: 1,
            stdout: 'Error: Embedding dimension mismatch: stored vectors are 384-dim but configured model produces 768-dim\n',
          },
          {
            scenario: 'clean',
            exit: 0,
            stdout: 'No results.\n',
          },
        ],
      });
      assert.equal(passed, 'true',
        `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /correctly exited.*dimension mismatch/,
        `expected happy-path diagnostic, got: ${output}`);
      assert.match(output, /self-test passed/,
        'must report self-test result');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier B1 Case 2: doctored exits 0 (silent fallback) → FAIL', () => {
  it('returns _CHECK_PASSED=false with REGRESSION diagnostic', () => {
    const fx = setupTest('case2');
    try {
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoDirs: [fx.doctored], // only doctored call, case fails before clean
        cliScenarios: [
          {
            scenario: 'doctored',
            exit: 0, // silent success — the regression we're guarding
            stdout: 'No results found.\n',
          },
        ],
      });
      assert.equal(passed, 'false',
        `expected FAIL on silent-pass regression, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /REGRESSION|exited 0.*doctored|silently swallow/,
        `expected regression diagnostic, got: ${output}`);
      // This is the exact case ADR-0082 forbids — it must NEVER pass
      assert.notEqual(passed, 'true',
        'REGRESSION: silent sql.js-style fallback must NEVER PASS this check');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier B1 Case 3: exit=1 but masked diagnostic → FAIL', () => {
  it('catches generic "registry init failed" wrapping that loses the error name', () => {
    const fx = setupTest('case3');
    try {
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoDirs: [fx.doctored],
        cliScenarios: [
          {
            scenario: 'doctored',
            exit: 1,
            // Generic error, no "dimension mismatch" text. This is the
            // pre-fix behavior where memory-router.ts line 381 rewrapped
            // EmbeddingDimensionError as `new Error('registry init failed')`.
            stdout: 'Error: registry init failed\n',
          },
        ],
      });
      assert.equal(passed, 'false',
        `expected FAIL on masked diagnostic, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /diagnostic|masked|generic failure/,
        `expected masking diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier B1 Case 4: seed step fails → FAIL', () => {
  it('returns _CHECK_PASSED=false with "seed step failed" diagnostic', () => {
    const fx = setupTest('case4');
    try {
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoDirs: [fx.doctored],
        cliScenarios: [], // never reached
        nodeSeed: false,
        nodeSeedMsg: 'Error: cannot find module @sparkleideas/memory',
      });
      assert.equal(passed, 'false',
        `expected FAIL on seed failure, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /seed step failed|could not build 384-dim RVF/,
        `expected seed-failure diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier B1 Case 5: clean E2E project also fails → FAIL (self-test)', () => {
  it('catches a buggy check that triggers dim-mismatch even on clean state', () => {
    const fx = setupTest('case5');
    try {
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoDirs: [fx.doctored, fx.clean],
        cliScenarios: [
          {
            scenario: 'doctored',
            exit: 1,
            stdout: 'Error: Embedding dimension mismatch: stored vectors are 384-dim\n',
          },
          // Clean iso ALSO fails with dim-mismatch — the check itself
          // is leaking doctored state across invocations
          {
            scenario: 'clean',
            exit: 1,
            stdout: 'Error: Embedding dimension mismatch: leaked state\n',
          },
        ],
      });
      assert.equal(passed, 'false',
        `expected FAIL when clean iso also fails, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /self-test failed|clean.*also reports|cannot distinguish/,
        `expected self-test diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fork patch assertions — memory-router.ts preserves EmbeddingDimensionError
// ────────────────────────────────────────────────────────────────────────
//
// We prefer the published dist over the fork working tree: the dist is
// the authoritative artifact that consumers install. If a future refactor
// reverts the fork patch but the dist was rebuilt, this guard catches it.

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';
const FORK_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/memory/memory-router.js';

describe('ADR-0090 Tier B1 + ADR-0112 Phase 2: fork patch — fatal-init error propagation', () => {
  // ADR-0112 Phase 2 (memory-router track) refactored the per-site fatal-name
  // string checks into a single _isFatalInitError(e) helper that covers
  // EmbeddingDimensionError, DimensionMismatchError (the underlying class
  // name from embedding-pipeline.ts — slice 4 found memory-router only
  // checked the controller-registry-relabelled form), RvfCorruptError,
  // AgentDBInitError, and ControllerInitError. Tests updated to assert the
  // new shape; semantic intent preserved (fatal init errors always propagate).

  it('fork source defines _isFatalInitError covering all 5 fatal classes', { skip: !existsSync(FORK_SRC) }, () => {
    const src = readFileSync(FORK_SRC, 'utf-8');
    assert.match(src, /function _isFatalInitError\(/,
      'memory-router must export a _isFatalInitError helper');
    for (const errName of ['EmbeddingDimensionError', 'DimensionMismatchError', 'RvfCorruptError', 'AgentDBInitError', 'ControllerInitError']) {
      assert.ok(src.includes(`'${errName}'`),
        `_isFatalInitError must include '${errName}' in its discrimination set`);
    }
  });

  it('fork source uses _isFatalInitError in inner registry catch', { skip: !existsSync(FORK_SRC) }, () => {
    const src = readFileSync(FORK_SRC, 'utf-8');
    // Inner catch in initControllerRegistry must call the helper + throw
    assert.match(src, /catch\s*\(e\)\s*\{[^}]*_isFatalInitError\(e\)[^}]*throw e[^}]*\}/s,
      'inner registry catch must use _isFatalInitError(e) and throw e');
  });

  it('fork source uses _isFatalInitError in outer IIFE catch', { skip: !existsSync(FORK_SRC) }, () => {
    const src = readFileSync(FORK_SRC, 'utf-8');
    // The helper is used at >= 4 sites: inner catch, outer IIFE catch,
    // _doInit storage catch, _doInit registry catch
    const helperCalls = (src.match(/_isFatalInitError\(e\)/g) || []).length;
    assert.ok(helperCalls >= 4,
      `expected >= 4 _isFatalInitError(e) call sites, found ${helperCalls}`);
  });

  it('fork source re-throws fatal errors in _doInit (not silent continue)', { skip: !existsSync(FORK_SRC) }, () => {
    const src = readFileSync(FORK_SRC, 'utf-8');
    const doInitSlice = src.slice(src.indexOf('async function _doInit'),
                                 src.indexOf('async function _doInit') + 4000);
    assert.match(doInitSlice, /catch\s*\(e\)\s*\{[^}]*_isFatalInitError\(e\)[^}]*throw e[^}]*\}/s,
      '_doInit catch must call _isFatalInitError(e) and throw e on a match');
  });

  // ADR-0112 Phase 2 note: the prior dist test pointed at the fork's own
  // `dist/` directory, which is NOT the source of truth in this build
  // pipeline. The pipeline copies fork source → /tmp/ruflo-build →
  // compiles → publishes. The fork's local dist is never updated by
  // `npm run build`. Removing the dist-level check; the source tests
  // above are the correctness gate, and acceptance (partition-holds +
  // AgentDB read-roundtrip) verifies the published artifact end-to-end.
  // A stale published artifact would fail those acceptance checks
  // immediately — they exercise the actual fail-loud guards.
});

// ────────────────────────────────────────────────────────────────────────
// Harness compatibility
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B1: harness plumbing', () => {
  it('check returns only the three valid _CHECK_PASSED values', () => {
    const source = readFileSync(CHECK_FILE, 'utf-8');
    // Scan for _CHECK_PASSED assignments in the function body
    const assignments = source.match(/_CHECK_PASSED="(\w+)"/g) || [];
    const values = new Set(assignments.map(m => m.match(/"(\w+)"/)[1]));
    // "false" (default + failure), "true" (success) — NO skip_accepted for B1
    // because there is no legitimate prerequisite-absent case
    for (const v of values) {
      assert.ok(['true', 'false'].includes(v),
        `B1 must only set _CHECK_PASSED to true/false, found "${v}"`);
    }
    assert.ok(values.has('true'), 'must have a true-assignment (happy path)');
    assert.ok(values.has('false'), 'must have a false-assignment (regression)');
  });
});

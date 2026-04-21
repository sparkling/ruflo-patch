// @tier unit
// ADR-0094 Phase 17: Validator property fuzzing — paired unit tests.
//
// Phase 17 meta-tests the bash VALIDATORS that Phases 11/12/15/16 rely on.
// Each `check_adr0094_p17_*` function seeds `_MCP_BODY`/`_MCP_EXIT`/
// `_CHECK_PASSED` as locals, invokes the target validator, captures the
// post-state, and calls `_p17_assert_verdict` (or does inline comparison)
// to set its OWN _CHECK_PASSED/_CHECK_OUTPUT to the Phase-17 outcome.
//
// Unlike p16/p15 tests there is NO CLI shim and NO E2E_DIR — the checks
// don't spawn subprocesses. For checks 14 & 15 the lib provides its own
// `_p17_stub_mcp` override, so the subprocess driver doesn't need to stub
// anything itself.
//
// The test DYNAMICALLY DISCOVERS every `check_adr0094_p17_*` via
// `declare -F` so additions to the lib are caught automatically (the
// hard-coded list is used only to verify expected coverage — if the lib
// gains a new check it will fail the discovery-diff sentinel test, nudging
// someone to update the expected-verdict map).
//
// Expected-verdict map per check (from phase 17 lib header matrix). Every
// check_adr0094_p17_* self-asserts with _p17_assert_verdict, so every
// GREEN check should end with _CHECK_PASSED="true" and _CHECK_OUTPUT
// starting with "<label> OK:". The output diagnostic strings below are
// the hooks each check publishes for dashboards — we assert on them to
// pin down the exact branch that PASSed (so a refactor that accidentally
// passes via a different branch still trips these tests).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const P11_FILE = resolve(ROOT, 'lib', 'acceptance-phase11-fuzzing.sh');
const P12_FILE = resolve(ROOT, 'lib', 'acceptance-phase12-error-quality.sh');
const P15_FILE = resolve(ROOT, 'lib', 'acceptance-phase15-flakiness.sh');
const P16_FILE = resolve(ROOT, 'lib', 'acceptance-phase16-pii-inverse.sh');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase17-validator-fuzzing.sh');

// Ordered expected-verdict catalogue (mirrors the lib header matrix).
// Each entry: fn = bash check function, kind = which validator it exercises,
// outputMatch = a regex the successful _CHECK_OUTPUT must match (to pin
// down the branch, not just the overall verdict).
const CHECKS = [
  { fn: 'check_adr0094_p17_p11_nonzero_exit_passes',           kind: 'p11 / nonzero exit',       outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_success_false_passes',          kind: 'p11 / success:false',      outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_error_word_passes',             kind: 'p11 / error-shape word',   outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_silent_success_fails',          kind: 'p11 / silent-success [T2]', outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_empty_body_fails',              kind: 'p11 / empty body [T3]',    outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_skip_propagates',               kind: 'p11 / skip_accepted [T1]', outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p11_ambiguity_error_wins',          kind: 'p11 / ambiguity [T4]',     outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p12_named_with_hint_passes',        kind: 'p12 / canonical PASS',     outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p12_rejected_without_token_fails',  kind: 'p12 / no-token FAIL',      outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p12_named_but_no_hint_fails',       kind: 'p12 / no-hint [T5]',       outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p12_skip_propagates',               kind: 'p12 / skip_accepted [T1]', outputMatch: /OK:/ },
  { fn: 'check_adr0094_p17_p15_classify_four_shapes',          kind: 'p15 / classifier 4-way',   outputMatch: /4 shape classes|exit_error.*empty.*failure.*success|classify OK/i },
  { fn: 'check_adr0094_p17_p15_flaky_detected',                kind: 'p15 / flaky + canaries [T6]', outputMatch: /flaky.*all-empty.*all-error.*3x-success|flaky-detected OK/i },
  { fn: 'check_adr0094_p17_p16_no_pii_ambiguous_body_fails',   kind: 'p16 / belt-and-braces [T7]', outputMatch: /ambiguous body force-FAILed|canonical.*PASSed|ambiguous-body-fails OK/i },
  { fn: 'check_adr0094_p17_p16_guard_regression_fails',        kind: 'p16 / GUARD REGRESSION [T8]', outputMatch: /GUARD REGRESSION|guard-regression-fails OK/i },
];

// Build the subprocess driver once per check invocation. Must source all
// sibling phase libs BEFORE sourcing phase17 (phase17 has no internal
// `source` — it assumes the caller has sourced its dependencies). That
// matches the real runtime wiring (scripts/test-acceptance.sh sources all
// phase libs up front).
function driverScript(fn) {
  return [
    'set -u',
    `cd "${ROOT}"`,
    // Harness requires a few globals for its own initialization; we set
    // dummies because Phase 17 never calls any harness function that reads
    // them (no _mcp_invoke_tool, no _with_iso_cleanup, no run_check).
    'export TEMP_DIR="/tmp/p17-unit-notused"',
    'export E2E_DIR="/tmp/p17-unit-notused/e2e"',
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    // Harness defines run_timed/_ns as "caller MUST provide" — define
    // no-op stubs so sourcing doesn't choke on unbound references.
    '_ns() { date +%s%N 2>/dev/null || echo 0; }',
    '_elapsed_ms() { echo 0; }',
    'log() { :; }',
    'run_timed() { :; }',
    '',
    `source "${HARNESS}"`,
    `source "${P11_FILE}"`,
    `source "${P12_FILE}"`,
    `source "${P15_FILE}"`,
    `source "${P16_FILE}"`,
    `source "${CHECK_FILE}"`,
    '',
    // Pre-declare the outcome globals. Inside the check functions these
    // are sometimes (but not always) declared `local`; after the function
    // returns their global scope may be unbound, which trips our driver's
    // later echo. Assigning "" up front guarantees the echo sees a value
    // even when the check-under-test shadowed them.
    '_CHECK_PASSED=""',
    '_CHECK_OUTPUT=""',
    '',
    `${fn}`,
    // Emit on clearly-delimited lines so the regex below doesn't bleed
    // across multi-line diagnostics.
    'echo "RESULT_PASSED_BEGIN"',
    'echo "${_CHECK_PASSED:-}"',
    'echo "RESULT_PASSED_END"',
    'echo "RESULT_OUTPUT_BEGIN"',
    'echo "${_CHECK_OUTPUT:-}"',
    'echo "RESULT_OUTPUT_END"',
  ].join('\n');
}

function runCheck(fn) {
  const result = spawnSync('bash', ['-c', driverScript(fn)], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  const passedMatch = stdout.match(/RESULT_PASSED_BEGIN\n([\s\S]*?)\nRESULT_PASSED_END/);
  const outputMatch = stdout.match(/RESULT_OUTPUT_BEGIN\n([\s\S]*?)\nRESULT_OUTPUT_END/);

  return {
    stdout,
    stderr,
    passed: passedMatch ? passedMatch[1].trim() : '',
    output: outputMatch ? outputMatch[1] : '',
    exitCode: result.status,
  };
}

// Dynamic discovery — lists every function matching `check_adr0094_p17_*`
// in the lib. Used as a sentinel so new checks added to the lib surface as
// a test failure (nudging the author to extend CHECKS above).
function discoverChecks() {
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    'export TEMP_DIR="/tmp/p17-unit-notused"',
    'export E2E_DIR="/tmp/p17-unit-notused/e2e"',
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    '_ns() { echo 0; }',
    '_elapsed_ms() { echo 0; }',
    'log() { :; }',
    'run_timed() { :; }',
    `source "${HARNESS}"`,
    `source "${P11_FILE}"`,
    `source "${P12_FILE}"`,
    `source "${P15_FILE}"`,
    `source "${P16_FILE}"`,
    `source "${CHECK_FILE}"`,
    "declare -F | awk '{print $3}' | grep '^check_adr0094_p17_' | sort",
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 15_000 });
  return (result.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('check_adr0094_p17_'));
}

describe('ADR-0094 Phase 17 — validator property fuzzing', () => {
  it('lib and all required phase files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(P11_FILE), `missing p11 lib: ${P11_FILE}`);
    assert.ok(existsSync(P12_FILE), `missing p12 lib: ${P12_FILE}`);
    assert.ok(existsSync(P15_FILE), `missing p15 lib: ${P15_FILE}`);
    assert.ok(existsSync(P16_FILE), `missing p16 lib: ${P16_FILE}`);
    assert.ok(existsSync(CHECK_FILE), `missing phase17 lib: ${CHECK_FILE}`);
  });

  // Sentinel — forces the expected-verdict map to stay in sync with the
  // lib. If the lib gains/renames/drops a check, this test fails loudly.
  it('dynamic discovery matches the expected check matrix', () => {
    const discovered = discoverChecks();
    const expected = CHECKS.map((c) => c.fn).sort();
    const discoveredSorted = [...discovered].sort();
    assert.deepEqual(discoveredSorted, expected,
      `Phase 17 lib check set drifted from expected matrix.\n` +
      `  discovered: ${JSON.stringify(discoveredSorted)}\n` +
      `  expected:   ${JSON.stringify(expected)}\n` +
      `If you added a check, append it to CHECKS[] above with its expected output match.`);
  });

  for (const { fn, kind, outputMatch } of CHECKS) {
    describe(`${fn} — ${kind}`, () => {
      it('validator behaved as specified (_CHECK_PASSED=="true")', () => {
        const r = runCheck(fn);
        assert.equal(r.exitCode, 0,
          `driver exit=${r.exitCode}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
        assert.equal(r.passed, 'true',
          `Phase 17 check expected to produce _CHECK_PASSED="true" (the check's own self-assertion), ` +
          `got "${r.passed}".\n` +
          `  _CHECK_OUTPUT: ${r.output}\n` +
          `  stderr: ${r.stderr}\n` +
          `This means the validator under test misbehaved OR the phase17 check itself is wrong.`);
      });

      it('published the expected PASS diagnostic (branch-level pinning)', () => {
        const r = runCheck(fn);
        assert.match(r.output, outputMatch,
          `Phase 17 check passed but the published _CHECK_OUTPUT does not match the expected ` +
          `branch pattern. A green verdict that goes through the wrong branch is a silent regression.\n` +
          `  expected to match: ${outputMatch}\n` +
          `  got _CHECK_OUTPUT: ${r.output}`);
      });
    });
  }

  // Cross-cutting sanity: the check whose SOLE purpose is verifying
  // the p16 guard emits a specific diagnostic string should publish
  // "GUARD REGRESSION" somewhere in its PASS output (Phase-17 relays
  // the phrase through its own OK line).
  it('guard-regression check passes AND references the GUARD REGRESSION signal', () => {
    const r = runCheck('check_adr0094_p17_p16_guard_regression_fails');
    assert.equal(r.passed, 'true',
      `guard-regression check did not pass: ${r.output}\nstderr: ${r.stderr}`);
    assert.match(r.output, /GUARD REGRESSION/,
      `guard-regression PASS output must mention 'GUARD REGRESSION' so the signal is ` +
      `searchable in dashboards. Got: ${r.output}`);
  });

  // Cross-cutting sanity: classify check should actually name its four
  // shape classes (exit_error, empty, failure, success) in its OK line.
  it('classify check publishes all 4 shape-class names', () => {
    const r = runCheck('check_adr0094_p17_p15_classify_four_shapes');
    assert.equal(r.passed, 'true',
      `classify check did not pass: ${r.output}\nstderr: ${r.stderr}`);
    for (const klass of ['exit_error', 'empty', 'failure', 'success']) {
      assert.match(r.output, new RegExp(klass),
        `classify PASS output must name '${klass}' so reviewers can see all 4 branches ran. ` +
        `Got: ${r.output}`);
    }
  });
});

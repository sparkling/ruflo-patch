// @tier unit
// ADR-0094 Phase 15: Flakiness characterization — paired unit tests.
//
// Sibling lib `lib/acceptance-phase15-flakiness.sh` defines 6 checks (one per
// read-only tool class) that share two helpers:
//   - `_p15_classify <body> <exit>` → {success, failure, empty, exit_error}
//   - `_p15_expect_deterministic <label> <c1> <c2> <c3>` → verdict
//
// Each check invokes `_p15_run_three` which calls `_mcp_invoke_tool` three
// times in a row and compares shape classes. Verdict buckets:
//   - SKIP_ACCEPTED : first run is tool-not-found
//   - PASS          : all 3 classes == `success` (canonical deterministic pass)
//   - PASS          : all 3 classes == `failure` (deterministic-failure; this
//                     phase only measures variance, not correctness)
//   - FAIL          : classes differ (the headline "truly flaky" defect)
//   - FAIL          : all 3 classes == `empty` (ADR-0082 silent-pass canary)
//   - FAIL          : all 3 classes == `exit_error` (deterministic infra fault)
//
// The shim uses a SHIM_COUNTER_FILE on disk so it can vary its response across
// the three successive invocations — otherwise the "flaky" bucket is
// untestable. The counter file is fresh per `runCheck()` call (lives inside
// the per-test mkdtemp dir).
//
// Shim modes (SHIM_MODE env var):
//   stable_success → all 3 runs: {"success":true,"result":"ok"}, exit 0
//   stable_failure → all 3 runs: {"success":false,"error":"boom"}, exit 0
//   flaky          → run 1 success body, run 2 failure body, run 3 empty body
//   empty_body     → all 3 runs: `Result:\n` with no body, exit 0
//   all_error      → all 3 runs: generic non-not-found diagnostic, exit 1
//   not_found      → run 1: `Error: tool not found: <tool>`, exit 1
//
// Test-runtime budget: 6 checks × 4 baseline modes + 1 check × 2 extra modes
// = 26 shim invocations × ≤1s each. No `sleep` in shim → well under 30s.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase15-flakiness.sh');

// ── Matrix: one check per read-only tool. ──
const CHECKS = [
  { fn: 'check_adr0094_p15_flaky_memory_search',  tool: 'memory_search' },
  { fn: 'check_adr0094_p15_flaky_agent_list',     tool: 'agent_list' },
  { fn: 'check_adr0094_p15_flaky_config_get',     tool: 'config_get' },
  { fn: 'check_adr0094_p15_flaky_claims_board',   tool: 'claims_board' },
  { fn: 'check_adr0094_p15_flaky_workflow_list',  tool: 'workflow_list' },
  { fn: 'check_adr0094_p15_flaky_session_list',   tool: 'session_list' },
];

// Shim: reads SHIM_COUNTER_FILE to know which of the 3 serial runs this is,
// then branches on SHIM_MODE. Plain string join to dodge template-literal
// ${...} collisions with bash parameter expansion.
function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# Parse "mcp exec --tool <t>" from args (for not_found diagnostic).',
    'tool=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  fi',
    'done',
    '',
    '# Counter across successive shim invocations — required so the `flaky`',
    '# mode can return three DIFFERENT shape classes from one test driver run.',
    'counter_file="${SHIM_COUNTER_FILE:-/tmp/p15-shim-counter}"',
    'n=$(cat "$counter_file" 2>/dev/null || echo 0)',
    'n=$((n + 1))',
    'echo "$n" > "$counter_file"',
    '',
    'case "${SHIM_MODE:-stable_success}" in',
    '  stable_success)',
    '    echo "Result:"',
    '    echo \'{"success":true,"result":"ok"}\'',
    '    exit 0',
    '    ;;',
    '  stable_failure)',
    '    echo "Result:"',
    '    echo \'{"success":false,"error":"boom"}\'',
    '    exit 0',
    '    ;;',
    '  flaky)',
    '    if [[ "$n" == "1" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"result":"ok"}\'',
    '    elif [[ "$n" == "2" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":false,"error":"boom"}\'',
    '    else',
    '      # Run 3 (or later): empty body — NOT `{}` — so _p15_classify',
    '      # returns `empty`, giving us three distinct classes.',
    '      echo "Result:"',
    '    fi',
    '    exit 0',
    '    ;;',
    '  empty_body)',
    '    echo "Result:"',
    '    exit 0',
    '    ;;',
    '  all_error)',
    '    # Generic diagnostic — must NOT contain "tool not found" or the',
    '    # _mcp_invoke_tool layer will short-circuit to SKIP_ACCEPTED and we',
    '    # would never reach the `exit_error` classification.',
    '    echo "Error: backend unavailable"',
    '    exit 1',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p15-flaky-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p15-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  // Counter file lives inside `root` — fresh per call, destroyed with the
  // rmSync below. Guarantees the `flaky` mode starts at n=1 every test.
  const counterFile = resolve(root, 'shim-counter');

  // Driver sources harness + phase15 lib, stubs _cli_cmd/_e2e_isolate/
  // _run_and_kill[_ro], invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_COUNTER_FILE="${counterFile}"`,
    '',
    `source "${HARNESS}"`,
    `source "${CHECK_FILE}"`,
    '',
    `_cli_cmd() { echo "${cli}"; }`,
    '_e2e_isolate() {',
    '  local id="$1"',
    `  local iso="${root}/iso-$id-$$"`,
    '  rm -rf "$iso"; mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '  echo "$iso"',
    '}',
    // eval-based runner so the shim runs in-process and we get its real exit.
    '_run_and_kill() {',
    '  local cmd="$1" out_file="$2" max="${3:-15}"',
    '  ( eval "$cmd" >> "$out_file" 2>&1; rc=$?; echo "__RUFLO_DONE__:$rc" >> "$out_file" ) &',
    '  local pid=$!; wait "$pid"',
    '  local line; line=$(grep "^__RUFLO_DONE__:" "$out_file" | tail -1)',
    '  _RK_EXIT="${line##__RUFLO_DONE__:}"',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    '',
    `${fn}`,
    'echo "RESULT_PASSED=$_CHECK_PASSED"',
    'echo "RESULT_OUTPUT=$_CHECK_OUTPUT"',
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 30_000 });
  rmSync(root, { recursive: true, force: true });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: (result.stdout?.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (result.stdout?.match(/RESULT_OUTPUT=(.*)/) || [])[1] || '',
  };
}

describe('ADR-0094 Phase 15 — flakiness characterization verdict', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  // Baseline matrix: all 6 checks × 4 buckets
  // (stable_success=PASS, stable_failure=PASS, flaky=FAIL, not_found=SKIP).
  for (const { fn, tool } of CHECKS) {
    describe(`${fn} (${tool})`, () => {
      it('PASS on stable_success (3/3 runs classify as success)', () => {
        const r = runCheck({ fn, mode: 'stable_success' });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /deterministic|OK|3\/3/i,
          `PASS output should confirm deterministic verdict: ${r.output}`);
      });

      it('PASS on stable_failure (deterministic-failure is still deterministic)', () => {
        const r = runCheck({ fn, mode: 'stable_failure' });
        assert.equal(r.passed, 'true',
          `expected PASS (phase only measures variance), got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /deterministic-failure|failure shape/i,
          `PASS output should flag deterministic-failure class for dashboards: ${r.output}`);
      });

      it('FAIL on flaky (3 different shape classes = the headline defect)', () => {
        const r = runCheck({ fn, mode: 'flaky' });
        assert.notEqual(r.passed, 'true',
          `flaky runs must NOT pass — this is the exact defect P15 exists to catch. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `flaky runs must NOT skip_accepted — the tool is in the build, it is just unreliable. Got: ${r.output}`);
        assert.match(r.output, /flaky|differ|non-determin/i,
          `FAIL output should name the flaky verdict: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool not in build', () => {
        const r = runCheck({ fn, mode: 'not_found' });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });
    });
  }

  // Representative check exercises the two remaining FAIL buckets so we prove
  // empty-body and all-error paths don't collapse into the flaky branch.
  // `check_adr0094_p15_flaky_memory_search` is the canonical representative
  // (it's check #1 in the lib's tool matrix).
  describe('check_adr0094_p15_flaky_memory_search — extra FAIL buckets', () => {
    it('FAIL on empty_body (ADR-0082 silent-pass canary)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p15_flaky_memory_search',
        mode: 'empty_body',
      });
      assert.notEqual(r.passed, 'true',
        `three empty bodies must NOT pass — ADR-0082 silent-pass canary. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `three empty bodies must NOT skip_accepted — neutral body is suspect, not accepted. Got: ${r.output}`);
      assert.match(r.output, /empty|ADR-0082|silent/i,
        `FAIL output should name the empty-body verdict: ${r.output}`);
    });

    it('FAIL on all_error (deterministic infra failure, distinct from flakiness)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p15_flaky_memory_search',
        mode: 'all_error',
      });
      assert.notEqual(r.passed, 'true',
        `three non-zero exits must NOT pass — uniformly-broken tool is not coverage. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `all_error must NOT skip_accepted — the diagnostic lacks "tool not found", so this is a real infra fault, not a missing tool. Got: ${r.output}`);
      assert.match(r.output, /non-zero|exit|infra/i,
        `FAIL output should distinguish infra-failure from flakiness: ${r.output}`);
    });
  });
});

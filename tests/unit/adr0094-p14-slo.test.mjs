// @tier unit
// ADR-0094 Phase 14: Performance SLO per tool class — paired unit tests.
//
// Sibling lib `lib/acceptance-phase14-slo.sh` defines 8 checks (one per tool
// class) that share one verdict helper `_p14_expect_within_slo`. Unlike
// Phase 11/12 (which asserted rejection semantics), Phase 14 asserts a time
// budget. The helper reads _CHECK_PASSED / _MCP_BODY / _MCP_EXIT that
// _mcp_invoke_tool just populated AND an <elapsed_seconds> arg measured
// around that invocation, then buckets:
//
//   - SKIP_ACCEPTED   : tool-not-found preserved from _mcp_invoke_tool.
//   - FAIL            : elapsed > budget                                  (SLO exceeded)
//   - FAIL            : exit != 0 OR body has success:false / error-shape (tool errored)
//   - FAIL            : body empty with exit 0                            (ADR-0082 silent-pass canary)
//   - PASS            : elapsed <= budget AND exit 0 AND body non-empty AND no error-shape
//
// Shim modes (SHIM_MODE env var):
//   fast      → immediate body '{"success":true,"result":"ok"}', exit 0
//   slow      → sleep 12s (or $SHIM_SLEEP if set), then success body, exit 0
//   error     → immediate '{"success":false,"error":"boom"}', exit 0
//   empty     → immediate 'Result:\n' with no body, exit 0
//   not_found → 'Error: tool not found: <tool>', exit 1
//
// Test-runtime budget: only 2 representative checks exercise slow mode
// (memory_store budget 10 → 12s sleep; neural_status budget 15 → 17s sleep)
// to keep total wall clock under ~45s. All 8 checks exercise fast / error /
// not_found.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase14-slo.sh');

// ── Matrix: one check per tool class, each with its SLO budget. ──
const CHECKS = [
  { fn: 'check_adr0094_p14_slo_memory_store',      tool: 'memory_store',      budget: 10 },
  { fn: 'check_adr0094_p14_slo_session_save',      tool: 'session_save',      budget: 10 },
  { fn: 'check_adr0094_p14_slo_agent_list',        tool: 'agent_list',        budget: 15 },
  { fn: 'check_adr0094_p14_slo_claims_board',      tool: 'claims_board',      budget: 10 },
  { fn: 'check_adr0094_p14_slo_workflow_list',     tool: 'workflow_list',     budget: 10 },
  { fn: 'check_adr0094_p14_slo_config_get',        tool: 'config_get',        budget: 10 },
  { fn: 'check_adr0094_p14_slo_neural_status',     tool: 'neural_status',     budget: 15 },
  { fn: 'check_adr0094_p14_slo_autopilot_status',  tool: 'autopilot_status',  budget: 10 },
];

// Shim — plain string join to avoid template-literal ${...} collisions with bash.
function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# Parse "mcp exec --tool <t>" from args.',
    'tool=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  fi',
    'done',
    '',
    'case "${SHIM_MODE:-fast}" in',
    '  fast)',
    '    echo "Result:"',
    '    echo \'{"success":true,"result":"ok"}\'',
    '    exit 0',
    '    ;;',
    '  slow)',
    '    sleep "${SHIM_SLEEP:-12}"',
    '    echo "Result:"',
    '    echo \'{"success":true,"result":"ok"}\'',
    '    exit 0',
    '    ;;',
    '  error)',
    '    echo "Result:"',
    '    echo \'{"success":false,"error":"boom"}\'',
    '    exit 0',
    '    ;;',
    '  empty)',
    '    echo "Result:"',
    '    exit 0',
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

function runCheck({ fn, mode, sleepSecs }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p14-slo-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p14-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const sleepEnv = sleepSecs != null ? `export SHIM_SLEEP="${sleepSecs}"` : '';

  // Driver sources harness + phase14 lib, stubs _cli_cmd/_e2e_isolate/_run_and_kill[_ro],
  // invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    sleepEnv,
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
    // Stub honors the caller\'s max_wait arg but falls back to 60s so slow
    // mode (up to ~17s) never gets SIGKILLed inside the stub. eval runs the
    // shim in-process so the shim\'s real `sleep` counts toward elapsed.
    '_run_and_kill() {',
    '  local cmd="$1" out_file="$2" max="${3:-60}"',
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

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 60_000 });
  rmSync(root, { recursive: true, force: true });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: (result.stdout?.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (result.stdout?.match(/RESULT_OUTPUT=(.*)/) || [])[1] || '',
  };
}

describe('ADR-0094 Phase 14 — performance SLO verdict', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  // Fast-mode matrix: all 8 checks × 3 buckets (fast=PASS, error=FAIL, not_found=SKIP).
  for (const { fn, tool, budget } of CHECKS) {
    describe(`${fn} (${tool}, budget=${budget}s)`, () => {
      it('PASS when tool is fast and succeeds', () => {
        const r = runCheck({ fn, mode: 'fast' });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /OK|≤|<=|within|budget/i,
          `PASS output should confirm within-budget verdict: ${r.output}`);
      });

      it('FAIL on tool error within SLO window', () => {
        const r = runCheck({ fn, mode: 'error' });
        assert.notEqual(r.passed, 'true',
          `tool error must NOT pass — SLO is only meaningful when the tool actually works. Got: ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `tool error must NOT skip_accepted — error is a real defect. Got: ${r.output}`);
        assert.match(r.output, /errored|success:false|error|boom/i,
          `FAIL output should name the error verdict: ${r.output}`);
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

  // Slow-mode: only two representatives (one per budget tier) to keep
  // wall-clock under 45s. Both MUST fail with an SLO-exceeded verdict.
  describe('slow-mode SLO enforcement', () => {
    it('check_adr0094_p14_slo_memory_store FAILs on SLO exceeded (10s budget, 12s sleep)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p14_slo_memory_store',
        mode: 'slow',
        sleepSecs: 12,
      });
      assert.notEqual(r.passed, 'true',
        `slow tool must NOT pass — this is the primary SLO defect we catch. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `slow tool must NOT skip_accepted — latency is a real regression. Got: ${r.output}`);
      assert.match(r.output, /exceeded|SLO|>|budget/i,
        `FAIL output should name the SLO-exceeded verdict: ${r.output}`);
    });

    it('check_adr0094_p14_slo_neural_status FAILs on SLO exceeded (15s budget, 17s sleep)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p14_slo_neural_status',
        mode: 'slow',
        sleepSecs: 17,
      });
      assert.notEqual(r.passed, 'true',
        `slow tool must NOT pass — budget tier 15s must still reject 17s elapsed. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `slow tool must NOT skip_accepted — latency is a real regression. Got: ${r.output}`);
      assert.match(r.output, /exceeded|SLO|>|budget/i,
        `FAIL output should name the SLO-exceeded verdict: ${r.output}`);
    });
  });

  // Empty-body canary — ADR-0082 silent-pass guard. Run once on a
  // representative check to prove empty-body-with-exit-0 is not swallowed.
  it('check_adr0094_p14_slo_memory_store FAILs on empty body (ADR-0082 canary)', () => {
    const r = runCheck({
      fn: 'check_adr0094_p14_slo_memory_store',
      mode: 'empty',
    });
    assert.notEqual(r.passed, 'true',
      `empty body must NOT pass — ADR-0082 silent-pass canary. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
    assert.notEqual(r.passed, 'skip_accepted',
      `empty body must NOT skip_accepted — neutral body is suspect, not accepted. Got: ${r.output}`);
    assert.match(r.output, /empty|neutral body|no.*body|ADR-0082/i,
      `FAIL output should name the empty-body verdict: ${r.output}`);
  });
});

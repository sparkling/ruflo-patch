// @tier unit
// ADR-0097 Tier Z — paired unit test for lib/acceptance-autopilot-checks.sh.
//
// Exercises the 9-tool autopilot check surface (ADR-0094 Phase 2) without
// Verdaccio or a published CLI. A bash shim stands in for the real CLI and
// is driven via SHIM_MODE to cover the three-way bucket (ADR-0090 Tier A2):
//   - happy   (regex matches)          → _CHECK_PASSED=true
//   - empty   (no body)                → _CHECK_PASSED=false
//   - tool_not_found                   → _CHECK_PASSED=skip_accepted
//   - pattern_mismatch                 → _CHECK_PASSED=false
//
// The shim parses `mcp exec --tool <t>` from its args, matches the three-way
// bucket enforced by _autopilot_invoke_tool in the lib, and emits bodies the
// existing grep-based verdict reads. Closes BUG-TIERZ-AUTOPILOT.
//
// Paired with: lib/acceptance-autopilot-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-TIERZ-AUTOPILOT

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-autopilot-checks.sh');

// Matrix: each check → expected regex fragment the shim must emit for happy.
// Mirrors the _autopilot_invoke_tool wiring in the .sh file.
const CHECKS = [
  { fn: 'check_adr0094_p2_autopilot_enable',  happyBody: '{"enabled":true}' },
  { fn: 'check_adr0094_p2_autopilot_disable', happyBody: '{"disabled":true}' },
  { fn: 'check_adr0094_p2_autopilot_status',  happyBody: '{"status":"running"}' },
  { fn: 'check_adr0094_p2_autopilot_config',  happyBody: '{"config":{"mode":"auto"}}' },
  { fn: 'check_adr0094_p2_autopilot_predict', happyBody: '{"prediction":"run tests"}' },
  { fn: 'check_adr0094_p2_autopilot_history', happyBody: '{"history":[]}' },
  { fn: 'check_adr0094_p2_autopilot_learn',   happyBody: '{"learned":true}' },
  { fn: 'check_adr0094_p2_autopilot_log',     happyBody: '{"logged":true}' },
  { fn: 'check_adr0094_p2_autopilot_reset',   happyBody: '{"reset":true}' },
];

// Shim behaviours — mapped to SHIM_MODE. happyBody is injected via env so the
// shim script itself is generic.
function shimScript() {
  return [
    '#!/usr/bin/env bash',
    'tool=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1)); tool="${!j}"',
    '  fi',
    'done',
    '',
    'case "${SHIM_MODE:-happy}" in',
    '  happy)',
    '    # _autopilot_invoke_tool greps body for regex — no Result: sentinel.',
    '    echo "${SHIM_HAPPY_BODY:-{\"ok\":true}}"',
    '    exit 0',
    '    ;;',
    '  empty)',
    '    exit 0',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    '  mismatch)',
    '    echo \'{"unrelated":"noise","totally":"offtopic"}\'',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, happyBody = '' }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p2-ap-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p2-ap-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_HAPPY_BODY='${happyBody.replace(/'/g, `'"'"'`)}'`,
    '',
    `source "${HARNESS}"`,
    `source "${CHECK_FILE}"`,
    '',
    `_cli_cmd() { echo "${cli}"; }`,
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
    'echo "RESULT_OUTPUT<<<$_CHECK_OUTPUT>>>END"',
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 30_000 });
  rmSync(root, { recursive: true, force: true });
  const stdout = result.stdout || '';
  return {
    stdout,
    stderr: result.stderr || '',
    passed: (stdout.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (stdout.match(/RESULT_OUTPUT<<<([\s\S]*?)>>>END/) || [])[1] || '',
  };
}

describe('acceptance-autopilot-checks.sh (ADR-0097 Tier Z)', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, happyBody } of CHECKS) {
    describe(fn, () => {
      it('PASS on happy-path body matching expected regex', () => {
        const r = runCheck({ fn, mode: 'happy', happyBody });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, new RegExp(`${fn.replace(/^check_adr0094_p2_/, '')}|returned expected pattern`),
          `output should label the check: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool is not in build', () => {
        const r = runCheck({ fn, mode: 'not_found' });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });

      it('FAIL on pattern mismatch (not silent-pass)', () => {
        const r = runCheck({ fn, mode: 'mismatch' });
        assert.equal(r.passed, 'false',
          `pattern mismatch must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /did not match/i,
          `FAIL output should name the regex miss: ${r.output}`);
      });
    });
  }
});

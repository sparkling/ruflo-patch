// @tier unit
// ADR-0097 Tier Z — paired unit test for lib/acceptance-hooks-lifecycle-checks.sh.
//
// Exercises the 8-tool hooks-lifecycle check surface (ADR-0094 Phase 6) —
// each check delegates to the canonical _mcp_invoke_tool helper in the
// harness, which enforces the three-way bucket (ADR-0090 Tier A2):
//   - happy              → _CHECK_PASSED=true
//   - empty              → _CHECK_PASSED=false
//   - tool_not_found     → _CHECK_PASSED=skip_accepted
//   - pattern_mismatch   → _CHECK_PASSED=false
//
// Because _mcp_invoke_tool parses the body after a `Result:` sentinel, the
// shim emits it. Closes BUG-TIERZ-HOOKS-LIFECYCLE.
//
// Paired with: lib/acceptance-hooks-lifecycle-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-TIERZ-HOOKS-LIFECYCLE

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-hooks-lifecycle-checks.sh');

// Each check → a happy body that matches its regex (see .sh file line refs).
const CHECKS = [
  { fn: 'check_adr0094_p6_hooks_pre_task',       happyBody: '{"pre-task":"ok","risk":"low"}' },
  { fn: 'check_adr0094_p6_hooks_post_task',      happyBody: '{"post-task":"recorded"}' },
  { fn: 'check_adr0094_p6_hooks_pre_edit',       happyBody: '{"pre-edit":"analysis complete"}' },
  { fn: 'check_adr0094_p6_hooks_post_edit',      happyBody: '{"post-edit":"recorded"}' },
  { fn: 'check_adr0094_p6_hooks_pre_command',    happyBody: '{"shouldProceed":true,"riskLevel":"low"}' },
  { fn: 'check_adr0094_p6_hooks_post_command',   happyBody: '{"post-command":"recorded"}' },
  { fn: 'check_adr0094_p6_hooks_session_start',  happyBody: '{"session":"started"}' },
  { fn: 'check_adr0094_p6_hooks_session_end',    happyBody: '{"session":"ended"}' },
];

// Shim script — emits Result: sentinel because _expect_mcp_body requires it.
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
    '    echo "Result:"',
    '    echo "${SHIM_HAPPY_BODY:-{\"ok\":true}}"',
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
    '  mismatch)',
    '    echo "Result:"',
    '    echo \'{"unrelated":"noise","foobar":42}\'',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, happyBody = '' }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p6-hooks-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p6-hooks-unit"}');

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

describe('acceptance-hooks-lifecycle-checks.sh (ADR-0097 Tier Z)', () => {
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
        assert.match(r.output, /returned expected pattern/,
          `PASS output should explain: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool is not in build', () => {
        const r = runCheck({ fn, mode: 'not_found' });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });

      it('FAIL on empty body (ADR-0082 canary — not silent-pass)', () => {
        const r = runCheck({ fn, mode: 'empty' });
        assert.equal(r.passed, 'false',
          `empty body must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /empty body|did not match/i,
          `FAIL output should name the empty-body violation: ${r.output}`);
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

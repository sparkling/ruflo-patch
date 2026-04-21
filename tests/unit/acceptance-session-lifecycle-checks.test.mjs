// @tier unit
// ADR-0097 Tier Z — paired unit test for lib/acceptance-session-lifecycle-checks.sh.
//
// Exercises the 5-tool session check surface + lifecycle (ADR-0094 Phase 3)
// without Verdaccio or a published CLI. A bash shim stands in for the real
// CLI and is driven via SHIM_MODE to cover the three-way bucket:
//   - happy              → _CHECK_PASSED=true
//   - tool_not_found     → _CHECK_PASSED=skip_accepted
//   - pattern_mismatch   → _CHECK_PASSED=false
//
// Note: session_restore/info/delete internally call `_session_seed` which
// invokes `session_save` first. The shim therefore recognises session_save
// as a seed call and returns `{"savedAt":...,"sessionId":"..."}`; the driven
// tool returns its own happy/mismatch body. Closes BUG-TIERZ-SESSION-LIFECYCLE.
//
// Paired with: lib/acceptance-session-lifecycle-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-TIERZ-SESSION-LIFECYCLE

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-session-lifecycle-checks.sh');

// Happy bodies per check — each regex from the lib.
const CHECKS = [
  { fn: 'check_adr0094_p3_session_save',    happyBody: '{"savedAt":"2026-04-21T00:00:00Z","sessionId":"adr0094-unit-1"}' },
  { fn: 'check_adr0094_p3_session_list',    happyBody: '{"sessions":[],"list":true}' },
  { fn: 'check_adr0094_p3_session_restore', happyBody: '{"restored": true}' },
  { fn: 'check_adr0094_p3_session_delete',  happyBody: '{"deleted": true}' },
  { fn: 'check_adr0094_p3_session_info',    happyBody: '{"savedAt":"ts","fileSize":42,"hasData":true}' },
];

// Shim: session_save always seeds (unless SHIM_MODE=not_found), so the seed
// call succeeds; the primary tool under test gets the SHIM_MODE response.
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
    '# Seed path: when SHIM_MODE=not_found we want the seed to look like a',
    '# missing tool so the dependent check reports skip_accepted via seed.',
    '# For all other modes the seed must succeed so the main tool is exercised.',
    'if [[ "$tool" == "session_save" && "${SHIM_SUT:-}" != "session_save" ]]; then',
    '  if [[ "${SHIM_MODE:-happy}" == "not_found" ]]; then',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '  fi',
    '  echo \'{"savedAt":"2026-04-21T00:00:00Z","sessionId":"seed-unit"}\'',
    '  exit 0',
    'fi',
    '',
    'case "${SHIM_MODE:-happy}" in',
    '  happy)',
    '    echo "${SHIM_HAPPY_BODY:-{\"ok\":true}}"',
    '    exit 0',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    '  mismatch)',
    '    echo \'{"unrelated":"noise","foobar":42}\'',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, happyBody = '', sut = '' }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p3-sess-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p3-sess-unit"}');

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
    `export SHIM_SUT="${sut}"`,
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

describe('acceptance-session-lifecycle-checks.sh (ADR-0097 Tier Z)', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, happyBody } of CHECKS) {
    // When the test subject IS session_save, let the shim treat it as SUT.
    const sut = fn === 'check_adr0094_p3_session_save' ? 'session_save' : '';
    describe(fn, () => {
      it('PASS on happy-path body matching expected regex', () => {
        const r = runCheck({ fn, mode: 'happy', happyBody, sut });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /returned expected pattern/,
          `PASS output should explain: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool is not in build', () => {
        const r = runCheck({ fn, mode: 'not_found', sut });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found|prereq/i,
          `skip output should explain: ${r.output}`);
      });

      it('FAIL on pattern mismatch (ADR-0082 canary — not silent-pass)', () => {
        const r = runCheck({ fn, mode: 'mismatch', sut });
        assert.equal(r.passed, 'false',
          `pattern mismatch must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /did not match/i,
          `FAIL output should name the regex miss: ${r.output}`);
      });
    });
  }
});

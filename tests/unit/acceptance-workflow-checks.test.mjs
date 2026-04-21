// @tier unit
// ADR-0097 Tier Z — paired unit test for lib/acceptance-workflow-checks.sh.
//
// Exercises the workflow MCP-tool check surface (ADR-0094 Phase 2). Each
// individual check delegates to the canonical _mcp_invoke_tool helper which
// enforces the three-way bucket:
//   - happy              → _CHECK_PASSED=true
//   - tool_not_found     → _CHECK_PASSED=skip_accepted
//   - pattern_mismatch   → _CHECK_PASSED=false
//
// The lifecycle check also exercises _with_iso_cleanup (trap-based iso-dir
// teardown), chained through 7 tool invocations that all need to succeed.
// Closes BUG-TIERZ-WORKFLOW.
//
// Paired with: lib/acceptance-workflow-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-TIERZ-WORKFLOW

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-workflow-checks.sh');

// Individual single-invocation checks — each uses _mcp_invoke_tool directly.
const INDIVIDUAL = [
  { fn: 'check_adr0094_p2_workflow_run',      happyBody: '{"running":true,"workflowId":"workflow-abc"}' },
  { fn: 'check_adr0094_p2_workflow_template', happyBody: '{"templates":["default"]}' },
];

// Shim that emits Result: sentinel and recognises workflow_create for the
// lifecycle path (returns a workflowId so _extract_workflow_id succeeds).
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
    '    # Lifecycle path: workflow_create must return a workflowId so',
    '    # _extract_workflow_id (node JSON parse) succeeds and subsequent',
    '    # steps key by it.',
    '    if [[ "$tool" == "workflow_create" ]]; then',
    '      echo \'{"workflowId":"workflow-unit-1","name":"adr0094-test","created":true}\'',
    '    elif [[ "$tool" == "workflow_list" ]]; then',
    '      echo \'{"workflows":[{"name":"adr0094-test"}]}\'',
    '    elif [[ "$tool" == "workflow_execute" ]]; then',
    '      echo \'{"running":true,"totalSteps":1}\'',
    '    elif [[ "$tool" == "workflow_status" ]]; then',
    '      echo \'{"status":"running","state":"active"}\'',
    '    elif [[ "$tool" == "workflow_cancel" ]]; then',
    '      echo \'{"cancelled":true}\'',
    '    elif [[ "$tool" == "workflow_delete" ]]; then',
    '      echo \'{"deleted":true}\'',
    '    else',
    '      echo "${SHIM_HAPPY_BODY:-{\"ok\":true}}"',
    '    fi',
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
  const root = mkdtempSync(resolve(tmpdir(), 'p2-wf-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p2-wf-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cliBin = resolve(cliDir, 'cli');
  writeFileSync(cliBin, shimScript(), { mode: 0o755 });

  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_HAPPY_BODY=${JSON.stringify(happyBody)}`,
    `export SHIM_CLI_BIN="${cliBin}"`,
    '',
    `source "${HARNESS}"`,
    `source "${CHECK_FILE}"`,
    '',
    '_cli_cmd() { echo "$SHIM_CLI_BIN"; }',
    '# _e2e_isolate may not be sourced from acceptance-e2e-checks.sh here,',
    '# provide a local stub mirroring its shape (a fresh iso dir).',
    'if ! declare -F _e2e_isolate >/dev/null; then',
    '  _e2e_isolate() {',
    '    local id="$1"',
    `    local iso="${root}/iso-$id-$$-$RANDOM"`,
    '    rm -rf "$iso"; mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '    echo "$iso"',
    '  }',
    'fi',
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

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 45_000 });
  rmSync(root, { recursive: true, force: true });
  const stdout = result.stdout || '';
  return {
    stdout,
    stderr: result.stderr || '',
    passed: (stdout.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (stdout.match(/RESULT_OUTPUT<<<([\s\S]*?)>>>END/) || [])[1] || '',
  };
}

describe('acceptance-workflow-checks.sh (ADR-0097 Tier Z)', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, happyBody } of INDIVIDUAL) {
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

      it('FAIL on pattern mismatch (ADR-0082 canary — not silent-pass)', () => {
        const r = runCheck({ fn, mode: 'mismatch' });
        assert.equal(r.passed, 'false',
          `pattern mismatch must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /did not match/i,
          `FAIL output should name the regex miss: ${r.output}`);
      });
    });
  }

  // Lifecycle: 7-step chain under _with_iso_cleanup. Exercises the trap-
  // based cleanup path plus the _extract_workflow_id node shell-out.
  describe('check_adr0094_p2_workflow_lifecycle (multi-step + _with_iso_cleanup)', () => {
    it('PASS when all 7 steps succeed end-to-end', () => {
      const r = runCheck({ fn: 'check_adr0094_p2_workflow_lifecycle', mode: 'happy' });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /full lifecycle.*completed successfully/,
        `lifecycle PASS should name the chain: ${r.output}`);
    });

    it('SKIP_ACCEPTED when workflow_create is not in build', () => {
      const r = runCheck({ fn: 'check_adr0094_p2_workflow_lifecycle', mode: 'not_found' });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /workflow_create not in build/i,
        `skip output should identify the failing prereq: ${r.output}`);
    });

    it('FAIL when a mid-chain step returns mismatching body', () => {
      const r = runCheck({ fn: 'check_adr0094_p2_workflow_lifecycle', mode: 'mismatch' });
      assert.equal(r.passed, 'false',
        `mismatch must FAIL, got ${r.passed} / ${r.output}`);
      assert.match(r.output, /step 1 \(workflow_create\)|did not match/i,
        `FAIL output should point at the failing step: ${r.output}`);
    });
  });
});

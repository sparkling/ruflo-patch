// @tier unit
// ADR-0094 Phase 11: Input fuzzing — paired unit tests.
//
// The sibling lib `lib/acceptance-phase11-fuzzing.sh` defines 16 fuzz checks
// (8 tool classes × 2 reps) that share one verdict helper
// `_p11_expect_fuzz_rejection`. This test locks the 4-way bucket
// (exit_nonzero / error_body / silent_success / tool_not_found) for a
// representative subset of classes, without Verdaccio or a published CLI.
//
// Scenarios per check (bucket model — ADR-0090 Tier A2):
//   1. REJECTS_WITH_EXIT_NONZERO  → PASS
//   2. REJECTS_WITH_ERROR_BODY    → PASS (success:false OR error-shaped word)
//   3. SILENT_SUCCESS             → FAIL (ADR-0082 canary)
//   4. TOOL_NOT_FOUND             → skip_accepted
//
// The shim is a bash script that parses `mcp exec --tool <t> --params <json>`
// and behaves per $SHIM_MODE. It emits the `Result:` sentinel that
// _expect_mcp_body looks for.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase11-fuzzing.sh');

// ── Matrix: which check → which class+rep → what the shim sees. ──
const CHECKS = [
  { fn: 'check_adr0094_p11_fuzz_memory_type_mismatch',   tool: 'memory_store' },
  { fn: 'check_adr0094_p11_fuzz_memory_boundary',        tool: 'memory_store' },
  { fn: 'check_adr0094_p11_fuzz_agent_type_mismatch',    tool: 'agent_spawn' },
  { fn: 'check_adr0094_p11_fuzz_agent_boundary',         tool: 'agent_spawn' },
  { fn: 'check_adr0094_p11_fuzz_workflow_type_mismatch', tool: 'workflow_create' },
  { fn: 'check_adr0094_p11_fuzz_workflow_boundary',      tool: 'workflow_create' },
];

// Shim emits:
//   - SHIM_MODE=exit_nonzero : body = {"error":"invalid"} exit 1
//   - SHIM_MODE=error_body   : body = {"success":false,"error":"required: key"} exit 0
//   - SHIM_MODE=silent       : body = {"success":true}                         exit 0
//   - SHIM_MODE=not_found    : body = "Error: tool not found: <tool>"          exit 1
// All emit a "Result:" line so _expect_mcp_body parses the body.
function shimScript() {
  // Plain string to avoid template-literal ${...} collisions with bash.
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
    'case "${SHIM_MODE:-silent}" in',
    '  exit_nonzero)',
    '    echo "Result:"',
    '    echo \'{"error":"invalid input shape for \'"$tool"\'"}\'',
    '    exit 1',
    '    ;;',
    '  error_body)',
    '    echo "Result:"',
    '    echo \'{"success":false,"error":"required: key must be a non-empty string"}\'',
    '    exit 0',
    '    ;;',
    '  silent)',
    '    echo "Result:"',
    '    echo \'{"success":true}\'',
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

function runCheck({ fn, mode }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p11-fuzz-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p11-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  // Driver sources harness + phase11 lib, stubs _cli_cmd/_e2e_isolate/_run_and_kill[_ro],
  // invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    '',
    // Stubs BEFORE sourcing the lib — same-name re-defs after source are fine
    // because bash picks up the last definition at call time. But we source
    // harness first so the lib's helpers exist, then override _cli_cmd etc.
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

describe('ADR-0094 Phase 11 — fuzz rejection verdict', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, tool } of CHECKS) {
    describe(`${fn} (${tool})`, () => {
      it('PASS on exit_nonzero (rejected at CLI layer)', () => {
        const r = runCheck({ fn, mode: 'exit_nonzero' });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /rejected via exit=/,
          `output should explain exit-rejection: ${r.output}`);
      });

      it('PASS on success:false error body', () => {
        const r = runCheck({ fn, mode: 'error_body' });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /rejected via success:false|rejected via error-shape/,
          `output should explain body-rejection: ${r.output}`);
      });

      it('FAIL on silent success (ADR-0082 canary)', () => {
        const r = runCheck({ fn, mode: 'silent' });
        assert.notEqual(r.passed, 'true',
          `silent success must NOT pass — this is the exact ADR-0082 trap P11 exists to catch. Got: ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `silent success must NOT skip_accepted — it is a real defect. Got: ${r.output}`);
        assert.match(r.output, /silent-pass|success:true|ADR-0082/i,
          `FAIL output should name the silent-success violation: ${r.output}`);
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
});

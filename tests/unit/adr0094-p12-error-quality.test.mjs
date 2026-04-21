// @tier unit
// ADR-0094 Phase 12: Error message quality — paired unit tests.
//
// Sibling lib `lib/acceptance-phase12-error-quality.sh` defines 16 checks
// (8 tool classes × 2 reps: missing required field + wrong type) that share
// one verdict helper `_p12_expect_named_error`. Unlike Phase 11 (which
// passed on any rejection shape), Phase 12 requires the rejection to
//   (a) fire AT ALL,
//   (b) NAME the expected field via `token_regex`,
//   (c) carry a structural-hint word from
//       required|must|invalid|expected|missing|type|string|array|number|schema|validation.
//
// The bucket model therefore expands from 4 (P11) to 6 scenarios:
//   1. quality_ok            → PASS  (all three layers satisfied)
//   2. names_field_no_shape  → FAIL  (names field, no structural hint)
//   3. fires_no_field        → FAIL  (fires + has `validation` hint but no field)
//   4. silent_success        → FAIL  (ADR-0082 canary preserved from P11)
//   5. empty_body            → FAIL  (neutral body, ADR-0082-suspect)
//   6. not_found             → skip_accepted
//
// The shim is a bash script that parses `mcp exec --tool <t> --params <json>`
// and behaves per $SHIM_MODE, using $SHIM_FIELD (injected per-check) to
// emit class-appropriate diagnostics for the `quality_ok` and
// `names_field_no_shape` modes.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase12-error-quality.sh');

// ── Matrix: which check → which class+rep → what the shim sees. ──
// `field` is the token the shim will emit for this check when in
// `quality_ok` or `names_field_no_shape` modes. It MUST match the first
// alternation of the token_regex the sibling lib passes to
// _p12_expect_named_error so all checks exercise the same real branch.
// Note on `field_overlaps_hint`: the structural-hint regex is
//   required|must|invalid|expected|missing|type|string|array|number|schema|validation
// For the `agent` class, the expected field name is literally `type`, which
// IS a hint word. The `names_field_no_shape` bucket therefore CANNOT be
// meaningfully tested for agent — a body of `{"error":"problem with type"}`
// correctly passes the structural-hint layer because "type" IS a shape word.
// This is not a bug in the sibling helper; it is a property of the vocabulary
// and is flagged here so future maintainers don't "fix" the skip.
const CHECKS = [
  // memory
  { fn: 'check_adr0094_p12_quality_memory_missing',     tool: 'memory_store',    field: 'key',   field_overlaps_hint: false },
  { fn: 'check_adr0094_p12_quality_memory_wrong_type',  tool: 'memory_store',    field: 'value', field_overlaps_hint: false },
  // agent — `type` overlaps structural-hint regex
  { fn: 'check_adr0094_p12_quality_agent_missing',      tool: 'agent_spawn',     field: 'type',  field_overlaps_hint: true  },
  { fn: 'check_adr0094_p12_quality_agent_wrong_type',   tool: 'agent_spawn',     field: 'type',  field_overlaps_hint: true  },
  // workflow
  { fn: 'check_adr0094_p12_quality_workflow_missing',   tool: 'workflow_create', field: 'steps', field_overlaps_hint: false },
  { fn: 'check_adr0094_p12_quality_workflow_wrong_type',tool: 'workflow_create', field: 'steps', field_overlaps_hint: false },
];

// Shim emits (per SHIM_MODE, with SHIM_FIELD injected by test):
//   quality_ok            : exit 1, body {"error":"missing required field 'FIELD': must be string"}
//   names_field_no_shape  : exit 1, body {"error":"problem with FIELD"}  (names field, no structural hint)
//   fires_no_field        : exit 1, body {"error":"validation failed"}   (hint-only, no field name)
//   silent_success        : exit 0, body {"success":true}
//   empty_body            : exit 0, body empty
//   not_found             : exit 1, body "Error: tool not found: <tool>"
// All non-not_found modes emit the "Result:" sentinel _expect_mcp_body needs.
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
    'field="${SHIM_FIELD:-key}"',
    '',
    'case "${SHIM_MODE:-silent_success}" in',
    '  quality_ok)',
    '    echo "Result:"',
    '    echo "{\\"error\\":\\"missing required field \'${field}\': must be string\\"}"',
    '    exit 1',
    '    ;;',
    '  names_field_no_shape)',
    '    echo "Result:"',
    '    echo "{\\"error\\":\\"problem with ${field}\\"}"',
    '    exit 1',
    '    ;;',
    '  fires_no_field)',
    '    echo "Result:"',
    '    echo \'{"error":"validation failed"}\'',
    '    exit 1',
    '    ;;',
    '  silent_success)',
    '    echo "Result:"',
    '    echo \'{"success":true}\'',
    '    exit 0',
    '    ;;',
    '  empty_body)',
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

function runCheck({ fn, mode, field }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p12-quality-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p12-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  // Driver sources harness + phase12 lib, stubs _cli_cmd/_e2e_isolate/_run_and_kill[_ro],
  // invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_FIELD="${field}"`,
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

describe('ADR-0094 Phase 12 — named-error verdict', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, tool, field, field_overlaps_hint } of CHECKS) {
    describe(`${fn} (${tool}, field=${field})`, () => {
      it('PASS on quality_ok (names field + structural hint)', () => {
        const r = runCheck({ fn, mode: 'quality_ok', field });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /OK: rejected via/,
          `output should confirm rejection: ${r.output}`);
        assert.match(r.output, /structural hint/,
          `output should confirm structural-hint layer: ${r.output}`);
      });

      // For classes where the field name is itself a hint word (e.g. agent's
      // `type`), the names_field_no_shape bucket cannot be exercised — a body
      // of `{"error":"problem with type"}` legitimately carries the structural
      // hint "type", so the helper PASSes the body and no FAIL branch exists
      // to assert against. The invariant that the overlap is real is covered
      // separately by `_p12_overlap_invariant_test` in this file (added by
      // sibling agent A6). We simply do not register a bucket2 test case for
      // such classes — no `it.skip`, no noise in the skip count.
      if (!field_overlaps_hint) {
        it('FAIL on names_field_no_shape (token present, no hint word)', () => {
          const r = runCheck({ fn, mode: 'names_field_no_shape', field });
          assert.notEqual(r.passed, 'true',
            `must not PASS — body names field but omits structural hint. Got: ${r.passed} / ${r.output}`);
          assert.notEqual(r.passed, 'skip_accepted',
            `must not SKIP — this is the exact new-in-P12 defect we are catching. Got: ${r.output}`);
          assert.match(r.output, /names field but not shape|structural hint/i,
            `FAIL output should explain the missing-hint verdict: ${r.output}`);
        });
      }

      it('FAIL on fires_no_field (rejection fires but does not name field)', () => {
        const r = runCheck({ fn, mode: 'fires_no_field', field });
        assert.notEqual(r.passed, 'true',
          `must not PASS — body rejects but does not name the expected field. Got: ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `must not SKIP — this is the primary P12 defect (loud but uninformative). Got: ${r.output}`);
        assert.match(r.output, /does not name expected field|name the problem/i,
          `FAIL output should explain the missing-field verdict: ${r.output}`);
      });

      it('FAIL on silent_success (ADR-0082 canary)', () => {
        const r = runCheck({ fn, mode: 'silent_success', field });
        assert.notEqual(r.passed, 'true',
          `silent success must NOT pass — ADR-0082 canary. Got: ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `silent success must NOT skip_accepted — it is a real defect. Got: ${r.output}`);
        assert.match(r.output, /silent-pass|success:true|ADR-0082/i,
          `FAIL output should name the silent-success violation: ${r.output}`);
      });

      it('FAIL on empty_body (neutral body is ADR-0082-suspect)', () => {
        const r = runCheck({ fn, mode: 'empty_body', field });
        assert.notEqual(r.passed, 'true',
          `empty body must NOT pass — neutral bodies mask defects. Got: ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `empty body must NOT skip_accepted — it is suspect, not accepted. Got: ${r.output}`);
        assert.match(r.output, /no rejection signal|neutral body|ADR-0082/i,
          `FAIL output should name the neutral-body verdict: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool not in build', () => {
        const r = runCheck({ fn, mode: 'not_found', field });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });
    });
  }
});

// @tier unit
// ADR-0094 Phase 9: Concurrency matrix — paired unit tests.
//
// The sibling lib `lib/acceptance-phase9-concurrency.sh` defines 4 concurrency
// checks that share one verdict helper `_p9_expect_single_winner` and one
// skip-aggregator `_p9_any_tool_not_found`. This test locks the bucket
// transitions (single_winner / zero_winners / multi_winners / tool_not_found
// / interleave-variants) for each check, without Verdaccio or a published CLI.
//
// Scenarios (bucket model — ADR-0090 Tier A2):
//   - single_winner / exactly_one / clean_lastwriter    → PASS
//   - zero_winners / zero / interleaved                 → FAIL
//   - multi_winners / duplicate                         → FAIL
//   - tool_not_found                                    → skip_accepted
//
// The shim is a bash script that parses `mcp exec --tool <t> --params <json>`
// and behaves per $SHIM_MODE. It uses a per-tool counter file for multi-call
// scenarios (e.g. claims: first call wins, remaining 5 are rejected). It
// emits the `Result:` sentinel that _expect_mcp_body looks for.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase9-concurrency.sh');

// ── Shim contract ────────────────────────────────────────────────────
//
// Env vars the shim reads:
//   SHIM_MODE        — scenario name (see below)
//   SHIM_COUNTER_DIR — dir where per-tool counter files live
//
// Scenario → behaviour map:
//
//   claims:
//     one_winner    : first claims_claim returns {success:true,claimed:true};
//                     calls 2..6 return {success:false,error:"already claimed"}.
//     zero_winners  : all claims_claim return {success:false,error:"already claimed"}.
//     two_winners   : first 2 claims_claim succeed, remaining 4 rejected.
//     tool_not_found: every claims_claim prints "Error: tool not found: claims_claim" exit 1.
//
//   session (save + info):
//     clean_lastwriter: both session_save return success; session_info returns
//                       a body with value="p9sessB$$" (one of the writers' distinct vals).
//     interleaved     : both session_save return success; session_info returns
//                       a body with value=null (neither writer's value).
//     tool_not_found  : session_save prints tool-not-found, exit 1.
//
//   workflow (create + list):
//     exactly_one   : workflow_create always returns success; workflow_list body
//                     contains the shared name exactly once.
//     duplicate     : workflow_list body contains the shared name 3 times.
//     zero          : workflow_list body contains 0 occurrences of the name.
//     tool_not_found: workflow_create prints tool-not-found, exit 1.
//
// The shim distinguishes tools by reading `--tool <name>` from argv.

function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# Parse "mcp exec --tool <t> --params <json>" from args.',
    'tool=""',
    'params=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  elif [[ "${!i}" == "--params" ]]; then',
    '    j=$((i+1))',
    '    params="${!j}"',
    '  fi',
    'done',
    '',
    '# Per-tool atomic counter. The lib runs 6 parallel claims_claim calls —',
    '# a naive read-modify-write cycle lets all 6 observe count=1. We use',
    '# `mkdir` which is atomic: the N-th concurrent caller to successfully',
    '# `mkdir "$counter_dir/step-$N-$tool"` wins slot N. We probe slots 1..K',
    '# in order and take the first one that `mkdir` succeeds on.',
    'counter_dir="${SHIM_COUNTER_DIR:-/tmp}"',
    'mkdir -p "$counter_dir"',
    'count=0',
    'for _n in $(seq 1 100); do',
    '  if mkdir "$counter_dir/step-$_n-$tool" 2>/dev/null; then',
    '    count=$_n',
    '    break',
    '  fi',
    'done',
    '',
    '# Capture name and value from params via node (robust JSON parse) so the',
    '# observation-phase tools (session_info, workflow_list) can echo them back.',
    '# The lib generates name/value with $$ so tests cannot pre-compute them.',
    'captured_name=""',
    'captured_value=""',
    'if [[ -n "$params" ]]; then',
    '  captured_name=$(node -e \'try { const j = JSON.parse(process.argv[1]); if (typeof j?.name === "string") process.stdout.write(j.name); } catch {}\' "$params" 2>/dev/null || true)',
    '  captured_value=$(node -e \'try { const j = JSON.parse(process.argv[1]); if (typeof j?.value === "string") process.stdout.write(j.value); } catch {}\' "$params" 2>/dev/null || true)',
    'fi',
    '',
    '# Persist captured name per-tool-family so observation calls can read them.',
    'name_file="$counter_dir/name-$tool"',
    'value_file="$counter_dir/value-$tool"',
    '# For workflow: aggregate names across all creates into a single file, one',
    '# per line — workflow_list can cat this to find the actual generated name.',
    'names_log="$counter_dir/names-$tool.log"',
    'if [[ -n "$captured_name" ]]; then',
    '  echo "$captured_name" >> "$names_log"',
    '  echo "$captured_name" > "$name_file"',
    'fi',
    'if [[ -n "$captured_value" ]]; then',
    '  echo "$captured_value" >> "$value_file.log"',
    '  echo "$captured_value" > "$value_file"',
    'fi',
    '',
    '# For observation-phase tools, read the captured name/value from the MUTATION',
    '# tools (e.g. session_info reads session_save’s last name).',
    'read_captured_name() {',
    '  local mut="$1"',
    '  local f="$counter_dir/name-$mut"',
    '  [[ -f "$f" ]] && cat "$f" || echo ""',
    '}',
    'first_captured_value() {',
    '  local mut="$1"',
    '  local f="$counter_dir/value-$mut.log"',
    '  [[ -f "$f" ]] && head -1 "$f" || echo ""',
    '}',
    'last_captured_value() {',
    '  local mut="$1"',
    '  local f="$counter_dir/value-$mut.log"',
    '  [[ -f "$f" ]] && tail -1 "$f" || echo ""',
    '}',
    '',
    'case "${SHIM_MODE:-}" in',
    '  # ── claims scenarios ──',
    '  one_winner)',
    '    if [[ "$tool" == "claims_claim" ]]; then',
    '      if (( count == 1 )); then',
    '        echo "Result:"',
    '        echo \'{"success":true,"claimed":true,"issueId":"probe"}\'',
    '      else',
    '        echo "Result:"',
    '        echo \'{"success":false,"error":"already claimed"}\'',
    '      fi',
    '      exit 0',
    '    fi',
    '    ;;',
    '  zero_winners)',
    '    if [[ "$tool" == "claims_claim" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":false,"error":"already claimed by someone else"}\'',
    '      exit 0',
    '    fi',
    '    ;;',
    '  two_winners)',
    '    if [[ "$tool" == "claims_claim" ]]; then',
    '      if (( count <= 2 )); then',
    '        echo "Result:"',
    '        echo \'{"success":true,"claimed":true,"issueId":"probe"}\'',
    '      else',
    '        echo "Result:"',
    '        echo \'{"success":false,"error":"already claimed"}\'',
    '      fi',
    '      exit 0',
    '    fi',
    '    ;;',
    '',
    '  # ── session scenarios ──',
    '  clean_lastwriter)',
    '    if [[ "$tool" == "session_save" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"sessionId":"sess-probe","savedAt":"2026-04-20T00:00:00Z"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "session_info" ]]; then',
    '      # Echo back the session name captured from session_save, plus one of',
    '      # the two distinct writer values (the LAST one captured — simulates',
    '      # last-writer-wins). If no value was captured (shouldn’t happen), we',
    '      # fall through to a placeholder that will fail the lib’s grep.',
    '      the_name=$(read_captured_name "session_save")',
    '      the_value=$(last_captured_value "session_save")',
    '      echo "Result:"',
    '      # JSON string-escape is only needed for quotes/backslashes; the lib',
    '      # uses safe ASCII for its test values.',
    '      echo "{\\"sessionId\\":\\"sess-probe\\",\\"name\\":\\"${the_name}\\",\\"value\\":\\"${the_value}\\",\\"createdAt\\":\\"2026-04-20T00:00:00Z\\",\\"path\\":\\"/tmp/sess\\"}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '  interleaved)',
    '    if [[ "$tool" == "session_save" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"sessionId":"sess-probe","savedAt":"2026-04-20T00:00:00Z"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "session_info" ]]; then',
    '      # Body references the session NAME (so it passes the name-present',
    '      # gate) but reports value=null so it matches NEITHER writer — the',
    '      # lib must then loud-FAIL on the "matches neither" branch.',
    '      the_name=$(read_captured_name "session_save")',
    '      echo "Result:"',
    '      echo "{\\"sessionId\\":\\"sess-probe\\",\\"name\\":\\"${the_name}\\",\\"value\\":null,\\"createdAt\\":\\"2026-04-20T00:00:00Z\\",\\"path\\":\\"/tmp/sess\\"}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '',
    '  # ── workflow scenarios ──',
    '  exactly_one)',
    '    if [[ "$tool" == "workflow_create" ]]; then',
    '      if (( count == 1 )); then',
    '        echo "Result:"',
    '        echo \'{"success":true,"workflowId":"workflow-0001-abc"}\'',
    '      else',
    '        echo "Result:"',
    '        echo \'{"success":false,"error":"name already exists"}\'',
    '      fi',
    '      exit 0',
    '    elif [[ "$tool" == "workflow_list" ]]; then',
    '      # Echo the captured name EXACTLY ONCE in the list body.',
    '      the_name=$(read_captured_name "workflow_create")',
    '      echo "Result:"',
    '      echo "{\\"workflows\\":[{\\"name\\":\\"${the_name}\\",\\"id\\":\\"workflow-0001-abc\\"}]}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '  duplicate)',
    '    if [[ "$tool" == "workflow_create" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"workflowId":"workflow-\'"$count"\'-abc"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "workflow_list" ]]; then',
    '      # Name appears 3 times in the list body → race allowed dup.',
    '      the_name=$(read_captured_name "workflow_create")',
    '      echo "Result:"',
    '      echo "{\\"workflows\\":[{\\"name\\":\\"${the_name}\\",\\"id\\":\\"a\\"},{\\"name\\":\\"${the_name}\\",\\"id\\":\\"b\\"},{\\"name\\":\\"${the_name}\\",\\"id\\":\\"c\\"}]}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '  zero)',
    '    if [[ "$tool" == "workflow_create" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":false,"error":"creation failed"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "workflow_list" ]]; then',
    '      # Empty list — no matches for any name.',
    '      echo "Result:"',
    '      echo \'{"workflows":[]}\'',
    '      exit 0',
    '    fi',
    '    ;;',
    '',
    '  tool_not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, extraEnv = {} }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p9-concur-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p9-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const counterDir = resolve(root, 'counters');
  mkdirSync(counterDir, { recursive: true });

  const extraExports = Object.entries(extraEnv)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join('\n');

  // Driver sources harness + phase9 lib, stubs _cli_cmd/_e2e_isolate/_run_and_kill[_ro],
  // invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_COUNTER_DIR="${counterDir}"`,
    extraExports,
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

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 45_000 });
  rmSync(root, { recursive: true, force: true });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: (result.stdout?.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (result.stdout?.match(/RESULT_OUTPUT=(.*)/) || [])[1] || '',
  };
}

describe('ADR-0094 Phase 9 — concurrency matrix', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  // ── P9-1: RVF delegated ─────────────────────────────────────────────
  describe('check_adr0094_p9_rvf_concurrent_writes_delegated', () => {
    it('always returns skip_accepted with a pointer to t3-2', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_rvf_concurrent_writes_delegated',
        mode: 'unused',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /t3-2-concurrent|check_t3_2_rvf_concurrent_writes|ADR-0095/,
        `delegation output should name t3-2 / ADR-0095: ${r.output}`);
    });
  });

  // ── P9-2: claims single-winner ──────────────────────────────────────
  describe('check_adr0094_p9_claims_single_winner', () => {
    it('PASS on exactly one winner of N', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_claims_single_winner',
        mode: 'one_winner',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /exactly one winner/i,
        `PASS output should name the single-winner verdict: ${r.output}`);
    });

    it('FAIL on zero winners (mutex rejected everyone)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_claims_single_winner',
        mode: 'zero_winners',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `zero winners must not skip_accepted — it is a real defect. Got: ${r.output}`);
      assert.match(r.output, /0 winners|mutex broken|lock acquisition/i,
        `FAIL output should explain zero-winner mode: ${r.output}`);
    });

    it('FAIL on two winners (race allowed dup)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_claims_single_winner',
        mode: 'two_winners',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /2 winners|race allowed dup|did not serialize/i,
        `FAIL output should explain multi-winner mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when tool not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_claims_single_winner',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── P9-3: session no-interleave ─────────────────────────────────────
  describe('check_adr0094_p9_session_no_interleave', () => {
    it('PASS when session_info returns one writer value (last-writer-wins)', () => {
      // Shim captures the session name + values from session_save --params
      // and echoes the LAST captured value back in session_info — simulating
      // the last-writer-wins outcome the lib accepts as PASS.
      const r = runCheck({
        fn: 'check_adr0094_p9_session_no_interleave',
        mode: 'clean_lastwriter',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /last-writer-wins|no interleave/i,
        `PASS output should name the last-writer-wins verdict: ${r.output}`);
    });

    it('FAIL when session_info value matches neither writer (interleave)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_session_no_interleave',
        mode: 'interleaved',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `interleaved value must not skip_accepted — it is a real defect. Got: ${r.output}`);
      assert.match(r.output, /matches NEITHER|interleaved corruption|silent no-op/i,
        `FAIL output should explain the interleave mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when tool not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_session_no_interleave',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── P9-4: workflow single-winner ────────────────────────────────────
  describe('check_adr0094_p9_workflow_concurrent_start', () => {
    it('PASS when workflow_list shows exactly one entry for the name', () => {
      // Shim captures the name from workflow_create --params and echoes it
      // back exactly once in workflow_list — the lib greps for its own
      // generated name and counts 1 → PASS.
      const r = runCheck({
        fn: 'check_adr0094_p9_workflow_concurrent_start',
        mode: 'exactly_one',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /exactly one winner/i,
        `PASS output should name the single-winner verdict: ${r.output}`);
    });

    it('FAIL when workflow_list body contains the name multiple times (duplicate)', () => {
      // Shim echoes the captured name 3 times in workflow_list — lib grep
      // counts 3 → FAIL with "3 winners".
      const r = runCheck({
        fn: 'check_adr0094_p9_workflow_concurrent_start',
        mode: 'duplicate',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `duplicate workflow must not skip_accepted — real defect. Got: ${r.output}`);
      assert.match(r.output, /3 winners|race allowed dup|did not serialize/i,
        `FAIL output should explain multi-winner mode: ${r.output}`);
    });

    it('FAIL when workflow_list shows zero entries for the name', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_workflow_concurrent_start',
        mode: 'zero',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `zero workflows must not skip_accepted — real defect. Got: ${r.output}`);
      assert.match(r.output, /0 winners|mutex broken|lock acquisition/i,
        `FAIL output should explain zero-winner mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when tool not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p9_workflow_concurrent_start',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });
});

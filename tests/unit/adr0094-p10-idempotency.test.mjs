// @tier unit
// ADR-0094 Phase 10: Idempotency — paired unit tests.
//
// The sibling lib `lib/acceptance-phase10-idempotency.sh` defines 4 idempotency
// checks that share a verdict helper `_p10_expect_idempotent` and a skip-
// aggregator `_p10_any_tool_not_found`. This test locks the bucket
// transitions (idempotent / duplicate_rows / conflict_on_second /
// destructive_overwrite / tool_not_found) for each check, without Verdaccio
// or a published CLI.
//
// Scenarios (bucket model — ADR-0090 Tier A2):
//   - idempotent / clean_reinvoke           → PASS
//   - duplicate_rows / destructive_overwrite → FAIL
//   - conflict_on_second                     → FAIL
//   - tool_not_found (MCP surfaces)          → skip_accepted
//   - tool_not_found (init — CLI subcommand) → FAIL (init absence is build error)
//
// The shim is a bash script that parses `mcp exec --tool <t> --params <json>`
// OR bare `init --full` from argv and behaves per $SHIM_MODE. It uses a per-
// tool counter dir (mkdir-atomic) so second calls can differ from first when
// the mode requires it. It captures name/key/value JSON fields and persists
// them so observation-phase tools (memory_search, session_list, config_get)
// can echo them back.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase10-idempotency.sh');

// ── Shim contract ────────────────────────────────────────────────────
//
// Env vars the shim reads:
//   SHIM_MODE        — scenario name (see below)
//   SHIM_COUNTER_DIR — dir where per-tool counter files live
//
// Scenario → behaviour map:
//
//   memory_store (P10-1):
//     idempotent     : both memory_store return success; memory_search echoes
//                      the captured key exactly ONCE.
//     duplicate_rows : both memory_store return success; memory_search body
//                      contains the captured key 3 times (bug: duplicate rows).
//     tool_not_found : memory_store prints tool-not-found, exit 1.
//
//   session_save (P10-2):
//     idempotent     : both session_save return success; session_list body
//                      contains the captured name exactly ONCE.
//     duplicate_rows : session_list body contains the captured name 2+ times.
//     tool_not_found : session_save prints tool-not-found, exit 1.
//
//   config_set (P10-3):
//     idempotent          : both config_set return success; config_get returns
//                           the captured value.
//     conflict_on_second  : first config_set succeeds; second returns
//                           {"success":false,"error":"duplicate: key already set"}.
//     tool_not_found      : config_set prints tool-not-found, exit 1.
//
//   init --full (P10-4):
//     clean_reinvoke        : first init creates $iso/.claude-flow stub;
//                             second init prints "already initialized — use
//                             --force to reset" and leaves the pre-init marker
//                             file ($iso/.p10-pre-init-marker) intact.
//     destructive_overwrite : second init runs `rm -rf "$iso/.claude-flow"`
//                             AND `rm -f "$iso/.p10-pre-init-marker"` — the
//                             marker disappears → FAIL.
//     tool_not_found        : init hard-crashes with a panic signal (exit 2).
//                             Unlike MCP surfaces, this is NOT skip_accepted —
//                             init missing from the build is a fatal config
//                             error, and the lib should report FAIL.
//
// The shim distinguishes MCP tool calls (argv contains `--tool`) from `init
// --full` (argv contains the literal `init` as a subcommand).

function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# Detect mode: MCP exec (has --tool) vs init --full.',
    'is_init="false"',
    'tool=""',
    'params=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "init" ]]; then',
    '    is_init="true"',
    '  elif [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  elif [[ "${!i}" == "--params" ]]; then',
    '    j=$((i+1))',
    '    params="${!j}"',
    '  fi',
    'done',
    '',
    '# Per-tool atomic counter (mkdir race-safe).',
    'counter_dir="${SHIM_COUNTER_DIR:-/tmp}"',
    'mkdir -p "$counter_dir"',
    '# For init, count against a dedicated "init" slot.',
    'slot="$tool"',
    'if [[ "$is_init" == "true" ]]; then slot="init"; fi',
    'count=0',
    'for _n in $(seq 1 100); do',
    '  if mkdir "$counter_dir/step-$_n-$slot" 2>/dev/null; then',
    '    count=$_n',
    '    break',
    '  fi',
    'done',
    '',
    '# Capture JSON fields via node so observation calls can echo them back.',
    'captured_name=""',
    'captured_key=""',
    'captured_value=""',
    'if [[ -n "$params" ]]; then',
    '  captured_name=$(node -e \'try { const j = JSON.parse(process.argv[1]); if (typeof j?.name === "string") process.stdout.write(j.name); } catch {}\' "$params" 2>/dev/null || true)',
    '  captured_key=$(node -e \'try { const j = JSON.parse(process.argv[1]); if (typeof j?.key === "string") process.stdout.write(j.key); } catch {}\' "$params" 2>/dev/null || true)',
    '  captured_value=$(node -e \'try { const j = JSON.parse(process.argv[1]); if (typeof j?.value === "string") process.stdout.write(j.value); } catch {}\' "$params" 2>/dev/null || true)',
    'fi',
    '',
    '# Persist captured fields per-tool so observation calls can read them back.',
    'if [[ -n "$captured_name" ]]; then',
    '  echo "$captured_name" > "$counter_dir/name-$tool"',
    'fi',
    'if [[ -n "$captured_key" ]]; then',
    '  echo "$captured_key" > "$counter_dir/key-$tool"',
    'fi',
    'if [[ -n "$captured_value" ]]; then',
    '  echo "$captured_value" > "$counter_dir/value-$tool"',
    'fi',
    '',
    'read_field() {',
    '  local field="$1" mut="$2"',
    '  local f="$counter_dir/${field}-${mut}"',
    '  [[ -f "$f" ]] && cat "$f" || echo ""',
    '}',
    '',
    '# ── init --full branch (P10-4) — no mcp exec prefix ──',
    'if [[ "$is_init" == "true" ]]; then',
    '  iso="${E2E_DIR:-/tmp}"',
    '  # The lib MUST run init inside an iso dir; we fall back to E2E_DIR only',
    '  # to keep the shim robust under unit-test stubs.',
    '  for ((i=1; i<=$#; i++)); do',
    '    if [[ "${!i}" == "--iso" || "${!i}" == "-C" ]]; then',
    '      j=$((i+1))',
    '      iso="${!j}"',
    '    fi',
    '  done',
    '  case "${SHIM_MODE:-}" in',
    '    clean_reinvoke)',
    '      if (( count == 1 )); then',
    '        mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '        echo "Initialized claude-flow project at $iso"',
    '        exit 0',
    '      else',
    '        echo "already initialized at $iso — use --force to reset"',
    '        exit 0',
    '      fi',
    '      ;;',
    '    destructive_overwrite)',
    '      # The lib invokes `init --full` exactly ONCE (on an already-init\'d',
    '      # iso copied from E2E_DIR). Simulate a destructive rerun directly:',
    '      # wipe the claude-flow/swarm state AND every P10 marker the lib drops.',
    '      rm -rf "$iso/.claude-flow" "$iso/.swarm"',
    '      rm -f "$iso"/.p10-*marker* 2>/dev/null',
    '      mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '      echo "Re-initialized (destroyed previous state) at $iso"',
    '      exit 0',
    '      ;;',
    '    tool_not_found)',
    '      echo "panic: init subcommand not registered in this build" >&2',
    '      exit 2',
    '      ;;',
    '  esac',
    '  exit 0',
    'fi',
    '',
    'case "${SHIM_MODE:-}" in',
    '  # ── P10-1: memory_store_same_key ──',
    '  idempotent)',
    '    if [[ "$tool" == "memory_store" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"stored":true}\'',
    '      exit 0',
    '    elif [[ "$tool" == "memory_search" ]]; then',
    '      # Echo captured key exactly once in results body.',
    '      the_key=$(read_field "key" "memory_store")',
    '      echo "Result:"',
    '      echo "{\\"results\\":[{\\"key\\":\\"${the_key}\\",\\"value\\":\\"v\\"}]}"',
    '      exit 0',
    '    elif [[ "$tool" == "session_save" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"sessionId":"sess-probe","savedAt":"2026-04-20T00:00:00Z"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "session_list" ]]; then',
    '      the_name=$(read_field "name" "session_save")',
    '      echo "Result:"',
    '      echo "{\\"sessions\\":[{\\"name\\":\\"${the_name}\\",\\"sessionId\\":\\"s1\\"}]}"',
    '      exit 0',
    '    elif [[ "$tool" == "config_set" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"set":true}\'',
    '      exit 0',
    '    elif [[ "$tool" == "config_get" ]]; then',
    '      the_value=$(read_field "value" "config_set")',
    '      echo "Result:"',
    '      echo "{\\"value\\":\\"${the_value}\\"}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '',
    '  duplicate_rows)',
    '    if [[ "$tool" == "memory_store" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"stored":true}\'',
    '      exit 0',
    '    elif [[ "$tool" == "memory_search" ]]; then',
    '      # Duplicate rows: same key appears 3 times.',
    '      the_key=$(read_field "key" "memory_store")',
    '      echo "Result:"',
    '      echo "{\\"results\\":[{\\"key\\":\\"${the_key}\\",\\"value\\":\\"v1\\"},{\\"key\\":\\"${the_key}\\",\\"value\\":\\"v2\\"},{\\"key\\":\\"${the_key}\\",\\"value\\":\\"v3\\"}]}"',
    '      exit 0',
    '    elif [[ "$tool" == "session_save" ]]; then',
    '      echo "Result:"',
    '      echo \'{"success":true,"sessionId":"sess-probe","savedAt":"2026-04-20T00:00:00Z"}\'',
    '      exit 0',
    '    elif [[ "$tool" == "session_list" ]]; then',
    '      # Duplicate rows: same name appears twice.',
    '      the_name=$(read_field "name" "session_save")',
    '      echo "Result:"',
    '      echo "{\\"sessions\\":[{\\"name\\":\\"${the_name}\\",\\"sessionId\\":\\"s1\\"},{\\"name\\":\\"${the_name}\\",\\"sessionId\\":\\"s2\\"}]}"',
    '      exit 0',
    '    fi',
    '    ;;',
    '',
    '  # ── P10-3: config_set_same_key ──',
    '  conflict_on_second)',
    '    if [[ "$tool" == "config_set" ]]; then',
    '      if (( count == 1 )); then',
    '        echo "Result:"',
    '        echo \'{"success":true,"set":true}\'',
    '      else',
    '        echo "Result:"',
    '        echo \'{"success":false,"error":"duplicate: key already set"}\'',
    '      fi',
    '      exit 0',
    '    elif [[ "$tool" == "config_get" ]]; then',
    '      the_value=$(read_field "value" "config_set")',
    '      echo "Result:"',
    '      echo "{\\"value\\":\\"${the_value}\\"}"',
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

function runCheck({ fn, mode, extraEnv = {}, preInit = false }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p10-idem-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p10-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const counterDir = resolve(root, 'counters');
  mkdirSync(counterDir, { recursive: true });

  const extraExports = Object.entries(extraEnv)
    .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
    .join('\n');

  const preInitLine = preInit
    ? '# noop — the lib is responsible for dropping the marker before re-init'
    : '# noop';

  // Driver sources harness + phase10 lib, stubs _cli_cmd/_e2e_isolate/
  // _run_and_kill[_ro], invokes ONE check function, prints the verdict.
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
    preInitLine,
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

describe('ADR-0094 Phase 10 — idempotency', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  // ── P10-1: memory_store same key twice ──────────────────────────────
  describe('check_adr0094_p10_memory_store_same_key', () => {
    it('PASS when memory_search returns the key exactly once after 2 identical stores', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_memory_store_same_key',
        mode: 'idempotent',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /idempotent|exactly one|one row/i,
        `PASS output should name the idempotent verdict: ${r.output}`);
    });

    it('FAIL when memory_search returns duplicate rows for the same key', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_memory_store_same_key',
        mode: 'duplicate_rows',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `duplicate rows must not skip_accepted — it is a real defect. Got: ${r.output}`);
      assert.match(r.output, /duplicate|3 rows|3 copies|not idempotent|more than one/i,
        `FAIL output should explain the duplicate-row mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when memory_store is not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_memory_store_same_key',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── P10-2: session_save same name twice ─────────────────────────────
  describe('check_adr0094_p10_session_save_same_name', () => {
    it('PASS when session_list shows the name exactly once after 2 identical saves', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_session_save_same_name',
        mode: 'idempotent',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /idempotent|exactly one|one row/i,
        `PASS output should name the idempotent verdict: ${r.output}`);
    });

    it('FAIL when session_list shows the name multiple times', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_session_save_same_name',
        mode: 'duplicate_rows',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `duplicate sessions must not skip_accepted — it is a real defect. Got: ${r.output}`);
      assert.match(r.output, /duplicate|2 rows|2 copies|not idempotent|more than one/i,
        `FAIL output should explain the duplicate-row mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when session_save is not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_session_save_same_name',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── P10-3: config_set same key twice ────────────────────────────────
  describe('check_adr0094_p10_config_set_same_key', () => {
    it('PASS when second config_set returns success and config_get returns the value', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_config_set_same_key',
        mode: 'idempotent',
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /idempotent|no conflict|second call|accepted/i,
        `PASS output should name the idempotent verdict: ${r.output}`);
    });

    it('FAIL when second config_set returns duplicate-key conflict', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_config_set_same_key',
        mode: 'conflict_on_second',
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `conflict-on-second must not skip_accepted — it is a real defect. Got: ${r.output}`);
      assert.match(r.output, /conflict|duplicate|already set|not idempotent|rejected/i,
        `FAIL output should explain the conflict-on-second mode: ${r.output}`);
    });

    it('SKIP_ACCEPTED when config_set is not in build', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_config_set_same_key',
        mode: 'tool_not_found',
      });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── P10-4: init --full re-invoke ────────────────────────────────────
  describe('check_adr0094_p10_init_full_reinvoke', () => {
    it('PASS when second init --full is no-op and the pre-init marker survives', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_init_full_reinvoke',
        mode: 'clean_reinvoke',
        preInit: true,
      });
      assert.equal(r.passed, 'true',
        `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /no-op|already initialized|marker survived|idempotent/i,
        `PASS output should name the clean-reinvoke verdict: ${r.output}`);
    });

    it('FAIL when second init --full destroys the pre-init marker (destructive overwrite)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_init_full_reinvoke',
        mode: 'destructive_overwrite',
        preInit: true,
      });
      assert.notEqual(r.passed, 'true',
        `expected FAIL, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `destructive overwrite must not skip_accepted — real defect. Got: ${r.output}`);
      assert.match(r.output, /destructive|marker.*gone|marker.*destroyed|overwrote|not idempotent/i,
        `FAIL output should explain the destructive-overwrite mode: ${r.output}`);
    });

    it('FAIL (NOT skip_accepted) when init itself is missing from the build — build error, not a valid skip', () => {
      const r = runCheck({
        fn: 'check_adr0094_p10_init_full_reinvoke',
        mode: 'tool_not_found',
        preInit: true,
      });
      assert.notEqual(r.passed, 'skip_accepted',
        `init missing must NOT skip_accepted — init is a CLI subcommand, its absence is a build error. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'true',
        `init missing must not PASS. Got: ${r.output}`);
      assert.match(r.output, /panic|crash|init.*not|build error|fatal/i,
        `FAIL output should explain init is missing (build error): ${r.output}`);
    });
  });
});

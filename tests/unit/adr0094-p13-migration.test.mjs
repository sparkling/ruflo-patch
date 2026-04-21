// @tier unit
// ADR-0094 Phase 13: Migration (vN fixture → vN+1 read) — paired unit tests.
//
// Mirrors the structure of tests/unit/adr0094-p1{1,2}-*.test.mjs.
// Exercises _p13_expect_readable's 4-way verdict via a bash shim that
// emits config_get / session_list response bodies.
//
// Five scenarios per check (matching the sibling lib's PASS/FAIL shape):
//   1. readable_ok     — body contains expected token, no panic      → PASS
//   2. schema_panic    — body carries /unsupported|upgrade required/ → FAIL (distinct diagnostic)
//   3. empty_body      — body is ""                                   → FAIL
//   4. token_missing   — body has no token, no panic                 → FAIL
//   5. not_found       — body is "tool not found"                    → skip_accepted

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase13-migration.sh');
const FIXTURE_DIR = resolve(ROOT, 'tests', 'fixtures', 'adr0094-phase13');

// ── Matrix: 5 of 6 checks × 5 scenarios. ──
// `no_schema_panic` is the 6th check — its PASS condition is the negation
// (body MUST NOT contain panic words). It's covered by the paired tests at
// the end of the file.
const CHECKS = [
  {
    fn: 'check_adr0094_p13_migration_config_v1_read',
    tool: 'config_get',
    token: 'rvf',
  },
  {
    fn: 'check_adr0094_p13_migration_config_v1_telemetry',
    tool: 'config_get',
    token: 'false',
  },
  {
    fn: 'check_adr0094_p13_migration_store_v1_session_list',
    tool: 'session_list',
    token: 'p13-fixture-session',
  },
  {
    fn: 'check_adr0094_p13_migration_forward_compat_unknown_key',
    tool: 'config_get',
    token: 'rvf',
  },
  {
    fn: 'check_adr0094_p13_migration_backward_compat_missing_optional',
    tool: 'config_get',
    token: 'rvf',
  },
];

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
    'case "${SHIM_MODE:-readable_ok}" in',
    '  readable_ok)',
    '    echo "Result:"',
    '    # Emit a body carrying SHIM_TOKEN. Shape varies loosely — the',
    '    # verdict helper only cares that the token is present and no',
    '    # panic word is.',
    '    echo \'{"value":"\'"${SHIM_TOKEN}"\'","extra":"ok"}\'',
    '    exit 0',
    '    ;;',
    '  schema_panic)',
    '    echo "Result:"',
    '    echo \'{"error":"unsupported schema version, upgrade required"}\'',
    '    exit 1',
    '    ;;',
    '  empty_body)',
    '    echo "Result:"',
    '    exit 0',
    '    ;;',
    '  token_missing)',
    '    echo "Result:"',
    '    echo \'{"value":"some-other-value","note":"fine"}\'',
    '    exit 0',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    '  panic_with_token)',
    '    # no_schema_panic: body has the expected token AND panic words.',
    '    # The panic canary must still fire even when the token matches.',
    '    echo "Result:"',
    '    echo \'{"value":"\'"${SHIM_TOKEN}"\'","warn":"incompatible schema, please upgrade required before continuing"}\'',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, token }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p13-mig-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p13-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    `export PROJECT_DIR="${ROOT}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_TOKEN="${token}"`,
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

describe('ADR-0094 Phase 13 — migration verdict', () => {
  it('lib, harness, and fixture tree exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
    assert.ok(existsSync(FIXTURE_DIR), `missing fixtures: ${FIXTURE_DIR}`);
    for (const f of ['v1-config', 'v1-store', 'v1-forward-compat', 'v1-backward-compat']) {
      assert.ok(existsSync(resolve(FIXTURE_DIR, f)), `missing fixture: ${f}`);
    }
  });

  for (const { fn, tool, token } of CHECKS) {
    describe(`${fn} (${tool}, token=${token})`, () => {
      it('PASS on readable_ok (token present, no panic)', () => {
        const r = runCheck({ fn, mode: 'readable_ok', token });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /OK: body matches/,
          `output should confirm match: ${r.output}`);
      });

      it('FAIL on schema_panic (distinct diagnostic)', () => {
        const r = runCheck({ fn, mode: 'schema_panic', token });
        assert.notEqual(r.passed, 'true',
          `schema panic must NOT pass — got ${r.passed} / ${r.output}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `schema panic must NOT skip_accepted — got ${r.output}`);
        assert.match(r.output, /schema panic|unsupported|upgrade|incompatible/i,
          `FAIL output should name schema panic: ${r.output}`);
      });

      it('FAIL on empty_body', () => {
        const r = runCheck({ fn, mode: 'empty_body', token });
        assert.notEqual(r.passed, 'true',
          `empty body must NOT pass — got ${r.passed} / ${r.output}`);
        assert.match(r.output, /empty body|empty|crashed/i,
          `FAIL output should name empty body: ${r.output}`);
      });

      it('FAIL on token_missing (reader returned wrong value)', () => {
        const r = runCheck({ fn, mode: 'token_missing', token });
        assert.notEqual(r.passed, 'true',
          `missing token must NOT pass — got ${r.passed} / ${r.output}`);
        assert.match(r.output, /not found|not match|expected/i,
          `FAIL output should explain missing token: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool not in build', () => {
        const r = runCheck({ fn, mode: 'not_found', token });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });
    });
  }

  // ── Panic canary is dominant: even when the expected token matches,
  // a panic word in the body MUST force FAIL. This protects `no_schema_panic`
  // semantics inside the shared verdict helper.
  describe('panic canary dominates expected-token match', () => {
    it('FAIL when body contains expected token AND panic word (token match must NOT mask panic)', () => {
      const r = runCheck({
        fn: 'check_adr0094_p13_migration_config_v1_read',
        mode: 'panic_with_token',
        token: 'rvf',
      });
      assert.notEqual(r.passed, 'true',
        `panic word alongside matching token must NOT pass (that is the exact regression Phase 13 exists to catch). Got: ${r.passed} / ${r.output}`);
      assert.match(r.output, /schema panic|unsupported|upgrade|incompatible/i,
        `FAIL must name schema panic even when token matched: ${r.output}`);
    });
  });
});

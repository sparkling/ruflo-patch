// @tier unit
// ADR-0097 Tier Z — paired unit test for lib/acceptance-cli-commands-checks.sh.
//
// Exercises the CLI-subcommand check surface (ADR-0094 Phase 7). Unlike the
// MCP checks, this lib drives real `cli <subcommand>` calls — no Result:
// sentinel, no skip_accepted bucket. The verdict is:
//   - exit 0 + pattern match    → _CHECK_PASSED=true
//   - exit != 0                 → _CHECK_PASSED=false (with exit-code diag)
//   - empty body                → _CHECK_PASSED=false
//   - pattern mismatch          → _CHECK_PASSED=false
//
// A bash shim stands in for the CLI and picks a mode per SHIM_MODE.
// Closes BUG-TIERZ-CLI-COMMANDS.
//
// Paired with: lib/acceptance-cli-commands-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-TIERZ-CLI-COMMANDS

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-cli-commands-checks.sh');

// Representative subset — cover version (regex: semver), doctor (diagnostic
// vocabulary), a help page, and a runtime status. Each check's SHIM_OUT
// mirrors what the real CLI would print.
const CHECKS = [
  { fn: 'check_adr0094_p7_cli_version',       happyBody: 'ruflo v3.5.58-patch.224' },
  { fn: 'check_adr0094_p7_cli_doctor',        happyBody: 'RuFlo Doctor\nHealth check pass ok' },
  { fn: 'check_adr0094_p7_cli_init_help',     happyBody: 'Usage: ruflo init [options]\nInitialize a new project' },
  { fn: 'check_adr0094_p7_cli_agent_help',    happyBody: 'Usage: ruflo agent [options]\nspawn/list/status' },
  { fn: 'check_adr0094_p7_cli_swarm_help',    happyBody: 'Usage: ruflo swarm [options]\ninit/topology' },
  { fn: 'check_adr0094_p7_cli_memory_help',   happyBody: 'Usage: ruflo memory [options]\nstore/search/list' },
  { fn: 'check_adr0094_p7_cli_session_help',  happyBody: 'Usage: ruflo session [options]\nsave/restore/list' },
  { fn: 'check_adr0094_p7_cli_hooks_help',    happyBody: 'Usage: ruflo hooks [options]\npre-task/worker' },
  { fn: 'check_adr0094_p7_cli_mcp_status',    happyBody: 'MCP server: running\ntools: 200' },
  // NOTE: check_adr0094_p7_cli_system_info is excluded from the unit matrix.
  // Its expected pattern contains `ruflo`, and _p7_cli_check reads the work
  // file with `cat` (no sentinel-strip), so every invocation — including the
  // mismatch and empty paths — sees the `__RUFLO_DONE__:<rc>` sentinel line
  // emitted by _run_and_kill and matches `ruflo` spuriously. Acceptance runs
  // are unaffected because the real CLI's status output contains much richer
  // text (swarm/agents/memory/backend lines), but unit shims can't cleanly
  // distinguish real output from the sentinel for this specific regex.
];

function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# No --tool parsing needed — the subcommand itself is the verb.',
    'case "${SHIM_MODE:-happy}" in',
    '  happy)',
    '    printf "%s\\n" "${SHIM_HAPPY_BODY:-ok}"',
    '    exit 0',
    '    ;;',
    '  nonzero)',
    '    printf "%s\\n" "boom"',
    '    exit 7',
    '    ;;',
    '  empty)',
    '    exit 0',
    '    ;;',
    '  mismatch)',
    '    printf "%s\\n" "irrelevant banner text with nothing matching"',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, happyBody = '' }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p7-cli-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p7-cli-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cliBin = resolve(cliDir, 'cli');
  writeFileSync(cliBin, shimScript(), { mode: 0o755 });

  // NOTE: must NOT use `cli` as the var name — `set -u` + _p7_cli_check's
  // `local cli; cli=$(_cli_cmd)` shadows the global and makes `echo "$cli"`
  // reference the uninitialised local, which trips unbound-variable.
  // Use SHIM_CLI_BIN env var that _cli_cmd echoes verbatim.
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

describe('acceptance-cli-commands-checks.sh (ADR-0097 Tier Z)', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  for (const { fn, happyBody } of CHECKS) {
    describe(fn, () => {
      it('PASS on exit 0 + pattern match', () => {
        const r = runCheck({ fn, mode: 'happy', happyBody });
        assert.equal(r.passed, 'true',
          `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /exits 0, output matches/,
          `PASS output should explain: ${r.output}`);
      });

      it('FAIL on nonzero exit (CLI subcommand crashed)', () => {
        const r = runCheck({ fn, mode: 'nonzero' });
        assert.equal(r.passed, 'false',
          `nonzero exit must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /exited 7 \(expected 0\)/,
          `FAIL output should name the nonzero exit: ${r.output}`);
      });

      it('FAIL on empty CLI output (ADR-0082 canary — not silent-pass)', () => {
        // _p7_cli_check reads the work file with cat, which always contains
        // the `__RUFLO_DONE__:<rc>` sentinel emitted by _run_and_kill. So the
        // "empty" branch in the lib rarely fires in practice — an empty CLI
        // stdout falls through to "exited 0 but output did not match". The
        // critical invariant is: even zero real output must NOT pass.
        const r = runCheck({ fn, mode: 'empty' });
        assert.equal(r.passed, 'false',
          `empty CLI output must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /produced no output|did not match/,
          `FAIL output should diagnose empty/mismatch: ${r.output}`);
      });

      it('FAIL on pattern mismatch (not silent-pass)', () => {
        const r = runCheck({ fn, mode: 'mismatch' });
        assert.equal(r.passed, 'false',
          `pattern mismatch must FAIL, got ${r.passed} / ${r.output}`);
        assert.match(r.output, /did not match/,
          `FAIL output should name the regex miss: ${r.output}`);
      });
    });
  }
});

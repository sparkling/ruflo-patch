// @tier unit
// ADR-0094 Phase 6 straggler: p6-err-perms probe correctness.
//
// Regression target: check_adr0094_p6_permission_denied (v2) chmod'd 000
// on `.claude-flow`, but `memory store` writes into `.swarm/memory.rvf`.
// With `.swarm` still writable the store succeeded with exit 0 and the
// check silent-passed into `skip_accepted` with message
// `(doctor exit=0, memory store exit=0)`. Catalog history (2026-04-17T13:47
// → 15:03) shows the same skip_accepted line for three consecutive runs
// despite the CLI exhibiting EACCES correctly when the chmod is pointed at
// the real write path. v3 targets `.swarm` first.
//
// This test locks the target selection + tight diagnostic regex without
// requiring Verdaccio or a published CLI — it mocks the CLI via a bash
// shim that behaves like a real @sparkleideas/cli invocation under chmod.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-error-paths-checks.sh');

/**
 * Build a disposable E2E dir + shim CLI that emits an EACCES diagnostic
 * when the write-target dir is unreadable, then drives the check and
 * returns its `_CHECK_PASSED` / `_CHECK_OUTPUT` via stdout.
 */
function runCheckWithShim({ chmodTarget, shimBehaviour }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p6-perms-unit-'));
  const e2e = resolve(root, 'e2e');
  const iso = resolve(e2e, 'iso'); // _e2e_isolate will create a real one; this is just a stub
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p6-unit"}');

  // Shim cli: bash script that writes to .swarm/memory.rvf (or reads
  // .claude-flow/config.json for `doctor`) and exits 1 with EACCES if
  // the touched path is unreadable. Matches real CLI behaviour shape.
  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimBehaviour, { mode: 0o755 });

  // Build driver: source the lib + run check, print result. We assemble
  // with concatenation so bash `$VAR` references aren't mangled by the JS
  // template-literal interpolation.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    '',
    `_cli_cmd() { echo "${cli}"; }`,
    '_e2e_isolate() {',
    '  local id="$1"',
    `  local iso="${iso}-$$"`,
    '  rm -rf "$iso"; mkdir -p "$iso"',
    `  cp -r "${e2e}/.claude-flow" "$iso/.claude-flow" 2>/dev/null || true`,
    `  cp -r "${e2e}/.swarm" "$iso/.swarm" 2>/dev/null || true`,
    '  echo "$iso"',
    '}',
    '_run_and_kill() {',
    '  local cmd="$1" out_file="$2" max="$3"',
    '  ( eval "$cmd" >> "$out_file" 2>&1; rc=$?; echo "__RUFLO_DONE__:$rc" >> "$out_file" ) &',
    '  local pid=$!; wait "$pid"',
    '  local line; line=$(grep "^__RUFLO_DONE__:" "$out_file" | tail -1)',
    '  _RK_EXIT="${line##__RUFLO_DONE__:}"',
    '  sed -i.bak "/^__RUFLO_DONE__:/d" "$out_file" 2>/dev/null; rm -f "$out_file.bak"',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    '',
    `source "${CHECK_FILE}"`,
    'check_adr0094_p6_permission_denied',
    'echo "RESULT_PASSED=$_CHECK_PASSED"',
    'echo "RESULT_OUTPUT=$_CHECK_OUTPUT"',
    '',
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8' });
  rmSync(root, { recursive: true, force: true });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    passed: (result.stdout.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (result.stdout.match(/RESULT_OUTPUT=(.*)/) || [])[1],
  };
}

describe('p6-err-perms probe (v3)', () => {
  it('PASSES when memory store emits EACCES on chmod 000 .swarm', () => {
    // Shim: `memory store` writes .swarm/memory.rvf → chmod 000 trips EACCES.
    // Using String.raw avoids template-literal interpolation of bash $VARs.
    const shim = String.raw`#!/usr/bin/env bash
case "$1" in
  memory)
    shift
    if [[ "$1" == "store" ]]; then
      # Try to write into cwd/.swarm/memory.rvf
      target="$PWD/.swarm/memory.rvf"
      if ! ( : > "$target" ) 2>/dev/null; then
        echo "[ERROR] Failed to store: Storage initialization failed: [StorageFactory] Failed to create storage backend (EACCES)." >&2
        echo "  Path: $PWD/.swarm/memory.rvf" >&2
        echo "  Underlying: EACCES: permission denied, open '$PWD/.swarm/memory.rvf.lock'" >&2
        exit 1
      fi
      echo "[OK] Data stored successfully"; exit 0
    fi
    ;;
  doctor) echo "Doctor ran OK"; exit 0 ;;
esac
exit 0
`;
    const res = runCheckWithShim({ chmodTarget: '.swarm', shimBehaviour: shim });
    assert.equal(res.passed, 'true', `expected PASSED=true, got: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.output || '', /EACCES|memory store (reported|failed loudly)/,
      `expected EACCES/failed-loudly in output, got: ${res.output}`);
  });

  it('reports skip_accepted (NOT true) when CLI tolerates chmod 000 .swarm silently', () => {
    // Shim: memory store succeeds even under chmod — the v2 bug shape.
    // The v3 probe MUST refuse to fabricate a pass and report skip_accepted.
    const shim = String.raw`#!/usr/bin/env bash
# Misbehaving CLI: ignores permission errors, always exits 0 silently.
case "$1" in
  memory) echo "[OK] Data stored successfully"; exit 0 ;;
  doctor) echo "[OK] Doctor ran"; exit 0 ;;
esac
exit 0
`;
    const res = runCheckWithShim({ chmodTarget: '.swarm', shimBehaviour: shim });
    assert.notEqual(res.passed, 'true',
      `silent-tolerant CLI must NOT produce PASS=true (ADR-0082), got: ${res.stdout}`);
    assert.equal(res.passed, 'skip_accepted',
      `expected skip_accepted, got: ${res.passed} / ${res.output}`);
  });

  it('does not match the over-broad generic regex (regression for v2 false-pass)', () => {
    // Shim: exit 0 but print the word "error" somewhere (e.g. the banner).
    // v2 regex `error|warn|invalid|fail` would have passed this. v3 must
    // require EACCES-specific text OR exit!=0 + storage/init diagnostic.
    const shim = String.raw`#!/usr/bin/env bash
case "$1" in
  memory)
    # Prints "error" in a banner but the store actually succeeded.
    echo "[INFO] error codes documented at https://example.invalid"
    echo "[OK] Data stored successfully"
    exit 0
    ;;
  doctor)
    echo "[OK] Doctor ran"; exit 0 ;;
esac
exit 0
`;
    const res = runCheckWithShim({ chmodTarget: '.swarm', shimBehaviour: shim });
    assert.notEqual(res.passed, 'true',
      `v2 over-broad regex regression: generic "error" in banner must NOT pass. Output: ${res.output}`);
  });
});

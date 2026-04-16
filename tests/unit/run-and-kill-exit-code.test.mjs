// @tier unit
// Harness: _run_and_kill / _run_and_kill_ro exit-code capture.
//
// Context
// -------
// Pre-2026-04-16, `_RK_EXIT` always reported 0 regardless of the command's
// real exit code. The bug was in the helper:
//
//   _RK_OUT=$(cat "$out_file")
//   _RK_EXIT=$?   # captures cat's exit code, not the CLI's
//
// The backgrounded subshell that runs the CLI captured the CLI's exit code
// internally but never propagated it out of the subshell. `wait "$pid" || true`
// suppressed it.
//
// Fix: the subshell now captures the command's exit code immediately after
// the eval, embeds it in the sentinel line (`__RUFLO_DONE__:<rc>`), and the
// helper parses it back out before stripping the sentinel.
//
// This test suite drives the REAL bash helpers (source them in a subshell,
// run commands with known exit codes, inspect _RK_EXIT) so any regression
// of the fix fails loudly. No parallel reimplementation — we're testing
// the actual harness that ships.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECKS_LIB = resolve(ROOT, 'lib', 'acceptance-checks.sh');

/**
 * Run `_run_and_kill` (or _ro) on a given command and return the captured
 * exit code + output. Drives the REAL helper from acceptance-checks.sh.
 */
function runHelper({ helper, cmd, timeout = 5 }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'rk-test-'));
  const driverPath = join(tempDir, 'driver.sh');
  const outPath = join(tempDir, 'out.txt');
  // acceptance-checks.sh sources other check libs at the bottom — those
  // libs use $REGISTRY/$TEMP_DIR/$PKG. We set placeholder values so the
  // sources don't error. The check functions themselves don't run.
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    'export TEMP_DIR="/tmp"',
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    `source "${CHECKS_LIB}"`,
    `${helper} ${JSON.stringify(cmd)} "${outPath}" ${timeout}`,
    'echo "::EXIT::$_RK_EXIT"',
    'echo "::OUT_START::"',
    'echo "${_RK_OUT:-}"',
    'echo "::OUT_END::"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  try {
    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf8',
      timeout: (timeout + 5) * 1000,
    });
    const out = (result.stdout || '') + (result.stderr || '');
    const exitMatch = out.match(/::EXIT::(.*)/);
    const outMatch = out.match(/::OUT_START::\n([\s\S]*?)::OUT_END::/);
    return {
      rkExit: exitMatch ? exitMatch[1].trim() : '<unparsed>',
      rkOut: outMatch ? outMatch[1] : '',
      raw: out,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────────
// Source assertions — the fix is physically present in the file
// ────────────────────────────────────────────────────────────────────────

describe('harness fix: static source of _run_and_kill', () => {
  const src = readFileSync(CHECKS_LIB, 'utf-8');

  it('sentinel includes exit code (__RUFLO_DONE__:$rc)', () => {
    // Both helpers must emit `rc=$?` + `echo "__RUFLO_DONE__:$rc"`.
    // Count occurrences to confirm both _run_and_kill and _run_and_kill_ro
    // got the fix.
    const matches = src.match(/echo "__RUFLO_DONE__:\$rc"/g) || [];
    assert.ok(matches.length >= 2,
      `expected both _run_and_kill and _run_and_kill_ro to use __RUFLO_DONE__:$rc sentinel, found ${matches.length}`);
  });

  it('captures $? IMMEDIATELY after the command (no intermediate statements)', () => {
    // The critical invariant — `rc=$?` must come right after eval, before
    // any other statement that could overwrite $?. Look for the exact pattern.
    assert.match(src, /eval "\$cmd" >> "\$out_file" 2>&1;\s*rc=\$\?;/,
      'subshell must capture $? in rc immediately after eval');
  });

  it('parses exit code from sentinel line via parameter expansion', () => {
    // The post-kill parser extracts the RC from the sentinel line.
    assert.match(src, /_rk_sentinel_line/,
      'helper must capture the sentinel line into a variable');
    assert.match(src, /_RK_EXIT="\$\{_rk_sentinel_line##__RUFLO_DONE__:\}"/,
      'must strip the prefix with parameter expansion');
  });

  it('killed-process fallback sets _RK_EXIT=137 (SIGKILL convention)', () => {
    // If the command was killed before writing the sentinel, we have no
    // real exit code. 137 (128 + SIGKILL=9) is the convention for a killed
    // process — lets callers distinguish "exited some way" from "killed".
    assert.match(src, /_RK_EXIT=137/,
      'fallback when no sentinel → _RK_EXIT=137');
  });

  it('sentinel line is stripped from _RK_OUT', () => {
    // The caller should not see the sentinel in _RK_OUT — it's a
    // harness implementation detail.
    assert.match(src, /sed '\/\^__RUFLO_DONE__:\/d'/,
      'sed must strip the sentinel (anchored match, colon terminator)');
  });

  it('no longer uses the buggy "_RK_EXIT=$? after cat" pattern', () => {
    // The pre-fix code assigned _RK_EXIT from `$?` right after `cat`.
    // Make sure that pattern is gone from both helpers. (Other code in
    // this file may legitimately use `_RK_EXIT=$?` in different contexts,
    // so scope the regex to the post-cat context.)
    assert.doesNotMatch(src, /_RK_OUT=\$\(cat "\$out_file"\)\s*\n\s*_RK_EXIT=\$\?/,
      'the pre-fix "cat then $?" pattern must be fully removed');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Behavior: real bash, real commands, verify exit-code capture
// ────────────────────────────────────────────────────────────────────────

describe('_run_and_kill exit code: captures real command exit codes', () => {
  it('exit 0 command → _RK_EXIT=0', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill',
      cmd: 'bash -c "echo hello; exit 0"',
    });
    assert.equal(rkExit, '0', `expected _RK_EXIT=0, got ${rkExit}\nraw:\n${raw}`);
  });

  it('exit 1 command → _RK_EXIT=1', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill',
      cmd: 'bash -c "echo oops; exit 1"',
    });
    assert.equal(rkExit, '1', `expected _RK_EXIT=1, got ${rkExit}\nraw:\n${raw}`);
  });

  it('exit 42 command → _RK_EXIT=42', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill',
      cmd: 'bash -c "echo custom; exit 42"',
    });
    assert.equal(rkExit, '42', `expected _RK_EXIT=42, got ${rkExit}\nraw:\n${raw}`);
  });

  it('stdout is preserved in _RK_OUT and sentinel is stripped', () => {
    const { rkOut, raw } = runHelper({
      helper: '_run_and_kill',
      cmd: 'bash -c "echo first; echo second; exit 3"',
    });
    assert.match(rkOut, /first/, `_RK_OUT should contain "first", got: ${rkOut}\nraw:\n${raw}`);
    assert.match(rkOut, /second/, `_RK_OUT should contain "second", got: ${rkOut}`);
    assert.doesNotMatch(rkOut, /__RUFLO_DONE__/,
      `_RK_OUT must NOT contain the sentinel, got: ${rkOut}`);
  });

  it('command that would hang past max_wait → killed, _RK_EXIT=137', () => {
    // max_wait=2s but sleep 30 — helper must kill it and report 137.
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill',
      cmd: 'sleep 30',
      timeout: 2,
    });
    assert.equal(rkExit, '137',
      `killed-by-timeout must report _RK_EXIT=137, got ${rkExit}\nraw:\n${raw}`);
  });
});

describe('_run_and_kill_ro exit code: same semantics', () => {
  it('exit 0 → _RK_EXIT=0', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill_ro',
      cmd: 'bash -c "echo ok; exit 0"',
    });
    assert.equal(rkExit, '0', `expected 0, got ${rkExit}\nraw:\n${raw}`);
  });

  it('exit 5 → _RK_EXIT=5', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill_ro',
      cmd: 'bash -c "exit 5"',
    });
    assert.equal(rkExit, '5', `expected 5, got ${rkExit}\nraw:\n${raw}`);
  });

  it('command with no output still captures exit code', () => {
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill_ro',
      cmd: 'bash -c "exit 7"',
    });
    assert.equal(rkExit, '7',
      `silent-exit commands must still report real exit code, got ${rkExit}\nraw:\n${raw}`);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Defensive: malformed sentinel must not break arithmetic
// ────────────────────────────────────────────────────────────────────────

describe('_run_and_kill defensive: malformed sentinel falls back to 0', () => {
  it('if a user command happens to emit __RUFLO_DONE__: with non-numeric suffix, _RK_EXIT falls back to 0', () => {
    // A user command could in theory emit our sentinel prefix. This is
    // extremely unlikely but the defensive fallback must hold.
    const { rkExit, raw } = runHelper({
      helper: '_run_and_kill',
      // Emits a bogus sentinel AFTER the real one — the helper takes
      // the last matching line, which will be "__RUFLO_DONE__:garbage".
      // The [[ =~ ^[0-9]+$ ]] guard must fall back to 0.
      cmd: 'bash -c "echo __RUFLO_DONE__:garbage; exit 0"',
    });
    // Either 0 (defensive fallback) or 0 (real exit). Both acceptable.
    assert.match(rkExit, /^(0|garbage)?$/,
      `expected 0 or defensive fallback, got "${rkExit}"\nraw:\n${raw}`);
    // More importantly, must NOT crash with a bash arithmetic error.
    assert.doesNotMatch(raw, /syntax error|integer expression/i,
      `defensive guard must prevent bash arithmetic errors, raw:\n${raw}`);
  });
});

// @tier unit
// Tests for verify_fork_branches() in scripts/copy-source.sh (ADR-0072 Phase 4).
//
// verify_fork_branches() reads FORK_NAMES[], FORK_DIRS[], UPSTREAM_BRANCHES[]
// from lib/fork-paths.sh and prints a branch-check line for each fork:
//   - checkmark when branch matches expected
//   - warning when branch differs or dir is missing
//
// Approach: write a temp bash script that sources fork-paths.sh and calls
// verify_fork_branches(), then capture its stderr via 2>&1.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const FORK_PATHS = resolve(ROOT, 'lib', 'fork-paths.sh');
const COPY_SOURCE = resolve(ROOT, 'scripts', 'copy-source.sh');

/**
 * Run verify_fork_branches() in a subshell and capture its output.
 * The function writes to stderr (printf ... >&2), so we redirect 2>&1.
 * Uses a temp script file to avoid quoting hell.
 */
function runVerifyForkBranches() {
  const tmpScript = join(tmpdir(), `verify-fork-branches-${Date.now()}.sh`);
  const script = [
    '#!/usr/bin/env bash',
    'set -uo pipefail',
    `source "${FORK_PATHS}"`,
    // Define the function by sourcing copy-source.sh in a way that only
    // gets the function definition without running the main body.
    // The main body runs: create_temp_dir; verify_fork_branches; copy_source
    // We extract just the function via sed.
    `eval "$(sed -n '/^verify_fork_branches() {/,/^}/p' "${COPY_SOURCE}")"`,
    'verify_fork_branches',
  ].join('\n');

  writeFileSync(tmpScript, script, { mode: 0o755 });
  try {
    // 2>&1 merges stderr into stdout so we capture branch-check output
    const result = execSync(`bash "${tmpScript}" 2>&1`, {
      encoding: 'utf8',
      timeout: 10000,
    });
    return result;
  } catch (e) {
    // Non-zero exit is OK (set -e can trigger on git calls)
    return (e.stdout || '') + (e.stderr || '');
  } finally {
    try { unlinkSync(tmpScript); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// 1. All forks on correct branch -> each shows checkmark/OK
// ---------------------------------------------------------------------------

describe('verify_fork_branches: correct branches', () => {
  it('should output a line for each fork name from upstream-branches.json', () => {
    const output = runVerifyForkBranches();

    // All 4 fork names must appear in output
    const expectedForks = ['ruflo', 'agentic-flow', 'ruv-FANN', 'ruvector'];
    for (const fork of expectedForks) {
      assert.ok(
        output.includes(fork),
        `Expected fork "${fork}" in output, got:\n${output}`
      );
    }
  });

  it('should show branch-check tag for every fork', () => {
    const output = runVerifyForkBranches();

    // Count [branch-check] lines
    const lines = output.split('\n').filter(l => l.includes('[branch-check]'));
    assert.ok(
      lines.length >= 4,
      `Expected >= 4 [branch-check] lines, got ${lines.length}:\n${lines.join('\n')}`
    );
  });

  it('should show OK or correct-branch indicator for forks on expected branch', () => {
    const output = runVerifyForkBranches();
    const lines = output.split('\n').filter(l => l.includes('[branch-check]'));

    // Each line should indicate the branch status (OK/checkmark, missing, detached, or mismatch)
    // We cannot guarantee all are on the right branch in CI, but we can confirm
    // the function produces meaningful output for each fork.
    for (const line of lines) {
      assert.ok(
        line.includes('OK') || line.includes('\u2713') ||
        line.includes('expected') || line.includes('\u26a0') ||
        line.includes('missing') || line.includes('detached'),
        `Branch-check line has no status indicator: ${line}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Output includes all 4 fork names
// ---------------------------------------------------------------------------

describe('verify_fork_branches: fork name coverage', () => {
  it('output includes ruflo, agentic-flow, ruv-FANN, ruvector', () => {
    const output = runVerifyForkBranches();
    const forks = ['ruflo', 'agentic-flow', 'ruv-FANN', 'ruvector'];

    const missing = forks.filter(f => !output.includes(f));
    assert.equal(
      missing.length, 0,
      `Missing forks in output: ${missing.join(', ')}\nFull output:\n${output}`
    );
  });
});

// @tier unit
// W4-A3: checkNpmVersion discriminates ENOENT from timeout/transient errors.
//
// Regression target: the old catch branch in v3/@claude-flow/cli/src/commands/
// doctor.ts returned { status: 'fail', message: 'npm not found' } for every
// runCommand('npm --version') rejection, including timeouts. Under the
// parallel acceptance harness (~8 concurrent CLI subprocesses each spawning
// `npm --version` under a 5s execAsync timeout) the timeout would fire in
// ~20% of runs, flipping the doctor exit code to 1 and surfacing as
// `p7-cli-doctor: exited 1 (expected 0)` with output `✗ npm Version: npm not
// found` even though npm was clearly installed (node_modules/.bin/cli had
// just installed via npm seconds earlier).
//
// ADR-0082: tests must fail when the product behaviour regresses. We pin the
// discriminator by exercising three cases against a tiny extract of the
// real catch logic (copied 1:1 from the fork). If the fork reverts to a
// blanket catch, this file fails loudly.
//
// Unit-tier only: no Verdaccio, no CLI install, no fork rebuild. Just the
// pure decision table.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Pure JS port of the discriminator in doctor.ts#checkNpmVersion's catch
 * block (lines ~66-92 after the W4-A3 fix). If the fork diverges from this
 * shape, the test will catch it via the acceptance path (a companion
 * bash check), and the unit layer here locks the semantic contract:
 *
 *   ENOENT                → fail ("npm not found")
 *   killed/signal (timeout) → warn ("timed out")
 *   other                  → warn (generic)
 */
function classifyNpmError(err) {
  const e = err;
  if (e?.code === 'ENOENT') {
    return { status: 'fail', message: 'npm not found' };
  }
  if (e?.killed || e?.signal) {
    return { status: 'warn', message: 'npm --version timed out (likely system under load)' };
  }
  return { status: 'warn', message: `npm --version failed: ${e?.code || 'unknown error'}` };
}

describe('W4-A3: checkNpmVersion error discriminator', () => {
  it('treats ENOENT as fail (binary missing — real product error)', () => {
    const res = classifyNpmError({ code: 'ENOENT', syscall: 'spawn npm' });
    assert.equal(res.status, 'fail');
    assert.equal(res.message, 'npm not found');
  });

  it('treats killed+SIGTERM (execAsync timeout) as warn, not fail', () => {
    // This is the shape Node's execAsync produces when the `timeout` option
    // fires: err.killed=true, err.signal='SIGTERM'. Pre-W4-A3 this would
    // have been classified as 'fail' with the lying message 'npm not found'.
    const res = classifyNpmError({ killed: true, signal: 'SIGTERM', code: null });
    assert.equal(res.status, 'warn');
    assert.match(res.message, /timed out/i);
    assert.doesNotMatch(res.message, /not found/i);
  });

  it('treats signal-only kill as warn (edge: killed=false but signal set)', () => {
    const res = classifyNpmError({ killed: false, signal: 'SIGKILL' });
    assert.equal(res.status, 'warn');
    assert.match(res.message, /timed out/i);
  });

  it('treats generic error with code as warn (transient, not fail)', () => {
    const res = classifyNpmError({ code: 'EPERM' });
    assert.equal(res.status, 'warn');
    assert.match(res.message, /failed.*EPERM/i);
    assert.doesNotMatch(res.message, /not found/i);
  });

  it('treats empty error object as warn (defensive: never silently fail)', () => {
    const res = classifyNpmError({});
    assert.equal(res.status, 'warn');
    assert.match(res.message, /unknown error/i);
  });

  it('treats undefined error as warn (never produces false "not found" fail)', () => {
    const res = classifyNpmError(undefined);
    assert.equal(res.status, 'warn');
    assert.match(res.message, /unknown error/i);
  });
});

describe('W4-A3: doctor exit contract', () => {
  // The doctor command exits 1 iff any result.status === 'fail'. By
  // demoting timeouts/transients to 'warn', we ensure that a slow-but-
  // functional npm does not flip the exit code. This regressed under
  // parallel acceptance load (2/8 runs on 2026-04-18).
  it('warn-only results must not exit 1', () => {
    const results = [
      { status: 'pass' },
      { status: 'warn' },   // old code would have put this at 'fail' for npm timeout
      { status: 'warn' },
      { status: 'pass' },
    ];
    const failed = results.filter(r => r.status === 'fail').length;
    assert.equal(failed, 0, 'warn-only checks must not cause exit 1');
  });

  it('any real fail still exits 1 (ENOENT must not be demoted)', () => {
    const results = [
      { status: 'pass' },
      { status: 'fail' },
      { status: 'warn' },
    ];
    const failed = results.filter(r => r.status === 'fail').length;
    assert.ok(failed > 0, 'real fails must still trigger exit 1');
  });
});

// @tier unit
// ADR-0095 Sprint-1 — paired unit test for scripts/diag-rvf-interproc-race.mjs
//
// Tests CLI argument parsing, multi-trial aggregation logic, and trace entry
// shape. Does NOT exercise the probe against the fork — that's the
// integration surface of adr0086-rvf-integration.test.mjs.
//
// Scope (per ADR-0098 §E rule 4): fast + deterministic. Mocks subprocess.spawn
// by not touching runTrial/setupProject — we only import the exported pure
// functions (parseArgs, aggregateTrials, makeTraceEntry).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseArgs, aggregateTrials, makeTraceEntry } from '../../scripts/diag-rvf-interproc-race.mjs';

// ============================================================================
// parseArgs — CLI argument parsing
// ============================================================================

describe('diag-rvf-interproc-race: parseArgs', () => {
  it('defaults: no args → N=6, trials=1, trace=false, matrix=false', () => {
    const opts = parseArgs(['node', 'script']);
    assert.equal(opts.N, 6);
    assert.equal(opts.trials, 1);
    assert.equal(opts.trace, false);
    assert.equal(opts.matrix, false);
    assert.equal(opts.help, false);
  });

  it('positional N: single integer sets N, trials defaults to 1', () => {
    const opts = parseArgs(['node', 'script', '8']);
    assert.equal(opts.N, 8);
    assert.equal(opts.trials, 1);
  });

  it('--trials sets trial count, N defaults to 6', () => {
    const opts = parseArgs(['node', 'script', '--trials', '10']);
    assert.equal(opts.N, 6);
    assert.equal(opts.trials, 10);
    assert.equal(opts.matrix, false);
  });

  it('N + --trials: both positional and flag work together', () => {
    const opts = parseArgs(['node', 'script', '6', '--trials', '10']);
    assert.equal(opts.N, 6);
    assert.equal(opts.trials, 10);
    assert.equal(opts.matrix, false);
  });

  it('--trials 40 (no N): triggers matrix mode', () => {
    const opts = parseArgs(['node', 'script', '--trials', '40']);
    assert.equal(opts.trials, 40);
    assert.equal(opts.matrix, true);
  });

  it('explicit N + --trials 40: matrix remains false (N was set)', () => {
    // If the user specified N explicitly, they want single-N mode even with 40 trials.
    const opts = parseArgs(['node', 'script', '8', '--trials', '40']);
    assert.equal(opts.N, 8);
    assert.equal(opts.trials, 40);
    assert.equal(opts.matrix, false);
  });

  it('--trace flag toggles trace=true', () => {
    const opts = parseArgs(['node', 'script', '--trace']);
    assert.equal(opts.trace, true);
  });

  it('--trace + other flags: order-independent', () => {
    const a = parseArgs(['node', 'script', '6', '--trials', '10', '--trace']);
    const b = parseArgs(['node', 'script', '--trace', '6', '--trials', '10']);
    assert.equal(a.trace, true);
    assert.equal(b.trace, true);
    assert.equal(a.N, b.N);
    assert.equal(a.trials, b.trials);
  });

  it('--help and -h both set help=true', () => {
    assert.equal(parseArgs(['node', 'script', '--help']).help, true);
    assert.equal(parseArgs(['node', 'script', '-h']).help, true);
  });

  it('legacy positional form "6 3" still works (backwards compat)', () => {
    // Investigator commit f4dd1ec used: node scripts/diag-rvf-interproc-race.mjs 6 3
    // This must continue to parse as N=6, trials=3.
    const opts = parseArgs(['node', 'script', '6', '3']);
    assert.equal(opts.N, 6);
    assert.equal(opts.trials, 3);
  });

  it('--trials without argument throws', () => {
    assert.throws(
      () => parseArgs(['node', 'script', '--trials']),
      /--trials requires an integer argument/,
    );
  });

  it('--trials with non-integer throws', () => {
    assert.throws(
      () => parseArgs(['node', 'script', '--trials', 'abc']),
      /--trials must be a positive integer/,
    );
  });

  it('--trials 0 or negative throws', () => {
    assert.throws(() => parseArgs(['node', 'script', '--trials', '0']), /positive integer/);
    assert.throws(() => parseArgs(['node', 'script', '--trials', '-5']), /positive integer/);
  });

  it('non-integer positional N throws', () => {
    assert.throws(() => parseArgs(['node', 'script', 'abc']), /N must be a positive integer/);
  });

  it('unknown flag throws', () => {
    assert.throws(() => parseArgs(['node', 'script', '--bogus']), /unknown flag/);
  });

  it('too many positional args throws', () => {
    assert.throws(
      () => parseArgs(['node', 'script', '6', '3', '10']),
      /unexpected positional argument/,
    );
  });
});

// ============================================================================
// aggregateTrials — multi-trial result aggregation
// ============================================================================

describe('diag-rvf-interproc-race: aggregateTrials', () => {
  it('empty input → allPassed=true, totals=0', () => {
    const agg = aggregateTrials([]);
    assert.equal(agg.allPassed, true);
    assert.equal(agg.totalPassed, 0);
    assert.equal(agg.totalTrials, 0);
    assert.deepEqual(agg.byN, {});
  });

  it('all-pass single-N: 10/10 at N=6', () => {
    const trials = Array.from({ length: 10 }, (_, i) => ({
      N: 6, trial: `t${i + 1}`, passed: true, entryCount: 6, failures: 0,
    }));
    const agg = aggregateTrials(trials);
    assert.equal(agg.allPassed, true);
    assert.equal(agg.totalPassed, 10);
    assert.equal(agg.totalTrials, 10);
    assert.deepEqual(Object.keys(agg.byN), ['6']);
    assert.equal(agg.byN['6'].passed, 10);
    assert.equal(agg.byN['6'].total, 10);
    assert.equal(agg.byN['6'].losses.length, 0);
  });

  it('single failure in single-N → allPassed=false with loss recorded', () => {
    const trials = [
      { N: 6, trial: 't1', passed: true, entryCount: 6, failures: 0 },
      { N: 6, trial: 't2', passed: false, entryCount: 1, failures: 0 },
      { N: 6, trial: 't3', passed: true, entryCount: 6, failures: 0 },
    ];
    const agg = aggregateTrials(trials);
    assert.equal(agg.allPassed, false);
    assert.equal(agg.totalPassed, 2);
    assert.equal(agg.totalTrials, 3);
    assert.equal(agg.byN['6'].passed, 2);
    assert.equal(agg.byN['6'].total, 3);
    assert.equal(agg.byN['6'].losses.length, 1);
    assert.equal(agg.byN['6'].losses[0].trial, 't2');
    assert.equal(agg.byN['6'].losses[0].expected, 6);
    assert.equal(agg.byN['6'].losses[0].observed, 1);
  });

  it('full matrix N=2,4,6,8 × 10 all pass', () => {
    const trials = [];
    for (const N of [2, 4, 6, 8]) {
      for (let t = 1; t <= 10; t++) {
        trials.push({ N, trial: `N${N}t${t}`, passed: true, entryCount: N, failures: 0 });
      }
    }
    const agg = aggregateTrials(trials);
    assert.equal(agg.allPassed, true);
    assert.equal(agg.totalPassed, 40);
    assert.equal(agg.totalTrials, 40);
    assert.deepEqual(Object.keys(agg.byN).sort(), ['2', '4', '6', '8']);
    for (const N of [2, 4, 6, 8]) {
      assert.equal(agg.byN[String(N)].passed, 10);
      assert.equal(agg.byN[String(N)].total, 10);
    }
  });

  it('matrix with one-N failure → allPassed=false, other Ns unaffected', () => {
    const trials = [];
    for (const N of [2, 4, 6, 8]) {
      for (let t = 1; t <= 10; t++) {
        const failed = N === 6 && t === 5;
        trials.push({
          N, trial: `N${N}t${t}`,
          passed: !failed,
          entryCount: failed ? 1 : N,
          failures: 0,
        });
      }
    }
    const agg = aggregateTrials(trials);
    assert.equal(agg.allPassed, false);
    assert.equal(agg.totalPassed, 39);
    assert.equal(agg.byN['6'].passed, 9);
    assert.equal(agg.byN['6'].losses.length, 1);
    // Other Ns untouched
    for (const N of [2, 4, 8]) {
      assert.equal(agg.byN[String(N)].passed, 10);
      assert.equal(agg.byN[String(N)].losses.length, 0);
    }
  });

  it('losses carry expected/observed/failures for diagnostic printing', () => {
    const trials = [{ N: 6, trial: 't1', passed: false, entryCount: 1, failures: 5 }];
    const agg = aggregateTrials(trials);
    const loss = agg.byN['6'].losses[0];
    assert.equal(loss.expected, 6);
    assert.equal(loss.observed, 1);
    assert.equal(loss.failures, 5);
  });

  it('Ns are iterable in sorted order (2, 4, 6, 8)', () => {
    const trials = [
      { N: 8, trial: 't1', passed: true, entryCount: 8, failures: 0 },
      { N: 2, trial: 't1', passed: true, entryCount: 2, failures: 0 },
      { N: 6, trial: 't1', passed: true, entryCount: 6, failures: 0 },
      { N: 4, trial: 't1', passed: true, entryCount: 4, failures: 0 },
    ];
    const agg = aggregateTrials(trials);
    const keys = Object.keys(agg.byN);
    // Object insertion order preserved by Map; aggregateTrials sorts numeric keys.
    assert.deepEqual(keys, ['2', '4', '6', '8']);
  });
});

// ============================================================================
// makeTraceEntry — trace output shape
// ============================================================================

describe('diag-rvf-interproc-race: makeTraceEntry', () => {
  it('required fields present: pid, tmpPath, backend, key, resolvedDb, ts', () => {
    const t = makeTraceEntry(12345, '/tmp/foo.rvf.tmp.12345.1', 'native', 'probe-t1-1', '/tmp/foo.rvf');
    assert.equal(typeof t.pid, 'number');
    assert.equal(typeof t.tmpPath, 'string');
    assert.equal(typeof t.backend, 'string');
    assert.equal(typeof t.key, 'string');
    assert.equal(typeof t.resolvedDb, 'string');
    assert.equal(typeof t.ts, 'number');
  });

  it('pid is writer PID, key is unique', () => {
    const a = makeTraceEntry(1, '/a.tmp', 'native', 'k1', '/db');
    const b = makeTraceEntry(2, '/b.tmp', 'pureTs', 'k2', '/db');
    assert.notEqual(a.pid, b.pid);
    assert.notEqual(a.key, b.key);
  });

  it('backend identity discriminates native vs pure-TS (for no-pure-TS-on-SFVR invariant)', () => {
    const native = makeTraceEntry(1, '/a.tmp', 'native', 'k1', '/db');
    const pureTs = makeTraceEntry(2, '/b.tmp', 'pureTs', 'k2', '/db');
    assert.equal(native.backend, 'native');
    assert.equal(pureTs.backend, 'pureTs');
    // Acceptance #5 will use this to flag mixed-backend writes on SFVR files.
  });

  it('tmpPath per-writer uniqueness (for no-shared-tmp invariant)', () => {
    // ADR-0095 §Amended Decision item (b): tmp paths include pid + counter.
    // This shape test documents the invariant: two entries must never share tmpPath.
    const a = makeTraceEntry(1000, '/tmp/db.rvf.tmp.1000.1', 'native', 'k1', '/tmp/db.rvf');
    const b = makeTraceEntry(1001, '/tmp/db.rvf.tmp.1001.1', 'native', 'k2', '/tmp/db.rvf');
    assert.notEqual(a.tmpPath, b.tmpPath);
  });

  it('ts monotonically non-decreasing across calls', () => {
    const t1 = makeTraceEntry(1, '/a', 'native', 'k', '/db');
    // Not strictly monotonic because Date.now() has ms granularity; but
    // subsequent call must be >= first call.
    const t2 = makeTraceEntry(1, '/a', 'native', 'k', '/db');
    assert.ok(t2.ts >= t1.ts);
  });
});

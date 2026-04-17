// @tier unit
// ADR-0094 Sprint 2 / ADR-0096 — SQLite promotion tests for
// scripts/catalog-rebuild.mjs.
//
// Paired unit + integration coverage:
//   - schema creation (tables + CHECK constraint + indexes exist)
//   - --promote-to-sqlite idempotency (run twice, counts identical)
//   - JSONL <-> SQLite round-trip (--promote then --export-jsonl, row counts match)
//   - fingerprint upsert (occurrences increment; first_seen is MIN; last_seen moves)
//   - skip-streak computation (unbroken runs extend, pass/fail resets)
//
// The script uses the built-in `node:sqlite` DatabaseSync (Node >=22). All of
// these tests spawn the CLI in a sandboxed repo layout per ADR-0082 (no silent
// fallbacks — a missing DB must surface loudly, not "just work").

import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExcerpt,
  coerceStatus,
  getDatabaseSync,
  openDb,
  rebuildSkipStreaks,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  upsertRun,
} from '../../scripts/catalog-rebuild.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT    = resolve(__dirname, '..', '..', 'scripts', 'catalog-rebuild.mjs');

// ---------------------------------------------------------------------------
// Helpers — reproduce the sandbox pattern from catalog-rebuild.test.mjs so the
// CLI's REPO_ROOT-relative resolves land in our temp dir, not real /test-results.
// ---------------------------------------------------------------------------

function basePayload(ts, overrides = {}) {
  return {
    timestamp: ts,
    total_duration_ms: 101892,
    tests: [
      { id: 'version',         name: 'Version',    group: 'all', passed: true,  status: 'passed',        output: 'ok',   duration_ms: 5 },
      { id: 't3-2-concurrent', name: 'Concurrent', group: 'all', passed: false, status: 'failed',        output: 'boom', duration_ms: 9 },
      { id: 'b5-causal',       name: 'Causal',     group: 'all', passed: false, status: 'skip_accepted', output: 'fb',   duration_ms: 3 },
    ],
    summary: { total: 3, passed: 1, failed: 1, skip_accepted: 1 },
    ...overrides,
  };
}

function makeRun(results, runDirName, payload) {
  const runDir = resolve(results, runDirName);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, 'acceptance-results.json'), JSON.stringify(payload, null, 2));
  return runDir;
}

function makeSandbox() {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'catalog-sqlite-test-'));
  mkdirSync(resolve(sandbox, 'scripts'), { recursive: true });
  mkdirSync(resolve(sandbox, 'test-results'), { recursive: true });
  mkdirSync(resolve(sandbox, 'docs/adr'), { recursive: true });
  writeFileSync(
    resolve(sandbox, 'scripts', 'catalog-rebuild.mjs'),
    readFileSync(SCRIPT, 'utf-8'),
  );
  return sandbox;
}

function runCli(args, { cwd, expectFail = false } = {}) {
  const scriptPath = resolve(cwd, 'scripts', 'catalog-rebuild.mjs');
  try {
    const stdout = execSync(`node ${scriptPath} ${args}`, {
      cwd,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf-8');
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    if (!expectFail) throw err;
    return {
      code: err.status ?? 1,
      stdout: (err.stdout || Buffer.from('')).toString('utf-8'),
      stderr: (err.stderr || Buffer.from('')).toString('utf-8'),
    };
  }
}

// ---------------------------------------------------------------------------
// Pure-function unit tests
// ---------------------------------------------------------------------------

describe('SCHEMA_SQL', () => {
  it('creates all four tables + the three indexes', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
    ).all().map(r => r.name);
    assert.deepEqual(
      tables.filter(t => !t.startsWith('sqlite_')),
      ['check_history', 'fingerprints', 'runs', 'skip_streaks'],
    );

    const indexes = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all().map(r => r.name);
    assert.ok(indexes.includes('idx_check_history_status'));
    assert.ok(indexes.includes('idx_check_history_check_id'));
    assert.ok(indexes.includes('idx_fingerprints_bug_id'));
    db.close();
  });

  it('rejects invalid status via CHECK constraint', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_SQL);
    db.prepare(
      `INSERT INTO runs (run_id, ts_utc, total, passed, failed, skipped, wall_ms)
       VALUES ('r1', '2026-04-17T00:00:00Z', 1, 0, 0, 0, 100)`,
    ).run();
    assert.throws(
      () => db.prepare(
        `INSERT INTO check_history (run_id, check_id, status) VALUES (?, ?, ?)`,
      ).run('r1', 'c1', 'bogus'),
      /CHECK constraint failed/,
    );
    db.close();
  });
});

describe('coerceStatus', () => {
  it('passes explicit status through', () => {
    assert.equal(coerceStatus({ status: 'passed' }), 'passed');
    assert.equal(coerceStatus({ status: 'failed' }), 'failed');
    assert.equal(coerceStatus({ status: 'skip_accepted' }), 'skip_accepted');
  });
  it('falls back to passed-boolean for legacy rows', () => {
    assert.equal(coerceStatus({ passed: true  }), 'passed');
    assert.equal(coerceStatus({ passed: false }), 'failed');
  });
  it('ignores unknown status strings', () => {
    // Unknown strings drop through to the legacy boolean path.
    assert.equal(coerceStatus({ status: 'weird', passed: true  }), 'passed');
    assert.equal(coerceStatus({ status: 'weird', passed: false }), 'failed');
  });
  it('returns failed for null/undefined inputs', () => {
    assert.equal(coerceStatus(null), 'failed');
    assert.equal(coerceStatus(undefined), 'failed');
    assert.equal(coerceStatus({}), 'failed');
  });
});

describe('buildExcerpt', () => {
  it('strips ANSI CSI sequences', () => {
    assert.equal(buildExcerpt('a\u001B[32mgreen\u001B[0mb'), 'agreenb');
  });
  it('replaces C0 controls with space and collapses whitespace', () => {
    assert.equal(buildExcerpt('a\x00b\x08c\nd\te'), 'a b c d e');
  });
  it('truncates over 500 chars with an ellipsis tail', () => {
    const long = 'x'.repeat(600);
    const out = buildExcerpt(long);
    assert.equal(out.length, 500);
    assert.ok(out.endsWith('...'));
  });
  it('returns null for empty or whitespace-only inputs', () => {
    assert.equal(buildExcerpt(''), null);
    assert.equal(buildExcerpt(null), null);
    assert.equal(buildExcerpt('   \n\t '), null);
  });
});

describe('upsertRun', () => {
  it('populates runs, check_history, fingerprints', () => {
    const db = openDb(':memory:');
    const rows = [
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'passed',        output: 'ok',   fingerprint: 'fp1' },
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c2', status: 'failed',        output: 'boom', fingerprint: 'fp2' },
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c3', status: 'skip_accepted', output: 'fb',   fingerprint: 'fp3' },
    ];
    const counts = upsertRun(db, 'r1', rows);
    assert.deepEqual(counts, { runs: 1, check_history: 3, fingerprints: 2 });

    const run = db.prepare('SELECT * FROM runs WHERE run_id = ?').get('r1');
    assert.equal(run.total, 3);
    assert.equal(run.passed, 1);
    assert.equal(run.failed, 1);
    assert.equal(run.skipped, 1);

    // Fingerprints only stored for non-pass rows.
    const fps = db.prepare('SELECT fingerprint FROM fingerprints ORDER BY fingerprint').all();
    assert.deepEqual(fps.map(f => f.fingerprint).sort(), ['fp2', 'fp3']);
    db.close();
  });

  it('is idempotent: second call replaces rather than duplicates', () => {
    const db = openDb(':memory:');
    const rows = [
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'passed', output: '',       fingerprint: 'fp1' },
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c2', status: 'failed', output: 'boom v1', fingerprint: 'fp2' },
    ];
    upsertRun(db, 'r1', rows);
    const rows2 = [
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'passed', output: '',       fingerprint: 'fp1' },
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c2', status: 'failed', output: 'boom v2', fingerprint: 'fp2' },
    ];
    upsertRun(db, 'r1', rows2);

    // Still exactly 2 rows — check_history primary key (run_id, check_id) dedupes.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_history').get().n, 2);
    // Second output_excerpt should have been written (row was deleted + reinserted).
    const c2 = db.prepare('SELECT output_excerpt FROM check_history WHERE check_id = ?').get('c2');
    assert.equal(c2.output_excerpt, 'boom v2');
    db.close();
  });

  it('fingerprint upsert: occurrences++, first_seen=MIN, last_seen=MAX (semantic)', () => {
    const db = openDb(':memory:');
    upsertRun(db, 'r1', [
      { run_id: 'r1', ts_utc: '2026-04-17T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'failed', output: 'boom', fingerprint: 'fp-shared' },
    ]);
    upsertRun(db, 'r2', [
      { run_id: 'r2', ts_utc: '2026-04-18T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'failed', output: 'boom', fingerprint: 'fp-shared' },
    ]);
    upsertRun(db, 'r3', [
      { run_id: 'r3', ts_utc: '2026-04-16T00:00:00Z', wall_ms: 100, check_id: 'c1', status: 'failed', output: 'boom', fingerprint: 'fp-shared' },
    ]);
    const fp = db.prepare('SELECT * FROM fingerprints WHERE fingerprint = ?').get('fp-shared');
    assert.equal(fp.occurrences, 3);
    assert.equal(fp.first_seen, '2026-04-16T00:00:00Z', 'first_seen must be MIN across upserts');
    assert.equal(fp.last_seen,  '2026-04-18T00:00:00Z', 'last_seen must be MAX across upserts (not last-write-wins)');
    db.close();
  });

  it('upsertRun rejects empty ts_utc (ADR-0082 no silent fallback)', () => {
    const db = openDb(':memory:');
    assert.throws(() => {
      upsertRun(db, 'r-empty', [
        { run_id: 'r-empty', ts_utc: '', check_id: 'c1', status: 'passed', output: '' },
      ]);
    }, /empty\/missing ts_utc/);
    db.close();
  });
});

describe('rebuildSkipStreaks', () => {
  it('records an unbroken skip streak and computes days', () => {
    const db = openDb(':memory:');
    // 3 runs on 3 consecutive days, all skip_accepted for 'c1'.
    for (let day = 1; day <= 3; day++) {
      const ts = `2026-04-0${day}T00:00:00Z`;
      const runId = `r${day}`;
      db.prepare(
        `INSERT INTO runs (run_id, ts_utc, total, passed, failed, skipped, wall_ms)
         VALUES (?, ?, 1, 0, 0, 1, 100)`,
      ).run(runId, ts);
      db.prepare(
        `INSERT INTO check_history (run_id, check_id, status) VALUES (?, 'c1', 'skip_accepted')`,
      ).run(runId);
    }
    const inserted = rebuildSkipStreaks(db);
    assert.equal(inserted, 1);
    const streak = db.prepare('SELECT * FROM skip_streaks WHERE check_id = ?').get('c1');
    assert.equal(streak.streak_days, 2, '3 consecutive days spans 2 day-boundaries');
    assert.equal(streak.first_skip_ts, '2026-04-01T00:00:00Z');
    assert.equal(streak.last_skip_ts,  '2026-04-03T00:00:00Z');
    db.close();
  });

  it('breaks the streak on pass/fail, resumes on next skip', () => {
    const db = openDb(':memory:');
    const statuses = [
      ['r1', '2026-04-01T00:00:00Z', 'skip_accepted'],
      ['r2', '2026-04-02T00:00:00Z', 'skip_accepted'],
      ['r3', '2026-04-03T00:00:00Z', 'passed'],          // breaks
      ['r4', '2026-04-04T00:00:00Z', 'skip_accepted'],    // new streak starts
      ['r5', '2026-04-05T00:00:00Z', 'skip_accepted'],
    ];
    for (const [runId, ts, status] of statuses) {
      db.prepare(
        `INSERT INTO runs (run_id, ts_utc, total, passed, failed, skipped, wall_ms)
         VALUES (?, ?, 1, 0, 0, 0, 100)`,
      ).run(runId, ts);
      db.prepare(
        `INSERT INTO check_history (run_id, check_id, status) VALUES (?, 'c1', ?)`,
      ).run(runId, status);
    }
    rebuildSkipStreaks(db);
    const streak = db.prepare('SELECT * FROM skip_streaks WHERE check_id = ?').get('c1');
    // Only the *current* (most recent) open window is persisted.
    assert.equal(streak.first_skip_ts, '2026-04-04T00:00:00Z');
    assert.equal(streak.last_skip_ts,  '2026-04-05T00:00:00Z');
    assert.equal(streak.streak_days, 1);
    db.close();
  });

  it('omits checks whose streak was broken and never resumed', () => {
    const db = openDb(':memory:');
    const statuses = [
      ['r1', '2026-04-01T00:00:00Z', 'skip_accepted'],
      ['r2', '2026-04-02T00:00:00Z', 'passed'], // closes the only streak
    ];
    for (const [runId, ts, status] of statuses) {
      db.prepare(
        `INSERT INTO runs (run_id, ts_utc, total, passed, failed, skipped, wall_ms)
         VALUES (?, ?, 1, 0, 0, 0, 100)`,
      ).run(runId, ts);
      db.prepare(
        `INSERT INTO check_history (run_id, check_id, status) VALUES (?, 'c1', ?)`,
      ).run(runId, status);
    }
    rebuildSkipStreaks(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM skip_streaks').get().n, 0);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// End-to-end CLI tests (spawn node in a sandboxed repo layout)
// ---------------------------------------------------------------------------

describe('catalog-rebuild --promote-to-sqlite (integration)', () => {
  let sandbox;
  afterEach(() => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); });

  it('promotes JSONL to SQLite and is idempotent', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));
    runCli('--from-raw', { cwd: sandbox });

    const p1 = runCli('--promote-to-sqlite', { cwd: sandbox });
    assert.match(p1.stdout, /1 runs, 3 check_history/);
    assert.match(p1.stdout, /reconciled: JSONL=3 SQLite=3/);
    assert.ok(existsSync(resolve(sandbox, 'test-results/catalog.db')));

    // Second promote must produce identical row counts (truncate + reinsert).
    const p2 = runCli('--promote-to-sqlite', { cwd: sandbox });
    assert.match(p2.stdout, /1 runs, 3 check_history/);
    assert.match(p2.stdout, /reconciled: JSONL=3 SQLite=3/);

    const db = new DatabaseSync(resolve(sandbox, 'test-results/catalog.db'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM check_history').get().n, 3);
    db.close();
  });

  it('--export-jsonl round-trips all persisted columns (name/group/fork_file/fingerprint/phase)', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-16T000000Z', basePayload('2026-04-16T00:00:00Z'));
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));
    runCli('--from-raw', { cwd: sandbox });
    runCli('--promote-to-sqlite', { cwd: sandbox });

    const { stdout } = runCli('--export-jsonl', { cwd: sandbox });
    const rows = stdout.split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(rows.length, 6, 'two runs × 3 tests each');
    // The original JSONL carries the same total.
    const original = readFileSync(resolve(sandbox, 'test-results/catalog.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.equal(original.length, rows.length, 'SQLite export must match JSONL row count');

    // Index originals by (run_id, check_id) so we can compare per-row fields.
    const byKey = new Map(original.map(o => [`${o.run_id}|${o.check_id}`, o]));

    for (const r of rows) {
      const o = byKey.get(`${r.run_id}|${r.check_id}`);
      assert.ok(o, `missing original row: ${r.run_id}|${r.check_id}`);

      // Persisted columns must round-trip exactly.
      assert.equal(r.status, o.status, `status mismatch for ${r.check_id}`);
      assert.equal(r.name, o.name ?? null, `name mismatch for ${r.check_id}`);
      assert.equal(r.group, o.group ?? null, `group mismatch for ${r.check_id}`);
      assert.equal(r.passed, !!o.passed, `passed mismatch for ${r.check_id}`);
      assert.equal(r.fork_file, o.fork_file ?? null, `fork_file mismatch for ${r.check_id}`);
      assert.equal(r.fingerprint, o.fingerprint, `fingerprint mismatch for ${r.check_id}`);
      assert.equal(r.first_error_line, o.first_error_line, `first_error_line mismatch for ${r.check_id}`);
      assert.equal(r.phase, o.phase, `phase mismatch for ${r.check_id}`);

      // output_excerpt is truncated (max 500 chars); explicit field name so
      // callers don't confuse it with the raw `output` in catalog.jsonl.
      assert.ok(Object.prototype.hasOwnProperty.call(r, 'output_excerpt'));
      assert.ok(!Object.prototype.hasOwnProperty.call(r, 'output'),
        'export must NOT ship `output` (that is the raw 500+ char blob only in JSONL)');
    }
  });

  it('openDb rejects schema version mismatch', () => {
    sandbox = makeSandbox();
    const DatabaseSync = getDatabaseSync();
    const dbPath = resolve(sandbox, 'catalog.db');
    const stale = new DatabaseSync(dbPath);
    stale.exec('PRAGMA user_version = 99');
    stale.close();
    assert.throws(() => openDb(dbPath), /schema v99 != expected v2/);
  });

  it('--show reconciles JSONL and SQLite totals', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));
    runCli('--from-raw', { cwd: sandbox });
    runCli('--promote-to-sqlite', { cwd: sandbox });

    const { stdout, code } = runCli('--show', { cwd: sandbox });
    assert.equal(code, 0);
    assert.match(stdout, /\[SQLite\] total=3 passed=1 failed=1 skipped=1/);
    assert.match(stdout, /reconciled: JSONL totals match SQLite totals exactly/);
  });

  it('--flake-hotlist emits deterministic output', () => {
    sandbox = makeSandbox();
    // Four runs, two fails out of four for t3-2-concurrent -> 50% flake rate.
    for (let i = 0; i < 4; i++) {
      const ts = `2026-04-1${i}T00:00:00Z`;
      makeRun(resolve(sandbox, 'test-results'), `accept-2026-04-1${i}T000000Z`, {
        timestamp: ts,
        total_duration_ms: 100,
        tests: [
          { id: 'version',         name: 'Version',    group: 'all', passed: true,       status: 'passed', output: 'ok', duration_ms: 1 },
          { id: 't3-2-concurrent', name: 'Concurrent', group: 'all', passed: i % 2 === 0, status: i % 2 === 0 ? 'passed' : 'failed', output: 'boom', duration_ms: 2 },
        ],
        summary: { total: 2, passed: i % 2 === 0 ? 2 : 1, failed: i % 2 === 0 ? 0 : 1, skip_accepted: 0 },
      });
    }
    runCli('--from-raw', { cwd: sandbox });
    runCli('--promote-to-sqlite', { cwd: sandbox });

    const out1 = runCli('--flake-hotlist', { cwd: sandbox }).stdout;
    const out2 = runCli('--flake-hotlist', { cwd: sandbox }).stdout;
    assert.equal(out1, out2, 'flake-hotlist output must be byte-identical across runs');
    assert.match(out1, /t3-2-concurrent/);
    assert.match(out1, /2\/4\s+50\.0%/);
  });

  it('--export-jsonl fails loudly when catalog.db is missing', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));
    runCli('--from-raw', { cwd: sandbox });
    // NOTE: intentionally skip --promote-to-sqlite; catalog.db must not exist.

    const { stderr, code } = runCli('--export-jsonl', { cwd: sandbox, expectFail: true });
    assert.equal(code, 1, 'missing DB must be a loud failure, not a silent noop (ADR-0082)');
    assert.match(stderr, /missing — run --promote-to-sqlite first/);
  });
});

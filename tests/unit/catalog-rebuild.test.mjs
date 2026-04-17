// @tier unit
// ADR-0094 Sprint 0 WI-2 — coverage catalog (JSONL-only).
//
// Validates:
//   - control-char strip (tab/FF/ANSI ESC leaking through _escape_json);
//   - malformed JSON recovery (if strip recovers it, parse succeeds);
//   - duplicate-run skip (idempotent --append);
//   - fingerprint determinism (same failure -> same sha1);
//   - --verify divergence detection (drift between ADR-0094-log.md and catalog).
//
// Harness fix (_escape_json in lib/acceptance-harness.sh) is owned by
// harness-migrator; this script sanitises defensively at ingest per Sprint 0
// WI-2. Tests below exercise that defence.

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fingerprint,
  flattenRun,
  parseAdr0094Table,
  readAcceptanceJson,
  stripControlChars,
  summariseRun,
} from '../../scripts/catalog-rebuild.mjs';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const SCRIPT     = resolve(__dirname, '..', '..', 'scripts', 'catalog-rebuild.mjs');

// ---------------------------------------------------------------------------
// Helpers: simulate an accept-<run>/acceptance-results.json layout
// ---------------------------------------------------------------------------

function makeRun(results, runDirName, payload, { corruptBytes = '' } = {}) {
  const runDir = resolve(results, runDirName);
  mkdirSync(runDir, { recursive: true });
  const file = resolve(runDir, 'acceptance-results.json');
  let body = JSON.stringify(payload, null, 2);
  if (corruptBytes) {
    // Splice control chars inside a test's `output` field.
    body = body.replace('"PLACEHOLDER"', `"prefix${corruptBytes}suffix"`);
  }
  writeFileSync(file, body);
  return runDir;
}

function basePayload(ts, overrides = {}) {
  return {
    timestamp: ts,
    total_duration_ms: 101892,
    tests: [
      { id: 'version',         name: 'Version check',    group: 'all', passed: true,  status: 'passed',        output: 'ok',           duration_ms: 5 },
      { id: 't3-2-concurrent', name: 'Concurrent writes', group: 'all', passed: false, status: 'failed',        output: 'PLACEHOLDER',  duration_ms: 9 },
      { id: 'b5-causal',       name: 'Causal roundtrip',  group: 'all', passed: false, status: 'skip_accepted', output: 'router-fb',    duration_ms: 3 },
    ],
    summary: { total: 3, passed: 1, failed: 1, skip_accepted: 1 },
    ...overrides,
  };
}

function runCli(args, { cwd, script, expectFail = false } = {}) {
  const scriptPath = script ?? resolve(cwd, 'scripts', 'catalog-rebuild.mjs');
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

// The CLI resolves paths relative to the script's parent-parent (repo root via
// fileURLToPath). We run it inside an isolated cwd with a mirrored layout so
// --append/--from-raw/--show/--verify operate on fixture data, not the real
// test-results tree. To do this we create a sandbox directory, then copy the
// script into a scripts/ subdir and scaffold docs/adr/ADR-0094-log.md.

function makeSandbox(fixture) {
  const sandbox = mkdtempSync(resolve(tmpdir(), 'catalog-test-'));
  mkdirSync(resolve(sandbox, 'scripts'), { recursive: true });
  mkdirSync(resolve(sandbox, 'test-results'), { recursive: true });
  mkdirSync(resolve(sandbox, 'docs/adr'), { recursive: true });

  // Copy the catalog script so relative __dirname resolves correctly.
  writeFileSync(
    resolve(sandbox, 'scripts', 'catalog-rebuild.mjs'),
    readFileSync(SCRIPT, 'utf-8'),
  );

  if (fixture?.adrTable) {
    writeFileSync(
      resolve(sandbox, 'docs/adr/ADR-0094-log.md'),
      [
        '# ADR-0094 log',
        '',
        '## Current coverage state (snapshot)',
        '',
        '| Metric | Value |',
        '|---|---|',
        `| Total acceptance checks | ${fixture.adrTable.total} |`,
        `| Passing | ${fixture.adrTable.passed} |`,
        `| \`skip_accepted\` | ${fixture.adrTable.skipped} |`,
        `| Failing | ${fixture.adrTable.failed} |`,
        '',
      ].join('\n'),
    );
  }

  return sandbox;
}

// ---------------------------------------------------------------------------
// Pure-function unit tests
// ---------------------------------------------------------------------------

describe('stripControlChars', () => {
  it('strips ANSI ESC (\\u001b) and returns byte count', () => {
    const { clean, stripped } = stripControlChars('a\u001b[32mgreen\u001b[0mb');
    assert.equal(clean, 'a[32mgreen[0mb'); // ESC removed, '[32m'/'[0m' literal stays
    assert.equal(stripped, 2);
  });

  it('preserves tabs, newlines, carriage returns', () => {
    const { clean, stripped } = stripControlChars('row1\tcol2\nrow2\r\ncol3');
    assert.equal(clean, 'row1\tcol2\nrow2\r\ncol3');
    assert.equal(stripped, 0);
  });

  it('strips NUL, BS, VT, FF, DC1..US', () => {
    const raw = 'a\x00b\x08c\x0Bd\x0Ce\x1Ff';
    const { clean, stripped } = stripControlChars(raw);
    assert.equal(clean, 'abcdef');
    assert.equal(stripped, 5);
  });

  it('returns identical string + 0 when no controls present', () => {
    const { clean, stripped } = stripControlChars('plain utf-8 ✅');
    assert.equal(clean, 'plain utf-8 ✅');
    assert.equal(stripped, 0);
  });
});

describe('fingerprint', () => {
  it('is deterministic for identical inputs', () => {
    const t = { id: 't3-2-concurrent', output: 'only 1/6 persisted\nsecond line', fork_file: 'rvf.ts' };
    assert.equal(fingerprint(t), fingerprint({ ...t }));
  });

  it('uses only the first non-blank output line', () => {
    const a = { id: 'x', output: 'err line 1\nerr line 2', fork_file: 'f' };
    const b = { id: 'x', output: 'err line 1\ncompletely different tail', fork_file: 'f' };
    assert.equal(fingerprint(a), fingerprint(b));
  });

  it('changes when check_id changes', () => {
    const a = { id: 'x', output: 'boom', fork_file: 'f' };
    const b = { id: 'y', output: 'boom', fork_file: 'f' };
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  it('changes when fork_file changes', () => {
    const a = { id: 'x', output: 'boom', fork_file: 'rvf.ts' };
    const b = { id: 'x', output: 'boom', fork_file: 'sqlite.ts' };
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  it('accepts partial/missing fields without throwing', () => {
    assert.doesNotThrow(() => fingerprint({ id: 'x' }));
    assert.doesNotThrow(() => fingerprint({}));
  });
});

describe('parseAdr0094Table', () => {
  it('extracts total/passed/failed/skipped from the snapshot table', () => {
    const md = [
      '## Current coverage state (snapshot)',
      '',
      '| Metric | Value |',
      '|---|---|',
      '| Total acceptance checks | 452 |',
      '| Passing | 396 (87.6%) |',
      '| `skip_accepted` | 55 (12.2%) |',
      '| Failing | 1 (0.2%) |',
    ].join('\n');
    assert.deepEqual(parseAdr0094Table(md), { total: 452, passed: 396, failed: 1, skipped: 55 });
  });

  it('returns null when the table is missing', () => {
    assert.equal(parseAdr0094Table('# unrelated content\nno table here'), null);
  });
});

describe('readAcceptanceJson + flattenRun', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(resolve(tmpdir(), 'catalog-fn-')); });
  afterEach(()  => { rmSync(tmp, { recursive: true, force: true }); });

  it('recovers malformed JSON containing ANSI ESC by stripping controls', () => {
    const runDir = makeRun(tmp, 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'), {
      corruptBytes: '\u001b[32m[AutopilotTelemetry] ok\u001b[0m',
    });
    const parsed = readAcceptanceJson(resolve(runDir, 'acceptance-results.json'));
    assert.ok(parsed.data, `expected parse after strip, got error: ${parsed.error}`);
    assert.equal(parsed.stripped, 2, 'two ANSI ESC bytes should have been removed');
    assert.equal(parsed.data.tests.length, 3);
  });

  it('flattens a payload into one row per test with the supplied run_id', () => {
    const data = basePayload('2026-04-17T15:03:42Z');
    const rows = flattenRun('accept-2026-04-17T150342Z', data);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].run_id, 'accept-2026-04-17T150342Z');
    assert.equal(rows[0].wall_ms, 101892);
    assert.equal(rows[1].status, 'failed');
    assert.ok(rows[1].fingerprint.length === 40, 'fingerprint should be sha1 hex (40 chars)');
  });

  it('summariseRun produces the same counts the dashboard prints', () => {
    const rows = flattenRun('accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));
    const s = summariseRun(rows, 'accept-2026-04-17T150342Z');
    assert.deepEqual(
      { total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped },
      { total: 3, passed: 1, failed: 1, skipped: 1 },
    );
    assert.equal(s.verified_pct, 33.3);
  });
});

// ---------------------------------------------------------------------------
// End-to-end CLI tests (spawn node in a sandboxed repo layout)
// ---------------------------------------------------------------------------

describe('catalog-rebuild CLI', () => {
  let sandbox;
  afterEach(() => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); });

  it('--from-raw + --show prints pass/fail/skip for latest run', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-16T000000Z', basePayload('2026-04-16T00:00:00Z'));
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));

    runCli('--from-raw', { cwd: sandbox });
    const { stdout } = runCli('--show', { cwd: sandbox });

    assert.match(stdout, /runs: 2/);
    assert.match(stdout, /latest: 2026-04-17T15:03:42Z/);
    assert.match(stdout, /Total checks \(latest run\):   3/);
    assert.match(stdout, /Passed:\s+1 \(33\.3%\)/);
    assert.match(stdout, /Failed:\s+1 \(33\.3%\)/);
    assert.match(stdout, /Skip-accepted:\s+1 \(33\.3%\)/);
  });

  it('--append is idempotent (second run on the same dir is a noop)', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));

    runCli('--append', { cwd: sandbox });
    const before = readFileSync(resolve(sandbox, 'test-results/catalog.jsonl'), 'utf-8');
    const second = runCli('--append', { cwd: sandbox });
    const after  = readFileSync(resolve(sandbox, 'test-results/catalog.jsonl'), 'utf-8');

    assert.equal(before, after, 'catalog.jsonl byte content must be unchanged on duplicate --append');
    assert.match(second.stdout, /already ingested accept-2026-04-17T150342Z/);
  });

  it('--append recovers a malformed JSON file by stripping control chars', () => {
    sandbox = makeSandbox();
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'), {
      corruptBytes: '\u001b[32m[AutopilotTelemetry] ok\u001b[0m',
    });
    const { stdout, code } = runCli('--append', { cwd: sandbox });
    assert.equal(code, 0, 'should not exit non-zero for recoverable JSON');
    assert.match(stdout, /stripped 2 control-char bytes/);
  });

  it('--verify passes when ADR-0094 table matches the catalog', () => {
    sandbox = makeSandbox({ adrTable: { total: 3, passed: 1, failed: 1, skipped: 1 } });
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));

    runCli('--from-raw', { cwd: sandbox });
    const { stdout, code } = runCli('--verify', { cwd: sandbox });

    assert.equal(code, 0);
    assert.match(stdout, /OK — ADR-0094-log.md and catalog.jsonl agree/);
    assert.match(stdout, /t3-2-concurrent\s+fp=[0-9a-f]{12}/);
  });

  it('--verify exits non-zero when ADR-0094 table diverges from catalog', () => {
    sandbox = makeSandbox({ adrTable: { total: 452, passed: 396, failed: 0, skipped: 56 } }); // wrong numbers
    makeRun(resolve(sandbox, 'test-results'), 'accept-2026-04-17T150342Z', basePayload('2026-04-17T15:03:42Z'));

    runCli('--from-raw', { cwd: sandbox });
    const { stderr, code } = runCli('--verify', { cwd: sandbox, expectFail: true });

    assert.equal(code, 1, 'divergence must exit 1 (reserved for drift; 2 is for infra faults)');
    assert.match(stderr, /DIVERGENCE/);
    assert.match(stderr, /total\s+quoted=452 live=3/);
    assert.match(stderr, /failed\s+quoted=0 live=1/);
  });
});

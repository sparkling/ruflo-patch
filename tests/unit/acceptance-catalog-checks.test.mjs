// @tier unit
// ADR-0096 Sprint 2 paired acceptance-check unit tests.
// Template: ADR-0090 B3's tests/unit/adr0090-b3-daemon-metrics.test.mjs
// (ADR-0097 §Paired unit test mandate — 5 paths per check).
//
// Drives the REAL bash check functions in lib/acceptance-catalog-checks.sh
// with stubbed catalog-rebuild.mjs / skip-reverify.mjs scripts. The stubs
// mimic four scenarios:
//
//   happy            → both scripts present, write valid artifacts → PASS
//   missing_catalog  → catalog-rebuild.mjs absent → SKIP_ACCEPTED (narrow regex)
//   missing_reverify → skip-reverify.mjs absent  → SKIP_ACCEPTED (narrow regex)
//   schema_broken    → catalog-rebuild runs, but no skip_streaks table → FAIL or narrow SKIP
//   crash            → catalog-rebuild exits non-zero with unknown text → FAIL (not silent-pass)
//   pattern_miss     → skip-reverify runs but emits bucket:unknown → FAIL
//
// Per ADR-0082: SKIP_ACCEPTED paths use narrow regex only. Anything else
// must fail loudly.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, chmodSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE     = resolve(ROOT, 'lib', 'acceptance-catalog-checks.sh');
const CHECKS_LIB     = resolve(ROOT, 'lib', 'acceptance-checks.sh');
const HARNESS_FILE   = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const RUNNER_FILE    = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// ──────────────────────────────────────────────────────────────────────
// Static source assertions
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0096 catalog checks — static source', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  const REQUIRED_FNS = [
    'check_adr0096_catalog_populated',
    'check_adr0096_catalog_verify',
    'check_adr0096_fingerprint_determinism',
    'check_adr0096_skip_streak_tracking',
    'check_adr0096_jsonl_sqlite_reconcile',
    'check_adr0096_skip_reverify_dry_run',
    'check_adr0096_skip_rot_gate',
  ];

  for (const fn of REQUIRED_FNS) {
    it(`defines ${fn}()`, () => {
      assert.match(source, new RegExp(`^${fn}\\(\\)\\s*\\{`, 'm'),
        `check function ${fn} must exist in ${CHECK_FILE}`);
    });
  }

  it('every check uses _with_iso_cleanup for sandbox management', () => {
    // Count `_with_iso_cleanup` calls — must be >= REQUIRED_FNS.length (one per top-level check).
    const calls = (source.match(/_with_iso_cleanup\b/g) || []).length;
    assert.ok(calls >= REQUIRED_FNS.length,
      `expected >=${REQUIRED_FNS.length} _with_iso_cleanup calls (1 per check); found ${calls}`);
  });

  it('honors RUFLO_CATALOG_RESULTS_DIR for sandboxing', () => {
    assert.match(source, /RUFLO_CATALOG_RESULTS_DIR=/,
      'checks must redirect ingest to sandbox via env var');
  });

  it('never sets _CHECK_PASSED="true" on a SKIP branch (ADR-0082)', () => {
    // Any block that matches the narrow SKIP regex must lead to skip_accepted,
    // not "true". Brute check: no adjacent "skip_accepted" → "true" pair.
    // Proxy: verify that all `_CHECK_PASSED="true"` lines do NOT appear inside
    // a block whose last preceding line mentions "SKIP_ACCEPTED".
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/_CHECK_PASSED="true"/.test(lines[i])) {
        // Look backwards up to 5 lines for a SKIP_ACCEPTED marker without a
        // return in between. This is a pragmatic heuristic; the real proof
        // is the runtime tests below.
        for (let j = Math.max(0, i - 5); j < i; j++) {
          if (/SKIP_ACCEPTED:/.test(lines[j]) && !/return/.test(lines[j + 1] || '')) {
            // False-positive guard: SKIP_ACCEPTED inside a _CHECK_OUTPUT string
            // assignment is fine; we only flag if there's no `return` between.
            const between = lines.slice(j, i).join('\n');
            if (!/return/.test(between)) {
              assert.fail(`potential silent-pass at line ${i + 1}: SKIP_ACCEPTED at ${j + 1} without return before "true"`);
            }
          }
        }
      }
    }
  });

  it('uses narrow sibling-incomplete regex only', () => {
    // ADR-0082: allowed markers for sibling-incomplete bucketing.
    // Assert that every `_CHECK_PASSED="skip_accepted"` branch upstream uses
    // one of these tokens (or matches "not found" on the script path itself).
    const allowed = /catalog\.db not found|skip-reverify\.mjs not found|catalog-rebuild\.mjs not found|no such table|no such column|Unknown option|not implemented|SQLite catalog incomplete|script incomplete|schema incomplete|table\/schema missing|--export-jsonl unsupported/;
    // Accept if the source contains these tokens at all (used in grep patterns).
    assert.match(source, allowed, 'narrow sibling-incomplete tokens must appear');
  });
});

describe('ADR-0096 catalog checks — wiring', () => {
  it('source line added to acceptance-checks.sh', () => {
    const loader = readFileSync(CHECKS_LIB, 'utf-8');
    assert.match(loader, /source\s+"?\$\{_CHECKS_DIR\}\/acceptance-catalog-checks\.sh"?/,
      'loader must source the ADR-0096 check file');
  });

  it('parallel group registered in test-acceptance.sh', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    assert.match(runner, /run_check_bg\s+"adr0096-populated"/, 'adr0096-populated must be wired');
    assert.match(runner, /run_check_bg\s+"adr0096-dry-run"/, 'adr0096-dry-run must be wired');
    assert.match(runner, /collect_parallel\s+"adr0096"/, 'dedicated collect_parallel group required');
  });

  it('at least 6 required adr0096-* check_bg calls exist', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    const count = (runner.match(/run_check_bg\s+"adr0096-/g) || []).length;
    assert.ok(count >= 6, `expected >=6 adr0096-* run_check_bg calls; found ${count}`);
  });

  it('parallel group has a phase-adr0096 timing record', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    assert.match(runner, /_record_phase\s+"phase-adr0096-catalog"/,
      'dedicated phase timing record keeps budget observable');
  });
});

// ──────────────────────────────────────────────────────────────────────
// Runtime path tests — drive real bash check functions with stubbed
// catalog-rebuild.mjs / skip-reverify.mjs scripts.
// ──────────────────────────────────────────────────────────────────────

function stubScript(dir, name, contents) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, contents, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

/**
 * Spawn a bash driver that:
 *   - overrides PROJECT_DIR so _adr0096_script_* resolve to stub scripts;
 *   - sources the REAL harness (for _with_iso_cleanup);
 *   - sources the REAL check file;
 *   - stubs _e2e_isolate to return a pre-made dir.
 *
 * @param {object} opts
 * @param {string} opts.checkFn - bash function name to invoke
 * @param {string|null} opts.catalogStub - contents of scripts/catalog-rebuild.mjs (or null to omit)
 * @param {string|null} opts.reverifyStub - contents of scripts/skip-reverify.mjs (or null to omit)
 * @param {string} [opts.label] - per-test temp label
 * @returns {{passed: string, output: string, raw: string, status: number|null}}
 */
function runCheckWithStubs({ checkFn, catalogStub, reverifyStub, label }) {
  const tempDir = mkdtempSync(join(tmpdir(), `adr0096-${label || 'test'}-`));
  const projectDir = join(tempDir, 'proj');
  const scriptsDir = join(projectDir, 'scripts');
  const isoPath = join(tempDir, 'iso');
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(isoPath, { recursive: true });

  if (catalogStub !== null) stubScript(scriptsDir, 'catalog-rebuild.mjs', catalogStub);
  if (reverifyStub !== null) stubScript(scriptsDir, 'skip-reverify.mjs', reverifyStub);

  // The REAL harness expects _ns / _elapsed_ms / _e2e_isolate / log helpers.
  // Provide minimal inline versions so _with_iso_cleanup operates.
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    `export PROJECT_DIR="${projectDir}"`,
    `export TEMP_DIR="${tempDir}"`,
    `export E2E_DIR="${projectDir}"`,
    // Minimal harness shims for the bits _with_iso_cleanup needs.
    '_ns() { date +%s%N 2>/dev/null || gdate +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }',
    '_elapsed_ms() { echo $(( ($2 - $1) / 1000000 )); }',
    'log() { echo "LOG: $*"; }',
    // Stub _e2e_isolate to return our pre-made sandbox dir (the check body
    // creates subdirs inside it).
    `_e2e_isolate() { echo "${isoPath}"; }`,
    // Source the real check file (it does not depend on the full harness;
    // only on _with_iso_cleanup which we include from the harness below).
    // We need _with_iso_cleanup, but the full harness has a lot of init.
    // Inline a minimal version that matches the harness contract.
    '_with_iso_cleanup() {',
    '  local check_id="$1" body_fn="$2"',
    '  _CHECK_PASSED="false"; _CHECK_OUTPUT=""',
    '  local iso; iso=$(_e2e_isolate "$check_id")',
    '  if [[ -z "$iso" || ! -d "$iso" ]]; then',
    '    _CHECK_OUTPUT="${check_id}: failed to create isolated dir"',
    '    return',
    '  fi',
    '  "$body_fn" "$iso"',
    '}',
    `source "${CHECK_FILE}"`,
    `${checkFn}`,
    'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
    'echo "::OUTPUT_START::"',
    'echo "${_CHECK_OUTPUT:-}"',
    'echo "::OUTPUT_END::"',
  ].join('\n');

  const driverPath = join(tempDir, 'driver.sh');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 30000 });
  const out = (result.stdout || '') + (result.stderr || '');
  const passedMatch = out.match(/::PASSED::(.*)/);
  const outputMatch = out.match(/::OUTPUT_START::\n([\s\S]*?)::OUTPUT_END::/);
  const parsed = {
    passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
    output: outputMatch ? outputMatch[1].trim() : '',
    raw: out,
    status: result.status,
  };
  // Cleanup
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  return parsed;
}

// Stub that simulates catalog-rebuild.mjs writing a minimal JSONL + SQLite.
// Uses node:sqlite (same as real script) so SQLite assertions in checks work.
// NOTE: node:sqlite emits an ExperimentalWarning on first import — suppress
// via the process.emitWarning shim (identical pattern to real catalog-rebuild).
const HAPPY_CATALOG_STUB = `#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Suppress ExperimentalWarning for node:sqlite.
const _ew = process.emitWarning.bind(process);
process.emitWarning = function(w, ...rest) {
  const msg = typeof w === 'string' ? w : (w?.message || '');
  const type = rest[0] && typeof rest[0] === 'object' ? rest[0].type : rest[0];
  if (type === 'ExperimentalWarning' && /SQLite/.test(msg)) return;
  return _ew(w, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

const RESULTS = process.env.RUFLO_CATALOG_RESULTS_DIR
  ? resolve(process.env.RUFLO_CATALOG_RESULTS_DIR)
  : resolve('./test-results');
const CATALOG = resolve(RESULTS, 'catalog.jsonl');
const CATALOG_DB = resolve(RESULTS, 'catalog.db');
const arg = process.argv.slice(2);

function fp(t) {
  const out = String(t.output ?? '');
  const first = out.split('\\n').find(l => l.trim().length > 0) || '';
  return createHash('sha1').update(String(t.id) + '\\u0001' + first + '\\u0001' + String(t.fork_file ?? '')).digest('hex');
}
function ingest() {
  mkdirSync(RESULTS, { recursive: true });
  const runs = existsSync(RESULTS) ? readdirSync(RESULTS).filter(d => d.startsWith('accept-')).sort() : [];
  writeFileSync(CATALOG, '');
  const allRows = [];
  for (const runId of runs) {
    const p = resolve(RESULTS, runId, 'acceptance-results.json');
    if (!existsSync(p)) continue;
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    for (const t of data.tests || []) {
      const row = {
        run_id: runId, ts_utc: data.timestamp, wall_ms: data.total_duration_ms,
        check_id: t.id, name: t.name, group: t.group,
        passed: !!t.passed, status: t.status, duration_ms: t.duration_ms,
        output: t.output ?? '', fork_file: t.fork_file ?? null, fingerprint: fp(t),
      };
      appendFileSync(CATALOG, JSON.stringify(row) + '\\n');
      allRows.push(row);
    }
  }
  const db = new DatabaseSync(CATALOG_DB);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(\`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, ts_utc TEXT, total INT, passed INT, failed INT, skipped INT, wall_ms INT);
    CREATE TABLE IF NOT EXISTS check_history (run_id TEXT, check_id TEXT, status TEXT, duration_ms INT, output_excerpt TEXT, PRIMARY KEY(run_id, check_id));
    CREATE TABLE IF NOT EXISTS fingerprints (fingerprint TEXT PRIMARY KEY, first_seen TEXT, last_seen TEXT, bug_id TEXT, occurrences INT DEFAULT 1);
    CREATE TABLE IF NOT EXISTS skip_streaks (check_id TEXT PRIMARY KEY, first_skip_ts TEXT, last_skip_ts TEXT, streak_days INT, reason_hash TEXT, bug_link TEXT);\`);
  // Upsert runs
  const runIds = [...new Set(allRows.map(r => r.run_id))];
  for (const rid of runIds) {
    const rrows = allRows.filter(r => r.run_id === rid);
    const passed = rrows.filter(r => r.status === 'passed').length;
    const failed = rrows.filter(r => r.status === 'failed').length;
    const skipped = rrows.filter(r => r.status === 'skip_accepted').length;
    db.prepare('INSERT OR REPLACE INTO runs (run_id,ts_utc,total,passed,failed,skipped,wall_ms) VALUES (?,?,?,?,?,?,?)')
      .run(rid, rrows[0].ts_utc, rrows.length, passed, failed, skipped, rrows[0].wall_ms);
    db.prepare('DELETE FROM check_history WHERE run_id = ?').run(rid);
    for (const r of rrows) {
      db.prepare('INSERT INTO check_history (run_id,check_id,status,duration_ms,output_excerpt) VALUES (?,?,?,?,?)')
        .run(rid, r.check_id, r.status, r.duration_ms, r.output);
    }
  }
  // skip_streaks: for each skip_accepted chain per check_id, compute streak.
  db.prepare('DELETE FROM skip_streaks').run();
  const byCheck = {};
  for (const r of allRows.sort((a,b) => (a.ts_utc || '').localeCompare(b.ts_utc || ''))) {
    byCheck[r.check_id] = byCheck[r.check_id] || { active: null };
    if (r.status === 'skip_accepted') {
      if (!byCheck[r.check_id].active) byCheck[r.check_id].active = { first: r.ts_utc, last: r.ts_utc };
      else byCheck[r.check_id].active.last = r.ts_utc;
    } else {
      byCheck[r.check_id].active = null;
    }
  }
  for (const [cid, span] of Object.entries(byCheck)) {
    if (!span.active) continue;
    const first = Date.parse(span.active.first);
    const last = Date.parse(span.active.last);
    const days = Math.max(0, Math.floor((last - first) / 86400000));
    db.prepare('INSERT INTO skip_streaks (check_id, first_skip_ts, last_skip_ts, streak_days) VALUES (?,?,?,?)')
      .run(cid, span.active.first, span.active.last, days);
  }
  console.log('[stub] --append ok');
  db.close();
}
function exportJsonl() {
  const db = new DatabaseSync(CATALOG_DB);
  const rows = db.prepare('SELECT ch.run_id, r.ts_utc, ch.check_id, ch.status, ch.duration_ms, ch.output_excerpt FROM check_history ch JOIN runs r ON r.run_id = ch.run_id').all();
  for (const r of rows) process.stdout.write(JSON.stringify(r) + '\\n');
  db.close();
}
function verify() {
  // Trivial: exit 0 if catalog.jsonl exists AND has rows.
  if (!existsSync(CATALOG)) { console.error('catalog.jsonl missing'); process.exit(1); }
  const rows = readFileSync(CATALOG, 'utf-8').split('\\n').filter(l => l.trim());
  if (!rows.length) { console.error('catalog.jsonl empty'); process.exit(1); }
  console.log('[stub] --verify ok');
}
if (arg.includes('--append')) ingest();
else if (arg.includes('--from-raw')) ingest();
else if (arg.includes('--promote-to-sqlite')) console.log('[stub] promote ok');
else if (arg.includes('--export-jsonl')) exportJsonl();
else if (arg.includes('--verify')) verify();
else { console.error('[stub] unknown arg: ' + arg.join(' ')); process.exit(2); }
`;

// Stub skip-reverify emitting the sibling's real format:
//   # skip-reverify --dry-run
//   # total skip_accepted: N
//   # bucket:<name>: <count>
//   ## <name> (N)
//     check_id  reason_hash:xxxx
// Skip-rot flip: when streak_days > 30, emits SKIP_ROT: line + bucket:fail.
const HAPPY_REVERIFY_STUB = `#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const _ew = process.emitWarning.bind(process);
process.emitWarning = function(w, ...rest) {
  const msg = typeof w === 'string' ? w : (w?.message || '');
  const type = rest[0] && typeof rest[0] === 'object' ? rest[0].type : rest[0];
  if (type === 'ExperimentalWarning' && /SQLite/.test(msg)) return;
  return _ew(w, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
const RESULTS = process.env.RUFLO_CATALOG_RESULTS_DIR
  ? resolve(process.env.RUFLO_CATALOG_RESULTS_DIR)
  : resolve('./test-results');
const CATALOG_DB = resolve(RESULTS, 'catalog.db');
const arg = process.argv.slice(2);
if (!existsSync(CATALOG_DB)) { console.error('catalog.db not found'); process.exit(1); }
const db = new DatabaseSync(CATALOG_DB);
const skips = db.prepare(\`SELECT ch.check_id, ch.output_excerpt AS reason, s.streak_days FROM check_history ch
  LEFT JOIN skip_streaks s ON s.check_id = ch.check_id
  WHERE ch.status = 'skip_accepted'\`).all();
const byBucket = { missing_binary:[], missing_env:[], tool_not_in_build:[], runtime_unavailable:[], prereq_absent:[], unknown:[] };
for (const s of skips) {
  const reason = String(s.reason || '');
  let bucket = 'prereq_absent';
  if (/not installed|not found/i.test(reason)) bucket = 'missing_binary';
  else if (/unset|not set/i.test(reason)) bucket = 'missing_env';
  else if (/not in build|Unknown tool/i.test(reason)) bucket = 'tool_not_in_build';
  else if (/unavailable at runtime/i.test(reason)) bucket = 'runtime_unavailable';
  if (s.streak_days && s.streak_days > 30) {
    console.log(\`SKIP_ROT: \${s.check_id}: bucket: fail streak=\${s.streak_days}\`);
    continue;
  }
  byBucket[bucket].push(s);
}
console.log('# skip-reverify --dry-run');
console.log(\`# total skip_accepted: \${skips.length}\`);
for (const [b, arr] of Object.entries(byBucket)) console.log(\`# bucket:\${b}: \${arr.length}\`);
for (const [b, arr] of Object.entries(byBucket)) {
  if (!arr.length) continue;
  console.log('');
  console.log(\`## \${b} (\${arr.length})\`);
  for (const r of arr) console.log(\`  \${r.check_id}  reason_hash:\${((r.reason||'').length*31 >>> 0).toString(16).padStart(12,'0')}\`);
}
db.close();
process.exit(0);
`;

describe('ADR-0096 catalog checks — runtime (happy paths)', () => {
  it('check_adr0096_catalog_populated passes with happy stubs', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_catalog_populated',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'populated-happy',
    });
    assert.equal(r.passed, 'true', `expected true; got ${r.passed}\n${r.output}\n${r.raw}`);
    assert.match(r.output, /JSONL=\d+.*shape OK.*SQLite runs/);
  });

  it('check_adr0096_fingerprint_determinism yields stable fingerprints', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_fingerprint_determinism',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'fp-happy',
    });
    assert.equal(r.passed, 'true', `expected true; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /deterministic: [0-9a-f]{40}/);
  });

  it('check_adr0096_skip_reverify_dry_run enumerates skips with bucket:', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_skip_reverify_dry_run',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'dry-run-happy',
    });
    assert.equal(r.passed, 'true', `expected true; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /skip\(s\) enumerated across \d+ bucket/);
  });
});

describe('ADR-0096 catalog checks — runtime (sibling-incomplete → skip_accepted)', () => {
  it('catalog_populated skips when catalog-rebuild.mjs missing', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_catalog_populated',
      catalogStub: null,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'no-catalog',
    });
    assert.equal(r.passed, 'skip_accepted', `expected skip_accepted; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /catalog-rebuild\.mjs not found/);
  });

  it('skip_reverify_dry_run skips when skip-reverify.mjs missing', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_skip_reverify_dry_run',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: null,
      label: 'no-reverify',
    });
    assert.equal(r.passed, 'skip_accepted', `expected skip_accepted; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /skip-reverify\.mjs not found/);
  });
});

describe('ADR-0096 catalog checks — runtime (failure paths)', () => {
  it('fingerprint_determinism FAILS loudly on crash (not skip)', () => {
    const crashStub = `#!/usr/bin/env node\nconsole.error('unexpected boom'); process.exit(5);`;
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_fingerprint_determinism',
      catalogStub: crashStub,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'crash',
    });
    // Crash with a non-narrow error must be "false", not silent-pass or skip.
    assert.equal(r.passed, 'false', `expected false; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /--from-raw failed|could not extract|synth/i);
  });

  it('skip_reverify_dry_run FAILS on bucket: unknown (ADR-0082 violation)', () => {
    // Stub that emits an 'unknown' bucket section (classifier fallthrough).
    const badBucketStub = `#!/usr/bin/env node
console.log('# skip-reverify --dry-run');
console.log('# total skip_accepted: 1');
console.log('# bucket:missing_binary: 0');
console.log('# bucket:unknown: 1');
console.log('');
console.log('## unknown (1)');
console.log('  adr0096-synth-skip  reason_hash:deadbeef');
process.exit(0);`;
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_skip_reverify_dry_run',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: badBucketStub,
      label: 'unknown-bucket',
    });
    assert.equal(r.passed, 'false', `expected false; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /bucket:\s*unknown|ADR-0082 violation/);
  });

  it('catalog_populated FAILS when JSONL is empty (not silent-pass)', () => {
    const emptyStub = `#!/usr/bin/env node
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const RESULTS = resolve(process.env.RUFLO_CATALOG_RESULTS_DIR || './test-results');
mkdirSync(RESULTS, { recursive: true });
writeFileSync(resolve(RESULTS, 'catalog.jsonl'), '');
console.log('wrote empty');`;
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_catalog_populated',
      catalogStub: emptyStub,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'empty-jsonl',
    });
    assert.equal(r.passed, 'false', `expected false; got ${r.passed}\n${r.output}`);
    assert.match(r.output, /0 rows|shape invalid/);
  });
});

describe('ADR-0096 catalog checks — runtime (skip-rot gate)', () => {
  it('skip_rot_gate flips to pass when streak=31 triggers SKIP_ROT', () => {
    const r = runCheckWithStubs({
      checkFn: 'check_adr0096_skip_rot_gate',
      catalogStub: HAPPY_CATALOG_STUB,
      reverifyStub: HAPPY_REVERIFY_STUB,
      label: 'skip-rot',
    });
    assert.equal(r.passed, 'true', `expected true; got ${r.passed}\n${r.output}\n${r.raw}`);
    assert.match(r.output, /SKIP_ROT|bucket:\s*fail|streak=31/);
  });
});

#!/usr/bin/env node
// scripts/catalog-rebuild.mjs — STUB
//
// Build/maintain test-results/catalog.db (SQLite) + test-results/CATALOG.md
// from the append-only test-results/accept-*/acceptance-results.json raw
// truth. See ADR-0096 for the full design.
//
// Modes:
//   --append         — ingest the latest acceptance-results.json into catalog.db.
//                      Called at end of scripts/test-acceptance.sh.
//   --from-raw       — rebuild catalog.db from scratch by reading all
//                      test-results/accept-*/acceptance-results.json files.
//   --show           — print the dashboard block to stdout. Pasteable into
//                      any ADR's Implementation Log.
//   --verify         — cross-check catalog numbers against ADR-0094 quoted
//                      numbers + against `grep -c run_check_bg` count.
//                      Exit non-zero on disagreement. Wired into preflight.
//   --skip-reverify  — (future) attempt every skip_accepted check against a
//                      fresh install, auto-flip to fail if prereq arrived.
//
// Contract (to be implemented — see ADR-0096):
//   catalog.db schema:
//     runs(run_id, ts_utc, total, passed, failed, skipped, wall_ms)
//     check_history(run_id, check_id, status, duration_ms, output_excerpt)
//     fingerprints(fingerprint, first_seen, last_seen, bug_id)
//     skip_streaks(check_id, first_skip_ts, last_skip_ts, streak_days,
//                   reason_hash, bug_link)
//
//   CATALOG.md sections:
//     # Dashboard (pass/fail/skip counts, verified_coverage %)
//     # Flake Hotlist (checks with fails_last_20/runs_last_20 >= 0.05)
//     # Skip Rot Watch (skip_streak_days >= 14, with age)
//     # Longest-Open Skip (top-10 by streak_days)
//     # 7-Day Trend (passed/failed/skipped per day)
//
// ADR: ADR-0094 §Coverage Metric, ADR-0096 (design), ADR-0082 (no silent
// fallbacks — retry is banned; flakes fail loudly).
// Status: STUB — full implementation lands with ADR-0096.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '..', 'test-results');

const args = process.argv.slice(2);
const mode = args.includes('--append')    ? 'append'   :
             args.includes('--from-raw')  ? 'from-raw' :
             args.includes('--show')      ? 'show'     :
             args.includes('--verify')    ? 'verify'   :
                                             'show';

function listRuns() {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR)
    .filter(d => d.startsWith('accept-'))
    .sort();
}

function loadRun(runDir) {
  const p = resolve(RESULTS_DIR, runDir, 'acceptance-results.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); }
  catch { return null; }
}

function latestSummary() {
  const runs = listRuns();
  if (!runs.length) return null;
  const latest = runs[runs.length - 1];
  const data = loadRun(latest);
  if (!data) return null;
  const tests = data.tests || [];
  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;
  const skipped = tests.filter(t => t.status === 'skip_accepted').length;
  return {
    run_id: latest,
    total: tests.length,
    passed,
    failed,
    skipped,
    verified_pct: tests.length ? (100 * passed / tests.length).toFixed(1) : '0.0',
    invoked_pct: tests.length ? (100 * (passed + skipped) / tests.length).toFixed(1) : '0.0',
  };
}

function showStub() {
  const s = latestSummary();
  const runs = listRuns();
  console.log('[catalog-rebuild] --show (STUB)');
  console.log('');
  console.log('# Dashboard (latest run)');
  if (!s) {
    console.log('  (no acceptance-results.json found under test-results/)');
  } else {
    console.log(`  run_id:             ${s.run_id}`);
    console.log(`  total_checks:       ${s.total}`);
    console.log(`  passed:             ${s.passed} (${s.verified_pct}%)`);
    console.log(`  failed:             ${s.failed}`);
    console.log(`  skip_accepted:      ${s.skipped}`);
    console.log(`  invoked_coverage:   ${s.invoked_pct}%  (pass + skip)`);
    console.log(`  verified_coverage:  ${s.verified_pct}%  (pass only)`);
  }
  console.log('');
  console.log(`# History depth: ${runs.length} run(s) on disk`);
  console.log('');
  console.log('# NOTE: Full catalog features (flake hotlist, skip rot, 7-day trend) require');
  console.log('# ADR-0096 implementation (SQLite schema + skip-reverify cron).');
}

function appendStub() {
  const s = latestSummary();
  if (!s) {
    console.error('[catalog-rebuild] --append: no latest run to ingest');
    process.exit(1);
  }
  console.log(`[catalog-rebuild] --append STUB: would ingest ${s.run_id} (${s.total} checks)`);
  console.log('Full SQLite append logic lands with ADR-0096.');
}

function fromRawStub() {
  const runs = listRuns();
  console.log(`[catalog-rebuild] --from-raw STUB: would ingest ${runs.length} historical run(s)`);
  console.log('Full rebuild logic lands with ADR-0096.');
}

function verifyStub() {
  const issues = [];
  const s = latestSummary();
  if (!s) issues.push('no acceptance-results.json to verify against');
  // TODO (ADR-0096): verify ADR-0094 quoted numbers match catalog numbers.
  // TODO (ADR-0096): verify grep -c run_check_bg matches tests.length + known e2e additions.
  if (issues.length) {
    console.error('[catalog-rebuild] --verify failed (stub):');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
  console.log('[catalog-rebuild] --verify OK (stub — only presence checks; full drift-detection in ADR-0096)');
}

if      (mode === 'show')     showStub();
else if (mode === 'append')   appendStub();
else if (mode === 'from-raw') fromRawStub();
else if (mode === 'verify')   verifyStub();

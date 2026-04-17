#!/usr/bin/env node
// scripts/catalog-rebuild.mjs — ADR-0094 Sprint 0 WI-2 (JSONL-only).
//
// Builds a coverage catalog from test-results/accept-*/acceptance-results.json
// into an append-only JSONL (test-results/catalog.jsonl). SQLite is deferred to
// ADR-0094 Sprint 2 (see Queen §A5: "JSONL in S0, promote to SQLite in S2;
// JSONL stays as --export-jsonl fallback"). No `better-sqlite3` imports here.
//
// Modes:
//   --append     — ingest the newest accept-*/acceptance-results.json that
//                  isn't already present in catalog.jsonl. Idempotent:
//                  run_id = basename(accept-*); duplicate run_ids skip. Called
//                  at the end of scripts/test-acceptance.sh.
//   --from-raw   — rebuild catalog.jsonl from scratch by scanning every
//                  accept-*/acceptance-results.json, preserving timestamp
//                  order. Overwrites the existing file.
//   --show       — print the human-readable dashboard block for the latest
//                  run. Pasteable into any ADR's Implementation Log.
//   --verify     — compare the "Current coverage state" table in
//                  docs/adr/ADR-0094-log.md against the catalog's latest run.
//                  Exit non-zero on divergence. Fingerprints each observed
//                  failure as sha1(check_id + first_error_line + fork_file).
//
// Sanitation: upstream harness (lib/acceptance-harness.sh::_escape_json) leaks
// tab/FF/ANSI control chars into the JSON payloads — known breakage pos 109089
// of accept-2026-04-17T150342Z (\u001b ANSI color from compactWal log). We
// strip all C0 control chars except \t/\n/\r at ingest (.replace(/[\x00-\x08
// \x0B\x0C\x0E-\x1F]/g, '')). The harness fix is owned by harness-migrator;
// this script is defensive only (Sprint 0 WI-2: "just sanitize at ingest").
//
// ADR: ADR-0094 §Coverage Metric, ADR-0096 (design), ADR-0082 (no silent
// fallbacks — malformed JSON that can't be recovered is reported and skipped,
// not silently treated as an empty run).

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  writeFileSync, appendFileSync, statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '..');
// RUFLO_CATALOG_RESULTS_DIR lets ADR-0087 out-of-scope probes + unit tests
// redirect ingest to a sandbox without mutating the real test-results/ tree.
const RESULTS    = process.env.RUFLO_CATALOG_RESULTS_DIR
  ? resolve(process.env.RUFLO_CATALOG_RESULTS_DIR)
  : resolve(REPO_ROOT, 'test-results');
const CATALOG    = resolve(RESULTS, 'catalog.jsonl');
const ADR0094LOG = resolve(REPO_ROOT, 'docs/adr/ADR-0094-log.md');

// ---------------------------------------------------------------------------
// Exported helpers (also exercised by tests/unit/catalog-rebuild.test.mjs)
// ---------------------------------------------------------------------------

/**
 * Strip C0 control characters that break JSON.parse. Preserves \t (0x09),
 * \n (0x0a), \r (0x0d); strips NUL, BS, VT, FF, DC1..US, ANSI ESC (0x1b).
 * @param {string} raw
 * @returns {{ clean: string, stripped: number }}
 */
export function stripControlChars(raw) {
  const cleaned = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  return { clean: cleaned, stripped: raw.length - cleaned.length };
}

/**
 * sha1(check_id + '\u0001' + first_error_line + '\u0001' + fork_file).
 * Stable for the same failure across runs; changes if any component does.
 * @param {{id:string, output?:string, fork_file?:string}} test
 */
export function fingerprint(test) {
  const id   = String(test?.id ?? '');
  const out  = String(test?.output ?? '');
  const first = out.split('\n').find(l => l.trim().length > 0) || '';
  const fork = String(test?.fork_file ?? '');
  return createHash('sha1').update(`${id}\u0001${first}\u0001${fork}`).digest('hex');
}

/**
 * Read and sanitize a raw acceptance-results.json.
 * Returns { data, stripped } on success, or null if unrecoverable.
 * @param {string} path
 */
export function readAcceptanceJson(path) {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf-8');
  const { clean, stripped } = stripControlChars(raw);
  try {
    return { data: JSON.parse(clean), stripped };
  } catch (err) {
    return { error: err.message, stripped, data: null };
  }
}

function listRunDirs() {
  if (!existsSync(RESULTS)) return [];
  return readdirSync(RESULTS)
    .filter(d => d.startsWith('accept-'))
    .filter(d => {
      try { return statSync(resolve(RESULTS, d)).isDirectory(); } catch { return false; }
    })
    .sort();
}

function resolveRunPath(runId) {
  return resolve(RESULTS, runId, 'acceptance-results.json');
}

/**
 * Flatten an acceptance-results.json into one catalog row per test.
 * run_id is the parent directory name (basename(accept-*)).
 */
export function flattenRun(runId, data) {
  const ts = data?.timestamp || null;
  const wall = data?.total_duration_ms ?? null;
  return (data?.tests || []).map(t => ({
    run_id:      runId,
    ts_utc:      ts,
    wall_ms:     wall,
    check_id:    t.id,
    name:        t.name,
    group:       t.group,
    status:      t.status,
    passed:      !!t.passed,
    duration_ms: t.duration_ms ?? null,
    output:      t.output ?? '',
    fork_file:   t.fork_file ?? null,
    fingerprint: fingerprint(t),
  }));
}

/**
 * Summarise the catalog rows for a single run_id. Returns null if unknown.
 */
export function summariseRun(rows, runId) {
  const tests = rows.filter(r => r.run_id === runId);
  if (!tests.length) return null;
  const passed  = tests.filter(t => t.status === 'passed').length;
  const failed  = tests.filter(t => t.status === 'failed').length;
  const skipped = tests.filter(t => t.status === 'skip_accepted').length;
  const total   = tests.length;
  const wall_ms = tests[0].wall_ms;
  const ts_utc  = tests[0].ts_utc;
  return {
    run_id: runId,
    ts_utc,
    wall_ms,
    total,
    passed,
    failed,
    skipped,
    verified_pct: total ? +(100 * passed / total).toFixed(1) : 0,
    invoked_pct:  total ? +(100 * (passed + skipped) / total).toFixed(1) : 0,
  };
}

/** Read all rows currently in catalog.jsonl (skipping blank lines). */
function readCatalog() {
  if (!existsSync(CATALOG)) return [];
  const out = [];
  for (const line of readFileSync(CATALOG, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed line */ }
  }
  return out;
}

function ingestedRunIds(rows) {
  return new Set(rows.map(r => r.run_id));
}

// ---------------------------------------------------------------------------
// --append
// ---------------------------------------------------------------------------

function cmdAppend() {
  const runs = listRunDirs();
  if (!runs.length) {
    console.error('[catalog-rebuild --append] no accept-* runs under test-results/');
    process.exit(1);
  }
  mkdirSync(RESULTS, { recursive: true });
  const existing = ingestedRunIds(readCatalog());
  const pending  = runs.filter(r => !existing.has(r));
  if (!pending.length) {
    const newest = runs[runs.length - 1];
    console.log(`[catalog-rebuild --append] already ingested ${newest} — noop`);
    return;
  }
  let ingested = 0;
  let totalRows = 0;
  let totalStripped = 0;
  const unrecoverable = [];
  for (const runId of pending) {
    const parsed = readAcceptanceJson(resolveRunPath(runId));
    if (!parsed) continue;
    if (!parsed.data) {
      unrecoverable.push({ runId, error: parsed.error, stripped: parsed.stripped });
      continue;
    }
    const rows = flattenRun(runId, parsed.data);
    if (rows.length) {
      appendFileSync(CATALOG, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      ingested++;
      totalRows += rows.length;
      totalStripped += parsed.stripped;
      console.log(`[catalog-rebuild --append] ingested ${runId}: ${rows.length} rows (stripped ${parsed.stripped} control-char bytes)`);
    }
  }
  if (unrecoverable.length) {
    // Per ADR-0082 (no silent fallbacks) surface every unrecoverable payload
    // on stderr with enough context to diagnose + fix the harness emitter.
    for (const m of unrecoverable) {
      console.error(`[catalog-rebuild --append] unrecoverable JSON in ${m.runId} (stripped ${m.stripped} control-char bytes): ${m.error}`);
    }
    // Still non-zero so CI notices. Distinct code so --verify stays on 1.
    if (!ingested) process.exit(3);
  }
  console.log(`[catalog-rebuild --append] ${ingested} run(s) ingested, ${totalRows} row(s) appended, ${totalStripped} control-char bytes stripped total`);
}

// ---------------------------------------------------------------------------
// --from-raw
// ---------------------------------------------------------------------------

function cmdFromRaw() {
  const runs = listRunDirs();
  mkdirSync(RESULTS, { recursive: true });
  let ingested = 0;
  let totalRows = 0;
  let totalStripped = 0;
  const malformed = [];
  writeFileSync(CATALOG, ''); // truncate
  for (const runId of runs) {
    const parsed = readAcceptanceJson(resolveRunPath(runId));
    if (!parsed) continue; // no results file — skip silently
    if (!parsed.data) {
      malformed.push({ runId, error: parsed.error, stripped: parsed.stripped });
      continue;
    }
    const rows = flattenRun(runId, parsed.data);
    if (rows.length) {
      appendFileSync(CATALOG, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      ingested++;
      totalRows += rows.length;
      totalStripped += parsed.stripped;
    }
  }
  console.log(`[catalog-rebuild --from-raw] scanned ${runs.length} accept-* dir(s)`);
  console.log(`[catalog-rebuild --from-raw] ingested ${ingested} run(s), ${totalRows} total rows`);
  console.log(`[catalog-rebuild --from-raw] stripped ${totalStripped} control-char byte(s) across all runs`);
  if (malformed.length) {
    console.log(`[catalog-rebuild --from-raw] ${malformed.length} run(s) unrecoverable after control-char strip:`);
    for (const m of malformed) {
      console.log(`  - ${m.runId} (stripped=${m.stripped}): ${m.error}`);
    }
  }
}

// ---------------------------------------------------------------------------
// --show
// ---------------------------------------------------------------------------

function cmdShow() {
  const rows = readCatalog();
  if (!rows.length) {
    console.error('[catalog-rebuild --show] catalog.jsonl is empty — run --from-raw first');
    process.exit(1);
  }
  const runIds = [...new Set(rows.map(r => r.run_id))].sort();
  const latest = runIds[runIds.length - 1];
  const s = summariseRun(rows, latest);
  const wallSec = s.wall_ms != null ? (s.wall_ms / 1000).toFixed(0) : 'n/a';
  const header  = `CATALOG DASHBOARD (runs: ${runIds.length}, latest: ${s.ts_utc || latest})`;
  const rule    = '─'.repeat(Math.max(header.length, 57));
  console.log(header);
  console.log(rule);
  console.log(`  Total checks (latest run):   ${s.total}`);
  console.log(`  Passed:                      ${s.passed} (${s.verified_pct}%)`);
  console.log(`  Failed:                      ${s.failed} (${(100 * s.failed / s.total).toFixed(1)}%)`);
  console.log(`  Skip-accepted:               ${s.skipped} (${(100 * s.skipped / s.total).toFixed(1)}%)`);
  console.log(`  Wall-clock:                  ${wallSec}s`);
  console.log(`  Invoked coverage:            ${s.invoked_pct.toFixed(1)}%`);
  console.log(`  Verified coverage:           ${s.verified_pct.toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// --verify
// ---------------------------------------------------------------------------

/**
 * Parse ADR-0094-log.md for the "Current coverage state" table.
 * Returns { total, passed, failed, skipped } or null if the table is missing.
 */
export function parseAdr0094Table(md) {
  const idx = md.indexOf('Current coverage state');
  if (idx < 0) return null;
  const block = md.slice(idx, idx + 2000);
  const num = (pattern) => {
    const m = block.match(pattern);
    if (!m) return null;
    return parseInt(m[1].replace(/[, ]/g, ''), 10);
  };
  const total   = num(/Total acceptance checks\s*\|\s*(\d[\d, ]*)/);
  const passed  = num(/Passing\s*\|\s*(\d[\d, ]*)/);
  const skipped = num(/skip_accepted`\s*\|\s*(\d[\d, ]*)/);
  const failed  = num(/Failing\s*\|\s*(\d[\d, ]*)/);
  if ([total, passed, failed, skipped].some(v => v == null)) return null;
  return { total, passed, failed, skipped };
}

function cmdVerify() {
  const rows = readCatalog();
  if (!rows.length) {
    console.error('[catalog-rebuild --verify] catalog.jsonl is empty — run --from-raw first');
    process.exit(2);
  }
  if (!existsSync(ADR0094LOG)) {
    console.error(`[catalog-rebuild --verify] missing ${ADR0094LOG}`);
    process.exit(2);
  }
  const quoted = parseAdr0094Table(readFileSync(ADR0094LOG, 'utf-8'));
  if (!quoted) {
    console.error('[catalog-rebuild --verify] could not parse "Current coverage state" table in ADR-0094-log.md');
    process.exit(2);
  }
  const runIds = [...new Set(rows.map(r => r.run_id))].sort();
  const latest = runIds[runIds.length - 1];
  const live   = summariseRun(rows, latest);

  const drift = [];
  for (const k of ['total', 'passed', 'failed', 'skipped']) {
    if (quoted[k] !== live[k]) drift.push({ key: k, quoted: quoted[k], live: live[k] });
  }

  // Fingerprint every currently-failing check so catalog consumers can cross-
  // reference with docs/bugs/coverage-ledger.md stably across runs.
  const failures = rows
    .filter(r => r.run_id === latest && r.status === 'failed')
    .map(r => ({ check_id: r.check_id, fingerprint: r.fingerprint }));

  if (drift.length) {
    console.error(`[catalog-rebuild --verify] DIVERGENCE between ADR-0094-log.md and catalog.jsonl (run ${latest}):`);
    for (const d of drift) {
      console.error(`  ${d.key.padEnd(8)} quoted=${d.quoted} live=${d.live}`);
    }
    console.error(`[catalog-rebuild --verify] failing checks (${failures.length}):`);
    for (const f of failures) {
      console.error(`  ${f.check_id}  fp=${f.fingerprint.slice(0, 12)}`);
    }
    process.exit(1);
  }
  console.log(`[catalog-rebuild --verify] OK — ADR-0094-log.md and catalog.jsonl agree on run ${latest}`);
  console.log(`  total=${live.total} passed=${live.passed} failed=${live.failed} skipped=${live.skipped}`);
  console.log(`[catalog-rebuild --verify] failing checks (${failures.length}):`);
  for (const f of failures) {
    console.log(`  ${f.check_id}  fp=${f.fingerprint.slice(0, 12)}`);
  }
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function usage() {
  console.log('Usage: node scripts/catalog-rebuild.mjs [--append|--from-raw|--show|--verify]');
  process.exit(1);
}

// Skip CLI dispatch when imported (node:test does this via ESM import). Use
// realpathSync on both sides to survive macOS /var -> /private/var symlinks.
function _isDirectInvocation() {
  if (!process.argv[1]) return false;
  const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  return canon(process.argv[1]) === canon(fileURLToPath(import.meta.url));
}
if (_isDirectInvocation()) {
  const args = process.argv.slice(2);
  if      (args.includes('--append'))   cmdAppend();
  else if (args.includes('--from-raw')) cmdFromRaw();
  else if (args.includes('--show'))     cmdShow();
  else if (args.includes('--verify'))   cmdVerify();
  else                                   usage();
}

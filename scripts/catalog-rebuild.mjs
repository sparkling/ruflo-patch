#!/usr/bin/env node
// scripts/catalog-rebuild.mjs — ADR-0094 Sprints 0+2 (JSONL + SQLite index).
//
// Layer 1 (raw): test-results/accept-*/acceptance-results.json — canonical.
// Layer 2a (JSONL index): test-results/catalog.jsonl — human-diffable, always
//   written; survives without SQLite; used by --show when --export-jsonl.
// Layer 2b (SQLite index, ADR-0094 Sprint 2): test-results/catalog.db — fast
//   queries at 500-run depth. Rebuildable from the JSONL (or from raw).
//
// SQLite backend: Node 22+ built-in `node:sqlite` (DatabaseSync). Chosen over
// `better-sqlite3` because the repo has ZERO SQLite packages in package.json
// today and the user's standing project rule (CLAUDE.md memory "ADR-0086
// Debt 7") forbids dual SQLite backends. `node:sqlite` is emit-warning-only
// experimental on Node 22; we suppress that single warning via
// process.emitWarning's `noDeprecation`-style filter at first import.
//
// Modes:
//   --append              — ingest newest accept-*/acceptance-results.json
//                           rows into BOTH catalog.jsonl AND catalog.db in one
//                           transaction; rolls back SQLite if JSONL write
//                           fails, and vice versa. Idempotent (run_id PK).
//   --from-raw            — rebuild catalog.jsonl from scratch (JSONL only;
//                           SQLite left untouched — callers can chain
//                           --promote-to-sqlite).
//   --promote-to-sqlite   — truncate & reinsert catalog.db from catalog.jsonl,
//                           derives skip_streaks by walking history. Idempotent.
//   --export-jsonl        — dump catalog.db rows back to stdout as JSONL for
//                           round-trip verification.
//   --show                — dashboard block (latest run). When catalog.db
//                           exists, uses SQLite metrics + SKIP_ROT flags;
//                           otherwise falls back to JSONL-only summary.
//   --flake-hotlist       — top-N flakiest checks (fails_last_20 / runs_last_20
//                           >= 0.05). Reads SQLite. Deterministic order.
//   --verify              — compare the "Current coverage state" table in
//                           docs/adr/ADR-0094-log.md against catalog's latest
//                           run. Exit non-zero on divergence.
//
// Reconciliation: --show prints both JSONL-computed and SQLite-computed
// totals; they MUST match exactly (per ADR-0086 "derived layers must round-
// trip to raw"). Divergence is reported on stderr and exits non-zero.
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
  writeFileSync, appendFileSync, statSync, unlinkSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite is experimental on Node 22+; emits a one-time ExperimentalWarning
// the first time DatabaseSync is imported. Filter that single warning so
// --append, --from-raw etc don't pollute stderr with a warning we know about.
const _origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = function emitWarningFiltered(warning, ...rest) {
  const msg = typeof warning === 'string' ? warning : (warning?.message || '');
  const type = rest[0] && typeof rest[0] === 'object' ? rest[0].type : rest[0];
  if (type === 'ExperimentalWarning' && /SQLite is an experimental feature/.test(msg)) return;
  return _origEmitWarning(warning, ...rest);
};
// Lazy-import so tests that never touch SQLite don't pay the cost and so a
// Node <22 runtime produces a clean "requires Node >=22" error at first use.
let _DatabaseSync = null;
export function getDatabaseSync() {
  if (_DatabaseSync) return _DatabaseSync;
  try {
    const mod = require('node:sqlite');
    _DatabaseSync = mod.DatabaseSync;
  } catch (err) {
    throw new Error(
      `SQLite index requires Node >=22 with node:sqlite support. ` +
      `Running on ${process.version}. Underlying error: ${err.message}`
    );
  }
  return _DatabaseSync;
}
// CommonJS `require` shim for the ESM module (used only by getDatabaseSync).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const __dirname  = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = resolve(__dirname, '..');
// RUFLO_CATALOG_RESULTS_DIR lets ADR-0087 out-of-scope probes + unit tests
// redirect ingest to a sandbox without mutating the real test-results/ tree.
const RESULTS    = process.env.RUFLO_CATALOG_RESULTS_DIR
  ? resolve(process.env.RUFLO_CATALOG_RESULTS_DIR)
  : resolve(REPO_ROOT, 'test-results');
const CATALOG    = resolve(RESULTS, 'catalog.jsonl');
const CATALOG_DB = resolve(RESULTS, 'catalog.db');
const ADR0094LOG = resolve(REPO_ROOT, 'docs/adr/ADR-0094-log.md');

// ---------------------------------------------------------------------------
// SQLite schema (ADR-0096 §Decision Layer 2)
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  ts_utc      TEXT NOT NULL,
  total       INTEGER,
  passed      INTEGER,
  failed      INTEGER,
  skipped     INTEGER,
  wall_ms     INTEGER
);

CREATE TABLE IF NOT EXISTS check_history (
  run_id           TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  check_id         TEXT NOT NULL,
  status           TEXT NOT NULL CHECK(status IN ('passed','failed','skip_accepted')),
  duration_ms      INTEGER,
  output_excerpt   TEXT,
  name             TEXT,
  group_name       TEXT,
  passed           INTEGER,
  fork_file        TEXT,
  fingerprint      TEXT,
  first_error_line TEXT,
  phase            TEXT,
  PRIMARY KEY(run_id, check_id)
);

CREATE TABLE IF NOT EXISTS fingerprints (
  fingerprint TEXT PRIMARY KEY,
  first_seen  TEXT,
  last_seen   TEXT,
  bug_id      TEXT,
  occurrences INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS skip_streaks (
  check_id        TEXT PRIMARY KEY,
  first_skip_ts   TEXT,
  last_skip_ts    TEXT,
  streak_days     INTEGER,
  reason_hash     TEXT,
  bug_link        TEXT
);

CREATE INDEX IF NOT EXISTS idx_check_history_status    ON check_history(status, run_id);
CREATE INDEX IF NOT EXISTS idx_check_history_check_id  ON check_history(check_id, run_id);
CREATE INDEX IF NOT EXISTS idx_check_history_phase     ON check_history(phase);
CREATE INDEX IF NOT EXISTS idx_check_history_fp        ON check_history(fingerprint);
CREATE INDEX IF NOT EXISTS idx_fingerprints_bug_id     ON fingerprints(bug_id);
CREATE INDEX IF NOT EXISTS idx_fingerprints_last_seen  ON fingerprints(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_skip_streaks_days       ON skip_streaks(streak_days DESC);
`;

/**
 * Open (or create) a DatabaseSync at the given path with FKs on and WAL mode.
 * Returns the open handle; caller must .close() it.
 *
 * Schema version (`PRAGMA user_version`) is checked against SCHEMA_VERSION.
 * On mismatch, refuses to open (ADR-0082 — no silent schema drift). Rebuild
 * with: rm <path>; node scripts/catalog-rebuild.mjs --promote-to-sqlite.
 *
 * @param {string} path
 */
export function openDb(path) {
  const DatabaseSync = getDatabaseSync();
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');

  const current = db.prepare('PRAGMA user_version').get()?.user_version ?? 0;
  if (current !== 0 && current !== SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `catalog.db schema v${current} != expected v${SCHEMA_VERSION}. ` +
      `Rebuild: rm ${path}*; node scripts/catalog-rebuild.mjs --promote-to-sqlite`
    );
  }

  db.exec(SCHEMA_SQL);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/**
 * Older catalog rows (Sprint 0) only carry `passed` boolean; the `status`
 * field was added later. Coerce to the SQLite CHECK constraint vocabulary.
 * Cannot distinguish historical skip_accepted from failed — maps both of
 * `passed=false && !status` to `failed` (lossy but surfaces them loudly).
 * @param {{status?:string, passed?:boolean}} row
 */
export function coerceStatus(row) {
  const s = row?.status;
  if (s === 'passed' || s === 'failed' || s === 'skip_accepted') return s;
  return row?.passed ? 'passed' : 'failed';
}

/**
 * Build a short, single-line excerpt of a test's output field, suitable for
 * the output_excerpt column. Strips ANSI, C0 controls, collapses whitespace,
 * truncates to 500 chars. Plain TEXT — never nested JSON (ADR-0096 §Schema).
 */
export function buildExcerpt(output) {
  if (!output) return null;
  let s = String(output);
  s = s.replace(/\x1B\[[0-9;]*m/g, '');             // ANSI CSI sequences
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' '); // C0 + DEL → space
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > 500) s = s.slice(0, 497) + '...';
  return s.length ? s : null;
}

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
 * Normalize a first_error_line to strip run-specific entropy (ANSI, ruflo
 * tmp paths, ISO timestamps, large numbers, hex hashes) before hashing.
 * Per ADR-0096 §Fingerprints — same failure must produce the same hash
 * across runs even when the surface error carries a PID, port, or temp
 * dir suffix that churns.
 * @param {string} s
 */
export function normalizeForFingerprint(s) {
  if (!s) return '';
  return String(s)
    .replace(/\x1B\[[0-9;]*m/g, '')                            // ANSI CSI
    .replace(/\/tmp\/ruflo[-_a-zA-Z0-9]+/g, '<tmp>')            // ruflo tmp dirs
    .replace(/\/private\/tmp\/[^\s'"]+/g, '<tmp>')               // macOS symlink'd tmp
    .replace(/\/var\/folders\/[^\s'"]+/g, '<tmp>')               // macOS per-user tmp
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
    .replace(/\b[0-9a-f]{10,}\b/gi, '<hash>')                   // hex >= 10
    .replace(/\b\d{5,}\b/g, '<n>')                               // PIDs, ports
    .trim();
}

/**
 * sha256(check_id + '\u0001' + normalized_first_error_line + '\u0001' +
 *   fork_file).slice(0, 12). Stable for the same failure across runs per
 * ADR-0096 §Fingerprints — normalized input + sha256-trunc-12 match the
 * impl-plan spec (was sha1 full hex, which churned on PID/path noise).
 * @param {{id:string, output?:string, fork_file?:string}} test
 */
export function fingerprint(test) {
  const id   = String(test?.id ?? '');
  const out  = String(test?.output ?? '');
  const first = out.split('\n').find(l => l.trim().length > 0) || '';
  const fork = String(test?.fork_file ?? '');
  const seed = `${id}\u0001${normalizeForFingerprint(first)}\u0001${fork}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 12);
}

/**
 * Extract the first non-blank line from an output blob, preserving the
 * original text (no normalization). Stored alongside the fingerprint so
 * future fingerprint-function changes can re-hash without losing source.
 * @param {string} output
 */
export function firstErrorLine(output) {
  if (!output) return '';
  return String(output).split('\n').find(l => l.trim().length > 0) || '';
}

/**
 * Derive a phase label from a check_id. Accepts `check_adr<NNNN>_...`,
 * `p<N>-...`, `phase-<N>-...`, or falls back to 'unknown'. Enables the
 * check_history.phase column + index (ADR-0096 Schema).
 * @param {string} checkId
 */
export function derivePhase(checkId) {
  if (!checkId) return 'unknown';
  const s = String(checkId);
  const adr = /^check_adr(\d{4})_/.exec(s);
  if (adr) return `adr${adr[1]}`;
  const pN  = /^p(\d+)[-_]/.exec(s) || /^phase[-_]?(\d+)/.exec(s);
  if (pN) return `p${pN[1]}`;
  return 'unknown';
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
    run_id:            runId,
    ts_utc:            ts,
    wall_ms:           wall,
    check_id:          t.id,
    name:              t.name,
    group:             t.group,
    status:            t.status,
    passed:            !!t.passed,
    duration_ms:       t.duration_ms ?? null,
    output:            t.output ?? '',
    fork_file:         t.fork_file ?? null,
    fingerprint:       fingerprint(t),
    first_error_line:  firstErrorLine(t.output),
    phase:             derivePhase(t.id),
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
// SQLite ingest helpers
// ---------------------------------------------------------------------------

/**
 * Insert (or replace) a single run's rows into the 4 SQLite tables. Caller
 * is responsible for wrapping in a transaction. Idempotent: INSERT OR REPLACE
 * into runs/check_history keyed by (run_id[, check_id]); fingerprints UPSERT.
 * Returns per-table row counts for reconciliation.
 *
 * @param {DatabaseSync} db
 * @param {string} runId
 * @param {Array} rows catalog.jsonl rows for this run (all share run_id)
 */
export function upsertRun(db, runId, rows) {
  if (!rows?.length) return { runs: 0, check_history: 0, fingerprints: 0 };
  const first = rows[0];

  // ADR-0082: empty ts_utc would silently produce days=NaN in skip_streak
  // calculation. Reject loudly instead.
  if (!first.ts_utc) {
    throw new Error(`upsertRun: run ${runId} has empty/missing ts_utc; refusing to write`);
  }

  const passed  = rows.filter(r => coerceStatus(r) === 'passed').length;
  const failed  = rows.filter(r => coerceStatus(r) === 'failed').length;
  const skipped = rows.filter(r => coerceStatus(r) === 'skip_accepted').length;

  db.prepare(`
    INSERT OR REPLACE INTO runs (run_id, ts_utc, total, passed, failed, skipped, wall_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(runId, first.ts_utc, rows.length, passed, failed, skipped, first.wall_ms ?? null);

  // Clear out previous check_history for this run (handles --promote re-runs).
  db.prepare(`DELETE FROM check_history WHERE run_id = ?`).run(runId);

  const insertHist = db.prepare(`
    INSERT INTO check_history
      (run_id, check_id, status, duration_ms, output_excerpt,
       name, group_name, passed, fork_file, fingerprint, first_error_line, phase)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // last_seen = MAX, first_seen = MIN via CASE (SQLite lacks per-column
  // MAX in UPSERT SET). Fixes the last-write-wins bug (review nit 5).
  const upsertFp = db.prepare(`
    INSERT INTO fingerprints (fingerprint, first_seen, last_seen, occurrences)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(fingerprint) DO UPDATE SET
      last_seen   = CASE WHEN excluded.last_seen  > last_seen  THEN excluded.last_seen  ELSE last_seen  END,
      first_seen  = CASE WHEN excluded.first_seen < first_seen THEN excluded.first_seen ELSE first_seen END,
      occurrences = occurrences + 1
  `);

  let histRows = 0;
  let fpRows = 0;
  for (const r of rows) {
    insertHist.run(
      runId,
      r.check_id,
      coerceStatus(r),
      r.duration_ms ?? null,
      buildExcerpt(r.output),
      r.name ?? null,
      r.group ?? null,
      r.passed ? 1 : 0,
      r.fork_file ?? null,
      r.fingerprint ?? null,
      r.first_error_line ?? firstErrorLine(r.output),
      r.phase ?? derivePhase(r.check_id),
    );
    histRows++;
    // Only index fingerprints for non-pass rows — pass fingerprints are noisy
    // and the consumer (coverage-ledger.md bug links) only cares about fails/
    // skips (ADR-0096 §Fingerprints — "stable-across-runs key for failing /
    // skipped checks"). Older JSONL rows without explicit status fall back to
    // coerceStatus which returns 'failed' for !passed — correct behaviour.
    if (coerceStatus(r) !== 'passed' && r.fingerprint) {
      upsertFp.run(r.fingerprint, r.ts_utc, r.ts_utc);
      fpRows++;
    }
  }
  return { runs: 1, check_history: histRows, fingerprints: fpRows };
}

/**
 * Walk check_history in chronological order and rebuild skip_streaks from
 * scratch. A "streak" is an unbroken run of status='skip_accepted' for a
 * given check_id; a pass/fail resets the streak. Returns rows inserted.
 *
 * Day math: (last_skip_ts − first_skip_ts) / 86400s, rounded down.
 *
 * @param {DatabaseSync} db
 */
export function rebuildSkipStreaks(db) {
  db.exec('DELETE FROM skip_streaks');
  // Chronological order: join runs.ts_utc so we walk history forward.
  const rows = db.prepare(`
    SELECT ch.check_id, ch.status, r.ts_utc
    FROM check_history ch
    JOIN runs r ON r.run_id = ch.run_id
    ORDER BY r.ts_utc ASC, ch.check_id ASC
  `).all();

  // Per check_id: track the active skip streak. When a non-skip row arrives
  // the streak is broken and we drop the state; when another skip starts a
  // fresh streak begins. We persist the FINAL active streak (most recent)
  // because SKIP_ROT monitors the currently-open window.
  const active = new Map(); // check_id -> { first_skip_ts, last_skip_ts }
  for (const row of rows) {
    const cid = row.check_id;
    if (row.status === 'skip_accepted') {
      const cur = active.get(cid);
      if (cur) cur.last_skip_ts = row.ts_utc;
      else     active.set(cid, { first_skip_ts: row.ts_utc, last_skip_ts: row.ts_utc });
    } else {
      active.delete(cid);
    }
  }

  const ins = db.prepare(`
    INSERT INTO skip_streaks (check_id, first_skip_ts, last_skip_ts, streak_days)
    VALUES (?, ?, ?, ?)
  `);
  let count = 0;
  for (const [cid, span] of active) {
    const first = Date.parse(span.first_skip_ts);
    const last  = Date.parse(span.last_skip_ts);
    let days = 0;
    if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
      days = Math.floor((last - first) / 86400000);
    }
    ins.run(cid, span.first_skip_ts, span.last_skip_ts, days);
    count++;
  }
  return count;
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

  // Layer-drift detection (review finding 3 — "layer drift on --append
  // compensation"). If JSONL and SQLite disagree on which runs are
  // ingested, the append logic can't safely pick a pending set. Fail loud
  // per ADR-0082; user reconciles via --promote-to-sqlite.
  const jsonlRuns = ingestedRunIds(readCatalog());
  let sqliteRuns = new Set();
  if (existsSync(CATALOG_DB)) {
    const db0 = openDb(CATALOG_DB);
    try {
      const rs = db0.prepare('SELECT run_id FROM runs').all();
      sqliteRuns = new Set(rs.map(r => r.run_id));
    } finally {
      db0.close();
    }
    const jsonlOnly = [...jsonlRuns].filter(r => !sqliteRuns.has(r));
    const sqlOnly = [...sqliteRuns].filter(r => !jsonlRuns.has(r));
    if (sqlOnly.length || jsonlOnly.length) {
      console.error('[catalog-rebuild --append] LAYER DRIFT between catalog.jsonl and catalog.db:');
      console.error(`  JSONL runs: ${jsonlRuns.size}    SQLite runs: ${sqliteRuns.size}`);
      if (jsonlOnly.length) console.error(`  only in JSONL (${jsonlOnly.length}): ${jsonlOnly.slice(0, 5).join(', ')}${jsonlOnly.length > 5 ? ', …' : ''}`);
      if (sqlOnly.length)   console.error(`  only in SQLite (${sqlOnly.length}): ${sqlOnly.slice(0, 5).join(', ')}${sqlOnly.length > 5 ? ', …' : ''}`);
      console.error('[catalog-rebuild --append] reconcile: rm -f test-results/catalog.db* && node scripts/catalog-rebuild.mjs --promote-to-sqlite');
      process.exit(3);
    }
  }

  // Use the union so a run present in either layer counts as ingested.
  const existing = new Set([...jsonlRuns, ...sqliteRuns]);
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

  // Open SQLite alongside the JSONL. Written atomically per-run via
  // BEGIN/COMMIT; if the JSONL append throws we ROLLBACK and bail on that
  // run. If SQLite throws we re-read catalog.jsonl tail and trim (costly,
  // but rare — only on disk-full or OS-signal mid-ingest).
  const db = openDb(CATALOG_DB);

  try {
    for (const runId of pending) {
      const parsed = readAcceptanceJson(resolveRunPath(runId));
      if (!parsed) continue;
      if (!parsed.data) {
        unrecoverable.push({ runId, error: parsed.error, stripped: parsed.stripped });
        continue;
      }
      const rows = flattenRun(runId, parsed.data);
      if (!rows.length) continue;

      // Dual-write transaction: SQLite upsert inside BEGIN; JSONL append
      // after SQLite commit. If JSONL append throws, we reverse the SQLite
      // side by DELETEing the run inside a separate txn.
      const jsonlLine = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
      db.exec('BEGIN IMMEDIATE');
      try {
        upsertRun(db, runId, rows);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      try {
        appendFileSync(CATALOG, jsonlLine);
      } catch (err) {
        // Reverse the SQLite insert so the two layers stay in sync.
        // Compensation itself can fail (disk full, FK, power loss) — if it
        // does we CANNOT auto-recover without re-reading raw. Surface loudly
        // (ADR-0082) with the reconcile instructions; exit 3 distinguishes
        // from --verify's drift (exit 1) and generic infra (exit 2).
        try {
          db.exec('BEGIN IMMEDIATE');
          db.prepare('DELETE FROM runs WHERE run_id = ?').run(runId);
          db.exec('COMMIT');
        } catch (compErr) {
          try { db.exec('ROLLBACK'); } catch { /* already closed */ }
          console.error(`[catalog-rebuild --append] FATAL: JSONL append failed (${err.message})`);
          console.error(`[catalog-rebuild --append]        AND compensation DELETE failed (${compErr.message})`);
          console.error(`[catalog-rebuild --append]        catalog.jsonl and catalog.db now inconsistent for run ${runId}`);
          console.error(`[catalog-rebuild --append]        reconcile: rm -f test-results/catalog.db* && node scripts/catalog-rebuild.mjs --promote-to-sqlite`);
          process.exit(3);
        }
        throw err;
      }

      ingested++;
      totalRows += rows.length;
      totalStripped += parsed.stripped;
      console.log(`[catalog-rebuild --append] ingested ${runId}: ${rows.length} rows (stripped ${parsed.stripped} control-char bytes)`);
    }
    // Rebuild skip_streaks after all runs landed (cheap — one sort + walk).
    if (ingested) rebuildSkipStreaks(db);
  } finally {
    db.close();
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
// --promote-to-sqlite
// ---------------------------------------------------------------------------

function cmdPromoteToSqlite() {
  const rows = readCatalog();
  if (!rows.length) {
    console.error('[catalog-rebuild --promote-to-sqlite] catalog.jsonl is empty — run --from-raw or --append first');
    process.exit(1);
  }
  // Truncate + reinsert. Delete the file outright so IF NOT EXISTS schema is
  // fresh and WAL side-files don't leak stale state.
  for (const ext of ['', '-wal', '-shm']) {
    try { unlinkSync(CATALOG_DB + ext); } catch { /* not there */ }
  }
  const db = openDb(CATALOG_DB);

  // Group by run_id preserving first-seen order (JSONL is already time-ordered
  // by --from-raw / --append, but use a Map for explicit grouping).
  const byRun = new Map();
  for (const r of rows) {
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, []);
    byRun.get(r.run_id).push(r);
  }

  let runsIns = 0, histIns = 0, fpIns = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [runId, runRows] of byRun) {
      const c = upsertRun(db, runId, runRows);
      runsIns += c.runs;
      histIns += c.check_history;
      fpIns += c.fingerprints;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  const streakRows = rebuildSkipStreaks(db);

  // Reconciliation: SQLite check_history count must equal JSONL row count.
  const sqlTotal = db.prepare('SELECT COUNT(*) AS n FROM check_history').get().n;
  db.close();

  if (sqlTotal !== rows.length) {
    console.error(
      `[catalog-rebuild --promote-to-sqlite] RECONCILIATION FAIL: ` +
      `JSONL rows=${rows.length} but SQLite check_history=${sqlTotal}`
    );
    process.exit(1);
  }

  console.log(`[catalog-rebuild --promote-to-sqlite] ${runsIns} runs, ${histIns} check_history, ${fpIns} fingerprint upserts, ${streakRows} skip_streaks`);
  console.log(`[catalog-rebuild --promote-to-sqlite] reconciled: JSONL=${rows.length} SQLite=${sqlTotal}`);
}

// ---------------------------------------------------------------------------
// --export-jsonl (round-trip verification: SQLite → JSONL)
// ---------------------------------------------------------------------------

function cmdExportJsonl() {
  if (!existsSync(CATALOG_DB)) {
    console.error(`[catalog-rebuild --export-jsonl] ${CATALOG_DB} missing — run --promote-to-sqlite first`);
    process.exit(1);
  }
  const db = openDb(CATALOG_DB);
  // Persisted columns-only round-trip. The raw `output` blob is NOT stored
  // in SQLite (only the 500-char `output_excerpt` is), so the export emits
  // `output_excerpt` — the naming is explicit to avoid pretending the export
  // is byte-identical to `catalog.jsonl`'s raw-output rows. All other
  // persisted columns DO round-trip: name, group, passed, fork_file,
  // fingerprint, first_error_line, phase.
  const rows = db.prepare(`
    SELECT ch.run_id, r.ts_utc, r.wall_ms,
           ch.check_id, ch.name, ch.group_name, ch.status, ch.passed,
           ch.duration_ms, ch.output_excerpt,
           ch.fork_file, ch.fingerprint, ch.first_error_line, ch.phase
    FROM check_history ch
    JOIN runs r ON r.run_id = ch.run_id
    ORDER BY r.ts_utc ASC, ch.run_id ASC, ch.check_id ASC
  `).all();
  db.close();
  for (const r of rows) {
    process.stdout.write(JSON.stringify({
      run_id:           r.run_id,
      ts_utc:           r.ts_utc,
      wall_ms:          r.wall_ms,
      check_id:         r.check_id,
      name:             r.name,
      group:            r.group_name,
      status:           r.status,
      passed:           !!r.passed,
      duration_ms:      r.duration_ms,
      output_excerpt:   r.output_excerpt || '',
      fork_file:        r.fork_file,
      fingerprint:      r.fingerprint,
      first_error_line: r.first_error_line,
      phase:            r.phase,
    }) + '\n');
  }
}

// ---------------------------------------------------------------------------
// --flake-hotlist
// ---------------------------------------------------------------------------

function cmdFlakeHotlist() {
  if (!existsSync(CATALOG_DB)) {
    console.error(`[catalog-rebuild --flake-hotlist] ${CATALOG_DB} missing — run --promote-to-sqlite first`);
    process.exit(1);
  }
  const db = openDb(CATALOG_DB);
  // Window: last 20 runs per check_id. SQLite window functions are available
  // on 3.25+, which `node:sqlite` bundles. Flakiness = fails / runs (ignoring
  // skip_accepted — a skip is not a failure).
  const rows = db.prepare(`
    WITH latest_runs AS (
      SELECT run_id FROM runs ORDER BY ts_utc DESC LIMIT 20
    ),
    scoped AS (
      SELECT ch.check_id, ch.status
      FROM check_history ch
      JOIN latest_runs lr ON lr.run_id = ch.run_id
      WHERE ch.status IN ('passed','failed')
    )
    SELECT
      check_id,
      COUNT(*)                                        AS runs_last_20,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS fails_last_20,
      ROUND(1.0 * SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) / COUNT(*), 4) AS flake_rate
    FROM scoped
    GROUP BY check_id
    HAVING flake_rate >= 0.05
    ORDER BY flake_rate DESC, fails_last_20 DESC, check_id ASC
    LIMIT 10
  `).all();
  db.close();

  if (!rows.length) {
    console.log('[catalog-rebuild --flake-hotlist] no checks exceed the 5% flake threshold');
    return;
  }
  console.log('FLAKE HOTLIST (fails_last_20 / runs_last_20 >= 0.05)');
  console.log('─'.repeat(60));
  console.log('  rank  check_id                          fails/runs   rate');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pct = (r.flake_rate * 100).toFixed(1) + '%';
    console.log(`  ${String(i + 1).padStart(4)}  ${r.check_id.padEnd(32).slice(0, 32)}  ${String(r.fails_last_20).padStart(4)}/${String(r.runs_last_20).padEnd(4)}    ${pct.padStart(6)}`);
  }
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

  // SQLite-computed metrics (ADR-0094 Sprint 2). Reconciliation: SQLite must
  // agree with JSONL on the headline numbers; divergence is a layer-integrity
  // bug (ADR-0086 "derived layers must round-trip to raw").
  if (!existsSync(CATALOG_DB)) {
    console.log('');
    console.log('  (catalog.db not built — run --promote-to-sqlite for SQLite metrics)');
    return;
  }
  const db = openDb(CATALOG_DB);
  const sql = db.prepare(`
    SELECT total, passed, failed, skipped
    FROM runs
    WHERE run_id = ?
  `).get(latest);

  if (!sql) {
    console.log('');
    console.log(`  [SQLite] latest run ${latest} not indexed yet — run --promote-to-sqlite`);
    db.close();
    return;
  }

  const drift = [];
  for (const k of ['total', 'passed', 'failed', 'skipped']) {
    if (sql[k] !== s[k]) drift.push({ key: k, jsonl: s[k], sqlite: sql[k] });
  }

  console.log('');
  console.log(`  [SQLite] total=${sql.total} passed=${sql.passed} failed=${sql.failed} skipped=${sql.skipped}`);

  if (drift.length) {
    console.error('  [SQLite] RECONCILIATION FAIL: JSONL and SQLite disagree on latest run');
    for (const d of drift) {
      console.error(`    ${d.key.padEnd(8)} jsonl=${d.jsonl} sqlite=${d.sqlite}`);
    }
    db.close();
    process.exit(1);
  } else {
    console.log('  [SQLite] reconciled: JSONL totals match SQLite totals exactly');
  }

  // Top-5 fail count per-check-id (all history), per Sprint 2 spec.
  const failCounts = db.prepare(`
    SELECT check_id, COUNT(*) AS fails
    FROM check_history
    WHERE status = 'failed'
    GROUP BY check_id
    ORDER BY fails DESC, check_id ASC
    LIMIT 5
  `).all();
  if (failCounts.length) {
    console.log('');
    console.log('  [SQLite] top-5 failing checks (all history):');
    for (const f of failCounts) {
      console.log(`    ${f.check_id.padEnd(36).slice(0, 36)}  ${String(f.fails).padStart(4)} fails`);
    }
  }

  // SKIP_ROT: skip streaks > 30 days.
  const rotRows = db.prepare(`
    SELECT check_id, streak_days, first_skip_ts, last_skip_ts
    FROM skip_streaks
    WHERE streak_days > 30
    ORDER BY streak_days DESC, check_id ASC
    LIMIT 10
  `).all();
  if (rotRows.length) {
    console.log('');
    console.log(`  [SKIP_ROT] ${rotRows.length} check(s) skipped >30 days (top 10):`);
    for (const r of rotRows) {
      console.log(`    ${r.check_id.padEnd(36).slice(0, 36)}  ${String(r.streak_days).padStart(4)}d  since ${r.first_skip_ts || 'unknown'}`);
    }
  }

  db.close();
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
  console.log(
    'Usage: node scripts/catalog-rebuild.mjs ' +
    '[--append|--from-raw|--show|--verify|--promote-to-sqlite|--export-jsonl|--flake-hotlist]',
  );
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
  if      (args.includes('--append'))             cmdAppend();
  else if (args.includes('--from-raw'))           cmdFromRaw();
  else if (args.includes('--promote-to-sqlite'))  cmdPromoteToSqlite();
  else if (args.includes('--export-jsonl'))       cmdExportJsonl();
  else if (args.includes('--flake-hotlist'))      cmdFlakeHotlist();
  else if (args.includes('--show'))               cmdShow();
  else if (args.includes('--verify'))             cmdVerify();
  else                                            usage();
}

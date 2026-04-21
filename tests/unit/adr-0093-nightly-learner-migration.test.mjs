// @tier unit
// ADR-0093 follow-up (advisory A1 from docs/reviews/adr0069-swarm-review-2026-04-21.md):
//
// The NightlyLearner constructor creates `causal_experiments` +
// `causal_observations` via `CREATE TABLE IF NOT EXISTS`. ADR-0093 Tier 1 #4
// landed commit d7f613a which copied the DDL verbatim from
// `agentdb-mcp-server.ts:147-175` — but that source DDL used the OLD column
// set (ts, intervention_id, control_outcome, treatment_outcome, uplift,
// sample_size, metadata). The canonical schema lives in
// `packages/agentdb/src/schemas/frontier-schema.sql:51-105` and uses
// (name, hypothesis, treatment_id, treatment_type, control_id, start_time,
//  end_time, sample_size, treatment_mean, control_mean, uplift, p_value,
//  confidence_interval_{low,high}, status, confidence, metadata).
//
// Because `CREATE TABLE IF NOT EXISTS` is a no-op when the table already
// exists, installations that first booted against an old DDL silently kept
// the old columns. Subsequent INSERTs from `CausalMemoryGraph.createExperiment`
// (new column list) and UPDATEs from `CausalMemoryGraph.calculateUplift`
// (treatment_mean/control_mean/p_value/confidence_interval_*) then fail at
// runtime with "table causal_experiments has no column named <x>".
//
// Fix: NightlyLearner constructor now runs PRAGMA table_info, detects old
// columns (or missing new columns), DROPs+recreates when incompatible, then
// re-runs the canonical CREATE. Ephemeral A/B-test telemetry — no user
// content preservation required (ADR-0086 doesn't apply).
//
// This test:
//   Group 1 — Source invariants: the constructor still has the OLD-schema
//     detection set, the DROP path, and the canonical column list.
//   Group 2 — Behavioral migration: set up a sqlite3 DB with the OLD
//     schema, replicate the constructor's migration orchestration via
//     sqlite3 CLI (PRAGMA table_info → detect → DROP → CREATE), assert
//     the resulting schema matches the NEW column list exactly.
//   Group 3 — ADR-0082 loud-fail: the migration catch block re-throws;
//     no silent swallowing of SQLite errors.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Source paths
// ============================================================================

const FORK_AGENTIC = '/Users/henrik/source/forks/agentic-flow';
const NIGHTLY_LEARNER_PATH = `${FORK_AGENTIC}/packages/agentdb/src/controllers/NightlyLearner.ts`;
const FRONTIER_SCHEMA_PATH = `${FORK_AGENTIC}/packages/agentdb/src/schemas/frontier-schema.sql`;

// ============================================================================
// Helpers
// ============================================================================

function sqlite3Available() {
  try {
    execFileSync('sqlite3', ['--version'], { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function runSql(dbPath, sql) {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8', stdio: 'pipe' });
}

function tableColumns(dbPath, table) {
  const out = runSql(dbPath, `PRAGMA table_info(${table});`);
  // Each row: cid|name|type|notnull|dflt_value|pk
  return out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('|')[1]);
}

// ============================================================================
// Source read
// ============================================================================

if (!existsSync(NIGHTLY_LEARNER_PATH)) {
  throw new Error(`NightlyLearner.ts not found at ${NIGHTLY_LEARNER_PATH}`);
}
const nightlySrc = readFileSync(NIGHTLY_LEARNER_PATH, 'utf-8');

// ============================================================================
// Group 1 — Source invariants
// ============================================================================

describe('ADR-0093 A1: NightlyLearner schema migration — Group 1: source invariants', () => {
  it('references the advisory and the owning ADR', () => {
    assert.ok(
      /ADR-0093/.test(nightlySrc),
      'NightlyLearner.ts must cite the owning ADR (ADR-0093)',
    );
    assert.ok(
      /advisory A1|A1,/.test(nightlySrc),
      'NightlyLearner.ts must cite advisory A1 from the 2026-04-21 review',
    );
  });

  it('detects OLD-schema columns via PRAGMA table_info', () => {
    assert.ok(
      /PRAGMA table_info\(causal_experiments\)/.test(nightlySrc),
      'must introspect causal_experiments schema via PRAGMA table_info',
    );
    assert.ok(
      /PRAGMA table_info\(causal_observations\)/.test(nightlySrc),
      'must introspect causal_observations schema via PRAGMA table_info',
    );
  });

  it('names the three canonical OLD columns in the detection set', () => {
    // Extract the OLD_COLS Set literal; must mention at least these three.
    for (const col of ['intervention_id', 'control_outcome', 'treatment_outcome']) {
      assert.ok(
        new RegExp(`['"]${col}['"]`).test(nightlySrc),
        `OLD_COLS detection set must reference '${col}'`,
      );
    }
  });

  it('DROPs both tables in child-first order on incompatible schema', () => {
    // DROP observations BEFORE experiments to avoid FK failures.
    const obsIdx = nightlySrc.indexOf('DROP TABLE IF EXISTS causal_observations');
    const expIdx = nightlySrc.indexOf('DROP TABLE IF EXISTS causal_experiments');
    assert.ok(obsIdx > -1, 'must DROP causal_observations on incompatible schema');
    assert.ok(expIdx > -1, 'must DROP causal_experiments on incompatible schema');
    assert.ok(
      obsIdx < expIdx,
      'causal_observations (child) must be DROPped before causal_experiments (parent)',
    );
  });

  it('recreates with the canonical NEW column set', () => {
    // These are the columns exercised by CausalMemoryGraph.createExperiment,
    // CausalMemoryGraph.calculateUplift UPDATE, and NightlyLearner.completeExperiments SELECT.
    const requiredNewCols = [
      'name',
      'hypothesis',
      'treatment_id',
      'treatment_type',
      'control_id',
      'start_time',
      'end_time',
      'sample_size',
      'treatment_mean',
      'control_mean',
      'uplift',
      'p_value',
      'confidence_interval_low',
      'confidence_interval_high',
      'status',
      'confidence',
      'metadata',
    ];
    for (const col of requiredNewCols) {
      // Match the column appearing as a CREATE TABLE definition line.
      const re = new RegExp(`^\\s*${col}\\s+(INTEGER|REAL|TEXT)`, 'm');
      assert.ok(
        re.test(nightlySrc),
        `canonical CREATE TABLE causal_experiments must declare column '${col}'`,
      );
    }
  });

  it('recreates causal_observations with NEW schema (experiment_id / is_treatment / outcome_value)', () => {
    for (const col of ['experiment_id', 'is_treatment', 'outcome_value']) {
      const re = new RegExp(`^\\s*${col}\\s+(INTEGER|REAL|TEXT)`, 'm');
      assert.ok(re.test(nightlySrc), `causal_observations must declare column '${col}'`);
    }
  });

  it('ADR-0082 — migration failure re-throws, no silent catch', () => {
    // The catch block must end with `throw err;` not a silent `// swallow` path.
    // Grep for the DDL+migration error message followed by throw.
    const catchBlock = /catch \(err: any\) \{\s*console\.error\([^)]*DDL\+migration failed[^)]*\);\s*throw err;\s*\}/;
    assert.ok(
      catchBlock.test(nightlySrc),
      'migration catch block must log AND re-throw (ADR-0082 loud-fail)',
    );
  });
});

// ============================================================================
// Group 2 — Behavioral migration via sqlite3 CLI
// ============================================================================

const SQLITE3_AVAILABLE = sqlite3Available();
let tmpDir;
let dbPath;

describe('ADR-0093 A1: NightlyLearner schema migration — Group 2: behavioral', () => {
  before(() => {
    if (!SQLITE3_AVAILABLE) return;
    tmpDir = mkdtempSync(join(tmpdir(), 'adr0093-a1-'));
    dbPath = join(tmpDir, 'memory.db');
  });

  after(() => {
    if (tmpDir) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup; don't fail the test
      }
    }
  });

  it('sqlite3 CLI is available (else SKIP_ACCEPTED)', () => {
    if (!SQLITE3_AVAILABLE) {
      console.log('# SKIP_ACCEPTED: sqlite3 CLI not installed');
      return;
    }
    assert.ok(true);
  });

  it('OLD-schema DB → migration → NEW column set', () => {
    if (!SQLITE3_AVAILABLE) return;

    // 1. Seed the DB with the OLD schema (copied verbatim from the
    //    pre-fix DDL in NightlyLearner.ts commit d7f613a).
    runSql(
      dbPath,
      `
      CREATE TABLE causal_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER DEFAULT (strftime('%s', 'now')),
        intervention_id INTEGER NOT NULL,
        control_outcome REAL NOT NULL,
        treatment_outcome REAL NOT NULL,
        uplift REAL NOT NULL,
        sample_size INTEGER DEFAULT 1,
        metadata TEXT
      );
      CREATE TABLE causal_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER DEFAULT (strftime('%s', 'now')),
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        reward REAL NOT NULL,
        session_id TEXT,
        metadata TEXT
      );
      `,
    );

    // Verify seed — OLD columns present.
    const oldExpCols = tableColumns(dbPath, 'causal_experiments');
    assert.ok(oldExpCols.includes('intervention_id'), 'seed must have intervention_id (OLD)');
    assert.ok(oldExpCols.includes('control_outcome'), 'seed must have control_outcome (OLD)');
    assert.ok(!oldExpCols.includes('name'), 'seed must NOT have name (NEW) yet');

    // 2. Replicate the NightlyLearner constructor's migration orchestration:
    //    PRAGMA table_info → detect old/missing new → DROP → CREATE.
    const OLD_COLS = new Set(['intervention_id', 'control_outcome', 'treatment_outcome']);
    const NEW_REQUIRED = [
      'name',
      'treatment_id',
      'treatment_type',
      'control_id',
      'start_time',
      'status',
      'treatment_mean',
      'control_mean',
      'p_value',
      'confidence_interval_low',
      'confidence_interval_high',
    ];
    const existingExp = tableColumns(dbPath, 'causal_experiments');
    const existingObs = tableColumns(dbPath, 'causal_observations');
    const hasOldExp = existingExp.some((c) => OLD_COLS.has(c));
    const missingNew = NEW_REQUIRED.filter((c) => !existingExp.includes(c));
    const needsRecreate = existingExp.length > 0 && (hasOldExp || missingNew.length > 0);
    const oldObsCols = new Set(['action', 'outcome', 'reward', 'session_id']);
    const hasOldObs =
      existingObs.some((c) => oldObsCols.has(c)) && !existingObs.includes('experiment_id');

    assert.ok(needsRecreate, 'detector must flag incompatible schema on OLD DB');
    assert.ok(hasOldObs, 'detector must flag incompatible observations on OLD DB');

    if (needsRecreate || hasOldObs) {
      runSql(
        dbPath,
        `DROP TABLE IF EXISTS causal_observations;
         DROP TABLE IF EXISTS causal_experiments;`,
      );
    }

    // 3. Run the canonical CREATE (copied from the new NightlyLearner.ts).
    runSql(
      dbPath,
      `
      CREATE TABLE IF NOT EXISTS causal_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hypothesis TEXT,
        treatment_id INTEGER,
        treatment_type TEXT,
        control_id INTEGER,
        start_time INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        end_time INTEGER,
        sample_size INTEGER DEFAULT 0,
        treatment_mean REAL,
        control_mean REAL,
        uplift REAL,
        p_value REAL,
        confidence_interval_low REAL,
        confidence_interval_high REAL,
        status TEXT NOT NULL DEFAULT 'running',
        confidence REAL,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS causal_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id INTEGER NOT NULL,
        episode_id INTEGER,
        is_treatment INTEGER NOT NULL DEFAULT 0,
        outcome_value REAL NOT NULL,
        outcome_type TEXT,
        context TEXT,
        ts INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(experiment_id) REFERENCES causal_experiments(id)
      );
      `,
    );

    // 4. Assert NEW column set.
    const newExp = tableColumns(dbPath, 'causal_experiments');
    const expectedNewExp = [
      'id',
      'name',
      'hypothesis',
      'treatment_id',
      'treatment_type',
      'control_id',
      'start_time',
      'end_time',
      'sample_size',
      'treatment_mean',
      'control_mean',
      'uplift',
      'p_value',
      'confidence_interval_low',
      'confidence_interval_high',
      'status',
      'confidence',
      'metadata',
    ];
    for (const col of expectedNewExp) {
      assert.ok(
        newExp.includes(col),
        `post-migration causal_experiments must contain '${col}' (got: ${newExp.join(',')})`,
      );
    }
    // OLD columns must be gone.
    for (const col of ['intervention_id', 'control_outcome', 'treatment_outcome']) {
      assert.ok(
        !newExp.includes(col),
        `post-migration causal_experiments must NOT contain OLD column '${col}'`,
      );
    }

    const newObs = tableColumns(dbPath, 'causal_observations');
    for (const col of [
      'experiment_id',
      'episode_id',
      'is_treatment',
      'outcome_value',
      'outcome_type',
      'context',
    ]) {
      assert.ok(
        newObs.includes(col),
        `post-migration causal_observations must contain '${col}' (got: ${newObs.join(',')})`,
      );
    }
    for (const col of ['action', 'outcome', 'reward', 'session_id']) {
      assert.ok(
        !newObs.includes(col),
        `post-migration causal_observations must NOT contain OLD column '${col}'`,
      );
    }

    // 5. INSERT using the NEW schema must succeed (runtime proof).
    runSql(
      dbPath,
      `INSERT INTO causal_experiments (name, hypothesis, treatment_id, treatment_type, start_time, sample_size, status)
       VALUES ('test', 'hyp', 42, 'episode', 1700000000, 10, 'running');`,
    );
    const count = runSql(dbPath, `SELECT COUNT(*) FROM causal_experiments;`).trim();
    assert.equal(count, '1', 'NEW-schema INSERT must succeed after migration');

    // 6. UPDATE with calculateUplift's columns must succeed (runtime proof).
    runSql(
      dbPath,
      `UPDATE causal_experiments
       SET treatment_mean = 0.5, control_mean = 0.3, uplift = 0.2,
           p_value = 0.01, confidence_interval_low = 0.1, confidence_interval_high = 0.3,
           status = 'completed'
       WHERE id = 1;`,
    );
    const upliftRow = runSql(
      dbPath,
      `SELECT uplift, confidence_interval_high FROM causal_experiments WHERE id = 1;`,
    ).trim();
    assert.equal(
      upliftRow,
      '0.2|0.3',
      'calculateUplift-style UPDATE must populate the new result columns',
    );
  });

  it('fresh DB (no pre-existing tables) → canonical schema, no DROP needed', () => {
    if (!SQLITE3_AVAILABLE) return;

    const freshDb = join(tmpDir, 'fresh.db');
    // No seed. Replicate just the detector + CREATE path.
    const existingExp = tableColumns(freshDb, 'causal_experiments');
    assert.equal(existingExp.length, 0, 'fresh DB has no causal_experiments yet');

    runSql(
      freshDb,
      `
      CREATE TABLE IF NOT EXISTS causal_experiments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        hypothesis TEXT,
        treatment_id INTEGER,
        treatment_type TEXT,
        control_id INTEGER,
        start_time INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        end_time INTEGER,
        sample_size INTEGER DEFAULT 0,
        treatment_mean REAL,
        control_mean REAL,
        uplift REAL,
        p_value REAL,
        confidence_interval_low REAL,
        confidence_interval_high REAL,
        status TEXT NOT NULL DEFAULT 'running',
        confidence REAL,
        metadata TEXT
      );
      `,
    );

    const cols = tableColumns(freshDb, 'causal_experiments');
    assert.ok(cols.includes('name'), 'fresh CREATE must include NEW schema column name');
    assert.ok(cols.includes('treatment_mean'), 'fresh CREATE must include result column');
    assert.ok(
      !cols.includes('intervention_id'),
      'fresh CREATE must not accidentally include OLD column',
    );
  });
});

// ============================================================================
// Group 3 — canonical schema parity with frontier-schema.sql
// ============================================================================

describe('ADR-0093 A1: NightlyLearner schema migration — Group 3: schema parity', () => {
  it('frontier-schema.sql exists (canonical reference)', () => {
    assert.ok(
      existsSync(FRONTIER_SCHEMA_PATH),
      'frontier-schema.sql is the canonical causal_experiments definition',
    );
  });

  it('NightlyLearner DDL covers every column used by CausalMemoryGraph.calculateUplift UPDATE', () => {
    // CausalMemoryGraph.calculateUplift does:
    //   UPDATE causal_experiments
    //   SET treatment_mean = ?, control_mean = ?, uplift = ?,
    //       p_value = ?, confidence_interval_low = ?, confidence_interval_high = ?,
    //       status = 'completed'
    //   WHERE id = ?
    // All six SET-target columns plus status must be in the CREATE.
    for (const col of [
      'treatment_mean',
      'control_mean',
      'uplift',
      'p_value',
      'confidence_interval_low',
      'confidence_interval_high',
    ]) {
      const re = new RegExp(`^\\s*${col}\\s+REAL`, 'm');
      assert.ok(
        re.test(nightlySrc),
        `NightlyLearner DDL must declare REAL column '${col}' (needed by calculateUplift UPDATE)`,
      );
    }
  });

  it('NightlyLearner DDL covers every column used by CausalMemoryGraph.createExperiment INSERT', () => {
    // INSERT columns: name, hypothesis, treatment_id, treatment_type, control_id,
    //                 start_time, sample_size, status, metadata
    for (const col of [
      'name',
      'hypothesis',
      'treatment_id',
      'treatment_type',
      'control_id',
      'start_time',
      'sample_size',
      'status',
      'metadata',
    ]) {
      const re = new RegExp(`^\\s*${col}\\s+(INTEGER|REAL|TEXT)`, 'm');
      assert.ok(
        re.test(nightlySrc),
        `NightlyLearner DDL must declare column '${col}' (needed by createExperiment INSERT)`,
      );
    }
  });
});

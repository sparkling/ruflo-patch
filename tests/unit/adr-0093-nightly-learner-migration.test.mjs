// @tier unit
// ADR-0093 A1 (advisory from docs/reviews/adr0069-swarm-review-2026-04-21.md),
// re-expressed for the ADR-0177 single-source-schema architecture.
//
// ORIGINAL bug (ADR-0093): NightlyLearner's constructor created
// `causal_experiments` / `causal_observations` with its OWN
// `CREATE TABLE IF NOT EXISTS` DDL. That DDL drifted from the columns
// `CausalMemoryGraph`'s INSERT/UPDATE used, so installs that first booted
// against the old DDL hit runtime "table … has no column named <x>" failures.
// The original fix bolted a runtime PRAGMA-migration onto NightlyLearner
// (PRAGMA table_info → detect OLD cols → DROP → recreate).
//
// ADR-0177 eliminates the bug class at the root: the canonical schema lives in
// ONE place — `forks/agentdb/src/schemas/frontier-schema.sql` — and the
// controllers no longer carry their own DDL. NightlyLearner only READS
// `causal_experiments`. The runtime PRAGMA migration is therefore gone *by
// design* (single canonical source, nothing to migrate against), not reverted
// by accident. So the old migration-mechanism tests (PRAGMA/DROP/OLD_COLS
// detection, sqlite3-CLI behavioral sim) tested removed implementation and are
// deleted.
//
// The residual risk is the SAME failure mode through a new door: a controller
// querying a column the canonical schema does not define. This test pins the
// post-ADR-0177 invariants that guard it:
//   1. frontier-schema.sql is the single source and defines both causal tables
//      with the column set createExperiment INSERT + calculateUplift UPDATE use.
//   2. The canonical schema does NOT carry the OLD pre-ADR-0093 columns.
//   3. Every causal_experiments column NightlyLearner SELECTs is defined there
//      (no "no such column" at runtime).
//   4. NightlyLearner carries NO controller-local CREATE TABLE for these tables
//      (single-source enforcement — the exact drift ADR-0093 was about must not
//      return).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_AGENTDB = '/Users/henrik/source/forks/agentdb';
const NIGHTLY_LEARNER_PATH = `${FORK_AGENTDB}/src/controllers/NightlyLearner.ts`;
const FRONTIER_SCHEMA_PATH = `${FORK_AGENTDB}/src/schemas/frontier-schema.sql`;

assert.ok(existsSync(FRONTIER_SCHEMA_PATH), `canonical schema missing: ${FRONTIER_SCHEMA_PATH}`);
assert.ok(existsSync(NIGHTLY_LEARNER_PATH), `NightlyLearner.ts missing: ${NIGHTLY_LEARNER_PATH}`);
const schemaSrc = readFileSync(FRONTIER_SCHEMA_PATH, 'utf-8');
const nightlySrc = readFileSync(NIGHTLY_LEARNER_PATH, 'utf-8');

// Extract the body of a `CREATE TABLE [IF NOT EXISTS] <table> ( … );` block.
function createTableBlock(sql, table) {
  const re = new RegExp(
    `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${table}\\s*\\(([\\s\\S]*?)\\n\\s*\\);`,
    'i',
  );
  const m = sql.match(re);
  return m ? m[1] : null;
}

// Column-definition lines start with `<ident> <TYPE>`; constraint/index lines
// (FOREIGN KEY, PRIMARY KEY, CHECK, …) and comments are skipped.
function declaredColumns(block) {
  return block
    .split('\n')
    .map((l) => l.trim())
    .map((l) => l.match(/^([a-z_][a-z0-9_]*)\s+(INTEGER|REAL|TEXT|BLOB|BOOLEAN|NUMERIC|JSON)\b/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

describe('ADR-0093 A1 (ADR-0177 single-source): causal schema parity', () => {
  it('frontier-schema.sql defines causal_experiments + causal_observations', () => {
    assert.ok(createTableBlock(schemaSrc, 'causal_experiments'), 'canonical causal_experiments CREATE TABLE missing');
    assert.ok(createTableBlock(schemaSrc, 'causal_observations'), 'canonical causal_observations CREATE TABLE missing');
  });

  it('canonical causal_experiments declares every column createExperiment INSERT + calculateUplift UPDATE use', () => {
    const cols = declaredColumns(createTableBlock(schemaSrc, 'causal_experiments'));
    const required = [
      // createExperiment INSERT
      'name', 'hypothesis', 'treatment_id', 'treatment_type', 'control_id',
      'start_time', 'sample_size', 'status', 'metadata',
      // calculateUplift UPDATE
      'treatment_mean', 'control_mean', 'uplift', 'p_value',
      'confidence_interval_low', 'confidence_interval_high',
    ];
    for (const c of required) {
      assert.ok(cols.includes(c), `canonical causal_experiments must declare '${c}' (got: ${cols.join(',')})`);
    }
  });

  it('canonical causal_observations declares experiment_id / is_treatment / outcome_value', () => {
    const cols = declaredColumns(createTableBlock(schemaSrc, 'causal_observations'));
    for (const c of ['experiment_id', 'is_treatment', 'outcome_value']) {
      assert.ok(cols.includes(c), `canonical causal_observations must declare '${c}' (got: ${cols.join(',')})`);
    }
  });

  it('canonical causal_experiments does NOT carry the OLD pre-ADR-0093 columns', () => {
    const cols = declaredColumns(createTableBlock(schemaSrc, 'causal_experiments'));
    for (const c of ['intervention_id', 'control_outcome', 'treatment_outcome']) {
      assert.ok(!cols.includes(c), `canonical causal_experiments must NOT carry OLD column '${c}'`);
    }
  });

  it('every causal_experiments column NightlyLearner SELECTs is defined by the canonical schema', () => {
    // Columns NightlyLearner references in its causal_experiments queries
    // (completeExperiments + createExperiments, NightlyLearner.ts ~579-640).
    const cols = declaredColumns(createTableBlock(schemaSrc, 'causal_experiments'));
    for (const c of ['id', 'start_time', 'sample_size', 'status', 'treatment_id']) {
      assert.ok(
        cols.includes(c),
        `NightlyLearner reads causal_experiments.${c}, but the canonical schema does not define it`,
      );
    }
  });

  it('NightlyLearner carries NO controller-local CREATE TABLE for the causal tables (single-source)', () => {
    // ADR-0177: schema is sourced from frontier-schema.sql, not duplicated in
    // the controller. A controller-local `CREATE TABLE causal_*` is exactly the
    // drift ADR-0093 was about — assert it has not returned.
    assert.doesNotMatch(
      nightlySrc,
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?causal_(?:experiments|observations)/i,
      'NightlyLearner must not define its own causal_* DDL; the canonical source is frontier-schema.sql',
    );
  });
});

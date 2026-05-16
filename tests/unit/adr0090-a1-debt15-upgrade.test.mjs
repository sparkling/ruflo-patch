// @tier unit
// ADR-0090 Tier A1: Debt 15 guard against the postgres substrate (ADR-0170 Phase B).
//
// Context
// -------
// The original ADR-0090 Tier A1 upgrade guarded ADR-0086's Debt 15 trade-off
// against the SQLite substrate. ADR-0170 Phase B retires SQLite on the
// agentdb_* axis; the trade-off survives but the substrate is now pglite.
// `check_adr0086_debt15_sqlite_path` (name kept for ledger continuity) and
// `_debt15_count_reflexion_rows` were rewritten in 2026-05-12 to probe the
// pglite cluster via a Node oneliner (`await import('@electric-sql/pglite')`),
// replacing the prior `sqlite3 <db_file>` invocation.
//
// What this file covers
// ---------------------
// Static-source assertions on the rewritten check:
//   1. `check_adr0086_debt15_sqlite_path` and `_debt15_count_reflexion_rows`
//      are still defined as bash functions.
//   2. The helper queries `to_regclass('public.episodes')` (postgres-form
//      "table exists" probe) instead of `sqlite_master`.
//   3. The helper uses `await import('@electric-sql/pglite')` for cluster
//      access — proves it shells to Node with the pglite ESM dynamic import,
//      not to `sqlite3` CLI or `better-sqlite3` Node binding.
//   4. The main check asserts `.swarm/memory.pglite/PG_VERSION` exists as
//      the bootstrap canary, instead of `.swarm/memory.db` magic header.
//   5. The kill-and-reopen persistence proof still calls
//      `_debt15_count_reflexion_rows` twice (pre/post restart).
//   6. The MCP marker task string remains unchanged so cross-version
//      seeding stays compatible.
//   7. `_adr0086_find_cli_pkg` + `memory-router.js` grep guards survive
//      (the sqlite config block in memory-router still passes through).
//   8. The check uses `$(_cli_cmd)`, never raw `npx --yes @sparkleideas/cli@latest`
//      (CLAUDE.md rule).
//
// Runtime testing of the postgres-substrate path is covered by the
// acceptance suite — pglite cold-init in a unit-test sandbox is heavy
// (~673 ms per spawn) and replicates what acceptance already exercises
// at full coverage.
//
// Reference: SHIPMD `feedback-no-squelch-tests` — this rewrite REPLACES the
// SQLite-mocked tests because the substrate they tested no longer exists.
// Cases 1-8 in the prior file mocked sqlite3 PATH shims; cases that asserted
// `SQLite format 3` magic or sqlite_master table queries cannot be reused —
// the bash code no longer issues those calls.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0086-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const TEST_ACCEPTANCE_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

/**
 * Extract a bash function body by name. Matches `<name>() {` and balances
 * braces by counting (good-enough for the well-formed functions in
 * acceptance-adr0086-checks.sh).
 */
function extractFn(source, fnName) {
  const re = new RegExp(`${fnName}\\(\\)\\s*\\{`, 'm');
  const startMatch = source.match(re);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  return depth === 0 ? source.slice(start, i - 1) : null;
}

describe('ADR-0090 Tier A1: static source — pglite substrate (ADR-0170 Phase B)', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('check_adr0086_debt15_sqlite_path still exists as a function (name kept for ledger continuity)', () => {
    assert.match(source, /check_adr0086_debt15_sqlite_path\(\)\s*\{/,
      'function definition must still be present');
  });

  it('introduces _debt15_count_reflexion_rows helper', () => {
    assert.match(source, /_debt15_count_reflexion_rows\(\)\s*\{/,
      'helper function must be defined');
  });

  it('helper queries to_regclass for postgres table existence (replaces sqlite_master)', () => {
    const helper = extractFn(source, '_debt15_count_reflexion_rows');
    assert.ok(helper, 'helper body must extract');
    assert.match(helper, /to_regclass\('public\.episodes'\)/,
      'helper must probe to_regclass for postgres `episodes` table');
  });

  it('helper queries episodes.task with the ADR-0090 A1 marker prefix', () => {
    const helper = extractFn(source, '_debt15_count_reflexion_rows');
    assert.match(helper, /task LIKE 'acceptance test reflexion adr0090/,
      'helper must filter episodes by the ADR-0090 A1 marker task');
  });

  it('uses pglite via Node ESM dynamic import (not sqlite3 CLI, not better-sqlite3)', () => {
    const helper = extractFn(source, '_debt15_count_reflexion_rows');
    const mainFn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.ok(helper && mainFn, 'both function bodies must extract');
    const combined = helper + '\n' + mainFn;
    assert.match(combined, /await import\('@electric-sql\/pglite'\)/,
      'must use dynamic ESM import of @electric-sql/pglite');
    assert.match(combined, /new PGlite\(/,
      'must construct a PGlite instance');
    // Strip comments before checking for prohibited active uses.
    const noComments = combined
      .split('\n')
      .filter(line => !/^\s*#/.test(line))
      .join('\n');
    assert.doesNotMatch(noComments, /sqlite3 "\$db_file"/,
      'sqlite3 CLI invocation must be removed');
    assert.doesNotMatch(noComments, /require\(['"]better-sqlite3['"]\)/,
      'must NOT require() better-sqlite3');
    assert.doesNotMatch(noComments, /import.*better-sqlite3/,
      'must NOT import better-sqlite3');
  });

  it('asserts .swarm/memory.db SQLite carve-out exists (post-Phase-7 substrate)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.ok(fn, 'function body must extract');
    assert.match(fn, /\.swarm\/memory\.db/,
      'must check for SQLite carve-out (post-pglite, post-Phase-7)');
    assert.match(fn, /name='episodes'/,
      'must verify episodes table exists in the SQLite carve-out');
    assert.doesNotMatch(fn.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'),
      /SQLite format 3/,
      'must NOT check SQLite magic header (verifies via sqlite3 CLI instead)');
  });

  it('invokes agentdb_reflexion-store via MCP with the marker task', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.match(fn, /agentdb_reflexion-store/,
      'function must call the agentdb_reflexion-store MCP tool (hyphenated — the registered name)');
    assert.match(fn, /acceptance test reflexion adr0090/,
      'function must use the ADR-0090 A1 marker task string');
  });

  it('performs the kill-and-reopen persistence proof (two row-count queries)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    const matches = fn.match(/_debt15_count_reflexion_rows/g) || [];
    assert.ok(matches.length >= 2,
      `expected >= 2 calls to _debt15_count_reflexion_rows (one pre-restart, one post-restart), got ${matches.length}`);
  });

  it('retains memory-router.js sqlite-config-passthrough guard (ADR-0170 keeps sqlite block for legacy compat)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.match(fn, /memory-router\.js/, 'memory-router.js grep guard kept');
    assert.match(fn, /_adr0086_find_cli_pkg/, 'CLI package locator kept');
    assert.match(fn, /grep -q 'sqlite' "\$router_js"/,
      'sqlite config pass-through grep must remain (legacy caller compat)');
  });

  it('asserts SQLite db non-empty (episodes table + size >= 1024)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.match(fn, /name='episodes'/,
      'must verify episodes table exists in .swarm/memory.db (post-Phase-7 carve-out)');
    assert.match(fn, /cluster_size.*1024|1024/,
      'must check minimum SQLite db size (>= 1024 bytes for any real schema bootstrap)');
  });

  it('uses $(_cli_cmd), never raw "npx --yes @sparkleideas/cli@latest"', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.doesNotMatch(fn, /npx\s+--yes\s+@sparkleideas\/cli@latest/,
      'CLAUDE.md rule: never use raw npx @latest in acceptance (36x slowdown)');
    assert.match(fn, /\$\(_cli_cmd\)/, 'must use $(_cli_cmd) helper');
  });
});

describe('ADR-0090 Tier A1: harness plumbing', () => {
  it('acceptance-harness.sh already supports skip_accepted bucket (from Tier A2)', () => {
    const src = readFileSync(HARNESS_FILE, 'utf-8');
    assert.match(src, /skip_accepted/,
      'harness must understand skip_accepted bucket');
  });

  it('scripts/test-acceptance.sh wires check_adr0086_debt15_sqlite_path', () => {
    const src = readFileSync(TEST_ACCEPTANCE_FILE, 'utf-8');
    assert.match(src, /check_adr0086_debt15_sqlite_path/,
      'test-acceptance.sh must call the Debt 15 check function');
  });
});

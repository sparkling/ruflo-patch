#!/usr/bin/env node
/**
 * Smoke test: ADR-0261 Phase 1 — graph_edges schema migration
 *
 * Mirrors upstream's `smoke-graph-schema-migration.mjs` (P1) re-targeted at the
 * fork's `agentdb` substrate: after `cli init --full --force` the
 * `graph_edges` table created by the agentdb schema loader must be present
 * with the full 12-column shape and 5 indexes. FK to `memory_entries` is
 * deferred per ADR-0261's IMPLEMENTATION NOTE — cross-package schema
 * impedance (cli's `memory_entries` lives in a different package); the
 * smoke asserts the deferral is documented at the schema layer.
 *
 * Acceptance criteria (per ADR-0261 §R2.8 deliverable #4 + §R2.6 C5):
 *   1. graph_edges table exists after init
 *   2. All 12 columns present (id, source_id, target_id, relation, weight,
 *      confidence, decay_rate, last_reinforced, witness_id, embedding_ref,
 *      metadata, created_at)
 *   3. All 5 indexes present (idx_graph_edges_triple, _last_reinforced,
 *      _witness, _src, _dst)
 *   4. FK to memory_entries DEFERRED at schema layer (cross-package
 *      impedance per IMPLEMENTATION NOTE); enforced at handler/invariant.
 *      Asserts 0 FKs at schema — flipping to non-zero requires updating
 *      both the schema's NOTE and this assertion.
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE; never pipes
 * through tail/head.
 * Per `project-rvf-test-artifact-resolution`: structured progress goes to
 * stderr (stdout is the MCP JSON-RPC channel for any nested CLI MCP probes).
 * Per `feedback-no-squelch-tests`: missing tables/columns FAIL loudly — no
 * silent fallback.
 *
 * Usage: node scripts/smoke-graph-schema-migration.mjs
 *
 * Exit codes:
 *   0 — all assertions passed
 *   1 — at least one assertion failed
 *
 * Dependencies: Agent A's agentdb fork (graph-edges.sql + schema loader
 * extension) must be built/published before this smoke can pass.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSmokePerf, setupSmokeTempDir, installAndInit, findCli } from './lib/smoke-adr0261-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-graph-schema-${Date.now()}.log`);

const perf = createSmokePerf('smoke-graph-schema-migration');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function assert(cond, label, reason = '') { cond ? pass(label) : fail(label, reason || 'assertion false'); }

function findMemoryDb(tempDir) {
  // Fork uses .swarm/memory.db per memory-router; agentdb may also place
  // graph_edges in .claude-flow/agentdb/memory.db depending on substrate
  // routing. Probe both.
  for (const rel of ['.swarm/memory.db', '.claude-flow/agentdb/memory.db', '.claude-flow/memory.db']) {
    const p = join(tempDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

function sqliteQuery(dbPath, sql) {
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, output: r.stderr || r.stdout, lines: [] };
  }
  const output = (r.stdout || '').trim();
  return { ok: true, output, lines: output ? output.split('\n') : [] };
}

function main() {
  log(`\n[ADR-0261 P1 smoke] graph_edges schema migration`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-graph-schema', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    let cli;
    if (shared) {
      cli = findCli(tempDir);
      if (!cli) {
        log(`[setup] FATAL: cli not found in shared subdir ${tempDir}`);
        process.exit(1);
      }
    } else {
      cli = installAndInit(tempDir, perf, REGISTRY);
    }
    // test-body excludes setup phases above, so the analyzer can sum
    // {setup-mkdtemp, setup-npm-install, init-cli-full, init-memory, test-body}
    // ≈ total.
    testBodyStart = process.hrtime.bigint();

    const dbPath = findMemoryDb(tempDir);
    if (!dbPath) {
      fail('1: locate memory.db',
        `no memory.db found in ${tempDir} under .swarm/ or .claude-flow/agentdb/`);
      throw new Error('no memory.db');
    }
    pass(`0a: memory.db located at ${dbPath}`);

    // ─── TEST 1: graph_edges table exists ─────────────────────────────────
    log(`\nTEST 1: graph_edges table exists`);
    const tableQ = sqliteQuery(dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_edges'");
    assert(tableQ.ok && tableQ.output === 'graph_edges',
      '1a: graph_edges table present', `got: ${tableQ.output || '(empty)'}`);

    // ─── TEST 2: all 12 columns present ───────────────────────────────────
    log(`\nTEST 2: PRAGMA table_info(graph_edges) reports 12 columns`);
    const colQ = sqliteQuery(dbPath, 'PRAGMA table_info(graph_edges);');
    // PRAGMA table_info output: cid|name|type|notnull|dflt_value|pk
    const cols = colQ.lines.map(l => l.split('|')[1]).filter(Boolean);
    const required = [
      'id', 'source_id', 'target_id', 'relation', 'weight',
      'confidence', 'decay_rate', 'last_reinforced',
      'witness_id', 'embedding_ref', 'metadata', 'created_at',
    ];
    for (const c of required) {
      assert(cols.includes(c), `2/${c}: column present`,
        `cols=[${cols.join(',')}]`);
    }
    assert(cols.length >= 12, `2x: at least 12 columns`,
      `got ${cols.length}: [${cols.join(',')}]`);

    // ─── TEST 3: all 5 indexes present ─────────────────────────────────────
    log(`\nTEST 3: PRAGMA index_list(graph_edges) reports 5 indexes`);
    const idxQ = sqliteQuery(dbPath, 'PRAGMA index_list(graph_edges);');
    // PRAGMA index_list: seq|name|unique|origin|partial
    const indexes = idxQ.lines.map(l => l.split('|')[1]).filter(Boolean);
    // Required indexes per ADR-0261 schema (forks/agentdb/src/schemas/graph-edges.sql):
    //   idx_graph_edges_triple        — UNIQUE(source_id, target_id, relation) — upsert key
    //   idx_graph_edges_last_reinforced — DESC sweep + retention scans
    //   idx_graph_edges_witness       — federation / audit-chain reverse lookup
    //   idx_graph_edges_src           — direction='src' query filter
    //   idx_graph_edges_dst           — direction='dst' query filter
    const requiredIdx = [
      'idx_graph_edges_triple',
      'idx_graph_edges_last_reinforced',
      'idx_graph_edges_witness',
      'idx_graph_edges_src',
      'idx_graph_edges_dst',
    ];
    for (const idx of requiredIdx) {
      assert(indexes.includes(idx), `3/${idx}: index present`,
        `indexes=[${indexes.join(',')}]`);
    }

    // ─── TEST 4: foreign keys to memory_entries are DEFERRED ──────────────
    // Per ADR-0261 §Decision Outcome + the graph-edges.sql IMPLEMENTATION
    // NOTE: the cli's `memory_entries` table lives in a different package
    // (@claude-flow/memory) and is NOT created by agentdb's schema loaders.
    // Inlining a SQL-level FK would either silently fail (referenced table
    // absent at table-creation) or cascade-collide. Resolution: defer FK
    // at the schema layer; enforce referential integrity at the handler /
    // invariant layer (handler validates srcMemoryId/dstMemoryId; invariant
    // re-checks). This matches the existing `causal_edges` pattern.
    //
    // The smoke asserts the deferral is documented (zero memory_entries
    // FKs at schema level) — if FKs ever land, this test flips intent and
    // we update the schema's IMPLEMENTATION NOTE block accordingly.
    log(`\nTEST 4: FK to memory_entries deferred at schema layer (per ADR-0261 IMPLEMENTATION NOTE)`);
    const fkQ = sqliteQuery(dbPath, 'PRAGMA foreign_key_list(graph_edges);');
    const fkRows = fkQ.lines.map(l => l.split('|'));
    const fkTables = fkRows.map(r => r[2]).filter(Boolean);
    const memoryEntriesFks = fkTables.filter(t => t === 'memory_entries');
    assert(memoryEntriesFks.length === 0,
      `4a: 0 FKs to memory_entries (deferred per IMPLEMENTATION NOTE)`,
      `unexpected FKs: got ${memoryEntriesFks.length}, tables=[${fkTables.join(',')}] — if FK was intentionally re-added, update this assertion + the schema's IMPLEMENTATION NOTE`);

    // ─── TEST 5: schema loader picked up graph-edges.sql ──────────────────
    // (Indirect check: ADR-0261 §Decision Outcome requires init.ts:110 +
    // AgentDB.ts:210/216 edits so graph-edges.sql IS loaded. If the file
    // shipped in dist but the loader wasn't extended, the table wouldn't
    // exist — so the success of TEST 1 already proves the loader was
    // extended. This test makes it explicit.)
    log(`\nTEST 5: schema loader extension verified via table existence (transitive)`);
    assert(tableQ.ok && tableQ.output === 'graph_edges',
      `5a: loader picked up graph-edges.sql (transitive via TEST 1)`);

  } catch (err) {
    log(`[smoke] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  perf.emitJson();

  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0261 P1 schema-migration criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P1 schema-migration criteria met.\n`);
  process.exit(0);
}

main();

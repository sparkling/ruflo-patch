#!/usr/bin/env node
/**
 * Smoke test: ADR-0261 Phase 1 — graph_edges schema migration
 *
 * Mirrors upstream's `smoke-graph-schema-migration.mjs` (P1) re-targeted at the
 * fork's `agentdb` substrate: after `cli init --full --force` the
 * `graph_edges` table created by the agentdb schema loader must be present
 * with the full 12-column shape, 5 indexes, and 2 FKs to `memory_entries`.
 *
 * Acceptance criteria (per ADR-0261 §R2.8 deliverable #4 + §R2.6 C5):
 *   1. graph_edges table exists after init
 *   2. All 12 columns present (id, source_id, target_id, relation, weight,
 *      confidence, decay_rate, last_reinforced, witness_id, embedding_ref,
 *      metadata, created_at)
 *   3. All 5 indexes present (idx_graph_edges_source_id, _target_id,
 *      _relation, _last_reinforced, _composite_src_rel)
 *   4. 2 foreign keys present (source_id → memory_entries.id;
 *      target_id → memory_entries.id)
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
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const CLI_PKG = process.env.CLI_PKG || '@sparkleideas/cli';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-graph-schema-${Date.now()}.log`);

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function assert(cond, label, reason = '') { cond ? pass(label) : fail(label, reason || 'assertion false'); }

function findCli(tempDir) {
  for (const name of ['ruflo', 'claude-flow', 'cli']) {
    const p = join(tempDir, 'node_modules', '.bin', name);
    if (existsSync(p)) return p;
  }
  return null;
}

function installCli(tempDir) {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
    name: 'smoke-graph-schema',
    version: '1.0.0',
    private: true,
  }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${REGISTRY}\n`);
  log(`[setup] installing ${CLI_PKG} from ${REGISTRY} → ${tempDir}`);
  const r = spawnSync('npm', [
    'install', CLI_PKG,
    '--registry', REGISTRY,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  if (r.status !== 0) {
    log(`[setup] FATAL: npm install failed (status=${r.status})`);
    log(`[setup] stderr: ${r.stderr}`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) {
    log(`[setup] FATAL: cli binary not found after install`);
    process.exit(1);
  }
  return cli;
}

function runInit(cli, tempDir) {
  log(`[setup] running ${cli} init --full --force`);
  const r = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    timeout: 120000,
  });
  if (r.status !== 0) {
    log(`[setup] init failed (status=${r.status})`);
    log(`[setup] stderr: ${r.stderr?.slice(0, 2000)}`);
    log(`[setup] stdout: ${r.stdout?.slice(0, 2000)}`);
    process.exit(1);
  }
  // Init does not create memory.db on its own; force memory init.
  const r2 = spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir,
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    timeout: 30000,
  });
  if (r2.status !== 0) {
    log(`[setup] memory init failed (status=${r2.status})`);
    log(`[setup] stderr: ${r2.stderr?.slice(0, 2000)}`);
  }
}

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

  const tempDir = mkdtempSync(join(tmpdir(), 'smoke-graph-schema-'));
  log(`[smoke] temp dir: ${tempDir}`);

  try {
    const cli = installCli(tempDir);
    runInit(cli, tempDir);

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
    // Required indexes per ADR-0261 §Decision Outcome (mirrors upstream's 4 + composite):
    const requiredIdx = [
      'idx_graph_edges_source_id',
      'idx_graph_edges_target_id',
      'idx_graph_edges_relation',
      'idx_graph_edges_last_reinforced',
      'idx_graph_edges_composite_src_rel',
    ];
    for (const idx of requiredIdx) {
      assert(indexes.includes(idx), `3/${idx}: index present`,
        `indexes=[${indexes.join(',')}]`);
    }

    // ─── TEST 4: 2 foreign keys to memory_entries ─────────────────────────
    log(`\nTEST 4: PRAGMA foreign_key_list(graph_edges) reports 2 FKs to memory_entries`);
    const fkQ = sqliteQuery(dbPath, 'PRAGMA foreign_key_list(graph_edges);');
    // PRAGMA foreign_key_list: id|seq|table|from|to|on_update|on_delete|match
    const fkRows = fkQ.lines.map(l => l.split('|'));
    const fkTables = fkRows.map(r => r[2]).filter(Boolean);
    const memoryEntriesFks = fkTables.filter(t => t === 'memory_entries');
    assert(memoryEntriesFks.length >= 2,
      `4a: at least 2 FKs to memory_entries`,
      `got ${memoryEntriesFks.length}: tables=[${fkTables.join(',')}]`);
    // Verify both source_id and target_id FK
    const fkFromCols = fkRows
      .filter(r => r[2] === 'memory_entries')
      .map(r => r[3]);
    assert(fkFromCols.includes('source_id'),
      `4b: source_id FK to memory_entries`,
      `fk_from_cols=[${fkFromCols.join(',')}]`);
    assert(fkFromCols.includes('target_id'),
      `4c: target_id FK to memory_entries`,
      `fk_from_cols=[${fkFromCols.join(',')}]`);

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
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0261 P1 schema-migration criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P1 schema-migration criteria met.\n`);
  process.exit(0);
}

main();

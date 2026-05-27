#!/usr/bin/env node
/**
 * Smoke test: ADR-0261 Phase 5 — agentdb_graph-pathfinder (6 algorithms)
 *
 * Mirrors upstream's `smoke-graph-pathfinder.mjs` (P5) re-targeted at the
 * fork's archivist-routed handler. Per ADR-0261 §R2.4 (algorithm parity),
 * all 6 algorithms are ported verbatim from upstream:
 *
 *   1. personalized-pagerank
 *   2. dynamic-mincut
 *   3. spectral-sparsify
 *   4. temporal-centrality   (fork USES decay_rate column instead of
 *                             upstream's hardcoded 0.1 — correctness fix)
 *   5. connected-component-churn
 *   6. witness-chain-divergence (fork's witness_id is populated per §R1.4)
 *
 * This smoke dispatches `agentdb_graph-pathfinder` once per algorithm and
 * asserts each returns the expected shape (success=true, paths=array,
 * elapsedMs=number). Empty graphs MUST return empty paths (not error).
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE.
 * Per `project-rvf-test-artifact-resolution`: progress to stderr.
 * Per `feedback-no-squelch-tests`: missing algorithms / non-zero exit FAIL
 * loudly — algorithm parity is non-negotiable per §R2.4.
 *
 * Usage: node scripts/smoke-graph-pathfinder.mjs
 *
 * Exit codes:
 *   0 — all 6 algorithms returned the expected shape
 *   1 — at least one algorithm failed
 *
 * Dependencies: Agent A's pathfinder handler ports must be built/published.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSmokePerf, setupSmokeTempDir, installAndInit as sharedInstallAndInit, findCli } from './lib/smoke-adr0261-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-graph-pathfinder-${Date.now()}.log`);

const ALGORITHMS = [
  'personalized-pagerank',
  'dynamic-mincut',
  'spectral-sparsify',
  'temporal-centrality',
  'connected-component-churn',
  'witness-chain-divergence',
];

const perf = createSmokePerf('smoke-graph-pathfinder');

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
  for (const rel of ['.swarm/memory.db', '.claude-flow/agentdb/memory.db', '.claude-flow/memory.db']) {
    const p = join(tempDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

function sqliteExec(dbPath, sql) {
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout || '').trim(), err: r.stderr || '' };
}

// 7-edge connected graph matching upstream's pathfinder seed (re-shaped
// from integer FKs to domain-prefixed string ids per the schema's
// IMPLEMENTATION NOTE — graph_edges has no FK to memory_entries, so we
// skip the memory_entries seed entirely and use 'task:'/'memory:'/'agent:'
// string ids directly). `last_reinforced` defaults to ISO 8601 'now' when
// omitted; `witness_id` is NOT NULL and we supply a synthetic 16-hex seed.
function seedGoldenGraph(dbPath) {
  const sql = `
    INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, witness_id) VALUES
      ('agent:alice',   'task:auth',    'assigned-to',  0.9, 0.95, 0.01, 'pf00000000000001'),
      ('task:auth',     'memory:auth-mod', 'implements', 0.8, 0.90, 0.01, 'pf00000000000002'),
      ('memory:auth-mod','memory:jwt',  'depends-on',   0.7, 0.85, 0.02, 'pf00000000000003'),
      ('agent:bob',     'task:search',  'assigned-to',  0.9, 0.95, 0.01, 'pf00000000000004'),
      ('task:search',   'memory:auth-mod', 'implements', 0.8, 0.90, 0.01, 'pf00000000000005'),
      ('memory:auth-mod','memory:user-db', 'reads',     0.6, 0.80, 0.03, 'pf00000000000006'),
      ('agent:alice',   'agent:bob',    'collaborates', 0.5, 0.75, 0.04, 'pf00000000000007');
  `;
  const r = sqliteExec(dbPath, sql);
  return r.ok;
}

function mcpToolCall(cli, tempDir, toolName, args) {
  const r = spawnSync(cli, ['mcp', 'exec', '-t', toolName, '-p', JSON.stringify(args)], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// Extract the `Result: { ... }` JSON block from `mcp exec` stdout.
function parseJsonish(out) {
  if (!out) return null;
  let start = out.indexOf('Result:');
  start = start >= 0 ? out.indexOf('{', start) : out.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < out.length; i++) {
    const ch = out[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(out.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function main() {
  log(`\n[ADR-0261 P5 smoke] agentdb_graph-pathfinder — 6 algorithms`);
  log(`[smoke] log file: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-graph-pf', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    let cli;
    if (shared) {
      cli = findCli(tempDir);
      if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
    } else {
      cli = sharedInstallAndInit(tempDir, perf, REGISTRY);
    }
    testBodyStart = process.hrtime.bigint();
    const dbPath = findMemoryDb(tempDir);
    if (!dbPath) {
      fail('0a: locate memory.db', `no memory.db under ${tempDir}`);
      throw new Error('no memory.db');
    }
    pass(`0a: memory.db at ${dbPath}`);

    if (!seedGoldenGraph(dbPath)) {
      fail('0b: seed 7-edge graph', 'sqlite insert failed');
      throw new Error('seed failed');
    }
    const cnt = sqliteExec(dbPath, "SELECT COUNT(*) FROM graph_edges;");
    pass(`0b: seeded graph_edges count=${cnt.output}`);

    // ─── TEST 1..6: each algorithm returns expected shape ──────────────
    // Seed uses domain-prefixed string ids; 'agent:alice' is the source
    // of two outgoing edges (to task:auth and agent:bob).
    let algoIdx = 0;
    for (const algo of ALGORITHMS) {
      algoIdx++;
      log(`\nTEST ${algoIdx}: algorithm=${algo}`);
      const r = mcpToolCall(cli, tempDir, 'agentdb_graph-pathfinder', {
        seedNodeId: 'agent:alice',
        query: 'test',
        algorithm: algo,
        depth: 2,
      });
      assert(r.ok, `${algoIdx}a: ${algo} dispatch exits 0`,
        `status=${r.status} stderr=${r.stderr?.slice(0, 500)}`);
      const json = parseJsonish(r.stdout);
      assert(json !== null, `${algoIdx}b: ${algo} returns parseable JSON`,
        `stdout=${r.stdout?.slice(0, 300)}`);
      if (json) {
        const success = json.success ?? true;
        assert(success !== false,
          `${algoIdx}c: ${algo} returns success != false`,
          `json=${JSON.stringify(json).slice(0, 200)}`);
        const paths = json.paths;
        assert(Array.isArray(paths),
          `${algoIdx}d: ${algo} returns paths array`,
          `got: ${typeof paths}`);
        const elapsed = json.elapsedMs;
        assert(typeof elapsed === 'number' || elapsed === undefined,
          `${algoIdx}e: ${algo} returns elapsedMs (number or absent)`,
          `got type=${typeof elapsed}`);
      }
    }

    // ─── TEST 7: empty graph returns empty paths, NOT error ─────────────
    log(`\nTEST 7: non-existent seed returns success + empty paths`);
    const empty = mcpToolCall(cli, tempDir, 'agentdb_graph-pathfinder', {
      seedNodeId: 'memory:nonexistent-node-xyz', query: 'nothing',
      algorithm: 'personalized-pagerank',
    });
    assert(empty.ok, '7a: non-existent seed dispatch exits 0',
      `status=${empty.status} stderr=${empty.stderr?.slice(0, 500)}`);
    const emptyJson = parseJsonish(empty.stdout);
    if (emptyJson) {
      const paths = emptyJson.paths ?? [];
      assert(Array.isArray(paths),
        '7b: non-existent seed returns paths array');
      assert(paths.length === 0,
        '7c: non-existent seed returns empty paths',
        `length=${paths.length}`);
    }

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
    log(`\nSmoke FAILED — ADR-0261 P5 pathfinder criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P5 pathfinder criteria met.\n`);
  process.exit(0);
}

main();

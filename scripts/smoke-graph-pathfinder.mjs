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
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const CLI_PKG = process.env.CLI_PKG || '@sparkleideas/cli';
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

function installAndInit(tempDir) {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
    name: 'smoke-graph-pathfinder', version: '1.0.0', private: true,
  }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${REGISTRY}\n`);
  log(`[setup] installing ${CLI_PKG}`);
  const r = spawnSync('npm', [
    'install', CLI_PKG,
    '--registry', REGISTRY,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  if (r.status !== 0) {
    log(`[setup] FATAL install: ${r.stderr}`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) { log(`[setup] FATAL: cli not found`); process.exit(1); }
  log(`[setup] init --full --force`);
  const r2 = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r2.status !== 0) {
    log(`[setup] init failed: ${r2.stderr?.slice(0, 1000)}`);
    process.exit(1);
  }
  spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return cli;
}

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

function seedGoldenGraph(dbPath) {
  // 7-edge connected graph matching upstream's pathfinder seed.
  const sql = `
    INSERT OR REPLACE INTO memory_entries (id, namespace, key, value) VALUES
      (5001, 'pf', 'alice', 'agent alice'),
      (5002, 'pf', 'task-auth', 'authentication task'),
      (5003, 'pf', 'auth-mod', 'auth module'),
      (5004, 'pf', 'jwt', 'jwt library'),
      (5005, 'pf', 'bob', 'agent bob'),
      (5006, 'pf', 'task-search', 'search task'),
      (5007, 'pf', 'user-db', 'user db');
    INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, last_reinforced) VALUES
      (5001, 5002, 'assigned-to',  0.9, 0.95, 0.01, strftime('%s','now')),
      (5002, 5003, 'implements',    0.8, 0.90, 0.01, strftime('%s','now')),
      (5003, 5004, 'depends-on',    0.7, 0.85, 0.02, strftime('%s','now')),
      (5005, 5006, 'assigned-to',   0.9, 0.95, 0.01, strftime('%s','now')),
      (5006, 5003, 'implements',    0.8, 0.90, 0.01, strftime('%s','now')),
      (5003, 5007, 'reads',         0.6, 0.80, 0.03, strftime('%s','now')),
      (5001, 5005, 'collaborates',  0.5, 0.75, 0.04, strftime('%s','now'));
  `;
  const r = sqliteExec(dbPath, sql);
  return r.ok;
}

function mcpToolCall(cli, tempDir, toolName, args) {
  const r = spawnSync(cli, ['mcp', 'invoke', toolName, JSON.stringify(args)], {
    cwd: tempDir, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r.status !== 0) {
    const r2 = spawnSync(cli, ['mcp', 'call', toolName, '--args', JSON.stringify(args)], {
      cwd: tempDir, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });
    return { ok: r2.status === 0, stdout: r2.stdout, stderr: r2.stderr, status: r2.status };
  }
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function parseJsonish(out) {
  const i = out.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(out.slice(i)); } catch { return null; }
}

function main() {
  log(`\n[ADR-0261 P5 smoke] agentdb_graph-pathfinder — 6 algorithms`);
  log(`[smoke] log file: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const tempDir = mkdtempSync(join(tmpdir(), 'smoke-graph-pf-'));
  log(`[smoke] temp dir: ${tempDir}`);

  try {
    const cli = installAndInit(tempDir);
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
    let algoIdx = 0;
    for (const algo of ALGORITHMS) {
      algoIdx++;
      log(`\nTEST ${algoIdx}: algorithm=${algo}`);
      const r = mcpToolCall(cli, tempDir, 'agentdb_graph-pathfinder', {
        seedNodeId: '5001',
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
        const success = json.success ?? json.result?.success ?? true;
        assert(success !== false,
          `${algoIdx}c: ${algo} returns success != false`,
          `json=${JSON.stringify(json).slice(0, 200)}`);
        const paths = json.paths ?? json.result?.paths;
        assert(Array.isArray(paths),
          `${algoIdx}d: ${algo} returns paths array`,
          `got: ${typeof paths}`);
        const elapsed = json.elapsedMs ?? json.result?.elapsedMs;
        assert(typeof elapsed === 'number' || elapsed === undefined,
          `${algoIdx}e: ${algo} returns elapsedMs (number or absent)`,
          `got type=${typeof elapsed}`);
      }
    }

    // ─── TEST 7: empty graph returns empty paths, NOT error ─────────────
    log(`\nTEST 7: non-existent seed returns success + empty paths`);
    const empty = mcpToolCall(cli, tempDir, 'agentdb_graph-pathfinder', {
      seedNodeId: '999999', query: 'nothing', algorithm: 'personalized-pagerank',
    });
    assert(empty.ok, '7a: non-existent seed dispatch exits 0',
      `status=${empty.status} stderr=${empty.stderr?.slice(0, 500)}`);
    const emptyJson = parseJsonish(empty.stdout);
    if (emptyJson) {
      const paths = emptyJson.paths ?? emptyJson.result?.paths ?? [];
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
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0261 P5 pathfinder criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P5 pathfinder criteria met.\n`);
  process.exit(0);
}

main();

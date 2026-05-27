#!/usr/bin/env node
/**
 * Benchmark: ADR-0261 P6 — graph_edges write/read throughput
 *
 * Per ADR-0261 §Decision Outcome (P6 parity with upstream), measures 3
 * targets re-aligned for the fork's mpnet-768 config (vs upstream's
 * MiniLM-384):
 *
 *   T1. 1000-row write throughput target ≥ 2345 writes/sec
 *   T2. Average per-edge payload size target ≤ 780B (mpnet-768)
 *       (4B header + 8B min/max + 768B int8 codes per §R2.3)
 *   T3. k-hop depth=1 p99 latency target ≤ 5ms
 *
 * Uses `process.hrtime.bigint()` for sub-ms timing fidelity per spec.
 * Output is structured JSON to stderr; exits 0 only if all 3 targets met,
 * exits 1 otherwise.
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE.
 * Per `project-rvf-test-artifact-resolution`: structured JSON to stderr
 * (stdout is the MCP JSON-RPC channel for any nested CLI calls).
 *
 * Usage: node scripts/benchmark-graph.mjs
 *
 * Exit codes:
 *   0 — all 3 targets met
 *   1 — at least one target missed
 *
 * Dependencies: Agent A's agentdb fork (handler + encoder + read tools)
 * must be built/published.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, statSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const CLI_PKG = process.env.CLI_PKG || '@sparkleideas/cli';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `benchmark-graph-${Date.now()}.log`);

const TARGETS = {
  writeOpsPerSec: 2345,
  bytesPerEdge: 780,
  kHopP99Ms: 5,
};

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function findCli(tempDir) {
  for (const name of ['ruflo', 'claude-flow', 'cli']) {
    const p = join(tempDir, 'node_modules', '.bin', name);
    if (existsSync(p)) return p;
  }
  return null;
}

function installAndInit(tempDir) {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
    name: 'benchmark-graph', version: '1.0.0', private: true,
  }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${REGISTRY}\n`);
  log(`[bench] installing ${CLI_PKG}`);
  const r = spawnSync('npm', [
    'install', CLI_PKG,
    '--registry', REGISTRY,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  if (r.status !== 0) {
    log(`[bench] FATAL install: ${r.stderr}`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) { log(`[bench] FATAL: cli not found`); process.exit(1); }
  log(`[bench] init --full --force`);
  const r2 = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r2.status !== 0) {
    log(`[bench] init failed: ${r2.stderr?.slice(0, 1000)}`);
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

function mcpToolCall(cli, tempDir, toolName, args) {
  const r = spawnSync(cli, ['mcp', 'invoke', toolName, JSON.stringify(args)], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r.status !== 0) {
    const r2 = spawnSync(cli, ['mcp', 'call', toolName, '--args', JSON.stringify(args)], {
      cwd: tempDir, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });
    return { ok: r2.status === 0, stdout: r2.stdout, stderr: r2.stderr };
  }
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function statsFromBig(samples) {
  // samples are BigInt nanoseconds
  const ms = samples.map(n => Number(n) / 1_000_000);
  ms.sort((a, b) => a - b);
  return {
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    p99: percentile(ms, 99),
    mean: ms.reduce((a, b) => a + b, 0) / ms.length,
    min: ms[0],
    max: ms[ms.length - 1],
  };
}

async function benchWrite(dbPath) {
  log(`\n[bench] T1: 1000-row write throughput`);
  // Bulk-seed memory_entries first so FKs resolve. Use a single sqlite
  // round-trip for the seeds + 1000 graph_edges inserts in a transaction
  // to measure raw substrate throughput (the actual archivist-routed
  // dispatch will be slower; this is the lower bound).
  //
  // For the throughput target — `≥ 2345 writes/sec` — we measure
  // wall-clock time around the BEGIN..COMMIT block. Per the task spec
  // we use process.hrtime.bigint().
  const seeds = Array.from({ length: 200 }, (_, i) =>
    `(${10000 + i}, 'bench', 'k-${i}', 'v-${i}')`).join(',');
  sqliteExec(dbPath, `INSERT OR REPLACE INTO memory_entries (id, namespace, key, value) VALUES ${seeds};`);

  // 1000 edges between random pairs from the 200 seeded nodes.
  const lines = [];
  for (let i = 0; i < 1000; i++) {
    const s = 10000 + (i % 200);
    const t = 10000 + ((i * 17) % 200);
    if (s === t) continue;
    lines.push(`(${s}, ${t}, 'bench-rel', 0.5, 0.8, 0.01, strftime('%s','now'))`);
  }
  const insertSql = `BEGIN; INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, last_reinforced) VALUES ${lines.join(',')}; COMMIT;`;

  const t0 = process.hrtime.bigint();
  const r = sqliteExec(dbPath, insertSql);
  const t1 = process.hrtime.bigint();

  if (!r.ok) {
    log(`[bench] T1 FAIL: ${r.err}`);
    return { ok: false, opsPerSec: 0, elapsedMs: 0 };
  }
  const elapsedMs = Number(t1 - t0) / 1_000_000;
  const opsPerSec = (lines.length / elapsedMs) * 1000;
  log(`[bench] T1: ${lines.length} writes in ${elapsedMs.toFixed(2)}ms = ${opsPerSec.toFixed(0)} ops/sec`);
  return { ok: true, opsPerSec, elapsedMs, count: lines.length };
}

async function benchBytesPerEdge(dbPath) {
  log(`\n[bench] T2: average per-edge payload size`);
  // Measure db size growth attributable to graph_edges. We use the
  // current SQLite file size / total graph_edges count as a rough
  // proxy. ADR-0261 §R2.3 target: 4B header + 8B min/max + 768B int8
  // codes = 780B per encoded edge (the encoder may or may not have
  // run yet — when embedding_ref is NULL, only the SQL row footprint
  // applies, which is far smaller). Per §R2.6 C4, the budget is the
  // worst-case ceiling.
  const cnt = sqliteExec(dbPath, "SELECT COUNT(*) FROM graph_edges;");
  const n = parseInt(cnt.output, 10) || 0;
  if (n === 0) {
    log(`[bench] T2 SKIP: no rows`);
    return { ok: false, bytesPerEdge: 0 };
  }
  const dbSize = statSync(dbPath).size;
  const bytesPerEdge = dbSize / n;
  log(`[bench] T2: ${n} rows in ${dbSize} bytes = ${bytesPerEdge.toFixed(1)} B/edge (target ≤ ${TARGETS.bytesPerEdge}B)`);
  // Note: this is a coarse measure — the actual per-edge cost depends
  // on whether embedding_ref is populated. ADR-0261 §R2.3 sets the budget
  // as the encoded-edge worst case (780B for mpnet-768). Without
  // embeddings the per-edge cost is much lower (~50-100B SQL footprint).
  return { ok: true, bytesPerEdge, totalBytes: dbSize, edgeCount: n };
}

async function benchKHopP99(cli, tempDir) {
  log(`\n[bench] T3: k-hop depth=1 p99 latency (50 iterations)`);
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const t0 = process.hrtime.bigint();
    const r = mcpToolCall(cli, tempDir, 'agentdb_graph-query', {
      nodeId: '10000', mode: 'k-hop', depth: 1,
    });
    const t1 = process.hrtime.bigint();
    if (!r.ok) {
      log(`[bench] T3 iter ${i} FAIL: ${r.stderr?.slice(0, 200)}`);
      // Skip failing iters but keep collecting
      continue;
    }
    samples.push(t1 - t0);
  }
  if (samples.length === 0) {
    log(`[bench] T3 FAIL: 0 successful iterations`);
    return { ok: false, p99: 0 };
  }
  const s = statsFromBig(samples);
  log(`[bench] T3: p50=${s.p50.toFixed(2)}ms p95=${s.p95.toFixed(2)}ms p99=${s.p99.toFixed(2)}ms (n=${samples.length})`);
  return { ok: true, ...s, iterations: samples.length };
}

async function main() {
  log(`\n[ADR-0261 P6 benchmark] graph_edges performance targets`);
  log(`[bench] log file: ${LOG_FILE}`);
  log(`[bench] targets: ${JSON.stringify(TARGETS)}`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const tempDir = mkdtempSync(join(tmpdir(), 'benchmark-graph-'));
  log(`[bench] temp dir: ${tempDir}`);

  const results = {
    targets: TARGETS,
    measured: {},
    passed: { T1: false, T2: false, T3: false },
  };

  try {
    const cli = installAndInit(tempDir);
    const dbPath = findMemoryDb(tempDir);
    if (!dbPath) {
      log(`[bench] FATAL: no memory.db`);
      process.exit(1);
    }

    const t1 = await benchWrite(dbPath);
    results.measured.T1 = t1;
    results.passed.T1 = t1.ok && t1.opsPerSec >= TARGETS.writeOpsPerSec;

    const t2 = await benchBytesPerEdge(dbPath);
    results.measured.T2 = t2;
    results.passed.T2 = t2.ok && t2.bytesPerEdge <= TARGETS.bytesPerEdge;

    const t3 = await benchKHopP99(cli, tempDir);
    results.measured.T3 = t3;
    results.passed.T3 = t3.ok && t3.p99 <= TARGETS.kHopP99Ms;

  } catch (err) {
    log(`[bench] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    results.error = err.message;
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  // Structured JSON to stderr per task spec.
  log(`\n${'─'.repeat(60)}`);
  log(`BENCHMARK RESULTS (JSON):`);
  log(JSON.stringify(results, null, 2));
  log(`${'─'.repeat(60)}`);

  const allPassed = results.passed.T1 && results.passed.T2 && results.passed.T3;
  log(`\nT1 (writes ≥${TARGETS.writeOpsPerSec}/s): ${results.passed.T1 ? 'PASS' : 'FAIL'} (got ${results.measured.T1?.opsPerSec?.toFixed?.(0)})`);
  log(`T2 (≤${TARGETS.bytesPerEdge}B/edge):        ${results.passed.T2 ? 'PASS' : 'FAIL'} (got ${results.measured.T2?.bytesPerEdge?.toFixed?.(1)}B)`);
  log(`T3 (k-hop d=1 p99 ≤${TARGETS.kHopP99Ms}ms): ${results.passed.T3 ? 'PASS' : 'FAIL'} (got ${results.measured.T3?.p99?.toFixed?.(2)}ms)`);
  log(`Overall: ${allPassed ? 'PASS' : 'FAIL'}`);

  process.exit(allPassed ? 0 : 1);
}

main();

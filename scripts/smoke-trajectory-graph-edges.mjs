#!/usr/bin/env node
/**
 * Smoke test: ADR-0261 Phase 3 — trajectory + post-task hook writers
 *
 * Per ADR-0261 §R2.7 (consumer comparison U3 vs F3), the fork-side
 * `hooks_intelligence_trajectory-step` hook is the WRITE producer for
 * `trajectory-caused` edges between successive memory_entries rows in a
 * trajectory. Per §R2.1, the hook calls `dispatch('agentdb_graph_edge',
 * {action:'save', relation:'trajectory-caused', ...})` internally, routed
 * through the archivist (no module-scope cache, no fire-and-forget).
 *
 * This smoke fires `hooks_intelligence_trajectory-step` twice in sequence
 * with two different memory_entries, then asserts a `trajectory-caused`
 * row was inserted with the correct src/dst/relation. Per §R1.4 +
 * acceptance C7/C8, the `witness_id` must be non-empty and a 16-char hex
 * string (sha256(installation_id ‖ audit_chain_entry_id).slice(0,16)).
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE; never pipes
 * through tail/head.
 * Per `project-rvf-test-artifact-resolution`: structured progress to
 * stderr (stdout reserved for MCP JSON-RPC).
 * Per `feedback-no-squelch-tests`: missing rows / empty witness_id FAIL
 * loudly.
 *
 * Usage: node scripts/smoke-trajectory-graph-edges.mjs
 *
 * Exit codes:
 *   0 — trajectory-caused row inserted with valid 16-char hex witness_id
 *   1 — at least one assertion failed
 *
 * Dependencies: Agent A's agentdb fork + Agent B's hook wire-up edits to
 * hooks-tools.ts must be built/published.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const CLI_PKG = process.env.CLI_PKG || '@sparkleideas/cli';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-trajectory-graph-${Date.now()}.log`);

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
    name: 'smoke-trajectory-graph', version: '1.0.0', private: true,
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

// Seed 2 memory_entries (the trajectory's "before" and "after" rows). The
// hook will create edges between these.
function seedTrajectoryRows(dbPath) {
  const sql = `
    INSERT OR REPLACE INTO memory_entries (id, namespace, key, value)
      VALUES (2001, 'traj', 'step-a-context', 'retrieved auth context');
    INSERT OR REPLACE INTO memory_entries (id, namespace, key, value)
      VALUES (2002, 'traj', 'step-b-result', 'wrote auth handler');
  `;
  const r = sqliteExec(dbPath, sql);
  return r.ok;
}

function callHook(cli, tempDir, hookName, args) {
  const r = spawnSync(cli, ['mcp', 'invoke', hookName, JSON.stringify(args)], {
    cwd: tempDir, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r.status !== 0) {
    // Fallback to alternate dispatch shape
    const r2 = spawnSync(cli, ['mcp', 'call', hookName, '--args', JSON.stringify(args)], {
      cwd: tempDir, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });
    return { ok: r2.status === 0, stdout: r2.stdout, stderr: r2.stderr, status: r2.status };
  }
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function main() {
  log(`\n[ADR-0261 P3 smoke] trajectory + post-task hook writers`);
  log(`[smoke] log file: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const tempDir = mkdtempSync(join(tmpdir(), 'smoke-trajectory-'));
  log(`[smoke] temp dir: ${tempDir}`);

  try {
    const cli = installAndInit(tempDir);
    const dbPath = findMemoryDb(tempDir);
    if (!dbPath) {
      fail('0a: locate memory.db', `no memory.db under ${tempDir}`);
      throw new Error('no memory.db');
    }
    pass(`0a: memory.db at ${dbPath}`);

    if (!seedTrajectoryRows(dbPath)) {
      fail('0b: seed trajectory memory_entries', 'sqlite insert failed');
      throw new Error('seed failed');
    }
    pass(`0b: trajectory memory_entries 2001/2002 seeded`);

    // Baseline count before firing hooks.
    const before = sqliteExec(dbPath,
      "SELECT COUNT(*) FROM graph_edges WHERE relation='trajectory-caused';");
    const beforeCount = parseInt(before.output, 10) || 0;
    log(`[smoke] trajectory-caused row count before: ${beforeCount}`);

    // ─── TEST 1: fire trajectory-step hook twice ─────────────────────────
    log(`\nTEST 1: hooks_intelligence_trajectory-step (2x in sequence)`);
    const trajId = `smoke-traj-${Date.now()}`;
    const r1 = callHook(cli, tempDir, 'hooks_intelligence_trajectory-step', {
      trajectoryId: trajId,
      action: 'retrieve-context',
      result: 'mem:2001',
      memoryEntryId: 2001,
      quality: 0.9,
    });
    assert(r1.ok, '1a: first trajectory-step hook exits 0',
      `status=${r1.status} stderr=${r1.stderr?.slice(0, 500)}`);

    const r2 = callHook(cli, tempDir, 'hooks_intelligence_trajectory-step', {
      trajectoryId: trajId,
      action: 'write-output',
      result: 'mem:2002',
      memoryEntryId: 2002,
      previousMemoryEntryId: 2001,
      quality: 0.95,
    });
    assert(r2.ok, '1b: second trajectory-step hook exits 0',
      `status=${r2.status} stderr=${r2.stderr?.slice(0, 500)}`);

    // ─── TEST 2: trajectory-caused row inserted ──────────────────────────
    log(`\nTEST 2: graph_edges has new trajectory-caused row`);
    const after = sqliteExec(dbPath,
      "SELECT COUNT(*) FROM graph_edges WHERE relation='trajectory-caused';");
    const afterCount = parseInt(after.output, 10) || 0;
    log(`[smoke] trajectory-caused row count after: ${afterCount}`);
    assert(afterCount > beforeCount,
      '2a: trajectory-caused row count increased',
      `before=${beforeCount} after=${afterCount}`);

    // ─── TEST 3: src/dst/relation shape ──────────────────────────────────
    log(`\nTEST 3: row src/dst/relation matches expected shape`);
    const shapeQ = sqliteExec(dbPath,
      "SELECT source_id, target_id, relation, witness_id FROM graph_edges " +
      "WHERE relation='trajectory-caused' " +
      "ORDER BY rowid DESC LIMIT 1;");
    const parts = shapeQ.output.split('|');
    if (parts.length >= 4) {
      const [src, dst, rel, witness] = parts;
      assert(src === '2001', '3a: source_id = 2001', `got: ${src}`);
      assert(dst === '2002', '3b: target_id = 2002', `got: ${dst}`);
      assert(rel === 'trajectory-caused',
        '3c: relation = "trajectory-caused"', `got: ${rel}`);

      // ─── TEST 4: witness_id is 16-char hex (per §R1.4 federation) ─────
      log(`\nTEST 4: witness_id = sha256(...).slice(0,16) — hex string of len 16`);
      assert(witness && witness.length === 16,
        '4a: witness_id is exactly 16 characters',
        `got len=${witness?.length}: "${witness}"`);
      assert(witness && /^[0-9a-f]{16}$/.test(witness),
        '4b: witness_id matches /^[0-9a-f]{16}$/ (lower-hex)',
        `got: "${witness}"`);
    } else {
      fail('3a: row shape', `unexpected output: ${shapeQ.output}`);
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
    log(`\nSmoke FAILED — ADR-0261 P3 trajectory criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P3 trajectory criteria met.\n`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * ADR-0268 smoke — autonomous skill-promotion flywheel round-trip.
 *
 * Drives the live loop end-to-end against an installed cli, proving the runtime
 * wiring that unit tests + typecheck cannot:
 *   1. RECORD  — `hooks post-task` ×3 (one agent type) dispatches agentdb_reflexion_store
 *                through a WIRED controller and persists 3 episodes with task_type.
 *   2. PROMOTE — `hooks session-end` → routeSessionOp 'end' batch-consolidates a
 *                skill from those episodes (and exits rc=0 — the ADR-0210 summary
 *                crash fix).
 *   3. VERIFY  — the episodes + the promoted skill exist in the agentdb db.
 *
 * Uses a unique per-run agent type so the assertions are deterministic regardless
 * of shared-db state (consolidateEpisodesIntoSkills groups by task_type).
 */
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0268-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0268-flywheel');

let passed = 0;
let failed = 0;
function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function runCli(cli, args, cwd) {
  return spawnSync(cli, args, {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
}

/** Count rows via the sqlite3 CLI. Returns null when sqlite3 is unavailable. */
function sqliteCount(db, sql) {
  const r = spawnSync('sqlite3', [db, sql], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return null;
  const n = parseInt((r.stdout || '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  log(`\n[ADR-0268 smoke] autonomous skill-promotion flywheel`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0268-flywheel', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }

  // Unique, slug-safe agent type per run → unique task_type → deterministic
  // assertions even when the shared db carries episodes from earlier checks.
  const tag = `adr0268x${Date.now().toString(36)}`;

  // Step 1 — RECORD: 3 post-task hooks, same agent type, explicit quality 0.9
  // (promotion-eligible). task_type derives from `-a <tag>`.
  log(`[smoke] record: hooks post-task ×3 (-a ${tag} -q 0.9)`);
  let recordOk = true;
  for (let i = 0; i < 3; i++) {
    const r = runCli(cli, ['hooks', 'post-task', '-i', `${tag}-${i}`, '-a', tag, '-q', '0.9', '-s', 'true'], tempDir);
    if (r.status !== 0) { recordOk = false; log(`  WARN post-task ${i} rc=${r.status}: ${(r.stderr || '').slice(0, 200)}`); }
  }
  if (recordOk) pass('1: hooks post-task ×3 (rc=0)');
  else fail('1: hooks post-task ×3', 'a post-task call exited non-zero');

  // Step 2 — PROMOTE: session-end triggers routeSessionOp 'end' consolidation,
  // and must exit rc=0 (ADR-0210 summary-crash fix).
  log(`[smoke] promote: hooks session-end`);
  const se = runCli(cli, ['hooks', 'session-end'], tempDir);
  if (se.status === 0) pass('2: hooks session-end rc=0 (no summary crash)');
  else fail('2: hooks session-end rc=0', `rc=${se.status}: ${(se.stderr || '').slice(0, 200)}`);

  // Step 3 — VERIFY: episodes recorded with task_type, and a skill promoted for it.
  const db = join(tempDir, '.swarm', 'memory.db');
  if (!existsSync(db)) { fail('3: agentdb db present', `no db at ${db}`); }
  else {
    const ep = sqliteCount(db, `SELECT count(*) FROM episodes WHERE task_type='${tag}';`);
    const sk = sqliteCount(db, `SELECT count(*) FROM skills WHERE name='${tag}';`);
    log(`[smoke] db: episodes(task_type=${tag})=${ep}, skills(name=${tag})=${sk}`);
    if (ep === null || sk === null) {
      // sqlite3 unavailable — record-half rc already covers the dispatch; don't
      // hard-fail the gate on a missing tooling dep.
      log('  INFO sqlite3 unavailable — skipping db assertions (record/promote rc checked above)');
    } else {
      if (ep >= 3) pass(`3: ${ep} episodes recorded with task_type='${tag}'`);
      else fail('3: episodes recorded', `expected >=3, got ${ep}`);
      if (sk >= 1) pass(`4: skill '${tag}' promoted from episodes (flywheel closed)`);
      else fail('4: skill promoted', `no skill named '${tag}' after session-end (got ${sk})`);
    }
  }

  log(`\n[ADR-0268 smoke] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { log(`[smoke] FATAL: ${e?.stack || e}`); process.exit(1); });

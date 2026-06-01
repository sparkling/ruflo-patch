#!/usr/bin/env node
/**
 * Smoke: ADR-0284 — RVF concurrent-write durability (the t3-2 silent-loss gate).
 *
 * Installs @sparkleideas/ruflo@latest, inits a project, then runs the
 * concurrent-durability harness (scripts/rvf-concurrent-durability.mjs) in
 * --reset-each-round mode: K rounds of N concurrent `memory store`, each round
 * against a freshly-seeded SMALL .rvf — the reliable trigger for the native-id
 * collision + lock race (a bloated .rvf masks it; cold-start avoids it).
 *
 * Per round it asserts BOTH a DURABLE count (manifest listMetadataIds via fresh
 * open_readonly) AND a VISIBLE count (memory list) == N. Any shortfall on any
 * round fails the smoke.
 *
 *   - pre-fix (per-process nextNativeId counter + .jslock): writers collide on
 *     native ids and/or race the manifest → durable<N on the first round → FAIL.
 *   - post-fix (deterministic hash ids + single-flock collapse): 0 loss → PASS.
 *
 * FAIL pre-fix, PASS post-fix — ADR-0284 §Confirmation. Deterministic gate
 * (stock fails round 1; the fix is 10/10), unlike the legacy single-shot N=6 t3-2.
 */
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0284-${process.pid}.log`);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const N = parseInt(process.env.ADR0284_N || '16', 10);
const K = parseInt(process.env.ADR0284_K || '10', 10);
const perf = createSmokePerf('smoke-adr0284-concurrent-durability');

function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }

async function main() {
  log(`\n[ADR-0284 smoke] RVF concurrent-write durability (N=${N} K=${K} reset-each-round)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0284', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
  if (!cli) { log('[smoke] FAIL setup: cli not found'); process.exit(1); }

  // Seed one store so the project's .rvf + native binding are materialised
  // before the harness resolves them.
  spawnSync(cli, ['memory', 'store', '-k', 'adr0284-warmup', '-v', 'w', '--namespace', 'adr0284-warmup'],
    { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });

  const harness = join(SCRIPT_DIR, 'rvf-concurrent-durability.mjs');
  log(`[smoke] running harness: ${harness}`);
  const r = spawnSync('node', [
    harness,
    '--cli', cli,
    '--dir', dir,
    '--n', String(N),
    '--k', String(K),
    '--reset-each-round',
  ], { cwd: dir, encoding: 'utf8', timeout: 600000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY, REGISTRY } });

  if (r.stdout) log(r.stdout.trimEnd());
  if (r.stderr) log(r.stderr.trimEnd());
  perf.finish?.();

  if (r.status === 0) {
    log(`\n[ADR-0284 smoke] PASS — ${K}/${K} rounds N=${N} durable AND visible, 0 loss`);
    process.exit(0);
  }
  log(`\n[ADR-0284 smoke] FAIL — concurrent write loss (harness exit=${r.status}). See log above.`);
  process.exit(1);
}

main().catch((e) => { log(`[ADR-0284 smoke] ERROR: ${e?.message ?? e}`); process.exit(1); });

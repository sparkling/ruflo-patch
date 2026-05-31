#!/usr/bin/env node
/**
 * Smoke: ADR-0278 — ModelRouter contextual-uplift bandit (per-(task_type,model)
 * Thompson priors). Drives the deployed MCP surface to prove the de-confounding:
 * record outcomes for two task-types where DIFFERENT models win, then read the
 * per-task-type contextual priors back via hooks_model-stats and assert the
 * winner FLIPS by task-type — while the pooled marginal cannot represent it.
 *
 * WHY THIS FAILS PRE-IMPL:
 *   Pre-0278, ModelRouter priors are unconditional `Record<model, BetaPrior>` —
 *   "haiku wins" is learned marginalized across easy+hard tasks. hooks_model-stats
 *   exposes no `contextualPriors` field at all, so the per-task-type prior the
 *   router would need to de-confound does not exist. The two assertions below
 *   (frontend favors haiku>opus; database favors opus>haiku) cannot both hold
 *   under a single marginal prior.
 *
 *   After ADR-0278, recordOutcome stratifies by deriveTaskType(task) so the
 *   router learns E[reward | model, task_type]; hooks_model-stats surfaces the
 *   `contextualPriors` map keyed `${taskType}:${model}`, and the winner flips
 *   per task-type while the marginal still ranks haiku above opus for both.
 *
 * FAIL pre-impl, PASS post-impl. Reuses the ACCEPT_TEMP install via
 * ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 */
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0278-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0278-model-contextual-bandit');

let passed = 0;
let failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

// `cli mcp exec` prints pretty JSON to stdout; a trailing stderr banner can be
// concatenated, so extract the first balanced {...} object (string-aware).
function extractBalanced(s, from) {
  const start = s.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function parseResult(raw) {
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const json = extractBalanced(body, 0);
  if (json === null) return null;
  let obj = null;
  try { obj = JSON.parse(json); } catch { return null; }
  if (obj && Array.isArray(obj.content) && obj.content[0]?.text) { try { obj = JSON.parse(obj.content[0].text); } catch {} }
  return obj;
}

function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], {
    cwd: dir, encoding: 'utf8', timeout: 45000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return { obj: parseResult(`${r.stdout || ''}\n${r.stderr || ''}`), status: r.status, raw: `${r.stdout || ''}\n${r.stderr || ''}` };
}

// Outcome fixture. Two task-types where DIFFERENT models win:
//   frontend → haiku succeeds, opus is wasteful (escalated)
//   database → opus succeeds, haiku fails
// Resulting contextual posterior means (cost-adjusted Bernoulli rewards: haiku
// success=1.0, opus success=0.4, escalated=0.0, failure=0.0):
//   frontend:haiku Beta(4,1)=0.80 > frontend:opus Beta(1,3)=0.25
//   database:opus Beta(2.2,2.8)=0.44 > database:haiku Beta(1,4)=0.20
//   marginal haiku Beta(4,4)=0.50 > marginal opus Beta(2.2,4.8)=0.31  ← the confound
const FRONTEND = 'fix the frontend layout';   // deriveTaskType → 'frontend'
const DATABASE = 'optimize the database schema'; // deriveTaskType → 'database'
const OUTCOMES = [
  ...Array.from({ length: 3 }, () => ({ task: FRONTEND, model: 'haiku', outcome: 'success' })),
  ...Array.from({ length: 2 }, () => ({ task: FRONTEND, model: 'opus', outcome: 'escalated' })),
  ...Array.from({ length: 3 }, () => ({ task: DATABASE, model: 'opus', outcome: 'success' })),
  ...Array.from({ length: 3 }, () => ({ task: DATABASE, model: 'haiku', outcome: 'failure' })),
];

const betaMean = (p) => (p && typeof p.alpha === 'number' && typeof p.beta === 'number')
  ? p.alpha / (p.alpha + p.beta) : null;

async function main() {
  log(`\n[ADR-0278 smoke] ModelRouter contextual-uplift bandit (per-(task_type,model) priors de-confound selection)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0278', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared); }
    testBodyStart = process.hrtime.bigint();

    // Clean slate: drop any persisted router state copied from the harness .swarm.
    try { rmSync(join(dir, '.swarm', 'model-router-state.json'), { force: true }); } catch {}

    // ── Step 1: record outcomes for two task-types where different models win. ──
    let recorded = 0;
    for (const o of OUTCOMES) {
      const { obj } = mcpExec(cli, dir, 'hooks_model-outcome', o);
      if (obj?.recorded) recorded++;
    }
    log(`[smoke] recorded ${recorded}/${OUTCOMES.length} outcomes`);
    if (recorded < OUTCOMES.length) {
      fail('outcome-record', `only ${recorded}/${OUTCOMES.length} outcomes recorded — hooks_model-outcome unavailable or rejecting`);
      return finish(dir, shared);
    }
    pass(`recorded ${recorded} task-type-stratified outcomes`);

    // ── Step 2: read the contextual priors back via hooks_model-stats. ──
    const stats = mcpExec(cli, dir, 'hooks_model-stats', {});
    const ctx = stats.obj?.contextualPriors;
    const glob = stats.obj?.globalPriors;
    log(`[smoke] stats.contextualPriors keys: ${ctx ? Object.keys(ctx).join(', ') : '(absent)'}`);

    if (!ctx || typeof ctx !== 'object') {
      fail('contextual-priors-absent', `hooks_model-stats exposes no contextualPriors field — ADR-0278 stats wiring not shipped (got keys: ${stats.obj ? Object.keys(stats.obj).join(',') : 'null'})`);
      return finish(dir, shared);
    }
    pass('hooks_model-stats exposes the contextualPriors map (ADR-0278 wiring shipped)');

    // ── Step 3: the contextual winner FLIPS by task-type (the de-confounding). ──
    const fH = betaMean(ctx['frontend:haiku']);
    const fO = betaMean(ctx['frontend:opus']);
    const dO = betaMean(ctx['database:opus']);
    const dH = betaMean(ctx['database:haiku']);
    log(`[smoke] frontend: haiku=${fH} opus=${fO} | database: opus=${dO} haiku=${dH}`);

    if (fH === null || fO === null || dO === null || dH === null) {
      fail('contextual-keys-missing', `expected frontend:{haiku,opus} + database:{opus,haiku} keys; got ${Object.keys(ctx).join(',')}`);
    } else if (fH > fO && dO > dH) {
      pass(`contextual winner flips by task-type: frontend favors haiku (${fH.toFixed(2)}>${fO.toFixed(2)}), database favors opus (${dO.toFixed(2)}>${dH.toFixed(2)})`);
    } else {
      fail('no-deconfounding', `winner did not flip per task-type: frontend haiku=${fH} opus=${fO}; database opus=${dO} haiku=${dH}`);
    }

    // ── Step 4: the pooled marginal still ranks haiku>opus for BOTH — the
    //   confound the per-task-type stratification corrects. ──
    const mH = betaMean(glob?.haiku);
    const mO = betaMean(glob?.opus);
    log(`[smoke] marginal: haiku=${mH} opus=${mO}`);
    if (mH !== null && mO !== null && mH > mO) {
      pass(`pooled marginal ranks haiku>opus (${mH.toFixed(2)}>${mO.toFixed(2)}) — the de-confounding is invisible to the old per-model bandit`);
    } else {
      fail('marginal-shape', `expected marginal haiku>opus (the confound); got haiku=${mH} opus=${mO}`);
    }

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish();
}

function finish() {
  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0278 contextual-uplift bandit not effective (no contextualPriors surface, or the per-task-type winner did not flip).\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR-0278 WIRED: outcomes stratify by task-type → contextual priors de-confound selection (winner flips per task-type) while the pooled marginal cannot represent it.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

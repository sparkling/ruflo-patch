#!/usr/bin/env node
/**
 * Smoke: ADR-0280 — causal recall on the default routing hot path. Verifies the
 * cross-process bridge that feeds the de-confounded action-value uplift (ADR-0279)
 * to the live routing decisions (the ModelRouter A-coupling + LocalReasoningBank
 * rerank): `routeLearningOp('run')` persists `report.learned.actionValues` to
 * `.swarm/action-values.json` so the routing process (a separate process from the
 * learn worker) can blend `β·uplift` into its rank.
 *
 * WHY THIS FAILS PRE-IMPL:
 *   Pre-0280 the learner report's action-values (ADR-0279) are never persisted —
 *   the routing hot path has no in-process source for E[reward | action, task_type],
 *   so it cannot de-confound. `.swarm/action-values.json` does not exist.
 *
 *   After ADR-0280, the learner run writes the file (de-confounded uplift per
 *   action), and the ModelRouter (actionUpliftGamma>0) + LocalReasoningBank
 *   (RUFLO_ROUTE_ACTION_UPLIFT>0) blend it into selection — an action that
 *   *causes* success outranks one that merely co-occurs. (The blend itself is
 *   covered deterministically by the cli unit tests; this smoke verifies the
 *   shipped persistence bridge end-to-end.)
 *
 * FAIL pre-impl, PASS post-impl. Reuses the ACCEPT_TEMP install via
 * ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 */
import { existsSync, mkdirSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0280-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0280-routing-action-uplift');

let passed = 0;
let failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

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

const TASK = 'deploy the payment service to production'; // deriveTaskType → 'deploy'
const TS_BASE = 1_700_000_000;
const EPISODES = [];
for (let i = 0; i < 10; i++) {
  EPISODES.push({ task: TASK, action: 'opus', reward: 0.9, success: true, ts: TS_BASE + i });
  EPISODES.push({ task: TASK, action: 'haiku', reward: 0.2, success: false, ts: TS_BASE + 100 + i });
}

async function main() {
  log(`\n[ADR-0280 smoke] routing-hot-path bridge — learner persists action-value uplift for the routers to consume`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0280', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared); }
    testBodyStart = process.hrtime.bigint();

    // Clean slate for the persisted bridge file.
    const avPath = join(dir, '.swarm', 'action-values.json');
    try { rmSync(avPath, { force: true }); } catch {}

    // ── Step 1: write action-tagged episodes (opus wins, haiku loses). ──
    const sid = `adr0280-smoke-${Date.now()}`;
    let wrote = 0;
    for (const ep of EPISODES) {
      const { obj } = mcpExec(cli, dir, 'agentdb_reflexion-store', {
        session_id: sid, task: ep.task, action: ep.action, reward: ep.reward, success: ep.success, ts: ep.ts,
      });
      if (obj?.success) wrote++;
    }
    log(`[smoke] wrote ${wrote}/${EPISODES.length} action-tagged episodes`);
    if (wrote < EPISODES.length) { fail('episode-write', `only ${wrote}/${EPISODES.length} stored`); return finish(dir, shared); }
    pass(`wrote ${wrote} action-tagged episodes`);

    // ── Step 2: run the learner — the run path persists action-values.json. ──
    const lr = mcpExec(cli, dir, 'agentdb_learner_run', {});
    log(`[smoke] learner_run status=${lr.status}`);

    // ── Step 3: the cross-process bridge file exists with de-confounded uplift. ──
    if (!existsSync(avPath)) {
      fail('bridge-absent', `${avPath} not written — routeLearningOp('run') did not persist the action-values bridge (the routing hot path has no source for E[reward|action,task_type])`);
      return finish(dir, shared);
    }
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(avPath, 'utf-8')); } catch (e) { fail('bridge-parse', String(e)); return finish(dir, shared); }
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    log(`[smoke] action-values.json rows=${rows.length}: ${JSON.stringify(rows).slice(0, 400)}`);
    pass(`routing bridge persisted: .swarm/action-values.json (${rows.length} rows)`);

    const opus = rows.find((r) => r.action === 'opus' && r.taskType === 'deploy');
    const haiku = rows.find((r) => r.action === 'haiku' && r.taskType === 'deploy');
    if (!opus || !haiku) {
      fail('bridge-keys', `expected (deploy, opus) + (deploy, haiku) rows; got ${rows.map((r) => `${r.taskType}:${r.action}`).join(', ')}`);
    } else if (opus.uplift > 0 && haiku.uplift < 0 && opus.uplift > haiku.uplift) {
      pass(`bridge carries de-confounded uplift: opus +${opus.uplift.toFixed(2)} > haiku ${haiku.uplift.toFixed(2)} — the routers can rank the action that CAUSES success above the one that merely co-occurs`);
    } else {
      fail('bridge-uplift', `expected opus.uplift>0>haiku.uplift; got opus=${opus.uplift} haiku=${haiku.uplift}`);
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
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0280 routing bridge not effective (action-values.json not persisted, or missing de-confounded uplift).\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR-0280 WIRED: the learner persists de-confounded action-value uplift to .swarm/action-values.json so the routing hot path (ModelRouter A-coupling + LocalReasoningBank rerank, ON by default, self-inert until this data exists, unit-tested) de-confounds selection.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

#!/usr/bin/env node
/**
 * Smoke: ADR-0279 — episodes carry an `action` dimension → NightlyLearner
 * aggregates E[reward | action, task_type] (the keystone that turns the
 * autonomous loop's output into action-value the routers can consume).
 *
 * Records episodes via agentdb_reflexion-store with an explicit `action` (the
 * model/agent used) + reward, for ONE task-type where DIFFERENT actions earn
 * different rewards, then runs agentdb_learner_run and reads the new
 * `report.learned.actionValues` aggregate — asserting the action-value reflects
 * the actions (the high-reward action ranks above the low-reward one, with a
 * positive uplift vs the task-type baseline).
 *
 * WHY THIS FAILS PRE-IMPL:
 *   Pre-0279 the `episodes` table has no `action` column, agentdb_reflexion-store
 *   has no `action` param, and the cli adapter (makeCliReflexionStoreWriter)
 *   drops anything it doesn't explicitly map — so the action never reaches
 *   SQLite. NightlyLearner has no E[reward | action, task_type] aggregate, so
 *   `report.learned.actionValues` does not exist. The loop's uplift is keyed by
 *   episode-pairs, NOT by the action taken.
 *
 *   After ADR-0279, the action threads MCP-tool → handler → adapter → INSERT
 *   (episodes.action; the ensureEpisodeColumns ALTER backfills existing dbs), and
 *   NightlyLearner.computeActionValues() returns the per-(action, task_type)
 *   value + de-confounded uplift in the learner report.
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0279-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0279-episodes-action-dimension');

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

// One task-type ('deploy'), two actions earning different rewards:
//   action 'opus'  → reward 0.9 (the right action here)
//   action 'haiku' → reward 0.2 (the wrong action here)
// Resulting action-values: opus meanReward 0.9 (uplift +0.35 vs baseline 0.55),
// haiku meanReward 0.2 (uplift −0.35). distinct ts (now that ADR-0279 also
// makes the ADR-0277 ts actually flow through the cli adapter).
const TASK = 'deploy the payment service to production'; // deriveTaskType → 'deploy'
const TS_BASE = 1_700_000_000;
const EPISODES = [];
for (let i = 0; i < 10; i++) {
  EPISODES.push({ task: TASK, action: 'opus', reward: 0.9, success: true, ts: TS_BASE + i });
  EPISODES.push({ task: TASK, action: 'haiku', reward: 0.2, success: false, ts: TS_BASE + 100 + i });
}

async function main() {
  log(`\n[ADR-0279 smoke] episodes carry an action dimension → NightlyLearner aggregates E[reward | action, task_type]`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0279', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared); }
    testBodyStart = process.hrtime.bigint();

    // ── Step 1: write action-tagged episodes (the plumbing under test). ──
    const sid = `adr0279-smoke-${Date.now()}`;
    let wrote = 0;
    for (const ep of EPISODES) {
      const { obj } = mcpExec(cli, dir, 'agentdb_reflexion-store', {
        session_id: sid, task: ep.task, task_type: 'deploy', action: ep.action, reward: ep.reward, success: ep.success, ts: ep.ts,
      });
      if (obj?.success) wrote++;
    }
    log(`[smoke] wrote ${wrote}/${EPISODES.length} action-tagged episodes (session=${sid})`);
    if (wrote < EPISODES.length) {
      fail('episode-write', `only ${wrote}/${EPISODES.length} episodes stored`);
      return finish(dir, shared);
    }
    pass(`wrote ${wrote} action-tagged episodes`);

    // ── Step 2: run the learner; read the action-value aggregate. ──
    const lr = mcpExec(cli, dir, 'agentdb_learner_run', {});
    const report = lr.obj?.report ?? {};
    const learned = report.learned ?? report;
    const actionValues = Array.isArray(learned.actionValues) ? learned.actionValues : null;
    log(`[smoke] learner_run → actionValues=${actionValues ? `[${actionValues.length}]` : '(absent)'} (status=${lr.status})`);
    log(`  actionValues: ${JSON.stringify(actionValues).slice(0, 500)}`);

    if (!actionValues) {
      fail('action-values-absent', `report.learned.actionValues is absent/not-an-array — the action dimension did not reach the learner (episodes.action unmapped, or computeActionValues not shipped)`);
      return finish(dir, shared);
    }
    pass(`learner report carries the actionValues aggregate (${actionValues.length} rows) — episodes carry action → E[reward | action, task_type]`);

    // ── Step 3: the action-value reflects the actions (de-confounded). ──
    const opus = actionValues.find((a) => a.action === 'opus' && a.taskType === 'deploy');
    const haiku = actionValues.find((a) => a.action === 'haiku' && a.taskType === 'deploy');
    log(`[smoke] opus=${JSON.stringify(opus)} haiku=${JSON.stringify(haiku)}`);

    if (!opus || !haiku) {
      fail('action-keys-missing', `expected (deploy, opus) + (deploy, haiku) rows; got ${actionValues.map((a) => `${a.taskType}:${a.action}`).join(', ')}`);
    } else if (opus.meanReward > haiku.meanReward && opus.uplift > 0 && haiku.uplift < 0) {
      pass(`action-value reflects the actions: opus E[reward|deploy]=${opus.meanReward.toFixed(2)} (uplift +${opus.uplift.toFixed(2)}) > haiku ${haiku.meanReward.toFixed(2)} (uplift ${haiku.uplift.toFixed(2)}) — routers can ask "what does doing X cause?"`);
    } else {
      fail('action-value-shape', `expected opus>haiku with opus.uplift>0>haiku.uplift; got opus(mean=${opus.meanReward}, uplift=${opus.uplift}) haiku(mean=${haiku.meanReward}, uplift=${haiku.uplift})`);
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
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0279 episode action-dimension not effective (action did not reach SQLite, or the E[reward | action, task_type] aggregate is missing).\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR-0279 WIRED: episodes carry the action taken → NightlyLearner aggregates E[reward | action, task_type] → action-value (with de-confounded uplift) is queryable by the routers.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

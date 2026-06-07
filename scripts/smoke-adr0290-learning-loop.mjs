#!/usr/bin/env node
/**
 * ADR-0290 smoke — automatic learning capture: hook → episode → learner → action-values.
 *
 * Drives the WHOLE Phase-1 learning loop end-to-end against an installed cli,
 * through the FILE-BASED hook (never a manual MCP call — the ADR-0290
 * Confirmation requirement), asserting every link the ADR names:
 *
 *   A1 — GENERATOR: the init-generated .claude/helpers/hook-handler.mjs contains
 *        the ADR-0290 capture wiring (outcome derivation + detached capture
 *        spawn + escape hatch), and settings.json wires PostToolUse(Task) →
 *        hook-handler post-task.
 *   A2 — CAPTURE (hook → episode): a realistic PostToolUse(Task) stdin payload
 *        (the shape Claude Code 2.1.x actually sends, captured live 2026-06-04)
 *        driven through `node hook-handler.mjs post-task` produces an `episodes`
 *        row with REAL metadata: task_type derived from the description
 *        ('authentication'), action = subagent_type, reward = 0.6 (quality-absent
 *        skeptic default, ADR-0268 R3), success = 1, session_id forwarded.
 *   A3 — METADATA-ONLY (PII gate) — this IS the ADR-0289 Phase-1 acceptance:
 *        the canaries are PII-shaped (a fake secret + a fake email), and the
 *        episode row contains NO token of the description or prompt (canaries
 *        absent), free-text columns (input/output/code/critique) are NULL, the
 *        task label is the derived type slug, and NO episode_embeddings row was
 *        written (skipEmbedding — ADR-0287 F10 constraint 4: no per-task embed
 *        in the capture path). Proves "no raw secret/PII in the episode row or
 *        its embedding source" — ADR-0289 Phase-1, delivered via ADR-0290.
 *   A4 — NO FABRICATION: a payload with no derivable outcome (missing
 *        tool_response) dispatches NO capture and records nothing.
 *   A5 — LEARNER (episode → action-values): `daemon trigger -w learn` (the same
 *        runLearnWorker the hourly scheduled row drives) runs NightlyLearner
 *        over the episodes and persists .swarm/action-values.json containing
 *        the (taskType='authentication', action=<smoke agent>) row.
 *
 * Uses a unique per-run agent + session id so assertions are deterministic
 * regardless of shared-db state. Reuses the ACCEPT_TEMP install via
 * ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 * FAILs pre-impl (cli rejects --task/--session; no capture wiring in the
 * generated hook), PASSes after ADR-0290 Phase 1 lands.
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'node:fs';
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0290-learning-loop-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0290-learning-loop');

let passed = 0;
let failed = 0;
function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

/** Query via the sqlite3 CLI. Fails loud when sqlite3 is unavailable —
 *  a silently skipped assertion would recreate the dormant-but-green
 *  illusion ADR-0287 F10 exposed (feedback-no-fallbacks). */
function sqliteQuery(db, sql) {
  const r = spawnSync('sqlite3', [db, sql], { encoding: 'utf8', timeout: 15000 });
  if (r.error) return { error: String(r.error) };
  if (r.status !== 0) return { error: `rc=${r.status}: ${(r.stderr || '').slice(0, 200)}` };
  return { out: (r.stdout || '').trim() };
}

function runHook(tempDir, payload, env) {
  return spawnSync('node', [join(tempDir, '.claude', 'helpers', 'hook-handler.mjs'), 'post-task'], {
    cwd: tempDir,
    encoding: 'utf8',
    timeout: 30000,
    input: JSON.stringify(payload),
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY, ...env },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log(`\n[ADR-0290 smoke] automatic learning capture: hook → episode → learner → action-values`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0290-learning-loop', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }
  log(`[smoke] cli: ${cli}`);
  const testBodyStart = process.hrtime.bigint();

  // Unique per-run identity — deterministic regardless of shared-db state.
  const runTag = Date.now().toString(36);
  const agent = `coder-a90${runTag}`;
  const sessionId = `adr0290-smoke-${runTag}`;
  const taskUseId = `toolu_adr0290_${runTag}`;
  // Two canaries that must NEVER appear in any durable row: one in the
  // description (consumed for task_type derivation, then dropped) and one in
  // the prompt (never even forwarded). ADR-0289 Phase-1 acceptance: the
  // canaries are PII-SHAPED (a fake secret + a fake email) so A3 below
  // literally proves "no raw secret/PII string in the episode row or its
  // embedding source" — the Phase-1 metadata-only PII gate. Both are
  // synthetic (clearly non-real credentials), used only as absence canaries.
  const descCanary = `sk-FAKE-${runTag}-NOTASECRET`;
  const promptCanary = `canary-${runTag}@example.test`;
  const description = `fix authentication bug ${descCanary} in login flow`;

  // ── A1: generator emitted the capture wiring ─────────────────────────────
  const hookPath = join(tempDir, '.claude', 'helpers', 'hook-handler.mjs');
  if (!existsSync(hookPath)) {
    fail('1: generated hook-handler.mjs exists', `missing: ${hookPath}`);
  } else {
    const src = readFileSync(hookPath, 'utf8');
    const markers = ['RUFLO_DISABLE_TASK_CAPTURE', 'RUFLO_TASK_CAPTURE_CMD', "'post-task'", '--task-id'];
    const missing = markers.filter((m) => !src.includes(m));
    if (missing.length === 0) pass('1a: generated hook-handler.mjs contains ADR-0290 capture wiring');
    else fail('1a: generated hook-handler.mjs capture wiring', `missing markers: ${missing.join(', ')}`);
  }
  const settingsPath = join(tempDir, '.claude', 'settings.json');
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const postTask = (settings?.hooks?.PostToolUse || []).find((h) => h.matcher === 'Task');
    const cmd = postTask?.hooks?.[0]?.command || '';
    if (cmd.includes('post-task')) pass('1b: settings.json wires PostToolUse(Task) → hook-handler post-task');
    else fail('1b: settings.json PostToolUse(Task) wiring', `command: ${cmd.slice(0, 120) || '(none)'}`);
  } catch (e) {
    fail('1b: settings.json PostToolUse(Task) wiring', `unreadable: ${e?.message || e}`);
  }

  // ── A2: hook → episode (the live capture, file-based-hook-driven) ────────
  // Payload shape captured from a live Claude Code 2.1.162 PostToolUse(Task)
  // event (tool_name 'Agent', tool_response.status 'completed').
  const payload = {
    session_id: sessionId,
    cwd: tempDir,
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: {
      description,
      prompt: `Do the thing. ${promptCanary}`,
      subagent_type: agent,
    },
    tool_response: { status: 'completed', content: [{ type: 'text', text: 'done' }] },
    tool_use_id: taskUseId,
  };
  log(`[smoke] capture: hook-handler post-task (agent=${agent}, session=${sessionId})`);
  const hookRun = runHook(tempDir, payload, { RUFLO_TASK_CAPTURE_CMD: cli });
  const hookOut = `${hookRun.stdout || ''}${hookRun.stderr || ''}`;
  if (hookRun.status === 0 && hookOut.includes('[ADR-0290] episode capture dispatched')) {
    pass('2a: hook exits 0 and dispatches the capture');
  } else {
    fail('2a: hook dispatch', `rc=${hookRun.status} out: ${hookOut.slice(0, 300)}`);
  }

  // Poll for the episode row (detached capture child does a full cold
  // registry init — allow a generous bound, fail loud after it).
  const db = join(tempDir, '.swarm', 'memory.db');
  const rowSql = `SELECT task, task_type, action, reward, success, session_id, ` +
    `COALESCE(input,'∅'), COALESCE(output,'∅'), COALESCE(code,'∅'), COALESCE(critique,'∅'), id ` +
    `FROM episodes WHERE session_id='${sessionId}' LIMIT 1;`;
  let row = null;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const q = sqliteQuery(db, rowSql);
    if (q.out) { row = q.out; break; }
    if (q.error && !/no such table|unable to open/i.test(q.error)) {
      log(`  [poll] sqlite: ${q.error}`);
    }
    await sleep(1000);
  }
  const captureLog = join(tempDir, '.claude-flow', 'metrics', 'post-task-capture.log');
  if (!row) {
    const tail = existsSync(captureLog)
      ? readFileSync(captureLog, 'utf8').slice(-400)
      : '(no capture log)';
    fail('2b: episode row appears', `timed out after 120s; capture log tail: ${tail}`);
  } else {
    const [task, taskType, action, reward, success, sess, inp, outp, code, critique, episodeId] = row.split('|');
    if (taskType === 'authentication') pass(`2c: task_type derived from description ('${taskType}')`);
    else fail('2c: task_type derived', `expected 'authentication', got '${taskType}'`);
    if (action === agent) pass(`2d: action = subagent_type ('${action}')`);
    else fail('2d: action = subagent_type', `expected '${agent}', got '${action}'`);
    if (Number(reward) === 0.6) pass('2e: reward = 0.6 (quality-absent skeptic default, ADR-0268 R3)');
    else fail('2e: reward skeptic default', `expected 0.6, got ${reward}`);
    if (Number(success) === 1) pass('2f: success = 1');
    else fail('2f: success', `expected 1, got ${success}`);
    if (sess === sessionId) pass('2g: session_id forwarded');
    else fail('2g: session_id forwarded', `expected '${sessionId}', got '${sess}'`);

    // ── A3: metadata-only / PII gate ──────────────────────────────────────
    if (task === 'authentication') pass(`3a: task label is the derived type slug (no raw description)`);
    else fail('3a: task label', `expected 'authentication', got '${task}'`);
    if (row.includes(descCanary) || row.includes(promptCanary)) {
      fail('3b: PII gate — no canary in the episode row', `canary leaked: ${row.slice(0, 200)}`);
    } else {
      pass('3b: PII gate — description/prompt canaries absent from the row');
    }
    if (inp === '∅' && outp === '∅' && code === '∅' && critique === '∅') {
      pass('3c: free-text columns (input/output/code/critique) are NULL');
    } else {
      fail('3c: free-text columns NULL', `input=${inp} output=${outp} code=${code} critique=${critique}`);
    }
    const emb = sqliteQuery(db, `SELECT count(*) FROM episode_embeddings WHERE episode_id=${episodeId};`);
    if (emb.out === '0') pass('3d: no episode_embeddings row (skipEmbedding — no per-task embed)');
    else if (emb.error && /no such table/i.test(emb.error)) pass('3d: no episode_embeddings table at all (no per-task embed)');
    else fail('3d: skipEmbedding', `episode_embeddings count for episode ${episodeId}: ${emb.out ?? emb.error}`);
    // Whole-DB canary sweep — nothing on the capture path may durably store
    // the description/prompt anywhere (routing-outcomes stays dormant, etc.).
    const sweep = sqliteQuery(db, `SELECT count(*) FROM episodes WHERE task LIKE '%${descCanary}%' OR task LIKE '%${promptCanary}%';`);
    const outcomesPath = join(tempDir, '.claude-flow', 'routing-outcomes.json');
    const outcomesLeak = existsSync(outcomesPath) && readFileSync(outcomesPath, 'utf8').includes(descCanary);
    if (sweep.out === '0' && !outcomesLeak) pass('3e: canaries absent from episodes + routing-outcomes (free-text sinks dormant)');
    else fail('3e: free-text sinks dormant', `episodes-like=${sweep.out ?? sweep.error} routing-outcomes-leak=${outcomesLeak}`);
  }
  if (existsSync(captureLog) && statSync(captureLog).size > 0) {
    pass('2h: capture child output logged (post-task-capture.log non-empty)');
  } else {
    fail('2h: capture log', 'missing or empty .claude-flow/metrics/post-task-capture.log');
  }

  // ── A4: no fabrication — underivable outcome dispatches nothing ──────────
  const sizeBefore = existsSync(captureLog) ? statSync(captureLog).size : 0;
  const noOutcome = runHook(tempDir, {
    session_id: `${sessionId}-no-outcome`,
    tool_name: 'Agent',
    tool_input: { description: 'another task', subagent_type: agent },
    // tool_response deliberately absent
  }, { RUFLO_TASK_CAPTURE_CMD: cli });
  const noOut = `${noOutcome.stdout || ''}${noOutcome.stderr || ''}`;
  const sizeAfter = existsSync(captureLog) ? statSync(captureLog).size : 0;
  if (
    noOutcome.status === 0 &&
    !noOut.includes('[ADR-0290] episode capture dispatched') &&
    noOut.includes('outcome=unknown') &&
    sizeAfter === sizeBefore
  ) {
    pass('4: underivable outcome → no capture dispatched, no fabrication');
  } else {
    fail('4: no-fabrication path', `rc=${noOutcome.status} logΔ=${sizeAfter - sizeBefore} out: ${noOut.slice(0, 200)}`);
  }

  // ── A5: learner consumes episodes → action-values.json ───────────────────
  // `daemon trigger -w learn` runs the SAME runLearnWorker the hourly
  // scheduled `learn` row drives (routeLearningOp('run') → NightlyLearner →
  // persistActionValues), in-process, anchored at the project root.
  log(`[smoke] learn: daemon trigger -w learn`);
  const learn = spawnSync(cli, ['daemon', 'trigger', '-w', 'learn'], {
    cwd: tempDir,
    encoding: 'utf8',
    timeout: 300000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (learn.status === 0) pass('5a: daemon trigger -w learn rc=0');
  else fail('5a: daemon trigger -w learn', `rc=${learn.status}: ${(learn.stderr || learn.stdout || '').slice(0, 300)}`);

  const avPath = join(tempDir, '.swarm', 'action-values.json');
  if (!existsSync(avPath)) {
    const learnJson = join(tempDir, '.claude-flow', 'metrics', 'learn.json');
    const lj = existsSync(learnJson) ? readFileSync(learnJson, 'utf8').slice(0, 300) : '(no learn.json)';
    fail('5b: action-values.json persisted', `missing ${avPath}; learn.json: ${lj}`);
  } else {
    try {
      const av = JSON.parse(readFileSync(avPath, 'utf8'));
      const rows = Array.isArray(av?.rows) ? av.rows : [];
      const mine = rows.find((r) => r.action === agent && r.taskType === 'authentication');
      if (mine && mine.samples >= 1 && Math.abs(mine.meanReward - 0.6) < 1e-9) {
        pass(`5b: action-values row (taskType=authentication, action=${agent}, samples=${mine.samples}, meanReward=${mine.meanReward})`);
      } else if (mine) {
        fail('5b: action-values row shape', JSON.stringify(mine).slice(0, 200));
      } else {
        fail('5b: action-values row', `no (authentication, ${agent}) row among ${rows.length} rows`);
      }
    } catch (e) {
      fail('5b: action-values.json parse', String(e?.message || e));
    }
  }

  perf.mark('test-body', testBodyStart);
  perf.emitJson();

  log(`\n[ADR-0290 smoke] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  log(`[smoke] FATAL: ${e?.stack || e}`);
  process.exit(1);
});

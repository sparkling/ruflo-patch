#!/usr/bin/env node
/**
 * Smoke: ADR-0277 — close the autonomous causal-learning loop (episodes →
 * NightlyLearner → non-null `uplift` causal_edges → uplift-ranked causal-recall).
 *
 * WHY THIS FAILS PRE-IMPL (probed against patch.358, 2026-05-31):
 *   The NightlyLearner producer engine is complete (reward-delta uplift +
 *   doubly-robust, `NightlyLearner.ts`), but the scheduled learning path
 *   resolves the WRONG controller: `controller-registry.ts:1692` returns the
 *   `MemoryConsolidator` (skill consolidation) when a MemoryService is
 *   registered, with the real `NightlyLearner` only on the fallback branch
 *   (:1739). So even with plenty of varied-reward episodes, the learner run
 *   produces zero causal edges and zero uplift — it ran the consolidator, not
 *   the uplift estimator. Live probe (12 varied-reward episodes written first):
 *     learner_run → edgesDiscovered:0  avgUplift:0  skillsCreated:2
 *                   (skillsCreated>0, edges=0  ⇒ consolidator ran, not the learner)
 *     causal-recall → count:0  controller:"archivist"   (cold-start; no uplift edges)
 *
 *   After ADR-0277 (I1 schedule the producer + I2 resolve the REAL NightlyLearner
 *   in the scheduled path), the same episode stream yields causal_edges with real
 *   non-null `uplift`, and `agentdb_causal-recall` returns those edges
 *   uplift-ranked.
 *
 * The §Confirmation of ADR-0277:
 *   - write N episodes with VARIED rewards (real reward-delta signal)
 *   - trigger the scheduled learner path (here: invoke agentdb_learner_run
 *     directly — the ADR permits direct invocation for the smoke)
 *   - assert SQLite causal_edges gains rows with NON-NULL uplift
 *   - assert agentdb_causal-recall returns those edges uplift-ranked
 *
 * FAIL pre-impl, PASS post-impl. Reuses the ACCEPT_TEMP install via
 * ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0277-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0277-causal-learning-loop');

let passed = 0;
let failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

// Extract the first balanced {...} object starting at `from`, honouring strings
// and escapes — `cli mcp exec` prints pretty JSON to stdout but a trailing
// stderr banner (concatenated after) breaks a naive `JSON.parse(slice)`.
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

// NightlyLearner.discoverCausalEdges (the doubly-robust path run() uses) writes
// an edge for an episode pair iff: (a) SAME session, (b) temporally ordered
// (e2.ts > e1.ts, within 1h), (c) |doublyRobustEstimate| >= 0.05, and (d)
// confidence = min(N/100,1)·min(|uplift|/0.5,1) >= 0.6 where N = same-task count.
// To satisfy all four with a synthetic fixture: ONE task observed many times
// with a strong success/failure reward split + DISTINCT increasing timestamps
// (ADR-0277 added a `ts` param to agentdb_reflexion-store for exactly this —
// without it, fast writes share strftime('now') and form zero temporal pairs).
// 80 samples → confidence sampleFactor 0.8; reward split 0.95/0.05 makes the
// doubly-robust estimate for low-reward-ending pairs ≈ -0.9 (effectSize 1.0) →
// confidence 0.8 >= 0.6 → edges discovered.
const TS_BASE = 1_700_000_000; // fixed unix-seconds base; +i gives distinct, increasing, same-session ts.
const EPISODES = [];
for (let i = 0; i < 80; i++) {
  EPISODES.push({
    task: 'deploy the payment service to production',
    success: i % 2 === 0,
    reward: i % 2 === 0 ? 0.95 : 0.05,
    ts: TS_BASE + i,
  });
}

function isNonNullUplift(v) {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0;
}

async function main() {
  log(`\n[ADR-0277 smoke] autonomous causal-learning loop closes (episodes → uplift → uplift-ranked recall)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0277', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared); }
    testBodyStart = process.hrtime.bigint();

    // ── Step 1: write N episodes with varied rewards (real reward-delta signal). ──
    const sid = `adr0277-smoke-${Date.now()}`;
    let wrote = 0;
    for (const ep of EPISODES) {
      const { obj } = mcpExec(cli, dir, 'agentdb_reflexion-store', {
        session_id: sid, task: ep.task, success: ep.success, reward: ep.reward, ts: ep.ts,
      });
      if (obj?.success) wrote++;
    }
    log(`[smoke] wrote ${wrote}/${EPISODES.length} episodes (session=${sid})`);
    if (wrote < EPISODES.length) {
      fail('episode-write', `only ${wrote}/${EPISODES.length} episodes stored — reflexion-store rejected episodes`);
      return finish(dir, shared);
    } else {
      pass(`wrote ${wrote} varied-reward episodes`);
    }

    // ── Step 2: trigger the scheduled learner path (direct invocation). ──
    const lr = mcpExec(cli, dir, 'agentdb_learner_run', {});
    const report = lr.obj?.report ?? {};
    const edgesDiscovered = typeof report.edgesDiscovered === 'number' ? report.edgesDiscovered : 0;
    const avgUplift = typeof report.avgUplift === 'number' ? report.avgUplift : 0;
    const skillsCreated = typeof report.skillsCreated === 'number' ? report.skillsCreated : 0;
    log(`[smoke] learner_run → edgesDiscovered=${edgesDiscovered} avgUplift=${avgUplift} skillsCreated=${skillsCreated} (status=${lr.status})`);
    log(`  report: ${JSON.stringify(report).slice(0, 400)}`);

    // ── Step 3: the autonomous path ran the REAL NightlyLearner AND it
    //   discovered uplift edges from the temporally-ordered episode stream. ──
    const learnerController = lr.obj?.controller ?? lr.obj?.report?.controller ?? report?.controller ?? '(none)';
    log(`[smoke] learner controller=${learnerController} edgesDiscovered=${edgesDiscovered} avgUplift=${avgUplift} skillsCreated=${skillsCreated}`);
    // 3a — ADR-0277 I2 regression guard: the real NightlyLearner ran, not the
    // MemoryConsolidator the controller-registry factory used to prefer.
    if (learnerController === 'nightlyLearner') {
      pass(`autonomous learner path resolves the REAL NightlyLearner (controller=${learnerController}, not the MemoryConsolidator) — ADR-0277 I2`);
    } else {
      fail('learner-is-consolidator', `controller=${learnerController} skillsCreated=${skillsCreated} — ran the MemoryConsolidator, NOT the NightlyLearner (ADR-0277 I2 not landed)`);
    }
    // 3b — the producer discovered causal edges with real (non-null) uplift from
    // the temporally-ordered, reward-split episodes (ts param + 80 samples).
    if (edgesDiscovered > 0 && isNonNullUplift(avgUplift)) {
      pass(`NightlyLearner discovered ${edgesDiscovered} causal edge(s) with non-null uplift (avgUplift=${avgUplift}) — episodes → uplift causal_edges`);
    } else {
      fail('learner-produced-uplift', `edgesDiscovered=${edgesDiscovered} avgUplift=${avgUplift} — no uplift edges discovered from ${EPISODES.length} temporally-ordered episodes (loop did not close at the producer)`);
    }

    // ── Step 4: causal-recall returns the uplift edges, uplift-ranked. ──
    const recall = mcpExec(cli, dir, 'agentdb_causal-recall', { query: 'deploy the payment service to production', k: 5, include_evidence: true });
    const rr = Array.isArray(recall.obj?.results) ? recall.obj.results : [];
    const recallCtrl = recall.obj?.controller ?? '(none)';
    log(`[smoke] causal-recall → count=${rr.length} controller=${recallCtrl}`);
    log(`  results: ${JSON.stringify(rr).slice(0, 400)}`);
    if (rr.length === 0) {
      fail('causal-recall-cold', `causal-recall returned 0 results — the uplift edges did not flow to the reranker (loop did not close at the consumer)`);
    } else {
      const upliftOf = (r) => {
        for (const k of ['uplift', 'causalUplift', 'causal_uplift', 'score', 'rerankScore', 'causalScore']) {
          const v = r?.[k];
          if (typeof v === 'number' && Number.isFinite(v)) return v;
        }
        return null;
      };
      const seq = rr.map(upliftOf);
      const anyUplift = seq.some((v) => v !== null && v !== 0);
      let ranked = true;
      let prev = Infinity;
      for (const v of seq) { if (v === null) continue; if (v > prev + 1e-9) { ranked = false; break; } prev = v; }
      log(`[smoke] recall uplift sequence: [${seq.join(', ')}]`);
      if (anyUplift && ranked) {
        pass(`causal-recall returned ${rr.length} uplift-ranked result(s) — full loop closed: episodes → uplift → ranked recall`);
      } else if (!anyUplift) {
        fail('causal-recall-uplift', `causal-recall returned ${rr.length} results but none carry non-zero uplift`);
      } else {
        fail('causal-recall-ranking', `causal-recall results not uplift-ranked: [${seq.join(', ')}]`);
      }
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
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0277 autonomous causal-learning loop wiring not effective (real NightlyLearner not resolved, or causal-recall consumer unreachable).\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR-0277 loop WIRED: episodes recorded → autonomous path runs the real NightlyLearner (not the consolidator) → causal-recall consumer reachable. (End-to-end edge discovery needs production-scale temporally-distinct episodes — see the Step-3 note; not exercised by synthetic fixtures.)\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

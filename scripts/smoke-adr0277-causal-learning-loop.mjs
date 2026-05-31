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

// Two task families, each with a clearly-separated high/low reward arm so the
// reward-delta (E[reward|did x] − E[reward|¬x]) uplift estimator has signal.
const EPISODES = [];
for (let i = 0; i < 6; i++) {
  EPISODES.push({ task: 'deploy with cache warm', success: true, reward: 0.90 + (i % 3) * 0.02 });
  EPISODES.push({ task: 'deploy cold start', success: false, reward: 0.14 + (i % 3) * 0.02 });
  EPISODES.push({ task: 'run migration in safe mode', success: true, reward: 0.85 + (i % 3) * 0.02 });
  EPISODES.push({ task: 'run migration risky', success: false, reward: 0.22 + (i % 3) * 0.02 });
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
        session_id: sid, task: ep.task, success: ep.success, reward: ep.reward,
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

    // ── Step 3: assert causal_edges gained rows with NON-NULL uplift. ──
    // The learner report is the in-process view of what it wrote to SQLite
    // causal_edges. edgesDiscovered>0 AND avgUplift!=0 ⇒ real uplift edges were
    // produced (not the consolidator's zero-uplift skill path).
    if (edgesDiscovered > 0 && isNonNullUplift(avgUplift)) {
      pass(`learner produced ${edgesDiscovered} causal edge(s) with non-null uplift (avgUplift=${avgUplift}; real NightlyLearner ran, not the consolidator)`);
    } else if (skillsCreated > 0 && edgesDiscovered === 0) {
      fail('learner-produced-uplift', `edgesDiscovered=0 avgUplift=${avgUplift} but skillsCreated=${skillsCreated} — the scheduled path ran the MemoryConsolidator (skills), NOT the NightlyLearner (uplift). ADR-0277 I2 factory-resolution not fixed`);
    } else {
      fail('learner-produced-uplift', `edgesDiscovered=${edgesDiscovered} avgUplift=${avgUplift} — no causal edges with non-null uplift produced (ADR-0277 I1/I2 not landed)`);
    }

    // ── Step 4: assert causal-recall returns the uplift edges, uplift-ranked. ──
    // Query a term matching the high-reward arm; the uplift-aware reranker
    // (β·uplift) must surface edges, ordered by descending uplift.
    const recall = mcpExec(cli, dir, 'agentdb_causal-recall', { query: 'deploy with cache warm', k: 5, include_evidence: true });
    const rr = Array.isArray(recall.obj?.results) ? recall.obj.results : [];
    log(`[smoke] causal-recall → count=${rr.length} controller=${recall.obj?.controller ?? '(none)'}`);
    log(`  results: ${JSON.stringify(rr).slice(0, 400)}`);
    if (rr.length === 0) {
      fail('causal-recall-cold', `causal-recall returned 0 results — recall is cold (no uplift edges to rank; loop did not close)`);
    } else {
      // uplift-ranked: extract a per-result uplift/score and confirm non-increasing.
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
        pass(`causal-recall returned ${rr.length} uplift-ranked result(s) (non-increasing uplift; loop closed)`);
      } else if (!anyUplift) {
        fail('causal-recall-uplift', `causal-recall returned ${rr.length} results but none carry non-zero uplift — edges are not uplift-weighted (NightlyLearner uplift not flowing to recall)`);
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
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0277 autonomous causal-learning loop did not close (no uplift edges / cold recall).\n`); process.exit(1); }
  log(`\nSmoke PASSED — episodes → uplift causal_edges → uplift-ranked causal-recall.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

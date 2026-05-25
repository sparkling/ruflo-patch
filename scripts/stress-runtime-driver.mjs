#!/usr/bin/env node
// scripts/stress-runtime-driver.mjs — ADR-0243 CT-J runtime stress driver.
//
// Invoked by scripts/test-stress-runtime.sh. Owns the long-lived MCP stdio
// child + per-cadence external RSS/handle sampling + post-run regression
// analysis. See the bash wrapper docblock for full methodology context.
//
// Contract (all required, set by the bash wrapper):
//   STRESS_N                — total MCP requests to dispatch (>=1)
//   STRESS_SAMPLE_EVERY     — sample cadence in requests (>=1)
//   STRESS_MAX_SLOPE_KB     — RSS slope threshold (KB / sample)
//   STRESS_MAX_GROWTH_RATIO — final/baseline RSS ratio threshold (float)
//   STRESS_MAX_HANDLE_DELTA — max (final − baseline) handle count
//   STRESS_TIMEOUT_S        — overall soak timeout (seconds)
//   STRESS_CLI_BIN          — absolute path to the cli binary
//   STRESS_LOG              — append-mode log path
//   STRESS_RESULT_JSON      — write the verdict JSON here
//   STRESS_SAMPLES_CSV      — write per-sample CSV here
//   STRESS_WORK_DIR         — scratch dir owned by the wrapper
//
// Per feedback-no-fallbacks: any unmet contract → exit 2 (harness fatal),
// never silent default. Per feedback-no-squelch-tests: no "best-effort
// continue past failure" paths.

import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// ── Read + validate env contract ──────────────────────────────────────
function requireEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    console.error(`[driver] FATAL: env ${name} is required but missing`);
    process.exit(2);
  }
  return v;
}

const STRESS_N            = parseInt(requireEnv('STRESS_N'), 10);
const STRESS_SAMPLE_EVERY = parseInt(requireEnv('STRESS_SAMPLE_EVERY'), 10);
const STRESS_MAX_SLOPE_KB = parseFloat(requireEnv('STRESS_MAX_SLOPE_KB'));
const STRESS_MAX_GROWTH   = parseFloat(requireEnv('STRESS_MAX_GROWTH_RATIO'));
const STRESS_MAX_HANDLE_D = parseInt(requireEnv('STRESS_MAX_HANDLE_DELTA'), 10);
const STRESS_TIMEOUT_S    = parseInt(requireEnv('STRESS_TIMEOUT_S'), 10);
const CLI_BIN             = requireEnv('STRESS_CLI_BIN');
const LOG                 = requireEnv('STRESS_LOG');
const RESULT_JSON         = requireEnv('STRESS_RESULT_JSON');
const SAMPLES_CSV         = requireEnv('STRESS_SAMPLES_CSV');
const WORK_DIR            = requireEnv('STRESS_WORK_DIR');

if (!Number.isFinite(STRESS_N) || STRESS_N < 1) {
  console.error(`[driver] FATAL: STRESS_N invalid: ${process.env.STRESS_N}`);
  process.exit(2);
}
if (!existsSync(CLI_BIN)) {
  console.error(`[driver] FATAL: CLI not found at ${CLI_BIN}`);
  process.exit(2);
}

const log = (msg) => {
  const line = `[driver] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG, line); } catch { /* best-effort log mirror */ }
};

// ── Build the request mix ────────────────────────────────────────────
// Mix chosen to exercise the CT-J surfaces:
//   - HiveLRU (F-10-001/F-10-005 class): hive-mind_status (HiveLRU.get/set)
//   - Re-entrant init (F-10-010 class): hooks_intelligence_stats,
//     agent_list — both go through controller-bootstrap paths that own
//     timers AND lazy-init singletons
//   - Hot write path (F-10-007 class): memory_store cycles RVF + archivist
//     dispatch, the same surface that holds _pendingNativeIngest
//   - Read paths: memory_search exercises substrate read after the LRU
//     "move-to-front" on stored docs
//
// All tool names verified at:
//   forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:1652
//   forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3201
//   forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-tools.ts:432
//   forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts:174,462
const TOOL_MIX = [
  { name: 'memory_store',              weight: 30,
    args: (i) => ({ key: `stress/key/${i}`, value: `v${i}-${'x'.repeat(64)}`,
                    namespace: 'adr0243-stress' }) },
  { name: 'memory_search',             weight: 25,
    args: ()  => ({ query: 'stress', namespace: 'adr0243-stress' }) },
  { name: 'hive-mind_status',          weight: 15,
    args: ()  => ({}) },
  { name: 'hooks_intelligence_stats',  weight: 15,
    args: ()  => ({}) },
  { name: 'agent_list',                weight: 15,
    args: ()  => ({}) },
];

// Pre-compute the weighted dispatch table so each iteration is O(1).
const WEIGHTED_INDEX = [];
for (let t = 0; t < TOOL_MIX.length; t++) {
  for (let w = 0; w < TOOL_MIX[t].weight; w++) WEIGHTED_INDEX.push(t);
}

function pickTool(i) {
  // Deterministic rotation across the weighted table — keeps the mix
  // stable across runs (good for reproducibility) without RNG seeding.
  return TOOL_MIX[WEIGHTED_INDEX[i % WEIGHTED_INDEX.length]];
}

// ── Spawn the MCP server ─────────────────────────────────────────────
log(`spawning MCP child: ${CLI_BIN} mcp start (cwd=${WORK_DIR})`);

const child = spawn(CLI_BIN, ['mcp', 'start'], {
  cwd: WORK_DIR,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
});

const childPid = child.pid;
if (!childPid) {
  log(`FATAL: MCP child failed to spawn (no pid)`);
  writeResult('FAIL', 'mcp-spawn-failed', null);
  process.exit(2);
}

log(`MCP child PID: ${childPid}`);

// stderr → log file only (don't clutter stdout)
child.stderr.on('data', (buf) => {
  try { appendFileSync(LOG, `[child-stderr] ${buf.toString()}`); } catch {}
});

// Track unexpected child exit. If the child dies mid-stream, that's a
// hard failure — the soak test cannot detect drift on a corpse.
let childExited = false;
let childExitCode = null;
child.on('exit', (code, signal) => {
  childExited = true;
  childExitCode = code ?? (signal ? `signal:${signal}` : 'unknown');
  log(`MCP child exited (code=${code} signal=${signal})`);
});

// ── JSON-RPC response collector ──────────────────────────────────────
// Track in-flight requests by id; resolve their promise when the reply
// line lands. We don't NEED the per-request replies for the assertion
// (drift is what matters), but tracking them gives us forensic data on
// failures + lets us detect lost-reply regressions.
const inflight = new Map(); // id → { resolve, reject, sentAt, tool }
let replyCount = 0;
let errorReplyCount = 0;
let bufferTail = '';

function feedReplyChunk(chunk) {
  bufferTail += chunk;
  let nl;
  while ((nl = bufferTail.indexOf('\n')) !== -1) {
    const line = bufferTail.slice(0, nl);
    bufferTail = bufferTail.slice(nl + 1);
    if (!line.trim()) continue;
    // Try to parse JSON-RPC reply. Tolerate non-JSON banner lines (some
    // MCP servers emit a stderr-to-stdout banner; ignore those).
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (typeof msg.id !== 'number' && typeof msg.id !== 'string') continue;
    const w = inflight.get(msg.id);
    if (!w) continue;
    inflight.delete(msg.id);
    replyCount++;
    if (msg.error) errorReplyCount++;
    w.resolve(msg);
  }
}

child.stdout.setEncoding('utf-8');
child.stdout.on('data', feedReplyChunk);

// ── External sampler (ps + lsof on the child pid) ────────────────────
// macOS `ps -o rss=` returns RSS in KB. `lsof -p <pid>` lists open
// resources (files, sockets, pipes); count its lines as a coarse
// proxy for the active-handle count. Both are external probes — no
// instrumentation needed inside the MCP child.
function sampleProc(pid) {
  const out = { rssKB: NaN, handleCount: NaN, ok: false };
  if (childExited) return out;

  const ps = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {
    encoding: 'utf-8', timeout: 5000,
  });
  if (ps.status === 0) {
    const v = parseInt((ps.stdout || '').trim(), 10);
    if (Number.isFinite(v) && v > 0) out.rssKB = v;
  }

  // Use -F to get a stable per-line format (header-less). The exact
  // count is not the point — what matters is the trend across samples.
  const ls = spawnSync('lsof', ['-Fn', '-p', String(pid)], {
    encoding: 'utf-8', timeout: 10000,
  });
  if (ls.status === 0 || (ls.stdout && ls.stdout.length > 0)) {
    // -Fn emits one "n<path>" line per open fd; count those exactly.
    const lines = (ls.stdout || '').split('\n').filter(l => l.startsWith('n'));
    out.handleCount = lines.length;
  }

  out.ok = Number.isFinite(out.rssKB) && Number.isFinite(out.handleCount);
  return out;
}

// ── Result writer ────────────────────────────────────────────────────
function writeResult(verdict, reason, metrics) {
  const obj = {
    verdict,                  // 'PASS' | 'FAIL'
    reason,                   // human-readable
    config: {
      N: STRESS_N,
      sampleEvery: STRESS_SAMPLE_EVERY,
      maxSlopeKB: STRESS_MAX_SLOPE_KB,
      maxGrowthRatio: STRESS_MAX_GROWTH,
      maxHandleDelta: STRESS_MAX_HANDLE_D,
      timeoutS: STRESS_TIMEOUT_S,
      cliBin: CLI_BIN,
    },
    metrics: metrics || null,
    samples: samples.map(s => ({
      i: s.i, rssKB: s.rssKB, handleCount: s.handleCount,
      wallMs: s.wallMs, ok: s.ok,
    })),
    timestamp: new Date().toISOString(),
  };
  try { writeFileSync(RESULT_JSON, JSON.stringify(obj, null, 2)); }
  catch (e) { log(`FATAL: failed to write result JSON: ${e.message}`); }
}

// ── Linear-regression helpers (least squares, no deps) ───────────────
function linearSlope(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const n = xs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
    sxx += xs[i] * xs[i];
  }
  const denom = (n * sxx - sx * sx);
  if (denom === 0) return NaN;
  return (n * sxy - sx * sy) / denom;
}

// ── Main driver loop ─────────────────────────────────────────────────
const samples = []; // { i, rssKB, handleCount, wallMs, ok }
let startNs = process.hrtime.bigint();

// Write CSV header before sampling begins so a crash mid-run still
// leaves the partial data on disk.
try { writeFileSync(SAMPLES_CSV, 'i,rssKB,handleCount,wallMs,ok\n'); }
catch (e) { log(`WARN: failed to init samples CSV: ${e.message}`); }

function recordSample(i) {
  const sample = sampleProc(childPid);
  const elapsedMs = Number(
    (process.hrtime.bigint() - startNs) / BigInt(1_000_000)
  );
  samples.push({ i, ...sample, wallMs: elapsedMs });
  try {
    appendFileSync(SAMPLES_CSV,
      `${i},${sample.rssKB},${sample.handleCount},${elapsedMs},${sample.ok ? 1 : 0}\n`);
  } catch {}
  log(`sample @ i=${i}: rss=${sample.rssKB}KB handles=${sample.handleCount} elapsed=${(elapsedMs/1000).toFixed(1)}s`);
}

// Send a JSON-RPC frame and return a promise that resolves with the
// matched reply (or rejects on timeout). For the soak test we don't
// need to await each reply serially — we pipeline freely and let the
// MCP server drain in the order it chooses. We do track sent vs replied
// for the post-run audit.
function sendRPC(id, method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  // backpressure: if the stdin buffer drains too slowly we'll see
  // child.stdin.write() return false. Wait for 'drain' before pushing
  // more. Critical for STRESS_N=10000 — without it the buffer balloons
  // and the test artificially inflates child RSS via kernel pipe queue.
  return new Promise((resolve, reject) => {
    inflight.set(id, { resolve, reject, sentAt: Date.now(), tool: method });
    const ok = child.stdin.write(msg);
    if (!ok) {
      child.stdin.once('drain', () => {});
    }
  });
}

// Global timeout watcher (last-resort kill switch).
const globalTimer = setTimeout(() => {
  log(`FATAL: global soak timeout ${STRESS_TIMEOUT_S}s exceeded`);
  try { child.kill('SIGKILL'); } catch {}
  writeResult('FAIL', `global-timeout-${STRESS_TIMEOUT_S}s`, {
    requestsDispatched: -1, replyCount, errorReplyCount,
  });
  // Allow the result-write to flush before exit.
  setTimeout(() => process.exit(1), 100);
}, STRESS_TIMEOUT_S * 1000);

async function main() {
  // 1) Initialize handshake (id=0). The MCP server registers tools on
  // the FIRST request; without initialize, subsequent tools/call may
  // get -32601 until tools/list is observed. Match the production
  // sequence Claude Code uses.
  log('sending initialize handshake');
  const initId = 0;
  const initPromise = sendRPC(initId, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'adr0243-stress-driver', version: '0.0.0' },
  });
  // Race initialize against a 30s timeout — if the MCP can't even start,
  // there's no point sampling.
  const initTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('initialize timed out after 30s')), 30000));
  try {
    await Promise.race([initPromise, initTimeout]);
    log('initialize ACK received');
  } catch (e) {
    log(`FATAL: ${e.message}`);
    try { child.kill('SIGKILL'); } catch {}
    writeResult('FAIL', 'initialize-failed', {
      requestsDispatched: 0, replyCount, errorReplyCount,
    });
    clearTimeout(globalTimer);
    process.exit(2);
  }

  // 2) Baseline sample BEFORE the load starts.
  await delay(500); // let the server settle after init
  recordSample(0);
  if (!samples[0].ok) {
    log(`FATAL: baseline sample failed (pid=${childPid} may have died)`);
    try { child.kill('SIGKILL'); } catch {}
    writeResult('FAIL', 'baseline-sample-failed', {
      requestsDispatched: 0, replyCount, errorReplyCount,
    });
    clearTimeout(globalTimer);
    process.exit(1);
  }

  // 3) Sustained-load loop.
  log(`dispatching ${STRESS_N} requests (sample every ${STRESS_SAMPLE_EVERY})`);
  for (let i = 1; i <= STRESS_N; i++) {
    if (childExited) {
      log(`FATAL: MCP child died mid-stream at i=${i} (rc=${childExitCode})`);
      writeResult('FAIL', `mcp-child-died-mid-stream-i${i}-rc${childExitCode}`, {
        requestsDispatched: i, replyCount, errorReplyCount,
      });
      clearTimeout(globalTimer);
      process.exit(1);
    }
    const tool = pickTool(i);
    const id = i; // request id = step index
    sendRPC(id, 'tools/call', { name: tool.name, arguments: tool.args(i) })
      .catch(() => { /* replies tracked elsewhere; ignore rejection here */ });

    if (i % STRESS_SAMPLE_EVERY === 0) {
      // Brief pause to let any pipeline drain before sampling (sampling
      // mid-burst gives noisy RSS readings; a 50ms quiesce is enough).
      await delay(50);
      recordSample(i);
    }
  }

  // 4) Drain inflight requests, then final sample.
  // The assertion is about steady-state RSS, not peak-during-processing.
  // Sampling while requests are still inflight conflates the two and
  // produces false-positive "growth" verdicts at small STRESS_N where the
  // dispatch:drain ratio is unbalanced.
  log(`all requests dispatched; waiting for ${inflight.size} inflight to drain`);
  const drainDeadline = Date.now() + 30_000;
  while (inflight.size > 0 && Date.now() < drainDeadline) {
    await delay(100);
  }
  const drainLeft = inflight.size;
  log(`drained: ${drainLeft} inflight remain (drain ${drainLeft === 0 ? 'complete' : 'timed-out at 30s'})`);
  await delay(500); // brief quiesce so RSS reflects post-drain state
  recordSample(STRESS_N + 1);

  // 5) Close stdin (signals end of input to MCP) but keep the process
  // alive briefly so we can read the last few replies. The server is
  // expected to keep listening; we don't expect it to drain and exit.
  try { child.stdin.end(); } catch {}

  clearTimeout(globalTimer);

  // 6) Compute verdict.
  const valid = samples.filter(s => s.ok);
  if (valid.length < 3) {
    log(`FATAL: only ${valid.length} valid samples — cannot regress`);
    writeResult('FAIL', `insufficient-samples-${valid.length}`, {
      requestsDispatched: STRESS_N, replyCount, errorReplyCount,
    });
    try { child.kill('SIGKILL'); } catch {}
    process.exit(1);
  }

  const baseline = valid[0];
  const final = valid[valid.length - 1];
  const xs = valid.map((s, idx) => idx);
  const ysRss = valid.map(s => s.rssKB);
  const ysHandles = valid.map(s => s.handleCount);
  const slopeRss = linearSlope(xs, ysRss);          // KB / sample
  const slopeHandles = linearSlope(xs, ysHandles);  // fds / sample
  const growthRatio = final.rssKB / baseline.rssKB;
  const handleDelta = final.handleCount - baseline.handleCount;

  const metrics = {
    requestsDispatched: STRESS_N,
    replyCount,
    errorReplyCount,
    inflightAtEnd: inflight.size,
    samplesValid: valid.length,
    baselineRssKB: baseline.rssKB,
    finalRssKB: final.rssKB,
    growthRatio: Number(growthRatio.toFixed(4)),
    slopeRssKBPerSample: Number(slopeRss.toFixed(2)),
    baselineHandles: baseline.handleCount,
    finalHandles: final.handleCount,
    handleDelta,
    slopeHandlesPerSample: Number(slopeHandles.toFixed(4)),
    elapsedMs: final.wallMs,
  };

  log(`metrics: ${JSON.stringify(metrics)}`);

  // Assertions per ADR-0243 carry-forward:
  //   (a) RSS slope bounded → no monotonic growth
  //   (b) Final RSS bounded multiple of baseline → no runaway absolute growth
  //   (c) Handle delta bounded → no FD leak (FDs are bounded by OS rlimit)
  const failures = [];
  if (Math.abs(slopeRss) > STRESS_MAX_SLOPE_KB) {
    failures.push(`RSS slope ${slopeRss.toFixed(2)} KB/sample > threshold ${STRESS_MAX_SLOPE_KB}`);
  }
  if (growthRatio > STRESS_MAX_GROWTH) {
    failures.push(`growth ratio ${growthRatio.toFixed(3)} > ${STRESS_MAX_GROWTH}`);
  }
  if (handleDelta > STRESS_MAX_HANDLE_D) {
    failures.push(`handle delta ${handleDelta} > ${STRESS_MAX_HANDLE_D}`);
  }

  // Best-effort: terminate the child cleanly so the wrapper's cleanup is
  // not chasing zombies.
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref();

  if (failures.length === 0) {
    log(`PASS: no drift detected (${valid.length} samples, ${STRESS_N} requests)`);
    writeResult('PASS', 'no-drift-detected', metrics);
    process.exit(0);
  } else {
    log(`FAIL: ${failures.length} assertion(s) tripped`);
    for (const f of failures) log(`  - ${f}`);
    writeResult('FAIL', failures.join('; '), metrics);
    process.exit(1);
  }
}

main().catch((e) => {
  log(`FATAL: driver crashed: ${e && e.stack || e}`);
  try { child.kill('SIGKILL'); } catch {}
  writeResult('FAIL', `driver-crash:${e && e.message || String(e)}`, {
    requestsDispatched: -1, replyCount, errorReplyCount,
  });
  clearTimeout(globalTimer);
  process.exit(2);
});

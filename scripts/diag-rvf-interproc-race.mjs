#!/usr/bin/env node
/**
 * diag-rvf-interproc-race.mjs
 *
 * Inter-process RVF concurrent-write probe (ADR-0095 Sprint-1 enhanced).
 *
 * Complements scripts/diag-rvf-inproc-race.mjs (ADR-0090 Tier B7): that probe
 * spawns N RvfBackend instances inside ONE node process and exercises the
 * in-process advisory lock. This probe spawns N SEPARATE node subprocesses
 * (like the real `t3-2-concurrent` acceptance check) and verifies they all
 * converge on `.rvf.meta.entryCount === N`.
 *
 * The in-process probe passes 10/10 on current fork source. The real
 * acceptance check observes entryCount=1 at N=6 (5 entries lost). This probe
 * isolates the inter-process failure without the overhead of the full CLI.
 *
 * Usage:
 *   node scripts/diag-rvf-interproc-race.mjs                 # defaults: N=6, 1 trial
 *   node scripts/diag-rvf-interproc-race.mjs 6               # N=6, 1 trial
 *   node scripts/diag-rvf-interproc-race.mjs 6 --trials 10   # N=6, 10 trials
 *   node scripts/diag-rvf-interproc-race.mjs --trials 40     # FULL matrix: N=2,4,6,8 x 10
 *   node scripts/diag-rvf-interproc-race.mjs 6 --trials 10 --trace
 *       emits per-writer tmp-path + PID samples + backend identity to stderr
 *       (consumed by ADR-0095 Acceptance #6 — no-shared-tmp invariant)
 *   node scripts/diag-rvf-interproc-race.mjs --help
 *
 * Meta-regression: to verify the probe WOULD detect a regression, see
 * `docs/adr/ADR-0095-rvf-inter-process-convergence.md` §Meta-Regression Probe.
 *
 * Exit codes:
 *   0 — all trials pass (entryCount === N every time across every N)
 *   1 — at least one trial lost entries (data-loss regression)
 *   2 — infra failure (CLI not installed, Verdaccio down, etc.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const CLI_VERSION = process.env.CLI_VERSION || '3.5.58-patch.136';
const REGISTRY = process.env.VERDACCIO_URL || 'http://localhost:4873';

// ---------------------------------------------------------------------------
// CLI arg parsing (exported for unit tests)
// ---------------------------------------------------------------------------
export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    N: null,                // positional integer (null means unspecified)
    trials: null,           // --trials <int> (null means unspecified)
    trace: false,           // --trace flag
    help: false,            // --help or -h
    matrix: false,          // set true when N is null and trials >= 40 (full matrix)
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (a === '--trace') { opts.trace = true; continue; }
    if (a === '--trials') {
      const v = args[++i];
      if (v === undefined) throw new Error('--trials requires an integer argument');
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new Error(`--trials must be a positive integer, got: ${v}`);
      opts.trials = n;
      continue;
    }
    if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    // positional — first positional is N
    if (opts.N === null) {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 1) throw new Error(`N must be a positive integer, got: ${a}`);
      opts.N = n;
      continue;
    }
    // second positional — legacy ITERATIONS (before --trials existed)
    if (opts.trials === null) {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 1) throw new Error(`iterations must be a positive integer, got: ${a}`);
      opts.trials = n;
      continue;
    }
    throw new Error(`unexpected positional argument: ${a}`);
  }
  // Defaults
  if (opts.trials === null) opts.trials = 1;
  // Full-matrix mode: trials >= 40 AND N unspecified  →  run N=2,4,6,8 x (trials/4) each
  if (opts.N === null && opts.trials >= 40) {
    opts.matrix = true;
  }
  if (opts.N === null) opts.N = 6; // default N when not matrix
  return opts;
}

// ---------------------------------------------------------------------------
// Trial aggregation (exported for unit tests)
// Input: [{N, trial, passed, entryCount, failures, elapsedMs, traces}]
// Output: {byN: {N -> {passed, total, losses}}, totalPassed, totalTrials, allPassed}
// ---------------------------------------------------------------------------
export function aggregateTrials(trialResults) {
  const byN = new Map();
  let totalPassed = 0;
  for (const r of trialResults) {
    if (!byN.has(r.N)) byN.set(r.N, { passed: 0, total: 0, losses: [] });
    const entry = byN.get(r.N);
    entry.total++;
    if (r.passed) {
      entry.passed++;
      totalPassed++;
    } else {
      entry.losses.push({ trial: r.trial, expected: r.N, observed: r.entryCount, failures: r.failures });
    }
  }
  const sortedKeys = [...byN.keys()].sort((a, b) => a - b);
  const out = { byN: {}, totalPassed, totalTrials: trialResults.length, allPassed: true };
  for (const k of sortedKeys) {
    const entry = byN.get(k);
    out.byN[k] = entry;
    if (entry.passed < entry.total) out.allPassed = false;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trace entry shape (exported for unit tests)
// ---------------------------------------------------------------------------
export function makeTraceEntry(pid, tmpPath, backend, key, resolvedDb) {
  return { pid, tmpPath, backend, key, resolvedDb, ts: Date.now() };
}

function log(msg) {
  process.stderr.write(`[diag-rvf-interproc] ${msg}\n`);
}

function printHelp() {
  const text = [
    'diag-rvf-interproc-race.mjs — inter-process RVF concurrent-write probe',
    '',
    'Usage:',
    '  node scripts/diag-rvf-interproc-race.mjs [N] [--trials N] [--trace]',
    '',
    'Args:',
    '  N                positional integer, default 6 (writers per trial)',
    '  --trials N       total trials; when N is unspecified and trials >= 40,',
    '                   runs full matrix N=2,4,6,8 with trials/4 each',
    '  --trace          dump per-writer PID + tmp path + backend identity to stderr',
    '  --help           this text',
    '',
    'Exit codes:',
    '  0  all trials converged (entryCount === N)',
    '  1  at least one trial lost entries',
    '  2  infra failure (CLI install / init failed)',
    '',
    'Meta-regression verification:',
    '  To confirm this probe FAILS under a regression, revert each of the three',
    '  ADR-0095 §Amended Decision items and re-run. See',
    '  docs/adr/ADR-0095-rvf-inter-process-convergence.md §Meta-Regression Probe',
    '  for the exact rollback steps and expected failure outputs.',
    '',
  ].join('\n');
  process.stdout.write(text);
}

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr, pid: proc.pid }));
  });
}

// One-time CLI install. The CLI binary is heavy (~200MB of deps + native
// binaries); reinstalling per trial would blow the 3-min wallclock budget for
// 40 trials. We install once, then each trial gets its OWN fresh trial dir
// with an isolated .swarm/ — the write target — so state cannot leak across
// trials. The CLI binary path is absolute; the trial dir is the CLI's cwd.
let _cachedHarnessDir = null;
async function setupHarness() {
  if (_cachedHarnessDir && existsSync(join(_cachedHarnessDir, 'node_modules', '.bin', 'cli'))) {
    return _cachedHarnessDir;
  }
  const dir = mkdtempSync(join(tmpdir(), 'rvf-interproc-harness-'));
  log(`harness setup: ${dir}`);
  await exec('npm', ['init', '-y'], { cwd: dir });
  const install = await exec(
    'npm',
    ['install', `@sparkleideas/cli@${CLI_VERSION}`, '--no-audit', '--silent', `--registry=${REGISTRY}`],
    { cwd: dir },
  );
  if (install.code !== 0) {
    log(`npm install FAILED (code=${install.code})`);
    log(install.stderr.slice(0, 800));
    return null;
  }
  _cachedHarnessDir = dir;
  return dir;
}

// Each trial: fresh tmpdir, `cli init --full` to populate the trial-local
// config. Writes land under ${trialDir}/.swarm/memory.rvf*. Deterministic
// isolation — no cross-trial state.
async function setupTrialDir(harnessDir, label) {
  const cliBin = join(harnessDir, 'node_modules', '.bin', 'cli');
  const trialDir = mkdtempSync(join(tmpdir(), `rvf-interproc-${label}-`));
  const init = await exec(cliBin, ['init', '--full'], { cwd: trialDir });
  if (init.code !== 0) {
    log(`cli init FAILED for ${label} (code=${init.code})`);
    log(init.stderr.slice(0, 400));
    return null;
  }
  return { trialDir, cliBin };
}

async function fireSubprocesses(trialDir, cliBin, trialLabel, n, traceEnabled) {
  const procs = [];
  const keys = [];
  const env = { ...process.env };
  // When --trace is on, we capture stderr for any tmp/backend traces the fork may emit.
  for (let i = 1; i <= n; i++) {
    const key = `probe-${trialLabel}-${i}`;
    const value = `value-${trialLabel}-${i}`;
    keys.push(key);
    procs.push(exec(cliBin, [
      'memory', 'store',
      '--key', key,
      '--value', value,
      '--namespace', `probe-${trialLabel}`,
    ], { cwd: trialDir, env }));
  }
  const results = await Promise.all(procs);
  const failures = results.filter(r => r.code !== 0);
  return { results, failures, keys };
}

function inspectMeta(dir) {
  // Real CLI path is .swarm/memory.rvf.meta
  const metaPath = join(dir, '.swarm', 'memory.rvf.meta');
  if (!existsSync(metaPath)) return { found: false, entryCount: null, raw: null };
  const buf = readFileSync(metaPath);
  if (buf.length < 8) return { found: true, entryCount: null, raw: 'too short' };
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'RVF\x00') return { found: true, entryCount: null, raw: `bad magic: ${magic}` };
  const headerLen = buf.readUInt32LE(4);
  if (8 + headerLen > buf.length) return { found: true, entryCount: null, raw: 'truncated header' };
  const headerJson = buf.subarray(8, 8 + headerLen).toString('utf-8');
  let header = null;
  try { header = JSON.parse(headerJson); } catch (e) { return { found: true, entryCount: null, raw: `bad JSON: ${e.message}` }; }
  return { found: true, entryCount: header.entryCount, header, metaPath };
}

// Collect trace data (when --trace): scan the .swarm dir for any tmp artifacts
// that were mid-flight at sampling, and record per-writer PIDs from exec results.
function collectTrace(dir, results, keys) {
  const traces = [];
  const swarmDir = join(dir, '.swarm');
  // Snapshot any leftover *.tmp.* files — evidence of the old shared-tmp bug or
  // its unique-tmp fix.
  let leftoverTmps = [];
  if (existsSync(swarmDir)) {
    try {
      leftoverTmps = readdirSync(swarmDir)
        .filter(f => f.includes('.tmp'))
        .map(f => ({ name: f, size: statSync(join(swarmDir, f)).size }));
    } catch { /* non-fatal */ }
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // Heuristic: scan stderr for any RvfBackend trace lines the fork may emit
    // when its verbose flag is enabled. Keys: 'RvfBackend', 'tryNativeInit',
    // 'nativeDb', '.tmp'.
    const stderrSignals = {
      sawTryNative: /tryNativeInit/.test(r.stderr),
      sawFallback: /pure-TS fallback|not available/.test(r.stderr),
      sawRenameErr: /ENOENT.*rename.*\.tmp/.test(r.stderr),
      sawSfvrMagic: /SFVR|bad magic/.test(r.stderr),
    };
    traces.push({
      writerIdx: i + 1,
      pid: r.pid || null,
      key: keys[i],
      exitCode: r.code,
      stderrSignals,
      // tmpPath/backend identity are not directly exposed by the published CLI
      // (would require fork-side instrumentation). We stage the shape here so
      // the fork probe can fill it in; for now, we emit what we have.
      tmpPath: null,
      backend: r.code === 0 ? 'converged' : 'failed',
    });
  }
  return { traces, leftoverTmps };
}

function emitTrace(trialLabel, N, trace) {
  // Machine-readable line per writer, prefixed with TRACE for easy grepping.
  for (const t of trace.traces) {
    const signalStr = Object.entries(t.stderrSignals)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(',') || 'none';
    process.stderr.write(
      `[TRACE trial=${trialLabel} N=${N} writer=${t.writerIdx} pid=${t.pid} ` +
      `exit=${t.exitCode} key=${t.key} backend=${t.backend} signals=${signalStr}]\n`,
    );
  }
  if (trace.leftoverTmps.length > 0) {
    for (const f of trace.leftoverTmps) {
      process.stderr.write(`[TRACE trial=${trialLabel} leftover-tmp name=${f.name} size=${f.size}]\n`);
    }
  }
}

// Run a single trial: set up per-trial dir (fresh .swarm), fire N writers,
// collect result, clean up trial dir. The harness (CLI install) is shared.
async function runTrial(harnessDir, N, trialLabel, traceEnabled) {
  const setup = await setupTrialDir(harnessDir, trialLabel);
  if (!setup) return { N, trial: trialLabel, passed: false, entryCount: null, failures: -1, elapsedMs: 0, setupFailed: true };
  const { trialDir, cliBin } = setup;
  const t0 = Date.now();
  const { results, failures, keys } = await fireSubprocesses(trialDir, cliBin, trialLabel, N, traceEnabled);
  const elapsedMs = Date.now() - t0;
  const meta = inspectMeta(trialDir);
  const passed = meta.entryCount === N;
  let trace = null;
  if (traceEnabled) {
    trace = collectTrace(trialDir, results, keys);
    emitTrace(trialLabel, N, trace);
  }
  log(`trial=${trialLabel} N=${N} entryCount=${meta.entryCount} failures=${failures.length} elapsed=${elapsedMs}ms ${passed ? 'PASS' : 'FAIL'}`);
  if (!passed && failures.length > 0) {
    for (const f of failures.slice(0, 2)) {
      log(`  subproc failure: code=${f.code} stderr=${f.stderr.slice(0, 200).replace(/\n/g, ' ')}`);
    }
  }
  // Cleanup trial dir — but only after we've captured metadata
  try { rmSync(trialDir, { recursive: true, force: true }); } catch {}
  return { N, trial: trialLabel, passed, entryCount: meta.entryCount, failures: failures.length, elapsedMs, trace };
}

// Run the full matrix (N=2,4,6,8 x perNTrials each)
async function runMatrix(harnessDir, totalTrials, traceEnabled) {
  const Ns = [2, 4, 6, 8];
  const perN = Math.floor(totalTrials / Ns.length);
  if (perN < 1) {
    log(`FATAL: --trials ${totalTrials} too small for matrix (needs >= ${Ns.length})`);
    process.exit(2);
  }
  log(`MATRIX MODE: N=${Ns.join(',')} × ${perN} trials each = ${Ns.length * perN} total`);
  const all = [];
  const t0 = Date.now();
  for (const N of Ns) {
    for (let t = 1; t <= perN; t++) {
      const label = `N${N}t${t}`;
      const r = await runTrial(harnessDir, N, label, traceEnabled);
      all.push(r);
    }
  }
  const walltime = Date.now() - t0;
  return { results: all, walltime };
}

// Run a single-N sequence (legacy + explicit N mode)
async function runSingleN(harnessDir, N, trials, traceEnabled) {
  log(`SINGLE-N MODE: N=${N} × ${trials} trials`);
  const all = [];
  const t0 = Date.now();
  for (let t = 1; t <= trials; t++) {
    const label = `t${t}`;
    const r = await runTrial(harnessDir, N, label, traceEnabled);
    all.push(r);
  }
  const walltime = Date.now() - t0;
  return { results: all, walltime };
}

function reportAndExit(agg, walltime) {
  log('');
  log(`SUMMARY: ${agg.totalPassed}/${agg.totalTrials} passed, wallclock=${(walltime / 1000).toFixed(1)}s`);
  for (const [N, entry] of Object.entries(agg.byN)) {
    const verdict = entry.passed === entry.total ? 'PASS' : 'FAIL';
    log(`  N=${N}: ${entry.passed}/${entry.total} ${verdict}`);
    if (entry.losses.length > 0) {
      for (const l of entry.losses.slice(0, 3)) {
        log(`    loss trial=${l.trial}: expected=${l.expected} observed=${l.observed} subproc-fail=${l.failures}`);
      }
    }
  }
  if (walltime > 3 * 60 * 1000) {
    log(`WARN: wallclock ${(walltime/1000).toFixed(1)}s > 180s budget`);
  }
  if (!agg.allPassed) {
    log('OVERALL: FAIL (at least one N has losses)');
    process.exit(1);
  }
  log('OVERALL: PASS');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main entrypoint (skipped in tests via import.meta.url check)
// ---------------------------------------------------------------------------
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    log(`ARG ERROR: ${e.message}`);
    process.exit(2);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  log(`cli=${CLI_VERSION} registry=${REGISTRY} trace=${opts.trace}`);
  const harnessDir = await setupHarness();
  if (!harnessDir) {
    log('harness setup failed; exiting 2');
    process.exit(2);
  }
  const run = opts.matrix
    ? await runMatrix(harnessDir, opts.trials, opts.trace)
    : await runSingleN(harnessDir, opts.N, opts.trials, opts.trace);
  const agg = aggregateTrials(run.results);
  // Cleanup harness once all trials are done
  try { rmSync(harnessDir, { recursive: true, force: true }); } catch {}
  reportAndExit(agg, run.walltime);
}

// Only run main() when invoked directly (not when imported by tests).
const isDirectInvocation = (() => {
  try {
    const thisUrl = import.meta.url;
    const argvUrl = new URL(`file://${process.argv[1]}`).href;
    return thisUrl === argvUrl;
  } catch { return false; }
})();

if (isDirectInvocation) {
  main().catch(err => {
    log(`fatal: ${err.stack || err.message}`);
    process.exit(2);
  });
}

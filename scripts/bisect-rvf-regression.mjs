#!/usr/bin/env node
/**
 * bisect-rvf-regression.mjs — ADR-0133 Phase 1 helper.
 *
 * Wraps diag-rvf-interproc-race.mjs's writer-firing logic so that the
 * @sparkleideas/memory dist can be PATCHED with a candidate rebuild before the
 * trials run. This lets us bisect rvf-backend.ts revisions without
 * republishing to Verdaccio for each iteration.
 *
 * Usage:
 *   node scripts/bisect-rvf-regression.mjs --label <SHA-short> \
 *        --patch /path/to/rebuilt/rvf-backend.js \
 *        [--cli-version 3.5.58-patch.334] \
 *        [--N 6] [--trials 10]
 *
 *   Without --patch, runs against the unmodified published CLI (baseline).
 *
 * The harness dir is at /tmp/ruflo-bisect-harness-<label>/. Across iterations
 * with the same label, the harness is reused (npm install only runs once); only
 * the patched file gets re-overwritten.
 *
 * Exit codes:
 *   0  — all trials converged (entryCount === N)
 *   1  — at least one trial lost entries
 *   2  — infra failure
 */

import { spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync,
  rmSync, readdirSync, statSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { label: null, patch: null, cliVersion: '3.5.58-patch.334', N: 6, trials: 10, registry: 'http://localhost:4873' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--label') { opts.label = args[++i]; continue; }
    if (a === '--patch') { opts.patch = args[++i]; continue; }
    if (a === '--cli-version') { opts.cliVersion = args[++i]; continue; }
    if (a === '--N') { opts.N = Number(args[++i]); continue; }
    if (a === '--trials') { opts.trials = Number(args[++i]); continue; }
    if (a === '--registry') { opts.registry = args[++i]; continue; }
    throw new Error(`Unknown arg: ${a}`);
  }
  if (!opts.label) throw new Error('--label required');
  return opts;
}

function log(msg) {
  process.stderr.write(`[bisect-rvf ${new Date().toISOString()}] ${msg}\n`);
}

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = ''; let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr, pid: proc.pid }));
  });
}

async function setupHarness(label, cliVersion, registry) {
  const dir = `/tmp/ruflo-bisect-harness-${label}`;
  const cliBin = join(dir, 'node_modules', '.bin', 'cli');
  if (existsSync(cliBin)) {
    log(`harness reused: ${dir}`);
    return dir;
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  log(`harness setup: ${dir} cli=${cliVersion}`);
  await exec('npm', ['init', '-y'], { cwd: dir });
  const install = await exec(
    'npm',
    ['install', `@sparkleideas/cli@${cliVersion}`, '--no-audit', '--silent', `--registry=${registry}`],
    { cwd: dir },
  );
  if (install.code !== 0) {
    log(`npm install FAILED (code=${install.code})`);
    log(install.stderr.slice(0, 800));
    return null;
  }
  return dir;
}

function applyPatch(harnessDir, patchPath) {
  const target = join(harnessDir, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
  if (!existsSync(target)) {
    log(`PATCH target missing: ${target}`);
    return false;
  }
  const stat0 = statSync(target);
  const patchStat = statSync(patchPath);
  copyFileSync(patchPath, target);
  log(`patched ${target} ` +
      `(was ${stat0.size}B, now ${patchStat.size}B)`);
  return true;
}

async function setupTrialDir(harnessDir, label) {
  const cliBin = join(harnessDir, 'node_modules', '.bin', 'cli');
  const trialDir = mkdtempSync(join(tmpdir(), `ruflo-bisect-${label}-`));
  const init = await exec(cliBin, ['init', '--full'], { cwd: trialDir });
  if (init.code !== 0) {
    log(`cli init FAILED for ${label} (code=${init.code})`);
    log(init.stderr.slice(0, 400));
    return null;
  }
  return { trialDir, cliBin };
}

async function fireSubprocesses(trialDir, cliBin, trialLabel, n) {
  const procs = [];
  const keys = [];
  for (let i = 1; i <= n; i++) {
    const key = `probe-${trialLabel}-${i}`;
    const value = `value-${trialLabel}-${i}`;
    keys.push(key);
    procs.push(exec(cliBin, [
      'memory', 'store',
      '--key', key,
      '--value', value,
      '--namespace', `probe-${trialLabel}`,
    ], { cwd: trialDir }));
  }
  const results = await Promise.all(procs);
  const failures = results.filter(r => r.code !== 0);
  return { results, failures, keys };
}

function inspectMeta(dir) {
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

function collectSignals(results, keys) {
  const traces = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const stderrSignals = {
      sawSfvrMagic: /SFVR|bad magic/.test(r.stderr),
      sawFsyncFailed: /FsyncFailed/.test(r.stderr),
      sawFallback: /pure-TS fallback|not available/.test(r.stderr),
      sawAlreadyExists: /AlreadyExists/.test(r.stderr),
      sawLockHeld: /LockHeld/.test(r.stderr),
    };
    traces.push({
      writerIdx: i + 1,
      pid: r.pid || null,
      key: keys[i],
      exitCode: r.code,
      stderrSignals,
    });
  }
  return traces;
}

async function runTrial(harnessDir, N, trialLabel) {
  const setup = await setupTrialDir(harnessDir, trialLabel);
  if (!setup) return { trial: trialLabel, passed: false, entryCount: null, failures: -1, traces: [] };
  const { trialDir, cliBin } = setup;
  const t0 = Date.now();
  const { results, failures, keys } = await fireSubprocesses(trialDir, cliBin, trialLabel, N);
  const elapsedMs = Date.now() - t0;
  const meta = inspectMeta(trialDir);
  const passed = meta.entryCount === N;
  const traces = collectSignals(results, keys);
  for (const t of traces) {
    const sigs = Object.entries(t.stderrSignals).filter(([, v]) => v).map(([k]) => k).join(',') || 'none';
    log(`  trial=${trialLabel} writer=${t.writerIdx} exit=${t.exitCode} signals=${sigs}`);
  }
  log(`trial=${trialLabel} N=${N} entryCount=${meta.entryCount} subproc-fail=${failures.length} elapsed=${elapsedMs}ms ${passed ? 'PASS' : 'FAIL'}`);
  if (!passed && failures.length > 0) {
    for (const f of failures.slice(0, 1)) {
      log(`  first-failure stderr: ${f.stderr.slice(0, 400).replace(/\n/g, ' | ')}`);
    }
  }
  // Cleanup on PASS to keep disk small; preserve on FAIL.
  if (passed) {
    try { rmSync(trialDir, { recursive: true, force: true }); } catch {}
  }
  return { trial: trialLabel, passed, entryCount: meta.entryCount, failures: failures.length, traces };
}

async function main() {
  let opts; try { opts = parseArgs(); } catch (e) { log(`ARG: ${e.message}`); process.exit(2); }
  log(`label=${opts.label} patch=${opts.patch || '(none, baseline)'} cli=${opts.cliVersion} N=${opts.N} trials=${opts.trials}`);

  const harnessDir = await setupHarness(opts.label, opts.cliVersion, opts.registry);
  if (!harnessDir) { log('harness setup failed'); process.exit(2); }

  if (opts.patch) {
    const ok = applyPatch(harnessDir, opts.patch);
    if (!ok) { log('patch apply failed'); process.exit(2); }
  }

  const t0 = Date.now();
  const results = [];
  for (let t = 1; t <= opts.trials; t++) {
    const r = await runTrial(harnessDir, opts.N, `t${t}`);
    results.push(r);
  }
  const walltime = Date.now() - t0;

  const passed = results.filter(r => r.passed).length;
  log('');
  log(`SUMMARY label=${opts.label}: ${passed}/${results.length} passed (${(walltime/1000).toFixed(1)}s)`);
  // Aggregate signals
  const sigCounts = {};
  for (const r of results) {
    for (const tr of r.traces) {
      for (const [sig, v] of Object.entries(tr.stderrSignals)) {
        if (v) sigCounts[sig] = (sigCounts[sig] || 0) + 1;
      }
    }
  }
  log(`signals: ${JSON.stringify(sigCounts)}`);
  // Loss breakdown
  for (const r of results.filter(x => !x.passed)) {
    log(`  loss trial=${r.trial} entryCount=${r.entryCount} subproc-fail=${r.failures}`);
  }

  if (passed === results.length) {
    log(`OVERALL label=${opts.label}: PASS`);
    process.exit(0);
  }
  log(`OVERALL label=${opts.label}: FAIL`);
  process.exit(1);
}

main().catch(err => {
  log(`fatal: ${err.stack || err.message}`);
  process.exit(2);
});

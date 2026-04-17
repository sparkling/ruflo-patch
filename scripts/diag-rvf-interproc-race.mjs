#!/usr/bin/env node
/**
 * diag-rvf-interproc-race.mjs
 *
 * Inter-process RVF concurrent-write probe (ADR-0095 Sprint-1 investigation).
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
 *   node scripts/diag-rvf-interproc-race.mjs [N=6] [iterations=1]
 *
 * Exit codes:
 *   0 — all iterations pass (entryCount matches N every time)
 *   1 — at least one iteration lost entries (data-loss regression)
 *   2 — infra failure (CLI not installed, etc.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const N = Number(process.argv[2] || 6);
const ITERATIONS = Number(process.argv[3] || 1);
const CLI_VERSION = process.env.CLI_VERSION || '3.5.58-patch.136';

function log(msg) {
  process.stderr.write(`[diag-rvf-interproc] ${msg}\n`);
}

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), 'rvf-interproc-'));
  log(`workdir=${dir}`);

  // npm init + install published CLI (copy from .npmrc so we hit Verdaccio)
  await exec('npm', ['init', '-y'], { cwd: dir });
  const install = await exec(
    'npm',
    ['install', `@sparkleideas/cli@${CLI_VERSION}`, '--no-audit', '--silent', '--registry=http://localhost:4873'],
    { cwd: dir },
  );
  if (install.code !== 0) {
    log(`npm install FAILED (code=${install.code})`);
    log(install.stderr.slice(0, 800));
    return null;
  }
  const init = await exec(`${dir}/node_modules/.bin/cli`, ['init', '--full'], { cwd: dir });
  if (init.code !== 0) {
    log(`cli init FAILED (code=${init.code})`);
    log(init.stderr.slice(0, 800));
    return null;
  }
  return dir;
}

async function fireSubprocesses(dir, iter, n) {
  const cliBin = join(dir, 'node_modules', '.bin', 'cli');
  const procs = [];
  for (let i = 1; i <= n; i++) {
    const key = `probe-iter${iter}-${i}`;
    const value = `value-${iter}-${i}`;
    procs.push(exec(cliBin, ['memory', 'store', '--key', key, '--value', value, '--namespace', `probe-iter${iter}`], { cwd: dir }));
  }
  const results = await Promise.all(procs);
  const failures = results.filter(r => r.code !== 0);
  return { results, failures };
}

function inspectMeta(dir) {
  // Real CLI path is .swarm/memory.rvf.meta (NOT .claude-flow/data/memory/.rvf.meta
  // as the ADR draft claimed). Validated empirically 2026-04-17.
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

async function run() {
  const dir = await setupProject();
  if (!dir) {
    log('setup failed; exiting 2');
    process.exit(2);
  }

  const losses = [];
  for (let iter = 1; iter <= ITERATIONS; iter++) {
    log(`iter=${iter} fire N=${N}`);
    const t0 = Date.now();
    const { results, failures } = await fireSubprocesses(dir, iter, N);
    const elapsed = Date.now() - t0;
    if (failures.length > 0) {
      log(`  ${failures.length}/${N} CLI subprocesses exited non-zero`);
      for (const f of failures.slice(0, 2)) log(`    stderr: ${f.stderr.slice(0, 300)}`);
    }
    const meta = inspectMeta(dir);
    log(`  entryCount=${meta.entryCount}, subprocess-duration=${elapsed}ms`);
    if (meta.entryCount !== N) {
      losses.push({ iter, expected: N, observed: meta.entryCount, subprocFailures: failures.length });
    }

    // Clean between iterations: reset memory dir (.swarm is where CLI writes)
    const memDir = join(dir, '.swarm');
    if (iter < ITERATIONS && existsSync(memDir)) {
      try { rmSync(memDir, { recursive: true, force: true }); } catch {}
    }
  }

  log(`\nSUMMARY: N=${N}, iterations=${ITERATIONS}, losses=${losses.length}/${ITERATIONS}`);
  if (losses.length > 0) {
    for (const l of losses) {
      log(`  iter=${l.iter}: expected=${l.expected}, observed=${l.observed}, subprocFailures=${l.subprocFailures}`);
    }
    log('FAIL: entries lost in concurrent-write scenario');
    process.exit(1);
  }
  log('PASS: all iterations converged');
  process.exit(0);
}

run().catch(err => {
  log(`fatal: ${err.stack || err.message}`);
  process.exit(2);
});

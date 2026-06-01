#!/usr/bin/env node
// ADR-0284 RVF concurrent-write durability harness (the council's Q5 K×N + C1'
// dual-count gate, formalised from /tmp/rvf-fix/step1-deconfound.sh).
//
// Runs K rounds of N concurrent `memory store` processes (warm-start — the regime
// that reproduces the t3-2 silent loss; cold-start no-load does not) and asserts,
// per round, BOTH:
//   - DURABLE count: distinct native ids committed to the manifest, read FRESH via
//     `RvfDatabase.openReadonly(path).listMetadataIds()` (manifest-authoritative,
//     no flock). This is what actually survived.
//   - VISIBLE count: `memory list --namespace` hits.
// They must each equal N. durable<N is real write-loss (the Option-A target);
// durable=N & visible<N is a read-visibility regression (a different bug). Break on
// the first shortfall and surface the first failing writer's stderr.
//
// Usage:
//   node scripts/rvf-concurrent-durability.mjs --cli "<cli invocation>" --dir <projectDir>
//        [--n 16] [--k 3] [--namespace-prefix cc]
// `--cli` is the full CLI command (e.g. "node .../bin/cli.js" or "npx @scope/cli@x").
// The RVF native binding is resolved from <projectDir>/node_modules.
//
// Exit 0 = all K rounds N/N durable AND visible. Exit 1 = shortfall (loss). Exit 2 = setup error.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname, basename } from 'node:path';

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const cliCmd = arg('--cli');
const projectDir = resolve(arg('--dir', process.cwd()));
const N = parseInt(arg('--n', '16'), 10);
const K = parseInt(arg('--k', '10'), 10);
const nsPrefix = arg('--namespace-prefix', 'cc');
// --reset-each-round: wipe the .rvf and re-seed a SINGLE entry before each
// concurrent burst. This is the RELIABLE trigger for the ADR-0284 native-id
// collision: the loss needs N writers to OPEN an existing (small) file
// simultaneously — they then all load the same state, seed `nextNativeId`
// identically, and assign colliding ids. A bloated .rvf MASKS it (slow init
// de-synchronises the writers); cold-start AVOIDS it (create-retry serialises).
// "Warm but small, reset each round" maximises the signal so the gate is
// deterministic enough to trust (stock fails ~every round; the fix is 0 loss).
const resetEachRound = process.argv.includes('--reset-each-round');

if (!cliCmd) {
  console.error('rvf-concurrent-durability: --cli <invocation> is required');
  process.exit(2);
}

// Resolve the native binding for the DIRECT durable probe (manifest listMetadataIds).
// Best-effort + robust across install layouts: walk up from projectDir AND try
// relative to a discovered @sparkleideas/memory package (the install may hoist the
// binding to a top-level dir that lacks a package.json — not require-resolvable — while
// memory carries its own resolvable copy). If it can't be loaded, we DEGRADE to
// `memory list` as the durable count (NON-FATAL): in this harness every `memory list`
// is a FRESH process whose boot() reads the committed manifest, so it already IS a
// durable read. The direct probe is the council's belt-and-suspenders deconfound — its
// absence loses the visibility-vs-real-loss split, not the loss detection itself.
function resolveBinding() {
  const bases = [];
  let d = projectDir;
  for (let i = 0; i < 8; i++) { bases.push(d); const p = dirname(d); if (p === d) break; d = p; }
  // Add @sparkleideas/memory package dirs found along the way.
  for (const b of [...bases]) {
    const mem = join(b, 'node_modules', '@sparkleideas', 'memory');
    if (existsSync(mem)) bases.push(mem);
  }
  for (const base of bases) {
    for (const pkg of ['@sparkleideas/ruvector-rvf-node', '@ruvector/rvf-node']) {
      try {
        const req = createRequire(join(base, '__probe__.js'));
        const mod = req(pkg);
        if (mod?.RvfDatabase) return mod.RvfDatabase;
      } catch { /* try next base/pkg */ }
    }
  }
  return null;
}
const RvfDatabase = resolveBinding();
const durableAvailable = !!RvfDatabase;
if (!durableAvailable) {
  console.error('[durable] native binding not resolvable from the install — DEGRADING to ' +
    'fresh-process `memory list` as the durable count (sound here: each list re-boots from the ' +
    'committed manifest). The direct listMetadataIds deconfound is skipped.');
}

// Candidate .rvf paths an `init --full` project writes to.
const rvfPaths = [
  join(projectDir, '.swarm', 'memory.rvf'),
  join(projectDir, '.claude-flow', 'memory.rvf'),
];

function durableCount() {
  let total = 0;
  for (const p of rvfPaths) {
    if (!existsSync(p)) continue;
    try { total += RvfDatabase.openReadonly(p).listMetadataIds().length; }
    catch { /* a path mid-write / absent — the other path carries the count */ }
  }
  return total;
}

function run(cmd, { capture = false } = {}) {
  return new Promise((res) => {
    const child = spawn('bash', ['-lc', cmd], {
      cwd: projectDir,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      env: { ...process.env, NPM_CONFIG_REGISTRY: process.env.REGISTRY || process.env.NPM_CONFIG_REGISTRY || 'http://localhost:4873' },
    });
    let out = '';
    if (capture) { child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d); }
    child.on('close', (code) => res({ code, out }));
  });
}

async function visibleCount(ns) {
  const { out } = await run(`${cliCmd} memory list --namespace ${ns} --limit ${N * 4}`, { capture: true });
  return (out.match(/k-\d+/g) || []).length;
}

async function storeBurst(ns) {
  const writers = [];
  for (let i = 1; i <= N; i++) {
    writers.push(run(`${cliCmd} memory store --key k-${i} --value v${i} --namespace ${ns}`, { capture: true }));
  }
  return Promise.all(writers);
}

function wipeRvf() {
  for (const p of rvfPaths) {
    const dir = dirname(p), base = basename(p);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.startsWith(base)) { try { rmSync(join(dir, f)); } catch { /* best-effort */ } }
    }
  }
}

async function seedOne() {
  await run(`${cliCmd} memory store --key seed --value seed --namespace ${nsPrefix}-seed`);
}

async function main() {
  // Warm-start seed so the first concurrent round races a pre-existing .rvf.
  if (!resetEachRound) await seedOne();

  let realLoss = 0, visGap = 0, perfect = 0;
  for (let round = 1; round <= K; round++) {
    if (resetEachRound) { wipeRvf(); await seedOne(); }
    const ns = `${nsPrefix}-${round}-${process.pid}`;
    const before = durableAvailable ? durableCount() : 0;
    const results = await storeBurst(ns);
    const vis = await visibleCount(ns);
    // Durable delta via the direct manifest probe when available; otherwise the
    // fresh-process `memory list` count IS the durable read in this harness.
    const delta = durableAvailable ? (durableCount() - before) : vis;

    let verdict;
    if (delta < N) { verdict = 'REAL-LOSS'; realLoss++; }
    else if (durableAvailable && vis < N) { verdict = 'VISIBILITY'; visGap++; }
    else { verdict = 'perfect'; perfect++; }
    const durLabel = durableAvailable ? `durableDelta=${delta}` : `durable(viaList)=${delta}`;
    console.log(`round ${round}/${K}: ${durLabel} visible=${vis} N=${N} => ${verdict}`);

    if (delta < N || (durableAvailable && vis < N)) {
      const firstErr = results.find(r => /error|lockheld|0x0[0-9a-f]|fatal|timed out/i.test(r.out));
      if (firstErr) console.error(`  first failing writer:\n${firstErr.out.split('\n').filter(l => /error|lockheld|0x0|fatal|timed/i.test(l)).slice(0, 4).join('\n')}`);
      console.error(`SHORTFALL at round ${round}: durable=${delta} visible=${vis} (need ${N}/${N}). ` +
        (delta < N ? 'REAL write-loss.' : 'Visibility regression (durable OK, list short).'));
      process.exit(1);
    }
  }
  console.log(`OK: ${perfect}/${K} rounds N=${N} durable AND visible — 0 loss (realLoss=${realLoss} visGap=${visGap})`);
  process.exit(0);
}

main().catch(e => { console.error('rvf-concurrent-durability error:', e?.message ?? e); process.exit(2); });

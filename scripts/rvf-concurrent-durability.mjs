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

// Resolve the native binding from the project install (renamed by the codemod).
let RvfDatabase;
for (const pkg of ['@sparkleideas/ruvector-rvf-node', '@ruvector/rvf-node']) {
  try {
    const req = createRequire(join(projectDir, '__probe__.js'));
    ({ RvfDatabase } = req(pkg));
    break;
  } catch { /* try next name */ }
}
if (!RvfDatabase) {
  console.error(`rvf-concurrent-durability: cannot resolve RVF native binding from ${projectDir}/node_modules`);
  process.exit(2);
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
    const before = durableCount();
    const results = await storeBurst(ns);
    const after = durableCount();
    const delta = after - before;
    const vis = await visibleCount(ns);

    let verdict;
    if (delta < N) { verdict = 'REAL-LOSS'; realLoss++; }
    else if (vis < N) { verdict = 'VISIBILITY'; visGap++; }
    else { verdict = 'perfect'; perfect++; }
    console.log(`round ${round}/${K}: durableDelta=${delta} visible=${vis} N=${N} => ${verdict}`);

    if (delta < N || vis < N) {
      const firstErr = results.find(r => /error|lockheld|0x0[0-9a-f]|fatal|timed out/i.test(r.out));
      if (firstErr) console.error(`  first failing writer:\n${firstErr.out.split('\n').filter(l => /error|lockheld|0x0|fatal|timed/i.test(l)).slice(0, 4).join('\n')}`);
      console.error(`SHORTFALL at round ${round}: durable=${delta} visible=${vis} (need ${N}/${N}). ` +
        (delta < N ? 'REAL write-loss (serialization).' : 'Visibility regression (durable OK, list short).'));
      process.exit(1);
    }
  }
  console.log(`OK: ${perfect}/${K} rounds N=${N} durable AND visible — 0 loss (realLoss=${realLoss} visGap=${visGap})`);
  process.exit(0);
}

main().catch(e => { console.error('rvf-concurrent-durability error:', e?.message ?? e); process.exit(2); });

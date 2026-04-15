#!/usr/bin/env node
// ADR-0090 Tier B7: deterministic in-process repro / regression guard for
// the RvfBackend multi-writer race.
//
// Originally written as a Devil's Advocate audit tool to rule out three
// confounds in the A4 subprocess integration test:
//
//   1. Subprocess cold-start + MiniLM model load could be a load test, not
//      a race test -> use in-process RvfBackend instances, no subprocesses.
//   2. `timeout 90 $cli` SIGTERM could kill writers mid-store -> no timeout,
//      no subprocess, just Promise.all on N in-process backends.
//   3. walCompactionThreshold defaults low; mid-store compactions might
//      obscure the init/shutdown window -> set walCompactionThreshold: 1000
//      so the only compaction happens in shutdown.
//
// Run 1 (against pre-fix rvf-backend.ts): observed 50% loss at N=2, 75%
// at N=4, 87.5% at N=8 — exactly 1/N surviving in every trial, no
// distribution, no confounds. Conclusion: the snapshot-overwrite race is
// real and deterministic.
//
// Fix landed in fork commit 03ecec5e0 (`fix: ADR-0090 B7 — RvfBackend
// multi-writer convergence + lock retry budget`):
//
//   - New mergePeerStateBeforePersist() at top of persistToDiskInner
//     re-reads disk state under the lock (set-if-absent) and replays WAL
//     so concurrent peer writes are preserved.
//   - acquireLock() uses time-budgeted exponential backoff with jitter
//     (5s total budget) instead of 5 fixed retries x 100ms.
//
// Run 2 (against post-fix dist): 0% loss at every N, zero crashes, zero
// dangling locks. N=8 also faster due to tighter backoff.
//
// This script now serves as a regression guard: any future upstream change
// that re-breaks the convergence or retry logic should make these scenarios
// fail again. Run it as:
//   node scripts/diag-rvf-inproc-race.mjs
// Results are printed to stdout; tee to a file for preservation.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';

// Prefer the pipeline-built dist (post-codemod, freshly compiled). The
// fork's in-place dist may be stale or partially rebuilt.
const PIPELINE_MEMORY_DIST =
  '/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js';
const FORK_MEMORY_DIST =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js';

async function loadRvfBackend() {
  if (existsSync(PIPELINE_MEMORY_DIST)) {
    const mem = await import(PIPELINE_MEMORY_DIST);
    if (mem && mem.RvfBackend) return mem.RvfBackend;
  }
  try {
    const mem = await import('@claude-flow/memory');
    if (mem && mem.RvfBackend) return mem.RvfBackend;
  } catch { /* fall through */ }
  if (existsSync(FORK_MEMORY_DIST)) {
    const mem = await import(FORK_MEMORY_DIST);
    if (mem && mem.RvfBackend) return mem.RvfBackend;
  }
  throw new Error('RvfBackend not importable from pipeline, package, or fork dist');
}

function makeEntry(key, value) {
  const now = Date.now();
  return {
    id: key,
    key,
    namespace: 'rvf-b7-inproc',
    content: value,
    type: 'semantic',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    ownerId: 'diag',
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
    version: 1,
  };
}

async function runWriter(RvfBackend, rvfPath, key, value, walThreshold) {
  // Each writer mimics a real CLI invocation: fresh RvfBackend instance,
  // initialize, one store, shutdown. No shared state across writers.
  const backend = new RvfBackend({
    databasePath: rvfPath,
    dimensions: 4,
    autoPersistInterval: 0,
    walCompactionThreshold: walThreshold,
  });
  try {
    await backend.initialize();
    await backend.store(makeEntry(key, value));
    await backend.shutdown();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function runTrial({ RvfBackend, N, walThreshold, trialIdx }) {
  const workDir = join(
    tmpdir(),
    `b7-inproc-${Date.now()}-${trialIdx}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workDir, { recursive: true });
  const rvfPath = join(workDir, 'race.rvf');
  const lockPath = rvfPath + '.lock';

  try {
    // Race N writers. Promise.all does NOT guarantee interleaving, but with
    // Node's event loop all initialize()/store()/shutdown() calls await on
    // real fs operations, so their microtask queues interleave at every
    // await point. This is as close to "true concurrent in-process writers"
    // as Node can offer without workers.
    const writerPromises = [];
    for (let i = 1; i <= N; i++) {
      writerPromises.push(runWriter(
        RvfBackend,
        rvfPath,
        `w-${trialIdx}-${i}`,
        `trial ${trialIdx} writer ${i}`,
        walThreshold,
      ));
    }
    const results = await Promise.all(writerPromises);

    const okCount = results.filter((r) => r.ok).length;
    const errors = results.filter((r) => !r.ok).map((r) => r.error);

    // Read back with a FRESH backend instance. This reflects what a
    // subsequent CLI invocation would see.
    const verifier = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
      walCompactionThreshold: walThreshold,
    });
    await verifier.initialize();
    let foundKeys = 0;
    for (let i = 1; i <= N; i++) {
      const entry = await verifier.get(`w-${trialIdx}-${i}`);
      if (entry) foundKeys++;
    }
    await verifier.shutdown();

    const danglingLock = existsSync(lockPath);

    return {
      trial: trialIdx,
      N,
      okCount,
      foundKeys,
      dataLoss: N - foundKeys,
      danglingLock,
      errors,
    };
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

async function runScenario({ RvfBackend, N, trials, walThreshold, label }) {
  console.log(`\n=== Scenario: ${label} ===`);
  console.log(`  N=${N}, trials=${trials}, walCompactionThreshold=${walThreshold}`);
  const results = [];
  const startedAt = performance.now();
  for (let t = 1; t <= trials; t++) {
    const r = await runTrial({ RvfBackend, N, walThreshold, trialIdx: t });
    results.push(r);
  }
  const elapsedMs = performance.now() - startedAt;

  // Summary.
  const totalWrites = N * trials;
  const totalFound = results.reduce((s, r) => s + r.foundKeys, 0);
  const totalLoss = totalWrites - totalFound;
  const lossRate = ((totalLoss / totalWrites) * 100).toFixed(1);

  const distribution = new Map();
  for (const r of results) {
    distribution.set(r.foundKeys, (distribution.get(r.foundKeys) || 0) + 1);
  }

  const crashedTrials = results.filter((r) => r.okCount < r.N).length;
  const lostTrials = results.filter((r) => r.foundKeys < r.N).length;
  const danglingTrials = results.filter((r) => r.danglingLock).length;

  console.log(`  elapsed: ${(elapsedMs / 1000).toFixed(1)}s  (${(elapsedMs / trials).toFixed(0)}ms/trial)`);
  console.log(`  total writes: ${totalWrites}, found: ${totalFound}, lost: ${totalLoss} (${lossRate}%)`);
  console.log(`  trials with crashed writers: ${crashedTrials}/${trials}`);
  console.log(`  trials with data loss: ${lostTrials}/${trials}`);
  console.log(`  trials with dangling lock: ${danglingTrials}/${trials}`);
  console.log('  foundKeys distribution:');
  const sortedKeys = Array.from(distribution.keys()).sort((a, b) => a - b);
  for (const k of sortedKeys) {
    console.log(`    ${k}/${N}: ${distribution.get(k)} trials`);
  }

  const firstErrors = new Set();
  for (const r of results) {
    for (const e of r.errors || []) {
      if (firstErrors.size < 3) firstErrors.add(e);
    }
  }
  if (firstErrors.size > 0) {
    console.log('  sample errors (first 3 unique):');
    for (const e of firstErrors) console.log(`    - ${e}`);
  }

  return {
    label, N, trials, walThreshold,
    totalWrites, totalFound, totalLoss, lossRate,
    crashedTrials, lostTrials, danglingTrials,
    distribution: Object.fromEntries(sortedKeys.map((k) => [k, distribution.get(k)])),
  };
}

async function main() {
  const RvfBackend = await loadRvfBackend();
  console.log('ADR-0090 Tier B7 in-process RVF race investigation');
  console.log('='.repeat(60));
  console.log('Node:', process.version, 'Platform:', process.platform, process.arch);

  const scenarios = [
    { label: 'N=2, wal=1000 (shutdown-only compaction)', N: 2, trials: 20, walThreshold: 1000 },
    { label: 'N=4, wal=1000 (shutdown-only compaction)', N: 4, trials: 20, walThreshold: 1000 },
    { label: 'N=8, wal=1000 (shutdown-only compaction)', N: 8, trials: 20, walThreshold: 1000 },
    { label: 'N=4, wal=10 (mid-store compaction)',       N: 4, trials: 20, walThreshold: 10 },
  ];

  const summaries = [];
  for (const scenario of scenarios) {
    summaries.push(await runScenario({ RvfBackend, ...scenario }));
  }

  console.log('\n' + '='.repeat(60));
  console.log('OVERALL VERDICT');
  console.log('='.repeat(60));
  for (const s of summaries) {
    const verdict = s.totalLoss > 0 ? 'LOSS' : 'CLEAN';
    console.log(`  [${verdict}] ${s.label}: ${s.totalFound}/${s.totalWrites} (${s.lossRate}% loss)`);
  }

  const anyLoss = summaries.some((s) => s.totalLoss > 0);
  const anyCrash = summaries.some((s) => s.crashedTrials > 0);
  if (!anyLoss && !anyCrash) {
    console.log('\nCONCLUSION: regression guard PASSES. Zero data loss and zero crashed');
    console.log('writers across all scenarios. ADR-0090 Tier B7 fix is intact in the');
    console.log('RvfBackend build under test. (Expected on post-fix dist, commit 03ecec5e0+.)');
    process.exit(0);
  }
  console.log('\nCONCLUSION: regression guard FAILED.');
  if (anyLoss) {
    console.log('  - Data loss observed. The snapshot-overwrite race is back: someone changed');
    console.log('    persistToDiskInner or removed the mergePeerStateBeforePersist call.');
  }
  if (anyCrash) {
    console.log('  - Writers crashed with lock-acquisition failures. The retry budget may have');
    console.log('    been reduced, or a new lock-holder bug is starving writers.');
  }
  console.log('  See ADR-0090 Tier B7 and fork commit 03ecec5e0 for the fix that should hold.');
  process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

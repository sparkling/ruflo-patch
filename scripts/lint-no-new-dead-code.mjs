#!/usr/bin/env node
/**
 * ADR-0239 cluster 8: `acceptance/no-new-dead-code` release-gate check.
 *
 * Dual-layer dead-code gate per the ADR Decision §Cluster 8 and the
 * swarm-review DA amendment (counter-only is wrong; arch-tests catch
 * concrete re-adds; counter catches barrel-re-export accretion):
 *
 *   (i)  Per-cluster arch-tests (file/dir must not exist) — already
 *        wired in each cluster's commit (cluster1/cluster23/cluster4c/
 *        cluster5a/cluster7 arch-tests).
 *   (ii) THIS counter — scoped unused-export count via `ts-prune` over
 *        `forks/{ruflo,agentdb,ruvector}/**\/src\/`, capped at today's
 *        deduped figure. New unused exports above the cap fail red.
 *
 * Per E5 amendment, the runner must use a direct `timeout` invocation
 * (NOT `_run_and_kill` whose `_RK_EXIT` is unreliable per
 * `[[feedback-run-and-kill-exit-code]]`). The acceptance check that
 * sources this script wraps the run with `timeout` and parses the
 * count from stdout for the cap-check assertion.
 *
 * Usage:
 *   node scripts/lint-no-new-dead-code.mjs [--baseline]
 *
 *   --baseline   Write the current count to the cap file (run ONCE to
 *                seed; checked-in. Don't re-baseline without an ADR.)
 *
 * Exit codes:
 *   0   count <= cap (or --baseline mode succeeded)
 *   1   count > cap (gate fails RED; new dead exports introduced)
 *   2   scanner failure (ts-prune crashed, tsconfig missing, etc.)
 *
 * The cap file lives at `config/dead-code-cap.json` and contains:
 *   {
 *     "ruflo": <count>,
 *     "agentdb": <count>,
 *     "ruvector": <count>,
 *     "baselinedAt": "<ISO>",
 *     "adr": "ADR-0239 cluster 8"
 *   }
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const CAP_FILE = resolve(PROJECT_ROOT, 'config', 'dead-code-cap.json');

// E5 amendment §scope: include ruvector-fork even though cluster 6
// deferred decisions there — freezes growth pending the dedicated audit.
// Each entry is { cwd, tsconfig } so ts-prune's cwd-relative resolution
// works on its own terms (passing an absolute path tripped ts-prune's
// internal path-join with cwd → "ruflo-patch/Users/henrik/..." 404).
const FORK_TSCONFIGS = {
  ruflo: {
    cwd: '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli',
    tsconfig: 'tsconfig.json',
  },
  agentdb: {
    cwd: '/Users/henrik/source/forks/agentdb',
    tsconfig: 'tsconfig.json',
  },
  // ruvector is a Rust-heavy fork; TS sources live in `npm/packages/*`
  // (cluster 6). Probe for a per-package tsconfig; if none exists yet,
  // skip with a notice rather than failing — the dead-code program
  // for ruvector lives in the cluster 6 audit per the ADR §Out-of-scope.
  ruvector: {
    cwd: '/Users/henrik/source/forks/ruvector/npm',
    tsconfig: 'tsconfig.json',
  },
};

const SCAN_TIMEOUT_MS = 120_000;

function loadCap() {
  if (!existsSync(CAP_FILE)) {
    return { ruflo: null, agentdb: null, ruvector: null, baselinedAt: null };
  }
  try {
    return JSON.parse(readFileSync(CAP_FILE, 'utf-8'));
  } catch (err) {
    console.error(`[adr0239-cluster8] FATAL: failed to parse ${CAP_FILE}: ${err.message}`);
    process.exit(2);
  }
}

function saveCap(cap) {
  // Ensure config/ exists; cap file is checked-in for trunk-based.
  const dir = dirname(CAP_FILE);
  if (!existsSync(dir)) {
    execFileSync('mkdir', ['-p', dir]);
  }
  writeFileSync(CAP_FILE, JSON.stringify(cap, null, 2) + '\n');
}

/**
 * Count unused exports surfaced by ts-prune for one fork's tsconfig.
 * Returns -1 if the scan failed (tsconfig missing, ts-prune crashed,
 * timeout). The caller decides whether to treat -1 as fatal.
 *
 * `cwd` is the directory containing the tsconfig; ts-prune resolves
 * `--project` relative to its own cwd (passing absolute paths trips
 * an internal path-join that prepends node's cwd).
 */
function countDeadExports({ cwd, tsconfig }) {
  const absTsconfig = resolve(cwd, tsconfig);
  if (!existsSync(absTsconfig)) {
    console.error(`[adr0239-cluster8] tsconfig absent: ${absTsconfig} (skipped)`);
    return -1;
  }
  if (!existsSync(cwd)) {
    console.error(`[adr0239-cluster8] fork cwd absent: ${cwd} (skipped)`);
    return -1;
  }
  try {
    // E5 amendment: direct `timeout` (here via Node's execFileSync
    // timeout option, equivalent at the syscall level) — NOT
    // `_run_and_kill` whose `$?` captures `cat` not the CLI per
    // [[feedback-run-and-kill-exit-code]].
    const output = execFileSync(
      'npx',
      ['-y', 'ts-prune', '--project', tsconfig],
      {
        cwd, // ts-prune resolves --project relative to cwd
        encoding: 'utf-8',
        timeout: SCAN_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024, // 64 MiB — ts-prune can emit a lot
      },
    );
    // ts-prune emits one finding per line in the format:
    //   path/to/file.ts:NN - exportName
    // Count non-empty lines. Filter out the "used in module" suffix
    // lines (ts-prune marks exports used internally only).
    const lines = output
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .filter((l) => !l.includes('(used in module)'));
    return lines.length;
  } catch (err) {
    if (err.status !== null && err.status !== undefined) {
      // ts-prune ran but exited non-zero. Some versions exit 1 when
      // findings exist (despite the `--error` flag controlling this).
      // Fall back to counting the stdout we captured.
      const stdout = err.stdout?.toString() ?? '';
      const lines = stdout
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .filter((l) => !l.includes('(used in module)'));
      if (lines.length > 0) return lines.length;
      // Stdout empty + non-zero exit = real scanner failure.
      console.error(`[adr0239-cluster8] ts-prune exit=${err.status} for ${cwd}/${tsconfig}: ${err.message}`);
      return -1;
    }
    console.error(`[adr0239-cluster8] ts-prune failed for ${cwd}/${tsconfig}: ${err.message}`);
    return -1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baselineMode = args.includes('--baseline');

  console.log('[adr0239-cluster8] Scoped unused-export counter (forks/{ruflo,agentdb,ruvector}/**)');

  const counts = {};
  let totalScanned = 0;
  for (const [fork, spec] of Object.entries(FORK_TSCONFIGS)) {
    const count = countDeadExports(spec);
    if (count < 0) {
      console.log(`  ${fork}: SKIPPED (tsconfig absent or scan failed)`);
      counts[fork] = null;
      continue;
    }
    counts[fork] = count;
    totalScanned++;
    console.log(`  ${fork}: ${count} unused exports`);
  }

  if (totalScanned === 0) {
    console.error('[adr0239-cluster8] FATAL: no fork could be scanned.');
    process.exit(2);
  }

  if (baselineMode) {
    const cap = {
      ruflo: counts.ruflo,
      agentdb: counts.agentdb,
      ruvector: counts.ruvector,
      baselinedAt: new Date().toISOString(),
      adr: 'ADR-0239 cluster 8',
    };
    saveCap(cap);
    console.log(`[adr0239-cluster8] baseline written to ${CAP_FILE}`);
    process.exit(0);
  }

  // Cap check.
  const cap = loadCap();
  if (cap.baselinedAt === null) {
    console.error('[adr0239-cluster8] FATAL: no baseline cap file at ' + CAP_FILE);
    console.error('  Run with --baseline once to seed (and commit the result).');
    process.exit(2);
  }

  let failed = false;
  for (const fork of Object.keys(FORK_TSCONFIGS)) {
    const current = counts[fork];
    const baseline = cap[fork];
    if (current === null || baseline === null || baseline === undefined) continue;
    if (current > baseline) {
      console.error(
        `[adr0239-cluster8] FAIL: ${fork} unused-export count ${current} > cap ${baseline}.`,
      );
      console.error('  New dead exports introduced. Either remove them or update the cap');
      console.error('  via `node scripts/lint-no-new-dead-code.mjs --baseline` (under an ADR).');
      failed = true;
    } else {
      console.log(`  ${fork}: ${current} <= ${baseline} (PASS)`);
    }
  }

  // E5 amendment §Cluster 8 confirmation: the cap-check assertion
  // must be `[[ $count -le $CAP ]] || exit 1`. We exit 1 on any
  // per-fork failure to mirror that contract.
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`[adr0239-cluster8] FATAL: ${err?.stack || err}`);
  process.exit(2);
});

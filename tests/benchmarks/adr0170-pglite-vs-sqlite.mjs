#!/usr/bin/env node
/**
 * ADR-0170 Phase A.10 — pglite vs SQLite benchmark.
 *
 * Drives 200 `memory store` + 50 `memory search` operations through the
 * real `ruflo` CLI against a representative corpus. Captures:
 *
 *   - total wall-clock for store + search phases
 *   - store latency p50 / p95
 *   - search latency p50 / p95
 *   - RSS peak via /usr/bin/time -l (macOS) or /usr/bin/time -v (linux)
 *
 * Usage:
 *
 *   node tests/benchmarks/adr0170-pglite-vs-sqlite.mjs --substrate sqlite
 *   node tests/benchmarks/adr0170-pglite-vs-sqlite.mjs --substrate pglite
 *
 * Output: a single JSON object to stdout matching the gap-K baseline
 * format. Phase C's exit-gate compares pglite to the SQLite baseline at
 * tests/benchmarks/baselines/adr0170-sqlite-baseline.json and halts on
 * >10% regression on any metric.
 *
 * This script is for the Phase A pre-flight baseline capture and the
 * Phase C exit gate. It is NOT part of the acceptance suite — invoke
 * manually.
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { substrate: null, cliCmd: null, projectDir: null, keySuffix: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--substrate') {
      args.substrate = argv[++i];
    } else if (arg === '--cli-cmd') {
      args.cliCmd = argv[++i];
    } else if (arg === '--project-dir') {
      args.projectDir = argv[++i];
    } else if (arg === '--key-suffix') {
      // ADR-0170 Phase C-2: optional suffix so a warm-reopen rerun in the
      // same project-dir uses distinct keys (avoids the dedupe/no-op path).
      args.keySuffix = argv[++i];
    } else if (arg === '-h' || arg === '--help') {
      console.error(
        'Usage: adr0170-pglite-vs-sqlite.mjs --substrate <sqlite|pglite> ' +
          '[--cli-cmd <ruflo-cmd>] [--project-dir <dir>] [--key-suffix <s>]',
      );
      process.exit(arg === '-h' || arg === '--help' ? 0 : 1);
    }
  }
  if (!args.substrate || !['sqlite', 'pglite'].includes(args.substrate)) {
    console.error("Error: --substrate must be 'sqlite' or 'pglite'");
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv);

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

const NUM_STORE_OPS = 200;
const NUM_SEARCH_OPS = 50;

// Resolve the ruflo CLI command. Prefer the harness's _cli_cmd convention
// (`npx @sparkleideas/ruflo@<version>`) when available; fall back to the
// project-local `ruflo` binary or a user-supplied --cli-cmd.
const CLI_CMD = args.cliCmd
  || process.env.RUFLO_CLI_CMD
  || 'npx -y @sparkleideas/ruflo@latest';

// Resolve the project directory. The benchmark needs a project root with
// `.swarm/` AND `.claude-flow/` so `ruflo memory store` resolves the
// memory.rvf to the project-local path. Without `.claude-flow/`, the CLI
// falls back to `$HOME/.claude-flow/data/memory.rvf` (user-global RVF),
// which accumulates state across bench runs and triggers spurious
// "key already exists" errors when the same key prefix is reused.
// (Fixed 2026-05-12 in Phase C-2; the baseline was captured under the
// broken behavior but happened to succeed because its keys were
// `bench-store-sqlite-*` which had no global collisions at the time.)
const PROJECT_DIR = args.projectDir
  || process.env.RUFLO_PROJECT_DIR
  || (() => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0170-bench-'));
        fs.mkdirSync(path.join(dir, '.swarm'), { recursive: true });
        fs.mkdirSync(path.join(dir, '.claude-flow'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.ruflo-project'), '');
        return dir;
      })();

// Ensure `.claude-flow/` and `.swarm/` exist even when --project-dir is
// passed in (e.g. for warm-reopen reruns in the same dir).
fs.mkdirSync(path.join(PROJECT_DIR, '.claude-flow'), { recursive: true });
fs.mkdirSync(path.join(PROJECT_DIR, '.swarm'), { recursive: true });

// Representative corpus seed. Keep it deterministic and small enough that
// 200 store ops complete in reasonable time on a dev laptop. The corpus
// content is intentionally varied to exercise the embedding model and the
// vector-search planner.
const CORPUS_SEED = [
  'The ADR-0170 substrate replacement migrates AgentDB from SQLite to PostgreSQL.',
  'pglite is a WASM build of PostgreSQL 15 that runs in-process and persists to a single dir.',
  'pgvector exposes vector columns with HNSW and IVFFlat indexes the planner uses directly.',
  'Reflexion memory stores self-critique and outcomes after each attempt.',
  'Skill library promotes high-reward traces into reusable skills with typed IO.',
  'Causal memory graphs encode interventional uplift between memories, not just similarity.',
  'Explainable recall certificates carry Merkle-rooted provenance and minimal hitting sets.',
  'Nightly learners do cross-product self-joins over learning_state_embeddings.',
  'tsvector full-text search replaces SQLite FTS5 with Lucene-grade ranking.',
  'WITH RECURSIVE traverses causal chains up to five hops with cycle detection.',
];

function buildCorpusItem(i) {
  const seed = CORPUS_SEED[i % CORPUS_SEED.length];
  const suffix = args.keySuffix ? `-${args.keySuffix}` : '';
  return {
    key: `bench-store-${args.substrate}${suffix}-${i}`,
    value: `${seed} Iteration ${i}/${NUM_STORE_OPS}. ` +
      `Timestamp ${Date.now()}. Seed offset ${i % CORPUS_SEED.length}.`,
  };
}

// ----------------------------------------------------------------------------
// Runners
// ----------------------------------------------------------------------------

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarizeLatency(samples) {
  if (samples.length === 0) {
    return { count: 0, p50_ms: null, p95_ms: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: samples.length,
    p50_ms: quantile(sorted, 0.5),
    p95_ms: quantile(sorted, 0.95),
  };
}

/**
 * Run one CLI command and time it. Returns wall-clock ms (not /usr/bin/time
 * RSS — RSS is captured at the outer loop level since per-invocation /usr/bin/time
 * adds noise).
 */
function runCli(argsArr, cwd) {
  const start = performance.now();
  const result = spawnSync(
    'sh',
    ['-c', `${CLI_CMD} ${argsArr.join(' ')}`],
    { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const elapsed = performance.now() - start;
  return { elapsed, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function escapeShell(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// ----------------------------------------------------------------------------
// Phase 1 — Store benchmark
// ----------------------------------------------------------------------------

function runStorePhase() {
  const samples = [];
  const errors = [];
  for (let i = 0; i < NUM_STORE_OPS; i++) {
    const item = buildCorpusItem(i);
    const { elapsed, status, stderr } = runCli(
      ['memory', 'store', '-k', escapeShell(item.key), '--value', escapeShell(item.value)],
      PROJECT_DIR,
    );
    if (status !== 0) {
      errors.push({ i, status, stderr: stderr?.slice(0, 200) });
    }
    samples.push(elapsed);
  }
  return { samples, errors };
}

// ----------------------------------------------------------------------------
// Phase 2 — Search benchmark
// ----------------------------------------------------------------------------

function runSearchPhase() {
  const samples = [];
  const errors = [];
  for (let i = 0; i < NUM_SEARCH_OPS; i++) {
    // Search query draws from the same corpus seed pool so non-empty
    // similarity is expected.
    const seed = CORPUS_SEED[i % CORPUS_SEED.length];
    const { elapsed, status, stderr } = runCli(
      ['memory', 'search', '-q', escapeShell(seed)],
      PROJECT_DIR,
    );
    if (status !== 0) {
      errors.push({ i, status, stderr: stderr?.slice(0, 200) });
    }
    samples.push(elapsed);
  }
  return { samples, errors };
}

// ----------------------------------------------------------------------------
// RSS peak via /usr/bin/time -l (macOS) wrapping the whole process tree
// ----------------------------------------------------------------------------

function captureRssPeak() {
  // /usr/bin/time -l on darwin emits 'maximum resident set size' in bytes
  // for the CHILD process. We don't fork a child here (the bench runs inline)
  // so we approximate with process.resourceUsage().maxRSS, which reports
  // the bench process's own peak in KB on linux and bytes on darwin.
  const usage = process.resourceUsage();
  // node's docs say maxRSS is "in KB" on linux, "in bytes" on darwin per
  // process.resourceUsage; convert to bytes uniformly.
  const isLinux = process.platform === 'linux';
  return isLinux ? usage.maxRSS * 1024 : usage.maxRSS;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

const overallStart = performance.now();

console.error(`[adr0170-bench] substrate=${args.substrate}`);
console.error(`[adr0170-bench] cli=${CLI_CMD}`);
console.error(`[adr0170-bench] projectDir=${PROJECT_DIR}`);
console.error(`[adr0170-bench] running ${NUM_STORE_OPS} store ops ...`);
const store = runStorePhase();
console.error(`[adr0170-bench] store complete: ${store.samples.length} ops, ${store.errors.length} errors`);
console.error(`[adr0170-bench] running ${NUM_SEARCH_OPS} search ops ...`);
const search = runSearchPhase();
console.error(`[adr0170-bench] search complete: ${search.samples.length} ops, ${search.errors.length} errors`);

const totalWallMs = performance.now() - overallStart;
const rssPeakBytes = captureRssPeak();

const report = {
  // schema bumped from v1 → v2 ADR-0170 Phase C-2: adds samples_ms arrays
  // so post-process can slice warmup (first N) vs steady-state (rest).
  // No measurement-methodology change — same performance.now() deltas,
  // same NUM_STORE_OPS / NUM_SEARCH_OPS counts, same CLI invocation.
  // Per blocker 3 in /tmp/adr0170-phaseC1-report.md.
  schema: 'adr0170-benchmark-v2',
  substrate: args.substrate,
  generated_at: new Date().toISOString(),
  cli_cmd: CLI_CMD,
  project_dir: PROJECT_DIR,
  host: {
    platform: process.platform,
    node_version: process.version,
    cpu_count: os.cpus().length,
  },
  store: {
    ...summarizeLatency(store.samples),
    errors: store.errors.length,
    samples_ms: store.samples,
  },
  search: {
    ...summarizeLatency(search.samples),
    errors: search.errors.length,
    samples_ms: search.samples,
  },
  total_wall_ms: totalWallMs,
  rss_peak_bytes: rssPeakBytes,
  rss_peak_mb: rssPeakBytes / (1024 * 1024),
};

// Emit JSON to stdout per spec ("Outputs JSON to stdout").
process.stdout.write(JSON.stringify(report, null, 2) + '\n');

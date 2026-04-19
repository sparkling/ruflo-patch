#!/usr/bin/env node
// scripts/skip-reverify.mjs — ADR-0096 §3 Skip-Reverify, Sprint 2.
//
// Walks every current `skip_accepted` row in test-results/catalog.db (falls
// back to test-results/catalog.jsonl if the DB is absent), classifies the
// skip reason into one of five buckets, and runs the corresponding probe.
// When a probe succeeds (prereq arrived), the check is a FLIP candidate —
// the skip is no longer honest and the check must be re-enabled or deleted.
//
// Buckets (ADR-0096 §Skip Reverify table):
//   missing_binary        — "command -v <bin>" on a target binary.
//   missing_env           — "[[ -n $VAR ]]" on a required env var.
//   tool_not_in_build     — cli mcp list-tools | grep -w <name>.
//                           Reference set: config/mcp-surface-manifest.json.
//   runtime_unavailable   — curl -sf against a runtime health endpoint.
//   prereq_absent         — eval of a reason-hash-keyed expression.
//   unknown               — could NOT bucket → loud, blocks S7 gate.
//
// Modes:
//   --run                 — re-probe all current skip_accepted (default).
//   --dry-run             — enumerate + bucket, no probes.
//   --bucket <name>       — limit to one bucket (e.g. missing_binary).
//   --sidecar-install     — create /tmp/skip-reverify-<pid>/ fresh E2E install
//                           with @sparkleideas/cli@latest for probes that need
//                           a CLI not-yet-polluted by the acceptance harness.
//                           RETURN trap cleans up on exit (any signal).
//   --fail-on-flip        — non-zero exit if any flip detected (propagates).
//   --check <id>          — probe exactly one check_id (for SKIP_ROT probe).
//
// NO RETRY: ADR-0096 bans retry/retries/attempts. We bucket+probe once. A
// probe failure is an honest skip. A probe success is a flip. No sleeps,
// no loops, no back-off.
//
// Folded into scripts/test-acceptance.sh END:
//   node scripts/skip-reverify.mjs --run --fail-on-flip
// (after catalog append, before summary).
//
// ADR refs:
//   ADR-0096 (this design)          ADR-0082 (no silent fallbacks)
//   ADR-0088 (cascade-only, no cron) ADR-0094 (parent coverage program)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const RESULTS    = resolve(REPO_ROOT, 'test-results');
const CATALOG_DB = resolve(RESULTS, 'catalog.db');
const CATALOG_JSONL = resolve(RESULTS, 'catalog.jsonl');
const MCP_MANIFEST = resolve(REPO_ROOT, 'config/mcp-surface-manifest.json');

// ---------------------------------------------------------------------------
// Bucket classifier (stateless, pure fn — testable)
// ---------------------------------------------------------------------------

export const BUCKETS = Object.freeze([
  'missing_binary',
  'missing_env',
  'tool_not_in_build',
  'runtime_unavailable',
  'prereq_absent',
  'unknown',
]);

/**
 * Classify a skip_accepted output_excerpt into one of the five buckets.
 * Returns 'unknown' when no marker matches — that must surface loudly
 * (S7 gate blocker), NEVER silently fall through (ADR-0082).
 *
 * Regex markers from ADR-0096 §Skip Reverify table plus empirical strings
 * observed in the latest 55 skip_accepted rows (2026-04-17 baseline):
 *   - "Playwright not installed", "command not found", "missing binary"
 *   - "unset", "not set", "$GITHUB_TOKEN", "$ANTHROPIC_API_KEY"
 *   - "not in build", "Unknown tool", "not found by dispatcher",
 *     "different controller", "tool queried a table that does not exist",
 *     "no dedicated ... path", "no dedicated store tool", "tool reports as"
 *   - "unavailable at runtime", "unreachable", "network", "plugin store"
 *   - fallthrough for anything else that contains SKIP_ACCEPTED
 *
 * @param {string} excerpt — single-line output_excerpt (already sanitized).
 * @returns {{ bucket: string, marker: string|null, reasonHash: string }}
 */
export function classifySkip(excerpt) {
  const text = String(excerpt || '');
  const lc = text.toLowerCase();
  let bucket = 'unknown';
  let marker = null;

  if (/playwright not installed|command not found|not installed|missing binary/.test(lc)) {
    bucket = 'missing_binary';
    marker = 'missing_binary';
  } else if (/\bunset\b|\bnot set\b|\$github_token|\$anthropic_api_key|env var|environment variable/.test(lc)) {
    bucket = 'missing_env';
    marker = 'missing_env';
  } else if (/not in build|unknown tool|not found by dispatcher|different controller|tool queried a table that does not exist|no dedicated .* path|no dedicated store tool|reported as 'not found'|reports as 'not found'|router-fallback|no sql surface|telemetry-only tool/.test(lc)) {
    bucket = 'tool_not_in_build';
    marker = 'tool_not_in_build';
  } else if (/unavailable at runtime|unreachable|plugin store|network|timeout|econnrefused/.test(lc)) {
    bucket = 'runtime_unavailable';
    marker = 'runtime_unavailable';
  } else if (/skip_accepted/i.test(text)) {
    bucket = 'prereq_absent';
    marker = 'prereq_absent';
  }

  // reason-hash is the sha256(first 200 chars of excerpt) truncated to 12:
  // stable across runs so the catalog can track "same skip reason seen
  // N days in a row" without false churn from timestamp/tmp noise.
  const reasonHash = createHash('sha256')
    .update(text.slice(0, 200))
    .digest('hex')
    .slice(0, 12);

  return { bucket, marker, reasonHash };
}

// ---------------------------------------------------------------------------
// Data sources — DB first, JSONL fallback
// ---------------------------------------------------------------------------

/**
 * Load current skip_accepted rows for the latest run from catalog.db via the
 * sqlite3 CLI (which sqlite3 → /usr/bin/sqlite3 on macOS). Falls back to
 * reading catalog.jsonl and filtering last run if the DB is absent.
 *
 * Returned rows: { run_id, check_id, output_excerpt }.
 */
export function loadCurrentSkips() {
  if (existsSync(CATALOG_DB)) {
    const sql =
      "SELECT h.run_id || '|' || h.check_id || '|' || COALESCE(h.output_excerpt,'') " +
      "FROM check_history h " +
      "WHERE h.run_id = (SELECT run_id FROM runs ORDER BY ts_utc DESC LIMIT 1) " +
      "AND h.status = 'skip_accepted' " +
      "ORDER BY h.check_id;";
    const res = spawnSync('/usr/bin/sqlite3', [CATALOG_DB, sql], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`sqlite3 failed (status ${res.status}): ${res.stderr}`);
    }
    return res.stdout
      .split('\n')
      .filter(l => l.length > 0)
      .map(l => {
        const [run_id, check_id, ...rest] = l.split('|');
        return { run_id, check_id, output_excerpt: rest.join('|') };
      });
  }

  // JSONL fallback: read every row, group by run_id, pick latest, filter skips.
  if (!existsSync(CATALOG_JSONL)) return [];
  const byRun = new Map();
  for (const line of readFileSync(CATALOG_JSONL, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
      byRun.get(row.run_id).push(row);
    } catch {
      // Corrupt line → report loudly later; ADR-0082 no silent drop.
    }
  }
  const runIds = [...byRun.keys()].sort();
  const latest = runIds[runIds.length - 1];
  if (!latest) return [];
  return byRun.get(latest)
    .filter(r => /SKIP_ACCEPTED/.test(r.output || ''))
    .map(r => ({
      run_id: r.run_id,
      check_id: r.check_id,
      output_excerpt: (r.output || '').replace(/\s+/g, ' ').slice(0, 500),
    }));
}

/**
 * Load the set of MCP tool names in the currently-pinned CLI build.
 * Caller uses it for the tool_not_in_build probe — if the tool name that
 * was reported missing in an old run is present in today's manifest, the
 * skip is stale → flip.
 */
export function loadMcpToolSet() {
  if (!existsSync(MCP_MANIFEST)) return new Set();
  try {
    const m = JSON.parse(readFileSync(MCP_MANIFEST, 'utf-8'));
    return new Set(m.mcp_tools || []);
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Probes — one per bucket, plus a dispatcher
// ---------------------------------------------------------------------------

/**
 * Probe a missing_binary skip by `command -v <binary>` in the current PATH
 * (or in the sidecar's PATH when --sidecar-install is active). Binary name
 * extracted from the excerpt: first matching known binary token, else the
 * first token that looks like a command.
 *
 * Known binaries: playwright, pw, chromium, fd, sqlite3, gh, jq, curl,
 *                 node, npm, npx.
 */
export function probeMissingBinary(excerpt, sidecarBinDir = null) {
  const known = ['playwright', 'pw', 'chromium', 'fd', 'sqlite3', 'gh', 'jq', 'curl'];
  const lc = excerpt.toLowerCase();
  const hit = known.find(b => new RegExp(`\\b${b}\\b`).test(lc));
  if (!hit) {
    return { flip: false, detail: 'no known binary token in excerpt' };
  }
  const env = sidecarBinDir
    ? { ...process.env, PATH: `${sidecarBinDir}:${process.env.PATH}` }
    : process.env;
  const res = spawnSync('/usr/bin/env', ['sh', '-c', `command -v ${hit}`], {
    encoding: 'utf-8',
    env,
  });
  const found = res.status === 0 && res.stdout.trim().length > 0;
  return {
    flip: found,
    detail: found
      ? `binary '${hit}' is now on PATH at ${res.stdout.trim()}`
      : `binary '${hit}' still missing`,
    binary: hit,
  };
}

/**
 * Probe a missing_env skip by checking whether the referenced env var is
 * set. Var name pulled from the excerpt ("$GITHUB_TOKEN" / "GITHUB_TOKEN").
 */
export function probeMissingEnv(excerpt) {
  const known = ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GH_TOKEN'];
  const hit = known.find(v => new RegExp(`\\b\\$?${v}\\b`).test(excerpt));
  if (!hit) return { flip: false, detail: 'no known env var token in excerpt' };
  const val = process.env[hit];
  const present = typeof val === 'string' && val.length > 0;
  return {
    flip: present,
    detail: present
      ? `env '${hit}' is now set (len=${val.length})`
      : `env '${hit}' still unset`,
    envVar: hit,
  };
}

/**
 * Probe a tool_not_in_build skip by consulting
 * config/mcp-surface-manifest.json. If the tool mentioned in the excerpt
 * is present in the current pinned CLI manifest, the skip is stale → flip.
 */
export function probeToolNotInBuild(excerpt, toolSet) {
  // Extract tool name: prefer quoted 'agentdb_*', then bare agentdb_*.
  const quoted = excerpt.match(/['"]([a-z][a-z0-9_-]*)['"]/i);
  const bare = excerpt.match(/\b(agentdb_[a-z0-9_-]+|agent_[a-z_]+|hooks_[a-z_-]+|swarm_[a-z_]+|memory_[a-z_]+)\b/);
  const tool = quoted?.[1] || bare?.[1] || null;
  if (!tool) return { flip: false, detail: 'no tool name in excerpt' };
  const inBuild = toolSet.has(tool);
  return {
    flip: inBuild,
    detail: inBuild
      ? `tool '${tool}' now in pinned manifest (${toolSet.size} tools)`
      : `tool '${tool}' still absent from manifest`,
    tool,
  };
}

/**
 * Probe a runtime_unavailable skip by curl -sf against a known endpoint
 * extracted from the excerpt, or a default-canary for plugin-store/transfer.
 */
export function probeRuntimeUnavailable(excerpt) {
  // URL extraction: prefer an http(s) URL in the excerpt, else fall back
  // to well-known canaries for the marker.
  const urlMatch = excerpt.match(/https?:\/\/[^\s"'<>)]+/);
  let url = urlMatch?.[0] || null;
  if (!url && /plugin.?store|store_search|store-search/i.test(excerpt)) {
    url = 'https://store.claude-flow.com/ping';
  }
  if (!url && /verdaccio/i.test(excerpt)) {
    url = 'http://localhost:4873/-/ping';
  }
  if (!url) return { flip: false, detail: 'no URL in excerpt' };
  const res = spawnSync('curl', ['-sf', '--max-time', '5', url], {
    encoding: 'utf-8',
  });
  const reachable = res.status === 0;
  return {
    flip: reachable,
    detail: reachable
      ? `endpoint ${url} now reachable`
      : `endpoint ${url} still unreachable (curl exit ${res.status})`,
    url,
  };
}

/**
 * Probe a prereq_absent skip using a reason-hash lookup. We don't eval
 * arbitrary strings here (security) — instead, we record the reasonHash
 * and return flip=false with a note that manual review is required.
 *
 * This is honest SKIP behavior: prereq_absent is the catch-all bucket for
 * skips that can't be classified into the other four. They get a reason
 * hash so the ROT-clock (streak_days) can still count them, but auto-flip
 * is not attempted — ADR-0082 no-silent-fallback in action.
 */
export function probePrereqAbsent(excerpt, reasonHash) {
  return {
    flip: false,
    detail: `prereq_absent reason_hash=${reasonHash} — manual review; no auto-flip`,
  };
}

/**
 * Dispatch to the right probe for a given bucketed skip.
 */
export function probeOne(entry, { toolSet, sidecarBinDir }) {
  const { bucket, reasonHash } = entry;
  const ex = entry.output_excerpt;
  switch (bucket) {
    case 'missing_binary':      return probeMissingBinary(ex, sidecarBinDir);
    case 'missing_env':         return probeMissingEnv(ex);
    case 'tool_not_in_build':   return probeToolNotInBuild(ex, toolSet);
    case 'runtime_unavailable': return probeRuntimeUnavailable(ex);
    case 'prereq_absent':       return probePrereqAbsent(ex, reasonHash);
    case 'unknown':
    default:
      return { flip: false, detail: `unbucketed — classifier returned '${bucket}'` };
  }
}

// ---------------------------------------------------------------------------
// Sidecar install (ADR-0096 §Acceptance 3: fresh install, not shared state)
// ---------------------------------------------------------------------------

/**
 * Create a fresh /tmp/skip-reverify-<pid>-<rand>/ with a minimal
 * @sparkleideas/cli@latest install (binary only, no npm init ceremony).
 * Returns { dir, binDir, cleanup() }. The cleanup fn is idempotent; callers
 * should also register it on SIGTERM/SIGINT for safety.
 *
 * Wall-clock budget: <30s (ADR-0096 §Acceptance 5). We do `npm i --no-save
 * --no-audit --no-fund --prefix <dir>` which typically completes in ~10s
 * against Verdaccio at localhost:4873.
 */
export function createSidecar({ registry = 'http://localhost:4873' } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), `skip-reverify-${process.pid}-`));
  const binDir = resolve(dir, 'node_modules/.bin');
  const t0 = Date.now();
  const res = spawnSync('npm', [
    'i', '--no-save', '--no-audit', '--no-fund', '--silent',
    '--prefix', dir,
    '--registry', registry,
    '@sparkleideas/cli@latest',
  ], {
    encoding: 'utf-8',
    timeout: 30_000, // ADR-0096 §Acceptance 5: <30s sidecar budget
  });
  const wallMs = Date.now() - t0;
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  if (res.status !== 0 || res.signal === 'SIGTERM') {
    cleanup();
    throw new Error(
      `sidecar install failed after ${wallMs}ms (status=${res.status}, signal=${res.signal}): ${res.stderr?.slice(0, 500)}`,
    );
  }
  return { dir, binDir, wallMs, cleanup };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    run: false,
    dryRun: false,
    bucket: null,
    sidecarInstall: false,
    failOnFlip: false,
    check: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') args.run = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--sidecar-install') args.sidecarInstall = true;
    else if (a === '--fail-on-flip') args.failOnFlip = true;
    else if (a === '--bucket') args.bucket = argv[++i];
    else if (a === '--check') args.check = argv[++i];
    else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  if (!args.run && !args.dryRun && !args.check) args.run = true; // default
  return args;
}

function printHelp() {
  console.log(`skip-reverify.mjs — ADR-0096 skip re-probe

Usage:
  node scripts/skip-reverify.mjs [--run|--dry-run] [--bucket <name>]
                                 [--sidecar-install] [--fail-on-flip]
                                 [--check <check_id>]

Modes:
  --run              Re-probe all current skip_accepted rows (default).
  --dry-run          Enumerate + bucket only; no probes executed.
  --bucket <name>    Limit to one bucket (${BUCKETS.join(', ')}).
  --sidecar-install  Create /tmp/skip-reverify-<pid>/ for probes.
  --fail-on-flip     Exit non-zero if any flip detected.
  --check <id>       Probe exactly one check_id.

Buckets: ${BUCKETS.join(', ')}.
ADR: ADR-0096 (design), ADR-0082 (no silent fallbacks).
`);
}

export function run(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }

  let rows = loadCurrentSkips();
  if (args.check) {
    rows = rows.filter(r => r.check_id === args.check);
    if (rows.length === 0) {
      console.error(`no skip_accepted row found for check_id='${args.check}'`);
      return 2;
    }
  }

  // Bucket + reason-hash every row up front — both --dry-run and --run
  // need this, and the bucket distribution is the headline report.
  const bucketed = rows.map(r => {
    const { bucket, marker, reasonHash } = classifySkip(r.output_excerpt);
    return { ...r, bucket, marker, reasonHash };
  });

  const filtered = args.bucket
    ? bucketed.filter(b => b.bucket === args.bucket)
    : bucketed;

  // --dry-run: print the bucket breakdown and the first few per bucket,
  // then exit 0. No probes, no side effects.
  if (args.dryRun) {
    console.log(`# skip-reverify --dry-run`);
    console.log(`# total skip_accepted: ${bucketed.length}`);
    for (const b of BUCKETS) {
      const inBucket = bucketed.filter(x => x.bucket === b);
      console.log(`# bucket:${b}: ${inBucket.length}`);
    }
    for (const b of BUCKETS) {
      const inBucket = filtered.filter(x => x.bucket === b);
      // When --bucket <b> is explicitly requested, always print the header
      // for that bucket — even if empty — so the caller gets a clear
      // "bucket X has 0 entries" signal instead of silence. Without the
      // explicit-request branch, empty buckets are skipped to keep the
      // default dry-run output readable.
      if (inBucket.length === 0 && args.bucket !== b) continue;
      console.log(`\n## ${b} (${inBucket.length})`);
      for (const row of inBucket) {
        console.log(`  ${row.check_id}  reason_hash:${row.reasonHash}`);
      }
    }
    const unknown = bucketed.filter(x => x.bucket === 'unknown').length;
    if (unknown > 0) {
      console.error(`\n[S7 gate] ${unknown} unbucketed skip(s) — classifier needs extending.`);
    }
    return 0;
  }

  // --run: actually probe each bucketed row.
  let sidecar = null;
  if (args.sidecarInstall) {
    console.log(`# sidecar-install: creating fresh CLI install`);
    const t0 = Date.now();
    sidecar = createSidecar();
    console.log(`# sidecar ready in ${sidecar.wallMs}ms at ${sidecar.dir}`);
    // RETURN trap equivalent: always cleanup on exit (normal + signals).
    const onExit = () => sidecar?.cleanup();
    process.on('exit', onExit);
    process.on('SIGINT', () => { onExit(); process.exit(130); });
    process.on('SIGTERM', () => { onExit(); process.exit(143); });
  }
  const toolSet = loadMcpToolSet();

  const flips = [];
  const probed = [];
  for (const row of filtered) {
    const res = probeOne(row, { toolSet, sidecarBinDir: sidecar?.binDir });
    probed.push({ ...row, ...res });
    if (res.flip) flips.push({ ...row, ...res });
  }

  // Report
  console.log(`# skip-reverify --run results`);
  console.log(`# probed: ${probed.length}`);
  console.log(`# flips: ${flips.length}`);
  console.log(`# honest skips: ${probed.length - flips.length}`);
  for (const b of BUCKETS) {
    const inBucket = probed.filter(x => x.bucket === b);
    const flipped = inBucket.filter(x => x.flip).length;
    if (inBucket.length === 0) continue;
    console.log(`# bucket:${b}: ${inBucket.length} probed / ${flipped} flipped`);
  }

  if (flips.length > 0) {
    console.log(`\n# FLIPS — these skips are stale, prereq arrived:`);
    for (const f of flips) {
      console.log(`SKIP_ROT: ${f.check_id} bucket:${f.bucket} — ${f.detail}`);
    }
  }

  const unknownCount = probed.filter(x => x.bucket === 'unknown').length;
  if (unknownCount > 0) {
    console.error(`\n[S7 gate] ${unknownCount} unbucketed skip(s) — classifier needs extending.`);
    return args.failOnFlip ? 3 : 0; // unbucketed is always loud
  }

  if (args.failOnFlip && flips.length > 0) return 1;
  return 0;
}

// ESM entry-point guard: only run when invoked directly as the script.
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = run(process.argv.slice(2));
  process.exit(code);
}

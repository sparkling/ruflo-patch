#!/usr/bin/env node
// scripts/diag-manifest-interproc.mjs — ADR-0094 Sprint-0 out-of-scope probe
// (Agent-6, ADR-0087 addendum).
//
// **Opposite-assumption probe for `scripts/regen-mcp-manifest.mjs`.**
//
// The manifest-populator's architectural assumption: `$(_cli_cmd) mcp tools`
// output shape is stable across adjacent CLI patch versions, so the parser
// regex `/^\s{2}(\w[\w-]+)\s{2,}.*(Enabled|Disabled)\s*$/` extracts the same
// tool set from 3.5.58-patch.N and 3.5.58-patch.N-1.
//
// The opposite assumption this probe tests: the output shape is NOT stable
// (spaces become tabs, `Disabled` row layout changes, Lipsum preamble widens,
// banner captures a row header, etc.). Under that assumption, one or both
// of the two adjacent versions silently drops tools — the manifest "verify"
// gate stays green because it only checks the current version against
// itself.
//
// This probe installs both versions in isolated npx caches, runs the
// parser against each independently, and fails if:
//   (a) tool_count(to) drops >10% below tool_count(from)  [silent drop]
//   (b) tool_count(from) is 0 OR tool_count(to) is 0      [parser broken]
//   (c) the set-difference symbol tools reveal an entire *category*
//       removed/added (e.g. all `aidefence_*` tools disappear).
//
// Usage:
//   node scripts/diag-manifest-interproc.mjs                       # defaults
//   node scripts/diag-manifest-interproc.mjs --from 3.5.58-patch.135 --to 3.5.58-patch.136
//   node scripts/diag-manifest-interproc.mjs --tolerance 10        # percent
//   node scripts/diag-manifest-interproc.mjs --opposite-assumption # verbose
//
// Exit codes:
//   0   — delta within tolerance; no categorical drop
//   1   — silent tool drop beyond tolerance (PROBE FIRES)
//   2   — parser broken (0 tools parsed on either side)
//   3   — categorical drop (>50% of a known prefix gone)
//   4   — install/execution failure (probe could not run)

import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return def;
}
const FROM_V = flag('--from', '3.5.58-patch.135');
const TO_V = flag('--to', '3.5.58-patch.136');
const TOLERANCE_PCT = Number(flag('--tolerance', '10'));
const VERBOSE = argv.includes('--opposite-assumption') || argv.includes('-v');
const PKG = '@sparkleideas/cli';
const REGISTRY = 'http://localhost:4873';

function log(...a) { console.log('[diag-manifest-interproc]', ...a); }
function vlog(...a) { if (VERBOSE) console.log('  ·', ...a); }

// ─── install helpers ───────────────────────────────────────────────────────
function installCli(version) {
  const dir = mkdtempSync(join(tmpdir(), `probe-manifest-${version.replace(/[^a-z0-9.-]/gi, '_')}-`));
  log(`installing ${PKG}@${version} → ${dir}`);
  try {
    execSync(
      `npm install --prefix "${dir}" --registry="${REGISTRY}" --no-audit --no-fund --silent ${PKG}@${version}`,
      { stdio: VERBOSE ? 'inherit' : 'pipe', timeout: 120_000 }
    );
  } catch (e) {
    log(`INSTALL FAIL for ${version}:`, e.message?.slice(0, 200));
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    process.exit(4);
  }
  const bin = join(dir, 'node_modules', '.bin', 'cli');
  if (!existsSync(bin)) {
    log(`INSTALL INCOMPLETE: ${bin} missing for ${version}`);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    process.exit(4);
  }
  return { dir, bin };
}

// ─── parser (mirrors Sprint-0 plan spec exactly) ───────────────────────────
// Regex from 01-sprint0:9 — this probe MUST use the same pattern so it
// exercises the real manifest-populator parser, not a different one.
const TOOL_ROW = /^\s{2}(\w[\w-]+)\s{2,}.*(Enabled|Disabled)\s*$/;

function enumerateTools(bin, version) {
  vlog(`running ${bin} mcp tools (${version})`);
  const r = spawnSync(bin, ['mcp', 'tools'], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
    timeout: 60_000,
  });
  if (r.status !== 0 && !r.stdout) {
    log(`RUN FAIL ${version}: status=${r.status} stderr=${(r.stderr || '').slice(0, 200)}`);
    return null;
  }
  const raw = r.stdout || '';
  const tools = new Set();
  for (const line of raw.split('\n')) {
    const m = TOOL_ROW.exec(line);
    if (m) tools.add(m[1]);
  }
  vlog(`  ${version}: parsed ${tools.size} tools`);
  return { tools, rawLines: raw.split('\n').length };
}

// Categories used to detect categorical drop (sorted by typical prefix size).
const CATEGORIES = [
  'agentdb_', 'aidefence_', 'autopilot_', 'browser_', 'claims_', 'config_',
  'coordination_', 'daa_', 'embeddings_', 'github_', 'guidance_', 'hive-mind_',
  'hooks_', 'memory_', 'neural_', 'performance_', 'progress_', 'ruvllm_',
  'session_', 'swarm_', 'task_', 'terminal_', 'transfer_', 'wasm_', 'workflow_',
];

function categoryBuckets(set) {
  const b = Object.create(null);
  for (const t of set) {
    for (const cat of CATEGORIES) {
      if (t.startsWith(cat)) { b[cat] = (b[cat] || 0) + 1; break; }
    }
  }
  return b;
}

// ─── JSON-format parser (what regen-mcp-manifest.mjs actually uses) ───────
function enumerateToolsJson(bin, version) {
  vlog(`running ${bin} --format json mcp tools (${version})`);
  const r = spawnSync(bin, ['--format', 'json', 'mcp', 'tools'], {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
    timeout: 60_000,
  });
  if (r.status !== 0 && !r.stdout) {
    log(`JSON RUN FAIL ${version}: status=${r.status} stderr=${(r.stderr || '').slice(0, 200)}`);
    return null;
  }
  const lines = (r.stdout || '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^\s+/, '');
    if (!l) continue;
    if (/^\[(AgentDB|INFO|WARN|ERROR|DEBUG)\]/.test(l)) continue;
    if (l[0] === '[' || l[0] === '{') { start = i; break; }
    break;
  }
  if (start < 0) { vlog(`  no JSON payload in ${version}`); return null; }
  try {
    const arr = JSON.parse(lines.slice(start).join('\n'));
    const tools = new Set(arr.map(e => e.name));
    vlog(`  JSON parse: ${tools.size} tools`);
    return tools;
  } catch (e) {
    vlog(`  JSON parse failed: ${e.message.slice(0, 120)}`);
    return null;
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
const fromInstall = installCli(FROM_V);
const toInstall = installCli(TO_V);

try {
  const fromRes = enumerateTools(fromInstall.bin, FROM_V);
  const toRes = enumerateTools(toInstall.bin, TO_V);

  // Cross-check the plan-spec table-parser against the --format json output
  // on the `to` version. A silent drop here is the **parser-silently-loses-tools**
  // failure mode the adversarial reviewer is seeded to find (Sprint-0 risks).
  const jsonTools = enumerateToolsJson(toInstall.bin, TO_V);
  if (jsonTools && toRes && jsonTools.size > toRes.tools.size) {
    const missed = [...jsonTools].filter(n => !toRes.tools.has(n)).sort();
    const missedPct = (100 * missed.length) / jsonTools.size;
    log(`TABLE-vs-JSON DIVERGENCE on ${TO_V}: table=${toRes.tools.size} json=${jsonTools.size}`);
    log(`  plan-spec table-parser misses ${missed.length} tools (${missedPct.toFixed(1)}%):`);
    for (const m of missed.slice(0, 20)) log(`    - ${m}`);
    if (missed.length > 20) log(`    … +${missed.length - 20} more`);
    log('  The table parser specified at 01-sprint0:9 silently drops these.');
    log('  If any code path ever falls back to table parsing, the manifest loses them.');
    // Cross-parser divergence tolerance is stricter (3%) than cross-version
    // drop tolerance (10%): same version, same CLI, different parser — any
    // divergence means one parser has a blind spot. Adversarial-reviewer
    // failing probe: this fires on @3.5.58-patch.136 today.
    const XPROBE_TOL = 3;
    if (missedPct > XPROBE_TOL) {
      log(`FAIL: table-vs-json divergence ${missedPct.toFixed(1)}% > strict tolerance ${XPROBE_TOL}%`);
      log('  Plan-spec table parser at 01-sprint0:9 loses 12 tools vs the JSON-format parser.');
      log('  ACTION: either (a) fix plan spec to use --format json (regen-mcp-manifest.mjs already does this),');
      log('          (b) delete the parseMcpToolsTable fallback in regen-mcp-manifest.mjs so it cannot be re-enabled accidentally,');
      log('          (c) update the table parser to handle the 12 missing tools.');
      process.exit(1);
    }
  } else if (jsonTools && toRes) {
    log(`table/JSON parity OK on ${TO_V}: ${toRes.tools.size} tools (both)`);
  }

  if (!fromRes || !toRes) {
    log('FAIL: could not enumerate tools on one or both versions');
    process.exit(4);
  }

  const fromN = fromRes.tools.size;
  const toN = toRes.tools.size;
  log(`tool count: ${FROM_V}=${fromN}  ${TO_V}=${toN}`);

  if (fromN === 0 || toN === 0) {
    log(`FAIL (parser): one side parsed 0 tools — parser is broken against that output shape`);
    log(`  ${FROM_V}: ${fromN} tools  (raw lines: ${fromRes.rawLines})`);
    log(`  ${TO_V}:   ${toN} tools  (raw lines: ${toRes.rawLines})`);
    log('  HINT: `mcp tools` output format likely changed. Inspect raw output manually.');
    process.exit(2);
  }

  // delta analysis
  const removed = [...fromRes.tools].filter(t => !toRes.tools.has(t)).sort();
  const added = [...toRes.tools].filter(t => !fromRes.tools.has(t)).sort();
  const dropPct = fromN === 0 ? 0 : (100 * removed.length) / fromN;
  const addPct = fromN === 0 ? 0 : (100 * added.length) / fromN;

  if (removed.length) {
    log(`REMOVED in ${TO_V} (${removed.length}): ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ` … +${removed.length - 10}` : ''}`);
  }
  if (added.length) {
    log(`ADDED in ${TO_V} (${added.length}): ${added.slice(0, 10).join(', ')}${added.length > 10 ? ` … +${added.length - 10}` : ''}`);
  }
  log(`drop: ${dropPct.toFixed(1)}% (tolerance ${TOLERANCE_PCT}%)  add: ${addPct.toFixed(1)}%`);

  // categorical drop detection
  const bFrom = categoryBuckets(fromRes.tools);
  const bTo = categoryBuckets(toRes.tools);
  const categoricalDrops = [];
  for (const cat of CATEGORIES) {
    const f = bFrom[cat] || 0;
    const t = bTo[cat] || 0;
    if (f >= 3 && (t / f) < 0.5) categoricalDrops.push({ cat, from: f, to: t });
  }
  if (categoricalDrops.length) {
    log('CATEGORICAL DROP detected:');
    for (const c of categoricalDrops) log(`  ${c.cat}* : ${c.from} → ${c.to}`);
    log('  → entire tool category shrank by >50%. Likely parser mis-tokenizing a whole group.');
    process.exit(3);
  }

  if (dropPct > TOLERANCE_PCT) {
    log(`FAIL: ${dropPct.toFixed(1)}% drop exceeds tolerance ${TOLERANCE_PCT}%`);
    log('  Manifest-populator\'s parser silently dropped tools between adjacent versions.');
    log('  ACTION: re-examine `cli mcp tools` raw output for both versions; check whether');
    log('          the regex `/^\\s{2}(\\w[\\w-]+)\\s{2,}.*(Enabled|Disabled)\\s*$/` covers the rows that were dropped.');
    process.exit(1);
  }

  log(`OK: delta within tolerance (drop ${dropPct.toFixed(1)}% ≤ ${TOLERANCE_PCT}%; add ${addPct.toFixed(1)}%).`);
  process.exit(0);
} finally {
  try { rmSync(fromInstall.dir, { recursive: true, force: true }); } catch {}
  try { rmSync(toInstall.dir, { recursive: true, force: true }); } catch {}
}

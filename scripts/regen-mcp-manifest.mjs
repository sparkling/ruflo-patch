#!/usr/bin/env node
// scripts/regen-mcp-manifest.mjs
//
// Regenerate config/mcp-surface-manifest.json from the pinned Verdaccio
// tarball's actual surface list. Used by ADR-0094's two-number coverage
// metric and by preflight's rot-detection.
//
// Modes:
//   --write  — probe the pinned CLI, regenerate the manifest on disk.
//   --print  — probe the pinned CLI, print the regenerated manifest to stdout
//              without writing (used by tests / diff previews).
//   --show   — print summary of the CURRENT manifest on disk (no CLI probe).
//   --verify — (planned, ADR-0094 rot-detection) diff live CLI surface vs
//              on-disk manifest and exit non-zero on divergence. Not yet
//              wired into preflight; this mode currently only checks
//              structural invariants.
//
// Shape notes (Sprint 0 observed on @sparkleideas/cli@3.5.58-patch.136):
//   - `cli mcp tools` emits a TABLE whose first column truncates tool names
//     at 17 chars (trailing "..."), losing ~58% of the real names. The plan
//     spec's regex `/^\s{2}(\w[\w-]+)\s{2,}.*(Enabled|Disabled)/` would return
//     those truncated stubs, so we avoid the table path entirely.
//   - `cli --format json mcp tools` emits a clean JSON array of
//     `{ name, category, description, enabled }` with FULL names. The `[AgentDB]
//     Telemetry disabled` preamble still leaks onto stdout, so we strip
//     everything before the first `[` / `{`.
//   - `cli --help` lists 2-space-indented subcommand names under section
//     headers: PRIMARY / ADVANCED / UTILITY / ANALYSIS / MANAGEMENT COMMANDS.
//
// ADR: ADR-0094 §Coverage Metric, ADR-0096 §Layer 3, Sprint 0 plan WI-1.

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST_PATH = resolve(REPO_ROOT, 'config', 'mcp-surface-manifest.json');
const MIN_TOOLS = 150;
const MAX_TOOLS = 300;
const MIN_SUBCOMMANDS = 25;
const HELP_SECTION_HEADERS = [
  'PRIMARY COMMANDS:',
  'ADVANCED COMMANDS:',
  'UTILITY COMMANDS:',
  'ANALYSIS COMMANDS:',
  'MANAGEMENT COMMANDS:',
];
// Lines inside a section that are NOT subcommand rows.
const HELP_SECTION_TERMINATOR = /^[A-Z][A-Z ]+:?\s*$/; // e.g. "GLOBAL OPTIONS:"

// --------------------------------------------------------------- pure parsers
// (Exported for tests. All take raw strings, return plain JS.)

/**
 * Parse stdout from `cli --format json mcp tools`.
 * Strips any preamble lines before the first `[` or `{` and returns the array.
 * Throws if JSON is malformed.
 */
export function parseMcpToolsJson(stdout) {
  if (typeof stdout !== 'string') {
    throw new Error('parseMcpToolsJson: stdout must be a string');
  }
  // Preamble: `[AgentDB] ...` and `[INFO] ...` lines land on stdout before the
  // JSON payload. Their leading `[` would false-positive a naive search. Scan
  // line-by-line for the real payload start: a line whose FIRST non-whitespace
  // char is `[` or `{` AND that line is not a tag like `[AgentDB]`/`[INFO]`.
  const lines = stdout.split(/\r?\n/);
  let payloadStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ltrim = line.replace(/^\s+/, '');
    if (ltrim === '') continue;
    if (/^\[(AgentDB|INFO|WARN|ERROR|DEBUG)\]/.test(ltrim)) continue;
    const first = ltrim[0];
    if (first === '[' || first === '{') { payloadStart = i; break; }
    // A non-JSON, non-tag line means the CLI didn't emit JSON — bail.
    break;
  }
  if (payloadStart < 0) {
    throw new Error(`parseMcpToolsJson: no JSON payload in stdout (${lines.length} lines scanned)`);
  }
  const payload = lines.slice(payloadStart).join('\n');
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (e) {
    throw new Error(`parseMcpToolsJson: JSON.parse failed: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`parseMcpToolsJson: expected array, got ${typeof parsed}`);
  }
  const names = [];
  for (const entry of parsed) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error(`parseMcpToolsJson: entry missing/empty name: ${JSON.stringify(entry)}`);
    }
    names.push(entry.name.trim());
  }
  return [...new Set(names)].sort();
}

/**
 * Parse stdout from `cli --help`.
 * Extracts 2-space-indented names under PRIMARY/ADVANCED/UTILITY/ANALYSIS/MANAGEMENT
 * COMMANDS headers. Stops each section on the next ALL-CAPS heading or blank line.
 */
export function parseCliHelp(stdout) {
  if (typeof stdout !== 'string') {
    throw new Error('parseCliHelp: stdout must be a string');
  }
  const names = [];
  const lines = stdout.split(/\r?\n/);
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HELP_SECTION_HEADERS.includes(line.trim())) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    // Terminator: blank line OR a new ALL-CAPS heading that isn't ours.
    if (line.trim() === '') { inSection = false; continue; }
    if (HELP_SECTION_TERMINATOR.test(line) && !HELP_SECTION_HEADERS.includes(line.trim())) {
      inSection = false;
      continue;
    }
    // Subcommand rows: 2-space indent, name, whitespace, description.
    // Name allows letters, digits, dashes, underscores.
    const m = line.match(/^\s{2}([a-z][a-z0-9_-]+)\s{2,}\S/i);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)].sort();
}

/**
 * Fallback: parse the table output of `cli mcp tools` when `--format json`
 * is unavailable. Tool names truncate at 17 chars + "..." in current builds;
 * this fallback is DOCUMENTATION ONLY — the active code path uses JSON.
 * Kept here so future regressions have a reference regex matching the plan spec.
 */
export function parseMcpToolsTable(stdout) {
  const names = [];
  for (const line of stdout.split(/\r?\n/)) {
    // Plan-spec regex from docs/plans/adr0094-hive-20260417/01-sprint0-prerequisites.md
    const m = line.match(/^\s{2}([a-z][a-z0-9_-]+)\s{2,}.*(Enabled|Disabled)\s*$/i);
    if (m && m[1] !== 'Tool') names.push(m[1]);
  }
  return [...new Set(names)].sort();
}

/**
 * Enforce the sanity guard on a tools array. Throws with a clear message on
 * under/overshoot. Exported for tests so they don't need to shell out.
 */
export function assertToolCountSane(tools, { min = MIN_TOOLS, max = MAX_TOOLS } = {}) {
  if (!Array.isArray(tools)) {
    throw new Error(`assertToolCountSane: expected array, got ${typeof tools}`);
  }
  if (tools.length < min) {
    throw new Error(`regen-mcp-manifest: sanity guard — only ${tools.length} tools parsed (<${min}); CLI output shape likely regressed`);
  }
  if (tools.length > max) {
    throw new Error(`regen-mcp-manifest: sanity guard — ${tools.length} tools parsed (>${max}); parser probably consumed non-tool rows`);
  }
  return true;
}

// ----------------------------------------------------------- CLI interaction

function probePinnedCli({ version, tmpdir: probeTmpdir, registry }) {
  // Install the pinned CLI into a throwaway tmpdir and invoke it for both
  // JSON tool enumeration and --help. One-shot regen, so the per-publish
  // cost of `npm install` is acceptable. See "Use _cli_cmd, never raw npx"
  // memory — that rule is specifically for the parallel acceptance loop,
  // not one-shot tooling.
  mkdirSync(probeTmpdir, { recursive: true });
  const spec = `@sparkleideas/cli@${version}`;
  const pkgJson = resolve(probeTmpdir, 'package.json');
  if (!existsSync(pkgJson)) writeFileSync(pkgJson, '{"name":"regen-probe","private":true}\n');
  const installArgs = ['install', spec, '--no-audit', '--no-fund', '--silent'];
  if (registry) installArgs.push('--registry', registry);
  const install = spawnSync('npm', installArgs, {
    cwd: probeTmpdir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']
  });
  if (install.status !== 0) {
    throw new Error(`regen-mcp-manifest: npm install ${spec} failed\n${install.stderr || install.stdout}`);
  }
  const cliBin = resolve(probeTmpdir, 'node_modules', '.bin', 'cli');
  if (!existsSync(cliBin)) {
    throw new Error(`regen-mcp-manifest: expected cli binary at ${cliBin} after install`);
  }
  const toolsRes = spawnSync(cliBin, ['--format', 'json', 'mcp', 'tools'], {
    cwd: probeTmpdir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']
  });
  if (toolsRes.status !== 0) {
    throw new Error(`regen-mcp-manifest: \`cli --format json mcp tools\` failed (status ${toolsRes.status})\n${toolsRes.stderr}`);
  }
  const helpRes = spawnSync(cliBin, ['--help'], {
    cwd: probeTmpdir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']
  });
  if (helpRes.status !== 0) {
    throw new Error(`regen-mcp-manifest: \`cli --help\` failed (status ${helpRes.status})\n${helpRes.stderr}`);
  }
  return { toolsStdout: toolsRes.stdout, helpStdout: helpRes.stdout };
}

function resolvePinnedVersion({ explicitVersion }) {
  if (explicitVersion) return explicitVersion;
  // Prefer what the current manifest says (keeps regen reproducible inside a
  // publish cycle); fall back to `npm view` if the manifest is empty.
  if (existsSync(MANIFEST_PATH)) {
    try {
      const cur = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      if (cur && typeof cur._pinned_cli_version === 'string' && cur._pinned_cli_version.trim()) {
        return cur._pinned_cli_version.trim();
      }
    } catch { /* fall through to npm view */ }
  }
  const registry = process.env.NPM_REGISTRY || 'http://localhost:4873';
  const res = spawnSync('npm', ['view', '@sparkleideas/cli@latest', 'version', '--registry', registry], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe']
  });
  if (res.status !== 0 || !res.stdout.trim()) {
    throw new Error(`regen-mcp-manifest: \`npm view @sparkleideas/cli@latest version\` failed: ${res.stderr || '(no output)'}`);
  }
  return res.stdout.trim();
}

function buildManifest({ version, tools, subcommands }) {
  return {
    _note: 'Enumerated surface set for ADR-0094 coverage metric. Regenerated by scripts/regen-mcp-manifest.mjs against the pinned Verdaccio tarball. DO NOT hand-edit — run `node scripts/regen-mcp-manifest.mjs --write` after every publish cycle.',
    _schema_version: 1,
    _pinned_cli_version: version,
    _generated_at: new Date().toISOString(),
    _generated_by: 'scripts/regen-mcp-manifest.mjs --write',
    mcp_tools: tools,
    cli_subcommands: subcommands,
    _counts: {
      mcp_tools: tools.length,
      cli_subcommands: subcommands.length,
      total_surfaces: tools.length + subcommands.length,
    },
  };
}

async function regen({ print }) {
  const explicitVersion = process.env.PINNED_CLI_VERSION;
  const version = resolvePinnedVersion({ explicitVersion });
  const registry = process.env.NPM_REGISTRY || 'http://localhost:4873';
  const probeTmpdir = resolve(tmpdir(), `regen-mcp-manifest-${process.pid}-${Date.now()}`);
  let probeResult;
  try {
    probeResult = probePinnedCli({ version, tmpdir: probeTmpdir, registry });
  } finally {
    try { rmSync(probeTmpdir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  const tools = parseMcpToolsJson(probeResult.toolsStdout);
  assertToolCountSane(tools);
  const subcommands = parseCliHelp(probeResult.helpStdout);
  if (subcommands.length < MIN_SUBCOMMANDS) {
    throw new Error(`regen-mcp-manifest: only ${subcommands.length} subcommands parsed (<${MIN_SUBCOMMANDS}); --help output shape likely regressed`);
  }
  const manifest = buildManifest({ version, tools, subcommands });
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  if (print) {
    process.stdout.write(serialized);
  } else {
    writeFileSync(MANIFEST_PATH, serialized);
    console.log(`[regen-mcp-manifest] wrote ${MANIFEST_PATH}`);
    console.log(`  pinned_cli_version: ${version}`);
    console.log(`  mcp_tools:          ${tools.length}`);
    console.log(`  cli_subcommands:    ${subcommands.length}`);
    console.log(`  total_surfaces:     ${manifest._counts.total_surfaces}`);
  }
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`[regen-mcp-manifest] manifest not found: ${MANIFEST_PATH}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
}

function show() {
  const m = loadManifest();
  console.log('[regen-mcp-manifest] --show');
  console.log(`  pinned_cli_version: ${m._pinned_cli_version ?? '<unpinned>'}`);
  console.log(`  mcp_tools:          ${m._counts?.mcp_tools ?? 0}`);
  console.log(`  cli_subcommands:    ${m._counts?.cli_subcommands ?? 0}`);
  console.log(`  total_surfaces:     ${m._counts?.total_surfaces ?? 0}`);
  console.log(`  generated_at:       ${m._generated_at ?? '<never>'}`);
  console.log(`  generated_by:       ${m._generated_by ?? '<unknown>'}`);
}

function verifyStructural() {
  const m = loadManifest();
  const issues = [];
  if (!m._pinned_cli_version) issues.push('manifest has no _pinned_cli_version');
  if (!Array.isArray(m.mcp_tools)) issues.push('manifest.mcp_tools is not an array');
  if (!Array.isArray(m.cli_subcommands)) issues.push('manifest.cli_subcommands is not an array');
  if (Array.isArray(m.mcp_tools) && m.mcp_tools.length < MIN_TOOLS) {
    issues.push(`manifest.mcp_tools under guard (${m.mcp_tools.length} < ${MIN_TOOLS})`);
  }
  if (issues.length) {
    console.error('[regen-mcp-manifest] --verify failed:');
    for (const i of issues) console.error(`  - ${i}`);
    process.exit(1);
  }
  console.log(`[regen-mcp-manifest] --verify OK (structural; rot-detection vs live CLI lands with ADR-0096)`);
}

// ----------------------------------------------------------------- entrypoint

// Only run CLI flow when invoked directly (not when imported by tests).
const invokedDirectly = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const mode =
    args.includes('--write')  ? 'write'  :
    args.includes('--print')  ? 'print'  :
    args.includes('--show')   ? 'show'   :
    args.includes('--verify') ? 'verify' :
                                'help';
  (async () => {
    try {
      if (mode === 'write')       await regen({ print: false });
      else if (mode === 'print')  await regen({ print: true });
      else if (mode === 'show')   show();
      else if (mode === 'verify') verifyStructural();
      else {
        console.log('Usage: node scripts/regen-mcp-manifest.mjs [--write|--print|--show|--verify]');
        console.log('  --write   regenerate and overwrite config/mcp-surface-manifest.json');
        console.log('  --print   regenerate and print to stdout (no write)');
        console.log('  --show    summarize the current on-disk manifest');
        console.log('  --verify  structural check (non-zero on missing counts/arrays)');
        process.exit(2);
      }
    } catch (e) {
      console.error(`[regen-mcp-manifest] FAILED: ${e.message}`);
      process.exit(1);
    }
  })();
}

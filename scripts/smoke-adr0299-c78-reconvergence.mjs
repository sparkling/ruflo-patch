#!/usr/bin/env node
/**
 * ADR-0299 smoke — C7+C8 Verticals & Tooling re-convergence fixes.
 *
 * Two halves:
 *   FORK-TREE contracts (F1/F2/F3) — resolved via config/upstream-branches.json
 *   (`ruflo.dir`, same source of truth as the marketplace-integrity lint).
 *   LOUD-SKIP when the fork tree is not present (CI without the fork checkout)
 *   — never silent-pass.
 *
 *   F1 — marketplace.json description honesty. The C7+C8 audit (D-CROSS-1)
 *        found .claude-plugin/marketplace.json:132 carrying the exact
 *        iot-cognitum overclaim string the marketplace-integrity lint forbids,
 *        because lint Assertion 4 walked only per-plugin manifests. The lint is
 *        extended (patch repo) AND the marketplace entries are synced to the
 *        per-plugin honest rewrites (fork). Assert: no marketplace.json plugin
 *        entry description contains any OVERCLAIM pattern.
 *
 *   F2 — market-data command contract. commands/market.md:11 prescribed
 *        `agentdb_hierarchical-store` + a namespace the live schema rejects —
 *        the exact bug the plugin's own ADR-0001 §19 fixed in the SKILL
 *        (second split-surface drift of the program). Assert: no line in the
 *        plugin's command surface pairs `agentdb_hierarchical-store` with a
 *        namespace prescription.
 *
 *   F3 — the 3 neural-trader kernel smokes (portfolio-cg CG-parity,
 *        backtest-signing Ed25519, feature-attribution PageRank) run GREEN from
 *        the fork tree. They were wired into no runner (latent red) and
 *        portfolio-cg:140 grepped the un-rebranded `mcp__claude-flow__`
 *        literal. The two crypto smokes need `@noble/ed25519` resolvable from
 *        the fork root (declared in the fork root + cli package.json; the
 *        fork-root npm install is broken by unrelated self-referencing renamed
 *        packages) — LOUD-SKIP those two when unresolvable.
 *
 *   INSTALLED-CLI behaviour (F4) — drives the installed cli over MCP stdio:
 *
 *   F4 — transfer demo-fallback disclosure. `discoverRegistry()` falls back to
 *        the hardcoded demo catalog (IPNS miss / fetch miss / fail-closed
 *        signature) with stderr-only `(demo)` logging; the published
 *        transfer_plugin-official envelope is a BARE ARRAY of real-shaped
 *        fabricated entries with no disclosure. Assert: the envelope is an
 *        object carrying `source` (string), `fromDemo` (boolean), and
 *        `plugins` (array); transfer_plugin-search (plugin-creator's real
 *        dependency) still answers — its contract unchanged.
 *
 * BOTH-WAYS: against the PUBLISHED/current Verdaccio cli, F4 fails (bare-array
 * envelope, no disclosure); F1/F2/F3 are fork-tree checks and pass once the
 * fork commits land. Against the FIXED cli all PASS. Reuses the shared
 * ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP; standalone self-installs
 * from Verdaccio. No paid LLM calls; the only network touch is the registry
 * gateway probe inside discoverRegistry, which falls back to demo offline.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0299-c78-reconvergence-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0299-c78-reconvergence');

let passed = 0;
let failed = 0;
let skipped = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function skip(label, reason) { skipped++; log(`  SKIP  ${label}: ${reason}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Must mirror tests/pipeline/plugin-marketplace-integrity.test.mjs
// OVERCLAIM_DESCRIPTION_PATTERNS (the lint is the canonical list; this smoke
// re-asserts the marketplace ARTIFACT so the check also runs where the node
// test suite does not).
const OVERCLAIM_DESCRIPTION_PATTERNS = [
  '112+ MCP tools',
  '112 MCP tools',
  '112+ tools',
  '112 tools',
  'exposes neural-trader',
  'witness chain verification for Cognitum Seed hardware',
];

const KERNEL_SMOKES = [
  { name: 'portfolio-cg', needsEd25519: false },
  { name: 'backtest-signing', needsEd25519: true },
  { name: 'feature-attribution', needsEd25519: true },
];

/** A minimal MCP stdio JSON-RPC client over a long-lived `cli mcp start`. */
function startMcpSession(cli, cwd) {
  const env = { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY };
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.OLLAMA_API_KEY;
  const proc = spawn(cli, ['mcp', 'start'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', (c) => {
    buf += c.toString();
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* non-frame line on stdout — ignore */ }
    }
  });
  let stderrTail = '';
  proc.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-1500); });
  let nextId = 1;
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout on ${method}`)); } }, 120000);
    });
  }
  function unwrap(resp) {
    if (resp?.error) return { __rpcError: resp.error.message };
    let txt = resp?.result?.content?.[0]?.text;
    for (let i = 0; i < 5 && typeof txt === 'string'; i++) {
      try {
        const o = JSON.parse(txt);
        if (o && o.content && o.content[0] && typeof o.content[0].text === 'string') { txt = o.content[0].text; continue; }
        return o;
      } catch { return txt; }
    }
    return txt;
  }
  return {
    proc,
    rpc,
    async call(name, args) { return unwrap(await rpc('tools/call', { name, arguments: args || {} })); },
    getStderrTail: () => stderrTail,
    async init() {
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0299-smoke', version: '1' } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    async close() {
      try { proc.stdin.end(); } catch {}
      await sleep(400);
      if (proc.exitCode === null) try { proc.kill('SIGKILL'); } catch {}
    },
  };
}

/** Resolve the fork tree from config/upstream-branches.json (lint's source of truth). */
function resolveForkDir() {
  try {
    const cfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'upstream-branches.json'), 'utf8'));
    const dir = cfg?.ruflo?.dir;
    if (typeof dir === 'string' && dir && existsSync(dir)) return dir;
    return null;
  } catch {
    return null;
  }
}

function checkForkTree(forkDir) {
  // ── F1: marketplace.json plugin descriptions carry no overclaim pattern ──
  log(`[smoke] F1: marketplace.json description honesty`);
  const marketplacePath = join(forkDir, '.claude-plugin', 'marketplace.json');
  if (!existsSync(marketplacePath)) {
    fail('F1.marketplace', `missing ${marketplacePath}`);
  } else {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    } catch (e) {
      parsed = null;
      fail('F1.marketplace parse', String(e).slice(0, 160));
    }
    if (parsed) {
      const entries = Array.isArray(parsed.plugins) ? parsed.plugins : [];
      const offenders = [];
      for (const entry of entries) {
        if (typeof entry.description !== 'string') continue;
        for (const pattern of OVERCLAIM_DESCRIPTION_PATTERNS) {
          if (entry.description.includes(pattern)) offenders.push(`${entry.name ?? '(unnamed)'} → "${pattern}"`);
        }
      }
      if (entries.length === 0) {
        fail('F1.marketplace shape', 'marketplace.json has no plugins[] entries');
      } else if (offenders.length > 0) {
        fail('F1.marketplace-honesty', `overclaim pattern(s) in marketplace.json: ${offenders.join('; ').slice(0, 300)}`);
      } else {
        pass(`F1.marketplace-honesty: 0 overclaim hits across ${entries.length} entries × ${OVERCLAIM_DESCRIPTION_PATTERNS.length} patterns`);
      }
    }
  }

  // ── F2: market-data command surface — no hierarchical-store+namespace pair ──
  log(`[smoke] F2: market-data command contract (memory_store --namespace, not hierarchical-store+namespace)`);
  const commandsDir = join(forkDir, 'plugins', 'ruflo-market-data', 'commands');
  if (!existsSync(commandsDir)) {
    fail('F2.commands-dir', `missing ${commandsDir}`);
  } else {
    const pairRe = /agentdb_hierarchical-store.+namespace|namespace.+agentdb_hierarchical-store/i;
    const offenders = [];
    let sawMemoryStore = false;
    for (const f of readdirSync(commandsDir).filter((n) => n.endsWith('.md'))) {
      const lines = readFileSync(join(commandsDir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (pairRe.test(line)) offenders.push(`${f}:${i + 1}`);
        if (line.includes('memory_store --namespace market-data')) sawMemoryStore = true;
      });
    }
    if (offenders.length > 0) {
      fail('F2.command-contract', `hierarchical-store+namespace prescription survives at ${offenders.join(', ')}`);
    } else if (!sawMemoryStore) {
      fail('F2.command-contract', 'no `memory_store --namespace market-data` prescription found in the command surface (the honest replacement is missing, not just the bug)');
    } else {
      pass('F2.command-contract: command surface prescribes memory_store --namespace market-data; no hierarchical-store+namespace pairing');
    }
  }

  // ── F3: the 3 neural-trader kernel smokes run green from the fork tree ──
  log(`[smoke] F3: neural-trader kernel smokes (CG parity · Ed25519 · PageRank)`);
  let ed25519Resolvable = false;
  try {
    createRequire(join(forkDir, 'package.json')).resolve('@noble/ed25519');
    ed25519Resolvable = true;
  } catch { /* dev-tree dep absent */ }
  for (const { name, needsEd25519 } of KERNEL_SMOKES) {
    const smokePath = join(forkDir, 'scripts', `smoke-neural-trader-${name}.mjs`);
    if (!existsSync(smokePath)) {
      fail(`F3.${name}`, `missing ${smokePath}`);
      continue;
    }
    if (needsEd25519 && !ed25519Resolvable) {
      skip(`F3.${name}`, `@noble/ed25519 not resolvable from ${forkDir} — its [2/3] crypto layer cannot run (declared in the fork root + cli package.json; place the package in the fork root node_modules)`);
      continue;
    }
    const res = spawnSync('node', [smokePath], { cwd: forkDir, encoding: 'utf8', timeout: 120000 });
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    const tail = out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 240);
    if (res.status === 0) {
      const checks = (out.match(/✓/g) || []).length;
      pass(`F3.${name}: exit=0 (${checks} checks) — ${tail.slice(0, 120)}`);
    } else {
      fail(`F3.${name}`, `exit=${res.status} — ${tail}`);
    }
  }
}

async function main() {
  log(`\n[ADR-0299 smoke] C7+C8 re-convergence — F1 marketplace honesty · F2 market command contract · F3 kernel smokes · F4 transfer demo disclosure`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  // ── Fork-tree half (F1/F2/F3) ──────────────────────────────────────────────
  const forkDir = resolveForkDir();
  if (forkDir) {
    log(`[smoke] fork tree: ${forkDir}`);
    checkForkTree(forkDir);
  } else {
    skip('F1.marketplace-honesty', 'fork tree not resolvable from config/upstream-branches.json (ruflo.dir)');
    skip('F2.command-contract', 'fork tree not resolvable');
    skip('F3.kernel-smokes', 'fork tree not resolvable');
  }

  // ── Installed-cli half (F4) ────────────────────────────────────────────────
  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0299-c78', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }
  log(`[smoke] cli: ${cli}`);

  try {
    const marker = join(tempDir, '.ruflo-project');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ smoke: 'adr0299' }));
  } catch { /* best-effort */ }

  const testBodyStart = process.hrtime.bigint();
  const session = startMcpSession(cli, tempDir);
  await session.init();

  try {
    // ── F4: transfer_plugin-official discloses demo-fallback provenance ──────
    log(`[smoke] F4: transfer_plugin-official envelope carries source/fromDemo`);
    {
      const official = await session.call('transfer_plugin-official', {});
      if (official && official.__rpcError) {
        fail('F4.plugin-official', `rpc error: ${official.__rpcError}`);
      } else if (Array.isArray(official)) {
        fail('F4.plugin-official', `envelope is a BARE ARRAY (${official.length} entries) — source/fromDemo disclosure missing (published-baseline signature; real-shaped demo entries with no provenance)`);
      } else if (official && typeof official === 'object') {
        const hasSource = typeof official.source === 'string' && official.source.length > 0;
        const hasFromDemo = typeof official.fromDemo === 'boolean';
        const hasPlugins = Array.isArray(official.plugins);
        if (hasSource && hasFromDemo && hasPlugins) {
          pass(`F4.plugin-official: provenance disclosed (source="${official.source}", fromDemo=${official.fromDemo}, plugins=${official.plugins.length})`);
          // The demo catalog is the expected offline/fail-closed result; if the
          // registry ever verifies live, fromDemo=false with a real source is
          // equally honest — the CONTRACT is the disclosure fields, not the value.
          if (official.fromDemo === true && !/\(demo\)/.test(official.source)) {
            fail('F4.source-marker', `fromDemo=true but source lacks the (demo) marker: "${official.source}"`);
          } else {
            pass(`F4.source-marker: source string consistent with fromDemo=${official.fromDemo}`);
          }
        } else {
          fail('F4.plugin-official shape', `missing disclosure field(s): source=${hasSource} fromDemo=${hasFromDemo} plugins=${hasPlugins} — ${JSON.stringify(official).slice(0, 200)}`);
        }
      } else {
        fail('F4.plugin-official shape', `unexpected envelope: ${JSON.stringify(official).slice(0, 200)}`);
      }
    }

    // ── F4 negative: transfer_plugin-search (the real dependency) unchanged ──
    {
      const search = await session.call('transfer_plugin-search', { query: 'flow' });
      if (search && search.__rpcError) {
        fail('F4.plugin-search', `rpc error: ${search.__rpcError}`);
      } else if (search && typeof search === 'object' && typeof search.error === 'string') {
        fail('F4.plugin-search', `errored: ${search.error.slice(0, 160)}`);
      } else if (Array.isArray(search) || (search && typeof search === 'object')) {
        pass(`F4.plugin-search: name-search path answers (contract unchanged${Array.isArray(search) ? `, ${search.length} results` : ''})`);
      } else {
        fail('F4.plugin-search shape', `unexpected envelope: ${JSON.stringify(search).slice(0, 160)}`);
      }
    }
  } catch (err) {
    fail('mcp-session', `uncaught: ${err?.stack || err}`);
  } finally {
    await session.close();
  }

  perf.mark('test-body', testBodyStart);
  perf.emitJson();
  try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}

  log(`\n[ADR-0299 smoke] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { log(`[smoke] FATAL: ${e?.stack || e}`); process.exit(1); });

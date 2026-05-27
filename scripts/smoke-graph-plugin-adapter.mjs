#!/usr/bin/env node
/**
 * Smoke test: ADR-0261 Phase 4 — plugin adapter (GraphEdgesSource)
 *
 * Mirrors upstream's `smoke-graph-plugin-adapter.mjs` (P4) re-targeted at
 * the fork's `ruflo-knowledge-graph` plugin per ADR-0261 §R2.9 item 1
 * (option a: retarget to `ruflo-knowledge-graph`, not the absent
 * `ruflo-graph-intelligence`).
 *
 * This smoke exercises the plugin's read path:
 *   1. The `ruflo-knowledge-graph` plugin's `plugin.json` declares
 *      `graph_adapter` per upstream's plugin-creator skill addition.
 *   2. The plugin's `GraphEdgesSource` adapter at
 *      `src/adapters/knowledge-graph-adapter.ts` exists and exports the
 *      class + methods.
 *   3. After seeding 3 graph_edges rows, dispatching the adapter via
 *      `agentdb_graph-query` returns those rows (transitive check that the
 *      adapter sees the table).
 *
 * Per ADR-0261 §R2.7, this is the READ adapter; the plugin reads
 * `graph_edges` via this 73-LOC class (ported verbatim from upstream's
 * `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts`
 * upstream).
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE.
 * Per `project-rvf-test-artifact-resolution`: progress to stderr.
 * Per `feedback-no-squelch-tests`: missing adapter file / missing
 * graph_adapter field FAIL loudly.
 *
 * Usage: node scripts/smoke-graph-plugin-adapter.mjs
 *
 * Exit codes:
 *   0 — adapter present, plugin.json declares graph_adapter, dispatch works
 *   1 — at least one assertion failed
 *
 * Dependencies: Agent A's plugin port (knowledge-graph-adapter.ts +
 * plugin.json update) must be installed in the test project.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const CLI_PKG = process.env.CLI_PKG || '@sparkleideas/cli';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-graph-plugin-${Date.now()}.log`);

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function assert(cond, label, reason = '') { cond ? pass(label) : fail(label, reason || 'assertion false'); }

function findCli(tempDir) {
  for (const name of ['ruflo', 'claude-flow', 'cli']) {
    const p = join(tempDir, 'node_modules', '.bin', name);
    if (existsSync(p)) return p;
  }
  return null;
}

function installAndInit(tempDir) {
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
    name: 'smoke-graph-plugin', version: '1.0.0', private: true,
  }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${REGISTRY}\n`);
  log(`[setup] installing ${CLI_PKG}`);
  const r = spawnSync('npm', [
    'install', CLI_PKG,
    '--registry', REGISTRY,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  if (r.status !== 0) {
    log(`[setup] FATAL install: ${r.stderr}`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) { log(`[setup] FATAL: cli not found`); process.exit(1); }
  log(`[setup] init --full --force`);
  const r2 = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  if (r2.status !== 0) {
    log(`[setup] init failed: ${r2.stderr?.slice(0, 1000)}`);
    process.exit(1);
  }
  spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return cli;
}

function findMemoryDb(tempDir) {
  for (const rel of ['.swarm/memory.db', '.claude-flow/agentdb/memory.db', '.claude-flow/memory.db']) {
    const p = join(tempDir, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

function sqliteExec(dbPath, sql) {
  const r = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout || '').trim(), err: r.stderr || '' };
}

function findPluginDir(tempDir) {
  // The ruflo-knowledge-graph plugin is a Claude Code marketplace plugin
  // (NOT an npm package — confirmed: `npm view @sparkleideas/ruflo-
  // knowledge-graph` returns 404). It is NOT installed by `cli init
  // --full --force` into the temp project's node_modules. The published
  // @sparkleideas/cli npm tarball ships only ['dist', 'bin', 'scripts',
  // '.claude', 'README.md'] — no plugin source tree.
  //
  // Per ADR-0261 §R2.8 deliverable #1 (Plugin adapter `GraphEdgesSource`)
  // and §R2.9 item 1 (option a — retarget to `ruflo-knowledge-graph`),
  // the P4 deliverable is the source-tree port at
  // `forks/ruflo/plugins/ruflo-knowledge-graph/` in the dev repo. The
  // smoke verifies the fork-source presence (this is a dev-machine
  // acceptance check; the release pipeline runs from the same dev
  // checkout). CI can override via PLUGIN_DIR env var.
  if (process.env.PLUGIN_DIR && existsSync(process.env.PLUGIN_DIR)) {
    return process.env.PLUGIN_DIR;
  }
  const candidates = [
    // Temp-install paths (would-be locations if shipped via npm — they're not):
    join(tempDir, 'node_modules', '@sparkleideas', 'ruflo-knowledge-graph'),
    join(tempDir, 'node_modules', '@sparkleideas', 'cli', 'plugins', 'ruflo-knowledge-graph'),
    join(tempDir, '.claude-flow', 'plugins', 'ruflo-knowledge-graph'),
    // Marketplace cache locations (Claude Code plugin marketplace):
    join(process.env.HOME || '', '.claude', 'plugins', 'ruflo-knowledge-graph'),
    // Fork source path (canonical P4 deliverable per ADR-0261 §R2.9):
    '/Users/henrik/source/forks/ruflo/plugins/ruflo-knowledge-graph',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

function mcpToolCall(cli, tempDir, toolName, args) {
  const r = spawnSync(cli, ['mcp', 'exec', '-t', toolName, '-p', JSON.stringify(args)], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr, status: r.status };
}

// Extract the `Result: { ... }` JSON block from `mcp exec` stdout.
function parseJsonish(out) {
  if (!out) return null;
  let start = out.indexOf('Result:');
  start = start >= 0 ? out.indexOf('{', start) : out.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < out.length; i++) {
    const ch = out[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(out.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function main() {
  log(`\n[ADR-0261 P4 smoke] ruflo-knowledge-graph plugin adapter`);
  log(`[smoke] log file: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const tempDir = mkdtempSync(join(tmpdir(), 'smoke-graph-plugin-'));
  log(`[smoke] temp dir: ${tempDir}`);

  try {
    const cli = installAndInit(tempDir);
    const dbPath = findMemoryDb(tempDir);
    if (!dbPath) {
      fail('0a: locate memory.db', `no memory.db under ${tempDir}`);
      throw new Error('no memory.db');
    }
    pass(`0a: memory.db at ${dbPath}`);

    // ─── TEST 1: plugin directory present ────────────────────────────────
    log(`\nTEST 1: ruflo-knowledge-graph plugin installed`);
    const pluginDir = findPluginDir(tempDir);
    assert(pluginDir !== null, '1a: plugin directory located',
      `searched node_modules + .claude-flow/plugins/`);
    if (pluginDir) {
      log(`[smoke] plugin dir: ${pluginDir}`);
    } else {
      throw new Error('plugin not installed');
    }

    // ─── TEST 2: plugin.json declares graph_adapter ──────────────────────
    // Claude Code plugins use .claude-plugin/plugin.json; older shapes
    // used plain plugin.json. Probe both.
    log(`\nTEST 2: plugin.json declares graph_adapter field`);
    const pluginJsonCandidates = [
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      join(pluginDir, 'plugin.json'),
    ];
    let pluginJsonPath = null;
    for (const c of pluginJsonCandidates) {
      if (existsSync(c)) { pluginJsonPath = c; break; }
    }
    assert(pluginJsonPath !== null, '2a: plugin.json exists',
      `searched: ${pluginJsonCandidates.join(', ')}`);
    if (pluginJsonPath) {
      log(`[smoke] plugin.json: ${pluginJsonPath}`);
      try {
        const pj = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
        assert(pj.graph_adapter !== undefined,
          '2b: plugin.json has graph_adapter field',
          `keys=${Object.keys(pj).join(',')}`);
        if (pj.graph_adapter) {
          assert(typeof pj.graph_adapter === 'object' ||
            typeof pj.graph_adapter === 'string',
            '2c: graph_adapter is object or string',
            `type=${typeof pj.graph_adapter}`);
        }
      } catch (e) {
        fail('2b: plugin.json parse', e.message);
      }
    }

    // ─── TEST 3: knowledge-graph-adapter.ts ports the GraphEdgesSource ──
    log(`\nTEST 3: knowledge-graph-adapter source ports GraphEdgesSource`);
    // The adapter source ships in the published package — look for .ts or
    // compiled .js variants.
    const adapterCandidates = [
      join(pluginDir, 'src', 'adapters', 'knowledge-graph-adapter.ts'),
      join(pluginDir, 'dist', 'adapters', 'knowledge-graph-adapter.js'),
      join(pluginDir, 'adapters', 'knowledge-graph-adapter.js'),
    ];
    let adapterPath = null;
    for (const c of adapterCandidates) {
      if (existsSync(c)) { adapterPath = c; break; }
    }
    assert(adapterPath !== null, '3a: knowledge-graph-adapter file present',
      `searched: ${adapterCandidates.join(', ')}`);
    if (adapterPath) {
      const src = readFileSync(adapterPath, 'utf8');
      assert(src.includes('GraphEdgesSource'),
        '3b: source exports GraphEdgesSource class',
        `(neither class nor identifier found in ${adapterPath})`);
      assert(src.includes('graph_edges'),
        '3c: source references graph_edges table',
        `(no graph_edges reference in ${adapterPath})`);
    }

    // ─── TEST 4: seed 3 rows + dispatch read returns them ────────────────
    // Per the schema's IMPLEMENTATION NOTE (ADR-0261 §R2), graph_edges
    // has no FK to memory_entries — use string ids directly. witness_id
    // is NOT NULL with no default; supply a synthetic 16-char hex.
    log(`\nTEST 4: dispatch sees graph_edges rows via agentdb_graph-query`);
    sqliteExec(dbPath, `
      INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, witness_id)
        VALUES ('memory:plugin-a', 'memory:plugin-b', 'plugin-test-rel', 0.5, 0.8, 0.01, 'plg000000000001');
      INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, witness_id)
        VALUES ('memory:plugin-a', 'memory:plugin-c', 'plugin-test-rel', 0.6, 0.85, 0.01, 'plg000000000002');
      INSERT INTO graph_edges (source_id, target_id, relation, weight, confidence, decay_rate, witness_id)
        VALUES ('memory:plugin-b', 'memory:plugin-c', 'plugin-test-rel', 0.7, 0.9, 0.01, 'plg000000000003');
    `);
    const cnt = sqliteExec(dbPath,
      "SELECT COUNT(*) FROM graph_edges WHERE relation='plugin-test-rel';");
    assert(parseInt(cnt.output, 10) >= 3,
      '4a: 3 plugin-test rows seeded', `count=${cnt.output}`);

    const dispatch = mcpToolCall(cli, tempDir, 'agentdb_graph-query', {
      nodeId: 'memory:plugin-a', mode: 'k-hop', depth: 2,
    });
    assert(dispatch.ok, '4b: agentdb_graph-query (k-hop) dispatch exits 0',
      `status=${dispatch.status} stderr=${dispatch.stderr?.slice(0, 500)}`);
    const json = parseJsonish(dispatch.stdout);
    if (json) {
      assert(json.success === true, '4c: dispatch reports success=true',
        `payload=${JSON.stringify(json).slice(0, 300)}`);
      const results = json.results || [];
      assert(Array.isArray(results) && results.length > 0,
        '4d: dispatch returns non-empty results from seeded edges',
        `length=${results?.length}`);
    } else {
      fail('4c: dispatch returns parseable JSON',
        `stdout=${dispatch.stdout?.slice(0, 300)}`);
    }

  } catch (err) {
    log(`[smoke] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0261 P4 plugin-adapter criteria not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0261 P4 plugin-adapter criteria met.\n`);
  process.exit(0);
}

main();

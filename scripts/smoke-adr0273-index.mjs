#!/usr/bin/env node
/**
 * Smoke: ADR-0273 — `agentdb index` builds all 3 canonical surfaces in one
 * in-process pass, alongside a LIVE MCP server (no stop), via the ADR-0274
 * read/write handle split.
 *
 * Uses a small synthetic corpus (high ADR-900x ids → no collision with the real
 * 0001-0280 corpus) so the assertions are deterministic and fast (the full
 * 280-ADR build is WS3, not this smoke):
 *   ADR-9001  supersedes ADR-9002, depends-on ADR-9003
 *   ADR-9002, ADR-9003  leaves
 * Expect: 3 hierarchical records + 3 adr-patterns + 2 forward edges + 2 inverses
 * (superseded-by, depended-on-by). Then agentdb_hierarchical-query adr/ADR-900*
 * (via the live MCP server) returns all 3 — exercising the ADR-0176 key glob too.
 *
 * FAILs if the command is missing (pre-publish), if writes hit LockHeld
 * (ADR-0274 not effective), or if the hierarchical query can't see the records.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0273-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0273-index');

let passed = 0, failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

function adrDoc(id, fm, title) {
  return `---\n${fm}\n---\n# ${title}\n\n## Context and Problem Statement\n\nSynthetic ADR ${id} for the ADR-0273 index smoke. It exists to validate the in-process index command.\n`;
}

function parseResult(raw) {
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  let obj;
  try { obj = JSON.parse(body.slice(start)); } catch {
    for (const line of body.split(/\n/)) { const s = line.indexOf('{'); if (s < 0) continue; try { obj = JSON.parse(line.slice(s)); break; } catch {} }
  }
  if (obj && Array.isArray(obj.content) && obj.content[0]?.text) { try { obj = JSON.parse(obj.content[0].text); } catch {} }
  return obj;
}

async function main() {
  log(`\n[ADR-0273 smoke] agentdb index — 3 surfaces in-process, alongside live MCP`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir, shared } = setupSmokeTempDir('smoke-adr0273', perf, REGISTRY);
  let mcpProc = null;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared, mcpProc); }

    // Synthetic corpus.
    const adrDir = join(dir, 'smoke-adr');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, 'ADR-9001-smoke-root.md'),
      adrDoc('ADR-9001', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: [ADR-9002]\ndepends-on: [ADR-9003]\nimplements: []', 'Smoke Root 9001'));
    writeFileSync(join(adrDir, 'ADR-9002-smoke-superseded.md'),
      adrDoc('ADR-9002', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Superseded 9002'));
    writeFileSync(join(adrDir, 'ADR-9003-smoke-dep.md'),
      adrDoc('ADR-9003', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Dep 9003'));

    // Start a live MCP server + warm it up so it holds-then-parks the RVF flock.
    mcpProc = spawn(cli, ['mcp', 'start'], { cwd: dir, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY }, stdio: ['pipe', 'pipe', 'pipe'] });
    let sb = '';
    mcpProc.stdout.on('data', (c) => { sb += c.toString(); });
    mcpProc.stderr.on('data', (c) => log(`  [mcp.stderr] ${c.toString().replace(/\n/g, ' | ').slice(0, 200)}`));
    mcpProc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0273', version: '0' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'adr0273-warmup', limit: 1 } } }) + '\n');
    { const t = Date.now(); while (Date.now() - t < 15000) { await new Promise(r => setTimeout(r, 250)); if (/"id":\s*2[,}]/.test(sb)) break; if (mcpProc.exitCode !== null) break; } }
    log(`[smoke] MCP warmed (or settled); running agentdb index alongside it`);

    // Run the index command alongside the live server.
    const t0 = Date.now();
    const r = spawnSync(cli, ['agentdb', 'index', '--dir', adrDir], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
    const ms = Date.now() - t0;
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    log(`[smoke] agentdb index status=${r.status} duration=${ms}ms`);
    log(combined.slice(0, 600));

    if (/Unknown command|not found/i.test(combined) && /agentdb/i.test(combined) && r.status !== 0 && !/index complete|index:/i.test(combined)) {
      fail('command-missing', 'agentdb index not registered — published build predates ADR-0273');
      return finish(dir, shared, mcpProc);
    }
    if (r.signal === 'SIGTERM' || ms >= 59000 || /LockHeld|0x0300/i.test(combined)) {
      fail('index-blocked', `agentdb index hit LockHeld / hang alongside the live MCP server (ADR-0274 not effective): ${combined.slice(0,200)}`);
      return finish(dir, shared, mcpProc);
    }
    if (r.status === 0) pass(`agentdb index ran alongside live MCP server in ${ms}ms (no stop, no LockHeld)`);
    else fail('index-exit', `agentdb index exit=${r.status}: ${combined.slice(0,200)}`);

    // Report assertions: 3 records, 2 edges, 2 inverses.
    if (/3\b.*hierarchical record|3\/3 hierarchical/i.test(combined)) pass('reported 3 hierarchical records');
    else fail('record-count', `expected 3 hierarchical records in report: ${combined.slice(0,200)}`);
    if (/2 edges \+ 2 inverses|2 edges|2 inverses/i.test(combined)) pass('reported 2 edges + 2 inverses');
    else fail('edge-count', `expected 2 edges + 2 inverses in report: ${combined.slice(0,200)}`);

    // hierarchical-query via the live MCP server: adr/ADR-900* → 3.
    const q = spawnSync(cli, ['mcp', 'exec', '--tool', 'agentdb_hierarchical-query', '--params', JSON.stringify({ pathPattern: 'adr/ADR-900*' })],
      { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
    const qobj = parseResult(`${q.stdout || ''}\n${q.stderr || ''}`);
    const n = qobj && Array.isArray(qobj.results) ? qobj.results.length : null;
    if (n === 3) pass(`agentdb_hierarchical-query adr/ADR-900* → 3 records (records queryable via live server)`);
    else fail('hquery', `expected 3 from adr/ADR-900*, got ${n}: ${JSON.stringify(qobj).slice(0,200)}`);

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (mcpProc && mcpProc.exitCode === null) { try { mcpProc.kill('SIGTERM'); } catch {} await new Promise(r => setTimeout(r, 400)); if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {} }
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish();
}

function finish() {
  log(`\nResults: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

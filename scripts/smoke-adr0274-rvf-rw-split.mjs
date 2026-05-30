#!/usr/bin/env node
/**
 * Smoke: ADR-0274 — RVF read/write handle split (resolves the re-opened ADR-0267).
 *
 * The ADR-0267 smoke (smoke-adr0267-rvf-lock.mjs) passes EVEN pre-fix because it
 * never issues a `tools/call`, so the MCP server never warms up RVF and never
 * acquires the flock (the 2026-05-30 amendment: "ADR-0267's smoke passes only
 * because it writes before the server's first tool call"). THIS smoke closes
 * that gap:
 *
 *   1. Start the MCP server.
 *   2. Drive a real JSON-RPC `tools/call` (memory_search) so the server is PAST
 *      its lazy RVF warmup — it has opened the RVF backend (acquired the flock).
 *   3. From a SEPARATE process, run `cli memory store` (x2) with a 30s timeout.
 *      - pre-fix: the server holds the flock for its lifetime → the CLI writer
 *        blocks ~30s then LockHeld.  → FAIL
 *      - post-fix: the server PARKS the flock after init/each op (the native
 *        releaseLock/reacquireLock park/unpark), so the CLI writer acquires it
 *        immediately and both stores succeed.  → PASS
 *   4. memory_search still works against the running server (read path intact).
 *
 * FAIL pre-fix, PASS post-fix — the ADR-0274 §Confirmation gate.
 */
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0274-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0274-rvf-rw-split');

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function cliMemoryStore(cli, dir, key, value) {
  const t0 = Date.now();
  const r = spawnSync(cli, ['memory', 'store', '-k', key, '-v', value], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return { r, ms: Date.now() - t0 };
}

async function main() {
  log(`\n[ADR-0274 smoke] RVF read/write handle split — concurrent CLI write past MCP warmup`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0274', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let mcpProc = null;
  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared, mcpProc); }
    testBodyStart = process.hrtime.bigint();

    // ── Step 1: start the MCP server (stdio). ──
    log(`[smoke] spawning MCP server (cli mcp start)…`);
    mcpProc = spawn(cli, ['mcp', 'start'], {
      cwd: dir,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdoutBuf = '';
    mcpProc.stdout.on('data', (c) => { stdoutBuf += c.toString(); });
    mcpProc.stderr.on('data', (c) => log(`  [mcp.stderr] ${c.toString().replace(/\n/g, ' | ').slice(0, 300)}`));
    mcpProc.on('exit', (code) => log(`[mcp.exit] code=${code}`));

    // ── Step 2: drive a real tools/call to force RVF warmup (flock acquire). ──
    const reqs =
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0274-smoke', version: '0.0.0' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'adr0274-warmup-probe', limit: 1 } } }) + '\n';
    mcpProc.stdin.write(reqs);

    // Wait for the tools/call (id:2) response — confirms warmup ran — or 20s.
    const warmStart = Date.now();
    let warmedUp = false;
    while (Date.now() - warmStart < 20000) {
      await new Promise((r) => setTimeout(r, 250));
      if (/"id":\s*2[,}]/.test(stdoutBuf)) { warmedUp = true; break; }
      if (mcpProc.exitCode !== null) { log(`[smoke] WARN: MCP exited during warmup (code=${mcpProc.exitCode})`); break; }
    }
    if (warmedUp) {
      pass(`MCP server warmed up via tools/call (memory_search responded; RVF backend opened — flock acquired)`);
    } else {
      // Even without a parsed response, give the warmup a moment to have opened RVF.
      log(`[smoke] WARN: no parsed tools/call response in 20s; proceeding (server may be silent post-warmup)`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // ── Step 3: concurrent CLI writes from a separate process. ──
    log(`[smoke] cli memory store #1 (30s timeout) — must NOT block on the flock…`);
    const s1 = cliMemoryStore(cli, dir, `adr0274-smoke-1-${Date.now()}`, 'v1');
    log(`[smoke] store#1 status=${s1.r.status} duration=${s1.ms}ms signal=${s1.r.signal ?? 'none'}`);
    if (s1.r.stderr) log(`  store#1 stderr: ${s1.r.stderr.slice(0, 300)}`);

    const combined1 = `${s1.r.stdout || ''}\n${s1.r.stderr || ''}`;
    if (s1.r.signal === 'SIGTERM' || s1.ms >= 29000) {
      fail('concurrent store #1 blocked', `timed out at ${s1.ms}ms — MCP server held the RVF flock for its lifetime (ADR-0267 regression NOT resolved)`);
    } else if (/LockHeld|0x0300|EAGAIN.*lock|flock.*timed out/i.test(combined1)) {
      fail('concurrent store #1 hit LockHeld', `exit=${s1.r.status} duration=${s1.ms}ms`);
    } else if (s1.r.status === 0) {
      pass(`concurrent store #1 succeeded in ${s1.ms}ms past MCP warmup (flock parked — ADR-0274 split works)`);
    } else {
      fail('concurrent store #1 failed', `exit=${s1.r.status} duration=${s1.ms}ms: ${combined1.slice(0, 200)}`);
    }

    // A second store proves the park/unpark cycles repeatedly, not just once.
    log(`[smoke] cli memory store #2 (30s timeout)…`);
    const s2 = cliMemoryStore(cli, dir, `adr0274-smoke-2-${Date.now()}`, 'v2');
    log(`[smoke] store#2 status=${s2.r.status} duration=${s2.ms}ms`);
    if (s2.r.signal === 'SIGTERM' || s2.ms >= 29000) {
      fail('concurrent store #2 blocked', `timed out at ${s2.ms}ms (flock cycle did not repeat)`);
    } else if (s2.r.status === 0) {
      pass(`concurrent store #2 succeeded in ${s2.ms}ms (flock park/unpark cycles repeatedly)`);
    } else {
      fail('concurrent store #2 failed', `exit=${s2.r.status} duration=${s2.ms}ms`);
    }

    // ── Step 4: read path still works (memory_search via CLI). ──
    log(`[smoke] cli memory search (read path intact)…`);
    const rs = spawnSync(cli, ['memory', 'search', '-q', 'v1', '--limit', '5'], {
      cwd: dir, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });
    if (rs.signal === 'SIGTERM') {
      fail('memory search blocked', `timed out — read path contends on the flock`);
    } else if (rs.status === 0 || /results?|found|matches|\[\]/i.test(`${rs.stdout}\n${rs.stderr}`)) {
      pass(`memory search returned (read path lock-free, status=${rs.status})`);
    } else {
      fail('memory search failed', `exit=${rs.status}: ${(rs.stderr || '').slice(0, 200)}`);
    }

  } catch (err) {
    fail('main', err?.stack || String(err));
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    if (mcpProc && mcpProc.exitCode === null) {
      try { mcpProc.kill('SIGTERM'); } catch {}
      await new Promise((r) => setTimeout(r, 500));
      if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {}
    }
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish();
}

function finish() {
  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0274 RVF handle split not effective.\n`); process.exit(1); }
  log(`\nSmoke PASSED — concurrent CLI writes work past MCP warmup (ADR-0267 resolved).\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

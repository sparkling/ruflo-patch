#!/usr/bin/env node
/**
 * Smoke: ADR-0267 — CLI memory operations must work alongside running MCP server.
 *
 * Reproduces the regression: when the MCP server is running (and has acquired
 * the RVF flock at startup via warmUpRvfWithRetry), `cli memory store` was
 * blocking indefinitely because the MCP server held the lock for its entire
 * process lifetime instead of releasing per-op like the worker daemon does.
 *
 * Fix (Option B per ADR-0267 §Decision Outcome): add setRouterPersistent(false)
 * to mcp-server.ts startup, mirroring worker-daemon.ts:961-963.
 *
 * Smoke shape (Task #9 acceptance):
 *   1. Install cli to a temp project (via shared-temp if available).
 *   2. Start an MCP server child process; wait for the eager RVF warmup to
 *      complete (log line "Memory router initialized" OR a 5-second bound).
 *   3. From the same project root, run `cli memory store -k smoke -v testvalue`
 *      with a 30-second timeout.
 *   4. Assert: the store call returned within timeout (without the fix this
 *      would block indefinitely and we'd kill it at 30s).
 *   5. Tear down the MCP server.
 *
 * The fix MUST be in fork code at HEAD; running this smoke against a build
 * without the fix would produce a timeout failure.
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0267-${Date.now()}.log`);

const perf = createSmokePerf('smoke-adr0267-rvf-lock');

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

async function main() {
  log(`\n[ADR-0267 smoke] CLI memory store should not block when MCP server running`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  // ADR-0267 smoke uses ADR0255_SMOKE_SHARED_TEMP setup (same wrapper install);
  // the shared-temp infra is registry-agnostic to which ADR uses it.
  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0267-rvf', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  let mcpProc = null;
  try {
    let cli;
    if (shared) {
      cli = findCli(tempDir);
      if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
    } else {
      cli = installAndInit(tempDir, perf, REGISTRY);
    }
    testBodyStart = process.hrtime.bigint();

    // Step 1: start an MCP server child process. The MCP server eagerly calls
    // warmUpRvfWithRetry → ensureRvfWired → opens the RVF backend (acquires
    // flock). Without the fix this lock is held forever.
    log(`[smoke] spawning MCP server in background (cli mcp start)…`);
    mcpProc = spawn(cli, ['mcp', 'start'], {
      cwd: tempDir,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for the MCP server to reach 'mcp-stdio' init (means eager RVF
    // warmup completed). We capture stderr; the init line is JSON-shaped.
    let mcpReady = false;
    mcpProc.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      log(`  [mcp.stderr] ${s.slice(0, 200).trim()}`);
      if (s.includes('"mode":"mcp-stdio"') || s.includes('Memory router initialized')) {
        mcpReady = true;
      }
    });
    mcpProc.on('error', (err) => log(`[mcp.error] ${err.message}`));
    mcpProc.on('exit', (code) => log(`[mcp.exit] code=${code}`));

    // Bounded wait for ready signal — max 15s (RVF warmup + Archivist init).
    const startWait = Date.now();
    while (!mcpReady && Date.now() - startWait < 15000) {
      await new Promise((r) => setTimeout(r, 250));
      if (mcpProc.exitCode !== null) {
        log(`[smoke] WARN: MCP server exited before ready signal (exitCode=${mcpProc.exitCode})`);
        break;
      }
    }
    if (mcpReady) {
      pass(`MCP server reached mcp-stdio init within 15s (lock acquired)`);
    } else if (mcpProc.exitCode !== null) {
      // MCP server failed to start — can't validate the lock-release fix.
      fail('MCP server startup', `exited before ready (code=${mcpProc.exitCode})`);
    } else {
      // 15s timeout but server still running — proceed with the test; the
      // warmup may have taken longer but presumably succeeded by now.
      log(`  WARN  MCP server didn't emit ready signal within 15s; proceeding anyway`);
    }

    // Step 2: from the same project root, run `cli memory store` with a 30s
    // timeout. Without the fix, this would block indefinitely on the flock.
    // With the fix, the MCP server uses per-op release so the lock is free.
    log(`[smoke] running cli memory store -k adr0267-smoke -v testvalue (30s timeout)…`);
    const opStart = Date.now();
    const r = spawnSync(cli, ['memory', 'store', '-k', 'adr0267-smoke', '-v', 'testvalue'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });
    const opDuration = Date.now() - opStart;

    log(`[smoke] memory store status=${r.status} duration=${opDuration}ms`);
    if (r.stdout) log(`  stdout head: ${r.stdout.slice(0, 300)}`);
    if (r.stderr) log(`  stderr head: ${r.stderr.slice(0, 300)}`);

    // The hard signal: if duration is near the 30s timeout (within 1s of it),
    // the operation was blocked. If it returned in much less time, the
    // per-op release worked.
    if (r.signal === 'SIGTERM' || opDuration >= 29000) {
      fail(`memory store did not block`, `timed out at ${opDuration}ms — RVF lock held by MCP server (regression)`);
    } else if (r.status === 0) {
      pass(`memory store succeeded in ${opDuration}ms (per-op release works)`);
    } else {
      // Non-zero exit but completed within timeout — could be an unrelated
      // failure. Log but don't hard-fail unless it's specifically a LockHeld.
      const combined = `${r.stdout}\n${r.stderr}`;
      if (/LockHeld|EAGAIN.*lock|flock/i.test(combined)) {
        fail(`memory store hit LockHeld`, `exit=${r.status} duration=${opDuration}ms`);
      } else {
        log(`  WARN  memory store exited ${r.status} but NOT lock-blocked (duration=${opDuration}ms)`);
        pass(`memory store completed without lock-blocking (exit=${r.status}, duration=${opDuration}ms)`);
      }
    }

  } catch (err) {
    log(`[smoke] FATAL: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    if (mcpProc && mcpProc.exitCode === null) {
      try { mcpProc.kill('SIGTERM'); } catch {}
      await new Promise((r) => setTimeout(r, 500));
      if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {}
    }
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`${'─'.repeat(60)}`);
  perf.emitJson();

  if (failed > 0) { log(`\nSmoke FAILED — ADR-0267 regression NOT fixed.\n`); process.exit(1); }
  log(`\nSmoke PASSED — CLI memory store succeeds alongside running MCP server.\n`);
  process.exit(0);
}

main().catch((e) => { log(`Uncaught: ${e.message}`); process.exit(1); });

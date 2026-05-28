#!/usr/bin/env node
/**
 * Smoke: ADR-0266 C2 — Group 2 reset mutator (1 tool).
 *
 * Per ADR-0258 §Group 2: `wasm_agent_reset` wraps `ensureLive` + `withStoreLock`
 * + `snapshotAgent` so the persisted state is re-snapshot after reset clears
 * messages and turn count.
 *
 * Coverage:
 *   1. wasm_agent_create — get an agentId
 *   2. wasm_agent_reset(agentId) — dispatch reaches the handler
 *
 * Same Tool-not-found gate as group-1. WASM-substrate-unavailable → skip.
 */

import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
  mcpExec,
  skipByPolicy,
} from './lib/smoke-adr0266-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0266-group2-${Date.now()}.log`);

const perf = createSmokePerf('smoke-adr0266-group2-reset');

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0266 C2 smoke] Group 2 reset mutator`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-g2-reset', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    let cli;
    if (shared) {
      cli = findCli(tempDir);
      if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
    } else {
      cli = installAndInit(tempDir, perf, REGISTRY);
    }
    testBodyStart = process.hrtime.bigint();

    const createRes = mcpExec(cli, tempDir, REGISTRY, 'wasm_agent_create', { maxTurns: 5 }, 60000);
    log(`[smoke] wasm_agent_create status=${createRes.status}`);

    const createCombined = `${createRes.stdout}\n${createRes.stderr}`;
    if (/wasm.*not.*available|cannot find module.*agent-wasm|loadAgentWasm.*failed/i.test(createCombined)) {
      skipByPolicy('smoke-adr0266-group2-reset',
        'wasm-substrate-not-available: agent-wasm module failed to load in this install');
    }

    let agentId = null;
    try {
      if (createRes.parsed) {
        const txt = createRes.parsed?.result?.content?.[0]?.text
          ?? createRes.parsed?.content?.[0]?.text
          ?? null;
        if (txt) { const inner = JSON.parse(txt); agentId = inner?.agent?.id ?? null; }
      }
      if (!agentId) {
        const m = createRes.stdout.match(/"id"\s*:\s*"([^"]+)"/);
        if (m) agentId = m[1];
      }
    } catch {}
    if (!agentId) {
      agentId = 'smoke-stub-agentid';
      log(`[smoke] WARN: using stub agentId='${agentId}' for dispatch-only check`);
    }

    const r = mcpExec(cli, tempDir, REGISTRY, 'wasm_agent_reset', { agentId }, 30000);
    const combined = `${r.stdout}\n${r.stderr}`;
    if (/Tool not found:/.test(combined)) {
      fail(`wasm_agent_reset registered`, `Tool not found (status=${r.status})`);
    } else {
      pass(`wasm_agent_reset registered (dispatch reached handler)`);
    }

  } catch (err) {
    log(`[smoke] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`${'─'.repeat(60)}`);
  perf.emitJson();

  if (failed > 0) { log(`\nSmoke FAILED — C2 group-2 reset dispatch not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — wasm_agent_reset registered + dispatched.\n`);
  process.exit(0);
}

main();

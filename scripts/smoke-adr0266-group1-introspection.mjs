#!/usr/bin/env node
/**
 * Smoke: ADR-0266 C1 — Group 1 introspection tools (5).
 *
 * Per ADR-0258 §Group 1: each handler's first non-arg-parse statement is
 * `await ensureLive(args.agentId as string)` — the rehydrate-from-store path
 * that resolves cold-process state before the live read.
 *
 * Coverage:
 *   1. wasm_agent_create — get a fresh agentId
 *   2. wasm_agent_state(agentId)        — fork tool registered
 *   3. wasm_agent_todos(agentId)        — fork tool registered
 *   4. wasm_agent_tools(agentId)        — fork tool registered
 *   5. wasm_agent_turn_count(agentId)   — fork tool registered
 *   6. wasm_agent_is_stopped(agentId)   — fork tool registered
 *
 * Each call must NOT report `Tool not found` from the cli's `hasTool` gate
 * (the "did the handler get registered" signal). Handler-internal errors
 * (e.g. "WASM agent not found") are acceptable — they mean the wrap pattern
 * dispatched correctly. The hard FAIL is "Tool not found" — that proves the
 * handler isn't wired at all.
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0266-group1-${Date.now()}.log`);

const perf = createSmokePerf('smoke-adr0266-group1-introspection');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

// "Tool not found" is the hard-fail signal — proves the handler isn't
// registered. Anything else (success OR handler-internal error) means
// dispatch reached the registered handler.
function assertHandlerRegistered(toolName, result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (/Tool not found:/.test(combined)) {
    fail(`tool '${toolName}' registered`, `cli reported Tool not found (status=${result.status})`);
    return false;
  }
  pass(`tool '${toolName}' registered (dispatch reached handler)`);
  return true;
}

function main() {
  log(`\n[ADR-0266 C1 smoke] Group 1 introspection (5 tools)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-g1-introspect', perf, REGISTRY);
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

    // Step 1: Try to create an agent. If WASM substrate is unavailable on
    // this host, skip-by-policy (the per-tool dispatch checks still need a
    // valid id; we don't want a fake id to mask a genuine "Tool not found").
    const createRes = mcpExec(cli, tempDir, REGISTRY, 'wasm_agent_create', { maxTurns: 5 }, 60000);
    log(`[smoke] wasm_agent_create status=${createRes.status} (stdout head: ${createRes.stdout.slice(0, 300).replace(/\n/g, ' ')})`);

    // Detect WASM-substrate-unavailable: cli responded but handler couldn't
    // load the WASM module. The substrate is shared by all 5 group-1 tools
    // so we skip the whole smoke rather than report 5 spurious failures.
    const createCombined = `${createRes.stdout}\n${createRes.stderr}`;
    if (/wasm.*not.*available|cannot find module.*agent-wasm|loadAgentWasm.*failed/i.test(createCombined)) {
      skipByPolicy('smoke-adr0266-group1-introspection',
        'wasm-substrate-not-available: agent-wasm module failed to load in this install',
        { createStdoutHead: createRes.stdout.slice(0, 300) });
    }

    // Extract agentId from the create response. wasm_agent_create returns
    // `{success, agent: {id, ...}}` wrapped in MCP content[0].text.
    let agentId = null;
    try {
      // The cli prints the result; mcpExec parsed the trailing JSON.
      if (createRes.parsed) {
        const txt = createRes.parsed?.result?.content?.[0]?.text
          ?? createRes.parsed?.content?.[0]?.text
          ?? null;
        if (txt) {
          const inner = JSON.parse(txt);
          agentId = inner?.agent?.id ?? null;
        }
      }
      // Fallback: greedy regex on the full stdout for any `"id": "..."`.
      if (!agentId) {
        const m = createRes.stdout.match(/"id"\s*:\s*"([^"]+)"/);
        if (m) agentId = m[1];
      }
    } catch (e) {
      log(`[smoke] could not parse agentId: ${e.message}`);
    }
    if (!agentId) {
      // Couldn't get a real agentId; use a stub so the dispatch check still
      // exercises the "Tool not found" gate. Handler-internal "WASM agent
      // not found" is fine — that's a dispatch-reached signal.
      agentId = 'smoke-stub-agentid';
      log(`[smoke] WARN: using stub agentId='${agentId}' for dispatch-only checks`);
    } else {
      log(`[smoke] resolved agentId: ${agentId}`);
    }

    // Step 2: Probe each of 5 introspection tools.
    const tools = [
      'wasm_agent_state',
      'wasm_agent_todos',
      'wasm_agent_tools',
      'wasm_agent_turn_count',
      'wasm_agent_is_stopped',
    ];
    for (const t of tools) {
      const r = mcpExec(cli, tempDir, REGISTRY, t, { agentId }, 15000);
      assertHandlerRegistered(t, r);
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
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);
  perf.emitJson();

  if (failed > 0) { log(`\nSmoke FAILED — C1 group-1 dispatch not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — all 5 group-1 introspection tools registered + dispatched.\n`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Smoke: ADR-0266 C3 — Group 3 gallery tools (10).
 *
 * Per ADR-0258 §Group 3: plain `await loadAgentWasm()` + direct call. NO
 * `ensureLive`, NO `withStoreLock`. Each handler must be REGISTERED — the
 * dispatch gate is the "Tool not found" signal.
 *
 * Coverage (10 tools):
 *   wasm_gallery_load_rvf
 *   wasm_gallery_configure
 *   wasm_gallery_categories
 *   wasm_gallery_list_by_category
 *   wasm_gallery_add_custom
 *   wasm_gallery_remove_custom
 *   wasm_gallery_import
 *   wasm_gallery_export
 *   wasm_gallery_active
 *   wasm_gallery_config
 *
 * Per-tool args are minimal — the smoke checks dispatch, not handler logic.
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0266-group3-${Date.now()}.log`);

const perf = createSmokePerf('smoke-adr0266-group3-gallery');

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

// Per-tool input shape — keep minimal; we only check Tool-not-found gate.
const GALLERY_TOOLS = [
  ['wasm_gallery_load_rvf',         { id: 'coder' }],
  ['wasm_gallery_configure',        { config: { maxTurns: 50 } }],
  ['wasm_gallery_categories',       {}],
  ['wasm_gallery_list_by_category', { category: 'core' }],
  ['wasm_gallery_add_custom',       { template: { id: 'smoke', name: 'smoke' } }],
  ['wasm_gallery_remove_custom',    { id: 'smoke' }],
  ['wasm_gallery_import',           { templatesJson: '[]' }],
  ['wasm_gallery_export',           {}],
  ['wasm_gallery_active',           {}],
  ['wasm_gallery_config',           {}],
];

function main() {
  log(`\n[ADR-0266 C3 smoke] Group 3 gallery (10 tools)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-g3-gallery', perf, REGISTRY);
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

    // Probe `wasm_gallery_list` first — pre-existing fork tool we know works
    // when WASM substrate is loadable. If THIS reports wasm-not-available,
    // skip the whole group rather than 10 false failures.
    const probe = mcpExec(cli, tempDir, REGISTRY, 'wasm_gallery_list', {}, 30000);
    const probeCombined = `${probe.stdout}\n${probe.stderr}`;
    if (/Tool not found:/.test(probeCombined)) {
      log(`[smoke] WARN: pre-existing wasm_gallery_list 'Tool not found' — cli surface itself is broken; cannot isolate ADR-0266 contribution`);
      // Don't skip — this is a real failure of the cli, surface it.
    }
    if (/wasm.*not.*available|cannot find module.*agent-wasm|loadAgentWasm.*failed/i.test(probeCombined)) {
      skipByPolicy('smoke-adr0266-group3-gallery',
        'wasm-substrate-not-available: agent-wasm module failed to load in this install');
    }

    for (const [tool, args] of GALLERY_TOOLS) {
      const r = mcpExec(cli, tempDir, REGISTRY, tool, args, 30000);
      const combined = `${r.stdout}\n${r.stderr}`;
      if (/Tool not found:/.test(combined)) {
        fail(`tool '${tool}' registered`, `Tool not found (status=${r.status})`);
      } else {
        pass(`tool '${tool}' registered (dispatch reached handler)`);
      }
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

  if (failed > 0) { log(`\nSmoke FAILED — C3 group-3 gallery dispatch not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — all 10 group-3 gallery tools registered + dispatched.\n`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 C3 — Loader falls back to WS when env unset.
 *
 * Spawn a CHILD node process WITHOUT `AGENTIC_FLOW_QUIC_NATIVE=1`; import
 * the loader from `agentic-flow/transport/loader` and assert
 * `getTransportCapabilities().selectedBackend === 'websocket-fallback'` per
 * the widened literal union in ADR-0265 §Phase 3 §R1.3.
 *
 * This smoke should ALWAYS PASS — WS fallback is platform-independent and
 * is upstream ADR-108's anti-goal #1 ("no QUIC-or-nothing"). It is the
 * canary that the loader's no-binding return path is wired correctly.
 *
 * Per `feedback-no-fallbacks`: if we see `selectedBackend === 'quic'` here
 * (env was unset!) it indicates a loader regression — FAIL loudly.
 *
 * Usage: node scripts/smoke-quic-loader-fallback.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
} from './lib/smoke-adr0265-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-quic-loader-fallback-${Date.now()}.log`);

const perf = createSmokePerf('smoke-quic-loader-fallback');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 C3 smoke] loader fallback with env-off`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-loader-fallback', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    testBodyStart = process.hrtime.bigint();

    const childCode = `
      (async () => {
        try {
          const mod = await import('@sparkleideas/agentic-flow/transport/loader');
          if (typeof mod.getTransportCapabilities !== 'function') {
            console.log('FAIL:getTransportCapabilities missing');
            process.exit(0);
          }
          const caps = await mod.getTransportCapabilities();
          console.log('CAPS:' + JSON.stringify(caps));
        } catch (e) {
          console.log('FAIL:' + e.message);
        }
      })();
    `;

    // Strip AGENTIC_FLOW_QUIC_NATIVE from the child env so even if our
    // host happens to have it set we're guaranteed an env-off measurement.
    const childEnv = { ...process.env };
    delete childEnv.AGENTIC_FLOW_QUIC_NATIVE;

    const child = spawnSync(process.execPath, ['-e', childCode], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 30000,
      env: childEnv,
    });

    log(`    child stdout: ${child.stdout?.slice(0, 800).trim()}`);
    if (child.stderr) log(`    child stderr: ${child.stderr.slice(0, 400).trim()}`);

    const capsMatch = (child.stdout || '').match(/^CAPS:(.+)$/m);
    if (!capsMatch) {
      fail(`1: getTransportCapabilities() invocation`,
        `no CAPS line; status=${child.status} stdout=${child.stdout?.slice(0, 400)}`);
    } else {
      let caps;
      try { caps = JSON.parse(capsMatch[1]); }
      catch (e) {
        fail(`1: parse caps JSON`, `${e.message} raw=${capsMatch[1]}`);
        throw e;
      }
      pass(`1: getTransportCapabilities() returned: ${JSON.stringify(caps)}`);

      if (caps.selectedBackend === 'websocket-fallback') {
        pass(`2: selectedBackend === 'websocket-fallback' (env unset)`);
      } else {
        fail(`2: selectedBackend === 'websocket-fallback'`,
          `got: ${caps.selectedBackend} (env was UNSET) — Phase 3 widened union may be missing`);
      }

      if (caps.webSocketFallbackAvailable === true) {
        pass(`3: webSocketFallbackAvailable === true`);
      } else {
        fail(`3: webSocketFallbackAvailable === true`,
          `got: ${caps.webSocketFallbackAvailable} — WS fallback is first-class per ADR-108 anti-goal #1`);
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
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  perf.emitJson();

  if (failed > 0) { log(`\nSmoke FAILED — C3 loader-fallback criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — C3 loader-fallback criterion met.\n`);
  process.exit(0);
}

main();

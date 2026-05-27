#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 4 — Built-in TLS 1.3 encryption.
 *
 * With `AGENTIC_FLOW_QUIC_NATIVE=1` and Phase-2a binding loaded, assert
 * `getTransportCapabilities().tlsVersion === 'TLS_1_3'` when
 * `selectedBackend === 'quic'`.
 *
 * Confidence: HIGH (rustls + quinn → TLS 1.3-only by RFC 9001).
 * Tautological per §R1.11 — passing this smoke is the typed-constant return
 * contract holding, not a measurement.
 *
 * If env-on unavailable, `skip-by-policy: native-binding-unavailable`.
 *
 * Usage: node scripts/smoke-quic-tls13.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  requireNativeBindingOrSkip,
  hostPlatformTriple,
  PHASE_2A_PLATFORMS,
  skipByPolicy,
} from './lib/smoke-adr0265-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-quic-tls13-${Date.now()}.log`);

const perf = createSmokePerf('smoke-quic-tls13');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 tls13 smoke] tlsVersion assertion`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('smoke-quic-tls13',
      `native-binding-unavailable-on-this-host: ${triple} not in Phase-2a`,
      { triple });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-tls13', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    requireNativeBindingOrSkip(tempDir, 'smoke-quic-tls13');
    testBodyStart = process.hrtime.bigint();

    const childCode = `
      (async () => {
        try {
          const loader = await import('@sparkleideas/agentic-flow/transport/loader');
          const caps = await loader.getTransportCapabilities();
          console.log('CAPS:' + JSON.stringify(caps));
        } catch (e) {
          console.log('FAIL:' + e.message);
        }
      })();
    `;

    const child = spawnSync(process.execPath, ['-e', childCode], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, AGENTIC_FLOW_QUIC_NATIVE: '1' },
    });

    log(`    child stdout: ${child.stdout?.slice(0, 600).trim()}`);
    if (child.stderr) log(`    child stderr: ${child.stderr.slice(0, 400).trim()}`);

    const capsMatch = (child.stdout || '').match(/^CAPS:(.+)$/m);
    if (!capsMatch) {
      fail(`1: getTransportCapabilities() invocation`,
        `no CAPS line; status=${child.status}`);
    } else {
      let caps;
      try { caps = JSON.parse(capsMatch[1]); }
      catch (e) { fail(`1: parse caps JSON`, e.message); throw e; }

      if (caps.selectedBackend !== 'quic') {
        skipByPolicy('smoke-quic-tls13',
          `native-binding-unavailable: loader selected ${caps.selectedBackend} despite env-on`,
          { observedBackend: caps.selectedBackend });
      }

      if (caps.tlsVersion === 'TLS_1_3') {
        pass(`1: tlsVersion === 'TLS_1_3' (rustls/quinn invariant)`);
      } else {
        fail(`1: tlsVersion === 'TLS_1_3'`,
          `got: ${caps.tlsVersion} — should be 'TLS_1_3' per RFC 9001 (quinn requires TLS 1.3)`);
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

  if (failed > 0) { log(`\nSmoke FAILED — tls13 criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — tls13 criterion met.\n`);
  process.exit(0);
}

main();

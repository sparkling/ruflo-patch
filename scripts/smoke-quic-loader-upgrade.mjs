#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 C2 — Loader auto-upgrades when env var + binding present.
 *
 * Spawn a CHILD node process with `AGENTIC_FLOW_QUIC_NATIVE=1`; have it
 * import the loader from `agentic-flow/transport/loader` and call
 * `getTransportCapabilities()`. Assert the returned `selectedBackend ===
 * 'quic'` (per §Cross-package symbol contracts).
 *
 * If the binding is unavailable on this host (non-Phase-2a or load failure),
 * `skip-by-policy: native-binding-unavailable-on-this-host`.
 *
 * Per ADR-0265 §Phase 3 §R1.5: the loader's `loadQuicTransport()` return
 * statement is the upgrade trigger. This smoke exercises the substrate
 * (env-var + binding present) that causes the return path to flip.
 *
 * Usage: node scripts/smoke-quic-loader-upgrade.mjs
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
  hostPlatformTriple,
  PHASE_2A_PLATFORMS,
  nativeBindingPackage,
  skipByPolicy,
} from './lib/smoke-adr0265-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-quic-loader-upgrade-${Date.now()}.log`);

const perf = createSmokePerf('smoke-quic-loader-upgrade');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 C2 smoke] loader upgrade with env-on + binding`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  const pkg = nativeBindingPackage(triple);
  log(`[smoke] host triple: ${triple}`);

  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('smoke-quic-loader-upgrade',
      `native-binding-unavailable-on-this-host: ${triple} not in Phase-2a`,
      { triple });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-loader-upgrade', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    testBodyStart = process.hrtime.bigint();

    // Pre-flight: confirm the binding actually loads (or we skip with an
    // accurate reason). Smokes do not silently confuse "binding missing"
    // with "loader chose WS".
    const preflight = spawnSync(process.execPath, [
      '-e',
      `try { require(${JSON.stringify(pkg)}); console.log('ok'); } catch (e) { console.log('FAIL:' + e.message); }`,
    ], { cwd: tempDir, encoding: 'utf8', timeout: 30000 });

    if (!/^ok$/m.test(preflight.stdout || '')) {
      skipByPolicy('smoke-quic-loader-upgrade',
        `native-binding-unavailable-on-this-host: require(${pkg}) failed`,
        { triple, preflightStdout: preflight.stdout?.slice(0, 200) });
    }
    pass(`0a: binding pre-flight require succeeded`);

    // Probe the loader. Per §Cross-package symbol contracts the import path
    // is `agentic-flow/transport/loader` (esm) and the return shape includes
    // `selectedBackend: 'quic' | 'websocket' | 'websocket-fallback'`.
    const childCode = `
      (async () => {
        try {
          const mod = await import('agentic-flow/transport/loader');
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

    const child = spawnSync(process.execPath, ['-e', childCode], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, AGENTIC_FLOW_QUIC_NATIVE: '1' },
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

      if (caps.selectedBackend === 'quic') {
        pass(`2: selectedBackend === 'quic'`);
      } else {
        fail(`2: selectedBackend === 'quic'`,
          `got: ${caps.selectedBackend} (env was AGENTIC_FLOW_QUIC_NATIVE=1)`);
      }

      // Bonus assertion (non-fatal): when QUIC selected, tlsVersion should be TLS_1_3
      // (rustls + quinn → TLS-1.3-only per RFC 9001).
      if (caps.selectedBackend === 'quic' && caps.tlsVersion === 'TLS_1_3') {
        pass(`3: tlsVersion === 'TLS_1_3' (rustls/quinn invariant)`);
      } else if (caps.selectedBackend === 'quic') {
        log(`  WARN  tlsVersion not asserted: got ${caps.tlsVersion} (C2 still pass; tls13 smoke covers this)`);
      }
    }

  } catch (err) {
    log(`[smoke] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  perf.emitJson();

  if (failed > 0) { log(`\nSmoke FAILED — C2 loader-upgrade criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — C2 loader-upgrade criterion met.\n`);
  process.exit(0);
}

main();

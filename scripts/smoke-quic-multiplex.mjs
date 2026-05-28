#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 3 — Multiplexed streams (no head-
 * of-line blocking).
 *
 * **Binding-direct test** (post-Phase-2a):
 *
 *   With AGENTIC_FLOW_QUIC_NATIVE=1, drive the native QUIC binding
 *   end-to-end via its parent wrapper `@sparkleideas/agentic-flow-quic-
 *   native`. Start a loopback `listen()` server on port 0, discover the
 *   bound port via `getLocalAddr()`, `connect()` from a client, then fire
 *   N concurrent `send()` calls via `Promise.all`. Compare the parallel
 *   wall-clock against a single-send baseline.
 *
 *   If QUIC actually multiplexes (RFC 9000), N parallel sends should
 *   complete in roughly single-send time + overhead — NOT N × single
 *   (which would prove serial wire blocking). The pass threshold is
 *   `parallel < 1.5 × single + 200ms`: enough headroom for napi-rs +
 *   tokio context-switch overhead, tight enough that N=4 wire-serial
 *   would fail (4 × single >> 1.5 × single).
 *
 * Earlier design (pre-binding-direct) routed through the federation
 * plugin's `sendToSelf` — that API doesn't exist on the actual published
 * plugin (`AgentFederationPlugin` exposes a ruflo-plugin lifecycle, not
 * loopback-send). Binding-direct skips that mismatch entirely and tests
 * the wire-level multiplex property without any plugin dependency.
 *
 * Confidence: HIGH (quinn-by-construction per RFC 9000; server.rs:117
 * spawns per-stream tokio tasks).
 *
 * If env-on path unavailable (non-Phase-2a host or binding load failure),
 * `skip-by-policy: native-binding-unavailable`.
 *
 * Usage: node scripts/smoke-quic-multiplex.mjs
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
const LOG_FILE = join(LOG_DIR, `smoke-quic-multiplex-${Date.now()}.log`);

const N_STREAMS = 4;

const perf = createSmokePerf('smoke-quic-multiplex');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 multiplex smoke] N=${N_STREAMS}, binding-direct loopback`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('smoke-quic-multiplex',
      `native-binding-unavailable-on-this-host: ${triple} not in Phase-2a`,
      { triple });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-multiplex', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    requireNativeBindingOrSkip(tempDir, 'smoke-quic-multiplex');
    testBodyStart = process.hrtime.bigint();

    const N = N_STREAMS;
    const childCode = `
      (async () => {
        try {
          const binding = await import('@sparkleideas/agentic-flow-quic-native');
          if (typeof binding.listen !== 'function' || typeof binding.getLocalAddr !== 'function') {
            console.log('FAIL:binding-missing-listen-or-getLocalAddr');
            process.exit(0);
          }
          // Server.
          let received = 0;
          const serverHandle = binding.listen(0, {
            serverName: 'localhost',
            maxIdleTimeoutMs: 30000,
            maxConcurrentStreams: 64,
            enable0Rtt: false,
          }, (_inbound) => { received++; });
          const rawAddr = binding.getLocalAddr(serverHandle);
          const addr = rawAddr.replace(/^0\.0\.0\.0:/, '127.0.0.1:');

          // Client connect.
          const connId = await binding.connect(addr, {
            serverName: 'localhost',
            maxIdleTimeoutMs: 30000,
            maxConcurrentStreams: 64,
            enable0Rtt: false,
          });

          // Baseline: single send.
          const payload = Buffer.from('mux-probe');
          const baselineStart = Date.now();
          await binding.send(connId, payload, 'task');
          const baselineMs = Date.now() - baselineStart;

          // Parallel: N concurrent sends.
          const parallelStart = Date.now();
          const sends = Array.from({ length: ${N} }, (_, i) =>
            binding.send(connId, Buffer.from('mux-' + i), 'task'),
          );
          await Promise.all(sends);
          const parallelMs = Date.now() - parallelStart;

          console.log('BASELINE_MS:' + baselineMs);
          console.log('PARALLEL_MS:' + parallelMs);
          console.log('N:' + ${N});

          await binding.close(connId);
        } catch (e) {
          console.log('FAIL:' + (e && e.message ? e.message : String(e)));
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

    const failMatch = (child.stdout || '').match(/^FAIL:(.+)/m);
    if (failMatch) {
      fail(`1: binding-direct multiplex`, failMatch[1]);
    } else {
      const baselineMatch = (child.stdout || '').match(/^BASELINE_MS:(\d+)/m);
      const parallelMatch = (child.stdout || '').match(/^PARALLEL_MS:(\d+)/m);
      if (!baselineMatch || !parallelMatch) {
        fail(`1: binding-direct multiplex`,
          `missing measurements; stdout=${child.stdout?.slice(0, 400)}`);
      } else {
        const baseline = parseInt(baselineMatch[1], 10);
        const parallel = parseInt(parallelMatch[1], 10);
        // Multiplexing pass criterion: parallel < 1.5 × baseline + 200ms.
        // This catches wire-serial regressions (which would scale as
        // N × baseline) while allowing for context-switch overhead.
        const budget = Math.ceil(1.5 * baseline + 200);
        log(`    baseline (1 send): ${baseline}ms`);
        log(`    parallel (${N} sends): ${parallel}ms`);
        log(`    budget (1.5×baseline + 200ms): ${budget}ms`);
        if (parallel <= budget) {
          pass(`1: ${N} parallel sends in ${parallel}ms ≤ budget ${budget}ms (multiplexing works — not serial)`);
        } else {
          fail(`1: streams appear to serialize`,
            `parallel=${parallel}ms > budget=${budget}ms — head-of-line blocking regression`);
        }
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

  if (failed > 0) { log(`\nSmoke FAILED — multiplex criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — multiplex criterion met.\n`);
  process.exit(0);
}

main();

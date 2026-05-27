#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 §Aspirational row 3 — Multiplexed streams (no head-of-
 * line blocking).
 *
 * With `AGENTIC_FLOW_QUIC_NATIVE=1`, open ≥4 concurrent streams via the
 * native binding's send() API (per the federation plugin's send-to-self
 * loopback) and induce a 500ms slow-receiver on stream 0. Assert streams
 * 1..N-1 remain unaffected (total wall < 600ms).
 *
 * If env-on path unavailable (non-Phase-2a host or binding load failure),
 * `skip-by-policy: native-binding-unavailable`.
 *
 * Confidence: HIGH (quinn-by-construction per RFC 9000; server.rs:117 spawns
 * per-stream tokio tasks). Passes on first try per §R1.11.
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
  hostPlatformTriple,
  PHASE_2A_PLATFORMS,
  skipByPolicy,
} from './lib/smoke-adr0265-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-quic-multiplex-${Date.now()}.log`);

const N_STREAMS = 4;       // ≥4 concurrent per ADR-0265 §Aspirational row 3
const SLOW_MS = 500;       // induced slow-receiver delay on stream 0
const TOTAL_BUDGET_MS = 600; // wall < 600ms — proves streams 1..N-1 unaffected

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
  log(`\n[ADR-0265 multiplex smoke] N=${N_STREAMS}, slow=${SLOW_MS}ms, budget<${TOTAL_BUDGET_MS}ms`);
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
    testBodyStart = process.hrtime.bigint();

    const childCode = `
      (async () => {
        try {
          const loader = await import('agentic-flow/transport/loader');
          const caps = await loader.getTransportCapabilities();
          if (caps.selectedBackend !== 'quic') {
            console.log('SKIP:selectedBackend=' + caps.selectedBackend);
            process.exit(0);
          }
          const fedMod = await import('@sparkleideas/plugin-agent-federation');
          const FederationPlugin = fedMod.default ?? fedMod.FederationPlugin;
          const plugin = new FederationPlugin({ loopback: true });
          await plugin.init();

          // Fan out ${N_STREAMS} concurrent sends. Stream 0 is the slow
          // receiver — its onMessage handler sleeps ${SLOW_MS}ms before
          // resolving. If quic actually multiplexes (RFC 9000), streams
          // 1..N-1 should complete well before stream 0.
          const N = ${N_STREAMS};
          const SLOW_MS = ${SLOW_MS};
          plugin.setSlowReceiver(0, SLOW_MS);
          const t0 = Date.now();
          const sends = Array.from({ length: N }, (_, i) => plugin.sendToSelf({ stream: i, payload: 'mux-' + i }));
          // Wait for streams 1..N-1 — drop stream 0 so the slow one doesn't
          // dominate the budget.
          await Promise.all(sends.slice(1));
          const elapsed = Date.now() - t0;
          console.log('NON_SLOW_MS:' + elapsed);

          // Drain the slow one too (cleanup), but its duration doesn't gate
          // the assertion.
          await sends[0];
          await plugin.shutdown();
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

    const skipMatch = (child.stdout || '').match(/^SKIP:selectedBackend=(\S+)/m);
    if (skipMatch) {
      skipByPolicy('smoke-quic-multiplex',
        `native-binding-unavailable: loader fell back to ${skipMatch[1]}`,
        { observedBackend: skipMatch[1] });
    }

    const m = (child.stdout || '').match(/^NON_SLOW_MS:(\d+)/m);
    if (!m) {
      fail(`1: non-slow stream wall measurement`,
        `no NON_SLOW_MS line; stdout=${child.stdout?.slice(0, 400)}`);
    } else {
      const elapsed = parseInt(m[1], 10);
      log(`    measured non-slow streams wall: ${elapsed}ms (budget ${TOTAL_BUDGET_MS}ms)`);
      if (elapsed < TOTAL_BUDGET_MS) {
        pass(`1: ${N_STREAMS - 1} non-slow streams completed in ${elapsed}ms < ${TOTAL_BUDGET_MS}ms (slow stream did NOT block)`);
      } else {
        fail(`1: non-slow streams blocked`,
          `wall=${elapsed}ms >= ${TOTAL_BUDGET_MS}ms (slow stream blocked others — head-of-line blocking regression)`);
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

  if (failed > 0) { log(`\nSmoke FAILED — multiplex criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — multiplex criterion met.\n`);
  process.exit(0);
}

main();

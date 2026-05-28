#!/usr/bin/env node
/**
 * Benchmark: ADR-0265 C6 — QUIC federation transport targets.
 *
 * **Binding-direct measurement** (post-Phase-2a):
 *
 *   - T1 latency: 200 sequential `send()` calls on a single connection;
 *     measure wall-clock per send (send-start → onMessage-fire on the
 *     loopback server). Compute p50 / p99.
 *     Target: **p99 < 5ms on localhost loopback** (§Aspirational row 1,
 *     tightened per §Revision 1).
 *
 *   - T2 fan-out: open 100 concurrent connections to the same loopback
 *     server; measure total setup wall-clock. Pass if all succeed.
 *     Target: **100 concurrent agent connections** (§Aspirational row 5).
 *
 *   Aspirational row 1's "sub-ms" claim is loopback-only; cross-host is
 *   RTT-bound. p99 < 5ms localhost is the actual measurable target.
 *
 *   Cross-host figures are observational, NOT pass/fail.
 *
 * Output: writes measured + targets + pass/fail to
 *   `test-results/bench-quic-<timestamp>/benchmark-quic.json`
 *
 * If env-on path unavailable, `skip-by-policy`.
 *
 * Usage: node scripts/benchmark-quic-federation.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  requireNativeBindingOrSkip,
  hostPlatformTriple,
  PHASE_2A_PLATFORMS,
  skipByPolicy,
} from './lib/smoke-adr0265-shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `benchmark-quic-${Date.now()}.log`);
const RESULTS_DIR = join(ROOT, 'test-results', `bench-quic-${new Date().toISOString().replace(/[:.]/g, '')}`);

const TARGETS = {
  p99_loopback_ms: 5,
  fanout_connections: 100,
};

const T1_SAMPLES = 200;
const T2_CONNECTIONS = 100;

const perf = createSmokePerf('benchmark-quic-federation');

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function main() {
  log(`\n[ADR-0265 benchmark] QUIC federation transport`);
  log(`[bench] log file: ${LOG_FILE}`);
  log(`[bench] results dir: ${RESULTS_DIR}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('bench-quic',
      `native-binding-unavailable-on-this-host: ${triple} not in Phase-2a`,
      { triple });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('bench-quic', perf, REGISTRY);
  log(`[bench] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  const result = {
    smoke: 'benchmark-quic-federation',
    timestamp: new Date().toISOString(),
    triple,
    targets: TARGETS,
    measured: {},
    pass: false,
    failures: [],
  };

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    requireNativeBindingOrSkip(tempDir, 'bench-quic');
    testBodyStart = process.hrtime.bigint();

    const childCode = `
      (async () => {
        try {
          const binding = await import('@sparkleideas/agentic-flow-quic-native');
          if (typeof binding.listen !== 'function' || typeof binding.getLocalAddr !== 'function') {
            console.log('FAIL:binding-missing-listen-or-getLocalAddr');
            process.exit(0);
          }
          const config = {
            serverName: 'localhost',
            maxIdleTimeoutMs: 60000,
            maxConcurrentStreams: 256,
            enable0Rtt: false,
          };
          const inbox = [];
          const serverHandle = binding.listen(0, config, (_inbound) => {
            const resolve = inbox.shift();
            if (resolve) resolve();
          });
          const rawAddr = binding.getLocalAddr(serverHandle);
          const addr = rawAddr.replace(/^0\.0\.0\.0:/, '127.0.0.1:');
          const connId = await binding.connect(addr, config);

          // Warm-up.
          for (let i = 0; i < 5; i++) {
            const p = new Promise((r) => inbox.push(r));
            await binding.send(connId, Buffer.from('warm-' + i), 'task');
            await p;
          }

          // T1 latency measurement.
          const samples = [];
          for (let i = 0; i < ${T1_SAMPLES}; i++) {
            const p = new Promise((r) => inbox.push(r));
            const t0 = process.hrtime.bigint();
            await binding.send(connId, Buffer.from('m-' + i), 'task');
            await p;
            const t1 = process.hrtime.bigint();
            samples.push(Number(t1 - t0) / 1e6);
          }
          samples.sort((a, b) => a - b);
          const p50 = samples[Math.floor(samples.length * 0.5)];
          const p99 = samples[Math.floor(samples.length * 0.99)];
          console.log('T1:' + JSON.stringify({ p50_ms: p50, p99_ms: p99, samples: samples.length }));

          // T2 fan-out.
          const fanoutStart = process.hrtime.bigint();
          const fanoutConns = await Promise.all(
            Array.from({ length: ${T2_CONNECTIONS} }, () =>
              binding.connect(addr, config).catch((e) => ({ error: e && e.message ? e.message : String(e) })),
            ),
          );
          const fanoutMs = Number(process.hrtime.bigint() - fanoutStart) / 1e6;
          const okCount = fanoutConns.filter((c) => typeof c === 'number').length;
          console.log('T2:' + JSON.stringify({ wall_ms: fanoutMs, connections: okCount }));

          await binding.closeAll();
        } catch (e) {
          console.log('FAIL:' + (e && e.message ? e.message : String(e)));
        }
      })();
    `;

    const child = spawnSync(process.execPath, ['-e', childCode], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, AGENTIC_FLOW_QUIC_NATIVE: '1' },
    });

    log(`    child stdout: ${child.stdout?.slice(0, 1200).trim()}`);
    if (child.stderr) log(`    child stderr: ${child.stderr.slice(0, 400).trim()}`);

    const failMatch = (child.stdout || '').match(/^FAIL:(.+)/m);
    if (failMatch) {
      result.failures.push(`binding-direct measurement: ${failMatch[1]}`);
    } else {
      const t1Match = (child.stdout || '').match(/^T1:(.+)/m);
      const t2Match = (child.stdout || '').match(/^T2:(.+)/m);
      if (t1Match) result.measured.t1 = JSON.parse(t1Match[1]);
      else result.failures.push('T1 latency measurement missing');
      if (t2Match) result.measured.t2 = JSON.parse(t2Match[1]);
      else result.failures.push('T2 fan-out measurement missing');

      if (result.measured.t1) {
        const p99 = result.measured.t1.p99_ms;
        if (p99 < TARGETS.p99_loopback_ms) {
          log(`    T1 p99: ${p99.toFixed(3)}ms < ${TARGETS.p99_loopback_ms}ms target`);
        } else {
          result.failures.push(`T1 p99=${p99.toFixed(3)}ms >= ${TARGETS.p99_loopback_ms}ms target`);
        }
      }
      if (result.measured.t2) {
        const conns = result.measured.t2.connections;
        if (conns >= TARGETS.fanout_connections) {
          log(`    T2 fan-out: ${conns}/${TARGETS.fanout_connections} connections (wall ${result.measured.t2.wall_ms.toFixed(1)}ms)`);
        } else {
          result.failures.push(`T2 fan-out=${conns}/${TARGETS.fanout_connections} (missing ${TARGETS.fanout_connections - conns})`);
        }
      }
    }

    result.pass = result.failures.length === 0;
  } catch (err) {
    log(`[bench] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    result.failures.push(`fatal: ${err.message}`);
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  const outPath = join(RESULTS_DIR, 'benchmark-quic.json');
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  log(`\n[bench] results: ${outPath}`);
  log(JSON.stringify(result));

  perf.emitJson();

  if (result.pass) {
    log(`\nBenchmark PASSED — all targets met.\n`);
    process.exit(0);
  }
  log(`\nBenchmark FAILED — failures: ${result.failures.join('; ')}\n`);
  process.exit(1);
}

main();

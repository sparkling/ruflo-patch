#!/usr/bin/env node
/**
 * Benchmark: ADR-0265 §Phase 5 — QUIC federation transport.
 *
 * Measures the two CI-pass-criterion metrics from §Aspirational rows 1 + 5:
 *   T1 — latency:   loopback round-trip p50 / p95 / p99. Target p99 < 5ms.
 *   T2 — fan-out:   100 concurrent agent connections succeed (CI threshold).
 *
 * Mirrors upstream `agentic-flow/benchmarks/quic-transport.bench.ts` in
 * shape but exercises the FORK-side N-API path via the federation plugin's
 * send-to-self loopback (the binding is loaded transparently by the loader
 * when AGENTIC_FLOW_QUIC_NATIVE=1).
 *
 * Output:
 *   - stdout: human-readable + final benchmark JSON line
 *   - file:   test-results/<timestamp>/benchmark-quic.json
 *
 * If env-on path unavailable (non-Phase-2a host or binding load failure),
 * the bench emits a `skip_accepted` JSON line with the reason and exits 0
 * (the harness records it as a skip; CI gate is on smokes wired, not on
 * bench passing).
 *
 * Per `feedback-no-tail-tests`: full output tees to LOG_FILE; never pipes
 * through tail/head.
 * Per the canonical pattern in scripts/benchmark-graph.mjs T3: hot loops
 * import the federation plugin in-process to avoid per-iteration cli
 * bootstrap (~480ms/probe via spawn). We DO spawn-once per benchmark run
 * (env on/off must be set at process boundary), but the iterations run
 * inside that single child.
 *
 * Usage: node scripts/benchmark-quic-federation.mjs
 *
 * Exit codes:
 *   0 — benchmarks ran (PASS or SKIP)
 *   1 — benchmarks failed to meet targets (p99 ≥ 5ms loopback, or fan-out
 *       <100 succeeded) on a Phase-2a host
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync, appendFileSync } from 'node:fs';
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
const LOG_FILE = join(LOG_DIR, `benchmark-quic-${Date.now()}.log`);

const TS = new Date().toISOString().replace(/[:.]/g, '');
const RESULTS_DIR = process.env.BENCH_RESULTS_DIR ||
  join(process.cwd(), 'test-results', `bench-quic-${TS}`);

// CI pass criteria per ADR-0265 §C6 / §Aspirational rows 1 + 5
const TARGET_P99_MS = 5;
const TARGET_FANOUT_CONNECTIONS = 100;
const LATENCY_ITERATIONS = 200;

const perf = createSmokePerf('benchmark-quic-federation');

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function main() {
  log(`\n[ADR-0265 benchmark] QUIC federation transport`);
  log(`[bench] log file: ${LOG_FILE}`);
  log(`[bench] results dir: ${RESULTS_DIR}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('benchmark-quic-federation',
      `native-binding-unavailable-on-this-host: ${triple} not in Phase-2a`,
      { triple });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('bench-quic', perf, REGISTRY);
  log(`[bench] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  const results = {
    smoke: 'benchmark-quic-federation',
    timestamp: new Date().toISOString(),
    triple,
    targets: {
      p99_loopback_ms: TARGET_P99_MS,
      fanout_connections: TARGET_FANOUT_CONNECTIONS,
    },
    measured: {},
    pass: false,
    failures: [],
  };

  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    requireNativeBindingOrSkip(tempDir, 'bench-quic');
    testBodyStart = process.hrtime.bigint();

    // Single child process — drives BOTH T1 (latency) and T2 (fan-out).
    // Per scripts/benchmark-graph.mjs T3 pattern: in-process iteration loop;
    // avoid per-iteration cli bootstrap.
    const childCode = `
      (async () => {
        try {
          const loader = await import('@sparkleideas/agentic-flow/transport/loader');
          const caps = await loader.getTransportCapabilities();
          if (caps.selectedBackend !== 'quic') {
            console.log('SKIP:selectedBackend=' + caps.selectedBackend);
            process.exit(0);
          }

          const fedMod = await import('@sparkleideas/plugin-agent-federation');
          const FederationPlugin = fedMod.default ?? fedMod.FederationPlugin;

          // T1: latency — ${LATENCY_ITERATIONS} sequential send-to-self
          // round-trips on loopback. Measure each in ns precision.
          const plugin = new FederationPlugin({ loopback: true });
          await plugin.init();
          // warmup
          for (let i = 0; i < 20; i++) await plugin.sendToSelf({ warmup: i });
          const latencies = [];
          for (let i = 0; i < ${LATENCY_ITERATIONS}; i++) {
            const t = process.hrtime.bigint();
            await plugin.sendToSelf({ probe: i });
            latencies.push(Number(process.hrtime.bigint() - t) / 1_000_000);
          }
          console.log('T1:' + JSON.stringify(latencies));
          await plugin.shutdown();

          // T2: fan-out — open ${TARGET_FANOUT_CONNECTIONS} concurrent
          // connections via the federation plugin's connect API.
          const TARGET = ${TARGET_FANOUT_CONNECTIONS};
          const plugin2 = new FederationPlugin({ loopback: true });
          await plugin2.init();
          const connects = await Promise.allSettled(
            Array.from({ length: TARGET }, (_, i) =>
              plugin2.connectPeer({ peerId: 'bench-peer-' + i })
            )
          );
          const succeeded = connects.filter(r => r.status === 'fulfilled').length;
          console.log('T2:succeeded=' + succeeded + ' total=' + TARGET);
          await plugin2.shutdown();
        } catch (e) {
          console.log('FAIL:' + e.message);
        }
      })();
    `;

    const child = spawnSync(process.execPath, ['-e', childCode], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, AGENTIC_FLOW_QUIC_NATIVE: '1' },
    });

    log(`    child stdout: ${child.stdout?.slice(0, 800).trim()}`);
    if (child.stderr) log(`    child stderr: ${child.stderr.slice(0, 600).trim()}`);

    const skipMatch = (child.stdout || '').match(/^SKIP:selectedBackend=(\S+)/m);
    if (skipMatch) {
      skipByPolicy('benchmark-quic-federation',
        `native-binding-unavailable: loader fell back to ${skipMatch[1]} despite env-on`,
        { observedBackend: skipMatch[1] });
    }

    const t1Match = (child.stdout || '').match(/^T1:(\[.+\])$/m);
    if (!t1Match) {
      results.failures.push(`T1 latency measurement missing`);
    } else {
      const latencies = JSON.parse(t1Match[1]);
      const p50 = pct(latencies, 50);
      const p95 = pct(latencies, 95);
      const p99 = pct(latencies, 99);
      results.measured.latency = { p50_ms: p50, p95_ms: p95, p99_ms: p99,
        iterations: latencies.length };
      log(`    T1 latency: p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms (n=${latencies.length})`);
      if (p99 < TARGET_P99_MS) {
        log(`    T1 PASS: p99=${p99.toFixed(3)}ms < ${TARGET_P99_MS}ms target`);
      } else {
        results.failures.push(`T1 p99=${p99.toFixed(3)}ms >= ${TARGET_P99_MS}ms target`);
      }
    }

    const t2Match = (child.stdout || '').match(/^T2:succeeded=(\d+)\s+total=(\d+)/m);
    if (!t2Match) {
      results.failures.push(`T2 fan-out measurement missing`);
    } else {
      const succeeded = parseInt(t2Match[1], 10);
      const total = parseInt(t2Match[2], 10);
      results.measured.fanout = { succeeded, total };
      log(`    T2 fan-out: ${succeeded}/${total} connections succeeded`);
      if (succeeded >= TARGET_FANOUT_CONNECTIONS) {
        log(`    T2 PASS: ${succeeded} >= ${TARGET_FANOUT_CONNECTIONS} target`);
      } else {
        results.failures.push(`T2 succeeded=${succeeded} < ${TARGET_FANOUT_CONNECTIONS} target`);
      }
    }

    results.pass = results.failures.length === 0;

  } catch (err) {
    log(`[bench] FATAL exception: ${err.message}`);
    if (err.stack) log(err.stack);
    results.failures.push(`exception: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  const outPath = join(RESULTS_DIR, 'benchmark-quic.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  log(`\n[bench] results: ${outPath}`);
  process.stdout.write(JSON.stringify(results) + '\n');

  perf.emitJson();

  if (!results.pass) {
    log(`\nBenchmark FAILED — failures: ${results.failures.join('; ')}\n`);
    process.exit(1);
  }
  log(`\nBenchmark PASSED — p99 < ${TARGET_P99_MS}ms loopback; fan-out >= ${TARGET_FANOUT_CONNECTIONS}\n`);
  process.exit(0);
}

main();

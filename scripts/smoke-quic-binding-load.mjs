#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 C1 — N-API binding loads on host platform.
 *
 * Per ADR-0265 §Cross-package symbol contracts: the binding family is
 *   `@agentic-flow/quic-native-<platform-triple>`
 * where triple = `${process.platform}-${process.arch}{-gnu|-msvc}`.
 *
 * Behaviour:
 *   - On Phase-2a platforms (darwin-arm64, linux-x64-gnu): hard-asserts
 *     `require('@agentic-flow/quic-native-<triple>')` exits 0.
 *   - On non-Phase-2a platforms: `skip-by-policy: platform-not-published-yet`
 *     until Phase 2b lands the remaining 3 binaries.
 *
 * Per `feedback-no-fallbacks`: missing binding on Phase-2a host FAILS loudly
 * — no silent fallback. Per `feedback-skip-accepted-as-squelch`: non-Phase-2a
 * skip is a legitimate skip (binary genuinely not yet published).
 *
 * IMPORTANT: This smoke will FAIL until forks/agentic-flow Phase 1+2 publishes
 * the binding to Verdaccio. That is expected — Phase 5 (this) and Phase 1+2
 * land in different D-stages.
 *
 * Usage: node scripts/smoke-quic-binding-load.mjs
 *
 * Exit codes:
 *   0 — binding loaded OR skip-by-policy
 *   1 — Phase-2a host but binding load failed (real regression)
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
const LOG_FILE = join(LOG_DIR, `smoke-quic-binding-load-${Date.now()}.log`);

const perf = createSmokePerf('smoke-quic-binding-load');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 C1 smoke] N-API binding load probe`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const triple = hostPlatformTriple();
  const pkg = nativeBindingPackage(triple);
  log(`[smoke] host triple: ${triple}`);
  log(`[smoke] target package: ${pkg}`);

  if (!PHASE_2A_PLATFORMS.has(triple)) {
    skipByPolicy('smoke-quic-binding-load',
      `platform-not-published-yet: ${triple} is not in Phase-2a (darwin-arm64, linux-x64-gnu)`,
      { triple, phase2aPlatforms: Array.from(PHASE_2A_PLATFORMS) });
  }

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-binding-load', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    if (!shared) installAndInit(tempDir, perf, REGISTRY);
    testBodyStart = process.hrtime.bigint();

    // Probe via child node process: `require('<pkg>')` must succeed (exit 0).
    // We exec a one-liner via `node -e` so the loader resolution runs from
    // the smoke's tempDir, picking up the installed @agentic-flow/quic-native-*
    // via @sparkleideas/ruflo's optionalDependencies tree.
    const probe = spawnSync(process.execPath, [
      '-e',
      `const m = require(${JSON.stringify(pkg)}); if (!m) { throw new Error('binding loaded but exported nothing'); } console.log('binding-load-ok'); console.log('exports=' + Object.keys(m).sort().join(','));`,
    ], { cwd: tempDir, encoding: 'utf8', timeout: 30000 });

    if (probe.status === 0 && /binding-load-ok/.test(probe.stdout)) {
      pass(`1: require('${pkg}') succeeded`);
      log(`    stdout: ${probe.stdout.trim()}`);
    } else {
      fail(`1: require('${pkg}') failed`,
        `status=${probe.status} stdout=${probe.stdout?.slice(0, 500)} stderr=${probe.stderr?.slice(0, 500)}`);
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

  if (failed > 0) {
    log(`\nSmoke FAILED — C1 binding-load criterion not met.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — C1 binding-load criterion met.\n`);
  process.exit(0);
}

main();

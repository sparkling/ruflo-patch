#!/usr/bin/env node
/**
 * Smoke test: ADR-0265 C5 — Doctor surface reports correct backend.
 *
 * Per §Cross-package symbol contracts the doctor command is
 *   `cli doctor --component federation`
 * and the output must match `/selectedBackend=(quic|websocket-fallback)\b/`.
 *
 * Asserts the doctor command runs and its output contains a greppable
 * structured `HealthCheck.message` reporting either `selectedBackend=quic`
 * or `selectedBackend=websocket-fallback` depending on which backend was
 * picked. This satisfies §I8 (doctor output greppable).
 *
 * Usage: node scripts/smoke-quic-doctor.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0265-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-quic-doctor-${Date.now()}.log`);

// CONTRACTED grep regex — must match the value pinned in ADR-0265 §Cross-package
// symbol contracts. Changing this string requires updating the ADR.
const DOCTOR_GREP = /selectedBackend=(quic|websocket-fallback)\b/;

const perf = createSmokePerf('smoke-quic-doctor');

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}

function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function main() {
  log(`\n[ADR-0265 C5 smoke] doctor --component federation`);
  log(`[smoke] log file: ${LOG_FILE}\n`);

  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-quic-doctor', perf, REGISTRY);
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

    const r = spawnSync(cli, ['doctor', '--component', 'federation'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    });

    log(`    doctor stdout (head): ${r.stdout?.slice(0, 1200).trim()}`);
    if (r.stderr) log(`    doctor stderr (head): ${r.stderr.slice(0, 600).trim()}`);

    // Search both stdout and stderr — HealthCheck.message may surface on
    // either depending on the renderer (some doctor variants emit JSON to
    // stdout and prose to stderr).
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    const m = combined.match(DOCTOR_GREP);

    if (m) {
      pass(`1: doctor output contains 'selectedBackend=${m[1]}'`);
    } else {
      fail(`1: doctor output does NOT match /selectedBackend=(quic|websocket-fallback)\\b/`,
        `status=${r.status} combined head=${combined.slice(0, 400)}`);
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

  if (failed > 0) { log(`\nSmoke FAILED — C5 doctor criterion not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — C5 doctor criterion met.\n`);
  process.exit(0);
}

main();

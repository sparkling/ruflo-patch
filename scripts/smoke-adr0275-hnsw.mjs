#!/usr/bin/env node
/**
 * Smoke: ADR-0275 — RVF-native HNSW Layer B via the published napi binding.
 *
 * Loads the rvf-node native binding, creates a store, ingests N vectors, and
 * calls `queryWithEnvelope` (the ADR-0275 napi surface). Asserts:
 *   - queryWithEnvelope EXISTS on the binding (it didn't before ADR-0275)
 *   - it reports `layerB === true` (RVF-native HNSW Layer B served the query)
 *   - recall sanity: the nearest neighbor of an ingested vector is itself
 *   - the quality signal is a non-empty string (envelope reporting works)
 *
 * The deep recall + crash-safety guarantees are covered by the rvf-runtime
 * cargo tests; this smoke proves the JS-facing napi path works through the
 * published, codemod-built binding.
 */
import { existsSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0275-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0275-hnsw');

let passed = 0, failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

const BINDING_NAMES = ['@sparkleideas/ruvector-rvf-node', '@ruvector/rvf-node'];

async function loadBinding(dir) {
  for (const n of BINDING_NAMES) {
    try { const m = await import(n); if (m?.RvfDatabase) return m.RvfDatabase; } catch { /* try next */ }
  }
  // Resolve via the installed @sparkleideas/memory / ruflo package (binding is
  // a transitive dep; it may not be hoisted to the smoke subdir's top level).
  for (const pkg of ['@sparkleideas/memory', '@sparkleideas/ruflo', '@sparkleideas/cli']) {
    const base = join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    if (!existsSync(base)) continue;
    let req; try { req = createRequire(base); } catch { continue; }
    for (const n of BINDING_NAMES) {
      try { const p = req.resolve(n); const m = await import(p); if (m?.RvfDatabase) return m.RvfDatabase; } catch { /* try next */ }
    }
  }
  return null;
}

async function main() {
  log(`\n[ADR-0275 smoke] RVF-native HNSW Layer B via napi queryWithEnvelope`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir, shared } = setupSmokeTempDir('smoke-adr0275', perf, REGISTRY);
  try {
    if (!shared) { installAndInit(dir, perf, REGISTRY); } else { findCli(dir); }

    const RvfDatabase = await loadBinding(dir);
    if (!RvfDatabase || typeof RvfDatabase.create !== 'function') {
      fail('binding', `rvf-node binding (RvfDatabase) not resolvable from ${dir} — tried ${BINDING_NAMES.join(', ')}`);
      return finish();
    }
    pass('rvf-node native binding (RvfDatabase) loaded');

    const dbPath = join(dir, `adr0275-${process.pid}-${Date.now()}.rvf`);
    const DIM = 16, N = 250;
    const db = RvfDatabase.create(dbPath, { dimension: DIM, metric: 'cosine', m: 23, efConstruction: 100 });

    // Ingest N random vectors as one batch (ids 1..N).
    const flat = new Float32Array(N * DIM);
    for (let i = 0; i < N * DIM; i++) flat[i] = Math.random();
    const ids = Array.from({ length: N }, (_, i) => i + 1);
    db.ingestBatch(flat, ids, null);
    pass(`ingested ${N} × ${DIM}-dim vectors (HNSW built incrementally)`);

    if (typeof db.queryWithEnvelope !== 'function') {
      fail('napi', 'queryWithEnvelope not present on the binding — published build predates ADR-0275');
      try { db.close(); } catch { /* ignore */ }
      return finish();
    }

    // Query with vector id=1's own embedding → nearest must be id 1.
    const q = flat.slice(0, DIM);
    const env = db.queryWithEnvelope(q, 10, { efSearch: 50 });

    if (env && env.layerB === true) {
      pass(`queryWithEnvelope reports layerB=true (RVF-native HNSW Layer B active; quality=${env.quality})`);
    } else {
      fail('layerB', `expected layerB=true, got ${env?.layerB} (quality=${env?.quality}) — Layer B not active`);
    }

    const results = env?.results || [];
    if (results.length > 0 && results[0].id === 1) {
      pass(`recall: nearest neighbor of vec[1] is id 1 (self), ${results.length} result(s) returned`);
    } else {
      fail('recall', `expected nearest id=1, got id=${results[0]?.id} (len=${results.length})`);
    }

    if (typeof env?.quality === 'string' && env.quality.length > 0) {
      pass(`quality envelope populated: "${env.quality}" (hnswCandidates=${env.hnswCandidateCount}, safetyNet=${env.safetyNetCandidateCount})`);
    } else {
      fail('quality', `expected non-empty quality string, got ${JSON.stringify(env?.quality)}`);
    }

    try { db.close(); } catch { /* ignore */ }
  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  finish();
}

function finish() {
  log(`\nResults: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });

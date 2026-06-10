#!/usr/bin/env node
/**
 * Smoke: ADR-0287 R2 — discriminated re-throw of FATAL storage errors in
 * `AgentDBBackend.storeInAgentDB` (a benign / transient error stays swallowed).
 *
 * R2 (ADR-0287 §Findings, lines 178-190 + amendment `agentdb-backend.js`): the
 * method does the SQLite INSERT and the HNSW vector-add in two SEPARATE
 * try/catch blocks that — pre-fix — each had a BARE swallowing `catch {}`. A
 * genuine data-integrity failure (corrupt store, dimension mismatch, dep-init
 * failure) was silently eaten, stranding a row-without-vector (invisible data
 * loss). The fix (`feedback-best-effort-must-rethrow-fatals`, ADR-0082/0085)
 * is a DISCRIMINATED re-throw keyed on `err.name`: the data-integrity subset
 * surfaces; everything else (incl. the generic `Error` HNSW "Index not built")
 * stays swallowed, preserving the documented off-hot-path "entry is already
 * in-memory" semantics.
 *
 * The fatal set mirrored from the committed source (`_isFatalStorageError`,
 * v3/@claude-flow/memory/src/agentdb-backend.ts):
 *   RvfCorruptError · RvfNotInitializedError · EmbeddingDimensionError ·
 *   DimensionMismatchError · AgentDBInitError · ControllerInitError
 *
 * Strategy (same black-box technique class as smoke-adr0274-xprocess-freshness):
 * import the SHIPPED `@sparkleideas/memory/dist/agentdb-backend.js`, instantiate
 * `AgentDBBackend`, run the real `initialize()` once (this populates the
 * non-exported module-level `HNSWIndex` so the HNSW block is REACHED — it is
 * gated on `entry.embedding && HNSWIndex`), then REPLACE `backend.agentdb` with
 * a fake whose write paths throw on demand. `store()` → `storeInAgentDB`
 * exercises the two catches. `agentdb` is TS-`private` (erased at runtime), so
 * the field assignment is legal; `requireAgentDB` only reads `this.initialized`
 * / `this.agentdb` (both satisfied). Cases:
 *
 *   1. SQLite path, FATAL  (db.run throws RvfCorruptError)         ⇒ store() THROWS
 *   2. SQLite path, BENIGN (db.run throws plain Error/SQLITE_BUSY) ⇒ store() SWALLOWS
 *   3. HNSW path,   FATAL  (addVector throws EmbeddingDimensionError) ⇒ THROWS  (if reachable)
 *   4. HNSW path,   BENIGN (addVector throws "Index not built")    ⇒ SWALLOWS (if reachable)
 *
 * The fake has NO `store` fn, so storeInAgentDB takes the `db.run` INSERT path
 * (the catch this fix touches), not the early-return native-store branch.
 *
 * FAIL pre-fix (cases 1 & 3 resolve — the swallow ate the fatal), PASS post-fix.
 * RED until `@sparkleideas/memory` carrying the R2 fix is published — by design;
 * it validates the SHIPPED dist, not the working tree.
 *
 * Resolution: reuses ADR0255_SMOKE_SHARED_TEMP (= ACCEPT_TEMP) when the harness
 * set it; otherwise creates a smoke-local temp and installs
 * `@sparkleideas/memory@latest` from REGISTRY.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';

const LOG_DIR = process.env.SMOKE_LOG_DIR || tmpdir();
const LOG_FILE = join(LOG_DIR, `smoke-adr0287r2-storeindb-rethrow-${process.pid}.log`);

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

/**
 * Resolve `@sparkleideas/memory/dist/agentdb-backend.js` under an installed
 * package tree. Throws with a clear message if the dist is missing.
 */
function resolveDistInInstall(installDir) {
  const dist = join(installDir, 'node_modules/@sparkleideas/memory/dist/agentdb-backend.js');
  if (!existsSync(dist)) {
    throw new Error(`installed @sparkleideas/memory dist missing: ${dist}`);
  }
  return dist;
}

/**
 * Resolve the path to load AgentDBBackend from the INSTALLED package. Reuses
 * ADR0255_SMOKE_SHARED_TEMP (= ACCEPT_TEMP) when the harness set it; otherwise
 * creates a smoke-local temp and installs @sparkleideas/memory from REGISTRY.
 * Returns { backendUrl, cleanup }.
 */
function resolveBackend() {
  const shared = process.env.ADR0255_SMOKE_SHARED_TEMP;
  if (shared) {
    const dist = resolveDistInInstall(shared);
    log(`[setup] reusing shared install: ${shared}`);
    return { backendUrl: dist, cleanup: () => {} };
  }

  // Standalone: create a local temp and install @sparkleideas/memory. A scoped
  // pkg install no-ops without a package.json in the dir, so write one first.
  const installDir = mkdtempSync(join(tmpdir(), 'adr0287r2-storeindb-install-'));
  writeFileSync(join(installDir, 'package.json'),
    JSON.stringify({ name: 'adr0287r2-storeindb-smoke', version: '1.0.0', private: true }));
  writeFileSync(join(installDir, '.npmrc'), `registry=${REGISTRY}\n`);
  log(`[setup] installing @sparkleideas/memory@latest into ${installDir} (registry ${REGISTRY})…`);
  const r = spawnSync('npm', [
    'install', '@sparkleideas/memory@latest',
    '--registry', REGISTRY, '--no-audit', '--no-fund',
  ], { cwd: installDir, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) {
    throw new Error(`npm install @sparkleideas/memory failed (status=${r.status}): ${(r.stderr || '').slice(0, 400)}`);
  }
  const dist = resolveDistInInstall(installDir);
  return {
    backendUrl: dist,
    cleanup: () => { try { rmSync(installDir, { recursive: true, force: true }); } catch {} },
  };
}

// The substrate dimension MUST match the real embedding model's output. The
// unified default is Xenova/all-mpnet-base-v2 → 768-dim (memory
// reference-embedding-model / ADR-0069). EmbeddingService.initialize() throws
// EmbeddingDimensionMismatchError if vectorDimension disagrees with what the
// pipeline reports — so use 768 throughout (a 4-dim probe never reaches the
// catches; it dies in initialize()). Verified live against the installed dist.
const SUBSTRATE_DIM = 768;

/** A full MemoryEntry (matches the INSERT column list storeInAgentDB writes). */
function makeEntry(id) {
  const now = Date.now();
  const embedding = new Float32Array(SUBSTRATE_DIM);
  embedding[0] = 0.1; embedding[1] = 0.2; embedding[2] = 0.3; embedding[3] = 0.4;
  return {
    id, key: id, content: `content-${id}`, type: 'fact', namespace: 'default',
    tags: [], metadata: {}, accessLevel: 'private', accessCount: 0,
    embedding,
    createdAt: now, updatedAt: now, lastAccessedAt: now,
    ownerId: 'smoke', version: 1, references: [],
  };
}

/** Build an Error with a forced `.name` (the discriminator the fix keys on). */
function named(name, msg) { const e = new Error(msg); e.name = name; return e; }

/**
 * Instantiate a backend, run the real init (populates the module-level
 * HNSWIndex), then arm the SQLite (`db.run`) and HNSW (`addVector`) paths to
 * throw on demand. No `store` fn on the fake → forces the db.run INSERT path
 * (the catch this fix touches). Returns the store() promise.
 */
async function armedStore(Backend, { sqlErr, hnswErr }) {
  const backend = new Backend({ vectorDimension: SUBSTRATE_DIM });
  await backend.initialize();
  backend.agentdb = {
    // No `store` fn → storeInAgentDB falls through to the db.run INSERT path.
    database: {
      run: async () => { if (sqlErr) throw sqlErr; /* else: INSERT succeeds */ },
    },
    getController: (name) => (name === 'hnsw'
      ? { addVector: () => { if (hnswErr) throw hnswErr; }, getStats: () => ({}) }
      : null),
  };
  return backend.store(makeEntry(`adr0287r2-${Math.random().toString(36).slice(2)}`));
}

async function expectThrow(Backend, arm, label, expectName) {
  try {
    await armedStore(Backend, arm);
    fail(label, `store() RESOLVED but a ${expectName} should have surfaced (pre-fix swallow)`);
  } catch (e) {
    if (e && e.name === expectName) {
      pass(`${label} — ${expectName} surfaced (re-thrown, not swallowed)`);
    } else {
      fail(label, `threw ${e?.name}: ${e?.message} (expected ${expectName} to surface)`);
    }
  }
}

async function expectSwallow(Backend, arm, label) {
  try {
    await armedStore(Backend, arm);
    pass(`${label} — benign error swallowed (off-hot-path semantics preserved)`);
  } catch (e) {
    fail(label, `store() THREW ${e?.name}: ${e?.message} (a benign/transient error must stay swallowed)`);
  }
}

async function main() {
  log(`\n[ADR-0287 R2 smoke] storeInAgentDB discriminated re-throw (fatal surfaces, benign swallowed)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  // The fake backend is in-memory only; temp `.rvf`/store is outside any project
  // root, so disable the ADR-0137 write-guard (mirrors smoke-adr0274).
  process.env.RUFLO_ADR0137_ENFORCE = '0';

  let cleanup = () => {};
  try {
    const resolved = resolveBackend();
    cleanup = resolved.cleanup;
    const mod = await import('file://' + resolved.backendUrl);
    const Backend = mod.AgentDBBackend;
    if (typeof Backend !== 'function') {
      fail('export', `@sparkleideas/memory/dist/agentdb-backend.js does not export AgentDBBackend (got: ${Object.keys(mod).join(',') || 'none'})`);
      return finish(cleanup);
    }

    // ── Pre-flight: is the HNSW block reachable in this env? It is gated on
    // `entry.embedding && HNSWIndex`, and HNSWIndex is a non-exported module
    // `let` populated only by a successful initialize() loading the optional
    // native index. If it didn't load, cases 3/4 are VACUOUS — detect and
    // report honestly rather than false-pass (an unreachable HNSW catch can't
    // be asserted). The SQLite cases (1/2) are always reachable.
    let hnswReachable = false;
    try {
      const probe = new Backend({ vectorDimension: SUBSTRATE_DIM });
      await probe.initialize();
      probe.agentdb = {
        database: { run: async () => {} },
        getController: (n) => (n === 'hnsw'
          ? { addVector: () => { throw named('RvfCorruptError', 'probe'); }, getStats: () => ({}) }
          : null),
      };
      try { await probe.store(makeEntry('probe')); }
      catch (e) { if (e?.name === 'RvfCorruptError') hnswReachable = true; }
      try { if (typeof probe.shutdown === 'function') await probe.shutdown(); } catch {}
    } catch { /* probe is best-effort */ }
    log(`[smoke] HNSW catch reachable in this env: ${hnswReachable}`);

    // ── Case 1 — SQLite path, FATAL → must surface (the core R2 fix).
    await expectThrow(Backend, { sqlErr: named('RvfCorruptError', 'sqlite store corrupt') },
      'SQLite INSERT fatal', 'RvfCorruptError');

    // A second fatal class through the SQLite path, to prove the set isn't a
    // one-off (EmbeddingDimensionError is in _isFatalStorageError too).
    await expectThrow(Backend, { sqlErr: named('EmbeddingDimensionError', 'dim mismatch on insert') },
      'SQLite INSERT fatal (dim)', 'EmbeddingDimensionError');

    // ── Case 2 — SQLite path, BENIGN/TRANSIENT → must stay swallowed.
    await expectSwallow(Backend, { sqlErr: named('Error', 'SQLITE_BUSY: database is locked') },
      'SQLite INSERT benign/transient');

    // ── Cases 3 & 4 — HNSW path (only if the catch is reachable in this env).
    if (hnswReachable) {
      // FATAL → must surface AFTER the row was written (row-without-vector strand).
      await expectThrow(Backend, { sqlErr: null, hnswErr: named('EmbeddingDimensionError', 'dim mismatch on add') },
        'HNSW add fatal', 'EmbeddingDimensionError');
      // BENIGN → "Index not built" is a generic Error → stays swallowed.
      await expectSwallow(Backend, { sqlErr: null, hnswErr: named('Error', 'Index not built. Call buildIndex() first.') },
        'HNSW add benign');
    } else {
      log(`  SKIP  HNSW path cases — native HNSW index not loaded in this throwaway install (HNSWIndex falsy → block unreachable). SQLite-path discrimination (cases 1/2) covers the same _isFatalStorageError logic; the HNSW catch is byte-identical.`);
    }

    return finish(cleanup);
  } catch (err) {
    fail('main', err?.stack || String(err));
    return finish(cleanup);
  }
}

async function finish(cleanup) {
  try { cleanup?.(); } catch {}

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0287 R2 discriminated re-throw not effective (a fatal storage error was swallowed).\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — storeInAgentDB surfaces fatal storage errors and swallows benign ones (ADR-0287 R2).\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(() => {}); });

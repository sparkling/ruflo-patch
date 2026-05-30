#!/usr/bin/env node
/**
 * Smoke: ADR-0274 — cross-process CONTENT freshness (D3/D4 read-handle reload).
 *
 * Distinct from smoke-adr0274-rvf-rw-split.mjs (which proves a concurrent CLI
 * WRITE no longer blocks on the flock). THIS smoke proves the complementary
 * READ-side guarantee that the D5 park/unpark deviation dropped:
 *
 *   A long-lived RVF reader (e.g. the MCP server) that has already loaded its
 *   in-memory view must REFLECT entries a SEPARATE process committed to the same
 *   `.rvf` afterward — within the debounce window — instead of serving a stale
 *   snapshot forever.
 *
 * Scenario:
 *   1. Handle A (this process) opens the backend, stores one seed entry, and
 *      issues a read (establishing its baseline txnid + parking its flock).
 *   2. A SEPARATE node process (the peer) opens the same `.rvf`, stores N new
 *      entries, commits, and exits.
 *   3. Handle A issues a read (query → memory_list path) and a semantic search.
 *      - pre-fix: A's `this.entries` was loaded once at init and never refreshed
 *        from a peer's writes → the list count does NOT grow and the semantic
 *        search does NOT surface a peer entry.  → FAIL
 *      - post-fix: A's read paths call `_maybeReloadFromDisk()`, which peeks the
 *        advanced on-disk txnid and lazily re-reads committed state via a
 *        lock-free `openReadonly` handle → the list count grows and the peer
 *        entry is surfaced.  → PASS
 *
 * FAIL pre-fix, PASS post-fix — the ADR-0274 D3/D4 confirmation gate.
 *
 * Resolution: loads the fork's freshly-built `@claude-flow/memory` dist and the
 * freshly-built `@ruvector/rvf-node` crate (the units under change). The backend
 * resolves the binding relative to its own location, so if it is not already
 * resolvable from the memory package's node_modules, a temporary symlink to the
 * built crate is created there and removed on exit. This keeps the smoke
 * deterministic and pinned to the fork code being verified (per fork test
 * discipline) rather than a published/codemod-renamed install.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, symlinkSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORK_ROOT = '/Users/henrik/source/forks';
const MEMORY_PKG = join(FORK_ROOT, 'ruflo/v3/@claude-flow/memory');
const MEMORY_DIST = join(MEMORY_PKG, 'dist/rvf-backend.js');
const RVF_NODE_CRATE = join(FORK_ROOT, 'ruvector/crates/rvf/rvf-node');

const LOG_DIR = process.env.SMOKE_LOG_DIR || tmpdir();
const LOG_FILE = join(LOG_DIR, `smoke-adr0274-freshness-${process.pid}.log`);

let passed = 0;
let failed = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

/**
 * Resolve the path to load RvfBackend from + ensure `@ruvector/rvf-node` is
 * resolvable from that location. Returns { backendUrl, cleanup }.
 */
function resolveBackend() {
  // Load the fork's built dist. The backend resolves `@ruvector/rvf-node`
  // relative to its OWN location, so the binding must be present under the
  // memory package's node_modules. Symlink the freshly-built crate there if it
  // isn't already resolvable.
  if (!existsSync(MEMORY_DIST)) {
    throw new Error(`fork dist missing: ${MEMORY_DIST} (run \`npm run build\` in the memory package)`);
  }
  const linkDir = join(MEMORY_PKG, 'node_modules/@ruvector');
  const linkPath = join(linkDir, 'rvf-node');
  let created = false;
  if (!existsSync(linkPath)) {
    if (!existsSync(RVF_NODE_CRATE)) {
      throw new Error(`built rvf-node crate missing: ${RVF_NODE_CRATE}`);
    }
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(RVF_NODE_CRATE, linkPath);
    created = true;
    log(`[setup] symlinked built @ruvector/rvf-node → memory/node_modules (standalone)`);
  }
  return {
    backendUrl: MEMORY_DIST,
    cleanup: () => {
      if (created) {
        try { rmSync(linkPath, { force: true }); } catch {}
        try { rmSync(linkDir, { recursive: false, force: true }); } catch {}
      }
    },
  };
}

function makeEntry(id, vec, namespace = 'default') {
  const now = Date.now();
  return {
    id, key: id, namespace, value: `value-${id}`, type: 'fact', tags: [],
    embedding: vec, accessLevel: 'private', accessCount: 0,
    createdAt: now, updatedAt: now, lastAccessedAt: now, ownerId: 'smoke', metadata: {},
  };
}

/** The peer-writer child source — runs in a SEPARATE node process. */
function peerWriterSource(backendUrl) {
  return `
process.env.RUFLO_ADR0137_ENFORCE = '0';
const { RvfBackend } = await import(${JSON.stringify('file://' + backendUrl)});
const db = process.argv[2];
const n = parseInt(process.argv[3] || '3', 10);
function entry(id, vec){ const t=Date.now(); return { id, key:id, namespace:'default', value:'value-'+id, type:'fact', tags:[], embedding:new Float32Array(vec), accessLevel:'private', accessCount:0, createdAt:t, updatedAt:t, lastAccessedAt:t, ownerId:'peer', metadata:{} }; }
const b = new RvfBackend({ databasePath: db, dimensions: 4, metric: 'cosine' });
await b.initialize();
for (let i = 0; i < n; i++) { const v = [0,0,0,0]; v[i % 4] = 1; await b.store(entry('peer-'+i, v)); }
if (typeof b.shutdown === 'function') await b.shutdown();
process.exit(0);
`;
}

async function main() {
  log(`\n[ADR-0274 freshness smoke] cross-process content freshness (D3/D4 read reload)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  process.env.RUFLO_ADR0137_ENFORCE = '0'; // temp `.rvf` is outside any project root
  const PEER_COUNT = 3;
  let cleanup = () => {};
  let workDir = null;

  try {
    const resolved = resolveBackend();
    cleanup = resolved.cleanup;
    const { RvfBackend } = await import('file://' + resolved.backendUrl);

    workDir = mkdtempSync(join(tmpdir(), 'adr0274-freshness-'));
    const dbPath = join(workDir, 'mem.rvf');
    const peerScript = join(workDir, 'peer-writer.mjs');
    writeFileSync(peerScript, peerWriterSource(resolved.backendUrl));

    // ── Handle A: the long-lived reader (query/search paths). ──
    const a = new RvfBackend({ databasePath: dbPath, dimensions: 4, metric: 'cosine' });
    await a.initialize();
    await a.store(makeEntry('a-seed', new Float32Array([1, 1, 0, 0])));

    // Establish A's read baseline (and let it park its native flock so the peer
    // can acquire the write flock). query() is the memory_list path.
    const baselineRows = await a.query({ limit: 100 });
    const baseline = baselineRows.length;
    log(`[smoke] handle A baseline list count: ${baseline}`);
    if (baseline !== 1) {
      fail('baseline', `expected 1 seed entry, got ${baseline}`);
      return finish(cleanup, workDir, a);
    }
    pass(`handle A established baseline (1 seed entry, read path warmed)`);

    // Baseline for the memory_stats surfaces (listNamespaces + count). These read
    // `this.entries` directly. count(ns) is the literal caveat #2 path
    // (memory_stats → count(ns) per namespace from listNamespaces()).
    const nsBaseline = await a.listNamespaces();
    const countBaseline = await a.count('default');
    log(`[smoke] handle A baseline listNamespaces=[${nsBaseline.join(',')}] count('default')=${countBaseline}`);
    if (countBaseline !== 1) {
      fail('count baseline', `expected 1 seed entry in 'default', got ${countBaseline}`);
      return finish(cleanup, workDir, a);
    }

    // Let A go idle past the park-idle window so the native flock is released.
    await sleep(300);

    // ── Peer: a SEPARATE process writes N new entries + commits. ──
    log(`[smoke] spawning peer writer (separate process, ${PEER_COUNT} entries)…`);
    const peer = spawnSync(process.execPath, [peerScript, dbPath, String(PEER_COUNT)], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, RUFLO_ADR0137_ENFORCE: '0' },
    });
    if (peer.status !== 0) {
      fail('peer write', `peer process exited ${peer.status} signal=${peer.signal ?? 'none'}: ${(peer.stderr || '').slice(0, 400)}`);
      return finish(cleanup, workDir, a);
    }
    pass(`peer process committed ${PEER_COUNT} entries to the same .rvf and exited cleanly`);

    // Wait past the reload debounce window (_RELOAD_DEBOUNCE_MS, default 250ms).
    await sleep(400);

    // ── memory_stats path FIRST (before any query()/search() runs), so its
    // freshness can ONLY come from the reload wired into count()/listNamespaces()
    // — not be masked by a prior query() reload. This is the literal caveat #2
    // symptom ("server shows N while disk has M"). ──
    const countAfter = await a.count('default');
    const nsAfter = await a.listNamespaces();
    log(`[smoke] handle A after peer (stats path): count('default')=${countAfter} listNamespaces=[${nsAfter.join(',')}]`);
    if (countAfter > countBaseline) {
      pass(`memory_stats count('default') reflects peer writes (${countBaseline}→${countAfter}) — count()/listNamespaces() freshness wired`);
    } else {
      fail('stale count', `count('default') STALE: ${countBaseline}→${countAfter} after peer wrote ${PEER_COUNT}. count()/listNamespaces() not wired to _maybeReloadFromDisk (caveat #2 symptom unfixed).`);
    }

    // ── Handle A list/semantic reads — must reflect the peer's writes. ──
    const afterRows = await a.query({ limit: 100 });
    const after = afterRows.length;
    const peerIdsInList = afterRows.map(r => r.id).filter(id => id.startsWith('peer-'));
    log(`[smoke] handle A list count after peer: ${after} (peer entries: ${peerIdsInList.join(',') || 'none'})`);

    if (after > baseline && peerIdsInList.length === PEER_COUNT) {
      pass(`memory_list reflects peer writes (${baseline}→${after}; all ${PEER_COUNT} peer entries visible) — cross-process freshness reload fired`);
    } else if (after > baseline) {
      pass(`memory_list count grew ${baseline}→${after} (partial peer visibility: ${peerIdsInList.length}/${PEER_COUNT})`);
    } else {
      fail('stale list', `handle A still serves a STALE view: count ${baseline}→${after}, peer entries invisible. _maybeReloadFromDisk did not refresh from disk (pre-fix behavior).`);
    }

    // Semantic search must surface a peer entry too.
    const results = await a.search(new Float32Array([0, 1, 0, 0]), { k: 5 });
    const searchIds = results.map(r => r.entry.id);
    const sawPeer = searchIds.some(id => id.startsWith('peer-'));
    log(`[smoke] semantic search ids: ${searchIds.join(',') || 'none'}`);
    if (sawPeer) {
      pass(`semantic search surfaces a peer entry (orphan self-heal over the refreshed entries)`);
    } else {
      fail('stale search', `semantic search returned no peer entry (got: ${searchIds.join(',') || 'none'}) — stale in-memory view`);
    }

    await finish(cleanup, workDir, a);
  } catch (err) {
    fail('main', err?.stack || String(err));
    finish(cleanup, workDir, null);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function finish(cleanup, workDir, backend, backendB) {
  try { if (backend && typeof backend.shutdown === 'function') await backend.shutdown(); } catch {}
  try { if (backendB && typeof backendB.shutdown === 'function') await backendB.shutdown(); } catch {}
  try { cleanup?.(); } catch {}
  try { if (workDir) rmSync(workDir, { recursive: true, force: true }); } catch {}

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`\nSmoke FAILED — ADR-0274 cross-process content freshness not effective.\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — a long-lived reader reflects a peer process's writes (ADR-0274 D3/D4).\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(() => {}, null, null); });

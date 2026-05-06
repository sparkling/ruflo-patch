// @tier unit
// Bug-1 (2026-05-05): memory_search returns 0 results despite 768-dim
// embeddings being stored on every record. Direct memory_retrieve works.
// Root cause: orphan numIds in the persisted SFVR file from prior processes
// — the current process's nativeReverseMap is empty at open, so native
// query() returns hits whose r.id maps to nothing and gets silently dropped.
// Fix at RvfBackend.search(): detect 100%-orphan native results and fall
// through to pureTsSearch over `this.entries` (loud-warn per ADR-0082).

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function findRvfBackendDist() {
  // Codemodded build (post `npm run codemod` + `build:tsc`) — fresh and
  // always complete. Prefer over fork's local dist which may have missing
  // transitive deps (hnsw-lite.js etc.) if the fork wasn't rebuilt recently.
  const candidates = [
    '/tmp/ruflo-build/dist/v3/@claude-flow/memory/src/rvf-backend.js',
    '/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js',
  ];
  for (const c of candidates) if (existsSync(c)) {
    const sibling = c.replace('rvf-backend.js', 'hnsw-lite.js');
    if (existsSync(sibling)) return c;
  }
  // Acceptance install dirs (also have complete deps)
  let entries;
  try { entries = readdirSync('/tmp'); } catch { entries = []; }
  for (const name of entries) {
    if (!name.startsWith('ruflo-accept-')) continue;
    for (const sub of [
      ['node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js'],
      ['node_modules', '@sparkleideas', 'memory', 'dist', 'src', 'rvf-backend.js'],
    ]) {
      const p = join('/tmp', name, ...sub);
      if (existsSync(p)) {
        const sibling = p.replace('rvf-backend.js', 'hnsw-lite.js');
        if (existsSync(sibling)) return p;
      }
    }
  }
  // Fork-side dist (LAST RESORT — may be incomplete)
  for (const fp of [
    '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js',
    '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/src/rvf-backend.js',
  ]) {
    if (existsSync(fp)) {
      const sibling = fp.replace('rvf-backend.js', 'hnsw-lite.js');
      if (existsSync(sibling)) return fp;
    }
  }
  return null;
}

describe('Bug-1: RvfBackend.search() must self-heal orphan numIds (HNSW invariant)', () => {
  const distPath = findRvfBackendDist();
  let RvfBackend;
  let workDir;

  before(async () => {
    if (!distPath) return;
    const mod = await import(distPath);
    RvfBackend = mod.RvfBackend;
    workDir = mkdtempSync(join(tmpdir(), 'bug1-orphan-'));
  });

  after(() => { try { rmSync(workDir, { recursive: true, force: true }); } catch {} });

  it('source contains the orphan-self-heal branch (regression pin)', async () => {
    // Read the fork TS source directly (always reliable — independent of
    // build state). Build artifacts can lag behind source due to tsc
    // incremental cache (Bug-6 fixed in build-packages.sh, but the
    // regression-pin should not depend on the build at all).
    const fs = await import('node:fs');
    const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
    const src = fs.readFileSync(FORK_SRC, 'utf8');
    assert.match(src, /orphanHits|mappedHits/, 'orphan-numId tracking must be present in fork source rvf-backend.ts');
    assert.match(src, /pureTsSearch/, 'pure-TS fallback must exist');
  });

  it('orphan-only native hits trigger pureTsSearch fallback (real backend)', { skip: !distPath ? 'rvf-backend dist absent' : false }, async (t) => {
    if (!RvfBackend) { t.skip('RvfBackend export missing'); return; }
    const dbPath = join(workDir, 'orphan-test.rvf');
    // Phase 1: process A stores entries with embeddings, then closes.
    const a = new RvfBackend({ databasePath: dbPath, dimensions: 8 });
    if (typeof a.initialize === 'function') await a.initialize();
    const e1 = { id: 'rec/auth-jwt', namespace: 'default', value: 'jwt auth tokens', embedding: new Float32Array([1,0,0,0,0,0,0,0]), tags: [], type: 'doc', timestamp: Date.now() };
    const e2 = { id: 'rec/payment', namespace: 'default', value: 'stripe payments', embedding: new Float32Array([0,1,0,0,0,0,0,0]), tags: [], type: 'doc', timestamp: Date.now() };
    if (typeof a.store === 'function') {
      await a.store(e1);
      await a.store(e2);
    } else {
      t.skip('RvfBackend.store API differs from expected shape');
      return;
    }
    if (typeof a.shutdown === 'function') await a.shutdown();

    // Phase 2: process B opens the same .rvf and searches. Pre-fix this
    // returns []; post-fix the orphan-self-heal triggers pureTsSearch.
    const b = new RvfBackend({ databasePath: dbPath, dimensions: 8 });
    if (typeof b.initialize === 'function') await b.initialize();
    if (typeof b.search !== 'function') { t.skip('search API differs'); return; }
    const hits = await b.search(new Float32Array([0.99, 0.1, 0, 0, 0, 0, 0, 0]), { k: 5 });
    assert.ok(Array.isArray(hits), 'search must return array');
    assert.ok(hits.length > 0, `Bug-1: search returned 0 hits — orphan-numId self-heal not firing. Got: ${JSON.stringify(hits)}`);
    if (typeof b.shutdown === 'function') await b.shutdown();
  });
});

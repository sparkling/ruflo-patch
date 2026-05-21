// @tier integration
// ADR-0167 Amendment 2026-05-21b (Phase 3) — read-side reader convergence.
//
// THE GAP THIS CLOSES: ADR-0090 B5 verifies cross-process persistence via
// `sqlite3` row-counts — it never exercises `memory_search` against a
// LONG-LIVED handle. The production bug (warm MCP server returns total:0 for
// memory_search against an accumulated store while memory_store/retrieve work
// and a fresh process searches fine) is precisely a long-lived-handle staleness
// that row-count checks cannot see.
//
// ROOT CAUSE (see ADR-0167 §Amendment 2026-05-21b): the native RvfStore loads
// `self.vectors` from the active manifest once in boot() and serves query() as
// a brute-force scan over that frozen map; it never re-reads the RootHeader.
// A handle held open across ANOTHER process's commits is stuck on its
// boot-epoch snapshot. RVF is snapshot-isolated by design and delegates
// "explicit refresh" to the caller — the fork is the caller.
//
// THE FIX (rvf-backend.ts ensureFresh): capture {ino,size,mtimeMs} at load;
// before a semantic read, stat again; on a detected change (size grew on
// append, or ino swapped on compaction) reopen the native handle (existing
// RvfDatabase.open API — NO native-core change) and re-hydrate entries +
// nativeReverseMap. Plus a loud d8 backstop (raw.length===0 && entries.size>0)
// that supplements from the authoritative entries Map (NOT a silent empty).
//
// THIS TEST models the verified two-handle repro (H1 stores A → reader R opens
// → H2 appends B and closes → on-disk=6) and asserts the REFRESHED long-lived
// handle R converges (count==6, finds b1) — not just a fresh reopen R3.
//
// Resolves the freshly-built backend via loadRvfBackend() (ADR-0225 /
// project-rvf-test-artifact-resolution), NEVER a stale gitignored fork-root
// dist. Per feedback-no-squelch-tests the assertions are strict + loud; the
// ONLY skip is the narrow env-not-capable case (native @ruvector/rvf-node not
// installed alongside the resolved dist — the bug is native-specific, so a
// pure-TS-only environment cannot exercise it).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { loadRvfBackend } from '../helpers/load-rvf.mjs';

const DIM = 8;
const NS = 'adr0167-p3';

// Deterministic-ish vectors: each key gets a distinct unit-ish vector so a
// near-match query for a key returns THAT entry as the top hit. We avoid pure
// randomness so the convergence assertion ("R finds b1") is stable.
function vecFor(seed) {
  const v = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    // Spread seed across dims; keep values in [-1,1].
    v[i] = Math.sin(seed * 0.7 + i * 1.13);
  }
  return v;
}

function entry(ns, key, seed) {
  const now = Date.now();
  return {
    id: `${ns}:${key}`,
    namespace: ns,
    key,
    content: `content-${key}`,
    type: 'semantic',
    tags: [],
    metadata: {},
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
    embedding: vecFor(seed),
  };
}

// Probe whether the native binding is installed alongside the resolved dist.
// The bug + fix are native-specific (pure-TS uses a per-process Map and never
// reads the shared native store). If native is absent, the scenario is
// structurally inapplicable → narrow, legitimate skip.
function nativeAvailable(distPath) {
  try {
    const req = createRequire(distPath);
    req.resolve('@ruvector/rvf-node');
    return true;
  } catch {
    return false;
  }
}

describe('ADR-0167 Phase 3: warm-handle reader-refresh (memory_search convergence)', () => {
  it('AC-P3-1/2/3: long-lived reader converges after an external write + loud backstop', { timeout: 300_000 }, async (t) => {
    const loaded = await loadRvfBackend();
    if (!loaded.RvfBackend) {
      t.skip(`SKIP_ACCEPTED: ${loaded.error ?? 'RvfBackend unavailable'}. Bring up Verdaccio + publish @sparkleideas/memory@latest, then re-run.`);
      return;
    }
    if (!nativeAvailable(loaded.path)) {
      t.skip(`SKIP_ACCEPTED: @ruvector/rvf-node not installed alongside ${loaded.path}; the warm-handle staleness bug is native-specific (pure-TS uses a per-process Map). Install the native binding to exercise Phase 3.`);
      return;
    }

    const { RvfBackend } = loaded;
    const workDir = mkdtempSync(join(tmpdir(), 'adr0167-p3-'));
    const rvfPath = join(workDir, 'memory.rvf');

    const mk = async () => {
      const b = new RvfBackend({ databasePath: rvfPath, dimensions: DIM, autoPersistInterval: 0, verbose: true });
      await b.initialize();
      return b;
    };

    // Capture console.warn so we can assert the loud backstop / refresh fired
    // (AC-P3-3: NOT a silent empty). We tee through to the original so build
    // logs still show the warning.
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => { warnings.push(args.map(String).join(' ')); originalWarn.apply(console, args); };

    let R;
    try {
      const A = [entry(NS, 'a1', 1), entry(NS, 'a2', 2), entry(NS, 'a3', 3)];
      const B = [entry(NS, 'b1', 101), entry(NS, 'b2', 102), entry(NS, 'b3', 103)];

      // H1: writer stores batch A, then CLOSES (single-writer — release the
      // lock before the reader / second writer open).
      const H1 = await mk();
      for (const e of A) await H1.store(e);
      assert.equal(await H1.count(NS), 3, 'H1 must hold 3 entries after storing batch A');
      await H1.shutdown();

      // R: the long-lived reader/server handle. Opens after H1 released the
      // writer lock. Sees 3 (batch A) at boot.
      R = await mk();
      assert.equal(await R.count(NS), 3, 'R must see 3 entries (batch A) at open');
      // Sanity: at boot R finds a1 but NOT b1 (b1 not written yet).
      const rA1Boot = await R.search(vecFor(1), { k: 5, threshold: 0, filters: { namespace: NS } });
      assert.ok(rA1Boot.length >= 1, 'R must find batch-A entries at boot');
      const rB1Boot = await R.search(vecFor(101), { k: 5, threshold: 0, filters: { namespace: NS } });
      assert.equal(
        rB1Boot.filter(r => r.entry.key === 'b1').length, 0,
        'b1 must NOT be visible to R before H2 writes it (pre-condition for the staleness scenario)',
      );

      // H2: a SECOND writer handle appends batch B while R stays open, then
      // closes → on-disk now has 6 entries. This is the cross-process commit
      // R's boot snapshot cannot see without refresh.
      const H2 = await mk();
      for (const e of B) await H2.store(e);
      assert.equal(await H2.count(NS), 6, 'H2 must observe all 6 entries (A+B) on disk');
      await H2.shutdown();

      // THE TEST — does the LONG-LIVED, REFRESHED R converge?
      // Before the fix: R.search(b1) returns 0 (frozen boot snapshot).
      // After the fix: search() calls ensureFresh(), detects the file grew,
      // reopens + re-hydrates, and finds b1.
      warnings.length = 0; // scope the warning capture to the refresh search
      const rB1 = await R.search(vecFor(101), { k: 10, threshold: 0, filters: { namespace: NS } });
      const foundB1 = rB1.some(r => r.entry.key === 'b1');
      assert.ok(
        foundB1,
        `AC-P3-1/2: refreshed long-lived handle R must find b1 after the external append. ` +
        `Got ${rB1.length} hits: [${rB1.map(r => r.entry.key).join(', ')}]. ` +
        `Warnings captured: ${JSON.stringify(warnings)}`,
      );

      // count() routes through the entries Map, which ensureFresh re-hydrated
      // on the prior search — must now reflect all 6.
      assert.equal(
        await R.count(NS), 6,
        `AC-P3-1: R.count() must converge to 6 after refresh (was stuck at 3 pre-fix)`,
      );

      // All of batch B must be searchable from the refreshed handle.
      for (const e of B) {
        const seed = Number(e.content.replace(/\D/g, '')) || 0;
        const hits = await R.search(e.embedding, { k: 10, threshold: 0, filters: { namespace: NS } });
        assert.ok(
          hits.some(h => h.entry.key === e.key),
          `AC-P3-2: refreshed R must find ${e.key}; got [${hits.map(h => h.entry.key).join(', ')}]`,
        );
      }

      // AC-P3-3: the refresh path must announce itself LOUDLY — either the
      // ensureFresh reopen warning ("detected external commit ... refreshing")
      // OR the d8 stale-native backstop ("native semantic scan returned 0 hits
      // but N entries are loaded"). It must NOT silently return empty. We
      // assert at least one ADR-0167 Phase 3 warning surfaced during the
      // converging search.
      const allWarnings = warnings.join('\n');
      assert.match(
        allWarnings,
        /ADR-0167 Phase 3/,
        `AC-P3-3: a loud ADR-0167 Phase 3 warning (refresh or stale-native backstop) must fire ` +
        `during the converging search — never a silent empty. Captured:\n${allWarnings || '(none)'}`,
      );

      // Control: a fresh reopen R3 also converges (proves the file + native
      // path are healthy; the defect was purely warm-handle staleness).
      const R3 = await mk();
      try {
        assert.equal(await R3.count(NS), 6, 'fresh reopen R3 must see all 6 entries');
        const r3b1 = await R3.search(vecFor(101), { k: 10, threshold: 0, filters: { namespace: NS } });
        assert.ok(r3b1.some(r => r.entry.key === 'b1'), 'fresh reopen R3 must find b1');
      } finally {
        await R3.shutdown();
      }
    } finally {
      console.warn = originalWarn;
      try { if (R) await R.shutdown(); } catch {}
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  });
});

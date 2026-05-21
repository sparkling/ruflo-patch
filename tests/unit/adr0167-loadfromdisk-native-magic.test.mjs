// ADR-0167 amendment 2026-05-21: pure-TS loadFromDisk must recognise native
// magic and NOT declare such files corrupt.
//
// Phase-1 (RVFROOT\0 RootHeader) taught three JS read sites to recognise
// native magic, but the loadFromDisk preflight latched the `RVFR` prefix only
// when the FULL 8 bytes `RVFROOT\0` were present. A partial `RVFR` (peer
// mid-creating the header) or a TOCTOU between peek and readFile slipped
// through, set loadPath, and tripped the :2768 corruption check with
// `bad magic bytes (got 'RVFR')` — failing 7/8 concurrent native inits (bug4).
//
// Contract pinned here (was previously unpinned — that is how the gap shipped):
//   1. pure-TS loadFromDisk MUST NOT corrupt-fail a file whose magic is native
//      — SFVR (legacy), full RVFROOT\0, OR a bare RVFR prefix. (`RVFR`, byte[3]
//      = 'R', can NEVER be a pure-TS file, whose magic is RVF\0 / byte[3]=0x00.)
//   2. genuinely-corrupt NON-native pure-TS files MUST STILL fail loud
//      (ADR-0090 fail-loud preserved — no silent data loss).
//
// Loads the built rvf-backend.js the same way bug4-storage-init-concurrent does;
// works in both native (@ruvector/rvf-node present) and pure-TS modes.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function findRvfBackendDist() {
  const candidates = [
    '/tmp/ruflo-build/dist/v3/@claude-flow/memory/src/rvf-backend.js',
    '/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js',
    '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js',
  ];
  for (const c of candidates) if (existsSync(c)) {
    // Sanity: the transitive hnsw-lite.js sibling must be present too.
    if (existsSync(c.replace('rvf-backend.js', 'hnsw-lite.js'))) return c;
  }
  return null;
}

const dist = findRvfBackendDist();

async function initOnBytes(bytes) {
  const { RvfBackend } = await import(dist);
  const dir = mkdtempSync(join(tmpdir(), 'adr0167-magic-'));
  const dbPath = join(dir, 'shared.rvf');
  writeFileSync(dbPath, Buffer.from(bytes));
  const b = new RvfBackend({ databasePath: dbPath, dimensions: 8, autoPersistInterval: 0 });
  let err = null;
  try { await b.initialize(); } catch (e) { err = e?.message || String(e); }
  try { if (typeof b.shutdown === 'function') await b.shutdown().catch(() => {}); } catch {}
  rmSync(dir, { recursive: true, force: true });
  return err;
}

describe('ADR-0167: pure-TS loadFromDisk recognises native magic (not corrupt)', () => {
  const nativeMagicCases = [
    ['SFVR (legacy native)', [...Buffer.from('SFVR'), 1, 2, 3, 4]],
    ['RVFROOT\\0 (full RootHeader)', [...Buffer.from('RVFROOT'), 0, 9, 9, 9, 9]],
    ['RVFR (bare RootHeader prefix — partial / TOCTOU)', [...Buffer.from('RVFR'), 7, 7, 7, 7]],
  ];

  for (const [name, bytes] of nativeMagicCases) {
    it(`does NOT corrupt-fail ${name}`, { skip: !dist ? 'rvf-backend dist absent' : false }, async () => {
      const err = await initOnBytes(bytes);
      assert.ok(
        !err || !/bad magic|corrupt/i.test(err),
        `native-magic file must not be declared corrupt by pure-TS loadFromDisk; got: ${err}`,
      );
    });
  }

  it('STILL fail-loud on genuine non-native corruption (ADR-0090 preserved)', { skip: !dist ? 'rvf-backend dist absent' : false }, async () => {
    const err = await initOnBytes([...Buffer.from('XXXXYYYY')]);
    assert.ok(
      err && /bad magic|corrupt/i.test(err),
      `genuine corrupt pure-TS file must fail loud (ADR-0090); got: ${err ?? 'no error thrown'}`,
    );
  });
});

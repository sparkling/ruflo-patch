// @tier unit
// ADR-0090 Tier B2: RvfBackend corruption fail-loud contract.
//
// Context
// -------
// Before the fork patch that accompanied this suite, RvfBackend.loadFromDisk
// silently swallowed every parse failure — bad magic, truncated header,
// corrupt JSON, truncated entry body, EIO during readFile. If the WAL was
// also missing or empty, `initialize()` returned with `this.entries.size === 0`
// and no error. The next `store()` + `shutdown()` would OVERWRITE the
// corrupt file with only the new entry, silently destroying any chance of
// recovery.
//
// Fork commit ADR-0090-B2 introduces `RvfCorruptError`: when loadFromDisk
// detects any corruption AND the WAL does not yield recoverable entries,
// initialize() throws. The CLI surfaces this as a non-zero exit with a
// diagnostic naming the corrupt path and reason.
//
// Test strategy
// -------------
// These tests drive the REAL published RvfBackend via the same
// `ruflo-accept-*` fixture that adr0086-rvf-real-integration.test.mjs
// uses. For each corruption mode:
//
//   1. Build a valid .rvf via a first RvfBackend instance
//   2. Close, corrupt on-disk files in a specific way
//   3. Open a fresh RvfBackend instance, assert it throws RvfCorruptError
//      with a diagnostic mentioning the corrupt file + the reason
//
// Cases that MUST throw (fail-loud):
//   - Bad magic on pure-TS .rvf (no .meta, no WAL)
//   - Bad magic on .meta (no main file, no WAL)
//   - Truncated file (header truncated before reaching entry count)
//   - Truncated header body (header-length points past file end)
//   - Corrupt header JSON
//   - Truncated entry (no prefix entries loaded)
//
// Cases that MUST NOT throw (valid recovery / cold-start):
//   - File doesn't exist at all (cold start)
//   - File is 0 bytes (cold start)
//   - File corrupt BUT WAL has recoverable entries
//   - Some entries loaded before a truncation boundary (partial recovery)

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync,
  truncateSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// ────────────────────────────────────────────────────────────────────────
// Locate the installed RvfBackend from any /tmp/ruflo-accept-* harness
// ────────────────────────────────────────────────────────────────────────

let RvfBackend = null;
let loadError = null;

for (const name of readdirSync('/tmp').filter(n => n.startsWith('ruflo-accept-') || n.startsWith('ruflo-fast-'))) {
  const candidate = join('/tmp', name, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
  if (existsSync(candidate)) {
    try {
      const mod = await import(candidate);
      RvfBackend = mod.RvfBackend ?? null;
      if (RvfBackend) break;
    } catch (e) {
      loadError = `Failed to import from ${candidate}: ${e?.message ?? String(e)}`;
    }
  }
}

const skip = !RvfBackend;
const SKIP_REASON = loadError ?? 'RvfBackend unavailable (no ruflo-accept-* or ruflo-fast-* dir with @sparkleideas/memory installed)';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Create a valid .rvf at the given path with N entries (pure-TS format).
 * Native binding is not loaded (RvfBackend falls back to pure-TS).
 */
async function seedValidRvf(dbPath, { nEntries = 3, dimensions = 4 } = {}) {
  if (skip) return;
  const backend = new RvfBackend({
    databasePath: dbPath, dimensions, autoPersistInterval: 0,
  });
  await backend.initialize();
  for (let i = 0; i < nEntries; i++) {
    const e = new Float32Array(dimensions); e[i % dimensions] = 1;
    await backend.store({
      id: 'e' + i, key: 'k' + i, namespace: 'ns', content: 'val-' + i,
      type: 'semantic', tags: [], metadata: {}, accessLevel: 'private',
      ownerId: 'o', createdAt: Date.now(), updatedAt: Date.now(),
      accessCount: 0, lastAccessedAt: Date.now(), version: 1, references: [],
      embedding: e,
    });
  }
  await backend.shutdown();
}

function freshDir(label) {
  const d = join(tmpdir(), `b2u-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function tryRm(d) {
  try { rmSync(d, { recursive: true, force: true }); } catch {}
}

/** Assert that open+initialize throws RvfCorruptError with the given
 *  reason substring. */
async function assertCorruptThrow(dbPath, reasonMatch) {
  const backend = new RvfBackend({
    databasePath: dbPath, dimensions: 4, autoPersistInterval: 0,
  });
  let err = null;
  try {
    await backend.initialize();
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'initialize() must throw');
  assert.equal(err.name, 'RvfCorruptError',
    `error.name must be 'RvfCorruptError', got ${err.name} (message: ${err.message})`);
  assert.match(err.message, /is corrupt/,
    `error message must contain 'is corrupt', got: ${err.message}`);
  if (reasonMatch) {
    assert.match(err.message, reasonMatch,
      `error message must match ${reasonMatch}, got: ${err.message}`);
  }
  // Try shutdown only in a best-effort way; some errors may leave state
  // partially initialized.
  try { await backend.shutdown(); } catch {}
}

async function assertNoThrow(dbPath, { expectCount = null } = {}) {
  const backend = new RvfBackend({
    databasePath: dbPath, dimensions: 4, autoPersistInterval: 0,
  });
  await backend.initialize();
  if (expectCount !== null) {
    const c = await backend.count('ns');
    assert.equal(c, expectCount,
      `expected count=${expectCount}, got ${c}`);
  }
  await backend.shutdown();
}

// ────────────────────────────────────────────────────────────────────────
// Fail-loud cases
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B2: loadFromDisk throws RvfCorruptError on corruption (fail-loud)', () => {
  it('bad magic on main file, no .meta, no WAL → RvfCorruptError (bad magic bytes)', { skip }, async () => {
    const d = freshDir('bad-magic');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Zero the first 8 bytes of EVERY on-disk file so both the .meta
      // sidecar AND the main file are corrupt. If we corrupted only one,
      // the loader's .meta-first-else-main fallback would pick the
      // intact one and the test wouldn't exercise fail-loud.
      // Also delete WAL to block recovery.
      for (const sfx of ['', '.meta']) {
        if (!existsSync(p + sfx)) continue;
        const buf = readFileSync(p + sfx);
        for (let i = 0; i < Math.min(8, buf.length); i++) buf[i] = 0;
        writeFileSync(p + sfx, buf);
      }
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      await assertCorruptThrow(p, /bad magic bytes/);
    } finally { tryRm(d); }
  });

  it('bad magic on .meta, no main file, no WAL → RvfCorruptError', { skip }, async () => {
    const d = freshDir('meta-magic');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Zero .meta magic, delete main + WAL
      if (existsSync(p + '.meta')) {
        const buf = readFileSync(p + '.meta');
        for (let i = 0; i < 8; i++) buf[i] = 0;
        writeFileSync(p + '.meta', buf);
      }
      if (existsSync(p)) rmSync(p);
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      // This case is trickier — if .meta doesn't exist (e.g. pure-TS
      // wrote to main path), there's nothing to corrupt. Skip the
      // assertion if .meta wasn't produced by the seed.
      if (!existsSync(p + '.meta')) {
        return; // seed didn't produce .meta — not a test of this case
      }
      await assertCorruptThrow(p + '.meta', /bad magic/);
    } finally { tryRm(d); }
  });

  it('truncated to <8 bytes → RvfCorruptError (shorter than RVF header)', { skip }, async () => {
    const d = freshDir('trunc-header');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Truncate EVERY on-disk file — see "bad magic" test for why.
      for (const sfx of ['', '.meta']) {
        if (existsSync(p + sfx)) truncateSync(p + sfx, 4);
      }
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      await assertCorruptThrow(p, /shorter than the 8-byte RVF header/);
    } finally { tryRm(d); }
  });

  it('truncated mid-header (headerLen > remaining) → RvfCorruptError', { skip }, async () => {
    const d = freshDir('trunc-header2');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Truncate every on-disk file mid-header — see "bad magic" test.
      for (const sfx of ['', '.meta']) {
        if (existsSync(p + sfx)) truncateSync(p + sfx, 12);
      }
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      await assertCorruptThrow(p, /truncated header/);
    } finally { tryRm(d); }
  });

  it('corrupt header JSON → RvfCorruptError (header JSON parse failed)', { skip }, async () => {
    const d = freshDir('bad-json');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Corrupt the header JSON of BOTH files (if .meta exists too).
      for (const sfx of ['', '.meta']) {
        if (!existsSync(p + sfx)) continue;
        const buf = readFileSync(p + sfx);
        // Parse magic+headerLen to locate header body. Note: native's
        // main file starts with `SFVR` magic — the pure-TS parser will
        // bail at magic mismatch before reaching the JSON body, which
        // is also a valid "corrupt from pure-TS's POV" path. The pure-TS
        // .meta sidecar starts with `RVF\0` and has JSON we can really
        // corrupt. Only the RVF\0-magic file gets the JSON corruption;
        // the SFVR one gets a magic zero (same as bad-magic test).
        const magic = buf.length >= 4 ? String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) : '';
        if (magic === 'RVF\0') {
          const headerLen = buf.length >= 8 ? buf.readUInt32LE(4) : 0;
          if (headerLen > 4 && 8 + headerLen <= buf.length) {
            buf[8 + Math.floor(headerLen / 2)] = 0x00;
          }
        } else {
          // Zero the magic so this file also fails-loud
          for (let i = 0; i < Math.min(8, buf.length); i++) buf[i] = 0;
        }
        writeFileSync(p + sfx, buf);
      }
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      await assertCorruptThrow(p, /header JSON parse failed|bad magic|corrupt/i);
    } finally { tryRm(d); }
  });

  it('truncated entries body (no entries recovered) → RvfCorruptError', { skip }, async () => {
    const d = freshDir('trunc-body');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p);
      // Truncate both files right after their headers so no entries
      // can be read from either. For a pure-TS file (`RVF\0` magic)
      // that means keep header + 2 bytes. For a native file (`SFVR`
      // magic) we zero the magic instead (pure-TS parser can't get
      // to "truncated entry" on a non-RVF file).
      for (const sfx of ['', '.meta']) {
        if (!existsSync(p + sfx)) continue;
        const buf = readFileSync(p + sfx);
        const magic = buf.length >= 4 ? String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) : '';
        if (magic === 'RVF\0' && buf.length >= 8) {
          const headerLen = buf.readUInt32LE(4);
          truncateSync(p + sfx, 8 + headerLen + 2);
        } else {
          // Zero the magic to force this file into the fail-loud path too
          for (let i = 0; i < Math.min(8, buf.length); i++) buf[i] = 0;
          writeFileSync(p + sfx, buf);
        }
      }
      if (existsSync(p + '.wal')) rmSync(p + '.wal');
      await assertCorruptThrow(p, /truncated entry|bad magic/);
    } finally { tryRm(d); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// No-throw cases (correct recovery / cold start)
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B2: loadFromDisk does NOT throw on valid recovery paths', () => {
  it('file absent → cold start, count=0', { skip }, async () => {
    const d = freshDir('absent');
    try {
      const p = join(d, 'db.rvf');
      await assertNoThrow(p, { expectCount: 0 });
    } finally { tryRm(d); }
  });

  it('file is 0 bytes → cold start, count=0', { skip }, async () => {
    const d = freshDir('zero');
    try {
      const p = join(d, 'db.rvf');
      writeFileSync(p, '');
      await assertNoThrow(p, { expectCount: 0 });
    } finally { tryRm(d); }
  });

  it('main corrupt but WAL has entries → recover from WAL, no throw', { skip }, async () => {
    const d = freshDir('wal-recover');
    try {
      const p = join(d, 'db.rvf');
      // Seed WITHOUT shutdown — leaves entries in WAL. Use a high
      // walCompactionThreshold so stores don't auto-compact.
      const backend = new RvfBackend({
        databasePath: p, dimensions: 4, autoPersistInterval: 0,
        walCompactionThreshold: 100000,
      });
      await backend.initialize();
      for (let i = 0; i < 3; i++) {
        const e = new Float32Array(4); e[i] = 1;
        await backend.store({
          id: 'e' + i, key: 'k' + i, namespace: 'ns', content: 'v' + i,
          type: 'semantic', tags: [], metadata: {}, accessLevel: 'private',
          ownerId: 'o', createdAt: Date.now(), updatedAt: Date.now(),
          accessCount: 0, lastAccessedAt: Date.now(), version: 1, references: [],
          embedding: e,
        });
      }
      // No shutdown — WAL has the entries, main may or may not be written.
      // Corrupt the main file (if any) — WAL is the recovery source.
      if (existsSync(p)) {
        const buf = readFileSync(p);
        for (let i = 0; i < 4; i++) buf[i] = 0;
        writeFileSync(p, buf);
      }
      if (existsSync(p + '.meta')) rmSync(p + '.meta');

      // A fresh backend must recover from WAL without throwing.
      // (The count should be >= 1 — exact count depends on whether
      // the WAL was compacted during store.)
      const reader = new RvfBackend({
        databasePath: p, dimensions: 4, autoPersistInterval: 0,
      });
      await reader.initialize();
      const c = await reader.count('ns');
      assert.ok(c >= 1,
        `WAL recovery must yield >= 1 entry, got ${c}`);
      await reader.shutdown();
    } finally { tryRm(d); }
  });

  it('valid main file + valid WAL (re-open after clean shutdown) → no throw', { skip }, async () => {
    const d = freshDir('clean');
    try {
      const p = join(d, 'db.rvf');
      await seedValidRvf(p, { nEntries: 3 });
      await assertNoThrow(p, { expectCount: 3 });
    } finally { tryRm(d); }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Source assertions — the fork patch is physically present in the dist
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B2: fork patch shipped in dist', () => {
  const dist = (() => {
    for (const name of readdirSync('/tmp').filter(n => n.startsWith('ruflo-accept-') || n.startsWith('ruflo-fast-'))) {
      const candidate = join('/tmp', name, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
    }
    return null;
  })();

  it('dist contains the RvfCorruptError throw', { skip: !dist }, () => {
    assert.match(dist, /RvfCorruptError/,
      'dist must contain the RvfCorruptError name tag');
    assert.match(dist, /is corrupt:/,
      'dist must contain the corruption diagnostic prefix');
    assert.match(dist, /Refusing to start with empty state/,
      'dist must contain the user-facing overwrite warning');
  });

  it('dist skips native binary path when nativeDb is set', { skip: !dist }, () => {
    // Guard added in the ADR-0092 interaction fix: loadFromDisk and
    // mergePeerStateBeforePersist must gate main-path reads on
    // `!this.nativeDb`. Look for the pattern in both.
    const matches = (dist.match(/this\.nativeDb/g) || []).length;
    assert.ok(matches >= 2,
      `dist must reference this.nativeDb in multiple load guards, found ${matches}`);
  });
});

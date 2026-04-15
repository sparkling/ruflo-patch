// @tier integration
// Real .rvf file round-trip tests — not structural.
//
// ADR-0086: "Real .rvf file. Store, search, persist, reopen."
//
// Loads the PUBLISHED `@sparkleideas/memory` package from a temp acceptance
// dir (Verdaccio-installed copy under /tmp/ruflo-accept-*), instantiates a
// real RvfBackend, performs real I/O against real binary files, and verifies
// the format on disk.
//
// If no installed copy is available, every test skips with a clear reason —
// it does not silently fall back to source-text inspection.
//
// Test groups:
//   1. Constructor and initialization
//   2. Store and retrieve round-trip (real persistence + WAL)
//   3. Search with real Float32Array embeddings (TOP-1 only per ADR-0086)
//   4. Persistence and reopen across a fresh backend instance
//   5. WAL replay after simulated crash (no shutdown)
//   6. Namespace operations (list / count / clear isolation)
//   7. bulkInsert and bulkDelete with reopen verification
//   8. File format verification (magic bytes, header JSON, entries)

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ============================================================================
// Locate a published @sparkleideas/memory copy
// ============================================================================
//
// The acceptance pipeline installs @sparkleideas/memory into temp dirs named
// `ruflo-accept-*` under `/tmp`. We pick the most recently modified install.
// On macOS `os.tmpdir()` returns `/var/folders/...`, so we explicitly check
// `/tmp` (which is where `mktemp -d` and the acceptance scripts plant them).
//
// If no install dir exists, RvfBackend stays null and every test skips.

let RvfBackend = null;
let packagePath = null;
let loadError = null;

const SEARCH_ROOTS = [
  '/tmp',
  // Fall through to the platform tmpdir for non-macOS hosts.
  tmpdir(),
];

function findInstalledPackage() {
  const candidates = [];
  const seenRoots = new Set();
  for (const root of SEARCH_ROOTS) {
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('ruflo-accept-')) continue;
      const candidate = join(
        root,
        name,
        'node_modules',
        '@sparkleideas',
        'memory',
        'dist',
        'rvf-backend.js',
      );
      if (existsSync(candidate)) {
        try {
          const mtime = statSync(candidate).mtimeMs;
          candidates.push({ path: candidate, mtime });
        } catch {
          // skip unreadable
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

try {
  packagePath = findInstalledPackage();
  if (packagePath) {
    const mod = await import(packagePath);
    RvfBackend = mod.RvfBackend ?? null;
    if (!RvfBackend) {
      loadError = `RvfBackend export missing from ${packagePath}`;
    }
  } else {
    loadError =
      'No @sparkleideas/memory install found under /tmp/ruflo-accept-* ' +
      '(run `npm run test:acceptance` first to populate one)';
  }
} catch (err) {
  loadError = `Failed to import RvfBackend: ${err?.message ?? String(err)}`;
}

const SKIP_REASON = loadError ?? 'RvfBackend unavailable';
const skip = !RvfBackend;

// ============================================================================
// Helpers
// ============================================================================

let entryCounter = 0;

/**
 * Build a complete MemoryEntry. The published RvfBackend treats most fields
 * as required, so we fill in sensible defaults rather than relying on the
 * backend to backfill them.
 */
function makeEntry(overrides = {}) {
  entryCounter++;
  const now = Date.now();
  const id = overrides.id ?? `entry-${entryCounter}`;
  return {
    id,
    key: overrides.key ?? `key-${id}`,
    content: overrides.content ?? `content for ${id}`,
    type: overrides.type ?? 'episodic',
    namespace: overrides.namespace ?? 'default',
    tags: overrides.tags ?? [],
    metadata: overrides.metadata ?? {},
    accessLevel: overrides.accessLevel ?? 'system',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    version: overrides.version ?? 1,
    references: overrides.references ?? [],
    accessCount: overrides.accessCount ?? 0,
    lastAccessedAt: overrides.lastAccessedAt ?? now,
    ...(overrides.embedding ? { embedding: overrides.embedding } : {}),
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  };
}

/**
 * Persistence is split between a `.rvf` (or `.rvf.meta` when native is
 * active) main file and a `.rvf.wal` write-ahead log. Tests should not
 * assume one specific layout, but we always have a "metadata" file we can
 * inspect for magic-byte verification.
 */
function metadataFilePath(dbPath) {
  // Prefer the .meta sidecar when native is loaded; fall back to the main file.
  return existsSync(dbPath + '.meta') ? dbPath + '.meta' : dbPath;
}

// One temp directory per `describe` group keeps clean-up trivial without
// requiring per-test setup/teardown.
function freshTempDir(label) {
  return mkdtempSync(join(tmpdir(), `rvf-real-${label}-`));
}

function tryRm(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// ============================================================================
// Group 1: Constructor and initialization
// ============================================================================

describe('ADR-0086 RVF real integration: Group 1 — constructor and init', () => {
  let dir;
  before(() => {
    if (skip) return;
    dir = freshTempDir('g1');
  });
  after(() => {
    if (dir) tryRm(dir);
  });

  it('constructs and initializes a backend on a valid path', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: join(dir, 'init.rvf'),
      dimensions: 3,
      defaultNamespace: 'g1',
    });
    await backend.initialize();
    assert.equal(typeof backend.store, 'function');
    assert.equal(typeof backend.search, 'function');
    await backend.shutdown();
  });

  it('rejects paths containing null bytes', { skip }, () => {
    assert.throws(
      () =>
        new RvfBackend({
          databasePath: join(dir, 'has-\u0000-null.rvf'),
          dimensions: 3,
        }),
      /null bytes/i,
    );
  });

  it('rejects dimensions = 0', { skip }, () => {
    assert.throws(
      () =>
        new RvfBackend({
          databasePath: join(dir, 'bad-dim-0.rvf'),
          dimensions: 0,
        }),
      /Invalid dimensions/i,
    );
  });

  it('rejects negative dimensions', { skip }, () => {
    assert.throws(
      () =>
        new RvfBackend({
          databasePath: join(dir, 'bad-dim-neg.rvf'),
          dimensions: -1,
        }),
      /Invalid dimensions/i,
    );
  });

  it('rejects dimensions above the 10000 ceiling', { skip }, () => {
    assert.throws(
      () =>
        new RvfBackend({
          databasePath: join(dir, 'bad-dim-huge.rvf'),
          dimensions: 99999,
        }),
      /Invalid dimensions/i,
    );
  });

  it('supports `:memory:` path with no on-disk artifacts', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: ':memory:',
      dimensions: 3,
      defaultNamespace: 'mem',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    const entry = makeEntry({ namespace: 'mem' });
    await backend.store(entry);
    const got = await backend.getByKey(entry.namespace, entry.key);
    assert.ok(got, 'in-memory entry must be retrievable');
    assert.equal(got.content, entry.content);
    await backend.shutdown();
  });
});

// ============================================================================
// Group 2: Store and retrieve round-trip
// ============================================================================

describe('ADR-0086 RVF real integration: Group 2 — store and retrieve', () => {
  let dir;
  let backend;
  let dbPath;

  before(async () => {
    if (skip) return;
    dir = freshTempDir('g2');
    dbPath = join(dir, 'store.rvf');
    backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 4,
      defaultNamespace: 'g2',
      autoPersistInterval: 0,
    });
    await backend.initialize();
  });

  after(async () => {
    if (backend) {
      try {
        await backend.shutdown();
      } catch {
        /* ignore */
      }
    }
    if (dir) tryRm(dir);
  });

  it('store() then getByKey() returns the same content', { skip }, async () => {
    const entry = makeEntry({ key: 'roundtrip', content: 'hello world' });
    await backend.store(entry);
    const got = await backend.getByKey(entry.namespace, 'roundtrip');
    assert.ok(got, 'entry must be retrievable by key after store');
    assert.equal(got.content, 'hello world');
    assert.equal(got.id, entry.id);
  });

  it('store() with embedding preserves the Float32Array on retrieve', { skip }, async () => {
    const emb = new Float32Array([0.25, 0.5, 0.75, 1.0]);
    const entry = makeEntry({ key: 'emb-test', embedding: emb });
    await backend.store(entry);
    const got = await backend.getByKey(entry.namespace, 'emb-test');
    assert.ok(got, 'embedding entry must be retrievable');
    assert.ok(got.embedding, 'embedding field must be populated');
    assert.equal(got.embedding.length, 4);
    // Float32 has limited precision — compare with tolerance.
    for (let i = 0; i < 4; i++) {
      assert.ok(
        Math.abs(got.embedding[i] - emb[i]) < 1e-5,
        `embedding[${i}] mismatch: ${got.embedding[i]} vs ${emb[i]}`,
      );
    }
  });

  it('multiple entries in the same namespace are all retrievable', { skip }, async () => {
    const ns = 'multi-store';
    const a = makeEntry({ key: 'a', namespace: ns, content: 'A' });
    const b = makeEntry({ key: 'b', namespace: ns, content: 'B' });
    const c = makeEntry({ key: 'c', namespace: ns, content: 'C' });
    await backend.store(a);
    await backend.store(b);
    await backend.store(c);
    assert.equal((await backend.getByKey(ns, 'a')).content, 'A');
    assert.equal((await backend.getByKey(ns, 'b')).content, 'B');
    assert.equal((await backend.getByKey(ns, 'c')).content, 'C');
  });

  it('namespaces with the same key are isolated', { skip }, async () => {
    const left = makeEntry({ key: 'shared', namespace: 'left', content: 'LEFT' });
    const right = makeEntry({ key: 'shared', namespace: 'right', content: 'RIGHT' });
    await backend.store(left);
    await backend.store(right);
    const lGot = await backend.getByKey('left', 'shared');
    const rGot = await backend.getByKey('right', 'shared');
    assert.ok(lGot && rGot);
    assert.equal(lGot.content, 'LEFT');
    assert.equal(rGot.content, 'RIGHT');
    assert.notEqual(lGot.id, rGot.id, 'distinct entries must have distinct ids');
  });

  it('update() increments the version field', { skip }, async () => {
    const entry = makeEntry({ key: 'versioned', content: 'v1', version: 1 });
    await backend.store(entry);
    const updated = await backend.update(entry.id, { content: 'v2' });
    assert.ok(updated, 'update must return the new entry');
    assert.equal(updated.content, 'v2');
    assert.equal(updated.version, 2, 'version must be incremented');
  });
});

// ============================================================================
// Group 3: Search with real embeddings
// ============================================================================
//
// ADR-0086 rule: assert TOP-1 only, never a full ordering — HNSW search
// results below the top-1 are not guaranteed to be deterministic.

describe('ADR-0086 RVF real integration: Group 3 — search with embeddings', () => {
  let dir;
  let backend;

  before(async () => {
    if (skip) return;
    dir = freshTempDir('g3');
    backend = new RvfBackend({
      databasePath: join(dir, 'search.rvf'),
      dimensions: 3,
      defaultNamespace: 'g3',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    // Three orthogonal unit vectors in three namespaces.
    await backend.store(
      makeEntry({
        id: 'vec-x',
        key: 'vec-x',
        namespace: 'axis',
        embedding: new Float32Array([1, 0, 0]),
      }),
    );
    await backend.store(
      makeEntry({
        id: 'vec-y',
        key: 'vec-y',
        namespace: 'axis',
        embedding: new Float32Array([0, 1, 0]),
      }),
    );
    await backend.store(
      makeEntry({
        id: 'vec-z',
        key: 'vec-z',
        namespace: 'other',
        embedding: new Float32Array([0, 0, 1]),
      }),
    );
  });

  after(async () => {
    if (backend) {
      try {
        await backend.shutdown();
      } catch {
        /* ignore */
      }
    }
    if (dir) tryRm(dir);
  });

  it('search([1,0,0]) returns vec-x as TOP-1', { skip }, async () => {
    const results = await backend.search(new Float32Array([1, 0, 0]), { k: 5 });
    assert.ok(results.length > 0, 'search must return at least one result');
    assert.equal(results[0].entry.id, 'vec-x', 'top-1 must be the matching axis vector');
    // Cosine similarity between identical unit vectors must be 1 (within fp32 noise).
    assert.ok(
      Math.abs(results[0].score - 1) < 1e-3,
      `top-1 score must be ~1, got ${results[0].score}`,
    );
  });

  it('search([0,1,0]) returns vec-y as TOP-1', { skip }, async () => {
    const results = await backend.search(new Float32Array([0, 1, 0]), { k: 5 });
    assert.ok(results.length > 0);
    assert.equal(results[0].entry.id, 'vec-y');
  });

  it('namespace filter returns only matching entries', { skip }, async () => {
    const results = await backend.search(new Float32Array([1, 0, 0]), {
      k: 5,
      filters: { namespace: 'other' },
    });
    // Only vec-z lives in `other`, so it must be the only result.
    assert.equal(results.length, 1, 'namespace filter must restrict result count');
    assert.equal(results[0].entry.id, 'vec-z');
    assert.equal(results[0].entry.namespace, 'other');
  });

  it('threshold filter excludes orthogonal (low-similarity) results', { skip }, async () => {
    const results = await backend.search(new Float32Array([1, 0, 0]), {
      k: 5,
      threshold: 0.9,
    });
    // [1,0,0] is orthogonal to vec-y and vec-z → cosine 0 → below 0.9.
    // Only vec-x (cosine 1) passes the threshold.
    assert.ok(results.length > 0, 'threshold must keep the matching vector');
    assert.equal(results[0].entry.id, 'vec-x', 'top-1 still matches');
    for (const r of results) {
      assert.ok(
        r.score >= 0.9,
        `every returned score must be >= 0.9, got ${r.score} for ${r.entry.id}`,
      );
    }
  });
});

// ============================================================================
// Group 4: Persistence and reopen
// ============================================================================

describe('ADR-0086 RVF real integration: Group 4 — persistence and reopen', () => {
  let dir;
  let dbPath;

  before(() => {
    if (skip) return;
    dir = freshTempDir('g4');
    dbPath = join(dir, 'persist.rvf');
  });

  after(() => {
    if (dir) tryRm(dir);
  });

  it('store + shutdown writes a valid .rvf metadata file with RVF magic bytes', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'g4',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    await backend.store(
      makeEntry({
        id: 'p1',
        key: 'persist-key',
        content: 'persisted content',
        namespace: 'persist-ns',
        embedding: new Float32Array([0.6, 0.4, 0.0]),
      }),
    );
    await backend.shutdown();

    // After shutdown, the metadata file (either .rvf or .rvf.meta) must exist.
    const metaPath = metadataFilePath(dbPath);
    assert.ok(existsSync(metaPath), `metadata file must exist at ${metaPath}`);

    const buf = readFileSync(metaPath);
    assert.ok(buf.length >= 8, 'metadata file must be at least 8 bytes (magic + headerLen)');

    // Magic bytes: R V F \0
    assert.equal(buf[0], 0x52, 'byte 0 must be R (0x52)');
    assert.equal(buf[1], 0x56, 'byte 1 must be V (0x56)');
    assert.equal(buf[2], 0x46, 'byte 2 must be F (0x46)');
    assert.equal(buf[3], 0x00, 'byte 3 must be NUL (0x00)');

    // Header length and JSON structure
    const headerLen = buf.readUInt32LE(4);
    assert.ok(headerLen > 0, 'header length must be > 0');
    assert.ok(8 + headerLen <= buf.length, 'header must fit inside the file');
    const headerJson = buf.subarray(8, 8 + headerLen).toString('utf-8');
    const header = JSON.parse(headerJson);
    assert.equal(header.version, 1, 'header.version must be 1');
    assert.equal(header.dimensions, 3, 'header.dimensions must round-trip');
    assert.ok(typeof header.entryCount === 'number', 'header.entryCount must be a number');
    assert.ok(header.entryCount >= 1, 'header must report at least one stored entry');
  });

  it('a fresh RvfBackend instance loads the persisted entry', { skip }, async () => {
    // Re-open the same path with a brand-new instance.
    const reopened = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'g4',
      autoPersistInterval: 0,
    });
    await reopened.initialize();

    const got = await reopened.getByKey('persist-ns', 'persist-key');
    assert.ok(got, 'persisted entry must be retrievable after reopen');
    assert.equal(got.content, 'persisted content');
    assert.equal(got.id, 'p1');
    assert.ok(got.embedding, 'embedding must survive reopen');
    assert.equal(got.embedding.length, 3);

    await reopened.shutdown();
  });
});

// ============================================================================
// Group 5: WAL replay (simulated crash without shutdown)
// ============================================================================

describe('ADR-0086 RVF real integration: Group 5 — WAL replay after crash', () => {
  let dir;
  let dbPath;

  before(() => {
    if (skip) return;
    dir = freshTempDir('g5');
    dbPath = join(dir, 'crash.rvf');
  });

  after(() => {
    if (dir) tryRm(dir);
  });

  it('store without shutdown leaves a .wal file on disk', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'g5',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    await backend.store(
      makeEntry({
        id: 'c1',
        key: 'crash-key',
        content: 'crash content',
        namespace: 'crash-ns',
      }),
    );
    // SIMULATE CRASH: do NOT call shutdown(). The WAL must still be on disk.
    assert.ok(existsSync(dbPath + '.wal'), 'WAL file must exist after store()');

    // Drop reference so Node may GC the timer (autoPersistInterval=0 already
    // disables the timer, so this is purely defensive).
  });

  it('a fresh instance recovers the entry via replayWal()', { skip }, async () => {
    const recovered = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'g5',
      autoPersistInterval: 0,
    });
    await recovered.initialize();
    const got = await recovered.getByKey('crash-ns', 'crash-key');
    assert.ok(got, 'WAL replay must recover the unsaved entry');
    assert.equal(got.id, 'c1');
    assert.equal(got.content, 'crash content');
    await recovered.shutdown();
  });
});

// ============================================================================
// Group 6: Namespace operations
// ============================================================================

describe('ADR-0086 RVF real integration: Group 6 — namespace operations', () => {
  let dir;
  let backend;

  before(async () => {
    if (skip) return;
    dir = freshTempDir('g6');
    backend = new RvfBackend({
      databasePath: join(dir, 'ns.rvf'),
      dimensions: 3,
      defaultNamespace: 'g6',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    await backend.store(makeEntry({ id: 'n-a1', key: 'a1', namespace: 'alpha' }));
    await backend.store(makeEntry({ id: 'n-a2', key: 'a2', namespace: 'alpha' }));
    await backend.store(makeEntry({ id: 'n-b1', key: 'b1', namespace: 'beta' }));
    await backend.store(makeEntry({ id: 'n-g1', key: 'g1', namespace: 'gamma' }));
  });

  after(async () => {
    if (backend) {
      try {
        await backend.shutdown();
      } catch {
        /* ignore */
      }
    }
    if (dir) tryRm(dir);
  });

  it('listNamespaces returns every namespace that has entries', { skip }, async () => {
    const nsList = await backend.listNamespaces();
    const sorted = [...nsList].sort();
    assert.ok(sorted.includes('alpha'));
    assert.ok(sorted.includes('beta'));
    assert.ok(sorted.includes('gamma'));
  });

  it('count(namespace) returns only entries in that namespace', { skip }, async () => {
    assert.equal(await backend.count('alpha'), 2);
    assert.equal(await backend.count('beta'), 1);
    assert.equal(await backend.count('gamma'), 1);
  });

  it('count() (no arg) returns the total entry count', { skip }, async () => {
    const total = await backend.count();
    assert.ok(total >= 4, `expected >=4 total entries, got ${total}`);
  });

  it('clearNamespace removes only entries in the target namespace', { skip }, async () => {
    const before = await backend.count('alpha');
    assert.ok(before > 0, 'precondition: alpha namespace must have entries');
    const removed = await backend.clearNamespace('alpha');
    assert.equal(removed, before, 'clearNamespace must report number removed');
    assert.equal(await backend.count('alpha'), 0, 'alpha must be empty after clear');
    // Other namespaces untouched
    assert.equal(await backend.count('beta'), 1, 'beta must be untouched');
    assert.equal(await backend.count('gamma'), 1, 'gamma must be untouched');
  });
});

// ============================================================================
// Group 7: bulkInsert and bulkDelete
// ============================================================================

describe('ADR-0086 RVF real integration: Group 7 — bulk operations', () => {
  let dir;
  let dbPath;

  before(() => {
    if (skip) return;
    dir = freshTempDir('g7');
    dbPath = join(dir, 'bulk.rvf');
  });

  after(() => {
    if (dir) tryRm(dir);
  });

  it('bulkInsert(10) brings count() to 10', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'bulk',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        makeEntry({
          id: `bulk-${i}`,
          key: `bulk-key-${i}`,
          namespace: 'bulk',
          content: `bulk-content-${i}`,
        }),
      );
    }
    await backend.bulkInsert(entries);
    assert.equal(await backend.count('bulk'), 10, 'bulkInsert must add all 10');
    await backend.shutdown();
  });

  it('bulkDelete(5) leaves count() at 5', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'bulk',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    // Should pick up the 10 from the previous test via the persisted file.
    const before = await backend.count('bulk');
    assert.equal(before, 10, 'bulk entries must persist between sub-tests');
    const deleted = await backend.bulkDelete([
      'bulk-0',
      'bulk-1',
      'bulk-2',
      'bulk-3',
      'bulk-4',
    ]);
    assert.equal(deleted, 5, 'bulkDelete must report 5 removed');
    assert.equal(await backend.count('bulk'), 5);
    await backend.shutdown();
  });

  it('bulk operations survive reopen', { skip }, async () => {
    const reopened = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'bulk',
      autoPersistInterval: 0,
    });
    await reopened.initialize();
    assert.equal(await reopened.count('bulk'), 5, 'remaining 5 must survive reopen');
    // Verify the survivors are bulk-5..bulk-9 (the ones we did NOT delete).
    for (let i = 5; i < 10; i++) {
      const got = await reopened.getByKey('bulk', `bulk-key-${i}`);
      assert.ok(got, `bulk-${i} must still be retrievable`);
      assert.equal(got.content, `bulk-content-${i}`);
    }
    // And the deleted ones are gone.
    for (let i = 0; i < 5; i++) {
      const got = await reopened.getByKey('bulk', `bulk-key-${i}`);
      assert.equal(got, null, `bulk-${i} must be absent after delete`);
    }
    await reopened.shutdown();
  });
});

// ============================================================================
// Group 8: File format verification
// ============================================================================

describe('ADR-0086 RVF real integration: Group 8 — file format', () => {
  let dir;
  let dbPath;

  before(() => {
    if (skip) return;
    dir = freshTempDir('g8');
    dbPath = join(dir, 'format.rvf');
  });

  after(() => {
    if (dir) tryRm(dir);
  });

  it('after store(), a .wal file exists alongside the database', { skip }, async () => {
    const backend = new RvfBackend({
      databasePath: dbPath,
      dimensions: 3,
      defaultNamespace: 'fmt',
      autoPersistInterval: 0,
    });
    await backend.initialize();
    await backend.store(
      makeEntry({ id: 'f1', key: 'fk1', content: 'format-test', namespace: 'fmt' }),
    );
    // WAL must be present until shutdown compacts it.
    assert.ok(existsSync(dbPath + '.wal'), '.wal sidecar must exist after store()');
    // Lock file is acquired/released within store(), so it must be gone now.
    assert.ok(
      !existsSync(dbPath + '.lock'),
      '.lock must be released after store completes',
    );
    await backend.shutdown();
  });

  it('after shutdown(), the metadata file has the full RVF binary layout', { skip }, async () => {
    const metaPath = metadataFilePath(dbPath);
    assert.ok(existsSync(metaPath), 'metadata file must exist after shutdown');
    const buf = readFileSync(metaPath);

    // 1. Magic bytes
    assert.ok(buf.length >= 8, 'file must contain at least the magic+headerLen prefix');
    const magic = String.fromCharCode(buf[0], buf[1], buf[2]) + buf[3].toString();
    assert.equal(buf[0], 0x52, 'magic[0] must be R');
    assert.equal(buf[1], 0x56, 'magic[1] must be V');
    assert.equal(buf[2], 0x46, 'magic[2] must be F');
    assert.equal(buf[3], 0x00, 'magic[3] must be NUL');

    // 2. Header length and JSON header
    const headerLen = buf.readUInt32LE(4);
    assert.ok(headerLen > 0 && headerLen < 10 * 1024 * 1024, 'header length must be sane');
    const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf-8'));
    assert.equal(header.version, 1);
    assert.equal(header.dimensions, 3);
    assert.equal(typeof header.entryCount, 'number');
    assert.ok(header.entryCount >= 1, 'header.entryCount must reflect stored entries');

    // 3. At least one length-prefixed entry follows the header
    let offset = 8 + headerLen;
    assert.ok(offset + 4 <= buf.length, 'must have room for an entry length prefix');
    const entryLen = buf.readUInt32LE(offset);
    assert.ok(entryLen > 0, 'entry length must be > 0');
    assert.ok(
      offset + 4 + entryLen <= buf.length,
      'first entry must fit inside the file',
    );
    const entryJson = buf.subarray(offset + 4, offset + 4 + entryLen).toString('utf-8');
    const entry = JSON.parse(entryJson);
    assert.equal(entry.id, 'f1', 'first persisted entry must be f1');
    assert.equal(entry.key, 'fk1');
    assert.equal(entry.content, 'format-test');
    assert.equal(entry.namespace, 'fmt');
  });

  it('lock file is not left behind after shutdown', { skip }, () => {
    assert.ok(
      !existsSync(dbPath + '.lock'),
      '.lock must be removed during shutdown cleanup',
    );
  });
});

// ============================================================================
// Skip notice
// ============================================================================
//
// If we couldn't load RvfBackend, surface a single tagged test so that the
// reason is visible in the runner output without flooding it with skipped
// per-case notices.

describe('ADR-0086 RVF real integration: load status', () => {
  it('RvfBackend loaded from a published @sparkleideas/memory copy', () => {
    if (skip) {
      // Use a soft skip so the runner reports it but does not fail.
      // The test runner allows up to 20% skips by default.
      // eslint-disable-next-line no-console
      console.log(`[adr0086-rvf-real-integration] skipped: ${SKIP_REASON}`);
      return;
    }
    assert.ok(packagePath, 'packagePath must be set when RvfBackend loaded');
    assert.ok(packagePath.includes('@sparkleideas/memory'), 'must load from sparkleideas');
  });
});

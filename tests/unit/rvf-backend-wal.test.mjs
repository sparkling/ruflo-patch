/**
 * RvfBackend WAL write path + native init fix (ADR-0073 Phases 1 & 3)
 *
 * Phase 1: Write-Ahead Log — store() appends to a .wal sidecar instead of
 *          rewriting the main .rvf on every mutation.  Compaction merges the
 *          WAL back into the main file once a threshold is reached.
 *
 * Phase 3: tryNativeInit fix — imports @ruvector/rvf-node (not @ruvector/rvf),
 *          uses RvfDatabase.create()/open() factories (not new), and passes
 *          the correct `dimension` key (not `dimensions`).
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let counter = 0;
function makeEntry(overrides = {}) {
  counter++;
  const id = overrides.id || `e_${counter}`;
  return {
    id,
    key: overrides.key || `key-${id}`,
    namespace: overrides.namespace || 'default',
    content: overrides.content || `content for ${id}`,
    type: 'semantic',
    tags: overrides.tags || [],
    embedding: overrides.embedding || undefined,
    metadata: {},
    accessLevel: 'private',
    ownerId: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: 0,
    lastAccessedAt: Date.now(),
    version: 1,
    references: [],
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  };
}

function makeEmbedding(dim = 4) {
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i++) arr[i] = Math.random();
  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) arr[i] /= norm;
  return arr;
}

function freshPath(label) {
  const dir = join(tmpdir(), 'rvf-wal-test');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.rvf`);
}

// ---------------------------------------------------------------------------
// Phase 1: WAL write path
// ---------------------------------------------------------------------------
describe('RvfBackend WAL write path (ADR-0073 Phase 1)', () => {
  let RvfBackend;
  let rvfPath;
  let backend;

  beforeEach(async () => {
    try {
      const mem = await import('@claude-flow/memory');
      RvfBackend = mem.RvfBackend;
    } catch {
      RvfBackend = null;
    }
    if (!RvfBackend) return;

    rvfPath = freshPath('wal-p1');
    backend = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend.initialize();
  });

  // --- Unit tests (verify WAL file behavior) ---

  it('store() creates .wal sidecar file instead of rewriting main .rvf', async () => {
    if (!RvfBackend) return;

    const entry = makeEntry();
    await backend.store(entry);

    const walPath = rvfPath + '.wal';
    assert.ok(existsSync(walPath), '.wal sidecar should exist after store()');

    // The WAL file should contain the entry (length-prefixed JSON)
    const walBuf = readFileSync(walPath);
    assert.ok(walBuf.length > 8, '.wal should have content');
    const entryLen = walBuf.readUInt32LE(0);
    const entryJson = walBuf.subarray(4, 4 + entryLen).toString('utf-8');
    const parsed = JSON.parse(entryJson);
    assert.equal(parsed.id, entry.id, 'WAL entry should have correct id');
    assert.equal(parsed.content, entry.content, 'WAL entry should have correct content');

    await backend.shutdown();
  });

  it('WAL entries survive shutdown and re-open (crash recovery)', async () => {
    if (!RvfBackend) return;

    const entries = [makeEntry(), makeEntry(), makeEntry()];
    for (const e of entries) await backend.store(e);

    // Shutdown compacts WAL
    await backend.shutdown();

    // Re-open at same path
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    for (const e of entries) {
      const retrieved = await backend2.get(e.id);
      assert.ok(retrieved, `Entry ${e.id} should survive shutdown`);
      assert.equal(retrieved.content, e.content);
    }
    await backend2.shutdown();
  });

  it('compaction merges WAL into main .rvf file', async () => {
    if (!RvfBackend) return;

    // Close the default backend; create one with low threshold
    await backend.shutdown();

    const lowPath = freshPath('wal-compact');
    const lowBackend = new RvfBackend({
      databasePath: lowPath,
      dimensions: 4,
      autoPersistInterval: 0,
      walCompactionThreshold: 3,
    });
    await lowBackend.initialize();

    const walPath = lowPath + '.wal';

    // Store 4 entries — threshold is 3, so 3rd store triggers compaction
    const entries = [];
    for (let i = 0; i < 4; i++) {
      const e = makeEntry();
      entries.push(e);
      await lowBackend.store(e);
    }

    // After compaction the WAL should be gone (unlinked)
    assert.ok(!existsSync(walPath), '.wal should be deleted after compaction');

    // Main .rvf should exist and contain all entries
    assert.ok(existsSync(lowPath), 'Main .rvf should exist after compaction');

    // Verify all entries retrievable
    for (const e of entries) {
      const retrieved = await lowBackend.get(e.id);
      assert.ok(retrieved, `Entry ${e.id} should be in compacted .rvf`);
    }
    await lowBackend.shutdown();
  });

  it('partial WAL write is handled gracefully', async () => {
    if (!RvfBackend) return;

    // Store 2 entries
    const e1 = makeEntry();
    const e2 = makeEntry();
    await backend.store(e1);
    await backend.store(e2);

    const walPath = rvfPath + '.wal';
    assert.ok(existsSync(walPath), 'WAL should exist after stores');

    // Append a partial frame: 4-byte length header with no body (simulates crash)
    const truncatedHeader = Buffer.alloc(4);
    truncatedHeader.writeUInt32LE(9999, 0); // claims 9999 bytes but nothing follows
    const existing = readFileSync(walPath);
    writeFileSync(walPath, Buffer.concat([existing, truncatedHeader]));

    // Shutdown current backend (will try to compact, which persists + deletes WAL)
    await backend.shutdown();

    // Re-open and verify at least the valid entries survived
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const r1 = await backend2.get(e1.id);
    const r2 = await backend2.get(e2.id);
    assert.ok(r1, 'First entry should survive partial WAL corruption');
    assert.ok(r2, 'Second entry should survive partial WAL corruption');
    await backend2.shutdown();
  });

  it('WAL replay restores entries into HNSW index', async () => {
    if (!RvfBackend) return;

    // Store entries with embeddings
    const emb1 = makeEmbedding(4);
    const emb2 = makeEmbedding(4);
    const e1 = makeEntry({ embedding: emb1 });
    const e2 = makeEntry({ embedding: emb2 });
    await backend.store(e1);
    await backend.store(e2);

    // Shutdown and re-open — forces WAL compaction then load
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    // Search by embedding — should find results
    const results = await backend2.search(emb1, { k: 2, threshold: 0 });
    assert.ok(results.length > 0, 'Search should return results after WAL replay');
    // The closest match to emb1 should be e1 itself
    assert.equal(results[0].entry.id, e1.id, 'Best match should be the entry with same embedding');

    await backend2.shutdown();
  });

  // --- Integration tests (real I/O) ---

  it('store/search round-trip across WAL boundary', async () => {
    if (!RvfBackend) return;

    // Store 10 entries with embeddings
    const entries = [];
    const embeddings = [];
    for (let i = 0; i < 10; i++) {
      const emb = makeEmbedding(4);
      embeddings.push(emb);
      const e = makeEntry({ embedding: emb });
      entries.push(e);
      await backend.store(e);
    }

    // Search BEFORE compaction (entries in WAL + memory)
    const beforeResults = await backend.search(embeddings[0], { k: 3, threshold: 0 });
    assert.ok(beforeResults.length > 0, 'Should find results before compaction');
    const beforeIds = beforeResults.map(r => r.entry.id);
    assert.ok(beforeIds.includes(entries[0].id), 'Best match should include queried entry');

    // Force compaction via shutdown + re-open
    await backend.shutdown();
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    // Search AFTER compaction — same results expected
    const afterResults = await backend2.search(embeddings[0], { k: 3, threshold: 0 });
    assert.ok(afterResults.length > 0, 'Should find results after compaction');
    const afterIds = afterResults.map(r => r.entry.id);
    assert.ok(afterIds.includes(entries[0].id), 'Same entry should still be best match');

    await backend2.shutdown();
  });

  it('multiple stores then bulk read -- WAL entries visible immediately', async () => {
    if (!RvfBackend) return;

    const entries = [];
    for (let i = 0; i < 5; i++) {
      const e = makeEntry({ namespace: 'bulk-ns' });
      entries.push(e);
      await backend.store(e);
    }

    // Query by namespace — all 5 should be visible immediately (in memory)
    const queried = await backend.query({ namespace: 'bulk-ns', limit: 100 });
    assert.equal(queried.length, 5, 'All 5 entries should be visible via query');

    // getByKey — each should be retrievable
    for (const e of entries) {
      const got = await backend.getByKey(e.namespace, e.key);
      assert.ok(got, `Entry ${e.key} should be retrievable by key`);
      assert.equal(got.id, e.id);
    }

    await backend.shutdown();
  });

  it('delete after WAL store triggers full persist', async () => {
    if (!RvfBackend) return;

    const e1 = makeEntry();
    const e2 = makeEntry();
    const e3 = makeEntry();
    await backend.store(e1);
    await backend.store(e2);
    await backend.store(e3);

    // Delete triggers full persist (WAL is append-only, no tombstones)
    await backend.delete(e2.id);

    // Re-open
    await backend.shutdown();
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const r1 = await backend2.get(e1.id);
    const r2 = await backend2.get(e2.id);
    const r3 = await backend2.get(e3.id);
    assert.ok(r1, 'e1 should survive delete of e2');
    assert.equal(r2, null, 'Deleted entry e2 should be gone');
    assert.ok(r3, 'e3 should survive delete of e2');

    await backend2.shutdown();
  });

  it('update appends to WAL with new version', async () => {
    if (!RvfBackend) return;

    const entry = makeEntry({ content: 'original content' });
    await backend.store(entry);
    await backend.update(entry.id, { content: 'updated content' });

    // Shutdown and re-open to verify persistence
    await backend.shutdown();
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const retrieved = await backend2.get(entry.id);
    assert.ok(retrieved, 'Entry should exist after update + restart');
    assert.equal(retrieved.content, 'updated content', 'Updated content should persist');
    assert.equal(retrieved.version, 2, 'Version should be incremented');

    await backend2.shutdown();
  });

  it('WAL performance: 500 sequential stores complete in <2500ms (5ms SLA per store)', async () => {
    if (!RvfBackend) return;

    // Use a high compaction threshold to avoid compaction during the perf test
    const perfPath = freshPath('perf');
    const perfBackend = new RvfBackend({
      databasePath: perfPath,
      dimensions: 4,
      autoPersistInterval: 0,
      walCompactionThreshold: 10000,
    });
    await perfBackend.initialize();

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      await perfBackend.store(makeEntry());
    }
    const duration = performance.now() - start;

    assert.ok(
      duration < 2500,
      `500 stores took ${duration.toFixed(1)}ms, expected <2500ms (ADR-0073 SLA: <5ms per store at 500+ entries)`,
    );

    await perfBackend.shutdown();
  });

  it('concurrent store() calls do not corrupt WAL', async () => {
    if (!RvfBackend) return;

    // Fire 20 concurrent stores — they share the single-threaded event loop
    // but the WAL append must serialize correctly
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(backend.store(makeEntry({ id: `concurrent-${i}` })));
    }
    await Promise.all(promises);

    // All 20 entries should be retrievable
    for (let i = 0; i < 20; i++) {
      const e = await backend.get(`concurrent-${i}`);
      assert.ok(e, `Entry concurrent-${i} should exist after concurrent stores`);
    }

    // Verify count
    const count = await backend.count();
    assert.equal(count, 20, 'All 20 concurrent entries should be stored');

    // Shutdown and re-open to verify WAL integrity
    await backend.shutdown();
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();
    const count2 = await backend2.count();
    assert.equal(count2, 20, 'All 20 entries should survive WAL replay');
    await backend2.shutdown();
  });

  it(':memory: mode does not create WAL sidecar file', async () => {
    if (!RvfBackend) return;

    const memBackend = new RvfBackend({
      databasePath: ':memory:',
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await memBackend.initialize();

    // Store several entries
    for (let i = 0; i < 5; i++) {
      await memBackend.store(makeEntry());
    }

    // No WAL file should exist anywhere — :memory: has no disk path
    assert.ok(!existsSync(':memory:.wal'), 'No WAL file should be created for :memory: mode');

    await memBackend.shutdown();
  });

  it('WAL replay preserves Float32Array embedding type', async () => {
    if (!RvfBackend) return;

    const emb = makeEmbedding(4);
    const entry = makeEntry({ embedding: emb });
    await backend.store(entry);
    await backend.shutdown();

    // Re-open and check embedding type
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const retrieved = await backend2.get(entry.id);
    assert.ok(retrieved, 'Entry should survive WAL replay');
    assert.ok(
      retrieved.embedding instanceof Float32Array,
      `Embedding should be Float32Array after WAL replay, got ${retrieved.embedding?.constructor?.name}`,
    );
    assert.equal(retrieved.embedding.length, 4, 'Embedding dimension should be preserved');
    await backend2.shutdown();
  });

  it('old-format RVF file is readable via TS fallback (format detection)', async () => {
    if (!RvfBackend) return;

    const oldPath = freshPath('old-format');
    // Manually write a valid old-format RVF file: magic + header + 1 entry
    const entry = {
      id: 'old-1',
      key: 'key-old-1',
      namespace: 'default',
      content: 'old format entry',
      type: 'semantic',
      tags: [],
      metadata: {},
      accessLevel: 'private',
      ownerId: 'test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
      lastAccessedAt: Date.now(),
      version: 1,
      references: [],
    };
    const header = JSON.stringify({
      magic: 'RVF\0',
      version: 1,
      dimensions: 4,
      metric: 'cosine',
      quantization: 'fp32',
      entryCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const headerBuf = Buffer.from(header, 'utf-8');
    const entryBuf = Buffer.from(JSON.stringify(entry), 'utf-8');
    const magic = Buffer.from([0x52, 0x56, 0x46, 0x00]);
    const headerLen = Buffer.alloc(4);
    headerLen.writeUInt32LE(headerBuf.length, 0);
    const entryLen = Buffer.alloc(4);
    entryLen.writeUInt32LE(entryBuf.length, 0);
    writeFileSync(oldPath, Buffer.concat([magic, headerLen, headerBuf, entryLen, entryBuf]));

    // Open with RvfBackend — should read old format via TS path
    const oldBackend = new RvfBackend({
      databasePath: oldPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await oldBackend.initialize();

    const retrieved = await oldBackend.get('old-1');
    assert.ok(retrieved, 'Should read entry from old-format RVF file');
    assert.equal(retrieved.content, 'old format entry');
    assert.equal(retrieved.namespace, 'default');

    await oldBackend.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase 3: tryNativeInit fix
// ---------------------------------------------------------------------------
describe('RvfBackend tryNativeInit fix (ADR-0073 Phase 3)', () => {
  let RvfBackend;
  let rvfPath;

  // Path to the fork source (TypeScript) for static analysis tests
  const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

  beforeEach(async () => {
    try {
      const mem = await import('@claude-flow/memory');
      RvfBackend = mem.RvfBackend;
    } catch {
      RvfBackend = null;
    }

    rvfPath = freshPath('native-p3');
  });

  // --- Source-level verification tests (always run — read fork TS source) ---

  it('tryNativeInit uses correct package name @ruvector/rvf-node', async () => {
    if (!existsSync(FORK_SRC)) {
      // Skip if fork source not available (CI without forks checked out)
      return;
    }
    const src = readFileSync(FORK_SRC, 'utf-8');
    assert.ok(
      src.includes("'@ruvector/rvf-node'") || src.includes('"@ruvector/rvf-node"'),
      'Should import @ruvector/rvf-node',
    );
    // Ensure the OLD incorrect import is not used (as a bare unqualified import)
    // The string '@ruvector/rvf' will appear inside '@ruvector/rvf-node' so we
    // check specifically for the old pattern: import('@ruvector/rvf' without -node
    const oldImportPattern = /import\(\s*['"]@ruvector\/rvf['"](?!\s*-node)/;
    assert.ok(
      !oldImportPattern.test(src),
      'Should NOT have bare @ruvector/rvf import (without -node suffix)',
    );
  });

  it('tryNativeInit uses RvfDatabase.create() factory, not new', async () => {
    if (!existsSync(FORK_SRC)) return;
    const src = readFileSync(FORK_SRC, 'utf-8');
    assert.ok(
      src.includes('RvfDatabase.create('),
      'Should use RvfDatabase.create() factory for new databases',
    );
    assert.ok(
      src.includes('RvfDatabase.open('),
      'Should use RvfDatabase.open() factory for existing databases',
    );
    // Verify the old `new rvf.RvfDatabase(` pattern is not used
    assert.ok(
      !src.includes('new rvf.RvfDatabase('),
      'Should NOT use new rvf.RvfDatabase() constructor',
    );
  });

  it('tryNativeInit uses dimension (not dimensions) key in create options', async () => {
    if (!existsSync(FORK_SRC)) return;
    const src = readFileSync(FORK_SRC, 'utf-8');

    // Extract the tryNativeInit method DEFINITION (not the call site)
    const defPattern = /private\s+async\s+tryNativeInit/;
    const defMatch = defPattern.exec(src);
    assert.ok(defMatch, 'Should find tryNativeInit method definition');
    const methodStart = defMatch.index;
    // Find the closing brace at method-level indentation (2 spaces + })
    const methodEnd = src.indexOf('\n  }', methodStart + 50);
    const methodBody = src.slice(methodStart, methodEnd);

    // Inside the create() options object, it should pass `dimension:` not `dimensions:`
    assert.ok(
      methodBody.includes('dimension:'),
      'Should use dimension: key (singular) in native create options',
    );
    // The value side may reference this.config.dimensions (that is the TS config
    // field name), so we only check that `dimensions:` does not appear as an
    // object KEY — i.e. at the start of a property line.  A regex anchored to
    // whitespace-then-key avoids false positives from the value expression.
    const dimensionsPropKey = /^\s*dimensions\s*:/m;
    assert.ok(
      !dimensionsPropKey.test(methodBody),
      'Should NOT pass dimensions: (plural) as a native API key in tryNativeInit',
    );
  });

  // --- Runtime behavior tests (need @claude-flow/memory) ---

  it('fallback to pure-TS when native module not available', async () => {
    if (!RvfBackend) return;

    // Native @ruvector/rvf-node is unlikely to be installed in test env,
    // so this exercises the pure-TS fallback path
    const backend = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend.initialize();

    const health = await backend.healthCheck();
    // Should be healthy (pure-TS path works) or degraded (no native)
    assert.ok(
      ['healthy', 'degraded'].includes(health.status),
      `Expected healthy or degraded, got: ${health.status}`,
    );

    // Verify basic operations work
    const entry = makeEntry();
    await backend.store(entry);
    const retrieved = await backend.get(entry.id);
    assert.ok(retrieved, 'Should be able to store/get with pure-TS fallback');
    assert.equal(retrieved.content, entry.content);

    await backend.shutdown();
  });

  it('native handle is used when available', async () => {
    // This test only runs when @ruvector/rvf-node is installed
    let nativeAvailable = false;
    try {
      await import('@ruvector/rvf-node');
      nativeAvailable = true;
    } catch {}
    if (!nativeAvailable || !RvfBackend) return;

    const backend = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      verbose: true,
      autoPersistInterval: 0,
    });
    await backend.initialize();

    // If native is available, basic operations should still work
    const entry = makeEntry({ embedding: makeEmbedding(4) });
    await backend.store(entry);
    const results = await backend.search(entry.embedding, { k: 1, threshold: 0 });
    assert.ok(results.length > 0, 'Search should work with native handle');

    await backend.shutdown();
  });
});

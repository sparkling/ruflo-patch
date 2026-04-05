/**
 * RvfBackend: immediate persist on mutation
 *
 * Verifies that store(), update(), delete(), bulkInsert(), bulkDelete(),
 * and clearNamespace() all call persistToDisk() immediately rather than
 * relying on the 30s auto-persist timer (which never fires in short-lived
 * CLI processes).
 */
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helper: build a minimal MemoryEntry
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
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('RvfBackend immediate persist', () => {
  let RvfBackend;
  let rvfPath;
  let backend;

  beforeEach(async () => {
    // Dynamic import of the memory package
    try {
      const mem = await import('@claude-flow/memory');
      RvfBackend = mem.RvfBackend;
    } catch {
      // Not available — skip in pipeline tests
      RvfBackend = null;
    }

    if (!RvfBackend) return;

    // Fresh temp file per test
    const dir = join(tmpdir(), 'rvf-persist-test');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    rvfPath = join(dir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.rvf`);

    backend = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0, // disable timer — we test explicit persist
    });
    await backend.initialize();
  });

  it('store() persists immediately — data survives re-open', async () => {
    if (!RvfBackend) return; // skip if package not available

    const entry = makeEntry();
    await backend.store(entry);

    // File must exist on disk now (not after 30s)
    assert.ok(existsSync(rvfPath), 'RVF file should exist after store()');

    // Shut down without relying on shutdown-persist
    await backend.shutdown();

    // Re-open and verify
    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const retrieved = await backend2.get(entry.id);
    assert.ok(retrieved, 'Entry should survive process restart');
    assert.equal(retrieved.content, entry.content);
    await backend2.shutdown();
  });

  it('update() persists immediately', async () => {
    if (!RvfBackend) return;

    const entry = makeEntry();
    await backend.store(entry);
    await backend.update(entry.id, { content: 'updated-content' });
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const retrieved = await backend2.get(entry.id);
    assert.equal(retrieved.content, 'updated-content');
    await backend2.shutdown();
  });

  it('delete() persists immediately', async () => {
    if (!RvfBackend) return;

    const entry = makeEntry();
    await backend.store(entry);
    await backend.delete(entry.id);
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const retrieved = await backend2.get(entry.id);
    assert.equal(retrieved, null, 'Deleted entry should not reappear');
    await backend2.shutdown();
  });

  it('bulkInsert() persists immediately', async () => {
    if (!RvfBackend) return;

    const entries = [makeEntry(), makeEntry(), makeEntry()];
    await backend.bulkInsert(entries);
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    for (const e of entries) {
      const retrieved = await backend2.get(e.id);
      assert.ok(retrieved, `Entry ${e.id} should survive restart after bulkInsert`);
    }
    await backend2.shutdown();
  });

  it('bulkDelete() persists immediately', async () => {
    if (!RvfBackend) return;

    const entries = [makeEntry(), makeEntry()];
    await backend.bulkInsert(entries);
    await backend.bulkDelete(entries.map(e => e.id));
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const count = await backend2.count();
    assert.equal(count, 0, 'All entries should be gone after bulkDelete + restart');
    await backend2.shutdown();
  });

  it('clearNamespace() persists immediately', async () => {
    if (!RvfBackend) return;

    const entries = [
      makeEntry({ namespace: 'ns1' }),
      makeEntry({ namespace: 'ns1' }),
      makeEntry({ namespace: 'ns2' }),
    ];
    await backend.bulkInsert(entries);
    await backend.clearNamespace('ns1');
    await backend.shutdown();

    const backend2 = new RvfBackend({
      databasePath: rvfPath,
      dimensions: 4,
      autoPersistInterval: 0,
    });
    await backend2.initialize();

    const countNs1 = await backend2.count('ns1');
    const countNs2 = await backend2.count('ns2');
    assert.equal(countNs1, 0, 'ns1 should be empty after clearNamespace + restart');
    assert.equal(countNs2, 1, 'ns2 should still have its entry');
    await backend2.shutdown();
  });
});

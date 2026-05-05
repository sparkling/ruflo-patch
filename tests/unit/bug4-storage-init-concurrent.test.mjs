// @tier unit
// Bug-4 (2026-05-05): RvfBackend.initialize() races on the JS-side .jslock
// file under high parallel-process contention. Default 60s budget hits 100
// poll attempts and throws "Failed to acquire advisory lock"; StorageFactory
// rewraps as "Failed to create storage backend (unknown)". Observed in the
// acceptance harness when ~10 e2e tests share E2E_DIR.
//
// Fixes:
//   - acquireLock(maxWaitMs?) parameterised; init-time uses 180s instead of 60s
//   - Lock-timeout error tagged with code='ELOCKACQUIRE' so wrap surfaces a
//     real diagnostic instead of '(unknown)'
//   - StorageFactory retries init ONCE on ELOCKACQUIRE with jitter
//
// Test contract: N concurrent processes calling RvfBackend.initialize() on
// the SAME database path MUST all eventually succeed (no spurious init
// failures), and the lock-acquisition error must surface with code
// ELOCKACQUIRE if the budget is exceeded (not as '(unknown)').

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const RVF_BACKEND_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
const STORAGE_FACTORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts';

describe('Bug-4: RvfBackend acquireLock is parameterised', () => {
  it('acquireLock signature accepts a maxWaitMs override', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /private async acquireLock\(maxWaitMs:\s*number\s*=\s*60_000\)/,
      'acquireLock must accept an optional maxWaitMs parameter (Bug-4 thread-safety fix)');
  });

  it('init-time call uses 180s budget (not the default 60s)', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    // The init path acquires the lock for loadFromDisk
    const initBlockStart = src.indexOf('// JS-side WAL/meta race window');
    assert.ok(initBlockStart > 0, 'init-time JS-lock comment marker must exist');
    const initBlock = src.slice(initBlockStart, initBlockStart + 800);
    assert.match(initBlock, /this\.acquireLock\(180_000\)/,
      'init-time lock acquisition must pass a 180s budget under heavy contention');
  });

  it('lock-timeout error is tagged with code=ELOCKACQUIRE', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /lockErr\.code\s*=\s*['"]ELOCKACQUIRE['"]/,
      'lock-acquisition error must carry code=ELOCKACQUIRE so StorageFactory wrap surfaces a diagnostic instead of "(unknown)"');
  });

  it('lock-timeout error message includes the lock path for cross-process diagnostics', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /lockPath=\$\{this\.lockPath\}/,
      'lock-acquisition error must include lockPath so concurrent-process traces can correlate');
  });
});

describe('Bug-4: StorageFactory retries once on ELOCKACQUIRE', () => {
  it('storage-factory retries on ELOCKACQUIRE timeout', () => {
    const src = readFileSync(STORAGE_FACTORY_SRC, 'utf8');
    assert.match(src, /['"]ELOCKACQUIRE['"]/,
      'StorageFactory must check err.code === ELOCKACQUIRE for selective retry');
    assert.match(src, /retryAttempt/,
      'StorageFactory must implement bounded retry on lock-timeout');
  });

  it('non-lock errors are NOT retried (ENOENT / EACCES / RvfCorruptError pass through)', () => {
    const src = readFileSync(STORAGE_FACTORY_SRC, 'utf8');
    // The retry condition must be a positive code check, not catch-all.
    assert.match(src, /code\s*!==?\s*['"]ELOCKACQUIRE['"]/,
      'retry must gate on code === ELOCKACQUIRE; other errors throw immediately');
  });
});

// Behavioral test: spawn N concurrent RvfBackend.initialize() calls against
// the same path and verify they all succeed.
describe('Bug-4: concurrent RvfBackend init succeeds across N processes', () => {
  function findRvfBackendDist() {
    const candidates = [
      '/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js',
      '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js',
    ];
    for (const c of candidates) if (existsSync(c)) return c;
    return null;
  }

  it('8 concurrent initialize() calls on shared path all succeed', { skip: !findRvfBackendDist() ? 'rvf-backend dist absent' : false }, async (t) => {
    const distPath = findRvfBackendDist();
    const mod = await import(distPath);
    const RvfBackend = mod.RvfBackend;
    if (!RvfBackend) { t.skip('RvfBackend export missing'); return; }

    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const sharedDir = mkdtempSync(join(tmpdir(), 'bug4-concurrent-'));
    const dbPath = join(sharedDir, 'shared.rvf');

    try {
      const N = 8;
      const backends = Array.from({ length: N }, () =>
        new RvfBackend({ databasePath: dbPath, dimensions: 8, autoPersistInterval: 0 })
      );
      // All N initialize() calls fire in parallel against the same .jslock path.
      const results = await Promise.allSettled(backends.map(b => b.initialize()));
      const failed = results.filter(r => r.status === 'rejected');
      assert.equal(failed.length, 0,
        `Bug-4: ${failed.length}/${N} concurrent inits failed. Errors: ${failed.map(r => r.reason?.message || r.reason).join(' | ')}`);

      // Cleanup all N backends.
      for (const b of backends) {
        if (typeof b.shutdown === 'function') await b.shutdown().catch(() => {});
      }
    } finally {
      try { rmSync(sharedDir, { recursive: true, force: true }); } catch {}
    }
  });
});

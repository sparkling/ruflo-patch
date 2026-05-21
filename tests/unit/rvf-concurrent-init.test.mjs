// @tier unit
// RVF concurrent initialization safety.
//
// Multiple processes (or in-process backends) calling RvfBackend.initialize()
// on the SAME .rvf path must all converge without corruption or spurious
// lock-acquire failures. This guards two layers of fixes:
//
//   - ADR-0095 / ADR-0163: the JS-side advisory-lock acquire budget is
//     configurable (init uses 180s under heavy contention) and a lock-timeout
//     surfaces a real diagnostic (code=ELOCKACQUIRE + lockPath) instead of
//     "(unknown)", with StorageFactory retrying ONCE on that code (not a
//     catch-all). Originally tracked as "Bug-4" (2026-05-05); renamed for
//     semantic clarity.
//   - ADR-0167: during the create race a peer can fail the native open and
//     fail over to the pure-TS loadFromDisk path, which MUST recognise the
//     native RootHeader magic (`RVFROOT\0` and its 4-byte `RVFR` prefix) and
//     NOT mislabel the valid native file as corrupt. Without that recognition,
//     N-1 of N concurrent inits fail with `bad magic bytes (got "RVFR")`.
//     This behavioural test is the regression guard for that fix.
//
// Source-shape assertions read the fork source directly; the behavioural
// convergence test loads the freshly-built backend via the shared
// loadRvfBackend() resolver (tests/helpers/load-rvf.mjs), which resolves THIS
// release's codemodded build — never a stale aggregate.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { loadRvfBackend, LOAD_RVF_SKIP_REASON_REGEX } from '../helpers/load-rvf.mjs';

const RVF_BACKEND_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
const STORAGE_FACTORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts';

describe('RVF concurrent init: advisory-lock acquire budget is configurable (ADR-0095/0163)', () => {
  it('acquireLock accepts a maxWaitMs override', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /private async acquireLock\(maxWaitMs:\s*number\s*=\s*60_000\)/,
      'acquireLock must accept an optional maxWaitMs parameter');
  });

  it('init-time acquire uses the 180s budget (not the default 60s) under contention', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    const initBlockStart = src.indexOf('// JS-side WAL/meta race window');
    assert.ok(initBlockStart > 0, 'init-time JS-lock comment marker must exist');
    const initBlock = src.slice(initBlockStart, initBlockStart + 800);
    assert.match(initBlock, /this\.acquireLock\(180_000\)/,
      'init-time lock acquisition must pass a 180s budget under heavy contention');
  });

  it('lock-timeout error carries code=ELOCKACQUIRE (not surfaced as "(unknown)")', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /lockErr\.code\s*=\s*['"]ELOCKACQUIRE['"]/,
      'lock-acquisition error must carry code=ELOCKACQUIRE so StorageFactory wrap surfaces a diagnostic');
  });

  it('lock-timeout error includes lockPath for cross-process correlation', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /lockPath=\$\{this\.lockPath\}/,
      'lock-acquisition error must include lockPath so concurrent-process traces can correlate');
  });
});

describe('RVF concurrent init: StorageFactory retries once on lock-acquire timeout', () => {
  it('retries selectively on ELOCKACQUIRE', () => {
    const src = readFileSync(STORAGE_FACTORY_SRC, 'utf8');
    assert.match(src, /['"]ELOCKACQUIRE['"]/,
      'StorageFactory must check err.code === ELOCKACQUIRE for selective retry');
    assert.match(src, /retryAttempt/,
      'StorageFactory must implement bounded retry on lock-timeout');
  });

  it('does NOT retry non-lock errors (ENOENT/EACCES/RvfCorruptError pass through)', () => {
    const src = readFileSync(STORAGE_FACTORY_SRC, 'utf8');
    assert.match(src, /code\s*!==?\s*['"]ELOCKACQUIRE['"]/,
      'retry must gate on code === ELOCKACQUIRE; other errors throw immediately');
  });
});

describe('RVF concurrent init: N parallel initialize() calls converge without corruption (ADR-0167)', () => {
  it('N=8 parallel initialize() on a shared .rvf all succeed (no LockHeld, no RVFR corruption)', async (t) => {
    const { RvfBackend, source, error } = await loadRvfBackend();
    if (!RvfBackend) {
      // ADR-0082: skips are narrow — assert the reason matches the resolver's
      // sanctioned set, never a catch-all.
      assert.match(error ?? '', LOAD_RVF_SKIP_REASON_REGEX, `unexpected resolver skip reason: ${error}`);
      t.skip(`RvfBackend unavailable (${error})`);
      return;
    }

    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const sharedDir = mkdtempSync(join(tmpdir(), 'rvf-concurrent-init-'));
    const dbPath = join(sharedDir, 'shared.rvf');

    try {
      const N = 8;
      const backends = Array.from({ length: N }, () =>
        new RvfBackend({ databasePath: dbPath, dimensions: 8, autoPersistInterval: 0 })
      );
      // All N initialize() calls fire in parallel against the same path.
      const results = await Promise.allSettled(backends.map((b) => b.initialize()));
      const failed = results.filter((r) => r.status === 'rejected');
      assert.equal(
        failed.length,
        0,
        `${failed.length}/${N} concurrent inits failed (backend source=${source}). ` +
          `A 'bad magic bytes (got "RVFR")' failure here is the ADR-0167 RVFR-prefix regression. ` +
          `Errors: ${failed.map((r) => r.reason?.message || r.reason).join(' | ')}`,
      );

      for (const b of backends) {
        if (typeof b.shutdown === 'function') await b.shutdown().catch(() => {});
      }
    } finally {
      try { rmSync(sharedDir, { recursive: true, force: true }); } catch {}
    }
  });
});

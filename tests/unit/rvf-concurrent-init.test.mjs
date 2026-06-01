// @tier unit
// RVF concurrent-init safety — SOURCE-SHAPE contracts (unit-tier).
//
// These assertions read the fork source directly and are fully deterministic.
// The BEHAVIOURAL validation of concurrent native init lives in the acceptance
// tier, where the installed CLI provides a CONSISTENT native+JS pair (the unit
// tier cannot: a bare @sparkleideas/memory install is pure-TS, and the build
// tree's JS resolves a stray, version-mismatched native). The acceptance guard
// is `check_t3_2_rvf_concurrent_writes` (lib/acceptance-adr0079-tier3-checks.sh),
// which races N=6 concurrent `cli memory store` calls and asserts all N persist
// — a broken RVFR recognition makes a concurrent peer fail and drops the count.
//
// Contracts guarded here:
//   - ADR-0284 (single-flock collapse): the JS `.jslock` advisory lock is REMOVED;
//     the native kernel flock is the SOLE cross-process write serializer. acquireLock
//     UNPARKS it, releaseLock PARKS it synchronously, init holds it across loadFromDisk
//     (INIT-WRAP), ALL native-write paths bracket with acquireLock/releaseLock, and
//     assignNativeId derives ids by deterministic hash (not the per-process counter
//     that caused the t3-2 id-collision). These supersede the prior ADR-0095/0163
//     advisory-lock-budget/ELOCKACQUIRE/180s contracts (the removed .jslock design).
//   - ADR-0167: the pure-TS loadFromDisk preflight recognises the native
//     RootHeader magic prefix (`RVFR`) so a concurrent-init failover does not
//     mislabel a valid native file as corrupt. (Originally "Bug-4", renamed.)
// The BEHAVIOURAL validation (real concurrent writers, 0 loss) lives in the
// acceptance tier: lib/acceptance-adr0284-checks.sh + the adr0154/adr0090-A4 tests.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const RVF_BACKEND_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
const STORAGE_FACTORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts';

// Extract a method body by brace-matching from its signature (ADR-0284: replaces
// the brittle whole-file substring matches with per-method scoping).
function extractMethod(src, signature) {
  let idx = -1;
  let searchFrom = 0;
  while (searchFrom < src.length) {
    const pos = src.indexOf(signature, searchFrom);
    if (pos === -1) break;
    const lineStart = src.lastIndexOf('\n', pos) + 1;
    const linePrefix = src.slice(lineStart, pos).trim();
    const afterSig = src.slice(pos, pos + 300);
    const isDefinition = (
      (afterSig.includes('(') && afterSig.includes('{')) &&
      (linePrefix === '' || linePrefix.startsWith('private') || linePrefix.startsWith('public') ||
       linePrefix.startsWith('protected') || linePrefix.startsWith('async') ||
       linePrefix.startsWith('static'))
    );
    if (isDefinition) { idx = pos; break; }
    searchFrom = pos + 1;
  }
  if (idx === -1) { idx = src.indexOf(signature); if (idx === -1) return null; }
  let depth = 0; let started = false;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; }
    if (started && depth === 0) return src.slice(idx, i + 1);
  }
  return src.slice(idx);
}

describe('RVF single-flock collapse: native flock is the sole write serializer (ADR-0284)', () => {
  it('acquireLock keeps the maxWaitMs signature (compat) and unparks the native flock', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    // Signature retained for call-site compat (init/factory pass it); the wait is
    // now governed by the native flock's RVF_LOCK_ACQUIRE_TIMEOUT_MS, not a JS budget.
    assert.match(src, /private async acquireLock\(maxWaitMs:\s*number\s*=\s*60_000\)/,
      'acquireLock must retain the maxWaitMs signature for call-site compatibility');
    // Full signature — the bare token appears in other methods' comments/calls.
    const acq = extractMethod(src, 'private async acquireLock');
    assert.ok(acq && acq.includes('unparkNativeWriter'),
      'acquireLock must unpark (re-acquire) the native flock — ADR-0284 makes it the sole serializer');
    assert.ok(acq && !/\{\s*flag:\s*['"]wx['"]\s*\}/.test(acq),
      'acquireLock must NOT create a JS .jslock (wx) — ADR-0284 removed the redundant advisory lock');
  });

  it('releaseLock parks the native flock synchronously (no debounced _scheduleNativePark)', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    const rel = extractMethod(src, 'private async releaseLock');
    assert.ok(rel && rel.includes('parkNativeWriter'),
      'releaseLock must synchronously park the native flock at the envelope boundary');
    assert.ok(rel && !rel.includes('_scheduleNativePark'),
      'releaseLock must NOT use the starved debounce (ADR-0284 sync-park)');
  });

  it('INIT-WRAP: init holds the open() flock across loadFromDisk, then parks', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    const init = extractMethod(src, 'async initialize');
    assert.ok(init, 'initialize method must exist');
    // The open() flock (taken in tryNativeInit) covers loadFromDisk; init parks AFTER
    // the load so a 0267-shaped hold cannot span init→first-store.
    assert.ok(init.includes('loadFromDisk') && init.includes('parkNativeWriter'),
      'initialize must hold the flock across loadFromDisk then parkNativeWriter (INIT-WRAP)');
  });

  it('ALL native-write paths bracket with acquireLock/releaseLock (collapse correctness)', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    // The flock is parked between envelopes, so every native-write path MUST hold it
    // for its transaction — else it ingests unserialised (the bulkInsert 331/600 bug).
    for (const m of ['async store', 'async update', 'async delete', 'async bulkInsert', 'async bulkDelete']) {
      const body = extractMethod(src, m);
      assert.ok(body, `${m} method must exist`);
      assert.ok(body.includes('acquireLock') && body.includes('releaseLock'),
        `${m} must bracket native writes with acquireLock/releaseLock (ADR-0284 single-flock collapse)`);
    }
  });

  it('assignNativeId derives ids deterministically (hash), not a per-process counter', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    const body = extractMethod(src, 'private assignNativeId');
    assert.ok(body, 'assignNativeId method must exist');
    assert.ok(body.includes('hashStringIdToNativeId'),
      'assignNativeId must use a deterministic hash (ADR-0284) so concurrent processes never assign colliding ids');
    // Match the ASSIGNMENT (not a comment mention of `nextNativeId++`): the counter
    // must not be the id source. `= this.nextNativeId++` is the removed pattern.
    assert.ok(!/=\s*this\.nextNativeId\+\+/.test(body),
      'assignNativeId must NOT assign from the per-process nextNativeId counter (the t3-2 id-collision root cause)');
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

describe('RVF concurrent init: pure-TS loadFromDisk recognises the native RootHeader prefix (ADR-0167)', () => {
  it('loadFromDisk preflight treats the RVFR prefix (and SFVR) as native, not corrupt', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    // The fix: in the loadFromDisk preflight, a 4-byte peek matching the native
    // RootHeader prefix (RVFR) OR the legacy native magic (SFVR) sets the
    // "this is a native file, skip the pure-TS corruption verdict" flag. Without
    // this, a concurrent-init failover peer that peeked a partial RootHeader hit
    // the corruption check and threw `bad magic bytes (got 'RVFR')`.
    assert.match(
      src,
      /peek4 === NATIVE_MAGIC \|\| peek4 === NATIVE_ROOT_HEADER_MAGIC_PREFIX/,
      'loadFromDisk preflight must recognise SFVR/RVFR-prefixed files as native (ADR-0167 RVFR fix)',
    );
  });
});

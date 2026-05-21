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
//   - ADR-0095/0163: the advisory-lock acquire budget is configurable (init
//     uses 180s) and lock-timeout surfaces a real diagnostic (ELOCKACQUIRE +
//     lockPath), with StorageFactory retrying ONCE on that code (not a catch-all).
//   - ADR-0167: the pure-TS loadFromDisk preflight recognises the native
//     RootHeader magic prefix (`RVFR`) so a concurrent-init failover does not
//     mislabel a valid native file as corrupt. (Originally "Bug-4", renamed.)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

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

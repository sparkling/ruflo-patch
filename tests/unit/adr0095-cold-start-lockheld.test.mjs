// @tier unit
// ADR-0095 Tier B7 extension (2026-04-21): cold-start LockHeld retry.
//
// Under N concurrent cold-start writers racing to create the SFVR file,
// RvfDatabase.create() can throw `RVF error 0x0300: LockHeld` as transiently
// as RvfDatabase.open() does. The existing 5s exponential-backoff retry
// wrapping `open()` at rvf-backend.ts:928-957 is now mirrored around
// `create()` so cold-start contention doesn't take down the whole store.
//
// This test is a source-level invariant guard: asserts both the open path
// AND the create path carry the LockHeld retry, and that neither falls
// through to a fatal throw on a single transient LockHeld hit.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

describe('ADR-0095 Tier B7: cold-start LockHeld retry on RvfDatabase.create', () => {
  it('fork source file exists', () => {
    assert.ok(existsSync(FORK_SRC), `expected ${FORK_SRC}`);
  });

  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';

  it('open path retains LockHeld retry (regression guard)', () => {
    const openSlice = src.slice(src.indexOf('rvf.RvfDatabase.open(this.config.databasePath)'));
    assert.match(openSlice.slice(0, 1500), /0x0300|LockHeld/i,
      'RvfDatabase.open retry must still recognize the LockHeld shape');
  });

  it('create path also retries on LockHeld (new invariant)', () => {
    const createIdx = src.indexOf('rvf.RvfDatabase.create(this.config.databasePath');
    assert.ok(createIdx > -1, 'create call must exist');
    // The retry loop must precede the create call AND the LockHeld branch
    // must live in the same while() block. Slice from the "Truly cold start"
    // comment to the throw after the loop — expect ~2KB.
    const createBlock = src.slice(src.indexOf('Truly cold start'), createIdx + 2500);
    assert.match(createBlock, /while\s*\(\s*Date\.now\(\)\s*-\s*createStart\s*<\s*createMaxMs\s*\)/,
      'create must be wrapped in a 5s exponential-backoff retry loop');
    assert.match(createBlock, /0x0300|LockHeld/i,
      'create retry must discriminate the LockHeld shape');
    assert.match(createBlock, /setTimeout\(res,\s*expDelay\s*\+\s*jitter\)/,
      'create retry must sleep with jittered exponential backoff');
  });

  it('create still throws loudly on non-LockHeld errors (no silent fallback)', () => {
    const createBlock = src.slice(src.indexOf('Truly cold start'));
    // After the retry loop, non-LockHeld errors + budget exhaustion must
    // throw. Assert the explicit throw below the while() exists and cites
    // the elapsed/attempts context.
    assert.match(createBlock, /throw new Error\([^)]*RvfDatabase\.create failed[^)]*attempts/s,
      'post-retry throw must include attempt count + elapsed context');
  });

  it('create still short-circuits on ENOENT (benign parent-dir race)', () => {
    const createBlock = src.slice(src.indexOf('Truly cold start'));
    assert.match(createBlock, /code\s*===\s*['"]ENOENT['"]/,
      'ENOENT must remain a fast-path to pure-TS fallback, not a retry');
  });

  it('5s budget + 20ms base delay + 400ms cap shared between open and create paths', () => {
    // Consistency check: both loops should use the same numeric knobs so the
    // overall init budget is predictable under contention.
    const createBlock = src.slice(src.indexOf('Truly cold start'));
    assert.match(createBlock, /createMaxMs\s*=\s*5000/, 'create budget = 5s');
    assert.match(createBlock, /createBaseDelayMs\s*=\s*20/, 'create base delay = 20ms');
    assert.match(createBlock, /createMaxDelayMs\s*=\s*400/, 'create max delay = 400ms');
  });
});

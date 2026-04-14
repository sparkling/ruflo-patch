// @tier unit
// ADR-0086 B4: Circuit breaker state machine verification
// Verifies _initFailed prevents retry storm after storage init failure.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const ROUTER = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';
const src = readFileSync(ROUTER, 'utf-8');

// ---------------------------------------------------------------------------
// Group 1: State machine declarations
// ---------------------------------------------------------------------------

describe('ADR-0086 B4: state machine declarations', () => {
  it('_initFailed is declared with initial value false', () => {
    const match = src.match(/^let\s+_initFailed\s*=\s*false\b/m);
    assert.ok(match, '_initFailed must be declared as `let _initFailed = false`');
  });

  it('_storage is declared as nullable', () => {
    const match = src.match(/^let\s+_storage\s*:\s*[^=]*\|\s*null\s*=\s*null\s*;/m);
    assert.ok(match, '_storage must be declared as nullable with `| null = null`');
  });

  it('both are module-level let declarations (not const, not function-scoped)', () => {
    // Find lines that declare _initFailed and _storage — they must start at
    // column 0 (module scope) and use `let`, not `const` or `var`.
    const lines = src.split('\n');
    let foundStorage = false;
    let foundInitFailed = false;
    for (const line of lines) {
      if (/^let\s+_storage\b/.test(line)) foundStorage = true;
      if (/^let\s+_initFailed\b/.test(line)) foundInitFailed = true;
    }
    assert.ok(foundStorage, '_storage must be a module-level let declaration');
    assert.ok(foundInitFailed, '_initFailed must be a module-level let declaration');
  });
});

// ---------------------------------------------------------------------------
// Group 2: Failure path sets _initFailed
// ---------------------------------------------------------------------------

describe('ADR-0086 B4: failure path sets _initFailed', () => {
  // Extract the _doInit function body (from declaration to the next `export` or
  // `/** Reset` at module scope).
  const doInitStart = src.indexOf('async function _doInit()');
  assert.ok(doInitStart !== -1, '_doInit function must exist (test setup)');

  // Find the closing of _doInit — it ends right before `export async function ensureRouter`
  const ensureStart = src.indexOf('export async function ensureRouter');
  const doInitBody = src.slice(doInitStart, ensureStart);

  it('_initFailed = true appears inside the catch block of createStorage', () => {
    // The catch block around createStorage sets the flag
    const catchIdx = doInitBody.indexOf('} catch (e) {');
    assert.ok(catchIdx !== -1, '_doInit must have a catch(e) block around createStorage');

    // Extract from catch to the next closing brace block
    const afterCatch = doInitBody.slice(catchIdx, catchIdx + 300);
    assert.ok(
      afterCatch.includes('_initFailed = true'),
      'catch block must set _initFailed = true'
    );
  });

  it('_storage = null appears in the catch block', () => {
    const catchIdx = doInitBody.indexOf('} catch (e) {');
    const afterCatch = doInitBody.slice(catchIdx, catchIdx + 300);
    assert.ok(
      afterCatch.includes('_storage = null'),
      'catch block must set _storage = null to ensure clean state'
    );
  });

  it('catch block re-throws (does not silently swallow)', () => {
    const catchIdx = doInitBody.indexOf('} catch (e) {');
    const afterCatch = doInitBody.slice(catchIdx, catchIdx + 300);
    assert.ok(
      afterCatch.includes('throw '),
      'catch block must re-throw — silent swallowing would hide the failure'
    );
  });
});

// ---------------------------------------------------------------------------
// Group 3: ensureRouter fast-fails on _initFailed
// ---------------------------------------------------------------------------

describe('ADR-0086 B4: ensureRouter fast-fails on _initFailed', () => {
  const ensureStart = src.indexOf('export async function ensureRouter');
  assert.ok(ensureStart !== -1, 'ensureRouter must exist (test setup)');

  // ensureRouter is short — grab ~400 chars
  const ensureBody = src.slice(ensureStart, ensureStart + 400);

  it('checks _initFailed BEFORE _initPromise assignment', () => {
    const failedIdx = ensureBody.indexOf('_initFailed');
    const promiseIdx = ensureBody.indexOf('_initPromise = _doInit');
    assert.ok(failedIdx !== -1, 'ensureRouter must check _initFailed');
    assert.ok(promiseIdx !== -1, 'ensureRouter must assign _initPromise');
    assert.ok(
      failedIdx < promiseIdx,
      '_initFailed check must come BEFORE _initPromise assignment (early exit)'
    );
  });

  it('throws on _initFailed (does not return silently)', () => {
    // Find the line with _initFailed and verify it throws
    const lines = ensureBody.split('\n');
    const guardLine = lines.find(l => l.includes('_initFailed'));
    assert.ok(guardLine, 'must have a line checking _initFailed');
    assert.ok(
      guardLine.includes('throw'),
      '_initFailed guard must throw an Error, not return silently'
    );
  });
});

// ---------------------------------------------------------------------------
// Group 4: resetRouter clears _initFailed
// ---------------------------------------------------------------------------

describe('ADR-0086 B4: resetRouter clears _initFailed', () => {
  const resetStart = src.indexOf('export function resetRouter');
  assert.ok(resetStart !== -1, 'resetRouter must exist (test setup)');

  // Grab enough to cover the whole function body
  const resetBody = src.slice(resetStart, resetStart + 400);

  it('sets _initFailed = false', () => {
    assert.ok(
      resetBody.includes('_initFailed = false'),
      'resetRouter must set _initFailed = false to allow retry'
    );
  });

  it('sets _storage = null (clean slate)', () => {
    assert.ok(
      resetBody.includes('_storage = null'),
      'resetRouter must set _storage = null for clean re-initialization'
    );
  });
});

// ---------------------------------------------------------------------------
// Group 5: Retry storm prevention contract
// ---------------------------------------------------------------------------

describe('ADR-0086 B4: retry storm prevention contract', () => {
  it('_initFailed = true appears exactly 1 time (in the catch block)', () => {
    const matches = src.match(/_initFailed\s*=\s*true/g);
    assert.ok(matches, '_initFailed = true must appear at least once');
    assert.equal(
      matches.length,
      1,
      `_initFailed = true must appear exactly 1 time (found ${matches.length}) — ` +
      'only the init catch block should set the breaker'
    );
  });

  it('_initFailed = false appears exactly 2 times (declaration + resetRouter)', () => {
    const matches = src.match(/_initFailed\s*=\s*false/g);
    assert.ok(matches, '_initFailed = false must appear at least once');
    assert.equal(
      matches.length,
      2,
      `_initFailed = false must appear exactly 2 times (found ${matches.length}) — ` +
      'initial declaration + resetRouter only; any other reset would bypass the breaker'
    );
  });

  it('_initFailed = true is set in the init path, not in ensureRouter', () => {
    const ensureStart = src.indexOf('export async function ensureRouter');
    const ensureEnd = src.indexOf('\n}', ensureStart) + 2;
    const ensureBody = src.slice(ensureStart, ensureEnd);
    assert.ok(
      !ensureBody.includes('_initFailed = true'),
      'ensureRouter must NOT set _initFailed = true — it only reads the flag'
    );
  });

  it('_initFailed = false is NOT set outside resetRouter and declaration', () => {
    // Find every occurrence of `_initFailed = false` and verify each is either:
    //   1. The module-level `let _initFailed = false` declaration, or
    //   2. Inside the resetRouter function body.
    const lines = src.split('\n');
    const resetStart = src.indexOf('export function resetRouter');
    const resetEnd = src.indexOf('\n}', resetStart) + 2;

    for (let i = 0; i < lines.length; i++) {
      if (/_initFailed\s*=\s*false/.test(lines[i])) {
        const charOffset = src.split('\n').slice(0, i).join('\n').length;
        const isDeclaration = lines[i].trimStart().startsWith('let _initFailed');
        const isInReset = charOffset >= resetStart && charOffset < resetEnd;
        assert.ok(
          isDeclaration || isInReset,
          `_initFailed = false at line ${i + 1} is outside both the declaration ` +
          'and resetRouter — this would bypass the circuit breaker'
        );
      }
    }
  });
});

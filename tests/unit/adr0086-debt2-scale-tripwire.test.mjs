// @tier unit
// ADR-0086 Debt 2: Scale tripwire — checkCapacity guards on RvfBackend
//
// Source-level structural tests (London School TDD, no I/O beyond readFileSync).
// Verifies that RvfBackend has a checkCapacity method that guards store() and
// bulkInsert(), throws on overflow, warns at 90%, and resets on delete/clear.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Source path
// ============================================================================

const RVF_BACKEND_PATH =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

const rvfSrc = readFileSync(RVF_BACKEND_PATH, 'utf-8');

// ============================================================================
// Helper: extract a method body from source by brace-counting.
// ============================================================================

function extractMethod(src, signature) {
  let idx = -1;
  let searchFrom = 0;
  while (searchFrom < src.length) {
    const pos = src.indexOf(signature, searchFrom);
    if (pos === -1) break;
    const lineStart = src.lastIndexOf('\n', pos) + 1;
    const linePrefix = src.slice(lineStart, pos).trim();
    const afterSig = src.slice(pos, pos + 300);
    const isDefinition =
      afterSig.includes('(') &&
      afterSig.includes('{') &&
      (linePrefix === '' ||
        linePrefix.startsWith('private') ||
        linePrefix.startsWith('public') ||
        linePrefix.startsWith('protected') ||
        linePrefix.startsWith('async') ||
        linePrefix.startsWith('static') ||
        linePrefix.startsWith('/**') ||
        linePrefix.startsWith('//') ||
        linePrefix.startsWith('*'));
    if (isDefinition) {
      idx = pos;
      break;
    }
    searchFrom = pos + 1;
  }
  if (idx === -1) {
    idx = src.indexOf(signature);
    if (idx === -1) return null;
  }
  let depth = 0;
  let started = false;
  const start = idx;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
      started = true;
    }
    if (src[i] === '}') {
      depth--;
    }
    if (started && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

// ============================================================================
// Group 1: checkCapacity method exists
// ============================================================================

describe('ADR-0086 Debt 2: checkCapacity method exists on RvfBackend', () => {
  it('checkCapacity method is defined', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'RvfBackend must define a checkCapacity method');
  });

  it('checkCapacity accepts a count parameter with default 1', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    // Should have signature like checkCapacity(count: number = 1)
    assert.ok(
      body.includes('count') && (body.includes('= 1') || body.includes('=1')),
      'checkCapacity must accept a count parameter with default value 1',
    );
  });
});

// ============================================================================
// Group 2: store() calls checkCapacity before Map mutation
// ============================================================================

describe('ADR-0086 Debt 2: store() calls checkCapacity before entries.set', () => {
  it('store() calls this.checkCapacity()', () => {
    const body = extractMethod(rvfSrc, 'async store');
    assert.ok(body, 'store method must exist');
    assert.ok(
      body.includes('this.checkCapacity') || body.includes('checkCapacity'),
      'store() must call checkCapacity',
    );
  });

  it('store() calls checkCapacity BEFORE this.entries.set', () => {
    const body = extractMethod(rvfSrc, 'async store');
    assert.ok(body, 'store method must exist');
    const capacityIdx = body.indexOf('checkCapacity');
    const setIdx = body.indexOf('this.entries.set');
    assert.ok(capacityIdx >= 0, 'store() must call checkCapacity');
    assert.ok(setIdx >= 0, 'store() must call this.entries.set');
    assert.ok(
      capacityIdx < setIdx,
      `checkCapacity (at offset ${capacityIdx}) must come BEFORE ` +
        `this.entries.set (at offset ${setIdx}) in store()`,
    );
  });
});

// ============================================================================
// Group 3: bulkInsert() calls checkCapacity(entries.length) before the loop
// ============================================================================

describe('ADR-0086 Debt 2: bulkInsert() calls checkCapacity before the loop', () => {
  it('bulkInsert() calls this.checkCapacity(entries.length)', () => {
    const body = extractMethod(rvfSrc, 'async bulkInsert');
    assert.ok(body, 'bulkInsert method must exist');
    assert.ok(
      body.includes('checkCapacity(entries.length)') ||
        body.includes('checkCapacity( entries.length'),
      'bulkInsert() must call checkCapacity(entries.length)',
    );
  });

  it('bulkInsert() calls checkCapacity BEFORE the for loop', () => {
    const body = extractMethod(rvfSrc, 'async bulkInsert');
    assert.ok(body, 'bulkInsert method must exist');
    const capacityIdx = body.indexOf('checkCapacity');
    const forIdx = body.indexOf('for (');
    assert.ok(capacityIdx >= 0, 'bulkInsert() must call checkCapacity');
    assert.ok(forIdx >= 0, 'bulkInsert() must have a for loop');
    assert.ok(
      capacityIdx < forIdx,
      `checkCapacity (at offset ${capacityIdx}) must come BEFORE ` +
        `for loop (at offset ${forIdx}) in bulkInsert()`,
    );
  });
});

// ============================================================================
// Group 4: checkCapacity throws when projected count > maxElements
// ============================================================================

describe('ADR-0086 Debt 2: checkCapacity throws on overflow', () => {
  it('checkCapacity throws an Error when projected > maxElements', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('throw') && body.includes('Error'),
      'checkCapacity must throw an Error when capacity is exceeded',
    );
  });

  it('checkCapacity compares projected count against this.config.maxElements', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('this.config.maxElements'),
      'checkCapacity must reference this.config.maxElements for the limit',
    );
    assert.ok(
      body.includes('this.entries.size'),
      'checkCapacity must reference this.entries.size for the current count',
    );
  });

  it('error message includes maxElements value', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('maxElements') && body.includes('capacity'),
      'checkCapacity error message must mention maxElements and capacity',
    );
  });
});

// ============================================================================
// Group 5: checkCapacity warns at 90% capacity via console.warn
// ============================================================================

describe('ADR-0086 Debt 2: checkCapacity warns at 90% capacity', () => {
  it('checkCapacity calls console.warn', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('console.warn'),
      'checkCapacity must call console.warn at 90% capacity',
    );
  });

  it('checkCapacity uses 0.9 threshold for the warning', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('0.9'),
      'checkCapacity must use 0.9 (90%) threshold for the capacity warning',
    );
  });
});

// ============================================================================
// Group 6: _capacityWarned field exists and is initially false
// ============================================================================

describe('ADR-0086 Debt 2: _capacityWarned field', () => {
  it('_capacityWarned field is declared on RvfBackend', () => {
    assert.ok(
      rvfSrc.includes('_capacityWarned'),
      'RvfBackend must declare a _capacityWarned field',
    );
  });

  it('_capacityWarned is initialized to false', () => {
    // Match the field declaration: private _capacityWarned = false;
    const initPattern = /_capacityWarned\s*=\s*false/;
    assert.ok(
      initPattern.test(rvfSrc),
      '_capacityWarned must be initialized to false',
    );
  });

  it('checkCapacity sets _capacityWarned = true after warning', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('_capacityWarned = true'),
      'checkCapacity must set _capacityWarned = true after issuing the warning',
    );
  });

  it('checkCapacity checks !this._capacityWarned before warning (warn-once)', () => {
    const body = extractMethod(rvfSrc, 'checkCapacity');
    assert.ok(body, 'checkCapacity method must exist');
    assert.ok(
      body.includes('!this._capacityWarned') || body.includes('!_capacityWarned'),
      'checkCapacity must guard the warning with !this._capacityWarned (warn-once pattern)',
    );
  });
});

// ============================================================================
// Group 7: delete() resets _capacityWarned = false
// ============================================================================

describe('ADR-0086 Debt 2: delete() resets _capacityWarned', () => {
  it('delete() sets this._capacityWarned = false', () => {
    const body = extractMethod(rvfSrc, 'async delete');
    assert.ok(body, 'delete method must exist');
    assert.ok(
      body.includes('_capacityWarned = false'),
      'delete() must reset _capacityWarned to false after removing an entry',
    );
  });
});

// ============================================================================
// Group 8: clearNamespace() resets _capacityWarned = false
// ============================================================================

describe('ADR-0086 Debt 2: clearNamespace() resets _capacityWarned', () => {
  it('clearNamespace() sets this._capacityWarned = false', () => {
    const body = extractMethod(rvfSrc, 'async clearNamespace');
    assert.ok(body, 'clearNamespace method must exist');
    assert.ok(
      body.includes('_capacityWarned = false'),
      'clearNamespace() must reset _capacityWarned to false after clearing entries',
    );
  });
});

// ============================================================================
// Group 9: update() does NOT call checkCapacity (replaces, not grows)
// ============================================================================

describe('ADR-0086 Debt 2: update() does NOT call checkCapacity', () => {
  it('update() does not reference checkCapacity', () => {
    const body = extractMethod(rvfSrc, 'async update');
    assert.ok(body, 'update method must exist');
    assert.ok(
      !body.includes('checkCapacity'),
      'update() must NOT call checkCapacity — it replaces an existing entry, ' +
        'it does not grow the collection',
    );
  });
});

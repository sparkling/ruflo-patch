// @tier unit
// ADR-0086 Phase 2b: Verify initializer deletion (stubs obsolete).
//
// memory-initializer.ts was deleted (ADR-0086 Debt 6). All CRUD stub,
// embedding delegation, and _loadRouter tests are replaced with a single
// absence check. The file's deletion is the ultimate proof that no stub
// can regress.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';

const initializerPath = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-initializer.ts';

// ============================================================================
// memory-initializer.ts deleted — all stubs removed (ADR-0086 Debt 6)
// ============================================================================

describe('ADR-0086 Phase 2b: memory-initializer deleted (stubs obsolete)', () => {
  it('memory-initializer.ts is absent (Debt 6 — CRUD stubs, embedding delegation, _loadRouter all removed)', () => {
    assert.ok(!existsSync(initializerPath),
      'memory-initializer.ts should be deleted (ADR-0086 Debt 6)');
  });
});

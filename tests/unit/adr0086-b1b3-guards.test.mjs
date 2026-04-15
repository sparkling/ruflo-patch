// @tier unit
// ADR-0086: B1+B3 regression guards — verify bug fixes remain in fork source.
// Structural tests that fail if someone reverts the fix.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const CLI = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

// --- B1 guard: memory-initializer.ts deleted (ADR-0086 Debt 6)

describe('ADR-0086 B1 guard: applyTemporalDecay — shim deleted', () => {
  it('memory-initializer.ts is deleted (ADR-0086 Debt 6)', () => {
    const initPath = `${CLI}/memory/memory-initializer.ts`;
    assert.ok(!existsSync(initPath),
      'memory-initializer.ts should be deleted (Debt 6 — all stubs removed)');
  });
});

// --- B3 guard: mcp-server uses healthCheck from router, not checkMemoryInitialization

describe('ADR-0086 B3 guard: mcp-server.ts uses healthCheck from router', () => {
  const mcpPath = `${CLI}/mcp-server.ts`;

  it('mcp-server.ts exists', () => {
    assert.ok(existsSync(mcpPath), 'mcp-server.ts must exist');
  });

  it('imports healthCheck or ensureRouter from memory-router', () => {
    const src = readFileSync(mcpPath, 'utf-8');
    const hasRouterImport = src.includes('memory-router') &&
      (src.includes('healthCheck') || src.includes('ensureRouter'));
    assert.ok(hasRouterImport,
      'mcp-server.ts must import healthCheck/ensureRouter from memory-router (B3 fix)');
  });

  it('does NOT import checkMemoryInitialization as live code', () => {
    const src = readFileSync(mcpPath, 'utf-8');
    // Filter out comment lines
    const liveLines = src.split('\n')
      .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasOldImport = liveLines.some(l =>
      l.includes('checkMemoryInitialization') && l.includes('import'));
    assert.ok(!hasOldImport,
      'mcp-server.ts must not import checkMemoryInitialization (B3 — rewired to healthCheck)');
  });
});

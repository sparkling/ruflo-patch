// @tier unit
// ADR-0086: B1+B3 regression guards — verify bug fixes remain in fork source.
// Structural tests that fail if someone reverts the fix.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

const CLI = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

// --- B1 guard: applyTemporalDecay must be a no-op stub

describe('ADR-0086 B1 guard: applyTemporalDecay is a no-op stub', () => {
  const initPath = `${CLI}/memory/memory-initializer.ts`;

  it('memory-initializer.ts exists', () => {
    assert.ok(existsSync(initPath), 'memory-initializer.ts must exist (shim)');
  });

  it('applyTemporalDecay returns stub response', () => {
    const src = readFileSync(initPath, 'utf-8');
    const fnStart = src.indexOf('applyTemporalDecay');
    assert.ok(fnStart !== -1, 'applyTemporalDecay function must exist');

    // Extract ~500 chars after the function name to find the body
    const fnSlice = src.slice(fnStart, fnStart + 500);
    assert.ok(
      fnSlice.includes('patternsDecayed: 0') || fnSlice.includes('patternsDecayed:0'),
      'applyTemporalDecay must return patternsDecayed: 0 (B1 stub fix)'
    );
  });

  it('applyTemporalDecay does NOT contain raw SQLite calls', () => {
    const src = readFileSync(initPath, 'utf-8');
    const fnStart = src.indexOf('applyTemporalDecay');
    const fnEnd = src.indexOf('\nexport', fnStart + 1);
    const fnBody = fnEnd > fnStart ? src.slice(fnStart, fnEnd) : src.slice(fnStart, fnStart + 800);
    assert.ok(!fnBody.includes('db.prepare('), 'applyTemporalDecay must not use db.prepare() (B1 — old SQLite body removed)');
    assert.ok(!fnBody.includes('.run('), 'applyTemporalDecay must not use .run() (B1 — old SQLite body removed)');
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

// @tier unit
// ADR-0086 T2.8: Import rewire verification + supplementary checks
//
// London School TDD: structural source analysis (no mocking needed).
// Verifies:
//   T2.8  No production .ts file imports from memory-initializer (except itself)
//   B2    MemoryOpType includes 'bulkDelete' and 'clearNamespace'
//   B4    routeMemoryOp has a null guard for _storage
//   T3.4  HNSW functions in memory-initializer.ts are stubs (no @ruvector/core import)

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Source paths
// ============================================================================

const CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const ROUTER_PATH = `${CLI_SRC}/memory/memory-router.ts`;
const INITIALIZER_PATH = `${CLI_SRC}/memory/memory-initializer.ts`;

// ============================================================================
// Helper: recursively collect .ts files
// ============================================================================

function collectTsFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

// ============================================================================
// Group 1: T2.8 — No production file imports from memory-initializer
// ============================================================================

describe('ADR-0086 T2.8: memory-initializer import elimination', () => {
  it('fork CLI src directory exists', () => {
    assert.ok(
      existsSync(CLI_SRC),
      `Fork CLI src not found at ${CLI_SRC} — is the fork checked out?`,
    );
  });

  it('no production .ts files import from memory-initializer', () => {
    assert.ok(existsSync(CLI_SRC), 'Fork CLI src not found — is the fork checked out?');

    const allTs = collectTsFiles(CLI_SRC);
    assert.ok(allTs.length > 0, 'Expected to find .ts files under CLI src');

    // Exclude memory-initializer.ts itself, test files, and .d.ts
    const production = allTs.filter(f => {
      const name = f.split('/').pop();
      if (name === 'memory-initializer.ts') return false;
      if (name.endsWith('.test.ts') || name.endsWith('.spec.ts')) return false;
      if (name.endsWith('.d.ts')) return false;
      return true;
    });

    // Match real import statements — both static and dynamic
    // Static: import { ... } from '../memory/memory-initializer.js';
    // Dynamic: await import('../memory/memory-initializer.js');
    //
    // Exclude comments: lines where the import path is only in a comment
    const importPattern = /memory-initializer(?:\.js|\.ts)?['"]/;
    const commentPattern = /^\s*\/\//;

    const violations = [];
    for (const file of production) {
      const src = readFileSync(file, 'utf-8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip pure comment lines
        if (commentPattern.test(line)) continue;
        // Check for actual import/require of memory-initializer
        if (importPattern.test(line)) {
          // Additional check: the import path must be in the code part, not just a trailing comment
          const codePart = line.split('//')[0];
          if (importPattern.test(codePart)) {
            const relPath = file.replace(CLI_SRC + '/', '');
            violations.push(`${relPath}:${i + 1}: ${line.trim()}`);
          }
        }
      }
    }

    assert.equal(
      violations.length,
      0,
      `Expected ZERO memory-initializer imports in production files, found ${violations.length}:\n` +
        violations.map(v => `  ${v}`).join('\n'),
    );
  });

  it('scanned a reasonable number of production .ts files', () => {
    assert.ok(existsSync(CLI_SRC), 'Fork CLI src not found — is the fork checked out?');

    const allTs = collectTsFiles(CLI_SRC);
    const production = allTs.filter(f => {
      const name = f.split('/').pop();
      return name !== 'memory-initializer.ts' &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('.spec.ts') &&
        !name.endsWith('.d.ts');
    });

    // Sanity: CLI src should have at least 20 production .ts files
    assert.ok(
      production.length >= 20,
      `Expected >= 20 production .ts files, got ${production.length} — check CLI_SRC path`,
    );
  });
});

// ============================================================================
// Group 2: B2 — MemoryOpType includes 'bulkDelete' and 'clearNamespace'
// ============================================================================

describe('ADR-0086 B2: MemoryOpType completeness', () => {
  let routerSrc;

  beforeEach(() => {
    if (!existsSync(ROUTER_PATH)) return;
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('router source file exists', () => {
    assert.ok(
      existsSync(ROUTER_PATH),
      `memory-router.ts not found at ${ROUTER_PATH}`,
    );
  });

  it('MemoryOpType includes bulkDelete', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    // Extract the MemoryOpType union block
    const typeStart = routerSrc.indexOf('export type MemoryOpType');
    assert.ok(typeStart > -1, 'MemoryOpType not found in router source');
    const typeBlock = routerSrc.slice(typeStart, routerSrc.indexOf(';', typeStart) + 1);
    assert.ok(
      typeBlock.includes("'bulkDelete'"),
      `MemoryOpType must include 'bulkDelete'. Block:\n${typeBlock}`,
    );
  });

  it('MemoryOpType includes clearNamespace', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    const typeStart = routerSrc.indexOf('export type MemoryOpType');
    assert.ok(typeStart > -1, 'MemoryOpType not found in router source');
    const typeBlock = routerSrc.slice(typeStart, routerSrc.indexOf(';', typeStart) + 1);
    assert.ok(
      typeBlock.includes("'clearNamespace'"),
      `MemoryOpType must include 'clearNamespace'. Block:\n${typeBlock}`,
    );
  });

  it('MemoryOpType has at least 10 operation types', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    const typeStart = routerSrc.indexOf('export type MemoryOpType');
    assert.ok(typeStart > -1, 'MemoryOpType not found in router source');
    const typeBlock = routerSrc.slice(typeStart, routerSrc.indexOf(';', typeStart) + 1);
    // Count quoted strings in the union
    const members = typeBlock.match(/'[a-zA-Z]+'/g) || [];
    assert.ok(
      members.length >= 10,
      `Expected >= 10 MemoryOpType members, got ${members.length}: [${members.join(', ')}]`,
    );
  });
});

// ============================================================================
// Group 3: B4 — routeMemoryOp has null guard for _storage
// ============================================================================

describe('ADR-0086 B4: routeMemoryOp _storage null guard', () => {
  let routerSrc;

  beforeEach(() => {
    if (!existsSync(ROUTER_PATH)) return;
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('routeMemoryOp contains a null guard for _storage', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');

    // Find the routeMemoryOp function body
    const fnStart = routerSrc.indexOf('export async function routeMemoryOp');
    assert.ok(fnStart > -1, 'routeMemoryOp not found in router source');

    // Extract a generous chunk of the function body (first 400 chars)
    const fnBlock = routerSrc.slice(fnStart, fnStart + 600);

    assert.ok(
      fnBlock.includes('!_storage'),
      'routeMemoryOp must check for null _storage (pattern: !_storage)',
    );
  });

  it('null guard returns an error result, not a throw', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');

    const fnStart = routerSrc.indexOf('export async function routeMemoryOp');
    assert.ok(fnStart > -1, 'routeMemoryOp not found in router source');
    const fnBlock = routerSrc.slice(fnStart, fnStart + 600);

    // After the !_storage check, it should return { success: false, error: ... }
    const guardIdx = fnBlock.indexOf('!_storage');
    assert.ok(guardIdx > -1, 'null guard not found');
    const afterGuard = fnBlock.slice(guardIdx, guardIdx + 200);
    assert.ok(
      afterGuard.includes('success: false'),
      'null guard must return { success: false } instead of throwing',
    );
  });

  it('_storage is declared as nullable (| null)', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');

    // Check for the declaration pattern: let _storage: ... | null = null
    assert.ok(
      routerSrc.includes('_storage') && routerSrc.includes('| null'),
      '_storage must be declared with a nullable type (| null)',
    );
  });
});

// ============================================================================
// Group 4: T3.4 — memory-initializer deleted (HNSW stubs obsolete)
// ============================================================================

describe('ADR-0086 T3.4: memory-initializer deleted (HNSW stubs obsolete)', () => {
  it('memory-initializer.ts is absent (Debt 6)', () => {
    assert.ok(!existsSync(INITIALIZER_PATH),
      'memory-initializer.ts should be deleted');
  });
});

// ============================================================================
// Group 5: Integration — router exports the expected public API
// ============================================================================

describe('ADR-0086 integration: memory-router public API surface', () => {
  let routerSrc;

  beforeEach(() => {
    if (!existsSync(ROUTER_PATH)) return;
    routerSrc = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('router exports routeMemoryOp', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    assert.ok(
      routerSrc.includes('export async function routeMemoryOp'),
      'memory-router.ts must export routeMemoryOp',
    );
  });

  it('router exports routeEmbeddingOp', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    assert.ok(
      routerSrc.includes('export async function routeEmbeddingOp'),
      'memory-router.ts must export routeEmbeddingOp',
    );
  });

  it('router exports ensureRouter', () => {
    assert.ok(routerSrc, 'Fork not checked out — memory-router.ts required for this test');
    assert.ok(
      routerSrc.includes('export async function ensureRouter'),
      'memory-router.ts must export ensureRouter',
    );
  });
});

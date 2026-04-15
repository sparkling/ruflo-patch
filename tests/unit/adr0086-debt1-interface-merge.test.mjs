// @tier unit
// ADR-0086 Debt 1: Verify IStorageContract is a type alias for IMemoryBackend
//
// Source-level structural tests (London School TDD, no I/O beyond readFileSync).
// Verifies that:
//   1. IStorageContract is a type alias (not a separate interface)
//   2. RvfBackend does NOT have `implements IStorageContract` (only IMemoryBackend)
//   3. IStorageContract is still exported from the memory package barrel (index.ts)
//   4. IMemoryBackend has exactly 16 methods (canonical interface unchanged)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';

const STORAGE_PATH     = `${MEMORY_SRC}/storage.ts`;
const RVF_BACKEND_PATH = `${MEMORY_SRC}/rvf-backend.ts`;
const INDEX_PATH       = `${MEMORY_SRC}/index.ts`;
const TYPES_PATH       = `${MEMORY_SRC}/types.ts`;

// ============================================================================
// Load sources
// ============================================================================

const storageSrc  = readFileSync(STORAGE_PATH, 'utf-8');
const backendSrc  = readFileSync(RVF_BACKEND_PATH, 'utf-8');
const indexSrc    = readFileSync(INDEX_PATH, 'utf-8');
const typesSrc    = readFileSync(TYPES_PATH, 'utf-8');

// ============================================================================
// Group 1: IStorageContract is a type alias, not a separate interface
// ============================================================================

describe('ADR-0086 Debt 1: IStorageContract is a type alias for IMemoryBackend', () => {

  it('storage.ts contains `type IStorageContract = IMemoryBackend`', () => {
    // The debt target: IStorageContract should be a type alias, not an interface.
    // Match `type IStorageContract = IMemoryBackend` with optional whitespace.
    const aliasPattern = /export\s+type\s+IStorageContract\s*=\s*IMemoryBackend\s*;/;
    assert.ok(
      aliasPattern.test(storageSrc),
      'storage.ts must declare IStorageContract as a type alias: ' +
      '`export type IStorageContract = IMemoryBackend;`. ' +
      'Found an interface declaration instead — Debt 1 not resolved.',
    );
  });

  it('storage.ts does NOT have `interface IStorageContract`', () => {
    // If IStorageContract is still a full interface, the debt is unresolved.
    const interfacePattern = /export\s+interface\s+IStorageContract\s*\{/;
    assert.ok(
      !interfacePattern.test(storageSrc),
      'storage.ts must NOT declare IStorageContract as an interface. ' +
      'It should be a type alias for IMemoryBackend (Debt 1).',
    );
  });
});

// ============================================================================
// Group 2: RvfBackend implements only IMemoryBackend, not IStorageContract
// ============================================================================

describe('ADR-0086 Debt 1: RvfBackend implements clause', () => {

  it('RvfBackend does NOT have `implements IStorageContract`', () => {
    // Once IStorageContract is a type alias, `implements IStorageContract` is
    // redundant and should be removed — only `implements IMemoryBackend` remains.
    const classLine = backendSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classLine, 'RvfBackend class declaration not found');

    const implementsClause = classLine[1].trim();
    assert.ok(
      !implementsClause.includes('IStorageContract'),
      `RvfBackend implements clause should NOT include IStorageContract ` +
      `(it is a type alias, not an interface). Found: implements ${implementsClause}`,
    );
  });

  it('RvfBackend still implements IMemoryBackend', () => {
    const classLine = backendSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classLine, 'RvfBackend class declaration not found');

    const implementsClause = classLine[1].trim();
    assert.ok(
      implementsClause.includes('IMemoryBackend'),
      `RvfBackend must still implement IMemoryBackend. Found: implements ${implementsClause}`,
    );
  });
});

// ============================================================================
// Group 3: IStorageContract is still exported from the barrel (index.ts)
// ============================================================================

describe('ADR-0086 Debt 1: barrel export', () => {

  it('index.ts exports IStorageContract from storage.js', () => {
    // The barrel must still re-export IStorageContract for downstream consumers.
    assert.ok(
      indexSrc.includes('IStorageContract'),
      'index.ts must export IStorageContract from ./storage.js',
    );
  });

  it('index.ts exports IStorageContract as a type (export type)', () => {
    // Since IStorageContract is now a type alias, the barrel should use
    // `export type` (not a runtime re-export).
    // Find the export block that mentions IStorageContract
    const exportLines = indexSrc.split('\n').filter(l => l.includes('IStorageContract'));
    assert.ok(exportLines.length > 0, 'No line in index.ts mentions IStorageContract');

    // The export should be in a `export type { ... }` block or have `type` keyword
    // Walk backwards from the line to find the containing export statement
    const idx = indexSrc.indexOf('IStorageContract');
    const precedingBlock = indexSrc.slice(Math.max(0, idx - 200), idx);
    const hasExportType = precedingBlock.includes('export type');
    assert.ok(
      hasExportType,
      'IStorageContract must be exported via `export type` in index.ts',
    );
  });
});

// ============================================================================
// Group 4: IMemoryBackend canonical interface has exactly 16 methods
// ============================================================================

describe('ADR-0086 Debt 1: IMemoryBackend canonical method count', () => {

  it('IMemoryBackend has exactly 16 methods', () => {
    // Extract the IMemoryBackend interface block from types.ts
    const ifaceStart = typesSrc.indexOf('export interface IMemoryBackend');
    assert.ok(ifaceStart !== -1, 'IMemoryBackend not found in types.ts');

    // Find the matching closing brace
    let braceDepth = 0;
    let blockStart = -1;
    let blockEnd = -1;
    for (let i = ifaceStart; i < typesSrc.length; i++) {
      if (typesSrc[i] === '{') {
        if (braceDepth === 0) blockStart = i;
        braceDepth++;
      } else if (typesSrc[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) {
          blockEnd = i;
          break;
        }
      }
    }
    assert.ok(blockStart !== -1 && blockEnd !== -1, 'Could not delimit IMemoryBackend body');

    const block = typesSrc.slice(blockStart, blockEnd + 1);

    // Count method signatures: name(params): ReturnType;
    const methodRe = /^\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
    const methods = [];
    let m;
    while ((m = methodRe.exec(block)) !== null) {
      methods.push(m[1]);
    }

    assert.equal(
      methods.length,
      16,
      `IMemoryBackend must have exactly 16 methods. Found ${methods.length}: [${methods.join(', ')}]`,
    );
  });

  it('IMemoryBackend contains the 16 canonical methods', () => {
    const expected = [
      'initialize', 'shutdown', 'store', 'get', 'getByKey',
      'update', 'delete', 'query', 'search', 'bulkInsert',
      'bulkDelete', 'count', 'listNamespaces', 'clearNamespace',
      'getStats', 'healthCheck',
    ];

    for (const method of expected) {
      assert.ok(
        typesSrc.includes(`${method}(`),
        `IMemoryBackend must define method '${method}'`,
      );
    }
  });
});

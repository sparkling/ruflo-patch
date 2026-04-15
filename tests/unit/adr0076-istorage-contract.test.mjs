// @tier unit
// ADR-0076 Phase 3: Contract regression tests for IStorageContract / IMemoryBackend
//
// Guards the storage abstraction — the 16-method interface that every backend
// implements and that memory-router routes through. Sources:
//   - @claude-flow/memory/src/types.ts          (canonical IMemoryBackend interface)
//   - @claude-flow/memory/src/storage.ts        (IStorage / IStorageContract aliases)
//   - @claude-flow/memory/src/rvf-backend.ts    (RvfBackend implementation)
//
// Failures here indicate the storage abstraction has drifted — either a
// method was renamed, a backend missed an implementation, or the IStorageContract
// alias was reverted to a separate interface declaration.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC      = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const STORAGE_PATH    = `${MEMORY_SRC}/storage.ts`;
const TYPES_PATH      = `${MEMORY_SRC}/types.ts`;
const RVF_BACKEND_PATH = `${MEMORY_SRC}/rvf-backend.ts`;
const INDEX_PATH      = `${MEMORY_SRC}/index.ts`;

// Hard assertions before reads
assert.ok(existsSync(STORAGE_PATH),     `storage.ts not found at ${STORAGE_PATH}`);
assert.ok(existsSync(TYPES_PATH),       `types.ts not found at ${TYPES_PATH}`);
assert.ok(existsSync(RVF_BACKEND_PATH), `rvf-backend.ts not found at ${RVF_BACKEND_PATH}`);
assert.ok(existsSync(INDEX_PATH),       `memory index.ts not found at ${INDEX_PATH}`);

const storageSrc = readFileSync(STORAGE_PATH,     'utf-8');
const typesSrc   = readFileSync(TYPES_PATH,       'utf-8');
const backendSrc = readFileSync(RVF_BACKEND_PATH, 'utf-8');
const indexSrc   = readFileSync(INDEX_PATH,       'utf-8');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the IMemoryBackend interface body from types.ts.
 * Returns Map<methodName, paramCount>.
 */
function parseInterfaceMethods(src, ifaceName) {
  const ifaceStart = src.indexOf(`export interface ${ifaceName}`);
  assert.ok(ifaceStart !== -1, `${ifaceName} not found in source`);

  let braceDepth = 0;
  let blockStart = -1;
  let blockEnd = -1;
  for (let i = ifaceStart; i < src.length; i++) {
    if (src[i] === '{') {
      if (braceDepth === 0) blockStart = i;
      braceDepth++;
    } else if (src[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) { blockEnd = i; break; }
    }
  }
  assert.ok(blockStart !== -1 && blockEnd !== -1, `Could not delimit ${ifaceName} body`);

  const block = src.slice(blockStart, blockEnd + 1);
  const methods = new Map();
  // Match `name(params): ReturnType;`
  const methodRe = /^\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
  let m;
  while ((m = methodRe.exec(block)) !== null) {
    const name   = m[1];
    const params = m[2].trim();
    methods.set(name, params.length === 0 ? 0 : params.split(',').length);
  }
  return methods;
}

/** Extract public async methods from a class body. */
function parseClassAsyncMethods(src) {
  const methods = new Map();
  const lines = src.split('\n');
  for (const line of lines) {
    if (/^\s+private\s+async\s+/.test(line)) continue; // skip private
    const m = /^\s+async\s+(\w+)\s*\(([^)]*)\)\s*:/.exec(line);
    if (m) {
      const name = m[1];
      const params = m[2].trim();
      methods.set(name, params.length === 0 ? 0 : params.split(',').length);
    }
  }
  return methods;
}

const contractMethods = parseInterfaceMethods(typesSrc, 'IMemoryBackend');
const backendMethods  = parseClassAsyncMethods(backendSrc);

// ============================================================================
// The 16 canonical IMemoryBackend methods (per ADR-0076 / ADR-0086)
// ============================================================================

const CANONICAL_METHODS = [
  'initialize',
  'shutdown',
  'store',
  'get',
  'getByKey',
  'update',
  'delete',
  'query',
  'search',
  'bulkInsert',
  'bulkDelete',
  'count',
  'listNamespaces',
  'clearNamespace',
  'getStats',
  'healthCheck',
];

// ============================================================================
// Group 1: IMemoryBackend declares exactly 16 methods
// ============================================================================

describe('ADR-0076 IStorageContract: IMemoryBackend has exactly 16 methods', () => {
  it('IMemoryBackend interface declares 16 method signatures', () => {
    assert.equal(
      contractMethods.size,
      16,
      `Expected 16 methods on IMemoryBackend, got ${contractMethods.size}: ` +
        `[${[...contractMethods.keys()].join(', ')}]`,
    );
  });

  for (const name of CANONICAL_METHODS) {
    it(`IMemoryBackend declares: ${name}`, () => {
      assert.ok(
        contractMethods.has(name),
        `IMemoryBackend must declare method '${name}'`,
      );
    });
  }
});

// ============================================================================
// Group 2: IStorageContract is a TYPE ALIAS for IMemoryBackend (Debt 1)
// ============================================================================

describe('ADR-0076 / ADR-0086 Debt 1: IStorageContract is a type alias', () => {
  it('storage.ts declares `export type IStorageContract = IMemoryBackend`', () => {
    const aliasPattern = /export\s+type\s+IStorageContract\s*=\s*IMemoryBackend\s*;/;
    assert.ok(
      aliasPattern.test(storageSrc),
      'storage.ts must declare `export type IStorageContract = IMemoryBackend;`',
    );
  });

  it('storage.ts does NOT declare `interface IStorageContract`', () => {
    const interfacePattern = /export\s+interface\s+IStorageContract\s*\{/;
    assert.ok(
      !interfacePattern.test(storageSrc),
      'IStorageContract must NOT be a separate interface (it is an alias)',
    );
  });

  it('storage.ts also exposes IStorage as an alias (compatibility)', () => {
    const iStoragePattern = /export\s+type\s+IStorage\s*=\s*IMemoryBackend\s*;/;
    assert.ok(
      iStoragePattern.test(storageSrc),
      'storage.ts must declare `export type IStorage = IMemoryBackend;`',
    );
  });

  it('memory barrel re-exports IStorageContract (downstream consumers)', () => {
    assert.ok(
      indexSrc.includes('IStorageContract'),
      'memory index.ts must re-export IStorageContract',
    );
  });
});

// ============================================================================
// Group 3: RvfBackend declares `implements IMemoryBackend`
// ============================================================================

describe('ADR-0076 IStorageContract: RvfBackend implements IMemoryBackend', () => {
  it('RvfBackend class declares `implements IMemoryBackend`', () => {
    const classMatch = backendSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classMatch, 'RvfBackend class declaration not found');

    const implementsClause = classMatch[1].trim();
    assert.ok(
      implementsClause.includes('IMemoryBackend'),
      `RvfBackend must implement IMemoryBackend. Found: implements ${implementsClause}`,
    );
  });

  it('RvfBackend does NOT also implement IStorageContract directly', () => {
    // After Debt 1, IStorageContract is an alias — listing it explicitly is redundant.
    const classMatch = backendSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classMatch, 'RvfBackend class declaration not found');
    const implementsClause = classMatch[1].trim();
    assert.ok(
      !implementsClause.includes('IStorageContract'),
      `RvfBackend must NOT explicitly implement IStorageContract (it is an alias). ` +
      `Found: implements ${implementsClause}`,
    );
  });
});

// ============================================================================
// Group 4: RvfBackend implements every contract method as an async public method
// ============================================================================

describe('ADR-0076 IStorageContract: RvfBackend covers all 16 methods', () => {
  it('RvfBackend has at least 16 public async methods', () => {
    assert.ok(
      backendMethods.size >= 16,
      `RvfBackend must have >= 16 public async methods, got ${backendMethods.size}: ` +
        `[${[...backendMethods.keys()].join(', ')}]`,
    );
  });

  for (const name of CANONICAL_METHODS) {
    it(`RvfBackend.${name} is declared as an async public method`, () => {
      assert.ok(
        backendMethods.has(name),
        `RvfBackend is missing public async method '${name}'`,
      );
    });
  }

  it('every IMemoryBackend method exists on RvfBackend', () => {
    const missing = [];
    for (const [name] of contractMethods) {
      if (!backendMethods.has(name)) missing.push(name);
    }
    assert.deepStrictEqual(
      missing,
      [],
      `RvfBackend is MISSING these IMemoryBackend methods: [${missing.join(', ')}]`,
    );
  });
});

// ============================================================================
// Group 5: Method-by-method existence (clear diagnostics on regression)
// ============================================================================

describe('ADR-0076 IStorageContract: per-method existence', () => {
  for (const name of CANONICAL_METHODS) {
    it(`contract method '${name}' is in IMemoryBackend AND RvfBackend`, () => {
      assert.ok(contractMethods.has(name), `Missing from IMemoryBackend: ${name}`);
      assert.ok(backendMethods.has(name),  `Missing from RvfBackend: ${name}`);
    });
  }
});

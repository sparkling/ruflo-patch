// @tier unit
// ADR-0086: IStorageContract compliance — RvfBackend structural verification
//
// Source-level structural test (London School TDD, no mocking needed).
// Verifies that RvfBackend satisfies every method in IStorageContract
// by parsing the TypeScript source of both files.
//
// Checks:
//   1. Every IStorageContract method exists on RvfBackend
//   2. Parameter counts match between contract and implementation
//   3. Extra public methods on RvfBackend reported (informational)

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';

const STORAGE_PATH     = `${MEMORY_SRC}/storage.ts`;
const RVF_BACKEND_PATH = `${MEMORY_SRC}/rvf-backend.ts`;
const TYPES_PATH       = `${MEMORY_SRC}/types.ts`;

// ============================================================================
// Parser helpers
// ============================================================================

/**
 * Extract method signatures from IMemoryBackend interface block in types.ts.
 * Returns Map<methodName, paramCount>.
 *
 * Since ADR-0086 Debt 1, IStorageContract is a type alias for IMemoryBackend,
 * so the canonical method list lives in the IMemoryBackend interface.
 *
 * Matches lines like:
 *   initialize(): Promise<void>;
 *   store(entry: MemoryEntry): Promise<void>;
 *   getByKey(namespace: string, key: string): Promise<MemoryEntry | null>;
 */
function parseContractMethods(source) {
  // Parse IMemoryBackend (the canonical interface after Debt 1 merge)
  const ifaceStart = source.indexOf('export interface IMemoryBackend');
  assert.ok(ifaceStart !== -1, 'IMemoryBackend not found in types.ts');

  // Find the matching closing brace — count braces from the opening one
  let braceDepth = 0;
  let blockStart = -1;
  let blockEnd = -1;
  for (let i = ifaceStart; i < source.length; i++) {
    if (source[i] === '{') {
      if (braceDepth === 0) blockStart = i;
      braceDepth++;
    } else if (source[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        blockEnd = i;
        break;
      }
    }
  }
  assert.ok(blockStart !== -1 && blockEnd !== -1, 'Could not delimit IMemoryBackend body');

  const block = source.slice(blockStart, blockEnd + 1);
  const methods = new Map();

  // Match method signatures: name(params): ReturnType;
  const methodRe = /^\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
  let m;
  while ((m = methodRe.exec(block)) !== null) {
    const name = m[1];
    const params = m[2].trim();
    const paramCount = params.length === 0 ? 0 : params.split(',').length;
    methods.set(name, paramCount);
  }

  return methods;
}

/**
 * Extract public async method signatures from RvfBackend class.
 * Returns Map<methodName, paramCount>.
 *
 * Matches lines like:
 *   async initialize(): Promise<void> {
 *   async store(entry: MemoryEntry): Promise<void> {
 *
 * Skips private methods (prefixed with `private`).
 */
function parseBackendMethods(source) {
  const methods = new Map();

  // Match public async methods — lines that have `async name(` but NOT `private async`
  const methodRe = /^\s+async\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
  const privateRe = /^\s+private\s+async\s+/;

  // We need to check each match line for `private` prefix, so iterate lines
  const lines = source.split('\n');
  for (const line of lines) {
    if (privateRe.test(line)) continue; // skip private methods

    const match = /^\s+async\s+(\w+)\s*\(([^)]*)\)\s*:/.exec(line);
    if (match) {
      const name = match[1];
      const params = match[2].trim();
      const paramCount = params.length === 0 ? 0 : params.split(',').length;
      methods.set(name, paramCount);
    }
  }

  return methods;
}

// ============================================================================
// Load and parse sources
// ============================================================================

const storageSrc = readFileSync(STORAGE_PATH, 'utf-8');
const typesSrc   = readFileSync(TYPES_PATH, 'utf-8');
const backendSrc = readFileSync(RVF_BACKEND_PATH, 'utf-8');

const contractMethods = parseContractMethods(typesSrc);
const backendMethods  = parseBackendMethods(backendSrc);

// ============================================================================
// Group 1: IStorageContract is parseable and non-empty
// ============================================================================

describe('ADR-0086: IStorageContract parse validation', () => {
  it('IStorageContract defines exactly 16 methods', () => {
    assert.equal(
      contractMethods.size,
      16,
      `Expected 16 methods in IStorageContract, got ${contractMethods.size}: ` +
        `[${[...contractMethods.keys()].join(', ')}]`,
    );
  });

  it('RvfBackend has at least 16 public async methods', () => {
    assert.ok(
      backendMethods.size >= 16,
      `Expected >= 16 public methods on RvfBackend, got ${backendMethods.size}: ` +
        `[${[...backendMethods.keys()].join(', ')}]`,
    );
  });
});

// ============================================================================
// Group 2: Every IStorageContract method exists on RvfBackend
// ============================================================================

describe('ADR-0086: RvfBackend implements every IStorageContract method', () => {
  const missing = [];
  for (const [name] of contractMethods) {
    if (!backendMethods.has(name)) missing.push(name);
  }

  it('no contract methods are missing from RvfBackend', () => {
    assert.deepStrictEqual(
      missing,
      [],
      `RvfBackend is MISSING these IStorageContract methods: [${missing.join(', ')}]`,
    );
  });

  // Individual per-method existence tests for clear diagnostics
  for (const [name] of contractMethods) {
    it(`RvfBackend has method: ${name}`, () => {
      assert.ok(
        backendMethods.has(name),
        `RvfBackend is missing IStorageContract method '${name}'`,
      );
    });
  }
});

// ============================================================================
// Group 3: Parameter arity matches between contract and implementation
// ============================================================================

describe('ADR-0086: RvfBackend method arities match IStorageContract', () => {
  const mismatches = [];
  for (const [name, expectedArity] of contractMethods) {
    if (!backendMethods.has(name)) continue; // already caught by Group 2
    const actualArity = backendMethods.get(name);
    if (actualArity !== expectedArity) {
      mismatches.push({ name, expected: expectedArity, actual: actualArity });
    }
  }

  it('no arity mismatches between contract and implementation', () => {
    assert.deepStrictEqual(
      mismatches,
      [],
      'Arity mismatches:\n' +
        mismatches
          .map(m => `  ${m.name}: contract=${m.expected}, backend=${m.actual}`)
          .join('\n'),
    );
  });

  // Individual per-method arity tests
  for (const [name, expectedArity] of contractMethods) {
    it(`${name} arity: contract=${expectedArity}, backend=${backendMethods.get(name) ?? 'MISSING'}`, () => {
      if (!backendMethods.has(name)) {
        assert.fail(`Cannot check arity — method '${name}' is missing from RvfBackend`);
      }
      assert.equal(
        backendMethods.get(name),
        expectedArity,
        `${name}: expected ${expectedArity} params (contract), got ${backendMethods.get(name)} (backend)`,
      );
    });
  }
});

// ============================================================================
// Group 4: Extra methods on RvfBackend (informational — not failures)
// ============================================================================

describe('ADR-0086: Extra public methods on RvfBackend (informational)', () => {
  const extras = [];
  for (const [name] of backendMethods) {
    if (!contractMethods.has(name)) extras.push(name);
  }

  it('reports extra methods (does not fail)', () => {
    // This test always passes — it just documents extra methods
    if (extras.length > 0) {
      // Log for visibility in test output
      console.log(
        `  [info] RvfBackend has ${extras.length} extra public method(s) ` +
          `beyond IStorageContract: [${extras.join(', ')}]`,
      );
    } else {
      console.log('  [info] RvfBackend has no extra public methods beyond IStorageContract');
    }
    assert.ok(true);
  });

  // Document each extra method individually
  for (const name of extras) {
    it(`extra method: ${name} (arity=${backendMethods.get(name)})`, () => {
      // Informational — always passes
      assert.ok(true);
    });
  }
});

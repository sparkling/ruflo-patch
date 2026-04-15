// @tier unit
// ADR-0086 debt 17: intelligence.cjs RVF reader — verify SQLite removal and RVF adoption
// Source-level structural test (London School TDD, no live code execution).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const INTEL_PATH = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/.claude/helpers/intelligence.cjs';
const src = readFileSync(INTEL_PATH, 'utf-8');

// --- Group 1: readStoreFromRvf exists (old readStoreFromDb replaced)

describe('ADR-0086 debt 17: readStoreFromRvf function', () => {
  it('readStoreFromRvf function is defined', () => {
    assert.ok(
      src.includes('function readStoreFromRvf'),
      'intelligence.cjs must define readStoreFromRvf (RVF reader replacing SQLite reader)'
    );
  });

  it('readStoreFromDb function is NOT defined (old SQLite reader removed)', () => {
    // Match function definition, not just any mention (comments are OK)
    const defPattern = /^function readStoreFromDb\b/m;
    assert.ok(
      !defPattern.test(src),
      'intelligence.cjs must NOT define readStoreFromDb — SQLite reader should be removed'
    );
  });
});

// --- Group 2: No better-sqlite3 dependency

describe('ADR-0086 debt 17: no better-sqlite3 in intelligence.cjs', () => {
  it('does not require better-sqlite3', () => {
    assert.ok(
      !src.includes("require('better-sqlite3')"),
      'intelligence.cjs must not require better-sqlite3 — RVF reader is pure fs'
    );
  });

  it('does not import better-sqlite3', () => {
    assert.ok(
      !src.includes("import('better-sqlite3')"),
      'intelligence.cjs must not dynamically import better-sqlite3'
    );
  });
});

// --- Group 3: RVF magic byte validation

describe('ADR-0086 debt 17: RVF binary format handling', () => {
  it('validates RVF magic bytes (0x52 or RVF header)', () => {
    const hasHexMagic = src.includes('0x52');
    const hasStringMagic = src.includes("RVF\\0") || src.includes("'RVF'") || src.includes('"RVF"');
    const hasMagicCheck = src.includes('magic') || src.includes('MAGIC') || src.includes('header');
    assert.ok(
      hasHexMagic || hasStringMagic || hasMagicCheck,
      'intelligence.cjs must validate RVF magic bytes (0x52 / RVF header) when reading .rvf files'
    );
  });
});

// --- Group 4: WAL replay support

describe('ADR-0086 debt 17: WAL replay in intelligence.cjs', () => {
  it('reads .rvf.wal for WAL replay', () => {
    assert.ok(
      src.includes('.rvf.wal') || src.includes('rvf.wal') || src.includes('.wal'),
      'intelligence.cjs must read .rvf.wal files for WAL replay support'
    );
  });
});

// --- Group 5: Fallback chain for RVF file locations

describe('ADR-0086 debt 17: RVF fallback chain', () => {
  it('checks .claude-flow/memory.rvf', () => {
    assert.ok(
      src.includes('.claude-flow/memory.rvf') || src.includes("'memory.rvf'"),
      'intelligence.cjs must check .claude-flow/memory.rvf as primary RVF path'
    );
  });

  it('checks .swarm/memory.rvf as fallback', () => {
    assert.ok(
      src.includes('.swarm/memory.rvf') || src.includes("swarm', 'memory.rvf'"),
      'intelligence.cjs must check .swarm/memory.rvf as fallback RVF path'
    );
  });
});

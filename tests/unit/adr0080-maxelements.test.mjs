// @tier unit
// ADR-0080 P3: maxElements unification via init scripts
//
// Verifies that the config chain produces correct maxEntries/maxElements values:
//   1. resolve-config.ts     DEFAULT_MAX_ENTRIES = 100_000
//   2. config-template.ts    init generates maxEntries: 100000 (not 1000000)
//   3. database-provider.ts  RVF case delegates to createStorageFromConfig
//   4. rvf-backend.ts        DEFAULT_MAX_ELEMENTS = 100000
//
// London School TDD: read fork source text, assert against literals.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FORK_MEMORY_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const FORK_CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

const resolveConfigSrc = readFileSync(resolve(FORK_MEMORY_SRC, 'resolve-config.ts'), 'utf-8');
const configTemplateSrc = readFileSync(resolve(FORK_CLI_SRC, 'init/config-template.ts'), 'utf-8');
const databaseProvSrc = readFileSync(resolve(FORK_MEMORY_SRC, 'database-provider.ts'), 'utf-8');
const rvfBackendSrc = readFileSync(resolve(FORK_MEMORY_SRC, 'rvf-backend.ts'), 'utf-8');

// ============================================================================
// 1. resolve-config canonical default is 100_000
// ============================================================================

describe('ADR-0080 P3: resolve-config DEFAULT_MAX_ENTRIES', () => {
  it('DEFAULT_MAX_ENTRIES is 100_000', () => {
    assert.ok(
      resolveConfigSrc.includes('DEFAULT_MAX_ENTRIES = 100_000'),
      'resolve-config.ts must set DEFAULT_MAX_ENTRIES = 100_000',
    );
  });

  it('maxEntries is exposed under the memory block of ResolvedConfig', () => {
    assert.ok(
      resolveConfigSrc.includes('readonly maxEntries: number'),
      'ResolvedConfig must expose readonly maxEntries inside memory block',
    );
  });

  it('the default flows into the resolved object', () => {
    assert.ok(
      resolveConfigSrc.includes('maxEntries: number = DEFAULT_MAX_ENTRIES'),
      'resolveConfig() must initialize maxEntries from DEFAULT_MAX_ENTRIES',
    );
  });
});

// ============================================================================
// 2. config-template generates correct maxEntries for init'd projects
// ============================================================================

describe('ADR-0080 P3: config-template init values', () => {
  it('memory.maxElements is 100000 in init template', () => {
    assert.ok(
      configTemplateSrc.includes('maxElements: 100000'),
      'config-template must generate maxElements: 100000',
    );
  });

  it('memory.storage.maxEntries is 100000 (not 1000000) in init template', () => {
    // The init template must not generate the old 1M value
    const storageBlock = configTemplateSrc.slice(
      configTemplateSrc.indexOf('storage:'),
      configTemplateSrc.indexOf('storage:') + 200,
    );
    assert.ok(
      storageBlock.includes('maxEntries: 100000'),
      'config-template storage.maxEntries must be 100000',
    );
    assert.ok(
      !storageBlock.includes('maxEntries: 1000000'),
      'config-template storage.maxEntries must NOT be 1000000',
    );
  });

  it('embeddings.hnsw.maxElements is 100000 in init template', () => {
    const embBlock = configTemplateSrc.slice(
      configTemplateSrc.indexOf('embeddings:'),
    );
    assert.ok(
      embBlock.includes('maxElements: 100000'),
      'config-template embeddings.hnsw.maxElements must be 100000',
    );
  });
});

// ============================================================================
// 3. database-provider RVF case delegates to createStorageFromConfig
// ============================================================================

describe('ADR-0080 P1: database-provider factory convergence', () => {
  it('RVF case calls createStorageFromConfig', () => {
    const rvfCase = databaseProvSrc.slice(
      databaseProvSrc.indexOf("case 'rvf'"),
      databaseProvSrc.indexOf("case 'rvf'") + 500,
    );
    assert.ok(
      rvfCase.includes('createStorageFromConfig'),
      'database-provider RVF case must delegate to createStorageFromConfig',
    );
  });

  it('RVF case passes caller overrides (databasePath, verbose)', () => {
    const rvfCase = databaseProvSrc.slice(
      databaseProvSrc.indexOf("case 'rvf'"),
      databaseProvSrc.indexOf("case 'rvf'") + 500,
    );
    assert.ok(
      rvfCase.includes('databasePath: path'),
      'RVF case must forward caller path as databasePath override',
    );
    assert.ok(
      rvfCase.includes('verbose'),
      'RVF case must forward verbose option',
    );
  });

  it('imports createStorageFromConfig from storage-factory', () => {
    const rvfCase = databaseProvSrc.slice(
      databaseProvSrc.indexOf("case 'rvf'"),
      databaseProvSrc.indexOf("case 'rvf'") + 500,
    );
    assert.ok(
      rvfCase.includes("'./storage-factory.js'"),
      'RVF case must import from storage-factory.js',
    );
  });
});

// ============================================================================
// 4. rvf-backend DEFAULT_MAX_ELEMENTS is 100000
// ============================================================================

describe('ADR-0080 P3: rvf-backend DEFAULT_MAX_ELEMENTS', () => {
  it('DEFAULT_MAX_ELEMENTS is 100000', () => {
    assert.ok(
      rvfBackendSrc.includes('DEFAULT_MAX_ELEMENTS = 100000'),
      'rvf-backend.ts must set DEFAULT_MAX_ELEMENTS = 100000',
    );
  });
});

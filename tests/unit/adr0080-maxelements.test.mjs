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

// ============================================================================
// 5. config-template embeddings provider is 'transformers.js'
// ============================================================================

const executorSrc = readFileSync(resolve(FORK_CLI_SRC, 'init/executor.ts'), 'utf-8');
const initCmdSrc = readFileSync(resolve(FORK_CLI_SRC, 'commands/init.ts'), 'utf-8');
const memoryBridgeSrc = readFileSync(
  resolve(FORK_CLI_SRC, 'memory/memory-bridge.ts'),
  'utf-8',
);
const configToolsSrc = readFileSync(resolve(FORK_CLI_SRC, 'mcp-tools/config-tools.ts'), 'utf-8');

describe('ADR-0080 P2: config-template embeddings.provider', () => {
  it('provider is transformers.js (not bare transformers)', () => {
    const embBlock = configTemplateSrc.slice(
      configTemplateSrc.indexOf('embeddings:'),
    );
    assert.ok(
      embBlock.includes("provider: 'transformers.js'"),
      "config-template embeddings.provider must be 'transformers.js'",
    );
    // Ensure the old bare value is NOT present in the embeddings block
    const providerLine = embBlock.split('\n').find(l => l.includes('provider:'));
    assert.ok(
      !providerLine.includes("'transformers'") || providerLine.includes("'transformers.js'"),
      "config-template must not use bare 'transformers' as provider",
    );
  });
});

// ============================================================================
// 6. config-template hnsw.M is uppercase
// ============================================================================

describe('ADR-0080 P2: config-template hnsw.M casing', () => {
  it('uses uppercase M: (not lowercase m:)', () => {
    const hnswBlock = configTemplateSrc.slice(
      configTemplateSrc.indexOf('hnsw:'),
      configTemplateSrc.indexOf('hnsw:') + 200,
    );
    assert.ok(
      hnswBlock.includes('M:'),
      'config-template hnsw block must use uppercase M:',
    );
    // Verify no lowercase m: on its own line (would be a separate key)
    const mLine = hnswBlock.split('\n').find(l => /^\s+m:/.test(l));
    assert.equal(mLine, undefined, 'config-template hnsw block must NOT have lowercase m: key');
  });
});

// ============================================================================
// 7. executor.ts embeddings.json includes storage fields
// ============================================================================

describe('ADR-0080 P2: executor embeddings.json write block', () => {
  // Locate the embeddings.json write block (between the JSON.stringify call
  // and the writeFileSync for embeddingsJsonPath)
  const embJsonStart = executorSrc.indexOf('storageProvider:');
  const embJsonBlock = executorSrc.slice(
    executorSrc.lastIndexOf('JSON.stringify', embJsonStart),
    executorSrc.indexOf('writeFileSync(embeddingsJsonPath'),
  );

  for (const field of [
    'storageProvider',
    'databasePath',
    'walMode',
    'autoPersistInterval',
    'maxEntries',
    'defaultNamespace',
    'dedupThreshold',
  ]) {
    it(`includes ${field}`, () => {
      assert.ok(
        embJsonBlock.includes(field),
        `executor embeddings.json block must include ${field}`,
      );
    });
  }
});

// ============================================================================
// 8. executor.ts ConfigOverrides includes embeddingModel
// ============================================================================

describe('ADR-0080 P2: executor ConfigOverrides construction', () => {
  const overridesStart = executorSrc.indexOf('const overrides: ConfigOverrides');
  const overridesBlock = executorSrc.slice(overridesStart, overridesStart + 300);

  it('passes embeddingModel', () => {
    assert.ok(
      overridesBlock.includes('embeddingModel:'),
      'executor ConfigOverrides must include embeddingModel',
    );
  });

  it('passes embeddingDim', () => {
    assert.ok(
      overridesBlock.includes('embeddingDim:'),
      'executor ConfigOverrides must include embeddingDim',
    );
  });
});

// ============================================================================
// 9. wizard default model is canonical Xenova/all-mpnet-base-v2
// ============================================================================

describe('ADR-0080 P2: wizard embedding-model default', () => {
  it('wizard flags default is Xenova/all-mpnet-base-v2', () => {
    // The wizard sub-command defines its flags with a default for embedding-model
    const wizardFlagsBlock = initCmdSrc.slice(
      initCmdSrc.indexOf("name: 'embedding-model'"),
      initCmdSrc.indexOf("name: 'embedding-model'") + 200,
    );
    assert.ok(
      wizardFlagsBlock.includes("default: 'Xenova/all-mpnet-base-v2'"),
      "wizard embedding-model default must be 'Xenova/all-mpnet-base-v2'",
    );
  });

  it('wizard agentdb fallback is Xenova/all-mpnet-base-v2', () => {
    // The wizard dynamically imports agentdb with a catch fallback
    assert.ok(
      initCmdSrc.includes("model: 'Xenova/all-mpnet-base-v2'"),
      "wizard agentdb catch fallback must use 'Xenova/all-mpnet-base-v2'",
    );
  });
});

// ============================================================================
// 10. memory-bridge maxEntries fallback is 100000
// ============================================================================

describe('ADR-0080 P2: memory-bridge maxEntries fallback', () => {
  it('maxEntries fallback is 100000 (not 1000000)', () => {
    const maxEntriesLine = memoryBridgeSrc
      .split('\n')
      .find(l => l.includes('maxEntries:') && l.includes('??'));
    assert.ok(maxEntriesLine, 'memory-bridge must have a maxEntries line with ?? fallback');
    assert.ok(
      maxEntriesLine.includes('100000'),
      'memory-bridge maxEntries fallback must be 100000',
    );
    assert.ok(
      !maxEntriesLine.includes('1000000'),
      'memory-bridge maxEntries fallback must NOT be 1000000',
    );
  });
});

// ============================================================================
// 11. config-tools DEFAULT_CONFIG memory.maxEntries is 100000
// ============================================================================

describe('ADR-0080 P2: config-tools DEFAULT_CONFIG maxEntries', () => {
  it('memory.maxEntries is 100000', () => {
    assert.ok(
      configToolsSrc.includes("'memory.maxEntries': 100000"),
      "config-tools DEFAULT_CONFIG must set 'memory.maxEntries': 100000",
    );
  });

  it('memory.maxEntries is not 1000000', () => {
    assert.ok(
      !configToolsSrc.includes("'memory.maxEntries': 1000000"),
      "config-tools DEFAULT_CONFIG must NOT have 'memory.maxEntries': 1000000",
    );
  });
});

// ============================================================================
// 12. P6-A: helpers-generator consolidate writes flat array
// ============================================================================

const helpersGenSrc = readFileSync(resolve(FORK_CLI_SRC, 'init/helpers-generator.ts'), 'utf-8');

describe('ADR-0080 P6-A: helpers-generator store format', () => {
  it('consolidate writes flat array, not wrapped { entries: [] }', () => {
    // Find the generated consolidate method (object method style: "consolidate: function()")
    const consolidateStart = helpersGenSrc.indexOf('consolidate: function()');
    assert.ok(consolidateStart > -1, 'helpers-generator must contain a consolidate method');
    const consolidateBlock = helpersGenSrc.slice(consolidateStart, consolidateStart + 2000);
    // Should write entries directly, not { entries: entries }
    assert.ok(
      consolidateBlock.includes('writeJSON(STORE_PATH, entries)'),
      'generated consolidate must write flat array: writeJSON(STORE_PATH, entries)',
    );
    assert.ok(
      !consolidateBlock.includes('writeJSON(STORE_PATH, { entries'),
      'generated consolidate must NOT write wrapped object { entries: ... }',
    );
  });
});

// ============================================================================
// 13. P7-A: settings-generator maxNodes reads from options
// ============================================================================

const settingsGenSrc = readFileSync(resolve(FORK_CLI_SRC, 'init/settings-generator.ts'), 'utf-8');

describe('ADR-0080 P7-A: settings-generator maxNodes', () => {
  it('maxNodes reads from options.runtime.maxNodes', () => {
    assert.ok(
      settingsGenSrc.includes('options?.runtime?.maxNodes') ||
      settingsGenSrc.includes('options.runtime?.maxNodes') ||
      settingsGenSrc.includes('options.runtime.maxNodes'),
      'settings-generator maxNodes must read from options.runtime.maxNodes',
    );
  });
});

// ============================================================================
// 14. P7-B: types.ts FULL_INIT_OPTIONS cacheSize is 256
// ============================================================================

const typesSrc = readFileSync(resolve(FORK_CLI_SRC, 'init/types.ts'), 'utf-8');

describe('ADR-0080 P7-B: FULL_INIT_OPTIONS cacheSize', () => {
  it('cacheSize is 256 (not 384)', () => {
    const fullOptsStart = typesSrc.indexOf('FULL_INIT_OPTIONS');
    assert.ok(fullOptsStart > -1, 'types.ts must define FULL_INIT_OPTIONS');
    const fullOptsBlock = typesSrc.slice(fullOptsStart, fullOptsStart + 2000);
    const cacheLine = fullOptsBlock.split('\n').find(l => l.includes('cacheSize:'));
    assert.ok(cacheLine, 'FULL_INIT_OPTIONS must have a cacheSize field');
    assert.ok(
      cacheLine.includes('256'),
      'FULL_INIT_OPTIONS.runtime.cacheSize must be 256 (not 384)',
    );
    assert.ok(
      !cacheLine.includes('384'),
      'FULL_INIT_OPTIONS.runtime.cacheSize must NOT be 384',
    );
  });
});

// ============================================================================
// 15. config-adapter cacheSize fallback is 100000
// ============================================================================

const configAdapterSrc = readFileSync(resolve(FORK_CLI_SRC, 'config-adapter.ts'), 'utf-8');

describe('ADR-0080: config-adapter cacheSize fallback', () => {
  it('cacheSize fallback is 100000 (not 1000000)', () => {
    const cacheLine = configAdapterSrc.split('\n').find(l => l.includes('cacheSize:') && l.includes('??'));
    assert.ok(cacheLine, 'config-adapter must have cacheSize with ?? fallback');
    assert.ok(
      cacheLine.includes('100000'),
      'config-adapter cacheSize fallback must be 100000',
    );
    assert.ok(
      !cacheLine.includes('1000000'),
      'config-adapter cacheSize fallback must NOT be 1000000',
    );
  });
});

// ============================================================================
// 16. memory-initializer creates memory_entries after RVF init
// ============================================================================

const memoryInitSrc = readFileSync(
  resolve(FORK_CLI_SRC, 'memory/memory-initializer.ts'),
  'utf-8',
);

describe('ADR-0080: memory-initializer creates memory_entries after RVF init', () => {
  // The RVF success path starts at `createStorage(` and ends at the next
  // `return { success: true, backend: 'rvf'`. The CREATE TABLE must appear
  // between those two landmarks, BEFORE the return statement.

  const createStorageIdx = memoryInitSrc.indexOf('createStorage({');
  const rvfReturnIdx = memoryInitSrc.indexOf("backend: 'rvf'", createStorageIdx);

  it('RVF success path runs MEMORY_SCHEMA_V3 against SQLite', () => {
    assert.ok(createStorageIdx > -1, 'memory-initializer must call createStorage()');
    assert.ok(rvfReturnIdx > -1, "memory-initializer must return backend: 'rvf'");
    const rvfBlock = memoryInitSrc.slice(createStorageIdx, rvfReturnIdx);
    assert.ok(
      rvfBlock.includes('CREATE TABLE IF NOT EXISTS memory_entries'),
      'RVF success path must create memory_entries table',
    );
  });

  it('MEMORY_SCHEMA_V3 reference appears before the return statement', () => {
    const schemaIdx = memoryInitSrc.indexOf(
      'CREATE TABLE IF NOT EXISTS memory_entries',
      createStorageIdx,
    );
    assert.ok(
      schemaIdx > -1 && schemaIdx < rvfReturnIdx,
      'CREATE TABLE must appear before the return { success, backend: rvf } block',
    );
  });

  it('ADR-0080 comment marks the create-table block', () => {
    const rvfBlock = memoryInitSrc.slice(createStorageIdx, rvfReturnIdx);
    assert.ok(
      rvfBlock.includes('ADR-0080'),
      'RVF success path must reference ADR-0080 in a comment',
    );
  });
});

// ============================================================================
// 17. ensureSchemaColumns creates table if missing
// ============================================================================

describe('ADR-0080: ensureSchemaColumns creates table if missing', () => {
  const fnStart = memoryInitSrc.indexOf('export async function ensureSchemaColumns');

  it('ensureSchemaColumns is exported', () => {
    assert.ok(fnStart > -1, 'memory-initializer must export ensureSchemaColumns');
  });

  it('runs MEMORY_SCHEMA_V3 to create tables', () => {
    const fnBlock = memoryInitSrc.slice(fnStart, fnStart + 1500);
    assert.ok(
      fnBlock.includes('CREATE TABLE IF NOT EXISTS memory_entries'),
      'ensureSchemaColumns must create memory_entries table',
    );
  });

  it('ADR-0080 comment marks the table-creation block', () => {
    const fnBlock = memoryInitSrc.slice(fnStart, fnStart + 500);
    assert.ok(
      fnBlock.includes('ADR-0080'),
      'ensureSchemaColumns must reference ADR-0080 in a comment',
    );
  });

  it('is listed in the module exports', () => {
    assert.ok(
      memoryInitSrc.includes('ensureSchemaColumns,') ||
      memoryInitSrc.includes('ensureSchemaColumns }'),
      'ensureSchemaColumns must appear in the module export list',
    );
  });
});

// ============================================================================
// 18. intelligence.ts uses directory traversal for embeddings.json
// ============================================================================

const intelligenceSrc = readFileSync(
  resolve(FORK_CLI_SRC, 'memory/intelligence.ts'),
  'utf-8',
);

describe('ADR-0080: intelligence.ts directory traversal for embeddings.json', () => {
  // Find the EWC dimension block that reads embeddings.json
  const ewcDimIdx = intelligenceSrc.indexOf('ewcDim');

  it('has an ewcDim variable that reads embedding dimension', () => {
    assert.ok(ewcDimIdx > -1, 'intelligence.ts must define ewcDim for EWC consolidator');
  });

  it('uses a while-loop to walk up directories (not bare process.cwd())', () => {
    // The embeddings.json lookup must use a while loop walking up dirs,
    // not just process.cwd() + hard-coded relative path.
    const ewcBlock = intelligenceSrc.slice(ewcDimIdx, ewcDimIdx + 600);
    assert.ok(
      ewcBlock.includes('while') && ewcBlock.includes('dirname'),
      'embeddings.json lookup must use while-loop directory traversal',
    );
  });

  it('walks up via path.dirname (not bare process.cwd() alone)', () => {
    const ewcBlock = intelligenceSrc.slice(ewcDimIdx, ewcDimIdx + 600);
    // Must contain the walk-up pattern: _dir !== _path.dirname(_dir)
    assert.ok(
      ewcBlock.includes('dirname(') && ewcBlock.includes('embeddings.json'),
      'must walk up with dirname() looking for embeddings.json',
    );
  });

  it('reads .claude-flow/embeddings.json, not a bare cwd path', () => {
    const ewcBlock = intelligenceSrc.slice(ewcDimIdx, ewcDimIdx + 600);
    assert.ok(
      ewcBlock.includes('.claude-flow') && ewcBlock.includes('embeddings.json'),
      'must look for .claude-flow/embeddings.json in traversal',
    );
  });
});

// ============================================================================
// 19. memory-bridge resolves RVF path from embeddings.json (not hardcoded)
// ============================================================================

describe('ADR-0080: memory-bridge RVF path resolution', () => {
  it('does NOT use agentdb-memory.rvf as the PRIMARY path', () => {
    const bridgeSrc = readFileSync(resolve(FORK_CLI_SRC, 'memory/memory-bridge.ts'), 'utf-8');
    // The first rvfPath assignment must NOT be agentdb-memory.rvf
    // It should reference embeddings.json databasePath or 'memory.rvf'
    // (agentdb-memory.rvf may still appear as a legacy fallback, which is OK)
    const rvfSection = bridgeSrc.slice(
      bridgeSrc.indexOf('rvfStorePromise'),
      bridgeSrc.indexOf('rvfStorePromise') + 3000,
    );
    // The primary path resolution must use embeddings.json or memory.rvf
    assert.ok(
      rvfSection.includes('embeddings.json') || rvfSection.includes("'memory.rvf'"),
      'memory-bridge primary RVF path must come from embeddings.json or canonical memory.rvf',
    );
  });

  it('reads databasePath from embeddings.json', () => {
    const bridgeSrc = readFileSync(resolve(FORK_CLI_SRC, 'memory/memory-bridge.ts'), 'utf-8');
    const rvfSection = bridgeSrc.slice(
      bridgeSrc.indexOf('rvfStorePromise'),
      bridgeSrc.indexOf('rvfStorePromise') + 1500,
    );
    assert.ok(
      rvfSection.includes('databasePath') && rvfSection.includes('embeddings.json'),
      'memory-bridge must resolve RVF path from embeddings.json databasePath',
    );
  });

  it('falls back to memory.rvf (canonical name)', () => {
    const bridgeSrc = readFileSync(resolve(FORK_CLI_SRC, 'memory/memory-bridge.ts'), 'utf-8');
    const rvfSection = bridgeSrc.slice(
      bridgeSrc.indexOf('rvfStorePromise'),
      bridgeSrc.indexOf('rvfStorePromise') + 1500,
    );
    assert.ok(
      rvfSection.includes("'memory.rvf'"),
      'memory-bridge must fall back to canonical memory.rvf name',
    );
  });
});

// ============================================================================
// 20. memory.ts does not copy to .claude/memory.db
// ============================================================================

const memoryCmdSrc = readFileSync(
  resolve(FORK_CLI_SRC, 'commands/memory.ts'),
  'utf-8',
);

describe('ADR-0080: no dead .claude/memory.db copy', () => {
  it('initMemoryCommand does not copyFileSync to .claude/', () => {
    const initSection = memoryCmdSrc.slice(
      memoryCmdSrc.indexOf('initMemoryCommand'),
    );
    assert.ok(
      !initSection.includes('copyFileSync'),
      'memory init must NOT copyFileSync to .claude/memory.db',
    );
  });
});

// ============================================================================
// 21. RVF shim exists and is wired into memory-bridge
// ============================================================================

const rvfShimSrc = readFileSync(
  resolve(FORK_CLI_SRC, 'memory/rvf-shim.ts'),
  'utf-8',
);

describe('ADR-0080 P5: RVF shim exists and is wired', () => {
  it('rvf-shim.ts file exists and has content', () => {
    assert.ok(rvfShimSrc.length > 100, 'rvf-shim.ts must exist with substantial content');
  });

  it('exports init function', () => {
    assert.ok(
      rvfShimSrc.includes('export async function init'),
      'rvf-shim must export an init function',
    );
  });

  it('exports isReady function', () => {
    assert.ok(
      rvfShimSrc.includes('export function isReady'),
      'rvf-shim must export an isReady function',
    );
  });

  it('exports store function', () => {
    assert.ok(
      rvfShimSrc.includes('export async function store'),
      'rvf-shim must export a store function',
    );
  });

  it('exports search function', () => {
    assert.ok(
      rvfShimSrc.includes('export async function search'),
      'rvf-shim must export a search function',
    );
  });

  it('exports shutdown function', () => {
    assert.ok(
      rvfShimSrc.includes('export async function shutdown'),
      'rvf-shim must export a shutdown function',
    );
  });

  it('resolves RVF path from embeddings.json', () => {
    assert.ok(
      rvfShimSrc.includes('embeddings.json') && rvfShimSrc.includes('databasePath'),
      'rvf-shim must resolve RVF path from embeddings.json databasePath',
    );
  });

  it('falls back to memory.rvf in swarm dir', () => {
    assert.ok(
      rvfShimSrc.includes("'memory.rvf'"),
      'rvf-shim must fall back to memory.rvf',
    );
  });

  it('is referenced by the ADR-0080 Phase 5 header comment', () => {
    assert.ok(
      rvfShimSrc.includes('ADR-0080'),
      'rvf-shim must reference ADR-0080 in its header',
    );
  });
});

// ============================================================================
// 22. Dual-write pattern: storeEntry writes to SQLite then RVF
// ============================================================================

describe('ADR-0080: dual-write pattern in memory-bridge storeEntry', () => {
  // Re-read fresh to get the dual-write block
  const bridgeSrc = readFileSync(resolve(FORK_CLI_SRC, 'memory/memory-bridge.ts'), 'utf-8');

  it('has ADR-0080 dual-write comment', () => {
    assert.ok(
      bridgeSrc.includes('ADR-0080: dual-write'),
      'memory-bridge must have ADR-0080 dual-write comment',
    );
  });

  it('dual-write block calls getRvfStore()', () => {
    const dualIdx = bridgeSrc.indexOf('ADR-0080: dual-write');
    assert.ok(dualIdx > -1, 'dual-write comment must exist');
    const afterDual = bridgeSrc.slice(dualIdx, dualIdx + 500);
    assert.ok(
      afterDual.includes('getRvfStore()'),
      'dual-write block must call getRvfStore()',
    );
  });

  it('dual-write is best-effort (wrapped in try/catch)', () => {
    const dualIdx = bridgeSrc.indexOf('ADR-0080: dual-write');
    // The try statement follows immediately after the comment line;
    // the catch is ~534 chars later so we need a 600-char window
    const afterDual = bridgeSrc.slice(dualIdx, dualIdx + 600);
    assert.ok(
      afterDual.includes('try') && afterDual.includes('catch'),
      'dual-write block must be wrapped in try/catch for best-effort',
    );
  });

  it('dual-write occurs AFTER SQLite commit (after ctx.db.save)', () => {
    const saveIdx = bridgeSrc.indexOf('ctx.db.save');
    const dualIdx = bridgeSrc.indexOf('ADR-0080: dual-write');
    assert.ok(saveIdx > -1, 'ctx.db.save must exist');
    assert.ok(dualIdx > -1, 'dual-write comment must exist');
    assert.ok(
      dualIdx > saveIdx,
      'dual-write must come AFTER ctx.db.save (SQLite is primary)',
    );
  });

  it('dual-write stores embedding as Float32Array', () => {
    const dualIdx = bridgeSrc.indexOf('ADR-0080: dual-write');
    const afterDual = bridgeSrc.slice(dualIdx, dualIdx + 500);
    assert.ok(
      afterDual.includes('Float32Array'),
      'dual-write must convert embedding to Float32Array for RVF',
    );
  });
});

// ============================================================================
// 23. Embedding pipeline warns on fallback (not silent)
// ============================================================================

const embPipelineSrc = readFileSync(
  resolve(FORK_MEMORY_SRC, 'embedding-pipeline.ts'),
  'utf-8',
);

describe('ADR-0080: embedding pipeline warns on fallback', () => {
  it('logs warning when transformers.js fails', () => {
    assert.ok(
      embPipelineSrc.includes("console.warn(`[embedding-pipeline] transformers.js failed"),
      'embedding-pipeline must warn when transformers.js fails',
    );
  });

  it('logs warning when falling back to hash', () => {
    assert.ok(
      embPipelineSrc.includes('hash-fallback (search quality degraded)'),
      'embedding-pipeline must warn about degraded search quality on hash fallback',
    );
  });

  it('tries @xenova/transformers as first provider', () => {
    const tryIdx = embPipelineSrc.indexOf("@xenova/transformers");
    assert.ok(tryIdx > -1, 'embedding-pipeline must reference @xenova/transformers');
    // Verify it comes before ruvector attempt
    const ruvectorIdx = embPipelineSrc.indexOf("import('ruvector')", tryIdx);
    assert.ok(
      ruvectorIdx > tryIdx,
      '@xenova/transformers must be tried before ruvector',
    );
  });

  it('has three-tier fallback chain: transformers.js -> ruvector -> hash-fallback', () => {
    assert.ok(
      embPipelineSrc.includes("this.provider = 'transformers.js'"),
      'must set provider to transformers.js on success',
    );
    assert.ok(
      embPipelineSrc.includes("this.provider = 'ruvector'"),
      'must set provider to ruvector on second-tier success',
    );
    assert.ok(
      embPipelineSrc.includes("'hash-fallback'"),
      'must have hash-fallback as final tier',
    );
  });
});

// ============================================================================
// 24. Config alignment: settings-generator + learning-bridge + config-template
// ============================================================================

const learningBridgeSrc = readFileSync(
  resolve(FORK_MEMORY_SRC, 'learning-bridge.ts'),
  'utf-8',
);

describe('ADR-0080: config alignment across settings-generator, config-template, and learning-bridge', () => {
  // sonaMode alignment
  it('settings-generator sonaMode is balanced', () => {
    assert.ok(
      settingsGenSrc.includes("sonaMode: 'balanced'"),
      "settings-generator must set sonaMode: 'balanced'",
    );
  });

  it('config-template sonaMode is balanced', () => {
    assert.ok(
      configTemplateSrc.includes("sonaMode: 'balanced'"),
      "config-template must set sonaMode: 'balanced'",
    );
  });

  it('learning-bridge DEFAULT_CONFIG sonaMode is balanced', () => {
    const defaultCfgStart = learningBridgeSrc.indexOf('DEFAULT_CONFIG');
    assert.ok(defaultCfgStart > -1, 'learning-bridge must define DEFAULT_CONFIG');
    const defaultBlock = learningBridgeSrc.slice(defaultCfgStart, defaultCfgStart + 300);
    assert.ok(
      defaultBlock.includes("sonaMode: 'balanced'"),
      "learning-bridge DEFAULT_CONFIG must set sonaMode: 'balanced'",
    );
  });

  // confidenceDecayRate alignment
  it('settings-generator confidenceDecayRate is 0.0008', () => {
    assert.ok(
      settingsGenSrc.includes('confidenceDecayRate: 0.0008'),
      'settings-generator must set confidenceDecayRate: 0.0008',
    );
  });

  it('config-template confidenceDecayRate is 0.0008', () => {
    assert.ok(
      configTemplateSrc.includes('confidenceDecayRate: 0.0008'),
      'config-template must set confidenceDecayRate: 0.0008',
    );
  });

  it('learning-bridge DEFAULT_CONFIG confidenceDecayRate is 0.0008', () => {
    const defaultCfgStart = learningBridgeSrc.indexOf('DEFAULT_CONFIG');
    const defaultBlock = learningBridgeSrc.slice(defaultCfgStart, defaultCfgStart + 300);
    assert.ok(
      defaultBlock.includes('confidenceDecayRate: 0.0008'),
      'learning-bridge DEFAULT_CONFIG must set confidenceDecayRate: 0.0008',
    );
  });

  // accessBoostAmount alignment
  it('settings-generator accessBoostAmount is 0.05', () => {
    assert.ok(
      settingsGenSrc.includes('accessBoostAmount: 0.05'),
      'settings-generator must set accessBoostAmount: 0.05',
    );
  });

  it('config-template accessBoostAmount is 0.05', () => {
    assert.ok(
      configTemplateSrc.includes('accessBoostAmount: 0.05'),
      'config-template must set accessBoostAmount: 0.05',
    );
  });

  it('learning-bridge DEFAULT_CONFIG accessBoostAmount is 0.05', () => {
    const defaultCfgStart = learningBridgeSrc.indexOf('DEFAULT_CONFIG');
    const defaultBlock = learningBridgeSrc.slice(defaultCfgStart, defaultCfgStart + 300);
    assert.ok(
      defaultBlock.includes('accessBoostAmount: 0.05'),
      'learning-bridge DEFAULT_CONFIG must set accessBoostAmount: 0.05',
    );
  });
});

// ============================================================================
// 25. enableGraph guard: AgentDB only creates .graph file when enableGraph=true
// ============================================================================

const agentDbSrc = readFileSync(
  resolve('/Users/henrik/source/forks/agentic-flow/packages/agentdb/src', 'core/AgentDB.ts'),
  'utf-8',
);
const ctrlRegistrySrc = readFileSync(
  resolve(FORK_MEMORY_SRC, 'controller-registry.ts'),
  'utf-8',
);

describe('ADR-0080: enableGraph guard prevents unwanted .graph file', () => {
  it('AgentDB config interface defines enableGraph as optional boolean', () => {
    assert.ok(
      agentDbSrc.includes('enableGraph?: boolean'),
      'AgentDB config must define enableGraph?: boolean',
    );
  });

  it('AgentDB gates graph adapter creation on enableGraph', () => {
    assert.ok(
      agentDbSrc.includes('if (this.config.enableGraph)'),
      'AgentDB must guard graph adapter creation with if (this.config.enableGraph)',
    );
  });

  it('AgentDB only imports GraphDatabaseAdapter inside the guard', () => {
    const guardIdx = agentDbSrc.indexOf('if (this.config.enableGraph)');
    assert.ok(guardIdx > -1, 'enableGraph guard must exist');
    const guardBlock = agentDbSrc.slice(guardIdx, guardIdx + 500);
    assert.ok(
      guardBlock.includes('GraphDatabaseAdapter'),
      'GraphDatabaseAdapter import must be inside the enableGraph guard',
    );
  });

  it('controller-registry passes enableGraph from config.controllers.graphAdapter', () => {
    assert.ok(
      ctrlRegistrySrc.includes("enableGraph: config.controllers?.graphAdapter === true"),
      'controller-registry must pass enableGraph: config.controllers?.graphAdapter === true',
    );
  });
});

// ============================================================================
// 26. @xenova/transformers in optionalDependencies of @claude-flow/memory
// ============================================================================

const memoryPkgJson = readFileSync(
  resolve('/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory', 'package.json'),
  'utf-8',
);

describe('ADR-0080: @xenova/transformers in optionalDependencies', () => {
  it('@xenova/transformers is in optionalDependencies', () => {
    const pkg = JSON.parse(memoryPkgJson);
    assert.ok(
      pkg.optionalDependencies && pkg.optionalDependencies['@xenova/transformers'],
      '@xenova/transformers must be in optionalDependencies of @claude-flow/memory',
    );
  });

  it('@xenova/transformers version is ^2.17.0 or higher', () => {
    const pkg = JSON.parse(memoryPkgJson);
    const version = pkg.optionalDependencies['@xenova/transformers'];
    assert.ok(
      version.includes('2.17') || version.includes('2.18') || version.includes('2.19') || version.includes('3.'),
      `@xenova/transformers version must be >=2.17.0, got: ${version}`,
    );
  });

  it('@xenova/transformers is NOT in regular dependencies', () => {
    const pkg = JSON.parse(memoryPkgJson);
    assert.ok(
      !pkg.dependencies || !pkg.dependencies['@xenova/transformers'],
      '@xenova/transformers must NOT be in regular dependencies (it is optional)',
    );
  });
});

// ============================================================================
// 27. --with-embeddings defaults to true in init command
// ============================================================================

describe('ADR-0080: --with-embeddings default is true', () => {
  it('main init subcommand defines with-embeddings flag defaulting true', () => {
    // Look for the flag definition in init.ts
    const flagBlock = initCmdSrc.slice(
      initCmdSrc.indexOf("name: 'with-embeddings'"),
      initCmdSrc.indexOf("name: 'with-embeddings'") + 200,
    );
    assert.ok(
      flagBlock.includes('default: true'),
      '--with-embeddings flag must default to true in main init subcommand',
    );
  });

  it('wizard subcommand also defines with-embeddings flag defaulting true', () => {
    // There are TWO with-embeddings flag definitions — main init and wizard
    const firstIdx = initCmdSrc.indexOf("name: 'with-embeddings'");
    const secondIdx = initCmdSrc.indexOf("name: 'with-embeddings'", firstIdx + 1);
    assert.ok(secondIdx > firstIdx, 'wizard must also define with-embeddings flag');
    const secondFlagBlock = initCmdSrc.slice(secondIdx, secondIdx + 200);
    assert.ok(
      secondFlagBlock.includes('default: true'),
      '--with-embeddings flag must default to true in wizard subcommand',
    );
  });

  it('ADR-0080 comment explains why embeddings default to on', () => {
    const flagBlock = initCmdSrc.slice(
      initCmdSrc.lastIndexOf("name: 'with-embeddings'"),
    );
    const nearbyBlock = flagBlock.slice(0, 300);
    assert.ok(
      nearbyBlock.includes('ADR-0080'),
      'with-embeddings flag must reference ADR-0080 explaining why default is true',
    );
  });
});

// ============================================================================
// 28. No --no-download in main init (only wizard uses it)
// ============================================================================

describe('ADR-0080: no --no-download in main init embeddings path', () => {
  it('main init embeddings exec does NOT use --no-download', () => {
    // Find the main init's embeddings init block (not the wizard's)
    // The main init is in the first subcommand, wizard is later
    const mainInitStart = initCmdSrc.indexOf("Handle --with-embeddings");
    assert.ok(mainInitStart > -1, 'main init must have a --with-embeddings handler');
    const mainBlock = initCmdSrc.slice(mainInitStart, mainInitStart + 500);
    assert.ok(
      !mainBlock.includes('--no-download'),
      'main init embeddings path must NOT use --no-download (downloads the model)',
    );
  });

  it('main init allows 120s timeout for model download', () => {
    const mainInitStart = initCmdSrc.indexOf("Handle --with-embeddings");
    const mainBlock = initCmdSrc.slice(mainInitStart, mainInitStart + 1200);
    assert.ok(
      mainBlock.includes('120000'),
      'main init must allow 120s (120000ms) timeout for model download',
    );
  });

  it('wizard init DOES use --no-download (metadata-only)', () => {
    // The wizard subcommand uses --no-download because it only configures, doesn't download
    const wizardEmbStart = initCmdSrc.indexOf('wizard');
    assert.ok(wizardEmbStart > -1, 'wizard subcommand must exist');
    const wizardSection = initCmdSrc.slice(wizardEmbStart);
    assert.ok(
      wizardSection.includes('--no-download'),
      'wizard init must use --no-download for metadata-only configuration',
    );
  });
});

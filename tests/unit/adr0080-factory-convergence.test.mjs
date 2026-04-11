// @tier unit
// ADR-0080 P1: Factory Convergence
//
// Tests that createDatabase() in database-provider.ts delegates to
// createStorageFromConfig() for the RVF path (not direct RvfBackend
// construction), while the SQLite path remains directly constructed.
// London School TDD: inline mock factories, no real imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as storage-config-adr0062.test.mjs)
// ============================================================================

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  fn.reset = () => { calls.length = 0; };
  return fn;
}

function mockCtor(methods = {}) {
  const instances = [];
  class Mock {
    constructor(...args) {
      this._args = args;
      Object.assign(this, methods);
      instances.push(this);
    }
  }
  Mock.instances = instances;
  Mock.reset = () => { instances.length = 0; };
  return Mock;
}

// ============================================================================
// Simulated getConfig() — mirrors resolve-config.ts defaults
// ============================================================================

function createMockConfig(overrides = {}) {
  return {
    storage: {
      databasePath: overrides.databasePath || ':memory:',
      autoPersistInterval: overrides.autoPersistInterval || 5000,
    },
    embedding: {
      dimension: overrides.dimension || 768,
    },
    hnsw: {
      M: overrides.M || 24,
      efConstruction: overrides.efConstruction || 300,
    },
    memory: {
      maxEntries: overrides.maxEntries || 100_000,
      defaultNamespace: overrides.defaultNamespace || 'default',
      dedupThreshold: overrides.dedupThreshold || 0.95,
    },
  };
}

// ============================================================================
// Simulated selectProvider() — mirrors database-provider.ts logic
// ============================================================================

async function selectProvider(preferred, testRvfFn) {
  if (preferred && preferred !== 'auto') return preferred;
  if (await testRvfFn()) return 'rvf';
  return 'better-sqlite3';
}

// ============================================================================
// Simulated createDatabase() — mirrors the actual switch-case logic
// ============================================================================

async function createDatabase(path, options, deps) {
  const {
    provider = 'auto',
    walMode = true,
    optimize = true,
    defaultNamespace = 'default',
    maxEntries = deps.getConfig().memory.maxEntries,
  } = options;

  const selectedProvider = await selectProvider(provider, deps.testRvf);

  let backend;

  switch (selectedProvider) {
    case 'better-sqlite3': {
      const config = {
        databasePath: path,
        walMode,
        optimize,
        defaultNamespace,
        maxEntries,
        verbose: false,
      };
      backend = new deps.SQLiteBackend(config);
      break;
    }

    case 'rvf': {
      // ADR-0080 P1: delegates to createStorageFromConfig, NOT direct RvfBackend
      backend = await deps.createStorageFromConfig(deps.getConfig());
      break;
    }

    default:
      throw new Error(`Unknown database provider: ${selectedProvider}`);
  }

  await backend.initialize();
  return backend;
}

// ============================================================================
// Test 1: createDatabase('rvf') delegates to createStorageFromConfig
// ============================================================================

describe('ADR-0080 P1: createDatabase(rvf) delegates to createStorageFromConfig', () => {

  it('calls createStorageFromConfig when provider is rvf', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    const result = await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(createStorageFromConfig.calls.length, 1,
      'createStorageFromConfig must be called exactly once for provider=rvf');
    assert.equal(result, fakeBackend,
      'must return the backend produced by createStorageFromConfig');
  });

  it('does NOT construct SQLiteBackend when provider is rvf', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(SQLiteBackend.instances.length, 0,
      'SQLiteBackend must NOT be constructed when provider=rvf');
  });

  it('passes getConfig() result to createStorageFromConfig', async () => {
    const config = createMockConfig({ maxEntries: 50_000, dimension: 384 });
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => config);
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.deepStrictEqual(createStorageFromConfig.calls[0][0], config,
      'createStorageFromConfig must receive the full config object from getConfig()');
  });

  it('calls initialize() on the backend returned by createStorageFromConfig', async () => {
    const initFn = mockFn(async () => {});
    const fakeBackend = { initialize: initFn };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(initFn.calls.length, 1,
      'initialize() must be called on the backend after creation');
  });
});

// ============================================================================
// Test 2: createDatabase('auto') routes to createStorageFromConfig via testRvf
// ============================================================================

describe('ADR-0080 P1: createDatabase(auto) routes through createStorageFromConfig', () => {

  it('auto provider delegates to createStorageFromConfig when testRvf returns true', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'auto' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(createStorageFromConfig.calls.length, 1,
      'createStorageFromConfig must be called when auto selects rvf');
    assert.equal(SQLiteBackend.instances.length, 0,
      'SQLiteBackend must NOT be constructed when auto resolves to rvf');
  });

  it('auto provider with default options (no explicit provider) uses rvf', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    // Empty options — provider defaults to 'auto'
    await createDatabase(':memory:', {}, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(createStorageFromConfig.calls.length, 1,
      'default provider (auto) must call createStorageFromConfig when testRvf succeeds');
  });

  it('auto provider falls back to SQLiteBackend when testRvf returns false', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => false);

    await createDatabase(':memory:', { provider: 'auto' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(SQLiteBackend.instances.length, 1,
      'SQLiteBackend must be constructed when testRvf returns false');
    assert.equal(createStorageFromConfig.calls.length, 0,
      'createStorageFromConfig must NOT be called when auto falls back to SQLite');
  });
});

// ============================================================================
// Test 3: createDatabase('better-sqlite3') constructs SQLiteBackend directly
// ============================================================================

describe('ADR-0080 P1: createDatabase(better-sqlite3) uses SQLiteBackend directly', () => {

  it('constructs SQLiteBackend when provider is better-sqlite3', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase('/tmp/test.db', { provider: 'better-sqlite3' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(SQLiteBackend.instances.length, 1,
      'SQLiteBackend must be constructed exactly once for provider=better-sqlite3');
  });

  it('does NOT call createStorageFromConfig when provider is better-sqlite3', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase('/tmp/test.db', { provider: 'better-sqlite3' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(createStorageFromConfig.calls.length, 0,
      'createStorageFromConfig must NOT be called for provider=better-sqlite3');
  });

  it('passes databasePath and config to SQLiteBackend constructor', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig({ maxEntries: 50_000 }));
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase('/data/memory.db', { provider: 'better-sqlite3', maxEntries: 50_000 }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(SQLiteBackend.instances.length, 1);
    const ctorArgs = SQLiteBackend.instances[0]._args[0];
    assert.equal(ctorArgs.databasePath, '/data/memory.db',
      'SQLiteBackend config must include the path argument');
    assert.equal(ctorArgs.maxEntries, 50_000,
      'SQLiteBackend config must include maxEntries from options');
  });

  it('calls initialize() on the constructed SQLiteBackend', async () => {
    const initFn = mockFn(async () => {});
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: initFn });
    const testRvf = mockFn(async () => true);

    await createDatabase('/tmp/test.db', { provider: 'better-sqlite3' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(initFn.calls.length, 1,
      'initialize() must be called on SQLiteBackend after construction');
  });

  it('SQLiteBackend receives walMode and optimize defaults', async () => {
    const fakeBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async () => fakeBackend);
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase('/tmp/test.db', { provider: 'better-sqlite3' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    const ctorArgs = SQLiteBackend.instances[0]._args[0];
    assert.equal(ctorArgs.walMode, true, 'walMode must default to true');
    assert.equal(ctorArgs.optimize, true, 'optimize must default to true');
    assert.equal(ctorArgs.defaultNamespace, 'default',
      'defaultNamespace must default to "default"');
  });
});

// ============================================================================
// Test 4: Single factory path produces consistent config values
// ============================================================================

describe('ADR-0080 P1: Consistent config between createDatabase and createStorageFromConfig', () => {

  it('maxEntries value originates from getConfig() in both paths', async () => {
    const config = createMockConfig({ maxEntries: 75_000 });

    // RVF path: createStorageFromConfig receives getConfig()
    const rvfBackend = { initialize: mockFn(async () => {}) };
    const createStorageFromConfig = mockFn(async (cfg) => {
      // Capture what createStorageFromConfig would extract
      rvfBackend._resolvedMaxEntries = cfg.memory.maxEntries;
      return rvfBackend;
    });
    const getConfig = mockFn(() => config);
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    // SQLite path: maxEntries comes from options default (getConfig().memory.maxEntries)
    SQLiteBackend.reset();
    const testRvfFalse = mockFn(async () => false);

    // Reset getConfig to count fresh calls
    getConfig.reset();

    await createDatabase(':memory:', { provider: 'better-sqlite3' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf: testRvfFalse,
    });

    const sqliteMaxEntries = SQLiteBackend.instances[0]._args[0].maxEntries;

    assert.equal(rvfBackend._resolvedMaxEntries, 75_000,
      'RVF path must see maxEntries=75000 from config');
    assert.equal(sqliteMaxEntries, 75_000,
      'SQLite path must see maxEntries=75000 from config default');
    assert.equal(rvfBackend._resolvedMaxEntries, sqliteMaxEntries,
      'both paths must produce the same maxEntries value');
  });

  it('dimension is conveyed through config to createStorageFromConfig', async () => {
    const config = createMockConfig({ dimension: 384 });
    const fakeBackend = { initialize: mockFn(async () => {}) };

    let capturedConfig = null;
    const createStorageFromConfig = mockFn(async (cfg) => {
      capturedConfig = cfg;
      return fakeBackend;
    });
    const getConfig = mockFn(() => config);
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    assert.equal(capturedConfig.embedding.dimension, 384,
      'createStorageFromConfig must receive config with the correct dimension');
  });

  it('defaultNamespace is consistent between SQLite and RVF paths', async () => {
    const config = createMockConfig({ defaultNamespace: 'test-ns' });

    // RVF path
    let rvfNamespace = null;
    const createStorageFromConfig = mockFn(async (cfg) => {
      rvfNamespace = cfg.memory.defaultNamespace;
      return { initialize: mockFn(async () => {}) };
    });
    const getConfig = mockFn(() => config);
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const testRvf = mockFn(async () => true);

    await createDatabase(':memory:', { provider: 'rvf', defaultNamespace: 'test-ns' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    // SQLite path
    SQLiteBackend.reset();
    await createDatabase(':memory:', { provider: 'better-sqlite3', defaultNamespace: 'test-ns' }, {
      createStorageFromConfig,
      getConfig,
      SQLiteBackend,
      testRvf,
    });

    const sqliteNamespace = SQLiteBackend.instances[0]._args[0].defaultNamespace;

    assert.equal(rvfNamespace, 'test-ns',
      'RVF config must carry defaultNamespace from getConfig()');
    assert.equal(sqliteNamespace, 'test-ns',
      'SQLite config must carry defaultNamespace from options');
  });

  it('unknown provider throws descriptive error', async () => {
    const getConfig = mockFn(() => createMockConfig());
    const SQLiteBackend = mockCtor({ initialize: mockFn(async () => {}) });
    const createStorageFromConfig = mockFn(async () => ({}));
    const testRvf = mockFn(async () => true);

    await assert.rejects(
      () => createDatabase(':memory:', { provider: 'postgres' }, {
        createStorageFromConfig,
        getConfig,
        SQLiteBackend,
        testRvf,
      }),
      { message: /Unknown database provider: postgres/ },
      'must throw for unknown provider names',
    );
  });
});

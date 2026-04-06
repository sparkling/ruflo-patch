// @tier unit
// Hierarchical memory config chain — defaults, overrides, controller delegation,
// config-file flow, and env-var precedence.
// London School TDD: inline mock factories, no real agentdb imports.

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as agentdb-service-f1.test.mjs)
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
// Default config values (canonical source of truth)
// ============================================================================

const DEFAULTS = {
  workingMemoryLimit:     1048576,      // 1 MiB
  episodicWindow:         604800000,    // 7 days in ms
  autoConsolidate:        true,
  clusterThreshold:       0.75,
  importanceThreshold:    0.6,
  enableSpacedRepetition: true,
};

// ============================================================================
// System-under-test: getHierarchicalMemoryConfig()
//
// Pure function: merges defaults <- config.json <- env vars <- overrides.
// Tested in isolation — no real file reads.
// ============================================================================

function getHierarchicalMemoryConfig(overrides = {}, { configJson = {}, env = {} } = {}) {
  // Layer 1: start with defaults
  const merged = { ...DEFAULTS };

  // Layer 2: config.json values (may be nested under hierarchicalMemory key)
  const fromFile = configJson.hierarchicalMemory ?? configJson;
  for (const key of Object.keys(DEFAULTS)) {
    if (fromFile[key] !== undefined) {
      merged[key] = fromFile[key];
    }
  }

  // Layer 3: env var overrides (only AGENTDB_WORKING_MEMORY_LIMIT for now)
  if (env.AGENTDB_WORKING_MEMORY_LIMIT !== undefined) {
    const parsed = Number(env.AGENTDB_WORKING_MEMORY_LIMIT);
    if (!Number.isNaN(parsed)) {
      merged.workingMemoryLimit = parsed;
    }
  }

  // Layer 4: explicit overrides (highest priority)
  for (const key of Object.keys(DEFAULTS)) {
    if (overrides[key] !== undefined) {
      merged[key] = overrides[key];
    }
  }

  return merged;
}

// ============================================================================
// Group 1: Default values
// ============================================================================

describe('Hierarchical memory config: defaults', () => {

  it('returns all six default keys when called with no arguments', () => {
    const cfg = getHierarchicalMemoryConfig();

    assert.deepStrictEqual(Object.keys(cfg).sort(), Object.keys(DEFAULTS).sort(),
      'config must contain exactly the six documented keys');
  });

  it('workingMemoryLimit defaults to 1048576', () => {
    assert.equal(getHierarchicalMemoryConfig().workingMemoryLimit, 1048576);
  });

  it('episodicWindow defaults to 604800000 (7 days)', () => {
    assert.equal(getHierarchicalMemoryConfig().episodicWindow, 604800000);
  });

  it('autoConsolidate defaults to true', () => {
    assert.equal(getHierarchicalMemoryConfig().autoConsolidate, true);
  });

  it('clusterThreshold defaults to 0.75', () => {
    assert.equal(getHierarchicalMemoryConfig().clusterThreshold, 0.75);
  });

  it('importanceThreshold defaults to 0.6', () => {
    assert.equal(getHierarchicalMemoryConfig().importanceThreshold, 0.6);
  });

  it('enableSpacedRepetition defaults to true', () => {
    assert.equal(getHierarchicalMemoryConfig().enableSpacedRepetition, true);
  });
});

// ============================================================================
// Group 2: Override precedence
// ============================================================================

describe('Hierarchical memory config: override precedence', () => {

  it('overrides parameter takes priority over defaults', () => {
    const cfg = getHierarchicalMemoryConfig({
      workingMemoryLimit: 2097152,
      autoConsolidate: false,
    });

    assert.equal(cfg.workingMemoryLimit, 2097152,
      'explicit override must win over default');
    assert.equal(cfg.autoConsolidate, false,
      'explicit override must win over default');
  });

  it('non-overridden keys retain their defaults', () => {
    const cfg = getHierarchicalMemoryConfig({ clusterThreshold: 0.9 });

    assert.equal(cfg.clusterThreshold, 0.9, 'overridden key');
    assert.equal(cfg.workingMemoryLimit, DEFAULTS.workingMemoryLimit,
      'non-overridden key must keep default');
    assert.equal(cfg.episodicWindow, DEFAULTS.episodicWindow,
      'non-overridden key must keep default');
    assert.equal(cfg.enableSpacedRepetition, DEFAULTS.enableSpacedRepetition,
      'non-overridden key must keep default');
  });

  it('overrides can set boolean values to false', () => {
    const cfg = getHierarchicalMemoryConfig({
      autoConsolidate: false,
      enableSpacedRepetition: false,
    });

    assert.equal(cfg.autoConsolidate, false);
    assert.equal(cfg.enableSpacedRepetition, false);
  });

  it('overrides can set numeric values to zero', () => {
    const cfg = getHierarchicalMemoryConfig({
      importanceThreshold: 0,
      clusterThreshold: 0,
    });

    assert.equal(cfg.importanceThreshold, 0);
    assert.equal(cfg.clusterThreshold, 0);
  });

  it('unknown override keys are ignored', () => {
    const cfg = getHierarchicalMemoryConfig({ unknownKey: 'hello' });

    assert.equal(cfg.unknownKey, undefined,
      'unknown keys must not leak into the returned config');
    assert.deepStrictEqual(Object.keys(cfg).sort(), Object.keys(DEFAULTS).sort());
  });
});

// ============================================================================
// Group 3: Full 12-controller delegation (hierarchicalMemory + memoryConsolidation)
// ============================================================================

describe('Hierarchical memory config: 12-controller delegation', () => {

  // The 10 F1-delegated controllers from agentdb-service-f1.test.mjs
  const F1_DELEGATED = [
    'vectorBackend', 'reflexionMemory', 'skillLibrary', 'reasoningBank',
    'causalGraph', 'causalRecall', 'learningSystem', 'attentionService',
    'nightlyLearner', 'explainableRecall',
  ];

  // The 2 non-delegated controllers that need extra params
  const MEMORY_CONTROLLERS = ['hierarchicalMemory', 'memoryConsolidation'];

  function createMockAgentDB({ controllers = {} } = {}) {
    const getControllerCalls = [];
    return {
      database: {},
      getController(name) {
        getControllerCalls.push(name);
        if (name in controllers) return controllers[name];
        throw new Error(`Unknown controller: ${name}`);
      },
      _getControllerCalls: getControllerCalls,
    };
  }

  function createAgentDBService(agentDB, { config = {} } = {}) {
    const service = {
      db: agentDB,
      controllers: {},
      config: getHierarchicalMemoryConfig({}, { configJson: config }),
    };

    // F1 delegation: 10 controllers via getController()
    for (const name of F1_DELEGATED) {
      try {
        service.controllers[name] = agentDB.getController(name);
      } catch {
        service.controllers[name] = null;
      }
    }

    // Non-delegated: hierarchicalMemory and memoryConsolidation
    // These are constructed directly with vectorBackend, graphBackend, and config
    const vectorBackend = service.controllers.vectorBackend;
    const graphBackend = { _type: 'graph' }; // simplified mock

    for (const name of MEMORY_CONTROLLERS) {
      try {
        // Try getController first (AgentDB may support it in the future)
        service.controllers[name] = agentDB.getController(name);
      } catch {
        // Fall back to direct construction with config
        const Ctor = mockCtor({
          store: mockFn(),
          retrieve: mockFn(),
          consolidate: mockFn(),
        });
        service.controllers[name] = new Ctor(vectorBackend, graphBackend, service.config);
        service.controllers[name]._constructedLocally = true;
        service.controllers[name]._CtorRef = Ctor;
      }
    }

    return service;
  }

  it('service has all 12 controllers (10 delegated + 2 memory)', () => {
    const allNames = [...F1_DELEGATED, ...MEMORY_CONTROLLERS];
    const controllerInstances = {};
    for (const name of allNames) {
      controllerInstances[name] = { _name: name };
    }
    const db = createMockAgentDB({ controllers: controllerInstances });

    const svc = createAgentDBService(db);

    for (const name of allNames) {
      assert.ok(svc.controllers[name] !== null && svc.controllers[name] !== undefined,
        `controller '${name}' must be present in service`);
    }
  });

  it('hierarchicalMemory and memoryConsolidation attempt getController first', () => {
    const hmInstance = { _name: 'hierarchicalMemory', store: mockFn() };
    const mcInstance = { _name: 'memoryConsolidation', consolidate: mockFn() };

    const allControllers = Object.fromEntries(
      F1_DELEGATED.map(n => [n, { _name: n }])
    );
    allControllers.hierarchicalMemory = hmInstance;
    allControllers.memoryConsolidation = mcInstance;

    const db = createMockAgentDB({ controllers: allControllers });
    const svc = createAgentDBService(db);

    assert.strictEqual(svc.controllers.hierarchicalMemory, hmInstance,
      'when AgentDB supports hierarchicalMemory, use its instance');
    assert.strictEqual(svc.controllers.memoryConsolidation, mcInstance,
      'when AgentDB supports memoryConsolidation, use its instance');
  });

  it('falls back to local construction when getController throws', () => {
    // Only provide F1 controllers — memory controllers will throw
    const f1Only = Object.fromEntries(
      F1_DELEGATED.map(n => [n, { _name: n }])
    );
    const db = createMockAgentDB({ controllers: f1Only });
    const svc = createAgentDBService(db);

    assert.ok(svc.controllers.hierarchicalMemory._constructedLocally,
      'hierarchicalMemory must be constructed locally as fallback');
    assert.ok(svc.controllers.memoryConsolidation._constructedLocally,
      'memoryConsolidation must be constructed locally as fallback');
  });

  it('locally-constructed memory controllers receive vectorBackend and config', () => {
    const vb = { _name: 'vectorBackend', search: mockFn() };
    const f1Controllers = Object.fromEntries(
      F1_DELEGATED.map(n => [n, n === 'vectorBackend' ? vb : { _name: n }])
    );
    const db = createMockAgentDB({ controllers: f1Controllers });

    const customConfig = { hierarchicalMemory: { workingMemoryLimit: 524288 } };
    const svc = createAgentDBService(db, { config: customConfig });

    // hierarchicalMemory constructor receives (vectorBackend, graphBackend, config)
    const hm = svc.controllers.hierarchicalMemory;
    assert.equal(hm._args[0], vb,
      'hierarchicalMemory 1st arg must be vectorBackend');
    assert.equal(hm._args[1]._type, 'graph',
      'hierarchicalMemory 2nd arg must be graphBackend');
    assert.equal(hm._args[2].workingMemoryLimit, 524288,
      'hierarchicalMemory 3rd arg must carry config with custom workingMemoryLimit');
  });
});

// ============================================================================
// Group 4: Config values flow to controllers
// ============================================================================

describe('Hierarchical memory config: config.json values flow to controllers', () => {

  it('config.json hierarchicalMemory section overrides defaults', () => {
    const configJson = {
      hierarchicalMemory: {
        workingMemoryLimit: 2097152,
        clusterThreshold: 0.85,
        enableSpacedRepetition: false,
      },
    };

    const cfg = getHierarchicalMemoryConfig({}, { configJson });

    assert.equal(cfg.workingMemoryLimit, 2097152,
      'workingMemoryLimit from config.json');
    assert.equal(cfg.clusterThreshold, 0.85,
      'clusterThreshold from config.json');
    assert.equal(cfg.enableSpacedRepetition, false,
      'enableSpacedRepetition from config.json');
    // Non-overridden keys keep defaults
    assert.equal(cfg.episodicWindow, DEFAULTS.episodicWindow);
    assert.equal(cfg.autoConsolidate, DEFAULTS.autoConsolidate);
    assert.equal(cfg.importanceThreshold, DEFAULTS.importanceThreshold);
  });

  it('config.json partial overrides merge correctly with defaults', () => {
    const configJson = {
      hierarchicalMemory: {
        importanceThreshold: 0.8,
      },
    };

    const cfg = getHierarchicalMemoryConfig({}, { configJson });

    assert.equal(cfg.importanceThreshold, 0.8);
    assert.equal(cfg.workingMemoryLimit, DEFAULTS.workingMemoryLimit);
    assert.equal(cfg.episodicWindow, DEFAULTS.episodicWindow);
    assert.equal(cfg.autoConsolidate, DEFAULTS.autoConsolidate);
    assert.equal(cfg.clusterThreshold, DEFAULTS.clusterThreshold);
    assert.equal(cfg.enableSpacedRepetition, DEFAULTS.enableSpacedRepetition);
  });

  it('explicit overrides beat config.json values', () => {
    const configJson = {
      hierarchicalMemory: {
        workingMemoryLimit: 2097152,
        clusterThreshold: 0.85,
      },
    };

    const cfg = getHierarchicalMemoryConfig(
      { workingMemoryLimit: 4194304 },
      { configJson },
    );

    assert.equal(cfg.workingMemoryLimit, 4194304,
      'explicit override must beat config.json');
    assert.equal(cfg.clusterThreshold, 0.85,
      'config.json value kept when not explicitly overridden');
  });

  it('empty config.json yields pure defaults', () => {
    const cfg = getHierarchicalMemoryConfig({}, { configJson: {} });

    assert.deepStrictEqual(cfg, DEFAULTS);
  });

  it('config.json without hierarchicalMemory key yields pure defaults', () => {
    const configJson = { someOtherSection: { foo: 'bar' } };
    const cfg = getHierarchicalMemoryConfig({}, { configJson });

    assert.deepStrictEqual(cfg, DEFAULTS);
  });
});

// ============================================================================
// Group 5: Environment variable override
// ============================================================================

describe('Hierarchical memory config: env var override', () => {

  it('AGENTDB_WORKING_MEMORY_LIMIT env var overrides default', () => {
    const cfg = getHierarchicalMemoryConfig({}, {
      env: { AGENTDB_WORKING_MEMORY_LIMIT: '524288' },
    });

    assert.equal(cfg.workingMemoryLimit, 524288,
      'env var must override the default workingMemoryLimit');
  });

  it('AGENTDB_WORKING_MEMORY_LIMIT env var overrides config.json', () => {
    const cfg = getHierarchicalMemoryConfig({}, {
      configJson: { hierarchicalMemory: { workingMemoryLimit: 2097152 } },
      env: { AGENTDB_WORKING_MEMORY_LIMIT: '131072' },
    });

    assert.equal(cfg.workingMemoryLimit, 131072,
      'env var must beat config.json');
  });

  it('explicit override beats env var', () => {
    const cfg = getHierarchicalMemoryConfig(
      { workingMemoryLimit: 8388608 },
      { env: { AGENTDB_WORKING_MEMORY_LIMIT: '131072' } },
    );

    assert.equal(cfg.workingMemoryLimit, 8388608,
      'explicit override must beat env var');
  });

  it('invalid (non-numeric) env var is ignored', () => {
    const cfg = getHierarchicalMemoryConfig({}, {
      env: { AGENTDB_WORKING_MEMORY_LIMIT: 'not-a-number' },
    });

    assert.equal(cfg.workingMemoryLimit, DEFAULTS.workingMemoryLimit,
      'invalid env var must not change the default');
  });

  it('env var with value "0" is accepted as valid', () => {
    const cfg = getHierarchicalMemoryConfig({}, {
      env: { AGENTDB_WORKING_MEMORY_LIMIT: '0' },
    });

    assert.equal(cfg.workingMemoryLimit, 0,
      '"0" is a valid numeric value and must be accepted');
  });

  it('full precedence chain: default < config.json < env < override', () => {
    // All four layers supply workingMemoryLimit — override must win
    const cfg = getHierarchicalMemoryConfig(
      { workingMemoryLimit: 999 },
      {
        configJson: { hierarchicalMemory: { workingMemoryLimit: 111 } },
        env: { AGENTDB_WORKING_MEMORY_LIMIT: '222' },
      },
    );

    assert.equal(cfg.workingMemoryLimit, 999,
      'override (layer 4) wins the full chain');
  });

  it('without override, env beats config.json beats default', () => {
    const cfg = getHierarchicalMemoryConfig({}, {
      configJson: { hierarchicalMemory: { workingMemoryLimit: 111 } },
      env: { AGENTDB_WORKING_MEMORY_LIMIT: '222' },
    });

    assert.equal(cfg.workingMemoryLimit, 222,
      'env (layer 3) beats config.json (layer 2)');
  });
});

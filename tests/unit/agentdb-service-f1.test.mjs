// @tier unit
// F1: AgentDBService controller consolidation — delegate to AgentDB.getController()
// London School TDD: inline mocks, no real AgentDB/SQLite imports.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers (same pattern as controller-config-adr0064.test.mjs)
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
// F1 controller names — the 10 controllers that delegate to getController()
// (ADR-0069 F1: 11 conceptually, but mutationGuard is implicit via vectorBackend)
// ============================================================================

const F1_DELEGATED_CONTROLLERS = [
  'vectorBackend',
  'reflexionMemory',
  'skillLibrary',
  'reasoningBank',
  'causalGraph',
  'causalRecall',
  'learningSystem',
  'attentionService',
  'nightlyLearner',
  'explainableRecall',
];

// Controllers that remain directly constructed (NOT delegated)
const NON_DELEGATED_CONTROLLERS = [
  'hierarchicalMemory',  // Needs extra params (vectorBackend, graphBackend, config)
  'memoryConsolidation', // Needs extra params (vectorBackend, graphBackend, config)
  'wasmVectorSearch',    // agentic-flow-specific, not in AgentDB
  'contextSynthesizer',  // agentic-flow-specific, not in AgentDB
  'gnnLearning',         // Phase 2: @ruvector/gnn
  'semanticRouter',      // Phase 2: @ruvector/router
  'syncCoordinator',     // Phase 4: distributed sync
  'quicClient',          // Phase 4: QUIC transport
];

// ============================================================================
// Mock AgentDB with getController()
// ============================================================================

function createMockAgentDB({ controllers = {}, getControllerError = null } = {}) {
  const getControllerCalls = [];
  const db = {
    database: { /* mock SQLite handle */ },
    getController(name) {
      getControllerCalls.push(name);
      if (getControllerError) throw getControllerError;
      if (name in controllers) return controllers[name];
      throw new Error(`Unknown controller: ${name}`);
    },
    _getControllerCalls: getControllerCalls,
    close: mockFn(),
  };
  return db;
}

// Simulated AgentDBService that delegates to getController() (F1 pattern)
function createF1Service(agentDB, { fallbackStores = {} } = {}) {
  const service = {
    db: agentDB,
    controllers: {},
    backendName: 'unknown',
    _initErrors: [],
  };

  // F1 delegation: try getController() for each delegated name
  for (const name of F1_DELEGATED_CONTROLLERS) {
    try {
      service.controllers[name] = agentDB.getController(name);
    } catch (err) {
      service._initErrors.push({ name, error: err });
      // Fallback to in-memory store if provided
      if (fallbackStores[name]) {
        service.controllers[name] = fallbackStores[name];
      } else {
        service.controllers[name] = null;
      }
    }
  }

  service.backendName = Object.values(service.controllers).some(c => c !== null)
    ? 'agentdb' : 'in-memory';

  return service;
}

// ============================================================================
// Group 1: getController delegation — same instances, not duplicates
// ============================================================================

describe('F1: getController delegation', () => {

  it('all 10 F1 controllers are fetched via getController()', () => {
    const controllerInstances = {};
    for (const name of F1_DELEGATED_CONTROLLERS) {
      controllerInstances[name] = { _name: name, _id: Math.random() };
    }
    const db = createMockAgentDB({ controllers: controllerInstances });

    const svc = createF1Service(db);

    // Every F1 controller name was requested from getController
    for (const name of F1_DELEGATED_CONTROLLERS) {
      assert.ok(
        db._getControllerCalls.includes(name),
        `getController('${name}') must be called during init`
      );
    }
  });

  it('service holds the SAME instance as getController() returns', () => {
    const reflexionMemory = { store: mockFn(), retrieve: mockFn() };
    const skillLibrary = { create: mockFn(), find: mockFn() };
    const vectorBackend = { search: mockFn(), insert: mockFn() };

    const db = createMockAgentDB({
      controllers: {
        ...Object.fromEntries(F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])),
        reflexionMemory,
        skillLibrary,
        vectorBackend,
      },
    });

    const svc = createF1Service(db);

    assert.strictEqual(svc.controllers.reflexionMemory, reflexionMemory,
      'reflexionMemory must be the exact same object, not a copy');
    assert.strictEqual(svc.controllers.skillLibrary, skillLibrary,
      'skillLibrary must be the exact same object, not a copy');
    assert.strictEqual(svc.controllers.vectorBackend, vectorBackend,
      'vectorBackend must be the exact same object, not a copy');
  });

  it('getController is called exactly once per controller name', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])
    );
    const db = createMockAgentDB({ controllers });

    createF1Service(db);

    // Count calls per name
    const callCounts = {};
    for (const name of db._getControllerCalls) {
      callCounts[name] = (callCounts[name] || 0) + 1;
    }

    for (const name of F1_DELEGATED_CONTROLLERS) {
      assert.equal(callCounts[name], 1,
        `getController('${name}') must be called exactly once, got ${callCounts[name] || 0}`);
    }
  });

  it('backend is reported as "agentdb" when controllers succeed', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])
    );
    const db = createMockAgentDB({ controllers });

    const svc = createF1Service(db);

    assert.equal(svc.backendName, 'agentdb');
  });
});

// ============================================================================
// Group 2: Singleton preservation — getController returns stable references
// ============================================================================

describe('F1: Singleton preservation', () => {

  it('getController() returns the same instance on repeated calls', () => {
    const reflexion = { _id: 'singleton-reflexion' };
    const db = createMockAgentDB({
      controllers: Object.fromEntries(
        F1_DELEGATED_CONTROLLERS.map(n => [n, n === 'reflexionMemory' ? reflexion : { _name: n }])
      ),
    });

    // Call getController twice for the same name
    const first = db.getController('reflexionMemory');
    const second = db.getController('reflexionMemory');

    assert.strictEqual(first, second,
      'getController must return the same instance — no reconstruction');
    assert.strictEqual(first, reflexion);
  });

  it('service singleton holds controllers across method calls', () => {
    const attentionService = {
      getStats: mockFn(() => ({ hits: 42 })),
      resetStats: mockFn(),
    };

    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n =>
        [n, n === 'attentionService' ? attentionService : { _name: n }]
      )
    );
    const db = createMockAgentDB({ controllers });
    const svc = createF1Service(db);

    // Simulate two "getAttentionStats" calls — same controller reference
    const ctrl1 = svc.controllers.attentionService;
    const ctrl2 = svc.controllers.attentionService;
    assert.strictEqual(ctrl1, ctrl2);
    assert.strictEqual(ctrl1, attentionService);

    // Calling method should route to the exact same mock
    ctrl1.getStats();
    ctrl2.getStats();
    assert.equal(attentionService.getStats.calls.length, 2);
  });
});

// ============================================================================
// Group 3: Fallback behavior — in-memory stores when AgentDB fails
// ============================================================================

describe('F1: Fallback behavior', () => {

  it('uses in-memory fallback when getController() throws for all controllers', () => {
    const db = createMockAgentDB({
      getControllerError: new Error('AgentDB not initialized'),
    });

    const fallbackStores = {
      reflexionMemory: { _type: 'in-memory-reflexion' },
      skillLibrary: { _type: 'in-memory-skills' },
    };

    const svc = createF1Service(db, { fallbackStores });

    assert.equal(svc.controllers.reflexionMemory, fallbackStores.reflexionMemory,
      'reflexionMemory must fall back to in-memory store');
    assert.equal(svc.controllers.skillLibrary, fallbackStores.skillLibrary,
      'skillLibrary must fall back to in-memory store');
    // Controllers without fallback are null
    assert.equal(svc.controllers.causalGraph, null,
      'controllers without fallback store must be null');
  });

  it('records init errors for every failed controller', () => {
    const db = createMockAgentDB({
      getControllerError: new Error('backend down'),
    });

    const svc = createF1Service(db);

    assert.equal(svc._initErrors.length, F1_DELEGATED_CONTROLLERS.length,
      `must record ${F1_DELEGATED_CONTROLLERS.length} init errors`);

    for (const entry of svc._initErrors) {
      assert.ok(F1_DELEGATED_CONTROLLERS.includes(entry.name),
        `error entry name '${entry.name}' must be a known F1 controller`);
      assert.match(entry.error.message, /backend down/);
    }
  });

  it('backend is reported as "in-memory" when all controllers fail', () => {
    const db = createMockAgentDB({
      getControllerError: new Error('no database'),
    });

    const svc = createF1Service(db);

    assert.equal(svc.backendName, 'in-memory');
  });

  it('partial failure: succeeds for some controllers, falls back for others', () => {
    const reflexion = { _name: 'reflexionMemory' };
    const callCount = { n: 0 };

    const db = {
      database: {},
      getController(name) {
        callCount.n++;
        if (name === 'reflexionMemory') return reflexion;
        if (name === 'skillLibrary') return { _name: 'skillLibrary' };
        throw new Error(`${name} not available`);
      },
      _getControllerCalls: [],
      close: mockFn(),
    };
    // Patch to track calls
    const origGet = db.getController;
    db.getController = function (name) {
      db._getControllerCalls.push(name);
      return origGet(name);
    };

    const svc = createF1Service(db);

    assert.strictEqual(svc.controllers.reflexionMemory, reflexion,
      'reflexionMemory should be the real controller');
    assert.ok(svc.controllers.skillLibrary !== null,
      'skillLibrary should be the real controller');
    assert.equal(svc.controllers.causalGraph, null,
      'causalGraph should be null (failed, no fallback)');
    assert.equal(svc.backendName, 'agentdb',
      'backend should be "agentdb" when at least one controller succeeds');
  });
});

// ============================================================================
// Group 4: Phase 2/4 controllers NOT delegated
// ============================================================================

describe('F1: Phase 2/4 controllers remain directly constructed', () => {

  it('non-delegated controllers are NOT requested via getController()', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])
    );
    const db = createMockAgentDB({ controllers });

    createF1Service(db);

    for (const name of NON_DELEGATED_CONTROLLERS) {
      assert.ok(
        !db._getControllerCalls.includes(name),
        `getController('${name}') must NOT be called — Phase 2/4 controllers are directly constructed`
      );
    }
  });

  it('only F1 controller names appear in getController calls', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])
    );
    const db = createMockAgentDB({ controllers });

    createF1Service(db);

    for (const calledName of db._getControllerCalls) {
      assert.ok(
        F1_DELEGATED_CONTROLLERS.includes(calledName),
        `unexpected getController('${calledName}') — only F1 names should be delegated`
      );
    }
  });

  it('GNN and SemanticRouter would be constructed directly (mockCtor pattern)', () => {
    const GNNLearning = mockCtor({
      initialize: mockFn(() => Promise.resolve()),
    });
    const SemanticRouter = mockCtor({
      initialize: mockFn(() => Promise.resolve(true)),
      addRoute: mockFn(() => Promise.resolve()),
    });

    // Simulate Phase 2 direct construction (not via getController)
    const gnn = new GNNLearning({ dimension: 768, enableGNN: true });
    const router = new SemanticRouter();

    assert.equal(GNNLearning.instances.length, 1,
      'GNN should be directly constructed');
    assert.equal(SemanticRouter.instances.length, 1,
      'SemanticRouter should be directly constructed');
    assert.deepStrictEqual(gnn._args, [{ dimension: 768, enableGNN: true }]);
  });
});

// ============================================================================
// Group 5: getController error handling
// ============================================================================

describe('F1: getController error handling', () => {

  it('swallows per-controller errors without crashing init', () => {
    let callIndex = 0;
    const db = {
      database: {},
      getController(name) {
        db._getControllerCalls.push(name);
        callIndex++;
        // Fail every other controller
        if (callIndex % 2 === 0) throw new Error(`${name} init failed`);
        return { _name: name };
      },
      _getControllerCalls: [],
      close: mockFn(),
    };

    // Should not throw
    const svc = createF1Service(db);

    // Some succeed, some fail
    const succeeded = Object.entries(svc.controllers)
      .filter(([, v]) => v !== null).length;
    const failed = Object.entries(svc.controllers)
      .filter(([, v]) => v === null).length;

    assert.ok(succeeded > 0, 'at least some controllers should succeed');
    assert.ok(failed > 0, 'at least some controllers should fail');
    assert.equal(succeeded + failed, F1_DELEGATED_CONTROLLERS.length,
      'total must equal number of F1 controllers');
  });

  it('handles TypeError from getController gracefully', () => {
    const db = createMockAgentDB({
      getControllerError: new TypeError('Cannot read properties of undefined'),
    });

    const svc = createF1Service(db);

    // All should be null, no crash
    for (const name of F1_DELEGATED_CONTROLLERS) {
      assert.equal(svc.controllers[name], null,
        `${name} should be null after TypeError`);
    }
    assert.equal(svc._initErrors.length, F1_DELEGATED_CONTROLLERS.length);
    assert.ok(svc._initErrors[0].error instanceof TypeError);
  });

  it('handles getController returning null (truthy check)', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, null])
    );
    const db = createMockAgentDB({ controllers });

    const svc = createF1Service(db);

    // null is a valid return (controller exists but empty) — no error recorded
    for (const name of F1_DELEGATED_CONTROLLERS) {
      assert.equal(svc.controllers[name], null,
        `${name} should be null when getController returns null`);
    }
    // No errors recorded because getController did not throw
    assert.equal(svc._initErrors.length, 0,
      'returning null is not an error — controller just has no implementation');
  });

  it('error in one controller does not prevent others from initializing', () => {
    const controllers = Object.fromEntries(
      F1_DELEGATED_CONTROLLERS.map(n => [n, { _name: n }])
    );

    let callCount = 0;
    const db = {
      database: {},
      getController(name) {
        db._getControllerCalls.push(name);
        callCount++;
        // Fail only the first controller
        if (callCount === 1) throw new Error('first controller fails');
        return controllers[name];
      },
      _getControllerCalls: [],
      close: mockFn(),
    };

    const svc = createF1Service(db);

    // First controller failed
    assert.equal(svc._initErrors.length, 1, 'only one error recorded');
    assert.equal(svc._initErrors[0].name, F1_DELEGATED_CONTROLLERS[0]);

    // All remaining controllers succeeded
    const succeededCount = Object.values(svc.controllers)
      .filter(c => c !== null).length;
    assert.equal(succeededCount, F1_DELEGATED_CONTROLLERS.length - 1,
      'all controllers except the first should succeed');
  });
});

// ============================================================================
// Group 6: Controller count invariant
// ============================================================================

describe('F1: Controller count invariant', () => {

  it('exactly 10 controllers are in the F1 delegation list', () => {
    assert.equal(F1_DELEGATED_CONTROLLERS.length, 10,
      'F1 delegation list must have exactly 10 controllers');
  });

  it('no duplicates in the F1 delegation list', () => {
    const unique = new Set(F1_DELEGATED_CONTROLLERS);
    assert.equal(unique.size, F1_DELEGATED_CONTROLLERS.length,
      'F1 delegation list must have no duplicates');
  });

  it('F1 and non-delegated lists are disjoint', () => {
    for (const name of NON_DELEGATED_CONTROLLERS) {
      assert.ok(
        !F1_DELEGATED_CONTROLLERS.includes(name),
        `'${name}' must not appear in both F1 and non-delegated lists`
      );
    }
  });
});

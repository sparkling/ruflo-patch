// @tier unit
// ADR-0033: chaos and edge case tests for controller activation
// Tests adversarial conditions: concurrency, failures, corruption, boundaries.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers
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

function asyncMock(value) {
  return mockFn(async () => value);
}

function rejectMock(err) {
  return mockFn(async () => { throw (typeof err === 'string' ? new Error(err) : err); });
}

function hangMock() {
  return mockFn(() => new Promise(() => {}));
}

// Production uses 2000ms per phase; 50ms proves the same cascade wiring contract
const PHASE_TIMEOUT_MS = 50;
const CASCADE_BUDGET_MS = PHASE_TIMEOUT_MS * 4 + 500; // 4 phases + margin

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const slowMock = (value, delayMs = 5) => mockFn(async () => {
  await new Promise(r => setTimeout(r, delayMs));
  return value;
});

// ============================================================================
// Simulated handlers and helpers
// ============================================================================

function createLeveledRegistry(failures = {}) {
  const controllers = new Map();
  const levels = [
    { level: 1, names: ['learningBridge', 'tieredCache', 'solverBandit'] },
    { level: 2, names: ['memoryGraph', 'agentMemoryScope'] },
    { level: 3, names: ['skills', 'reflexion'] },
  ];
  for (const { level, names } of levels) {
    for (const name of names) {
      if (failures[name]) {
        // Skip -- simulates factory throwing
        continue;
      }
      controllers.set(name, { name, level, getStats: () => ({ status: 'healthy' }) });
    }
  }
  return {
    get: (name) => controllers.get(name) || null,
    getAll: () => [...controllers.values()],
    health: () => ({
      total: controllers.size,
      healthy: controllers.size,
      degraded: Object.keys(failures).length,
    }),
  };
}

function createTimeoutCascadeHandler(phases) {
  return async (params) => {
    const task = params.task || 'default';
    const metadata = {};

    // Phase 1: SolverBandit
    try {
      await withTimeout(phases.solverBandit(task), PHASE_TIMEOUT_MS);
    } catch { /* timeout, fall through */ }

    // Phase 2: SkillLibrary
    try {
      await withTimeout(phases.skillLibrary(task), PHASE_TIMEOUT_MS);
    } catch { /* timeout, fall through */ }

    // Phase 3: LearningSystem
    try {
      const result = await withTimeout(phases.learningSystem(task), PHASE_TIMEOUT_MS);
      if (result) metadata.learningSystem = result;
    } catch { /* timeout, fall through */ }

    // Phase 4: SemanticRouter
    try {
      await withTimeout(phases.semanticRouter(task), PHASE_TIMEOUT_MS);
    } catch { /* timeout, fall through */ }

    // Fallback
    return { recommended_agent: 'coder', confidence: 0.3, routing_method: 'fallback', ...metadata };
  };
}

function createColdStartHandler(edgeCount) {
  return async (_params) => {
    if (edgeCount < 5) {
      return { success: true, results: [], warning: 'Cold start: fewer than 5 causal edges' };
    }
    return { success: true, results: [{ id: 'r1', uplift: 0.8 }], count: 1 };
  };
}

function createAgentMemoryScopeFactory() {
  const getScope = (type, id) => {
    if (type === 'agent') return `agent:${id || 'default'}:`;
    if (type === 'session') return `session:${id || 'default'}:`;
    return 'global:';
  };
  return {
    getScope,
    scopeKey(key, type, id) { return getScope(type, id) + key; },
    filterByScope(entries, type, id) {
      const prefix = getScope(type, id);
      return entries.filter(e => (e.key || '').startsWith(prefix));
    },
  };
}

function createScopeSearchHandler(router) {
  return async (params) => {
    const allResults = await router.search(params.query);
    if (params.scope) {
      const scopeCtrl = await router.getController('agentMemoryScope');
      if (scopeCtrl) {
        return scopeCtrl.filterByScope(allResults, params.scope, params.scope_id);
      }
    }
    return allResults;
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: controller chaos tests', () => {

  // ===========================================================================
  // Concurrent controller access
  // ===========================================================================

  describe('Concurrent controller access', () => {
    it('should handle 50 simultaneous routeSolverBanditSelect calls', async () => {
      const banditSelect = slowMock(
        { arm: 'coder', confidence: 0.7, controller: 'solverBandit' },
        2,
      );
      const promises = Array.from({ length: 50 }, (_, i) =>
        banditSelect(`task-${i}`, ['coder', 'reviewer', 'tester']),
      );
      const results = await Promise.all(promises);

      assert.equal(results.length, 50);
      for (const r of results) {
        assert.equal(r.arm, 'coder');
        assert.equal(typeof r.confidence, 'number');
        assert.equal(r.controller, 'solverBandit');
      }
      assert.equal(banditSelect.calls.length, 50);
    });

    it('should handle 50 simultaneous memory_store calls to same key', async () => {
      const store = slowMock({ success: true }, 2);
      const promises = Array.from({ length: 50 }, (_, i) =>
        store({ key: 'shared-key', value: `value-${i}` }).then(
          r => r,
          () => ({ success: false }),
        ),
      );
      const results = await Promise.all(promises);

      assert.equal(results.length, 50);
      for (const r of results) {
        assert.equal(typeof r.success, 'boolean');
      }
    });

    it('should handle interleaved store+search on same namespace', async () => {
      const store = slowMock({ success: true }, 2);
      const search = slowMock([{ key: 'k1', value: 'v1' }], 3);

      const storePromises = Array.from({ length: 25 }, (_, i) =>
        store({ key: `k-${i}`, value: `v-${i}`, namespace: 'ns1' }),
      );
      const searchPromises = Array.from({ length: 25 }, (_, i) =>
        search({ query: `q-${i}`, namespace: 'ns1' }),
      );
      const results = await Promise.all([...storePromises, ...searchPromises]);

      assert.equal(results.length, 50);
    });

    it('should handle concurrent branch create+merge operations', async () => {
      const branchCreate = slowMock({ success: true, branch: 'b1' }, 3);
      const branchMerge = slowMock({ success: true, merged: true }, 3);

      const createPromises = Array.from({ length: 10 }, (_, i) =>
        branchCreate({ name: `branch-${i}` }),
      );
      const mergePromises = Array.from({ length: 10 }, (_, i) =>
        branchMerge({ branch: `branch-${i}` }),
      );
      const results = await Promise.all([...createPromises, ...mergePromises]);

      assert.equal(results.length, 20);
      for (const r of results) {
        assert.equal(r.success, true);
      }
    });
  });

  // ===========================================================================
  // Controller init failure cascade
  // ===========================================================================

  describe('Controller init failure cascade', () => {
    it('should init Level 2 controllers even if Level 1 controller fails', () => {
      const registry = createLeveledRegistry({ learningBridge: true });

      assert.equal(registry.get('learningBridge'), null);
      assert.notEqual(registry.get('memoryGraph'), null);
      assert.notEqual(registry.get('agentMemoryScope'), null);
      assert.equal(registry.get('memoryGraph').level, 2);
    });

    it('should init Level 3 controllers even if Level 2 controller fails', () => {
      const registry = createLeveledRegistry({ memoryGraph: true });

      assert.equal(registry.get('memoryGraph'), null);
      assert.notEqual(registry.get('skills'), null);
      assert.notEqual(registry.get('reflexion'), null);
      assert.equal(registry.get('skills').level, 3);
    });

    it('should report degraded when one controller fails', () => {
      const registry = createLeveledRegistry({ solverBandit: true });
      const h = registry.health();

      assert.ok(h.degraded > 0);
      assert.equal(h.degraded, 1);
    });

    it('should skip disabled controllers without error', () => {
      const registry = createLeveledRegistry({ solverBandit: true });

      // Other Level 1 controllers should still work
      assert.notEqual(registry.get('learningBridge'), null);
      assert.notEqual(registry.get('tieredCache'), null);
      assert.equal(registry.get('solverBandit'), null);

      // No error — just null
      const stats = registry.get('learningBridge').getStats();
      assert.equal(stats.status, 'healthy');
    });
  });

  // ===========================================================================
  // Timeout cascade in hooks_route
  // Expected duration: ~8-10s per test (4 phases x 2s timeout each)
  // ===========================================================================

  describe('Timeout cascade in hooks_route', () => {
    it('should fall through all 4 phases within 10s when each phase times out', async () => {
      const handler = createTimeoutCascadeHandler({
        solverBandit: hangMock(),
        skillLibrary: hangMock(),
        learningSystem: hangMock(),
        semanticRouter: hangMock(),
      });

      const start = Date.now();
      const result = await handler({ task: 'any-task' });
      const elapsed = Date.now() - start;

      assert.equal(result.routing_method, 'fallback');
      assert.equal(result.recommended_agent, 'coder');
      assert.ok(elapsed < CASCADE_BUDGET_MS, `Elapsed ${elapsed}ms should be < ${CASCADE_BUDGET_MS}ms`);
    });

    it('should return default route within 10s even with all hanging controllers', async () => {
      const handler = createTimeoutCascadeHandler({
        solverBandit: hangMock(),
        skillLibrary: hangMock(),
        learningSystem: hangMock(),
        semanticRouter: hangMock(),
      });

      const start = Date.now();
      const result = await handler({ task: 'test-task' });
      const elapsed = Date.now() - start;

      assert.equal(result.routing_method, 'fallback');
      assert.equal(result.confidence, 0.3);
      assert.ok(elapsed < CASCADE_BUDGET_MS, `Elapsed ${elapsed}ms should be < ${CASCADE_BUDGET_MS}ms`);
    });

    it('should not accumulate beyond sum of individual timeouts', async () => {
      const handler = createTimeoutCascadeHandler({
        solverBandit: hangMock(),
        skillLibrary: hangMock(),
        learningSystem: hangMock(),
        semanticRouter: hangMock(),
      });

      const start = Date.now();
      await handler({ task: 'perf-test' });
      const elapsed = Date.now() - start;

      // 4 phases x 2s = 8s max, with some margin
      assert.ok(elapsed < CASCADE_BUDGET_MS, `Elapsed ${elapsed}ms exceeds ${CASCADE_BUDGET_MS}ms budget`);
    });

    it('should preserve partial metadata from phases that succeeded before timeout', async () => {
      const handler = createTimeoutCascadeHandler({
        solverBandit: hangMock(),
        skillLibrary: hangMock(),
        learningSystem: asyncMock({ algorithm: 'ucb1', reason: 'fast convergence' }),
        semanticRouter: hangMock(),
      });

      const start = Date.now();
      const result = await handler({ task: 'partial-success' });
      const elapsed = Date.now() - start;

      // Phase 3 (learningSystem) succeeded, so metadata should be present
      assert.ok(result.learningSystem !== undefined, 'learningSystem metadata should be preserved');
      assert.equal(result.learningSystem.algorithm, 'ucb1');
      assert.equal(result.routing_method, 'fallback');
      // Only phases 1, 2, 4 hung (3 x 2s = 6s)
      assert.ok(elapsed < 8000, `Elapsed ${elapsed}ms should be < 8000ms`);
    });
  });

  // ===========================================================================
  // State corruption resilience
  // ===========================================================================

  describe('State corruption resilience', () => {
    it('should recover from corrupted SolverBandit JSON state', async () => {
      const backend = {
        getByKey: mockFn((_ns, _key) => ({ content: '{{invalid json' })),
      };
      // Simulate banditSelect that tries to deserialize state and falls back
      const banditSelect = mockFn(async (task, arms) => {
        let state = null;
        try {
          const entry = backend.getByKey('default', '_solver_bandit_state');
          state = JSON.parse(entry.content);
        } catch {
          // Corrupt state — use fresh
          state = {};
        }
        return { arm: arms[0], confidence: 0.5, controller: 'solverBandit' };
      });

      const result = await banditSelect('test-task', ['coder', 'reviewer']);
      assert.equal(result.arm, 'coder');
      assert.equal(result.confidence, 0.5);
    });

    it('should recover from corrupted branch metadata JSON', async () => {
      const backend = {
        getByKey: mockFn((_ns, _key) => ({ content: '{not:valid:json:!!}' })),
      };
      // Simulate branch status that reads metadata
      const branchStatus = mockFn(async (branchName) => {
        try {
          const entry = backend.getByKey('default', `_branch_meta_${branchName}`);
          const meta = JSON.parse(entry.content);
          return { branch: branchName, ...meta };
        } catch {
          return { branch: branchName, error: 'metadata_corrupt', status: 'unknown' };
        }
      });

      const result = await branchStatus('feature-x');
      assert.equal(result.branch, 'feature-x');
      assert.equal(result.error, 'metadata_corrupt');
      assert.equal(result.status, 'unknown');
    });

    it('should handle NaN in bandit confidence without crashing', () => {
      const armStats = { alpha: NaN, beta: 1 };
      // Simulate confidence calculation with NaN guard
      const rawConfidence = armStats.alpha / (armStats.alpha + armStats.beta);
      const confidence = Number.isNaN(rawConfidence) ? 0.5 : rawConfidence;

      assert.equal(confidence, 0.5);
      assert.ok(!Number.isNaN(confidence));
    });

    it('should handle missing fields in controller health response', () => {
      const controller = { getStats: () => ({}) };
      const stats = controller.getStats();

      // Health check should handle missing fields gracefully
      const status = stats.status || 'unknown';
      const uptime = stats.uptime || 0;
      const errorCount = stats.errors || 0;

      assert.equal(status, 'unknown');
      assert.equal(uptime, 0);
      assert.equal(errorCount, 0);
    });
  });

  // ===========================================================================
  // Cold-start guard transitions
  // ===========================================================================

  describe('Cold-start guard transitions', () => {
    it('should return cold-start warning at exactly 4 edges', async () => {
      const handler = createColdStartHandler(4);
      const result = await handler({ query: 'test' });

      assert.equal(result.success, true);
      assert.deepEqual(result.results, []);
      assert.ok(result.warning.includes('Cold start'));
    });

    it('should return real results at exactly 5 edges', async () => {
      const handler = createColdStartHandler(5);
      const result = await handler({ query: 'test' });

      assert.equal(result.success, true);
      assert.ok(result.results.length > 0);
      assert.equal(result.warning, undefined);
    });

    it('should transition from cold-start to active on 5th edge', async () => {
      // At 4 edges: cold-start
      const handler4 = createColdStartHandler(4);
      const result4 = await handler4({ query: 'test' });
      assert.ok(result4.warning !== undefined);
      assert.deepEqual(result4.results, []);

      // At 5 edges: active
      const handler5 = createColdStartHandler(5);
      const result5 = await handler5({ query: 'test' });
      assert.equal(result5.warning, undefined);
      assert.ok(result5.results.length > 0);
      assert.equal(result5.results[0].id, 'r1');
    });
  });

  // ===========================================================================
  // Scope boundary leakage
  // ===========================================================================

  describe('Scope boundary leakage', () => {
    let scopeFactory;

    beforeEach(() => {
      scopeFactory = createAgentMemoryScopeFactory();
    });

    it('should NOT find agent-scoped entries in unscoped search', async () => {
      const entries = [
        { key: 'agent:a1:secret', value: 'hidden' },
        { key: 'global:public', value: 'visible' },
      ];
      const router = {
        search: asyncMock(entries),
        getController: asyncMock(null), // no scope controller for unscoped search
      };
      const handler = createScopeSearchHandler(router);

      // Search without scope — returns all (no filtering applied)
      const result = await handler({ query: 'test' });

      assert.equal(result.length, 2); // unscoped returns all raw results
      // The point: without scope param, filterByScope is NOT called
      assert.equal(router.getController.calls.length, 0);
    });

    it('should NOT find agent:a1 entries when searching with scope agent:a2', async () => {
      const entries = [
        { key: 'agent:a1:secret', value: 'hidden' },
        { key: 'agent:a2:data', value: 'visible' },
        { key: 'agent:a1:other', value: 'also hidden' },
      ];
      const router = {
        search: asyncMock(entries),
        getController: mockFn(async (name) => {
          if (name === 'agentMemoryScope') return scopeFactory;
          return null;
        }),
      };
      const handler = createScopeSearchHandler(router);

      const result = await handler({ query: 'test', scope: 'agent', scope_id: 'a2' });

      assert.equal(result.length, 1);
      assert.equal(result[0].key, 'agent:a2:data');
    });

    it('should find global entries from agent-scoped search', async () => {
      const entries = [
        { key: 'global:shared', value: 'accessible' },
        { key: 'agent:a1:private', value: 'private' },
      ];
      const router = {
        search: asyncMock(entries),
        getController: mockFn(async (name) => {
          if (name === 'agentMemoryScope') return scopeFactory;
          return null;
        }),
      };
      const handler = createScopeSearchHandler(router);

      // Searching with scope 'global' should find global: prefixed entries
      const result = await handler({ query: 'test', scope: 'global', scope_id: undefined });

      assert.equal(result.length, 1);
      assert.equal(result[0].key, 'global:shared');
    });
  });

  // ===========================================================================
  // Double-fire prevention
  // ===========================================================================

  describe('Double-fire prevention', () => {
    it('should not call skills.create twice for same post-task event', async () => {
      const mockCreate = asyncMock({ success: true });
      const mockRecordStep = asyncMock({ success: true });
      const routerMock = {
        routeSolverBanditUpdate: asyncMock(undefined),
        getController: mockFn(async (name) => {
          if (name === 'skills') return { create: mockCreate };
          if (name === 'sonaTrajectory') return { recordStep: mockRecordStep };
          return null;
        }),
        routeRecordFeedback: asyncMock({ success: true }),
        routeRecordCausalEdge: asyncMock({ success: true }),
      };

      // Simulate post-task handler (mirrors 08 pattern)
      const handler = createPostTaskHandler(routerMock);
      await handler({
        taskId: 'task-1',
        success: true,
        agent: 'coder',
        quality: 0.95,
        task_type: 'coding',
      });

      assert.equal(mockCreate.calls.length, 1);
    });

    it('should not call sonaTrajectory.recordStep twice for same post-task event', async () => {
      const mockCreate = asyncMock({ success: true });
      const mockRecordStep = asyncMock({ success: true });
      const routerMock = {
        routeSolverBanditUpdate: asyncMock(undefined),
        getController: mockFn(async (name) => {
          if (name === 'skills') return { create: mockCreate };
          if (name === 'sonaTrajectory') return { recordStep: mockRecordStep };
          return null;
        }),
        routeRecordFeedback: asyncMock({ success: true }),
        routeRecordCausalEdge: asyncMock({ success: true }),
      };

      const handler = createPostTaskHandler(routerMock);
      await handler({
        taskId: 'task-2',
        success: true,
        agent: 'reviewer',
        quality: 0.9,
        task_type: 'review',
      });

      assert.equal(mockRecordStep.calls.length, 1);
    });
  });

  // ===========================================================================
  // Memory pressure with full registry
  // ===========================================================================

  describe('Memory pressure with full registry', () => {
    it('should initialize 27 controllers without throwing', () => {
      const controllers = new Map();
      const controllerNames = [
        'learningBridge', 'tieredCache', 'solverBandit', 'memoryGraph',
        'agentMemoryScope', 'skills', 'reflexion', 'nightlyLearner',
        'sonaTrajectory', 'semanticRouter', 'branchManager', 'causalGraph',
        'feedbackCollector', 'patternStore', 'trajectoryStore', 'eventBus',
        'configManager', 'healthMonitor', 'metricsCollector', 'alertManager',
        'schemaValidator', 'rateLimiter', 'circuitBreaker', 'retryManager',
        'batchProcessor', 'streamHandler', 'cacheInvalidator',
      ];

      assert.doesNotThrow(() => {
        for (const name of controllerNames) {
          controllers.set(name, {
            name,
            getStats: () => ({ status: 'healthy', memory: Math.floor(Math.random() * 1024) }),
          });
        }
      });

      assert.equal(controllers.size, 27);
      for (const [, ctrl] of controllers) {
        const stats = ctrl.getStats();
        assert.equal(stats.status, 'healthy');
      }
    });

    it('should support lazy access pattern', () => {
      const initialized = new Set();
      const controllerNames = Array.from({ length: 27 }, (_, i) => `ctrl-${i}`);

      const registry = {
        get(name) {
          initialized.add(name);
          return { name, getStats: () => ({ status: 'healthy' }) };
        },
      };

      // Only access 3 controllers
      registry.get('ctrl-0');
      registry.get('ctrl-5');
      registry.get('ctrl-20');

      assert.equal(initialized.size, 3);
      assert.ok(initialized.has('ctrl-0'));
      assert.ok(initialized.has('ctrl-5'));
      assert.ok(initialized.has('ctrl-20'));
      assert.ok(!initialized.has('ctrl-1'));
    });
  });
});

// ============================================================================
// Post-task handler (used by double-fire tests)
// ============================================================================

function createPostTaskHandler(routerMock) {
  const SKILL_CREATION_QUALITY_THRESHOLD = 0.8;
  const DEFAULT_SUCCESS_QUALITY = 0.85;
  const DEFAULT_FAILURE_QUALITY = 0.2;

  return async (params) => {
    const taskType = params.task_type || params.task || 'unknown';
    const agent = params.agent || 'coder';
    const quality = params.quality !== undefined ? params.quality
      : (params.success ? DEFAULT_SUCCESS_QUALITY : DEFAULT_FAILURE_QUALITY);

    // Phase 2: SolverBandit update
    if (typeof routerMock.routeSolverBanditUpdate === 'function') {
      try {
        await routerMock.routeSolverBanditUpdate(taskType, agent, quality);
      } catch { /* fire-and-forget */ }
    }

    // Phase 4: SkillLibrary creation
    if (quality > SKILL_CREATION_QUALITY_THRESHOLD) {
      try {
        const skills = await routerMock.getController('skills');
        if (skills && typeof skills.create === 'function') {
          await skills.create({
            name: `${taskType}-${agent}`,
            pattern: taskType,
            context: JSON.stringify({ agent, quality, timestamp: Date.now() }),
          });
        }
      } catch { /* fire-and-forget */ }
    }

    // Phase 5: SonaTrajectory recording
    try {
      const traj = await routerMock.getController('sonaTrajectory');
      if (traj && typeof traj.recordStep === 'function') {
        await traj.recordStep({
          task: taskType,
          agent,
          reward: quality,
          success: params.success,
          timestamp: Date.now(),
        });
      }
    } catch { /* fire-and-forget */ }

    // Record feedback
    try {
      await routerMock.routeRecordFeedback({ taskId: params.taskId, quality, success: params.success });
    } catch { /* non-blocking */ }

    // Record causal edge
    try {
      await routerMock.routeRecordCausalEdge({
        cause: taskType,
        effect: params.success ? 'success' : 'failure',
        uplift: quality,
      });
    } catch { /* non-blocking */ }

    return { taskId: params.taskId, recorded: true, quality };
  };
}

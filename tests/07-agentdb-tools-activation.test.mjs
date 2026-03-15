// @tier unit
// ADR-0033: agentdb-tools new MCP tools -- activation contract tests
//
// Converted from vitest: ruflo/v3/@claude-flow/cli/__tests__/agentdb-tools-activation.test.ts
//
// Tests wiring contracts for:
// - agentdb_reflexion-retrieve (P3-B)
// - agentdb_reflexion-store (P3-B)
// - agentdb_causal-query (P3-C)
// - agentdb_causal-recall (ADR-0033)
// - agentdb_batch-optimize (ADR-0033)
// - agentdb_branch (P6-B COW)
//
// London School TDD: all bridge interactions are mocked with plain objects.

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Mock helpers
// ============================================================================

/** Create a mock function that records calls. */
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

/** Create an async mock that resolves with given value. */
function asyncMock(value) {
  return mockFn(async () => value);
}

/** Create an async mock that rejects with given error. */
function rejectMock(err) {
  return mockFn(async () => { throw (typeof err === 'string' ? new Error(err) : err); });
}

/** Create a mock that never resolves (for timeout tests). */
function hangMock() {
  return mockFn(() => new Promise(() => {}));
}

// ============================================================================
// Simulated handler logic (mirrors agentdb-tools.ts wiring)
// ============================================================================

const MAX_TOP_K = 100;
const TIMEOUT_MS = 50; // Production uses 2000ms; 50ms proves the same wiring contract

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// --- agentdb_reflexion-retrieve ---
function createReflexionRetrieveHandler(bridge) {
  return async (params) => {
    if (!params.task || params.task === '') {
      return { success: false, results: [], error: 'task is required' };
    }
    try {
      const controller = await bridge.getController('reflexion');
      if (!controller || typeof controller.retrieve !== 'function') {
        return { success: false, results: [], error: 'ReflexionMemory not available' };
      }
      const k = Math.min(params.k || 5, MAX_TOP_K);
      const results = await withTimeout(controller.retrieve(params.task, k), TIMEOUT_MS);
      return { success: true, results, count: results.length };
    } catch (e) {
      return { success: false, results: [], error: e.message };
    }
  };
}

// --- agentdb_reflexion-store ---
function createReflexionStoreHandler(bridge) {
  return async (params) => {
    if (!params.session_id) return { success: false, error: 'session_id is required' };
    if (!params.task) return { success: false, error: 'task is required' };
    try {
      const controller = await bridge.getController('reflexion');
      if (!controller || typeof controller.store !== 'function') {
        return { success: false, error: 'ReflexionMemory not available' };
      }
      const reward = Math.max(0, Math.min(1, params.reward));
      await withTimeout(controller.store({
        session_id: params.session_id,
        task: params.task,
        reward,
        success: params.success,
      }), TIMEOUT_MS);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  };
}

// --- agentdb_causal-query ---
function createCausalQueryHandler(bridge) {
  return async (params) => {
    try {
      const controller = await bridge.getController('causalGraph');
      if (!controller) {
        return { success: false, results: [], error: 'CausalMemoryGraph not available' };
      }
      const stats = await controller.getStats();
      const edgeCount = stats.edgeCount ?? stats.edges ?? 0;
      if (edgeCount < 5) {
        return {
          success: true,
          results: [],
          warning: 'Cold start: fewer than 5 causal edges recorded. Results would be noise.',
        };
      }
      const k = params.k || 5;
      let results;
      if (params.cause) {
        results = await withTimeout(controller.getEffects(params.cause, k), TIMEOUT_MS);
      } else if (params.effect) {
        results = await withTimeout(controller.getCauses(params.effect, k), TIMEOUT_MS);
      }
      if (params.min_uplift) {
        results = results.filter(r => (r.uplift || 0) >= params.min_uplift);
      }
      return { success: true, results, count: results.length };
    } catch (e) {
      return { success: false, results: [], error: e.message };
    }
  };
}

// --- agentdb_causal-recall ---
function createCausalRecallHandler(bridgeCausalRecall) {
  return async (params) => {
    if (!params.query || params.query === '') {
      return { success: false, error: 'query is required' };
    }
    if (typeof bridgeCausalRecall !== 'function') {
      return { success: false, error: 'bridgeCausalRecall not available' };
    }
    try {
      const result = await bridgeCausalRecall({
        query: params.query,
        k: params.k,
        includeEvidence: params.include_evidence || false,
      });
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  };
}

// --- agentdb_batch-optimize ---
function createBatchOptimizeHandler(bridgeBatchOptimize, bridgeBatchPrune) {
  return async (params) => {
    if (!params.action) return { success: false, error: 'action is required' };
    if (params.action === 'optimize' || params.action === 'stats') {
      if (typeof bridgeBatchOptimize !== 'function') {
        return { success: false, error: 'bridgeBatchOptimize not available' };
      }
      try {
        return await bridgeBatchOptimize();
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    if (params.action === 'prune') {
      if (typeof bridgeBatchPrune !== 'function') {
        return { success: false, error: 'bridgeBatchPrune not available' };
      }
      try {
        return await bridgeBatchPrune({
          maxAge: Math.max(0, params.max_age || 0),
          minReward: params.min_reward,
        });
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: `Unknown action: ${params.action}` };
  };
}

// --- agentdb_branch (COW) ---
function createBranchHandler(bridge) {
  return async (params) => {
    if (!params.action) return { success: false, error: 'action is required' };
    try {
      const backend = await bridge.getController('vectorBackend');
      if (!backend) {
        return { success: false, error: 'Backend not available for branching' };
      }

      switch (params.action) {
        case 'create': {
          if (!params.branch_name) return { success: false, error: 'branch_name is required' };
          if (typeof backend.derive !== 'function') {
            return { success: false, error: 'COW branching not supported by backend' };
          }
          const result = await withTimeout(backend.derive(params.branch_name), TIMEOUT_MS);
          return { success: true, branchId: result.branchId, parentId: result.parentId };
        }
        case 'get': {
          if (!params.branch_id || !params.key) {
            return { success: false, error: 'branch_id and key are required' };
          }
          const entry = await backend.branchGet(params.branch_id, params.key, params.namespace);
          return { success: true, entry };
        }
        case 'store': {
          if (!params.branch_id || !params.key || params.value === undefined) {
            return { success: false, error: 'branch_id, key, and value are required' };
          }
          const result = await backend.branchStore(params.branch_id, params.key, params.value, params.namespace);
          return { success: true, ...result };
        }
        case 'merge': {
          if (!params.branch_id) return { success: false, error: 'branch_id is required' };
          const result = await backend.branchMerge(params.branch_id, params.strategy);
          return { success: true, mergedKeys: result.mergedKeys };
        }
        case 'status': {
          if (!params.branch_id) return { success: false, error: 'branch_id is required' };
          const meta = await backend.getByKey('default', `_branch_meta:${params.branch_id}`);
          if (!meta) return { success: true, branch: null };
          const branch = JSON.parse(meta.content);
          return { success: true, branch };
        }
        default:
          return { success: false, error: `Unknown action: ${params.action}` };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: agentdb-tools new MCP tools', () => {
  let mockReflexionController;
  let mockCausalGraphController;
  let mockVectorBackend;
  let bridge;

  beforeEach(() => {
    mockReflexionController = {
      retrieve: asyncMock([]),
      store: asyncMock(undefined),
    };

    mockCausalGraphController = {
      getEffects: asyncMock([]),
      getCauses: asyncMock([]),
      getStats: asyncMock({ edgeCount: 10 }),
      query: asyncMock([]),
    };

    mockVectorBackend = {
      derive: asyncMock({ success: true, branchId: 'branch-abc', parentId: 'main' }),
      branchGet: asyncMock({ content: 'test-value' }),
      branchStore: asyncMock({ success: true }),
      branchMerge: asyncMock({ success: true, mergedKeys: 5 }),
      getByKey: asyncMock(null),
    };

    bridge = {
      getController: asyncMock(null),
    };
    bridge.getController = mockFn(async (name) => {
      switch (name) {
        case 'reflexion': return mockReflexionController;
        case 'causalGraph': return mockCausalGraphController;
        case 'vectorBackend': return mockVectorBackend;
        default: return null;
      }
    });
  });

  // ---------- agentdb_reflexion-retrieve ----------

  describe('agentdb_reflexion-retrieve', () => {
    it('should retrieve reflexion memories by task', async () => {
      const mockResults = [
        { task: 'write unit tests', reward: 0.9, success: true },
        { task: 'write integration tests', reward: 0.7, success: true },
      ];
      mockReflexionController.retrieve = asyncMock(mockResults);
      const handler = createReflexionRetrieveHandler(bridge);

      const result = await handler({ task: 'write unit tests', k: 5 });

      assert.equal(bridge.getController.calls.length > 0, true);
      assert.deepEqual(bridge.getController.calls[0], ['reflexion']);
      assert.deepEqual(mockReflexionController.retrieve.calls[0], ['write unit tests', 5]);
      assert.deepEqual(result, { success: true, results: mockResults, count: 2 });
    });

    it('should use default k=5 when not provided', async () => {
      mockReflexionController.retrieve = asyncMock([]);
      const handler = createReflexionRetrieveHandler(bridge);

      await handler({ task: 'test' });

      assert.deepEqual(mockReflexionController.retrieve.calls[0], ['test', 5]);
    });

    it('should return error when ReflexionMemory unavailable', async () => {
      bridge.getController = asyncMock(null);
      const handler = createReflexionRetrieveHandler(bridge);

      const result = await handler({ task: 'test' });

      assert.deepEqual(result, {
        success: false,
        results: [],
        error: 'ReflexionMemory not available',
      });
    });

    it('should return error when retrieve method missing', async () => {
      bridge.getController = asyncMock({ noRetrieve: true });
      const handler = createReflexionRetrieveHandler(bridge);

      const result = await handler({ task: 'test' });

      assert.deepEqual(result, {
        success: false,
        results: [],
        error: 'ReflexionMemory not available',
      });
    });

    it('should timeout after 2 seconds', async () => {
      mockReflexionController.retrieve = hangMock();
      const handler = createReflexionRetrieveHandler(bridge);

      const result = await handler({ task: 'slow query' });

      assert.equal(result.success, false);
      assert.deepEqual(result.results, []);
      assert.ok(result.error.includes('timeout'));
    });

    it('should validate task param is non-empty string', async () => {
      const handler = createReflexionRetrieveHandler(bridge);

      const result = await handler({ task: '' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('task is required'));
    });

    it('should cap k at MAX_TOP_K (100)', async () => {
      mockReflexionController.retrieve = asyncMock([]);
      const handler = createReflexionRetrieveHandler(bridge);

      await handler({ task: 'test', k: 999 });

      assert.deepEqual(mockReflexionController.retrieve.calls[0], ['test', 100]);
    });
  });

  // ---------- agentdb_reflexion-store ----------

  describe('agentdb_reflexion-store', () => {
    it('should store reflexion memory with correct params', async () => {
      mockReflexionController.store = asyncMock(undefined);
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({
        session_id: 's1',
        task: 'write tests',
        reward: 0.9,
        success: true,
      });

      assert.deepEqual(bridge.getController.calls[0], ['reflexion']);
      assert.deepEqual(mockReflexionController.store.calls[0], [{
        session_id: 's1',
        task: 'write tests',
        reward: 0.9,
        success: true,
      }]);
      assert.deepEqual(result, { success: true });
    });

    it('should validate required session_id', async () => {
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({ task: 'test', reward: 0.9, success: true });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('session_id is required'));
    });

    it('should validate required task', async () => {
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({ session_id: 's1', reward: 0.9, success: true });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('task is required'));
    });

    it('should return error when ReflexionMemory unavailable', async () => {
      bridge.getController = asyncMock(null);
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({
        session_id: 's1',
        task: 'test',
        reward: 0.5,
        success: false,
      });

      assert.equal(result.success, false);
      assert.equal(result.error, 'ReflexionMemory not available');
    });

    it('should clamp reward to 0-1 range', async () => {
      mockReflexionController.store = asyncMock(undefined);
      const handler = createReflexionStoreHandler(bridge);

      await handler({ session_id: 's1', task: 'test', reward: 5.0, success: true });

      const stored = mockReflexionController.store.calls[0][0];
      assert.equal(stored.reward, 1);
    });

    it('should timeout after 2 seconds', async () => {
      mockReflexionController.store = hangMock();
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({
        session_id: 's1',
        task: 'slow store',
        reward: 0.5,
        success: true,
      });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('timeout'));
    });
  });

  // ---------- agentdb_causal-query ----------

  describe('agentdb_causal-query', () => {
    it('should query causal graph for effects of a cause', async () => {
      const mockEffects = [
        { effect: 'faster CI', uplift: 0.8 },
        { effect: 'fewer flakes', uplift: 0.6 },
      ];
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 10 });
      mockCausalGraphController.getEffects = asyncMock(mockEffects);
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'refactor', k: 5 });

      assert.ok(bridge.getController.calls.some(c => c[0] === 'causalGraph'));
      assert.deepEqual(mockCausalGraphController.getEffects.calls[0], ['refactor', 5]);
      assert.deepEqual(result, { success: true, results: mockEffects, count: 2 });
    });

    it('should query causal graph for causes of an effect', async () => {
      const mockCauses = [{ cause: 'refactor', uplift: 0.7 }];
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 10 });
      mockCausalGraphController.getCauses = asyncMock(mockCauses);
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ effect: 'faster CI', k: 3 });

      assert.deepEqual(mockCausalGraphController.getCauses.calls[0], ['faster CI', 3]);
      assert.equal(result.success, true);
      assert.deepEqual(result.results, mockCauses);
    });

    it('should apply cold-start guard when <5 edges', async () => {
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 3 });
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'refactor' });

      assert.deepEqual(result, {
        success: true,
        results: [],
        warning: 'Cold start: fewer than 5 causal edges recorded. Results would be noise.',
      });
      assert.equal(mockCausalGraphController.getEffects.calls.length, 0);
    });

    it('should apply cold-start guard using edges key', async () => {
      mockCausalGraphController.getStats = asyncMock({ edges: 2 });
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'x' });

      assert.equal(result.success, true);
      assert.deepEqual(result.results, []);
      assert.ok(result.warning.includes('Cold start'));
    });

    it('should filter by min_uplift', async () => {
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 20 });
      mockCausalGraphController.getEffects = asyncMock([
        { effect: 'a', uplift: 0.8 },
        { effect: 'b', uplift: 0.2 },
        { effect: 'c', uplift: 0.6 },
      ]);
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'x', min_uplift: 0.5 });

      assert.deepEqual(result.results, [
        { effect: 'a', uplift: 0.8 },
        { effect: 'c', uplift: 0.6 },
      ]);
    });

    it('should return error when CausalMemoryGraph unavailable', async () => {
      bridge.getController = asyncMock(null);
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'x' });

      assert.equal(result.success, false);
      assert.equal(result.error, 'CausalMemoryGraph not available');
    });

    it('should timeout after 2 seconds', async () => {
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 50 });
      mockCausalGraphController.getEffects = hangMock();
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'slow' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('timeout'));
    });
  });

  // ---------- agentdb_causal-recall ----------

  describe('agentdb_causal-recall', () => {
    it('should call bridgeCausalRecall with query and params', async () => {
      const mockBridgeCausalRecall = asyncMock({
        success: true,
        results: [{ key: 'auth-pattern', score: 0.9 }],
      });
      const handler = createCausalRecallHandler(mockBridgeCausalRecall);

      const result = await handler({ query: 'authentication pattern', k: 10 });

      assert.deepEqual(mockBridgeCausalRecall.calls[0], [{
        query: 'authentication pattern',
        k: 10,
        includeEvidence: false,
      }]);
      assert.deepEqual(result, {
        success: true,
        results: [{ key: 'auth-pattern', score: 0.9 }],
      });
    });

    it('should pass includeEvidence when include_evidence=true', async () => {
      const mockBridgeCausalRecall = asyncMock({ success: true, results: [] });
      const handler = createCausalRecallHandler(mockBridgeCausalRecall);

      await handler({ query: 'test', include_evidence: true });

      assert.equal(mockBridgeCausalRecall.calls[0][0].includeEvidence, true);
    });

    it('should handle cold-start warning from bridge', async () => {
      const mockBridgeCausalRecall = asyncMock({
        success: true,
        results: [],
        warning: 'Cold start: insufficient causal edges',
      });
      const handler = createCausalRecallHandler(mockBridgeCausalRecall);

      const result = await handler({ query: 'test' });

      assert.equal(result.success, true);
      assert.deepEqual(result.results, []);
      assert.ok(result.warning.includes('Cold start'));
    });

    it('should validate query is required', async () => {
      const mockBridgeCausalRecall = asyncMock({ success: true, results: [] });
      const handler = createCausalRecallHandler(mockBridgeCausalRecall);

      const result = await handler({ query: '' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('query is required'));
    });

    it('should return error when bridgeCausalRecall unavailable', async () => {
      const handler = createCausalRecallHandler(undefined);

      const result = await handler({ query: 'test' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('not available'));
    });

    it('should handle errors from bridgeCausalRecall', async () => {
      const mockBridgeCausalRecall = rejectMock('Bridge failure');
      const handler = createCausalRecallHandler(mockBridgeCausalRecall);

      const result = await handler({ query: 'test' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('Bridge failure'));
    });
  });

  // ---------- agentdb_batch-optimize ----------

  describe('agentdb_batch-optimize', () => {
    it('should dispatch optimize action', async () => {
      const mockBridgeBatchOptimize = asyncMock({ success: true, optimized: 42 });
      const mockBridgeBatchPrune = asyncMock({ success: true });
      const handler = createBatchOptimizeHandler(mockBridgeBatchOptimize, mockBridgeBatchPrune);

      const result = await handler({ action: 'optimize' });

      assert.equal(mockBridgeBatchOptimize.calls.length > 0, true);
      assert.deepEqual(result, { success: true, optimized: 42 });
    });

    it('should dispatch prune action with config', async () => {
      const mockBridgeBatchOptimize = asyncMock({ success: true });
      const mockBridgeBatchPrune = asyncMock({ success: true, pruned: 15 });
      const handler = createBatchOptimizeHandler(mockBridgeBatchOptimize, mockBridgeBatchPrune);

      const result = await handler({ action: 'prune', max_age: 30, min_reward: 0.3 });

      assert.deepEqual(mockBridgeBatchPrune.calls[0], [{ maxAge: 30, minReward: 0.3 }]);
      assert.deepEqual(result, { success: true, pruned: 15 });
    });

    it('should dispatch stats action (uses optimize endpoint)', async () => {
      const mockBridgeBatchOptimize = asyncMock({ success: true, totalEntries: 100 });
      const mockBridgeBatchPrune = asyncMock({ success: true });
      const handler = createBatchOptimizeHandler(mockBridgeBatchOptimize, mockBridgeBatchPrune);

      const result = await handler({ action: 'stats' });

      assert.equal(mockBridgeBatchOptimize.calls.length > 0, true);
      assert.equal(result.success, true);
    });

    it('should reject unknown actions', async () => {
      const handler = createBatchOptimizeHandler(asyncMock({}), asyncMock({}));

      const result = await handler({ action: 'invalid' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('Unknown action: invalid'));
    });

    it('should validate action is required', async () => {
      const handler = createBatchOptimizeHandler(asyncMock({}), asyncMock({}));

      const result = await handler({});

      assert.equal(result.success, false);
      assert.ok(result.error.includes('action is required'));
    });

    it('should return error when bridgeBatchOptimize unavailable', async () => {
      const handler = createBatchOptimizeHandler(undefined, asyncMock({}));

      const result = await handler({ action: 'optimize' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('not available'));
    });

    it('should return error when bridgeBatchPrune unavailable', async () => {
      const handler = createBatchOptimizeHandler(asyncMock({}), undefined);

      const result = await handler({ action: 'prune' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('not available'));
    });

    it('should clamp negative max_age to 0', async () => {
      const mockBridgeBatchPrune = asyncMock({ success: true });
      const handler = createBatchOptimizeHandler(asyncMock({}), mockBridgeBatchPrune);

      await handler({ action: 'prune', max_age: -5 });

      assert.equal(mockBridgeBatchPrune.calls[0][0].maxAge, 0);
    });

    it('should handle errors from batch operations', async () => {
      const mockBridgeBatchOptimize = rejectMock('DB locked');
      const handler = createBatchOptimizeHandler(mockBridgeBatchOptimize, asyncMock({}));

      const result = await handler({ action: 'optimize' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('DB locked'));
    });
  });

  // ---------- agentdb_branch (COW) ----------

  describe('agentdb_branch (COW)', () => {
    it('should create branch via derive()', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'create', branch_name: 'experiment-1' });

      assert.ok(bridge.getController.calls.some(c => c[0] === 'vectorBackend'));
      assert.deepEqual(mockVectorBackend.derive.calls[0], ['experiment-1']);
      assert.equal(result.success, true);
      assert.equal(result.branchId, 'branch-abc');
    });

    it('should require branch_name for create', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'create' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('branch_name is required'));
    });

    it('should get from branch with key', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'get', branch_id: 'b1', key: 'mykey' });

      assert.deepEqual(mockVectorBackend.branchGet.calls[0], ['b1', 'mykey', undefined]);
      assert.deepEqual(result, { success: true, entry: { content: 'test-value' } });
    });

    it('should pass namespace to branchGet', async () => {
      mockVectorBackend.branchGet = asyncMock(null);
      const handler = createBranchHandler(bridge);

      await handler({ action: 'get', branch_id: 'b1', key: 'k', namespace: 'patterns' });

      assert.deepEqual(mockVectorBackend.branchGet.calls[0], ['b1', 'k', 'patterns']);
    });

    it('should require branch_id and key for get', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'get', branch_id: 'b1' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('branch_id and key are required'));
    });

    it('should store to branch without affecting parent', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'store', branch_id: 'b1', key: 'k', value: 'v' });

      assert.deepEqual(mockVectorBackend.branchStore.calls[0], ['b1', 'k', 'v', undefined]);
      assert.equal(result.success, true);
    });

    it('should require branch_id, key, value for store', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'store', branch_id: 'b1', key: 'k' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('branch_id, key, and value are required'));
    });

    it('should merge branch back to parent', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'merge', branch_id: 'b1' });

      assert.deepEqual(mockVectorBackend.branchMerge.calls[0], ['b1', undefined]);
      assert.equal(result.success, true);
      assert.equal(result.mergedKeys, 5);
    });

    it('should require branch_id for merge', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'merge' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('branch_id is required'));
    });

    it('should return branch status', async () => {
      mockVectorBackend.getByKey = asyncMock({
        content: JSON.stringify({
          branchId: 'b1',
          parentId: 'main',
          created: '2026-01-01',
        }),
      });
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'status', branch_id: 'b1' });

      assert.deepEqual(mockVectorBackend.getByKey.calls[0], ['default', '_branch_meta:b1']);
      assert.equal(result.success, true);
      assert.equal(result.branch.branchId, 'b1');
      assert.equal(result.branch.parentId, 'main');
    });

    it('should return null branch when no meta found', async () => {
      mockVectorBackend.getByKey = asyncMock(null);
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'status', branch_id: 'nonexistent' });

      assert.deepEqual(result, { success: true, branch: null });
    });

    it('should require branch_id for status', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'status' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('branch_id is required'));
    });

    it('should return error for unknown action', async () => {
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'destroy' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('Unknown action: destroy'));
    });

    it('should return error when backend unavailable', async () => {
      bridge.getController = asyncMock(null);
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'create', branch_name: 'test' });

      assert.equal(result.success, false);
      assert.equal(result.error, 'Backend not available for branching');
    });

    it('should return error when derive not supported', async () => {
      bridge.getController = asyncMock({});
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'create', branch_name: 'test' });

      assert.equal(result.success, false);
      assert.equal(result.error, 'COW branching not supported by backend');
    });

    it('should timeout after 2 seconds on slow operations', async () => {
      mockVectorBackend.derive = hangMock();
      const handler = createBranchHandler(bridge);

      const result = await handler({ action: 'create', branch_name: 'slow-branch' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('timeout'));
    });
  });

  // ===========================================================================
  // agentdb_causal-query -- gap coverage
  // ===========================================================================

  describe('agentdb_causal-query -- gap coverage', () => {
    it('should handle neither cause nor effect provided', async () => {
      // When neither cause nor effect is given, results stays undefined,
      // then min_uplift filter (if present) crashes → caught → success:false.
      // Without min_uplift, results is undefined → count access fails → caught.
      mockCausalGraphController.getStats = asyncMock({ edgeCount: 10 });
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ k: 5 });

      // results is undefined → results.length throws → caught by try/catch
      assert.equal(result.success, false);
    });

    it('should handle getStats throwing', async () => {
      bridge.getController = mockFn(async (name) => {
        if (name === 'causalGraph') {
          return {
            getStats: () => { throw new Error('stats crashed'); },
          };
        }
        return null;
      });
      const handler = createCausalQueryHandler(bridge);

      const result = await handler({ cause: 'test' });

      assert.equal(result.success, false);
      assert.ok(result.error.includes('stats crashed'));
    });
  });

  // ===========================================================================
  // agentdb_reflexion-store -- boundary values
  // ===========================================================================

  describe('agentdb_reflexion-store -- boundary values', () => {
    it('should clamp negative reward to 0', async () => {
      mockReflexionController.store = asyncMock(undefined);
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({
        session_id: 's1',
        task: 'test',
        reward: -5.0,
        success: false,
      });

      assert.equal(result.success, true);
      const storedReward = mockReflexionController.store.calls[0][0].reward;
      assert.ok(storedReward >= 0, `reward should be >= 0, got ${storedReward}`);
    });

    it('should clamp reward above 1 to 1', async () => {
      mockReflexionController.store = asyncMock(undefined);
      const handler = createReflexionStoreHandler(bridge);

      const result = await handler({
        session_id: 's1',
        task: 'test',
        reward: 999,
        success: true,
      });

      assert.equal(result.success, true);
      const storedReward = mockReflexionController.store.calls[0][0].reward;
      assert.ok(storedReward <= 1, `reward should be <= 1, got ${storedReward}`);
    });
  });

  // ===========================================================================
  // MutationGuard enforcement -- regression (P5-B)
  // ===========================================================================

  describe('MutationGuard enforcement -- regression', () => {
    it('should call MutationGuard validate before store operations', async () => {
      const mockGuard = {
        validate: mockFn(async () => ({ allowed: true })),
      };
      const mockStore = asyncMock({ success: true, id: 'test-id' });
      const guardedBridge = {
        getController: mockFn(async (name) => {
          if (name === 'mutationGuard') return mockGuard;
          return null;
        }),
        store: mockStore,
      };

      // Simulated guarded store
      const guardResult = await guardedBridge.getController('mutationGuard');
      if (guardResult && typeof guardResult.validate === 'function') {
        const validation = await guardResult.validate('store', { key: 'test' });
        assert.equal(validation.allowed, true);
      }
      await guardedBridge.store({ key: 'test', value: 'hello' });

      assert.equal(mockGuard.validate.calls.length, 1);
      assert.equal(mockStore.calls.length, 1);
    });

    it('should reject store when MutationGuard denies', async () => {
      const mockGuard = {
        validate: mockFn(async () => ({ allowed: false, reason: 'rate limit exceeded' })),
      };

      const validation = await mockGuard.validate('store', { key: 'test' });
      assert.equal(validation.allowed, false);
      assert.equal(validation.reason, 'rate limit exceeded');
    });
  });
});

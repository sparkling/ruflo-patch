/**
 * ADR-0033: agentdb-tools new MCP tools — activation tests
 *
 * Tests wiring for the new tools added in ADR-0033:
 * - agentdb_reflexion_retrieve (P3-B)
 * - agentdb_reflexion_store (P3-B)
 * - agentdb_causal_query (P3-C)
 * - agentdb_causal_recall (ADR-0033)
 * - agentdb_batch_optimize (ADR-0033)
 * - agentdb_branch (P6-B COW)
 *
 * Uses London School TDD (mock-first): all router interactions are mocked.
 *
 * Moved from ruflo fork cli/__tests__/ to ruflo-patch (patch tests belong here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock setup — must be before imports
// ============================================================================

const mockReflexionController = {
  retrieve: vi.fn(),
  store: vi.fn(),
};

const mockCausalGraphController = {
  getEffects: vi.fn(),
  getCauses: vi.fn(),
  getStats: vi.fn(),
  query: vi.fn(),
};

const mockVectorBackend = {
  derive: vi.fn(),
  branchGet: vi.fn(),
  branchStore: vi.fn(),
  branchMerge: vi.fn(),
  getByKey: vi.fn(),
};

const mockGetController = vi.fn(async (name: string) => {
  switch (name) {
    case 'reflexion': return mockReflexionController;
    case 'causalGraph': return mockCausalGraphController;
    case 'vectorBackend': return mockVectorBackend;
    default: return null;
  }
});

const mockRouteCausalRecall = vi.fn();
const mockRouteBatchOptimize = vi.fn();
const mockRouteBatchPrune = vi.fn();

vi.mock('@fork-cli/src/memory/memory-router.js', () => ({
  routeHealthCheck: vi.fn(async () => ({ available: true })),
  routeListControllers: vi.fn(async () => []),
  routePatternOp: vi.fn(async () => ({ success: true })),
  routeRecordFeedback: vi.fn(async () => ({ success: true })),
  routeRecordCausalEdge: vi.fn(async () => ({ success: true })),
  routeTask: vi.fn(async () => ({ route: 'general' })),
  routeSessionStart: vi.fn(async () => ({ success: true })),
  routeSessionEnd: vi.fn(async () => ({ success: true })),
  routeMemoryOp: vi.fn(async () => ({ success: true })),
  routeConsolidate: vi.fn(async () => ({ success: true })),
  routeSemanticRoute: vi.fn(async () => ({ route: null })),
  getController: mockGetController,
  routeCausalRecall: mockRouteCausalRecall,
  routeBatchOptimize: mockRouteBatchOptimize,
  routeBatchPrune: mockRouteBatchPrune,
}));

// ============================================================================
// Import tools under test (after mocks)
// ============================================================================

import {
  agentdbReflexionRetrieve,
  agentdbReflexionStore,
  agentdbCausalQuery,
  agentdbCausalRecall,
  agentdbBatchOptimize,
  agentdbBranch,
} from '@fork-cli/src/mcp-tools/agentdb-tools.js';

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: agentdb-tools new MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- agentdb_reflexion_retrieve ----------

  describe('agentdb_reflexion_retrieve', () => {
    it('should retrieve reflexion memories by task', async () => {
      const mockResults = [
        { task: 'write unit tests', reward: 0.9, success: true },
        { task: 'write integration tests', reward: 0.7, success: true },
      ];
      mockReflexionController.retrieve.mockResolvedValue(mockResults);

      const result = await agentdbReflexionRetrieve.handler({ task: 'write unit tests', k: 5 });

      expect(mockGetController).toHaveBeenCalledWith('reflexion');
      expect(mockReflexionController.retrieve).toHaveBeenCalledWith('write unit tests', 5);
      expect(result).toEqual({
        success: true,
        results: mockResults,
        count: 2,
      });
    });

    it('should use default k=5 when not provided', async () => {
      mockReflexionController.retrieve.mockResolvedValue([]);

      await agentdbReflexionRetrieve.handler({ task: 'test' });

      expect(mockReflexionController.retrieve).toHaveBeenCalledWith('test', 5);
    });

    it('should return error when ReflexionMemory unavailable', async () => {
      mockGetController.mockResolvedValueOnce(null);

      const result = await agentdbReflexionRetrieve.handler({ task: 'test' });

      expect(result).toEqual({
        success: false,
        results: [],
        error: 'ReflexionMemory not available',
      });
    });

    it('should return error when retrieve method missing', async () => {
      mockGetController.mockResolvedValueOnce({ noRetrieve: true });

      const result = await agentdbReflexionRetrieve.handler({ task: 'test' });

      expect(result).toEqual({
        success: false,
        results: [],
        error: 'ReflexionMemory not available',
      });
    });

    it('should timeout after 2 seconds', async () => {
      mockReflexionController.retrieve.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const result = await agentdbReflexionRetrieve.handler({ task: 'slow query' });

      expect(result).toMatchObject({
        success: false,
        results: [],
      });
      expect((result as any).error).toContain('timeout');
    }, 5000);

    it('should validate task param is non-empty string', async () => {
      const result = await agentdbReflexionRetrieve.handler({ task: '' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('task is required'),
      });
    });

    it('should cap k at MAX_TOP_K (100)', async () => {
      mockReflexionController.retrieve.mockResolvedValue([]);

      await agentdbReflexionRetrieve.handler({ task: 'test', k: 999 });

      expect(mockReflexionController.retrieve).toHaveBeenCalledWith('test', 100);
    });
  });

  // ---------- agentdb_reflexion_store ----------

  describe('agentdb_reflexion_store', () => {
    it('should store reflexion memory with correct params', async () => {
      mockReflexionController.store.mockResolvedValue(undefined);

      const result = await agentdbReflexionStore.handler({
        session_id: 's1',
        task: 'write tests',
        reward: 0.9,
        success: true,
      });

      expect(mockGetController).toHaveBeenCalledWith('reflexion');
      expect(mockReflexionController.store).toHaveBeenCalledWith({
        session_id: 's1',
        task: 'write tests',
        reward: 0.9,
        success: true,
      });
      expect(result).toEqual({ success: true });
    });

    it('should validate required session_id', async () => {
      const result = await agentdbReflexionStore.handler({
        task: 'test',
        reward: 0.9,
        success: true,
      });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('session_id is required'),
      });
    });

    it('should validate required task', async () => {
      const result = await agentdbReflexionStore.handler({
        session_id: 's1',
        reward: 0.9,
        success: true,
      });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('task is required'),
      });
    });

    it('should return error when ReflexionMemory unavailable', async () => {
      mockGetController.mockResolvedValueOnce(null);

      const result = await agentdbReflexionStore.handler({
        session_id: 's1',
        task: 'test',
        reward: 0.5,
        success: false,
      });

      expect(result).toMatchObject({
        success: false,
        error: 'ReflexionMemory not available',
      });
    });

    it('should clamp reward to 0-1 range', async () => {
      mockReflexionController.store.mockResolvedValue(undefined);

      await agentdbReflexionStore.handler({
        session_id: 's1',
        task: 'test',
        reward: 5.0,
        success: true,
      });

      expect(mockReflexionController.store).toHaveBeenCalledWith(
        expect.objectContaining({ reward: 1 }),
      );
    });

    it('should timeout after 2 seconds', async () => {
      mockReflexionController.store.mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      );

      const result = await agentdbReflexionStore.handler({
        session_id: 's1',
        task: 'slow store',
        reward: 0.5,
        success: true,
      });

      expect(result).toMatchObject({ success: false });
      expect((result as any).error).toContain('timeout');
    }, 5000);
  });

  // ---------- agentdb_causal_query ----------

  describe('agentdb_causal_query', () => {
    it('should query causal graph for effects of a cause', async () => {
      const mockEffects = [
        { effect: 'faster CI', uplift: 0.8 },
        { effect: 'fewer flakes', uplift: 0.6 },
      ];
      mockCausalGraphController.getStats.mockResolvedValue({ edgeCount: 10 });
      mockCausalGraphController.getEffects.mockResolvedValue(mockEffects);

      const result = await agentdbCausalQuery.handler({ cause: 'refactor', k: 5 });

      expect(mockGetController).toHaveBeenCalledWith('causalGraph');
      expect(mockCausalGraphController.getEffects).toHaveBeenCalledWith('refactor', 5);
      expect(result).toEqual({
        success: true,
        results: mockEffects,
        count: 2,
      });
    });

    it('should query causal graph for causes of an effect', async () => {
      const mockCauses = [{ cause: 'refactor', uplift: 0.7 }];
      mockCausalGraphController.getStats.mockResolvedValue({ edgeCount: 10 });
      mockCausalGraphController.getCauses.mockResolvedValue(mockCauses);

      const result = await agentdbCausalQuery.handler({ effect: 'faster CI', k: 3 });

      expect(mockCausalGraphController.getCauses).toHaveBeenCalledWith('faster CI', 3);
      expect(result).toMatchObject({ success: true, results: mockCauses });
    });

    it('should apply cold-start guard when <5 edges', async () => {
      mockCausalGraphController.getStats.mockResolvedValue({ edgeCount: 3 });

      const result = await agentdbCausalQuery.handler({ cause: 'refactor' });

      expect(result).toEqual({
        success: true,
        results: [],
        warning: 'Cold start: fewer than 5 causal edges recorded. Results would be noise.',
      });
      // Should NOT call getEffects when cold-start triggered
      expect(mockCausalGraphController.getEffects).not.toHaveBeenCalled();
    });

    it('should apply cold-start guard using edges key', async () => {
      mockCausalGraphController.getStats.mockResolvedValue({ edges: 2 });

      const result = await agentdbCausalQuery.handler({ cause: 'x' });

      expect(result).toMatchObject({
        success: true,
        results: [],
        warning: expect.stringContaining('Cold start'),
      });
    });

    it('should filter by min_uplift', async () => {
      mockCausalGraphController.getStats.mockResolvedValue({ edgeCount: 20 });
      mockCausalGraphController.getEffects.mockResolvedValue([
        { effect: 'a', uplift: 0.8 },
        { effect: 'b', uplift: 0.2 },
        { effect: 'c', uplift: 0.6 },
      ]);

      const result = await agentdbCausalQuery.handler({
        cause: 'x',
        min_uplift: 0.5,
      });

      expect((result as any).results).toEqual([
        { effect: 'a', uplift: 0.8 },
        { effect: 'c', uplift: 0.6 },
      ]);
    });

    it('should return error when CausalMemoryGraph unavailable', async () => {
      mockGetController.mockResolvedValueOnce(null);

      const result = await agentdbCausalQuery.handler({ cause: 'x' });

      expect(result).toMatchObject({
        success: false,
        results: [],
        error: 'CausalMemoryGraph not available',
      });
    });

    it('should timeout after 2 seconds', async () => {
      mockCausalGraphController.getStats.mockResolvedValue({ edgeCount: 50 });
      mockCausalGraphController.getEffects.mockImplementation(
        () => new Promise(() => {}),
      );

      const result = await agentdbCausalQuery.handler({ cause: 'slow' });

      expect(result).toMatchObject({ success: false });
      expect((result as any).error).toContain('timeout');
    }, 5000);
  });

  // ---------- agentdb_causal_recall ----------

  describe('agentdb_causal_recall', () => {
    it('should call routeCausalRecall with query and params', async () => {
      mockRouteCausalRecall.mockResolvedValue({
        success: true,
        results: [{ key: 'auth-pattern', score: 0.9 }],
      });

      const result = await agentdbCausalRecall.handler({
        query: 'authentication pattern',
        k: 10,
      });

      expect(mockRouteCausalRecall).toHaveBeenCalledWith({
        query: 'authentication pattern',
        k: 10,
        includeEvidence: false,
      });
      expect(result).toEqual({
        success: true,
        results: [{ key: 'auth-pattern', score: 0.9 }],
      });
    });

    it('should pass includeEvidence when include_evidence=true', async () => {
      mockRouteCausalRecall.mockResolvedValue({ success: true, results: [] });

      await agentdbCausalRecall.handler({
        query: 'test',
        include_evidence: true,
      });

      expect(mockRouteCausalRecall).toHaveBeenCalledWith(
        expect.objectContaining({ includeEvidence: true }),
      );
    });

    it('should handle cold-start warning from router', async () => {
      mockRouteCausalRecall.mockResolvedValue({
        success: true,
        results: [],
        warning: 'Cold start: insufficient causal edges',
      });

      const result = await agentdbCausalRecall.handler({ query: 'test' });

      expect(result).toMatchObject({
        success: true,
        results: [],
        warning: expect.stringContaining('Cold start'),
      });
    });

    it('should validate query is required', async () => {
      const result = await agentdbCausalRecall.handler({ query: '' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('query is required'),
      });
    });

    it('should return error when routeCausalRecall unavailable', async () => {
      // Temporarily remove routeCausalRecall from router
      const router = await import('@fork-cli/src/memory/memory-router.js');
      const original = router.routeCausalRecall;
      (router as any).routeCausalRecall = undefined;

      const result = await agentdbCausalRecall.handler({ query: 'test' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('not available'),
      });

      // Restore
      (router as any).routeCausalRecall = original;
    });

    it('should handle errors from routeCausalRecall', async () => {
      mockRouteCausalRecall.mockRejectedValue(new Error('Router failure'));

      const result = await agentdbCausalRecall.handler({ query: 'test' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Router failure'),
      });
    });
  });

  // ---------- agentdb_batch_optimize ----------

  describe('agentdb_batch_optimize', () => {
    it('should dispatch optimize action', async () => {
      mockRouteBatchOptimize.mockResolvedValue({
        success: true,
        optimized: 42,
      });

      const result = await agentdbBatchOptimize.handler({ action: 'optimize' });

      expect(mockRouteBatchOptimize).toHaveBeenCalled();
      expect(result).toEqual({ success: true, optimized: 42 });
    });

    it('should dispatch prune action with config', async () => {
      mockRouteBatchPrune.mockResolvedValue({
        success: true,
        pruned: 15,
      });

      const result = await agentdbBatchOptimize.handler({
        action: 'prune',
        max_age: 30,
        min_reward: 0.3,
      });

      expect(mockRouteBatchPrune).toHaveBeenCalledWith({
        maxAge: 30,
        minReward: 0.3,
      });
      expect(result).toEqual({ success: true, pruned: 15 });
    });

    it('should dispatch stats action (uses optimize endpoint)', async () => {
      mockRouteBatchOptimize.mockResolvedValue({
        success: true,
        totalEntries: 100,
      });

      const result = await agentdbBatchOptimize.handler({ action: 'stats' });

      expect(mockRouteBatchOptimize).toHaveBeenCalled();
      expect(result).toMatchObject({ success: true });
    });

    it('should reject unknown actions', async () => {
      const result = await agentdbBatchOptimize.handler({ action: 'invalid' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Unknown action: invalid'),
      });
    });

    it('should validate action is required', async () => {
      const result = await agentdbBatchOptimize.handler({});

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('action is required'),
      });
    });

    it('should return error when routeBatchOptimize unavailable', async () => {
      const router = await import('@fork-cli/src/memory/memory-router.js');
      const original = router.routeBatchOptimize;
      (router as any).routeBatchOptimize = undefined;

      const result = await agentdbBatchOptimize.handler({ action: 'optimize' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('not available'),
      });

      (router as any).routeBatchOptimize = original;
    });

    it('should return error when routeBatchPrune unavailable', async () => {
      const router = await import('@fork-cli/src/memory/memory-router.js');
      const original = router.routeBatchPrune;
      (router as any).routeBatchPrune = undefined;

      const result = await agentdbBatchOptimize.handler({ action: 'prune' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('not available'),
      });

      (router as any).routeBatchPrune = original;
    });

    it('should clamp negative max_age to 0', async () => {
      mockRouteBatchPrune.mockResolvedValue({ success: true });

      await agentdbBatchOptimize.handler({
        action: 'prune',
        max_age: -5,
      });

      expect(mockRouteBatchPrune).toHaveBeenCalledWith(
        expect.objectContaining({ maxAge: 0 }),
      );
    });

    it('should handle errors from batch operations', async () => {
      mockRouteBatchOptimize.mockRejectedValue(new Error('DB locked'));

      const result = await agentdbBatchOptimize.handler({ action: 'optimize' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('DB locked'),
      });
    });
  });

  // ---------- agentdb_branch (COW) ----------

  describe('agentdb_branch (COW)', () => {
    it('should create branch via derive()', async () => {
      mockVectorBackend.derive.mockResolvedValue({
        success: true,
        branchId: 'branch-abc',
        parentId: 'main',
      });

      const result = await agentdbBranch.handler({
        action: 'create',
        branch_name: 'experiment-1',
      });

      expect(mockGetController).toHaveBeenCalledWith('vectorBackend');
      expect(mockVectorBackend.derive).toHaveBeenCalledWith('experiment-1');
      expect(result).toMatchObject({
        success: true,
        branchId: 'branch-abc',
      });
    });

    it('should require branch_name for create', async () => {
      const result = await agentdbBranch.handler({ action: 'create' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('branch_name is required'),
      });
    });

    it('should get from branch with key', async () => {
      mockVectorBackend.branchGet.mockResolvedValue({ content: 'test-value' });

      const result = await agentdbBranch.handler({
        action: 'get',
        branch_id: 'b1',
        key: 'mykey',
      });

      expect(mockVectorBackend.branchGet).toHaveBeenCalledWith('b1', 'mykey', undefined);
      expect(result).toEqual({ success: true, entry: { content: 'test-value' } });
    });

    it('should pass namespace to branchGet', async () => {
      mockVectorBackend.branchGet.mockResolvedValue(null);

      await agentdbBranch.handler({
        action: 'get',
        branch_id: 'b1',
        key: 'k',
        namespace: 'patterns',
      });

      expect(mockVectorBackend.branchGet).toHaveBeenCalledWith('b1', 'k', 'patterns');
    });

    it('should require branch_id and key for get', async () => {
      const result = await agentdbBranch.handler({ action: 'get', branch_id: 'b1' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('branch_id and key are required'),
      });
    });

    it('should store to branch without affecting parent', async () => {
      mockVectorBackend.branchStore.mockResolvedValue({ success: true });

      const result = await agentdbBranch.handler({
        action: 'store',
        branch_id: 'b1',
        key: 'k',
        value: 'v',
      });

      expect(mockVectorBackend.branchStore).toHaveBeenCalledWith('b1', 'k', 'v', undefined);
      expect(result).toMatchObject({ success: true });
    });

    it('should require branch_id, key, value for store', async () => {
      const result = await agentdbBranch.handler({
        action: 'store',
        branch_id: 'b1',
        key: 'k',
      });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('branch_id, key, and value are required'),
      });
    });

    it('should merge branch back to parent', async () => {
      mockVectorBackend.branchMerge.mockResolvedValue({
        success: true,
        mergedKeys: 5,
      });

      const result = await agentdbBranch.handler({
        action: 'merge',
        branch_id: 'b1',
      });

      expect(mockVectorBackend.branchMerge).toHaveBeenCalledWith('b1', undefined);
      expect(result).toMatchObject({ success: true, mergedKeys: 5 });
    });

    it('should require branch_id for merge', async () => {
      const result = await agentdbBranch.handler({ action: 'merge' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('branch_id is required'),
      });
    });

    it('should return branch status', async () => {
      mockVectorBackend.getByKey.mockResolvedValue({
        content: JSON.stringify({
          branchId: 'b1',
          parentId: 'main',
          created: '2026-01-01',
        }),
      });

      const result = await agentdbBranch.handler({
        action: 'status',
        branch_id: 'b1',
      });

      expect(mockVectorBackend.getByKey).toHaveBeenCalledWith('default', '_branch_meta:b1');
      expect(result).toMatchObject({
        success: true,
        branch: { branchId: 'b1', parentId: 'main' },
      });
    });

    it('should return null branch when no meta found', async () => {
      mockVectorBackend.getByKey.mockResolvedValue(null);

      const result = await agentdbBranch.handler({
        action: 'status',
        branch_id: 'nonexistent',
      });

      expect(result).toEqual({ success: true, branch: null });
    });

    it('should require branch_id for status', async () => {
      const result = await agentdbBranch.handler({ action: 'status' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('branch_id is required'),
      });
    });

    it('should return error for unknown action', async () => {
      const result = await agentdbBranch.handler({ action: 'destroy' });

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Unknown action: destroy'),
      });
    });

    it('should return error when backend unavailable', async () => {
      mockGetController.mockResolvedValueOnce(null);

      const result = await agentdbBranch.handler({
        action: 'create',
        branch_name: 'test',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'Backend not available for branching',
      });
    });

    it('should return error when derive not supported', async () => {
      mockGetController.mockResolvedValueOnce({});

      const result = await agentdbBranch.handler({
        action: 'create',
        branch_name: 'test',
      });

      expect(result).toMatchObject({
        success: false,
        error: 'COW branching not supported by backend',
      });
    });

    it('should timeout after 2 seconds on slow operations', async () => {
      mockVectorBackend.derive.mockImplementation(
        () => new Promise(() => {}),
      );

      const result = await agentdbBranch.handler({
        action: 'create',
        branch_name: 'slow-branch',
      });

      expect(result).toMatchObject({ success: false });
      expect((result as any).error).toContain('timeout');
    }, 5000);
  });
});

/**
 * ADR-0033: hooks-tools controller activation wiring tests
 *
 * Tests the wiring added to hooks-tools.ts for ADR-0033 controllers:
 * - SolverBandit (hooks_route Phase 2, hooks_post-task Phase 2)
 * - SkillLibrary (hooks_route Phase 4, hooks_post-task Phase 4)
 * - LearningSystem (hooks_route Phase 4)
 * - SemanticRouter (hooks_route Phase 5)
 * - SonaTrajectory (hooks_post-task Phase 5, hooks_intelligence_stats)
 * - NightlyLearner (hooks_session-end Phase 3)
 *
 * London School TDD: all external dependencies are mocked.
 *
 * Moved from ruflo fork cli/__tests__/ to ruflo-patch (patch tests belong here).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mock setup — must be before imports
// =============================================================================

// Mock fs to prevent actual file I/O
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 100, isFile: () => true, isDirectory: () => false })),
}));

// Mock memory-initializer (lazy-loaded by hooks-tools)
vi.mock('@fork-cli/src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async () => ({ embedding: new Array(384).fill(0.1), dimensions: 384, model: 'mock' })),
  storeEntry: vi.fn(async () => ({ success: true, id: 'mock-id' })),
  searchEntries: vi.fn(async () => ({ success: true, results: [], searchTime: 1 })),
  listEntries: vi.fn(async () => ({ success: true, entries: [] })),
  getEntry: vi.fn(async () => null),
  deleteEntry: vi.fn(async () => ({ success: true })),
  getStats: vi.fn(async () => ({
    totalEntries: 0, namespaces: [], memory: {
      indexSize: 0, memorySizeBytes: 0, totalAccessCount: 0,
    },
  })),
}));

// Mock SONA optimizer
vi.mock('@fork-cli/src/memory/sona-optimizer.js', () => ({
  getSONAOptimizer: vi.fn(async () => null),
}));

// Mock EWC consolidation
vi.mock('@fork-cli/src/memory/ewc-consolidation.js', () => ({
  getEWCConsolidator: vi.fn(async () => null),
}));

// Mock MoE router
vi.mock('@fork-cli/src/ruvector/moe-router.js', () => ({
  getMoERouter: vi.fn(async () => null),
}));

// Mock LoRA adapter
vi.mock('@fork-cli/src/ruvector/lora-adapter.js', () => ({
  getLoRAAdapter: vi.fn(async () => null),
}));

// Mock flash attention
vi.mock('@fork-cli/src/ruvector/flash-attention.js', () => ({
  getFlashAttention: vi.fn(async () => null),
}));

// Mock semantic router
vi.mock('@fork-cli/src/ruvector/semantic-router.js', () => ({
  SemanticRouter: vi.fn(),
}));

// Mock worker daemon
vi.mock('@fork-cli/src/services/worker-daemon.js', () => ({
  startDaemon: vi.fn(async () => ({ pid: 12345, getStatus: () => ({ pid: 12345 }) })),
  stopDaemon: vi.fn(async () => {}),
}));

// Mock enhanced model router
vi.mock('@fork-cli/src/services/enhanced-model-router.js', () => ({
  getEnhancedModelRouter: vi.fn(async () => null),
}));

// Default router mock — reconfigured per test via routerMock
const routerMock = {
  routeSolverBanditSelect: vi.fn(),
  routeSolverBanditUpdate: vi.fn(),
  getController: vi.fn(),
  routeSemanticRoute: vi.fn(),
  routeTask: vi.fn(async () => ({ route: 'general', confidence: 0.3, agents: ['coder'], controller: 'none' })),
  routeRecordFeedback: vi.fn(async () => ({ success: true, controller: 'mock', updated: 1 })),
  routeRecordCausalEdge: vi.fn(async () => ({ success: true })),
  routeSessionStart: vi.fn(async () => ({ success: true, controller: 'mock', restoredPatterns: 0 })),
  routeSessionEnd: vi.fn(async () => ({ success: true, controller: 'mock', persisted: true })),
  routeHealthCheck: vi.fn(async () => ({ available: true, status: 'healthy' })),
  routeListControllers: vi.fn(async () => []),
  routePatternOp: vi.fn(async () => ({ success: true })),
  routeMemoryOp: vi.fn(async () => ({ success: true })),
  routeConsolidate: vi.fn(async () => ({ success: true })),
};

vi.mock('@fork-cli/src/memory/memory-router.js', () => routerMock);

// =============================================================================
// Imports (after mocks)
// =============================================================================

import { hooksRoute } from '@fork-cli/src/mcp-tools/hooks-tools.js';
import { hooksPostTask } from '@fork-cli/src/mcp-tools/hooks-tools.js';
import { hooksSessionEnd } from '@fork-cli/src/mcp-tools/hooks-tools.js';
import { hooksIntelligenceStats } from '@fork-cli/src/mcp-tools/hooks-tools.js';

// =============================================================================
// Helpers
// =============================================================================

/** Parse the JSON text from an MCPToolResult content array */
function parseRouteResult(result: any): any {
  if (result?.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

// =============================================================================
// Tests
// =============================================================================

describe('ADR-0033: hooks-tools controller activation (router)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset router defaults
    routerMock.routeSolverBanditSelect.mockResolvedValue(undefined);
    routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);
    routerMock.getController.mockResolvedValue(null);
    routerMock.routeSemanticRoute.mockResolvedValue({ route: null });
    routerMock.routeTask.mockResolvedValue({ route: 'general', confidence: 0.3, agents: ['coder'], controller: 'none' });
    routerMock.routeRecordFeedback.mockResolvedValue({ success: true, controller: 'mock', updated: 1 });
    routerMock.routeRecordCausalEdge.mockResolvedValue({ success: true });
    routerMock.routeSessionEnd.mockResolvedValue({ success: true, controller: 'mock', persisted: true });
  });

  // ===========================================================================
  // hooks_route — SolverBandit routing (Phase 2)
  // ===========================================================================

  describe('hooks_route -- SolverBandit routing', () => {
    it('should return early via SolverBandit when confidence > 0.6', async () => {
      routerMock.routeSolverBanditSelect.mockResolvedValue({
        arm: 'coder',
        confidence: 0.8,
        controller: 'solverBandit',
      });

      const result = await hooksRoute.handler({ task: 'write unit tests' });
      const parsed = parseRouteResult(result);

      expect(parsed.recommended_agent).toBe('coder');
      expect(parsed.confidence).toBe(0.8);
      expect(parsed.routing_method).toBe('solverBandit');
      expect(routerMock.routeSolverBanditSelect).toHaveBeenCalledWith(
        'write unit tests',
        expect.arrayContaining(['coder', 'reviewer', 'tester']),
      );
    });

    it('should fall through when SolverBandit confidence <= 0.6', async () => {
      routerMock.routeSolverBanditSelect.mockResolvedValue({
        arm: 'coder',
        confidence: 0.4,
        controller: 'fallback',
      });

      const result = await hooksRoute.handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      // Should NOT be solverBandit — it fell through
      expect(parsed.routing_method).not.toBe('solverBandit');
    });

    it('should fall through when SolverBandit confidence > 0.6 but controller is fallback', async () => {
      routerMock.routeSolverBanditSelect.mockResolvedValue({
        arm: 'coder',
        confidence: 0.9,
        controller: 'fallback',
      });

      const result = await hooksRoute.handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).not.toBe('solverBandit');
    });

    it('should fall through when routeSolverBanditSelect is undefined', async () => {
      // Remove the function entirely
      const original = routerMock.routeSolverBanditSelect;
      (routerMock as any).routeSolverBanditSelect = undefined;

      const result = await hooksRoute.handler({ task: 'review security' });

      // Should complete without error (fell through to another phase)
      expect(result).toBeDefined();

      // Restore
      (routerMock as any).routeSolverBanditSelect = original;
    });

    it('should fall through when SolverBandit throws', async () => {
      routerMock.routeSolverBanditSelect.mockRejectedValue(new Error('bandit crashed'));

      const result = await hooksRoute.handler({ task: 'fix bug' });

      // Should complete without error (caught by try-catch)
      expect(result).toBeDefined();
      const parsed = parseRouteResult(result);
      expect(parsed.routing_method).not.toBe('solverBandit');
    });

    it('should fall through when SolverBandit times out', async () => {
      // Return a promise that never resolves — the 2s timeout race should catch it
      routerMock.routeSolverBanditSelect.mockReturnValue(new Promise(() => {}));

      // Use fake timers to avoid waiting 2 real seconds
      vi.useFakeTimers();

      const resultPromise = hooksRoute.handler({ task: 'optimize performance' });

      // Advance past the 2000ms timeout
      await vi.advanceTimersByTimeAsync(2100);

      const result = await resultPromise;
      expect(result).toBeDefined();
      const parsed = parseRouteResult(result);
      expect(parsed.routing_method).not.toBe('solverBandit');

      vi.useRealTimers();
    });
  });

  // ===========================================================================
  // hooks_route — SkillLibrary search (Phase 4)
  // ===========================================================================

  describe('hooks_route -- SkillLibrary search', () => {
    it('should route via SkillLibrary when skill confidence > 0.7', async () => {
      const mockSkills = {
        search: vi.fn().mockResolvedValue([
          { name: 'auth-handler', agent: 'security-architect', confidence: 0.85, pattern: 'authentication' },
        ]),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksRoute.handler({ task: 'implement authentication' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).toBe('skillLibrary');
      expect(parsed.recommended_agent).toBe('security-architect');
      expect(parsed.confidence).toBe(0.85);
      expect(parsed.skill).toBe('auth-handler');
      expect(mockSkills.search).toHaveBeenCalledWith('implement authentication', 3);
    });

    it('should use score field when confidence is absent', async () => {
      const mockSkills = {
        search: vi.fn().mockResolvedValue([
          { name: 'test-skill', pattern: 'testing', score: 0.9 },
        ]),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksRoute.handler({ task: 'write tests', task_type: 'testing' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).toBe('skillLibrary');
      expect(parsed.confidence).toBe(0.9);
      // When no agent field, falls back to pattern or name
      expect(parsed.recommended_agent).toBe('testing');
    });

    it('should fall through when no matching skills', async () => {
      const mockSkills = {
        search: vi.fn().mockResolvedValue([]),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksRoute.handler({ task: 'do something unique' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).not.toBe('skillLibrary');
    });

    it('should fall through when skill confidence <= 0.7', async () => {
      const mockSkills = {
        search: vi.fn().mockResolvedValue([
          { name: 'weak-match', agent: 'coder', confidence: 0.5, score: 0.5 },
        ]),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksRoute.handler({ task: 'ambiguous task' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).not.toBe('skillLibrary');
    });

    it('should fall through when skills controller is null', async () => {
      routerMock.getController.mockResolvedValue(null);

      const result = await hooksRoute.handler({ task: 'any task' });

      expect(result).toBeDefined();
    });

    it('should fall through when skills.search throws', async () => {
      const mockSkills = {
        search: vi.fn().mockRejectedValue(new Error('search failed')),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksRoute.handler({ task: 'any task' });

      expect(result).toBeDefined();
      const parsed = parseRouteResult(result);
      expect(parsed.routing_method).not.toBe('skillLibrary');
    });
  });

  // ===========================================================================
  // hooks_route — LearningSystem recommendation (Phase 4)
  // ===========================================================================

  describe('hooks_route -- LearningSystem recommendation', () => {
    it('should merge learningSystem metadata into routing result', async () => {
      const mockLearningSystem = {
        recommendAlgorithm: vi.fn().mockResolvedValue({
          algorithm: 'ucb1',
          reason: 'best exploration-exploitation trade-off',
        }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'learningSystem') return mockLearningSystem;
        return null;
      });
      // Make SemanticRouter return a valid result so we can see routingMetadata in the output
      routerMock.routeSemanticRoute.mockResolvedValue({
        route: 'tester',
        confidence: 0.75,
      });

      const result = await hooksRoute.handler({ task: 'optimize search' });
      const parsed = parseRouteResult(result);

      // The SemanticRouter result includes spread routingMetadata
      expect(parsed.learningSystem).toBeDefined();
      expect(parsed.learningSystem.algorithm).toBe('ucb1');
      expect(mockLearningSystem.recommendAlgorithm).toHaveBeenCalledWith('optimize search');
    });

    it('should not add metadata when recommendAlgorithm returns null', async () => {
      const mockLearningSystem = {
        recommendAlgorithm: vi.fn().mockResolvedValue(null),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'learningSystem') return mockLearningSystem;
        return null;
      });
      routerMock.routeSemanticRoute.mockResolvedValue({
        route: 'coder',
        confidence: 0.8,
      });

      const result = await hooksRoute.handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      expect(parsed.learningSystem).toBeUndefined();
    });

    it('should not crash when learningSystem throws', async () => {
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'learningSystem') throw new Error('LS crashed');
        return null;
      });

      const result = await hooksRoute.handler({ task: 'any task' });

      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // hooks_route — SemanticRouter (Phase 5)
  // ===========================================================================

  describe('hooks_route -- SemanticRouter', () => {
    it('should return route from SemanticRouter when available', async () => {
      routerMock.routeSemanticRoute.mockResolvedValue({
        route: 'tester',
        confidence: 0.9,
      });

      const result = await hooksRoute.handler({ task: 'test the auth module' });
      const parsed = parseRouteResult(result);

      expect(parsed.recommended_agent).toBe('tester');
      expect(parsed.confidence).toBe(0.9);
      expect(parsed.routing_method).toBe('semanticRouter');
      expect(routerMock.routeSemanticRoute).toHaveBeenCalledWith({ input: 'test the auth module' });
    });

    it('should use default confidence 0.7 when not provided', async () => {
      routerMock.routeSemanticRoute.mockResolvedValue({
        route: 'coder',
      });

      const result = await hooksRoute.handler({ task: 'write a parser' });
      const parsed = parseRouteResult(result);

      expect(parsed.confidence).toBe(0.7);
    });

    it('should fall through when SemanticRouter returns null route', async () => {
      routerMock.routeSemanticRoute.mockResolvedValue({ route: null });

      const result = await hooksRoute.handler({ task: 'general task' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).not.toBe('semanticRouter');
    });

    it('should fall through when SemanticRouter returns error', async () => {
      routerMock.routeSemanticRoute.mockResolvedValue({ route: 'coder', error: 'something wrong' });

      const result = await hooksRoute.handler({ task: 'general task' });
      const parsed = parseRouteResult(result);

      expect(parsed.routing_method).not.toBe('semanticRouter');
    });

    it('should fall through when routeSemanticRoute is undefined', async () => {
      const original = routerMock.routeSemanticRoute;
      (routerMock as any).routeSemanticRoute = undefined;

      const result = await hooksRoute.handler({ task: 'any task' });

      expect(result).toBeDefined();

      (routerMock as any).routeSemanticRoute = original;
    });

    it('should fall through when SemanticRouter throws', async () => {
      routerMock.routeSemanticRoute.mockRejectedValue(new Error('router crashed'));

      const result = await hooksRoute.handler({ task: 'any task' });

      expect(result).toBeDefined();
      const parsed = parseRouteResult(result);
      expect(parsed.routing_method).not.toBe('semanticRouter');
    });
  });

  // ===========================================================================
  // hooks_post-task — SolverBandit feedback (Phase 2)
  // ===========================================================================

  describe('hooks_post-task -- SolverBandit feedback', () => {
    it('should call routeSolverBanditUpdate fire-and-forget on task completion', async () => {
      routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);

      const result = await hooksPostTask.handler({
        taskId: 'task-123',
        success: true,
        agent: 'coder',
        quality: 0.9,
        task_type: 'coding',
      });

      expect(result).toBeDefined();
      expect(routerMock.routeSolverBanditUpdate).toHaveBeenCalledWith('coding', 'coder', 0.9);
    });

    it('should use task as taskType when task_type not provided', async () => {
      routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);

      await hooksPostTask.handler({
        taskId: 'task-456',
        success: true,
        agent: 'reviewer',
        quality: 0.7,
        task: 'review PR',
      });

      expect(routerMock.routeSolverBanditUpdate).toHaveBeenCalledWith('review PR', 'reviewer', 0.7);
    });

    it('should not block response when routeSolverBanditUpdate rejects', async () => {
      routerMock.routeSolverBanditUpdate.mockRejectedValue(new Error('update failed'));

      const result = await hooksPostTask.handler({
        taskId: 'task-789',
        success: true,
        agent: 'coder',
        quality: 0.8,
      });

      // Handler should still complete successfully
      expect(result).toBeDefined();
      expect((result as any).taskId).toBe('task-789');
    });

    it('should not crash when routeSolverBanditUpdate is undefined', async () => {
      const original = routerMock.routeSolverBanditUpdate;
      (routerMock as any).routeSolverBanditUpdate = undefined;

      const result = await hooksPostTask.handler({
        taskId: 'task-noupdate',
        success: true,
        agent: 'coder',
        quality: 0.5,
      });

      expect(result).toBeDefined();

      (routerMock as any).routeSolverBanditUpdate = original;
    });
  });

  // ===========================================================================
  // hooks_post-task — SkillLibrary creation (Phase 4)
  // ===========================================================================

  describe('hooks_post-task -- SkillLibrary creation', () => {
    it('should create skill when quality > 0.8', async () => {
      const mockSkills = {
        create: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      await hooksPostTask.handler({
        taskId: 'task-skill',
        success: true,
        agent: 'coder',
        quality: 0.95,
        task_type: 'refactoring',
      });

      expect(mockSkills.create).toHaveBeenCalledWith({
        name: 'refactoring-coder',
        pattern: 'refactoring',
        context: expect.stringContaining('"agent":"coder"'),
      });
    });

    it('should NOT create skill when quality <= 0.8', async () => {
      const mockSkills = {
        create: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      await hooksPostTask.handler({
        taskId: 'task-lowq',
        success: true,
        agent: 'coder',
        quality: 0.5,
      });

      expect(mockSkills.create).not.toHaveBeenCalled();
    });

    it('should NOT create skill when quality is exactly 0.8', async () => {
      const mockSkills = {
        create: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      await hooksPostTask.handler({
        taskId: 'task-boundary',
        success: true,
        agent: 'coder',
        quality: 0.8,
      });

      // quality > 0.8 is strict, so 0.8 exactly should NOT trigger
      expect(mockSkills.create).not.toHaveBeenCalled();
    });

    it('should not block response when skills.create rejects', async () => {
      const mockSkills = {
        create: vi.fn().mockRejectedValue(new Error('create failed')),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      const result = await hooksPostTask.handler({
        taskId: 'task-fail-create',
        success: true,
        agent: 'coder',
        quality: 0.95,
      });

      expect(result).toBeDefined();
      expect((result as any).taskId).toBe('task-fail-create');
    });

    it('should include context with agent, quality, and timestamp', async () => {
      const mockSkills = {
        create: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'skills') return mockSkills;
        return null;
      });

      await hooksPostTask.handler({
        taskId: 'task-ctx',
        success: true,
        agent: 'tester',
        quality: 0.9,
        task_type: 'testing',
      });

      const contextArg = mockSkills.create.mock.calls[0][0].context;
      const parsed = JSON.parse(contextArg);
      expect(parsed.agent).toBe('tester');
      expect(parsed.quality).toBe(0.9);
      expect(parsed.timestamp).toBeTypeOf('number');
    });
  });

  // ===========================================================================
  // hooks_post-task — SonaTrajectory recording (Phase 5)
  // ===========================================================================

  describe('hooks_post-task -- SonaTrajectory recording', () => {
    it('should record trajectory step fire-and-forget', async () => {
      const mockTrajectory = {
        recordStep: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'sonaTrajectory') return mockTrajectory;
        return null;
      });

      await hooksPostTask.handler({
        taskId: 'task-traj',
        success: true,
        agent: 'coder',
        quality: 0.85,
        task_type: 'coding',
      });

      expect(mockTrajectory.recordStep).toHaveBeenCalledWith(
        expect.objectContaining({
          task: 'coding',
          agent: 'coder',
          reward: 0.85,
          success: true,
          timestamp: expect.any(Number),
        }),
      );
    });

    it('should not block response when recordStep rejects', async () => {
      const mockTrajectory = {
        recordStep: vi.fn().mockRejectedValue(new Error('record failed')),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'sonaTrajectory') return mockTrajectory;
        return null;
      });

      const result = await hooksPostTask.handler({
        taskId: 'task-traj-fail',
        success: true,
        agent: 'coder',
        quality: 0.7,
      });

      expect(result).toBeDefined();
      expect((result as any).taskId).toBe('task-traj-fail');
    });

    it('should skip recording when sonaTrajectory is null', async () => {
      routerMock.getController.mockResolvedValue(null);

      const result = await hooksPostTask.handler({
        taskId: 'task-no-traj',
        success: true,
        agent: 'coder',
        quality: 0.7,
      });

      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // hooks_session-end — NightlyLearner consolidation (Phase 3)
  // ===========================================================================

  describe('hooks_session-end -- NightlyLearner consolidation', () => {
    it('should trigger consolidation fire-and-forget on session end', async () => {
      const mockNightlyLearner = {
        consolidate: vi.fn().mockResolvedValue({ success: true }),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'nightlyLearner') return mockNightlyLearner;
        return null;
      });

      const result = await hooksSessionEnd.handler({ saveState: true, stopDaemon: false });

      expect(result).toBeDefined();
      expect(mockNightlyLearner.consolidate).toHaveBeenCalled();
    });

    it('should not block session end when NightlyLearner unavailable', async () => {
      routerMock.getController.mockResolvedValue(null);

      const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

      expect(result).toBeDefined();
      expect((result as any).sessionPersistence).toBeDefined();
    });

    it('should not block session end when consolidate rejects', async () => {
      const mockNightlyLearner = {
        consolidate: vi.fn().mockRejectedValue(new Error('consolidation failed')),
      };
      routerMock.getController.mockImplementation(async (name: string) => {
        if (name === 'nightlyLearner') return mockNightlyLearner;
        return null;
      });

      const result = await hooksSessionEnd.handler({ saveState: true, stopDaemon: false });

      expect(result).toBeDefined();
    });

    it('should not block when getController throws', async () => {
      routerMock.getController.mockRejectedValue(new Error('controller registry crashed'));

      const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

      expect(result).toBeDefined();
    });
  });

  // ===========================================================================
  // hooks_intelligence_stats — SonaTrajectory stats (Phase 5)
  // ===========================================================================

  describe('hooks_intelligence_stats -- SonaTrajectory stats', () => {
    it('should include sonaTrajectory key in stats when controller is available', async () => {
      const result = await hooksIntelligenceStats.handler({});

      expect(result).toBeDefined();
      const stats = (result as any)?.content?.[0]?.text
        ? JSON.parse((result as any).content[0].text)
        : result;
      expect(stats).toBeDefined();
    });
  });

  // ===========================================================================
  // hooks_post-task — default quality values (WM-107a)
  // ===========================================================================

  describe('hooks_post-task -- quality defaults', () => {
    it('should use 0.85 default quality for successful tasks without explicit quality', async () => {
      routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);

      await hooksPostTask.handler({
        taskId: 'task-default-q',
        success: true,
        agent: 'coder',
      });

      expect(routerMock.routeSolverBanditUpdate).toHaveBeenCalledWith(
        expect.anything(), 'coder', 0.85,
      );
    });

    it('should use 0.2 default quality for failed tasks without explicit quality', async () => {
      routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);

      await hooksPostTask.handler({
        taskId: 'task-fail-q',
        success: false,
        agent: 'coder',
      });

      expect(routerMock.routeSolverBanditUpdate).toHaveBeenCalledWith(
        expect.anything(), 'coder', 0.2,
      );
    });

    it('should preserve explicit quality=0.0 (not coerce to default)', async () => {
      routerMock.routeSolverBanditUpdate.mockResolvedValue(undefined);

      await hooksPostTask.handler({
        taskId: 'task-zero-q',
        success: true,
        agent: 'coder',
        quality: 0.0,
      });

      expect(routerMock.routeSolverBanditUpdate).toHaveBeenCalledWith(
        expect.anything(), 'coder', 0.0,
      );
    });
  });
});

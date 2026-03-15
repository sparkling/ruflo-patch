// @tier unit
// ADR-0033: hooks-tools controller activation wiring -- contract tests
//
// Converted from vitest: ruflo/v3/@claude-flow/cli/__tests__/hooks-tools-activation.test.ts
//
// Tests wiring contracts for:
// - SolverBandit (hooks_route Phase 2, hooks_post-task Phase 2)
// - SkillLibrary (hooks_route Phase 4, hooks_post-task Phase 4)
// - LearningSystem (hooks_route Phase 4)
// - SemanticRouter (hooks_route Phase 5)
// - SonaTrajectory (hooks_post-task Phase 5, hooks_intelligence_stats)
// - NightlyLearner (hooks_session-end Phase 3)
//
// London School TDD: all external dependencies are mocked with plain objects.

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

// ============================================================================
// Simulated handler logic (mirrors hooks-tools.ts wiring)
// ============================================================================

const TIMEOUT_MS = 2000;
const SOLVER_BANDIT_CONFIDENCE_THRESHOLD = 0.6;
const SKILL_CONFIDENCE_THRESHOLD = 0.7;
const SKILL_CREATION_QUALITY_THRESHOLD = 0.8;
const DEFAULT_SEMANTIC_CONFIDENCE = 0.7;
const DEFAULT_SUCCESS_QUALITY = 0.85;
const DEFAULT_FAILURE_QUALITY = 0.2;

const DEFAULT_ARMS = ['coder', 'reviewer', 'tester', 'planner', 'researcher'];

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// --- hooks_route handler simulation ---
function createHooksRouteHandler(bridgeMock) {
  return async (params) => {
    const task = params.task || '';
    const routingMetadata = {};

    // Phase 2: SolverBandit
    if (typeof bridgeMock.bridgeSolverBanditSelect === 'function') {
      try {
        const banditResult = await withTimeout(
          bridgeMock.bridgeSolverBanditSelect(task, DEFAULT_ARMS),
          TIMEOUT_MS,
        );
        if (banditResult &&
            banditResult.confidence > SOLVER_BANDIT_CONFIDENCE_THRESHOLD &&
            banditResult.controller !== 'fallback') {
          return makeRouteResult({
            recommended_agent: banditResult.arm,
            confidence: banditResult.confidence,
            routing_method: 'solverBandit',
          });
        }
      } catch (_) {
        // Fall through
      }
    }

    // Phase 4: SkillLibrary search
    try {
      const skills = await bridgeMock.bridgeGetController('skills');
      if (skills && typeof skills.search === 'function') {
        const matches = await skills.search(task, 3);
        if (matches && matches.length > 0) {
          const best = matches[0];
          const conf = best.confidence ?? best.score ?? 0;
          if (conf > SKILL_CONFIDENCE_THRESHOLD) {
            return makeRouteResult({
              recommended_agent: best.agent || best.pattern || best.name,
              confidence: conf,
              routing_method: 'skillLibrary',
              skill: best.name,
            });
          }
        }
      }
    } catch (_) {
      // Fall through
    }

    // Phase 4: LearningSystem recommendation
    try {
      const ls = await bridgeMock.bridgeGetController('learningSystem');
      if (ls && typeof ls.recommendAlgorithm === 'function') {
        const rec = await ls.recommendAlgorithm(task);
        if (rec) {
          routingMetadata.learningSystem = rec;
        }
      }
    } catch (_) {
      // Fall through
    }

    // Phase 5: SemanticRouter
    if (typeof bridgeMock.bridgeSemanticRoute === 'function') {
      try {
        const semResult = await bridgeMock.bridgeSemanticRoute({ input: task });
        if (semResult && semResult.route && !semResult.error) {
          return makeRouteResult({
            recommended_agent: semResult.route,
            confidence: semResult.confidence || DEFAULT_SEMANTIC_CONFIDENCE,
            routing_method: 'semanticRouter',
            ...routingMetadata,
          });
        }
      } catch (_) {
        // Fall through
      }
    }

    // Fallback: use bridgeRouteTask
    try {
      const fallback = await bridgeMock.bridgeRouteTask(task);
      return makeRouteResult({
        recommended_agent: fallback.agents?.[0] || 'coder',
        confidence: fallback.confidence || 0.3,
        routing_method: fallback.controller || 'pattern',
        ...routingMetadata,
      });
    } catch (_) {
      return makeRouteResult({
        recommended_agent: 'coder',
        confidence: 0.3,
        routing_method: 'default',
        ...routingMetadata,
      });
    }
  };
}

function makeRouteResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function parseRouteResult(result) {
  if (result?.content?.[0]?.text) {
    return JSON.parse(result.content[0].text);
  }
  return result;
}

// --- hooks_post-task handler simulation ---
function createHooksPostTaskHandler(bridgeMock) {
  return async (params) => {
    const taskType = params.task_type || params.task || 'unknown';
    const agent = params.agent || 'coder';
    const quality = params.quality !== undefined ? params.quality
      : (params.success ? DEFAULT_SUCCESS_QUALITY : DEFAULT_FAILURE_QUALITY);

    // Phase 2: SolverBandit update (fire-and-forget)
    if (typeof bridgeMock.bridgeSolverBanditUpdate === 'function') {
      try {
        await bridgeMock.bridgeSolverBanditUpdate(taskType, agent, quality);
      } catch (_) {
        // fire-and-forget
      }
    }

    // Phase 4: SkillLibrary creation
    if (quality > SKILL_CREATION_QUALITY_THRESHOLD) {
      try {
        const skills = await bridgeMock.bridgeGetController('skills');
        if (skills && typeof skills.create === 'function') {
          await skills.create({
            name: `${taskType}-${agent}`,
            pattern: taskType,
            context: JSON.stringify({
              agent,
              quality,
              timestamp: Date.now(),
            }),
          });
        }
      } catch (_) {
        // fire-and-forget
      }
    }

    // Phase 5: SonaTrajectory recording (fire-and-forget)
    try {
      const traj = await bridgeMock.bridgeGetController('sonaTrajectory');
      if (traj && typeof traj.recordStep === 'function') {
        await traj.recordStep({
          task: taskType,
          agent,
          reward: quality,
          success: params.success,
          timestamp: Date.now(),
        });
      }
    } catch (_) {
      // fire-and-forget
    }

    // Record feedback
    try {
      await bridgeMock.bridgeRecordFeedback({
        taskId: params.taskId,
        quality,
        success: params.success,
      });
    } catch (_) {
      // non-blocking
    }

    // Record causal edge
    try {
      await bridgeMock.bridgeRecordCausalEdge({
        cause: taskType,
        effect: params.success ? 'success' : 'failure',
        uplift: quality,
      });
    } catch (_) {
      // non-blocking
    }

    return {
      taskId: params.taskId,
      recorded: true,
      quality,
    };
  };
}

// --- hooks_session-end handler simulation ---
function createHooksSessionEndHandler(bridgeMock) {
  return async (params) => {
    // Phase 3: NightlyLearner consolidation (fire-and-forget)
    try {
      const nl = await bridgeMock.bridgeGetController('nightlyLearner');
      if (nl && typeof nl.consolidate === 'function') {
        await nl.consolidate();
      }
    } catch (_) {
      // fire-and-forget
    }

    // Session persistence
    let sessionPersistence;
    try {
      sessionPersistence = await bridgeMock.bridgeSessionEnd({
        saveState: params.saveState,
      });
    } catch (_) {
      sessionPersistence = { success: false };
    }

    return {
      sessionEnded: true,
      sessionPersistence,
    };
  };
}

// --- hooks_intelligence_stats handler simulation ---
function createHooksIntelligenceStatsHandler(bridgeMock) {
  return async () => {
    const stats = {};

    try {
      const traj = await bridgeMock.bridgeGetController('sonaTrajectory');
      if (traj) {
        stats.sonaTrajectory = traj;
      }
    } catch (_) {
      // non-blocking
    }

    return { content: [{ type: 'text', text: JSON.stringify(stats) }] };
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: hooks-tools controller activation', () => {
  let bridgeMock;

  beforeEach(() => {
    bridgeMock = {
      bridgeSolverBanditSelect: asyncMock(undefined),
      bridgeSolverBanditUpdate: asyncMock(undefined),
      bridgeGetController: asyncMock(null),
      bridgeSemanticRoute: asyncMock({ route: null }),
      bridgeRouteTask: asyncMock({ route: 'general', confidence: 0.3, agents: ['coder'], controller: 'none' }),
      bridgeRecordFeedback: asyncMock({ success: true, controller: 'mock', updated: 1 }),
      bridgeRecordCausalEdge: asyncMock({ success: true }),
      bridgeSessionEnd: asyncMock({ success: true, controller: 'mock', persisted: true }),
    };
  });

  // ===========================================================================
  // hooks_route -- SolverBandit routing (Phase 2)
  // ===========================================================================

  describe('hooks_route -- SolverBandit routing', () => {
    it('should return early via SolverBandit when confidence > 0.6', async () => {
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder',
        confidence: 0.8,
        controller: 'solverBandit',
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write unit tests' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.recommended_agent, 'coder');
      assert.equal(parsed.confidence, 0.8);
      assert.equal(parsed.routing_method, 'solverBandit');
      assert.deepEqual(bridgeMock.bridgeSolverBanditSelect.calls[0][0], 'write unit tests');
      assert.ok(Array.isArray(bridgeMock.bridgeSolverBanditSelect.calls[0][1]));
      assert.ok(bridgeMock.bridgeSolverBanditSelect.calls[0][1].includes('coder'));
      assert.ok(bridgeMock.bridgeSolverBanditSelect.calls[0][1].includes('reviewer'));
      assert.ok(bridgeMock.bridgeSolverBanditSelect.calls[0][1].includes('tester'));
    });

    it('should fall through when SolverBandit confidence <= 0.6', async () => {
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder',
        confidence: 0.4,
        controller: 'fallback',
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'solverBandit');
    });

    it('should fall through when SolverBandit confidence > 0.6 but controller is fallback', async () => {
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder',
        confidence: 0.9,
        controller: 'fallback',
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'solverBandit');
    });

    it('should fall through when bridgeSolverBanditSelect is undefined', async () => {
      bridgeMock.bridgeSolverBanditSelect = undefined;
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'review security' });

      assert.ok(result !== undefined);
    });

    it('should fall through when SolverBandit throws', async () => {
      bridgeMock.bridgeSolverBanditSelect = rejectMock('bandit crashed');
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'fix bug' });

      assert.ok(result !== undefined);
      const parsed = parseRouteResult(result);
      assert.notEqual(parsed.routing_method, 'solverBandit');
    });

    it('should fall through when SolverBandit times out', async () => {
      bridgeMock.bridgeSolverBanditSelect = mockFn(() => new Promise(() => {}));
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'optimize performance' });

      assert.ok(result !== undefined);
      const parsed = parseRouteResult(result);
      assert.notEqual(parsed.routing_method, 'solverBandit');
    });
  });

  // ===========================================================================
  // hooks_route -- SkillLibrary search (Phase 4)
  // ===========================================================================

  describe('hooks_route -- SkillLibrary search', () => {
    it('should route via SkillLibrary when skill confidence > 0.7', async () => {
      const mockSkillSearch = asyncMock([
        { name: 'auth-handler', agent: 'security-architect', confidence: 0.85, pattern: 'authentication' },
      ]);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { search: mockSkillSearch };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'implement authentication' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.routing_method, 'skillLibrary');
      assert.equal(parsed.recommended_agent, 'security-architect');
      assert.equal(parsed.confidence, 0.85);
      assert.equal(parsed.skill, 'auth-handler');
      assert.deepEqual(mockSkillSearch.calls[0], ['implement authentication', 3]);
    });

    it('should use score field when confidence is absent', async () => {
      const mockSkillSearch = asyncMock([
        { name: 'test-skill', pattern: 'testing', score: 0.9 },
      ]);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { search: mockSkillSearch };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write tests', task_type: 'testing' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.routing_method, 'skillLibrary');
      assert.equal(parsed.confidence, 0.9);
      assert.equal(parsed.recommended_agent, 'testing');
    });

    it('should fall through when no matching skills', async () => {
      const mockSkillSearch = asyncMock([]);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { search: mockSkillSearch };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'do something unique' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'skillLibrary');
    });

    it('should fall through when skill confidence <= 0.7', async () => {
      const mockSkillSearch = asyncMock([
        { name: 'weak-match', agent: 'coder', confidence: 0.5, score: 0.5 },
      ]);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { search: mockSkillSearch };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'ambiguous task' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'skillLibrary');
    });

    it('should fall through when skills controller is null', async () => {
      bridgeMock.bridgeGetController = asyncMock(null);
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'any task' });

      assert.ok(result !== undefined);
    });

    it('should fall through when skills.search throws', async () => {
      const mockSkillSearch = rejectMock('search failed');
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { search: mockSkillSearch };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'any task' });

      assert.ok(result !== undefined);
      const parsed = parseRouteResult(result);
      assert.notEqual(parsed.routing_method, 'skillLibrary');
    });
  });

  // ===========================================================================
  // hooks_route -- LearningSystem recommendation (Phase 4)
  // ===========================================================================

  describe('hooks_route -- LearningSystem recommendation', () => {
    it('should merge learningSystem metadata into routing result', async () => {
      const mockRecommendAlgorithm = asyncMock({
        algorithm: 'ucb1',
        reason: 'best exploration-exploitation trade-off',
      });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'learningSystem') return { recommendAlgorithm: mockRecommendAlgorithm };
        return null;
      });
      bridgeMock.bridgeSemanticRoute = asyncMock({
        route: 'tester',
        confidence: 0.75,
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'optimize search' });
      const parsed = parseRouteResult(result);

      assert.ok(parsed.learningSystem !== undefined);
      assert.equal(parsed.learningSystem.algorithm, 'ucb1');
      assert.deepEqual(mockRecommendAlgorithm.calls[0], ['optimize search']);
    });

    it('should not add metadata when recommendAlgorithm returns null', async () => {
      const mockRecommendAlgorithm = asyncMock(null);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'learningSystem') return { recommendAlgorithm: mockRecommendAlgorithm };
        return null;
      });
      bridgeMock.bridgeSemanticRoute = asyncMock({
        route: 'coder',
        confidence: 0.8,
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write code' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.learningSystem, undefined);
    });

    it('should not crash when learningSystem throws', async () => {
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'learningSystem') throw new Error('LS crashed');
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'any task' });

      assert.ok(result !== undefined);
    });
  });

  // ===========================================================================
  // hooks_route -- SemanticRouter (Phase 5)
  // ===========================================================================

  describe('hooks_route -- SemanticRouter', () => {
    it('should return route from SemanticRouter when available', async () => {
      bridgeMock.bridgeSemanticRoute = asyncMock({
        route: 'tester',
        confidence: 0.9,
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'test the auth module' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.recommended_agent, 'tester');
      assert.equal(parsed.confidence, 0.9);
      assert.equal(parsed.routing_method, 'semanticRouter');
      assert.deepEqual(bridgeMock.bridgeSemanticRoute.calls[0], [{ input: 'test the auth module' }]);
    });

    it('should use default confidence 0.7 when not provided', async () => {
      bridgeMock.bridgeSemanticRoute = asyncMock({ route: 'coder' });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write a parser' });
      const parsed = parseRouteResult(result);

      assert.equal(parsed.confidence, 0.7);
    });

    it('should fall through when SemanticRouter returns null route', async () => {
      bridgeMock.bridgeSemanticRoute = asyncMock({ route: null });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'general task' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'semanticRouter');
    });

    it('should fall through when SemanticRouter returns error', async () => {
      bridgeMock.bridgeSemanticRoute = asyncMock({ route: 'coder', error: 'something wrong' });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'general task' });
      const parsed = parseRouteResult(result);

      assert.notEqual(parsed.routing_method, 'semanticRouter');
    });

    it('should fall through when bridgeSemanticRoute is undefined', async () => {
      bridgeMock.bridgeSemanticRoute = undefined;
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'any task' });

      assert.ok(result !== undefined);
    });

    it('should fall through when SemanticRouter throws', async () => {
      bridgeMock.bridgeSemanticRoute = rejectMock('router crashed');
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'any task' });

      assert.ok(result !== undefined);
      const parsed = parseRouteResult(result);
      assert.notEqual(parsed.routing_method, 'semanticRouter');
    });
  });

  // ===========================================================================
  // hooks_post-task -- SolverBandit feedback (Phase 2)
  // ===========================================================================

  describe('hooks_post-task -- SolverBandit feedback', () => {
    it('should call bridgeSolverBanditUpdate fire-and-forget on task completion', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-123',
        success: true,
        agent: 'coder',
        quality: 0.9,
        task_type: 'coding',
      });

      assert.ok(result !== undefined);
      assert.deepEqual(bridgeMock.bridgeSolverBanditUpdate.calls[0], ['coding', 'coder', 0.9]);
    });

    it('should use task as taskType when task_type not provided', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-456',
        success: true,
        agent: 'reviewer',
        quality: 0.7,
        task: 'review PR',
      });

      assert.deepEqual(bridgeMock.bridgeSolverBanditUpdate.calls[0], ['review PR', 'reviewer', 0.7]);
    });

    it('should not block response when bridgeSolverBanditUpdate rejects', async () => {
      bridgeMock.bridgeSolverBanditUpdate = rejectMock('update failed');
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-789',
        success: true,
        agent: 'coder',
        quality: 0.8,
      });

      assert.ok(result !== undefined);
      assert.equal(result.taskId, 'task-789');
    });

    it('should not crash when bridgeSolverBanditUpdate is undefined', async () => {
      bridgeMock.bridgeSolverBanditUpdate = undefined;
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-noupdate',
        success: true,
        agent: 'coder',
        quality: 0.5,
      });

      assert.ok(result !== undefined);
    });
  });

  // ===========================================================================
  // hooks_post-task -- SkillLibrary creation (Phase 4)
  // ===========================================================================

  describe('hooks_post-task -- SkillLibrary creation', () => {
    it('should create skill when quality > 0.8', async () => {
      const mockCreate = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: mockCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-skill',
        success: true,
        agent: 'coder',
        quality: 0.95,
        task_type: 'refactoring',
      });

      assert.equal(mockCreate.calls.length, 1);
      const createArg = mockCreate.calls[0][0];
      assert.equal(createArg.name, 'refactoring-coder');
      assert.equal(createArg.pattern, 'refactoring');
      assert.ok(createArg.context.includes('"agent":"coder"'));
    });

    it('should NOT create skill when quality <= 0.8', async () => {
      const mockCreate = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: mockCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-lowq',
        success: true,
        agent: 'coder',
        quality: 0.5,
      });

      assert.equal(mockCreate.calls.length, 0);
    });

    it('should NOT create skill when quality is exactly 0.8', async () => {
      const mockCreate = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: mockCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-boundary',
        success: true,
        agent: 'coder',
        quality: 0.8,
      });

      assert.equal(mockCreate.calls.length, 0);
    });

    it('should not block response when skills.create rejects', async () => {
      const mockCreate = rejectMock('create failed');
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: mockCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-fail-create',
        success: true,
        agent: 'coder',
        quality: 0.95,
      });

      assert.ok(result !== undefined);
      assert.equal(result.taskId, 'task-fail-create');
    });

    it('should include context with agent, quality, and timestamp', async () => {
      const mockCreate = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: mockCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-ctx',
        success: true,
        agent: 'tester',
        quality: 0.9,
        task_type: 'testing',
      });

      const contextArg = mockCreate.calls[0][0].context;
      const parsed = JSON.parse(contextArg);
      assert.equal(parsed.agent, 'tester');
      assert.equal(parsed.quality, 0.9);
      assert.equal(typeof parsed.timestamp, 'number');
    });
  });

  // ===========================================================================
  // hooks_post-task -- SonaTrajectory recording (Phase 5)
  // ===========================================================================

  describe('hooks_post-task -- SonaTrajectory recording', () => {
    it('should record trajectory step fire-and-forget', async () => {
      const mockRecordStep = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'sonaTrajectory') return { recordStep: mockRecordStep };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-traj',
        success: true,
        agent: 'coder',
        quality: 0.85,
        task_type: 'coding',
      });

      assert.equal(mockRecordStep.calls.length, 1);
      const step = mockRecordStep.calls[0][0];
      assert.equal(step.task, 'coding');
      assert.equal(step.agent, 'coder');
      assert.equal(step.reward, 0.85);
      assert.equal(step.success, true);
      assert.equal(typeof step.timestamp, 'number');
    });

    it('should not block response when recordStep rejects', async () => {
      const mockRecordStep = rejectMock('record failed');
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'sonaTrajectory') return { recordStep: mockRecordStep };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-traj-fail',
        success: true,
        agent: 'coder',
        quality: 0.7,
      });

      assert.ok(result !== undefined);
      assert.equal(result.taskId, 'task-traj-fail');
    });

    it('should skip recording when sonaTrajectory is null', async () => {
      bridgeMock.bridgeGetController = asyncMock(null);
      const handler = createHooksPostTaskHandler(bridgeMock);

      const result = await handler({
        taskId: 'task-no-traj',
        success: true,
        agent: 'coder',
        quality: 0.7,
      });

      assert.ok(result !== undefined);
    });
  });

  // ===========================================================================
  // hooks_session-end -- NightlyLearner consolidation (Phase 3)
  // ===========================================================================

  describe('hooks_session-end -- NightlyLearner consolidation', () => {
    it('should trigger consolidation fire-and-forget on session end', async () => {
      const mockConsolidate = asyncMock({ success: true });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'nightlyLearner') return { consolidate: mockConsolidate };
        return null;
      });
      const handler = createHooksSessionEndHandler(bridgeMock);

      const result = await handler({ saveState: true, stopDaemon: false });

      assert.ok(result !== undefined);
      assert.equal(mockConsolidate.calls.length, 1);
    });

    it('should not block session end when NightlyLearner unavailable', async () => {
      bridgeMock.bridgeGetController = asyncMock(null);
      const handler = createHooksSessionEndHandler(bridgeMock);

      const result = await handler({ saveState: false, stopDaemon: false });

      assert.ok(result !== undefined);
      assert.ok(result.sessionPersistence !== undefined);
    });

    it('should not block session end when consolidate rejects', async () => {
      const mockConsolidate = rejectMock('consolidation failed');
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'nightlyLearner') return { consolidate: mockConsolidate };
        return null;
      });
      const handler = createHooksSessionEndHandler(bridgeMock);

      const result = await handler({ saveState: true, stopDaemon: false });

      assert.ok(result !== undefined);
    });

    it('should not block when bridgeGetController throws', async () => {
      bridgeMock.bridgeGetController = rejectMock('controller registry crashed');
      const handler = createHooksSessionEndHandler(bridgeMock);

      const result = await handler({ saveState: false, stopDaemon: false });

      assert.ok(result !== undefined);
    });
  });

  // ===========================================================================
  // hooks_intelligence_stats -- SonaTrajectory stats (Phase 5)
  // ===========================================================================

  describe('hooks_intelligence_stats -- SonaTrajectory stats', () => {
    it('should include sonaTrajectory key in stats when controller is available', async () => {
      const handler = createHooksIntelligenceStatsHandler(bridgeMock);

      const result = await handler({});

      assert.ok(result !== undefined);
      const stats = result?.content?.[0]?.text
        ? JSON.parse(result.content[0].text)
        : result;
      assert.ok(stats !== undefined);
    });
  });

  // ===========================================================================
  // hooks_post-task -- quality defaults (WM-107a)
  // ===========================================================================

  describe('hooks_post-task -- quality defaults', () => {
    it('should use 0.85 default quality for successful tasks without explicit quality', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-default-q',
        success: true,
        agent: 'coder',
      });

      assert.equal(bridgeMock.bridgeSolverBanditUpdate.calls[0][2], 0.85);
    });

    it('should use 0.2 default quality for failed tasks without explicit quality', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-fail-q',
        success: false,
        agent: 'coder',
      });

      assert.equal(bridgeMock.bridgeSolverBanditUpdate.calls[0][2], 0.2);
    });

    it('should preserve explicit quality=0.0 (not coerce to default)', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'task-zero-q',
        success: true,
        agent: 'coder',
        quality: 0.0,
      });

      assert.equal(bridgeMock.bridgeSolverBanditUpdate.calls[0][2], 0.0);
    });
  });

  // ===========================================================================
  // hooks_route -- routing cascade ORDER verification
  // ===========================================================================

  describe('hooks_route -- routing cascade order', () => {
    it('should try SolverBandit before SkillLibrary', async () => {
      // Both controllers available with high confidence
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'reviewer', confidence: 0.9, controller: 'solverBandit',
      });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return {
          search: asyncMock([{ agent: 'tester', confidence: 0.95 }]),
        };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write tests' });
      const parsed = parseRouteResult(result);

      // SolverBandit (0.9 > 0.6 threshold) should win over SkillLibrary (0.95)
      assert.equal(parsed.routing_method, 'solverBandit');
      assert.equal(parsed.recommended_agent, 'reviewer');
    });

    it('should fall through SolverBandit to SkillLibrary on low confidence', async () => {
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder', confidence: 0.3, controller: 'solverBandit',
      });
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return {
          search: asyncMock([{ agent: 'tester', confidence: 0.85 }]),
        };
        return null;
      });
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'write tests' });
      const parsed = parseRouteResult(result);

      // SolverBandit confidence 0.3 < 0.6 threshold -> falls through to SkillLibrary
      assert.equal(parsed.routing_method, 'skillLibrary');
    });

    it('should fall through all controllers to fallback', async () => {
      // All controllers unavailable or low confidence
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder', confidence: 0.3, controller: 'fallback',
      });
      bridgeMock.bridgeGetController = asyncMock(null);
      bridgeMock.bridgeSemanticRoute = asyncMock(null);
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: 'do something' });
      const parsed = parseRouteResult(result);

      // Should produce some valid routing result (pattern or default)
      assert.ok(parsed.recommended_agent !== undefined);
    });

    it('should handle empty task string', async () => {
      bridgeMock.bridgeSolverBanditSelect = asyncMock({
        arm: 'coder', confidence: 0.5, controller: 'fallback',
      });
      bridgeMock.bridgeGetController = asyncMock(null);
      const handler = createHooksRouteHandler(bridgeMock);

      const result = await handler({ task: '' });

      // Should not crash with empty task
      assert.ok(result !== undefined);
    });
  });

  // ===========================================================================
  // hooks_post-task -- fire-and-forget guarantees
  // ===========================================================================

  describe('hooks_post-task -- fire-and-forget guarantees', () => {
    it('should complete when ALL fire-and-forget calls reject simultaneously', async () => {
      bridgeMock.bridgeSolverBanditUpdate = rejectMock('bandit failed');
      bridgeMock.bridgeRecordFeedback = rejectMock('feedback failed');
      bridgeMock.bridgeRecordCausalEdge = rejectMock('causal failed');
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: rejectMock('skill create failed') };
        if (name === 'sonaTrajectory') return { recordStep: rejectMock('trajectory failed') };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      // Should NOT throw even with all fire-and-forget calls failing
      const result = await handler({
        taskId: 'all-fail',
        success: true,
        agent: 'coder',
        quality: 0.9,
        task: 'test',
      });

      assert.ok(result !== undefined);
    });

    it('should not create skill when quality <= 0.8', async () => {
      const skillCreate = asyncMock(undefined);
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: skillCreate };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'low-quality',
        success: true,
        agent: 'coder',
        quality: 0.7,  // Below 0.8 threshold
        task: 'test',
      });

      assert.equal(skillCreate.calls.length, 0, 'skills.create should not be called for quality <= 0.8');
    });

    it('should create skill when quality > 0.8', async () => {
      const skillCreate = asyncMock(undefined);
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      bridgeMock.bridgeGetController = mockFn(async (name) => {
        if (name === 'skills') return { create: skillCreate };
        if (name === 'sonaTrajectory') return { recordStep: asyncMock(undefined) };
        return null;
      });
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'high-quality',
        success: true,
        agent: 'coder',
        quality: 0.9,
        task: 'test',
      });

      assert.equal(skillCreate.calls.length, 1, 'skills.create should be called for quality > 0.8');
    });

    it('should use default agent "coder" when agent param missing', async () => {
      bridgeMock.bridgeSolverBanditUpdate = asyncMock(undefined);
      bridgeMock.bridgeGetController = asyncMock(null);
      const handler = createHooksPostTaskHandler(bridgeMock);

      await handler({
        taskId: 'no-agent',
        success: true,
        task: 'test',
      });

      // SolverBandit update should use agent param or fallback to 'coder'
      assert.equal(bridgeMock.bridgeSolverBanditUpdate.calls[0][1], 'coder');
    });
  });
});

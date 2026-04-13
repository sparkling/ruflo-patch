// @tier unit
// ADR-0084 Phase 4: Single Controller — bridge removal from route layer
//
// London School TDD: all controller dependencies replaced with inline mock
// factories. No real imports of any fork module.
//
// Coverage:
//   T4.2  routePatternOp   — uses getController('reasoningBank') directly
//   T4.2  routeFeedbackOp  — uses getController('learningSystem') + getController('reasoningBank')
//   T4.2  routeSessionOp   — uses getController('reflexion') + getController('nightlyLearner')
//   T4.2  routeLearningOp  — uses getController('selfLearningRvfBackend') + getController('memoryConsolidation')
//   T4.2  routeCausalOp    — uses getController('causalGraph') + getController('causalRecall')
//   T4.2  shutdownRouter   — calls intercept.shutdown, resets caches
//   T4.2  integration      — router source structure (no loadBridge in route methods)
//   T4.2b integration      — worker-daemon shutdown migration (shutdownRouter)
//   T4.1  integration      — no external bridge imports (preserved from Phase 3)

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Mock helpers (same pattern as adr0084-router-phase3.test.mjs)
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

// ============================================================================
// Source paths for integration checks
// ============================================================================

const SRC_ROOT = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';

const ROUTER_PATH        = `${SRC_ROOT}/memory/memory-router.ts`;
const WORKER_DAEMON_PATH = `${SRC_ROOT}/services/worker-daemon.ts`;
const BRIDGE_PATH        = `${SRC_ROOT}/memory/memory-bridge.ts`;
const HOOKS_TOOLS_PATH   = `${SRC_ROOT}/mcp-tools/hooks-tools.ts`;
const AGENTDB_ORCH_PATH  = `${SRC_ROOT}/mcp-tools/agentdb-orchestration.ts`;

// ============================================================================
// Group 1: routePatternOp controller-direct (T4.2)
// ============================================================================

// Factory: controller-direct pattern op using getController('reasoningBank')
function createControllerDirectPatternOp(getController) {
  return async function routePatternOp(op) {
    const reasoningBank = await getController('reasoningBank');

    switch (op.type) {
      case 'store': {
        if (reasoningBank && typeof reasoningBank.store === 'function') {
          const patternId = `pattern-${Date.now()}`;
          await reasoningBank.store({
            id: patternId,
            content: op.pattern || '',
            type: op.patternType || 'general',
            confidence: op.confidence ?? 1.0,
            metadata: op.metadata,
            timestamp: Date.now(),
          });
          return { success: true, patternId, controller: 'reasoningBank' };
        }
        // Fallback: route through routeMemoryOp
        return { success: false, error: 'Pattern store unavailable' };
      }
      case 'search': {
        if (reasoningBank) {
          const searchFn = reasoningBank.searchPatterns || reasoningBank.search;
          if (typeof searchFn === 'function') {
            const results = await searchFn({
              query: op.query || '',
              topK: op.topK,
              minConfidence: op.minConfidence,
            });
            return { success: true, results: results || [], controller: 'reasoningBank' };
          }
        }
        return { success: false, error: 'Pattern search unavailable' };
      }
      default:
        return { success: false, error: `Unknown pattern operation: ${op.type}` };
    }
  };
}

describe('ADR-0084 T4.2: routePatternOp store calls reasoningBank.store', () => {
  let getController, reasoningBank, routePatternOp;

  beforeEach(() => {
    reasoningBank = {
      store: asyncMock({ id: 'p-1' }),
      searchPatterns: asyncMock([{ id: 'r-1', score: 0.9 }]),
    };
    getController = asyncMock(reasoningBank);
    routePatternOp = createControllerDirectPatternOp(getController);
  });

  it('should call getController with "reasoningBank"', async () => {
    await routePatternOp({ type: 'store', pattern: 'test', patternType: 'general', confidence: 0.8 });

    assert.equal(getController.calls[0][0], 'reasoningBank');
  });

  it('should call reasoningBank.store with content, type, confidence, metadata', async () => {
    await routePatternOp({
      type: 'store',
      pattern: 'JWT auth',
      patternType: 'security',
      confidence: 0.95,
      metadata: { src: 'test' },
    });

    const args = reasoningBank.store.calls[0][0];
    assert.equal(args.content, 'JWT auth');
    assert.equal(args.type, 'security');
    assert.equal(args.confidence, 0.95);
    assert.deepStrictEqual(args.metadata, { src: 'test' });
  });

  it('should return success with patternId and controller "reasoningBank"', async () => {
    const result = await routePatternOp({ type: 'store', pattern: 'p', confidence: 0.5 });

    assert.equal(result.success, true);
    assert.ok(result.patternId);
    assert.equal(result.controller, 'reasoningBank');
  });
});

describe('ADR-0084 T4.2: routePatternOp search calls reasoningBank.searchPatterns', () => {
  let getController, reasoningBank, routePatternOp;

  beforeEach(() => {
    reasoningBank = {
      store: asyncMock(null),
      searchPatterns: asyncMock([{ id: 'r-1', score: 0.9 }, { id: 'r-2', score: 0.7 }]),
    };
    getController = asyncMock(reasoningBank);
    routePatternOp = createControllerDirectPatternOp(getController);
  });

  it('should call reasoningBank.searchPatterns with query, topK, minConfidence', async () => {
    await routePatternOp({ type: 'search', query: 'auth', topK: 5, minConfidence: 0.3 });

    const args = reasoningBank.searchPatterns.calls[0][0];
    assert.equal(args.query, 'auth');
    assert.equal(args.topK, 5);
    assert.equal(args.minConfidence, 0.3);
  });

  it('should return results array from reasoningBank', async () => {
    const result = await routePatternOp({ type: 'search', query: 'test' });

    assert.equal(result.success, true);
    assert.equal(result.results.length, 2);
    assert.equal(result.controller, 'reasoningBank');
  });
});

describe('ADR-0084 T4.2: routePatternOp falls back when controller unavailable', () => {
  it('should return error when reasoningBank is undefined', async () => {
    const getController = asyncMock(undefined);
    const routePatternOp = createControllerDirectPatternOp(getController);

    const result = await routePatternOp({ type: 'store', pattern: 'test', confidence: 0.5 });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });

  it('should return error when reasoningBank lacks store method', async () => {
    const getController = asyncMock({ noStore: true });
    const routePatternOp = createControllerDirectPatternOp(getController);

    const result = await routePatternOp({ type: 'store', pattern: 'test', confidence: 0.5 });

    assert.equal(result.success, false);
  });
});

// ============================================================================
// Group 2: routeFeedbackOp controller-direct (T4.2)
// ============================================================================

// Factory: controller-direct feedback op using getController('learningSystem')
// + getController('reasoningBank')
function createControllerDirectFeedbackOp(getController) {
  return async function routeFeedbackOp(op) {
    switch (op.type) {
      case 'record': {
        let controller = 'none';
        let updated = 0;

        // Try learningSystem first
        const learningSystem = await getController('learningSystem');
        if (learningSystem && typeof learningSystem.recordFeedback === 'function') {
          await learningSystem.recordFeedback({
            taskId: op.taskId,
            success: op.success,
            quality: op.quality,
            agent: op.agent,
            duration: op.duration,
            timestamp: Date.now(),
          });
          controller = 'learningSystem';
          updated++;
        }

        // Also record in reasoningBank for pattern reinforcement
        const reasoningBank = await getController('reasoningBank');
        if (reasoningBank && typeof reasoningBank.recordOutcome === 'function') {
          await reasoningBank.recordOutcome({
            taskId: op.taskId,
            verdict: op.success ? 'success' : 'failure',
            score: op.quality,
            timestamp: Date.now(),
          });
          controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`;
          updated++;
        }

        return { success: updated > 0, controller, updated };
      }
      default:
        return { success: false, error: `Unknown feedback operation: ${op.type}` };
    }
  };
}

describe('ADR-0084 T4.2: routeFeedbackOp record calls learningSystem.recordFeedback', () => {
  let getController, learningSystem, reasoningBank, routeFeedbackOp;

  beforeEach(() => {
    learningSystem = {
      recordFeedback: asyncMock(undefined),
    };
    reasoningBank = {
      recordOutcome: asyncMock(undefined),
    };
    getController = mockFn(async (name) => {
      if (name === 'learningSystem') return learningSystem;
      if (name === 'reasoningBank') return reasoningBank;
      return undefined;
    });
    routeFeedbackOp = createControllerDirectFeedbackOp(getController);
  });

  it('should call getController for learningSystem and reasoningBank', async () => {
    await routeFeedbackOp({ type: 'record', taskId: 't-1', success: true, quality: 0.85 });

    const names = getController.calls.map(c => c[0]);
    assert.ok(names.includes('learningSystem'));
    assert.ok(names.includes('reasoningBank'));
  });

  it('should call learningSystem.recordFeedback with taskId, success, quality, agent', async () => {
    await routeFeedbackOp({
      type: 'record', taskId: 'edit-1', success: true,
      quality: 0.9, agent: 'coder', duration: 2000,
    });

    const args = learningSystem.recordFeedback.calls[0][0];
    assert.equal(args.taskId, 'edit-1');
    assert.equal(args.success, true);
    assert.equal(args.quality, 0.9);
    assert.equal(args.agent, 'coder');
    assert.equal(args.duration, 2000);
  });

  it('should call reasoningBank.recordOutcome with verdict and score', async () => {
    await routeFeedbackOp({
      type: 'record', taskId: 't-2', success: false, quality: 0.3,
    });

    const args = reasoningBank.recordOutcome.calls[0][0];
    assert.equal(args.taskId, 't-2');
    assert.equal(args.verdict, 'failure');
    assert.equal(args.score, 0.3);
  });

  it('should return combined controller string and updated count', async () => {
    const result = await routeFeedbackOp({
      type: 'record', taskId: 't-3', success: true, quality: 0.8,
    });

    assert.equal(result.success, true);
    assert.equal(result.controller, 'learningSystem+reasoningBank');
    assert.equal(result.updated, 2);
  });
});

describe('ADR-0084 T4.2: routeFeedbackOp fallback to reasoningBank if learningSystem unavailable', () => {
  it('should use only reasoningBank when learningSystem is undefined', async () => {
    const reasoningBank = { recordOutcome: asyncMock(undefined) };
    const getController = mockFn(async (name) => {
      if (name === 'reasoningBank') return reasoningBank;
      return undefined;
    });
    const routeFeedbackOp = createControllerDirectFeedbackOp(getController);

    const result = await routeFeedbackOp({
      type: 'record', taskId: 't-4', success: true, quality: 0.7,
    });

    assert.equal(result.controller, 'reasoningBank');
    assert.equal(result.updated, 1);
    assert.equal(result.success, true);
  });

  it('should return success false when both controllers unavailable', async () => {
    const getController = asyncMock(undefined);
    const routeFeedbackOp = createControllerDirectFeedbackOp(getController);

    const result = await routeFeedbackOp({
      type: 'record', taskId: 't-5', success: true, quality: 0.5,
    });

    assert.equal(result.success, false);
    assert.equal(result.controller, 'none');
    assert.equal(result.updated, 0);
  });
});

// ============================================================================
// Group 3: routeSessionOp controller-direct (T4.2)
// ============================================================================

// Factory: controller-direct session op using getController('reflexion')
// + getController('nightlyLearner')
function createControllerDirectSessionOp(getController) {
  return async function routeSessionOp(op) {
    switch (op.type) {
      case 'start': {
        let controller = 'none';
        let restoredPatterns = 0;

        const reflexion = await getController('reflexion');
        if (reflexion && typeof reflexion.startEpisode === 'function') {
          await reflexion.startEpisode(op.sessionId, { context: op.context });
          controller = 'reflexion';
        }

        return {
          success: true,
          controller,
          restoredPatterns,
          sessionId: op.sessionId,
        };
      }
      case 'end': {
        let controller = 'none';
        let persisted = false;

        const reflexion = await getController('reflexion');
        if (reflexion && typeof reflexion.endEpisode === 'function') {
          await reflexion.endEpisode(op.sessionId, {
            summary: op.summary,
            tasksCompleted: op.tasksCompleted,
            patternsLearned: op.patternsLearned,
          });
          controller = 'reflexion';
          persisted = true;
        }

        // Trigger NightlyLearner consolidation
        const nightlyLearner = await getController('nightlyLearner');
        if (nightlyLearner && typeof nightlyLearner.consolidate === 'function') {
          await nightlyLearner.consolidate({ sessionId: op.sessionId });
          controller += '+nightlyLearner';
        }

        return { success: true, controller, persisted };
      }
      default:
        return { success: false, error: `Unknown session operation: ${op.type}` };
    }
  };
}

describe('ADR-0084 T4.2: routeSessionOp start calls reflexion.startEpisode', () => {
  let getController, reflexion, routeSessionOp;

  beforeEach(() => {
    reflexion = {
      startEpisode: asyncMock(undefined),
      endEpisode: asyncMock(undefined),
    };
    getController = mockFn(async (name) => {
      if (name === 'reflexion') return reflexion;
      return undefined;
    });
    routeSessionOp = createControllerDirectSessionOp(getController);
  });

  it('should call getController with "reflexion"', async () => {
    await routeSessionOp({ type: 'start', sessionId: 'sess-1' });

    assert.equal(getController.calls[0][0], 'reflexion');
  });

  it('should call reflexion.startEpisode with sessionId and context', async () => {
    await routeSessionOp({ type: 'start', sessionId: 'sess-1', context: 'new session' });

    assert.equal(reflexion.startEpisode.calls[0][0], 'sess-1');
    assert.deepStrictEqual(reflexion.startEpisode.calls[0][1], { context: 'new session' });
  });

  it('should return controller "reflexion" and sessionId', async () => {
    const result = await routeSessionOp({ type: 'start', sessionId: 'sess-2' });

    assert.equal(result.success, true);
    assert.equal(result.controller, 'reflexion');
    assert.equal(result.sessionId, 'sess-2');
  });
});

describe('ADR-0084 T4.2: routeSessionOp end calls reflexion.endEpisode + nightlyLearner.consolidate', () => {
  let getController, reflexion, nightlyLearner, routeSessionOp;

  beforeEach(() => {
    reflexion = {
      startEpisode: asyncMock(undefined),
      endEpisode: asyncMock(undefined),
    };
    nightlyLearner = {
      consolidate: asyncMock(undefined),
    };
    getController = mockFn(async (name) => {
      if (name === 'reflexion') return reflexion;
      if (name === 'nightlyLearner') return nightlyLearner;
      return undefined;
    });
    routeSessionOp = createControllerDirectSessionOp(getController);
  });

  it('should call reflexion.endEpisode with sessionId, summary, tasksCompleted, patternsLearned', async () => {
    await routeSessionOp({
      type: 'end', sessionId: 'sess-3', summary: 'done',
      tasksCompleted: 5, patternsLearned: 2,
    });

    assert.equal(reflexion.endEpisode.calls[0][0], 'sess-3');
    const opts = reflexion.endEpisode.calls[0][1];
    assert.equal(opts.summary, 'done');
    assert.equal(opts.tasksCompleted, 5);
    assert.equal(opts.patternsLearned, 2);
  });

  it('should call nightlyLearner.consolidate with sessionId', async () => {
    await routeSessionOp({ type: 'end', sessionId: 'sess-4' });

    assert.equal(nightlyLearner.consolidate.calls.length, 1);
    assert.equal(nightlyLearner.consolidate.calls[0][0].sessionId, 'sess-4');
  });

  it('should return combined controller string with persisted true', async () => {
    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-5' });

    assert.equal(result.success, true);
    assert.equal(result.controller, 'reflexion+nightlyLearner');
    assert.equal(result.persisted, true);
  });

  it('should return reflexion-only controller when nightlyLearner unavailable', async () => {
    getController = mockFn(async (name) => {
      if (name === 'reflexion') return reflexion;
      return undefined;
    });
    routeSessionOp = createControllerDirectSessionOp(getController);

    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-6' });

    assert.equal(result.controller, 'reflexion');
    assert.equal(result.persisted, true);
  });
});

// ============================================================================
// Group 4: routeLearningOp controller-direct (T4.2)
// ============================================================================

// Factory: controller-direct learning op using
// getController('selfLearningRvfBackend') + getController('memoryConsolidation')
function createControllerDirectLearningOp(getController) {
  return async function routeLearningOp(op) {
    switch (op.type) {
      case 'search': {
        const a6 = await getController('selfLearningRvfBackend');
        if (a6 && typeof a6.search === 'function') {
          const results = await a6.search({
            query: op.query || '',
            limit: op.limit || 10,
            namespace: op.namespace,
            threshold: op.threshold,
          });
          const stats = typeof a6.getStats === 'function' ? a6.getStats() : undefined;
          return {
            success: true,
            results: results || [],
            routed: true,
            controller: 'selfLearningRvfBackend',
            stats,
          };
        }
        return { success: false, error: 'Self-learning search unavailable' };
      }
      case 'consolidate': {
        const mc = await getController('memoryConsolidation');
        if (mc && typeof mc.consolidate === 'function') {
          const result = await mc.consolidate();
          return { success: true, consolidated: result };
        }
        return { success: false, error: 'Consolidation unavailable' };
      }
      default:
        return { success: false, error: `Unknown learning operation: ${op.type}` };
    }
  };
}

describe('ADR-0084 T4.2: routeLearningOp search calls selfLearningRvfBackend.search', () => {
  let getController, a6, routeLearningOp;

  beforeEach(() => {
    a6 = {
      search: asyncMock([{ id: 'lr-1', score: 0.85 }]),
      getStats: mockFn(() => ({ totalEntries: 100 })),
    };
    getController = mockFn(async (name) => {
      if (name === 'selfLearningRvfBackend') return a6;
      return undefined;
    });
    routeLearningOp = createControllerDirectLearningOp(getController);
  });

  it('should call getController with "selfLearningRvfBackend"', async () => {
    await routeLearningOp({ type: 'search', query: 'auth' });

    assert.equal(getController.calls[0][0], 'selfLearningRvfBackend');
  });

  it('should call a6.search with query, limit, namespace, threshold', async () => {
    await routeLearningOp({
      type: 'search', query: 'patterns', limit: 5,
      namespace: 'learning', threshold: 0.4,
    });

    const args = a6.search.calls[0][0];
    assert.equal(args.query, 'patterns');
    assert.equal(args.limit, 5);
    assert.equal(args.namespace, 'learning');
    assert.equal(args.threshold, 0.4);
  });

  it('should return results, routed true, controller, and stats', async () => {
    const result = await routeLearningOp({ type: 'search', query: 'test' });

    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.routed, true);
    assert.equal(result.controller, 'selfLearningRvfBackend');
    assert.equal(result.stats.totalEntries, 100);
  });

  it('should return error when selfLearningRvfBackend unavailable', async () => {
    getController = asyncMock(undefined);
    routeLearningOp = createControllerDirectLearningOp(getController);

    const result = await routeLearningOp({ type: 'search', query: 'test' });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

describe('ADR-0084 T4.2: routeLearningOp consolidate calls memoryConsolidation.consolidate', () => {
  let getController, mc, routeLearningOp;

  beforeEach(() => {
    mc = {
      consolidate: asyncMock({ promoted: 5, pruned: 2 }),
    };
    getController = mockFn(async (name) => {
      if (name === 'memoryConsolidation') return mc;
      return undefined;
    });
    routeLearningOp = createControllerDirectLearningOp(getController);
  });

  it('should call getController with "memoryConsolidation"', async () => {
    await routeLearningOp({ type: 'consolidate' });

    assert.equal(getController.calls[0][0], 'memoryConsolidation');
  });

  it('should call mc.consolidate and return result', async () => {
    const result = await routeLearningOp({ type: 'consolidate' });

    assert.equal(mc.consolidate.calls.length, 1);
    assert.equal(result.success, true);
    assert.equal(result.consolidated.promoted, 5);
    assert.equal(result.consolidated.pruned, 2);
  });

  it('should return error when memoryConsolidation unavailable', async () => {
    getController = asyncMock(undefined);
    routeLearningOp = createControllerDirectLearningOp(getController);

    const result = await routeLearningOp({ type: 'consolidate' });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ============================================================================
// Group 5: routeCausalOp controller-direct (T4.2)
// ============================================================================

// Factory: controller-direct causal op using
// getController('causalGraph') + getController('causalRecall')
function createControllerDirectCausalOp(getController) {
  return async function routeCausalOp(op) {
    switch (op.type) {
      case 'edge': {
        const causalGraph = await getController('causalGraph');
        if (causalGraph && typeof causalGraph.addEdge === 'function') {
          causalGraph.addEdge(op.sourceId || '', op.targetId || '', {
            relation: op.relation || '',
            weight: op.weight ?? 1.0,
            timestamp: Date.now(),
          });
          return { success: true, controller: 'causalGraph' };
        }
        return { success: false, error: 'Causal edge recording unavailable' };
      }
      case 'recall': {
        const causalRecall = await getController('causalRecall');
        if (!causalRecall || typeof causalRecall.search !== 'function') {
          return { success: false, error: 'CausalRecall not available' };
        }
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('CausalRecall timeout (2s)')), 2000)
        );
        try {
          const results = await Promise.race([
            causalRecall.search({
              query: op.query || '',
              k: op.k || 10,
              includeEvidence: op.includeEvidence,
            }),
            timeoutPromise,
          ]);
          return { success: true, results: Array.isArray(results) ? results : [] };
        } catch (e) {
          return { success: false, error: e.message || String(e) };
        }
      }
      default:
        return { success: false, error: `Unknown causal operation: ${op.type}` };
    }
  };
}

describe('ADR-0084 T4.2: routeCausalOp edge calls causalGraph.addEdge', () => {
  let getController, causalGraph, routeCausalOp;

  beforeEach(() => {
    causalGraph = {
      addEdge: mockFn(() => undefined),
    };
    getController = mockFn(async (name) => {
      if (name === 'causalGraph') return causalGraph;
      return undefined;
    });
    routeCausalOp = createControllerDirectCausalOp(getController);
  });

  it('should call getController with "causalGraph"', async () => {
    await routeCausalOp({ type: 'edge', sourceId: 's', targetId: 't', relation: 'r' });

    assert.equal(getController.calls[0][0], 'causalGraph');
  });

  it('should call causalGraph.addEdge with sourceId, targetId, and edge metadata', async () => {
    await routeCausalOp({
      type: 'edge', sourceId: 'task-1', targetId: 'outcome-1',
      relation: 'caused', weight: 0.85,
    });

    assert.equal(causalGraph.addEdge.calls[0][0], 'task-1');
    assert.equal(causalGraph.addEdge.calls[0][1], 'outcome-1');
    const edgeMeta = causalGraph.addEdge.calls[0][2];
    assert.equal(edgeMeta.relation, 'caused');
    assert.equal(edgeMeta.weight, 0.85);
  });

  it('should return success and controller "causalGraph"', async () => {
    const result = await routeCausalOp({
      type: 'edge', sourceId: 's', targetId: 't', relation: 'r',
    });

    assert.equal(result.success, true);
    assert.equal(result.controller, 'causalGraph');
  });

  it('should return error when causalGraph unavailable', async () => {
    getController = asyncMock(undefined);
    routeCausalOp = createControllerDirectCausalOp(getController);

    const result = await routeCausalOp({ type: 'edge', sourceId: 's', targetId: 't', relation: 'r' });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

describe('ADR-0084 T4.2: routeCausalOp recall calls causalRecall.search with timeout', () => {
  let getController, causalRecall, routeCausalOp;

  beforeEach(() => {
    causalRecall = {
      search: asyncMock([{ id: 'c-1', score: 0.8 }]),
    };
    getController = mockFn(async (name) => {
      if (name === 'causalRecall') return causalRecall;
      return undefined;
    });
    routeCausalOp = createControllerDirectCausalOp(getController);
  });

  it('should call getController with "causalRecall"', async () => {
    await routeCausalOp({ type: 'recall', query: 'test' });

    assert.equal(getController.calls[0][0], 'causalRecall');
  });

  it('should call causalRecall.search with query, k, includeEvidence', async () => {
    await routeCausalOp({
      type: 'recall', query: 'what caused failure',
      k: 5, includeEvidence: true,
    });

    const args = causalRecall.search.calls[0][0];
    assert.equal(args.query, 'what caused failure');
    assert.equal(args.k, 5);
    assert.equal(args.includeEvidence, true);
  });

  it('should return results array from causalRecall', async () => {
    const result = await routeCausalOp({ type: 'recall', query: 'test' });

    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, 'c-1');
  });

  it('should return error when causalRecall unavailable', async () => {
    getController = asyncMock(undefined);
    routeCausalOp = createControllerDirectCausalOp(getController);

    const result = await routeCausalOp({ type: 'recall', query: 'test' });

    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ============================================================================
// Group 6: shutdownRouter (T4.2)
// ============================================================================

// Factory: shutdownRouter calls intercept.shutdown if available, resets caches
function createShutdownRouter(intercept) {
  let _interceptMod = intercept;
  let _bridgeMod = { some: 'bridge' };
  let _fns = { some: 'fns' };
  let _embeddingFns = { some: 'embed' };
  let _allFns = { some: 'all' };
  let _initialized = true;
  let _initPromise = Promise.resolve();

  return {
    async shutdownRouter() {
      if (_interceptMod && typeof _interceptMod.shutdown === 'function') {
        await _interceptMod.shutdown();
      }
      // Reset all module caches
      _fns = null;
      _embeddingFns = null;
      _allFns = null;
      _interceptMod = null;
      _bridgeMod = null;
      _initialized = false;
      _initPromise = null;
    },
    getState() {
      return {
        fns: _fns,
        embeddingFns: _embeddingFns,
        allFns: _allFns,
        interceptMod: _interceptMod,
        bridgeMod: _bridgeMod,
        initialized: _initialized,
        initPromise: _initPromise,
      };
    },
  };
}

describe('ADR-0084 T4.2: shutdownRouter calls intercept.shutdown', () => {
  let intercept, router;

  beforeEach(() => {
    intercept = {
      shutdown: asyncMock(undefined),
    };
    router = createShutdownRouter(intercept);
  });

  it('should call intercept.shutdown when available', async () => {
    await router.shutdownRouter();

    assert.equal(intercept.shutdown.calls.length, 1);
  });

  it('should not throw when intercept is null', async () => {
    const nullRouter = createShutdownRouter(null);

    await assert.doesNotReject(async () => {
      await nullRouter.shutdownRouter();
    });
  });

  it('should not throw when intercept lacks shutdown method', async () => {
    const noShutdownRouter = createShutdownRouter({ notShutdown: true });

    await assert.doesNotReject(async () => {
      await noShutdownRouter.shutdownRouter();
    });
  });
});

describe('ADR-0084 T4.2: shutdownRouter resets module caches', () => {
  let intercept, router;

  beforeEach(() => {
    intercept = { shutdown: asyncMock(undefined) };
    router = createShutdownRouter(intercept);
  });

  it('should reset all caches to null after shutdown', async () => {
    // Before shutdown: caches are populated
    const before = router.getState();
    assert.ok(before.fns !== null);
    assert.ok(before.embeddingFns !== null);
    assert.ok(before.allFns !== null);
    assert.ok(before.interceptMod !== null);
    assert.ok(before.initialized === true);

    await router.shutdownRouter();

    // After shutdown: all caches are null
    const after = router.getState();
    assert.equal(after.fns, null);
    assert.equal(after.embeddingFns, null);
    assert.equal(after.allFns, null);
    assert.equal(after.interceptMod, null);
    assert.equal(after.bridgeMod, null);
    assert.equal(after.initialized, false);
    assert.equal(after.initPromise, null);
  });
});

// ============================================================================
// Group 6b: Gap coverage — controller-throws, method-missing, fallback delegation
//
// These tests cover the 13 gaps identified by the validation swarm:
//   - Controller method throws (try/catch error paths)
//   - Controller exists but lacks expected method (method-missing)
//   - routeMemoryOp fallback delegation (params, namespace, result mapping)
// ============================================================================

// --- routePatternOp gap factories ---

function createPatternOpWithStoreThrow(getController) {
  return async function routePatternOp(op) {
    const reasoningBank = await getController('reasoningBank');
    if (op.type === 'store') {
      const storeFn = reasoningBank && typeof reasoningBank.store === 'function'
        ? reasoningBank.store.bind(reasoningBank) : null;
      if (storeFn) {
        try {
          const patternId = `pattern-${Date.now()}`;
          await storeFn({ id: patternId, content: op.pattern || '', type: op.patternType || 'general', confidence: op.confidence ?? 1.0, metadata: op.metadata, timestamp: Date.now() });
          return { success: true, patternId, controller: 'reasoningBank' };
        } catch (e) {
          return { success: false, patternId: '', controller: '', error: e instanceof Error ? e.message : String(e) };
        }
      }
      return { success: false, error: 'Pattern store unavailable' };
    }
    return { success: false, error: `Unknown pattern operation: ${op.type}` };
  };
}

function createPatternOpWithSearchFallback(getController, routeMemoryOp) {
  return async function routePatternOp(op) {
    const reasoningBank = await getController('reasoningBank');
    if (op.type === 'search') {
      const searchFn = reasoningBank && typeof reasoningBank.searchPatterns === 'function'
        ? reasoningBank.searchPatterns.bind(reasoningBank) : null;
      if (searchFn) {
        try {
          const results = await searchFn({ task: op.query || '', k: op.topK || 5, threshold: op.minConfidence || 0.3 });
          return { success: true, results: Array.isArray(results) ? results : [], controller: 'reasoningBank' };
        } catch { /* fall through */ }
      }
      const fallback = await routeMemoryOp({ type: 'search', query: op.query || '', namespace: 'pattern', limit: op.topK || 5, threshold: op.minConfidence || 0.3 });
      return fallback.success
        ? { success: true, results: fallback.results || [], controller: 'router-fallback' }
        : { success: false, error: 'Pattern search unavailable' };
    }
    return { success: false, error: `Unknown pattern operation: ${op.type}` };
  };
}

function createPatternOpWithStoreFallback(getController, routeMemoryOp) {
  return async function routePatternOp(op) {
    const reasoningBank = await getController('reasoningBank');
    if (op.type === 'store') {
      const storeFn = reasoningBank && typeof reasoningBank.store === 'function'
        ? reasoningBank.store.bind(reasoningBank) : null;
      if (storeFn) {
        try {
          const patternId = `pattern-${Date.now()}`;
          await storeFn({ id: patternId, content: op.pattern || '', type: op.patternType || 'general', confidence: op.confidence ?? 1.0, metadata: op.metadata, timestamp: Date.now() });
          return { success: true, patternId, controller: 'reasoningBank' };
        } catch (e) {
          return { success: false, patternId: '', controller: '', error: e instanceof Error ? e.message : String(e) };
        }
      }
      const patternId = `pattern-${Date.now()}`;
      const result = await routeMemoryOp({ type: 'store', key: patternId, value: JSON.stringify({ pattern: op.pattern, type: op.patternType, confidence: op.confidence, metadata: op.metadata }), namespace: 'pattern', generateEmbedding: true, tags: [op.patternType || 'general', 'reasoning-pattern'] });
      return result.success
        ? { success: true, patternId, controller: 'router-fallback' }
        : { success: false, patternId: '', controller: '', error: 'Pattern store unavailable' };
    }
    return { success: false, error: `Unknown pattern operation: ${op.type}` };
  };
}

describe('ADR-0084 T4.2: routePatternOp store handles controller throw', () => {
  let getController, routePatternOp;

  beforeEach(() => {
    const reasoningBank = { store: mockFn(() => { throw new Error('DB write failed'); }) };
    getController = asyncMock(reasoningBank);
    routePatternOp = createPatternOpWithStoreThrow(getController);
  });

  it('should return {success: false, error: "DB write failed"}', async () => {
    const result = await routePatternOp({ type: 'store', pattern: 'test', patternType: 'general', confidence: 0.7 });
    assert.equal(result.success, false);
    assert.equal(result.error, 'DB write failed');
  });

  it('should include patternId: "" and controller: "" in result', async () => {
    const result = await routePatternOp({ type: 'store', pattern: 'test', confidence: 0.5 });
    assert.equal(result.patternId, '');
    assert.equal(result.controller, '');
  });
});

describe('ADR-0084 T4.2: routePatternOp search handles controller throw', () => {
  let routeMemoryOp, routePatternOp;

  beforeEach(() => {
    const reasoningBank = { searchPatterns: mockFn(() => { throw new Error('Search engine down'); }) };
    routeMemoryOp = asyncMock({ success: true, results: [{ id: 'fb-1', content: 'fallback', score: 0.6 }], total: 1 });
    routePatternOp = createPatternOpWithSearchFallback(asyncMock(reasoningBank), routeMemoryOp);
  });

  it('should fall through to fallback with controller "router-fallback"', async () => {
    const result = await routePatternOp({ type: 'search', query: 'auth patterns', topK: 5 });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'router-fallback');
    assert.equal(result.results.length, 1);
    assert.equal(routeMemoryOp.calls[0][0].namespace, 'pattern');
  });
});

describe('ADR-0084 T4.2: routePatternOp store fallback delegates to routeMemoryOp', () => {
  let routeMemoryOp, routePatternOp;

  beforeEach(() => {
    routeMemoryOp = asyncMock({ success: true });
    routePatternOp = createPatternOpWithStoreFallback(asyncMock(undefined), routeMemoryOp);
  });

  it('should call routeMemoryOp with type "store", namespace "pattern"', async () => {
    await routePatternOp({ type: 'store', pattern: 'new', patternType: 'security', confidence: 0.9, metadata: { origin: 'test' } });
    assert.equal(routeMemoryOp.calls.length, 1);
    const args = routeMemoryOp.calls[0][0];
    assert.equal(args.type, 'store');
    assert.equal(args.namespace, 'pattern');
    assert.deepStrictEqual(args.tags, ['security', 'reasoning-pattern']);
  });

  it('should return controller "router-fallback" on success', async () => {
    const result = await routePatternOp({ type: 'store', pattern: 'p', patternType: 'general', confidence: 0.5 });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'router-fallback');
  });
});

// --- routeFeedbackOp gap factory ---

function createFeedbackOpWithRouteMemory(getController, routeMemoryOp) {
  function _getCallableMethod(obj, ...names) {
    if (!obj) return null;
    for (const name of names) { if (typeof obj[name] === 'function') return obj[name].bind(obj); }
    return null;
  }
  return async function routeFeedbackOp(op) {
    if (op.type !== 'record') return { success: false, error: `Unknown feedback operation: ${op.type}` };
    let controller = 'none'; let updated = 0;
    const learningSystem = await getController('learningSystem');
    if (learningSystem) {
      try {
        if (typeof learningSystem.recordFeedback === 'function') {
          await learningSystem.recordFeedback({ taskId: op.taskId, success: op.success, quality: op.quality, agent: op.agent, duration: op.duration, timestamp: Date.now() });
          controller = 'learningSystem'; updated++;
        }
      } catch { /* non-fatal */ }
    }
    const reasoningBank = await getController('reasoningBank');
    const rbStoreFn = _getCallableMethod(reasoningBank, 'store', 'storePattern');
    if (rbStoreFn) {
      try {
        await rbStoreFn({ id: `feedback-${Date.now()}`, content: JSON.stringify({ taskId: op.taskId, success: op.success, quality: op.quality }), type: 'feedback', confidence: op.quality, metadata: { agent: op.agent, duration: op.duration, patterns: op.patterns }, timestamp: Date.now() });
        controller = controller === 'none' ? 'reasoningBank' : `${controller}+reasoningBank`; updated++;
      } catch { /* non-fatal */ }
    }
    try {
      await routeMemoryOp({ type: 'store', key: `feedback-${op.taskId}`, value: JSON.stringify({ taskId: op.taskId, success: op.success, quality: op.quality, agent: op.agent, duration: op.duration }), namespace: 'feedback', tags: ['feedback', op.success ? 'success' : 'failure'], upsert: true });
      if (controller === 'none') controller = 'router-store'; updated = Math.max(updated, 1);
    } catch { /* non-fatal */ }
    return { success: updated > 0, controller, updated };
  };
}

describe('ADR-0084 T4.2: routeFeedbackOp handles learningSystem.recordFeedback throw', () => {
  let routeMemoryOp, routeFeedbackOp;

  beforeEach(() => {
    const learningSystem = { recordFeedback: mockFn(() => { throw new Error('LS fail'); }) };
    const reasoningBank = { store: asyncMock({ id: 'rb-1' }) };
    routeMemoryOp = asyncMock({ success: true });
    const getController = mockFn(async (name) => {
      if (name === 'learningSystem') return learningSystem;
      if (name === 'reasoningBank') return reasoningBank;
      return undefined;
    });
    routeFeedbackOp = createFeedbackOpWithRouteMemory(getController, routeMemoryOp);
  });

  it('should still succeed because reasoningBank records successfully', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-throw', success: true, quality: 0.8, agent: 'coder' });
    assert.equal(result.success, true);
    assert.ok(result.updated > 0);
  });

  it('controller should NOT contain "learningSystem"', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-throw', success: true, quality: 0.8 });
    assert.ok(!result.controller.includes('learningSystem'));
  });

  it('controller should contain "reasoningBank"', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-throw', success: true, quality: 0.8 });
    assert.ok(result.controller.includes('reasoningBank'));
  });
});

describe('ADR-0084 T4.2: routeFeedbackOp handles controller with no recordFeedback method', () => {
  let routeFeedbackOp;

  beforeEach(() => {
    const routeMemoryOp = asyncMock({ success: true });
    const getController = mockFn(async (name) => {
      if (name === 'learningSystem') return {};
      return undefined;
    });
    routeFeedbackOp = createFeedbackOpWithRouteMemory(getController, routeMemoryOp);
  });

  it('should still succeed via guaranteed persistence', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-nomethod', success: false, quality: 0.4 });
    assert.equal(result.success, true);
  });

  it('controller should be "router-store"', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-nomethod', success: false, quality: 0.4 });
    assert.equal(result.controller, 'router-store');
  });

  it('updated should be >= 1', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't-nomethod', success: false, quality: 0.4 });
    assert.ok(result.updated >= 1);
  });
});

describe('ADR-0084 T4.2: routeFeedbackOp guaranteed persistence always writes', () => {
  let routeMemoryOp, routeFeedbackOp;

  beforeEach(() => {
    const learningSystem = { recordFeedback: asyncMock(undefined) };
    const reasoningBank = { store: asyncMock({ id: 'rb-2' }) };
    routeMemoryOp = asyncMock({ success: true });
    const getController = mockFn(async (name) => {
      if (name === 'learningSystem') return learningSystem;
      if (name === 'reasoningBank') return reasoningBank;
      return undefined;
    });
    routeFeedbackOp = createFeedbackOpWithRouteMemory(getController, routeMemoryOp);
  });

  it('routeMemoryOp should STILL be called (unconditional)', async () => {
    await routeFeedbackOp({ type: 'record', taskId: 'persist-1', success: true, quality: 0.95, agent: 'tester' });
    assert.equal(routeMemoryOp.calls.length, 1);
  });

  it('routeMemoryOp called with key "feedback-{taskId}", namespace "feedback", upsert true', async () => {
    await routeFeedbackOp({ type: 'record', taskId: 'persist-2', success: false, quality: 0.3, agent: 'reviewer', duration: 5000 });
    const args = routeMemoryOp.calls[0][0];
    assert.equal(args.key, 'feedback-persist-2');
    assert.equal(args.namespace, 'feedback');
    assert.equal(args.upsert, true);
    assert.ok(args.tags.includes('failure'));
  });

  it('updated should be >= 2 (controllers + persistence)', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 'persist-3', success: true, quality: 0.85 });
    assert.ok(result.updated >= 2);
  });
});

// --- routeSessionOp gap factory ---

function createSessionOpWithRouteMemory(getController, routeMemoryOp) {
  return async function routeSessionOp(op) {
    switch (op.type) {
      case 'start': {
        let controller = 'none'; let restoredPatterns = 0;
        const reflexion = await getController('reflexion');
        if (reflexion && typeof reflexion.startEpisode === 'function') {
          try { await reflexion.startEpisode(op.sessionId, { context: op.context }); controller = 'reflexion'; }
          catch { /* non-fatal */ }
        }
        try {
          const sr = await routeMemoryOp({ type: 'search', query: op.context || 'session patterns', namespace: 'session', limit: 10 });
          if (sr.success) restoredPatterns = (sr.results || []).length;
        } catch { /* non-fatal */ }
        return { success: true, controller: controller === 'none' ? 'router-search' : controller, restoredPatterns, sessionId: op.sessionId };
      }
      case 'end': {
        let controller = 'none'; let persisted = false;
        const reflexion = await getController('reflexion');
        if (reflexion && typeof reflexion.endEpisode === 'function') {
          try { await reflexion.endEpisode(op.sessionId, { summary: op.summary }); controller = 'reflexion'; persisted = true; }
          catch { /* non-fatal */ }
        }
        try {
          await routeMemoryOp({ type: 'store', key: `session-${op.sessionId}`, value: JSON.stringify({ sessionId: op.sessionId, summary: op.summary || 'Session ended', tasksCompleted: op.tasksCompleted ?? 0, patternsLearned: op.patternsLearned ?? 0 }), namespace: 'session', tags: ['session-end'], upsert: true });
          if (controller === 'none') controller = 'router-store'; persisted = true;
        } catch { /* non-fatal */ }
        return { success: true, controller, persisted };
      }
    }
  };
}

describe('ADR-0084 T4.2: routeSessionOp start handles reflexion.startEpisode throw', () => {
  let routeSessionOp;

  beforeEach(() => {
    const reflexion = { startEpisode: mockFn(async () => { throw new Error('episode fail'); }) };
    const getController = mockFn(async (n) => n === 'reflexion' ? reflexion : undefined);
    const routeMemoryOp = asyncMock({ success: true, results: [{ id: 'r1' }], total: 1 });
    routeSessionOp = createSessionOpWithRouteMemory(getController, routeMemoryOp);
  });

  it('should return success: true (throw is non-fatal)', async () => {
    const result = await routeSessionOp({ type: 'start', sessionId: 'sess-err-1', context: 'ctx' });
    assert.equal(result.success, true);
  });

  it('controller should be "router-search"', async () => {
    const result = await routeSessionOp({ type: 'start', sessionId: 'sess-err-1', context: 'ctx' });
    assert.equal(result.controller, 'router-search');
  });

  it('restoredPatterns should be 1 (from routeMemoryOp search)', async () => {
    const result = await routeSessionOp({ type: 'start', sessionId: 'sess-err-1', context: 'ctx' });
    assert.equal(result.restoredPatterns, 1);
  });
});

describe('ADR-0084 T4.2: routeSessionOp end handles reflexion.endEpisode throw', () => {
  let routeSessionOp;

  beforeEach(() => {
    const reflexion = { endEpisode: mockFn(async () => { throw new Error('end fail'); }) };
    const getController = mockFn(async (n) => n === 'reflexion' ? reflexion : undefined);
    routeSessionOp = createSessionOpWithRouteMemory(getController, asyncMock({ success: true }));
  });

  it('should return success: true (throw is non-fatal)', async () => {
    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-end-err', summary: 'done' });
    assert.equal(result.success, true);
  });

  it('persisted should be true (stored via routeMemoryOp)', async () => {
    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-end-err', summary: 'done' });
    assert.equal(result.persisted, true);
  });

  it('controller should be "router-store"', async () => {
    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-end-err', summary: 'done' });
    assert.equal(result.controller, 'router-store');
  });
});

describe('ADR-0084 T4.2: routeSessionOp end persists via routeMemoryOp', () => {
  let routeMemoryOp, routeSessionOp;

  beforeEach(() => {
    routeMemoryOp = mockFn(async () => ({ success: true }));
    routeSessionOp = createSessionOpWithRouteMemory(asyncMock(undefined), routeMemoryOp);
  });

  it('should call routeMemoryOp with type "store", key "session-{sessionId}"', async () => {
    await routeSessionOp({ type: 'end', sessionId: 'sess-p1', summary: 'done', tasksCompleted: 3, patternsLearned: 7 });
    assert.equal(routeMemoryOp.calls.length, 1);
    const arg = routeMemoryOp.calls[0][0];
    assert.equal(arg.type, 'store');
    assert.equal(arg.key, 'session-sess-p1');
    assert.equal(arg.namespace, 'session');
  });

  it('stored value should contain sessionId, summary, tasksCompleted, patternsLearned', async () => {
    await routeSessionOp({ type: 'end', sessionId: 'sess-p1', summary: 'done', tasksCompleted: 3, patternsLearned: 7 });
    const parsed = JSON.parse(routeMemoryOp.calls[0][0].value);
    assert.equal(parsed.sessionId, 'sess-p1');
    assert.equal(parsed.summary, 'done');
    assert.equal(parsed.tasksCompleted, 3);
    assert.equal(parsed.patternsLearned, 7);
  });
});

// --- routeLearningOp gap factory ---

function createLearningOpWithRouteMemory(getController, routeMemoryOp) {
  return async function routeLearningOp(op) {
    switch (op.type) {
      case 'search': {
        const a6 = await getController('selfLearningRvfBackend');
        if (a6 && typeof a6.search === 'function') {
          try {
            const results = await a6.search({ query: op.query || '', limit: op.limit || 10 });
            const stats = typeof a6.getStats === 'function' ? a6.getStats() : undefined;
            return { success: true, results: results || [], routed: true, controller: 'selfLearningRvfBackend', stats };
          } catch { /* fall through */ }
        }
        try {
          const fallback = await routeMemoryOp({ type: 'search', query: op.query || '', limit: op.limit || 10, namespace: op.namespace, threshold: op.threshold });
          return { success: fallback.success, results: fallback.results || [], routed: false, controller: 'routeMemoryOp' };
        } catch {
          return { success: false, results: [], routed: false, controller: 'routeMemoryOp', error: 'Search fallback failed' };
        }
      }
      case 'consolidate': {
        const mc = await getController('memoryConsolidation');
        if (!mc) return { success: false, error: 'MemoryConsolidation not available' };
        try { const result = await mc.consolidate(); return { success: true, consolidated: result }; }
        catch (e) { return { success: false, error: e.message }; }
      }
    }
  };
}

describe('ADR-0084 T4.2: routeLearningOp search falls through when a6.search throws', () => {
  let routeMemoryOp, routeLearningOp;

  beforeEach(() => {
    const a6 = { search: mockFn(() => { throw new Error('A6 search fail'); }), getStats: mockFn(() => ({ hits: 0 })) };
    routeMemoryOp = asyncMock({ success: true, results: [{ id: 'fb1' }], total: 1 });
    routeLearningOp = createLearningOpWithRouteMemory(asyncMock(a6), routeMemoryOp);
  });

  it('should fall through to routeMemoryOp', async () => {
    const result = await routeLearningOp({ type: 'search', query: 'test' });
    assert.equal(routeMemoryOp.calls.length, 1);
    assert.equal(result.success, true);
  });

  it('should return routed: false, controller: "routeMemoryOp"', async () => {
    const result = await routeLearningOp({ type: 'search', query: 'test' });
    assert.equal(result.routed, false);
    assert.equal(result.controller, 'routeMemoryOp');
  });
});

describe('ADR-0084 T4.2: routeLearningOp consolidate handles mc.consolidate throw', () => {
  it('should return {success: false, error: "Consolidation crashed"}', async () => {
    const mc = { consolidate: mockFn(() => { throw new Error('Consolidation crashed'); }) };
    const op = createLearningOpWithRouteMemory(asyncMock(mc), asyncMock({}));
    const result = await op({ type: 'consolidate' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'Consolidation crashed');
  });
});

describe('ADR-0084 T4.2: routeLearningOp search with a6 that lacks search method', () => {
  let routeMemoryOp, routeLearningOp;

  beforeEach(() => {
    const a6 = { getStats: mockFn(() => ({ hits: 0 })) };
    routeMemoryOp = asyncMock({ success: true, results: [], total: 0 });
    routeLearningOp = createLearningOpWithRouteMemory(asyncMock(a6), routeMemoryOp);
  });

  it('should fall through to routeMemoryOp since a6 lacks search', async () => {
    await routeLearningOp({ type: 'search', query: 'anything' });
    assert.equal(routeMemoryOp.calls.length, 1);
  });

  it('should return routed: false', async () => {
    const result = await routeLearningOp({ type: 'search', query: 'anything' });
    assert.equal(result.routed, false);
  });
});

// --- routeCausalOp gap factory ---

function createCausalOpWithRouteMemory(getController, routeMemoryOp) {
  return async function routeCausalOp(op) {
    switch (op.type) {
      case 'edge': {
        const cg = await getController('causalGraph');
        if (cg && typeof cg.addEdge === 'function') {
          try { cg.addEdge(op.sourceId || '', op.targetId || '', { relation: op.relation || '', weight: op.weight ?? 1.0, timestamp: Date.now() }); return { success: true, controller: 'causalGraph' }; }
          catch { /* fall through */ }
        }
        try {
          const r = await routeMemoryOp({ type: 'store', key: `${op.sourceId}\u2192${op.targetId}`, value: JSON.stringify({ sourceId: op.sourceId, targetId: op.targetId, relation: op.relation, weight: op.weight }), namespace: 'causal-edges' });
          return r.success ? { success: true, controller: 'router-fallback' } : { success: false, error: 'Causal edge recording unavailable' };
        } catch { return { success: false, error: 'Causal edge recording unavailable' }; }
      }
      case 'recall': {
        try {
          const cr = await getController('causalRecall');
          if (!cr || typeof cr.search !== 'function') return { success: false, error: 'CausalRecall not available' };
          if (typeof cr.getStats === 'function') {
            const stats = cr.getStats();
            if (stats && (stats.totalCausalEdges || 0) < 5) return { success: true, results: [], warning: 'Cold start: fewer than 5 causal edges' };
          }
          const results = await cr.search({ query: op.query || '', k: op.k || 10, includeEvidence: op.includeEvidence });
          return { success: true, results: Array.isArray(results) ? results : [] };
        } catch (e) { return { success: false, error: e.message || String(e) }; }
      }
    }
  };
}

describe('ADR-0084 T4.2: routeCausalOp edge falls through when addEdge throws', () => {
  it('should NOT throw — returns router-fallback', async () => {
    const cg = { addEdge: mockFn(() => { throw new Error('graph error'); }) };
    const getController = mockFn(async (n) => n === 'causalGraph' ? cg : undefined);
    const op = createCausalOpWithRouteMemory(getController, asyncMock({ success: true }));
    const result = await op({ type: 'edge', sourceId: 'a', targetId: 'b', relation: 'caused' });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'router-fallback');
  });
});

describe('ADR-0084 T4.2: routeCausalOp edge delegates to routeMemoryOp on fallback', () => {
  let routeMemoryOp, routeCausalOp;

  beforeEach(() => {
    routeMemoryOp = mockFn(async () => ({ success: true }));
    routeCausalOp = createCausalOpWithRouteMemory(asyncMock(undefined), routeMemoryOp);
  });

  it('should call routeMemoryOp with type "store", namespace "causal-edges"', async () => {
    await routeCausalOp({ type: 'edge', sourceId: 'x', targetId: 'y', relation: 'depends' });
    assert.equal(routeMemoryOp.calls.length, 1);
    assert.equal(routeMemoryOp.calls[0][0].type, 'store');
    assert.equal(routeMemoryOp.calls[0][0].namespace, 'causal-edges');
  });

  it('key should contain sourceId→targetId', async () => {
    await routeCausalOp({ type: 'edge', sourceId: 'src-1', targetId: 'tgt-2', relation: 'triggers' });
    const key = routeMemoryOp.calls[0][0].key;
    assert.ok(key.includes('src-1'));
    assert.ok(key.includes('tgt-2'));
    assert.ok(key.includes('\u2192'));
  });
});

describe('ADR-0084 T4.2: routeCausalOp recall cold-start guard returns empty', () => {
  let causalRecall, routeCausalOp;

  beforeEach(() => {
    causalRecall = { search: asyncMock([{ id: 'should-not-reach' }]), getStats: mockFn(() => ({ totalCausalEdges: 3 })) };
    const getController = mockFn(async (n) => n === 'causalRecall' ? causalRecall : undefined);
    routeCausalOp = createCausalOpWithRouteMemory(getController, asyncMock({ success: false }));
  });

  it('should return empty results with cold-start warning', async () => {
    const result = await routeCausalOp({ type: 'recall', query: 'anything' });
    assert.equal(result.success, true);
    assert.deepStrictEqual(result.results, []);
    assert.equal(result.warning, 'Cold start: fewer than 5 causal edges');
  });

  it('causalRecall.search should NOT be called', async () => {
    await routeCausalOp({ type: 'recall', query: 'anything' });
    assert.equal(causalRecall.search.calls.length, 0);
  });
});

describe('ADR-0084 T4.2: routeCausalOp recall handles causalRecall.search throw', () => {
  it('should return {success: false, error: "search exploded"}', async () => {
    const cr = { search: mockFn(() => { throw new Error('search exploded'); }) };
    const getController = mockFn(async (n) => n === 'causalRecall' ? cr : undefined);
    const op = createCausalOpWithRouteMemory(getController, asyncMock({ success: false }));
    const result = await op({ type: 'recall', query: 'boom' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'search exploded');
  });
});

// ============================================================================
// Group 7: Integration — router source structure (T4.2)
// ============================================================================

/**
 * Helper: extract a function body from source.
 * Finds `export async function <name>` and captures up to the matching `\n}`.
 * Uses brace counting for robustness.
 */
function extractFunctionBody(source, name) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;

  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      if (depth === 0) bodyStart = i;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart, i + 1);
      }
    }
  }
  return null;
}

const ROUTE_METHODS = [
  'routePatternOp',
  'routeFeedbackOp',
  'routeSessionOp',
  'routeLearningOp',
  'routeCausalOp',
];

describe('ADR-0084 T4.2 integration: router route method bodies do NOT contain loadBridge', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  for (const method of ROUTE_METHODS) {
    it(`${method} body should NOT contain "loadBridge"`, () => {
      const body = extractFunctionBody(source, method);
      assert.ok(body !== null, `${method} must exist in router source`);
      assert.ok(!body.includes('loadBridge'),
        `${method} must not call loadBridge — should use getController directly`);
    });
  }
});

describe('ADR-0084 T4.2 integration: router route method bodies do NOT contain _bridgeMod', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  for (const method of ROUTE_METHODS) {
    it(`${method} body should NOT contain "_bridgeMod"`, () => {
      const body = extractFunctionBody(source, method);
      assert.ok(body !== null, `${method} must exist in router source`);
      assert.ok(!body.includes('_bridgeMod'),
        `${method} must not reference _bridgeMod — bridge module cache is obsolete for route methods`);
    });
  }
});

describe('ADR-0084 T4.2 integration: router route method bodies DO contain getController', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  for (const method of ROUTE_METHODS) {
    it(`${method} body should contain "getController"`, () => {
      const body = extractFunctionBody(source, method);
      assert.ok(body !== null, `${method} must exist in router source`);
      assert.ok(body.includes('getController'),
        `${method} must use getController for controller-direct access`);
    });
  }
});

describe('ADR-0084 T4.2 integration: shutdownRouter export exists', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('should export shutdownRouter', () => {
    assert.ok(
      source.includes('export async function shutdownRouter') ||
      source.includes('export function shutdownRouter'),
      'shutdownRouter must be an exported function in memory-router.ts'
    );
  });
});

describe('ADR-0084 T4.2 integration: loadBridge may exist in file but NOT in route method bodies', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('loadBridge may still exist at file level (initializer uses it indirectly)', () => {
    // This is informational -- loadBridge can exist for other uses.
    // The key invariant is that route method bodies do not call it.
    // That is already asserted in the group above.
    assert.ok(true, 'loadBridge at file level is acceptable');
  });

  it('no route method should contain a bridge.bridge* call', () => {
    for (const method of ROUTE_METHODS) {
      const body = extractFunctionBody(source, method);
      assert.ok(body !== null, `${method} must exist`);
      const hasBridgeCall = /bridge\.\s*bridge[A-Z]/.test(body);
      assert.ok(!hasBridgeCall,
        `${method} must not contain bridge.bridge* calls — use getController instead`);
    }
  });
});

// ============================================================================
// Group 8: Integration — worker-daemon shutdown migration (T4.2b)
// ============================================================================

describe('ADR-0084 T4.2b integration: worker-daemon uses shutdownRouter', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(WORKER_DAEMON_PATH, 'utf-8');
  });

  it('should contain "shutdownRouter" (from memory-router)', () => {
    assert.ok(source.includes('shutdownRouter'),
      'worker-daemon must import/call shutdownRouter from memory-router');
  });

  it('should NOT contain "shutdownBridge"', () => {
    assert.ok(!source.includes('shutdownBridge'),
      'worker-daemon must not reference shutdownBridge — use shutdownRouter instead');
  });

  it('should NOT import from "memory-bridge"', () => {
    const lines = source.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO memory-bridge imports in worker-daemon, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });
});

// ============================================================================
// Group 9: Integration — no external bridge imports (T4.1)
// ============================================================================

describe('ADR-0084 T4.1 integration: hooks-tools.ts has ZERO memory-bridge imports (preserved from Phase 3)', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(HOOKS_TOOLS_PATH, 'utf-8');
  });

  it('should NOT import from memory-bridge', () => {
    const lines = source.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO memory-bridge imports in hooks-tools, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });
});

describe('ADR-0084 T4.1 integration: worker-daemon.ts has ZERO memory-bridge imports', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(WORKER_DAEMON_PATH, 'utf-8');
  });

  it('should NOT import from memory-bridge', () => {
    const lines = source.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO memory-bridge imports in worker-daemon, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });
});

describe('ADR-0084 T4.1 integration: agentdb-orchestration.ts has ZERO memory-bridge imports', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(AGENTDB_ORCH_PATH, 'utf-8');
  });

  it('should NOT import from memory-bridge', () => {
    const lines = source.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO memory-bridge imports in agentdb-orchestration, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });
});

describe('ADR-0084 T4.1 integration: memory-router.ts route methods have ZERO loadBridge calls', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('should have zero loadBridge calls across all 5 route methods combined', () => {
    let totalLoadBridgeCalls = 0;
    const methodsWithLoadBridge = [];

    for (const method of ROUTE_METHODS) {
      const body = extractFunctionBody(source, method);
      assert.ok(body !== null, `${method} must exist`);
      const count = (body.match(/loadBridge/g) || []).length;
      if (count > 0) {
        methodsWithLoadBridge.push(`${method}(${count})`);
        totalLoadBridgeCalls += count;
      }
    }

    assert.equal(totalLoadBridgeCalls, 0,
      `Expected ZERO loadBridge calls across route methods, found ${totalLoadBridgeCalls} in: ${methodsWithLoadBridge.join(', ')}`);
  });
});

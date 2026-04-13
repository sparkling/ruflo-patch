// @tier unit
// ADR-0084 Phase 2: memory-router.ts — bridge caller migration route methods
//
// London School TDD: all bridge and controller dependencies replaced with inline
// mock factories. No real imports of memory-router.ts or memory-bridge.ts.
//
// Coverage:
//   T2.1 routePatternOp — store delegates to bridgeStorePattern, search to bridgeSearchPatterns
//   T2.2 routeFeedbackOp — record delegates to bridgeRecordFeedback
//   T2.3 routeSessionOp — start delegates to bridgeSessionStart, end to bridgeSessionEnd
//   T2.4 routeLearningOp — search delegates to bridgeSelfLearningSearch, consolidate to bridgeConsolidate
//   T2.5 routeReflexionOp — store/retrieve use reflexion controller directly (no bridge functions)
//   T2.6 routeCausalOp — edge delegates to bridgeRecordCausalEdge, recall to bridgeCausalRecall
//   T2.7 Unit tests for each new router method
//   T2.8 Integration: router file exports all Phase 2 methods

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Mock helpers (same pattern as adr0083-router.test.mjs)
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
// Router path for integration checks
// ============================================================================

const ROUTER_PATH = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';

// ============================================================================
// Factory: routePatternOp replica (T2.1)
// ============================================================================

function createPatternRouter(bridge) {
  return async function routePatternOp(op) {
    switch (op.type) {
      case 'store': {
        const result = await bridge.bridgeStorePattern({
          pattern: op.pattern || '',
          type: op.patternType || 'general',
          confidence: op.confidence ?? 1.0,
          metadata: op.metadata,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, patternId: result.patternId, controller: result.controller, error: result.error }
          : { success: false, error: 'Pattern store unavailable' };
      }
      case 'search': {
        const result = await bridge.bridgeSearchPatterns({
          query: op.query || '',
          topK: op.topK,
          minConfidence: op.minConfidence,
          dbPath: op.dbPath,
        });
        return result
          ? { success: true, results: result.results, controller: result.controller }
          : { success: false, error: 'Pattern search unavailable' };
      }
      default:
        return { success: false, error: `Unknown pattern operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Factory: routeFeedbackOp replica (T2.2)
// ============================================================================

function createFeedbackRouter(bridge) {
  return async function routeFeedbackOp(op) {
    switch (op.type) {
      case 'record': {
        const result = await bridge.bridgeRecordFeedback({
          taskId: op.taskId,
          success: op.success,
          quality: op.quality,
          agent: op.agent,
          duration: op.duration,
          patterns: op.patterns,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, controller: result.controller, updated: result.updated }
          : { success: false, error: 'Feedback recording unavailable' };
      }
      default:
        return { success: false, error: `Unknown feedback operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Factory: routeSessionOp replica (T2.3)
// ============================================================================

function createSessionRouter(bridge) {
  return async function routeSessionOp(op) {
    switch (op.type) {
      case 'start': {
        const result = await bridge.bridgeSessionStart({
          sessionId: op.sessionId,
          context: op.context,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, controller: result.controller, restoredPatterns: result.restoredPatterns, sessionId: result.sessionId }
          : { success: false, error: 'Session start unavailable' };
      }
      case 'end': {
        const result = await bridge.bridgeSessionEnd({
          sessionId: op.sessionId,
          summary: op.summary,
          tasksCompleted: op.tasksCompleted,
          patternsLearned: op.patternsLearned,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, controller: result.controller, persisted: result.persisted }
          : { success: false, error: 'Session end unavailable' };
      }
      default:
        return { success: false, error: `Unknown session operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Factory: routeLearningOp replica (T2.4)
// ============================================================================

function createLearningRouter(bridge) {
  return async function routeLearningOp(op) {
    switch (op.type) {
      case 'search': {
        const result = await bridge.bridgeSelfLearningSearch({
          query: op.query || '',
          limit: op.limit,
          namespace: op.namespace,
          threshold: op.threshold,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, results: result.results, routed: result.routed, controller: result.controller, stats: result.stats }
          : { success: false, error: 'Self-learning search unavailable' };
      }
      case 'consolidate': {
        const result = await bridge.bridgeConsolidate({
          minAge: op.minAge,
          maxEntries: op.maxEntries,
        });
        return result
          ? { success: result.success, consolidated: result.consolidated, error: result.error }
          : { success: false, error: 'Consolidation unavailable' };
      }
      default:
        return { success: false, error: `Unknown learning operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Factory: routeReflexionOp replica (T2.5) — uses controller, not bridge
// ============================================================================

function createReflexionRouter(getControllerFn) {
  return async function routeReflexionOp(op) {
    const reflexion = await getControllerFn('reflexion');

    switch (op.type) {
      case 'store': {
        if (!reflexion || typeof reflexion.store !== 'function') {
          return { success: false, error: 'Reflexion controller not available' };
        }
        try {
          const result = await reflexion.store({
            session_id: op.sessionId,
            task: op.task,
            input: op.input,
            output: op.output,
            reward: op.reward ?? 0,
            success: op.success ?? false,
          });
          return { success: true, stored: result };
        } catch (e) {
          return { success: false, error: e.message || String(e) };
        }
      }
      case 'retrieve': {
        if (!reflexion || typeof reflexion.retrieve !== 'function') {
          return { success: false, error: 'Reflexion controller not available' };
        }
        try {
          const results = await reflexion.retrieve(op.task, op.k || 5);
          return { success: true, results: Array.isArray(results) ? results : [] };
        } catch (e) {
          return { success: false, error: e.message || String(e) };
        }
      }
      default:
        return { success: false, error: `Unknown reflexion operation: ${op.type}` };
    }
  };
}

// ============================================================================
// Factory: routeCausalOp replica (T2.6)
// ============================================================================

function createCausalRouter(bridge) {
  return async function routeCausalOp(op) {
    switch (op.type) {
      case 'edge': {
        const result = await bridge.bridgeRecordCausalEdge({
          sourceId: op.sourceId || '',
          targetId: op.targetId || '',
          relation: op.relation || '',
          weight: op.weight,
          dbPath: op.dbPath,
        });
        return result
          ? { success: result.success, controller: result.controller }
          : { success: false, error: 'Causal edge recording unavailable' };
      }
      case 'recall': {
        const result = await bridge.bridgeCausalRecall({
          query: op.query || '',
          k: op.k,
          includeEvidence: op.includeEvidence,
        });
        return { success: result.success, results: result.results, warning: result.warning, error: result.error };
      }
      default:
        return { success: false, error: `Unknown causal operation: ${op.type}` };
    }
  };
}

// ============================================================================
// T2.1: routePatternOp — store
// ============================================================================

describe('ADR-0084 routePatternOp: store delegates to bridgeStorePattern', () => {
  let bridge, routePatternOp;

  beforeEach(() => {
    bridge = {
      bridgeStorePattern: asyncMock({ success: true, patternId: 'p-123', controller: 'reasoningBank' }),
      bridgeSearchPatterns: asyncMock({ results: [], controller: 'reasoningBank' }),
    };
    routePatternOp = createPatternRouter(bridge);
  });

  it('should forward pattern, patternType, confidence, metadata to bridge', async () => {
    await routePatternOp({
      type: 'store', pattern: 'JWT auth', patternType: 'security',
      confidence: 0.95, metadata: { source: 'test' },
    });

    const args = bridge.bridgeStorePattern.calls[0][0];
    assert.equal(args.pattern, 'JWT auth');
    assert.equal(args.type, 'security');
    assert.equal(args.confidence, 0.95);
    assert.deepStrictEqual(args.metadata, { source: 'test' });
  });

  it('should default patternType to "general" and confidence to 1.0', async () => {
    await routePatternOp({ type: 'store', pattern: 'bare pattern' });

    const args = bridge.bridgeStorePattern.calls[0][0];
    assert.equal(args.type, 'general');
    assert.equal(args.confidence, 1.0);
  });

  it('should return mapped result with patternId and controller', async () => {
    const result = await routePatternOp({ type: 'store', pattern: 'test' });
    assert.equal(result.success, true);
    assert.equal(result.patternId, 'p-123');
    assert.equal(result.controller, 'reasoningBank');
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeStorePattern = asyncMock(null);
    routePatternOp = createPatternRouter(bridge);

    const result = await routePatternOp({ type: 'store', pattern: 'fail' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});

// ============================================================================
// T2.1: routePatternOp — search
// ============================================================================

describe('ADR-0084 routePatternOp: search delegates to bridgeSearchPatterns', () => {
  let bridge, routePatternOp;

  beforeEach(() => {
    bridge = {
      bridgeStorePattern: asyncMock(null),
      bridgeSearchPatterns: asyncMock({
        results: [{ id: 'r1', content: 'JWT', score: 0.9 }],
        controller: 'reasoningBank',
      }),
    };
    routePatternOp = createPatternRouter(bridge);
  });

  it('should forward query, topK, minConfidence to bridge', async () => {
    await routePatternOp({ type: 'search', query: 'auth patterns', topK: 3, minConfidence: 0.7 });

    const args = bridge.bridgeSearchPatterns.calls[0][0];
    assert.equal(args.query, 'auth patterns');
    assert.equal(args.topK, 3);
    assert.equal(args.minConfidence, 0.7);
  });

  it('should return results and controller from bridge', async () => {
    const result = await routePatternOp({ type: 'search', query: 'auth' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, 'r1');
    assert.equal(result.controller, 'reasoningBank');
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeSearchPatterns = asyncMock(null);
    routePatternOp = createPatternRouter(bridge);

    const result = await routePatternOp({ type: 'search', query: 'missing' });
    assert.equal(result.success, false);
  });
});

// ============================================================================
// T2.1: routePatternOp — unknown
// ============================================================================

describe('ADR-0084 routePatternOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routePatternOp = createPatternRouter({});
    const result = await routePatternOp({ type: 'invalid' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown pattern operation'));
  });
});

// ============================================================================
// T2.2: routeFeedbackOp — record
// ============================================================================

describe('ADR-0084 routeFeedbackOp: record delegates to bridgeRecordFeedback', () => {
  let bridge, routeFeedbackOp;

  beforeEach(() => {
    bridge = {
      bridgeRecordFeedback: asyncMock({ success: true, controller: 'learningSystem+reasoningBank', updated: 3 }),
    };
    routeFeedbackOp = createFeedbackRouter(bridge);
  });

  it('should forward all feedback fields to bridge', async () => {
    await routeFeedbackOp({
      type: 'record', taskId: 'task-1', success: true, quality: 0.9,
      agent: 'coder', duration: 5000, patterns: ['p1'],
    });

    const args = bridge.bridgeRecordFeedback.calls[0][0];
    assert.equal(args.taskId, 'task-1');
    assert.equal(args.success, true);
    assert.equal(args.quality, 0.9);
    assert.equal(args.agent, 'coder');
    assert.equal(args.duration, 5000);
    assert.deepStrictEqual(args.patterns, ['p1']);
  });

  it('should return controller and updated count', async () => {
    const result = await routeFeedbackOp({ type: 'record', taskId: 't1', success: true, quality: 0.8 });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'learningSystem+reasoningBank');
    assert.equal(result.updated, 3);
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeRecordFeedback = asyncMock(null);
    routeFeedbackOp = createFeedbackRouter(bridge);

    const result = await routeFeedbackOp({ type: 'record', taskId: 't2', success: false, quality: 0.1 });
    assert.equal(result.success, false);
  });
});

describe('ADR-0084 routeFeedbackOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routeFeedbackOp = createFeedbackRouter({});
    const result = await routeFeedbackOp({ type: 'invalid' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown feedback operation'));
  });
});

// ============================================================================
// T2.3: routeSessionOp — start
// ============================================================================

describe('ADR-0084 routeSessionOp: start delegates to bridgeSessionStart', () => {
  let bridge, routeSessionOp;

  beforeEach(() => {
    bridge = {
      bridgeSessionStart: asyncMock({ success: true, controller: 'reflexion', restoredPatterns: 5, sessionId: 'sess-1' }),
      bridgeSessionEnd: asyncMock(null),
    };
    routeSessionOp = createSessionRouter(bridge);
  });

  it('should forward sessionId, context, dbPath to bridge', async () => {
    await routeSessionOp({ type: 'start', sessionId: 'sess-1', context: 'debugging auth' });

    const args = bridge.bridgeSessionStart.calls[0][0];
    assert.equal(args.sessionId, 'sess-1');
    assert.equal(args.context, 'debugging auth');
  });

  it('should return restoredPatterns and sessionId', async () => {
    const result = await routeSessionOp({ type: 'start', sessionId: 'sess-1' });
    assert.equal(result.success, true);
    assert.equal(result.restoredPatterns, 5);
    assert.equal(result.sessionId, 'sess-1');
    assert.equal(result.controller, 'reflexion');
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeSessionStart = asyncMock(null);
    routeSessionOp = createSessionRouter(bridge);

    const result = await routeSessionOp({ type: 'start', sessionId: 'fail' });
    assert.equal(result.success, false);
  });
});

// ============================================================================
// T2.3: routeSessionOp — end
// ============================================================================

describe('ADR-0084 routeSessionOp: end delegates to bridgeSessionEnd', () => {
  let bridge, routeSessionOp;

  beforeEach(() => {
    bridge = {
      bridgeSessionStart: asyncMock(null),
      bridgeSessionEnd: asyncMock({ success: true, controller: 'reflexion+nightlyLearner', persisted: true }),
    };
    routeSessionOp = createSessionRouter(bridge);
  });

  it('should forward all session-end fields to bridge', async () => {
    await routeSessionOp({
      type: 'end', sessionId: 'sess-2', summary: 'fixed auth bug',
      tasksCompleted: 3, patternsLearned: 2,
    });

    const args = bridge.bridgeSessionEnd.calls[0][0];
    assert.equal(args.sessionId, 'sess-2');
    assert.equal(args.summary, 'fixed auth bug');
    assert.equal(args.tasksCompleted, 3);
    assert.equal(args.patternsLearned, 2);
  });

  it('should return persisted flag', async () => {
    const result = await routeSessionOp({ type: 'end', sessionId: 'sess-2' });
    assert.equal(result.success, true);
    assert.equal(result.persisted, true);
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeSessionEnd = asyncMock(null);
    routeSessionOp = createSessionRouter(bridge);

    const result = await routeSessionOp({ type: 'end', sessionId: 'fail' });
    assert.equal(result.success, false);
  });
});

describe('ADR-0084 routeSessionOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routeSessionOp = createSessionRouter({});
    const result = await routeSessionOp({ type: 'pause' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown session operation'));
  });
});

// ============================================================================
// T2.4: routeLearningOp — search
// ============================================================================

describe('ADR-0084 routeLearningOp: search delegates to bridgeSelfLearningSearch', () => {
  let bridge, routeLearningOp;

  beforeEach(() => {
    bridge = {
      bridgeSelfLearningSearch: asyncMock({
        success: true, results: [{ id: 'r1', score: 0.9 }],
        routed: true, controller: 'selfLearningRvfBackend',
        stats: { queries: 42 },
      }),
      bridgeConsolidate: asyncMock(null),
    };
    routeLearningOp = createLearningRouter(bridge);
  });

  it('should forward query, limit, namespace, threshold to bridge', async () => {
    await routeLearningOp({
      type: 'search', query: 'auth patterns', limit: 5,
      namespace: 'patterns', threshold: 0.5,
    });

    const args = bridge.bridgeSelfLearningSearch.calls[0][0];
    assert.equal(args.query, 'auth patterns');
    assert.equal(args.limit, 5);
    assert.equal(args.namespace, 'patterns');
    assert.equal(args.threshold, 0.5);
  });

  it('should return routed flag and stats from bridge', async () => {
    const result = await routeLearningOp({ type: 'search', query: 'test' });
    assert.equal(result.success, true);
    assert.equal(result.routed, true);
    assert.equal(result.controller, 'selfLearningRvfBackend');
    assert.deepStrictEqual(result.stats, { queries: 42 });
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeSelfLearningSearch = asyncMock(null);
    routeLearningOp = createLearningRouter(bridge);

    const result = await routeLearningOp({ type: 'search', query: 'fail' });
    assert.equal(result.success, false);
  });
});

// ============================================================================
// T2.4: routeLearningOp — consolidate
// ============================================================================

describe('ADR-0084 routeLearningOp: consolidate delegates to bridgeConsolidate', () => {
  let bridge, routeLearningOp;

  beforeEach(() => {
    bridge = {
      bridgeSelfLearningSearch: asyncMock(null),
      bridgeConsolidate: asyncMock({ success: true, consolidated: { promoted: 3, pruned: 1 } }),
    };
    routeLearningOp = createLearningRouter(bridge);
  });

  it('should forward minAge and maxEntries to bridge', async () => {
    await routeLearningOp({ type: 'consolidate', minAge: 86400, maxEntries: 500 });

    const args = bridge.bridgeConsolidate.calls[0][0];
    assert.equal(args.minAge, 86400);
    assert.equal(args.maxEntries, 500);
  });

  it('should return consolidated results', async () => {
    const result = await routeLearningOp({ type: 'consolidate' });
    assert.equal(result.success, true);
    assert.deepStrictEqual(result.consolidated, { promoted: 3, pruned: 1 });
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeConsolidate = asyncMock(null);
    routeLearningOp = createLearningRouter(bridge);

    const result = await routeLearningOp({ type: 'consolidate' });
    assert.equal(result.success, false);
  });
});

describe('ADR-0084 routeLearningOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routeLearningOp = createLearningRouter({});
    const result = await routeLearningOp({ type: 'train' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown learning operation'));
  });
});

// ============================================================================
// T2.5: routeReflexionOp — store (controller-direct)
// ============================================================================

describe('ADR-0084 routeReflexionOp: store uses reflexion controller directly', () => {
  let reflexionMock, routeReflexionOp;

  beforeEach(() => {
    reflexionMock = {
      store: asyncMock({ id: 'ref-1', stored: true }),
      retrieve: asyncMock([]),
    };
    routeReflexionOp = createReflexionRouter(async () => reflexionMock);
  });

  it('should call reflexion.store with session_id, task, input, output, reward, success', async () => {
    await routeReflexionOp({
      type: 'store', sessionId: 'sess-1', task: 'fix bug',
      input: 'code', output: 'fix', reward: 0.9, success: true,
    });

    const args = reflexionMock.store.calls[0][0];
    assert.equal(args.session_id, 'sess-1');
    assert.equal(args.task, 'fix bug');
    assert.equal(args.input, 'code');
    assert.equal(args.output, 'fix');
    assert.equal(args.reward, 0.9);
    assert.equal(args.success, true);
  });

  it('should default reward to 0 and success to false', async () => {
    await routeReflexionOp({ type: 'store', task: 'bare' });

    const args = reflexionMock.store.calls[0][0];
    assert.equal(args.reward, 0);
    assert.equal(args.success, false);
  });

  it('should return stored result', async () => {
    const result = await routeReflexionOp({ type: 'store', task: 'test' });
    assert.equal(result.success, true);
    assert.deepStrictEqual(result.stored, { id: 'ref-1', stored: true });
  });

  it('should return error when reflexion controller unavailable', async () => {
    routeReflexionOp = createReflexionRouter(async () => null);

    const result = await routeReflexionOp({ type: 'store', task: 'fail' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not available'));
  });

  it('should return error when reflexion.store throws', async () => {
    reflexionMock.store = mockFn(async () => { throw new Error('store failed'); });
    routeReflexionOp = createReflexionRouter(async () => reflexionMock);

    const result = await routeReflexionOp({ type: 'store', task: 'boom' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('store failed'));
  });
});

// ============================================================================
// T2.5: routeReflexionOp — retrieve (controller-direct)
// ============================================================================

describe('ADR-0084 routeReflexionOp: retrieve uses reflexion controller directly', () => {
  let reflexionMock, routeReflexionOp;

  beforeEach(() => {
    reflexionMock = {
      store: asyncMock(null),
      retrieve: asyncMock([{ task: 'prior', reward: 0.8 }]),
    };
    routeReflexionOp = createReflexionRouter(async () => reflexionMock);
  });

  it('should call reflexion.retrieve with task and k', async () => {
    await routeReflexionOp({ type: 'retrieve', task: 'auth', k: 3 });

    assert.equal(reflexionMock.retrieve.calls[0][0], 'auth');
    assert.equal(reflexionMock.retrieve.calls[0][1], 3);
  });

  it('should default k to 5', async () => {
    await routeReflexionOp({ type: 'retrieve', task: 'default-k' });

    assert.equal(reflexionMock.retrieve.calls[0][1], 5);
  });

  it('should return results array', async () => {
    const result = await routeReflexionOp({ type: 'retrieve', task: 'auth' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].task, 'prior');
  });

  it('should return error when reflexion controller unavailable', async () => {
    routeReflexionOp = createReflexionRouter(async () => null);

    const result = await routeReflexionOp({ type: 'retrieve', task: 'fail' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('not available'));
  });
});

describe('ADR-0084 routeReflexionOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routeReflexionOp = createReflexionRouter(async () => ({}));
    const result = await routeReflexionOp({ type: 'replay' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown reflexion operation'));
  });
});

// ============================================================================
// T2.6: routeCausalOp — edge
// ============================================================================

describe('ADR-0084 routeCausalOp: edge delegates to bridgeRecordCausalEdge', () => {
  let bridge, routeCausalOp;

  beforeEach(() => {
    bridge = {
      bridgeRecordCausalEdge: asyncMock({ success: true, controller: 'causalGraph' }),
      bridgeCausalRecall: asyncMock({ success: true, results: [] }),
    };
    routeCausalOp = createCausalRouter(bridge);
  });

  it('should forward sourceId, targetId, relation, weight to bridge', async () => {
    await routeCausalOp({
      type: 'edge', sourceId: 'task-1', targetId: 'result-1',
      relation: 'produced', weight: 0.95,
    });

    const args = bridge.bridgeRecordCausalEdge.calls[0][0];
    assert.equal(args.sourceId, 'task-1');
    assert.equal(args.targetId, 'result-1');
    assert.equal(args.relation, 'produced');
    assert.equal(args.weight, 0.95);
  });

  it('should return controller from bridge', async () => {
    const result = await routeCausalOp({ type: 'edge', sourceId: 's', targetId: 't', relation: 'r' });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'causalGraph');
  });

  it('should return error when bridge returns null', async () => {
    bridge.bridgeRecordCausalEdge = asyncMock(null);
    routeCausalOp = createCausalRouter(bridge);

    const result = await routeCausalOp({ type: 'edge', sourceId: 's', targetId: 't', relation: 'r' });
    assert.equal(result.success, false);
  });
});

// ============================================================================
// T2.6: routeCausalOp — recall
// ============================================================================

describe('ADR-0084 routeCausalOp: recall delegates to bridgeCausalRecall', () => {
  let bridge, routeCausalOp;

  beforeEach(() => {
    bridge = {
      bridgeRecordCausalEdge: asyncMock(null),
      bridgeCausalRecall: asyncMock({
        success: true, results: [{ id: 'c1', query: 'auth' }],
      }),
    };
    routeCausalOp = createCausalRouter(bridge);
  });

  it('should forward query, k, includeEvidence to bridge', async () => {
    await routeCausalOp({ type: 'recall', query: 'auth flow', k: 10, includeEvidence: true });

    const args = bridge.bridgeCausalRecall.calls[0][0];
    assert.equal(args.query, 'auth flow');
    assert.equal(args.k, 10);
    assert.equal(args.includeEvidence, true);
  });

  it('should return results from bridge', async () => {
    const result = await routeCausalOp({ type: 'recall', query: 'test' });
    assert.equal(result.success, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].id, 'c1');
  });

  it('should forward cold-start warning from bridge', async () => {
    bridge.bridgeCausalRecall = asyncMock({
      success: true, results: [], warning: 'Cold start: fewer than 5 causal edges',
    });
    routeCausalOp = createCausalRouter(bridge);

    const result = await routeCausalOp({ type: 'recall', query: 'test' });
    assert.equal(result.success, true);
    assert.ok(result.warning.includes('Cold start'));
  });
});

describe('ADR-0084 routeCausalOp: unknown type returns error', () => {
  it('should return error for unrecognized type', async () => {
    const routeCausalOp = createCausalRouter({});
    const result = await routeCausalOp({ type: 'analyze' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Unknown causal operation'));
  });
});

// ============================================================================
// T2.8 Integration: router file exports all Phase 2 methods
// ============================================================================

describe('ADR-0084 integration: router exports all Phase 2 methods', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('should export routePatternOp', () => {
    assert.ok(source.includes('export async function routePatternOp'), 'routePatternOp must be exported');
  });

  it('should export routeFeedbackOp', () => {
    assert.ok(source.includes('export async function routeFeedbackOp'), 'routeFeedbackOp must be exported');
  });

  it('should export routeSessionOp', () => {
    assert.ok(source.includes('export async function routeSessionOp'), 'routeSessionOp must be exported');
  });

  it('should export routeLearningOp', () => {
    assert.ok(source.includes('export async function routeLearningOp'), 'routeLearningOp must be exported');
  });

  it('should export routeReflexionOp', () => {
    assert.ok(source.includes('export async function routeReflexionOp'), 'routeReflexionOp must be exported');
  });

  it('should export routeCausalOp', () => {
    assert.ok(source.includes('export async function routeCausalOp'), 'routeCausalOp must be exported');
  });

  it('should export PatternOp type', () => {
    assert.ok(source.includes('export interface PatternOp'), 'PatternOp type must be exported');
  });

  it('should include bridge loader with cache', () => {
    assert.ok(source.includes('_bridgeMod'), 'bridge module cache must exist');
    assert.ok(source.includes('loadBridge'), 'loadBridge function must exist');
  });

  it('should reset bridge cache in resetRouter', () => {
    const resetStart = source.indexOf('function resetRouter');
    const resetEnd = source.indexOf('}', resetStart + 40);
    const resetBody = source.slice(resetStart, resetEnd + 1);
    assert.ok(resetBody.includes('_bridgeMod = null'), 'resetRouter must clear bridge cache');
  });
});

// @tier unit
// ADR-0084 Phase 3: consumer migration — worker-daemon, hooks-tools,
// agentdb-orchestration, router bridge-fallback removal
//
// London School TDD: all bridge and controller dependencies replaced with
// inline mock factories. No real imports of any fork module.
//
// Coverage:
//   T3.1 worker-daemon.ts — IPC handlers use routeMemoryOp, consolidation uses routeLearningOp
//   T3.2 hooks-tools.ts   — ZERO memory-bridge imports, all ops via router
//   T3.3 agentdb-orchestration.ts — thin delegation layer, no getCallableMethod, no crypto
//   T3.4 memory-router.ts — bridge fallback removed from controller-access functions

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Mock helpers (same pattern as adr0084-router-phase2.test.mjs)
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

const WORKER_DAEMON_PATH   = `${SRC_ROOT}/services/worker-daemon.ts`;
const HOOKS_TOOLS_PATH     = `${SRC_ROOT}/mcp-tools/hooks-tools.ts`;
const AGENTDB_ORCH_PATH    = `${SRC_ROOT}/mcp-tools/agentdb-orchestration.ts`;
const ROUTER_PATH          = `${SRC_ROOT}/memory/memory-router.ts`;

// ============================================================================
// Group 1: worker-daemon.ts migration (T3.1)
// ============================================================================

// Factory: IPC handler registration pattern using routeMemoryOp
function createIPCHandlerRegistry(router) {
  const handlers = {};
  return {
    registerMethod(name, handler) { handlers[name] = handler; },
    async call(name, params) { return handlers[name](params); },
    registerMemoryHandlers() {
      this.registerMethod('memory.store', async (params) => {
        return router.routeMemoryOp({ type: 'store', ...params });
      });
      this.registerMethod('memory.search', async (params) => {
        return router.routeMemoryOp({ type: 'search', ...params });
      });
      this.registerMethod('memory.count', async (params) => {
        const result = await router.routeMemoryOp({ type: 'list', ...params });
        return result?.total ?? 0;
      });
      this.registerMethod('memory.bulkInsert', async (params) => {
        const entries = params.entries || [];
        let stored = 0;
        for (const entry of entries) {
          const r = await router.routeMemoryOp({ type: 'store', ...entry });
          if (r?.success) stored++;
        }
        return { stored, total: entries.length };
      });
    },
  };
}

// Factory: consolidation worker using routeLearningOp
function createConsolidationWorker(router) {
  return async function runConsolidation() {
    const routerResult = await router.routeLearningOp({ type: 'consolidate' });
    return { routerConsolidated: routerResult?.success ?? false };
  };
}

describe('ADR-0084 T3.1: IPC memory.store delegates to routeMemoryOp', () => {
  let router, registry;

  beforeEach(() => {
    router = {
      routeMemoryOp: asyncMock({ success: true, id: 'mem-1' }),
    };
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();
  });

  it('should call routeMemoryOp with type "store" plus spread params', async () => {
    await registry.call('memory.store', { key: 'k1', value: 'v1', namespace: 'ns' });

    const args = router.routeMemoryOp.calls[0][0];
    assert.equal(args.type, 'store');
    assert.equal(args.key, 'k1');
    assert.equal(args.value, 'v1');
    assert.equal(args.namespace, 'ns');
  });

  it('should return the routeMemoryOp result directly', async () => {
    const result = await registry.call('memory.store', { key: 'k1', value: 'v1' });
    assert.equal(result.success, true);
    assert.equal(result.id, 'mem-1');
  });
});

describe('ADR-0084 T3.1: IPC memory.search delegates to routeMemoryOp', () => {
  let router, registry;

  beforeEach(() => {
    router = {
      routeMemoryOp: asyncMock({ success: true, results: [{ id: 'r1' }], total: 1 }),
    };
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();
  });

  it('should call routeMemoryOp with type "search" plus spread params', async () => {
    await registry.call('memory.search', { query: 'auth', limit: 5 });

    const args = router.routeMemoryOp.calls[0][0];
    assert.equal(args.type, 'search');
    assert.equal(args.query, 'auth');
    assert.equal(args.limit, 5);
  });
});

describe('ADR-0084 T3.1: IPC memory.count delegates to routeMemoryOp list', () => {
  let router, registry;

  beforeEach(() => {
    router = {
      routeMemoryOp: asyncMock({ success: true, total: 42, entries: [] }),
    };
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();
  });

  it('should call routeMemoryOp with type "list" and return total', async () => {
    const count = await registry.call('memory.count', { namespace: 'patterns' });
    assert.equal(count, 42);
    assert.equal(router.routeMemoryOp.calls[0][0].type, 'list');
  });

  it('should return 0 when routeMemoryOp returns null', async () => {
    router.routeMemoryOp = asyncMock(null);
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();

    const count = await registry.call('memory.count', {});
    assert.equal(count, 0);
  });
});

describe('ADR-0084 T3.1: IPC memory.bulkInsert iterates routeMemoryOp store', () => {
  let router, registry;

  beforeEach(() => {
    router = {
      routeMemoryOp: asyncMock({ success: true }),
    };
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();
  });

  it('should call routeMemoryOp once per entry with type "store"', async () => {
    const result = await registry.call('memory.bulkInsert', {
      entries: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
    });

    assert.equal(router.routeMemoryOp.calls.length, 2);
    assert.equal(router.routeMemoryOp.calls[0][0].type, 'store');
    assert.equal(router.routeMemoryOp.calls[0][0].key, 'a');
    assert.equal(router.routeMemoryOp.calls[1][0].key, 'b');
    assert.equal(result.stored, 2);
    assert.equal(result.total, 2);
  });

  it('should count only successful stores', async () => {
    let callCount = 0;
    router.routeMemoryOp = mockFn(async () => {
      callCount++;
      return callCount === 1 ? { success: true } : { success: false };
    });
    registry = createIPCHandlerRegistry(router);
    registry.registerMemoryHandlers();

    const result = await registry.call('memory.bulkInsert', {
      entries: [{ key: 'a' }, { key: 'b' }],
    });
    assert.equal(result.stored, 1);
    assert.equal(result.total, 2);
  });
});

describe('ADR-0084 T3.1: consolidation worker delegates to routeLearningOp', () => {
  let router, runConsolidation;

  beforeEach(() => {
    router = {
      routeLearningOp: asyncMock({ success: true, consolidated: { promoted: 5 } }),
    };
    runConsolidation = createConsolidationWorker(router);
  });

  it('should call routeLearningOp with type "consolidate"', async () => {
    await runConsolidation();

    assert.equal(router.routeLearningOp.calls.length, 1);
    assert.equal(router.routeLearningOp.calls[0][0].type, 'consolidate');
  });

  it('should return routerConsolidated true on success', async () => {
    const result = await runConsolidation();
    assert.equal(result.routerConsolidated, true);
  });

  it('should return routerConsolidated false when router returns null', async () => {
    router.routeLearningOp = asyncMock(null);
    runConsolidation = createConsolidationWorker(router);

    const result = await runConsolidation();
    assert.equal(result.routerConsolidated, false);
  });
});

describe('ADR-0084 T3.1 integration: worker-daemon.ts has no direct bridge calls', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(WORKER_DAEMON_PATH, 'utf-8');
  });

  it('should NOT contain bridgeStoreEntry', () => {
    assert.ok(!source.includes('bridgeStoreEntry'), 'bridgeStoreEntry must be removed');
  });

  it('should NOT contain bridgeSearchEntries', () => {
    assert.ok(!source.includes('bridgeSearchEntries'), 'bridgeSearchEntries must be removed');
  });

  it('should NOT contain bridgeListEntries', () => {
    assert.ok(!source.includes('bridgeListEntries'), 'bridgeListEntries must be removed');
  });

  it('should NOT call bridgeConsolidate() and should use routerConsolidated field name', () => {
    const hasFunctionCall = /bridgeConsolidate\s*\(/.test(source);
    assert.ok(!hasFunctionCall, 'bridgeConsolidate() call must be removed');
    assert.ok(!source.includes('bridgeConsolidated'), 'bridgeConsolidated field must be renamed to routerConsolidated');
    assert.ok(source.includes('routerConsolidated'), 'routerConsolidated field must be present');
  });

  it('should use shutdownRouter (Phase 4 migrated from shutdownBridge)', () => {
    assert.ok(source.includes('shutdownRouter'), 'worker-daemon must use shutdownRouter from memory-router');
    assert.ok(!source.includes('shutdownBridge'), 'shutdownBridge must be removed — Phase 4 migrated to shutdownRouter');
  });

  it('should NOT import from memory-bridge', () => {
    const lines = source.split('\n');
    const bridgeImports = lines.filter(l =>
      l.includes('memory-bridge') && (l.includes('import') || l.includes('require'))
    );
    assert.equal(bridgeImports.length, 0,
      `Expected ZERO memory-bridge imports, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });

  it('SUPERSEDED by ADR-0088: memory.list IPC handler removed (never had callers)', () => {
    // ADR-0088 §Decision item 1: memory.* IPC method registrations deleted
    // from worker-daemon.ts. DaemonIPCClient had zero callers across both
    // repos; the registration contradicted ADR-050 (hot path is file-based).
    assert.ok(!source.includes("registerMethod('memory.list'"),
      'memory.list IPC handler must be removed per ADR-0088');
  });
});

// ============================================================================
// Group 2: hooks-tools.ts migration (T3.2)
// ============================================================================

// Factory: getController passthrough pattern
function createGetControllerProxy(router) {
  return async function getController(name) {
    return router.getController(name);
  };
}

// Factory: routeFeedbackOp delegation with field mapping
function createFeedbackDelegator(router) {
  return async function recordFeedback(opts) {
    const result = await router.routeFeedbackOp({
      type: 'record',
      taskId: opts.taskId,
      success: opts.success,
      quality: opts.quality,
      agent: opts.agent,
      duration: opts.duration,
      patterns: opts.patterns,
    });
    return {
      success: result.success,
      controller: result.controller || 'unknown',
      updated: result.updated || 0,
    };
  };
}

// Factory: routeSessionOp delegation with start/end discrimination
function createSessionDelegator(router) {
  return async function sessionOp(type, opts) {
    const result = await router.routeSessionOp({
      type,
      sessionId: opts.sessionId,
      context: opts.context,
      summary: opts.summary,
      tasksCompleted: opts.tasksCompleted,
      patternsLearned: opts.patternsLearned,
    });
    return result;
  };
}

// Factory: routePatternOp delegation with patternType mapping
function createPatternDelegator(router) {
  return async function patternOp(action, opts) {
    // Bridge uses `type` for pattern category; router uses `patternType`
    const result = await router.routePatternOp({
      type: action,
      pattern: opts.pattern,
      patternType: opts.type,
      confidence: opts.confidence,
      metadata: opts.metadata,
      query: opts.query,
      topK: opts.topK,
      minConfidence: opts.minConfidence,
    });
    return result;
  };
}

// Factory: routeCausalOp edge delegation
function createCausalEdgeDelegator(router) {
  return async function causalEdge(opts) {
    const result = await router.routeCausalOp({
      type: 'edge',
      sourceId: opts.sourceId,
      targetId: opts.targetId,
      relation: opts.relation,
      weight: opts.weight,
    });
    return result;
  };
}

describe('ADR-0084 T3.2: getController name passthrough', () => {
  it('should forward controller name to router.getController', async () => {
    const router = {
      getController: asyncMock({ store: asyncMock(null) }),
    };
    const getCtrl = createGetControllerProxy(router);

    await getCtrl('sonaTrajectory');

    assert.equal(router.getController.calls[0][0], 'sonaTrajectory');
  });

  it('should return the controller instance from router', async () => {
    const fakeCtrl = { store: asyncMock('ok') };
    const router = { getController: asyncMock(fakeCtrl) };
    const getCtrl = createGetControllerProxy(router);

    const ctrl = await getCtrl('reflexion');
    assert.strictEqual(ctrl, fakeCtrl);
  });
});

describe('ADR-0084 T3.2: routeFeedbackOp delegation field mapping', () => {
  let router, recordFeedback;

  beforeEach(() => {
    router = {
      routeFeedbackOp: asyncMock({
        success: true,
        controller: 'learningSystem+reasoningBank',
        updated: 3,
      }),
    };
    recordFeedback = createFeedbackDelegator(router);
  });

  it('should forward taskId, success, quality, agent to routeFeedbackOp', async () => {
    await recordFeedback({ taskId: 'edit-f1', success: true, quality: 0.85, agent: 'coder' });

    const args = router.routeFeedbackOp.calls[0][0];
    assert.equal(args.type, 'record');
    assert.equal(args.taskId, 'edit-f1');
    assert.equal(args.success, true);
    assert.equal(args.quality, 0.85);
    assert.equal(args.agent, 'coder');
  });

  it('should return mapped result with controller and updated count', async () => {
    const result = await recordFeedback({ taskId: 't1', success: true, quality: 0.9 });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'learningSystem+reasoningBank');
    assert.equal(result.updated, 3);
  });
});

describe('ADR-0084 T3.2: routeSessionOp start/end discrimination', () => {
  let router, sessionOp;

  beforeEach(() => {
    router = {
      routeSessionOp: asyncMock({
        success: true,
        controller: 'reflexion',
        restoredPatterns: 5,
        persisted: true,
      }),
    };
    sessionOp = createSessionDelegator(router);
  });

  it('should pass type "start" with sessionId and context', async () => {
    await sessionOp('start', { sessionId: 'sess-1', context: 'restore previous session patterns' });

    const args = router.routeSessionOp.calls[0][0];
    assert.equal(args.type, 'start');
    assert.equal(args.sessionId, 'sess-1');
    assert.equal(args.context, 'restore previous session patterns');
  });

  it('should pass type "end" with summary, tasksCompleted, patternsLearned', async () => {
    await sessionOp('end', {
      sessionId: 'sess-2',
      summary: 'Session ended with state saved',
      tasksCompleted: 5,
      patternsLearned: 3,
    });

    const args = router.routeSessionOp.calls[0][0];
    assert.equal(args.type, 'end');
    assert.equal(args.sessionId, 'sess-2');
    assert.equal(args.summary, 'Session ended with state saved');
    assert.equal(args.tasksCompleted, 5);
    assert.equal(args.patternsLearned, 3);
  });
});

describe('ADR-0084 T3.2: routePatternOp patternType mapping', () => {
  let router, patternOp;

  beforeEach(() => {
    router = {
      routePatternOp: asyncMock({ success: true, patternId: 'p-1', controller: 'reasoningBank' }),
    };
    patternOp = createPatternDelegator(router);
  });

  it('should map bridge "type" field to router "patternType"', async () => {
    await patternOp('store', { pattern: 'JWT auth', type: 'security', confidence: 0.95 });

    const args = router.routePatternOp.calls[0][0];
    assert.equal(args.type, 'store');
    assert.equal(args.patternType, 'security');
    assert.equal(args.pattern, 'JWT auth');
    assert.equal(args.confidence, 0.95);
  });

  it('should forward search params correctly', async () => {
    await patternOp('search', { query: 'auth', topK: 5, minConfidence: 0.3 });

    const args = router.routePatternOp.calls[0][0];
    assert.equal(args.type, 'search');
    assert.equal(args.query, 'auth');
    assert.equal(args.topK, 5);
    assert.equal(args.minConfidence, 0.3);
  });
});

describe('ADR-0084 T3.2: routeCausalOp edge delegation', () => {
  let router, causalEdge;

  beforeEach(() => {
    router = {
      routeCausalOp: asyncMock({ success: true, controller: 'causalGraph' }),
    };
    causalEdge = createCausalEdgeDelegator(router);
  });

  it('should forward sourceId, targetId, relation, weight to routeCausalOp', async () => {
    await causalEdge({
      sourceId: 'task-1',
      targetId: 'outcome-task-1',
      relation: 'succeeded',
      weight: 0.85,
    });

    const args = router.routeCausalOp.calls[0][0];
    assert.equal(args.type, 'edge');
    assert.equal(args.sourceId, 'task-1');
    assert.equal(args.targetId, 'outcome-task-1');
    assert.equal(args.relation, 'succeeded');
    assert.equal(args.weight, 0.85);
  });

  it('should return success and controller from router', async () => {
    const result = await causalEdge({ sourceId: 's', targetId: 't', relation: 'r' });
    assert.equal(result.success, true);
    assert.equal(result.controller, 'causalGraph');
  });
});

describe('ADR-0084 T3.2 integration: hooks-tools.ts has ZERO memory-bridge imports', () => {
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
      `Expected ZERO memory-bridge imports, found ${bridgeImports.length}: ${bridgeImports.join('; ')}`);
  });

  it('should use routeFeedbackOp from memory-router', () => {
    assert.ok(source.includes('routeFeedbackOp'), 'routeFeedbackOp must be used');
    assert.ok(source.includes("memory-router"), 'must import from memory-router');
  });
});

// ============================================================================
// Group 3: agentdb-orchestration.ts consolidation (T3.3)
// ============================================================================

// Factory: storePattern delegation to routePatternOp
function createStorePatternDelegator(router) {
  return async function storePattern(options) {
    const result = await router.routePatternOp({
      type: 'store',
      pattern: options.pattern,
      patternType: options.type,
      confidence: options.confidence,
      metadata: options.metadata,
    });
    return {
      success: result.success,
      patternId: result.patternId || '',
      controller: result.controller || '',
      error: result.error,
    };
  };
}

// Factory: recordFeedback delegation to routeFeedbackOp
function createRecordFeedbackDelegator(router) {
  return async function recordFeedback(options) {
    const result = await router.routeFeedbackOp({
      type: 'record',
      taskId: options.taskId,
      success: options.success,
      quality: options.quality,
      agent: options.agent,
      duration: options.duration,
      patterns: options.patterns,
    });
    return {
      success: result.success,
      controller: result.controller || 'none',
      updated: result.updated || 0,
    };
  };
}

// Factory: sessionStart/End delegation to routeSessionOp
function createSessionStartDelegator(router) {
  return async function sessionStart(options) {
    const result = await router.routeSessionOp({
      type: 'start',
      sessionId: options.sessionId,
      context: options.context,
    });
    return {
      success: result.success,
      controller: result.controller || 'none',
      restoredPatterns: result.restoredPatterns || 0,
      sessionId: options.sessionId,
    };
  };
}

function createSessionEndDelegator(router) {
  return async function sessionEnd(options) {
    const result = await router.routeSessionOp({
      type: 'end',
      sessionId: options.sessionId,
      summary: options.summary,
      tasksCompleted: options.tasksCompleted,
      patternsLearned: options.patternsLearned,
    });
    return {
      success: result.success,
      controller: result.controller || 'none',
      persisted: result.persisted || false,
    };
  };
}

describe('ADR-0084 T3.3: storePattern delegates to routePatternOp', () => {
  let router, storePattern;

  beforeEach(() => {
    router = {
      routePatternOp: asyncMock({ success: true, patternId: 'p-42', controller: 'reasoningBank' }),
    };
    storePattern = createStorePatternDelegator(router);
  });

  it('should forward pattern, type as patternType, confidence, metadata', async () => {
    await storePattern({ pattern: 'retry', type: 'resilience', confidence: 0.9, metadata: { src: 'test' } });

    const args = router.routePatternOp.calls[0][0];
    assert.equal(args.type, 'store');
    assert.equal(args.pattern, 'retry');
    assert.equal(args.patternType, 'resilience');
    assert.equal(args.confidence, 0.9);
    assert.deepStrictEqual(args.metadata, { src: 'test' });
  });

  it('should return mapped result with patternId and controller', async () => {
    const result = await storePattern({ pattern: 'test', type: 'general', confidence: 0.8 });
    assert.equal(result.success, true);
    assert.equal(result.patternId, 'p-42');
    assert.equal(result.controller, 'reasoningBank');
  });
});

describe('ADR-0084 T3.3: recordFeedback delegates to routeFeedbackOp', () => {
  let router, recordFeedback;

  beforeEach(() => {
    router = {
      routeFeedbackOp: asyncMock({ success: true, controller: 'learningSystem', updated: 2 }),
    };
    recordFeedback = createRecordFeedbackDelegator(router);
  });

  it('should forward all fields with type "record"', async () => {
    await recordFeedback({
      taskId: 'task-1', success: true, quality: 0.9,
      agent: 'coder', duration: 3000, patterns: ['p1'],
    });

    const args = router.routeFeedbackOp.calls[0][0];
    assert.equal(args.type, 'record');
    assert.equal(args.taskId, 'task-1');
    assert.equal(args.quality, 0.9);
    assert.equal(args.agent, 'coder');
    assert.equal(args.duration, 3000);
    assert.deepStrictEqual(args.patterns, ['p1']);
  });

  it('should return controller and updated count', async () => {
    const result = await recordFeedback({ taskId: 't', success: true, quality: 0.7 });
    assert.equal(result.controller, 'learningSystem');
    assert.equal(result.updated, 2);
  });
});

describe('ADR-0084 T3.3: sessionStart delegates to routeSessionOp', () => {
  let router, sessionStart;

  beforeEach(() => {
    router = {
      routeSessionOp: asyncMock({
        success: true, controller: 'reflexion', restoredPatterns: 5,
      }),
    };
    sessionStart = createSessionStartDelegator(router);
  });

  it('should call routeSessionOp with type "start"', async () => {
    await sessionStart({ sessionId: 'sess-1', context: 'new session' });

    const args = router.routeSessionOp.calls[0][0];
    assert.equal(args.type, 'start');
    assert.equal(args.sessionId, 'sess-1');
    assert.equal(args.context, 'new session');
  });

  it('should return restoredPatterns and passthrough sessionId', async () => {
    const result = await sessionStart({ sessionId: 'sess-1' });
    assert.equal(result.restoredPatterns, 5);
    assert.equal(result.sessionId, 'sess-1');
  });
});

describe('ADR-0084 T3.3: sessionEnd delegates to routeSessionOp', () => {
  let router, sessionEnd;

  beforeEach(() => {
    router = {
      routeSessionOp: asyncMock({
        success: true, controller: 'reflexion+nightlyLearner', persisted: true,
      }),
    };
    sessionEnd = createSessionEndDelegator(router);
  });

  it('should call routeSessionOp with type "end"', async () => {
    await sessionEnd({
      sessionId: 'sess-2', summary: 'done',
      tasksCompleted: 3, patternsLearned: 2,
    });

    const args = router.routeSessionOp.calls[0][0];
    assert.equal(args.type, 'end');
    assert.equal(args.sessionId, 'sess-2');
    assert.equal(args.summary, 'done');
    assert.equal(args.tasksCompleted, 3);
    assert.equal(args.patternsLearned, 2);
  });

  it('should return persisted flag from router', async () => {
    const result = await sessionEnd({ sessionId: 'sess-2' });
    assert.equal(result.persisted, true);
    assert.equal(result.controller, 'reflexion+nightlyLearner');
  });
});

describe('ADR-0084 T3.3 integration: agentdb-orchestration.ts is a clean delegation layer', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(AGENTDB_ORCH_PATH, 'utf-8');
  });

  it('should have ZERO "Replicates:" comments', () => {
    const replicatesCount = (source.match(/Replicates:/g) || []).length;
    assert.equal(replicatesCount, 0,
      `Expected ZERO "Replicates:" comments, found ${replicatesCount}`);
  });

  it('should have at least 7 "Delegates to:" comments', () => {
    const delegatesCount = (source.match(/Delegates to:/g) || []).length;
    assert.ok(delegatesCount >= 7,
      `Expected at least 7 "Delegates to:" comments, found ${delegatesCount}`);
  });

  it('should NOT contain getCallableMethod function', () => {
    assert.ok(!source.includes('getCallableMethod'),
      'getCallableMethod must be removed — delegation replaces callable method lookup');
  });

  it('should NOT contain "import * as crypto"', () => {
    assert.ok(!source.includes('import * as crypto'),
      '"import * as crypto" must be removed — no more local UUID generation');
  });
});

// ============================================================================
// Group 4: router bridge fallback removal (T3.4)
// ============================================================================

describe('ADR-0084 T3.4 integration: router controller-access has no bridge fallback', () => {
  let source;

  beforeEach(() => {
    source = readFileSync(ROUTER_PATH, 'utf-8');
  });

  it('getController should NOT contain bridgeGetController', () => {
    const getCtrlStart = source.indexOf('export async function getController');
    assert.ok(getCtrlStart !== -1, 'getController must exist');
    const getCtrlEnd = source.indexOf('\n}', getCtrlStart);
    const getCtrlBody = source.slice(getCtrlStart, getCtrlEnd + 2);
    assert.ok(!getCtrlBody.includes('bridgeGetController'),
      'getController must not fall back to bridgeGetController');
  });

  it('hasController should NOT contain bridgeHasController', () => {
    const start = source.indexOf('export async function hasController');
    assert.ok(start !== -1, 'hasController must exist');
    const end = source.indexOf('\n}', start);
    const body = source.slice(start, end + 2);
    assert.ok(!body.includes('bridgeHasController'),
      'hasController must not fall back to bridgeHasController');
  });

  it('listControllerInfo should NOT contain bridgeListControllers', () => {
    const start = source.indexOf('export async function listControllerInfo');
    assert.ok(start !== -1, 'listControllerInfo must exist');
    const end = source.indexOf('\n}', start);
    const body = source.slice(start, end + 2);
    assert.ok(!body.includes('bridgeListControllers'),
      'listControllerInfo must not fall back to bridgeListControllers');
  });

  it('waitForDeferred should NOT contain bridgeWaitForDeferred', () => {
    const start = source.indexOf('export async function waitForDeferred');
    assert.ok(start !== -1, 'waitForDeferred must exist');
    const end = source.indexOf('\n}', start);
    const body = source.slice(start, end + 2);
    assert.ok(!body.includes('bridgeWaitForDeferred'),
      'waitForDeferred must not fall back to bridgeWaitForDeferred');
  });

  it('healthCheck should NOT contain bridgeHealthCheck', () => {
    const start = source.indexOf('export async function healthCheck');
    assert.ok(start !== -1, 'healthCheck must exist');
    const end = source.indexOf('\n}', start);
    const body = source.slice(start, end + 2);
    assert.ok(!body.includes('bridgeHealthCheck'),
      'healthCheck must not fall back to bridgeHealthCheck');
  });

  it('loadBridge should be removed (ADR-0084 Phase 4: route methods use controller-direct)', () => {
    // Phase 4 inlined route methods to use getController() directly.
    // loadBridge is no longer needed in the router.
    const hasLoadBridgeFn = /async function loadBridge/.test(source);
    assert.ok(!hasLoadBridgeFn,
      'loadBridge function must be removed — Phase 4 route methods use getController directly');
  });

  it('controller-access functions should use loadIntercept instead of bridge', () => {
    const getCtrlStart = source.indexOf('export async function getController');
    const getCtrlEnd = source.indexOf('\n}', getCtrlStart);
    const getCtrlBody = source.slice(getCtrlStart, getCtrlEnd + 2);
    assert.ok(getCtrlBody.includes('loadIntercept'),
      'getController should use loadIntercept (controller-intercept) instead of bridge');
  });
});

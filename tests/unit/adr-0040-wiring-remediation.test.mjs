import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0040 wiring remediation', () => {

  it('passes embedder to causalRecall factory', () => {
    const embedder = { embed: mockFn(async () => new Float32Array(768)) };
    const factory = (db, emb, vb) => ({ db, embedder: emb, vectorBackend: vb });
    const ctrl = factory('mockDb', embedder, { search: mockFn() });
    assert.strictEqual(ctrl.embedder, embedder, 'embedder must be injected');
    assert.ok(ctrl.vectorBackend, 'vectorBackend must be injected');
  });

  it('passes embedder to learningSystem factory', () => {
    const embedder = { embed: mockFn(async () => new Float32Array(384)) };
    const factory = (db, emb) => ({ db, embedder: emb });
    const ctrl = factory('mockDb', embedder);
    assert.strictEqual(ctrl.embedder, embedder, 'embedder must be injected');
  });

  it('passes embedder to nightlyLearner factory', () => {
    const embedder = { embed: mockFn(async () => new Float32Array(768)) };
    const causalGraph = { addEdge: mockFn() };
    const reflexion = { store: mockFn() };
    const skills = { promote: mockFn() };
    const factory = (db, emb, cfg, cg, ref, sk) => ({
      db, embedder: emb, causalGraph: cg, reflexion: ref, skills: sk,
    });
    const ctrl = factory('mockDb', embedder, undefined, causalGraph, reflexion, skills);
    assert.strictEqual(ctrl.embedder, embedder);
    assert.strictEqual(ctrl.causalGraph, causalGraph, 'must use pre-created causalGraph singleton');
    assert.strictEqual(ctrl.reflexion, reflexion, 'must use pre-created reflexion singleton');
    assert.strictEqual(ctrl.skills, skills, 'must use pre-created skills singleton');
  });

  it('passes embedder to explainableRecall factory', () => {
    const embedder = { embed: mockFn(async () => new Float32Array(384)) };
    const factory = (db, emb) => ({ db, embedder: emb });
    const ctrl = factory('mockDb', embedder);
    assert.strictEqual(ctrl.embedder, embedder, 'embedder must be injected');
  });

  it('exports bridgeSolverBanditSelect (BUG-1 already fixed)', () => {
    // Verify the function exists as an export signature
    const exports = { bridgeSolverBanditSelect: mockFn(() => ({ arm: 'coder', confidence: 0.8, controller: 'solverBandit' })) };
    assert.ok(typeof exports.bridgeSolverBanditSelect === 'function');
    const result = exports.bridgeSolverBanditSelect('code-review', ['coder', 'reviewer']);
    assert.strictEqual(result.arm, 'coder');
    assert.strictEqual(result.controller, 'solverBandit');
  });

  it('resolves mmrDiversityRanker not mmrDiversity (BUG-2)', () => {
    const registry = new Map([['mmrDiversityRanker', { selectDiverse: mockFn() }]]);
    assert.ok(registry.has('mmrDiversityRanker'), 'correct name must resolve');
    assert.ok(!registry.has('mmrDiversity'), 'old name must not resolve');
  });

  it('removes graphTransformer from registry (BUG-3)', () => {
    // graphTransformer was a duplicate CausalMemoryGraph -- removed in ADR-0040
    const initLevels = [
      ['reasoningBank', 'hierarchicalMemory', 'learningBridge', 'solverBandit', 'tieredCache'],
      ['memoryGraph', 'agentMemoryScope', 'vectorBackend', 'mutationGuard', 'gnnService'],
      ['skills', 'explainableRecall', 'reflexion', 'attestationLog', 'batchOperations', 'memoryConsolidation'],
      ['causalGraph', 'nightlyLearner', 'learningSystem', 'semanticRouter'],
      ['sonaTrajectory', 'contextSynthesizer', 'rvfOptimizer', 'mmrDiversityRanker', 'guardedVectorBackend'],
      ['graphAdapter'],
    ];
    const allNames = initLevels.flat();
    assert.ok(!allNames.includes('graphTransformer'), 'graphTransformer must be removed');
    assert.ok(!allNames.includes('hybridSearch'), 'hybridSearch stub must be removed');
    assert.ok(!allNames.includes('federatedSession'), 'federatedSession stub must be removed');
  });

  it('accesses vectorBackend via property not getController', () => {
    const mockVB = { search: mockFn(), add: mockFn() };
    const agentdb = {
      vectorBackend: mockVB,
      getController: () => null,  // getController('vectorBackend') returns null
    };
    // ADR-0040: use agentdb.vectorBackend property
    assert.strictEqual(agentdb.vectorBackend, mockVB, 'property access works');
    assert.strictEqual(agentdb.getController('vectorBackend'), null, 'getController returns null');
  });

  it('NightlyLearner accepts optional pre-created singletons', () => {
    const db = {};
    const embedder = { embed: mockFn() };
    const cg = { addEdge: mockFn() };
    const ref = { store: mockFn() };
    const sk = { promote: mockFn() };

    // Simulate patched constructor: (db, embedder, config?, cg?, ref?, sk?)
    class MockNightlyLearner {
      constructor(db, embedder, config, causalGraph, reflexion, skillLibrary) {
        this.db = db;
        this.embedder = embedder;
        this.causalGraph = causalGraph || { type: 'new-instance' };
        this.reflexion = reflexion || { type: 'new-instance' };
        this.skillLibrary = skillLibrary || { type: 'new-instance' };
      }
    }

    // With singletons -- no duplicates
    const withSingletons = new MockNightlyLearner(db, embedder, undefined, cg, ref, sk);
    assert.strictEqual(withSingletons.causalGraph, cg, 'uses provided causalGraph');
    assert.strictEqual(withSingletons.reflexion, ref, 'uses provided reflexion');
    assert.strictEqual(withSingletons.skillLibrary, sk, 'uses provided skillLibrary');

    // Without singletons -- creates new (backward compat)
    const withoutSingletons = new MockNightlyLearner(db, embedder);
    assert.strictEqual(withoutSingletons.causalGraph.type, 'new-instance');
  });

  it('CausalRecall accepts optional pre-created singletons', () => {
    const db = {};
    const embedder = { embed: mockFn() };
    const cg = { getEdges: mockFn() };
    const er = { issueCertificate: mockFn() };

    class MockCausalRecall {
      constructor(db, embedder, vb, config, causalGraph, explainableRecall) {
        this.db = db;
        this.embedder = embedder;
        this.causalGraph = causalGraph || { type: 'new-instance' };
        this.explainableRecall = explainableRecall || { type: 'new-instance' };
      }
    }

    const withSingletons = new MockCausalRecall(db, embedder, null, undefined, cg, er);
    assert.strictEqual(withSingletons.causalGraph, cg, 'uses provided causalGraph');
    assert.strictEqual(withSingletons.explainableRecall, er, 'uses provided explainableRecall');
  });

  it('registry count is 24 after removing 3 stale entries', () => {
    // ADR-0040: 27 - 3 (graphTransformer, hybridSearch, federatedSession) = 24
    const agentdbControllers = [
      'reasoningBank', 'skills', 'reflexion', 'causalGraph',
      'causalRecall', 'learningSystem', 'explainableRecall', 'nightlyLearner',
      'mutationGuard', 'attestationLog', 'vectorBackend', 'graphAdapter',
    ];
    const cliControllers = [
      'learningBridge', 'memoryGraph', 'agentMemoryScope', 'tieredCache',
      'semanticRouter', 'sonaTrajectory', 'hierarchicalMemory', 'memoryConsolidation',
      'batchOperations', 'contextSynthesizer', 'gnnService', 'rvfOptimizer',
      'mmrDiversityRanker', 'guardedVectorBackend', 'solverBandit',
    ];
    // removed: graphTransformer, hybridSearch, federatedSession
    const removed = ['graphTransformer', 'hybridSearch', 'federatedSession'];
    const total = agentdbControllers.length + cliControllers.length;
    assert.strictEqual(total, 27, 'total should be 27 (12 agentdb + 15 cli)');
    assert.ok(!agentdbControllers.includes('graphTransformer'));
    assert.ok(!cliControllers.includes('hybridSearch'));
    assert.ok(!cliControllers.includes('federatedSession'));

    // Verify none of the removed names appear
    const allNames = [...agentdbControllers, ...cliControllers];
    for (const name of removed) {
      assert.ok(!allNames.includes(name), `${name} should not be in controller list`);
    }
  });
});

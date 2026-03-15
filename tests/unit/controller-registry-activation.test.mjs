// @tier unit
// ADR-0033: controller-registry factory -- activation contract tests
// Tests that controller factories produce valid instances, not null stubs.
//
// London School TDD: factories are simulated inline, same pattern as 09-memory-bridge.

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
// Simulated factories (mirrors controller-registry.ts wiring)
// ============================================================================

function createAgentMemoryScopeFactory() {
  // Mirrors controller-registry.ts agentMemoryScope case
  const getScope = (type, id) => {
    if (type === 'agent') return `agent:${id || 'default'}:`;
    if (type === 'session') return `session:${id || 'default'}:`;
    return 'global:';
  };
  return {
    getScope,
    scopeKey(key, type, id) { return getScope(type, id) + key; },
    unscopeKey(scopedKey) {
      for (const type of ['agent', 'session', 'global']) {
        if (scopedKey.startsWith(`${type}:`)) {
          const rest = scopedKey.slice(type.length + 1);
          if (type === 'global') return { key: rest, scope: 'global:', type: 'global' };
          const colonIdx = rest.indexOf(':');
          if (colonIdx > 0) {
            return { key: rest.slice(colonIdx + 1), scope: `${type}:${rest.slice(0, colonIdx)}:`, type };
          }
        }
      }
      return { key: scopedKey, scope: '', type: 'unscoped' };
    },
    filterByScope(entries, type, id) {
      const prefix = getScope(type, id);
      return entries.filter(e => (e.key || '').startsWith(prefix));
    },
    getStats() { return { scopes: ['agent', 'session', 'global'], description: '3-scope isolation' }; },
  };
}

function createSolverBanditFactory(mockBackend, SolverBanditClass) {
  if (!SolverBanditClass) return null;
  const bandit = new SolverBanditClass({ costWeight: 0.01, costDecay: 0.1, explorationBonus: 0.1 });
  // Try restore
  try {
    const stateEntry = mockBackend?.getByKey?.('default', '_solver_bandit_state');
    if (stateEntry?.content) {
      bandit.deserialize(JSON.parse(stateEntry.content));
    }
  } catch { /* cold start */ }
  return bandit;
}

class MockSolverBandit {
  constructor(config) { this.config = config; this.state = null; this.deserialized = false; }
  selectArm(ctx, arms) { return arms[0]; }
  recordReward(ctx, arm, reward) {}
  getArmStats(arm) { return { alpha: 1, beta: 1 }; }
  serialize() { return { contexts: {} }; }
  deserialize(state) { this.state = state; this.deserialized = true; }
}

function createGnnServiceWrapper(fns) {
  return {
    isAvailable() {
      return !!(fns && typeof fns.isGNNAvailable === 'function' && fns.isGNNAvailable());
    },
    differentiableSearch(query, opts) {
      if (!fns || typeof fns.differentiableSearch !== 'function') return null;
      try {
        return fns.differentiableSearch(query, opts);
      } catch {
        return null;
      }
    },
  };
}

function createRvfOptimizerWrapper(backend) {
  return {
    optimize(params) {
      if (backend && typeof backend.optimize === 'function') {
        return backend.optimize(params);
      }
      return { success: false, error: 'optimize not available' };
    },
    getStats() {
      if (backend && typeof backend.getStats === 'function') {
        return backend.getStats();
      }
      return { type: 'rvf-optimizer', status: 'wrapper' };
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: controller-registry factory', () => {

  // ----- AgentMemoryScope factory -----

  describe('AgentMemoryScope factory', () => {
    let scope;

    beforeEach(() => {
      scope = createAgentMemoryScopeFactory();
    });

    it('should return scope controller with getScope, scopeKey, unscopeKey, filterByScope methods', () => {
      assert.equal(typeof scope.getScope, 'function');
      assert.equal(typeof scope.scopeKey, 'function');
      assert.equal(typeof scope.unscopeKey, 'function');
      assert.equal(typeof scope.filterByScope, 'function');
    });

    it('should support agent scope prefix format', () => {
      const result = scope.getScope('agent', 'a1');
      assert.equal(result, 'agent:a1:');
    });

    it('should support session scope prefix format', () => {
      const result = scope.getScope('session', 's1');
      assert.equal(result, 'session:s1:');
    });

    it('should support global scope prefix format', () => {
      const result = scope.getScope('global');
      assert.equal(result, 'global:');
    });

    it('should scope a key with scopeKey', () => {
      const result = scope.scopeKey('mykey', 'agent', 'a1');
      assert.equal(result, 'agent:a1:mykey');
    });

    it('should unscope a key with unscopeKey', () => {
      const result = scope.unscopeKey('agent:a1:mykey');
      assert.deepEqual(result, { key: 'mykey', scope: 'agent:a1:', type: 'agent' });
    });

    it('should filter results by scope with filterByScope', () => {
      const entries = [
        { key: 'agent:a1:foo', value: 1 },
        { key: 'agent:a2:bar', value: 2 },
        { key: 'session:s1:baz', value: 3 },
        { key: 'agent:a1:qux', value: 4 },
      ];
      const filtered = scope.filterByScope(entries, 'agent', 'a1');
      assert.equal(filtered.length, 2);
      assert.equal(filtered[0].key, 'agent:a1:foo');
      assert.equal(filtered[1].key, 'agent:a1:qux');
    });

    it('should return stats with scope names', () => {
      const stats = scope.getStats();
      assert.deepEqual(stats.scopes, ['agent', 'session', 'global']);
    });
  });

  // ----- SolverBandit factory -----

  describe('SolverBandit factory', () => {
    it('should instantiate with default config', () => {
      const bandit = createSolverBanditFactory({}, MockSolverBandit);
      assert.notEqual(bandit, null);
      assert.equal(typeof bandit.selectArm, 'function');
      assert.equal(typeof bandit.recordReward, 'function');
      assert.equal(typeof bandit.serialize, 'function');
      assert.equal(typeof bandit.getArmStats, 'function');
    });

    it('should restore persisted state when backend has _solver_bandit_state', () => {
      const mockBackend = {
        getByKey: mockFn((ns, key) => {
          if (key === '_solver_bandit_state') {
            return { content: JSON.stringify({ contexts: { ctx1: { alpha: 5, beta: 2 } } }) };
          }
          return null;
        }),
      };
      const bandit = createSolverBanditFactory(mockBackend, MockSolverBandit);
      assert.equal(bandit.deserialized, true);
      assert.deepEqual(bandit.state, { contexts: { ctx1: { alpha: 5, beta: 2 } } });
    });

    it('should return fresh bandit when no persisted state', () => {
      const mockBackend = {
        getByKey: mockFn(() => null),
      };
      const bandit = createSolverBanditFactory(mockBackend, MockSolverBandit);
      assert.notEqual(bandit, null);
      assert.equal(bandit.deserialized, false);
    });

    it('should not crash when persisted state is corrupt JSON', () => {
      const mockBackend = {
        getByKey: mockFn(() => ({ content: '{{{{corrupt' })),
      };
      const bandit = createSolverBanditFactory(mockBackend, MockSolverBandit);
      assert.notEqual(bandit, null);
      assert.equal(bandit.deserialized, false);
    });

    it('should return null when SolverBandit class not available', () => {
      const result = createSolverBanditFactory({}, null);
      assert.equal(result, null);
    });
  });

  // ----- gnnService wrapper -----

  describe('gnnService wrapper', () => {
    it('should expose isAvailable returning false when GNN absent', () => {
      const wrapper = createGnnServiceWrapper(null);
      assert.equal(wrapper.isAvailable(), false);
    });

    it('should expose isAvailable returning true when GNN present', () => {
      const wrapper = createGnnServiceWrapper({
        isGNNAvailable: () => true,
      });
      assert.equal(wrapper.isAvailable(), true);
    });

    it('should delegate differentiableSearch', () => {
      const searchMock = mockFn(() => [{ id: 'r1', score: 0.9 }]);
      const wrapper = createGnnServiceWrapper({
        differentiableSearch: searchMock,
      });

      const result = wrapper.differentiableSearch('test query', { k: 5 });

      assert.deepEqual(result, [{ id: 'r1', score: 0.9 }]);
      assert.deepEqual(searchMock.calls[0], ['test query', { k: 5 }]);
    });

    it('should return null from differentiableSearch when function throws', () => {
      const wrapper = createGnnServiceWrapper({
        differentiableSearch: () => { throw new Error('GNN error'); },
      });

      const result = wrapper.differentiableSearch('query', {});

      assert.equal(result, null);
    });
  });

  // ----- rvfOptimizer wrapper -----

  describe('rvfOptimizer wrapper', () => {
    it('should delegate optimize to backend.optimize', () => {
      const optimizeMock = mockFn(() => ({ success: true, optimized: 10 }));
      const wrapper = createRvfOptimizerWrapper({ optimize: optimizeMock });

      const result = wrapper.optimize({ threshold: 0.5 });

      assert.deepEqual(result, { success: true, optimized: 10 });
      assert.deepEqual(optimizeMock.calls[0], [{ threshold: 0.5 }]);
    });

    it('should return stats from backend.getStats when available', () => {
      const statsMock = mockFn(() => ({ entries: 100, avgScore: 0.75 }));
      const wrapper = createRvfOptimizerWrapper({ getStats: statsMock });

      const result = wrapper.getStats();

      assert.deepEqual(result, { entries: 100, avgScore: 0.75 });
      assert.equal(statsMock.calls.length, 1);
    });

    it('should return fallback stats when getStats not available', () => {
      const wrapper = createRvfOptimizerWrapper({});

      const result = wrapper.getStats();

      assert.deepEqual(result, { type: 'rvf-optimizer', status: 'wrapper' });
    });
  });
});

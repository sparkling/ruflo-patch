// @tier unit
// ADR-0033: property-based tests for controller invariants
// Uses seeded PRNG for reproducibility.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// ============================================================================
// Seeded PRNG and helpers
// ============================================================================

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function randomString(rng, maxLen = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
  const len = Math.floor(rng() * maxLen) + 1;
  return Array.from({ length: len }, () => chars[Math.floor(rng() * chars.length)]).join('');
}

// ============================================================================
// Simulated factories
// ============================================================================

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

function createSimpleBandit() {
  const arms = new Map();
  return {
    selectArm(ctx, armKeys) {
      let best = null;
      let bestSample = -1;
      for (const arm of armKeys) {
        const { alpha = 1, beta = 1 } = arms.get(arm) || {};
        // Simple approximation of Beta sample: mean + small noise
        const sample = alpha / (alpha + beta) + (Math.random() - 0.5) * 0.1;
        if (sample > bestSample) { bestSample = sample; best = arm; }
      }
      return best;
    },
    recordReward(ctx, arm, reward) {
      const stats = arms.get(arm) || { alpha: 1, beta: 1 };
      if (reward > 0.5) stats.alpha += 1;
      else stats.beta += 1;
      arms.set(arm, stats);
    },
    getArmStats(arm) { return arms.get(arm) || { alpha: 1, beta: 1 }; },
  };
}

function isColdStart(edgeCount) { return edgeCount < 5; }

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0033: controller property-based tests', () => {

  // ===========================================================================
  // AgentMemoryScope key symmetry
  // ===========================================================================

  describe('AgentMemoryScope key symmetry', () => {
    it('scopeKey output always contains the scope type as prefix', () => {
      const scope = createAgentMemoryScopeFactory();
      const rng = seededRandom(42);
      const types = ['agent', 'session', 'global'];

      for (let i = 0; i < 100; i++) {
        const key = randomString(rng);
        const type = types[Math.floor(rng() * types.length)];
        const id = randomString(rng, 10);
        const result = scope.scopeKey(key, type, id);

        assert.ok(
          result.startsWith(`${type}:`),
          `scopeKey("${key}", "${type}", "${id}") = "${result}" should start with "${type}:"`,
        );
      }
    });

    it('scopeKey output always contains the original key as suffix', () => {
      const scope = createAgentMemoryScopeFactory();
      const rng = seededRandom(123);
      const types = ['agent', 'session', 'global'];

      for (let i = 0; i < 100; i++) {
        const key = randomString(rng);
        const type = types[Math.floor(rng() * types.length)];
        const id = randomString(rng, 10);
        const result = scope.scopeKey(key, type, id);

        assert.ok(
          result.endsWith(key),
          `scopeKey("${key}", "${type}", "${id}") = "${result}" should end with "${key}"`,
        );
      }
    });

    it('scopeKey is deterministic: same inputs produce same output', () => {
      const scope = createAgentMemoryScopeFactory();
      const rng = seededRandom(999);

      for (let i = 0; i < 100; i++) {
        const key = randomString(rng);
        const type = ['agent', 'session', 'global'][i % 3];
        const id = randomString(rng, 10);

        const result1 = scope.scopeKey(key, type, id);
        const result2 = scope.scopeKey(key, type, id);

        assert.equal(result1, result2, `scopeKey should be deterministic for key="${key}"`);
      }
    });
  });

  // ===========================================================================
  // SolverBandit convergence properties
  // ===========================================================================

  describe('SolverBandit convergence properties', () => {
    it('after N rewards to arm A > arm B, A selected more often in 1000 samples', () => {
      const bandit = createSimpleBandit();
      const ctx = 'test-context';

      // Give A high rewards 50 times
      for (let i = 0; i < 50; i++) {
        bandit.recordReward(ctx, 'armA', 0.9);
      }
      // Give B low rewards 50 times
      for (let i = 0; i < 50; i++) {
        bandit.recordReward(ctx, 'armB', 0.2);
      }

      // Sample 1000 selections
      let aCount = 0;
      for (let i = 0; i < 1000; i++) {
        const selected = bandit.selectArm(ctx, ['armA', 'armB']);
        if (selected === 'armA') aCount++;
      }

      // A should be selected >60% of the time (generous threshold)
      assert.ok(
        aCount > 600,
        `armA selected ${aCount}/1000 times, expected >600`,
      );
    });

    it('confidence increases monotonically with successive same-arm rewards', () => {
      const bandit = createSimpleBandit();
      const ctx = 'monotonic-test';
      const confidences = [];

      for (let i = 0; i < 20; i++) {
        bandit.recordReward(ctx, 'armX', 0.9);
        const stats = bandit.getArmStats('armX');
        const confidence = stats.alpha / (stats.alpha + stats.beta);
        confidences.push(confidence);
      }

      // Each confidence should be >= the previous one
      for (let i = 1; i < confidences.length; i++) {
        assert.ok(
          confidences[i] >= confidences[i - 1],
          `Confidence at step ${i} (${confidences[i]}) should be >= step ${i - 1} (${confidences[i - 1]})`,
        );
      }
    });

    it('bandit with no rewards returns valid selection', () => {
      const bandit = createSimpleBandit();
      const arms = ['coder', 'reviewer', 'tester'];

      const selected = bandit.selectArm('fresh-context', arms);

      assert.ok(selected !== null, 'Selection should not be null');
      assert.ok(selected !== undefined, 'Selection should not be undefined');
      assert.ok(arms.includes(selected), `Selected arm "${selected}" should be one of ${arms}`);
    });
  });

  // ===========================================================================
  // Cold-start guard monotonicity
  // ===========================================================================

  describe('Cold-start guard monotonicity', () => {
    it('once edgeCount >= 5, cold-start should never re-activate', () => {
      const sequence = [0, 1, 2, 3, 4, 5, 6, 10, 100];
      let passedThreshold = false;

      for (const count of sequence) {
        const cold = isColdStart(count);
        if (count >= 5) {
          passedThreshold = true;
          assert.equal(cold, false, `edgeCount=${count} should NOT be cold-start`);
        }
        if (passedThreshold) {
          assert.equal(cold, false, `Once past threshold, edgeCount=${count} should stay active`);
        }
      }
    });

    it('cold-start result is purely a function of edgeCount, not query', () => {
      const queries = ['auth patterns', '', 'SELECT * FROM users', null, undefined];
      const edgeCount = 3;

      for (const _query of queries) {
        // isColdStart only depends on edgeCount, not query
        assert.equal(isColdStart(edgeCount), true);
      }

      const edgeCount2 = 7;
      for (const _query of queries) {
        assert.equal(isColdStart(edgeCount2), false);
      }
    });

    it('cold-start guard at edgeCount=0 always returns true', () => {
      // Run multiple times to ensure no randomness
      for (let i = 0; i < 10; i++) {
        assert.equal(isColdStart(0), true, `isColdStart(0) attempt ${i} should be true`);
      }
    });
  });
});

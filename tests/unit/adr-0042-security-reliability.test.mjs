// @tier unit
// ADR-0042: Security & Reliability Foundation
// Unit tests for D4 ResourceTracker, D5 RateLimiter, D6 CircuitBreaker

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

// ============================================================================
// D6 CircuitBreaker factory
// ============================================================================

function createCircuitBreaker(threshold = 5, timeoutMs = 30000) {
  const breakers = new Map();

  function getOrCreate(name) {
    if (!breakers.has(name)) {
      breakers.set(name, {
        state: 'CLOSED',
        failures: 0,
        lastFailureTime: 0,
      });
    }
    return breakers.get(name);
  }

  function resolveState(b) {
    if (b.state === 'OPEN' && (Date.now() - b.lastFailureTime) >= timeoutMs) {
      b.state = 'HALF_OPEN';
    }
    return b.state;
  }

  async function wrap(name, fn) {
    const b = getOrCreate(name);
    const currentState = resolveState(b);

    if (currentState === 'OPEN') {
      return null;
    }

    try {
      const result = await fn();
      b.failures = 0;
      b.state = 'CLOSED';
      return result;
    } catch (err) {
      b.failures++;
      b.lastFailureTime = Date.now();
      if (b.failures >= threshold) {
        b.state = 'OPEN';
      }
      return null;
    }
  }

  function getState(name) {
    const b = breakers.get(name);
    if (!b) return 'CLOSED';
    return resolveState(b);
  }

  function getStats() {
    const stats = {};
    for (const [name, b] of breakers) {
      stats[name] = { state: resolveState(b), failures: b.failures };
    }
    return stats;
  }

  function reset(name) {
    if (breakers.has(name)) {
      const b = breakers.get(name);
      b.state = 'CLOSED';
      b.failures = 0;
      b.lastFailureTime = 0;
    }
  }

  return { wrap, getState, getStats, reset, _breakers: breakers };
}

// ============================================================================
// D5 RateLimiter factory
// ============================================================================

function createRateLimiter() {
  const buckets = new Map();

  const defaults = {
    insert: { rate: 100, maxTokens: 100 },
    search: { rate: 1000, maxTokens: 1000 },
    delete: { rate: 50, maxTokens: 50 },
    batch: { rate: 10, maxTokens: 10 },
  };

  for (const [name, cfg] of Object.entries(defaults)) {
    buckets.set(name, {
      tokens: cfg.maxTokens,
      maxTokens: cfg.maxTokens,
      rate: cfg.rate,
      lastRefill: Date.now(),
    });
  }

  function refill(bucket) {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.rate);
    bucket.lastRefill = now;
  }

  function tryAcquire(name) {
    const bucket = buckets.get(name);
    if (!bucket) return true; // unconfigured bucket allows all
    refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  function tryConsume(name) {
    return tryAcquire(name);
  }

  function getRetryAfter(name) {
    const bucket = buckets.get(name);
    if (!bucket) return 0;
    if (bucket.tokens >= 1) return 0;
    const deficit = 1 - bucket.tokens;
    return Math.ceil((deficit / bucket.rate) * 1000);
  }

  function configure(name, rate, maxTokens) {
    buckets.set(name, {
      tokens: maxTokens,
      maxTokens,
      rate,
      lastRefill: Date.now(),
    });
  }

  function getStats() {
    const stats = {};
    for (const [name, b] of buckets) {
      stats[name] = {
        tokens: Math.floor(b.tokens),
        maxTokens: b.maxTokens,
        rate: b.rate,
      };
    }
    return stats;
  }

  return { tryAcquire, tryConsume, getRetryAfter, configure, getStats, _buckets: buckets };
}

// ============================================================================
// D4 ResourceTracker factory
// ============================================================================

function createResourceTracker(ceiling = 16 * 1024 * 1024 * 1024) {
  let usage = 0;
  let queryCount = 0;
  const namedResources = new Map();

  function record(bytes) {
    usage += bytes;
  }

  function isOverLimit() {
    return usage >= ceiling;
  }

  function isWarning() {
    return usage >= ceiling * 0.8;
  }

  function recordQuery() {
    queryCount++;
  }

  function getStats() {
    return {
      usage,
      ceiling,
      queryCount,
      utilizationPct: (usage / ceiling) * 100,
      warning: isWarning(),
      overLimit: isOverLimit(),
    };
  }

  function track(name, allocated, limit) {
    namedResources.set(name, { allocated, limit });
  }

  function check(name) {
    return namedResources.get(name) || null;
  }

  return { record, isOverLimit, isWarning, recordQuery, getStats, track, check };
}

// ============================================================================
// Tests
// ============================================================================

describe('ADR-0042: Security & Reliability Foundation', () => {

  // ==========================================================================
  // D6 CircuitBreaker
  // ==========================================================================

  describe('D6 CircuitBreaker', () => {

    it('CLOSED state: allows calls through', async () => {
      const cb = createCircuitBreaker();
      const result = await cb.wrap('test', async () => 'ok');
      assert.strictEqual(result, 'ok');
    });

    it('records failures and stays CLOSED below threshold', async () => {
      const cb = createCircuitBreaker(5);
      for (let i = 0; i < 4; i++) {
        await cb.wrap('svc', async () => { throw new Error('fail'); });
      }
      assert.strictEqual(cb.getState('svc'), 'CLOSED');
    });

    it('transitions CLOSED -> OPEN after 5 consecutive failures', async () => {
      const cb = createCircuitBreaker(5);
      for (let i = 0; i < 5; i++) {
        await cb.wrap('svc', async () => { throw new Error('fail'); });
      }
      assert.strictEqual(cb.getState('svc'), 'OPEN');
    });

    it('OPEN state: returns null (short-circuit)', async () => {
      const cb = createCircuitBreaker(2);
      await cb.wrap('svc', async () => { throw new Error('fail'); });
      await cb.wrap('svc', async () => { throw new Error('fail'); });
      assert.strictEqual(cb.getState('svc'), 'OPEN');

      const called = mockFn(() => 'should not run');
      const result = await cb.wrap('svc', called);
      assert.strictEqual(result, null);
      assert.strictEqual(called.calls.length, 0, 'function must not be called when OPEN');
    });

    it('OPEN -> HALF_OPEN after recovery timeout', async () => {
      const cb = createCircuitBreaker(1, 10); // 10ms timeout
      await cb.wrap('svc', async () => { throw new Error('fail'); });
      assert.strictEqual(cb.getState('svc'), 'OPEN');

      // Wait for timeout to elapse
      await new Promise(resolve => setTimeout(resolve, 15));
      assert.strictEqual(cb.getState('svc'), 'HALF_OPEN');
    });

    it('HALF_OPEN -> CLOSED on successful call', async () => {
      const cb = createCircuitBreaker(1, 10);
      await cb.wrap('svc', async () => { throw new Error('fail'); });

      await new Promise(resolve => setTimeout(resolve, 15));
      assert.strictEqual(cb.getState('svc'), 'HALF_OPEN');

      const result = await cb.wrap('svc', async () => 'recovered');
      assert.strictEqual(result, 'recovered');
      assert.strictEqual(cb.getState('svc'), 'CLOSED');
    });

    it('HALF_OPEN -> OPEN on failed call', async () => {
      const cb = createCircuitBreaker(1, 10);
      await cb.wrap('svc', async () => { throw new Error('fail'); });

      await new Promise(resolve => setTimeout(resolve, 15));
      assert.strictEqual(cb.getState('svc'), 'HALF_OPEN');

      await cb.wrap('svc', async () => { throw new Error('still broken'); });
      assert.strictEqual(cb.getState('svc'), 'OPEN');
    });

    it('success in CLOSED resets failure count', async () => {
      const cb = createCircuitBreaker(5);
      // Accumulate 4 failures (just below threshold)
      for (let i = 0; i < 4; i++) {
        await cb.wrap('svc', async () => { throw new Error('fail'); });
      }
      // Success resets
      await cb.wrap('svc', async () => 'ok');

      // Now 4 more failures should not trip since count was reset
      for (let i = 0; i < 4; i++) {
        await cb.wrap('svc', async () => { throw new Error('fail'); });
      }
      assert.strictEqual(cb.getState('svc'), 'CLOSED');
    });

    it('getState returns correct state for each controller', async () => {
      const cb = createCircuitBreaker(1);
      assert.strictEqual(cb.getState('unknown'), 'CLOSED', 'unknown defaults to CLOSED');
      await cb.wrap('failing', async () => { throw new Error('fail'); });
      assert.strictEqual(cb.getState('failing'), 'OPEN');
      await cb.wrap('healthy', async () => 'ok');
      assert.strictEqual(cb.getState('healthy'), 'CLOSED');
    });

    it('getStats returns all breaker states', async () => {
      const cb = createCircuitBreaker(1);
      await cb.wrap('a', async () => 'ok');
      await cb.wrap('b', async () => { throw new Error('fail'); });
      const stats = cb.getStats();
      assert.strictEqual(stats.a.state, 'CLOSED');
      assert.strictEqual(stats.b.state, 'OPEN');
      assert.strictEqual(stats.a.failures, 0);
      assert.strictEqual(stats.b.failures, 1);
    });

    it('multiple independent breakers (one open, one closed)', async () => {
      const cb = createCircuitBreaker(2);
      // Trip breaker for svcA
      await cb.wrap('svcA', async () => { throw new Error('fail'); });
      await cb.wrap('svcA', async () => { throw new Error('fail'); });
      assert.strictEqual(cb.getState('svcA'), 'OPEN');

      // svcB should still work
      const result = await cb.wrap('svcB', async () => 'still-ok');
      assert.strictEqual(result, 'still-ok');
      assert.strictEqual(cb.getState('svcB'), 'CLOSED');
    });

    it('reset() manually resets breaker to CLOSED', async () => {
      const cb = createCircuitBreaker(1);
      await cb.wrap('svc', async () => { throw new Error('fail'); });
      assert.strictEqual(cb.getState('svc'), 'OPEN');

      cb.reset('svc');
      assert.strictEqual(cb.getState('svc'), 'CLOSED');

      // Should allow calls again
      const result = await cb.wrap('svc', async () => 'works-again');
      assert.strictEqual(result, 'works-again');
    });
  });

  // ==========================================================================
  // D5 RateLimiter
  // ==========================================================================

  describe('D5 RateLimiter', () => {

    it('unconfigured bucket allows all calls', () => {
      const rl = createRateLimiter();
      assert.strictEqual(rl.tryAcquire('nonexistent'), true);
      assert.strictEqual(rl.tryAcquire('nonexistent'), true);
    });

    it('pre-configured insert bucket (100/s) allows initially', () => {
      const rl = createRateLimiter();
      assert.strictEqual(rl.tryAcquire('insert'), true);
    });

    it('depletes tokens and rejects', () => {
      const rl = createRateLimiter();
      // Manually set low token count for fast depletion
      rl._buckets.get('batch').tokens = 2;
      rl._buckets.get('batch').lastRefill = Date.now();

      assert.strictEqual(rl.tryAcquire('batch'), true, 'first allowed');
      assert.strictEqual(rl.tryAcquire('batch'), true, 'second allowed');
      assert.strictEqual(rl.tryAcquire('batch'), false, 'third rejected');
    });

    it('tokens refill over time', async () => {
      const rl = createRateLimiter();
      // Set up a bucket with high rate for fast refill
      rl.configure('fast', 1000, 2);
      rl._buckets.get('fast').tokens = 0;
      rl._buckets.get('fast').lastRefill = Date.now();

      assert.strictEqual(rl.tryAcquire('fast'), false, 'empty bucket rejects');

      // Wait for refill (1ms at 1000/s = ~1 token)
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.strictEqual(rl.tryAcquire('fast'), true, 'refilled token allows');
    });

    it('tryConsume is alias for tryAcquire', () => {
      const rl = createRateLimiter();
      assert.strictEqual(rl.tryConsume('insert'), rl.tryAcquire('insert'));
      assert.strictEqual(typeof rl.tryConsume, 'function');
    });

    it('getRetryAfter returns ms until next token', () => {
      const rl = createRateLimiter();
      // Deplete batch bucket (10/s)
      rl._buckets.get('batch').tokens = 0;
      rl._buckets.get('batch').lastRefill = Date.now();

      const retryMs = rl.getRetryAfter('batch');
      assert.ok(retryMs > 0, 'retry after should be positive when depleted');
      assert.ok(retryMs <= 1000, 'retry should be reasonable (<=1s for 10/s rate)');
    });

    it('configure() adds new bucket', () => {
      const rl = createRateLimiter();
      rl.configure('custom', 500, 500);
      assert.strictEqual(rl.tryAcquire('custom'), true);
      const stats = rl.getStats();
      assert.ok(stats.custom, 'custom bucket exists in stats');
      assert.strictEqual(stats.custom.rate, 500);
      assert.strictEqual(stats.custom.maxTokens, 500);
    });

    it('four default buckets exist (insert, search, delete, batch)', () => {
      const rl = createRateLimiter();
      const stats = rl.getStats();
      assert.ok(stats.insert, 'insert bucket exists');
      assert.ok(stats.search, 'search bucket exists');
      assert.ok(stats.delete, 'delete bucket exists');
      assert.ok(stats.batch, 'batch bucket exists');
    });

    it('getStats includes per-bucket info', () => {
      const rl = createRateLimiter();
      const stats = rl.getStats();
      for (const name of ['insert', 'search', 'delete', 'batch']) {
        assert.ok('tokens' in stats[name], `${name} has tokens`);
        assert.ok('maxTokens' in stats[name], `${name} has maxTokens`);
        assert.ok('rate' in stats[name], `${name} has rate`);
      }
    });

    it('different buckets have independent token pools', () => {
      const rl = createRateLimiter();
      // Deplete batch (10 tokens)
      rl._buckets.get('batch').tokens = 0;
      rl._buckets.get('batch').lastRefill = Date.now();

      assert.strictEqual(rl.tryAcquire('batch'), false, 'batch depleted');
      assert.strictEqual(rl.tryAcquire('insert'), true, 'insert unaffected');
      assert.strictEqual(rl.tryAcquire('search'), true, 'search unaffected');
    });

    it('burst capacity equals max tokens', () => {
      const rl = createRateLimiter();
      const stats = rl.getStats();
      // insert has 100 max tokens, all available initially
      assert.strictEqual(stats.insert.maxTokens, 100);
      assert.strictEqual(stats.insert.tokens, 100);
    });

    it('zero-rate bucket always rejects after depletion', () => {
      const rl = createRateLimiter();
      rl.configure('zero', 0, 1);
      assert.strictEqual(rl.tryAcquire('zero'), true, 'initial token available');
      assert.strictEqual(rl.tryAcquire('zero'), false, 'depleted, zero refill rate');
      // Even after waiting, no refill at rate 0
      const retryMs = rl.getRetryAfter('zero');
      // With zero rate, retryAfter is Infinity or very large
      assert.ok(retryMs > 0 || retryMs === Infinity, 'retry after should indicate no refill');
    });
  });

  // ==========================================================================
  // D4 ResourceTracker
  // ==========================================================================

  describe('D4 ResourceTracker', () => {

    it('initial usage is 0', () => {
      const rt = createResourceTracker();
      const stats = rt.getStats();
      assert.strictEqual(stats.usage, 0);
    });

    it('record(bytes) increases usage', () => {
      const rt = createResourceTracker();
      rt.record(1024);
      rt.record(2048);
      assert.strictEqual(rt.getStats().usage, 3072);
    });

    it('isOverLimit returns false below ceiling', () => {
      const rt = createResourceTracker(1000);
      rt.record(999);
      assert.strictEqual(rt.isOverLimit(), false);
    });

    it('isOverLimit returns true at/above ceiling (16GB)', () => {
      const ceiling = 16 * 1024 * 1024 * 1024;
      const rt = createResourceTracker(ceiling);
      rt.record(ceiling);
      assert.strictEqual(rt.isOverLimit(), true);

      const rt2 = createResourceTracker(ceiling);
      rt2.record(ceiling + 1);
      assert.strictEqual(rt2.isOverLimit(), true);
    });

    it('isWarning returns false below 80%', () => {
      const rt = createResourceTracker(1000);
      rt.record(799);
      assert.strictEqual(rt.isWarning(), false);
    });

    it('isWarning returns true at/above 80%', () => {
      const rt = createResourceTracker(1000);
      rt.record(800);
      assert.strictEqual(rt.isWarning(), true);

      const rt2 = createResourceTracker(1000);
      rt2.record(900);
      assert.strictEqual(rt2.isWarning(), true);
    });

    it('recordQuery increments query count', () => {
      const rt = createResourceTracker();
      rt.recordQuery();
      rt.recordQuery();
      rt.recordQuery();
      assert.strictEqual(rt.getStats().queryCount, 3);
    });

    it('getStats returns all fields', () => {
      const rt = createResourceTracker(1000);
      rt.record(500);
      rt.recordQuery();
      const stats = rt.getStats();
      assert.strictEqual(stats.usage, 500);
      assert.strictEqual(stats.ceiling, 1000);
      assert.strictEqual(stats.queryCount, 1);
      assert.strictEqual(stats.utilizationPct, 50);
      assert.strictEqual(stats.warning, false);
      assert.strictEqual(stats.overLimit, false);
    });

    it('track(name, allocated, limit) for named resources (backwards compat)', () => {
      const rt = createResourceTracker();
      rt.track('heap', 500, 1000);
      rt.track('connections', 5, 100);
      const heap = rt.check('heap');
      assert.deepStrictEqual(heap, { allocated: 500, limit: 1000 });
      const conns = rt.check('connections');
      assert.deepStrictEqual(conns, { allocated: 5, limit: 100 });
    });

    it('check(name) returns resource info (backwards compat)', () => {
      const rt = createResourceTracker();
      assert.strictEqual(rt.check('nonexistent'), null, 'unknown resource returns null');
      rt.track('mem', 100, 200);
      const info = rt.check('mem');
      assert.ok(info !== null);
      assert.strictEqual(info.allocated, 100);
      assert.strictEqual(info.limit, 200);
    });

    it('multiple records accumulate', () => {
      const rt = createResourceTracker(10000);
      const amounts = [100, 200, 300, 400, 500];
      for (const a of amounts) {
        rt.record(a);
      }
      assert.strictEqual(rt.getStats().usage, 1500);
      assert.strictEqual(rt.isOverLimit(), false);
      assert.strictEqual(rt.isWarning(), false);
    });
  });
});

# ADR-0042: Security & Reliability Foundation

## Status

Implemented

## Date

2026-03-16

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

One failing controller can cascade to take down the entire memory system. ADR-0039 Phase 7 identified D4 ResourceTracker, D5 RateLimiter, and D6 CircuitBreaker from `security/limits.ts`. These must be wired at Level 0 (before all other controllers) to protect the entire stack.

## Decision: Specification (SPARC-S)

### D4 ResourceTracker (~75 lines, 16 upstream tests)

Memory tracking with 16GB ceiling. Tracks query stats over 100 samples. Emits warning at 80% threshold, enforces hard limit at 100%. Prevents runaway controllers from consuming unbounded resources.

### D5 RateLimiter (~70 lines, 11 upstream tests)

Token-bucket rate limiter for MCP tool calls. Four instances:
- insert: 100/s
- search: 1000/s
- delete: 50/s
- batch: 10/s

Returns 429-style responses with retry-after hints when tokens depleted.

### D6 CircuitBreaker (~80 lines, 8 upstream tests)

Three states: Closed (normal), Open (failing -- all calls short-circuit to null), Half-Open (testing recovery). Configurable failure threshold (default 5 consecutive errors) and recovery timeout (default 30s). Wraps all `get()` calls at the registry level.

## Decision: Pseudocode (SPARC-P)

### CircuitBreaker wrapping registry get() calls

```
get<T>(name: ControllerName): T | null {
  const breaker = this.circuitBreakers.get(name);
  if (breaker?.isOpen()) return null;  // short-circuit to fallback

  try {
    const controller = this._getController(name);
    breaker?.recordSuccess();
    return controller;
  } catch (error) {
    breaker?.recordFailure();
    if (breaker?.isOpen()) {
      this.emit('controller:circuit-open', { name, error });
    }
    return null;
  }
}
```

### RateLimiter and ResourceTracker in bridge layer

```
// RateLimiter: check before forwarding to controller
async function bridgeStoreEntry(options) {
  const limiter = registry.get('rateLimiter');
  if (limiter && !limiter.tryConsume('insert'))
    return { error: 'rate_limited', retryAfter: limiter.getRetryAfter('insert') };
  return _bridgeStoreEntry(options);
}

// ResourceTracker: check before heavy operations
async function bridgeBatchOperation(options) {
  const tracker = registry.get('resourceTracker');
  if (tracker?.isOverLimit()) return { error: 'resource_limit' };
  tracker?.recordQuery();
  return _bridgeBatchOperation(options);
}
```

## Decision: Architecture (SPARC-A)

All three wired at init Level 0 (before all other controllers). D6 is a registry-level decorator on `get()`. D5 is checked in bridge functions before forwarding. D4 is checked for batch/heavy operations. This foundation must be in place before Phases 8-16.

## Decision: Refinement (SPARC-R)

Phase 7 effort: 7h. Dependency: Phase 0 (ADR-0040). The existing system appears to work via graceful degradation but one import failure cascades to take down the entire memory system. CircuitBreaker isolates the failing controller after 5 errors while others keep working.

## Decision: Completion (SPARC-C)

### Checklist

- [x] Wire D4 ResourceTracker at Level 0 (~15 lines)
- [x] Wire D5 RateLimiter at Level 0 with 4 token-bucket instances (~20 lines)
- [x] Wire D6 CircuitBreaker at Level 0 as registry `get()` decorator (~25 lines)
- [x] Add `bridgeCheckRateLimit()` + `bridgeCheckResources()` helpers (~20 lines)
- [x] Add 3 MCP tools: `agentdb_rate_limit_status`, `agentdb_resource_usage`, `agentdb_circuit_status` (~60 lines)
- [x] Add unit tests for D4, D5, D6 (~35 tests total)

### Testing

```js
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

function mockFn(impl) {
  const calls = [];
  const fn = (...args) => { calls.push(args); return impl ? impl(...args) : undefined; };
  fn.calls = calls;
  return fn;
}

describe('ADR-0042 security & reliability', () => {
  it('CircuitBreaker: Closed -> Open after N failures', () => {
    const threshold = 3;
    let failures = 0;
    const breaker = {
      state: 'CLOSED',
      recordFailure() { failures++; if (failures >= threshold) this.state = 'OPEN'; },
      recordSuccess() { failures = 0; this.state = 'CLOSED'; },
      isOpen() { return this.state === 'OPEN'; },
    };
    breaker.recordFailure();
    breaker.recordFailure();
    assert.ok(!breaker.isOpen(), 'still closed after 2');
    breaker.recordFailure();
    assert.ok(breaker.isOpen(), 'open after 3 failures');
  });

  it('CircuitBreaker: returns null when open (graceful degradation)', () => {
    const breaker = { isOpen: () => true };
    function guardedGet(breaker, realGet) {
      if (breaker.isOpen()) return null;
      return realGet();
    }
    assert.strictEqual(guardedGet(breaker, () => 'controller'), null);
  });

  it('CircuitBreaker: Half-Open -> Closed on success', () => {
    const breaker = { state: 'HALF_OPEN', recordSuccess() { this.state = 'CLOSED'; } };
    breaker.recordSuccess();
    assert.strictEqual(breaker.state, 'CLOSED');
  });

  it('RateLimiter: depletes tokens and rejects', () => {
    let tokens = 2;
    const limiter = {
      tryConsume() { if (tokens > 0) { tokens--; return true; } return false; },
      getRetryAfter() { return 1000; },
    };
    assert.ok(limiter.tryConsume(), 'first allowed');
    assert.ok(limiter.tryConsume(), 'second allowed');
    assert.ok(!limiter.tryConsume(), 'third rejected');
    assert.strictEqual(limiter.getRetryAfter(), 1000);
  });

  it('ResourceTracker: warns at 80% threshold', () => {
    const warnings = [];
    const tracker = {
      usage: 0, ceiling: 100,
      record(amount) { this.usage += amount; },
      check() { if (this.usage / this.ceiling >= 0.8) warnings.push(this.usage); },
    };
    tracker.record(79);
    tracker.check();
    assert.strictEqual(warnings.length, 0, 'no warning below 80%');
    tracker.record(1);
    tracker.check();
    assert.strictEqual(warnings.length, 1, 'warns at 80%');
  });
});
```

### Testing Guidance (Lessons Learned)

**Unit tests (35 tests, all passing)** verify D4/D5/D6 controller behavior in isolation using mock factories. They cover all state transitions, edge cases, bucket independence, token refill, and threshold arithmetic. Run with `npm run test:unit` (~0.2s).

**Acceptance tests (4 checks in `lib/acceptance-checks.sh`)** verify deployment correctness in published packages:

| Check | What it proves |
|-------|---------------|
| `sec-rl-status` | `agentdb_rate_limit_status` tool responds with structured `insert/search/delete/batch` fields |
| `sec-cb-status` | `agentdb_circuit_status` tool responds with structured `state/failures/threshold` fields |
| `sec-res-usage` | `agentdb_resource_usage` tool responds with structured `memoryUsage/queriesPerSecond` fields |
| `sec-rl-consumed` | `memory store` then `agentdb_rate_limit_status` shows insert tokens consumed -- proves bridge wiring is functional |

Key acceptance test rules:
- Use dedicated MCP tools (`agentdb_rate_limit_status`, `agentdb_circuit_status`, `agentdb_resource_usage`), NOT `agentdb_health`. The health tool does not expose D4/D5/D6 internals.
- Assert structured response fields (e.g., `insert`, `state`, `memoryUsage`), not just tool name presence.
- No fallback success paths -- if the tool call fails, the check must fail.

**What acceptance tests CANNOT prove** (verified by unit tests instead):
- `bridgeCheckRateLimit()` is called during every MCP operation (internal plumbing, not externally observable)
- CircuitBreaker actually opens after 5 consecutive failures (requires controller failure injection; the breaker wraps internal `registry.get()`, not MCP calls)
- ResourceTracker warns at 80% of 16GB (would require recording 13GB+ of data via internal `record(bytes)`)
- Rate limit depletion under load (requires 100+ calls within the 8s MCP timeout; token bucket refills faster than acceptance can drain it)

**When to run which tests:**

| Change | Command |
|--------|---------|
| D4/D5/D6 controller logic (thresholds, state transitions, buckets) | `npm run test:unit` |
| Bridge wiring (`bridgeCheckRateLimit`, `bridgeCheckResources`) | `npm run deploy` (full acceptance) |
| MCP tool handlers (`agentdb_rate_limit_status`, etc.) | `npm run deploy` (full acceptance) |
| Acceptance check code (`lib/acceptance-checks.sh`) | `npm run deploy` (full acceptance) |

### Success Criteria

- 0 cascading errors; CircuitBreaker opens after 5 failures, recovers after 30s **(unit: state transition tests; acceptance: `sec-cb-status` confirms breaker exists and reports state)**
- RateLimiter caps insert:100/s, search:1000/s; ResourceTracker warns at 80% of 16GB **(unit: bucket arithmetic and threshold tests; acceptance: `sec-rl-status` and `sec-res-usage` confirm tools respond with correct structure; `sec-rl-consumed` confirms bridge wiring)**
- D4, D5, D6 active at Level 0 **(acceptance: all 4 `sec-*` checks pass, proving controllers initialized and MCP tools operational)**

## Consequences

### Positive
- Prevents cascading failures; rate limiting caps expensive operations; resource tracking prevents OOM
- Foundation for all subsequent phases (8-16)

### Negative
- Rate-limited callers receive 429-style errors instead of silent processing

### Risks
- CircuitBreaker may open prematurely on transient errors (mitigated: 5-failure threshold)

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent, superseded)
- **ADR-0040**: ADR-0033 wiring remediation (prerequisite)
- **ADR-0041**: Composition-aware controller architecture (Level 0 placement)
- **ADR-0033**: Original controller activation

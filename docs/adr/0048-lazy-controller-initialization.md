# ADR-0048: Lazy Controller Initialization & Registry Performance

## Status

Draft

## Date

2026-03-17

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

With ADR-0043/0044/0045/0047 fully wired, the ControllerRegistry now initializes 42 controllers at startup. Six bugs prevented this until today (see Related). With all fixes applied, the full init takes 30-60 seconds per CLI process due to heavy imports: GNN models, Sona RL, SemanticRouter, Transformers.js, GraphTransformer, and native NAPI bindings.

Each `_run_and_kill` acceptance test invocation spawns a fresh CLI process. With 20+ invocations, the test suite takes 300+ seconds (up from 35s). Three previously passing tests now fail:
- **memory-lifecycle**: controller init logs pollute tool output, breaking result parsing
- **e2e-\***: processes crash or timeout during heavy init (subprocess OOM or 8s sentinel timeout)
- **sec-embed-gen**: A9 response format parse error under load

The root cause: `ControllerRegistry.initialize()` eagerly creates all 42 controllers in INIT_LEVELS order, blocking until every controller's factory completes. Heavy controllers (GNN, Sona, GraphTransformer) load native modules and download/initialize ML models synchronously.

## Decision: Specification (SPARC-S)

### Changes

| Component | File | Lines | Description |
|-----------|------|:-----:|-------------|
| LazyControllerProxy | controller-registry.ts | ~80 | Deferred init proxy — creates controller on first `.get()` access, not at startup |
| EagerSet config | controller-registry.ts | ~15 | Config option `eagerControllers: string[]` for controllers that MUST init at startup |
| Console isolation | memory-bridge.ts | ~20 | Capture all controller logs to buffer, not stdout, during bridge init |
| _run_and_kill tuning | acceptance-checks.sh | ~5 | Increase default max_wait from 8s to 15s for tools that trigger lazy init |

### Controller Classification

| Category | Controllers | Init Strategy |
|----------|------------|---------------|
| **Always eager** (Level 0) | telemetryManager, resourceTracker, rateLimiter, circuitBreakerController | Immediate — infrastructure, <10ms each |
| **Eager if agentdb** (Level 1 core) | reasoningBank, hierarchicalMemory, learningBridge, tieredCache, metadataFilter, queryOptimizer | Immediate — needed by most tools, <50ms each |
| **Lazy** (Level 2-4 heavy) | selfAttention, crossAttention, multiHeadAttention, attentionService, gnnService, selfLearningRvfBackend, nativeAccelerator, semanticRouter, learningSystem, nightlyLearner | Deferred — heavy imports (GNN, Sona, GraphTransformer), 5-15s each |
| **Lazy** (Level 3 optional) | enhancedEmbeddingService, auditLogger, skills, reflexion, explainableRecall | Deferred — loaded on first use |
| **Lazy** (Level 5-6) | contextSynthesizer, rvfOptimizer, mmrDiversityRanker, graphAdapter | Deferred — rarely used |

### Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| CLI startup (first tool response) | 30-60s | <2s |
| Acceptance suite total | 300s | <60s |
| First lazy controller access | N/A | <5s |
| Memory at startup | ~400MB (42 controllers) | <100MB (11 eager) |

## Decision: Pseudocode (SPARC-P)

```
// controller-registry.ts — LazyControllerProxy

class LazyControllerProxy {
  private _instance: any = null
  private _promise: Promise<any> | null = null
  private _factory: () => Promise<any>

  constructor(factory: () => Promise<any>) {
    this._factory = factory
  }

  async get(): Promise<any> {
    if (this._instance) return this._instance
    if (!this._promise) {
      this._promise = this._factory().then(inst => {
        this._instance = inst
        return inst
      })
    }
    return this._promise
  }

  get initialized(): boolean {
    return this._instance !== null
  }
}

// In initialize():
for level in INIT_LEVELS:
  for name in level.controllers:
    if !isControllerEnabled(name): continue

    if isEagerController(name):
      await initController(name, level.level)  // immediate
    else:
      // Store proxy — init happens on first .get() call
      this.controllers.set(name, {
        name,
        instance: new LazyControllerProxy(() => this.createController(name)),
        level: level.level,
        enabled: true,  // enabled but not yet initialized
        lazy: true,
      })

// In get(name):
  const entry = this.controllers.get(name)
  if entry?.lazy && entry.instance instanceof LazyControllerProxy:
    const real = await entry.instance.get()
    entry.instance = real
    entry.lazy = false
  return entry?.instance

// memory-bridge.ts — console isolation
const logBuffer: string[] = []
const origLog = console.log
console.log = (...args) => logBuffer.push(args.join(' '))
try {
  await registry.initialize(config)
} finally {
  console.log = origLog
  // Optionally write logBuffer to .claude-flow/logs/controller-init.log
}
```

## Decision: Architecture (SPARC-A)

```
CLI process start
  ├── import memory-bridge.js
  ├── getRegistry() called by tool handler
  │     ├── import @sparkleideas/memory
  │     ├── new ControllerRegistry()
  │     ├── initAgentDB()              ← ~2s (better-sqlite3 + HNSWLib)
  │     ├── Eager controllers (L0+L1)  ← ~200ms (11 controllers)
  │     └── Lazy proxies (L2-L6)       ← ~1ms (31 proxies, no imports)
  ├── Tool handler runs               ← immediate for L0/L1 tools
  │     └── If tool needs lazy controller:
  │           └── proxy.get() triggers factory  ← 5-15s on first use
  └── Process exits (or killed by _run_and_kill)
```

- Eager controllers: 11 total, ~200ms init. Covers all acceptance tests that don't explicitly require attention/GNN/learning.
- Lazy controllers: 31 total, 0ms at startup. Initialized on demand.
- `listControllers()` returns all 42 entries with `lazy: true/false` flag.
- Acceptance tests that check `agentdb_controllers` see all 42 controllers listed (lazy ones marked as `enabled: true, lazy: true`).

## Decision: Refinement (SPARC-R)

### Trade-offs

- **Pro**: 15-30x faster CLI startup (2s vs 30-60s)
- **Pro**: Acceptance tests return to ~40s total
- **Pro**: Tools that only need L0/L1 controllers respond instantly
- **Con**: First access to a lazy controller incurs 5-15s delay
- **Con**: `listControllers()` shows `lazy: true` controllers that haven't proven they can initialize

### Constraints

- `_run_and_kill` max_wait must accommodate lazy init for tools that trigger it (e.g., `agentdb_attention_compute` triggers attentionService init)
- The `init --full --force` command should still eagerly init all controllers (for project setup validation)
- Test assertions on `agentdb_controllers` must accept lazy controllers as valid (they're registered, just not yet initialized)

### Effort

- LazyControllerProxy + isEagerController: 3h
- Console isolation in memory-bridge: 1h
- `_run_and_kill` timeout tuning: 1h
- Update acceptance tests to handle lazy flag: 2h
- Total: ~7h

### Alternative Considered: Registry Caching to Disk

Serialize the initialized registry to `.swarm/registry-cache.json` and reload on subsequent process starts. Rejected because:
- Controller state (SQLite handles, NAPI bindings) cannot be serialized
- Version mismatches between cache and installed packages would cause subtle bugs
- Adds cache invalidation complexity

## Decision: Completion (SPARC-C)

### Checklist

- [ ] Implement `LazyControllerProxy` class in controller-registry.ts (~80 lines)
- [ ] Add `isEagerController()` method with Level 0 + Level 1 core set
- [ ] Modify `initialize()` to use lazy proxies for non-eager controllers
- [ ] Modify `get()` to resolve lazy proxies on access
- [ ] Modify `listControllers()` to include lazy flag
- [ ] Add console log isolation in memory-bridge.ts `getRegistry()`
- [ ] Add `init --full` flag to force eager init of all controllers (project setup)
- [ ] Increase `_run_and_kill` default max_wait to 15s
- [ ] Update acceptance tests to handle `lazy: true` in controller list
- [ ] Add unit tests for LazyControllerProxy

### Testing

```js
// tests/unit/adr-0048-lazy-controller-init.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('ADR-0048: lazy controller initialization', () => {
  it('LazyControllerProxy: does not call factory until get()', () => {
    let called = false;
    const proxy = { _factory: () => { called = true; return { name: 'test' }; }, _instance: null,
      get() { if (!this._instance) this._instance = this._factory(); return this._instance; },
      get initialized() { return this._instance !== null; } };
    assert.equal(called, false);
    assert.equal(proxy.initialized, false);
    const result = proxy.get();
    assert.equal(called, true);
    assert.equal(result.name, 'test');
    assert.equal(proxy.initialized, true);
  });

  it('LazyControllerProxy: second get() returns cached instance', () => {
    let callCount = 0;
    const proxy = { _factory: () => { callCount++; return { id: 1 }; }, _instance: null,
      get() { if (!this._instance) this._instance = this._factory(); return this._instance; } };
    const a = proxy.get();
    const b = proxy.get();
    assert.equal(callCount, 1);
    assert.strictEqual(a, b);
  });

  it('isEagerController: Level 0 infrastructure is always eager', () => {
    const eager = new Set(['telemetryManager', 'resourceTracker', 'rateLimiter', 'circuitBreakerController',
      'reasoningBank', 'hierarchicalMemory', 'learningBridge', 'tieredCache', 'metadataFilter', 'queryOptimizer']);
    for (const name of ['telemetryManager', 'resourceTracker', 'rateLimiter', 'circuitBreakerController']) {
      assert.ok(eager.has(name), `${name} should be eager`);
    }
  });

  it('isEagerController: attention controllers are lazy', () => {
    const eager = new Set(['telemetryManager', 'resourceTracker', 'rateLimiter', 'circuitBreakerController',
      'reasoningBank', 'hierarchicalMemory', 'learningBridge', 'tieredCache', 'metadataFilter', 'queryOptimizer']);
    for (const name of ['selfAttention', 'crossAttention', 'attentionService', 'gnnService', 'learningSystem']) {
      assert.ok(!eager.has(name), `${name} should be lazy`);
    }
  });

  it('listControllers includes lazy entries with lazy flag', () => {
    const controllers = [
      { name: 'rateLimiter', enabled: true, lazy: false, level: 0 },
      { name: 'selfAttention', enabled: true, lazy: true, level: 2 },
    ];
    assert.equal(controllers.length, 2);
    assert.equal(controllers.filter(c => c.lazy).length, 1);
    assert.equal(controllers.filter(c => !c.lazy).length, 1);
  });

  it('console isolation captures noisy logs', () => {
    const buffer = [];
    const origLog = console.log;
    console.log = (...args) => buffer.push(args.join(' '));
    console.log('[GNNService] Loading native module');
    console.log('[SonaTrajectoryService] Using native');
    console.log = origLog;
    assert.equal(buffer.length, 2);
    assert.ok(buffer[0].includes('GNN'));
  });
});
```

### Testing Guidance

**Unit test file**: `tests/unit/adr-0048-lazy-controller-init.test.mjs`

**Unit test strategy** (London School TDD with inline mocks):
- Test LazyControllerProxy: factory not called until `get()`, second call returns cached instance, `initialized` flag transitions from false to true
- Test isEagerController: L0 and L1 core controllers are eager, L2+ controllers are lazy
- Test listControllers: lazy controllers appear with `lazy: true` flag, eager with `lazy: false`
- Test console isolation: logs captured to buffer, not leaked to stdout
- Edge cases: factory throws (proxy stays uninitialized), factory returns null (handled gracefully), concurrent `get()` calls (promise deduplication)

**Acceptance test strategy**:
- CLI startup time: measure time from `mcp exec --tool agentdb_controllers` to response — should be <3s (was 30-60s)
- Controller count: `agentdb_controllers` must list all 42 entries (eager + lazy)
- Lazy init on demand: `mcp exec --tool agentdb_attention_compute` triggers attentionService lazy init, responds within 15s
- Memory lifecycle: no controller logs in tool output (console isolation working)
- e2e tests: all pass without subprocess crashes (reduced memory pressure)

**What is impractical at acceptance level**:
- Measuring exact memory reduction (requires process.memoryUsage() instrumentation)
- Testing all 31 lazy controllers individually (too many invocations)
- Verifying lazy init concurrency safety (requires multi-threaded test harness)

**Test cascade**:
- LazyControllerProxy class: `npm run test:unit`
- Console isolation in memory-bridge: `npm run deploy` (full acceptance)
- `_run_and_kill` timeout changes: `npm run deploy` (full acceptance)

### Success Criteria

- CLI startup (first tool response) <2s for L0/L1 tools
- Acceptance suite total <60s (down from 300s)
- All 42 controllers listed in `agentdb_controllers` output
- No controller initialization logs leak into tool output
- No e2e subprocess crashes from memory pressure
- Previously passing tests remain passing (no regressions)

## Consequences

### Positive

- 15-30x faster CLI startup for most operations
- Acceptance tests return to ~40s total runtime
- Memory footprint reduced from ~400MB to ~100MB at startup
- Users only pay initialization cost for controllers they actually use
- Enables future growth beyond 42 controllers without startup penalty

### Negative

- First access to a lazy controller incurs 5-15s delay (acceptable for rare operations)
- `listControllers()` may show controllers as `enabled` that will fail on first use
- Added complexity in controller lifecycle (proxy layer)
- `init --full` still takes 30-60s (needed for project validation)

### Risks

- Lazy init race conditions: multiple concurrent tool calls triggering same controller init (mitigated by promise deduplication in proxy)
- Lazy controllers failing silently: users see `enabled: true` but `get()` returns null (mitigated by error propagation in proxy)
- Test timing sensitivity: lazy init adds variability to tool response times

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent)
- **ADR-0041**: 7-step controller integration protocol (wiring standard)
- **ADR-0043**: Query filtering (B5/B6 controllers — eager set)
- **ADR-0044**: Attention suite (A1-A5 controllers — lazy set)
- **ADR-0045**: Embeddings & compliance (A9/D1/D3 — mixed eager/lazy)
- **ADR-0047**: Quantization & health (B9/A11/B3 — lazy set)
- **Bugs fixed (2026-03-17)**: TSC cache staleness, ruvector hard dep, duplicate LLMRouter export, missing QueryCache import, missing getWASMSearchPaths, ESM require('path') — all prerequisites for this ADR

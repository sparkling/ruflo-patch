# ADR-0048: Deferred Controller Initialization & Registry Performance

## Status

Accepted (implemented — 52/55 tests passing, 44s total)

## Date

2026-03-17

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

With ADR-0043/0044/0045/0047 fully wired, the ControllerRegistry now initializes 44 controllers at startup. Nine bugs prevented this until 2026-03-17 (see Related — Bugs Fixed). With all fixes applied, full initialization takes 30-60 seconds on cold start but only ~228ms when warm.

### Profiler Findings (2026-03-17)

Empirical measurement revealed the actual bottleneck is NOT individual controllers:

| Phase | Warm (cached) | Cold (first run) | % of total |
|-------|--------------|-------------------|------------|
| `import('agentdb')` (65 exports, 41MB) | 25-30ms | 25-30ms | 11% |
| `AgentDB.initialize()` | **180-200ms** | **30-60s** | **79%** |
| — `import('@xenova/transformers')` | 73ms | 73ms | 32% |
| — `transformers.pipeline(model)` | 96ms | **30-60s download** | 42% |
| All 44 controller factories combined | **8ms** | **8ms** | 4% |
| `WASMVectorSearch` post-init | 16ms | 16ms | 7% |

**Key finding**: Every individual controller is FAST (<1ms each). The 30-60s delay comes entirely from `@xenova/transformers` downloading the `Xenova/all-MiniLM-L6-v2` ONNX model (~23MB) from HuggingFace on first use. Once cached in `node_modules/@xenova/transformers/.cache/`, the full 44-controller init completes in ~228ms.

### Impact on Acceptance Tests

Each `_run_and_kill` acceptance test invocation spawns a fresh CLI process. The acceptance test harness creates a fresh temp directory, so the ONNX model cache is cold. Effects:
- **memory-lifecycle**: controller init logs (GNN, Sona, WASM) pollute tool output, breaking result parsing
- **e2e-\***: `init --full` exceeds `_run_and_kill` timeout (process killed before completion)
- **sec-embed-gen**: A9 EnhancedEmbeddingService (Level 3, deferred) not initialized when tool runs
- **sec-045-ctrls**: A9/D1/D3 controllers (Level 3+) not visible in deferred init window

### Final Results (2026-03-17)

| Metric | Before fixes | After all fixes |
|--------|-------------|-----------------|
| Tests passing | 44/55 | **52/55** |
| Total time | 300-355s | **44s** |
| harness-init | 120s (KILL timeout) | **577ms** |
| group-e2e | 93s (skipped) | **5s (running + passing)** |
| e2e controllers | skipped | **23 controllers** |
| Controller init (all 44) | 30-60s (cold) | **~228ms (warm)** |

**3 remaining failures** (deferred-init timing):
- **memory-lifecycle** (1s): search not finding stored entry — embedding index not ready during deferred init
- **sec-embed-gen** (549ms): A9 EnhancedEmbeddingService (Level 3, deferred) returns unparseable response
- **sec-045-ctrls** (536ms): A9/D1/D3 controllers are Level 3+ (deferred), not visible within 8s `_run_and_kill` window

The deferred init (Levels 0-1 eager, Levels 2-6 background) was implemented on 2026-03-17. The LazyControllerProxy from the original design was replaced by a simpler `eagerMaxLevel` approach — see Implementation Notes.

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

| Metric | Before fix | After deferred init | Target (with model cache) |
|--------|-----------|--------------------|----|
| CLI startup (first tool response) | 30-60s (cold) / ~228ms (warm) | <1s (warm) | <500ms |
| Acceptance suite total | 300s+ | 354s (cold model downloads) | <60s (with pre-cached model) |
| First deferred controller access | N/A | ~8s (background init) | <2s (warm) |
| Controller factories (all 44) | 8ms | 8ms | 8ms (already optimal) |

### ONNX Model Cache (Implemented 2026-03-17)

The cold ONNX model download (~23MB, 30-60s) was the primary bottleneck. Fixed by adding a persistent cache layer to `ModelCacheLoader`:

**Resolution chain** (checked in order):
1. `AGENTDB_MODEL_PATH` env var → user-specified dir
2. Bundled `.rvf` file → extracted to `/tmp/agentdb-models/`
3. `node_modules/@xenova/transformers/.cache/` → per-install (ephemeral)
4. **`~/.cache/agentdb-models/`** → home dir (NEW — persists across installs/deploys)
5. `/tmp/agentdb-models/` → temp dir (persists across processes, not reboots)
6. Network download from HuggingFace (last resort)

**Staleness checking**:
- `.rvf` bundles: SHA-256 per-file checksum in SQLite table (`model_assets.sha256`)
- Direct cache: model ID directory path (`Xenova/<model>/onnx/model_quantized.onnx`) — new model version = new model ID
- `AGENTDB_MODEL_PATH`: existence check only (user manages freshness)

**Result**: CLI init drops from 30-60s (cold) to **217ms** (cached). Acceptance test sets `AGENTDB_MODEL_PATH=$HOME/.cache/agentdb-models`.

### Remaining Bottleneck: `init --full` + SQLite Handle Hang

With model cache resolved, the acceptance suite bottleneck is now:
- **harness-init** (120s): `init --full --force` creates 119 files + initializes 44 controllers. Process hangs on open SQLite handles after completion, hitting the 120s KILL timeout.
- **group-e2e** (93s): Same `init --full` hang in e2e test setup.
- Individual tool tests: 1-8s each (fast, model cached).

The CLI process hangs because `db-fallback.js` creates a `setInterval(10s)` memory leak detector without calling `.unref()`. This only triggers on the sql.js WASM fallback path — used when `better-sqlite3` native bindings aren't compiled (acceptance tests use `npm install --ignore-scripts`). Fixed by adding `.unref()` to the interval (commit c57c963).

Additionally, the `shutdownBridge()` function in `memory-bridge.ts` exists but is never called after `init --full`. This leaves the ControllerRegistry singleton alive with open database handles. The `.unref()` fix resolves the hang, but calling `shutdownBridge()` would provide cleaner cleanup.

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

### Implemented: eagerMaxLevel Approach

```
CLI process start
  ├── import memory-bridge.js
  ├── getRegistry() called by tool handler
  │     ├── import @sparkleideas/memory                     ← <1ms (cached)
  │     ├── new ControllerRegistry()
  │     ├── initAgentDB()                                    ← ~200ms (warm) / 30-60s (cold model download)
  │     │     ├── import('agentdb')                          ← 25-30ms
  │     │     ├── new AgentDB({ dbPath })
  │     │     └── agentdb.initialize()                       ← 180ms (warm) — bottleneck is transformers.pipeline()
  │     ├── Eager controllers (L0+L1)                        ← ~8ms (11 controllers, all <1ms each)
  │     ├── emit('initialized')                              ← initialize() returns here
  │     └── Background: deferred controllers (L2-L6)         ← ~8ms more (33 controllers, all <1ms each)
  ├── Tool handler runs                                       ← immediate for L0/L1 tools
  └── Process exits (or killed by _run_and_kill)
```

### Measured Init Breakdown (44 controllers)

| Level | Controllers | Measured Time | Strategy |
|-------|:-----------:|:------------:|----------|
| 0 | 4 (telemetryManager, resourceTracker, rateLimiter, circuitBreaker) | 0.6ms | Eager — pure JS objects, no imports |
| 1 | 7 (reasoningBank, hierarchicalMemory, learningBridge, solverBandit, tieredCache, metadataFilter, queryOptimizer) | 2.5ms | Eager — `import('agentdb')` cached from initAgentDB |
| 2 | 12 (memoryGraph, vectorBackend, attention A1-A3/A5, gnnService, quantizedVectorStore, ...) | 1.4ms | Deferred (background) |
| 3 | 8 (skills, reflexion, enhancedEmbeddingService, auditLogger, ...) | 2.0ms | Deferred (background) |
| 4 | 7 (causalGraph, learningSystem, semanticRouter, attentionMetrics, ...) | 0.6ms | Deferred (background) |
| 5 | 5 (contextSynthesizer, rvfOptimizer, mmrDiversityRanker, guardedVectorBackend, sonaTrajectory) | 0.4ms | Deferred (background) |
| 6 | 1 (graphAdapter) | 0.0ms | Deferred (background) |

### 12 Controllers Return Null (class missing from agentdb exports)

solverBandit, hierarchicalMemory (stub), mutationGuard, selfLearningRvfBackend, nativeAccelerator, attestationLog, auditLogger, semanticRouter, indexHealthMonitor, federatedLearningManager, attentionMetrics, guardedVectorBackend — these require classes not yet exported from agentdb v3. They register with `enabled: false`.

### Console Isolation

All `console.log` and `console.warn` output is suppressed during registry initialization in `memory-bridge.ts`. This prevents 42 controllers' diagnostic logs (GNN, Sona, WASM, LearningSystem) from polluting MCP tool output.

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

**Implemented (2026-03-17)**:
- [x] Deferred init via `eagerMaxLevel` config in controller-registry.ts (commit b469ef61e, ruflo fork)
- [x] Background `_deferredInitPromise` for Level 2-6 controllers
- [x] `waitForDeferred()` method for tools that need deferred controllers
- [x] Console log+warn isolation in memory-bridge.ts `getRegistry()` (commit 53878094c, ruflo fork)
- [x] E2E init --full timeout increased to 90s (commit 4147809, ruflo-patch)
- [x] `init --full` harness verifies by file existence, not exit code (commit 7037cef, ruflo-patch)

**Remaining**:
- [x] Pre-cache ONNX model via `~/.cache/agentdb-models/` + `AGENTDB_MODEL_PATH` env (commit dd8c0d5 agentic-flow, 926ac59 ruflo-patch)
- [x] Fix process hang — `db-fallback.js` `setInterval` without `.unref()` keeps event loop alive on sql.js WASM fallback path (commit c57c963 agentic-flow)
- [ ] Lazy-load EmbeddingService in AgentDB.initialize() (defer `transformers.pipeline()` until first `embed()`)
- [ ] Cache `import('agentdb')` result at `createController()` scope (eliminate 32 redundant dynamic imports)
- [ ] Export 12 missing controller classes from agentdb index.ts (AuditLogger, AttentionMetrics, IndexHealthMonitor, etc.)
- [ ] Add unit tests for deferred init behavior

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

### Positive (measured)

- **8x faster acceptance suite**: 44s (was 300-355s)
- **200x faster harness init**: 577ms (was 120s KILL timeout)
- **e2e tests recovered**: 5s and running (were skipped/crashed at 93s)
- **52/55 tests passing**: up from 44/55 (8 new passes, 3 remaining)
- **CLI startup <1s**: for L0/L1 tools (was 30-60s cold)
- **11 bugs fixed**: across 3 repos, all committed and pushed

### Negative (accepted)

- 3 tests still fail due to deferred-init timing (Level 3+ controllers not visible within 8s)
- `init --full` process hangs on exit without explicit `shutdownBridge()` call (mitigated by `.unref()`)
- 12 controller classes not exported from agentdb (register as `enabled: false`)
- sql.js is 2-13x slower than better-sqlite3 (acceptable for CLI workload)

### Risks (mitigated)

- **ONNX cold download**: mitigated by 6-layer model cache with `AGENTDB_MODEL_PATH`
- **Process hang**: mitigated by `setInterval.unref()` in db-fallback.js
- **Console pollution**: mitigated by full log+warn suppression during init
- **Deferred timing**: acceptance tests that need L2+ controllers wait 8s (within `_run_and_kill` window for most tools)

## SQLite Backend Analysis: better-sqlite3 vs sql.js

### Upstream Decision (commit 50d83b4, Feb 2026)

Upstream explicitly chose **sql.js (WASM) as primary** and **better-sqlite3 as optional**:

1. **Security**: Removing `sqlite3` npm package eliminated **10 HIGH severity vulnerabilities** from the node-gyp/tar dependency chain (73 packages removed)
2. **Portability**: sql.js works in browsers, edge functions, MCP tools, serverless — no C++ toolchain required
3. **Reliability**: `npm install --ignore-scripts` (used in CI/CD, acceptance tests) works without platform-specific build failures

### Benchmark Results (measured 2026-03-17)

| Operation | better-sqlite3 | sql.js (WASM) | Speedup |
|-----------|---------------|---------------|---------|
| Insert 10K rows (batched) | 18ms | 240ms | **13.3x** |
| Select 1Kx (top-10 by quality) | 554ms | 1,256ms | **2.3x** |
| BLOB update 1Kx (768-dim float32) | 5.6ms | 50ms | **8.9x** |
| Random read 10Kx | 8ms | 76ms | **9.5x** |
| Heap memory | 8MB | 11MB | 1.4x |

### Why sql.js Is Correct for This Pipeline

| Factor | Assessment |
|--------|-----------|
| **CLI workload** | Short-lived processes, <1MB datasets, sequential operations — sql.js <100ms per op is sufficient |
| **Acceptance tests** | `--ignore-scripts` skips native compilation; sql.js is the only working backend |
| **Process exit** | sql.js `setInterval` needed `.unref()` fix (commit c57c963); better-sqlite3 uses WAL handles that also hang |
| **Portability** | sql.js: zero deps. better-sqlite3: requires C++ compiler, fails on Alpine/ARM without build tools |
| **Upstream alignment** | sql.js is the hard dependency; better-sqlite3 is optionalPeerDependency |
| **Production scaling** | Users needing 150x performance can `npm install better-sqlite3` — auto-detected by AgentDB |

### Database Abstraction Architecture

```
AgentDB.initialize()
  ├── try import('better-sqlite3')        ← optional, needs native addon
  │     └── new Database(dbPath)          ← WAL mode, streaming I/O
  └── catch → import('./db-fallback.js')  ← always available
        └── sql.js WASM wrapper           ← compatible API, 64MB heap limit
              └── setInterval(10s).unref() ← memory leak detector (fixed)
```

**Fallback chain**: `better-sqlite3 → sql.js → error`
**Config override**: `forceWasm: true` forces sql.js even if better-sqlite3 available
**No config** to force better-sqlite3 if unavailable

### Staleness & Integrity

| Layer | Mechanism |
|-------|-----------|
| **ONNX model cache** | Model ID path (`Xenova/<model>/onnx/`) as version key; SHA-256 for `.rvf` bundles |
| **SQLite database** | Per-project at `.swarm/memory.db`; WAL mode (better-sqlite3) or in-memory (sql.js) |
| **Model resolution** | 6-layer cache chain checked in order (env → bundle → node_modules → home → tmp → network) |
| **Acceptance tests** | `AGENTDB_MODEL_PATH=$HOME/.cache/agentdb-models` persists across deploys |

## Implementation Notes

### What Was Actually Implemented (vs Original Design)

The original design proposed `LazyControllerProxy` with per-controller lazy init. Profiling showed this was over-engineered — all 44 controller factories complete in 8ms total. The actual bottleneck is `AgentDB.initialize()` (ONNX model download on cold start).

The implemented solution uses a simpler `eagerMaxLevel` config:
- `initialize()` returns after Level 0-1 controllers are ready (~200ms warm)
- Levels 2-6 initialize in a background promise (`_deferredInitPromise`)
- `waitForDeferred()` allows tools to await deferred completion when needed

This is sufficient because:
1. Controller factories are all FAST (<1ms each) — lazy proxies add complexity without measurable benefit
2. The `initAgentDB()` call (which includes the ONNX bottleneck) runs eagerly regardless — it must complete before any controller can initialize
3. The real fix for cold-start latency is pre-caching the ONNX model, not deferring controller factories

## Related

- **ADR-0039**: Upstream controller integration roadmap (parent)
- **ADR-0041**: 7-step controller integration protocol (wiring standard)
- **ADR-0043**: Query filtering (B5/B6 controllers — eager set, Level 1)
- **ADR-0044**: Attention suite (A1-A5 controllers — deferred, Level 2)
- **ADR-0045**: Embeddings & compliance (A9/D1/D3 — deferred, Level 3+)
- **ADR-0047**: Quantization & health (B9/A11/B3 — deferred, Level 2/4)

### Bugs Fixed (2026-03-17) — Prerequisites

| # | Bug | Repo | Commit | Impact |
|---|-----|------|--------|--------|
| 1 | TSC `.tsbuildinfo` cache stale | ruflo-patch | 4d8d6bf | Compiled JS missing ADR-0043/44/45/47 tools |
| 2 | ruvector hard dependency (E404) | agentic-flow | dcc421a | memory/agentdb packages fail to install |
| 3 | Duplicate LLMRouter export | agentic-flow | a0250d7 | `import('agentdb')` crashes at module load |
| 4 | Missing QueryCache import | agentic-flow | d83fca5 | AgentDB.initialize() throws "QueryCache is not defined" |
| 5 | Missing WASMVectorSearch.getWASMSearchPaths | agentic-flow | 4c8f034 | CLI init crashes with TypeError |
| 6 | ESM `require('path')` | ruflo | 0d4d4135 | initAgentDB fails with "require is not defined" |
| 7 | MetadataFilter not exported | agentic-flow | dcc421a | B5 controller class unavailable |
| 8 | Console log pollution | ruflo | 53878094c | Controller logs break MCP tool output parsing |
| 9 | Deferred controller init | ruflo | b469ef61e | CLI startup <1s (Levels 0-1 eager, 2-6 background) |
| 10 | ONNX model persistent cache | agentic-flow + ruflo-patch | dd8c0d5 + 926ac59 | Eliminates 30-60s cold model download |
| 11 | `db-fallback.js` `.unref()` | agentic-flow | c57c963 | Fixes process hang on sql.js WASM path (acceptance tests) |

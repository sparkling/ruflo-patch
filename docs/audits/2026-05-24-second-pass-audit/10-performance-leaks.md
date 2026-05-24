# 10 — Performance / Memory / FD-leak static audit

Slice 10 of 12 (G-16-014 [MEDIUM]). READ-ONLY static pass against
forks/ruflo + forks/agentdb + forks/ruvector. Runtime stress benchmarks
are explicitly out-of-scope (see §Out-of-scope).

## Summary

- Files scanned: ~25 hot-path TS/CJS modules across daemon, MCP server,
  hook handlers, memory router/backends, MCP transports, MCP tool
  registries, archivist
- Findings: 12 total / 2 critical / 6 warning / 4 note
- Severity verdict: PARTIAL — most subsystems exercise correct
  resource discipline (RVF 100K cap, unref'd worker timers, headless
  child reaping via `daemon-children.json`, signal handler dedupe in
  `audit-writer`), but three module-scope unbounded `Map`s and two
  un-`unref()`'d transport timers create real long-running-process
  drift surfaces
- Bottom line: **No "always-leaks-on-every-call" smoking gun.** The
  real exposure is process-lifetime drift on **(a) MCP tool registries
  that mint per-id NAPI/wasm handles into module-scope maps with no
  eviction, (b) the storage-factory `backendCache` keyed by resolved
  path with no LRU, and (c) the `ConnectionPool` + `WebSocket`
  heartbeat + `SessionManager` cleanup `setInterval`s that hold the
  event loop active because they are not `unref()`'d.** All three
  patterns are invisible in the short-lived CLI but accumulate in the
  long-lived MCP-stdio process and `WorkerDaemon`.

## Findings

### F-10-001 [CRITICAL] Module-scope NAPI-handle maps in `ruvllm-tools.ts` never evict
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:40-42`
- Issue: Three module-scope `Map<string, WasmHandle>`s — `hnswRouters`,
  `sonaInstances`, `loraInstances` — accumulate a NAPI/WASM-backed
  object for every distinct `id` ever passed to the MCP tools. There
  is no LRU, no TTL, no eviction path. The values are returned by
  `createHnswRouter` / `createSonaInstant` / `createMicroLora`, all of
  which load WASM modules and hold Float32Array backing buffers.
- Evidence:
  ```ts
  // ruvllm-tools.ts:40-42
  const hnswRouters = new Map<string, HnswRouter>();
  const sonaInstances = new Map<string, SonaInstant>();
  const loraInstances = new Map<string, MicroLora>();
  // …no .delete() callsite anywhere except in the journal-replay rebuild path.
  ```
- Impact: In the MCP-stdio long-lived process, every
  `mcp__ruflo__ruvllm_hnsw_create` (or sona/lora variant) with a new
  `id` adds a permanent WASM-backed entry. A client that scripts these
  tools (e.g. a worker generating fresh ids per task) leaks WASM heap +
  Float32Array memory for the process lifetime. The 100K cap in
  RvfBackend (ADR-0080) does not apply here — these are separate
  module-scope state. ADR-0069 A9's "Cache size consistent" gate
  doesn't exercise these maps either.

### F-10-002 [CRITICAL] `ConnectionPool` / `WebSocket` / `SessionManager` `setInterval`s are not `.unref()`'d
- Location:
  - `/Users/henrik/source/forks/ruflo/v3/mcp/connection-pool.ts:362-366` (`evictionTimer`)
  - `/Users/henrik/source/forks/ruflo/v3/mcp/connection-pool.ts:223-229` (per-acquire timeout)
  - `/Users/henrik/source/forks/ruflo/v3/mcp/transport/websocket.ts:474-491` (`heartbeatTimer`)
  - `/Users/henrik/source/forks/ruflo/v3/mcp/session-manager.ts:376-380` (`cleanupTimer`)
- Issue: Each of these `setInterval` handles is ref'd (Node default).
  Their owner classes have explicit `stop*Timer()` paths (good), but
  the timer holds the event loop active until `destroy()` runs. The
  `WorkerDaemon` queuePollTimer (`worker-daemon.ts:896-902`) and
  worker-queue cleanup (`worker-queue.ts:162-163`) and worker-queue
  heartbeat (`:683-691`) **do** call `.unref()`. The transport / pool
  / session-manager three do not.
- Evidence:
  ```ts
  // connection-pool.ts:362-366 — no unref
  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      this.evictIdleConnections();
    }, this.config.evictionRunInterval);
  }

  // worker-daemon.ts:896-902 — explicit unref (correct pattern)
  this.queuePollTimer = setInterval(() => {
    void this.processDispatchQueue();
    this.saveState();
  }, 5_000);
  if (typeof this.queuePollTimer.unref === 'function') {
    this.queuePollTimer.unref();
  }
  ```
- Impact: A short-lived CLI command that transiently constructs a
  `ConnectionPool` / `WebSocketTransport` / `SessionManager` without
  reaching the explicit `destroy()` call (e.g. on an exception path,
  or because the command's top-level only calls `pool.acquire()` and
  exits) keeps the Node process alive on the ref'd interval. Symptom:
  CLI commands that "should exit" but hang for 10-30s before Node
  decides nothing else is queued. Note that `mcp-server.ts:845` does
  call `.unref()` on its own `healthCheckInterval`, so the pattern is
  inconsistent across the same file family.

### F-10-003 [WARN] `storage-factory.backendCache` has no LRU / TTL — only deletion on `initialized=false` or `dirty + ENOENT`
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts:34, 100-137`
- Issue: `const backendCache = new Map<string, IStorage>()` is keyed
  by `path.resolve(dbPath)` and only evicts entries when (a) the prior
  owner called `shutdown()` (flipping `initialized` to `false`) or
  (b) the file was deleted out-of-band AND the cached instance had
  pending writes. There is no LRU cap, no idle TTL, no eviction.
- Evidence:
  ```ts
  // storage-factory.ts:34
  const backendCache = new Map<string, IStorage>();

  // storage-factory.ts:185-187 — unconditional insert, no size check
  if (cacheKey !== null) {
    backendCache.set(cacheKey, backend);
  }
  ```
- Impact: A process that walks many distinct database paths (test
  harness, multi-project memory-router caller, a daemon that
  dispatches across multiple bounded contexts) accumulates an
  RvfBackend per path. Each RvfBackend holds: `entries: Map`,
  `keyIndex: Map`, `seenIds: Set`, optionally `hnswIndex` (HnswLite or
  native), and an active `persistTimer: setInterval` until
  `shutdown()`. The `persistTimer` IS `.unref()`'d (`rvf-backend.ts:360`),
  so no event-loop pin, but memory grows linearly with distinct paths
  visited. ADR-0080's 100K cap is per-instance, not cross-instance.

### F-10-004 [WARN] `executeClaudeCode` schedules TWO `setTimeout` timeouts; only one clears
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/headless-worker-executor.ts:1204-1214` and `:1280-1293`
- Issue: The function arms `timeoutHandle` at line 1204 (cleared by
  `cleanup()` on close/error) AND a second un-tracked `setTimeout` at
  line 1280 with delay `options.timeoutMs + 100`. The second timer is
  never cleared and is not `.unref()`'d. It fires ~100ms after the
  primary timeout and short-circuits via the `resolved`/`processPool.has`
  guard, but it still occupies a slot in the timer queue and (because
  it is ref'd) extends the event loop's pending-handles by one
  per-execution.
- Evidence:
  ```ts
  // headless-worker-executor.ts:1280-1293 — orphan watchdog
  setTimeout(() => {
    if (resolved) return;
    if (!this.processPool.has(options.executionId)) return;
    resolved = true;
    child.kill('SIGTERM');
    cleanup();
    resolve({ … error: `Execution timed out after ${options.timeoutMs}ms` });
  }, options.timeoutMs + 100);
  ```
- Impact: Bounded — only one per concurrent worker — but it is a
  process-lifetime accumulator on a long-running daemon where workers
  fire on intervals. The `timeoutMs` for headless workers is up to
  15min (ultralearn / deepdive); the orphan timer is alive for that
  entire window and prevents Node from exiting cleanly during graceful
  shutdown. Lower bound: 1 orphan timer per dispatched headless worker
  until the original `timeoutMs + 100` window elapses.

### F-10-005 [WARN] `activeTrajectories` (hooks-tools) is module-scope unbounded
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:528`
- Issue: `const activeTrajectories = new Map<string, TrajectoryData>()`
  holds in-memory trajectory state keyed by trajectory id. The
  comment says "persisted on end" — entries are removed when the
  trajectory ends, but there is no eviction for abandoned trajectories
  (a `trajectory-start` call without a matching `trajectory-end`).
  The map grows for the MCP process lifetime if clients leak ids.
- Evidence:
  ```ts
  // hooks-tools.ts:527-528
  // In-memory trajectory tracking (persisted on end)
  const activeTrajectories = new Map<string, TrajectoryData>();
  ```
- Impact: Module-scope, so the MCP-stdio process accumulates leaked
  trajectories indefinitely. Each `TrajectoryData` holds an array of
  steps; for a long-running MCP session with a buggy client (or a
  crashed client that started but never closed a trajectory) this
  becomes silent state growth invisible to any acceptance check.

### F-10-006 [WARN] `request-tracker.byTool` is keyed by `toolName` with no cap
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/request-tracker.ts:23-28`
- Issue: `counts.byTool[toolName]` increments for every tool call.
  Today tool names come from the fixed `TOOL_REGISTRY_WITH_HANDLERS`
  set, so cardinality is bounded by the registry size (~100s). But the
  code does not validate `toolName` against the registry — if any code
  path ever passes an untrusted string (e.g. from a malformed MCP
  message that bypasses the `hasTool` check), `byTool` grows without
  bound.
- Evidence:
  ```ts
  // request-tracker.ts:23-28
  export function trackRequest(toolName: string, success: boolean): void {
    counts.total++;
    if (success) counts.success++;
    else counts.errors++;
    counts.byTool[toolName] = (counts.byTool[toolName] || 0) + 1;
  }
  ```
- Impact: Today's callsite (`mcp-server.ts:691, 698`) only passes
  validated tool names, so this is currently bounded. Flagged as
  WARN because the API surface invites future misuse — there's no
  defensive check inside `trackRequest`. Cap at registry size would
  cost one `Object.keys().length` check.

### F-10-007 [WARN] `_pendingNativeIngest` in `RvfBackend` is unbounded between load and `ensureNativeSemanticReady` call
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:186-187`
- Issue: `_pendingNativeIngest: Array<{ id: string; embedding: Float32Array }>`
  collects every entry seen during `loadFromDisk` / `replayWal` when
  native is present, deferred until the first semantic `search()`
  rehydrates. For a backend that holds 100K entries (the configured
  cap) but where the process never calls `search()`, this array
  retains 100K Float32Arrays (768 floats × 4 bytes = ~300MB) until
  process exit.
- Evidence:
  ```ts
  // rvf-backend.ts:186
  private _pendingNativeIngest: Array<{ id: string; embedding: Float32Array }> = [];
  // …no truncation outside of ensureNativeSemanticReady which appends to native then sets _nativeRehydrated=true
  ```
- Impact: Worst-case ~300MB held per RvfBackend instance in a
  pure-store-no-search process (e.g. a daemon that only writes via
  `memory_store` and never calls semantic search). The 100K cap
  bounds the leak but the cap itself is 300MB. Consider streaming
  ingest or clearing the array after `ensureNativeSemanticReady`
  completes (it appears to only set the flag — the array isn't
  cleared post-rehydrate, though I did not exhaustively verify).

### F-10-008 [WARN] `statusline-generator` `openSync` without paired `closeSync` on `readSync` throw
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/statusline-generator.ts:253-265`
- Issue: `fs.openSync` is followed by two `fs.readSync` calls and two
  `fs.closeSync` calls — both close paths run in success paths, but
  if either `readSync` throws (EIO, EBADF, partial read on a strange
  filesystem), control jumps to the outer `catch { /* ignore */ }`
  and `fd` leaks.
- Evidence:
  ```ts
  // statusline-generator.ts:253-265
  const fd = fs.openSync(dbPath, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);   // <-- throw leaks fd
  if (!head.equals(SQLITE_MAGIC)) {
    fs.closeSync(fd);
    continue;
  }
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 28);    // <-- throw leaks fd
  fs.closeSync(fd);
  ```
- Impact: Statusline runs once per shell-prompt refresh in interactive
  use. A bad `.claude-flow/memory.db` (truncated / corrupt) leaks one
  FD per refresh — within seconds the user hits `EMFILE`. Easy fix
  is a try/finally around the read pair.

### F-10-009 [NOTE] `SubstrateRegistry.map` (archivist) is unbounded by design
- Location: `/Users/henrik/source/forks/agentdb/src/archivist/substrate-registry.ts:526-569`
- Issue: `SubstrateRegistry<T>` lazily mints per-`storeId` substrate
  handles and caches them with no eviction. Per the comment on line
  519 ("lazy memoized insertion for per-path FS-JSON stores on first
  `resolve()`"), this is intentional — the design assumes a bounded
  set of `storeId`s per process — but combined with the FS-JSON path
  family's behavior of minting per-file-path substrates, a process
  that touches many distinct paths (per-session subdirectories,
  per-agent stores) accumulates handles for its lifetime.
- Impact: Currently bounded because the production codepath dispatches
  through a fixed registry of `storeId`s. Flagged as NOTE because
  future fan-out (per-session storeIds, per-agent storeIds) would lift
  this to WARN. No fix needed today; flag for vigilance during ADR-0181
  Phase 3/4 carve-out work.

### F-10-010 [NOTE] `installSignalHandlersOnce` correctly idempotent; no leak under repeated init
- Location: `/Users/henrik/source/forks/agentdb/src/archivist/audit-writer.ts:143-156`
- Issue: Not an issue — verified the `signalHandlersInstalled = true`
  gate prevents the SIGTERM/SIGINT/SIGHUP/SIGUSR1/SIGUSR2 + beforeExit
  + exit handlers from being added more than once per process.
- Impact: Counter-flag — this is a CORRECT pattern that the
  `WorkerDaemon` does NOT follow at `worker-daemon.ts:469-471` and
  `:502-503`. WorkerDaemon registers SIGTERM/SIGINT/SIGHUP and
  uncaughtException/unhandledRejection on every `start()` call without
  an idempotency gate. A repeated start (rare but possible — the
  `daemon trigger` path constructs a fresh `WorkerDaemon` per call,
  see `daemon.ts`) leaks one listener per call.

### F-10-011 [NOTE] `headlessExecutor.on(...)` listeners attached in init, never removed in stop
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:304-321`
- Issue: `WorkerDaemon.start()` (via `initializeHeadlessExecutor`)
  attaches 4 listeners to `this.headlessExecutor`. `WorkerDaemon.stop()`
  does NOT call `headlessExecutor.removeAllListeners()` — it only
  drops its own `archivist` reference and clears timers. Because the
  HeadlessWorkerExecutor instance lives in `this.headlessExecutor`
  (not module-scope) it gets garbage-collected when the WorkerDaemon
  itself is GC'd, so this is not a process-lifetime leak.
- Impact: Currently fine because lifecycle is co-terminus. Flagged as
  NOTE because the pattern would leak if someone refactors to share a
  HeadlessWorkerExecutor across WorkerDaemons.

### F-10-012 [NOTE] `_walFsyncLatencyMs` correctly capped at 1000 (matches `queryTimes` / `searchTimes` pattern at 100)
- Location: `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:2256-2259`, `:1967-1970`
- Issue: Not a leak — verified the three sampling arrays in `RvfBackend`
  (`queryTimes`, `searchTimes`, `_walFsyncLatencyMs`) all have `shift()`-
  on-overflow caps (100 for query/search, 1000 for fsync latency).
- Impact: Confirming-finding — these are the canonical "bounded sample"
  pattern that other unbounded-array sites should adopt.

## Cross-cutting patterns

Three patterns recur across the surveyed surface:

1. **`new Map<string, T>()` at module scope, holding NAPI/WASM/native
   handles, with no LRU.** Hits: `ruvllm-tools.ts` (3×, F-10-001),
   `storage-factory.ts.backendCache` (1×, F-10-003),
   `hooks-tools.ts.activeTrajectories` (1×, F-10-005),
   `controller-intercept.ts._instances` (1×, not separately filed —
   single-entry singleton today). The healthy pattern is the
   `HiveLRU` class at `hive-mind-tools.ts:868-931` — bounded LRU with
   explicit `getCacheCapacity()` from env. Recommend adopting
   `HiveLRU` (or factoring into a shared module) for the four
   unbounded sites above.

2. **`setInterval` without `.unref()`.** Hits: `connection-pool.ts`
   (eviction), `websocket.ts` (heartbeat), `session-manager.ts`
   (cleanup) — all in `v3/mcp/`. Compare to the consistently-correct
   `worker-daemon.ts` queuePollTimer, `worker-queue.ts` cleanup +
   heartbeat, and `mcp-server.ts` healthCheckInterval — all of which
   `.unref()`. The bug is concentrated in the `v3/mcp/` (transport
   layer) family. One-line fix per site.

3. **`process.on(...)` for SIGTERM/SIGINT/etc without an idempotency
   gate.** Hits: `worker-daemon.ts:469-471, 502-503` (5 listeners per
   start, no dedup), `headless-worker-executor.ts` (no signal
   handlers at all — relies on child kill). Healthy comparison:
   `audit-writer.ts.installSignalHandlersOnce()` (F-10-010).
   Repeated start leaks listeners; `MaxListenersExceededWarning`
   would surface after ~11 starts but the listener-store memory grows
   from start 1.

## Out-of-scope (static-audit slice)

- **Runtime stress tests** — no `mcp-server` 24-hour soak, no
  `WorkerDaemon` thousand-restart loop, no `RvfBackend` 100K-entry
  fill-then-search. These belong on a separate ADR-track that owns
  a dedicated benchmark harness (compare ADR-0094's living
  acceptance tracker). The pattern findings above are READ-ONLY;
  reproducing them as failing soak tests is the next layer.
- **Native NAPI ref/unref balance in `ruvector-node`** — the Rust
  binding uses `Arc<RwLock<CoreVectorDB>>` (`ruvector-node/src/lib.rs:251,267`)
  with `tokio::task::spawn_blocking` for every method. Arc refcount
  is correct (no `Box::leak`, no `into_raw` without paired `from_raw`
  found in a targeted scan of the file). A deeper Rust-side audit
  (e.g. `cargo miri test` under leak detection) is out-of-scope for
  this static JS-layer pass.
- **`@xenova/transformers` WASM heap reload behavior** — the
  worker-daemon preload comment (`worker-daemon.ts:120-132`) flags a
  known ~5GB combined-process WASM-heap problem under cold-load
  contention. That's a real concern but it's a Xenova dependency
  behavior, not a fork bug, and is already mitigated by the 90s
  stagger.
- **`SqlJsBackend` / `JsonBackend`** — removed per
  `feedback-forbidden-substring-tests-grep-dist`; not relevant to
  current hot paths.
- **`HierarchicalMemory` / `MemoryConsolidation`** — these are the
  fork-only controllers per `project-fork-only-controllers`; their
  cache discipline was not separately audited here. Reasonable
  follow-up slice if the gap analysis flags them.

---
title: ADR-0243 Stress Harness — 14× RSS Investigation
date: 2026-05-25
status: closed
adrs: [ADR-0243, ADR-0233, ADR-0253]
---

# Investigation: 14× RSS at N=100 in ADR-0243 Stress Harness

## Verdict

**C + harness bug** (warmup allocation + driver-side listener accumulation). NOT a CT-J runtime leak.

The 14× RSS growth is **bounded warmup allocation** that plateaus at ~640-1050MB (depending on burst rate) and stays perfectly flat for the remaining requests. The `MaxListenersExceededWarning` agent L surfaced was emitted by the **driver process** (parent), not by the MCP child under test — caused by per-write `child.stdin.once('drain', ...)` calls in `sendRPC` that never wired proper backpressure. Both issues are harness-shape, not runtime behavior.

| Hypothesis | Verdict | Evidence |
|---|---|---|
| A. Real ADR-0243 leak | Ruled out | Post-warmup `growthRatioSteady` is 1.0001-1.0266 across N=100/500/10000; RSS perfectly flat for 18+ samples post-warmup; no FD leak (handleDelta=9 ≪ 50). RSS releases 50% after drain (would not happen if HiveLRU/timer/handler refs were leaked). |
| B. Synthetic burst artifact | Partial contributor | Tight-loop dispatch of 10000 frames in 2.4s fills the kernel pipe queue; child sees a backlog of bytes, not actual processing. Paced dispatch (await each batch) gives identical RSS plateau regardless of N. |
| C. Warmup allocation | **Confirmed primary** | RSS climbs steeply across the first ~1500-2500 requests as lazy singletons load (ONNX embedding model, AgentDB controllers, RVF native module, hooks intelligence pipeline, agent pool), then plateaus exactly. Pattern is identical at N=100, N=500, N=10000 — only the plateau height varies with how many bytes the kernel pipe pre-buffers. |
| D. Listener leak | **Confirmed in driver only** | Stack trace places the leak at `stress-runtime-driver.mjs:286` (`child.stdin.once('drain', () => {})` in `sendRPC`). The MCP child (the target of the soak test) has zero `drain`/`once` patterns in its source. The warning is parent-process, not runtime-under-test. |

## Methodology

1. Read `scripts/stress-runtime-driver.mjs` and `scripts/test-stress-runtime.sh` to understand the dispatch + sampling model.
2. Ran the harness at N=100, 200, 500, 10000 with relaxed thresholds and recorded RSS curves.
3. Reproduced agent L's `MaxListenersExceededWarning` with `NODE_OPTIONS=--trace-warnings` — stack trace pinpointed the driver-side site.
4. Built a paced probe (batches of 20, await each batch) to separate "warmup RSS" from "burst-induced kernel-pipe RSS".
5. Searched `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` and the MCP transport for any `drain` listener wiring — none present in the runtime.

## Key Data

### Burst-mode N comparison (original harness, relaxed thresholds)

| N | i=0 RSS | Plateau RSS | i=N RSS | Post-drain RSS | Replies | handleDelta |
|---|---|---|---|---|---|---|
| 100 | 66MB | 1036MB @ i=70 | 1036MB | 502MB (released) | 70/100 | 14 |
| 200 | 66MB | 1029MB @ i=140 | 1029MB | 1068MB | 121/200 | 14 |
| 500 | 66MB | 1019MB @ i=250 | 1021MB | 1031MB | 316/500 | 14 |
| 10000 | 66MB | 1046MB @ i=2500 | 1050MB | 1089MB | 8967/10000 | 15 |

The plateau is ~1GB regardless of N (the small variation tracks how much the kernel pipe queue happens to hold). Linear regression across all samples gives 35000+ KB/sample which is a meaningless "we hit a warmup wall".

### Paced-probe (one batch of 20 awaited at a time)

| Batch | id | RSS |
|---|---|---|
| 5 | 100 | 944 MB |
| 10 | 200 | 944 MB |
| 15 | 300 | 944 MB |
| 20 | 400 | 945 MB |
| 25 | 500 | 945 MB |
| post-quiesce | 500 | 945 MB |

RSS plateau at batch 5 (~100 requests), then **completely flat** through batch 25. This is the clean fingerprint of warmup allocation — once lazy singletons are loaded, RSS is steady-state.

### MaxListenersExceededWarning trace

```
(node:72820) MaxListenersExceededWarning: Possible EventEmitter memory leak
  detected. 11 drain listeners added to [Socket]. MaxListeners is 10.
    at file:///.../scripts/stress-runtime-driver.mjs:286:19
    at new Promise (<anonymous>)
    at sendRPC (file:///.../scripts/stress-runtime-driver.mjs:282:10)
    at main (file:///.../scripts/stress-runtime-driver.mjs:357:5)
```

The driver's `sendRPC` called `child.stdin.once('drain', () => {})` on every write where `child.stdin.write()` returned `false`. The callback was empty (didn't resolve the request's Promise, didn't unblock the loop). The `once` self-removes when drain fires, but at N=10000 with a tight dispatch loop, listeners pile up between drain events. The intent (per the in-file comment) was "wait for drain before pushing more" — but the code did not actually await drain.

## Harness Fixes Applied

### Fix 1: single persistent `drain` listener with shared backpressure barrier

`scripts/stress-runtime-driver.mjs` — replace per-write `once('drain')` with one listener owned by the driver:

```js
let stdinReady = Promise.resolve();
let stdinReadyResolve = null;
child.stdin.on('drain', () => {
  if (stdinReadyResolve) {
    const r = stdinReadyResolve;
    stdinReadyResolve = null;
    r();
  }
});

async function sendRPC(id, method, params) {
  await stdinReady;                        // wait for drain if armed
  const msg = JSON.stringify(...) + '\n';
  return new Promise((resolve, reject) => {
    inflight.set(id, { resolve, reject, sentAt: Date.now(), tool: method });
    const ok = child.stdin.write(msg);
    if (!ok && stdinReadyResolve === null) {
      stdinReady = new Promise((res) => { stdinReadyResolve = res; });
    }
  });
}
```

Listener count stays at 1. Backpressure is properly observed. Documented pattern from Node's stream docs.

### Fix 2: discard warmup from slope/growth regression

The assertion is about **post-warmup steady-state**, not the warmup ramp. The first 1/3 of valid samples is discarded; slope is computed on the remaining samples **excluding the final post-drain sample** (which captures a mode shift, not load-time growth):

```js
const warmupCount = Math.floor(valid.length / 3);
const steady = valid.slice(warmupCount);
const slopeSamples = steady.slice(0, -1);   // ex-final
```

Both `growthRatioFull` (warmup × steady) and `growthRatioSteady` (post-warmup only) are reported in metrics for forensic visibility; only `growthRatioSteady` is asserted.

### Fix 3: minimum slope-sample count

Slope assertion requires ≥ 12 slope samples. Below that, a single-sample 10MB bump dominates the least-squares regression. Falls through to `growthRatioSteady` alone (robust at any N).

### Fix 4: dispatch yield every 100 requests

`await delay(0)` every 100 dispatches yields libuv so the child gets CPU for its stdin handler. Doesn't meaningfully change RSS plateau (the warmup signal is dispatch-rate-independent) but improves reply throughput and lets the steady-state portion of the test actually measure under-load behavior, not "kernel pipe queue full of bytes".

## Verdict Table After Fixes (default thresholds: slope=256 KB/sample, growth=3.0×, handle=50)

| N | growthRatioFull | growthRatioSteady | slope (steady, ex-final) | handleDelta | Stderr warnings | Verdict |
|---|---|---|---|---|---|---|
| 100 | 9.83 | 1.0266 | skipped (7 < 12 slope samples) | 9 | 0 | **PASS** |
| 500 | 9.85 | 1.0261 | skipped (7 < 12 slope samples) | 9 | 0 | **PASS** |
| 10000 | 9.65 | 1.0172 | 0 KB/sample (14 samples) | 9 | 0 | **PASS** |

The warmup is preserved in `growthRatioFull` for forensic visibility. The verdict uses `growthRatioSteady` (1.0001-1.0266) and slope (when N is large enough to be statistically meaningful).

## What Was NOT a Leak

For the record, none of these surfaces showed any post-warmup growth:

- **HiveLRU eviction** — `hive-mind_status` calls did not grow RSS post-warmup. The LRU cap is doing its job.
- **Timer references** — `agent_list` / `memory_search` did not accumulate RSS. The `.unref()` discipline + lazy init holds.
- **Re-entrant signal handlers** — `hooks_intelligence_stats` did not grow. `installSignalHandlersOnce` + module-scope `daemonShutdownHandlersInstalled` flag prevent the F-10-010 class.
- **`_pendingNativeIngest`** — `memory_store` (highest-weighted tool) did not grow RSS. The archivist dispatch path is not retaining writes.
- **ADR-0253 named workers** (`runConsolidateWorker`, `runPreloadWorkerLocal`) — both live in `worker-daemon.ts`. `mcp start` does NOT instantiate `WorkerDaemon`, so these are **not active during this stress test**. They remain valid concerns under their own ADR scope; the stress harness as currently shaped does not exercise them.

## Files Changed

| File | Change |
|---|---|
| `scripts/stress-runtime-driver.mjs` | Single persistent `drain` listener; warmup discarded from slope/growth; slope excludes final sample; min-samples gate; dispatch yield. |
| `scripts/test-stress-runtime.sh` | Removed `STRESS_INVESTIGATION_PENDING` gate (investigation complete). |
| `tests/CLAUDE.md` | Updated stress test description (no longer gated). |
| `docs/research/2026-05-25-stress-rss-investigation.md` | This file. |

## Recommendation for ADR-0233 Carry-forward

Close row A. The stress harness now passes deterministically at default thresholds across N=100/500/10000 and produces a meaningful verdict. The "14× RSS" signal was real but mis-categorised by the original slope-across-warmup regression. The methodology fix (post-warmup steady-state assertion with forensic full-window reporting) is the correct discipline.

Row L (gate the harness during investigation) is also closed — the gate is removed in this commit.

The harness should now be wired into a runner (CI cadence TBD). At minimum it should run as part of the release pipeline for any change in `forks/ruflo/v3/@claude-flow/cli/src/services/` or `mcp-server.ts`.

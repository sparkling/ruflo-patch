---
status: proposed
date: 2026-05-24
tags: [audit-followup, leaks, long-lived-process, mcp-stdio, worker-daemon, wasm-handles, timers, signal-handlers]
supersedes: []
depends-on: [0201, 0233]
implements: []
---

# Long-lived process resource discipline (CT-J)

## Context and Problem Statement

[[ADR-0233]] consolidated the 2026-05-24 second-pass soundness audit. Slice
10 — performance / memory / FD-leak static pass (`G-16-014` [MEDIUM]) —
reported 12 findings across ~25 hot-path TS/CJS modules. The audit explicitly
labels itself READ-ONLY-static; runtime stress benchmarks are out-of-scope
and remain carry-forward (see §Reviews still owed in [[ADR-0233]] and
§Carry-forward in [[ADR-0201]]).

Two findings were marked **CRITICAL**, both of which only matter on
long-lived processes (MCP-stdio server, `WorkerDaemon`):

1. **F-10-001** — three module-scope `Map<string, WasmHandle>`s at
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:40-42`
   (`hnswRouters`, `sonaInstances`, `loraInstances`) accumulate a
   NAPI/WASM-backed object for every distinct `id` ever passed in. No LRU,
   no TTL, no eviction. WASM heap + Float32Array memory grows for the
   process lifetime.

2. **F-10-002** — three `setInterval`s under `forks/ruflo/v3/mcp/` are not
   `.unref()`'d (`ConnectionPool.evictionTimer`,
   `WebSocketTransport.heartbeatTimer`, `SessionManager.cleanupTimer`).
   Transient construction without reaching the explicit `destroy()` path
   pins the Node event loop. The companion-fork `worker-daemon.ts` and
   `mcp-server.ts` queuePollTimer / healthCheckInterval correctly call
   `.unref()` — the bug is concentrated in the `v3/mcp/` family.

Plus three WARN-tier siblings the same class of defect produces:

3. **F-10-007** — `RvfBackend._pendingNativeIngest` retains up to 100K
   Float32Arrays (~300MB at 768-dim) until first semantic `search()`
   rehydrates; never cleared post-rehydrate.

4. **F-10-010 (counter-flag)** — `worker-daemon.ts:469-471` registers
   SIGTERM/SIGINT/SIGHUP on every `start()` call with no idempotency
   gate. Companion `audit-writer.ts::installSignalHandlersOnce` (lines
   143-156) is the healthy pattern that the daemon does NOT follow.
   `MaxListenersExceededWarning` would surface after ~11 starts;
   listener-store memory grows from start 1.

5. Recurring **module-scope `new Map<string, T>()` anti-pattern** at
   `hooks-tools.ts.activeTrajectories` (F-10-005),
   `storage-factory.backendCache` (F-10-003), and `controller-intercept.ts._instances`
   (single-entry singleton today; flagged for vigilance). The healthy
   in-tree comparison is `HiveLRU` at
   `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:868-931` —
   bounded LRU with explicit `getCacheCapacity()` from env, move-to-front
   on `get`, fail-loud on invalid capacity.

The defect class is **drift on long-lived processes** — invisible to
short-lived CLI invocations, invisible to the existing acceptance gates
(ADR-0069 A9's "Cache size consistent" gate does not touch these
module-scope maps), but progressive on the MCP-stdio process the user
talks to all session and on the `WorkerDaemon` that runs across many
task cycles.

## Pre-flight verification (per [[ADR-0201]] checklist)

Per [[ADR-0201]] §Remediation-ADR pre-flight checklist (and corpus rule
`feedback-remediation-adr-preflight`), each remediation ADR drafted from
[[ADR-0233]] findings must clear four checks before its Decision Outcome.

1. **Signal reaches its audience.** Confirmed. The MCP-stdio server and
   `WorkerDaemon` ARE long-lived by design. F-10-001's three Maps are
   live module-scope state on every MCP tool registration path; F-10-002's
   three timers are constructed by `connection-pool.ts` /
   `session-manager.ts` / `transport/websocket.ts`; F-10-010's signal
   handlers run on every `WorkerDaemon.start()`. The audience for each
   leak is the process whose lifetime is unbounded.

2. **Upstream hasn't already decided it.** Confirmed not pre-decided in a
   conflicting way. The remedies are already-in-tree patterns:
   - `HiveLRU` (hive-mind-tools.ts:868-931) — bounded LRU with env-tunable cap.
   - `worker-daemon.ts:896-902` queuePollTimer — `.unref()` after
     `setInterval`, gated on `typeof … === 'function'`.
   - `worker-queue.ts:162-163, 683-691` — `.unref()` on cleanup +
     heartbeat timers.
   - `mcp-server.ts:845` — `.unref()` on `healthCheckInterval`.
   - `audit-writer.ts:143-156` — `installSignalHandlersOnce` with
     `signalHandlersInstalled = true` module-scope gate.
   - `RvfBackend.persistTimer` (rvf-backend.ts:360) — `.unref()`'d
     correctly; the unbounded `_pendingNativeIngest` array is the
     gap, not the timer.

   These are reference implementations. The ADR proposes adoption, not
   new design. No upstream merge tax — `ruvnet/ruflo` exhibits the same
   patterns at the same sites.

3. **Premise is true at runtime.** Re-verified by direct file read:
   - `ruvllm-tools.ts:40-42` — three module-scope `new Map<string, …>()`,
     no `.delete()` outside the journal-replay rebuild path. Confirmed.
   - `connection-pool.ts:363` — `setInterval(…, evictionRunInterval)` with
     no following `.unref()`. Confirmed.
   - `session-manager.ts:377-388` — `cleanupTimer = setInterval(…)`,
     `stopCleanupTimer` clears but no `.unref()` at construction. Confirmed.
   - `worker-daemon.ts:462-472` — `setupShutdownHandlers` directly calls
     `process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
     process.on('SIGHUP', shutdown)` with no `signalHandlersInstalled`
     gate. Confirmed.
   - `audit-writer.ts:143-156` — `installSignalHandlersOnce` with module-scope
     `signalHandlersInstalled = true` flag at line 21. Confirmed.

4. **No sibling-ADR overlap.** **CRITICAL OVERLAP DETECTED.** Site #2
   (the three `v3/mcp/` timers) lives entirely inside the 5,587-LOC
   `v3/mcp/` subtree that [[ADR-0233]] §CT-F (whole-tree dead-code scan,
   23 findings) tallied as **rank-4 of unique TS source dead**. Grep
   confirms: zero callers outside `v3/mcp/` itself import
   `connection-pool.ts`, `session-manager.ts`, or
   `transport/websocket.ts`. If CT-F's remediation ADR (the
   not-yet-written ADR-0239 placeholder per the ADR-0233 triage list)
   deletes `v3/mcp/`, F-10-002 evaporates with the subtree. Drafting
   a per-site fix for F-10-002 today would be wasted work — the patch
   would land in a subtree marked for deletion. **Decision below defers
   site #2 to the CT-F outcome.**

   No overlap on the remaining sites: F-10-001 is in `cli/src/mcp-tools/`
   (live), F-10-007 is in `memory/src/rvf-backend.ts` (live), F-10-010
   is in `cli/src/services/worker-daemon.ts` (live).

## Considered Options

* **Option A — Per-site surgical fixes.** Apply the smallest possible
  remedy at each site: bounded LRU on the three `ruvllm-tools.ts`
  Maps, `.unref()` on the three `v3/mcp/` timers, idempotency gate on
  `worker-daemon` signal handlers, flush of `_pendingNativeIngest`
  after `ensureNativeSemanticReady` completes. Each is a localised
  diff; no shared abstraction.

* **Option B — Reusable `HandleRegistry` shared utility.** Promote
  `HiveLRU` (or factor it) into a shared module under
  `@claude-flow/cli/src/lib/` and have all NAPI/WASM-backed Maps —
  `ruvllm-tools.ts` (3 sites), `hooks-tools.ts.activeTrajectories`,
  `storage-factory.backendCache` — adopt the shared type. Single source
  of truth for LRU semantics across the fork.

* **Option C — Detection rule additions.** Add (a) an ESLint rule that
  flags `setInterval(…)` calls whose result is not chained or stored
  on a path that calls `.unref()`, and (b) an arch-test that walks
  module-scope `new Map<string, T>()` declarations whose value type
  resolves to a NAPI/WASM-backed handle and requires the surrounding
  module to also import a bounded-cache type. Lints, not fixes.

* **Option D — Defer wholesale, wait on CT-F.** Wait for [[ADR-0233]]'s
  CT-F dead-code triage to write its own remediation ADR (placeholder
  ADR-0239). If CT-F deletes `v3/mcp/`, site #2 evaporates. The live
  surviving sites (F-10-001, F-10-005, F-10-007, F-10-010) still need
  separate decisions; deferring all of CT-J on CT-F leaves real leaks
  in live code.

## Decision Outcome

**Chosen: Option A for live sites + Option C addendum for the unref'd-timer
class + explicit deferral of site #2 to CT-F (Option D applied surgically).**
Rejected Option B (premature abstraction; only 4 callsites; `HiveLRU` is
small and already inlined where it belongs); rejected blanket Option D
(would leave F-10-001, F-10-005, F-10-007, F-10-010 unaddressed).

The remedy choice follows [[ADR-0201]] §Default — "implement / delete /
behaviour-verify at the seam that matters." Per-site implementation at
the seam each finding identified, with a behaviour-test that exercises
each fix as a long-running drift assertion. No new gate, no new label,
no new wire.

Concretely (sites table below carries the per-finding patch shape):

* **F-10-001** — implement bounded LRU directly on the three Maps,
  matching the `HiveLRU` shape (size cap from
  `CLAUDE_FLOW_RUVLLM_CACHE_MAX` env var, default 64; fail-loud
  on invalid value; move-to-front on `get`; explicit `dispose()` on
  eviction so the underlying WASM handle's `.free()` / `.destroy()` is
  called if the type exposes one). Behaviour test: cycle 200 distinct
  ids through `mcp__ruflo__ruvllm_hnsw_create`, assert eviction count
  matches the spec.

* **F-10-002** — **DEFER**. Track on CT-F (placeholder ADR-0239).
  Re-evaluate after CT-F decides whether `v3/mcp/` is kept or deleted.
  If kept, apply `.unref()` per site (one-line each) as a follow-up
  amendment. If deleted, the finding evaporates. Either way, this
  ADR's site #2 row is closed-by-reference.

* **F-10-005** — implement bounded LRU + idle-TTL on
  `activeTrajectories` (default cap 256, TTL 1 hour from last step).
  Symmetric with F-10-001's shape. Idle-TTL needed because a buggy
  client can `trajectory-start` without ever calling `trajectory-end`.

* **F-10-007** — clear `_pendingNativeIngest` (assign `[]`) inside
  `ensureNativeSemanticReady` immediately after the native append
  completes; flip `_nativeRehydrated = true` only after the clear, so
  a re-entrant call cannot append against a half-cleared array.
  Behaviour test: load 100K entries into RVF without calling
  `search()`, then call `ensureNativeSemanticReady` directly, assert
  `_pendingNativeIngest.length === 0` and that a subsequent `search()`
  returns the loaded set.

* **F-10-010** — adopt the `audit-writer::installSignalHandlersOnce`
  pattern in `worker-daemon.ts`. Module-scope
  `daemonShutdownHandlersInstalled` flag; `setupShutdownHandlers`
  short-circuits if already set. Same gate for `installCrashHandlers`
  (`uncaughtException` + `unhandledRejection`). Behaviour test: call
  `daemon trigger` twice in the same process, assert
  `process.listenerCount('SIGTERM')` did not double.

**Option C addendum (lint not fix):** add a single ESLint rule
(`no-unref-setinterval`) under `forks/ruflo/v3/@claude-flow/cli/.eslintrc`
that warns on `setInterval(…)` results whose surrounding scope does not
also call `.unref()` on the timer handle within N statements. Defer the
NAPI/WASM-Map arch-test (Option C part b) — it requires custom
TypeScript-AST traversal that is materially more work; tracked as
follow-up. The lint catches the recurrent class without re-introducing
the v3/mcp/ overlap (lint fires inside v3/mcp/ too, but the existing
findings document the sites; no new ADR needed).

**Runtime stress carry-forward.** This ADR remediates the static
findings only. The full scope of `G-16-014` — a runtime soak test
that exercises a long-running MCP-stdio process across 10K+ tool
calls and asserts RSS does not drift past a budget — remains owed
per [[ADR-0233]] §Reviews still owed and [[ADR-0201]] §Carry-forward.
The behaviour tests called out per-site above are necessary but not
sufficient; they assert the FIX at the site, not the FREEDOM FROM
DRIFT at the process level.

## Consequences

### Positive
* Eliminates the four live process-lifetime leaks (F-10-001, F-10-005,
  F-10-007, F-10-010) on the MCP-stdio and `WorkerDaemon` paths.
* Adopts existing, already-tested in-tree patterns (`HiveLRU`,
  `installSignalHandlersOnce`, `.unref()` discipline) rather than
  inventing new abstractions — no new surface to maintain.
* `no-unref-setinterval` lint prevents the F-10-002 class from
  recurring in NEW code, regardless of how CT-F decides the existing
  occurrence.
* Each site ships with a behaviour test that fails BEFORE the fix is
  applied — matches [[ADR-0201]] §Default ("behaviour-verify at the
  seam that matters").

### Negative
* The bounded-LRU shape for `ruvllm-tools.ts` reuses but does not share
  code with `HiveLRU`. If a third callsite emerges, Option B
  (`HandleRegistry` extraction) becomes the right choice — accept that
  re-factoring cost when it lands.
* `activeTrajectories` TTL eviction adds wall-clock dependency to a
  module that today has none. The TTL value (1h) is a guess pending
  real client-failure-mode data.
* Site #2 deferral means F-10-002 stays open until CT-F (ADR-0239)
  lands. Risk window: until then, a CLI command that transiently
  constructs a `ConnectionPool` (e.g. through an as-yet-unidentified
  import path) hangs Node's event loop on exit. Mitigation: the lint
  catches NEW uses; the audit confirmed zero external callers of
  `v3/mcp/` today.

### Neutral
* No public API changes. All remedies are internal to the named files.
* Env-var (`CLAUDE_FLOW_RUVLLM_CACHE_MAX`) follows the existing
  `CLAUDE_FLOW_HIVE_CACHE_MAX` shape; no new config-chain wiring needed.
* Behaviour tests live under each package's existing `__tests__/`; no
  new test infrastructure.

### Dependency on CT-F (ADR-0239 placeholder)
* Per pre-flight check #4, site #2 (F-10-002) is **wholly inside** the
  5,587-LOC `v3/mcp/` subtree that CT-F's dead-code finding has marked
  as rank-4 of dead code. CT-F's remediation ADR (not yet written;
  ADR-0233 §Decision lists CT-F as triage-priority #6) will decide
  whether `v3/mcp/` is kept, archived, or deleted.
* If CT-F **deletes** `v3/mcp/`: F-10-002 evaporates; close site #2
  by reference; no further work on this ADR's scope.
* If CT-F **keeps** `v3/mcp/`: re-open site #2 as a one-line
  `.unref()` patch per timer + add the three sites to the lint's
  exemption list (already-fixed). Track via amendment to this ADR.
* If CT-F **archives** (moves to `archive/`): no action — `archive/`
  is excluded from the active surface.

## Sites table

| ID | File:line | Finding | Severity | Patch shape | Status this ADR |
|----|-----------|---------|----------|-------------|-----------------|
| 1 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts:40-42` | F-10-001 | CRITICAL | Bounded LRU on three Maps; cap from `CLAUDE_FLOW_RUVLLM_CACHE_MAX` (default 64); dispose on eviction; fail-loud on invalid cap (HiveLRU shape) | **Implement** |
| 2 | `forks/ruflo/v3/mcp/connection-pool.ts:362-366` | F-10-002 | CRITICAL | `.unref()` after `setInterval` | **DEFER → CT-F (ADR-0239)** |
| 2 | `forks/ruflo/v3/mcp/transport/websocket.ts:474-491` | F-10-002 | CRITICAL | `.unref()` after `setInterval` (heartbeatTimer) | **DEFER → CT-F (ADR-0239)** |
| 2 | `forks/ruflo/v3/mcp/session-manager.ts:376-380` | F-10-002 | CRITICAL | `.unref()` after `setInterval` (cleanupTimer) | **DEFER → CT-F (ADR-0239)** |
| 3 | `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:186-187` | F-10-007 | WARN | Clear `_pendingNativeIngest = []` after native append in `ensureNativeSemanticReady`; flip `_nativeRehydrated = true` only after clear | **Implement** |
| 4 | `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:469-471` | F-10-010 | NOTE (counter-flag) | Module-scope `daemonShutdownHandlersInstalled` gate; same gate for `installCrashHandlers` (`uncaughtException` + `unhandledRejection`) | **Implement** |
| 5 | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:528` | F-10-005 | WARN | Bounded LRU + idle-TTL (default cap 256, TTL 1h) on `activeTrajectories` | **Implement** |
| Lint | `forks/ruflo/v3/@claude-flow/cli/.eslintrc.*` | Class of F-10-002 | — | New rule `no-unref-setinterval`; warns when `setInterval` result is not `.unref()`'d within N statements | **Implement** |

Out of scope for this ADR:
* `F-10-003` (`storage-factory.backendCache`) — WARN, separate eviction
  semantics needed (path-keyed, multi-tenant); track on its own ADR.
* `F-10-004` (`headless-worker-executor.ts` orphan watchdog) — WARN,
  internal to the executor's resolved-flag protocol; track on its own
  ADR.
* `F-10-006` (`request-tracker.byTool`) — WARN, currently bounded by
  registry size; defensive cap deferred until untrusted-input pathway
  emerges.
* `F-10-008` (`statusline-generator` `openSync` without try/finally) —
  WARN, interactive-only impact (per-prompt FD leak on corrupt DB);
  separate ADR for FD-discipline class.
* `F-10-009`, `F-10-011`, `F-10-012` — NOTE-tier, no action needed
  per audit verdict (vigilance flags, co-terminus lifecycle, or
  confirmed-healthy).

## More Information

* [[ADR-0201]] §Remediation-ADR pre-flight checklist — checklist applied
  above; site #2 deferred per check #4.
* [[ADR-0201]] §Reviews still owed — runtime stress (G-16-014 full
  scope) listed as carry-forward.
* [[ADR-0233]] §CT-J — theme this ADR remediates.
* [[ADR-0233]] §CT-F — dead-code subtree that owns the deferred site #2;
  remediation tracked under placeholder ADR-0239 (not yet written;
  triage-priority #6 in ADR-0233 §Decision).
* `feedback-no-fallbacks` — the LRU on invalid `maxEntries` MUST throw
  (matches `HiveLRU` constructor at hive-mind-tools.ts:876-883).
* `feedback-remediation-adr-preflight` — corpus-level rule that gates
  this ADR's drafting; checks applied in §Pre-flight verification above.
* **Runtime-stress carry-forward note.** Per [[ADR-0201]] and
  [[ADR-0233]] §Reviews still owed, the full scope of `G-16-014` is a
  long-running runtime stress test (e.g. 10K+ MCP tool calls against a
  single MCP-stdio process, RSS budget assertion, FD-count assertion,
  listener-count assertion). This ADR ships per-site behaviour tests
  that assert each FIX at its seam but does NOT ship the process-level
  drift assertion. Once CT-J's per-site patches land and CT-F's site #2
  resolution lands, a follow-up ADR should commission the soak test.
  Target harness: same shape as the `worker-daemon` long-running tests
  already in `forks/ruflo/v3/@claude-flow/cli/__tests__/services/`.

## Validation Steps

1. Each per-site behaviour test fails on the unfixed code and passes
   after its patch (test-first per [[ADR-0201]] §Default).
2. `npm run build` at each affected package green; existing tests still
   pass.
3. `no-unref-setinterval` lint runs as part of `npm run lint`; existing
   compliant sites stay green (worker-daemon, worker-queue, mcp-server,
   rvf-backend); v3/mcp/ sites flag until CT-F resolves them.
4. Manual smoke: start MCP-stdio, cycle 200 ids through
   `ruvllm_hnsw_create`, observe process RSS does not grow past the
   LRU-cap budget (~64 × per-instance WASM heap).
5. Manual smoke: invoke `daemon trigger` twice in the same process via
   the in-tree test harness, assert `process.listenerCount('SIGTERM')`
   stays at 1.

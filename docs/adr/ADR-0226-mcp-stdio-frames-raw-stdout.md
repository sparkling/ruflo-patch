---
status: implemented
date: 2026-05-21
accepted-on: 2026-05-21
implemented-on: 2026-05-21
tags: [mcp, stdio, jsonrpc, protocol, console, lost-reply, bugfix]
supersedes: []
depends-on: [0204]
implements: []
---

# MCP stdio JSON-RPC frames must be written to raw stdout, not console.log

## Context and Problem Statement

The served MCP stdio loop (`@claude-flow/cli/bin/cli.js` and the parallel
`bin/mcp-server.js`) wrote every JSON-RPC frame — tool results and protocol
errors — via `console.log(JSON.stringify(frame))`.

Hand-testing the memory bus (after the ADR-0204 archivist-bootstrap fix) surfaced
a reproducible defect: on a freshly-started server, the **first** `memory_store`
call that triggers embedding generation **never emitted a JSON-RPC reply** (no
response for ≥110s), even though the data was fully persisted and embedded (a
later `memory_search` returned it with a real similarity score). The **second**
store replied in ~100ms; the first non-embedding call (`memory_list`) and all
reads replied normally; stderr was silent throughout. A client (Claude Code, or a
swarm agent coordinating through memory) sees its first store hang/time out even
though it silently succeeded.

Root cause (verified at file:line, pre-existing since ADR-0085, 2026-04-13):

1. The first `memory_store` calls `getController('memoryGraph')`
   (`mcp-tools/memory-tools.ts:328`) **after** its persist+embed+index work
   completes (`:289-299`), for MemoryGraph importance scoring.
2. `getController` → `ensureRegistry()` → `initControllerRegistry()` monkey-patches
   `console.log`/`console.warn` to a **blanket no-op**
   (`memory/memory-router.ts:594-595`) to keep controller init noise
   (GNN/Sona/WASM/LearningSystem) off stdout. Restore is deferred to timers/events
   (`:615` 120s, `:617` `deferred:initialized`, `:713` 500ms) — never a `finally`.
3. A race in `getController` (`:1669-1674`) returns on the fast path before the
   ~500ms restore fires, so `console.log` is still the no-op when control returns
   to the loop and it runs `console.log(JSON.stringify(response))` (`bin/cli.js`).
   **The reply frame is swallowed.** Subsequent calls run after restore.

stdout is the JSON-RPC channel; routing protocol frames through a `console.log`
that other code legitimately reassigns is the design flaw. The race is also why
the behavioural acceptance check (`adr0204-archivist-rt`) passed in some runs and
not others.

This is NOT an ADR-0204 regression: the archivist `archivistReady` gate works
correctly (the first non-embedding `tools/call` replies), and ADR-0204's warm-up
path never invokes `initControllerRegistry`.

## Decision Drivers

* **Protocol-channel integrity** — the stdio JSON-RPC channel must never depend on
  the current value of `console.log`. stderr already gets this separation via
  `console.error`.
* **No silent data-integrity gaps** ([[feedback-no-fallbacks]]) — a write that
  succeeds but returns no reply is indistinguishable from a hang to the client.
* **Determinism** — eliminate the timing race, not paper over it with a longer
  restore window.
* **Surgical** — keep the controller-noise suppression doing its job; touch only
  the frame-write path.

## Considered Options

* **Option A — Write JSON-RPC frames via raw `process.stdout.write`.** A
  `writeFrame` helper, captured once, used for every frame in the stdio loop.
  Immune to any in-process `console.log` reassignment. The console no-op stays
  (it correctly keeps controller noise off stdout) but can no longer eat a frame.
* **Option B — Convert the `:594` no-op to a passthrough filter** (the idiom at
  `controller-registry.ts:1070-1084`). Rejected: that suppression wraps the entire
  multi-controller `registry.initialize()`; any controller log not matching the
  filter substrings would leak onto **stdout and corrupt the JSON-RPC channel**.
  It trades the lost-reply bug for a pollution risk.
* **Option C — Restore `console.log` in a `finally` around registry init.**
  Insufficient: the race window (work completes, reply written, before restore)
  remains, and several other `console.log` monkey-patches exist in the codebase
  that could recur the same swallow. Does not address the root coupling.

## Decision Outcome

Chosen: **Option A.** In both `bin/cli.js` and `bin/mcp-server.js`, define
`const writeFrame = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');`
and route every JSON-RPC frame write (tool result + the `-32700`/`-32603`
protocol errors) through it. The console-suppression no-op is left intact.

Implemented in fork commit `0bdd3b4b3`, shipped in
`@sparkleideas/cli@3.7.0-alpha.10-patch.244`.

### Consequences

* The first cold `memory_store` now replies as soon as its work completes
  (verified: ~7s cold, ~100ms warm) instead of hanging. Memory-backed swarm
  dialectic coordination no longer loses an agent's first write-acknowledgement.
* The JSON-RPC channel is decoupled from `console.log` for all frames; future
  controller console patches cannot swallow a protocol frame.
* No change to controller-noise suppression (stdout stays clean during init).

### Regression guards

* **Unit (deterministic, source-shape):** `tests/unit/mcp-stdio-reply-channel.test.mjs`
  — both bins define `writeFrame` via `process.stdout.write` and contain no
  `console.log(JSON.stringify(...))` frame write in the stdio loop.
* **Acceptance (behavioural):** `adr0204-archivist-rt` (lib/acceptance-adr0204-checks.sh)
  now fails on a MISSING first-store reply, rather than tolerating it. Wired into
  the canonical `scripts/test-acceptance.sh`, not only the fast runner.

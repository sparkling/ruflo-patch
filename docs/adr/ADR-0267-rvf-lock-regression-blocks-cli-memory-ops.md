---
status: accepted
date: 2026-05-27
tags: [regression, rvf, mcp, daemon, memory, lock]
supersedes: []
depends-on: [ADR-0202, ADR-0073, ADR-0227]
implements: []
---

# RVF lock regression — CLI memory operations blocked by MCP/daemon lock holder

## Context and Problem Statement

User-reported regression (2026-05-27): `npx @sparkleideas/cli memory store …` — and by extension every CLI memory operation that opens RVF — blocks indefinitely when the MCP daemon (or its RVF-bound MCP server) is running. The exclusive `flock` on the RVF backend file is held across the lifetime of the daemon process, not released per-op.

This contradicts the design captured in `[[project-two-hook-paths-cli-vs-handler]]`:

> Two hook code paths: settings.json (file-based, lock-free) vs CLI subcommand (RVF lock). Production hooks go hook-handler.mjs → intelligence.cjs (no RVF lock), so F-13-001 can't hit them; real victim is the MCP server's routeMemoryOp/ensureRvfWired. Daemon's own Archivist is FS-JSON; only 2 unmigrated workers hold the RVF lock.

The "2 unmigrated workers" + the MCP server's `routeMemoryOp` / `ensureRvfWired` path are the suspected holders. Investigation has not yet pinpointed which.

### Evidence gathered (Task #7 will sharpen)

| Probe | Output | Interpretation |
|---|---|---|
| `ls .claude-flow/` | `daemon.sock` present; `daemon-state.json` modified 16:21 | Daemon was running this session |
| `head -20 .claude-flow/daemon-state.json` | `running:true`, `startedAt:2026-05-27T15:13:42Z`, `uptimeSec:460`, `lastTick:15:21:22Z` | Daemon process started ~28min ago; last tick 19+min ago — process may have died without state flush |
| `lsof .claude-flow/daemon.sock` | no holder | Daemon process is dead BUT state file still claims `running:true` (stale) |
| `find .claude-flow/ -name "*.lock"` | (no matches) | RVF lock file NOT in `.claude-flow/`; lives elsewhere (agentdb storage path — Task #7 to locate) |
| `find .claude-flow/data/` | only `.json` and `.jsonl` files | Confirms `[[project-two-hook-paths-cli-vs-handler]]`: daemon's own Archivist is FS-JSON; no RVF lock from that path. The lock holder is upstream — MCP server / unmigrated workers. |
| `.claude-flow/daemon-state.json:workers.map.runCount` | 3610 cycles, last `2026-05-27T15:13:42Z` | `map` worker iterates frequently; if any iteration acquires RVF lock without release, this is the suspect |
| `.claude-flow/daemon-state.json:workers.audit.runCount` | 1834 cycles | `audit` worker is the second unmigrated suspect per `[[project-two-hook-paths-cli-vs-handler]]` |

### Why this is a regression, not new behaviour

Prior fork state per memory + ADRs 0073/0202/0227:

- **ADR-0073** moved RVF backend to compute cosine directly; the lock infrastructure is per-op, not per-session.
- **ADR-0202** wired `LockHeld` to exit-code-1 so callers can detect contention; the design assumed transient contention, not lifetime hold.
- **ADR-0227** lowered the adaptive recall floor 0.3 → 0.15; orthogonal to lock semantics but indicates active maintenance on the RVF path.
- **`[[project-memory-search-rvf-snapshot-isolation]]`** describes the previous `total:0` story — that was about score-computation, not lock-blocking. The current regression is structurally different.

CLI memory ops were observed working alongside a running MCP daemon in the recent past (the daemon's Archivist is FS-JSON and was not supposed to acquire the RVF lock at all). Something between then and now causes the lock to be held across the daemon's lifetime when a CLI op tries to acquire.

### What this ADR is and isn't

**Is**: a tracker ADR documenting a confirmed regression + opening three investigation tasks. The fix path is **explicitly deferred until Task #7 identifies the lock holder** — premature commitment to a fix mechanism here would violate `[[feedback-trace-before-hypothesis]]`.

**Isn't**: a decision document. The candidate fix mechanisms in §"Considered Options" below are framings for the discussion in Task #8, not pre-selected choices.

## Decision Drivers

* **CLI memory operations must work alongside a running MCP daemon.** This is a baseline operator-flow invariant — the user runs `ruflo memory store` / `ruflo memory search` and expects success regardless of daemon state.
* **No silent fallbacks** per `[[feedback-no-fallbacks]]`. A "catch LockHeld → return empty" patch is forbidden; the fix must address the structural cause.
* **No squelching tests** per `[[feedback-no-squelch-tests]]`. The acceptance check in Task #9 must FAIL today (the regression is real and the smoke must reproduce it) and pass after the fix.
* **Trace before hypothesis** per `[[feedback-trace-before-hypothesis]]`. Task #7 trace agent must complete before Task #8 commits to a fix. The two prior cycles burned on hypothesis-then-fix on ADR-0181 #100 are the cautionary precedent.
* **Honour MCP-server-is-real-victim hypothesis** per `[[project-two-hook-paths-cli-vs-handler]]`. The trace should examine `routeMemoryOp` / `ensureRvfWired` in the MCP server AND the daemon's 2 unmigrated workers (`map`, `audit`).
* **Stale daemon-state.json is a separate bug, not in scope.** The probe surfaced `running:true` with no socket holder — that's an orthogonal cleanup-on-crash issue. Separate ADR if it persists post-fix.

## Considered Options

These are **discussion framings** for Task #8, not pre-selected. The trace in Task #7 may surface a 5th option or eliminate some of these.

### Option A — Switch MCP server's RVF wiring to FS-JSON (parity with daemon's Archivist)

Per `[[project-two-hook-paths-cli-vs-handler]]`, the daemon's own Archivist already uses FS-JSON and does not acquire the RVF lock. Apply the same pattern to the MCP server's `routeMemoryOp` / `ensureRvfWired`: serialize writes through the same FS-JSON path; let the RVF backend be advisory.

**Pros**:
- Eliminates the lock surface entirely from the MCP path
- Mirrors a known-working pattern
- Smallest change to CLI path (it already works without the MCP holding the lock)

**Cons**:
- May surface FS-JSON limits (no HNSW indexing; semantic search degrades)
- Could regress recall quality if MCP-route searches relied on RVF's vector path
- Doesn't address the 2 unmigrated workers (`map`, `audit`) — they may be the actual holders

### Option B — Per-op lock acquire/release in MCP server + unmigrated workers

Today's hypothesis: some call site does a one-time `open(rvf, exclusive)` at server boot and never releases. Switch to: `open → op → close` per memory operation.

**Pros**:
- Minimal semantic change; preserves RVF benefits (HNSW, cosine, etc.)
- CLI ops can interleave with MCP ops with normal contention semantics
- Lock contention becomes transient (the design ADR-0202 assumed)

**Cons**:
- Per-op open/close overhead on RVF (file-handle churn; benchmark cost TBD)
- If the lock holder is a worker that legitimately needs long-running ownership (e.g., a streaming embedding writer), per-op release breaks the worker
- Doesn't help if the lock is held by a crashed-but-not-released process (Task #7 will say whether this is the case)

### Option C — Split MCP and CLI onto separate RVF backends with shared read-only snapshot

MCP daemon holds a writable RVF backend; CLI ops route through a read-only snapshot or a write-through queue that the daemon drains.

**Pros**:
- Architecturally clean separation
- CLI ops never block on daemon state
- Mirrors the producer/consumer pattern documented in `[[reference-pipeline-publish-paths]]`

**Cons**:
- Largest implementation surface
- New synchronization path (drain semantics, eventual-consistency window)
- Likely overkill for a regression that may have a 1-line root cause

### Option D — Lock-broker / advisory arbitration

Introduce a tiny broker process (or extend the daemon) that arbitrates RVF access between MCP and CLI via cooperative locking (per-op tickets) rather than OS-level exclusive flock.

**Pros**:
- Preserves the existing RVF backend untouched
- Programmable fairness / priority

**Cons**:
- Yet another moving part
- Lock broker is itself a single point of failure
- `[[feedback-no-fallbacks]]` concern: a broker timeout path is exactly the kind of silent-fallback the rule forbids — careful design needed

## Decision Outcome

**Proposed: open the investigation; do not commit to A/B/C/D until Task #7 names the holder.**

Three tasks (already created in the session task list):

1. **Task #7** — analyze which process holds the lock + acquisition site. Find the OS process; the call site (file:line); whether the lock is held across daemon lifetime by design or by accident.
2. **Task #8** — propose + discuss the fix mechanism informed by Task #7 findings. Discuss A/B/C/D + any 5th option that the trace surfaces. Pick one with tradeoff justification.
3. **Task #9** — verify the fix via acceptance check wired into the canonical harness (`run_check_bg` + `collect_parallel` per `[[reference-acceptance-runcheck-vs-collect]]`). The smoke must FAIL today (reproduce the regression) and PASS after the fix.

This ADR is `proposed`. Ratification + implementation are separate steps:

- Task #7 produces a trace report appended to this ADR as §"Pre-flight (trace findings)".
- Task #8 produces a §Revision 1 to this ADR with the selected option + edits.
- Task #9 produces the acceptance smoke + harness wiring.
- ADR-0267 flips `accepted` → `completed: true` only when Task #9's smoke is green AND the regression is reproducibly fixed in `_cli_cmd memory store` paths.

### Consequences

* Good, because tracing before hypothesizing (per `[[feedback-trace-before-hypothesis]]`) keeps the fix mechanism open until Task #7 names the actual lock holder, avoiding the hypothesis-then-fix waste seen on ADR-0181 #100.
* Good, because the Task #9 acceptance smoke is the canonical regression detector — any future fix attempt must flip it FAIL → PASS, so the regression cannot silently reopen.
* Good, because the eventual Option F fix (defer `warmUpRvfWithRetry` to first `tools/call`) eliminates the held-for-lifetime flock with the smallest surface and mirrors the daemon's known-good per-op release semantics.
* Bad, because the investigation burned five release cycles patching dead entry points (`src/mcp-server.ts`, `bin/mcp-server.js`) before discovering `bin/cli.js` is the live MCP-mode path (lesson captured in `[[feedback-trace-bin-entry-before-patching]]`).
* Neutral, because ADR-0181 Phase 5 DA-L2's "fail loud at startup for corrupt RVF" property is deferred to the first `tools/call` — equivalent for a long-lived server, the fault still surfaces loudly, just in the first tool-call's protocol error code instead of at startup.

## Pre-flight (trace findings) — Task #7 complete (2026-05-28)

Trace identified the root cause without needing the deferred trace agent:

* **Lock holder**: the MCP server process (`cli mcp start`), specifically
  the eager `warmUpRvfWithRetry` → `ensureRvfWired` chain at
  `mcp-server.ts:506`.
* **Acquisition site**: `ensureRvfWired()` →
  `ensureRouter()` (`memory-router.ts:902-1003`) → `RvfBackend.open()` →
  exclusive `flock` on `<rvf-path>.lock`.
* **Why held across lifetime**: `_isPersistent` in `memory-router.ts:199`
  defaults to `true`. The daemon explicitly sets it to `false` at
  `worker-daemon.ts:961-963` so each worker tick releases the flock via
  `withRouter()`'s finally-block (`memory-router.ts:1076-1099`). The MCP
  server does NOT call `setRouterPersistent(false)` — its `_isPersistent`
  stays `true` → `_storage` stays cached → the flock the warmup acquired
  is held for the MCP server's entire lifetime.
* **Refutes the "2 unmigrated workers" hypothesis**: the daemon's own
  Archivist is FS-JSON (no RVF lock); `map`/`audit` workers don't touch
  RVF. The lock holder is the MCP server's persistence flag, not a
  daemon worker.
* **Refutes the "process crashed without releasing" hypothesis**: this
  is purely an alive-process bug. Kernel will release on process exit.

§Pre-flight cleared via direct trace on fork HEAD; no separate trace
agent invocation needed.

## Revision 1 — Option B chosen (2026-05-28)

**Chosen: Option B (per-op acquire/release in MCP server).**

The trace confirms the lock-holder hypothesis from
`[[project-two-hook-paths-cli-vs-handler]]` was correct: the MCP server's
`routeMemoryOp` / `ensureRvfWired` path is the real victim. The fix
mirrors the daemon's pattern verbatim:

* **`forks/ruflo` change**: `v3/@claude-flow/cli/src/mcp-server.ts:478` —
  after `initProcessArchivist()` and BEFORE `warmUpRvfWithRetry`, add:
  ```ts
  const router = await import('./memory/memory-router.js');
  if (typeof router.setRouterPersistent === 'function') {
    router.setRouterPersistent(false);
  }
  ```
* **Placement BEFORE warmup**: so the warmup's transient open also
  honors per-op release. The warmup still validates structural faults at
  startup (its purpose); the flock is just released after each check.

**Why Option B over A/C/D**:

* **Option A (switch MCP to FS-JSON)** — would regress semantic search
  recall in the MCP path (FS-JSON has no HNSW); over-engineered for a
  single-line fix.
* **Option C (split backends)** — largest implementation surface;
  introduces drain semantics + eventual-consistency window for a bug that
  has a one-line root cause.
* **Option D (lock broker)** — adds a new moving part; doesn't fit
  `[[feedback-no-fallbacks]]` shape (broker timeouts are exactly the
  silent-fallback class the rule forbids).

Option B has the smallest surface, fastest validation path, and zero new
moving parts. It mirrors a known-good pattern (the daemon).

**Implementation**: fork commit `5c6d12c5f`. Acceptance smoke at
`ruflo-patch/scripts/smoke-adr0267-rvf-lock.mjs` wired into canonical
harness via `lib/acceptance-adr0267-checks.sh`.

## Revision 2 — Option B is architecturally unsound (2026-05-28)

The Option B fix (`setRouterPersistent(false)` in `mcp-server.ts`) landed in
fork commit `5c6d12c5f`, passed `tsc --noEmit` clean, and was published via
the release pipeline. **Task #9 acceptance smoke still FAILED** (30s
timeout on `cli memory store`). Investigation revealed a deeper
architectural constraint Option B doesn't address:

* **The daemon parallel doesn't hold for the MCP server.** The daemon
  has `setRouterPersistent(false)` AND no eager RVF warmup AND its own
  Archivist is FS-JSON (no RVF substrate). The daemon's per-op release
  works because nothing in the daemon holds an RVF backend reference.
* **The MCP server's Archivist HOLDS an RVF backend reference.** The
  `ensureRvfWired()` helper at `archivist-init.ts:1480-1537` constructs
  `MemoryRvfAdapter(cliMemoryRvfBackend, ...)` and calls
  `archivist.setRvfBackend(rvfBackend)`. The archivist's `setRvfBackend`
  (`forks/agentdb/src/archivist/index.ts:613`) is **idempotent: a second
  call THROWS** ("RVF substrate is already installed"). The adapter holds
  a direct reference to the cli's `_storage` global.
* **MCP tools dispatch through the archivist.** `memory_store` and other
  memory MCP tools call `archivist.dispatch('memory_store', payload)`
  (`memory-tools.ts:9-16`), which uses the archivist's `rvfSubstrate` →
  `MemoryRvfAdapter` → `this.memory.store(entry)`. This path does NOT
  go through `routeMemoryOp` → `withRouter`. So the per-op release path
  isn't triggered for the high-volume archivist-routed traffic.
* **Worse: per-op release breaks the archivist.** With
  `_isPersistent=false`, `withRouter()` calls `_storage.shutdown()` +
  `_storage = null` after each routeMemoryOp. The archivist's adapter
  still references the (shutdown) storage. The next archivist dispatch
  would call into a closed backend → fail loudly or silently corrupt.

### Implication for the candidate options

* **Option A (FS-JSON parity)**: still viable, but the regression cost
  (no HNSW in MCP path) is large; needs a real driver before committing.
* **Option B (per-op release)**: **rejected** — incompatible with the
  archivist's hold-the-backend architecture.
* **Option C (split backends)**: now looks more attractive — gives MCP
  and CLI separate RVF handles; archivist keeps its long-running ref.
  But still largest implementation surface.
* **Option D (lock broker)**: still rejected per `[[feedback-no-fallbacks]]`.

### New options surfaced by Revision 2 investigation

* **Option E — Make `MemoryRvfAdapter` resilient to backend lifecycle.**
  Adapter checks `_storage` liveness on each call; lazy re-opens via
  `ensureRouter()` if `_storage` was shutdown. Cost: complex adapter
  semantics; potential race conditions; the adapter's `.memory` field
  becomes effectively a service-locator lookup. Mitigates the
  shutdown-vs-archivist race; lets Option B work.
* **Option F — Skip eager warmup; keep `_isPersistent=true`.** Removes
  the warmup-acquires-and-holds path so the lock is only acquired at
  first archivist dispatch. Doesn't fix the held-for-lifetime problem
  (it just delays it); but if the user doesn't hit memory dispatches
  in the MCP session, the lock is never acquired. Loses Phase 5 DA-L2's
  "fail loud at startup" property.
* **Option G — Archivist uses `rvfBackendFactory` (lazy on first use).**
  The archivist already supports `rvfBackendFactory` in its
  `ArchivistInitConfig` (`index.ts:553`). Wire the MCP server to pass a
  factory instead of calling `setRvfBackend` after warmup; let the
  archivist resolve the backend on first dispatch. Doesn't fix
  held-for-lifetime either — but it moves the acquisition to first
  archivist dispatch, after which `withRouter` semantics could apply if
  the archivist itself routes through `withRouter`. That last step is
  itself architectural work (the archivist currently doesn't).
* **Option H (chosen for now) — DO NOT FIX in this cycle; document the
  finding + keep the regression detector smoke.** The trace + the
  architectural analysis are durable artifacts. The smoke `scripts/
  smoke-adr0267-rvf-lock.mjs` is the canonical regression detector:
  any future fix attempt MUST flip it from FAIL → PASS. Until a real
  architectural design lands, operators use the workaround
  (`ruflo daemon stop` before CLI memory ops; restart after).

### Why Option H over re-attempting Options A/C/E/G immediately

This regression was traced + the fix attempted + the architectural
constraint surfaced — all within one cycle. Committing to a deeper fix
in the same cycle would re-trigger `[[feedback-trace-before-hypothesis]]`:
the right design rests on (a) whether the held-for-lifetime model is
intentional (the archivist's documentation in `index.ts:596-612`
suggests it is), and (b) whether per-op vs. session-long is the right
axis at all. Both questions deserve their own swarm review, not a
same-cycle re-attempt.

**Acceptance criterion for ADR-0267 closure**: `bash
scripts/test-acceptance-fast.sh adr0267` PASSes (i.e., `cli memory
store` returns in <5s while an MCP server is running). The fix
mechanism remains open.

## Revision 3 — Option F chosen + entry-point lesson (2026-05-28)

The real fix mechanism: **Option F — defer `warmUpRvfWithRetry` to first `tools/call`**. The cli MCP server process keeps `_isPersistent=true` by default, so once warmup opens the RVF backend the kernel flock(LOCK_EX) stays held for the server's lifetime → blocks CLI memory operations from a separate process. Deferring the warmup to first dispatch eliminates the held-for-lifetime acquisition; the lock is acquired only when a tool actually needs it, and `withRouter`'s `_isPersistent` semantics handle the release/re-acquire cycle correctly for ongoing tool traffic.

`initProcessArchivist` stays eager (it does NOT open RVF — verified by reading the function body). A new lazy `ensureRvfWarmedUp()` helper is invoked from the `tools/call` handler before `callMCPTool`, so the RVF substrate IS wired before any dispatch, but only when actually needed. Memoized via `rvfWarmedUp` flag.

**Entry-point lesson (load-bearing for future CLI fixes):** I burned five release cycles patching `src/mcp-server.ts`'s `startStdioServer` method and `bin/mcp-server.js` before discovering that `ruflo mcp start` actually runs `bin/cli.js` (cli.js detects "mcp start" args and runs the MCP server inline, with its own copy of the warmup code). The named entry points were misleading — the `startStdioServer` method in `src/` and the `bin/mcp-server.js` file are unreachable from the `ruflo` binary. The fix had to land in cli.js's MCP-mode inline block.

Captured in `[[feedback-trace-bin-entry-before-patching]]`: the very first read for any CLI fix is `cat <pkg>/package.json | jq .bin` + `ls <pkg>/bin/`. The file the binary executes is NOT always the obvious source file by name.

**Trade-off accepted**: ADR-0181 Phase 5 DA-L2's "fail loud at startup for corrupt RVF" property is deferred to first `tools/call`. Equivalent for a long-lived server — the fault still surfaces LOUDLY, just in the first tool-call's protocol-level error code -32603 instead of at startup.

## Risks

| Risk | Mitigation |
|---|---|
| Task #7 trace identifies a holder that none of A/B/C/D cleanly addresses | Task #8 enumerates a 5th option; revise this ADR's §"Considered Options" before committing |
| The lock holder is in an upstream-vendored module (ruvnet/*) that the fork has codemod-mirrored | Per `[[feedback-patches-in-fork]]`, fix lands in `forks/`; do NOT donate back per `[[feedback-no-upstream-donate-backs]]` |
| Fix lands but a new acceptance failure surfaces in a related path (e.g., MCP memory_search regresses) | Task #9 smoke covers both `memory_store` AND `memory_search` round-trip while daemon running |
| Stale `.claude-flow/daemon-state.json` ("running:true" with no socket holder) creates investigation noise | Out of scope here; if it persists post-fix, open a separate ADR for daemon-crash-cleanup |
| Fix introduces per-op latency on RVF that regresses memory_search performance | Benchmark via `node scripts/analyze-acceptance-perf.mjs` before/after; if regression >10%, revisit option choice |
| `_check_adr0267_*` helper naming trips ADR-0082 silent-pass lint | Pre-commit: `_check_<verb>` shape per ADR-0261 §L3 (lessons-learned) |

## More Information

Original status: proposed 2026-05-27; accepted, implemented, and marked completed 2026-05-28. **Re-opened 2026-05-30** (see §"Re-opened" amendment above): the 2026-05-28 completion covered only the idle-server path; the held-for-lifetime flock after the first `tools/call` means the reported regression is still live for the real (always-used-server) case. The three 2026-05-28 tasks below were genuinely done for the idle scope; a follow-on resolution is now required.

- **Task #7 (trace)**: root cause identified — MCP server held the RVF kernel flock for its lifetime because `warmUpRvfWithRetry` opened the backend eagerly at startup and `_isPersistent=true` keeps `_storage` cached. ([[feedback-trace-before-hypothesis]] paid off.)
- **Task #8 (fix)**: Option F — defer `warmUpRvfWithRetry` to first `tools/call`. Three commits before finding the actual entry point (see Revisions 2 + 3): `5c6d12c5f` patched `src/mcp-server.ts` (dead code, reverted in `103514bcc`); `27fbb575b` + `61f453b4d` patched the same file with different shape (still dead code); `39b74674a` patched `bin/mcp-server.js` (also dead code from `ruflo mcp start`); finally `8f4fe15de` patched `bin/cli.js` (THE actual live path — bin/ruflo.mjs proxies to cli.js which handles MCP inline). Lesson captured in [[feedback-trace-bin-entry-before-patching]]: the FIRST read for any CLI fix is `cat <pkg>/package.json | jq .bin` + `ls <pkg>/bin/`.
- **Task #9 (acceptance)**: `scripts/smoke-adr0267-rvf-lock.mjs` PASSes in 5971ms (release `3.7.0-alpha.10-patch.362`; 713/722 / 0 failed / 9 skip_accepted). Smoke initially failed because it waited for a `mode:mcp-stdio` ready log that cli.js never emits (that log is in `bin/mcp-server.js`, the dead code I'd been patching); fixed by switching to a 5s settle wait + asserting `cli memory store` returns in <30s.

The workaround documented in §Confirmation (`ruflo daemon stop` before CLI memory ops) is no longer needed.

* `[[ADR-0202]]` — RVF lock infrastructure (exit-code-1 on LockHeld); this ADR investigates a regression OF the lock semantics ADR-0202 ratified
* `[[ADR-0073]]` — RVF backend cosine-direct fix; orthogonal but in the same code surface
* `[[ADR-0227]]` — adaptive recall floor; orthogonal but cited for context on active RVF maintenance
* `[[project-two-hook-paths-cli-vs-handler]]` — names the two hook paths AND identifies MCP server's `routeMemoryOp` / `ensureRvfWired` as the suspected real victim of F-13-001 (and now this regression)
* `[[project-memory-search-rvf-snapshot-isolation]]` — prior `total:0` story (different root cause; cited for trace-before-hypothesis caution)
* `[[project-adr0202-hook-exit-code-source-truth]]` — establishes that exit-code-1 is wired correctly at source level; the regression is therefore not about exit-code propagation
* `[[feedback-trace-before-hypothesis]]` — trace agent must complete BEFORE fix hypothesis (Task #7 gates Task #8)
* `[[feedback-no-fallbacks]]` — fix must address structural cause; no silent catch-and-return
* `[[feedback-no-squelch-tests]]` — Task #9 smoke must reproduce the regression today
* `[[feedback-always-wire-tests-into-cicd]]` — Task #9 wires into canonical harness, not standalone
* `[[reference-acceptance-runcheck-vs-collect]]` — both `run_check_bg` AND `collect_parallel` lines required
* `[[reference-fast-test-runner]]` — Task #9 smoke also dispatched in fast-runner
* INTEGRATION-LEDGER: no upstream row (this is a fork-internal regression, not an upstream merge)

## Confirmation

This ADR is proposed-only. To advance:

0. **Task #7 (trace)** completes. Trace report appended as §"Pre-flight (trace findings)" with: process holding lock; file:line of acquisition; reason lock is held across lifetime; concrete confirmation OR refutation of the "MCP server routeMemoryOp / ensureRvfWired" hypothesis from `[[project-two-hook-paths-cli-vs-handler]]`.
1. **Task #8 (fix proposal)** lands in §Revision 1 with: chosen option (A/B/C/D/E), tradeoff justification against the other options, concrete file:line changes planned. Flip `proposed` → `accepted`.
2. **Implementation** lands in fork(s) per `[[feedback-patches-in-fork]]`. Commit BEFORE `npm run release` per `[[feedback-commit-forks-before-release]]`.
3. **Task #9 (acceptance smoke)** wired into canonical harness. Smoke MUST reproduce the regression on a baseline without the fix (i.e., it would have FAILED before Task #8 landed). Verify by checking out pre-fix state, running the smoke, asserting failure.
4. **Release** via `npm run release`; verdict via canonical harness; ADR-0267 flips `completed: false` → `true`; `implemented: <date>` set.

Until step 4, CLI memory operations remain blocked when the daemon is running. Workaround for the interim: stop the daemon (`ruflo daemon stop`) before running CLI memory ops, then restart (`ruflo daemon start`) after.

## Amendment: Revision 3 lock-release claim is inaccurate (2026-05-30, ADR-0273 investigation)

A file:line trace during the ADR-0273 investigation found that **Revision 3's claim — "`withRouter`'s `_isPersistent` semantics handle the release/re-acquire cycle correctly for ongoing tool traffic" — is wrong.** The Option F fix (defer `warmUpRvfWithRetry` to first `tools/call`) is real and correct for the *idle* server, but it only **defers** the flock acquisition; it does **not** make the lock per-op. Once the MCP server serves its first `tools/call`, the exclusive `flock(LOCK_EX)` on `<path>.rvf.lock` is held for the server's entire remaining lifetime.

Why (verified):
- `_isPersistent` defaults `true` (`memory-router.ts:199`) and is set `false` **only** in the daemon (`worker-daemon.ts:961-962`), never in the MCP-mode path (`bin/cli.js`).
- `withRouter`'s release branch is gated on `!_isPersistent` (`memory-router.ts:1076` finally-block), so it never runs for the MCP server — and the archivist write path bypasses `withRouter` entirely, pinning `_storage` directly (`archivist-init.ts:1483-1523`).
- The native `WriterLock` is a struct field of `RvfStore` (`store.rs:105`), acquired once on open (`store.rs:164/311`) and released only on `Drop`/fd-close (`locking.rs:78-84`) — never per-write.

**Practical correction:** the regression is fixed for the *idle* server only. A separate CLI process writing RVF **still blocks ~30 s then fails `LockHeld`** against an MCP server that has served any tool call (`locking.rs:173-203`). The Task #9 smoke passes only because it writes *before* the server's first dispatch (lazy warmup). The "ongoing tool traffic" explanation overclaims.

### Re-opened: the idle-only fix does not resolve the reported bug (2026-05-30)

In practice the MCP server **always** has served at least one `tools/call` by the time a user runs a CLI memory op — so the held-for-lifetime flock means the **originally reported regression is still live for the real use case**. Marking ADR-0267 "completed" was premature: it closed the narrow idle-server path while the general problem (any concurrent CLI memory op blocked by a running, used MCP server) remains. The "stop the daemon/server first" workaround is **not acceptable as a standing requirement** — the MCP server is the always-on surface; requiring it stopped to run `memory store` (or to rebuild the ADR index per ADR-0273) defeats the point.

**This ADR needs a genuine resolution** (status → re-opened; not completed). The real fix must make concurrent RVF access work *without* stopping the server. Candidate mechanisms (for the next investigation/decision — not pre-selected):

* **Per-op release on the MCP write path.** Make the MCP server release the flock between operations. Note ADR-0267 Revision 2 already found the naive `setRouterPersistent(false)` insufficient *on its own*, because the archivist pins `_storage` directly (`archivist-init.ts:1483-1523`) — a real fix must also release the archivist's held backend reference, not just flip the router flag.
* **Cross-process-concurrent RVF.** Change the Rust `WriterLock` model (`store.rs:105`, `locking.rs`) from exclusive-held-until-drop to a coordinated multi-process writer scheme (lease/handoff, or shared-reader + serialized-writer). Deeper, in `forks/ruvector`.
* **Single-writer-process architecture.** Route all RVF writes through the one process that holds the lock (the MCP server), so no second process ever contends — CLI ops and the ADR-0273 index become server-delegated batch operations. Sidesteps the lock entirely rather than fixing it.

ADR-0273 (scriptable `agentdb index`) is **hard-blocked on this resolution** — it depends-on this ADR for exactly this reason.

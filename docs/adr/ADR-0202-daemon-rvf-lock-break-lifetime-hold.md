---
status: implemented
date: 2026-05-19
accepted-on: 2026-05-20
implemented-on: 2026-05-21
tags: [daemon, rvf, archivist, hooks, locking, swarm-reviewed]
supersedes: []
depends-on: [0201]
implements: []
---

# Break daemon RVF lifetime lock to enable hook persistence

> **Decision VALIDATED by a 6-expert swarm review (2026-05-20) — Option A
> confirmed, but the implementation spec and two benefit claims are
> corrected (see `## Swarm review evidence`).** The premise is true (the
> daemon holds `.rvf.lock` for life; both memory workers ship `enabled:true`;
> F-13-001 is real and live). Option A (per-op acquire/release) is the right
> fix and matches the native RVF store's open-per-op design intent. **But
> three things in this ADR as originally written are wrong and MUST be fixed
> before implementation:** (1) the mechanism "null `_storage`" does **not**
> release the flock — the `finally` must call `await _storage.shutdown()`,
> and a second cache layer (`storage-factory.ts backendCache`) must also be
> evicted; (2) the "loud-by-default" benefit is **not** delivered by Option A
> — a bare-catch swallow at `memory-router.ts:2077` neutralizes the
> fail-loud throw, so F-13-009 must be co-fixed (remove the swallow) or the
> claim dropped; (3) ADR-0167 is **implemented**, not "planned" — it fixed
> the N=8 read-side boot race, is orthogonal to the lifetime-hold. Option B
> is policy-barred (converging to upstream's lock-free daemon means
> SQLite-first, violating `project-rvf-primary`) and stays a documented
> fallback. The contention test (Confirmation #2) is the load-bearing gate.
>
> **THIRD REVIEW — 6-expert DIALECTIC (2026-05-20), queen-synthesized after thesis→antithesis→rebuttal (not parallel monologues).** Option A re-affirmed. Prior corrections #1 (await-shutdown mechanism) and #3 (ADR-0167 implemented/orthogonal) VERIFIED at file:line. **But two prior "corrections" are themselves wrong and are reversed here:** (a) the "`:2077` swallow defeats loud-by-default" claim is **REFUTED** — `routeFeedbackOp` calls `await ensureRegistry()` (`memory-router.ts:2022`) *before* the `switch` that holds the `:2077` swallow, so under F-13-001 the `LockHeld` throws at init and escapes loud to `hooks-tools.ts:857`; `:2077` only masks a rarer *post-init* mid-op write race (the devil challenged this refutation and conceded). (b) F-13-009 "exit 0" is **NOT live** — the CLI already exits 1 (`index.ts:304` `process.exit(result.exitCode || 1)`); the audit's `EXIT:0` was a measurement artifact ([[feedback-run-and-kill-exit-code]]). **Severity re-anchored:** the production `.claude/settings.json` hook path is **lock-free** (`intelligence.cjs` reads `.rvf` as raw bytes via `fs.readFileSync`, no `RvfDatabase.open` → no flock), so F-13-001 does NOT silently break PostToolUse hooks; the genuine exposure is the **MCP-server process** (`memory-tools.ts:60` `memory_store` → `ensureRvfWired` contends with the daemon flock), **direct `ruflo hooks`/`memory` CLI subcommands**, and the **ADR-0204 ordering hazard**. **No new blockers — one robustness correction (a "BLOCKER" was raised then RETRACTED under evidence during the rebuttal round):** `await _storage.shutdown()` IS sufficient. `_storage` and the registry's `this.backend` are the **same cached `RvfBackend`** (path-dedup `.db→.rvf` at `storage-factory.ts:97-104`; the audit lsof shows a single `.rvf`+`.rvf.lock` FD pair on one PID — not two flocks), so shutting down `_storage` releases the one shared flock for BOTH the preload and consolidate workers. Robustness nit only: prefer `shutdownRouter()` per tick (it also resets `_registryInstance` so the registry singleton isn't left pointing at a closed backend) — but a stale pointer fails LOUD or re-opens via `createStorage`, not a lock leak; either shape is correct. Plus corrections below: phantom acceptance-check name, wrong package paths (`storage-factory.ts`/`rvf-backend.ts` are in `@claude-flow/memory`), and the 0167/0168 citation.

## Context and Problem Statement

The 2026-05-19 soundness audit (ADR-0201) ran a runtime probe against a fresh `@sparkleideas/ruflo@latest` install from Verdaccio. The probe started the daemon, then fired the documented hook lifecycle. Finding F-13-001 [CRITICAL] is the audit's single most important result:

> Once `daemon start` succeeds, the daemon's Memory Archivist holds `.swarm/memory.rvf` and `.swarm/memory.rvf.lock` open for the daemon's entire lifetime. Subsequent CLI hook invocations (`post-edit`, `post-command`, `post-task`, `route`) attempt to acquire the lock, wait 30s, then fail with `RVF error 0x0300: LockHeld`. Exit code is still 0, hiding the failure.

The probe captured the smoking gun:

```text
$ lsof .swarm/memory.rvf
COMMAND   PID    USER  FD   TYPE        NODE  NAME
node    39589  henrik  16u  REG    281367977  .swarm/memory.rvf
node    39589  henrik  15u  REG    281367976  .swarm/memory.rvf.lock

$ ruflo hooks post-task --task-id task-X --result success
[ERROR] Post-task hook failed: ...RVF error 0x0300: LockHeld...
EXIT: 0
```

Code-side root cause (verified against fork source):

1. `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:1485-1656` — daemon workers (`runConsolidateWorker`, `runPreloadWorker`, etc.) lazy-import `memory-router.js` and call `routeEmbeddingOp`, `routeLearningOp`, `loadEmbeddingModel`.
2. `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:857-919` — `_doInit()` constructs `RvfBackend` via `createStorage({ databasePath, dimensions })`. Backend boot acquires the kernel flock on `<path>.lock` (the native `WriterLock`) and the JS advisory `<path>.jslock`.
3. `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:164,311,1259` — `WriterLock::acquire(path)` is the exclusive flock; FIFO ordering across processes; held until `RvfStore` drop.
4. Backend instance is cached in `memory-router._storage` (module-level state). Locks are only released via `shutdownRouter()` (`memory-router.ts` ~535), which the daemon only calls in its `stop()` path (`worker-daemon.ts:1058-1059`).

Net behaviour: as soon as the first daemon worker tick fires a memory-router op, the lock is held until `daemon stop`. The hook-handler CLI is a separate Node process, hits `_doInit` in its own memory-router instance, calls `WriterLock::acquire(<path>.lock)`, gets `LockHeld`, retries against a 30s budget, fails, returns exit 0. Note: the daemon's *own* Archivist (ADR-0181 Phase 1) is FS-JSON only and **does not** hold the RVF lock — the audit's "Memory Archivist holds the lock" framing is imprecise; the actual holder is the daemon's memory-router-cached `RvfBackend`. The decision is unchanged.

ADR-0088 already removed the original daemon-as-sole-writer architecture (ADR-0059 Phase 4), declaring the daemon "scheduler-only, not in hot path". ADR-0088's amendment removed the IPC memory-write handlers; the IPC server is left running with zero registered methods (F-10-001). The result is the worst-of-both-worlds shape the audit found: the daemon both (a) does no IPC work, AND (b) holds the file lock that blocks hook writers anyway because its workers happen to need the memory-router for their *own* internal reads. ADR-0088's intent ("daemon doesn't gate the hot path") is silently violated by lock contention.

Per `feedback-no-fallbacks` the documented mitigation `hooks.bridgeFallback: true` is unacceptable: it enables a degraded path that pretends to succeed. The real fix is to break the lifetime hold on the lock so multiple processes can write the same RVF file safely.

## Decision Drivers

* **The real exposure is the MCP-server + CLI paths, NOT the settings.json hooks** ⚠️ **RE-ANCHORED (dialectic 2026-05-20):** the original driver claimed "every `PostToolUse` fire from `.claude/settings.json` writes memory [and] silently fails after `daemon start`." That is **false at runtime** — the production hook path (`settings.json` → `hook-handler.mjs` → `intelligence.cjs`) is **lock-free**: it reads the `.rvf`/`.wal` as **raw bytes via `fs.readFileSync`** (no `RvfDatabase.open`, no native lib, no flock) and `fs.appendFileSync`s its own JSON. So F-13-001 does not break PostToolUse hooks. The genuine exposure is (a) the **MCP-server process** — `memory_store`/`agentdb_*` over stdio do `await ensureRvfWired()` (`memory-tools.ts:60`), opening the RVF flock the daemon holds for life → `LockHeld`; (b) **direct `ruflo hooks`/`memory` CLI subcommands** (which DO open the RVF backend); and (c) the **ADR-0204 ordering hazard** (0204 makes `ensureRvfWired()` a serving precondition — it would hang/fail under the pre-fix daemon lock). The fix unblocks all three.
* **No silent fallbacks** (`feedback-no-fallbacks`): the mechanism MUST surface lock-contention errors, never mask them. `bridgeFallback: true` is exactly the antipattern; this ADR explicitly rejects it.
* **No new sidecar files unless justified** (ADR-0154): the `.rvf` is canonical; only `.wal`, `.lock`, `.jslock`, `.ingestlock` are sanctioned siblings.
* **Preserve Rust-side authority** (ADR-0167): the runtime is the durability layer. Solutions implemented purely in JS can be undermined by future native changes.
* **Preserve ADR-0088's scheduler-only scope**: the daemon is NOT the memory RPC server. Reintroducing the memory client/server protocol would re-litigate ADR-0088. This ADR's options that "move archivist out of daemon" or "release lock between operations" preserve ADR-0088; options that "route through daemon IPC" reverse it.
* **Single binding contract**: ruflo, agentic-flow, hooks, MCP tools, and the daemon all share `RvfBackend`. The chosen mechanism must apply uniformly across all consumers.
* **Cross-platform**: macOS arm64/x64, Linux arm64/x64 (gnu + musl), Windows x64/arm64. POSIX flock semantics differ from Windows file-share semantics.
* **Existing infrastructure exists**: ADR-0167 already authorised a Rust-side RVF concurrency redesign for N≥8 cross-process writers. Whatever this ADR chooses must compose with that work, not duplicate or contradict it.

## Considered Options

* **Option A — Per-op transactional acquire/release**: The daemon's memory-router does not cache `RvfBackend` between operations. Each worker that touches memory opens the backend, performs its op, closes, releases the lock. Same shape for the hook CLI. Locks are held only for the duration of a single read or write.
* **Option B — Move archivist work out of the daemon entirely**: The daemon stops calling memory-router. Workers that need memory data fire MCP-dispatch queue entries the hook CLI picks up, or are deferred. Hooks own all RVF access; daemon is purely a scheduler with no memory I/O.
* **Option C — WAL-mode RVF with reader/writer separation**: Extend the RVF runtime so concurrent readers do not contend with a single active writer. Use a write-ahead log such that the manifest swap is atomic and readers route around the active writer. The daemon's read-only paths take no lock at all.
* **Option D — POSIX advisory MROW (multiple-reader / one-writer) locks via `fcntl(F_SETLK)`**: Replace exclusive `flock` with byte-range advisory `fcntl` locks. Readers take shared locks on the header byte; writer takes exclusive lock on a dedicated "writer-token" byte. Coexists with the existing `.jslock` advisory.
* **Option E — Bridge through the daemon IPC socket** (reverses ADR-0088): Reactivate the daemon-as-sole-writer model. Register `memory.*` handlers on `DaemonIPCServer`; hook CLI connects via Unix socket and proxies all writes through the daemon. Single writer, no contention.

## Decision Outcome

Chosen option: **Option A — Per-op transactional acquire/release**, because:

1. **It directly addresses the root cause without changing the architecture contract**. ADR-0088 is preserved: the daemon stays scheduler-only, the file is the source of truth, no IPC protocol re-emerges. The fix is "stop holding the lock past the operation that needed it."
2. **It shrinks the contention window from lifetime to milliseconds, and the `LockHeld` IS already loud.** ⚠️ **RE-CORRECTED (dialectic 2026-05-20 — supersedes the prior swarm note):** the prior swarm claimed a bare-catch at `memory-router.ts:2077` swallows the `LockHeld` so the hook exits silently. That is **false for F-13-001**. `routeFeedbackOp` calls `await ensureRegistry()` at `:2022`, *before* the `switch (op.type)` whose `case 'record'` contains the `:2077` swallow. Under contention the `LockHeld` is thrown inside `_doInit` (during `ensureRegistry`) and propagates out at `:2022` — it **never reaches** `:2077`. The fail-loud throw at `hooks-tools.ts:857` (HK-002a) **does fire today** (the audit's captured stderr `"routeFeedbackOp failed: …LockHeld"` is the *escaped* throw, not a swallow). The `:2077` bare-catch only masks a *post-init* mid-op write failure — a rarer, secondary race; it is a real `feedback-best-effort-must-rethrow-fatals` smell worth a separate cleanup, but it is **not** the loud-by-default gate and is **not** required by Option A. (runtime-0202 traced this; devil-0202 attempted to break the refutation and conceded — no swallow path exists in `ensureRegistry`/`_doInitRegistry`.)
3. **The retry machinery already exists**. `RvfBackend.open` is built with cold-start retry (`MAX_COLDSTART_RETRIES`, `LockHeld` typed retry — see `store.rs:243-279`). Per-op acquire/release simply uses the same retry path the existing N≤6 multi-writer story relies on (ADR-0095, ADR-0163, ADR-0165). No new mechanism.
4. **It composes with ADR-0167's RVF rewrite, which is already implemented and orthogonal.** ⚠️ **CORRECTED (swarm 2026-05-20):** ADR-0167 is not "planned" — `f4cbbf45e` ("adr-0167 phase 1: RootHeader", 2026-05-10) + the in-process writer coordinator `9781bc8f0` (self-tagged **"adr-0168 phase 2"**, 2026-05-11), both in **forks/ruvector**, landed. They fixed the **N=8 read-side boot-race** and left `WriterLock`-held-until-drop unchanged; the daemon's **lifetime-hold is a different layer** (JS handle lifecycle, not Rust boot convergence). So Option A is not churn against 0167 — they compose. The genuine long-term convergence target is upstream's lock-free atomic-rename persist model (maps to Option C), tracked separately.
5. **Smallest change surface**: only `memory-router.ts` (`_doInit` → `_initialized` flag + cached `_storage`) plus the daemon's worker entry points need adjustment. Hooks already construct their memory-router per CLI process and exit; they're already in the desired shape — only the daemon needs to stop caching the backend.

Rejected alternatives:

* **Option B (move archivist out)** is structurally cleaner but punts the question. The daemon's `runConsolidateWorker` and `runPreloadWorker` *legitimately* need memory access (consolidation, model preload, HNSW status). Pushing them out via the dispatch queue moves the cost to a different process without solving the cross-process locking problem.
* **Option C (WAL-mode RVF)** is the long-term right answer and overlaps ADR-0167's Wave 2 scope. It is months of Rust runtime work; F-13-001 is shipped-and-breaking-today. Adopt it later if/when ADR-0167 lands; per-op acquire/release is the bridge.
* **Option D (MROW via `fcntl`)** is platform-fragile (Windows lacks `F_SETLK` semantics, requires `LockFileEx` translation; macOS APFS has historical bugs with advisory byte-range locks) and would require a Rust-side change to the `WriterLock` abstraction — also overlaps ADR-0167's scope. Per-op acquire/release works on every platform `RvfBackend` already supports.
* **Option E (daemon IPC)** reverses ADR-0088. The IPC handler set the audit found dead (F-10-001) exists in source but was deliberately removed. Reactivating it puts the daemon back in the hot path — exactly what ADR-0088 said NOT to do. Also creates a single point of failure: daemon crash kills memory writes for every hook. Rejected.

### Supersession scope

This ADR does not supersede any other. ADR-0088's "daemon is scheduler-only" is **preserved** (Option A keeps the daemon out of the hot path; the failure mode this fixes was an unintended side-effect of caching, not a deliberate ADR-0088 choice). ADR-0167's Rust-side rewrite is **independent** — when it lands, the per-op acquire/release pattern continues to work and benefits from whatever stronger concurrency primitive lands underneath.

### Consequences

* Good, because hook lifecycle works end-to-end with a running daemon for the first time since ADR-0088 amendment removed the IPC memory handlers.
* Good, because lock-contention is loud-by-default — under contention `LockHeld` is thrown, escapes `routeFeedbackOp:2022` to the fail-loud throw at `hooks-tools.ts:857`, and the CLI exits 1. (This loudness already holds today; it is NOT a property Option A adds. The `:2077` post-init swallow and the six residual `bridgeFallback` message strings are separate cleanups — Confirmation #4 — but neither gates F-13-001 loudness.) Matches `feedback-no-fallbacks`.
* Good, because ADR-0088's scheduler-only scope is preserved; no IPC handler re-emerges; no architectural reversal.
* Good, because composes cleanly with ADR-0167's planned Rust-side rewrite — that work strengthens the underlying lock primitive without requiring this ADR to be re-decided.
* Good, because hooks invoked in parallel with daemon workers behave the same as the existing N≤6 multi-writer story (ADR-0095/0163/0165 already cover this regime).
* Bad, because cold-start cost per memory op increases. Each daemon worker that touches memory pays the `RvfStore` boot cost (~1-3s observed in ADR-0167's prior council). Mitigation: cache the backend handle within a single worker tick if it makes multiple ops; release between ticks.
* Bad, because real lock contention (e.g. consolidate worker overlapping with hook CLI) will surface `LockHeld` errors to the user. This is correct per `feedback-no-fallbacks` but represents a UX regression from "silent success" to "visible transient error". The existing retry budget (`MAX_COLDSTART_RETRIES` + JS 30s wait) should absorb most cases; cases that escape need observable telemetry.
* Bad, because the fix requires `_initialized` and `_storage` lifecycle to become per-call rather than per-process. Risk of regressing the N≤6 multi-writer behaviour (ADR-0095/0163/0165 tests) — those tests must continue to pass.
* Neutral, because F-13-002 (`hooks route` hangs indefinitely) needs a separate fix — that's a missing timeout on the route command's lock-acquire, not addressed by per-op acquire/release directly. Probably becomes a follow-up ADR.
* Neutral, because F-13-009 (hook commands exit 0 on `LockHeld`) is **already fixed in current source** on the CLI path — `mcp-client.ts:177` re-throws, `hooks.ts` returns `{success:false, exitCode:1}`, `index.ts:304` `process.exit(result.exitCode || 1)`. The audit's `EXIT:0` was a measurement artifact ([[feedback-run-and-kill-exit-code]]), not a live defect. Only a regression test (assert exit 1 under contention) is owed.
* Neutral, because the daemon's projectRoot-only Archivist (ADR-0181 Phase 1) is untouched. FS-JSON substrate does not contend with the RVF lock. Only the daemon's memory-router callers (consolidate/preload workers, `routeEmbeddingOp`, `routeLearningOp`, `loadEmbeddingModel`) change shape.

### Confirmation

The decision is verified by a new acceptance check `check_adr0202_daemon_lock_breaks` exercising the canary scenario the audit found:

```bash
# Pseudocode for the acceptance check
sandbox=$(mktemp -d /tmp/ruflo-adr0202-XXXXXX)
trap "rm -rf $sandbox" EXIT

cd "$sandbox"
npm install --registry=http://localhost:4873 @sparkleideas/ruflo@latest
ruflo init --force --no-global
ruflo daemon start

# CANARY: this MUST succeed end-to-end (was the F-13-001 failure)
ruflo hooks post-edit --file dummy.txt
test $? -eq 0 || fail "post-edit exit non-zero"

# Verify the side-effect actually persisted
grep -q '"originatingTool":"memory_store"' .claude-flow/data/archivist-audit.jsonl \
  || fail "audit trail empty — write did not land"

# Verify the daemon does NOT hold the lock BETWEEN ops (the real ADR-0202 assertion).
# NB: daemon workers run as `node`, so match by the daemon's PID — grepping for
# "daemon"/"worker" in lsof output matches nothing and is a silent no-op (dialectic fix).
daemon_pid=$(grep -oE '"pid":[0-9]+' .claude-flow/daemon-state.json 2>/dev/null | head -1 | grep -oE '[0-9]+')
held_by_daemon=$(lsof .swarm/memory.rvf 2>/dev/null | awk -v p="$daemon_pid" 'NR>1 && $2==p' | grep -c .)
test "${held_by_daemon:-0}" -eq 0 || fail "daemon still holding RVF lock between ops — ADR-0202 violated"

ruflo daemon stop
```

Additional confirmation surface:

1. **Unit test** in `forks/ruflo/v3/@claude-flow/cli/src/memory/__tests__/memory-router-lock-lifecycle.test.ts`: assert `_initialized` flips back to `false` and `_storage` reaches `null` after each `routeMemoryOp`/`routeEmbeddingOp`/`routeLearningOp` call in the daemon scope (vs the hook CLI scope, which is allowed to cache for its CLI lifetime).
2. **Integration test** in `forks/ruflo/v3/@claude-flow/cli/__tests__/integration/daemon-hook-coexistence.test.mjs`: spawn daemon, spawn hook process, assert both can write to the same RVF file without `LockHeld` errors on the happy path. Repeat under contention (10 hooks fired in parallel with active daemon worker tick) and assert all eventually succeed via the existing retry budget — none exit 0 with `[ERROR]` in stderr (the F-13-009 anti-shape).
3. **ArchUnit-style structural rule**: a grep-rule in the patch acceptance harness asserting that `worker-daemon.ts` never imports `memory-router.js` outside an `async` function that immediately awaits the op and exits. Prevents accidental re-introduction of module-scoped caching. Lives in `scripts/lint-no-daemon-lock-cache.mjs`.
4. **No `bridgeFallback: true` recommendation in any user-visible error message**: grep the dist for that exact string in `hooks-tools.js`. Per `feedback-no-fallbacks` the fix narrative MUST be "your daemon and hook collided, retry" or "the lock is genuinely stuck, investigate" — never "enable a degraded path."
5. **Existing N=6 acceptance check `check_t3_2_rvf_concurrent_writes`** (`lib/acceptance-adr0079-tier3-checks.sh:127`, N=6 at `:134`) continues to pass — the per-op lifecycle must not regress the N≤6 multi-writer story (ADR-0095/0163/0165). ⚠️ (The previously-cited `check_adr0095_cross_process_convergence` does **not exist** — dialectic correction.)

Status flips to `accepted` once (1)+(2) ship green in `npm run release` and the runtime canary in (the acceptance check) reproduces F-13-001's exact pre-fix scenario as a regression test.

## Swarm review evidence (2026-05-20)

Reviewed by a 6-expert adversarial swarm (queen + domain architect +
runtime/feasibility + code archaeologist + upstream analyst + devil's
advocate), applying [[feedback-remediation-adr-preflight]]. **Decision
(Option A) validated; implementation spec + two claims corrected.**

- **Premise CONFIRMED at runtime (#3).** The daemon holds `.rvf.lock` for
  life: first worker tick caches `_storage` (`memory-router.ts:900/919`),
  released only at `daemon stop` (`worker-daemon.ts:1059`). The
  `worker-daemon.ts:934` "the daemon has no memory-router" comment is scoped
  to the ADR-0181 Archivist adapter (added by `5c21e52b8`) — it is NOT a
  claim the daemon process skips memory-router; the consolidate (`:1501`) +
  preload (`:1655`) workers do import and call it. Both ship `enabled:true`
  (`:111`, `:131`); preload fires 90s after start and holds the lock for
  life. Real CRITICAL. **Action: delete/correct the misleading `:934`
  comment as part of the fix** (it is the source of the audit's "Archivist
  holds the lock" imprecision).
- **Implementation correctness gap (CRITICAL).** The original "null
  `_storage`" mechanism would not release the flock — two cache layers pin
  it (`_storage` + `storage-factory.ts:34 backendCache`); only
  `await _storage.shutdown()` drops the native store and evicts the cache.
  Corrected in §Implementation. As literally written, Option A would ship a
  non-working fix.
- **The prior swarm's `:2077` "loud-by-default defeated" correction is itself REFUTED (dialectic 2026-05-20).** `routeFeedbackOp` awaits `ensureRegistry()` at `memory-router.ts:2022`, *before* the `switch` whose `case 'record'` holds the `:2077` swallow. Under F-13-001 the `LockHeld` throws inside `_doInit` (during `ensureRegistry`) and propagates out at `:2022`, reaching the fail-loud throw at `hooks-tools.ts:857` — the audit's `"routeFeedbackOp failed: …LockHeld"` stderr IS that escaped throw, not a swallow. `:2077` only masks a *post-init* mid-op write race (a real `feedback-best-effort-must-rethrow-fatals` smell, worth a separate cleanup, but NOT the F-13-001 loudness gate). devil-0202 tried to break this refutation and conceded. F-13-009 exit-0 is likewise not live — the CLI exits 1 (`index.ts:304`); the audit `EXIT:0` is a measurement artifact ([[feedback-run-and-kill-exit-code]]).
- **Confirmation #4 already FAILS today.** `bridgeFallback: true` strings
  exist in fork source (`hooks-tools.ts:859,947,1359,1376,1621,1638`); the
  acceptance gate cannot pass until the fix rewrites those messages. The
  contention test (Confirmation #2 — 10 parallel hooks + active worker tick,
  all absorbed by the retry budget) is the **load-bearing gate**: A narrows
  the window on a still-`flock(LOCK_EX)` lock (`locking.rs`), so it is a
  probability reduction, not elimination. **#2 must not be `skip_accepted`.**
- **ADR-0167 is IMPLEMENTED, not "planned" (#4 / stale tense).**
  `f4cbbf45e` ("adr-0167 phase 1: RootHeader", 2026-05-10) + `9781bc8f0`
  (self-tagged "adr-0168 phase 2: in-process writer coordinator", 2026-05-11)
  — both in **forks/ruvector** — fixed the N=8 read-side boot-race and left
  `WriterLock`-until-drop unchanged — **orthogonal** to the lifetime-hold.
  Option A is NOT churn (different layer: JS handle lifecycle vs Rust boot
  convergence). Correct the "when it lands" wording in Drivers / Decision
  Outcome #4 / Supersession / Option C cons. (Also: `.wal` is already in
  `RVF_CANONICAL_EXTENSIONS` — Option C's "new sibling needs justification"
  objection is weaker than stated.)
- **F-13-001 is fork-only; B is policy-barred (#2).** `memory-router.ts` is
  absent upstream (404); upstream's daemon workers write static metric-JSON
  stubs and touch no RVF/lock — F-13-001 is structurally impossible
  upstream. The fork *invented* it by wiring real ops into stub-shaped
  workers AND adopting the held native flock (upstream's `rvf-backend.ts`
  uses lock-free atomic write+rename + an in-process `persistQueue`, #1614/
  PR #1655 — which is the *in-process* write-drop fix, **orthogonal** to
  F-13-001; the ADR should not lean on #1614 as precedent). **Option B
  ("converge to upstream's lock-free daemon") means SQLite-first /
  atomic-rename = violates `project-rvf-primary`**, and the fork's
  consolidate/preload do live load-bearing work upstream stubs out. So B is
  not a free convergence — it is a policy-barred feature-removal. B stays a
  documented **fallback** (adopt only if the Confirmation #2 contention test
  proves the retry budget cannot absorb bursty parallel hooks). The native
  RVF store is *designed* to be opened-per-op and `close()`d — **Option A
  matches the native API's intent**; the daemon's caching is the anti-pattern.
- **The real long-term convergence target is the runtime lock model**
  (upstream's lock-free atomic-rename), which maps to Option C / ADR-0167 —
  not memory-router. Note this; it strengthens the bridge framing.
- **Lineage (origin).** Fork original-sin: ADR-0084 Phase 3+4 (`0f3ba8226`,
  daemon→memory-router) + ADR-0086 Phase 2a (`361b4bb3c`, the `_storage`
  cache), both 2026-04-13. ADR-0094 (`07f324726`) added `process.on('exit')`
  release — works for short-lived CLIs, useless for the long-lived daemon.
  No prior `_isPersistent`/`withRouter` attempt exists.
- **Line-number caveat.** `WriterLock::acquire` sites cited as
  `store.rs:164,311,1259` are stale; verify against the fork's **pinned**
  ruvector (`store.rs:105` field, `:311` acquire, `:1258` drop observed) —
  not upstream RuVector HEAD (`:87/:132/:1620`). N≤6 invariants (d12–d14,
  ADR-0095/0163/0165) must stay green; the contention test is the guard.

## Pros and Cons of the Options

### Option A — Per-op transactional acquire/release

* Good, because preserves ADR-0088 (daemon stays out of the hot path).
* Good, because no new mechanism — uses the existing `RvfBackend` retry budget the multi-writer story already depends on.
* Good, because uniform across all consumers (daemon, hooks, MCP tools, agentic-flow) — they all already construct memory-router per process; only the daemon needs to drop its caching.
* Good, because forward-compatible with ADR-0167's Rust-side rewrite.
* Bad, because cold-start cost per memory op (1-3s `RvfStore` boot). Mitigation: per-tick caching with end-of-tick release.
* Bad, because contention windows now surface real `LockHeld` errors to the user during the millisecond overlap between a hook and a worker. Per `feedback-no-fallbacks` this is the *correct* behaviour, but it is a visible UX regression that needs clear retry documentation.

### Option B — Move archivist out of daemon entirely

* Good, because cleanest separation: daemon is purely a scheduler.
* Good, because no in-daemon memory I/O means no lock contention with hooks by construction.
* Bad, because the consolidate and preload workers legitimately need memory access. Punting them to the dispatch queue moves the load to the hook CLI's address space — same locking problem, different process.
* Bad, because consolidation has scheduling semantics (every N minutes) that fit a daemon better than a hook-fired path. Re-architecting it means a real ADR-scale change.
* Bad, because reduces the daemon's reason-to-exist — at some point "scheduler-only daemon that never touches memory" raises the question whether the daemon should exist at all.

### Option C — WAL-mode RVF with reader/writer separation

* Good, because the right long-term answer for the multi-writer story (ADR-0167 Wave 2 may converge here).
* Good, because would also fix the N=8 contention problem ADR-0167 targets.
* Bad, because months of Rust runtime work; F-13-001 ships broken today and a release-blocker fix can't wait.
* Bad, because overlaps ADR-0167's scope; risks two parallel rewrites of the same primitive.
* Bad, because months of Rust runtime work. (Note: `.wal` is **already** a sanctioned `RVF_CANONICAL_EXTENSIONS` sibling — `memory-router.ts:261-267` — so the ADR-0154 "new sibling needs justification" objection is weaker than stated; the real cost is the runtime work + ADR-0167 overlap, not the file-format rule.)

### Option D — POSIX advisory MROW locks via `fcntl(F_SETLK)`

* Good, because retains current architecture; only the lock primitive changes.
* Good, because multiple readers genuinely concurrent without contention.
* Bad, because Windows lacks `F_SETLK` — translation to `LockFileEx` is non-trivial.
* Bad, because macOS APFS has historical bugs with advisory byte-range locks under certain mount options.
* Bad, because requires a Rust-side change to `WriterLock` (`forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs`) — overlaps ADR-0167's scope.
* Bad, because contention pattern still exists (the writer lock byte is still single-holder) — only the *reader* contention vanishes. Doesn't fix the daemon-vs-hook write race directly.

### Option E — Bridge through daemon IPC socket

* Good, because single writer eliminates lock contention entirely.
* Good, because hooks can be lock-blind — they just dispatch over the socket.
* Good, because the IPC server scaffolding (`DaemonIPCServer`) already exists in source — just needs `registerMethod` callers.
* Bad, because **reverses ADR-0088**. The audit's F-10-001 finding explicitly captured that this code path was killed deliberately. Reactivating it re-litigates the prior decision.
* Bad, because daemon crash kills memory writes for every hook in the system — single point of failure.
* Bad, because re-introduces a separate protocol surface (JSON-RPC over Unix socket) that needs versioning, schema validation, telemetry, error mapping, and security review.
* Bad, because hook handlers running outside the daemon's lifetime (before `daemon start`, after `daemon stop`, on Windows where the daemon may not exist) need a different code path anyway — making the IPC path conditional, which is exactly the dual-path complexity ADR-0088 removed.

## More Information

Related audit findings (all in `docs/audits/2026-05-19-soundness-audit/`):

* **F-13-001 [CRITICAL]** — primary motivating finding; this ADR is its direct response.
* **F-13-002 [CRITICAL]** — `hooks route` hangs indefinitely on lock-acquire. Separate fix needed (add timeout to route's memory-router call). Probable follow-up ADR.
* **F-13-009 [HIGH]** — already fixed on the CLI path (`index.ts:304` exits 1; `mcp-client.ts:177` re-throws; `hooks.ts` returns `exitCode:1`). The audit's `EXIT:0` was a measurement artifact ([[feedback-run-and-kill-exit-code]]); only a regression test is owed.
* **F-10-001 [CRITICAL]** — `DaemonIPCServer` has zero registered methods. Confirms Option E would require re-registering handlers and reversing ADR-0088. Bears on rejection of Option E.
* **F-10-009 [WARN]** — daemon stop SIGKILLs after 1s grace, may truncate router flush. Per-op release shrinks this risk because there's nothing to flush on stop (already released).

Related ADRs:

* **ADR-0088** — daemon scope alignment (scheduler-only, never hot path). This ADR PRESERVES that decision.
* **ADR-0167** — cross-process RVF write coordination, Rust-side rewrite (`f4cbbf45e`; the in-process coordinator `9781bc8f0` is self-tagged ADR-0168). This ADR is independent and forward-compatible.
* **ADR-0204 / ADR-0211 / ADR-0213** — ⚠️ **ordering hazard (dialectic):** these make `ensureRvfWired()` / archivist-init a precondition of *serving* MCP tools. They MUST NOT gate serving on `ensureRvfWired()` until THIS ADR's per-op release is live — otherwise the MCP-server's `ensureRvfWired()` (`memory-tools.ts:60`) deadlocks against the daemon's lifetime flock. 0202 sequences before them ([[project-adr0201-remediation-impl-order]]).
* **ADR-0181** — archivist runtime activation (Phase 1 projectRoot-only, FS-JSON substrate). The daemon's Archivist is FS-JSON only and does not hold the RVF lock; this ADR fixes a separate path (memory-router → `RvfBackend`).
* **ADR-0095** — RVF inter-process convergence, JS advisory `.jslock` story.
* **ADR-0086** — Layer-1 storage abstraction; `RvfBackend` lives here.
* **ADR-0084** — Phase 4 memory-router introduction.
* **ADR-0059** — original RVF native backend.

Memory references shaping the decision:

* `feedback-no-fallbacks` — surface failures loud; never mask `LockHeld` behind `bridgeFallback`.
* `project-rvf-primary` — RVF is the primary store; this ADR cannot push memory writes elsewhere.
* `feedback-trace-before-hypothesis` — root cause traced to memory-router's module-level `_storage` cache before proposing the fix.
* `feedback-best-effort-must-rethrow-fatals` — `LockHeld` after the retry budget is a fatal that must surface; not a best-effort outcome.

### Implementation

This is an implementation ADR — accepting it authorises the work directly. Work lands as direct commits on the fork `main` (per [[feedback-trunk-only-fork-development]] — no PRs, no long-lived branches).

**Files to change** (paths under `forks/ruflo/v3/@claude-flow/cli/src/` unless noted — ⚠️ **`storage-factory.ts` and `rvf-backend.ts` live in the separate `@claude-flow/memory/src/` package, NOT `cli/src/`** (dialectic correction); the lint script is in ruflo-patch):

| File | Change | Verified anchors |
|------|--------|------------------|
| `memory/memory-router.ts` (2,718 LOC, fork-maintained — ADR-0089 size exception) | Add a `_isPersistent` flag (default `true`). When `false`, the `finally` after each `routeMemoryOp`/`routeEmbeddingOp`/`routeLearningOp`/`loadEmbeddingModel` MUST **`await _storage.shutdown()`** — NOT merely `_storage = null`. ⚠️ **CORRECTED (swarm 2026-05-20):** nulling `_storage` does NOT release the flock. The native `RvfStore` stays alive in TWO caches — memory-router `_storage` AND `storage-factory.ts:34 backendCache` (path-keyed) — until GC, which on a long-lived daemon ≈ never. Only `RvfBackend.shutdown()` (`rvf-backend.ts:387` → `nativeDb.close()`) drops the Rust store/flock AND flips `initialized=false` so `createStorage` evicts the backendCache entry (`storage-factory.ts:111`) on the next call. So `await shutdown()` is doubly load-bearing. Wrap the finally-shutdown in its own try/catch that re-throws the *original* op error (`feedback-best-effort-must-rethrow-fatals`). | `_storage` 190; `_initialized` 191; `_doInit()` 857 (`_initialized=true` 919, `createStorage` 900); `shutdownRouter` 2620 (`_storage.shutdown()` 2624 + `_registryInstance.shutdown()` 2630); `resetRouter` 2646 (null-only — insufficient); **`@claude-flow/memory/src/storage-factory.ts:34`** backendCache, evict-on-closed 108-112; **`@claude-flow/memory/src/rvf-backend.ts:387`** `nativeDb.close()` (+ `:395` `initialized=false`). |
| `services/worker-daemon.ts` | Both daemon worker entry points release per-op via `await _storage.shutdown()` — **sufficient** (dialectic 2026-05-20): `_storage` and the registry's `this.backend` are the SAME cached `RvfBackend` (path-dedup `.db→.rvf`, `storage-factory.ts:97-104`; one flock, proven by the single-FD lsof), so `_storage.shutdown()` releases the one shared `memory.rvf` flock for BOTH workers. Robustness preference (not a blocker): the CONSOLIDATE worker built `_registryInstance` (via `routeLearningOp`→`ensureRegistry`), so per-tick release MAY use `shutdownRouter()` (`:2620`, also resets `_registryInstance` `:2630`) to avoid leaving the registry singleton pointing at the closed shared backend — but bare `_storage.shutdown()` only risks a stale pointer that fails LOUD / re-opens, not a leak. (The registry's *separate* `this.agentdb` — better-sqlite3 on `memory.db` + `agentdb.rvf` — does NOT hold the `memory.rvf` flock.) Optional tidy: `controller-registry.ts:751 shutdown()` never nulls `this.backend`. | `runConsolidateWorker` line 1484 (`routeEmbeddingOp`/`routeLearningOp` via dynamic import line 1501); `runPreloadWorkerLocal` line 1651 (`loadEmbeddingModel` line 1656). NOTE: the second worker is `runPreloadWorkerLocal`, not `runPreloadWorker`. Daemon `stop()` already calls `shutdownRouter()` (line 1058-1059). |
| `scripts/lint-no-daemon-lock-cache.mjs` (ruflo-patch, NEW) | Grep-rule: `worker-daemon.ts` must not hold a module-scoped `memory-router` backend across ticks. Wired into `npm run test:unit`. | per §Confirmation #3. |

**Preferred shape**: factor a `withRouter(async (router) => {...})` helper in `memory-router.ts` that acquires, runs the op, and releases in `finally` via **`await _storage.shutdown()`** (NOT `_storage = null`, which releases nothing). This is **sufficient for both workers** — `_storage` is the single shared `memory.rvf` flock-holder (`_storage === _registryInstance.backend` by path-dedup), so one `shutdown()` drops it. Robustness option (implementer's choice, both safe): the CONSOLIDATE worker may instead call `shutdownRouter()` per tick (also resets `_registryInstance`), trading a registry rebuild for no dangling pointer; bare `_storage.shutdown()` is cheaper and its worst case is a loud-failing / re-opening registry pointer, not a lock leak. CLI hook processes keep the persistent cache (short-lived; process exit kernel-auto-releases the native flock — the ADR-0094 `process.on('exit')` handler only unlinks the JS `.jslock`, not the native `.lock`). Migration risk: a missed worker callsite leaves the cache alive — caught by the lint rule.

**Per-tick caching**: if a single worker tick fires multiple memory ops, `withRouter` may hold the backend across that tick and release on tick exit (`finally`). Bounds the cold-start cost while keeping the lifetime bounded to one tick.

**Telemetry**: add a counter for `LockHeld` retries that exceed a fraction of the retry budget — observable signal for "real contention occurring, consider scheduling adjustment."

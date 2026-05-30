---
status: accepted
date: 2026-05-20
tags: [daemon, ipc, rpc, dead-code]
supersedes: []
depends-on: [ADR-0201, ADR-0202]
implements: []
---

# Remove DaemonIPCServer; fix daemon control findings without a socket

> **Decision reversed after a 6-expert adversarial review (2026-05-20).** The
> original draft chose Option B (register five RPC methods on the Unix socket).
> A swarm review — IPC architect, code archaeologist, upstream analyst, Node
> IPC/security expert, devil's advocate, queen — found Option B's headline
> driver already closed by ADR-0202, its "data plane" premise false, and the
> whole `DaemonIPCServer` layer to be a fork-only invention upstream
> deliberately declined to build. The decision is now **Option C (remove)**.
> Section [Swarm review evidence](#swarm-review-evidence-2026-05-20) records the
> findings that drove the reversal.
>
> **Second-pass validation (2026-05-20):** a focused re-review confirmed
> Option C is **complete + feasible** (deletion has no consumer breakage — no
> code reads the `.ipc` status field; the restart-race claim is verified true;
> `daemon-state.json` already exists so the `aiMode` fix is additive; 0207↔0218
> are non-conflicting). It added three implementation-completeness corrections,
> folded into "Concrete shape" + Confirmation below: (1) the deletion list also
> covers the `DaemonStatus.ipc?` type field (`worker-daemon.ts:84`) and the
> `ipc:` field in `getStatus()` (`:1083-1085`); (2) the `aiMode` state-file read
> must be **gated on PID liveness** (`bgRunning`) — fall back to the live probe
> when the daemon is dead, so `status` never reports a stale daemon's `aiMode`;
> (3) the `uptimeSec`/`lastTick` refresh wires to the daemon's only recurring
> interval, `queuePollTimer` (`worker-daemon.ts:896`, 5s).

## Context and Problem Statement

`WorkerDaemon.start()` (`forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:868-883`) instantiates `DaemonIPCServer`, calls `start()` which binds `.claude-flow/daemon.sock` with mode 0600, and logs "IPC server listening on …". The class itself is fully implemented — `registerMethod(method, handler)`, JSON-RPC 2.0 framing, per-connection buffer handling, and the parse-error / invalid-request / method-not-found / internal-error response paths are all in place (`daemon-ipc.ts:67-204`).

What does not exist anywhere in the fork tree is **a single `registerMethod()` call site**. ADR-0201's static slice F-10-001 ran `grep -rn "registerMethod" forks/ruflo/v3 --include="*.ts"` and found zero callers outside the class definition. There are also **zero socket clients**: nothing in the CLI connects to `.claude-flow/daemon.sock` (the only `createConnection` in the fork is a TCP health-probe in `system-tools.ts`, unrelated). ADR-0088 removed the only previous client (the Phase-4 memory-write client) and left a comment that the server "remains for future non-memory RPC methods" — but no such method was ever wired. The result: the server starts cleanly, logs success, holds the socket fd, unlinks it on stop, and answers `-32601` ("Method not found") to any hypothetical caller. From the operator's vantage the IPC layer looks healthy; from the protocol's vantage it is fully dead.

### Why the original "wire it" framing does not hold

The first draft of this ADR treated the dead socket as infrastructure to *complete* (register five control methods so the "IPC server listening" log becomes honest, and so a future `memory.write` method could route hook writes through the daemon as a single writer, fixing the F-13-001 RVF-lock regression). The 6-expert review dismantled every load-bearing assumption of that framing:

1. **The F-13-001 driver is already closed — without a socket.** [ADR-0202](./ADR-0202-daemon-rvf-lock-break-lifetime-hold.md) (accepted 2026-05-20) fixes the daemon-holds-RVF-lock regression via **per-op lock acquire/release** in `memory-router.ts`, and *explicitly rejected* the daemon-IPC bridge (its Option E) for "reversing ADR-0088 … single point of failure." So the socket is not the unblock path for F-13-001; ADR-0202 is. (ADR-0202 is now **implemented** (2026-05-21, the day after this ADR's draft) — the per-op acquire/release shipped **socket-free**, which *vindicates* this hand-off; F-13-001's owner is ADR-0202, not this ADR.)

2. **The "data plane" the socket was said to be redundant against is itself dead.** The file-poll dispatch queue (`worker-daemon.ts:893-1021`, `processDispatchQueue`) polls `.claude-flow/daemon-queue/<id>.json`, but **no producer in the fork writes those files** — `hooks_worker-dispatch` only mutates an in-process `activeWorkers` Map in the MCP-server process and returns `status:"queued"`. So today *both* cross-process channels are non-functional; there is no working data plane, no working control plane. (This is a new finding beyond ADR-0201's F-10-011; recorded for follow-up — see [What this ADR does NOT decide](#what-this-adr-does-not-decide).)

3. **The whole layer is a fork-only invention upstream declined to build.** `DaemonIPCServer` / `daemon-ipc.ts` / the Unix socket has **never existed in upstream `ruvnet/ruflo`** (formerly `ruvnet/claude-flow`) at any commit. When upstream faced the exact problems this ADR wrestles with, it chose the opposite of a daemon broker: a **file-poll queue** for cross-process dispatch (issue #1845, commit `1884ed1010`) and **in-process concurrency-safe RVF** for the multi-writer/data-loss problem (issue #1614, `rvf-backend.ts` write-queue serialization + atomic temp-rename). Upstream's daemon control plane is PID-file + signals with seven subcommands and **none** of the five methods Option B proposed. The "ADR-0059 Phase 4: hooks delegate memory writes to the daemon (single writer)" contract in the file header (`daemon-ipc.ts:1-8`) — flagged as a lie by F-10-002 — corresponds to no upstream architecture; upstream's intent is direct concurrent writes, the *opposite* of a single-writer daemon.

4. **Of Option B's five methods, four were net-new subsystems, not "calls into existing internals."** Only `daemon.status` has a real backing (`getStatus()`); `daemon.restart` is mis-located (an in-daemon RPC that must spawn-and-confirm-a-successor before exiting, inheriting the F-10-007 race); `daemon.drain` had no entry point and no spec; `daemon.reload` is vapor (no config-reload code path exists — it would return `{acknowledged:true}` while reloading nothing, *re-introducing* the very no-fallbacks violation it was meant to cure); `daemon.services-list` reports the phantom queue from point 2.

### The honesty problem, restated

Two ADR-0201 findings make this an active soundness problem, not cosmetics:

* **F-10-001 [CRITICAL]** — a server that returns `-32601` for every call is a silent dead surface that *looks* alive. Per [[feedback-no-fallbacks]], the cheapest honest state is "it is not there," not "it answers five new control verbs."
* **F-10-002 [CRITICAL]** — the file header advertises a Phase-4 memory contract that ADR-0088 removed and that never existed upstream.

Both close **by deletion**. Three further findings — F-10-004 (no `daemon restart`), F-10-006 (`aiMode` mismatch), and F-13-001 (RVF lock) — are real but are each fixable **without** the socket, as the review established.

The audit's recommendation #1 framed this as a binary: "(a) delete `DaemonIPCServer` and the socket-lifecycle code entirely … or (b) actually wire at least one method so the abstraction earns its keep. Pick one." This ADR picks **(a)**.

## Decision Drivers

* **No [[feedback-no-fallbacks]] violations** — a server that always returns `-32601` is the textbook silent dead surface. Deletion is the unambiguous fix; wiring is the conditional fix (and Option B's `daemon.reload` would have re-offended).
* **No speculative scope** — per [[feedback-corpus-evidence-before-feature-work]]. The five proposed methods had **zero callers** and four had no backing implementation. Build channels for consumers that exist, not for hypothetical ones.
* **Match the codebase's actual trajectory** — upstream ADR-050 (intelligence-loop — file-based hot path, no daemon) → ADR-0088 (delete the IPC client + handlers) → upstream #1845 (file-poll, not socket) → upstream #1614 (in-process concurrent RVF) → ADR-0202 (per-op lock, socket rejected). Every adjacent decision moved *away* from daemon-mediated I/O. Wiring the socket is the only node that pushes the other way.
* **Upstream divergence must be justified on its own terms** — keeping a fork-only IPC layer means we alone carry, test, and keep it honest, duplicating a channel upstream consciously chose *instead of*. Absent a fork-specific product need, the divergence is unjustified.
* **F-13-001 is owned by ADR-0202, not this ADR** — the RVF-lock fix is a per-op lock release with no socket. This ADR must not couple to it; doing so would justify a socket build on a regression already addressed elsewhere.
* **Cross-platform control without socket *or* signals** — daemon control (`status`, `restart`, `stop`) is fully serviceable via the PID file + `daemon-state.json` + CLI-side orchestration, all of which work identically on POSIX and Windows. This removes both the socket's portability burden (the literal `.sock` path does not bind as a Windows named pipe anyway) and the signal-based variant's POSIX-only limitation.
* **Deletion removes a live risk surface** — registering handlers would turn the currently-unreachable socket into a live, **unbounded-parse-buffer** input (`daemon-ipc.ts:147-156` buffers without a cap and `JSON.parse`s synchronously). Deleting the server removes that DoS surface entirely.
* **Cost asymmetry** — removal deletes the ~210-line `daemon-ipc.ts` (≈160 of which is the server class) plus ~30 lines of call-site/type edits in `worker-daemon.ts`, and adds **no** new maintained surface; Option B was ~150 *new* lines + a resurrected CLI client + the RPC lifetime contract (ack/timeout/error-envelope) + buffer hardening + a Windows pipe-path branch, all of which the fork would then own forever. The cheaper side — measured by *ongoing surface*, not raw line count — is also the honest side.
* **ADR-0088 precedent** — ADR-0088 deleted the client for having zero callers and contradicting upstream ADR-050 (intelligence-loop). The same logic applies to the server by direct extension; ADR-0202 (now implemented) re-affirmed ADR-0088's scheduler-only scope as load-bearing.

## Considered Options

* **Option A — Register handlers that proxy to MCP tools (daemon as auxiliary MCP gateway).** Mirror the 200+ MCP tool registry over the socket. Creates a second transport + a second auth boundary that must stay in sync. Wide surface, high cost.

* **Option B — Register five daemon-control methods (`status`, `restart`, `services-list`, `drain`, `reload`).** The original choice. Rejected after review: four of five methods have no backing implementation and zero callers; the F-13-001 driver is closed by ADR-0202; `reload` re-introduces a no-fallbacks violation; the socket adds an unbounded-buffer DoS surface; the Windows portability advantage is unrealized in the current code.

* **Option C — Remove `DaemonIPCServer` entirely; fix the real findings socket-free and signal-free.** Delete the server class, the socket-lifecycle wiring, and the misleading file header (closes F-10-001 + F-10-002 by construction). Fix F-10-004 with a CLI-side `restart` (stop + start), and F-10-006 by having the daemon persist `aiMode`/`uptimeSec`/`lastTick` into `daemon-state.json` for `daemon status` to read. No Unix socket, no POSIX signals for control — PID file + state file + CLI orchestration, cross-platform. F-13-001 stays with ADR-0202. **Chosen.**

* **Option D — Hybrid: minimal RPC over the socket + signal-based control.** Keeps the socket and adds signals; combines the costs of both. Rejected with B.

* **Option E — Wire one method only (`daemon.status`) as a probe.** The Systems-Soundness expert's fallback: it is the one method with a real structured-return need (the background-daemon `aiMode` mismatch). Rejected in favour of C because the same need is met by the **state file** — `daemon-state.json` is already the cross-process state carrier and can hold `aiMode`/`uptimeSec`/`lastTick` without keeping a socket (and its DoS/Windows-path costs) alive for a single read.

## Decision Outcome

**Chosen: Option C — remove `DaemonIPCServer`; fix F-10-004 and F-10-006 without a socket; hand F-13-001 to ADR-0202.**

Rationale (the review's convergent findings):

* **The only driver that justified keeping the server is gone.** Option B's marquee benefit — "unblocks the F-13-001 fix" — was decided against by name in ADR-0202, which fixes the regression with a per-op lock release and no socket. Strip F-13-001 away and Option B reduced to "bundle four net-new features onto a socket to make a log line honest" — and deletion makes the log line honest too, with no new surface to maintain.

* **Upstream is the decider.** The IPC layer is fork-only and upstream, facing the identical problems, chose files and in-process concurrency over a daemon broker (#1845, #1614). Keeping the socket is a pure fork divergence with no upstream basis and a stated justification (single-writer brokering) upstream actively rejected.

* **Deletion is the strongest no-fallbacks posture.** You cannot have a silent dead surface in code you removed. Option B's `daemon.reload` would have shipped a new "looks-like-it-works, does-nothing" handler; Option C eliminates the class of problem.

* **The findings the socket was meant to fix are fixable without it.** F-10-001/002 close by deletion. F-10-004 (`restart`) is a CLI-side stop+start (the CLI knows `oldPid` from the PID file and `newPid` from the spawned child) — avoiding the in-daemon self-restart that worsens the F-10-007 race. F-10-006 (`aiMode`) is fixed by persisting the daemon's boot-time `aiMode` (plus `uptimeSec`/`lastTick`) into `daemon-state.json`, which `daemon status` reads instead of re-running `which claude` in the CLI process. All cross-platform.

* **Portability favours C, not B.** The socket's "works on Windows" claim is false as coded (a literal `.sock` path is not a Windows named pipe). C's PID-file + state-file + CLI approach uses no socket and no POSIX signals, so it works identically on both platforms.

### Concrete shape of the change

1. **Delete** `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts` in full (the `DaemonIPCServer` class, socket lifecycle, and the stale ADR-0059 header at lines 1-8 incl. the `Fallback:` line). In `worker-daemon.ts`, remove: the `ipcServer` field and its preceding ADR-0088 comment; the **IPC construction block** (`new DaemonIPCServer(...)` + `await this.ipcServer.start()`), which **includes the adjacent comment whose body contains a literal `registerMethod()` token** the Confirmation #1 grep would otherwise still match; the `await this.ipcServer.stop()` call; the socket import; and the "IPC server listening" log line. Also remove the `DaemonStatus.ipc?` interface field and the `ipc:` object inside `getStatus()`.

   > **Anchor by content, not by line number.** The 2026-05-20 line citations have drifted ~10-13 lines — ADR-0202's per-op-lock code (implemented 2026-05-21) landed in this same region. At fork HEAD `70104c069` the IPC block is ~`worker-daemon.ts:878-893`, the `registerMethod` comment ~`:881`, `stop()` ~`:1053-1057`, `getStatus().ipc` ~`:1096-1098` (and the socket import `:25`, `DaemonStatus.ipc?` `:84`, `daemon-state.json` write `:207`, `ipcServer` field/comment `:158-159` are still exact) — **but grep for the symbols rather than trusting these numbers.** Critically, the old `:868-884` span now overlaps ADR-0202's `setRouterPersistent(...)` block (~`:868-876`); **do NOT delete that block** — it is unrelated, freshly-landed ADR-0202 code.

   No consumer reads `.ipc` (every `getStatus()` caller — `daemon.ts:129`, `daemon.ts:585`, `hooks-tools.ts:1984`, `headless.ts:333` — reads only `running`/`pid`/`startedAt`/`config`/`workers`), so removal is consumer-safe. → **closes F-10-001, F-10-002.**

2. **F-10-004 — `daemon restart`:** add a CLI subcommand on `daemonCommand.subcommands` that performs `stop` (existing) then `startBackgroundDaemon()` (existing) with a configurable grace window, printing `oldPid` (from the PID file) and `newPid` (from the spawned child). CLI-side only; no in-daemon RPC; does not worsen the F-10-007 spawn race.

3. **F-10-006 — `aiMode` mismatch:** the daemon writes its boot-resolved `aiMode` (and `uptimeSec`/`lastTick`) into `daemon-state.json`. `daemon-state.json` already exists (`worker-daemon.ts:207`, atomic write via `saveState()` `:1706`) — the fix is additive (three new fields), not new infra. **`uptimeSec`/`lastTick` refresh wires to the daemon's only recurring interval, `queuePollTimer` (`worker-daemon.ts:896`, 5s)** (not an unspecified "existing tick"). `daemon status` reads `aiMode` from the state file **only when the daemon is live** — gate on `bgRunning = isProcessRunning(bgPid)` (`daemon.ts:589`); when the PID is dead/stale, fall through to the live `which claude` probe so a dead daemon's stale state-file `aiMode` is never reported (the daemon does not unlink the state file on crash; `savedAt` `:1725` is available for a secondary freshness check). Retire — don't silently invert — the existing "intentional re-probe reflects current PATH" rationale at `daemon.ts:605-606`: the daemon's boot-time `aiMode` is authoritative because the daemon (not the CLI's PATH) determines worker capability. The reported `aiMode` is the daemon's, not the CLI's. This state-file/`bgRunning` path applies to the **background-daemon branch only** — the foreground/in-process daemon already reads `aiMode` from the live singleton (`daemon.ts:606-608`) and needs no state-file read.

4. **Keep the file-poll dispatch queue** as the single (intended) cross-process channel — but its producer gap (see below) is owned by **ADR-0218** (proposed; depends-on 0207).

### What this ADR does NOT decide

* **F-13-001 (RVF LockHeld on hooks)** — owned by [ADR-0202](./ADR-0202-daemon-rvf-lock-break-lifetime-hold.md) (per-op lock release, socket-free). ADR-0202 is now **implemented** (2026-05-21); the per-op fix shipped without a socket, so this hand-off is proven clean — deleting `DaemonIPCServer` strands nothing.
* **Dispatch-queue producer gap (NEW finding)** — `hooks_worker-dispatch` mutates an in-process `activeWorkers` Map and never writes `.claude-flow/daemon-queue/<id>.json`, so the daemon's `processDispatchQueue` consumer polls a directory nothing writes to. The cross-process dispatch path is broken end-to-end at the producer. This is beyond ADR-0201's F-10-011 framing (which assumed the queue worked) and beyond this ADR's deletion scope; it is owned by **ADR-0218** (proposed; depends-on 0207 — after the socket is removed the file-poll queue is the sole worker-dispatch channel, so 0218 restores its missing producer).
* **F-10-005 (SIGHUP handler collision)** — `worker-daemon.ts:473` maps SIGHUP→shutdown while `daemon.ts:121` maps SIGHUP→ignore; live today. Option C adds no signal-based control so it does not worsen this; separate ADR.
* **F-10-011 (file-poll queue retention)** — `.processed/` rotation; out of scope.
* **F-10-003 (`process daemon` stub)** — delete-vs-alias; separate decision.

### Confirmation

This decision is confirmed when:

1. **`grep -rn "DaemonIPCServer\|daemon-ipc\|registerMethod" forks/ruflo/v3 --include="*.ts" --exclude-dir=dist` returns zero matches** (replicating and reversing the F-10-001 evidence-gathering grep). The `--exclude-dir=dist` is required: the gitignored `cli/dist/.../daemon-ipc.d.ts` build artifact matches the pattern and clears only after a clean rebuild (Confirmation #5), so run this gate against `src/` or post-rebuild. Also: `daemon-ipc.ts` is deleted; `WorkerDaemon` no longer references the server; the daemon log no longer emits "IPC server listening"; `lsof` against a running daemon shows no `.claude-flow/daemon.sock` fd.

2. **`daemon restart` exists as a subcommand** and behaves as documented (CLI-side stop + start, prints old/new PID). Fixes F-10-004. An integration test spawns a daemon, runs `daemon restart`, and asserts a new live PID distinct from the old.

3. **`daemon status` reports the daemon's `aiMode`, not the CLI's**, read from `daemon-state.json` when the daemon is **live** (`bgRunning`) — no `which claude` shell-out on the running-daemon path. Test: start a daemon with a known `aiMode`, run `daemon status` from a process with a different PATH, assert the daemon's value is reported. **Staleness criterion (2nd-pass): with a stale `daemon-state.json` left by a dead daemon (PID not alive), `status` must NOT report the stale `aiMode` — it falls through to the live probe.** Fixes F-10-006.

4. **`daemon-state.json` carries `aiMode`, `uptimeSec`, `lastTick`** and is refreshed on the daemon's tick (freshness asserted across two reads spanning a tick interval).

5. **`npm run release` passes** with `daemon-ipc.ts` removed and the new tests included; single-install daemon behaviour (timer-scheduled workers — consolidate/preload, which are in-process self-scheduled and need no cross-process input) is unchanged. **Sequencing:** after this deletion the file-poll queue is the *sole* cross-process worker-dispatch channel, and it stays non-functional until ADR-0218 restores its producer. This is not a regression (the socket was equally dead — no client, no handlers; Option B never proposed a dispatch *producer* either), but 0207 should land in the **same release cycle as ADR-0218**, or this dead-channel window ships knowingly. Single-install (timer-scheduled) work is unaffected.

6. **The ADR-0201 audit findings are annotated** in `docs/audits/2026-05-19-soundness-audit/10-daemon.md`: F-10-001 + F-10-002 resolved-by-deletion; F-10-004 + F-10-006 resolved socket-free; F-13-001 reassigned to ADR-0202; the dispatch-queue producer gap recorded as a new finding for follow-up.

### Consequences

* Good, because F-10-001 (zero handlers / CRITICAL) and F-10-002 (header lie / CRITICAL) close by construction.
* Good, because F-10-004 (no `daemon restart` / CRITICAL) and F-10-006 (`aiMode` mismatch / WARN) close without a socket.
* Good, because the daemon stops carrying a fork-only IPC layer that upstream declined to build — reduced divergence, less to keep honest at each sync.
* Good, because the unbounded-parse-buffer DoS surface (latent the moment any handler is registered) is removed, not merely deferred.
* Good, because no new fragile surface is added: no resurrected client, no in-daemon `restart` race, no vapor `reload`, no second auth/rate-limit boundary.
* Good, because it aligns the fork with upstream's direction (file-queue + in-process concurrent RVF) and with upstream ADR-050 (intelligence-loop) / ADR-0088 / ADR-0202.
* Bad, because it loses the *option* of a structured daemon control RPC. If a future fork-specific need for request/response daemon control emerges (e.g. a real `drain` consumer that must block on a structured ack), it must be re-introduced deliberately and justified on fork grounds — not resurrected from the deleted file (which had no Windows-correct path and an unbounded buffer anyway).
* Bad, because `daemon status`/`restart` gain new (small) state-file and CLI-orchestration code paths that need their own tests.
* Neutral, because it does not by itself fix the dispatch-queue producer gap or F-13-001 — both are handed to dedicated work (the queue gap to ADR-0218, F-13-001 to ADR-0202, implemented 2026-05-21). The deletion neither worsens nor resolves them; until ADR-0218 lands a producer, cross-process dispatch stays non-functional (the socket was equally dead).
* Neutral, because cross-platform behaviour is identical: PID-file + state-file + CLI orchestration work the same on POSIX and Windows; no platform-specific control code.
* Neutral, because the daemon's primary function (timer-scheduled background workers) is unaffected — those workers self-schedule in-process and never used the socket.
* Neutral, because the operator-facing `daemon status` output shape is unchanged except that `aiMode` is now correct on the running-daemon path.

## Swarm review evidence (2026-05-20)

Six-expert adversarial review; all citations verified against fork HEAD `3359a6aae`, upstream `ruvnet/ruflo` HEAD `ef73a1616`, and the ADR-0201 audit files.

* **Code Archaeologist** — lineage: the IPC server + 5 `memory.*` handlers + a hook-side probe all landed in one commit (`9581c4a64`, 2026-04-04, "ADR-0059 Phase 3+4") to make the daemon a single-writer memory broker; ADR-0088 (`c3ad3ebc9`, 2026-04-15) deleted the client + handlers as "never adopted, zero callers, contradicting ADR-050," keeping the empty server "for future methods" that never came; upstream answered the cross-process question with a file-poll (#1845, `1884ed1010`, hand-ported into the fork as `a8ede7ef1`), not the socket. The scaffold is a reverted migration left standing. Verdict: C.
* **IPC Architect** — only `daemon.status` has a real backing internal; `restart`/`drain`/`reload` are net-new, `services-list` reports a phantom queue. **New finding:** the dispatch-queue producer is broken (`hooks_worker-dispatch` sets an in-process Map, never writes `daemon-queue/*.json`). ADR-0202 is accepted but unimplemented; F-13-001 still live but socket-free. Verdict: C (or E minimum).
* **Upstream Analyst** — `DaemonIPCServer` is fork-only, zero upstream history. Upstream chose the file-queue (#1845, `1884ed1010`) and in-process concurrency-safe RVF (#1614) over a daemon broker; daemon control is PID-file + signals with none of the five methods; the "Phase-4 single-writer" header has no upstream basis (#984 status-mismatch left open rather than IPC-fixed). Verdict: C.
* **Systems Soundness (Node IPC/lifecycle/security)** — the Windows portability claim is false as coded (literal `.sock` path ≠ named pipe); the 0600/no-auth model is POSIX-only and omits an unbounded-buffer DoS + bind TOCTOU; `reload` is vapor (no config-reload code path); `restart` is mis-located. The one real win (`daemon.status` for F-10-006) is better served by the state file. Verdict: reduced-B/E or C.
* **Devil's Advocate** — Option B is sunk-cost reasoning over speculative surface; `daemon status` already resolves state via PID-file + `process.kill(pid,0)`; the F-10-006 fix is `aiMode`→`daemon-state.json`; the minimal-C variant uses no signals, so the anti-C portability objection dissolves. Verdict: C.
* **Queen** — synthesis: 5/5 against Option B as written; the state-file resolves the lone F-10-006 tension; C is more portable than B as coded; F-13-001 belongs to ADR-0202. Decision: **Option C.**

### Second council re-validation (2026-05-22)

A fresh 6-expert council (code-verification archaeologist, upstream-intent analyst, ADR-corpus analyst, MADR-template auditor, implementation-feasibility expert, devil's advocate; queen synthesis) independently re-verified this ADR against fork HEAD `70104c069`, upstream `ef73a1616` (11,167 commits), the sibling ADRs, and the audit files. **Outcome: Option C re-affirmed (6/6).** Every load-bearing premise held — zero `registerMethod` callers, zero socket clients, no `.ipc` consumer (deletion consumer-safe, HIGH confidence), no `daemon-queue` producer, and `DaemonIPCServer` categorically absent from upstream (pickaxe = 0). Corrections folded into this revision:

* **Re-anchored the deletion to content, not line numbers** — the 05-20 citations drifted ~10-13 lines because ADR-0202's per-op-lock code landed in the same region on 05-21; the literal `:868-884`/`:871` span now overlaps ADR-0202 code that must NOT be deleted (see Concrete shape #1).
* **Confirmation #1 grep** corrected with `--exclude-dir=dist` (it otherwise matches the gitignored `daemon-ipc.d.ts`).
* **ADR-0202 status** refreshed to *implemented* (2026-05-21) — the F-13-001 hand-off is now proven clean (the per-op fix shipped socket-free).
* **Upstream citations softened** — #1766 is `child_process.fork()` IPC, not a `.sock` (not socket-binding evidence); #1614 shipped a write-queue (not a lock-reread); #1845 is a batch commit (#1839–#1847).
* **"ADR-050" disambiguated** as the *upstream* intelligence-loop ADR (`v3/implementation/adrs/ADR-050-intelligence-loop.md`), distinct from the fork-local `0050-fail-loud-…` defect catalog. (The same stale reference also lives in the `daemon-ipc.ts` header being deleted — it disappears with the file.)
* **Sequencing made explicit** — 0207 should land with ADR-0218 (Confirmation #5), else the sole cross-process dispatch channel ships dead.
* **Cost claim corrected** — deletion removes a ~210-line file (not "~50 lines"); the asymmetry is in *ongoing surface*, not raw line count.

Standing recommendations (outside this ADR): the audit's F-13-001 severity is internally inconsistent (header CRITICAL vs Impact HIGH) — reconcile in the audit; the `adr-create` template should bless `## Swarm review evidence` as a sanctioned optional extension (15 cohort ADRs already use it); flip `status: proposed → accepted` at the 0202–0218 batch ratification, not in isolation.

## Pros and Cons of the Options

### Option A — daemon as auxiliary MCP gateway

* Good, because one socket reaches the whole tool registry.
* Bad, because a second transport + second auth boundary must stay in sync; widest surface, highest cost, zero current callers.

### Option B — register five daemon-control methods

* Good, because it makes the "IPC server listening" log honest; `daemon.status` has a real backing.
* Bad, because four of five methods are net-new with zero callers; `reload` re-introduces a no-fallbacks "looks-like-it-works" stub; it resurrects a CLI socket client + the RPC lifetime contract; it adds an unbounded-buffer DoS surface; the Windows `.sock` path does not bind.

### Option C — remove `DaemonIPCServer`; fix findings socket-free (chosen)

* Good, because it is the strongest no-fallbacks posture (no surface left to lie); closes F-10-001/002 by construction; fixes F-10-004/006 cross-platform via PID-file + `daemon-state.json` + CLI orchestration; lower ongoing cost than B (a dead file deleted vs. new RPC surface owned forever); removes the DoS surface; convergent with upstream (files + in-process, not a broker).
* Bad, because it removes a (currently dead) extensibility point — a future real cross-process control need would have to be rebuilt (acceptably, on evidence).

### Option D — minimal RPC + signals

* Good, because nothing over C.
* Bad, because it combines the socket's and signals' costs and is POSIX-only for signal control.

### Option E — wire `daemon.status` only

* Good, because it is the smallest wiring and the one method with a real structured-return need.
* Bad, because that need is met by `daemon-state.json` without keeping a socket (and its DoS/Windows-path costs) alive for a single read.

## More Information

Lifecycle dates from the original record: accepted 2026-05-20, implemented 2026-05-21. This ADR was swarm-reviewed and is a follow-up that also bears on ADR-0088 and ADR-0059.

* ADR-0201 §F-10-001 (CRITICAL) — `docs/audits/2026-05-19-soundness-audit/10-daemon.md` — zero handlers
* ADR-0201 §F-10-002 (CRITICAL) — file header advertises a removed/never-upstream contract
* ADR-0201 §F-10-004 (CRITICAL) — no `daemon restart` subcommand
* ADR-0201 §F-10-006 (WARN) — `aiMode` probe in `daemon status` disagrees with the daemon
* ADR-0201 §F-10-011 (WARN) — file-poll dispatch queue (superseded by the new producer-gap finding: the queue's producer does not write)
* ADR-0201 §F-13-001 (CRITICAL — the audit's Impact line reads HIGH; this ADR follows the finding-header severity, consistent with ADR-0202) — `docs/audits/2026-05-19-soundness-audit/13-runtime-hooks-and-daemon.md` — daemon holds RVF lock; owned by ADR-0202
* [ADR-0202](./ADR-0202-daemon-rvf-lock-break-lifetime-hold.md) — F-13-001 fix via per-op lock release; rejected the daemon-IPC bridge (its Option E); this ADR depends on it owning F-13-001
* ADR-0088 — removal of the Phase-4 memory-write client (the precedent this deletion extends to the server)
* ADR-0059 — fork-local Phase-4 hooks-via-daemon contract (the header lie this deletion retires); no upstream equivalent
* Upstream ADR-050 (intelligence-loop, `v3/implementation/adrs/ADR-050-intelligence-loop.md`) / ADR-0086 — file-based memory hot path; ADR-0088 + ADR-0202 cite it as the reason to keep the daemon out of memory I/O. (Distinct from the fork-local `docs/adr/0050-fail-loud-…` defect catalog, which is unrelated.)
* Upstream evidence: `ruvnet/ruflo` issues #1845 (the batch — titled #1839–#1847 — that chose a file-poll queue over IPC; the #1845-specificity lives in code comments), #1614 (multi-writer data-loss fixed **in-process** via RVF write-queue serialization + atomic temp-rename in `8824fe3c4`, *not* a lock-reread), #984 (status mismatch left **open**), #1766 (Windows `child_process.fork()` IPC fragility — a parent↔child channel, **not** a Unix `.sock`; corroborates the portability *direction* but is not evidence about socket binding); commit `1884ed1010`
* Source (to delete): `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts`
* Source (to edit): `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` (construction site `868-883`; file-poll queue `893-1021`), `forks/ruflo/v3/@claude-flow/cli/src/commands/daemon.ts` (status `aiMode` shell-out; new `restart` subcommand)

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. REMOVE landed in fork (`forks/ruflo/v3`).

Verification (2026-05-23 audit, fork HEAD):

- `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts` — **deleted**.
- `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` — zero references to `DaemonIPCServer | daemon-ipc | registerMethod | ipcServer` (grep clean).
- Arch enforcement: `forks/ruflo/v3/@claude-flow/cli/__tests__/arch/daemon-ipc-server-removed.arch.test.ts:59` forbids the three tokens in `cli/src`.
- Acceptance: `e2e-0059-p4-socket-exists` (`lib/acceptance-adr0059-phase4-checks.sh:20`) inverted by `f295135` (2026-05-23) — socket present now signals a regression; daemon liveness signal switched to PID file by `fdcba38` (2026-05-23).
- Upstream parity: zero history for `DaemonIPCServer` in `ruvnet/ruflo` (pickaxe + path log empty) — REMOVE converges with upstream; no INTEGRATION-LEDGER row needed.

F-13-001 hand-off to ADR-0202 (implemented) confirmed clean — no socket consumer stranded. Dispatch-queue producer gap is owned by ADR-0218.
* Memory references: [[feedback-no-fallbacks]] (a -32601-for-everything server is the textbook silent dead surface; deletion is the cleanest fix), [[feedback-corpus-evidence-before-feature-work]] (zero callers for the five methods — do not build for hypothetical consumers), [[feedback-trace-before-hypothesis]] (the review traced each handler + the queue producer end-to-end before deciding), [[feedback-upstream-means-upstream]] (upstream = `ruvnet/ruflo`, which never had this layer)

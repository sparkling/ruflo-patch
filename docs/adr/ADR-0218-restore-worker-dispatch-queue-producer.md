---
status: accepted
completed: true
date: 2026-05-20
implemented-date: 2026-05-23
tags: [daemon, ipc, hooks, dispatch-queue, fork-regression, upstream-sync, no-fallbacks, ADR-0207, follow-up, swarm-reviewed]
supersedes: []
depends-on: [0207]
implements: []
---

# Restore the worker-dispatch daemon-queue producer (fork never integrated upstream #1845's producer half)

> **Validated by a 6-expert swarm review (2026-05-20) — Option A confirmed, corrections applied.**
> Unlike its batch siblings (0215/0216/0217, all reframed), ADR-0218
> **survives review largely intact**: the premise is verified true on disk,
> upstream actively maintains the exact fix, the consumer is already
> cherry-picked and byte-identical, the payload contract is exact, and the
> change closes a genuine [[feedback-no-fallbacks]] lie a real upstream user
> reported (#1845). This is the *good* re-convergence case
> ([[feedback-remediation-adr-preflight]] #2: re-converge with upstream),
> the same shape as ADR-0214. The swarm applied these corrections:
> (1) the port must use the fork's `findProjectRoot()`, **not** upstream's
> deprecated `getProjectCwd()` (ADR-0100) — "mirror upstream" was a trap;
> (2) the change **adds one status state (`mcp-only`)** and keeps the
> existing `synthetic-completed` — the original draft's status-ladder prose
> was imprecise; (3) Confirmation test #1 was un-passable as written
> (`hooks_worker-status` reads only the in-process Map in *both* trees) and
> is reframed to the queue-file lifecycle; (4) the framing "regressed below
> upstream" is corrected to "never integrated #1845's producer"; (5) the
> "sole cross-process channel" claim is narrowed to "sole *worker-dispatch*
> channel"; (6) the existing INTEGRATION-LEDGER row is misleading and must
> be superseded, not just appended.
>
> **Second-pass re-validation (2026-05-20).** Decisive facts re-confirmed at fork
> HEAD: the consumer reads `.claude-flow/daemon-queue/<id>.json` (`worker-daemon.ts:977`);
> the producer gap is real — `grep -c daemon-queue` in `hooks-tools.ts` = **0** (nothing
> writes the queue); `activeWorkers.set` at `:3706`; consumer lineage = `a8ede7ef1`
> ("batch resolve issue-fix loop #1839-#1847", which includes #1845). Correction (1)
> further confirmed: `findProjectRoot` is **already** imported (`hooks-tools.ts:29`) and
> the dispatch handler already calls it (`:3672`) — so the producer port has the correct
> root helper in scope; `getProjectCwd()` would be the regression. Option A holds.

## Context and Problem Statement

The `hooks_worker-dispatch` MCP tool hands a worker to the background daemon
for cross-process execution. The daemon **consumer** is wired:
`WorkerDaemon.processDispatchQueue`
(`forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:975-1021`)
polls `.claude-flow/daemon-queue/*.json` every 5 s (the poll loop is started
unconditionally in `start()` at `:896-898`), reads `{ trigger, workerId }`,
calls `triggerWorker(trigger)`, and renames the entry into `.processed/`.
**But nothing writes those files.** The fork's `hooks_worker-dispatch`
handler (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3635-3752`)
only does `activeWorkers.set(workerId, worker)` (`:3706`) — a `Map` in the
**MCP-server process** (`:3537`) — then reports `status: "queued"`
unconditionally (`:3721`) with a stale comment (`:3719-3720`) claiming "the
daemon polls activeWorkers via its own state file." The daemon is a
**separate process**; it polls a *directory*, not that Map. So cross-process
dispatch is broken end-to-end at the producer: the consumer polls a directory
the producer never writes. (Verified: `grep -n "daemon-queue"` in the fork's
`hooks-tools.ts` returns nothing; the only `daemon-queue` references are the
consumer's reads.)

This was discovered during the ADR-0207 swarm review (IPC-architect
finding). It is **broader than ADR-0201's F-10-011**, which assumed the
file-poll queue was the working "de facto cross-process channel." It is not:
F-10-011 audited only the consumer and trusted upstream's #1845 *commit
comment* as proof a producer existed, without grepping the fork's
`hooks-tools.ts` — a "trusted the upstream changelog over the fork's actual
tree" gap.

### This is a failed integration of an upstream fix, not a fork-authored gap

The original draft framed this as "the fork regressed below upstream." More
precisely: **cross-process dispatch was never functional in the fork** — the
fork never had a working producer to regress from. Upstream `ruvnet/ruflo`
fixed exactly this in #1845 (commit `1884ed1010`, "3.7.0-alpha.12"). Its
`hooks_worker-dispatch`
(`ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3637-3695`)
**writes the durable queue file** and reports an honest status, with a
verbatim comment naming the bug the fork still has:

```
// #1845: write a durable queue file the daemon polls every 5s. Until
// 3.7.0-alpha.11 the dispatch only updated a process-local Map that
// the daemon (separate process) could never see, so `queued` was a
// lie. The queue file makes it real and inspectable on disk.
```

Upstream's handler computes a **four-state** honest status
(`queued` / `no-daemon` / `synthetic-completed` / `mcp-only`), writes
`.claude-flow/daemon-queue/<workerId>.json` with
`{ workerId, trigger, context, priority, enqueuedAt }` when
`background && daemonAlive`, and **falls back to `mcp-only` if the write
fails** — it never claims `queued` without proof on disk.

### How the fork ended up here (the partial cherry-pick)

The swarm reconstructed the exact lineage:

1. **2026-05-03 (`bec883618`, ADR-093 F2 / ADR-0162 Batch E hand-port):** the
   fork wrote its **own** honest-status block for `hooks_worker-dispatch` —
   the three-state `queued` / `no-daemon` / `synthetic-completed` ladder
   (replacing an older fake-`setTimeout` completion, the fork's parallel of
   upstream #1636). This kept the in-process-Map mechanism; it fixed the
   *completion lie*, not the *cross-process delivery*.
2. **2026-05-08 (`a8ede7ef1`, cherry-pick of upstream #1845/`1884ed1010`):**
   brought in **only** the `worker-daemon.ts` consumer (+129 lines,
   byte-identical). `a8ede7ef1` **never touched `hooks-tools.ts`** (verified
   via `--stat`). The producer hunk (+55 lines) could not apply cleanly —
   the fork's `hooks-tools.ts` had diverged via the 2026-05-03 ADR-093 F2
   rewrite — and was dropped rather than hand-resolved.

Result: **consumer in, producer out.** Exactly the partial-integration
failure mode the [[feedback-update-integration-ledger]] discipline exists to
prevent — and worse, the existing ledger row hides it (see *Integration
ledger* below).

The fork today already has (do **not** re-port these): the honest 3-state
ladder, daemon-liveness detection (`.claude-flow/daemon.pid` +
`process.kill(pid, 0)` at `hooks-tools.ts:3673-3685`), all required `fs`
imports (`:27`), and a `findProjectRoot()`-derived `cwd` (`:3672`). The
**only** missing piece is the producer write + the `mcp-only` state.

### Why this is load-bearing for ADR-0207 (but the honesty fix stands alone)

[ADR-0207](./ADR-0207-daemon-ipc-server-handler-registration.md) decides to
**remove** `DaemonIPCServer` (a fork-only invention upstream never had).
After that, the file-poll dispatch queue is the **sole cross-process
*worker-dispatch* channel** between the MCP server / CLI and the daemon.
(Note: it is *not* the only cross-process channel overall — `daemon.pid`
liveness, `daemon-state.json`, `daemon-children.json`, and POSIX signals
remain as control-plane channels, several of which 0207 itself uses. The
narrow accurate claim is "sole *data-plane* channel for handing work to the
daemon.") ADR-0207 explicitly names this producer gap as a NEW finding and
defers it to a follow-up ADR — **this ADR is that follow-up**.

**The dependency is on urgency, not validity.** The `queued`-without-a-write
lie is a real [[feedback-no-fallbacks]] defect **independent of ADR-0207**;
the honesty fix is valid and shippable even if 0207 slips. ADR-0207 only
sharpens the stakes (makes this the load-bearing dispatch path).

### The honesty defect (real, but latent — not actively breaking)

The fork reports `status: "queued"` while doing nothing observable
cross-process — the textbook [[feedback-no-fallbacks]] silent-success shape,
the precise lie upstream's #1845 comment calls out. **Scope of harm
(tempered from the draft):** this path is reachable only by *explicit*
invocation — `hooks_worker-dispatch` (MCP tool) or `ruflo hooks dispatch`
(CLI, `background` defaults true unless `--sync`) — against a *running*
daemon, which is itself opt-in (`init --start-daemon` defaults false). There
is **no automatic driver** (no hook/scheduler/autopilot enqueues background
workers). So the defect is **latent** — a human/agent who manually dispatches
in `background` mode then polls `hooks_worker-status` waits forever — not an
actively-firing failure in unattended runs. It is still worth fixing: it is a
real lie on an advertised, upstream-maintained tool that a real user hit.

## Decision Drivers

* **A proven fix already exists upstream** — not a design problem. Upstream's
  #1845 producer is the reference; per [[feedback-corpus-evidence-before-feature-work]]
  we port the proven fix rather than invent one. The fork's already-present
  consumer reads the exact payload upstream's producer writes.
* **Upstream maintains this feature, demand-driven** — #1845 was filed by an
  external user (Windows) with a pinned-line repro; #1636 by the same user;
  open corroboration #958/#1077 ("workers never execute"). This is real
  advertised surface, not speculative. (Decisive contrast with ADR-0217,
  whose feature upstream *abandoned* — there quarantine was right; here
  re-convergence is right.)
* **No silent success** — per [[feedback-no-fallbacks]]. `queued` without a
  durable entry is a fallback-shaped lie; upstream's honest states replace it.
* **The queue is the only *background, shell-independent* path for half the
  workers** — 6 of 12 workers (`ultralearn`, `predict`, `document`,
  `deepdive`, `refactor`, `benchmark`) are `enabled: false`
  (`worker-daemon.ts`), so no timer ever fires them. They are **still
  runnable in-process** via `daemon trigger -w <type>` (`triggerWorker` has
  no enabled gate; the fork's own help lists them as "(manual trigger)") — so
  Option B does **not** strand them (the original draft's "sole run path /
  strands them" claim was refuted by the council). What the queue uniquely
  provides is *fire-and-forget* execution that outlives the invoking shell:
  `daemon trigger` blocks the CLI for the worker's full duration, and these
  disabled workers are the long ones (deepdive/refactor on hour-scale
  intervals). That asymmetry — not unreachability — is the queue's value.
* **ADR-0207 coupling (urgency)** — removing the IPC socket makes this the
  sole cross-process *worker-dispatch* channel; it must work for 0207's
  data-plane premise to hold. (The honesty fix is valid 0207-independent.)
* **Integration-ledger hygiene** — this is a partial cherry-pick (consumer
  landed, producer didn't) whose existing ledger row is misleading. Closing
  it must correct the ledger per [[feedback-update-integration-ledger]].

## Considered Options

* **Option A — Restore the producer by porting upstream #1845 (chosen).**
  Replace the in-process-Map-only `background` branch with upstream's
  queue-file write + the `mcp-only` write-failure state. Re-converges with
  upstream; the existing consumer already matches the payload.
* **Option B — Remove the dispatch-to-daemon feature entirely** (delete
  `processDispatchQueue` + the `background` dispatch path; keep
  `hooks_worker-dispatch` synchronous/mcp-only). Rejected on three grounds
  that survive scrutiny: it diverges *from* upstream by deleting a maintained
  feature, throws away the already-landed consumer (47 lines), and removes the
  *background/fire-and-forget* dispatch path (plus the channel ADR-0207 leans
  on) — a multi-file deletion to avoid a ~30-line port. (Note: B does **not**
  strand the 6 `enabled:false` workers — they remain runnable in-process via
  `daemon trigger`; it loses only their shell-independent background run.)
* **Option C — Keep the in-process Map (status quo).** The broken state #1845
  fixed; cross-process dispatch is structurally impossible this way. Rejected.
* **Honesty-only subset** (fix the `queued` lie, leave the producer
  unwritten). Rejected: it leaves the 6 `enabled:false` workers without a
  *background* run path (`mcp-only` with no runner; they stay runnable
  in-process via `daemon trigger`, never fire-and-forget), and it writes
  *more* bespoke fork code to *withhold* the upstream fix than Option A writes
  to apply it. The honest-status change is a strict subset of Option A, not a
  substitute.

## Decision Outcome

**Chosen: Option A — restore the producer by porting upstream #1845's
queue-file write into the fork's `hooks_worker-dispatch` handler.**

* The daemon consumer already exists and already reads the upstream payload
  shape — only the producer is missing. Porting it makes the existing,
  cherry-picked consumer functional; nothing new is designed.
* It replaces the `queued`-without-proof lie with upstream's honest status
  ladder — closing the [[feedback-no-fallbacks]] violation in the same change.
* It repairs the cross-process worker-dispatch channel ADR-0207 leaves
  standing, and re-converges the fork with upstream (#1845), reducing
  divergence.
* Options B / C / honesty-only each discard or strand real, upstream-supported
  capability.

### Concrete shape of the change (corrected by the swarm)

In `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts`, the
`hooks_worker-dispatch` handler (~3635-3752):

1. Keep `activeWorkers.set(...)` for local status tracking
   (`hooks_worker-status` reads it); it is **no longer** the cross-process
   mechanism.
2. In the `background && daemonAlive` branch (currently ~3718-3722), write
   the durable queue file:
   * **Reuse the handler's existing `cwd` — which is `findProjectRoot()`
     (`:3672`), NOT upstream's `getProjectCwd()`.** Upstream's resolver was
     deprecated in the fork under ADR-0100 (`getDisplayCwd()`/`@deprecated`
     for storage paths); copying upstream's body verbatim would reintroduce
     the storage-path bug. The producer MUST write under the *same* root the
     constructor-injected consumer reads (`worker-daemon.ts` `this.projectRoot`,
     injected via `startDaemon(projectRoot, …)`). A `findProjectRoot()`-vs-
     daemon-`projectRoot` mismatch is the one real runtime risk — the
     [[feedback-singleton-frozen-state-desync]] failure shape — and the
     end-to-end test must assert the two roots coincide. In practice this is
     **self-correcting**: the producer reaches the queue-write branch only
     when `daemonAlive` — i.e. it found a live PID under
     `findProjectRoot()/.claude-flow/daemon.pid` — and a daemon writes its PID
     *and* reads its queue under the same `this.projectRoot`, so a live PID
     under that root proves the daemon's root coincides. A genuine mismatch
     degrades to an honest `no-daemon`, never a silent `queued`.
   * `queueDir = join(cwd, '.claude-flow', 'daemon-queue')`;
     `mkdirSync(queueDir, { recursive: true })` if absent. (All `fs` imports
     are already present at `:27` — the port adds none.)
   * `writeFileSync(join(queueDir, ` `${workerId}.json` `), JSON.stringify({ workerId, trigger, context, priority, enqueuedAt: new Date().toISOString() }, null, 2))`.
   * Payload MUST include `trigger` and `workerId` — the two fields the
     consumer requires (`worker-daemon.ts:1006-1008`; `trigger` must be a
     valid `WorkerType` or the entry is quarantined). `context`, `priority`,
     `enqueuedAt` are carried for parity/inspectability. (Verified: the
     12-member `WorkerTrigger` and `WorkerType` unions are identical.)
3. **Add the `mcp-only` state** (the only *new* state #1845 introduced):
   widen the status union at `:3713` from
   `'queued' | 'no-daemon' | 'synthetic-completed'` to add `| 'mcp-only'`
   (and `let note = ''`). **Keep `synthetic-completed`** — it is the
   *synchronous* (`!background`) honest state and is already correct; do not
   remove it. The four states are orthogonal-by-path:
   * no daemon → `no-daemon` (already correct);
   * background + write succeeds → `queued` (only after the file is on disk);
   * background + write throws → `mcp-only` (never claim `queued` without proof);
   * synchronous → `synthetic-completed` (unchanged).
4. **Wire the existing `validateText(context)` (~2 lines, not a hunk port).**
   Upstream #1845 validates `context` alongside the producer write
   (`ruvnet/ruflo/.../hooks-tools.ts:3584`). `validateText` **already exists**
   in the fork (`src/mcp-tools/validate-input.ts:177`); `hooks-tools.ts` just
   doesn't import it yet — so this is `import { validateText }` + a one-line
   `context` guard. **Scope validation to `context` only**, and do NOT import
   `validate-input.ts`'s unrelated `WorkerType` (an 11-member *agent*
   taxonomy, distinct from the daemon's 12-member worker `WorkerType`).

### Integration ledger (corrected)

There is **already** a row for `1884ed101` at
`docs/upstream/INTEGRATION-LEDGER.md:94` reading `hand-ported | a8ede7ef1 |
… | dropped pkg.json bumps`. That row is **misleading**: it claims
source-substance equivalence ("dropped pkg.json bumps" only) for a
cherry-pick that silently shed the entire +55-line `hooks-tools.ts` producer.
Per the ledger's append-only **supersession** convention, add a row that
**supersedes row 94**, recording `a8ede7ef1` as a *consumer-only* partial
port of `1884ed101`, and recording this ADR's work as the **producer half**
(disposition: hand-port — the fork's `hooks-tools.ts` had diverged via
ADR-093 F2 `bec883618`, so the producer hunk did not apply cleanly).
Reference ADR-0218.

### Consequences

* Good, because cross-process worker dispatch actually works — the daemon
  executes dispatched workers (including the 6 `enabled:false` workers in
  *background/fire-and-forget* mode, which `daemon trigger`'s in-process run
  cannot offer) instead of silently ignoring them.
* Good, because the `queued`-without-proof lie is replaced by honest status,
  closing a [[feedback-no-fallbacks]] violation a real upstream user reported.
* Good, because it makes ADR-0207's "file-poll queue is the sole
  worker-dispatch channel" premise true.
* Good, because it re-aligns the fork with upstream's #1845 fix, reduces
  divergence, and corrects the misleading ledger row.
* Neutral, because `activeWorkers` stays for in-process status tracking; the
  change adds a durable write alongside it.
* Bad, because it adds a filesystem write to the dispatch path (mitigated:
  bounded JSON write, explicit `mcp-only` fallback on failure).
* Neutral, because `.processed/` retention/rotation (F-10-011) is still out
  of scope — separate concern.
* Neutral (sequencing), because this is a **low-blast-radius** fix (latent,
  manual-invocation-only): land it **with/after ADR-0207** (per `depends-on`)
  and **after the live CRITICAL ADR-0202** (per
  [[project-adr0201-remediation-impl-order]]); it must not displace 0202.

### Confirmation (corrected)

1. **End-to-end dispatch test** (in `forks/ruflo/v3/@claude-flow/cli/__tests__/`
   — note: `test/integration/` does **not** exist; model on
   `__tests__/services/worker-daemon-resource-thresholds.test.ts`): construct
   a `WorkerDaemon(tempDir)`; produce a queue entry via the dispatch handler
   (or directly) with a real `trigger`; assert
   `.claude-flow/daemon-queue/<id>.json` is written with `{ trigger, workerId, … }`
   under the **same** root the daemon uses; drive the consumer
   (`processDispatchQueue` is `private` — drive via the public `start()`
   poll, using **fake timers** so the test does not wait the real 5 s
   interval); assert the entry moved to `.processed/` and `triggerWorker`
   ran. `afterEach`: `rmSync(tempDir)` + `removeAllListeners('SIG*')`.
   * **Do NOT assert `hooks_worker-status` flips to `completed`.** In *both*
     fork and upstream, `hooks_worker-status` reads only the in-process
     `activeWorkers` Map; a background worker executes in the daemon process
     and never writes back to the MCP-process Map. Upstream #1845 did not
     close this readback loop, and a status-readback channel is **net-new
     beyond upstream — explicitly out of scope** (per
     [[feedback-corpus-evidence-before-feature-work]], don't build it). The
     honest deliverable is "file written → dequeued → `.processed/` →
     `triggerWorker` ran," not "status reports completion."
2. **Honest-status test**: with no daemon running, assert `no-daemon`, not
   `queued`. Simulate a write failure (read-only `daemon-queue/`) and assert
   `mcp-only`, never `queued`.
3. **Producer present**: `grep -rn "daemon-queue"
   forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` returns the
   producer write (currently empty — only the consumer in `worker-daemon.ts`
   matches).
4. **Ledger** corrected (supersede row 94) per [[feedback-update-integration-ledger]].
5. **`npm run release`** passes with the new integration tests.

## Swarm review evidence

Reviewed 2026-05-20 by a 6-expert adversarial swarm (queen + domain
architect + runtime/feasibility + code archaeologist + upstream analyst +
devil's advocate), applying [[feedback-remediation-adr-preflight]].
**Verdict: Option A validated** (the rare batch ADR that survives intact, like
ADR-0214). Key findings:

* **Premise true at runtime (#3):** producer genuinely absent (`grep
  daemon-queue` in fork `hooks-tools.ts` empty; only the consumer matches);
  the `queued` lie returned unconditionally (`:3721`); `activeWorkers` is a
  process-local Map (`:3537`). Consumer poll loop live under `daemon start`
  (`worker-daemon.ts:896`).
* **Re-converge with upstream (#2 — the good case):** upstream maintains the
  producer+consumer pair (#1845, unchanged at HEAD); porting *reduces*
  divergence. Opposite of ADR-0217 (upstream-abandoned → quarantine). The
  payload contract is exact (12-member `WorkerType` ≡ `WorkerTrigger`;
  required keys present with matching names). Upstream has no later
  producer fix to chase.
* **Demand is real:** #1845/#1636 filed by an external user (Windows) with a
  pinned-line repro; open corroboration #958/#1077.
* **Driver (the 0217 lens):** reachable only via manual MCP/CLI invocation
  against an opt-in daemon — no auto-driver — so the defect is *latent*, not
  actively breaking. But the queue is the **sole** entry point for 6 of 12
  workers, so it is not dead surface; B/honesty-only would strand them.
* **0207 coupling sound + self-documented:** 0207 names this gap and defers
  it to a follow-up (this ADR); they move the same direction (toward
  upstream). The honesty fix is valid even if 0207 slips.
* **Corrections folded in:** `findProjectRoot()` not `getProjectCwd()`
  (ADR-0100 trap); +`mcp-only` state, keep `synthetic-completed`
  (status-ladder prose was imprecise); Confirmation test #1 reframed
  (status-readback out of scope); test dir `__tests__/` not
  `test/integration/` + fake timers; "sole channel" → "sole worker-dispatch
  channel"; ledger row 94 superseded not appended; title "regressed below" →
  "never integrated #1845's producer."

### Second council re-validation (2026-05-22)

Re-reviewed by a second 6-expert dialectic council (S3: queen-led,
shared-memory; devil cast as the *remove-opponent*; corpus re-confirmed the
0207 coupling). **Verdict: 6× keep/approve/endorse Option A, 0 needs-rework —
the "good re-convergence case" framing holds.** Premises verified on disk
(producer absent; consumer **byte-identical**, md5-confirmed; payload contract
exact; upstream #1845 unchanged at HEAD with **three distinct external
reporters**; 0207 chooses REMOVE and defers this gap here). But one
load-bearing sub-argument was refuted, and the cohort template defect is
present. Corrections folded in:

* **A 2-vs-2 expert split on "Option B strands the 6 `enabled:false`
  workers" — resolved by queen verification against B.** The archaeologist
  and devil traced `daemon trigger -w <type>` → `triggerWorker` →
  `executeWorker`, which has **no enabled gate** (the fork's own help lists
  the disabled workers as "(manual trigger)"); corpus and feasibility had
  only checked the *timer* path (`scheduleWorker`'s enabled gate). I verified
  the code: **B does NOT strand them** — they remain runnable in-process via
  `daemon trigger`. The "sole run path / strands them" claim was false and is
  corrected throughout (driver, Option B, honesty-only, Consequences).
* **The devil supplied the *correct* A-beats-B reason the ADR was missing:**
  the queue's value is *background, fire-and-forget execution that outlives
  the invoking shell* — `daemon trigger` blocks the CLI for the worker's full
  duration, and the disabled workers are the long ones. The B-rejection is
  re-anchored on the three reasons that survive (re-convergence, the
  `no-fallbacks` `queued`-lie, ledger hygiene) plus this asymmetry — not on
  stranding.
* **Cohort template defect (the only ADR in the batch with it):** `## Consequences`
  had escaped to top-level H2 *after* `### Confirmation`. Re-nested to
  `### Consequences` under `## Decision Outcome` and moved before
  `### Confirmation` (canonical MADR order; matches the clean ADR-0217).
* **`validateText` down-weighted:** feasibility found it already exists
  (`validate-input.ts:177`) — the port is a ~2-line import + `context` guard,
  not a "port-or-ledger hunk." Added the porting-trap warning (that file's
  unrelated 11-member agent `WorkerType`); scope validation to `context`.
* **Root-mismatch is self-correcting (the ADR under-explained why it's safe):**
  added a note that the producer writes the queue only when it found a live
  PID under `findProjectRoot()`, and the daemon writes its PID + reads its
  queue under the same `this.projectRoot` — so the roots coincide whenever a
  write happens; a mismatch degrades to honest `no-daemon`, never silent
  `queued`.
* **Minor (left as-is, noted):** the consumer landing was strictly a *hand-port*
  (`a8ede7ef1` carries no cherry-picked-from trailer) — the ADR's "cherry-pick"
  wording is loose but the ledger's "hand-ported" disposition is already
  accurate; "ledger row 94" should read "the `1884ed101` row" (the ledger is
  not line-numbered — a drift trap); several consumer line-cites have drifted
  (anchor by symbol).

**Held under re-check:** the decision (Option A) and its primary driver (the
`queued`-without-a-write `no-fallbacks` lie on an advertised, upstream-maintained
tool a real user hit — independent of stranding and of 0207); producer-absent /
byte-identical-consumer / exact-payload / demand-real / 0207-coupling /
`findProjectRoot`-not-`getProjectCwd` / misleading-ledger-row; sequencing (after
CRITICAL 0202, with/after 0207). State: producer work 0% done (clean slate).

## More Information

* **Discovery:** ADR-0207 swarm review (2026-05-20), IPC-architect finding.
* **Upstream reference (the fix to port):**
  `ruvnet/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3637-3695`
  (issue #1845, commit `1884ed1010`, "3.7.0-alpha.12"; producer write
  `:3647-3667`, 4-state union `:3637`, `validateText` `:3584`). Filed by an
  external user with a pinned-line repro; #1636 the predecessor honesty fix.
* **Fork consumer (already present, byte-identical, matches payload):**
  `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:975-1021`
  (`processDispatchQueue`; reads `payload.trigger`/`payload.workerId`
  `:1006-1008`), cherry-picked via `a8ede7ef1` from `1884ed101`.
* **Fork producer (broken — to fix):**
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:3635-3752`
  (`activeWorkers.set` `:3706`; stale "daemon polls activeWorkers" comment
  `:3719-3720`; unconditional `queued` `:3721`; 3-state union `:3713`;
  `findProjectRoot()` cwd `:3672`; liveness check `:3673-3685`; fs imports
  `:27`).
* **Divergence origin (why the cherry-pick dropped the producer):**
  `bec883618` (2026-05-03, ADR-093 F2 / ADR-0162 Batch E hand-port) rewrote
  the fork's `hooks_worker-dispatch` status block, so #1845's producer hunk
  could not apply cleanly.
* **Coupled decision:** [ADR-0207](./ADR-0207-daemon-ipc-server-handler-registration.md)
  — removes the IPC socket; names this producer gap as a follow-up.
* **Audit context:** ADR-0201 §F-10-011 (`audits/2026-05-19-soundness-audit/10-daemon.md`)
  — mischaracterized the file-poll queue as working (audited the consumer +
  trusted upstream's #1845 comment; never grepped the fork's producer).
* **Existing (misleading) ledger row:** `docs/upstream/INTEGRATION-LEDGER.md:94`
  — to be superseded.
* **Memory references:** [[feedback-no-fallbacks]] (the `queued` lie),
  [[feedback-corpus-evidence-before-feature-work]] (port the proven upstream
  fix; don't build a status-readback channel beyond upstream),
  [[feedback-update-integration-ledger]] (correct the partial-cherry-pick
  row), [[feedback-singleton-frozen-state-desync]] (the
  `findProjectRoot`-vs-daemon-`projectRoot` risk),
  [[feedback-upstream-means-upstream]] (upstream = `ruvnet/ruflo`),
  [[project-adr0201-remediation-impl-order]] (sequencing: after 0202, with/after 0207).

## Amendment — 2026-05-23 (Move A audit, implemented)

Status flipped: **proposed → implemented**. ADR-0207 REMOVE confirmed at audit (no rework needed); the producer port shipped to `forks/ruflo` in commit `0799eb19f` ("feat(hooks): ADR-0218 restore worker-dispatch queue producer (upstream #1845)").

**Verified at fork HEAD:**

- Producer write: `hooks-tools.ts:4045-4073` (`background && daemonAlive` branch writes `.claude-flow/daemon-queue/${workerId}.json` with the consumer's contract payload via `findProjectRoot()`-derived cwd — NOT `getProjectCwd()`).
- Four-state honest ladder live (`no-daemon` / `queued` / `mcp-only` / `synthetic-completed`); `queued` only reported when `writeFileSync` succeeded — the `queued`-without-a-write `no-fallbacks` lie is closed.
- `validateText(context)` wired (one-line import + guard).
- Consumer (`worker-daemon.ts:979 processDispatchQueue`) unchanged — already reads the upstream payload shape (cherry-picked via `a8ede7ef1`).

**Tests:** `__tests__/mcp-tools/hooks-worker-dispatch-producer.test.ts` — 7/7 passing. End-to-end queue-lifecycle test deferred to `ruflo-patch/tests/pipeline/daemon-queue-lifecycle.test.mjs` per Confirmation #1 reframing (avoids the agentdb/archivist baseline issue that affects in-fork WorkerDaemon imports).

**Ledger:** corrected (row 94 superseded by rows 110 + 111 of `docs/upstream/INTEGRATION-LEDGER.md` — partial-cherry-pick disclosure + producer re-port row).

Dependency confirmed: ADR-0207's audit (this batch) confirmed REMOVE disposition holds — no rework needed.

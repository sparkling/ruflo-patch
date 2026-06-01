---
status: proposed
date: 2026-06-01
tags: [rvf, ruvector, memory, lock, concurrency, architecture, t3-2]
supersedes: []
depends-on: [ADR-0274, ADR-0267, ADR-0095, ADR-0167, ADR-0202, ADR-0207]
implements: []
---

# Collapse RVF write coordination to a single native flock (eliminate the JS `.jslock`)

> **Status note.** Proposed pending a queen-led council review (agent team
> `rvf-lock-council`, 2026-06-01). The council's per-question verdicts + synthesis
> are recorded under **Council review** below and at
> `~/.claude/teams/rvf-lock-council/config.json` + `~/.claude/tasks/rvf-lock-council/`.
> Do not implement until the council verdict + a human go-ahead.

## Context and Problem Statement

ADR-0267 (the daemon held the RVF `flock(LOCK_EX)` for its whole lifetime →
concurrent CLI `memory store` got `LockHeld`) is **fixed and verified** by ADR-0274
(read/write handle split + per-transaction release). That is not what this ADR
addresses.

What remains is the **t3-2 acceptance flake**: under high write concurrency (N≈8+
concurrent `memory store` processes), writes are **silently lost** with **zero
errors** — measured 7–10/16 surviving on a warm-start `.rvf`, while 16/16 survive
when run sequentially. This is a real (if tail-risk) data-loss bug, and it lives
entirely in **fork-invented** cross-process write-coordination code — upstream's
`@claude-flow/memory/src/rvf-backend.ts` is 683 lines with **zero** lock machinery;
the fork's is 3648 lines built around a JS advisory lock.

### The two-lock architecture (traced 2026-06-01, file:line-verified)

There are **two** cross-process locks on the `.rvf`, and they are redundant — one
is correct, one is broken:

| Lock | Where | Status |
|---|---|---|
| **native `.lock`** — kernel `flock(LOCK_EX\|LOCK_NB)`, NB-poll + 30 s timeout (`RVF_LOCK_ACQUIRE_TIMEOUT_MS`), process-local refcount for nested same-process acquires | `forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs` `WriterLock::acquire` (107–226); acquired at `RvfStore::open`/`create` (`store.rs:180/331`); `open_readonly` takes none (`store.rs:383–409`); cycled by `park_writer` (`store.rs:1359`) / `unpark_writer` (`store.rs:1381`) which **resyncs the peer's committed segment directory before appending** (`resync_for_write`, `store.rs:1414`) | **Correct cross-process serializer.** Same-inode kernel flock queue; the resync makes append-only commits provably non-clobbering. |
| **`.jslock`** — `writeFile(…, {flag:'wx'})` create-exclusive + PID-liveness *steal* | `rvf-backend.ts`: path `…+'.jslock'` (`:338`), `acquireLock` (`:2044`, wx-create at `:2097`, dead-holder steal at `:2135`), `releaseLock` (`:2159`), re-entrant depth counter | **Broken cross-process serializer** — fails to serialize at high concurrency (the t3-2 loss), and creates the AB-BA deadlock that sank the prior blocking-flock attempt. |

The write handle is **persistent** (opened once in `tryNativeInit`, `rvf-backend.ts:1407`,
flock held from `open()`); ADR-0274's `park`/`unpark` (mapped napi → `release_lock`
→ `park_writer`, `reacquire_lock` → `unpark_writer`, `lib.rs:1052/1068`) release it
between transactions so the daemon does not hold it for its lifetime. The `.jslock`
is the gate actually wrapping each `store()` envelope today (`store()` at
`rvf-backend.ts:509–594`; `acquireLock` also `unpark`s the native flock, `:2105`;
`releaseLock` schedules a **debounced** park, `_scheduleNativePark` `:2026/:2182`).

### Two failure modes of the current design

1. **Silent loss (the t3-2 flake).** The `.jslock` is the per-envelope serializer
   and it is broken: (a) the dead-holder steal (`:2135`) can preempt a live holder
   on PID-liveness false-negatives; (b) a deeper wx-create/unlink race persists even
   with the steal disabled. The native flock — which *is* correct — is parked
   (released) between transactions via a `setTimeout` debounce that is **starved
   under load**, so it is not reliably engaged across the `.jslock` boundary.
2. **AB-BA deadlock (why the prior "blocking flock" fix was reverted, ruvector
   `adab9fc36`).** Init takes native→`.jslock` (open acquires the flock at
   `:1407`; `loadFromDisk` then runs under `.jslock`, `:400–409`); `store()` takes
   `.jslock`→native (`:2105`). With a no-timeout blocking flock that inversion is a
   hard AB-BA. The init/`.jslock` scope-down (`rvf-backend.ts:353–372`, the ADR-0095
   2026-05-01 amendment) made it *worse*, not better.

## Decision Drivers

* **The native flock is load-bearing, not incidental** (ADR-0167). RVF integrity is
  a linear append-only Merkle witness chain; two concurrent appenders fork the chain
  and break attestation. Single-writer is by design. *"Replace the flock" is out of
  scope.*
* **No daemon / broker write-routing** (ADR-0207 deleted the Unix-socket broker;
  ADR-0274 Option 2 re-rejected it; it would also reintroduce the ADR-0267
  lifetime-hold).
* **Cross-process-concurrent / lock-free RVF is impossible** without abandoning the
  witness chain (ADR-0274 Option 3).
* **Must not regress ADR-0267** — the daemon must still hold no flock between ticks.
* **Must not mask the flake** (no `skip_accepted`); the fix must be provable and
  wired into the t3-2 check + CICD as a deterministic guard.
* **Simplicity** — the end state should be *fewer* moving parts than today, not more.

## Considered Options

* **Option A — Collapse to the single native flock; eliminate the `.jslock` (proposed).**
  Make the already-correct native flock the sole cross-process write serializer, held
  across the **whole store envelope** (in-mem mutate + native ingest + WAL append +
  WAL compact) *and* across init (`open()` + `loadFromDisk`), via **synchronous**
  park/unpark at the envelope boundary (kill the debounce). Delete the `.jslock`
  (wx-create, steal, unlink) and the debounce timer. Keep the re-entrant depth counter
  so the nested WAL helpers don't double-acquire; the inner native `ingest` acquire
  nests via the existing process-local refcount (`locking.rs:119–127`).
  - Kills failure mode 1 (native flock + `resync_for_write` is a correct serializer
    where the `.jslock` was not) **and** failure mode 2 (one lock → no AB-BA → a fair
    blocking flock even becomes possible later).
  - Stays ADR-0267-safe: still per-transaction park between stores; `setRouterPersistent(false)`
    (`memory-router.ts:201–203`) keeps the daemon releasing per tick.
  - Expected to need **zero Rust changes** — `park`/`unpark`/`resync` already exist
    and look correct; to be confirmed empirically.
  - Net result is *simpler*: one lock, not two.

* **Option B — Repair the `.jslock`, keep both locks (rejected, pending council).**
  Fix the steal + the wx race, keep the two-lock design. Rejected as proposed because
  it leaves the AB-BA inversion intact and keeps a redundant fork-invented layer on
  top of a correct kernel primitive.

* **Option C — SYNC-PARK only (partial, rejected).** Make park synchronous but keep
  the `.jslock`. Measured 11/16 (cold-start) with SYNC-PARK + INIT-WRAP — still lossy,
  because the `.jslock` itself doesn't serialize. A half-measure.

## Decision Outcome

**Proposed: Option A.** Pending the council verdict + human go-ahead. Rationale: it is
the only option that removes *both* failure modes, honors every hard constraint
(flock load-bearing, no broker, not lock-free, ADR-0267-safe), and *reduces* the
moving parts. The open risk — whether removing the `.jslock` alone reaches 16/16 or a
residual native-layer issue remains behind it — is resolved by **measurement**, not
assumption (Option C's 11/16 had the `.jslock` still in place, so it does not answer
this).

### Proposed change surface (for review — not yet implemented)

`@claude-flow/memory/src/rvf-backend.ts` only (expected):

1. `acquireLock(maxWaitMs)` → drop wx-create/steal/unlink; keep the re-entrant depth
   counter; at depth 0→1 call `unparkNativeWriter()` (the cross-process wait, bounded
   by `RVF_LOCK_ACQUIRE_TIMEOUT_MS`).
2. `releaseLock()` → at depth 1→0 call `parkNativeWriter()` **synchronously** (delete
   `_scheduleNativePark`/`_cancelNativePark` + the debounce timer).
3. Delete the `.jslock` path (`:338`), the steal, and the shutdown `.jslock` unlink.
4. **INIT-WRAP**: keep init's flock (taken at `open()`) held across `loadFromDisk`,
   park after — revert the `:353–372` scope-down so init's read-modify-write is atomic
   under the single lock.

`forks/ruvector` (`store.rs` / `locking.rs` / `lib.rs`): **no change expected**;
confirm empirically, and if a residual loss remains, trace it into `resync_for_write`.

## Council review (agent team `rvf-lock-council`, 2026-06-01)

Queen-led council (Queen + Devil's Advocate + 5 domain experts), real-time
collaboration via SendMessage, run in the background. On-disk record:
`~/.claude/teams/rvf-lock-council/`. Questions:

1. **Core correctness** — Is native-flock + `resync_for_write` a *sufficient*
   cross-process serializer for the append-only chain, such that removing the
   `.jslock` and holding the flock across the store+WAL envelope eliminates the t3-2
   loss — or is there a residual native-layer race the `.jslock` was masking?
2. **Deadlock freedom** — Does single-lock collapse provably kill the AB-BA, and does
   holding the flock across init (`open()` + `loadFromDisk`) + envelope introduce any
   new hazard (nested ingest refcount, napi `Mutex<Option<RvfStore>>`)?
3. **ADR-0267 non-regression** — Does synchronous per-envelope park (vs the debounce)
   keep the daemon from holding the flock between ticks?
4. **Scope / simplicity (Devil's Advocate leads)** — Is full `.jslock` removal
   warranted, or does a lower-risk fix (repair the steal; SYNC-PARK only; subordinate
   the `.jslock` without removing it) reach 16/16 with less blast radius?
5. **Verification adequacy** — What deterministically proves the fix (warm/cold × N,
   daemon scenario) and wires a non-flaky guard into the t3-2 acceptance check + CICD
   without `skip_accepted`?
6. **ADR vehicle** — New ADR vs amend ADR-0274 — and exactly what it must supersede.

### Queen's synthesis (council complete, 2026-06-01)

Council: Queen (chair) + Devil's Advocate + 5 domain experts (flock, rvf-integrity,
backend, adr-governance, verification). Every position was put through one challenge
+ one rebuttal. **Headline: the council does not endorse Option A _as written_ (its
delete-then-measure ordering is backwards), nor does it pivot to Option B/B′/C (all
refuted below). The verdict is PROCEED-WITH-CONDITIONS with a re-ordered,
measurement-first condition set.**

#### Per-question verdicts

**Q1 — Core correctness: SUPPORT-WITH-CONDITIONS (rvf-integrity 0.85, flock concurring).**
For the `store()` hot path the single native flock held envelope-wide _is_ a
sufficient serializer. Decisive evidence (the call order): `acquireLock()` is the
first op in `store()` (`rvf-backend.ts:538`) and re-acquires the native flock via
`unparkNativeWriter()` (`:2105`) _before_ any `.wal`/`.meta` touch; `releaseLock()`
parks _after_ the `finally{}` completes `appendToWal` (`:580`) + `compactWal` (`:586`).
So the `.wal`/`.meta` ops sit strictly inside the unpark→park window; kernel `LOCK_EX`
on the never-unlinked `.lock` inode (`locking.rs:132-141`) excludes peers from the
**whole envelope** — the flock need not be on the `.wal` fd to serialize it
(mutual exclusion is by held-section, not by fd-reaches-across-paths, a claim no one
made). This re-characterises the handover's Part C loss ("peer's compact unlinks our
journal entry") as a **`.jslock` failure** (two processes in their envelopes at once
because the `.jslock` didn't gate), _not_ an `.rvf`-layer race. `resync_for_write`
advancing `seg_writer` past `max_seg_id` (`store.rs:1456`) + commit-fsync-before-park
(`store.rs:1363-1366`) make append-only commits provably non-clobbering.
**Residual (→ condition C1, and the gating measurement below):** the call-order proof
covers `store()`; the auto-persist timer path (`compactWal`/`persistToDisk`, the 30 s
`autoPersistInterval` `rvf-backend.ts:412-432`) must be audited for bracketing
completeness — any `.meta`/`.wal` write that escapes an `acquireLock` bracket re-opens
fact (1) for that path (fix = add the bracket, not abandon the collapse).

**Q2 — Deadlock freedom: SUPPORT-WITH-CONDITIONS (flock 0.83, backend concurring).**
Single-lock collapse kills the AB-BA **by construction**: one lock ⇒ no second
resource to invert against (today: init takes native→`.jslock` `store.rs:331` +
`rvf-backend.ts:401`; `store()` takes `.jslock`→native `:538`→`:2105` — the inversion
that wedged the reverted blocking-flock build, handover Part B). The three suspected
new hazards are each inert: (i) the inner `ingest_batch` takes **no** `WriterLock`
(only acquire sites: `create:180`, `try_open_once:331`, `unpark_writer:1388`,
`derive:2276`) so the envelope acquires once at depth 0→1; (ii) same-inode kernel FIFO
— widening the hold is _more_ correct; (iii) the napi `Mutex<Option<RvfStore>>`
(`lib.rs:502`) is per-method, never held across the JS await boundary, so it never
co-exists held-with the flock. The DA's `locking.rs:151-162` "silent-hang window"
concern is **de-fanged by NB-poll** (`locking.rs:183-210`: the drop-and-insert window
degrades to one 100 ms poll + short-circuit, _not_ a hang) — and NB-poll is **kept**
by Option A, so removing the `.jslock` leaves the de-fanging intact. Conditions:
C1 init must sync-park _after_ `loadFromDisk` (else a 0267-shaped hold spans
init→first-store); C2 liveness now rests solely on the 30 s
`RVF_LOCK_ACQUIRE_TIMEOUT_MS` → must load-test envelope duration ≪ 30 s at N=16;
C3 keep both the JS depth counter and the Rust process-local refcount.

**Q3 — ADR-0267 non-regression: SUPPORT (backend 0.9) — verdict clean; supporting
ratio corrected mid-council to a TWO-owner argument.** Synchronous park cannot regress
the lifetime-hold, but the reason is _two-pronged_ because there are **two** long-lived
RVF owners, not one (backend + DA both traced this; `setRouterPersistent(false)` has
exactly one call site, `worker-daemon.ts:977`):
- **worker-daemon** (`_isPersistent=false`): releases per-op via `_storage.shutdown()`
  →`close()` (`memory-router.ts:1081-1083` → `rvf-backend.ts:463-467`), which drops the
  flock and _cancels_ the debounce. Park is dead code here ⇒ debounce→sync-park is
  invisible to this owner.
- **MCP server** (`_isPersistent=true`, `mcp-server.ts:481-485` — itself the ADR-0267
  "Option F" fix that skips the eager warm-up so it holds no flock at startup and takes
  the flock only lazily per-dispatch): this is the original ADR-0267 victim, and park
  **is** its release mechanism. Here sync-park is strictly _tighter_ than the starved
  50 ms `setTimeout` debounce — it releases on envelope exit, sooner, which is
  anti-ADR-0267 (the right direction). The only longer-hold path is a wedged envelope,
  which the debounce never guarded either (pre-existing Q1/Q2 concern, not new).
Condition (the one "proven vs assumed" gap): the `lsof memory.rvf.lock`-empty
non-regression assertion must run against the **MCP-server-persistent** scenario, not
only the worker-daemon — because the MCP path is where park is load-bearing and where a
sync-park release bug would surface. Folds into Q5 as P2 (two sub-checks).

**Q4 — Scope/simplicity: full `.jslock` removal is warranted _over B/B′/C_;
PROCEED-WITH-CONDITIONS (measurement-first). The Devil's Advocate's REJECT does not
survive as a pivot, but its _ordering_ critique is upheld.** The DA ran an exemplary
self-correction: its first alternative B′ ("subordinate, keep the `.jslock`
unchanged") **is identical to the already-measured Option C** (SYNC-PARK + INIT-WRAP,
`.jslock` kept) = **11/16 cold** (handover Part D) — i.e. _refuted by existing data_.
Its revised B″ (SYNC-PARK + INIT-WRAP + _repair_ the `.jslock`) still keeps **two
locks**, therefore keeps the acquire-order inversion = the AB-BA root — left unrebutted
against backend/flock's "one lock = one order = no AB-BA," and defended only against a
window NB-poll already de-fangs while retaining a serializer the handover measured
broken (steal-disabled still 10/16, Part C). So no B-variant is strictly safer than A.
**But the DA's process critique is correct and is adopted:** the ADR proposes to
_delete_ the `.jslock` + revert the `§353-372` init scope-down (4 coupled edits) and
measure _after_ (`§116-118`, `§135`) — backwards from "default-reject-under-doubt."
The 11→16 residual is not yet proven to be a serialization loss vs. a vectors-
visibility artifact (see Risk 2), and that must be deconfounded _before_ the delete.

**DA final re-calibration (intellectual-honesty trace → convergence).** After tracing
`persistToDiskInner`, the DA _withdrew the strong form of fact (1)_, then over the next
two traces **retracted fact (2) entirely and conceded fact (3)** — collapsing
REJECT (0.7) → **ACCEPT (0.7)** (confident A is sound; not that it is the _only_ option).
The traces: (fact 1) in native mode (the t3-2 path — no `.rvf.meta` sidecar)
`persistToDiskInner` does not write `.meta` (`if (!this.nativeDb)`, `rvf-backend.ts:3557`);
durability is in the META_SEG written during `store()` (`:557-559`) under the flock
(atomic, `store.rs:572-598`), and `mergePeerStateBeforePersist` (`:3392-3415`) re-reads
+ replays before persist (convergence) — so the `.wal` is a _secondary_ crash bridge,
not the steady-state loss vector, and its `store()`-path ops are transitively serialized
(call order, conceded). (fact 2) the visibility confound is **already fixed in-tree**:
the bug comment (`:2766-2788`) has its remediation ten lines below (`:2797-2823`, the
ADR-0163 recovery pass), and the `memory list` path runs through it on a fresh boot — so
a count-miss is real loss, not an artifact. (fact 3) addressed by flock-expert (the
hot path unparks once; the racy window needs a second acquire it never makes).
**So Q4 is not a split — all seven participants accept Option A's end-state, no viable
pivot** (B′ = the measured-11/16 Option C; B″ keeps the AB-BA root). **The DA's
disciplined closing boundary is adopted verbatim as the epistemic frame:** the council
certifies _"no surviving structural / deadlock / metric objection"_ — it does **not**
certify _"Option A reaches 16/16,"_ because no `.jslock`-removed run exists (every
verdict is analytical; the handover's 11/16 was Option C _with_ the `.jslock`). That gap
is an unrun experiment, and given this bug burned multiple cycles on plausible-but-wrong
fixes, ratify A as the **agreed design direction gated on a green measured run**, not as
"the fix." One pre-existing item surfaced and parked to a separate ticket: the
delete-path `.wal` truncate (`delete()` `:719` / `bulkDelete()` `:1041`) runs outside any
`acquireLock` bracket **today** — so "the single flock covers _all_ writes" is
almost-true, not literally true; Option A introduces no new exposure there (optional
~6-line fix: bracket `delete()`/`bulkDelete()` under the depth counter, per flock-expert).

**Q5 — Verification adequacy: SUPPORT-WITH-CONDITIONS (verification 0.82).** The
current t3-2 is **single-shot N=6** (`lib/acceptance-adr0079-tier3-checks.sh:127/:134`)
and Part C measured N=6 passing only 3/4 — **the check passes ~75 % on the _broken_
code**, so the "flake" is as much a verification-design defect as a lock defect. Fix
is determinism-by-construction: K independent cold-start rounds × N=16, require K/K
perfect (at N=16 broken code loses ≥1 every round ⇒ false-green < (0.001)^K; a correct
single-flock loses zero — kernel FIFO + resync). This is why "concurrency is flaky" is
**not** a legitimate `skip_accepted` here. **Critical guardrail (Risk 1):**
`adr0095_coldstart_race.rs:131-143` documents that the pure-Rust retry budget
_absorbs_ the bug — so a green `cargo test` is **necessary-but-not-sufficient** and
**cannot be the release gate**; the CLI-level t3-2 is the only valid gate
(the `.jslock` doesn't exist in Rust). CICD today runs **zero** RVF checks (the 8
`v3-ci-*.yml` are AgentDB smokes); a new path-filtered `v3-ci-rvf-lock.yml` (clone of
`v3-ci-rvagent.yml:89-93`) must run both the cargo stress (fast pre-gate) and the CLI
t3-2 group (real gate). **Three probes**, each asserting the count = N:

- **P1 — concurrency:** K×N cold _and_ warm start (N=16, K≥3 CI / ≥5 release),
  break-on-shortfall + the preserved first-writer error (already in `53e9d3c`). Cold =
  find-delete `.rvf` each round (`_e2e_isolate`, `acceptance-e2e-checks.sh:53-54`,
  already cold); warm = pre-create the `.rvf` then race N writers (exercises the
  `open()`-only resync-against-committed-peer path).
- **P2 — no-lifetime-hold (the ADR-0267 guard), TWO sub-checks** because there are two
  long-lived owners: `t3-2-daemon-hold` (worker-daemon) **and** `t3-2-mcp-hold`
  (MCP-server-persistent — the path where park is the actual release mechanism, so the
  one that proves sync-park). Each: `lsof memory.rvf.lock` (and main `.rvf`) empty
  between ops/dispatches, 8 concurrent writes, owner survives, count == 8.
- **P3 — crash-recovery (separable durability dimension):** SIGKILL a writer at WAL
  window β — _between_ `appendToWal` (`rvf-backend.ts:580`, durable+fsync) and
  `compactWal` (`:586`); deterministic via the diag bracket
  `store.postAppendToWal`→`store.preCompactWal`, or a guarded `RVF_TEST_CRASH_AFTER_WAL`
  exit hook (off by default). Assert the `.wal` is durable, then a fresh peer's
  `replayWalIfPresent` (`:3083`) recovers the victim into the count; + a concurrent
  variant (N−1 clean + 1 killed, all N survive — stresses that flock-only WAL
  serialization doesn't let a peer's `compactWal` truncate eat the un-folded entry).
  This probe **confirms a reasoned-safe property, not an unknown** (rvf-integrity): the
  `.jslock` is a _live-process-only_ lock — a crashed peer's `.jslock` is already gone,
  so it never guarded a dead peer's WAL bytes; under Option A the native flock is
  released on process death (POSIX `flock` fd-close), so the next process acquires it
  and replays the same bytes — an _identical_ recovery path to today.

**Count method — `memory list` is adequate; the dual count is belt-and-suspenders, not
a hard gate.** The metric question resolved (three ways: integrity + verification
traced, DA retracted): `memory list` → `query()` → `Array.from(this.entries.values())`
(`rvf-backend.ts:736`), and `this.entries` is loaded fresh per short-lived CLI process
from the committed manifest. The vector-filtered `iter_metadata_with_vectors`
(`store.rs:2120`) is only in the _load_ path and is neutralized before the count by the
ADR-0163 recovery pass (`rvf-backend.ts:2797-2810`, which enumerates the _unfiltered_
`listMetadataIds()` and re-adds dropped entries). So on a fresh boot a count-miss is
**real durable loss** — the DA's metric-confound (its fact 2) is **retracted**, the bug
it cited is already fixed in-tree. The recovery pass is `try/catch` + silent-fallthrough
(`:2810-2816`), so as cheap insurance a fresh-process direct `listMetadataIds()` count
(`lib.rs:739` → unfiltered `iter_metadata`, `store.rs:2088`) may ride _alongside_
`memory list` to catch a silent recovery-pass throw under load — but this is
belt-and-suspenders, **not** the mandatory deconfounding gate an earlier draft made it.

Conditions: **C1** = the three probes above (P1/P2/P3), each its own `run_check_bg` id
**and** `collect_parallel` spec entry (a check missing from the spec runs but is
silently uncounted). **C2** = the new path-filtered `v3-ci-rvf-lock.yml` (clone
`v3-ci-rvagent.yml:89-93`) running cargo stress as a fast pre-gate **and**
`test-acceptance-fast.sh adr0284` as the real gate. **C3** = the ADR must state
cargo = necessary-not-sufficient (**Risk 1**: `adr0095_coldstart_race.rs:131-143` — the
pure-Rust retry budget _absorbs_ the bug; the `.jslock` doesn't exist in Rust, so a
green cargo run cannot certify its removal; the Rust test is already content-deconfounded
— `open_readonly` reopen + exact payloads `writer-1..N`, `:96`). No `skip_accepted`
(the K×N design removes the flake by construction — see the confidence coupling).
**Confidence coupling (verification, explicit):** the 0.82 holds _because_ Q1 confirmed
the serializer sound (call order proven three ways) ⇒ the K×N gate is
**deterministic-by-construction** (zero-loss event, not low-probability). Had Q1 been
only "probably sound," it would degrade to flake-rate-reduction and drop to ~0.6 with
the empirical run load-bearing. Q1 closed sound, so the strong reading stands.

**Q6 — ADR vehicle: NEW ADR-0284 (adr-governance 0.93, encoding resolved).** Not an
amendment to 0274: (a) different problem (0274 = lifetime-hold/LockHeld, _verified
fixed_; 0284 = silent-loss flake); (b) the project DCAP deliberately dropped
`amends`/`refines` (Council 414) so the choice is binary supersede-or-edit-in-place;
(c) 0284 reverses _mechanisms_ (0274's debounced park; the ADR-0095 `.jslock` design;
the 0095 init scope-down). **Encoding — resolved against the strict `adr-index`
contract (and stress-tested by the DA), reversing the expert's first instinct:** the
indexer step-7 status-consistency rule makes `supersedes:`-membership **biconditional**
with `status: superseded` (a `supersedes:` target that stays `accepted` ⇒ index build
**fails**), and there is **no typed-edge representation of _partial_ supersession** (the
graph is frontmatter-only; the indexer never reads `## Supersession scope:` prose).
Since 0284 only obsoletes _parts_ of 0095/0274 (the handle-split, the ADR-0267 fix, and
read-freshness in 0274 all survive and stay load-bearing), flipping them to
`superseded` would over-claim. ⇒ **the index-clean _and_ honest encoding:**
`supersedes: []` (empty, now and on accept); `depends-on:
[ADR-0095, ADR-0167, ADR-0202, ADR-0207, ADR-0274]` (0095/0274 stay here — 0284's
correctness rests on their surviving parts; **drop ADR-0267**, resolved tracker → prose);
record the partial override **only** via a `## Supersession scope:` subsection in 0284
**plus** a one-line `## Amendments` cross-link added to the bodies of 0095 _and_ 0274
pointing forward to 0284; **0095 and 0274 keep `status: accepted`**. This passes
`adr-review` Phase A (A3/A4/A5) _and_ `adr-index` step-7 (no `supersedes` edge ⇒ no
status obligation triggered), and the forward pointer is visible in the prior ADRs' own
bodies so it does not repeat the stale-status failure mode. (The `completed:` axis the
DA floated is **not** usable — `adr-index`'s 6-key whitelist fails loud on a 7th key;
ADR-0262 accepted it on paper but the runtime contract never adopted it — flagged as a
separate corpus gap.) **ADR-0167 is _affirmed_, not superseded** (0284 makes the flock
the _sole_ serializer; 0167 forbids _replacing_ it — opposite acts), so it stays in
`depends-on`. Add `### Consequences` + `### Confirmation` sections now (required by the
template; `### Confirmation` = the Q5 plan). Robust to the mechanism: because the
override lives in prose, narrowing it is a prose edit, not a frontmatter-graph change.

#### Top 3 risks

1. **The Rust test cannot certify this fix.** `adr0095_coldstart_race.rs:131-143` —
   the pure-Rust path's generous retry budget _absorbs_ the bug; the `.jslock` doesn't
   exist in Rust. A green `cargo test` is necessary-but-not-sufficient. **Nobody may
   treat a green Rust run as proof; the CLI-level K×N t3-2 is the sole release gate.**
2. **The success metric — challenged as confounded, then cleared (fact 2 _retracted_).**
   The DA argued the t3-2 count conflated durable loss with a vectors-visibility gap
   (`iter_metadata_with_vectors` filters `self.vectors.get(id)?`, `store.rs:2120`). On
   tracing, the DA itself **withdrew** this and three lines of evidence converge: (i)
   `memory list` reads `query()` → `this.entries` (`rvf-backend.ts:736`), not the
   filtered iterator; (ii) the filter is only in the _load_ path and is neutralized
   before the count by the ADR-0163 recovery pass (`:2797-2823`, which enumerates the
   unfiltered `listMetadataIds()` and re-adds dropped entries); (iii) the t3-2 repro
   stores _vector-bearing_ entries anyway (`store.ts:119-124`, `generateEmbedding`
   default true) which the filter never drops. So on a fresh-boot count a miss is **real
   durable loss** — the residual the gate measures is a true serialization clobber (the
   loser's `write_manifest` segments unabsorbed by the winner's `resync`), exactly what
   the single flock eliminates. **Remaining sliver, not a blocker:** the recovery pass
   is `try/catch` + silent-fallthrough (`:2810-2816`), so a direct `listMetadataIds()`
   durable count rides _alongside_ `memory list` as belt-and-suspenders (Q5 C1) to catch
   a silent recovery-pass throw under load.
3. **The init scope-down revert (`§353-372`) re-touches code that closed a _different_
   t3-2 hang** (`rvf-backend.ts:361-365`, the 2026-05-01 ADR-0095 amendment). The
   INIT-WRAP + sync-park-after-init must be verified not to reopen it — and it is only
   AB-BA-safe _because_ the `.jslock` is simultaneously removed (one lock). Partial
   application (revert the scope-down without removing the `.jslock`) would be unsafe.

#### Final recommendation — **PROCEED-WITH-CONDITIONS**

Adopt Option A's _end state_ (single native flock as sole cross-process serializer;
`.jslock` removed; synchronous envelope-boundary park; INIT-WRAP), **but re-order the
work to measure-then-delete** and gate ratification on the following, in order:

- **Step 1 — deconfound on the CURRENT (pre-delete) tree (cheap diagnostic that can
  redirect the whole fix).** Before touching the lock, run a warm + cold N=16 round
  splitting a **durable** count (`listMetadataIds()`, `lib.rs:739` → unfiltered
  `iter_metadata`, `store.rs:2088`) from the **visible** count (`memory list` →
  `query()` → `this.entries`, `rvf-backend.ts:736`). If durable = N while visible < N →
  **stop — the residual is a read-path/recovery-pass regression; fix that, not the
  lock** (Option A would treat the wrong layer). If durable < N → confirmed serialization
  loss → Option A is warranted (the expected case per Risk 2). This is a pre-code
  go/redirect gate, not just a safety net.
- **Step 2 — implement Option A** in `rvf-backend.ts` (the `§120-133` surface), keeping
  NB-poll + the 30 s timeout (no Rust change expected), with Q1/Q2 conditions
  C1 (init sync-park-after-`loadFromDisk`), C2 (envelope-duration load-test ≪ 30 s),
  C3 (keep both depth counters), and the auto-persist-timer bracketing audit. (Optional,
  in-spirit: bracket the pre-existing unguarded `delete()`/`bulkDelete()` `.wal` truncate
  in the same stroke.)
- **Step 3 — prove it** on an Option-A build: one-shot **K=10 × N=16 → 10/10**, warm +
  cold, with durable == 16 **and** visible == 16 every round; plus the two-owner
  no-hold check (worker-daemon **and** MCP-server: `lsof` lock-empty between ops, 8/8,
  survives) and one crash-recovery (window-β) pass. **Any loss ⇒ PIVOT** — residual
  native race, re-trace `resync_for_write` (`store.rs:1414-1457`) before shipping (do
  not mask).
- **Step 4 — wire the standing guard** (Q5): the three probes (P1 K×N warm+cold / P2
  daemon+MCP hold / P3 crash-recovery), each a `run_check_bg` id **and** a
  `collect_parallel` spec entry; `v3-ci-rvf-lock.yml` running cargo (necessary-not-
  sufficient pre-gate) **and** the CLI t3-2 group (real gate), path-filtered. No
  `skip_accepted`.
- **Step 5 — ratify the ADR vehicle** (Q6): keep `supersedes: []`; `depends-on:
  [ADR-0095, ADR-0167, ADR-0202, ADR-0207, ADR-0274]` (drop 0267); add the
  `## Supersession scope:` prose + `## Amendments` cross-links in 0095/0274 (both stay
  `accepted`); add `### Consequences` + `### Confirmation`.

This honours every hard constraint (flock load-bearing/ADR-0167; no broker/ADR-0207;
not lock-free; ADR-0267-safe), removes _both_ failure modes if the residual is a real
loss, ends with one lock instead of two, and refuses to delete the masking layer before
Step 1 closes the native-layer question by measurement. **What the council certifies:
no surviving structural / deadlock / metric objection to Option A's end-state (three
independent experts concur on Q1–Q3; the skeptic collapsed to ACCEPT). What it does NOT
certify: that the delete reaches 16/16 — that is the unrun experiment Steps 1+3 exist
to settle.**

## Supersession scope

Encoded as **prose, not frontmatter**: the strict `adr-index` contract requires every
`supersedes:` target to carry `status: superseded`, so `supersedes: []` stays empty and
ADR-0095/ADR-0274 remain `accepted` (Q6). On acceptance, ADR-0284 overrides — and only —
these mechanisms:
- **ADR-0274:** the debounced per-transaction park (`_scheduleNativePark`) → replaced by a
  **synchronous** envelope-boundary park. ADR-0274's read/write handle split + per-transaction
  release are **retained**.
- **ADR-0095:** the JS `.jslock` advisory-lock design (item d13 — wx-create + PID-liveness
  steal + re-entrant depth counter) and the 2026-05-01 init-scope-down → both removed; the
  native flock becomes the sole serializer. ADR-0095's load-bearing native invariants —
  **d11 (fsync-before-rename), d12 (`flock(LOCK_EX)`), d14 (`create_new` after `flock`)** —
  are **retained**.
- **ADR-0167** is **affirmed, not superseded** (it forbids *replacing* the flock; ADR-0284
  makes the flock the *sole* serializer — the opposite act); stays in `depends-on`.

## Consequences

- **Good:** one cross-process lock instead of two; AB-BA impossible by construction (Q2); the
  `.wal`/`.meta` writes become flock-serialized (closes the Part C window); fewer moving parts;
  a fair blocking flock becomes possible later.
- **Bad / residual risk:** cross-process liveness rests solely on the 30 s
  `RVF_LOCK_ACQUIRE_TIMEOUT_MS` (envelope duration must stay ≪ 30 s — Q2/C2); the init-scope-down
  revert re-touches code that closed a *different* t3-2 hang and is only AB-BA-safe *because* the
  `.jslock` is removed in the same change (Risk 3); the delete-path `.wal` truncate
  (`delete()`/`bulkDelete()`) is unbracketed **today** and stays so (parked to a separate ticket
  — pre-existing, no new exposure).
- **Neutral:** NB-poll + 30 s timeout retained as-is; **zero Rust change expected**
  (`park`/`unpark`/`resync_for_write` already exist).

## Confirmation

Per Q5 — **no `skip_accepted`**, and a green `cargo test` is **necessary-but-not-sufficient**
(the pure-Rust retry budget absorbs the bug; the `.jslock` does not exist in Rust), so the
CLI-level K×N t3-2 is the **sole release gate**:
1. **Step 1 (pre-code go/redirect gate):** deconfound durable (`nativeDb.listMetadataIds().length`)
   vs visible (`memory list`) count at N=16 (warm+cold) on the *current* tree. `durable<16` → real
   loss → proceed; `durable=16 & visible<16` → visibility regression → fix `resync_for_write`/the
   metric, **not** the lock.
2. **Prove on an Option-A build:** K=10 × N=16 → 10/10 durable **and** visible (warm+cold).
3. **Two-owner non-regression:** `lsof memory.rvf.lock` empty between ticks + 8/8 for **both** the
   worker-daemon **and** the MCP-server-persistent path (where park is load-bearing).
4. **Crash-recovery:** kill a writer in the WAL window (`rvf-backend.ts:580`→`:586`); a fresh
   process must recover it via WAL replay.
5. **CICD:** new path-filtered `v3-ci-rvf-lock.yml` running the cargo stress (fast pre-gate)
   **and** the CLI K×N t3-2 group (real gate); rewrite t3-2 from single-shot N=6 to K×N
   break-on-shortfall. Any loss on an Option-A build ⇒ trace `resync_for_write` before shipping.

### Step 1 result — GATE: GO (2026-06-01, warm-start deconfound)

Ran the deconfound on the current tree (`@sparkleideas/cli` **patch.394** = NB-poll + `.jslock`, invoked directly at `bin/cli.js` to bypass the `ruflo` wrapper's *nested* patch.395 build), warm-start, N=16, no artificial load. Sequential calibration clean (`durableDelta=16 visible=16`). Concurrent: **6/8 perfect, 2/8 real-loss** (`durableDelta=2 visible=2`; `durableDelta=1 visible=1`), **`visibility-gap=0`**. When loss fires, the durable count (`listMetadataIds` delta, read fresh via `open_readonly`) and the visible count (`memory list`) **drop together** — so it is genuine serialization write-loss (the committed manifest is missing entries), **not** the Risk-2 visibility artifact. **GATE: GO** — empirically confirms the council's analytical conclusion; the collapse proceeds to implementation. Harness: `/tmp/rvf-fix/step1-deconfound.sh` + `durable.cjs` (to be formalised into `scripts/` per Step 4/5). Note: the race needed **warm-start** to surface (no-load cold-start was 16/16 on this idle machine); artificial CPU/IO load generators were explicitly removed.

## References

- **Council transcript** (verbatim deliberation, 123 messages): [`docs/council/2026-06-01-rvf-lock-council-transcript.md`](../council/2026-06-01-rvf-lock-council-transcript.md)
- Session handover: `docs/SESSION-HANDOVER-2026-06-01-rvf-lock-CORRECTED.md`
- ADR-0274 (read/write handle split), ADR-0267 (lifetime-hold), ADR-0095 (`.jslock`
  + flock WriterLock), ADR-0167 (flock load-bearing), ADR-0207 (broker deleted).
- ruvector `adab9fc36` (revert blocking flock → NB-poll).

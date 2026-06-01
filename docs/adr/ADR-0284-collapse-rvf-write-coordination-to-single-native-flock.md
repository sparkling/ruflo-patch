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

**Q3 — ADR-0267 non-regression: SUPPORT (backend 0.9) — cleanest verdict.**
Synchronous park _cannot_ regress the lifetime-hold, because the daemon (the 0267
victim) does **not** release via park at all: it sets `setRouterPersistent(false)`
(`worker-daemon.ts:976-977`) and `withRouter` runs `_storage.shutdown()`→`close()`
per-op (`memory-router.ts:1081-1083` → `rvf-backend.ts:463-467`), which drops the
flock and _cancels_ the debounce timer. So debounce→sync-park is invisible to the
daemon path. On the persistent CLI/hook path (the only path where park _is_ the
release) sync-park is strictly tighter than the starved `setTimeout` debounce — it
removes a hold, never adds one. Condition: the daemon-hold check must assert
`lsof memory.rvf.lock` empty between ticks (folds into Q5).

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
t3-2 group (real gate). Conditions: C1 rewrite t3-2 to K×N cold-start
(N=16, K≥3 CI / 5 release) with break-on-shortfall + the preserved first-writer error
(already in `53e9d3c`); C2 add an automated daemon-scenario check (Part A recipe:
`lsof` empty + 8/8 + daemon survives — currently zero coverage); C3 the new workflow +
the ADR must state cargo = necessary-not-sufficient. Plus a crash-recovery probe
(kill a writer after `appendToWal` `:580`, before native commit; fresh process must
recover it via WAL replay — `loadFromDisk` `:3078-3086` is the cross-process recovery
bridge, _not_ vestigial).

**Q6 — ADR vehicle: NEW ADR-0284 (adr-governance 0.88).** Not an amendment to 0274:
(a) different problem (0274 = lifetime-hold/LockHeld, _verified fixed_; 0284 =
silent-loss flake); (b) the project DCAP deliberately dropped `amends`/`refines`
(Council 414) so the choice is binary supersede-or-edit-in-place; (c) 0284 reverses
_mechanisms_ (deletes 0274's debounced park; deletes the ADR-0095 `.jslock` design;
reverts the 0095 init scope-down) — supersede territory. **On acceptance** (and only
then, with the gating measurement passed): move ADR-0095 and ADR-0274 out of
`depends-on` into `supersedes`; drop ADR-0267 (resolved tracker → prose);
`depends-on: [ADR-0167, ADR-0202, ADR-0207]`. Add a `## Supersession scope:`
subsection (the DCAP partial-supersession vehicle) enumerating survives-vs-replaced —
critically, **ADR-0167 is _affirmed_, not superseded** (0284 makes the flock the
_sole_ serializer; 0167 forbids _replacing_ the flock — opposite acts). The same ADR
must not sit in both `supersedes` and `depends-on` (lint violation). Two authoring
gaps to close now: add `### Consequences` and `### Confirmation` sections (required by
the template; `### Confirmation` content is the Q5 plan). **Open authoring detail**
(adr-governance −0.12; clarification in flight): whether 0095/0274 flip to
`status: superseded` or stay `accepted` under a partial-supersession encoding — the
expert recommends leave-`accepted` (most of both survives) recorded via the scope
subsection + an `## Amendments` back-cross-link; confirm which encoding passes
`adr-review` clean before ratifying. If the chosen mechanism narrows (it should not,
per Q4), the 0095 supersede-scope shrinks accordingly.

#### Top 3 risks

1. **The Rust test cannot certify this fix.** `adr0095_coldstart_race.rs:131-143` —
   the pure-Rust path's generous retry budget _absorbs_ the bug; the `.jslock` doesn't
   exist in Rust. A green `cargo test` is necessary-but-not-sufficient. **Nobody may
   treat a green Rust run as proof; the CLI-level K×N t3-2 is the sole release gate.**
2. **Could the 11→16 residual be a visibility artifact rather than a lock bug?**
   The DA raised that the vectors-visibility gap (`rvf-backend.ts:2766-2780`;
   `iter_metadata_with_vectors` filters `self.vectors.get(id)?`, `store.rs:1825-1832`)
   touches neither lock, so deleting the `.jslock` could treat the wrong layer.
   **Largely closed for the repro workload (rvf-integrity, traced):** the t3-2 repro
   stores _vector-bearing_ entries — `repro2.sh:29` `memory store … --value` →
   `store.ts:119-124` with `generateEmbedding` defaulting true (`memory-router.ts:1178`)
   → `scorer.embed()` → `rvf.insertAsync` (`store.ts:223`) → `ingestBatch` lands the
   vector in `self.vectors` (`store.rs:507-509`). Such entries are present in
   `self.vectors` after `boot()`, so the `iter_metadata_with_vectors` filter does **not**
   drop them; the ADR-0163 gap only affects metadata-only (`ingestMetadataOnly`,
   ADR-0164 δ+) entries, and its trigger (`:2766-2780`: "adapter stores without
   embedding under concurrent load") is itself a `.jslock` failure with an
   already-shipped vectorless-recovery fix (`:2797-2822`). The repro's shortfall is
   therefore a **clobber** — the loser's `write_manifest` commits segment IDs the
   winner's `resync_for_write` didn't absorb, so the segment is absent from the
   committed manifest (lost, not invisible; no `boot()` finds it) — which is exactly
   what the single native flock eliminates. So the count is a clean loss signal for
   _this_ workload. **Residual = confirm the t3-2 _acceptance check_ stores
   vector-bearing entries on the same path (it routes through the same CLI/defaults, so
   almost certainly yes) — folded into Condition 0 as cheap insurance, no longer a
   likely halt.**
3. **The init scope-down revert (`§353-372`) re-touches code that closed a _different_
   t3-2 hang** (`rvf-backend.ts:361-365`, the 2026-05-01 ADR-0095 amendment). The
   INIT-WRAP + sync-park-after-init must be verified not to reopen it — and it is only
   AB-BA-safe _because_ the `.jslock` is simultaneously removed (one lock). Partial
   application (revert the scope-down without removing the `.jslock`) would be unsafe.

#### Final recommendation — **PROCEED-WITH-CONDITIONS**

Adopt Option A's _end state_ (single native flock as sole cross-process serializer;
`.jslock` removed; synchronous envelope-boundary park; INIT-WRAP), **but re-order the
work to measure-then-delete** and gate ratification on the following, in order:

- **Condition 0 (gating, do _before_ deleting the `.jslock`): deconfounding check.**
  The repro confound is already evidenced-against (Risk 2 — the repro stores
  vector-bearing entries that the visibility filter does not drop), so this is now
  cheap confirmation rather than a likely halt. Confirm the t3-2 _acceptance check_
  stores vector-bearing entries on the same `store.ts` path; then, as a safety net,
  split a **durable** count (manifest-level read) from the **visible** count
  (`memory list`) on a warm + cold N=16 run. If durable = 16 while visible < 16 →
  **stop — fix `resync_for_write`/the metric, not the lock** (deleting the `.jslock`
  would not help). If durable < 16 (real serialization loss — the expected case per
  Risk 2) the collapse proceeds. Pin the `memory list` → backend count call-edge
  file:line here for the record.
- **Then implement Option A** in `rvf-backend.ts` (the `§120-133` surface), keeping
  NB-poll + the 30 s timeout (no Rust change expected), with Q1/Q2 conditions
  C1 (init sync-park-after-`loadFromDisk`), C2 (envelope-duration load-test ≪ 30 s),
  C3 (keep both depth counters), and the auto-persist-timer bracketing audit.
- **Prove it** on an Option-A build with a one-shot **K=10 × N=16 → 10/10 durable**
  (warm + cold), plus the daemon-scenario `lsof`-empty + 8/8 check and the
  crash-recovery WAL-replay probe. Any loss ⇒ residual native race ⇒ trace
  `resync_for_write` before shipping (do not mask).
- **Wire the guard** (Q5): rewrite t3-2 to K×N break-on-shortfall; add the daemon +
  crash-recovery checks; add `v3-ci-rvf-lock.yml` running cargo (pre-gate) **and** CLI
  t3-2 (gate), path-filtered; state in the ADR that cargo is necessary-not-sufficient.
  No `skip_accepted`.
- **Then ratify the ADR vehicle** (Q6): flip the frontmatter to supersede the named
  parts of 0095 + 0274, add `## Supersession scope:` + `### Consequences` +
  `### Confirmation`, keep 0167 in `depends-on`.

This honours every hard constraint (flock load-bearing/ADR-0167; no broker/ADR-0207;
not lock-free; ADR-0267-safe), removes _both_ failure modes if the residual is a real
loss, ends with one lock instead of two, and refuses to delete the masking layer before
the native-layer question is closed by measurement. Confidence in the end-state design:
high (three independent experts concur on Q1–Q3). Confidence that the delete alone
reaches 16/16: deferred to Condition 0 by design — which is the point.

## References

- Session handover: `docs/SESSION-HANDOVER-2026-06-01-rvf-lock-CORRECTED.md`
- ADR-0274 (read/write handle split), ADR-0267 (lifetime-hold), ADR-0095 (`.jslock`
  + flock WriterLock), ADR-0167 (flock load-bearing), ADR-0207 (broker deleted).
- ruvector `adab9fc36` (revert blocking flock → NB-poll).

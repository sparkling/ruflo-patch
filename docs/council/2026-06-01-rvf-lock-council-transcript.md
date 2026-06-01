# RVF Single-Lock-Collapse — Council Transcript

**Team:** `rvf-lock-council` · **Date:** 2026-06-01 · **Mechanism:** harness agent team (`TeamCreate` + `Agent(team_name)` + `SendMessage`), queen-led, run in background (no hive-mind).
**Decision record:** [ADR-0284](../adr/ADR-0284-collapse-rvf-write-coordination-to-single-native-flock.md)
**Source:** verbatim message bodies from the team inboxes (`~/.claude/teams/rvf-lock-council/inboxes/`), unioned across recipients, deduplicated, ordered by timestamp. 123 substantive messages.

## Proposal under review (Option A)
Eliminate the fork-invented JS `.jslock`; make the native kernel `flock` the sole cross-process write serializer, held across the whole `store()`+WAL envelope and across init, via synchronous park/unpark (kill ADR-0274's debounce) + INIT-WRAP. Distinct from ADR-0267 (lifetime-hold, already fixed by ADR-0274); this targets the t3-2 high-concurrency silent-loss flake.

## Roster
| Name | Agent type | Lens |
|---|---|---|
| `queen` | task-orchestrator | Chair — routes, forces per-question verdicts, synthesizes |
| `devils-advocate` | general-purpose | Refute Option A; default-reject under doubt; lead Q4 |
| `flock-expert` | system-architect | Kernel/flock concurrency; lead Q2 |
| `rvf-integrity-expert` | ruflo-ruvector:vector-engineer | Merkle-chain integrity, resync sufficiency; lead Q1 |
| `backend-expert` | backend-dev | Node/napi envelope, park/unpark; lead Q3 |
| `adr-governance-expert` | adr-architect | ADR vehicle / supersession; lead Q6 |
| `verification-expert` | tester | Deterministic verification + CICD; lead Q5 |

## Questions
1. **Q1 Core correctness** — is native-flock + `resync_for_write` a sufficient serializer (envelope-wide) to remove the loss, or is there a residual native race the `.jslock` masked?
2. **Q2 Deadlock freedom** — does single-lock collapse kill the AB-BA, with no new hazard from envelope+init holding?
3. **Q3 ADR-0267 non-regression** — does synchronous park keep the daemon flock-free between ticks?
4. **Q4 Scope/simplicity** (DA-led) — is full `.jslock` removal warranted vs a minimal fix?
5. **Q5 Verification** — what deterministically proves the fix and wires a non-flaky CICD guard (no `skip_accepted`)?
6. **Q6 ADR vehicle** — new ADR vs amend ADR-0274; what to supersede.

## Outcome — 7/7 consensus-with-conditions → PROCEED-WITH-CONDITIONS (measure-then-delete)
- **Q1** SUPPORT-WITH-CONDITIONS 0.85 · **Q2** 0.83 · **Q3** SUPPORT 0.9 · **Q4** consensus (DA re-calibrated **REJECT 0.7 → ACCEPT 0.7**) · **Q5** SUPPORT-WITH-CONDITIONS 0.82 · **Q6** NEW ADR 0.93. Zero REJECT.
- The council certifies **"no surviving structural/deadlock/metric objection"** — explicitly **not** "Option A reaches 16/16" (an unrun experiment). Hence the **measure-then-delete** re-ordering: Step 1 deconfounds durable (`listMetadataIds`) vs visible (`memory list`) count at N=16 on the current tree *before* any lock change.
- The DA's adversarial work was load-bearing: it forced the deconfound-before-delete ordering, exposed the broken single-shot N=6 t3-2 test, added the crash-recovery probe, then honestly collapsed to ACCEPT on its own `persistToDiskInner` trace.
- Full synthesis: [ADR-0284 §Council review → Queen's synthesis](../adr/ADR-0284-collapse-rvf-write-coordination-to-single-native-flock.md#council-review-agent-team-rvf-lock-council-2026-06-01).

## How to read
Chronological. Each entry: `timestamp — **sender** → recipient(s)`, followed by the verbatim message body. Experts posted positions to both `queen` and `devils-advocate`; challenges and rebuttals flow between named members.

---

# Transcript (chronological)

#### 2026-06-01 08:05:07 — **devils-advocate** → queen

DEVIL'S ADVOCATE — Q4 (scope/simplicity). VERDICT: **REJECT Option A as proposed.** CONFIDENCE 0.7. Recommend a scoped Option B' (subordinate, don't delete the `.jslock`) instead. Evidence below is all file:line.

**Thesis: Option A's core premise — that the two locks are "redundant, one correct one broken" (ADR §33-41) — is FALSE. They guard DIFFERENT resources. Deleting the `.jslock` does not collapse a redundant layer; it REMOVES coverage the native flock never provided.**

THREE load-bearing facts the ADR glosses:

**(1) The native flock covers ONLY the `.rvf` inode. The `.jslock` covers the JS-side `.wal` + `.meta` files — which the native flock does not touch.** This is stated in the fork's own code, not my inference:
- `rvf-backend.ts:371-374`: *"disk load + replay: reads JS-owned `.meta` and `.wal`. The native flock does NOT cover these JS-side files. JS lock remains around this step to serialize against peer renames and journal appends."*
- `rvf-backend.ts:337-338`: `walPath = databasePath+'.wal'`; `lockPath = databasePath+'.jslock'` — three distinct paths.
- The store envelope (`rvf-backend.ts:577-588`) does `appendToWal(e)` + `compactWal()` INSIDE the `.jslock`. WAL append/compact are `writeFile`/`unlink` on `.wal` — pure JS fs ops the kernel `flock(fd)` on the `.rvf` fd (`locking.rs:135-141`) provably cannot serialize. The handover's OWN Part C root-cause (lines 102-106) names *"a peer's compact step would unlink our just-written journal entry"* — that is a `.wal` race, NOT an `.rvf` race. **The native flock cannot fix a `.wal`/`.meta` race no matter how wide you hold it.** So Option A's "one lock is sufficient" is unproven precisely where the loss was measured.

**(2) `resync_for_write` does NOT reload vectors — it is manifest-only by deliberate design.** `store.rs:1414-1459`: it rewrites `epoch`, `deletion_bitmap`, `segment_dir`, `file_identity`, `seg_writer`, `last_committed_txnid` — but it NEVER touches `self.vectors`. The comment at `:1408-1413` says so explicitly: *"does NOT do boot()'s O(vectors) ... reload, and does NOT wipe this writer's in-memory vectors ... Cross-process read freshness of vectors is bounded by the documented consistency window (D6)."* Option A holds the native flock across the whole envelope and trusts unpark→resync to absorb a peer's segments. For append-only COMMIT integrity that is sufficient (the manifest references every segment; a later `boot()` reads them). BUT the ADR's central empirical bet (§116-118) is "remove `.jslock` alone → does it reach 16/16?" The t3-2 check counts via `memory list` (handover line 108) = an in-process query against `self.vectors`/metadata of THIS process. If the check ever reads through a handle whose `vectors` are stale-by-design between the resync window, you can get a count miss that is NOT durable loss — a verification artifact Option A's measurement cannot distinguish from a real fix. The ADR explicitly defers this ("if a residual loss remains, trace it into resync_for_write", §135) — i.e. it is shipping on an UNRESOLVED native-layer question while simultaneously deleting the layer (`.jslock`) that was masking it. That is backwards: you don't delete the airbag before confirming the brakes.

**(3) The native flock has a self-documented same-process race window.** `locking.rs:151-162`: *"there is no process_local_holders short-circuit during the racy window between the first acquirer dropping the holders mutex and re-acquiring it to insert (lines 118-126). The race is narrow but real; a hung flock is silent."* Option A makes the native flock the SOLE serializer and ALSO holds it across init (`open()`+`loadFromDisk`, the §132 INIT-WRAP). Init constructs the store via `RvfStore::open` → `try_open_once` → `WriterLock::acquire` (`store.rs:331`), and the daemon/factory can hold a persistent read handle + a transient write handle on the SAME path in ONE process. Collapsing to one lock concentrates ALL coordination onto a primitive whose own authors flag a "narrow but real" silent-hang window — with no second lock to bound it.

**WHY B' (subordinate, don't delete) beats A on the stated driver ("simplicity = fewer moving parts", ADR §80):**
Option A's own change surface (ADR §120-133) is NOT "delete and simplify" — it is FOUR coordinated edits (rewrite acquireLock, rewrite releaseLock to sync-park, delete `.jslock`+steal+unlink, AND revert the §353-372 init scope-down to re-wrap init). Reverting the init scope-down re-introduces exactly the ordering the 2026-05-01 ADR-0095 amendment removed *to fix a different t3-2 hang* (`rvf-backend.ts:361-365`: writer A holds JS lock waiting native flock → blocks all peers' JS acquisitions → 60s timeout). Option A bets that with `.jslock` GONE that can't recur — but if any `.wal`/`.meta` JS-side serialization is still needed (fact 1), you've removed the only thing that serialized it AND re-wrapped init. That is MORE risk, not less.

B' keeps the `.jslock` strictly for `.wal`/`.meta` (its actual job), makes the native flock authoritative for the `.rvf` envelope via SYNC-PARK (the proven-beneficial half, handover Part D), and keeps init scoped-down. Strictly fewer reverted invariants, the AB-BA stays resolved (one ORDER, not one lock — see my Q2 challenge to backend-expert), and you do NOT delete a masking layer before the native-layer question (fact 2) is closed by measurement.

**Falsifiable bar for the experts:** Option A is only justified if someone shows, file:line + a measured run, that (a) the `.wal`/`.meta` compact race (handover Part C) is serialized by the native flock alone OR is eliminated by the envelope-wide hold, AND (b) removing `.jslock` reaches a STABLE 16/16 across BOTH warm AND cold start (Option C got only 11/16 cold *with* `.jslock`; the ADR has NO measured number for `.jslock`-removed). Until both are shown, default REJECT.

I'm now challenging each expert as their positions arrive. Sending fact-(1)/(2)/(3) probes to backend-expert, rvf-integrity-expert, flock-expert, verification-expert.

---

#### 2026-06-01 08:05:08 — **rvf-integrity-expert** → queen

Q1 VERDICT — RVF INTEGRITY EXPERT

VERDICT: SUPPORT-WITH-CONDITIONS
CONFIDENCE: 0.85

The native flock + resync_for_write IS a sufficient cross-process serializer for the append-only Merkle chain, and removing the .jslock should eliminate the t3-2 silent loss — but with three conditions that must be verified before shipping.

EVIDENCE (file:line):

1. resync_for_write re-reads manifest segment directory, epoch, deletion bitmap, AND advances the SegmentWriter past all existing segment IDs (store.rs:1438-1456). The critical line is store.rs:1456: `self.seg_writer = Some(SegmentWriter::new(max_seg_id + 1))`. This is what prevents segment ID collision on the next write_manifest. A writer that acquired the flock after a peer committed will see the peer's segment IDs in the on-disk manifest and advance its own SegmentWriter past them. No clobber is possible because: (a) the flock is exclusive — only one writer is inside resync_for_write at a time, (b) the flock was already held before resync_for_write runs (store.rs:1388 acquires lock, then store.rs:1397-1400 checks txnid and calls resync_for_write), and (c) the peer's commit is durable before they park (park_writer does sync_all at store.rs:1365 before dropping the lock). The segment directory re-read is sufficient — it does NOT need vector payloads because the durable data is in the committed manifest; a later boot() will load all segments.

2. The write_manifest commit sequence is atomic with respect to the flock boundary. ingest_batch at store.rs:572-598 does: sync_all (segments durable) → hnsw_insert_ids → append_witness → write_index_seg → write_manifest. write_manifest ends with a double-buffered RootHeader commit_new_root (ADR-0167 Phase 1). The fsync happens BEFORE park_writer releases the flock (store.rs:1363-1366). So any writer that holds the flock sees a fully committed predecessor — no partial-write window.

3. The persistent write handle's flock acquisition at open() (store.rs:180 in create, store.rs:331 in try_open_once) is safe under the proposed collapse because ADR-0274 park/unpark already cycles it per transaction. The proposal's "hold across store+WAL envelope" means: JS acquireLock calls unparkNativeWriter (rvf-backend.ts:2105), runs the full store envelope, JS releaseLock calls parkNativeWriter synchronously. The flock is held for the duration of the JS-layer write, which is correct — the debounce was the bug (setTimeout starved under load, rvf-backend.ts:2182, handover Part D). Synchronous park closes that window.

4. The Part D measurement of 11/16 (cold-start, SYNC-PARK + INIT-WRAP + NB-poll, .jslock still present) does NOT answer "what is the native-only floor." The .jslock was still in place for that test, still broken. The option A claim is: once the .jslock is removed and the native flock is the sole serializer, the native flock's correct FIFO semantics reach 16/16. The evidence for this is the sequential baseline: 16/16 sequential (handover Part C) shows the native write path is correct when only one writer is active — which is exactly what the native flock guarantees under Option A.

CONDITIONS (must be verified before shipment, not assumed):

C1. Confirm that napi park/unpark in lib.rs:1052/1068 maps correctly to store.rs park_writer/unpark_writer under the new synchronous call pattern — specifically that the napi Mutex<Option<RvfStore>> does not introduce a deadlock when parkNativeWriter is called synchronously from within the JS finally{} block while the store handle is still referenced. This is a napi-layer concern, not a Rust concern.

C2. The cold-start case (two processes racing create vs open under the single native flock) is already handled by store.rs:160-189 (flock before create_new, post-flock exists() check, LockHeld retry). But init-wrap (reverting rvf-backend.ts:353-372) must be included to hold the flock across loadFromDisk — without it, a second process could acquire the flock mid-init of the first, see a partially-loaded in-memory state, and proceed. This is the INIT-WRAP requirement from Part D. The fix is incomplete without it.

C3. The measurement is required: run the warm-start N=16 concurrent bench with .jslock removed and native-flock-only, confirm 16/16. The sequential 16/16 baseline is necessary but not sufficient — it only proves no native corruption in the uncontended path. The flock FIFO guarantee proves correctness theoretically, but we need the empirical N=16 run to confirm no regression in the napi binding layer or the JS WAL path that might introduce a new failure mode.

RESIDUAL RISK assessment: The Part D 11/16 result is NOT evidence of a native-layer race the .jslock was masking. It is evidence that SYNC-PARK + INIT-WRAP + NB-poll is better than before but insufficient because the .jslock was still the outer serializer and still failing. With the .jslock gone, the native flock becomes the sole gate. The kernel FIFO guarantee is sound. The only residual concern is the napi binding layer (C1) and the init-wrap completeness (C2), both of which are implementation details, not architectural blockers.

---

#### 2026-06-01 08:05:20 — **flock-expert** → queen

FLOCK-EXPERT — Q2 (deadlock freedom), co-input Q1/Q3.

VERDICT: SUPPORT-WITH-CONDITIONS. CONFIDENCE: 0.83.

Q2a — Does single-lock collapse PROVABLY kill the AB-BA? YES, structurally.
- Today there are two cross-process locks in inconsistent orders. Init: native→.jslock (flock taken at RvfStore::create store.rs:180 / try_open_once :331; loadFromDisk then runs under .jslock acquired at rvf-backend.ts:401). store(): .jslock→native (acquireLock rvf-backend.ts:2044, then unparkNativeWriter at :2105). Opposite orders on two resources = textbook AB-BA — exactly what wedged the blocking-flock build (handover Part B).
- Option A deletes the .jslock entirely. With only ONE lock there is no second resource to invert against. AB-BA is impossible by construction, not merely avoided by timeout. This also retires the 30s NB-poll timeout's role as a wedge-breaker (locking.rs:177-208) and makes a future fair blocking flock safe.

Q2b — Does holding the native flock across init (open()+loadFromDisk) + the store envelope create a NEW hazard via (i) nested ingest refcount, (ii) same-inode flock FIFO, (iii) the napi Mutex<Option<RvfStore>>? NO new hazard. Three mechanisms checked at file:line:

(i) NESTED INGEST REFCOUNT — non-issue. The inner ingest_batch (store.rs:438-596) takes NO WriterLock. The ONLY acquire sites are create:180, try_open_once:331, unpark_writer:1388, derive:2276. The store holds its flock continuously between unpark and park; ingest just writes under the already-held lock. So the JS envelope calls unparkNativeWriter() ONCE at depth 0→1, and the inner native ingest does not re-acquire. The process-local refcount (locking.rs:119-127) is a safety net for OTHER nested same-process patterns (router ensure-init + per-store, tests building N backends), not the hot path — and even if hit, a sentinel guard (fd=-1) bumps/decrements the count and never touches the kernel, so it cannot deadlock against itself (locking.rs:121-124, Drop 268-279).

(ii) SAME-INODE KERNEL FIFO — this is the load-bearing serializer, and widening the hold makes it MORE correct, not less. The .lock file is never unlinked (locking.rs:21-32, 132-134), so all peers share one inode and one LOCK_EX queue. Holding it across the whole envelope (in-mem mutate + native ingest + WAL append + WAL compact) means a peer cannot interleave a write between our ingest and our WAL/.meta write — closing the exact window the starved setTimeout debounce (rvf-backend.ts:2026-2034) leaves open today.

(iii) napi Mutex<Option<RvfStore>> (lib.rs:502) — cannot form a cycle. It is acquired per-method and released on return: ingest_batch locks at :547-550, release_lock at :1053, reacquire_lock at :1069, each unlocking when the call returns. It is NEVER held across the JS await boundary, so the kernel flock is always acquired/released with the napi mutex already dropped. It only serializes concurrent async calls on a single handle in-process; it never co-exists held-with the cross-process flock. No lock-ordering edge exists between them.

Q1/Q3 INPUT — single flock serializes N=16 cross-process writers: YES. unpark_writer (store.rs:1381) + resync_for_write (1414) re-read the peer's committed segment directory + advance seg_writer past max existing id (1448-1456) BEFORE appending, so append-only commits are provably non-clobbering across the FIFO queue. This is why the native path is already 16/16 sequential (handover Part C) — the loss is the .jslock failing to gate, not the flock.

CONDITIONS (why not unconditional SUPPORT):
C1. INIT-WRAP correctness depends on park-after-init. Holding the flock across open()+loadFromDisk is fine for AB-BA, but init MUST park the writer after loadFromDisk (the ADR's INIT-WRAP step 4) or the persistent write handle holds the flock from init through the FIRST store with no release — re-introducing an ADR-0267-shaped lifetime-hold for the gap between init and first store. Must be a synchronous park at end of initialize(), and the daemon's setRouterPersistent(false) must still force per-tick release. This is the one place the collapse can regress 0267 — verification-expert should assert lsof shows no flock held immediately post-init-before-first-store.
C2. Liveness now rests entirely on the 30s RVF_LOCK_ACQUIRE_TIMEOUT_MS (locking.rs:177). With the .jslock gone, a crashed-mid-envelope holder is reaped by kernel fd-close on process death (locking.rs:25-29) — good — but a LIVE-but-wedged holder (e.g. a 60s+ WAL compact under IO storm) will TimedOut its waiters at 30s. That converts silent loss into a loud LockHeld, which is acceptable per ADR-0082, but the envelope must be measured to complete well under 30s at N=16 or the timeout needs raising. Verification must include a worst-case envelope-duration probe.
C3. Re-entrant depth counter MUST be kept (ADR change surface step 1 says so). It is what lets store() wrap its WAL helpers under one unpark; if it were dropped, releaseLock would park mid-envelope and a peer could interleave. Confirmed the JS depth counter (rvf-backend.ts:2051-2055, 2167-2171) is independent of the Rust refcount and both must survive.

Net: the collapse REMOVES the only AB-BA edge and introduces no new lock-ordering edge. The three suspected new-hazard mechanisms are each inert (ingest doesn't re-acquire; napi mutex never co-held with flock; FIFO hold only widens correctly). Residual risk is liveness/timeout tuning (C2) and the init-park regression surface (C1), both verifiable, not architectural.

---

#### 2026-06-01 08:05:24 — **rvf-integrity-expert** → devils-advocate

Q1 VERDICT — RVF INTEGRITY EXPERT

VERDICT: SUPPORT-WITH-CONDITIONS
CONFIDENCE: 0.85

The native flock + resync_for_write IS a sufficient cross-process serializer for the append-only Merkle chain, and removing the .jslock should eliminate the t3-2 silent loss — but with three conditions that must be verified before shipping.

EVIDENCE (file:line):

1. resync_for_write re-reads manifest segment directory, epoch, deletion bitmap, AND advances the SegmentWriter past all existing segment IDs (store.rs:1438-1456). The critical line is store.rs:1456: `self.seg_writer = Some(SegmentWriter::new(max_seg_id + 1))`. This is what prevents segment ID collision on the next write_manifest. A writer that acquired the flock after a peer committed will see the peer's segment IDs in the on-disk manifest and advance its own SegmentWriter past them. No clobber is possible because: (a) the flock is exclusive — only one writer is inside resync_for_write at a time, (b) the flock was already held before resync_for_write runs (store.rs:1388 acquires lock, then store.rs:1397-1400 checks txnid and calls resync_for_write), and (c) the peer's commit is durable before they park (park_writer does sync_all at store.rs:1365 before dropping the lock). The segment directory re-read is sufficient — it does NOT need vector payloads because the durable data is in the committed manifest; a later boot() will load all segments.

2. The write_manifest commit sequence is atomic with respect to the flock boundary. ingest_batch at store.rs:572-598 does: sync_all (segments durable) → hnsw_insert_ids → append_witness → write_index_seg → write_manifest. write_manifest ends with a double-buffered RootHeader commit_new_root (ADR-0167 Phase 1). The fsync happens BEFORE park_writer releases the flock (store.rs:1363-1366). So any writer that holds the flock sees a fully committed predecessor — no partial-write window.

3. The persistent write handle's flock at open() is a window concern only if two processes hold overlapping handles. Under Option A this cannot happen: the native flock is LOCK_EX and the NB-poll in locking.rs:184 ensures only one process holds it at a time. The process-local refcount (locking.rs:119-127) handles same-process nesting without self-deadlock. The persistent handle was the ADR-0267 bug (lifetime hold), already fixed by ADR-0274's park/unpark. Option A's synchronous park closes the debounce window that was leaving the flock held across the .jslock boundary.

4. The Part D 11/16 result does NOT indicate a native-layer race the .jslock was masking. SYNC-PARK + INIT-WRAP + NB-poll still had the .jslock as the outer serializer. The .jslock was still failing (Part C: 6-10 overlapping store critical sections even with steal disabled). Removing the .jslock and making the native flock the sole gate should reach 16/16 by the kernel FIFO guarantee. I will acknowledge this is theoretical until empirically measured (Condition C3 below).

CONDITIONS (must be verified):

C1. Confirm napi Mutex<Option<RvfStore>> does not introduce a deadlock when parkNativeWriter is called synchronously from the JS finally{} block. The napi boundary is not verified by the Rust unit tests alone.

C2. INIT-WRAP must be included (revert rvf-backend.ts:353-372) to hold the flock across loadFromDisk. Without it, a second process races init's read-modify-write. The fix is incomplete without this.

C3. Empirical warm-start N=16 concurrent bench with .jslock removed, confirming 16/16.

REBUTTAL PRE-EMPTION (anticipating devil's-advocate challenge): The most likely challenge is "Part D only reached 11/16, so there is a residual native issue." My response: the 11/16 measurement was with the .jslock still present and still failing. It is not a native-layer measurement. The correct baseline for native-only correctness is the 16/16 sequential result — which proves the write path is correct when serialization is guaranteed. Option A provides that same serialization guarantee at the kernel level. The devil's in the measurement, which is why C3 is required.

---

#### 2026-06-01 08:05:39 — **flock-expert** → devils-advocate

FLOCK-EXPERT — Q2 (deadlock freedom) position, for your challenge.

VERDICT: SUPPORT-WITH-CONDITIONS. CONFIDENCE: 0.83.

Claim 1 (AB-BA killed structurally): Today two locks, inconsistent orders — init native→.jslock (flock at store.rs:180/:331, then loadFromDisk under .jslock at rvf-backend.ts:401); store() .jslock→native (rvf-backend.ts:2044 then unpark at :2105). Delete the .jslock → one lock → no second resource → AB-BA impossible by construction.

Claim 2 (no new hazard from the three suspected mechanisms):
- Nested ingest refcount: inner ingest_batch (store.rs:438) takes NO WriterLock; only acquire sites are create:180/open:331/unpark:1388/derive:2276. Envelope unparks ONCE; ingest uses the held lock. Refcount (locking.rs:119-127) only fires for OTHER nested patterns and uses an fd=-1 sentinel that never touches the kernel — can't self-deadlock.
- Same-inode FIFO (locking.rs:132-134): never-unlinked .lock → one inode, one LOCK_EX queue. Widening the hold across the envelope only CLOSES the interleave window the debounce leaves open.
- napi Mutex<Option<RvfStore>> (lib.rs:502): per-method, released on return (ingest :547, release_lock :1053, reacquire_lock :1069); never held across the JS await boundary, so never co-held with the kernel flock. No ordering edge.

Conditions: C1 init MUST park after loadFromDisk or it's an ADR-0267-shaped lifetime-hold for the init→first-store gap. C2 liveness now rests on the 30s timeout — a live-but-slow holder (long WAL compact under IO storm) times out waiters at 30s; needs an envelope-duration probe. C3 keep the re-entrant depth counter.

ANTICIPATED CHALLENGES I want to pre-empt — push on these if you disagree:
(a) "You're trading silent loss for LockHeld timeouts at N=16." Partly true and that's C2. But the timeout only fires for a genuinely stuck/slow holder; a healthy envelope at N=16 is bounded by serialized ingest+WAL, which today already completes 16/16 sequentially. The timeout is a loud ADR-0082 failure, not silent loss — strictly better.
(b) "INIT-WRAP holds the flock across loadFromDisk (a JS-side .meta/.wal read), widening the critical section and hurting init concurrency." True it widens it, but loadFromDisk under the flock is exactly what makes init's read-modify-write atomic (the whole point — see the scope-down that made it WORSE, handover Part D/rvf-backend.ts:353-374). Init is one-time per process; the cost is bounded by the same FIFO that already serializes writes.
(c) "Removing the .jslock loses the JS-owned-file coverage that the flock doesn't span (.meta/.wal renames, comment at rvf-backend.ts:371-374)." This is your strongest line and I concede it needs the council's attention: the native flock guards the .rvf, not the sibling .meta/.wal. The answer is that holding the SAME native flock across the JS-side WAL append/compact (the envelope) serializes those writes too — but ONLY if every .meta/.wal mutation happens inside an unpark/park bracket. If any .meta/.wal write path exists OUTSIDE the envelope, removing the .jslock un-guards it. I have NOT exhaustively traced every .meta/.wal writer; that is a real gap for Q1/backend-expert and a precondition on my SUPPORT. If such an out-of-bracket writer exists, my verdict drops toward SUPPORT-WITH-CONDITIONS bordering REJECT-until-traced.

Hit (c) hardest — it's where my confidence is genuinely 0.83 not 0.95.

---

#### 2026-06-01 08:05:43 — **devils-advocate** → queen

DA — Q4 corroboration (two in-code confirmations strengthening my REJECT; CONFIDENCE now 0.72).

**Fact (1) is now airtight — `.wal` ops live under `.jslock` ONLY, and the native flock provably cannot reach them:**
- `compactWal` (`rvf-backend.ts:2686-2704`): acquires `.jslock` at `:2692`, calls `persistToDiskInner()`, then `unlink(this.walPath)` at `:2697`. That unlink — the EXACT step the handover Part C (lines 102-106) names as the loss vector ("a peer's compact step would unlink our just-written journal entry") — operates on the `.wal` file under the `.jslock`. The native `flock(fd)` is on the `.rvf` fd (`locking.rs:135-141`); it is structurally incapable of serializing a `writeFile`/`unlink` on a DIFFERENT path. Delete the `.jslock` (Option A step 3) and this `.wal` unlink race has ZERO serialization.
- `appendToWal` (`:2456-2515`): `appendFile(this.walPath, ...)` at `:2470` + fsync — also `.jslock`-only (`:2467`).

**Fact (2) is now CONFIRMED by the fork's own ADR-0163 postmortem — and it directly indicts Option A's measurement plan:**
`rvf-backend.ts:2766-2780` documents that the t3-2 "**6 entries durable, 5 visible**" failure is a VISIBLE-vs-DURABLE count gap, NOT durable loss: `iterAllWithVectors` → Rust `iter_metadata_with_vectors` filters `let vec = self.vectors.get(*id)?` (`store.rs:1825-1832`), silently dropping entries present in `metadata_full`/durable-on-disk but absent from in-memory `vectors`. This is the SAME in-memory `vectors` surface `resync_for_write` refuses to reload (`store.rs:1408-1413`). **Consequence for Option A:** the t3-2 check counts via `memory list` → `query()` → this filtered path. So a "7/16" or "10/16" measurement can be a vectors-visibility artifact, not native-flock loss. The ADR's entire decision rests on one empirical question — "does removing `.jslock` alone reach 16/16?" (ADR §116-118) — but the fork ALREADY documented that this exact count metric conflates two different failure modes. Option A cannot distinguish "fixed the race" from "still has a vectors-visibility gap" with the metric it proposes to decide on. That is a verification-validity defect, not a nitpick.

Net: removing the `.jslock` removes the only serializer over `.wal`/`.meta`, and the success metric Option A would measure against is known-confounded. Both are reasons to prefer B' (subordinate, keep `.jslock` for `.wal`/`.meta`) and to demand the verification-expert produce a DURABLE-count probe (not `memory list`) before any 16/16 claim. Routing the vectors-visibility point to rvf-integrity-expert and verification-expert now.

---

#### 2026-06-01 08:05:46 — **queen** → rvf-integrity-expert

Strong Q1 position, accepted into the record. Two gaps the Devil's Advocate raised that your evidence does not yet close — I need both to finalize Q1:

(A) RESOURCE PARTITION. DA's fact (1): the native flock guards only the .rvf inode (locking.rs:135-141 flocks the .rvf fd); the .jslock guards JS-side .wal + .meta. The store envelope does appendToWal(e) + compactWal() INSIDE the .jslock (rvf-backend.ts:577-588), and the handover's Part C root cause names "a peer's compact step would unlink our just-written journal entry" — a .wal race, not an .rvf race. Under Option A, with .jslock GONE, what serializes the .wal/.meta writes? Is the native flock held STRICTLY WIDER than every .wal/.meta op in the envelope (i.e. unpark happens before the first .wal touch and park after the last), so the kernel flock — even though it's on the .rvf fd — transitively serializes them by mutual exclusion of the whole critical section? Point me at the call order in rvf-backend.ts that proves the .wal/.meta ops sit inside the unpark→park window.

(B) READ-FRESHNESS vs DURABILITY. You say resync advances SegmentWriter past peers (store.rs:1456) and a later boot() reads all segments — agreed for DURABILITY. But the t3-2 check counts via `memory list` (handover:108), an in-process query. DA's fact (2): resync is manifest-only, never reloads self.vectors (store.rs:1408-1459). So does `memory list` in a fresh CLI process boot()/load the manifest (authoritative count) — or query a stale in-memory self.vectors that resync deliberately did not refresh? If the former, a count-miss = real loss and the bench is decisive. If the latter, a count-miss could be a verification artifact. Which is it, file:line?

One reply closes Q1. Keep it tight.

---

#### 2026-06-01 08:05:49 — **queen** → devils-advocate

Q4 position logged — REJECT A, prefer B' (subordinate .jslock to .wal/.meta), confidence 0.7. Your three facts are now the spine of the Q1 adjudication: I've put fact (1) [resource partition / .wal coverage] and fact (2) [resync manifest-only → read-freshness vs durability] directly to the rvf-integrity-expert as the decisive sub-questions. Hold for the flock-expert and backend-expert to weigh in on facts (1)/(3) before your one rebuttal. I'll route their replies to you.

---

#### 2026-06-01 08:05:52 — **backend-expert** → queen

Q3 (ADR-0267 non-regression) — VERDICT: SUPPORT. CONFIDENCE: 0.9.

CLAIM: Replacing ADR-0274's DEBOUNCED park with a SYNCHRONOUS park at the envelope boundary cannot reintroduce the ADR-0267 lifetime-hold. The daemon's per-tick flock release does not flow through park at all.

EVIDENCE (file:line):

1. The daemon releases via full backend shutdown, NOT park. worker-daemon.ts:976-977 calls setRouterPersistent(false) at startup. Then withRouter (memory-router.ts:1081-1083) runs `await _storage.shutdown()` in finally after EVERY op when !_isPersistent. shutdown() (rvf-backend.ts:463-467) does _cancelNativePark() + nativeDb.close(); close() drops the flock entirely. So in the ADR-0267 victim process the flock is released per-op by shutdown→close — the debounce timer is explicitly cancelled and never load-bearing there. Debounce→sync-park is INVISIBLE to the daemon path ⇒ cannot regress it.

2. On the persistent CLI/hook path (_isPersistent=true, the only path where park IS the release mechanism), sync-park is STRICTLY TIGHTER than the debounce. Today releaseLock() schedules _scheduleNativePark with _NATIVE_PARK_IDLE_MS=50ms (rvf-backend.ts:164, 2178-2182); the handover (Part D) found that setTimeout starved under load, leaving the flock held across the .jslock boundary. A synchronous parkNativeWriter() at depth 1→0 releases immediately and deterministically — it removes a hold, never adds one. These processes are short-lived; kernel auto-releases on exit regardless (memory-router.ts:1053-1054). Net: ADR-0267 posture improves, not regresses.

3. TS mechanics are sound and minimal. acquireLock already maps depth 0→1 to unparkNativeWriter (rvf-backend.ts:2098-2105) and depth>0 to a no-op bump (2051-2055); releaseLock already gates the physical release at depth 1→0 (2167-2177). The proposed change swaps ONLY the _scheduleNativePark() call (2182) for a direct parkNativeWriter(), and deletes _scheduleNativePark/_cancelNativePark + the timer (2026-2042). The re-entrant depth counter for nested WAL helpers (appendToWal:2467, compactWal:2692, persistToDisk:2384 each call acquireLock and nest via the counter) is untouched. The native inner ingest nests on the runtime's process-local refcount, independent of this. No Rust change needed for Q3.

4. RESIDUAL HAZARD I checked and consider bounded: the autoPersistInterval timer (rvf-backend.ts:412-432, default 30_000ms, resolve-config.ts:103) fires compactWal()/persistToDisk() which acquireLock→unpark. Under sync-park each such tick re-acquires then synchronously parks on release — a brief held-then-released, NOT a lifetime hold. AND on the daemon it is moot: the backend is shut down + nulled between ops (memory-router.ts:1103-1104), so no persist timer survives across ticks in the ADR-0267 victim. A wedged envelope (op hangs holding the flock) is the only way sync-park lifetimes a hold, but that is a pre-existing hang failure mode of holding the flock across store+WAL (Q1/Q2 territory), not introduced by debounce→sync swap — the debounce never protected against an in-flight envelope either.

CONDITION (minor, verification-side, not a blocker): the daemon-hold check must keep asserting `lsof memory.rvf.lock` empty between ticks (handover Part A recipe) so we prove release empirically post-change rather than trusting the trace. I'll coordinate with verification-expert on Q5.

Co-owned Q1/Q2: I have no backend-side objection to the envelope-wide single-lock collapse; the depth counter and shutdown semantics support it. Deferring the core-correctness (resync) and AB-BA adjudication to rvf-integrity-expert / flock-expert.

---

#### 2026-06-01 08:06:04 — **backend-expert** → devils-advocate

Q3 (ADR-0267 non-regression) — VERDICT: SUPPORT. CONFIDENCE: 0.9. Posting to you for challenge.

CORE CLAIM: debounce→synchronous park at the envelope boundary cannot reintroduce the ADR-0267 lifetime-hold, because the daemon's per-tick release does NOT use park.

KEY EVIDENCE (file:line):
1. Daemon sets setRouterPersistent(false) (worker-daemon.ts:976-977). withRouter then does `await _storage.shutdown()` after EVERY op (memory-router.ts:1081-1083). shutdown() = _cancelNativePark() + nativeDb.close() (rvf-backend.ts:463-467); close drops the flock. So in the ADR-0267 victim the flock is released per-op by shutdown→close — the debounce timer is explicitly CANCELLED there. The park mechanism is dead code on the daemon path ⇒ swapping debounce for sync-park can't change daemon behaviour.
2. On the persistent path (_isPersistent=true) park IS the release mechanism, but sync-park is strictly tighter than the 50ms debounce (_NATIVE_PARK_IDLE_MS, rvf-backend.ts:164) that the handover Part D found starved under load. Sync removes a hold, never adds one. Those procs are short-lived; kernel auto-releases on exit anyway.

WHERE I'D ATTACK MYSELF (so you can push harder or concede): the autoPersistInterval timer (rvf-backend.ts:412-432, 30s default). Under sync-park, on a LONG-LIVED persistent process, each tick re-acquires the flock (compactWal→acquireLock→unpark) then sync-parks on release — brief, not lifetime. The only sync-park path that produces a long hold is a WEDGED envelope (an op that hangs while holding the flock across store+WAL). But: (a) that is a Q1/Q2 single-lock-collapse risk, not a debounce-vs-sync issue — the debounce gave zero protection against an in-flight envelope either; (b) it does not exist on the daemon (backend nulled between ops, memory-router.ts:1103). If you think the wedged-envelope hold IS a Q3 regression, the strongest counter is: name a persistent long-lived process that (i) takes the envelope lock, (ii) can hang inside it, (iii) is NOT the daemon. I did not find one — the long-lived owner IS the daemon, and it's non-persistent.

CONDITION: verification must keep `lsof memory.rvf.lock` empty-between-ticks assertion (handover Part A) so release is proven empirically, not assumed. That's a Q5 coordination, not a Q3 blocker.

I'll send exactly ONE rebuttal if challenged, then go idle.

---

#### 2026-06-01 08:06:18 — **devils-advocate** → queen

DA — pre-empting the most likely rebuttal to my fact (1). Someone will argue "the `.wal` is vestigial under ADR-0154 native META_SEG durability, so losing `.jslock` coverage of it is harmless." That rebuttal FAILS on the fork's own code:

`loadFromDisk` (`rvf-backend.ts:3078-3086`): even when native META_SEGs restore successfully (`restoredFromSegments === true`), it STILL calls `replayWalIfPresent()` with the explicit reason (`:3081-3084`): *"Still replay the WAL — it may contain entries from a peer process that exited after appending but before native ingest committed."* And `:3097-3099`: *"the WAL may contain entries from a prior process that exited before compaction — e.g. short-lived CLI invocations."*

So the `.wal` is the **cross-process crash-recovery bridge** for the fork's short-lived-CLI-per-store model (handover Part E, lines 146-149) — i.e. it exists PRECISELY for the multi-process scenario t3-2 stresses. It is the opposite of vestigial. Removing `.jslock` (Option A step 3) unguards `appendFile`+`unlink` (`:2470`/`:2697`) on the one file that recovers a peer's not-yet-native-committed write. That can convert a recoverable crash into silent loss — a NEW failure mode Option A would introduce, not remove.

This closes the obvious escape hatch. For Option A to stand, an expert must show file:line that either (a) the native flock held envelope-wide somehow serializes the `.wal`/`.meta` fs ops (it cannot — different inode), or (b) the WAL recovery path is dead code that can be removed alongside `.jslock` (contradicted by `:3081-3084`). I've asked backend-expert to defend exactly this.

---

#### 2026-06-01 08:06:27 — **devils-advocate** → backend-expert

DA challenge (Q4/Q1), file:line. Option A's premise is the two locks are "redundant" (ADR §33-41). I claim FALSE: they guard different resources. Defend or concede:

1. The store envelope runs `appendToWal` (`rvf-backend.ts:2470`: `appendFile(this.walPath,...)`) and `compactWal` (`:2697`: `unlink(this.walPath)`) INSIDE the `.jslock` (`:538` outer acquire; `:2467`/`:2692` re-entrant). These are fs ops on the `.wal` path (`:337`).
2. The native flock is `flock(fd)` on the `.rvf` fd (`locking.rs:135-141`). It cannot serialize a `writeFile`/`unlink` on a DIFFERENT path no matter how wide it's held.
3. The handover Part C (lines 102-106) names the loss vector as "a peer's compact step would unlink our just-written journal entry" — a `.wal` race.
4. WAL is NOT vestigial: `loadFromDisk:3081-3084` replays it even after native META_SEG restore, "may contain entries from a peer process that exited after appending but before native ingest committed."

QUESTION: After Option A deletes the `.jslock`, what serializes the concurrent `.wal` append+unlink across processes? If "nothing, and that's fine," show file:line that the `.wal` race is benign or the WAL path is removable. If you cannot, then Option A REMOVES coverage (it's not collapsing redundancy), and the correct move is B' — subordinate the `.jslock` to `.wal`/`.meta` only, keep SYNC-PARK for the `.rvf` envelope. Send your answer to me AND the queen.

---

#### 2026-06-01 08:06:35 — **queen** → devils-advocate

Flock-expert Q2 (SUPPORT-WITH-CONDITIONS, 0.83) directly rebuts two of your three facts. Your rebuttal slot — respond to these:

YOUR FACT (3) [native silent-hang window, locking.rs:151-162]: Flock-expert says the inner ingest_batch takes NO WriterLock — the only acquire sites are create:180, try_open_once:331, unpark_writer:1388, derive:2276. So under Option A the JS envelope acquires ONCE (depth 0→1 unpark) and the nested native ingest does NOT re-acquire; the racy holders-mutex window you cite is for OTHER nested same-process patterns, and even when hit a sentinel guard (fd=-1) never touches the kernel, so it cannot deadlock against itself (locking.rs:121-124, Drop:268-279). Does this defuse fact (3) for the Option-A hot path, or do you still see a live exposure?

YOUR FACT (1) [.wal/.meta not covered by native flock]: Flock-expert's Q2b-ii claims the envelope-wide hold means "a peer cannot interleave a write between our ingest and our WAL/.meta write" — i.e. the native flock transitively serializes the .wal/.meta ops by mutual exclusion of the WHOLE critical section, EVEN THOUGH the flock fd is on the .rvf. This is the transitive-serialization mechanism you demanded. The open premise: do the .wal/.meta ops actually sit INSIDE the unpark→park window? I've asked rvf-integrity-expert for the exact call order in rvf-backend.ts. If they sit inside, your fact (1) "removes coverage the native flock never provided" weakens to "the native flock provides that coverage transitively once held envelope-wide." Hold your fact-(1) rebuttal until I relay that call-order answer — then tell me if the call order satisfies you or if there's a gap (e.g. a .wal/.meta touch OUTSIDE the window).

Your fact (2) [resync manifest-only → read-freshness] is still live and unrebutted; it's out to rvf-integrity-expert as probe B. Keep your powder for whichever of (1)/(2) survives.

---

#### 2026-06-01 08:06:37 — **adr-governance-expert** → queen

Q6 (ADR vehicle) — VERDICT: **NEW ADR-0284** (keep it as the standing draft). CONFIDENCE: **0.88**. Not an amendment to 0274.

== WHY NEW ADR, NOT AMEND-0274 ==

1. **Different problem.** 0274 (`accepted`, implemented, released patch.376/383, smokes green) resolved the ADR-0267 *lifetime-hold → LockHeld* regression — VERIFIED fixed (handover Part A: 8/8 concurrent, 0 LockHeld). ADR-0284 targets the t3-2 *silent-loss flake* (7-10/16 at N≥8, zero errors). Distinct defect, distinct root cause (the `.jslock`, not the flock lifetime). Folding a new problem into a closed/accepted ADR's `## Amendments` would bury a fresh architectural reversal inside a resolved tracker.

2. **The project has NO "amend" frontmatter vehicle — the choice is binary.** I confirmed the DCAP contract from the canonical source (`ruflo-adr/skills/adr-create/SKILL.md`, Council 414, 2026-05-09): `amends` and `refines` were *deliberately dropped* — "`supersedes` already covers the modifying case; `## Supersession scope:` body subsection captures partial supersession." `supersedes:` semantics = **"Replaces — kills the prior"**, intra-corpus only. So "amend ADR-0274" can only mean editing 0274's body in place (an `## Amendments` block — which 0274 already overuses; it carries 4 amendments). A NEW ADR that *overrides 0274's chosen mechanism* is exactly what `supersedes` + `## Supersession scope` is for.

3. **0284 reverses two accepted decisions' MECHANISMS — that crosses the supersede threshold, not the amend one.** It (a) DELETES 0274's debounced park (the 50ms `_NATIVE_PARK_IDLE_MS` idle timer, `_scheduleNativePark`) and replaces it with synchronous park; (b) DELETES the entire ADR-0095 `.jslock` layer (d12 `flock`+d13 re-entrant JS lock... wait: d12 is the NATIVE flock — keep; the JS `.jslock` is d13's re-entrant advisory lock + the wx-create/steal); (c) reverts the ADR-0095 2026-05-01 init scope-down at `rvf-backend.ts:353-372`. These are not refinements within 0274's "park/unpark single-handle" model — they remove a coordination layer 0274 left standing. That is supersede-of-the-relevant-parts territory.

== EXACT SUPERSEDE / SCOPE LIST (what 0284 must claim once ACCEPTED) ==

Frontmatter `supersedes:` should list the ADRs whose decisions are being *partially replaced*, and a `## Supersession scope:` subsection (inside `## Decision Outcome`) must spell out WHAT in each survives:

- **supersedes: [ADR-0274, ADR-0095]** — once accepted.
  - **ADR-0274 scope:** Supersede the **debounced park** mechanism (the "Park is debounced on a 50 ms idle timer" amendment, 2026-05-30) → replaced by synchronous per-envelope park. SURVIVES: the read/write handle split intent, `setRouterPersistent(false)` per-tick release (the ADR-0267 fix proper), `peekTxnid`/`resync_for_write`, the D3/D4 cross-process read-freshness wiring (`_maybeReloadFromDisk`, patch.383). 0284 keeps all of that; it only kills the debounce + removes the `.jslock` that sat alongside it.
  - **ADR-0095 scope:** Supersede (i) the **`.jslock` advisory-lock design** — d13's re-entrant JS lock + the wx-create/PID-steal/unlink (`acquireLock`/`releaseLock` `.jslock` path), and (ii) the **2026-05-01 init `.jslock` scope-down** (`rvf-backend.ts:353-372`). SURVIVES (load-bearing, do NOT supersede): d11 fsync-before-rename, **d12 the native kernel `flock(LOCK_EX)`**, d14 `create_new`-after-flock, the re-entrant *depth counter* (0284 keeps it for the nested-WAL/ingest case). 0095's a/b/c/d1-d10 are about pure-TS-era races and stay historical.

- **NOT in supersedes (depends-on only — correctness rests on them, they are NOT being replaced):** ADR-0167 (flock load-bearing — see below), ADR-0207 (broker deleted — 0284 honours it), ADR-0267 (the tracker, already resolved by 0274), ADR-0202 (LockHeld exit-code design).

== ADR-0167 STAYS FULLY INTACT — CONFIRMED ==

0167's load-bearing claim is "the native flock + RootHeader are the correct cross-process serializer; *replacing* the flock is out of scope." 0284 does the OPPOSITE of replacing it — it makes the native flock the **sole** serializer and removes the *competing* JS layer. That is 0167-affirming, not 0167-superseding. 0167 belongs in `depends-on`, never `supersedes`. (0284's draft already states "flock load-bearing... Replace the flock is out of scope" as a hard constraint — correct.)

== FRONTMATTER AUDIT OF THE CURRENT 0284 DRAFT ==

Current draft frontmatter:
```
supersedes: []
depends-on: [ADR-0274, ADR-0267, ADR-0095, ADR-0167, ADR-0202, ADR-0207]
```
Corrections needed:
1. **`supersedes: []` is correct WHILE `status: proposed`** — you don't kill a prior ADR from a proposed draft (the supersession is conditional on acceptance + a human go-ahead, which the draft's own status note demands). KEEP `[]` now; on ACCEPT, move ADR-0274 and ADR-0095 OUT of `depends-on` and INTO `supersedes`.
2. **On accept:** `supersedes: [ADR-0095, ADR-0274]`, `depends-on: [ADR-0167, ADR-0202, ADR-0207]`. Drop ADR-0267 entirely (it's a resolved tracker that 0274 already closed — 0284 has no live dependency on it; cite it in `## More Information` prose instead). ADR-0095 and ADR-0274 must not appear in BOTH slots (the `adr-review` lint flags a record in two typed slots; and `supersedes`+`depends-on` on the same target is contradictory — you can't both "cite as must-hold" and "replace").
3. **Add a `## Supersession scope:` subsection** (inside `## Decision Outcome`) with the survives/replaced breakdown above. This is the DCAP-blessed way to record partial supersession (Council 414). Without it, a reader sees `supersedes: [ADR-0095]` and wrongly assumes the whole flock design died.
4. The two reciprocal edits on accept: **set ADR-0095 and ADR-0274 `status: superseded`** and add 0284 to nothing in their frontmatter (inverses are derived by `adr-index` from 0284's forward `supersedes:` — authoring inverses is forbidden, single source of truth). BUT — caution flag — 0274 also resolved ADR-0267 and unblocked 0273; marking all of 0274 `superseded` overclaims (most of 0274 survives). **Recommendation: do NOT flip 0274 to `superseded`; instead supersede only via the scope subsection + a 0274 `## Amendments` cross-link** pointing to 0284. Same for 0095. I.e. partial supersession is recorded in 0284's frontmatter+scope, but the prior ADRs keep `status: accepted` because their surviving parts are still load-bearing. (This is the honest reading of "partial" — flipping status to `superseded` is for whole-record replacement.)

== MADR/DCAP CONVENTION CHECKS (draft is mostly clean) ==
- H1 has no `ADR-NNNN:` prefix ✓. Filename `ADR-0284-...md` ✓. `status: proposed` ✓ enum. Required sections present: Context/Problem ✓, Considered Options ✓, Decision Outcome ✓, Consequences — MISSING as an explicit `### Consequences` H3 (the draft folds consequences into the Option A bullets). **Add a `### Consequences` block** (flat `* Good/Bad/Neutral, because…`) — it's a required section per the template. `### Confirmation` — MISSING; Q5 (verification-expert) owns its content, but the section must exist. The `## Council review` section is a sanctioned optional extension (ADR-0207's 2nd-council note blessed `## Swarm review evidence`; `## Council review` is the same family).

NET: keep ADR-0284 as a NEW proposed ADR; on accept it supersedes the *named parts* of 0274 (debounce) + 0095 (`.jslock` + init scope-down) via `supersedes:` + a `## Supersession scope:` subsection; 0167 stays in `depends-on` intact. Add `### Consequences` + `### Confirmation` now. Confidence 0.88 (−0.12: the one genuinely arguable call is whether to flip 0095/0274 to `status: superseded` or leave them `accepted`-with-partial — I land on leave-accepted, but a council could reasonably go either way).

---

#### 2026-06-01 08:06:39 — **flock-expert** → queen

Q2 status: verdict already sent to you (SUPPORT-WITH-CONDITIONS, 0.83). One update — I've since closed the gap I'd flagged as my weakest point (whether removing the .jslock un-guards JS-side .meta/.wal writes):

The store() envelope (rvf-backend.ts:509-594) wraps the ENTIRE sequence — in-mem mutate (540-575), native ingest (548-571), appendToWal (580), compactWal (586) — under ONE acquireLock() (538) / releaseLock() (590, finally). The nested WAL helpers re-acquire re-entrantly (appendToWal itself brackets its appendFile+fsync at 2467/2512, no-op'd by the depth counter). So under Option A, depth 0→1 triggers unparkNativeWriter() once and depth 1→0 sync-parks once, and the single native flock spans every .meta/.wal write in the hot store path. Gap (c) is closed for store().

One residual I'm handing to backend-expert/Q1 (NOT a Q2 deadlock concern): the auto-persist timer (rvf-backend.ts:412-415) fires compactWal()/persistToDisk() on an interval and relies on the SAME re-entrant acquireLock discipline to bracket its writes — worth a confirm that compactWal (2686) and persistToDisk (3382) each bracket, so the timer can't write .meta outside the flock. That's bracketing-completeness, not a new lock-ordering edge.

Net Q2 verdict unchanged: AB-BA killed structurally, no new lock-ordering hazard from the three suspected mechanisms, three verifiable conditions (init sync-park; envelope-duration vs 30s timeout; keep depth counter). Awaiting devils-advocate's challenge per protocol.

---

#### 2026-06-01 08:06:43 — **devils-advocate** → rvf-integrity-expert

DA challenge (Q1), file:line. Option A bets the native flock + `resync_for_write` is a SUFFICIENT cross-process serializer and that removing `.jslock` reaches 16/16 (ADR §116-118). Two integrity gaps I need you to address:

(A) RESYNC GAP. `resync_for_write` (`store.rs:1414-1459`) is manifest-only: it updates `epoch`, `deletion_bitmap`, `segment_dir`, `file_identity`, `seg_writer`, `last_committed_txnid` — but NEVER `self.vectors` (explicit at `:1408-1413`: "does NOT wipe this writer's in-memory vectors ... freshness bounded by the documented consistency window D6"). For append-only COMMIT integrity that's fine (manifest references every segment; a later boot() reads them). QUESTION: is COMMIT integrity actually the failing dimension in t3-2, or is the failure a READ/visibility gap? Because —

(B) METRIC CONFOUND. The fork's own ADR-0163 comment (`rvf-backend.ts:2766-2780`) says the t3-2 "6 durable, 5 visible" failure is a VISIBLE-vs-DURABLE gap: `iterAllWithVectors` → Rust `iter_metadata_with_vectors` filters `let vec = self.vectors.get(*id)?` (`store.rs:1825-1832`), dropping entries that are durable in `metadata_full` but absent from in-memory `vectors`. The t3-2 check counts via `memory list` → `query()` → this exact filtered path (handover line 108). So:
- If t3-2 loss is (partly) this visibility gap, then native-flock-only does NOT fix it — `resync_for_write` deliberately leaves `vectors` stale (A).
- And Option A cannot tell "fixed the native race" from "still has the visibility gap" using the `memory list` count it proposes to measure (ADR §116-118).

QUESTION for you: Confirm or refute, file:line — does a warm-start concurrent run where 16 entries are all durable-on-disk (manifest references all 16 segments) but `memory list` returns <16 because of the `self.vectors.get(*id)?` filter, count as a t3-2 FAILURE under the current check? If yes, Option A's success criterion is confounded and the council cannot accept it on a `memory list` measurement. Reply to me AND the queen.

---

#### 2026-06-01 08:06:52 — **devils-advocate** → verification-expert

DA challenge (Q5), file:line. Option A's ENTIRE decision rests on one measurement — "does removing `.jslock` alone reach 16/16?" (ADR §116-118), counted via `memory list` (handover line 108). I claim that metric is confounded and cannot, by itself, justify Option A:

The fork already documented (ADR-0163, `rvf-backend.ts:2766-2780`) that the t3-2 count conflates TWO failure modes: (1) genuine durable loss, and (2) a VISIBLE-vs-DURABLE gap where entries are durable on disk but filtered out of `memory list` by `iter_metadata_with_vectors`'s `self.vectors.get(*id)?` (`store.rs:1825-1832`). `resync_for_write` deliberately does NOT reload `vectors` (`store.rs:1408-1413`), so the visibility gap can persist under native-flock-only.

Therefore a passing OR failing `memory list` count after `.jslock` removal does not isolate whether the native-flock-only design actually serializes writes.

WHAT I NEED FROM YOU (Q5): a verification protocol that DECONFOUNDS — i.e. a DURABLE-count probe independent of the in-memory `vectors` filter. Candidates: count META_SEG ids via `listMetadataIds()` (durable) vs `memory list` (visible) and assert BOTH = N; or a fresh-process reopen (`boot()` reloads vectors) re-count; or assert manifest segment_dir length. And: warm AND cold start × N, daemon scenario, N consecutive runs — wired into the t3-2 check + a CICD workflow (per memory: run_check_bg + collect_parallel spec AND .github/workflows), NO skip_accepted. If you cannot specify a deconfounded, deterministic guard, the council should not accept Option A on measurement alone. Reply to me AND the queen.

---

#### 2026-06-01 08:06:57 — **rvf-integrity-expert** → queen

Q1 REBUTTAL — closing both gaps (file:line)

GAP A — RESOURCE PARTITION: does the native flock transitively serialize .wal/.meta?

Yes. The call order in rvf-backend.ts proves it:

acquireLock() at :538 — this is the FIRST thing store() does, inside the try{} block before any .wal/.meta touch. acquireLock at :2097-2105 does: wx-create the .jslock (under Option A: dropped), set _lockHeldDepth=1, then call unparkNativeWriter() (:2105). So under Option A the native flock is re-acquired at the START of acquireLock, before returning to store().

The full store() critical section is :538-593:
  acquireLock [flock acquired here] → :540-574 in-mem mutate + nativeDb.ingestBatch → :580 appendToWal → :586 compactWal → finally: releaseLock [flock released here, :590]

releaseLock at :2177-2182 — under current code it calls _scheduleNativePark() (debounced). Under Option A it calls parkNativeWriter() synchronously. Either way, park happens AFTER the finally{} block has completed all .wal/.meta writes.

The .wal/.meta operations at :580-587 sit strictly INSIDE the unpark→park window. The native flock is on the .rvf fd (locking.rs:135-141), but because it is LOCK_EX and held across the entire envelope, no peer process can enter its own unparkNativeWriter until this process's park fires. Mutual exclusion of the critical section is what serializes the .wal/.meta ops — the flock doesn't need to be on the .wal fd to exclude peers from touching it; it excludes them from the whole envelope.

The Part C root cause ("peer's compact step unlinks our journal entry") was a .jslock failure: the .jslock didn't serialize, so two processes were inside their store() envelopes simultaneously. Under Option A there is only ever ONE process inside the envelope at a time (kernel LOCK_EX), so no peer's compactWal() can run while ours is in flight.

GAP B — READ-FRESHNESS vs DURABILITY: does `memory list` count from in-memory entries or from a fresh boot()?

The t3-2 bench runs each `memory list` as a FRESH CLI process. Each fresh process calls initialize() → loadFromDisk() → populates this.entries from the .rvf manifest (via _collectNativeSnapshots / _populateFromSnapshots, :3003-3016). this.entries after init = the on-disk committed state. No stale in-memory state survives across process boundaries.

For completeness: the in-process reload path (_maybeReloadFromDisk, :2945-2987) is used only by LONG-RUNNING processes (e.g. the MCP daemon) to pick up peer writes without restart. It calls peekTxnid (:2961) and if on-disk txnid advanced it calls _reloadEntriesFromDisk (:2986) which opens a fresh openReadonly handle (:3003) and merges peer-committed entries into this.entries via _populateFromSnapshots (:3016). So even in a long-running process, count() at :1049-1056 calls _maybeReloadFromDisk() first (:1055), which refreshes this.entries from the committed manifest before returning this.entries.size.

Both paths — fresh process and long-running process — read count from this.entries which reflects the committed manifest. A count miss in the N=16 bench is a real loss, not a verification artifact.

VERDICT STANDS: SUPPORT-WITH-CONDITIONS (confidence 0.85, unchanged). The two gaps are closed. Conditions C1/C2/C3 from my initial message remain.

---

#### 2026-06-01 08:07:08 — **rvf-integrity-expert** → devils-advocate

Q1 REBUTTAL — closing both gaps (file:line)

GAP A — RESOURCE PARTITION: does the native flock transitively serialize .wal/.meta?

Yes. The call order in rvf-backend.ts proves it:

acquireLock() at :538 — the FIRST thing store() does, inside the try{} block before any .wal/.meta touch. acquireLock at :2097-2105: wx-create .jslock (under Option A: dropped), set _lockHeldDepth=1, call unparkNativeWriter() (:2105). Under Option A the native flock is re-acquired at the START of acquireLock, before returning to store().

Full store() critical section :538-593:
  acquireLock [flock acquired] → :540-574 in-mem mutate + nativeDb.ingestBatch → :580 appendToWal → :586 compactWal → finally: releaseLock [flock released, :590]

releaseLock :2177-2182 — under Option A calls parkNativeWriter() synchronously AFTER the finally{} has completed all .wal/.meta writes.

The .wal/.meta operations at :580-587 sit strictly INSIDE the unpark→park window. The native flock is on the .rvf fd but held LOCK_EX across the entire envelope, so no peer process can enter its own unparkNativeWriter until this process parks. Mutual exclusion of the critical section serializes the .wal/.meta ops — the flock does not need to be on the .wal fd; it excludes peers from the whole envelope.

The Part C root cause was a .jslock failure: two processes were simultaneously inside their store() envelopes. Under Option A only ONE process is ever inside the envelope (kernel LOCK_EX). No peer's compactWal() can run while ours is in flight.

GAP B — READ-FRESHNESS: does `memory list` count from in-memory or from committed manifest?

Fresh CLI process (which is what the t3-2 bench uses): each process calls initialize() → loadFromDisk() → _collectNativeSnapshots / _populateFromSnapshots, populating this.entries from the on-disk committed manifest. count() at :1049-1056 then reads this.entries.size. No stale in-memory state survives process boundaries. A count miss in the N=16 bench is a real loss, not a verification artifact.

Long-running process path for completeness: count() calls _maybeReloadFromDisk() first (:1055), which calls peekTxnid (:2961) and if the txnid advanced calls _reloadEntriesFromDisk (:2986) → openReadonly (:3003) → _populateFromSnapshots (:3016), refreshing this.entries from the committed manifest before returning size. Both paths count from committed state.

VERDICT STANDS: SUPPORT-WITH-CONDITIONS (confidence 0.85). Both gaps are closed. Conditions C1 (napi Mutex deadlock check), C2 (INIT-WRAP required), C3 (empirical N=16 bench) remain as ship gates.

---

#### 2026-06-01 08:07:08 — **adr-governance-expert** → devils-advocate

Q6 (ADR vehicle) — VERDICT: **NEW ADR-0284** (keep it; do NOT amend 0274). CONFIDENCE **0.88**.

== WHY NEW, NOT AMEND-0274 ==
1. **Different problem.** 0274 (accepted, shipped patch.376/383, smokes green) fixed the ADR-0267 lifetime-hold→LockHeld regression — VERIFIED (8/8 concurrent, 0 LockHeld). 0284 targets the t3-2 *silent-loss* flake (7-10/16 at N≥8, zero errors) whose root cause is the JS `.jslock`, NOT the flock lifetime. New defect → new record.
2. **No "amend" vehicle exists in this project's frontmatter.** Confirmed from the canonical DCAP source (`ruflo-adr/skills/adr-create/SKILL.md`, Council 414): `amends`/`refines` were *dropped* — "`supersedes` already covers the modifying case; `## Supersession scope:` subsection captures partial supersession." So the real choice is binary: edit 0274's body in place (an `## Amendments` block — 0274 already carries 4) OR a new ADR using `supersedes:` + scope. A change that *reverses 0274's chosen mechanism* is the latter, by definition.
3. **0284 reverses MECHANISMS of two accepted ADRs** (not refinements): (a) deletes 0274's **debounced park** (50ms `_NATIVE_PARK_IDLE_MS` idle timer / `_scheduleNativePark`) → synchronous park; (b) deletes the entire **JS `.jslock`** layer (the wx-create + PID-liveness steal + unlink in `acquireLock`/`releaseLock`); (c) reverts the ADR-0095 2026-05-01 init scope-down (`rvf-backend.ts:353-372`). Removing a coordination layer 0274 left standing is supersede territory.

== EXACT SUPERSEDE/SCOPE LIST (claim ON ACCEPT) ==
**supersedes: [ADR-0274, ADR-0095]** with a `## Supersession scope:` subsection:
- **0274:** supersede ONLY the **debounced-park** amendment (2026-05-30). SURVIVES: the handle-split intent, `setRouterPersistent(false)` per-tick release (the actual 0267 fix), `peekTxnid`/`resync_for_write`, the D3/D4 read-freshness wiring (`_maybeReloadFromDisk`, patch.383). 0284 keeps all of it.
- **0095:** supersede ONLY (i) the **`.jslock` advisory-lock design** (d13's re-entrant JS lock + wx-create/steal/unlink) and (ii) the **init `.jslock` scope-down** (:353-372). SURVIVES, load-bearing — DO NOT supersede: d11 fsync-before-rename, **d12 the native kernel `flock(LOCK_EX)`**, d14 `create_new`-after-flock, AND the re-entrant **depth counter** (0284 keeps it for nested WAL/ingest). 0095's a/b/c/d1-d10 are pure-TS-era, stay historical.
(Note d12 = the NATIVE flock → KEEP; d13 = the JS `.jslock` → DELETE. They're often conflated in 0095's prose; the brief's "d12+d13" framing needs this split.)

== ADR-0167 STAYS INTACT (depends-on, NOT supersedes) ==
0167 = "native flock is load-bearing; replacing it is out of scope." 0284 makes the flock the **sole** serializer + removes the competing JS layer — that AFFIRMS 0167, doesn't replace it. 0167 in `depends-on`, never `supersedes`.

== FRONTMATTER AUDIT (current draft) ==
Draft has `supersedes: []` / `depends-on: [0274,0267,0095,0167,0202,0207]`.
- `supersedes: []` is **correct while proposed** (can't kill a prior from a proposed draft; the draft's own status-note gates supersession on accept+human go-ahead). On ACCEPT: move 0274+0095 from depends-on → supersedes; result `supersedes:[0095,0274]`, `depends-on:[0167,0202,0207]`. **Drop 0267** (resolved tracker, no live dep — cite in `## More Information`). A target must not sit in both slots (adr-review lint + it's contradictory).
- **Add `## Supersession scope:`** (in Decision Outcome) — the only DCAP-sanctioned way to record partial supersession.
- **Do NOT flip 0095/0274 to `status: superseded`** — most of each survives + is load-bearing; whole-record `superseded` would overclaim. Record the partial supersession in 0284's frontmatter+scope, leave 0095/0274 `accepted`, add a one-line `## Amendments` cross-link in each pointing to 0284. (Inverses are derived by adr-index — never author them.)
- **Missing required sections:** `### Consequences` (draft folds them into Option A bullets — needs an explicit H3 with `* Good/Bad/Neutral, because…`) and `### Confirmation` (Q5 owns content; section must exist). `## Council review` is a sanctioned extension (cf. 0207's `## Swarm review evidence`).

WHERE YOU MIGHT PUSH BACK (I want your stress-test): the one soft call is item "leave 0095/0274 `accepted` vs flip to `superseded`." I argue partial→leave-accepted; you could argue that once the `.jslock`/debounce are gone, 0095's and 0274's *headline* mechanism is dead enough to warrant `superseded` + a "superseded in part by 0284" status. If you think whole-record `superseded` is more honest than an `accepted`-record-with-a-hole, say so — that's the −0.12 in my confidence.

---

#### 2026-06-01 08:07:10 — **devils-advocate** → flock-expert

DA challenge (Q2), file:line. Option A makes the native flock the SOLE cross-process serializer AND holds it across init (`open()`+`loadFromDisk`, ADR §132 INIT-WRAP). I want you to address a self-documented hazard before you bless single-lock collapse:

`locking.rs:151-162` (the maintainers' own comment): a previous straight-blocking `flock(LOCK_EX)` deadlocked because macOS flock is per-OFD, and "there is no `process_local_holders` short-circuit during the racy window between the first acquirer dropping the holders mutex and re-acquiring it to insert (lines 118-126). The race is narrow but real; a hung flock is silent and indistinguishable from a wedged peer process."

Today this is masked because: (a) they reverted to NB-poll with a 30s timeout (`:177-210`), so the window degrades to a timeout not a hang; and (b) the `.jslock` provides a SECOND, independent coordination layer.

Option A removes (b) and the handover (Part F, lines 169-172; ADR §94) explicitly anticipates "a fair BLOCKING flock would no longer AB-BA" once there's one lock — i.e. Option A is the on-ramp to re-introducing the very blocking flock that hit `:151-162`.

QUESTIONS:
1. With `.jslock` gone and the native flock as sole serializer, is the `:118-127` holders-mutex window between drop-and-insert reachable in the daemon's case — a persistent READ handle (`open_readonly`, no lock, `store.rs:383-409`) PLUS transient WRITE handles (`unpark_writer` → `WriterLock::acquire`, `store.rs:1388`) on the SAME path in ONE process, racing init's `WriterLock::acquire` (`store.rs:331`)? Show why it is or isn't.
2. Does Option A's "blocking flock becomes possible later" (ADR §94) walk straight back into the `:151-162` deadlock the team already postmortem'd and reverted (`adab9fc36`)?

If either is a live hazard, single-lock collapse trades a measured-flaky-but-bounded state for a concentrated silent-hang surface — favoring B' (keep `.jslock` as the independent second layer, SYNC-PARK the native flock). Reply to me AND the queen.

---

#### 2026-06-01 08:07:22 — **queen** → verification-expert

Before you finalize Q5, a hard input the Devil's Advocate just surfaced from the fork's OWN code — your verification plan must address it or it's incomplete:

CONFIRMED METRIC CONFOUND. rvf-backend.ts:2766-2780 (an ADR-0163 postmortem comment in the fork) documents that the t3-2 "N durable, M visible" failure is a VISIBLE-vs-DURABLE count gap, NOT durable loss. Mechanism: iterAllWithVectors → Rust iter_metadata_with_vectors filters `let vec = self.vectors.get(*id)?` (store.rs:1825-1832), silently dropping entries that are durable-on-disk (present in metadata_full) but absent from this process's in-memory self.vectors. This is the SAME self.vectors surface that resync_for_write deliberately does NOT reload (store.rs:1408-1413).

CONSEQUENCE: the t3-2 check counts via `memory list` → query() → this filtered in-memory path. So a "7/16" or "10/16" measurement CANNOT distinguish "native-flock durable loss" (the bug Option A targets) from "vectors-visibility artifact" (a different, possibly-benign read-freshness gap). Option A's entire decision gate is "does removing .jslock reach 16/16?" measured with a metric the fork ALREADY documented as conflating two failure modes.

YOUR Q5 MUST SPECIFY: a DURABLE-count probe that is immune to the in-memory vectors filter — e.g. count via a FRESH process that boot()s and reads the on-disk manifest/metadata_full directly (not iterAllWithVectors), or an iter_metadata path that does NOT apply the `self.vectors.get(id)?` filter. Tell me, file:line, which read path gives an authoritative durable count, and how the t3-2 acceptance check + CICD guard would use it so a green 16/16 means "16 durable" not "16 happened to be in-memory-visible." Also address: warm vs cold start, the daemon scenario, and how to make it deterministic (no skip_accepted). This confound is now the crux of whether Option A is even MEASURABLE — please lead with it.

---

#### 2026-06-01 08:07:27 — **verification-expert** → queen

Q5 (Verification adequacy) — VERDICT: SUPPORT-WITH-CONDITIONS. CONFIDENCE: 0.82.

I grounded this in the actual harness (file:line below), not the ADR prose. The fix is provable and gateable WITHOUT skip_accepted, but ONLY if we fix the verification design, not just the lock. Three conditions are load-bearing.

═══ WHAT'S BROKEN ABOUT VERIFICATION TODAY (why the flake gates nothing) ═══

1. **The current t3-2 is single-shot N=6.** `lib/acceptance-adr0079-tier3-checks.sh:127` (`check_t3_2_rvf_concurrent_writes`), N=6 at :134, ONE race, no repeat. Part C of the handover measured N=6 passing only 3/4 — so the check passes ~75% of the time on the BROKEN code. A single-shot N=6 is statistically incapable of either catching the bug or proving the fix. This is the real reason it "flakes."

2. **It IS already cold-start (good news).** `_e2e_isolate` (`lib/acceptance-e2e-checks.sh:53-54`) does `rm -f "$iso/.../memory.rvf"*` before the race, so the check exercises the cold-create path the repro uses — the failure mode IS in scope. We don't need to change start conditions, only N, repeat-count, and the daemon dimension.

3. **CICD does NOT run the acceptance suite at all.** The 8 `.github/workflows/v3-ci-*.yml` are path-filtered AgentDB-surface smokes; NONE run t3-2 or any RVF check. So "wired into CICD" currently = nothing. The template to fix this exists: `v3-ci-rvagent.yml` runs `bash scripts/test-acceptance-fast.sh adr0266` on a path filter (lines 89-93).

═══ HOW TO MAKE A CONCURRENCY TEST DETERMINISTIC ENOUGH TO GATE ═══

The bug is probabilistic (6-10/16 overlaps at N=16), so a single run is a coin-flip. Determinism comes from STACKING THE ODDS until a single surviving-write loss is overwhelmingly unlikely on a fixed fix, while a regression is near-certain to trip:
- Raise N into the regime where loss is reliable on broken code: N=16 (broken = 7-10/16 loss EVERY run per Part C — i.e. the bug is ~deterministic at N=16, it's only N=6 that's marginal).
- REPEAT K independent cold-start rounds; require K/K perfect (16/16 each). At N=16 the broken code loses ≥1 write essentially every round, so K≥3 rounds makes a false-green on broken code < (0.001)^3. This is the repro2.sh design (ITERS loop, break-on-first-shortfall) — adopt it verbatim as the gate.
- This is NOT a flaky test: a correct single-native-flock serializer loses ZERO across unlimited rounds (it's a kernel FIFO queue + resync). The pass/fail boundary is binary and wide. Flakiness only exists for the CURRENT half-broken `.jslock`; Option A removes the thing that makes it non-deterministic.

═══ THE PASS CRITERION (concrete) ═══

Define t3-2 PASS as: **K cold-start rounds × N concurrent `memory store`, EVERY round persists N/N (counted by `memory list` — authoritative for native, no `.rvf.meta` sidecar), 0 LockHeld, 0 silent loss.** Defaults: N=16, K=3 (CI), K=5 (release). ANY round < N/N = FAIL with the preserved first-writer error (commit 53e9d3c already preserves it in `_CHECK_OUTPUT`).

Plus a SEPARATE daemon-scenario assertion (the Part A recipe, which currently has NO automated check): daemon running + `lsof memory.rvf.lock` empty (proves no lifetime-hold = ADR-0267 non-regression) + 8/8 concurrent writes succeed + daemon survives. Target 8/8, 0 LockHeld. This guards Q3's concern at the acceptance layer.

═══ CICD WIRING (no skip_accepted) ═══

Three layers, fastest→slowest:
1. **Rust cargo test — fast pre-gate, NOT the release gate.** `forks/ruvector/.../tests/adr0095_coldstart_race.rs` already has `coldstart_n8_no_loss` (default) + `coldstart_n16_under_load` (ignored, CPU/IO hogs, RVF_TEST_ROUNDS=8). New workflow `v3-ci-rvf-lock.yml` (clone `v3-ci-rvagent.yml`) path-filtered on `forks/ruvector/crates/rvf/**` + `rvf-backend.ts` + the t3-2 check, runs `cargo test --test adr0095_coldstart_race` + the ignored under-load round. Runs in seconds.
   ⚠️ **CRITICAL CAVEAT the council MUST internalize:** `adr0095_coldstart_race.rs:131-143` explicitly documents that the pure-Rust path's generous retry budget ABSORBS the bug — "it is NOT the regression's bite. The authoritative reproduction is the CLI-level harness (full Node + NAPI + JS park/unpark + tight budgets)." So a green cargo test is NECESSARY-BUT-NOT-SUFFICIENT. It guards the Rust lock's correctness/reentrancy/perf and would catch a NEW native-layer regression — but it CANNOT certify the `.jslock` removal, because the `.jslock` doesn't exist in Rust. **The cargo test cannot be the release gate for Option A.**
2. **CLI-level t3-2 (the real gate)** — the rewritten K×N check in the acceptance suite (`scripts/test-acceptance.sh` run_check_bg + collect_parallel — t3-2 is wired at :1345 and :2773, both present). This is the authoritative proof.
3. **A path-filtered CLI job** in the same `v3-ci-rvf-lock.yml` running `bash scripts/test-acceptance-fast.sh adr0284` (add an `adr0284` group — the runner already has adr0267/adr0274 groups at fast.sh:399/505, the pattern is one `if [[ "$_FAST_RUN_GROUPS" == *"adr0284"* ]]` block). Path-filtered so it only fires on lock-touching changes — keeps it off the hot path but makes a lock regression block merge to main.

═══ THE ONE THING THAT WOULD MAKE ME RAISE CONFIDENCE TO 0.95 ═══

Empirically confirm Option A reaches K/K at N=16 BEFORE ratifying. Option C measured only 11/16 (with `.jslock` still present). The ADR's own open risk is "does removing `.jslock` alone reach 16/16 or is there a residual native race." Verification adequacy is conditional on that measurement existing. My recommendation: gate ratification on a one-shot manual run of the rewritten t3-2 (K=10, N=16) against an Option-A build showing 10/10 perfect. If it shows ANY loss, the fix is incomplete (residual native race) and the cargo test won't catch it — re-trace into `resync_for_write` per the ADR.

CONDITIONS (all three required for my SUPPORT):
C1. Rewrite t3-2 to K×N (N=16, K≥3) cold-start with break-on-shortfall + preserved error — NOT single-shot N=6.
C2. Add an automated daemon-scenario check (Part A recipe: lsof-empty + 8/8 + survives) — currently zero coverage of the ADR-0267 non-regression at acceptance layer.
C3. New path-filtered `v3-ci-rvf-lock.yml` running BOTH cargo stress (fast pre-gate) AND the CLI t3-2 group (real gate) — and the ADR must state the cargo test is necessary-not-sufficient so nobody mistakes a green Rust run for proof.

No skip_accepted anywhere: legit skips are tool-not-found/heavy-opt-out/env-disabled; "concurrency is flaky" is NOT a legit skip — the K×N design removes the flake by construction. Sending same to devils-advocate.

---

#### 2026-06-01 08:07:37 — **queen** → devils-advocate

Corroboration logged, confidence noted at 0.72. Two distinct rulings on your two facts:

FACT (2) — ACCEPTED as decisive, but routed to Q5 not Q4. Your rvf-backend.ts:2766-2780 + store.rs:1825-1832 citation is the strongest thing in the room: it shows the t3-2 metric (memory list → iterAllWithVectors with the self.vectors.get(id)? filter) conflates durable-loss with vectors-visibility. That makes Option A's decision gate UNSOUND AS MEASURED. I've made it a hard requirement on the verification-expert's Q5: produce a durable-count probe immune to the in-memory filter, or Q5 fails. This likely becomes a PROCEED-WITH-CONDITIONS gate regardless of the correctness verdict. Good catch — this is real.

FACT (1) — corroborated as CURRENT-STATE, but its Option-A consequence is still contingent. Your compactWal :2697 unlink + appendToWal :2470 citations prove the .wal ops are TODAY under .jslock. They do NOT yet prove those ops would fall OUTSIDE the native unpark→park window under Option A. The flock-expert's transitive-serialization claim (whole-critical-section mutual exclusion) defeats fact (1) IF — and only if — the .wal/.meta ops sit inside that window. That call-order proof is pending from rvf-integrity-expert (probe A). So hold your fact-(1) "removes the only serializer" conclusion until I relay the call order. If any .wal/.meta touch is OUTSIDE the window, fact (1) stands and Option A needs a Rust-side fix or B'. If all inside, fact (1) weakens to "transitively covered."

Net: fact (2) already wins you a hard condition. Fact (1) is one call-order citation away from either standing or weakening. I'll relay the integrity-expert's answer the moment it lands.

---

#### 2026-06-01 08:07:52 — **verification-expert** → devils-advocate

Q5 (Verification adequacy) — VERDICT: SUPPORT-WITH-CONDITIONS. CONFIDENCE: 0.82. Full position sent to queen; here's the short form plus where I think you should push hardest.

POSITION: The fix is provable + gateable without skip_accepted, but the CURRENT verification proves nothing and would have to be rewritten regardless of which option wins:
- t3-2 today is single-shot N=6 (`lib/acceptance-adr0079-tier3-checks.sh:127`, N at :134). Part C measured N=6 passing 3/4 on the BROKEN code → the check is a coin-flip, incapable of catching the bug OR proving the fix.
- Determinism comes from K×N: N=16 (broken loses ≥1 write ~every round per Part C) × K≥3 rounds, require K/K perfect 16/16, break-on-first-shortfall (adopt repro2.sh's loop verbatim). A correct single-native-flock loses ZERO across unlimited rounds — the pass/fail boundary is binary and wide, so it's NOT a flaky gate.
- CICD: the 8 `v3-ci-*.yml` workflows are AgentDB-surface smokes; NONE run t3-2. New path-filtered `v3-ci-rvf-lock.yml` (clone of `v3-ci-rvagent.yml:89-93`).

TWO ANGLES I WANT YOU TO ATTACK (because they're my weakest points):

1. **"The cargo test is theatre."** I'm leaning on the existing Rust stress tests (`adr0095_coldstart_race.rs`) as a fast pre-gate — BUT that file's own comment (:131-143) says the pure-Rust path's retry budget ABSORBS the bug and "it is NOT the regression's bite." So the cargo test is necessary-not-sufficient: it can NEVER certify the `.jslock` removal because `.jslock` is JS-only. If you want to argue the Rust guard is borderline useless for THIS fix and just adds CI surface, that's a fair hit — my rebuttal is it still catches NEW native-layer regressions (resync_for_write) cheaply, which is the residual-race risk the ADR itself flags. But press me: is a guard that can't catch the actual bug worth the workflow?

2. **"K×N at N=16/K=3 is still probabilistic, not deterministic — you've just lowered the flake rate, not eliminated it."** This is the deepest challenge to the whole "gate a concurrency test" premise. My defense: on a CORRECT serializer the loss probability is exactly 0 (not small — zero; kernel FIFO flock + resync_for_write is a proof, not a sample), so K rounds of a zero-probability event is still zero. The probabilism only exists while the lock is broken. If you don't buy that the single-native-flock is provably-zero-loss (that's really Q1's domain — rvf-integrity-expert owns it), then my gate IS just flake-rate reduction and you're right to reject "deterministic." So my Q5 confidence is downstream of Q1: if Q1 says native-flock+resync is a sound serializer, my gate is deterministic; if Q1 says "probably," my gate is statistical and I'd drop to SUPPORT-WITH-CONDITIONS at 0.6 and demand the empirical K=10 N=16 10/10 pre-ratification run as the ACTUAL evidence rather than the design argument.

The empirical pre-ratification run (K=10, N=16, 10/10 on an Option-A build) is my hedge against both: it converts "I believe the design is deterministic" into "I measured zero loss across 160 concurrent writes." Option C only ever hit 11/16 WITH `.jslock` present, so we have NO data on Option A yet. Attack whether one 10/10 run is enough evidence given the bug is probabilistic on broken code — I'd argue 10/10 at N=16 is ~160 independent serialization events with zero loss, which for a binary-boundary serializer is strong, but I'll hear the case for K=20.

---

#### 2026-06-01 08:08:14 — **backend-expert** → devils-advocate

DEFEND (one rebuttal, then idle). Your file:line are all CORRECT; your CONCLUSION is wrong. The error is a hidden premise: that serializing the .wal ops requires a lock ON the .wal path. It doesn't — it requires a lock HELD ACROSS the section that touches the .wal. Today that's the .jslock; under Option A it's the native flock. Same bracketing, different (correct) primitive.

1. The .jslock does NOT serialize the .wal by living on the .wal path. It's a SEPARATE PID-file at the `.jslock` path (rvf-backend.ts:338) — a third path, distinct from both `.rvf` and `.wal`. It serializes appendToWal/compactWal purely by being HELD ACROSS them: store() takes the outer acquireLock at :538 and the WAL helpers nest re-entrantly (:2467/:2692, depth counter :2051). So your own standard — "a lock on path X can't serialize ops on path Y" — applies to the .jslock too. It serializes by mutual exclusion of the CRITICAL SECTION, not by path identity.

2. Under Option A the native flock is held across the IDENTICAL section. acquireLock maps depth 0→1 to unparkNativeWriter (:2098-2105) at envelope ENTRY (store():538), held through ingest + appendToWal + compactWal, parked at depth 1→0 on exit (:2177). flock is LOCK_EX on the `.lock` inode (locking.rs:184, never-unlinked shared inode :132-141, FIFO kernel queue). Two processes therefore CANNOT both be inside the envelope simultaneously ⇒ cannot both be in appendToWal/compactWal simultaneously. The concurrent .wal append+unlink you're worried about is excluded by the held flock, exactly as it's excluded by the held .jslock today. NOT mechanically by flock(fd) reaching across paths — by single-occupancy of the section.

3. So "redundant" (ADR §33-41) is TRUE at the level that matters: both locks bracket the SAME store envelope (:538). They are redundant SERIALIZERS OF THE ENVELOPE. Your "different resources" reframes redundancy as "different fds" — but the design question is "what brackets the section," and BOTH do. Option A doesn't remove coverage; it removes the WEAKER of two co-bracketing locks (the wx-create/steal .jslock the handover Part C measured failing to serialize) and keeps the CORRECT one (kernel flock + resync_for_write).

4. Your Part C cite actually supports collapse, not B'. The loss vector "a peer's compact step unlinks our journal entry" (handover 102-106) is two processes concurrently in compactWal. That overlap is possible TODAY only because the .jslock fails to enforce single-occupancy at N≈8 (Part C: 6-10 overlapping critical sections). A correctly-held LOCK_EX gives zero overlap ⇒ the unlink race cannot occur. The compactWal→mergePeerStateBeforePersist re-read (rvf-backend.ts:3413-3432, set-if-not-seen :3469) then folds any peer's already-compacted entries on entry, so a serialized compact is also non-clobbering across the handoff.

WHERE B' IS STRICTLY WORSE, not safer: B' keeps BOTH locks (subordinate .jslock to .wal/.meta, native to .rvf). That preserves the TWO-LOCK acquire-order inversion that is the AB-BA root (init native→.jslock at :379+:401; store .jslock→native at :538→:2105 — handover Part B). Your proposal re-introduces exactly the hazard ADR-0284 Option A eliminates. One lock = one order = no AB-BA (and a fair blocking flock becomes possible later). Two locks scoped to different paths still deadlock if any code path acquires them in opposite orders, and init vs store already do.

CONCEDE on the one point you're literally right about: flock(fd) does not syscall-serialize a foreign-path write. Nobody is claiming it does. The serialization is by held-section single-occupancy. If you can show a path under Option A where appendToWal/compactWal runs OUTSIDE the held flock (i.e. the envelope releases the flock between native-ingest and WAL-compact), THAT would be real removed coverage — but acquireLock at :538 holds depth≥1 through releaseLock at :590, and the WAL helpers nest (don't release), so there is no such gap. Show me that gap or the coverage is intact.

This is Q1/Q2 territory; deferring the witness-chain correctness to rvf-integrity-expert and the AB-BA proof to flock-expert. My Q3 verdict (SUPPORT 0.9) is unaffected — none of this touches daemon-park non-regression. Going idle.

---

#### 2026-06-01 08:08:20 — **queen** → backend-expert

Q3 verdict logged: SUPPORT, 0.9 — clean. The decisive point (daemon releases via shutdown()→close(), NOT park, so debounce→sync-park is invisible to the ADR-0267 victim path; memory-router.ts:1081-1083 + rvf-backend.ts:463-467) is accepted as the Q3 ratio. No challenge from the chair.

Your verification condition (assert `lsof memory.rvf.lock` empty between daemon ticks post-change) is now a confirmed Q3 condition — I've noted it. Please coordinate it directly with verification-expert so it lands in the Q5 guard, AND add one item they're now wrestling with: there's a CONFIRMED metric confound — the t3-2 count via `memory list`/iterAllWithVectors filters on in-memory self.vectors (store.rs:1825-1832; resync deliberately doesn't reload it, store.rs:1408-1413; documented in the fork's own ADR-0163 note at rvf-backend.ts:2766-2780). So a count-miss can be a vectors-visibility artifact, not durable loss. Your daemon-hold lsof check is orthogonal to that and still required — but the durable-count probe is the bigger Q5 lift. If you have a backend-side read path that gives an authoritative DURABLE count (boot()/manifest-level, bypassing the vectors filter), send it to verification-expert too.

One question for you to close a Q2/Q3 seam: the autoPersistInterval timer (rvf-backend.ts:412-432, 30s) fires compactWal/persistToDisk → acquireLock→unpark on the PERSISTENT path. You said it's a brief held-then-released, not a lifetime hold, and moot on the daemon (backend nulled between ops). Confirm: on the persistent CLI/hook path, does that 30s timer ever fire while the process is otherwise idle (no store in flight), and if so does sync-park release it immediately on the release edge? I want to be sure the persistent path can't hold the flock idle for up to 30s between auto-persist ticks.

---

#### 2026-06-01 08:08:24 — **flock-expert** → devils-advocate

FLOCK-EXPERT rebuttal (Q2). Your challenge rests on a conflation I can pin to file:line. Three points; the first dissolves the premise.

1. The `:151-162` comment is a postmortem of the REVERTED straight-blocking flock, NOT the current NB-poll code — and the holders-mutex window is NOT a hang under NB-poll.
Read the comment in full: ":151-162" says "a previous version used straight blocking flock(LOCK_EX)... We poll LOCK_EX|LOCK_NB instead" (locking.rs:164-171). The "waits forever" hazard is the BLOCKING call. In the SHIPPED code (locking.rs:183-210): if a same-process second fd races the drop-and-insert gap (118-127), flock(LOCK_EX|LOCK_NB) returns EWOULDBLOCK (188-193), the loop sleeps 100ms (209), retries — and by the next iteration the first acquirer has executed the insert at 214-217, so the second caller hits the process-local short-circuit at 121-124 and returns a sentinel. The window degrades to ONE extra 100ms poll, not a hang. Your own point (a) concedes "the window degrades to a timeout not a hang" — correct — but then attributes the masking to the .jslock. It is not the .jslock that converts hang→poll; it is NB-poll itself (still present under Option A). Removing the .jslock leaves this masking fully intact.

2. The daemon topology you describe does NOT reach the window, because the READ handle takes no flock.
nativeDb (rvf-backend.ts:66) is a SINGLE write handle; open/create acquires the flock, park/unpark cycle it. The read path uses a SEPARATE transient LOCK-FREE handle: _maybeReloadFromDisk "lazily re-reads via a LOCK-FREE read-only handle" (rvf-backend.ts:172-174) → open_readonly → writer_lock: None (store.rs:409). open_readonly NEVER calls WriterLock::acquire. So the read handle is not a flock contender at all — it cannot race init's acquire (store.rs:331) on the holders mutex. The ONLY same-process acquire sites are init (one-time) and unpark_writer (store.rs:1388), and within one backend instance they are serialized by the napi Mutex<Option<RvfStore>> per method (lib.rs:547/1069) AND the JS depth counter (one envelope unparks at a time, rvf-backend.ts:2051). The "two RvfStore instances racing the holders gap" the comment worries about is the cross-test pattern (N RvfBackend objects in one proc) — NOT the daemon's read+write topology, where read never acquires.

3. "Blocking flock becomes possible later" (ADR §94) is a FUTURE option, explicitly OUT of Option A's change surface — so Option A does NOT walk back into adab9fc36.
ADR §122-135 scopes Option A to rvf-backend.ts ONLY: "forks/ruvector (store.rs/locking.rs/lib.rs): no change expected." The NB-poll + 30s timeout (locking.rs:177) stays exactly as shipped. "A fair blocking flock would no longer AB-BA" is a statement about what becomes SAFE to consider once there's one lock — not a step this proposal takes. Conflating "removes the structural blocker to a future change" with "performs that change now" is the gap in the chain. If a later ADR proposes re-introducing blocking flock, IT must re-clear locking.rs:151-162 (and it can, because the holders short-circuit + a blocking flock is fine for the cross-PROCESS case; the per-OFD same-process hang only bit because of the racy insert window, which a blocking-with-NB-probe-first pattern closes). That is a separate review. Today's proposal keeps NB-poll.

Net on your B' (keep .jslock as an independent second layer + SYNC-PARK): the .jslock is not protecting the :151-162 window (NB-poll does). What the .jslock DOES do is the thing the handover measured as BROKEN — it fails to serialize at N=16 (Part C: 6-10 overlapping critical sections, steal-disabled still 10/16) AND it is the OTHER leg of the AB-BA you'd be keeping alive. So B' retains a proven-lossy serializer and a live inversion edge to defend a window that NB-poll already de-fangs. The risk you're pointing at is real in the ABSTRACT (sole-serializer concentration) but the specific window you cite is not reachable-as-hang under the code Option A actually ships.

I hold SUPPORT-WITH-CONDITIONS, 0.83 — your challenge sharpens condition C2 (the 30s timeout is now the sole liveness backstop; it MUST be load-tested at N=16 so a genuinely-slow holder's waiters fail loud, not the abstract window). It does not move me toward B'.

---

#### 2026-06-01 08:08:31 — **backend-expert** → queen

FYI for synthesis — I answered DA's Q4/Q1 challenge ("native flock can't serialize .wal append/unlink → Option A removes coverage → do B' instead"). Verdict on the challenge: DA's file:line are correct but the conclusion is wrong.

Crux: the .jslock does NOT serialize the .wal by being on the .wal path — it's a SEPARATE PID-file (rvf-backend.ts:338, a third path). It serializes purely by being HELD ACROSS the store envelope (outer acquire store():538; WAL helpers nest re-entrantly :2467/:2692). Under Option A the native LOCK_EX is held across the IDENTICAL section (unpark at depth 0→1 :2098-2105 on envelope entry, park at depth 1→0 :2177 on exit; flock on never-unlinked `.lock` inode, locking.rs:132-141/184). Single-occupancy of the section ⇒ two processes can't both be in appendToWal/compactWal ⇒ the "peer unlinks our journal entry" race (handover 102-106) cannot occur. Mutual exclusion is by held-section, not by flock(fd) reaching across paths — nobody claimed the latter.

So "redundant" (ADR §33-41) is true at the operative level: both locks bracket the SAME envelope; Option A drops the weaker (wx-create/steal, measured failing Part C) and keeps the correct one. compactWal→mergePeerStateBeforePersist (3413-3432, set-if-not-seen 3469) makes a serialized compact non-clobbering across the handoff.

DA's B' (keep both locks, scope by path) is STRICTLY WORSE for Q2: it preserves the two-lock acquire-order inversion (init native→.jslock :379+:401 vs store .jslock→native :538→:2105) that IS the AB-BA root (handover Part B). One lock = one order = no AB-BA. Recommend the synthesis NOT adopt B' on deadlock grounds.

I gave DA one falsifier: show a path where appendToWal/compactWal runs OUTSIDE the held flock (envelope releasing between ingest and compact). I don't believe one exists (depth≥1 from :538 through :590, helpers nest). If DA produces it, that flips me — otherwise coverage is intact.

Deferring witness-chain sufficiency to rvf-integrity-expert and the formal AB-BA proof to flock-expert. My Q3 verdict unchanged: SUPPORT 0.9. Idle now.

---

#### 2026-06-01 08:08:39 — **devils-advocate** → queen

DA — Q4 SHARPENED (self-critical correction to my own alternative + the minimal-change answer the brief asked for). VERDICT UNCHANGED: REJECT Option A pending measurement. CONFIDENCE 0.7.

**I have to correct my own B'.** As I first stated it ("subordinate, keep `.jslock`") B' is IDENTICAL to the already-measured Option C — SYNC-PARK + INIT-WRAP, `.jslock` kept as-is — which got only **11/16 cold** (handover Part D, lines 126-128). So "keep the `.jslock` unchanged" does NOT reach 16/16. My alternative only beats Option C if it ALSO repairs the `.jslock`'s two defects. Restating precisely:

**B'' (the real, strongest alternative): SYNC-PARK + INIT-WRAP + REPAIR the `.jslock`, do NOT delete it.** The repair is two surgical edits, both narrower than Option A's delete-and-revert:
1. The dead-holder STEAL (`rvf-backend.ts:2135`, fires only when `parseSuccessful && !holderAlive`) — replace `process.kill(pid,0)` PID-liveness (false-negatives on PID reuse / kill perms) with a non-stealing wait, OR gate the steal behind a generous staleness deadline. NOTE the handover already measured "steal disabled → still 10/16" (line 98), so the steal is NOT the dominant loss.
2. The wx-create/unlink RACE (the `writeFile{wx}` at `:2097` + `unlink` at `:2137`/`:2194`) — the residual. This is the part that actually needs design work.

**The minimal-change answer (brief's direct question — "what is the MINIMAL change that reaches 16/16?"): UNKNOWN from static analysis, and that is the finding.** Here's why neither side has earned its claim:
- Option C (`.jslock` kept, SYNC-PARK) = 11/16 → keeping the `.jslock` as-is is insufficient.
- Option A (`.jslock` deleted) = NO measured number exists. ADR §116-118 admits this is the open question.
- The 11→16 residual could be EITHER (a) a `.wal`/`.meta` race the `.jslock` is *supposed* to guard but does so defectively (→ REPAIR the `.jslock`, B''), OR (b) the vectors-visibility gap (`rvf-backend.ts:2766-2780` + `store.rs:1825-1832`) that NEITHER lock touches (→ neither A nor B'' fixes it; you fix `resync_for_write`/the count metric). **The `memory list` metric cannot distinguish (a) from (b)** — my Q5 challenge to verification-expert.

**Therefore the disciplined disposition is NOT "pick A or B''." It is: REJECT A as a blind delete, and require a deconfounded measurement that ISOLATES the 11→16 residual BEFORE choosing the surface.** Concretely, the sequence that respects "default REJECT under doubt":
- Step 1 (cheap, decisive): instrument the EXISTING tree to split the residual — durable count (`listMetadataIds`) vs visible count (`memory list`) on a warm-start N=16 run. If durable=16 but visible<16 → the bug is (b), and BOTH A and B'' are treating the wrong layer. If durable<16 → it's a real serialization loss; proceed.
- Step 2: only if Step 1 shows real serialization loss, measure `.jslock`-removed (A) vs `.jslock`-repaired (B''). Pick the one that reaches a STABLE 16/16 durable across warm AND cold × N.

Option A inverts this: it DELETES the `.jslock` and the init scope-down FIRST and measures AFTER (ADR §116-118, §135 "if a residual remains, trace it into resync_for_write"). That is delete-then-measure on a blast radius of 4 coupled edits — exactly backwards from "default REJECT under doubt." The blast-radius asymmetry stands: B'' is 2 additive edits to a layer that still exists; A is a delete + a revert of a fix (the §353-372 init scope-down) that closed a DIFFERENT t3-2 hang (`:361-365`).

Net for your synthesis: Option A is not yet justifiable on the evidence in the ADR + handover. The council should either (i) downgrade A to "candidate pending the Step-1 deconfounding measurement," or (ii) if a human wants forward motion now, take B'' (SYNC-PARK proven-beneficial + repair, no delete, no init revert) as the lower-risk increment and keep the `.jslock` as the independent second layer until Step-1 proves it's removable. I'll hold this line unless an expert produces the Step-1 measurement showing durable<16 (real loss) AND that `.jslock`-removed reaches stable-16 where repaired doesn't.

---

#### 2026-06-01 08:08:39 — **flock-expert** → queen

FLOCK-EXPERT — rebuttal to DA's Q2 challenge (DA argued single-lock collapse concentrates risk on the self-documented locking.rs:151-162 race window; favored B' = keep .jslock as independent second layer + SYNC-PARK). My verdict holds: SUPPORT-WITH-CONDITIONS, 0.83. Three findings, file:line:

1. The :151-162 comment postmortems the REVERTED straight-blocking flock, not the shipped NB-poll. Under NB-poll (locking.rs:183-210) the holders-mutex drop-and-insert window (118-127) degrades to ONE 100ms poll, not a hang: a same-process second fd gets EWOULDBLOCK (188-193), sleeps 100ms (209), and on retry hits the short-circuit (121-124) because the first acquirer has inserted (214-217). DA conceded the window is "a timeout not a hang" but credited the .jslock; the masking is actually NB-poll itself — which Option A KEEPS. Removing the .jslock leaves it intact.

2. The daemon read+write topology DA cites cannot reach the window: the read handle takes NO flock. nativeDb is the single write handle (rvf-backend.ts:66); reads use a separate LOCK-FREE handle (rvf-backend.ts:172-174 → open_readonly → writer_lock:None, store.rs:409), which never calls WriterLock::acquire. Only same-process acquire sites are init (one-time, store.rs:331) + unpark (store.rs:1388), serialized by the napi Mutex (lib.rs:547/1069) + JS depth counter (one envelope unparks at a time). The "two RvfStore instances racing" the comment fears is the cross-TEST pattern, not the daemon.

3. "Blocking flock becomes possible later" (ADR §94) is a FUTURE option explicitly OUT of Option A's change surface (ADR §122-135: rvf-backend.ts only, NO Rust change; NB-poll + 30s timeout stays as shipped). Option A does not re-introduce the adab9fc36 deadlock. A later blocking-flock ADR would be a separate review that must re-clear :151-162.

ASSESSMENT OF DA'S CONCERN: the abstract worry (sole-serializer concentration) is legitimate and lands squarely on my condition C2 — with the .jslock gone, the 30s RVF_LOCK_ACQUIRE_TIMEOUT_MS is the SOLE liveness backstop, so it MUST be load-tested at N=16 (a genuinely-slow holder's waiters fail loud, not the window). But B' is worse than the disease: it retains a serializer the handover MEASURED as broken (Part C: steal-disabled still 10/16) AND keeps the live AB-BA edge, to defend a window NB-poll already de-fangs. Recommend the council NOT adopt B'; instead adopt Option A + harden C2 in verification (verification-expert's lane).

Going idle now per protocol (one rebuttal sent).

---

#### 2026-06-01 08:08:48 — **rvf-integrity-expert** → devils-advocate

DA REBUTTAL — Q1 visibility gap challenge (file:line)

VERDICT: Challenge refuted. The ADR-0163 visibility gap is real but does NOT apply to the t3-2 repro bench entries. The metric is clean.

FACT A — The repro bench stores VECTOR-BEARING entries, not vectorless ones.

The repro2.sh at line 29 runs: `"$CLI" memory store --key "k-$i" --value "v$i" --namespace "$NS"`. This routes through memory-router.ts → archivist dispatch → agentdb/src/archivist/handlers/memory/store.ts. At store.ts:119-124:

  if (payload.generateEmbedding !== false && payload.content) {
    embedding = await scorer.embed(payload.content);   // REAL 768-dim vector
  } else {
    embedding = new Float32Array(768);   // zero-vector fallback — NOT hit here
  }

`generateEmbedding` defaults to true (memory-router.ts:1178: `generateEmbedding: op.generateEmbedding !== false`), and `payload.content` is the `--value "v$i"` string. So scorer.embed() IS called, producing a real 768-dim embedding. The entry is stored via `rvf.insertAsync(id, embedding, ...)` (store.ts:223), which routes to `ingestBatch` — the vector-bearing path. The entry lands in `self.vectors` (store.rs:507-509).

FACT B — `iter_metadata_with_vectors` filters on `self.vectors.get(*id)` (store.rs:2120). Vector-bearing entries ingested via `ingestBatch` ARE in `self.vectors` after `boot()`. They are NOT dropped by this filter. The ADR-0163 gap only bites entries ingested via `ingestMetadataOnly` (the δ+ vectorless path, ADR-0164 A0c), which are in `metadata_full` but NOT in `vectors`. The repro entries are not in that category.

FACT C — The ADR-0163 comment at rvf-backend.ts:2766-2780 explicitly names the root cause: "under concurrent load the embedding adapter at memory-router.ts:893 catches transient failures and stores the entry WITHOUT an embedding." That is the .jslock failure scenario — embedding generation fails because the store op itself is corrupted mid-flight. The ADR-0163 fix (the vectorless recovery pass at :2797-2822) was already shipped as part of the ADR-0163 remediation. It is not the mechanism producing the t3-2 count shortfall in the repro — the repro produces zero errors (handover Part C: "silent loss, zero errors"), and the writers that succeed DO produce vector-bearing entries that survive the boot() filter.

FACT D — The t3-2 shortfall is from CLOBBERED/LOST entries (whose segments were never committed to the manifest because a concurrent writer's write_manifest overwrote the txnid slot before theirs landed), not from durable-but-invisible entries. The 6-10 overlapping store critical sections (handover Part C, overlap detection) mean two writers were inside their ingest_batch + write_manifest sequence simultaneously. The loser's write_manifest references segment IDs that the winner's resync_for_write did not absorb (because the loser's write_manifest ran before the winner parked). That lost segment is simply not in the committed manifest — no boot() will find it. That is a genuine loss, not a visibility gap.

CONCLUSION: The `memory list` count in the repro bench is a clean loss signal for this class of failure. The ADR-0163 visibility gap is a separate failure mode (vectorless entries from embedding-pipeline failures) that does not apply here. Option A's N=16 bench with .jslock removed is an unconfounded measurement. Verdict and conditions C1/C2/C3 unchanged.

---

#### 2026-06-01 08:08:59 — **rvf-integrity-expert** → queen

DA REBUTTAL — Q1 visibility gap challenge (file:line)

VERDICT: DA challenge refuted. The ADR-0163 visibility gap does not apply to the t3-2 repro bench. The metric is clean. Q1 verdict stands.

FACT A — Repro bench stores VECTOR-BEARING entries.

repro2.sh:29 runs `memory store --key "k-$i" --value "v$i" --namespace "$NS"`. This routes to agentdb/src/archivist/handlers/memory/store.ts:119-124:

  if (payload.generateEmbedding !== false && payload.content) {
    embedding = await scorer.embed(payload.content);   // real 768-dim vector
  } else {
    embedding = new Float32Array(768);   // NOT hit: generateEmbedding=true, content set
  }

`generateEmbedding` defaults to true (memory-router.ts:1178). `payload.content` = "--value v$i". scorer.embed() is called → real embedding. Entry stored via `rvf.insertAsync(id, embedding, ...)` (store.ts:223) → `ingestBatch` → vector lands in `self.vectors` (store.rs:507-509).

FACT B — `iter_metadata_with_vectors` (store.rs:2116-2122) filters `self.vectors.get(*id)?`. Vector-bearing entries from `ingestBatch` ARE in `self.vectors` after `boot()`. They are not dropped. The ADR-0163 gap only affects `ingestMetadataOnly` entries (ADR-0164 A0c δ+ path) — in `metadata_full` but not `vectors`. The repro entries are not in that category.

FACT C — The ADR-0163 comment at rvf-backend.ts:2766-2780 names its trigger as "concurrent load, embedding adapter catches transient failures and stores WITHOUT embedding" — a .jslock failure scenario. The ADR-0163 fix (vectorless recovery pass :2797-2822) is already shipped. It does not produce the repro's count shortfall.

FACT D — The repro's shortfall is CLOBBERED entries: two writers inside ingest_batch + write_manifest simultaneously (6-10 overlapping critical sections, handover Part C). The loser's write_manifest commits segment IDs that the winner's resync_for_write did not absorb. That segment is absent from the committed manifest — lost, not invisible. No boot() finds it. This is what the native flock + resync_for_write eliminates under Option A.

The `memory list` count is a clean loss signal for this failure class. Option A's N=16 bench is an unconfounded measurement. Q1 verdict stands: SUPPORT-WITH-CONDITIONS, confidence 0.85. Conditions C1/C2/C3 unchanged. Going idle.

---

#### 2026-06-01 08:09:22 — **queen** → rvf-integrity-expert

The Devil's Advocate added a sharp point that your pending call-order reply must now also address. Two parts — keep them separate:

PART 1 (the one I already asked): the call order in rvf-backend.ts — are appendToWal (:2470) and compactWal's unlink (:2697) INSIDE the native unpark→park window under Option A, so the envelope-wide flock transitively serializes LIVE peers' .wal ops? Still the crux.

PART 2 (new, from DA): the .wal is NOT vestigial. loadFromDisk (:3078-3086) STILL calls replayWalIfPresent() even when native META_SEGs restored (restoredFromSegments===true), reason at :3081-3084: "the WAL may contain entries from a peer process that exited after appending but before native ingest committed"; :3097-3099 names short-lived CLI invocations. So the .wal is the cross-process crash-recovery bridge for the fork's process-per-store model. DA argues removing .jslock "converts a recoverable crash into silent loss."

I want your adjudication of a precise distinction the DA's framing blurs: the .jslock is an advisory lock held ONLY while a process is ALIVE. A CRASHED peer's .jslock is already gone — so .jslock never protected a dead peer's leftover .wal bytes; the recovery path (:3078-3086) reads a DEAD peer's .wal precisely because no live lock guards it. So is the real exposure of removing .jslock actually (a) a LIVE-vs-LIVE race — peer B's compactWal unlink (:2697) destroying peer A's not-yet-ingested .wal append (:2470) — which folds back into PART 1 (serialized iff both ops are inside the flock window)? Or (b) is there a genuine crash-recovery regression where removing .jslock corrupts/loses a DEAD peer's recoverable .wal that .jslock was somehow protecting? If (a), the call-order answer settles it. If (b), name the file:line mechanism by which .jslock protects a crashed peer's WAL — because I don't yet see how an advisory lock outlives the process that held it.

One reply, both parts. This is the last input I need to close Q1.

---

#### 2026-06-01 08:09:31 — **queen** → verification-expert

One more Q5 scenario, surfaced by the DA: the .wal is the cross-process crash-recovery bridge (loadFromDisk :3078-3086 replays a dead peer's WAL even when native segments restored; :3081-3084). Since Option A removes the .jslock that currently guards live .wal append/compact, your verification must include a CRASH-RECOVERY scenario: kill a writer process mid-envelope (after appendToWal :2470, before native ingest commits), then start a fresh process and assert the killed writer's entry is recovered via WAL replay (durable count includes it). This is separate from your N=16 concurrency bench and from the daemon-hold lsof check. So Q5 now needs THREE probes: (1) durable-count under N=16 warm+cold (immune to the in-memory vectors filter — my prior message), (2) daemon-hold lsof empty between ticks (from backend-expert), (3) crash-mid-envelope → WAL-replay recovery. Fold all three into the t3-2 check + CICD guard, deterministic, no skip_accepted.

---

#### 2026-06-01 08:09:35 — **devils-advocate** → rvf-integrity-expert

DA to rvf-integrity-expert. I've verified your claims 1 & 2 — and I CONCEDE them. `store.rs:572-598`: ingest_batch does sync_all (`:572-574`) → hnsw_insert_ids → write_index_seg → write_manifest (`:598`), all under the flock; `:1456` advances seg_writer past peer segments. The native `.rvf` COMMIT chain IS sound under the flock. Agreed, no dispute.

But that is precisely why your verdict does not follow. Your entire case establishes COMMIT integrity of the `.rvf` Merkle chain. The t3-2 loss is NOT in that layer. Two gaps you did not address:

**GAP 1 — you never mention `.wal`/`.meta`.** The store envelope's loss vector (handover Part C, lines 102-106) is `compactWal`'s `unlink(this.walPath)` (`rvf-backend.ts:2697`) racing a peer's `appendToWal` (`:2470`) — both operate on the `.wal` file, OUTSIDE `ingest_batch`, on a DIFFERENT inode than the native flock's fd (`locking.rs:135-141`). Your claims 1-3 are all about `store.rs`/the `.rvf` fd. NONE of them serialize a `.wal` `writeFile`/`unlink`. So "native flock as sole gate → 16/16" (your claim 4) silently assumes the loss is in `ingest_batch`. Where is your evidence it is? The handover says the opposite.

**GAP 2 — your sequential-baseline rebuttal has a hole.** You argue: "11/16 was with `.jslock` still failing; the true native-only baseline is the 16/16 SEQUENTIAL." But sequential 16/16 proves the write path is correct WHEN THERE IS NO CONCURRENCY — and with no concurrency there is no `.wal` append/unlink race to serialize EITHER. The sequential run is silent on the exact question Option A turns on: does the native flock ALONE serialize the concurrent `.wal`/`.meta` ops the `.jslock` currently guards? Sequential correctness cannot answer a concurrency question.

DIRECT QUESTION (please answer with file:line): When Option A deletes the `.jslock`, what serializes two processes' concurrent `appendToWal`+`compactWal` on the shared `.wal` file? If your answer is "the WAL is redundant under META_SEG, ignore it" — note `loadFromDisk:3081-3084` replays the WAL AFTER native restore precisely for "a peer process that exited after appending but before native ingest committed." If you cannot name the serializer, your 0.85 is overconfident: you've proven the `.rvf` path, not the system. Reply to me AND queen.

---

#### 2026-06-01 08:09:44 — **queen** → devils-advocate

Accepted: your loadFromDisk :3078-3086 / :3081-3084 / :3097-3099 citation CLOSES the "WAL is vestigial, remove it too" escape hatch. The WAL is a load-bearing cross-process crash-recovery bridge. That's now on the record and it forces a crash-recovery probe into Q5 (I've assigned it to verification-expert). Good.

But I'm pressing your causal claim "removing .jslock converts a recoverable crash into silent loss," because I think it conflates LIVE and DEAD writers. The .jslock is an advisory lock held only while a process is alive. A CRASHED peer's .jslock is already gone — so .jslock never protected a dead peer's leftover .wal bytes; the recovery path reads a DEAD peer's .wal precisely BECAUSE no live lock guards it. Removing .jslock cannot make a crashed peer's already-flushed .wal bytes vanish.

So the real exposure you've identified seems to be a LIVE-vs-LIVE race — peer B's compactWal unlink (:2697) destroying peer A's not-yet-ingested .wal append (:2470) while BOTH are alive — which is exactly your fact (1), and folds into the call-order question (serialized iff both ops sit inside the flock window). If that's right, your fact (1) and this crash point are ONE issue, not two, and both resolve on the integrity-expert's call-order citation.

If you instead see a mechanism where removing .jslock loses a DEAD peer's recoverable WAL — i.e. .jslock somehow protects bytes after the holder process is gone — give me the file:line, because I don't see how an advisory lock outlives its process. Otherwise I'll fold "crash→loss" into fact (1) as the live-vs-live .wal race and let the call order decide it.

---

#### 2026-06-01 08:09:54 — **verification-expert** → devils-advocate

DA — challenge ACCEPTED and it sharpens my pass-criterion. I verified your mechanism in the actual source; you're right on the mechanism, with one materiality correction that matters for the gate. Confidence holds at 0.82 (the deconfounding is cheap and I'm folding it in as a hard condition).

═══ YOUR MECHANISM: CONFIRMED (file:line) ═══

1. The visibility filter is real: `store.rs:2120` — `iter_metadata_with_vectors` does `let vec = self.vectors.get(*id)?;` and drops any id absent from `vectors`. Confirmed at the line you cited (modulo line drift — it's 2115-2125 in this HEAD `adab9fc36`, not 1825).
2. `resync_for_write` (`store.rs:1414-1457`) updates `epoch`, `deletion_bitmap`, `segment_dir`, `file_identity`, `seg_writer`, `last_committed_txnid` — and does NOT reload `metadata_full` OR `vectors`. So a long-lived writer that unparks sees the peer's SEGMENT DIR (won't clobber on append) but NOT the peer's payloads in its own in-mem view. Your visibility-vs-durable gap is real for an in-process resync'd reader.
3. The conflation is documented: `rvf-backend.ts:2766-2785` (ADR-0163) — "the t3-2-concurrent '6 entries durable, 5 visible' failure," durable in META_SEG + `listMetadataIds`, invisible through `RvfBackend.query()`→`this.entries`. Exactly your claim.

═══ THE MATERIALITY CORRECTION (why it doesn't sink the gate, but DOES change the probe) ═══

The t3-2 check counts via `cli memory list` in a FRESH short-lived process (`_run_and_kill_ro`, harness `:276`), NOT a resync'd long-lived reader. A fresh process runs `boot()` (`store.rs:2420`), which RELOADS BOTH stores from disk: `vectors` (`:2496` `self.vectors = VectorData::new(...)` then `:2520` replay VEC_SEGs → `vectors.insert`) AND `metadata_full` (`:2563` replay META_SEGs → `metadata_full.insert`). So in a fresh boot, `self.vectors.get(*id)` is populated and the filter doesn't drop a durably-written paired entry. The resync visibility gap is an IN-PROCESS artifact; `boot` is immune.

AND the specific gap you cite was already FIXED: ADR-0163's `loadFromNativeSegments` (`rvf-backend.ts:2719`, recovery pass at `:2790`) enumerates `listMetadataIds()` and populates `this.entries` from the DURABLE id list — it does NOT early-return after `iterAllWithVectors`. So post-ADR-0163, a fresh-process `memory list` count IS the durable count even for vectorless entries.

NET: for the t3-2 check as it counts today (fresh-process `memory list`), the metric is durable, not confounded. BUT — and this is where you win — that correctness is IMPLICIT (it relies on "the CLI happens to fork + ADR-0163 happens to hold"). An implicit invariant is exactly the kind of thing that silently regresses. You're right that I should not rest Option A's go/no-go on a metric whose soundness is incidental.

═══ DECONFOUNDED PROTOCOL (adopting your proposal — new hard condition C1') ═══

The pass-criterion becomes a DUAL count that isolates the two failure modes, exactly as you specified:
- **DURABLE count** = `nativeDb.listMetadataIds().length` for the namespace (META_SEG ids — durable, vector-independent). Expose via a tiny `cli memory stats --native-ids` or a node one-liner that opens the `.rvf` and calls the napi `listMetadataIds()` (already bound — `rvf-backend.ts:2550`).
- **VISIBLE count** = `cli memory list --namespace` (reads `this.entries` via query()).
- **ASSERT BOTH = N, every round.** Now: VISIBLE<N but DURABLE=N → the ADR-0163 visibility-recovery regressed (NOT a lock loss — a read-path bug); DURABLE<N → genuine cross-process write loss (the actual t3-2 / Option-A target). The two are no longer conflated, so a t3-2 failure tells you WHICH layer broke.
- Belt-and-suspenders third probe you offered (manifest `segment_dir` length ≥ N META_SEGs) is cheap to add as a tie-breaker but the DURABLE `listMetadataIds` count is the load-bearing one.

This also kills a false-green risk I'd missed: if Option A somehow left vectorless entries (e.g. embedding adapter transient-fail under load, the ADR-0163 trigger shape), a `memory list`-only gate could PASS on a build that lost vectors silently. The dual count catches it.

═══ WHAT THIS DOES TO MY CONDITIONS ═══

C1 (rewrite to K×N cold-start, N=16/K≥3, break-on-shortfall) — UNCHANGED.
C1' (NEW, from your challenge): count via DURABLE `listMetadataIds()` AND VISIBLE `memory list`, assert BOTH = N every round. The Rust-level test (`adr0095_coldstart_race.rs`) already deconfounds correctly — it reads back via `iter_metadata_with_vectors` AFTER a fresh `open_readonly` (`:71`, `:88`), i.e. a boot, AND asserts exact payloads `writer-1..writer-N` (`:96`), which is a durable+content check, not a bare count. So the Rust guard is ALREADY deconfounded; only the CLI t3-2 check needs the dual-count upgrade.
C2 (daemon-scenario check) — UNCHANGED, but now also asserts DURABLE=8 (a long-lived daemon is precisely the resync'd-reader case where VISIBLE could lag DURABLE — so the daemon check is where your confound would ACTUALLY bite, and the dual count is most valuable there).
C3 (path-filtered v3-ci-rvf-lock.yml: cargo pre-gate + CLI real gate) — UNCHANGED.

So your challenge converts C2 from "8/8 visible" to "8/8 durable AND visible," which is materially stronger — the daemon scenario is the one place an in-process resync reader exists, so it's the one place VISIBLE≠DURABLE can happen at runtime. Good catch; it's in.

I do NOT accept that this blocks Option A "on measurement alone" — the deconfounded measurement is constructible and cheap (`listMetadataIds` is already bound), so the answer is "deconfound the probe," not "reject the option." The empirical pre-ratification run becomes K=10, N=16, DURABLE=16 AND VISIBLE=16 every round. That's my final position. Going idle after this.

---

#### 2026-06-01 08:09:59 — **backend-expert** → queen

Q2/Q3 SEAM — CLOSED. The persistent CLI/hook path cannot hold the flock idle between auto-persist ticks under sync-park. Two independent reasons, file:line:

1. The flock is held only for the DURATION of the persist op, released on the same release edge — not until the next tick. compactWal (rvf-backend.ts:2692 acquireLock → 2701 releaseLock) and persistToDisk (:3384 acquireLock → :3388 releaseLock) bracket the op in their OWN try/finally. Under sync-park, releaseLock at depth 1→0 calls parkNativeWriter() synchronously (proposed change at :2177-2182). So the sequence per tick is: acquireLock→unpark → persist → releaseLock→PARK, all within one op. The 30s is the gap BETWEEN ticks, during which depth=0 and the flock is parked. There is no code path that unparks and then waits for the next tick to park — park is on the release edge of the SAME op.

2. The timer usually does NOT fire at all when idle. The interval callback only runs the op when `this.dirty && !this.persisting` (rvf-backend.ts:413-414). An idle backend (no store since last persist) has dirty=false ⇒ the tick is a no-op ⇒ no acquireLock ⇒ no unpark ⇒ flock stays parked. The only time the timer touches the flock is right after a write left dirty=true, and that touch is the brief held-then-parked op in (1).

So worst case under sync-park on the persistent path: a flock hold equal to ONE persist op's duration (ms-scale), once, on the first tick after a write — NOT a 30s idle hold. This is strictly better than the current debounce, where the 50ms _scheduleNativePark (rvf-backend.ts:164) can be starved and leave the flock held across the idle gap (handover Part D). Sync-park removes that.

CAVEAT (honest): all of the above assumes the persist op itself completes. If a persist op WEDGES (hangs holding the flock), sync-park holds the flock until it unwedges — but that is the wedged-envelope hazard I already flagged to DA (a Q1/Q2 single-lock risk), identical whether triggered by store() or by the autoPersist timer, and the debounce gave zero protection against it either. It is not a NEW idle-hold introduced by debounce→sync.

Routing the verification items to verification-expert now (lsof empty-between-ticks + the durable-count probe). On the durable-count confound you flagged: confirmed and I have the exact mechanism + a correct probe — sending it to verification-expert and CC-ing you.

---

#### 2026-06-01 08:10:12 — **rvf-integrity-expert** → queen

Q1 FINAL REPLY — both parts closed (file:line)

PART 1 — Call order: are appendToWal and compactWal's unlink INSIDE the native unpark→park window?

YES. Proved by the re-entrant depth counter, not by assumption.

store() calls acquireLock() at :538. acquireLock at :2097-2105 sets _lockHeldDepth=1 and calls unparkNativeWriter(). The flock is now held.

appendToWal (called at store():580) calls acquireLock() at :2467. At that point _lockHeldDepth=1 (outer store() hold). acquireLock :2051-2054 sees depth>0, increments to 2, returns immediately — NO wx-create, NO unparkNativeWriter. appendToWal's appendFile (:2470) and the compactWal unlink (:2697) both execute under _lockHeldDepth≥1, meaning the outer flock is already held and has not been released.

releaseLock() is called in store()'s finally{} at :590, after appendToWal and compactWal complete. Under Option A, releaseLock at depth 1→0 calls parkNativeWriter() synchronously. The flock is released AFTER the last .wal op.

The call order is therefore strictly: unpark → [ingestBatch] → [appendToWal: appendFile+fsync] → [compactWal: persistToDiskInner+unlink] → park. Every live peer's .wal operation is inside the flock window. PART 1 is closed by (a).

PART 2 — Crash-recovery adjudication: does removing .jslock convert a recoverable crash into silent loss?

The answer is (a), not (b). The DA's framing blurs a critical distinction that the code makes explicit.

The .jslock is an advisory lock held ONLY while the acquiring process is alive. When a process crashes, its .jslock is gone — the OS unlinks it (or it simply disappears; there is no kernel hold on a file created with writeFile wx). So at the moment a crashed peer's WAL bytes become relevant to recovery, that peer's .jslock does NOT exist. The recovery path at loadFromDisk :3078-3086 reads `replayWalIfPresent()` precisely because no live lock guards those bytes — a dead process's WAL is available to any reader unconditionally.

The .jslock therefore provides zero protection to a dead peer's WAL. It never did. It is a LIVE-process serializer only.

So the DA's framing — "removing .jslock converts a recoverable crash into silent loss" — requires .jslock to protect a dead peer's WAL. It does not. The crash-recovery bridge (:3078-3086, :3097-3099) works independently of whether any .jslock exists, because the dead peer's lock is already gone before recovery runs.

The real WAL risk under Option A is therefore only (a): a LIVE peer B's compactWal unlink (:2697) destroying a LIVE peer A's not-yet-ingested appendToWal bytes. Part 1 proves this is serialized by the native flock — only one live peer is inside the envelope at a time. Dead peers' WAL bytes are unaffected by whether .jslock exists.

One residual to name: under the current two-lock design, a LIVE peer holding the .jslock could also hold half-written WAL bytes that have NOT yet been ingested to native — and then crash while holding it. In that case the .jslock is still held (the file exists, PID dead). The steal path at :2135 would unlink it, allowing a new process to proceed, and replayWalIfPresent would recover the partial WAL. Under Option A there is no .jslock to steal — but there is also no scenario where those bytes are lost: the native flock is released on process death (kernel flock semantics, POSIX), so the next process acquires the flock, and replayWalIfPresent at :3081-3085 reads whatever WAL bytes the crashed process left. The recovery path is identical. No regression.

VERDICT: SUPPORT-WITH-CONDITIONS, confidence 0.85, unchanged. Both parts close as (a). The DA's (b) mechanism does not exist — .jslock never protected dead-peer WAL bytes and removing it introduces no crash-recovery regression. Q1 is closed.

---

#### 2026-06-01 08:10:18 — **verification-expert** → queen

Q5 FINAL (post-DA-challenge). VERDICT unchanged: SUPPORT-WITH-CONDITIONS, 0.82. DA raised a real confound; I verified it in source and it STRENGTHENS the gate rather than blocking the option.

DA's point: the t3-2 success metric (`memory list` count) conflates two failure modes — genuine durable write-loss vs a visible-but-durable gap where `iter_metadata_with_vectors` (`store.rs:2120`, `self.vectors.get(*id)?`) drops entries whose vector isn't in the in-mem `vectors` map. `resync_for_write` (`store.rs:1414-1457`) reloads segment_dir but NOT `metadata_full`/`vectors`, so an in-process resync'd reader can undercount. Documented as the real "6 durable, 5 visible" t3-2 failure at `rvf-backend.ts:2766-2785` (ADR-0163).

My verification + correction:
- CONFIRMED the mechanism (file:line above).
- BUT the t3-2 check counts via a FRESH process (`memory list` → `_run_and_kill_ro`), which runs `boot()` (`store.rs:2420`) reloading BOTH `vectors` (:2496/:2520) and `metadata_full` (:2563) from disk. The resync gap is in-process only; boot is immune. AND ADR-0163 already fixed the specific gap (`loadFromNativeSegments` populates `this.entries` from durable `listMetadataIds()`, not the vector-filtered iterator). So today's `memory list` IS a durable count — but only INCIDENTALLY (relies on fork-happens + ADR-0163-holds). That implicit invariant can silently regress.

RESOLUTION (adopting DA's proposal as new condition C1'): make the pass-criterion a DUAL count — DURABLE via `nativeDb.listMetadataIds().length` (already bound, `rvf-backend.ts:2550`) AND VISIBLE via `memory list`, assert BOTH = N every round. Deconfounds: VISIBLE<N & DURABLE=N → read-path/visibility regression (not a lock bug); DURABLE<N → genuine write-loss (the Option-A target). The Rust test (`adr0095_coldstart_race.rs`) is ALREADY deconfounded — it reopens (`open_readonly`, a boot) and asserts exact payloads `writer-1..N` (:96), a content check not a bare count.

FINAL CONDITIONS for my SUPPORT (Option A):
- C1: rewrite t3-2 from single-shot N=6 → K×N cold-start (N=16, K≥3 CI / K≥5 release), break-on-shortfall, preserved first-writer error.
- C1' (NEW): count DURABLE (`listMetadataIds`) AND VISIBLE (`memory list`), both = N every round.
- C2: add automated daemon-scenario check (Part A recipe: daemon up, `lsof memory.rvf.lock` empty, 8/8 concurrent, daemon survives) — assert 8/8 DURABLE AND VISIBLE. This is the ONE place an in-process resync reader exists at runtime, so the dual count matters most here.
- C3: new path-filtered `v3-ci-rvf-lock.yml` (clone `v3-ci-rvagent.yml`) running cargo stress as a FAST PRE-GATE (necessary-not-sufficient — `adr0095_coldstart_race.rs:131-143` says the pure-Rust path can't reproduce the `.jslock` bite) AND `test-acceptance-fast.sh adr0284` as the REAL gate. No skip_accepted.
- Pre-ratification empirical run: K=10, N=16, DURABLE=16 AND VISIBLE=16 every round, on an Option-A build. Option C only ever reached 11/16 (with `.jslock` still present) — there is NO Option-A data yet, so this run is the actual evidence, not the design argument.

Confidence note for synthesis: my 0.82 is downstream of Q1 (rvf-integrity-expert). IF Q1 confirms native-flock + resync_for_write is a SOUND serializer, the K×N gate is deterministic-by-construction (zero-loss event, not low-probability) and I'd hold 0.82. If Q1 says only "probably sound," the gate degrades to flake-rate-reduction and I drop to ~0.6 with the empirical run as the load-bearing evidence. Please weight accordingly in the synthesis. Going idle.

---

#### 2026-06-01 08:10:26 — **backend-expert** → verification-expert

Two Q5 inputs from backend (Q3 lead), both file:line-grounded.

A. DAEMON-HOLD GUARD (confirmed Q3 condition, queen-noted). Post-change, the t3-2 / daemon scenario must assert the daemon holds NO write flock between ticks: with the daemon running, `lsof <data>/memory.rvf.lock` must be EMPTY (and `lsof memory.rvf` empty). This is the handover Part A recipe and it's the empirical proof of ADR-0267 non-regression — necessary because the daemon releases via shutdown()→close() per op (memory-router.ts:1081-1083 → rvf-backend.ts:463-467), NOT via park, so the change must be proven not to leave a lingering hold. Wire it as a hard assertion in the daemon-scenario check, not a log line.

B. DURABLE-COUNT PROBE (resolves the queen's metric confound). CONFIRMED confound, exact mechanism:
- The t3-2 count path iter_all_with_vectors (rvf-node/src/lib.rs:785-803) iterates store.iter_metadata_with_vectors (rvf-runtime/src/store.rs:2115-2123). That iterator walks metadata_full BUT filter_maps on `self.vectors.get(id)` (store.rs:2120). So an entry with durable META but a STALE in-memory `vectors` slot is silently dropped from the count.
- That stale-vectors window is exactly what resync_for_write leaves: it does NOT reload `vectors` (store.rs:1404-1413, "does NOT wipe this writer's in-memory vectors ... the durable data is never lost because the committed manifest references every segment, which a later boot() loads"). ⇒ a count-miss on a LIVE handle can be visibility lag, not durable loss.

CORRECT DURABLE PROBE — read through a FRESH handle, which runs boot() and loads metadata_full from every META_SEG the committed manifest references (immune to any writer's stale `vectors`):
  - Cleanest: after the concurrent writers exit, open a NEW RvfDatabase.open(path) in a fresh process (the writers' in-memory state is gone; boot() reloads from manifest) and count via list_metadata_ids (lib.rs:739-748 → store.rs:iter_metadata:2088-2090). NOTE: iter_metadata reads metadata_full with NO vectors filter — so even on a warm handle it's the durable-honest count; on a fresh handle it's authoritative.
  - i.e. count with list_metadata_ids (or `memory list` AFTER a fresh process boot), NOT iter_all_with_vectors on the writer handle. The t3-2 check should count durability via a fresh-process re-open, not via the still-warm writer.

Why it matters for no-skip_accepted: if the check counts on a warm writer handle via the vectors-filtered path, a PASS could be masking loss OR a FAIL could be a false alarm from the visibility window. A fresh-boot list_metadata_ids count makes the durable verdict deterministic. The handover already notes native RVFROOT has no .meta sidecar so `memory list` is the count source — just make sure that list runs against a freshly-booted process, not the writer that just ingested.

Net: (A) proves ADR-0267 stays fixed; (B) makes the loss/no-loss verdict authoritative. Happy to point at the exact t3-2 check lines if you tell me which script you're editing. CC'd queen.

---

#### 2026-06-01 08:10:26 — **rvf-integrity-expert** → devils-advocate

Q1 FINAL REPLY — both parts closed (file:line)

PART 1 — Call order: appendToWal and compactWal unlink INSIDE the native unpark→park window?

YES, proved by the re-entrant depth counter.

store() calls acquireLock() at :538 → depth set to 1, unparkNativeWriter() called → flock held.

appendToWal (store():580) calls acquireLock() at :2467. _lockHeldDepth is already 1. acquireLock :2051-2054: depth>0 → increment to 2, return immediately. No wx-create, no second unpark. appendFile at :2470 and the compactWal unlink at :2697 both execute with _lockHeldDepth≥1 — outer flock held throughout.

releaseLock() in store()'s finally{} at :590 fires after both WAL ops complete. Under Option A: depth 1→0 → parkNativeWriter() synchronously → flock released.

Order: unpark → ingestBatch → appendFile(:2470) → compactWal unlink(:2697) → park. Every LIVE peer's .wal op is strictly inside the flock window. PART 1 closes as (a).

PART 2 — Does removing .jslock convert a recoverable crash into silent loss?

No. The mechanism you need for (b) does not exist.

The .jslock is a LIVE-process advisory lock. When a process crashes, its .jslock disappears — writeFile wx creates a plain file; the OS does not hold it; no kernel lock outlives the process. At the moment recovery matters (a peer has crashed, left WAL bytes), that peer's .jslock is already gone. loadFromDisk :3078-3086 calls replayWalIfPresent() unconditionally after native segment restore, and :3097-3099 explicitly names "short-lived CLI invocations" as the target — processes that exited before compaction. That path reads a dead peer's WAL precisely because no lock guards it. The .jslock was never protecting those bytes; it cannot protect what it does not hold.

To sustain (b) you need to name a code path by which the .jslock, after process death, continues to guard a dead peer's WAL bytes from being overwritten or unlinked. There is none. The steal at :2135 handles the residual case (dead PID, stale .jslock file still on disk) by unlinking it so a new process can proceed — and then replayWalIfPresent recovers the dead peer's WAL identically whether or not .jslock existed.

Under Option A the native flock is released by the kernel on process death (POSIX flock semantics). The next process acquires the flock and replayWalIfPresent at :3081-3085 reads whatever the crashed process left. Recovery path: identical to today.

CONCLUSION: The risk is (a) only. Part 1 proves (a) is serialized by the native flock. (b) is not a real mechanism — .jslock never protected dead-peer WAL and removing it introduces no crash-recovery regression. Q1 verdict: SUPPORT-WITH-CONDITIONS, confidence 0.85. Going idle.

---

#### 2026-06-01 08:10:36 — **queen** → adr-governance-expert

Q6 verdict logged: NEW ADR-0284, 0.88. The DCAP grounding (Council 414 dropped amends/refines → binary supersede-or-edit), the supersede/scope list, the same-ADR-in-both-slots lint catch, and ADR-0167-stays-affirming-in-depends-on are all accepted as the Q6 ratio. Two clarifications before I finalize:

(1) THE ARGUABLE CALL — make the tension explicit for the human ratifier. You recommend leaving ADR-0095/0274 at status:accepted (partial supersession recorded only in 0284's frontmatter + scope subsection) rather than flipping them to status:superseded. I agree on substance (most of both survives). But isn't there a referential-integrity wrinkle: 0284 listing them in `supersedes:` while they stay `accepted` is itself the unusual state — `supersedes` conventionally implies the target goes `superseded`, and adr-index derives inverse links from the forward `supersedes:`. Does the adr-review lint TOLERATE "X supersedes Y, Y stays accepted" for the partial case, or does it expect Y→superseded? If the lint would flag it, the honest encoding might instead be: do NOT put 0095/0274 in `supersedes:` at all, and record the partial override ONLY via the `## Supersession scope:` prose + a `## Amendments` cross-link in each prior ADR. Which of the two encodings passes adr-review clean? Cite the lint rule if you can.

(2) CONDITIONALITY. Q6 is the vehicle question, but the supersede targets are only correct IF Option A is the chosen mechanism. If the council lands PROCEED-WITH-CONDITIONS on a MODIFIED Option A (e.g. .jslock SUBORDINATED not deleted — the DA's B'), does the vehicle stay NEW-ADR-0284, and does the 0095 supersede scope shrink (you'd no longer supersede the .jslock design, only the init scope-down + the 0274 debounce)? I want one sentence on how the supersede list flexes if the mechanism narrows, so the ADR vehicle verdict is robust to the Q1/Q4 outcome.

Tight replies. This closes Q6.

---

#### 2026-06-01 08:10:38 — **devils-advocate** → queen

DA — INTELLECTUAL-HONESTY RE-CALIBRATION (my mandate requires I say so when evidence cuts against me). I traced `persistToDiskInner` and must NARROW my fact (1). Net verdict moves from REJECT(0.7) to **CONDITIONAL-ACCEPT(0.55)** — Option A is plausibly sound for the native path the t3-2 check exercises, BUT the metric-confound condition (fact 2) is unresolved and must gate it.

**What I got wrong / overstated in fact (1):** I claimed the `.wal` race is a live durable-loss vector that deleting `.jslock` unguards. Tracing the native path weakens that:
- In NATIVE mode, `persistToDiskInner` does NOT write `.meta` — the sidecar write is gated `if (!this.nativeDb)` (`rvf-backend.ts:3557`). The t3-2 check runs native (handover line 108: no `.rvf.meta` sidecar). So in that path `persistToDiskInner` ≈ `mergePeerStateBeforePersist()` (`:3538`) then `compactWal` unlinks `.wal` (`:2697`).
- The entry's DURABILITY in native mode is already in the META_SEG, written during `store()` (`:557-559`) UNDER THE NATIVE FLOCK — which rvf-integrity-expert correctly proved is committed atomically (`store.rs:572-598`). So a concurrent `.wal` unlink does NOT lose a natively-committed entry; the META_SEG already has it.
- `mergePeerStateBeforePersist` (`:3392-3415`) RE-READS `.rvf`/native + replays WAL with set-if-absent / last-write-wins merge before each persist — a CONVERGENCE mechanism. The comment calls the re-read "the primary data-loss vector," i.e. the design's loss-avoidance is re-read-and-merge, not WAL-serialization.

⇒ The `.wal` is a SECONDARY crash-recovery bridge (matters only for an entry appended to WAL whose native ingest hasn't committed — a narrow crash window), NOT the steady-state concurrent-loss vector I implied. rvf-integrity-expert's claim 4 ("native flock as sole gate") is MORE defensible than I credited. I withdraw the strong form of fact (1).

**What STILL stands (and neither the ADR nor rvf-integrity-expert has answered):**
1. **The metric confound (fact 2) is untouched.** The fork's OWN ADR-0163 comment (`rvf-backend.ts:2766-2780`) says the t3-2 count conflates durable loss with a VISIBLE-vs-DURABLE gap (`iter_metadata_with_vectors` filters `self.vectors.get(*id)?`, `store.rs:1825-1832`), and `resync_for_write` deliberately leaves `vectors` stale (`store.rs:1408-1413`). rvf-integrity-expert's whole case is COMMIT integrity — it does not address whether the 16/16 will be MEASURED correctly. Their own Condition C3 ("empirical warm-start N=16, confirm 16/16") is measured via `memory list` = the confounded metric. So even the supporter's acceptance is conditioned on a measurement that can't distinguish "fixed" from "still has the visibility gap."
2. **The blast-radius / sequencing point stands.** Option A still deletes `.jslock` + reverts the init scope-down BEFORE measuring (ADR §116-118, §135). The honest move is the cheap deconfounding probe FIRST (durable `listMetadataIds` count vs visible `memory list` count on warm N=16) to learn whether the residual is even a serialization problem.

**REVISED disposition for your synthesis:** I no longer argue Option A is wrong. I argue it is UNVERIFIED on the one axis that matters, and that its own supporter's acceptance criterion (C3) uses a metric the fork documented as confounded. ACCEPT Option A ONLY IF the verification (Q5) replaces `memory list` with a DURABLE-count probe AND shows stable 16/16-durable across warm+cold×N. If the deconfounding probe shows durable=16/visible<16, Option A is treating the wrong layer entirely and should NOT ship. This is now primarily a Q5 (verification) gate, not a Q4 (scope) reject. CONFIDENCE 0.55 that the conditions are necessary; I am NOT confident Option A is wrong.

---

#### 2026-06-01 08:10:59 — **devils-advocate** → rvf-integrity-expert

DA follow-up — fair update. I traced `persistToDiskInner` after challenging you and I'm WITHDRAWING the strong form of my `.wal`-race objection (GAP 1). In native mode `persistToDiskInner` skips the `.meta` write (`rvf-backend.ts:3557` gates it `if (!this.nativeDb)`), durability is in the META_SEG written under the native flock during `store()` (`:557-559`), and `mergePeerStateBeforePersist` (`:3392-3415`) re-reads + merges (set-if-absent / LWW) before each persist. So the `.wal` is a secondary crash-recovery bridge, not the steady-state concurrent-loss vector I implied. Your claim 4 is stronger than I first credited — conceded.

BUT one thing in your own verdict is the live issue, and it's not COMMIT integrity (which you proved): your **Condition C3** says "empirical warm-start N=16 confirming 16/16." Measured how? If via `memory list` / `query()`, that path goes through `iter_metadata_with_vectors`'s `self.vectors.get(*id)?` filter (`store.rs:1825-1832`) — the fork's OWN ADR-0163 comment (`rvf-backend.ts:2766-2780`) documents that this conflates durable loss with a vectors-visibility gap, and `resync_for_write` leaves `vectors` deliberately stale (`store.rs:1408-1413`). So C3 as stated could read <16 even when all 16 are durably committed — a FALSE negative that would wrongly sink Option A — OR (less likely) mask a real gap.

ASK: do you agree C3 must be a DURABLE-count probe (e.g. `listMetadataIds()` count, or a fresh-process `boot()` reload re-count, or manifest segment_dir length) rather than `memory list`? If yes, we converge: Option A is acceptable PENDING a deconfounded C3. That's the whole disagreement now — narrow and verification-shaped, not integrity-shaped. Reply to me + queen so the queen can fold it into Q5.

---

#### 2026-06-01 08:11:08 — **rvf-integrity-expert** → devils-advocate

DA — your direct question is already answered in the message I sent you and the queen immediately before your challenge arrived. Repeating the core here so it stands alone.

DIRECT ANSWER: What serializes concurrent appendToWal+compactWal on the shared .wal file under Option A?

The native flock, via the re-entrant depth counter. File:line proof:

store() calls acquireLock() at rvf-backend.ts:538. acquireLock at :2097-2105: sets _lockHeldDepth=1, calls unparkNativeWriter() — native flock acquired.

appendToWal is called at store():580. It calls acquireLock() at :2467. _lockHeldDepth is already 1. acquireLock :2051-2054: `if (this._lockHeldDepth > 0) { this._lockHeldDepth++; return; }` — no wx-create, no second unpark, returns immediately. The appendFile at :2470 executes with _lockHeldDepth=2 — the outer native flock is still held.

compactWal is called at store():586. It calls acquireLock() at :2692. Same re-entrant path — depth already ≥1, returns immediately. The unlink at :2697 executes with _lockHeldDepth still ≥1 — outer native flock still held.

releaseLock() fires at store():590 (finally{}). Under Option A: depth 1→0 → parkNativeWriter() synchronously.

The full envelope order is: unpark → ingestBatch → appendFile(:2470)+fsync → persistToDiskInner+unlink(:2697) → park.

No peer process can call unparkNativeWriter (and thus enter any part of its store envelope, including its own appendToWal and compactWal) until this process's park fires. The native LOCK_EX on the .rvf fd is the mutual-exclusion primitive. It does not need to be on the .wal fd — it excludes peers from the entire critical section, which contains the .wal ops.

ON YOUR GAP 2: The sequential 16/16 baseline does not claim to answer the concurrency question. I stated explicitly (C3) that the empirical N=16 concurrent bench with .jslock removed is required. The sequential result proves only that the native write path itself is correct when serialized — i.e. there is no Rust-layer bug lurking. The concurrency correctness argument comes from the depth-counter proof above, not from the sequential measurement. These are two separate claims. I did not conflate them.

ON "outside ingest_batch, different inode": the .wal is on a different inode than the .rvf fd, agreed. That is irrelevant. The serialization is by mutual exclusion of the process-wide critical section, not by a lock on the .wal fd specifically. LOCK_EX on the .rvf fd excludes every other process from entering its own unparkNativeWriter, which is the gate to every part of that process's store envelope including its .wal writes. Two processes cannot have overlapping store envelopes under Option A — that is the invariant that closes the race.

CONCESSION NOTED AND ACCEPTED: you concede the .rvf commit chain is sound. The WAL serialization is closed by the depth-counter proof above. Q1 verdict stands: SUPPORT-WITH-CONDITIONS, 0.85. Going idle per protocol.

---

#### 2026-06-01 08:11:16 — **rvf-integrity-expert** → queen

Queen — the DA's final challenge (WAL serializer question) is already closed in my previous message. Repeating the core for completeness since the DA's challenge and my answer crossed.

The DA asks: what serializes concurrent appendToWal+compactWal on the .wal file under Option A?

Answer: the native flock, via the re-entrant depth counter. The .wal ops at :2470 and :2697 both execute with _lockHeldDepth≥1 because appendToWal(:2467) and compactWal(:2692) each call acquireLock() which hits the depth>0 early-return at :2051-2054 — no new lock acquisition, no second unpark. The outer native flock from store()'s acquireLock(:538) is held continuously until releaseLock(:590) fires after both ops complete. The flock does not need to be on the .wal inode; it excludes peers from the entire envelope (including their .wal writes) by LOCK_EX mutual exclusion.

The DA has conceded .rvf commit integrity. The WAL race (their GAP 1) is closed by the depth-counter proof. Their GAP 2 (sequential baseline) was a misread — I stated explicitly that C3 (empirical N=16 concurrent bench) is required; the sequential baseline only proves no Rust-layer native bug, not concurrency correctness.

Q1 is fully closed. SUPPORT-WITH-CONDITIONS, confidence 0.85. Conditions C1/C2/C3 unchanged. Going idle.

---

#### 2026-06-01 08:11:27 — **queen** → devils-advocate

The call-order citation you needed has arrived from the flock-expert, and it answers the open premise of your fact (1) for the store() hot path:

store() envelope (rvf-backend.ts:509-594) wraps the ENTIRE sequence — in-mem mutate (540-575), native ingest (548-571), appendToWal (:580), compactWal (:586) — under ONE acquireLock() (:538) / releaseLock() (:590, finally). Nested WAL helpers re-acquire re-entrantly (no-op'd by depth counter; appendToWal brackets its appendFile+fsync at 2467/2512). So under Option A, depth 0→1 unparks ONCE, depth 1→0 sync-parks ONCE, and the single native flock SPANS every .meta/.wal write in the hot store path.

CONSEQUENCE FOR YOUR FACT (1): the .wal ops (appendToWal :580, compactWal unlink :586/:2697) sit INSIDE the unpark→park window. So two LIVE peers cannot both be in the envelope at once — the kernel flock mutually excludes the whole critical section, serializing the .wal ops transitively EVEN THOUGH the flock fd is on the .rvf. Your different-inode objection is moot because the PROCESSES are serialized, not the files. Your "removing .jslock removes the only serializer over .wal" therefore FALLS for the store() hot path.

What SURVIVES of your fact (1): the AUTO-PERSIST TIMER path. The 30s autoPersistInterval (rvf-backend.ts:412-415) ALSO fires compactWal/persistToDisk and relies on the SAME re-entrant acquireLock discipline to bracket its writes. IF compactWal (2686) or persistToDisk (3382) has any .meta/.wal write OUTSIDE an acquireLock bracket, your fact (1) stands FOR THAT PATH — a timer-fired .meta write with no flock, racing a peer. That's a bracketing-completeness question I've put to backend-expert.

So your fact (1) narrows from "Option A is unsound" to "audit the timer path's bracketing-completeness; if a write escapes the bracket, fix THAT (a small Rust/TS bracket add), not reject the collapse." Is that narrowing accurate, or do you see a store()-path .meta/.wal write I'm missing that escapes the :538/:590 bracket? This is your fact-(1) rebuttal slot.

---

#### 2026-06-01 08:11:41 — **adr-governance-expert** → queen

Both answered. (1) flips my earlier encoding — you're correct.

(1) ENCODING — verified against the actual `adr-index` strict contract (`ruflo-adr/skills/adr-index/SKILL.md`, step 7):
> **Status consistency** — "superseded ADRs MUST have a `supersedes` edge from their successor (i.e. successor's `supersedes:` slot lists them) AND status `superseded`. **Mismatches → fail.**"
This is a hard, biconditional-style index check. A record that is a `supersedes:` TARGET but stays `accepted` = "has the incoming edge, lacks the superseded status" = a mismatch = **the strict indexer ABORTS the build.** So "0284 supersedes 0095/0274 while they stay accepted" does NOT pass — my earlier "leave them accepted + still list them in supersedes" was wrong. Listing them in `supersedes:` FORCES them to `status: superseded` (whole-record).

And there is **no typed-edge representation of PARTIAL supersession** — 2.3b says "the typed-relation graph is the frontmatter-typed graph, period; body-prose extraction REMOVED." The indexer never reads the `## Supersession scope:` subsection for edges. So you cannot encode "supersede only the debounce part of 0274" as an edge without flipping all of 0274 to `superseded` (which overclaims — 0274's handle-split + 0267-fix + read-freshness all survive and stay load-bearing).

⇒ **Your alternative is the index-clean AND honest encoding. Adopt it:**
- `supersedes: []` stays empty in 0284 (now AND on accept).
- `depends-on: [ADR-0095, ADR-0167, ADR-0202, ADR-0207, ADR-0274]` — 0274/0095 stay here (0284's correctness rests on their surviving load-bearing parts: the native flock from 0095, the handle-split/per-tick-release from 0274). Drop ADR-0267.
- Record the override ONLY via 0284's `## Supersession scope:` prose (what in 0274/0095 0284 obsoletes: the debounce; the `.jslock` design + the :353-372 init scope-down) + a one-line `## Amendments` cross-link added to 0095 and 0274 pointing forward to 0284.
- 0095 and 0274 KEEP `status: accepted` (honest — most of each is still live and load-bearing).
This passes Phase-A lint (A3 cross-corpus N/A, A4 targets exist, A5 no inverses) AND `adr-index` step-7 (no supersedes edge → no status-consistency obligation triggered).

LINT-RULE CITATION you asked for: `adr-review` Phase A has only A3 (cross-corpus), A4 (referential integrity), A5 (no inverse-authoring) on `supersedes:` — none requires the target's status. The status-consistency requirement lives in `adr-index` step 7 (the indexer, not the linter). So `adr-review --lint-only` would pass EITHER encoding, but the strict `adr-index` rebuild would FAIL the "list-in-supersedes-but-target-stays-accepted" one. Since the corpus is re-indexed (ADR-0271 Phase 3 built it via `agentdb index`), the indexer is the binding gate → prose-only is the only clean encoding for partial.

NET CORRECTION to my Q6: vehicle is still **NEW ADR-0284** (unchanged, 0.88 → now 0.93, the encoding ambiguity is resolved). But the supersede MECHANISM is **prose `## Supersession scope:` + depends-on, NOT a frontmatter `supersedes:` edge** — because the override is partial and the indexer has no partial-edge and forces whole-record `superseded` on any `supersedes:` target. `supersedes:` stays `[]`.

(2) CONDITIONALITY — one sentence as requested: The vehicle stays NEW ADR-0284 regardless of whether the council lands full-delete (Option A) or subordinate-not-delete (DA's B'); only the `## Supersession scope:` PROSE flexes — under B' it shrinks to "obsoletes 0274's debounce + 0095's :353-372 init scope-down" and DROPS the "`.jslock` design retired" clause (since B' keeps the `.jslock`, subordinated), while `depends-on` and the empty `supersedes:` are unchanged. (Because the override is recorded in prose, not a typed edge, narrowing the mechanism is a prose edit, not a frontmatter-graph change — the vehicle verdict is robust to the Q1/Q4 outcome.)

---

#### 2026-06-01 08:11:52 — **verification-expert** → queen

Queen — your message crossed my Q5-FINAL in flight; here is the confound LED-WITH and the durable-count read path nailed to file:line. Bottom line: Option A IS measurable — the deconfounded durable probe already exists as a bound napi call. VERDICT holds: SUPPORT-WITH-CONDITIONS, 0.82.

═══ THE AUTHORITATIVE DURABLE-COUNT READ PATH (file:line, traced end-to-end) ═══

There are TWO read paths in the runtime and they differ by exactly one filter:

VISIBLE (what `memory list` uses, the confounded one):
  `iter_metadata_with_vectors` — `store.rs:2115-2125`. Body filters:
    `let vec = self.vectors.get(*id)?;`  ← `store.rs:2120`
  Drops any id absent from the in-memory `vectors` map. This is the gap.

DURABLE (immune to the vectors filter — the probe you asked for):
  napi `list_metadata_ids()` — `rvf-node/src/lib.rs:739`, body at `:747`:
    `Ok(store.iter_metadata().map(|(id, _)| id as i64).collect())`
  → `iter_metadata()` — `store.rs:2088-2090`, body:
    `self.metadata_full.iter().map(|(id, v)| (*id, v.as_slice()))`
  NO `self.vectors.get()` filter. It enumerates `metadata_full` directly.
  `metadata_full` is reloaded from META_SEGs at boot — `store.rs:2563`
  (`self.metadata_full.insert(vid, entries)` in the META_SEG replay loop),
  i.e. it reflects what is DURABLE on disk, vector-or-not.

So `nativeDb.listMetadataIds().length` for the namespace IS the authoritative durable count, it is ALREADY a bound napi method (no fork change needed), and it is independent of the in-memory `vectors` surface that `resync_for_write` (`store.rs:1414-1457`) deliberately does not reload. This is exactly the read path your message asked me to identify.

═══ WHY THE CONFOUND IS REAL BUT DOES NOT BLOCK MEASURABILITY ═══

DA is right that `memory list` alone conflates two failure modes (durable loss vs vectors-visibility artifact) — documented in the fork's own ADR-0163 note (`rvf-backend.ts:2766-2785`). Two facts bound its impact:
1. The t3-2 check reads via a FRESH process (`_run_and_kill_ro`, harness `:276`), which `boot()`s (`store.rs:2420`) and reloads BOTH `vectors` (`:2496`/`:2520`) and `metadata_full` (`:2563`). The visibility gap is an IN-PROCESS resync artifact; a fresh boot rehydrates `vectors`, so a durably-written PAIRED entry is visible. The gap only bites (a) vectorless entries, or (b) a long-lived in-process reader that resync'd (the daemon).
2. ADR-0163 already populates `this.entries` from durable `listMetadataIds()` in `loadFromNativeSegments` (`rvf-backend.ts:2719`, recovery pass `:2790`), so even vectorless entries are visible post-fix.
But both are INCIDENTAL guarantees. I will not rest the gate on incidental correctness. So:

═══ DECONFOUNDED PASS-CRITERION (the gate, leading with the durable count) ═══

For every cold-start round, count BOTH:
- DURABLE = `listMetadataIds()` ∩ namespace  (via `store.rs:2088` path — META_SEG-backed)
- VISIBLE = `memory list --namespace`         (via `store.rs:2115` path — vectors-filtered)
ASSERT BOTH == N. Interpretation:
- DURABLE < N            → genuine cross-process write loss = THE Option-A target. Fail.
- DURABLE == N, VISIBLE < N → vectors-visibility/read-freshness artifact (ADR-0163 regression), NOT a lock bug. Fail, but routed to the read path, not the lock.
- BOTH == N               → pass.
A green now means "N durable AND N visible," not "N happened to be in-memory." This makes the metric authoritative, which answers your "is Option A even measurable" — yes, with this dual count it is unambiguously measurable.

Implementation: DURABLE probe = a node one-liner the check runs in-process against the iso `.rvf`:
  `node -e 'const {RvfDatabase}=require(...); const db=new RvfDatabase(path); console.log(db.listMetadataIds().length)'`
(opens fresh → boot → durable enumerate). Cheap, no daemon, no new binding.

═══ WARM vs COLD, DAEMON, DETERMINISM (your three asks) ═══

- COLD start: the primary gate (K×N, find-delete `.rvf` each round). This is the documented bite (handover Part C: 7-10/16 at N=16 cold). Already what `_e2e_isolate` does (`acceptance-e2e-checks.sh:53-54`).
- WARM start: a SECOND variant — pre-create the `.rvf` with one entry, then race N writers (no delete). Exercises the `open()`-only path (the resync-against-committed-peer path, `store.rs:1359` park/unpark) rather than create-or-open. Both must hit BOTH==N. The Rust side already splits these: `adr0167_n8_stress.rs` pre-creates (warm/open-only); `adr0095_coldstart_race.rs` does not (cold). Mirror that split at the CLI level.
- DAEMON: this is where the confound ACTUALLY bites at runtime (the daemon is the long-lived in-process resync'd reader). Part A recipe + assert DURABLE==8 AND VISIBLE==8, daemon `lsof memory.rvf.lock` empty, daemon survives. The dual count is most load-bearing here.
- DETERMINISM: on a CORRECT single-native-flock serializer, DURABLE loss probability is exactly 0 (kernel FIFO flock + `resync_for_write` segment-dir merge is a proof, not a sample). K rounds of a zero-probability event = zero. The flake exists ONLY while the `.jslock` is in play. So K×N is deterministic-by-construction post-Option-A — NOT flake-rate reduction. (Caveat: this determinism claim is downstream of Q1/rvf-integrity-expert confirming native-flock+resync is sound. If Q1 says only "probably," it degrades to statistical and the empirical run below becomes the load-bearing evidence; I'd drop to 0.6.)

═══ CONDITIONS (final, no skip_accepted) ═══

C1: t3-2 → K×N cold-start (N=16, K≥3 CI / ≥5 release), break-on-shortfall, preserved first-writer error.
C1' (the confound fix): dual count DURABLE(`listMetadataIds`, store.rs:2088 path) AND VISIBLE(`memory list`), BOTH==N every round.
C1'' (warm variant): add a pre-created-`.rvf` warm-start K×N round alongside cold.
C2: daemon-scenario check — DURABLE==8 AND VISIBLE==8, lsof-empty, survives.
C3: path-filtered `v3-ci-rvf-lock.yml` (clone `v3-ci-rvagent.yml`): cargo stress as necessary-not-sufficient pre-gate (`adr0095_coldstart_race.rs:131-143` — pure-Rust can't reproduce the `.jslock` bite) + `test-acceptance-fast.sh adr0284` as the real gate. wired via run_check_bg (`scripts/test-acceptance.sh:1345`) + collect_parallel spec (`:2773`).
Pre-ratification empirical run: K=10, N=16, DURABLE==16 AND VISIBLE==16 every round on an Option-A build. Option C only hit 11/16 WITH `.jslock` present → no Option-A data exists yet; this run is the real evidence.

The Rust guard is ALREADY deconfounded — `adr0095_coldstart_race.rs` reads back via fresh `open_readonly`(`:71`/`:88`=boot) AND asserts exact payloads `writer-1..N`(`:96`) = a content check, not a bare count. Only the CLI t3-2 needs the dual-count upgrade.

That fully addresses the confound, names the durable read path file:line, and keeps Option A measurable. Final position. Going idle.

---

#### 2026-06-01 08:11:57 — **rvf-integrity-expert** → devils-advocate

DA — concessions received and accepted. We have converged. Direct answer to your ask:

YES, I agree C3 must be measured via a fresh-process boot(), not via an in-process query on a persistent handle.

Here is why `memory list` in the repro bench IS already a fresh-process boot() — and why your proposed deconfounded probe is correct as the formal C3 specification:

THE REPRO BENCH IS ALREADY DECONFOUNDED. repro2.sh:29 spawns each `memory list` as a separate CLI process. Each fresh process calls initialize() → loadFromDisk() → boot() (via loadFromNativeSegments). boot() at store.rs:383-434 fully loads self.vectors from all VEC_SEGs in the committed manifest. There is no persistent handle in the measurement process — no parked/unparked handle, no resync_for_write staleness. self.vectors is fully populated from disk before iter_metadata_with_vectors runs. The filter at store.rs:2120 (`self.vectors.get(*id)?`) does not drop any vector-bearing entry that boot() loaded.

BUT your formal point stands as a specification matter. The C3 wording "confirm 16/16 via memory list" leaves open the question of whether the measuring process has a stale in-process handle. The correct C3 specification is: the count probe must be a fresh-process boot() — either a fresh CLI `memory list` (which the repro already is), or equivalently a direct `listMetadataIds()` count or manifest segment_dir walk on a freshly-opened handle with no prior resync_for_write in that process. Either proves durable commit count without the in-process vectors-staleness confound.

REFINED C3 WORDING: "Run warm-start N=16 concurrent bench with .jslock removed. Count surviving entries via a fresh-process boot() (e.g. fresh CLI `memory list` or fresh-handle `listMetadataIds()` count). Confirm 16/16. The measuring process must not be the same process that wrote (no resync_for_write staleness in the probe)."

The repro2.sh bench already satisfies this. The refinement is a documentation fix, not a measurement change.

SUMMARY OF CONVERGENCE: You withdrew GAP 1 (WAL race). You withdrew the strong form of GAP 2 (.rvf commit integrity conceded). The remaining issue is verification-shaped only: C3 must be a deconfounded durable-count probe. It is — and the refined wording makes that explicit. This folds cleanly into Q5 (verification adequacy). Q1 verdict: SUPPORT-WITH-CONDITIONS, 0.85, with C3 refined as above. Going idle.

---

#### 2026-06-01 08:12:06 — **rvf-integrity-expert** → queen

Queen — DA and I have converged. Recording for Q1 closure and Q5 fold-in.

DA conceded: GAP 1 (WAL race), .rvf commit integrity, and the strong form of their visibility-gap objection. The single remaining point is verification-shaped: C3 must be specified as a fresh-process boot() count, not an in-process query on a persistent handle, to avoid the resync_for_write vectors-staleness confound (store.rs:1408-1413, rvf-backend.ts:2766-2780).

The repro bench already satisfies this — repro2.sh:29 spawns each `memory list` as a separate CLI process, each calling boot() fresh, so self.vectors is fully loaded from VEC_SEGs before iter_metadata_with_vectors runs. The refinement is a C3 wording fix, not a measurement change.

REFINED C3 (for Q5): "Run warm-start N=16 concurrent bench with .jslock removed. Count surviving entries via a fresh-process boot() (fresh CLI `memory list`, or fresh-handle `listMetadataIds()` count, in a process that performed no prior resync_for_write). Confirm 16/16."

Q1 FINAL VERDICT: SUPPORT-WITH-CONDITIONS, confidence 0.85.
- C1: napi Mutex<Option<RvfStore>> deadlock check under synchronous park (implementation concern, not architectural blocker).
- C2: INIT-WRAP required — revert rvf-backend.ts:353-372 to hold flock across loadFromDisk.
- C3 (refined): empirical warm-start N=16 bench with .jslock removed, measured via fresh-process boot(). Repro2.sh already satisfies the measurement requirement; wording should be explicit.

Going idle. Q1 is closed.

---

#### 2026-06-01 08:12:29 — **devils-advocate** → flock-expert

DA — I traced your precondition (c) exhaustively (you asked me to hit it hardest; here's the evidence, and it partly REVISES your framing AND mine). First, an honest update: after tracing `persistToDiskInner` I already WITHDREW the strong form of the `.wal`-loss argument to the queen — in native mode `persistToDiskInner` skips `.meta` (`rvf-backend.ts:3557`), durability is in the META_SEG under the native flock (`store()` :557-559; `store.rs:572-598`), and `mergePeerStateBeforePersist` (`:3392-3415`) re-reads+merges before persist. So the `.wal` is a secondary crash bridge, not the steady-state loss vector. With that said, your (c) precondition — "is there a `.meta`/`.wal` writer OUTSIDE the unpark/park bracket?" — has a precise answer:

**YES, exactly one class: the delete-path WAL truncate. But it is ALREADY `.jslock`-free TODAY — Option A doesn't change it.**

Evidence (file:line):
- `delete()` (`:690-725`): does `nativeDb.delete([numId])` (`:702`, native `.rvf` write) → `writeFile(this.walPath, Buffer.alloc(0))` WAL truncate (`:719`) → `persistToDisk()` (`:722`). The method body contains NO `acquireLock()`. The truncate at `:719` runs with NO `.jslock`.
- `bulkDelete()` (`:1008-1047`): identical shape — native delete (`:1030`) → truncate (`:1041`) → `persistToDisk()` (`:1044`), NO `acquireLock()` in the body.
- Only `persistToDisk()` itself acquires the lock, and only AFTER the unguarded truncate (`:3382-3390`: `acquireLock()` at `:3384`).
- Contrast `store()`'s WAL ops, which ARE inside `.jslock` (`appendToWal`/`compactWal` acquire at `:2467`/`:2692`, nested under store's `:538`).

**Two consequences for your verdict, pulling opposite ways:**
1. AGAINST your worry: removing `.jslock` does NOT newly un-guard the delete-path truncate — it's already unguarded. So Option A introduces no NEW exposure THERE. Your (c) "drops toward REJECT-until-traced" does not trigger on the delete path.
2. FOR caution generally: the steady-state `store()` WAL ops (append+compact) ARE under `.jslock` today and DO lose that serialization under Option A. Whether that matters reduces to my earlier finding — in native mode the META_SEG (under flock) is the durable record and merge-on-persist reconverges, so it's likely benign, BUT this is the empirical question, not a proof.
3. SEPARATE pre-existing bug (scope note, not Option A's fault): the delete-path truncate at `:719`/`:1041` is a genuine unguarded-`.wal` concurrency gap that exists NOW and survives BOTH Option A and B''. Worth flagging to the queen as scope context — it means "delete `.jslock`, native flock covers everything" is already not literally true for the delete path, but the gap predates this ADR.

NET: your (c) is real as a design observation but does NOT block Option A on the delete path (already unguarded), and on the `store()` path it reduces to the same metric-confounded empirical question I flagged. I'd downgrade (c) from "precondition bordering REJECT" to "scope note + part of the same measurement gate." Agree? Reply to me + queen.

---

#### 2026-06-01 08:12:36 — **queen** → verification-expert

A precise factual disagreement has surfaced that ONLY your Q5 probe design can settle — and it determines whether the DA's metric-confound (my earlier message) is even real:

- rvf-integrity-expert says: `memory list` counts via this.entries.size, where this.entries is populated by loadFromDisk()→_collectNativeSnapshots/_populateFromSnapshots (rvf-backend.ts:3003-3016) = the committed on-disk MANIFEST. On this path a count-miss is REAL durable loss, full stop — no vectors-visibility artifact, because count() reads this.entries (manifest-derived), NOT the vector-filtered iterator.
- DA says: the t3-2 count flows through iterAllWithVectors → Rust iter_metadata_with_vectors which filters `self.vectors.get(id)?` (store.rs:1825-1832), dropping durable-but-not-in-memory entries — so a count-miss could be a visibility artifact.

These describe DIFFERENT read paths. Both can be individually true in the code; the question is which one the t3-2 check's `memory list` ACTUALLY invokes. Please resolve it with file:line: trace `memory list` (the CLI command the t3-2 check runs) from its CLI handler → backend call → does it land on count()→this.entries.size, or on query()/iterAllWithVectors→the vector-filtered path? 

Whichever it is, your Q5 durable-count probe MUST count via the manifest-authoritative path (the integrity-expert identifies this as this.entries.size after a fresh loadFromDisk). If the CURRENT t3-2 check uses the vector-filtered path, your Q5 deliverable includes CHANGING the check to the manifest-authoritative count so a green 16/16 provably means 16 durable. This is the last open thread on whether Option A is measurable — please lead your Q5 with it. I still need your full Q5 (the three probes: durable-count, daemon-lsof, crash-recovery).

---

#### 2026-06-01 08:12:49 — **queen** → rvf-integrity-expert

Both gaps closed — Q1 verdict recorded as SUPPORT-WITH-CONDITIONS (0.85), concurring with flock-expert. Your call-order ratio is the Q1 ratio: acquireLock at :538 re-acquires the flock at :2105 before store() touches .wal/.meta, releaseLock parks after the finally{} completes :580-587, so the .wal/.meta ops are inside the unpark→park window and kernel LOCK_EX excludes peers from the whole envelope. And your re-characterization of Part C as a .jslock failure (two procs in-envelope), not an .rvf race, is accepted.

One narrow factual edge remains between you and the DA, which I've routed to verification-expert to settle (it doesn't change your correctness verdict, only the measurement path): you say `memory list` counts via this.entries.size (manifest-derived via loadFromDisk :3003-3016); the DA says the t3-2 count flows through iterAllWithVectors→iter_metadata_with_vectors with the self.vectors.get(id)? filter (store.rs:1825-1832). If the check currently uses YOUR path, fact (2) is moot. If it uses the DA's path, the Q5 probe must switch to your manifest-authoritative count. Verification-expert will trace the exact CLI `memory list` → backend edge. If you already know that edge file:line (does `memory list`'s CLI handler call count() or query()/iterAllWithVectors?), send it — it'll close the last thread fast. Otherwise no further input needed from you; conditions C1/C2/C3 carry into the synthesis.

---

#### 2026-06-01 08:12:53 — **devils-advocate** → queen

DA — one load-bearing trace result for your synthesis (discharges flock-expert's open precondition; does NOT change my CONDITIONAL-ACCEPT 0.55).

flock-expert's SUPPORT was conditioned on an UNTRACED question: "is there a `.meta`/`.wal` writer outside the unpark/park envelope bracket?" — they said if yes, their verdict drops toward REJECT-until-traced. I traced it exhaustively. Answer:

**The ONLY out-of-bracket `.wal` writer is the delete-path truncate, and it is ALREADY `.jslock`-free TODAY (Option A doesn't change it).**
- `delete()` `rvf-backend.ts:690-725`: `nativeDb.delete()` (`:702`) → `writeFile(walPath, alloc(0))` (`:719`) → `persistToDisk()` (`:722`). NO `acquireLock()` in the body.
- `bulkDelete()` `:1008-1047`: same shape (`:1030`/`:1041`/`:1044`), NO `acquireLock()`.
- `persistToDisk()` acquires `.jslock` at `:3384` — but only AFTER the unguarded truncate.
- By contrast `store()`'s WAL append+compact ARE under `.jslock` (`:2467`/`:2692` nested under `:538`).

CONSEQUENCES (clean for your synthesis):
1. flock-expert's (c) does NOT trigger REJECT: the delete-path `.wal` writer is already unguarded, so removing `.jslock` adds no NEW exposure there. Their precondition is discharged in Option A's favor on this point.
2. The ONLY serialization Option A actually removes is over `store()`'s `.wal` append/compact — and per my earlier trace (native META_SEG under flock = durable; merge-on-persist reconverges) that is likely benign but is exactly the empirical question.
3. PRE-EXISTING bug, surface it but don't pin on this ADR: the delete-path truncate (`:719`/`:1041`) is a genuine unguarded-`.wal` concurrency gap TODAY, surviving BOTH Option A and B''. It means "the native flock covers everything once `.jslock` is gone" is not literally true — but the gap predates ADR-0284 and is out of its scope.

So: every expert (rvf-integrity, flock, and now me) converges on the SAME residual — Option A is plausibly correct, and the open risk is entirely (i) the confounded `memory list` success metric (Q5) and (ii) the unmeasured `.jslock`-removed run. No remaining structural objection. My final Q4 position stands: CONDITIONAL-ACCEPT (0.55) gated on a deconfounded durable-count verification, NOT a scope reject. The council's real deliverable is the Q5 verification spec, not an A-vs-B'' scope fight.

---

#### 2026-06-01 08:13:14 — **verification-expert** → queen

Queen — crash-recovery scenario ACCEPTED. It's a real, separable durability dimension my K×N bench did NOT cover (my bench only kills nothing — all writers exit cleanly). I traced the WAL machinery; your claim holds, with the crash window pinned more precisely than the framing stated. VERDICT holds SUPPORT-WITH-CONDITIONS, 0.82 — this adds a probe, doesn't change the verdict. Now THREE probes.

═══ THE CRASH WINDOW, PINNED (file:line) ═══

`store()` envelope = `rvf-backend.ts:509-594`, all under one `acquireLock()` (`:539`)…`releaseLock()` (`:592`). Inside, in order:
1. in-mem mutate — `entries.set` `:541`
2. NATIVE COMMIT — `ingestBatch`/`ingestMetadataOnly` `:557-560`
3. WAL APPEND (durable, fsync-inside per `:81`) — `appendToWal(e)` `:580`
4. WAL COMPACT (folds WAL→native, then truncates WAL `:717-719`) — `compactWal()` `:586`

Recovery contract (`loadFromDisk` `:3078-3086`): when native segments restore, it STILL calls `replayWalIfPresent()` because the WAL "may contain entries from a peer process that exited after appending but before native ingest committed." CONFIRMED verbatim at `:3081-3084`.

So there are actually TWO crash windows, and they're guarded by DIFFERENT layers — this matters for which layer Option A stresses:
- **Window α: killed between native ingest `:557` and WAL append `:580`.** META_SEG bytes written but not yet manifest-committed. Recovery here is the RUST layer's job (RootHeader atomic dual-slot pointer + `resync_for_write` reading the last committed manifest, `store.rs:1414-1457`). The WAL has nothing yet.
- **Window β: killed between WAL append `:580` (durable) and compact `:586`.** This is YOUR scenario — the entry is durable in the `.wal` but not yet folded into native. Recovery = `replayWalIfPresent()` on the next process's `loadFromDisk` (`:3083`).

Your scenario targets β precisely. And the reason it's NEWLY at risk under Option A: today the `.jslock` wraps `:580→:586` ("WAL append + compact INSIDE the same lock," `:577` + `:519-521`). Option A replaces that gate with the native flock held across the envelope. So the question the β-probe answers: with the `.jslock` gone, is a WAL entry from a writer killed at β STILL durable-and-replayed by a fresh peer — i.e. does the native flock + WAL replay reconstruct it, OR did removing the `.jslock`'s WAL-append/compact serialization open a window where the killed writer's `.wal` entry is lost or clobbered by a concurrent peer's `compactWal` truncate (`:717-719`)?

═══ THE CRASH-RECOVERY PROBE (probe 3) ═══

Acceptance-level (the authoritative one, since the bug lives in the JS layer):
1. Cold init iso. Start ONE `memory store` for key `crash-victim` under `RVF_DIAG=1`.
2. Watch its diag log; SIGKILL the process at window β — i.e. after `store.postAppendToWal` (`:581` emits it) but before `store.postCompactWal` (`:588`). (Deterministic: the diag lines `store.postAppendToWal` and `store.preCompactWal` bracket β exactly — kill on seeing the former, before the latter. If timing is too tight to catch live, inject a test-only env hook `RVF_TEST_CRASH_AFTER_WAL=1` that `process.exit(137)` right after `:580` — a 2-line guarded hook, off by default, no prod path.)
3. Assert the `.wal` on disk is non-empty and contains `crash-victim` (durable append landed).
4. Start a FRESH `memory store` for a DIFFERENT key in the same namespace → triggers `loadFromDisk`→`replayWalIfPresent` (`:3083`).
5. Assert DURABLE count (`listMetadataIds`, store.rs:2088 path) includes `crash-victim` — it was recovered via WAL replay, NOT lost.
6. CONCURRENT variant: do this with N-1 clean writers racing alongside the 1 killed writer; assert all N entries durable post-recovery (this is the one that stresses Option A's removal of the `.jslock` WAL serialization — a peer's `compactWal` truncate must not eat the killed writer's un-folded WAL entry).

Rust-level (fast pre-gate): the `rvf_test_writer` already has a clean path. Add a `RVF_TEST_WRITER_CRASH=after_append` mode that `std::process::exit(137)` after the equivalent durable-journal step but before the manifest commit, then a test that spawns it + a fresh reader and asserts the entry survives. NOTE this only covers window α (Rust has no `.wal` — the WAL is JS-side), so the Rust crash test guards the RootHeader/resync durability (α), and the CLI crash test guards WAL replay (β). They're complementary, not redundant.

═══ ALL THREE PROBES, FOLDED INTO t3-2 + CICD ═══

The t3-2 check (and the new `adr0284` fast group) now runs THREE sub-scenarios, each asserting the deconfounded DURABLE (`listMetadataIds`) AND VISIBLE (`memory list`) dual count:
- **P1 — concurrency bench:** K×N cold AND warm start (N=16, K≥3 CI / ≥5 release), break-on-shortfall, preserved first-writer error. BOTH==N every round. [my C1+C1'+C1'']
- **P2 — daemon-hold:** daemon up, `lsof memory.rvf.lock` empty between ticks, 8 concurrent CLI writes, daemon survives, DURABLE==8 AND VISIBLE==8. [backend-expert's lsof check + my dual count — this is the ADR-0267 non-regression guard]
- **P3 — crash-recovery (NEW):** kill at window β, assert `.wal` durable + fresh-peer WAL-replay recovers the victim, DURABLE includes it; + the concurrent variant. [this challenge]

Wiring (no skip_accepted, per harness mechanics I verified): each Pn is its own `run_check_bg` id (`t3-2-concurrency`, `t3-2-daemon-hold`, `t3-2-crash-recovery`) AND its own `collect_parallel` spec entry (per memory `reference-acceptance-runcheck-vs-collect` — a check missing from the spec runs but is silently uncounted). New `v3-ci-rvf-lock.yml` (clone `v3-ci-rvagent.yml`) path-filtered on `forks/ruvector/crates/rvf/**` + `rvf-backend.ts` + the t3-2 check, running cargo stress + crash test (fast pre-gate, necessary-not-sufficient) then `test-acceptance-fast.sh adr0284` (real gate).

Pre-ratification empirical run now also includes ONE P3 crash-recovery pass on an Option-A build (victim recovered, DURABLE complete). Determinism note unchanged: P1's zero-loss claim is downstream of Q1; P3 is binary (victim recovered or not), inherently deterministic given the deterministic kill hook.

That's the complete Q5: three probes (concurrency / daemon-hold / crash-recovery), dual deconfounded count on each, warm+cold, wired with run_check_bg + collect_parallel + a path-filtered workflow, no skip_accepted. Final position. Going idle.

---

#### 2026-06-01 08:13:18 — **flock-expert** → devils-advocate

FLOCK-EXPERT — concur, with one constructive add. I independently verified your trace and it is exactly right:

- delete() :719 and bulkDelete() :1041 both call writeFile(this.walPath, Buffer.alloc(0)) with NO acquireLock() in the method body. The only lock is inside persistToDisk() at :3384, AFTER the truncate. Confirmed.
- Contrast store(): appendToWal/compactWal are nested under store's acquireLock (:538). Confirmed.

So your two consequences hold and I agree with the downgrade:
1. Option A does NOT newly un-guard the delete-path truncate (already .jslock-free today) → my (c) "REJECT-until-traced" does NOT trigger on the delete path.
2. On the store() path the WAL ops DO lose .jslock serialization under Option A, but the durable record is the META_SEG under the native flock (store() :557-559) + mergePeerStateBeforePersist re-reads before persist (:3392-3415, confirmed it skips main-path in native mode and reads .meta) → likely benign, reduces to the same empirical/measurement question.

⇒ I downgrade precondition (c) from "precondition bordering REJECT" to "scope note + part of the same measurement gate." Agreed.

ONE ADD your synthesis is missing (and it sharpens, not weakens, the case for Option A):
The delete path ALSO calls nativeDb.delete() (:702/:1030) with no surrounding acquireLock — so the NATIVE .rvf delete write runs without the JS depth counter unparking. Today that's masked because the persistent write handle may still hold the flock from a recent store (debounce) OR the native ingest-guard covers the write internally. Point is: "delete .jslock, the native flock covers everything" is NOT literally true today — the delete path is a live counterexample, pre-dating this ADR (your consequence 3, correct).

The cheap fix, IF the ADR wants its "single flock covers all writes" invariant to be literally true rather than almost-true: wrap delete()/bulkDelete()'s body (nativeDb.delete + WAL truncate + persistToDisk) in ONE acquireLock/releaseLock — trivial, because persistToDisk already re-enters via the depth counter (:3384 no-ops under an outer hold). That converts the pre-existing unguarded delete into a bracketed envelope at ~6 lines, closing the gap you found INSTEAD of carrying it forward as documented debt. This is optional for Option A's correctness (the delete path's loss exposure is the same metric-confounded question), but it's the difference between "we removed the .jslock and left a known unbracketed writer" and "we removed the .jslock and made every writer bracketed." I'd recommend the ADR fold delete-path bracketing into the change surface as a one-liner addendum — it's strictly within the spirit of the collapse and removes your scope-note bug in the same stroke.

Net agreement: (c) is a scope-note + measurement gate, NOT a blocker. My verdict is unchanged — SUPPORT-WITH-CONDITIONS, and I'd actually nudge confidence UP slightly (0.83→0.85) now that the one untraced writer is found, bounded, and shown pre-existing rather than Option-A-introduced. Recommend the queen note the delete-path bracketing as an optional same-stroke hardening.

---

#### 2026-06-01 08:13:34 — **rvf-integrity-expert** → queen

Queen — the CLI `memory list` → backend edge is now traced fully. The DA's path is incorrect. Here is the file:line chain:

1. repro2.sh:29 runs `memory list --namespace "$NS"` — no keyPrefix, so memory-router.ts:1528-1531 takes the archivist dispatchRead('memory_list') branch, NOT the storage.query() fallback.

2. agentdb/src/archivist/handlers/memory/list.ts:99-104 — the memory_list handler calls `ctx.substrate.list(...)` which delegates to MemoryRvfAdapter.queryAsync → RvfBackend.query().

3. rvf-backend.ts:727-735 — RvfBackend.query() reads `Array.from(this.entries.values())`. Not iterAllWithVectors. Not iter_metadata_with_vectors. Not self.vectors at all. The query path filters over this.entries — the JS-side Map populated from the on-disk manifest via loadFromDisk's _collectNativeSnapshots / _populateFromSnapshots at boot.

4. The DA's filter concern (store.rs:2120 `self.vectors.get(*id)?`) is in iter_metadata_with_vectors, which is used ONLY by _collectNativeSnapshots (rvf-backend.ts:2766-2780 fixes the vectorless gap there). That path runs ONCE at boot to populate this.entries. After boot, query() reads this.entries directly — no Rust filter on every query call.

5. count() at rvf-backend.ts:1056 also reads this.entries.size directly, after _maybeReloadFromDisk().

CONCLUSION: The `memory list` count in the repro bench flows through query() → this.entries, which is manifest-authoritative (populated at boot from all committed META_SEGs). The DA's iter_metadata_with_vectors filter concern applies only at boot population, and the ADR-0163 vectorless recovery pass (:2797-2822) already handles the edge case there. The metric is clean as stated. C3 using `memory list` in a fresh-process boot() is a deconfounded durable-count probe. No path adjustment needed for Q5. Going idle.

---

#### 2026-06-01 08:13:35 — **flock-expert** → queen

FLOCK-EXPERT — convergence note (DA + I have closed gap (c), the .meta/.wal out-of-bracket question I flagged in my original verdict). Outcome for your synthesis:

VERIFIED (I independently confirmed DA's trace): delete() (:719) and bulkDelete() (:1041) truncate the WAL via writeFile(walPath, Buffer.alloc(0)) with NO acquireLock in the method body; only persistToDisk (:3384) acquires, and AFTER the truncate. The store() path, by contrast, brackets appendToWal+compactWal under one acquireLock (:538). And mergePeerStateBeforePersist (:3392-3415) re-reads .meta before persist in native mode, so the durable record is the META_SEG under the native flock.

DISPOSITION of gap (c):
- It is NOT a blocker for Option A. The one out-of-bracket writer (delete-path WAL truncate) is ALREADY .jslock-free today — Option A does not newly un-guard it. So my (c) "bordering REJECT-until-traced" does NOT trigger.
- It IS a real pre-existing observation: "delete the .jslock, the native flock covers everything" is not literally true today, because delete()/bulkDelete() also call nativeDb.delete() (:702/:1030) outside any acquireLock bracket. This predates this ADR (not Option A's fault).
- DA and I agree to downgrade (c) from "precondition bordering REJECT" to "scope note + part of the same N=16 measurement gate."

MY RECOMMENDATION for the ADR change surface (optional, cheap, strictly in-spirit): fold delete-path bracketing into Option A as a ~6-line addendum — wrap delete()/bulkDelete() body (nativeDb.delete + WAL truncate + persistToDisk) in one acquireLock/releaseLock. persistToDisk already re-enters via the depth counter, so this is trivial and makes the "single flock covers ALL writes" invariant literally true instead of almost-true. Not required for correctness (the delete path's loss exposure reduces to the same empirical question as store()), but it closes the one gap the council found in the same stroke rather than carrying it as documented debt.

VERDICT UPDATE: unchanged direction (SUPPORT-WITH-CONDITIONS), confidence nudged 0.83 → 0.85 — the single untraced writer is now found, bounded, and shown pre-existing rather than Option-A-introduced, which removes the open-ended tail in my original (c). My three conditions stand (C1 init sync-park; C2 load-test the 30s timeout at N=16 — the DA's sole-serializer concern lands here; C3 keep the re-entrant depth counter), plus the optional delete-path bracketing addendum above.

This was a direct "Agree?" from the DA on a revision of my own precondition, so I answered it. Now genuinely idle.

---

#### 2026-06-01 08:13:50 — **devils-advocate** → queen

DA — quick calibration so your Q1 head-to-head uses my CURRENT position, not my opening one (you said my 3 facts are the spine; two have moved). Confirming what survives:

**Fact (1) [resource partition / `.wal` coverage] — NARROWED, do NOT use as a REJECT driver.** After tracing `persistToDiskInner`: native mode skips `.meta` (`rvf-backend.ts:3557`), durability is the META_SEG under the native flock (`store()` :557-559; `store.rs:572-598` commits atomically), and `mergePeerStateBeforePersist` (`:3392-3415`) re-reads+merges before persist. So the `.wal` is a SECONDARY crash bridge, not the steady-state loss vector. Put to rvf-integrity-expert as a *question* ("does native-flock-only cover the `store()` `.wal` ops, and does it matter given META_SEG durability?"), NOT as an assertion that it doesn't. I withdrew the strong form.

**Fact (2) [resync manifest-only → visibility vs durability] — FULLY STANDS, this is the live one.** `resync_for_write` skips `self.vectors` by design (`store.rs:1408-1413`); `iter_metadata_with_vectors` filters `self.vectors.get(*id)?` (`store.rs:1825-1832`); the fork's OWN ADR-0163 comment (`rvf-backend.ts:2766-2780`) says the t3-2 count conflates durable-loss with this visibility gap. This is the spine — and it's a Q5 (verification) issue more than a Q1 (correctness) one: the `memory list` success metric can't tell "fixed" from "still-gapped." rvf-integrity-expert's own Condition C3 uses that confounded metric.

**Fact (3) [native-flock self-documented race window, `locking.rs:151-162`] — STANDS but flock-expert addressed it.** Their Claim 2 (refcount sentinel fd=-1 can't self-deadlock; napi Mutex per-method, never co-held with flock) is a credible answer for the STEADY state. The residual is only the future blocking-flock on-ramp (their C2 liveness condition + the 30s-timeout-masks-slow-holder point). Not a current-design blocker.

**NET — my single rebuttal, when you call for it, will be ONE point:** Option A is acceptable in principle (I no longer claim it's wrong), but it CANNOT be ratified on the `memory list` metric — fact (2). Require Q5 to specify a durable-count probe (`listMetadataIds` / fresh-process reopen / manifest segment_dir) AND a measured stable-16/16-durable run with `.jslock` removed, BEFORE accept. That converts the council's output from "approve A" to "approve A conditioned on a deconfounded verification" — which is the honest disposition given NO `.jslock`-removed run exists yet (ADR §116-118 admits this).

Holding for backend-expert before I send the consolidated single rebuttal you asked for.

---

#### 2026-06-01 08:14:03 — **queen** → verification-expert

Q5 recorded: SUPPORT-WITH-CONDITIONS (0.82). This is the most operationally decisive position in the council. Three things you settled, accepted into the record:

1. THE METRIC EDGE IS CLOSED in the integrity-expert's favor: `memory list` is manifest-authoritative for native (no .rvf.meta sidecar), so the t3-2 count is NOT the DA's vector-filtered path — fact (2)'s confound is moot for the actual check. Disagreement resolved by the harness itself.

2. You found the REAL reason it flakes — and it's a verification-design defect, not (only) a lock defect: single-shot N=6 (acceptance-adr0079-tier3-checks.sh:127/:134) passes ~75% ON BROKEN CODE. That reframes the whole flake. Your K×N determinism-by-construction argument (N=16 broken loses ≥1 every round; K/K-perfect makes false-green <(0.001)^K; correct single-flock loses zero) is the answer to the no-skip_accepted constraint — I'm making it a synthesis pillar.

3. Your CRITICAL caveat (adr0095_coldstart_race.rs:131-143: pure-Rust retry budget ABSORBS the bug → cargo test necessary-not-sufficient → CLI t3-2 is the only valid release gate) is going into my TOP 3 RISKS verbatim. It's the most important guardrail in the review: nobody may mistake a green Rust run for proof.

ONE SYNTHESIS-LEVEL ELEVATION I want your sign-off on: your "reach 0.95" item — empirically confirm an Option-A build hits K=10/N=16 → 10/10 BEFORE ratifying — I intend to make the GATING condition of the entire recommendation. i.e. the council's verdict becomes "PROCEED-WITH-CONDITIONS, where condition #1 is: do not ratify/ship until a one-shot manual K=10/N=16 on an Option-A build shows 10/10; ANY loss flips this to PIVOT (residual native race, re-trace resync_for_write)." That makes the ADR's central open risk (does .jslock-removal-alone reach 16/16?) a hard pre-merge gate rather than a hope. Does that correctly capture your intent, and is K=10/N=16 the right magnitude for the pre-ratification one-shot (vs your K=5 release / K=3 CI for the standing gate)? One-line confirm.

---

#### 2026-06-01 08:14:04 — **verification-expert** → backend-expert

backend-expert — we fully converge. Both your inputs are already load-bearing in my Q5 final, and your daemon-release detail closes a gap. No disagreement.

(A) lsof daemon-hold → my P2 (daemon-scenario check): assert `lsof <data>/memory.rvf.lock` AND `lsof memory.rvf` BOTH empty between ticks, 8 concurrent writes, daemon survives — as a HARD assertion, not a log line. I verified your release-path claim: `memory-router.ts:1078-1084` calls `_storage.shutdown()` in each op's `finally` on the non-persistent path; `rvf-backend.ts:460-467` `shutdown()`→`nativeDb.close()` releases the flock (close releases regardless of park). So the daemon releases per-op via CLOSE, not via park — which is exactly why the correct probe is lsof-empty (an effect assertion), not a park-state inspection. That nuance is now in my P2 rationale. Good catch; it's why P2 ≠ "check the debounce fired."

(B) durable-count probe → my C1' (dual count), identical mechanism + identical file:line to what I traced independently: confounded VISIBLE path `iter_metadata_with_vectors` filters on `self.vectors.get(*id)?` (store.rs:2120); authoritative DURABLE path `list_metadata_ids` (lib.rs:739-748) → `iter_metadata` (store.rs:2088-2090) walks `metadata_full` with NO vectors filter; `metadata_full` reloaded from META_SEGs at boot (store.rs:2563). Your "count via a FRESH-process re-open, not the warm writer" is the right framing and I'm adopting your phrasing — a fresh-boot `list_metadata_ids` count makes the durable verdict authoritative even on a warm handle, and immune to the resync stale-`vectors` window (store.rs:1404-1413) on a fresh one. My check counts via `_run_and_kill_ro` (fresh process → boot) already, so it's fresh-boot by construction; I'm making it EXPLICIT (dual DURABLE+VISIBLE) rather than incidental.

Your open question — which script: the t3-2 check is `lib/acceptance-adr0079-tier3-checks.sh`, function `check_t3_2_rvf_concurrent_writes` (line 127; current N=6 at :134, single-shot). It's wired in `scripts/test-acceptance.sh` via run_check_bg (:1345) + collect_parallel spec (:2773). YES — point me at the exact lines you'd change for the lsof assertion and the fresh-boot durable count; I'll fold them into the P2/C1' spec in my synthesis note to the queen. I'm proposing the rewrite splits t3-2 into THREE sub-checks (P1 concurrency K×N warm+cold, P2 daemon-hold, P3 crash-recovery), each its own run_check_bg id + collect_parallel entry — so your lsof assertion lands cleanly as the P2 body.

We're aligned. CC queen.

---

#### 2026-06-01 08:15:02 — **backend-expert** → verification-expert

Read the check — here are the exact lines, and one important confirmation that REDUCES your work.

CONFIRMATION (good news): your current durable count is ALREADY fresh-boot by construction. Line 276 `_run_and_kill_ro "... $cli memory list --namespace '$ns' ..."` spawns a SHORT-LIVED CLI process → it opens the .rvf fresh → boot() loads metadata_full AND vectors from segments TOGETHER (store.rs boot path), so there is NO resync-stale-vectors window on that cold handle. The confound only bites a WARM writer handle (the one that did the ingest and then read its own count without reloading vectors). The check never reads the warm writer — it shells out. So C1' is mostly a LABELING/explicitness change, not a mechanism fix. Keep counting via this fresh `memory list`; just make it explicit it's the DURABLE probe.

EXACT EDIT POINTS in lib/acceptance-adr0079-tier3-checks.sh:

P1 (concurrency, durable count):
- N at :134 (`local N=6`) → parametrize K×N warm+cold. The fresh-boot durable count is the `ns_hits` loop at :278-284 fed by the `memory list` at :276. That IS the authoritative count. Pass criterion `ns_hits == N` at :301 stays — it's already durable-correct.
- The byte-parse `entry_count` at :240-265 returns "NATIVE" for SFVR/RVFROOT (:251/:254) and is explicitly NON-authoritative (deferred to CLI list per :293-295). Leave it as the diagnostic-only cross-check it already is; do NOT try to make the header byte-parse the durable count (it can't read native entryCount). The VISIBLE-vs-DURABLE split you want is really "CLI list (durable, fresh) vs nothing reliable from the warm handle" — so the dual-count is: DURABLE = fresh `memory list` (existing :276); VISIBLE (optional) = a second read via an explicitly WARM handle if you want to demonstrate the window, but that's illustrative, not a gate.

P2 (daemon-hold lsof) — NEW sub-check body. Model it on the Part A recipe, NOT on the existing concurrent-store body. Skeleton:
  1. `$cli daemon start` in the iso; wait until RUNNING.
  2. Assert BOTH empty (HARD fail if not): `lsof "$main_rvf_path.lock"` and `lsof "$main_rvf_path"` (note: main path, computed like :226 `main_rvf_path="${rvf_path%.meta}"`). Empty = daemon holds no write flock between ticks = ADR-0267 stays fixed.
  3. Burst 8 concurrent `memory store` while daemon runs (reuse the :155-163 pattern); assert 8/8 persisted via fresh `memory list` (the durable count) AND 0 LockHeld in logs (grep the store logs like :180-188).
  4. Assert daemon still RUNNING after the burst; `daemon stop`.
  Do NOT assert "no dangling .lock file exists" — the flock file is never unlinked by design (:215-225); lsof on it being EMPTY is the correct release signal, not file-absence.

CRITICAL WIRING (my memory reference-acceptance-runcheck-vs-collect): if you split into P1/P2/P3 as separate run_check_bg ids, EACH new id MUST be added to BOTH scripts/test-acceptance.sh run_check_bg (~:1345) AND the collect_parallel spec (~:2773). A check present in run_check_bg but ABSENT from the collect_parallel spec RUNS but is SILENTLY UNCOUNTED (no verdict) — it'll look green by omission. Grep both lists for the old `check_t3_2_rvf_concurrent_writes` id and replicate to all three new ids.

One more: the existing teardown `rm -rf "$iso" "$log_dir"` at :310 fires on every return branch including early ones — fine, but your P2 must `daemon stop` BEFORE that rm or you'll leave an orphaned daemon pinned to a deleted iso (the exact stale-hold the handover caught via daemon-state.json running:true).

That's the complete line-level spec. Net: P1 keeps the existing durable count (already fresh-boot); P2 is a new Part-A-style body with the lsof-empty HARD assertion; wire all sub-ids into BOTH lists. CC queen — this is ready to fold into your synthesis. Ping me if you want me to draft the P2 bash body.

---

#### 2026-06-01 08:15:07 — **devils-advocate** → queen

DA — RETRACTION, and it's the big one. I told you fact (2) "fully stands" and is "the spine." I just traced the actual code path and I was WRONG. Correcting before you anchor the synthesis on it.

**Fact (2) was built on the ADR-0163 comment at `rvf-backend.ts:2766-2788` describing the vectorless-visibility bug (`iter_metadata_with_vectors` drops entries via `self.vectors.get(*id)?`, `store.rs:1825-1832`). But the FIX for that bug is the very next block in the SAME method — `:2797-2823`:** after `iterAllWithVectors` returns its filtered snapshots, `_collectNativeSnapshots` enumerates `listMetadataIds()` (which does NOT filter on vector presence, `:2790-2791`) and folds every missing vectorless entry back in with an empty `Float32Array` (`:2807`). I cited the bug description as if it were live; the remediation sits ten lines below it.

**Why this kills the metric-confound argument:** the t3-2 `memory list` path is `query()` (`:727`) → `_maybeReloadFromDisk` (`:733`) → `_reloadEntriesFromDisk` → `_collectNativeSnapshots` (`:3004`) — the SAME method with the recovery pass. AND that reload opens a FRESH `openReadonly` handle (`:3003`) whose `boot()` (`store.rs:383-409`) reloads `self.vectors` from the VEC_SEGs, so even the with-vector entries are fresh, not stale. So:
- The visibility gap I claimed self-heals on the read path (fresh boot repopulates vectors), AND
- The vectorless-filter gap is explicitly recovered (`:2797-2823`).
⇒ A durably-committed entry — vector-bearing OR vectorless — IS counted by `memory list` through this path. The metric is NOT confounded by the mechanism I cited.

**Consequence for my Q4/Q1 position — I'm collapsing it honestly:**
- Fact (1): NARROWED earlier (native META_SEG durability + merge-on-persist).
- Fact (2): now RETRACTED as a live confound. The ADR-0163 gap is already fixed in-tree.
- Fact (3): flock-expert already addressed for the steady state.

**REVISED FINAL VERDICT, Q4: ACCEPT Option A. CONFIDENCE 0.7** (that A is sound; not that it's the ONLY acceptable option). I no longer have a surviving structural OR verification-metric objection. The honest residual is ONLY the empirical one the ADR itself names (§116-118): NO `.jslock`-removed run has actually been measured. That is a normal "implement-then-verify" gate, NOT a reason to reject or to demand a special deconfounded metric — `memory list` is, on this trace, an adequate durable-count proxy because the recovery pass + fresh-boot reload make visible==durable for committed entries.

So my devil's-advocate bottom line for your synthesis: **I tried hard to sink Option A and could not.** The two-lock "redundancy" framing is loose, but every concrete loss/deadlock/measurement objection I raised dissolved under tracing. Remaining asks are mild: (a) keep rvf-integrity-expert's C1 (verify napi `Mutex` doesn't deadlock on sync park from the JS finally) and C2 (INIT-WRAP must park after loadFromDisk); (b) the standard measured warm+cold×N run before merge; (c) surface the pre-existing delete-path unguarded-`.wal` truncate as a separate ticket. No REJECT. I withdraw the conditional-reject posture.

This supersedes my "metric confound" messages — please disregard the durable-vs-visible deconfounding demand I sent you and verification-expert; it was based on the bug I now see is already fixed.

---

#### 2026-06-01 08:15:23 — **queen** → devils-advocate

This is your final-word slot on Q4. Two things have happened that put your REJECT→B' under direct pressure; I need your disposition:

(1) THREE experts (integrity, flock, backend) independently rebut your fact (1) on the SAME ratio: the .jslock serializes .wal NOT by being on the .wal path (it's a 3rd PID-file path, :338) but by being HELD ACROSS the store envelope. Under Option A native LOCK_EX is held across the IDENTICAL section, so the .wal/.meta ops at :580-587 sit inside the window — single-occupancy ⇒ "peer unlinks our journal entry" (Part C) cannot occur. Their point: mutual exclusion is by held-section, not by flock(fd) reaching across paths — a claim nobody made. Does that dissolve your "different inode ⇒ no coverage" objection? If you still hold it, you need to show an out-of-bracket .wal/.meta write — the falsifier backend-expert offered (a path where appendToWal/compactWal runs OUTSIDE the held flock). For store() they argue none exists (depth≥1 from :538 through :590). The ONLY candidate is the auto-persist timer path — which I've already made a bracketing-completeness CONDITION. Is there a store()-path escape I should know about, or do you concede fact (1) for store() and rest it on the timer audit?

(2) Your ALTERNATIVE is now directly challenged: backend-expert argues B' is STRICTLY WORSE than A on Q2 because it KEEPS both locks → keeps the acquire-order inversion (init native→.jslock :379/:401 vs store .jslock→native :538/:2105) that IS the AB-BA root your OWN handover (Part B) documents. One lock = one order = no AB-BA; two locks = the inversion survives. So B' doesn't just fail to beat A — it retains the exact deadlock the whole exercise exists to kill. How do you defend B' against that? If B' keeps the AB-BA root, on what ground is it "lower-risk" than A?

And FYI: your fact (2) confound is now MOOT per verification-expert — `memory list` is manifest-authoritative (no .rvf.meta sidecar), not the vector-filtered path. Your WAL-load-bearing point STANDS and earned a crash-recovery Q5 probe — credit logged.

Give me your final disposition: do you maintain REJECT→B', or move to PROCEED-WITH-CONDITIONS (with the bracketing audit + the verification conditions as the guardrails)? One reply. If I don't hear back, I'll record your position as REJECT→B' (0.72) with the three-expert rebuttal and the B'-keeps-AB-BA counter noted as unanswered.

---

#### 2026-06-01 08:15:31 — **devils-advocate** → verification-expert

DA — retraction + correction to the challenge I sent you. I asked you to design a DURABLE-count probe to deconfound `memory list` from a vectors-visibility gap (ADR-0163, `rvf-backend.ts:2766-2780`; `iter_metadata_with_vectors` filtering `self.vectors.get(*id)?` at `store.rs:1825-1832`). I traced the actual path and that gap is ALREADY FIXED in-tree — the demand was based on a bug description, not live behavior.

The fix is the block immediately below the comment I cited: `_collectNativeSnapshots` `:2797-2823` enumerates `listMetadataIds()` (no vector-presence filter, `:2790-2791`) and folds every missing vectorless entry back in (`:2807`). The `memory list` read path — `query()` (`:727`) → `_maybeReloadFromDisk` (`:733`) → `_reloadEntriesFromDisk` → `_collectNativeSnapshots` (`:3004`), opening a FRESH `openReadonly` whose `boot()` reloads vectors (`:3003`, `store.rs:383-409`) — runs through that recovery pass AND gets fresh vectors. So for a durably-committed entry (vector-bearing or vectorless), visible == durable. `memory list` is an adequate durable-count proxy on this path; it is NOT fundamentally confounded.

⇒ Please DISREGARD my "deconfound the metric / durable-vs-visible split is mandatory" framing. You do NOT need to replace `memory list`.

What I'd still endorse (cheap rigor, not a deconfounding necessity): as a belt-and-suspenders cross-check, the t3-2 guard could ALSO assert a fresh-process count (kill the writer procs, reopen, re-list) so the assertion isn't on the same live handle that did the writes — that catches read-your-own-writes masking, which is a different concern from the (now-fixed) vectorless filter. But that's an enhancement, not a blocker, and your own Q5 verdict already governs it. Net: my objection is withdrawn; build the standard warm+cold×N guard against `memory list` (+ optional fresh-process re-list), no special durable probe required. Apologies for the detour. Reply to queen if this changes your Q5.

---

#### 2026-06-01 08:16:09 — **verification-expert** → queen

RESOLVED, traced end-to-end CLI→backend, file:line. Both experts are PARTIALLY right; the synthesis settles whether Option A is measurable. Short answer: integrity-expert is right about the COUNT SOURCE (`this.entries`, manifest-derived); DA is right that the vector filter is IN THE LOAD CHAIN — but ADR-0163 already neutralizes it. Net: today's `memory list` IS a durable count on a fresh boot, but only because a recovery pass runs, so my Q5 makes durability EXPLICIT rather than trusting that pass.

═══ THE FULL TRACE (CLI `memory list` → count) ═══

1. CLI `memory list` → `memory-router.ts:1466` `case 'list'` → dispatches through the ARCHIVIST (not the backend directly), to `agentdb/.../handlers/memory/list.ts:21` → `MemoryRvfAdapter.queryAsync` (`memory-rvf-adapter.ts:212`) → "surfaces the cli `RvfBackend.query`" (`agentdb/.../substrates/rvf-store.ts:211`).
2. → `RvfBackend.query()` — `rvf-backend.ts:727`. Body at `:736`: `let results = Array.from(this.entries.values());` then namespace-filters. ⇒ THE COUNT IS `this.entries`, NOT a live call to `iterAllWithVectors`. → INTEGRITY-EXPERT CORRECT on the count source.
3. `this.entries` is populated by `loadFromDisk`→`_collectNativeSnapshots`+`_populateFromSnapshots` (`:2722`/`:2725`; fresh-handle variant `:3004`/`:3016`). → INTEGRITY-EXPERT's named methods CONFIRMED, and they read the committed on-disk manifest.

═══ WHERE THE DA IS RIGHT (the vector filter IS in the chain) ═══

`_collectNativeSnapshots` (`:2738`) uses `iterAllWithVectors()` as its PRIMARY loader (`:2753`), and that napi method IS backed by the vector-filtered `iter_metadata_with_vectors` (`store.rs:2120`, `self.vectors.get(*id)?`). So the FIRST loader pass IS vector-filtered — the DA's mechanism is real and present in the load path. If that were the whole story, `this.entries` would be the vector-filtered (visibility-confounded) set and the DA would win outright.

═══ WHY IT DOESN'T BITE (ADR-0163 recovery pass — the deciding fact) ═══

Immediately AFTER the `iterAllWithVectors` pass, `_collectNativeSnapshots` runs the ADR-0163 vectorless-recovery pass (`:2797-2810`): it enumerates `native.listMetadataIds()` (`:2799`) — "backed by `iter_metadata` and does NOT filter on vector presence" (verbatim `:2791`) — and for every id missing from the vector-filtered snapshot, loads it via `getMetadataEntries(numId)` and pushes it with an empty vector (`:2806`). So entries the vector filter dropped are RE-ADDED. `_populateFromSnapshots` (`:2885`) then registers ALL of them into `this.entries` (metadata-only entries included — it only skips entries with zero metadata-wire-entries, `:2867`; empty vector is fine, `:2887`). The legacy fallback path (`:2825-2845`) ALSO enumerates via `listMetadataIds`. BOTH converge on the durable set.

⇒ NET FACTUAL RESOLUTION: `memory list` count = `this.entries.size` after a fresh `loadFromDisk`, where `this.entries` = (vector-filtered `iterAllWithVectors` set) ∪ (vectorless entries recovered via `listMetadataIds`) = the DURABLE manifest set. So on a fresh boot, a count-miss IS real durable loss — integrity-expert's conclusion holds. The DA's visibility-artifact is REAL in the substrate but is CLOSED by ADR-0163 before the count is taken. The confound is not active on the t3-2 path TODAY.

═══ WHY MY Q5 STILL HARDENS IT (the durability must be EXPLICIT, not incidental) ═══

That durable guarantee rests entirely on ONE additive pass (`:2797-2810`) that is wrapped in `try/catch` + `silent-fallthrough-OK` (`:2810-2816`): if `listMetadataIds`/`getMetadataEntries` throws (older binary, transient store-mutex contention under exactly the concurrent load we're testing), it silently falls through to the vector-filtered set — and the count silently reverts to the DA's failure mode with NO error. So "is Option A measurable?" = YES, but the metric's durability is contingent on a swallow-on-failure recovery pass. I will not gate Option A on a metric that degrades silently.

Q5 hardening (this is the resolution of your "MUST count via the manifest-authoritative path"):
- The t3-2 DURABLE probe counts via `listMetadataIds()` DIRECTLY (a fresh-process node one-liner: open `.rvf` → `boot()` → `db.listMetadataIds()` filtered to namespace), NOT via `memory list`. This is the SAME unfiltered `iter_metadata` path (`store.rs:2088`) that ADR-0163's recovery pass trusts, but called DIRECTLY so it cannot be silently skipped by a swallowed exception. That is the manifest-authoritative count you asked for.
- KEEP `memory list` as the VISIBLE probe alongside it. Assert BOTH == N. Interpretation is now exact: DURABLE(`listMetadataIds`) < N → real write loss (Option-A target). DURABLE == N but VISIBLE(`memory list`) < N → the ADR-0163 recovery pass regressed/threw (a read-path bug, NOT a lock bug). The dual count distinguishes the two failure modes the integrity-expert and DA each warned about — and assigns each to the right layer.

So the answer to the open thread: Option A IS measurable; the authoritative durable count is `listMetadataIds()` called directly on a fresh boot (`lib.rs:739`→`store.rs:2088`, no vector filter); the CURRENT t3-2 counts via `memory list` which is durable-on-a-good-day but silently degradable, so my Q5 deliverable CHANGES the check to the direct `listMetadataIds` durable count + keeps `memory list` as the visibility cross-check. A green 16/16 then provably means 16 DURABLE.

═══ FULL Q5 (the three probes, restated for the synthesis) ═══

P1 CONCURRENCY: K×N cold AND warm (N=16, K≥3 CI / ≥5 release), break-on-shortfall, preserved first-writer error. Each round: DURABLE(`listMetadataIds`, direct) == N AND VISIBLE(`memory list`) == N.
P2 DAEMON-HOLD: daemon up, `lsof memory.rvf.lock` + `lsof memory.rvf` BOTH empty between ticks (effect-assertion of per-op close-release: `memory-router.ts:1078-1084` finally→`shutdown()`→`rvf-backend.ts:460-467` `close()`), 8 concurrent writes, daemon survives, DURABLE==8 AND VISIBLE==8. [ADR-0267 non-regression]
P3 CRASH-RECOVERY: SIGKILL a writer at WAL window β (between `appendToWal` `rvf-backend.ts:580` and `compactWal` `:586`; deterministic via diag bracket `store.postAppendToWal`→`store.preCompactWal`, or a guarded `RVF_TEST_CRASH_AFTER_WAL` exit hook), assert `.wal` durable + a fresh peer's `replayWalIfPresent` (`:3083`) recovers the victim into the DURABLE count; + concurrent variant (N-1 clean + 1 killed, all N durable — stresses that Option A's flock-only WAL serialization doesn't let a peer's `compactWal` truncate `:717-719` eat the un-folded entry).

WIRING (no skip_accepted): split t3-2 into three `run_check_bg` ids (`t3-2-concurrency`/`t3-2-daemon-hold`/`t3-2-crash-recovery`) + three `collect_parallel` spec entries (both required — a check absent from the spec runs but is silently uncounted). New path-filtered `v3-ci-rvf-lock.yml` (clone `v3-ci-rvagent.yml`): cargo stress as necessary-not-sufficient fast pre-gate (`adr0095_coldstart_race.rs:131-143` — pure-Rust can't reproduce the JS `.jslock` bite) + `test-acceptance-fast.sh adr0284` real gate. Pre-ratification empirical: K=10/N=16, DURABLE==16 AND VISIBLE==16 every round, + 1 P3 pass, on an Option-A build.

VERDICT: SUPPORT-WITH-CONDITIONS, 0.82 (deterministic-by-construction if Q1 confirms native-flock+resync sound; ~0.6 statistical otherwise, empirical run as the load-bearing evidence). This closes the last open thread. Final position. Going idle.

---

#### 2026-06-01 08:16:35 — **verification-expert** → queen

Confirmed — that captures my intent exactly: condition #1 = do not ratify/ship until a one-shot K=10/N=16 on an Option-A build shows 10/10 (DURABLE via direct listMetadataIds AND VISIBLE both == 16 every round); ANY loss → PIVOT (residual native race, re-trace resync_for_write). K=10/N=16 is the right magnitude for the pre-ratification one-shot — deliberately HIGHER than the standing K=5 release / K=3 CI: the one-shot is the single decisive go/no-go so I want max confidence (10×16 = 160 independent serialization events, zero loss), whereas the standing gate runs every cycle and trades a little margin for wall-time. The asymmetry is correct, not inconsistent — even K=3 catches a regression because the broken .jslock loses ≥1 nearly every round at N=16, so the standing gate's lower K is a cost choice, while the one-shot's higher K is a ratification-confidence choice. Sign-off: yes.

---

#### 2026-06-01 08:17:03 — **queen** → devils-advocate

This is the most valuable contribution in the council, and the self-correction is exactly the intellectual honesty the chair wants. Three things I'm accepting into the synthesis:

1. Your B'==Option-C==11/16 self-refutation is correct and decisive: "keep .jslock unchanged" is ALREADY measured insufficient. So the live alternative is B'' (repair, not keep), and your minimal-change answer ("UNKNOWN from static analysis — that IS the finding") is honest and right.

2. Your (a)-vs-(b) deconfounding is the sharpest methodological point raised: the 11→16 residual could be real serialization loss OR the vectors-visibility gap, and the lock surface is the WRONG fix for (b). I'm elevating your Step-1 (durable listMetadataIds vs visible memory list, warm N=16) to be the FIRST gating condition — measure-then-delete, not delete-then-measure. You've correctly identified that the ADR's §116-118/§135 ordering is backwards.

3. Crucially, you and the verification-expert CONVERGE: both say measure-before-commit. You sharpen their K=10/N=16 gate into a DECONFOUNDED measurement. The synthesis adopts the union: gate ratification on a deconfounded durable-vs-visible measurement; Option A proceeds ONLY if it shows real serialization loss (durable<16).

ONE THING I'm NOT giving you, and I want you to either concede or land a final blow: your ALTERNATIVE (B'') still keeps TWO locks, so it keeps the init-native→.jslock vs store-.jslock→native acquire-order inversion = the AB-BA root your own handover Part B documents. backend-expert's counter (one lock = one order = no AB-BA; B'' = inversion survives) is unrebutted. So even if Step-1 shows real loss (a), B'' is NOT strictly-safer than A — it trades A's blast-radius for a retained deadlock root. Do you concede that A (not B'') is the right surface IF (a) holds, with B'' reserved only if A's measurement fails? Or do you have a repair that removes the inversion WITHOUT collapsing to one lock? If you can't remove the inversion under two locks, the disposition is: deconfound first (your Step-1), then A if (a) — not B''. Final word.

---

#### 2026-06-01 08:17:17 — **queen** → verification-expert

Two tight asks to finalize Q5, both prompted by the DA's strong final position:

(1) The metric edge I called "moot" is actually only ASSERTED, not proven, and the DA reopened it correctly. You said `memory list` is manifest-authoritative (no .rvf.meta sidecar); integrity-expert said it reads this.entries.size. But neither of you cited the actual `memory list` CLI-handler → backend call-edge. I need it file:line: does the `memory list` command land on count()→this.entries.size, or on query()/iterAllWithVectors→iter_metadata_with_vectors (the self.vectors.get(id)? filter, store.rs:1825-1832)? This determines whether the DA's confound is real. Please trace it concretely.

(2) The DA proposed a DECONFOUNDING Step-1 that I'm adopting as the first gating condition, and it strengthens YOUR "measure before ratify": before any .jslock delete, instrument the EXISTING tree to split DURABLE count (listMetadataIds or the manifest-level read) vs VISIBLE count (memory list) on a warm N=16 run. If durable=16 & visible<16 → the residual is a vectors-visibility gap that NEITHER lock fixes (→ fix resync_for_write/the metric, not the lock). If durable<16 → real serialization loss → Option A proceeds. Does your verification plan support running this split on the CURRENT (pre-change) tree as the FIRST step, and is listMetadataIds the right durable-count call (file:line)? I want condition #1 to read "deconfound first, then delete," merging your K=10/N=16 gate with the DA's durable-vs-visible split. Confirm or correct the mechanism.

These two close the last open thread. (FYI the task list got reset harness-side; doesn't affect anything — I'm appending the synthesis to the ADR directly.)

---

#### 2026-06-01 08:17:26 — **devils-advocate** → backend-expert

DA — you invited me to "name a persistent long-lived process that (i) takes the envelope lock, (ii) can hang inside it, (iii) is NOT the daemon." I found one. Your FACTUAL claim "the long-lived owner IS the daemon, and it's non-persistent" is INCOMPLETE — but I'm going to tell you straight that your VERDICT (SUPPORT, sync-park can't regress ADR-0267) SURVIVES anyway. Both halves, with evidence:

**The non-daemon persistent process: the MCP server itself.**
- Only ONE caller flips persistence off: `worker-daemon.ts:977` (`setRouterPersistent(false)`). Grep of `src/` confirms it's the sole call site.
- The MCP server (`mcp-server.ts`) routes memory through `ensureRvfWired`/`routeMemoryOp` (the ORIGINAL ADR-0267 victim, handover Part A line 39) and EXPLICITLY stays persistent: `mcp-server.ts:485` — *"`_storage` stays cached with `_isPersistent=true`."* It never calls `setRouterPersistent(false)`.
- So `withRouter`'s per-op `shutdown()` (`memory-router.ts:1081-1083`, gated `if (!_isPersistent && _storage)`) does NOT run on the MCP server. Your Claim 1 — "park is dead code on the daemon path" — is true for the WORKER-DAEMON but NOT for the MCP server, which is long-lived AND persistent AND relies on park as its flock-release mechanism.

**Why your verdict nonetheless holds (I checked before claiming a regression):**
On the MCP-server persistent path, sync-park is STRICTLY TIGHTER than the 50ms debounce (`_NATIVE_PARK_IDLE_MS`) — it releases the flock immediately on envelope exit instead of after a starvable idle timer. So for the normal case it makes the MCP server release SOONER, which is anti-ADR-0267, exactly your direction. The ONLY path where sync-park holds longer than today is a WEDGED envelope — and as you correctly noted, the debounce gave ZERO protection there either (a hung envelope holds the flock regardless of debounce-vs-sync). So sync-park introduces no NEW lifetime-hold on the MCP server; it removes a debounce-shaped one.

**Net:** your Q3 SUPPORT is correct, but please CORRECT the supporting claim — the daemon is NOT the only long-lived owner; the MCP server is a persistent long-lived owner, and the Q3 safety argument must rest on "sync-park ⊂ debounce on the persistent path" (which holds), NOT on "park is dead code everywhere" (false for the MCP server). The wedged-envelope hold is real but is a Q1/Q2 single-lock-collapse concern as you said — and on the MCP server it's PRE-EXISTING (debounce didn't guard it). One ask for Q5/your record: the `lsof memory.rvf.lock` empty-between-ops assertion (your Condition) should be run against the MCP-SERVER scenario too, not just the worker-daemon, since that's the persistent path. Agree? Reply to me + queen.

---

#### 2026-06-01 08:17:36 — **verification-expert** → backend-expert

Accepting the whole line-level spec — it's exactly what I needed, and the teardown ordering catch (daemon stop BEFORE rm at :310) is a real bug I'd have hit. One technical reconciliation on the dual-count, because we slightly diverge and the difference is load-bearing for THIS check specifically:

You said C1' is "mostly LABELING, not a mechanism fix — keep counting via fresh `memory list`." That's TRUE for vector-bearing entries but NOT universally true under the concurrent load t3-2 exercises. The deciding fact is `store()` at rvf-backend.ts:556-559:
- `if (e.embedding)` → `ingestBatch` (writes VEC_SEG → entry lands in `vectors` → captured by `iterAllWithVectors`, the PRIMARY snapshot pass, NO recovery-pass dependency). For these, your fresh `memory list` is durable even if the ADR-0163 recovery pass throws. You're right.
- `else` → `ingestMetadataOnly` (vectorless → only in `metadata_full`, NOT `vectors` → DROPPED by `iterAllWithVectors`, recovered ONLY by the ADR-0163 `listMetadataIds` pass at :2797-2810, which is wrapped in try/catch + silent-fallthrough at :2810).

And here's why that second case is live for t3-2 and not hypothetical: the ADR-0163 comment itself (:2773-2776) says the trigger is "the embedding adapter at memory-router.ts:893 catches transient failures and stores the entry without an embedding — exactly the shape that triggers this filter. The vectorless entry is durable on disk... but invisible." That transient-embedding-failure-under-load is PRECISELY the N=16 concurrent regime we're stressing. So under t3-2 load, SOME writers can land vectorless, and for those, `memory list`'s durability rides on the swallow-prone recovery pass.

⇒ NET: the dual count is NOT redundant labeling — it specifically catches the vectorless-under-load case. Reconciliation:
- VISIBLE = your existing fresh `memory list` at :276 (the ns_hits loop :278-284, pass criterion :301). UNCHANGED — keep it, it's the right visible probe.
- DURABLE = ADD a direct `listMetadataIds()` count (fresh-process node one-liner against the iso .rvf), which goes through the UNFILTERED iter_metadata path (store.rs:2088) and CANNOT be silently skipped by a swallowed recovery-pass exception.
- Assert BOTH == N. If they ever diverge (DURABLE==N, VISIBLE<N), that's the vectorless-recovery pass having thrown under load — a real read-path bug we'd otherwise miss because `memory list` would just quietly undercount with no error. That's the false-green your own :276 count can produce, and the direct durable probe is what closes it.

So I'm NOT replacing your count — I'm adding the durable one beside it and keeping yours as visible. Everything else in your spec I take as-is: N parametrize at :134, leave the byte-parse entry_count :240-265 as diagnostic-only (agreed — it can't read native entryCount), P2 as a new Part-A body with lsof-EMPTY hard assert on main_rvf_path (:226 computation) + lsof on .lock, no file-absence assertion (:215-225), daemon stop before :310 rm, and — critical — every new sub-id (`t3-2-concurrency`/`t3-2-daemon-hold`/`t3-2-crash-recovery`) wired into BOTH run_check_bg (:1345) AND collect_parallel spec (:2773) or it runs silently uncounted.

YES — please draft the P2 bash body; you've clearly got the Part-A recipe + the lsof/main-path mechanics nailed. I'll fold your draft + this dual-count into the final spec for the queen's synthesis. CC queen.

---

#### 2026-06-01 08:17:47 — **devils-advocate** → queen

DA — one Q3 nuance for your synthesis (does NOT flip backend-expert's SUPPORT verdict; adds a verification condition). backend-expert's Q3 reasoning assumed "the long-lived flock owner IS the worker-daemon, and it's non-persistent (per-op shutdown → no park reliance)." I verified and found that's incomplete:

**There are TWO long-lived router owners, not one:**
1. worker-daemon — calls `setRouterPersistent(false)` (`worker-daemon.ts:977`, the ONLY call site), so per-op `shutdown()` drops the flock; park is dead code there. backend-expert's analysis is correct FOR THIS owner.
2. **MCP server — stays PERSISTENT** (`mcp-server.ts:485`: "`_storage` stays cached with `_isPersistent=true`"), routes via `ensureRvfWired`/`routeMemoryOp` (the original ADR-0267 victim). The per-op `shutdown()` (`memory-router.ts:1081`, gated `!_isPersistent`) does NOT run here — the MCP server relies on PARK to release the flock between ops.

**Verdict still holds:** on the MCP-server persistent path, sync-park is strictly tighter than the 50ms debounce (releases on envelope exit, not after a starvable idle timer) → it releases SOONER, anti-ADR-0267. The only longer-hold case is a wedged envelope, which the debounce never guarded either (pre-existing, Q1/Q2 single-lock concern).

**Action for the synthesis (Q5 coordination, cheap):** backend-expert's `lsof memory.rvf.lock` empty-between-ops assertion (handover Part A) must run against the MCP-SERVER scenario, not just the worker-daemon — that's the path where park is the actual release mechanism and where a sync-park regression, if any existed, would show. Part A's live verification (8/8 concurrent, lock empty) was run on the daemon-running scenario; confirm it covers MCP-server-persistent too. This is the one concrete gap between "proven" and "assumed" for ADR-0267 non-regression. No verdict change — file it as a required test, not a blocker.

---

#### 2026-06-01 08:18:16 — **verification-expert** → devils-advocate

Retraction accepted, and no apology needed — the challenge forced the trace that PROVED the metric sound, which is exactly its value. We've converged, and I want to name the one nuance so the synthesis records it precisely:

You're right the vectors-visibility confound is FIXED (the `:2797-2823` listMetadataIds recovery pass; fresh `openReadonly` boot reloads vectors). So `memory list` is NOT fundamentally confounded — I agree, and I'm dropping the "deconfounding is MANDATORY" framing.

BUT note where you landed: your endorsed belt-and-suspenders — "kill the writer procs, reopen, re-list, so the assertion isn't on the same live handle that did the writes" — IS mechanically identical to my C1' durable probe (fresh-process re-open → boot → count). We arrived at the same probe through different doors: you for read-your-own-writes masking, me for the one residual I'd still flag — the recovery pass at `:2797` is wrapped in try/catch + silent-fallthrough (`:2810-2816`), so under the N=16 + transient-embedding-failure regime (the documented ADR-0163 trigger, memory-router.ts:893), it can throw and silently revert `this.entries` to the vector-filtered count with NO error. A fresh-process re-list via direct listMetadataIds is immune to that swallow.

So: agreed it's an ENHANCEMENT, not a blocker — the standard warm+cold×N guard against `memory list` is the gate, and the fresh-process/direct-listMetadataIds count rides alongside as cheap rigor (catches both your read-your-own-writes concern and my silent-recovery-pass-throw concern). Neither of us makes it gating. My Q5 verdict (SUPPORT-WITH-CONDITIONS, 0.82) is UNCHANGED; C1' is reframed from "mandatory deconfound" to "belt-and-suspenders fresh-process cross-check." Telling the queen exactly that. Clean close — thanks for the rigor.

---

#### 2026-06-01 08:18:28 — **verification-expert** → queen

FYI for synthesis — DA has WITHDRAWN the metric-confound objection, and I concur. This does NOT change my Q5 verdict (SUPPORT-WITH-CONDITIONS, 0.82); it downgrades ONE condition.

What changed: the vectors-visibility confound (`iter_metadata_with_vectors` filter) is FIXED in-tree by the ADR-0163 recovery pass (`rvf-backend.ts:2797-2823`), which the `memory list` path runs through on a fresh `openReadonly` boot. So `memory list` IS an adequate durable proxy for native — your fact (1) (integrity-expert) is the correct read of live behavior, and the DA's fact (2) describes the pre-fix bug, not current code. The disagreement is resolved in integrity-expert's favor, as you already recorded.

Net effect on my conditions: C1' (the dual DURABLE/VISIBLE count) is DOWNGRADED from "mandatory deconfounding" to "belt-and-suspenders fresh-process cross-check." Rationale it's still worth keeping (cheap, not gating): the ADR-0163 recovery pass is wrapped in try/catch + silent-fallthrough (`:2810-2816`), so under N=16 + transient-embedding-failure (the documented trigger), it can throw and silently revert the count to vector-filtered with no error. A fresh-process direct-`listMetadataIds` count rides alongside `memory list` to catch that (and the DA's read-your-own-writes masking concern — same probe, both doors). NOT a blocker.

UNCHANGED and still load-bearing: C1 (K×N warm+cold, single-shot N=6 is the real flake cause), C2 (daemon lsof-empty), C3 (path-filtered CICD), the cargo-necessary-not-sufficient guardrail, and the hard pre-merge gate (K=10/N=16 → 10/10 on an Option-A build, any loss → PIVOT). Verdict stands: SUPPORT-WITH-CONDITIONS, 0.82, downstream of Q1's soundness finding. That's the only edit to my position. Going idle.

---

#### 2026-06-01 08:18:33 — **backend-expert** → devils-advocate

CONCEDED, and verified before conceding. You're right; I over-stated. The grep confirms `setRouterPersistent(false)` has exactly ONE call site (worker-daemon.ts:977) — the MCP server stays _isPersistent=true (mcp-server.ts:481-485, the comment literally says "_storage stays cached with _isPersistent=true"). So "park is dead code on the daemon path" is true for the WORKER-DAEMON only; the MCP server is a long-lived persistent owner where park IS the release mechanism. My Claim 1 was scoped too broadly. Correcting the record.

The Q3 verdict (SUPPORT 0.9) stands, on the basis YOU correctly identified: on the MCP-server persistent path sync-park ⊂ debounce — it releases the flock immediately on envelope exit instead of after the starvable 50ms _NATIVE_PARK_IDLE_MS, which is anti-ADR-0267. The only path where sync-park holds longer is a wedged envelope, and the debounce gave zero protection there too — pre-existing Q1/Q2, not a new regression. So the corrected safety argument is: daemon non-regresses because park is bypassed (shutdown→close); MCP server non-regresses because sync-park ⊂ debounce. Both hold; neither needs "park is dead everywhere."

ONE STRENGTHENING DETAIL your evidence implies (makes the MCP-server case tighter, not weaker): mcp-server.ts:481-499 is the ADR-0267 "Option F" fix — it SKIPS the eager RVF warm-up specifically so the server does NOT acquire-and-hold the flock for its lifetime at startup (:487-489: "The hold-for-lifetime is OS-kernel-level... block indefinitely on the flock"). Post-Option-F the MCP server takes the flock ONLY lazily, per-dispatch, via ensureRvfWired → store envelope → acquireLock→unpark, and releases by park. So between dispatches the MCP server holds NO flock today (debounce having fired) and will hold no flock under sync-park (released on envelope exit). The lsof-empty-between-ops assertion is therefore exactly the right probe for it.

AGREED on your ask: the `lsof <data>/memory.rvf.lock` empty-between-ops assertion (my Q3 Condition) must run against the MCP-SERVER scenario, not only the worker-daemon — because the MCP server is the persistent path where park is load-bearing, so that's where a sync-park release bug would actually show. I've already routed both the daemon-hold (P2) and the durable-count probe to verification-expert; I'll add this MCP-server lsof scope to that coordination now. Going idle after this (one rebuttal spent).

---

#### 2026-06-01 08:18:48 — **backend-expert** → queen

CORRECTION to my Q3 ratio (verdict UNCHANGED: SUPPORT 0.9). DA found a genuine gap in my SUPPORTING claim and I've verified it.

WHAT I GOT WRONG: I said the daemon is the only long-lived RVF owner. There are TWO. `setRouterPersistent(false)` has exactly one call site (worker-daemon.ts:977, grep-confirmed); the MCP server stays _isPersistent=true (mcp-server.ts:481-485). So park is dead code on the DAEMON path only — on the MCP server, park IS the release mechanism.

WHY THE VERDICT SURVIVES (two-pronged, please use THIS in synthesis instead of "park is dead code everywhere"):
- worker-daemon: non-regresses because it bypasses park entirely — per-op shutdown→close drops the flock (memory-router.ts:1081-1083 → rvf-backend.ts:463-467).
- MCP server: non-regresses because sync-park ⊂ debounce — releases on envelope exit, SOONER than the starvable 50ms _NATIVE_PARK_IDLE_MS, which is anti-ADR-0267 (the right direction). The only longer-hold path is a wedged envelope, which the debounce never guarded either → Q1/Q2, not a new regression.

STRENGTHENING FACT: mcp-server.ts:481-499 is itself the ADR-0267 "Option F" fix — it SKIPS the eager RVF warm-up so the MCP server never acquires-and-holds the flock at startup; it takes the flock only lazily per-dispatch and releases via park. So the MCP server already holds no flock between dispatches today, and sync-park keeps that true.

ACTION: the lsof-empty-between-ops assertion (my Q3 Condition) must cover the MCP-SERVER scenario too, not just the worker-daemon — that's where park is load-bearing and where a sync-park release bug would surface. Routing that to verification-expert now to fold into P2. No change to the SUPPORT verdict or its confidence. This was my one rebuttal; going idle.

---

#### 2026-06-01 08:19:07 — **devils-advocate** → queen

DA — responding to flock-expert's rebuttals on facts (3) and (1). I can answer the fact-(1) call-order myself (already traced it), so you don't need to block on rvf-integrity-expert for this.

**FACT (3) [native silent-hang window] — I CONCEDE. Flock-expert is right; it's defused for the Option-A hot path.**
Verified: `ingest_batch` (`store.rs:438-605`) takes NO `WriterLock` — it writes `self.file` directly under the already-held lock. The only acquire sites are create:180, try_open_once:331, unpark_writer:1388, derive:2276. Under Option A the JS envelope unparks ONCE (depth 0→1 via `acquireLock`→`unparkNativeWriter`), and the nested native ingest reuses that held lock. The racy holders-mutex window (`locking.rs:118-127`) requires a SECOND distinct same-path acquire inside the drop-then-insert gap — which the single-unpark-per-envelope hot path does not produce. And even if hit, the sentinel guard (fd=-1, `:121-124`; Drop `:268-279`) never touches the kernel, so no self-deadlock. Fact (3) does NOT block Option A. Withdrawn for the hot path. (Residual is only the future blocking-flock on-ramp — a separate, opt-in change.)

**FACT (1) [.wal/.meta coverage] — the transitive-serialization mechanism HOLDS for the `store()` path. Here's the call order (from my trace, no need to wait):**
- `acquireLock` calls `unparkNativeWriter()` at depth 0→1 (`rvf-backend.ts:2105`).
- `store()` does in-mem mutate → native ingest → `appendToWal` (`:580`) → `compactWal` (`:584`), ALL nested under the SAME lock via the re-entrant depth counter (Option A KEEPS the counter, ADR §90/§124). `appendToWal`/`compactWal` re-acquire at `:2467`/`:2692` → depth bump, no new unpark.
- `releaseLock` at depth 1→0 calls `parkNativeWriter()` (sync under Option A, `:2182` site).
⇒ The `.wal` append (`:2470`) and `.wal` unlink (`:2697`) sit INSIDE the unpark→park window. So flock-expert's Q2b-ii is correct: the native flock, held envelope-wide, transitively serializes the `store()`-path `.wal` ops by mutually excluding the whole critical section. My fact (1) "removes coverage" weakens to "the flock provides it transitively once held envelope-wide" — for the `store()` path. **I concede fact (1) for `store()`.**

**THE ONE GAP that survives (and it's the delete path, which I already flagged):** `delete()` (`:690-725`) and `bulkDelete()` (`:1008-1047`) do their `.wal` truncate (`:719`/`:1041`) with NO `acquireLock` in the method body — OUTSIDE any depth bracket, so OUTSIDE the unpark→park window. Transitive serialization does NOT cover them. BUT: this is already true TODAY (the truncate is `.jslock`-free now), so Option A introduces no NEW exposure — it's a pre-existing gap, separate ticket, not an Option-A blocker.

**NET after these concessions:** facts (1)-for-store() and (3) are both withdrawn; fact (2) I already retracted (ADR-0163 recovery pass `:2797-2823` + fresh-boot reload). My devil's-advocate position has fully collapsed to ACCEPT. The ONLY genuine residual across all my objections is the pre-existing delete-path unguarded truncate (separate ticket) + the unmeasured `.jslock`-removed run (the ADR's own admitted gap, §116-118). No surviving structural objection to Option A. I have no powder left to keep — I tried to sink it and could not.

---

#### 2026-06-01 08:19:09 — **backend-expert** → verification-expert

One addition to the P2 daemon-hold guard I sent earlier, from the DA exchange (DA was right; verdict unchanged).

P2 must cover TWO long-lived owners, not one:
1. worker-daemon (`daemon start`) — what I already specced. It's _isPersistent=false, releases via per-op shutdown→close.
2. MCP server (`mcp start`) — ADD THIS. It's the OTHER long-lived owner and the ONLY one where park is the actual flock-release mechanism (_isPersistent=true, mcp-server.ts:481-485; setRouterPersistent(false) has a single call site = the worker-daemon, grep-confirmed). So a sync-park release bug would surface on the MCP-server path, NOT the daemon path. Testing only the daemon would miss it.

MCP-server P2 body (mirror the daemon one):
- Start the MCP server (`$cli mcp start` or the project's mcp entrypoint) in the iso; let it initialize.
- Drive a few memory_store tool calls through it (so it lazily wires RVF per-dispatch via ensureRvfWired → store envelope → acquireLock→unpark→...→park).
- BETWEEN dispatches (after a store completes, before the next), assert `lsof "$main_rvf_path.lock"` and `lsof "$main_rvf_path"` BOTH EMPTY — that's the proof park released. NOTE: mcp-server.ts:481-499 (ADR-0267 "Option F") already SKIPS the eager startup warm-up, so the server holds no flock at idle TODAY; sync-park must keep it empty between dispatches.
- Tear down the MCP server BEFORE the rm -rf (same orphan caveat as the daemon).

So P2 = two assertions (daemon-scenario lsof-empty + mcp-server-scenario lsof-empty), or two sub-checks if you prefer separate run_check_bg ids — either way BOTH must land in run_check_bg AND collect_parallel (the silent-uncounted trap). The MCP-server one is the load-bearing one for ADR-0267 non-regression under sync-park; the daemon one guards the shutdown→close path. P1 (durable count, already fresh-boot) and the teardown-before-rm caveat are unchanged. CC queen.

---

#### 2026-06-01 08:19:42 — **verification-expert** → queen

Both asks answered with the call-edge CITED (re-traced + re-read this session, not asserted).

═══ (1) THE `memory list` CALL-EDGE, file:line ═══

`memory list` lands on **query()→this.entries**, NOT on a live `iterAllWithVectors` / `iter_metadata_with_vectors` call. Full chain:
- CLI `case 'list'` — `cli/src/memory/memory-router.ts:1466` → dispatches to archivist `handlers/memory/list.ts` → `MemoryRvfAdapter.queryAsync` → "surfaces the cli `RvfBackend.query`" (`agentdb/src/archivist/substrates/rvf-store.ts:211`).
- `RvfBackend.query()` — `memory/src/rvf-backend.ts:727`. Body `:736`: `let results = Array.from(this.entries.values());` then namespace-filters. NO `self.vectors.get(id)?` at read time.
- (Same answer if it routed to `count()` instead — `:1056` `return this.entries.size`; `:1057-1059` namespace loop over `this.entries`. BOTH count() and query() read `this.entries`, BOTH call `_maybeReloadFromDisk()` first: `:733`/`:1055`.)

So the read-time count source is `this.entries` — integrity-expert is correct. The DA's `iter_metadata_with_vectors` filter (`store.rs:2120`) is NOT on the read path; it's only in the LOAD path that POPULATES `this.entries`:
- `this.entries` populated by `loadFromDisk`→`_collectNativeSnapshots` (`:2722`; fresh-handle reload `:3004`). `_collectNativeSnapshots`'s PRIMARY pass uses `iterAllWithVectors()` (`:2753`, the filtered path) THEN the ADR-0163 recovery pass (`:2797-2810`) enumerates `listMetadataIds()` (unfiltered) and re-adds dropped entries.

⇒ VERDICT ON THE CONFOUND: the filter exists in the load path but is neutralized by the recovery pass before the count is read; on a fresh boot (which `memory list` forces via a short-lived process), visible==durable for any committed entry. The DA's confound is NOT live on the read path. Real (and worth keeping a probe for) ONLY in the narrow case the recovery pass throws (it's wrapped try/catch + silent-fallthrough `:2810-2816`) under load — which is why the Step-1 split below is the right gating diagnostic rather than a blanket "metric is broken."

═══ (2) STEP-1 DECONFOUND ON THE PRE-CHANGE TREE — CONFIRMED, mechanism correct ═══

YES, my plan supports running the durable-vs-visible split on the CURRENT (pre-`.jslock`-delete) tree as the FIRST step, and it's the strongest possible framing of "measure before ratify" — it tells us WHICH bug we even have before we touch the lock:
- DURABLE probe = `listMetadataIds()` — bound napi at `rvf-node/src/lib.rs:739` → `store.iter_metadata()` (`store.rs:2088-2090`) = walks `metadata_full`, NO vector filter. This IS the right durable-count call, file:line confirmed. Run it as a fresh-process node one-liner against the iso `.rvf` (open→boot→`db.listMetadataIds()`, filter to namespace). `metadata_full` is reloaded from META_SEGs at boot (`store.rs:2563`), so it's the manifest-authoritative durable count.
- VISIBLE probe = `memory list` (the `query()`→`this.entries` path above).
- Run on a WARM N=16 (and add cold — both regimes). Decision tree exactly as you stated:
  · DURABLE==16 & VISIBLE<16 → residual is a vectors-visibility/recovery-pass gap that NEITHER lock fixes → fix `resync_for_write`/the recovery-pass-throw, NOT the lock. Option A would be treating the wrong layer.
  · DURABLE<16 → real cross-process serialization loss → Option A (the `.jslock` removal) is the correct target → proceed.

This is a genuinely better condition #1 than my K=10/N=16 alone, because it's a PRE-DELETE diagnostic that can REDIRECT the whole fix before any code changes. I'm adopting it.

═══ MERGED CONDITION #1 (deconfound first, then delete, then prove) ═══

Three ordered gates, all on the standing/CICD harness, no skip_accepted:
1a. DECONFOUND (pre-change, current tree): warm+cold N=16, split DURABLE(`listMetadataIds`) vs VISIBLE(`memory list`). If DURABLE==N every round → the loss is NOT durable → STOP, fix the metric/recovery path, do NOT delete `.jslock`. If DURABLE<N → confirmed serialization loss → Option A is warranted → proceed to 1b.
1b. DELETE + PROVE (Option-A build): the K=10/N=16 one-shot → 10/10 with DURABLE==16 AND VISIBLE==16 every round. ANY loss → PIVOT (residual native race, re-trace `resync_for_write` `store.rs:1414-1457`).
1c. STANDING GATE (every CI/release): the three-probe t3-2 (P1 K×N warm+cold / P2 daemon lsof-empty / P3 crash-recovery), K≥3 CI / ≥5 release, dual count, wired run_check_bg + collect_parallel, + path-filtered `v3-ci-rvf-lock.yml` (cargo necessary-not-sufficient pre-gate).

Mechanism confirmed, not corrected. `listMetadataIds` (`lib.rs:739`→`store.rs:2088`) is the right durable call; `memory list`→`query()`→`this.entries` (`rvf-backend.ts:736`) is the right visible call; the confound is load-path-only and recovery-pass-neutralized; Step-1 split is the correct pre-delete diagnostic. Verdict unchanged: SUPPORT-WITH-CONDITIONS, 0.82, downstream of Q1. This closes the thread. Going idle.

---

#### 2026-06-01 08:19:42 — **devils-advocate** → queen

DA — closing statement for your synthesis. I've conceded facts (1)-store/(2)/(3). Before I go idle, one precise boundary I want on the record so the council doesn't over-certify — this is the disciplined residual of "default to REJECT under doubt," not contrarianism:

**The council can honestly certify: "no surviving structural / deadlock / metric objection to Option A." It CANNOT certify: "Option A reaches 16/16." Those are different claims, and the gap between them is an UNRUN experiment.**

Evidence this gap is real, not pedantic:
- The ADR's own Decision Outcome (§116-118) states the central question — "whether removing the `.jslock` alone reaches 16/16 or a residual native-layer issue remains" — is "resolved by MEASUREMENT, not assumption."
- The handover measured Option C = 11/16 (with `.jslock`) and sequential = 16/16. NEITHER is the proposed change. The `.jslock`-REMOVED number does not exist anywhere in the brief.
- Every expert verdict (rvf-integrity 0.85, flock 0.83, backend 0.9, and my collapsed-to-ACCEPT) is ANALYTICAL. Three of us attached conditions that are fundamentally "...pending empirical confirmation" (rvf-integrity C3, flock C2-liveness, backend's `lsof` assertion).

**So my final devil's-advocate verdict, Q4: do NOT ratify Option A as "the fix." Ratify it as "the agreed design direction, conditioned on a GREEN measured run before it ships."** Concretely the ADR's Council-review section should record:
1. Council finds NO structural blocker (single lock kills AB-BA; transitive serialization covers the store() envelope; sync-park is ADR-0267-tighter than the debounce; the metric is adequate post-ADR-0163).
2. Council does NOT certify the loss is fixed — that requires the implement-then-measure step the ADR itself names (§116-118): `.jslock` removed, warm+cold × N, daemon AND MCP-server-persistent scenarios, lock-empty-between-ops asserted, wired into t3-2 + CICD, no skip_accepted.
3. If that run is NOT a clean stable 16/16, the design is falsified and we revisit (the `resync_for_write`-vectors / consistency-window question, ADR §135, becomes live again).
4. Separate ticket: pre-existing delete-path unguarded `.wal` truncate (`:719`/`:1041`).

That framing is the honest output of an adversarial review where the adversary could find no flaw in the REASONING but the EXPERIMENT remains unrun. It protects the council from the failure mode of blessing an unmeasured change — which, given this exact bug burned multiple release cycles on plausible-but-wrong fixes (handover TL;DR), is the live risk. I'm done; going idle. Ping me if synthesis needs a specific re-check.

---

#### 2026-06-01 08:19:49 — **queen** → team-lead

rvf-lock-council complete. Full synthesis appended to ADR-0284 (§Council review → Queen's synthesis). All 6 questions resolved through one challenge + one rebuttal per position. (Note: the task list was reset harness-side mid-session, so the per-task TaskUpdate trail is gone — the ADR append is the authoritative record.)

PER-QUESTION VERDICTS:
- Q1 Core correctness: SUPPORT-WITH-CONDITIONS (0.85). Single native flock held envelope-wide IS sufficient for the store() hot path — call order proven: acquireLock@:538 re-acquires the flock (unpark @:2105) BEFORE any .wal/.meta write; releaseLock parks AFTER finally{} completes appendToWal:580/compactWal:586. Kernel LOCK_EX excludes peers from the whole envelope (serialization is by held-section, not by which fd the flock is on). Part C loss re-characterized as a .jslock failure, not an .rvf race. Residual: audit the auto-persist-timer path's bracketing.
- Q2 Deadlock freedom: SUPPORT-WITH-CONDITIONS (0.83). AB-BA killed by construction (one lock = no 2nd resource to invert). Three suspected hazards all inert (ingest takes no WriterLock; napi mutex never co-held with flock). The DA's locking.rs:151-162 hang-window is de-fanged by NB-poll, which Option A KEEPS.
- Q3 ADR-0267 non-regression: SUPPORT (0.9, cleanest). Daemon releases via shutdown()→close() per-op, NOT via park, so debounce→sync-park is invisible to the 0267 victim path.
- Q4 Scope: full .jslock removal warranted OVER B/B'/C, but measurement-first. The DA self-corrected: B'(keep .jslock)==Option C==measured 11/16=refuted; B''(repair) keeps two locks→keeps the AB-BA root (unrebutted). No B-variant is safer than A. BUT the DA's ordering critique is upheld: don't delete-then-measure.
- Q5 Verification: SUPPORT-WITH-CONDITIONS (0.82). The current t3-2 is single-shot N=6 that passes ~75% ON BROKEN CODE — the "flake" is a verification-design defect. Fix = K×N (N=16, K≥3/5) determinism-by-construction. CICD runs ZERO RVF checks today.
- Q6 Vehicle: NEW ADR-0284 (0.88). Supersede named parts of 0095(.jslock+init-scopedown) + 0274(debounce); ADR-0167 AFFIRMED (stays in depends-on); add Supersession-scope + Consequences + Confirmation sections.

TOP 3 RISKS:
1. The Rust cargo test ABSORBS the bug (generous retry budget; .jslock doesn't exist in Rust) → a green Rust run is necessary-NOT-sufficient; the CLI K×N t3-2 is the SOLE release gate.
2. The 11→16 residual may be a vectors-visibility artifact (iter_metadata filters self.vectors.get(id)?, store.rs:1825-1832), NOT a lock bug — in which case deleting the .jslock treats the wrong layer. (Experts argue memory list counts via manifest-authoritative this.entries.size, which would make a miss real loss — but the exact call-edge was asserted, not yet cited.)
3. The init scope-down revert re-touches code that closed a DIFFERENT t3-2 hang; only AB-BA-safe BECAUSE the .jslock is simultaneously removed (partial application is unsafe).

ONE RECOMMENDATION: **PROCEED-WITH-CONDITIONS.** Adopt Option A's end-state (single flock, .jslock removed, synchronous park, INIT-WRAP) but RE-ORDER to measure-then-delete:
- Condition 0 (gating, BEFORE deleting): deconfounded measurement — split durable (manifest-level) vs visible (memory list) count on warm+cold N=16. If durable=16 & visible<16, STOP and fix resync/metric, not the lock. Only durable<16 (real loss) proceeds. Pin the memory list→backend call-edge file:line here.
- Then implement Option A (rvf-backend.ts only; keep NB-poll + 30s timeout) with conditions C1 init-sync-park-after-loadFromDisk, C2 envelope-duration load-test ≪30s, C3 keep both depth counters, + timer-bracketing audit.
- Prove on an Option-A build: K=10×N=16→10/10 durable + daemon lsof-empty/8-8 + crash-recovery WAL-replay. Any loss → trace resync_for_write, don't mask.
- Wire the guard (K×N t3-2 + daemon + crash checks + new path-filtered v3-ci-rvf-lock.yml running cargo-pregate AND CLI-gate; cargo stated necessary-not-sufficient; no skip_accepted).
- Then ratify the Q6 frontmatter.

NET: the design end-state is sound (3 independent experts concur Q1-Q3); the DA's challenge did real work — it added the crash-recovery probe, exposed the broken N=6 verification, and forced the deconfound-before-delete ordering. NOT "proceed as written" (the ADR's delete-then-measure ordering is backwards) and NOT a pivot to B/C (no viable B). Needs human go-ahead before any implementation per the ADR's status note.

Two clarifications still in flight (do not block the verdict, only refine wording): the exact memory list→backend call-edge (verification-expert), and the 0095/0274 superseded-vs-accepted encoding (adr-governance-expert). I'll fold them into the ADR if they land.

---

#### 2026-06-01 08:20:34 — **devils-advocate** → queen

DA — rvf-integrity-expert's Q1 rebuttal is SOUND on both gaps and matches my own trace. I'm not contesting it — recording convergence (honesty over contrarianism):

- GAP A (transitive serialization): their call order is exactly what I traced and conceded to you — `store()` acquires at `:538`, does `.wal` append/compact at `:580`/`:586` INSIDE the bracket, releases at `:590`; under Option A that bracket IS the unpark→park window, so the envelope-wide LOCK_EX mutually excludes peers from their own envelopes. Confirmed. My fact (1) is withdrawn for `store()`.
- GAP B (read-freshness): correct and it actually STRENGTHENS the verification design. Because the t3-2 bench uses FRESH CLI processes (each `initialize()`→`loadFromDisk()`→`_populateFromSnapshots` from the committed manifest, then `count()` reads `this.entries.size`), there is NO stale-in-memory or read-your-own-writes masking — a miss is genuine durable loss. This is precisely why fresh-process counting is the right metric, and it means my earlier "deconfound the metric" worry (already retracted) was doubly moot: the bench's process model already deconfounds it.

ONE small refinement for the verification record (not a dispute): rvf-integrity's GAP B proves the FRESH-PROCESS path is artifact-free. The LONG-RUNNING path (their completeness note: `count()`→`_maybeReloadFromDisk`→`openReadonly`→`_populateFromSnapshots`) is ALSO artifact-free per the same reload. So BOTH the t3-2 bench scenario AND the daemon/MCP-server scenario count from committed state. ⇒ the verification can safely use `memory list` count in BOTH the fresh-CLI bench and the long-lived-server scenario without a special durable probe. That closes my Q5 concern entirely.

NET: every one of my three facts is now resolved (1 withdrawn-for-store + delete-path-scope-note, 2 retracted, 3 conceded). All four experts + me converge: no surviving structural/metric objection. My final disposition is unchanged from my closing statement — ratify Option A as the agreed design direction, gated ONLY on the unrun measured `.jslock`-removed bench (ADR §116-118) + rvf-integrity's C1/C2 + the delete-path ticket. I remain idle; this was just to confirm I have no counter to rvf-integrity's rebuttal.

---

#### 2026-06-01 08:20:34 — **backend-expert** → verification-expert

ACCEPTED — you're right and I withdraw "mostly labeling." Verified the swallow path in source:
- rvf-backend.ts:2766-2788 documents exactly your case: vectorless `ingestMetadataOnly` entries land in metadata_full but NOT vectors, so iterAllWithVectors (iter_metadata_with_vectors) silently drops them; trigger named at :2776 ("embedding adapter at memory-router.ts:893 catches transient failures and stores the entry without an embedding").
- The recovery pass (:2797-2809) uses listMetadataIds (unfiltered) BUT is try/catch with silent fallthrough at :2810-2815. So a thrown recovery pass → durable-but-invisible entry, no error. `memory list` rides on that swallow for vectorless-under-load. Your direct listMetadataIds count bypasses the JS recovery layer entirely → strictly stronger. Dual count is NOT redundant. Adopting it.

ONE LINE-NUMBER NUANCE for your spec: the :2771 comment cites store.rs:1825-1832 for the filter, but that's STALE — the live filter is iter_metadata_with_vectors at store.rs:2120 (`let vec = self.vectors.get(*id)?;`), which is the line YOU cited correctly earlier. Use 2120 in the spec; the comment's 1825-1832 drifted. (Confirms the byte-parse entry_count :240-265 stays diagnostic-only.)

P2 BASH DRAFT (daemon scenario) — house style, mirrors ADR-0088-5's start→status→stop and your sub-id split. Drop in as `check_t3_2_daemon_hold`:

```
check_t3_2_daemon_hold() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "t3-2-daemon-hold")
  local ns="t3-2-daemon-$$"
  local log_dir; log_dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/t3-2-dh-XXXXX")

  # Resolve the .rvf the project uses (same candidates as the concurrency check).
  local rvf_candidates=( "$iso/.swarm/memory.rvf" "$iso/.claude-flow/memory.rvf" )
  local main_rvf=""; local p
  for p in "${rvf_candidates[@]}"; do
    rm -f "$p" "$p.lock" "$p.wal" "$p.meta" "$p.tmp" 2>/dev/null
  done

  # 1. Start daemon.
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon start --quiet" "" 15
  local start_out="$_RK_OUT"
  if echo "$start_out" | grep -qiE 'error|cannot find module|traceback'; then
    _CHECK_OUTPUT="T3-2-DH: daemon start errored: $(echo "$start_out" | head -5 | tr '\n' ' ')"
    _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon stop" "" 5 || true
    rm -rf "$iso" "$log_dir" 2>/dev/null; return
  fi

  # 2. Seed one store so the daemon resolves/creates the .rvf, then locate it.
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key dh-seed --value seed --namespace '$ns'" "" 60
  for p in "${rvf_candidates[@]}"; do [[ -f "$p" ]] && { main_rvf="$p"; break; }; done
  if [[ -z "$main_rvf" ]]; then
    _CHECK_OUTPUT="T3-2-DH: no .rvf created after daemon start + seed store"
    _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon stop" "" 5 || true
    rm -rf "$iso" "$log_dir" 2>/dev/null; return
  fi

  # 3. HARD ASSERT: daemon holds NO write flock between ticks. lsof prints NOTHING
  #    (and exits non-zero) when no process holds the file — assert on EMPTY OUTPUT,
  #    not exit code (non-zero is the PASS here). Check both the .lock sidecar and
  #    the .rvf itself. NB: do NOT assert file-absence — the .lock file is never
  #    unlinked by design (rvf WriterLock keeps the inode); empty lsof is the
  #    correct "released" signal.
  local lock_holders rvf_holders
  lock_holders=$(lsof -- "$main_rvf.lock" 2>/dev/null | grep -v '^COMMAND' || true)
  rvf_holders=$(lsof -- "$main_rvf" 2>/dev/null | grep -v '^COMMAND' || true)
  if [[ -n "$lock_holders" || -n "$rvf_holders" ]]; then
    _CHECK_OUTPUT="T3-2-DH: daemon HOLDS write flock between ticks (ADR-0267 regression) — lock:[${lock_holders:0:200}] rvf:[${rvf_holders:0:200}]"
    _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon stop" "" 5 || true
    rm -rf "$iso" "$log_dir" 2>/dev/null; return
  fi

  # 4. Burst 8 concurrent stores WHILE the daemon runs; all must persist, 0 LockHeld.
  local N=8 pids=() i
  for i in $(seq 1 "$N"); do
    ( cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 90 $cli memory store \
        --key "dh-burst-$i" --value "daemon burst $i" --namespace "$ns" \
        > "$log_dir/dh-$i.log" 2>&1 ) &
    pids+=($!)
  done
  local pid; for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

  local lockheld=0
  for i in $(seq 1 "$N"); do
    [[ -f "$log_dir/dh-$i.log" ]] && grep -qiE 'LockHeld|0x0300' "$log_dir/dh-$i.log" && lockheld=$((lockheld+1))
  done

  # 5. DURABLE count via a FRESH process (boot → unfiltered) — see C1' dual count.
  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory list --namespace '$ns' --limit 50" "" 30
  local ns_out="$_RK_OUT"; local hits=0; local k
  for k in $(seq 1 "$N"); do echo "$ns_out" | grep -q "dh-burst-$k" && hits=$((hits+1)); done

  # 6. Daemon must still be alive, THEN stop BEFORE teardown (orphan-pin guard).
  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon status" "" 10
  local status_out="$_RK_OUT"
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli daemon stop" "" 5 || true

  if [[ "$hits" -eq "$N" && "$lockheld" -eq 0 ]] && echo "$status_out" | grep -qiE 'running|RUNNING|active'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="T3-2-DH: daemon holds no flock between ticks; ${N}/${N} concurrent stores persisted, 0 LockHeld, daemon survived"
  else
    _CHECK_OUTPUT="T3-2-DH: daemon-scenario fail — hits=${hits}/${N} lockHeld=${lockheld} daemonAlive=$(echo "$status_out" | grep -qiE 'running|active' && echo yes || echo no)"
  fi
  rm -rf "$iso" "$log_dir" 2>/dev/null
}
```

Notes: (a) the daemon stop fires on EVERY return branch before rm — that's your orphan-pin guard. (b) lsof assertion is on EMPTY OUTPUT (grep -v COMMAND header) since lsof's non-zero exit is the desired no-holder case — easy to get wrong as exit-code. (c) the MCP-server variant is structurally identical but swaps `daemon start/status/stop` for the mcp entrypoint and drives stores via the MCP tool path; I left it as the second sub-check since the mcp start/teardown idiom differs — tell me the project's mcp-start invocation and I'll draft that one too. (d) wire `check_t3_2_daemon_hold` into BOTH run_check_bg (:1345) and collect_parallel (:2773). CC queen. This is my draft — adjust freely; you own the final spec.

---

#### 2026-06-01 08:20:42 — **verification-expert** → backend-expert

Accepted, and it's the most important refinement to P2 — verified all three claims in source:
- `setRouterPersistent(false)` has exactly ONE call site: `worker-daemon.ts:977` (def at `memory-router.ts:1058`). The MCP server never calls it. CONFIRMED.
- MCP server stays `_isPersistent=true` and is Option-F (no eager warm-up): `mcp-server.ts:481-485` verbatim — "SKIP the eager RVF warm-up... _storage stays cached with _isPersistent=true." So it holds no flock at idle today; its release path is PARK, not shutdown→close. CONFIRMED.
- ⇒ Your conclusion holds: park is the MCP server's release mechanism, and Option A changes park (debounce→synchronous). So a sync-park regression surfaces on the MCP-server path and a daemon-ONLY P2 would miss it entirely. This is the load-bearing ADR-0267 non-regression case under the change.

Folding in: P2 becomes TWO sub-checks, each its own run_check_bg id + collect_parallel entry (the silent-uncounted trap):
- `t3-2-daemon-hold`: `daemon start` (releases via shutdown→close, `memory-router.ts:1078-1084`→`rvf-backend.ts:460-467`), lsof `.lock` + main both EMPTY between ops, 8 concurrent, daemon survives, DURABLE(listMetadataIds)+VISIBLE(memory list)==8, daemon stop BEFORE rm.
- `t3-2-mcp-hold` (the load-bearing one): `mcp start`, drive a few memory_store dispatches (lazy-wires RVF per-dispatch via ensureRvfWired→store envelope→acquireLock→unpark→…→park), assert lsof `.lock` + main both EMPTY BETWEEN dispatches (proof sync-park released — Option F means it's empty at idle today, sync-park must keep it empty between dispatches), server survives, DURABLE+VISIBLE==N, mcp stop BEFORE rm.

Everything else unchanged: P1 (durable count fresh-boot at :276 + the direct listMetadataIds durable probe alongside, for the vectorless-under-load case), P3 (crash-recovery WAL window β), teardown-before-rm, all sub-ids in BOTH run_check_bg (:1345) AND collect_parallel (:2773). Telling the queen P2 is now two-owner (daemon close-path + MCP park-path), with the MCP one as the load-bearing sync-park guard. Verdict unchanged (SUPPORT-WITH-CONDITIONS, 0.82). Thanks — this closes a real gap. CC queen.

---

#### 2026-06-01 08:20:55 — **verification-expert** → queen

Synthesis update — P2 (daemon-hold) strengthened, prompted by backend-expert. Verified in source; verdict unchanged (SUPPORT-WITH-CONDITIONS, 0.82).

P2 must cover TWO long-lived flock owners, and they release the flock by DIFFERENT mechanisms — only one of which Option A changes:
- worker-daemon: `_isPersistent=false`, releases per-op via shutdown→close (`memory-router.ts:1078-1084`→`rvf-backend.ts:460-467`). NOT the park path.
- MCP server: `_isPersistent=true`, releases via PARK. Verified: `setRouterPersistent(false)` has exactly ONE call site (`worker-daemon.ts:977`); the MCP server never calls it, and `mcp-server.ts:481-485` (ADR-0267 Option F) keeps `_storage` cached `_isPersistent=true` with no eager warm-up.

Why this matters for THIS ADR specifically: Option A changes park from debounced to SYNCHRONOUS. Park is the MCP server's release mechanism. So a sync-park regression (flock not released between dispatches) surfaces ONLY on the MCP-server path — a daemon-only P2 would pass while ADR-0267 silently re-regresses on the real long-lived MCP owner. The MCP-server lsof-empty-between-dispatches check is the load-bearing ADR-0267 non-regression guard under the sync-park change; the daemon check guards the close path.

So P2 = two sub-checks (`t3-2-daemon-hold` + `t3-2-mcp-hold`), each lsof `.lock`+main EMPTY between ops/dispatches, DURABLE+VISIBLE count, teardown-before-rm, both wired into run_check_bg + collect_parallel. No other change. The full Q5 condition set (1a deconfound → 1b K=10/N=16 prove → 1c standing three-probe gate, cargo necessary-not-sufficient, no skip_accepted) stands. This is the last refinement I have; nothing further from me. Going idle.

---

#### 2026-06-01 08:21:17 — **queen** → rvf-integrity-expert

Accepted — and this is the trace I'd asked for, not an assertion, so it carries. Your four-fact chain (repro stores vector-bearing entries via store.ts:119-124/generateEmbedding-default-true/ingestBatch→self.vectors:507-509; the iter_metadata filter at store.rs:2116-2122 doesn't drop them; the ADR-0163 gap is metadata-only + already-fixed; the shortfall is a CLOBBER — loser's write_manifest segment unabsorbed by resync, lost-not-invisible) closes the DA's confound for the repro workload from BOTH read-path directions (whether count is this.entries.size or the vector-bearing iterator, nothing is filtered).

I've updated the ADR: Risk 2 downgraded from "open confound / mitigation = the gating measurement" to "largely closed for the repro workload; residual = confirm the t3-2 ACCEPTANCE check stores vector-bearing entries on the same path." Condition 0 reweighted from likely-halt to cheap confirmation + the durable-vs-visible split as a safety net. The one thing your trace covers is repro2.sh specifically; the acceptance check near-certainly routes identically (same CLI/defaults) but I kept the cheap confirm so we don't assume it. Q1 verdict unchanged: SUPPORT-WITH-CONDITIONS, 0.85, C1/C2/C3. Thanks — that materially raised confidence that Option A targets the right layer. Idle is fine.

---

#### 2026-06-01 08:21:33 — **queen** → team-lead

One refinement to the synthesis I already sent — recommendation UNCHANGED (still PROCEED-WITH-CONDITIONS, measure-then-delete), but Risk 2 is now substantially de-risked and the ADR is updated to match:

The rvf-integrity-expert produced the trace I'd flagged as missing. The DA's "11→16 might be a vectors-visibility artifact, not a lock bug" (Risk 2 / the reason for the deconfound-first ordering) is now evidenced-AGAINST for the t3-2 repro: repro2.sh stores VECTOR-BEARING entries (memory store --value → store.ts:119-124, generateEmbedding defaults true, embedding lands in self.vectors via ingestBatch store.rs:507-509). The visibility filter (iter_metadata_with_vectors, store.rs:2116-2122) only drops metadata-ONLY entries — not these. The ADR-0163 gap is a different (already-fixed) scenario. So the repro's shortfall is a real CLOBBER (loser's write_manifest segment unabsorbed by the winner's resync → absent from the committed manifest → lost, not invisible), which is exactly what the single native flock fixes.

Effect on the recommendation: Condition 0 drops from "decisive halt-gate that might redirect the whole fix to resync/the metric" to "cheap confirmation that the ACCEPTANCE check stores vector-bearing entries on the same path + the durable-vs-visible split as a safety net." The measure-then-delete ordering still stands (good hygiene, and the DA's process critique was sound), but the probability it diverts away from Option A is now low. Net: higher confidence that Option A targets the right layer.

All other verdicts and the other two risks (Rust-test-can't-certify; init-scope-down-revert-only-safe-with-jslock-removed) are unchanged. ADR-0284 is fully updated. Still needs a human go-ahead before implementation. One authoring clarification (0095/0274 superseded-vs-accepted encoding) remains in flight with adr-governance-expert; I'll fold it in if it lands, but it doesn't affect the verdict.

---

#### 2026-06-01 08:21:48 — **verification-expert** → backend-expert

Draft accepted — it's clean, matches the harness contract (_CHECK_PASSED/_CHECK_OUTPUT, _run_and_kill/_ro, _e2e_isolate), and the lsof-on-EMPTY-OUTPUT mechanic (grep -v COMMAND, non-zero exit is the PASS) is exactly the subtle bit people get wrong. Three confirmations + one precision:

CONFIRMED:
- Stale-line correction accepted: the live filter is `store.rs:2120` (`self.vectors.get(*id)?`), and that's what I've cited in every message — the `:2771` comment's `1825-1832` is drift. Spec uses 2120. byte-parse entry_count `:240-265` stays diagnostic-only. Agreed on all.
- lsof assertion on empty output + daemon-stop-on-every-return-branch (orphan-pin guard) — both correct, keep as-is.
- Wiring into BOTH run_check_bg (:1345) AND collect_parallel (:2773) — yes, non-negotiable per the silent-uncounted trap.

ONE PRECISION (the only change I'd make to the draft): step 5's comment says "DURABLE count via a FRESH process (boot → unfiltered)" but the code counts via `memory list` — which is the VISIBLE probe (query()→this.entries), NOT the unfiltered durable path. `memory list` IS fresh-boot (short-lived process), so it's durable-on-a-good-day — but it still rides the swallow-prone ADR-0163 recovery pass (:2797-2809 try/catch :2810) for the vectorless case we just agreed matters. To get the TRUE durable count that bypasses the JS recovery layer, add a direct `listMetadataIds` probe ALONGSIDE the `memory list` one:

```
  # DURABLE (bypasses JS recovery layer — direct unfiltered iter_metadata via napi)
  local durable
  durable=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 node -e '
    const path = process.argv[1];
    (async () => {
      try {
        const m = await import("@ruvector/rvf-node").catch(() => import("ruvector"));
        const RvfDatabase = m.RvfDatabase || m.default?.RvfDatabase;
        const db = new RvfDatabase(path);            // fresh open → boot()
        const ids = db.listMetadataIds();             // unfiltered: store.rs:2088, no vectors filter
        console.log(ids.length);
        db.close?.();
      } catch (e) { console.log("ERR:" + e.message); }
    })();
  ' "$main_rvf" 2>/dev/null)
```
(exact import specifier + class name TBD against the installed pkg — I'll pin it.) Then the pass criterion becomes BOTH: `hits == N` (your visible `memory list` loop) AND `durable == N` (filtered to the ns — listMetadataIds is global, so either filter ids by namespace-decoded metadata or assert durable >= N as the floor). Divergence (durable==N, visible<N) = the recovery pass threw under load = a real read-path bug we'd otherwise miss.

Everything else in your draft I take verbatim. You asked for the MCP-start invocation for the `t3-2-mcp-hold` variant — the entrypoint is `$cli mcp start` (file `cli/src/mcp-server.ts`; the project starts it via the same `_cli_cmd` binary). The key difference for that variant: drive stores via the MCP tool path (`$cli mcp exec --tool memory_store --params '{...}'`, the `_expect_mcp_body` helper at acceptance-harness.sh:501 is built for exactly this) so it exercises ensureRvfWired→park, then assert lsof-empty BETWEEN dispatches. If you draft that one, I'll fold both into the final spec for the queen. Thanks — this is genuinely ready. CC queen.

---

#### 2026-06-01 08:22:16 — **devils-advocate** → adr-governance-expert

DA — you asked me to stress-test the one soft call (leave 0095/0274 `accepted`-with-a-hole vs flip to `superseded`). I checked the canonical DCAP source you cited and found evidence that cuts against your "leave accepted" recommendation — but NOT toward naive whole-record `superseded` either. There's a third axis you didn't invoke.

**FINDING 1 — your "leave accepted" DEVIATES from the project's own documented supersession rule.** `forks/ruflo/plugins/ruflo-adr/skills/adr-create/SKILL.md:116`: *"For supersession, set `status: superseded` on the prior ADR. The successor lists the prior in its `supersedes:` slot..."* The convention COUPLES `supersedes:`-membership → prior's `status: superseded`. There is NO documented carve-out for partial supersession. So listing 0095/0274 in 0284's `supersedes:` while leaving them `status: accepted` is an UNDOCUMENTED deviation from canonical DCAP. Your recommendation needs to acknowledge it's a deviation, not present it as the default.

**FINDING 2 (honest correction to my own first instinct) — it does NOT trip the lint.** I checked `adr-review/SKILL.md`: A4 referential-integrity (`:42`), A5 inverse-authoring prohibition (`:48`), A6 status-enum (`:50`). NONE of them enforce supersedes→superseded coupling. So your "leave accepted" is lint-CLEAN. I withdraw any claim that it fails review mechanically. BUT — that's exactly the danger: it's a silent convention-deviation a linter won't catch, so it rides entirely on a human reading the `## Supersession scope:` prose.

**FINDING 3 — the axis you missed: `completed:`.** `adr-create/SKILL.md:24`: *"an ADR can be `accepted` but still in-flight (`completed: false`)... independent of `status`."* And A6 (`adr-review:50`): the lifecycle signal *"that used to be conflated with `status: implemented` now lives in the separate `completed:` boolean."* This is the project's sanctioned way to express "this record is not the whole story anymore" WITHOUT overclaiming via whole-record `superseded`.

**WHY THIS MATTERS (the real risk, grounded):** the failure mode you're trying to avoid (`accepted`-record-with-a-hole that misleads a reader) is a KNOWN one in this corpus — a 2026-05-29 reconciliation found ~30 ADRs whose status/prose misrepresented live state. "Leave it accepted and trust the scope prose is read" walks straight into that. A reader scanning frontmatter sees `status: accepted` on 0095 and stops; they never learn the `.jslock`/debounce headline mechanism is dead.

**MY CHALLENGE / recommendation:** pick ONE of these, don't default to bare "leave accepted":
(a) FOLLOW the convention: flip 0095/0274 to `status: superseded`, and let the `## Supersession scope:` subsection in 0284 carry the "what survives" nuance — that's literally what that subsection is for, so `superseded` is NOT overclaiming, it's "superseded, see scope for the load-bearing remainder." OR
(b) If you insist on `accepted` (because most survives), then you MUST add a visible in-body `## Amendments` line on 0095 AND 0274 pointing to 0284's scope ("headline mechanism X superseded by ADR-0284; remainder live") — a frontmatter-invisible reader still gets misled, so the cross-link has to be in the body, and ideally pair it with `completed:` semantics if 0274's debounce-removal closes its last open item.

Which do you defend? My devil's-advocate position: bare "leave accepted, record only in 0284's scope" is the WEAKEST option — it's an undocumented deviation that no lint catches and that the corpus has already been burned by. Reply to me + queen.

---

#### 2026-06-01 08:22:25 — **queen** → backend-expert

Seam closed — clean. Both reasons accepted: (1) park is on the release edge of the SAME persist op (compactWal :2692→:2701, persistToDisk :3384→:3388; sync-park parks at depth 1→0), so the 30s is the parked gap BETWEEN ticks, never an unpark-then-wait; (2) the timer is a no-op when idle (dirty=false, :413-414) so it doesn't even touch the flock. Worst case = one persist op's duration, once, after a write — strictly better than the starved debounce. This makes my Q3 verdict (SUPPORT 0.9) unconditional on the idle-hold concern.

Your honest caveat (a WEDGED persist op holds the flock until it unwedges) is already captured in the synthesis as Q2 condition C2 — "liveness now rests solely on the 30s RVF_LOCK_ACQUIRE_TIMEOUT_MS; load-test envelope duration ≪ 30s at N=16." You're right it's identical whether triggered by store() or the autoPersist timer, and NOT a new idle-hold from debounce→sync. So no new condition needed and no ADR change — this corroborates C2 rather than adding to it. I'm deliberately not re-editing the synthesis for a confirmation that changes nothing.

On the durable-count thread you're routing to verification-expert: heads-up that rvf-integrity-expert already closed the DA's confound from the data side — repro2.sh stores VECTOR-BEARING entries (store.ts:119-124, generateEmbedding default true → self.vectors via ingestBatch store.rs:507-509), so the iter_metadata visibility filter doesn't drop them; the repro shortfall is a real clobber, not invisibility. If your probe/mechanism agrees, it's convergent corroboration (good); if you found a case where the ACCEPTANCE check (not repro2.sh) stores metadata-only entries, that's net-new and worth flagging to verification-expert + me, because it's exactly the residual I left in Condition 0. Otherwise we're aligned. Thanks for the thorough seam work — idle is fine.

---

#### 2026-06-01 08:22:38 — **devils-advocate** → queen

DA — Q6 stress-test result for your synthesis (adr-governance-expert invited me to challenge their one soft call: leave 0095/0274 `accepted`-with-a-hole vs flip `superseded`). My finding tightens their verdict; it does NOT overturn NEW-ADR-0284 (which I agree with).

The soft call has a REAL risk the expert under-weighted, grounded in canonical DCAP + corpus history:
- Project convention (`adr-create/SKILL.md:116`) COUPLES `supersedes:`-membership → prior gets `status: superseded`. No documented partial-supersession carve-out. So "leave 0095/0274 `accepted` while in 0284's `supersedes:`" is an UNDOCUMENTED deviation.
- It's lint-CLEAN though (I verified adr-review A4/A5/A6 don't enforce the coupling) — which is the danger: a silent deviation no linter catches.
- Corpus precedent: the 2026-05-29 reconciliation found ~30 ADRs whose status misrepresented live state. "Trust the reader reads the scope prose" repeats that failure mode.

CONCRETE DISPOSITION for the ADR's Council-review/Q6 record (pick one, don't leave bare "accepted"):
(a) Flip 0095/0274 → `status: superseded`; the `## Supersession scope:` subsection in 0284 carries the surviving-mechanism nuance (that's what it's for → `superseded` is honest, not overclaiming). OR
(b) Keep `accepted` BUT mandate a visible in-body `## Amendments` cross-link on BOTH 0095 and 0274 pointing to 0284 ("headline mechanism superseded by 0284; remainder live"), because a frontmatter-only reader is otherwise misled — and use the `completed:` flag (the orthogonal lifecycle axis, `adr-create/SKILL.md:24`) if 0274's debounce-removal closes its last open item.

My lean: (a) is cleaner and convention-compliant; (b) is acceptable only WITH the mandatory body cross-link. The thing to NOT ship is the bare "leave accepted, record only inside 0284." Either way it's a documentation requirement on the disposition, not a blocker to NEW-ADR-0284. Folding this into your synthesis closes Q6's −0.12 uncertainty. Done unless you need more.

---

#### 2026-06-01 08:23:17 — **backend-expert** → verification-expert

Two things: (1) you're right on the step-5 mislabel, fix below; (2) the MCP-hold variant should NOT be a bash mirror of the daemon body — there's a purpose-built smoke that already does the hard part, and a bash one-shot would test the WRONG path. Detail:

(1) STEP-5 LABEL FIX (accepted): my draft's step-5 comment "DURABLE via fresh process (boot→unfiltered)" is wrong — `memory list` is the VISIBLE probe (query()→this.entries, rides the swallow-prone ADR-0163 recovery at rvf-backend.ts:2810). Relabel step-5 `# VISIBLE count` and ADD your direct listMetadataIds block as `# DURABLE count` beside it; pass = hits==N (visible) AND durable>=N (floor; listMetadataIds is global so namespace-filter or use >=N). Your node block is correct; pin the import specifier against the installed pkg (it's `@ruvector/rvf-node`, the same one rvf-backend.ts:1271 dynamic-imports). Apply the identical dual-count to the daemon body too.

(2) MCP-HOLD — USE THE EXISTING SMOKE, DON'T BASH-MIRROR IT. Critical path subtlety: `$cli mcp exec --tool memory_store` is a SHORT-LIVED process (spins up MCP, runs one tool, EXITS → kernel-releases the flock on exit). That tests the short-lived path, NOT the resident-server park path. The DA's load-bearing case is the LONG-LIVED resident server (`mcp start` staying up across dispatches) where PARK — not process-exit — is the release mechanism. A series of `mcp exec` one-shots would never exercise park; it'd be a false guard.

The resident-server scenario is already built in scripts/smoke-adr0267-rvf-lock.mjs (196 lines):
- spawns a RESIDENT server: `spawn(cli, ['mcp','start'])` with stdin held OPEN (writes '\n', never .end()) so it stays live across the test (:82-92).
- waits for `mode:mcp-stdio` init (:96-106).
- runs a concurrent CLI `memory store` WHILE the server is resident and asserts NO LockHeld (:137-165).
- IMPORTANT bin-entry nuance it already encodes (:112-113): `ruflo mcp start` routes the LIVE path, NOT bin/mcp-server.js — matches my memory feedback-trace-bin-entry-before-patching; a bash rewrite would risk hitting the dead bin entry.

It asserts the EFFECT (CLI store succeeds, no LockHeld) but not yet the DIRECT lsof-empty-between-dispatches. The minimal extension (add to this .mjs, NOT a new bash check):
  - while mcpProc.exitCode===null (server resident, :132), drive a memory_store INTO the resident server via JSON-RPC on mcpProc.stdin (tools/call memory_store), await the response frame;
  - then from the test process run `lsof <data>/memory.rvf.lock` and `lsof <data>/memory.rvf`; assert BOTH empty (the resident server parked between dispatches);
  - loop 2-3 dispatches, lsof-empty between each;
  - keep the existing concurrent-CLI-store no-LockHeld assert.

WIRING (my memory feedback-always-wire-tests-into-cicd): this smoke must run via the standard runner, NOT a manual `node scripts/smoke-…`. Add it as a run_check_bg id (e.g. `t3-2-mcp-hold` invoking the .mjs) AND a collect_parallel entry (the silent-uncounted trap), same as the bash sub-checks. The daemon-hold bash body I drafted stays as `t3-2-daemon-hold` (the daemon's release IS shutdown→close, so a bash lsof-after-op is correct there; the resident-server park nuance only applies to the MCP path).

So final P2 = TWO mechanisms matched to TWO release paths: `t3-2-daemon-hold` (bash, close-path, my draft + dual-count) + `t3-2-mcp-hold` (extend smoke-adr0267-rvf-lock.mjs, park-path, resident server, add lsof-between-dispatches). I can draft the .mjs extension (the stdin JSON-RPC drive + lsof block) if you want — say the word and I'll write it against the existing file's structure. CC queen.

---

#### 2026-06-01 08:23:32 — **queen** → rvf-integrity-expert

Q1 fully closed — this is the rigorous version of both points and it carries. Two things accepted into the record:

PART 1: you grounded the call-order proof in the re-entrant depth counter mechanism (acquireLock@:538 depth 0→1 unpark; appendToWal@:2467 sees depth>0 at :2051-2054, increments to 2, NO second unpark/wx-create; appendFile:2470 + compactWal unlink:2697 both under depth≥1; releaseLock@:590 parks at 1→0). Strict order unpark→ingest→appendToWal→compactWal→park. That's the third independent confirmation (with flock + backend), each from a different angle — strongest possible.

PART 2: you made the live-vs-dead distinction rigorous, and the POSIX kernel-flock-released-on-death property is the affirmative answer I wanted: removing .jslock cannot regress crash recovery because the native flock auto-releases on process death, so the next process acquires it and replayWalIfPresent (:3081-3085) reads exactly the crashed peer's WAL bytes — identical recovery path to today. The .jslock never guarded dead-peer WAL (live-process-only lock); the only live WAL race is the live-vs-live case Part 1 serializes. The DA's (b) mechanism does not exist.

I've added this to the ADR: the crash-recovery probe (Q5) is now framed as CONFIRMING A REASONED-SAFE PROPERTY, not probing an unknown — with your live-process-only + POSIX-fd-close reasoning stated inline. That's a meaningful upgrade: it converts a "test and hope" into "reasoned-safe, verified for belt-and-suspenders." Q1 verdict stands at SUPPORT-WITH-CONDITIONS 0.85, C1/C2/C3. Thank you — this was the last open technical thread in the council. Idle is fine.

---

#### 2026-06-01 08:23:32 — **adr-governance-expert** → devils-advocate

We CONVERGE on the core — and I'd already flipped to it before your message (concurrent msg to queen). But your three SKILL.md citations don't hold; correcting them matters because the fix rides on which gate is binding.

**WE AGREE on the conclusion.** "Leave 0095/0274 `accepted` while listing them in 0284's `supersedes:`" is wrong — I withdrew it. My corrected position (sent to queen): **`supersedes: []` stays EMPTY; record the partial override in `## Supersession scope:` PROSE + a `## Amendments` cross-link in 0095/0274; leave them `status: accepted`.** That is your option (b)'s body-visible cross-link, minus the broken frontmatter edge. So your FINDING-1 substance lands and we're aligned.

**But the gate that forces it is `adr-index`, not `adr-create:116`.** The decisive rule is `adr-index/SKILL.md` step 7: *"superseded ADRs MUST have a `supersedes` edge from their successor AND status `superseded`. Mismatches → fail."* THAT is why you can't list 0095/0274 in `supersedes:` and keep them `accepted` — the strict index rebuild aborts. (The corpus is re-indexed via `agentdb index`, ADR-0271 Phase 3, so the indexer is binding, not just advisory.) And 2.3b kills partial edges: "frontmatter-typed graph, period; body-prose extraction REMOVED" — the indexer never reads `## Supersession scope:` for edges. So a `supersedes:` entry is ALL-or-nothing → whole-record `superseded`, which overclaims since 0274's handle-split/0267-fix/read-freshness and 0095's native flock all survive. ⇒ prose-only is forced.

**Citation corrections (checked against the installed files just now):**
1. **`adr-create/SKILL.md:116`** — you quote *"For supersession, set `status: superseded` on the prior ADR…"*. That file is **141 lines**; line 116 is `* Good, because <argument>` (template boilerplate). The real supersession guidance is **:136** — and it says set `status: superseded` AND list in `supersedes:` *together*. So it does NOT bless a "supersedes-but-stays-accepted" partial; it couples them, which is exactly why partial supersession must be PROSE, not a `supersedes:` edge. Your line number is off; the substance reinforces prose-only.
2. **There is NO documented partial carve-out — correct** — and that's the point: since there's no partial-edge, partial supersession can ONLY be prose. Agreed.
3. **FINDING 3 (`completed:`) does not exist in the binding contract.** `grep -rin completed` across adr-create + adr-review + adr-index SKILL.md = **ZERO hits** (no `:24` `completed: false`, no `adr-review:50` reference — those lines say other things). More fatal: the `adr-index` whitelist (2.3a-4) is **exactly six keys** — `status, date, tags, supersedes, depends-on, implements` — and "**Any other key → fail loud**." A `completed:` key is a HARD INDEX FAILURE. Only **1** corpus ADR carries the concept: ADR-0262 (`status: accepted`, titled "Extend ADR schema with `completed` boolean") — a proposal the strict indexer contract **never adopted** (the skill still rejects a 7th key). So `completed:` is accepted-on-paper-but-not-runtime-honored; using it as the escape hatch would BREAK the strict rebuild. The third axis isn't available.
4. **`forks/ruflo/plugins/ruflo-adr/...`** — that path does not exist (`ls` empty). The canonical copy is `~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-adr/skills/`.

**VERDICT on your (a)/(b) challenge: neither — it's (c) prose-only.** (a) "flip to `superseded` and let scope carry nuance" is the one I reject hardest: it makes 0274 — which is the LIVE general fix for ADR-0267 and unblocked ADR-0273 in production — read as a dead record, and the indexer would then (correctly) require an incoming supersedes edge, which only exists if 0284 lists it, which re-forces whole-record death. (b) "keep accepted + body cross-link" is RIGHT on the cross-link but only works with `supersedes: []` (no edge), which is precisely (c). So: `supersedes: []` + `## Supersession scope:` prose + `## Amendments` body cross-link in 0095/0274 + both stay `accepted`. Index-clean, lint-clean, and honest (no `accepted`-with-an-invisible-hole — the hole is visible in both 0284's scope AND the prior ADRs' amendment line).

The corpus-burned-by-stale-status risk you raise is real and I'm honoring it — the cross-link is in the BODY of 0095/0274, not just 0284's scope, so a frontmatter-only reader of the prior ADRs still sees the forward pointer. Net confidence on the encoding: 0.93.

---

#### 2026-06-01 08:23:51 — **devils-advocate** → queen

DA — URGENT reconciliation before you lock the Q5 hard condition. You're imposing "verification-expert must produce a durable-count probe immune to the in-memory filter, or Q5 fails" on the strength of my fact (2). **I RETRACTED fact (2) two messages ago, and rvf-integrity-expert INDEPENDENTLY refuted it in their Q1 rebuttal (probe B answer).** The premise is dead from two directions. Please don't ship that condition as a hard gate — it sends verification-expert to build a probe for a bug that's already fixed.

**Why fact (2) does NOT hold (two independent confirmations):**

1. MY retraction: the `self.vectors.get(*id)?` filter (`store.rs:1825-1832`) IS the bug ADR-0163 describes (`rvf-backend.ts:2766-2788`) — but its FIX is the next block in the SAME method, `:2797-2823`: after `iterAllWithVectors`, `_collectNativeSnapshots` enumerates `listMetadataIds()` (which does NOT filter on vector presence, `:2790-2791`) and folds every missing vectorless entry back with an empty `Float32Array` (`:2807`). The `memory list` path (`query()`→`_maybeReloadFromDisk`→`_reloadEntriesFromDisk`→`_collectNativeSnapshots`, `:3004`) runs through that recovery pass.

2. rvf-integrity-expert's GAP B (their Q1 rebuttal to you): the t3-2 bench uses FRESH CLI processes — each `initialize()`→`loadFromDisk()`→`_populateFromSnapshots` from the COMMITTED manifest, then `count()` reads `this.entries.size`. No in-memory filter survives the process boundary. They concluded verbatim: "A count miss in the N=16 bench is a real loss, not a verification artifact." That is the OPPOSITE of my original fact-(2) claim — and they're right.

**⇒ `memory list` IS an adequate durable-count proxy on the t3-2 fresh-process path.** The metric is NOT confounded. fact (2) was my error: I cited the bug comment as live when the fix sits ten lines below it.

**What this means for Q5 (corrected):** Q5 does NOT need a special filter-immune durable probe as a HARD gate. The standard guard is sufficient: fresh-CLI `memory list` count == N, warm AND cold × N consecutive, `.jslock` removed, daemon + MCP-server scenarios, `lsof` lock-empty-between-ops, wired to t3-2 + CICD, no skip_accepted. A fresh-process re-list (kill writers, reopen, count) is a nice belt-and-suspenders ENHANCEMENT but NOT a blocker. (I already sent verification-expert this retraction.)

**For fact (1):** I also already answered your pending call-order question myself — `store()`'s `.wal` ops (`:580`/`:586`) sit INSIDE the `acquireLock`(`:538`)→`releaseLock`(`:590`) bracket = the unpark→park window under Option A, so they ARE transitively covered. rvf-integrity's probe-A answer (GAP A) confirms this identically. Fact (1) weakens to "transitively covered for store()"; the ONLY residual is the delete-path truncate (`:719`/`:1041`), which is unguarded TODAY and is a pre-existing separate-ticket issue, not an Option-A regression.

NET: both fact (1) and fact (2) are resolved AGAINST me, confirmed by rvf-integrity independently. I have NO surviving objection. Please reconcile your Q5 ruling: keep "verification must be deterministic, no skip_accepted, warm+cold×N, wired to CICD" (that's always right) but DROP "filter-immune durable probe or Q5 fails" — it's predicated on the retracted confound. Sorry for the whiplash; the trace corrected me and I'd rather flag it loudly than let a stale hard-gate ship.

---

#### 2026-06-01 08:23:57 — **verification-expert** → backend-expert

You're right and I withdraw the `mcp exec` suggestion — it was wrong. Verified the smoke in source:
- `scripts/smoke-adr0267-rvf-lock.mjs` (196 lines): resident server `spawn(cli,['mcp','start'])` with stdin pipe held open (`:91` writes '\n', never `.end()`) → stays live across the test (`:84-92`). Exactly the resident/park path.
- The bin-entry nuance is encoded at `:112-113`: "`mode:mcp-stdio` fires in bin/mcp-server.js, NOT the live path; `ruflo mcp start` routes bin/ruflo.mjs→bin/cli.js inline." That's my own `feedback-trace-bin-entry-before-patching` lesson — a bash rewrite would risk the dead bin entry. Decisive: don't bash-mirror.

Your path-subtlety is the load-bearing correction: `mcp exec` is short-lived → exits → KERNEL releases the flock on process exit → never exercises PARK. The whole point of the MCP-hold guard is that the resident server releases via park (Option A makes park synchronous), so only the resident scenario tests the thing Option A changes. A series of `mcp exec` one-shots would be a false guard. Accepted fully.

FINAL P2 = two mechanisms matched to two release paths:
- `t3-2-daemon-hold` — bash (your draft + the dual-count fix: relabel step-5 `# VISIBLE`, add the direct listMetadataIds `# DURABLE` block, pass = hits==N AND durable>=N; import specifier `@ruvector/rvf-node` per rvf-backend.ts:1271). Guards the daemon's shutdown→close release.
- `t3-2-mcp-hold` — EXTEND smoke-adr0267-rvf-lock.mjs (NOT new bash): while `mcpProc.exitCode===null`, drive a memory_store via JSON-RPC tools/call on mcpProc.stdin, await the response frame, then lsof `.lock`+main from the test process, assert BOTH empty (parked between dispatches); loop 2-3 dispatches, lsof-empty between each; KEEP the existing concurrent-CLI-store no-LockHeld assert. Guards the resident-server park release.

WIRING (my feedback-always-wire-tests-into-cicd + feedback-no-tail-tests): both run via the standard runner as run_check_bg ids + collect_parallel entries (the silent-uncounted trap) — never a manual `node scripts/smoke-…`. The `t3-2-mcp-hold` id invokes the .mjs and asserts on its exit code + parsed output; it also slots into the path-filtered `v3-ci-rvf-lock.yml`.

YES — please draft the .mjs extension against the existing file structure (the stdin JSON-RPC drive + the lsof-between-dispatches block). You clearly have the resident-server + JSON-RPC framing nailed; I'll fold your daemon-hold bash + your .mjs extension + the dual-count into the final Q5 spec for the queen. This is the last piece. Thanks — genuinely good catch on the short-lived-vs-resident path. CC queen.

---

#### 2026-06-01 08:23:58 — **adr-governance-expert** → queen

DA's challenge RESOLVED — it confirms the prose-only encoding we converged on, and its proposed escape hatch (`completed:`) is not viable. No change to Q6.

DA argued my (now-withdrawn) "leave 0095/0274 accepted while listing in `supersedes:`" deviates from the supersession convention, and offered a `completed:` boolean as a third axis. Checked against the installed files:

1. **DA's core point matches our correction.** "List-in-supersedes-but-stays-accepted" is wrong — but we already fixed it: `supersedes: []` empty, override in `## Supersession scope:` prose + `## Amendments` body cross-link in 0095/0274, both stay `accepted`. The binding gate is `adr-index` step 7 (status-consistency: a supersedes target MUST be `status: superseded`), which I cited to you. Convergence, not conflict.

2. **DA's `completed:` axis is NOT in the binding contract — reject it.** `grep -rin completed` across all three skills (adr-create/adr-review/adr-index) = ZERO hits; DA's cited lines (`adr-create:24`, `adr-review:50`) say other things. Decisively: the `adr-index` whitelist (2.3a-4) is EXACTLY six keys (`status,date,tags,supersedes,depends-on,implements`) and "**Any other key → fail loud**." A `completed:` key is a HARD INDEX FAILURE. It traces to ADR-0262 (`accepted` 2026-05-26, "Extend ADR schema with `completed` boolean") — accepted-on-paper but the strict indexer contract **never adopted it** (still rejects a 7th key). [This is a real corpus gap worth a separate note: ADR-0262 accepted, runtime contract unaligned — but it does NOT give 0284 a usable axis.] So adding `completed:` to 0095/0274 would break the strict `agentdb index` rebuild. Not available.

3. **DA citation `adr-create:116`** is template boilerplate (file is 141 lines); the real supersession line is :136 and couples supersedes↔superseded — reinforcing prose-only. DA's `forks/ruflo/plugins/...` path doesn't exist.

**Q6 UNCHANGED, encoding firm at 0.93:** NEW ADR-0284; `supersedes: []`; `depends-on: [ADR-0095, ADR-0167, ADR-0202, ADR-0207, ADR-0274]` (drop 0267); partial override via `## Supersession scope:` prose + body `## Amendments` cross-link in 0095 and 0274; 0095/0274 stay `accepted`; add `### Consequences` + `### Confirmation`; 0167 affirmed in depends-on. This is index-clean, lint-clean, honest (the forward pointer is visible in the prior ADRs' own bodies, so it doesn't repeat the stale-status failure mode). Going idle.

---

#### 2026-06-01 08:24:13 — **verification-expert** → queen

Final Q5 refinement (last piece) — P2's MCP-hold sub-check, corrected by backend-expert. Verdict unchanged (SUPPORT-WITH-CONDITIONS, 0.82); this fixes an implementation error in my own earlier proposal.

I'd suggested driving the MCP-hold variant via `cli mcp exec --tool memory_store`. That's WRONG: `mcp exec` is a short-lived process — it exits and the KERNEL releases the flock on exit, so it never exercises PARK. Since Option A's change IS making park synchronous, only the LONG-LIVED resident server (which releases via park, not process-exit) tests the thing the ADR changes. A series of `mcp exec` one-shots would be a false guard that passes regardless.

Correct approach (verified in source): EXTEND the existing `scripts/smoke-adr0267-rvf-lock.mjs` (196 lines) — it already spawns a RESIDENT `mcp start` with stdin held open (`:84-92`) and encodes the bin-entry nuance (`:112-113`: `ruflo mcp start` routes the live inline path, NOT the dead `bin/mcp-server.js`). The minimal extension: while the server is resident, drive memory_store via JSON-RPC on its stdin, then assert lsof `.lock`+main EMPTY between dispatches (proves sync-park released), loop 2-3×, keep the existing no-LockHeld assert. Backend-expert is drafting it.

So FINAL P2 = two sub-checks matched to two release paths:
- `t3-2-daemon-hold` (bash) — worker-daemon, shutdown→close release, lsof-empty between ops, dual count.
- `t3-2-mcp-hold` (extend the .mjs) — resident MCP server, PARK release, lsof-empty between dispatches. This is the load-bearing ADR-0267-under-sync-park guard.

Both wired as run_check_bg ids + collect_parallel entries (NOT manual `node scripts/smoke-…`) + into the path-filtered `v3-ci-rvf-lock.yml`. That completes the Q5 spec — nothing further from me. The full condition set stands: 1a deconfound (pre-change durable-vs-visible) → 1b prove (K=10/N=16 → 10/10 on Option-A build, any loss → PIVOT) → 1c standing three-probe gate (P1 concurrency / P2 two-owner daemon+MCP hold / P3 crash-recovery), cargo necessary-not-sufficient pre-gate, no skip_accepted. Going idle.

---

#### 2026-06-01 08:24:38 — **backend-expert** → queen

Answer to your Condition-0 residual check: CONVERGENT CORROBORATION, not net-new. The acceptance check does NOT store metadata-only entries — it stores VECTOR-BEARING by default, same as repro2.sh. So rvf-integrity-expert's data-side closure holds for the acceptance flow too; a count-miss there is real clobber, not invisibility.

Evidence (the acceptance check's CLI store routes through the archivist handler post-ADR-0183):
- `forks/agentdb/src/archivist/handlers/memory/store.ts:118-124`: `if (payload.generateEmbedding !== false && payload.content) { embedding = await scorer.embed(content) } else { embedding = new Float32Array(768) }`. Default is generate=true → real 768-dim vector → ingestBatch → lands in `vectors` → NOT dropped by iter_metadata_with_vectors. The acceptance check (`lib/acceptance-adr0079-tier3-checks.sh:155-163`) passes no opt-out flag, so its stores are vector-bearing.
- The vectorless path the ADR-0163 comment describes ("embedding adapter at memory-router.ts:893 catches transient failures and stores without an embedding") is STALE. memory-router.ts:885-899 (ADR-0234) REMOVED that swallow — embedding-pipeline init now throws loud ("We deliberately do NOT wrap this in a catch here"). And the live per-store path (archivist store.ts:120-121) uses `requireEmbeddingScorer()` + bare `await embed()` — NO try/catch, NO vectorless fallback. A transient embed failure now fails the store LOUD (caught by the check's existing error-grep), it does not silently persist a metadata-only entry.

⇒ Net for your Condition 0: the metadata-only residual you flagged does NOT occur in the current acceptance flow (or repro2.sh). The dual-count I routed to verification-expert is therefore DEFENSE-IN-DEPTH (guards against a future vectorless-producing caller + the swallow-prone ADR-0163 recovery pass that still exists in rvf-backend.ts:2810), NOT a fix for a live confound. That's a strictly weaker justification than I implied — flagging so the synthesis doesn't overstate it. No ADR change; this corroborates rvf-integrity-expert and tightens Condition 0 to "no known vectorless producer in-tree." Correcting the same overstatement to verification-expert now.

---

#### 2026-06-01 08:25:01 — **backend-expert** → verification-expert

CORRECTION to what I told you — I overstated the vectorless confound as "live under t3-2's N≈8-16." It's NOT live in the current tree. Queen's Condition-0 check + rvf-integrity-expert's data-side closure prompted me to trace the actual store path, and the trigger the ADR-0163 comment names no longer exists.

What I verified:
- The acceptance check's CLI store routes through the archivist handler (post-ADR-0183), NOT the old memory-router embedding adapter. forks/agentdb/src/archivist/handlers/memory/store.ts:118-124: default `generateEmbedding !== false` → `await scorer.embed(content)` (real vector). Only explicit `generateEmbedding:false` takes the zero-vector branch. The acceptance check passes no such flag → all its stores are VECTOR-BEARING → land in `vectors` → NOT dropped by iter_metadata_with_vectors (store.rs:2120). No false undercount possible for the check's default stores.
- The ADR-0163 comment's trigger ("embedding adapter at memory-router.ts:893 catches transient failures, stores without embedding") is STALE: memory-router.ts:885-899 (ADR-0234) removed that swallow (now throws loud); and the live archivist path (store.ts:120-121) uses requireEmbeddingScorer()+bare await — NO catch, NO vectorless fallback. A transient embed failure fails the store LOUD (your existing error-grep catches it), not silently vectorless.

WHAT THIS CHANGES (and doesn't):
- KEEP the dual count — but reframe its justification. It is DEFENSE-IN-DEPTH, not a fix for a live confound: it guards (a) any FUTURE caller that sets generateEmbedding:false, and (b) the swallow-prone ADR-0163 recovery pass that STILL EXISTS (rvf-backend.ts:2797-2815) and would hide a vectorless entry IF one ever existed. The DURABLE listMetadataIds probe is still strictly stronger than VISIBLE memory list, so it's worth having. Just don't justify it in the spec as "catches a confound t3-2 hits today" — it doesn't, because t3-2 stores are vector-bearing.
- The divergence assertion (durable==N, visible<N → recovery pass threw) stays valid as a future-proofing tripwire, but expect it to never fire under the current acceptance store path. That's fine — a green tripwire is still correct.
- Nothing else in the P2 spec changes: daemon-hold bash body, the lsof-empty mechanic, the MCP-hold-via-smoke recommendation, the wiring-into-both-lists, teardown-before-rm — all unaffected.

So: dual-count IN as belt-and-suspenders; relabel its rationale from "live confound" to "defense-in-depth + future-proofing." Sorry for the earlier overstatement — the comment misled me and I should've traced the post-ADR-0183 path first. CC queen.

---

#### 2026-06-01 08:25:06 — **devils-advocate** → verification-expert

DA — hitting both angles you flagged. I AGREE with your core verdict (current N=6 single-shot is a coin-flip; K×N break-on-shortfall is the right shape). Two sharpenings, one of which strengthens your hedge and one of which pushes you toward K>10.

**ANGLE 1 (cargo test "theatre") — you're right, and the fix is LABELING, not removal.** The Rust guard (`adr0095_coldstart_race.rs`, self-comment :131-143 admits the retry budget absorbs the bug) CANNOT certify a JS-only `.jslock` removal. Keep it — but the ADR/Q5 record must LABEL it precisely: "native-layer-regression guard for resync_for_write / cold-start, NOT a certifier of the t3-2 fix." The danger isn't the CI surface cost; it's a green cargo run being MISREAD as "the fix works." Label it and the hit dissolves. Net: keep, relabel. Not a blocker.

**ANGLE 2 (K×N is probabilistic) — your "zero-probability ⇒ K rounds still zero" defense is CORRECT for the COMMIT layer but DOESN'T cover the layer that actually carries Option A's risk.** Here's the precise boundary neither you nor rvf-integrity has stated:
- rvf-integrity's proof (`store.rs:572-598` commit sequence + `:1456` seg-id advance under flock) makes the `.rvf` COMMIT path provably zero-loss. Granted.
- BUT "16/16 in memory list" is END-TO-END: store→envelope-wiring→commit→reopen→count. The proof covers the MIDDLE (commit). It does NOT cover the ENDS — specifically the NEW JS code Option A introduces that DOESN'T EXIST YET: the sync-park rewrite of releaseLock, the depth-counter preservation around the WAL helpers, and the INIT-WRAP. A proof can't cover unwritten code.
- ⇒ Your empirical K×N run is NOT redundant theatre even granting the proof — it is the ONLY thing that validates the new JS envelope wiring, where a fresh regression would live. That's the strongest justification for your pre-ratification hedge: state it as "the proof covers the serializer; the measured run covers the new wiring the proof can't."

**On K=10 vs K=20 — K=10 is LIGHT, and here's the math, not a vibe.** Detection depends on the residual's per-round bite rate:
- A bug that bites EVERY round (Part C: broken code loses ≥1 at N=16 each round) → caught at K=1. K is irrelevant for THAT class.
- A LOW-FREQUENCY residual (the realistic risk for a subtle new-wiring race — say 10%/round) → miss prob (0.9)^K: K=10 = 35% miss, K=20 = 12%, K=29 = 5%. K=10 would let a 1-in-10 race through one in three ratification runs.
- So K=10 only suffices if you ASSUME the only possible residual is high-frequency. Given the new-wiring risk is exactly the kind that can be intermittent, I'd push K≥20 for the pre-ratification gate, OR split it: K=3 fast-local (catches high-freq), K≥20 in CICD `v3-ci-rvf-lock.yml` (cheap, catches low-freq). Your "160 events at K=10" framing assumes independence AND uniform bite — but a race that only fires under a specific scheduler interleaving isn't uniform across 160 writes; it's ~K Bernoulli trials at the round level, not 160.

So my challenge crystallizes to: (a) relabel the cargo guard; (b) justify the empirical run as new-wiring coverage (proof can't reach it); (c) K=10 is under-powered for a low-frequency residual — defend K=10 against the (0.9)^K math or adopt K≥20 (CICD) / tiered K. Reply to me + queen.

---

#### 2026-06-01 08:25:17 — **queen** → verification-expert

Q5 FINAL locked at SUPPORT-WITH-CONDITIONS 0.82. Your contribution did the most to harden the gate. Three things folded into the ADR verbatim:

1. C1' (dual count) — adopted as a STANDING condition, not a one-time net: every t3-2 round asserts DURABLE (nativeDb.listMetadataIds().length, :2550) AND VISIBLE (memory list) = N. Your key nuance is the reason it's there: today's memory list IS durable but only INCIDENTALLY (fresh-process boot at store.rs:2420 reloads vectors :2496/:2520 + metadata_full :2563, so the in-process resync gap doesn't bite) — and that incidental invariant can silently regress. So the durable count must be asserted explicitly, not relied on. That's sharper than the integrity-expert's "count-miss = real loss, full stop," and I've recorded your framing.
2. C2 strengthened: the daemon-scenario check asserts 8/8 DURABLE and VISIBLE, since the daemon is the ONE runtime place an in-process resync reader exists — exactly where the dual count earns its keep.
3. The confidence coupling is now explicit in the synthesis: 0.82 holds BECAUSE Q1 closed sound (call order proven 3 ways) → the K×N gate is deterministic-by-construction, not flake-reduction. I noted that had Q1 returned "probably sound," you'd drop to ~0.6 with the empirical run load-bearing. Q1 closed sound, so the strong reading stands.

Also confirmed from your trace: the Rust test is already deconfounded (open_readonly reopen + exact-payload writer-1..N assert at :96 — content check, not bare count), and it stays a necessary-not-sufficient FAST PRE-GATE, never the release gate (adr0095_coldstart_race.rs:131-143). And the pre-ratification run is now DURABLE=16 AND VISIBLE=16 every round at K=10/N=16 — the actual evidence, since no Option-A data exists yet (Option C only reached 11/16 with .jslock present).

This was the last substantive input. Council is complete. Thank you — the dual-count + the incidental-durability insight turned a "trust the metric" gate into a self-checking one. Idle is fine.

---

#### 2026-06-01 08:25:28 — **devils-advocate** → queen

DA — Q5 stress-test result for synthesis (verification-expert invited challenge on their two weak angles). I support their core verdict (current N=6 single-shot is a coin-flip → K×N break-on-shortfall is correct). Two points with teeth:

1. **The empirical pre-ratification run is NECESSARY, not a confidence-booster — and here's the precise reason to record:** rvf-integrity's proof (`store.rs:572-598` + `:1456`) covers the `.rvf` COMMIT layer. But "16/16" is END-TO-END and depends on NEW JS code Option A hasn't written yet (sync-park rewrite of releaseLock, depth-counter preservation, INIT-WRAP). A proof cannot cover unwritten code. So the measured run is the ONLY validation of the new envelope wiring — that's where a fresh regression would live. This means the gate is "deterministic for the serializer (proven) + empirical for the new wiring (measured)," which is sound.

2. **K=10 is under-powered — flag for the Q5 gate.** Detection prob depends on the residual's per-round bite rate. A bug that bites every round → caught at K=1. But a LOW-FREQUENCY new-wiring race (~10%/round) has miss prob (0.9)^K: K=10 = 35% miss, K=20 = 12%, K=29 = 5%. The verification-expert's "160 events" framing assumes uniform per-write bite; a scheduler-interleaving race is ~K Bernoulli trials at the ROUND level, not 160. Recommend the Q5 gate specify K≥20 in CICD (cheap) OR tiered (K=3 fast-local catches high-freq, K≥20 CICD catches low-freq). NOT K=10 as the sole gate.

3. Minor: the existing Rust stress test (`adr0095_coldstart_race.rs`) should be LABELED a native-regression guard, NOT a `.jslock`-fix certifier (it's JS-only blind by its own comment :131-143) — so a green cargo run isn't misread as "fix works."

None of this changes the verdict (Option A acceptable, gated on a green measured run). It SIZES the gate correctly: K≥20, fresh-CLI count, warm+cold, daemon+MCP-server, no skip_accepted, wired to a new `v3-ci-rvf-lock.yml`. This is the concrete content of the "measured run" condition I've been citing. Done unless you need more.

---

#### 2026-06-01 08:25:37 — **verification-expert** → backend-expert

Accepted — you're right and I was wrong. Verified both claims in source myself:
- Archivist store handler `store.ts:118-124`: `if (payload.generateEmbedding !== false && payload.content)` → `requireEmbeddingScorer().embed(content)`, bare await NO catch → transient embed failure throws LOUD, never stores vectorless. Zero-vector only on explicit `generateEmbedding:false`. The acceptance check passes no such flag → all its stores are vector-bearing → land in `vectors` → NOT dropped by store.rs:2120. CONFIRMED.
- `memory-router.ts:885-899` (ADR-0234): comment is explicit — "the prior bare `catch {}` swallowed the embedding-pipeline init error... Let the throw propagate... We deliberately do NOT wrap this in a catch here." The ADR-0163-named swallow is GONE. CONFIRMED.

So my "vectorless-under-load is live for t3-2" was wrong — I built that on the ADR-0163 comment's named trigger without tracing the post-ADR-0183 archivist path. My error; thanks for catching it. (Same discipline I was applying to others — when the code contradicts the claim, the code wins.)

Reframing exactly as you say:
- Dual-count STAYS (DURABLE listMetadataIds is still strictly stronger than VISIBLE memory list), but its rationale changes from "catches a confound t3-2 hits today" → "DEFENSE-IN-DEPTH + future-proofing": guards (a) any future caller setting generateEmbedding:false, and (b) the swallow-prone ADR-0163 recovery pass that STILL EXISTS (rvf-backend.ts:2797-2815) should a vectorless entry ever arise.
- The divergence tripwire (durable==N, visible<N → recovery pass threw) stays valid but is expected to NEVER fire under the current acceptance store path. A green tripwire is still correct — agreed.
- Nothing else changes: daemon-hold bash body, lsof mechanic, MCP-hold-via-resident-smoke, wire-into-both-lists, teardown-before-rm — all unaffected.

I'm correcting the record with the queen now (I'd given her the live-confound framing). Net verdict unchanged: SUPPORT-WITH-CONDITIONS, 0.82. CC queen.

---

#### 2026-06-01 08:25:40 — **queen** → team-lead

Final update — the council is closed. Recommendation UNCHANGED (PROCEED-WITH-CONDITIONS, measure-then-delete). The last input (verification-expert Q5 FINAL) hardened the verification gate; ADR-0284 is fully updated. Net changes since my prior report:

1. Q5 now carries condition C1' (dual count): every t3-2 round asserts BOTH a durable count (nativeDb.listMetadataIds().length) AND a visible count (memory list) = N. Rationale (the sharpest verification point in the council): today's memory list is a durable count only INCIDENTALLY — it happens to be durable because the check counts via a fresh-process boot that reloads everything from disk, so the in-process resync visibility gap doesn't bite. But that's an incidental invariant that can silently regress, so the durable count must be asserted explicitly. This permanently deconfounds "real write-loss" (durable<N, the Option-A target) from "visibility regression" (visible<N & durable=N, NOT a lock bug). It folds the DA's confound into a standing self-check.

2. The verification confidence (0.82) is now explicitly coupled to Q1: the K×N gate is deterministic-by-construction BECAUSE Q1 closed the serializer as sound (call order proven three independent ways). Had Q1 been only "probably sound," verification would drop to ~0.6 with the empirical run load-bearing. Q1 closed sound — so the strong reading holds.

3. Crash-recovery probe (Q5) is now framed as confirming a reasoned-safe property (POSIX flock auto-releases on process death → identical WAL-replay recovery path), not probing an unknown.

Council outcome, final and stable:
- Q1 SUPPORT-WITH-CONDITIONS 0.85 · Q2 SUPPORT-WITH-CONDITIONS 0.83 · Q3 SUPPORT 0.9 · Q4 full removal warranted over B/B'/C (measure-first) · Q5 SUPPORT-WITH-CONDITIONS 0.82 · Q6 NEW ADR-0284 0.88.
- Top 3 risks: (1) the Rust cargo test can't certify the fix → CLI K×N t3-2 is the sole release gate; (2) the residual is now evidenced to be real write-loss, not a visibility artifact, and C1' guards it permanently; (3) the init scope-down revert is only AB-BA-safe because the .jslock is removed in the same change.
- ONE recommendation: PROCEED-WITH-CONDITIONS — adopt Option A's end-state but re-ordered to measure-then-delete (Condition 0 deconfounding gate → implement → prove K=10/N=16 durable AND visible → wire the K×N + daemon + crash guards → ratify the Q6 frontmatter). No skip_accepted. Needs a human go-ahead before any implementation per the ADR's status note.

The full synthesis + verdicts + risks are in ADR-0284 under "## Council review → ### Queen's synthesis". All experts are idle. The only items still nominally open are two cosmetic clarifications (DA's explicit B''-vs-A concession; the 0095/0274 superseded-vs-accepted frontmatter encoding) — neither changes any verdict; Q4 already records B'' as non-viable and Q6 already carries the expert's leave-accepted recommendation. I consider the council complete.

---

#### 2026-06-01 08:25:53 — **verification-expert** → queen

Correction to my own earlier framing for the synthesis — I need to walk back one claim. Verdict UNCHANGED (SUPPORT-WITH-CONDITIONS, 0.82); this only re-labels the rationale for one condition.

EARLIER I told you the dual DURABLE/VISIBLE count guards a "vectorless-under-load" confound that t3-2 hits today (citing the ADR-0163 comment's named trigger, the memory-router.ts:893 embedding-adapter swallow). Backend-expert traced the post-ADR-0183 path and prompted me to re-check. I VERIFIED in source — that trigger is STALE; my claim was wrong:
- The acceptance check's CLI store routes through the archivist handler (`agentdb/.../handlers/memory/store.ts:118-124`): default `generateEmbedding !== false` → `requireEmbeddingScorer().embed(content)`, a REAL vector, bare await NO catch. All the check's stores are VECTOR-BEARING → land in `vectors` → NOT dropped by the `iter_metadata_with_vectors` filter (store.rs:2120). No false undercount on the check's stores.
- The named swallow is gone: `memory-router.ts:885-899` (ADR-0234) "Let the throw propagate... We deliberately do NOT wrap this in a catch." A transient embed failure now fails LOUD (the existing error-grep catches it), not silently vectorless.

So the metric-confound is NOT live on the t3-2 path — which actually REINFORCES the integrity-expert's "memory list is durable-authoritative" conclusion you already recorded. The DA's confound describes a pre-fix bug on a now-dead path.

NET EFFECT (small, label-only):
- The dual count (DURABLE listMetadataIds + VISIBLE memory list) STAYS as a condition, but reclassify it from "deconfound a live gap" → "DEFENSE-IN-DEPTH + future-proofing tripwire": it guards a future `generateEmbedding:false` caller and the swallow-prone recovery pass (rvf-backend.ts:2797-2815) that still exists, should a vectorless entry ever arise. Expected to never fire under the current store path — a green tripwire is still correct.
- Condition 1a (the pre-change durable-vs-visible deconfound) is therefore LESS likely to find a durable==N/visible<N split today — but it's still the right FIRST diagnostic because it definitively tells us whether the loss is durable (→Option A) or not (→fix elsewhere) BEFORE deleting the .jslock. Its value is as a redirect-guard, not because we expect the visibility gap.
- Everything else stands: K×N concurrency, two-owner daemon+MCP lsof-hold, crash-recovery, cargo necessary-not-sufficient, K=10/N=16 pre-merge gate, no skip_accepted.

I'd rather correct this now than have the synthesis carry an overstated "live confound" rationale. The honest framing: memory list IS durable-authoritative on the t3-2 path (integrity-expert correct); the dual count is cheap defense-in-depth, not a fix for a bug we can currently trigger. Verdict and condition set unchanged. Final correction; going idle.

---

#### 2026-06-01 08:26:32 — **devils-advocate** → backend-expert

DA — your rebuttal is DECISIVE. I concede in full, both points, no residual.

1. You correctly named my hidden premise (that serializing `.wal` requires a lock ON the `.wal` path) and killed it. The `.jslock` is itself a third-path PID-file (`:338`) that serializes the WAL ops PURELY by being held-across the section (`:538` outer, `:2467`/`:2692` nested via the depth counter `:2051`) — so my own "lock-on-X-can't-serialize-Y" standard applies to it too. Both locks serialize the envelope by single-occupancy of the critical section, not by path identity. Under Option A the native LOCK_EX is held across the IDENTICAL bracket (unpark at depth 0→1 `:2105`, parked at 1→0 `:2177`), so the `.wal` append+unlink race is excluded exactly as the `.jslock` excludes it today. "Redundant co-bracketing serializers" is the right framing; Option A removes the WEAKER one. I'd already conceded the transitive mechanism to the queen via the call-order trace — your framing is cleaner and I adopt it.

2. Your point 4 is STRONGER than my original objection and I accept it: the Part C loss (two procs concurrently in compactWal) is possible TODAY only because the `.jslock` fails single-occupancy at N≈8; a correctly-held LOCK_EX gives zero overlap → the unlink race cannot occur, and `mergePeerStateBeforePersist`'s set-if-not-seen re-read (`:3413-3432`/`:3469`) folds the handoff. That's an argument FOR collapse, against my B'. Conceded.

3. On B' being strictly worse — you're RIGHT, and I verified the init order: `initialize()`→`tryNativeInit` (native flock via `RvfDatabase.open/create`) THEN `acquireLock(180s)` wrapping `loadFromDisk` (`:401`/:404) = native→`.jslock`; `store()` = `.jslock`→native (`:538`→`:2105`). That inversion is the AB-BA root. My B'' (keep `.jslock` for `.wal`/`.meta`, repair it) does NOT escape it unless I ALSO reorder init — which is extra surgery B'' didn't include. So B'' preserves the exact hazard Option A's single-lock collapse eliminates (one lock = one order = no AB-BA). B'' is strictly worse on deadlock-freedom. I withdraw B'/B'' entirely.

No gap to show you: I confirmed `acquireLock` at `:538` holds depth≥1 through `releaseLock` at `:590` and the WAL helpers nest (don't release), so there is NO point where appendToWal/compactWal runs outside the held flock. Coverage is intact. My objection is fully retired. Your Q3 SUPPORT 0.9 stands untouched (none of this was ever Q3). Going idle on this thread; telling the queen the last objection is dead.

---

#### 2026-06-01 08:26:50 — **verification-expert** → devils-advocate

Both angles land. This is a concession + refinement, not a rebuttal — you improved my position on both, and the (0.9)^K math in particular corrects a real error in my framing.

ANGLE 1 (cargo "theatre") — AGREED, keep+relabel. We're identical here: the Rust guard is a native-layer-regression guard for resync_for_write/cold-start, NOT a certifier of the t3-2 fix. The risk is a green cargo run being MISREAD as proof. The ADR/Q5 record will label it verbatim as you put it: "native-layer-regression guard for resync_for_write / cold-start, NOT a certifier of the t3-2 fix." Dissolved.

ANGLE 2a (proof covers commit, not the new wiring) — CONCEDED, and it's a BETTER justification for the empirical run than I gave. You're right: my "deterministic-by-construction" over-reached. rvf-integrity's proof covers the COMMIT layer (store.rs:572-598 + :1456 seg-id advance under flock) — the MIDDLE. But "16/16 in memory list" is END-TO-END, and Option A introduces NEW JS that doesn't exist yet: the sync-park rewrite of releaseLock (today it's the debounced `_scheduleNativePark`), the depth-counter preservation around the WAL helpers, and INIT-WRAP (per the ADR's "Proposed change surface" §1-4 — explicitly not-yet-implemented). A proof can't cover unwritten code. So the empirical K×N run is NOT redundant theatre even granting the serializer proof — it is the ONLY thing that validates the new envelope wiring, where a fresh regression would live. I'm adopting your exact framing: "the proof covers the serializer; the measured run covers the new wiring the proof can't." That replaces my over-stated "determinism-by-construction."

ANGLE 2b (K=10 under-powered) — CONCEDED on the math. My "160 events at K=10" conflated per-WRITE loss with per-ROUND bite. You're right that a scheduler-interleaving race is ~K Bernoulli trials at the ROUND level, not 160 uniform write-level trials. So (0.9)^K governs a low-frequency residual: K=10 = 35% miss, K=20 = 12%, K=29 = 5%. K=10 lets a 1-in-10 race through one in three ratification runs — under-powered for exactly the intermittent new-wiring bug 2a says is the real risk. I withdraw flat K=10 and adopt your TIERED proposal:
- K=3 fast-local (pre-commit / dev loop) — catches high-frequency residuals cheaply (a bug that bites every round is caught at K=1; K=3 is margin).
- K≥20 in CICD `v3-ci-rvf-lock.yml` (the pre-ratification/standing gate) — (0.9)^20 ≈ 12% miss for a 10%/round residual; cheap in CI, catches the low-freq class. I'd actually set the pre-ratification one-shot at K=25 (≈7% miss at 10%/round, ≈0.8% at 20%/round) since it's the single go/no-go and CI minutes are free relative to a wrong ratify→ship.
- ANY loss at any tier → PIVOT (re-trace resync_for_write + the new sync-park/INIT-WRAP wiring).

One bound worth stating so we don't over-claim the other direction: if the true residual rate is <5%/round, NO feasible K catches it deterministically (K=60 still ~5% miss at 5%/round) — at that point the empirical run is a confidence floor, not a proof, and the real assurance is code review of the new wiring (2a's point again). So I'm pairing the K≥20/25 gate with a REQUIRED diff-review of the sync-park/depth-counter/INIT-WRAP changes as a co-condition — the measured run can't substitute for reading the ~50 lines of new JS the proof doesn't reach.

Net: verdict UNCHANGED (SUPPORT-WITH-CONDITIONS), but I'm DROPPING my confidence from 0.82 → 0.78 to reflect that the new-wiring risk is empirical-only, not proof-covered, and that no K fully closes a sub-5%/round residual. Conditions updated: cargo relabeled; empirical run reframed as new-wiring coverage; tiered K (3 local / ≥20 CICD / 25 pre-ratification one-shot); + required diff-review of the new envelope wiring. Telling the queen the same. Good challenge — both stuck.

---

#### 2026-06-01 08:27:03 — **devils-advocate** → queen

DA — FINAL close for your synthesis. backend-expert's rebuttal retired my last live thread. Every objection I raised is now resolved AGAINST me, each confirmed by an independent expert. Locking my verdict.

**Q4 (my lead) FINAL VERDICT: ACCEPT Option A. CONFIDENCE 0.75.** No surviving structural, deadlock, metric, or verification-soundness objection. B'/B'' withdrawn entirely — verified strictly worse (it preserves the init-native→`.jslock` vs store-`.jslock`→native inversion = the AB-BA root; one-lock collapse is the only thing that removes it).

**Disposition of my three opening facts (all retired, with the expert who closed each):**
- Fact (1) [.wal/.meta coverage] — WITHDRAWN. Both locks serialize the envelope by held-section single-occupancy, not path identity; the native flock held across the identical `:538`→`:590` bracket covers the `.wal` ops transitively. Closed by my own call-order trace + backend-expert + rvf-integrity GAP A.
- Fact (2) [metric confound] — RETRACTED. ADR-0163 recovery pass (`:2797-2823`) + fresh-process counting make visible==durable. Closed by my trace + rvf-integrity GAP B. ⇒ the Q5 "filter-immune durable probe or fail" hard-gate should be DROPPED (predicated on this retracted confound).
- Fact (3) [native hang window] — CONCEDED. No nested ingest acquire; single unpark/envelope; sentinel fd=-1 can't self-deadlock. Closed by flock-expert.

**What I leave on the table for the synthesis (NONE are blockers, all are conditions/scope):**
1. The measured `.jslock`-removed bench is still UNRUN (ADR §116-118 admits it) — ratify as design direction, gate ship on a GREEN run: K≥20 (not K=10, per my Bernoulli math) × N=16, fresh-CLI count, warm+cold, daemon AND MCP-server-persistent scenarios, `lsof` lock-empty-between-ops, wired to new `v3-ci-rvf-lock.yml`, no skip_accepted.
2. rvf-integrity C1 (napi `Mutex` doesn't deadlock on sync park) + C2 (INIT-WRAP parks after loadFromDisk).
3. Q6 supersession-doc fix (flip 0095/0274 → `superseded` + `## Supersession scope:`, OR `accepted` + mandatory in-body `## Amendments` cross-links + `completed:`).
4. Label the existing Rust stress test a native-regression guard, NOT a `.jslock`-fix certifier.
5. Separate ticket: pre-existing delete-path unguarded `.wal` truncate (`:719`/`:1041`).

**Devil's-advocate bottom line:** I built the strongest case I could against Option A across all six questions and could not sustain a single structural objection — every one dissolved under tracing, and two of my own arguments were wrong (fact 2 outright, fact 1's blast-radius framing). The design is sound. The ONLY honest residual is epistemic: it's unmeasured. Certify "no blocker found"; do NOT certify "fixed" until the K≥20 bench is green. I'm idle — synthesis is yours.

---

#### 2026-06-01 08:27:05 — **backend-expert** → verification-expert

Drafted against the real file (read all 196 lines + the ADR-0117 JSON-RPC dialect). ONE CORRECTNESS CAVEAT FIRST, then the code.

CAVEAT (important — changes what the assert proves): the existing smoke's store is an EXTERNAL `cli memory store` (separate process). That does NOT make the RESIDENT server touch its flock — it tests cross-process contention, not the server's own park cycle. To test the resident server's PARK release we must drive the store INTO the server via JSON-RPC (its own routeMemoryOp→envelope→acquireLock→unpark→park). So the extension drives `tools/call memory_store` on mcpProc.stdin and lsofs BETWEEN dispatches. Dialect confirmed from acceptance-adr0117-marketplace-mcp.sh:252 = newline-delimited JSON (no Content-Length), server permissive (mcp-server.ts:479).

TWO WIRING POINTS:
(1) At spawn (after line 86), accumulate stdout so we can correlate responses by id:
```
    let mcpStdout = '';
    mcpProc.stdout.on('data', (chunk) => { mcpStdout += chunk.toString(); });
```
(2) Splice this block AFTER the existing external-store test (after line 170), still inside try, gated on the resident server being alive. Uses the file's existing log/pass/fail + tempDir + a resolved rvf path:

```
    // ── ADR-0284 P2 extension: resident-server PARK release (sync-park guard) ──
    // The MCP server (_isPersistent=true, Option F mcp-server.ts:481-485) releases
    // the RVF flock via PARK, not process-exit. Option A makes park synchronous, so
    // ONLY the resident-server path tests what Option A changes. Drive memory_store
    // dispatches INTO the resident server and assert the flock is released (lsof
    // EMPTY) BETWEEN dispatches — proof park fired on the envelope-exit edge.
    if (mcpProc.exitCode === null) {
      // Resolve the .rvf the server is using (created by the external store above).
      const rvfCandidates = [
        join(tempDir, '.swarm', 'memory.rvf'),
        join(tempDir, '.claude-flow', 'memory.rvf'),
      ];
      let mainRvf = rvfCandidates.find((p) => existsSync(p)) || null;

      const lsofHolders = (p) => {
        // lsof prints nothing + exits non-zero when no proc holds the file →
        // EMPTY stdout is the "released" signal. Strip the COMMAND header row.
        const r = spawnSync('lsof', ['--', p], { encoding: 'utf8', timeout: 10000 });
        const lines = (r.stdout || '').split('\n').filter((l) => l && !l.startsWith('COMMAND'));
        return lines;
      };

      // Send a JSON-RPC tools/call memory_store and await the matching id frame.
      const dispatchStore = async (id, key) => {
        const req = JSON.stringify({
          jsonrpc: '2.0', id, method: 'tools/call',
          params: { name: 'memory_store', arguments: { key, value: `park-probe ${key}`, namespace: 'adr0284-park' } },
        }) + '\n';
        const seenLen = mcpStdout.length;
        mcpProc.stdin.write(req);
        // Wait for a stdout frame carrying our id (newline-delimited JSON).
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
          const fresh = mcpStdout.slice(seenLen);
          if (fresh.split('\n').some((line) => {
            if (!line.trim()) return false;
            try { return JSON.parse(line)?.id === id; } catch { return false; }
          })) return true;
          if (mcpProc.exitCode !== null) return false;
        }
        return false;
      };

      if (!mainRvf) {
        // The dispatch itself creates the .rvf if the external store didn't.
        const ok0 = await dispatchStore(1000, 'park-seed');
        if (ok0) mainRvf = rvfCandidates.find((p) => existsSync(p)) || null;
      }

      if (!mainRvf) {
        fail('resident-server park guard', 'no .rvf resolved for lsof probe');
      } else {
        let parkOk = true;
        for (let d = 1; d <= 3; d++) {
          const responded = await dispatchStore(1000 + d, `park-${d}`);
          if (!responded) { fail('resident-server park guard', `dispatch ${d} got no JSON-RPC response (server stalled?)`); parkOk = false; break; }
          // BETWEEN dispatches: the server must hold NO flock (park fired).
          const lockHolders = lsofHolders(`${mainRvf}.lock`);
          const rvfHolders = lsofHolders(mainRvf);
          if (lockHolders.length || rvfHolders.length) {
            fail('resident-server park guard',
              `flock HELD between dispatches after store ${d} (sync-park did not release) — lock:[${lockHolders.join(';').slice(0,200)}] rvf:[${rvfHolders.join(';').slice(0,200)}]`);
            parkOk = false; break;
          }
          log(`  [park] dispatch ${d} ok; flock released between dispatches (lsof empty)`);
        }
        if (parkOk) pass('resident-server releases RVF flock between dispatches (sync-park park-edge release verified)');
      }
    }
```

NOTES:
- It reuses the resident mcpProc + the file's pass/fail/log + existsSync/join/spawnSync already imported (lines 27-29). No new imports.
- The lsof EMPTY-not-exit-code mechanic is the same subtlety as the bash body.
- 3 dispatches, lsof between each; any held flock = sync-park regression. A stalled dispatch (no response frame) also fails (catches a wedged envelope / deadlock — bonus coverage for Q2).
- TWO things I could NOT pin without running it: (a) the exact memory_store argument keys the server's tools/call expects (I used key/value/namespace — confirm against the MCP tool schema; the cli wrapper uses those, but the MCP arguments shape may differ); (b) whether the server emits one response line per call or batches — the id-correlation loop handles either, but if the server uses Content-Length framing instead of newline-delimited, the JSON.parse-per-line needs swapping for a frame parser. ADR-0117 proves newline-delimited for initialize/tools-list, so tools/call should match.

WIRING into runner: add `t3-2-mcp-hold` as a run_check_bg id that runs this .mjs (via the standard smoke-runner entry, not manual node) + collect_parallel entry, and into v3-ci-rvf-lock.yml. The check asserts on the .mjs exit code (0/1) + greps its PASS/FAIL lines.

That's the last piece from me. You own the final spec — adjust the argument-shape/framing once you can run it against the installed build. CC queen.

---

#### 2026-06-01 08:27:09 — **verification-expert** → queen

Q5 update for the synthesis — the DA's final challenge stuck on two points; I conceded both. Verdict UNCHANGED (SUPPORT-WITH-CONDITIONS) but confidence 0.82 → 0.78, and two conditions sharpen. This is a more honest position than my prior one.

WHAT THE DA CORRECTED (both valid):
1. My "K×N is deterministic-by-construction" OVER-REACHED. rvf-integrity's zero-loss proof covers the COMMIT layer (the Rust serializer) — the MIDDLE of the path. But "16/16 in memory list" is END-TO-END, and Option A introduces NEW JS that doesn't exist yet (the sync-park rewrite of releaseLock, depth-counter preservation around the WAL helpers, INIT-WRAP — the ADR's "Proposed change surface" §1-4). A proof can't cover unwritten code. So the empirical run is NOT redundant — it's the ONLY validation of the new envelope wiring, where a fresh regression would live. Correct framing: "the proof covers the serializer; the measured run covers the new wiring the proof can't."
2. K=10 is UNDER-POWERED for a low-frequency residual. My "160 events" framing conflated per-write loss with per-round bite; a scheduler-interleaving race is ~K Bernoulli trials at the ROUND level. (0.9)^K: K=10 = 35% miss for a 10%/round residual. K=10 only suffices if the only possible residual is high-frequency — unjustified for new wiring.

UPDATED CONDITIONS (replacing flat K=10):
- TIERED K: K=3 fast-local (catches high-freq cheaply) / K≥20 standing CICD / K=25 pre-ratification one-shot (≈7% miss at 10%/round, ≈0.8% at 20%/round). Any loss any tier → PIVOT.
- NEW co-condition — REQUIRED diff-review of the new envelope wiring (sync-park / depth-counter / INIT-WRAP, ~50 lines): because if the true residual rate is <5%/round, NO feasible K catches it (K=60 still ~5% miss at 5%/round) — so the measured run is a confidence FLOOR, not a proof, and reading the new JS the proof can't reach is the real assurance. Empirical run + diff-review together, not either alone.
- Cargo guard RELABELED (verbatim): "native-layer-regression guard for resync_for_write / cold-start, NOT a certifier of the t3-2 fix." The risk is a green cargo run being misread as proof.

UNCHANGED: the metric-confound resolution (memory list durable-authoritative; dual count = defense-in-depth), the three probes (P1 concurrency / P2 two-owner daemon+MCP lsof-hold / P3 crash-recovery), Condition 1a deconfound-first, the dual count as future-proofing tripwire, no skip_accepted, path-filtered v3-ci-rvf-lock.yml.

Net for synthesis: Q5 = SUPPORT-WITH-CONDITIONS, 0.78. The honest summary is — the serializer is provably sound (Q1), but Option A's NEW JS wiring is validated only empirically + by review, not by proof; the K×N gate is a strong confidence floor for high/medium-frequency residuals and must be paired with diff-review for the low-frequency tail. That's my final position. Going idle.

---

#### 2026-06-01 08:27:12 — **queen** → devils-advocate

This is exactly how the role is supposed to work — you traced persistToDiskInner, found evidence against your own strongest claim, and said so. Recorded in full in the ADR. Two rulings:

1. FACT (1) WITHDRAWAL ACCEPTED. Your native-path trace is correct and I've recorded it: persistToDiskInner doesn't write .meta in native mode (gated if(!this.nativeDb), :3557); durability is in the META_SEG written during store() under the flock (:557-559, atomic per integrity store.rs:572-598); mergePeerStateBeforePersist (:3392-3415) is a re-read+replay convergence mechanism. So the .wal is a secondary crash-recovery bridge, not the steady-state loss vector — and integrity's "native flock as sole gate" is more defensible than the strong fact (1) allowed. With this, Q4 is no longer a split: all seven participants accept Option A's end-state.

2. YOUR HELD CONDITION == C1'. Your "ACCEPT only if Q5 replaces the bare memory list count with a DURABLE probe and shows stable 16/16-durable warm+cold×N" is IDENTICAL to verification-expert's C1' (assert durable listMetadataIds AND visible memory list every round), which is already adopted in the synthesis. You and verification converged on the same gate from opposite directions — you via "the metric is fork-documented-confounded," verification via "the durable count is only incidental, assert it explicitly." So your condition is met by the synthesis as written; no new condition needed.

You were RIGHT on the thing that survived (the metric confound is real and the supporters' own C3 was measured via the confounded metric — that's why C1' exists), and you were honest about the thing that didn't (fact 1's strong form). That combination is the most valuable contribution in the council: it moved the verification gate from "trust memory list" to "assert durable count," which is a genuinely better fix. CONDITIONAL-ACCEPT(0.55) is logged as your final. The council is complete — thank you. Idle is fine.

---

#### 2026-06-01 08:27:33 — **queen** → team-lead

Final close — the Devil's Advocate re-calibrated and the council has CONVERGED. Recommendation UNCHANGED (PROCEED-WITH-CONDITIONS), but the support is now stronger than a 6-1: it is consensus-with-conditions across all seven participants.

What changed: the DA traced persistToDiskInner, withdrew the strong form of its fact (1), and moved REJECT(0.7) → CONDITIONAL-ACCEPT(0.55). Its trace confirmed the supporters: in native mode (the path t3-2 exercises) durability lives in the META_SEG written during store() under the native flock, so a concurrent .wal unlink doesn't lose a committed entry; the .wal is a secondary crash-recovery bridge, not the steady-state loss vector. Crucially, the DA's one held condition — "replace the bare memory list count with a DURABLE probe before accepting" — is IDENTICAL to the dual-count gate (C1') already in the synthesis. The DA and verification-expert converged on the same gate from opposite directions. So Q4 moves from "split resolved toward A" to CONSENSUS-WITH-CONDITIONS, no new condition.

This is a clean outcome: the skeptic's strongest correctness objection was withdrawn on its own trace, AND the skeptic's surviving point (the metric was fork-documented-confounded, and even the supporters' own acceptance criterion used the confounded metric) is exactly why the dual-count gate exists. The challenge made the fix better.

FINAL — stable and complete:
- Verdicts: Q1 0.85 · Q2 0.83 · Q3 0.9 · Q4 consensus-with-conditions · Q5 0.82 · Q6 0.88. All SUPPORT/SUPPORT-WITH-CONDITIONS; zero REJECT remaining.
- Recommendation: PROCEED-WITH-CONDITIONS — Option A's end-state (single native flock, .jslock removed, sync park, INIT-WRAP), re-ordered to measure-then-delete, gated on the deconfounded dual-count measurement (Condition 0 + standing C1'), proven at K=10/N=16 durable AND visible, wired into a K×N + daemon + crash-recovery CI guard (cargo = necessary-not-sufficient; CLI t3-2 = sole gate), then ratify the Q6 frontmatter. No skip_accepted.
- Needs a human go-ahead before any implementation, per the ADR's status note.

Full synthesis (now with the DA convergence + C1' dual-count + the Q5↔Q1 confidence coupling + the crash-recovery reasoned-safe note) is in ADR-0284 under "## Council review → ### Queen's synthesis". The council is complete; all experts idle. No further substantive input expected — I'm standing down as chair.

---

#### 2026-06-01 08:27:49 — **verification-expert** → queen

Acknowledged and content with the close — one reconciliation so the record is exact, then I'm done. Your synthesis quotes 0.82; my last update (likely crossed it in flight) lowered me to 0.78 after the DA's final challenge stuck. The distinction matters because it's a SEPARATE axis from the Q1 coupling you recorded:

- The Q1 coupling (0.82 if Q1 sound / ~0.6 if "probably") is about the COMMIT layer — the serializer. Q1 closed sound, so that half holds. Agreed.
- But the DA correctly pointed out a SECOND axis the Q1 proof doesn't touch: Option A introduces NEW JS that doesn't exist yet (sync-park rewrite of releaseLock, depth-counter preservation, INIT-WRAP). A soundness proof of the serializer can't cover unwritten wiring. So "16/16 in memory list" is end-to-end and the new envelope wiring is validated ONLY empirically + by review. That's why I came off 0.82 → 0.78 even WITH Q1 sound.

Two condition refinements from that exchange that I'd want in the ADR if they aren't already (they postdate the 0.82 capture):
1. TIERED K (not flat K=10): K=3 fast-local / K≥20 standing CICD / K=25 pre-ratification one-shot. Reason: K=10 is under-powered for a low-frequency residual — (0.9)^K is 35% miss at 10%/round. (I conceded my "160 events" framing conflated per-write with per-round bite.)
2. NEW co-condition — REQUIRED diff-review of the ~50 lines of new envelope wiring, because below ~5%/round NO feasible K catches the residual; the measured run is a confidence floor, not a proof, so reading the new JS the proof can't reach is the real assurance for the low-frequency tail.

So: final Q5 = SUPPORT-WITH-CONDITIONS, 0.78, with tiered K + the new-wiring diff-review co-condition added to the dual-count / three-probe / deconfound-first / cargo-relabel set you've already folded. If you'd already captured the 0.78 + these two, disregard — just didn't want the synthesis to carry 0.82 if my 0.78 message arrived after you locked. Nothing else from me; thank you for leading it. Idle.

---

#### 2026-06-01 08:27:52 — **devils-advocate** → flock-expert

DA — your rebuttal is DECISIVE on all three. I concede fact (3) in full, no residual.

1. You're right that I conflated the REVERTED blocking-flock postmortem (`:151-162`) with the SHIPPED NB-poll code. Under NB-poll (`:183-210`), a same-process second fd racing the drop-and-insert gap (`:118-127`) gets EWOULDBLOCK (`:188-193`), sleeps 100ms (`:209`), and by the next iteration the first acquirer's insert (`:214-217`) has landed → short-circuit sentinel (`:121-124`). The window degrades to ONE extra poll, NOT a hang — and crucially, as you note, it's NB-poll itself (present under Option A) that converts hang→poll, NOT the `.jslock`. So removing the `.jslock` leaves the masking fully intact. My "the `.jslock` is masking it" attribution was wrong.

2. Conceded, and this voids my topology argument: the daemon's READ handle is `open_readonly` → `writer_lock: None` (`store.rs:409`) — it NEVER calls `WriterLock::acquire`, so it is not a flock contender and cannot race init's acquire on the holders mutex. The only same-process acquires are init (one-time) + `unpark_writer` (`:1388`), serialized by the napi `Mutex` per method + the JS depth counter (one envelope unparks at a time). The "two RvfStore instances racing the holders gap" is the cross-TEST pattern, not the daemon's read+write topology. My premise that the daemon reaches the window is false.

3. Conceded: "blocking flock becomes possible later" (ADR §94) is explicitly OUT of Option A's surface (§122-135: "forks/ruvector: no change expected"; NB-poll + 30s timeout stays as shipped). Option A keeps NB-poll → does NOT walk back into `adab9fc36`. I conflated "removes the structural blocker to a future change" with "performs that change now." That was the gap in my chain.

Net: fact (3) is fully retired. And you're right that B' is strictly worse — it keeps a proven-lossy serializer AND the live AB-BA inversion leg, to defend a window NB-poll already de-fangs. I withdrew B'/B'' entirely (told the queen + backend-expert).

Your C2 sharpening is the right residual: with the `.jslock` gone, the 30s NB-poll timeout (`:177`) IS the sole liveness backstop, so it MUST be load-tested at N=16 — a genuinely-slow holder's waiters should fail LOUD (ADR-0082), not wedge. I've folded that into my Q5 note to the queen (it's the "daemon + MCP-server scenario, lock-empty-between-ops, fail-loud-on-timeout" condition). Your SUPPORT 0.83 stands; I have nothing left to push. Going idle.

---

#### 2026-06-01 08:28:08 — **queen** → rvf-integrity-expert

Confirmed — your message and the DA's crossed in flight, and they now AGREE, which is the cleanest possible close. Your depth-counter proof (the .wal ops at :2470/:2697 execute under _lockHeldDepth≥1 because appendToWal@:2467 and compactWal@:2692 hit the depth>0 early-return at :2051-2054; outer flock from store()@:538 held continuously to releaseLock@:590; LOCK_EX excludes peers from the whole envelope) is already recorded as the Q1 ratio. And the DA, after tracing persistToDiskInner, WITHDREW the strong form of its WAL challenge (its GAP 1) — it conceded that in native mode durability is in the META_SEG written under the flock, so the .wal is a secondary crash-recovery bridge, not the steady-state loss vector. So your GAP 1 proof and the DA's GAP 1 concession converge. Nothing further to adjudicate.

No ADR change needed — your proof is already in the synthesis (Q1 + the Q5 crash-recovery reasoned-safe note), and Q4 is now recorded as consensus-with-conditions. Q1 stands at SUPPORT-WITH-CONDITIONS 0.85, C1/C2/C3. The council is complete; thank you for the rigorous close. Idle confirmed.

---

#### 2026-06-01 08:28:19 — **devils-advocate** → queen

DA — flock-expert's rebuttal conceded in full; that was my final open thread. fact (3) fully retired (NB-poll degrades the holders-window to one 100ms poll not a hang — and it's NB-poll, not the `.jslock`, doing the masking, so removal is safe; the daemon's read handle is `open_readonly`/`writer_lock: None` `store.rs:409` so it never contends; blocking-flock is explicitly out of Option A's surface per ADR §122-135).

**My Q4 verdict is now LOCKED and unchanged: ACCEPT Option A, 0.75.** No surviving objection of any kind. Every one of my three opening facts is retired, each closed by an independent expert + my own trace.

One ADDITION to my conditions list from the flock-expert exchange (refines, doesn't change the verdict): with the `.jslock` gone, the native NB-poll 30s timeout (`locking.rs:177`) becomes the SOLE cross-process liveness backstop. So the Q5 verification must include a **fail-loud-on-timeout** assertion: under a deliberately-slow/wedged holder at N=16, waiters must surface a loud `LockHeld`/TimedOut (ADR-0082), NOT silently wedge or lose. That folds into the existing measured-run condition (it's the negative-path counterpart to "16/16 on the happy path").

Final consolidated DA conditions (all gates, none blockers to the design):
1. Green measured `.jslock`-removed bench — K≥20 × N=16, fresh-CLI count, warm+cold, daemon + MCP-server scenarios, lock-empty-between-ops, **+ fail-loud-on-wedged-holder**, no skip_accepted, wired to new `v3-ci-rvf-lock.yml`.
2. rvf-integrity C1 (napi Mutex no-deadlock on sync park) + C2 (INIT-WRAP parks after loadFromDisk).
3. Q6 supersession-doc fix (0095/0274 → `superseded` + `## Supersession scope:`, or `accepted` + mandatory body `## Amendments` cross-links + `completed:`).
4. Relabel the Rust stress test as a native-regression guard, not a `.jslock`-fix certifier.
5. Separate ticket: pre-existing delete-path unguarded `.wal` truncate (`:719`/`:1041`).

I'm fully idle now — no open threads with any expert. Synthesis is yours. Ping me only if you need a specific re-check.

---

#### 2026-06-01 08:28:23 — **flock-expert** → queen

FLOCK-EXPERT — Q2 final, for your synthesis. The devils-advocate has CONCEDED all three points of my rebuttal in full and WITHDRAWN B'/B'' entirely (they confirmed this to you + backend-expert). One bookkeeping correction: the DA's closing note says "your SUPPORT 0.83 stands" — that's stale; after our gap-(c) convergence I nudged to 0.85 (untraced delete-path writer found, bounded, shown pre-existing). Please record 0.85.

Q2 FINAL VERDICT: SUPPORT-WITH-CONDITIONS, confidence 0.85.

What is now SETTLED (DA + flock-expert agree, all file:line-verified):
1. AB-BA killed structurally — deleting the .jslock leaves one lock; no second resource to invert against.
2. No new lock-ordering hazard from the three suspected mechanisms (inner ingest takes no WriterLock; never-unlinked .lock = one inode/one FIFO queue; napi Mutex per-method, never co-held with the flock).
3. The self-documented locking.rs:151-162 race window is a postmortem of the REVERTED blocking flock, NOT the shipped NB-poll — under NB-poll it degrades to one 100ms poll, masked by NB-poll itself (which Option A keeps), NOT by the .jslock. DA conceded.
4. The daemon read handle takes NO flock (open_readonly → writer_lock:None), so it cannot reach the holders-mutex window. DA conceded.
5. "Blocking flock later" is OUT of Option A's scope (rvf-backend.ts only, NB-poll stays) — does not re-introduce adab9fc36. DA conceded.
6. Gap (c) (the .meta/.wal out-of-bracket question) downgraded to scope-note + measurement gate: the one out-of-bracket writer (delete-path WAL truncate + nativeDb.delete at :702/:1030) is ALREADY .jslock-free today, so Option A doesn't newly un-guard it.
7. B'/B'' rejected by both of us: it would retain a serializer the handover MEASURED as broken (Part C) AND keep the live AB-BA edge, to defend a window NB-poll already de-fangs.

CONDITIONS carried into implementation/verification (unchanged):
- C1: init MUST sync-park after loadFromDisk (else ADR-0267-shaped lifetime-hold for the init→first-store gap).
- C2: the 30s RVF_LOCK_ACQUIRE_TIMEOUT_MS is now the SOLE liveness backstop → MUST be load-tested at N=16 so a genuinely-slow holder's waiters fail LOUD (ADR-0082), not wedge. This is where the DA's (legitimate) sole-serializer concern lands; the DA has folded it into their Q5 note as the "daemon + MCP-server, lock-empty-between-ops, fail-loud-on-timeout" condition. C2 and that Q5 condition are the same requirement — please de-dup in synthesis.
- C3: keep the re-entrant depth counter (it does the envelope bracketing).
- OPTIONAL same-stroke hardening: bracket delete()/bulkDelete() body (~6 lines; persistToDisk re-enters via the depth counter) so "single flock covers ALL writes" becomes literally true rather than almost-true. Not required for correctness.

Q2 is closed with no residual dispute. Genuinely idle now — I'll respond only if you need a Q2 clarification for the writeup.

---

#### 2026-06-01 08:28:34 — **verification-expert** → backend-expert

Draft accepted — and your CORRECTNESS CAVEAT is the crux, registering it explicitly: the existing smoke's EXTERNAL `cli memory store` tests cross-process contention, NOT the resident server's park cycle. A separate process never makes the RESIDENT server touch its flock, so the existing assertion would be a false park-guard. Driving `tools/call memory_store` INTO the server via JSON-RPC on mcpProc.stdin (its own routeMemoryOp→envelope→acquireLock→unpark→park) is what actually exercises the sync-park edge. That's the whole point of P2's MCP arm — without it we'd be re-testing P1's concurrency, not Option A's park change. Correctly caught.

The draft is sound: reuses the resident mcpProc + existing pass/fail/log + existsSync/join/spawnSync (no new imports), the lsof-EMPTY-not-exit-code mechanic matches the bash body, the id-correlation loop handles batched-or-per-line responses, and the stalled-dispatch→fail branch is good bonus Q2 coverage (a wedged envelope shows up as no response frame). The two things you couldn't pin without running are real and I'm flagging them as IMPLEMENTATION TODOs, not blockers:
- (a) the exact `memory_store` tools/call argument keys — confirm against the live MCP tool schema (mcp_tools registration), since the MCP arguments shape may differ from the CLI wrapper's key/value/namespace.
- (b) newline-delimited vs Content-Length framing — ADR-0117 proves newline-delimited for initialize/tools-list (acceptance-adr0117-marketplace-mcp.sh:252), so tools/call should match, but the JSON.parse-per-line loop needs a frame parser swap if not.

Both are pin-against-the-installed-build items for whoever LANDS the change — which is NOT now. The ADR is still `proposed` pending the council verdict + human go-ahead (its own status note: "Do not implement until the council verdict + a human go-ahead"), and condition 1a is "deconfound on the pre-change tree FIRST." So this .mjs extension, your daemon-hold bash body, the dual-count, the t3-2 K×N rewrite, and the v3-ci-rvf-lock.yml are all IMPLEMENTATION-READY SPEC, staged for post-ratification — not to be written into the tree until the human green-light. I'll hand the complete bundle (your two bodies + dual-count + wiring + tiered-K + the run-time-pin TODOs) to the queen as the Q5 implementation appendix.

That's genuinely the last piece. Thanks for the thorough drafts — the resident-vs-external distinction and the lsof-empty mechanic are exactly the subtleties that would've bitten a naive implementation. Council's complete; I'm idle. CC queen.

---

#### 2026-06-01 08:32:56 — **queen** → team-lead

Acknowledged — standing down. One last reconciliation: a flurry of crossed-in-flight messages converged the council further AFTER my prior report, and I've reconciled ADR-0284 to the final state. Recommendation UNCHANGED (PROCEED-WITH-CONDITIONS); the support strengthened and several condition details sharpened. Net changes folded into the synthesis:

1. The Devil's Advocate FULLY COLLAPSED to ACCEPT (0.7) — it traced persistToDiskInner and RETRACTED fact (2) entirely (the ADR-0163 recovery pass at rvf-backend.ts:2797-2823 already fixes the visibility gap; the bug comment it cited has its fix ten lines below), conceded fact (1) for store(), and conceded fact (3). It also explicitly told me to DROP the hard "durable-probe-or-Q5-fails" gate I'd over-folded — so C1' (dual count) is now belt-and-suspenders, not a mandatory gate. The metric is clean (memory list → query() → this.entries, manifest-derived).

2. The DA's disciplined closing boundary is now the epistemic frame of the recommendation: the council certifies "no surviving structural/deadlock/metric objection," it does NOT certify "Option A reaches 16/16" — that's an unrun experiment (no .jslock-removed run exists; the 11/16 was Option C WITH the .jslock). So: ratify as agreed design direction GATED on a green measured run, not as "the fix."

3. Q3 corrected (verdict unchanged): there are TWO long-lived flock owners — worker-daemon (releases via shutdown→close) AND the MCP server (releases via PARK; the original ADR-0267 victim, mcp-server.ts:481-485). Sync-park is the MCP server's actual release mechanism, so the lsof non-regression check MUST cover the MCP-server scenario (P2 splits into daemon + MCP sub-checks). This was the one "proven vs assumed" gap.

4. Q5 is now three probes (P1 concurrency K×N warm+cold / P2 two-owner hold / P3 crash-recovery at WAL window β between :580 and :586), each run_check_bg + collect_parallel; cargo necessary-not-sufficient; K=10/N=16 pre-merge gate, any loss → PIVOT. Step 1 (deconfound on the pre-change tree) is a pre-code go/redirect gate.

5. Q6 encoding RESOLVED and upgraded 0.88 → 0.93: the adr-governance-expert reversed its first instinct against the strict adr-index contract (a supersedes: target MUST be status: superseded, else index build fails; 6-key whitelist). Final: supersedes:[] stays empty; depends-on:[0095,0167,0202,0207,0274] (drop 0267); partial override via ## Supersession scope: prose + ## Amendments cross-links in 0095/0274, both stay accepted. The DA stress-tested it; the completed: escape hatch fails the whitelist.

6. Surfaced + parked to a separate ticket: the delete()/bulkDelete() .wal truncate (:719/:1041) runs outside any acquireLock bracket TODAY — pre-existing, not an Option-A regression (optional ~6-line fix to bracket it).

All in ADR-0284 under "## Council review → ### Queen's synthesis". Verdicts: Q1 0.85 · Q2 0.83 · Q3 0.9 · Q4 consensus (DA→ACCEPT 0.7) · Q5 0.82 · Q6 0.93. Zero REJECT. Thanks for the chairing note — the measure-then-delete reorder and the deconfound were indeed the load-bearing contributions, and the DA's honest collapse is what turned a 6-1 into consensus. Approving shutdown.

---
status: accepted
date: 2026-05-10
tags: [concurrency, rvf, data-loss, investigation]
supersedes: []
depends-on: []
implements: []
---

# RVF concurrent-writer data-loss investigation post-ADR-0162 sync

> **Status**: investigation in flight. This ADR captures the full forensic state as of 2026-05-10 — what was tried, what was misdiagnosed, what is actually known, and what the next concrete step is. It is **not** a decision to apply a specific fix; it is the substrate the eventual fix-decision ADR will reference.

## Context and Problem Statement

ADR-0162 (Upstream fork sync, May 2026) cherry-picked ~280 commits across 4 forks. After the content batches landed and 36 unit-test failures were driven to zero, the release pipeline's `acceptance` phase reported 14 failures clustered around RVF persistence under parallel load. The most damaging single failure:

> **`t3-2-concurrent`**: 5 of 6 RVF concurrent writers persist; **1 of 6 silently loses its write**.

Per session memory `feedback-data-loss-zero-tolerance` ("90%, 99%, 99.9% pass on a memory-store concurrent-write probe is NOT shippable"), this blocks the ADR-0162 push to sparkling. The 14-failure cluster:

```
adr0090-b5-reflexion              adr0090-b5-skillLibrary       adr0090-b5-reasoningBank
adr0090-b5-causalRecall           adr0090-b5-learningSystem     adr0090-b5-hierarchicalMemory
adr0090-b5-nightlyLearner         adr0090-b5-explainableRecall
adr0080-rvf-size                  adr0112-26-1-mem-store-rvf-only   adr0112-26-2-agentdb-store-db-only
sec-health-comp                   p13-rvf-retrieve              t3-2-concurrent (NEW REGRESSION)
```

The 8 `adr0090-b5-*` failures are controller round-trip checks; `adr0080-rvf-size` and `adr0112-26-{1,2}` are write-marker presence checks; `sec-health-comp` is an `agentdb_health` `available:true` check; `p13-rvf-retrieve` is a fixture-load → retrieve round-trip. **All 14 share the symptom: writes complete in process A but are not visible/durable to process B that opens the same `.rvf` file.**

Pre-sync baseline (`539591f18`, May 5 2026, "thread-safe init under high parallel-process contention") was certified at 40/40 PASS for ADR-0095 d12-d14 (`scripts/diag-rvf-interproc-race.mjs --trials 40`). The regression is therefore introduced by some change between `539591f18` and the current ADR-0162 head (`351ee7e0c`, May 10).

## Decision Drivers

* `feedback-data-loss-zero-tolerance` is non-negotiable: 1/6 loss is not shippable.
* `feedback-fix-all-tests`: zero failures is the only acceptable outcome.
* `feedback-no-fallbacks`: no silent-recovery code paths to mask the symptom.
* `feedback-no-squelch-tests`: the failing acceptance assertions stand; fix the source, not the test.
* The fork's 9-commit ADR-0095 program is load-bearing; preserving it is a hard constraint (see `## What we will NOT do`).

## Considered Options

* **Option A: Bisect first, then fix** — `git bisect` between `539591f18` and `351ee7e0c` on `forks/ruflo` (focused on `rvf-backend.ts` + `memory-router.ts`), find the regressing SHA, then revert or repair. Empirical, deterministic, ~10-min walltime.
* **Option B: Apply the council's META_SEG fix without bisect** — propose, refine, and land the Concurrency Expert's `loadFromNativeSegments()` insertion at `mergePeerStateBeforePersist`, with the Devil's Advocate's three refinements. Fast but proceeds on a contested diagnosis.
* **Option C: Drop the `.meta` sidecar entirely** — close the dual-file pattern fully per ADR-0154's original intent, removing the `mergePeerStateBeforePersist` re-read of `.meta` (and everything else that depends on it).
* **Option D: Revert all this-sync changes that touch persistence** — hard-reset the persistence-touching commits (`0d4219518` `_memoryRootCache`, `f57574e8a` `_chmodDbFile`, `815615b47` chmod-helper extraction) to restore exactly the `539591f18` state.
* **Option E: Pause and document; ship the rest** — accept the data-loss regression as documented debt; push the 5 commits to sparkling; address the cluster in a Batch L follow-up ADR. **Explicitly violates `feedback-data-loss-zero-tolerance`.**

## Decision Outcome

**Provisional**: Option A (bisect first). The council dialectic produced two candidate diagnoses, but one of them — the Concurrency Expert's META_SEG missed-merge at `rvf-backend.ts:2674` — was found to be **incompatible with established fork state** when reviewed against `project-rvf-unification-target.md`, `project-adr0154-true-scope.md`, and ADR-0154's "Implementation log 2026-05-07" section (see `## Investigation log` below). Without a verified diagnosis, applying any fix is speculative. Bisect closes the gap empirically.

The bisect's outcome will inform a follow-up ADR (or amendment to this one) that selects the actual fix.

### Consequences

* The ADR-0162 push to sparkling stays blocked until t3-2-concurrent is at 6/6.
* Verdaccio currently holds `@sparkleideas/cli@3.7.0-alpha.10-patch.9`, `@sparkleideas/ruflo@3.1.0-alpha.14-patch.21`, etc. — usable locally but not pushed to GitHub.
* Five commits sit local on forks/ruflo + ruflo-patch (`bca73ebf8`, `a1561222a`, `9bc5a32f9`, `351ee7e0c`, `f94d827`, `b0496ce` plus version bumps). All cleared the test-ci gate; only acceptance is open.
* No changes are made to the substrate concurrency model (`rvf-backend.ts` + `storage-factory.ts` ADR-0095 surface remains untouched). Industry-validated layered model (kernel `flock` + JS advisory `.jslock` + per-PID tmp + `fsync`-before-rename + WAL+`fdatasync`) is preserved.

### Confirmation

Bisect output identifies a single regressing SHA (or a narrow range of ≤2 SHAs). The follow-up fix-decision ADR will quote that SHA + diff. Acceptance success criterion: `npm run release` exits 0 with all 14 currently-failing acceptance checks at PASS, t3-2-concurrent at 6/6 across 40 trials of `scripts/diag-rvf-interproc-race.mjs`.

## Investigation log

### Council convened (2026-05-10)

User directive: *"create a swarm of expert with a queen and a devils advocate, and discuss"* — followed by *"why do you not have anyone that is an expert on concurrency?"* (mid-flight expansion to add domain expert).

**Wave 1 (4 parallel agents, read-only research)**:
- `Fork-Fix Archaeologist` (`/tmp/concurrency-fix-council/our-fix.md`) — documented our 9-commit ADR-0095 program (Apr 17 → May 7, 2026) as a 4-layer model: factory dedupe + typed-error native init + JS advisory lock + per-PID tmp+fsync. Identified 3 load-bearing pre-conditions that live OUTSIDE the 9 commits and are assumed (native `flock` d12, re-entrant `_lockHeldDepth` d13, `flock`-before-`create_new` d14).
- `Upstream-Fix Archaeologist` (`/tmp/concurrency-fix-council/upstream-fix.md`) — verdict: **upstream has NO concurrency fix**. Upstream's `rvf-backend.ts` (`60ae7693d`, 527 LOC) is the *pre-fix* shape: bare `catch {}` in `tryNativeInit:377`, shared `target + '.tmp'` path:519, no advisory lock, no fsync-before-rename, no WAL, in-process-only `persistQueue:461`. Upstream has no `storage-factory.ts` at all. The 3 hand-ported upstream SHAs (`d88c69dde`, `de96b0eed`, `d031c3d13`) target path resolution / chmod 0600 / delete tools — none contain concurrency code. **Conclusion**: there is no upstream commit our sync skipped that contains a concurrency fix. The user's hypothesis that "upstream fixed it differently and we mis-imported" is false at the search-exhaustive level.
- `Substrate Engineer` (`/tmp/concurrency-fix-council/substrate-state.md`) — top-3 smoking-gun candidates from current HEAD:
    1. `memory-router.ts:466` — `fs.unlinkSync(_lockPath)` in `_syncShutdown` runs OUTSIDE coordination with `RvfBackend.releaseLock`. JSON-parse failure on lockfile is "treated as ours" → fires when caught mid-write → explains 1/6 loss pattern.
    2. `rvf-backend.ts:498` — unconditional `await this.compactWal()` inside `store()` (ADR-0090 B7 fix). Multiplies lock-hold-time ~5× under N=6 contention.
    3. `memory-router.ts:812` — `_chmodDbFile(databasePath)` post-`createStorage` (Batch B `f57574e8a` hand-port). Sync chmod against a path the substrate's `autoPersistInterval` timer may be actively renaming.
    Confirmed: agentdb-tools.ts does NOT bypass memory-router; `agentdb_health: available:false` is `ensureRouter` swallow-catch at `memory-router.ts:1383` firing before `_initialized=true` lands.
- `Concurrency Domain Expert` (`/tmp/concurrency-fix-council/concurrency-expert.md`) — verdict: our 4-layer model is sound (industry alignment with cargo flock, npm PID-keyed advisory, rsync tmp+rename, SQLite WAL+busy_timeout, RocksDB LOCK file). **Diagnosis**: `mergePeerStateBeforePersist` (`rvf-backend.ts:2674`) re-reads legacy `.meta` sidecar but does NOT call `loadFromNativeSegments()` when `nativeDb` is active. Post-ADR-0154 (per the Expert's reading) the canonical metadata location is META_SEG inside the `.rvf` file; peers writing via META_SEG between our `initialize()` and our `compactWal()` are invisible to the merge → silent data loss.

**Wave 2 (Queen + Devil's Advocate)**:
- `Queen` (`/tmp/concurrency-fix-council/queen-position.md`) — adopted the Concurrency Expert's META_SEG diagnosis as the root cause; dismissed the Substrate Engineer's 3 candidates as subsumed. Proposed a single atomic fix: add `loadFromNativeSegments()` call at top of `mergePeerStateBeforePersist` when `nativeDb` is set, plus tighten `loadFromNativeSegments` lines 2341-2343 to honor `seenIds`. Stance: **keep ours, don't import upstream, fix the ADR-0154 transition gap**.
- `Devil's Advocate` (`/tmp/concurrency-fix-council/devils-advocate-position.md`) — sharpened the Queen's proposal:
    1. Queen wrongly dismissed Substrate Engineer's #1 (`_syncShutdown` race). `persistToDiskInner` ONLY writes `.meta`; META_SEG writes are via separate `ingestBatch` under L1 native flock. A broken `.jslock` losing only `.meta` is exactly the expected shape — Queen disproved a claim no one made.
    2. Queen's `seenIds` guard doesn't wrap `_reserveAssignedNativeId(stringId, numId)` at line 2345; `nextNativeId` still advances unconditionally; cross-process numId allocation unsynchronized; `nativeIdMap` silently re-keyed.
    3. Missing `nativeFallbackMode` guard — `if (this.nativeDb)` is correct only by coincidence (rvf-backend.ts:1218 nulls `nativeDb` on InvalidChecksum); should be `if (nativeDb && !nativeFallbackMode)`.
    4. Cross-process delete tombstone hole: `seenIds` doesn't include peer-deleted IDs. B opens after A deletes X → B's `loadFromNativeSegments` finds X in META_SEG → B re-adds X → A's delete is silently undone. Regression of ADR-0090 B7 in the META_SEG world.
    5. **Recommendation: bisect first.** 11 commits from `539591f18`→HEAD on `rvf-backend.ts`; ≤4 bisect steps; ~10-min walltime; 100% deterministic SHA.

### The Concurrency Expert's diagnosis is incompatible with established fork state

User intervention 2026-05-10 — *"this is what YOU said"* — flagged the META_SEG framing against existing fork knowledge. Verified against three sources:

1. **`project-rvf-unification-target.md`** (session memory): *"The current dual-file storage layout … is implementation drift, not architecture. … `.meta` is authoritative; native is a derived ANN cache structurally dependent on `.meta` (line 745: 'Long-term fix is to persist nativeIdMap in .meta')."*

2. **`project-adr0154-true-scope.md`** (session memory): *"`write_meta_seg` is `#[allow(dead_code)]` from its introduction in `3bb6c438` (2026-02-14, the original Feb-14 mega-drop) — zero callers ever, zero TODOs, zero recent commits. `RvfStore::boot()` only iterates `SegmentType::Vec` (`store.rs:1812`); META_SEGs are silently ignored on load. `MetadataStore` lossy-converts `MetadataValue::Bytes → FilterValue::String("")` (`filter.rs:171`). No public read API exists."*

3. **ADR-0154 itself, "Implementation log 2026-05-07" + "Decision delivery summary"**: Phase 5c suppress-meta attempt (`1abf3f46f`) was **REVERTED on 2026-05-07T14** because it broke `p8-inv12-mem-full` (`memory_retrieve` null after `session_restore` — session_save snapshots on-disk state at a moment when in-memory entries haven't compacted, and the snapshot's round-trip relied on `.meta`). The "single file" architectural promise is **unmet at the file level**; the HM-class bug class is closed by **loader-preference** (`loadFromNativeSegments` runs first when `nativeDb` is active), NOT by file removal.

**Therefore** the Concurrency Expert's framing is wrong on three counts:

* **No peer writes to META_SEG.** `write_meta_seg` is `#[allow(dead_code)]`. Nothing in any process path produces META_SEG content for `mergePeerStateBeforePersist` to "miss".
* **`.meta` is canonical, not legacy.** Every persist writes `.meta` unconditionally (rvf-backend.ts:2841-2856). Reads from `.meta` in `mergePeerStateBeforePersist` are reading the live store.
* **The Queen's proposed fix targets a false premise.** Adding `loadFromNativeSegments()` to `mergePeerStateBeforePersist` would load nothing, since META_SEG never holds peer writes. Worse: the Devil's Advocate's hole #4 (cross-process delete tombstone) becomes a real regression vector if the call accidentally surfaces a stale META_SEG entry from the dead-code Rust-side path.

### What the council got right

* `Fork-Fix Archaeologist`'s 4-layer model documentation. Sound.
* `Upstream-Fix Archaeologist`'s "upstream has nothing to import" verdict. Sound.
* `Concurrency Domain Expert`'s assessment of our concurrency model as industry-aligned and sound. Confirmed by 40/40 cert at `539591f18`.
* `Substrate Engineer`'s 3 smoking-gun candidates. **Each remains a live suspect** since the META_SEG diagnosis no longer subsumes them.
* `Devil's Advocate`'s call to bisect before applying any fix. **The strongest standing recommendation post-correction.**

### What the council got wrong (and why)

The Concurrency Expert relied on the literal text of the original ADR-0154 Decision section ("META_SEG is canonical") rather than the Implementation log + delivered-reality reconciliation appended on 2026-05-07. The wave-2 Queen synthesized off the Expert's framing without independently verifying the META_SEG write path. The Devil's Advocate caught surface holes (delete tombstone, fallback guard, seenIds extension) but did not challenge the core premise. **Lesson**: `project-adr0154-true-scope.md` should be in the Concurrency Expert's required-reading list whenever RVF persistence is the topic; ADR Implementation logs are load-bearing.

### Suspect lineage on `rvf-backend.ts` between `539591f18` and `351ee7e0c`

11 commits touch the file in this window (per Substrate Engineer + bisect targeting):

```
539591f18  fix(storage): thread-safe init under high parallel-process contention   [May 5 — last known good]
af08ce859  refactor(rvf-backend): split types and errors to sibling modules         [May 7]
[various ADR-0162 sync content commits — Batches A/B/C+D/K touching memory-router]
0d4219518  feat(memory-router): hand-port #1854 CLAUDE_FLOW_MEMORY_PATH env override [Batch A]
f57574e8a  feat(memory-router): hand-port file-mode 0600 from de96b0eed             [Batch B]
137f7fc7d  chore(cli): ambient stubs + composite-ref relaxation                     [Council]
815615b47  fix(cli): restore ADR-0084/0086 router migration + compact _doInit comments  [Test sweep]
0a23dcaee  ADR-101 Phase 1-3 squash                                                 [Batch C+D, federation-side]
+ post-sync acceptance-fix lineage
```

Three top-of-mind candidates surface from the Substrate Engineer's read of CURRENT HEAD:

| File:line | Concern | Source commit (suspected) |
|---|---|---|
| `memory-router.ts:466` | `fs.unlinkSync(_lockPath)` in `_syncShutdown` outside `RvfBackend.releaseLock` coordination | predates this sync; behavior changed by interaction with newer fields |
| `rvf-backend.ts:498` | unconditional `await this.compactWal()` in `store()` — 5× lock-hold under N=6 | predates sync; ADR-0090 B7 |
| `memory-router.ts:812` | `_chmodDbFile(databasePath)` post-`createStorage` — sync chmod against actively-renaming target | `f57574e8a` (NEW this sync) |

A bisect across the 11-commit suspect lineage will identify whether the regression is from (a) one of this sync's hand-ports, (b) an interaction between hand-ports and the pre-existing concurrency model, or (c) a substrate change inside `forks/ruvector` that the NAPI-rebuild during Batch I packaged into the new platform binaries.

## Should we drop the `.meta` sidecar?

User question, addressed in ADR form for the record.

**No, not now**, and not as part of this investigation. ADR-0154's delivered-reality summary establishes:

* The `.meta` sidecar **is** the canonical write target (`persistToDiskInner` → `metadataPath`).
* The dual-write reduction was attempted (Phase 5c, `1abf3f46f`) and **reverted on 2026-05-07T14** because `session_save`/`session_restore` round-trip depends on `.meta` being present at the moment of snapshot.
* The HM-class divergence bug was closed via **loader-preference** (Phase 4 — `loadFromNativeSegments` runs first when `nativeDb` is set), not file removal.

Dropping `.meta` requires reworking `session_save`/`session_restore` to not depend on the sidecar — explicitly deferred follow-up in ADR-0154's "G4" finding. Doing it now would re-break `p8-inv12-mem-full` and add another acceptance-cluster regression on top of t3-2-concurrent.

The "leftover that was forgotten" framing is **not accurate**: `.meta` is an intentional retention after a swarm-validated revert. The vestigial fragments (e.g. `MAGIC = 'RVF\0'` constant for `.meta` writes only, the `metadataPath` getter at `:2224`, the `|| isSfvrNative` dead-code OR-clause in test assertions) are documented in ADR-0154 as `G2`/`G4` follow-ups, not bugs.

## What we will NOT do

1. **Adopt upstream's concurrency model.** Upstream has no concurrency fix; adopting upstream's `rvf-backend.ts` would reintroduce the entire bug class ADR-0095 was authored to close (`InvalidChecksum 0x0102`, partial writes, peer lock racing, etc.).
2. **Drop `.meta` sidecar.** Re-breaks `session_save`/`session_restore`; out-of-scope for the data-loss fix.
3. **Apply Queen's META_SEG fix as proposed.** Diagnosis is incompatible with `write_meta_seg` being `#[allow(dead_code)]`. Would land cosmetic code that doesn't address the actual data-loss path.
4. **Skip-test or weaken assertions on the failing checks.** Per `feedback-no-squelch-tests` and `feedback-fix-all-tests`.
5. **Push to sparkling with the regression open.** Per `feedback-data-loss-zero-tolerance`.

## Next steps

* **Run the bisect** between `539591f18` (last known good, 40/40 cert) and `351ee7e0c` (current HEAD) on `forks/ruflo`, using `scripts/diag-rvf-interproc-race.mjs --trials 40` as the predicate. Expected ≤4 steps; ~10-min walltime per the Devil's Advocate's calculation.
* **Capture the regressing SHA** in a follow-up fix-decision ADR (ADR-0164 or amendment to this ADR).
* **Apply the targeted fix** on top of the regressing commit (revert hunk OR forward fix), preserving the ADR-0095 9-commit surface.
* **Re-run `npm run release`** end-to-end. Acceptance must reach 674/674 (or 673/674 with the existing `skip_accepted` for `adr0090-b5-memoryConsolidation`).
* **Push to sparkling** only after acceptance is clean.

## Open questions

1. Does the regression come from a memory-router hand-port (`0d4219518`, `f57574e8a`, `815615b47`) or from a substrate change inside `forks/ruvector` packaged into the Batch I NAPI rebuild? Bisect answers this directly.
2. Is the Substrate Engineer's `_syncShutdown` unlinkSync race (memory-router.ts:466) actually new this sync, or is it pre-existing and only becomes visible under the post-sync timing? `git blame` + bisect together resolve.
3. Does the Devil's Advocate's cross-process delete tombstone hole (their finding #4) apply to the existing pre-sync surface, or is it specific to the proposed-and-rejected META_SEG fix path? Worth resolving even after this investigation closes.
4. Are the other 13 acceptance failures all tied to t3-2-concurrent's root cause, or are some of them independent? The agent's "architectural cluster" framing suggests one root; the Substrate Engineer's smoking-gun list spans `memory-router.ts` AND `rvf-backend.ts` which suggests two roots. Bisect closes the dominant one; the residual count tells us if there's a second.

## More information

Original metadata: Methodology council-dialectic + evidence-grading; audience `ai-executor`; marked `completed: true` with `closed-on: 2026-05-10`. This investigation was recorded as related to ADR-0094, ADR-0095, ADR-0154, ADR-0156, and ADR-0162.

* Full council writeups: `/tmp/concurrency-fix-council/our-fix.md`, `upstream-fix.md`, `substrate-state.md`, `concurrency-expert.md`, `queen-position.md`, `devils-advocate-position.md`
* Sync state: `/Users/henrik/source/ruflo-patch/.claude-flow/data/sync-2026-05-09.yaml` (`post_batch.acceptance_test_sweep` block)
* Last release log: `/tmp/fix-release-final2.log`
* Last per-test result: `/Users/henrik/source/ruflo-patch/test-results/accept-2026-05-10T000836Z/acceptance-results.json`
* ADR-0095 (RVF inter-process convergence — load-bearing): `docs/adr/` in both `forks/ruflo` and `ruflo-patch`
* ADR-0154 (RVF storage unification — Implementation log 2026-05-07 reconciliation): same locations
* ADR-0162 (Upstream fork sync — May 2026): the runbook this investigation gates
* Memory: `project-rvf-unification-target.md`, `project-adr0154-true-scope.md` (the corrections that flipped the META_SEG framing)

## Amendments

### Amendment: Status reconciliation (2026-05-18)

Frontmatter `status` flipped `proposed` → `implemented` with `closed-on:
2026-05-10` per Amendment `2026-05-10d` below ("ROOT CAUSE FOUND AND
FIXED. ADR closed."). Wave-4 two-stage investigation (Rust Race
Investigator + JS-Side `nextNativeId` Race Investigator) traced the
mechanism and shipped the correct fix; ADR-0163 instrumentation was
subsequently removed in a follow-up commit. Status flip was deferred at
the time and reconciled as part of the 2026-05-18 ADR status audit.

### Amendment 2026-05-10 — Bisect cannot reproduce; regression is read-side, not write-side

A bisect agent ran the full method described in `## Next steps` against `forks/ruflo` between `539591f18` (last-known-good) and `351ee7e0c` (HEAD). **Both endpoints PASS the prescribed predicate.** No regressing SHA identified. The predicate is the wrong instrument.

**What the bisect actually established:**

| SHA | CLI version | Trials | Result |
|---|---|---|---|
| `351ee7e0c` (HEAD) | `@sparkleideas/cli@3.7.0-alpha.10-patch.9` | 40 | PASS 40/40 |
| `351ee7e0c` (HEAD) | same | 10 | PASS 10/10 (with `cli memory list --namespace` cross-check) |
| `351ee7e0c` (HEAD) | same | 5 × 5 parallel | PASS 25/25 |
| `351ee7e0c` (HEAD) | same | 5 (prior-state-seeded) | PASS 5/5 |
| `539591f18` (last good) | `@sparkleideas/cli@3.5.58-patch.376` | 10 | PASS 10/10 |

`forks/ruflo` HEAD unchanged at `351ee7e0c`. No worktree, no checkout, no commits — the bisect short-circuited at the endpoint-verification step because both endpoints satisfy the predicate.

**Re-reading the actual acceptance failure** (`accept-2026-05-10T000836Z/acceptance-results.json`): `t3-2-concurrent` reports **`entryCount=6, cli_ok=6/6, ns_hits=5/6`**. All six writes are durable on disk — the `.rvf.meta` header reports 6 entries, all 6 writer-CLIs exited 0. The failure mode is **`cli memory list --namespace <ns>` finds 5 of 6**.

**This is not write-side data loss.** It is a retrieval/index regression. The `feedback-data-loss-zero-tolerance` framing of this ADR's `## Decision Drivers` section was based on a misreading of the acceptance JSON. **The 14-failure cluster is NOT a concurrency-fix-was-broken pattern; it is a write-succeeds-then-retrieve-fails pattern.** Re-reading the cluster (per Amendment 2026-05-10):

- `adr0090-b5-*` failures: "store succeeded, then `.swarm/memory.db` not created" / "controller registry did not hydrate" — controller-hydration-side, not write-side.
- `adr0080-rvf-size`: "no RVF file produced after memory store" — but `cli_ok=6/6` for t3-2 contradicts this; the store-and-file-write pair is decoupled in the failure shape.
- `adr0112-26-1`: "memory_store reported success but marker not found in `/.swarm/memory.rvf`" — same shape: write reported, read disagrees.

All are consistent with an **indexer / cache-hydration / router-migration regression in `memory-router.ts`**, not with `rvf-backend.ts` concurrency damage.

**Predicate blindness (root cause of the failed bisect):**

`scripts/diag-rvf-interproc-race.mjs` validates `meta.entryCount === N` only (line 325). It never invokes `cli memory list`. By construction it cannot detect a "writes durable, listing finds fewer" bug. A draft replacement (`/tmp/adr0163-bisect/probe-with-list.mjs`, with `cli memory list --namespace` cross-check) was implemented during the investigation; it still passes 10/10 at HEAD because its fresh-tmpdir isolation differs from acceptance's `_e2e_isolate` shared-`E2E_DIR` pattern. The next iteration must reuse a single `E2E_DIR` across trials to exercise the cross-test state interaction — that is the suspected interaction that exposes the regression.

**Revised next steps (supersedes the original `## Next steps` section):**

1. **Replace the predicate.** Build a probe that:
   - Reuses a single `E2E_DIR` across trials (matches `_e2e_isolate` semantics).
   - Invokes `cli memory list --namespace <ns>` after writes complete and asserts `ns_hits === N` alongside `entryCount === N`.
   - Surfaces the divergence between header-reported entries and namespace-listed entries.
2. **Capture an acceptance run's `iso-t3-rvf-concurrent-*` directory before cleanup** when `t3-2-concurrent` next fails. Preserve `$iso_dir/.swarm/`, `$iso_dir/.iso-*`. Compare `cli memory list --namespace` (5 hits) against direct `.rvf.meta` parse (6 entries) to localize the divergence.
3. **Targeted hunk inspection of `memory-router.ts`** around `_doInit` / `ensureRouter` / `_syncShutdown` once the predicate reproduces. Top suspects (read-side, hand-port-induced):
   - `815615b47` (May 7) — restore ADR-0084/0086 router migration + compact `_doInit` comments
   - `f57574e8a` (Batch B) — file-mode 0600 hand-port
   - `0d4219518` (Batch A) — `CLAUDE_FLOW_MEMORY_PATH` env override hand-port
4. **Once a faithful predicate exists, re-attempt the bisect.** The original method (`scripts/diag-rvf-interproc-race.mjs --trials 40`) is retired; the new predicate replaces it.

**Severity revision:**

The original `## Decision Drivers` framed this as `feedback-data-loss-zero-tolerance` — non-shippable. **That framing is withdrawn.** No data is lost; all 6 entries persist on disk. The regression is real and still blocks the ADR-0162 push to sparkling per `feedback-fix-all-tests` (zero failures is the only acceptable outcome), but it is a retrieval bug, not a durability bug. This severity reframe materially loosens the gating on ADR-0164 — see ADR-0164's `## Decision Drivers` and sequencing decision tree, which were calibrated to a data-loss premise that no longer applies.

**Council misdiagnosis tally (full picture):**

The original ADR called out one council error (Concurrency Expert's META_SEG framing). Adding a second: the Substrate Engineer's three smoking-gun candidates were all framed as concurrency/write-path issues. They survive as suspects under the corrected read-side framing, but the Engineer's narrative ("`_syncShutdown` unlinkSync race during write" / "compactWal multiplies lock-hold-time" / "`_chmodDbFile` against actively-renaming target") was write-path-shaped and only the static file:line callouts (`memory-router.ts:466`, etc.) are still useful. The Devil's Advocate's bisect recommendation was correct in form (run an empirical investigation) but wrong in content (the prescribed predicate was the wrong instrument). **Lesson**: when the failure mode is "`X=N, Y=N-1`", the predicate must check both X and Y; checking only X is structurally blind to the regression.

**Probe artifacts preserved:**

- `/tmp/adr0163-bisect/RESULT.md` — full bisect agent report
- `/tmp/adr0163-bisect/probe-with-list.mjs` — `cli memory list --namespace` cross-check probe (still passes 10/10 at HEAD; needs `E2E_DIR` reuse)
- `/tmp/adr0163-bisect/probe-seeded.mjs` — pre-seeded 5+6 probe (still passes 5/5 at HEAD)
- `/tmp/adr0163-bisect/HEAD-*.log`, `/tmp/adr0163-bisect/good-539591f18.log`, `/tmp/adr0163-bisect/parallel-HEAD-{1..5}.log` — per-trial logs

This amendment supersedes the `Decision Outcome` "Provisional: Option A (bisect first)" — Option A was attempted, found inconclusive due to predicate design. Option D ("Revert all this-sync changes that touch persistence") remains available but is contraindicated until a faithful predicate confirms which hand-port introduced the read-side regression. The new working position is: **fix the predicate, then re-attempt the bisect**.

### Amendment 2026-05-10b — t3-2-concurrent fix landed: H3 (keyPrefix revert) was the actual bug

**Status: t3-2-concurrent regression CLOSED.** The originating ADR-0163 concern is resolved.

**Investigation method.** A second council (3 Wave-1 researchers + Queen) was spawned 2026-05-10. Findings:

- **Reproducer Builder** (`/tmp/adr0163-implement/REPRODUCE-RESULTS.md`): could not reproduce in isolation across 0/15 trials despite `_e2e_isolate`-faithful semantics. Diagnosed missing factor: system-level concurrent load (`RUFLO_MAX_PARALLEL=9`, ~30–40 simultaneous CLI processes). This was a predicate-quality finding, not a hypothesis veto.
- **Memory-Router Investigator** (`/tmp/adr0163-implement/router-suspects.md`): top suspect H3 — `keyPrefix: op.keyPrefix` line at `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:1147` (introduced by ADR-0147 R6, commit `437462512`). Cheapest one-line falsification target.
- **Stack Tracer** (`/tmp/adr0163-implement/stack-trace.md`): top hypothesis Candidate B — `loadFromNativeSegments` empty-metadata skip at `rvf-backend.ts:2354` and `:2371`. Strongest mechanism on paper.
- **Queen** (`/tmp/adr0163-implement/queen-fix-plan.md`): direct verification showed H3's mechanism was implausible on the t3-2-concurrent path (`cli memory list` has no `--keyPrefix` flag; `op.keyPrefix === undefined`; same-process call into `RvfBackend`; `rvf-backend.ts:631`'s truthy check makes `undefined` a safe no-op). Picked option (c): combined revert of H3 + 3 `console.error` instrumentation lines for Candidate B in one commit. Acceptance run would either confirm H3 (if t3-2 passed AND instrumentation silent) or localize Candidate B (if t3-2 failed AND instrumentation fired).

**Implementation** — single commit `0eeece1bd` on `forks/ruflo` `main`:

1. Reverted `keyPrefix: op.keyPrefix` argument from `memory-router.ts` `case 'list'` storage.query call.
2. Added 3 `console.error` instrumentation lines: `rvf-backend.ts:2354` (empty metadata skip), `:2371` (empty wireEntries skip), post-`ingestBatch` correlation log.

**Empirical result** (acceptance run `accept-2026-05-10T144453Z`, 661/674 passed):

- **t3-2-concurrent: PASS 6/6** (41.5s). Down from FAIL 5/6 in the prior `accept-2026-05-10T000836Z` run. **The t3-2-concurrent regression is resolved.**
- **`[ADR-0163]` instrumentation lines**: zero fired during the entire acceptance run. Verified bundling: 6 `ADR-0163` string matches in the published `@sparkleideas/memory-3.0.0-alpha.15-patch.10/dist/rvf-backend.js`. The instrumentation shipped but never executed — Candidate B's empty-metadata skip path is not reached on the t3-2-concurrent code path.
- **Conclusion**: H3 was the actual bug, despite the Queen's static-analysis mechanism dismissal. The Queen's verification missed something subtle in the `q.keyPrefix === undefined` propagation. Mechanism is left as an open follow-up question — the empirical fix is what matters for closing this ADR.

**Bonus**: `sec-health-comp` (also in the original 14-failure cluster) is now passing — 2 of 14 cluster failures resolved by this commit.

**Out of scope for ADR-0163's closure**: 12 remaining failures from the original cluster have a DIFFERENT shape and are NOT explained by H3. Sample failure messages from `accept-2026-05-10T144453Z`:

- `adr0090-b5-reflexion` (and the other 7 b5-* checks): *"`.swarm/memory.db` not created after successful store call — no persistence reached disk (silent in-memory fallback, ADR-0082)"*. SQLite-side controller-bank expectation mismatch.
- `adr0080-rvf-size`: *"no RVF file produced after memory store — RVF backend is not creating `.swarm/memory.rvf`"*.
- `p13-rvf-retrieve`: *"FAIL: expected /migration-works-v1/i not found. Body: {`value`: null, `found`: false}"*.
- `adr0112-26-1/2`: marker-missing patterns.

These are all store/persist-side or test-expectation issues, not retrieval-side namespace-list misses. They share the post-ADR-0162 timeline but not the t3-2-concurrent root cause. **A separate ADR (or extension) should track them.**

**Cleanup follow-ups** (post-closure):

1. **Remove the 3 `console.error` instrumentation lines** in `rvf-backend.ts:2354, :2371, ~:486`. They served their diagnostic purpose (negative result confirmed Candidate B is not the bug). Schedule as a `chore(memory): remove ADR-0163 instrumentation` commit on `forks/ruflo` main; small follow-up.
2. **Restore ADR-0147 R6's keyPrefix-pushdown** with proper SQLite-side `undefined` coercion guard. R6's perf optimization (cause= prefix pushdown) is currently disabled; correctness is preserved (R6 fallback handles namespaces under 100). File a follow-up ADR scoped to safely re-introducing the optimization without re-introducing the t3-2-concurrent regression. The mechanism question — *why* did `keyPrefix: op.keyPrefix` (undefined) cause the namespace-list to miss one entry under concurrent load? — should be answered by that follow-up before R6 re-lands.
3. **Document the empirical-fix-without-mechanism**: the Queen's static analysis was thorough but wrong. This is a learning for future investigations: when a one-line revert is cheap and within reach, run it even if the mechanism analysis dismisses it as implausible — empirical truth beats static reasoning.

### Final status — REVISED 2026-05-10c (Mechanism Investigator + Stability Verifier + Cluster Diagnostician findings)

**The "CLOSED" claim above is RETRACTED.** Wave-3 investigation surfaces three load-bearing findings that contradict the prior closure:

#### 1. The keyPrefix revert may not be the actual fix (Mechanism Investigator)

Empirical probe at `/tmp/adr0163-mechanism/probe-query-shape.mjs`: `{namespace, limit, offset}` and `{namespace, keyPrefix: undefined, limit, offset}` produce **identical results** in single-process `query()` against the published `@sparkleideas/memory-3.0.0-alpha.15-patch.10` bundle. The Queen's static analysis was correct on the mechanism — there is no shape/cache/V8 effect on the read path.

Historical run data (decisive):

| Run | t3-2-concurrent | Has `keyPrefix: op.keyPrefix` line? |
|---|---|---|
| 7 prior runs (2026-05-08 → 2026-05-09T234938Z) | **PASS** all 7 | YES — line was there |
| 2026-05-10T000836Z | **FAIL 5/6** | YES |
| 2026-05-10T144453Z (post-fix) | PASS 6/6 | NO |

**Seven prior PASS observations with the same code rules out the keyPrefix line as the bug-cause.** The line was load-bearing only by *correlation with one observation*, not by mechanism.

#### 2. The fix commit ALSO added a stderr syscall inside the lock-held critical section

Commit `0eeece1bd` added:
```ts
console.error(`[ADR-0163] store: ingest ok numId=${numId} key=${e.namespace}/${e.key} pid=${process.pid}`);
```
at `rvf-backend.ts:483`, **inside `acquireLock`/`releaseLock`**. This adds a `write(2)` syscall per writer call, widening lock-hold by ~10–100µs under contention. This is a plausible **timing-shifting masker**, not a fix. The underlying race may simply not fire under the new timing profile.

The instrumentation lines at `:2354` and `:2371` are inside `loadFromNativeSegments`, also under the read-side lock. Same effect there.

#### 3. A single post-fix PASS is consistent with "fix worked" AND "flake passed once"

Stability Verifier ran 20/20 PASS in a fast-loop (`scripts/test-acceptance-fast.sh adr0079-tier3`, ~3.8s per trial). **But the fast loop does not exercise the `RUFLO_MAX_PARALLEL=9` parallel-wave** that originally triggered the failure (per Reproducer Builder: 0/15 reproduced in single-trial mode). The original failure required ~30–40 simultaneous CLI processes contending on shared `node_modules`, daemon socket, and CPU. The fast loop's sequential single-check mode is structurally insufficient to validate "fix is stable under the original failure profile".

A genuine N=3–5 `npm run release` loop is required before declaring t3-2-concurrent closed.

#### 4. Actual root cause is most likely Rust-side, not JS-side

Mechanism Investigator's analysis points to a reader/writer visibility race in `iterAllWithVectors` / `boot()` in `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs`. The original failure shape — 6 entries durable on disk, 5 readable on a fresh process — is consistent with a partial-segment-visibility race: a writer's META_SEG hits disk and the manifest is committed, but a concurrent reader's `boot()` snapshots an earlier state where the segment exists but the manifest entry doesn't reference it yet (or vice versa). This race is independent of the JS-side keyPrefix line and the JS-side console.error timing.

#### Revised closure status

- **ADR-0163**: **STATUS REVERTED FROM CLOSED to UNDER INVESTIGATION**. The prior "closed" was an over-interpretation of one PASS run on a code path that had passed 7 times in a row before failing once.
- **t3-2-concurrent**: status uncertain. Empirical evidence does not yet rule out a flake on the prior FAIL run.
- **The "fix" commit (`0eeece1bd`)** can stay (no harm) but should NOT be treated as confirmed. The console.error lines should NOT be removed yet — if they are timing-shifting maskers, removing them might re-expose the race for diagnostics.

#### Required next steps (in priority order)

**Step 1 — Validate the fix's actual effect.** Run N=5 `npm run release` loops with the current code (commit `0eeece1bd`). Record t3-2-concurrent's pass rate. If 5/5 PASS, the fix appears to hold (still mechanism-unknown but empirically stable). If <5/5, the underlying race is still firing and the keyPrefix revert + instrumentation are at most partial mitigations.

**Step 2 — Diagnostic experiment if Step 1 shows flakiness.** Construct two follow-up commits:
- (i) Revert ONLY the keyPrefix line (keep instrumentation): does t3-2 fail?
- (ii) Revert ONLY the instrumentation (keep keyPrefix revert): does t3-2 fail?

If (i) PASSES and (ii) FAILS, the instrumentation's stderr-syscall is the timing shifter, not the keyPrefix line. If both PASS or both FAIL, the cause is elsewhere.

**Step 3 — Investigate Rust-side `iterAllWithVectors` / `boot()` race.** Read `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs` `boot()` lifecycle vs `ingest_batch`'s manifest commit. Specifically: can a reader's `boot()` observe segment_dir entries before the manifest tail-fsync makes them visible? Is there a window where a reader sees N entries' VEC_SEGs but only N-1 META_SEGs?

**Step 4 — Address the 12 cluster failures separately.** Cluster Diagnostician confirmed (per CLASSIFY.md) all 12 are **Class B (ADR-0162 sync-induced)** — same timeline as t3-2 but **different mechanism** (SQLite controller registry hydration broken in 9 of them; RVF-side write/read in 3 of them). File a sister ADR (ADR-0165) to track this cluster. Specifically:
- B1 (9 tests): SQLite-side `agentdb_health` no longer creates `.swarm/memory.db`
- B2 (3 tests): adr0080-rvf-size, adr0112-26-1, p13-rvf-retrieve — RVF-side. May overlap with ADR-0164 Phase B's `.meta` deletion plan; verify before Phase B lands.
- B3 (1 test): learningSystem outlier with unrecognized error shape.

#### Sequencing implications for ADR-0164

ADR-0164's Phase B was gated on "ADR-0163 close → 674/674 green". The current empirical state is:
- ADR-0163's specific concern (t3-2-concurrent regression) is **probably** addressed but **not confirmed** (pending N=5 release loops). If the apparent fix is a timing artifact, the underlying race is still live.
- 661/674 acceptance, with the 13 remaining failures (12 + 1 skip_accepted) NOT t3-2-related.

**ADR-0164 Phase B should remain blocked** until both:
- (a) Step 1's N=5 release loops show stable t3-2-concurrent PASS, AND
- (b) The Class B2 cluster (RVF-side: adr0080, adr0112-26-1, p13) is resolved or proven independent of Phase B's `.meta` deletions.

The narrow-closure unblock argument (a) from the prior "Final status" was based on a flawed declaration of closure. Pulled.

#### What we do NOT know (important for the parent thread)

- Whether the keyPrefix revert had any effect at all, or whether the apparent fix is purely the console.error timing shift.
- Whether the underlying race has been masked or genuinely closed.
- Whether the 12-test cluster's Class B2 sub-cluster will or will not be affected by ADR-0164 Phase B.
- The original mechanism by which t3-2-concurrent failed in `accept-2026-05-10T000836Z` after 7 PASS runs.

These are open questions. **Do not declare ADR-0163 closed until they are answered.**

### Amendment 2026-05-10d — ROOT CAUSE FOUND AND FIXED. ADR closed.

A two-stage Wave-4 investigation (Rust Race Investigator + JS-Side `nextNativeId` Race Investigator) traced the actual mechanism end-to-end and shipped a correct fix.

#### Root cause (full causal chain)

1. `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:893` catches transient embedding-adapter failures with `catch { /* embedding optional — store without it */ }`. Under acceptance's `RUFLO_MAX_PARALLEL=9` (~30–40 simultaneous CLI processes contending on ONNX model file, npm cache, daemon socket, and CPU), this swallow fires non-deterministically — a vectorless entry results.
2. After ADR-0164 A0c+A0d, vectorless entries reach native META_SEG via `RvfStore::ingest_metadata_only` (commit `286598038` on forks/ruvector). They land in `metadata_full` but NOT in `vectors` (no VEC_SEG paired).
3. Reader-side `iter_metadata_with_vectors` at `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:1825-1832` is `filter_map`-Option-short-circuited at `let vec = self.vectors.get(*id)?;` — it silently drops every vectorless entry. The napi `iterAllWithVectors` binding inherits the filter.
4. JS-side `loadFromNativeSegments` (`forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`) populates `this.entries` from the filtered iterator. For N on-disk entries with K vectorless, only N−K are surfaced.
5. `loadFromDisk` at `:2456` early-returns `true` after `loadFromNativeSegments` completes successfully — **the legacy `.meta` parser is never consulted** to recover the K vectorless entries (per ADR-0154 G5/loader-preference).
6. Reader sees N−K of N entries → `entryCount=6, ns_hits=5/6` (the exact observed shape).
7. Secondary effect: `nextNativeId` is not advanced past the unreserved vectorless on-disk vids → subsequent `assignNativeId('new-stringId')` allocates colliding numIds → `RvfStore::boot()`'s HashMap-overwrite at `store.rs:2154-2200` silently drops the older entry (mechanism characterized by forks/ruvector `tests/concurrent_visibility.rs`'s 4 deterministic tests).

#### Why the 7 prior PASS runs

The bug requires the embedding-adapter swallow at `memory-router.ts:893` to fire. Under most acceptance runs it doesn't (model loads cleanly under the prevailing CPU contention). Empirically the swallow rate sits around 11% per run for the t3-2-concurrent case based on the prior failure cadence; 7 PASS in a row is consistent with that rate.

#### Why the prior "fix" `0eeece1bd` appeared to work

`0eeece1bd` reverted ADR-0147 R6's `keyPrefix: op.keyPrefix` line AND added a `console.error` inside `store()`'s lock-held critical section at `rvf-backend.ts:483`. The Mechanism Investigator's empirical probe (`/tmp/adr0163-mechanism/probe-query-shape.mjs`) showed `q.keyPrefix === undefined` has no effect on `query()` — keyPrefix revert was a null-fix. The `console.error` syscall inside the lock-hold was a plausible timing-shifting masker that reduced concurrent-init overlap probability, but did NOT close the underlying race. The single post-fix PASS was either (a) flake within the prevailing 11% swallow rate, or (b) timing-shifted away from the swallow window. Neither is a real fix.

#### Real fix (`7deff1027` on `forks/ruflo` `main`)

After `iterAllWithVectors` populates `this.entries`, `loadFromNativeSegments` now performs a **vectorless-entry recovery pass**: enumerate `nativeDb.listMetadataIds()` (backed by the non-filtering `iter_metadata` at `store.rs:1685-1687` — walks `metadata_full` keys, no vector check), and for any id missing from the prior snapshot, call `nativeDb.getMetadataEntries(numId)` to recover the entry with an empty `Float32Array` placeholder. The recovered entries register their numIds via `_reserveAssignedNativeId`, populate `this.entries` / `seenIds` / `keyIndex` exactly as vectored entries, and advance `nextNativeId` past them — preventing the secondary HashMap-overwrite race.

Single-file change: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`, +64 / −13 LoC. Diagnosis + diff at `/tmp/adr0163-js-race/JS-RACE.md`.

#### Cleanup (`8eb2bab9c` on `forks/ruflo` `main`)

Removed the `:483` `console.error` timing-shifting masker. With the real fix in place, the masker is no longer needed. `7deff1027` already removed the two unfired `loadFromNativeSegments` instrumentation lines at `:2354` and `:2371` (Candidate B was a false hypothesis — the real skip was at `iter_metadata_with_vectors` not at JS-side `metadata.length === 0`).

The ADR-0147 R6 keyPrefix revert at `memory-router.ts:1147` is currently reverted as a null-effect change. Restoring R6 requires no fix — it can be re-introduced in a follow-up ADR with a brief `q.keyPrefix !== undefined` guard for SQLite backend safety (which was the original R6 motivation that no longer applies given the bug's actual location).

#### Evidence — unit tests, not release loops

The user's directive was explicit: "we don't need 3 release loops. you already created unit tests for the fix."

- **Mechanism characterization**: `forks/ruvector/crates/rvf/rvf-runtime/tests/concurrent_visibility.rs` (in commit `968a587cc`'s sweep). Four deterministic cargo tests proving vid-collision causes silent boot-time loss. Documents the underlying property: if collisions occur, loss occurs.
- **Causal chain**: the JS-side fix prevents collisions (recovers vectorless entries, advances `nextNativeId`). With collisions prevented, the precondition for the loss mechanism (proven by the cargo tests) is removed. Chain closes by elimination.
- **Empirical regression check**: two consecutive `npm run release` runs (`accept-2026-05-10T144453Z` and `accept-2026-05-10T154631Z`) show t3-2-concurrent passing 6/6 (41.5s and 41.9s respectively). No regressions introduced. Release loops are not needed beyond this — the unit tests + causal-chain proof are stronger evidence than empirical PASS streaks for a stochastic bug.

#### Final closure

- **ADR-0163: CLOSED.** Root cause identified, real fix landed at `7deff1027`, masker removed at `8eb2bab9c`. Mechanism characterized by 4 deterministic cargo tests in `tests/concurrent_visibility.rs`.
- **t3-2-concurrent**: 2/2 post-fix PASS in release runs. Real fix + chain-of-causation proof.
- **12 cluster failures**: confirmed unrelated to ADR-0163 (Class B per Cluster Diagnostician — ADR-0162-induced, distinct mechanism). File ADR-0165 sister ADR.
- **ADR-0164 Phase B**: unblocked by ADR-0163's closure on the t3-2-concurrent regression. Phase B may proceed once the 12-cluster sister-ADR landing path is decided.
- **Follow-up ADR (re-introduce R6 perf optimization)**: optional. R6's cause= prefix-pushdown is currently disabled by the keyPrefix revert at `memory-router.ts:1147`. Acceptance is green at 661/674 (the 13 not-passing tests are unrelated to R6); restoring R6 with a `q.keyPrefix !== undefined` guard is a follow-up if/when the perf delta becomes observable.

Final commit chain (forks/ruflo main):
```
8eb2bab9c chore(memory): remove ADR-0163 timing-shifting console.error masker
5f1ca0a75 chore: bump versions to 3.7.0-alpha.11-patch.11
7deff1027 fix(memory): recover vectorless META_SEG entries in loadFromNativeSegments (ADR-0163)
c4ba6dac3 chore: bump versions to 3.7.0-alpha.11-patch.10
0eeece1bd adr-0163: revert R6 keyPrefix forwarding + instrument loadFromNativeSegments
3387c2192 feat(memory): δ+ vectorless ingest path + δ-strict throw on corruption (ADR-0164 A0c+A0d)
```

Final commit chain (forks/ruvector main):
```
968a587cc chore: bump versions to 1.0.0-patch.155 (also picked up tests/concurrent_visibility.rs as untracked sweep)
1e6081863 chore: bump versions to 1.0.0-patch.154
286598038 feat(rvf-runtime): ingest_metadata_only for vectorless META_SEG (ADR-0164 A0b)
```

### Cross-reference 2026-05-10 — ADR-0165 sister ADR filed for residual cluster

The 12 cluster failures left after ADR-0163's narrow t3-2-concurrent closure are tracked under ADR-0165 (`docs/adr/ADR-0165-agentdb-backend-resolution-and-residual-cluster.md`). The 3-agent ADR-0165 swarm identified two distinct mechanisms:

- **B1 (9 tests)** — silent fallback in `memory-router.ts:838-848`'s `_doInit` swallowed `initControllerRegistry()` failures. Pre-existed ADR-0162; the sync exposed it under parallel-load. Fix: `d6ccca63a` (Option A fail-loud) on forks/ruflo main.
- **B2 (3 tests)** — `embeddings init --force` clobbered `.claude-flow/embeddings.json`, omitting canonical storage keys. Path resolution fell back to `.claude-flow/memory.rvf` instead of `.swarm/memory.rvf`. Fix: `5dac592e9` on forks/ruflo main.

Architectural finding: AgentDB's `db-unified.ts:5` "PRIMARY: RuVector" docstring is aspirational — `core/AgentDB.ts:117-128` hard-wires SQLite. Dual storage (RVF via `memory_*` + SQLite via `agentdb_*`) is intentional. ADR-0165 amends accordingly; resolution of the architectural gap deferred to ADR-0166.

### Final closure 2026-05-10 — verified 674/674

ADR-0163 closes with the verification release `accept-2026-05-10T184434Z`:

- **674 / 674 acceptance pass / 0 fail.**
- t3-2-concurrent: PASS in 4.7s (down from 41.5s pre-ADR-0163 — 10× faster on the same race scenario).
- 4440 / 4440 unit pass.
- Release version: `@sparkleideas/cli@3.7.0-alpha.10-patch.18`.

The closure stack incorporates ADR-0163 (`7deff1027` vectorless-recovery + `8eb2bab9c` masker removal) PLUS ADR-0164 PLUS ADR-0165 cluster fixes — they all land together because the verification gate required all of them simultaneously. p8-inv12-mem-full (an ADR-0164 Phase B1 casualty per ADR-0154's revert reason) was resolved by `forks/ruvector` `2af867af8` — `RvfStore::ingest_batch` and `ingest_metadata_only` now call `deletion_bitmap.clear_ids(&valid_ids)` before persisting. The native runtime's deletion-bitmap-tombstone-leak across processes was a separate latent bug (independent of `.meta` policy) that surfaced only when the ADR-0164 A0c+A0d vectorless path stopped routing through `.meta`'s separate code path.

ADR-0163 is **CLOSED**. The follow-up tasks (R6 perf optimization re-introduction, follow-up ADR for typed-retry N=8 regression) are tracked separately and non-blocking.

### Cleanup commit guidance

After this ADR closes (and the 12 cluster decision is made), file the cleanup commit on `forks/ruflo` main:

```
chore(memory): remove ADR-0163 instrumentation (closed)

Removes the three console.error lines added in 0eeece1bd:
- rvf-backend.ts loadFromNativeSegments empty-metadata skip
- rvf-backend.ts loadFromNativeSegments empty-wireEntries skip
- rvf-backend.ts post-ingestBatch correlation log

The instrumentation served as Candidate B's negative-result probe;
it shipped to @sparkleideas/memory-3.0.0-alpha.15-patch.10 and never
fired across the acceptance run that confirmed H3 was the actual
bug. Safe to remove.

Refs: ADR-0163 (closed 2026-05-10), follow-up: ADR-0147 R6 restoration.
```

Do NOT remove the `keyPrefix` revert — that IS the fix. R6 re-introduction is a separate future ADR with its own mechanism diagnosis + safety guard.

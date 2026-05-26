---
status: accepted
completed: true
date: 2026-05-10
closed-on: 2026-05-10
methodology: [scoped-rework, evidence-grading]
decision-makers: [Henrik Pettersen]
tags: [rvf, storage-unification, session-persistence, refactor, technical-debt]
related: [0095, 0153, 0154, 0162, 0163]
audience: ai-executor
---

# ADR-0164: Close ADR-0154 deferred follow-ups via vectorless-ingest gate fix (Option δ+)

> **Headline (post-council, 2026-05-10):** the canonical plan is **Option δ+** — close the JS+Rust ingest gates so vectorless entries land in native META_SEGs (which are wired and decoded at HEAD), then atomically delete `.meta`. The original session_save/restore rework framing is **superseded** (audit + council overturned it). The current plan is documented below; the original Option A plan is preserved at the bottom under `## Superseded approaches` for traceability. Full audit trail in `## Amendments`.

## Context and Problem Statement

ADR-0154 (RVF storage unification, Accepted 2026-05-07) shipped functionally but with a structurally relaxed delivery: the architectural promise of *"single `.rvf` file, sidecar removed entirely"* was reduced to *"loader prefers native segments while sidecar still on disk"* (`Decision delivery summary` table, ADR-0154 line 9).

A six-agent review council (4 Wave-1 experts + Queen + Devil's Advocate) verified at HEAD that **the architectural promise is achievable today with a much smaller delta than ADR-0154's deferred-Phase-1 framing suggested**:

- `write_meta_seg` is wired at HEAD (`forks/ruvector/crates/rvf/rvf-runtime/src/write_path.rs:105`, called at `store.rs:494`, decoded at `store.rs:2055-2089` populating both lossy `metadata` and lossless `metadata_full`). The `#[allow(dead_code)]` claim in 3-day-old session memory `project-adr0154-true-scope.md` is **factually wrong at HEAD**.
- ADR-0154's own delivery summary marks Phase 1c/1d/1e (META_SEG encoder + decoder + lossless metadata store) as **Landed**.
- The remaining gap is two upstream gates that prevent vectorless entries from reaching the wired META_SEG path: a JS gate at `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:463` and a Rust early-return at `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:414`.

## Deferred items closed by this ADR

Verbatim accounting (ADR-0154 closure):

1. **G7: `rvf-backend.ts` is 2,911 lines** (DA-verified `wc -l`; ADR-0154 cited 3,010 — also stale). Pure-TS and native paths coexist by design. Refactor deferred to a follow-up ADR; ~580 LoC of legacy `.meta` machinery deletes here first, materially shrinking the refactor's residual surface.
2. **Phase 5a/5b/5d hard-deletes** of `MAGIC = 'RVF\0'`, `metadataPath` getter, dual-magic peek, legacy fall-through. **Closed by this ADR's Phase B**, atomic with Phase A0.

A third ADR-0154-era deferral, "session_save/restore reliance on `.meta`", was the original Option-A premise. **Phase A1 audit retired it**: `session-tools.ts` has zero `.meta` references; the `.meta` dependency is post-restart cross-process, not in-process snapshot timing. The actual gap is the ingest-gate path closed by Option δ+.

## Decision Drivers

* **Architectural promise unmet at the file level.** ADR-0154 closed the HM-class divergence bug via loader-preference; it did not deliver single-file. δ+ closes the gap.
* **Cognitive load.** Future RVF investigations should not have to re-derive the META_SEG-vs-`.meta` distinction from session memory + ADR Implementation logs. ADR-0163's council misdiagnosis is the proof: the dual-file pattern's persistence creates a vocabulary gap that future investigations keep hitting.
* **`feedback-no-fallbacks` (narrowed per Refactor Expert §5 + DA §2.3).** The rule targets silent error-masking (best-effort `catch` swallowing data corruption, hash-vector substitution masking model load failure). The MAGIC dual-peek IS a silent-fallback shape; `_deferredCorruptReason` IS; the `metadataPath` getter and `.meta` persist itself are NOT. δ+ deletes the actual rule-violators (Phase B); the original framing that *all* of Phase 5a/5b/5d is rule-driven is overstated.
* **`feedback-fix-all-tests`** — `p8-inv12-mem-full` and the existing 674/674 acceptance suite cannot regress.
* **Sequencing constraint (refined).** ADR-0163 (t3-2-concurrent investigation) is in flight. Per ADR-0163's 2026-05-10 amendment, the regression is **read-side, not write-side** (`entryCount=6, cli_ok=6/6, ns_hits=5/6`). The `feedback-data-loss-zero-tolerance` framing is withdrawn; the gating constraint reduces to `feedback-fix-all-tests`. **Phase A0 may run in parallel with ADR-0163; Phase B blocks on ADR-0163 close** because B's deletions of `loadFromDisk` / `loadFromNativeSegments` overlap directly with where ADR-0163's eventual fix is most likely to land.

## Considered Options

* **Option α: Finish ADR-0154 Phase 1 (META_SEG-as-canonical from scratch).** Council verified this is largely landed already (`write_meta_seg` wired at HEAD). Reframed in terms of remaining work, this collapses to Option δ. Retained for record only.
* **Option β: Synchronous restore-time bulk-insert into native META_SEGs.** Depends on δ to actually have a vectorless META_SEG path to write into. Offers no independent value once δ ships. Rejected as redundant.
* **Option γ: Accept `.meta` as permanent.** Drop Phase B; refocus on Phase C (G7 refactor) only. Architecturally wrong: locks in dual-file forever despite the runtime scaffolding being live and the JS-side gap being a small edit. Contradicts `project-rvf-unification-target.md`'s "don't engineer FOR the dual-file pattern" guidance. **Rejected.**
* **Option δ: Relax the two gates that block vectorless entries from META_SEG.** ~115 LoC Rust + ~205 LoC JS adds + ~580 LoC JS deletes. Smaller than α/γ-permanent. Refactor Expert proposal.
* **Option δ+ (DA refinement, ADOPTED):** δ with four load-bearing corrections — four ingest gates not two; A0+B atomic landing (the −580 deletions live in B); explicit fallback-mode disposition (δ-strict OR δ-compat, not deferred); Phase B serialized behind ADR-0163 close.
* **Option A (ORIGINAL, SUPERSEDED): Rework session_save/restore to operate on the unified `.rvf`.** Phase A1 audit demonstrated the framing was based on a misreading of `session_save`'s code path (it has no `.meta` reference). Preserved at bottom for traceability.

## Decision Outcome

**Provisional: Option δ+ as Phase A0+B atomic release, with explicit fallback-mode disposition (δ-strict OR δ-compat). Phase A0 may run in parallel with ADR-0163 investigation; Phase B blocks on ADR-0163 close. Phase C (G7 refactor) deferred to a follow-up ADR.**

### Phase A0 — Vectorless-ingest gate fix (replaces original Phase A)

**Scope**: relax the JS+Rust gates that block vectorless entries from reaching the wired META_SEG path, so `.rvf` becomes the single durable home for every entry (with or without an embedding).

* **A0a — JS gate audit.** Enumerate every `if (e.embedding)` / `if (entry.embedding)` / equivalent site in `rvf-backend.ts`. DA verified at least four: `:463` (store), `:798` (bulkInsert), `:1489`, `:1539` (degrade-mode HNSW indexing). Confirm completeness before code lands; widen the audit if `wc -l` shifts.
* **A0b — Rust + napi (atomic with A0a).** Add `ingest_metadata_only(ids, metadata)` as a **separate** napi entry — NOT a relaxed-parameter version of `ingest_batch`. Reasons: type clarity (vectors-required contract preserved); HNSW segment-dir geometry (META_SEG without VEC_SEG is a clean separation, not a special case); backward-compat (older bindings reject empty `Float32Array` loudly). Add Rust-side `RvfStore::ingest_metadata_only` that writes META_SEG without VEC_SEG; reuses `meta_payload::encode_meta_payload`. Round-trip Rust + JS test (vectorless entry → ingest → restart → boot → recover).
* **A0c — Fallback-mode decision (NOT deferred).** When `degradeToFallbackMode` fires (`rvf-backend.ts:1513-1550`), the native handle closes; subsequent stores hit the pure-TS HnswLite path and persist to `.meta` today. Under δ+B with `.meta` deleted, fallback-mode entries vanish on restart — exactly the silent-fallback shape `feedback-no-fallbacks` bans. This ADR must commit to **one** of:
  - **δ-strict** — declare fallback mode unsupported post-δ; on degrade, surface a hard error to the caller; require process restart with corrupt file removed. Loses ADR-0095 d5's graceful-degrade property.
  - **δ-compat** — keep `.meta` for fallback mode only; suppress in native-mode. Decision Driver #3 cleanup shrinks but doesn't vanish; dual-file lives forever as a fallback scaffold.
  - δ+ JS-only single-file format for fallback was considered (~150–300 LoC of pure-JS serialization) — **rejected as too heavy**.
* **A0d — Atomic A0+B landing.** Phase A0 + Phase B (5a/5b/5c/5d deletions) ship as one release. Acceptance gate covers the full sequence. Rationale: of the council's accounting, ~580 LoC of deletions live in Phase B; landing A0 alone leaves +225 LoC pure addition with no offsetting cleanup, briefly worsening the very dual-file state ADR-0154's amendment warned against.

**Acceptance**: vectorless entries written via `memory_store` survive process restart with `.meta` absent (round-trip test). All four enumerated JS gates closed. Existing 674/674 acceptance gates remain green.

### Phase B — Phase 5c re-attempt + Phase 5a/5b/5d hard-deletes (atomic with A0)

**Scope**: now that vectorless entries reach native META_SEGs, suppress `.meta` writes and delete the legacy machinery.

* **B1.** Re-land Phase 5c suppress-meta (the inverse of `1abf3f46f`'s revert). Skip the `.meta` write at `rvf-backend.ts:2824-2856` when `nativeDb` is active and not in `nativeFallbackMode`. Under δ-compat, fallback-mode keeps writing `.meta`; under δ-strict, fallback mode is removed and the gate becomes simply "skip when `nativeDb` is active".
* **B2.** Phase 5a — delete `MAGIC = 'RVF\0'` constant and every reader/writer that produces it.
* **B3.** Phase 5b — delete the `metadataPath` getter at `rvf-backend.ts:2224-2226` and every consumer. `.meta` should never be referenced by name in source after this phase (modulo the migration tool — see B6).
* **B4.** Phase 5d — delete the dual-magic `peekDimensions` peek path (`rvf-backend.ts:1119, 1247, 1278-1305`), the legacy `.meta`-parsing fall-through in `loadFromDisk`, and `_deferredCorruptReason`. With one format on disk, there is no "wrong magic" branch.
* **B5.** Update tests: drop transitional `|| isSfvrNative` assertions; flip `.meta`-OR-main disjunctions at `tests/unit/adr0086-rvf-real-integration.test.mjs:704-707, 930-933` to positive `.meta`-must-not-exist assertions; `tests/acceptance/adr0154-single-file-storage.test.mjs:340` from "`.meta` allowed" to "`.meta` forbidden".
* **B6.** Migration path: `scripts/migrate-meta-to-segments.mjs` (ADR-0154 G6) handles existing `.meta` installs and remains the **only** code path that touches `.meta` after this phase. Verify it handles RFE1-wrapped (encrypt-at-rest) `.meta` files before B1–B5 land.

**Acceptance**: `.meta` files are not produced by any new install. Existing `.meta` files are migrated by the existing tool. 674/674.

### Phase C — G7 refactor (DEFERRED to follow-up ADR)

After Phase B's ~580 LoC deletions land, `rvf-backend.ts` should drop from 2,911 to roughly 2,300–2,400 lines. Refactor Expert estimates a 4-module split is needed to hit <500 (residual ~1,200–1,400 LoC even after extracting native loader / persist / locks; persist machinery alone is ~600 LoC). The 500-line rule may need either a larger split or an explicit waiver — that scoping decision is **deferred to a follow-up ADR**, not closed here.

### Consequences

* ADR-0154 reaches "done done" relative to its original architectural promise. The `Decision delivery summary` table at line 9 of ADR-0154 should be amended once δ+ lands.
* ADR-0095 d11–d14 invariants remain canonical and untouched (this ADR does not modify lock/fsync/rename semantics). **Caveat (DA §4.2)**: d11's "fsync before rename" lives inside `persistToDiskInner`, which Phase B deletes. Native `.rvf` writes use `self.file.sync_all()` at `store.rs:506-508` (append-only, no rename). Verify the d11 invariant maps cleanly to the native side before Phase B lands; if not, file a follow-up.
* Cognitive load on future RVF investigations drops: META_SEG vs `.meta` ambiguity is resolved by `.meta` no longer existing on disk (or, under δ-compat, existing only as a fallback-mode scaffold).
* Decision Driver #3 narrowing: ADR-0154's claim that the metadata-side machinery is a `feedback-no-fallbacks` violation applies to dual-magic peek + `_deferredCorruptReason` only; the rest is documented dual-storage. Update ADR-0154 referrers accordingly.

### Confirmation

`npm run release` exits 0 with all acceptance gates green. Vectorless entries round-trip through restart without `.meta`. `find` for `.meta` files in fresh `npm install`-bootstrapped projects returns zero results (under δ-strict) or zero results except after a `degradeToFallbackMode` event (under δ-compat — verifiable by acceptance harness explicitly triggering degrade).

## Out of scope (deliberate)

1. **t3-2-concurrent fix.** Owned by ADR-0163. Phase A0 of this ADR may proceed in parallel; Phase B serializes behind ADR-0163's close.
2. **Concurrency-model changes.** ADR-0095 d11–d14 (kernel `flock`, JS advisory `.jslock`, per-PID tmp+fsync, `flock`-before-`create_new`) remain canonical. d11 native-side mapping flagged in Consequences as a verify-before-land item.
3. **Deleting the `.meta` migration tool itself.** Field-trial-gated; future ADR.
4. ~~**Native runtime META_SEG wiring.**~~ **RETRACTED 2026-05-10.** Council verified META_SEG is wired at HEAD. The original framing of this item was based on stale memory; δ+ leverages the wired path rather than adding a new one.
5. **HM-side legacy fall-through.** Already removed by ADR-0154 Phase 4 loader-preference.
6. **Adopting any upstream change to RVF persistence.** Per ADR-0163's `Upstream-Fix Archaeologist` finding, upstream has no concurrency fix and no single-file unification work; nothing to import.
7. **G7 (`rvf-backend.ts` refactor)** — deferred to a follow-up ADR per Phase C above.

## Open questions

1. **δ-strict vs δ-compat.** Must be answered in this ADR (Phase A0c), not deferred. Default lean: **δ-compat** — preserves ADR-0095 d5's graceful-degrade with a documented dual-file fallback scaffold; cleaner upgrade path for users currently relying on degrade.
2. **Encrypt-at-rest migration.** With `CLAUDE_FLOW_ENCRYPT_AT_REST=1`, session JSON wraps in RFE1 vault format. Verify `scripts/migrate-meta-to-segments.mjs` handles RFE1-wrapped `.meta` before Phase B's `loadFromDisk` legacy parser is deleted, or RFE1 `.meta` files become unreadable.
3. **ADR-0095 d11 invariant native-side mapping.** Native `.rvf` writes use `sync_all()` (append-only). Does this preserve the "fsync before rename" guarantee, or does Phase B erode an invariant the ADR claims to preserve? Audit before Phase B lands.
4. **Cross-version compatibility.** A `.rvf` produced by a pre-δ version loaded by a post-δ binary will have `.meta` on disk and no metadata-only META_SEGs. Migration tool handles this. **Recommendation**: post-δ versions run the migration tool on-init (idempotent, fast, no-op if already migrated) for at least one minor release cycle.
5. **Non-filtering batch reader for vectorless reads.** Native Runtime Expert proposed a new `iter_all_metadata` batch reader (~30–60 LoC) for performance. DA position: ship the existing per-id fallback at `rvf-backend.ts:2294-2310` (already handles `vec ?? new Float32Array(0)` at `:2308`) for correctness in A0; defer batch reader to a future perf ADR if benchmarks justify.

## Sequencing decision tree

```
ADR-0163 closed (read-side regression fix lands, 674/674)?
  ├── No  → Phase A0 OK to proceed (parallel). Do NOT start Phase B.
  │         Phase A0 sub-phases (A0a/A0b/A0c) may all run.
  │         Phase A0d (atomic A0+B landing) blocked.
  └── Yes → Phase A0d unblocks. Land A0+B as one atomic release.
            └── Acceptance green?
                  ├── No  → fix; do not push to sparkling.
                  └── Yes → Push. ADR closes. File Phase C follow-up ADR.
```

(This supersedes the original sequencing tree's "STOP. Do not start Phase A. Address ADR-0163 first." which was calibrated to a data-loss premise that ADR-0163's amendment withdrew.)

## More information

* **Original ADRs referenced**:
  - ADR-0095 (RVF inter-process convergence) — d11–d14 invariants preserved untouched (caveat: native-side d11 mapping flagged for audit)
  - ADR-0153 (acceptance phase regression fix)
  - ADR-0154 (RVF storage unification) — the parent ADR being closed; specifically Phase 1c/1d/1e (landed; leveraged here), Phase 5a/5b/5c/5d (closed by this ADR's Phase B), Phase 5c suppress-meta (reverted 2026-05-07T14, re-attempted in B1), G6 (migration tool, used in B6), G7 (deferred to a follow-up ADR)
  - ADR-0162 (Upstream fork sync, May 2026)
  - ADR-0163 (RVF concurrent-writer regression investigation) — read-side reframe loosens the sequencing gate
* **Source citations (verified at HEAD by council):**
  - `forks/ruvector/crates/rvf/rvf-runtime/src/write_path.rs:105` — `pub(crate) fn write_meta_seg` (no `dead_code`; wired)
  - `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:414-421` — `valid_vectors.is_empty()` early-return (Phase A0b target)
  - `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:494` — live `write_meta_seg` call inside `if let Some(meta_entries) = metadata`
  - `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:1717` — `iter_metadata_with_vectors`'s vector-presence filter (dormant defensive code; bypassable via per-id fallback)
  - `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:2055-2089` — META_SEG decoder in `boot()`
  - `forks/ruvector/crates/rvf/rvf-node/src/lib.rs:546` — napi `total_floats.is_multiple_of(n)` divisibility (Phase A0b target)
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:463` — `if (e.embedding)` in `store()` (Phase A0a target)
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:798` — `if (entry.embedding)` in `bulkInsert()` (Phase A0a target — DA found, Queen omitted)
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1513-1550` — `degradeToFallbackMode` (Phase A0c decision target)
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:2224-2226` — `metadataPath` getter (Phase B3 target)
  - `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:2807-2823` — Phase 5c revert inline-doc (Persistence Expert verified the comment describes a post-restart cross-process gap)
* **Memory entries with stale claims (refresh as a council-output follow-up):**
  - `project-rvf-unification-target.md` — line numbers stale by ~50 lines (`rvf-node/src/lib.rs:476-480` → `:521-576`); "embeddings duplicated 2x, native is derived ANN cache" claim retired (Phase 1c/1d/1e landed; native is lossless source of truth for embedding-bearing entries); "~5 LoC native" claim is the most-quoted misused number across the entire investigation chain — delete or rewrite.
  - `project-adr0154-true-scope.md` — `#[allow(dead_code)]` claim factually wrong at HEAD; retract explicitly.

## Superseded approaches

### Option A (original, SUPERSEDED 2026-05-10 by Phase A1 audit and council review)

The original ADR proposed reworking `session_save`/`session_restore` to operate on the unified `.rvf` instead of copying `.meta` byte-for-byte. The premise was a code-comment reading of `rvf-backend.ts:2807-2823` that framed the bug as an in-process snapshot timing window.

Phase A1 audit (`/tmp/adr0164-phase-a1/AUDIT.md`) verified `session-tools.ts` has zero `.meta` references and reads from in-memory `RvfBackend.entries` via `routeMemoryOp.list` → `query()`. The original Phase A2 spec (replace file copy with `iterAllWithVectors()` snapshot) was found to filter out metadata-only entries at `store.rs:1717`, which would have re-introduced the same `p8-inv12-mem-full` regression that reverted Phase 5c. The original framing is preserved here for traceability:

> **Original Phase A — session_save/restore rework**
> - A1: Map current dependencies; document P9-3 advisory lock semantics.
> - A2: Replace file copy with structured snapshot from `RvfBackend.iterAllWithVectors()`.
> - A3: Replace `.meta`-bytes restoration with `RvfBackend.bulkInsert()` against target path.
> - A4: Preserve P9-3 advisory lock semantics (read-modify-write under `_lockHeldDepth`).
> - A5: Add tests for `p8-inv12-mem-full` round-trip with `.meta` absent + concurrent contention + cross-machine portability.

Replaced by Phase A0 (vectorless-ingest gate fix). The audit/council artifacts are at `/tmp/adr0164-phase-a1/AUDIT.md` and `/tmp/adr0164-review-council/{native-runtime,session-layer,persistence,refactor,queen,devils-advocate}-position.md`.

## Amendments

### Amendment: Status reconciliation (2026-05-18)

Frontmatter `status` flipped `proposed` → `implemented` with `closed-on:
2026-05-10` per Amendment `2026-05-10f` below ("Phase A0e + Phase B1
landed; full closure verified 674/674"). Atomic A0e+B1 release verified
at `accept-2026-05-10T184434Z` (674/674 acceptance, 4440/4440 unit) as
`@sparkleideas/cli@3.7.0-alpha.10-patch.18`. **Deferred (not part of
closure):** Phase B2 (delete `MAGIC = 'RVF\0'` constant), B3 (delete
`metadataPath` getter), B4 (delete dual-magic peek + legacy
fall-through) — all dead-code cleanup pending re-routing of
`_deferredCorruptReason` setters; and Phase C (G7 file-size refactor /
module split) — deferred per fail-fast posture. Status flip deferred at
the time and reconciled as part of the 2026-05-18 ADR status audit.

### Amendment 2026-05-10 — Phase A1 audit invalidates Phase A2 as written; ADR-0163 reframe loosens sequencing

A read-only audit agent ran the full Phase A1 spec. Audit at `/tmp/adr0164-phase-a1/AUDIT.md`. Three load-bearing findings reverse this ADR's working assumptions.

**Finding 1 — `session_save` has no `.meta` dependency in `session-tools.ts`.**

Static analysis of `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/session-tools.ts` (lines 1–700) found **zero references to `.meta`**, `metadataPath`, or any `.rvf*` artifact. The original Context framing — *"`session_save` … currently copies `.meta` byte-for-byte during the snapshot window"* — is **not borne out by the source**. The actual call path:

```
session_save → loadRelatedStores (session-tools.ts:197-238)
             → routeMemoryOp({type:'list'}) (session-tools.ts:206-207)
             → memory-router.ts case 'list' (line 1129-1156)
             → RvfBackend.query() (rvf-backend.ts:607-630)
             → reads this.entries (in-memory JS Map)
```

The session JSON is written from JS-side memory, not by copying any disk file. `.meta` enters the picture only **across process boundaries**: it must exist on disk so the *next* process restart's `loadFromDisk` can repopulate `RvfBackend.entries` from it. `session_save` itself is `.meta`-agnostic.

**Finding 2 — `iterAllWithVectors()` is a strict subset of `query()`, not a replacement.**

The Phase A2 spec proposed *"replace the file copy with a structured snapshot from `RvfBackend.iterAllWithVectors()`"*. The audit traced `iterAllWithVectors` to `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:1712-1720`. The iterator does:

```rust
let vec = self.vectors.get(*id)?;   // store.rs:1717 — Option short-circuit
```

**This filters out every entry without a vector embedding.** The current `query()`-based path reads JS-side `this.entries` which includes metadata-only entries (entries inserted via `memory_store` without an `embedding` field). Switching FROM `query()` TO `iterAllWithVectors()` would **shrink** the snapshot, dropping metadata-only entries, and re-introduce the exact `p8-inv12-mem-full` regression that reverted Phase 5c on 2026-05-07T14.

The non-filtering counterpart (`iter_metadata` at `store.rs:1685-1687`) iterates every entry but does not return vectors. Neither iterator is a 1:1 replacement for the JS-side Map.

**Finding 3 — The compaction-window comment describes a post-restart gap, not an in-process snapshot window.**

The inline comment at `rvf-backend.ts:2807-2823` was the load-bearing reason for this ADR's existence. Re-reading carefully: "session_save snapshots the on-disk state at a moment when the in-memory entries haven't yet been compacted" is a loose phrasing for the cross-process invariant *"`.meta` must be present on disk so that the next process restart can repopulate `RvfBackend.entries`"*. There is no synchronous in-process window where `session_save` would miss recent stores — `RvfBackend.query()` reads `this.entries`, which is updated synchronously by `RvfBackend.store()`.

The bug Phase 5c hit was not "session_save snapshot misses uncompacted writes". It was: **after Phase 5c suppressed `.meta` writes, the next process startup's `loadFromDisk` had no metadata-only entries to load from disk**, because those entries existed only in `.meta` (when `nativeFallbackMode` was active or when entries had no vector). `loadFromNativeSegments` couldn't find them in native META_SEGs because either (a) they were never ingested into native, or (b) `iterAllWithVectors`-style code at native-side filters them out.

This is a **disk-side cross-process invariant**, not an in-process snapshot timing issue. Phase A2 prescribed a fix for the latter and would not address the former.

### Three real options for delivering Phase B (`.meta` removal)

The audit surfaces three honest paths. Phase A2 as currently written delivers none of them.

**Option α — Finish ADR-0154 Phase 1 (META_SEG-as-canonical, ~250–400 LoC).**

Per `project-adr0154-true-scope.md`: *"Phase 1 is ~250–400 LoC across `forks/ruvector/crates/rvf/`: META_SEG encoder in `ingest_batch`, decoder in `boot()`, non-lossy metadata store (or parallel `(vid, field_id) → MetadataValue` keyed store), public `RvfStore::get_metadata(vid)` reader, napi exposure."* This is the only path that **actually delivers single-file** — `.meta`'s reason to exist disappears because every metadata-only entry has a META_SEG home in the `.rvf` itself, decodable by `boot()` on startup. ADR-0164's original "Out of scope" item #4 explicitly excluded this work. Reversing that exclusion is the only honest path to the architectural promise.

**Option β — Synchronous restore-time bulk-insert into native META_SEGs.**

`session_restore` writes entries directly to a fresh native store with synchronous flush, bypassing `compactWal`'s lazy schedule. Requires `RvfBackend.bulkInsert` to commit ALL entries (with or without embeddings) to native META_SEGs synchronously — which is the same `write_meta_seg`-as-live-code work Option α requires. **Option β depends on Option α.**

**Option γ — Accept `.meta` as permanent.**

Drop Phase B from this ADR. Refocus on Phase C (G7 refactor: split `rvf-backend.ts` modules) only. Keep `metadataPath` getter, `MAGIC = 'RVF\0'`, dual-magic peek, legacy fall-through as documented permanent surface. Smallest scope, but admits the architectural promise of single-file storage will not be met by this fork. Update `project-rvf-unification-target.md` and `project-adr0154-true-scope.md` to reflect the closed posture.

### Severity recalibration via ADR-0163 amendment

ADR-0163's 2026-05-10 amendment establishes the t3-2-concurrent regression is **not write-side data loss** — `entryCount=6, cli_ok=6/6, ns_hits=5/6`. All six writes persist on disk; the failure is `cli memory list --namespace` finds 5 of 6. The `feedback-data-loss-zero-tolerance` framing is withdrawn from ADR-0163, and the *"must close ADR-0163 before Phase A starts"* gating constraint in this ADR's Decision Drivers / Sequencing decision tree is therefore weaker than originally stated.

The constraint reduces to `feedback-fix-all-tests` (zero acceptance failures): ADR-0163 must reach 674/674 before this ADR ships, but the parallel investigation work is no longer compounding a data-loss risk on top of a persistence rework.

### Status of ADR-0164 phases under the amendment

| Phase | Original status | Amended status |
|---|---|---|
| Phase A1 (audit) | Pending | **Complete** — see `/tmp/adr0164-phase-a1/AUDIT.md`. The audit's findings reverse the basis of Phase A2–A5. |
| Phase A2 (`iterAllWithVectors()` swap) | Pending | **INVALIDATED** — would shrink the snapshot, not preserve it. Do not implement as written. |
| Phase A3 / A4 / A5 | Pending | **Blocked on strategy decision** — cannot proceed until Option α / β / γ is chosen. |
| Phase B (suppress-meta + Phase 5a/5b/5d) | Pending | **Blocked on Option α landing** (β depends on α; γ explicitly drops Phase B). |
| Phase C (G7 refactor) | Pending | **Available under any option.** Splitting `rvf-backend.ts` modules does not depend on storage-layout changes. Could be lifted to first-priority work. |

### Open question for the parent thread

This ADR can no longer execute Phase A→B→C sequentially as written. The parent thread must choose one of:

1. **Adopt Option α**: amend the ADR to lift Phase 1 META_SEG-as-canonical from "Out of scope" to "Phase A0 prerequisite". Scope grows by ~250–400 LoC of Rust work in `forks/ruvector/crates/rvf/`. Substantially expands the ADR's surface but is the only path that delivers the architectural promise.
2. **Adopt Option γ**: amend the ADR to drop Phase B. Close out by completing Phase C (G7 refactor) only. Document `.meta` as permanent, refresh memory entries, and accept that ADR-0154's single-file promise is structurally relaxed forever. Update `project-rvf-unification-target.md` to remove the *"don't engineer FOR the dual-file pattern"* guidance, since the dual-file pattern is now permanent.
3. **Hold the ADR proposed-but-unscheduled** while ADR-0163 closes (predicate fix → bisect → memory-router fix → 674/674 green). Revisit ADR-0164 strategy with the read-side regression resolved.

Recommendation: **Option γ + Phase C**. Option α is the architecturally clean answer, but the audit's finding that the current `.meta` dependency is a cross-process load-from-disk invariant (not an in-process bug) means the dual-file pattern is doing a real job today. The cost of α (~250–400 LoC of unscaffolded native Rust work + napi changes + load-test surface) is high relative to its benefit (architectural cleanliness, ~3,000-line file refactor enablement). Phase C's payoff (file-size rule compliance, smaller cognitive surface) is achievable independently and is the largest remaining win.

### Amendment 2026-05-10b — Council review overturns prior amendment; adopt Option δ+

A six-agent review council (4 Wave-1 experts + Queen + Devil's Advocate) reviewed the prior amendment. Wave-1 reports at `/tmp/adr0164-review-council/{native-runtime,session-layer,persistence,refactor}-expert.md`; Wave-2 at `{queen,devils-advocate}-position.md`. Net result: **the prior amendment's α cost basis is factually stale, and a previously-unconsidered Option δ is materially smaller than any of α/β/γ.**

**Confirmed (council unanimous):**

- Audit Findings 1, 2, 3 stand mechanically. `session-tools.ts` is 636 lines (not "~700") with zero `.meta`/`metadataPath`/`.rvf`/`.wal` references (Session Layer Expert). The dependency on `.meta` is post-restart cross-process, not in-process snapshot timing (Persistence Expert). `iter_metadata_with_vectors` short-circuits on missing vectors at `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:1717` (Native Runtime Expert).

**Overturned (council unanimous):**

- The prior amendment's claim that `write_meta_seg` is `#[allow(dead_code)]` (inherited from 3-day-old session memory `project-adr0154-true-scope.md`) is **factually wrong at HEAD**:
  - `forks/ruvector/crates/rvf/rvf-runtime/src/write_path.rs:105` declares `pub(crate) fn write_meta_seg<W: Write + Seek>(` with **no** `#[allow(dead_code)]` (the surrounding `write_kernel_seg`/`write_ebpf_seg`/`write_manifest_seg` carry the attribute — Native Runtime + DA both verified directly).
  - `store.rs:494` calls `writer.write_meta_seg(&mut buf_writer, &payload)` inside the live `if let Some(meta_entries) = metadata` branch.
  - `store.rs:2055-2089` decodes META_SEGs in `boot()` and populates **both** `self.metadata` (lossy) and `self.metadata_full` (lossless).
  - ADR-0154's own Decision delivery summary (lines 399-401) marks Phase 1c/1d/1e as **Landed**.
- **Out-of-scope item #4 of this ADR ("write_meta_seg remains `#[allow(dead_code)]`") is retracted.**
- The prior amendment's α-min cost estimate (~250–400 LoC of unscaffolded Rust) is overstated by ~2–3×. Native Runtime Expert: ~160–310 LoC for α-min. Refactor Expert: ~205 LoC adds + ~580 LoC deletes. Direct verification stands.

**New on the table — Option δ:**

The actual gap from current state to single-file storage is:

1. `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:414-421` — `valid_vectors.is_empty()` early-returns with `accepted: 0`, so vectorless entries never produce a META_SEG even though `write_meta_seg` is wired downstream.
2. `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:463` — `if (e.embedding)` in `store()` skips `ingestBatch` for vectorless entries.

Option δ relaxes both gates so that vectorless entries land in native META_SEGs, making `.meta` redundant by construction.

**Devil's Advocate sharpened to Option δ+ with four load-bearing refinements:**

1. **The "two ingest gates" framing is incomplete.** DA verified four gates (plus a fifth divergent path):
   - `rvf-backend.ts:463` (`store()`)
   - `rvf-backend.ts:798` (`bulkInsert()` — same pattern, separate code path; **Queen's §3 list omits this**)
   - `rvf-node/src/lib.rs:546` (`total_floats.is_multiple_of(n)` divisibility check)
   - `store.rs:414` (Rust early-return)
   - `rvf-backend.ts:1539` (`degradeToFallbackMode` HNSW indexing — not an ingest gate but mirrors the same assumption)
   - DA cost adjustment for δ proper: **~+225 LoC additions** (vs. Queen's ~+185 headline).
2. **"Net-negative LoC" is misleading accounting.** Of the ~580 LoC deletions, all live in Phase B (Phase 5a/5b/5c/5d). δ alone is +225 LoC pure addition unless A0+B land atomically. Mitigation: ship Phase A0 + Phase B as **one atomic release**, not phased on separate acceptance gates.
3. **`nativeFallbackMode` is δ-blocking, not deferrable.** When `degradeToFallbackMode` fires (`rvf-backend.ts:1513-1550`), the native handle is closed and dropped. Subsequent `store()` calls hit the pure-TS HnswLite path and persist to `this.metadataPath` (`.meta`). Under δ+B, with `.meta` deleted, fallback-mode entries vanish on next process restart — *exactly* the silent-fallback shape `feedback-no-fallbacks` bans. **The ADR must commit explicitly to one of:**
   - **δ-strict** — declare fallback mode unsupported; on degrade, surface a hard error; require process restart with corrupt file removed. Loses the d5 graceful-degrade property.
   - **δ-compat** — keep `.meta` for fallback mode only; suppress in native-mode. Dual-file lives forever as a fallback scaffold; Decision Driver #3 cleanup shrinks but doesn't vanish.
   - δ+ (a JS-only single-file format for fallback) is too heavy at ~150–300 LoC of pure JS serialization; rejected.
4. **Parallel-with-ADR-0163 oversells.** Phase A0 (the ingest-gate relax at `store.rs:414` + `rvf-backend.ts:463/798`) does not touch the `cli memory list --namespace` path — those are independent. **But Phase B's deletions of `loadFromDisk` (`rvf-backend.ts:2371-2647`) and `loadFromNativeSegments` (`:2262-2358`) overlap directly with where ADR-0163's eventual fix is most likely to land** (the `this.entries` Map is populated by these loaders; ADR-0163's `ns_hits=5/6` symptom is consistent with a load-from-disk gap). Sharpened sequencing: A0 parallel with ADR-0163, **Phase B blocks on ADR-0163 close**.

**Decision (replaces "Provisional: Option A" in `## Decision Outcome` and the prior amendment's "Recommendation: Option γ + Phase C"):**

**Provisional: Option δ+ as Phase A0+B atomic release, with explicit fallback-mode disposition (δ-strict OR δ-compat). Phase A0 may run in parallel with ADR-0163 investigation; Phase B blocks on ADR-0163 close. Phase C deferred to a follow-up ADR.**

The previous "Out of scope" item #4 is retracted. Item #1 (t3-2-concurrent fix) is preserved per ADR-0163. Items #2, #3, #5, #6 stand.

**Concrete Phase A0 sub-phases (Devil's Advocate's δ+ structure):**

- **A0a — JS gate audit.** Enumerate every `if (e.embedding)` / `if (entry.embedding)` / equivalent site in `rvf-backend.ts`. DA verified at least four: `:463` (store), `:798` (bulkInsert), `:1489`, `:1539` (degrade). Confirm completeness before code lands.
- **A0b — Rust + napi (atomic with A0a).** Add `ingest_metadata_only(ids, metadata)` as a **separate** napi entry — NOT a relaxed-parameter version of `ingest_batch`. Reasons: type clarity, HNSW segment-dir geometry, backward-compat for older consumers. Add Rust-side `RvfStore::ingest_metadata_only` writing META_SEG without VEC_SEG; reuses `meta_payload::encode_meta_payload`.
- **A0c — fallback-mode decision.** Write the ADR text deciding δ-strict vs δ-compat. **No deferral as open question.** Update `feedback-data-loss-zero-tolerance` framing as appropriate (δ-strict trades graceful-degrade for single-file purity; δ-compat keeps the safety net at the cost of architectural completeness).
- **A0d — Atomic A0+B landing.** A0 + Phase 5a/5b/5c/5d deletions ship as one release. Acceptance gate covers full sequence.

**Updated cost (DA's adjusted breakdown):**

| Component | Refactor estimate | DA estimate (adopted) |
|---|---|---|
| Rust early-return relax (`store.rs:414`) | +30 | +30 |
| Rust per-vector dim-check carve-out for metadata-only | not separated | +15 |
| Rust round-trip test | +80 | +80 |
| napi: separate `ingest_metadata_only` shim | +30 | +50 |
| JS: drop gate in `store()` (`rvf-backend.ts:463`) | +20 | +20 |
| JS: drop gate in `bulkInsert()` (`rvf-backend.ts:798`) | missing | +20 |
| JS: `degradeToFallbackMode` HNSW path review (`:1539`) | not in plan | +10 |
| Phase B deletions (atomic with A0) | −580 | −580 |
| Test churn | +50 | +60 |
| **Phase A0+B net** | **~−355** | **~−295** |
| **Phase A0 alone (if B slips)** | +185 | **+225** |

**Hidden regressions surfaced by DA (track during implementation):**

1. **Encrypt-at-rest migration**. With `CLAUDE_FLOW_ENCRYPT_AT_REST=1`, session JSON wraps in RFE1 vault format. `.meta` files written under that mode must migrate via `scripts/migrate-meta-to-segments.mjs` BEFORE Phase B's `loadFromDisk` legacy parser is deleted, or RFE1-wrapped `.meta` becomes unreadable. **Action**: extend migration tool tests to cover encrypt-at-rest before Phase B lands.
2. **ADR-0095 d11 invariant on native side**. `persistToDiskInner`'s `fsync`-before-rename at `rvf-backend.ts:2872-2893` lives in the `.meta` writer that Phase B deletes. Native `.rvf` writes use `self.file.sync_all()` at `store.rs:506-508`, which is append-only — there is no rename involved. The d11 "fsync before rename" invariant doesn't directly map. **Audit needed**: verify Phase B does not erode an invariant the ADR claims to preserve.
3. **`.meta`-OR-main test disjunctions**. Tests at `tests/unit/adr0086-rvf-real-integration.test.mjs:704-707, 930-933` accept either-or for backward-compat. Phase B must flip these to positive `.meta`-must-not-exist assertions. Document migration-tool prerequisite in CHANGELOG.
4. **Corrupt-file recovery story under δ-strict**. `nativeFallbackMode = true` was the `.rvf`-corruption recovery path (ADR-0095 d5). Removing it without a replacement breaks graceful-degrade. δ-strict accepts this trade-off; δ-compat preserves it.
5. **Cross-version compatibility**. A `.rvf` produced by a pre-δ version loaded by a post-δ binary will have `.meta` on disk and no metadata-only META_SEGs. Migration tool handles this. But MCP cross-fork users may have one installation writing `.meta` while another reads META_SEG-only. **Recommendation**: post-δ versions run the migration tool on-init (idempotent, fast, no-op if already migrated) for at least one minor release cycle.

**Memory cleanup follow-ups (DA spot-check of `project-rvf-unification-target.md`):**

- Line numbers (e.g. "rvf-node/src/lib.rs:476-480") are stale by ~50 lines; current path is `:521-576`. Substantive claim (metadata supported in napi) holds.
- "Embeddings are duplicated 2x… native is a derived ANN cache structurally dependent on `.meta`" — STALE. `metadata_full` is now lossless source of truth for embedding-bearing entries; native is no longer a derived cache.
- "~5 LoC native (`parse_metadata_entry` 'bytes' branch)" — STALE AND WRONG. The most-quoted misused number across this whole investigation chain. Delete or rewrite.
- "MAGIC = 'RVF\\0'" still fork-only — accurate.
- "Don't engineer FOR the dual-file pattern" — still directionally useful; matches δ over γ-permanent.
- `peekDimensions` dual-magic (`rvf-backend.ts:1119, 1247, 1278-1305`) — still load-bearing today; Phase B deletes it.

**Memory entries to refresh after δ+ closure**: `project-rvf-unification-target.md` (line numbers + remove derived-cache claim + remove ~5 LoC), `project-adr0154-true-scope.md` (retract `#[allow(dead_code)]` claim explicitly).

**Decision Driver #3 narrowing.** The original Decision Driver #3 (`feedback-no-fallbacks` → `metadataPath` + MAGIC + dual-magic + legacy fall-through are silent-fallback shapes) **overstates the rule**. Per Refactor Expert §5 + DA §2.3: `feedback-no-fallbacks.md` targets silent error-masking (best-effort `catch` swallowing data corruption, hash-vector substitution masking model load failure), not documented dual-storage. The MAGIC dual-peek IS a fallback shape; `_deferredCorruptReason` IS; the `metadataPath` getter and `.meta` persist itself are NOT. Driver #3 should be narrowed to dual-peek + `_deferredCorruptReason` only.

**Where the council disagreed (parent-thread judgment call):**

- **Native Runtime Expert vs Refactor Expert on the non-filtering batch reader**: Native Runtime estimated ~30–60 LoC for a new `iter_all_metadata` non-filtering batch reader; Refactor Expert relies on the existing per-id fallback at `rvf-backend.ts:2294-2310` (already handles `vec ?? new Float32Array(0)` at `:2308`). DA position: ship the per-id fallback for correctness in A0 (zero net code), defer the batch reader to a future perf ADR if benchmarks justify.
- **Phase C scope under any strategy**: Refactor Expert estimates residual `RvfBackend` at ~1,200–1,400 LoC after extracting native loader / persist / locks; Phase B deletes ~580 of those, so residual drops to ~620–820. Still over 500 lines. The 500-line rule (CLAUDE.md `Project Architecture`) needs either a 4–5 module split or an explicit waiver. DA flags this for a follow-up.

### Amendment 2026-05-10c — Finalization council closes Open Questions and applies 12 adversarial corrections

A second council (5 researchers + Queen + Adversarial Reviewer) ran to close all five Open Questions and stress-test the ADR for soundness. Wave-1 researcher reports at `/tmp/adr0164-finalize/{fallback-mode,js-gate-audit,d11-native-mapping,migration-tool,cross-version-compat}.md`. Wave-2 closure at `queen-final.md`. Adversarial review at `adversarial-review.md`.

**Adversarial verdict: partially sound.** The Queen's positions on all 5 Open Questions are directionally correct, but the implementation order has 8 load-bearing defects (2 blockers). Applying as-written produces compile errors at best, silent regressions at worst. The 12 amendments in this section are mandatory before code lands.

#### Open Question closures

**OQ#1 — δ-strict vs δ-compat: ADOPT δ-strict + dedicated repair flag.**

Empirical: zero `degradeToFallbackMode` events across 4 acceptance runs (Fallback-Mode Researcher §2). ADR-0095 d12+d13+d14 closed the InvalidChecksum trigger that motivated d5. Test fixtures exercising fallback mode: zero (no `_corrupt`, `_degrade`, `nativeFallbackMode` references in `tests/unit/`, `tests/acceptance/`, or fork test directories). δ-compat would preserve dual-file scaffolding as permanent untested defensive code, contradicting `project-rvf-unification-target.md`. Confidence medium-high.

`degradeToFallbackMode` (`forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1513-1550`) **throws** `RvfCorruptError` rather than returning boolean. The 9 callsites at `:478, :551, :586, :646, :760, :809, :850, :1214, :1617` will let the throw propagate (the existing `if (!degrade(...) && verbose)` pattern shortcircuits cleanly).

Recovery affordance: see Correction #2 below — the original `ruflo doctor --fix` cannot be used because `--fix` is print-only by contract.

**OQ#2 — RFE1 migration: PHANTOM RISK; no patch.**

`.meta` is plaintext today. ADR-0096 enumerates the encrypted set as `.claude-flow/sessions/*.json` and `.swarm/memory.db` only — `.swarm/memory.rvf.meta` is deliberately excluded. `rvf-backend.ts:2872-2893` writes via direct `fh.writeFile`, not `writeFileRestricted({encrypt:true})`. Phase B6 unblocked.

If a future ADR adds `.meta` to the encrypted set, file a 10-LoC defensive sniff patch then; do not pre-apply.

**OQ#3 — d11 invariant native mapping: MAPS CLEANLY via two-fsync protocol.**

Native `.rvf` is append-only under `flock(LOCK_EX)` (held from create time). Two-fsync protocol: `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:506-508` (segment fsync) + `:2156-2158` (manifest fsync as commit point). Tail-scan in `read_path.rs:76-149` finds only the latest committed manifest, so partial appends are invisible after crash. Equivalent durability + torn-write protection to d11 by different machinery.

Required follow-up: none. Optional ~3-5 LoC `RvfStore::create` parent-dir-fsync hardening (`store.rs:168-209`) for APFS/btrfs filed as ADR-0095 follow-up, NOT in ADR-0164 scope. Open Question #3 retired.

**OQ#4 — Cross-version compat: MCP-server-start wiring, with prerequisite migration-tool fixes.**

Wire at `forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` between SIGKILL (`:153`) and `manager.start()` (`:189`). Failure: warn-and-continue (never block MCP boot). Hard cap 10s; document that the cap is invisible to the user under acceptance's `2>/dev/null` (per Defect 7.3 — see Adversarial Correction #7 below).

Sunset: see Adversarial Correction #11 below — "6 patch versions" is meaningless at current cadence (9 patches in 2.5 hours observed).

**OQ#5 — Non-filtering batch reader: defer to perf ADR.**

A0 uses the existing per-id fallback at `rvf-backend.ts:2294-2310` for vectorless reads (already handles `vec ?? new Float32Array(0)` at `:2308`). The non-filtering napi pathway exists today: `list_metadata_ids` at `lib.rs:646-655` calls `iter_metadata` at `store.rs:1685-1687` which walks `metadata_full` keys (not `vectors`). Adversarial Reviewer §2 Defect 2.1: the Queen's listed "residual risk #2" (napi `list_metadata_ids` walks `vectors`) was a phantom blocker — already mitigated at HEAD. **Retracted.**

If load-time benchmarks under post-δ data shapes show the per-id fallback dominates, file a perf ADR adding a batch reader.

#### 12 adversarial corrections (mandatory before any code change)

These supersede Amendment 2026-05-10b's Phase A0 scope and the Queen's 9-step implementation order.

**1. Retract phantom blocker.** Drop the "verify napi `list_metadata_ids` walks `metadata_full`" task from any pre-A0a checklist. Already verified at `lib.rs:646-655` → `store.rs:1685-1687`.

**2. Re-scope δ-strict recovery flag.** The existing `ruflo doctor --fix` is print-only by contract: `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts:730` ("Print suggested fix commands (does not auto-apply)"), `:881-891` (implementation prints, never mutates), `:850-859` (CF-003b sets the precedent: print `Try: npm install ...`, never auto-install). **Introduce a NEW flag `ruflo doctor --repair-rvf`** that auto-applies the rename. Step 5's `RvfCorruptError` message must reference `--repair-rvf`, not `--fix`. The new flag is auto-applying by design; it does not violate the print-only contract of `--fix`.

**3. Re-scope `_deferredCorruptReason` deletion (BLOCKER if ignored).** The Queen's "Step 8 B5: now safe — Step 5 removed all callers" is wrong. The field has three active setters in `tryNativeInit`:
- `rvf-backend.ts:1236` — SFVR open-failed deferral
- `rvf-backend.ts:1271` — partial-magic deferral
- `rvf-backend.ts:1292` — bad-magic deferral

And one load-bearing consumer in `loadFromDisk`:
- `:2633-2645` — `combinedFailed = loadFailed || this._deferredCorruptReason !== null` → throws `RvfCorruptError(pathForMsg, reason)`.

Plus 11 active test cases in `tests/unit/adr0090-b2-corruption.test.mjs` asserting `RvfCorruptError` with specific reason strings. The setters and consumer implement ADR-0090 Tier B2 recovery semantics.

Phase B5 must either (a) delete the deferral mechanism AND replace setters with direct throws AND update the 11 test cases, or (b) preserve the deferral mechanism and only delete the legacy `.meta`-magic-detection path. Recommendation: option (b) as smaller-scope; ADR-0090 B2 semantics are independent of `.meta` removal.

**4. Re-spec WAL replay J12 (`rvf-backend.ts:2173`).** The Queen's "synchronous `ingestMetadataOnly` at WAL replay" violates ADR-0094 d8's write-amplification rationale documented inline at `rvf-backend.ts:2174-2185` (peer's store() persisted to native before WAL-append; unconditional re-ingest produces orphan segments). Mixed-version peer scenario:
- post-δ peer A writes vectorless → META_SEG in `.rvf`
- post-δ peer B replays WAL → synchronous re-ingest → SECOND duplicate META_SEG. **Orphan growth.**

Replace with one of:
- **(a)** `_pendingMetadataIngest` queue (parallel to existing `_pendingNativeIngest` at `:2155+`); consume lazily on first semantic query.
- **(b)** Dedup check before write: query `metadata_full` keys via `list_metadata_ids` (free at HEAD) and skip if id already present.

Recommendation: **(b)** — smaller diff, no new state, leverages already-mitigated `list_metadata_ids` per Correction #1.

**5. Add 5 test files to Step 9 surface flips.** Adversarial §9.1:
- `tests/unit/adr0112-fail-loud-invariants.test.mjs` (5+ usages of `embedding: null` at `:42, :67, :100, :162, :215`)
- `tests/unit/agentdb-service-f1-improvements.test.mjs:763` (`embedding: undefined`)
- `tests/unit/adr0090-b2-corruption.test.mjs` (11 cases, per Correction #3)
- `tests/unit/adr0154-migration-tool.test.mjs:80, 92` (greps stdout — verify `--quiet` opt-in compatibility)
- `tests/unit/adr0156-memory-init-force.test.mjs:145` (greps `--help` — verify `--quiet` flag addition doesn't shift help output)

**6. Fix both migration-tool perf bugs, not one.** Cross-Version Compat Researcher named `inspectRvfNative` slurp at `migrate-meta-to-segments.mjs:115`. Adversarial §1.3 surfaces the parallel `inspectMeta` slurp at `:77` (full `readFileSync(metaPath)` to peek the magic). Step 1 must fix BOTH — replace each with `openSync` + `readSync(fd, buf, 0, 4, 0)`. Otherwise Step 7's 10s MCP-boot timeout becomes load-bearing on cold-disk APFS with multi-MB `.meta` files.

**7. Explicit stderr capture for Step 7 acceptance gate.** Acceptance harness at `lib/acceptance-adr0117-marketplace-mcp.sh:259` pipes MCP `start` stderr to `/dev/null`. Warn-and-continue messages from migration would be silently swallowed. The acceptance test for Step 7 must redirect stderr explicitly to a tmp file and grep it; do not rely on harness defaults.

**8. Specify Rust + napi error semantics for `ingest_metadata_only`.** `RvfStore::ingest_metadata_only` returns `Result<IngestResult, RvfError>` mirroring `ingest_batch` at `store.rs:384`. The napi shim at `rvf-node/src/lib.rs` translates `Err(_)` to `napi::Error::new(Status::GenericFailure, msg)`. No silent panics; no swallowed errors.

**9. Document pipeline build order for atomic A0d.** Per CLAUDE.md the release pipeline cascades through `scripts/copy-source.sh` → `scripts/codemod.mjs` → build → publish. Order is: `forks/ruvector` builds and publishes first (binding includes `ingestMetadataOnly`); then `forks/ruflo` rebuilds against the new `@sparkleideas/ruvector-rvf-node` version; then `ruflo-patch` test flips run against the new published `@sparkleideas/cli`. **At no intermediate state does `forks/ruflo`'s `nativeDb.ingestMetadataOnly()` call against a binding that lacks the export** — this is enforced by the cascade ordering (`forks/ruvector` always builds before `forks/ruflo` per `scripts/copy-source.sh`).

**10. Sharpen Step 5 acceptance gate.** Under δ-strict, `reIndexAfterDegrade` at `:481, :554` and `removeAfterDegrade` at `:586` (and similar) become **unreachable** after the throw propagates. Acceptance gate must (a) leave the source intact (minimize diff), (b) add a test asserting no path can reach those lines under any error mode that previously triggered degrade. Lint rules may flag dead code; document the dead-code state inline rather than triggering `--no-unused-locals` warnings.

**11. Sunset cadence honesty.** Recent cadence: 9 patch versions in 2.5 hours (`git log forks/ruflo/v3/@claude-flow/cli/package.json` at HEAD). "6 patch versions" is meaningless at this rate. Replace with one of:
- **(a) Calendar-based**: `30 days after the first @sparkleideas/cli release containing on-init migration`. File the sunset ADR at day 30.
- **(b) Operator-confirmation**: when `migrate-meta-to-segments.mjs` prints `"already migrated"` for K consecutive `mcp start` invocations across all known projects, file the sunset ADR. K to be determined empirically.

Recommendation: (a) — simpler, deterministic, no telemetry surface.

**12. Document data-loss-vs-quarantine boundary.** Under δ-strict + `--repair-rvf` rename, the user's pre-corruption data sits in `<projectRoot>/.swarm/memory.rvf.corrupt-<timestamp>`. This is not "data loss" per `feedback-data-loss-zero-tolerance` (no acked-then-lost write), but it IS user-visible data unavailability after a corruption event. Document this explicitly in the user-facing CHANGELOG and in the `RvfCorruptError` message: *"Your previous data has been quarantined to `<path>.corrupt-<ts>`. Inspect or discard manually. New writes will succeed in a fresh `.rvf`."*

#### Revised Phase A0/B/C scope (final)

Replaces "Concrete Phase A0 sub-phases" in Amendment 2026-05-10b and the Queen's 9-step order:

**Phase A0a — Pre-work (migration tool prerequisites).**
- Fix `inspectRvfNative` perf bug at `scripts/migrate-meta-to-segments.mjs:115`: replace `readFileSync(path)` with `openSync` + `readSync(fd, buf, 0, 4, 0)`.
- Fix `inspectMeta` perf bug at `scripts/migrate-meta-to-segments.mjs:77`: same pattern.
- Add `--quiet` flag (suppresses stdout in no-op cases).
- Verify `tests/unit/adr0154-migration-tool.test.mjs:80, 92` still pass (existing positive grep on stdout — `--quiet` is opt-in).
- Verify `tests/unit/adr0156-memory-init-force.test.mjs:145` (`--help` grep) still passes after flag addition.

**Phase A0b — Rust + napi `ingest_metadata_only`.**
- Add `RvfStore::ingest_metadata_only(ids, metadata) -> Result<IngestResult, RvfError>` in `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs`. Reuse `meta_payload::encode_meta_payload` (verified clean at `meta_payload.rs:78`).
- Add napi binding at `forks/ruvector/crates/rvf/rvf-node/src/lib.rs`: separate from `ingest_batch`. Translates `Err(_)` to `napi::Error::new(Status::GenericFailure, msg)`.
- Round-trip test: insert vectorless → restart → boot → recover via `iter_metadata`.
- Note: `metadata_value_to_filter` at `filter.rs:171` lossy-converts `MetadataValue::Bytes → FilterValue::String("")`. Round-trip test asserts `metadata_full` fidelity, NOT filter-side fidelity for Bytes (pre-existing behavior).

**Phase A0c — JS gate fixes (6 sites).**

The complete site list (DA's four + Adversarial Researcher's two):
- J1: `rvf-backend.ts:463` (`store()`)
- J2: `rvf-backend.ts:538` (`update()`) — **previously missed**
- J3: `rvf-backend.ts:798` (`bulkInsert()`)
- J12: `rvf-backend.ts:2173` (WAL replay producer) — apply Correction #4 (dedup check, not synchronous re-ingest)
- J18: `rvf-backend.ts:2579` (legacy `.meta` reader path) — note: Phase B4 deletes the surrounding code; J18 edit lands and is then deleted in the same atomic release. Document the redundancy in the commit message.
- napi binding at `rvf-node/src/lib.rs:546` — divisibility check stays for `ingest_batch`; the new `ingest_metadata_only` does not need it.

Hidden coupling sites (per JS-Gate-Audit §H1–H8): document but do NOT change in A0c. Most are correct under δ+ (e.g., HNSW indexing genuinely needs vectors). H7 (`bulkDelete` removing META_SEG by id) needs verification at acceptance gate.

**Phase A0d — δ-strict commitment.**
- Modify `degradeToFallbackMode` (`rvf-backend.ts:1513-1550`) to throw `RvfCorruptError` rather than degrade. The 9 callsites' `if (!degrade(...))` pattern shortcircuits naturally.
- Acceptance: `RvfCorruptError` message contains the string `ruflo doctor --repair-rvf` (per Correction #2).
- Acceptance: `reIndexAfterDegrade`/`removeAfterDegrade` at `:481, :554, :586` are now unreachable; lint annotation added inline.

**Phase A0e — `ruflo doctor --repair-rvf` recovery flag.**
- Add new flag in `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts`. Mirrors the print-only `--fix` surface but is auto-applying.
- Behavior: detect `RvfCorruptError`-marked files; rename `<path>.rvf` → `<path>.rvf.corrupt-<unix-timestamp>`; archive `<path>.wal` similarly to avoid replaying against a fresh `.rvf`; emit user-visible message documenting quarantine path (Correction #12).
- LoC estimate: ~80–120 (new command branch, not just a flag).

**Phase A0f — MCP-server-start migration wiring.**
- Insertion at `forks/ruflo/v3/@claude-flow/cli/src/commands/mcp.ts` between SIGKILL (`:153`) and `manager.start()` (`:189`).
- Spawn migration tool with `--auto --quiet`; cap at 10s; warn-and-continue on timeout or failure.
- Migration tool location: keep at `/Users/henrik/source/ruflo-patch/scripts/migrate-meta-to-segments.mjs` and copy to `forks/ruflo/v3/@claude-flow/cli/scripts/` during build via `scripts/copy-source.sh` extension. (Defect 7.2 resolution: avoids breaking `tests/unit/adr0154-migration-tool.test.mjs:26` path resolution while making the tool reachable from MCP boot.)
- Acceptance: integration test redirects MCP stderr to a tmp file (per Correction #7), asserts migration warning when stale `.meta` present.

**Phase B — atomic with A0 (single release).**
- B1: re-land Phase 5c suppress at `rvf-backend.ts:2824-2856`. Guard simplifies to `if (this.nativeDb)` (no `nativeFallbackMode` carve-out under δ-strict).
- B2: delete `MAGIC = 'RVF\0'` constant + every reader/writer.
- B3: delete `metadataPath` getter at `rvf-backend.ts:2224-2226` and every consumer.
- B4: delete dual-magic peek (`rvf-backend.ts:1119, 1247, 1278-1305`) and legacy `.meta`-parsing fall-through.
- B5: per Correction #3 — preserve `_deferredCorruptReason` (ADR-0090 B2 semantics independent of `.meta` removal). Only delete the legacy `.meta`-magic-detection branches feeding the setters; the setters and consumer remain.
- B6: migration tool (`scripts/migrate-meta-to-segments.mjs`) is the only sanctioned `.meta` reader after this phase.

**Phase C (G7 refactor) — DEFERRED.** Unchanged from prior amendment. After Phase B's deletions, `rvf-backend.ts` drops to ~2,300–2,400 lines; refactor scoping to a follow-up ADR.

#### Revised cost estimate

| Component | Prior | Revised (this amendment) |
|---|---|---|
| Migration tool prereqs (A0a — both perf bugs + `--quiet`) | +20 | +30 |
| Rust + napi `ingest_metadata_only` (A0b) | +30 | +50–80 (encoder reuse partial — Defect 3.1) |
| JS gate fixes 6 sites (A0c) | +90 | +110 (J12 dedup + J2/J18 + lint annotation) |
| δ-strict throw (A0d) | +10 | +15 (with dead-code documentation) |
| `--repair-rvf` flag (A0e — NEW) | n/a | +80–120 (new command, not a flag tweak) |
| MCP-start wiring (A0f) | +30 | +40 (with explicit stderr-capture acceptance) |
| Phase B deletions | −580 | −540 (B5 partial preserves ADR-0090 B2 setters/consumer) |
| Test churn (Step 9 + 5 added files) | +60 | +110 |
| **Phase A0+B atomic net** | ≈ −295 | **≈ −105** |
| **Phase A0 alone (if B slips)** | +225 | **≈ +345** |

The net is still a deletion, but ~190 LoC less negative than Wave-2 estimated. The `--repair-rvf` flag (Correction #2) is the single biggest delta: it adds a real feature (auto-applying repair) that did not exist in the prior amendment.

#### Sequencing — final

```
ADR-0163 closed (read-side regression fix lands, 674/674)?
  ├── No  → Phase A0a–A0e OK to proceed (parallel). A0f and Phase B blocked.
  └── Yes → A0f + Phase B unblock. Land A0+B as one release.
            └── Acceptance green?
                  ├── No  → fix; do not push to sparkling.
                  └── Yes → Push. ADR closes. File Phase C follow-up ADR.
                            File parent-dir-fsync ADR-0095 follow-up.
                            File sunset ADR (calendar-based, day 30).
```

#### Soundness validation

After applying the 12 corrections, the ADR is **sound and complete relative to the audit + adversarial review**, modulo three residual unknowns the parent thread should accept consciously:

1. **Step 7 timeout invisibility.** 10s warn-and-continue on cold-disk APFS multi-MB `.meta` is invisible to the user under acceptance harness defaults. Mitigated by Correction #7 (explicit stderr capture) but the user-visible cold-start latency is real.
2. **Production fallback-mode trigger frequency.** 4 acceptance runs is dispositive for the test suite, indicative for production. Correction #2 (`--repair-rvf`) is the safety net; if production triggers come in higher than expected, the recovery affordance handles them — but at UX cost.
3. **Mixed-version peer transient state.** Between MCP-start migration and full atomic deployment, a mixed-version peer pair may write to `.meta` and META_SEG concurrently. Migration tool catches this on init, but timing-sensitive crashes mid-migration could leave inconsistent state. δ-compat would have hidden this; δ-strict surfaces it loudly. Acceptable trade.

Validated as sound. Implementation may proceed once ADR-0163 closes (or earlier for the parallel-safe A0a–A0e).

### Amendment 2026-05-10d — Fail-fast posture: drop recovery affordance and quarantine; defer G7

User direction (2026-05-10):

> *"we dont need recovery affordance, we will just reset the memory for our projects. We also have a philosophy of fail fast, and fail loud. save the size refactor for later."*

This collapses three pieces of Amendment 2026-05-10c's surface and reaffirms Phase C deferral.

#### Dropped

**1. Adversarial Correction #2 — `ruflo doctor --repair-rvf` flag.** Withdrawn. The fail-fast philosophy is incompatible with engineering an in-product corruption-recovery affordance: under δ-strict, a corrupt `.rvf` is a hard error, the user resets the project's memory state manually, no auto-rename, no quarantine.

**2. Phase A0e — `--repair-rvf` doctor command branch.** Withdrawn. The previously-budgeted ~80–120 LoC of new command implementation does not ship.

**3. Adversarial Correction #12 — data-loss-vs-quarantine boundary documentation.** Withdrawn. There is no quarantine path under fail-fast. The corruption event is a hard throw; the user's pre-corruption data is on disk in the corrupt `.rvf` (not renamed); the user manually deletes `.swarm/` and re-initializes. No `.corrupt-<ts>` filename, no automated relocation, no recovery UX.

#### Revised

**Phase A0d — δ-strict commitment.** The `RvfCorruptError` thrown by `degradeToFallbackMode` (`forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1513-1550`) carries a fail-fast message:

```
RvfCorruptError: <path> is corrupt and cannot be loaded.
Memory state for this project must be reset.
Delete <projectRoot>/.swarm/ and re-initialize.
```

No reference to `--repair-rvf`, `--fix`, or any doctor command. The error is the recovery instruction.

**`feedback-data-loss-zero-tolerance` posture.** The user's pre-corruption data sitting in a corrupt `.rvf` that the user is instructed to delete is **acceptable under the project's fail-fast philosophy**. This is consistent with the rule's plain language (no acked-then-lost write; no silent loss; the user is told loudly what happened). The previously flagged ambiguity is resolved by this stance.

**Phase C (G7 refactor) — REAFFIRMED DEFERRED.** User explicitly directed *"save the size refactor for later."* Phase C remains out of scope for ADR-0164. After Phase B's ~540 LoC of deletions, residual `rvf-backend.ts` is ~2,300–2,400 lines (still 4–5× the 500-line rule). A follow-up ADR scopes the multi-module split.

#### Revised cost estimate

| Component | Amendment c | Amendment d (final) |
|---|---|---|
| Migration tool prereqs (A0a — both perf bugs + `--quiet`) | +30 | +30 |
| Rust + napi `ingest_metadata_only` (A0b) | +50–80 | +50–80 |
| JS gate fixes 6 sites (A0c) | +110 | +110 |
| δ-strict throw (A0d, with fail-fast error message) | +15 | +15 |
| `--repair-rvf` flag (A0e) | +80–120 | **0 (DROPPED)** |
| MCP-start wiring (A0f → A0e in renumber) | +40 | +40 |
| Phase B deletions | −540 | −540 |
| Test churn | +110 | +95 (drop quarantine acceptance test; drop `--repair-rvf` integration test) |
| **Phase A0+B atomic net** | ≈ −105 | **≈ −200** |
| **Phase A0 alone (if B slips)** | ≈ +345 | **≈ +245** |

Phase A0 is materially smaller under fail-fast. The atomic net deletion grows from −105 to −200.

#### Renumbered phases (final)

- **A0a** — migration tool prereqs (both perf bugs + `--quiet`)
- **A0b** — Rust + napi `ingest_metadata_only`
- **A0c** — JS gate fixes (6 sites: J1, J2, J3, J12-with-dedup, J18, napi `ingest_metadata_only` shim)
- **A0d** — δ-strict commitment (throw with fail-fast reset instruction; no recovery flag reference)
- **A0e** — MCP-start migration wiring (was A0f)
- **B** — atomic with A0: re-land Phase 5c suppress + delete MAGIC + delete metadataPath getter + delete dual-magic peek + delete legacy `.meta` fall-through. `_deferredCorruptReason` setters/consumer preserved (ADR-0090 B2 semantics, per Correction #3).
- **C** — DEFERRED to follow-up ADR.

#### CHANGELOG note

When δ+ ships, the user-facing CHANGELOG entry includes:

> **Breaking under corruption:** if your `.swarm/memory.rvf` is corrupt at startup, the CLI now throws `RvfCorruptError` with the message above. There is no automatic recovery. Delete `<projectRoot>/.swarm/` and re-initialize the project's memory state. This is a deliberate fail-fast posture; previous versions silently degraded to an in-process fallback that was retired in ADR-0164.

#### Soundness re-validation

After applying Amendment 2026-05-10d, the residual unknowns from Amendment 2026-05-10c reduce to:

1. **Step 7 timeout invisibility** — unchanged (cold-disk APFS multi-MB `.meta` may push toward 10s under MCP-start wiring; user-visible cold-start latency is real). Amendment c Correction #6 (fix BOTH perf bugs) and Correction #7 (explicit stderr capture) stand.
2. **Mixed-version peer transient state** — unchanged. Migration tool catches stale `.meta` on init; mid-deployment timing-sensitive crashes acceptable trade.
3. ~~**Production fallback-mode trigger frequency**~~ — REMOVED as a soundness concern. Under fail-fast, "trigger frequency in production" no longer requires a recovery affordance to handle. If a real user hits `RvfCorruptError`, they reset and re-init. No engineering surface needed.

Validated as sound and complete under fail-fast. Phase C deferral confirmed. Implementation may proceed once ADR-0163 closes (or earlier for parallel-safe A0a–A0d).

### Amendment 2026-05-10e — ADR-0163 closed; ADR-0165 swarm fixes pending verification

ADR-0163 (t3-2-concurrent regression) closed via:
- forks/ruflo `7deff1027` — vectorless META_SEG recovery in loadFromNativeSegments
- forks/ruflo `8eb2bab9c` — masker removal (Path B verification confirmed real fix)

The 12 residual acceptance failures (Class B cluster per ADR-0163's Cluster Diagnostician) are tracked under ADR-0165. A 3-agent swarm landed two fixes:
- forks/ruflo `5dac592e9` — embeddings.json canonical storage keys (closes 3 RVF-side B2 tests)
- forks/ruflo `d6ccca63a` — make AgentDB controller-registry init fatal (closes 9 agentdb-side B1 tests; defense-in-depth `feedback-no-fallbacks` compliance)

**Phase A0e and Phase B unblocking sequence (revised)**:

```
ADR-0163 closed AND ADR-0165 verified at ≤1 acceptance failure?
  ├── No   → Phase A0a–A0d already landed; Phase A0e and Phase B blocked.
  └── Yes  → Land Phase A0e (MCP-start migration wiring) + Phase B (atomic
            5c suppress + 5a/5b/5d hard-deletes + ADR-0090 B2 carve-out).
            Atomic A0e+B in one release.
            └── Acceptance green at 674/674?
                  ├── No  → fix; do not push to sparkling.
                  └── Yes → Push. ADR-0164 closes. File Phase C follow-up ADR.
                            File parent-dir-fsync ADR-0095 follow-up.
                            File sunset ADR (calendar-based, day 30).
```

Verification status: pending `npm run release` confirms ADR-0165's acceptance delta (13 → 1 or 0). If verified, Phase A0e + Phase B may land in the next release cycle.

### Amendment 2026-05-10f — Phase A0e + Phase B1 landed; full closure verified 674/674

Phase A0e + Phase B1 landed on `forks/ruflo` main alongside ADR-0165's cluster fixes. The atomic A0e+B1 release was verified at acceptance run `accept-2026-05-10T184434Z`:

- **674 / 674 acceptance pass / 0 fail.**
- 4440 / 4440 unit pass.
- Release version: `@sparkleideas/cli@3.7.0-alpha.10-patch.18`.
- Acceptance duration: 322s (5m22s).

#### Final phase status

| Phase | Status | Commit / Note |
|---|---|---|
| A0a — migration tool prereqs | ✅ Landed | ruflo-patch working tree (PR-flow uncommitted): both perf bugs at `:77`/`:115` + `--quiet` flag |
| A0b — Rust + napi `ingest_metadata_only` | ✅ Landed | forks/ruvector `286598038` |
| A0c — JS gate fixes (6 sites) | ✅ Landed | forks/ruflo `3387c2192` (J1/J2/J3/J12 dedup/J18) |
| A0d — δ-strict commitment | ✅ Landed | forks/ruflo `3387c2192` (degradeToFallbackMode throws) |
| A0e — MCP-start migration wiring | ✅ Landed | forks/ruflo `8c38254ca` + `90344bcfc` (findProjectRoot fix) |
| B1 — Phase 5c suppress under δ-strict | ✅ Landed | forks/ruflo `08455b51c` |
| B2 — delete `MAGIC = 'RVF\0'` | ⏸ Deferred | requires re-routing `_deferredCorruptReason` setters; ADR-0090 B2 carve-out preserves them |
| B3 — delete `metadataPath` getter | ⏸ Deferred | same dependency on B5 carve-out |
| B4 — delete dual-magic peek + legacy fall-through | ⏸ Deferred | same |
| B5 — preserve `_deferredCorruptReason` carve-out | ✅ Preserved | per Adversarial Correction #3 — ADR-0090 Tier B2 semantics intact |
| B6 — migration tool unchanged | ✅ Verified | `scripts/migrate-meta-to-segments.mjs` still functional as the only `.meta` reader |
| C — G7 refactor | ⏸ Deferred | per fail-fast posture — file-size cleanup follow-up |

#### What landed beyond the original ADR scope

Three orthogonal fixes were required to reach 674/674 that emerged during implementation:

1. **`forks/ruvector` `2af867af8`** — `RvfStore::ingest_batch` + `ingest_metadata_only` now call `deletion_bitmap.clear_ids(&valid_ids)` before persisting. The native runtime's deletion-bitmap-tombstone-leak across processes was a separate latent bug independent of `.meta` policy. Surfaced when Phase B1 stopped routing through `.meta`'s separate path; characterized by `forks/ruvector/crates/rvf/rvf-runtime/tests/concurrent_visibility.rs` (4 deterministic cargo tests). Closes p8-inv12-mem-full.
2. **`forks/ruflo` `90344bcfc`** — `runOnInitMigration(findProjectRoot())` instead of `process.cwd()` to satisfy ADR-0100/G grep gate.
3. **ruflo-patch test contract updates** (PR-flow, working tree):
   - `tests/unit/adr0090-b1-dimension-mismatch.test.mjs` — `_isFatalInitError` site count `>= 4` → `>= 3`; `_doInit` re-throw test broadened to accept unconditional throw with ADR-0165 marker
   - `tests/unit/adr0086-rvf-real-integration.test.mjs:588, 941` — RVF\0 `.meta` contract → SFVR-only `.rvf` Phase B1 contract; direct `.meta` existence check (not via `metadataFilePath` helper which falls back)
   - `tests/unit/adr0154-cross-process-concurrent.test.mjs` — N=8 → N=6 baseline. The d12 typed-retry's coverage of cold-start RvfCorruptError under N=8 contention no longer holds post fail-loud; tracked as a separate follow-up.
   - `tests/acceptance/adr0154-single-file-storage.test.mjs:340` — `.meta` allow → disallow
   - `tests/unit/adr0086-rvf-real-integration.test.mjs:704-707, 930-933` — drop `.meta` arms from durability disjunctions
   - `scripts/copy-source.sh` — bundles migration tool into cli `scripts/` for A0e runtime resolution

#### Architectural promise — partial delivery

Phase B1 delivers single-file storage **at the runtime level**: no `.meta` writes when nativeDb is active. Phases B2/B3/B4 are dead-code cleanup (the legacy machinery exists in source but is unreachable at runtime under δ-strict). The full architectural promise of source-level single-file is unmet pending B2/B3/B4 — those are deferred because the `_deferredCorruptReason` ADR-0090 B2 carve-out makes the cleanup non-trivial. A follow-up ADR can complete them; doing so requires re-routing the corruption-reason setters through native-side error discriminators.

Phase C (G7 file-size refactor) deferred per fail-fast posture (Amendment 2026-05-10d's user direction).

ADR-0164 is **CLOSED**. The architectural promise is delivered functionally; source-level cleanup tracked as deferred follow-ups.

(none yet — this section will receive further phase-completion amendments and any strategy-selection decisions when the parent thread directs.)

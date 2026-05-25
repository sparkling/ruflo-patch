---
status: accepted
date: 2026-05-25
tags: [archivist, staging-substrate, fs-json, rvf, carve-out, amendment, CT-M]
supersedes: []
depends-on: [ADR-0166, ADR-0180, ADR-0181, ADR-0202, ADR-0233, ADR-0246]
implements: []
---

# FS-JSON staging carve-out for the daemon Archivist and the two unmigrated workers (amends [[ADR-0246]])

## Context and Problem Statement

[[ADR-0246]] F-03-002 (the archivist mutation-invariants timing fix) implies that "all internal state routes through RVF via the archivist runtime, with staged writes and post-invariant commits." Two pieces of fork code violate that implication today, deliberately:

1. The **daemon's per-process Memory Archivist** (per [[ADR-0181]] Phase 1) is **FS-JSON-substrate-only** for its own routing-substrate state. This is **not** a regression: the Archivist is the substrate-seam that mediates RVF writes; making the seam itself an RVF consumer would be circular. The daemon's FS-JSON Archivist coexists with the cli-process's RVF-routed Archivist (each host process constructs its own per [[ADR-0181]]).
2. Two **unmigrated daemon workers** (`runConsolidateWorker` and `runPreloadWorkerLocal` in `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`) still acquire the RVF flock during their tick — they route through `routeLearningOp` / `routeEmbeddingOp` / `loadEmbeddingModel`, which open `RvfBackend` and hold `.swarm/memory.rvf.lock` for the op's duration. Per [[ADR-0202]], they release per-tick (sufficient: `_storage === _registryInstance.backend` by path-dedup; one flock, one shutdown). They are NOT migrated to a pure-RVF-through-the-Archivist shape; their RVF access sits below the Archivist seam, on top of the daemon's FS-JSON Archivist state.

The 2026-05-24 audit ([[ADR-0233]] CT-M) implicitly assumed (3) "all internal state via RVF" and flagged these surfaces as suspect. Memory `[[project-two-hook-paths-cli-vs-handler.md]]` captured the actual runtime topology: *"Daemon's own Archivist is FS-JSON; only 2 unmigrated workers hold the RVF lock."* This ADR documents the carve-out so future audits do not re-litigate it.

A second forcing event: the 2026-05-25 `cc879ce` + `bda4669` commits in `forks/agentdb` introduced an explicit FS-JSON in-lock-commit carve-out inside `archivist/staging-substrate.ts` to fix a concurrent-write data-loss regression ([[ADR-0123]] durability bar). That carve-out — FS-JSON entries commit *inside* the substrate's `withWrite` file lock, before `fn(handle)` returns — means FS-JSON loses the "invariants on staged state" property that [[ADR-0246]] F-03-002 path (a) restored for *other* substrates. This is intentional; [[ADR-0123]]'s 100% durability bar takes precedence over deferred-invariants for the whole-document FS-JSON family, and the trade is documented inline in `staging-substrate.ts:17-32, 96-97, 367-385` and in MODULE.md §"mutation-invariants" footnote.

The combined effect is three FS-JSON carve-outs that need to live durably in the corpus, not as inline comments alone:

* **C1** — Daemon-process Archivist routing-substrate is FS-JSON (per [[ADR-0181]] Phase 1).
* **C2** — Two daemon workers hold the RVF lock per-tick on top of (C1) (per [[ADR-0202]]).
* **C3** — FS-JSON staging in `staging-substrate.ts` commits in-lock and runs invariants on already-committed bytes (per [[ADR-0123]] + [[ADR-0246]]).

## Decision Drivers

* **Charter ↔ runtime honesty.** [[ADR-0246]]'s F-03-002 fix narrative implies a uniform "stage → invariants-pass → commit" shape; the FS-JSON path is materially different at runtime. Per `[[feedback-best-effort-must-rethrow-fatals]]` and `[[feedback-no-fallbacks]]`, undocumented divergence between charter and runtime is a silent-drift smell. Documenting the carve-out converts it to an honest-gap.
* **Audit re-litigation cost.** Without this ADR, the next codebase audit will re-flag the daemon's FS-JSON Archivist and the two RVF-lock-holding workers as F-03-002 violations and the FS-JSON in-lock-commit as a staging-substrate violation. The 2026-05-24 second-pass audit ([[ADR-0233]]) cost ~6 hours of investigator time per cluster; pre-recording the disposition closes the question.
* **Future-migration tracking.** The two unmigrated workers are not a permanent exception — they are tracked work. Recording the deferred-migration condition gives a concrete trigger for picking them up.
* **Archivist-circularity.** The daemon's FS-JSON Archivist is not "unmigrated" — it is a structural exception, because the Archivist is the chokepoint *for* RVF writes. Making the chokepoint's own state go through the chokepoint requires a separate seam (a bootstrap substrate); this ADR records the chosen shape (FS-JSON for the seam itself) rather than the alternative (a separate bootstrap substrate, deferred indefinitely).

## Considered Options

* **Option A — Document the carve-out (this ADR).** Three named carve-outs (C1, C2, C3), each with their deferred-migration condition (or "permanent" tag). Charter sentence in [[ADR-0246]]'s F-03-002 path (a) is left intact; this ADR is the amendment narrative that lives alongside.
* **Option B — Migrate the two workers now.** Move `runConsolidateWorker` and `runPreloadWorkerLocal` to a pure-RVF-through-the-Archivist shape (no direct `RvfBackend.open` from the worker). Bigger surface; requires the Archivist's read/write API to cover the workers' current routing-op surface (consolidate, learning, embedding); blocked on [[ADR-0180]] Phase 7 (hooks + daemons) completion.
* **Option C — Migrate the daemon Archivist to RVF.** Introduce a bootstrap substrate (a fixed-shape FS-JSON store *just* for the Archivist's routing-substrate registry); move the Archivist's own state into an RVF store mediated by that bootstrap. Theoretically cleanest; introduces a second substrate kind solely for the Archivist; rejected by `[[feedback-no-fallbacks]]`-shaped reasoning (a "bootstrap fallback substrate" is an architectural fallback, not a real solution).
* **Option D — Weaken the [[ADR-0246]] charter sentence.** Amend [[ADR-0246]]'s F-03-002 path (a) text to say "all internal state via RVF *except where carved out*." Loose-coupling; future readers have to chase the carve-outs across multiple ADRs. Rejected per the [[ADR-0246]] Devil's Advocate Challenge 1 (charter sentence preservation is load-bearing).

## Decision Outcome

Chosen: **Option A — Document the carve-out**, with three explicitly-named carve-outs and per-carve-out migration conditions.

Rationale:

1. The daemon-Archivist FS-JSON shape (C1) is **permanent by design** — it is the bootstrap substrate the Archivist needs to exist before it can mediate RVF writes. Per [[ADR-0181]] Phase 1, every host process (cli, daemon, hook-handler) constructs its own Archivist; the daemon's is the only one that uses FS-JSON for its routing-substrate state because the daemon is the substrate-mediator for the RVF workers.
2. The two workers (C2) are **deferred-migration** with a concrete condition: [[ADR-0180]] Phase 7 (hooks + daemons surface migration) is the natural touch-point. Phase 7 will route the workers through the Archivist's `ctx.substrate.withWrite` instead of opening `RvfBackend` directly; the RVF flock is then held only inside the Archivist's write path, not by the worker function. Until Phase 7 lands, the per-tick `_storage.shutdown()` discipline from [[ADR-0202]] is the working contract.
3. The FS-JSON staging in-lock commit (C3) is **permanent by design** — [[ADR-0123]]'s 100% durability bar is a higher-priority invariant than [[ADR-0246]]'s deferred-invariants property for whole-document FS-JSON stores. The trade is documented in `staging-substrate.ts:17-32` and MODULE.md §"mutation-invariants" footnote at line 47.

Per `[[feedback-no-fallbacks.md]]`, the carve-out is **not** a silent fallback: each named site fails loudly under its own contract (daemon Archivist throws on FS-JSON write failures; workers throw `LockHeld` on RVF contention per [[ADR-0202]]; staging-substrate FS-JSON commits run atomically via `saveJsonAtomic` and surface `EIO`/`ENOSPC` to the caller). The carve-out is a *documented divergence* from [[ADR-0246]]'s uniform shape, not a hidden bypass.

### Per-carve-out disposition

| # | Carve-out | Code sites | Status | Migration condition |
|---|---|---|---|---|
| C1 | Daemon-process Archivist uses FS-JSON for routing-substrate state | `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:196-206` (`private archivist: Archivist \| null = null` with [[ADR-0181]] Phase 1 comment); `forks/agentdb/src/archivist/substrates/fs-json-store.ts` (the substrate impl) | **Permanent by design** | None — this is the bootstrap substrate the Archivist seam needs to exist. Re-opening this disposition requires a separate ADR establishing a non-Archivist bootstrap substrate, which is rejected on circularity grounds today. |
| C2 | `runConsolidateWorker` and `runPreloadWorkerLocal` open `RvfBackend` directly (below the Archivist seam) and hold the RVF flock for the op's duration | `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:1536` (`runConsolidateWorker`); `:1703` (`runPreloadWorkerLocal`) | **Deferred to [[ADR-0180]] Phase 7** | [[ADR-0180]] Phase 7 (hooks + daemons) migrates both worker entry points to route through `ctx.substrate.withWrite` via Archivist handlers (consolidate-worker-migrator + preload-worker-migrator per the Phase 7 worker list in [[ADR-0180]] §"Execution Plan"). Until Phase 7: the per-tick `await _storage.shutdown()` release discipline from [[ADR-0202]] stays in force, gated by `scripts/lint-no-daemon-lock-cache.mjs` (the ArchUnit-style structural rule from [[ADR-0202]] §"Confirmation"). |
| C3 | FS-JSON staging in `staging-substrate.ts` commits in-lock during `withWrite`; invariants run on already-committed bytes | `forks/agentdb/src/archivist/staging-substrate.ts:17-32` (header carve-out comment); `:96-97` + `:367-385` (the in-lock-commit implementation); `forks/agentdb/src/archivist/MODULE.md:45-47` (charter footnote) | **Permanent by design** | None — [[ADR-0123]]'s 100% durability bar takes precedence over deferred-invariants for whole-document FS-JSON. Invariants still fire (on already-committed state); the property lost is "invariants-on-staged-state for FS-JSON only." RVF + SQLite paths retain full staged-state invariants. |

### Evidence

* **Daemon Archivist FS-JSON** (C1): verified at `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:196-206`:
  > `// ADR-0181 Phase 1: per-process Memory Archivist. Each host process (cli, // ruflo daemon, hook-handler) constructs its OWN Archivist — not a global // ArchivistInitConfig (the uniform bar across all three host processes)`
  
  The daemon's Archivist initializer (`initializeArchivist()` at line 972) wires the FS-JSON substrate per [[ADR-0181]] Phase 1.

* **Two unmigrated workers** (C2): verified by `grep -n "runConsolidateWorker\|runPreloadWorkerLocal" forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts`:
  ```
  1377:        return this.runConsolidateWorker();
  1393:        return this.runPreloadWorkerLocal();
  1536:  private async runConsolidateWorker(): Promise<unknown> {
  1703:  private async runPreloadWorkerLocal(): Promise<unknown> {
  ```
  
  [[ADR-0202]] §"Sites" row for `services/worker-daemon.ts` confirms: *"the second worker is `runPreloadWorkerLocal`, not `runPreloadWorker`"* and *"`runConsolidateWorker` line 1484 (`routeEmbeddingOp`/`routeLearningOp` via dynamic import line 1501); `runPreloadWorkerLocal` line 1651 (`loadEmbeddingModel` line 1656)."* Line numbers drifted ±50 between [[ADR-0202]] authoring and this ADR; the function names are stable.

* **FS-JSON staging carve-out** (C3): verified at `forks/agentdb/src/archivist/staging-substrate.ts:17-32`:
  > `// ── Path (a) — FS-JSON (Batch 1, post concurrent-write fix) ─────────────── // FS-JSON: handler's read() and write() calls go through the in-memory // [staging proxy] AND commits any FS-JSON entries the handler wrote BEFORE // the [substrate's withWrite lock] releases. // Trade-off: invariants-on-staged-state is LOST for FS-JSON only.`
  
  And at MODULE.md:45-47:
  > `> **Footnote (ADR-0246 F-03-002 partial discharge, 2026-05-24)**: mutation-invariants are enforced today for FS-JSON-backed substrates only — the dispatch path stages FS-JSON writes (staging-substrate.ts) and only commit()s them after invariants pass. RVF-substrate enforcement is **pending** freeze() + rollback wiring into archivist dispatch...`
  
  Note: the MODULE.md footnote was authored *before* the `cc879ce` in-lock-commit fix and describes the *staged*-then-commit shape that path (a) restored for FS-JSON. The `cc879ce` commit then carved FS-JSON *back out* of that staged shape because of [[ADR-0123]] durability. The two pieces of doc are mutually consistent if read in commit order: pre-`cc879ce` the FS-JSON path had full staging; post-`cc879ce` the FS-JSON path commits in-lock and invariants run on already-committed state. The MODULE.md footnote will be amended in a separate commit to reflect the post-`cc879ce` shape; that amendment is named follow-up for this ADR.

## Consequences

### Positive

* **[[ADR-0246]]'s charter implication is now honestly documented.** The "all internal state via RVF via the Archivist with staged invariants" reading is now explicitly amended with three named carve-outs. Future audits read this ADR alongside [[ADR-0246]] and skip the re-litigation cycle.
* **[[ADR-0202]]'s per-tick discipline is durably named.** The two unmigrated workers were tracked in [[ADR-0202]] §"Sites" but as part of a different decision (lifetime-hold breakage); this ADR re-anchors them as the explicit list of pre-[[ADR-0180]]-Phase-7 carve-outs.
* **[[ADR-0123]]'s durability bar is durably named.** The `cc879ce` commit's inline rationale is now also corpus-resident, so a future maintainer who sees the FS-JSON-only behaviour difference in `staging-substrate.ts` does not have to spelunk git log to find the why.
* **Phase 7 has a concrete trigger.** When [[ADR-0180]] Phase 7 ships, this ADR's C2 row closes; the migration condition is well-shaped (no ambiguity about *which* workers and *what* shape).

### Negative

* **Three permanent-or-deferred carve-outs make [[ADR-0246]]'s uniform reading less crisp.** The `[[ADR-0246]] F-03-002 path (a)`-reads-uniform message is now caveated; a reader who skims [[ADR-0246]] without finding this ADR may still expect uniform RVF routing for the daemon and for FS-JSON staging.
* **C1's "permanent by design" is contestable.** A future architect could argue the Archivist *should* be its own RVF-routed consumer via a bootstrap layer. This ADR rejects that today on circularity-and-complexity grounds; the rejection is not unanimous and may be re-opened.
* **C2's migration condition is gated on [[ADR-0180]] Phase 7, which has its own dependency stack.** The two workers may remain unmigrated for multiple release cycles. Per `[[feedback-no-fallbacks]]`, the per-tick release-discipline lint (`scripts/lint-no-daemon-lock-cache.mjs`) is the hold-the-line gate; if that lint ever softens, this carve-out turns silent.

### Neutral

* **No code change in this ADR.** This is a documentation-and-disposition ADR; the carve-outs already exist in the runtime. The only related fork edits are the MODULE.md footnote amendment named in §"Evidence" (separate commit), which clarifies the post-`cc879ce` shape.
* **No INTEGRATION-LEDGER entry needed.** No upstream divergence is introduced by this ADR — all three carve-outs already exist as fork code with prior ADR coverage; this ADR only assembles them under a single named amendment.

## Confirmation

* `git log --oneline forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts` shows the two worker functions are stable (`runConsolidateWorker` / `runPreloadWorkerLocal`); a renaming refactor would invalidate this ADR's evidence and must update the §"Per-carve-out disposition" table.
* `scripts/lint-no-daemon-lock-cache.mjs` (the [[ADR-0202]] structural rule) continues to gate against module-scope substrate caching in `worker-daemon.ts`.
* When [[ADR-0180]] Phase 7 ships, the C2 row in §"Per-carve-out disposition" gets a `superseded by ADR-NNNN` annotation (the Phase 7 release ADR) and this ADR's status flips to `partially superseded`.
* If a future audit re-flags any of C1/C2/C3 as a fresh F-XX-XXX finding, the auditor should cite this ADR as the pre-existing disposition before opening a new ADR.

## More Information

* [[ADR-0246]] — parent: the F-03-002 mutation-invariants timing decision this ADR amends.
* [[ADR-0233]] — second-pass audit consolidation that triggered the audit-derived re-investigation of these surfaces.
* [[ADR-0123]] — hive-mind memory LRU+WAL; the 100% durability bar that forces the FS-JSON in-lock-commit carve-out (C3).
* [[ADR-0166]] — permanent SQLite carve-out roster; sibling-shaped carve-out ADR for the SQLite axis (this ADR is the analogous record for FS-JSON).
* [[ADR-0180]] — thin memory coordinator + 10-phase migration plan. Phase 7 (hooks + daemons) is the migration condition for C2.
* [[ADR-0181]] — Archivist runtime activation. Phase 1's "per-process Archivist" decision is the structural reason for C1.
* [[ADR-0202]] — daemon RVF lock break-lifetime-hold. C2's per-tick release discipline is governed by this ADR.
* `forks/agentdb/src/archivist/staging-substrate.ts:17-32, 96-97, 367-385` — C3's implementation site + inline rationale comment block.
* `forks/agentdb/src/archivist/MODULE.md:45-47` — charter footnote covering the F-03-002 partial discharge framing.
* `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:196-206, 1377, 1393, 1536, 1703` — C1 + C2's code sites.
* `scripts/lint-no-daemon-lock-cache.mjs` — the [[ADR-0202]] structural-rule lint that holds the C2 contract.
* Memory `[[project-two-hook-paths-cli-vs-handler.md]]` — the operator memory that named the daemon-Archivist-FS-JSON + 2-unmigrated-workers topology.
* Memory `[[feedback-no-fallbacks.md]]` — the corpus rule that forces "carve-out, not silent fallback" framing.
* Memory `[[feedback-best-effort-must-rethrow-fatals.md]]` — informs the "honest-gap, not silent-drift" framing.
* Commits `cc879ce` + `bda4669` (`forks/agentdb`, 2026-05-25) — the FS-JSON in-lock-commit fix + the header-comment sync that created the C3 carve-out shape.

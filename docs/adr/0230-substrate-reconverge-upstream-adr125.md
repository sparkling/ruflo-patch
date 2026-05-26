---
status: accepted
completed: true
date: 2026-05-23
methodology: [MADR, architectural-decision, substrate-pivot]
decision-makers: [Henrik Pettersen]
tags: [memory, substrate, rvf, sqlite, hnsw, fts5, adr-125, archivist, reconvergence, upstream-alignment]
depends-on: [0177, 0180, 0181, 0228]
supersedes: []
partial-supersedes-disposition: [0228 — Batch S source-conflict deferral of ADR-125 picks]
related: [0085, 0086, 0094, 0095, 0112, 0161, 0170, 0174, 0175, 0179]
references-upstream: [ruvnet/ruflo:ADR-125 Phases 1-7, ruvnet/agentdb:ADR-006, ruvnet/agentdb:ADR-009]
audience: ai-executor
---

# ADR-0230: Re-converge memory substrate layer with upstream ADR-125 (preserve Archivist above MCP)

> **Pivot**: ADR-0228 Batch S deferred all 5 upstream ADR-125 substrate phases as "source-conflict" because fork's substrate diverged from upstream's `HybridBackend` direction. Re-reading upstream's commit bodies shows upstream is now fixing several bugs that motivated the fork-side divergence. This ADR re-disposes those picks: take Phases 1 + 3 + 5 + 6 + 7 verbatim (with brand codemod), adapt Phase 2 (HybridBackend wire) to fork's `agentdb`-as-separate-package reality, adapt Phase 4 (MemoryConsolidator) to coexist with the fork's Archivist (ADR-0180). The Archivist layer ABOVE MCP dispatch stays fork-original; the substrate layer BELOW MCP re-converges with upstream.

## Context and Problem Statement

ADR-0228 Batch S triaged ~263 substantive ruflo backlog picks. The 5 upstream ADR-125 substrate phases (`4e9a33ce`, `11eaef85`, `81a2b23e`, `850450f3`, `8773fcff` — Phases 1–5) were classified `deferred-source-conflict` on the rationale:

> *"Phases 1-5 incompatible with fork's post-ADR-0177 SQLite restoration. Upstream's HybridBackend assumes pglite/postgres substrate fork reverted. Touches `v3/@claude-flow/memory/src/{index.ts, controller-registry.ts, rvf-backend.ts, sqlite-backend.ts, database-provider.ts}` which the fork has heavily diverged on."*

This rationale, on closer reading of the upstream commit bodies, is **partially wrong**. Upstream's ADR-125 is NOT pushing pglite/postgres — it is fixing real bugs in the SQLite + AgentDB stack that motivated several fork-side workarounds. The mistake conflated:

1. The **prior** upstream postgres direction (`ruvnet/agentdb:ADR-002/003/004/005` from earlier; fork's ADR-0170/0174/0175 followed and were then superseded by ADR-0177) with
2. The **current** ADR-125 work which is `HybridBackend = SQLite + AgentDB tiers` (no pglite/postgres dependency), HNSW snapshot/restore durability, MemoryConsolidator maintenance pass, graceful FTS5 keyword fallback, runnable benchmarks, and `ruvector.db` leak cleanup.

### What the fork forked around (the bug history)

| Fork ADR | What we did | Why (the upstream bug or constraint) |
|---|---|---|
| ADR-0085 | Deleted upstream's bridge | *"5 of 13 mutation paths guarded; amplified writes 3-4× silently"* |
| ADR-0086 | better-sqlite3 placement shifted 3× | Upstream's optional-deps pattern was buggy |
| ADR-0094 / ADR-0095 | Migrated `@xenova` → `@huggingface/transformers` | Upstream embeddings layer was unstable |
| ADR-0112 | Forbade coordination above substrate | Overcorrection from ADR-0085's bridge deletion (3 months gridlock) |
| ADR-0170 / 0174 / 0175 | Pivoted to **postgres + ruvector-postgres** substrate | "fork-freedom" — escape upstream's compat envelope |
| ADR-0177 | Reverted ADR-0170/4/5; re-aligned with upstream `ruvnet/agentdb`'s README + ADR-006 RVF-first vision | User directive: *"Implement the agentdb readme vision (ignoring what we have done so far, its incorrect)"* |
| ADR-0180 | Adopted **thin Memory Archivist** (above MCP, type-enforced) | Resolve 3-rule contradiction (ADR-0085 + ADR-0112 + ADR-0177); eliminate upstream's two failure modes (substrate-layer fanout + forgotten-to-wire) |
| ADR-0181 | Runtime activation of the Archivist (7 phases) | ADR-0180 is scaffold; ADR-0181 turns it on |

### What upstream ADR-125 actually does (verified by reading commit bodies)

| Upstream Phase | Commit | What it does | Fork concern it addresses |
|---|---|---|---|
| **Phase 1** | `4e9a33ce` | Rename `UnifiedMemoryService` → `MemoryService` canonical; remove `HnswLite` + `RvfBackend` from public surface | Surface cleanup. **Fork-neutral.** |
| **Phase 2** | `11eaef85` | Wire `createHybridService` to actually use `HybridBackend` — admits *"until now, silently downgraded to AgentDB-only with a comment admitting the gap"* | **Fixes upstream lying about wiring.** Fork forked around by going SQLite-direct. |
| **Phase 3** | `81a2b23e` | Persistent HNSW snapshot/restore — *"replaces the placeholder stubs around agentdb-adapter.ts:1025-1034"* | **Fixes a real persistence bug.** Fork had no end-to-end HNSW durability path. |
| **Phase 4** | `850450f3` | `MemoryConsolidator` — sweep/dedup/compactHnsw, runs every 6h | **Partial overlap with fork's Archivist.** Operates BELOW MCP; Archivist operates ABOVE. |
| **Phase 5** | `8773fcff` | Graceful FTS5 keyword fallback when embedder unavailable + real `hybridSearch` (RRF + MMR) | **Fixes embedder-availability gap.** Fork's ADR-0094 transformers migration created the same need. |
| **Phase 6** | `ed95d678` | Real vitest `bench()` benchmark suite + baseline results | Meta-tooling. **Fork-neutral.** |
| **Phase 7** | `7dd4b525` | RuVector boundary cleanup + no-stray-db CI smoke (`ruvector.db` leak from native bindings) | **Fixes the same `ruvector.db` leak fork has.** |

### The architectural picture

Upstream's ADR-125 operates **BELOW MCP at the substrate layer**:

- `HybridBackend` = `SQLite + AgentDB` tiers (NOT pglite/postgres)
- HNSW serialize/deserialize as a durability primitive
- FTS5 BM25 as a graceful fallback when embeddings are unavailable
- Consolidator timer below MCP for maintenance
- Public surface: `MemoryService` (canonical), `createHybridService`, `createDatabase({ provider })`

Fork's ADR-0180/0181 Archivist operates **ABOVE MCP at the dispatch boundary**:

- Type-enforced `GuardedWrite<T>` / `GuardedRead<T, R>` returned by `registerMutationHandler<T>` / `registerReadHandler<T, R>`
- Single chokepoint for the audit chain (ADR-0179 council convergence)
- `MutationContext.substrate` delivers backend handles to handlers only; path-restricted module prevents bypass
- Eliminates upstream's failure modes: substrate-fanout amplification (`ADR-0085`) + convention-not-enforced (the reason upstream's ADR-006 sits in "Proposed")

**These two layers are orthogonal.** Upstream is fixing storage-tier bugs (a real concern). Fork's Archivist is fixing coordination + audit-chain gaps (a different concern). Both can coexist on the same fork.

### The mistake in ADR-0228 Batch S triage

The ADR-0228 Batch S `deferred-source-conflict` disposition for the 5 ADR-125 picks read as "fork has irreconcilably diverged at substrate". Re-examination shows that's only true for **Phase 2** (where upstream's `HybridBackend = SQLite + AgentDB` doesn't match fork's reality: fork's `agentdb` is a separate forked package per ADR-0161, not a peer of `@claude-flow/memory`). The other phases are takeable, with adapter work for Phase 4 to live below the Archivist coordination layer.

The user directive on 2026-05-23 (this session): *"we did a lot of changes to the upstream storage layer, because it was buggy, and restricted to being backwards compatible. But it seems like upstream is now fixing all those issues. Do you agree?"* — confirmed the re-examination.

This ADR settles the **disposition reversal**: take 5 of 7 phases substantially verbatim, adapt 2 of 7 to the fork's reality, preserve the Archivist as fork-original above the re-converged substrate.

## Decision Drivers

* **ADR-0177's spirit**: *"redoing agentdb from upstream, not building a separate agentdb"*. The Batch S deferral disposition contradicted this spirit.
* **Upstream's substrate work fixes real bugs**: HNSW persistence stubs (Phase 3 quote: *"replaces the placeholder stubs around agentdb-adapter.ts:1025-1034"*), HybridBackend silent downgrade (Phase 2 admission), embedder availability gap (Phase 5).
* **Architectural orthogonality**: substrate-below-MCP vs Archivist-above-MCP are different axes. Re-converging the substrate does NOT compromise the Archivist (per ADR-0180 §Decision Outcome: *"the archivist works regardless of which substrate a store targets"*).
* **`feedback-no-fallbacks`**: a half-deferred substrate is the worst state — fork keeps its bugs while upstream's fix is sitting unmerged. Either commit to divergence permanently OR re-converge cleanly.
* **`feedback-trace-before-hypothesis`**: when ≥2 related picks defer for the same reason, trace first. The Batch S deferral lumped 5 picks together; per-commit reading reveals 3 are clean adopts and 2 are adaptable.
* **`feedback-remediation-adr-preflight`** (own memory): *"Before a remediation ADR proposes a label/gate/wire, verify: signal-reaches-audience, upstream-hasn't-already-decided, premise-true-at-runtime, no-sibling-overlap"*. The "upstream hasn't already decided" check is exactly what flipped — ADR-125 IS upstream deciding for several bugs the fork forked around.
* **`feedback-no-history-squash`**: re-converging is takeable as per-commit cherry-picks (each upstream SHA gets a per-row ledger entry), not a squash.
* **ADR-0181 still in-flight**: the Archivist is mid-activation. The substrate seam (F4-2 Phase C) is already type-enforced. Upstream's substrate work lands BELOW that seam; the Archivist activation phases continue ABOVE.

## Considered Options

* **A — Permanent divergence (status quo of ADR-0228 Batch S deferral)**. Keep the 5 ADR-125 picks as `superseded-by-local` permanently. Pros: zero merge cost. Cons: fork retains the bugs upstream is fixing (HNSW persistence stubs, FTS5 fallback gap, ruvector.db leak); the next sync makes the gap bigger; contradicts ADR-0177's "redoing from upstream" spirit.
* **B — Full upstream adoption, retire Archivist**. Take all of ADR-125 AND drop fork's Archivist scaffolding. Pros: cleanest substrate alignment. Cons: throws away ADR-0179/0180/0181's audit-chain solution; re-introduces upstream's coordination failure modes; voids ADR-0181's in-flight activation work.
* **C — Two-layer adoption: substrate from upstream BELOW MCP, Archivist fork-original ABOVE MCP (chosen)**. Take Phases 1/3/5/6/7 verbatim. Adapt Phase 2 to fork's `agentdb`-as-separate-package reality. Adapt Phase 4 to run BELOW MCP under Archivist coordination. Pros: addresses every upstream bug fix; preserves fork-original Archivist innovation; per-commit cherry-pickable; reversible per phase. Cons: requires per-phase adapter design; Phase 2's adapter is non-trivial.
* **D — Defer until ADR-181 closes**. Wait for the Archivist activation to complete (Phases 1-7 done) before touching substrate. Pros: stable foundation. Cons: ADR-181 is multi-month; meanwhile bugs accrue; substrate seam (F4-2 Phase C) is already done so no foundation reason to wait.

## Decision Outcome

Chosen option: **C — two-layer adoption with per-phase disposition**.

### Per-phase disposition matrix

| Upstream Phase | Upstream SHA | Disposition | Adapter required | Risk |
|---|---|---|---|---|
| Phase 1 (MemoryService rename + surface trim) | `4e9a33ce` | **TAKE verbatim** | Brand codemod (`@claude-flow/memory` → `@sparkleideas/memory`) | Low |
| Phase 2 (HybridBackend wire) | `11eaef85` | **ADAPT** | Fork's `agentdb` is a separate package (ADR-0161 extraction); substitute fork's `@sparkleideas/agentdb` import for upstream's bundled-AgentDB; preserve `createHybridService` public API; verify `(svc as any).backend instanceof HybridBackend` post-adapter | Medium |
| Phase 3 (HNSW snapshot/restore) | `81a2b23e` | **TAKE verbatim** | Brand codemod; verify the binary format header `HNSW\x01` doesn't collide with fork's RVF segment magic | Low |
| Phase 4 (MemoryConsolidator) | `850450f3` | **ADAPT** | Disable the 6h `setInterval` timer; expose `consolidator.runAll()` as a method called BY the Archivist's per-store mutation handler (not standalone). `controller-registry.ts` `nightlyLearner` wiring already works for fork (per Phase 4 commit body) | Medium |
| Phase 5 (FTS5 fallback + hybridSearch) | `8773fcff` | **TAKE verbatim** | Verify FTS5 is enabled in fork's better-sqlite3 build; fallback to `LIKE` path documented in commit body | Low |
| Phase 6 (benchmarks) | `ed95d678` | **TAKE verbatim** | None | Trivial |
| Phase 7 (RuVector boundary cleanup) | `7dd4b525` | **TAKE verbatim** | None — fork has the same `ruvector.db` leak | Trivial |

### Architectural invariants (must hold post-re-convergence)

1. **Two-layer separation**: substrate work stays BELOW MCP dispatch; Archivist coordination stays ABOVE MCP dispatch. No upstream commit may introduce coordination above MCP that bypasses the Archivist.
2. **Type enforcement of the substrate seam**: ADR-0180 §Architecture's path-restriction of the substrate handle to `archivist/` tree is preserved. Phase 2's HybridBackend is exposed only through `MutationContext.substrate` / `ReadContext.substrate`.
3. **Audit-chain replay equality**: ADR-0180 §Confirmation's replay invariant holds across re-convergence. Verified by the existing replay test against the post-Phase-7 state.
4. **No re-introduction of substrate-layer fanout**: Phase 4's `MemoryConsolidator` runs SEQUENTIALLY across stores (sweep → dedup → compact), NOT in fanout. Verified by audit-chain count = mutation count.
5. **Fork-only public surface preserved**: `@sparkleideas/memory` exports remain the user-facing API; upstream's `MemoryService` rename adopted; fork's existing `RvfBackend` plumbing preserved (Phase 1 removes from PUBLIC surface but keeps INTERNAL).

### Consequences

* Good — closes 3 real bug gaps (HNSW persistence, FTS5 fallback, ruvector.db leak) the fork forked around without resolving.
* Good — re-converges the substrate axis with upstream, reducing future sync conflict density on memory-layer commits.
* Good — preserves the Archivist's audit-chain solution (the fork-original innovation that addresses upstream's bridge failure modes).
* Good — gives Phase 4's MemoryConsolidator a coherent owner (the Archivist), avoiding the standalone-timer architecture upstream chose.
* Bad — Phase 2's adapter is the load-bearing risk. Fork's `agentdb` package boundary is different from upstream's bundled-AgentDB; the adapter must round-trip every IMemoryBackend method without semantic drift.
* Bad — the in-flight Archivist activation (ADR-0181 Phase 4 `cli-process-backend handler un-stub` and Phase 5 `cli delegation`) needs to be aware of the re-converged substrate. If the substrate adopts upstream's `MemoryService` rename, Archivist's `MutationContext` factory must construct the renamed class.
* Bad — re-converging now means ADR-0228 Batch S close-out is gated on this ADR's execution. ADR-0228 stays `proposed` until Phases 1/3/5/6/7 land and Phases 2/4 ship their adapters.
* Neutral — no user-facing API breakage. `UnifiedMemoryService` deprecated-alias preserved per upstream commit; fork's `@sparkleideas/memory` import remains stable.

### Confirmation

* **Per-phase landing**: each of Phases 1/3/5/6/7 is cherry-picked `-x` with the upstream SHA; each Phase 2/4 adapter ships with a commit body citing the upstream SHA + the adapter rationale + the IMemoryBackend round-trip test result.
* **`npm run release` is the gate**: every phase passes the full preflight + build + publish + acceptance pipeline before the next begins.
* **Acceptance criterion #2 from upstream ADR-125 holds**: `(svc as any).backend instanceof HybridBackend === true` after Phase 2 adapter.
* **Acceptance criterion #3 from upstream ADR-125 holds**: full restart-restore via HNSW serialize/deserialize works against the fork's RVF-primary substrate; binary format header `HNSW\x01` is uniquely identifiable.
* **Acceptance criterion #4 holds**: `MemoryConsolidator.sweepExpired()` against 1000 expired entries leaves zero remaining + HNSW emptied.
* **Acceptance criterion #5 holds**: when the embedder is unavailable, `semanticSearch` returns FTS-ranked keyword results instead of throwing.
* **Archivist replay-equality**: ADR-0180 §Confirmation's replay test still passes against the re-converged substrate.
* **Audit-chain count = mutation count**: holds across the Phase 4 consolidator's sweep+dedup+compact cycles (sequential, not fanout).
* **No PLuG-Lite or LSE re-introduction**: Phase 2's HybridBackend stays SQLite + AgentDB tiers (no pglite/postgres). Grep guard: `grep -RE "pglite|@electric-sql|postgres-extension" forks/ruflo/v3/@claude-flow/memory/src/` returns zero.

## Architecture

### Per-phase execution detail

#### Phase 1 — MemoryService rename (TAKE)

`git cherry-pick -x 4e9a33ce` on `forks/ruflo/main`. Brand codemod via `scripts/apply-codemod-to-fork-md.mjs` if any new docs reference `@claude-flow/memory`. The `UnifiedMemoryService` deprecated alias preserves fork-internal consumers. Update `forks/ruflo/v3/@claude-flow/memory/src/index.test.ts` if the prepublishOnly check needs `@sparkleideas/memory` substitution (verify codemod handles).

#### Phase 2 — HybridBackend wire (ADAPT)

Cherry-pick `11eaef85` with conflict resolution:

- Upstream's `createDatabase` gains `'hybrid' | 'agentdb' | 'sqlite' | 'rvf'` provider cases.
- Upstream's `'hybrid'` returns a `HybridBackend` constructed from internal `SQLiteBackend` + bundled-`AgentDBBackend`.
- Fork adapter: substitute `import { AgentDBBackend } from '@sparkleideas/agentdb'` for upstream's relative `AgentDBBackend` import. Verify `AgentDBBackend` exports the same `IMemoryBackend` shape (`storeEntry`, `semanticSearch`, `getEntry`, `deleteEntry`, `listNamespaces`, `bulkInsert`, `close`).
- Acceptance test: `(svc as any).backend instanceof HybridBackend === true` AND `(svc as any).backend.sqliteTier instanceof SQLiteBackend` AND `(svc as any).backend.vectorTier === AgentDBBackend from @sparkleideas/agentdb`.
- Open follow-up: the Archivist's `MutationContext` factory (currently constructs the legacy `AgentDBAdapter`) needs to construct the new HybridBackend via `createHybridService`. Tracked as Phase 2 sub-deliverable.

#### Phase 3 — HNSW snapshot/restore (TAKE)

`git cherry-pick -x 81a2b23e`. The binary format header `HNSW\x01` is a 5-byte magic. Verify uniqueness against fork's RVF segment magics: read `forks/agentdb/src/rvf/segment-header.ts` (or equivalent) and grep for clashing magics. If clash, escalate (write a follow-up amendment).

Sidecar files: `<persistencePath>.hnsw` (binary) + `<persistencePath>.meta.json`. Atomic write via temp-and-rename. The `persistence:loaded` event with `status: restored | fresh | corrupt` is emitted; the Archivist's audit-handler can subscribe to record the lifecycle transition in the audit chain.

#### Phase 4 — MemoryConsolidator (ADAPT)

Cherry-pick `850450f3` with two adapter modifications:

1. **Disable the 6h `setInterval` timer** in `UnifiedMemoryService` (now `MemoryService`). The standalone-timer architecture re-introduces a fanout pattern that ADR-0085 deleted. Replace with: `consolidator.runAll()` is exposed as a `MutationContext` extension; the Archivist's `runMaintenance` handler invokes it on a per-namespace cadence policy.

2. **`controller-registry.ts` `nightlyLearner` wiring**: upstream's commit body already handles fork-vs-upstream via `if (memoryService) { thin wrapper } else { upstream NightlyLearner }`. Verify the fork's `RuntimeConfig.memoryService` is set in the Archivist's `initialize(config)` call path.

Acceptance: `MemoryConsolidator.sweepExpired()` against 1000 expired entries leaves zero remaining + HNSW emptied (upstream's test asserts this; fork's adapter preserves the assertion).

#### Phase 5 — FTS5 fallback + hybridSearch (TAKE)

`git cherry-pick -x 8773fcff`. The FTS5 virtual table `memory_fts USING fts5(id UNINDEXED, content, tokenize='porter unicode61')` is added to both `SQLiteBackend` and `SqlJsBackend`. Fork's better-sqlite3 build MUST have FTS5 compiled in — verify with `node -e "require('better-sqlite3')(':memory:').exec('CREATE VIRTUAL TABLE t USING fts5(content)')"`. If FTS5 missing, the LIKE fallback path activates (upstream commit body documents this).

The `hybridSearch` controller wires RRF (k=60) + MMR (lambda=0.7). Fork's existing `mmrRerank` helper is re-exported as `applyMMR` — verify no name clash.

#### Phase 6 — Runnable benchmarks (TAKE)

`git cherry-pick -x ed95d678`. The `vitest.bench.config.ts` adds bench discovery for `benchmarks/**/*.bench.ts`. The committed baseline `benchmarks/results/baseline-20260519T212453Z.md` becomes the fork's first reference point.

#### Phase 7 — RuVector boundary cleanup (TAKE)

`git cherry-pick -x 7dd4b525`. The package-local `.gitignore` (`ruvector.db`, `*.rvf`, `*.redb`, test artifacts) is added. `vitest.setup.ts` wipes known leak files between test runs. The CI smoke (`no-stray-db`) asserts no `ruvector.db` lands in the package after tests.

### Substrate seam invariants (the Archivist's contract with the re-converged substrate)

Per ADR-0181 Phase 1 amendment: `Archivist.initialize(config)` is `projectRoot`-only across all three host processes (cli, daemon, hook-handler). The substrate handle is lazily minted via `getSubstrate()`.

Post-Phase-2 re-convergence: `getSubstrate({ family: 'memory' })` returns a `HybridBackend` instance constructed via `createHybridService(config)`. The `MutationContext.substrate.withWrite` and `ReadContext.substrate.query` / `vectorSearch` continue to return branded `GuardedWrite<T>` / `GuardedRead<T, R>` types — no API change visible to handler authors.

### Multi-Agent Execution Plan

Per ADR-0180/0181 precedent and `feedback-council-queen-da-alongside-experts` / `feedback-always-use-agent-teams`:

| Phase | Agents | Strategy | Exit gate |
|---|---|---|---|
| ADR-0230 Phase 1 (Phase 1 take + Phase 7 take) | queen + DA + 2 workers | parallel | `npm run release` passes; `MemoryService` exported; ruvector.db CI smoke passes |
| ADR-0230 Phase 2 (Phase 3 take + Phase 5 take + Phase 6 take) | queen + DA + 3 workers | parallel | `npm run release` passes; HNSW restart-restore test passes; FTS5 fallback test passes; bench baseline runs |
| ADR-0230 Phase 3 (Phase 4 adapter) | queen + DA + 1 worker + 1 verifier | specialized | `npm run release` passes; consolidator runs under Archivist; audit-chain count = mutation count |
| ADR-0230 Phase 4 (Phase 2 adapter) | queen + DA + 2 workers + 2 verifiers | specialized | `npm run release` passes; `(svc as any).backend instanceof HybridBackend` true; IMemoryBackend round-trip test passes for all 7 methods |
| ADR-0230 Phase 5 (re-converge verification) | queen + DA + 1 verifier | star | `npm run release` passes; ADR-0180 audit-chain replay test passes; ADR-0228 Batch S source-conflict deferral rows re-disposed |

Each phase runs as a separate background agent batch; sequential by exit gate. Phase 5 closes both ADR-0230 (status: implemented) and the substrate-related portion of ADR-0228.

## Out of scope

1. **ADR-181 Archivist activation phases**: continue on their own timeline (ADR-0181 is in Phase 4 — cli-process-backend handler un-stub). This ADR only specifies how the re-converged substrate is consumed by the Archivist, not the activation work itself.
2. **Pglite/postgres revival**: ADR-0170/0174/0175 stay superseded. Phase 2's HybridBackend is `SQLite + AgentDB` only.
3. **Upstream's `agentdb` future PostgreSQL extension** (per `ruvnet/agentdb:ADR-006`): out of scope until it ships with `.rvf` segment IO.
4. **ADR-0125 phases beyond 7** that ship after this ADR opens: handled as a follow-up amendment, not this ADR.
5. **Other Batch S source-conflict deferrals** (24 total): the 5 ADR-125 picks are re-disposed by this ADR. The other 19 stay deferred per ADR-0228 unless individually re-evaluated.

## Open questions

1. Does upstream's `HNSW\x01` magic clash with any fork RVF segment magic? Verify pre-Phase-3 land.
2. Does fork's `@sparkleideas/agentdb` package export the exact `IMemoryBackend` shape upstream's bundled-AgentDB expects? Verify pre-Phase-2 land via type-level diff.
3. The Archivist's `MutationContext` currently constructs `AgentDBAdapter` (the legacy class). Post-Phase-1, does the rename to `MemoryService` cascade through the Archivist's factory cleanly? Audit needed.
4. Phase 4's adapter disables upstream's 6h `setInterval` timer. The Archivist's `runMaintenance` cadence policy is currently undefined — this ADR defers the policy to ADR-0181 Phase 5 (`cli delegation`) which is where maintenance triggers naturally live.

## More information

* **Upstream ADR-125**: at upstream commit `4e9a33ce` for Phase 1; subsequent phases follow chronologically through `7dd4b525`.
* **Fork ADR-0180**: the Archivist architectural decision (substrate-orthogonal layer above MCP).
* **Fork ADR-0181**: the Archivist activation execution plan (7 phases).
* **Fork ADR-0177**: the substrate alignment with upstream RVF-first vision.
* **Fork ADR-0228**: the upstream sync runbook; Batch S source-conflict deferral re-disposed by this ADR for the 5 ADR-125 picks.
* **`feedback-no-fallbacks`**: half-deferred substrate violates this — re-converge or commit to permanent divergence.
* **`feedback-trace-before-hypothesis`**: per-commit reading of the 5 ADR-125 picks was what reversed the deferral disposition.

## Amendments

### 2026-05-23 — All 7 phases landed; status → implemented

All 7 phases of upstream ADR-125 are now on `forks/ruflo/main`. Per-phase
landing SHAs (upstream → fork):

| Phase | Disposition | Upstream SHA | Fork SHA | Step |
|---|---|---|---|---|
| Phase 1 (MemoryService canonical) | TAKE | `4e9a33ce2` | `402786f16` | C |
| Phase 2 (HybridBackend wire) | ADAPT | `11eaef851` | `fe682324b` | F |
| Phase 3 (HNSW snapshot/restore) | TAKE | `81a2b23eb` | `7fefa0c3e` | D |
| Phase 4 (MemoryConsolidator) | ADAPT | `850450f38` | `a68817f6b` | E |
| Phase 5 (FTS5 fallback) | TAKE | `8773fcffd` | `7f3e15334` | D |
| Phase 6 (benchmarks) | TAKE | `ed95d6782` | `f1ccba609` | (Batch S) |
| Phase 7 (RuVector cleanup) | TAKE | `7dd4b5252` | `ebcbba949` | (Batch S) |

Phases 6 + 7 were already landed via ADR-0228 Batch S background agent
work (`f1ccba609` and `ebcbba949`); this ADR's execution covered the
deferred Phases 1-5.

#### Adapter divergences (vs upstream verbatim)

- **Phase 1** — fork removes `RvfBackend` + `HnswLite` from the top-level
  `@sparkleideas/memory` export surface but keeps them as internal modules
  reachable via explicit subpath (`@sparkleideas/memory/rvf-backend`) or
  `createDatabase({provider:'rvf'})`. Adapted `index.test.ts` to skip the
  `SqlJsBackend` (not vendored on fork — better-sqlite3 native is primary)
  and `HybridBackend` top-level-surface assertions per fork's narrower
  surface invariant (ADR-0065 + ADR-0076).
- **Phase 2** — vendored upstream's `hybrid-backend.ts` (789 lines) to
  fork. Expanded `DatabaseProvider` type union with `'hybrid' | 'agentdb'`.
  Added the two new cases to `createDatabase`'s switch. Fork dim default
  kept at 768 (mpnet) instead of upstream's 1536. `createHybridService`
  flows through `createDatabase({provider:'hybrid'})` + `service.withBackend()`.
- **Phase 3** — restored `hnsw-lite.ts` as fork-internal module (Phase 3
  inlined it into rvf-backend.ts and deleted the file; fork keeps the
  separate module per ADR-0177 internal-plumbing carve-out). The inlined
  Phase 3 helper code in rvf-backend.ts is also present (additive on fork).
- **Phase 4** — `consolidator.autoRun` default left undefined; the 6h
  `setInterval` timer is never started by default. The standalone-timer
  architecture upstream introduced is disabled on fork via config rather
  than a code edit. Replaces the requirement in `feedback-no-fallbacks`'s
  spirit: don't activate an autonomous timer that the Archivist (ADR-0180)
  should be the coherent owner of.

#### Test-harness adaptations (ruflo-patch)

- `lib/acceptance-adr0177-checks.sh` — probe imports `RvfBackend` from the
  explicit subpath (`@sparkleideas/memory/rvf-backend`) post-Phase-1.
- `lib/acceptance-adr0090-b1-checks.sh` + `lib/acceptance-adr0090-b2-checks.sh`
  — same subpath import fix.
- `tests/unit/adr0086-rvf-integration.test.mjs` — hnsw-lite read path
  unchanged after fork restored the file.
- `tests/unit/adr0076-phase0-1.test.mjs` — Phase 0 "dead code removed"
  test suite re-described as "ADR-0076 Phase 0 (superseded by ADR-0230
  invariant #5)". The hybrid-tier file MUST exist post-Phase-2; only
  `database-provider.ts` (the wire point) may reference HybridBackend;
  the top-level surface still must not.

#### Invariants verified post-landing

1. **Two-layer separation**: substrate work below MCP, Archivist coordination
   above MCP. No upstream commit introduced coordination above MCP that
   bypasses the Archivist. ✓
2. **Type enforcement of substrate seam**: ADR-0180 §Architecture's path
   restriction preserved. Phase 2's hybrid-tier backend is exposed only
   through `MutationContext.substrate` (per ADR-0181 in-flight design). ✓
3. **No pglite/postgres revival**: `grep -RE "^import.*pglite|^import.*@electric-sql" forks/ruflo/v3/@claude-flow/memory/src/` returns zero. (Type annotations referencing pglite as a `primaryStorage` choice on agentdb-backend.ts are not imports — those values are never instantiated on fork.) ✓
4. **Fork-only public surface preserved**: `@sparkleideas/memory` top-level
   surface still excludes `HnswLite`, `RvfBackend`, `HybridBackend`,
   `HybridBackendConfig`, `SqlJsBackend`. Fork's `prepublishOnly`
   forbidden-list enforces this. ✓
5. **Audit-chain replay equality**: ADR-0180 §Confirmation's replay test
   passes against the re-converged substrate (acceptance suite includes
   the relevant probes; 0 failures). ✓

#### Acceptance baseline

| Snapshot | Pass | Fail | Skip |
|---|---:|---:|---:|
| Pre-ADR-0230 (after steps A + B) | 688 | 0 | 9 |
| Post-step C (Phase 1 landed) | 688 | 0 | 9 |
| Post-step D (Phases 3 + 5 landed) | 688 | 0 | 9 |
| Post-step E (Phase 4 landed) | 688 | 0 | 9 |
| Post-step F (Phase 2 landed) | 688 | 0 | 9 |

Hard gate (`0 failures`) maintained at every phase boundary.

#### Out-of-scope items carried forward

- **The other 19 Batch S source-conflict deferrals** (24 total - 5 ADR-125
  phases re-disposed by this ADR) stay deferred per ADR-0228, awaiting
  individual re-evaluation.
- **ADR-0181 Archivist activation phases** continue on their own timeline.
  Phase 4 (`cli-process-backend handler un-stub`) will construct
  HybridBackend per the wiring in `createDatabase({provider:'hybrid'})`.

---
status: proposed
date: 2026-05-11
tags: [agentdb, controllers, orphan-wiring, quic, graph-algorithms, streaming-embeddings]
supersedes: []
depends-on: [ADR-0177]
implements: []
---

> **Status note (2026-05-28, swarm review)**: The "6 orphans, wire all"
> framing is **false on 5 of 6 counts at HEAD** (see §Amendment
> 2026-05-28). Mincut + Sparsification are already WIRED (real callers in
> `AttentionService.ts`); QUICConnection was never orphaned (consumed by
> `QUICClient`/`QUICServer`); QUICConnectionPool + QUICStreamManager were
> DELETED by ADR-0217 (vindicating ADR-0206) and ADR-0265 C7.a/b now
> ENFORCE they must not exist — wiring them would violate two accepted
> ADRs. The federation/QUIC capability this ADR wanted shipped via
> ADR-0265 (native QUIC transport). **Only StreamingEmbeddingService
> remains a genuine orphan** — and its disposition is WIRE-against-a-
> named-consumer-or-DELETE, gated by the new Phase 0. `depends-on`
> corrected `ADR-0166` (superseded two hops down: 0166→0170→0177) →
> `ADR-0177`.

# Wire orphan controllers — MincutService, SparsificationService, StreamingEmbeddingService, QUIC connection layer

## Status

**Proposed (2026-05-11).** Activates the QUIC connection layer per the
`// TODO: ADR required before activation — ADR-0161 lift, no production
wiring` markers at `QUICConnection.ts` and `QUICConnectionPool.ts`. Wires
in five additional orphan controllers identified by the 2026-05-11 audit.

## Context and Problem Statement

A 2026-05-11 audit of `forks/agentdb/src/controllers/*.ts` against actual
import sites (across both `forks/agentdb/src/` and `forks/ruflo/v3/`) found
**6 controllers with zero imports anywhere** — they ship in the build, they
type-check, they're shipped on Verdaccio in every patch release, but no
consumer reaches them. Two of them carry an explicit `// TODO: ADR required
before activation` comment from ADR-0161's lift; the other four were never
explicitly gated, just never wired.

| Controller | Lines | Origin | Purpose | Wiring comment |
|---|---|---|---|---|
| MincutService | 434 | upstream + fork | Stoer-Wagner / Karger / max-flow mincut for graph partitioning; "50-80% memory reduction through dynamic graph partitioning" | None — silently unwired |
| SparsificationService | 492 | upstream + fork | PPR + random-walk + spectral sparsification; "10-100x speedup for large graphs" | None — silently unwired |
| StreamingEmbeddingService | (file size n/a) | fork-only | Incremental embedding generation (chunk-by-chunk over large texts, ADR-065 P1-3) | None — silently unwired |
| QUICConnection | (file size n/a) | fork-only | 0-RTT QUIC connection with BBR congestion control + connection migration | `// TODO: ADR required before activation — ADR-0161 lift, no production wiring` |
| QUICConnectionPool | (file size n/a) | fork-only | Pool of 10 QUICConnections per endpoint; reuse + idle detection + drain/shutdown | `// TODO: ADR required before activation — ADR-0161 lift, no production wiring` |
| QUICStreamManager | (file size n/a) | fork-only | QUIC stream multiplexing on top of the connection layer | None |

This is dead capability — code that ships, doesn't run, and accumulates
bitrot. Per `feedback-no-value-judgements-on-features` ("wire all upstream
capability"), the answer isn't to delete these; the answer is to wire them.
The QUIC TODO comments specifically request an ADR before activation; this
ADR is that activation gate.

## Decision Drivers

* **`feedback-no-value-judgements-on-features`** — the fork wires the full
  capability surface and lets consumers pick what they use. "Not yet wired"
  isn't a judgement on usefulness; it's a wiring gap.
* **`feedback-no-fallbacks`** — wiring should fail loud. If a controller's
  dependency is missing (e.g., WASM accelerator absent), the controller
  should throw loudly, not silently degrade.
* **Explicit ADR-required gate** — the QUIC controllers carry literal
  `// TODO: ADR required before activation — ADR-0161 lift, no production
  wiring` comments. ADR-0161 (the agentdb extraction) was the lift; ADR-0171
  is the corresponding activation.
* **No conflict with ADR-0170** — all 6 orphans are SQL-less (verified by
  the 2026-05-11 grep: `this.db.(prepare|exec|run)|CREATE TABLE|INSERT INTO|
  SELECT.*FROM` returns zero hits in each). The substrate replacement
  (postgres) doesn't touch them. ADR-0171 can land before, during, or after
  ADR-0170's phases — they're orthogonal.

## Considered Options

* **Option A** — Wire all 6 orphans. Make each reachable via
  `AgentDB.getController()` and ruflo's controller-registry where
  appropriate. Integrate each into at least one real consumer path.
  Acceptance test asserts reachability + non-trivial roundtrip for each.
* **Option B** — Wire only the QUIC three (they have explicit
  `// TODO: ADR required` markers). Leave the other three (Mincut,
  Sparsification, StreamingEmbedding) as orphan code until a concrete
  consumer demand emerges.
* **Option C** — Delete the orphans. The code doesn't run today and isn't
  expected to run; remove it. Conflicts with `feedback-no-value-judgements-
  on-features`.
* **Option D** — Status quo. Keep the orphans shipped but silently unwired.
  Accumulates bitrot.

## Decision Outcome

Chosen: **Option A — wire all 6 orphans**.

Rationale:

1. **The fork's wiring posture is consistent.** Per
   `feedback-no-value-judgements-on-features`, the fork wires all upstream
   capability rather than gating on "is this useful right now?". MincutService
   and SparsificationService are upstream packages; StreamingEmbeddingService
   is a fork ADR-065 deliverable; QUIC* are fork networking infrastructure.
   All are legitimate capability worth exposing.
2. **The QUIC TODO comments are unambiguous.** They literally ask for an ADR
   before activation. Option A provides it; the alternative is to leave the
   TODO comments live indefinitely.
3. **Deleting (Option C) is irreversible and would re-litigate when the
   capability is needed.** Wiring is reversible (a controller can be
   deprecated later) and gathers usage data for that future decision.
4. **Bitrot risk under status quo (Option D).** Orphan code drifts: type
   signatures change in adjacent code, internal helpers get refactored,
   the orphan stops compiling silently. The fork's typed acceptance suite
   catches these only when a consumer exists. Wiring creates that consumer.

### Phased plan

**Phase 1 — `AgentDB.getController()` accessors (TRIVIAL, ~30 LoC total).**

Add lazy-init case statements in `forks/agentdb/src/core/AgentDB.ts`:

```ts
case 'mincut':
case 'mincutService':
  return (this.mincutService ??= new MincutService({ /* default config */ }));

case 'sparsification':
case 'sparsificationService':
  return (this.sparsificationService ??= new SparsificationService({ /* default config */ }));

case 'streamingEmbedding':
case 'streamingEmbeddingService':
  return (this.streamingEmbeddingService ??= new StreamingEmbeddingService({ /* default config */ }));

case 'quicConnection':
  return new QUICConnection({ endpoint: /* config */ });

case 'quicConnectionPool':
  return (this.quicConnectionPool ??= new QUICConnectionPool({ /* default config */ }));

case 'quicStreamManager':
  return (this.quicStreamManager ??= new QUICStreamManager({ /* default config */ }));
```

Each new field on `AgentDB` is lazy and side-effect-free until first
accessed.

**Phase 2 — Integration points (per-controller, ~50-100 LoC each).**

Wire each orphan into at least one real consumer:

1. **MincutService** → expose as a graph-partitioning utility for
   `CausalMemoryGraph.getCausalChain` traversals. When a causal chain
   query crosses a partition boundary, consult mincut for the optimal
   split. Falls back to current behavior when the WASM/NAPI accelerator is
   unavailable (loud-error per `feedback-no-fallbacks` only if explicitly
   opted in via config).
2. **SparsificationService** → integrate with `NightlyLearner`'s
   consolidation step. Large episodic graphs get sparsified before
   pattern extraction, reducing GROUP BY workload. PPR scoring informs
   which patterns survive consolidation.
3. **StreamingEmbeddingService** → expose at the memory-router layer
   for large-document ingestion (per ADR-065 P1-3's original intent).
   `memory store --key X --file large.md` chunks the file and streams
   embeddings rather than holding the whole text in memory.
4. **QUICConnection + QUICConnectionPool + QUICStreamManager** → wire as
   `QUICServer`'s transport layer. `QUICServer` currently mocks its
   networking; with these three wired, server-to-server agentdb sync
   becomes real. The TODO comments at `QUICConnection.ts` and
   `QUICConnectionPool.ts` reference exactly this activation.

**Phase 3 — Acceptance tests (one per controller, ~20 LoC each).**

Each commit lands with a contract test in
`forks/agentdb/tests/adr0171-orphan-wiring-<controller>.test.ts`:

- `db.getController('mincut')` returns a `MincutService` instance.
- Calling its primary method (`mincut.computeMincut(graph)`) returns a
  partition without throwing.
- Similar for the other 5.

For QUIC*, the acceptance test spins up a `QUICServer` against a
`QUICConnectionPool` instance and roundtrips a single sync request.

### Out of scope

1. **Performance benchmarking** of the new wirings (separate effort,
   tracked under ADR-0094 if pursued).
2. **Removing existing fallback paths** that bypass these controllers
   (e.g., CausalMemoryGraph's non-mincut traversal). MincutService
   becomes one option; the existing path stays for environments where
   the WASM/NAPI accelerator is unavailable.
3. **Cross-environment portability concerns** for QUIC*. QUIC requires
   UDP, which doesn't work in some restricted environments (some serverless
   runtimes, browsers without WebTransport). Out-of-scope here; QUIC*
   stays opt-in via explicit consumer wiring.
4. **Coordination with upstream** on MincutService / SparsificationService.
   Both exist upstream and are also unwired there. Per
   `feedback-no-upstream-donate-backs`, the fork doesn't push wiring back.

### Consequences

* Good, because the fork's published capability surface matches its
  actually-reachable capability surface. No more shipped-but-unwired
  controllers.
* Good, because the QUIC `// TODO: ADR required` markers get resolved
  cleanly rather than living as code-rot.
* Good, because bitrot risk drops — each controller now has a consumer
  that drives type-check + acceptance coverage.
* Good, because each orphan gets a reachability gate (contract test),
  catching breakage early in future refactors.
* Bad, because each Phase 2 integration is its own design decision (where
  exactly does MincutService plug into CausalMemoryGraph? what's the
  config knob?). Each commit must justify its integration point against
  the controller's stated purpose, not just slot it in for the sake of
  wiring.
* Bad, because QUIC adds operational surface (UDP, certificates, NAT
  traversal). Phase 2 wiring stays opt-in via explicit consumer config —
  no auto-enable.
* Neutral, because the orphan controllers are SQL-less (verified). ADR-0170's
  substrate replacement doesn't touch them; ADR-0171 can land in any order
  relative to ADR-0170's phases.

### Confirmation

Compliance is verified by:

1. **Phase 1 completes** when `db.getController('mincut')`,
   `'sparsification'`, `'streamingEmbedding'`, `'quicConnection'`,
   `'quicConnectionPool'`, `'quicStreamManager'` all return instances
   without throwing.
2. **Phase 2 completes** when each controller has at least one consumer
   that calls a non-trivial method (not just `new ControllerService(...)`).
3. **Phase 3 completes** when each contract test in
   `tests/adr0171-orphan-wiring-*.test.ts` passes in the acceptance suite.
4. **The `// TODO: ADR required before activation` comments are removed**
   from `QUICConnection.ts` and `QUICConnectionPool.ts` in Phase 2.

### Reopen triggers

ADR-0171 promotes to `accepted` when Phase 3 lands green. The wiring
question reopens when:

1. **Any wired controller becomes incompatible with ADR-0170's postgres
   substrate** — currently none has SQL state, so none should; revisit if
   integration introduces SQL needs.
2. **A wired controller is found to be load-bearing on a feature** (good
   signal — graduate to non-orphan status, update this ADR's wiring
   description).
3. **A wired controller becomes unmaintainable** (bad signal — separate
   deprecation ADR per `feedback-no-value-judgements-on-features` exception
   — judgements about deprecation are allowed when maintenance cost is
   measurable).

## More Information

### Orphan-controller audit (2026-05-11)

The audit ran `grep -rln "from.*controllers/<Name>\b" forks/agentdb/src/
forks/ruflo/v3/` for each controller in `forks/agentdb/src/controllers/`.
Zero-import controllers are this ADR's targets. Audit method recorded
here so future runs reproduce.

| Controller | Imports anywhere | Status |
|---|---|---|
| MincutService | 0 | Orphan |
| SparsificationService | 0 | Orphan |
| StreamingEmbeddingService | 0 | Orphan |
| QUICConnection | 0 | Orphan (TODO: ADR required) |
| QUICConnectionPool | 0 | Orphan (TODO: ADR required) |
| QUICStreamManager | 0 | Orphan |
| AttentionService | 6 | Live (heavily used) |
| WASMVectorSearch | 7 | Live (heavily used) |
| MemoryController | 2 | Live |
| ContextSynthesizer | 1 | Live |
| MetadataFilter | 1 | Live |
| MMRDiversityRanker | 1 | Live |
| QUICClient | 1 | Live (used by QUICServer) |

### Local ADRs

| ADR | Title | Role for ADR-0171 |
|---|---|---|
| **0161** | Consolidate agentdb onto 5th fork | The "lift" referenced by QUIC* TODO comments. ADR-0171 is the corresponding activation |
| **0166** | AgentDB persistence — axis-separated dual-storage with Option F | Orthogonal — substrate axis; ADR-0171 wires SQL-less controllers |
| **0170** | AgentDB substrate replacement — PostgreSQL primary | Orthogonal — postgres replacement; ADR-0171's targets have no SQL state, so unaffected |
| **0094** | 100% acceptance coverage plan | ADR-0171's Phase 3 contract tests register under ADR-0094's living tracker |

### Relationship to upstream

MincutService and SparsificationService exist in standalone
`ruvnet/agentdb@3.0.0-alpha.14` as well. They are unwired upstream
(zero imports in upstream's own codebase). ADR-0171's wiring is fork-side
only per `feedback-no-upstream-donate-backs`; if upstream eventually
wires them, the fork's wiring can be checked for divergence (different
config defaults, different integration points) in a follow-up sync ADR.

The four fork-only orphans (StreamingEmbeddingService, QUICConnection,
QUICConnectionPool, QUICStreamManager) have no upstream counterpart;
wiring them is a fork-only decision with no upstream-tracking concern.

## Amendments

### Amendment: Status reconciliation (2026-05-18) — partial implementation

Status kept `proposed` per the 2026-05-18 ADR status audit.

**Landed (per `project-fork-only-controllers` memory + restoration
commits on `forks/agentdb`):**

- **MincutService, SparsificationService, StreamingEmbeddingService**
  wired via commit `f790426` on `forks/ruflo` (controller-registry
  hookup).
- **HierarchicalMemory** (commit `599106b`), **MemoryConsolidation**
  (`4295d7a`), **RVFOptimizer** (`9733a08`),
  **SonaTrajectoryService**, **SemanticRouter**, **GNNService**,
  **GraphTransformerService** (all in `9733a08`) restored from
  snapshot `bd760f2` and consumed via the controller-registry.

**Deferred / open:**

- **Release-verification status post-`f790426`** — whether the
  MincutService / SparsificationService / StreamingEmbeddingService
  wiring was end-to-end verified by an `npm run release` acceptance
  run after the commit landed has not been recorded here. The
  controllers ARE wired (registry hookup) but the
  exercise-via-acceptance gate is not confirmed in this ADR.
- **QUICConnection / QUICConnectionPool / QUICStreamManager** —
  restored as scaffolding only (commit `1210a90`), zero current
  consumers, `// TODO: ADR required before activation` markers
  preserved. Activation gated on a distributed-mode ADR (not yet
  filed).

Reconciled as part of the 2026-05-18 status audit.

## Amendment: Swarm-review reconciliation (2026-05-28)

A 2026-05-28 swarm review verified each controller against current HEAD
(grep + file-existence + cross-ADR enforcement). The "6 zero-import
orphans, wire all" inventory is wrong on 5 of 6 counts:

| # | Controller | Verified disposition |
|---|---|---|
| 1 | MincutService | **WIRE — already wired.** Real consumer: `AttentionService.ts:962` `partition(...)` + `:965` `getPartitionStats(...)`. AttentionService is constructed by live controllers (NightlyLearner, ExplainableRecall, CausalMemoryGraph). Not an orphan. |
| 2 | SparsificationService | **WIRE — already wired.** `AttentionService.ts:841` `sparsify(...)` + `:822/:825`. Same live chain. |
| 3 | StreamingEmbeddingService | **GENUINE ORPHAN — fabrication risk.** `index.ts:69-70` exports it with the comment "Zero in-tree consumers today … restored to preserve future-wiring optionality." The Phase 2 `memory store --file` proposal is unimplemented and is exactly the fabricate-a-caller trap. **The only live question this ADR retains.** |
| 4 | QUICConnection | **NOT orphaned.** Consumed by `QUICClient.ts:22` + `QUICServer.ts:21`; ADR-0217:258 keeps it; the `// TODO: ADR required` marker is already GONE from the file. |
| 5 | QUICConnectionPool | **DELETED → SUPERSEDED.** File does not exist. ADR-0217:253-254 carries forward ADR-0206's deletion; ADR-0265 C7.a/b (arch-test + forbidden-string guard) ENFORCE it must not exist. Wiring it violates two accepted ADRs. |
| 6 | QUICStreamManager | **DELETED → SUPERSEDED.** Same as #5. |

**Improvement 1 — new Phase 0 WIRE-vs-DELETE triage gate (blocking, before Phase 1).** The Confirmation criterion "Phase 2 completes when each controller has at least one consumer that calls a non-trivial method (not just `new ControllerService(...)`)" forbids the trivial fabrication but still implicitly mandates "find/build a caller" and never licenses DELETE. That relocates the orphan behind a contract test. Replace with: *for each controller, answer with corpus evidence (per `feedback-corpus-evidence-before-feature-work` + ADR-0210 implement/restore/delete): (a) does a real organic consumer already call a non-trivial method? → WIRE-confirmed, add only the missing test; (b) is there a concrete named in-flight demand? → WIRE against it; (c) neither? → **DELETE is the default.** Restoring "to preserve future-wiring optionality" is deferred dead code, not a wiring plan; manufacturing a consumer solely to pass a reachability test is forbidden.* A controller may enter Phase 1/2/3 only once Phase 0 returns WIRE with a named real consumer.

**Improvement 2 — supersede the QUIC portion.** Rows 4/5/6 are handed off: QUICConnection is live (never this ADR's to wire); QUICConnectionPool/QUICStreamManager are deleted-by-decision (ADR-0217/0206) and the capability shipped via ADR-0265. Remove Confirmation criterion #4 ("remove the `// TODO: ADR required` comments from QUICConnection.ts and QUICConnectionPool.ts") — QUICConnectionPool.ts no longer exists and QUICConnection.ts's marker is already gone, so the criterion is unsatisfiable as written.

**Improvement 3 — strip stale postgres/ADR-0170 framing.** Decision Drivers (~56-60), Consequences (~205-207), Reopen triggers (~229-231), and the Local-ADRs ADR-0170 row reference a superseded postgres substrate and a now-moot "orthogonal to postgres phases" argument. Repoint to ADR-0177 (RVF-first) / ADR-0230; the "SQL-less so orthogonal" reasoning is no longer load-bearing under single-file RVF.

**Improvement 4 — soften the "delete is irreversible / would re-litigate" rationale (~93-95).** ADR-0217 demonstrates the opposite is the project's actual posture: it deleted the two QUIC controllers on evidence, the deletion was vindicated, and ADR-0265 shipped the real capability via a cleaner path. Delete-then-reimplement-properly is a legitimate, observed outcome — not a bogeyman.

**Net live scope after this amendment**: Mincut + Sparsification = WIRE-confirmed (cite the AttentionService callsites; add the 2 missing contract tests if absent). QUIC three = superseded/handed-off. **StreamingEmbeddingService is the single remaining decision**, gated by Phase 0: WIRE against a named consumer, or DELETE.

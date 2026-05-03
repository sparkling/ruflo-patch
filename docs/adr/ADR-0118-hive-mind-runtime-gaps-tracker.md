# ADR-0118: Hive-mind runtime gaps tracker

- **Status**: Proposed (2026-05-02), **Living tracker** (per ADR-0094 pattern)
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — provides the verification matrix audit and the ship vehicle for gap annotations)
- **Related**: ADR-0104 (queen orchestration), ADR-0113 (plugin system), ADR-0114 (architectural model)
- **Scope**: Fork-side runtime work in `v3/@claude-flow/cli/src/` and `v3/@claude-flow/swarm/src/`. Per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in fork.

## Context

ADR-0116's verification matrix audited `hive-mind` upstream code against the USERGUIDE contract and surfaced 10 gaps where advertised features ship as documentation only. ADR-0116 is shippable as packaging now; closing the runtime gaps is independent work, factored out into per-task ADRs (ADR-0119 through ADR-0128). This document is the navigation index for that program.

## Decision

**Track 10 runtime gaps as discrete per-task ADRs (ADR-0119 through ADR-0128). This document is the index — no implementation details live here.** Each per-task ADR closes exactly one ⚠/✗ row from the ADR-0116 verification matrix and carries its own context, decision, file targets, acceptance criteria, and "promote to its own design ADR if" escalation rule.

Per `feedback-no-fallbacks.md` and `feedback-no-squelch-tests.md`, each Tn ships its tests in the same commit as the implementation. Annotation lift in ADR-0116's plugin README and per-command frontmatter is gated on green CI for that path — see §Annotation lifecycle below.

## Task index

| Task | ADR | Title | Matrix row closed | Risk | Depends on |
|---|---|---|---|---|---|
| T1 | [ADR-0119](ADR-0119-hive-mind-weighted-consensus.md) | Weighted consensus (Queen 3x voting power) | 3 voting modes | low | — |
| T2 | [ADR-0120](ADR-0120-hive-mind-gossip-consensus.md) | Gossip consensus protocol | 5 protocols (Gossip) | medium | — |
| T3 | [ADR-0121](ADR-0121-hive-mind-crdt-consensus.md) | CRDT consensus protocol | 5 protocols (CRDT) | medium-high | — |
| T4 | [ADR-0122](ADR-0122-hive-mind-memory-types-ttl.md) | 8 memory types with TTL | 8 memory types | medium | — |
| T5 | [ADR-0123](ADR-0123-hive-mind-memory-lru-wal.md) | LRU cache + SQLite WAL | LRU + WAL backend | medium | T4 |
| T6 | [ADR-0124](ADR-0124-hive-mind-session-lifecycle.md) | Session checkpoint/resume/export/import | Session management | medium | T4, T5 |
| T7 | [ADR-0125](ADR-0125-hive-mind-queen-type-runtime.md) | Queen-type runtime differentiation | 3 Queen types | low | — |
| T8 | [ADR-0126](ADR-0126-hive-mind-worker-type-runtime.md) | Worker-type runtime differentiation | 8 Worker types | low-medium | T7 |
| T9 | [ADR-0127](ADR-0127-hive-mind-adaptive-topology.md) | Adaptive topology autoscaling | Adaptive topology | high | T7 |
| T10 | [ADR-0128](ADR-0128-hive-mind-topology-runtime.md) | Swarm topology runtime behaviour | 5 swarm topologies | medium | T8, T9 |
| T11 | [ADR-0130](ADR-0130-rvf-wal-fsync-durability.md) | RVF WAL fsync durability (true power-loss survival) | follow-up to T5 | medium | T5 |
| T12 | [ADR-0131](ADR-0131-hive-mind-worker-failure-protocol.md) | Worker-failure prompt protocol (auto-status-transitions, retry, lineage) | carry-forward from ADR-0103/ADR-0109 Option E §6 | medium | T1 (soft — integration tests reach across consensus strategies) |
| T13 | [ADR-0108](ADR-0108-mixed-type-worker-spawns.md) | Mixed-type worker spawn mechanism (`--worker-types` CLI + MCP `agentTypes` schema + round-robin + validator wiring) | carry-forward from ADR-0108 (Accepted but unwired; `validateWorkerType` validator dead-code at `validate-input.ts:49-65`) | low-medium | T8 (soft — full integration test exercises ADR-0126 prose blocks per type) |

## Dependency graph

Notation: `Tn → Tm` means Tn depends on Tm (Tm must land first). Soft = cross-reference only, no hard ordering.

- T5 → T4
- T6 → T4, T5
- T8 → T7, T10 (soft, see ADR-0128 §Cross-task dependency posture)
- T9 → T7, T10
- T1, T2, T3 independent
- T4 independent
- T7 independent of all
- T10 independent
- T12 independent at contract level; T12 → T1 (soft, integration tests for failure-during-consensus paths)
- T13 independent at contract level; T13 → T8 (soft, integration test for ADR-0126 prose blocks rendered per spawned worker type)

Direction note (corrected 2026-05-02 per ADR-0128 §Cross-task dependency posture): the prior `T10 → T8, T9` line had the arrow reversed. T9 needs T10's per-topology dispatch surface to exist; T8 cross-references topology-aware worker prompts but does not require T10 to land first.

T12 added 2026-05-02 — carry-forward from ADR-0103/ADR-0109 Option E §6 worker-failure prompt protocol (no Tn assignment in the original tracker; surfaced by the comparison of older hive ADRs against the new T-series).

T13 added 2026-05-02 — carry-forward from ADR-0108 (Accepted but unwired): `--worker-types` CLI flag, MCP `hive-mind_spawn` `agentTypes: array<enum>` schema extension, round-robin distribution, `--type` mutex, wire-up of the existing `validateWorkerType` validator (currently dead code at `validate-input.ts:49-65`, zero callers per the verification on 2026-05-02). The spawn mechanism is orthogonal to T8's per-type runtime behaviour.

## Status

| Task | ADR | Status | Owner | Commit | Annotation lifted? |
|---|---|---|---|---|---|
| T1 | ADR-0119 | complete | Henrik (orchestrator merge after agent stall) | fork ca9e29e2c + ruflo-patch 74f29e7 | pending next materialise |
| T2 | ADR-0120 | complete | Henrik | fork 2839874b2 + ruflo-patch ccf2c62 | pending next materialise |
| T3 | ADR-0121 | complete | Henrik | fork 49a2786dd + ruflo-patch (this commit) | pending next materialise |
| T4 | ADR-0122 | complete | Henrik (orchestrator merge after agent stall) | fork ca9e29e2c + ruflo-patch 74f29e7 | pending next materialise |
| T5 | ADR-0123 | complete | Henrik | fork 8d423a346 + ruflo-patch b61811f | pending next materialise |
| T6 | ADR-0124 | complete | Henrik | fork 42d7ad606 + ruflo-patch (this commit) | pending next materialise |
| T7 | ADR-0125 | complete | Henrik | fork 0748ed9e9 (README) + 9db6978d5 (runtime, absorbed) + ruflo-patch 6de0736 | pending next materialise |
| T8 | ADR-0126 | complete | Henrik | fork 8d423a346 + ruflo-patch b61811f | pending next materialise |
| T9 | ADR-0127 | complete | Henrik | fork b45e8e471 (Phase 1 stub) + 4bc336ad5 (Phase 2 runtime) + ruflo-patch (this commit) | pending next materialise |
| T10 | ADR-0128 | complete | Henrik | fork 9db6978d5 + ruflo-patch d03a361 + 74f29e7 (re-wiring) | pending next materialise |
| T11 | ADR-0130 | complete | Henrik | fork 4bc336ad5 + ruflo-patch (this commit) | pending next materialise |
| T12 | ADR-0131 | complete | Henrik | fork 4e97ce259 + ruflo-patch (this commit) | pending next materialise |
| T13 | ADR-0108 | complete | Henrik | fork 8d423a346 + ruflo-patch b61811f | pending next materialise |

Status values: `open` | `in-progress` | `escalated-to-adr` | `complete`. When a task lands, fill in `Owner`/`Commit`, set status `complete`, and confirm the ADR-0116 plugin README annotation was removed by the next materialise run.

## Annotation lifecycle

As each Tn closes, two artifacts in ADR-0116's shipped plugin update automatically (via the next P1 materialise run):

1. **Plugin README** — the corresponding row drops from the `## Known gaps vs. USERGUIDE` table
2. **Per-command frontmatter** — the `implementation-status` field flips from `partial`/`missing` to `implemented` (or the field is removed entirely once all tracked Tns for that file are complete)

Per `feedback-no-fallbacks.md` and `feedback-no-squelch-tests.md`, **annotations must NOT be removed before implementation tests pass**. The materialise script reads this tracker's §Status table and only lifts annotations for Tns marked `complete`.

## Open questions

1. **T-task ordering**: nothing forces a specific order beyond the dependency edges. Pick whichever closes the highest-pain user-visible gap first.
2. **Cross-Tn refactoring**: if multiple Tns end up touching the same file in incompatible ways (e.g. T1, T2, T3 all extending `ConsensusStrategy` enum), batch them in dependency order rather than parallel.
3. **When to escalate to a design ADR**: each per-task ADR (ADR-0119 through ADR-0128) carries its own "Promote to own ADR if" criterion. Default is to keep the work inside its task ADR unless a design decision exceeds mechanical implementation.

## References

- Verification matrix audit: ADR-0116 §USERGUIDE-vs-implementation verification matrix
- Plugin packaging: ADR-0116
- Living tracker pattern: ADR-0094 (100% acceptance coverage program)
- Per-task ADRs: ADR-0119, ADR-0120, ADR-0121, ADR-0122, ADR-0123, ADR-0124, ADR-0125, ADR-0126, ADR-0127, ADR-0128
- Review-notes triage: [ADR-0118-review-notes-triage.md](ADR-0118-review-notes-triage.md) — consolidates open questions surfaced during MADR/SPARC critique of ADR-0119–ADR-0128
- Execution plan: [ADR-0118-execution-plan.md](ADR-0118-execution-plan.md) — wave-based implementation plan for T1-T11 using parallel agent swarms (3 waves, peak 5 agents in flight)
- All Henrik decisions resolved 2026-05-02 — see ADR-0118-review-notes-triage.md §Resolution log
- USERGUIDE Hive Mind contract: substring anchor `<summary>👑 <strong>Hive Mind</strong>` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`
- Architectural constraints: ADR-0114 (substrate/protocol/execution layering)
- Storage backend constraints: `project-rvf-primary` memory, ADR-0086 Debt 7

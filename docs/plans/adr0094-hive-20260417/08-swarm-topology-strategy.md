# Swarm Topology Strategy — ADR-0094 → 100%

## Rule of thumb: hive vs swarm

**Confirmed, with a refinement.**

- **Hive (deliberation)** — when *alternatives matter* and the cost of picking
  wrong is re-work measured in days. Multi-expert voting, no code. Use for
  architecture rulings, ADR drafts, trade-off evaluations, plan review.
- **Swarm (execution)** — when *the plan exists* and the cost of picking wrong
  is a single revert. One coordinator, N implementers fan out. Use for writing
  N similar checks, codemods, parallel file edits.
- **Refinement**: a sprint can be **hive-then-swarm**. ADR-0094 canonical case:
  hive wrote plan (commit `8aa8cbc`), 15-agent swarm implemented (`66d3c3d`).

Evidence: 7-expert hive (this session) shipped 4 coordinated ADRs, zero
conflicts. 15-agent hierarchical-mesh (commit `add002f`) fixed 30 → 1 in one
pass. 8-agent fixall `swarm-1776370651103-qx7djp` (commit `09aed09`) fixed
ADR-0090 B5. 8-member hive-mind + 15-agent verification swarm paired on
ADR-0061.

## Per-sprint recommendations

### Sprint 0 — Prerequisites (manifest + catalog + helper)
**Swarm** · hierarchical · raft · 4 agents · high parallelism.
- `coordinator` · `manifest-impl` · `catalog-impl` · `helper-impl`.
- Three orthogonal files, no design disputes. Raft = single writer for manifest
  schema row. Same pattern as ADR-0090 Sprint 0 infra scaffolding.

### Sprint 1 — ADR-0095 t3-2 fix
**Hive-then-swarm** · hive=6-expert deliberation · swarm=6-agent hierarchical · raft.
- Hive first: D1–D6 must be ruled (02-adr0095 §Design Decisions). Without it
  implementer codes blind.
- Swarm (from 02-adr0095): coordinator, root-cause-investigator (SEQ 1),
  architect (SEQ 2), then parallel {implementer, adversarial-reviewer,
  probe+integration-tester}.
- Hierarchical not mesh: tight chain (reproduce → probe → fix → verify).

### Sprint 2 — ADR-0096 full catalog
**Swarm** · hierarchical · raft · 4 agents · 3 parallel tracks + 1 barrier.
- `catalog-impl` · `skip-reverify-impl` · `manifest-impl` · `adversarial-reviewer`.
- Plan from 03-adr0096: schema bootstrap SYNC first (5 min), then fan out 3
  scripts, reviewer owns barrier + acceptance checks.

### Sprint 3 — ADR-0097 helpers + lint + Tier X
**Swarm** · hierarchical · raft · 6 agents · 3 parallel tracks.
- `coordinator` · `canonical-helper-impl` · `migrator-impl` · `lint-rule-impl`
  · `tier-x-burn-impl` · `adversarial-reviewer`.
- Cross-cutting refactor pattern (grep-violations + codemod + lint). Matches
  prior 8-agent fixall at `09aed09`, scaled down. Raft = helper is SSOT.

### Sprint 4 — Phase 8 invariants (6+N similar checks)
**Swarm** · hierarchical · simple-majority · 5 agents · high parallelism.
- Roles fixed in 05-phase8: Impl A (INV-1,2,7) · Impl B (INV-3,4,5) · Impl C
  (INV-6,8,9,10) · adversarial · probe-writer.
- Simple-majority: invariants independent, no shared-writer. Closest prior: the
  15-agent ADR-0094 swarm at `66d3c3d` that built 27 check files in 3 min —
  same "many similar checks" shape, scaled down to 5 now that pattern is proven.

### Sprint 5 — Phase 9 concurrency (4+ races)
**Swarm** · hierarchical · raft · 6 agents · moderate parallelism.
- `coordinator` · 3× `race-impl` · `adversarial-reviewer` · `harness-impl`.
- Raft: all races exercise the RVF lock; harness needs one bootstrap. Smaller
  than Phase 8: race checks must avoid mutual temp-dir collisions.

### Sprint 6 — Phase 10 idempotency (4+ checks)
**Swarm** · hierarchical · simple-majority · 4 agents · high parallelism.
- `coordinator` · 3× `idempotency-impl` (run-twice-assert-equal).
- Identical shape to already-green Phase 4 boot/config idempotency. Lowest-risk
  sprint.

### Sprint 7 — Skip hygiene cleanup (55 checks)
**Swarm** · hierarchical-mesh · weighted-majority · 8 agents · very high parallelism.
- Mesh: 55 checks cluster into 4-5 ADR-bound families; intra-family coordination
  beats top-down dispatch.
- Weighted-majority: each cluster lead rates SKIP legitimacy; conflict default
  is "re-verify at acceptance, not planning".
- Precedent: `add002f` 15-agent fix-30 used hierarchical-mesh for exactly this
  heterogeneous-cluster shape.

### Sprint 8+ — Phases 11-17 backlog (budget-gated)
**Hive per-phase** for scoping (2-3 experts, simple-majority) **→ swarm per-
phase** for execution (3-6 agents, sized by invariant count). Prevents scope
creep past budget.

## Agent-count budget (per sprint, ≤15)

| Sprint | Agents | Why not bigger |
|-------:|:------:|----------------|
| 0 | 4 | 3 files, diminishing returns above. |
| 1 | 6 | Tight chain, more agents cause merge churn on `rvf-backend.ts`. |
| 2 | 4 | 3 independent scripts + 1 reviewer; fold per 03-adr0096. |
| 3 | 6 | 3 cross-cutting tracks + reviewer + coordinator. |
| 4 | 5 | Fixed by 05-phase8. |
| 5 | 6 | Concurrency needs design care; small coordinated team. |
| 6 | 4 | Simplest sprint; Phase-4-style replication. |
| 7 | 8 | 4-5 clusters + coordinator + reviewer + harness. Match `09aed09` 8-agent fixall. |
| 8+ | 2-6 | Size scales with invariant count. |

## Cross-sprint invariant

**Every swarm spawns in ONE message, `run_in_background: true`, then STOP.**
This is in CLAUDE.md (line "After spawning, STOP"). Prior swarms at commits
`66d3c3d` and `add002f` succeeded because nobody polled mid-flight. Sprint
leads must enforce.

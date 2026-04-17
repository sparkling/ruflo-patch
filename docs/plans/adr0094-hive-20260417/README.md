# ADR-0094 → 100% Coverage Execution Plan

**Produced**: 2026-04-17 by a 14-agent Ruflo-orchestrated hive (12 experts + Devil's Advocate + Queen synthesizer).

**Authoritative output**: [`queen-plan-synthesis.md`](./queen-plan-synthesis.md) — 7 sprints, 15-step orchestrator directive, final target 443/2/10 (≈97.4% verified).

## Index

| # | Paper | Scope |
|---|---|---|
| 01 | [sprint0-prerequisites](./01-sprint0-prerequisites.md) | Manifest + minimum catalog + `_expect_mcp_body` helper |
| 02 | [adr0095-impl-plan](./02-adr0095-impl-plan.md) | RVF inter-process fix (investigator-first discovery: stated fix may already be shipped) |
| 03 | [adr0096-impl-plan](./03-adr0096-impl-plan.md) | Catalog + skip hygiene (SQLite, 3-step sanitization, 5-probe taxonomy) |
| 04 | [adr0097-impl-plan](./04-adr0097-impl-plan.md) | Check-code quality program (helpers + lint + Tier X) |
| 05 | [phase8-invariants](./05-phase8-invariants-plan.md) | 10 cross-tool invariants + INV-11 delta-sentinel |
| 06 | [phase9-concurrency](./06-phase9-concurrency-plan.md) | 7 races + 100ms timing probe |
| 07 | [phase10-idempotency](./07-phase10-idempotency-plan.md) | 8 idempotency targets |
| 08 | [swarm-topology](./08-swarm-topology-strategy.md) | Hive-then-swarm pattern; per-sprint agent mix |
| 09 | [parallelism-ci-gates](./09-parallelism-ci-gates.md) | DAG + 300s budget + CI gates |
| 10 | [risk-regression](./10-risk-regression-manager.md) | Per-sprint risk matrix + known-knowns |
| 11 | [skip-hygiene-finalpush](./11-skip-hygiene-finalpush.md) | 55 skips → 4 buckets (A/B/C/D) |
| 12 | [documentation-evolution](./12-documentation-evolution.md) | ADR lifecycle + `adr-lifecycle-check.mjs` |
| 13 | [devils-advocate](./13-devils-advocate-plan.md) | 8 attacks + 3 hard vetoes (all 3 upheld) |
| **—** | **[queen-plan-synthesis](./queen-plan-synthesis.md)** | **Load-bearing output** |

## Key rulings (summarized from Queen)

1. **Envelope shape**: strike ADR-0097's `{content:[{type:"text"}]}` assumption; use `awk '/^Result:/{f=1;next}f'` per Sprint-0's live-probing finding.
2. **ADR-0095 investigator-first**: stated `mergePeerStateBeforePersist` fix may already be shipped; implementer blocked until architect amendment.
3. **All 3 DA vetoes upheld**: no ADR-0098+ until 0094 Implemented; cap sub-0094 swarms at 8; ship line 85% verified + 100% invoked (not 80%).
4. **Fork-patch ceiling**: N=30 soft (requires upstream PR attempt + 14-day timeout), N=50 hard.
5. **Skip-reverify in cascade, not cron**: DA attack 7 upheld; cron dies silently per ADR-0088.
6. **Final projection**: 443/2/10 (97.4% verified), 180s cascade, 120s headroom.

## Sprint order (DAG)

```
S0 (prereqs)
  ├── S1 (ADR-0095 RVF)     ─┐
  └── S2 (ADR-0096 catalog) ─┤── S3 (ADR-0097 helpers+lint)
                              │          ├── S4 (Phase 8 invariants)
                              │          ├── S5 (Phase 9 concurrency) ← needs S1 stable
                              │          └── S6 (Phase 10 idempotency)
                              └──────────── S7 (skip hygiene final push) ← needs S4-S6 stable
```

Critical path: **S0 → S3 → {S4|S5|S6} → S7**. S1 can parallelize with S2/S3. S7 is LAST to avoid taxonomy churn.

## Shared-premise defenses (from §E of synthesis)

Prevents next "swarm declared fix, real test fails" (t3-2 10/10 lie pattern):

1. Probe-writer ≠ fix-writer, enforced via `scripts/check-probe-authorship.mjs` (Sprint-0).
2. Investigator-phase precedes implementer in S1+; architect amendment is the gate.
3. Meta-regression probe per sprint (INV-11, delete-helper, stub-tool, delete-ledger).
4. 3 consecutive cascades × 3 days before any ADR flips `Implemented`.
5. Adversarial-reviewer in every swarm; must produce ≥1 failing probe pre-signoff.
6. Skip-reverify INSIDE cascade, not cron.
7. ADR-0094-log.md is single source of truth; siblings cap `Implementation notes` at 200 lines.

## Usage

1. Reference [`queen-plan-synthesis.md`](./queen-plan-synthesis.md) §I (the 15-step directive) for execution order.
2. Each numbered step names: which files, which ADR, which swarm profile, which gate.
3. Do NOT draft new ADRs (0098+) during execution — the synthesis explicitly forbids it per DA veto 1.
4. Progress against this plan is recorded in `docs/adr/ADR-0094-log.md` (append-only) per rule 4 of ADR-0094's Maintenance Manifesto.

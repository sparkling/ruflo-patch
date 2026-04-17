# ADR-0098: Execution Methodology for ADR-0094 → 100% Coverage

- **Status**: Proposed — 2026-04-17
- **Date**: 2026-04-17
- **Scope**: Process / governance — sprint ordering, swarm patterns, shared-premise defenses, ship-line criterion, fork-patch ceiling
- **Role**: Codifies the decisions from the 14-agent hive deliberation at `docs/plans/adr0094-hive-20260417/`. Not a scope ADR — does not add code, checks, or features.
- **Related**: ADR-0094 (parent — the plan this executes), ADR-0095 (RVF inter-process), ADR-0096 (catalog), ADR-0097 (check-code), ADR-0087 (adversarial prompting — source of out-of-scope probe rule), ADR-0082 (no silent fallbacks), ADR-0038 (cascade budget)

## Context

ADR-0094's Maintenance Manifesto rule 1 declares the parent ADR a **decision snapshot, not a living tracker**. Execution detail belongs elsewhere. At the same time, an unrecorded plan rots: implementers make inconsistent choices (topology, agent count, probe ownership, ship line), the DA's 8 attacks from the hive deliberation resurface, and we re-litigate decisions every sprint.

The 2026-04-17 hive (14 agents, `hive-1776442838506-f29vl8`) produced a synthesis that ruled on these decisions. This ADR codifies the rulings so they are enforceable — via preflight scripts, lint rules, and status-gate criteria — rather than merely written down.

### Relationship to DA Veto #1

The hive's Devil's Advocate issued a hard veto: "No ADR-0098+ drafted until ADR-0094 is Implemented" — on the grounds that 4 ADRs had been drafted in 36 hours with zero Implemented, evidencing ADR inflation. The Queen upheld that veto in §B of the synthesis.

**This ADR violates that veto by existing.** The violation is acknowledged, deliberate, and user-authorized (directive 2026-04-17: "create an ADR for this plan"). The justification, in order of weight:

1. The veto targets **new scope ADRs** (ADR-0094 attempted to catch bugs by adding features in 0095/0096/0097). This ADR **adds no scope** — it only codifies process already agreed by the hive. The inflation hazard does not apply.
2. The fork-patch ceiling (§Decision 6) and shared-premise defenses (§Decision 4) are enforceable only if codified. Leaving them in `/docs/plans/*.md` alone means future sessions can ignore them.
3. The veto is an advisory from the hive, not a policy precondition. User judgment supersedes.

**Self-binding guardrail**: this ADR carries a built-in sunset. It closes when ADR-0094 reaches `Implemented` — at which point its content either merges back into ADR-0094 §Maintenance Manifesto (rules that remain permanent) or archives (rules specific to the 0094 push). See §Acceptance.

## Decision

Adopt the Queen's synthesis at `docs/plans/adr0094-hive-20260417/queen-plan-synthesis.md` as the authoritative execution plan. The following decisions are **binding** until ADR-0094 flips `Implemented`:

### Decision 1 — Sprint DAG

```
S0 (prereqs)
  ├─ S1 (ADR-0095 RVF)          ──┐
  ├─ S2 (ADR-0096 catalog)      ──┤
  └─ S3 (ADR-0097 helpers+lint) ──┤── S4 (Phase 8 invariants)
                                   ├── S5 (Phase 9 concurrency)   ← S1 stable
                                   └── S6 (Phase 10 idempotency)
                                              ↓
                                           S7 (skip hygiene)      ← S4-S6 stable
```

Critical path: **S0 → S3 → {S4|S5|S6} → S7**. No sprint may start before its pre-gate. No sprint advances to Implemented before its post-gate holds for **3 consecutive cascades across 3 calendar days** (Decision 5).

### Decision 2 — Hive-then-swarm pattern for design-first sprints

Sprints where alternatives matter (design decisions with >1 plausible path, fork source that may already be fixed, protocol-level changes) MUST run a hive-style deliberation BEFORE the implementation swarm spawns. Canonical case: S1 (ADR-0095), where the stated `mergePeerStateBeforePersist` fix may already be shipped.

Sprints where execution dominates (many similar checks, established pattern) may skip the hive and use a swarm directly. Canonical case: S4 (10 cross-tool invariants following the same skeleton).

### Decision 3 — Investigator-first for S1 and any sprint where plan predates source inspection

S1 starts with a `root-cause-investigator` agent spawned ALONE. No implementer spawns until the investigator rules on D1–D6 (the open sub-decisions in ADR-0095's hive paper) AND the architect posts an amendment. This deliberately violates the "one-message swarm spawn" rule from CLAUDE.md because the plan's stated failure mode is unverified against source.

### Decision 4 — Shared-premise defenses

To prevent the next "swarm declared fix; real test fails" event (documented precedent: t3-2 10/10 simulation vs. real test; earlier session: B7 in-process guard vs. inter-process CLI):

1. **Probe-writer ≠ fix-writer**, mechanically enforced. `scripts/check-probe-authorship.mjs` (to be written in S0) diffs `Co-Authored-By` on commits that co-locate `scripts/diag-*.mjs` with source-file changes. Preflight fails on violation.
2. **Investigator-first** (Decision 3) applies to any sprint whose plan predates source inspection.
3. **Meta-regression probe per sprint** — each new check family ships with a probe that would fail if the fix regressed. Examples: S4 = INV-11 delta-sentinel (fails if a tool silently no-ops); S5 = delete `_race_N_cli` → all 7 races must FAIL (fails if races are serialized); S6 = stub `memory_store` → all idempotency checks must FAIL; S7 = delete ledger → `skip-reverify --verify` must FAIL.
4. **3×/day × 3 days** stability before any ADR → Implemented (Decision 5).
5. **Adversarial-reviewer in every swarm**. Must produce ≥1 failing probe pre-signoff.
6. **Skip-reverify INSIDE cascade**, not cron. Per ADR-0088, out-of-band cron jobs die silently.

### Decision 5 — Ship line and stability bar

```yaml
ship_line:
  invoked_coverage == 100%    # every surface reached; skip_accepted counts
  AND verified_coverage >= 85%  # hardened from the 80% floor in ADR-0094
  AND fail_count == 0
  AND wall_clock_seconds < 300  # ADR-0038

stability_bar:
  3 consecutive cascade runs
  AND across 3 consecutive calendar days
  AND preflight drift-detection passes on all 3
```

The 85% verified floor (not 80%) comes from DA veto #3 upheld in the hive synthesis. It forces the final push to actually resolve skip_accepted rather than hide behind the slack.

### Decision 6 — Fork-patch ceiling

Fork patch count (entries in `docs/bugs/coverage-ledger.md` with `state ∈ {fix-committed, verified-green, closed, regressed}` AND `upstream_filed:` not a GitHub URL):

- **Soft cap N=30** — any new `fork-only` patch requires a `upstream_pr_url` OR `upstream_declined_reason` in its ledger entry. 14-day timeout after upstream PR filing before fork-only commit allowed.
- **Hard cap N=50** — no new `fork-only` patches; must upstream first.

**Enforcement**: `scripts/adr-lifecycle-check.mjs` rule (f) — preflight exits non-zero if fork-only count > 30 AND newest lacks `upstream_pr_url`. Not a commit hook (would block local dev); a preflight gate (fails the cascade).

**Rationale**: N=15 (DA's proposal) halts velocity. N=30 with forced-upstream-attempt keeps velocity while creating pressure to upstream the fixes rather than let them accumulate into a merge-tax mountain.

### Decision 7 — Sub-0094 swarm agent cap

Until ADR-0094 flips Implemented, no swarm/hive spawned in the ADR-0094 lineage (S0–S7) may exceed 8 concurrent agents. This is lower than the prior 15-agent swarms (commits `66d3c3d`, `add002f`) and deliberately so — DA attack 3 documented that larger swarms amplify confidence without amplifying correctness. Swarms cap-compliant with this decision: S0 (4), S1 (6), S2 (4), S3 (6), S4 (5), S5 (6), S6 (2), S7 (8).

### Decision 8 — No new ADRs in the 0094 lineage

No ADR numbered ≥ 0099 may be drafted before ADR-0094 reaches `Implemented`. If a new architectural decision surfaces during execution:

1. Check if it fits inside an existing ADR in the lineage (0094 / 0095 / 0096 / 0097) — extend there.
2. If not, add it to `docs/adr/ADR-0094-log.md` under a dated "Deferred architectural questions" subsection.
3. Once 0094 flips Implemented, deferred questions get their own ADRs.

This is the **self-restraining version** of DA veto #1. The DA wanted zero new ADRs. The hive wrote three (0095/0096/0097) because they already existed as stubs before the veto. ADR-0098 is the last. No ADR-0099+ until 0094 ships.

## Alternatives considered

### A. No ADR — just the docs/plans/ artifact

Rejected. Without a decision record, enforcement scripts can't reference a canonical rule-set, and future sessions will re-litigate.

### B. Extend ADR-0094 with these decisions

Rejected. ADR-0094's Maintenance Manifesto rule 1 declares it a frozen decision snapshot. Rewriting it every sprint defeats the whole point of the extraction to ADR-0094-log.md.

### C. Honor DA veto strictly; keep plan in docs/plans/

Rejected (by user directive). The plan is only enforceable if it carries ADR-grade authority for preflight + lint scripts to reference.

### D. Split into multiple small ADRs (one per decision)

Rejected. 8 decisions × 8 small ADRs × overhead = more inflation. One ADR with 8 sections is cleaner.

## Acceptance criteria

This ADR is `Implemented` when all of the following hold:

1. ADR-0094 has flipped to `Implemented` (which implies all of 0095/0096/0097 are Implemented and the ship line of Decision 5 holds).
2. `scripts/check-probe-authorship.mjs` exists and fires in preflight (Decision 4.1 enforced).
3. `scripts/adr-lifecycle-check.mjs` rule (f) is live (Decision 6 enforced).
4. Every sprint S0–S7 has a dated entry in `docs/adr/ADR-0094-log.md` with post-gate evidence (delta counts, probe pass, stability bar met).
5. No ADR numbered 0099+ exists in `docs/adr/`.

When all 5 hold, this ADR **sunsets**: move Decisions 1–3, 5, 7, 8 to `ADR-0094-log.md` §Archived execution rules; merge Decisions 4 and 6 (the enduring process rules) into `ADR-0087` §Addendum or ADR-0094 §Maintenance Manifesto as appropriate; mark ADR-0098 `Archived — decisions merged to parents`.

## Risks accepted

1. **Codifying a plan that turns out wrong**. Mitigation: ADR amendment on discovery. Early warning: any sprint's post-gate fails after 3 attempts → convene a mini-hive (3 agents, ≤30 min) to re-rule.
2. **Adding ADR inflation despite the disclaimer**. Mitigation: ADR-0098 is terminal (Decision 8); no 0099+ sibling. Early warning: any session-level desire to draft a new ADR halts; instead append to ADR-0094-log.md §Deferred.
3. **Fork-patch ceiling forces upstream PRs we don't have bandwidth for**. Mitigation: `upstream_declined_reason` is a valid escape hatch. Early warning: ledger shows ≥3 entries with "declined: no bandwidth" → revisit ceiling or dedicate one sprint to upstream-filing backlog.
4. **Sub-0094 8-agent cap slows sprints**. Mitigation: explicit acceptance that quality > velocity at this stage. Early warning: sprint wall-clock > 2× estimate → re-evaluate cap for the NEXT sprint only.
5. **Shared-premise defenses add swarm overhead**. Accept: defense is the point. Early warning: probe-writer-vs-fix-writer lint fires on a commit that's already merged → patch and re-run; count such events (target: 0 after Sprint 1).

## References

- Parent ADR: `docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md`
- Plan artifact: `docs/plans/adr0094-hive-20260417/queen-plan-synthesis.md`
- Plan artifact index: `docs/plans/adr0094-hive-20260417/README.md`
- Sibling ADRs in lineage: ADR-0095 (RVF), ADR-0096 (catalog), ADR-0097 (check-code)
- Methodology ancestor: ADR-0087 (adversarial prompting + out-of-scope probe addendum)
- Test-integrity foundation: ADR-0082 (no silent fallbacks)
- Budget constraint: ADR-0038 (300s cascade)
- Bug ledger: `docs/bugs/coverage-ledger.md`
- Queen's 15-step orchestrator directive: `docs/plans/adr0094-hive-20260417/queen-plan-synthesis.md` §I

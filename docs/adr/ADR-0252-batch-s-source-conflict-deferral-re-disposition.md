---
status: accepted
date: 2026-05-25
tags: [upstream-sync, source-conflict, deferral, batch-s]
supersedes: []
depends-on: [ADR-0228, ADR-0230, ADR-0233, ADR-0248, ADR-0251]
implements: []
---

# Batch S source-conflict deferral re-disposition

## Context and Problem Statement

[[ADR-0228]] (Batch T sync, 2026-05-23) deferred **24** upstream `ruvnet/ruflo` commits as "source-conflict deferrals" — upstream changes whose conflict-resolution couldn't be auto-resolved without per-commit manual triage. [[ADR-0230]] re-disposed 5 of those (the ADR-125 substrate phases), leaving 19.

[[ADR-0233]] §"Reviews still owed" carry-forwarded the 19 as item 2 with the trigger "re-eval on next upstream sync." Two days after the parent ADR landed, the carry-forward inventory was reviewed and three of its four items were either tackled (G-16-014 stress harness; archive/v2 skill-discovery prune) or factually corrected (sparse-attention Batch O — 5 SHAs already absorbed). The Batch S row was the last open item.

`ruvnet/ruflo` has had **zero new commits since 2026-05-23** per the local clone (HEAD at `ef73a1616`, 2026-05-12). The "next sync" trigger has not fired; waiting longer is not bringing new information. Authoring this re-disposition now (rather than holding indefinitely) closes the open item with current evidence.

## Decision Drivers

* **Stale-deferral hygiene.** The original ADR-0228 disposition was a procedural "defer for manual triage in follow-up session." This is that session. Indefinite deferral with no triggers means the question never closes.
* **Fork has moved on neural-trader.** [[ADR-0248]] + [[ADR-0251]] implemented a substantive rewrite of `ruflo-neural-trader`'s plugin description and skill content. The upstream commits we deferred targeted a SKILL.md surface the fork no longer maintains in upstream's framing.
* **Upstream quiescence.** No new ruvnet/ruflo commits since 2026-05-23. The "next sync" trigger has not fired; this re-disposition is what closes the carry-forward.
* **Per-family vs per-SHA granularity.** The 19 SHAs were enumerated by family in the original [[ADR-0228]] row, not individually; the per-SHA list lived in the background agent's transcript (`task abe01952896821c2a`) and is not in the corpus. Per-family disposition matches the evidence available.

## Considered Options

* **Option A — Per-family disposition (this ADR).** Walk the 19 by family (5 neural-trader, 2 github, 3 docs, 9 misc); assign supersede / defer / pull-pending / drop verdicts based on current fork state.
* **Option B — Bulk drop.** Mark all 19 dropped as "upstream conflict-resolution cost > integration value." Symmetric to [[ADR-0210]]'s stub-honesty mandate applied retroactively. Loses optionality.
* **Option C — Wait for next sync.** Hold the original ADR-0228 disposition. Re-eval when `ruvnet/ruflo` accumulates ≥N new commits or a directed-trigger fires. Risks accumulating bookkeeping debt indefinitely.
* **Option D — Spawn a per-SHA enumeration agent.** Use a long-running researcher agent to enumerate the 19 SHAs from the upstream branch + assign per-SHA verdicts. Higher fidelity; substantial cost; the per-family shape is good enough for the supersede-heavy family (neural-trader, 5 of 19).

## Decision Outcome

Chosen: **Option A — Per-family disposition.**

Rationale:

1. The fork has moved on the largest sub-family (neural-trader, 5 of 19) in a way that makes the upstream commits inapplicable — the supersede verdict is well-evidenced via [[ADR-0248]] + [[ADR-0251]].
2. The smallest sub-family (3 docs) is low-cost to pick on next sync; mark pull-pending, no current action needed.
3. The middle two families (2 github + 9 misc) remain genuinely uncertain — defer to per-commit triage when sync resumes.
4. Per-family granularity is the appropriate fidelity for the evidence currently in the corpus; per-SHA precision would require re-mining the original background-agent transcript and adds little signal over the per-family verdict.

## Per-family disposition

| # | Family | Count | Disposition | Reasoning |
|---|---|---|---|---|
| 1 | ADR-126 neural-trader Phases 1-4 + 6 | **5** | **SUPERSEDE → [[ADR-0248]]** | Fork's Batch 3 ([[ADR-0248]]) rewrote the `ruflo-neural-trader` plugin description from "112+ MCP tools" overclaim to honest "6 skills scaffolding `npx neural-trader` CLI." [[ADR-0251]] closed the DA dissent affirmatively. Upstream Phases 1-4+6 targeted SKILL.md content the fork no longer maintains in upstream's framing; picking them would re-introduce the overclaim ADR-0248 excised. The marketplace-integrity lint baseline (commit `05a700c`) further gates regression. |
| 2 | ADR-127 github surface Phase 2 + completion | **2** | **DEFER** (next sync) | github agent .md frontmatter conflict. Fork still maintains divergent github agent files per the original [[ADR-0228]] rationale. Fork hasn't moved on this surface since 2026-05-23, so the conflict still applies as-is. Re-eval on next sync. |
| 3 | docs (badge updates) | **3** | **PULL-PENDING** (next sync) | Pure docs/badge/README changes. Low conflict risk; pick individually when sync resumes. Not urgent. |
| 4 | misc | **9** | **DEFER per-SHA** (next sync) | Heterogeneous bundle: 1 kg-extract (#2049), 5 fix(deps/mcp/cli,daemon,mcp/init), 2 fix(memory #2073) + fix(mcp #2086), 1 #2046 ADR-124 agentic-flow bump. Without per-SHA enumeration in this session, per-commit triage is the right shape — defer to next-sync triage with the named family recorded here as the unit. |

### Totals

- **5 supersede** (neural-trader → ADR-0248)
- **14 defer** (2 github + 9 misc — will be re-triaged on next sync)
- **3 pull-pending** (docs — pick on next sync)
- **0 drop**

## Re-eval triggers (for the 17 still-open dispositions)

The remaining 14 (defer) + 3 (pull-pending) are gated on:

1. **Primary** — next upstream-sync ADR (any future "Batch U" or successor against `ruvnet/ruflo`).
2. **Secondary** — `ruvnet/ruflo` accumulating ≥50 new commits since 2026-05-23 (signals divergence cost is growing; current state: 0 new commits).
3. **Tertiary** — a fork-side bug surfaces whose fix lives in one of the 9 misc commits — pick that one ad-hoc with provenance recorded in INTEGRATION-LEDGER.md.

## Consequences

* **Good** — closes an ambiguous open item with current evidence; documents the supersede mapping so future maintainers don't re-litigate the neural-trader question.
* **Good** — converts a vague "review later" into shaped follow-up work (per-family triage scope is bounded and discoverable).
* **Good** — removes the Batch S row from [[ADR-0233]] §"Reviews still owed" as an unscoped trigger; the remaining 17 dispositions are now per-family-scoped.
* **Bad** — per-family disposition is coarser than per-SHA; if a specific commit in the 9 misc bundle later proves load-bearing, the disposition has to be revisited individually.
* **Bad** — SUPERSEDE for neural-trader assumes upstream won't reverse direction. If upstream later walks back the overclaim itself, the fork's superseding logic still stands (we corrected for our context independent of upstream's stance), but a "synchronized" note in the ledger would help.
* **Neutral** — this ADR doesn't change any code by itself; it documents intent. The INTEGRATION-LEDGER.md amendment lands as a sibling change.

## Confirmation

1. `docs/upstream/INTEGRATION-LEDGER.md:164` (Batch S source-conflict deferrals row) gets an "Amendment 2026-05-25 (ADR-0252)" note recording the per-family disposition above.
2. `docs/adr/ADR-0233-second-pass-soundness-audit-findings.md` §"Reviews still owed" item 2 gets updated to reference this ADR as the disposition resolution.
3. Marketplace-integrity lint (`tests/pipeline/plugin-marketplace-integrity.test.mjs`) continues to gate against neural-trader overclaim phrases (per [[ADR-0251]] Option D follow-up landing, commit `05a700c`) — supports the SUPERSEDE verdict by preventing regression.

## Open questions

- **The 9 misc family is enumerated by description, not by SHA.** A follow-up audit (or background agent on a stable API) should resolve this to individual SHAs and update the ledger with per-SHA dispositions. Tracked as residual debt — not gating this ADR.
- **The 2 github-surface family** assumes the original conflict still applies. If fork-side github agent .md files have changed materially since 2026-05-23 (none observed in the recent fork git log), the conflict shape may have shifted — recheck on next sync.

## More Information

- [[ADR-0228]] — parent (Batch T sync; this ADR closes/dispositions the Batch S deferrals it carried forward).
- [[ADR-0230]] — sibling (re-disposed the 5 ADR-125 substrate sub-deferrals).
- [[ADR-0233]] §"Reviews still owed" item 2 — the second-pass parent that carry-forwarded this work.
- [[ADR-0248]] — Batch 3 neural-trader rewrite (the supersede target for the 5 ADR-126 deferrals).
- [[ADR-0251]] — DA-dissent close on the neural-trader rewrite (confirms ADR-0248's disposition stands; Option D lint additions land regression protection).
- `docs/upstream/INTEGRATION-LEDGER.md:164` — the original deferral row this ADR re-disposes.
- `feedback-update-integration-ledger` — corpus rule mandating ledger updates per disposition.

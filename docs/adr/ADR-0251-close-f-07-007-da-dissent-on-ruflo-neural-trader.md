---
status: accepted
date: 2026-05-25
tags: [marketplace, plugin-disposition, dissent-close]
supersedes: []
depends-on: [ADR-0248]
implements: []
---

# Close F-07-007 DA dissent on `ruflo-neural-trader` — rewrite was sufficient

## Context and Problem Statement

ADR-0248 (Batch 3, second-pass remediation) panel voted **5/6 to keep `ruflo-neural-trader` with a description rewrite** (Option B) rather than delete it from the marketplace (Option A, the path F-07-001 took for `ruflo-graph-intelligence`). The 1 dissenter — the Devil's Advocate — registered F-07-007 dissent with the explicit ask: "next audit cycle should re-examine whether description rewrite is sufficient or whether the plugin should be deleted from `marketplace.json` like F-07-001's preferred path."

The rewrite landed in Batch 3 (commit `be780856f` on `forks/ruflo`). Post-Batch-5 housekeeping pass surfaced the DA dissent as one of four "future-cycle" items. This ADR is the re-examination the DA asked for.

## Decision Drivers

* **DA mechanism's purpose.** The DA dissent is a *scheduled re-examination*, not a counter-vote. The cooling-off period gives the rewrite a chance to settle before the close/keep call is finalised. The window has elapsed (Batch 3 → Batch 5 follow-up).
* **Description honesty post-rewrite.** Did the rewrite actually correct the misleading framing the audit flagged? Or did it preserve the substantive defect under different wording?
* **Plugin substance.** Beyond the description text, do the plugin's 6 skills (`trader-backtest`, `trader-portfolio`, `trader-regime`, `trader-risk`, `trader-signal`, `trader-train`) compose meaningful workflow value, or are they thin wrappers that add nothing the underlying `npx neural-trader` CLI doesn't already document?
* **Symmetry with F-07-001.** F-07-001 (`ruflo-graph-intelligence`) was deleted because (a) it was a fork-only DOA — no upstream provenance, no users, and (b) its claimed surface (graph intelligence) wasn't backed by actual implementation. F-07-007's neural-trader is differently shaped: upstream-authored (homepage `https://github.com/ruvnet/neural-trader`), explicit scaffolding role, real underlying CLI it composes against.

## Considered Options

* **Option A — Close the dissent affirmatively (this ADR)** — verify rewrite sufficiency by inspection; if sufficient, mark F-07-007 closed; keep plugin; record reasoning durably.
* **Option B — Defer to next cycle (write defer-ADR, no inspection)** — push the re-examination forward another cycle; sibling pattern to ADR-0249 / ADR-0250.
* **Option C — Honour the DA dissent and delete** — treat DA dissent as a delayed Option A vote; remove from marketplace; remove plugin tree.
* **Option D — Partial: keep plugin, escalate description honesty via lint** — add the rewrite's forbidden-string set (e.g., "112+ MCP tools" claim) to the marketplace-integrity lint baseline so future regression catches it.

## Decision Outcome

Chosen option: **"Option A — Close the dissent affirmatively"**, because:

1. **Description rewrite is honest.** Verified at `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json` (commit `be780856f`):
   > "Neural-trading workflow scaffolds — 6 skills (backtest/portfolio/regime/risk/signal/train) wrap the external `npx neural-trader` CLI; result-storage and pattern recall via `mcp__ruflo__memory_*`, `neural_train/predict`, and `agentdb_pattern-*` (this plugin does NOT expose neural-trader's CLI tools as MCP-callable)"

   The "112+ MCP tools" overclaim is gone. The "does NOT expose neural-trader's CLI tools as MCP-callable" parenthetical is the explicit corrective — operators reading the description at install-decision time get the honest scope.

2. **Plugin substance verified.** Inspected `skills/trader-backtest/SKILL.md` as representative of the 6-skill set. It encodes a multi-step workflow:
   - `npx neural-trader --backtest --strategy <name> ...` (external CLI invocation)
   - `mcp__ruflo__memory_retrieve / search` for saved strategy configs
   - `mcp__ruflo__memory_store` for backtest results
   - Conditional `mcp__ruflo__agentdb_pattern-store` (Sharpe > 1.5)
   - `mcp__ruflo__neural_train({patternType: 'trading-strategy', ...})` on outcome

   This is not a thin wrapper. The skill encodes the *workflow* (backtest → evaluate → conditionally promote to pattern → train SONA on outcome) which is cognitive scaffolding the operator wouldn't trivially derive from `npx neural-trader --help` alone. The composition with MCP storage + neural-train primitives is the value-add.

3. **F-07-001 ≠ F-07-007.** F-07-001 was deleted because it was a fork-only DOA (no upstream, no underlying implementation, no users). F-07-007 is shaped differently: upstream-authored (`ruvnet/neural-trader`), real underlying CLI, scaffolding-mode-honest. Symmetry doesn't apply.

The 5/6 vote stands; the DA dissent is closed affirmatively.

**Option D is recorded as a sibling defensive measure** — add the specific overclaim phrases the rewrite excised to the marketplace-integrity lint baseline so regression catches anyone re-introducing them.

### Consequences

* Good, because the DA dissent gets its honest re-examination; the mechanism worked as designed (vote with cooling-off, then re-test).
* Good, because the close decision is durable + traceable — future sessions reading the corpus see the resolution, not an open question.
* Good, because preserves the workflow-scaffold value the plugin provides for operators doing trading backtests with `npx neural-trader`.
* Bad, because closing affirmatively without operator-usage data could be premature — if no one ever installs this plugin, the workflow-scaffold value is theoretical.
* Bad, because the DA's substantive concern ("is this just docs?") was answered by inspection but not by empirical adoption — the close is qualitative, not quantitative.
* Neutral, because Option D's lint reinforcement is recorded as sibling work — if it lands, regression risk drops.

### Confirmation

1. The plugin file `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json` continues to carry the honest description (commit `be780856f` content).
2. The 6 skills under `skills/trader-*/SKILL.md` continue to follow the workflow-scaffolding pattern (external CLI + MCP storage + neural training composition).
3. Marketplace integrity lint (`ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs`, landed in Batch 3) continues to gate against the overclaim phrases.
4. **Re-open trigger**: if a future audit finds either (a) the description has regressed toward overclaiming, OR (b) skills have devolved into thin CLI proxies with no MCP-composition value, this ADR moves to `superseded by ADR-NNNN` where the new ADR re-opens F-07-007 with the failure evidence.

### Option D follow-up (advisory)

Add to `ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs` a per-plugin overclaim-phrases set for `ruflo-neural-trader` (similar to the per-plugin pattern other plugins already use). Specifically the phrases the rewrite excised:

- `"112+ MCP tools"` (and minor variants: `"112 MCP tools"`, `"112+ tools"`)
- `"MCP-callable"` paired with a count-claim
- Any claim that the plugin exposes neural-trader CLI tools via MCP

This is non-blocking defensive scaffolding — the description as it stands today wouldn't fail the lint; the lint catches regression only. Tracked as a follow-up of this ADR; not gating closure.

## Pros and Cons of the Options

### Option A — Close the dissent affirmatively (chosen)

* Good, because the rewrite verifiably corrected the misleading framing.
* Good, because the plugin's 6 skills compose meaningful workflow value beyond the underlying CLI.
* Good, because the DA mechanism worked as designed; closing it durably means future sessions don't re-litigate without new evidence.
* Bad, because no operator-usage data backs the close.
* Bad, because qualitative inspection by one auditor (this session) is weaker evidence than the original 5/6 panel vote.

### Option B — Defer to next cycle (write defer-ADR)

* Good, because matches the sibling-defer pattern of ADR-0249 / ADR-0250.
* Good, because preserves DA-dissent open-status for another cycle of cooling-off.
* Bad, because the cooling-off has already happened (Batch 3 → Batch 5 → follow-up audit); deferring further is just procrastinating the question.
* Bad, because indefinite deferral with no triggers (the plugin's adoption isn't measured) means the question never closes.

### Option C — Honour the DA dissent and delete

* Good, because closes the "is this dead weight?" question definitively.
* Good, because reduces the plugin surface area; less to maintain.
* Bad, because overrides the 5/6 panel vote without new evidence supporting the DA's concern.
* Bad, because removes real workflow value that the rewrite verified.
* Bad, because asymmetric with F-07-001 — that deletion had no-upstream + no-implementation justification; this would be just "DA wanted it gone."

### Option D — Keep plugin, escalate description honesty via lint

* Good, because adds regression protection without forcing closure.
* Good, because cheap to implement; lint already exists.
* Bad, because doesn't close the dissent — leaves F-07-007 in an ambiguous "watch-listed" state.
* Bad, because best landed as a sibling to a close (this ADR records it as such) rather than as the primary disposition.

## More Information

- [[ADR-0248]] §F-07-007 — parent decision; this ADR closes the DA dissent the parent ADR opened.
- [[ADR-0249]] + [[ADR-0250]] — sibling defer-pattern ADRs in this same housekeeping pass. F-07-007 differs from those because it isn't design-blocked; it's a single-plugin substance re-examination with a tractable answer.
- Batch 3 commit `be780856f` (`forks/ruflo`) — the rewrite that landed the honest description + naming convention.
- `forks/ruflo/plugins/ruflo-neural-trader/.claude-plugin/plugin.json` — current honest description.
- `forks/ruflo/plugins/ruflo-neural-trader/skills/trader-*/SKILL.md` — 6 workflow-scaffold skills verified to compose external CLI + MCP storage + neural training.
- `ruflo-patch/tests/pipeline/plugin-marketplace-integrity.test.mjs` — lint that gates overclaim regression (Batch 3 landing).
- Session 2026-05-25 follow-up audit — the parent-session conversation that surfaced the question and produced this ADR.
- [[ADR-0233]] §"Reviews still owed" — the second-pass parent rollup.

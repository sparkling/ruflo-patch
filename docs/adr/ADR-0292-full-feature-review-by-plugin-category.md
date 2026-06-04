---
status: proposed
completed: false
date: 2026-06-04
tags: [review, plugins, features, upstream-parity, methodology, program, re-convergence]
supersedes: []
depends-on: [ADR-0291, ADR-0290, ADR-0287]
implements: []
---

# Full feature review of Ruflo, organised by plugin category — prove upstream, re-justify every fork divergence

## Context and Problem Statement

The learning investigation (ADR-0291) ended in a reversal: features repeatedly declared broken — by this
project's analyses and ADRs — turned out to work upstream when tested in the correct shape (production
event sequences, documented defaults, write-traces, SQLite dumps, installed-dist verification). The
fork's learning "fixes" were therefore built on a **false brokenness diagnosis**, and at least one
working upstream mechanism is *disabled in the fork* (`hooks_intelligence_trajectory-*` `enabled:false`,
sona-optimizer off the live path) while a parallel replacement was constructed beside it.

**The directive this ADR encodes:** if that failure mode corrupted the learning area, it must be assumed
possible in *every* feature area until disproven. Ruflo's features are delivered and organised by
plugins; the plugin catalogue is therefore the natural structure for a complete review. For every
feature of every plugin: **prove the upstream implementation works and understand why** (the reference
behaviour), then diff the fork against that reference, catalogue the analysis mistakes that produced
each fork patch, and re-justify or unwind every divergence.

**Null hypothesis (binding):** *upstream works; fork divergence is the bug.* A fork patch is presumed
wrong until re-justified against demonstrated upstream behaviour. "It passes its own smoke" is not
justification — a smoke proves the patch's mechanism, not its necessity (ADR-0290's 17/17 smoke proved a
parallel pipeline functions, not that the pipeline was needed).

## Decision Drivers

* ADR-0291's corrections history: three waves of wrong "broken" verdicts from one session, plus the
  inherited wrong premises in ADR-0287 §F10 and predecessor ADRs.
* Fork maintenance cost: every unjustified divergence is permanent merge-tax against upstream.
* The known failure mode — *agents erroneously reporting Ruflo features as broken* — needs a
  standing, organised counter-process, not per-incident firefighting.
* The fork carries ~290 ADRs of patches; an unknown fraction were premised on untested brokenness.

## Considered Options

* **Plugin-category-organised review with upstream-first proof protocol** — systematic, bounded
  (35 plugins), maps 1:1 to how features ship. Chosen.
* Ad-hoc review only when a feature misbehaves — rejected: that is the status quo that produced the
  learning misdiagnosis.
* Whole-fork diff against upstream at the code level — rejected as the primary method: code diffs
  cannot distinguish justified divergence from regression; behaviour-first proof can. (Code diff is
  step 4 of the protocol, after behaviour is established.)

## Decision Outcome

Chosen option: plugin-category-organised review. For each plugin, in category order below, run the
**review protocol**; produce per-category findings records and, where divergences are found, a
re-convergence ADR per category. This ADR is the program; each category execution needs its own
go-ahead.

### Review protocol (per plugin — the unit of work)

1. **Enumerate advertised features.** From the plugin's manifest, skills, commands, agents, hooks,
   MCP tools, and the USERGUIDE sections that reference it. The *documentation is the spec*.
2. **Prove upstream.** In the reference project (`/tmp/ruflo-fresh` pattern: documented installer +
   marketplace install, public registry), drive every advertised feature in its **production shape**
   and record what it demonstrably does — positive proof, not gap-hunting. Where behaviour seems
   absent, apply the ADR-0291 validation bar BEFORE recording a failure:
   production event sequence · documented defaults/flags (`--help`) · complete fs write-trace +
   SQLite dumps of every store + full-tree diff · installed-dist code verification · counters-vs-content.
3. **Explain the mechanism.** For each working feature: which process, which trigger, which store,
   which consumer. (The learning reversal happened because mechanism was assumed, not traced.)
4. **Diff the fork.** Same drives against a fork-built project. Classify every behavioural delta:
   - `FORK-REGRESSION` — works upstream, broken/disabled/diverged in fork (e.g. trajectory tools
     `enabled:false`). The default classification for any delta.
   - `FORK-AHEAD` — fork capability absent upstream; must be re-justified from scratch: would
     re-enabling/porting the upstream mechanism have sufficed? If yes → candidate for unwind/fold-in.
   - `PARITY` — same behaviour.
   - `UPSTREAM-BROKEN` — only with the full validation bar satisfied AND a root-cause mechanism named.
5. **Audit the fork's patch history for the area.** Which fork ADRs/patches touched this plugin's
   surface; for each: was its problem statement *demonstrated* or *assumed*? List every analysis
   mistake found (the ADR-0291 §Confirmation taxonomy).
6. **Disposition.** Per divergence: re-converge on upstream / keep-with-justification (recorded) /
   unwind fork patch. Output: a category findings record + (if needed) a category re-convergence ADR.
   Wire any new behavioural checks into `test-acceptance*.sh` + CI per
   `feedback-always-wire-tests-into-cicd`.

### Plugin categories and inventory (35 plugins; keyword-derived grouping — manifests carry no
`category` field; the marketplace lists 33, the repo ships 2 more: ruflo-hive-mind, ruflo-wasm)

| # | Category | Plugins | Notes / priority |
|---|---|---|---|
| C1 | **Learning & Intelligence** | ruflo-intelligence, ruflo-autopilot, ruflo-graph-intelligence, ruflo-ruvector, ruflo-ruvllm | **✅ REVIEWED 2026-06-04** — findings: `docs/research/c1-learning-intelligence/01..04`; re-convergence ADR: **ADR-0293** (4 regressions D1–D4 incl. ruvllm WASM init skew; 4 fork-ahead keeps D5–D8; ADR-0291 F1 retracted — `enabled:false` was hooks_list display metadata; 9/10 fork ADR premises DEMONSTRATED; upstream-broken: 0). D1–D4 implementation gated on go-ahead |
| C2 | **Memory & Data substrate** | ruflo-rag-memory, ruflo-agentdb, ruflo-rvf, ruflo-knowledge-graph, ruflo-migrations | Second — the substrate the fork diverged from hardest (RVF-as-sole-truth, sql.js removal, ADR-0091/0086); highest patch density |
| C3 | **Orchestration & Agents** | ruflo-core, ruflo-swarm, ruflo-hive-mind, ruflo-agent, ruflo-wasm, ruflo-daa, ruflo-workflows, ruflo-goals | ruflo-core carries the hook layer (partially proven in ADR-0291) |
| C4 | **Quality & Process** | ruflo-testgen, ruflo-sparc, ruflo-ddd, ruflo-adr, ruflo-docs, ruflo-jujutsu | |
| C5 | **Security & Safety** | ruflo-security-audit, ruflo-aidefence, ruflo-federation | |
| C6 | **Operations** | ruflo-loop-workers, ruflo-observability, ruflo-cost-tracker, ruflo-browser | loop-workers overlaps C1 (scheduled learning workers) |
| C7 | **Domain verticals** | ruflo-market-data, ruflo-neural-trader, ruflo-iot-cognitum | Lowest priority |
| C8 | **Developer tooling** | ruflo-plugin-creator | |

### Execution order and gating

C1 → C2 → C3 → C4/C5 (parallelizable) → C6 → C7/C8. One category at a time; each category's execution
(and especially any *unwind* of fork patches) requires an explicit go-ahead. Findings land continuously
(commit-often); the per-category re-convergence ADRs follow the corpus conventions and supersede the
fork ADRs they unwind.

### Consequences

* Good, because the review converts a recurring trust problem ("is it actually broken?") into a
  bounded, evidence-tiered program with a written protocol.
* Good, because the null hypothesis (upstream works) plus the validation bar structurally prevents the
  misdiagnosis class that produced the learning detour.
* Good, because unjustified fork divergences — permanent merge-tax — get identified and unwound.
* Bad, because the program is large: 35 plugins × protocol steps; mitigated by category gating and
  starting where evidence already exists (C1).
* Bad, because some fork patches that pass their own tests will be unwound anyway (wrong premise) —
  sunk cost made explicit.
* Neutral, because `FORK-AHEAD` features can survive — but only with recorded justification against
  the working upstream baseline.

### Confirmation

* Each category produces: (a) an upstream proof record (what works, why — mechanism named), (b) a
  classified divergence table, (c) the patch-history audit with mistake catalogue, (d) dispositions
  with go-ahead checkpoints, (e) behavioural checks wired into the standard acceptance runner + CI.
* The program is complete when all 8 categories have records and every fork learning/feature patch is
  either re-justified (recorded) or unwound — verified by a final pass: a fresh fork-built project
  demonstrates each category's reference behaviours (the per-category checks green in acceptance).

## More Information

* Method + validation bar: ADR-0291 §Confirmation (the five-point bar is binding for every "broken"
  verdict recorded under this program).
* Known inputs: ADR-0291 (C1 upstream proof, partial), ADR-0287 (fork live-manual findings — premises
  to re-audit, not trust), ADR-0290 (fork capture pipeline — re-justification target in C1),
  memories `project-upstream-learning-audit-2026-06-04`, `feedback-trace-bin-entry-before-patching`.
* Reference environment recipe: USERGUIDE one-line installer + `plugin marketplace add ruvnet/ruflo` +
  all marketplace plugins, public npm registry (local Verdaccio shadows `@ruvector/*` — ADR-0291 F3).

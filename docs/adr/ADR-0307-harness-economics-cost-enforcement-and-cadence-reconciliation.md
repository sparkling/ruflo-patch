---
status: accepted
date: 2026-06-08
tags: [cost-tracker, daemon, budget-enforcement, worker-cadence, honesty, harness-economics]
supersedes: []
depends-on: []
implements: []
---

# 24/7 harness economics: wire cost-tracker budget enforcement + reconcile worker-cadence defaults

## Context and Problem Statement

The same 2026-06-08 multi-agent investigation that produced [[ADR-0306]] (driving
published `@sparkleideas/cli@…patch.432` with warm probes + shipped-code reads,
under the ADR-0293 "verify, don't assume broken" posture) verified the "24/7
harness — does it spend tokens?" question. **The doc's conclusions all held**
(idle daemon ≈ $0; workers genuinely cost tokens per fire; `claudeFlow.daemon.autoStart=false`),
but two concrete, capturable framework-honesty gaps surfaced — neither is "it's
broken," both are "the advertised contract overshoots the wired behaviour":

1. **`ruflo-cost-tracker` attributes cost for real, but budget "enforcement" is
   advisory only.** `track.mjs` carries real per-tier USD pricing (haiku
   0.25/1.25, sonnet 3/15, opus 15/75 per 1M) and `costForUsage()` derives spend
   from the session JSONL — accurate attribution. But `budget.mjs`
   `recommendedAction('HARD_STOP')` returns a *prose string* ("halt non-essential
   agent spawns… before continuing"); **no code consumes `HARD_STOP` to gate
   worker/agent dispatch.** `plugin.json` defers the hard cut-off to a
   "federation budget circuit breaker" (its own ADR-097). So a budget at 100%
   raises an alert but does not stop the next headless worker from spending. The
   user-facing README claimed cost-tracker "**enforce budgets**" — corrected
   2026-06-08 to "tracks cost and raises budget alerts."
2. **Worker-cadence default-vs-init drift.** The worker daemon's shipped code
   defaults (`worker-daemon.js:59-60`) are **audit = 30 min, optimize = 60 min**.
   But this install runs **audit = 4h, optimize = 2h** — sourced from the repo's
   `.claude/settings.json` → `claudeFlow.daemon.schedules.{audit:"4h",optimize:"2h"}`
   (consumed at `worker-daemon.js:175`; live daemon log confirms `interval:14400s`
   / `7200s`). The values written by `init` (the template) therefore disagree
   with the code defaults, so "the default cadence" is ambiguous across docs/code.
   Cadence is an economics question (more frequent fires = more token spend), so
   it belongs with the budget gap.

Both are `feedback-no-dormant-off-by-default-flags` / ADR-0172-style honesty
items: the capability is built and partially wired; the gap is between the
advertised surface ("enforce budgets", "default cadence") and what executes.

## Decision Drivers

* Honesty: "enforce budgets" implies a hard cut-off that does not exist on the
  live dispatch path; either wire it or keep the doc honest (already corrected
  in the README; the fork code + USERGUIDE should follow).
* The hard-stop machinery is mostly present (levels 50/75/90/100% + a
  `HARD_STOP` recommendation) — wiring is small, not a rebuild.
* Docs and code should agree on the shipped default cadence so operators can
  reason about idle vs active token cost.

## Considered Options

* **Record + propose wiring + reconcile (chosen).** Capture the two gaps; propose
  gating dispatch on `HARD_STOP`; reconcile the cadence defaults with what `init`
  writes. Authorises no code beyond the decision until an explicit go-ahead.
* **Wire enforcement now** — premature without deciding the contract: should 100%
  budget *block* non-critical workers, or only the federation breaker do hard
  cut-off? T1 settles that first.
* **Leave advisory, doc-only** — acceptable for the README (done), but the fork's
  `plugin.json`/USERGUIDE still imply enforcement; leaving it is the dormant-flag
  anti-pattern.

## Decision Outcome

Chosen: record the findings + plan the enforcement wiring and cadence
reconciliation. Status `proposed`; no execution until an explicit go-ahead.

### Tasks

* **T1 — Enforcement contract. RESOLVED 2026-06-10 → attribution-only, follow
  upstream** (decision: Henrik; evidence in the Upstream-alignment amendment
  below). Budget does NOT gate worker/agent dispatch; hard cut-off is
  exclusively the federation budget circuit breaker (ADR-097). This is
  upstream's documented model, not a fork choice — so T2 is a doc task, not a
  daemon-loop change.
* **T2 — Document attribution-only honestly (NOT gate-in-daemon).** State at the
  call site + USERGUIDE that cost-tracker is attribution + alerting + the
  opt-in `budget check && spawn` gate (all upstream), with hard cut-off =
  ADR-097 federation circuit breaker — matching the already-corrected README.
  No `worker-daemon.js` dispatch change. Also fix the evidence-line errors
  (the "learn→opus" conflation; stale haiku-4.5 pricing in `track.mjs`).
* **T3 — Reconcile worker-cadence to UPSTREAM.** Follow upstream's cadence
  rather than inventing a number: upstream `worker-daemon.ts` documents
  audit=10min / optimize=15min (header + the config array), so first
  provenance-check whether the shipped 30m/60m at `:59-60` is a *different
  array* or genuine fork divergence (`git show origin/main` / `diff`); then
  align the code defaults + `init` template (`claudeFlow.daemon.schedules`) to
  upstream's intended cadence, or record an explicit, justified fork override.

### Consequences

* Good, because the fork stops implying a budget hard-stop it doesn't wire — it
  either gains enforcement (T2 gate) or states attribution-only honestly.
* Good, because operators can reason about token cost from a single, agreed
  default cadence.
* Neutral, because cost *attribution* (the valuable part) already works and is
  unaffected.
* Bad (mitigated), because gating dispatch touches the live daemon loop; deferred
  behind T1's explicit contract decision rather than assumed.

### Confirmation

If gate-in-daemon: an acceptance check proving an over-budget state suppresses a
non-critical scheduled worker. If breaker-only: a doc/honesty check that
cost-tracker is described as attribution+alerts, not enforcement. Plus a
cadence-default parity check (code default == documented default, or the override
is documented). Until T1 is decided and ships, this ADR stays `proposed`.

## More Information

* User-facing counterpart corrected 2026-06-08:
  `~/source/hm/semantic-docs/docs/agentic-engineering/README.md` §3 — "enforce
  budgets" → "tracks cost and raises budget alerts"; the two-daemon and
  cadence-override clarifications also landed there.
* [[ADR-0306]] — sibling finding from the same investigation (model-routing
  honesty). Method: [[ADR-0293]] (verify, don't assume broken).
* Evidence (2026-06-08 swarm): attribution real — cost-tracker `track.mjs`
  PRICING + `costForUsage()`; enforcement advisory — `budget.mjs`
  `recommendedAction('HARD_STOP')` returns prose, no dispatch consumer; cadence —
  code default `worker-daemon.js:59-60` (30m/60m) vs install
  `.claude/settings.json` `claudeFlow.daemon.schedules` (4h/2h), consumed at
  `worker-daemon.js:175`. The real LLM spawn is `headless-worker-executor.js:914`
  `spawn('claude', ['--bare','--print'])` (per-tier: audit→haiku, optimize/
  testgaps→sonnet, learn→opus).

## Amendments

### Amendment (2026-06-10): premise 1 narrowed — a fail-closed gate already ships; two evidence corrections

Adversarial re-verification (8-agent swarm) confirmed the cadence findings
exactly and LIVE (code defaults `worker-daemon.js:59-60` = 30m/60m in shipped
patch.432; this install's `settings.json` schedules = 4h/2h consumed at
`:175`; the running daemon's `daemon-state.json` shows audit 07:36→11:36 (4h)
/ optimize 07:38→09:38 (2h) and `logs/daemon.log` carries `interval: 14400s`
×102 + `interval: 7200s` ×102; `spawn('claude', ['--bare','--print'])` exact
at `headless-worker-executor.js:914`). Three corrections to the premises:

1. **"No code consumes `HARD_STOP`" is true for the daemon, FALSE
   absolutely.** `budget.mjs:208` ships
   `if (alert.level === 'HARD_STOP') process.exit(1)` — a fail-closed
   mechanical gate, shipped since 2026-05-09 (`b1608dee1`, a month before
   this ADR), documented as a spawn-guard pattern in
   `skills/cost-budget-check/SKILL.md:39` ("Wrap critical agent spawns in a
   `budget.mjs check && spawn …` guard") and the plugin's own ADR-0003. What
   is missing is only AUTOMATIC gating: the daemon dispatch loop has zero
   budget/`HARD_STOP` references (confirmed across shipped
   `worker-daemon.js` + `headless-worker-executor.js`). **T2 therefore
   reduces further:** have the daemon consume the existing `budget check`
   exit-1 gate (or its logic) before non-critical fires — the primitive
   already exists.
2. **The Evidence line "learn→opus" conflated two workers.** No headless
   `learn` template exists; opus belongs to `ultralearn` (:167→:190) and
   `deepdive` (:219→:236). The daemon worker literally named `learn`
   (`worker-daemon.js:71`) is the in-process NightlyLearner
   (`routeLearningOp`) — spawns no `claude`, costs $0 LLM. audit→haiku
   (:70→:92) and optimize/testgaps→sonnet (:98→:115, :121→:138) confirmed
   exact.
3. **The Considered-Options premise "the fork's plugin.json/USERGUIDE still
   imply enforcement" is REFUTED** — `plugin.json:3` says "budget alerts,
   and optimization recommendations" (no enforcement claim) and the fork
   USERGUIDE's "enforce" hits are all guidance-gate/spec-compliance
   sections. The doc-honesty half of T2's else-branch is already satisfied;
   drop that premise at ratification.

Also recorded: `track.mjs:28-31` carries an in-file note that the haiku
pricing constants lag haiku-4.5 (1.00/5.00) — fold into T3's reconciliation
or track separately. The current user-facing README §3 (sole commit
`38ac38a`, 2026-06-09) already states "HARD_STOP is an advisory
recommendation … nothing currently gates dispatch on it" — which inherits
the same daemon-scoped imprecision; correct it alongside T2's resolution.

### Upstream-alignment amendment (2026-06-10): T1 RESOLVED → attribution-only (follow upstream intent + implementation)

A provenance + upstream-ADR check (user directive: "follow upstream intent
and implementation") settled T1 decisively against daemon gating, because
gating would be a *divergence* from upstream's deliberate architecture:

* **Upstream's `worker-daemon.ts` has ZERO budget/HARD_STOP references** — "the
  daemon does not gate dispatch on budget" is upstream's *design*, not an
  unfinished gap. Wiring it fork-side would diverge with no upstream basis.
* **The opt-in `exit-1` HARD_STOP gate IS upstream** (`origin/main`
  `plugins/ruflo-cost-tracker/scripts/budget.mjs:216`) — it is ADR-097's
  Phase-3 consumer work, not a fork original (the earlier "fork commit
  `b1608dee1`" attribution was at most the sync that carried it in).
* **Upstream ADR-097 "Federation-wide Budget Circuit Breaker" (Accepted,
  Partially Implemented)** places hard enforcement deliberately at the
  **federation boundary** — `federation_send` caps (`maxTokens`/`maxUsd`/
  `maxHops` across the hop chain) to stop cross-node cost cascades + recursive
  delegation loops. Phase 1 (send-side) shipped in the federation plugin;
  Phase 3 (consumer) in `ruflo-cost-tracker@0.14.0`. The cost-tracker contract
  ADR-0001 confirms the split: the plugin is attribution + alerting + opt-in
  gate, and *pairs with* ADR-097 for the hard cut-off.

So upstream's intended model is **attribution-only locally, hard enforcement
only at the federation boundary**. Decision: track that — T2 becomes a
doc/honesty task (no daemon-loop change), T3 aligns cadence to upstream. The
"gate-in-daemon" Considered Option is closed as an unwanted fork divergence.
This ADR stays `proposed` until T2 (docs) + T3 (cadence alignment) ship.

### Amendment (2026-06-10): T2/T3 shipped — pricing fix extended to opus; cadence is a documented override

T2 + T3 landed in `forks/ruflo` (`f26e858c2` code, `4aa5082fe` docs):

* **T2 (docs):** `plugins/ruflo-cost-tracker` README/REFERENCE reframed as
  **attribution + alerting**; `HARD_STOP` documented as "alert + opt-in
  fail-closed gate (`budget.mjs check && spawn`), does NOT auto-halt dispatch —
  hard cut-off = ADR-097". No daemon-loop change.
* **T3 (pricing):** corrected the stale tier rates in `track.mjs` +
  REFERENCE/README, verified against the Anthropic pricing page (via the
  `claude-api` skill, 2026-06-10): **haiku** `0.25/1.25/0.30/0.03` →
  `1.00/5.00/1.25/0.10` (Haiku-4.5). **T3 EXTENDED beyond the originally-named
  haiku row to the `opus` tier** — it carried Opus-4.1-era `15.00/75.00/18.75/
  1.50`, which **3×-mispriced the default model** (current Opus 4.x =
  `5.00/25.00/6.25/0.50`). Same stale-pricing class; leaving the default model
  mispriced contradicts the no-wrong-data honesty posture, so it was folded into
  this T3 fix. Stale ADR-0298-X1 freshness note removed.
* **T3 (cadence):** provenance-checked the fork `worker-daemon.ts` cadence
  (audit 30m / optimize 60m / consolidate 10m / testgaps 60m) vs upstream
  (10/15/30/20). The divergence is a **deliberate, named economics override**
  (`a3b3d7797` HW-003 + WM-108: LLM-spawning workers run LESS often to cut token
  spend; the $0 in-process consolidate runs MORE often). **Decision: documented
  override, NOT align** — aligning would re-introduce the more-expensive cadence
  the fork backed off from. Fixed the stale header comment (which still showed
  upstream values) + added an in-source provenance pointer.
* **T3 (learn→opus):** the evidence conflation was corrected in the prior
  2026-06-10 amendment (item 2); `learn` → in-process NightlyLearner ($0 LLM),
  opus is only `ultralearn`/`deepdive`. No code change.

This ADR can flip `proposed` → `accepted` after the release verifies acceptance
green.

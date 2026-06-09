---
status: proposed
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

* **T1 — Decide the enforcement contract.** Does budget ≥100% gate worker/agent
  dispatch (skip non-critical workers), or is hard cut-off exclusively the
  federation budget circuit breaker (plugin.json's ADR-097)? Pick one; document
  it at the call site.
* **T2 — If gate-in-daemon:** wire `recommendedAction('HARD_STOP')` into
  `worker-daemon.js` dispatch so non-critical scheduled workers (audit/optimize/
  map) are skipped at ≥100% utilisation, with a green acceptance check that a
  simulated over-budget state suppresses a scheduled fire. If breaker-only:
  document cost-tracker as attribution+alerting (not enforcement) at the call
  site + USERGUIDE, matching the corrected README.
* **T3 — Reconcile worker-cadence defaults.** Make the shipped code defaults
  (`worker-daemon.js`) and the `init` template (`claudeFlow.daemon.schedules`)
  agree on a single documented default cadence, or document explicitly that the
  template intentionally overrides the conservative code defaults (and why).

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

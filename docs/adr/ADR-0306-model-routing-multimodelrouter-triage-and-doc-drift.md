---
status: proposed
date: 2026-06-08
tags: [routing, providers, multimodelrouter, doc-drift, honesty, no-consumer-triage]
supersedes: []
depends-on: [ADR-0278, ADR-0172]
implements: []
---

# Model routing: triage the unconsumed MultiModelRouter + fix the routing doc-drift

## Context and Problem Statement

A 2026-06-08 multi-agent investigation (driving published `@sparkleideas/cli@…patch.432`
with warm probes + shipped-code reads, explicitly countering the documented
over-skepticism pattern — ADR-0293: 125/125 fork premises demonstrated) settled
the recurring "model routing — only Claude?" question and surfaced two concrete,
capturable findings that are NOT "it's all broken":

**Established (verified):**
* Cross-provider routing is **real, wired, shipped, empirically demonstrated**.
  The live dispatcher is `agent-execute-core.ts` (`agent_execute` →
  `callAnthropicMessages`, which branches: OpenRouter via `callOpenAICompat` →
  real `fetch` to `openrouter.ai`; Ollama via `callOllamaCompat`, cloud +
  self-hosted; else Anthropic). A dry-probe took the OpenRouter and Ollama
  branches with real HTTP. Config: `RUFLO_PROVIDER`, `OPENROUTER_API_KEY`,
  `OLLAMA_API_KEY`/`OLLAMA_BASE_URL`, `ANTHROPIC_API_KEY`.
* The Claude-tier Thompson bandit (ADR-0278) is real and learning; RuVLLM local
  inference + SONA/MicroLoRA are real (the "EWC NaN / aspirational" dismissal was
  a stale, misattributed upstream-ADR-086 citation, closed by ADR-0231).

**The two findings this ADR captures:**

1. **The named `MultiModelRouter` / `ProviderRegistry` is unconsumed shelfware.**
   `@claude-flow/integration/src/multi-model-router.ts` (1079 lines) carries the
   full `anthropic | openai | gemini | openrouter | ollama | litellm | onnx |
   custom` provider list, real weighted cost/latency/quality scoring
   (`scoreModels()`), and a real circuit-breaker state machine
   (`recordFailure()`) — but `executeCompletion()` is a MOCK (returns
   `"[Response from …]"`, no HTTP) and the class has ZERO live consumers (only
   re-exported in `integration/src/index.ts`). Consequence (CORRECTED — see
   Addendum 2026-06-08): this *specific class* is dead, but it is NOT the only
   cross-provider router — **agentic-flow's `ModelRouter` is real, shipped, and
   does automatic failover**, so the blanket "automatic failover is not on the
   live path" originally stated here was wrong. What is genuinely missing is
   (i) Ruflo's `agent_execute` hot path auto-routing through that router (it
   dispatches one provider by explicit env precedence, no auto-arbitrage), and
   (ii) a true dynamic cheapest-cost selector. This is a `feedback-no-consumer-is-not-stub`
   triage case (WIRE / KEEP-AS-CAPABILITY / DELETE), NOT a reflexive delete: the
   code is real and well-built, just unwired.
2. **USERGUIDE routing doc-drift (two bugs, drift not dishonesty):**
   - `USERGUIDE.md:894` labels the model-tier selector **"Q-learning with
     epsilon-greedy"** — wrong; the selector is **Thompson/Beta sampling**
     (`:47` says so correctly, same document). The "Q-learning" label was
     borrowed from the *separate, real* `QLearningRouter` (q-learning-router.ts)
     which does AGENT/task routing, not model-tier selection.
   - The cost-savings headline drifts across surfaces: **24.5%** (token, ADR-026),
     **30-50%** (USERGUIDE:384/5062 + CLAUDE.md), **75%** (API cost, ADR-026) —
     each under a different (often unstated) assumption. All sourced; none
     fabricated; but a reader sees three numbers. ("89% accuracy" is a separate
     unsourced README cell — out of this ADR's scope, flagged for the README owner.)

The user-facing counterpart in `~/source/hm/semantic-docs/docs/agentic-engineering/README.md`
(the "Q2" model-routing section) was corrected on 2026-06-08 with these findings;
this ADR governs the FORK-side code + USERGUIDE.

## Decision Drivers

* Honesty: the USERGUIDE/`MultiModelRouter` naming implies automatic cost-arbitrage
  that is not wired — a `feedback-no-consumer-is-not-stub` / ADR-0172
  (router-silent-fallback-honesty) concern.
* Don't reflexively delete real, well-built code (the unconsumed router): triage
  it deliberately (WIRE/KEEP/DELETE) per the fork's own rule.
* Doc-drift is cheap to fix and the corpus has a honesty-lint posture for it.

## Considered Options

* **Record + triage + fix doc-drift (chosen).** Capture the findings; make a
  deliberate WIRE/KEEP/DELETE call on `MultiModelRouter`; fix the two USERGUIDE
  doc-drift bugs. Authorises no code beyond the decision + doc edits.
* **Wire `MultiModelRouter` into the live path now** — premature without the
  triage decision (is cross-provider auto-failover a wanted product capability,
  or is explicit env-driven selection the intended contract?).
* **Delete `MultiModelRouter`** — rejected as a default: it's real, scored,
  breaker-equipped code; `feedback-no-consumer-is-not-stub` forbids
  default-to-delete on unconsumed-but-real surfaces.
* **Record-only, no doc fix** — rejected: the USERGUIDE actively mislabels the
  algorithm (Q-learning) and shows three different savings numbers.

## Decision Outcome

Chosen: record the findings + plan the triage and doc fixes. Status `proposed`;
no execution until an explicit go-ahead on the triage direction.

### Tasks

* **T1 — Triage `MultiModelRouter`. RESOLVED 2026-06-10 → KEEP, track upstream**
  (full evidence + decision in Addendum 2 §1). The file is byte-identical to
  upstream `origin/main`; it is upstream-incidental decision/orchestration
  scaffold (real `route()`, stubbed execution leaf — as is its sibling
  `ProviderAdapter`). Not WIRE (don't get ahead of upstream), not DELETE
  (merge-tax on identical code, no positive divergence case). The live
  cross-provider path is already served by `agent-execute-core`.
* **T2 — WIRE branch CLOSED by T1's KEEP resolution.** No fork-side wiring of
  `executeCompletion`; if upstream later wires the integration router the fork
  inherits it on sync. The only KEEP obligation is the doc work below: T3/T4
  must not let any surface describe this router as a wired live executor.
* **T3 — Fix USERGUIDE:894** "Q-learning with epsilon-greedy" → "cost-adjusted
  Thompson sampling (Beta-Bernoulli bandit)"; cross-reference the separate
  `QLearningRouter` as the agent/task router so the two aren't conflated.
* **T4 — Reconcile the savings figures.** State the assumption inline (e.g.
  "≈75% API-cost / 24.5% token reduction under a 25/50/25 tier mix"), reconcile
  the 30-50% vs 75% framing across USERGUIDE/ADR-026/CLAUDE.md.
* **T5 — Note the user-facing README** (`semantic-docs …/agentic-engineering/README.md`
  Q2) was corrected 2026-06-08 as the consumer counterpart; keep it in sync with
  the T1 disposition.

### Consequences

* Good, because the fork stops implying automatic cost-arbitrage it doesn't wire,
  and either gains it (WIRE) or documents its absence honestly (KEEP).
* Good, because the USERGUIDE stops mislabeling the bandit's algorithm and
  showing three unreconciled savings numbers.
* Neutral, because the working cross-provider routing (`agent-execute-core.ts`)
  is unaffected — it already works; this is about the *automatic-selection* layer.
* Bad (mitigated), because WIRE-ing the router is real work touching the live
  dispatch path; deferred behind T1's explicit decision rather than assumed.

### Confirmation

If WIRE: an acceptance check proving cost-based provider selection + failover on
the live `agent_execute` path. If KEEP: a doc/honesty check that the unwired
status is stated. Plus the USERGUIDE doc-drift greps (T3/T4). Until T1 is decided
and its consequences ship, this ADR stays `proposed`.

## More Information

* [[ADR-0278]] — the Claude-tier contextual bandit (the real, wired model-tier
  router); [[ADR-0172]] — router silent-fallback / disabled-controller honesty
  audit (same honesty posture).
* `feedback-no-consumer-is-not-stub` — the WIRE/KEEP/DELETE triage rule for
  real-but-unconsumed code (do not default to DELETE).
* Evidence (2026-06-08 swarm): wired dispatcher
  `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agent-execute-core.ts`
  (`callAnthropicMessages`/`callOpenAICompat`/`callOllamaCompat`); unconsumed
  scorer `forks/ruflo/v3/@claude-flow/integration/src/multi-model-router.ts`
  (provider list 40-48, `scoreModels` 850-895, `executeCompletion` mock 939-977);
  doc-drift `forks/ruflo/docs/USERGUIDE.md:47` (correct) vs `:894` (wrong).
* User-facing counterpart corrected 2026-06-08: `~/source/hm/semantic-docs/docs/agentic-engineering/README.md` §2.
* Method: ADR-0293 (verify, don't assume broken); the prior session's
  "marketing / aspirational / unproven" framing was refuted on the running code.

## Addendum (2026-06-08, deeper shipped-artifact re-verification)

A follow-up probe — prompted by the user disbelieving the "shelfware ⇒ no
auto-routing" verdict — read the **shipped** packages (npx runtime + published
tarballs), not the `v3/` fork source. Finding 1 was **mis-scoped**: it judged the
one dead class and missed the real, shipped cross-provider router. The same
ADR-0293 over-skepticism reflex this ADR was written to counter had reappeared
inside the ADR itself. Correction:

* **agentic-flow's `ModelRouter` (`@sparkleideas/agentic-flow/router`,
  `dist/router/router.js`) is the real, shipped cross-provider router** — five
  real provider classes (Anthropic / OpenRouter / Gemini / Ollama / ONNX),
  `manual | rule-based | cost-optimized | performance-optimized` modes, and a
  **real fallback-chain failover** (`handleProviderError` iterates
  `config.fallbackChain`, retrying `provider.chat()`). It runs behind the
  `agentic-flow` binary (bin → `cli-proxy.js`) and is exposed to Ruflo via
  `cli/dist/src/services/agentic-flow-bridge.js` `getRouter()` (lazy
  `import('@sparkleideas/agentic-flow/router')`, null-safe).
* **Two honest, narrower gaps remain:**
  1. agentic-flow's `selectByCost` (`router.js:270-282`) is a **static
     provider-preference order** (`['openrouter','anthropic','openai']`) with a
     literal `// TODO: Implement actual cost calculation` — `selectByPerformance`
     (latency metrics) and the failover chain are real, but *dynamic per-token
     cheapest* selection is not yet implemented.
  2. Ruflo's own `agent_execute` hot path does **not** auto-invoke that router —
     the `getRouter()` bridge accessor is **available-but-unconsumed** in the
     shipped CLI (grep: no live consumer); the hot path uses
     `agent-execute-core.ts` (explicit-env provider dispatch) + the Claude-tier
     bandit (`ruvector/model-router.js`).
* **`@claude-flow/integration`'s `MultiModelRouter` IS still a genuine mock**
  (`executeCompletion` → `[Response from …]`, `dist/multi-model-router.js:617`,
  confirmed in the newest published `@sparkleideas/integration@3.0.0-patch.987`),
  zero consumers, not a dep of the live runtime — but it is a *sideshow*, not
  "the" cross-provider router.

**Revised task emphasis:** the highest-value wiring is NOT resurrecting the
integration mock — it is (T2′) consuming the existing `getRouter()` bridge so
Ruflo agents can opt into agentic-flow's `ModelRouter` (gaining its real
failover), and (T2″) finishing `selectByCost`'s real per-token cost calculation.
T1's triage of the `@claude-flow/integration` `MultiModelRouter` thus reduces to
KEEP-AS-CAPABILITY or DELETE, since agentic-flow already supplies the live
capability.

* Evidence: `@sparkleideas/agentic-flow@2.0.2-alpha-patch.980`
  `dist/router/router.js` (selectProvider :213, selectByCost :270 w/ TODO,
  handleProviderError fallback :300-320, 5 provider imports :5-9);
  `cli/dist/src/services/agentic-flow-bridge.js:34` `getRouter()` (no live
  consumer); `cli/dist/src/mcp-tools/agent-tools.js:98` (Ruflo's own
  `ruvector/model-router.js`); `@sparkleideas/integration@3.0.0-patch.987`
  `dist/multi-model-router.js:617` (mock). User-facing README §2 corrected to match.

## Addendum 2 (2026-06-10, adversarial re-verification + provenance trace): T1 RESOLVED → KEEP (track upstream); the cost-selector gap was overstated

An independent 8-agent verification swarm re-probed every claim against fresh
Verdaccio installs (`@sparkleideas/integration@3.0.0-patch.987`) and the
shipped runtime (cli patch.432, agentic-flow patch.980; npx cache ≡ Verdaccio
latest). All load-bearing claims CONFIRMED: the integration `MultiModelRouter`
mock (`dist/multi-model-router.js:617`, zero consumers across fork src,
published dist, and the live runtime closure — `integration` is not even in
the live node_modules tree); agentic-flow's `ModelRouter` real with working
`fallbackChain` failover (`router.js:300-320`), consumed in-package by
reasoningbank (`judge.js:16`/`matts.js:25`/`distill.js:20`); `selectByCost`
static order + literal TODO (`router.js:270-282`; `'openai'` in that order is
not even an instantiated provider); the bridge `getRouter()` consumed only by
its own `capabilities()`; USERGUIDE `:894` (wrong) vs `:45-47` (right) both
still present in the fork today; ALL savings figures still present —
including the 250% subscription-extension line (USERGUIDE:319/321, fork AND
upstream), which joins T4's reconciliation set.

Two material corrections:

1. **T1 RESOLVED → KEEP, track upstream (NOT delete, NOT wire).** An earlier
   same-day draft of this addendum wrongly recommended **DELETE** ("ADR-0210
   advertised-lie") — reproducing the exact over-deletion reflex this corpus
   warns against (`feedback-no-consumer-is-not-stub`). A provenance trace,
   prompted by the user disbelieving that call, corrected it on evidence:
   * The file is **byte-identical to `ruvnet/ruflo` `origin/main`** (`diff`
     clean) — vendored UPSTREAM code, not fork-authored, added by rUv's
     2026-01-05 V3 checkpoint commit `aa89620a7`. Deleting it buys permanent
     merge-tax on identical code with no positive divergence case.
   * `executeCompletion` is **upstream's own** stub (comment: "Provider API
     integration point — external calls via provider adapters"), and the
     sibling `ProviderAdapter.executeRequest` in the same package is **also**
     a stub ("actual API calls via external integrations"). So the package is
     a routing-**decision/orchestration scaffold** — real `route()` scoring +
     circuit-breaker, deliberately stubbed execution leaf — NOT a lie about a
     working executor. The ADR-0210 "advertised-lie" framing was wrong: it is
     upstream's sectioned library export of a coexisting decision layer, not a
     fork-introduced advertisement of a working tool.
   * **Upstream's documented routing intention lives in the REAL systems, not
     this mock:** ADR-026 (the live 3-tier Agent-Booster + haiku/sonnet/opus
     tier router, `ruvector/model-router.ts`), ADR-011 (`@claude-flow/providers`,
     6 validated real providers), ADR-001 (adopt agentic-flow, don't
     duplicate). ADR-011 references this integration router **once**, under
     **Neutral** consequences ("Integration with existing … multi-model-router"
     / "Can coexist with agentic-flow's provider system"); upstream's own
     stub-remediation ADRs (063/064/066) never mention it. It is
     upstream-**incidental** scaffolding — neither ADR-blessed as load-bearing
     nor ADR-flagged for removal.
   * The live cross-provider need is already met on the hot path by
     `agent-execute-core` (real `fetch` to anthropic/openrouter/ollama,
     verified), so there is no forcing need to WIRE.

   **Decision (Henrik, 2026-06-10): KEEP, track upstream; do NOT wire it
   unless/until upstream wires it; do NOT delete.** The earlier
   "salvage `scoreModels`/circuit-breaker separately" note is withdrawn — no
   fork-side extraction; track upstream verbatim and inherit any future
   upstream wiring on sync. Naming nit retained: `ProviderRegistry` is NOT in
   `integration` — it lives in `v3/@claude-flow/plugins/src/providers/index.ts`
   (equally unconsumed; same KEEP-track-upstream logic applies).
2. **Addendum gap (ii) — "a true dynamic cheapest-cost selector is not yet
   implemented" — was overstated.** A real dynamic cost selector SHIPS in the
   same agentic-flow package: `dist/services/cost-optimizer-service.js` (243
   lines — per-1K price table, `value = qualityScore/((cost+0.0001)*latency)`
   :118, budget-exceeded→cheapest :126-131), MCP-exposed via
   `cost-optimizer-tools.js` and registered in `stdio-full.js` — advisory and
   UNWIRED from `ModelRouter.selectByCost`. **T2″ therefore reduces to "wire
   the existing service into dispatch", not "implement cost calculation".**
   (Its header adds a FIFTH unreconciled savings figure — "90% cost savings" —
   for T4.)

The user-facing README (rewritten 2026-06-09, commit `38ac38a`) already
reflects the CostOptimizerService; this ADR's first Addendum was one
investigation-generation behind its own counterpart.

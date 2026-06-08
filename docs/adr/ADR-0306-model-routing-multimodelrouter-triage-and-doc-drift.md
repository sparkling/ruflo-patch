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
   re-exported in `integration/src/index.ts`). Consequence: **automatic
   cross-provider failover and automatic cheapest-capable-model selection are NOT
   on the live path** — the working dispatcher chooses one provider by explicit
   env precedence, no auto-arbitrage. This is a `feedback-no-consumer-is-not-stub`
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

* **T1 — Triage `MultiModelRouter` (the real decision).** Decide WIRE vs
  KEEP-AS-CAPABILITY vs DELETE per `feedback-no-consumer-is-not-stub`. Default
  lean: KEEP-AS-CAPABILITY + document it as available-but-unwired, OR WIRE it if
  cross-provider auto-failover/cost-arbitrage is a wanted product capability.
  NOT delete (real code).
* **T2 — If WIRE:** route `agent-execute-core.ts`'s provider selection through
  the router's `scoreModels()` + circuit-breaker (replace its mock
  `executeCompletion` with the real `callOpenAICompat`/`callOllamaCompat`/
  Anthropic dispatch), with an acceptance check proving cost-based selection +
  failover on the live path. If KEEP: document the unwired status honestly at the
  call site + in the USERGUIDE.
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

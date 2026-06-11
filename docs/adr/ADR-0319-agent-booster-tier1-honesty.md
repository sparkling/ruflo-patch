---
status: accepted
date: 2026-06-11
tags: [routing, honesty, agent-booster, dead-code, fix, batch-u-followup]
supersedes: []
depends-on: [ADR-0172]
implements: []
---

# Agent-Booster Tier-1 advertises a $0/WASM edit that the fork does not run

## Context and Problem Statement

The fork's `EnhancedModelRouter` advertised Tier-1 as **"Agent Booster (WASM),
352x faster, $0, skip LLM"** for all six edit intents and told users (CLAUDE.md,
hook output) to invoke a phantom `agent_booster_edit_file` MCP tool — but:

1. The fork ships **no transform executor**. The reachable `route()` path is
   pure-regex intent matching; it returns `tier:1, cost:0, canSkipLLM:true` and
   tells the human to "skip LLM, use Edit" — nothing runs the transform.
2. The `execute()` → `tryAgentBooster()` path was **dead** (zero production
   callers) and imported a **non-resolving** `agentic-flow/agent-booster`
   (`dist/agent-booster/index.js` absent), falling through to an `npx
   agent-booster` phantom.
3. Three of the six intents — `add-types`, `add-error-handling`, `async-await` —
   **genuinely require inference**, yet were advertised as $0/no-LLM Tier-1.
4. `agent_booster_edit_file` is a phantom MCP tool that does not exist in the fork.

This is an [[ADR-0172]]-class honesty violation (advertising a capability the
fork doesn't deliver), the same defect upstream fixed in `0988d92ce` (ADR-143).
Surfaced + verified as a Batch-U ([[ADR-0313]]) follow-up.

## Decision

Apply the **honesty fix** (upstream "fix A"); **defer** porting upstream's real
TS-compiler codemod engine ("fix B") to a separate effort.

- Narrow $0 Tier-1 to the 3 genuinely-deterministic intents (`var-to-const`,
  `remove-console`, `add-logging`) via a new `isDeterministicIntent()` guard on
  `route()`; the inference intents fall through to normal model routing (still
  *detected*, so the bandit/routing signal is preserved).
- Reword emit/telemetry + the `hooks_route` tool description: drop
  `Agent Booster`/`WASM`/`352x`/`$0`/`<1ms`; `[AGENT_BOOSTER_AVAILABLE]` →
  `[DETERMINISTIC_EDIT]` ("apply via Edit; no LLM needed"). The
  `handler: 'agent-booster'` result literal is kept for telemetry-schema
  stability (documented).
- Delete the phantom `agent_booster_edit_file` reference (agent-tools + ADR-026).
- Delete the dead `execute()`/`tryAgentBooster()` + the now-orphaned
  `agentic-flow/agent-booster` ambient decls (both scoped forms, zero importers).
- Correct both `CLAUDE.md` files to the honest framing.

## Consequences

- Good: the router no longer promises $0/no-LLM/WASM for edits that need an LLM
  or that nothing executes; Tier-1 is an honest "apply this small structural
  edit yourself via Edit at no model cost" hint for the 3 deterministic intents.
- Good: removes dead, non-resolving code + a phantom tool reference.
- Deferred: porting the real TS-compiler codemod engine (would make $0 Tier-1
  literally *executable*) — tracked in the Batch-U ledger as "fix B". Also
  deferred: a separate "Token Optimizer (Agent Booster) 352x" claim in an
  unrelated subsystem (`getTokenOptimizer`/`@claude-flow/integration`) that needs
  its own verification.

## Confirmation

Guardrail test `__tests__/enhanced-router-tier1-honesty.test.ts`: `route()` →
`tier:1`/`cost:0` only for the 3 deterministic intents, `tier>=2`/defined model
for the inference intents. Rides the cli vitest suite (pipeline test-ci).
`tsc --noEmit` clean. Shipped: forks/ruflo `2227145c2`.

## More Information

Batch-U row in `docs/upstream/INTEGRATION-LEDGER.md`; upstream `0988d92ce`/ADR-143.
Honesty lineage: [[ADR-0287]], [[ADR-0306]], [[ADR-0317]].

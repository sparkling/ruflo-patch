---
status: proposed
date: 2026-06-11
tags: [routing, codemods, tier-1, fix-b, batch-u-followup, upstream-port]
supersedes: []
depends-on: [ADR-0319]
implements: []
---

# Deterministic codemod engine — executable Tier-1 ($0, no LLM)

## Context
ADR-0319 made model-router Tier-1 an honest "apply this small edit yourself via
Edit" recommendation and deferred porting upstream's real executor ("fix B").
This ADR ports it (upstream `0988d92ce`/ADR-143): a TypeScript-compiler codemod
engine that ACTUALLY performs the 3 deterministic structural edits
(`var-to-const`, `remove-console`, `add-logging`) at $0/no-LLM.

## Decision
New `v3/@claude-flow/cli/src/ruvector/codemods/{engine.ts,scope-analysis.ts}` —
formatting-preserving, text-range edits via the TS compiler. No embeddings/ONNX/
RVF → no ADR-0068 mpnet conflict. `enhanced-model-router.ts` Tier-1 now executes
the codemod with a route-time dry-run (fires only when the edit changes the
file); inference intents still route to a model; `isDeterministicIntent`
delegates to the engine (single source of truth); ADR-0319 back-compat aliases
kept. A `hooks_codemod` MCP tool exposes it (in the ADR-0326/0327 commit).
`typescript` moved cli devDep→dependency (engine imports it at runtime).

## Consequences
- Good: Tier-1 $0/no-LLM is now LITERALLY true for the 3 intents (no longer a
  delegate-to-human recommendation), closing the ADR-0319 "fix B" gap.
- Tradeoff: `typescript` is now a cli runtime dependency (+install size) — a
  tree-shrink/lazy-load optimization is a possible follow-up.

## Confirmation
23+4 vitest cases (codemod-engine + codemod-routing): all 3 transforms,
no-op/idempotency detection, malformed-input safety, dry-run routing. tsc clean.
forks/ruflo `a19e479b7` (engine+router) + `bf8d585f9` (hooks_codemod tool).

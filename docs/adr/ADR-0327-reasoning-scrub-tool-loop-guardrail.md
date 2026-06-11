---
status: proposed
date: 2026-06-11
tags: [intelligence, hooks, embeddings, guardrail, batch-u-followup, upstream-port]
supersedes: []
depends-on: [ADR-0068]
implements: []
---

# Reasoning-block scrub + tool-loop guardrail

## Context
Upstream `c983c0d80` (#14 + #6): strip extended-thinking blocks before distill,
and an advisory same-command failure-loop breaker. Batch-U deferred follow-up.

## Decision
- #14 `scrubReasoningBlocks()` (strip `<think>`/`<thinking>`/`<reasoning>`/
  `<REASONING_SCRATCHPAD>`, boundary-gated) at the fork's trajectory-step seam in
  `hooks-tools.ts`. VERIFIED the fork HAS the extended-thinking trajectory path
  (`hooks_intelligence_trajectory-step` → `distillLearning` embeds step text into
  mpnet vectors) — so this keeps ADR-0068 pattern embeddings clean (not a no-op).
- #6 new `tool-loop-guardrail.ts` (advisory warn@3/block@5 same-command
  consecutive failures), wired into pre/post-command; orthogonal to the security
  guardrail.

## Consequences
Good: cleaner pattern embeddings; advisory loop-break signal.
Neutral: tool-loop is advisory (does not hard-block).

## Confirmation
adr0327 vitest (scrub strips/boundary-gates; loop warn@3/block@5). tsc clean.
forks/ruflo `bf8d585f9`.

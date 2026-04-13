# ADR-0087: Adversarial Prompting Workflow

- **Status**: Proposed
- **Date**: 2026-04-13
- **Source**: Michael Truell (Cursor co-founder), Lenny's Podcast, late 2025; Medium article by Adi Insights and Innovations, Mar 21 2026

## Context

AI-assisted development defaults to an "autocomplete" pattern: describe what you want, accept or reject what the AI writes. The feedback loop runs in one direction — developer instructs, AI executes. This produces code that does exactly what was asked for, which is the failure mode: **you asked for the wrong thing**.

Michael Truell (Cursor, $300M ARR, $9.9B valuation) ships 10x faster than his own engineers using a workflow built on three principles that challenge this default.

## Decision

Adopt the following practices for AI-assisted development in this project:

### 1. Adversarial Prompting Before Implementation

Before writing code for any non-trivial feature or architectural change:

1. Describe the proposed approach to the AI
2. Ask it to find the **three best reasons the architecture is wrong**
3. Ask what a **senior engineer would say about this decision three years from now**
4. Only after this adversarial pass, proceed with implementation

Use AI to be **less wrong**, not to go faster. The distinction sounds subtle; the productivity difference is enormous.

### 2. Parallel Thinking Sessions

AI sessions are not conversations — they are a workforce. Different sessions are different **types of thinking** happening simultaneously:

| Session | Role | What it does |
|---------|------|--------------|
| 1 | Implementation | Writes the feature |
| 2 | Adversarial Review | Argues against the approach, finds flaws |
| 3 | Test Generation | Builds tests in parallel with code |
| 4 | Documentation | Writes docs while context is fresh |
| 5 | Simplification | Cleans up what was just written |

This eliminates sequential waiting — a PR that took a day takes two hours because 60% of the time was sequential waiting that nobody noticed.

### 3. Living Constitution (CLAUDE.md)

The project's CLAUDE.md is not just style preferences. It captures:

- **Decisions and their reasons** — why this architecture, not alternatives
- **What was tried and didn't work** — prevents repeating past mistakes
- **Definition of done** — what "finished" means for this project specifically

The file compounds over time. Every mistake gets encoded. Every hard-won insight becomes a permanent instruction. Context is a codebase asset — versioned, shared, continuously improved.

### 4. Prototypes Over Specifications

Working proof-of-concept built with AI replaces written specification documents where appropriate. The prototype surfaces every question a written document would have created — and answers half of them automatically just by existing.

"Writing about software is now slower than building it."

### 5. AI-First Review

The bottleneck in AI-assisted development is **reviewing** code, not writing it. AI performs first-pass review before any human sees the code:

- Catches style/convention violations
- Identifies missing edge cases
- Flags architectural concerns
- Reduces human review to judgment calls only

## Measured Impact (Cursor team metrics)

| Metric | Before | After |
|--------|--------|-------|
| Feature cycle time | 2-3 weeks | 3-5 days |
| PR review turnaround | 48-72 hours | Same day |
| Bug re-introduction rate | ~18% | ~6% |
| Engineer satisfaction | 6.8/10 | 8.9/10 |
| Lines reviewed/day/engineer | ~400 | ~1,800 |

## How This Applies to ruflo-patch

| Principle | Current practice | Change |
|-----------|-----------------|--------|
| Adversarial prompting | Plan mode exists but optional | Use adversarial pass in plan mode for architectural changes |
| Parallel sessions | Swarm agents exist | Frame agent sessions as thinking types, not just task splits |
| Living constitution | CLAUDE.md is comprehensive | Add "What We Tried and Won't Try Again" section |
| Prototypes > specs | ADRs document decisions | Keep ADRs, but prototype first when exploring alternatives |
| AI-first review | Manual review | Add adversarial review step before human review |

## Consequences

- Slightly slower start to implementation (adversarial pass adds 5-10 minutes)
- Significantly fewer wrong-direction implementations
- CLAUDE.md becomes an increasingly valuable asset over time
- Review bottleneck shifts from human throughput to AI context quality

# ADR-0087: Adversarial Prompting Workflow

- **Status**: Implemented (Phases 1-3 complete, all principles active)
- **Date**: 2026-04-13
- **Phase 1**: 2026-04-13 — Adversarial prompting hook (`.claude/helpers/adversarial.cjs`)
- **Phase 2**: 2026-04-13 — Parallel thinking sessions (`recommendSessions()`, `sessionAdvisory()`)
- **Phase 3**: 2026-04-13 — AI-first review (`reviewChecklist()`, `reviewAdvisory()`)
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

- Catches style/convention violations (`conventions`)
- Identifies missing edge cases (`edge-cases`)
- Flags architectural concerns (`architecture`)
- Checks security at system boundaries (`security`)
- Verifies test coverage at all levels (`test-coverage`)
- Assesses backward compatibility and migration impact (`compatibility`)
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

| Principle | Status | Implementation |
|-----------|--------|----------------|
| Adversarial prompting | **Phase 1 done** | `classify()` + `advisory()` in route hook; auto-flags architectural prompts |
| Parallel sessions | **Phase 2 done** | `recommendSessions()` + `sessionAdvisory()` emit session types in route hook |
| Living constitution | **Done** | CLAUDE.md has "What We Tried" section, adversarial workflow, behavioral rules |
| Prototypes > specs | Process guideline | Keep ADRs, but prototype first when exploring alternatives |
| AI-first review | **Phase 3 done** | `reviewChecklist()` + `reviewAdvisory()` emit review focus areas in route hook |

## Phase 3 Validation (8-agent swarm, 2026-04-13)

Phase 3 was validated by an 8-agent swarm (its own AI-first review principle applied to itself). Agents and findings:

| Agent | Focus | Verdict |
|-------|-------|---------|
| code-quality | Bugs, logic errors | Clean — no issues |
| test-completeness | Path coverage audit | Pass — all branches covered, 10/10 triggers tested |
| pattern-consistency | Phase 1/2/3 alignment | 10/10 checks pass |
| integration-tracer | Hook wiring paths | 6/6 paths verified |
| security-review | Injection, ReDoS, pollution | 1 fix: ReDoS in `removal` regex (Phase 1, pre-existing) |
| adr-accuracy | Document vs code | 2 fixes: CLAUDE.md gap, ADR category list |
| edge-case-analysis | Boundary conditions | 1 fix: `Array.isArray` guard on advisory functions |
| regression-check | Phase 1/2 unchanged | 8/8 checks pass |

Fixes applied: bounded `removal` regex `{0,5}`, `Array.isArray` guards on `sessionAdvisory`/`reviewAdvisory`, CLAUDE.md updated, ADR principle 5 expanded to list all 6 categories.

## What's Next

All 5 principles are implemented or established as process. Potential future work:

- **Metrics collection** — track advisory hit rates (which triggers fire most), effectiveness (do advised tasks have fewer regressions), and coverage (% of architectural prompts that get adversarial review)
- **Enforcement** — post-task hook checks whether advised review areas were actually addressed before marking complete
- **Living constitution automation** — auto-capture adversarial findings into CLAUDE.md "What We Tried" section after each pass

These are enhancements, not required for the ADR to be considered implemented.

## Consequences

- Slightly slower start to implementation (adversarial pass adds 5-10 minutes)
- Significantly fewer wrong-direction implementations
- CLAUDE.md becomes an increasingly valuable asset over time
- Review bottleneck shifts from human throughput to AI context quality

---
status: accepted
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, infrastructure, vitest, tsc, side-effects, ADR-0193, ADR-0195, ADR-0197]
related: [0193, 0195, 0197]
upstream-related: []
audience: ai-executor
---

# ADR-0198: Additional side-effect findings from ADR-0193 implementation

## Context and Problem Statement

ADR-0197 recorded three architecture-level findings that surfaced during ADR-0193 execution: the `learningSystem.predictAction` latent bug, the `@ruvector/gnn` scope correction, and the QUIC substrate audit. After ADR-0197 was accepted, a final ADR-0193 audit surfaced two more findings that fell outside ADR-0197's scope:

1. The outer-monorepo vitest install path is broken due to a Verdaccio version gap.
2. `autopilot-cli.ts` references properties that don't exist on producer types.

Both are real and recorded here so they don't decay. Same pattern as ADR-0197 (record + disposition per finding) but in a separate ADR to keep ADR-0197's "three findings" snapshot historically clean.

## Finding 1 — Outer-root vitest install blocked by missing Verdaccio version

### Where

`forks/agentic-flow/` (the monorepo outer root) declares vitest in its outer-root `package.json` devDependencies. Running `npm install` at that level fails because `@ruvector/rvf@0.2.0-patch.147` (a transitive dependency) is not published to Verdaccio.

### What's wrong

`tests/integration/autopilot*.test.ts` lives at the outer-root level. The standard test invocation pattern would be:

```bash
cd forks/agentic-flow
npm install                   # blocked: rvf@0.2.0-patch.147 not in Verdaccio
npx vitest run tests/integration/autopilot-drift-learning.test.ts
```

Wave 1 Agent 3 (Item E, `drift-detector.ts` + `swarm-completion.ts`) hit this when verifying the 23/23 integration test suite. Workaround used: shimmed vitest at `/tmp/agent3-vitest-shim/` by manually installing vitest + symlinking deps into the outer `node_modules/`. The shim is non-durable; the next agent who tries to run these tests will hit the same blocker.

### Why it matters

* **The outer integration test surface is functionally unreachable** via standard `npm test` / `npx vitest` workflow. Agent 3's report flagged: "the outer integration tests aren't referenced from any script I could find."
* **Future regressions go uncaught**: `tests/integration/autopilot-drift-learning.test.ts` (23 it-blocks) and `tests/integration/autopilot-learning.test.ts` (13 it-blocks) are not exercised by `npm run release` from `ruflo-patch`. Source changes to `autopilot-learning.ts` or `drift-detector.ts` / `swarm-completion.ts` could break these without acceptance signal.
* **The test files exist as binding specs** — they're how Item E's contract was defined. Letting them rot defeats their purpose.

### Decision

**Bump or remove `@ruvector/rvf` requirement.** Two paths:

1. **Bump `@ruvector/rvf` to a Verdaccio-available version** (or unblock `0.2.0-patch.147` if it's a publish-cascade gap rather than a missing release). Lets the standard `npm install` + `npx vitest` workflow work.
2. **Restructure tests** — move `tests/integration/autopilot*.test.ts` into the inner `agentic-flow/` package so they install + run against the inner's `node_modules`. More invasive; preserves the integration-test value.

Path 1 is simpler. Defer the path choice to whoever picks this up; both work.

### Tracking

This ADR. Acceptable to defer until either ADR-0195 Phase 4 implementation OR the next time someone tries to run the outer integration tests. No urgency — the populated assertion coverage already exists at the inner-package vitest level (`forks/agentic-flow/agentic-flow/src/coordination/*.test.ts` if any) plus ruflo-patch's `ctrl-autopilot-*` acceptance probes.

## Finding 2 — `autopilot-cli.ts` references non-existent producer type properties

### Where

`forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` references properties that don't exist on `DiscoveredPattern` / `AutopilotEpisode` / the `predictNextAction` return type. Wave 1 Agent 1 enumerated:

* `successRate`
* `taskType`
* `approach`
* `uses`
* `success`
* `similarity`
* `task`
* `alternatives`

### What's wrong

The agentic-flow inner package builds with `tsc --noCheck` (per `scripts/build-packages.sh:315`; `--noCheck` is intentional because the fork has 256 pre-existing type errors). So these property-access errors don't fail the build — they ship to runtime where they evaluate to `undefined`.

Downstream user-facing CLI output that depends on these properties either:

* Prints `undefined` literally
* Falls through nullish handling to an empty/default value
* Or throws at a later step if the undefined value is used in a non-nullable context

Wave 1 Agent 1 confirmed the errors are PRE-EXISTING — not introduced by ADR-0193's Phase 2 changes. The CLI consumer was already out of sync with the producer's typed surface before this work began.

### Why it matters

* **CLI output is silently degraded**: users running `autopilot status` / `autopilot patterns` / similar may see `undefined` fields without obvious error.
* **`--noCheck` masks new regressions too**: any future producer-side rename can trip the same dead-on-arrival pattern; the build won't flag it.
* **Type drift between cli consumer and producer surface is the underlying disease**: the CLI was written against an earlier version of `DiscoveredPattern` / `AutopilotEpisode` and never updated when the types changed.

### Decision

**Defer to ADR-0195 Phase 4 implementation OR fix standalone — whichever lands first.**

Reasoning:

* Phase 4 (ADR-0195) will rewrite parts of the CLI surface to wire AutopilotLearning → LearningSystem via the real `predict` / `submitFeedback` calls (see ADR-0197 Finding 1). The CLI's interaction with `DiscoveredPattern[]` will be re-touched during that work; fixing the type drift in the same change avoids two commits touching the same file.
* If Phase 4 is deferred indefinitely, the standalone fix is straightforward: read each missing property's call site, look up the actual producer type, rename the access to match.

Acceptable risk: the drift produces `undefined` output, not wrong behavior. CLI consumers see degraded output (missing fields); they don't see incorrect data. Low-severity defect.

### Optional improvement (not part of this ADR's decision)

Drop `--noCheck` from agentic-flow tsc invocation in `scripts/build-packages.sh:315` and triage the 256 pre-existing errors. That's a much larger scope than ADR-0198 covers — flag it for a future cleanup pass. Same pattern other forks have addressed by buying down their tsc-error backlog.

### Tracking

This ADR + tagged in ADR-0195's Phase 4 implementation notes (Phase 4 should fix or explicitly defer).

## Decision Outcome

Per finding:

1. **Finding 1** (vitest install): document and defer. Path forward documented (bump `@ruvector/rvf` OR restructure tests). Pick when convenient OR when the integration suite next becomes load-bearing.
2. **Finding 2** (autopilot-cli type drift): defer to ADR-0195 Phase 4. Standalone fix is acceptable if Phase 4 is delayed.

## Consequences

### Positive

* Both findings recorded with explicit dispositions instead of decaying into "we noticed something."
* Future agents who hit the vitest install blocker will see this ADR and won't re-shim from scratch.
* Phase 4 implementation has a concrete pre-existing-bug to discharge as part of its work.

### Negative

* Vitest workaround (Agent 3's shim) is non-durable. Re-installing it on every test run is wasted effort. The cost compounds the longer Finding 1 sits.
* `--noCheck` masking the type drift in `autopilot-cli.ts` also masks any future drift introduced elsewhere. The bug-shape is permitted to recur until `--noCheck` is removed.

### Risks

* **Finding 1 cascades**: if a future ADR depends on running the outer integration tests as part of acceptance (instead of standalone), the missing-Verdaccio-version blocker becomes a release blocker. Mitigation: tackle Finding 1 BEFORE adding any release-gated dependency on outer-vitest.
* **Finding 2 escalates**: if `--noCheck` is removed without first fixing the type drift, the build immediately starts failing. Mitigation: fix Finding 2 BEFORE attempting to remove `--noCheck`. (And: don't remove `--noCheck` as a side-effect of unrelated work.)

## Tracking

* Finding 1 → this ADR. No other tracker.
* Finding 2 → this ADR + reference from ADR-0195 Phase 4 implementation notes (when Phase 4 work begins, this is a pre-existing bug the work must address or explicitly defer).

This ADR closes immediately on acceptance — it records discoveries with dispositions, not an implementation plan.

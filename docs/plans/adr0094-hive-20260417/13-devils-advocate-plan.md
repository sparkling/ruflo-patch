# 13 — Devil's Advocate: Attack on the ADR-0094 → 100% Plan

**Role**: Adversary. Stop the Queen from ratifying a plan that ADR-inflates, calendar-slips, and ships the wrong finish line.

## Attack 1 — "8 sprints × 15 agents = progress"

**Attack**: Hive is ADR-inflating, not shipping.

**Evidence**: `git log --since="36h"` = **18 ADR/patch commits**. ADR-0094 status (`ADR-0094-100-percent-acceptance-coverage-plan.md:3`): *"In Implementation — cannot advance until ADR-0095 closes"*. ADR-0095/0096/0097 all *"Proposed — 2026-04-17"*. **4 ADRs drafted, 0 implemented.**

**Rebuttal**: "Each ADR unblocks a different concern; parallelizable."

**Counter**: Parallel drafting is cheap; parallel implementation isn't — bottleneck is fork merge-order. Shipping ADR-0094 beats launching 0098.

**If right**: No ADR above 0097 drafted until 0094 is `Implemented`. Enforce: `grep -c Proposed ADR-009*.md` monotone decrease.

## Attack 2 — "Sequential sprints protect quality"

**Attack**: DAG (0 → 0095 → 0096 → 0097 → 8 → 9 → 10) is 4+ weeks before Phase 9 sees a keystroke.

**Evidence**: Phase 9 concurrency checks read source files; don't require 0096's catalog.

**Rebuttal**: "Sequencing prevents rework."

**Counter**: Commit `add002f fix: 29/30 failures` shows rework is cheap when checks are well-scoped. Expensive only when foundation is wrong — that's ADR-0086, not 0095.

**If right**: Fan 8/9/10 parallel with 0096/0097; accept ~15% rework. 2 weeks, not 4.

## Attack 3 — "Swarms produce better code"

**Attack**: Swarms amplify *confidence* without *correctness*.

**Evidence**: This session, t3-2 fix-swarm-agent self-reported "10/10" while real test failed (BUG-0008, `ADR-0094-log.md`). Previous B7 guard passed but was wrong-scope (CLAUDE.md ADR-0090 Tier A1).

**Rebuttal**: "Verification swarms catch that."

**Counter**: Verification swarms share groupthink with bigger context. Fix was a *single* out-of-scope probe.

**If right**: Cap swarms at 4 (impl + adversary + probe-writer + human). Ban 15-agent swarms below 0094 scope.

## Attack 4 — "≥80% verified is the ship line"

**Attack**: 80% is a round number, not risk-calibrated. 95% doubles final-push cost for maybe 1 bug.

**Evidence**: ADR-0094 log shows BUG-0008→0011 all in the first 80%. Density falls off past hot paths.

**Rebuttal**: "Underspec causes ADR-0082 silent-pass bugs."

**Counter**: 0082 is about *zero* verification, not the 80→85% tail.

**If right**: Ship = `invoked==100% AND verified≥85%`. Saved capacity → Phase 11+.

## Attack 5 — "Fork patches are acceptable cost"

**Attack**: Patch count grows with no ceiling. At N=30+, upstream merge is a week; at N=50+, impossible.

**Evidence**: 3 patch commits in 36h; crosses N=30 in ~2 months. CLAUDE.md already logs upstream-merge-tax (ADR-0089).

**Rebuttal**: "Every patch is a real bug."

**Counter**: Push upstream *first* with timeout; current flow skips that.

**If right**: Cap 15 outstanding. Patch #16 requires upstream PR + 14-day timeout.

## Attack 6 — "ADR-0087 out-of-scope probes solve wrong-scope fixes"

**Attack**: Rule is good; enforcement is cosmetic. Same agent writing fix AND probe inherits same blind spot.

**Evidence**: ADR-0090 Tier A1 guard passed because implementer's probe matched their own wrong model.

**Rebuttal**: "Adversarial agent reviews both."

**Counter**: Adversary reviews prose, not probe binding.

**If right**: Hard rule — probe-writer ≠ fix-writer. Pre-commit hook diffs `Authored-by` on co-located files.

## Attack 7 — "Skip hygiene cron is durable"

**Attack**: Background script with no blocking consumer silently rots.

**Evidence**: CLAUDE.md "won't try again" includes daemon drift (ADR-0088). Pattern recurs.

**Rebuttal**: "Cron emits metrics."

**Counter**: Metrics need a watcher this repo lacks.

**If right**: Move skip-reverify into `test:acceptance` cascade (step 9). Rot fails next commit.

## Attack 8 — "Phases 11-17 are budget-gated backlog"

**Attack**: Budget-gated == never happens.

**Evidence**: ADR-0069 "future vision" still has unstarted items.

**Rebuttal**: "We'll revisit after 0094."

**Counter**: There is always another 0094-equivalent.

**If right**: Every sprint picks ONE Phase 11+ item, capped at 10%. No "later".

## THREE HARD VETOES

1. **VETO any plan drafting ADR-0098+ before 0094 is `Implemented`.** Four unimplemented ADRs is the failure mode this hive exists to prevent.

2. **VETO 15-agent swarms for sprints narrower than 0094 scope.** Evidence: swarms self-certify green while reality is red; cost is correctness, not tokens.

3. **VETO verified_coverage ≥ 80% as ship line without sign-off that 85% is infeasible.** 80% is a round number; accepting it locks in a 15-point blind spot forever.

*Closing*: The plan is thorough. Thoroughness is the failure mode. Ship 0094 first; plan 0098 never.

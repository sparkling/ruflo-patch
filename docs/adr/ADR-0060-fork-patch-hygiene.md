# ADR-0060: Fork Patch Hygiene

- **Status**: **Implemented — ongoing governance (2026-05-03)**. Rules established 2026-04-04; codified in CLAUDE.md and fork-related memory entries (`feedback-patches-in-fork.md`, `feedback-trunk-only-fork-development.md`). No further changes pending.
- **Date**: 2026-04-04
- **Deciders**: ruflo-patch maintainers
- **Methodology**: 5-expert hive audit (ruflo, ruvector, agentic-flow specialists)

## Context

During ADR-0059 implementation, acceptance testing revealed that several fork patches were fixing bugs introduced by prior fork patches — not upstream bugs. A systematic audit of all fork-only commits identified 10 fix-on-fix patterns, 5 upstream-already-fixed cases, and 7 stale patches across 2 forks.

## Decision

Establish rules to prevent fix-on-fix accumulation and maintain fork hygiene.

## Audit Findings

### Fix-on-Fix Patterns (revert both, use upstream)

| # | Repo | Commits | Pattern | Action |
|---|------|---------|---------|--------|
| 1 | ruflo | `243386a` → `d7654639b` → `7f4b7064d` | Xenova/ prefix: add → add more → remove band-aid | Self-resolved (net zero) |
| 2 | ruflo | `544fb22c9` → `dc4133aa4` | bridgeGenerateEmbedding: fix → revert | Self-resolved (net zero) |
| 3 | ruflo | `7c3b3b270` → `866b62a05` | getBridge timeout: add → revert | Self-resolved (net zero) |
| 4 | agentic-flow | ADR-0052 → `fc03655` | LLMRouter dotenv: fork added import → fork had to fix crash | Reverted to upstream (upstream never had dotenv import) |
| 5 | agentic-flow | Fork barrel rewrite → duplicate export fix | index.ts: fork broke exports → fix own break | Reverted to upstream barrel |

### Upstream-Already-Fixed

| # | Repo | What | Action |
|---|------|------|--------|
| 1 | ruflo | config-adapter.ts cacheSize 100K | Already reverted by portable defaults commit |
| 2 | agentic-flow | EnhancedEmbeddingService export path | Reverted to upstream path |

### Stale Patches (upstream diverged)

| # | Repo | File | Risk |
|---|------|------|------|
| 1 | ruflo | controller-registry.ts (+500 lines) | Highest merge conflict risk — upstream refactors will collide |
| 2 | ruflo | memory-bridge.ts (+300 lines) | Same risk |
| 3 | ruflo | claudemd-generator.ts (full rewrite) | Any upstream changes will conflict |
| 4 | agentic-flow | AgentDB.ts (core rewrite) | Will never merge cleanly |
| 5 | agentic-flow | index.ts barrel (complete rewrite) | Reverted — use upstream |
| 6 | agentic-flow | AttentionService.ts deleted | Fork replaced with LegacyAttentionAdapter |
| 7 | agentic-flow | 100+ new files | Intentional feature additions, not stale |

### Legitimate Patches (keep)

~43 patches across both forks that fix real upstream bugs or add necessary features. See ADR-0059 Appendix A for the subset relevant to ADR-0059.

## Rules (Going Forward)

### Rule 1: Check upstream before patching

Before modifying any fork file, `git diff origin/main -- <file>` to see the current upstream state. If upstream has already changed the code you're about to patch, consider whether the upstream change makes your patch unnecessary.

### Rule 2: No fix-on-fix

If a patch is needed to fix a problem introduced by a prior fork patch, the prior patch is wrong. Revert it and find the correct approach, or use the upstream code.

### Rule 3: Use upstream when possible

If the upstream version of a file works correctly, use it. Don't maintain fork patches that diverge from upstream for marginal improvements.

### Rule 4: Minimize contamination

When patching a file that has upstream changes, make targeted edits (not full rewrites). This keeps the diff small and mergeable.

### Rule 5: Revert-pairs = delete both

If the git history shows `fix X` followed by `revert fix X`, both commits are noise. Exclude them from PRs and clean branches.

## Actions Taken

| Action | Status |
|--------|--------|
| Reverted LLMRouter.ts to upstream (dotenv was fork-only) | Done |
| Reverted index.ts barrel to upstream (fork broke exports) | Done |
| Verified config-adapter.ts matches upstream (cacheSize, vectorDimension) | Done |
| Verified Xenova prefix chain self-resolved (net zero) | Done |
| Verified no server-specific values remain | Done |
| Filed upstream issue ruvnet/ruflo#1526 (ADR-0059 fixes) | Done |
| Created clean PR ruvnet/ruflo#1528 (1 commit, 6 files) | Done |
| Closed ruvnet/agentic-flow#139 + #140 (bug didn't exist upstream) | Done |

## Related ADRs

- **ADR-0059**: RVF Native Storage Backend — triggered this audit
- **ADR-0052**: Embedding Dimension Standardization — source of several fix-on-fix patterns

## Status Update 2026-04-21

**Still active.** This is a standing hygiene policy, not a point-in-time decision, and its five rules remain enforceable against current practice. Evidence that the policy is still driving behaviour as of ADR-0094 closure today:

| Rule | Current-evidence citation |
|------|---------------------------|
| Rule 1 (check upstream before patching) | ADR-0061 line 649 cites ADR-0060 as the governing pipeline rule for fork changes. |
| Rule 2 (no fix-on-fix) | Re-affirmed by the "Deleting upstream-maintained files to satisfy the 500-line rule" entry in CLAUDE.md (2026-04): intercept pattern (ADR-0089) replaced fork-level rewrites rather than layering more patches. |
| Rule 3 (use upstream when possible) | Active constraint behind keeping `controller-registry.ts` at 2063 LOC and `agentdb-service.ts` at 1831 LOC on upstream (ADR-0089). |
| Rule 4 (minimize contamination) | ADR-0066 line 126 cites ADR-0060 specifically flagging controller-registry.ts as the highest merge-conflict risk — guidance still respected in ADR-0089's intercept design. |
| Rule 5 (revert-pairs = delete both) | Still the rule the `publish:fork` pipeline and `npm run sync` workflow follow when grooming fork branches. |

**Why Active (not Superseded):**
- No later ADR replaces these five rules; they are referenced as live policy by ADR-0059 line 525 ("always check upstream before patching"), ADR-0061 line 649, and ADR-0066 line 126.
- The 2026-04 CLAUDE.md lesson "Deleting upstream-maintained files to satisfy the 500-line rule" is a direct application of Rule 3 / Rule 4 to a new case — evidence the rules extrapolate correctly.
- ADR-0094's closure today required the forks to stay buildable and rebased; that was achievable only because ADR-0060's rules kept divergence bounded.

**Items needing attention:**
1. The "Actions Taken" table (Line 73) is historical (all "Done" for the 2026-04-04 audit) and should not be edited further; new audits should append a new dated section rather than reopen rows.
2. The "Stale Patches" table (Line 37) is now out of date on specifics — `controller-registry.ts` and `agentdb-service.ts` are now governed by the ADR-0089 intercept pattern rather than "highest merge-conflict risk, revert". Consider a follow-up Status Update if another fork audit runs.
3. Rule numbers are referenced implicitly elsewhere; any future rule additions should extend (Rule 6+) rather than renumber.

Keep this ADR Active and continue citing it for fork-change decisions.

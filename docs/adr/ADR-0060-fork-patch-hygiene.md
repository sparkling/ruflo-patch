# ADR-0060: Fork Patch Hygiene

- **Status**: Active
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

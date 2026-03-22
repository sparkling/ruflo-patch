---
name: Patch tracking via GitHub issues
description: Every fork patch MUST have a GitHub issue — issues are the tracking record, PRs are the implementation
type: feedback
---

Every fork patch MUST have a corresponding GitHub issue in the fork repo.

**Why:** The user wants all patches tracked as GitHub issues. Issues are the canonical record of what was patched and why. PRs are implementation artifacts that get merged and disappear from view.

**How to apply:** When creating a new patch:
1. Create the GitHub issue FIRST (with label `patch`)
2. Reference the issue number in the PR and commit message
3. Update MEMORY.md Active Patches section with the new ID
4. Never create a patch branch without a corresponding issue

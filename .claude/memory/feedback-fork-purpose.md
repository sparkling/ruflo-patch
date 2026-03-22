---
name: Fork purpose correction
description: The fork builds upstream HEAD (not tags) and publishes as {tag}-patch.N with pinned internal deps — this is the core reason for forking
type: feedback
---

## Why We Fork — The Core Mental Model

The fork exists to **build and publish upstream HEAD**, not the stale tagged releases.

Upstream has hundreds of unpublished commits beyond their last tags (e.g., 933 commits past v3.5.15 in ruflo). We:

1. Build from HEAD of each upstream repo
2. Label that build as `{last-upstream-tag}-patch.N` (e.g., `3.5.15-patch.1`)
3. Pin all internal cross-package deps to these exact `-patch.N` versions
4. Further patches increment: `-patch.2`, `-patch.3`, etc.
5. Publish under `@sparkleideas/*` scope

This is handled by:
- `fork-version.mjs` — computes and stamps `-patch.N` versions
- `publish.mjs` — publishes in topological order with pinned versions
- `sync-and-build.sh` — orchestrates the full pipeline

**Do NOT describe the fork as "just scope renaming"** — the scope rename (codemod) is a secondary concern. The primary value is: users get current upstream code that upstream never published, with correct dependency pinning and bug fix patches.

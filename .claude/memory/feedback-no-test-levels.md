---
name: No L0-L4 test level labels
description: Never use L0/L1/L2/L3/L4 labels for test levels — use plain names (preflight, unit, acceptance)
type: feedback
---

Never use L0, L1, L2, L3, L4 labels for test levels anywhere — code, docs, CLAUDE.md, memory, conversation.

**Why:** ADR-0037 deprecated the opaque layer numbering. All references should use plain names: preflight, unit, acceptance. The old numbering was confusing and has been pruned.

**How to apply:** When discussing tests, say "unit tests", "acceptance tests", "preflight checks" — never "L0 tests" or "L1 unit tests". When writing docs or comments, use descriptive names only.

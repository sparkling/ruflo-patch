---
name: Never dismiss flaky or pre-existing test failures
description: ALL test failures must be investigated and fixed, never dismissed as "pre-existing" or "flaky"
type: feedback
---

NEVER dismiss a test failure as "pre-existing" or "flaky." Every failure is a bug — either in the code under test or in the test itself. Fix it immediately.

**Why:** Calling a failure "pre-existing" or "flaky" is how broken tests accumulate. If upstream code has a bug, patch it in the fork. If the test is fragile, fix the test. There is no third option.

**How to apply:**
- When acceptance tests fail: investigate the exact cause, fix it, verify 32/32
- When a test is non-deterministic: fix the test to be deterministic (e.g., sentinel-based instead of timing-based)
- When upstream generates broken code: patch the generator in the fork
- Never move on with "31/32 is close enough" — that 1 failure will rot

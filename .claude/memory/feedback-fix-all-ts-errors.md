---
name: Fix ALL TypeScript errors including upstream
description: Never leave pre-existing upstream TS errors unfixed — patch them in forks
type: feedback
---

ALL TypeScript errors must be fixed, including pre-existing upstream ones. Do not dismiss them as "pre-existing" or "upstream issues."

**Why:** We own the forks. If upstream code has TS errors, we patch them in our fork source. Leaving errors makes it impossible to tell if new patches introduce regressions.

**How to apply:** After every build, check for TS errors. If any exist, create patches to fix them in the appropriate fork. Track each fix with a GitHub issue on sparkling/ruflo-patch labeled `patch`.

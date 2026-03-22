---
name: no-dry-run
description: Never use deploy:dry-run — we are the only Verdaccio user, always run full deploy
type: feedback
---

Never use `npm run deploy:dry-run` or `--test-only`. We are the ONLY users of this local Verdaccio registry, so there is zero risk to other consumers. Always run `npm run deploy` (full pipeline).

**Why:** dry-run skips the publish stage when no new merges are detected, making it useless for validating pipeline changes. The local Verdaccio is ours alone — no external consumers to worry about.

**How to apply:** When asked to test the pipeline, always use `npm run deploy` (or `bash scripts/sync-and-build.sh --force` to force a build even without new merges).

# Testing Rules (ADR-0023, ADR-0037)

## MANDATORY: Test before committing

1. Identify the change type
2. Run ALL required tests for that type (see table below)
3. ALL tests pass -> commit
4. If a change affects a layer you cannot run (e.g. acceptance needs Verdaccio), tell the user explicitly before committing

## Never declare "done" or "verified" unless every required test suite has been exercised.

## Required tests per change type

| Change | Required Tests | Commands |
|--------|---------------|----------|
| Patch fix.py | preflight + unit | `npm run preflight && npm run test:unit` |
| Codemod/pipeline script | preflight + unit + acceptance | `npm test && npm run test:acceptance` |
| Test script changes only | preflight + unit | `npm run preflight && npm run test:unit` |
| sync-and-build.sh / acceptance changes | preflight + unit + acceptance | `npm test && npm run test:acceptance` (requires prior `npm run build`) |
| Pre-publish verification | preflight + unit + acceptance | `npm run build && npm run test:all` |
| Deploy to Verdaccio (full) | all | `npm run deploy` (runs all suites) |
| Verify live packages | acceptance | `npm run test:acceptance` |

## Test Suites

| Suite | Size | Runner |
|-------|------|--------|
| Environment Validation | Smoke | `npm run validate` |
| Preflight (static analysis) | Small | `npm run preflight` |
| Unit Tests | Small | `npm run test:unit` |
| Acceptance | Medium/Large | `npm run test:acceptance` (requires packages published to a registry) |

## How to run preflight + unit + acceptance

`npm run build && npm run test:all` -- builds (cached), then runs all suites. Does NOT publish to npm.

Note: acceptance tests require packages already published to a registry (local Verdaccio or npm).
The deploy pipeline (`npm run deploy`) handles publish -> acceptance automatically.

## Anti-patterns -- DO NOT

- Run only `npm run test:unit` for pipeline/script changes (use `npm test` then `npm run test:acceptance`)
- Commit before tests pass
- Say "verified" without running the affected suite
- Silently skip a required suite -- if you can't run it, say so
- Run `npm run test:acceptance` without published packages (acceptance needs a registry)

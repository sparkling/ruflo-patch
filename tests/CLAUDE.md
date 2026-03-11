# Testing Rules (ADR-0023, updated by ADR-0024)

## MANDATORY: Test before committing

1. Identify the change type
2. Run ALL required tests for that type (see table below)
3. ALL tests pass → commit
4. If a change affects a layer you cannot run (e.g. verify needs Verdaccio), tell the user explicitly before committing

## Never declare "done" or "verified" unless every changed layer has been exercised.

## Required tests per change type

| Change | Required Layers | Commands |
|--------|----------------|----------|
| Patch fix.py | 0 + 1 | `npm run preflight && npm run test:unit` |
| Codemod/pipeline script | 0 + 1 + 2 | `npm test && npm run test:verify` |
| Test script changes only | 0 + 1 | `npm run preflight && npm run test:unit` |
| sync-and-build.sh / verify changes | 0 + 1 + 2 | `npm test && npm run test:verify` (requires prior `npm run build`) |
| Pre-publish verification | 0 + 1 + 2 | `npm run build && npm run test:all` |
| Deploy to Verdaccio (full) | 0 to 2 | `npm run deploy` (runs ALL layers) |
| Verify live packages | 3 | `npm run test:acceptance` |

## 4-Layer Model

| Layer | Name | Size | Runner |
|-------|------|------|--------|
| -1 | Environment Validation | Smoke | `npm run validate` |
| 0 | Static Analysis | Small | `npm run preflight` + `node scripts/test-codemod-acceptance.mjs <dir>` |
| 1 | Unit Tests (93) | Small | `npm run test:unit` |
| 2 | Verification | Medium | `npm run test:verify` (publish once, install once, all 14 RQ checks) |
| 3 | Acceptance | Large | `npm run test:acceptance` |

## How to run Layers 0 through 2 (pre-publish)

`npm run build && npm run test:all` — builds (cached), then runs all pre-publish layers (L0-L2). Does NOT publish to npm.

## Anti-patterns — DO NOT

- Run only `npm run test:unit` for pipeline/script changes (use `npm test` then `npm run test:verify`)
- Commit before tests pass
- Say "verified" without running the affected layer
- Silently skip a required layer — if you can't run it, say so
- Run `npm run test:verify` without first running `npm run build` (verify needs cached build artifacts)

# Testing Rules (ADR-0023, updated by ADR-0024)

## MANDATORY: Test before committing

1. Identify the change type
2. Run ALL required tests for that type (see table below)
3. ALL tests pass → commit
4. If a change affects a layer you cannot run (e.g. RQ needs `npm run test:rq`), tell the user explicitly before committing

## Never declare "done" or "verified" unless every changed layer has been exercised.

## Required tests per change type

| Change | Required Layers | Commands |
|--------|----------------|----------|
| Patch fix.py | 0 + 1 | `npm run preflight && npm run test:unit` |
| Codemod/pipeline script | 0 + 1 + 2 | `npm test` (runs L0+L1+L2) |
| Test script changes only | 0 + 1 | `npm run preflight && npm run test:unit` |
| sync-and-build.sh / RQ changes | 0 + 1 + 2 + 3 | `npm test && npm run test:rq` (requires prior `npm run build`) |
| Pre-publish verification | 0 + 1 + 2 + 3 | `npm run build && npm run test:all` |
| Deploy to npm (full) | -1 to 4 | `npm run deploy` (runs ALL layers) |
| Verify live packages | 4 | `npm run test:acceptance` |

## 6-Layer Model

| Layer | Name | Size | Runner |
|-------|------|------|--------|
| -1 | Environment Validation | Smoke | `npm run validate` |
| 0 | Static Analysis | Small | `npm run preflight` + `node scripts/test-codemod-acceptance.mjs <dir>` |
| 1 | Unit Tests (93) | Small | `npm run test:unit` |
| 2 | Pipeline Mechanics | Medium | `npm run test:integration` |
| 3 | Release Qualification (14 RQ) | Medium | `npm run test:rq` (requires prior `npm run build`) |
| 4 | Production Verification (15) | Large | `npm run test:acceptance` |

## How to run Layers -1 through 3 (pre-npm)

`npm run build && npm run test:all` — builds (cached), then runs all pre-publish layers (L0-L3). Does NOT publish to npm.

## Anti-patterns — DO NOT

- Run only `npm run test:unit` for pipeline/script changes (use `npm test` which includes L2)
- Commit before tests pass
- Say "verified" without running the affected layer
- Skip Layer 2 (`npm run test:integration`) for codemod or script changes
- Silently skip a required layer — if you can't run it, say so
- Run `npm run test:rq` without first running `npm run build` (RQ needs cached build artifacts)

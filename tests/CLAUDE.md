# Testing Rules (ADR-0023, updated by ADR-0024)

## MANDATORY: Test before committing

1. Identify the change type
2. Run ALL required tests for that type (see table below)
3. ALL tests pass → commit
4. If a change affects a layer you cannot run (e.g. RQ needs sync-and-build.sh), tell the user explicitly before committing

## Never declare "done" or "verified" unless every changed layer has been exercised.

## Required tests per change type

| Change | Required Layers | Commands |
|--------|----------------|----------|
| Patch fix.py | 0 + 1 | `npm run preflight && npm test` |
| Codemod/pipeline script | 0 + 1 + 2 | `npm run preflight && npm test && bash scripts/test-integration.sh` |
| Test script changes only | 0 + 1 | `npm run preflight && npm test` |
| sync-and-build.sh / RQ changes | 0 + 1 + 2 + 3 | All of above + `bash scripts/sync-and-build.sh --test-only` (~3.5min, ask user first) |
| Pre-publish verification | -1 + 0 + 1 + 2 + 3 | `bash scripts/sync-and-build.sh --test-only` (builds + tests, does NOT publish) |
| Deploy to npm (full) | -1 to 4 | `bash scripts/sync-and-build.sh` (runs ALL layers) |
| Verify live packages | 4 | `bash scripts/test-acceptance.sh` |

## 6-Layer Model

| Layer | Name | Size | Runner |
|-------|------|------|--------|
| -1 | Environment Validation | Smoke | `bash scripts/validate-ci.sh` |
| 0 | Static Analysis | Small | `npm run preflight` + `node scripts/test-codemod-acceptance.mjs <dir>` |
| 1 | Unit Tests (93) | Small | `npm test` |
| 2 | Pipeline Mechanics | Medium | `bash scripts/test-integration.sh` |
| 3 | Release Qualification (13 RQ) | Medium | `bash scripts/sync-and-build.sh --test-only` (requires built artifacts with `dist/`) |
| 4 | Production Verification (15) | Large | `bash scripts/test-acceptance.sh` |

## How to run Layers -1 through 3 (pre-npm)

`bash scripts/sync-and-build.sh --test-only` — builds, runs all pre-publish layers, does NOT publish to npm.

## Anti-patterns — DO NOT

- Run only `npm test` for pipeline/script changes
- Commit before tests pass
- Say "verified" without running the affected layer
- Skip Layer 2 (test-integration.sh) for codemod or script changes
- Silently skip a required layer — if you can't run it, say so
- Run RQ tests outside sync-and-build.sh (they need dist/ from TypeScript build)

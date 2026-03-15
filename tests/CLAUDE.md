# Testing Rules (ADR-0023, ADR-0037, ADR-0038)

## MANDATORY: Test before committing

1. Identify the change type
2. Run ALL required tests for that type (see table below)
3. ALL tests pass -> commit
4. If a change affects a layer you cannot run (e.g. acceptance needs Verdaccio), tell the user explicitly before committing

## Never declare "done" or "verified" unless every required test suite has been exercised.

## Required tests per change type

| Change | Required Tests | Commands |
|--------|---------------|----------|
| Patch fix | preflight + pipeline + unit | `npm run test:unit` |
| Codemod/pipeline script | preflight + pipeline + unit | `npm run test:unit` |
| Test script changes only | preflight + pipeline + unit | `npm run test:unit` |
| sync-and-build.sh / acceptance changes | preflight + pipeline + unit + acceptance | `npm run test:unit && npm run test:acceptance` (requires prior `npm run build`) |
| Pre-publish verification | full cascade | `npm run test:acceptance` |
| Deploy to Verdaccio (full) | all | `npm run deploy` (runs all suites) |
| Verify live packages | acceptance only | `bash scripts/test-acceptance.sh --registry http://localhost:4873` |

## Cascading Pipeline (ADR-0038)

Each npm script includes all previous steps:

| # | npm script | Includes | What it does |
|---|---|---|---|
| 1 | `preflight` | — | Static analysis, lint checks |
| 2 | `test:pipeline` | 1 | Pipeline infra tests (4 files, mocked) |
| 3 | `test:unit` | 1-2 | Product unit tests (8 files, mocked) |
| 4 | `fork-version` | 1-3 | Bump `-patch.N` versions |
| 5 | `copy-source` | 1-4 | Copy fork source to `/tmp/ruflo-build` |
| 6 | `codemod` | 1-5 | Scope rename |
| 7a | `build:tsc` | 1-6 | TypeScript compile (parallel by dep group) |
| 7b | `build:wasm` | — | WASM compile (standalone, optional) |
| 7 | `build` | 7a+7b | Both |
| 8 | `publish:verdaccio` | 1-7 | Publish + promote @latest |
| 9 | `test:acceptance` | 1-8 | Real CLI against real packages |
| 10 | `finalize` | — | Save state, push forks, write timing (standalone) |
| 11 | `deploy` | 1-10 | Full pipeline |

## Test Suites

| Suite | Directory | Runner |
|-------|-----------|--------|
| Preflight (static analysis) | — | `npm run preflight` |
| Pipeline Tests (4 files) | `tests/pipeline/` | `node scripts/test-runner.mjs tests/pipeline` |
| Unit Tests (8 files) | `tests/unit/` | `node scripts/test-runner.mjs tests/unit` |
| Acceptance | — | `bash scripts/test-acceptance.sh` (requires published packages) |

## Anti-patterns -- DO NOT

- Run only pipeline tests for product code changes (use `npm run test:unit`)
- Commit before tests pass
- Say "verified" without running the affected suite
- Silently skip a required suite -- if you can't run it, say so
- Run `npm run test:acceptance` without published packages (acceptance needs a registry)

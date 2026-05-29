# ADR-0038: Cascading Pipeline Decomposition

## Status

Accepted (extends ADR-0037)

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

After ADR-0037 separated publish from test, three problems remain:

1. **`deploy:dry-run` is dead weight.** We are the only users of the local Verdaccio
   registry. There are no external consumers to protect. `--test-only` adds branching
   complexity for zero value.

2. **npm scripts don't cascade.** `test:acceptance` doesn't include prior steps.
   `deploy` re-implements everything internally via the 2,569-line sync-and-build.sh.
   Each target should include all previous steps so you can run any target and know
   everything before it has been validated.

3. **sync-and-build.sh is monolithic (2,569 lines).** It mixes email templates,
   state management, build logic (575 lines of TypeScript compilation), test
   orchestration, and GitHub integration. Functions should be extracted into
   sourced libraries and standalone scripts.

4. **Test classification is wrong.** 4 init test files are labeled `@tier unit`
   but call `npx @sparkleideas/cli init` against Verdaccio — they are acceptance
   tests. The acceptance harness already runs `cli init --full` so they duplicate
   setup. Pipeline tests (codemod, publish-order, fork-version) test CI/CD
   infrastructure, not the product, and should be separated from product unit tests.

### Decision Drivers

1. Each npm script target should be self-contained — run it and everything prior runs too
2. Test names should reflect what they actually test (pipeline infra vs product vs acceptance)
3. No dead code paths (`--test-only`, `deploy:dry-run`)
4. Large files should be decomposed into focused modules
5. `promote.sh`, `rollback.sh`, `publish.mjs` `--dry-run` flags are kept (manual safety tools)

## Decision: Specification (SPARC-S)

### Cascading pipeline (11 steps)

| # | npm script | Includes | What it does |
|---|---|---|---|
| 1 | `preflight` | — | Static analysis, lint checks |
| 2 | `test:pipeline` | 1 | Pipeline infra tests (4 files, mocked) |
| 3 | `test:unit` | 1-2 | Product unit tests (8 files, mocked) |
| 4 | `fork-version` | 1-3 | Bump `-patch.N` versions in all forks |
| 5 | `copy-source` | 1-4 | Copy fork source to `/tmp/ruflo-build` |
| 6 | `codemod` | 1-5 | Scope rename `@claude-flow/*` -> `@sparkleideas/*` |
| 7 | `build` | 1-6 | TypeScript compile + WASM (parallel by dep level) |
| 8 | `publish:verdaccio` | 1-7 | Publish all packages + promote to @latest |
| 9 | `test:acceptance` | 1-8 | Real CLI against real packages, no mocks |
| 10 | `finalize` | — | Save `.last-build-state`, push fork version bumps, write timing |
| 11 | `deploy` | 1-10 | Full pipeline |

No `npm test` target. Run the specific target you want.

### Test classification

**Pipeline tests** (`tests/pipeline/`, 4 files) — test CI/CD scripts with mocks:
- codemod.test.mjs, pipeline-logic.test.mjs, publish-order.test.mjs, fork-version.test.mjs

**Unit tests** (`tests/unit/`, 8 files) — test product code with mocks (London School TDD):
- controller-registry-activation, controller-chaos, controller-properties
- agentdb-tools-activation, agentdb-context-synthesize
- hooks-tools-activation, memory-bridge-activation, memory-tools-activation

**Acceptance tests** (`scripts/test-acceptance.sh` + `lib/acceptance-checks.sh`) — real CLI, real packages, no mocks:
- 27+ checks (smoke, structure, diagnostics, data, packages, controller, e2e)
- Init assertions ported from deleted init-*.test.mjs files

### Removed

- `deploy:dry-run` npm script, `--test-only` flag from sync-and-build.sh
- `test`, `test:all`, `build:sync`, `publish:fork` npm scripts
- `scripts/build.sh` (10-line wrapper, replaced by cascading `npm run build`)
- `init-structural.test.mjs`, `init-helpers.test.mjs`, `init-cross-mode.test.mjs`,
  `init-patch-regression.test.mjs`, `tests/fixtures/init-fixture.mjs` (ported to acceptance)

## Pseudocode (SPARC-P)

Cascade chain:
```
preflight         = preflight.mjs
test:pipeline     = preflight && test-runner.mjs tests/pipeline
test:unit         = test:pipeline && test-runner.mjs tests/unit
fork-version      = test:unit && run-fork-version.sh
copy-source       = fork-version && copy-source.sh
codemod           = copy-source && codemod.mjs /tmp/ruflo-build
build             = codemod && build-packages.sh
publish:verdaccio = build && publish-verdaccio.sh
test:acceptance   = publish:verdaccio && test-acceptance.sh
deploy            = test:acceptance && finalize
finalize          = deploy-finalize.sh (standalone)
```

sync-and-build.sh decomposition:
```
sync-and-build.sh sources:
  lib/pipeline-utils.sh   (log, state, timing, phases)
  lib/email-notify.sh     (HTML email templates, sendmail)
  lib/github-issues.sh    (create_failure_issue, create_sync_pr)
Calls standalone scripts:
  scripts/copy-source.sh, scripts/build-packages.sh, scripts/deploy-finalize.sh
```

## Architecture (SPARC-A)

### New standalone scripts (extracted from sync-and-build.sh)

| Script | Lines | Source function |
|---|---|---|
| `scripts/copy-source.sh` | ~80 | `copy_source()` |
| `scripts/build-packages.sh` | ~590 | `run_build()` |
| `scripts/deploy-finalize.sh` | ~80 | post-publish finalization |
| `scripts/run-fork-version.sh` | ~15 | thin wrapper for fork-version.mjs |

### New sourced libraries

| Library | Lines | Contents |
|---|---|---|
| `lib/pipeline-utils.sh` | ~200 | log, state, timing, phases, freshness check |
| `lib/email-notify.sh` | ~230 | fork URLs, email templates, sendmail |
| `lib/github-issues.sh` | ~90 | failure issues, sync PRs |

### sync-and-build.sh after decomposition

~700 lines (from 2,569 — 73% reduction). Retains CLI flags, fork config,
merge detection, version bumping, upstream sync, and main dispatch.
Remains for `--sync` mode and as systemd timer target.

## Refinement (SPARC-R)

- `finalize` is standalone (no cascade) — can run independently after manual build/test
- `deploy` chains `test:acceptance` + `finalize`
- Pipeline/unit tests run before build (test JS scripts and mocked logic, no compiled output needed)
- Acceptance tests run after publish (need real packages on Verdaccio)
- Init test assertions ported to acceptance reuse the existing harness (no duplicate init)
- `promote.sh`, `rollback.sh`, `publish.mjs` keep their `--dry-run` flags

## Completion (SPARC-C)

1. `bash -n` all shell scripts
2. `npm run test:unit` — pipeline + unit tests pass
3. `npm run build` — cascades through fork-version + copy + codemod + tsc
4. `npm run test:acceptance` — cascades through build + publish + acceptance
5. `npm run deploy` — full pipeline end-to-end
6. `wc -l scripts/sync-and-build.sh` — under 800 lines
7. `grep -rn 'test-only\|deploy:dry' scripts/ package.json` — no stale refs
8. Timing: no regression vs 67s baseline

## Consequences

### Positive

- Every npm script is self-contained — run any target and everything prior runs too
- Test names match reality: pipeline (CI/CD infra), unit (mocked product), acceptance (real packages)
- No dead code paths (--test-only, deploy:dry-run removed)
- sync-and-build.sh reduced from 2,569 to ~700 lines
- Init test assertions deduplicated into acceptance harness

### Negative

- More npm scripts to remember (11 vs 6)
- Cascading chains mean running `deploy` re-runs preflight+unit even if you just ran them
- sync-and-build.sh still exists for --sync mode (can't fully eliminate it)

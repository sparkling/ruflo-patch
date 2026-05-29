# ADR-0039: Build Target Split and Pipeline Decomposition

## Status

Accepted (extends ADR-0038)

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC + MADR

## Context

After ADR-0038 reduced sync-and-build.sh from 2,569 to 1,231 lines and added
cascading npm targets, two structural problems remain:

1. **sync-and-build.sh is 4 programs in 1 file.** Four operating modes
   (`--publish`, `--sync`, `--build-only`, `--seed-state`) share almost no
   logic. 534 of 1,231 lines (43%) are exclusive to a single mode. The
   `main()` function is a 133-line flag dispatcher. Six functions exceed
   100 lines.

2. **build-packages.sh mixes concerns.** `run_build()` is 570 lines with
   TSC compilation interleaved with WASM compilation (for one package),
   a 91-line JavaScript tsconfig generator embedded as inline `node -e`
   in bash, and 150 lines of heredoc `.d.ts` stub declarations.

3. **Fork path constants are duplicated in 3 files.** The same 4 directory
   paths and 4 upstream URLs appear verbatim in sync-and-build.sh,
   copy-source.sh, and deploy-finalize.sh.

### Decision Drivers

1. Single responsibility: each script file should have one clear purpose
2. Files under 500 lines (CLAUDE.md guideline)
3. No function over 100 lines
4. DRY: constants and shared wrappers defined once
5. TSC and WASM should be independently invocable build targets
6. Backward-compatible: systemd timer and npm scripts continue to work

## Decision: Specification (SPARC-S)

### Build target split

Split the `build` npm script into `build:tsc` and `build:wasm`:
- `build:tsc` cascades through codemod, compiles ~30 TypeScript packages
- `build:wasm` is standalone, compiles 1 WASM package (agent-booster), optional
- `build` runs both

Extract from build-packages.sh:
- 16 `.d.ts` stub files to `config/tsc-stubs/` (static, committed)
- tsconfig generator to `scripts/gen-tsconfig.mjs` (testable ESM script)
- WASM section to `scripts/build-wasm.sh` (standalone)

### Pipeline decomposition

Split sync-and-build.sh into:
- `scripts/ruflo-publish.sh` — publish stage (detect merges, bump, build, publish)
- `scripts/ruflo-sync.sh` — sync stage (fetch upstream, merge, build, test, PR)
- `scripts/sync-and-build.sh` — thin dispatcher (flags, flock, timeout, dispatch)
- `lib/pipeline-helpers.sh` — shared build/test wrappers (DRY)
- `lib/fork-paths.sh` — centralized fork directory constants (DRY)

### Updated cascade

| # | npm script | Includes | What it does |
|---|---|---|---|
| 1 | `preflight` | — | Static analysis |
| 2 | `test:pipeline` | 1 | Pipeline infra tests (4 files) |
| 3 | `test:unit` | 1-2 | Product unit tests (8 files) |
| 4 | `fork-version` | 1-3 | Bump `-patch.N` versions |
| 5 | `copy-source` | 1-4 | rsync forks to build dir |
| 6 | `codemod` | 1-5 | Scope rename |
| 7a | `build:tsc` | 1-6 | TypeScript compile (parallel by dep group) |
| 7b | `build:wasm` | — | WASM compile (standalone, optional) |
| 7 | `build` | 7a+7b | Both |
| 8 | `publish:verdaccio` | 1-7 | Publish + promote @latest |
| 9 | `test:acceptance` | 1-8 | Real CLI, real packages |
| 10 | `finalize` | — | Save state, push forks |
| 11 | `deploy` | 1-10 | Full pipeline |

## Pseudocode (SPARC-P)

Build decomposition:
```
build:tsc  = codemod && build-packages.sh   (TSC only, ~355 lines)
build:wasm = build-wasm.sh                  (WASM only, ~80 lines)
build      = build:tsc && build:wasm
```

Pipeline decomposition:
```
sync-and-build.sh (dispatcher, ~150 lines):
  sources: lib/fork-paths.sh, lib/pipeline-utils.sh, lib/pipeline-helpers.sh
  --seed-state → inline (48 lines)
  --build-only → inline (57 lines)
  --publish    → bash ruflo-publish.sh
  --sync       → bash ruflo-sync.sh
  (default)    → publish then sync

ruflo-publish.sh (~350 lines):
  sources: fork-paths, pipeline-utils, email-notify, github-issues, pipeline-helpers
  functions: check_merged_prs, bump_fork_versions, push_fork_version_bumps
  flow: detect merges → bump → build → test → publish → save state

ruflo-sync.sh (~480 lines):
  sources: fork-paths, pipeline-utils, email-notify, github-issues, pipeline-helpers
  functions: sync_upstream (decomposed into 4 subfunctions)
  flow: sync → build (or reuse) → test (or skip) → create PRs → save state
```

## Architecture (SPARC-A)

### New files

| File | Lines | Purpose |
|------|-------|---------|
| `lib/fork-paths.sh` | ~45 | Fork directory constants (single source of truth) |
| `lib/pipeline-helpers.sh` | ~70 | Build/test wrapper functions (DRY) |
| `scripts/gen-tsconfig.mjs` | ~110 | Standalone tsconfig generator (ESM) |
| `scripts/build-wasm.sh` | ~80 | WASM compilation (optional, cached) |
| `scripts/ruflo-publish.sh` | ~350 | Publish stage (self-contained) |
| `scripts/ruflo-sync.sh` | ~480 | Sync stage (self-contained) |
| `config/tsc-stubs/*.d.ts` | ~160 | 16 static type stub files |

### Modified files

| File | Before | After | Change |
|------|--------|-------|--------|
| `scripts/build-packages.sh` | 692 | ~355 | Extract stubs, tsconfig gen, WASM |
| `scripts/sync-and-build.sh` | 1,231 | ~150 | Rewrite as thin dispatcher |
| `scripts/copy-source.sh` | 124 | ~115 | Source fork-paths.sh |
| `scripts/deploy-finalize.sh` | 142 | ~130 | Source fork-paths.sh |

## Refinement (SPARC-R)

- `sync_upstream()` (277 lines) is decomposed into 4 subfunctions within ruflo-sync.sh:
  `_add_upstream_remotes()`, `_fetch_upstream_parallel()`, `_create_sync_branch()`,
  `_merge_and_typecheck()`. No function exceeds 100 lines.
- `lib/pipeline-helpers.sh` centralizes build/test wrappers used by ruflo-publish.sh,
  ruflo-sync.sh, and the dispatcher's `--build-only` path. Eliminates 3-way duplication.
- `build:wasm` exits 0 gracefully if: build dir missing, wasm-pack not installed,
  or crate directory not found. WASM is always optional.
- Concurrency guard (flock) stays in the dispatcher, not in ruflo-publish/sync.
  Systemd always goes through the dispatcher; manual npm invocations skip the guard
  (acceptable for interactive use).
- `config/tsc-stubs/` is committed to the repo and copied to the toolchain dir at
  build time. Stubs are version-controlled and diffable.

## Completion (SPARC-C)

1. `bash -n` all shell scripts
2. `npm run test:unit` — pipeline + unit tests pass
3. `npm run build:tsc` — TSC cascade works independently
4. `npm run build:wasm` — WASM builds or exits 0 gracefully
5. `npm run build` — runs both
6. `npm run deploy` — full pipeline, 32/32 acceptance checks pass
7. `wc -l scripts/sync-and-build.sh` — under 150
8. `wc -l scripts/build-packages.sh` — under 400
9. `wc -l scripts/ruflo-publish.sh` — under 400
10. `wc -l scripts/ruflo-sync.sh` — under 500
11. `grep -rn FORK_DIR_RUFLO scripts/ lib/` — only in lib/fork-paths.sh
12. No timing regression vs 58s baseline

## Consequences

### Positive

- Each script has one responsibility and one operating mode
- sync-and-build.sh drops from 1,231 to ~150 lines (88% reduction)
- build-packages.sh drops from 692 to ~355 lines (49% reduction)
- TSC and WASM are independently invocable targets
- Fork paths defined once, sourced everywhere
- tsconfig generator is a proper ESM script (testable, lintable)
- Type stubs are committed static files (diffable, reviewable)
- No function exceeds 100 lines

### Negative

- More script files (7 new) — mitigated by clear naming and single responsibility
- Shared state (NEW_*_HEAD vars) must be initialized in each entry-point script
- Dispatcher adds one level of indirection for systemd timer invocations

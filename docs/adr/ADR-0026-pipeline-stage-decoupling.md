---
status: accepted
date: 2026-03-08
tags: [pipeline, build, testing, performance]
supersedes: []
depends-on: [ADR-0023, ADR-0024, ADR-0025]
implements: []
---

# Pipeline Stage Decoupling

## Context and Problem Statement

### Specification (SPARC-S)

`sync-and-build.sh` is a monolithic pipeline that runs 9 phases sequentially: upstream pull → copy → codemod → change detection → TypeScript build → patches → unit tests → integration tests → RQ tests. The `test:rq` npm script maps to `sync-and-build.sh --test-only`, which runs the entire pipeline minus publish.

This creates two problems:

| Problem | Impact |
|---------|--------|
| Ephemeral `TEMP_DIR` (`mktemp -d /tmp/ruflo-build-XXXXX`) | Build artifacts lost on exit — every run starts cold (~34s tsc) |
| `test:rq` = full rebuild | RQ tests take ~123s instead of ~17s standalone |
| `test` = unit only | Doesn't answer "is my code safe to submit?" (Google Test Engineering standard) |
| No `build` command | Cannot cache/reuse build artifacts independently |
| Script name confusion | `build:sync` sounds like "sync a build", not "deploy to npm" |

What already works and should not change:

- `test-rq.sh` already accepts `--build-dir <path>` and runs standalone
- `test-integration.sh` is already standalone
- `package-checksums.json` tracks content hashes for incremental per-package builds
- `needs_rebuild()` skips unchanged packages within a single build run

### Pseudocode (SPARC-P)

Before (every `npm run test:rq`):
```
1. mktemp -d /tmp/ruflo-build-XXXXX     → ephemeral dir
2. pull upstream repos                   → ~12s
3. copy + codemod + detect changes       → ~3s
4. tsc build (all packages)              → ~24s
5. apply patches                         → ~0.1s
6. run unit tests                        → ~0.2s
7. run integration tests                 → ~46s
8. run RQ tests                          → ~35s
9. delete TEMP_DIR on exit               → artifacts lost
Total: ~123s, every time
```

After:
```
# npm run build (first run)
1. check .build-manifest.json            → stale or missing
2. pull upstream repos                   → ~12s
3. copy + codemod + detect changes       → ~3s
4. tsc build                             → ~24s
5. apply patches                         → ~0.1s
6. write .build-manifest.json            → record freshness
7. exit (stable /tmp/ruflo-build persists)
Total: ~34s

# npm run build (second run, nothing changed)
1. check .build-manifest.json            → fresh
2. "Build is current, skipping"
Total: <1s

# npm run test:rq (standalone)
1. check /tmp/ruflo-build exists         → yes
2. publish to Verdaccio + run RQ-1..RQ-14
Total: ~17s
```

## Decision Drivers

- `npm run test:rq` rebuilds the entire pipeline (~123s) even when build artifacts already exist
- `npm test` only runs unit tests, not the industry-standard "all feasible local tests"
- Build artifacts are ephemeral (`mktemp -d`) and deleted on exit — no cross-run caching
- No standalone `build` command — build logic is embedded inside `sync-and-build.sh`
- Redundant/confusing script names: `test:fast` duplicates `test`, `build:sync` is misleading

## Considered Options

**Option A: Split sync-and-build.sh into 8+ scripts**
- One script per phase (pull.sh, copy.sh, codemod.sh, build-tsc.sh, etc.)
- Pro: Maximum Unix philosophy compliance
- Con: Massive refactor risk, shared state between phases is complex, premature decomposition

**Option B: Add `--build-only` flag + stable build dir** (chosen)
- Keep sync-and-build.sh as single source of truth
- Add `--build-only` flag to exit after Phase 8 (before tests)
- Use stable `/tmp/ruflo-build` instead of ephemeral mktemp
- Write `.build-manifest.json` for cross-run freshness checking
- Thin `build.sh` wrapper delegates to `sync-and-build.sh --build-only`
- Pro: Minimal code change, zero duplication, pragmatic
- Pro: Full pipeline (`deploy`) unchanged — same code path
- Con: sync-and-build.sh grows slightly (manifest logic)

**Option C: Extract build logic into separate build.sh**
- Move phases 1-8 into a new build.sh, sync-and-build.sh calls it
- Pro: Clean separation
- Con: Splits tightly coupled code, risk of drift, more files to maintain

## Decision Outcome

Chosen option: "Option B: Add `--build-only` flag + stable build dir", because it requires minimal code change with zero duplication while keeping the full deploy pipeline on the same code path — at the cost of `sync-and-build.sh` growing slightly to hold the manifest logic.

### Architecture (SPARC-A)

**Option B**: Add `--build-only` flag to `sync-and-build.sh` with a stable build directory and build manifest.

#### Stable build directory

| Property | Value |
|----------|-------|
| Path | `/tmp/ruflo-build` (stable, survives across runs) |
| Lifecycle | Created on first build, persists until reboot or `--force` |
| Cleanup trap | Does NOT delete TEMP_DIR (it's the build cache) |

#### Build manifest (`.build-manifest.json`)

Written after successful build (Phase 8), checked before rebuild:

```json
{
  "version": 1,
  "built_at": "2026-03-08T12:00:00Z",
  "ruflo_head": "abc123",
  "agentic_head": "def456",
  "fann_head": "789abc",
  "patch_head": "local-HEAD",
  "codemod_hash": "sha256:...",
  "patch_dir_hash": "sha256:...",
  "packages_built": 20,
  "rebuild_packages": "all"
}
```

Freshness check: compare current upstream HEADs + codemod hash + patch dir hash against stored values. All match + no `--force` → skip build.

#### Command redesign

| Command | Maps to | Purpose |
|---------|---------|---------|
| `build` | `build.sh --pull` | Build artifacts only (phases 1-8). Cached. |
| `test` | `preflight && test:unit && test:integration` | All local tests (L0+L1+L2). "Safe to submit?" |
| `test:unit` | `test-runner.mjs` | Unit tests only (L1). Tight inner loop. |
| `test:integration` | `test-integration.sh` | Pipeline mechanics (L2). Unchanged. |
| `test:rq` | `test-rq.sh` | RQ checks (L3). Standalone against cached build. |
| `test:acceptance` | `test-acceptance.sh` | Production verification (L4). Unchanged. |
| `test:all` | `preflight && test:unit && test:integration && test:rq` | Layers 0-3. Pre-publish gate. |
| `deploy` | `sync-and-build.sh` | Full pipeline: build + test + publish + promote. |
| `deploy:dry-run` | `sync-and-build.sh --test-only` | Full pipeline, stop before publish. |

Removed: `test:fast` (duplicate), `preflight:check` (use `preflight`), `codemod` (internal), `publish:all` (dangerous standalone), `publish:dry-run` (use `deploy:dry-run`).

Kept as alias: `build:sync` → `deploy` (backward compat).

#### Developer workflows

```bash
# Tight inner loop (0.2s)
npm run test:unit

# Full local verification (47s)
npm test

# RQ against cached build (51s first, 18s cached)
npm run build && npm run test:rq

# Pre-deploy (85s)
npm run build && npm run test:all

# Deploy to npm (3.5min)
npm run deploy
```

### Refinement (SPARC-R)

#### sync-and-build.sh changes

1. **New CLI flags**: `--build-only` (phases 1-8 only), `--pull` (fetch upstream, default in full pipeline), `--force` (ignore manifest, rebuild)
2. **Stable TEMP_DIR**: `/tmp/ruflo-build` instead of `mktemp -d /tmp/ruflo-build-XXXXX`
3. **Cleanup trap**: Do NOT delete TEMP_DIR when `--build-only` (it's the cache)
4. **Manifest write**: After Phase 8, write `.build-manifest.json`
5. **Freshness check**: Before Phase 3, compare manifest against current state
6. **Bug fix**: Line 570 quoting — `'${REBUILD_PACKAGES}'` passes literal single quotes. Switch to bash array like `test-rq.sh` fix (ADR-0025).

#### test-rq.sh changes

Default `BUILD_DIR` to `/tmp/ruflo-build` when not provided, with manifest existence check:

```bash
if [[ -z "$BUILD_DIR" ]]; then
  BUILD_DIR="/tmp/ruflo-build"
  if [[ ! -f "${BUILD_DIR}/.build-manifest.json" ]]; then
    log_error "No build artifacts at ${BUILD_DIR}"
    log_error "Run 'npm run build' first, or pass --build-dir <path>"
    exit 1
  fi
  log "Using cached build at ${BUILD_DIR}"
fi
```

#### New file: scripts/build.sh

Thin wrapper — all logic stays in sync-and-build.sh:

```bash
#!/usr/bin/env bash
# scripts/build.sh — Standalone build (phases 1-8 only)
exec bash "$(dirname "$0")/sync-and-build.sh" --build-only "$@"
```

### Consequences

#### Completion (SPARC-C)

* Good, because RQ test time drops from ~123s to ~17s (standalone against cached build)
* Good, because second build run skips entirely (<1s) when nothing changed
* Good, because `npm test` answers "is my code safe to submit?" (industry standard)
* Good, because each test layer independently runnable — no forced coupling
* Good, because build artifacts persist across runs — no wasted recompilation
* Good, because clearer command names: `deploy` not `build:sync`, `test:unit` not `test:fast`
* Bad, because `/tmp/ruflo-build` consumes ~200MB disk until reboot or manual cleanup
* Bad, because `npm run test:rq` requires a prior `npm run build` (explicit dependency)
* Bad, because first build after reboot is same speed as today
* Neutral, because full deploy pipeline (`npm run deploy`) behavior unchanged — same code path
* Neutral, because incremental per-package detection unchanged
* Neutral, because ADR-0025 cache optimization continues to apply

#### Files modified

| File | Change |
|------|--------|
| `scripts/sync-and-build.sh` | `--build-only`, `--pull`, `--force` flags, stable TEMP_DIR, manifest, freshness check, rq_args quoting fix |
| `scripts/test-rq.sh` | Default BUILD_DIR to `/tmp/ruflo-build` with manifest check |
| `scripts/build.sh` | **New** — thin wrapper |
| `package.json` | Full scripts redesign |
| `CLAUDE.md` | Build & Test section updates |
| `tests/CLAUDE.md` | Test matrix, layer table, command references |
| `patch/CLAUDE.md` | Deploy workflow commands |
| `README.md` | Script reference table |
| `docs/testing.strategy.fixed.google.md` | Command tables, workflow examples |
| `MEMORY.md` | Test matrix, deploy commands |

### Confirmation

#### Verification

1. `npm run build` — first run builds (~34s), second run skips (<1s)
2. `npm run test:rq` — standalone against cached build (14/14 pass, ~17s)
3. `npm run build && npm run test:rq` — ~51s total (vs ~123s today)
4. `npm test` — runs L0 + L1 + L2 (~47s)
5. `npm run test:unit` — unit tests only (~0.2s)
6. `npm run test:all` — runs L0-L3 after build
7. `npm run deploy` — full pipeline still works end-to-end
8. `npm run deploy:dry-run` — stops before publish
9. Change a patch → `npm run build` detects staleness → rebuilds
10. No change → `npm run build` skips → `test:rq` reuses cached artifacts

## More Information

This decision relates to ADR-0023 (6-layer testing model, incremental build detection), ADR-0024 (patch deployment model, `sync-and-build.sh` as pipeline orchestrator), and ADR-0025 (RQ cache optimization — persistent npx cache).

This record originally used the SPARC + MADR methodology, with section headings (Specification / Pseudocode / Architecture / Refinement / Completion) remapped to the canonical MADR sections during the ADR-0271 migration, preserving all content. Original status: "Accepted".

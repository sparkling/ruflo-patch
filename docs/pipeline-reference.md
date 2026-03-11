# Pipeline Reference

How the ruflo-patch build/publish pipeline works. For operational checklists, see the plan templates in auto-memory.

## Overview

ruflo-patch repackages 3 upstream repos (`ruflo`, `agentic-flow`, `ruv-FANN`) as `@sparkleideas/*` packages on npm. The pipeline detects fork changes, applies scope renaming, builds, tests, publishes, and promotes.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/sync-and-build.sh` | Main pipeline orchestrator — detects changes, builds, tests, publishes, promotes |
| `scripts/publish.mjs` | Publishes packages in topological order (5 dependency levels) |
| `scripts/promote.sh` | Promotes prerelease tags to `@latest` after acceptance tests pass |
| `scripts/fork-version.mjs` | Bumps versions in fork package.json files (`{upstream}-patch.N`) |
| `scripts/codemod.mjs` | Scope rename (`@claude-flow/*` → `@sparkleideas/*`) in built output |
| `scripts/test-rq.sh` | Release Qualification (14 checks against local Verdaccio) |
| `scripts/test-acceptance.sh` | Production Verification (16 checks against real npm) |
| `scripts/test-integration.sh` | Pipeline mechanics integration test |
| `lib/acceptance-checks.sh` | Shared test library used by both RQ (L3) and acceptance (L4) |

## Pipeline Phases

When `sync-and-build.sh` detects new fork commits, it runs these phases in order:

| Phase | What it does | Typical duration |
|-------|-------------|-----------------|
| merge-detect | Compares fork HEADs to `.last-build-state` | 6s |
| bump-versions | `fork-version.mjs bump` — increments `-patch.N` across all changed packages | 18s |
| copy-source | Copies fork source into build dir | 4s |
| codemod | `codemod.mjs` — renames `@claude-flow/*` to `@sparkleideas/*` | 1s |
| build | `tsc` for each sub-package (20 packages, sequential) | 24s |
| test-l1-unit | Unit tests (`npm test` in build dir) | 53s |
| test-l2-integration | Pipeline mechanics against ephemeral Verdaccio | 28s |
| test-l3-rq | 14 Release Qualification checks against local Verdaccio | 209s |
| publish | `publish.mjs` — publishes ~42 packages in 5 topological levels | 43s |
| cdn-propagation | Polls npm CDN until new version resolves | 11s |
| test-l4-acceptance | 16 production verification checks against real npm | 303s |
| promote | `promote.sh` — `npm dist-tag add` for each package | 62s |
| post-promote-smoke | Final smoke test of promoted packages | 83s |

**Baseline total**: 848s (14m 8s) — recorded 2026-03-11, v3.5.15-patch.10, cold caches.

## Testing Layers (ADR-0023)

| Layer | Name | Count | Runner | Gate |
|-------|------|-------|--------|------|
| -1 | Environment Validation | Smoke | `npm run validate` | Advisory |
| 0 | Static Analysis | — | `npm run preflight` | Gate 1 (hard) |
| 1 | Unit Tests | — | `npm run test:unit` | Gate 1 (hard) |
| 2 | Pipeline Mechanics | — | `npm run test:integration` | Gate 1 (hard) |
| 3 | Release Qualification | 14 | `npm run test:rq` | Gate 1 (hard) |
| 4 | Production Verification | 16 | `npm run test:acceptance` | Gate 2 (soft) |

- **Gate 1** (pre-publish): Layers 0-3 pass → publish to npm with `--tag prerelease`
- **Gate 2** (post-publish): Layer 4 passes → promote to `@latest`
- **Timeouts**: RQ global 300s (per-command 30s), acceptance global 600s (per-command 60s)

### Slowest tests

- RQ-8 / A9 (Memory lifecycle): ~80s — cold npx install + SQLite init + store/search/retrieve cycle
- RQ-9 / A10 (Neural training): ~30-60s — trains 50 patterns, persists to disk
- A0 (@latest dist-tag): ~80s cold — full npx install from npm
- A1 (Version check): ~53s — second npx install validates version string

## Publishing

- **Scope**: `@sparkleideas/*` (npm account: `sparklingideas`), 44 packages total
- **Version scheme (ADR-0027)**: `{upstream}-patch.N`
- **Topological ordering (ADR-0014)**: 5 dependency levels, published sequentially
- **Tag gating (ADR-0010)**: publish with `--tag prerelease`, auto-promote to `@latest` after acceptance
- **Per-package tracking**: `config/published-versions.json` (committed to git)
- **promote.sh** reads per-package versions from `published-versions.json`, not a single version argument
- **Wrapper**: `@sparkleideas/ruflo` wraps `@sparkleideas/cli` — uses `import.meta.resolve` (ESM-only)
- **CDN propagation**: 1-3 minutes after publish before npm CDN reflects new version
- `publish.mjs --no-rate-limit` skips 2s inter-package delay (use for local Verdaccio)
- `publish.mjs` strips missing bin entries before publish (upstream has broken bin paths)
- When republishing, use `--ignore-scripts` to skip `prepublishOnly`

## Codemod Coverage

`codemod.mjs` renames scope in these package.json keys:
- `dependencies`, `peerDependencies`, `optionalDependencies`
- `peerDependenciesMeta`, `bin`, `exports`

Missing `peerDependenciesMeta` coverage previously caused A16 (Plugin install) to fail.

## Concurrency

- `flock` guard on `/tmp/ruflo-sync-and-build.lock` prevents overlapping timer runs
- Skipped for `--build-only` mode (local builds don't conflict)
- Without this guard, the 1-minute timer caused double version bumps and dependency mismatches
- Orphaned processes (e.g. `sleep` from failed runs) can hold the lock — check with `fuser`

## Caching

### Build cache (ADR-0026)

- Location: `/tmp/ruflo-build` — persists across runs
- Manifest: `.build-manifest.json` records fork HEADs + codemod/patch hashes
- `npm run build` checks freshness — skips if current (<1s), rebuilds if stale (~34s)
- `npm run deploy` uses ephemeral tmpdir (clean build, ignores cache)
- Force rebuild: `npm run build -- --force`

### RQ npx cache (ADR-0025)

- Location: `/tmp/ruflo-rq-npxcache` — persists across runs
- Two-tier clearing: `_npx/` full-clear (0.4s), `_cacache/index-v5/` selective per-package
- Timing: 118s (cold) → 17s (warm full-clear) → 12s (warm incremental)

## Ghost Versions

npm can accept a publish (E400 blocks re-publish) but never propagate to the read API (E404 on `npm view`). This creates "ghost" versions that block re-publish but can't be installed.

- `fork-version.mjs` always bumps past current version to avoid ghost collisions
- `publish.mjs` detects ghosts (E400 + E404 view) and auto-retries with next `-patch.N`
- `sync-and-build.sh` explicitly checks `publish.mjs` exit code (`set -e` is disabled inside `if` contexts)

## Pipeline Failure History

10 root causes identified across 5 failed E2E attempts — all fixed. See `pipeline-failures.md` in auto-memory for details.

### Rules (learned the hard way)

- **NEVER force push forks to fix version state** — npm is immutable, work forward
- **NEVER clear published-versions.json without reconciling from npm** — causes version collisions
- **NEVER manually set versions in fork package.json** — use `fork-version.mjs`
- **NEVER npm unpublish** — npm blocks it for packages with dependents
- **NEVER save pipeline state before publish succeeds** — makes failures non-recoverable
- **FIX THE PIPELINE, don't hack the state**

## Optimization Opportunities

Based on the 2026-03-11 baseline (848s total):

| Optimization | Estimated savings | Effort |
|-------------|-------------------|--------|
| Warm npx cache for acceptance (reuse RQ cache) | ~133s | Medium |
| Parallelize promotion (`xargs -P 8`) | ~50s | Low |
| Share cold install between RQ and acceptance | ~60s | Medium |
| Parallel tsc builds | ~4s | Low |

Theoretical minimum with all optimizations: ~430s (~7 min).

## Environment Notes

- Node v24 (`node-v137-linux-x64`): `better-sqlite3` needs `npm rebuild`
- `/home/claude/source` is a symlink to `/home/claude/src` — use `realpathSync()` for `isMainModule` checks
- Global Verdaccio on port 4873 runs permanently — never kill it. Tests use ephemeral instances on random ports.
- Verdaccio needs `max_body_size: 200mb` and `proxy: npmjs` uplink
- Hash embeddings produce cosine similarity ~0.1-0.28 vs ONNX ~0.6-0.95 — thresholds must be lower
- npm "Access token expired" warning is misleading for granular tokens — if `npm whoami` works, it's fine

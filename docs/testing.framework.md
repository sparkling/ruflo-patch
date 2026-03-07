# Testing Framework

ruflo-patch uses a **6-layer testing model** (ADR-0023) with additional operational checks. Each layer targets a different level of confidence and runs at a different cadence.

**Total**: 93 unit + 10 integration phases + 12 RQ + 14 acceptance = **129 automated checks**.

## Architecture Overview

```
Layer 4: Prod Verify    <- 14 tests against real npm, confirmation only (~15s)
Layer 3: Release Qual   <- 12 RQ tests against Verdaccio install, discovery (~23s)
Layer 2: Integration    <- full pipeline: clone -> codemod -> patch -> publish -> install (~30s cached)
Layer 1: Unit           <- individual functions, no external deps (~0.2s)
Layer 0: Static         <- codemod acceptance, preflight, sentinels
Layer -1: Environment   <- validate-ci.sh (advisory)
------------------------------------------------------------
Gate 1 (pre-publish): Layers 0-3 must pass before publish
Gate 2 (post-publish): Layer 4 must pass before promotion
```

| Layer | Script | Tests | Size | Duration | When |
|-------|--------|-------|------|----------|------|
| -1 | `bash scripts/validate-ci.sh` | 10 checks | Smoke | <5s | Ad-hoc |
| 0 | `npm run preflight` + `check-patches.sh` | — | Small | <10s | Pre-commit |
| 1 | `npm test` | 93 | Small | ~0.2s | Every commit |
| 2 | `bash scripts/test-integration.sh` (Ph 1-8) | 8 phases | Medium | ~30s | Pre-publish |
| 3 | `bash scripts/test-integration.sh` (Ph 9) | 12 RQ | Medium | ~23s | Pre-publish |
| 4 | `bash scripts/test-acceptance.sh` | 14 | Large | ~15s | Post-publish |

---

## Layer 1: Unit Tests

**Runner**: `scripts/test-runner.mjs` → `node --test tests/*.test.mjs`

**Command**: `npm test`

### Test Suites (6 files, 93 tests)

#### `01-common-library.test.mjs` — 7 tests

Tests `lib/common.py` patch helpers (`patch()` / `patch_all()`).

| Test | Validates |
|------|-----------|
| patch() applies when old string is found | Basic replacement works |
| patch() skips when new string already present | Idempotency |
| patch() warns when old string not found | Missing target handling |
| patch() is idempotent (double apply) | Re-run safety |
| patch_all() replaces all occurrences | Global replacement |
| patch() silently skips missing file | Missing file handling |
| patch() skips when filepath is empty string | Empty path edge case |

**Mocking**: Spawns Python with embedded `common.py` + test script. Temp directories for fixtures.

#### `02-discovery.test.mjs` — 2 tests

Tests `lib/discover.mjs` (patch directory scanning).

| Test | Validates |
|------|-----------|
| exports a discover() function | Module shape |
| returns valid structure with empty patch dir | Graceful empty state |

#### `03-mc001-mcp-autostart.test.mjs` — 4 tests

Tests `patch/010-MC-001-mcp-autostart/fix.py` (autoStart removal).

| Test | Validates |
|------|-----------|
| removes autoStart from unpatched mcp-generator.js | Core fix applies |
| is idempotent — second run skips | Re-run safety |
| skips when already patched | Pre-patched detection |
| does not corrupt other MCP server entries | Surgical precision |

**Mocking**: `runPatch()` helper spawns Python against temp fixture directories.

#### `04-codemod.test.mjs` — 16 tests

Tests `scripts/codemod.mjs` (scope-rename + wildcard replacement).

| Test | Validates |
|------|-----------|
| transforms name, dependencies, peerDependencies, optionalDependencies, bin, exports | Full package.json transform |
| transforms scoped @claude-flow/ imports, leaves unscoped alone | Source file transform |
| handles both @claude-flow/memory and claude-flow in one file | Mixed scope ordering |
| does not transform already-transformed @sparkleideas/memory | No double-transform |
| does not transform @ruvector/core or ruvector | Foreign scope untouched |
| produces identical output when run twice | Idempotency |
| does not transform .git/ or node_modules/ | Exclusion rules |
| replaces all @sparkleideas/* ranges with "*" (bf31c63) | ETARGET fix |
| does NOT remove autoStart (MC-001 is patch system) | Codemod/patch boundary |
| replaces caret, tilde, gte, exact ranges | Range normalization |
| does not double-replace already-"*" ranges | Wildcard idempotency |
| replaces caret ranges that cannot match prerelease versions | Regression guard |

**Mocking**: Temp directories with synthetic package.json and source files.

#### `05-pipeline-logic.test.mjs` — 37 tests

Tests version computation, state parsing, change detection, first-publish bootstrap.

**computeVersion (ADR-0012)** — 13 tests:
- First build from stable (`3.0.2` → `3.0.3`) and prerelease (`3.0.0-alpha.6` → `3.0.0-alpha.7`)
- Same upstream + last published → bump from max
- Upstream jumps past or equal to last published
- Trailing non-numeric identifier (`2.0.2-alpha` → `2.0.2-alpha.1`)

**parseState / serializeState** — 8 tests:
- KEY=VALUE parsing, comments, blank lines, equals in values
- Round-trip serialization fidelity

**detectChanges (ADR-0011)** — 7 tests:
- First build (no state) → should build
- Each upstream HEAD changed → should build
- Local commit changed → should build
- No changes → should NOT build
- Multiple changes → all reported

**getPublishTag (ADR-0015)** — 5 tests:
- E404 → `null` (first publish, no tag)
- Package exists → `'prerelease'`
- Network errors → throw (not silently treated as first-publish)

**published-versions.json safety** — 2 tests:
- No version contains `-patch` suffix
- All versions are valid semver

**Mocking**: Helper functions from `tests/helpers/pipeline-helpers.mjs`. Mock npm view functions.

#### `06-publish-order.test.mjs` — 24 tests

Tests `scripts/publish.mjs` topological ordering (ADR-0014).

| Group | Tests | Validates |
|-------|-------|-----------|
| Level ordering | 4 | 5 levels, level 1 has no internal deps, level 5 = root |
| Package completeness | 4 | All 24 packages present, no duplicates, LEVELS ↔ KNOWN_DEPS consistency |
| Dependency validation | 2 | Each level N has deps at level ≤ N, intra-level ordering correct |
| Stop-on-failure | 2 | Stops on missing package dir, reports failing package + level |
| Rate limiting | 2 | RATE_LIMIT_MS = 2000, dry-run is fast |
| First-publish bootstrap | 2 | Tags are `latest` or `prerelease` |
| Dry-run mode | 4 | All packages listed, no file modifications, rejects missing buildDir |
| Level assignments (ADR-0014) | 4 | agentdb/agentic-flow/ruv-swarm at L1, cli/claude-flow at L5 |

**Mocking**: `mockGetPublishTag` returns `'prerelease'` without network calls (eliminated 216 `npm view` calls, 85s → 84ms). `createFakeBuildDir()` builds temp directories with synthetic package.json for all 24 packages.

### Test Helpers

| Module | Exports | Used By |
|--------|---------|---------|
| `tests/helpers/run-python.mjs` | `runPatch(fixPyPath, base, opts)` — runs fix.py against fixture via Python3 | 03-mc001 |
| `tests/helpers/pipeline-helpers.mjs` | `computeVersion()`, `parseState()`, `serializeState()`, `detectChanges()`, `getPublishTag()` | 05-pipeline |
| `tests/helpers/fixture-factory.mjs` | `createFixture()` — creates temp fixture with cleanup | Available but unused (fixtures created inline) |

### Test Runner Features

`scripts/test-runner.mjs` provides:

- **Concurrency**: `TEST_CONCURRENCY=N` env var → `--test-concurrency=N`
- **Skip threshold**: `SKIP_THRESHOLD=N` (default 8). Fails if too many tests skipped (prevents silent test silencing)
- **Dual reporters**: `--save-results` writes TAP to file + spec to stdout
- **Timeout**: 600s (10 min) hard kill
- **Result artifacts** (`--save-results` or `SAVE_TEST_RESULTS=1`):
  - `test-results/<timestamp>/unit-results.tap`
  - `test-results/<timestamp>/.test-manifest.json` (git HEAD, node version, platform, pass/fail counts)

---

## Layer 2: Integration Test

**Script**: `scripts/test-integration.sh`

**Command**: `bash scripts/test-integration.sh`

Validates the full build pipeline end-to-end using a local Verdaccio registry.

### 10 Phases

| Phase | Function | Timeout | What It Does | Fails On |
|-------|----------|---------|-------------|----------|
| 1. Setup | `phase_setup` | 30s | Kill stale Verdaccio, start on random port (4873-4999), create temp dirs | Verdaccio won't start |
| 2. Clone | `phase_clone` | 60s | Parallel rsync of 3 upstream repos (excluding .git) to temp build dir | Missing upstream clone |
| 3. Codemod | `phase_codemod` | 60s | Run `node scripts/codemod.mjs`, verify zero `@claude-flow/` residuals | Any residual found |
| 4. Patch | `phase_patch` | 30s | Run `bash patch-all.sh --target`, verify all 7 sentinels | Sentinel check fails |
| 5. Verify | `phase_build` | 30s | Check pre-built `dist/` exists, count package.json files | CLI package missing |
| 6. Upstream Tests | `phase_upstream_tests` | 10s | Skipped (we patch pre-built packages) | Never fails (advisory) |
| 7. Publish | `phase_publish` | 180s | Run `publish.mjs --no-rate-limit` to Verdaccio | publish.mjs exits non-zero |
| 8. Install | `phase_install` | 120s | `npm install @sparkleideas/cli` from Verdaccio, verify dependency tree | npm install fails or missing deps |
| 9. Release Qual | `phase_release_qualification` | 120s | Run RQ-1..RQ-12 against Verdaccio install (lib/acceptance-checks.sh) | Any RQ test fails |
| 10. Cleanup | `phase_cleanup` | — | Save logs, write results JSON, kill Verdaccio, remove temp dirs | Always runs |

### Verdaccio Configuration

Config generated per-run, but **storage persists** at `/tmp/ruflo-verdaccio-cache/`:

```yaml
storage: /tmp/ruflo-verdaccio-cache/storage
max_body_size: 200mb          # agentic-flow is ~60MB
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@sparkleideas/*':
    access: $all
    publish: $all              # Our packages: no proxy (must be published locally)
  '**':
    access: $all
    publish: $all
    proxy: npmjs               # External deps: proxy to real npm
```

Auth: htpasswd with test token. `NPM_CONFIG_REGISTRY` env var points npm at Verdaccio.

**Persistent cache**: Only `@sparkleideas/*` storage is cleared between runs. External dep tarballs from npmjs proxy survive, making Phase 8 (install) ~60% faster on subsequent runs (~30s → ~12s).

### Timeout System

Per-phase watchdog using background processes:

```
start_phase_timer(N, "phase_name")
  → spawns background: sleep N; kill -TERM $$
  → if phase completes first, watchdog is killed

run_phase_with_timeout(N, phase_fn)
  → start timer → run phase → cancel timer
  → no subshell (variables propagate normally)
```

Total possible timeout: 520s (~8.7 min). Actual runtime: ~30s (cached), ~46s (cold).

### CLI Flags

| Flag | Behavior |
|------|----------|
| `--snapshot <dir>` | Load upstream from pre-made tarballs (offline/reproducible) |
| `--create-snapshot <dir>` | Tarball current upstream sources, write manifest, exit |
| `-h` / `--help` | Print usage |

### Prerequisites

Node ≥ 20, pnpm, verdaccio, jq, upstream clones at `~/src/upstream/{ruflo,agentic-flow,ruv-FANN}`.

### Result Artifacts

Written to `test-results/<timestamp>/`:

| File | Content |
|------|---------|
| `.test-manifest.json` | Git HEADs, versions, platform, Verdaccio port |
| `integration-phases.json` | Per-phase `{name, pass, duration_ms, output}` array |
| `codemod-residuals.txt` | Any surviving `@claude-flow/` references |
| `publish-raw-output.txt` | Full publish.mjs stdout+stderr |
| `publish-summary.json` | Extracted JSON summary from publish.mjs |
| `verdaccio.log` | Registry diagnostic log |

---

## Layer 3: Release Qualification + Layer 4: Production Verification

### `scripts/test-acceptance.sh` — End-User Experience

**Command**: `bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>] [--package <name>]`

Runs real CLI commands against published packages to validate the user experience.

**Shared test library**: `lib/acceptance-checks.sh` — 12 functional test functions used by both Layer 3 (Verdaccio, Phase 9) and Layer 4 (real npm). One definition, two contexts.

| ID | Test | Validates |
|----|------|-----------|
| A1 | `npx @sparkleideas/cli --version` | Package resolves and executes |
| A2 | `npx @sparkleideas/cli init` | Init routine completes |
| A3 | `.claude/settings.json` exists | File generation |
| A4 | CLAUDE.md references `@sparkleideas` | Codemod applied to templates |
| A5 | `npx @sparkleideas/cli doctor --fix` | Doctor runs without MODULE_NOT_FOUND |
| A6 | MCP config in `.mcp.json` | MC-001: no `autoStart: false` |
| A7 | Wrapper proxy test | `@sparkleideas/ruflo` proxies to `@sparkleideas/cli` |
| A8 | No broken versions resolved | `@latest` does not resolve to prerelease with missing dist/ |
| A9 | Memory lifecycle | init → store → search → retrieve → verify storage on disk |
| A10 | Neural training | `neural train --pattern coordination` produces persisted patterns.json |
| A13 | Agent Booster ESM import | `@sparkleideas/agent-booster` module loads |
| A14 | Agent Booster binary | `npx @sparkleideas/agent-booster --version` |
| A15 | Plugins SDK import | `@sparkleideas/plugins` module loads |
| A16 | Plugin install | `plugins install --name @sparkleideas/plugin-prime-radiant` |

**A9 Memory lifecycle detail**: Initializes memory database (hybrid backend, HNSW indexing, 384-dim vectors), stores a key-value entry with namespace and tags, performs semantic search to verify the entry ranks first, retrieves by key to confirm value matches, then checks that `memory.db` exists on disk.

**A10 Neural training detail**: Runs `neural train --pattern coordination` which trains 50 epochs of coordination patterns, then verifies `.claude-flow/neural/patterns.json` was written with >0 entries.

**Exit code**: Number of failed tests (0 = all pass).

**Artifacts**: `test-results/<timestamp>/acceptance-results.json` with per-test `{id, name, passed, output, duration_ms}`.

### `scripts/test-codemod-acceptance.mjs` — Codemod Output Validation

**Command**: `node scripts/test-codemod-acceptance.mjs /path/to/build-dir`

Scans all `package.json` files in a build directory to verify:

1. No package name starts with `@claude-flow/`
2. No dependency key starts with `@claude-flow/`
3. All `@sparkleideas/*` internal dep ranges are `"*"` (no prerelease ranges, no dist-tags)

**Exit code**: 0 = all checks pass, 1 = errors found.

---

## Operational Checks

### `scripts/preflight.mjs` — Pre-Commit Consistency

**Command**: `npm run preflight` (write mode) or `npm run preflight:check` (read-only)

Syncs generated tables in `patch/CLAUDE.md` with actual `patch/*/` directories:
- Prefix-grouped defect counts
- Full defect table (ID, GitHub Issue, Severity)
- Uses `<!-- GENERATED:defect-tables:begin/end -->` markers

**Exit code**: 0 = up to date (or updated), 1 = stale (in `--check` mode).

Runs automatically before publish via `prepublishOnly` hook: `npm run preflight && npm test`.

### `check-patches.sh` — Sentinel Verification

**Command**: `bash check-patches.sh [--global] [--target <dir>]`

Reads `patch/*/sentinel` files and verifies patches are still applied in discovered installations:

- `grep "pattern"` — must find the pattern
- `absent "pattern"` — must NOT find the pattern
- `package: <name>` — scope to specific package

If any sentinel fails (e.g. npx cache was updated), automatically re-applies via `bash patch-all.sh`.

### `scripts/validate-ci.sh` — CI Health Check

**Command**: `bash scripts/validate-ci.sh`

Non-destructive validation of CI prerequisites:

| Category | Checks |
|----------|--------|
| Environment | Node ≥ 20, pnpm, python3, git, jq, gh CLI |
| systemd | Timer unit exists, enabled, active |
| Secrets | `~/.config/ruflo/secrets.env` exists, perms 600 |
| Upstream clones | All 3 repos have `.git` |
| Build state | `.last-build-state` exists |
| Verdaccio | Binary available |

**Exit code**: Number of failed checks (warnings don't count).

---

## Assertions & Mocking Patterns

### Assertion Library

All unit tests use Node's built-in `node:assert`:

| Method | Usage |
|--------|-------|
| `assert.equal()` | Exact equality |
| `assert.deepStrictEqual()` | Object/array equality |
| `assert.ok()` | Truthy checks |
| `assert.match()` | Regex pattern matching |
| `assert.rejects()` | Async error handling |
| `assert.throws()` | Sync error handling |

### Mocking Strategy

No external mocking framework. Mocks are created via:

- **Temp directories**: `mkdtempSync()` for isolated fixture files
- **Function injection**: `publishAll()` accepts `getPublishTagFn` option to replace `npm view` calls
- **Python subprocess**: `runPatch()` helper concatenates `common.py` + `fix.py` and spawns Python3
- **Synthetic fixtures**: Package.json and source files created inline per test

### Key Optimization

`06-publish-order.test.mjs` uses `mockGetPublishTag` (returns `'prerelease'` synchronously) to eliminate 216 `npm view` network calls. Result: **85s → 84ms** (1000x speedup).

---

## Performance Optimizations

### Integration Test (~106s → ~30s, 72% faster)

| Optimization | Impact |
|---|---|
| **Persistent Verdaccio cache** at `/tmp/ruflo-verdaccio-cache/` | Install: 30s → 12s (external deps cached across runs) |
| **Parallel clone** — 3 rsync ops run concurrently | Clone: ~2s → 0.6s |
| **Parallel publish within levels** — `Promise.all` per topological level | Publish: 21s → 12s |
| **Stale process cleanup** — kills orphaned Verdaccio on startup | Prevents port conflicts |
| **Faster Verdaccio poll** — 0.2s intervals vs 1s | Setup: -0.8s per check |
| **`--ignore-scripts --no-audit --no-fund`** on install | Skip native builds + network calls |
| **`--no-rate-limit`** flag for local Verdaccio | No 2s delay between publishes |
| **200mb `max_body_size`** | Accommodates agentic-flow (~60MB tarball) |

#### Typical Phase Timing (cached run)

```
setup:          1.4s ✓  (kill stale procs + start Verdaccio)
clone:          0.6s ✓  (parallel rsync × 3 repos)
codemod:        0.7s ✓  (scope rename + residual check)
patch:          0.03s ✓ (7 patches applied)
verify:         0.1s ✓  (package structure check)
upstream-tests: 0.001s ✓ (skipped — advisory)
publish:       12.3s ✓  (25 packages, parallel within 5 levels)
install:       12.3s ✓  (npm install, cached external deps)
cleanup:        0.8s ✓  (results + temp dir cleanup)
───────────────────────
total:         ~30s
```

First run (cold cache) takes ~46s as Verdaccio proxies external deps from npmjs.

### Unit Test Optimization (85s → 84ms, 1000x faster)

`mockGetPublishTag` injection in `06-publish-order.test.mjs` eliminates 216 `npm view` network calls by returning `'prerelease'` synchronously.

---

## npm Scripts Reference

```json
{
  "test":           "node scripts/test-runner.mjs",
  "test:fast":      "node scripts/test-runner.mjs",
  "preflight":      "node scripts/preflight.mjs",
  "preflight:check": "node scripts/preflight.mjs --check",
  "prepublishOnly": "npm run preflight && npm test"
}
```

---

## Test Lifecycle

```
Developer workflow:
  1. Edit code
  2. npm test              ← Layer 1: unit tests (0.2s)
  3. npm run preflight     ← sync doc tables
  4. git commit

Pre-publish workflow (manual):
  5. bash scripts/test-integration.sh  <- Layer 2+3: build verify + RQ (~53s cached)
  6. npm publish                       <- triggers prepublishOnly hook
  7. bash scripts/test-acceptance.sh   <- Layer 4: production verification (~15s)

Automated CI pipeline (sync-and-build.sh):
  Phase 9:  Layers 0-3 (codemod + unit + build verify + RQ)    <- Gate 1 (hard fail)
  Phase 11: publish to npm (prerelease tag)                     <- only if Gate 1 passes
  Phase 12: Layer 4 (production verification)                   <- Gate 2 (soft fail)
  Phase 13: promote to @latest                                  <- only if Gate 2 passes

Session start:
  8. bash check-patches.sh             ← verify/reapply patches

CI health:
  9. bash scripts/validate-ci.sh       ← non-destructive prereq check
```

### CI Test Gate

The automated pipeline (`scripts/sync-and-build.sh`) runs **all test layers before publishing to npm**:

| Phase | Tests | Blocks Publish? |
|-------|-------|----------------|
| 9a | Codemod acceptance (`test-codemod-acceptance.mjs`) | Yes — aborts on `@claude-flow/` residuals |
| 9b | Unit tests (`npm test`, 93 tests) | Yes — aborts on any failure |
| 9c | Integration test (`test-integration.sh`, 10 phases) | Yes — full Verdaccio dry run catches missing packages, broken deps |
| 9d | Release Qualification (`test-integration.sh` Phase 9, 12 RQ tests) | Yes — functional smoke tests against Verdaccio |
| 11 | Publish to npm | Only runs if 9a-9d all pass |
| 12 | Acceptance tests (`test-acceptance.sh`, 14 tests) | No — packages already live, creates GitHub issue on failure |

This ensures that a new upstream `@claude-flow/*` package missing from the publish list will be caught by the integration test's Phase 8 (install + dependency resolution) **before** anything reaches npm.

# Testing Framework

ruflo-patch uses a **3-layer testing model** (ADR-0020) with additional operational checks. Each layer targets a different level of confidence and runs at a different cadence.

## Architecture Overview

```
Layer 3: Acceptance     ← end-user commands against published packages (~2 min)
Layer 2: Integration    ← full pipeline: clone → codemod → patch → publish → install (~2 min)
Layer 1: Unit           ← individual functions, no external deps (~0.2s)
──────────────────────
Operational: preflight, sentinel check, CI health check
```

| Layer | Script | Tests | Duration | External Deps | When |
|-------|--------|-------|----------|---------------|------|
| 1 | `npm test` | 90 | ~0.2s | None | Every commit |
| 2 | `bash scripts/test-integration.sh` | 9 phases | ~106s | Verdaccio, upstream clones | Pre-publish, CI |
| 3 | `bash scripts/test-acceptance.sh` | 8 | ~2 min | Published packages | Post-publish |
| — | `npm run preflight` | — | <1s | None | Pre-commit |
| — | `bash check-patches.sh` | — | <10s | None | Session start |
| — | `bash scripts/validate-ci.sh` | — | <5s | Various | Ad-hoc |

---

## Layer 1: Unit Tests

**Runner**: `scripts/test-runner.mjs` → `node --test tests/*.test.mjs`

**Command**: `npm test`

### Test Suites (6 files, 90 tests)

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

### 9 Phases

| Phase | Function | Timeout | What It Does | Fails On |
|-------|----------|---------|-------------|----------|
| 1. Setup | `phase_setup` | 30s | Start Verdaccio on random port (4873-4999), create temp dirs | Verdaccio won't start |
| 2. Clone | `phase_clone` | 60s | Copy upstream repos (excluding .git) to temp build dir | Missing upstream clone |
| 3. Codemod | `phase_codemod` | 60s | Run `node scripts/codemod.mjs`, verify zero `@claude-flow/` residuals | Any residual found |
| 4. Patch | `phase_patch` | 30s | Run `bash patch-all.sh --target`, verify all 7 sentinels | Sentinel check fails |
| 5. Verify | `phase_build` | 30s | Check pre-built `dist/` exists, count package.json files | CLI package missing |
| 6. Upstream Tests | `phase_upstream_tests` | 10s | Skipped (we patch pre-built packages) | Never fails (advisory) |
| 7. Publish | `phase_publish` | 180s | Run `publish.mjs --no-rate-limit` to Verdaccio | publish.mjs exits non-zero |
| 8. Install | `phase_install` | 120s | `npm install @sparkleideas/cli` from Verdaccio, verify dependency tree | npm install fails or missing deps |
| 9. Cleanup | `phase_cleanup` | — | Save logs, write results JSON, kill Verdaccio, remove temp dirs | Always runs |

### Verdaccio Configuration

Generated per-run in a temp directory:

```yaml
storage: <temp>/storage
max_body_size: 100mb          # agentic-flow is large
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

Total possible timeout: 520s (~8.7 min). Actual runtime: ~106s.

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

## Layer 3: Acceptance Tests

### `scripts/test-acceptance.sh` — End-User Experience

**Command**: `bash scripts/test-acceptance.sh [--registry <url>] [--version <ver>] [--package <name>]`

Runs real CLI commands against published packages to validate the user experience.

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

Pre-publish workflow:
  5. bash scripts/test-integration.sh  ← Layer 2: full pipeline (~106s)
  6. npm publish                       ← triggers prepublishOnly hook
  7. bash scripts/test-acceptance.sh   ← Layer 3: end-user validation

Session start:
  8. bash check-patches.sh             ← verify/reapply patches

CI health:
  9. bash scripts/validate-ci.sh       ← non-destructive prereq check
```

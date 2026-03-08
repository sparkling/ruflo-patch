# Testing Strategy: Google Test Engineering Standards

**Project**: ruflo-patch (`@sparkleideas/*` packages)
**Version**: 2.0
**Date**: 2026-03-07
**Status**: Approved
**ADR**: [ADR-0023](adr/0023-google-testing-framework.md)

---

## 1. Philosophy

This testing strategy follows Google's Test Engineering and Release Engineering principles:

1. **Test at the boundaries** — validate inputs/outputs, not implementation details
2. **Hermetic tests** — each test owns its environment; no shared mutable state
3. **Deterministic results** — same code = same outcome, regardless of host
4. **Shift left** — catch defects at the cheapest layer (unit > integration > E2E)
5. **Test the contract, not the code** — public API stability matters more than internals
6. **Verdaccio-first deployment** — nothing reaches real npm without passing local registry tests
7. **Test in staging, verify in production** — staging (Verdaccio) is for discovery; production (npm) is for confirmation

---

## 2. Google Release Engineering Model

Google's release pipeline has four phases. We map them to six layers:

```
┌──────────────────────────────────────────────────────────────────┐
│ PRESUBMIT — "Does the code compile and pass basic contracts?"   │
│   Layer -1: Environment Validation (advisory)                    │
│   Layer  0: Static Analysis (Small)                              │
│   Layer  1: Unit Tests (Small)                                   │
├──────────────────────────────────────────────────────────────────┤
│ BUILD VERIFICATION — "Does the pipeline produce valid packages?" │
│   Layer  2: Build + Publish to Verdaccio (Medium)                │
├──────────────────────────────────────────────────────────────────┤
│ RELEASE QUALIFICATION — "Do the packages actually work?"         │
│   Layer  3: Functional Smoke against Verdaccio install (Medium)  │
│                                                                  │
│ ══════════════════════ GATE 1 ═══════════════════════════════    │
│ All layers pass → publish to npm                                 │
│ Any layer fails → abort, create issue, DO NOT PUBLISH            │
├──────────────────────────────────────────────────────────────────┤
│ PRODUCTION VERIFICATION — "Does production match staging?"       │
│   Layer  4: Acceptance Tests against real npm (Large)            │
│                                                                  │
│ ══════════════════════ GATE 2 ═══════════════════════════════    │
│ Pass → promote to @latest                                        │
│ Fail → stay on prerelease, investigate deployment                │
└──────────────────────────────────────────────────────────────────┘
```

### Test Pyramid

```
                      ┌─────────┐
                      │ Layer 4 │  Production Verification (post-publish)
                      │  Large  │  14 tests · real npm · confirmation
                    ┌─┴─────────┴─┐
                    │   Layer 3   │  Release Qualification (pre-publish)
                    │   Medium    │  14 tests · Verdaccio install · discovery
                  ┌─┴─────────────┴─┐
                  │    Layer 2      │  Build Verification
                  │    Medium       │  8 phases · Verdaccio publish + install
                ┌─┴─────────────────┴─┐
                │     Layer 1         │  Unit Tests
                │     Small           │  93 tests · <0.2s
              ┌─┴─────────────────────┴─┐
              │      Layer 0            │  Static Analysis
              │      Small              │  Codemod acceptance · preflight
            ┌─┴─────────────────────────┴─┐
            │        Layer -1             │  Environment Validation
            │        Smoke                │  validate-ci.sh · doctor
            └─────────────────────────────┘
```

### Size Definitions (Google Standard)

| Size | Time Limit | Network | External Services | Our Layers |
|------|-----------|---------|-------------------|------------|
| **Small** | < 1s | None | None | Layer -1, 0, 1 |
| **Medium** | < 300s | localhost | Verdaccio only | Layer 2, 3 |
| **Large** | < 900s | Yes | npm, GitHub | Layer 4 |

---

## 3. Test Categories

### 3.1 Layer -1: Environment Validation (Smoke)

**Purpose**: Confirm the host can run the pipeline at all.
**Google phase**: Presubmit

| Check | Tool | What It Validates |
|-------|------|-------------------|
| Node version | `validate-ci.sh` | Node >= 20 present |
| Python3 | `validate-ci.sh` | Python3 available for patches |
| Upstream repos | `validate-ci.sh` | `~/src/upstream/{ruflo,agentic-flow,ruv-FANN}` exist |
| npm auth | `validate-ci.sh` | `npm whoami` succeeds |
| systemd timer | `validate-ci.sh` | `ruflo-sync.timer` active (optional) |

**When to run**: On new machine setup, after OS upgrades, before first deploy.
**Failure mode**: Non-blocking warnings. Fix before attempting pipeline.
**Timeout**: 30s (advisory -- does not abort pipeline).

---

### 3.2 Layer 0: Static Analysis & Codemod Validation

**Purpose**: Catch structural defects without executing application code.
**Google phase**: Presubmit

| Test | Runner | Checks | Count |
|------|--------|--------|-------|
| Codemod acceptance | `test-codemod-acceptance.mjs` | No `@claude-flow/*` refs remain; all internal deps are `"*"` | 4 rules per package.json |
| Preflight | `scripts/preflight.mjs` | Doc tables in `patch/CLAUDE.md` are in sync with patch/ directory | 1 consistency check |
| Sentinel verification | `check-patches.sh` | Each patch's sentinel grep patterns match target files | 1 per active patch (6) |

**Properties**:
- No subprocess execution of application code
- No network access
- Pure filesystem validation
- Deterministic and idempotent
- **Timeout gates**: 10s for preflight, 30s for check-patches (per-step enforcement)

**Commands**:
```bash
node scripts/test-codemod-acceptance.mjs <build-dir>  # Codemod acceptance
npm run preflight                                       # Pre-commit doc sync
bash check-patches.sh                                   # Sentinel verification
```

---

### 3.3 Layer 1: Unit Tests (Small)

**Purpose**: Validate individual functions and patch logic in isolation.
**Google phase**: Presubmit

| File | Tests | Scope | Key Assertions |
|------|-------|-------|---------------|
| `01-common-library.test.mjs` | 9 | `lib/common.py` — patch()/patch_all() helpers | Idempotency, missing file handling, string replacement |
| `02-discovery.test.mjs` | 2 | `lib/discover.mjs` — patch directory scanning | Export shape, return structure |
| `03-mc001-mcp-autostart.test.mjs` | 4 | MC-001 patch — autoStart removal | Behavioral correctness, idempotency, context preservation |
| `04-codemod.test.mjs` | 18 | `scripts/codemod.mjs` — scope rename | Transform accuracy, exclusions, idempotency, dep ranges |
| `05-pipeline-logic.test.mjs` | 28 | Version computation, state parsing, change detection | ADR-0012 versioning, ADR-0011 state, ADR-0015 publish tags |
| `06-publish-order.test.mjs` | 23 | Topological publish ordering (ADR-0014) | Level assignments, dep validation, first-publish bootstrap |
| **Total** | **93** | | |

**Properties**:
- **Hermetic**: Temp directories with cleanup; no shared state
- **Fast**: < 0.2s total execution
- **No network**: All filesystem-local
- **No external dependencies**: No Verdaccio, no npm, no git operations
- **Framework**: Node.js built-in `node:test` with `node:assert` (strict)
- **Style**: BDD (`describe`/`it`) with nested suites
- **Skip threshold**: Max 8 skipped tests (enforced by test runner)
- **Timeout**: 60s default (configurable via `TEST_TIMEOUT` env var)
- **Structured logging**: ISO8601 timestamps and per-suite timing recorded in test manifest

**Test Doubles Strategy** (Google "Test Doubles" guidance):
- **Fakes**: Temp directories simulate real installs (`createFixture()`)
- **Stubs**: `spawnSync('python3', ...)` for patch execution
- **No mocks in unit layer**: Tests validate real transformations against fixture files
- **Injected dependencies**: `getPublishTagFn` parameter allows test-controlled npm view

**Commands**:
```bash
npm test                    # Run all unit tests
npm run test:fast           # Same (alias)
TEST_CONCURRENCY=1 npm test # Serial execution for debugging
SAVE_TEST_RESULTS=1 npm test # Save TAP + manifest to test-results/
```

---

### 3.4 Layer 2: Build Verification (Medium)

**Purpose**: Validate pipeline mechanics end-to-end against a local Verdaccio registry. Answers: "Can we codemod, patch, publish, and install successfully?"
**Google phase**: Build Verification

**Runner**: `scripts/test-integration.sh` (9 phases: 1-8 + cleanup)

| Phase | Name | Timeout | What It Validates |
|-------|------|---------|-------------------|
| 1 | Setup | 30s | Health check Verdaccio at localhost:4873; clear `@sparkleideas/*` cache |
| 2 | Clone | 60s | Upstream repos copied to temp dir |
| 3 | Codemod | 60s | Scope rename produces zero `@claude-flow/*` residuals |
| 4 | Patch | 30s | All patches apply; sentinel files verify |
| 5 | Verify | 30s | Package.json count matches expected (no missing packages) |
| 6 | Upstream | 10s | Skipped (advisory only -- we don't rebuild from source) |
| 7 | Publish | 90s | All packages publish to local Verdaccio; JSON summary |
| 8 | Install | 60s | `npm install @sparkleideas/cli` resolves all deps from Verdaccio |
| 9 | Cleanup | -- | Save logs, write results JSON, remove temp dirs |

**What Layer 2 proves**: Pipeline mechanics work -- codemod transforms, patches apply, packages resolve, dependency tree is complete.
**What Layer 2 does NOT prove**: Packages actually *work* (that's Layer 3). `test-integration.sh` does NOT build TypeScript -- packages have no `dist/` directory. This is correct: the integration test validates pipeline logic, not product functionality.

**Properties**:
- **Permanent Verdaccio**: systemd user service at `localhost:4873`; scripts health-check it, never start/stop it
- **External dep cache**: `~/.verdaccio/storage` (permanent, never cleared -- speeds up repeat runs)
- **Incremental by default**: Only changed `@sparkleideas/*` packages cleared from storage; unchanged packages persist as build cache; external deps persist permanently
- **Global timeout**: 180s (3 minutes)
- **Per-phase heartbeat**: Logging every 10s to detect hangs
- **Deterministic**: Upstream snapshots captured in test manifest

**Verdaccio Configuration** (`~/.verdaccio/config.yaml` -- permanent, not generated per-run):
```yaml
max_body_size: 200mb        # Large packages (ruv-swarm, agentic-flow)
uplinks:
  npmjs:
    url: https://registry.npmjs.org/  # External dep fallback
packages:
  '@sparkleideas/*':
    access: $all
    publish: $authenticated
    proxy: ''                # No upstream proxy for our packages
  '**':
    proxy: npmjs             # Everything else from real npm
```

---

### 3.5 Layer 3: Release Qualification (Medium)

**Purpose**: Functional smoke tests against **built** packages installed from Verdaccio. Answers: "Do the packages actually work from a user's perspective?" This is the **last gate before publishing to real npm**.
**Google phase**: Release Qualification

**Runner**: `scripts/test-rq.sh` -- standalone script that can run independently with `--build-dir <path>`, or called by `sync-and-build.sh` during deployment. RQ requires `dist/` directories that only exist after the TypeScript build step.

**Why RQ is a standalone script**: RQ exercises the built product -- it runs CLI commands, imports ESM modules, and tests functional behavior. These operations require compiled TypeScript (`dist/`). Extracting RQ into its own script follows the separation-of-concerns principle (development, build, test, and deployment are distinct activities) while still allowing `sync-and-build.sh` to call it as a deployment gate.

**Test library**: `lib/acceptance-checks.sh` -- shared test functions used by both Layer 3 (against Verdaccio, in `sync-and-build.sh`) and Layer 4 (against real npm, in `test-acceptance.sh`). One test definition, two execution contexts.

| ID | Test | What It Catches Pre-Publish |
|----|------|----------------------------|
| RQ-1 | `--version` | Missing `dist/`, broken entry point, ERR_MODULE_NOT_FOUND |
| RQ-2 | `init` | Broken init templates, missing generated files |
| RQ-3 | Settings file | `.claude/settings.json` not generated |
| RQ-4 | Scope check | `CLAUDE.md` still references `@claude-flow` after codemod |
| RQ-5 | `doctor --fix` | MODULE_NOT_FOUND in health check command |
| RQ-6 | MCP config | `autoStart: false` still present (MC-001 patch not applied) |
| RQ-7 | Wrapper proxy | `@sparkleideas/ruflo` → `@sparkleideas/cli` delegation broken |
| RQ-8 | Memory lifecycle | init/store/search/retrieve chain fails |
| RQ-9 | Neural training | patterns.json not generated |
| RQ-10 | Agent Booster ESM | `@sparkleideas/agent-booster` ESM import fails |
| RQ-11 | Agent Booster CLI | `npx @sparkleideas/agent-booster --version` fails |
| RQ-12 | Plugins SDK | `@sparkleideas/plugins` import fails |

**Tests excluded from Release Qualification** (registry-specific, require real npm):

| Excluded | Why | Covered At |
|----------|-----|------------|
| A8 (broken version) | Tests `@latest` dist-tag resolution — Verdaccio has no tag history | Layer 4 only |
| A16 (plugin install) | Depends on plugin being separately published and resolvable | Layer 4 only |

**Properties**:
- **Standalone runner** -- `bash scripts/test-rq.sh --build-dir <path>` can be run independently against any build directory with `dist/`
- **Uses global Verdaccio** -- health-checks the permanent service at `localhost:4873`, clears `@sparkleideas/*`, publishes built packages, installs into fresh temp dir
- **Hard fail** -- any RQ failure aborts the pipeline before publish to real npm
- **Timeout**: 180s global with SIGTERM→5s→SIGKILL escalation
- **No side effects** -- uses `--no-save` when publishing to Verdaccio, so `config/published-versions.json` is not mutated
- **Estimated duration**: ~17s (standalone against cached build)

**Key principle**: Layer 3 is where bugs are **discovered**. If a functional defect exists, it is caught here -- before any package reaches real npm. Layer 4 (production verification) should never be the first time a bug is found.

**Separation of concerns**: Development, build, test, and deployment are distinct activities. `test-integration.sh` is a test (validates pipeline logic). `sync-and-build.sh` is a build+deploy pipeline (produces artifacts, qualifies them, ships them). RQ is a deployment gate, not a test phase.

---

### 3.6 Layer 4: Production Verification (Large)

**Purpose**: Confirm that published packages on real npm match what passed in staging (Verdaccio). Answers: "Does production match staging?"
**Google phase**: Production Verification

**Runner**: `scripts/test-acceptance.sh`

| ID | Test | What It Validates |
|----|------|-------------------|
| A1 | `--version` | CLI loads without ERR_MODULE_NOT_FOUND (catches missing dist/) |
| A2 | `init` | Project initialization succeeds in temp dir |
| A3 | Settings file | `.claude/settings.json` exists post-init |
| A4 | Scope check | `CLAUDE.md` contains `@sparkleideas` references |
| A5 | `doctor --fix` | Health check runs without MODULE_NOT_FOUND |
| A6 | MCP config | `.mcp.json` exists; does NOT contain `autoStart: false` (MC-001) |
| A7 | Wrapper proxy | `@sparkleideas/ruflo` correctly proxies to `@sparkleideas/cli` |
| A8 | Version format | `@sparkleideas/cli@latest` resolves to non-patch version |
| A9 | Memory lifecycle | `init` → `store` → `search` (semantic) → `retrieve`; DB file on disk |
| A10 | Neural training | `neural train --pattern coordination` produces patterns.json |
| A13 | Agent Booster ESM | `@sparkleideas/agent-booster` ESM import succeeds |
| A14 | Agent Booster CLI | `npx @sparkleideas/agent-booster --version` returns version |
| A15 | Plugins SDK | `@sparkleideas/plugins` imports successfully |
| A16 | Plugin install | `plugins install --name @sparkleideas/plugin-prime-radiant` works |

**Semantics change from v1.0**: Layer 4 tests are **confirmation, not discovery**. If Layer 3 (Release Qualification) passed against Verdaccio but Layer 4 fails against real npm, the root cause is a **deployment or registry issue**, not a code bug.

| Scenario | Root Cause | Action |
|----------|-----------|--------|
| Layer 3 fails | Code bug | Fix code, don't publish |
| Layer 3 passes, Layer 4 fails | Deployment issue (CDN lag, dist-tag race, registry error) | Investigate registry; code is known-good |
| Both pass | Ship it | Promote to `@latest` |

**Properties**:
- **Runs against real npm** by default (post-publish validation)
- **Registry-agnostic**: `--registry <url>` flag for Verdaccio ad-hoc testing
- **Exit code** = number of failed tests (0 = all pass)
- **Soft fail**: Failures create GitHub issues but don't un-publish
- **Idempotent**: Uses temp dirs, cleans up after
- **Timeout**: 300s global; per-test slow warnings for tests exceeding 30s
- **Structured logging**: ISO8601 timestamps, per-test timing in results JSON

**Output**: `test-results/{timestamp}/acceptance-results.json`

**Commands**:
```bash
bash scripts/test-acceptance.sh                                    # Against real npm
bash scripts/test-acceptance.sh --registry http://localhost:4873   # Against Verdaccio
```

---

## 4. Verdaccio Integration Model

Verdaccio is the cornerstone of pre-deployment validation. It serves as both a **staging environment** and a **build cache** — functionally identical to real npm but fully isolated. All packages must pass both structural (Layer 2) and functional (Layer 3) validation against Verdaccio before reaching real npm.

Verdaccio's persistent storage (`~/.verdaccio/storage`) acts as a package-level build cache. With incremental builds (Decision 10), unchanged packages are never rebuilt, never republished, and never cleared from Verdaccio. They persist from the previous run. Only changed packages (and their topological dependents) are rebuilt, republished, and re-cached. The content hash in `config/package-checksums.json` is the cache key. This transforms Verdaccio from "clear everything, republish everything" into "update only what changed" — the same principle as incremental compilation.

### 4.1 Architecture

```
+------------------------------------------------------------------+
|                      sync-and-build.sh                            |
|                                                                   |
|  Phase 7: Build (TypeScript compilation -> dist/)                 |
|  Phase 8: Patch (against compiled dist/*.js)                      |
|                                                                   |
|  Phase 9: Test                                                    |
|  +--------------------------------------------------------------+ |
|  |  Layer 0: Codemod acceptance (test-codemod-acceptance.mjs)    | |
|  |  Layer 1: Unit tests (npm test, 93 tests)                    | |
|  |                                                               | |
|  |  Layer 2: Pipeline Mechanics (test-integration.sh)            | |
|  |  +----------------------------------------------------------+| |
|  |  | Clones from git (no dist/) -> codemod -> patch -> publish || |
|  |  | -> install. Tests pipeline logic, NOT product function.   || |
|  |  +----------------------------------------------------------+| |
|  |                                                               | |
|  |  Layer 3: Release Qualification (BUILT packages)              | |
|  |  +----------------------------------------------------------+| |
|  |  | Built dir -----> Local Verdaccio (:4873+)                 || |
|  |  | (with dist/)    +---------------------------+             || |
|  |  |                 | @sparkleideas/* (local)    |             || |
|  |  |                 | ** (proxy -> npmjs)        |             || |
|  |  |                 +-------------+-------------+             || |
|  |  |                               |                           || |
|  |  |  npm install <----------------+                           || |
|  |  |                                                           || |
|  |  |  RQ-1: --version    RQ-7:  wrapper proxy                 || |
|  |  |  RQ-2: init         RQ-8:  memory lifecycle              || |
|  |  |  RQ-3: settings     RQ-9:  neural training               || |
|  |  |  RQ-4: scope check  RQ-10: agent-booster ESM             || |
|  |  |  RQ-5: doctor       RQ-11: agent-booster CLI             || |
|  |  |  RQ-6: MCP config   RQ-12: plugins SDK                   || |
|  |  |                                                           || |
|  |  |  "packages WORK" (requires dist/)                        || |
|  |  +----------------------------------------------------------+| |
|  +--------------------------------------------------------------+ |
|                                                                   |
|  ==================== GATE 1 ============================         |
|                                                                   |
|  Phase 10: Compute version (bumpLastSegment)                      |
|  Phase 11: Publish --> Real npm (only if Gate 1 passes)           |
|                                                                   |
|  Layer 4: Production Verification                                 |
|  Phase 12: Acceptance --> test-acceptance.sh (real npm)            |
|                                                                   |
|  ==================== GATE 2 ============================         |
|                                                                   |
|  Phase 13: Promote --> @latest (only if Gate 2 passes)            |
+------------------------------------------------------------------+

STANDALONE USE (ADR-0026):
  npm run build          -> Build only (cached at /tmp/ruflo-build)
  npm run test:unit      -> Layer 1 only (unit tests, 0.2s)
  npm run test:integration -> Layer 2 only (pipeline mechanics)
  npm run test:rq        -> Layer 3 only (requires npm run build first)
  npm run test:acceptance -> Layer 4 only (post-publish verification)
  npm test               -> L0 + L1 + L2 ("safe to commit?")
  npm run test:all       -> L0 + L1 + L2 + L3 ("safe to publish?")
  npm run deploy         -> ALL layers (build + test + publish + promote)
```

### 4.2 Verdaccio Lifecycle

Verdaccio runs as a **permanent systemd user service** (`verdaccio.service`) at `localhost:4873`. Scripts never start or stop Verdaccio -- they health-check it and manage its storage selectively. External dependency caches persist permanently across runs.

#### Full Mode (safety fallback)

Triggered by: `--force`, missing checksums, codemod change, or patch infrastructure change. Clears all `@sparkleideas/*` packages and rebuilds everything.

#### Incremental Mode (default)

Always active. Uses content hashes to skip unchanged packages. Verdaccio's persistent storage is the build cache.

**In `test-integration.sh` (Layer 2 -- pipeline mechanics)**:

| Step | Action | Detail |
|------|--------|--------|
| 1 | Health check | Verify Verdaccio is responding at `localhost:4873` |
| 2 | Selective clear | Clear only **changed** packages from storage (via `CHANGED_PACKAGES_JSON`); unchanged packages persist |
| 3 | Publish packages | Changed packages from git clone; unchanged already in cache |
| 4 | Install test | `npm install @sparkleideas/cli` — resolves from cache + fresh publish |
| 5 | Validate deps | Dep resolution, `npm ls`, package structure |
| 6 | Capture logs | Copy verdaccio.log to results dir |

**In `sync-and-build.sh` (Layer 3 -- release qualification)**:

| Step | Action | Detail |
|------|--------|--------|
| 1 | Health check | Verify Verdaccio is responding at `localhost:4873` |
| 2 | Change detection | Compare SHA-256 hashes against `config/package-checksums.json` |
| 3 | Selective clear | Remove only **changed** `@sparkleideas/*` packages from storage |
| 4 | Build changed | TypeScript compilation for changed packages + dependents only |
| 5 | Publish changed | Only changed packages to Verdaccio; **unchanged packages already cached from previous run** |
| 6 | Install test | `npm install @sparkleideas/cli` — resolves changed packages from fresh publish, unchanged from cache |
| 7 | RQ smoke tests | RQ-1 through RQ-12 (same tests, fewer packages rebuilt) |
| 8 | Save checksums | Update `config/package-checksums.json` with new hashes |

```
Default:       detect changes → clear CHANGED → build CHANGED → publish CHANGED → install (rest from cache) → test
Full fallback: clear ALL → build ALL → publish ALL → install → test  (--force, missing checksums, codemod change)
```

**Fallback**: If `npm install` fails in incremental mode (stale cache), the pipeline automatically falls back to full mode (clear all, rebuild all).

The critical difference between Layer 2 and Layer 3: `sync-and-build.sh` publishes **built** packages (TypeScript compiled to `dist/`), so RQ tests can execute them. `test-integration.sh` publishes from git clones (no `dist/`), so it can only validate structural correctness (packages resolve and install).

### 4.3 Verdaccio Configuration Rules

- **`max_body_size: 200mb`** — required for large packages (ruv-swarm)
- **`proxy: npmjs`** uplink for external deps (lodash, better-sqlite3, etc.)
- **No proxy for `@sparkleideas/*`** — forces local-only resolution
- **htpasswd auth** — prevents accidental writes
- **Permanent storage** at `~/.verdaccio/storage` — external dep cache persists permanently, never cleared; only `@sparkleideas/*` packages are cleared per-run
- **Verdaccio runs as systemd user service** (`verdaccio.service`), auto-starts on boot
- **Config** at `~/.verdaccio/config.yaml` (permanent, not generated per-run)

---

## 5. Shared Test Library

### 5.1 Design: One Definition, Two Contexts

Functional tests are defined once in `lib/acceptance-checks.sh` and executed in two contexts:

```
lib/acceptance-checks.sh          <- shared test functions
  |
  +-- sync-and-build.sh           <- sources it, runs against Verdaccio (Layer 3)
  |   REGISTRY=http://localhost:$PORT
  |   Runs during deployment, after build, before publish to npm
  |   Hard fail: blocks publish
  |   Requires: dist/ (built TypeScript)
  |
  +-- test-acceptance.sh          <- sources it, runs against real npm (Layer 4)
      REGISTRY=https://registry.npmjs.org
      Runs as Phase 12 of sync-and-build
      Soft fail: blocks promotion
      + adds A8 (dist-tag) and A16 (plugin install)

NOTE: test-integration.sh does NOT source this library.
      It tests pipeline mechanics only (Layer 2).
```

This eliminates duplication. Adding a new functional test to the shared library automatically runs it in both layers unless explicitly excluded.

### 5.2 Adding a New Functional Test

1. Add test function to `lib/acceptance-checks.sh`
2. The function receives `$REGISTRY`, `$TEMP_DIR`, and `$PKG` from the caller
3. It runs in both Layer 3 (Verdaccio) and Layer 4 (real npm) by default
4. If the test is registry-specific (requires dist-tags, CDN propagation), add it to `test-acceptance.sh` only and document why in a comment

---

## 6. Pipeline Integration

### 6.1 Gate Model

Tests gate the pipeline at two checkpoints. Nothing proceeds past a failed gate.

```
Developer Workflow:
  edit -> preflight -> unit tests -> commit

Deployment Pipeline (sync-and-build.sh):
  upstream check -> codemod -> BUILD (tsc) -> patch
       |
       v
  +------------------------------------------+
  |  GATE 1: Pre-Publish (hard fail)         |
  |                                          |
  |  Layer 0: Codemod acceptance, sentinels  |
  |  Layer 1: Unit tests (93)                |
  |  Layer 2: Pipeline mechanics             |
  |           (test-integration.sh, no RQ)   |
  |  Layer 3: Release qualification (14 RQ)  |
  |           (against BUILT packages)       |
  |                                          |
  |  "Packages install AND work"             |
  +--------------------+---------------------+
                       | ALL PASS
                       v
  +------------------------------------------+
  |  COMPUTE VERSION (bumpLastSegment)       |
  +--------------------+---------------------+
                       |
                       v
  +------------------------------------------+
  |  PUBLISH to real npm                     |
  |  42 packages, 5 levels                   |
  |  Tag: prerelease                         |
  +--------------------+---------------------+
                       |
                       v
  +------------------------------------------+
  |  GATE 2: Post-Publish (soft fail)        |
  |                                          |
  |  Layer 4: Production verification (14)   |
  |                                          |
  |  "Production matches staging"            |
  +--------------------+---------------------+
                       | PASS          | FAIL
                       v               v
  +--------------------+   +--------------------+
  |  PROMOTE to        |   |  Stay on           |
  |  @latest           |   |  prerelease        |
  |                    |   |  GitHub issue       |
  |                    |   |  (deployment bug,   |
  |                    |   |   not code bug)     |
  +--------------------+   +--------------------+
```

### 6.2 Failure Semantics

The key insight: where a test fails tells you **what kind of bug** you have.

| Failure At | Root Cause | Action |
|------------|-----------|--------|
| Layer 0-1 | Logic bug in codemod, patch, or pipeline | Fix code. Re-run `npm test`. |
| Layer 2 | Build/publish/dependency bug | Check Verdaccio logs. Fix package structure. |
| Layer 3 | **Functional bug** — packages install but don't work | Fix code. This is the most valuable catch — prevented a broken deploy. |
| Layer 3 pass, Layer 4 fail | **Deployment issue** — code works in staging but not in prod | Investigate: CDN propagation, dist-tag race, npm registry lag. Code is known-good. |

### 6.3 What Layer 3 Prevents

Every bug caught at Layer 3 (Release Qualification) instead of Layer 4 (Production Verification) is a **prevented deployment of broken packages to real users**.

| Failure Class | Without Layer 3 | With Layer 3 | Impact |
|---|---|---|---|
| Missing `dist/` | Users get ERR_MODULE_NOT_FOUND | Caught pre-publish | Prevented broken deploy |
| Broken `init` | Users can't bootstrap | Caught pre-publish | Prevented broken deploy |
| MC-001 not applied | MCP servers don't auto-start | Caught pre-publish | Prevented broken deploy |
| Memory subsystem broken | `memory store` crashes | Caught pre-publish | Prevented broken deploy |
| Agent booster import | WASM acceleration unavailable | Caught pre-publish | Prevented broken deploy |
| Dist-tag resolves wrong | Wrong version installed | Still caught at Layer 4 | Registry-specific (can't test in staging) |

### 6.4 When to Run What

| Change Type | Required Tests | Command |
|-------------|---------------|---------|
| Patch `fix.py` | Preflight + unit | `npm run preflight && npm run test:unit` |
| Codemod change | All local (L0+L1+L2) | `npm test` |
| Pipeline script change | All local (L0+L1+L2) | `npm test` |
| Build/RQ script change | All local + RQ | `npm test && npm run build && npm run test:rq` |
| Pre-publish verification | All pre-publish (L0-L3) | `npm run build && npm run test:all` |
| Deploy to npm | ALL layers (automatic) | `npm run deploy` |
| Verify live packages | Production verification only | `npm run test:acceptance` |
| New machine setup | Environment validation | `npm run validate` |

**Important**: Each test layer is independently runnable (ADR-0026). `npm run test:rq` runs standalone against cached build artifacts at `/tmp/ruflo-build`. Run `npm run build` first to create or refresh the cache. `npm run deploy` still runs all layers as a monolithic pipeline.

### 6.5 Automated Schedule

| Trigger | Frequency | Pipeline |
|---------|-----------|----------|
| systemd timer | Every 6 hours | Full `sync-and-build.sh` (all layers) |
| Manual | On demand | Full `sync-and-build.sh` |
| Pre-commit | Every commit | `npm run preflight` |

---

## 7. Test Properties (Google Standards)

### 7.1 FIRST Principles

| Principle | Layer 0-1 | Layer 2-3 | Layer 4 |
|-----------|-----------|-----------|---------|
| **F**ast | < 0.2s | < 300s | < 900s |
| **I**solated | Temp dirs, no shared state | Isolated Verdaccio instance | Temp install dirs |
| **R**epeatable | Deterministic | Deterministic (pinned upstreams) | Dependent on npm CDN propagation |
| **S**elf-validating | Pass/fail exit code | Per-phase JSON results | Per-test JSON results |
| **T**imely | Run on every change | Run before publish | Run after publish |

### 7.2 Hermetic Test Requirements

All tests must satisfy:

1. **No shared filesystem state** — use temp directories with cleanup
2. **No cross-run package leakage** — only changed `@sparkleideas/*` packages cleared from Verdaccio (incremental default); full clear on safety fallback triggers; external dep cache is shared but read-only from the test's perspective
3. **No host-dependent paths** — use `$TMPDIR` or `/tmp/`
4. **No time-dependent assertions** — no `sleep` + check patterns
5. **No order-dependent execution** — each test file runs independently
6. **Idempotent** — running twice produces the same result

### 7.3 Test Naming Convention

```
tests/{NN}-{descriptive-name}.test.mjs       # Unit tests
lib/acceptance-checks.sh                      # Shared functional tests (RQ-* / A*)
```

- `NN` = two-digit ordering prefix (01-99)
- Files run in lexicographic order but MUST NOT depend on ordering
- Names describe the unit under test, not the test behavior

### 7.4 Assertion Style Guide

| Use | For |
|-----|-----|
| `assert.equal(actual, expected)` | Strict equality (primitives) |
| `assert.deepStrictEqual(actual, expected)` | Object/array comparison |
| `assert.ok(value)` | Truthy checks |
| `assert.match(string, regex)` | Pattern matching in output |
| `assert.rejects(asyncFn, errorType)` | Async error paths |

Do NOT use: `assert.deepEqual()` (non-strict), manual `if/throw`, `console.log`-based assertions.

---

## 8. Test Result Artifacts

All test layers produce machine-readable results for observability.

### 8.1 Directory Structure

```
test-results/
  {YYYY-MM-DD_HH-MM-SS}/
    ├── unit-tests.tap              # TAP output from unit tests (Layer 1)
    ├── .test-manifest.json         # Environment metadata
    ├── integration-phases.json     # Per-phase timing and pass/fail (Layer 2-3)
    ├── qualification-results.json  # Per-RQ-test results (Layer 3)
    ├── publish-summary.json        # Per-package publish results
    ├── verdaccio.log               # Local registry log
    ├── codemod-residuals.txt       # Empty if codemod clean (Layer 0)
    ├── acceptance-results.json     # Per-test results A1-A16 (Layer 4)
    └── install-raw-output.txt      # npm install output
```

### 8.2 Manifest Schema

```json
{
  "timestamp": "2026-03-07T14:32:15Z",
  "node_version": "v22.x.x",
  "platform": "linux-x64",
  "upstream_heads": {
    "ruflo": "abc123",
    "agentic-flow": "def456",
    "ruv-FANN": "789ghi"
  },
  "test_count": 93,
  "duration_ms": 180,
  "skip_count": 0
}
```

---

## 9. Failure Handling

### 9.1 Failure Modes by Layer

| Layer | Google Phase | Failure Mode | Impact | Recovery |
|-------|-------------|-------------|--------|----------|
| 0 (Static) | Presubmit | Hard fail | Pipeline aborts pre-publish | Fix codemod logic |
| 1 (Unit) | Presubmit | Hard fail | Pipeline aborts pre-publish | Fix failing test or code |
| 2 (Build) | Build Verification | Hard fail | Pipeline aborts pre-publish | Check Verdaccio logs, dep resolution |
| 3 (Qualification) | Release Qualification | Hard fail | Pipeline aborts pre-publish | Fix functional bug — **most valuable catch** |
| 4 (Production) | Production Verification | Soft fail | Packages live but NOT promoted | Investigate deployment; `rollback.sh` if critical |

### 9.2 Rollback Procedure

```bash
bash scripts/promote.sh --dry-run   # View current state
bash scripts/rollback.sh            # Emergency rollback to previous version
bash scripts/rollback.sh <version>  # Manual rollback to specific version
```

### 9.3 Flaky Test Policy (Google Standard)

- **Quarantine**: Flaky tests get `{ skip: true }` with a tracking comment
- **Skip threshold**: Max 8 skipped tests enforced by test runner
- **Fix deadline**: Quarantined tests must be fixed or removed within 2 weeks
- **No retry loops**: Tests must not use `sleep` + retry patterns
- **Root cause required**: Every flaky test failure gets a root cause analysis

---

## 10. Coverage Model

### 10.1 What We Measure

| Metric | Target | Current | Tool |
|--------|--------|---------|------|
| Unit test count | Growing | 93 | `npm test` |
| Patch coverage | 100% of active patches | 6/6 | Sentinel checks |
| Build verification phases | All phases pass | 10/10 | `test-integration.sh` |
| Release qualification | All RQ tests pass | 12/12 | `test-integration.sh` Phase 9 |
| Production verification | All acceptance tests pass | 14/14 | `test-acceptance.sh` |
| Codemod rule coverage | All transform rules | 4/4 | `test-codemod-acceptance.mjs` |

### 10.2 What We Do NOT Measure

- Line-level code coverage (not applicable — we patch upstream, not our own source)
- Performance benchmarks (out of scope for correctness testing)
- Visual/UI testing (CLI-only project)

---

## 11. Adding New Tests

### 11.1 New Unit Test (Layer 1)

1. Create `tests/{NN}-{name}.test.mjs` (next available number)
2. Import from `node:test` and `node:assert`
3. Use `describe`/`it` structure
4. Create temp fixtures, clean up in `afterEach`
5. Run: `npm test`
6. Verify: skip threshold not exceeded

```javascript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('new-feature', () => {
  let tmp;
  afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));

  it('does the thing', () => {
    tmp = mkdtempSync(join(tmpdir(), 'test-'));
    // ... test logic ...
    assert.equal(actual, expected);
  });
});
```

### 11.2 New Functional Test (Layer 3 + 4)

1. Add test function to `lib/acceptance-checks.sh`
2. Function receives `$REGISTRY`, `$TEMP_DIR`, `$PKG` from caller
3. Runs automatically in both Layer 3 (Verdaccio) and Layer 4 (real npm)
4. If registry-specific (needs dist-tags, CDN), add to `test-acceptance.sh` only with a comment explaining why

### 11.3 New Patch Test (Layer 1)

1. Create unit test in `tests/{NN}-{patch-id}.test.mjs`
2. Test must validate: apply, idempotency, context preservation
3. Sentinel file in patch dir must have grep patterns
4. Sentinel verified by `check-patches.sh`

---

## 12. Anti-Patterns (What NOT to Do)

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| Run only `npm test` before deploy | Misses build verification, qualification, and production verification | Run `bash scripts/sync-and-build.sh` |
| Test against real npm pre-publish | Circular dependency; packages don't exist yet | Use Verdaccio for all pre-publish validation |
| Skip integration tests for "small" changes | Patch interactions are non-obvious | Always run full integration (includes RQ) for patches |
| Use production verification for bug discovery | Bugs found post-publish already affect users | Catch functional bugs at Layer 3 (Release Qualification) |
| Duplicate test logic between RQ and acceptance | Tests drift apart; one gets updated, other doesn't | Use shared `lib/acceptance-checks.sh` library |
| Put RQ in test-integration.sh | Integration test has no dist/ -- 82% expected failures, pure noise | RQ belongs in sync-and-build.sh where built artifacts exist |
| Mark expected failures as "advisory" | Normalizes failure, creates alarm fatigue, hides real regressions | Tests pass, fail, or skip. No advisory status. |
| Add `sleep` in tests | Non-deterministic, wastes time | Use retry with backoff or event-driven waits |
| Share state between test files | Order-dependent failures | Temp dirs with cleanup per test |
| Mock everything | Misses real integration bugs | Mock at boundaries only; use fakes for filesystems |
| Treat Layer 4 failure as code bug | If Layer 3 passed, it's a deployment issue | Investigate registry/CDN, not code |

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **Gate** | A test checkpoint that must pass before the pipeline proceeds |
| **Hard fail** | Test failure that aborts the pipeline (Gate 1) |
| **Soft fail** | Test failure that creates an issue but doesn't un-publish (Gate 2) |
| **Release Qualification** | Functional smoke tests in staging (Verdaccio) before deploy — the last line of defense |
| **Production Verification** | Confirmation tests in production (real npm) after deploy — should never discover new bugs |
| **Sentinel** | Grep pattern in a patch directory that verifies the patch was applied |
| **Codemod** | Automated source transformation (`@claude-flow/*` → `@sparkleideas/*`) |
| **Verdaccio** | Local npm registry used as the staging environment |
| **Staging** | Verdaccio — where bugs are discovered (Layer 2-3) |
| **Production** | Real npm — where deployment is confirmed (Layer 4) |
| **Topological order** | Publish packages in dependency order (leaves first, roots last) |
| **Hermetic** | Test that creates and destroys its own environment |
| **Quarantine** | Temporarily skipping a flaky test with a tracking comment |
| **Incremental build** | Rebuild only packages whose content hash changed + their topological dependents |
| **Content hash** | SHA-256 of a package directory's file contents after codemod+patch, used for change detection |
| **Dependency propagation** | If package at Level N changes, all dependents at Levels N+1..5 must rebuild |

---

## 14. Incremental Build Strategy (ADR-0023, Decision 10)

### 14.1 Problem

The pipeline rebuilds all 42+ packages on every run (~3.5 min). Most changes affect 1-5 packages.

### 14.2 Solution: Content-Hash Change Detection

After codemod (Phase 5) and patches (Phase 6), compute SHA-256 of each package directory. Compare against stored hashes in `config/package-checksums.json`. Skip unchanged packages for build and publish.

```
Phase 5: Codemod (all packages)
Phase 6: Patches (all packages)
Phase 6.5: Change Detection (NEW)
  ┌─────────────────────────────────────────────────────────┐
  │  For each package directory:                            │
  │    current_hash = SHA256(sorted file contents)          │
  │    stored_hash  = package-checksums.json[pkg_name]      │
  │    if current_hash != stored_hash:                      │
  │      mark as CHANGED                                    │
  │                                                         │
  │  Propagate via topological levels:                      │
  │    Level N changed → Levels N+1..5 also rebuild         │
  │                                                         │
  │  Full rebuild triggers:                                 │
  │    - codemod.mjs content changed                        │
  │    - lib/common.py content changed                      │
  │    - checksums file missing/corrupt                     │
  │    - --force flag                                       │
  └─────────────────────────────────────────────────────────┘
Phase 7: Build (CHANGED packages only)
Phase 8: Patch post-build (CHANGED packages only)
```

### 14.3 Upstream Repo to Package Mapping

| Upstream Repo | Packages | Count |
|---|---|---|
| `ruflo` | shared, memory, embeddings, codex, aidefence, neural, hooks, browser, plugins, providers, claims, guidance, mcp, integration, deployment, swarm, security, performance, testing, cli, claude-flow | 21 |
| `agentic-flow` | agentdb, agentic-flow, agent-booster, agentdb-onnx | 4 |
| `ruv-FANN` | ruv-swarm, cuda-wasm | 2 |
| Derived (plugins) | 13 plugin-* packages, teammate-plugin, ruvector-upstream | 15 |

### 14.4 Patch to Package Mapping

| Patch | Target Packages | Path Variables Used |
|---|---|---|
| MC-001 | cli | MCP_GEN |
| FB-001 | cli, memory, agentic-flow | MI, MEMORY_BRIDGE, AF_BRIDGE, EMB_TOOLS |
| FB-002 | cli | (helpers) |
| FB-004 | cli, memory | MEMORY_BRIDGE, MI, CLI_MEMORY, MCP_MEMORY |
| SV-001 | agentic-flow | AGENTIC_FLOW_PKG_JSON |
| SG-003 | cli | INIT_CMD, EXECUTOR |

### 14.5 Dependency Propagation

```
If shared (L2) changes:
  → neural, hooks, browser, plugins, providers, claims (L3)
  → mcp, swarm, guidance, ..., all plugins (L4)
  → cli, claude-flow (L5)
  = 36+ packages rebuild

If ruv-swarm (L1) changes:
  → nothing directly depends on it in source
  = 1 package rebuilds (+ L5 for safety)

If plugin-prime-radiant (L4) changes:
  → nothing depends on it
  = 1 package rebuilds
```

### 14.6 Verdaccio as Build Cache

Verdaccio's persistent storage is the build cache. The content hash is the cache key.

| Mode | What gets cleared | What gets built | What gets published | Cache hit |
|---|---|---|---|---|
| **Full** (current) | All `@sparkleideas/*` | All 42+ packages | All 42+ packages | 0% |
| **Incremental** | Only changed + dependents | Only changed + dependents | Only changed + dependents | 60-95% |
| **Fallback** | All (after install failure) | All | All | 0% |

**Key principle**: If a package's content hash hasn't changed since last run, it doesn't need to be rebuilt, doesn't need to be republished, and doesn't need to be cleared from Verdaccio. It's already there, identical to what would be produced. `npm install` resolves it from the cache just as it would from a fresh publish.

### 14.7 New Files

| File | Purpose |
|---|---|
| `scripts/package-hash.mjs` | Compute SHA-256 hashes, diff against stored, propagate changes via LEVELS |
| `config/package-checksums.json` | Per-package content hashes + meta (codemod hash, patch dir hash) |

### 14.8 Expected Savings

| Change Type | Packages Rebuilt | Time | Savings vs Full |
|---|---|---|---|
| Patch fix (typical) | 1-5 | ~1.5 min | ~60% |
| ruv-FANN upstream | 2 | ~1 min | ~70% |
| Single plugin change | 1 | ~30s | ~85% |
| agentic-flow upstream | 2-6 | ~1.5-2 min | ~40-55% |
| Codemod change | ALL | ~3.5 min | 0% |

### 14.9 Safety

- `--force` always triggers full rebuild (existing behavior preserved)
- Missing checksums = full rebuild (safe first run)
- Codemod/patch infrastructure changes = full rebuild
- Post-publish hash verification catches non-determinism
- Verdaccio install failure = automatic fallback to full cache clear

**Status**: Implemented. Incremental builds are the default for all layers.

---

## Appendix A: Layer Separation Rationale (ADR-0023)

The six layers serve four distinct Google release engineering phases:

| Google Phase | Our Layers | Environment | Purpose |
|-------------|-----------|-------------|---------|
| Presubmit | -1, 0, 1 | Local filesystem | Code correctness |
| Build Verification | 2 | Verdaccio (publish + install) | Package structure |
| Release Qualification | 3 | Verdaccio (functional smoke) | Package functionality |
| Production Verification | 4 | Real npm | Deployment confirmation |

**Critical rule**: Release Qualification (Layer 3) and Production Verification (Layer 4) are *not* the same test running twice. Layer 3 is **discovery** (find bugs before they ship). Layer 4 is **confirmation** (verify prod matches staging). If Layer 3 passes but Layer 4 fails, the bug is in deployment infrastructure, not in code.

**Critical rule**: RQ (Layer 3) lives in `sync-and-build.sh`, NOT `test-integration.sh`. RQ exercises the built product (runs CLI commands, imports ESM modules). Built artifacts (`dist/`) only exist after `sync-and-build.sh` Phase 7 (TypeScript build). `test-integration.sh` tests pipeline mechanics without building -- it structurally cannot run RQ.

`sync-and-build.sh` orchestrates all phases:
1. Build (Phase 7) + Patch (Phase 8) -- produces artifacts with `dist/`
2. Layers 0-3 (Phase 9) -- Gate 1 -- blocks publish
3. Publish (Phase 11) -- real npm, prerelease tag
4. Layer 4 (Phase 12) -- Gate 2 -- blocks promotion
5. Promote (Phase 13) -- `@latest` tag

Running `test-integration.sh` alone validates Layer 2 (pipeline mechanics). Running `test-acceptance.sh` alone validates Layer 4. Only `sync-and-build.sh` runs all layers including Layer 3 (RQ).

## Appendix B: Topological Publish Order (ADR-0014)

```
Level 1 (no internal deps):
  agentdb, agentic-flow, ruv-swarm, agent-booster, shared, codex

Level 2:
  memory, embeddings, aidefence, providers, browser

Level 3:
  neural, hooks, plugins, claims, guidance

Level 4:
  mcp, integration, deployment, swarm, security, performance,
  testing, plugin-prime-radiant, plugin-code-review, ...

Level 5 (root packages):
  cli, claude-flow
```

## Appendix C: Version Scheme (ADR-0012)

```
nextVersion = bumpLastSegment(max(upstream, lastPublished))

Examples:
  upstream=3.0.2, lastPublished=null     → 3.0.3
  upstream=3.0.2, lastPublished=3.0.3    → 3.0.4
  upstream=3.0.0-alpha.6, lastPub=null   → 3.0.0-alpha.7
```

Per-package versions tracked in `config/published-versions.json` (committed to git).

## Appendix D: Cost of Layer 3

| Metric | Without Layer 3 | With Layer 3 | Delta |
|--------|----------------|-------------|-------|
| Deploy pipeline duration | ~3 min | ~3.5 min | +30s |
| Integration test duration | ~47s | ~47s | 0 (RQ not in integration test) |
| Acceptance test duration | ~15s | ~15s | 0 |
| New infrastructure | -- | None (shared Verdaccio) | 0 |
| New scripts | -- | 1 (`lib/acceptance-checks.sh`) | +1 file |
| Bugs caught pre-publish | Structural only | Structural + functional | Significant improvement |

30 seconds of pre-publish testing during deployment to prevent shipping broken packages. That's the trade. The integration test (`test-integration.sh`) is unaffected -- it continues to validate pipeline mechanics in ~47s.

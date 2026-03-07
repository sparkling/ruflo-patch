# ADR-0023: Google Test Engineering Framework

- **Status**: Accepted (supersedes ADR-0020)
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Decision Drivers

- ADR-0020's 3-layer model is missing formal test sizing, gate definitions, and hermeticity requirements
- Test counts have drifted (78→93 unit, 6→14 acceptance) without doc updates
- Environment validation and static analysis exist as scripts but are not classified as test layers
- Verdaccio is used ad-hoc rather than as an architectural requirement
- No flaky test policy, skip threshold, or anti-pattern catalog for contributors
- No structured artifact schema for cross-run comparison
- Integration tests prove packages **install** but not that they **work** — functional bugs are only discovered post-publish when they already affect users
- 12 of 14 acceptance tests could run pre-publish against Verdaccio, closing the validation gap before deployment

## Context and Problem Statement

### Specification (SPARC-S)

ADR-0020 established a 3-layer testing strategy (unit, integration, acceptance) that has been running successfully. However, the strategy document lacks:

1. **Formal test sizing** — no definitions for Small/Medium/Large tests per Google standards
2. **Verdaccio-first deployment model** — Verdaccio usage is ad-hoc rather than architectural
3. **Gate model** — no explicit distinction between hard-fail (pre-publish) and soft-fail (post-publish) gates
4. **Test properties** — no requirements for hermeticity, determinism, or skip thresholds
5. **Layer -1 and Layer 0** — environment validation and static analysis are undocumented as test layers
6. **Artifact specification** — test result schemas are informal
7. **Anti-pattern catalog** — no documented pitfalls for contributors

Additionally, a critical **validation gap** exists in the current pipeline:

- **Layer 2 (Integration)** proves packages install and deps resolve — but never runs `--version`, `init`, `doctor`, `memory`, or any import check
- **Layer 3 (Acceptance)** proves packages work — but only runs **post-publish**, after broken packages are already live on npm
- 12 of 14 acceptance tests are not registry-specific and could run against a Verdaccio install pre-publish

This means functional bugs (missing `dist/`, broken init, MC-001 patch not applied, memory subsystem failures) are only discovered **after deployment**. Google's Release Engineering principles require functional validation in staging (Verdaccio) before production (npm).

**Gap analysis** — what acceptance tests catch that integration tests miss:

| Test | What It Catches | Pre-Publish via Verdaccio? |
|------|----------------|---------------------------|
| A1 `--version` | Missing `dist/`, broken entry point | Yes |
| A2 `init` | Broken templates, missing files | Yes |
| A3 Settings file | `.claude/settings.json` not generated | Yes |
| A4 Scope check | `@claude-flow` refs surviving codemod | Yes |
| A5 `doctor --fix` | MODULE_NOT_FOUND in health check | Yes |
| A6 MCP config | `autoStart: false` not patched (MC-001) | Yes |
| A7 Wrapper proxy | ruflo → CLI delegation broken | Yes |
| A8 Version format | `@latest` resolves to `-patch` version | **No** — dist-tag history is registry-specific |
| A9 Memory lifecycle | init/store/search/retrieve fails | Yes |
| A10 Neural training | patterns.json not generated | Yes |
| A13 Agent Booster ESM | ESM import fails | Yes |
| A14 Agent Booster CLI | Binary doesn't run | Yes |
| A15 Plugins SDK | Import fails | Yes |
| A16 Plugin install | Plugin resolution fails | **Partial** — depends on plugin also being in Verdaccio |

The testing infrastructure has also evolved since ADR-0020:

| Metric | ADR-0020 (original) | Current | This ADR |
|--------|---------------------|---------|----------|
| Unit tests | 78 | 93 | 93 |
| Acceptance tests | 6 (A1-A6) | 14 (A1-A16) | 14 (A1-A16) |
| Integration phases | 9 | 9 | 10 (adding RQ phase) |
| Published packages | 26 | 42 | 42 |
| Test layers | 3 | 5 | 6 (adding Release Qualification) |
| Pre-publish functional tests | 0 | 0 | 12 (new) |

### Pseudocode (SPARC-P)

```
GOOGLE RELEASE ENGINEERING PHASES:

  PRESUBMIT        → Layer -1, 0, 1   "Does the code pass basic contracts?"
  BUILD VERIFY     → Layer 2          "Do packages install?"
  RELEASE QUALIFY  → Layer 3          "Do packages work?"     ← NEW
  ════════════════ GATE 1 ════════════ (hard fail, blocks publish)
  PROD VERIFY      → Layer 4          "Does production match staging?"
  ════════════════ GATE 2 ════════════ (soft fail, blocks promotion)

FRAMEWORK STRUCTURE:

Layer -1: SMOKE (Environment Validation)
  validate-ci.sh:
    CHECK node >= 20
    CHECK python3 available
    CHECK upstream repos exist at ~/src/upstream/*
    CHECK npm auth (npm whoami)
    CHECK systemd timer (optional)
  WHEN: new machine, OS upgrade, before first deploy
  GATE: none (advisory)

Layer 0: STATIC ANALYSIS (Small)
  test-codemod-acceptance.mjs:
    FOR EACH package.json IN build_dir:
      ASSERT name NOT starts_with "@claude-flow/"
      ASSERT no dep key starts_with "@claude-flow/"
      ASSERT @sparkleideas/* deps == "*" (no prerelease ranges)
  preflight.mjs:
    GENERATE doc tables from patch/ directory
    ASSERT tables match patch/CLAUDE.md content
  check-patches.sh:
    FOR EACH patch IN active_patches:
      ASSERT sentinel patterns present in target files
  WHEN: every commit (preflight), every build (codemod, sentinels)
  GATE: hard fail (blocks publish)

Layer 1: UNIT TESTS (Small)
  CONSTRAINT: < 1s total, no network, no external services, temp I/O only
  tests/01-common-library.test.mjs   →  9 tests  (patch infrastructure)
  tests/02-discovery.test.mjs        →  2 tests  (directory scanning)
  tests/03-mc001-mcp-autostart.test.mjs → 4 tests (MC-001 patch)
  tests/04-codemod.test.mjs          → 18 tests  (scope transforms)
  tests/05-pipeline-logic.test.mjs   → 28 tests  (version, state, tags)
  tests/06-publish-order.test.mjs    → 23 tests  (topological order)
  TOTAL: 93 tests
  WHEN: every commit, every build
  GATE: hard fail (blocks publish)

Layer 2: BUILD VERIFICATION (Medium)
  CONSTRAINT: localhost only (Verdaccio), temp dirs
  TIMEOUT: 600s global (across Layer 2 + 3); actual runtime ~70s
  test-integration.sh Phases 1-8:
    Phase 1: Setup    (Verdaccio on random port)     [30s timeout]
    Phase 2: Clone    (copy upstream to temp)         [60s timeout]
    Phase 3: Codemod  (scope rename + verify)         [60s timeout]
    Phase 4: Patch    (apply + sentinel verify)       [30s timeout]
    Phase 5: Verify   (package count check)           [30s timeout]
    Phase 6: Upstream (skipped — advisory only)       [10s timeout]
    Phase 7: Publish  (all packages to Verdaccio)     [180s timeout]
    Phase 8: Install  (npm install from Verdaccio)    [120s timeout]
  PROVES: "packages install"
  DOES NOT PROVE: "packages work"
  WHEN: before every publish
  GATE: hard fail (blocks publish)

Layer 3: RELEASE QUALIFICATION (Medium)                     ← NEW
  CONSTRAINT: < 120s, localhost only, same Verdaccio from Layer 2
  test-integration.sh Phase 9 (sources lib/acceptance-checks.sh):
    RQ-1:  --version              (catches missing dist/)
    RQ-2:  init                   (project bootstrap)
    RQ-3:  settings file          (file generation)
    RQ-4:  scope check            (@sparkleideas refs)
    RQ-5:  doctor --fix           (health check)
    RQ-6:  MCP config             (MC-001 autoStart)
    RQ-7:  wrapper proxy          (ruflo → cli delegation)
    RQ-8:  memory lifecycle       (init/store/search/retrieve)
    RQ-9:  neural training        (patterns.json generation)
    RQ-10: agent-booster ESM      (ESM import)
    RQ-11: agent-booster CLI      (--version runs)
    RQ-12: plugins SDK            (ESM import)
  PROVES: "packages work"
  EXCLUDED (registry-specific, Layer 4 only):
    A8:  dist-tag resolution (Verdaccio has no tag history)
    A16: plugin install (depends on separate plugin publish)
  WHEN: before every publish, after Layer 2 install
  GATE: hard fail (blocks publish)

  ════════════════ GATE 1 ════════════════════════════════════

Layer 4: PRODUCTION VERIFICATION (Large)                    ← was Layer 3
  CONSTRAINT: < 300s, real network (npm registry)
  test-acceptance.sh (sources lib/acceptance-checks.sh + registry-specific):
    A1-A7, A9-A10, A13-A15: same tests as RQ-1 through RQ-12
    A8:   version format         (dist-tag, Layer 4 only)
    A16:  plugin install          (plugin resolution, Layer 4 only)
  PROVES: "production matches staging"
  SEMANTICS: confirmation, NOT discovery
  WHEN: post-publish only (Phase 12 of sync-and-build)
  GATE: soft fail (blocks promotion, not un-publish)

  ════════════════ GATE 2 ════════════════════════════════════

SHARED TEST LIBRARY:
  lib/acceptance-checks.sh:
    - Defines test functions for RQ-1..RQ-12 / A1..A15
    - Receives $REGISTRY, $TEMP_DIR, $PKG from caller
    - test-integration.sh sources it → runs against Verdaccio (Layer 3)
    - test-acceptance.sh sources it → runs against real npm (Layer 4)
    - One definition, two execution contexts
    - Adding a test to the library auto-runs it in both layers

PIPELINE FLOW:
  sync-and-build.sh orchestrates all layers:
    s-a-b Phase 9   → Layer 0 + 1 + 2 + 3 (pre-publish gates)
                       (internally runs test-integration.sh Phases 1-10)
    s-a-b Phase 11  → Publish to npm (prerelease tag)
    s-a-b Phase 12  → Layer 4 (post-publish gate)
    s-a-b Phase 13  → Promote to @latest (only if Layer 4 passes)
    s-a-b Phase 14  → GitHub release notification

  NOTE: "Phase 9" has two meanings:
    - sync-and-build.sh Phase 9 = run all pre-publish tests (Layers 0-3)
    - test-integration.sh Phase 9 = Release Qualification (Layer 3 only)

FAILURE SEMANTICS:
  Layer 3 fails           → code bug, don't publish, fix code
  Layer 3 pass, L4 fail   → deployment issue, investigate registry/CDN
  Both pass               → promote to @latest
```

## Decision Outcome

Chosen option: "Google Test Engineering Framework with six-layer pyramid and two-gate deployment model", because it closes the pre-publish validation gap (12 functional tests shift left), provides formal test sizing (Small/Medium/Large), and establishes Verdaccio as an architectural staging requirement rather than ad-hoc tooling.

### Architecture (SPARC-A)

Adopt Google Test Engineering and Release Engineering standards as the formal framework for all testing. This supersedes ADR-0020 by adding formal test sizing, a release qualification layer, a two-gate model, hermeticity requirements, and the Verdaccio-as-staging architecture.

#### Decision 1: Google Test Sizes

Map all existing tests to Google's Small/Medium/Large taxonomy:

| Google Size | Time Limit | Network | External Services | Our Layers |
|-------------|-----------|---------|-------------------|------------|
| **Small** | < 1s | None | None | Layer -1, 0, 1 |
| **Medium** | < 300s | localhost | Verdaccio only | Layer 2, 3 |
| **Large** | < 900s | Yes | npm, GitHub | Layer 4 |

All new tests MUST declare their size. Existing tests are classified per the table above.

#### Decision 2: Six-Layer Test Pyramid

Expand from 3 layers (ADR-0020) to 6 layers, mapped to Google's four release engineering phases:

```
                      ┌─────────┐
                      │ Layer 4 │  Production Verification (post-publish, Large)
                      │  14 tests · real npm · confirmation
                    ┌─┴─────────┴─┐
                    │   Layer 3   │  Release Qualification (pre-publish, Medium)
                    │  12 tests · Verdaccio install · discovery        ← NEW
                  ┌─┴─────────────┴─┐
                  │    Layer 2      │  Build Verification (Medium)
                  │  8 phases · Verdaccio publish + install
                ┌─┴─────────────────┴─┐
                │     Layer 1         │  Unit Tests (Small)
                │     93 tests
              ┌─┴─────────────────────┴─┐
              │      Layer 0            │  Static Analysis (Small)
              │  codemod + preflight + sentinels
            ┌─┴─────────────────────────┴─┐
            │        Layer -1             │  Environment Validation (advisory)
            │   validate-ci.sh
            └─────────────────────────────┘
```

| Google Phase | Our Layers | Environment | Purpose |
|-------------|-----------|-------------|---------|
| Presubmit | -1, 0, 1 | Local filesystem | Code correctness |
| Build Verification | 2 | Verdaccio (publish + install) | Package structure |
| Release Qualification | 3 | Verdaccio (functional smoke) | Package functionality |
| Production Verification | 4 | Real npm | Deployment confirmation |

#### Decision 3: Two-Gate Deployment Model

Define two explicit gates in the deployment pipeline:

**Gate 1 — Pre-Publish (hard fail, blocks publish)**:
- Layer 0: Codemod acceptance, preflight, sentinel verification
- Layer 1: 93 unit tests
- Layer 2: 8-phase build verification against local Verdaccio (Phases 1-8 of `test-integration.sh`)
- Layer 3: 12 release qualification tests against Verdaccio install

If any check in Gate 1 fails, the pipeline aborts. Nothing is published. A GitHub issue is created with the failure details.

**Gate 2 — Post-Publish (soft fail, blocks promotion)**:
- Layer 4: 14 production verification tests against real npm

If Gate 2 fails, packages remain on the `prerelease` dist-tag. Users on `@latest` are unaffected. A GitHub issue is created. The `rollback.sh` script is available for critical regressions.

**Failure semantics** — where a test fails tells you what kind of bug you have:

| Scenario | Root Cause | Action |
|----------|-----------|--------|
| Layer 0-1 fails | Logic bug in codemod, patch, or pipeline | Fix code |
| Layer 2 fails | Build/publish/dependency bug | Check Verdaccio logs, fix package structure |
| Layer 3 fails | **Functional bug** — packages install but don't work | Fix code. Most valuable catch — prevented broken deploy |
| Layer 3 passes, Layer 4 fails | **Deployment issue** — code works in staging, not in prod | Investigate CDN propagation, dist-tag race, npm lag. Code is known-good |
| Both pass | Ship it | Promote to `@latest` |

#### Decision 4: Verdaccio-as-Staging Architecture

Verdaccio is the **staging environment**. All packages must pass both structural (Layer 2) and functional (Layer 3) validation against Verdaccio before reaching real npm. Verdaccio is not optional infrastructure — it is architecturally required.

**Verdaccio lifecycle per integration test run**:

1. Kill any stale Verdaccio processes
2. Pick random port (4873-4999) to prevent conflicts
3. Generate isolated config (auth, uplinks, package rules)
4. Start daemon with log capture
5. Wait for ready (HTTP health check with retry)
6. Publish all 42 packages in topological order (5 levels) — **Layer 2**
7. Install `@sparkleideas/cli` from local registry — **Layer 2**
8. Validate deps (`npm ls`, package structure) — **Layer 2**
9. Run RQ-1 through RQ-12 against installed packages — **Layer 3**
10. Capture logs to results directory
11. Kill daemon and clean up

**Configuration rules**:
- `max_body_size: 200mb` (required for large packages like ruv-swarm)
- `proxy: npmjs` uplink for external deps only
- No proxy for `@sparkleideas/*` (forces local-only resolution)
- Persistent external dep cache at `/tmp/ruflo-verdaccio-cache/`
- Per-run isolation: only `@sparkleideas/*` packages cleared between runs

#### Decision 5: Hermetic Test Requirements

All tests must satisfy Google's hermeticity standards:

| Property | Requirement |
|----------|------------|
| No shared filesystem state | Use `mkdtempSync()` with cleanup in `afterEach` |
| No persistent network | Verdaccio starts/stops per run |
| No host-dependent paths | Use `$TMPDIR` or `/tmp/` |
| No time-dependent assertions | No `sleep` + check patterns |
| No order-dependent execution | Each test file runs independently |
| Idempotent | Running twice produces the same result |
| Deterministic exit code | 0 = pass, non-zero = fail count |

#### Decision 6: Test Doubles Strategy

Follow Google's "Test Doubles" guidance:

| Double Type | Usage |
|-------------|-------|
| **Fakes** | Temp directories simulate real installs (`createFixture()`) |
| **Stubs** | `spawnSync('python3', ...)` for isolated patch execution |
| **Injected deps** | `getPublishTagFn` parameter for test-controlled npm view |
| **No mocks in unit layer** | Tests validate real transformations against fixture files |

Mocks are reserved for boundary interfaces (npm registry responses). Internal logic is tested with real code paths and fake filesystems.

#### Decision 7: Flaky Test Policy

Per Google's flaky test standards:

1. **Quarantine**: Flaky tests get `{ skip: true }` with a tracking comment and issue link
2. **Skip threshold**: Max 8 skipped tests enforced by test runner (`SKIP_THRESHOLD` in `test-runner.mjs`)
3. **Fix deadline**: Quarantined tests must be fixed or removed within 2 weeks
4. **No retry loops**: Tests MUST NOT use `sleep` + retry patterns
5. **Root cause required**: Every flaky test failure gets root cause analysis before quarantine

#### Decision 8: Structured Test Artifacts

All test layers produce machine-readable results:

```
test-results/{YYYY-MM-DD_HH-MM-SS}/
  ├── unit-tests.tap              # TAP output (Layer 1)
  ├── .test-manifest.json         # Environment metadata
  ├── integration-phases.json     # Per-phase timing and pass/fail (Layer 2)
  ├── qualification-results.json  # Per-RQ-test results (Layer 3)
  ├── publish-summary.json        # Per-package publish results
  ├── verdaccio.log               # Local registry log
  ├── codemod-residuals.txt       # Empty if codemod clean (Layer 0)
  ├── acceptance-results.json     # Per-test results A1-A16 (Layer 4)
  └── install-raw-output.txt      # npm install stdout
```

Results are `.gitignore`d but persist on the build server. The `.test-manifest.json` records exact upstream HEADs, Node version, and platform for reproducibility.

#### Decision 9: Release Qualification Layer (Layer 3)

**Problem**: The integration test (Layer 2) proves packages install and deps resolve, but never runs a single CLI command. The acceptance test (Layer 4) proves packages work, but only runs post-publish. This means functional bugs reach real npm before being detected.

**Solution**: Add a Release Qualification layer (Layer 3) that runs 12 functional smoke tests against the Verdaccio install from Layer 2, before publishing to real npm. This is Google's standard "test in staging before deploying to production" pattern.

**Design principles**:

1. **Shares Verdaccio from Layer 2** — no additional infrastructure. Same registry, same install directory.
2. **One test definition, two contexts** — functional tests live in `lib/acceptance-checks.sh`, sourced by both `test-integration.sh` (Layer 3, Verdaccio) and `test-acceptance.sh` (Layer 4, real npm). Eliminates duplication.
3. **Hard fail** — any RQ failure aborts the pipeline. This is pre-publish, so nothing has shipped.
4. **Layer 4 becomes confirmation** — if Layer 3 passed in staging but Layer 4 fails in production, the root cause is a deployment issue (CDN lag, dist-tag race), not a code bug.

**Release Qualification tests (RQ-1 through RQ-12)**:

| ID | Source | What It Catches Pre-Publish |
|----|--------|----------------------------|
| RQ-1 | A1 | Missing `dist/`, broken entry point, ERR_MODULE_NOT_FOUND |
| RQ-2 | A2 | Broken init templates, missing generated files |
| RQ-3 | A3 | `.claude/settings.json` not generated |
| RQ-4 | A4 | `@claude-flow` refs surviving codemod in init output |
| RQ-5 | A5 | MODULE_NOT_FOUND in doctor health check |
| RQ-6 | A6 | `autoStart: false` not patched (MC-001) |
| RQ-7 | A7 | `@sparkleideas/ruflo` → CLI delegation broken |
| RQ-8 | A9 | Memory init/store/search/retrieve chain failure |
| RQ-9 | A10 | Neural training patterns.json not generated |
| RQ-10 | A13 | `@sparkleideas/agent-booster` ESM import failure |
| RQ-11 | A14 | Agent booster binary doesn't execute |
| RQ-12 | A15 | `@sparkleideas/plugins` SDK import failure |

**Tests excluded from Release Qualification** (registry-specific, Layer 4 only):

| Excluded | Reason |
|----------|--------|
| A8 (broken version) | Tests `@latest` dist-tag resolution — Verdaccio has no tag history to validate against |
| A16 (plugin install) | Depends on plugin being independently published and resolvable from the registry |

**Integration test phase changes**:

| Phase | Before | After |
|-------|--------|-------|
| 1-8 | Setup through Install | Unchanged (Layer 2: Build Verification) |
| 9 | Cleanup | **Release Qualification** — run RQ-1 through RQ-12 (Layer 3) |
| 10 | — | Cleanup (renumbered from 9) |

**Cost**:

| Metric | Without Layer 3 | With Layer 3 | Delta |
|--------|----------------|-------------|-------|
| Integration test duration | ~47s | ~70s | +23s |
| Acceptance test duration | ~15s | ~15s | 0 |
| New infrastructure | — | None (shared Verdaccio) | 0 |
| New scripts | — | 1 (`lib/acceptance-checks.sh`) | +1 file |

**What Layer 3 prevents** — every bug caught here instead of Layer 4 is a prevented deployment of broken packages:

| Failure Class | Without Layer 3: Discovered At | With Layer 3: Discovered At |
|---|---|---|
| Missing `dist/` | Post-publish (users affected) | Pre-publish (deploy blocked) |
| Broken `init` | Post-publish (users affected) | Pre-publish (deploy blocked) |
| MC-001 patch not applied | Post-publish (users affected) | Pre-publish (deploy blocked) |
| Memory subsystem broken | Post-publish (users affected) | Pre-publish (deploy blocked) |
| Agent booster import fail | Post-publish (users affected) | Pre-publish (deploy blocked) |
| Dist-tag resolves wrong | Post-publish (Layer 4) | Post-publish (Layer 4) — registry-specific, cannot shift left |

### Considered Options

#### Option 1: Jest or Vitest as Test Framework

**Rejected**. The project uses Node.js built-in `node:test` with `node:assert/strict`. This has zero dependencies, ships with Node >= 20, and produces TAP output natively. Adding Jest/Vitest would introduce ~200 transitive dependencies for no functional benefit. Google's guidance is to use the simplest framework that meets requirements.

#### Option 2: Code Coverage Metrics (Istanbul/c8)

**Rejected as mandatory metric**. This project patches upstream code — we don't own the source being tested. Line-level coverage of our scripts (codemod, publish, patch helpers) would be misleading because the critical paths are in *how* these scripts interact, not individual line execution. The 6-layer pyramid provides behavioral coverage that is more meaningful than line counts.

Coverage tooling MAY be added later for the `lib/` and `scripts/` directories if the codebase grows significantly.

#### Option 3: Docker-Based Integration Tests

**Rejected** (consistent with ADR-0020). Docker adds image management, volume mounting, and network bridging overhead without proportional benefit. The current approach (temp dirs + ephemeral Verdaccio) achieves isolation without containerization. Revisit if multiple maintainers need identical environments.

#### Option 4: Keep Acceptance Tests Post-Publish Only (No Release Qualification)

**Rejected**. This was the ADR-0020 position: acceptance tests validate real published artifacts, so they must run post-publish. While the rationale was sound for Layer 4 (production verification), it left a validation gap: 12 of 14 acceptance tests are not registry-specific and could run against Verdaccio pre-publish. The gap means functional bugs (missing dist/, broken init, failed patches) reach real npm before detection.

The adopted approach (Decision 9) adds Layer 3 (Release Qualification) to run these 12 tests pre-publish, while preserving Layer 4 post-publish for production confirmation. Layer 4's semantics change from "discovery" to "confirmation" — if Layer 3 passed but Layer 4 fails, it's a deployment issue, not a code bug.

#### Option 5: GitHub Actions CI

**Rejected** (consistent with ADR-0009 and ADR-0020). The build server is more powerful than GitHub Actions runners, the pipeline is linear (no parallelization benefit), and the systemd timer provides reliable scheduling. GitHub Actions would add cost and complexity without improving test quality.

#### Option 6: Property-Based Testing (fast-check)

**Deferred**. Property-based testing would be valuable for `computeVersion()` and codemod transforms (generating random version strings and package.json structures). However, the current input space is well-covered by explicit test cases. This can be added when edge cases emerge that explicit tests miss.

#### Option 7: Separate Verdaccio Instance for Release Qualification

**Rejected**. Running Layer 3 against a second Verdaccio instance would add setup time, port management, and complexity for zero benefit. Layer 3 reuses the same Verdaccio and install directory from Layer 2. The packages are already installed — Layer 3 just runs commands against them.

## Consequences

### Refinement (SPARC-R)

#### Positive Consequences

- **Formal sizing** — every test has a declared size with enforced constraints (time, network, I/O), preventing test bloat
- **Six layers** — environment validation, static analysis, and release qualification are now first-class test categories, not informal scripts or post-deploy discovery
- **Two-gate model** — clear separation between "safe to publish" (Gate 1, includes functional validation) and "safe to promote" (Gate 2) eliminates ambiguity about what test failures mean
- **Verdaccio-as-staging** — Verdaccio is the staging environment for both structural (Layer 2) and functional (Layer 3) validation. No package reaches real npm without proving it works
- **Release Qualification** — 12 functional smoke tests run pre-publish, catching broken deploys before they affect users. 23 seconds of testing to prevent deploying broken packages
- **Shared test library** — `lib/acceptance-checks.sh` eliminates duplication between Layer 3 and Layer 4. One test definition, two execution contexts. Adding a test auto-runs it in both layers
- **Failure semantics** — Layer 3 failure = code bug (fix before publish). Layer 4 failure after Layer 3 pass = deployment issue (investigate registry). Clear root-cause signal
- **Hermeticity requirements** — explicit rules prevent the test suite from developing shared state or host dependencies
- **Flaky test policy** — quarantine + skip threshold + fix deadline prevents test suite decay
- **Backward compatible** — all existing tests, scripts, and pipeline phases are preserved; Layer 3 is an addition within `test-integration.sh`, not a new script

#### Negative Consequences

- **Documentation overhead** — new tests must declare their size and layer, adding friction for contributors
- **Skip threshold** — the max-8-skipped enforcement may force premature removal of tests that are difficult to fix but still provide value
- **Verdaccio dependency** — Verdaccio is now architecturally required, not optional; if Verdaccio has breaking changes, the integration test pipeline breaks
- **Integration test duration** — increases from ~47s to ~70s due to Layer 3 functional smoke tests. Acceptable for the value delivered
- **Shared library coupling** — `lib/acceptance-checks.sh` must work in both Verdaccio and real npm contexts. Tests that depend on registry-specific behavior must be excluded and maintained separately in `test-acceptance.sh`

#### Risks

- Layer 4 production verification tests depend on npm CDN propagation timing (1-3 minutes). If Layer 4 runs too soon after publish, it may fail due to CDN lag rather than real defects. Mitigation: the pipeline already waits for publish confirmation before running Layer 4
- The 42-package topological publish to Verdaccio takes ~60s with rate limiting disabled. If the package count grows significantly (ADR-0022 adds more), the integration test may need parallelized publishing
- Layer 3 tests run against a Verdaccio install, not real npm. If npm has different module resolution behavior than Verdaccio, Layer 3 could pass while Layer 4 fails for non-deployment reasons. Mitigation: Verdaccio implements the npm registry API faithfully; this risk is theoretical

### Completion (SPARC-C)

**Acceptance criteria**:

- [x] All existing tests classified into Google Small/Medium/Large sizes
- [x] Six-layer pyramid documented with clear boundaries and Google phase mapping
- [x] Gate 1 (pre-publish, includes Release Qualification) and Gate 2 (post-publish) formally defined
- [x] Verdaccio lifecycle documented as staging environment (structural + functional validation)
- [x] Release Qualification layer (Layer 3) specified with 12 RQ tests
- [x] Shared test library (`lib/acceptance-checks.sh`) design documented
- [x] Failure semantics defined: Layer 3 fail = code bug, Layer 4 fail after L3 pass = deployment issue
- [x] Hermeticity requirements specified for all layers
- [x] Test doubles strategy documented
- [x] Flaky test policy with quarantine + skip threshold + fix deadline
- [x] Structured artifact schema defined for all layers (including `qualification-results.json`)
- [x] Anti-patterns cataloged (see `docs/testing.strategy.fixed.google.md`)
- [x] Considered options documented with rationale (7 options, including Option 4 reversal)
- [x] Cost analysis: +23s integration time, +1 file, 0 new infrastructure
- [ ] `lib/acceptance-checks.sh` implemented (shared test functions)
- [ ] `test-integration.sh` Phase 9 implemented (sources shared library)
- [ ] `test-acceptance.sh` refactored to source shared library
- [ ] `qualification-results.json` emitted by Phase 9

**Implementation plan**:

#### Step 1: Create Shared Test Library

Create `lib/acceptance-checks.sh` by extracting test functions from `scripts/test-acceptance.sh`:
- Extract functions for A1-A7, A9-A10, A13-A15 (the 12 registry-agnostic tests)
- Functions receive `$REGISTRY`, `$TEMP_DIR`, `$PKG` from the sourcing script
- Keep A8 (dist-tag) and A16 (plugin install) in `test-acceptance.sh` only

#### Step 2: Add Phase 9 to Integration Test

Update `scripts/test-integration.sh`:
- Renumber current Phase 9 (Cleanup) to Phase 10
- Add new Phase 9: Release Qualification
- Source `lib/acceptance-checks.sh`
- Run RQ-1 through RQ-12 against `$TEMP_INSTALL` with `$VERDACCIO_PORT`
- Emit `qualification-results.json` to results directory
- Hard fail: any RQ failure aborts pipeline

#### Step 3: Refactor Acceptance Test

Update `scripts/test-acceptance.sh`:
- Source `lib/acceptance-checks.sh` for shared tests
- Keep A8 and A16 as local-only functions
- Remove duplicated test function bodies (now in shared library)
- Preserve `--registry` flag behavior

#### Step 4: Mark ADR-0020 as Superseded

Update `docs/adr/0020-testing-strategy.md`:
- Change `Status` from `Accepted` to `Superseded by [ADR-0023](0023-google-testing-framework.md)`
- No other changes — ADR-0020's content is preserved as historical record

#### Step 5: Update `docs/testing.framework.md`

This is the operational testing reference. Update to reflect:

| Section | Current (stale) | Target |
|---------|----------------|--------|
| Architecture overview | 3-layer diagram | 6-layer pyramid with Google phases |
| Total checks | "90 unit + 9 integration + 10 acceptance = 109" | "93 unit + 8 build-verify + 12 RQ + 14 prod-verify = 127" |
| Layer table | 3 rows + 3 operational | 6 layers + 3 operational |
| Test sizing | Not mentioned | Google Small/Medium/Large per layer |
| Gate model | Not mentioned | Gate 1 (pre-publish, hard) + Gate 2 (post-publish, soft) |
| Hermeticity | Not mentioned | Requirements table from Decision 5 |
| Flaky test policy | Not mentioned | Quarantine + skip threshold + fix deadline |
| Acceptance test list | A1-A10 | A1-A16 (add A13-A16) |
| ADR reference | ADR-0020 | ADR-0023 (this ADR) |

#### Step 6: Update `CLAUDE.md` Testing Section

The project `CLAUDE.md` contains a "Testing — ALL 5 Test Types" section used as contributor guidance. Update to reflect:

- Reference ADR-0023 instead of (or in addition to) ADR-0020
- Update to 6-layer model with Release Qualification
- Add Google test size annotations (Small/Medium/Large) to the layer table
- Add the gate model to the "When to run what" table (distinguish Gate 1 vs Gate 2)

#### Step 7: Update Auto-Memory

Update `~/.claude/projects/.../memory/MEMORY.md` testing section:
- Replace ADR-0020 references with ADR-0023
- Add note that ADR-0020 is superseded
- Add 6-layer model summary and gate terminology

#### Step 8: Verify Consistency

After all updates, verify no stale references remain as authoritative:

```bash
grep -rn "ADR-0020" docs/ CLAUDE.md | grep -v "superseded\|historical\|0023"
```

Any remaining references should either be updated to ADR-0023 or annotated as historical.

#### Implementation Order

Steps 1-3 are sequential (shared library → integration phase → acceptance refactor). Steps 4-7 are independent and can be executed in parallel after Steps 1-3. Step 8 depends on all prior steps completing.

## Links

- [ADR-0020: Testing Strategy](0020-testing-strategy.md) — **superseded** by this ADR; all decisions preserved, Release Qualification and formal framework added
- [ADR-0009: systemd Timer](0009-systemd-timer-for-automated-builds.md) — CI mechanism validated by Layer -1
- [ADR-0010: Prerelease Publish Gate](0010-prerelease-publish-gate.md) — Gate 2 controls promotion to @latest
- [ADR-0012: Version Numbering](0012-version-numbering-scheme.md) — `computeVersion()` tested at Layer 1
- [ADR-0013: Codemod](0013-codemod-implementation.md) — tested at Layer 0 (codemod acceptance) and Layer 1 (unit)
- [ADR-0014: Topological Publish Order](0014-topological-publish-order.md) — tested at Layer 1 (unit) and Layer 2 (Verdaccio publish)
- [ADR-0015: First-Publish Bootstrap](0015-first-publish-bootstrap.md) — `getPublishTag()` tested at Layer 1
- [ADR-0022: Full Ecosystem Repackaging](0022-full-ecosystem-repackaging.md) — 42 packages covered by Layer 2 publish and Layer 3 functional validation
- [Google Testing Blog: Test Sizes](https://testing.googleblog.com/2010/12/test-sizes.html) — Small/Medium/Large definitions
- [Google SRE Book: Release Engineering](https://sre.google/sre-book/release-engineering/) — staging/production verification model
- [Companion: Testing Strategy Reference](../testing.strategy.fixed.google.md) — operational commands, configuration, and templates

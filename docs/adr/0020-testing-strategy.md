# ADR-0020: Testing Strategy

## Status

Accepted

## Context

### Specification (SPARC-S)

The ruflo-patch build pipeline spans 13 scripts, 3 config files, and 7 patch directories. The review report (O5) identified that no ADR specifies which tests to run, how to validate the pipeline end-to-end, or how to handle flaky upstream tests. Without a testing strategy, confidence in the pipeline depends on manual spot-checks, and regressions go undetected until a broken package is published.

The testing challenge has three distinct layers:

1. **Unit tests** -- Do individual components (codemod, version computation, publish ordering) behave correctly in isolation?
2. **Integration tests** -- Does the full pipeline (clone → codemod → patch → build → publish) produce working packages?
3. **Acceptance tests** -- Can a user actually `npx ruflo-patch init` and get a working environment?

Each layer requires different infrastructure. Unit tests need nothing external. Integration tests need upstream source code. Acceptance tests need published packages (or a local registry simulating npm).

### Pseudocode (SPARC-P)

```
TEST LAYERS:

LAYER 1 — Unit tests (npm test):
  tests/01-common-library.test.mjs      # patch() infrastructure
  tests/02-discovery.test.mjs           # install discovery
  tests/03-mc001-mcp-autostart.test.mjs # specific patch logic
  tests/04-codemod.test.mjs             # scope-rename transform
  tests/05-pipeline-logic.test.mjs      # version, state, detection
  tests/06-publish-order.test.mjs       # topological publish
  -> Run: node scripts/test-runner.mjs
  -> No external deps, fast (<2 min), run on every commit

LAYER 2 — Integration tests (scripts/test-integration.sh):
  REQUIRE: upstream clones exist at ~/src/upstream/*
  Step 1: Copy upstream source to temp dir
  Step 2: Run codemod, verify zero @claude-flow/ references remain
  Step 3: Apply patches, verify sentinels
  Step 4: pnpm install && pnpm build (verify TypeScript compiles)
  Step 5: Run upstream test suite (allow known failures)
  Step 6: Publish to local Verdaccio, verify all 26 packages resolve
  -> Run: bash scripts/test-integration.sh
  -> Requires upstream clones + pnpm, ~10 min

LAYER 3 — Acceptance tests (scripts/test-acceptance.sh):
  REQUIRE: packages published (Verdaccio or npm)
  Step 1: npx ruflo-patch@<registry> init (in clean temp dir)
  Step 2: Verify generated files exist (.claude/*, CLAUDE.md, etc.)
  Step 3: npx ruflo-patch@<registry> doctor --fix
  Step 4: Verify MCP config references @claude-flow-patch/*
  -> Run: bash scripts/test-acceptance.sh [--registry <url>]
  -> Requires published packages, ~2 min
```

## Decision

### Architecture (SPARC-A)

Adopt a 3-layer testing strategy. Each layer is independently runnable and builds on the previous layer's confidence.

**Layer 1: Unit Tests**

Already implemented. 78 tests across 6 test files covering:

| Test File | Count | What It Tests |
|-----------|-------|---------------|
| `01-common-library` | 10 | `patch()` / `patch_all()` idempotency, edge cases |
| `02-discovery` | 3 | npx cache and target directory discovery |
| `03-mc001-mcp-autostart` | 5 | MC-001 patch application and verification |
| `04-codemod` | 10 | All codemod transforms, ordering, idempotency, exclusions |
| `05-pipeline-logic` | 30 | Version computation, state parsing, change detection, first-publish detection |
| `06-publish-order` | 25 | Topological ordering, stop-on-failure, dry-run, level assignments |

**When to run**: On every commit. The build script (`sync-and-build.sh`) runs `npm test` as a gate before publishing. If any test fails, the build aborts and creates a GitHub issue.

**Failure handling**: Unit test failures are deterministic -- they indicate a real bug in our code. The build stops immediately.

**Layer 2: Integration Tests**

A single script (`scripts/test-integration.sh`) that validates the full build pipeline against real upstream code, publishing to a local Verdaccio registry instead of npm.

**Prerequisites**:
- Upstream clones at `~/src/upstream/{ruflo,agentic-flow,ruv-FANN}`
- `pnpm` >= 8 installed
- `verdaccio` installed globally (`npm i -g verdaccio`)

**Phases**:

| Phase | What | Validates |
|-------|------|-----------|
| 1. Setup | Start Verdaccio on a random port, create temp dir | Infrastructure |
| 2. Clone | Copy upstream source to temp dir (exclude `.git`) | Source availability |
| 3. Codemod | Run `node scripts/codemod.mjs $TEMP` | ADR-0013: zero `@claude-flow/` references remain (excluding `@claude-flow-patch`) |
| 4. Patch | Run `bash patch-all.sh --target $TEMP` | ADR-0017: semver patches apply, all sentinels present |
| 5. Build | `pnpm install && pnpm build` in temp dir | TypeScript compiles with renamed imports |
| 6. Upstream tests | `pnpm test` in temp dir (allow exit code != 0) | Upstream tests mostly pass; log failures for review |
| 7. Publish | `node scripts/publish.mjs --build-dir $TEMP --version test-0.0.1-patch.1 --registry http://localhost:$PORT` | ADR-0014: all 26 packages publish in topological order |
| 8. Install | `npm install ruflo-patch --registry http://localhost:$PORT` in a fresh temp dir | Full dependency tree resolves |
| 9. Cleanup | Kill Verdaccio, remove temp dirs | No leaked processes or disk |

**When to run**: Before first publish (Stage A validation). After major pipeline changes. Optionally on a weekly timer as a regression check.

**Failure handling for upstream tests (Phase 6)**:

Upstream tests may fail for reasons unrelated to our changes:
- Tests that depend on network access, API keys, or specific file paths
- Flaky tests with race conditions or timing dependencies
- Tests that reference `@claude-flow/` in assertions (the codemod transforms the code under test AND the assertion strings, so most assertions self-correct)

The integration test script captures upstream test output but does NOT fail on upstream test failures. Instead, it logs the failures and compares against a known-failures baseline file (`config/known-test-failures.txt`). New failures (not in baseline) are flagged with a warning. The maintainer decides whether to investigate, add to the baseline, or create a targeted patch.

**Layer 3: Acceptance Tests**

A script (`scripts/test-acceptance.sh`) that validates the end-user experience by running `ruflo-patch` commands against published packages (either local Verdaccio or real npm).

**Test cases**:

| # | Command | Validates |
|---|---------|-----------|
| A1 | `npx ruflo-patch --version` | Package resolves and executes |
| A2 | `npx ruflo-patch init` (in temp dir) | Init routine generates expected files |
| A3 | Verify `.claude/settings.json` exists | File generation works |
| A4 | Verify CLAUDE.md references `@claude-flow-patch` (not `@claude-flow`) | Codemod applied correctly to init templates |
| A5 | `npx ruflo-patch doctor --fix` | Doctor command runs without MODULE_NOT_FOUND errors |
| A6 | Verify MCP config in `.mcp.json` | ADR-0001 (MC-001): `autoStart: false` removed |

**When to run**: After first publish to npm. After each promotion to `@latest`. Can be run against Verdaccio output from Layer 2.

**The Verdaccio bridge**:

Verdaccio serves as the integration test backbone. It runs ephemerally (started and stopped by the test script) on a random port. No persistent state, no configuration files, no risk of polluting the real npm registry. The test creates a `.npmrc` in the temp directory pointing to the local Verdaccio instance.

```bash
# Start Verdaccio on random port
VERDACCIO_PORT=$(shuf -i 4873-4999 -n 1)
verdaccio --listen $VERDACCIO_PORT --config /dev/null &
VERDACCIO_PID=$!

# Create user (Verdaccio allows unauthenticated publish by default in test mode)
npm --registry http://localhost:$VERDACCIO_PORT adduser <<< "test\ntest\ntest@test.com"

# ... run tests ...

# Cleanup
kill $VERDACCIO_PID
```

**Test matrix for the build timer (CI validation)**:

The systemd timer cannot be unit-tested, but its behavior can be validated:

| Check | How | When |
|-------|-----|------|
| Timer is active | `systemctl is-active ruflo-sync.timer` | After `install-systemd.sh` |
| Timer fires on schedule | `systemctl list-timers ruflo-sync*` shows next run | After install |
| Service runs successfully | `systemctl status ruflo-sync.service` shows exit 0 | After first timer fire |
| No-change detection works | Run manually twice, second run exits early | After first successful build |
| State file updated | `cat scripts/.last-build-state` has current HEADs | After successful build |
| Failure creates issue | Introduce a deliberate patch failure, verify GitHub issue | One-time validation |
| Secret rotation works | Rotate npm token, verify next build publishes | Annual or on-demand |

These are documented as a manual checklist, not automated tests. Automating systemd timer behavior would require a VM or container, which is disproportionate to the value.

### Considered Alternatives

1. **Only unit tests, skip integration** -- Rejected. Unit tests verify individual components but cannot catch the class of bugs that emerge from component interaction: codemod output that doesn't compile, publish order that misses a new package, patches that conflict with codemod transforms. The 933-commit divergence from upstream makes integration testing essential -- we cannot predict what the codemod will encounter.

2. **Run upstream's full test suite as a gate** -- Rejected as a hard gate. Upstream tests were not designed for a renamed scope and may contain hardcoded paths, network calls, or flaky timing. Treating upstream test failures as build-blocking would cause frequent false-positive build failures. Instead, upstream tests run in advisory mode with a known-failures baseline.

3. **GitHub Actions for testing** -- Rejected for the same reasons as ADR-0009: costs money, our server is more powerful, and the pipeline is a single linear sequence. Integration tests run locally on the build server.

4. **Docker-based integration tests** -- Rejected as premature. Docker adds a layer of indirection (building images, managing volumes, networking Verdaccio) without proportional benefit. The test script uses temp directories and process management directly. If the test environment needs isolation in the future (multiple maintainers, different Node versions), Docker can be added.

5. **Snapshot testing (golden files)** -- Considered for the codemod. Would snapshot the codemod output of a known input and compare byte-for-byte on subsequent runs. Rejected because upstream changes frequently (933 commits ahead), making snapshots stale quickly. The grep-based verification (zero `@claude-flow/` references remaining) is more resilient to upstream changes.

6. **End-to-end tests against real npm** -- Rejected as a regular practice. Publishing test versions to real npm pollutes the version history and risks confusing users. Verdaccio provides an identical npm API locally. Real npm is only tested during the actual first publish (Stage B) and subsequent promotions.

### Cross-References

- ADR-0009: systemd timer (the CI mechanism being tested)
- ADR-0013: Codemod (Layer 1 tests in `04-codemod.test.mjs`, Layer 2 Phase 3)
- ADR-0014: Topological publish (Layer 1 tests in `06-publish-order.test.mjs`, Layer 2 Phase 7)
- ADR-0015: First-publish bootstrap (Layer 1 tests in `05-pipeline-logic.test.mjs`)
- ADR-0016: Dynamic import audit (`scripts/audit-dynamic-imports.sh` runs as part of Layer 2 Phase 3 verification)
- ADR-0017: Semver patches (Layer 2 Phase 4)

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Three layers provide defense in depth: fast unit tests catch logic bugs, integration tests catch interaction bugs, acceptance tests catch user-facing bugs
- Verdaccio enables full end-to-end testing without any risk to public npm
- Known-failures baseline prevents upstream test flakiness from blocking builds
- Each layer is independently runnable -- a developer can run `npm test` in seconds without needing upstream clones or Verdaccio
- The integration test script doubles as a validation tool for the first real publish -- run it once against Verdaccio, then against npm with the same confidence
- Unit tests run as a gate in the build pipeline, catching regressions before they reach npm

**Negative:**

- Integration tests require ~10 minutes and upstream clones (~2GB disk). Not suitable for rapid iteration during development
- Verdaccio must be installed separately (`npm i -g verdaccio`). One more prerequisite for the build server
- The known-failures baseline must be maintained as upstream evolves -- new test failures need triage (is it our fault or upstream's?)
- Acceptance tests depend on `ruflo-patch init` behavior, which is upstream code we don't control. If upstream changes the init flow, these tests break

**Edge cases:**

- If Verdaccio fails to start (port conflict, missing binary), the integration test script exits with a clear error and does not proceed to publish
- If upstream adds a new `@claude-flow/*` package that isn't in our codemod mapping, the integration test's grep check (zero `@claude-flow/` references) will catch it as a failure
- If upstream removes a package we list in `config/publish-levels.json`, the publish phase will fail to find the package directory. The integration test catches this before a real build does
- If the build server has insufficient disk space for temp directories (~4GB per integration test run), the test fails at the copy phase with a clear error

### Completion (SPARC-C)

Acceptance criteria:

- [ ] `npm test` runs all 78+ unit tests and exits 0
- [ ] `scripts/test-integration.sh` exists and runs the full 9-phase integration test
- [ ] Integration test uses Verdaccio (no real npm publish during testing)
- [ ] Integration test verifies zero `@claude-flow/` references after codemod (excluding `@claude-flow-patch`)
- [ ] Integration test verifies all 26 packages publish successfully to Verdaccio
- [ ] Integration test verifies `npm install ruflo-patch` resolves the full dependency tree from Verdaccio
- [ ] `scripts/test-acceptance.sh` exists and validates end-user commands
- [ ] `config/known-test-failures.txt` exists (may be empty initially)
- [ ] Upstream test failures are logged but do not block the integration test
- [ ] The build pipeline (`sync-and-build.sh`) runs `npm test` as a gate before publishing
- [ ] systemd timer validation checklist is documented in this ADR
- [ ] Integration test cleans up all temp directories and Verdaccio processes on exit (including on failure via trap)

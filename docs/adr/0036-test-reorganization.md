# ADR-0036: Complete CI/CD Pipeline and Test Scheme Design

## Status

Proposed (v4 -- supersedes v3 with full pipeline timing, test ID scheme, and migration plan)

## Date

2026-03-15

## Deciders

sparkling team, informed by structured hive-mind debate (5 CI/CD and testing experts, Round 3)

## Context

### v2 and v3 history

**v2 was rejected** by the product owner for conflating deploy and test into a single "verify" phase. Publishing to Verdaccio is a DEPLOY action, not a test.

**v3 fixed the pipeline shape** (6 phases, 3 action + 3 test) and correctly placed init tests as acceptance (post-deploy). However, v3 lacked:

1. Estimated durations per pipeline phase
2. A complete test ID naming scheme
3. Concrete file organization for adding new tests
4. Precise acceptance criteria defined for THIS project

### Current state

**Pipeline orchestrator**: `scripts/sync-and-build.sh` with two stages (Publish, Sync).

**Current pipeline as implemented today:**

```
sync-and-build.sh
  |
  +-- Publish stage:
  |     1. Detect merged PRs in forks              (~2s)
  |     2. Version bump (fork-version.mjs)          (~3s)
  |     3. Build (codemod + compile)                (~30s cold, ~5s cached)
  |     4. run_tests_ci():
  |        a. npm run preflight                     (~0.2s)
  |        b. node test-runner.mjs (16 files)       (~1.7s)
  |     5. run_verify() -> test-verify.sh:
  |        Phase 1: Verdaccio health check          (~0.1s)
  |        Phase 2: Selective cache clear           (~0.2s)
  |        Phase 3: Publish to Verdaccio            (~8s)
  |        Phase 4: Publish wrapper package         (~2s)
  |        Phase 5: NPX cache clear                 (~0.3s)
  |        Phase 6: Install packages into temp dir  (~12s)
  |        Phase 7: Structural checks (S-1..S-3)    (~3s)
  |        Phase 8: 25 acceptance checks            (~30s)
  |        Phase 9: Promote to @latest              (~5s)
  |        Phase 10: Write results                  (~0.1s)
  |
  +-- Sync stage:
        1. Fetch upstream                           (~5s)
        2. Create sync branch, merge                (~3s)
        3. Type-check, codemod, build               (~30s)
        4. run_tests() + run_verify()               (~50s)
        5. Create PR                                (~5s)
```

**Total pipeline time**: ~2.5 minutes (Publish stage only), ~5 minutes (both stages).

**Current test inventory**:

- 16 Node.js test files (415 `it()` calls), 1.7s runtime
- 25 bash acceptance checks (T01-T24, T32), ~30s runtime
- Shared check library (`lib/acceptance-checks.sh`)
- Preflight script (`scripts/preflight.mjs`)

### The five core questions

1. Where do init tests belong in the pipeline?
2. Is Verdaccio publish a "test" or a "deploy"?
3. What is the distinction between acceptance and E2E?
4. What is the test ID naming scheme?
5. What does "acceptance" mean precisely for this project?

---

## Hive-Mind Debate Transcript (Round 3)

### The Experts

1. **Expert 1 -- CI/CD Pipeline Architect** (AWS/GitHub Actions background)
2. **Expert 2 -- Test Strategist** (Google Testing background)
3. **Expert 3 -- Release Engineer** (npm/registry background)
4. **Expert 4 -- QA Lead** (acceptance criteria specialist)
5. **Expert 5 -- Developer Experience Lead** (developer workflow designer)

---

### Round 1: Individual Proposals

---

**EXPERT 1 (CI/CD Pipeline Architect) -- Pipeline Phase Design**

I am designing every phase of the pipeline end-to-end, with timing estimates based on the current implementation.

**The pipeline has 8 logical phases** (6 required, 2 optional):

```
Phase 1: source-detect     (2s)    Detect changes in fork repos
Phase 2: version-bump      (3s)    Calculate and apply version bumps
Phase 3: build             (30s)   Codemod scope rename + TypeScript compile
Phase 4: unit-test         (2s)    Preflight + pure logic tests
Phase 5: deploy-staging    (25s)   Publish to Verdaccio + install + structural gate
Phase 6: acceptance-test   (35s)   25 bash checks + 4 init test files
Phase 7: deploy-prod       (15s)   Promote Verdaccio @latest + npm publish  [optional]
Phase 8: smoke-test        (35s)   25 bash checks against real npm          [optional]
```

**Gating rules:**

| Phase | Gates | On failure |
|-------|-------|-----------|
| source-detect | version-bump | No changes detected, pipeline exits cleanly |
| version-bump | build | Version calculation broken. Fix fork-version.mjs |
| build | unit-test | Compile error. Fix TypeScript source in forks |
| unit-test | deploy-staging | Code logic is wrong. Fix the tests or the source |
| deploy-staging | acceptance-test | Packaging broken. Fix package.json, exports, deps |
| acceptance-test | deploy-prod | Deployed artifact does not work. Fix code or packaging |
| deploy-prod | smoke-test | npm publish failed. Check credentials, versions, network |
| smoke-test | dist-tag promote | Production artifact broken. Investigate npm-specific issue |

**Phase 3 (build) timing breakdown:**

| Sub-phase | Duration | What |
|-----------|----------|------|
| Copy fork sources to build dir | 2s | rsync from ~/src/forks/* |
| Codemod scope rename | 5s | @claude-flow/* -> @sparkleideas/* |
| TypeScript compile | 20s cold / 3s cached | tsc across 41 packages |
| Write build manifest | 0.1s | .build-manifest.json |

**Phase 5 (deploy-staging) timing breakdown:**

| Sub-phase | Duration | What |
|-----------|----------|------|
| Verdaccio health check | 0.1s | curl ping |
| Cache clear | 0.3s | Remove stale @sparkleideas/* from Verdaccio storage |
| Publish all packages | 8s | npm publish x41 packages via publish.mjs |
| Publish wrapper | 2s | npm publish @sparkleideas/ruflo |
| NPX cache clear | 0.3s | Remove stale _npx resolution trees |
| Install into temp dir | 12s | npm install @sparkleideas/{cli,agent-booster,plugins} |
| Structural gate (S-1..S-3) | 3s | Verify install integrity |

I want to call out that Phases 1-2 (source-detect, version-bump) only apply in the Publish stage. The Sync stage starts from a different entry point (fetch upstream). But the pipeline shape from Phase 3 onward is the same for both stages.

---

**EXPERT 2 (Test Strategist) -- Test Category Design**

I am defining every test category with zero ambiguity.

**Rule: The directory IS the category.** A developer classifying a new test needs exactly one decision: "Does this test need a deployed package to run?" If yes, it goes in `tests/acceptance/`. If no, it goes in `tests/unit/`.

**Category 1: Unit Tests**

- **Definition**: Tests that validate code logic using only in-process execution. No subprocess spawning, no network I/O, no registry access, no filesystem side effects outside /tmp.
- **Runtime target**: <2 seconds total for the entire suite.
- **Pipeline phase**: Phase 4 (unit-test)
- **What it gates**: deploy-staging. If unit tests fail, we do not deploy.
- **Command**: `npm test`
- **Location**: `tests/unit/`

The 12 unit test files:

| File | Tests | Speed | What |
|------|-------|-------|------|
| `codemod.test.mjs` | 16 | <50ms | Scope rename transform functions |
| `pipeline-logic.test.mjs` | 37 | <50ms | Pipeline orchestration decision logic |
| `publish-order.test.mjs` | 31 | <50ms | Topological sort of 41 packages |
| `fork-version.test.mjs` | 41 | <50ms | Version bump calculation |
| `agentdb-tools-wiring.test.mjs` | 57 | <100ms | AgentDB tool handler contracts (mocked) |
| `hooks-tools-wiring.test.mjs` | 49 | <100ms | Hooks tool handler contracts (mocked) |
| `memory-bridge-wiring.test.mjs` | 49 | <100ms | Memory bridge activation (mocked) |
| `memory-tools-wiring.test.mjs` | 23 | <100ms | Memory tool handler contracts (mocked) |
| `controller-registry.test.mjs` | 20 | <100ms | Controller registry activation (mocked) |
| `controller-chaos.test.mjs` | 27 | <50ms | Controller edge cases and fault injection (mocked) |
| `controller-properties.test.mjs` | 13 | <50ms | Controller property validation (mocked) |
| `context-synthesize.test.mjs` | 8 | <50ms | Context synthesis logic (mocked) |

**Subcategories within unit** (informational, not separate directories):

- **Pure logic** (4 files, 125 tests): Transform functions, version calculations, topological sort. Zero mocks needed.
- **Wiring contracts** (6 files, 226 tests): Mock-based tests that verify MCP tool handlers call the right methods with the right arguments. These test the WIRING, not the functionality.
- **Chaos/properties** (2 files, 40 tests): Edge cases, convergence, boundary conditions against mocked controllers.

**Category 2: Acceptance Tests**

- **Definition**: Tests that validate the deployed artifact works correctly by exercising it as an end user would. These tests require packages to be installed from a registry.
- **Runtime target**: <60 seconds total including deploy-staging setup.
- **Pipeline phase**: Phase 6 (acceptance-test)
- **What it gates**: deploy-prod. If acceptance tests fail, we do not publish to npm.
- **Command**: `npm run test:acceptance`
- **Location**: `tests/acceptance/` (Node.js files) + `lib/acceptance-checks.sh` (bash checks)

The acceptance test inventory:

- **4 Node.js init test files** (55 `it()` calls): Run `npx @sparkleideas/cli init` and validate output
- **25 bash acceptance checks** (T01-T25): Run CLI commands, import packages, exercise controllers

**Category 3: Smoke Tests**

- **Definition**: The same acceptance checks run against the production registry (npmjs.com) after deploy-prod.
- **Runtime target**: <60 seconds.
- **Pipeline phase**: Phase 8 (smoke-test)
- **What it gates**: dist-tag promotion to @latest on npm.
- **Command**: `npm run test:smoke`
- **Location**: Same `lib/acceptance-checks.sh` (different registry URL)

**Key clarification: Smoke and acceptance run the SAME checks.** The only difference is the registry URL. This is by design: one definition in `lib/acceptance-checks.sh`, two execution contexts.

---

**EXPERT 3 (Release Engineer) -- Deploy Phase Design**

I am designing the deploy phases and gates with npm-specific concerns.

**Deploy-staging (Phase 5):**

This phase mutates the Verdaccio registry. It is an ACTION, not a test. It answers: "Can we package and distribute these artifacts?"

Sub-steps:
1. Verdaccio health check (curl ping, fail-fast if registry is down)
2. Clear stale packages from Verdaccio storage (prevents version conflicts)
3. Publish all 41 packages via `publish.mjs` (topological order, 5 levels)
4. Publish wrapper package `@sparkleideas/ruflo`
5. Clear NPX resolution cache (prevent stale binary resolution)
6. Install `@sparkleideas/{cli,agent-booster,plugins}` into temp dir from Verdaccio
7. Structural gate:
   - S-1: `@sparkleideas/cli` exists in `node_modules/`
   - S-2: ADR-0022 packages resolve on Verdaccio (`npm view`)
   - S-3: `npm ls --all` shows no MISSING dependencies

The structural gate is part of deploy-staging, NOT part of acceptance. It answers "did the deploy succeed?" not "does the product work?"

**Deploy-prod (Phase 7):**

This phase mutates npmjs.com. It is gated by acceptance success.

Sub-steps:
1. Promote all packages to @latest on Verdaccio (bless staging)
2. `npm publish` all 41 packages to npmjs.com (topological order)
3. Verify publish succeeded (`npm view @sparkleideas/cli@latest version` against npm)

**Promote-staging is the FIRST step of deploy-prod.** Rationale: you only promote on Verdaccio when you are ready to publish to npm. If acceptance failed, staging stays un-promoted, which is the correct state -- you do not want @latest pointing to a broken version even on staging.

**Rollback strategy:**

- Verdaccio: `npm unpublish @sparkleideas/cli@<version> --registry http://localhost:4873`
- npm: Cannot unpublish after 72 hours. Use `npm deprecate` instead.
- The `scripts/rollback.sh` already handles this.

---

**EXPERT 4 (QA Lead) -- Acceptance Criteria Definition**

I am defining precisely what "acceptance" means for ruflo-patch.

**Acceptance is: "Can a developer install and use @sparkleideas packages from a registry?"**

This is NOT integration testing (component interaction), NOT end-to-end testing (user journey), NOT regression testing (did we break something). It is acceptance testing: does the delivered product meet the acceptance criteria?

**The acceptance criteria for ruflo-patch are:**

1. **Installable**: Packages install from the registry without errors (T01-T03, S-1..S-3)
2. **Initializable**: `@sparkleideas/cli init` creates a valid project scaffold (T04-T08, init-*.test.mjs)
3. **Diagnosable**: `doctor` and wrapper proxy work (T09-T10)
4. **Functional subsystems**: Memory, neural, agent-booster, plugins all work (T11-T16)
5. **Controller activation**: All 28 controllers activate and respond correctly (T17-T25)

**On the init test debate:**

The init tests (files 16-19) are acceptance tests, not unit tests. Here is the evidence:

1. They run `npx @sparkleideas/cli init` which spawns a subprocess
2. That subprocess resolves `@sparkleideas/cli` from a registry
3. They install transitive dependencies (including `better-sqlite3` native compile)
4. They take ~12 seconds (vs <2s for all unit tests combined)
5. They fail if no packages are published to any registry

These tests answer the acceptance question: "Does the installed CLI produce correct output?" They do NOT answer the unit question: "Does the generator function return correct data structures?"

If someone wants unit-level init tests, they should write NEW tests that import the generator functions directly and test them in-process. That is future work, out of scope for this ADR.

**On the acceptance vs E2E distinction:**

In this project, there is no meaningful distinction. Our "E2E" test (T32, now T25) runs `init --full` on a fresh project and exercises 5 controllers. That IS acceptance testing -- it tests the product as delivered. Calling it "E2E" implies it tests a larger system with multiple services, which is not the case. Relabel T32/T25 as acceptance, group "e2e".

**On whether Verdaccio publish is a test or deploy:**

It is unambiguously a deploy. It mutates registry state. If you run it twice with the same version, the second run fails with "409 Conflict." Tests are idempotent; deploys are not.

---

**EXPERT 5 (Developer Experience Lead) -- Commands and Workflow**

I am designing the commands developers actually type.

**Core principle:** Developers should not need to know the pipeline architecture. They type one command and get the right behavior.

**Developer commands:**

| Command | What happens | When to use | Duration |
|---------|-------------|-------------|----------|
| `npm test` | Preflight + 12 unit test files | After every code change | <2s |
| `npm run test:unit` | Alias for `npm test` | Explicit name for CI scripts | <2s |
| `npm run test:acceptance` | Deploy to Verdaccio + install + 25 checks + 4 init files | Before deploying to npm | ~60s |
| `npm run test:smoke` | 25 checks against real npm | After deploying to npm | ~35s |
| `npm run test:all` | unit + build + acceptance | Full pre-prod gate | ~90s |
| `npm run build` | Codemod + compile | After changing fork source | ~30s |
| `npm run deploy` | Full pipeline (detect + version + build + test + publish) | Automated via systemd | ~2.5min |
| `npm run deploy:dry-run` | Full pipeline, stop before publish | Manual validation | ~2min |

**Design decisions:**

1. `npm test` = unit only. This is the inner loop. It MUST be under 2 seconds.
2. `test:acceptance` handles deploy-staging internally. Developers should not manually publish to Verdaccio.
3. `test:smoke` expects packages already on npm. It does not deploy.
4. `test:verify` is REMOVED. That name conflated deploy and test.
5. `test:live` is REMOVED. Replaced by `test:smoke`.
6. `test:unit` is kept as an explicit alias for CI readability.

**Script mapping:**

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:unit": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:acceptance": "bash scripts/test-acceptance.sh",
  "test:smoke": "bash scripts/test-smoke.sh --registry https://registry.npmjs.org",
  "test:all": "npm test && npm run build && npm run test:acceptance",
  "preflight": "node scripts/preflight.mjs",
  "build": "bash scripts/build.sh",
  "deploy": "bash scripts/sync-and-build.sh",
  "deploy:dry-run": "bash scripts/sync-and-build.sh --test-only"
}
```

---

### Round 2: Expert Debate

---

**EXPERT 1 (Pipeline) attacks EXPERT 5 (DX) on `test:acceptance` hiding deploy:**

You said `test:acceptance` handles deploy-staging internally. But that means a developer running `npm run test:acceptance` is DEPLOYING as a side effect of running TESTS. If they run it twice, the second run may behave differently (stale Verdaccio cache, version conflicts). This violates the principle that tests should be repeatable.

**EXPERT 5 (DX) responds:**

The alternative is worse. If the developer has to manually run `deploy-staging` before `test:acceptance`, they will forget. They will run acceptance against stale packages. They will get false passes. The convenience of "one command" outweighs the theoretical purity of separating deploy and test at the command level.

The script itself separates them internally: `deploy_to_staging()` then `run_acceptance_checks()`. If deploy fails, it exits before running tests. If you run it twice, it clears Verdaccio first (cache clear in sub-phase 2), so it IS repeatable. The stale cache concern is already handled.

**EXPERT 3 (Release) supports Expert 5:**

Correct. The Verdaccio cache clear (rm -rf `@sparkleideas` from storage) ensures clean state on every run. The script is idempotent from the user's perspective.

**EXPERT 1 (Pipeline) concedes:**

Fair. The internal separation is what matters for the pipeline orchestrator. The developer-facing command can bundle them.

---

**EXPERT 4 (QA) attacks EXPERT 2 (Test Strategy) on the unit/acceptance binary:**

You said "Does this test need a deployed package to run? Yes = acceptance. No = unit." But what about tests that need the BUILD artifact but not a deployed package? For example, someone might want to test the built JavaScript by importing it directly from `/tmp/ruflo-build/` without publishing to Verdaccio. That is neither unit (needs build) nor acceptance (no deploy). Where does it go?

**EXPERT 2 (Test Strategy) responds:**

In practice, we do not have any such tests today. If someone writes one, it goes in `tests/unit/` because it does not need a registry. The relevant question is "does it need a REGISTRY?" not "does it need a BUILD?" All tests technically need the test file to exist on disk, which is a build artifact. The registry boundary is the meaningful distinction.

**EXPERT 3 (Release) adds:**

There is a third option that nobody has mentioned: contract tests. The wiring tests (agentdb-tools, hooks-tools, etc.) test that tool handlers conform to a contract. They use mocks, so they are technically unit tests. But they are testing WIRING, not LOGIC. Shouldn't they have their own category?

**EXPERT 2 (Test Strategy) responds:**

No. Adding a third category creates ambiguity. "Is my test a unit test or a contract test?" A developer should not have to answer that question. The directory IS the category. Two directories. Two categories. Zero ambiguity.

The wiring tests are a subcategory of unit -- informational only, reflected in file naming (`*-wiring.test.mjs`), not in directory structure.

**ALL EXPERTS agree: Two categories. Two directories. The directory is the category.**

---

**EXPERT 2 (Test Strategy) attacks EXPERT 4 (QA) on "acceptance vs E2E":**

You said there is no meaningful distinction between acceptance and E2E in this project. I disagree. T25 (formerly T32, `check_full_controller_activation`) runs `init --full` and then exercises 5 controllers in sequence. That IS an end-to-end test: it tests a complete user workflow from project creation through controller usage. The other acceptance tests exercise individual features in isolation.

**EXPERT 4 (QA) responds:**

The distinction is real but does not warrant a separate category. T25 is an acceptance test with broader scope. Calling it "E2E" implies a separate pipeline phase, a separate directory, a separate runner. We do not need any of that. T25 runs in the same acceptance phase, at the same time, with the same runner. It just happens to exercise more of the system.

In the check groups, T25 is in group "e2e" -- that is a GROUP within acceptance, not a separate CATEGORY. Groups are for parallelization strategy (T25 runs sequentially after all parallel groups). Categories are for pipeline placement.

**EXPERT 1 (Pipeline) supports Expert 4:**

Agreed. E2E is a group label, not a category. The pipeline has three test phases (unit, acceptance, smoke). Adding a fourth (E2E) complicates the gating model for one test.

**ALL EXPERTS agree: T25 stays in acceptance, labeled as group "e2e".**

---

**EXPERT 3 (Release) raises the versioning question:**

Phase 2 (version-bump) runs BEFORE Phase 4 (unit-test). That means we bump the version before we know the code is correct. If unit tests fail, we have a bumped version that never gets published. Is that a problem?

**EXPERT 1 (Pipeline) responds:**

No. The version bump is committed to the fork repos, not to npm. If unit tests fail, the pipeline aborts. The bumped version sits in the fork repos until the next pipeline run, which will detect "no new changes" (same HEAD) and skip. The version is never published, so there is no gap in version history on npm. On Verdaccio, stale versions are cleared on every run.

However, this means the version bump commit gets pushed to the fork even when tests fail. That is the current behavior and it works fine -- the next successful run will use the next patch number.

**EXPERT 5 (DX) notes:**

The `--test-only` flag (deploy:dry-run) skips publish but still bumps versions. Should it? If I am just validating, I do not want to consume a version number.

**EXPERT 1 (Pipeline) responds:**

`--test-only` currently stops after the verify phase. It does NOT skip version bump. That is a bug in the existing pipeline, but out of scope for this ADR. File it separately.

**ALL EXPERTS agree to document this as a known issue, not fix it in this ADR.**

---

**EXPERT 5 (DX) attacks EXPERT 2 (Test Strategy) on the test ID scheme:**

You have not proposed a test ID scheme. The current codebase has three different ID styles:
- Node.js tests: `it('transforms name, dependencies...')` (descriptive, no ID)
- Node.js tests: `it('S-01: stores context with proper CRDT flags')` (S-prefixed ID)
- Bash checks: `T01`, `T02`, ..., `T24`, `T32` (gap at T25-T31)

How do we unify these? How do we add new tests without renumbering?

**EXPERT 2 (Test Strategy) proposes:**

**Test ID Scheme: `{category}{group}-{seq}`**

Categories:
- `U` = unit test
- `A` = acceptance test (bash checks)
- `I` = acceptance test (init files, Node.js)

Groups (within acceptance bash checks):
- `S` = smoke (version, dist-tag)
- `N` = init (project scaffolding)
- `D` = diagnostics (doctor, wrapper)
- `M` = data/ML (memory, neural)
- `P` = packages (agent-booster, plugins)
- `C` = controllers (ADR-0033)
- `E` = end-to-end (full activation)

Examples:
- `AS-01` = Acceptance, Smoke group, check 1 (version check)
- `AN-04` = Acceptance, Init group, check 4 (init)
- `AC-17` = Acceptance, Controller group, check 17 (controller health)
- `AE-25` = Acceptance, E2E group, check 25 (full activation)
- `I-01` = Init acceptance (Node.js), test 1

For unit tests, the file name IS the identifier. Individual `it()` calls do not need IDs because:
1. The test runner reports them by description
2. They are not referenced anywhere else
3. Adding IDs to 371 `it()` calls is pointless churn

**EXPERT 4 (QA) objects:**

That is too many prefixes. `AS-01` requires the developer to know the group code. Just use `T{nn}` for bash checks and leave unit tests with no IDs. The T-prefix is already established. Close the T25-T31 gap by renumbering T32 to T25. For future tests, append T26, T27, etc.

**EXPERT 3 (Release) supports Expert 4:**

Agreed. The T-numbering works. Everyone already knows T01 is the version check. Do not rename it. Just close the gap.

**EXPERT 2 (Test Strategy) concedes:**

Fine. Keep `T{nn}` for bash checks. No IDs for unit test `it()` calls. Close the T32->T25 gap. New bash checks get the next available number. New unit tests get a descriptive file name.

**EXPERT 5 (DX) asks:**

What about the init Node.js files? They run in the acceptance phase but they are Node.js tests with `it()` calls, not bash checks. Do their `it()` calls get IDs?

**ALL EXPERTS agree:** No. The init Node.js files use descriptive `it()` names like the unit tests. Only bash checks get T-IDs because they are referenced in pipeline output and result JSON files.

---

**EXPERT 1 (Pipeline) raises timing concerns:**

The init tests (files 16-19) take ~12 seconds. If we move them to the acceptance phase, they run AFTER deploy-staging (25s) instead of during unit tests (current). That adds 12s to the critical path because they cannot overlap with bash checks (they need the installed package).

Actually, wait. They CAN overlap with bash checks. Both need the installed package from Verdaccio. The init Node.js tests run `npx` which resolves from Verdaccio. The bash checks run CLI commands from the installed temp dir. If we run them in parallel:

```
deploy-staging (25s)
  |
  +-- parallel: init Node.js tests (12s) + bash checks T01-T24 (30s)
  |
  +-- sequential: T25 (full activation, 5s)
```

Total acceptance: max(12, 30) + 5 = 35s. Same as today. No regression.

**EXPERT 5 (DX) confirms:**

The current test-verify.sh already runs checks in parallel groups. The init Node.js tests can be a parallel group alongside the bash checks.

**ALL EXPERTS agree on the parallel execution model.**

---

### Round 3: Consensus Building

---

**EXPERT 1 (Pipeline) synthesizes the final pipeline:**

```
Phase 1: source-detect     ACTION   (~2s)   Detect changes in fork repos
Phase 2: version-bump      ACTION   (~3s)   Calculate and apply version bumps
Phase 3: build             ACTION   (~30s)  Codemod scope rename + TypeScript compile
Phase 4: unit-test         TEST     (~2s)   Preflight + 12 unit test files
    GATE: code is correct
Phase 5: deploy-staging    ACTION   (~25s)  Publish to Verdaccio + install + structural gate
    GATE: staging deploy healthy
Phase 6: acceptance-test   TEST     (~35s)  25 bash checks + 4 init files (parallel)
    GATE: deployed artifact works
Phase 7: deploy-prod       ACTION   (~15s)  Promote Verdaccio + npm publish  [optional]
    GATE: production deploy succeeded
Phase 8: smoke-test        TEST     (~35s)  25 bash checks against npm      [optional]
    GATE: production artifact works

Total (Phases 1-6): ~97s (~1.6 min)
Total (Phases 1-8): ~147s (~2.5 min)
```

**EXPERT 2 (Test Strategy) confirms test categories:**

Two categories. Two directories. Zero ambiguity.

| Category | Definition | Location | Command | Phase |
|----------|-----------|----------|---------|-------|
| **Unit** | Tests that validate code logic using only in-process execution. No subprocess, no network, no registry. | `tests/unit/` | `npm test` | Phase 4 |
| **Acceptance** | Tests that validate the deployed artifact works correctly by exercising it as an end user would. Requires packages installed from a registry. | `tests/acceptance/` (Node.js) + `lib/acceptance-checks.sh` (bash) | `npm run test:acceptance` | Phase 6 |

Smoke tests are NOT a separate category. They are acceptance tests run against a different registry.

**EXPERT 3 (Release) confirms deploy phases:**

| Phase | Sub-steps | Duration | Failure |
|-------|-----------|----------|---------|
| deploy-staging | health check, cache clear, publish 41 pkgs, publish wrapper, npx clear, install, structural gate | 25s | Packaging broken |
| deploy-prod | promote Verdaccio @latest, npm publish 41 pkgs, verify | 15s | Credentials/network |

**EXPERT 4 (QA) confirms acceptance criteria:**

Acceptance for ruflo-patch means: "A developer can install @sparkleideas packages from a registry and use them to initialize a project, run diagnostics, use memory/neural features, and activate all controllers."

The 5 acceptance criteria:
1. Installable (T01-T03, S-1..S-3)
2. Initializable (T04-T08, init-*.test.mjs)
3. Diagnosable (T09-T10)
4. Functional (T11-T16)
5. Controllers work (T17-T25)

**EXPERT 5 (DX) confirms commands:**

| Command | Phase(s) | Duration | When |
|---------|----------|----------|------|
| `npm test` | unit | <2s | After every code change |
| `npm run test:acceptance` | deploy-staging + acceptance | ~60s | Before deploying to npm |
| `npm run test:smoke` | smoke | ~35s | After deploying to npm |
| `npm run test:all` | unit + build + deploy-staging + acceptance | ~90s | Full pre-prod gate |

**ALL EXPERTS confirm final consensus.**

---

## Decision

### A. The CI/CD Pipeline

#### Pipeline Diagram

```
  fork code change
       |
  +-----------------+
  | 1. source-detect |  ACTION: detect changes in fork repos
  |     (~2s)        |  Gates: version-bump
  +-----------------+
       |
  +-----------------+
  | 2. version-bump  |  ACTION: calculate + apply version bumps
  |     (~3s)        |  Gates: build
  +-----------------+
       |
  +-----------------+
  | 3. build         |  ACTION: codemod scope rename + tsc compile
  |     (~30s cold)  |  Gates: unit-test
  |     (~5s cached) |
  +-----------------+
       |
  +-----------------+
  | 4. unit-test     |  TEST: preflight + 12 pure-logic test files
  |     (~2s)        |  Gates: deploy-staging
  +-----------------+
       |
   GATE: code is correct
       |
  +-----------------+
  | 5. deploy-staging|  ACTION: publish to Verdaccio, install into
  |     (~25s)       |  temp project, structural checks (S-1..S-3)
  +-----------------+
       |
   GATE: staging deploy healthy
       |
  +-----------------+
  | 6. acceptance    |  TEST: 25 bash checks (T01-T25) + 4 init
  |     (~35s)       |  test files, run against Verdaccio packages
  +-----------------+
       |
   GATE: deployed artifact works
       |
  +-----------------+
  | 7. deploy-prod   |  ACTION: promote Verdaccio @latest, npm
  |     (~15s)       |  publish to npmjs.com        [OPTIONAL]
  +-----------------+
       |
   GATE: production deploy succeeded
       |
  +-----------------+
  | 8. smoke         |  TEST: 25 bash checks against real npm
  |     (~35s)       |                              [OPTIONAL]
  +-----------------+
       |
   GATE: production artifact works
       |
  +-----------------+
  | npm dist-tag     |  ACTION: promote @latest on npmjs.com
  |   @latest        |
  +-----------------+
```

#### Phase Definitions

| # | Phase | Type | Duration | Script/Function | What it does | What it gates |
|---|-------|------|----------|----------------|-------------|--------------|
| 1 | source-detect | ACTION | ~2s | `check_merged_prs()` in sync-and-build.sh | Compare fork HEAD SHAs against last-build-state | version-bump (skip if no changes) |
| 2 | version-bump | ACTION | ~3s | `bump_fork_versions()` -> `fork-version.mjs` | Calculate `{upstream-tag}-patch.N` versions for changed packages | build |
| 3 | build | ACTION | ~30s cold, ~5s cached | `run_build()` -> codemod.mjs + tsc | Copy fork sources, rename @claude-flow/* to @sparkleideas/*, compile TypeScript | unit-test |
| 4 | unit-test | TEST | ~2s | `npm test` -> preflight.mjs + test-runner.mjs --dir tests/unit | Run preflight checks + 12 unit test files (371 assertions) | deploy-staging |
| 5 | deploy-staging | ACTION | ~25s | `deploy_to_staging()` -> deploy-staging.sh | Publish 41 packages to Verdaccio, install into temp dir, run structural gate (S-1..S-3) | acceptance |
| 6 | acceptance | TEST | ~35s | `run_acceptance()` -> test-acceptance.sh | Run T01-T25 bash checks + 4 init Node.js test files against Verdaccio-installed packages | deploy-prod |
| 7 | deploy-prod | ACTION | ~15s | `deploy_to_prod()` -> deploy-prod.sh | Promote Verdaccio @latest, npm publish all packages | smoke |
| 8 | smoke | TEST | ~35s | `npm run test:smoke` -> test-smoke.sh | Run T01-T25 bash checks against packages from real npm | dist-tag promote |

#### Failure Semantics

| Phase fails | What it means | What to fix |
|-------------|--------------|-------------|
| source-detect | No changes. Pipeline exits cleanly. | Nothing -- this is normal. |
| version-bump | Version calculation logic broken. | Fix `scripts/fork-version.mjs`. |
| build | TypeScript compile error or codemod bug. | Fix TypeScript source in forks or `scripts/codemod.mjs`. |
| unit-test | Code logic is wrong. | Fix the source code or the test. |
| deploy-staging | Packaging is broken. | Fix `package.json`, exports map, dependency declarations. |
| acceptance | Deployed artifact does not work. | Fix the code, the packaging, or the init generators. |
| deploy-prod | npm publish failed. | Check npm credentials, version conflicts, network. |
| smoke | Production artifact is broken. | Investigate npm-specific issues (scope, tarball, cdn cache). |

### B. The Test Scheme

#### Test Categories

| Category | Definition (one sentence, no ambiguity) | Location | When it runs | What it gates | Command |
|----------|----------------------------------------|----------|-------------|--------------|---------|
| **Unit** | Tests that validate code logic using only in-process execution, with no subprocess, no network, and no registry access. | `tests/unit/*.test.mjs` | Phase 4 (unit-test) | deploy-staging | `npm test` |
| **Acceptance** | Tests that validate the deployed artifact works correctly by exercising installed packages from a registry. | `tests/acceptance/*.test.mjs` + `lib/acceptance-checks.sh` | Phase 6 (acceptance) | deploy-prod | `npm run test:acceptance` |
| **Smoke** | The same acceptance checks run against the production registry after deploy-prod. | Same `lib/acceptance-checks.sh` | Phase 8 (smoke) | dist-tag promote | `npm run test:smoke` |

**Classification rule**: Does the test need a deployed package on a registry? Yes = acceptance. No = unit. Smoke is not a separate category; it is acceptance against a different registry.

#### Unit Test Inventory (12 files, 371 tests, <2s)

| File | Subcategory | Tests | What it validates |
|------|------------|-------|------------------|
| `codemod.test.mjs` | pure-logic | 16 | Scope rename transform functions |
| `pipeline-logic.test.mjs` | pure-logic | 37 | Pipeline orchestration decision logic |
| `publish-order.test.mjs` | pure-logic | 31 | Topological sort for 41 packages |
| `fork-version.test.mjs` | pure-logic | 41 | Version bump calculations |
| `agentdb-tools-wiring.test.mjs` | wiring | 57 | AgentDB tool handler contracts (mocked) |
| `hooks-tools-wiring.test.mjs` | wiring | 49 | Hooks tool handler contracts (mocked) |
| `memory-bridge-wiring.test.mjs` | wiring | 49 | Memory bridge activation (mocked) |
| `memory-tools-wiring.test.mjs` | wiring | 23 | Memory tool handler contracts (mocked) |
| `controller-registry.test.mjs` | wiring | 20 | Controller registry activation (mocked) |
| `controller-chaos.test.mjs` | chaos | 27 | Controller edge cases and fault injection |
| `controller-properties.test.mjs` | chaos | 13 | Controller property/boundary validation |
| `context-synthesize.test.mjs` | wiring | 8 | Context synthesis logic (mocked) |

Subcategories are informational (reflected in file naming, not directory structure):
- **pure-logic** (4 files, 125 tests): Zero mocks, pure function input/output
- **wiring** (6 files, 206 tests): Mock-based handler contract verification
- **chaos** (2 files, 40 tests): Edge cases, boundary conditions, fault injection

#### Acceptance Test Inventory -- Bash Checks (25 checks, ~30s)

| ID | Function | Group | What it validates |
|----|----------|-------|------------------|
| T01 | `check_version` | smoke | CLI version command returns valid semver |
| T02 | `check_latest_resolves` | smoke | @latest dist-tag resolves to a version |
| T03 | `check_no_broken_versions` | smoke | @latest version has bin entries |
| T04 | `check_init` | init | `cli init` exits 0 |
| T05 | `check_settings_file` | init | init produces `.claude/settings.json` |
| T06 | `check_scope` | init | CLAUDE.md contains @sparkleideas references |
| T07 | `check_mcp_config` | init | .mcp.json generated without autoStart:false |
| T08 | `check_ruflo_init_full` | init | `init --full` produces complete scaffold |
| T09 | `check_doctor` | diagnostics | `doctor --fix` runs without MODULE_NOT_FOUND |
| T10 | `check_wrapper_proxy` | diagnostics | Wrapper proxy forwards commands |
| T11 | `check_memory_lifecycle` | data | Memory init/store/search/retrieve cycle |
| T12 | `check_neural_training` | data | Neural training produces patterns.json |
| T13 | `check_agent_booster_esm` | packages | agent-booster ESM import resolves |
| T14 | `check_agent_booster_bin` | packages | agent-booster CLI binary returns version |
| T15 | `check_plugins_sdk` | packages | plugins SDK ESM import resolves |
| T16 | `check_plugin_install` | packages | Plugin install flow completes |
| T17 | `check_controller_health` | controllers | Controller health endpoint responds |
| T18 | `check_hooks_route` | controllers | Hook routing dispatches correctly |
| T19 | `check_memory_scoping` | controllers | Memory namespace scoping works |
| T20 | `check_reflexion_lifecycle` | controllers | Reflexion store/recall cycle works |
| T21 | `check_causal_graph` | controllers | Causal graph edges are recorded |
| T22 | `check_cow_branching` | controllers | Copy-on-write branching works |
| T23 | `check_batch_operations` | controllers | Batch API processes multiple operations |
| T24 | `check_context_synthesis` | controllers | Context synthesis produces output |
| T25 | `check_full_controller_activation` | e2e | Init --full + exercise 5 controllers |

#### Acceptance Test Inventory -- Init Node.js (4 files, 55 tests, ~12s)

| File | Tests | What it validates |
|------|-------|------------------|
| `init-structural.test.mjs` | 17 | `npx @sparkleideas/cli init` produces correct file structure |
| `init-helpers.test.mjs` | 14 | Init helper utilities work on installed package |
| `init-cross-mode.test.mjs` | 9 | Init works across modes (v3, wizard, etc.) |
| `init-patch-regression.test.mjs` | 15 | Patched init behaviors survive packaging |

#### Structural Checks (deploy health, part of Phase 5)

These are NOT tests. They verify the deploy succeeded:

| ID | What | Part of |
|----|------|---------|
| S-1 | `@sparkleideas/cli` exists in `node_modules/` | deploy-staging |
| S-2 | ADR-0022 packages available on Verdaccio | deploy-staging |
| S-3 | `npm ls --all` shows no MISSING deps | deploy-staging |

#### Acceptance Check Execution Groups (parallelization)

```
Group 1: Smoke (parallel)           T01, T02, T03
Group 2: Init (T04 sequential, then T05-T07 parallel)
Group 3-5: Overlapped parallel      T08-T16
Group 6: Controllers (parallel)     T17-T24
Group 7: E2E (sequential)          T25
Group 8: Init Node.js (parallel)    init-*.test.mjs x4    [NEW: parallel with groups 3-7]
```

### C. The Test ID Scheme

#### Bash Acceptance Checks: `T{nn}`

- Format: `T` followed by two-digit zero-padded number
- Current range: T01-T25 (T32 renumbered to T25)
- New checks: append T26, T27, T28, etc.
- Never renumber existing checks (breaks result history)
- Each check has a group label for parallelization (smoke, init, diagnostics, data, packages, controllers, e2e)

#### Node.js Tests: No IDs

- Unit test `it()` calls use descriptive names: `it('transforms name, dependencies, peerDependencies...')`
- Init acceptance `it()` calls use descriptive names: `it('creates settings.json with correct scope')`
- The file name is the identifier. The test runner reports by file and description.
- No S-, H-, X-, R- prefixes. Those are removed.
- Reason: IDs on 426 `it()` calls add no value. Nobody references individual assertions by ID. The file + description is sufficient for debugging failures.

#### Adding New Tests

| Test type | How to add |
|-----------|-----------|
| New unit test file | Create `tests/unit/{name}.test.mjs`. Use descriptive kebab-case name. No numeric prefix. |
| New `it()` in existing unit file | Add to the appropriate `describe` block with a descriptive name. |
| New bash acceptance check | Add `check_{name}()` in `lib/acceptance-checks.sh`. Assign the next `T{nn}` ID. Register in test-acceptance.sh with a group. |
| New init acceptance test file | Create `tests/acceptance/init-{name}.test.mjs`. |
| New `it()` in existing init file | Add to the appropriate `describe` block with a descriptive name. |

### D. File Organization

#### Directory Structure

```
tests/
  unit/                                  # Pure logic, no I/O (<2s total)
    codemod.test.mjs                       (16 tests)
    pipeline-logic.test.mjs                (37 tests)
    publish-order.test.mjs                 (31 tests)
    fork-version.test.mjs                  (41 tests)
    agentdb-tools-wiring.test.mjs          (57 tests)
    hooks-tools-wiring.test.mjs            (49 tests)
    memory-bridge-wiring.test.mjs          (49 tests)
    memory-tools-wiring.test.mjs           (23 tests)
    controller-registry.test.mjs           (20 tests)
    controller-chaos.test.mjs              (27 tests)
    controller-properties.test.mjs         (13 tests)
    context-synthesize.test.mjs            (8 tests)
  acceptance/                            # Post-deploy, needs Verdaccio
    init-structural.test.mjs               (17 tests)
    init-helpers.test.mjs                  (14 tests)
    init-cross-mode.test.mjs               (9 tests)
    init-patch-regression.test.mjs         (15 tests)
  fixtures/                              # Shared test data (unchanged)
    init-fixture.mjs
  helpers/                               # Shared test utilities (unchanged)
    fixture-factory.mjs
    pipeline-helpers.mjs

lib/
  acceptance-checks.sh                   # 25 bash check functions (T01-T25)
  test-harness.sh                        # Extracted: run_check, run_check_bg, collect_parallel

scripts/
  test-runner.mjs                        # Updated: --dir support, recursive scan
  test-acceptance.sh                     # REWRITTEN: deploy-staging + acceptance
  test-smoke.sh                          # RENAMED from old test-acceptance.sh
  preflight.mjs                          # Unchanged
  deploy-staging.sh                      # NEW: extracted from test-verify.sh phases 1-7
  deploy-prod.sh                         # NEW: promote Verdaccio + npm publish
  sync-and-build.sh                      # Updated: separated deploy/test functions
```

#### File Naming Conventions

| Convention | Example |
|-----------|---------|
| No numeric prefixes | `codemod.test.mjs`, not `04-codemod.test.mjs` |
| Kebab-case descriptive names | `agentdb-tools-wiring.test.mjs` |
| `-wiring` suffix for mock-based contract tests | `hooks-tools-wiring.test.mjs` |
| `init-` prefix for init scaffolding acceptance tests | `init-structural.test.mjs` |
| `.test.mjs` extension for all Node.js tests | (unchanged) |

#### Migration Map (git mv)

| Current path | New path |
|-------------|----------|
| `tests/04-codemod.test.mjs` | `tests/unit/codemod.test.mjs` |
| `tests/05-pipeline-logic.test.mjs` | `tests/unit/pipeline-logic.test.mjs` |
| `tests/06-publish-order.test.mjs` | `tests/unit/publish-order.test.mjs` |
| `tests/fork-version.test.mjs` | `tests/unit/fork-version.test.mjs` |
| `tests/07-agentdb-tools-activation.test.mjs` | `tests/unit/agentdb-tools-wiring.test.mjs` |
| `tests/08-hooks-tools-activation.test.mjs` | `tests/unit/hooks-tools-wiring.test.mjs` |
| `tests/09-memory-bridge-activation.test.mjs` | `tests/unit/memory-bridge-wiring.test.mjs` |
| `tests/10-memory-tools-activation.test.mjs` | `tests/unit/memory-tools-wiring.test.mjs` |
| `tests/12-controller-registry-activation.test.mjs` | `tests/unit/controller-registry.test.mjs` |
| `tests/13-controller-chaos.test.mjs` | `tests/unit/controller-chaos.test.mjs` |
| `tests/14-controller-properties.test.mjs` | `tests/unit/controller-properties.test.mjs` |
| `tests/15-agentdb-context-synthesize.test.mjs` | `tests/unit/context-synthesize.test.mjs` |
| `tests/16-init-structural.test.mjs` | `tests/acceptance/init-structural.test.mjs` |
| `tests/17-init-helpers.test.mjs` | `tests/acceptance/init-helpers.test.mjs` |
| `tests/18-init-cross-mode.test.mjs` | `tests/acceptance/init-cross-mode.test.mjs` |
| `tests/19-init-patch-regression.test.mjs` | `tests/acceptance/init-patch-regression.test.mjs` |

#### npm Script Changes

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:unit": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:acceptance": "bash scripts/test-acceptance.sh",
  "test:smoke": "bash scripts/test-smoke.sh --registry https://registry.npmjs.org",
  "test:all": "npm test && npm run build && npm run test:acceptance",
  "preflight": "node scripts/preflight.mjs",
  "build": "bash scripts/build.sh",
  "deploy": "bash scripts/sync-and-build.sh",
  "deploy:dry-run": "bash scripts/sync-and-build.sh --test-only"
}
```

**Removed scripts:**
- `test:verify` -- killed. Conflated deploy and test.
- `test:live` -- replaced by `test:smoke`.

**Kept scripts:**
- `test:unit` -- explicit alias for `npm test`, useful in CI.

#### Bash Variable Renames

| Old | New |
|-----|-----|
| `RQ_PORT` | `VERDACCIO_PORT` |
| `rq_pass` | `pass_count` |
| `rq_fail` | `fail_count` |
| `rq_total` | `total_count` |
| `rq_results_json` | `results_json` |
| `RQ_PARALLEL_DIR` | `PARALLEL_DIR` |
| `RQ_STORAGE` | `VERDACCIO_STORAGE` |

#### sync-and-build.sh Function Separation

```bash
deploy_to_staging() {
  log "Deploying to Verdaccio (staging)"
  bash "${SCRIPT_DIR}/deploy-staging.sh" \
    --build-dir "${BUILD_DIR}" \
    --changed-packages "${CHANGED_PACKAGES_JSON}" || return 1
}

run_acceptance() {
  log "Running acceptance checks against staging"
  # Init Node.js tests (parallel with bash checks)
  node "${PROJECT_DIR}/scripts/test-runner.mjs" --dir tests/acceptance &
  local init_pid=$!

  # T01-T25 bash acceptance checks
  bash "${SCRIPT_DIR}/test-acceptance.sh" \
    --registry "http://localhost:${VERDACCIO_PORT}" \
    --skip-deploy || { kill "$init_pid" 2>/dev/null; return 1; }

  wait "$init_pid" || return 1
}

deploy_to_prod() {
  log "Deploying to npm (production)"
  # Promote on Verdaccio first (bless staging)
  bash "${SCRIPT_DIR}/promote.sh" || return 1
  # Then npm publish
  bash "${SCRIPT_DIR}/deploy-prod.sh" --build-dir "${BUILD_DIR}" || return 1
}

run_smoke() {
  log "Running smoke checks against npm"
  bash "${SCRIPT_DIR}/test-smoke.sh" \
    --registry "https://registry.npmjs.org" || return 1
}

# Pipeline orchestration with gates
run_pipeline() {
  run_tests_ci           || return 1   # Phase 4: unit
  run_build              || return 1   # Phase 3: build (already ran before unit in practice)
  deploy_to_staging      || return 1   # Phase 5: deploy-staging
  run_acceptance         || return 1   # Phase 6: acceptance
  if [[ "${TEST_ONLY}" != "true" ]]; then
    deploy_to_prod       || return 1   # Phase 7: deploy-prod
    run_smoke            || return 1   # Phase 8: smoke
  fi
}
```

### E. Acceptance Criteria for ruflo-patch

Acceptance for this project means: **"A developer can install @sparkleideas packages from a registry and use them to initialize a project, run diagnostics, use memory/neural features, and activate all controllers."**

| Criterion | What it means | Checks |
|-----------|--------------|--------|
| **Installable** | Packages resolve, install, and have correct dependencies | T01-T03, S-1..S-3 |
| **Initializable** | `@sparkleideas/cli init` creates a valid project scaffold | T04-T08, init-*.test.mjs |
| **Diagnosable** | `doctor` and wrapper proxy work | T09-T10 |
| **Functional** | Memory, neural, agent-booster, plugins subsystems work | T11-T16 |
| **Controllers** | All 28 controllers activate and respond correctly | T17-T25 |

## Implementation

### Execution Plan (3 commits, ~3 hours)

**Commit 1: Move files + update runner** (~1h)

1. `mkdir -p tests/unit tests/acceptance`
2. `git mv` all 16 test files per migration map
3. Update `test-runner.mjs` with `--dir` support + recursive scan
4. Update `package.json` scripts
5. Run `npm test` to verify unit tests pass
6. Run `node scripts/test-runner.mjs --dir tests/acceptance` to verify init tests pass

**Commit 2: Split test-verify.sh + rename scripts** (~1.5h)

1. Extract deploy-staging logic from test-verify.sh Phases 1-7 into `scripts/deploy-staging.sh`
2. Extract test harness (~200 lines) from test-verify.sh into `lib/test-harness.sh`
3. Rewrite `scripts/test-acceptance.sh`:
   - Accept `--skip-deploy` flag (for pipeline orchestrator which deploys separately)
   - Default behavior: call deploy-staging.sh then run checks (for developers)
4. `git mv scripts/test-acceptance.sh scripts/test-smoke.sh` (old acceptance -> smoke)
5. Write new `scripts/test-acceptance.sh` with the rewritten logic
6. Renumber T32 to T25 in `lib/acceptance-checks.sh`
7. Apply bash variable renames (RQ_* -> descriptive names)
8. Update `sync-and-build.sh` with separated deploy/test functions
9. Run `npm run test:acceptance` end-to-end to validate

**Commit 3: Docs + cleanup** (~30min)

1. Update project `CLAUDE.md` build/test table
2. Write `tests/CLAUDE.md` test guide
3. Remove stale S-/H-/X-/R- ID prefixes from test descriptions
4. Delete orphaned `tests/fork/` files if any
5. Update ADR cross-references (ADR-0023, ADR-0035)

### Risk Assessment

**Low risk.** The core change is file moves and script splitting. All test logic (check functions, check library, harness) stays identical. The risk is in the test-verify.sh split, which is validated by running the full pipeline end-to-end.

| Risk | Mitigation |
|------|-----------|
| test-runner.mjs `--dir` breaks existing behavior | Default to `tests/` (current behavior) when `--dir` not specified |
| Script rename breaks systemd timer | Timer calls `sync-and-build.sh` which calls internal functions -- no external script name dependency |
| T32->T25 renumber breaks result history | Result JSON files store both ID and function name. Old results are not re-read. |
| Init tests slower in acceptance phase | Run in parallel with bash checks (see execution groups). No timing regression. |

## Consequences

### Positive

- Deploy is a first-class pipeline phase, not hidden inside "verify"
- Tests run at the right time: pre-deploy validates code, post-deploy validates the artifact
- `npm test` runs in <2s (inner loop), excludes 12s init tests
- Clear failure semantics: unit fail = code bug, acceptance fail = package bug, smoke fail = npm issue
- "verify" name eliminated -- no more confusion about what it means
- Pipeline matches industry CI/CD: build -> deploy(staging) -> test -> deploy(prod) -> test
- Two-stage deployment (Verdaccio -> npm) is explicitly modeled
- Test ID scheme is simple (T-numbers for bash, descriptive names for Node.js)
- Adding new tests requires zero renumbering

### Negative

- One-time churn in `git blame` from file moves
- test-verify.sh split requires careful extraction
- `test:verify` npm script removed with no alias (clean break)
- Three new scripts (deploy-staging.sh, deploy-prod.sh, test-smoke.sh) to maintain

### Known Issues (out of scope)

- `--test-only` (deploy:dry-run) still bumps versions even though it does not publish
- Init tests could be made faster by testing generator functions directly (requires new unit tests)
- The 1.7s unit test runtime exceeds the 1000ms "Google Small" threshold (mostly due to module loading, not test logic)

## Prior Art

- **Google**: Small/Medium/Large test classification. Principle adopted: hermetic boundary determines category. Vocabulary rejected: too abstract for 16 test files.
- **Stripe**: Unit/Contract/Integration/Acceptance/Smoke. Principle adopted: acceptance = test the deployed artifact. Contract category rejected: adds ambiguity for no benefit.
- **Netflix**: Fast/Slow/Deploy. Principle adopted: simplicity (two categories + deploy). Pipeline shape adopted: action/test interleaving.
- **Microsoft Azure DevOps**: Pipeline-gated testing. Principle adopted: every phase gates the next with explicit failure semantics.
- **Thoughtworks CD**: Deployment pipeline as test organizer. Principle adopted: deploy is a first-class phase, not a test step.
- **v2 of this ADR**: Rejected. Conflated deploy and test into "verify."
- **v3 of this ADR**: Accepted as correct pipeline shape. Superseded by v4 for completeness (timing, IDs, acceptance criteria, debate transcript).

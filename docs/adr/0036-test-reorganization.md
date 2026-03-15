# ADR-0036: Test Suite Reorganization

## Status

Proposed (v3 -- supersedes v2 consensus rejected by product owner)

## Date

2026-03-15

## Deciders

sparkling team, informed by structured hive-mind debate (5 senior testing experts, Round 2)

## Context

### v2 was rejected

The v2 consensus produced this pipeline:

```
unit -> build -> verify (init tests + verdaccio publish + install + 25 checks) -> deploy -> live
```

The product owner rejected it with this critique:

> "You put verify BEFORE deploy. How can you verify the deployment if you run verify first? You need to test that the installer works on a new project, and run tests on the new project. You've conflated init scaffolding tests, Verdaccio publish+install, and functional checks into one badly-defined 'verify'. Where is deploy as a separate step?"

The core errors in v2:

1. **Verdaccio publish IS a deploy.** Publishing to Verdaccio is deploying to a staging registry. It is not a test activity. v2 buried it inside "verify" as if it were a test step.
2. **Init scaffolding tests are pre-build unit-level tests** that got shoved into verify. Testing that the code generator produces valid output does not require a registry.
3. **Functional checks (T01-T25) test the DEPLOYED artifact.** They should run AFTER deploy, not as part of it.
4. **"Verify" conflated 3 different pipeline phases** into one monolithic stage with no clear identity.

### The real question

Where do tests belong relative to deployments? A CI/CD pipeline has TWO deploy actions (staging, then production) and tests run between and after each:

```
code -> build -> test(pre-deploy) -> DEPLOY(staging) -> test(post-staging) -> DEPLOY(prod) -> test(post-prod)
```

### Current inventory

- 16 unit test files (426 `it()` calls), 1.7s runtime
- 25 bash acceptance checks (T01-T24, T32), ~30s runtime
- Shared check library (`lib/acceptance-checks.sh`)
- Preflight script (`scripts/preflight.mjs`)
- 3 orphaned fork test files (`tests/fork/`)
- Pipeline orchestrator (`scripts/sync-and-build.sh`) with `run_tests_ci()` and `run_verify()`

### Pipeline as it actually runs today

```
sync-and-build.sh
  |
  +-- Publish stage:
  |     1. Detect merged PRs in forks
  |     2. Version bump (fork-version.mjs)
  |     3. Build (codemod + compile)
  |     4. run_tests_ci():
  |        a. npm run preflight        (L0)
  |        b. node test-runner.mjs     (L1 -- all 16 files including slow init tests)
  |     5. run_verify() -> test-verify.sh:
  |        a. Publish to Verdaccio      <-- THIS IS A DEPLOY, NOT A TEST
  |        b. Install from Verdaccio    <-- THIS TESTS THE DEPLOY
  |        c. Run 25 acceptance checks  <-- THESE TEST THE DEPLOY
  |        d. Promote to @latest        <-- THIS IS ANOTHER DEPLOY ACTION
  |
  +-- Sync stage:
        1. Fetch upstream
        2. Create sync branch, merge
        3. Type-check, codemod, build
        4. run_tests() -> run_tests_ci() + run_verify()
        5. Create PR
```

---

## Hive-Mind Debate Transcript (Round 2)

### Round 1: Each Expert Re-Evaluates with Deploy as a First-Class Phase

---

**EXPERT 1 (Google Staff Engineer -- Test Infrastructure)**

The v2 consensus made a fundamental category error. It treated "publish to Verdaccio" as a test action. Publishing is a DEPLOYMENT action. It changes the state of a registry. Tests OBSERVE state; deployments MUTATE state. Mixing them in one stage makes it impossible to answer: "did the deploy succeed?" vs "did the tests pass?"

**Corrected pipeline:**

```
code -> unit tests -> build -> deploy-staging -> acceptance -> deploy-prod -> smoke
```

**Six phases, not three.** Each phase has exactly one responsibility:

| Phase | Action | Type | What it does |
|-------|--------|------|-------------|
| 1. unit | Run preflight + 12 pure logic tests + 4 init scaffolding tests | TEST | Validates code correctness |
| 2. build | codemod + compile | BUILD | Produces artifacts |
| 3. deploy-staging | Publish to Verdaccio + install into temp project | DEPLOY | Deploys to staging registry |
| 4. acceptance | Run T01-T25 against Verdaccio-installed packages | TEST | Validates deployed artifact |
| 5. deploy-prod | npm publish to npmjs.com + promote Verdaccio to @latest | DEPLOY | Deploys to production registry |
| 6. smoke | Run T01-T25 against real npm | TEST | Validates production deployment |

**On init tests:** The init scaffolding tests (files 16-19) run `npx @sparkleideas/cli init` which installs from Verdaccio. That makes them post-deploy, not pre-deploy. Wait -- actually, looking at the test files, they use a fixture factory that mocks the init behavior. Let me check.

Actually, the init tests in files 16-19 DO use `npx` which hits the registry. So they are post-deploy tests. But we could also test the init CODE in isolation without a registry. There is a split: test the generator logic (unit) vs test the installed command (acceptance).

**Decision on init tests:** Keep them as post-deploy acceptance tests since they currently require a registry. If someone wants faster feedback on init logic, write new unit tests for the generator functions. Do not pretend the existing tests are unit tests when they hit the network.

---

**EXPERT 2 (Stripe Staff Engineer -- SDK/CLI Testing)**

Expert 1 is almost right but has a critical omission. There is no gate between deploy-staging and acceptance. If the deploy fails silently (partial publish, missing package), the acceptance tests will fail with confusing errors. We need a STRUCTURAL VALIDATION between deploy and acceptance.

**My corrected pipeline:**

```
code -> unit -> build -> deploy-staging -> structural-gate -> acceptance -> deploy-prod -> smoke
```

The structural gate is not a test suite -- it is a deploy verification step:
- Did all packages land on Verdaccio?
- Can we `npm install` from Verdaccio?
- Does `npm ls` show no MISSING deps?

This is the "deploy health check" that the current test-verify.sh already does in Phases 1-7 (health check, cache clear, publish, install, structural checks). Those are deploy actions and deploy verification, not tests.

**On init tests:** They should be split. The existing files 16-19 use `npx` and hit a registry -- those are acceptance tests. But the logic they test (does init produce the right file structure?) can also be tested without a registry by calling the generator functions directly. I recommend:
- Move existing 16-19 to acceptance (post-deploy)
- Write new unit tests for generator functions (optional, future work)

---

**EXPERT 3 (Netflix Principal Engineer -- Platform)**

Both of you are over-engineering this. Six phases? Seven with a structural gate? This is 16 test files and 25 bash checks. Let me simplify.

**The reality is three ACTIONS and three TEST phases, interleaved:**

```
unit -> build -> DEPLOY(verdaccio) -> acceptance -> DEPLOY(npm) -> smoke
```

That is it. Six steps. Three are actions (build, deploy-staging, deploy-prod). Three are tests (unit, acceptance, smoke). Each test phase validates the action that just completed:
- unit validates the code
- acceptance validates the staging deploy
- smoke validates the production deploy

No "structural gate" -- that is just the first few checks of acceptance (T01-T03 already do version/dist-tag validation). No separate "preflight" -- that is just the preamble to unit.

**On init tests:** They go in acceptance because they need a registry. Period. If someone wants faster init feedback, they refactor the tests. Do not reorganize the pipeline around a hypothetical future test.

---

**EXPERT 4 (Microsoft Principal SDET -- Azure DevOps)**

Netflix is correct on the pipeline shape. But he is wrong about the structural gate. T01-T03 are NOT structural checks. They are version checks (`npm view @sparkleideas/cli version`). The structural checks in test-verify.sh (S-1: CLI in node_modules, S-2: packages on Verdaccio, S-3: npm ls clean) are deploy verification, not acceptance tests. They answer "did the deploy succeed?" not "does the product work?"

But I concede that making them a separate named phase is overkill. They can be the preamble to acceptance, just as preflight is the preamble to unit.

**My pipeline:**

```
unit -> build -> deploy-staging -> acceptance -> deploy-prod -> smoke
```

Six phases. Each is clearly an action or a test. Each phase gates the next.

| Phase | Gates | Failure meaning |
|-------|-------|----------------|
| unit | build | Code is wrong |
| build | deploy-staging | Cannot produce artifacts |
| deploy-staging | acceptance | Cannot publish to registry |
| acceptance | deploy-prod | Deployed artifact is broken |
| deploy-prod | smoke | Cannot publish to npm |
| smoke | promote dist-tag | Production artifact is broken |

**On init tests:** Acceptance. They test the installed CLI. They need a registry. They go after deploy-staging.

---

**EXPERT 5 (Thoughtworks Tech Lead -- CD/XP Practitioner)**

I agree with the 6-phase pipeline. But everyone is dodging the naming question. What does the developer TYPE? The npm scripts are the interface. Here is my proposal:

```json
{
  "test": "unit tests (<2s)",
  "test:acceptance": "T01-T25 against Verdaccio (~30s)",
  "test:smoke": "T01-T25 against npm (~30s)",
  "deploy:staging": "publish to Verdaccio",
  "deploy:prod": "publish to npm"
}
```

Wait. But `deploy:staging` is not how the pipeline actually works. The pipeline orchestrator (`sync-and-build.sh`) handles deployment. Individual npm scripts for deploy steps would be used manually, not in CI. The test scripts are what developers run manually.

Let me reconsider. The developer-facing commands are:
- `npm test` -- fast feedback (unit)
- `npm run test:acceptance` -- verify against staging (needs prior staging deploy)
- `npm run test:smoke` -- verify against production (needs prior prod deploy)
- `npm run deploy` -- full pipeline (handles everything)

The deploy actions are INTERNAL to the pipeline orchestrator, not developer-facing commands. So the npm scripts should be tests only. The deploy actions live in sync-and-build.sh.

---

### Round 2: Experts Attack Each Other

---

**EXPERT 1 (Google) attacks EXPERT 3 (Netflix):**

You said "no structural gate -- T01-T03 already do version/dist-tag validation." That is wrong. T01 runs `npm view @sparkleideas/cli version` which checks version resolution. S-1 checks `node_modules/@sparkleideas/cli` exists after install. S-2 checks each ADR-0022 package is on Verdaccio. S-3 runs `npm ls --all`. Those are DIFFERENT checks. T01-T03 test the published version metadata. S-1 through S-3 test the install integrity. You cannot collapse them.

**EXPERT 3 (Netflix) responds:**

Fine. But they do not need to be a separate pipeline PHASE. They are the setup phase of acceptance. If install fails, acceptance cannot run. If structural checks fail, acceptance cannot run. They are preconditions, not a peer stage.

**EXPERT 1 (Google) concedes:**

Agreed. Preconditions to acceptance, not a separate phase. The 6-phase pipeline stands: unit -> build -> deploy-staging -> acceptance -> deploy-prod -> smoke. Structural checks are the preamble to acceptance, same as preflight is the preamble to unit.

---

**EXPERT 2 (Stripe) attacks EXPERT 5 (Thoughtworks):**

You renamed `test:live` (from v2) to `test:smoke`. But "smoke" implies a quick sanity check -- a few critical paths. The post-production tests run ALL 25 checks, which is a full acceptance suite, not a smoke test. Calling it "smoke" sets wrong expectations.

**EXPERT 5 (Thoughtworks) defends:**

In CD practice, "smoke test" means "post-deployment validation." It does not imply brevity. The Linux kernel smoke test suite is enormous. But I take your point that it could mislead on this project. Alternatives: `test:live`, `test:prod`, `test:post-deploy`.

**EXPERT 4 (Microsoft) interjects:**

`test:smoke` is fine. Everyone in DevOps understands smoke testing as post-deploy validation. The alternative `test:live` from v2 was vague -- "live" could mean "against a live service" or "in a live environment." `test:smoke` is more specific.

**EXPERT 3 (Netflix):**

I prefer `test:smoke` over `test:live`. It is industry-standard for post-deploy checks.

**EXPERT 2 (Stripe) concedes:**

Fine. `test:smoke` it is.

---

**EXPERT 4 (Microsoft) attacks EXPERT 5 (Thoughtworks):**

You said deploy actions are internal to the pipeline orchestrator. But what about `npm run test:verify` from v2? That script PUBLISHED to Verdaccio AND ran tests. Your proposal separates them, meaning test-verify.sh needs to be split into two scripts: one that deploys and one that tests. That is a significant refactor.

**EXPERT 5 (Thoughtworks) responds:**

Yes. And that is CORRECT. The current test-verify.sh is a pipeline-in-a-script. It does 8 phases including publish, install, structural checks, and 25 acceptance checks. That monolith is why v2 got confused -- when the deploy and test are in the same script, people call the whole thing a "test." Splitting it is the fix, not the problem.

**EXPERT 1 (Google) supports:**

Splitting is essential. But practically, we should keep a convenience script that runs deploy-staging + acceptance for local development. The pipeline orchestrator calls them as separate functions. The developer runs one command that does both.

**EXPERT 4 (Microsoft) agrees:**

Yes. Two internal functions (`deploy_to_staging` and `run_acceptance`), one convenience command (`npm run test:acceptance` which does both for local dev), and the pipeline orchestrator calls them separately with gates between.

**ALL EXPERTS agree on this design.**

---

**EXPERT 3 (Netflix) attacks EXPERT 1 (Google) on init tests:**

You keep saying the init tests "could be unit tests if we refactored." Stop. The question is: where do the EXISTING tests go? Files 16-19 use `npx` and hit a registry. They are acceptance tests. Ship the reorg with them in acceptance. If someone wants unit-level init tests later, they write them. Do not hold up the reorg for hypothetical future work.

**EXPERT 1 (Google) agrees:**

You are right. Existing init tests go to acceptance. Future init unit tests are out of scope for this ADR.

---

**EXPERT 2 (Stripe) raises a new concern:**

What about the Verdaccio promote step? Currently test-verify.sh promotes packages to @latest AFTER acceptance checks pass. Where does that go? It is a deploy action (mutates dist-tag state) but it happens after acceptance, before npm publish. It is a staging finalization step.

**EXPERT 4 (Microsoft):**

Promote-on-Verdaccio is part of deploy-staging finalization. It is not a test. In the pipeline:

```
deploy-staging = publish to Verdaccio + install + promote to @latest on Verdaccio
acceptance = T01-T25 against installed packages
```

Wait. Actually, promoting before acceptance is wrong. If acceptance fails, you have promoted a broken version on Verdaccio. The promote should happen AFTER acceptance passes.

**EXPERT 5 (Thoughtworks):**

Correct. The promote is a gated action: acceptance must pass before promoting on Verdaccio. So the sequence is:

```
deploy-staging (publish) -> acceptance -> promote-staging -> deploy-prod -> smoke -> promote-prod
```

But now we have 8 phases. That is too many names.

**EXPERT 3 (Netflix):**

Promote is an implementation detail of deploy, not a pipeline phase. Just put it at the end of the acceptance script: if all checks pass, promote. Or better: put it at the beginning of deploy-prod. Before you publish to npm, promote on Verdaccio to confirm the staging deploy is blessed.

**EXPERT 4 (Microsoft):**

That is clean. Promote-staging is the first step of deploy-prod. It is the "bless staging" action before going to production.

**ALL EXPERTS agree. Promote stays implicit, triggered by acceptance success.**

---

### Round 3: Consensus Building

---

**EXPERT 4 (Microsoft) opens:**

Let me synthesize the final consensus. Six phases, three test and three action:

```
unit -> build -> deploy-staging -> acceptance -> deploy-prod -> smoke
                                                      ^
                                              (includes promote-staging
                                               as first step)
```

Each phase:

| # | Phase | Type | Script/Function | What |
|---|-------|------|----------------|------|
| 1 | unit | TEST | `npm test` | Preflight + 12 pure logic files (<2s) |
| 2 | build | ACTION | `npm run build` | codemod + compile |
| 3 | deploy-staging | ACTION | `deploy_to_staging()` | Publish to Verdaccio, install into temp project, structural checks |
| 4 | acceptance | TEST | `run_acceptance_checks()` | T01-T25 against Verdaccio + init tests (16-19) |
| 5 | deploy-prod | ACTION | `deploy_to_prod()` | Promote Verdaccio @latest, npm publish |
| 6 | smoke | TEST | `npm run test:smoke` | T01-T25 against real npm |

**EXPERT 1 (Google):**

Accepted. One clarification: the init tests (16-19) run as part of acceptance, not as part of deploy-staging. They test the installed CLI by running `npx @sparkleideas/cli init`. They exercise the deployed artifact. They are acceptance tests.

**EXPERT 2 (Stripe):**

Accepted. And the structural checks (S-1 through S-3) are part of deploy-staging, not acceptance. They verify the deploy succeeded. They are deploy health checks.

**EXPERT 3 (Netflix):**

Accepted. But I want to nail down the npm scripts. Developers care about commands, not architecture diagrams.

**EXPERT 5 (Thoughtworks):**

Here are the scripts:

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:acceptance": "bash scripts/test-acceptance.sh",
  "test:smoke": "bash scripts/test-smoke.sh",
  "test:all": "npm test && npm run build && npm run test:acceptance",
  "preflight": "node scripts/preflight.mjs"
}
```

Key design choices:
- `npm test` is unit only. Fast. Inner loop.
- `test:acceptance` handles deploy-staging internally (publish + install + structural checks), then runs T01-T25 + init tests. One command for the developer. Under the hood, it is deploy + test.
- `test:smoke` runs T01-T25 against real npm. Only after `npm run deploy`.
- `test:all` runs unit + build + acceptance. The pre-publish gate.
- No `test:verify` -- that name conflated deploy and test. Killed.
- No `test:live` -- replaced by `test:smoke`.

**EXPERT 4 (Microsoft):**

Wait. You just put deploy back inside `test:acceptance`. Are we not right back where we started?

**EXPERT 5 (Thoughtworks):**

No. The CONCEPTUAL model separates them: deploy-staging is an action, acceptance is a test. The script `test-acceptance.sh` invokes both for developer convenience. Inside sync-and-build.sh, they are separate function calls with a gate between them. The developer sees one command; the pipeline sees two phases.

**EXPERT 3 (Netflix):**

That is the right pragmatic call. A developer running `npm run test:acceptance` wants to test the deployed artifact. They do not want to manually publish to Verdaccio first. The script does both, but the pipeline functions are separated.

**EXPERT 1 (Google):**

Agreed. The implementation detail is that test-acceptance.sh calls `deploy_to_staging()` then `run_acceptance_checks()`. sync-and-build.sh calls them separately with error handling between. Same functions, different entry points.

**EXPERT 2 (Stripe):**

I want to ensure we are not just renaming. The critical change from v2 is:

1. **test-verify.sh is DELETED.** It conflated deploy and test.
2. **test-acceptance.sh is REWRITTEN.** It calls deploy-staging, then runs checks. Two clear internal phases.
3. **test-live.sh becomes test-smoke.sh.** Same 25 checks, pointed at npm.
4. **The shared functions** (`deploy_to_staging`, `run_acceptance_checks`) live in `lib/` so both test-acceptance.sh and sync-and-build.sh can use them.

**ALL EXPERTS agree on final proposal.**

---

**EXPERT 4 (Microsoft) final check:**

One more thing: the `--skip-promote` flag on the current test-verify.sh. In the new model, promote happens at deploy-prod time, not at acceptance time. So `--skip-promote` moves to deploy-prod logic. Acceptance never promotes anything.

**EXPERT 5 (Thoughtworks):**

Correct. Acceptance tests the deployed artifact. It does not mutate state. Deploy-prod promotes staging and publishes to npm. Clean separation.

**ALL EXPERTS confirm final consensus.**

---

## Decision

### Final Consensus: 6-phase pipeline with explicit deploy phases

The pipeline has three TEST phases and three ACTION phases, interleaved:

```
  code change
       |
  +-----------+
  |  npm test  |  TEST: preflight + 12 pure-logic unit tests (<2s)
  +-----------+
       |
   GATE: code is correct
       |
  +-----------+
  |   build    |  ACTION: codemod + compile (~30s cold, cached)
  +-----------+
       |
   GATE: artifacts exist
       |
  +------------------+
  | deploy-staging    |  ACTION: publish to Verdaccio, install into temp
  |                   |  project, structural checks (S-1..S-3)
  +------------------+
       |
   GATE: staging deploy healthy
       |
  +------------------+
  | acceptance        |  TEST: T01-T25 against Verdaccio-installed
  |                   |  packages + init tests (16-19)
  +------------------+
       |
   GATE: deployed artifact works
       |
  +------------------+
  | deploy-prod       |  ACTION: promote Verdaccio @latest, npm publish
  +------------------+
       |
   GATE: production deploy succeeded
       |
  +------------------+
  | smoke             |  TEST: T01-T25 against real npm
  +------------------+
       |
   GATE: production artifact works
       |
  +---------------------+
  | npm dist-tag @latest |
  +---------------------+
```

### Phase definitions

| Phase | Type | Purpose | Failure meaning |
|-------|------|---------|----------------|
| **unit** | TEST | Validate code correctness: transforms, logic, wiring, generator code | Code is wrong. Fix the source. |
| **build** | ACTION | Produce deployable artifacts: codemod scope rename, compile TypeScript | Build tooling is broken. Fix codemod/tsc config. |
| **deploy-staging** | ACTION | Deploy to staging registry: publish all packages to Verdaccio, install into fresh temp project, run structural health checks (S-1..S-3) | Packaging is broken. Fix package.json, exports, deps. |
| **acceptance** | TEST | Validate the deployed artifact works: run T01-T25 acceptance checks + init scaffolding tests against packages installed from Verdaccio | Deployed package is broken. Fix the code or the packaging. |
| **deploy-prod** | ACTION | Deploy to production: promote Verdaccio dist-tags to @latest, npm publish to npmjs.com | npm publish failed. Check credentials, versions, network. |
| **smoke** | TEST | Validate the production deployment: run T01-T25 against packages installed from real npm | Production package is broken. Investigate npm-specific issues. |

### What belongs where

#### Unit tests (12 files, <2s)

Pure logic, no I/O, no subprocess, no registry:

| File | it() calls | What it tests |
|------|-----------|---------------|
| `codemod.test.mjs` | 16 | Scope rename transforms |
| `pipeline-logic.test.mjs` | 37 | Pipeline orchestration logic |
| `publish-order.test.mjs` | 31 | Topological publish ordering |
| `fork-version.test.mjs` | 41 | Version bump calculations |
| `agentdb-tools-wiring.test.mjs` | 57 | AgentDB tool registration (mocked) |
| `hooks-tools-wiring.test.mjs` | 49 | Hooks tool registration (mocked) |
| `memory-bridge-wiring.test.mjs` | 49 | Memory bridge activation (mocked) |
| `memory-tools-wiring.test.mjs` | 23 | Memory tool registration (mocked) |
| `controller-registry.test.mjs` | 20 | Controller registry activation (mocked) |
| `controller-chaos.test.mjs` | 27 | Controller chaos/fault tests (mocked) |
| `controller-properties.test.mjs` | 13 | Controller property validation (mocked) |
| `context-synthesize.test.mjs` | 8 | Context synthesis logic (mocked) |

#### Acceptance tests -- init scaffolding (4 files, post-deploy)

These run `npx` and hit the registry. They test the INSTALLED CLI command, not the generator source code:

| File | it() calls | What it tests |
|------|-----------|---------------|
| `init-structural.test.mjs` | 17 | Does `npx @sparkleideas/cli init` produce correct file structure? |
| `init-helpers.test.mjs` | 14 | Do init helper utilities work on the installed package? |
| `init-cross-mode.test.mjs` | 9 | Does init work across different modes (v3, wizard, etc.)? |
| `init-patch-regression.test.mjs` | 15 | Do patched init behaviors survive packaging? |

#### Acceptance tests -- bash checks (25 checks, post-deploy)

These run against packages installed from a registry (Verdaccio or npm):

| ID | Function | Group | What it validates |
|----|----------|-------|------------------|
| T01 | `check_version` | smoke | Version resolves on registry |
| T02 | `check_latest_resolves` | smoke | @latest dist-tag points to correct version |
| T03 | `check_no_broken_versions` | smoke | No known-broken versions published |
| T04 | `check_init` | init | `npx @sparkleideas/cli init` creates project |
| T05 | `check_settings_file` | init | Init produces correct settings file |
| T06 | `check_scope` | init | Package scope is @sparkleideas throughout |
| T07 | `check_mcp_config` | init | MCP configuration is generated correctly |
| T08 | `check_ruflo_init_full` | init | `ruflo init --full` produces complete scaffold |
| T09 | `check_doctor` | diagnostics | `ruflo doctor` runs without error |
| T10 | `check_wrapper_proxy` | diagnostics | Wrapper proxy forwards commands correctly |
| T11 | `check_memory_lifecycle` | data | Memory store/retrieve/delete cycle works |
| T12 | `check_neural_training` | data | Neural training round-trips |
| T13 | `check_agent_booster_esm` | packages | Agent booster ESM imports resolve |
| T14 | `check_agent_booster_bin` | packages | Agent booster CLI binary works |
| T15 | `check_plugins_sdk` | packages | Plugins SDK exports are accessible |
| T16 | `check_plugin_install` | packages | Plugin install flow completes |
| T17 | `check_controller_health` | controllers | Controller health endpoint responds |
| T18 | `check_hooks_route` | controllers | Hook routing dispatches correctly |
| T19 | `check_memory_scoping` | controllers | Memory namespace scoping works |
| T20 | `check_reflexion_lifecycle` | controllers | Reflexion store/recall cycle works |
| T21 | `check_causal_graph` | controllers | Causal graph edges are recorded |
| T22 | `check_cow_branching` | controllers | Copy-on-write branching works |
| T23 | `check_batch_operations` | controllers | Batch API processes multiple ops |
| T24 | `check_context_synthesis` | controllers | Context synthesis produces output |
| T25 | `check_full_controller_activation` | e2e | All 28 controllers activate successfully |

#### Structural checks (deploy health, part of deploy-staging)

These are NOT tests -- they verify the deploy succeeded:

| ID | What | Where |
|----|------|-------|
| S-1 | `@sparkleideas/cli` exists in `node_modules/` | deploy-staging |
| S-2 | ADR-0022 packages available on Verdaccio | deploy-staging |
| S-3 | `npm ls --all` shows no MISSING deps | deploy-staging |

### npm scripts

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:acceptance": "bash scripts/test-acceptance.sh",
  "test:smoke": "bash scripts/test-smoke.sh",
  "test:all": "npm test && npm run build && npm run test:acceptance",
  "preflight": "node scripts/preflight.mjs"
}
```

| Script | Phase(s) | What it does | When to run |
|--------|----------|-------------|-------------|
| `npm test` | unit | Preflight + 12 unit test files (<2s) | After every code change |
| `npm run test:acceptance` | deploy-staging + acceptance | Publish to Verdaccio, install, structural checks, T01-T25, init tests | Before deploying to npm (needs `npm run build` first) |
| `npm run test:smoke` | smoke | T01-T25 against real npm | After deploying to npm |
| `npm run test:all` | unit + build + deploy-staging + acceptance | Full pre-production gate | Manual pre-deploy validation |

**Why test:acceptance includes deploy-staging:** A developer running `npm run test:acceptance` wants to validate the deployed artifact. Requiring them to manually publish to Verdaccio first creates a footgun (they forget, run acceptance against stale packages, get false passes). The script handles deployment internally, but the pipeline orchestrator calls the deploy and test functions separately with gates.

**Removed scripts:**
- `test:unit` -- replaced by `npm test` (which now runs only unit tests)
- `test:verify` -- killed. Conflated deploy and test.
- `test:live` -- replaced by `test:smoke`
- `test:acceptance` (old) -- rewritten with new semantics (was pointed at npm, now pointed at Verdaccio)

### Script renames

| Old | New | Reason |
|-----|-----|--------|
| `test-verify.sh` | `test-acceptance.sh` | Was deploy+test monolith. Rewritten as deploy-staging + acceptance. |
| `test-acceptance.sh` | `test-smoke.sh` | Was "acceptance against npm." Now correctly named as post-production smoke test. |

### Directory structure

```
tests/
  unit/                              # Pure logic, no I/O (<2s total)
    codemod.test.mjs                   (16 it-calls)
    pipeline-logic.test.mjs            (37 it-calls)
    publish-order.test.mjs             (31 it-calls)
    fork-version.test.mjs              (41 it-calls)
    agentdb-tools-wiring.test.mjs      (57 it-calls)
    hooks-tools-wiring.test.mjs        (49 it-calls)
    memory-bridge-wiring.test.mjs      (49 it-calls)
    memory-tools-wiring.test.mjs       (23 it-calls)
    controller-registry.test.mjs       (20 it-calls)
    controller-chaos.test.mjs          (27 it-calls)
    controller-properties.test.mjs     (13 it-calls)
    context-synthesize.test.mjs        (8 it-calls)
  acceptance/                        # Post-deploy, needs Verdaccio
    init-structural.test.mjs           (17 it-calls)
    init-helpers.test.mjs              (14 it-calls)
    init-cross-mode.test.mjs           (9 it-calls)
    init-patch-regression.test.mjs     (15 it-calls)
  fixtures/
    init-fixture.mjs
  helpers/
    fixture-factory.mjs
    pipeline-helpers.mjs
  CLAUDE.md                          # Simplified test guide
```

Note: the init tests moved from `integration/` (v2) to `acceptance/`. The v2 name "integration" was wrong -- these tests do not test component integration, they test the INSTALLED CLI command against a deployed package. That is acceptance testing.

### File naming convention

- **No numeric prefixes.** Descriptive kebab-case names.
- `*-wiring.test.mjs` for mock-based contract tests (was "activation")
- `init-*.test.mjs` for init scaffolding acceptance tests
- No `@tier` annotations (directory IS the category)

### Migration map

| Current | New | Category |
|---------|-----|----------|
| `04-codemod.test.mjs` | `unit/codemod.test.mjs` | unit |
| `05-pipeline-logic.test.mjs` | `unit/pipeline-logic.test.mjs` | unit |
| `06-publish-order.test.mjs` | `unit/publish-order.test.mjs` | unit |
| `fork-version.test.mjs` | `unit/fork-version.test.mjs` | unit |
| `07-agentdb-tools-activation.test.mjs` | `unit/agentdb-tools-wiring.test.mjs` | unit |
| `08-hooks-tools-activation.test.mjs` | `unit/hooks-tools-wiring.test.mjs` | unit |
| `09-memory-bridge-activation.test.mjs` | `unit/memory-bridge-wiring.test.mjs` | unit |
| `10-memory-tools-activation.test.mjs` | `unit/memory-tools-wiring.test.mjs` | unit |
| `12-controller-registry-activation.test.mjs` | `unit/controller-registry.test.mjs` | unit |
| `13-controller-chaos.test.mjs` | `unit/controller-chaos.test.mjs` | unit |
| `14-controller-properties.test.mjs` | `unit/controller-properties.test.mjs` | unit |
| `15-agentdb-context-synthesize.test.mjs` | `unit/context-synthesize.test.mjs` | unit |
| `16-init-structural.test.mjs` | `acceptance/init-structural.test.mjs` | acceptance |
| `17-init-helpers.test.mjs` | `acceptance/init-helpers.test.mjs` | acceptance |
| `18-init-cross-mode.test.mjs` | `acceptance/init-cross-mode.test.mjs` | acceptance |
| `19-init-patch-regression.test.mjs` | `acceptance/init-patch-regression.test.mjs` | acceptance |

### Bash cleanup

| Old variable | New variable |
|-------------|-------------|
| `RQ_PORT` | `VERDACCIO_PORT` |
| `rq_pass` | `pass_count` |
| `rq_fail` | `fail_count` |
| `rq_total` | `total_count` |
| `rq_results_json` | `results_json` |
| `RQ_PARALLEL_DIR` | `PARALLEL_DIR` |
| `RQ_STORAGE` | `VERDACCIO_STORAGE` |

Extract duplicated harness (~200 lines) into `lib/test-harness.sh`: `run_check`, `run_check_bg`, `collect_parallel`, `_escape_json`, result tracking.

### Acceptance check IDs

Drop the T25-T31 gap. Renumber T32 to T25:

| New | Old | Function | Group |
|-----|-----|----------|-------|
| T01 | T01 | `check_version` | smoke |
| T02 | T02 | `check_latest_resolves` | smoke |
| T03 | T03 | `check_no_broken_versions` | smoke |
| T04 | T04 | `check_init` | init |
| T05 | T05 | `check_settings_file` | init |
| T06 | T06 | `check_scope` | init |
| T07 | T07 | `check_mcp_config` | init |
| T08 | T08 | `check_ruflo_init_full` | init |
| T09 | T09 | `check_doctor` | diagnostics |
| T10 | T10 | `check_wrapper_proxy` | diagnostics |
| T11 | T11 | `check_memory_lifecycle` | data |
| T12 | T12 | `check_neural_training` | data |
| T13 | T13 | `check_agent_booster_esm` | packages |
| T14 | T14 | `check_agent_booster_bin` | packages |
| T15 | T15 | `check_plugins_sdk` | packages |
| T16 | T16 | `check_plugin_install` | packages |
| T17 | T17 | `check_controller_health` | controllers |
| T18 | T18 | `check_hooks_route` | controllers |
| T19 | T19 | `check_memory_scoping` | controllers |
| T20 | T20 | `check_reflexion_lifecycle` | controllers |
| T21 | T21 | `check_causal_graph` | controllers |
| T22 | T22 | `check_cow_branching` | controllers |
| T23 | T23 | `check_batch_operations` | controllers |
| T24 | T24 | `check_context_synthesis` | controllers |
| T25 | T32 | `check_full_controller_activation` | e2e |

### test-runner.mjs change

Add `--dir` argument to scope file discovery:

```javascript
const testDir = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  || args[args.indexOf('--dir') + 1]
  || 'tests';
```

Enable recursive subdirectory scanning (currently reads only one level).

### sync-and-build.sh changes

Separate deploy-staging from acceptance in `run_verify()`:

```bash
deploy_to_staging() {
  log "Deploying to Verdaccio (staging)"

  # Verdaccio health check
  if ! curl -sf "http://localhost:${VERDACCIO_PORT}/-/ping" >/dev/null 2>&1; then
    log_error "Verdaccio not running on port ${VERDACCIO_PORT}"
    return 1
  fi

  # Clear + publish + install + structural checks
  # (extracted from current test-verify.sh Phases 1-7)
  bash "${SCRIPT_DIR}/deploy-staging.sh" "${args[@]}" || return 1
}

run_acceptance() {
  log "Running acceptance checks against staging"

  # Init tests (files 16-19, now in tests/acceptance/)
  node "${PROJECT_DIR}/scripts/test-runner.mjs" --dir tests/acceptance || return 1

  # T01-T25 bash acceptance checks
  bash "${SCRIPT_DIR}/run-acceptance-checks.sh" --registry "http://localhost:${VERDACCIO_PORT}" || return 1
}

deploy_to_prod() {
  log "Deploying to npm (production)"

  # Promote on Verdaccio first (bless staging)
  # Then npm publish
  bash "${SCRIPT_DIR}/deploy-prod.sh" || return 1
}

run_smoke() {
  log "Running smoke checks against npm"
  bash "${SCRIPT_DIR}/test-smoke.sh" --registry "https://registry.npmjs.org" || return 1
}

# Pipeline orchestration with gates
run_tests_ci() {
  log "Running unit tests"
  npm run preflight --prefix "${PROJECT_DIR}" || { log_error "Preflight failed"; return 1; }
  node "${PROJECT_DIR}/scripts/test-runner.mjs" --dir tests/unit || { log_error "Unit tests failed"; return 1; }
}

run_full_pipeline() {
  run_tests_ci           || return 1   # unit
  npm run build          || return 1   # build
  deploy_to_staging      || return 1   # deploy-staging
  run_acceptance         || return 1   # acceptance
  deploy_to_prod         || return 1   # deploy-prod
  run_smoke              || return 1   # smoke
}
```

### Updated tests/CLAUDE.md

```markdown
# Tests

## Pipeline

unit -> build -> deploy-staging -> acceptance -> deploy-prod -> smoke

## Commands
- `npm test` -- unit tests (<2s), run after every code change
- `npm run test:acceptance` -- deploy to Verdaccio + 25 checks + init tests (~60s)
- `npm run test:smoke` -- 25 checks against real npm (~30s), after deploy

## Gates
- Unit fails -> cannot build
- Acceptance fails -> cannot publish to npm
- Smoke fails -> do not promote dist-tag to @latest

## Rules
- Deploy is an ACTION, not a test. Verdaccio publish = staging deploy.
- Acceptance tests the DEPLOYED artifact, not the source code.
- Run `npm test` after any code change. Never commit if tests fail.
```

## Implementation

### Execution plan (3 commits, ~3 hours)

**Commit 1: Move files + update runner** (1h)
- `mkdir -p tests/unit tests/acceptance`
- `git mv` all 16 test files to new locations (see migration map)
- Update `test-runner.mjs` with `--dir` support + recursive scan
- Update `package.json` scripts
- Run `npm test` to verify

**Commit 2: Split test-verify.sh + rename scripts** (1.5h)
- Extract deploy-staging logic from test-verify.sh into `scripts/deploy-staging.sh`
- Extract acceptance check runner into `scripts/run-acceptance-checks.sh`
- Rewrite `scripts/test-acceptance.sh` to call deploy-staging then acceptance
- `git mv scripts/test-acceptance.sh scripts/test-smoke.sh` (old acceptance -> smoke)
- Write new `scripts/test-acceptance.sh` (deploy-staging + acceptance)
- Find-and-replace RQ variables
- Renumber T32 to T25 in `lib/acceptance-checks.sh`
- Extract harness into `lib/test-harness.sh`
- Update `sync-and-build.sh` with separated functions
- Rewrite `tests/CLAUDE.md`
- Run `npm run test:acceptance` to validate

**Commit 3: Update docs + cleanup** (30min)
- Update project `CLAUDE.md` build/test table
- Remove `@tier` annotations from test files
- Remove stale S-/H-/X-/R- ID references
- Delete orphaned `tests/fork/` files
- Update ADR-0023, ADR-0035 references

### Risk

Low. The core change is splitting test-verify.sh into deploy-staging + acceptance. All test logic stays the same -- the checks, the check library, the harness are unchanged. The risk is in the script split, which can be validated by running the full pipeline end-to-end once.

## Consequences

### Positive
- Deploy is a first-class pipeline phase, not hidden inside "verify"
- Tests run at the right time: pre-deploy tests validate code, post-deploy tests validate the artifact
- `npm test` runs in <2s (inner loop), not 1.7s + init test overhead
- Clear failure semantics: unit fail = code bug, acceptance fail = package bug, smoke fail = npm-specific bug
- No more "verify" confusion -- that name is gone
- Pipeline matches industry-standard CI/CD: build -> deploy(staging) -> test -> deploy(prod) -> test
- The Verdaccio -> npm two-stage deployment is explicitly modeled

### Negative
- One-time churn in `git blame` from file moves
- test-verify.sh split requires careful extraction of deploy vs test logic
- Any external references to old script names break (unlikely -- internal project)
- `test:verify` removed (no alias -- clean break from the conflated concept)

## Prior Art

- Google: Small/Medium/Large test classification (principle adopted: hermetic boundary; vocabulary rejected: too abstract)
- Stripe: Unit/Contract/Integration/Acceptance/Smoke (principle adopted: acceptance = test the deployed artifact; Contract withdrawn: requires new tests)
- Netflix: Fast/Slow/Deploy (principle adopted: simplicity; vocabulary refined through debate)
- Microsoft Azure DevOps: Pipeline-gated testing (principle adopted: every phase gates the next)
- Thoughtworks CD: Deployment pipeline as test organization (principle adopted: deploy is a first-class phase, not a test step)
- v2 of this ADR: Rejected. Conflated deploy and test into "verify."

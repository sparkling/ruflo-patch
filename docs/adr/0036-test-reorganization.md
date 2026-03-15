# ADR-0036: Test Suite Reorganization

## Status

Proposed

## Date

2026-03-15

## Deciders

sparkling team, informed by structured hive-mind debate (5 senior testing experts)

## Context

The test suite has grown organically across ADR-0023, ADR-0033, and ADR-0035, producing incoherent organization:

### Problems

1. **Numbering is cargo-cult taxonomy.** Files `04-codemod`, `07-agentdb-tools-activation`, `16-init-structural` -- numbers imply ordering that does not exist. Gaps at 01-03, 11, 20+. Runner ignores numbers (concurrent execution).

2. **Five incompatible ID schemes.** S-01 through S-17 (structural), H-01 through H-14 (helpers), X-01 through X-08 (cross-mode), R-SG001a (regression), T01 through T32 (acceptance, with gap T25-T31). A new hire cannot navigate this.

3. **L0/L1/L2/L3 is confusing.** Nobody remembers whether verify is L2 or L3. The `tests/CLAUDE.md` needs a table to explain it -- proof that it is not self-explanatory.

4. **Init tests are misclassified.** Files 16-19 run `npx` (seconds each) but are tagged `@tier unit` alongside files 04-06 that complete in <200ms. Running `test:unit` in the inner loop pays a multi-second tax.

5. **"RQ" naming persists.** `RQ_PORT`, `rq_pass`, `rq_fail`, `RQ_PARALLEL_DIR`, `RQ_STORAGE` -- legacy "Release Qualification" naming in critical scripts.

6. **Verify vs acceptance confusion.** `test-verify.sh` and `test-acceptance.sh` run the same check functions against different registries. Calling one "verify" and the other "acceptance" creates false semantic distinction.

7. **`test:all` is wrong.** package.json has `"test:all": "... npm run test:acceptance"` -- runs against real npm (L3), but CLAUDE.md says it should be "L0 + L1 + L2".

8. **~200 lines of duplicated bash** between test-verify.sh and test-acceptance.sh (`run_check`, `run_check_bg`, `collect_parallel`, `_escape_json`, result tracking).

9. **No lifecycle model.** The existing ADR ignores the build/test/deploy/test lifecycle entirely. Tests exist in isolation from the pipeline that invokes them.

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
  |        a. Publish to Verdaccio
  |        b. Install from Verdaccio
  |        c. Run 25 acceptance checks (T01-T24, T32)
  |        d. Promote to @latest
  |
  +-- Sync stage:
        1. Fetch upstream
        2. Create sync branch, merge
        3. Type-check, codemod, build
        4. run_tests() -> run_tests_ci() + run_verify()
        5. Create PR
```

---

## Hive-Mind Debate Transcript

### Round 1: Each Expert Presents Their Proposed Organization

---

**EXPERT 1 (Google Staff Engineer -- Test Infrastructure)**

My proposal uses Google's Small/Medium/Large classification, which is the most battle-tested approach in the industry.

**Categories:**

| Size | Boundary | Runtime | What belongs here |
|------|----------|---------|-------------------|
| **Small** | No I/O, no network, no subprocess | <2s total | codemod transforms, pipeline logic, publish ordering, fork-version calculations, all wiring/activation tests (mocked imports) |
| **Medium** | Filesystem OK, subprocess OK, no network | <30s total | Init scaffolding tests (run real `npx`), Verdaccio publish+install cycle |
| **Large** | Network OK, external services OK | <120s total | Real npm registry checks, post-deploy validation |

**Pipeline integration:**

```
commit -> Small tests (gate: merge) -> build -> Medium tests (gate: publish) -> deploy -> Large tests (gate: promote)
```

**Verdaccio handling:** Medium tests own the Verdaccio lifecycle. They publish, install, and run structural checks. Large tests are identical checks pointed at real npm.

**Post-deploy:** Large tests run after `npm publish`. If they fail, you roll back the dist-tag but the version is already on npm (immutable). This is a known constraint.

**Key principle:** If a test spawns a subprocess, it is NOT small. Period. Your init tests (16-19) that run `npx` are Medium, and mixing them with Small tests is a classification error that costs you seconds on every inner-loop iteration.

---

**EXPERT 2 (Stripe Staff Engineer -- SDK/CLI Testing)**

Google's S/M/L is too abstract. It tells you the resource boundary but not the testing intent. When I shipped stripe-cli test infrastructure, we needed to know WHAT we were validating, not just HOW MUCH I/O it does.

**Categories:**

| Category | Purpose | What belongs here |
|----------|---------|-------------------|
| **Unit** | Verify internal logic in isolation | codemod, pipeline-logic, publish-order, fork-version, all wiring tests |
| **Contract** | Verify published package structure matches expectations | Package has correct exports, bin entries, scope names, dependency versions |
| **Integration** | Verify components work together with real I/O | Init scaffolding (runs real npx), Verdaccio publish+install |
| **Acceptance** | Verify the CUSTOMER experience end-to-end | Install from registry, run commands, verify output |
| **Smoke** | Post-deploy sanity | Version resolves, dist-tag correct, no broken versions |

**Pipeline integration:**

```
commit -> Unit (gate: merge)
       -> build
       -> Contract + Integration (gate: publish-to-verdaccio)
       -> Acceptance against Verdaccio (gate: publish-to-npm)
       -> deploy to npm
       -> Smoke against npm (gate: promote dist-tag)
```

**Key insight the others will miss:** You need CONTRACT tests. Right now your acceptance checks mix structural validation (does the package have the right exports?) with functional validation (does `ruflo init` work?). Those are different concerns. A contract test can run against the build artifact BEFORE publishing. An acceptance test runs against the installed package AFTER publishing.

**Verdaccio handling:** Integration tests publish to Verdaccio. Acceptance tests install from Verdaccio and exercise the installed package. Different concerns, different scripts.

---

**EXPERT 3 (Netflix Principal Engineer -- Platform)**

Five categories? Are you kidding me? Nobody is going to remember Unit vs Contract vs Integration vs Acceptance vs Smoke. That is FIVE names for "does our stuff work." Let me count the test files: 16 node:test files and 25 bash checks. This is not a massive codebase. This is a build pipeline for repackaging npm modules.

**Categories:**

| Category | What | When |
|----------|------|------|
| **Fast** | Everything that finishes in <3s with no I/O | Every keystroke |
| **Slow** | Everything else before deploy (init tests, Verdaccio cycle, all 25 checks) | Before deploy |
| **Live** | Same checks against real npm | After deploy |

Three categories. A new hire understands it in 30 seconds, not 5 minutes.

**Pipeline integration:**

```
commit -> Fast (gate: commit) -> build -> Slow (gate: deploy) -> deploy -> Live (gate: promote)
```

**Verdaccio handling:** Part of Slow. Publish, install, check. One script. Done.

**Post-deploy:** Live is the same checks pointed at npmjs.com. If Live fails, you do not promote the dist-tag.

**Key principle:** Your entire codebase is 16 test files and 25 bash checks. You are not Google. You are not Stripe. You are a build pipeline. Stop building a test framework and start shipping.

---

**EXPERT 4 (Microsoft Principal SDET -- Azure DevOps)**

Netflix guy is half right -- simplicity matters. But he is completely wrong about collapsing Verdaccio checks into "Slow." The critical architectural question nobody has answered is: **what gates what?**

**Categories:**

| Stage | Gate for | Tests | Fails -> |
|-------|----------|-------|----------|
| **Preflight** | commit | Config validation, env checks | Cannot commit |
| **Unit** | build | 12 pure logic files (no I/O) | Cannot build |
| **Verify** | publish | Init tests + Verdaccio publish + 25 checks | Cannot publish to npm |
| **Post-deploy** | promote | Same 25 checks against npm | Do not promote dist-tag |

**Pipeline integration -- this is the part everyone else is getting wrong:**

```
Preflight ─┐
           ├─ gate: "safe to build"
Unit ──────┘
           |
         build
           |
Verify ────── gate: "safe to publish"
           |
       npm publish
           |
Post-deploy ── gate: "safe to promote"
           |
     npm dist-tag add @latest
```

**The key insight:** "Verify" is ONE stage that includes init tests, Verdaccio publish, Verdaccio install, and all 25 acceptance checks. Splitting it into Contract + Integration + Acceptance (like Stripe suggests) creates three stages that always run together anyway. If you never run Contract without Integration, they are the same stage.

**Verdaccio handling:** Verify publishes to Verdaccio, installs, runs checks. It is the "can we ship" gate. Full stop.

**Post-deploy is NOT optional.** Every deployment pipeline needs a post-deploy validation gate. The current codebase has `test-acceptance.sh` which does this, but calling it "acceptance" when it runs after deploy is confusing. It is post-deploy validation.

---

**EXPERT 5 (Thoughtworks Tech Lead -- CD/XP Practitioner)**

I agree with Microsoft on the gating model but disagree on naming. Tests should be named by WHERE THEY RUN IN THE PIPELINE, not by testing theory. Nobody cares whether something is a "unit test" or an "integration test" in the abstract. They care: "when does this run and what does it block?"

**Categories:**

| Pipeline Stage | Tests | Feedback time |
|----------------|-------|---------------|
| **commit** | Preflight + pure logic tests | <2s |
| **pre-publish** | Init scaffolding + Verdaccio publish + install + 25 checks | <60s |
| **post-publish** | Same 25 checks against npm | <120s |

**Pipeline integration:**

```
code change
  -> commit tests (automated, every save)
  -> build
  -> pre-publish tests (automated, includes Verdaccio cycle)
  -> npm publish
  -> post-publish tests (automated)
  -> promote dist-tag
```

**Key principle from Continuous Delivery:** The deployment pipeline IS the test organization. You do not need a separate taxonomy. The pipeline stages ARE the categories. When someone asks "what tests do we have?" the answer is: "look at the pipeline."

**Verdaccio handling:** Pre-publish stage. It is the rehearsal for the real publish. Same checks, local registry.

**What I STRONGLY object to in the current state:** The pipeline (`sync-and-build.sh`) runs `run_tests_ci()` which includes ALL 16 test files including the slow init tests. Those init tests (16-19) take seconds each and they are blocking the fast feedback loop. The first fix -- before any renaming -- is to split the runner so fast tests run in <2s and init tests run later.

---

### Round 2: Experts Attack Each Other

---

**EXPERT 3 (Netflix) attacks EXPERT 2 (Stripe):**

Five categories for 16 test files and 25 bash checks. Let me do the math. You want Unit (12 files), Contract (new -- does not exist yet), Integration (4 files), Acceptance (25 checks), and Smoke (subset of the 25 checks). So you are proposing to CREATE a new test category (Contract) and SPLIT an existing one (Acceptance into Acceptance + Smoke) for a project with 441 total test cases. That is one category per 88 tests. The overhead of maintaining five npm scripts, five directory conventions, and five mental categories exceeds the value of the classification.

**EXPERT 2 (Stripe) defends:**

Contract tests are not new test files. They are a reclassification of existing acceptance checks. T01 (`check_version`), T02 (`check_latest_resolves`), T03 (`check_no_broken_versions`) -- those are contract/structural tests. They verify package SHAPE, not package BEHAVIOR. T04-T08 verify init behavior. T09-T10 verify diagnostics. Those are functional acceptance tests. The distinction matters because contract tests CAN run against build artifacts without publishing, saving the entire Verdaccio cycle for fast feedback.

**EXPERT 3 (Netflix) responds:**

Can they though? T01 runs `npm view @sparkleideas/cli version`. That requires a registry. T02 runs `npm view @sparkleideas/cli dist-tags.latest`. Also requires a registry. You cannot run these against build artifacts. Your "contract test" category does not actually work for this project.

**EXPERT 2 (Stripe) concedes:**

Fair point. The existing checks are all registry-dependent. I concede that contract tests as a separate pre-publish category do not work here without writing new tests. I withdraw the Contract category. Four categories: Unit, Integration, Acceptance, Smoke.

---

**EXPERT 1 (Google) attacks EXPERT 5 (Thoughtworks):**

Naming tests by pipeline stage couples your test taxonomy to your pipeline topology. If you add a staging environment, do you rename "pre-publish" to "pre-staging"? If you split the pipeline into parallel tracks, which stage name wins? Pipeline-coupled naming is fragile.

**EXPERT 5 (Thoughtworks) defends:**

In 20 years of CD practice, I have never seen a team rename their test categories because the pipeline changed. What I HAVE seen, hundreds of times, is teams with beautiful abstract taxonomies (Small/Medium/Large, Unit/Contract/Integration/Acceptance/Smoke) where nobody remembers which category a test belongs to. Pipeline stages are concrete. They are visible in CI. When you see `pre-publish` in the build log, you know exactly what is running and why.

**EXPERT 1 (Google) responds:**

The abstraction exists for a reason. "Small" means "hermetic, fast, deterministic" regardless of where it runs. A Small test that runs in pre-publish is still Small. It should also run on commit. The size tells you the PROPERTIES of the test, the stage tells you WHEN it runs. Conflating them loses information.

**EXPERT 5 (Thoughtworks) responds:**

You are adding a dimension that does not help. Every developer on this project already knows that codemod.test.mjs is fast and hermetic. They do not need a "Small" label to tell them that. What they NEED to know is: "if I change this code, which pipeline stage will catch a regression?" The answer is: commit stage. That is the useful information.

---

**EXPERT 4 (Microsoft) attacks EXPERT 3 (Netflix):**

"Fast/Slow/Live" has a fundamental problem: "Slow" conflates two very different failure modes. If an init scaffolding test fails (your `init-structural.test.mjs`), that means the code generator is broken. If a Verdaccio acceptance check fails (`check_memory_lifecycle`), that means the published package is broken. Those are DIFFERENT problems with DIFFERENT fixes, and lumping them into "Slow" means the developer has to inspect the output to figure out what category of breakage occurred.

**EXPERT 3 (Netflix) defends:**

The developer has to inspect the output ANYWAY. Even with your four-category system, a failure in "Verify" could be a publish failure, an install failure, or a check failure. You still have to read the logs. The category name does not tell you the fix. The error message does.

**EXPERT 4 (Microsoft) responds:**

But it tells you WHERE to look. If "Unit" fails, look at your logic. If "Verify" fails, look at the pipeline or the published artifacts. "Slow" tells you nothing.

**EXPERT 3 (Netflix) concedes:**

Okay, I will concede that "Slow" is too broad. But I maintain that three categories is the right number. Let me revise: **Fast** (pure logic), **Publish** (everything in the Verdaccio cycle), **Live** (post-deploy). That gives you the "where to look" signal without the ceremony of four or five categories.

---

**EXPERT 5 (Thoughtworks) attacks EXPERT 4 (Microsoft):**

Your "Preflight" as a separate gate is wrong. Preflight is not a gate -- it is a precondition. If config files are missing, you cannot even run unit tests. Making it a separate named stage implies it has independent value. It does not. It should be a preamble to the unit tests, not a peer category.

**EXPERT 4 (Microsoft) defends:**

It IS a separate thing in the codebase. `scripts/preflight.mjs` is its own script. The pipeline calls it separately. `npm run preflight` is its own command.

**EXPERT 5 (Thoughtworks) responds:**

The fact that it is a separate script does not make it a separate test category. `eslint` is a separate script too. You would not call linting a "test category." Preflight validates that the environment is sane. It is a build precondition, not a test.

**EXPERT 4 (Microsoft) concedes:**

Fine. Preflight is a precondition that runs before unit tests, not a peer category. I fold it into the first stage. Three stages with preflight as a preamble.

---

**EXPERT 2 (Stripe) attacks EXPERT 1 (Google):**

Small/Medium/Large is designed for monorepos with thousands of engineers who need shared vocabulary across teams. This project has one team and 441 tests. Using Google's classification here is like using Kubernetes to deploy a static website. It works, but the impedance mismatch is obvious. Nobody on this team will ever say "run the Small tests." They will say "run the unit tests" or "run npm test."

**EXPERT 1 (Google) concedes:**

Agreed. The S/M/L vocabulary is overkill here. What matters is the PRINCIPLE: tests with no I/O should be separated from tests with I/O, and both should be separated from tests that hit external services. The labels can be anything. I will drop S/M/L and accept whatever names the group converges on, as long as the hermetic boundary is respected.

---

**EXPERT 1 (Google) attacks EXPERT 3 (Netflix revised):**

Your revised "Fast/Publish/Live" still has a problem. Where do the init tests go? They are not "Fast" (they run `npx`, take seconds). They are not "Publish" (they do not involve Verdaccio). You have a classification gap.

**EXPERT 3 (Netflix) responds:**

They go in Publish. They run before publish as part of the "is everything working" gate. The fact that they do not touch Verdaccio does not matter. They are part of the "safe to publish" validation.

**EXPERT 5 (Thoughtworks) interjects:**

This proves Netflix's naming is wrong. "Publish" implies Verdaccio involvement. The init tests have nothing to do with publishing. If the name misleads, it is a bad name.

**EXPERT 3 (Netflix) responds:**

Fine. Call it "Pre-deploy" instead of "Publish." Fast / Pre-deploy / Post-deploy.

---

### Round 3: Consensus Building

---

**EXPERT 4 (Microsoft) opens:**

Let me synthesize. Here is what we all agree on:

1. Three stages, not five (Netflix was right about simplicity, Stripe and I concede)
2. Preflight is a preamble, not a category (Thoughtworks was right)
3. Fast pure-logic tests must be separated from slow I/O tests (Google was right)
4. Tests should be named by what they gate in the pipeline (Thoughtworks was right)
5. The Verdaccio cycle and init tests belong in the same pre-deploy stage (Netflix was right -- they always run together)
6. Post-deploy validation is mandatory and distinct (I was right, everyone agrees)

**EXPERT 1 (Google):**

Agreed on all six. The remaining question is naming. We have three candidate schemes:

- Google: Small / Medium / Large (withdrawn)
- Netflix: Fast / Pre-deploy / Post-deploy
- Microsoft: Unit / Verify / Post-deploy
- Thoughtworks: commit / pre-publish / post-publish

**EXPERT 3 (Netflix):**

Drop all the abstract names. What does a developer actually TYPE? They type `npm test` for fast stuff and `npm run test:verify` for the big gate. Let the npm script names BE the taxonomy. The category IS the command.

**EXPERT 5 (Thoughtworks):**

I strongly support that. The npm script name is the only name that matters. Nobody reads the ADR before running tests. They read `package.json`.

**EXPERT 2 (Stripe):**

Then let us pick npm script names that are self-explanatory:

- `npm test` -- unit tests, fast, every change (implies: pure logic, no I/O)
- `npm run test:integration` -- init tests + Verdaccio cycle + all checks (implies: components working together, real I/O)
- `npm run test:live` -- same checks against real npm (implies: production validation)

Wait. "integration" is a loaded word. It means different things to different people.

**EXPERT 4 (Microsoft):**

Use "verify" instead of "integration." It maps to the existing `test-verify.sh` script, so it is not even a rename. And it clearly means "verify we can ship."

**EXPERT 3 (Netflix):**

But "verify" was one of the confusing names we identified in the problem statement. The confusion was between "verify" and "acceptance."

**EXPERT 4 (Microsoft):**

The confusion was because BOTH existed. With this proposal, there is only "verify" (pre-deploy) and "live" (post-deploy). No "acceptance" to confuse with. The ambiguity disappears when you kill one of the two.

**EXPERT 1 (Google):**

I support that. "verify" is the pre-deploy gate, "live" is the post-deploy gate. Clear, unambiguous, and the developer never has to think about which is which.

**EXPERT 5 (Thoughtworks):**

I accept "verify" over my "pre-publish" proposal. It is shorter and already exists in the codebase.

**EXPERT 2 (Stripe):**

Same. I retract my four-category proposal and accept three. But I want one addition: the init tests (16-19) should be in a separate directory from unit tests even if they are part of the same "verify" stage. The directory structure should reflect the speed boundary so a developer can choose to run just fast tests.

**ALL EXPERTS agree.**

**EXPERT 4 (Microsoft):**

Let me also raise the gating question one more time. We need to be precise:

| Stage | Gates | Meaning of failure |
|-------|-------|-------------------|
| `npm test` | commit/build | Your logic is wrong. Fix the code. |
| `npm run test:verify` | npm publish | The package is not shippable. Could be init, could be structure, could be functionality. |
| `npm run test:live` | dist-tag promotion | The published package has a problem on real npm. Do not promote to @latest. |

**EXPERT 3 (Netflix):**

That is clean. One more thing: the pipeline today runs ALL 16 test files in `run_tests_ci()` before Verdaccio, including the slow init tests. The first concrete improvement is splitting the runner so `npm test` runs only the fast tests (12 files, <2s) and init tests run as part of verify.

**EXPERT 5 (Thoughtworks):**

Agreed. And that is achievable with the existing `test-runner.mjs` by adding `--dir` support. Point it at `tests/unit` for fast tests, `tests/integration` for init tests.

**EXPERT 1 (Google):**

One final concern: the 25 bash acceptance checks currently run twice -- once against Verdaccio (in test-verify.sh) and once against npm (in test-acceptance.sh). Both scripts source the same `lib/acceptance-checks.sh`. That shared library is the right pattern. Keep it. Just rename the consuming scripts.

**ALL EXPERTS agree on final proposal.**

---

## Decision

### Final Consensus: 3 categories, pipeline-gated

Replace L0/L1/L2/L3 with three stages that map directly to pipeline gates:

| Category | Command | Contents | Runtime | Gates |
|----------|---------|----------|---------|-------|
| **unit** | `npm test` | Preflight + 12 pure logic test files (no I/O, no subprocess) | <2s | commit, build |
| **verify** | `npm run test:verify` | 4 init tests + Verdaccio publish + install + 25 acceptance checks | <60s | npm publish |
| **live** | `npm run test:live` | Same 25 checks against real npm | <120s | dist-tag promotion |

**Rules:**
- If it spawns a subprocess or touches the filesystem, it is NOT a unit test
- If it requires a registry (Verdaccio or npm), it is a verify or live test
- Preflight is a preamble to unit tests, not a separate category

### Pipeline lifecycle

```
  code change
       |
  +---------+
  | npm test |  <-- preflight + 12 unit test files (<2s)
  +---------+
       |
   GATE: commit (cannot merge if unit tests fail)
       |
  +---------+
  |  build  |  <-- codemod + compile (cached, ~30s cold)
  +---------+
       |
  +------------------+
  | npm run           |
  | test:verify       |  <-- init tests + verdaccio publish + install + 25 checks
  +------------------+
       |
   GATE: publish (cannot publish to npm if verify fails)
       |
  +-------------+
  | npm publish |  <-- push to npmjs.com
  +-------------+
       |
  +------------------+
  | npm run           |
  | test:live         |  <-- same 25 checks against real npm
  +------------------+
       |
   GATE: promote (do not promote dist-tag if live fails)
       |
  +---------------------+
  | npm dist-tag @latest |
  +---------------------+
```

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
  integration/                       # Runs real CLI, filesystem I/O
    init-structural.test.mjs           (17 it-calls)
    init-helpers.test.mjs              (14 it-calls)
    init-cross-mode.test.mjs           (9 it-calls)
    init-patch-regression.test.mjs     (15 it-calls)
  fixtures/
    init-fixture.mjs
  helpers/
    fixture-factory.mjs
    pipeline-helpers.mjs
  CLAUDE.md                          # Simplified test guide (4 lines)
```

### File naming convention

- **No numeric prefixes.** Descriptive kebab-case names.
- `*-wiring.test.mjs` for mock-based contract tests (was "activation")
- `init-*.test.mjs` for init scaffolding tests
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
| `16-init-structural.test.mjs` | `integration/init-structural.test.mjs` | integration (runs in verify) |
| `17-init-helpers.test.mjs` | `integration/init-helpers.test.mjs` | integration (runs in verify) |
| `18-init-cross-mode.test.mjs` | `integration/init-cross-mode.test.mjs` | integration (runs in verify) |
| `19-init-patch-regression.test.mjs` | `integration/init-patch-regression.test.mjs` | integration (runs in verify) |

### npm scripts

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:init": "node scripts/test-runner.mjs --dir tests/integration",
  "test:verify": "bash scripts/test-verify.sh",
  "test:live": "bash scripts/test-live.sh",
  "test:all": "npm run preflight && npm test && npm run test:init",
  "test:pre-publish": "npm run test:all && npm run build && npm run test:verify",
  "preflight": "node scripts/preflight.mjs"
}
```

**Script renames:**

| Old | New | Purpose |
|-----|-----|---------|
| `test-verify.sh` | `test-verify.sh` | Kept (Verdaccio cycle + 25 checks). Absorbs init test invocation. |
| `test-acceptance.sh` | `test-live.sh` | Renamed. Same checks against real npm. |

**Removed:** `test:unit` (replaced by `npm test`), `test:acceptance` (replaced by `test:live`).

**Added:** `test:init` (run init integration tests standalone, useful for debugging), `test:pre-publish` (full pre-deploy pipeline).

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

### test-runner.mjs change

Add `--dir` argument to scope file discovery:

```javascript
const testDir = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  || args[args.indexOf('--dir') + 1]
  || 'tests';
```

Enable recursive subdirectory scanning (currently reads only one level).

### sync-and-build.sh change

Update `run_tests_ci()` to use `--dir tests/unit`:

```bash
run_tests_ci() {
  log "Running preflight + unit tests"
  npm run preflight --prefix "${PROJECT_DIR}" || { log_error "Preflight failed"; return 1; }
  node "${PROJECT_DIR}/scripts/test-runner.mjs" --dir tests/unit || { log_error "Unit tests failed"; return 1; }
}
```

Init tests move into `run_verify()` (before the Verdaccio cycle):

```bash
run_verify() {
  log "Running init integration tests"
  node "${PROJECT_DIR}/scripts/test-runner.mjs" --dir tests/integration || { log_error "Init tests failed"; return 1; }
  # Then Verdaccio publish + install + 25 checks (existing logic)
  bash "${SCRIPT_DIR}/test-verify.sh" "${args[@]}"
}
```

### Updated tests/CLAUDE.md

```markdown
# Tests

## Commands
- `npm test` -- unit tests (<2s), run after every code change
- `npm run test:verify` -- Verdaccio publish + 25 checks (~60s), before deploy
- `npm run test:live` -- same 25 checks against real npm, after deploy

## Pipeline gates
- Unit fails -> cannot build
- Verify fails -> cannot publish to npm
- Live fails -> do not promote dist-tag to @latest

## Rules
- Run `npm test` after any code change
- Never commit if tests fail
- Run `npm run test:verify` before deploying (needs `npm run build` first)
```

## Implementation

### Execution plan (3 commits, ~3 hours)

**Commit 1: Move files + update runner** (1h)
- `mkdir -p tests/unit tests/integration`
- `git mv` all 16 test files to new locations (see migration map)
- Update `test-runner.mjs` with `--dir` support + recursive scan
- Update `package.json` scripts
- Run `npm test` to verify

**Commit 2: Rename scripts + purge RQ** (1h)
- `git mv scripts/test-acceptance.sh scripts/test-live.sh`
- Find-and-replace RQ variables in test-verify.sh and test-live.sh
- Renumber T32 to T25 in `lib/acceptance-checks.sh`
- Extract harness into `lib/test-harness.sh`
- Update `sync-and-build.sh` (`run_tests_ci` and `run_verify`)
- Rewrite `tests/CLAUDE.md`
- Run `npm run test:verify` to validate

**Commit 3: Update docs + cleanup** (30min)
- Update project `CLAUDE.md` build/test table
- Remove `@tier` annotations from test files
- Remove stale S-/H-/X-/R- ID references
- Delete orphaned `tests/fork/` files
- Update ADR-0023, ADR-0035 references

### Risk

Near zero. No test logic changes. Every change is a `git mv`, string replacement, or 10-line filter addition. The existing test-verify.sh and acceptance-checks.sh are proven stable.

## Consequences

### Positive
- New hire understands the test suite in 30 seconds (3-line CLAUDE.md)
- `npm test` runs in <2s (inner loop), not 1.7s + init overhead
- Pipeline gates are explicit and visible
- No layer numbers to memorize (L0/L1/L2/L3 gone)
- No ID archaeology (5 schemes consolidated to 1)
- Complete lifecycle coverage: build -> test -> deploy -> test
- Clear failure semantics: unit fail = logic bug, verify fail = package bug, live fail = deployment bug

### Negative
- One-time churn in `git blame` from file moves
- Any external references to old filenames break (unlikely -- internal project)
- `test:acceptance` removed (can alias for one release cycle)

## Prior Art

- Google: Small/Medium/Large test classification (principle adopted: hermetic boundary; vocabulary rejected: too abstract)
- Stripe: Unit/Contract/Integration/Acceptance/Smoke (principle adopted: customer-facing validation; vocabulary rejected: too many categories for this project)
- Netflix: Fast/Slow/Deploy (principle adopted: simplicity; vocabulary refined: "Slow" too vague)
- Microsoft Azure DevOps: Pipeline-gated testing (principle adopted: every stage gates a deployment decision)
- Thoughtworks CD: Deployment pipeline as test organization (principle adopted: tests named by pipeline position)

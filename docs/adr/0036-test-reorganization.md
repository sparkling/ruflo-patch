# ADR-0036: Test Suite Reorganization

## Status

Proposed

## Date

2026-03-15

## Deciders

sparkling team (informed by Google, Stripe, Netflix testing expert analysis)

## Context

The test suite has grown organically across ADR-0023, ADR-0033, and ADR-0035, producing incoherent organization:

### Problems

1. **Numbering is cargo-cult taxonomy.** Files `04-codemod`, `07-agentdb-tools-activation`, `16-init-structural` — numbers imply ordering that doesn't exist. Gaps at 01-03, 11, 20. Runner ignores numbers (concurrent execution).

2. **Five incompatible ID schemes.** S-01 through S-17 (structural), H-01 through H-14 (helpers), X-01 through X-08 (cross-mode), R-SG001a (regression), T01 through T32 (acceptance, with gap T25-T31). A new hire cannot navigate this.

3. **L0/L1/L2/L3 is confusing.** Nobody remembers whether verify is L2 or L3. The `tests/CLAUDE.md` needs a table to explain it — proof that it's not self-explanatory.

4. **Init tests are misclassified.** Files 16-19 run `npx` (seconds each) but are tagged `@tier unit` alongside files 04-06 that complete in <200ms. Running `test:unit` in the inner loop pays a multi-second tax.

5. **"RQ" naming persists.** `RQ_PORT`, `rq_pass`, `rq_fail`, `RQ_PARALLEL_DIR`, `RQ_STORAGE` — legacy "Release Qualification" naming in critical scripts.

6. **Verify vs acceptance confusion.** `test-verify.sh` and `test-acceptance.sh` run the same check functions against different registries. Calling one "verify" and the other "acceptance" creates false semantic distinction.

7. **`test:all` is wrong.** package.json has `"test:all": "... npm run test:acceptance"` — runs against real npm (L3), but CLAUDE.md says it should be "L0 + L1 + L2".

8. **~200 lines of duplicated bash** between test-verify.sh and test-acceptance.sh (`run_check`, `run_check_bg`, `collect_parallel`, `_escape_json`, result tracking).

### Current inventory

- 16 unit test files (426 `it()` calls), 1.7s runtime
- 25 bash acceptance checks (T01-T24, T32), ~30s runtime
- Shared check library (`lib/acceptance-checks.sh`)
- Preflight script (`scripts/preflight.mjs`)
- 3 orphaned fork test files (`tests/fork/`)

## Decision

### New classification: 3 categories, descriptive names

Replace L0/L1/L2/L3 with:

| Category | What | Command | When | Target |
|----------|------|---------|------|--------|
| **preflight** | Config/file existence | `npm run preflight` | Every commit | <2s |
| **unit** | Pure logic + mocked contracts | `npm test` | Every commit | <2s |
| **integration** | Init scaffolding (runs real CLI) | `npm run test:init` | Before commit | <15s |
| **deploy** | Publish to Verdaccio + functional checks | `npm run test:deploy` | Before deploy | <60s |
| **live** | Same checks against real npm | `npm run test:live` | After deploy | <120s |

### Directory structure

```
tests/
  unit/                              # Pure logic + mocked contracts (<2s)
    codemod.test.mjs
    pipeline-logic.test.mjs
    publish-order.test.mjs
    fork-version.test.mjs
    agentdb-tools-wiring.test.mjs
    hooks-tools-wiring.test.mjs
    memory-bridge-wiring.test.mjs
    memory-tools-wiring.test.mjs
    controller-registry.test.mjs
    controller-chaos.test.mjs
    controller-properties.test.mjs
    context-synthesize.test.mjs
  integration/                       # Runs real CLI, filesystem I/O (<15s)
    init-structural.test.mjs
    init-helpers.test.mjs
    init-cross-mode.test.mjs
    init-patch-regression.test.mjs
  fixtures/
    init-fixture.mjs
  helpers/
    fixture-factory.mjs
    pipeline-helpers.mjs
  CLAUDE.md                          # Simplified test guide
```

### File naming convention

- **No numeric prefixes.** Descriptive kebab-case names.
- `*-wiring.test.mjs` for mock-based contract tests (was "activation")
- `init-*.test.mjs` for init scaffolding tests
- No `@tier` annotations (directory IS the tier)

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
| `16-init-structural.test.mjs` | `integration/init-structural.test.mjs` | integration |
| `17-init-helpers.test.mjs` | `integration/init-helpers.test.mjs` | integration |
| `18-init-cross-mode.test.mjs` | `integration/init-cross-mode.test.mjs` | integration |
| `19-init-patch-regression.test.mjs` | `integration/init-patch-regression.test.mjs` | integration |

### npm scripts

```json
{
  "test": "npm run preflight && node scripts/test-runner.mjs --dir tests/unit",
  "test:init": "node scripts/test-runner.mjs --dir tests/integration",
  "test:deploy": "bash scripts/test-deploy.sh",
  "test:live": "bash scripts/test-live.sh",
  "test:all": "npm run preflight && npm run test && npm run test:init",
  "test:pre-publish": "npm run test:all && npm run build && npm run test:deploy",
  "preflight": "node scripts/preflight.mjs"
}
```

**Removed:** `test:unit` (replaced by `npm test`), `test:verify` (→ `test:deploy`), `test:acceptance` (→ `test:live`)

### Acceptance check IDs

Drop the gap. Renumber T01-T25 contiguously:

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

Add `--dir` argument to scope discovery:

```javascript
const testDir = args.find(a => a.startsWith('--dir='))?.split('=')[1]
  || args[args.indexOf('--dir') + 1]
  || 'tests';
```

Enable recursive subdirectory scanning (currently only one level).

### Updated tests/CLAUDE.md

```markdown
# Tests

## Commands
- `npm test` — unit tests (<2s), run constantly
- `npm run test:init` — init integration tests (~15s), before commit
- `npm run test:deploy` — publish to Verdaccio + 25 checks (~60s), before deploy
- `npm run test:live` — same 25 checks against real npm, after deploy

## Rules
- Run `npm test` after any code change
- Run `npm run test:all` before committing
- Run `npm run test:deploy` before deploying (needs `npm run build` first)
- Never commit if tests fail
```

## Implementation

### Execution plan (3 commits, ~3 hours)

**Commit 1: Move files + update runner** (1h)
- `mkdir -p tests/unit tests/integration`
- `git mv` all 16 test files to new locations
- Update `test-runner.mjs` with `--dir` support + recursive scan
- Update `package.json` scripts
- Run `npm test` to verify

**Commit 2: Rename scripts + purge RQ** (1h)
- `git mv scripts/test-verify.sh scripts/test-deploy.sh`
- `git mv scripts/test-acceptance.sh scripts/test-live.sh`
- Find-and-replace RQ variables in both scripts
- Renumber T32 → T25
- Extract harness into `lib/test-harness.sh`
- Rewrite `tests/CLAUDE.md`
- Run `npm run test:deploy` to verify

**Commit 3: Update docs + cleanup** (30min)
- Update project `CLAUDE.md` build/test table
- Remove `@tier` annotations
- Remove stale S-/H-/X-/R- ID references from test files
- Update ADR-0033, ADR-0035 references

### Risk

Near zero. No test logic changes. Every change is a `git mv`, string replacement, or 10-line filter addition.

## Consequences

### Positive
- New hire understands the test suite in 1 minute (4-line CLAUDE.md)
- `npm test` runs in <2s (inner loop), not 30s
- No layer numbers to memorize
- No ID archaeology (5 schemes → 1)
- Clear fast/slow separation

### Negative
- One-time churn in `git blame` from file moves
- Any external references to old filenames break (unlikely — internal project)
- `test:verify` and `test:acceptance` removed (can alias for one release)

## Prior Art

- Google: Small/Medium/Large test classification
- Stripe: Unit → Component → Contract → Integration → Smoke
- Netflix: Fast/Slow/Deploy, minimize ceremony

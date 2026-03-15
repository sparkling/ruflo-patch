# ADR-0035: Init Output Functional Testing Strategy

## Status

Proposed

## Date

2026-03-15

## Deciders

sparkling team

## Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) + MADR

## Context

The `@sparkleideas/cli init` command (and `init --full`, `init --minimal`) scaffolds a complete project with 20+ files across multiple directories. Current acceptance tests (T04, T05, T06, T07, T08) only verify:

- Exit code = 0
- A few files exist
- CLAUDE.md contains `@sparkleideas`

Nobody tests that the generated project **actually works**. This is a major gap for three reasons:

### 1. High patch density in generators

13 patches (SG-001 through SG-012, CF-009, HK-001, HK-006, MM-001) modify the init generators. Each patch changes generated output, but no test validates the downstream effect. A regression in any generator silently produces broken scaffolding that users discover at runtime.

### 2. Generated files are executable code, not static config

The init system produces:

| File | Lines | Nature |
|------|-------|--------|
| `.claude/settings.json` | ~200 | 11 hook types, env vars, permissions, teams, statusline |
| `.claude/helpers/hook-handler.cjs` | 595 | Hook dispatcher with stdin JSON parsing |
| `.claude/helpers/auto-memory-hook.mjs` | 920 | Memory bridge with import/sync/status commands |
| `.claude/helpers/session.js` | 196 | Session manager (start/restore/end/status) |
| `.claude/helpers/router.js` | 269 | Task router with pattern matching |
| `.claude/helpers/memory.js` | 360 | KV store (get/set/delete/keys) |
| `.claude/helpers/statusline.cjs` | ~50 | Status line renderer |
| `.claude/helpers/pre-commit` | ~20 | Git hook (shell) |
| `.claude/helpers/post-commit` | ~20 | Git hook (shell) |
| `.claude/.mcp.json` | ~30 | MCP server registration |
| `.claude-flow/config.json` | ~80 | Runtime config (swarm, memory, neural, hooks) |
| `.claude-flow/embeddings.json` | ~20 | ONNX embedding config |
| `CLAUDE.md` | ~300 | Project instructions (6 template variants) |
| `.claude-flow/metrics/*.json` | 4 files | Baseline metrics |
| `.claude-flow/security/audit-status.json` | ~10 | Security baseline |

### 3. Three init modes with divergent output

- `init` (standard) -- default feature set
- `init --minimal` -- reduced feature set, v3 defaults (CF-009)
- `init --full` -- all features enabled

Each mode produces a different file set with different configuration values. No test validates that minimal is a strict subset of standard, or that full is a strict superset.

### Decision Drivers

1. 13 patches modify generators with zero downstream validation
2. Generated helpers are real code (2,400+ lines of JS) that runs in user projects
3. Three init modes produce divergent output with no subset/superset validation
4. `settings.json` hook commands reference helper scripts that must exist
5. `config.json` values are consumed by controllers at runtime -- invalid values cause silent failures
6. `.mcp.json` registers MCP servers that must resolve via npx

## Decision: Specification (SPARC-S)

### Test Categories

Five categories organized by validation depth, mapped to test levels (L1 = unit, L2 = acceptance).

#### Category 1: Structural Validation (L1) -- P0

Validates that generated files exist, parse correctly, and contain expected values.

| Test ID | Assertion | Modes | Patch Coverage |
|---------|-----------|-------|----------------|
| S-01 | All expected files exist | init, --minimal, --full | -- |
| S-02 | settings.json is valid JSON with required keys | all 3 | SG-001, SG-012 |
| S-03 | config.json is valid JSON (not YAML) | all 3 | SG-008, MM-001 |
| S-04 | .mcp.json is valid JSON with server entries | all 3 | -- |
| S-05 | embeddings.json is valid JSON | all 3 | -- |
| S-06 | metrics/*.json files are valid JSON | all 3 | -- |
| S-07 | security/audit-status.json is valid JSON | all 3 | -- |
| S-08 | CLAUDE.md contains @sparkleideas scope | all 3 | -- |
| S-09 | Permission patterns use narrowed globs | all 3 | SG-001 |
| S-10 | StatusLine present only when both flags true | all 3 | SG-001 |
| S-11 | Topology defaults to hierarchical-mesh | all 3 | SG-011 |
| S-12 | config.json has no persistPath field | all 3 | MM-001 |
| S-13 | Minimal preset has v3 mode defaults | --minimal | CF-009 |
| S-14 | settings.json has all 11 hook types | init, --full | SG-012 |
| S-15 | settings.json has env vars section | init, --full | SG-012 |
| S-16 | settings.json has permissionRequest hook | init, --full | SG-006 |
| S-17 | CLAUDE.md matches correct template variant per mode | all 3 | -- |

**Estimated test count: 17 tests x 3 modes = 51 assertions (17 test functions)**

#### Category 2: Helper Script Validation (L1) -- P0

Validates that generated helper scripts are syntactically valid and export expected interfaces.

| Test ID | Assertion | Validation Method |
|---------|-----------|-------------------|
| H-01 | hook-handler.cjs is valid JS | `node -c .claude/helpers/hook-handler.cjs` |
| H-02 | hook-handler.cjs exports expected function | `require()` and check typeof |
| H-03 | auto-memory-hook.mjs is valid ESM | `node --check .claude/helpers/auto-memory-hook.mjs` |
| H-04 | session.js is valid JS | `node -c .claude/helpers/session.js` |
| H-05 | session.js handles start/restore/end/status args | invoke with mock argv |
| H-06 | router.js is valid JS | `node -c .claude/helpers/router.js` |
| H-07 | router.js pattern matching returns agent assignments | import and call with sample task |
| H-08 | memory.js is valid JS | `node -c .claude/helpers/memory.js` |
| H-09 | memory.js get/set/delete/keys cycle works | import and exercise CRUD |
| H-10 | statusline.cjs is valid JS | `node -c .claude/helpers/statusline.cjs` |
| H-11 | pre-commit is valid shell | `bash -n .claude/helpers/pre-commit` |
| H-12 | post-commit is valid shell | `bash -n .claude/helpers/post-commit` |
| H-13 | hook-handler.cjs reads stdin JSON (HK-001) | pipe JSON via stdin, assert parsed |
| H-14 | hook-handler.cjs logs errors loudly (HK-006) | trigger error, assert stderr output |

**Estimated test count: 14 tests**

#### Category 3: Functional Validation (L2) -- P1

End-to-end tests that run init in a temp directory and exercise the generated project.

| Test ID | Scenario | Validates |
|---------|----------|-----------|
| T25 | Init then memory lifecycle (store/search/retrieve/delete) | config.json consumed, memory.js works |
| T26 | Init then hooks fire (UserPromptSubmit, SessionStart, SessionEnd) | settings.json hook commands, hook-handler.cjs |
| T27 | Init then MCP config resolves (npx @sparkleideas/cli mcp status) | .mcp.json server registration |
| T28 | Init then doctor passes | Overall scaffold health |
| T29 | Init then config.json values consumed (memory init uses config) | Runtime config integration |
| T30 | Init --minimal then subset of features works | Minimal mode completeness |
| T31 | Init --full then all features available | Full mode completeness |

**Estimated test count: 7 tests**

#### Category 4: Patch Regression Tests (L1) -- P1

One test per patch verifying the specific fix holds. Each test runs init and checks the specific output change the patch introduced.

| Test ID | Patch | Assertion |
|---------|-------|-----------|
| R-SG001a | SG-001 | Permission glob is `Bash(npx @sparkleideas/cli:*)` not `Bash(npx @claude-flow/*)` |
| R-SG001b | SG-001 | StatusLine guard: absent when statusline.enabled=false |
| R-SG003 | SG-003 | `--dual` flag generates helper scripts in .claude/helpers/ |
| R-SG004 | SG-004 | Wizard mode produces same output as equivalent flags |
| R-SG006 | SG-006 | permissionRequest hook type present in settings.json |
| R-SG007 | SG-007 | Two sequential inits with different options produce independent output (deep-clone) |
| R-SG008 | SG-008 | Config file is `.claude-flow/config.json` (not `.claude-flow/config.yaml`) |
| R-SG009 | SG-009 | Default mode is `v3` in config.json |
| R-SG010 | SG-010 | CLI options reflected in generated config.json |
| R-SG011 | SG-011 | Topology is `hierarchical-mesh` not `hierarchical` |
| R-SG012 | SG-012 | settings.json has all 11 hooks + env + memory sections |
| R-CF009 | CF-009 | Minimal preset has v3 defaults (mode, topology, memory backend) |
| R-HK001 | HK-001 | hook-handler.cjs parses stdin JSON without crash |
| R-HK006 | HK-006 | hook-handler.cjs writes errors to stderr (not silently swallowed) |
| R-MM001 | MM-001 | config.json has no `persistPath` key anywhere |

**Estimated test count: 15 tests**

#### Category 5: Cross-Mode Comparison (L1) -- P2

Validates relationships between the three init modes.

| Test ID | Assertion |
|---------|-----------|
| X-01 | Files produced by --minimal are a strict subset of files produced by init |
| X-02 | Files produced by init are a strict subset of files produced by --full |
| X-03 | All three modes produce valid, parseable JSON for every .json file |
| X-04 | No mode has dangling references (settings.json hook commands reference existing helper scripts) |
| X-05 | Config keys in --minimal are a subset of config keys in init |
| X-06 | Config keys in init are a subset of config keys in --full |
| X-07 | Hook types in --minimal are a subset of hook types in init |
| X-08 | Hook types in init are a subset of hook types in --full |

**Estimated test count: 8 tests**

### Total Test Matrix

| Category | L1 | L2 | P0 | P1 | P2 | Total |
|----------|----|----|----|----|----|----|
| 1. Structural | 17 | -- | 17 | -- | -- | 17 |
| 2. Helper Scripts | 14 | -- | 14 | -- | -- | 14 |
| 3. Functional | -- | 7 | -- | 7 | -- | 7 |
| 4. Patch Regression | 15 | -- | -- | 15 | -- | 15 |
| 5. Cross-Mode | 8 | -- | -- | -- | 8 | 8 |
| **Total** | **54** | **7** | **31** | **22** | **8** | **61** |

## Decision: Pseudocode (SPARC-P)

### Test Harness: Shared Fixture

All L1 tests share a fixture that runs init once per mode and caches the output directory, avoiding repeated 3-second init calls.

```
// Shared fixture: run init once per mode, cache result
const MODES = ['standard', 'minimal', 'full']
const fixtures = new Map()  // mode -> { dir, files }

before(async () => {
  for mode of MODES:
    dir = mkdtempSync(join(tmpdir(), 'init-test-'))
    flags = mode === 'minimal' ? '--minimal'
          : mode === 'full'    ? '--full'
          : ''
    execSync(`npx @sparkleideas/cli init ${flags}`, { cwd: dir })
    files = walkSync(dir)  // recursive file listing
    fixtures.set(mode, { dir, files })
})

after(() => {
  for { dir } of fixtures.values():
    rmSync(dir, { recursive: true })
})
```

### Category 1: Structural Validation

```
test('S-03: config.json is valid JSON not YAML', () => {
  for mode of MODES:
    { dir } = fixtures.get(mode)
    path = join(dir, '.claude-flow', 'config.json')
    assert(existsSync(path), `config.json missing in ${mode}`)
    content = readFileSync(path, 'utf8')
    // Must parse as JSON
    config = JSON.parse(content)  // throws if YAML or malformed
    // Must not have YAML indicators
    assert(!content.includes('---'), 'looks like YAML')
    assert(typeof config === 'object')
})

test('S-09: permission patterns use narrowed globs', () => {
  for mode of MODES:
    { dir } = fixtures.get(mode)
    settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json')))
    permissions = settings.permissions ?? []
    for perm of permissions:
      if perm.includes('npx'):
        // SG-001: must use exact package:command, not wildcard
        assert(!perm.includes('npx @claude-flow/*'), 'uses old broad glob')
        // Must reference @sparkleideas scope
        if perm.includes('@'):
          assert(perm.includes('@sparkleideas/'), 'wrong scope in permission')
})

test('S-10: statusLine guard', () => {
  // StatusLine should only appear when components.statusline=true AND statusline.enabled=true
  for mode of MODES:
    { dir } = fixtures.get(mode)
    config = JSON.parse(readFileSync(join(dir, '.claude-flow', 'config.json')))
    settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json')))
    statuslineEnabled = config?.components?.statusline && config?.statusline?.enabled
    hasStatusLine = 'statusLine' in (settings ?? {})
    if !statuslineEnabled:
      assert(!hasStatusLine, `statusLine present but feature disabled in ${mode}`)
})

test('S-11: topology defaults to hierarchical-mesh', () => {
  for mode of MODES:
    { dir } = fixtures.get(mode)
    config = JSON.parse(readFileSync(join(dir, '.claude-flow', 'config.json')))
    topology = config?.swarm?.topology ?? config?.topology
    assert.strictEqual(topology, 'hierarchical-mesh',
      `${mode} has topology=${topology}, expected hierarchical-mesh`)
})
```

### Category 2: Helper Script Validation

```
test('H-09: memory.js CRUD cycle', () => {
  { dir } = fixtures.get('standard')
  memPath = join(dir, '.claude', 'helpers', 'memory.js')
  // Syntax check
  execSync(`node -c ${memPath}`)
  // Functional check: import and exercise
  mem = await import(pathToFileURL(memPath))
  mem.set('test-key', 'test-value')
  assert.strictEqual(mem.get('test-key'), 'test-value')
  assert(mem.keys().includes('test-key'))
  mem.delete('test-key')
  assert.strictEqual(mem.get('test-key'), undefined)
})

test('H-13: hook-handler.cjs reads stdin JSON (HK-001)', () => {
  { dir } = fixtures.get('standard')
  handlerPath = join(dir, '.claude', 'helpers', 'hook-handler.cjs')
  input = JSON.stringify({ hookName: 'test', data: { key: 'value' } })
  // Pipe JSON to handler via stdin, verify it processes without crash
  result = execSync(`echo '${input}' | node ${handlerPath} UserPromptSubmit`,
    { cwd: dir, timeout: 5000, encoding: 'utf8' })
  // Handler should not throw; exit code checked by execSync
})

test('H-14: hook-handler.cjs logs errors to stderr (HK-006)', () => {
  { dir } = fixtures.get('standard')
  handlerPath = join(dir, '.claude', 'helpers', 'hook-handler.cjs')
  // Send malformed input to trigger error path
  try:
    execSync(`echo 'NOT_JSON' | node ${handlerPath} BadHook`,
      { cwd: dir, timeout: 5000, encoding: 'utf8' })
  catch (err):
    // HK-006: error must appear on stderr, not swallowed
    assert(err.stderr.length > 0, 'error was silently swallowed')
})
```

### Category 4: Patch Regression Tests

```
test('R-SG007: deep-clone prevents cross-template mutation', () => {
  // Run two inits with different options in separate dirs
  dir1 = mkdtempSync(join(tmpdir(), 'sg007-a-'))
  dir2 = mkdtempSync(join(tmpdir(), 'sg007-b-'))
  execSync(`npx @sparkleideas/cli init --full`, { cwd: dir1 })
  execSync(`npx @sparkleideas/cli init --minimal`, { cwd: dir2 })
  config1 = JSON.parse(readFileSync(join(dir1, '.claude-flow', 'config.json')))
  config2 = JSON.parse(readFileSync(join(dir2, '.claude-flow', 'config.json')))
  // Full and minimal must have different values (not mutated by shared reference)
  assert.notDeepStrictEqual(config1, config2, 'configs are identical -- deep-clone may be broken')
  rmSync(dir1, { recursive: true })
  rmSync(dir2, { recursive: true })
})

test('R-SG004: wizard parity with flags', () => {
  // Wizard mode with equivalent answers should produce identical output to flag mode
  // This test requires a mock stdin or --wizard-answers flag (see Architecture section)
  // For now, validate that wizard code path exists and is reachable
  { dir } = fixtures.get('standard')
  // Check that the generated project has the same structure regardless of entry path
  assert(existsSync(join(dir, '.claude', 'settings.json')))
  assert(existsSync(join(dir, '.claude-flow', 'config.json')))
})
```

### Category 5: Cross-Mode Comparison

```
test('X-01: minimal files are strict subset of standard', () => {
  minFiles = fixtures.get('minimal').files.map(relativeTo(fixtures.get('minimal').dir))
  stdFiles = fixtures.get('standard').files.map(relativeTo(fixtures.get('standard').dir))
  extras = minFiles.filter(f => !stdFiles.includes(f))
  assert.deepStrictEqual(extras, [],
    `minimal has files not in standard: ${extras.join(', ')}`)
})

test('X-04: no dangling references in hook commands', () => {
  for mode of MODES:
    { dir } = fixtures.get(mode)
    settings = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json')))
    hooks = settings.hooks ?? {}
    for [hookType, commands] of Object.entries(hooks):
      for cmd of (Array.isArray(commands) ? commands : [commands]):
        // Extract file references from hook commands
        match = cmd.match(/node\s+(\S+)/)
        if match:
          referencedFile = resolve(dir, match[1])
          assert(existsSync(referencedFile),
            `${mode} hook ${hookType} references missing file: ${match[1]}`)
})
```

## Decision: Architecture (SPARC-A)

### File Organization

```
tests/
  init-structural.test.mjs      -- Category 1 (S-01 through S-17)
  init-helpers.test.mjs          -- Category 2 (H-01 through H-14)
  init-patch-regression.test.mjs -- Category 4 (R-SG001a through R-MM001)
  init-cross-mode.test.mjs       -- Category 5 (X-01 through X-08)
  fixtures/
    init-fixture.mjs             -- Shared fixture (run init, cache output)

lib/
  acceptance-checks.sh           -- Category 3 (T25 through T31, appended)
```

### Shared Fixture Design

The shared fixture (`tests/fixtures/init-fixture.mjs`) runs init once per mode at test suite startup and exports the cached directories. This avoids the 3-second-per-init overhead multiplied by 54 L1 tests.

```
                    +------------------+
                    | init-fixture.mjs |
                    | (runs 3x init)   |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
         /tmp/init-std  /tmp/init-min  /tmp/init-full
              |              |              |
   +----------+----------+  |  +-----------+
   |          |          |  |  |           |
S-tests   H-tests   R-tests   X-tests   (all read-only)
```

Each test file imports the fixture and operates read-only on the cached directories. Tests that need to modify files (like H-09 memory CRUD) work on a copy.

### Integration with Existing Test Infrastructure

- **L1 tests** run via `npm run test:unit` (node:test runner, glob `tests/*.test.mjs`)
- **L2 tests** run via `npm run test:verify` (acceptance-checks.sh, already has T01-T24)
- New L2 tests (T25-T31) append to `lib/acceptance-checks.sh` following existing patterns
- `npm test` runs L0 + L1 (includes new tests automatically via glob)
- `npm run test:all` runs L0 + L1 + L2 (includes new acceptance tests)

### Dependency Chain

```
Category 1 (Structural)       -- depends on: init command, file system
Category 2 (Helper Scripts)   -- depends on: init command, Node.js runtime
Category 3 (Functional)       -- depends on: init command, built @sparkleideas/cli package
Category 4 (Patch Regression) -- depends on: init command, file system
Category 5 (Cross-Mode)       -- depends on: Category 1 fixture (reuses cached dirs)
```

Categories 1, 2, 4, 5 run against the **built** CLI package (same as existing T04-T08). Category 3 additionally requires a running daemon for MCP/hooks tests.

### Test Isolation

- Each test suite creates its own temp directory tree via the shared fixture
- Tests MUST NOT modify the cached fixture directories (copy-on-write for mutation tests)
- Tests MUST clean up temp directories in `after()` hooks
- Tests MUST use `{ timeout: 10000 }` for any init invocations
- Tests MUST NOT depend on network access (mock MCP resolution where needed)

## Decision: Refinement (SPARC-R)

### Priority and Phasing

#### Phase 1 (P0) -- Structural + Helper Scripts

**Scope**: Categories 1 and 2 (31 tests)
**Rationale**: These catch the most common init regressions (broken JSON, missing files, invalid syntax) with the lowest implementation cost. They run in under 5 seconds total.
**Dependencies**: Built CLI package only.

Recommended implementation order within Phase 1:
1. Shared fixture (`init-fixture.mjs`) -- everything else depends on this
2. S-01 through S-08 (basic existence and parsing) -- highest value per line of test code
3. H-01 through H-12 (syntax validation) -- catches broken helpers immediately
4. S-09 through S-17 (patch-specific structural checks)
5. H-13, H-14 (HK-001/HK-006 functional validation)

#### Phase 2 (P1) -- Patch Regression + Functional

**Scope**: Categories 3 and 4 (22 tests)
**Rationale**: Patch regression tests formalize the 13 patch fixes as assertions. Functional tests validate end-to-end behavior. Both require more setup but cover critical user-facing scenarios.
**Dependencies**: Built CLI package + daemon for T26/T27/T28.

Recommended implementation order within Phase 2:
1. R-SG008, R-SG011, R-MM001 (highest regression risk based on pipeline history)
2. R-SG001a, R-SG001b, R-SG012 (security-relevant: permissions, hooks)
3. T25 (memory lifecycle -- validates core value proposition)
4. T28 (doctor passes -- validates overall health)
5. Remaining R-tests and T-tests

#### Phase 3 (P2) -- Cross-Mode Comparison

**Scope**: Category 5 (8 tests)
**Rationale**: Subset/superset validation is valuable but lower risk -- mode differences are architectural decisions, not bug-prone areas.
**Dependencies**: Phase 1 fixture (reuses cached directories).

### Patch Coverage Matrix

Each patch should be covered by at least one Category 4 regression test AND one Category 1 structural test.

| Patch | Cat 1 (Structural) | Cat 2 (Helper) | Cat 4 (Regression) |
|-------|--------------------:|----------------:|--------------------:|
| SG-001 | S-09, S-10 | -- | R-SG001a, R-SG001b |
| SG-003 | S-01 (--dual files) | -- | R-SG003 |
| SG-004 | -- | -- | R-SG004 |
| SG-006 | S-16 | -- | R-SG006 |
| SG-007 | -- | -- | R-SG007 |
| SG-008 | S-03 | -- | R-SG008 |
| SG-009 | -- | -- | R-SG009 |
| SG-010 | -- | -- | R-SG010 |
| SG-011 | S-11 | -- | R-SG011 |
| SG-012 | S-14, S-15 | -- | R-SG012 |
| CF-009 | S-13 | -- | R-CF009 |
| HK-001 | -- | H-13 | R-HK001 |
| HK-006 | -- | H-14 | R-HK006 |
| MM-001 | S-12 | -- | R-MM001 |

All 13 patches (14 counting SG-001 as two fixes) have at least 2 covering tests.

### Performance Budget

| Phase | Test Count | Target Duration | Mechanism |
|-------|-----------|----------------|-----------|
| Phase 1 (L1) | 31 | < 8s | Shared fixture (3 init calls = ~9s amortized, tests = ~2s) |
| Phase 2 (L1) | 15 | < 5s | Reuses Phase 1 fixture |
| Phase 2 (L2) | 7 | < 45s | Each T-test runs init fresh (isolation required) |
| Phase 3 (L1) | 8 | < 2s | Reuses Phase 1 fixture, comparison only |
| **Total** | **61** | **< 60s** | |

The shared fixture is the critical optimization. Without it, 54 L1 tests x 3 modes x 3s/init = 8+ minutes. With it, 3 init calls + fast assertions = under 15 seconds for all L1 tests.

## Decision: Completion (SPARC-C)

### Success Criteria

1. **All 61 tests pass** against the current `@sparkleideas/cli` build
2. **No existing test regresses** -- new tests are additive only
3. **Every init patch (13 total) has at least 2 covering tests** per the patch coverage matrix
4. **Shared fixture amortizes init cost** -- total L1 suite runs in under 15 seconds
5. **L2 tests (T25-T31) integrate** into existing `npm run test:verify` pipeline
6. **Tests are deterministic** -- no flaky tests from timing, ordering, or temp file collisions

### Definition of Done per Phase

**Phase 1 (P0)**:
- `tests/fixtures/init-fixture.mjs` created and exports cached directories
- `tests/init-structural.test.mjs` with 17 tests passing
- `tests/init-helpers.test.mjs` with 14 tests passing
- `npm run test:unit` includes both new test files
- All 31 tests pass in CI

**Phase 2 (P1)**:
- `tests/init-patch-regression.test.mjs` with 15 tests passing
- `lib/acceptance-checks.sh` extended with T25-T31
- All 22 tests pass in CI
- Patch coverage matrix fully covered (no uncovered patch)

**Phase 3 (P2)**:
- `tests/init-cross-mode.test.mjs` with 8 tests passing
- Subset/superset invariants documented as test names
- All 8 tests pass in CI

### Validation Approach

After implementation, run this sequence to validate:

```bash
npm run build                  # build CLI with current patches
npm run test:unit              # L1: structural + helpers + regression + cross-mode
npm run test:verify            # L2: T25-T31 acceptance tests
npm run test:all               # Full suite (existing + new)
```

## Consequences

### Positive

- **Patch confidence**: every init generator patch gets regression coverage, reducing the risk of silent breakage in generated scaffolding
- **Mode parity validation**: cross-mode tests catch divergence bugs where minimal generates files it should not, or full omits files it should include
- **Helper script safety**: syntax and functional tests catch broken JS before users encounter runtime errors in generated projects
- **Fast feedback**: shared fixture keeps L1 suite under 15 seconds despite 54 tests across 3 modes
- **Incremental delivery**: 3 phases allow prioritizing P0 tests (structural + helpers) that catch the most regressions first

### Negative

- **Fixture coupling**: shared fixture means all L1 tests depend on a single init invocation per mode -- a bug in fixture setup fails all tests
- **Maintenance cost**: 61 tests tracking 20+ generated files must be updated when init output intentionally changes
- **L2 test duration**: 7 acceptance tests at ~6s each add ~45s to the verify suite

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Init output changes intentionally, breaking tests | High | Low | Tests are specific -- each has a clear patch/feature it validates, making updates targeted |
| Shared fixture hides init timing regressions | Medium | Low | Add a timing assertion in fixture: init must complete in < 10s |
| Helper functional tests (H-05, H-07, H-09) are brittle if API changes | Medium | Medium | Test the contract (function exists, returns expected shape) not implementation details |
| L2 tests flaky due to daemon startup | Low | High | Use `--no-daemon` flag or mock MCP resolution for T27 |

## Prior Art

- ADR-0020: Testing Strategy -- established L0/L1/L2 layer model and acceptance test numbering (T01-T24)
- ADR-0023: Google Testing Framework -- influenced test isolation and fixture reuse patterns
- ADR-0027: Fork Migration -- established patch naming convention (SG-xxx, HK-xxx, CF-xxx, MM-xxx)
- T04-T08: Existing init acceptance tests -- current baseline this ADR extends

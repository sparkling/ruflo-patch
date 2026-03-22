# ADR-0054: RuVector Patch Pipeline

**Status**: Proposed
**Date**: 2026-03-22
**Deciders**: System Architecture
**Methodology**: SPARC + MADR

---

## S - Specification

### Problem

The `@ruvector/*` packages (`@ruvector/rvf`, `@ruvector/gnn`, `@ruvector/attention`,
`@ruvector/rvf-node`, `@ruvector/ruvllm`) are consumed as upstream npm dependencies
by `@sparkleideas/agentic-flow`. Unlike the other 3 forks (ruflo, agentic-flow,
ruv-FANN), the ruvector fork has **no build step and no publish pipeline** — patches
sit in `~/src/forks/ruvector` uncommitted and unpublished.

Three known defects exist (GitHub issues #55-#57 in `sparkling/ruflo-patch`):

| ID | File | Bug | Impact |
|----|------|-----|--------|
| RV-001 | `bin/cli.js` | `force-learn` calls `intel.tick()` which doesn't exist when `skipEngine:true` | Command crashes silently (`\|\| true` guard) |
| RV-002 | `bin/cli.js` | `Intelligence.load()` omits `activeTrajectories` from defaults and return | Trajectories lost across CLI sessions |
| RV-003 | `bin/cli.js` | `trajectory-end` doesn't sync stats counters before save | `neural status` shows stale/zero stats |

Additionally, `@sparkleideas/agentic-flow` depends on upstream `@ruvector/*` from
public npm — not our patched fork. Any fixes we make to the ruvector fork don't
reach users unless we either:
1. Publish patched `@ruvector/*` packages under `@sparkleideas/` scope
2. Bundle the fixes into `@sparkleideas/agentic-flow` directly

### Quality Attributes

| Attribute | Requirement |
|-----------|-------------|
| Consistency | RuVector patches follow the same fork model as ruflo/agentic-flow/ruv-FANN |
| Automation | Patches are built and published by the existing pipeline (no manual steps) |
| Observability | CI verifies ruvector functionality; failures are visible |
| Traceability | Each patch has a GitHub issue, commit, and version bump |

---

## P - Pseudocode (Design)

### 1. Patch the 3 defects in cli.js

```
RV-001: force-learn fix
  REMOVE: skipEngine: true from Intelligence constructor
  ADD: const eng = intel.engine || intel.getEngine()
  CHANGE: intel.tick() → eng.tick()

RV-002: activeTrajectories persistence
  ADD to Intelligence.load() defaults: activeTrajectories: {}
  ADD to loaded data return: activeTrajectories: data.activeTrajectories || {}

RV-003: stats counter sync
  BEFORE intel.save() in trajectory-end handler:
    intel.data.stats.total_trajectories = (intel.data.history || []).length
    intel.data.stats.total_patterns = Object.keys(intel.data.patterns || {}).length
    intel.data.stats.total_memories = (intel.data.memories || []).length
```

### 2. Publish as `@sparkleideas/ruvector`

```
# RuVector has no build step — cli.js is hand-written JS
# Just scope-rename package.json and publish

copy ~/src/forks/ruvector/npm/packages/ruvector/ → build staging
rename package name: ruvector → @sparkleideas/ruvector
bump version: {upstream-version}-patch.N
publish to Verdaccio
```

### 3. Wire into agentic-flow dependencies

```
# In agentic-flow/package.json (or agentic-flow/agentic-flow/package.json):
# Change: "ruvector": "^x.y.z"  (if present)
# Or add: "@sparkleideas/ruvector": "{version}-patch.N"

# In code that imports from ruvector:
# Change: import ... from 'ruvector'
# To:     import ... from '@sparkleideas/ruvector'
# (handled by codemod.mjs scope rename)
```

### 4. Add to pipeline

```
# In scripts/copy-source.sh:
# Add ruvector rsync alongside ruflo, agentic-flow, ruv-FANN

# In scripts/publish.mjs:
# Add @sparkleideas/ruvector to topological publish order (Level 1, no deps)

# In scripts/run-fork-version.sh:
# Add ruvector version bump
```

### 5. Add monitoring

```
# In scripts/test-acceptance.sh:
# Add acceptance check: verify force-learn doesn't crash
# Add acceptance check: verify trajectory persistence across save/load
# Add acceptance check: verify stats counters update after trajectory-end
```

---

## A - Architecture

### Current state

```
Pipeline publishes 4 forks:
  ruflo          → @sparkleideas/cli, @sparkleideas/memory, ... (37 packages)
  agentic-flow   → @sparkleideas/agentdb, @sparkleideas/agentic-flow (2 packages)
  ruv-FANN       → @sparkleideas/ruv-swarm, @sparkleideas/agent-booster (2 packages)
  ruvector       → (NOT PUBLISHED — patches sitting locally)

agentic-flow depends on upstream @ruvector/* from public npm:
  @ruvector/rvf       ^0.2.0
  @ruvector/gnn       ^0.1.25
  @ruvector/rvf-node  ^0.1.7
  @ruvector/ruvllm    ^2.5.1
```

### Target state

```
Pipeline publishes 4 forks:
  ruflo          → @sparkleideas/cli, @sparkleideas/memory, ... (37 packages)
  agentic-flow   → @sparkleideas/agentdb, @sparkleideas/agentic-flow (2 packages)
  ruv-FANN       → @sparkleideas/ruv-swarm, @sparkleideas/agent-booster (2 packages)
  ruvector       → @sparkleideas/ruvector (1 package — the CLI)

agentic-flow depends on @sparkleideas/ruvector (patched) from Verdaccio.
Upstream @ruvector/rvf, @ruvector/gnn, etc. remain as-is (native WASM, no patches needed).
```

### What gets published vs what stays upstream

| Package | Source | Patched? | Publish as |
|---------|--------|----------|------------|
| `ruvector` (CLI) | `~/src/forks/ruvector/npm/packages/ruvector` | Yes (RV-001/002/003) | `@sparkleideas/ruvector` |
| `@ruvector/rvf` | upstream npm | No patches needed | Keep upstream |
| `@ruvector/gnn` | upstream npm | No patches needed | Keep upstream |
| `@ruvector/rvf-node` | upstream npm | No patches needed | Keep upstream |
| `@ruvector/ruvllm` | upstream npm | No patches needed | Keep upstream |
| `@ruvector/attention` | upstream npm | No patches needed | Keep upstream |

Only the CLI package (`ruvector`) has defects. The native WASM packages work correctly.

### Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `cli.js` is hand-written JS, no TypeScript | Low | No tsc step needed; test with node directly |
| RuVector CLI may have undiscovered issues beyond RV-001/002/003 | Low | Acceptance tests catch regressions |
| Scope rename may break internal `require()` paths | Medium | Test import paths after rename |
| `force-learn` fix may change engine initialization behavior | Low | The fix removes `skipEngine:true` which is the bug |

---

## R - Refinement

### Phase 1: Apply patches (3 fixes in 1 file)

All fixes target `/home/claude/src/forks/ruvector/npm/packages/ruvector/bin/cli.js`.

**RV-001** (~3 lines):
- Find the `force-learn` command handler
- Remove `skipEngine: true` from the Intelligence constructor options
- Change `intel.tick()` to use the engine reference

**RV-002** (~2 lines):
- Find `Intelligence.load()` method
- Add `activeTrajectories: {}` to the defaults object
- Add `activeTrajectories: data.activeTrajectories || {}` to the return object

**RV-003** (~4 lines):
- Find the `trajectory-end` handler, after the trajectory is pushed to history
- Add counter sync before `intel.save()`:
  ```javascript
  intel.data.stats.total_trajectories = (intel.data.history || []).length;
  intel.data.stats.total_patterns = Object.keys(intel.data.patterns || {}).length;
  intel.data.stats.total_memories = (intel.data.memories || []).length;
  ```

### Phase 2: Pipeline integration

**`lib/fork-paths.sh`** — add ruvector path constant:
```bash
RUVECTOR_CLI_DIR="$HOME/src/forks/ruvector/npm/packages/ruvector"
```

**`scripts/copy-source.sh`** — add ruvector rsync:
```bash
rsync -a "$RUVECTOR_CLI_DIR/" "$BUILD_DIR/ruvector-cli/"
```

**`scripts/codemod.mjs`** — add scope rename for ruvector:
```javascript
// Rename: "name": "ruvector" → "name": "@sparkleideas/ruvector"
```

**`scripts/publish.mjs`** — add to Level 1 (no internal deps):
```javascript
Level 1: ['@sparkleideas/ruvector', '@sparkleideas/agentdb', ...]
```

**`scripts/run-fork-version.sh`** — add version bump for ruvector.

### Phase 3: Acceptance tests

Add to `lib/acceptance-security-checks.sh`:

```bash
check_ruvector_force_learn() {
  # Verify force-learn doesn't crash (RV-001)
  # Run: claude-flow hooks force-learn --dry-run
  # Assert: exit code 0, no "tick is not a function" error
}

check_ruvector_trajectory_persistence() {
  # Verify trajectories survive save/load (RV-002)
  # Run: trajectory-start → trajectory-step → save → load → check activeTrajectories exists
}

check_ruvector_stats_counters() {
  # Verify stats counters update (RV-003)
  # Run: trajectory-end → neural status → check counters > 0
}
```

Register in `scripts/test-acceptance.sh` under a new `group-ruvector` phase.

### Phase 4: Monitoring

Add to the existing `neural status` command output:
- Show ruvector CLI version
- Show trajectory count from loaded intelligence
- Flag if stats counters are stale (mismatch between counter and actual data length)

---

## C - Completion

### Implementation checklist

- [ ] RV-001: Fix `force-learn` `tick()` crash in `cli.js`
- [ ] RV-002: Fix `activeTrajectories` persistence in `cli.js`
- [ ] RV-003: Fix stats counter sync in `cli.js`
- [ ] Commit patches to ruvector fork, push to `sparkling/RuVector`
- [ ] Add ruvector to `lib/fork-paths.sh`
- [ ] Add ruvector to `scripts/copy-source.sh`
- [ ] Add ruvector scope rename to `scripts/codemod.mjs`
- [ ] Add `@sparkleideas/ruvector` to `scripts/publish.mjs` (Level 1)
- [ ] Add ruvector version bump to `scripts/run-fork-version.sh`
- [ ] Add 3 acceptance tests (`force-learn`, trajectory persistence, stats counters)
- [ ] Deploy and verify 59/59 acceptance (56 existing + 3 new)
- [ ] Close GitHub issues #55, #56, #57
- [ ] Update `config/published-versions.json`

### Estimated effort

| Phase | Files | Lines |
|-------|:-----:|:-----:|
| Patches (cli.js) | 1 | ~10 |
| Pipeline integration | 5 | ~20 |
| Acceptance tests | 2 | ~60 |
| **Total** | **8** | **~90** |

### Success criteria

- `force-learn` exits 0 (no `tick is not a function`)
- `trajectory-start` → save → load → `activeTrajectories` present
- `trajectory-end` → `neural status` shows non-zero counters
- `npm view @sparkleideas/ruvector@latest` resolves on Verdaccio
- 59/59 acceptance (3 new ruvector tests)

---

## Consequences

### Positive

- RuVector CLI patches reach users via the normal publish pipeline
- All 4 forks now follow the same patch-and-publish model
- Intelligence training (`force-learn`, trajectories, stats) works correctly
- Acceptance tests prevent regressions

### Negative

- One more package to maintain in the pipeline
- `cli.js` is hand-written JS — no TypeScript safety net
- Future upstream ruvector CLI changes require manual merge (same as other forks)

## Related

- **ADR-0027**: Fork migration and version overhaul — established the fork model
- **ADR-0038**: Cascading pipeline — established the deploy pipeline
- **ADR-0052**: Config-driven embedding framework — fixed embedding defaults across all packages
- **GitHub issues**: #55 (RV-001), #56 (RV-002), #57 (RV-003) in `sparkling/ruflo-patch`

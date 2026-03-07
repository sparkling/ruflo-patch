# ADR-0022: Full Ecosystem Repackaging

- **Status**: Accepted
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Context

### Specification (SPARC-S)

**Problem**: Users of `@sparkleideas/cli` cannot access the full Claude Flow ecosystem without mixing npm scopes. 24 packages are repackaged today. 18 more exist in upstream source but are not published under `@sparkleideas/*`:

- 3 standalone packages with upstream source (agent-booster, agentdb-onnx, cuda-wasm)
- 15 packages under `ruflo/v3/plugins/` (13 plugins + teammate-plugin + ruvector-upstream)

Users who need any of these must install from `@claude-flow/*` or unscoped npm, creating version incompatibilities with the codemod-renamed `@sparkleideas/cli`.

**Current state** (what is already published under `@sparkleideas/*`):

| Level | Published Packages | Count |
|-------|-------------------|-------|
| 1 | agentdb, agentic-flow, ruv-swarm | 3 |
| 2 | shared, memory, embeddings, codex, aidefence | 5 |
| 3 | neural, hooks, browser, plugins, providers, claims | 6 |
| 4 | guidance, mcp, integration, deployment, swarm, security, performance, testing | 8 |
| 5 | cli, claude-flow | 2 |
| **Total** | | **24** |

These 24 packages already flow through the pipeline (clone → codemod → patch → publish). No changes needed for them.

**What this ADR adds** (18 packages, none published yet):

| Category | Package | Upstream Source Path | Scope |
|----------|---------|---------------------|-------|
| Standalone | `agent-booster` | `agentic-flow/packages/agent-booster/` | Unscoped upstream |
| Standalone | `agentdb-onnx` | `agentic-flow/packages/agentdb-onnx/` | Unscoped upstream |
| Standalone | `cuda-wasm` | `ruv-FANN/cuda-wasm/` | Unscoped upstream |
| Plugin infra | `ruvector-upstream` | `ruflo/v3/plugins/ruvector-upstream/` | `@claude-flow/` |
| Plugin infra | `teammate-plugin` | `ruflo/v3/plugins/teammate-plugin/` | `@claude-flow/` |
| Plugin | `plugin-agentic-qe` | `ruflo/v3/plugins/agentic-qe/` | `@claude-flow/` |
| Plugin | `plugin-code-intelligence` | `ruflo/v3/plugins/code-intelligence/` | `@claude-flow/` |
| Plugin | `plugin-cognitive-kernel` | `ruflo/v3/plugins/cognitive-kernel/` | `@claude-flow/` |
| Plugin | `plugin-financial-risk` | `ruflo/v3/plugins/financial-risk/` | `@claude-flow/` |
| Plugin | `plugin-gastown-bridge` | `ruflo/v3/plugins/gastown-bridge/` | `@claude-flow/` |
| Plugin | `plugin-healthcare-clinical` | `ruflo/v3/plugins/healthcare-clinical/` | `@claude-flow/` |
| Plugin | `plugin-hyperbolic-reasoning` | `ruflo/v3/plugins/hyperbolic-reasoning/` | `@claude-flow/` |
| Plugin | `plugin-legal-contracts` | `ruflo/v3/plugins/legal-contracts/` | `@claude-flow/` |
| Plugin | `plugin-neural-coordination` | `ruflo/v3/plugins/neural-coordination/` | `@claude-flow/` |
| Plugin | `plugin-perf-optimizer` | `ruflo/v3/plugins/perf-optimizer/` | `@claude-flow/` |
| Plugin | `plugin-prime-radiant` | `ruflo/v3/plugins/prime-radiant/` | `@claude-flow/` |
| Plugin | `plugin-quantum-optimizer` | `ruflo/v3/plugins/quantum-optimizer/` | `@claude-flow/` |
| Plugin | `plugin-test-intelligence` | `ruflo/v3/plugins/test-intelligence/` | `@claude-flow/` |

All 18 upstream source paths have been verified to exist with valid `package.json` files.

**Success Criteria**:

1. All 18 new packages published to npm under `@sparkleideas/*`
2. `npm install @sparkleideas/agent-booster` works (Tier 1 routing)
3. `npx @sparkleideas/cli plugins install --name @sparkleideas/plugin-prime-radiant` works
4. No existing `@sparkleideas/*` package breaks
5. Total publish time remains under 5 minutes

## Decision

### Architecture (SPARC-A)

Integration requires changes to three pipeline components:

#### 1. Package discovery (`publish.mjs`)

`publish.mjs` walks the build directory to find each package by name. It needs to know where each package's directory is. The 15 `@claude-flow/*` packages under `ruflo/v3/plugins/` are already handled by the codemod's blanket `@claude-flow/` → `@sparkleideas/` rename. But `publish.mjs` must be able to locate them in the build directory tree.

The 3 unscoped packages (agent-booster, agentdb-onnx, cuda-wasm) need entries in the codemod's `UNSCOPED_MAP` so their `package.json` `name` field gets renamed:

```javascript
// Addition to UNSCOPED_MAP in scripts/codemod.mjs
'agent-booster': '@sparkleideas/agent-booster',
'agentdb-onnx': '@sparkleideas/agentdb-onnx',
'cuda-wasm': '@sparkleideas/cuda-wasm',
```

#### 2. Topological ordering (`LEVELS` array)

New packages are added to the existing LEVELS array at their correct dependency level. No existing packages move.

**Level 1 additions** (no internal `@sparkleideas/*` deps):

| New Package | Why Level 1 |
|-------------|-------------|
| `@sparkleideas/agent-booster` | Self-contained WASM, zero deps |
| `@sparkleideas/agentdb-onnx` | External deps only (onnxruntime-node) |
| `@sparkleideas/cuda-wasm` | Self-contained WASM, zero deps |

**Level 3 addition** (depends on Level 2 packages):

| New Package | Why Level 3 |
|-------------|-------------|
| `@sparkleideas/ruvector-upstream` | WASM bridge, no internal deps but logically grouped with plugins infra |

**Level 4 additions** (depend on `@sparkleideas/plugins` at Level 3):

| New Package | Internal Deps |
|-------------|--------------|
| 13 `plugin-*` packages | `@sparkleideas/plugins` (Level 3) |
| `@sparkleideas/teammate-plugin` | External only (eventemitter3, @ruvnet/bmssp) |

After additions: L1=6, L2=5, L3=7, L4=22, L5=2 = **42 total**.

#### 3. Build pipeline (`sync-and-build.sh` / `publish.mjs`)

`publish.mjs` locates packages by walking the build directory for `package.json` files whose `name` matches the LEVELS entries. For this to work:

1. The upstream source must be copied into the build temp directory (already happens for `ruflo/`, `agentic-flow/`, `ruv-FANN/`)
2. The codemod must rename the scope in each `package.json` (automatic for `@claude-flow/*`; needs UNSCOPED_MAP for the 3 unscoped packages)
3. `publish.mjs` must find the renamed package directory during its walk

**No changes needed to `sync-and-build.sh`** -- it already copies all three upstream repos. The new packages are subdirectories of repos that are already cloned and processed.

**One special case**: `teammate-plugin` is TypeScript-only (no pre-built `dist/`). It needs a `tsc` build step before publish. All other 17 new packages ship pre-built JS or WASM.

### Phased Rollout

The 18 new packages are split into two groups based on pipeline complexity, not dependency level:

**Group A — Automatic (15 `@claude-flow/*` packages):**

These packages live under `ruflo/v3/plugins/`. The codemod's blanket `@claude-flow/` → `@sparkleideas/` replacement handles them automatically. The only work is:

1. Add to LEVELS array at correct level
2. Verify `publish.mjs` locates them in the build directory
3. Publish

Packages: all 13 `plugin-*`, `ruvector-upstream`, `teammate-plugin` (needs tsc)

**Group B — Manual mapping (3 unscoped packages):**

These packages have unscoped names upstream. The codemod needs explicit UNSCOPED_MAP entries to rename them.

1. Add UNSCOPED_MAP entries in `codemod.mjs`
2. Add to LEVELS array at Level 1
3. Verify `publish.mjs` locates them
4. Publish

Packages: `agent-booster`, `agentdb-onnx`, `cuda-wasm`

### Implementation Steps

Each step is concrete, testable, and independent of the others where noted.

#### Step 1: Add UNSCOPED_MAP entries for Group B (codemod.mjs)

Add to `UNSCOPED_MAP` in `scripts/codemod.mjs`:

```javascript
'agent-booster': '@sparkleideas/agent-booster',
'agentdb-onnx': '@sparkleideas/agentdb-onnx',
'cuda-wasm': '@sparkleideas/cuda-wasm',
```

**Verify**: Run codemod against a temp copy of upstream, confirm `package.json` `name` fields are renamed.

#### Step 2: Add all 18 packages to LEVELS array (publish.mjs)

Already done (commit `060d1c1`). The LEVELS array now has 42 packages.

**Verify**: `npm test` passes (91 tests, including topology validation).

#### Step 3: Verify publish.mjs can locate all 18 packages in the build directory

Run a dry-run publish against a codemod'd build directory:

```bash
# Copy upstream, run codemod, then:
node scripts/publish.mjs --build-dir /tmp/build --dry-run
```

All 42 packages should appear in the dry-run output. If any new package reports "directory not found", the build directory structure doesn't match what `publish.mjs` expects — fix the directory walk logic.

#### Step 4: Handle teammate-plugin TypeScript build

`teammate-plugin` has `src/*.ts` but no `dist/`. Before publish:

```bash
cd /tmp/build/ruflo/v3/plugins/teammate-plugin
npx tsc
```

This can be a post-codemod step in `sync-and-build.sh` or a pre-publish hook in `publish.mjs`.

#### Step 5: Publish to Verdaccio (integration test)

Run `scripts/test-integration.sh`. All 42 packages should publish. Phase 8 should show the new packages available in the registry.

#### Step 6: Publish to npm

Run the full pipeline or a targeted `publish.mjs` invocation. New packages get `--access public` (first publish, per ADR-0015).

#### Step 7: Acceptance test

Run `scripts/test-acceptance.sh`. Tests A13-A16 validate agent-booster import, plugins SDK import, and plugin install.

### Packages NOT included

| Package | Reason |
|---------|--------|
| neuro-divergent (5 Rust crates) | Rust ecosystem, no JavaScript interface |
| opencv-rust (4 Rust crates) | Rust/C++ ecosystem, no JavaScript interface |
| agentic-llm | Python/Docker training system, not an npm package |
| @agentic-flow/benchmarks | Internal development benchmarks |
| @agentic-flow/reasoningbank-benchmark | Internal development benchmarks |
| @agentic-flow/quic-tests | Internal test suite |
| nova-medicina | Example application |
| research-swarm | Example application |
| analysis | Example application |
| agentic-jujutsu | Git tooling, not a user-facing package |

### Considered Alternatives

#### Option A: Full Ecosystem Repackaging (chosen)

Integrate all 18 remaining npm-publishable packages. Users get a complete, consistent `@sparkleideas/*` ecosystem.

**Pros**: Eliminates scope fragmentation. All plugins work. Every documented feature becomes accessible.

**Cons**: 18 more packages to maintain. teammate-plugin needs a TypeScript build step. agentdb-onnx and embeddings have large deps (~200MB).

#### Option B: Incremental Per-Package ADRs

One ADR per package, integrated when demand arises.

**Pros**: Minimal complexity at any time.

**Cons**: 18 separate ADRs. Plugins can't ship until Plugin SDK ships, creating hidden ordering. Users wait indefinitely.

#### Option C: Publish Plugin SDK Only

Publish `@sparkleideas/plugins` so upstream `@claude-flow/plugin-*` can be installed alongside.

**Pros**: Unblocks plugins without repackaging each one.

**Cons**: Users still mix scopes. Codemod-renamed imports in `@sparkleideas/cli` may not match `@claude-flow/*` scope that upstream plugins expect.

## Decision Outcome

**Chosen option: Option A -- Full Ecosystem Repackaging**

### Rationale

1. **15 of 18 packages require zero pipeline changes** beyond adding LEVELS entries. The codemod already handles `@claude-flow/*` → `@sparkleideas/*` for the plugin directory. The marginal cost per package is near-zero.

2. **Only 3 packages need codemod changes** (UNSCOPED_MAP entries for agent-booster, agentdb-onnx, cuda-wasm). This is 3 lines of code.

3. **Only 1 package needs a build step** (teammate-plugin TypeScript compilation). All others ship pre-built.

4. **The plugin ecosystem is all-or-nothing.** Plugins depend on `@sparkleideas/plugins` (already published). Once the plugin directories flow through the pipeline, all 13 plugins publish automatically.

### Implementation Checklist

**Step 1 — Codemod (3 lines):**

- [ ] Add `agent-booster`, `agentdb-onnx`, `cuda-wasm` to UNSCOPED_MAP in `scripts/codemod.mjs`
- [ ] Verify: codemod renames their `package.json` `name` fields correctly
- [ ] Update `tests/04-codemod.test.mjs` to cover new UNSCOPED_MAP entries

**Step 2 — LEVELS array (done):**

- [x] Add 18 new packages to LEVELS in `scripts/publish.mjs` (commit `060d1c1`)
- [x] Update `tests/06-publish-order.test.mjs` with new counts and deps (commit `060d1c1`)

*Phase 1 — Standalone packages (Level 1):*

- [x] Add 12 new packages to `LEVELS` array at Level 1 in `scripts/publish.mjs`
- [x] Unit test: all 12 packages appear in LEVELS array (91 tests pass)
- [x] Acceptance test: `import('@sparkleideas/plugins')` resolves, `import('@sparkleideas/agent-booster')` resolves and WASM initializes (A13-A16 added)

*Phase 3 — Plugin infrastructure and plugins (Levels 3-4):*

- [x] Add `@sparkleideas/ruvector-upstream` at Level 3 (WASM bridge layer)
- [x] Add 13 plugin packages at Level 4
- [x] Add `@sparkleideas/teammate-plugin` at Level 4
- [x] Unit test: 15 new packages in LEVELS at correct levels (tests pass)
- [x] Acceptance test: `npx @sparkleideas/cli plugins install --name @sparkleideas/plugin-prime-radiant` works (A16)

*Phase 4 — CUDA/WASM (Level 1):*

- [x] Add `@sparkleideas/cuda-wasm` at Level 1
- [x] Unit test: package in LEVELS (tests pass)

**Step 3 — Build directory discovery:**

- [ ] Run dry-run publish against codemod'd build directory
- [ ] Fix any "directory not found" errors (publish.mjs directory walk may need adjustment for `ruflo/v3/plugins/` path)
- [ ] All 42 packages appear in dry-run output

**Step 4 — teammate-plugin build:**

- [ ] Add `tsc` step for `ruflo/v3/plugins/teammate-plugin/` in build pipeline
- [ ] Verify `dist/` is generated and `main`/`types` fields in package.json point to it

**Step 5 — Integration test:**

- [ ] `scripts/test-integration.sh` publishes all 42 packages to Verdaccio
- [ ] `npm install @sparkleideas/cli` resolves from Verdaccio with all deps
- [ ] Key new packages (agent-booster, plugins, plugin-prime-radiant) available in registry

**Step 6 — Publish to npm:**

- [ ] All 18 new packages published with `--access public` (first publish)
- [ ] `config/published-versions.json` updated with initial versions
- [ ] No existing package versions broken

**Step 7 — Acceptance tests:**

- [x] A13: agent-booster import test added (commit `060d1c1`)
- [x] A14: agent-booster binary test added (commit `060d1c1`)
- [x] A15: plugins SDK import test added (commit `060d1c1`)
- [x] A16: plugin install test added (commit `060d1c1`)
- [ ] All 4 tests pass against published packages

**Documentation (after publish):**

- [ ] Update `docs/unpublished-sources.md` — move integrated packages to published
- [ ] Update `docs/plugin-catalog.md` — change install commands to `@sparkleideas/plugin-*`
- [ ] Update `README.md` — package count 24→42

## Consequences

**Good (user-facing):**

- Complete Claude Flow ecosystem under one npm scope (`@sparkleideas/*`)
- All 14 plugins installable via `npx @sparkleideas/cli plugins install`
- Tier 1 model routing works end-to-end ($0, <1ms for simple edits)
- Custom plugin development enabled via published Plugin SDK

**Bad (user-facing):**

- Users who install agentdb-onnx or embeddings add ~200MB to node_modules
- Security module requires node-gyp for bcrypt native compilation
- Package count increases from 24 to 42

**Neutral:**

- Users who do not install new packages see no change
- Upstream `@claude-flow/*` packages remain available independently
- The codemod handles all scope renaming automatically

---

## References

- [ADR-0014: Topological Publish Order](0014-topological-publish-order.md) -- existing 5-level publish order
- [ADR-0021: Agent Booster Integration](0021-agent-booster-integration.md) -- Tier 1 routing details
- [Unpublished Sources Audit](../unpublished-sources.md) -- package catalog
- [Plugin Catalog](../plugin-catalog.md) -- plugin descriptions

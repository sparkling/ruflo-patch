# ADR-0022: Full Ecosystem Repackaging

- **Status**: Accepted
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Context

### Specification (SPARC-S)

**Problem**: Users of `@sparkleideas/cli` cannot access the full Claude Flow ecosystem without mixing npm scopes. Of the ~38 npm-publishable packages across the three upstream repositories (ruflo, agentic-flow, ruv-FANN), only 24 are repackaged under `@sparkleideas/*`. Users who need the Plugin SDK, browser automation, ONNX embeddings, multi-LLM providers, security hardening, or any of the 14 plugins must install packages from `@claude-flow/*` or unscoped npm, creating:

1. **Version incompatibilities** -- `@claude-flow/plugins@3.0.0-alpha.7` may not be compatible with `@sparkleideas/cli@3.1.0-alpha.25` because the CLI's internal references were codemod-renamed to `@sparkleideas/*` but the upstream plugin still expects `@claude-flow/*`.
2. **Fragmented install experience** -- Users must know which packages live under which scope and manage cross-scope version alignment manually.
3. **Broken feature promises** -- The CLAUDE.md shipped to every user project references capabilities (plugin install, Tier 1 routing, claims, browser automation) that require packages not available in the `@sparkleideas` scope.
4. **Plugin SDK gap** -- All 14 plugins depend on `@claude-flow/plugins` for MCP tool registration. Without the SDK under `@sparkleideas`, none of the plugins can be installed within the repackaged ecosystem.

**Trigger**: The [unpublished-sources.md](../unpublished-sources.md) audit identified 36+ source-only packages and flagged 2 for immediate integration (plugins SDK, agent-booster) with 11 more on monitor. ADR-0021 proposed integrating agent-booster individually. This ADR takes the comprehensive approach: integrate ALL npm-publishable packages in a phased rollout rather than one-off ADRs per package.

**Success Criteria**:

1. All npm-publishable packages from the three upstream repos are available under `@sparkleideas/*`
2. Users can install any Claude Flow package without mixing scopes
3. All 14 plugins installable via `npx @sparkleideas/cli plugins install`
4. Tier 1 model routing (agent-booster) works end-to-end
5. No existing `@sparkleideas/*` package breaks
6. Topological publish order updated and tested
7. Total publish time remains under 5 minutes

### Pseudocode (SPARC-P)

```
DEFINE PHASES = [
  // Phase 1: Foundation (Level 1, no internal deps)
  // Can publish immediately -- all external deps only
  {
    name: "Foundation",
    packages: [
      "@sparkleideas/plugins",         // Plugin SDK, foundation for all 14 plugins
      "@sparkleideas/agent-booster",   // WASM code editor, Tier 1 handler
      "@sparkleideas/claims",          // Issue claiming, work coordination
      "@sparkleideas/codex",           // OpenAI Codex CLI adapter
      "@sparkleideas/security",        // CVE fixes, input validation
      "@sparkleideas/swarm",           // Unified swarm coordination
      "@sparkleideas/testing",         // TDD framework and fixtures
      "@sparkleideas/providers",       // Multi-LLM provider system
      "@sparkleideas/integration",     // Deep agentic-flow bridge
      "@sparkleideas/performance",     // Benchmarking module
      "@sparkleideas/embeddings",      // Multi-provider embeddings
      "@sparkleideas/agentdb-onnx",    // ONNX-accelerated AgentDB
    ],
    level: 1,
    criteria: "Zero internal @sparkleideas/* dependencies"
  },

  // Phase 2: Internal deps (Level 2+)
  // Depend on Phase 1 or existing published packages
  {
    name: "Internal Deps",
    packages: [
      "@sparkleideas/deployment",  // depends on @sparkleideas/shared
      "@sparkleideas/neural",      // depends on @sparkleideas/memory, @ruvector/sona
      "@sparkleideas/browser",     // depends on agentic-flow
    ],
    level: "2-3",
    criteria: "All internal deps published in Phase 1 or already published"
  },

  // Phase 3: Plugins (depend on Plugin SDK from Phase 1)
  // All 14 plugins + ruvector-upstream WASM bridge
  {
    name: "Plugins",
    packages: [
      "@sparkleideas/plugin-agentic-qe",
      "@sparkleideas/plugin-code-intelligence",
      "@sparkleideas/plugin-cognitive-kernel",
      "@sparkleideas/plugin-financial-risk",
      "@sparkleideas/plugin-gastown-bridge",
      "@sparkleideas/plugin-healthcare-clinical",
      "@sparkleideas/plugin-hyperbolic-reasoning",
      "@sparkleideas/plugin-legal-contracts",
      "@sparkleideas/plugin-neural-coordination",
      "@sparkleideas/plugin-perf-optimizer",
      "@sparkleideas/plugin-prime-radiant",
      "@sparkleideas/plugin-quantum-optimizer",
      "@sparkleideas/plugin-test-intelligence",
      "@sparkleideas/teammate-plugin",
      "@sparkleideas/ruvector-upstream",
    ],
    level: "3-4",
    criteria: "Plugin SDK published, ruvector-upstream available"
  },

  // Phase 4: Standalone tools
  {
    name: "Standalone Tools",
    packages: [
      "@sparkleideas/cuda-wasm",  // CUDA-to-WASM transpiler
    ],
    level: 1,
    criteria: "No internal deps, ships compiled WASM"
  }
]

FUNCTION integratePhase(phase):
  FOR package in phase.packages:
    1. Verify upstream source exists and builds
    2. Run codemod (scope rename @claude-flow/* -> @sparkleideas/*)
    3. Handle build step if needed (teammate-plugin: tsc)
    4. Add to LEVELS array at correct topological level
    5. Run unit tests (package appears in LEVELS)
    6. Publish to Verdaccio (integration test)
    7. Verify import resolves (acceptance test)
  RETURN phase.status

FUNCTION rollout():
  // Phases execute sequentially -- each phase depends on the previous
  FOR phase in PHASES:
    result = integratePhase(phase)
    IF result.failed:
      STOP -- do not proceed to next phase
      ghIssueCreate(phase.name, result.errors)
    updatePublishedVersions(phase.packages)
  updateDocumentation()
```

## Decision

### Architecture (SPARC-A)

The updated topological publish order integrates all new packages at their correct dependency levels. Packages within the same level have no mutual dependencies.

**Updated Level 1 -- No internal `@sparkleideas/*` dependencies:**

| Package | Source Repo | Source Path | Key External Deps | Phase |
|---------|------------|-------------|-------------------|-------|
| `@sparkleideas/agentdb` | agentic-flow | `packages/agentdb/` | ruvector, @ruvector/* | (existing) |
| `@sparkleideas/agentic-flow` | agentic-flow | root | @ruvector/* | (existing) |
| `@sparkleideas/ruv-swarm` | ruv-FANN | `ruv-swarm/npm/` | better-sqlite3, ws | (existing) |
| `@sparkleideas/plugins` | ruflo | `v3/@claude-flow/plugins/` | events | Phase 1 |
| `@sparkleideas/agent-booster` | agentic-flow | `packages/agent-booster/` | none (WASM) | Phase 1 |
| `@sparkleideas/claims` | ruflo | `v3/@claude-flow/claims/` | zod | Phase 1 |
| `@sparkleideas/codex` | ruflo | `v3/@claude-flow/codex/` | commander, fs-extra, chalk, inquirer, yaml, toml | Phase 1 |
| `@sparkleideas/security` | ruflo | `v3/@claude-flow/security/` | bcrypt, zod | Phase 1 |
| `@sparkleideas/swarm` | ruflo | `v3/@claude-flow/swarm/` | none | Phase 1 |
| `@sparkleideas/testing` | ruflo | `v3/@claude-flow/testing/` | none (vitest peer) | Phase 1 |
| `@sparkleideas/providers` | ruflo | `v3/@claude-flow/providers/` | events | Phase 1 |
| `@sparkleideas/integration` | ruflo | `v3/@claude-flow/integration/` | none | Phase 1 |
| `@sparkleideas/performance` | ruflo | `v3/@claude-flow/performance/` | @ruvector/attention, @ruvector/sona | Phase 1 |
| `@sparkleideas/agentdb-onnx` | agentic-flow | `packages/agentdb-onnx/` | onnxruntime-node, @xenova/transformers | Phase 1 |
| `@sparkleideas/cuda-wasm` | ruv-FANN | `cuda-wasm/` | none (WASM) | Phase 4 |

**Updated Level 2 -- Depends on Level 1:**

| Package | Key Internal Deps | Phase |
|---------|-------------------|-------|
| `@sparkleideas/shared` | none within scope | (existing) |
| `@sparkleideas/memory` | `@sparkleideas/agentdb` | (existing) |
| `@sparkleideas/embeddings` | none within scope | (existing) |
| `@sparkleideas/codex` | none within scope | (existing) |
| `@sparkleideas/aidefence` | none within scope | (existing) |
| `@sparkleideas/deployment` | `@sparkleideas/shared` | Phase 2 |

**Updated Level 3 -- Depends on Level 2:**

| Package | Key Internal Deps | Phase |
|---------|-------------------|-------|
| `@sparkleideas/neural` | `@sparkleideas/memory`, @ruvector/sona | (existing, verified Phase 2) |
| `@sparkleideas/hooks` | `@sparkleideas/memory`, `@sparkleideas/neural`, `@sparkleideas/shared` | (existing) |
| `@sparkleideas/browser` | agentic-flow | (existing, verified Phase 2) |
| `@sparkleideas/plugins` | none within scope | (existing) |
| `@sparkleideas/providers` | none within scope | (existing) |
| `@sparkleideas/claims` | none within scope | (existing) |
| `@sparkleideas/ruvector-upstream` | none (WASM bridge) | Phase 3 |

**Updated Level 4 -- Depends on Level 3:**

| Package | Key Internal Deps | Phase |
|---------|-------------------|-------|
| `@sparkleideas/guidance` | `@sparkleideas/hooks`, `@sparkleideas/memory`, `@sparkleideas/shared` | (existing) |
| `@sparkleideas/mcp` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/integration` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/deployment` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/swarm` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/security` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/performance` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/testing` | `@sparkleideas/shared` | (existing) |
| `@sparkleideas/plugin-gastown-bridge` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-agentic-qe` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-code-intelligence` | `@sparkleideas/plugins`, `@sparkleideas/ruvector-upstream` | Phase 3 |
| `@sparkleideas/plugin-cognitive-kernel` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-financial-risk` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-healthcare-clinical` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-hyperbolic-reasoning` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-legal-contracts` | `@sparkleideas/plugins`, `@sparkleideas/ruvector-upstream` | Phase 3 |
| `@sparkleideas/plugin-neural-coordination` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-perf-optimizer` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-prime-radiant` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-quantum-optimizer` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/plugin-test-intelligence` | `@sparkleideas/plugins` | Phase 3 |
| `@sparkleideas/teammate-plugin` | eventemitter3, @ruvnet/bmssp | Phase 3 |

**Updated Level 5 -- Root packages:**

| Package | Key Internal Deps | Phase |
|---------|-------------------|-------|
| `@sparkleideas/cli` | everything above | (existing) |
| `@sparkleideas/claude-flow` | `@sparkleideas/cli` | (existing) |
| `ruflo` | `@sparkleideas/claude-flow` | (existing) |

**Complete LEVELS array (updated):**

```javascript
const LEVELS = [
  // Level 1: no internal @sparkleideas/* deps
  [
    '@sparkleideas/agentdb',
    '@sparkleideas/agentic-flow',
    '@sparkleideas/ruv-swarm',
    // Phase 1 additions
    '@sparkleideas/plugins',
    '@sparkleideas/agent-booster',
    '@sparkleideas/claims',
    '@sparkleideas/codex',
    '@sparkleideas/security',
    '@sparkleideas/swarm',
    '@sparkleideas/testing',
    '@sparkleideas/providers',
    '@sparkleideas/integration',
    '@sparkleideas/performance',
    '@sparkleideas/agentdb-onnx',
    // Phase 4
    '@sparkleideas/cuda-wasm',
  ],
  // Level 2: depends on Level 1
  [
    '@sparkleideas/shared',
    '@sparkleideas/memory',
    '@sparkleideas/embeddings',
    '@sparkleideas/codex',
    '@sparkleideas/aidefence',
    // Phase 2 additions
    '@sparkleideas/deployment',
  ],
  // Level 3: depends on Level 2
  [
    '@sparkleideas/neural',
    '@sparkleideas/hooks',
    '@sparkleideas/browser',
    '@sparkleideas/plugins',
    '@sparkleideas/providers',
    '@sparkleideas/claims',
    // Phase 3 additions
    '@sparkleideas/ruvector-upstream',
  ],
  // Level 4: depends on Level 3
  [
    '@sparkleideas/guidance',
    '@sparkleideas/mcp',
    '@sparkleideas/integration',
    '@sparkleideas/deployment',
    '@sparkleideas/swarm',
    '@sparkleideas/security',
    '@sparkleideas/performance',
    '@sparkleideas/testing',
    // Phase 3 plugin additions
    '@sparkleideas/plugin-gastown-bridge',
    '@sparkleideas/plugin-agentic-qe',
    '@sparkleideas/plugin-code-intelligence',
    '@sparkleideas/plugin-cognitive-kernel',
    '@sparkleideas/plugin-financial-risk',
    '@sparkleideas/plugin-healthcare-clinical',
    '@sparkleideas/plugin-hyperbolic-reasoning',
    '@sparkleideas/plugin-legal-contracts',
    '@sparkleideas/plugin-neural-coordination',
    '@sparkleideas/plugin-perf-optimizer',
    '@sparkleideas/plugin-prime-radiant',
    '@sparkleideas/plugin-quantum-optimizer',
    '@sparkleideas/plugin-test-intelligence',
    '@sparkleideas/teammate-plugin',
  ],
  // Level 5: root packages
  [
    '@sparkleideas/cli',
    '@sparkleideas/claude-flow',
    'ruflo',
  ],
];
```

**NOTE on duplicate package names across levels**: Several packages (codex, plugins, providers, claims, etc.) appear in ADR-0014 at one level but their actual dependency analysis places them differently. The existing ADR-0014 LEVELS array already publishes these packages -- the levels listed above reflect their true dependency requirements. Packages that appear at Level 1 in Phase 1 (e.g., `@sparkleideas/plugins` with only `events` as a dep) are correctly placed there even though ADR-0014 listed them at Level 3. The codemod replaces all internal `@sparkleideas/*` ranges with `"*"`, so the level placement is about publish ordering, not version resolution. Packages already in the LEVELS array do not need to be re-added; only truly new packages are inserted.

**Packages NOT included (cannot publish to npm):**

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

### Considered Alternatives

#### Option A: Full Ecosystem Repackaging (chosen)

Integrate all remaining npm-publishable packages in a 4-phase rollout. Users get a complete, consistent `@sparkleideas/*` ecosystem.

**Pros**: Eliminates scope fragmentation. All plugins work natively. Every documented feature becomes accessible. Users install from one scope. One version policy. One support channel.

**Cons**: Increases package count from 24 to ~40+. Increases build pipeline complexity. Some packages have large dependencies (onnxruntime-node ~100MB, @xenova/transformers ~200MB). teammate-plugin requires a TypeScript build step. Maintenance burden increases proportionally.

#### Option B: Incremental Per-Package ADRs

Continue the pattern of ADR-0021 (agent-booster) -- one ADR per package, integrated individually when demand arises.

**Pros**: Minimal complexity at any given time. Each integration is small and testable.

**Cons**: 14+ separate ADRs needed. Plugins cannot be integrated until the Plugin SDK is integrated, creating hidden ordering dependencies between ADRs. Users wait indefinitely for packages that have no individual "demand signal" but collectively form the ecosystem value.

#### Option C: Publish Plugin SDK Only, Let Plugins Stay Upstream

Publish `@sparkleideas/plugins` (the SDK) so that upstream `@claude-flow/plugin-*` packages can be installed alongside `@sparkleideas/cli`.

**Pros**: Unblocks plugin usage without repackaging every plugin.

**Cons**: Users still mix scopes. The codemod-renamed internal references in `@sparkleideas/cli` may not match the `@claude-flow/*` scope that upstream plugins expect. Version drift between scopes is not detectable.

## Decision Outcome

**Chosen option: Option A -- Full Ecosystem Repackaging**

### Rationale (User Perspective)

1. **Scope consistency eliminates a class of bugs.** When a user runs `npx @sparkleideas/cli plugins install --name @claude-flow/plugin-prime-radiant`, the plugin's internal imports reference `@claude-flow/plugins`. But the user's CLI is `@sparkleideas/cli`, which was codemod-renamed. The import may fail silently or produce runtime errors. Repackaging everything under `@sparkleideas/*` ensures all internal references are consistent.

2. **All documented features become real.** The CLAUDE.md shipped to every user project mentions Tier 1 routing (agent-booster), plugin installation, claims, browser automation, multi-LLM providers, and security hardening. Today, only Tier 2/3 routing works. After this ADR, every feature referenced in CLAUDE.md has a corresponding installable `@sparkleideas/*` package.

3. **Plugin ecosystem unlocked.** The 14 plugins represent significant user-facing capabilities: 58 QA agents, semantic code search, hallucination prevention, predictive test selection, browser automation, financial risk analysis. None of these are accessible to `@sparkleideas` users today. Publishing the Plugin SDK (Phase 1) and all plugins (Phase 3) unlocks the entire catalog.

4. **Phased rollout manages risk.** Phase 1 packages have zero internal dependencies -- they are the lowest-risk integration possible. Phases 2-4 build on Phase 1 only after it is validated. Any phase can be delayed without breaking what came before.

5. **Cost savings from Tier 1 routing.** Agent-booster (Phase 1) enables $0, sub-millisecond code transforms for simple edits. For a user whose agents make 100 simple edits per session, this saves $0.02-$1.50 per session in LLM API costs.

### Refinement (SPARC-R)

#### Package-by-Package Analysis

**Phase 1 -- Foundation (12 packages, Level 1):**

| Package | Upstream Version | External Deps | Build Step | Install Size | Risk |
|---------|-----------------|---------------|-----------|-------------|------|
| `@sparkleideas/plugins` | 3.0.0-alpha.7 | events | None (ships JS) | ~50KB | Low |
| `@sparkleideas/agent-booster` | 0.2.2 | none | None (ships WASM) | ~5MB | Low |
| `@sparkleideas/claims` | 3.0.0-alpha.8 | zod | None (ships JS) | ~30KB | Low |
| `@sparkleideas/codex` | 3.0.0-alpha.9 | commander, fs-extra, chalk, inquirer, yaml, toml, @iarna/toml | None (ships JS) | ~200KB | Low |
| `@sparkleideas/security` | 3.0.0-alpha.6 | bcrypt, zod | node-gyp (bcrypt) | ~100KB | **Medium** -- bcrypt requires native compilation |
| `@sparkleideas/swarm` | 3.0.0-alpha.6 | none | None (ships JS) | ~80KB | Low |
| `@sparkleideas/testing` | 3.0.0-alpha.6 | none (vitest peer) | None (ships JS) | ~40KB | Low |
| `@sparkleideas/providers` | 3.0.0-alpha.6 | events | None (ships JS) | ~60KB | Low |
| `@sparkleideas/integration` | 3.0.0-alpha.1 | none | None (ships JS) | ~30KB | Low |
| `@sparkleideas/performance` | 3.0.0-alpha.6 | @ruvector/attention, @ruvector/sona | None (ships JS) | ~50KB | Low |
| `@sparkleideas/embeddings` | 3.0.0-alpha.12 | @xenova/transformers, sql.js | None (ships JS) | ~200MB (with models) | **Medium** -- large dependency |
| `@sparkleideas/agentdb-onnx` | 1.0.0 | onnxruntime-node, @xenova/transformers | None (ships JS) | ~100MB | **Medium** -- platform-specific native binary |

**Phase 2 -- Internal Deps (3 packages, Level 2-3):**

| Package | Upstream Version | Internal Deps | Build Step | Risk |
|---------|-----------------|---------------|-----------|------|
| `@sparkleideas/deployment` | 3.0.0-alpha.7 | @sparkleideas/shared | None (ships JS) | Low |
| `@sparkleideas/neural` | 3.0.0-alpha.7 | @sparkleideas/memory, @ruvector/sona | None (ships JS) | Low |
| `@sparkleideas/browser` | 3.0.0-alpha.2 | agentic-flow (external: agent-browser, zod) | None (ships JS) | Low |

**Phase 3 -- Plugins (15 packages, Level 3-4):**

| Package | Upstream Version | Plugin SDK Dep | WASM Deps | Build Step | Risk |
|---------|-----------------|----------------|-----------|-----------|------|
| `plugin-agentic-qe` | 3.0.0-alpha.4 | Yes | No | None | Low |
| `plugin-code-intelligence` | 3.0.0-alpha.1 | Yes | ruvector-upstream, zod | None | Low |
| `plugin-cognitive-kernel` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-financial-risk` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-gastown-bridge` | 0.1.3 | Yes | Yes | None | Low -- already published upstream |
| `plugin-healthcare-clinical` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-hyperbolic-reasoning` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-legal-contracts` | 3.0.0-alpha.1 | Yes | ruvector-upstream, zod | None | Low |
| `plugin-neural-coordination` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-perf-optimizer` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-prime-radiant` | 0.1.5 | Yes | Optional | None | Low |
| `plugin-quantum-optimizer` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `plugin-test-intelligence` | 3.0.0-alpha.1 | Yes | Optional | None | Low |
| `teammate-plugin` | 1.0.0-alpha.1 | No (standalone) | No | **tsc** (TypeScript) | **Medium** -- only TS-only package |
| `ruvector-upstream` | 3.0.0-alpha.1 | No | WASM binaries | None | Low |

**Phase 4 -- Standalone Tools (1 package, Level 1):**

| Package | Upstream Version | Deps | Build Step | Risk |
|---------|-----------------|------|-----------|------|
| `@sparkleideas/cuda-wasm` | 1.1.1 | none | None (ships compiled WASM) | Low |

#### Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| bcrypt in security module requires node-gyp | Install fails on systems without C++ toolchain | Medium | Document requirement. Consider `bcryptjs` (pure JS) as fallback. Package is optional -- users who don't need security hardening don't install it. |
| @xenova/transformers pulls ~200MB | Slow install, high disk usage | Certain (if installed) | embeddings and agentdb-onnx are optional packages. The CLI's hash embeddings continue to work without them. Document the size in package README. |
| onnxruntime-node has platform-specific binaries | Install fails on unsupported platforms (e.g., Alpine musl) | Low | agentdb-onnx is optional. Standard platforms (Linux glibc, macOS, Windows) are supported. |
| teammate-plugin requires TypeScript compilation | Build pipeline needs tsc step | Certain | Add `tsc` build step for this one package (see ADR-0021). All other packages ship pre-built JS. |
| WASM binaries increase total download size | Users who install everything get ~300MB+ in node_modules | Low (few users install everything) | Packages are independently installable. Only install what you need. |
| Maintenance burden scales with package count | More packages to track for upstream changes | Certain | Codemod handles scope rename automatically. Version bumping is already automated. The incremental cost per package is near-zero once the pipeline supports it. |
| Publish time increases from ~48s to ~120s | Longer CI pipeline | Certain | Still well under the 6-hour build interval. Acceptable trade-off. |

#### User-Facing Impact Summary

| Metric | Before (24 packages) | After (~40+ packages) |
|--------|---------------------|----------------------|
| Packages under `@sparkleideas/*` | 24 | ~40+ |
| Scope mixing required | Yes -- must install `@claude-flow/*` for plugins, agent-booster | No -- everything under `@sparkleideas/*` |
| Installable plugins | 0 (Plugin SDK not available) | 14 |
| Tier 1 routing (agent-booster) | Broken -- `[AGENT_BOOSTER_AVAILABLE]` always false | Working -- $0, <1ms for simple edits |
| Multi-LLM providers | Not available | 6+ providers (Anthropic, OpenAI, Google, Cohere, Ollama, RuVector) |
| ONNX embeddings | Not available | Available -- 75x faster than Transformers.js, cosine similarity 0.6-0.95 |
| Browser automation | Not available | 59 MCP tools for browser control |
| Claims/work coordination | Not available | 17 MCP tools for issue claiming, handoffs, load balancing |
| Security hardening | Not available | CVE fixes, input validation, path security, bcrypt |
| Custom plugin development | Not possible (no SDK) | Possible via `@sparkleideas/plugins` SDK |

### Completion (SPARC-C)

#### Per-Phase Implementation Checklist

**Phase 1 -- Foundation (immediate):**

- [x] Add 12 new packages to `LEVELS` array at Level 1 in `scripts/publish.mjs`
- [ ] Verify codemod handles scope rename for each package
- [ ] Add `@sparkleideas/agent-booster` -- verify WASM binary ships in `dist/`
- [ ] Add `@sparkleideas/plugins` -- verify 8+ export entrypoints resolve
- [ ] Add `@sparkleideas/security` -- document node-gyp requirement for bcrypt
- [ ] Add `@sparkleideas/embeddings` -- document ~200MB dependency footprint
- [ ] Add `@sparkleideas/agentdb-onnx` -- verify onnxruntime-node binary for Linux/macOS/Windows
- [ ] Unit test: all 12 packages appear in LEVELS array
- [ ] Integration test: all 12 packages publish to Verdaccio and resolve
- [ ] Acceptance test: `import('@sparkleideas/plugins')` resolves, `import('@sparkleideas/agent-booster')` resolves and WASM initializes
- [ ] Update `config/published-versions.json` after first publish

**Phase 2 -- Internal Deps (after Phase 1 validated):**

- [ ] Add `@sparkleideas/deployment` at Level 2 (depends on `@sparkleideas/shared`)
- [ ] Add `@sparkleideas/neural` at Level 3 (depends on `@sparkleideas/memory`)
- [ ] Add `@sparkleideas/browser` at Level 3 (depends on agentic-flow)
- [ ] Unit test: 3 new packages in LEVELS at correct levels
- [ ] Integration test: publish to Verdaccio, verify dependency resolution
- [ ] Acceptance test: `import('@sparkleideas/browser')` resolves

**Phase 3 -- Plugins (after Phase 1 validated):**

- [ ] Add `@sparkleideas/ruvector-upstream` at Level 3 (WASM bridge layer)
- [ ] Add 13 plugin packages at Level 4
- [ ] Add `@sparkleideas/teammate-plugin` at Level 4 -- add `tsc` build step per teammate-plugin TypeScript requirement
- [ ] Verify `@sparkleideas/plugin-gastown-bridge` -- already published upstream, confirm repackaging works
- [ ] Unit test: 15 new packages in LEVELS at correct levels
- [ ] Integration test: all 15 publish to Verdaccio
- [ ] Acceptance test: `npx @sparkleideas/cli plugins install --name @sparkleideas/plugin-prime-radiant` works
- [ ] Acceptance test: `import('@sparkleideas/teammate-plugin')` resolves (requires built dist/)

**Phase 4 -- Standalone Tools (independent, can run anytime):**

- [ ] Add `@sparkleideas/cuda-wasm` at Level 1
- [ ] Verify compiled WASM ships in package
- [ ] Unit test: package in LEVELS
- [ ] Integration test: publishes to Verdaccio
- [ ] Acceptance test: `import('@sparkleideas/cuda-wasm')` resolves

#### Required Documentation Updates

| Document | Change |
|----------|--------|
| `docs/unpublished-sources.md` | Move all Phase 1-4 packages from unpublished to published. Update recommendations from "Monitor"/"Skip" to "Done". |
| `docs/ruvnet.packages.and.source.location.md` | Add all new packages to Matrix 2 (published packages). Move from Matrix 3 (unpublished) to Matrix 2. Update Matrix 4 integration recommendations. |
| `docs/plugin-catalog.md` | Update all plugin install commands from `@claude-flow/plugin-*` to `@sparkleideas/plugin-*`. Remove "Not yet repackaged" notes. |
| `README.md` | Update package count from 24 to ~40+. Mention plugin ecosystem availability. |
| `CLAUDE.md` | Update CLI examples to show `@sparkleideas/cli plugins install`. Update Tier 1 routing row to reference `@sparkleideas/agent-booster`. |

#### Required Test Updates

| Layer | Test File | What to Add |
|-------|-----------|-------------|
| **Unit** | `tests/06-publish-order.test.mjs` | Verify all new packages appear in LEVELS at correct topological levels |
| **Integration** | `scripts/test-integration.sh` Phase 8 | All new packages publish to Verdaccio, `npm install` resolves, binaries present |
| **Acceptance** | `scripts/test-acceptance.sh` | `test_a13_agent_booster()` -- WASM initializes, simple transform works |
| **Acceptance** | `scripts/test-acceptance.sh` | `test_a14_plugins_sdk()` -- Plugin SDK importable, tool builder API accessible |
| **Acceptance** | `scripts/test-acceptance.sh` | `test_a15_plugin_install()` -- `npx @sparkleideas/cli plugins install` resolves a plugin |
| **Acceptance** | `scripts/test-acceptance.sh` | `test_a16_teammate_plugin()` -- TypeScript-built plugin importable |

## Consequences

**Good (user-facing):**

- Complete Claude Flow ecosystem available under one npm scope (`@sparkleideas/*`)
- No more scope mixing -- all packages install, resolve, and interoperate consistently
- All 14 plugins installable via `npx @sparkleideas/cli plugins install`
- Tier 1 model routing works end-to-end -- $0, <1ms code transforms for simple edits
- Multi-LLM provider support (6+ providers) available for multi-model architectures
- ONNX embeddings available for high-quality semantic search (cosine similarity 0.6-0.95 vs hash embeddings 0.1-0.28)
- Browser automation (59 MCP tools) accessible within the repackaged ecosystem
- Claims and work coordination (17 MCP tools) for multi-agent task management
- Security hardening (CVE fixes, input validation, bcrypt) available
- Custom plugin development enabled via published Plugin SDK

**Bad (user-facing):**

- Users who install heavy optional packages (embeddings, agentdb-onnx) add ~200-300MB to node_modules
- Security module requires node-gyp toolchain for bcrypt native compilation
- Package count increases from 24 to ~40+, which may feel overwhelming in `npm ls` output

**Neutral:**

- Users who do not install new packages see no change in behavior
- Upstream `@claude-flow/*` packages remain available independently
- Phased rollout means not all packages arrive at once -- users can adopt incrementally
- The codemod handles all scope renaming automatically -- no manual intervention per package

---

## References

- [ADR-0014: Topological Publish Order](0014-topological-publish-order.md) -- existing 5-level publish order
- [ADR-0021: Agent Booster Integration](0021-agent-booster-integration.md) -- Tier 1 routing, individual integration proposal
- [Unpublished Sources Audit](../unpublished-sources.md) -- comprehensive catalog of all unpublished packages
- [Plugin Catalog](../plugin-catalog.md) -- detailed descriptions of all 14 plugins
- [Package and Source Location Map](../ruvnet.packages.and.source.location.md) -- complete package matrix across 3 repos

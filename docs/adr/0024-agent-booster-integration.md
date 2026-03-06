# ADR-0024: Agent Booster Integration

- **Status**: Proposed
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## SPARC Framework

### Specification

**Problem**: The `agent-booster` package (v0.2.2) is the designated Tier 1 handler in ADR-026's 3-Tier Model Routing system. It provides sub-millisecond, zero-cost code transformations via Rust/WebAssembly -- 52x faster than Morph LLM and 350x faster than LLM-based code editing. The CLI's CLAUDE.md already instructs agents to check for `[AGENT_BOOSTER_AVAILABLE]` before spawning LLM agents, and to use the Edit tool directly when available. However, `agent-booster` is not published under the `@sparkleideas/*` scope. Users of `@sparkleideas/cli` cannot benefit from Tier 1 routing without manually installing the upstream `@claude-flow/agent-booster` or `agent-booster` package, breaking scope consistency and defeating the purpose of a unified distribution.

**Trigger**: The [unpublished-sources.md](../unpublished-sources.md) audit identified `agent-booster` as "Integrate Now" -- one of only two packages (alongside Plugin SDK) recommended for immediate integration. ADR-026 (3-Tier Model Routing, referenced in CLAUDE.md) explicitly depends on it as the Tier 1 handler. Without it in the `@sparkleideas` scope, the 3-tier system cannot work end-to-end with `@sparkleideas` packages.

**Success Criteria**:
1. `@sparkleideas/agent-booster` published to npm and installable via `npx @sparkleideas/agent-booster`
2. No existing `@sparkleideas/*` package breaks
3. Binary entries (`agent-booster`, `agent-booster-server`) resolve correctly after install
4. Codemod correctly renames any `@claude-flow/` references in the package source
5. The CLI's `[AGENT_BOOSTER_AVAILABLE]` check can discover the `@sparkleideas`-scoped package
6. Integration test validates the new package in the dependency tree

### Pseudocode

```
Phase 1: Verify source in existing clone
  1. agent-booster is at agentic-flow/packages/agent-booster/
  2. sync-and-build.sh already clones ruvnet/agentic-flow
  3. No new repo clone needed

Phase 2: Pre-built verification
  1. Check for dist/ directory in packages/agent-booster/
  2. Verify package.json bin entries point to existing files in dist/
  3. IF bin paths are broken:
       Strip missing bin entries (publish.mjs already handles this)
  4. No build step needed — ships pre-built WASM + JS

Phase 3: Add to publish pipeline
  1. Add @sparkleideas/agent-booster to LEVELS[0] (Level 1) in publish.mjs
  2. Codemod handles scope rename (@claude-flow/* -> @sparkleideas/*)
  3. Codemod replaces internal dep ranges with "*" (if any — agent-booster has none)

Phase 4: Test
  Unit: Verify package appears in publish order
  Integration: Verdaccio publishes it, npm install resolves it
  Acceptance: Binary entries execute without error
  Idempotency: Re-publish is a no-op (already-published check)

Phase 5: Update metadata
  1. Update published-versions.json after first publish
  2. Update README package count (25 -> 26 if ADR-0023 also accepted, else 25)
```

### Architecture

The agent-booster package has **zero internal `@claude-flow/*` dependencies**. It is a self-contained Rust/WASM binary with JavaScript bindings. It belongs at **Level 1** in the topological publish order.

```
                        @sparkleideas/cli (L5)
                                |
                  @sparkleideas/guidance (L4)
                                |
                   @sparkleideas/hooks (L3)
                                |
                  @sparkleideas/shared (L2)
                                |
       +------------------------------------------+
       |        Level 1 (no internal deps)         |
       |                                           |
       |  @sparkleideas/agentdb                    |
       |  @sparkleideas/agentic-flow               |
       |  @sparkleideas/ruv-swarm                  |
       |  @sparkleideas/agent-booster  <--- NEW    |
       +------------------------------------------+
                        |
                 external deps only
            (Rust/WASM pre-compiled, no npm deps)
```

**Updated Level 1 package count**: 3 -> 4 packages.

**Source location**: The `agentic-flow` repository (`ruvnet/agentic-flow`) is already cloned by `sync-and-build.sh` as part of the existing build pipeline. The agent-booster source lives at `agentic-flow/packages/agent-booster/` alongside `agentdb` and `agentic-flow` -- no additional repository or clone step is required.

**Relationship to ADR-026 (3-Tier Model Routing)**:

```
Tier 1: agent-booster (WASM)     <1ms   $0        Simple transforms
        ^^^^^^^^^^^^^^^^^^ THIS PACKAGE
Tier 2: Haiku                   ~500ms  $0.0002   Low-complexity tasks
Tier 3: Sonnet/Opus              2-5s   $0.003+   Complex reasoning
```

With agent-booster published under `@sparkleideas`, the full 3-tier routing pipeline works within a single scope. The CLI checks `[AGENT_BOOSTER_AVAILABLE]`, and if the `@sparkleideas/agent-booster` package is installed, Tier 1 transformations bypass LLM calls entirely.

**Morph LLM API compatibility**: The `agent-booster-server` binary exposes an API server compatible with the Morph LLM protocol. This means it can serve as a drop-in replacement for any tool or integration that speaks the Morph API, providing the same code editing capabilities at zero cost and sub-millisecond latency.

### Refinement

#### Source Analysis

| Property | Value |
|----------|-------|
| **Upstream package** | `agent-booster` (unscoped) |
| **Upstream version** | `0.2.2` |
| **Source repo** | `github.com/ruvnet/agentic-flow` |
| **Source path** | `packages/agent-booster/` |
| **Repackaged as** | `@sparkleideas/agent-booster` |
| **Dependencies** | None (Rust/WASM compiled, self-contained) |
| **Peer deps** | None |
| **Internal deps** | None |
| **Binaries** | `agent-booster`, `agent-booster-server` |
| **Build required** | No -- ships pre-built `dist/` with WASM + JS |
| **MCP tools** | Yes -- Claude Desktop, Cursor, VS Code integration |
| **Topological level** | Level 1 |

#### Capability Summary

| Capability | Description |
|-----------|-------------|
| Code editing | Sub-millisecond code transformations (var->const, add types, rename, etc.) |
| Speed | 52x faster than Morph LLM, 350x faster than LLM-based alternatives |
| Accuracy | 100% deterministic results (no LLM hallucination) |
| Cost | $0 -- fully local, zero API calls |
| API server | Morph LLM protocol compatible (`agent-booster-server` binary) |
| MCP integration | Tools for Claude Desktop, Cursor, VS Code |
| Processing | 100% local, no network dependency |

#### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| WASM binary size increases package size | Certain | Low | WASM binaries are typically 1-5 MB compressed. npm handles this fine. |
| Platform compatibility (WASM) | Low | Low | WASM runs in any Node.js >= 16 environment. No native compilation needed at install time. |
| Bin entry paths broken in dist/ | Medium | Medium | `publish.mjs` already strips missing bin entries before publish. Verify during integration test. |
| Upstream changes package structure | Low | Medium | Version is pinned. Same risk as all other upstream packages. |
| Increases package count from 25 -> 26 | Certain | Low | Unit tests updated. Integration test validates. (25 -> 26 if ADR-0023 Plugin SDK also accepted; otherwise 24 -> 25.) |
| Codemod renames references incorrectly | Low | Low | Package has no internal `@claude-flow/*` imports. Only documentation references may exist. |

#### Pre-built Check

```
agentic-flow/packages/agent-booster/
+-- src/              <- Rust/JS source
+-- dist/             <- Pre-built WASM + JS (PRESENT)
+-- package.json      <- bin: agent-booster, agent-booster-server
+-- README.md
```

**Key finding**: Unlike `teammate-plugin` (ADR-0021, which required a TypeScript build step and was deferred partly for that reason), `agent-booster` ships with a pre-built `dist/` directory containing compiled WASM and JavaScript. **No build step is required.** This places it in the same category as `agentdb`, `agentic-flow`, and `ruv-swarm` -- packages that can be published directly after codemod scope rename.

### Completion

#### Decision Drivers

1. **ADR-026 dependency** -- The 3-Tier Model Routing system explicitly names agent-booster as the Tier 1 handler. Without it in `@sparkleideas` scope, Tier 1 is non-functional for `@sparkleideas` users.
2. **CLI already references it** -- CLAUDE.md instructs agents to check `[AGENT_BOOSTER_AVAILABLE]`. Publishing it completes the integration loop.
3. **Zero internal deps** -- No `@claude-flow/*` or `@sparkleideas/*` dependencies. Lowest-risk integration possible.
4. **Ships pre-built** -- No build step needed. Same integration pattern as the 3 existing Level 1 packages.
5. **Already cloned** -- `sync-and-build.sh` already clones `ruvnet/agentic-flow`. The package is sitting in `packages/agent-booster/` alongside `agentdb` and `agentic-flow`.
6. **High value** -- Enables $0, sub-millisecond code transformations. Morph LLM API compatibility provides drop-in replacement capability.
7. **Source audit recommendation** -- [unpublished-sources.md](../unpublished-sources.md) rated this "Integrate Now".

#### Considered Options

##### Option A: Integrate Now

Add `@sparkleideas/agent-booster` to the publish pipeline immediately:

1. Add to `LEVELS[0]` (Level 1) in `publish.mjs`
2. Codemod handles scope rename automatically
3. Verify bin entries resolve to existing files in `dist/`
4. Publish alongside other Level 1 packages
5. Add acceptance test for binary execution

**Pros**: Completes ADR-026 Tier 1 routing. Zero pipeline complexity (no build step). Lowest risk of any integration candidate. Already cloned by existing pipeline.
**Cons**: Increases package count. WASM binary adds to total download size.

##### Option B: Defer Until CLI Adds Dependency

Wait for `@claude-flow/cli` to formally add `agent-booster` as a dependency or optional dependency.

**Pros**: Conservative approach. Zero risk.
**Cons**: ADR-026 Tier 1 routing remains broken for `@sparkleideas` users. The CLI already checks for `[AGENT_BOOSTER_AVAILABLE]` -- the integration contract exists, only the package is missing.

##### Option C: Publish as Separate Unscoped Package

Publish as `agent-booster` (unscoped) rather than `@sparkleideas/agent-booster`.

**Pros**: Matches upstream naming.
**Cons**: Breaks scope consistency. Users must know to install an unscoped package alongside `@sparkleideas/*` packages. Codemod cannot manage it.

## Decision

**Chosen option: Option A -- Integrate Now**

### Rationale

1. **The integration contract already exists.** The CLI's CLAUDE.md documents `[AGENT_BOOSTER_AVAILABLE]` checks and Tier 1 routing. The only missing piece is the package itself under the `@sparkleideas` scope. This is not a speculative integration -- it completes an existing, documented system.

2. **Minimal integration effort.** Agent-booster shares the exact same integration pattern as the 3 existing Level 1 packages (`agentdb`, `agentic-flow`, `ruv-swarm`):
   - Source already cloned by `sync-and-build.sh`
   - Ships pre-built `dist/` (no build step)
   - Zero internal dependencies (Level 1)
   - Codemod handles any scope references

3. **High value, low risk.** Unlike `teammate-plugin` (deferred in ADR-0021 because it required a TypeScript build step, had no current dependents, and had unclear user demand), agent-booster has an existing integration contract (ADR-026), ships pre-built, and provides measurable value ($0 cost, 52x speed improvement for Tier 1 tasks).

4. **Source audit consensus.** The [unpublished-sources.md](../unpublished-sources.md) analysis placed agent-booster in the "Integrate Now" category alongside Plugin SDK -- the only two packages out of 36+ unpublished sources recommended for immediate integration.

### Implementation Plan

```bash
# 1. Verify dist/ exists in the agentic-flow clone
ls "${TEMP_BUILD}/agentic-flow/packages/agent-booster/dist/"

# 2. Verify bin entries in package.json point to existing files
cat "${TEMP_BUILD}/agentic-flow/packages/agent-booster/package.json" | jq '.bin'
# Expected: { "agent-booster": "dist/...", "agent-booster-server": "dist/..." }

# 3. Add to publish.mjs LEVELS array at Level 1
# Level 1 (no internal deps):
['@sparkleideas/agentdb', '@sparkleideas/agentic-flow', '@sparkleideas/ruv-swarm',
 '@sparkleideas/agent-booster']  # <-- add here

# 4. Codemod runs automatically (handles any @claude-flow/ references)
# No manual scope changes needed

# 5. publish.mjs strips missing bin entries if any paths are broken
# This is the existing safety net for all packages

# 6. Add acceptance test
# test_aXX_agent_booster() in test-acceptance.sh:
#   npm install @sparkleideas/agent-booster
#   npx agent-booster --version  # verify binary works

# 7. Update published-versions.json after first publish

# 8. Update README package count
```

### Consequences

**Good:**
- Completes the 3-Tier Model Routing (ADR-026) end-to-end within the `@sparkleideas` scope
- Users of `@sparkleideas/cli` can leverage Tier 1 routing without mixing scopes
- Zero pipeline complexity added (no build step, no new repo clone)
- Morph LLM API compatibility provides additional value as a drop-in code editing server
- Sub-millisecond, zero-cost code transformations become available to all `@sparkleideas` users
- Package count increases to 25 (or 26 if ADR-0023 Plugin SDK is also accepted)

**Bad:**
- WASM binary increases total download size for users who install the package (typically 1-5 MB)
- One more package to maintain version tracking for in `published-versions.json`

**Neutral:**
- The package continues to be available upstream as `agent-booster` (unscoped) on npm
- Binary names (`agent-booster`, `agent-booster-server`) remain unchanged regardless of npm scope

---

## References

- Source: `github.com/ruvnet/agentic-flow/packages/agent-booster/`
- ADR-026: 3-Tier Model Routing (upstream, referenced in CLAUDE.md)
- Related: [ADR-0014 Topological Publish Order](0014-topological-publish-order.md)
- Related: [ADR-0021 Teammate Plugin Integration](0021-teammate-plugin-integration.md) (comparison: deferred due to build step)
- Related: [Unpublished Sources Audit](../unpublished-sources.md) -- "Integrate Now" recommendation
- Related: CLAUDE.md `[AGENT_BOOSTER_AVAILABLE]` and `[TASK_MODEL_RECOMMENDATION]` directives

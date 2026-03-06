# ADR-0021: Teammate Plugin Integration

- **Status**: Proposed
- **Date**: 2026-03-06
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## SPARC Framework

### Specification

**Problem**: The `@claude-flow/teammate-plugin` bridges Claude Code v2.1.19+ native TeammateTool with Claude Flow's swarm system. It is published upstream at `@claude-flow/teammate-plugin@1.0.0-alpha.1` but is NOT repackaged by ruflo-patch. Users of `@sparkleideas/cli` who want TeammateTool integration must install the upstream `@claude-flow` scoped package separately, creating a scope mismatch and potential version incompatibility.

**Trigger**: Claude Code v2.1.19 shipped TeammateTool as a stable feature. The plugin is the only supported way to bridge TeammateTool with Claude Flow swarms. As adoption grows, users will expect `@sparkleideas/cli` to support it natively.

**Success Criteria**:
1. `@sparkleideas/teammate-plugin` published to npm and installable
2. No existing `@sparkleideas/*` package breaks
3. Plugin works with `@sparkleideas/cli` swarm system
4. Codemod correctly renames all `@claude-flow/` references in the plugin source
5. Integration test catches the new package in the dependency tree

### Pseudocode

```
Phase 1: Integrate into publish pipeline
  1. Add @sparkleideas/teammate-plugin to LEVELS in publish.mjs
  2. Determine correct topological level (dependencies: eventemitter3, @ruvnet/bmssp — external only)
  3. Codemod handles scope rename automatically (@claude-flow/* → @sparkleideas/*)
  4. Verify with integration test (Verdaccio dry run)

Phase 2: Wire into CLI (optional, deferred)
  IF cli adds teammate-plugin as optionalDependency:
    Add to Level 3 (after shared/memory, before guidance/mcp)
  ELSE:
    Add to Level 1 (no internal deps)

Phase 3: Test
  Unit: Verify plugin appears in publish order
  Integration: Verdaccio publishes it, npm install resolves it
  Acceptance: Plugin can be imported and bridge initialized
```

### Architecture

```
                          @sparkleideas/cli (L5)
                                  |
                    @sparkleideas/guidance (L4)
                                  |
                     @sparkleideas/hooks (L3)
                                  |
                    @sparkleideas/shared (L2)
                                  |
         ┌──────────────────────────────────────┐
         │          Level 1 (no internal deps)  │
         │                                      │
         │  @sparkleideas/agentdb               │
         │  @sparkleideas/agentic-flow          │
         │  @sparkleideas/ruv-swarm             │
         │  @sparkleideas/teammate-plugin  ◄─── │ NEW
         └──────────────────────────────────────┘
                          |
                   external deps only
              (eventemitter3, @ruvnet/bmssp)
```

The teammate-plugin has **zero internal `@claude-flow/*` dependencies** — only `eventemitter3` and `@ruvnet/bmssp`. It belongs at **Level 1**.

Its `peerDependencies` (`@anthropic-ai/claude-code >= 2.1.19`) is marked optional and not in our scope.

### Refinement

#### Source Analysis

| Property | Value |
|----------|-------|
| **Upstream package** | `@claude-flow/teammate-plugin` |
| **Upstream version** | `1.0.0-alpha.1` |
| **Source repo** | `github.com/ruvnet/ruflo` |
| **Source path** | `v3/plugins/teammate-plugin/` |
| **Repackaged as** | `@sparkleideas/teammate-plugin` |
| **Dependencies** | `eventemitter3@^5.0.1`, `@ruvnet/bmssp@^1.0.0` (external) |
| **Peer deps** | `@anthropic-ai/claude-code@>=2.1.19` (optional) |
| **Internal deps** | None |
| **Source files** | 12 TypeScript files (bridge, MCP tools, topology, semantic router, utils) |
| **Exports** | 5 entry points: `.`, `./bridge`, `./mcp`, `./topology`, `./semantic` |
| **MCP tools** | 16 tools (spawn_team, discover, spawn, message, plan, delegate, etc.) |
| **Build** | TypeScript → `dist/` (pre-built in upstream, no rebuild needed) |

#### Plugin Capabilities

| Capability | Description | Claude Code Requirement |
|-----------|-------------|------------------------|
| Team management | Create/discover/load teams with topology options | TeammateTool (v2.1.19+) |
| Teammate spawning | Bridge AgentInput schema to Task tool | TeammateTool |
| Messaging | Direct + broadcast with priority/type metadata | TeammateTool |
| Plan approval | Submit/approve/reject/launch workflow | TeammateTool + ExitPlanMode |
| Delegation | Grant/revoke permissions between teammates | TeammateTool |
| Session memory | Persist/restore teammate context across sessions | File system |
| Teleport | Resume teams across terminal instances | tmux |
| Remote sync | Push team config to Claude.ai (experimental) | Network |
| MCP fallback | Degrade gracefully when TeammateTool unavailable | MCP server |

#### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Plugin requires Claude Code >= 2.1.19 | Medium | Low | Plugin has MCP fallback mode. `peerDependency` is optional. |
| `@ruvnet/bmssp` not available | Low | Medium | It's published on npm. Verdaccio will proxy it. |
| Plugin has no `dist/` in upstream clone | Medium | High | Check if upstream ships pre-built. If not, needs build step. |
| Increases package count from 24 → 25 | Certain | Low | Unit tests updated. Integration test validates. |
| Codemod misses internal references | Low | Medium | Plugin source references `@claude-flow/cli` in docs/comments only, not imports. |

#### Pre-built Check

```
v3/plugins/teammate-plugin/
├── src/           ← TypeScript source (12 files)
├── dist/          ← NOT present in git clone
├── package.json   ← main: "dist/index.js"
└── tsconfig.json
```

**Critical finding**: The plugin is TypeScript-only with no `dist/` directory. Unlike the core packages (which ship pre-built JS), this plugin **requires a build step** (`tsc`). This is the main integration challenge.

### Completion

#### Decision Drivers

1. **No current dependents** — no `@sparkleideas/*` package imports `teammate-plugin`
2. **Requires build step** — unlike all other packages, needs `tsc` compilation
3. **Claude Code version gate** — requires v2.1.19+ which may not be widely deployed
4. **MCP fallback exists** — plugin degrades gracefully without TeammateTool
5. **User demand unclear** — no issues filed requesting this integration

#### Considered Options

##### Option A: Integrate Now (Full)

Add `@sparkleideas/teammate-plugin` to the publish pipeline:

1. Add build step for TypeScript compilation in `sync-and-build.sh`
2. Add to `LEVELS` at Level 1
3. Publish alongside other packages
4. Add acceptance test for plugin import

**Pros**: Complete coverage, users get it automatically.
**Cons**: Adds build complexity (only TypeScript package), increases pipeline time, no current demand.

##### Option B: Integrate When Demanded (Deferred)

Monitor for:
- `@claude-flow/cli` adds `teammate-plugin` as a dependency
- Users file issues requesting it
- Claude Code TeammateTool reaches broad adoption

**Pros**: No unnecessary complexity. Zero risk of breakage.
**Cons**: Users who want it must install upstream `@claude-flow/teammate-plugin` separately.

##### Option C: Publish Pre-built Only (Conditional)

Add to pipeline but skip if `dist/` is missing:

1. Check if `dist/` exists after codemod
2. If yes, publish. If no, skip with warning.
3. No build step added to pipeline.

**Pros**: Zero pipeline changes if upstream starts shipping `dist/`. No breakage if they don't.
**Cons**: Unreliable — depends on upstream build artifact state.

## Decision

**Chosen option: Option B — Integrate When Demanded**

### Rationale

1. **No package depends on it** — unlike `plugin-gastown-bridge` (which is an `optionalDependency` of `cli`), teammate-plugin is fully standalone. No user will encounter a missing dependency error.

2. **Build step is a pipeline change** — all 24 current packages ship pre-built JavaScript. Adding TypeScript compilation for one plugin introduces a new failure mode and dependency (`typescript`, `vitest`) into the build pipeline.

3. **Version gate limits audience** — Claude Code >= 2.1.19 is required. The plugin's MCP fallback means users on older versions get degraded functionality even if installed.

4. **Easy to add later** — when the trigger conditions are met, integration is straightforward:
   - Add to `LEVELS` at Level 1 (zero internal deps)
   - Add `tsc` build step for this package only
   - Codemod handles scope rename automatically
   - Integration test validates immediately

### Trigger Conditions for Re-evaluation

| Trigger | Action |
|---------|--------|
| `@claude-flow/cli` adds `teammate-plugin` as dependency | Implement Option A immediately |
| User files issue requesting `@sparkleideas/teammate-plugin` | Evaluate demand, implement Option A |
| Upstream starts shipping `dist/` in git | Implement Option C (zero-cost) |
| Claude Code TeammateTool reaches GA (non-beta) | Re-evaluate Option A |

### Implementation Plan (When Triggered)

```bash
# 1. Add build step to sync-and-build.sh (after codemod, before publish)
cd "${TEMP_BUILD}/ruflo/v3/plugins/teammate-plugin"
npm install --ignore-scripts  # install typescript
npx tsc                       # compile to dist/

# 2. Add to publish.mjs LEVELS array
# Level 1 (no internal deps):
['@sparkleideas/agentdb', '@sparkleideas/agentic-flow', '@sparkleideas/ruv-swarm',
 '@sparkleideas/teammate-plugin']  // ← add here

# 3. Add acceptance test
# test_a11_teammate_plugin() in test-acceptance.sh:
#   npm install @sparkleideas/teammate-plugin
#   node -e "import('@sparkleideas/teammate-plugin').then(m => console.log(m))"

# 4. Update published-versions.json after first publish
```

### Consequences

**Good:**
- No pipeline complexity added prematurely
- No new failure modes in automated builds
- Clear trigger conditions documented for when to revisit

**Bad:**
- Users wanting teammate integration must mix scopes (`@sparkleideas/cli` + `@claude-flow/teammate-plugin`)

**Neutral:**
- Plugin continues to be available upstream at `@claude-flow/teammate-plugin@1.0.0-alpha.1`

---

## References

- Source: `github.com/ruvnet/ruflo/v3/plugins/teammate-plugin/`
- Upstream ADR: `ADR-027-teammate-tool-integration.md`
- Claude Code TeammateTool: Introduced in v2.1.19
- Related: [ADR-0014 Topological Publish Order](0014-topological-publish-order.md)
- Related: [ruvnet Package Map](../ruvnet.packages.and.source.location.md) — Matrix 4 (Monitor list)

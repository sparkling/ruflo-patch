# ADR-0023: Plugin SDK Integration

- **Status**: Accepted
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## SPARC Framework

### Specification

**Problem**: The `@claude-flow/plugins` package (v3.0.0-alpha.7) is the unified Plugin SDK for Claude Flow V3. It provides the plugin builder API, MCP tool builder, hook system, worker plugins, provider pattern, plugin registry, and 8+ export entrypoints. All 14 plugins in the Claude Flow ecosystem depend on this SDK to register their MCP tools and lifecycle hooks. Without `@sparkleideas/plugins` published to npm, no plugin can be installed via `npx @sparkleideas/cli plugins install` -- the CLI command exists but has no SDK to resolve against.

**Trigger**: The CLI's `plugins install` command already references the Plugin SDK. Any user attempting to install a plugin hits an unresolvable dependency. Publishing the SDK is a prerequisite for all future plugin integration work.

**Success Criteria**:
1. `@sparkleideas/plugins` published to npm and installable
2. Package count increases from 24 to 25
3. No existing `@sparkleideas/*` package breaks
4. Codemod correctly renames all `@claude-flow/plugins` references to `@sparkleideas/plugins`
5. All 14 downstream plugins can resolve the SDK after publish
6. `bash check-patches.sh` and `npm test` continue to pass

### Pseudocode

```
Phase 1: Add to publish pipeline
  1. Verify @claude-flow/plugins ships pre-built JS (no tsc needed)
  2. Add @sparkleideas/plugins to LEVELS in publish.mjs at Level 1
  3. Codemod handles scope rename automatically (@claude-flow/plugins -> @sparkleideas/plugins)
  4. Update published-versions.json after first publish
  5. Update package count from 24 -> 25 in tests and documentation

Phase 2: Verify
  1. Run integration test (Verdaccio dry run)
  2. Confirm npm install @sparkleideas/plugins resolves
  3. Confirm node -e "require('@sparkleideas/plugins')" succeeds
  4. Confirm idempotent re-publish works

Phase 3: Unblock plugins
  AFTER SDK is published:
    Any of the 14 plugins can be added to the pipeline
    Each plugin imports from @sparkleideas/plugins
    Plugin install command in CLI becomes functional
```

### Architecture

The Plugin SDK sits at Level 1 of the topological publish order because it has zero internal `@claude-flow/*` dependencies. Its only dependency (`events`) is a Node.js built-in, making it effectively dependency-free.

```
                          @sparkleideas/cli (L5)
                                  |
                    @sparkleideas/guidance (L4)
                                  |
                     @sparkleideas/hooks (L3)
                                  |
                    @sparkleideas/shared (L2)
                                  |
         +----------------------------------------------+
         |          Level 1 (no internal deps)           |
         |                                               |
         |  @sparkleideas/agentdb                        |
         |  @sparkleideas/agentic-flow                   |
         |  @sparkleideas/ruv-swarm                      |
         |  @sparkleideas/plugins  <--- NEW (25th pkg)   |
         +----------------------------------------------+
                          |
                   external deps only
              (events = Node.js built-in)
```

Note: ADR-0014 originally placed `@sparkleideas/plugins` at Level 3. This ADR corrects that placement to Level 1 based on actual dependency analysis -- the package has no `@claude-flow/*` or `@sparkleideas/*` imports, only the Node.js built-in `events` module. The Level 3 placement in ADR-0014 was based on the broader `plugins` directory structure, not the SDK package itself.

**Plugin SDK as foundation for all plugins:**

```
         @sparkleideas/plugins (SDK)        Level 1
                   |
    +--------------+--------------+
    |              |              |         Future (not yet integrated)
  plugin-A     plugin-B      plugin-C
  (agentic-qe) (code-intel) (cognitive-kernel)
    ...14 plugins total...
```

### Refinement

#### Source Analysis

| Property | Value |
|----------|-------|
| **Upstream package** | `@claude-flow/plugins` |
| **Upstream version** | `3.0.0-alpha.7` |
| **Source repo** | `github.com/ruvnet/ruflo` |
| **Source path** | `v3/@claude-flow/plugins` |
| **Repackaged as** | `@sparkleideas/plugins` |
| **Dependencies** | `events` (Node.js built-in, listed as external) |
| **Internal deps** | None |
| **Topological level** | Level 1 |
| **Build required** | No -- ships pre-built JavaScript |
| **Export entrypoints** | 8+ (plugin builder, MCP tool builder, hooks, workers, providers, registry, etc.) |
| **Downstream dependents** | All 14 Claude Flow plugins |

#### Pre-built Check

```
v3/@claude-flow/plugins/
+-- package.json    <- main points to JS (no build step)
+-- *.js / *.mjs    <- pre-built JavaScript shipped
+-- README.md
```

The Plugin SDK ships pre-built JavaScript, consistent with all other packages in the pipeline. No TypeScript compilation step is required. This is a key differentiator from `@claude-flow/teammate-plugin` (ADR-0021), which required `tsc` and was deferred partly for that reason.

#### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Package ships without pre-built JS | Low | High | Verify `main` entry resolves to JS before publish. If missing, defer. |
| Codemod misses internal scope references | Low | Medium | Plugin SDK has no `@claude-flow/*` imports (only `events`). Codemod only needs to rename `package.json` scope. |
| Increases package count 24 -> 25 | Certain | Low | Update test assertions and documentation. |
| Level placement conflict with ADR-0014 | Certain | Low | This ADR supersedes ADR-0014's Level 3 placement for this package with Level 1. |
| `events` dependency causes install issues | Very Low | Low | `events` is a Node.js built-in. If listed in `package.json`, npm resolves it as a no-op on Node. |

### Completion

#### Decision Drivers

1. **Unblocks plugin ecosystem** -- all 14 plugins depend on this SDK; none can be published without it
2. **Zero build complexity** -- ships pre-built JS, same as all other 24 packages
3. **Zero internal dependencies** -- Level 1 placement, no ordering concerns
4. **CLI already references it** -- `plugins install` command exists but cannot resolve the SDK
5. **ADR-0021 was deferred partly due to missing plugin infrastructure** -- publishing the SDK addresses that blocker

#### Considered Options

##### Option A: Integrate Now

Add `@sparkleideas/plugins` to the publish pipeline at Level 1:

1. Add to `LEVELS` array in `publish.mjs` at Level 1
2. Codemod handles scope rename
3. Publish alongside other packages
4. Update package count from 24 to 25

**Pros**: Unblocks all future plugin work. Zero additional build complexity. Same integration process as existing Level 1 packages.
**Cons**: Adds one more package to publish pipeline (minimal impact at ~2s per package).

##### Option B: Defer Until a Plugin Is Needed

Wait until a specific plugin (e.g., `agentic-qe`, `code-intelligence`) is ready to integrate, then publish the SDK as a prerequisite.

**Pros**: No work until concrete demand.
**Cons**: Creates a two-step integration for every future plugin (SDK first, then plugin). Delays the first plugin integration by one cycle.

##### Option C: Publish SDK Alongside First Plugin

Bundle the SDK publish with the first plugin integration, publishing both in the same pipeline run.

**Pros**: Single ADR and single pipeline change for SDK + first plugin.
**Cons**: Conflates two changes. If the plugin has issues, the SDK publish is also blocked. The SDK is independently useful (CLI references it).

## Decision

**Chosen option: Option A -- Integrate Now**

### Rationale

1. **No build step needed** -- unlike `@claude-flow/teammate-plugin` (ADR-0021), which was deferred because it required TypeScript compilation, the Plugin SDK ships pre-built JavaScript. Integration follows the exact same process as existing Level 1 packages (`agentdb`, `agentic-flow`, `ruv-swarm`).

2. **Unblocks the entire plugin ecosystem** -- all 14 plugins import from `@claude-flow/plugins`. Publishing `@sparkleideas/plugins` is a prerequisite for integrating any of them. Deferring the SDK means deferring every plugin.

3. **The CLI already expects it** -- the `plugins install` command exists in `@sparkleideas/cli` and references the Plugin SDK. Users attempting plugin installation hit an unresolvable dependency.

4. **Zero internal dependencies** -- the package depends only on `events` (Node.js built-in). It belongs at Level 1 with no ordering constraints relative to other packages.

5. **Minimal pipeline impact** -- adding one package to Level 1 adds approximately 2 seconds to the total publish time. No new failure modes are introduced.

### Implementation Plan

```bash
# 1. Add to publish.mjs LEVELS array at Level 1
# Level 1 (no internal deps):
['@sparkleideas/agentdb', '@sparkleideas/agentic-flow',
 '@sparkleideas/ruv-swarm', '@sparkleideas/plugins']

# 2. Codemod handles scope rename automatically
# @claude-flow/plugins -> @sparkleideas/plugins in package.json

# 3. Verify pre-built JS exists
ls v3/@claude-flow/plugins/*.js  # must resolve

# 4. Update published-versions.json after first publish
# "@sparkleideas/plugins": "<version>"

# 5. Update package count in tests/documentation: 24 -> 25

# 6. Verify
bash patch-all.sh --global
bash check-patches.sh
npm test
```

### Consequences

**Good:**
- Unblocks integration of all 14 downstream plugins
- CLI `plugins install` command becomes functional once plugins are also published
- Zero additional build complexity (pre-built JS, no TypeScript step)
- ADR-0021 blocker partially resolved (plugin infrastructure now available)
- Consistent with existing Level 1 integration pattern

**Bad:**
- Package count increases from 24 to 25 (test assertions and documentation must update)
- ADR-0014 Level 3 placement for this package is superseded (minor documentation inconsistency until ADR-0014 is updated)

**Neutral:**
- The 14 downstream plugins are not yet integrated -- this ADR only covers the SDK
- Publishing the SDK does not automatically make plugins installable; each plugin needs its own integration step
- The `events` dependency is a Node.js built-in and has no effect on install resolution

---

## References

- Upstream package: `@claude-flow/plugins@3.0.0-alpha.7`
- Source path: `v3/@claude-flow/plugins`
- Related: [ADR-0014 Topological Publish Order](0014-topological-publish-order.md) -- defines the 5-level publish hierarchy
- Related: [ADR-0021 Teammate Plugin Integration](0021-teammate-plugin-integration.md) -- deferred partly due to missing plugin infrastructure
- Downstream dependents: 14 plugins (agentic-qe, code-intelligence, cognitive-kernel, devtools, github-integration, memory-optimizer, monitoring, observability, performance-analyzer, prompt-engine, security-scanner, semantic-search, task-orchestrator, workflow-engine)

# ADR-0023: Plugin SDK Integration

- **Status**: Accepted
- **Date**: 2026-03-07
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + MADR

## Context and Problem Statement

Users who want to use Claude Flow plugins with `@sparkleideas/cli` currently cannot, because the Plugin SDK is not published under the `@sparkleideas` scope. The SDK (`@claude-flow/plugins`) is the runtime dependency that every plugin imports to register MCP tools, hooks, and lifecycle events.

Publishing the SDK is a **necessary prerequisite** but **not sufficient** on its own — each plugin must also be individually repackaged (codemod scope rename on its import statements) before it can resolve the SDK. This ADR covers only the SDK; individual plugin integration requires separate work.

**What this ADR enables:**

```
$ npm install @sparkleideas/plugins         # SDK becomes installable
$ node -e "import('@sparkleideas/plugins')" # Builder API accessible
```

**What still requires further work (per-plugin repackaging):**

```
$ npx @sparkleideas/cli plugins install --name @sparkleideas/plugin-agentic-qe
# Only works AFTER plugin-agentic-qe is also repackaged with codemod
```

## Decision Drivers

1. **SDK is a prerequisite for all plugins** -- no plugin can work without the SDK in the same scope, because plugins import from `@claude-flow/plugins` (rewritten to `@sparkleideas/plugins` by codemod)
2. **Each plugin also needs individual repackaging** -- the SDK alone doesn't make plugins installable; each plugin's imports must be codemod-renamed too
3. **Users cannot build custom plugins** -- the plugin builder API, MCP tool builder, and hook system are inaccessible until the SDK is installable
4. **Zero build complexity** -- the package ships pre-built JavaScript, requiring no TypeScript compilation
5. **Zero internal dependencies** -- the SDK depends only on `events` (Node.js built-in), meaning it introduces no new dependency chains for users

## SPARC Framework

### Specification

**Problem**: When a user installs a plugin via the CLI, the plugin's `package.json` declares a dependency on `@claude-flow/plugins`. In the `@sparkleideas` ecosystem, this scope does not exist in npm. The CLI cannot resolve the SDK, and the plugin installation fails. This affects every plugin uniformly -- it is not a per-plugin bug but a missing foundational package.

**Trigger**: Any user attempting `npx @sparkleideas/cli plugins install` for any of the 14 available plugins.

**Success Criteria**:

1. Users can run `npm install @sparkleideas/plugins` and the package resolves
2. Users can run `npx @sparkleideas/cli plugins install --name <plugin>` without SDK resolution errors
3. Users can import plugin builder APIs (`@sparkleideas/plugins/builder`, `@sparkleideas/plugins/mcp`, etc.)
4. No existing `@sparkleideas/*` package breaks
5. `bash check-patches.sh` and `npm test` continue to pass

### Pseudocode

What happens when a user installs a plugin:

```
User runs: npx @sparkleideas/cli plugins install --name @sparkleideas/plugin-agentic-qe

1. CLI receives install command
2. CLI resolves plugin package from npm registry
3. Plugin package.json declares: "dependencies": { "@sparkleideas/plugins": "..." }
4. npm attempts to resolve @sparkleideas/plugins
   - BEFORE: package does not exist in npm --> FAIL
   - AFTER:  package exists, resolves to pre-built JS --> OK
5. Plugin loads SDK:
   import { PluginBuilder } from '@sparkleideas/plugins/builder'
   import { MCPToolBuilder } from '@sparkleideas/plugins/mcp'
   import { HookSystem } from '@sparkleideas/plugins/hooks'
6. Plugin registers its MCP tools and lifecycle hooks via the SDK
7. CLI confirms installation success
```

Implementation steps (from user-impact perspective):

```
1. Publish @sparkleideas/plugins to npm
   - Source: v3/@claude-flow/plugins (ships pre-built JS)
   - Scope rename handled by existing codemod
   - Package count: 24 -> 25

2. Verify user-facing functionality
   - npm install @sparkleideas/plugins resolves
   - All 8+ entrypoints importable (builder, mcp, hooks, worker, provider, registry, types, root)
   - CLI plugins commands no longer error on SDK resolution

3. Unblock downstream plugins
   - Each of the 14 plugins can now be individually integrated
   - Each plugin will need its own scope rename and publish step
```

### Architecture

The SDK is the foundation layer that all plugins build on. From a user's perspective, the dependency chain works as follows:

```
User installs a plugin
        |
        v
  @sparkleideas/plugin-*          (the plugin package)
        |
        v
  @sparkleideas/plugins           (the SDK -- THIS ADR)
        |
        v
  events (Node.js built-in)       (effectively zero deps)
```

The SDK provides 8+ export entrypoints that plugins consume:

```
@sparkleideas/plugins
  |-- .               Root entrypoint (main API)
  |-- ./builder       Plugin builder API (create, configure, validate plugins)
  |-- ./mcp           MCP tool builder (register tools with the CLI)
  |-- ./hooks         Hook system (lifecycle events, pre/post task hooks)
  |-- ./worker        Worker plugin pattern (background tasks)
  |-- ./provider      Provider pattern (data sources, services)
  |-- ./registry      Plugin registry (discover, load, manage plugins)
  |-- ./types         TypeScript type definitions
```

Within the published package ecosystem, the SDK sits at the base layer alongside other zero-dependency packages:

```
    @sparkleideas/cli              User-facing CLI (top of stack)
            |
           ...                     Intermediate packages
            |
    +------------------------------------------+
    |        Level 1 (no internal deps)         |
    |                                           |
    |  @sparkleideas/agentdb                    |
    |  @sparkleideas/agentic-flow               |
    |  @sparkleideas/ruv-swarm                  |
    |  @sparkleideas/plugins  <-- THIS ADR      |
    +------------------------------------------+
                    |
             external deps only
         (events = Node.js built-in)
```

Note: ADR-0014 originally placed this package at Level 3. This ADR corrects that to Level 1 based on actual dependency analysis -- the SDK has no `@claude-flow/*` or `@sparkleideas/*` imports.

**What users get access to once the SDK is published:**

| Entrypoint | User Capability |
|------------|----------------|
| `./builder` | Create custom plugins with validation and lifecycle management |
| `./mcp` | Register new MCP tools that appear in the CLI |
| `./hooks` | Attach logic to pre-task, post-task, and other lifecycle events |
| `./worker` | Build background worker plugins for long-running operations |
| `./provider` | Implement data source and service provider plugins |
| `./registry` | Programmatically discover and manage installed plugins |

### Refinement

#### Source Analysis

| Property | Value |
|----------|-------|
| **Upstream package** | `@claude-flow/plugins` |
| **Upstream version** | `3.0.0-alpha.7` |
| **Repackaged as** | `@sparkleideas/plugins` |
| **Source path** | `ruflo/v3/@claude-flow/plugins` |
| **Dependencies** | `events` (Node.js built-in -- effectively zero external deps) |
| **Internal deps** | None |
| **Build required** | No -- ships pre-built JavaScript |
| **Export entrypoints** | 8+ (builder, mcp, hooks, worker, provider, registry, types, root) |
| **Downstream dependents** | All 14 Claude Flow plugins |

This is a key differentiator from `@claude-flow/teammate-plugin` (ADR-0021), which required TypeScript compilation and was deferred partly for that reason. The Plugin SDK ships ready-to-publish JavaScript.

#### Risk Assessment (User-Impact Focus)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Users install SDK but no plugins exist yet | Likely (initially) | Low | SDK is independently useful for custom plugin development. Plugins will follow. |
| Plugin scope mismatch (`@claude-flow/plugin-*` vs `@sparkleideas/plugin-*`) | Medium | Medium | Codemod renames all scope references. Users must use `@sparkleideas/plugin-*` names. |
| Entrypoint paths break after scope rename | Low | High | Entrypoints are relative paths (`./builder`, `./mcp`), unaffected by scope rename. |
| `events` dependency listed in package.json causes confusion | Very Low | Very Low | `events` is a Node.js built-in. npm resolves it as a no-op in Node environments. |
| Package count increase (24 to 25) breaks assumptions | Certain | Low | Update test assertions and documentation. |

### Completion

## Considered Options

### Option A: Integrate Now

Publish `@sparkleideas/plugins` to npm immediately, making the SDK available for users and unblocking all future plugin work.

**Pros:**
- Users get a working plugin subsystem (once individual plugins are also published)
- Users gain access to the plugin builder API for custom plugin development
- CLI `plugins` commands stop failing on SDK resolution
- Zero build complexity -- same integration process as existing packages
- Unblocks all 14 downstream plugins

**Cons:**
- Package count increases from 24 to 25 (test and docs updates needed)
- SDK is available before any individual plugins are published (SDK without plugins has limited immediate utility for non-developers)

### Option B: Defer Until a Plugin Is Ready

Wait until a specific plugin (e.g., `plugin-agentic-qe`) is ready to publish, then publish the SDK as a prerequisite in the same cycle.

**Pros:**
- No work until concrete user demand for a specific plugin
- SDK and first plugin ship together, giving users immediate end-to-end value

**Cons:**
- Users cannot build custom plugins in the interim
- Creates a two-step integration for the first plugin (SDK + plugin in one cycle adds risk)
- CLI `plugins` commands remain broken until that cycle

### Option C: Bundle SDK Into the CLI

Instead of publishing the SDK as a separate package, embed it directly in `@sparkleideas/cli`.

**Pros:**
- Users do not need to install a separate SDK package
- Fewer packages to maintain

**Cons:**
- Breaks the plugin architecture -- plugins expect to import from `@sparkleideas/plugins`, not from the CLI
- All 14 upstream plugins would need rewiring
- Users building custom plugins lose the standalone SDK import pattern
- Violates separation of concerns

## Decision

**Chosen option: Option A -- Integrate Now**

### Rationale

1. **Users get working plugin commands** -- the CLI already ships `plugins list`, `plugins install`, and `plugins remove`. These commands currently fail because the SDK is missing. Publishing the SDK is the minimum change needed to unblock the plugin subsystem.

2. **Users can build custom plugins** -- the plugin builder API, MCP tool builder, and hook system become accessible to users who want to extend the CLI with their own plugins. This does not require waiting for upstream plugins to be published.

3. **No build step needed** -- unlike `@claude-flow/teammate-plugin` (ADR-0021), which was deferred because it required TypeScript compilation, the Plugin SDK ships pre-built JavaScript. The user-facing package works immediately after scope rename and publish.

4. **Zero new dependencies for users** -- the SDK depends only on `events` (Node.js built-in). Users who install it get no transitive dependency tree, no native modules, no platform-specific binaries.

5. **Prerequisite for all plugins** -- deferring the SDK means deferring every plugin. There is no path to a working plugin ecosystem without this package.

### What Changes for Users

| Before | After |
|--------|-------|
| `npm install @sparkleideas/plugins` fails | SDK installs; custom plugin development possible. Upstream plugins still need individual repackaging. |
| `npm install @sparkleideas/plugins` fails | Package installs successfully |
| Custom plugin development impossible | Users can import builder, mcp, hooks APIs |
| 24 packages in `@sparkleideas` scope | 25 packages |

### Consequences

**Good (user-facing):**
- Users can `npm install @sparkleideas/plugins` and build custom plugins using the builder API
- Users can register custom MCP tools and lifecycle hooks via the SDK
- Prerequisite met for future plugin repackaging — each plugin can be integrated one by one once the SDK exists in-scope
- No upstream plugins work yet (each needs its own codemod repackaging), but the foundation is in place

**Bad (user-facing):**
- Initially, the SDK is available but no pre-built plugins are published yet -- users can only build custom plugins until upstream plugins are integrated
- Users familiar with `@claude-flow/plugins` must use `@sparkleideas/plugins` instead

**Neutral:**
- Each of the 14 upstream plugins still needs its own integration step -- this ADR only covers the SDK
- The `events` dependency has no observable effect on user installs

### Required Documentation Updates

When this ADR is implemented, the following documents must be updated:

| Document | Change |
|----------|--------|
| `docs/unpublished-sources.md` | Move `@claude-flow/plugins` from unpublished to published; update recommendation from "Integrate" to "Done" |
| `docs/ruvnet.packages.and.source.location.md` | Add `@sparkleideas/plugins` to Matrix 2 (published packages) with source path and version |
| `docs/plugin-catalog.md` | Update install commands to reference `@sparkleideas/plugins` as the resolved SDK |
| `README.md` | Update package count from 24 to 25 (or current count) |

### Required Tests

| Layer | Test | What it validates |
|-------|------|-------------------|
| **Unit** | `tests/06-publish-order.test.mjs` | `@sparkleideas/plugins` appears in Level 1 of the LEVELS array |
| **Integration** | `scripts/test-integration.sh` Phase 8 | Package publishes to Verdaccio and resolves via `npm install` |
| **Acceptance** | `scripts/test-acceptance.sh` | New test: `test_a11_plugin_sdk()` — verify `import('@sparkleideas/plugins')` resolves, plugin builder API is callable, MCP tool builder returns valid tool definition |
| **Acceptance** | `scripts/test-acceptance.sh` | New test: `test_a12_plugin_install()` — verify `npx @sparkleideas/cli plugins list` succeeds (SDK found) |

---

## References

- Upstream package: `@claude-flow/plugins@3.0.0-alpha.7`
- Source path: `ruflo/v3/@claude-flow/plugins`
- Related: [ADR-0014 Topological Publish Order](0014-topological-publish-order.md) -- defines the 5-level publish hierarchy
- Related: [ADR-0021 Teammate Plugin Integration](0021-teammate-plugin-integration.md) -- deferred partly due to missing plugin infrastructure
- Related: [unpublished-sources.md](../unpublished-sources.md)
- Downstream dependents: 14 plugins (agentic-qe, code-intelligence, cognitive-kernel, devtools, github-integration, memory-optimizer, monitoring, observability, performance-analyzer, prompt-engine, security-scanner, semantic-search, task-orchestrator, workflow-engine)

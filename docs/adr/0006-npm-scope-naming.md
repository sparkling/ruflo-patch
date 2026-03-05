# ADR-0006: @claude-flow-patch as npm Scope

## Status

Accepted

## Context

### Specification (SPARC-S)

ADR-0005 establishes that we will fork upstream repos and publish rebuilt packages to public npm under a new scope. This ADR decides the scope name.

The upstream ecosystem uses multiple naming conventions:

- `@claude-flow/*` -- the primary scoped packages (20 packages: `cli`, `memory`, `hooks`, etc.)
- `claude-flow` -- the unscoped core package
- `ruflo` -- a wrapper/CLI entry point around `claude-flow`
- `agentdb`, `agentic-flow` -- unscoped packages from `ruvnet/agentic-flow`
- `ruv-swarm` -- unscoped package from `ruvnet/ruv-FANN`
- `@ruvector/*` -- scoped packages from `ruvnet/ruvector` (not renamed; see ADR-0008)

Our repo is called `ruflo-patch`. `ruflo` is a thin wrapper around `claude-flow`. The scope must clearly signal "this is a patched fork of the claude-flow ecosystem."

### Pseudocode (SPARC-P)

```
DEFINE scope = "@claude-flow-patch"

MAPPING:
  @claude-flow/*        -> @claude-flow-patch/*
  claude-flow           -> @claude-flow-patch/claude-flow
  agentdb               -> @claude-flow-patch/agentdb
  agentic-flow          -> @claude-flow-patch/agentic-flow
  ruv-swarm             -> @claude-flow-patch/ruv-swarm
  ruflo                 -> ruflo-patch (top-level, unscoped)

NOT RENAMED:
  ruvector              -> ruvector (use published)
  @ruvector/*           -> @ruvector/* (use published)
```

## Decision

### Architecture (SPARC-A)

Use `@claude-flow-patch` as the npm scope for all rebuilt packages. The scope mirrors upstream `@claude-flow` with `-patch` appended, making the relationship immediately obvious.

**Complete package mapping:**

| Upstream Package | Our Package | Notes |
|-----------------|-------------|-------|
| `@claude-flow/memory` | `@claude-flow-patch/memory` | Scoped packages get direct mapping |
| `@claude-flow/cli` | `@claude-flow-patch/cli` | Same |
| `@claude-flow/hooks` | `@claude-flow-patch/hooks` | Same |
| `@claude-flow/neural` | `@claude-flow-patch/neural` | Same |
| `claude-flow` | `@claude-flow-patch/claude-flow` | Unscoped becomes scoped |
| `agentdb` | `@claude-flow-patch/agentdb` | Brought under scope for consistency |
| `agentic-flow` | `@claude-flow-patch/agentic-flow` | Same |
| `ruv-swarm` | `@claude-flow-patch/ruv-swarm` | Same |
| `ruflo` | `ruflo-patch` | Top-level entry point, stays unscoped |

**Not renamed (use published versions from public npm):**

| Package | Reason |
|---------|--------|
| `ruvector` | Relatively current (see ADR-0008) |
| `@ruvector/*` | Same -- no rebuild needed |

### Considered Alternatives

1. **`@ruflo-patch`** -- Rejected. `ruflo` is a wrapper around `claude-flow`, not the core ecosystem. Naming the scope after the wrapper creates a mismatch: `@ruflo-patch/memory` implies "ruflo's memory" when it is actually "claude-flow's memory, patched." The scope should reflect the core package naming.

2. **`@ruflo`** -- Rejected. Too close to the upstream `ruflo` package name. Creates confusion about whether `@ruflo/cli` is an official upstream package or our fork.

3. **Unscoped packages** (e.g., `claude-flow-patch-memory`) -- Rejected. Clutters the global npm namespace with 20+ unscoped packages. Scoped packages are the standard practice for related package sets. Unscoped names are longer and harder to read.

4. **`@claude-flow-fixed`** -- Rejected. "Fixed" implies the upstream is broken, which is inaccurate -- the code works, it is just not published. "Patch" is more precise: we are applying patches and publishing current code.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Immediately recognizable relationship: seeing `@claude-flow-patch/memory` tells you it is a patched version of `@claude-flow/memory`
- The codemod is a straightforward string replacement: `@claude-flow/` becomes `@claude-flow-patch/`
- Users never type the scoped names directly -- they use `ruflo-patch` which depends on `@claude-flow-patch/*` internally
- npm scope registration is a one-time operation

**Negative:**

- The scope name is long (20 characters). Internal dependency declarations are verbose. This is cosmetic -- users do not interact with these names.
- If upstream ever transfers the `@claude-flow` scope to us, the `-patch` suffix becomes misleading. This is a desirable problem to have.

**Trade-offs and edge cases:**

- Unscoped upstream packages (`agentdb`, `agentic-flow`, `ruv-swarm`) become scoped under `@claude-flow-patch`. This is intentional -- it groups all our packages under one scope for discoverability and namespace cleanliness.
- The top-level `ruflo-patch` stays unscoped because it is the user-facing CLI entry point. Users type `npx ruflo-patch`, not `npx @claude-flow-patch/ruflo`.
- `claude-flow` (unscoped upstream) becomes `@claude-flow-patch/claude-flow` (scoped). The codemod must handle this asymmetric mapping.

**Neutral:**

- npm scopes are free to register for public packages
- The scope can be registered under a personal npm account or an npm organization

### Completion (SPARC-C)

- [ ] npm scope `@claude-flow-patch` registered on npmjs.com
- [ ] Codemod handles all mappings in the table above, including the asymmetric `claude-flow` -> `@claude-flow-patch/claude-flow` case
- [ ] `npm view @claude-flow-patch/cli` resolves after first publish
- [ ] `ruflo-patch` package.json lists `@claude-flow-patch/*` dependencies, not `@claude-flow/*`
- [ ] No `@ruvector/*` packages are renamed or republished

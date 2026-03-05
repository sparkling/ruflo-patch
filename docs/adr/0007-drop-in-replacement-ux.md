# ADR-0007: Drop-in Replacement UX

## Status

Accepted

## Context

### Specification (SPARC-S)

ADR-0005 and ADR-0006 establish that we will fork, rebuild, and publish the upstream ecosystem under the `@sparkleideas` scope. This ADR decides how end users interact with the result.

The upstream user experience is:

```bash
npx ruflo init                              # initialize a project
npx ruflo agent spawn -t coder              # spawn an agent
npx ruflo memory search --query "auth"      # search memory
```

MCP configuration references `@claude-flow/cli`:

```json
{
  "command": "npx",
  "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"]
}
```

Three UX patterns were considered for our rebuilt packages. The goal is: minimum friction for users switching from `ruflo` to our patched version.

### Pseudocode (SPARC-P)

```
USER EXPERIENCE:
  REPLACE "ruflo" with "ruflo-patch" in all commands
  REPLACE "@claude-flow/cli" with "ruflo-patch" in MCP config
  ALL flags, subcommands, and behaviors remain identical

EXAMPLE:
  npx ruflo init          ->  npx ruflo-patch init
  npx ruflo agent list    ->  npx ruflo-patch agent list
  npx ruflo mcp start     ->  npx ruflo-patch mcp start
```

## Decision

### Architecture (SPARC-A)

`ruflo-patch` is a drop-in replacement for `ruflo`. Same CLI, same commands, same flags. Users swap one word in their commands and MCP configuration.

**Command mapping:**

| Before | After |
|--------|-------|
| `npx ruflo init` | `npx ruflo-patch init` |
| `npx ruflo agent spawn -t coder` | `npx ruflo-patch agent spawn -t coder` |
| `npx ruflo memory search --query "auth"` | `npx ruflo-patch memory search --query "auth"` |
| `npx @claude-flow/cli@latest mcp start` | `npx ruflo-patch mcp start` |

**MCP configuration changes from:**

```json
{
  "command": "npx",
  "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"]
}
```

**to:**

```json
{
  "command": "npx",
  "args": ["-y", "ruflo-patch", "mcp", "start"]
}
```

### Considered Alternatives

1. **Orchestrator pattern** -- Rejected. In this pattern, `npx ruflo-patch` would be a setup/patching step, and then the user runs `npx claude-flow init` separately. Two steps instead of one. The command `ruflo-patch init` becomes ambiguous: does it run the patch step, or the init routine? Cache injection (making `npx @claude-flow/cli` resolve to our code) is fragile and conflicts with npm's cache invalidation behavior.

2. **Dual-mode** (patch existing OR use rebuilt) -- Rejected. Offers users a choice between runtime patching and using rebuilt packages. Complex to implement, confusing to explain, and adds a decision point where none is needed. Users should not have to choose between operational modes for the same tool.

3. **Keep original names via Verdaccio** -- Rejected. Would allow `npx @claude-flow/cli@latest` to work unchanged, but requires every user to run a local Verdaccio instance and configure `.npmrc`. Cannot be distributed publicly on npm. Shifts complexity from a one-word command change to infrastructure setup on every machine.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Simplest possible migration: change one word in commands, one line in MCP config
- No setup step, no configuration, no runtime patching -- published packages already contain all fixes
- Existing documentation and workflows transfer directly -- just search-and-replace the package name
- `npx ruflo-patch` handles dependency resolution automatically via npm

**Negative:**

- Users must update their command references. This is a one-time cost per project (update MCP config, update any scripts or aliases that reference `ruflo` or `@claude-flow/cli`)
- Shell history and muscle memory reference the old commands. Tab completion mitigates this for interactive use.
- Any upstream documentation or tutorials reference `ruflo` or `@claude-flow/cli` -- users must mentally translate

**Trade-offs and edge cases:**

- Projects that hard-code `@claude-flow/cli` in generated files (e.g., `init` writes MCP config referencing `@claude-flow/cli`) need the generated output to reference `@sparkleideas/cli` instead. The codemod handles this in the build, so `ruflo-patch init` generates correct references automatically.
- `repair-post-init.sh` currently copies helpers from the npx cache of `@claude-flow/cli`. With `ruflo-patch`, it copies from `ruflo-patch`'s cache location. The script must be updated to discover the correct cache path.
- If a user has both `ruflo` and `ruflo-patch` installed, they operate independently. There is no conflict because they use different package names and different npx cache locations.

**Neutral:**

- The CLI binary name in `ruflo-patch`'s `package.json` `bin` field can be set to both `ruflo-patch` and `claude-flow-patch` for flexibility, though `ruflo-patch` is the primary entry point
- No changes to the underlying CLI code beyond the scope rename handled by the codemod (ADR-0005) and the enhancement patches documented in ADR-0005 (MC-001 autoStart fix, FB-001/FB-002 fallback instrumentation)

### Completion (SPARC-C)

- [ ] `npx ruflo-patch init` works end-to-end on a clean machine
- [ ] `npx ruflo-patch agent spawn -t coder` spawns an agent successfully
- [ ] `npx ruflo-patch mcp start` starts the MCP server
- [ ] `ruflo-patch init` generates MCP config referencing `ruflo-patch`, not `@claude-flow/cli`
- [ ] All subcommands from `ruflo --help` are present and functional in `ruflo-patch --help`
- [ ] MCP configuration with `"args": ["-y", "ruflo-patch", "mcp", "start"]` works in Claude Code

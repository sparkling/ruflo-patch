# ADR-0007: Drop-in Replacement UX

## Status

Accepted

## Context

### Specification (SPARC-S)

ADR-0005 and ADR-0006 establish that we will fork, rebuild, and publish the upstream ecosystem under the `@sparkleideas` scope. This ADR decides how end users interact with the result.

The upstream user experience is:

```bash
npx @claude-flow/cli init                   # initialize a project
npx @claude-flow/cli agent spawn -t coder   # spawn an agent
npx @claude-flow/cli memory search --query "auth"  # search memory
```

MCP configuration references `@claude-flow/cli`:

```json
{
  "command": "npx",
  "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"]
}
```

Three UX patterns were considered for our rebuilt packages. The goal is: minimum friction for users switching from `@claude-flow/cli` to our patched version.

### Pseudocode (SPARC-P)

```
USER EXPERIENCE:
  REPLACE "@claude-flow/cli" with "@sparkleideas/cli" in all commands
  REPLACE "@claude-flow/cli" with "@sparkleideas/cli" in MCP config
  ALL flags, subcommands, and behaviors remain identical

EXAMPLE:
  npx @claude-flow/cli init          ->  npx @sparkleideas/cli init
  npx @claude-flow/cli agent list    ->  npx @sparkleideas/cli agent list
  npx @claude-flow/cli mcp start     ->  npx @sparkleideas/cli mcp start
```

## Decision

### Architecture (SPARC-A)

`@sparkleideas/cli` is a drop-in replacement for `@claude-flow/cli`. Same CLI, same commands, same flags. Users swap the package name in their commands and MCP configuration.

**Command mapping:**

| Before | After |
|--------|-------|
| `npx @claude-flow/cli init` | `npx @sparkleideas/cli init` |
| `npx @claude-flow/cli agent spawn -t coder` | `npx @sparkleideas/cli agent spawn -t coder` |
| `npx @claude-flow/cli memory search --query "auth"` | `npx @sparkleideas/cli memory search --query "auth"` |
| `npx @claude-flow/cli@latest mcp start` | `npx @sparkleideas/cli mcp start` |

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
  "args": ["-y", "@sparkleideas/cli", "mcp", "start"]
}
```

### Considered Alternatives

1. **Orchestrator pattern** -- Rejected. In this pattern, `npx ruflo` would be a setup/patching step, and then the user runs `npx claude-flow init` separately. Two steps instead of one. The command `ruflo init` becomes ambiguous: does it run the patch step, or the init routine? Cache injection (making `npx @claude-flow/cli` resolve to our code) is fragile and conflicts with npm's cache invalidation behavior.

2. **Dual-mode** (patch existing OR use rebuilt) -- Rejected. Offers users a choice between runtime patching and using rebuilt packages. Complex to implement, confusing to explain, and adds a decision point where none is needed. Users should not have to choose between operational modes for the same tool.

3. **Keep original names via Verdaccio** -- Rejected. Would allow `npx @claude-flow/cli@latest` to work unchanged, but requires every user to run a local Verdaccio instance and configure `.npmrc`. Cannot be distributed publicly on npm. Shifts complexity from a one-word command change to infrastructure setup on every machine.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Simplest possible migration: change the package name in commands, one line in MCP config
- No setup step, no configuration, no runtime patching -- published packages already contain all fixes
- Existing documentation and workflows transfer directly -- just search-and-replace the package name
- `npx @sparkleideas/cli` handles dependency resolution automatically via npm

**Negative:**

- Users must update their command references. This is a one-time cost per project (update MCP config, update any scripts or aliases that reference `@claude-flow/cli`)
- Shell history and muscle memory reference the old commands. Tab completion mitigates this for interactive use.
- Any upstream documentation or tutorials reference `@claude-flow/cli` -- users must mentally translate to `@sparkleideas/cli`

**Trade-offs and edge cases:**

- Projects that hard-code `@claude-flow/cli` in generated files (e.g., `init` writes MCP config referencing `@claude-flow/cli`) need the generated output to reference `@sparkleideas/cli` instead. The codemod handles this in the build, so `npx @sparkleideas/cli init` generates correct references automatically.
- `repair-post-init.sh` currently copies helpers from the npx cache of `@claude-flow/cli`. With `@sparkleideas/cli`, it copies from the `@sparkleideas/cli` cache location. The script must be updated to discover the correct cache path.
- If a user has both `@claude-flow/cli` and `@sparkleideas/cli` installed, they operate independently. There is no conflict because they use different package names and different npx cache locations.

**Neutral:**

- The CLI binary name in `@sparkleideas/cli`'s `package.json` `bin` field is `ruflo`, matching the upstream binary name
- No changes to the underlying CLI code beyond the scope rename handled by the codemod (ADR-0005) and the enhancement patches documented in ADR-0005 (MC-001 autoStart fix, FB-001/FB-002 fallback instrumentation)

### Completion (SPARC-C)

- [x] `npx @sparkleideas/cli init` works end-to-end on a clean machine
- [x] `npx @sparkleideas/cli agent spawn -t coder` spawns an agent successfully
- [x] `npx @sparkleideas/cli mcp start` starts the MCP server
- [x] `npx @sparkleideas/cli init` generates MCP config referencing `@sparkleideas/cli`, not `@claude-flow/cli`
- [x] All subcommands from `@claude-flow/cli --help` are present and functional in `@sparkleideas/cli --help`
- [x] MCP configuration with `"args": ["-y", "@sparkleideas/cli", "mcp", "start"]` works in Claude Code

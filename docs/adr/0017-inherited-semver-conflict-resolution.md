# ADR-0017: Inherited Semver Conflict Resolution

## Status

Implemented

## Context

### Specification (SPARC-S)

The upstream ruvnet ecosystem contains 2 RED semver conflicts (documented in the versioning analysis, section 9). These conflicts exist in the upstream source code and are inherited unchanged by our build:

1. **`@ruvector/ruvllm`**: `agentic-flow@2.0.7` specifies `^0.2.3` as its dependency range. The actual npm latest for `@ruvector/ruvllm` is `2.5.1`. Caret `^0.2.3` only matches `>=0.2.3 <0.3.0` -- it does not match `2.5.1`. This range is mathematically unresolvable without modification.

2. **`agentdb`**: `@claude-flow/memory` pins `2.0.0-alpha.3.7` (an exact version). `agentic-flow@2.0.7` specifies `^2.0.0-alpha.2.20`. The npm latest for `agentdb` is `3.0.0-alpha.10`. Neither the pin nor the caret range accepts `3.0.0-alpha.10`. The pin does not even exist on npm (the closest published version is `2.0.0-alpha.3.21`).

If left unpatched, these conflicts cause `npm install` or `pnpm install` to either fail outright (strict mode) or install incompatible versions that crash at runtime. This defeats the purpose of ruflo as a working drop-in replacement.

This addresses review issue S3 from the ADR review report.

### Pseudocode (SPARC-P)

```
DURING build, after codemod but before pnpm install:

  # Fix 1: @ruvector/ruvllm range in agentic-flow
  IN agentic-flow/package.json:
    REPLACE "@ruvector/ruvllm": "^0.2.3"
    WITH    "@ruvector/ruvllm": "^2.5.1"

  # Fix 2: agentdb range in @claude-flow/memory
  IN @claude-flow/memory/package.json:
    REPLACE "agentdb": "2.0.0-alpha.3.7"
    WITH    "agentdb": "^3.0.0-alpha.10"

  # Fix 3: agentdb range in agentic-flow
  IN agentic-flow/package.json:
    REPLACE "agentdb": "^2.0.0-alpha.2.20"
    WITH    "agentdb": "^3.0.0-alpha.10"

  pnpm install   # now resolves cleanly
```

## Decision

### Architecture (SPARC-A)

Patch the version ranges during the build, treating them as build-time fixes applied alongside the scope-rename codemod and existing enhancement patches. The patches are maintained in the `patch/` directory using the established `fix.py` infrastructure.

**Patch 1: `@ruvector/ruvllm` range fix.** In `agentic-flow`'s `package.json`, change `"@ruvector/ruvllm": "^0.2.3"` to `"@ruvector/ruvllm": "^2.5.1"`. This updates the range to match the actual published major version. Since `@ruvector/ruvllm` jumped from `0.2.x` to `2.5.x`, the original range was likely a typo or predated the major version bump.

**Patch 2: `agentdb` range fix.** In `@claude-flow/memory`'s `package.json`, change the exact pin `"agentdb": "2.0.0-alpha.3.7"` to `"agentdb": "^3.0.0-alpha.10"`. In `agentic-flow`'s `package.json`, change `"agentdb": "^2.0.0-alpha.2.20"` to `"agentdb": "^3.0.0-alpha.10"`. This aligns both consumers to the current published alpha track.

These patches are applied during the build after the scope-rename codemod but before `pnpm install`. The application order is: (1) codemod renames scopes, (2) semver conflict patches fix version ranges, (3) enhancement patches (FB-001, FB-002, MC-001) apply, (4) `pnpm install` resolves dependencies cleanly.

The specific version numbers in the patches (`^2.5.1`, `^3.0.0-alpha.10`) must be updated when upstream publishes new major versions of these packages. The build script should detect when the patched range no longer matches any published version and fail with a diagnostic message.

### Considered Alternatives

1. **Accept the breakage and let npm warn or fail** -- Rejected. Users would encounter install failures or runtime crashes on first use. This directly contradicts the goal of ruflo as a working drop-in replacement. Upstream has lived with these conflicts because the root `claude-flow` package bundles its own dist files and never triggers the conflicting resolution paths at install time. Our build actually resolves the full dependency tree, so the conflicts surface.

2. **Ignore and hope npm deduplication resolves it** -- Rejected. npm deduplication works by hoisting compatible versions. These ranges are mathematically incompatible -- no single version of `@ruvector/ruvllm` satisfies both `^0.2.3` and `>=2.5.1`, and no single version of `agentdb` satisfies both `2.0.0-alpha.3.7` (exact) and `>=3.0.0-alpha.10`. Deduplication cannot resolve what arithmetic cannot.

3. **Pin exact versions using pnpm `overrides` in the workspace root** -- Considered but rejected as primary approach. pnpm overrides work at install time but do not fix the published `package.json` files. When a user installs `ruflo`, their package manager sees the original (broken) ranges in the transitive dependencies. The fix must be in the published source, not in our build-time workspace configuration. However, pnpm overrides may be used as a belt-and-suspenders backup during the build itself.

4. **Remove the conflicting dependencies entirely** -- Rejected. `agentdb` is a core dependency of the memory system. `@ruvector/ruvllm` is used by `agentic-flow` for LLM routing. Removing them would break functionality.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Users can `npm install ruflo` without encountering semver resolution failures
- The fix is minimal -- changing version range strings in `package.json` files, not modifying application logic
- The patches follow the existing `patch/` infrastructure, so they benefit from sentinel verification and idempotency checks
- When upstream eventually fixes their own version ranges, the patches become no-ops (the codemod rewrites the file, the patch finds its target string is already correct, and skips)

**Negative:**

- The patched version ranges (`^2.5.1`, `^3.0.0-alpha.10`) are point-in-time values that may become stale as upstream packages publish new major versions
- If `@ruvector/ruvllm` publishes `3.0.0`, the `^2.5.1` range would not match it and would need updating
- We are making dependency range decisions on behalf of upstream, which could introduce runtime incompatibilities if the newer versions have breaking API changes that upstream code does not handle

**Edge cases:**

- If upstream fixes one conflict but not the other, the corresponding patch becomes a no-op while the other remains active. The patches are independent and this is handled correctly
- If `agentdb` publishes `4.0.0-alpha.1`, the `^3.0.0-alpha.10` range would not match. The build would fail at `pnpm install` with a clear error, prompting a patch update
- The `agentic-flow@3.0.0-alpha.1` version downgraded `agentdb` to `^1.4.3`. If our build uses the `3.0.0-alpha.1` source, the patch target string differs. The patch must target whichever version of `agentic-flow` is in the upstream HEAD at build time

### Completion (SPARC-C)

Acceptance criteria:

- [ ] Patch for `@ruvector/ruvllm` range exists in `patch/` and transforms `^0.2.3` to a range matching the current npm latest
- [ ] Patch for `agentdb` range in `@claude-flow/memory` exists in `patch/` and transforms the pin to a range matching the current npm latest
- [ ] Patch for `agentdb` range in `agentic-flow` exists in `patch/` and transforms the range to match the current npm latest
- [ ] `pnpm install` in the build directory completes without semver resolution errors
- [ ] `npm ls` in the built output shows no `ERESOLVE` or `invalid` warnings for `@ruvector/ruvllm` or `agentdb`
- [ ] Sentinel files verify each patch was applied
- [ ] The build script detects when patched ranges no longer match any published version and fails with a diagnostic message

# ADR-0012: Version numbering scheme

## Status

Accepted

## Context

### Specification (SPARC-S)

ruflo-patch tracks upstream `claude-flow`/`ruflo` but applies our own patches and enhancements. The version number must communicate two things:

1. **Which upstream version** this build is based on — so users know what upstream features and fixes are included
2. **Which iteration of our patches** is applied — so users can distinguish between multiple builds from the same upstream base

The version must be valid semver (required by npm), sortable, and self-documenting. It must work correctly with `npm install`, `npm outdated`, and `npx` resolution.

Our package name (`ruflo-patch`) is different from the upstream package names (`ruflo`, `claude-flow`, `@claude-flow/cli`), so we are not competing for the same version space on npm.

### Pseudocode (SPARC-P)

```
GIVEN upstream_version from the upstream package.json (e.g., "3.5.2")
GIVEN patch_iteration starting at 1, incrementing per build from same upstream base

version = "{upstream_version}-patch.{patch_iteration}"

# Examples:
# upstream 3.5.2, first build    -> 3.5.2-patch.1
# upstream 3.5.2, patch update   -> 3.5.2-patch.2
# upstream 3.5.3, first build    -> 3.5.3-patch.1
# upstream 3.5.3, patch update   -> 3.5.3-patch.2

# The patch_iteration resets to 1 when upstream_version changes
IF upstream_version != previous_upstream_version:
  patch_iteration = 1
ELSE:
  patch_iteration = previous_patch_iteration + 1
```

## Decision

### Architecture (SPARC-A)

Use the format `{upstream_version}-patch.{N}` for all ruflo-patch package versions.

Examples:

| Event | Upstream Version | ruflo-patch Version |
|-------|-----------------|---------------------|
| First build from `claude-flow@3.5.2` | 3.5.2 | `3.5.2-patch.1` |
| We update a patch | 3.5.2 | `3.5.2-patch.2` |
| We update another patch | 3.5.2 | `3.5.2-patch.3` |
| Upstream bumps to `3.5.3` | 3.5.3 | `3.5.3-patch.1` |
| We update a patch | 3.5.3 | `3.5.3-patch.2` |

The `-patch.N` counter resets to 1 when the upstream version changes. It increments whenever we publish a new build from the same upstream version — whether due to patch updates, build fixes, or pipeline changes.

**npm semver behavior**: `-patch.1` is a valid prerelease identifier under semver 2.0. Strictly speaking, `3.5.2-patch.1` sorts **lower** than `3.5.2` in semver comparison. This is acceptable because:

- Our package name (`ruflo-patch`) is different from upstream (`ruflo`/`claude-flow`) — there is no version space collision
- Within our own package, versions sort correctly: `3.5.2-patch.1 < 3.5.2-patch.2 < 3.5.3-patch.1`
- `npm install ruflo-patch@latest` resolves to whatever we've tagged as `latest`, regardless of semver sorting

The build script reads the upstream version from the source `package.json` and the current patch iteration from `scripts/.last-build-state` (see ADR-0011).

### Considered Alternatives

1. **Independent versioning (1.0.0, 1.0.1, ...)** — Rejected. Loses the connection to the upstream version entirely. Users cannot tell what upstream code they're running. "ruflo-patch@1.4.7" tells you nothing about whether it includes upstream 3.5.2 or 3.6.0.
2. **Date-based suffix (3.5.2-20260305)** — Rejected. Does not communicate patch iteration count. Multiple builds per day would collide unless you add a time component, making versions unwieldy (3.5.2-20260305T143022). Does not sort correctly across month boundaries without zero-padding.
3. **Git hash suffix (3.5.2-abc1234)** — Rejected. Not human-readable. Not sortable — you cannot tell which version is newer without looking up the commits. Violates the "self-documenting" requirement.
4. **`{upstream}-ruflo.{N}` format** — Considered. Functionally equivalent but `-patch.N` is more descriptive of what the suffix represents. "patch" communicates that this is the upstream code with patches applied. "ruflo" would be a branding decision, not a descriptive one.
5. **CalVer (2026.03.1, 2026.03.2)** — Rejected. Same problem as independent versioning — no upstream version visible. Also breaks the convention that npm packages use semver.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Users can immediately see what upstream version they're running by reading the version string
- The patch iteration count tells users how many builds have been made from the same upstream base — useful for tracking our enhancement history
- `npm outdated` comparisons are meaningful within the ruflo-patch package: `3.5.2-patch.1` is clearly older than `3.5.2-patch.3`
- When upstream bumps, the version jump from `3.5.2-patch.N` to `3.5.3-patch.1` is visually obvious
- The version string is self-documenting — no explanation needed for what `3.5.2-patch.2` means

**Negative:**

- The `-patch.N` prerelease identifier means `3.5.2-patch.1 < 3.5.2` in strict semver comparison. This has no practical impact because our package name is different from upstream, but it could confuse tools that perform cross-package version comparisons
- If upstream uses prerelease versions themselves (e.g., `3.6.0-alpha.1`), our version becomes `3.6.0-alpha.1-patch.1` — valid semver but visually noisy. Mitigation: we only track stable upstream releases

**Edge cases:**

- If upstream re-tags or force-pushes a version (changes the code at `3.5.2` without bumping), our `git ls-remote` detects the change and triggers a rebuild. We publish `3.5.2-patch.N+1` even though the upstream "version" didn't change — this is correct behavior, the content changed
- If we need to unpublish a bad version, `npm unpublish ruflo-patch@3.5.2-patch.2` removes exactly that version. The previous `3.5.2-patch.1` remains available
- Internal `@sparkleideas/*` scope packages use the same `{upstream_version}-patch.{N}` scheme, but each package tracks **its own upstream version** (see Cross-Repo Versioning below)

**Cross-repo versioning:**

The ruflo-patch ecosystem rebuilds packages from multiple upstream repos that have independent version numbers:

| Upstream Repo | Upstream Version | Our Package | Our Version |
|---------------|-----------------|-------------|-------------|
| `ruvnet/ruflo` | 3.5.2 | `ruflo-patch` | `3.5.2-patch.1` |
| `ruvnet/ruflo` | 3.5.2 | `@sparkleideas/cli` | `3.5.2-patch.1` |
| `ruvnet/agentic-flow` | 3.0.0-alpha.10 | `@sparkleideas/agentdb` | `3.0.0-alpha.10-patch.1` |
| `ruvnet/ruv-FANN` | 2.0.7 | `@sparkleideas/ruv-swarm` | `2.0.7-patch.1` |

The top-level `ruflo-patch` package version tracks the upstream `claude-flow`/`ruflo` version (the primary package). Internal `@sparkleideas/*` packages that come from other repos (`agentdb`, `agentic-flow`, `ruv-swarm`) use **their own upstream version** with the `-patch.N` suffix. This avoids the misleading situation where, for example, `@sparkleideas/agentdb` gets version `3.5.2-patch.1` when its upstream `agentdb` is actually at `3.0.0-alpha.10`

### Completion (SPARC-C)

Acceptance criteria:

- [ ] The build script reads upstream version from source `package.json`
- [ ] The build script reads and increments the patch iteration from state file
- [ ] The patch iteration resets to 1 when upstream version changes
- [ ] Published versions match the `{upstream}-patch.{N}` format
- [ ] `npm view ruflo-patch versions` shows correctly ordered versions
- [ ] `npm install ruflo-patch@3.5.2-patch.1` installs the exact specified version
- [ ] `npm install ruflo-patch@latest` installs the promoted version, not the highest semver
- [ ] Internal `@sparkleideas/*` packages from the `ruflo` repo use the same version as `ruflo-patch`
- [ ] Internal `@sparkleideas/*` packages from other repos track their own upstream version with `-patch.N`

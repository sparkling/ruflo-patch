# ADR-0014: Topological Publish Order

## Status

Accepted

## Context

### Specification (SPARC-S)

The dependency tree (documented in the versioning and packaging analysis, section 2) has 23 ruvnet packages across 5 dependency levels. Publishing to npm must happen bottom-up: a package cannot be installed if its dependencies have not been published yet. Cross-repo dependencies add complexity -- packages from the `ruvnet/agentic-flow` repo (e.g., `agentdb`, `agentic-flow`) must publish before packages from `ruvnet/ruflo` that depend on them.

The review report (C3) identified that no ADR specifies the publish order or handles partial failures. With ~26 packages to publish, a naive unordered publish will fail when npm cannot resolve unpublished dependencies during the `npm publish` dry-run integrity check.

### Pseudocode (SPARC-P)

```
DEFINE LEVELS = [
  // Level 0: NOT published -- use from public npm
  // ruvector, @ruvector/* are consumed as-is

  // Level 1: depends only on @ruvector/* (public npm)
  ["@sparkleideas/agentdb",
   "@sparkleideas/agentic-flow",
   "@sparkleideas/ruv-swarm"],

  // Level 2: depends on Level 1
  ["@sparkleideas/shared",
   "@sparkleideas/memory",
   "@sparkleideas/embeddings",
   "@sparkleideas/codex",
   "@sparkleideas/aidefence"],

  // Level 3: depends on Level 2
  ["@sparkleideas/neural",
   "@sparkleideas/hooks",
   "@sparkleideas/browser",
   "@sparkleideas/plugins",
   "@sparkleideas/providers",
   "@sparkleideas/claims"],

  // Level 4: depends on Level 3
  ["@sparkleideas/guidance",
   "@sparkleideas/mcp",
   "@sparkleideas/integration",
   "@sparkleideas/deployment",
   "@sparkleideas/swarm",
   "@sparkleideas/security",
   "@sparkleideas/performance",
   "@sparkleideas/testing"],

  // Level 5: root packages
  ["@sparkleideas/cli",
   "@sparkleideas/claude-flow",
   "ruflo"]
]

FUNCTION publishAll(levels, tag):
  FOR level in levels:
    FOR package in level:
      result = npmPublish(package, tag)
      IF result.failed:
        ghIssueCreate(package, result.error)
        RETURN FAILURE  // STOP -- do not publish next level
      sleep(2000)  // npm rate limit buffer
  RETURN SUCCESS
```

## Decision

### Architecture (SPARC-A)

The build script publishes packages in a strict topological order derived from the dependency tree. Packages within the same level have no mutual dependencies and can theoretically publish in parallel, but are published sequentially with a 2-second delay to respect npm rate limits.

**Level 0 -- External dependencies (NOT published):**

`ruvector`, `@ruvector/*` -- consumed from public npm as-is (see ADR-0008). These are the foundation of the tree but are not part of our publish pipeline.

**Level 1 -- Depends only on `@ruvector/*` (public npm):**

| Package | Key Dependencies |
|---------|-----------------|
| `@sparkleideas/agentdb` | `ruvector`, `@ruvector/core`, `@ruvector/graph-transformer` |
| `@sparkleideas/agentic-flow` | `@ruvector/core`, `@ruvector/router`, `@ruvector/ruvllm` |
| `@sparkleideas/ruv-swarm` | `better-sqlite3`, `ws`, `uuid` (no ruvnet deps) |

**Level 2 -- Depends on Level 1:**

| Package | Key Dependencies |
|---------|-----------------|
| `@sparkleideas/shared` | None within our scope (utility package) |
| `@sparkleideas/memory` | `@sparkleideas/agentdb` |
| `@sparkleideas/embeddings` | None within our scope |
| `@sparkleideas/codex` | None within our scope |
| `@sparkleideas/aidefence` | None within our scope |

**Level 3 -- Depends on Level 2:**

| Package | Key Dependencies |
|---------|-----------------|
| `@sparkleideas/neural` | `@sparkleideas/memory`, `@ruvector/sona` |
| `@sparkleideas/hooks` | `@sparkleideas/memory`, `@sparkleideas/neural`, `@sparkleideas/shared` |
| `@sparkleideas/browser` | None within our scope |
| `@sparkleideas/plugins` | None within our scope |
| `@sparkleideas/providers` | None within our scope |
| `@sparkleideas/claims` | None within our scope |

**Level 4 -- Depends on Level 3:**

| Package | Key Dependencies |
|---------|-----------------|
| `@sparkleideas/guidance` | `@sparkleideas/hooks`, `@sparkleideas/memory`, `@sparkleideas/shared` |
| `@sparkleideas/mcp` | `@sparkleideas/shared` |
| `@sparkleideas/integration` | `@sparkleideas/shared` |
| `@sparkleideas/deployment` | `@sparkleideas/shared` |
| `@sparkleideas/swarm` | `@sparkleideas/shared` |
| `@sparkleideas/security` | `@sparkleideas/shared` |
| `@sparkleideas/performance` | `@sparkleideas/shared` |
| `@sparkleideas/testing` | `@sparkleideas/shared` |

**Level 5 -- Root packages:**

| Package | Key Dependencies |
|---------|-----------------|
| `@sparkleideas/cli` | Everything above (direct and transitive) |
| `@sparkleideas/claude-flow` | `@sparkleideas/cli` (wrapper) |
| `ruflo` | `@sparkleideas/claude-flow` (top-level wrapper) |

**Partial failure handling:**

If a package at level N fails to publish, the script stops immediately. It does NOT attempt to publish level N+1 packages, because those depend on level N and would fail with unresolvable dependencies. The script creates a GitHub Issue with the failure details (package name, npm error output, build log excerpt).

Already-published packages at level N (before the failure) are orphaned prereleases. This is harmless -- users on `@latest` are unaffected, and the orphaned prereleases will be superseded by the next successful build.

**npm rate limiting:**

A 2-second delay is inserted between each `npm publish` call. With ~26 packages, the total publish phase takes approximately 52 seconds. This avoids triggering npm's rate limiter, which can return 429 errors and block subsequent publishes for minutes.

**Publish loop pseudocode:**

```javascript
const LEVELS = [
  // Level 1
  ['@sparkleideas/agentdb', '@sparkleideas/agentic-flow', '@sparkleideas/ruv-swarm'],
  // Level 2
  ['@sparkleideas/shared', '@sparkleideas/memory', '@sparkleideas/embeddings',
   '@sparkleideas/codex', '@sparkleideas/aidefence'],
  // Level 3
  ['@sparkleideas/neural', '@sparkleideas/hooks', '@sparkleideas/browser',
   '@sparkleideas/plugins', '@sparkleideas/providers', '@sparkleideas/claims'],
  // Level 4
  ['@sparkleideas/guidance', '@sparkleideas/mcp', '@sparkleideas/integration',
   '@sparkleideas/deployment', '@sparkleideas/swarm', '@sparkleideas/security',
   '@sparkleideas/performance', '@sparkleideas/testing'],
  // Level 5
  ['@sparkleideas/cli', '@sparkleideas/claude-flow', 'ruflo'],
];

async function publishAll(tag) {
  for (const [levelIndex, packages] of LEVELS.entries()) {
    for (const pkg of packages) {
      const pkgDir = resolvePackageDir(pkg);
      const result = await exec(`npm publish --tag ${tag}`, { cwd: pkgDir });

      if (result.exitCode !== 0) {
        await createGitHubIssue({
          title: `Publish failed: ${pkg} at level ${levelIndex + 1}`,
          body: `npm publish exited with code ${result.exitCode}.\n\n` +
                `\`\`\`\n${result.stderr}\n\`\`\`\n\n` +
                `Packages at levels ${levelIndex + 2}-5 were NOT published.`,
        });
        return { success: false, failedAt: pkg, level: levelIndex + 1 };
      }

      // Rate limit buffer
      await sleep(2000);
    }
  }
  return { success: true };
}
```

### Considered Alternatives

1. **Parallel publish within each level** -- Rejected for now. Packages within a level have no mutual dependencies, so parallel publish is theoretically safe. However, npm rate limiting makes this risky -- 5 concurrent publishes could trigger a 429. The sequential approach with 2-second delays is simple and reliable. Can be revisited if publish time becomes a bottleneck.

2. **Publish all at once, rely on npm to resolve** -- Rejected. npm's `npm publish` performs an integrity check that verifies dependencies exist in the registry. Publishing a package before its dependencies exist causes the publish to fail with `ETARGET` or similar errors. Even with `--no-dry-run`, consumers cannot install the package until its deps are available.

3. **Use a monorepo publish tool (Lerna, Changesets, Turborepo)** -- Rejected. These tools assume the packages are in a single workspace with a unified lockfile. Our packages span 3 upstream repos (ruflo, agentic-flow, ruv-FANN) that are built independently. Wiring them into a single workspace for the publish step adds complexity without benefit -- the topological order is static and known.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Deterministic publish order eliminates `ETARGET` resolution failures
- Stop-on-failure prevents cascading errors from trying to publish packages with missing deps
- GitHub Issue on failure provides immediate visibility and actionable context
- 2-second delay is a conservative buffer that avoids npm rate limiting without significantly increasing total publish time
- The level assignments are derived directly from the dependency tree -- no guesswork

**Negative:**

- If the dependency tree changes upstream (new packages, new cross-dependencies), the level assignments must be updated manually. This is mitigated by the fact that new packages are rare and the tree is relatively stable.
- Sequential publish with delays means the publish phase takes ~52 seconds. This is acceptable for a build that runs every 6 hours.
- A failure at level 1 blocks all 26 packages. This is the correct behavior -- partial publishes with missing deps are worse than no publish at all.

**Trade-offs and edge cases:**

- **Cross-repo ordering**: `@sparkleideas/agentdb` (from `ruvnet/agentic-flow`) must publish before `@sparkleideas/memory` (from `ruvnet/ruflo`). The build script must build and publish packages from multiple upstream repos in a single orchestrated run, not per-repo.
- **Optional dependencies**: Many `@claude-flow/*` packages list others as `optionalDependencies`. npm does not fail if an optional dependency is missing from the registry. However, publishing bottom-up ensures optional deps are available if they exist in our scope.
- **Orphaned prereleases**: If level 3 publishes 4 of 6 packages before the 5th fails, those 4 are on npm under the `prerelease` tag. They are installable but their level 3 siblings and all level 4-5 packages are missing. Users on `@latest` see the previous complete set. The orphaned prereleases are harmless and will be superseded by the next successful build.

### Completion (SPARC-C)

- [ ] Publish script implements the 5-level topological order
- [ ] Packages within each level publish sequentially with 2-second delay
- [ ] Script stops immediately on first publish failure
- [ ] GitHub Issue is created on failure with package name, level, and error output
- [ ] Level assignments verified against current upstream dependency tree
- [ ] Cross-repo packages (agentdb, agentic-flow, ruv-swarm) are at level 1 and publish first
- [ ] Root packages (cli, claude-flow, ruflo) are at level 5 and publish last
- [ ] End-to-end test: publish all packages to a local Verdaccio instance in topological order
- [ ] Total publish time under 2 minutes (26 packages x ~4s each including delay)

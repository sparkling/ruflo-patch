# ADR-0012: Version numbering scheme

## Status

Accepted (rewritten 2026-03-06 — supersedes `-patch.N` scheme)

## Context

### Specification (SPARC-S)

ruflo tracks upstream `claude-flow`/`ruflo` but applies our own patches and enhancements. The version number must:

1. Be **valid semver** that resolves against caret ranges (`^`) — so `@sparkleideas/cli` depending on `@sparkleideas/aidefence@^3.0.2` can resolve against the published version
2. Be **strictly greater** than both the upstream version and any previously published version — monotonically increasing
3. Support unlimited rebuilds from the same upstream base without collisions

The previous scheme (`{upstream}-patch.{N}`) used a prerelease identifier, which npm does not match against caret ranges. This broke `npx @sparkleideas/cli` with `ETARGET` errors because `^3.0.2` does not match `3.0.2-patch.1`.

### Pseudocode (SPARC-P)

```
GIVEN upstream_version from the package's own package.json
GIVEN last_published from config/published-versions.json (per package)

next_version = bump_last_segment( max(upstream_version, last_published) )

# Examples (stable versions):
# upstream 3.0.2, never published  -> max(3.0.2, —)     = 3.0.2 -> 3.0.3
# upstream 3.0.2, last pub 3.0.3   -> max(3.0.2, 3.0.3) = 3.0.3 -> 3.0.4
# upstream 3.0.3, last pub 3.0.4   -> max(3.0.3, 3.0.4) = 3.0.4 -> 3.0.5
# upstream 3.0.5, last pub 3.0.5   -> max(3.0.5, 3.0.5) = 3.0.5 -> 3.0.6

# Examples (prerelease versions):
# upstream 3.0.0-alpha.6, never published -> 3.0.0-alpha.7
# upstream 3.0.0-alpha.6, last pub 3.0.0-alpha.7 -> 3.0.0-alpha.8
# upstream 3.0.0-alpha.7, last pub 3.0.0-alpha.8 -> 3.0.0-alpha.9
```

## Decision

### Architecture (SPARC-A)

Use **bump-last-segment** versioning: increment the final numeric component of `max(upstream, lastPublished)`. Each package tracks its own version independently via `config/published-versions.json`.

**Why this works**:

- Always > upstream (we bump from max, which is >= upstream) -> matches `^upstream` caret ranges
- Always > last publish (we bump from max, which is >= last publish) -> monotonically increasing
- No collision with ourselves (always strictly greater than last published)
- No collision with upstream (different npm scope)
- Valid semver, sortable, no prerelease ambiguity for stable versions
- Supports unlimited rebuilds from the same upstream base

**Version examples**:

| Event | Upstream | Last Published | max() | Publish |
|-------|----------|---------------|-------|---------|
| First build | `3.0.2` | — | `3.0.2` | `3.0.3` |
| Rebuild (same upstream) | `3.0.2` | `3.0.3` | `3.0.3` | `3.0.4` |
| Upstream bumps | `3.0.3` | `3.0.4` | `3.0.4` | `3.0.5` |
| Upstream jumps | `3.0.5` | `3.0.5` | `3.0.5` | `3.0.6` |

**Per-package tracking**:

Each `@sparkleideas/*` package tracks its own upstream version and its own publish history. No single "primary version" is stamped across all packages:

| Upstream Repo | Our Package | Upstream Version | Our Version |
|---------------|-------------|-----------------|-------------|
| `ruvnet/ruflo` | `@sparkleideas/cli` | 3.1.0-alpha.14 | `3.1.0-alpha.15` |
| `ruvnet/ruflo` | `@sparkleideas/aidefence` | 3.0.2 | `3.0.3` |
| `ruvnet/agentic-flow` | `@sparkleideas/agentdb` | 3.0.0-alpha.6 | `3.0.0-alpha.7` |
| `ruvnet/ruv-FANN` | `@sparkleideas/ruv-swarm` | 1.0.18 | `1.0.19` |

**State file**: `config/published-versions.json` tracks the last published version per package. Updated after each successful publish. Committed to git so state persists across machines.

```json
{
  "@sparkleideas/aidefence": "3.0.3",
  "@sparkleideas/cli": "3.1.0-alpha.15",
  "@sparkleideas/shared": "3.0.0-alpha.7"
}
```

**Git tagging**: `sparkleideas/v{cli-version}` per build (e.g., `sparkleideas/v3.1.0-alpha.15`). Uses the CLI package version as the primary tag. `git tag -l 'sparkleideas/*'` lists our releases separately from upstream.

### Considered Alternatives

1. **`{upstream}-patch.{N}` (previous scheme)** — Rejected. The `-patch.N` suffix is a prerelease identifier. npm won't match `3.0.2-patch.1` against `^3.0.2`. This broke dependency resolution across the 24-package ecosystem.
2. **Independent versioning (1.0.0, 1.0.1, ...)** — Rejected. Loses the connection to the upstream version entirely.
3. **Date-based suffix** — Rejected. Not sortable across months without zero-padding, doesn't communicate patch iteration.
4. **Git hash suffix** — Rejected. Not human-readable, not sortable.
5. **CalVer** — Rejected. No upstream version visible, breaks npm semver convention.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Caret ranges (`^3.0.2`) resolve correctly — no more `ETARGET` errors
- Each package version clearly communicates it's "one past upstream" (3.0.3 for upstream 3.0.2)
- Per-package tracking eliminates the misleading situation where `@sparkleideas/agentdb` got version `3.5.2-patch.1` when its upstream is actually `3.0.0-alpha.6`
- `config/published-versions.json` provides a single source of truth for what's published
- Unlimited rebuilds from the same upstream base (each publish bumps from the last)

**Negative:**

- Our version numbers are close to upstream's version space. Since we use a different npm scope (`@sparkleideas` vs `@claude-flow`), there is no actual collision, but the versions might look confusingly similar
- If upstream publishes the exact version we used (e.g., upstream publishes `3.0.3` after we already published `@sparkleideas/aidefence@3.0.3`), there is no npm collision (different scope) but it may be confusing to humans

### Completion (SPARC-C)

Acceptance criteria:

- [x] `publish.mjs` computes per-package versions using `nextVersion(upstream, lastPublished)`
- [x] `config/published-versions.json` is updated after each successful publish
- [x] Published versions match caret ranges in dependent packages
- [x] `npm test` passes with updated version computation tests
- [x] No `-patch.N` versions are published going forward
- [x] Git tags use `sparkleideas/v{version}` format

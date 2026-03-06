# ADR-0019: Rollback Procedure

## Status

Accepted

## Context

### Specification (SPARC-S)

If a version promoted to `@latest` on npm turns out to be broken, users running `npx ruflo` will get the broken version. npm does not support "unpromoting" a dist-tag -- `latest` is simply a pointer to a specific version. The only way to stop users from getting a broken version is to point `latest` at a different (known-good) version.

There is no ADR documenting how to revert a bad promotion. Without a defined procedure, a panicked maintainer might attempt `npm unpublish` (which has a 72-hour window and removes the version entirely) or `npm deprecate` (which prints a warning but does not prevent installation). Neither is the correct first response.

This addresses review issue S5 from the ADR review report.

### Pseudocode (SPARC-P)

```
ON discovery of broken @latest:

  # Step 1: Identify the last known-good version
  GOOD_VERSION = read from scripts/.last-promoted-version
  # e.g., "3.5.3"

  # Step 2: Reassign @latest to the known-good version
  npm dist-tag add ruflo@${GOOD_VERSION} latest
  FOR each pkg IN @sparkleideas/* packages:
    npm dist-tag add @sparkleideas/${pkg}@${GOOD_VERSION} latest

  # Step 3: Optionally remove the broken version
  IF within 72 hours of publish:
    npm unpublish ruflo@${BAD_VERSION}
    FOR each pkg IN @sparkleideas/* packages:
      npm unpublish @sparkleideas/${pkg}@${BAD_VERSION}
  ELSE:
    npm deprecate ruflo@${BAD_VERSION} "Known broken, use @latest"

  # Step 4: Fix and republish
  FIX the issue in patches or build pipeline
  TRIGGER a new build -> publishes as prerelease
  TEST the prerelease
  PROMOTE to @latest
```

## Decision

### Architecture (SPARC-A)

Rollback is a dist-tag reassignment, not an unpublish. The procedure has four phases: identify, reassign, optionally remove, and fix forward.

**Phase 1: Identify the rollback target.**

The promotion script (`scripts/promote.sh`) maintains a file at `scripts/.last-promoted-version` that records the version string of the most recent successful promotion to `@latest`. This file is updated atomically (write to temp file, then `mv`) every time `promote.sh` runs. The rollback target is always the previous value of this file. Note: the automated build pipeline does NOT update this file — it only publishes to the `prerelease` dist-tag. The file is only created/updated when a maintainer manually promotes a prerelease to `@latest`.

Example contents:

```
3.5.3
```

If this file is missing or corrupt, the rollback target can be determined from npm:

```bash
npm view ruflo versions --json | jq -r '.[-2]'
```

Or by checking the GitHub releases page for the second-most-recent non-prerelease.

**Phase 2: Reassign the `latest` dist-tag.**

```bash
GOOD_VERSION=$(cat scripts/.last-promoted-version)

# Reassign the top-level package
npm dist-tag add ruflo@${GOOD_VERSION} latest

# Reassign all scoped packages
for pkg in cli memory shared hooks neural guidance mcp embeddings \
           codex aidefence claims plugins providers deployment \
           swarm security performance testing integration browser; do
  npm dist-tag add @sparkleideas/${pkg}@${GOOD_VERSION} latest
done
```

This takes effect immediately. Users who run `npx ruflo@latest` after this point get the known-good version. No cache busting is needed -- npm dist-tags are resolved server-side on every install.

**Phase 3: Optionally remove or deprecate the broken version.**

- **Within 72 hours of publish**: `npm unpublish ruflo@${BAD_VERSION}` removes the version entirely. This must be done for every `@sparkleideas/*` package at the same version. After unpublish, the version number cannot be reused for 24 hours.
- **After 72 hours**: npm does not allow unpublish. Instead, deprecate the version with a message: `npm deprecate ruflo@${BAD_VERSION} "Known broken -- use ruflo@latest"`. This prints a warning on install but does not prevent it.
- **If the version is merely suboptimal (not broken)**: Do nothing. Leave it as an orphan version that nobody gets because `latest` no longer points to it. Users who pinned to the exact version continue to get it, which may be acceptable.

**Phase 4: Fix forward.**

The broken version resulted from either an upstream change, a patch regression, or a build pipeline error. Fix the root cause, trigger a new build (or wait for the next timer run), verify the prerelease, and promote the new version to `@latest`. Update `.last-promoted-version` with the new version.

**Rollback script.**

A convenience script at `scripts/rollback.sh` automates Phases 1 and 2:

```bash
#!/usr/bin/env bash
set -euo pipefail

GOOD_VERSION="${1:-$(cat scripts/.last-promoted-version)}"

echo "Rolling back @latest to ${GOOD_VERSION}"

npm dist-tag add "ruflo@${GOOD_VERSION}" latest

for pkg in cli memory shared hooks neural guidance mcp embeddings \
           codex aidefence claims plugins providers deployment \
           swarm security performance testing integration browser; do
  echo "  @sparkleideas/${pkg}@${GOOD_VERSION}"
  npm dist-tag add "@sparkleideas/${pkg}@${GOOD_VERSION}" latest
done

echo "Rollback complete. Verify with: npx ruflo@latest --version"
```

**Rollback checklist:**

1. Confirm the broken version: `npx ruflo@latest --version` shows the bad version
2. Identify the rollback target: `cat scripts/.last-promoted-version`
3. Run `bash scripts/rollback.sh` (or execute Phase 2 manually)
4. Verify: `npm view ruflo dist-tags` shows `latest` pointing to the good version
5. Verify: `npx ruflo@latest --version` shows the good version
6. Optionally unpublish or deprecate the bad version (Phase 3)
7. Investigate, fix, and publish a corrected version (Phase 4)
8. Update `.last-promoted-version` after promoting the corrected version

### Considered Alternatives

1. **Always unpublish broken versions immediately** -- Rejected. `npm unpublish` has a 72-hour window. After that, the version is permanent. Building a procedure around a time-limited operation is fragile. Dist-tag reassignment is instant, has no time limit, and achieves the same user-facing result (users on `@latest` stop getting the broken version).

2. **Use npm `deprecate` as the primary rollback mechanism** -- Rejected. `npm deprecate` prints a warning but does not prevent installation. Users on `@latest` would still get the deprecated version until the dist-tag is reassigned. Deprecation is a supplementary action, not a rollback.

3. **Maintain multiple dist-tags (stable, beta, nightly) for gradual rollout** -- Rejected as premature. The current flow (prerelease + manual promotion) already provides a two-tier gate. Adding more tiers increases complexity without proportional benefit for a single-maintainer project. Revisit if the user base grows.

4. **Automated rollback on error reports** -- Rejected. There is no telemetry or error reporting infrastructure. Automated rollback without reliable signal data risks rolling back working versions based on false positives. Manual rollback is appropriate for the current scale.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Rollback takes less than 60 seconds -- one script invocation reassigns all dist-tags
- Users on `@latest` are protected immediately after rollback -- no propagation delay
- The `.last-promoted-version` file ensures the rollback target is always known, even if the maintainer does not remember the previous version
- The procedure works identically regardless of when the breakage is discovered (unlike `npm unpublish` which has a 72-hour deadline)

**Negative:**

- The broken version remains installable by exact version (`npm install ruflo@3.5.4`) unless explicitly unpublished or deprecated. This is acceptable -- users who pin exact versions accept the risk
- Rolling back all `@sparkleideas/*` packages requires iterating through the package list. If the list changes (new packages added), the rollback script must be updated
- If `.last-promoted-version` is not maintained (e.g., a manual promotion bypasses the script), the rollback target is unknown and must be determined manually from npm version history

**Edge cases:**

- If the broken version is the first-ever version (no previous version to roll back to), the only option is `npm unpublish` (within 72 hours) or rapid fix-forward. This scenario is mitigated by the first-publish bootstrap procedure (ADR-0018) which includes manual verification before the first build enters the automated pipeline
- If `npm dist-tag add` fails (network error, expired token), retry. Dist-tag operations are idempotent -- running the same command twice has no adverse effect
- If different `@sparkleideas/*` packages were published at different versions (e.g., partial publish failure), rollback to a version where all packages were in sync. The build script publishes all packages at the same version (ADR-0012), so this should not occur under normal operation
- npm caches dist-tag resolution for a short period. Users who install within seconds of the rollback may still get the broken version from their local npm cache. Running `npm cache clean --force` resolves this, but most users will not need to -- the cache TTL is short

### Completion (SPARC-C)

Acceptance criteria:

- [x] `scripts/.last-promoted-version` is updated atomically on every promotion to `@latest` (via `promote.sh`)
- [x] `scripts/rollback.sh` exists and reassigns `latest` for `ruflo` and all `@sparkleideas/*` packages
- [x] Running `rollback.sh` with a valid version argument completes in under 60 seconds
- [x] After dist-tag fix, `npm view @sparkleideas/cli dist-tags` shows `latest` pointing to correct version
- [ ] After rollback, `npx @sparkleideas/cli@latest --version` returns the rollback target version
- [x] The rollback checklist is documented in this ADR and can be followed without prior knowledge
- [x] The promotion script updates `.last-promoted-version` before any other post-promotion action

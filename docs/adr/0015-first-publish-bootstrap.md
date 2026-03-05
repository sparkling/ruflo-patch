# ADR-0015: First-Publish Bootstrap

## Status

Accepted

## Context

### Specification (SPARC-S)

ADR-0010 establishes a prerelease publish gate: automated builds publish with `npm publish --tag prerelease`, and a human manually promotes to `@latest` via `npm dist-tag add`. This workflow assumes that a `latest` dist-tag already exists for each package.

The review report (C1) identified a critical bootstrap problem: on the first-ever publish of a package, `npm publish --tag prerelease` sets only the `prerelease` dist-tag. It does NOT set `latest`. This means:

- `npx ruflo` resolves `@latest` -- which does not exist -- and returns a 404
- `npm install ruflo` fails with `ETARGET` because no version matches the default `latest` range
- `npm install ruflo@prerelease` works, but no user will know to type that

Every package in the `@sparkleideas` scope and the `ruflo` package itself will be published for the first time. All 26 packages hit this problem simultaneously.

### Pseudocode (SPARC-P)

```
FUNCTION publishPackage(name, directory, preferredTag):
  isFirstPublish = NOT npmViewSucceeds(name)

  IF isFirstPublish:
    // First publish: npm publish with no --tag flag
    // npm defaults to setting the "latest" dist-tag
    npmPublish(directory)
  ELSE:
    // Subsequent publishes: use prerelease gate
    npmPublish(directory, tag=preferredTag)

FUNCTION npmViewSucceeds(name):
  result = exec("npm view " + name + " version")
  RETURN result.exitCode == 0
```

## Decision

### Architecture (SPARC-A)

The build script detects whether each package has ever been published to npm. For never-published packages, it uses `npm publish` with no `--tag` flag. For already-published packages, it uses `npm publish --tag prerelease` (the normal prerelease gate from ADR-0010).

**Detection method:**

```bash
npm view <package-name> version 2>/dev/null
```

If this command exits with a non-zero status (the package does not exist on npm), the package has never been published. If it exits with status 0 and returns a version string, the package has been published before.

**First publish behavior:**

`npm publish` with no `--tag` flag. npm's default behavior is to set the `latest` dist-tag on the published version. After this command, both `npm install <package>` and `npx <package>` resolve correctly.

**Subsequent publish behavior:**

`npm publish --tag prerelease` as defined in ADR-0010. The `latest` dist-tag remains on the previously promoted version. Users on `@latest` are unaffected.

**Bootstrap detection pseudocode:**

```javascript
async function getPublishTag(packageName) {
  try {
    // Check if the package exists on npm
    await exec(`npm view ${packageName} version`);
    // Package exists -- use prerelease gate
    return 'prerelease';
  } catch {
    // Package does not exist -- first publish, use default (sets latest)
    return null; // null means: no --tag flag
  }
}

async function publishPackage(packageName, packageDir) {
  const tag = await getPublishTag(packageName);
  const tagFlag = tag ? `--tag ${tag}` : '';
  const result = await exec(`npm publish ${tagFlag}`, { cwd: packageDir });

  if (result.exitCode !== 0) {
    throw new PublishError(packageName, result.stderr);
  }

  if (!tag) {
    console.log(`First publish of ${packageName} -- "latest" dist-tag set automatically`);
  } else {
    console.log(`Published ${packageName} with tag "${tag}"`);
  }
}
```

**Integration with topological publish (ADR-0014):**

The bootstrap detection runs per-package inside the publish loop. Each package independently determines whether it needs a first-publish or a prerelease-gated publish. This handles the case where a previous build partially completed (some packages published, others not).

**After the first full publish cycle:**

All 26 packages have a `latest` dist-tag. The bootstrap detection returns `'prerelease'` for every package. The build script behaves identically to the steady-state flow described in ADR-0010. The bootstrap logic remains in the code but is effectively a no-op.

### Considered Alternatives

1. **Always publish with `--tag prerelease`, then manually run `npm dist-tag add` for every package** -- Rejected. The first publish requires 26 manual `npm dist-tag add` commands (one per package) plus the `ruflo` top-level package. This is error-prone -- missing a single package means `npm install` fails for any consumer that transitively depends on it. The bootstrap detection automates this entirely.

2. **Publish with `--tag latest` explicitly on first run** -- Rejected as unnecessary. `npm publish` with no `--tag` flag defaults to `latest`. Explicitly passing `--tag latest` achieves the same result but introduces a flag that could accidentally be left in place for subsequent runs, bypassing the prerelease gate. The absence of `--tag` is the clearest signal that this is a first-publish.

3. **Use a local state file to track first-publish status** -- Rejected. A state file (`published-packages.json`) would need to be committed to the repo or stored on the build server. If the file is lost or the build runs on a different machine, it must be reconstructed. Querying npm directly (`npm view`) is stateless, authoritative, and requires no local bookkeeping.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- First publish "just works" -- no manual intervention required for 26 packages
- Detection is stateless -- the build script queries npm directly, no local state files to maintain
- Bootstrap logic is a single `npm view` call per package -- negligible overhead (~1 second per package, ~26 seconds total)
- After the first cycle, the detection becomes a no-op and the normal prerelease gate takes over
- Partial bootstrap is handled correctly -- if a previous run published 10 of 26 packages, the next run detects which 10 exist and uses prerelease for them, while first-publishing the remaining 16

**Negative:**

- The first publish of every package goes directly to `@latest`. There is no prerelease review step for the initial versions. This is acceptable because the first publish is a known, planned event -- not an automated reaction to upstream changes.
- If npm is temporarily unavailable during the `npm view` check, the command may fail with a network error rather than a clean "not found" exit code. The script must distinguish between "package does not exist" (exit code 1, `E404`) and "npm is down" (network error). Only `E404` should trigger first-publish behavior.

**Trade-offs and edge cases:**

- **npm view returns E404 for unpublished packages**: This is the expected behavior. The script checks the exit code, not the output format. Both `npm view <pkg> version` (single version) and `npm view <pkg> versions` (array) return E404 for non-existent packages.
- **Scoped packages require scope access**: `npm publish` for `@sparkleideas/*` packages requires that the npm account has publish access to the `@sparkleideas` scope. This is a one-time setup step (register the scope on npmjs.com) and is not repeated per package.
- **Race condition on first run**: If two build processes run simultaneously (unlikely with systemd timer, but possible with manual trigger), both may detect a package as "never published" and attempt first-publish. The second `npm publish` will fail with `EPUBLISHCONFLICT` (version already exists). This is a benign failure -- the package is already published by the first process. The retry logic in the publish loop handles this gracefully.

### Completion (SPARC-C)

- [ ] Build script calls `npm view <package> version` before each publish to detect first-publish status
- [ ] Never-published packages use `npm publish` with no `--tag` flag (sets `latest` automatically)
- [ ] Already-published packages use `npm publish --tag prerelease` (ADR-0010 gate)
- [ ] Script distinguishes npm `E404` (package not found) from network errors
- [ ] After first full publish, `npm view ruflo version` returns a version
- [ ] After first full publish, `npx ruflo --version` succeeds
- [ ] After first full publish, all 26 packages have a `latest` dist-tag
- [ ] Subsequent builds use `--tag prerelease` for all packages (bootstrap detection returns prerelease)
- [ ] Partial bootstrap scenario tested: publish 5 packages, stop, re-run -- remaining 21 get first-publish, 5 get prerelease

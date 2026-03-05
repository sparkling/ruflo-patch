# ADR-0011: Dual build trigger (upstream + local patches)

## Status

Accepted

## Context

### Specification (SPARC-S)

The build pipeline (ADR-0009) must detect changes from two independent sources:

1. **Upstream repos** — `ruvnet/ruflo`, `ruvnet/agentic-flow`, `ruvnet/ruv-FANN` receive new commits from their maintainers
2. **This repo** — we push new or updated patches to `patch/`, update build scripts in `scripts/`, or modify pipeline configuration

Either source of change should trigger a full rebuild. If neither has changed, the build should exit early to avoid wasting resources and publishing duplicate versions.

The detection must be cheap (no full clones) and reliable (no false negatives that cause missed builds or false positives that cause duplicate publishes).

### Pseudocode (SPARC-P)

```
LOAD state from scripts/.last-build-state
  # Contains: LAST_RUFLO_HEAD, LAST_AF_HEAD, LAST_FANN_HEAD, LAST_LOCAL_COMMIT

changed = false

# Check upstream repos
FOR repo IN [ruflo, agentic-flow, ruv-FANN]:
  current_head = git ls-remote <repo_url> HEAD | cut -f1
  IF current_head != state[repo].last_head:
    changed = true
    log "Upstream change detected in {repo}: {state[repo].last_head} -> {current_head}"

# Check local changes
local_changes = git log {LAST_LOCAL_COMMIT}..HEAD --oneline -- patch/ scripts/
IF local_changes is not empty:
  changed = true
  log "Local changes detected: {local_changes}"

IF not changed:
  log "No changes detected, exiting"
  EXIT 0

# Proceed with full build...
# After successful publish:
SAVE state to scripts/.last-build-state
```

## Decision

### Architecture (SPARC-A)

The `scripts/sync-and-build.sh` script checks both upstream and local sources before deciding whether to build. It maintains a state file at `scripts/.last-build-state` containing the last-built commit hash for each monitored source.

**Upstream detection** uses `git ls-remote` to compare the current HEAD of each upstream fork against the last-built HEAD. This is a single HTTP request per repo — no clone or fetch required.

**Local detection** uses `git log LAST_BUILD_COMMIT..HEAD -- patch/ scripts/` to check for commits that modified the patch or pipeline directories since the last successful build.

If either check detects changes, the script proceeds with a full rebuild. If neither detects changes, it exits immediately.

The state file format:

```
RUFLO_HEAD=abc1234def5678...
AGENTIC_FLOW_HEAD=def5678abc1234...
RUV_FANN_HEAD=123abc456def...
LOCAL_COMMIT=789def012abc...
BUILD_TIMESTAMP=2026-03-05T00:00:00Z
BUILD_VERSION=3.5.2-patch.1
```

The state file is updated only after a successful publish. If the build fails, the state is not updated, ensuring the next timer run retries the same changes.

### Considered Alternatives

1. **Only watch upstream, require manual trigger for patch changes** — Rejected. Easy to forget after pushing a patch. Creates drift between pushed patches and published packages. Defeats the automation goal — you'd need to remember to SSH in after every `git push`.
2. **Separate pipelines for upstream vs local** — Rejected. Unnecessary complexity. Both trigger sources result in the same build steps (codemod, patch, build, test, publish). Two pipelines means two sets of failure modes, two notification paths, and potential race conditions if both trigger simultaneously.
3. **File watcher (inotify) on patch/ directory** — Rejected. Does not work reliably for `git push` — files change atomically during merge operations. More fragile than `git log`. Also requires a long-running daemon, unlike the timer-based approach.
4. **Webhook from GitHub on push to ruflo** — Rejected. Adds external dependency (GitHub must be able to reach our server). Requires exposing an HTTP endpoint. Solves only the local trigger — still need polling for upstream repos we don't control.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Pushing a new patch to this repo automatically triggers a rebuild within 6 hours (or immediately via manual `./scripts/sync-and-build.sh`)
- No additional steps required beyond `git push` — the pipeline discovers the change
- The same pipeline handles both trigger sources identically, reducing code and failure modes
- `git ls-remote` is lightweight — a single HTTP request per repo, no data transfer
- `git log` with path filtering is fast even on large repos
- State file persists across reboots (plain text on disk)

**Negative:**

- Up to 6 hours latency between pushing a patch and the automated build picking it up. Mitigation: run the script manually for immediate builds
- If `git ls-remote` fails (network down, GitHub outage), the check reports "no changes" — a false negative. Mitigation: the script should treat network errors as "unknown" and either retry or proceed with a build
- The state file must be kept in sync with actual published versions. If manually deleted, the next run rebuilds everything (safe but wasteful)

**Edge cases:**

- If upstream pushes AND we push patches in the same 6-hour window, the build incorporates both — this is correct behavior
- If we revert a patch (commit that modifies `patch/`), this counts as a local change and triggers a rebuild — correct, the published package should reflect the revert
- If someone force-pushes upstream (changes HEAD to a different commit with the same tree), `git ls-remote` detects it as a change even though the content is identical. The rebuild is redundant but harmless
- Monitoring `ruvnet/ruvector` is intentionally excluded — we use published `@ruvector/*` packages from public npm as-is

### Completion (SPARC-C)

Acceptance criteria:

- [ ] `scripts/.last-build-state` is created after the first successful build
- [ ] Upstream change detection works: manually advancing a stored HEAD hash triggers a rebuild
- [ ] Local change detection works: committing to `patch/` or `scripts/` triggers a rebuild
- [ ] No-change case works: running the script twice with no changes exits early on the second run
- [ ] State file is updated only after successful publish (failed builds leave state unchanged)
- [ ] Network errors during `git ls-remote` are handled gracefully (logged, not silent)
- [ ] Manual trigger (`./scripts/sync-and-build.sh`) bypasses the timer and runs immediately

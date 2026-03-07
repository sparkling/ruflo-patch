# ADR-0010: Prerelease publish gate

## Status

Implemented

## Context

### Specification (SPARC-S)

When the automated build pipeline (ADR-0009) produces a new version of ruflo, it must decide what to do with it. Publishing directly to npm `@latest` means every user gets the new version immediately — including versions built from potentially broken upstream HEAD or failed patch applications. Publishing nothing defeats the purpose of automation.

The goal is to automate the build-test-publish cycle while retaining human review before users on `@latest` are affected. The notification mechanism must be passive (email) rather than active (checking a dashboard).

### Pseudocode (SPARC-P)

```
IF tests pass:
  npm publish --tag prerelease
  gh release create --prerelease --title "v{VERSION}" --notes "{CHANGELOG}"
  # GitHub sends email notification automatically
ELSE:
  gh issue create --title "Build failed: {VERSION}" --body "{ERROR_LOG}"
  # GitHub sends email notification automatically

# Later, human reviews at their convenience:
IF satisfied:
  npm dist-tag add ruflo@{VERSION} latest   # 2 seconds
```

## Decision

### Architecture (SPARC-A)

Auto-publish every successful build to npm under the `prerelease` dist-tag. Create a GitHub prerelease (not a draft) to trigger an email notification. Promotion to `@latest` is a manual one-command step.

The flow:

1. Timer detects changes, builds, tests pass
2. `npm publish --tag prerelease` — users on `@latest` are unaffected
3. `gh release create --prerelease` — GitHub emails you
4. You review at your convenience
5. `npm dist-tag add ruflo@X.Y.Z latest` — 2 seconds

If tests fail:

1. `gh issue create` — GitHub emails you
2. You investigate, update patches if needed
3. Re-trigger build manually or wait for next timer run

Users can opt into prereleases explicitly: `npx ruflo@prerelease`.

### Considered Alternatives

1. **Fully automated publish to @latest** — Rejected. Too risky. A broken upstream HEAD, a patch conflict, or a subtle test gap could ship broken code to every user. One bad publish erodes trust. The 2-second manual promotion step is a negligible cost for the safety it provides.
2. **Manual everything (notification only, trigger build manually)** — Rejected. Defeats the automation goal. If you have to SSH in and run a script, you won't do it often enough to stay current.
3. **Automated with canary + 24h auto-promote** — Rejected. Complex to implement properly. Soak tests need to be comprehensive enough to catch real issues in 24 hours, which is hard for a CLI tool. Premature optimization of a process that takes 2 seconds manually.
4. **Scheduled batch (weekly)** — Rejected. Up to 7 days stale. No review of individual changes — a week of upstream commits get batched into one untested lump. Misses the point of frequent polling.
5. **GitHub draft release as gate** — Rejected. GitHub does NOT send email notifications for draft releases. You would never see the notification unless you actively checked the releases page — exactly the "active monitoring" pattern we want to avoid.

### Cross-References

- See ADR-0015 for first-publish bootstrap (the first publish uses `--tag latest`, not prerelease)
- See ADR-0019 for rollback procedure when a promoted version is broken

### Considered Alternatives

The above list of rejected alternatives is exhaustive.

## Consequences

### Refinement (SPARC-R)

**Positive:**

- Users on `@latest` only receive versions explicitly approved by a human
- The approval step is minimal friction: one npm command, 2 seconds
- You can test prereleases yourself before promoting: `npx ruflo@prerelease`
- GitHub prerelease emails are enabled by default for repo watchers — no notification setup required
- If you're away for days or weeks, builds accumulate as prereleases harmlessly. Nothing breaks for existing users on `@latest`
- Failed builds create GitHub Issues, which also trigger email — same passive notification channel for both success and failure

**Negative:**

- Slight delay between build completion and availability on `@latest` — however long it takes you to check email and run one command
- Prereleases accumulate if you don't review them. This is cosmetic (clutters the releases page) but not harmful
- Users who pin to `@prerelease` dist-tag get unreviewed versions — this is opt-in and self-documenting

**Edge cases:**

- If multiple prereleases accumulate, you can skip intermediate ones and promote only the latest. There is no requirement to promote every build
- If a prerelease is bad, you simply don't promote it. No remediation needed — `@latest` users never saw it
- If npm publish fails (network, auth), the build script should retry once and then fall back to creating a GitHub Issue

### Amendment: Auto-Promote After Acceptance Tests (2026-03-07)

The original design required manual promotion via `npm dist-tag add`. In practice,
this step was never performed, causing `@latest` to drift behind `@prerelease` indefinitely.
Users on `npx @sparkleideas/cli@latest` never received updates.

**Change:** `sync-and-build.sh` now auto-promotes to `@latest` after post-publish
acceptance tests pass. The promotion uses `scripts/promote.sh --yes`, which reads
per-package versions from `config/published-versions.json` and runs
`npm dist-tag add <pkg>@<version> latest` for each package.

**Safety:** If acceptance tests fail, promotion is skipped and packages remain on
the `prerelease` tag only. A GitHub issue is created for investigation.

**Manual override:** `promote.sh` can still be run manually for ad-hoc promotions
or to retry after a transient failure.

**Bug fix (publish.mjs):** Line 434 previously overrode `getPublishTag()`'s `null`
return (first-publish) with `'prerelease'` when the version string contained `-`.
This prevented first-publish from setting `@latest`, violating ADR-0015. Fixed to
respect the `null` tag from `getPublishTag()` unconditionally.

### Completion (SPARC-C)

Acceptance criteria:

- [x] `npm publish --tag prerelease` publishes successfully without affecting `@latest`
- [x] `npm dist-tag ls @sparkleideas/cli` shows both `latest` and `prerelease` tags
- [x] `gh release create --prerelease` creates a visible (non-draft) prerelease on GitHub
- [x] GitHub sends email notification for the prerelease
- [x] `npm dist-tag add @sparkleideas/cli@X.Y.Z latest` promotes correctly
- [x] `npx @sparkleideas/cli@prerelease` installs the prerelease version
- [x] `npx @sparkleideas/cli@latest` is unaffected by prerelease publishes
- [x] Failed builds create GitHub Issues with diagnostic information
- [x] Auto-promote to `@latest` after acceptance tests pass in sync-and-build.sh
- [x] First-publish bootstrap correctly sets `@latest` for prerelease versions (ADR-0015 bug fix)

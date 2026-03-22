# Plan Template: Clean-Slate Reset + E2E Release

## When to Use

Pipeline state is inconsistent. Need to reset forks, re-apply patches, and run a full E2E release.

---

## Step 1: Reset Forks

For each fork (`~/src/forks/{ruflo,agentic-flow,ruv-FANN}`):
```bash
git fetch upstream main
git checkout main              # may be on a sync/* branch — must checkout main first
git reset --hard upstream/main
git push origin main --force
```

Then delete stale branches and tags:
```bash
git branch -r | grep 'origin/sync/' | sed 's|origin/||' | while read b; do git push origin --delete "refs/heads/$b"; done
git branch | grep -v main | xargs -r git branch -D
git tag -l | xargs -r git tag -d
git ls-remote --tags origin | grep -v '\^{}' | awk '{print $2}' | sed 's|refs/tags/||' | while read tag; do git push origin --delete "$tag"; done
```

Verify issues preserved: `gh issue list --state all -R <owner/repo>`

## Step 2: Re-apply Patches

- `gh issue list --label patch -R <owner/repo>` for each fork
- Read issue bodies, apply edits to TypeScript source
- **ruflo**: verify with `npx tsc --noEmit --project v3/@claude-flow/<package>/tsconfig.json` (no top-level tsconfig)
- **agentic-flow**: patch both root AND `agentic-flow/package.json` if needed
- After changing a shared type, grep for all consumers (e.g. fixture files) — fix those too
- Single commit per fork, push to main

## Step 3: Clear Pipeline State

```bash
node scripts/fork-version.mjs reconcile
rm -f scripts/.last-promoted-version scripts/.last-build-state
rm -rf /tmp/ruflo-build /tmp/ruflo-rq-npxcache
git add config/published-versions.json
git commit -m "Reconcile published-versions + clear state for clean-slate release"
git push origin main
```

Deleting `.last-build-state` forces a full rebuild on next timer run.

## Step 4: Clear Stale Locks + Start Timer

```bash
fuser /tmp/ruflo-sync-and-build.lock 2>/dev/null && fuser -k /tmp/ruflo-sync-and-build.lock
rm -f /tmp/ruflo-sync-and-build.lock
systemctl --user start ruflo-sync.timer
```

Monitor: `journalctl --user -u ruflo-sync.service -f`

## Step 5: Wait for Pipeline Completion

Pipeline runs automatically: build → test → publish → CDN wait → acceptance → promote → smoke.

Read `test-results/<timestamp>/pipeline-timing.json` when done.

## Step 6: Verify

1. `npm view @sparkleideas/cli@latest version` → new version
2. `npx @sparkleideas/cli --version` → works
3. `pipeline-timing.json` → `acceptance_passed: true`
4. `systemctl --user status ruflo-sync.timer` → active

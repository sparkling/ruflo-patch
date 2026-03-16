# Pipeline Flow: Step-by-Step

Complete ordered sequence of what happens when the systemd timer fires.

## Timer Fires

`ruflo.timer` (`OnCalendar=*-*-* 00/6:00:00`, `Persistent=true`) starts `ruflo.service`.
The service runs two sequential `ExecStart=` lines: Stage 1 then Stage 2.

---

## Stage 1: Publish (`scripts/ruflo-publish.sh`)

Monitors **fork origin/main** (`sparkling/*`). Detects merged PRs.

| Step | What happens | Location |
|------|-------------|----------|
| 1 | **Acquire flock** — `flock -n 9` on `/tmp/ruflo-pipeline.lock`. If held, exit 0. | `ruflo-publish.sh:17–22` |
| 2 | **Load state** — read `scripts/.last-build-state` (8 key=value pairs: 4 fork HEADs + 4 upstream SHAs), validate 40-char hex, snapshot as `PREV_*_HEAD`. | `pipeline-utils.sh:load_state()` |
| 3 | **Fetch all 4 fork origins in parallel** — `git fetch origin main` concurrently. | `ruflo-publish.sh:check_merged_prs()` lines 66–77 |
| 4 | **Compare SHAs** — for each fork, compare `origin/main` against `PREV_*_HEAD`. | `ruflo-publish.sh:check_merged_prs()` lines 80–114 |
| 5 | **Fast-forward local main** — `git merge --ff-only origin/main` (falls back to `reset --hard`). Record `NEW_*_HEAD`. | `ruflo-publish.sh:check_merged_prs()` lines 117–129 |
| 6 | **Decision gate** — if no fork changed AND no `--force` → return 0 (no-op, proceed to Stage 2). | `ruflo-publish.sh:main()` lines 278–281 |

### Stage 1 path when fork HAS changed (steps 6a–6r)

| Step | What happens | Location |
|------|-------------|----------|
| 6a | **`run_phase "bump-versions"`** — calls `bump_fork_versions()`. | `ruflo-publish.sh:284` |
| 6b | **Selective version bump** — `node scripts/fork-version.mjs bump --changed-shas dir:oldSha`. Outputs `BUMPED_PACKAGES:` and `DIRECTLY_CHANGED:` JSON arrays. | `ruflo-publish.sh:162–176` |
| 6c | **Early exit if no packages changed** — if `[]`, save state and return. | `ruflo-publish.sh:178–190` |
| 6d | **Commit + tag each changed fork** — `git commit`, `git tag -a vX`. Push deferred to `PENDING_VERSION_PUSHES[]`. | `ruflo-publish.sh:193–225` |
| 6e | **Update `NEW_*_HEAD`** — re-read HEAD after bump commits. | `ruflo-publish.sh:287–293` |
| 6f | **`run_phase "copy-source"`** — rsync 4 forks in parallel to `/tmp/ruflo-build`. | `pipeline-helpers.sh:copy_source()` → `copy-source.sh` |
| 6g | **`run_phase "codemod"`** — `@claude-flow/*` → `@sparkleideas/*` rename. | `pipeline-helpers.sh:run_codemod()` → `codemod.mjs` |
| 6h | **`run_phase "test-ci"` (background)** — preflight + unit tests, in parallel with build. | `ruflo-publish.sh:300`, `pipeline-helpers.sh:run_tests_ci()` |
| 6i | **`run_phase "build"` (foreground)** — TSC compile (`build-packages.sh`) + WASM (`build-wasm.sh`). | `pipeline-helpers.sh:run_build()` |
| 6j | **`write_build_manifest()`** — writes `/tmp/ruflo-build/.build-manifest.json` (fork HEADs + codemod hash). | `pipeline-helpers.sh:write_build_manifest()` |
| 6k | **Wait for test-ci** — if failed, abort. | `ruflo-publish.sh:306–309` |
| 6l | **`run_phase "publish-verdaccio"`** — publish `@sparkleideas/*` to Verdaccio in topological order (5 levels). | `pipeline-helpers.sh:run_publish_verdaccio()` |
| 6m | **`run_phase "acceptance"`** — real CLI commands against published packages. | `pipeline-helpers.sh:run_acceptance()` |
| 6n | **Write `.last-verified.json`** — fork HEADs + codemod hash for Stage 2 dedup. | `ruflo-publish.sh:316–322` |
| 6o | **`read_build_version()`** — version from CLI package.json. | `pipeline-utils.sh:read_build_version()` |
| 6p | **`save_state()`** — write state file. Only after publish + acceptance succeed. | `pipeline-utils.sh:save_state()` |
| 6q | **`push_fork_version_bumps()`** — `git push origin main` all forks in parallel. Deferred until publish succeeds. | `ruflo-publish.sh:push_fork_version_bumps()` |
| 6r | **`write_pipeline_summary()`** — assemble JSONL into `test-results/{timestamp}/pipeline-timing.json`. | `pipeline-utils.sh:write_pipeline_summary()` |

**On failure**: any `run_phase` failure → `create_failure_issue()` (GitHub issue + HTML email) → `exit 1`. Stage 2 skipped. State NOT saved → next run retries.

---

## Stage 2: Sync (`scripts/ruflo-sync.sh`)

Monitors **upstream/main** (`ruvnet/*`). Detects new upstream commits.

| Step | What happens | Location |
|------|-------------|----------|
| 7 | **Load state** — read `scripts/.last-build-state`. | `pipeline-utils.sh:load_state()` |
| 8 | **Add upstream remotes** — ensures `upstream` git remote exists on each fork. | `ruflo-sync.sh:_add_upstream_remotes()` |
| 9 | **Fetch all 4 upstreams in parallel** — `git fetch upstream main` concurrently. | `ruflo-sync.sh:_fetch_upstream_parallel()` |
| 10 | **Compare upstream SHAs** — `upstream/main` vs saved `UPSTREAM_*_SHA`. New upstream commit detected here. | `ruflo-sync.sh:sync_upstream()` lines 248–265 |
| 11 | **Clean stale sync branches** — delete leftover `sync/*` branches. | `ruflo-sync.sh:_create_sync_branches()` lines 107–120 |
| 12 | **Create sync branch** — `git checkout -b sync/upstream-{timestamp}` from main. | `ruflo-sync.sh:_create_sync_branches()` line 129 |
| 13 | **Merge upstream** — `git merge --no-edit upstream/main`. On **conflict** → abort, create PR (label `conflict`), email, GitHub issue, return 1. | `ruflo-sync.sh:_create_sync_branches()` lines 137–151 |
| 14 | **Record upstream SHA** — `set_upstream_sha()`. | `ruflo-sync.sh:_create_sync_branches()` line 163 |
| 15 | **Save state (upstream SHAs)** — persist immediately so next run won't re-sync. | `ruflo-sync.sh:main()` line 296 |
| 16 | **Type-check sync branch** — `tsc --noEmit --skipLibCheck`. On **TS errors** → create PR (label `compile-error`), email, GitHub issue, return 1. | `ruflo-sync.sh:_typecheck_one_fork()` |
| 17 | **Check build freshness** — if Stage 1 already built from same HEADs → reuse `/tmp/ruflo-build`. | `pipeline-utils.sh:check_build_freshness()` |
| 18 | **Copy source** — rsync 4 forks in parallel to `/tmp/ruflo-build`. (Skipped if step 17 matched.) | `copy-source.sh:copy_source()` |
| 19 | **Codemod** — `@claude-flow/*` → `@sparkleideas/*`. (Skipped if step 17 matched.) | `pipeline-helpers.sh:run_codemod()` |
| 20 | **Build** — TSC + WASM. (Skipped if step 17 matched.) | `pipeline-helpers.sh:run_build()` |
| 21 | **Check acceptance dedup** — if Stage 1 wrote `.last-verified.json` with matching HEADs + codemod hash → skip acceptance, run preflight + unit only. | `ruflo-sync.sh:main()` lines 329–357 |
| 22 | **Run tests** — preflight + unit (always). Publish to Verdaccio + acceptance (unless deduped). | `pipeline-helpers.sh:run_tests_ci()` or `run_tests()` |
| 23 | **Push sync branch** — `git push origin sync/upstream-...`. | `github-issues.sh:create_sync_pr()` line 24 |
| 24 | **Create GitHub PR** — `gh pr create` with label `ready` or `test-failure`. | `github-issues.sh:create_sync_pr()` lines 65–75 |
| 25 | **Send email** — HTML email with status badge, PR link, upstream commit details. | `ruflo-sync.sh:_send_sync_email()` → `email-notify.sh:send_email()` |
| 26 | **Create failure issue (if tests failed)** — `gh issue create --label build-failure` + email. | `github-issues.sh:create_failure_issue()` |
| 27 | **Checkout main** — all forks back on main. | `ruflo-sync.sh:main()` lines 389–391 |
| 28 | **Save state** — final write with updated upstream SHAs. | `ruflo-sync.sh:main()` line 394 |
| 29 | **Print phase summary** — timing table to stderr (→ journal). | `pipeline-utils.sh:print_phase_summary()` |

---

## The Two Detection Loops

```
Stage 1 monitors: fork origin/main (sparkling/*)
  "Did someone merge a PR into our fork?"
  → bump, build, test, publish to Verdaccio

Stage 2 monitors: upstream/main (ruvnet/*)
  "Did upstream push new code?"
  → merge into sync branch, typecheck, test, create PR
```

An upstream change triggers Stage 2 → PR.
Merging that PR triggers Stage 1 (next cycle) → publish.

---

## Key Files

| File | Role |
|------|------|
| `config/ruflo.timer` | Fires every 6h |
| `config/ruflo.service` | Runs Stage 1 then Stage 2 |
| `scripts/ruflo-publish.sh` | Stage 1: publish |
| `scripts/ruflo-sync.sh` | Stage 2: sync |
| `lib/pipeline-state.sh` | Mutable state variable declarations |
| `lib/pipeline-utils.sh` | Logging, timing, state I/O, phase runner |
| `lib/pipeline-helpers.sh` | Build/test wrapper functions |
| `lib/fork-paths.sh` | Fork directories, upstream URLs, SHA helpers |
| `lib/email-notify.sh` | HTML email generation + send |
| `lib/github-issues.sh` | PR creation, failure issue creation |
| `scripts/copy-source.sh` | Parallel rsync to build dir |
| `scripts/build-packages.sh` | TSC compile |
| `scripts/build-wasm.sh` | WASM compile |
| `scripts/codemod.mjs` | Scope rename |
| `scripts/fork-version.mjs` | Version bumping |
| `scripts/publish.mjs` | Topological publish to Verdaccio |
| `scripts/assemble-timing.mjs` | Consolidate timing JSONL → JSON |
| `scripts/deploy-finalize.sh` | Post-publish finalization |
| `scripts/.last-build-state` | Persisted state file |

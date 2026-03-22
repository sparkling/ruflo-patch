# Pipeline Failure Root Causes (learned from 5 failed E2E attempts)

## DO NOT manually hack state. Fix the pipeline code instead.

## Root Causes — ALL FIXED

### 1. No npm collision detection — FIXED (attempt 4)
`fork-version.mjs` generates `-patch.N+1` from local state only. If local state is reset, it generates versions that already exist on npm.
**Fix**: `queryNpmMaxPatch()` + `safeNextVersion()` queries npm before bumping, uses `max(local, npm) + 1`.

### 2. State management has no reconciliation — FIXED (attempt 4)
No way to recover state after manual resets.
**Fix**: `fork-version.mjs reconcile` command rebuilds `published-versions.json` from npm registry.

### 3. safeNextVersion always bumped, even if current version unpublished — FIXED (attempt 5)
If a previous run bumped to `-patch.8` but publish failed, next run bumped to `-patch.9`, orphaning `-patch.8`. Caused gaps in npm: `patch.[1,3,4,6,7]`.
**Fix**: `versionExistsOnNpm()` check — if current version isn't on npm, reuse it (idempotent retry). Only bump if current version already published.

### 4. State saved BEFORE publish (non-recoverable failures) — FIXED (attempt 5)
`save_state()` at line 1046 ran before build/test/publish. If any later step failed, pipeline thought it was done and skipped Stage 3 on next run.
**Fix**: Removed early `save_state`. State only saved after successful publish (line ~1145). Safe because `safeNextVersion` is now idempotent.

### 5. Wrapper package version never auto-bumped — FIXED (attempt 5)
`@sparkleideas/ruflo` version lives in ruflo-patch `package.json`. `fork-version.mjs` didn't touch it. After first publish, every subsequent run silently skipped the wrapper.
**Fix**: `run_publish()` now checks npm for current wrapper version. If it exists, auto-bumps using `bumpPatchVersion()` before publishing.

### 6. Verdaccio "already published" detection was missing — FIXED (attempt 4)
Verdaccio says "this package is already present" (different string from npm). Pipeline only matched npm string.
**Fix**: Case-insensitive matching of both strings in `publish.mjs`.

### 7. Verdaccio not cleaned during pipeline integration tests — FIXED (attempt 5)
`test-integration.sh` defaulted to incremental mode (kept cached packages). Pipeline never set `CHANGED_PACKAGES_JSON`, so Verdaccio had stale packages from previous runs.
**Fix**: Pipeline now passes `CHANGED_PACKAGES_JSON=all` when calling `test-integration.sh`.

### 8. cuda-wasm in LEVELS but build fails silently — FIXED (attempt 5)
`cuda-wasm` requires `wasm-pack`. Build failed silently, causing version mismatches between fork and build dir. `published-versions.json` recorded phantom versions.
**Fix**: Removed `cuda-wasm` from `LEVELS` in `publish.mjs`. Still gets version-bumped in forks but isn't published until WASM build is gated.

### 9. Test timeouts were too aggressive — FIXED (attempt 3)
RQ global was 180s, acceptance was 300s. Cold npx cache runs exceed these.
**Fix**: RQ 300s, acceptance 600s, per-command timeouts added.

### 10. Merge detection was broken — FIXED (attempt 2)
`check_merged_prs()` couldn't distinguish "already processed" from "new merges" after pipeline pushed version bumps.
**Fix**: `git merge-base --is-ancestor` + state file SHA comparison.

## Anti-patterns to NEVER repeat

1. **NEVER force push fork main to "fix" version state** — creates divergence between npm and pipeline state
2. **NEVER clear published-versions.json without reconciling with npm** — creates collision risk
3. **NEVER manually set versions in fork package.json** — use fork-version.mjs which handles cross-scope dep updates
4. **NEVER set systemd timer to 1 minute for testing** — use `npm run deploy` for manual E2E. Timer is for production (6h)
5. **NEVER npm unpublish to "make room"** — npm blocks unpublish for packages with dependents. Work forward only
6. **NEVER assume a clean reset is possible** — npm is immutable. You can only move forward
7. **NEVER save pipeline state before publish succeeds** — makes failures non-recoverable

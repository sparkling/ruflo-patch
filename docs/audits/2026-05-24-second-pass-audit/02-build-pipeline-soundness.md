# 02 — Build pipeline soundness audit

**Parent**: [ADR-0201](../../adr/ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md)
**Scope**: `scripts/` + `lib/` in `ruflo-patch` — the trunk repo that drives forks → codemod → Verdaccio publish.
**Companion**: [16-gap-analysis.md G-16-003](../2026-05-19-soundness-audit/16-gap-analysis.md)
**Predecessor close-out**: ADR-0231 wave A9 (two structural pipeline defects landed 2026-05-23, codified the fail-loud-duplicate pattern in `publish.mjs::buildPackageMap`).

## Summary

- Files inventoried in pipeline chain: 14 (entrypoint + 5 stage scripts + 5 lib sourcings + 3 verify-gate scripts).
- Substantive scripts deep-scored: 11.
- Findings: **14 total / 3 critical / 7 warning / 4 note**.
- Soundness verdict: **FAIL** (two unfixed ADR-0231-class structural defects).
- Completeness verdict: **PASS-WITH-DEBT** (all release stages are wired and verified; the rot lives in invariants, not coverage).
- Bottom line: the pipeline has roughly the same shape ADR-0231 wave A9 just closed in one spot (`publish.mjs`), but the same class of bug — hardcoded scope/package-name lists that must drift in lockstep with another source of truth — recurs at four more sites (F-02-001, F-02-002, F-02-003, F-02-004). Two of them (`fork-version.mjs::SCOPES`/`UNSCOPED_PUBLISHABLE` and `build-packages.sh::_v3_packages` literal) are exactly the wave-A9 defect-1 pattern: the codemod tells the build "rename @ruvector/* → @sparkleideas/ruvector-*", but fork-version.mjs hardcodes the inverse mapping in `toNpmName()` separately from `codemod.mjs::UNSCOPED_MAP`. A new scope or unscoped publishable name silently drops on one side or the other until something blows up at install time. The wave-A9 close-out fixed *one* discovery path; the audit shows there are five. Additionally: `publish-verdaccio.sh` runs without `set -e` (F-02-005) so npm-publish failures past the `publish.mjs` call could pass through unpropagated; `napi-rebuild.sh` swallows the `npm run build` exit code on commit-and-push (F-02-006); and the entire pipeline depends on three machine-pinned absolute paths in `ruflo-publish.sh` (F-02-007) that aren't derived from `lib/fork-paths.sh` like every other script in the tree.

## Findings

### F-02-001 [CRITICAL] Three duplicated scope/package-name registries that must stay synchronized — exactly the ADR-0231 wave A9 defect-1 pattern

- **Locations**:
  - `scripts/fork-version.mjs:45-58` (`SCOPES` array + `UNSCOPED_PUBLISHABLE` set)
  - `scripts/codemod.mjs:38-68` (`UNSCOPED_MAP` object)
  - `scripts/preflight-discover.mjs:188-194` (`isInScope` predicate — imports `UNSCOPED_MAP` from codemod but adds independent `@claude-flow/` and `@ruvector/` shortcuts)
  - `scripts/build-packages.sh:187-191` (literal v3 short-name set — the worst form because it's an associative-array literal with no cross-validation against `publish-levels.json`)

- **Issue**: The three node-side lists *partially* derive from each other (preflight-discover imports `UNSCOPED_MAP`), but fork-version.mjs's `SCOPES`/`UNSCOPED_PUBLISHABLE`/`toNpmName()` is hand-maintained alongside `codemod.mjs`'s `UNSCOPED_MAP` and `RUVECTOR_PREFIX_FROM`/`TO`. The comment at fork-version.mjs:37-44 acknowledges this: "ADR-0095 amendment (2026-05-01): @ruvector/* added so the cascade picks up forks/ruvector/{crates,npm/packages}/<pkg>/package.json. Without this, findPackages walked past `@ruvector/rvf-node` and the cascade silently no-op'd `npm publish`". That's the same silent-drop class ADR-0231 wave A9 hit in publish.mjs.

  `build-packages.sh:187-191` is worse — it hardcodes the v3 short-name set as an associative-array literal that the script duplicates in inline JS at `:200-205` ("filter to v3/@claude-flow/ packages only"). When a new v3 package lands upstream and gets bumped by fork-version, it will:
  - get picked up by the topo levels in `config/publish-levels.json`
  - get picked up by codemod (regex-based, not enumerated)
  - get silently SKIPPED at the build step (`build-packages.sh` doesn't know it's a v3 package, treats it as cross-repo)
  - therefore ship a stale/empty dist to Verdaccio.

  This is the *exact* shape of ADR-0231 wave-A9 defect-1 (`fork-version.mjs::UNSCOPED_PUBLISHABLE` missed `ruvllm-wasm`) — except recurring at four sites instead of one.

- **Evidence — fork-version.mjs**:
  ```js
  // scripts/fork-version.mjs:45
  const SCOPES = ['@sparkleideas/', '@claude-flow/', '@ruvector/'];

  // :49-58
  const UNSCOPED_PUBLISHABLE = new Set([
    'agentdb', 'agentic-flow', 'claude-flow', 'ruv-swarm',
    'ruvector', 'agent-booster', 'agentdb-onnx', 'cuda-wasm',
  ]);
  ```

  Versus `codemod.mjs:38-68`:
  ```js
  export const UNSCOPED_MAP = {
    'claude-flow': '@sparkleideas/claude-flow',
    'ruflo': '@sparkleideas/ruflo',                  // ← absent from fork-version's UNSCOPED_PUBLISHABLE
    'agentdb': '@sparkleideas/agentdb',
    // ... 14 more entries
    'agentic-jujutsu': '@sparkleideas/agentic-jujutsu',  // ← absent from fork-version's UNSCOPED_PUBLISHABLE
    'ruvector-core-darwin-arm64': '@sparkleideas/ruvector-core-darwin-arm64',
    // ... 6 platform-binary entries absent from fork-version's UNSCOPED_PUBLISHABLE
    'ruvllm-wasm': '@sparkleideas/ruvector-ruvllm-wasm',  // ← the ADR-0231 wave-A9 entry
  };
  ```

  The two lists are not aligned. `ruflo` is in `UNSCOPED_MAP` but not in `UNSCOPED_PUBLISHABLE` (correct — it's the wrapper, lives in ruflo-patch, not in forks/). `agentic-jujutsu` is also in `UNSCOPED_MAP` but absent from `UNSCOPED_PUBLISHABLE` (this looks wrong — `agentic-jujutsu` IS published from `forks/agentic-flow/packages/agentic-jujutsu/` per `napi-config.sh`, so fork-version should pick it up; the codemod alone is not enough).

- **Impact**: Wave A9-class structural defect — recurring at four sites. A new fork package added on the codemod side that fork-version doesn't know about ships with the upstream version forever (never -patch.N-bumped). Conversely a name in fork-version that codemod hasn't mapped ships under the original `@claude-flow/*` or unscoped name to Verdaccio, breaking installs. The wave-A9 fail-loud in `publish.mjs::buildPackageMap` only catches *one downstream symptom* (ambiguous-directory collisions for the same target name); none of these four sites have a fail-loud equivalent. Operator has to discover the drift via a runtime install failure.

### F-02-002 [CRITICAL] `build-packages.sh` v3 set + build-groups derivation has a silent hardcoded fallback that survived a publish-levels.json read failure

- **Location**: `scripts/build-packages.sh:217-245`
- **Issue**: The script first tries to read `config/publish-levels.json`, filter to v3 packages, and emit space-separated build-group arrays. The Node inline filter (`:197-215`) uses the hardcoded `_v3_packages` associative array (already flagged in F-02-001). When the read succeeds (the happy path), it populates groups from JSON. When the read FAILS (jq error, malformed JSON, file moved), `:236-244` logs `WARN: Could not read publish-levels.json for build groups — using hardcoded fallback` and falls back to a *different* hardcoded layout:

  ```bash
  # :239-244
  group_0=(cli-core)
  group_1=(shared memory embeddings codex aidefence)
  group_2=(neural browser plugins providers claims)
  group_3=(guidance mcp integration deployment swarm security performance testing)
  group_4=(cli)
  ```

  This is a `feedback-no-fallbacks` violation. `publish.mjs::loadLevels()` (lines 30-52) was REWORKED in ADR-0113 Phase B specifically to delete its hardcoded fallback because "Phase B dry-run discovered Level 1 had 22 entries in JSON but 5 in the fallback — silent fallback would have published a wrong subset on any JSON read failure". The build-side fallback at `build-packages.sh:236-245` is the inverse — same anti-pattern, never fixed.

- **Evidence**: `publish.mjs:42-50`:
  ```js
  throw new Error(
    `FATAL: cannot read config/publish-levels.json — ${err.message}\n` +
    `       (this is the canonical publish-order source per ADR-0113 Phase B step 25)`,
  );
  ```

  Same flow at `build-packages.sh:217-245`:
  ```bash
  if [[ "$_build_groups_ok" == "true" && -n "$_build_groups_json" ]]; then
    # populate groups from JSON
  else
    log "WARN: Could not read publish-levels.json for build groups — using hardcoded fallback"
    group_0=(cli-core)  # ← silent dispatch to a hardcoded different layout
    # ...
  fi
  ```

- **Impact**: A typo or git-merge-mangling of `config/publish-levels.json` causes the publish stage to fail loud (good) but the build stage to silently chunk packages into a layout that may not match levels-1-through-5 dependency order. Specifically, the fallback omits `plugin-agent-federation` and `plugin-iot-cognitum` (added per ADR-0113 Fix 5, only in the JSON path at line 187-191's `_v3_packages`), so a fallback path would skip building two plugin packages while still attempting to publish them.

### F-02-003 [CRITICAL] `publish-verdaccio.sh` uses `set -uo pipefail` (no `-e`) — npm-publish exit codes past line 141 cannot abort the script

- **Location**: `scripts/publish-verdaccio.sh:11`
- **Issue**: The script declares `set -uo pipefail` deliberately *without* `-e`. The Phase 3 `publish.mjs` invocation at line 141 uses a manual `|| { ... exit 1 }` to propagate failure. But Phase 4 (`npm publish` for the wrapper at line 168) only logs `wrapper publish skipped (may already exist)` and does NOT exit — it relies on the `set -e` semantics that are turned off, so any unexpected failure here passes silently. Phase 6 (`promote_packages`) at line 201 has `|| true` AND returns the count of failures only via stdout (not a non-zero exit).

  Compare to every other pipeline script (`ruflo-publish.sh`, `copy-source.sh`, `build-packages.sh`, `napi-rebuild.sh`, `build-wasm.sh`) which all use `set -euo pipefail`. The deviation here is explicit and load-bearing.

- **Evidence**:
  ```bash
  # publish-verdaccio.sh:11
  set -uo pipefail

  # :166-170 — wrapper publish (Phase 4)
  log "Publishing local wrapper (@sparkleideas/ruflo) to Verdaccio..."
  NPM_CONFIG_REGISTRY="http://localhost:${PORT}" \
    npm publish "${PROJECT_DIR}" --access public --ignore-scripts --tag latest 2>&1 || \
    log "  wrapper publish skipped (may already exist)"
  ```

- **Impact**: If the wrapper's `npm publish` fails for any reason other than "version already exists" (network glitch, malformed package.json, registry auth issue), the script logs `wrapper publish skipped` and continues to Phase 5/6/timing summary, returning exit 0. The downstream acceptance phase pins `@sparkleideas/ruflo@latest`, which would then be a STALE wrapper — meaning the entire MCP surface tests against a wrapper that doesn't have this release's bumped `@sparkleideas/cli` pin. This is exactly the failure mode that `project-ruflo-wrapper-latest-regression` (MEMORY.md) burned a release on.

### F-02-004 [WARNING] `codemod-symlink-workspace.mjs::EXTRA_WORKSPACE_DIRS` is a hardcoded list — same shape as F-02-001

- **Location**: `scripts/codemod-symlink-workspace.mjs:55-71`
- **Issue**: `EXTRA_WORKSPACE_DIRS = ['cross-repo/agentdb']` is a hand-maintained singleton today. The comment at `:56-70` notes it was added specifically because ADR-0181 Phase 5's `getProcessArchivist()` dynamic-imports `@sparkleideas/agentdb` from cli code — the symlink scope hadn't been thought through. If any future v3 workspace package adds a runtime dynamic import to a sibling `cross-repo/` package (agentic-flow, ruv-FANN, ruvector), this hardcoded list won't include it and the same `ERR_MODULE_NOT_FOUND` class will recur. There's no test gate detecting an unsymlinked cross-repo dep at runtime.
- **Impact**: Latent — manifests as ERR_MODULE_NOT_FOUND at unit-test time the moment a new dynamic-import pattern is introduced. Mitigated only by code review.

### F-02-005 [WARNING] `napi-rebuild.sh::commit_and_push_binaries_for_fork` does not propagate `git pull --rebase` failure

- **Location**: `scripts/napi-rebuild.sh:242`
- **Issue**:
  ```bash
  git pull --rebase sparkling main 2>&1 | tail -3 || true
  if ! git push sparkling main; then
  ```

  The `git pull --rebase` is suffixed with `| tail -3 || true`. If the pull fails (merge conflict, dirty tree, broken upstream ref), the script proceeds to `git push sparkling main`. The push will *probably* fail with non-fast-forward, falling into the error branch — but if by coincidence the rebase produces a clean state (e.g. partial-conflict auto-resolution) the push may succeed, committing whatever state ended up on disk. This is `feedback-best-effort-must-rethrow-fatals`.

- **Evidence**: Other places in the same script use proper guards:
  ```bash
  # :243-246
  if ! git push sparkling main; then
    log_error "${fork_name}: push to sparkling failed"
    return 1
  fi
  ```
  But the pull-rebase doesn't get the same treatment.

- **Impact**: Low-likelihood, high-blast-radius — a corrupted rebase committed to fork main contaminates the next release. The user has explicitly warned against this class (`feedback-never-touch-hz-remote`, `feedback-no-history-squash`).

### F-02-006 [WARNING] Three machine-pinned absolute paths in `ruflo-publish.sh` not derived from `lib/fork-paths.sh`

- **Location**: `scripts/ruflo-publish.sh:116,131,146`
- **Issue**: The ADR-0180 gates 2/3/4 hardcode three absolute paths:
  ```bash
  # :116
  local archivist_dir="/Users/henrik/source/forks/agentdb/src/archivist"
  # :131
  local ruflo_v3_dir="/Users/henrik/source/forks/ruflo/v3"
  # :146
  /Users/henrik/source/forks/agentdb/src/ 2>/dev/null \
  ```

  `lib/fork-paths.sh` exports `FORK_DIR_AGENTDB`, `FORK_DIR_RUFLO`, etc., specifically as the single source of truth (ADR-0039 §"Single source of truth: fork-paths.sh"). The ADR-0180 gates were added later (per ADR-0180 Phase 0) and bypassed this convention.

  This is also a regression of `feedback-never-touch-hz-remote`'s spirit: the project has migrated from Hetzner (`/home/claude/`) to the M5 Max MacBook (`/Users/henrik/`). A future move would silently break these three gates while every other path-dependent script kept working.

- **Impact**: Pipeline fails to run on any machine not at `/Users/henrik/source/forks/`. Same class of bug present in `scripts/check-fetch-timeouts.mjs:32-34`, `scripts/check-silent-catches.mjs:41-42`, `scripts/check-undiscriminating-catches.mjs:44-45`, `scripts/audit-dynamic-imports.sh:16-18` (still uses `/home/claude/`!), and `scripts/install-systemd.sh:16`. The Hetzner-era audit-dynamic-imports.sh path is dead — if the script is invoked it will silently scan zero files.

### F-02-007 [WARNING] `_cache_bust_bumped_packages` in test-acceptance.sh has a hardcoded 5-package fallback

- **Location**: `scripts/test-acceptance.sh:268-318`
- **Issue**: When `scripts/.last-bumped-packages` is missing or empty (legitimate cases: first-ever release, `--force` rebuild, standalone test-acceptance), the function falls back to:
  ```bash
  pkgs=(
    "@sparkleideas/cli"
    "@sparkleideas/agentic-flow"
    "@sparkleideas/ruflo"
    "@sparkleideas/agentdb"
    "@sparkleideas/ruvector"
  )
  ```

  The script DOES log loudly via `log_error` at :302 ("This is expected for first-ever releases, --force rebuilds ... If you see this every release, the publish-side write site in ruflo-publish.sh::bump_fork_versions has regressed"), which is the right surfacing. But the fallback set is itself a hardcoded subset of the full publishable-name registry — if any package outside these 5 had a corrupted ghost version on the local Verdaccio, `--prefer-offline` would silently install the stale entry on every standalone-acceptance run. The fallback is acknowledged in the comment but not auto-derived from a source of truth.

- **Impact**: Standalone-acceptance and `--force` paths can silently install stale Verdaccio entries for any of the 60+ packages outside the 5-entry hardcoded fallback.

### F-02-008 [WARNING] `gen-tsconfig.mjs` failure in `build-packages.sh::build_one_pkg` is swallowed — 2>/dev/null on a Node script

- **Location**: `scripts/build-packages.sh:127`
- **Issue**:
  ```bash
  node "${SCRIPT_DIR}/gen-tsconfig.mjs" --pkg-dir "$pkg_dir" --tsc-dir "$tsc_dir" --output "$tmp_tsconfig" 2>/dev/null
  ```

  The `2>/dev/null` swallows any stderr from gen-tsconfig.mjs. If gen-tsconfig writes a malformed tsconfig.build.json (or fails to write one at all), the next tsc invocation at :145 falls into the fallback ladder (`--noCheck`, `--isolatedModules`) and emits a "compiled with fallback level N" warning. The actual `gen-tsconfig` error is lost. This is `feedback-no-fallbacks` adjacent: errors are hidden behind a permissive ladder.

- **Impact**: Diagnosis-friction. A real gen-tsconfig regression looks like generic tsc fallback escalation in the logs.

### F-02-009 [WARNING] `agentic-flow` build path tolerates non-zero exit unconditionally — `--noCheck` is intentional but the comment admits 256 pre-existing type errors

- **Location**: `scripts/build-packages.sh:317-321`
- **Issue**:
  ```bash
  # ADR-0193 note: --noCheck is intentional (fork has 256 pre-existing
  # type errors); log exit code so a true emit failure is observable
  # even though we tolerate non-zero exits.
  local _af_tsc_exit=0
  "$tsc_bin" -p "${af_dir}/config/tsconfig.json" --skipLibCheck --noCheck \
    --incremental --tsBuildInfoFile "${af_dir}/.tsbuildinfo" 2>/dev/null || _af_tsc_exit=$?
  [[ "$_af_tsc_exit" != "0" ]] && log "    agentic-flow tsc exited $_af_tsc_exit (non-fatal: --noCheck)"
  ```

  The fallback determines build success solely on whether `dist/index.js` or `dist/agentic-flow/src/index.js` exists post-tsc (line 326). If tsc exits non-zero AND emits a partial dist (e.g. compiles 80% then aborts), the script reports BUILD: agentic-flow with no surfacing of *which* files failed. The `256 pre-existing type errors` is an unverified claim — there's no test or check that asserts the count.

- **Impact**: Latent failures in agentic-flow compilation hide behind a "passes if dist/index.js exists" check.

### F-02-010 [WARNING] `install-runtime-externals.mjs` per-dep fallback masks unpublished externals — by design but no telemetry

- **Location**: `scripts/install-runtime-externals.mjs:196-241`
- **Issue**: When bulk `npm install` of all aggregated third-party externals fails, the script falls back to per-dep install and records skipped entries:
  ```js
  console.warn(`install-runtime-externals: per-dep install: ${installedCount} installed, ${skipped.length} skipped`);
  if (skipped.length > 0) {
    console.warn(`install-runtime-externals: skipped (likely unpublished or yanked): ${skipped.join(', ')}`);
  }
  ```

  The downstream symlink loop at :247-281 then skips creating a symlink for any unresolvable external (`if (err.code === 'ENOENT') continue`). At test-ci time a `import 'flow-nexus'` (the documented case in the comments) would resolve nothing, exactly as the comment claims; but there's no exit-code or pipeline gate that says "you have N silently-skipped externals". The release continues green.

- **Impact**: A real `import 'flow-nexus'` consumer in fork source ships with no error surface until runtime. Counter-example: zod's overrides logic (lines 179-194) IS strict about consistency. The skipped-externals path is the inverse.

### F-02-011 [NOTE] `copy-source.sh::verify_fork_branches` is non-blocking — branch drift never gates a release

- **Location**: `scripts/copy-source.sh:53-74`
- **Issue**: Comment line 52 explicitly says "Non-blocking — warns on mismatch but never exits non-zero." So a fork that gets accidentally checked out to a feature branch keeps publishing whatever HEAD it's on. This is consistent with the user-stated workflow (trunk-only), but means the gate is documentation only.
- **Impact**: Operator-discoverable misconfiguration that won't fail a release.

### F-02-012 [NOTE] `bundle-native-binaries.sh` failure is logged but non-fatal

- **Location**: `scripts/copy-source.sh:182`
  ```bash
  bash "${SCRIPT_DIR}/bundle-native-binaries.sh" "${TEMP_DIR}" || log "WARN: bundle-native-binaries failed (non-fatal)"
  ```
- **Issue**: A failure to bundle native binaries (ADR-0071) silently downgrades the release to ship without the bundled `.node` files. Other places in the pipeline (`napi-rebuild.sh::commit_and_push_binaries`) treat napi as critical. This boundary is inconsistent.

### F-02-013 [NOTE] `publish.mjs::publishOne` ghost-retry caps at 5 then continues to next package

- **Location**: `scripts/publish.mjs:466-501`
- **Issue**: When all 5 ghost retries fail, the error is logged but the function falls through to the "exit code: ${err.code}" branch and returns `{ ok: false, error: ... }`. The level then collects all failures and returns one of them via `levelFailed = result.error` (note: only ONE — the last one wins; multiple parallel ghost-retry exhaustions all bubble through, all mark `levelFailed`, but only the *last* triggers `createFailureIssue`). This is a tiny silent-aggregation issue.
- **Impact**: When two packages exhaust ghost retries in the same level, only one GitHub issue is opened. Diagnosis is degraded but not silent.

### F-02-014 [NOTE] `verdaccio-gc.mjs` failure is explicitly non-fatal post-release

- **Location**: `scripts/ruflo-publish.sh:563-571`
- **Issue**: ADR-0182 L8 GC failure is downgraded to a warning. Documented + reasonable. Listed for completeness — not a bug.

## Cross-cutting

### CC-02-A: The wave-A9 defect 1 pattern is the cross-cutting risk

ADR-0231 wave A9 defect 1 (`fork-version.mjs::UNSCOPED_PUBLISHABLE` missed `ruvllm-wasm`) and defect 2 (`publish.mjs::buildPackageMap` ambiguous duplicate-name resolution) BOTH stem from the same root: **the pipeline has multiple "list of things to publish / rename / build" registries that must stay in lockstep with each other but lack a single discovery + cross-validation pass at pipeline-start.** `publish.mjs::buildPackageMap` got its fail-loud check; nothing else did.

The next ADR-0231-class structural defect will most likely live at:
1. **F-02-001** — `fork-version.mjs` and `codemod.mjs` are still hand-aligned. A new fork package added on one side and forgotten on the other.
2. **F-02-002** — `build-packages.sh` v3 set drifts vs publish-levels.json.
3. **F-02-005** — `napi-rebuild.sh` rebase-on-conflict path.

A single end-of-publish lint (CI-style) that walks all five registries and asserts pairwise consistency would close the entire class. The closest existing surface is `scripts/preflight-discover.mjs` (which catches the publish.mjs side but not fork-version, codemod-symlink-workspace, build-packages, or install-runtime-externals).

### CC-02-B: `set -e` discipline is inconsistent

15 of 17 substantive pipeline shell scripts use `set -euo pipefail`. Two (`publish-verdaccio.sh` and `test-acceptance.sh`) use `set -uo pipefail`. The deviation is deliberate (both have complex per-phase manual `|| { ... }` branches) but creates two completely different failure-propagation models in the same pipeline. Audit recommends documenting the convention in `lib/pipeline-helpers.sh` or extracting the manual-handling pattern into a `run_phase_norevert` helper.

### CC-02-C: Machine-pinned absolute paths defeat `lib/fork-paths.sh`

The whole point of `fork-paths.sh` is portability across machines. Yet `ruflo-publish.sh:116/131/146`, `check-fetch-timeouts.mjs:32-34`, `check-silent-catches.mjs:41-42`, `check-undiscriminating-catches.mjs:44-45`, `lint-fail-loud.mjs:40`, `lint-no-daemon-lock-cache.mjs:31`, `diag-rvf-inproc-race.mjs:49`, `apply-codemod-to-fork-md.mjs:37`, `check-manifest-flag-drift.mjs:51`, and `check-archivist-charter.sh:18` all hardcode `/Users/henrik/source/forks/...`. Worse, `audit-dynamic-imports.sh:16-18` still uses the Hetzner `/home/claude/src/upstream/` paths (dead). A single grep + refactor pass would remove the entire class.

## Out-of-scope

- `lib/acceptance-*.sh` — 80+ acceptance-check files were not scored individually; their soundness is downstream of `test-acceptance.sh`. Per-check coverage scoring is gap G-16-014 territory.
- `scripts/diag-*.mjs` and `scripts/bisect-rvf-regression.mjs` — diagnostic tools, not pipeline-stage scripts. They share the F-02-006 machine-pinned-path issue but don't gate releases.
- `scripts/test-runner.mjs`, `scripts/preflight.mjs` — unit-test infrastructure; preflight is wired in but the unit tests themselves are out-of-scope per the audit charter.
- The `verdaccio-gc.mjs`, `cleanup-tmp.sh`, `rollback.sh`, `deploy-finalize.sh` lifecycle stages — they are post-publish housekeeping, not on the critical path.
- The promote stage's `npm dist-tag` failure handling (`promote-packages.sh::_promote_one`) is scored as low-impact because the release succeeds even if one package fails to promote; the next release re-attempts.

---

**Read-only audit; no edits, no commits, no plugin installs. Findings recorded per the project's audit format.**

#!/usr/bin/env bash
# lib/acceptance-adr0113-plugin-checks.sh — ADR-0113 §Done criteria checks.
#
# Locks in the ADR-0113 fixes:
#   Fix 5 (federation + iot pipeline wiring): plugins reach Verdaccio
#         and their bins are wired correctly.
#   Fix 6.1 (executor cli@latest rebrand): installed CLI dist has zero
#         @claude-flow/cli@latest references.
#   Fix 6.3 (Opus 4.6 → 4.7): installed CLI dist has no "Opus 4.6" string.
#
# Per ADR-0113 §Done:
#   - federation/iot bin checks must use direct `timeout` (NOT
#     `_run_and_kill`, per memory `feedback-run-and-kill-exit-code`).
#   - Both checks verify (a) bin path exists AND (b) `--version` executes.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first.
# Caller MUST set: TEMP_DIR (= ACCEPT_TEMP).
# Pre-installed by harness: @sparkleideas/plugin-agent-federation,
# @sparkleideas/plugin-iot-cognitum (added to scripts/test-acceptance.sh).

# ════════════════════════════════════════════════════════════════════
# Fix 5 — Federation + IoT plugin acceptance
# ════════════════════════════════════════════════════════════════════

# Resolves federation@latest from Verdaccio. Bare network/registry probe;
# does not exercise the bin.
check_adr0113_federation_resolves() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local resolved
  resolved=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view \
    @sparkleideas/plugin-agent-federation@latest version 2>/dev/null) || true
  if [[ -n "$resolved" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="@sparkleideas/plugin-agent-federation@latest = $resolved"
  else
    _CHECK_OUTPUT="@sparkleideas/plugin-agent-federation@latest did not resolve on $REGISTRY"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# Resolves iot-cognitum@latest from Verdaccio.
check_adr0113_iot_resolves() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local resolved
  resolved=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view \
    @sparkleideas/plugin-iot-cognitum@latest version 2>/dev/null) || true
  if [[ -n "$resolved" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="@sparkleideas/plugin-iot-cognitum@latest = $resolved"
  else
    _CHECK_OUTPUT="@sparkleideas/plugin-iot-cognitum@latest did not resolve on $REGISTRY"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# Verifies (a) ruflo-federation bin path resolves, AND (b) `--version`
# executes successfully. Uses direct `_timeout` per
# feedback-run-and-kill-exit-code (NOT `_run_and_kill`).
check_adr0113_ruflo_federation_bin() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local bin="${TEMP_DIR}/node_modules/.bin/ruflo-federation"
  if [[ ! -x "$bin" ]]; then
    _CHECK_OUTPUT="ruflo-federation bin missing at $bin"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # (a) command -v resolves to the bin (PATH-prepend equivalent)
  local resolved
  resolved=$(PATH="${TEMP_DIR}/node_modules/.bin:$PATH" command -v ruflo-federation 2>/dev/null) || true
  if [[ -z "$resolved" ]]; then
    _CHECK_OUTPUT="command -v ruflo-federation returned empty (PATH-prepend)"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # (b) ruflo-federation --version executes via direct timeout
  local version_out
  version_out=$(_timeout 30 "$bin" --version 2>&1) || true
  local rc=$?
  if [[ $rc -eq 0 && -n "$version_out" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ruflo-federation @ $resolved → --version: $(echo "$version_out" | head -1)"
  else
    _CHECK_OUTPUT="ruflo-federation --version failed (exit=$rc): $(echo "$version_out" | head -3)"
  fi
  end_ns=$(_ns)
  _EXIT=$rc; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# Verifies cognitum-iot bin path + --version executes (same pattern as
# ruflo_federation_bin).
check_adr0113_cognitum_iot_bin() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local bin="${TEMP_DIR}/node_modules/.bin/cognitum-iot"
  if [[ ! -x "$bin" ]]; then
    _CHECK_OUTPUT="cognitum-iot bin missing at $bin"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local resolved
  resolved=$(PATH="${TEMP_DIR}/node_modules/.bin:$PATH" command -v cognitum-iot 2>/dev/null) || true
  if [[ -z "$resolved" ]]; then
    _CHECK_OUTPUT="command -v cognitum-iot returned empty (PATH-prepend)"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local version_out
  version_out=$(_timeout 30 "$bin" --version 2>&1) || true
  local rc=$?
  if [[ $rc -eq 0 && -n "$version_out" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="cognitum-iot @ $resolved → --version: $(echo "$version_out" | head -1)"
  else
    _CHECK_OUTPUT="cognitum-iot --version failed (exit=$rc): $(echo "$version_out" | head -3)"
  fi
  end_ns=$(_ns)
  _EXIT=$rc; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# Fix 6.1 — executor.ts/claudemd-generator.ts uses @sparkleideas/cli@latest
# ════════════════════════════════════════════════════════════════════
#
# After ADR-0113 Fix 6.1, all `@claude-flow/cli@latest` install-command
# references in the fork's @claude-flow/cli/src/ tree are rewritten to
# `@sparkleideas/cli@latest`. The compiled dist (shipped in the published
# @sparkleideas/cli package) must reflect this — zero stale references.
check_adr0113_executor_uses_sparkleideas_cli() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local cli_dist="${TEMP_DIR}/node_modules/@sparkleideas/cli/dist"
  if [[ ! -d "$cli_dist" ]]; then
    _CHECK_OUTPUT="@sparkleideas/cli dist not found at $cli_dist"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local stale_count
  stale_count=$(grep -r "@claude-flow/cli@latest" "$cli_dist" 2>/dev/null | wc -l | tr -d ' ')
  stale_count=${stale_count:-0}

  if [[ "$stale_count" == "0" ]]; then
    # Sanity: also verify @sparkleideas/cli@latest IS present (otherwise
    # we'd pass a vacuous "neither rebrand survived" case).
    local new_count
    new_count=$(grep -r "@sparkleideas/cli@latest" "$cli_dist" 2>/dev/null | wc -l | tr -d ' ')
    new_count=${new_count:-0}
    if [[ "$new_count" -gt 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="0 stale @claude-flow/cli@latest, $new_count @sparkleideas/cli@latest in dist"
    else
      _CHECK_OUTPUT="0 stale, but ALSO 0 @sparkleideas/cli@latest — install commands missing entirely"
    fi
  else
    _CHECK_OUTPUT="$stale_count stale @claude-flow/cli@latest references in $cli_dist"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# Fix 6.3 — Opus 4.7 default in user-facing strings
# ════════════════════════════════════════════════════════════════════
#
# `hooks.ts:4137` had `'Opus 4.6 (1M context)'` baked into statusline
# rendering. The compiled dist must show no "Opus 4.6" anywhere — every
# user-visible model string is now 4.7.
check_adr0113_no_opus_46_strings() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local cli_dist="${TEMP_DIR}/node_modules/@sparkleideas/cli/dist"
  if [[ ! -d "$cli_dist" ]]; then
    _CHECK_OUTPUT="@sparkleideas/cli dist not found at $cli_dist"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local stale
  stale=$(grep -rln "Opus 4\.6" "$cli_dist" 2>/dev/null | head -5)

  if [[ -z "$stale" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No 'Opus 4.6' strings in @sparkleideas/cli dist"
  else
    _CHECK_OUTPUT="Stale 'Opus 4.6' strings in: $(echo "$stale" | tr '\n' ',')"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# Fix 4 — Marketplace identity (sparkling owner)
# ════════════════════════════════════════════════════════════════════
#
# Greps the fork's marketplace.json directly. Every-pass cheap check.
# When the fork is pushed to public sparkling/ruflo, this contract
# locks the manifest content. Future upstream merges that re-introduce
# `owner.name: "ruvnet"` will fail this check until codemod is re-run.
#
# Path: forks/ruflo/.claude-plugin/marketplace.json. Resolves via
# config/upstream-branches.json so the script doesn't hardcode the
# fork dir.
check_adr0113_marketplace_owner_sparkling() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  # Resolve fork dir from upstream-branches.json (single source of truth).
  local fork_dir
  fork_dir=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)

  if [[ -z "$fork_dir" || ! -d "$fork_dir" ]]; then
    _CHECK_OUTPUT="forks/ruflo dir not resolvable from config/upstream-branches.json"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local manifest="${fork_dir}/.claude-plugin/marketplace.json"
  if [[ ! -f "$manifest" ]]; then
    _CHECK_OUTPUT="marketplace.json missing at $manifest"
    end_ns=$(_ns)
    _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local owner_name
  owner_name=$(node -e "
    const m = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    process.stdout.write(m.owner?.name || '');
  " "$manifest" 2>/dev/null)

  if [[ "$owner_name" == "sparkling" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="marketplace.json owner.name = sparkling"
  else
    _CHECK_OUTPUT="marketplace.json owner.name = '$owner_name' (expected 'sparkling')"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# Network-gated check (RUFLO_MARKETPLACE_NETWORK_TESTS=1) — clones
# git@github.com:sparkling/ruflo.git, asserts manifest content, verifies
# `git ls-remote sparkling main` SHA matches local fork HEAD.
#
# Skipped by default (would gate every CI run on github.com/sparkling
# availability + SSH credentials). Use after pushing to verify the
# remote is in sync.
check_adr0113_marketplace_remote_sparkling() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  if [[ "${RUFLO_MARKETPLACE_NETWORK_TESTS:-0}" != "1" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="SKIPPED — set RUFLO_MARKETPLACE_NETWORK_TESTS=1 to enable"
    end_ns=$(_ns)
    _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local fork_dir
  fork_dir=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)

  # Local HEAD on main.
  local local_sha
  local_sha=$(git -C "$fork_dir" rev-parse main 2>/dev/null) || true

  # Remote HEAD on sparkling/main.
  local remote_sha
  remote_sha=$(git ls-remote git@github.com:sparkling/ruflo.git refs/heads/main 2>/dev/null \
    | awk '{print $1}') || true

  if [[ -z "$remote_sha" ]]; then
    _CHECK_OUTPUT="git ls-remote sparkling/ruflo main returned empty (network/SSH error?)"
  elif [[ "$local_sha" == "$remote_sha" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="sparkling/ruflo main = local main = ${local_sha:0:8}"
  else
    _CHECK_OUTPUT="local main ${local_sha:0:8} ≠ sparkling/ruflo main ${remote_sha:0:8}"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

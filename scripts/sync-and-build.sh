#!/usr/bin/env bash
# sync-and-build.sh — Main build pipeline for ruflo.
# Triggered by systemd timer (ruflo-sync.timer) every 6 hours,
# or manually via: ./scripts/sync-and-build.sh
#
# Flags:
#   --test-only   Stop after Gate 1 (Layers 0-3 pass). No publish, no deploy.
#   --force       Build even when no upstream/local changes detected.
#
# See: ADR-0009 (systemd timer), ADR-0011 (dual trigger),
#      ADR-0012 (version numbering), ADR-0015 (first-publish bootstrap),
#      ADR-0005 (fork + build-step rename), ADR-0023 (test framework)

set -euo pipefail

# ---------------------------------------------------------------------------
# CLI flags
# ---------------------------------------------------------------------------

TEST_ONLY=false
FORCE_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --test-only) TEST_ONLY=true ;;
    --force)     FORCE_BUILD=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

UPSTREAM_RUFLO="https://github.com/ruvnet/ruflo.git"
UPSTREAM_AGENTIC="https://github.com/ruvnet/agentic-flow.git"
UPSTREAM_FANN="https://github.com/ruvnet/ruv-FANN.git"

UPSTREAM_DIR_RUFLO="/home/claude/src/upstream/ruflo"
UPSTREAM_DIR_AGENTIC="/home/claude/src/upstream/agentic-flow"
UPSTREAM_DIR_FANN="/home/claude/src/upstream/ruv-FANN"

TEMP_DIR=""  # set in create_temp_dir, cleaned up on exit

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

cleanup() {
  local exit_code=$?
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    log "Cleaning up temp directory: ${TEMP_DIR}"
    rm -rf "${TEMP_DIR}"
  fi
  if [[ ${exit_code} -ne 0 ]]; then
    log_error "Build failed with exit code ${exit_code}"
  fi
  exit "${exit_code}"
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------

load_state() {
  RUFLO_HEAD=""
  AGENTIC_HEAD=""
  FANN_HEAD=""
  PATCH_HEAD=""

  if [[ -f "${STATE_FILE}" ]]; then
    log "Loading state from ${STATE_FILE}"
    # Source the file safely — only accept known variable names
    while IFS='=' read -r key value; do
      # Skip comments and empty lines
      [[ -z "${key}" || "${key}" =~ ^# ]] && continue
      case "${key}" in
        RUFLO_HEAD)       RUFLO_HEAD="${value}" ;;
        AGENTIC_HEAD)     AGENTIC_HEAD="${value}" ;;
        FANN_HEAD)        FANN_HEAD="${value}" ;;
        PATCH_HEAD)       PATCH_HEAD="${value}" ;;
      esac
    done < "${STATE_FILE}"
    log "State loaded: RUFLO_HEAD=${RUFLO_HEAD:0:12}, AGENTIC_HEAD=${AGENTIC_HEAD:0:12}, FANN_HEAD=${FANN_HEAD:0:12}, PATCH_HEAD=${PATCH_HEAD:0:12}"
  else
    log "No state file found — first run"
  fi
}

save_state() {
  local new_ruflo_head="$1"
  local new_agentic_head="$2"
  local new_fann_head="$3"
  local new_patch_head="$4"

  cat > "${STATE_FILE}" <<EOF
# ruflo build state — written by sync-and-build.sh
# Last updated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
RUFLO_HEAD=${new_ruflo_head}
AGENTIC_HEAD=${new_agentic_head}
FANN_HEAD=${new_fann_head}
PATCH_HEAD=${new_patch_head}
EOF

  log "State saved"
}

# ---------------------------------------------------------------------------
# Phase 1: Check for upstream changes
# ---------------------------------------------------------------------------

check_upstream() {
  local url="$1"
  local last_head="$2"
  local label="$3"
  local current_head

  current_head=$(git ls-remote "${url}" HEAD 2>/dev/null | cut -f1) || true

  if [[ -z "${current_head}" ]]; then
    log_error "git ls-remote failed for ${label} (${url}) — network error or repo unavailable"
    # Return empty string to signal check failure, not "no change"
    echo ""
    return 1
  fi

  if [[ "${current_head}" != "${last_head}" ]]; then
    log "Upstream change detected in ${label}: ${last_head:0:12} -> ${current_head:0:12}"
    echo "${current_head}"
    return 0
  fi

  echo "${current_head}"
  return 0
}

# ---------------------------------------------------------------------------
# Phase 2: Check for local changes
# ---------------------------------------------------------------------------

check_local_changes() {
  local last_commit="$1"
  local changes

  if [[ -z "${last_commit}" ]]; then
    # First run — treat everything as changed
    log "No previous local commit recorded — treating as changed"
    return 0
  fi

  changes=$(git -C "${PROJECT_DIR}" log "${last_commit}..HEAD" --oneline -- patch/ scripts/ 2>/dev/null) || true

  if [[ -n "${changes}" ]]; then
    log "Local changes detected since ${last_commit:0:12}:"
    echo "${changes}" | while IFS= read -r line; do
      log "  ${line}"
    done
    return 0
  fi

  return 1
}

# ---------------------------------------------------------------------------
# Phase 3: Pull upstream repos
# ---------------------------------------------------------------------------

pull_upstream() {
  local dir="$1"
  local label="$2"

  if [[ ! -d "${dir}/.git" ]]; then
    log_error "Upstream directory ${dir} is not a git repo"
    return 1
  fi

  log "Pulling ${label} in ${dir}"
  git -C "${dir}" fetch --all --prune
  git -C "${dir}" reset --hard origin/main 2>/dev/null \
    || git -C "${dir}" reset --hard origin/master 2>/dev/null \
    || { log_error "Could not reset ${label} to origin/main or origin/master"; return 1; }
  log "Pulled ${label}: $(git -C "${dir}" rev-parse --short HEAD)"
}

# ---------------------------------------------------------------------------
# Phase 4: Copy source to temp directory
# ---------------------------------------------------------------------------

create_temp_dir() {
  TEMP_DIR=$(mktemp -d /tmp/ruflo-build-XXXXX)
  log "Created temp directory: ${TEMP_DIR}"
}

copy_source() {
  log "Copying upstream source to ${TEMP_DIR}"

  # Copy the primary upstream repo (ruflo) as the base
  cp -a "${UPSTREAM_DIR_RUFLO}/." "${TEMP_DIR}/"
  rm -rf "${TEMP_DIR}/.git"

  # Copy cross-repo packages into the build dir (ADR-0014 Level 1)
  # agentic-flow repo provides agentdb and agentic-flow packages
  cp -a "${UPSTREAM_DIR_AGENTIC}/." "${TEMP_DIR}/cross-repo/agentic-flow/" 2>/dev/null || {
    mkdir -p "${TEMP_DIR}/cross-repo/agentic-flow"
    cp -a "${UPSTREAM_DIR_AGENTIC}/." "${TEMP_DIR}/cross-repo/agentic-flow/"
  }
  rm -rf "${TEMP_DIR}/cross-repo/agentic-flow/.git"

  # ruv-FANN repo provides ruv-swarm package
  mkdir -p "${TEMP_DIR}/cross-repo/ruv-FANN"
  cp -a "${UPSTREAM_DIR_FANN}/." "${TEMP_DIR}/cross-repo/ruv-FANN/"
  rm -rf "${TEMP_DIR}/cross-repo/ruv-FANN/.git"

  log "Source copied to temp directory (3 repos merged)"
}

# ---------------------------------------------------------------------------
# Phase 5: Run codemod
# ---------------------------------------------------------------------------

run_codemod() {
  log "Running codemod: @claude-flow/* -> @sparkleideas/*"
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
  log "Codemod complete"
}

# ---------------------------------------------------------------------------
# Phase 6: Apply patches
# ---------------------------------------------------------------------------

apply_patches() {
  log "Applying patches via patch-all.sh --target ${TEMP_DIR}"
  bash "${PROJECT_DIR}/patch-all.sh" --target "${TEMP_DIR}"
  log "Patches applied"
}

# ---------------------------------------------------------------------------
# Phase 7: Build
# ---------------------------------------------------------------------------

run_build() {
  # Upstream packages are TypeScript — they need compilation to produce dist/.
  # The package.json "files" field includes "dist" and entry points reference
  # dist/src/index.js, so publishing without building ships empty packages.
  #
  # We install TypeScript locally in the build dir and compile each package
  # individually to avoid workspace dependency resolution issues.

  local v3_dir="${TEMP_DIR}/v3"
  if [[ ! -d "$v3_dir" ]]; then
    log "No v3/ directory found — skipping TypeScript build"
    return 0
  fi

  # Install TypeScript in an isolated directory (the v3 workspace has
  # conflicting peer deps that prevent npm install from succeeding)
  local tsc_dir="${TEMP_DIR}/.tsc-toolchain"
  log "Installing TypeScript toolchain"
  mkdir -p "$tsc_dir"
  echo '{}' > "$tsc_dir/package.json"
  (cd "$tsc_dir" && npm install typescript@5 2>&1) || {
    log_error "Failed to install TypeScript"
    return 1
  }
  local TSC="$tsc_dir/node_modules/.bin/tsc"

  # Build each package that has a tsconfig.json
  # Process in dependency order: shared first, then the rest
  local build_order=(
    shared
    memory embeddings codex aidefence
    neural hooks browser plugins providers claims
    guidance mcp integration deployment swarm security performance testing
    cli
  )

  local built=0
  local failed=0
  for pkg_name in "${build_order[@]}"; do
    # Directory names remain @claude-flow/ after codemod (only file contents are renamed)
    local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    [[ -d "$pkg_dir" ]] || continue
    [[ -f "$pkg_dir/tsconfig.json" ]] || continue

    # Create a standalone tsconfig that doesn't require project references
    # (referenced projects may not be at the expected relative paths after codemod)
    local tmp_tsconfig="$pkg_dir/tsconfig.build.json"
    node -e "
      const ts = JSON.parse(require('fs').readFileSync('$pkg_dir/tsconfig.json', 'utf-8'));
      delete ts.references;
      if (ts.extends) {
        // Inline the base config to avoid path issues
        try {
          const base = JSON.parse(require('fs').readFileSync(require('path').resolve('$pkg_dir', ts.extends), 'utf-8'));
          ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions };
          delete ts.extends;
        } catch {}
      }
      // Ensure skipLibCheck to avoid errors from missing type deps
      ts.compilerOptions.skipLibCheck = true;
      ts.compilerOptions.noEmit = false;
      require('fs').writeFileSync('$tmp_tsconfig', JSON.stringify(ts, null, 2));
    " 2>/dev/null

    if "$TSC" -p "$tmp_tsconfig" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      # Try with looser settings
      if "$TSC" -p "$tmp_tsconfig" --skipLibCheck --noCheck 2>/dev/null; then
        built=$((built + 1))
      else
        log "WARN: TypeScript build failed for ${pkg_name} — trying transpileOnly"
        # Last resort: just copy .ts -> .js with minimal transpilation
        if "$TSC" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules 2>/dev/null; then
          built=$((built + 1))
        else
          log_error "TypeScript build failed for ${pkg_name}"
          failed=$((failed + 1))
        fi
      fi
    fi
    rm -f "$tmp_tsconfig"
  done

  log "Build complete: ${built} packages built, ${failed} failed"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi
}

# ---------------------------------------------------------------------------
# Phase 8: Test
# ---------------------------------------------------------------------------

run_tests() {
  # ── Layer 0: Codemod acceptance (verify scope rename) ──
  log "Running codemod acceptance tests"
  node "${SCRIPT_DIR}/test-codemod-acceptance.mjs" "${TEMP_DIR}" || {
    log_error "Codemod acceptance tests failed"
    return 1
  }
  log "Codemod acceptance tests passed"

  # ── Layer 1: Unit tests (90 tests, ~0.2s) ──
  log "Running unit tests"
  npm test --prefix "${PROJECT_DIR}" || {
    log_error "Unit tests failed"
    return 1
  }
  log "Unit tests passed"

  # ── Layer 2: Integration test (full pipeline against local Verdaccio) ──
  # This catches missing packages, broken deps, and publish failures
  # BEFORE we publish to real npm.
  log "Running integration test (local Verdaccio dry run)"
  bash "${SCRIPT_DIR}/test-integration.sh" || {
    log_error "Integration test failed — aborting before publish to npm"
    return 1
  }
  log "Integration test passed — safe to publish"

  # ── Layer 3: Release Qualification (ADR-0023 — functional smoke tests) ──
  # Publish built packages to a local Verdaccio, install them, and run
  # RQ-1..RQ-12 to verify packages actually work before publishing to real npm.
  # This requires dist/ from the TypeScript build (Phase 7).
  log "Running Release Qualification (functional smoke tests against built packages)"

  # RQ global timeout — kill if Layer 3 exceeds 120s (ADR-0023: Medium < 120s)
  ( sleep 120; log_error "[TIMEOUT] Release Qualification exceeded 120s — aborting"; kill -TERM $$ 2>/dev/null ) &
  local rq_timeout_pid=$!

  local rq_start_s
  rq_start_s=$(date +%s)

  local rq_failed=false
  local rq_temp
  rq_temp=$(mktemp -d /tmp/ruflo-rq-XXXXX)

  # Use permanent global Verdaccio (systemd user service on port 4873)
  local rq_port=4873
  local rq_storage="/home/claude/.verdaccio/storage"

  # Verify global Verdaccio is running
  if ! curl -sf "http://localhost:${rq_port}/-/ping" >/dev/null 2>&1; then
    log_error "Global Verdaccio not running on port ${rq_port}"
    log_error "Start it: systemctl --user start verdaccio"
    kill "$rq_timeout_pid" 2>/dev/null || true
    rm -rf "$rq_temp"
    return 1
  fi
  log "Global Verdaccio healthy on port ${rq_port}"

  # Clear only @sparkleideas/* packages (preserve external dep cache)
  rm -rf "${rq_storage}/@sparkleideas" 2>/dev/null || true

  # Publish built packages to RQ Verdaccio
  log "Publishing built packages to RQ Verdaccio..."
  # Set auth token (global Verdaccio allows $all publish, but npm may require a token)
  npm config set "//localhost:${rq_port}/:_authToken" "test-token" 2>/dev/null || true
  NPM_CONFIG_REGISTRY="http://localhost:${rq_port}" \
    node "${SCRIPT_DIR}/publish.mjs" --build-dir "${TEMP_DIR}" --no-rate-limit 2>&1 || {
    log_error "Failed to publish to RQ Verdaccio"
    kill "$rq_timeout_pid" 2>/dev/null || true
    rm -rf "$rq_temp"
    return 1
  }
  log "Built packages published to RQ Verdaccio"

  # Install packages into RQ temp dir
  (cd "$rq_temp" && echo '{"name":"ruflo-rq-test","version":"1.0.0","private":true}' > package.json \
    && echo "registry=http://localhost:${rq_port}" > .npmrc \
    && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
       --registry "http://localhost:${rq_port}" \
       --ignore-scripts --no-audit --no-fund 2>&1) || {
    log_error "Failed to install packages for RQ"
    kill "$rq_timeout_pid" 2>/dev/null || true
    rm -rf "$rq_temp"
    return 1
  }

  # Source shared test library and run checks
  local checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
  if [[ ! -f "$checks_lib" ]]; then
    log_error "Shared test library not found: $checks_lib"
    kill "$rq_timeout_pid" 2>/dev/null || true
    rm -rf "$rq_temp"
    return 1
  fi
  # shellcheck source=../lib/acceptance-checks.sh
  source "$checks_lib"

  # Set environment for shared checks (save/restore TEMP_DIR since it holds
  # the build directory used by later pipeline phases)
  local rq_saved_temp_dir="$TEMP_DIR"
  REGISTRY="http://localhost:${rq_port}"
  PKG="@sparkleideas/cli"
  TEMP_DIR="$rq_temp"

  # Define run_timed for the shared library
  run_timed() {
    local t_start t_end
    t_start=$(date +%s%N 2>/dev/null || echo 0)
    _OUT="$(eval "$@" 2>&1)" || true
    _EXIT=${PIPESTATUS[0]:-$?}
    t_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$t_start" == "0" || "$t_end" == "0" ]]; then
      _DURATION_MS=0
    else
      _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
    fi
  }

  # Run all 12 RQ checks
  local rq_pass=0 rq_fail=0 rq_total=0
  local rq_results_json="[]"
  local rq_timestamp
  rq_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run_rq_check() {
    local id="$1" name="$2" fn="$3"
    rq_total=$((rq_total + 1))
    log "  RQ $id: $name..."
    local rq_start_ns rq_end_ns rq_dur_ms=0
    rq_start_ns=$(date +%s%N 2>/dev/null || echo 0)
    "$fn"
    rq_end_ns=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$rq_start_ns" != "0" && "$rq_end_ns" != "0" ]]; then
      rq_dur_ms=$(( (rq_end_ns - rq_start_ns) / 1000000 ))
    fi
    if [[ $rq_dur_ms -gt 15000 ]]; then
      log "  SLOW  $id: ${rq_dur_ms}ms (threshold: 15000ms)"
    fi
    local rq_passed_bool="false"
    if [[ "$_CHECK_PASSED" == "true" ]]; then
      rq_pass=$((rq_pass + 1))
      rq_passed_bool="true"
      log "  PASS  $id: $name"
    else
      rq_fail=$((rq_fail + 1))
      log "  FAIL  $id: $name"
      echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do
        log "        $line"
      done
    fi
    # Append to JSON results array
    local rq_entry
    rq_entry=$(printf '{"id":"%s","name":"%s","passed":%s,"duration_ms":%d}' \
      "$id" "$name" "$rq_passed_bool" "$rq_dur_ms")
    if [[ "$rq_results_json" == "[]" ]]; then
      rq_results_json="[$rq_entry]"
    else
      rq_results_json="${rq_results_json%]}, $rq_entry]"
    fi
  }

  run_rq_check "RQ-1"  "Version check"       check_version
  run_rq_check "RQ-2"  "Init"                check_init
  run_rq_check "RQ-3"  "Settings file"       check_settings_file
  run_rq_check "RQ-4"  "Scope check"         check_scope
  run_rq_check "RQ-5"  "Doctor"              check_doctor
  run_rq_check "RQ-6"  "MCP config"          check_mcp_config
  run_rq_check "RQ-7"  "Wrapper proxy"       check_wrapper_proxy
  run_rq_check "RQ-8"  "Memory lifecycle"    check_memory_lifecycle
  run_rq_check "RQ-9"  "Neural training"     check_neural_training
  run_rq_check "RQ-10" "Agent Booster ESM"   check_agent_booster_esm
  run_rq_check "RQ-11" "Agent Booster CLI"   check_agent_booster_bin
  run_rq_check "RQ-12" "Plugins SDK"         check_plugins_sdk

  log "Release Qualification: ${rq_pass}/${rq_total} passed, ${rq_fail} failed"

  # Write qualification-results.json artifact (ADR-0023 Decision 8)
  local rq_results_dir="${PROJECT_DIR}/test-results"
  mkdir -p "$rq_results_dir"
  cat > "$rq_results_dir/qualification-results.json" <<RQJSONEOF
{
  "timestamp": "$rq_timestamp",
  "layer": 3,
  "registry": "http://localhost:${rq_port}",
  "total": $rq_total,
  "passed": $rq_pass,
  "failed": $rq_fail,
  "results": $rq_results_json
}
RQJSONEOF
  log "RQ results written to ${rq_results_dir}/qualification-results.json"

  # Cancel the global RQ timeout
  kill "$rq_timeout_pid" 2>/dev/null || true

  local rq_end_s
  rq_end_s=$(date +%s)
  log "Release Qualification completed in $(( rq_end_s - rq_start_s ))s"

  # Restore TEMP_DIR to the build directory for subsequent pipeline phases
  TEMP_DIR="$rq_saved_temp_dir"

  # Cleanup RQ temp directory (global Verdaccio stays running)
  rm -rf "$rq_temp"

  if [[ $rq_fail -gt 0 ]]; then
    log_error "Release Qualification FAILED — ${rq_fail} functional test(s) failed"
    return 1
  fi
  log "Release Qualification passed — all ${rq_total} functional tests pass"
}

# ---------------------------------------------------------------------------
# Phase 9: Compute version
# ---------------------------------------------------------------------------

compute_version() {
  local upstream_version

  # Read upstream version from the source package.json (CLI package)
  upstream_version=$(node -e "console.log(require('${TEMP_DIR}/package.json').version)")

  if [[ -z "${upstream_version}" ]]; then
    log_error "Could not read upstream version from ${TEMP_DIR}/package.json"
    return 1
  fi

  # Per-package version computation is handled by publish.mjs using
  # config/published-versions.json. BUILD_VERSION here is used only for
  # logging and GitHub release tagging — it reflects the CLI package.
  BUILD_VERSION=$(node -e "
    import { nextVersion } from '${SCRIPT_DIR}/publish.mjs';
    import { readFileSync } from 'fs';
    const pv = JSON.parse(readFileSync('${PROJECT_DIR}/config/published-versions.json', 'utf-8'));
    console.log(nextVersion('${upstream_version}', pv['@sparkleideas/cli']));
  ")

  log "Computed CLI version: ${BUILD_VERSION} (upstream: ${upstream_version})"
}

# ---------------------------------------------------------------------------
# Phase 10: Publish
# ---------------------------------------------------------------------------

run_publish() {
  # Write .npmrc with auth token into temp dir
  # Copy the user's .npmrc (contains auth token) into the build dir
  cp "${HOME}/.npmrc" "${TEMP_DIR}/.npmrc" 2>/dev/null || {
    # Fallback: write from NPM_TOKEN env var (set by systemd EnvironmentFile)
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN:-}" > "${TEMP_DIR}/.npmrc"
  }

  log "Publishing packages (per-package versioning via config/published-versions.json)"
  node "${SCRIPT_DIR}/publish.mjs" --build-dir "${TEMP_DIR}"
  log "Publish complete"
}

# ---------------------------------------------------------------------------
# Phase 11: GitHub prerelease notification
# ---------------------------------------------------------------------------

create_github_notification() {
  local tag="sparkleideas/v${BUILD_VERSION}"
  local current_local_head
  current_local_head=$(git -C "${PROJECT_DIR}" rev-parse HEAD)

  # Read all published package versions for the release body
  local pkg_versions=""
  if [[ -f "${PROJECT_DIR}/config/published-versions.json" ]]; then
    pkg_versions=$(node -e "
      const pv = JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/config/published-versions.json', 'utf-8'));
      for (const [name, ver] of Object.entries(pv)) {
        console.log('- \`' + name + '@' + ver + '\`');
      }
    " 2>/dev/null) || true
  fi

  local body
  body="Automated build from upstream + patches.

**CLI Version**: \`${BUILD_VERSION}\`
**Upstream ruflo HEAD**: \`${NEW_RUFLO_HEAD:0:12}\`
**Upstream agentic-flow HEAD**: \`${NEW_AGENTIC_HEAD:0:12}\`
**Upstream ruv-FANN HEAD**: \`${NEW_FANN_HEAD:0:12}\`
**Local commit**: \`${current_local_head:0:12}\`
**Build timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

### Published packages
${pkg_versions:-_(none)_}

Install:
\`\`\`bash
npx @sparkleideas/cli
\`\`\`

Promote to latest:
\`\`\`bash
npm run promote -- ${BUILD_VERSION}
\`\`\`"

  log "Creating GitHub prerelease: ${tag}"
  gh release create "${tag}" \
    --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo 'ruvnet/ruflo')" \
    --title "@sparkleideas/cli ${BUILD_VERSION}" \
    --notes "${body}" \
    --prerelease \
    --target "$(git -C "${PROJECT_DIR}" rev-parse HEAD)" \
    2>/dev/null || {
      log_error "Failed to create GitHub prerelease (non-fatal)"
    }

  log "GitHub notification created"
}

# ---------------------------------------------------------------------------
# Failure handler: create GitHub issue
# ---------------------------------------------------------------------------

create_failure_issue() {
  local phase="$1"
  local exit_code="$2"

  local title="Build failure in phase: ${phase}"
  local body="The automated ruflo build failed.

**Phase**: ${phase}
**Exit code**: ${exit_code}
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Server**: $(hostname)

Check build logs:
\`\`\`bash
journalctl -u ruflo-sync --since '1 hour ago' --no-pager
\`\`\`"

  log_error "Creating failure issue: ${title}"
  gh issue create \
    --title "${title}" \
    --body "${body}" \
    --label "build-failure" \
    2>/dev/null || log_error "Could not create GitHub issue (gh CLI failed)"
}

# ---------------------------------------------------------------------------
# Run a phase with failure handling
# ---------------------------------------------------------------------------

run_phase() {
  local phase_name="$1"
  shift

  log "=== Phase: ${phase_name} ==="
  if ! "$@"; then
    local code=$?
    create_failure_issue "${phase_name}" "${code}"
    log_error "Phase '${phase_name}' failed — aborting (state NOT updated)"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  log "=========================================="
  log "ruflo sync-and-build starting"
  log "=========================================="

  # Phase 1: Load state
  load_state

  # Phase 2: Check for upstream changes
  local upstream_changed=false
  local upstream_check_failed=false

  NEW_RUFLO_HEAD=$(check_upstream "${UPSTREAM_RUFLO}" "${RUFLO_HEAD}" "ruflo") || upstream_check_failed=true
  NEW_AGENTIC_HEAD=$(check_upstream "${UPSTREAM_AGENTIC}" "${AGENTIC_HEAD}" "agentic-flow") || upstream_check_failed=true
  NEW_FANN_HEAD=$(check_upstream "${UPSTREAM_FANN}" "${FANN_HEAD}" "ruv-FANN") || upstream_check_failed=true

  if [[ "${NEW_RUFLO_HEAD}" != "${RUFLO_HEAD}" && -n "${NEW_RUFLO_HEAD}" ]]; then
    upstream_changed=true
  fi
  if [[ "${NEW_AGENTIC_HEAD}" != "${AGENTIC_HEAD}" && -n "${NEW_AGENTIC_HEAD}" ]]; then
    upstream_changed=true
  fi
  if [[ "${NEW_FANN_HEAD}" != "${FANN_HEAD}" && -n "${NEW_FANN_HEAD}" ]]; then
    upstream_changed=true
  fi

  if [[ "${upstream_changed}" == "true" ]]; then
    log "Upstream changes detected — will rebuild"
  elif [[ "${upstream_check_failed}" == "true" ]]; then
    log "Some upstream checks failed — will check local changes"
  else
    log "No upstream changes"
  fi

  # Phase 3: Check for local changes
  local local_changed=false
  if check_local_changes "${PATCH_HEAD}"; then
    local_changed=true
    log "Local changes detected — will rebuild"
  else
    log "No local changes"
  fi

  # Decide whether to build
  if [[ "${upstream_changed}" == "false" && "${local_changed}" == "false" && "${FORCE_BUILD}" == "false" ]]; then
    log "No changes detected — exiting (use --force to override)"
    exit 0
  fi

  # Use last known HEADs if upstream checks failed
  if [[ -z "${NEW_RUFLO_HEAD}" ]]; then
    NEW_RUFLO_HEAD="${RUFLO_HEAD}"
  fi
  if [[ -z "${NEW_AGENTIC_HEAD}" ]]; then
    NEW_AGENTIC_HEAD="${AGENTIC_HEAD}"
  fi
  if [[ -z "${NEW_FANN_HEAD}" ]]; then
    NEW_FANN_HEAD="${FANN_HEAD}"
  fi

  # Phase 4: Pull upstream repos
  run_phase "pull-ruflo" pull_upstream "${UPSTREAM_DIR_RUFLO}" "ruflo"
  run_phase "pull-agentic" pull_upstream "${UPSTREAM_DIR_AGENTIC}" "agentic-flow"
  run_phase "pull-fann" pull_upstream "${UPSTREAM_DIR_FANN}" "ruv-FANN"

  # Phase 5: Copy source to temp directory
  create_temp_dir
  run_phase "copy-source" copy_source

  # Phase 6: Run codemod
  run_phase "codemod" run_codemod

  # Phase 7: Build (must happen before patches — patches target compiled .js in dist/)
  run_phase "build" run_build

  # Phase 8: Apply patches (runs against compiled dist/src/*.js files)
  run_phase "apply-patches" apply_patches

  # Phase 9: Test (Layers 0-3 — Gate 1)
  run_phase "test" run_tests

  # ═══════════════════ GATE 1 ═══════════════════════════════
  # All pre-publish tests passed. If --test-only, stop here.
  if [[ "${TEST_ONLY}" == "true" ]]; then
    log "=========================================="
    log "Gate 1 PASSED — all pre-publish tests pass (Layers 0-3)"
    log "Stopping before publish (--test-only mode)"
    log "=========================================="
    exit 0
  fi

  # Phase 10: Compute version
  run_phase "compute-version" compute_version

  # Phase 11: Publish
  run_phase "publish" run_publish

  # Phase 12: Post-publish acceptance tests (Layer 4)
  # Validates the real published packages work end-to-end
  log "Running post-publish acceptance tests"
  local acceptance_passed=false
  if bash "${SCRIPT_DIR}/test-acceptance.sh"; then
    log "Acceptance tests passed"
    acceptance_passed=true
  else
    log_error "WARNING: Acceptance tests failed after publish (packages are live)"
    # Don't abort — packages are already published. Create issue instead.
    create_failure_issue "post-publish-acceptance" "$?"
  fi

  # Phase 13: Auto-promote to @latest (ADR-0010 amendment)
  # After acceptance tests pass, promote prerelease to @latest so users
  # on `npx @sparkleideas/cli@latest` get the new version automatically.
  if [[ "$acceptance_passed" == true ]]; then
    log "Promoting ${BUILD_VERSION} to @latest"
    if bash "${SCRIPT_DIR}/promote.sh" --yes "${BUILD_VERSION}"; then
      log "Promotion to @latest complete"
    else
      log_error "WARNING: Promotion to @latest failed (packages remain on prerelease tag)"
      create_failure_issue "promote-latest" "$?"
    fi
  else
    log "Skipping promotion to @latest — acceptance tests did not pass"
  fi

  # Phase 14: GitHub release notification
  create_github_notification

  # Phase 15: Update state (only after successful publish)
  local current_local_head
  current_local_head=$(git -C "${PROJECT_DIR}" rev-parse HEAD)

  save_state \
    "${NEW_RUFLO_HEAD}" \
    "${NEW_AGENTIC_HEAD}" \
    "${NEW_FANN_HEAD}" \
    "${current_local_head}"

  log "=========================================="
  log "Build complete: ${BUILD_VERSION}"
  log "=========================================="
}

main "$@"

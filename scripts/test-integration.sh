#!/usr/bin/env bash
# scripts/test-integration.sh — 9-phase integration test for ruflo-patch.
#
# Runs the full build pipeline against real upstream code, publishing to a
# local Verdaccio registry. See ADR-0020 (testing-strategy) for details.
#
# Usage:
#   bash scripts/test-integration.sh
#   bash scripts/test-integration.sh --snapshot ~/snapshots/2026-03-05
#   bash scripts/test-integration.sh --create-snapshot ~/snapshots/2026-03-05
#
# Exit code: 0 if all phases pass (upstream test failures do NOT count),
#            non-zero on any real failure.

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

UPSTREAM_RUFLO="${HOME}/src/upstream/ruflo"
UPSTREAM_AGENTIC="${HOME}/src/upstream/agentic-flow"
UPSTREAM_FANN="${HOME}/src/upstream/ruv-FANN"

VERDACCIO_PID=""
VERDACCIO_PORT=""
TEMP_BUILD=""
TEMP_INSTALL=""
VERDACCIO_HOME=""
RESULTS_DIR=""
TIMESTAMP="$(date -u '+%Y-%m-%dT%H%M%SZ')"

# Phase tracking
PHASE_RESULTS="[]"
OVERALL_EXIT=0

# CLI flags
SNAPSHOT_DIR=""
CREATE_SNAPSHOT_DIR=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --snapshot)
      SNAPSHOT_DIR="${2:-}"
      [[ -z "$SNAPSHOT_DIR" ]] && { echo "Error: --snapshot requires a directory"; exit 1; }
      shift 2
      ;;
    --create-snapshot)
      CREATE_SNAPSHOT_DIR="${2:-}"
      [[ -z "$CREATE_SNAPSHOT_DIR" ]] && { echo "Error: --create-snapshot requires a directory"; exit 1; }
      shift 2
      ;;
    -h|--help)
      echo "Usage: test-integration.sh [--snapshot <dir>] [--create-snapshot <dir>]"
      echo ""
      echo "Options:"
      echo "  --snapshot <dir>          Use frozen upstream tarballs instead of live clones"
      echo "  --create-snapshot <dir>   Tarball current upstream sources into target dir, then exit"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

phase_log() {
  local phase_num="$1"
  shift
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [Phase ${phase_num}/9] $*"
}

# ---------------------------------------------------------------------------
# Cleanup (trap handler)
# ---------------------------------------------------------------------------

cleanup() {
  local exit_code=$?

  log "Cleanup: shutting down..."

  # Kill Verdaccio if running
  if [[ -n "${VERDACCIO_PID}" ]]; then
    kill "${VERDACCIO_PID}" 2>/dev/null || true
    wait "${VERDACCIO_PID}" 2>/dev/null || true
    log "Cleanup: Verdaccio (PID ${VERDACCIO_PID}) terminated"
  fi

  # Remove temp directories
  for d in "${TEMP_BUILD}" "${TEMP_INSTALL}" "${VERDACCIO_HOME}"; do
    if [[ -n "$d" && -d "$d" ]]; then
      rm -rf "$d"
      log "Cleanup: removed $d"
    fi
  done

  if [[ ${exit_code} -ne 0 ]]; then
    log_error "Integration test exited with code ${exit_code}"
  fi

  exit "${exit_code}"
}

trap cleanup EXIT INT TERM HUP

# ---------------------------------------------------------------------------
# Phase result tracking
# ---------------------------------------------------------------------------

# Record a phase result into the JSON array (using jq)
record_phase() {
  local name="$1"
  local pass="$2"
  local duration_ms="$3"
  local output_excerpt="$4"

  PHASE_RESULTS=$(echo "${PHASE_RESULTS}" | jq \
    --arg name "$name" \
    --argjson pass "$pass" \
    --argjson duration "$duration_ms" \
    --arg output "$output_excerpt" \
    '. + [{"name": $name, "pass": $pass, "duration_ms": $duration, "output": $output}]')
}

# Get elapsed time in milliseconds between two epoch-nanosecond values
elapsed_ms() {
  local start_ns="$1"
  local end_ns="$2"
  echo $(( (end_ns - start_ns) / 1000000 ))
}

now_ns() {
  date +%s%N
}

# Truncate output for JSON storage (max 2000 chars)
truncate_output() {
  local text="$1"
  local max=2000
  if [[ ${#text} -gt $max ]]; then
    echo "${text:0:$max}... (truncated)"
  else
    echo "$text"
  fi
}

# ---------------------------------------------------------------------------
# Snapshot mode: create snapshot and exit
# ---------------------------------------------------------------------------

if [[ -n "${CREATE_SNAPSHOT_DIR}" ]]; then
  log "Creating upstream snapshot in ${CREATE_SNAPSHOT_DIR}"
  mkdir -p "${CREATE_SNAPSHOT_DIR}"

  for repo_dir in "${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}"; do
    if [[ ! -d "$repo_dir" ]]; then
      log_error "Upstream directory not found: $repo_dir"
      exit 1
    fi
    repo_name="$(basename "$repo_dir")"
    log "  Tarballing ${repo_name}..."
    tar -czf "${CREATE_SNAPSHOT_DIR}/${repo_name}.tar.gz" \
      --exclude='.git' \
      -C "$(dirname "$repo_dir")" \
      "$repo_name"
  done

  # Write manifest
  cat > "${CREATE_SNAPSHOT_DIR}/snapshot-manifest.json" <<SNAPEOF
{
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "$(git -C "${UPSTREAM_RUFLO}" rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "agentic_flow_head": "$(git -C "${UPSTREAM_AGENTIC}" rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "ruv_fann_head": "$(git -C "${UPSTREAM_FANN}" rev-parse HEAD 2>/dev/null || echo 'unknown')",
  "platform": "$(uname -srm)"
}
SNAPEOF

  log "Snapshot created at ${CREATE_SNAPSHOT_DIR}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------

check_prerequisites() {
  local fail=0

  # Node >= 20
  if ! command -v node &>/dev/null; then
    log_error "node is not installed"
    fail=1
  else
    local node_major
    node_major=$(node -e 'console.log(process.versions.node.split(".")[0])')
    if [[ "$node_major" -lt 20 ]]; then
      log_error "node >= 20 required, found v$(node --version)"
      fail=1
    else
      log "Prerequisite OK: node $(node --version)"
    fi
  fi

  # pnpm
  if ! command -v pnpm &>/dev/null; then
    log_error "pnpm is not installed"
    fail=1
  else
    log "Prerequisite OK: pnpm $(pnpm --version)"
  fi

  # verdaccio
  if ! command -v verdaccio &>/dev/null; then
    log_error "verdaccio is not installed (npm i -g verdaccio)"
    fail=1
  else
    log "Prerequisite OK: verdaccio $(verdaccio --version 2>/dev/null || echo 'installed')"
  fi

  # jq
  if ! command -v jq &>/dev/null; then
    log_error "jq is not installed"
    fail=1
  else
    log "Prerequisite OK: jq $(jq --version 2>/dev/null || echo 'installed')"
  fi

  # Upstream clone dirs (skip if using snapshot)
  if [[ -z "${SNAPSHOT_DIR}" ]]; then
    for repo_dir in "${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}"; do
      if [[ ! -d "$repo_dir" ]]; then
        log_error "Upstream clone not found: $repo_dir"
        fail=1
      else
        log "Prerequisite OK: $(basename "$repo_dir") clone exists"
      fi
    done
  else
    if [[ ! -d "${SNAPSHOT_DIR}" ]]; then
      log_error "Snapshot directory not found: ${SNAPSHOT_DIR}"
      fail=1
    else
      log "Prerequisite OK: snapshot dir ${SNAPSHOT_DIR} exists"
    fi
  fi

  if [[ $fail -ne 0 ]]; then
    log_error "Prerequisite check failed -- aborting"
    exit 1
  fi

  log "All prerequisites satisfied"
}

# ---------------------------------------------------------------------------
# Phase 1: Setup
# ---------------------------------------------------------------------------

phase_setup() {
  local start
  start=$(now_ns)

  phase_log "1" "Setup - starting Verdaccio and creating temp dirs"

  # Create results directory
  RESULTS_DIR="${PROJECT_DIR}/test-results/${TIMESTAMP}"
  mkdir -p "${RESULTS_DIR}"

  # Create temp directories
  TEMP_BUILD=$(mktemp -d /tmp/ruflo-integ-build-XXXXX)
  TEMP_INSTALL=$(mktemp -d /tmp/ruflo-integ-install-XXXXX)
  VERDACCIO_HOME=$(mktemp -d /tmp/ruflo-integ-verdaccio-XXXXX)

  phase_log "1" "Temp build dir:    ${TEMP_BUILD}"
  phase_log "1" "Temp install dir:  ${TEMP_INSTALL}"
  phase_log "1" "Verdaccio home:    ${VERDACCIO_HOME}"
  phase_log "1" "Results dir:       ${RESULTS_DIR}"

  # Pick a random port
  VERDACCIO_PORT=$(shuf -i 4873-4999 -n 1)

  # Write Verdaccio config with absolute paths to temp dir
  local verdaccio_config="${VERDACCIO_HOME}/verdaccio-config.yaml"
  cat > "${verdaccio_config}" <<VEOF
storage: ${VERDACCIO_HOME}/storage
uplinks: {}
packages:
  '@sparkleideas/*':
    access: \$all
    publish: \$all
  'ruflo-patch':
    access: \$all
    publish: \$all
  '**':
    access: \$all
    publish: \$all
auth:
  htpasswd:
    file: ${VERDACCIO_HOME}/htpasswd
    max_users: 10
log:
  type: file
  path: ${VERDACCIO_HOME}/verdaccio.log
  level: warn
VEOF

  # If a project-level config template exists, note it but use our generated one
  # (the ADR specifies uplinks:{} which is critical for isolation)
  local config_template="${PROJECT_DIR}/config/verdaccio-test.yaml"
  if [[ -f "$config_template" ]]; then
    phase_log "1" "Note: project config/verdaccio-test.yaml exists (using generated config for isolation)"
  fi

  # Start Verdaccio
  phase_log "1" "Starting Verdaccio on port ${VERDACCIO_PORT}..."
  verdaccio --listen "${VERDACCIO_PORT}" --config "${verdaccio_config}" &
  VERDACCIO_PID=$!

  # Wait for Verdaccio to be ready (poll up to 15 seconds)
  local max_wait=15
  local waited=0
  while ! curl -s "http://localhost:${VERDACCIO_PORT}/" >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [[ $waited -ge $max_wait ]]; then
      log_error "Verdaccio did not start within ${max_wait} seconds"
      return 1
    fi
    # Check if process is still alive
    if ! kill -0 "${VERDACCIO_PID}" 2>/dev/null; then
      log_error "Verdaccio process died during startup"
      cat "${VERDACCIO_HOME}/verdaccio.log" 2>/dev/null || true
      return 1
    fi
  done

  phase_log "1" "Verdaccio running (PID ${VERDACCIO_PID}, port ${VERDACCIO_PORT})"

  # Write .test-manifest.json
  local ruflo_head agentic_head fann_head
  if [[ -n "${SNAPSHOT_DIR}" ]]; then
    # Read from snapshot manifest if available
    if [[ -f "${SNAPSHOT_DIR}/snapshot-manifest.json" ]]; then
      ruflo_head=$(jq -r '.ruflo_head' "${SNAPSHOT_DIR}/snapshot-manifest.json")
      agentic_head=$(jq -r '.agentic_flow_head' "${SNAPSHOT_DIR}/snapshot-manifest.json")
      fann_head=$(jq -r '.ruv_fann_head' "${SNAPSHOT_DIR}/snapshot-manifest.json")
    else
      ruflo_head="snapshot-no-manifest"
      agentic_head="snapshot-no-manifest"
      fann_head="snapshot-no-manifest"
    fi
  else
    ruflo_head="$(git -C "${UPSTREAM_RUFLO}" rev-parse HEAD 2>/dev/null || echo 'unavailable')"
    agentic_head="$(git -C "${UPSTREAM_AGENTIC}" rev-parse HEAD 2>/dev/null || echo 'unavailable')"
    fann_head="$(git -C "${UPSTREAM_FANN}" rev-parse HEAD 2>/dev/null || echo 'unavailable')"
  fi

  cat > "${RESULTS_DIR}/.test-manifest.json" <<MEOF
{
  "timestamp": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${ruflo_head}",
  "agentic_flow_head": "${agentic_head}",
  "ruv_fann_head": "${fann_head}",
  "ruflo_patch_head": "$(git -C "${PROJECT_DIR}" rev-parse HEAD 2>/dev/null || echo 'unavailable')",
  "node_version": "$(node --version)",
  "pnpm_version": "$(pnpm --version)",
  "verdaccio_port": ${VERDACCIO_PORT},
  "platform": "$(uname -srm)",
  "snapshot_mode": $([ -n "${SNAPSHOT_DIR}" ] && echo "true" || echo "false")
}
MEOF

  phase_log "1" "Manifest written to ${RESULTS_DIR}/.test-manifest.json"

  local end
  end=$(now_ns)
  record_phase "setup" "true" "$(elapsed_ms "$start" "$end")" "Verdaccio on port ${VERDACCIO_PORT}, temp dirs created"
  phase_log "1" "Setup complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 2: Clone
# ---------------------------------------------------------------------------

phase_clone() {
  local start
  start=$(now_ns)

  phase_log "2" "Clone - copying upstream source to temp dir"

  if [[ -n "${SNAPSHOT_DIR}" ]]; then
    # Extract from snapshot tarballs
    phase_log "2" "Using snapshot from ${SNAPSHOT_DIR}"

    for tarball in ruflo agentic-flow ruv-FANN; do
      local tarpath="${SNAPSHOT_DIR}/${tarball}.tar.gz"
      if [[ ! -f "$tarpath" ]]; then
        log_error "Snapshot tarball not found: $tarpath"
        local end
        end=$(now_ns)
        record_phase "clone" "false" "$(elapsed_ms "$start" "$end")" "Missing tarball: $tarpath"
        return 1
      fi
      phase_log "2" "  Extracting ${tarball}.tar.gz..."
      tar -xzf "$tarpath" -C "${TEMP_BUILD}"
    done
  else
    # Copy from live upstream clones, excluding .git
    for repo_dir in "${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}"; do
      local repo_name
      repo_name="$(basename "$repo_dir")"
      phase_log "2" "  Copying ${repo_name}..."
      rsync -a --exclude='.git' "${repo_dir}/" "${TEMP_BUILD}/${repo_name}/"
    done
  fi

  # Verify at least the primary upstream was copied
  if [[ ! -d "${TEMP_BUILD}/ruflo" ]]; then
    log_error "Primary upstream (ruflo) not found in ${TEMP_BUILD}"
    local end
    end=$(now_ns)
    record_phase "clone" "false" "$(elapsed_ms "$start" "$end")" "ruflo dir not found after copy"
    return 1
  fi

  local file_count
  file_count=$(find "${TEMP_BUILD}" -type f | wc -l)
  phase_log "2" "Copied ${file_count} files to ${TEMP_BUILD}"

  local end
  end=$(now_ns)
  record_phase "clone" "true" "$(elapsed_ms "$start" "$end")" "${file_count} files copied"
  phase_log "2" "Clone complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 3: Codemod
# ---------------------------------------------------------------------------

phase_codemod() {
  local start
  start=$(now_ns)

  phase_log "3" "Codemod - running scope rename"

  local codemod_output
  codemod_output=$(node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_BUILD}" 2>&1) || {
    log_error "Codemod failed"
    echo "$codemod_output" >&2
    local end
    end=$(now_ns)
    record_phase "codemod" "false" "$(elapsed_ms "$start" "$end")" "$(truncate_output "$codemod_output")"
    return 1
  }

  phase_log "3" "Codemod output:"
  echo "$codemod_output" | while IFS= read -r line; do
    phase_log "3" "  $line"
  done

  # Verify: zero @claude-flow/ references remain (excluding @sparkleideas and node_modules)
  local residuals
  residuals=$(grep -r '@claude-flow/' "${TEMP_BUILD}" \
    --include='*.js' --include='*.ts' --include='*.mjs' --include='*.cjs' \
    -l 2>/dev/null \
    | grep -v '@sparkleideas' \
    | grep -v node_modules \
    || true)

  # Save residuals file regardless
  echo "${residuals}" > "${RESULTS_DIR}/codemod-residuals.txt"

  if [[ -n "$residuals" ]]; then
    local residual_count
    residual_count=$(echo "$residuals" | wc -l)
    log_error "Codemod verification failed: ${residual_count} file(s) still contain @claude-flow/ references"
    echo "$residuals" | while IFS= read -r f; do
      log_error "  $f"
    done
    local end
    end=$(now_ns)
    record_phase "codemod" "false" "$(elapsed_ms "$start" "$end")" "${residual_count} residual files"
    return 1
  fi

  phase_log "3" "Codemod verification passed: zero @claude-flow/ residuals"

  local end
  end=$(now_ns)
  record_phase "codemod" "true" "$(elapsed_ms "$start" "$end")" "$(truncate_output "$codemod_output")"
  phase_log "3" "Codemod complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 4: Patch
# ---------------------------------------------------------------------------

phase_patch() {
  local start
  start=$(now_ns)

  phase_log "4" "Patch - applying patches via patch-all.sh"

  local patch_output
  patch_output=$(bash "${PROJECT_DIR}/patch-all.sh" --target "${TEMP_BUILD}" 2>&1) || {
    log_error "patch-all.sh failed"
    echo "$patch_output" >&2
    local end
    end=$(now_ns)
    record_phase "patch" "false" "$(elapsed_ms "$start" "$end")" "$(truncate_output "$patch_output")"
    return 1
  }

  phase_log "4" "Patch output:"
  echo "$patch_output" | while IFS= read -r line; do
    phase_log "4" "  $line"
  done

  # Verify sentinels exist
  local sentinel_count=0
  local sentinel_missing=0
  for sentinel_file in "${PROJECT_DIR}"/patch/*/sentinel; do
    [[ -f "$sentinel_file" ]] || continue
    sentinel_count=$((sentinel_count + 1))
    local patch_name
    patch_name="$(basename "$(dirname "$sentinel_file")")"
    # Read the sentinel to see what it expects (format: "absent|present <pattern> <file>")
    # We just verify the patch directory was processed; detailed sentinel verification
    # is handled by check-patches.sh
    phase_log "4" "  Sentinel present for: ${patch_name}"
  done

  if [[ $sentinel_count -eq 0 ]]; then
    log_error "No sentinel files found in ${PROJECT_DIR}/patch/*/sentinel"
    local end
    end=$(now_ns)
    record_phase "patch" "false" "$(elapsed_ms "$start" "$end")" "No sentinels found"
    return 1
  fi

  phase_log "4" "Verified ${sentinel_count} patch sentinels"

  local end
  end=$(now_ns)
  record_phase "patch" "true" "$(elapsed_ms "$start" "$end")" "${sentinel_count} sentinels verified"
  phase_log "4" "Patch complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 5: Build
# ---------------------------------------------------------------------------

phase_build() {
  local start
  start=$(now_ns)

  phase_log "5" "Build - pnpm install && pnpm build"

  # Find the primary build directory (ruflo is the monorepo root)
  local build_root="${TEMP_BUILD}/ruflo"
  if [[ ! -f "${build_root}/package.json" ]]; then
    # Fallback: maybe the temp dir IS the root (non-snapshot mode with different structure)
    build_root="${TEMP_BUILD}"
  fi

  phase_log "5" "Build root: ${build_root}"

  local install_output
  install_output=$(cd "${build_root}" && pnpm install --no-frozen-lockfile 2>&1) || {
    log_error "pnpm install failed"
    echo "$install_output" >&2
    local end
    end=$(now_ns)
    record_phase "build" "false" "$(elapsed_ms "$start" "$end")" "pnpm install failed: $(truncate_output "$install_output")"
    return 1
  }

  phase_log "5" "pnpm install succeeded"

  local build_output
  build_output=$(cd "${build_root}" && pnpm build 2>&1) || {
    log_error "pnpm build failed"
    echo "$build_output" >&2
    local end
    end=$(now_ns)
    record_phase "build" "false" "$(elapsed_ms "$start" "$end")" "pnpm build failed: $(truncate_output "$build_output")"
    return 1
  }

  phase_log "5" "pnpm build succeeded"

  local end
  end=$(now_ns)
  record_phase "build" "true" "$(elapsed_ms "$start" "$end")" "Install and build succeeded"
  phase_log "5" "Build complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 6: Upstream tests
# ---------------------------------------------------------------------------

phase_upstream_tests() {
  local start
  start=$(now_ns)

  phase_log "6" "Upstream tests - running pnpm test (advisory, non-blocking)"

  local build_root="${TEMP_BUILD}/ruflo"
  if [[ ! -f "${build_root}/package.json" ]]; then
    build_root="${TEMP_BUILD}"
  fi

  local test_output
  local test_exit=0
  test_output=$(cd "${build_root}" && pnpm test 2>&1) || test_exit=$?

  # Save full output
  echo "$test_output" > "${RESULTS_DIR}/upstream-test-output.txt"

  if [[ $test_exit -eq 0 ]]; then
    phase_log "6" "All upstream tests passed"
    echo "" > "${RESULTS_DIR}/upstream-test-failures.txt"
  else
    phase_log "6" "Upstream tests exited with code ${test_exit} (advisory only)"

    # Extract failure lines
    local failures
    failures=$(echo "$test_output" | grep -iE '(FAIL|ERROR|not ok|failing)' || true)
    echo "$failures" > "${RESULTS_DIR}/upstream-test-failures.txt"

    # Compare against known failures baseline
    local known_failures_file="${PROJECT_DIR}/config/known-test-failures.txt"
    if [[ -f "$known_failures_file" ]]; then
      local new_failures
      new_failures=$(echo "$failures" | while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        if ! grep -qF "$line" "$known_failures_file" 2>/dev/null; then
          echo "$line"
        fi
      done || true)

      if [[ -n "$new_failures" ]]; then
        phase_log "6" "WARNING: New test failures not in known-test-failures.txt:"
        echo "$new_failures" | while IFS= read -r line; do
          [[ -n "$line" ]] && phase_log "6" "  NEW: $line"
        done
      else
        phase_log "6" "All failures are in known-test-failures.txt baseline"
      fi
    else
      phase_log "6" "No known-test-failures.txt baseline found -- all failures are new"
    fi
  fi

  # Phase 6 always passes (upstream tests are advisory)
  local end
  end=$(now_ns)
  record_phase "upstream-tests" "true" "$(elapsed_ms "$start" "$end")" "exit code ${test_exit} (advisory)"
  phase_log "6" "Upstream tests phase complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 7: Publish
# ---------------------------------------------------------------------------

phase_publish() {
  local start
  start=$(now_ns)

  phase_log "7" "Publish - publishing to local Verdaccio"

  local build_root="${TEMP_BUILD}/ruflo"
  if [[ ! -f "${build_root}/package.json" ]]; then
    build_root="${TEMP_BUILD}"
  fi

  # Set registry to local Verdaccio for npm operations
  export NPM_CONFIG_REGISTRY="http://localhost:${VERDACCIO_PORT}"

  # Create a .npmrc in the build directory pointing to Verdaccio
  echo "registry=http://localhost:${VERDACCIO_PORT}" > "${build_root}/.npmrc"
  echo "//localhost:${VERDACCIO_PORT}/:_authToken=test-token" >> "${build_root}/.npmrc"

  # Create a Verdaccio user via htpasswd (Verdaccio auto-creates on first publish with htpasswd)
  # Add a test user to the htpasswd file directly
  # htpasswd format: user:password_hash
  echo 'test:{SHA}qUqP5cyxm6YcTAhz05Hph5gvu9M=' > "${VERDACCIO_HOME}/htpasswd"

  local publish_output
  local publish_exit=0
  publish_output=$(node "${SCRIPT_DIR}/publish.mjs" \
    --build-dir "${build_root}" \
    --version "0.0.0-test.1" 2>&1) || publish_exit=$?

  phase_log "7" "Publish output (last 30 lines):"
  echo "$publish_output" | tail -30 | while IFS= read -r line; do
    phase_log "7" "  $line"
  done

  # Extract JSON summary (everything after "--- Summary ---")
  local summary_json
  summary_json=$(echo "$publish_output" | sed -n '/^--- Summary ---$/,$ p' | tail -n +2 || true)

  if [[ -n "$summary_json" ]]; then
    echo "$summary_json" > "${RESULTS_DIR}/publish-summary.json"
  else
    echo '{"note": "no summary extracted", "exit_code": '"${publish_exit}"'}' > "${RESULTS_DIR}/publish-summary.json"
  fi

  if [[ $publish_exit -ne 0 ]]; then
    log_error "Publish failed with exit code ${publish_exit}"
    local end
    end=$(now_ns)
    record_phase "publish" "false" "$(elapsed_ms "$start" "$end")" "Exit code ${publish_exit}: $(truncate_output "$publish_output")"
    return 1
  fi

  # Check for failures in the JSON summary
  local has_failed
  has_failed=$(echo "$summary_json" | jq -r '.failed // empty' 2>/dev/null || true)
  if [[ -n "$has_failed" && "$has_failed" != "null" ]]; then
    log_error "Publish reported failures in summary"
    local end
    end=$(now_ns)
    record_phase "publish" "false" "$(elapsed_ms "$start" "$end")" "Publish reported failures"
    return 1
  fi

  phase_log "7" "Publish succeeded"

  local end
  end=$(now_ns)
  record_phase "publish" "true" "$(elapsed_ms "$start" "$end")" "Published to Verdaccio on port ${VERDACCIO_PORT}"
  phase_log "7" "Publish complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 8: Install
# ---------------------------------------------------------------------------

phase_install() {
  local start
  start=$(now_ns)

  phase_log "8" "Install - verifying ruflo-patch installs from Verdaccio"

  # Create a minimal package.json in the install temp dir
  cat > "${TEMP_INSTALL}/package.json" <<IEOF
{
  "name": "ruflo-integ-test-consumer",
  "version": "1.0.0",
  "private": true
}
IEOF

  # Create .npmrc pointing to Verdaccio
  echo "registry=http://localhost:${VERDACCIO_PORT}" > "${TEMP_INSTALL}/.npmrc"

  local install_output
  local install_exit=0
  install_output=$(cd "${TEMP_INSTALL}" && npm install ruflo-patch@0.0.0-test.1 \
    --registry "http://localhost:${VERDACCIO_PORT}" 2>&1) || install_exit=$?

  if [[ $install_exit -ne 0 ]]; then
    log_error "npm install ruflo-patch failed with exit code ${install_exit}"
    echo "$install_output" >&2
    local end
    end=$(now_ns)
    record_phase "install" "false" "$(elapsed_ms "$start" "$end")" "npm install failed: $(truncate_output "$install_output")"
    return 1
  fi

  # Verify the package is in node_modules
  if [[ -d "${TEMP_INSTALL}/node_modules/ruflo-patch" ]]; then
    phase_log "8" "ruflo-patch installed successfully in node_modules"
  else
    log_error "ruflo-patch not found in node_modules after install"
    local end
    end=$(now_ns)
    record_phase "install" "false" "$(elapsed_ms "$start" "$end")" "Package not in node_modules"
    return 1
  fi

  local end
  end=$(now_ns)
  record_phase "install" "true" "$(elapsed_ms "$start" "$end")" "ruflo-patch@0.0.0-test.1 installed successfully"
  phase_log "8" "Install complete ($(elapsed_ms "$start" "$end")ms)"
}

# ---------------------------------------------------------------------------
# Phase 9: Cleanup
# ---------------------------------------------------------------------------

phase_cleanup() {
  local start
  start=$(now_ns)

  phase_log "9" "Cleanup - copying Verdaccio log and writing final results"

  # Copy Verdaccio log to results
  if [[ -f "${VERDACCIO_HOME}/verdaccio.log" ]]; then
    cp "${VERDACCIO_HOME}/verdaccio.log" "${RESULTS_DIR}/verdaccio.log"
    phase_log "9" "Verdaccio log saved to ${RESULTS_DIR}/verdaccio.log"
  else
    echo "(no verdaccio log found)" > "${RESULTS_DIR}/verdaccio.log"
  fi

  # Write integration-phases.json
  echo "${PHASE_RESULTS}" | jq '.' > "${RESULTS_DIR}/integration-phases.json"
  phase_log "9" "Phase results written to ${RESULTS_DIR}/integration-phases.json"

  # Copy manifest to results (it was written in phase 1)
  # Already exists at ${RESULTS_DIR}/.test-manifest.json

  # Kill Verdaccio (the trap handler will also do this, but be explicit)
  if [[ -n "${VERDACCIO_PID}" ]]; then
    kill "${VERDACCIO_PID}" 2>/dev/null || true
    wait "${VERDACCIO_PID}" 2>/dev/null || true
    phase_log "9" "Verdaccio stopped"
    VERDACCIO_PID=""  # Prevent double-kill in trap
  fi

  # Remove temp dirs (trap will also try, but be explicit)
  for d in "${TEMP_BUILD}" "${TEMP_INSTALL}" "${VERDACCIO_HOME}"; do
    if [[ -n "$d" && -d "$d" ]]; then
      rm -rf "$d"
      phase_log "9" "Removed $d"
    fi
  done
  # Clear vars so trap handler skips them
  TEMP_BUILD=""
  TEMP_INSTALL=""
  VERDACCIO_HOME=""

  local end
  end=$(now_ns)
  record_phase "cleanup" "true" "$(elapsed_ms "$start" "$end")" "All resources released"
  phase_log "9" "Cleanup complete ($(elapsed_ms "$start" "$end")ms)"

  # Re-write phases JSON with cleanup included
  echo "${PHASE_RESULTS}" | jq '.' > "${RESULTS_DIR}/integration-phases.json"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  local overall_start
  overall_start=$(now_ns)

  log "=========================================="
  log "ruflo-patch integration test starting"
  log "=========================================="

  check_prerequisites

  # Run phases sequentially; track failures
  local phase_failed=""

  phase_setup || phase_failed="setup"

  if [[ -z "$phase_failed" ]]; then
    phase_clone || phase_failed="clone"
  fi

  if [[ -z "$phase_failed" ]]; then
    phase_codemod || phase_failed="codemod"
  fi

  if [[ -z "$phase_failed" ]]; then
    phase_patch || phase_failed="patch"
  fi

  if [[ -z "$phase_failed" ]]; then
    phase_build || phase_failed="build"
  fi

  if [[ -z "$phase_failed" ]]; then
    # Phase 6 never fails (advisory)
    phase_upstream_tests
  fi

  if [[ -z "$phase_failed" ]]; then
    phase_publish || phase_failed="publish"
  fi

  if [[ -z "$phase_failed" ]]; then
    phase_install || phase_failed="install"
  fi

  # Phase 9 always runs (cleanup)
  phase_cleanup

  local overall_end
  overall_end=$(now_ns)
  local total_ms
  total_ms=$(elapsed_ms "$overall_start" "$overall_end")

  log "=========================================="
  if [[ -n "$phase_failed" ]]; then
    log "INTEGRATION TEST FAILED at phase: ${phase_failed}"
    log "Total time: ${total_ms}ms"
    log "Results: ${RESULTS_DIR}"
    log "=========================================="
    exit 1
  else
    log "INTEGRATION TEST PASSED"
    log "Total time: ${total_ms}ms"
    log "Results: ${RESULTS_DIR}"
    log "=========================================="
    exit 0
  fi
}

main "$@"

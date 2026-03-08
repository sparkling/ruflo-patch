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

GLOBAL_TIMEOUT_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "${GLOBAL_TIMEOUT_PID}" ]]; then
    kill "${GLOBAL_TIMEOUT_PID}" 2>/dev/null || true
  fi
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
# Phase 6.5: Change Detection (incremental builds — ADR-0023, Decision 10)
# ---------------------------------------------------------------------------

# Packages to rebuild. "all" = full build. Set by detect_changes().
REBUILD_PACKAGES="all"

detect_changes() {
  local checksums_file="${PROJECT_DIR}/config/package-checksums.json"

  # Full rebuild triggers: --force, missing checksums, codemod change
  if [[ "${FORCE_BUILD}" == "true" ]]; then
    log "Change detection: --force flag set — full rebuild"
    REBUILD_PACKAGES="all"
    return 0
  fi

  if [[ ! -f "$checksums_file" ]]; then
    log "Change detection: no checksums file — full rebuild (first run)"
    REBUILD_PACKAGES="all"
    return 0
  fi

  # Check if codemod or patch infrastructure changed
  local stored_meta
  stored_meta=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${checksums_file}', 'utf-8'));
      console.log(JSON.stringify({ codemod_hash: d.codemod_hash || '', patch_dir_hash: d.patch_dir_hash || '' }));
    } catch { console.log('{}'); }
  " 2>/dev/null) || stored_meta="{}"

  local current_codemod_hash
  current_codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || current_codemod_hash=""
  local stored_codemod_hash
  stored_codemod_hash=$(echo "$stored_meta" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).codemod_hash||'')" 2>/dev/null) || stored_codemod_hash=""

  if [[ "$current_codemod_hash" != "$stored_codemod_hash" ]]; then
    log "Change detection: codemod.mjs changed — full rebuild"
    REBUILD_PACKAGES="all"
    return 0
  fi

  local current_patch_hash
  current_patch_hash=$(find "${PROJECT_DIR}/lib/common.py" "${PROJECT_DIR}/patch" -type f 2>/dev/null | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1) || current_patch_hash=""
  local stored_patch_hash
  stored_patch_hash=$(echo "$stored_meta" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).patch_dir_hash||'')" 2>/dev/null) || stored_patch_hash=""

  if [[ "$current_patch_hash" != "$stored_patch_hash" ]]; then
    log "Change detection: patch infrastructure changed — full rebuild"
    REBUILD_PACKAGES="all"
    return 0
  fi

  # Compute current hashes and diff against stored
  log "Computing package content hashes..."
  local hash_output
  hash_output=$(node "${SCRIPT_DIR}/package-hash.mjs" \
    --build-dir "${TEMP_DIR}" \
    --stored-hashes "$checksums_file" \
    --levels 2>/dev/null) || {
    log "Change detection: hash computation failed — full rebuild"
    REBUILD_PACKAGES="all"
    return 0
  }

  local changed_count unchanged_count
  changed_count=$(echo "$hash_output" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.all_rebuild.length)" 2>/dev/null) || changed_count=0
  unchanged_count=$(echo "$hash_output" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.unchanged.length)" 2>/dev/null) || unchanged_count=0

  if [[ "$changed_count" -eq 0 ]]; then
    log "Change detection: no packages changed — nothing to rebuild"
    REBUILD_PACKAGES="[]"
    return 0
  fi

  # Extract the all_rebuild array as JSON
  REBUILD_PACKAGES=$(echo "$hash_output" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d.all_rebuild))" 2>/dev/null) || REBUILD_PACKAGES="all"

  log "Change detection: ${changed_count} packages to rebuild, ${unchanged_count} unchanged"
  log "Rebuild set: ${REBUILD_PACKAGES}"
}

# Helper: check if a package name is in the rebuild set
needs_rebuild() {
  local pkg_name="$1"
  if [[ "$REBUILD_PACKAGES" == "all" ]]; then
    return 0
  fi
  echo "$REBUILD_PACKAGES" | node -e "
    const pkgs=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    process.exit(pkgs.includes('@sparkleideas/${pkg_name}') ? 0 : 1)
  " 2>/dev/null
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

  # Remove all .npmignore and .gitignore files so npm publish uses the "files"
  # field from package.json exclusively. Upstream .npmignore files exclude
  # dist/ and wasm/ (build artifacts they don't commit to git), but we build
  # them and need them included in the published tarball.
  find "${TEMP_DIR}" -name ".npmignore" -not -path "*/node_modules/*" -delete 2>/dev/null || true
  find "${TEMP_DIR}" -name ".gitignore" -not -path "*/node_modules/*" -delete 2>/dev/null || true

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
  local tsc_install_start
  tsc_install_start=$(date +%s%N 2>/dev/null || echo 0)
  (cd "$tsc_dir" && npm install typescript@5 2>&1) || {
    log_error "Failed to install TypeScript"
    return 1
  }
  local tsc_install_end
  tsc_install_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$tsc_install_start" != "0" && "$tsc_install_end" != "0" ]]; then
    log "  TypeScript install: $(( (tsc_install_end - tsc_install_start) / 1000000 ))ms"
  fi
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
  local skipped=0
  for pkg_name in "${build_order[@]}"; do
    # Directory names remain @claude-flow/ after codemod (only file contents are renamed)
    local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    [[ -d "$pkg_dir" ]] || continue
    [[ -f "$pkg_dir/tsconfig.json" ]] || continue

    # Incremental: skip unchanged packages
    if ! needs_rebuild "$pkg_name"; then
      skipped=$((skipped + 1))
      log "  SKIP: ${pkg_name} (unchanged)"
      continue
    fi

    local pkg_build_start
    pkg_build_start=$(date +%s%N 2>/dev/null || echo 0)

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
    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      log "  BUILD: ${pkg_name} $(( (pkg_build_end - pkg_build_start) / 1000000 ))ms"
    fi
  done

  # Build cross-repo packages that have tsconfig.json
  # These live outside v3/@claude-flow/ but need TypeScript compilation
  local cross_repo_builds=(
    "cross-repo/agentic-flow/packages/agent-booster"
  )
  for rel_path in "${cross_repo_builds[@]}"; do
    local pkg_dir="${TEMP_DIR}/${rel_path}"
    [[ -d "$pkg_dir" && -f "$pkg_dir/tsconfig.json" ]] || continue

    if ! needs_rebuild "agent-booster"; then
      skipped=$((skipped + 1))
      log "  SKIP: ${rel_path} (unchanged)"
      continue
    fi

    log "  Building cross-repo: ${rel_path}"

    # Build WASM module if this package has a Rust crate (e.g. agent-booster)
    local crate_dir="$pkg_dir/crates/agent-booster-wasm"
    if [[ -d "$crate_dir" ]] && command -v wasm-pack &>/dev/null; then
      log "  Building WASM: ${rel_path}/crates/agent-booster-wasm"
      local wasm_out
      wasm_out=$(wasm-pack build "$crate_dir" --target nodejs --out-dir "$pkg_dir/wasm" 2>&1) || {
        log "WARN: WASM build failed for ${rel_path} (agent-booster ESM import will fail)"
        echo "$wasm_out" | tail -5 | while IFS= read -r line; do log "  $line"; done
      }
      if [[ -f "$pkg_dir/wasm/agent_booster_wasm.js" ]]; then
        # Remove wasm-pack generated package.json and .gitignore — package.json
        # causes npm to treat wasm/ as a nested package, and .gitignore contains
        # "*" which makes npm exclude all wasm files from the tarball
        rm -f "$pkg_dir/wasm/package.json" "$pkg_dir/wasm/.gitignore"
        log "  WASM build succeeded"
      fi
    fi

    if "$TSC" -p "$pkg_dir/tsconfig.json" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      log "WARN: TypeScript build failed for ${rel_path}"
      failed=$((failed + 1))
    fi
  done

  log "Build complete: ${built} built, ${skipped} skipped (unchanged), ${failed} failed"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi
}

# ---------------------------------------------------------------------------
# Phase 8: Test
# ---------------------------------------------------------------------------

run_tests() {
  local test_start_ns test_end_ns test_ms

  # ── Layer 0: Codemod acceptance (verify scope rename) ──
  log "Running codemod acceptance tests"
  test_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  node "${SCRIPT_DIR}/test-codemod-acceptance.mjs" "${TEMP_DIR}" || {
    log_error "Codemod acceptance tests failed"
    return 1
  }
  test_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  test_ms=0; [[ "$test_start_ns" != "0" && "$test_end_ns" != "0" ]] && test_ms=$(( (test_end_ns - test_start_ns) / 1000000 ))
  log "Codemod acceptance tests passed (${test_ms}ms)"

  # ── Layer 1: Unit tests (90 tests, ~0.2s) ──
  log "Running unit tests"
  test_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  npm test --prefix "${PROJECT_DIR}" || {
    log_error "Unit tests failed"
    return 1
  }
  test_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  test_ms=0; [[ "$test_start_ns" != "0" && "$test_end_ns" != "0" ]] && test_ms=$(( (test_end_ns - test_start_ns) / 1000000 ))
  log "Unit tests passed (${test_ms}ms)"

  # ── Layer 2: Integration test (full pipeline against local Verdaccio) ──
  # This catches missing packages, broken deps, and publish failures
  # BEFORE we publish to real npm.
  log "Running integration test (local Verdaccio dry run)"
  test_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  bash "${SCRIPT_DIR}/test-integration.sh" --changed-packages "$REBUILD_PACKAGES" || {
    log_error "Integration test failed — aborting before publish to npm"
    return 1
  }
  test_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  test_ms=0; [[ "$test_start_ns" != "0" && "$test_end_ns" != "0" ]] && test_ms=$(( (test_end_ns - test_start_ns) / 1000000 ))
  log "Integration test passed (${test_ms}ms)"

  # ── Layer 3: Release Qualification (ADR-0023 — functional smoke tests) ──
  # Standalone script that publishes built packages to Verdaccio, installs them,
  # and runs RQ-1..RQ-14. Requires dist/ from the TypeScript build (Phase 7).
  log "Running Release Qualification"
  test_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  local rq_args="--build-dir ${TEMP_DIR}"
  if [[ "$REBUILD_PACKAGES" != "all" && "$REBUILD_PACKAGES" != "[]" ]]; then
    rq_args="${rq_args} --changed-packages '${REBUILD_PACKAGES}'"
  fi
  # shellcheck disable=SC2086
  bash "${SCRIPT_DIR}/test-rq.sh" ${rq_args} || {
    log_error "Release Qualification FAILED"
    return 1
  }
  test_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  test_ms=0; [[ "$test_start_ns" != "0" && "$test_end_ns" != "0" ]] && test_ms=$(( (test_end_ns - test_start_ns) / 1000000 ))
  log "Release Qualification passed (${test_ms}ms)"
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
  local publish_args=""
  if [[ "$REBUILD_PACKAGES" != "all" && "$REBUILD_PACKAGES" != "[]" ]]; then
    publish_args="--packages '${REBUILD_PACKAGES}'"
    log "Incremental: publishing only changed packages"
  fi
  # shellcheck disable=SC2086
  node "${SCRIPT_DIR}/publish.mjs" --build-dir "${TEMP_DIR}" ${publish_args}
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

# Phase timing accumulator: "name:ms name:ms ..."
PHASE_TIMINGS=""

run_phase() {
  local phase_name="$1"
  shift

  log "=== Phase: ${phase_name} ==="
  local phase_start_ns
  phase_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  if ! "$@"; then
    local code=$?
    create_failure_issue "${phase_name}" "${code}"
    log_error "Phase '${phase_name}' failed — aborting (state NOT updated)"
    exit 1
  fi
  local phase_end_ns
  phase_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$phase_start_ns" != "0" && "$phase_end_ns" != "0" ]]; then
    local phase_ms=$(( (phase_end_ns - phase_start_ns) / 1000000 ))
    log "  Phase '${phase_name}' completed in ${phase_ms}ms"
    PHASE_TIMINGS="${PHASE_TIMINGS} ${phase_name}:${phase_ms}"
  fi
}

print_phase_summary() {
  log "──────────────────────────────────────────"
  log "Phase timing summary:"
  for entry in $PHASE_TIMINGS; do
    local name="${entry%%:*}"
    local ms="${entry##*:}"
    if [[ $ms -ge 1000 ]]; then
      log "  $(printf '%-25s %6dms (%ds)' "$name" "$ms" "$((ms / 1000))")"
    else
      log "  $(printf '%-25s %6dms' "$name" "$ms")"
    fi
  done
  log "──────────────────────────────────────────"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  log "=========================================="
  log "ruflo sync-and-build starting"
  log "=========================================="

  # Global timeout — 900s (Google "Large" size ceiling)
  ( sleep 900; log_error "[TIMEOUT] sync-and-build.sh exceeded 900s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
  GLOBAL_TIMEOUT_PID=$!

  # Phase 1: Load state
  load_state

  # Phase 2: Check for upstream changes
  local upstream_changed=false
  local upstream_check_failed=false
  local check_start_ns
  check_start_ns=$(date +%s%N 2>/dev/null || echo 0)

  NEW_RUFLO_HEAD=$(check_upstream "${UPSTREAM_RUFLO}" "${RUFLO_HEAD}" "ruflo") || upstream_check_failed=true
  NEW_AGENTIC_HEAD=$(check_upstream "${UPSTREAM_AGENTIC}" "${AGENTIC_HEAD}" "agentic-flow") || upstream_check_failed=true
  NEW_FANN_HEAD=$(check_upstream "${UPSTREAM_FANN}" "${FANN_HEAD}" "ruv-FANN") || upstream_check_failed=true

  local check_end_ns
  check_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$check_start_ns" != "0" && "$check_end_ns" != "0" ]]; then
    local check_ms=$(( (check_end_ns - check_start_ns) / 1000000 ))
    log "  Upstream checks completed in ${check_ms}ms"
    PHASE_TIMINGS="${PHASE_TIMINGS} check-upstream:${check_ms}"
  fi

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

  # Phase 6.5: Change detection (ADR-0023, Decision 10)
  # Must run AFTER codemod (hashes include codemod transforms) but BEFORE build
  # (so we know which packages to skip in TypeScript compilation)
  run_phase "detect-changes" detect_changes

  # Phase 7: Build (must happen before patches — patches target compiled .js in dist/)
  # Incremental: only builds packages in REBUILD_PACKAGES
  run_phase "build" run_build

  # Phase 8: Apply patches (runs against compiled dist/src/*.js files)
  run_phase "apply-patches" apply_patches

  # Phase 9: Test (Layers 0-3 — Gate 1)
  run_phase "test" run_tests

  # ═══════════════════ GATE 1 ═══════════════════════════════
  # All pre-publish tests passed. If --test-only, stop here.
  if [[ "${TEST_ONLY}" == "true" ]]; then
    print_phase_summary
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
  # Wait for npm CDN to serve the newly published version before testing.
  # Poll instead of fixed sleep — CDN propagation time varies (5-120s).
  log "Waiting for npm CDN to propagate ${BUILD_VERSION}..."
  local cdn_attempts=0
  local cdn_max=12  # 12 * 10s = 120s max wait
  while [[ $cdn_attempts -lt $cdn_max ]]; do
    local cdn_ver
    cdn_ver=$(npm view @sparkleideas/cli@prerelease version 2>/dev/null) || true
    if [[ "$cdn_ver" == "$BUILD_VERSION" ]]; then
      log "CDN propagation confirmed: @sparkleideas/cli@prerelease = ${cdn_ver}"
      break
    fi
    cdn_attempts=$((cdn_attempts + 1))
    log "  CDN check ${cdn_attempts}/${cdn_max}: got '${cdn_ver:-}', waiting for '${BUILD_VERSION}'..."
    sleep 10
  done
  if [[ $cdn_attempts -ge $cdn_max ]]; then
    log "WARNING: CDN propagation timed out after ${cdn_max}0s — running acceptance tests anyway"
  fi
  log "Running post-publish acceptance tests against version ${BUILD_VERSION}"
  local acceptance_passed=false
  if bash "${SCRIPT_DIR}/test-acceptance.sh" --version "${BUILD_VERSION}"; then
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

  # Post-promotion smoke — verify @latest actually works
  if [[ "$acceptance_passed" == true ]]; then
    log "Running post-promotion smoke test..."
    local smoke_cache
    smoke_cache=$(mktemp -d /tmp/ruflo-smoke-XXXXX)
    local smoke_out
    smoke_out=$(NPM_CONFIG_CACHE="$smoke_cache" npx --yes @sparkleideas/cli@latest --version 2>&1) || true
    rm -rf "$smoke_cache"
    if echo "$smoke_out" | grep -qE '^[0-9]+\.[0-9]+'; then
      log "Post-promotion smoke PASSED: @latest = $(echo "$smoke_out" | head -1)"
    else
      log_error "Post-promotion smoke FAILED — @latest is broken after promotion"
      log_error "Output: $(echo "$smoke_out" | head -3)"
    fi
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

  # Save package checksums for incremental builds (ADR-0023, Decision 10)
  log "Saving package checksums for next incremental build"
  local codemod_hash patch_dir_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""
  patch_dir_hash=$(find "${PROJECT_DIR}/lib/common.py" "${PROJECT_DIR}/patch" -type f 2>/dev/null | sort | xargs sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1) || patch_dir_hash=""
  node -e "
    import { computeAllHashes, saveChecksums } from '${SCRIPT_DIR}/package-hash.mjs';
    import { readFileSync, readdirSync, statSync } from 'fs';
    import { resolve, join } from 'path';
    // Rebuild package map for the build dir
    const map = new Map();
    function walk(dir) {
      try { for (const e of readdirSync(dir)) {
        if (e === 'node_modules') continue;
        const f = resolve(dir, e);
        try { const s = statSync(f);
          if (s.isDirectory()) walk(f);
          else if (e === 'package.json') {
            try { const p = JSON.parse(readFileSync(f, 'utf-8'));
              if (p.name) map.set(p.name, dir);
            } catch {}
          }
        } catch {}
      }} catch {}
    }
    walk('${TEMP_DIR}');
    const hashes = computeAllHashes('${TEMP_DIR}', map);
    saveChecksums('${PROJECT_DIR}/config/package-checksums.json', hashes, {
      codemod_hash: '${codemod_hash}',
      patch_dir_hash: '${patch_dir_hash}',
      generated_at: new Date().toISOString(),
    });
    console.log('Checksums saved for ' + Object.keys(hashes).length + ' packages');
  " 2>&1 || log "WARNING: Failed to save checksums (non-fatal)"

  print_phase_summary
  log "=========================================="
  log "Build complete: ${BUILD_VERSION}"
  log "=========================================="
}

main "$@"

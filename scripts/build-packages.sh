#!/usr/bin/env bash
# scripts/build-packages.sh — TypeScript compile + WASM build (ADR-0038)
#
# Standalone build script extracted from sync-and-build.sh.
# Compiles TypeScript packages in dependency order, builds WASM.
#
# Usage: bash scripts/build-packages.sh [build-dir]
#
# Environment:
#   TEMP_DIR                Build directory (default: /tmp/ruflo-build)
#   CHANGED_PACKAGES_JSON   JSON array of changed packages (default: "all")
#   NEW_RUFLO_HEAD          Fork HEAD SHAs for build manifest
#   NEW_AGENTIC_HEAD
#   NEW_FANN_HEAD
#   NEW_RUVECTOR_HEAD

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source shared utilities
source "${PROJECT_DIR}/lib/pipeline-utils.sh"

TEMP_DIR="${1:-${TEMP_DIR:-/tmp/ruflo-build}}"
mkdir -p "${TEMP_DIR}"

# Initialise timing files (idempotent — don't clobber if already populated)
: >> "$TIMING_CMDS_FILE"
: >> "$TIMING_BUILD_PKGS_FILE"

: "${CHANGED_PACKAGES_JSON:=all}"
: "${NEW_RUFLO_HEAD:=}"
: "${NEW_AGENTIC_HEAD:=}"
: "${NEW_FANN_HEAD:=}"
: "${NEW_RUVECTOR_HEAD:=}"
BUILD_COMPILED_COUNT=""
BUILD_TOTAL_COUNT=""

# ---------------------------------------------------------------------------
# Build (TypeScript compilation)
# ---------------------------------------------------------------------------

run_build() {
  # Remove .npmignore and .gitignore so npm publish uses "files" from package.json (single find)
  find "${TEMP_DIR}" \( -name ".npmignore" -o -name ".gitignore" \) -not -path "*/node_modules/*" -delete 2>/dev/null || true

  local v3_dir="${TEMP_DIR}/v3"
  if [[ ! -d "$v3_dir" ]]; then
    log "No v3/ directory found — skipping TypeScript build"
    return 0
  fi

  # Install TypeScript in a persistent directory (cached across runs)
  local tsc_dir="/tmp/ruflo-tsc-toolchain"
  # ADR-0040: extend TTL to 7 days + content hash for pinned deps
  local _deps_str="typescript@5 zod@3 @types/express @types/cors @types/fs-extra"
  # Compute deps hash to detect changes in pinned dep list
  local _deps_hash
  _deps_hash=$(printf '%s' "$_deps_str" | sha256sum | cut -d' ' -f1)
  local _stored_hash=""
  [[ -f "${tsc_dir}/.deps-hash" ]] && _stored_hash=$(cat "${tsc_dir}/.deps-hash" 2>/dev/null)
  if [[ ! -x "${tsc_dir}/node_modules/.bin/tsc" ]] || \
     [[ "$_deps_hash" != "$_stored_hash" ]] || \
     [[ $(find "${tsc_dir}" -maxdepth 0 -mmin +10080 -print 2>/dev/null | wc -l) -gt 0 ]]; then
    rm -rf "${tsc_dir}"
    mkdir -p "${tsc_dir}" "${tsc_dir}/stubs"
    (cd "$tsc_dir" && echo '{"private":true}' > package.json \
      && npm install $_deps_str --save-exact 2>&1) | tail -1
    # Copy static type stubs (ADR-0039: committed files instead of heredocs)
    cp "${PROJECT_DIR}/config/tsc-stubs/"*.d.ts "${tsc_dir}/stubs/"
    printf '%s' "$_deps_hash" > "${tsc_dir}/.deps-hash"
    log "TypeScript toolchain installed at ${tsc_dir}"
  else
    log "TypeScript toolchain cached at ${tsc_dir}"
  fi
  local tsc_bin="${tsc_dir}/node_modules/.bin/tsc"

  # Parse CHANGED_PACKAGES_JSON (full transitive set) into a lookup set for
  # selective builds. We must rebuild ALL dependents, not just directly changed
  # packages — dependents import from dist/ output which may have changed.
  local -A changed_set
  local selective_build=false
  if [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" && "${CHANGED_PACKAGES_JSON}" != "[]" ]]; then
    selective_build=true
    # Extract package short names from JSON array of @sparkleideas/* names
    for full_name in $(echo "${CHANGED_PACKAGES_JSON}" | node -e "
      const d=require('fs').readFileSync(0,'utf8');try{JSON.parse(d).forEach(n=>console.log(n.replace('@sparkleideas/','')))}catch{}
    " 2>/dev/null); do
      changed_set["$full_name"]=1
    done
  fi

  local built=0
  local failed=0
  local skipped=0

  # Build one package (called from parallel group below)
  build_one_pkg() {
    local pkg_name="$1"
    # Accept either a bare name (resolved under v3/@claude-flow/) or a full path
    local pkg_dir
    if [[ "$pkg_name" == /* ]]; then
      pkg_dir="$pkg_name"
      pkg_name="$(basename "$pkg_dir")"
    else
      pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    fi
    local pkg_build_start
    pkg_build_start=$(date +%s%N 2>/dev/null || echo 0)

    # Generate standalone tsconfig (ADR-0039: extracted to gen-tsconfig.mjs)
    local tmp_tsconfig="$pkg_dir/tsconfig.build.json"
    node "${SCRIPT_DIR}/gen-tsconfig.mjs" --pkg-dir "$pkg_dir" --tsc-dir "$tsc_dir" --output "$tmp_tsconfig" 2>/dev/null

    local ok=0
    local fallback_level=3
    local tsc_log="$pkg_dir/.tsc-build.log"
    # ADR-0040: --incremental with .tsbuildinfo for faster rebuilds
    local _incr_flags="--incremental --tsBuildInfoFile ${pkg_dir}/.tsbuildinfo"
    if "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck $_incr_flags 2>"$tsc_log"; then
      ok=1; fallback_level=0
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck $_incr_flags 2>"$tsc_log"; then
      ok=1; fallback_level=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules $_incr_flags 2>"$tsc_log"; then
      ok=1; fallback_level=2
    fi
    # Log failures instead of swallowing them
    if [[ $ok -eq 0 && -s "$tsc_log" ]]; then
      log "    tsc failed for ${pkg_name}: $(head -3 "$tsc_log" | tr '\n' ' ')"
    fi
    # ADR-0040: keep tsconfig.build.json — .tsbuildinfo references it
    rm -f "$tsc_log"

    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    local _bms=0
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      _bms=$(( (pkg_build_end - pkg_build_start) / 1000000 ))
    fi
    # Write result to a per-package file so parallel appends don't race
    echo "${pkg_name} ${ok} ${_bms} ${fallback_level}" > "${TEMP_DIR}/.build-result-${pkg_name}"
  }

  # Group packages by dependency level for parallel builds (B3: derive from publish-levels.json)
  # Packages within the same group have no inter-dependencies.
  # Build groups map to publish levels 2-5 (level 1 packages are cross-repo).
  # Only v3/@claude-flow/* packages are built here; plugins and cross-repo
  # packages are handled separately below.
  local -a group_0 group_1 group_2 group_3
  local -a all_groups

  # Known v3/@claude-flow/ packages (used to filter out cross-repo and plugin packages)
  local -A _v3_packages=([shared]=1 [memory]=1 [embeddings]=1 [codex]=1 [aidefence]=1
    [neural]=1 [hooks]=1 [browser]=1 [plugins]=1 [providers]=1 [claims]=1
    [guidance]=1 [mcp]=1 [integration]=1 [deployment]=1 [swarm]=1
    [security]=1 [performance]=1 [testing]=1 [cli]=1)

  # Try to read from publish-levels.json; fall back to hardcoded if unavailable
  local _build_groups_ok=false
  local _build_groups_json
  # Read levels 2-5 from JSON, filter to v3/@claude-flow/ packages only
  _build_groups_json=$(node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync('${PROJECT_DIR}/config/publish-levels.json', 'utf-8'));
    const v3set = new Set(['shared','memory','embeddings','codex','aidefence',
      'neural','hooks','browser','plugins','providers','claims',
      'guidance','mcp','integration','deployment','swarm',
      'security','performance','testing','cli']);
    for (let i = 1; i < data.levels.length; i++) {
      const pkgs = data.levels[i].packages
        .map(p => p.replace('@sparkleideas/', ''))
        .filter(p => v3set.has(p));
      console.log(pkgs.join(' '));
    }
  " 2>/dev/null) && _build_groups_ok=true

  if [[ "$_build_groups_ok" == "true" && -n "$_build_groups_json" ]]; then
    local _gi=0
    while IFS= read -r _line; do
      if [[ -n "$_line" ]]; then
        # Split space-separated names into array
        read -ra "_tmp_arr" <<< "$_line"
        eval "group_${_gi}=(\"\${_tmp_arr[@]}\")"
      else
        eval "group_${_gi}=()"
      fi
      _gi=$((_gi + 1))
    done <<< "$_build_groups_json"
    # Build all_groups from populated groups
    all_groups=()
    for (( _g=0; _g<_gi; _g++ )); do
      local -n _gref="group_${_g}"
      [[ ${#_gref[@]} -gt 0 ]] && all_groups+=("group_${_g}")
    done
  else
    log "WARN: Could not read publish-levels.json for build groups — using hardcoded fallback"
    group_0=(shared memory embeddings codex aidefence)
    group_1=(neural hooks browser plugins providers claims)
    group_2=(guidance mcp integration deployment swarm security performance testing)
    group_3=(cli)
    all_groups=("group_0" "group_1" "group_2" "group_3")
  fi

  local _group_idx=0
  for group_var in "${all_groups[@]}"; do
    local -n group_ref="$group_var"
    local -a bg_pids=()
    local _grp_start _grp_end _grp_count=0

    _grp_start=$(date +%s%N 2>/dev/null || echo 0)
    for pkg_name in "${group_ref[@]}"; do
      local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
      [[ -d "$pkg_dir" ]] || continue
      [[ -f "$pkg_dir/tsconfig.json" ]] || continue

      if [[ "$selective_build" == "true" && -z "${changed_set[$pkg_name]:-}" ]]; then
        skipped=$((skipped + 1))
        continue
      fi

      build_one_pkg "$pkg_name" &
      bg_pids+=($!)
      _grp_count=$((_grp_count + 1))
    done

    # Wait for all packages in this group before starting the next
    for pid in "${bg_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    _grp_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_grp_start" != "0" && "$_grp_end" != "0" && $_grp_count -gt 0 ]]; then
      local _grp_ms=$(( (_grp_end - _grp_start) / 1000000 ))
      log "  GROUP ${_group_idx} (${_grp_count} pkgs): ${_grp_ms}ms wall-clock"
      add_cmd_timing "build" "group_${_group_idx} (${_grp_count} pkgs)" "${_grp_ms}"
    fi
    _group_idx=$((_group_idx + 1))
  done

  # Build packages outside v3/@claude-flow/ (cross-repo, v3/plugins/*)
  local -a extra_pkg_dirs=()
  # Cross-repo packages (agentic-flow fork)
  for extra_dir in \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb" \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb-onnx"; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  # agentic-flow root uses config/tsconfig.json — compile it directly
  local af_dir="${TEMP_DIR}/cross-repo/agentic-flow/agentic-flow"
  if [[ -f "${af_dir}/config/tsconfig.json" && ! -f "${af_dir}/dist/index.js" ]]; then
    log "  Building agentic-flow (config/tsconfig.json)..."
    local _af_start
    _af_start=$(date +%s%N 2>/dev/null || echo 0)
    # ADR-0040: --incremental for agentic-flow standalone build
    "$tsc_bin" -p "${af_dir}/config/tsconfig.json" --skipLibCheck --noCheck \
      --incremental --tsBuildInfoFile "${af_dir}/.tsbuildinfo" 2>/dev/null || true
    local _af_end
    _af_end=$(date +%s%N 2>/dev/null || echo 0)
    local _af_ms=0
    [[ "$_af_start" != "0" && "$_af_end" != "0" ]] && _af_ms=$(( (_af_end - _af_start) / 1000000 ))
    if [[ -f "${af_dir}/dist/index.js" ]]; then
      log "  BUILD: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 1 ${_af_ms} 1" > "${TEMP_DIR}/.build-result-agentic-flow"
    else
      log "  FAIL: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 0 ${_af_ms} 3" > "${TEMP_DIR}/.build-result-agentic-flow"
    fi
  fi
  # v3/plugins/* (all plugin packages with tsconfig)
  for extra_dir in "${TEMP_DIR}"/v3/plugins/*/; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  if [[ ${#extra_pkg_dirs[@]} -gt 0 ]]; then
    local -a extra_pids=()
    local _extra_start
    _extra_start=$(date +%s%N 2>/dev/null || echo 0)
    for extra_dir in "${extra_pkg_dirs[@]}"; do
      build_one_pkg "$extra_dir" &
      extra_pids+=($!)
    done
    for pid in "${extra_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    local _extra_end
    _extra_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_extra_start" != "0" && "$_extra_end" != "0" ]]; then
      local _extra_ms=$(( (_extra_end - _extra_start) / 1000000 ))
      log "  EXTRA (${#extra_pkg_dirs[@]} pkgs): ${_extra_ms}ms wall-clock"
      add_cmd_timing "build" "extra (${#extra_pkg_dirs[@]} pkgs)" "${_extra_ms}"
    fi
  fi

  # Collect results from per-package files (avoids shared-file race condition)
  for result_file in "${TEMP_DIR}"/.build-result-*; do
    [[ -f "$result_file" ]] || continue
    IFS=' ' read -r pkg_name ok _bms fallback_level < "$result_file"
    [[ -z "$pkg_name" ]] && { rm -f "$result_file"; continue; }
    if [[ "$ok" == "1" ]]; then
      built=$((built + 1))
      if [[ "${fallback_level:-0}" -gt 0 ]]; then
        log_warn "  ${pkg_name} compiled with fallback level ${fallback_level}"
      fi
    else
      log_error "TypeScript build failed for ${pkg_name}"
      failed=$((failed + 1))
    fi
    log "  BUILD: ${pkg_name} ${_bms}ms"
    add_build_pkg_timing "${pkg_name}" "${_bms}"
    add_cmd_timing "build" "tsc ${pkg_name}" "${_bms}"
    rm -f "$result_file"
  done

  # Build cross-repo packages (TSC only — WASM is handled by build-wasm.sh)
  local cross_repo_builds=(
    "cross-repo/agentic-flow/packages/agent-booster"
  )
  for rel_path in "${cross_repo_builds[@]}"; do
    local pkg_dir="${TEMP_DIR}/${rel_path}"
    [[ -d "$pkg_dir" && -f "$pkg_dir/tsconfig.json" ]] || continue

    log "  Building cross-repo TSC: ${rel_path}"
    local _xr_tsc_start _xr_tsc_end
    _xr_tsc_start=$(date +%s%N 2>/dev/null || echo 0)
    # ADR-0040: --incremental for cross-repo builds
    if "$tsc_bin" -p "$pkg_dir/tsconfig.json" --skipLibCheck \
      --incremental --tsBuildInfoFile "$pkg_dir/.tsbuildinfo" 2>/dev/null; then
      built=$((built + 1))
    else
      log "WARN: TypeScript build failed for ${rel_path}"
      failed=$((failed + 1))
    fi
    _xr_tsc_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_xr_tsc_start" != "0" && "$_xr_tsc_end" != "0" ]]; then
      local _xr_tsc_ms=$(( (_xr_tsc_end - _xr_tsc_start) / 1000000 ))
      log "  cross-repo TSC: ${_xr_tsc_ms}ms"
      add_cmd_timing "build" "tsc cross-repo/agent-booster" "${_xr_tsc_ms}"
    fi
  done

  log "Build complete: ${built} built, ${skipped} skipped, ${failed} failed"

  # ADR-0040: single find traversal categorizing dist dirs and package.json files
  local total_packages=0 compiled_packages=0 pre_built_packages _scan_start _scan_end
  _scan_start=$(date +%s%N 2>/dev/null || echo 0)
  local _pkg_json_files=()
  while IFS= read -r -d '' _entry; do
    if [[ -d "$_entry" ]]; then
      compiled_packages=$((compiled_packages + 1))
    else
      _pkg_json_files+=("$_entry")
    fi
  done < <(find "${TEMP_DIR}" \( -name "dist" -type d \) -o \( -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" \) -print0 2>/dev/null)
  if [[ ${#_pkg_json_files[@]} -gt 0 ]]; then
    # Count package.json files that contain @sparkleideas/ scope
    total_packages=$(grep -l '"@sparkleideas/' "${_pkg_json_files[@]}" 2>/dev/null | wc -l)
  fi
  pre_built_packages=$((total_packages - compiled_packages))
  _scan_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_scan_start" != "0" && "$_scan_end" != "0" ]]; then
    local _scan_ms=$(( (_scan_end - _scan_start) / 1000000 ))
    log "  post-build scan: ${_scan_ms}ms"
    add_cmd_timing "build" "find scan" "${_scan_ms}"
  fi
  log "Build directory contains ${total_packages} publishable packages (${compiled_packages} compiled, ${pre_built_packages} pre-built)"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi

  # Export build stats for caller's write_build_manifest (via file, since this is a subprocess)
  echo "${compiled_packages} ${total_packages}" > "${TEMP_DIR}/.build-counts"
  BUILD_COMPILED_COUNT=$compiled_packages
  BUILD_TOTAL_COUNT=$total_packages
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_build
log "Build packages complete"

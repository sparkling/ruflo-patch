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
# Codemod wrapper
# ---------------------------------------------------------------------------

run_codemod() {
  log "Running codemod: @claude-flow/* -> @sparkleideas/*"
  local _cm_start _cm_end
  _cm_start=$(date +%s%N 2>/dev/null || echo 0)
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
  _cm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_cm_start" != "0" && "$_cm_end" != "0" ]]; then
    local _cm_ms=$(( (_cm_end - _cm_start) / 1000000 ))
    log "  Codemod completed in ${_cm_ms}ms"
    add_cmd_timing "codemod" "node codemod.mjs" "${_cm_ms}"
  fi

  # Strip publish bloat from agentic-jujutsu (~58MB of native binaries, nested
  # tarballs, tests, docs). The upstream files field includes the whole directory
  # but consumers only need index.js, *.d.ts, bin/, pkg/, and package.json.
  local jj_dir="${TEMP_DIR}/cross-repo/agentic-flow/packages/agentic-jujutsu"
  if [[ -d "$jj_dir" ]]; then
    local _jj_before _jj_after
    _jj_before=$(du -sm "$jj_dir" 2>/dev/null | cut -f1) || _jj_before=0
    rm -f "$jj_dir"/*.node "$jj_dir"/*.tgz 2>/dev/null || true
    rm -rf "$jj_dir"/{tests,docs,benchmarks,benches,examples,test-repo,target,src,typescript,helpers,scripts} 2>/dev/null || true
    _jj_after=$(du -sm "$jj_dir" 2>/dev/null | cut -f1) || _jj_after=0
    local _jj_saved=$(( _jj_before - _jj_after ))
    if [[ $_jj_saved -gt 0 ]]; then
      log "  Stripped ${_jj_saved}MB publish bloat from agentic-jujutsu (${_jj_before}MB -> ${_jj_after}MB)"
    fi
  fi
}

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
  if [[ ! -x "${tsc_dir}/node_modules/.bin/tsc" ]] || \
     [[ $(find "${tsc_dir}" -maxdepth 0 -mmin +1440 -print 2>/dev/null | wc -l) -gt 0 ]]; then
    rm -rf "${tsc_dir}"
    mkdir -p "${tsc_dir}" "${tsc_dir}/stubs"
    (cd "$tsc_dir" && echo '{"private":true}' > package.json \
      && npm install typescript@5 zod@3 @types/express @types/cors @types/fs-extra --save-exact 2>&1) | tail -1
    # Copy static type stubs (ADR-0039: committed files instead of heredocs)
    cp "${PROJECT_DIR}/config/tsc-stubs/"*.d.ts "${tsc_dir}/stubs/"
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
    local tsc_log="$pkg_dir/.tsc-build.log"
    if "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules 2>"$tsc_log"; then
      ok=1
    fi
    # Log failures instead of swallowing them
    if [[ $ok -eq 0 && -s "$tsc_log" ]]; then
      log "    tsc failed for ${pkg_name}: $(head -3 "$tsc_log" | tr '\n' ' ')"
    fi
    rm -f "$tmp_tsconfig" "$tsc_log"

    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    local _bms=0
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      _bms=$(( (pkg_build_end - pkg_build_start) / 1000000 ))
    fi
    # Write result to a temp file so the parent can collect it
    echo "${pkg_name} ${ok} ${_bms}" >> "${TEMP_DIR}/.build-results"
  }

  # Group packages by dependency level for parallel builds
  # Packages within the same group have no inter-dependencies
  local -a group_0=(shared)
  local -a group_1=(memory embeddings codex aidefence)
  local -a group_2=(neural hooks browser plugins providers claims)
  local -a group_3=(guidance mcp integration deployment swarm security performance testing)
  local -a group_4=(cli)
  local -a all_groups=("group_0" "group_1" "group_2" "group_3" "group_4")

  : > "${TEMP_DIR}/.build-results"

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
    "$tsc_bin" -p "${af_dir}/config/tsconfig.json" --skipLibCheck --noCheck 2>/dev/null || true
    local _af_end
    _af_end=$(date +%s%N 2>/dev/null || echo 0)
    local _af_ms=0
    [[ "$_af_start" != "0" && "$_af_end" != "0" ]] && _af_ms=$(( (_af_end - _af_start) / 1000000 ))
    if [[ -f "${af_dir}/dist/index.js" ]]; then
      log "  BUILD: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 1 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
    else
      log "  FAIL: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 0 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
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

  # Collect results from parallel builds
  while IFS=' ' read -r pkg_name ok _bms; do
    [[ -z "$pkg_name" ]] && continue
    if [[ "$ok" == "1" ]]; then
      built=$((built + 1))
    else
      log_error "TypeScript build failed for ${pkg_name}"
      failed=$((failed + 1))
    fi
    log "  BUILD: ${pkg_name} ${_bms}ms"
    add_build_pkg_timing "${pkg_name}" "${_bms}"
    add_cmd_timing "build" "tsc ${pkg_name}" "${_bms}"
  done < "${TEMP_DIR}/.build-results"
  rm -f "${TEMP_DIR}/.build-results"

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
    if "$tsc_bin" -p "$pkg_dir/tsconfig.json" --skipLibCheck 2>/dev/null; then
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

  # Single combined scan (avoids running find twice for the same data)
  local total_packages compiled_packages pre_built_packages _scan_start _scan_end
  _scan_start=$(date +%s%N 2>/dev/null || echo 0)
  compiled_packages=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  total_packages=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
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

  # Export build stats for manifest (written by write_build_manifest after build completes)
  BUILD_COMPILED_COUNT=$compiled_packages
  BUILD_TOTAL_COUNT=$total_packages
}

write_build_manifest() {
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local _wm_start _wm_end
  _wm_start=$(date +%s%N 2>/dev/null || echo 0)
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""

  # Use pre-computed counts from run_build if available, else scan (for --build-only without run_build)
  local compiled_count="${BUILD_COMPILED_COUNT:-}"
  local total_count="${BUILD_TOTAL_COUNT:-}"
  if [[ -z "$compiled_count" ]]; then
    compiled_count=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  fi
  if [[ -z "$total_count" ]]; then
    total_count=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
  fi

  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": ${compiled_count},
  "packages_total": ${total_count}
}
MANIFESTEOF
  _wm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_wm_start" != "0" && "$_wm_end" != "0" ]]; then
    local _wm_ms=$(( (_wm_end - _wm_start) / 1000000 ))
    log "  Build manifest written in ${_wm_ms}ms"
    add_cmd_timing "build" "write-manifest" "${_wm_ms}"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

run_build
write_build_manifest
log "Build packages complete"

#!/usr/bin/env bash
# lib/acceptance-adr0085-checks.sh — ADR-0085 acceptance checks
#
# Bridge Deletion & Ideal State Gap Closure.
# Verifies that the published CLI has no memory-bridge residue.
#
# ADR-0085 decisions tested here:
#   - memory-bridge.js absent from published dist
#   - memory-initializer.js has zero bridge imports
#   - memory-router.js has initControllerRegistry
#
# Requires: acceptance-checks.sh sourced first (_run_and_kill, _cli_cmd available)
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# ADR-0085-1: memory-bridge.js absent from published CLI dist
#
# The bridge file (3,650 lines) was deleted in the fork source.
# After codemod + build, the compiled .js must not be in the dist.
# ════════════════════════════════════════════════════════════════════

check_no_bridge_in_dist() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)

  if [ -z "$cli_pkg_dir" ]; then
    cli_pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)
  fi

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0085-1: could not locate @sparkleideas/cli package in node_modules"
    return
  fi

  local bridge_files
  bridge_files=$(find "$cli_pkg_dir" -name "memory-bridge.*" -type f 2>/dev/null)

  if [ -n "$bridge_files" ]; then
    _CHECK_OUTPUT="ADR-0085-1: memory-bridge files found in dist: $bridge_files"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0085-1: memory-bridge absent from published CLI dist"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0085-2: memory-initializer.js has zero bridge imports
#
# After Phase 2, the compiled initializer must not contain any
# import/require of memory-bridge.
# ════════════════════════════════════════════════════════════════════

check_initializer_zero_bridge_imports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)

  if [ -z "$cli_pkg_dir" ]; then
    cli_pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)
  fi

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0085-2: could not locate @sparkleideas/cli package"
    return
  fi

  local init_file
  init_file=$(find "$cli_pkg_dir" -name "memory-initializer.js" -type f 2>/dev/null | head -1)

  if [ -z "$init_file" ]; then
    # ADR-0086 Debt 6: memory-initializer.ts deleted — zero bridge refs by definition
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0085-2: memory-initializer.js absent from dist (deleted by ADR-0086 Debt 6)"
    return
  fi

  local bridge_refs
  bridge_refs=$(grep -c 'memory-bridge' "$init_file" 2>/dev/null || echo 0)

  if [ "$bridge_refs" -gt 0 ]; then
    local lines
    lines=$(grep -n 'memory-bridge' "$init_file" 2>/dev/null | head -3)
    _CHECK_OUTPUT="ADR-0085-2: memory-initializer.js still references memory-bridge ($bridge_refs hits): $lines"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0085-2: memory-initializer.js has zero bridge references"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0085-3: memory-router.js has initControllerRegistry
#
# After Phase 1, the compiled router must contain the extracted
# initControllerRegistry function (moved from the deleted bridge).
# ════════════════════════════════════════════════════════════════════

check_router_has_init_controller_registry() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)

  if [ -z "$cli_pkg_dir" ]; then
    cli_pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/cli" -type d 2>/dev/null | head -1)
  fi

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0085-3: could not locate @sparkleideas/cli package"
    return
  fi

  local router_file
  router_file=$(find "$cli_pkg_dir" -name "memory-router.js" -type f 2>/dev/null | head -1)

  if [ -z "$router_file" ]; then
    _CHECK_OUTPUT="ADR-0085-3: memory-router.js not found in dist"
    return
  fi

  if ! grep -q 'initControllerRegistry' "$router_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0085-3: memory-router.js does NOT contain initControllerRegistry"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0085-3: memory-router.js contains initControllerRegistry"
}

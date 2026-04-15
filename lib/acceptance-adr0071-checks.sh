#!/usr/bin/env bash
# lib/acceptance-adr0071-checks.sh — ADR-0071/0072 acceptance checks
#
# Gap 1a: Verify published packages have no residual @ruvector/ import/require refs.
# Gap 1b: Verify at least one .node native binary is bundled.
#
# Requires: TEMP_DIR set by caller (install dir with node_modules/@sparkleideas/*)

# ════════════════════════════════════════════════════════════════════
# ADR-0071-1: No residual @ruvector/ import/require in published dist/
# ════════════════════════════════════════════════════════════════════

check_adr0071_no_ruvector_refs() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0071: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  # Packages whose dist/ directories we scan
  local pkgs=("cli" "memory" "agentdb")
  local bad_refs=""
  local scanned=0

  for pkg in "${pkgs[@]}"; do
    local dist_dir="${base}/${pkg}/dist"
    if [[ ! -d "$dist_dir" ]]; then
      # Package may not have a dist/ — check top-level .js files instead
      dist_dir="${base}/${pkg}"
    fi
    [[ -d "$dist_dir" ]] || continue
    scanned=$((scanned + 1))

    # Grep for @ruvector/ in import/require statements (not comments/strings)
    # Pattern: import ... from '@ruvector/ or require('@ruvector/
    local hits
    hits=$(grep -rn --include='*.js' --include='*.mjs' --include='*.cjs' \
      -E "(from\s+['\"]@ruvector/|require\(['\"]@ruvector/)" "$dist_dir" 2>/dev/null || true)

    if [[ -n "$hits" ]]; then
      bad_refs="${bad_refs}${pkg}: $(echo "$hits" | wc -l | tr -d ' ') import/require refs\n"
    fi
  done

  if [[ $scanned -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0071: no dist/ directories found to scan"
    return
  fi

  if [[ -z "$bad_refs" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0071: zero @ruvector/ import/require refs in ${scanned} packages"
  else
    _CHECK_OUTPUT="ADR-0071: residual @ruvector/ import/require refs found: ${bad_refs}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0071-2: At least one .node native binary exists in installed packages
# ════════════════════════════════════════════════════════════════════

check_adr0071_node_binary_exists() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0071: @sparkleideas not installed in TEMP_DIR"
    return
  fi

  local node_files
  node_files=$(find "$base" -name '*.node' -type f 2>/dev/null || true)
  local count
  # grep -c always prints a count and exits 1 on zero matches; `|| echo 0`
  # would append a second "0" producing "0\n0". Use ${var:-0} fallback.
  count=$(echo "$node_files" | grep -c '\.node$' 2>/dev/null)
  count=${count:-0}

  if [[ "$count" -ge 1 ]]; then
    # Show which package(s) contain native binaries
    local locations
    locations=$(echo "$node_files" | sed "s|${base}/||" | head -5 | tr '\n' ', ')
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0071: ${count} .node binary(ies) found (${locations%,})"
  else
    # Check platform — native binaries are only expected for darwin-arm64 / linux-x64 etc.
    local arch
    arch="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
    _CHECK_OUTPUT="ADR-0071: zero .node binaries found (platform: ${arch}). Expected at least 1 for native packages."
  fi
}

#!/usr/bin/env bash
# lib/acceptance-adr0069-checks.sh — ADR-0069 Config Chain Bypass Remediation acceptance checks
#
# Verifies published @sparkleideas/* packages use config-chain resolution
# (getEmbeddingConfig / deriveHNSWParams) instead of hardcoded 768/23/100/50.
#
# Requires: _find_pkg_js from acceptance-adr0063-checks.sh (or acceptance-checks.sh)
# Caller MUST set: TEMP_DIR

check_adr0069_adapter_uses_config_chain() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local adapter_file
  adapter_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "agentdb-adapter.js")

  if [[ -z "$adapter_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: agentdb-adapter.js not found in published memory package"
    return
  fi

  # The patched file should reference getEmbeddingConfig or resolveEmbeddingDefaults
  # instead of bare hardcoded DEFAULT_CONFIG with literal 768/23/100
  if grep -qE 'getEmbeddingConfig|resolveEmbeddingDefaults|deriveHNSWParams' "$adapter_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: agentdb-adapter uses config-chain resolution"
  else
    # Check if it still has hardcoded DEFAULT_CONFIG with literals
    if grep -qE 'dimensions:\s*768|hnswM:\s*23|efConstruction:\s*100' "$adapter_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0069: agentdb-adapter still has hardcoded DEFAULT_CONFIG (768/23/100)"
    else
      _CHECK_OUTPUT="ADR-0069: agentdb-adapter — no config-chain call and no hardcodes found (inconclusive)"
    fi
  fi
}

check_adr0069_backend_uses_config_chain() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local backend_file
  backend_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "agentdb-backend.js")

  if [[ -z "$backend_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: agentdb-backend.js not found in published memory package"
    return
  fi

  if grep -qE 'getEmbeddingConfig|resolveEmbeddingDefaults|deriveHNSWParams' "$backend_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: agentdb-backend uses config-chain resolution"
  else
    if grep -qE 'dimensions:\s*768|hnswM:\s*23|efConstruction:\s*100' "$backend_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0069: agentdb-backend still has hardcoded DEFAULT_CONFIG (768/23/100)"
    else
      _CHECK_OUTPUT="ADR-0069: agentdb-backend — no config-chain call and no hardcodes found (inconclusive)"
    fi
  fi
}

check_adr0069_bridge_uses_config_chain() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local bridge_file
  bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "agentic-flow-bridge.js")

  if [[ -z "$bridge_file" ]]; then
    # Try integration package
    bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/integration" "agentic-flow-bridge.js")
  fi

  if [[ -z "$bridge_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: agentic-flow-bridge.js not found in published packages"
    return
  fi

  if grep -qE 'getEmbeddingConfig|resolveEmbeddingDefaults|deriveHNSWParams' "$bridge_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: agentic-flow-bridge uses config-chain resolution"
  else
    if grep -qE 'dimensions:\s*768|hnswM:\s*23|efConstruction:\s*100' "$bridge_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0069: agentic-flow-bridge still has hardcoded bypass values (768/23/100)"
    else
      _CHECK_OUTPUT="ADR-0069: agentic-flow-bridge — no config-chain call and no hardcodes found (inconclusive)"
    fi
  fi
}

check_adr0069_hooks_rb_uses_config_chain() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local hooks_rb_file
  hooks_rb_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/hooks" "reasoningbank")

  # Try index.js inside reasoningbank directory
  if [[ -z "$hooks_rb_file" ]]; then
    hooks_rb_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/hooks" -path "*/reasoningbank/index.js" 2>/dev/null | head -1)
  fi
  # Fall back to any JS file mentioning DEFAULT_CONFIG in hooks package
  if [[ -z "$hooks_rb_file" ]]; then
    hooks_rb_file=$(grep -rlE 'DEFAULT_CONFIG' "$TEMP_DIR/node_modules/@sparkleideas/hooks" --include='*.js' 2>/dev/null | head -1)
  fi

  if [[ -z "$hooks_rb_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: hooks reasoningbank not found in published hooks package"
    return
  fi

  if grep -qE 'getEmbeddingConfig|resolveEmbeddingDefaults|deriveHNSWParams' "$hooks_rb_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: hooks reasoningbank uses config-chain resolution"
  else
    if grep -qE 'dimensions:\s*768|hnswM:\s*23|efConstruction:\s*100' "$hooks_rb_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0069: hooks reasoningbank still has hardcoded DEFAULT_CONFIG (768/23/100)"
    else
      _CHECK_OUTPUT="ADR-0069: hooks reasoningbank — no config-chain call and no hardcodes found (inconclusive)"
    fi
  fi
}

check_adr0069_bypass_count() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local total_bypasses=0
  local bypass_details=""
  local pkgs=("cli" "memory" "shared" "hooks" "embeddings" "integration")

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    if [[ -d "$pkg_dir" ]]; then
      # Count DEFAULT_CONFIG blocks that still contain hardcoded dimension: 768 or dimensions: 768
      # Exclude: comments, fallback blocks clearly guarded by catch/try
      local count
      count=$(grep -rE 'DEFAULT_CONFIG.*=|const\s+DEFAULT' "$pkg_dir" --include='*.js' -l 2>/dev/null \
        | xargs grep -lE 'dimensions?:\s*768' 2>/dev/null \
        | grep -v node_modules \
        | wc -l | tr -d ' ')
      if [[ "$count" -gt 0 ]]; then
        total_bypasses=$((total_bypasses + count))
        bypass_details="${bypass_details} ${pkg}:${count}"
      fi
    fi
  done

  if [[ "$total_bypasses" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: zero hardcoded dimension:768 in DEFAULT_CONFIG across all published packages"
  else
    _CHECK_OUTPUT="ADR-0069: ${total_bypasses} file(s) with hardcoded dimension:768 in DEFAULT_CONFIG:${bypass_details}"
  fi
}

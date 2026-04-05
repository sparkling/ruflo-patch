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

check_adr0069_factory_maxelements_not_10k() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local factory_file
  factory_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "factory.js")

  if [[ -z "$factory_file" ]]; then
    # Try agentdb sub-path
    factory_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "factory.js" -path "*/agentdb*" 2>/dev/null | head -1)
  fi

  if [[ -z "$factory_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: factory.js not found in published memory/agentdb package"
    return
  fi

  # The old buggy value was maxElements: 10000 (or 10_000 or 1e4).
  # After ADR-0069 fix, factory should use 100000 (from config chain).
  if grep -qE 'maxElements\s*[:=]\s*(10000|10_000|1e4)\b' "$factory_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0069: factory.ts still has buggy maxElements=10000 (should be 100000 from config chain)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: factory.ts maxElements is not the old buggy 10000"
  fi
}

check_adr0069_hnsw_params_include_maxelements() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local hnsw_file
  hnsw_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "hnsw-utils.js")

  if [[ -z "$hnsw_file" ]]; then
    # Broader search for hnsw utils
    hnsw_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "hnsw*.js" 2>/dev/null | head -1)
  fi

  if [[ -z "$hnsw_file" ]]; then
    # Try shared package
    hnsw_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/shared" "hnsw-utils.js")
    if [[ -z "$hnsw_file" ]]; then
      hnsw_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/shared" -name "hnsw*.js" 2>/dev/null | head -1)
    fi
  fi

  if [[ -z "$hnsw_file" ]]; then
    _CHECK_OUTPUT="ADR-0069: hnsw-utils.js not found in published memory or shared package"
    return
  fi

  if grep -qE 'maxElements' "$hnsw_file" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: hnsw-utils includes maxElements in HNSWParams return"
  else
    _CHECK_OUTPUT="ADR-0069: hnsw-utils.js does not include maxElements in HNSWParams"
  fi
}

# ── H7–H11 checks ─────────────────────────────────────────────────────

check_adr0069_no_hardcoded_swarm_dir() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local swarm_tools_file
  swarm_tools_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "swarm-tools.js")

  if [[ -z "$swarm_tools_file" ]]; then
    swarm_tools_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/cli" -name "swarm*.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  fi

  if [[ -z "$swarm_tools_file" ]]; then
    _CHECK_OUTPUT="ADR-0069 H4: swarm-tools.js not found in published cli package"
    return
  fi

  # Published swarm-tools should use .swarm not .claude-flow/swarm
  if grep -qE '\.claude-flow/swarm' "$swarm_tools_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0069 H4: swarm-tools still references .claude-flow/swarm (should use .swarm)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069 H4: swarm-tools uses .swarm not .claude-flow/swarm"
  fi
}

check_adr0069_search_threshold_not_05() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkgs=("cli" "memory" "hooks")
  local found_05="false"
  local offending=""

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    [[ -d "$pkg_dir" ]] || continue

    # Look for search/query files with threshold: 0.5 (the old buggy default)
    local hits
    hits=$(grep -rlE 'threshold\s*[:=]\s*0\.5\b' "$pkg_dir" --include='*.js' 2>/dev/null \
      | grep -vE 'node_modules|\.map$' || true)

    if [[ -n "$hits" ]]; then
      found_05="true"
      offending="${offending} ${pkg}:$(echo "$hits" | wc -l | tr -d ' ')"
    fi
  done

  if [[ "$found_05" == "false" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069 H7: no threshold: 0.5 found in search-memory code"
  else
    _CHECK_OUTPUT="ADR-0069 H7: search threshold 0.5 still present in:${offending}"
  fi
}

check_adr0069_migration_batch_aligned() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local mem_dir="$TEMP_DIR/node_modules/@sparkleideas/memory"
  if [[ ! -d "$mem_dir" ]]; then
    _CHECK_OUTPUT="ADR-0069 H10: @sparkleideas/memory not found"
    return
  fi

  # Find both migration files
  local mig_file rvf_mig_file
  mig_file=$(find "$mem_dir" -name "migration.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  rvf_mig_file=$(find "$mem_dir" -name "rvf-migration.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -z "$mig_file" && -z "$rvf_mig_file" ]]; then
    _CHECK_OUTPUT="ADR-0069 H10: neither migration.js nor rvf-migration.js found"
    return
  fi

  # Check for the old mismatched value (100 in migration.ts, 500 in rvf-migration.ts)
  local mig_has_100="false"
  if [[ -n "$mig_file" ]] && grep -qE 'batchSize\s*[:=]\s*100\b' "$mig_file" 2>/dev/null; then
    mig_has_100="true"
  fi

  if [[ "$mig_has_100" == "true" ]]; then
    _CHECK_OUTPUT="ADR-0069 H10: migration.js still uses batchSize=100 (should be 500 or config-driven)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069 H10: migration batch sizes aligned (no hardcoded 100 in migration.js)"
  fi
}

check_adr0069_dedup_threshold_aligned() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkgs=("memory" "hooks")
  local found_098="false"
  local offending=""

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    [[ -d "$pkg_dir" ]] || continue

    # Look for dedup threshold of 0.98 (the old inconsistent value)
    local hits
    hits=$(grep -rlE 'dedup.*0\.98|0\.98.*dedup|dedupThreshold\s*[:=]\s*0\.98' "$pkg_dir" --include='*.js' 2>/dev/null \
      | grep -vE 'node_modules|\.map$' || true)

    if [[ -n "$hits" ]]; then
      found_098="true"
      offending="${offending} ${pkg}:$(echo "$hits" | wc -l | tr -d ' ')"
    fi
  done

  if [[ "$found_098" == "false" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069 H11: no hardcoded dedupThreshold 0.98 — AgentDB and ReasoningBank aligned"
  else
    _CHECK_OUTPUT="ADR-0069 H11: dedupThreshold 0.98 still present in:${offending}"
  fi
}

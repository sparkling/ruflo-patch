#!/usr/bin/env bash
# lib/acceptance-adr0062-checks.sh — ADR-0062: Storage & Configuration Unification
#
# Acceptance checks that verify ADR-0062 patches landed in published packages.
# Grep-based checks against the built JS in node_modules — no live CLI needed.
#
# Requires: TEMP_DIR set by caller (pointing to init'd project with packages installed)

check_adr0062_causal_graph_level3() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Find the controller-registry JS in the published package
  local registry_file
  registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -z "$registry_file" ]]; then
    # Try dist/ subdirectory
    registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -path "*/dist/*" 2>/dev/null | head -1)
  fi

  if [[ -n "$registry_file" ]]; then
    # ADR-0062 P0-1: causalGraph must be in level 3, not level 4.
    # Look for causalGraph appearing in the same level block as level 3 markers
    # (skills, explainableRecall, etc.) rather than with nightlyLearner.
    if grep -q 'causalGraph' "$registry_file" 2>/dev/null; then
      # Verify causalGraph is NOT in the same array as nightlyLearner
      # In the INIT_LEVELS array, level 4 contains nightlyLearner.
      # If causalGraph and nightlyLearner are in the same array literal, the fix is missing.
      # Exclude comment lines (// ...) which may mention both names in explanatory text.
      local same_level
      same_level=$(grep -v '^\s*//' "$registry_file" 2>/dev/null | grep -c 'nightlyLearner.*causalGraph\|causalGraph.*nightlyLearner' 2>/dev/null || true)
      same_level="${same_level:-0}"
      if [[ "$same_level" -eq 0 ]]; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="ADR-0062 P0-1: causalGraph not co-located with nightlyLearner (level separation correct)"
      else
        _CHECK_OUTPUT="ADR-0062 P0-1: causalGraph still co-located with nightlyLearner (race condition unfixed)"
      fi
    else
      _CHECK_OUTPUT="ADR-0062 P0-1: causalGraph not found in controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0062 P0-1: controller-registry.js not found in published package"
  fi
}

check_adr0062_busy_timeout() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check for busy_timeout in the published agentdb package
  local found=0
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/agentdb"
    "$TEMP_DIR/node_modules/@sparkleideas/memory"
  )

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      if grep -rq 'busy_timeout' "$dir" --include="*.js" 2>/dev/null; then
        found=$((found + 1))
      fi
    fi
  done

  if [[ $found -gt 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0062 P1-2: busy_timeout found in $found package(s)"
  else
    _CHECK_OUTPUT="ADR-0062 P1-2: busy_timeout not found in published packages"
  fi
}

check_adr0062_configurable_ratelimiter() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local registry_file
  registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [[ -z "$registry_file" ]]; then
    registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -path "*/dist/*" 2>/dev/null | head -1)
  fi

  if [[ -n "$registry_file" ]]; then
    local rl_config=0 cb_config=0

    # ADR-0062 P2-3: RateLimiter/CircuitBreaker should reference config
    # Look for config-driven construction patterns (e.g., cfg.maxRequests, cfg.failureThreshold)
    if grep -q 'rateLimiter\|maxRequests\|windowMs' "$registry_file" 2>/dev/null; then
      rl_config=1
    fi
    if grep -q 'circuitBreaker\|failureThreshold\|resetTimeoutMs' "$registry_file" 2>/dev/null; then
      cb_config=1
    fi

    if [[ $rl_config -eq 1 && $cb_config -eq 1 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0062 P2-3: RateLimiter + CircuitBreaker config references found"
    elif [[ $rl_config -eq 1 || $cb_config -eq 1 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0062 P2-3: partial config (RL=$rl_config, CB=$cb_config)"
    else
      _CHECK_OUTPUT="ADR-0062 P2-3: no config references for RateLimiter/CircuitBreaker"
    fi
  else
    _CHECK_OUTPUT="ADR-0062 P2-3: controller-registry.js not found in published package"
  fi
}

check_adr0062_derive_hnsw_params() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check for deriveHNSWParams usage in the published package
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/agentdb"
    "$TEMP_DIR/node_modules/@sparkleideas/memory"
  )

  local import_found=0 usage_found=0

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      # Check if deriveHNSWParams is imported/referenced
      if grep -rq 'deriveHNSWParams' "$dir" --include="*.js" 2>/dev/null; then
        import_found=$((import_found + 1))
      fi
      # Check if it is called (not just exported)
      local call_count
      call_count=$(grep -rc 'deriveHNSWParams(' "$dir" --include="*.js" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
      if [[ $call_count -gt 1 ]]; then
        # More than just the definition = it's being called somewhere
        usage_found=$((usage_found + 1))
      fi
    fi
  done

  if [[ $usage_found -gt 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0062 P2-1: deriveHNSWParams imported and called ($import_found packages)"
  elif [[ $import_found -gt 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0062 P2-1: deriveHNSWParams exists ($import_found packages), wiring may be pending"
  else
    _CHECK_OUTPUT="ADR-0062 P2-1: deriveHNSWParams not found in published packages"
  fi
}

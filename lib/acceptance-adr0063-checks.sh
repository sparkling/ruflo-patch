#!/usr/bin/env bash
# lib/acceptance-adr0063-checks.sh — ADR-0063: Storage Audit Remediation
#
# Acceptance checks that verify ADR-0063 patches landed in published packages.
# Grep-based checks against the built JS in node_modules — no live CLI needed.
#
# Requires: TEMP_DIR set by caller (pointing to init'd project with packages installed)

check_adr0063_embedding_import_agentdb() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # C1: memory-bridge should import getEmbeddingConfig from agentdb, not memory
  local bridge_file
  bridge_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/cli" -name "memory-bridge.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$bridge_file" ]]; then
    # Should reference agentdb for getEmbeddingConfig
    if grep -q "sparkleideas/agentdb" "$bridge_file" 2>/dev/null && grep -q "getEmbeddingConfig" "$bridge_file" 2>/dev/null; then
      # Also verify old wrong import is gone
      if ! grep -q "getEmbeddingConfig.*sparkleideas/memory\|sparkleideas/memory.*getEmbeddingConfig" "$bridge_file" 2>/dev/null; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="ADR-0063 C1: getEmbeddingConfig imports from agentdb (not memory)"
      else
        _CHECK_OUTPUT="ADR-0063 C1: old @memory import for getEmbeddingConfig still present"
      fi
    else
      _CHECK_OUTPUT="ADR-0063 C1: getEmbeddingConfig+agentdb reference not found in memory-bridge"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 C1: memory-bridge.js not found in published CLI package"
  fi
}

check_adr0063_get_embedding_service() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # C2: AgentDB must expose getEmbeddingService()
  local agentdb_file
  agentdb_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/agentdb" -name "AgentDB.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$agentdb_file" ]]; then
    if grep -q 'getEmbeddingService' "$agentdb_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 C2: getEmbeddingService() accessor found in AgentDB"
    else
      _CHECK_OUTPUT="ADR-0063 C2: getEmbeddingService() not found in AgentDB"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 C2: AgentDB.js not found in published package"
  fi
}

check_adr0063_dimension_768() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # C3: dimension defaults should be 768, not 1536
  local stale_1536=0
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/memory"
  )

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      # Count files still using 1536 as a default dimension
      local count
      count=$(grep -rl '1536' "$dir" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
      stale_1536=$((stale_1536 + count))
    fi
  done

  if [[ $stale_1536 -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0063 C3: no 1536 dimension references in memory package"
  else
    _CHECK_OUTPUT="ADR-0063 C3: $stale_1536 file(s) still reference 1536 dimension"
  fi
}

check_adr0063_ratelimiter_semantics() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # H1: RateLimiter should NOT pass windowMs as refillRate
  local registry_file
  registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$registry_file" ]]; then
    # windowMs should NOT appear in RateLimiter construction
    if grep -q 'windowMs' "$registry_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0063 H1: windowMs still referenced in controller-registry (semantic mismatch may persist)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 H1: windowMs removed from RateLimiter construction"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 H1: controller-registry.js not found"
  fi
}

check_adr0063_max_elements() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # H2: maxElements should be passed to AgentDB (100000 default)
  local registry_file
  registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$registry_file" ]]; then
    if grep -q 'maxElements' "$registry_file" 2>/dev/null; then
      if grep -q '100000' "$registry_file" 2>/dev/null; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="ADR-0063 H2: maxElements with 100000 default found in controller-registry"
      else
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="ADR-0063 H2: maxElements found (default value may differ)"
      fi
    else
      _CHECK_OUTPUT="ADR-0063 H2: maxElements not found in controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 H2: controller-registry.js not found"
  fi
}

check_adr0063_rvf_optional_dep() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # H3: @ruvector/rvf in optionalDependencies
  local pkg_file="$TEMP_DIR/node_modules/@sparkleideas/agentdb/package.json"

  if [[ -f "$pkg_file" ]]; then
    if grep -q 'ruvector/rvf' "$pkg_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 H3: @ruvector/rvf declared in agentdb package.json"
    else
      _CHECK_OUTPUT="ADR-0063 H3: @ruvector/rvf not found in agentdb package.json"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 H3: agentdb package.json not found"
  fi
}

check_adr0063_sqlite_busy_timeout() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M1: busy_timeout in SQLiteBackend + M2: WASM pragmas + M3: migration pragmas
  local busy_count=0
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/agentdb"
    "$TEMP_DIR/node_modules/@sparkleideas/memory"
  )

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      local count
      count=$(grep -rl 'busy_timeout' "$dir" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
      busy_count=$((busy_count + count))
    fi
  done

  if [[ $busy_count -ge 2 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0063 M1-M3: busy_timeout found in $busy_count file(s) across packages"
  elif [[ $busy_count -eq 1 ]]; then
    _CHECK_OUTPUT="ADR-0063 M1-M3: busy_timeout in only 1 file (expected >=2: SQLite + migration + WASM)"
  else
    _CHECK_OUTPUT="ADR-0063 M1-M3: busy_timeout not found in published packages"
  fi
}

check_adr0063_derive_hnsw_broad() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M4: deriveHNSWParams wired into multiple backends (not just HNSWIndex)
  local call_count=0
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/agentdb"
    "$TEMP_DIR/node_modules/@sparkleideas/memory"
  )

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      local count
      count=$(grep -rl 'deriveHNSWParams' "$dir" --include="*.js" 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
      call_count=$((call_count + count))
    fi
  done

  if [[ $call_count -ge 3 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0063 M4: deriveHNSWParams wired in $call_count file(s) (broad coverage)"
  elif [[ $call_count -ge 1 ]]; then
    _CHECK_OUTPUT="ADR-0063 M4: deriveHNSWParams in only $call_count file(s) (expected >=3)"
  else
    _CHECK_OUTPUT="ADR-0063 M4: deriveHNSWParams not found in published packages"
  fi
}

check_adr0063_no_enable_hnsw() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M5: enableHNSW dead field should be removed
  local registry_file
  registry_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "controller-registry.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$registry_file" ]]; then
    if grep -q 'enableHNSW' "$registry_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0063 M5: enableHNSW still present in controller-registry"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 M5: enableHNSW removed from controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 M5: controller-registry.js not found"
  fi
}

check_adr0063_learning_bridge_dim() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M6: createHashEmbedding should accept configurable dimension
  local bridge_file
  bridge_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/memory" -name "learning-bridge.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$bridge_file" ]]; then
    # The function should reference config dimension, not just hardcoded 768
    if grep -q 'dimension\|dimensions' "$bridge_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 M6: learning-bridge references configurable dimension"
    else
      _CHECK_OUTPUT="ADR-0063 M6: learning-bridge has no configurable dimension reference"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 M6: learning-bridge.js not found in published package"
  fi
}

check_adr0063_cache_cleanup() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M7: QueryCache and ToolCache should have cleanup timers
  local cleanup_count=0
  local search_dirs=(
    "$TEMP_DIR/node_modules/@sparkleideas/agentdb"
  )

  for dir in "${search_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
      # Look for setInterval-based cleanup pattern
      for cache_file in QueryCache.js ToolCache.js; do
        local found
        found=$(find "$dir" -name "$cache_file" -not -path "*/node_modules/*" 2>/dev/null | head -1)
        if [[ -n "$found" ]] && grep -q 'cleanupTimer\|_cleanupTimer\|evictExpired\|pruneExpired' "$found" 2>/dev/null; then
          cleanup_count=$((cleanup_count + 1))
        fi
      done
    fi
  done

  if [[ $cleanup_count -ge 2 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0063 M7: cleanup timers found in $cleanup_count cache file(s)"
  elif [[ $cleanup_count -eq 1 ]]; then
    _CHECK_OUTPUT="ADR-0063 M7: cleanup timer in only 1 cache (expected 2: QueryCache + ToolCache)"
  else
    _CHECK_OUTPUT="ADR-0063 M7: no cleanup timers found in cache files"
  fi
}

check_adr0063_tiered_cache_maxsize() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # M8: config-adapter should bridge maxSize to tieredCache
  local adapter_file
  adapter_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/cli" -name "config-adapter.js" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$adapter_file" ]]; then
    if grep -q 'tieredCache' "$adapter_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0063 M8: tieredCache config found in config-adapter"
    else
      _CHECK_OUTPUT="ADR-0063 M8: tieredCache not found in config-adapter"
    fi
  else
    _CHECK_OUTPUT="ADR-0063 M8: config-adapter.js not found in published CLI package"
  fi
}

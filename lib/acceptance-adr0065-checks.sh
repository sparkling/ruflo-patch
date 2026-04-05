#!/usr/bin/env bash
# lib/acceptance-adr0065-checks.sh — ADR-0065 Config Centralization acceptance checks
#
# Requires: _find_pkg_js from acceptance-checks.sh
# Caller MUST set: TEMP_DIR

check_adr0065_no_384_memory_bridge() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local bridge_file
  bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "memory-bridge.js")

  if [[ -n "$bridge_file" ]]; then
    if grep -q '|| 384\|?? 384' "$bridge_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P0: hardcoded 384 fallback still present in memory-bridge"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P0: no 384 fallbacks in memory-bridge"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P0: memory-bridge.js not found in published package"
  fi
}

check_adr0065_no_384_config_adapter() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local adapter_file
  adapter_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "config-adapter.js")

  if [[ -n "$adapter_file" ]]; then
    if grep -q '?? 384' "$adapter_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P0: hardcoded 384 fallback still present in config-adapter"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P0: no 384 fallbacks in config-adapter"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P0: config-adapter.js not found in published package"
  fi
}

check_adr0065_no_minilm_memory_bridge() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local bridge_file
  bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "memory-bridge.js")

  if [[ -n "$bridge_file" ]]; then
    if grep -q "all-MiniLM-L6-v2" "$bridge_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P0: hardcoded MiniLM model still present in memory-bridge"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P0: no hardcoded MiniLM model in memory-bridge"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P0: memory-bridge.js not found in published package"
  fi
}

check_adr0065_config_wiring() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local bridge_file
  bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "memory-bridge.js")

  if [[ -n "$bridge_file" ]]; then
    if grep -q 'getProjectConfig\|findProjectRoot' "$bridge_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P0: config wiring helpers found in memory-bridge"
    else
      _CHECK_OUTPUT="ADR-0065 P0: config wiring helpers missing from memory-bridge"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P0: memory-bridge.js not found in published package"
  fi
}

check_adr0065_qvs_reads_config() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    # Check that quantizedVectorStore case reads from this.config
    if grep -A5 'quantizedVectorStore' "$registry_file" | grep -q 'this\.config\|config\.quantized' 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P2: quantizedVectorStore reads type from config"
    else
      _CHECK_OUTPUT="ADR-0065 P2: quantizedVectorStore does not read from config"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P2: controller-registry.js not found"
  fi
}

check_adr0065_ratelimiter_windowms() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    if grep -q 'windowMs' "$registry_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P2: rateLimiter uses windowMs"
    else
      _CHECK_OUTPUT="ADR-0065 P2: rateLimiter does not reference windowMs"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P2: controller-registry.js not found"
  fi
}

check_adr0065_no_require_esm() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dbprov_file
  dbprov_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "database-provider.js")

  if [[ -n "$dbprov_file" ]]; then
    if grep -q 'require(' "$dbprov_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P2: require() still present in database-provider (ESM context)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P2: no require() in database-provider"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P2: database-provider.js not found"
  fi
}

check_adr0065_no_sqljs_backend() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check that index.js does not export SqlJsBackend (the authoritative test).
  # Stale .js artifacts may linger in dist/ from prior builds, so checking
  # file existence alone is unreliable.
  local index_file
  index_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "index.js")

  if [[ -n "$index_file" ]]; then
    if grep -q 'SqlJsBackend\|sqljs-backend' "$index_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P3-1: SqlJsBackend still exported from index.js"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P3-1: SqlJsBackend not exported from index.js"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P3-1: index.js not found in memory package"
  fi
}

check_adr0065_no_json_backend() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dbprov_file
  dbprov_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "database-provider.js")

  if [[ -n "$dbprov_file" ]]; then
    if grep -q 'JsonBackend' "$dbprov_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0065 P3-1: JsonBackend still present in database-provider"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P3-1: JsonBackend removed from database-provider"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P3-1: database-provider.js not found"
  fi
}

check_adr0065_shared_schema() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local schema_file
  schema_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "memory-schema.js")

  if [[ -n "$schema_file" ]]; then
    if grep -q 'MEMORY_ENTRIES_DDL' "$schema_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P3-2: shared memory-schema.js found with MEMORY_ENTRIES_DDL"
    else
      _CHECK_OUTPUT="ADR-0065 P3-2: memory-schema.js missing MEMORY_ENTRIES_DDL"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P3-2: memory-schema.js not found in published package"
  fi
}

check_adr0065_shared_hnsw_utils() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local utils_file
  utils_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "hnsw-utils.js")

  if [[ -n "$utils_file" ]]; then
    if grep -q 'deriveHNSWParams' "$utils_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P3-3: shared hnsw-utils.js found with deriveHNSWParams"
    else
      _CHECK_OUTPUT="ADR-0065 P3-3: hnsw-utils.js missing deriveHNSWParams"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P3-3: hnsw-utils.js not found in published package"
  fi
}

check_adr0065_embeddings_model_name() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local bridge_file
  bridge_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "memory-bridge.js")

  if [[ -n "$bridge_file" ]]; then
    if grep -q 'getEmbeddingModelName\|all-mpnet-base-v2' "$bridge_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0065 P0: embedding model reads from config (mpnet fallback)"
    else
      _CHECK_OUTPUT="ADR-0065 P0: embedding model not reading from config"
    fi
  else
    _CHECK_OUTPUT="ADR-0065 P0: memory-bridge.js not found"
  fi
}

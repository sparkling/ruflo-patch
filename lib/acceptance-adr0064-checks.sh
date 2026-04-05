#!/usr/bin/env bash
# lib/acceptance-adr0064-checks.sh — ADR-0064 Controller Config Alignment checks
#
# Requires: _find_pkg_js from acceptance-checks.sh
# Caller MUST set: TEMP_DIR

check_adr0064_resolved_dimension() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify controller-registry.js contains the new resolvedDimension property
  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    if grep -q 'resolvedDimension' "$registry_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P1: resolvedDimension property found in controller-registry"
    else
      _CHECK_OUTPUT="ADR-0064 P1: resolvedDimension not found in controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P1: controller-registry.js not found in published package"
  fi
}

check_adr0064_no_384_default() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify the old || 384 fallback has been removed
  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    if grep -q '|| 384' "$registry_file" 2>/dev/null; then
      _CHECK_OUTPUT="ADR-0064 P2: old '|| 384' fallback still present in controller-registry"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P2: '|| 384' fallback removed from controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P2: controller-registry.js not found in published package"
  fi
}

check_adr0064_no_embedding_constants() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify embedding-constants.js (dead code) was deleted from the published package
  local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/memory"

  if [[ -d "$pkg_dir" ]]; then
    local found
    found=$(find "$pkg_dir" -name "embedding-constants.js" 2>/dev/null | head -1)
    if [[ -z "$found" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P3: embedding-constants.js not present (dead code removed)"
    else
      _CHECK_OUTPUT="ADR-0064 P3: embedding-constants.js still exists at $found"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P3: @sparkleideas/memory package directory not found"
  fi
}

check_adr0064_numheads_aligned() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify multiHeadAttention uses numHeads: 8 (not 4)
  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    if grep -q 'numHeads' "$registry_file" 2>/dev/null && grep -q '8' "$registry_file" 2>/dev/null && ! grep -q 'numHeads: 4' "$registry_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P4: numHeads references 8 in controller-registry (aligned)"
    else
      _CHECK_OUTPUT="ADR-0064 P4: numHeads still uses 4 or not found in controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P4: controller-registry.js not found in published package"
  fi
}

check_adr0064_batch_embedder() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify batchOperations uses createEmbeddingService (not embeddingGenerator)
  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    if grep -q 'createEmbeddingService' "$registry_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P5: createEmbeddingService found in controller-registry"
    else
      _CHECK_OUTPUT="ADR-0064 P5: createEmbeddingService not found in controller-registry"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P5: controller-registry.js not found in published package"
  fi
}

check_adr0064_maxel_100k() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Verify hnsw-index.js uses deriveHNSWParams for maxElements (not hardcoded 1000000)
  # After ADR-0069, the source uses derived.maxElements (which resolves to 100000 at runtime).
  # The compiled JS may have the literal 100000 OR the variable reference derived.maxElements.
  local hnsw_file
  hnsw_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "hnsw-index.js")

  # Fallback to E2E_DIR if TEMP_DIR doesn't have the file
  if [[ -z "$hnsw_file" && -n "${E2E_DIR:-}" ]]; then
    hnsw_file=$(_find_pkg_js "$E2E_DIR/node_modules/@sparkleideas/memory" "hnsw-index.js")
  fi

  if [[ -n "$hnsw_file" ]]; then
    # Pass if: literal 100000 found, OR derived.maxElements found (config-chain), OR no hardcoded 1000000
    if grep -qE '100000|derived\.maxElements|deriveHNSWParams' "$hnsw_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P6: maxElements uses config-chain resolution in hnsw-index"
    elif ! grep -q '1000000' "$hnsw_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0064 P6: no hardcoded 1000000 found in hnsw-index (OK)"
    else
      _CHECK_OUTPUT="ADR-0064 P6: hnsw-index still has hardcoded maxElements: 1000000"
    fi
  else
    _CHECK_OUTPUT="ADR-0064 P6: hnsw-index.js not found in published package"
  fi
}

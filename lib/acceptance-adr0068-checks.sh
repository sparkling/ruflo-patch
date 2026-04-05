#!/usr/bin/env bash
# lib/acceptance-adr0068-checks.sh — ADR-0068 Controller Config Unification acceptance checks
#
# Requires: _find_pkg_js from acceptance-checks.sh
# Caller MUST set: TEMP_DIR

check_adr0068_no_384_fallbacks() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local found_384=0
  local pkgs=("cli" "memory" "shared" "hooks" "embeddings")

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    if [[ -d "$pkg_dir" ]]; then
      if grep -r '|| 384\|?? 384' "$pkg_dir" --include='*.js' 2>/dev/null | grep -v node_modules | head -3; then
        found_384=1
      fi
    fi
  done

  if [[ "$found_384" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0068 P0: no 384 fallbacks in any published package"
  else
    _CHECK_OUTPUT="ADR-0068 P0: hardcoded 384 fallback(s) found in published packages"
  fi
}

check_adr0068_no_minilm() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local found_minilm=0
  local pkgs=("cli" "memory" "shared" "hooks" "embeddings")

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    if [[ -d "$pkg_dir" ]]; then
      if grep -r 'MiniLM\|all-MiniLM-L6-v2' "$pkg_dir" --include='*.js' 2>/dev/null | grep -v node_modules | head -3; then
        found_minilm=1
      fi
    fi
  done

  if [[ "$found_minilm" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0068 P0: no MiniLM references in any published package"
  else
    _CHECK_OUTPUT="ADR-0068 P0: MiniLM reference(s) found in published packages"
  fi
}

check_adr0068_no_direct_construction() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local registry_file
  registry_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/memory" "controller-registry.js")

  if [[ -n "$registry_file" ]]; then
    local direct_ctors=0
    # Check for direct constructions that should now be delegated to getController
    if grep -q 'new ReasoningBank(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi
    if grep -q 'new CausalRecall(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi
    if grep -q 'new NightlyLearner(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi
    if grep -q 'new QueryOptimizer(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi
    if grep -q 'new AuditLogger(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi
    if grep -q 'new BatchOperations(' "$registry_file" 2>/dev/null; then
      direct_ctors=1
    fi

    if [[ "$direct_ctors" -eq 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0068 P1: no direct construction in controller-registry (uses getController)"
    else
      _CHECK_OUTPUT="ADR-0068 P1: direct construction found in controller-registry (should use getController)"
    fi
  else
    _CHECK_OUTPUT="ADR-0068 P1: controller-registry.js not found in published memory package"
  fi
}

check_adr0068_hnsw_config() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local emb_file
  emb_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/cli" -name "embeddings.json" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$emb_file" ]]; then
    local has_m has_efc has_efs
    has_m=$(grep -c '"m"' "$emb_file" 2>/dev/null || echo 0)
    has_efc=$(grep -c '"efConstruction"' "$emb_file" 2>/dev/null || echo 0)
    has_efs=$(grep -c '"efSearch"' "$emb_file" 2>/dev/null || echo 0)

    if [[ "$has_m" -gt 0 && "$has_efc" -gt 0 && "$has_efs" -gt 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0068 P1: HNSW config (m, efConstruction, efSearch) found in embeddings.json"
    else
      _CHECK_OUTPUT="ADR-0068 P1: HNSW config missing fields in embeddings.json (m=$has_m efC=$has_efc efS=$has_efs)"
    fi
  else
    _CHECK_OUTPUT="ADR-0068 P1: embeddings.json not found in published cli package"
  fi
}

check_adr0068_controllers_enabled() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check config.json in the published package or init template
  local cfg_file
  cfg_file=$(find "$TEMP_DIR/node_modules/@sparkleideas/cli" -name "config.json" -not -path "*/node_modules/*" 2>/dev/null | head -1)

  if [[ -n "$cfg_file" ]]; then
    local has_controllers has_enabled
    has_controllers=$(grep -c '"controllers"' "$cfg_file" 2>/dev/null || echo 0)
    has_enabled=$(grep -c '"enabled"' "$cfg_file" 2>/dev/null || echo 0)

    if [[ "$has_controllers" -gt 0 && "$has_enabled" -gt 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0068 P1: controllers.enabled section found in config.json"
    else
      _CHECK_OUTPUT="ADR-0068 P1: controllers.enabled missing from config.json (controllers=$has_controllers enabled=$has_enabled)"
    fi
  else
    _CHECK_OUTPUT="ADR-0068 P1: config.json not found in published cli package"
  fi
}

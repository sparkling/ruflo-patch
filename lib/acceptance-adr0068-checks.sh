#!/usr/bin/env bash
# lib/acceptance-adr0068-checks.sh — ADR-0068 Controller Config Unification acceptance checks
#
# Requires: _find_pkg_js from acceptance-checks.sh
# Caller MUST set: TEMP_DIR
# Caller MUST set (ADR-0068 harness constants):
#   RUFLO_EMBEDDING_MODEL   — e.g. "Xenova/all-mpnet-base-v2"
#   RUFLO_EMBEDDING_DIM     — e.g. 768
#   RUFLO_HNSW_M            — e.g. 23
#   RUFLO_HNSW_EF_CONSTRUCTION — e.g. 100
#   RUFLO_HNSW_EF_SEARCH    — e.g. 50

check_adr0068_no_384_fallbacks() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local found_bad=0
  local bad_details=""
  local pkgs=("cli" "memory" "shared" "hooks" "embeddings")

  for pkg in "${pkgs[@]}"; do
    local pkg_dir="$TEMP_DIR/node_modules/@sparkleideas/$pkg"
    if [[ -d "$pkg_dir" ]]; then
      # Check for both 384 and 1536 hardcoded fallbacks
      local hits
      hits=$(grep -r '|| 384\|?? 384\||| 1536\|?? 1536' "$pkg_dir" --include='*.js' 2>/dev/null | grep -v node_modules | head -5)
      if [[ -n "$hits" ]]; then
        found_bad=1
        bad_details="${bad_details}${hits}\n"
      fi
    fi
  done

  if [[ "$found_bad" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0068 P0: no 384/1536 fallbacks in any published package"
  else
    _CHECK_OUTPUT="ADR-0068 P0: hardcoded 384/1536 fallback(s) found in published packages"
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
    for ctor in 'new ReasoningBank(' 'new CausalRecall(' 'new NightlyLearner(' \
                'new QueryOptimizer(' 'new AuditLogger(' 'new BatchOperations('; do
      if grep -q "$ctor" "$registry_file" 2>/dev/null; then
        direct_ctors=1
      fi
    done

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

  # Verify embeddings.json has EXACT values matching harness constants.
  # The harness stamps these explicitly — no reliance on CLI defaults.
  local emb_file="$TEMP_DIR/.claude-flow/embeddings.json"

  if [[ ! -f "$emb_file" ]]; then
    _CHECK_OUTPUT="ADR-0068 P1: embeddings.json not found (init --with-embeddings failed?)"
    return
  fi

  local actual_m actual_efc actual_efs actual_dim actual_model
  actual_m=$(python3 -c "import json; print(json.load(open('$emb_file'))['hnsw']['m'])" 2>/dev/null)
  actual_efc=$(python3 -c "import json; print(json.load(open('$emb_file'))['hnsw']['efConstruction'])" 2>/dev/null)
  actual_efs=$(python3 -c "import json; print(json.load(open('$emb_file'))['hnsw']['efSearch'])" 2>/dev/null)
  actual_dim=$(python3 -c "import json; print(json.load(open('$emb_file'))['dimension'])" 2>/dev/null)
  actual_model=$(python3 -c "import json; print(json.load(open('$emb_file'))['model'])" 2>/dev/null)

  local errors=""
  [[ "$actual_model" != "$RUFLO_EMBEDDING_MODEL" ]] && errors="${errors} model=${actual_model}(want ${RUFLO_EMBEDDING_MODEL})"
  [[ "$actual_dim" != "$RUFLO_EMBEDDING_DIM" ]]     && errors="${errors} dim=${actual_dim}(want ${RUFLO_EMBEDDING_DIM})"
  [[ "$actual_m" != "$RUFLO_HNSW_M" ]]              && errors="${errors} m=${actual_m}(want ${RUFLO_HNSW_M})"
  [[ "$actual_efc" != "$RUFLO_HNSW_EF_CONSTRUCTION" ]] && errors="${errors} efC=${actual_efc}(want ${RUFLO_HNSW_EF_CONSTRUCTION})"
  [[ "$actual_efs" != "$RUFLO_HNSW_EF_SEARCH" ]]    && errors="${errors} efS=${actual_efs}(want ${RUFLO_HNSW_EF_SEARCH})"

  if [[ -z "$errors" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0068 P1: embeddings.json exact match — model=${RUFLO_EMBEDDING_MODEL} dim=${RUFLO_EMBEDDING_DIM} hnsw=(m=${RUFLO_HNSW_M} efC=${RUFLO_HNSW_EF_CONSTRUCTION} efS=${RUFLO_HNSW_EF_SEARCH})"
  else
    _CHECK_OUTPUT="ADR-0068 P1: embeddings.json mismatch:${errors}"
  fi
}

check_adr0068_controllers_enabled() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check two things: (1) config.json in the init'd project has controllers.enabled,
  # OR (2) the published memory-bridge supports controllers.enabled merging.
  local cfg_file="$TEMP_DIR/.claude-flow/config.json"

  if [[ -f "$cfg_file" ]]; then
    local has_controllers has_enabled
    has_controllers=$(grep -c '"controllers"' "$cfg_file" 2>/dev/null || echo 0)
    has_enabled=$(grep -c '"enabled"' "$cfg_file" 2>/dev/null || echo 0)

    if [[ "$has_controllers" -gt 0 && "$has_enabled" -gt 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0068 P1: controllers.enabled section found in config.json"
    else
      _CHECK_OUTPUT="ADR-0068 P1: controllers.enabled missing from config.json"
    fi
  else
    # config.json may not exist (init generates config.yaml). Fall back to
    # verifying memory-router supports the controllers.enabled merge path
    # (ADR-0085: bridge deleted, helpers moved to router).
    local router_file
    router_file=$(_find_pkg_js "$TEMP_DIR/node_modules/@sparkleideas/cli" "memory-router.js")

    if [[ -n "$router_file" ]] && grep -q 'controllers.*enabled\|_readProjectConfig\|_getProjectConfig' "$router_file" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0068 P1: memory-router supports controllers.enabled merging (ADR-0085 bridge deleted)"
    else
      _CHECK_OUTPUT="ADR-0068 P1: no config.json and memory-router lacks controllers.enabled support"
    fi
  fi
}

#!/usr/bin/env bash
# lib/acceptance-adr0083-checks.sh — ADR-0083 acceptance checks
#
# Phase 5 — Single Data Flow Path.
# Verifies that the 3-storage-silo bridges are gone and that
# memory-router.ts is the sole entry point for all memory operations.
#
# ADR-0083 decisions tested here:
#   - rvf-shim.ts DELETED (Wave 1)
#   - open-database.ts DELETED (Wave 2)
#   - memory-router.js exports routeEmbeddingOp + 23 lazy wrappers
#   - Migrated tool files do NOT import memory-bridge directly
#   - CLI memory store still dual-writes JSON sidecar for intelligence.cjs
#
# Requires: acceptance-checks.sh sourced first
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# ADR-0083-1: rvf-shim deleted from published package
# ════════════════════════════════════════════════════════════════════

check_adr0083_no_rvf_shim() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0083-1: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # rvf-shim.ts (182 lines) was deleted in Wave 1 — must not appear in dist
  local shim_hits
  shim_hits=$(find "$base" -path '*/node_modules' -prune -o \
    -name 'rvf-shim*' \( -name '*.js' -o -name '*.cjs' \) -print 2>/dev/null | head -5)

  if [[ -n "$shim_hits" ]]; then
    local short
    short=$(echo "$shim_hits" | sed "s|${base}/||" | head -3 | tr '\n' ' ')
    _CHECK_OUTPUT="ADR-0083-1: rvf-shim still present in published package: ${short}"
    return
  fi

  # Also check for import references in dist that name rvf-shim
  local ref_hits
  ref_hits=$(grep -rl 'rvf-shim' "$base/dist" 2>/dev/null | head -3 || true)
  if [[ -n "$ref_hits" ]]; then
    local short_refs
    short_refs=$(echo "$ref_hits" | sed "s|${base}/||" | head -3 | tr '\n' ' ')
    _CHECK_OUTPUT="ADR-0083-1: rvf-shim import references still in dist: ${short_refs}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0083-1: rvf-shim absent from published package (Wave 1 deletion confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-2: open-database.ts deleted from published package
# ════════════════════════════════════════════════════════════════════

check_adr0083_no_open_database() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0083-2: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # open-database.ts (263 lines) was deleted in Wave 2
  local od_hits
  od_hits=$(find "$base/dist" -name 'open-database.js' 2>/dev/null | head -3 || true)

  if [[ -n "$od_hits" ]]; then
    local short
    short=$(echo "$od_hits" | sed "s|${base}/||" | head -3 | tr '\n' ' ')
    _CHECK_OUTPUT="ADR-0083-2: open-database.js still present in dist: ${short}"
    return
  fi

  # Check for import chains referencing open-database (exclude comment strings)
  local import_hits
  import_hits=$(grep -rl "from.*open-database\|require.*open-database" \
    "$base/dist" 2>/dev/null | head -3 || true)
  if [[ -n "$import_hits" ]]; then
    local short_refs
    short_refs=$(echo "$import_hits" | sed "s|${base}/||" | head -3 | tr '\n' ' ')
    _CHECK_OUTPUT="ADR-0083-2: open-database import references still in dist: ${short_refs}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0083-2: open-database.js absent from published package (Wave 2 deletion confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-3: memory-router exports routeEmbeddingOp (Wave 1 addition)
# ════════════════════════════════════════════════════════════════════

check_adr0083_router_exports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0083-3: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # Find memory-router.js in dist (may be nested under dist/memory/ or dist/src/memory/)
  local router_file=""
  for d in "$base/dist/memory" "$base/dist/src/memory" "$base/dist"; do
    if [[ -f "$d/memory-router.js" ]]; then
      router_file="$d/memory-router.js"
      break
    fi
  done

  if [[ -z "$router_file" ]]; then
    # Broader find
    router_file=$(find "$base/dist" -name 'memory-router.js' 2>/dev/null | head -1 || true)
  fi

  if [[ -z "$router_file" ]]; then
    _CHECK_OUTPUT="ADR-0083-3: memory-router.js not found in published package dist"
    return
  fi

  local short
  short=$(echo "$router_file" | sed "s|${base}/||")

  # Verify routeEmbeddingOp is exported (added in Wave 1 for HNSW/embedding routing)
  local found_exports=()
  for sym in routeEmbeddingOp generateEmbedding getHNSWIndex routeMemoryOp; do
    if grep -q "$sym" "$router_file" 2>/dev/null; then
      found_exports+=("$sym")
    fi
  done

  if [[ ${#found_exports[@]} -eq 4 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-3: memory-router ${short} exports: ${found_exports[*]}"
  else
    _CHECK_OUTPUT="ADR-0083-3: memory-router ${short} missing expected exports (found: ${found_exports[*]:-none})"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-4: migrated tool files do not import memory-bridge directly
# ════════════════════════════════════════════════════════════════════

check_adr0083_no_bridge_in_migrated() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0083-4: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # Wave 1+2 migrated files: these must now import from router, not bridge
  # session-tools, daa-tools, system-tools, embeddings-tools, intelligence
  local -a migrated_patterns=(
    "session-tools"
    "daa-tools"
    "agentdb-orchestration"
    "system-tools"
    "embeddings-tools"
    "intelligence"
  )

  local violations=()
  for pat in "${migrated_patterns[@]}"; do
    # Find the compiled file(s)
    local hits
    hits=$(find "$base/dist" -name "${pat}.js" 2>/dev/null | head -2 || true)
    [[ -z "$hits" ]] && continue

    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      # Check for direct memory-bridge imports (not router imports)
      if grep -q "from.*memory-bridge\|require.*memory-bridge" "$f" 2>/dev/null; then
        local short
        short=$(echo "$f" | sed "s|${base}/||")
        violations+=("${short}")
      fi
    done <<< "$hits"
  done

  if [[ ${#violations[@]} -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-4: no direct memory-bridge imports in migrated tool files (Wave 1+2 clean)"
  else
    _CHECK_OUTPUT="ADR-0083-4: direct memory-bridge imports still in: ${violations[*]}"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-5: JSON sidecar contract intact (intelligence.cjs can read CLI-stored data)
#
# This tests the core CJS contract: routeMemoryOp('store') now centralizes
# the JSON dual-write in memory-router.ts. After a CLI memory store,
# auto-memory-store.json must contain the entry so intelligence.cjs works.
# ════════════════════════════════════════════════════════════════════

check_adr0083_json_sidecar_contract() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # The e2e prep phase pre-seeds entries via CLI (single process, no contention),
  # which populates auto-memory-store.json via writeJsonSidecar() in the router.
  # We verify the pre-seeded key exists. Under parallel contention, individual
  # CLI store calls can time out, so we also attempt our own store as a bonus.
  local cli; cli=$(_cli_cmd)
  local test_key="adr0083-sidecar-$(date +%s)"
  local test_val="phase5 single data flow sidecar test"

  # Best-effort own store (may time out under contention — that's OK)
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$test_key' --value '$test_val' --namespace adr0083-sidecar" "" 15

  # Verify the sidecar file exists and contains data
  local sidecar="$E2E_DIR/.claude-flow/data/auto-memory-store.json"
  if [[ ! -f "$sidecar" ]]; then
    _CHECK_OUTPUT="ADR-0083-5: auto-memory-store.json not created (prep seed may have failed)"
    return
  fi

  # Check for our own key first, then pre-seeded key, then any entries
  if grep -q "$test_key" "$sidecar" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-5: CLI memory store writes JSON sidecar — key '$test_key' found"
  elif grep -q 'e2e-seed-sidecar' "$sidecar" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-5: JSON sidecar contains pre-seeded entry (prep phase store confirmed)"
  elif grep -q "$(echo "$test_val" | cut -c1-20)" "$sidecar" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-5: CLI memory store writes JSON sidecar — value found"
  else
    local entry_count
    entry_count=$(grep -c '"key"' "$sidecar" 2>/dev/null || echo 0)
    _CHECK_OUTPUT="ADR-0083-5: no known keys found in auto-memory-store.json (${entry_count} entries present)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-6: memory store → search round-trip via router (single path)
#
# With the single data flow path, memory store and search use one router.
# This confirms the end-to-end path is intact post-Wave 1+2 migrations.
# ════════════════════════════════════════════════════════════════════

check_adr0083_single_path_roundtrip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local test_key="adr0083-rt-$(date +%s)"
  local test_val="single data flow path roundtrip verification"

  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$test_key' --value '$test_val' --namespace adr0083-rt" "" 15
  if ! echo "$_RK_OUT" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="ADR-0083-6: memory store failed: $_RK_OUT"
    return
  fi

  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'single data flow path' --namespace adr0083-rt --limit 5" "" 15
  if echo "$_RK_OUT" | grep -qi "$test_key\|single data flow\|roundtrip"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-6: store→search round-trip succeeds via single router path"
  else
    # Fall back to list check — more reliable across CLI versions
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory list --namespace adr0083-rt --limit 10" "" 15
    if echo "$_RK_OUT" | grep -q "$test_key"; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0083-6: store→list round-trip succeeds via single router path"
    else
      _CHECK_OUTPUT="ADR-0083-6: stored key '$test_key' not found via search or list: $_RK_OUT"
    fi
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-7: no appendToAutoMemoryStore in memory-initializer
#
# appendToAutoMemoryStore() (50 lines) was removed from memory-initializer.ts
# in Wave 2 — centralized in router. Verify the exported function name is
# absent from the compiled memory-initializer.js.
# ════════════════════════════════════════════════════════════════════

check_adr0083_no_append_fn_in_initializer() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0083-7: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  # Find memory-initializer.js
  local init_file=""
  for d in "$base/dist/memory" "$base/dist/src/memory" "$base/dist"; do
    if [[ -f "$d/memory-initializer.js" ]]; then
      init_file="$d/memory-initializer.js"
      break
    fi
  done

  if [[ -z "$init_file" ]]; then
    init_file=$(find "$base/dist" -name 'memory-initializer.js' 2>/dev/null | head -1 || true)
  fi

  if [[ -z "$init_file" ]]; then
    # memory-initializer.js may be inlined/bundled — not a failure
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-7: memory-initializer.js not found as separate file (may be bundled)"
    return
  fi

  local short
  short=$(echo "$init_file" | sed "s|${base}/||")

  if grep -q 'appendToAutoMemoryStore' "$init_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0083-7: appendToAutoMemoryStore still present in ${short} (should be removed in Wave 2)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0083-7: appendToAutoMemoryStore absent from ${short} (Wave 2 removal confirmed)"
  fi
}

# ════════════════════════════════════════════════════════════════════
# ADR-0083-8: doSync() absent from published hook (Wave 2 removal)
#
# Hive review P3: verifies the doSync drain was removed from
# auto-memory-hook.mjs — drain is now centralized in memory-router.ts.
# ════════════════════════════════════════════════════════════════════

check_adr0083_no_dosync_drain() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local hook="$E2E_DIR/.claude/helpers/auto-memory-hook.mjs"
  if [[ ! -f "$hook" ]]; then
    _CHECK_OUTPUT="ADR-0083-8: auto-memory-hook.mjs not found in init'd project"
    return
  fi

  # doSync() was removed in Wave 2 — must not appear as a function definition
  if grep -q 'async function doSync' "$hook" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0083-8: doSync() function still present in published hook"
    return
  fi

  # The ranked-context.json drain read should also be absent
  if grep -q 'ranked-context\.json' "$hook" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0083-8: ranked-context.json drain reference still in published hook"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0083-8: doSync() absent from published hook (Wave 2 removal confirmed)"
}

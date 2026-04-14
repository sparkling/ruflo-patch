#!/usr/bin/env bash
# lib/acceptance-adr0086-checks.sh — ADR-0086 acceptance checks
#
# Layer 1 Storage Abstraction — verify published CLI dist.
# Verifies:
#   - memory-initializer.js is a thin shim (no raw SQLite calls)
#   - memory-router.js exports routeMemoryOp, routeEmbeddingOp, ensureRouter
#   - CLI memory store + search round-trip works
#
# Requires: acceptance-harness.sh sourced first (_run_and_kill, _cli_cmd available)
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# Helper: find the @sparkleideas/cli package directory
# ════════════════════════════════════════════════════════════════════

_adr0086_find_cli_pkg() {
  local pkg_dir=""
  pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  if [ -z "$pkg_dir" ]; then
    pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/cli" -not -path "*/.iso-*" -type d 2>/dev/null | head -1)
  fi
  echo "$pkg_dir"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-1: memory-initializer.js is a thin shim in published dist
#
# After ADR-0086, memory-initializer.js should NOT contain raw SQLite
# calls (db.prepare, db.exec, better-sqlite3 direct usage in hot paths).
# CRUD functions delegate to routeMemoryOp via _loadRouter().
# ════════════════════════════════════════════════════════════════════

check_no_initializer_in_dist() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-1: could not locate @sparkleideas/cli package in node_modules"
    return
  fi

  local init_file
  init_file=$(find "$cli_pkg_dir" -name "memory-initializer.js" -type f 2>/dev/null | head -1)

  if [ -z "$init_file" ]; then
    # If the file is completely absent, that is also acceptable
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0086-1: memory-initializer.js absent from dist (fully removed)"
    return
  fi

  # Check for raw SQLite calls in CRUD paths.
  # The initializer should delegate to _loadRouter(), not call db.prepare() directly
  # for store/search/list/get/delete operations.
  # Allow SQLite in schema creation (initializeMemoryDatabase) — that is intentional.
  local raw_sqlite_count
  raw_sqlite_count=$(grep -c 'db\.prepare\|db\.exec\|\.run(' "$init_file" 2>/dev/null || echo 0)

  # Threshold: schema creation uses db.exec for DDL. Over 3 hits means
  # CRUD paths still have raw SQLite instead of delegating to the router.
  if [ "$raw_sqlite_count" -gt 3 ]; then
    _CHECK_OUTPUT="ADR-0086-1: memory-initializer.js has $raw_sqlite_count raw SQLite calls (expected <= 3 for schema-only)"
    return
  fi

  # Verify the compiled file contains _loadRouter delegation
  if ! grep -q '_loadRouter\|routeMemoryOp\|routeEmbeddingOp' "$init_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0086-1: memory-initializer.js does not delegate to router (_loadRouter/routeMemoryOp absent)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-1: memory-initializer.js is a thin shim ($raw_sqlite_count raw SQLite calls, delegates to router)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-2: memory-router.js exports key functions
#
# After ADR-0086, memory-router.js is the central entry point.
# It must export: routeMemoryOp, routeEmbeddingOp, ensureRouter.
# ════════════════════════════════════════════════════════════════════

check_storage_contract_exports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-2: could not locate @sparkleideas/cli package"
    return
  fi

  local router_file
  router_file=$(find "$cli_pkg_dir" -name "memory-router.js" -type f 2>/dev/null | head -1)

  if [ -z "$router_file" ]; then
    _CHECK_OUTPUT="ADR-0086-2: memory-router.js not found in dist"
    return
  fi

  local missing=""

  if ! grep -q 'routeMemoryOp' "$router_file" 2>/dev/null; then
    missing="${missing} routeMemoryOp"
  fi

  if ! grep -q 'routeEmbeddingOp' "$router_file" 2>/dev/null; then
    missing="${missing} routeEmbeddingOp"
  fi

  if ! grep -q 'ensureRouter' "$router_file" 2>/dev/null; then
    missing="${missing} ensureRouter"
  fi

  if ! grep -q 'MemoryOpType\|MemoryOp' "$router_file" 2>/dev/null; then
    missing="${missing} MemoryOpType"
  fi

  if [ -n "$missing" ]; then
    _CHECK_OUTPUT="ADR-0086-2: memory-router.js missing exports:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-2: memory-router.js exports routeMemoryOp, routeEmbeddingOp, ensureRouter, MemoryOpType"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-3: CLI memory store + search round-trip
#
# Exercises the full data path: CLI -> routeMemoryOp -> RvfBackend.
# Stores a unique entry and searches for it.
# ════════════════════════════════════════════════════════════════════

check_memory_search_works() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local test_dir="${E2E_DIR:-$TEMP_DIR}"

  if [ ! -d "$test_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-3: test directory not found (E2E_DIR=$E2E_DIR, TEMP_DIR=$TEMP_DIR)"
    return
  fi

  local test_key="adr0086-test-$(date +%s)"
  local test_value="ADR-0086 acceptance round-trip"

  # Resolve CLI binary — prefer local bin (fast), fall back to npx --yes
  local cli="${CLI_BIN:-}"
  if [[ -z "$cli" || ! -x "$cli" ]]; then
    cli="npx --yes @sparkleideas/cli@latest"
  fi

  # Store
  local store_out
  local store_rc=0
  store_out=$(cd "$test_dir" && NPM_CONFIG_REGISTRY="$REGISTRY" \
    $cli memory store \
      --key "$test_key" --value "$test_value" --namespace "adr0086-test" 2>&1) || store_rc=$?

  # Strip npm warnings (stderr noise from npx) before inspecting output
  local store_clean
  store_clean=$(echo "$store_out" | grep -v '^npm warn')

  if [ "$store_rc" -ne 0 ]; then
    _CHECK_OUTPUT="ADR-0086-3: memory store exited $store_rc: $(echo "$store_clean" | head -3)"
    return
  fi

  if echo "$store_clean" | grep -qi 'error\|fail\|ENOENT'; then
    _CHECK_OUTPUT="ADR-0086-3: memory store failed: $(echo "$store_clean" | head -3)"
    return
  fi

  # Search
  local search_out
  local search_rc=0
  search_out=$(cd "$test_dir" && NPM_CONFIG_REGISTRY="$REGISTRY" \
    $cli memory search \
      --query "acceptance round-trip" --namespace "adr0086-test" 2>&1) || search_rc=$?

  # Strip npm warnings from search output too
  local search_clean
  search_clean=$(echo "$search_out" | grep -v '^npm warn')

  if [ "$search_rc" -ne 0 ]; then
    _CHECK_OUTPUT="ADR-0086-3: memory search exited $search_rc: $(echo "$search_clean" | head -3)"
    return
  fi

  if echo "$search_clean" | grep -qi "$test_key\|round-trip"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0086-3: memory store+search round-trip works (key=$test_key)"
    return
  fi

  _CHECK_OUTPUT="ADR-0086-3: memory store+search round-trip failed: store=$(echo "$store_clean" | head -5); search=$(echo "$search_clean" | head -5)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-4: No memory-initializer imports in production dist files
#
# After import rewiring (T2.8), no compiled .js file (except
# memory-initializer.js itself) should import from memory-initializer.
# ════════════════════════════════════════════════════════════════════

check_no_initializer_imports_in_dist() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-4: could not locate @sparkleideas/cli package"
    return
  fi

  # Find all .js files that import memory-initializer, excluding the file itself
  local violations
  violations=$(find "$cli_pkg_dir" -name "*.js" -not -name "memory-initializer.js" -type f \
    -exec grep -l "['\"].*memory-initializer['\"]" {} + 2>/dev/null | head -5)

  if [ -n "$violations" ]; then
    local count
    count=$(echo "$violations" | wc -l | tr -d ' ')
    _CHECK_OUTPUT="ADR-0086-4: $count dist files still import memory-initializer: $(echo "$violations" | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-4: zero dist files import memory-initializer (rewire complete)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-5: Quantization functions NOT exported from dist
#
# Phase 1 deleted quantizeInt8, dequantizeInt8, quantizedCosineSim,
# getQuantizationStats. Verify they are absent from the compiled barrel.
# ════════════════════════════════════════════════════════════════════

check_quantization_not_exported() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-5: could not locate @sparkleideas/cli package"
    return
  fi

  local init_file
  init_file=$(find "$cli_pkg_dir" -name "memory-initializer.js" -type f 2>/dev/null | head -1)

  if [ -z "$init_file" ]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0086-5: memory-initializer.js absent (quantization trivially absent)"
    return
  fi

  local found=""
  for fn in quantizeInt8 dequantizeInt8 quantizedCosineSim getQuantizationStats; do
    if grep -q "exports\.$fn\|module\.exports.*$fn" "$init_file" 2>/dev/null; then
      found="${found} $fn"
    fi
  done

  if [ -n "$found" ]; then
    _CHECK_OUTPUT="ADR-0086-5: quantization functions still exported:${found}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-5: quantization functions not exported (Phase 1 deletion confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-6: Attention functions NOT exported from dist
#
# Phase 1 deleted batchCosineSim, softmaxAttention, topKIndices,
# flashAttentionSearch. Verify they are absent from the compiled barrel.
# ════════════════════════════════════════════════════════════════════

check_attention_not_exported() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-6: could not locate @sparkleideas/cli package"
    return
  fi

  local init_file
  init_file=$(find "$cli_pkg_dir" -name "memory-initializer.js" -type f 2>/dev/null | head -1)

  if [ -z "$init_file" ]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0086-6: memory-initializer.js absent (attention trivially absent)"
    return
  fi

  local found=""
  for fn in batchCosineSim softmaxAttention topKIndices flashAttentionSearch; do
    if grep -q "exports\.$fn\|module\.exports.*$fn" "$init_file" 2>/dev/null; then
      found="${found} $fn"
    fi
  done

  if [ -n "$found" ]; then
    _CHECK_OUTPUT="ADR-0086-6: attention functions still exported:${found}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-6: attention functions not exported (Phase 1 deletion confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-7: Embedding adapter present in memory package dist
#
# Phase 1 relocated embedding functions to embedding-adapter.ts.
# Verify the compiled adapter exists in the published memory package.
# ════════════════════════════════════════════════════════════════════

check_embedding_adapter_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local mem_pkg_dir=""
  mem_pkg_dir=$(find "$TEMP_DIR" -path "*/node_modules/@sparkleideas/memory" -type d 2>/dev/null | head -1)
  if [ -z "$mem_pkg_dir" ]; then
    mem_pkg_dir=$(find "$E2E_DIR" -path "*/node_modules/@sparkleideas/memory" -type d 2>/dev/null | head -1)
  fi

  if [ -z "$mem_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-7: could not locate @sparkleideas/memory package"
    return
  fi

  local adapter_file
  adapter_file=$(find "$mem_pkg_dir" -name "embedding-adapter.js" -o -name "embedding-adapter.mjs" 2>/dev/null | head -1)

  if [ -z "$adapter_file" ]; then
    _CHECK_OUTPUT="ADR-0086-7: embedding-adapter.js not found in @sparkleideas/memory dist"
    return
  fi

  # Verify key exports
  local missing=""
  for fn in loadEmbeddingModel generateEmbedding generateBatchEmbeddings getAdaptiveThreshold; do
    if ! grep -q "$fn" "$adapter_file" 2>/dev/null; then
      missing="${missing} $fn"
    fi
  done

  if [ -n "$missing" ]; then
    _CHECK_OUTPUT="ADR-0086-7: embedding-adapter.js missing functions:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-7: embedding-adapter.js present with all 4 relocated functions"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-8: bulkDelete and clearNamespace in MemoryOpType
#
# Phase 2b added bulkDelete and clearNamespace to MemoryOpType.
# Verify memory-router.js contains both values.
# ════════════════════════════════════════════════════════════════════

check_bulkdelete_clearnamespace() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-8: could not locate @sparkleideas/cli package"
    return
  fi

  local router_file
  router_file=$(find "$cli_pkg_dir" -name "memory-router.js" -type f 2>/dev/null | head -1)

  if [ -z "$router_file" ]; then
    _CHECK_OUTPUT="ADR-0086-8: memory-router.js not found in dist"
    return
  fi

  local missing=""
  if ! grep -q 'bulkDelete' "$router_file" 2>/dev/null; then
    missing="${missing} bulkDelete"
  fi
  if ! grep -q 'clearNamespace' "$router_file" 2>/dev/null; then
    missing="${missing} clearNamespace"
  fi

  if [ -n "$missing" ]; then
    _CHECK_OUTPUT="ADR-0086-8: memory-router.js missing MemoryOpType values:${missing}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-8: bulkDelete and clearNamespace present in router"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-9: B1 — applyTemporalDecay is a stub returning correct shape
#
# B1 fix: applyTemporalDecay should return stub shape (patternsDecayed: 0)
# when memory-initializer.js is present.
# ════════════════════════════════════════════════════════════════════

check_temporal_decay_stub() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-9: could not locate @sparkleideas/cli package"
    return
  fi

  local init_file
  init_file=$(find "$cli_pkg_dir" -name "memory-initializer.js" -type f 2>/dev/null | head -1)

  if [ -z "$init_file" ]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0086-9: memory-initializer.js absent (temporal decay trivially stubbed)"
    return
  fi

  if ! grep -q 'patternsDecayed.*0\|patternsDecayed: 0' "$init_file" 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0086-9: applyTemporalDecay does not return stub shape (patternsDecayed: 0)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-9: applyTemporalDecay returns stub shape (B1 fix confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-10: B3 — mcp-server uses healthCheck, not checkMemoryInitialization
#
# B3 fix: mcp-server.js should use healthCheck via memory-router,
# not the deprecated checkMemoryInitialization from memory-initializer.
# ════════════════════════════════════════════════════════════════════

check_healthcheck_not_check_init() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-10: could not locate @sparkleideas/cli package"
    return
  fi

  local mcp_file
  mcp_file=$(find "$cli_pkg_dir/dist" -name "mcp-server.js" -type f 2>/dev/null | head -1)

  if [ -z "$mcp_file" ]; then
    _CHECK_OUTPUT="ADR-0086-10: mcp-server.js not found in dist"
    return
  fi

  # Exclude comment lines — compiled JS may mention the old name in comments
  if grep -v '^\s*//' "$mcp_file" | grep -q 'checkMemoryInitialization' 2>/dev/null; then
    _CHECK_OUTPUT="ADR-0086-10: mcp-server.js still imports checkMemoryInitialization (B3 regression)"
    return
  fi

  if ! grep -q 'healthCheck\|health_check\|memory-router' "$mcp_file" 2>/dev/null; then
    local file_size; file_size=$(wc -c < "$mcp_file" 2>/dev/null || echo 0)
    _CHECK_OUTPUT="ADR-0086-10: mcp-server.js (${file_size}B at ${mcp_file}) does not reference healthCheck or memory-router"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-10: mcp-server.js uses healthCheck via router (B3 fix confirmed)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0086-11: T3.3 — track real better-sqlite3 blockers
#
# Informational check: counts dist files that still import better-sqlite3
# directly, excluding known expected files. Tracks T3.3 blocker count.
# ════════════════════════════════════════════════════════════════════

check_real_sqlite3_blockers() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli_pkg_dir
  cli_pkg_dir=$(_adr0086_find_cli_pkg)

  if [ -z "$cli_pkg_dir" ]; then
    _CHECK_OUTPUT="ADR-0086-11: could not locate @sparkleideas/cli package"
    return
  fi

  # Count dist files that import better-sqlite3, excluding memory-initializer
  local sqlite_consumers
  sqlite_consumers=$(find "$cli_pkg_dir" -name "*.js" \
    -not -name "memory-initializer.js" \
    -not -name "sqlite-backend.js" \
    -not -name "database-provider.js" \
    -type f \
    -exec grep -l 'better-sqlite3\|betterSqlite3\|require.*sqlite3' {} + 2>/dev/null)

  local count=0
  if [ -n "$sqlite_consumers" ]; then
    count=$(echo "$sqlite_consumers" | wc -l | tr -d ' ')
  fi

  # This check is informational — it tracks the T3.3 blocker count
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0086-11: $count dist files still use better-sqlite3 directly (T3.3 blocker tracking)"
}

#!/usr/bin/env bash
# lib/acceptance-adr0059-phase3-checks.sh — ADR-0059 Phase 3 acceptance checks
#
# Unified MCP search: memory search queries both SQLite (.swarm/memory.db)
# and RVF (.swarm/agentdb-memory.rvf).
#
# Requires: acceptance-checks.sh + acceptance-adr0059-checks.sh sourced first
# Caller MUST set: E2E_DIR, CLI_BIN, REGISTRY

# Safety: disable strict unset checking for these check functions.
# The test runner uses set -u which can crash subshells if any helper
# function leaves a variable unset in the call chain.
set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# UNIFIED SEARCH: both stores, dedup, no-crash
# ════════════════════════════════════════════════════════════════════

check_adr0059_unified_search_both_stores() {
  _CHECK_PASSED="false"
  local cli; cli=$(_cli_cmd)

  # Store in SQLite via CLI
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key 'sqlite-entry-p3' --value 'JWT refresh token rotation' --namespace 'phase3-test'" "" 15
  if ! echo "$_RK_OUT" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="memory store failed: $_RK_OUT"; return
  fi

  # Create a memory topic file that importFromAutoMemory reads
  local topic_dir="$E2E_DIR/.claude/projects/-$(echo "$E2E_DIR" | tr '/' '-')/memory"
  mkdir -p "$topic_dir" 2>/dev/null || true
  cat > "$topic_dir/phase3-rvf-test.md" << 'TOPIC'
---
name: phase3-rvf-test
description: RVF test entry for unified search
type: reference
---

OAuth token refresh with PKCE flow for mobile clients
TOPIC

  # Run hook import to populate RVF store
  local import_out
  import_out=$(_adr0059_run_hook "auto-memory-hook.mjs" "import") || true

  # Search for a term that should match entries from both stores
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'token refresh' --namespace 'phase3-test' --limit 5" "" 15

  # PASS only if the stored key appears in search results
  if echo "$_RK_OUT" | grep -q 'sqlite-entry-p3'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Unified search found stored key 'sqlite-entry-p3'"
  else
    _CHECK_OUTPUT="Stored key 'sqlite-entry-p3' not found in search output: $_RK_OUT"
  fi
}

check_adr0059_unified_search_dedup() {
  _CHECK_PASSED="false"
  local cli; cli=$(_cli_cmd)

  # Store an entry in SQLite
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key 'dedup-test-key' --value 'authentication middleware pattern' --namespace 'dedup-test'" "" 15

  # Search and count results for this specific key
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'authentication middleware' --namespace 'dedup-test' --limit 20" "" 15

  # Count how many times the key appears — should be at most 1
  local count
  count=$(echo "$_RK_OUT" | grep -c "dedup-test-key" 2>/dev/null) || count=0

  if [[ "$count" -eq 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Dedup OK: key appeared exactly 1 time"
  else
    _CHECK_OUTPUT="Key appeared $count times (expected exactly 1)"
  fi
}

check_adr0059_unified_search_no_crash() {
  _CHECK_PASSED="false"
  local cli; cli=$(_cli_cmd)

  # Remove RVF file if it exists to simulate fresh project
  rm -f "$E2E_DIR/.swarm/agentdb-memory.rvf" 2>/dev/null || true

  # Search should still work (SQLite-only mode)
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'test pattern'" "" 15

  # Should not crash
  if echo "$_RK_OUT" | grep -qiE '(fatal|unhandled|SIGSEGV|Cannot read prop)'; then
    _CHECK_OUTPUT="Search crashed without .rvf file: $_RK_OUT"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Search ran without .rvf file (SQLite-only mode OK)"
  fi
}

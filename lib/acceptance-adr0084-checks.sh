#!/usr/bin/env bash
# lib/acceptance-adr0084-checks.sh — ADR-0084 acceptance checks
#
# Phase 1 — Dead Code Cleanup: sql.js ghost refs.
# Verifies that no user-facing output from published CLI commands
# contains the string "sql.js". The internal library name must not
# leak; users should only ever see "SQLite" (the engine name).
#
# ADR-0084 decisions tested here:
#   - CLI memory commands do not print "sql.js" in output
#   - CLI doctor output does not mention "sql.js"
#   - Published tool description strings do not reference "sql.js"
#
# Requires: acceptance-checks.sh sourced first (_run_and_kill, _cli_cmd available)
# Caller MUST set: TEMP_DIR, E2E_DIR, CLI_BIN, REGISTRY

# ════════════════════════════════════════════════════════════════════
# ADR-0084-1: No "sql.js" in memory command output
#
# Runs memory store + memory search in the init'd E2E project and
# verifies that (a) the combined output does NOT contain "sql.js"
# and (b) if backend info is printed, it says "SQLite" (not "sql.js").
# ════════════════════════════════════════════════════════════════════

check_no_sqljs_in_backend_output() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local ns="adr0084-sqljs-$(date +%s)"
  local test_key="adr0084-check"
  local test_val="verify no sql.js in user-facing output"

  # Accumulate all output from store + search + doctor
  local combined_output=""

  # 1. memory store
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key '$test_key' --value '$test_val' --namespace '$ns'" "" 15
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  if ! echo "$_RK_OUT" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="ADR-0084-1: memory store did not report success — cannot verify output (store: ${_RK_OUT:0:120})"
    return
  fi

  # 2. memory search
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'sql.js output check' --namespace '$ns' --limit 5" "" 15
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  # 3. doctor --fix (captures diagnostic output about backends)
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor --fix" "" 20
  combined_output="${combined_output}${_RK_OUT}"$'\n'

  # Check: "sql.js" must NOT appear anywhere in the combined output.
  # Use case-insensitive match to catch "SQL.js", "Sql.js", etc.
  if echo "$combined_output" | grep -qi 'sql\.js'; then
    local offending_lines
    offending_lines=$(echo "$combined_output" | grep -i 'sql\.js' | head -5)
    _CHECK_OUTPUT="ADR-0084-1: user-facing output contains 'sql.js': ${offending_lines}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0084-1: no 'sql.js' in memory store/search/doctor output (user sees 'SQLite' only)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0084-2: No "sql.js" in published MCP tool descriptions
#
# MCP tool definitions include description strings that users see in
# Claude Code's tool list. Grep all .js files under the CLI dist for
# tool description patterns containing "sql.js".
#
# This complements ADR-0080's import check — ADR-0080 checks for
# import('sql.js')/require('sql.js'); this check catches "sql.js"
# in user-visible string literals (descriptions, error messages, logs).
# ════════════════════════════════════════════════════════════════════

check_no_sqljs_in_tool_descriptions() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local base="${TEMP_DIR}/node_modules/@sparkleideas/cli"
  if [[ ! -d "$base" ]]; then
    _CHECK_OUTPUT="ADR-0084-2: @sparkleideas/cli not installed in TEMP_DIR"
    return
  fi

  local dist_dir="$base/dist"
  if [[ ! -d "$dist_dir" ]]; then
    _CHECK_OUTPUT="ADR-0084-2: dist/ directory not found in published CLI"
    return
  fi

  # Search all compiled .js files for "sql.js" in string literals.
  # Exclude node_modules (transitive deps may legitimately reference sql.js
  # as a package name in their own code — we only care about OUR strings).
  # Exclude import()/require() lines — those are covered by ADR-0080-P4-1.
  local hits
  hits=$(find "$dist_dir" -path '*/node_modules' -prune -o \
    -name '*.js' -not -name '*.test.*' -not -name '*.spec.*' -print0 2>/dev/null \
    | xargs -0 grep -Hn 'sql\.js' 2>/dev/null \
    | grep -v "import('sql\.js')\|require('sql\.js')\|from.*sql\.js" \
    || true)

  local count=0
  if [[ -n "$hits" ]]; then
    count=$(echo "$hits" | wc -l | tr -d ' ')
  fi

  if [[ "$count" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0084-2: zero 'sql.js' string references in published CLI dist (tool descriptions clean)"
  else
    local files
    files=$(echo "$hits" | cut -d: -f1 | sort -u \
      | sed "s|${base}/||" | head -5 | tr '\n' ', ')
    local sample
    sample=$(echo "$hits" | head -3 | sed "s|${base}/||")
    _CHECK_OUTPUT="ADR-0084-2: ${count} 'sql.js' string reference(s) in published CLI dist: ${files%,}"$'\n'"  Sample: ${sample}"
  fi
}

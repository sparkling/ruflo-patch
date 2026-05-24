# lib/acceptance-adr0240-checks.sh — ADR-0240 site #2 trip-wire.
#
# Wires Batch 1's ADR-0240 site #2 fix (stderr-only diagnostic in
# learning_train under StdioServerTransport) into the fast acceptance
# runner. Two checks:
#
#   1. Source line at agentdb/src/mcp/agentdb-mcp-server.ts:2018 uses
#      console.error (not console.log/info/debug). Belt: also greps the
#      ADR-0240 marker comment on the preceding line.
#   2. The scoped .eslintrc.json no-console-with-error/warn-allow override
#      exists at forks/agentdb/.eslintrc.json.
#
# Exit-code mapping per check_* convention:
#   pass  → both source + lint config present and aligned
#   skip  → fork path missing (legitimate skip per env)
#   fail  → marker absent, stdout console.log present, or eslint config missing
#
# Per ADR-0233 second-pass §Per-ADR validation gates.

_FORK_AGENTDB="/Users/henrik/source/forks/agentdb"

check_adr0240_site2_stderr_marker() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local src="${_FORK_AGENTDB}/src/mcp/agentdb-mcp-server.ts"
  if [[ ! -f "$src" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: agentdb fork path missing"
    return
  fi

  # Marker comment present
  if ! grep -q "ADR-0240 site #2: stderr-only logging on StdioServerTransport" "$src"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ADR-0240 site #2 marker comment missing from $src"
    return
  fi

  # The diagnostic line under that marker must use console.error (not log/info/debug).
  # Match the literal training-session line per commit 459781e.
  if ! grep -q "console.error(\`🎓 Training session" "$src"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: training-session diagnostic not using console.error"
    return
  fi

  # Negative: no console.log/info/debug anywhere in the file (whole file is the MCP stdio surface).
  # (`reference-grep-c-bash-trap`: `|| echo 0` produces "0\n0" and trips arithmetic.)
  local bad
  bad=$(grep -cE "console\.(log|info|debug)\(" "$src" 2>/dev/null)
  bad=${bad:-0}
  if [[ "$bad" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: $bad console.log/info/debug call(s) found on stdio MCP surface"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0240 site #2 marker + console.error contract intact (0 stdout-bound diagnostics)"
}

check_adr0240_eslint_no_console_scope() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cfg="${_FORK_AGENTDB}/.eslintrc.json"
  if [[ ! -f "$cfg" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: $cfg missing (ADR-0240 site #2 lint rider)"
    return
  fi

  # Must reference src/mcp/ scope and the no-console rule with allow:[error,warn].
  if ! grep -q "src/mcp/" "$cfg"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: .eslintrc.json does not scope to src/mcp/"
    return
  fi
  if ! grep -q "no-console" "$cfg"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: .eslintrc.json missing no-console rule"
    return
  fi
  if ! grep -q '"error"' "$cfg" || ! grep -q '"warn"' "$cfg"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: .eslintrc.json no-console allow-list missing error/warn"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT=".eslintrc.json scopes no-console to src/mcp/ with error+warn allow"
}

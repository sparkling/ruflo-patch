#!/usr/bin/env bash
# lib/acceptance-structure-checks.sh — Structure group checks (ADR-0039 T2)
#
# Requires: acceptance-checks.sh sourced first
# Caller MUST set: REGISTRY, TEMP_DIR

# --------------------------------------------------------------------------
# Settings file
# --------------------------------------------------------------------------
check_settings_file() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  if [[ -f "$TEMP_DIR/.claude/settings.json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="File exists: $TEMP_DIR/.claude/settings.json"
  else
    _CHECK_OUTPUT="Missing: $TEMP_DIR/.claude/settings.json"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\nContents of temp dir:"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(find "$TEMP_DIR" -maxdepth 3 -type f 2>/dev/null | head -20)"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  else
    _DURATION_MS=0
  fi
  _OUT="$_CHECK_OUTPUT"
}

# --------------------------------------------------------------------------
# Scope check
# --------------------------------------------------------------------------
check_scope() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  if [[ -f "$TEMP_DIR/CLAUDE.md" ]]; then
    local matches
    matches=$(grep -c '@sparkleideas' "$TEMP_DIR/CLAUDE.md" 2>/dev/null || echo "0")
    if [[ "$matches" -ge 1 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Found $matches @sparkleideas references in CLAUDE.md"
    else
      _CHECK_OUTPUT="No @sparkleideas references found in CLAUDE.md"
      _CHECK_OUTPUT="$_CHECK_OUTPUT\nHead of CLAUDE.md:\n$(head -20 "$TEMP_DIR/CLAUDE.md" 2>/dev/null)"
    fi
  else
    _CHECK_OUTPUT="Missing: $TEMP_DIR/CLAUDE.md"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  else
    _DURATION_MS=0
  fi
  _OUT="$_CHECK_OUTPUT"
}

# --------------------------------------------------------------------------
# MCP config
# --------------------------------------------------------------------------
check_mcp_config() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  if [[ -f "$TEMP_DIR/.mcp.json" ]]; then
    if grep -q 'autoStart.*false' "$TEMP_DIR/.mcp.json" 2>/dev/null; then
      _CHECK_OUTPUT="Found autoStart: false in .mcp.json (MC-001 patch not applied)"
      _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(cat "$TEMP_DIR/.mcp.json" 2>/dev/null)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="File exists, no autoStart: false found"
    fi
  else
    _CHECK_OUTPUT="Missing: $TEMP_DIR/.mcp.json"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\nContents of temp dir:"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(find "$TEMP_DIR" -maxdepth 3 -type f 2>/dev/null | head -20)"
  fi
  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  if [[ "$start_ns" != "0" && "$end_ns" != "0" ]]; then
    _DURATION_MS=$(( (end_ns - start_ns) / 1000000 ))
  else
    _DURATION_MS=0
  fi
  _OUT="$_CHECK_OUTPUT"
}

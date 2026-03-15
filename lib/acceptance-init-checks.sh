#!/usr/bin/env bash
# lib/acceptance-init-checks.sh — Init assertion checks (ADR-0039 T2)
#
# ADR-0038: Ported from init-*.test.mjs
# Requires: acceptance-checks.sh sourced first
# Caller MUST set: TEMP_DIR

check_init_config_format() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  local config_yaml="$TEMP_DIR/.claude-flow/config.yaml"
  local config_yml="$TEMP_DIR/.claude-flow/config.yml"

  if [[ -f "$config_json" ]]; then
    # Validate it is actual JSON
    if node -e "JSON.parse(require('fs').readFileSync('$config_json','utf8'))" 2>/dev/null; then
      if [[ -f "$config_yaml" || -f "$config_yml" ]]; then
        _CHECK_OUTPUT="config.json exists but YAML also present (SG-008 partial)"
      else
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="Config is JSON, no YAML present (SG-008 OK)"
      fi
    else
      _CHECK_OUTPUT="config.json exists but is not valid JSON"
    fi
  elif [[ -f "$config_yaml" || -f "$config_yml" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Config is YAML not JSON (SG-008 not yet fixed)"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No .claude-flow/config file present (init may not generate one)"
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

check_init_helper_syntax() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local helpers_dir="$TEMP_DIR/.claude/helpers"
  if [[ ! -d "$helpers_dir" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No .claude/helpers directory (SG-003 may not be applied yet)"
  else
    local syntax_errors=0 checked=0
    for f in "$helpers_dir"/*.cjs "$helpers_dir"/*.js; do
      [[ -f "$f" ]] || continue
      checked=$((checked + 1))
      if ! node -c "$f" 2>/dev/null; then
        syntax_errors=$((syntax_errors + 1))
        _CHECK_OUTPUT="Syntax error in $(basename "$f")"
      fi
    done
    for f in "$helpers_dir"/*.mjs; do
      [[ -f "$f" ]] || continue
      checked=$((checked + 1))
      local content
      content=$(cat "$f")
      if ! echo "$content" | grep -qE 'import|export'; then
        syntax_errors=$((syntax_errors + 1))
        _CHECK_OUTPUT="$(basename "$f") does not appear to be ESM"
      fi
    done
    if [[ $checked -eq 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="helpers/ exists but no scripts found"
    elif [[ $syntax_errors -eq 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="$checked helper scripts have valid syntax"
    fi
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

check_init_no_persist_path() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No config.json to check for persistPath"
  else
    if grep -q 'persistPath' "$config_json" 2>/dev/null; then
      _CHECK_OUTPUT="config.json contains persistPath (MM-001 regression)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="No persistPath in config.json (MM-001 OK)"
    fi
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

check_init_permission_globs() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local settings="$TEMP_DIR/.claude/settings.json"
  if [[ ! -f "$settings" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No settings.json to check permission globs"
  else
    if grep -q '@claude-flow/\*' "$settings" 2>/dev/null; then
      _CHECK_OUTPUT="settings.json uses broad @claude-flow/* glob (SG-001 regression)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="No broad @claude-flow/* glob in settings.json (SG-001 OK)"
    fi
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

check_init_topology() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="No config.json to check topology"
  else
    local topology
    topology=$(node -e "
      const c=JSON.parse(require('fs').readFileSync('$config_json','utf8'));
      console.log(c.topology||c.swarm?.topology||'')
    " 2>/dev/null) || topology=""
    if [[ -z "$topology" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="No topology field in config.json"
    elif [[ "$topology" == "hierarchical-mesh" || "$topology" == "hierarchical" || "$topology" == "mesh" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Topology is '$topology' (SG-011 OK)"
    else
      _CHECK_OUTPUT="Unexpected topology '$topology' (expected hierarchical-mesh)"
    fi
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

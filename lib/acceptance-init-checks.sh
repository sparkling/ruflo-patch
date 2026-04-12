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
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="Config is YAML not JSON (SG-008 not yet fixed — must be JSON)"
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="No .claude-flow/config file present — init must generate config.json"
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
    local failed_files=""
    for f in "$helpers_dir"/*.cjs "$helpers_dir"/*.js; do
      [[ -f "$f" ]] || continue
      checked=$((checked + 1))
      local err_out
      err_out=$(node -c "$f" 2>&1) || {
        syntax_errors=$((syntax_errors + 1))
        local bname; bname=$(basename "$f")
        failed_files="${failed_files:+${failed_files}, }${bname}: ${err_out%%$'\n'*}"
      }
    done
    for f in "$helpers_dir"/*.mjs; do
      [[ -f "$f" ]] || continue
      checked=$((checked + 1))
      # ESM: node -c doesn't validate top-level await, so also check for import/export
      local err_out
      err_out=$(node -c "$f" 2>&1) || {
        syntax_errors=$((syntax_errors + 1))
        local bname; bname=$(basename "$f")
        failed_files="${failed_files:+${failed_files}, }${bname}: ${err_out%%$'\n'*}"
        continue
      }
      if ! grep -qE 'import|export' "$f"; then
        syntax_errors=$((syntax_errors + 1))
        local bname; bname=$(basename "$f")
        failed_files="${failed_files:+${failed_files}, }${bname}: not ESM (no import/export)"
      fi
    done
    if [[ $checked -eq 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="helpers/ exists but no scripts found"
    elif [[ $syntax_errors -eq 0 ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="$checked helper scripts have valid syntax"
    else
      _CHECK_OUTPUT="${syntax_errors}/${checked} failed: ${failed_files}"
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

check_init_config_values() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="No config.json to validate values — init must generate config.json"
  else
    local issues=""
    local vals
    # Supports both old format (memory.cacheSize, memory.enableHNSW) and
    # new format (memory.sqlite.cacheSize, memory.backend='hybrid' implies HNSW).
    vals=$(node -e "
      const c=JSON.parse(require('fs').readFileSync('$config_json','utf8'));
      const m=c.memory||{};
      // cacheSize: old format uses m.cacheSize (positive), new uses m.sqlite.cacheSize (negative KB)
      const cache = m.cacheSize || (m.sqlite||{}).cacheSize || 0;
      const nodes = (m.memoryGraph||{}).maxNodes || 0;
      const sona = (m.learningBridge||{}).sonaMode || '';
      // HNSW: old format has explicit enableHNSW, new format uses backend='hybrid'
      const hnswOk = m.enableHNSW === true || m.backend === 'hybrid';
      const lb = (m.learningBridge||{}).enabled === true;
      console.log([cache, nodes, sona, hnswOk?'true':'false', lb?'true':'false'].join('|'));
    " 2>/dev/null) || vals=""
    IFS='|' read -r cache nodes sona hnsw lb <<< "$vals"
    # cacheSize should be set by init and non-zero (positive in old format, negative KB in new)
    [[ "${cache:-0}" -ne 0 ]] || issues="${issues}cacheSize=0 "
    # maxNodes should be set
    [[ "${nodes:-0}" -gt 0 ]] || issues="${issues}maxNodes=0 "
    # sonaMode should be a known value
    [[ "$sona" == "balanced" || "$sona" == "real-time" || "$sona" == "research" || "$sona" == "edge" || "$sona" == "batch" ]] || issues="${issues}sonaMode='${sona}' "
    # HNSW should be enabled (explicit flag or backend=hybrid)
    [[ "$hnsw" == "true" ]] || issues="${issues}enableHNSW=false "
    # learningBridge should be enabled
    [[ "$lb" == "true" ]] || issues="${issues}learningBridge=false "

    if [[ -z "$issues" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Config values OK: cache=${cache}, nodes=${nodes}, sona=${sona}, hnsw=${hnsw}, lb=${lb}"
    else
      _CHECK_OUTPUT="Config value issues: ${issues}(cache=${cache}, nodes=${nodes}, sona=${sona})"
    fi
  fi

  end_ns=$(date +%s%N 2>/dev/null || echo 0)
  _EXIT=0
  [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

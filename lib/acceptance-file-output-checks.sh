#!/usr/bin/env bash
# lib/acceptance-file-output-checks.sh — ADR-0094 Phase 7: File output validation
#
# Read-only checks verifying `init --full` generates expected files with
# correct structure. Each check examines E2E_DIR directly (no isolation).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# Shared helper — validate a JSON file exists, parses, and has required keys.
# Args: $1=rel_path  $2=required_fields (comma-sep, empty=parse-only)  $3=label
# Sets: _CHECK_PASSED, _CHECK_OUTPUT
_p7_validate_json_file() {
  local rel_path="$1" required_fields="$2" label="$3"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/${rel_path}"

  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="P7/${label}: file missing — expected at ${rel_path}"; return
  fi
  local file_size; file_size=$(wc -c < "$target" 2>/dev/null | tr -d ' ')
  file_size=${file_size:-0}
  if (( file_size == 0 )); then
    _CHECK_OUTPUT="P7/${label}: file exists but is empty (0 bytes) — ${rel_path}"; return
  fi

  local validate_out
  validate_out=$(node -e '
    const fs = require("fs"), file = process.argv[1];
    const required = (process.argv[2] || "").split(",").map(s=>s.trim()).filter(Boolean);
    let j;
    try { j = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (e) { console.log("ERR_PARSE:" + e.message); process.exit(1); }
    if (!required.length) { console.log("OK"); process.exit(0); }
    const missing = required.filter(k => !(k in j) || j[k] == null);
    if (missing.length) { console.log("ERR_MISSING:" + missing.join(",")); process.exit(1); }
    console.log("OK:" + required.join(","));
  ' "$target" "$required_fields" 2>&1)

  if echo "$validate_out" | grep -q '^ERR_PARSE:'; then
    _CHECK_OUTPUT="P7/${label}: invalid JSON in ${rel_path}: $(echo "$validate_out" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)"
    return
  fi
  if echo "$validate_out" | grep -q '^ERR_MISSING:'; then
    _CHECK_OUTPUT="P7/${label}: missing key(s) in ${rel_path}: $(echo "$validate_out" | sed -nE 's/^ERR_MISSING:(.*)/\1/p' | head -1) (required: ${required_fields})"
    return
  fi
  if ! echo "$validate_out" | grep -q '^OK'; then
    _CHECK_OUTPUT="P7/${label}: unexpected validator output: $(echo "$validate_out" | head -3 | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  if [[ -n "$required_fields" ]]; then
    _CHECK_OUTPUT="P7/${label}: ${rel_path} (${file_size}B), valid JSON, keys present (${required_fields})"
  else
    _CHECK_OUTPUT="P7/${label}: ${rel_path} (${file_size}B), valid JSON"
  fi
}

# Check 1: .claude-flow/agents/store.json
check_adr0094_p7_agents_store() {
  _p7_validate_json_file ".claude-flow/agents/store.json" "" "agents_store"
}

# Check 2: .swarm/agents.json
check_adr0094_p7_swarm_agents() {
  _p7_validate_json_file ".swarm/agents.json" "" "swarm_agents"
}

# Check 3: .swarm/state.json — must have "topology" or "agents" key
check_adr0094_p7_swarm_state() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.swarm/state.json"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="P7/swarm_state: file missing — .swarm/state.json"; return
  fi
  local validate_out
  validate_out=$(node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { console.log("ERR_PARSE:" + e.message); process.exit(1); }
    const found = ["topology","agents"].filter(k => k in j);
    if (!found.length) { console.log("ERR_MISSING:topology,agents"); process.exit(1); }
    console.log("OK:" + found.join(","));
  ' "$target" 2>&1)
  if echo "$validate_out" | grep -q '^ERR_PARSE:'; then
    _CHECK_OUTPUT="P7/swarm_state: invalid JSON: $(echo "$validate_out" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)"; return
  fi
  if echo "$validate_out" | grep -q '^ERR_MISSING:'; then
    _CHECK_OUTPUT="P7/swarm_state: .swarm/state.json lacks both 'topology' and 'agents' keys"; return
  fi
  local found; found=$(echo "$validate_out" | sed -nE 's/^OK:(.*)/\1/p' | head -1)
  local sz; sz=$(wc -c < "$target" 2>/dev/null | tr -d ' ')
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P7/swarm_state: .swarm/state.json (${sz:-0}B), valid JSON, has: ${found}"
}

# Check 4: .claude/helpers/statusline.cjs — valid JS syntax
check_adr0094_p7_statusline_cjs() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.claude/helpers/statusline.cjs"
  if [[ ! -f "$target" ]]; then
    _CHECK_OUTPUT="P7/statusline_cjs: file missing — .claude/helpers/statusline.cjs"; return
  fi
  local sz; sz=$(wc -c < "$target" 2>/dev/null | tr -d ' '); sz=${sz:-0}
  if (( sz == 0 )); then
    _CHECK_OUTPUT="P7/statusline_cjs: file exists but is empty (0 bytes)"; return
  fi
  local check_out; check_out=$(node --check "$target" 2>&1)
  if [[ $? -ne 0 ]]; then
    _CHECK_OUTPUT="P7/statusline_cjs: node --check failed: $(echo "$check_out" | head -5 | tr '\n' ' ')"; return
  fi
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P7/statusline_cjs: statusline.cjs (${sz}B), valid JS syntax"
}

# Check 5: .claude-flow/neural/ directory exists
check_adr0094_p7_neural_dir() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  if [[ -d "${E2E_DIR}/.claude-flow/neural" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/neural_dir: .claude-flow/neural/ exists"
  else
    _CHECK_OUTPUT="P7/neural_dir: directory missing — .claude-flow/neural/"
  fi
}

# Check 6: .claude-flow/hooks/ directory (or hooks key in config.json)
check_adr0094_p7_hooks_dir() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  if [[ -d "${E2E_DIR}/.claude-flow/hooks" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/hooks_dir: .claude-flow/hooks/ exists"
    return
  fi
  # Fallback: hooks may live in config.json
  if [[ -f "${E2E_DIR}/.claude-flow/config.json" ]]; then
    local has; has=$(node -e '
      const fs=require("fs");
      try { const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log("hooks" in j?"YES":"NO"); }
      catch { console.log("NO"); }
    ' "${E2E_DIR}/.claude-flow/config.json" 2>&1)
    if [[ "$has" == "YES" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P7/hooks_dir: no hooks/ dir but hooks config in config.json"; return
    fi
  fi
  _CHECK_OUTPUT="P7/hooks_dir: neither .claude-flow/hooks/ nor hooks key in config.json"
}

# Check 7: .claude-flow/config.json
check_adr0094_p7_config_json() {
  _p7_validate_json_file ".claude-flow/config.json" "" "config_json"
}

# Check 8: .claude/settings.json — must have permissions + mcpServers
check_adr0094_p7_settings_json() {
  _p7_validate_json_file ".claude/settings.json" "permissions,mcpServers" "settings_json"
}

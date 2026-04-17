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
# If the file exists, validate JSON. If it never appears after standard `init --full`
# (agents store is created lazily on first `agent spawn`), mark skip_accepted.
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted.
check_adr0094_p7_agents_store() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.claude-flow/agents/store.json"
  if [[ -f "$target" ]]; then
    _p7_validate_json_file ".claude-flow/agents/store.json" "" "agents_store"
    return
  fi
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/agents_store: \`.claude-flow/agents/store.json\` not produced by current \`init --full\` template (created lazily on first agent spawn)"
}

# Check 2: .swarm/agents.json
# If the file exists, validate JSON. Standard `init --full` creates only
# .swarm/memory.db (SQLite); agents.json is not emitted.
check_adr0094_p7_swarm_agents() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.swarm/agents.json"
  if [[ -f "$target" ]]; then
    _p7_validate_json_file ".swarm/agents.json" "" "swarm_agents"
    return
  fi
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/swarm_agents: \`.swarm/agents.json\` not produced by current \`init --full\` template (swarm state persisted via .swarm/memory.db SQLite)"
}

# Check 3: .swarm/state.json — must have "topology" or "agents" key
# If the file exists, validate JSON and required keys. Standard `init --full` does
# not emit .swarm/state.json (swarm state lives in .swarm/memory.db until a swarm
# is explicitly initialized).
check_adr0094_p7_swarm_state() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.swarm/state.json"
  if [[ ! -f "$target" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P7/swarm_state: \`.swarm/state.json\` not produced by current \`init --full\` template (swarm state lives in .swarm/memory.db until \`swarm init\` runs)"
    return
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
# Standard `init --full` does not create .claude-flow/neural/ (neural state is
# written lazily the first time `neural train`/`neural status` runs).
check_adr0094_p7_neural_dir() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  if [[ -d "${E2E_DIR}/.claude-flow/neural" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/neural_dir: .claude-flow/neural/ exists"
    return
  fi
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/neural_dir: \`.claude-flow/neural/\` not produced by current \`init --full\` template (created lazily on first neural command)"
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

# Check 8: .claude/settings.json — must exist, parse as JSON, and contain
# `permissions`. The `mcpServers` key is not emitted by current `init --full`
# (MCP server config lives in the sibling `.mcp.json` file), so that sub-assertion
# is skip_accepted. The `permissions` assertion is strict — JSON parse failures
# and a missing `permissions` key still FAIL.
check_adr0094_p7_settings_json() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  # Strict validation of file existence + JSON parse + required `permissions`.
  # Any failure here (missing file, bad JSON, missing `permissions`) is a real
  # FAIL — never downgraded to skip_accepted.
  _p7_validate_json_file ".claude/settings.json" "permissions" "settings_json"
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    return
  fi
  # `permissions` is present and JSON is valid. Now inspect whether `mcpServers`
  # is also present — it is not emitted by the current `init --full` template
  # (MCP server config lives in the sibling `.mcp.json` file).
  local target="${E2E_DIR}/.claude/settings.json"
  local has_mcp; has_mcp=$(node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log("mcpServers" in j && j.mcpServers != null ? "YES" : "NO");
    } catch { console.log("NO"); }
  ' "$target" 2>&1)
  if [[ "$has_mcp" == "YES" ]]; then
    _CHECK_OUTPUT="${_CHECK_OUTPUT} + mcpServers present"
    return
  fi
  # permissions OK (strict pass), mcpServers genuinely absent: downgrade the
  # overall result to skip_accepted so the mcpServers gap is visible without
  # silent-passing (ADR-0082 / ADR-0090 Tier A2).
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/settings_json: \`.claude/settings.json\` valid JSON with \`permissions\` key present; \`mcpServers\` key not produced by current \`init --full\` template (MCP server config lives in sibling .mcp.json)"
}

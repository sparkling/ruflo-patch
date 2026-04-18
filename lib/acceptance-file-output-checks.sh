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

# Check 1: .claude-flow/agents/store.json — trigger lazy creation via `agent spawn`
# The store file is created lazily on first `agent spawn`, not by `init --full`.
# Rather than silent-skipping (which hides regressions where lazy creation breaks),
# we isolate a copy of E2E_DIR, run `agent spawn`, and assert the file now exists
# with valid JSON + expected shape. This tests the actual promise: "after spawning
# an agent, the agents store is durable on disk" (Agent A12, ADR-0094 fix-all).
check_adr0094_p7_agents_store() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.claude-flow/agents/store.json"
  # Happy path: file already present from a prior run — validate shape and return.
  if [[ -f "$target" ]]; then
    _p7_validate_json_file ".claude-flow/agents/store.json" "agents" "agents_store"
    return
  fi
  # Trigger path: isolate, spawn an agent, assert the file now exists.
  if ! declare -F _e2e_isolate >/dev/null; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P7/agents_store: _e2e_isolate helper not available (harness not sourced)"
    return
  fi
  local iso; iso=$(_e2e_isolate "p7-fo-agents")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P7/agents_store: failed to create isolated dir"; return
  fi
  # Trap-based cleanup regardless of exit path.
  # shellcheck disable=SC2064
  trap "chmod -R u+rwX '$iso' 2>/dev/null; rm -rf '$iso' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  rm -f "$iso/.claude-flow/agents/store.json" 2>/dev/null || true
  local cli; cli=$(_cli_cmd)
  # Direct `timeout` invocation (avoids the _run_and_kill $? capture footgun —
  # see memory "_run_and_kill exit code is unreliable"). 25s ceiling accommodates
  # cold npx resolution on the fallback path.
  local spawn_out spawn_rc
  spawn_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="${REGISTRY:-}" timeout 25 $cli agent spawn --type coder --name p7-fo-agents-probe 2>&1)
  spawn_rc=$?
  local iso_target="$iso/.claude-flow/agents/store.json"
  if [[ ! -f "$iso_target" ]]; then
    _CHECK_OUTPUT="P7/agents_store: \`agent spawn\` did not create .claude-flow/agents/store.json (rc=$spawn_rc): $(echo "$spawn_out" | tail -3 | tr '\n' ' ')"
    return
  fi
  # Validate the file shape — agents key must be present (object with spawned agent).
  local validate_out
  validate_out=$(node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { console.log("ERR_PARSE:" + e.message); process.exit(1); }
    if (!("agents" in j) || j.agents == null) { console.log("ERR_MISSING:agents"); process.exit(1); }
    const count = Object.keys(j.agents || {}).length;
    console.log("OK:agents=" + count);
  ' "$iso_target" 2>&1)
  if echo "$validate_out" | grep -q '^ERR_PARSE:'; then
    _CHECK_OUTPUT="P7/agents_store: invalid JSON after spawn: $(echo "$validate_out" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)"; return
  fi
  if echo "$validate_out" | grep -q '^ERR_MISSING:'; then
    _CHECK_OUTPUT="P7/agents_store: store.json created but lacks \`agents\` key: $validate_out"; return
  fi
  local sz; sz=$(wc -c < "$iso_target" 2>/dev/null | tr -d ' ')
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P7/agents_store: lazy-created via \`agent spawn\` (${sz:-0}B, ${validate_out#OK:})"
}

# Check 2: .swarm/agents.json — vestigial artifact, confirmed unused by product
# `.swarm/agents.json` is not produced by `init --full`, nor by `swarm init`, nor
# by `agent spawn` — the current product stores agents in two places: (a) per-agent
# records in `.claude-flow/agents/store.json` (covered by check 1), and (b) swarm
# state in `.swarm/memory.db` (SQLite) / `.swarm/memory.rvf` (RVF). Probed against
# `@sparkleideas/cli@latest` by A12 with both `swarm init --topology hierarchical`
# and `agent spawn` (2026-04-18) — neither creates this file.
# Kept as skip_accepted with a stable fingerprint so ADR-0096 skip-rot can surface
# if the product ever starts emitting it again (in which case we upgrade to strict).
check_adr0094_p7_swarm_agents() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.swarm/agents.json"
  if [[ -f "$target" ]]; then
    # File re-emerged — upgrade to strict validation.
    _p7_validate_json_file ".swarm/agents.json" "" "swarm_agents"
    return
  fi
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/swarm_agents: \`.swarm/agents.json\` is a vestigial artifact (agents live in \`.claude-flow/agents/store.json\` — check 1; swarm state lives in \`.swarm/memory.db\` + \`.swarm/memory.rvf\`). Upgraded to strict if the file ever appears."
}

# Check 3: .swarm/state.json — trigger lazy creation via `swarm init`
# State file is lazy-created on first `swarm init`, not by `init --full`. We isolate
# a copy, run `swarm init --topology hierarchical`, and assert the file exists with
# the required `topology` key (or `agents`). This validates the real promise: "after
# initializing a swarm, its state is durable on disk" (A12, ADR-0094 fix-all).
check_adr0094_p7_swarm_state() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local target="${E2E_DIR}/.swarm/state.json"
  # Local validator — reused on both happy path and post-trigger path.
  local _p7_swst_validate
  _p7_swst_validate() {
    local f="$1"
    node -e '
      const fs = require("fs");
      let j;
      try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
      catch (e) { console.log("ERR_PARSE:" + e.message); process.exit(1); }
      const found = ["topology","agents"].filter(k => k in j);
      if (!found.length) { console.log("ERR_MISSING:topology,agents"); process.exit(1); }
      console.log("OK:" + found.join(","));
    ' "$f" 2>&1
  }
  # Happy path.
  if [[ -f "$target" ]]; then
    local vo; vo=$(_p7_swst_validate "$target")
    if echo "$vo" | grep -q '^ERR_PARSE:'; then
      _CHECK_OUTPUT="P7/swarm_state: invalid JSON: $(echo "$vo" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)"; return
    fi
    if echo "$vo" | grep -q '^ERR_MISSING:'; then
      _CHECK_OUTPUT="P7/swarm_state: .swarm/state.json lacks both 'topology' and 'agents' keys"; return
    fi
    local found; found=$(echo "$vo" | sed -nE 's/^OK:(.*)/\1/p' | head -1)
    local sz; sz=$(wc -c < "$target" 2>/dev/null | tr -d ' ')
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/swarm_state: .swarm/state.json (${sz:-0}B), valid JSON, has: ${found}"
    return
  fi
  # Trigger path.
  if ! declare -F _e2e_isolate >/dev/null; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P7/swarm_state: _e2e_isolate helper not available (harness not sourced)"
    return
  fi
  local iso; iso=$(_e2e_isolate "p7-fo-swarm-st")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P7/swarm_state: failed to create isolated dir"; return
  fi
  # shellcheck disable=SC2064
  trap "chmod -R u+rwX '$iso' 2>/dev/null; rm -rf '$iso' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  rm -f "$iso/.swarm/state.json" 2>/dev/null || true
  local cli; cli=$(_cli_cmd)
  local init_out init_rc
  init_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="${REGISTRY:-}" timeout 25 $cli swarm init --topology hierarchical --max-agents 4 2>&1)
  init_rc=$?
  local iso_target="$iso/.swarm/state.json"
  if [[ ! -f "$iso_target" ]]; then
    _CHECK_OUTPUT="P7/swarm_state: \`swarm init\` did not create .swarm/state.json (rc=$init_rc): $(echo "$init_out" | tail -3 | tr '\n' ' ')"; return
  fi
  local vo; vo=$(_p7_swst_validate "$iso_target")
  if echo "$vo" | grep -q '^ERR_PARSE:'; then
    _CHECK_OUTPUT="P7/swarm_state: invalid JSON after swarm init: $(echo "$vo" | sed -nE 's/^ERR_PARSE:(.*)/\1/p' | head -1)"; return
  fi
  if echo "$vo" | grep -q '^ERR_MISSING:'; then
    _CHECK_OUTPUT="P7/swarm_state: state.json created by swarm init but lacks topology/agents: $vo"; return
  fi
  local found; found=$(echo "$vo" | sed -nE 's/^OK:(.*)/\1/p' | head -1)
  local sz; sz=$(wc -c < "$iso_target" 2>/dev/null | tr -d ' ')
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P7/swarm_state: lazy-created via \`swarm init\` (${sz:-0}B, has: ${found})"
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

# Check 5: .claude-flow/neural/ directory — behavior-over-artifact
# Probed against `@sparkleideas/cli@latest` (2026-04-18): neither `neural train
# --iterations 1` nor `neural status` creates `.claude-flow/neural/`. Neural
# adapter state is persisted in the AgentDB SQLite/RVF store (.swarm/memory.db,
# .swarm/memory.rvf) — the directory is vestigial.
#
# Per ADR-0082 ("test behavior, not artifact shape"), we assert the real promise:
# `neural train` completes successfully and reports pattern metrics. The directory
# check is retained as a passthrough — if upstream ever starts emitting it again,
# strict validation kicks in.
check_adr0094_p7_neural_dir() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  # Happy path: directory present (upstream may re-emit it) — prefer artifact.
  if [[ -d "${E2E_DIR}/.claude-flow/neural" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/neural_dir: .claude-flow/neural/ exists"
    return
  fi
  # Behavior path: run `neural train` in isolation and assert it completes.
  if ! declare -F _e2e_isolate >/dev/null; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P7/neural_dir: _e2e_isolate helper not available (harness not sourced)"
    return
  fi
  local iso; iso=$(_e2e_isolate "p7-fo-neural")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P7/neural_dir: failed to create isolated dir"; return
  fi
  # shellcheck disable=SC2064
  trap "chmod -R u+rwX '$iso' 2>/dev/null; rm -rf '$iso' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM
  local cli; cli=$(_cli_cmd)
  local train_out train_rc
  train_out=$(cd "$iso" && NPM_CONFIG_REGISTRY="${REGISTRY:-}" timeout 30 $cli neural train --iterations 1 2>&1)
  train_rc=$?
  # Strict behavior assertion: training must report completion + metrics.
  # Matches the "Training complete: N epochs" + "Patterns Recorded" output shape.
  if echo "$train_out" | grep -qE 'Training complete|Patterns Recorded' \
     && echo "$train_out" | grep -qi 'epochs\|patterns'; then
    _CHECK_PASSED="true"
    local epochs; epochs=$(echo "$train_out" | grep -oE '[0-9]+ epochs' | head -1)
    _CHECK_OUTPUT="P7/neural_dir: \`neural train\` completed (${epochs:-metrics emitted}); dir is vestigial (neural state lives in AgentDB)"
    return
  fi
  _CHECK_OUTPUT="P7/neural_dir: \`neural train\` did not complete (rc=$train_rc): $(echo "$train_out" | tail -5 | tr '\n' ' ')"
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

# Check 8: .claude/settings.json — strict on hooks+permissions, skip_accepted on mcpServers
# Probed against `@sparkleideas/cli@latest` (2026-04-18, A12): `init --full` writes
# `.claude/settings.json` with `permissions` (hook handlers, tool allowlists) and a
# `hooks` key, but never `mcpServers`. MCP servers are registered out-of-band by the
# Claude Code CLI via `claude mcp add …` (writes to `~/.claude.json` user config, or
# adds an `mcpServers` key to this file on demand) — no sibling `.mcp.json` is produced
# by ruflo/cli `init --full`.
#
# We STRICTLY enforce `permissions` (parse + presence) and `hooks` (presence) — they
# are the init-time contract. `mcpServers` remains skip_accepted because it is a
# user-driven addition not part of the init template. If `claude mcp add` has run
# and populated the key, we upgrade to strict pass with the addendum.
check_adr0094_p7_settings_json() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  # Strict: `permissions` AND `hooks` must both be present and JSON must parse.
  _p7_validate_json_file ".claude/settings.json" "permissions,hooks" "settings_json"
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    return
  fi
  local target="${E2E_DIR}/.claude/settings.json"
  local has_mcp; has_mcp=$(node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log("mcpServers" in j && j.mcpServers != null ? "YES" : "NO");
    } catch { console.log("NO"); }
  ' "$target" 2>&1)
  if [[ "$has_mcp" == "YES" ]]; then
    _CHECK_OUTPUT="${_CHECK_OUTPUT} + mcpServers present (user-added via \`claude mcp add\`)"
    return
  fi
  # permissions + hooks OK (strict pass), mcpServers genuinely absent: downgrade
  # so the user-driven-addition gap stays visible without silent-passing
  # (ADR-0082 / ADR-0090 Tier A2).
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="SKIP_ACCEPTED: P7/settings_json: \`.claude/settings.json\` valid JSON with \`permissions\` + \`hooks\` keys present; \`mcpServers\` is user-driven (added via \`claude mcp add\`, not by \`init --full\`)"
}

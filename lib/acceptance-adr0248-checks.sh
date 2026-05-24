# lib/acceptance-adr0248-checks.sh — ADR-0248 plugin marketplace integrity + honesty.
#
# Wires Batch 3's ADR-0248 (plugin marketplace integrity) trip-wires:
#   1. ruflo-graph-intelligence plugin deletion (directory + marketplace entry).
#   2. Phantom tool references (embeddings_rabitq et al.) removed from ruflo-agentdb.
#   3. ruflo-hook.sh shim adopted in ruflo-core/hooks/hooks.json
#      (replaces direct claude-flow@alpha invocations).
#   4. Cross-plugin marketplace-integrity test passes.
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 3.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"
_PATCH_DIR="/Users/henrik/source/ruflo-patch"

check_adr0248_graph_intelligence_deleted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dir="${_FORK_RUFLO}/plugins/ruflo-graph-intelligence"
  if [[ -d "$dir" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ruflo-graph-intelligence plugin directory still exists at ${dir}"
    return
  fi

  local mp="${_FORK_RUFLO}/.claude-plugin/marketplace.json"
  if [[ ! -f "$mp" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: marketplace.json missing at ${mp}"
    return
  fi

  local hits
  hits=$(grep -c "ruflo-graph-intelligence" "$mp" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ${hits} reference(s) to ruflo-graph-intelligence remain in marketplace.json"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ruflo-graph-intelligence fully deleted (dir absent + 0 marketplace.json refs)"
}

check_adr0248_phantom_tools_removed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local plugin_dir="${_FORK_RUFLO}/plugins/ruflo-agentdb"
  if [[ ! -d "$plugin_dir" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ruflo-agentdb plugin directory missing at ${plugin_dir}"
    return
  fi

  # Count files containing the phantom tool name (excluding 0-hit files).
  local files_with_hits
  files_with_hits=$(grep -rc "embeddings_rabitq" "$plugin_dir" 2>/dev/null | grep -v ":0$" | wc -l | tr -d ' ')
  files_with_hits=${files_with_hits:-0}

  if [[ "$files_with_hits" -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ${files_with_hits} file(s) in ruflo-agentdb still reference phantom tool 'embeddings_rabitq'"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="No 'embeddings_rabitq' phantom-tool references in ruflo-agentdb"
}

check_adr0248_hook_shim_adopted() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local shim="${_FORK_RUFLO}/plugins/ruflo-core/scripts/ruflo-hook.sh"
  if [[ ! -x "$shim" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ruflo-hook.sh missing or not executable at ${shim}"
    return
  fi

  local hooks_json="${_FORK_RUFLO}/plugins/ruflo-core/hooks/hooks.json"
  if [[ ! -f "$hooks_json" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: hooks.json missing at ${hooks_json}"
    return
  fi

  local shim_refs
  shim_refs=$(grep -c "ruflo-hook.sh" "$hooks_json" 2>/dev/null)
  shim_refs=${shim_refs:-0}

  if [[ "$shim_refs" -lt 3 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: hooks.json references ruflo-hook.sh only ${shim_refs} time(s); expected ≥3"
    return
  fi

  local alpha_refs
  alpha_refs=$(grep -c "claude-flow@alpha" "$hooks_json" 2>/dev/null)
  alpha_refs=${alpha_refs:-0}

  if [[ "$alpha_refs" -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: hooks.json still has ${alpha_refs} direct 'claude-flow@alpha' invocation(s); shim adoption incomplete"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ruflo-hook.sh shim adopted (${shim_refs} refs, 0 direct claude-flow@alpha)"
}

check_adr0248_marketplace_lint() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local test_file="${_PATCH_DIR}/tests/pipeline/plugin-marketplace-integrity.test.mjs"
  if [[ ! -f "$test_file" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: plugin-marketplace-integrity.test.mjs missing"
    return
  fi

  local log
  log=$(mktemp /tmp/adr0248-mp-lint-XXXXX.log)
  (cd "$_PATCH_DIR" && timeout 60 node --test tests/pipeline/plugin-marketplace-integrity.test.mjs >"$log" 2>&1)
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail
    tail=$(tail -10 "$log" | tr '\n' ' ' | cut -c1-400)
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: marketplace-integrity test rc=$rc — $tail"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="plugin-marketplace-integrity.test.mjs passed"
}

#!/usr/bin/env bash
# lib/acceptance-adr0117-marketplace-mcp.sh — ADR-0117 marketplace MCP server registration
#
# Verifies the fork's marketplace .claude-plugin/* surface registers MCP
# tools under the `ruflo` key pointing at @sparkleideas/cli@latest, and
# that codemod Pass 5 keeps the surface stable across builds.
#
# Operates on:
#   - forks/ruflo/.claude-plugin/{plugin.json, hooks/hooks.json} (committed state)
#   - /tmp/ruflo-build/.claude-plugin/* (post-codemod state, if available)
#   - forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*.ts (tool name source)

__ADR0117_FORK_DIR=""
_adr0117_resolve_fork() {
  if [[ -n "$__ADR0117_FORK_DIR" ]]; then return; fi
  __ADR0117_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
}

# ════════════════════════════════════════════════════════════════════
# AC #1 — plugin.json has mcpServers.ruflo, no mcpServers."claude-flow"
# ════════════════════════════════════════════════════════════════════

check_adr0117_plugin_json_keys() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0117_resolve_fork

  local pj="${__ADR0117_FORK_DIR}/.claude-plugin/plugin.json"
  if [[ ! -f "$pj" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#1: $pj not found"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local result
  result=$(node -e "
    const fs = require('fs');
    const j = JSON.parse(fs.readFileSync('$pj','utf8'));
    const ms = j.mcpServers || {};
    if (!ms.ruflo) { console.log('NO_RUFLO_KEY'); process.exit(0); }
    if (ms['claude-flow']) { console.log('CLAUDE_FLOW_KEY_STILL_PRESENT'); process.exit(0); }
    const ruflo = ms.ruflo;
    if (ruflo.command !== 'npx') { console.log('WRONG_COMMAND:'+ruflo.command); process.exit(0); }
    const args = (ruflo.args || []).join(' ');
    if (!args.includes('@sparkleideas/cli@latest')) { console.log('WRONG_ARGS:'+args); process.exit(0); }
    console.log('OK:'+args);
  " 2>&1)

  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0117 AC#1: mcpServers.ruflo correctly registered (${result#OK:})"
  else
    _CHECK_OUTPUT="ADR-0117 AC#1 failed: $result"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #2 — zero claude-flow@alpha strings in plugin.json + hooks.json
# ════════════════════════════════════════════════════════════════════

check_adr0117_no_claude_flow_alpha() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0117_resolve_fork

  local pj="${__ADR0117_FORK_DIR}/.claude-plugin/plugin.json"
  local hj="${__ADR0117_FORK_DIR}/.claude-plugin/hooks/hooks.json"

  local hits
  hits=$(grep -lE 'claude-flow@alpha' "$pj" "$hj" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$hits" == "0" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0117 AC#2: zero claude-flow@alpha refs in marketplace surface"
  else
    _CHECK_OUTPUT="ADR-0117 AC#2 failed: $hits files still contain claude-flow@alpha"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #3 — codemod preserves new state in /tmp/ruflo-build/
# ════════════════════════════════════════════════════════════════════

check_adr0117_codemod_preserves() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local build_dir="/tmp/ruflo-build"
  if [[ ! -d "$build_dir/.claude-plugin" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#3 skipped: $build_dir/.claude-plugin not present (build dir not staged)"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local pj="$build_dir/.claude-plugin/plugin.json"
  local hj="$build_dir/.claude-plugin/hooks/hooks.json"

  local result
  result=$(node -e "
    const fs = require('fs');
    if (!fs.existsSync('$pj')) { console.log('NO_PLUGIN_JSON'); process.exit(0); }
    const j = JSON.parse(fs.readFileSync('$pj','utf8'));
    if (!(j.mcpServers||{}).ruflo) { console.log('POST_CODEMOD_NO_RUFLO_KEY'); process.exit(0); }
    const args = (j.mcpServers.ruflo.args||[]).join(' ');
    if (!args.includes('@sparkleideas/cli@latest')) { console.log('POST_CODEMOD_BAD_ARGS:'+args); process.exit(0); }
    console.log('OK');
  " 2>&1)

  if [[ "$result" != "OK" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#3 failed: $result"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Also verify hooks.json post-codemod. NB: per memory reference-grep-c-bash-trap,
  # `grep -c pat || echo 0` produces "0\n0" on no-match — split to a separate
  # default to keep the comparison numeric.
  local hooks_hits
  hooks_hits=$(grep -cE 'claude-flow@alpha' "$hj" 2>/dev/null)
  hooks_hits=${hooks_hits:-0}
  if [[ "$hooks_hits" != "0" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#3 failed: post-codemod hooks.json has $hooks_hits claude-flow@alpha refs"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0117 AC#3: codemod preserves mcpServers.ruflo + zero claude-flow@alpha"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #4 — plugin skill `allowed-tools:` mcp__ruflo__<tool> resolves to a
# tool registered in the fork CLI MCP server source
# ════════════════════════════════════════════════════════════════════

check_adr0117_allowed_tools_resolve() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0117_resolve_fork

  # Pick the hive-mind plugin's advanced skill (depends on ADR-0116 having
  # been materialised, per ADR-0117 §Cross-ADR coupling).
  local skill="${__ADR0117_FORK_DIR}/plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md"
  if [[ ! -f "$skill" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#4 skipped: $skill missing (ADR-0116 not materialised yet)"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Extract suffixes (after `mcp__ruflo__`) from allowed-tools
  local tool_names
  tool_names=$(awk '
    /^---$/ { c++; next }
    c==1 && /^allowed-tools:/ {
      sub(/^allowed-tools: */, "")
      print
    }
  ' "$skill" | grep -oE 'mcp__ruflo__[a-zA-Z0-9_-]+' | sort -u | sed 's/^mcp__ruflo__//')

  if [[ -z "$tool_names" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#4 failed: skill has no mcp__ruflo__ tool refs in allowed-tools"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Walk MCP tool source files and collect registered tool names.
  local tools_dir="${__ADR0117_FORK_DIR}/v3/@claude-flow/cli/src/mcp-tools"
  if [[ ! -d "$tools_dir" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#4 skipped: $tools_dir missing"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # MCP tools are registered with `name: '<tool>'` literal patterns
  local registered
  registered=$(grep -hoE "name: '[a-zA-Z0-9_-]+(_[a-zA-Z0-9-]+)*'" "$tools_dir"/*.ts 2>/dev/null \
    | sed -E "s/^name: '//; s/'$//" | sort -u)

  if [[ -z "$registered" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#4 failed: no MCP tool names extracted from $tools_dir"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # At least one tool referenced by the skill must be registered.
  local matched=0 unmatched=()
  local t
  while IFS= read -r t; do
    if echo "$registered" | grep -qx "$t"; then
      matched=$((matched + 1))
    else
      unmatched+=("$t")
    fi
  done <<< "$tool_names"

  if (( matched > 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0117 AC#4: $matched of $(echo "$tool_names" | wc -l | tr -d ' ') skill tools resolve to MCP server (unmatched: ${#unmatched[@]})"
  else
    _CHECK_OUTPUT="ADR-0117 AC#4 failed: zero skill mcp__ruflo__ refs match registered MCP tools"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #5 — init's emitted .mcp.json must reference @sparkleideas/cli@latest,
# never bare `ruflo@latest` (which would resolve from public npm).
# Closes the gap left by ADR-0117 (which scoped to marketplace surface only).
# ════════════════════════════════════════════════════════════════════

check_adr0117_init_mcp_no_bare_ruflo() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local mcp="${TEMP_DIR}/.mcp.json"
  if [[ ! -f "$mcp" ]]; then
    _CHECK_OUTPUT="ADR-0117 AC#5 failed: $mcp not generated by init --full"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local result
  result=$(node -e "
    const fs = require('fs');
    const j = JSON.parse(fs.readFileSync('$mcp','utf8'));
    const cf = (j.mcpServers || {})['claude-flow'];
    if (!cf) { console.log('NO_CLAUDE_FLOW_KEY'); process.exit(0); }
    const args = (cf.args || []).join(' ');
    if (/\bruflo@(latest|alpha)\b/.test(args)) { console.log('BARE_RUFLO_IN_ARGS:'+args); process.exit(0); }
    if (!args.includes('@sparkleideas/cli@latest')) { console.log('MISSING_SPARKLEIDEAS:'+args); process.exit(0); }
    console.log('OK:'+args);
  " 2>&1)

  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0117 AC#5: init .mcp.json args use @sparkleideas/cli@latest (${result#OK:})"
  else
    _CHECK_OUTPUT="ADR-0117 AC#5 failed: $result"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #6 — init-shipped templates (.claude/{agents,commands,skills})
# must contain zero claude-flow@alpha references. Pass 5 of the codemod
# was expanded (2026-05-03) to cover these init-bundled trees; this check
# enforces that against the user's actual init'd project.
# ════════════════════════════════════════════════════════════════════

check_adr0117_init_templates_no_alpha() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  local total_files=0 total_refs=0
  local subdir_report=""
  for sub in agents commands skills; do
    local dir="${TEMP_DIR}/.claude/${sub}"
    if [[ ! -d "$dir" ]]; then continue; fi

    local files refs
    files=$(grep -rlE 'claude-flow@alpha' "$dir" 2>/dev/null | wc -l | tr -d ' ')
    refs=$(grep -rcE 'claude-flow@alpha' "$dir" 2>/dev/null | awk -F: '{s+=$2} END {print s+0}')
    total_files=$((total_files + files))
    total_refs=$((total_refs + refs))
    subdir_report+=" ${sub}=${files}f/${refs}r"
  done

  if (( total_refs == 0 )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0117 AC#6: init templates clean (.claude/{agents,commands,skills} —${subdir_report:- empty})"
  else
    _CHECK_OUTPUT="ADR-0117 AC#6 failed: $total_files file(s) / $total_refs ref(s) of claude-flow@alpha in init-shipped templates —${subdir_report}"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

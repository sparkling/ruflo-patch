#!/usr/bin/env bash
# lib/acceptance-adr0116-checks.sh — ADR-0116 hive-mind marketplace plugin checks
#
# Verifies the materialised ruflo-hive-mind plugin in forks/ruflo/plugins/.
# Operates on the fork tree directly (marketplace ships from GitHub, not npm).
#
# Pre-check: USERGUIDE substring anchors must resolve in the cached upstream
# USERGUIDE.md. ANCHOR DEVIATIONS FROM ADR-0116 SPEC:
#   - "**Consensus Strategies**" in the spec doesn't exist in upstream;
#     the real anchor is "<summary>🤝 <strong>Consensus Strategies</strong>".
#     We use the real one (ADR-0116 spec was off — log a TODO to update).
#
# Requires: acceptance-harness.sh sourced first; PROJECT_DIR set.

# Resolve once per source. Sourced by test-acceptance.sh.
__ADR0116_FORK_DIR=""
__ADR0116_PLUGIN_DIR=""
__ADR0116_UPSTREAM_USERGUIDE="/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md"

_adr0116_resolve_fork() {
  if [[ -n "$__ADR0116_FORK_DIR" ]]; then return; fi
  __ADR0116_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
  __ADR0116_PLUGIN_DIR="${__ADR0116_FORK_DIR}/plugins/ruflo-hive-mind"
}

# ════════════════════════════════════════════════════════════════════
# Pre-check: USERGUIDE anchors resolve
# ════════════════════════════════════════════════════════════════════

check_adr0116_userguide_anchors() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"

  if [[ ! -f "$__ADR0116_UPSTREAM_USERGUIDE" ]]; then
    _CHECK_OUTPUT="ADR-0116 pre-check: upstream USERGUIDE.md not found at $__ADR0116_UPSTREAM_USERGUIDE"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local missing=()
  local anchors=(
    '<summary>👑 <strong>Hive Mind</strong>'
    '**Queen Types:**'
    '**Worker Specializations (8 types):**'
    '**Consensus Mechanisms:**'
    '<summary>🤝 <strong>Consensus Strategies</strong>'
    '**Collective Memory Types:**'
    '**CLI Commands:**'
  )
  local a
  for a in "${anchors[@]}"; do
    if ! grep -qF -- "$a" "$__ADR0116_UPSTREAM_USERGUIDE"; then
      missing+=("$a")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 USERGUIDE drift: anchors missing — ${missing[*]}"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 USERGUIDE: all 7 anchors resolve"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #1 — marketplace.json lists ruflo-hive-mind
# ════════════════════════════════════════════════════════════════════

check_adr0116_marketplace_entry() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local manifest="${__ADR0116_FORK_DIR}/.claude-plugin/marketplace.json"
  if [[ ! -f "$manifest" ]]; then
    _CHECK_OUTPUT="marketplace.json missing at $manifest"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local result
  result=$(node -e "
    const fs = require('fs'); const path = require('path');
    const m = JSON.parse(fs.readFileSync('$manifest','utf8'));
    const e = (m.plugins||[]).find(p => p.name === 'ruflo-hive-mind');
    if (!e) { console.log('NO_ENTRY'); process.exit(0); }
    const src = path.resolve('${__ADR0116_FORK_DIR}', e.source);
    if (!fs.existsSync(src)) { console.log('SOURCE_MISSING:'+src); process.exit(0); }
    console.log('OK:'+e.source);
  " 2>&1)

  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#1: marketplace lists ruflo-hive-mind (${result#OK:})"
  else
    _CHECK_OUTPUT="ADR-0116 AC#1 failed: $result"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #2 — plugin.json valid; forbidden fields (skills/agents/commands) absent
# ════════════════════════════════════════════════════════════════════

check_adr0116_plugin_json() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local pj="${__ADR0116_PLUGIN_DIR}/.claude-plugin/plugin.json"
  if [[ ! -f "$pj" ]]; then
    _CHECK_OUTPUT="plugin.json missing at $pj"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local result
  result=$(node -e "
    const fs = require('fs');
    let j; try { j = JSON.parse(fs.readFileSync('$pj','utf8')); } catch(e) { console.log('PARSE_ERROR:'+e.message); process.exit(0); }
    for (const f of ['name','description','version']) {
      if (!j[f]) { console.log('MISSING_FIELD:'+f); process.exit(0); }
    }
    for (const f of ['skills','commands','agents']) {
      if (j[f] !== undefined) { console.log('FORBIDDEN_FIELD:'+f); process.exit(0); }
    }
    if (j.name !== 'ruflo-hive-mind') { console.log('WRONG_NAME:'+j.name); process.exit(0); }
    console.log('OK:'+j.version);
  " 2>&1)

  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#2: plugin.json valid (v${result#OK:})"
  else
    _CHECK_OUTPUT="ADR-0116 AC#2 failed: $result"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #3 — both skills present + frontmatter-valid (name/description/allowed-tools)
# ════════════════════════════════════════════════════════════════════

_adr0116_check_yaml_field() {
  # Returns 0 if the file's leading frontmatter contains the named field.
  local file="$1" field="$2"
  awk -v f="$field" '
    NR==1 && $0=="---" { in_fm=1; next }
    in_fm && $0=="---" { exit 1 }
    in_fm && $0 ~ "^"f": " { found=1; exit 0 }
    END { exit found ? 0 : 1 }
  ' "$file"
}

check_adr0116_skills_present() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local missing=() bad_fm=()
  local skills=(hive-mind hive-mind-advanced)
  local s
  for s in "${skills[@]}"; do
    local f="${__ADR0116_PLUGIN_DIR}/skills/${s}/SKILL.md"
    if [[ ! -f "$f" ]]; then
      missing+=("$s")
      continue
    fi
    local field
    for field in name description allowed-tools; do
      if ! _adr0116_check_yaml_field "$f" "$field"; then
        bad_fm+=("$s:$field")
      fi
    done
  done

  if (( ${#missing[@]} > 0 || ${#bad_fm[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#3 failed: missing=[${missing[*]}] bad_fm=[${bad_fm[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#3: 2 skills present with valid frontmatter"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #4 — 16 agents present + frontmatter (name/description/model)
# ════════════════════════════════════════════════════════════════════

check_adr0116_agents_present() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local agents=(
    queen-coordinator collective-intelligence-coordinator scout-explorer
    swarm-memory-manager worker-specialist v3-queen-coordinator
    byzantine-coordinator raft-manager gossip-coordinator crdt-synchronizer
    quorum-manager performance-benchmarker security-manager
    adaptive-coordinator hierarchical-coordinator mesh-coordinator
  )

  local missing=() bad_fm=()
  local a
  for a in "${agents[@]}"; do
    local f="${__ADR0116_PLUGIN_DIR}/agents/${a}.md"
    if [[ ! -f "$f" ]]; then
      missing+=("$a")
      continue
    fi
    local field
    for field in name description model; do
      if ! _adr0116_check_yaml_field "$f" "$field"; then
        bad_fm+=("$a:$field")
      fi
    done
  done

  if (( ${#missing[@]} > 0 || ${#bad_fm[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#4 failed: missing=[${missing[*]}] bad_fm=[${bad_fm[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#4: 16 agents present with valid frontmatter"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #5 — 11 commands present + frontmatter; spawn documents flags
# ════════════════════════════════════════════════════════════════════

check_adr0116_commands_present() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local commands=(
    hive-mind hive-mind-init hive-mind-spawn hive-mind-status
    hive-mind-stop hive-mind-resume hive-mind-memory hive-mind-metrics
    hive-mind-consensus hive-mind-sessions hive-mind-wizard
  )

  local missing=() bad_fm=()
  local c
  for c in "${commands[@]}"; do
    local f="${__ADR0116_PLUGIN_DIR}/commands/${c}.md"
    if [[ ! -f "$f" ]]; then
      missing+=("$c")
      continue
    fi
    local field
    for field in name description; do
      if ! _adr0116_check_yaml_field "$f" "$field"; then
        bad_fm+=("$c:$field")
      fi
    done
  done

  # spawn must document --queen-type and --consensus
  local spawn="${__ADR0116_PLUGIN_DIR}/commands/hive-mind-spawn.md"
  local spawn_issues=""
  if [[ -f "$spawn" ]]; then
    if ! grep -q -- '--queen-type' "$spawn"; then spawn_issues+="no_queen_type "; fi
    if ! grep -q -- '--consensus'  "$spawn"; then spawn_issues+="no_consensus "; fi
  fi

  if (( ${#missing[@]} > 0 || ${#bad_fm[@]} > 0 )) || [[ -n "$spawn_issues" ]]; then
    _CHECK_OUTPUT="ADR-0116 AC#5 failed: missing=[${missing[*]}] bad_fm=[${bad_fm[*]}] spawn=[$spawn_issues]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#5: 11 commands present, spawn documents flags"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #6 — Queen types in skill (Strategic|Tactical|Adaptive)
# ════════════════════════════════════════════════════════════════════

check_adr0116_queen_types() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local skill="${__ADR0116_PLUGIN_DIR}/skills/hive-mind-advanced/SKILL.md"
  local missing=()
  local q
  for q in Strategic Tactical Adaptive; do
    if ! grep -qi "$q" "$skill"; then missing+=("$q"); fi
  done

  # spawn must allow queen-type values (allowed values appear in body)
  local spawn="${__ADR0116_PLUGIN_DIR}/commands/hive-mind-spawn.md"
  local spawn_ok=true
  if ! grep -qi 'strategic' "$spawn" || ! grep -qi 'tactical' "$spawn" || ! grep -qi 'adaptive' "$spawn"; then
    spawn_ok=false
  fi

  if (( ${#missing[@]} > 0 )) || [[ "$spawn_ok" != "true" ]]; then
    _CHECK_OUTPUT="ADR-0116 AC#6 failed: skill_missing=[${missing[*]}] spawn_complete=$spawn_ok"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#6: 3 queen types enumerated in skill + spawn"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #7 — 8 worker types in hive-mind-advanced/SKILL.md
# ════════════════════════════════════════════════════════════════════

check_adr0116_worker_types() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local skill="${__ADR0116_PLUGIN_DIR}/skills/hive-mind-advanced/SKILL.md"
  local missing=()
  local w
  for w in researcher coder analyst tester architect reviewer optimizer documenter; do
    if ! grep -qi "$w" "$skill"; then missing+=("$w"); fi
  done

  if (( ${#missing[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#7 failed: missing worker types=[${missing[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#7: 8 worker types enumerated"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #8 — Consensus protocols (5) + voting modes (3) corpus-wide
# ════════════════════════════════════════════════════════════════════

check_adr0116_consensus_corpus() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local missing_proto=() missing_vote=()
  local p
  for p in Byzantine Raft Gossip CRDT Quorum; do
    if ! grep -rqi "$p" "$__ADR0116_PLUGIN_DIR/skills" "$__ADR0116_PLUGIN_DIR/agents" "$__ADR0116_PLUGIN_DIR/commands"; then
      missing_proto+=("$p")
    fi
  done
  for p in Majority Weighted Byzantine; do
    if ! grep -rqi "$p" "$__ADR0116_PLUGIN_DIR/skills"; then
      missing_vote+=("$p")
    fi
  done

  if (( ${#missing_proto[@]} > 0 || ${#missing_vote[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#8 failed: missing_proto=[${missing_proto[*]}] missing_vote=[${missing_vote[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#8: 5 protocols + 3 voting modes covered in corpus"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #9 — 8 memory types + TTLs in hive-mind-memory.md
# ════════════════════════════════════════════════════════════════════

check_adr0116_memory_types() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local memcmd="${__ADR0116_PLUGIN_DIR}/commands/hive-mind-memory.md"
  if [[ ! -f "$memcmd" ]]; then
    _CHECK_OUTPUT="hive-mind-memory.md missing at $memcmd"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local missing_types=() missing_ttls=()
  local t
  for t in knowledge context task result error metric consensus system; do
    if ! grep -q "\`$t\`" "$memcmd"; then missing_types+=("$t"); fi
  done
  # TTL anchors
  for t in 'permanent' '1h' '30min' '24h'; do
    if ! grep -qi "$t" "$memcmd"; then missing_ttls+=("$t"); fi
  done

  if (( ${#missing_types[@]} > 0 || ${#missing_ttls[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#9 failed: missing_types=[${missing_types[*]}] missing_ttls=[${missing_ttls[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#9: 8 memory types + TTLs enumerated"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #10 — 7 consensus agents shipped
# ════════════════════════════════════════════════════════════════════

check_adr0116_consensus_agents() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local agents=(
    byzantine-coordinator raft-manager gossip-coordinator
    crdt-synchronizer quorum-manager performance-benchmarker
    security-manager
  )
  local missing=()
  local a
  for a in "${agents[@]}"; do
    if [[ ! -f "${__ADR0116_PLUGIN_DIR}/agents/${a}.md" ]]; then missing+=("$a"); fi
  done

  if (( ${#missing[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#10 failed: missing consensus agents=[${missing[*]}]"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#10: 7 consensus agents shipped"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #11 — CLI command coverage from USERGUIDE block + stop separately
# ════════════════════════════════════════════════════════════════════

check_adr0116_cli_command_coverage() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  # 6 commands named in **CLI Commands:** block
  local block_commands=(
    hive-mind-init hive-mind-spawn hive-mind-status
    hive-mind-metrics hive-mind-memory hive-mind-sessions
  )
  local missing=()
  local c
  for c in "${block_commands[@]}"; do
    if [[ ! -f "${__ADR0116_PLUGIN_DIR}/commands/${c}.md" ]]; then missing+=("$c"); fi
  done

  # stop command separately (per its anchor in §Hive-Mind Coordination)
  local stop="${__ADR0116_PLUGIN_DIR}/commands/hive-mind-stop.md"
  local stop_ok=true
  if [[ ! -f "$stop" ]] || ! grep -q 'hive-mind stop' "$stop"; then
    stop_ok=false
  fi

  if (( ${#missing[@]} > 0 )) || [[ "$stop_ok" != "true" ]]; then
    _CHECK_OUTPUT="ADR-0116 AC#11 failed: missing=[${missing[*]}] stop_ok=$stop_ok"
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#11: 6 USERGUIDE commands + stop covered"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #12 — codemod applied (zero @claude-flow/cli@latest, zero mcp__claude-flow__)
# ════════════════════════════════════════════════════════════════════

check_adr0116_codemod_applied() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local hits1 hits2 hits3
  hits1=$(grep -rE '@claude-flow/cli@latest' "$__ADR0116_PLUGIN_DIR" 2>/dev/null | wc -l | tr -d ' ')
  hits2=$(grep -rE 'mcp__claude-flow__' "$__ADR0116_PLUGIN_DIR" 2>/dev/null | wc -l | tr -d ' ')
  hits3=$(grep -rE '\bclaude-flow@alpha\b' "$__ADR0116_PLUGIN_DIR" 2>/dev/null | wc -l | tr -d ' ')

  if [[ "$hits1" == "0" && "$hits2" == "0" && "$hits3" == "0" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#12: codemod fully applied (0 leaks)"
  else
    _CHECK_OUTPUT="ADR-0116 AC#12 failed: @claude-flow/cli=$hits1 mcp__claude-flow__=$hits2 claude-flow@alpha=$hits3"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #14 — drift detector (re-run materialise, diff)
# ════════════════════════════════════════════════════════════════════

check_adr0116_drift_detector() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local script="${PROJECT_DIR:-.}/lib/build-hive-mind-plugin.sh"
  if [[ ! -x "$script" ]]; then
    _CHECK_OUTPUT="materialise script not executable at $script"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local upstream_dir="${UPSTREAM_DIR:-/Users/henrik/source/ruvnet/ruflo}"
  if [[ ! -d "$upstream_dir" ]]; then
    _CHECK_OUTPUT="upstream not available at $upstream_dir (drift detector skipped)"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  local tmp; tmp=$(mktemp -d -t adr0116-drift-XXXX)

  # Run with FORK_DIR=tmp so it materialises into $tmp/plugins/ruflo-hive-mind/
  if ! FORK_DIR="$tmp" UPSTREAM_DIR="$upstream_dir" bash "$script" >"$tmp/run.log" 2>&1; then
    _CHECK_OUTPUT="materialise script failed: $(tail -1 "$tmp/run.log")"
    rm -rf "$tmp"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  if diff -r "$tmp/plugins/ruflo-hive-mind" "$__ADR0116_PLUGIN_DIR" >"$tmp/diff.log" 2>&1; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#14: drift detector clean (re-materialise = checked-in tree)"
  else
    _CHECK_OUTPUT="ADR-0116 AC#14 DRIFT: $(head -5 "$tmp/diff.log")"
  fi
  rm -rf "$tmp"
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #15 — README contains gap matrix with one row per ⚠/✗ matrix entry
# ════════════════════════════════════════════════════════════════════

# Helper: parse ADR-0118 §Status table → list of "active" Tns (one per line).
# Active = status NOT `complete` (i.e. open | in-progress | escalated-to-adr).
_adr0116_active_tns() {
  local adr0118="${PROJECT_DIR:-.}/docs/adr/ADR-0118-hive-mind-runtime-gaps-tracker.md"
  [[ -f "$adr0118" ]] || return 0
  awk '
    /^##[[:space:]]+Status[[:space:]]*$/ { in_s=1; next }
    in_s && /^##[[:space:]]/ { in_s=0 }
    in_s && /^\|[[:space:]]*T[0-9]+[[:space:]]*\|/ {
      # Columns: | Tn | ADR | status | owner | commit | annotation |
      gsub(/[[:space:]]+/, "", $0)
      n = split($0, c, "|")
      tn = c[2]; status = c[4]
      if (tn ~ /^T[0-9]+$/ && status != "complete") {
        print tn
      }
    }
  ' "$adr0118"
}

check_adr0116_readme_gap_matrix() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  local readme="${__ADR0116_PLUGIN_DIR}/README.md"
  if [[ ! -f "$readme" ]]; then
    _CHECK_OUTPUT="README.md missing"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  if ! grep -q '## Known gaps vs. USERGUIDE' "$readme"; then
    _CHECK_OUTPUT="README missing '## Known gaps vs. USERGUIDE' section"
    end_ns=$(_ns); _EXIT=1; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Source-of-truth for expected row count: ADR-0118 §Status non-complete rows.
  local expected_count
  expected_count=$(_adr0116_active_tns | wc -l | tr -d ' ')
  expected_count="${expected_count:-0}"

  local row_count
  row_count=$(grep -cE '^\| .* \| (✗|⚠) .* \| .* \| ADR-0118 T[0-9]+ \|$' "$readme")
  row_count="${row_count:-0}"

  if [[ "$row_count" != "$expected_count" ]]; then
    _CHECK_OUTPUT="ADR-0116 AC#15 failed: gap matrix rows=$row_count, expected=$expected_count (from ADR-0118 §Status)"
  elif [[ "$expected_count" == "0" ]]; then
    # All complete — README must affirm that. The materialise script writes
    # an "all complete" sentence in this state.
    if grep -q 'every tracked task as `complete`' "$readme"; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0116 AC#15: 0 active gaps (all complete sentence present)"
    else
      _CHECK_OUTPUT="ADR-0116 AC#15: 0 active Tns but README missing 'all complete' sentence"
    fi
  else
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0116 AC#15: README has $row_count gap tracker rows ($expected_count expected)"
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# AC #16 — per-command implementation-status frontmatter
# ════════════════════════════════════════════════════════════════════

check_adr0116_command_frontmatter() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _adr0116_resolve_fork

  # Per-command Tn dependencies (matches _command_tn_map in build script).
  declare -A tn_map
  tn_map[hive-mind-consensus.md]="T1 T2 T3"
  tn_map[hive-mind-memory.md]="T4 T5"
  tn_map[hive-mind-sessions.md]="T6"
  tn_map[hive-mind-resume.md]="T6"

  # Per-command verdict (ADR-0116 verification matrix: consensus/memory =
  # partial, sessions/resume = missing). Used IFF any of the file's Tns
  # is still active in ADR-0118 §Status.
  declare -A want_verdict
  want_verdict[hive-mind-consensus.md]=partial
  want_verdict[hive-mind-memory.md]=partial
  want_verdict[hive-mind-sessions.md]=missing
  want_verdict[hive-mind-resume.md]=missing

  # Compute the set of active Tns from ADR-0118 once.
  local active_tns
  active_tns=$(_adr0116_active_tns | tr '\n' ' ')

  _is_active() {
    local needle="$1"
    [[ " $active_tns " == *" $needle "* ]]
  }

  local issues=()
  local file
  for file in "${!tn_map[@]}"; do
    local f="${__ADR0116_PLUGIN_DIR}/commands/${file}"
    if [[ ! -f "$f" ]]; then issues+=("missing:$file"); continue; fi

    # Is any of this file's Tns still active?
    local any_active=0 t
    for t in ${tn_map[$file]}; do
      if _is_active "$t"; then any_active=1; break; fi
    done

    local got_status
    got_status=$(awk '/^---$/{c++; next} c==1 && /^implementation-status:/ {sub(/^implementation-status: */,""); print; exit}' "$f")
    local got_tracker
    got_tracker=$(awk '/^---$/{c++; next} c==1 && /^gap-tracker:/ {sub(/^gap-tracker: */,""); print; exit}' "$f")

    if (( any_active )); then
      # Field MUST be present and match the expected verdict (or `implemented`
      # if a partial closure has lifted some but not all Tns).
      local want="${want_verdict[$file]}"
      if [[ -z "$got_status" ]]; then
        issues+=("$file:expected_status=$want_got=missing-field")
      elif [[ "$got_status" != "$want" && "$got_status" != "implemented" ]]; then
        issues+=("$file:got=$got_status:want=$want")
      fi
      if [[ ! "$got_tracker" =~ ADR-0118-T ]]; then
        issues+=("$file:no_gap_tracker_or_empty")
      fi
    else
      # All listed Tns complete → annotation MUST be lifted.
      if [[ -n "$got_status" ]]; then
        issues+=("$file:annotation_should_be_lifted_but_status=$got_status")
      fi
      if [[ -n "$got_tracker" ]]; then
        issues+=("$file:annotation_should_be_lifted_but_gap_tracker_present")
      fi
    fi
  done

  if (( ${#issues[@]} > 0 )); then
    _CHECK_OUTPUT="ADR-0116 AC#16 failed: ${issues[*]}"
  else
    if [[ -z "$active_tns" ]] || [[ "$active_tns" == " " ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0116 AC#16: all 4 annotations lifted (0 active Tns in ADR-0118)"
    else
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0116 AC#16: 4 commands carry expected implementation-status + gap-tracker (active Tns: $active_tns)"
    fi
  fi
  end_ns=$(_ns); _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

# ════════════════════════════════════════════════════════════════════
# Note: AC #13 (E2E install via `claude --bare --plugin-dir`) is NOT
# implemented as a parallel check. Requires interactive `claude` CLI
# auth + outbound network and is unsuitable for the parallel acceptance
# wave. To run manually:
#   FORK=/Users/henrik/source/forks/ruflo
#   claude --bare --plugin-dir "$FORK/plugins/ruflo-hive-mind" \
#     -p "/help" 2>&1 | grep -E "/hive-mind"
# ════════════════════════════════════════════════════════════════════

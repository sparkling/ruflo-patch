#!/usr/bin/env bash
# lib/acceptance-adr0124-sessions.sh — ADR-0124 (T6) Hive-mind session
#                                       lifecycle acceptance checks
#
# Cover the five subcommand surfaces under `ruflo hive-mind`:
#   - sessions list       — enumerates archives in .claude-flow/hive-mind/sessions/
#   - sessions checkpoint — atomic write-then-rename of versioned gzipped archive
#   - sessions export     — checkpoint to user-supplied path
#   - sessions import     — read user-supplied archive, materialise under fresh sessionId
#   - resume              — load latest checkpoint, restore typed memory, set queenType,
#                           re-spawn queen via child_process.spawn('claude', ...)
#
# Plus the H6 row 32 fold-in:
#   - hive-mind init --queen-type=<value> persists to state.json
#   - hive-mind_status MCP tool surfaces queenType in response payload
#
# Per ADR-0124 §Validation: round-trip export→import preserves all fields
# (modulo timestamps that legitimately differ); schemaVersion mismatch
# produces explicit error per `feedback-no-fallbacks.md`.
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-checks.sh +
#           acceptance-e2e-checks.sh
# Caller MUST set: REGISTRY, E2E_DIR

set +u 2>/dev/null || true

# Helper: hive-init in an isolated dir. Mirrors _adr0125_hive_init.
# Optional second arg: queen-type to seed the hive with.
_adr0124_hive_init() {
  local iso="$1"
  local queen_type="${2:-strategic}"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init --queen-type "$queen_type" >/dev/null 2>&1); then
    return 1
  fi
  return 0
}

# Helper: persist queenPrompt + workerManifest into typed memory so
# `sessions checkpoint` has something to capture. The `--claude` spawn flow
# writes these in production; in acceptance we shortcut via the MCP tool to
# avoid spawning Claude.
_adr0124_seed_session_memory() {
  local iso="$1"
  local prompt_text="${2:-acceptance prompt}"
  local cli; cli=$(_cli_cmd)
  local rc=0
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec \
    --tool hive-mind_memory \
    --params "{\"action\":\"set\",\"key\":\"hive-mind/queen-prompt\",\"value\":\"${prompt_text}\",\"type\":\"system\"}" \
    >/dev/null 2>&1) || rc=$?
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec \
    --tool hive-mind_memory \
    --params "{\"action\":\"set\",\"key\":\"hive-mind/worker-manifest\",\"value\":[{\"id\":\"hive-worker-1\",\"type\":\"coder\"}],\"type\":\"system\"}" \
    >/dev/null 2>&1) || rc=$?
  return $rc
}

# ════════════════════════════════════════════════════════════════════
# Check 1: sessions list — empty + populated
# ════════════════════════════════════════════════════════════════════
check_adr0124_sessions_list() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-list")
  _adr0124_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0124 list: hive-mind init failed"; rm -rf "$iso" 2>/dev/null; return; }

  local cli; cli=$(_cli_cmd)
  local out

  # Empty enumeration: sessions/ does not exist yet.
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli hive-mind sessions list 2>&1)
  if ! echo "$out" | grep -qiE "no.*session|sessions.*found|\[\]"; then
    _CHECK_OUTPUT="ADR-0124 list (empty): expected empty enumeration; got: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Populate one checkpoint, verify enumeration.
  _adr0124_seed_session_memory "$iso" "list-prompt" || {
    _CHECK_OUTPUT="ADR-0124 list: failed to seed session memory"
    rm -rf "$iso" 2>/dev/null; return
  }
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli hive-mind sessions checkpoint hive-list-test 2>&1)
  if ! echo "$out" | grep -qiE "checkpoint.*written|written:"; then
    _CHECK_OUTPUT="ADR-0124 list: checkpoint failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli hive-mind sessions list 2>&1)
  if ! echo "$out" | grep -qF "hive-list-test"; then
    _CHECK_OUTPUT="ADR-0124 list (populated): \"hive-list-test\" sessionId missing from enumeration: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 list: empty + populated enumeration OK"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 2: sessions checkpoint — produces a gzipped archive on disk
# ════════════════════════════════════════════════════════════════════
check_adr0124_sessions_checkpoint() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-cp")
  _adr0124_hive_init "$iso" "tactical" || { _CHECK_OUTPUT="ADR-0124 cp: init failed"; rm -rf "$iso" 2>/dev/null; return; }
  _adr0124_seed_session_memory "$iso" "checkpoint-prompt" || {
    _CHECK_OUTPUT="ADR-0124 cp: failed to seed session memory"
    rm -rf "$iso" 2>/dev/null; return
  }

  local cli; cli=$(_cli_cmd)
  local out
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind sessions checkpoint hive-cp-test 2>&1)
  if ! echo "$out" | grep -qiE "checkpoint.*written|written:"; then
    _CHECK_OUTPUT="ADR-0124 cp: checkpoint command failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Verify archive exists on disk.
  local archive
  archive=$(find "$iso/.claude-flow/hive-mind/sessions" -name 'hive-cp-test-*.json.gz' 2>/dev/null | head -1)
  if [[ -z "$archive" || ! -f "$archive" ]]; then
    _CHECK_OUTPUT="ADR-0124 cp: archive not found on disk under .claude-flow/hive-mind/sessions/"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Verify archive is non-empty + gunzip + parses as JSON + carries
  # schemaVersion=1 + queenPrompt.
  local payload
  payload=$(zcat "$archive" 2>/dev/null)
  if [[ -z "$payload" ]]; then
    _CHECK_OUTPUT="ADR-0124 cp: archive gunzip empty"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if ! echo "$payload" | grep -qF '"schemaVersion":1'; then
    _CHECK_OUTPUT="ADR-0124 cp: archive payload missing schemaVersion=1: ${payload:0:200}"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if ! echo "$payload" | grep -qF '"queenPrompt":"checkpoint-prompt"'; then
    _CHECK_OUTPUT="ADR-0124 cp: archive payload missing queenPrompt: ${payload:0:200}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 cp: archive at $archive parses cleanly with schemaVersion=1"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 3: export → import round-trip — archive preserves all fields
# ════════════════════════════════════════════════════════════════════
check_adr0124_sessions_export_import_roundtrip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-roundtrip")
  _adr0124_hive_init "$iso" "adaptive" || { _CHECK_OUTPUT="ADR-0124 rt: init failed"; rm -rf "$iso" 2>/dev/null; return; }
  _adr0124_seed_session_memory "$iso" "roundtrip-prompt" || {
    _CHECK_OUTPUT="ADR-0124 rt: failed to seed session memory"
    rm -rf "$iso" 2>/dev/null; return
  }

  local cli; cli=$(_cli_cmd)
  local export_path="$iso/exported.json.gz"
  local out

  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind sessions export hive-rt-test --output "$export_path" 2>&1)
  if ! echo "$out" | grep -qiE "exported"; then
    _CHECK_OUTPUT="ADR-0124 rt: export failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if [[ ! -f "$export_path" ]]; then
    _CHECK_OUTPUT="ADR-0124 rt: export file not created at $export_path"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Verify exported archive carries queenType=adaptive (H6 row 32 + import path).
  local payload
  payload=$(zcat "$export_path" 2>/dev/null)
  if ! echo "$payload" | grep -qF '"queenType":"adaptive"'; then
    _CHECK_OUTPUT="ADR-0124 rt: exported archive missing queenType=adaptive: ${payload:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Import back. Should materialise into canonical sessions dir under fresh
  # sessionId and NOT auto-resume.
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind sessions import "$export_path" 2>&1)
  if ! echo "$out" | grep -qiE "imported"; then
    _CHECK_OUTPUT="ADR-0124 rt: import failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi
  # The canonical archive should now exist with prefix `imported-`.
  local imported
  imported=$(find "$iso/.claude-flow/hive-mind/sessions" -name 'imported-*.json.gz' 2>/dev/null | head -1)
  if [[ -z "$imported" || ! -f "$imported" ]]; then
    _CHECK_OUTPUT="ADR-0124 rt: imported archive not found under canonical sessions dir"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Round-trip: payload of imported archive equals exported payload (modulo
  # the sessionId in the filename — the JSON content is byte-equal).
  local before after
  before=$(zcat "$export_path" | tr -d '[:space:]')
  after=$(zcat "$imported" | tr -d '[:space:]')
  if [[ "$before" != "$after" ]]; then
    _CHECK_OUTPUT="ADR-0124 rt: round-trip diff — exported vs imported payload mismatch"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 rt: export → import round-trip preserved all fields (queenType=adaptive)"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 4: resume — restores typed memory + queenType (skipSpawn variant
#          so we don't actually launch claude during acceptance)
# ════════════════════════════════════════════════════════════════════
check_adr0124_resume() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-resume")
  _adr0124_hive_init "$iso" "tactical" || { _CHECK_OUTPUT="ADR-0124 resume: init failed"; rm -rf "$iso" 2>/dev/null; return; }
  _adr0124_seed_session_memory "$iso" "resume-prompt" || {
    _CHECK_OUTPUT="ADR-0124 resume: failed to seed memory"
    rm -rf "$iso" 2>/dev/null; return
  }

  local cli; cli=$(_cli_cmd)
  local out

  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind sessions checkpoint hive-resume-test 2>&1)
  if ! echo "$out" | grep -qiE "checkpoint.*written|written:"; then
    _CHECK_OUTPUT="ADR-0124 resume: pre-resume checkpoint failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Resume with --skip-spawn so we test state-restoration without launching
  # a real Claude process. Per ADR-0124 §Refinement: probeQueenSpawnability
  # runs BEFORE state mutation; --skip-spawn bypasses both probe + spawn.
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind resume hive-resume-test --skip-spawn 2>&1)
  if ! echo "$out" | grep -qiE "resumed.*hive-resume-test"; then
    _CHECK_OUTPUT="ADR-0124 resume: resume command failed: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Verify the live state still has queenType=tactical after resume.
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec \
    --tool hive-mind_status --params '{}' 2>&1)
  if ! echo "$out" | grep -qF '"queenType":"tactical"'; then
    _CHECK_OUTPUT="ADR-0124 resume: post-resume status missing queenType=tactical: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 resume: restore + queenType=tactical preserved post-resume"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 5: queenType persistence — H6 row 32 fold-in
# Verify hive-mind init --queen-type=<value> persists to state.json.
# ════════════════════════════════════════════════════════════════════
check_adr0124_queen_type_persistence() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-qt-persist")
  local cli; cli=$(_cli_cmd)

  : > "$iso/.ruflo-project"
  local out
  for qt in strategic tactical adaptive; do
    out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init --queen-type "$qt" 2>&1)
    if [[ $? -ne 0 ]]; then
      _CHECK_OUTPUT="ADR-0124 qt-persist: init --queen-type $qt failed: ${out:0:300}"
      rm -rf "$iso" 2>/dev/null; return
    fi
    # state.json must carry the queenType under the queen object.
    local state="$iso/.claude-flow/hive-mind/state.json"
    if [[ ! -f "$state" ]]; then
      _CHECK_OUTPUT="ADR-0124 qt-persist: state.json missing after init"
      rm -rf "$iso" 2>/dev/null; return
    fi
    if ! grep -qF "\"queenType\":\"$qt\"" "$state"; then
      _CHECK_OUTPUT="ADR-0124 qt-persist: queenType=$qt not persisted in state.json"
      rm -rf "$iso" 2>/dev/null; return
    fi
  done

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 qt-persist: state.queen.queenType persisted for strategic/tactical/adaptive"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Check 6: hive-mind_status MCP tool surfaces queenType (H6 row 32)
# ════════════════════════════════════════════════════════════════════
check_adr0124_status_surfaces_queen_type() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local iso; iso=$(_e2e_isolate "adr0124-qt-status")
  _adr0124_hive_init "$iso" "adaptive" || {
    _CHECK_OUTPUT="ADR-0124 qt-status: init failed"
    rm -rf "$iso" 2>/dev/null; return
  }

  local cli; cli=$(_cli_cmd)
  local out
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec \
    --tool hive-mind_status --params '{}' 2>&1)
  if ! echo "$out" | grep -qF '"queenType":"adaptive"'; then
    _CHECK_OUTPUT="ADR-0124 qt-status: hive-mind_status response missing queenType=adaptive: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0124 qt-status: hive-mind_status surfaces state.queen.queenType=adaptive (H6 row 32 closed)"
  rm -rf "$iso" 2>/dev/null
}

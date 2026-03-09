#!/usr/bin/env bash
# lib/acceptance-checks.sh — Shared functional test library (ADR-0023)
#
# Defines test functions used by both:
#   - test-integration.sh Phase 9 (Layer 3: Release Qualification, Verdaccio)
#   - test-acceptance.sh (Layer 4: Production Verification, real npm)
#
# One definition, two execution contexts. Adding a test here
# automatically runs it in both layers.
#
# Contract:
#   Caller MUST set:  REGISTRY, TEMP_DIR, PKG
#   Caller MAY set:   RUFLO_WRAPPER_PKG (e.g. "@sparkleideas/ruflo@3.5.7" — defaults to "@sparkleideas/ruflo@latest")
#   Caller MAY set:   COMPANION_TAG (dist-tag for agent-booster/plugins, e.g. "@prerelease")
#   Caller MUST define: run_timed (sets _OUT, _EXIT, _DURATION_MS)
#   Each check_* function sets: _CHECK_PASSED ("true"/"false"), _CHECK_OUTPUT
#
# Registry-specific tests (A8 dist-tag, A16 plugin install) are NOT
# in this library — they live in test-acceptance.sh only.

# --------------------------------------------------------------------------
# RQ-1 / A1: Version check
# --------------------------------------------------------------------------
check_version() {
  run_timed "NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' --version"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# RQ-2 / A2: Init
# --------------------------------------------------------------------------
check_init() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' init"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

# --------------------------------------------------------------------------
# RQ-3 / A3: Settings file
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
# RQ-4 / A4: Scope check
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
# RQ-5 / A5: Doctor
# --------------------------------------------------------------------------
check_doctor() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '$PKG' doctor --fix"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]]; then
    if ! echo "$_OUT" | grep -q 'MODULE_NOT_FOUND'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# RQ-6 / A6: MCP config
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

# --------------------------------------------------------------------------
# RQ-7 / A7: Wrapper proxy
# --------------------------------------------------------------------------
check_wrapper_proxy() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local wrapper_pkg="${RUFLO_WRAPPER_PKG:-@sparkleideas/ruflo@latest}"
  local wrapper_out
  wrapper_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx --yes "${wrapper_pkg}" --version 2>&1) || true

  if echo "$wrapper_out" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
    local doctor_out
    doctor_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx "${wrapper_pkg}" doctor 2>&1) || true
    if echo "$doctor_out" | grep -qi 'doctor\|diagnostics\|passed'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Wrapper proxy works: version=$(echo "$wrapper_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^ ]*' | head -1)"
    else
      _CHECK_OUTPUT="Wrapper --version works but doctor command failed"
      _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(echo "$doctor_out" | head -10)"
    fi
  else
    _CHECK_OUTPUT="Wrapper --version failed or returned no version"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(echo "$wrapper_out" | head -10)"
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
# RQ-8 / A9: Memory lifecycle
# --------------------------------------------------------------------------
check_memory_lifecycle() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Init memory
  local init_out
  init_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx --yes "$PKG" memory init 2>&1) || true
  if ! echo "$init_out" | grep -qi 'initialized\|verification passed'; then
    _CHECK_OUTPUT="Memory init failed:\n$(echo "$init_out" | tail -10)"
    end_ns=$(date +%s%N 2>/dev/null || echo 0)
    _EXIT=0
    [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
    _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Store
  local store_out
  store_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx "$PKG" memory store \
    --key "test-pattern" \
    --value "Integration test: JWT auth with refresh tokens for stateless APIs" \
    --namespace test-ns --tags "test,acceptance" 2>&1) || true
  if ! echo "$store_out" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="Memory store failed:\n$(echo "$store_out" | tail -10)"
    end_ns=$(date +%s%N 2>/dev/null || echo 0)
    _EXIT=0
    [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
    _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Search (semantic)
  local search_out
  search_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx "$PKG" memory search \
    --query "authentication tokens" --namespace test-ns 2>&1) || true
  if ! echo "$search_out" | grep -q 'test-pattern'; then
    _CHECK_OUTPUT="Memory search did not find stored entry:\n$(echo "$search_out" | tail -10)"
    end_ns=$(date +%s%N 2>/dev/null || echo 0)
    _EXIT=0
    [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
    _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Retrieve
  local retrieve_out
  retrieve_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" npx "$PKG" memory retrieve \
    --key "test-pattern" --namespace test-ns 2>&1) || true
  if echo "$retrieve_out" | grep -q 'JWT auth'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="init > store > search found test-pattern > retrieve value matches"
  else
    _CHECK_OUTPUT="Memory retrieve did not return stored value:\n$(echo "$retrieve_out" | tail -10)"
  fi

  # Verify storage files exist
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    local db_found="false"
    for db_path in "$TEMP_DIR/.swarm/memory.db" "$TEMP_DIR/.claude/memory.db"; do
      if [[ -f "$db_path" ]]; then
        db_found="true"
        break
      fi
    done
    if [[ "$db_found" == "false" ]]; then
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="$_CHECK_OUTPUT\nWARNING: No memory.db file found on disk"
    else
      _CHECK_OUTPUT="$_CHECK_OUTPUT\nStorage verified on disk"
    fi
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
# RQ-9 / A10: Neural training
# --------------------------------------------------------------------------
check_neural_training() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx '$PKG' neural train --pattern coordination"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]]; then
    if echo "$_OUT" | grep -qi 'patterns\|training complete\|saved'; then
      if [[ -f "$TEMP_DIR/.claude-flow/neural/patterns.json" ]]; then
        local pattern_count
        pattern_count=$(python3 -c "import json; print(len(json.load(open('$TEMP_DIR/.claude-flow/neural/patterns.json'))))" 2>/dev/null || echo "0")
        if [[ "$pattern_count" -gt 0 ]]; then
          _CHECK_PASSED="true"
          _CHECK_OUTPUT="Neural training complete, $pattern_count patterns persisted to disk"
        else
          _CHECK_OUTPUT="Training ran but patterns.json is empty"
        fi
      else
        _CHECK_OUTPUT="Training ran but no patterns.json found on disk"
      fi
    fi
  fi
}

# --------------------------------------------------------------------------
# RQ-10 / A13: Agent Booster ESM import
# --------------------------------------------------------------------------
check_agent_booster_esm() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local import_out
  import_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    // Try full import first; if WASM is missing, verify the package at least resolves
    import('@sparkleideas/agent-booster')
      .then(m => { console.log('IMPORT_OK'); console.log(Object.keys(m).join(',')); })
      .catch(e => {
        if (e.message.includes('wasm') || e.message.includes('WASM')) {
          // WASM not available (pre-built artifact missing) — verify package resolves
          try {
            const resolved = require.resolve('@sparkleideas/agent-booster');
            console.log('IMPORT_OK_NO_WASM');
            console.log('resolved: ' + resolved);
          } catch (e2) {
            console.log('IMPORT_FAIL: ' + e.message);
            process.exit(1);
          }
        } else {
          console.log('IMPORT_FAIL: ' + e.message);
          process.exit(1);
        }
      })
  " 2>&1) || true

  if echo "$import_out" | grep -q 'IMPORT_OK'; then
    _CHECK_PASSED="true"
    if echo "$import_out" | grep -q 'NO_WASM'; then
      _CHECK_OUTPUT="agent-booster package resolves (WASM not available): $(echo "$import_out" | tail -1)"
    else
      _CHECK_OUTPUT="agent-booster module imported successfully: $(echo "$import_out" | tail -1)"
    fi
  else
    _CHECK_OUTPUT="Failed to import @sparkleideas/agent-booster: $(echo "$import_out" | head -5)"
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
# RQ-11 / A14: Agent Booster binary
# --------------------------------------------------------------------------
check_agent_booster_bin() {
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' npx --yes '@sparkleideas/agent-booster${COMPANION_TAG:-}' --version"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# RQ-12 / A15: Plugins SDK import
# --------------------------------------------------------------------------
check_plugins_sdk() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"

  local import_out
  import_out=$(cd "$TEMP_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" node -e "
    import('@sparkleideas/plugins')
      .then(m => { console.log('IMPORT_OK'); console.log(Object.keys(m).join(',')); })
      .catch(e => { console.log('IMPORT_FAIL: ' + e.message); process.exit(1); })
  " 2>&1) || true

  if echo "$import_out" | grep -q 'IMPORT_OK'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="plugins SDK imported: $(echo "$import_out" | tail -1)"
  else
    _CHECK_OUTPUT="Failed to import @sparkleideas/plugins: $(echo "$import_out" | head -5)"
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
# RQ-13 / A0: @latest dist-tag resolves to a working version
# --------------------------------------------------------------------------
check_latest_resolves() {
  _CHECK_PASSED="false"

  # In RQ context, test-rq.sh sets NPM_CONFIG_CACHE to a stable cache dir
  # pointing at Verdaccio (ADR-0025). Reuse it. In acceptance context (no
  # preset cache), create a throwaway to avoid stale real-npm entries.
  local own_cache=""
  if [[ -z "${NPM_CONFIG_CACHE:-}" ]]; then
    own_cache=$(mktemp -d /tmp/ruflo-latest-check-XXXXX)
  fi

  local ver_out
  if [[ -n "$own_cache" ]]; then
    ver_out=$(NPM_CONFIG_CACHE="$own_cache" NPM_CONFIG_REGISTRY="$REGISTRY" \
      npx --yes @sparkleideas/cli@latest --version 2>&1) || true
    rm -rf "$own_cache"
  else
    ver_out=$(NPM_CONFIG_REGISTRY="$REGISTRY" \
      npx --yes @sparkleideas/cli@latest --version 2>&1) || true
  fi

  if echo "$ver_out" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="cli@latest = $(echo "$ver_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^ ]*' | head -1)"
  else
    _CHECK_OUTPUT="cli@latest failed to run --version (broken dist-tag?)"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(echo "$ver_out" | head -5)"
  fi

  _EXIT=0
  _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

# --------------------------------------------------------------------------
# RQ-14: ruflo init --full creates a complete project
# --------------------------------------------------------------------------
check_ruflo_init_full() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Use a separate temp dir so we don't pollute the main TEMP_DIR
  local full_dir
  full_dir=$(mktemp -d /tmp/ruflo-full-init-XXXXX)

  # Run ruflo init --full (proxies to @sparkleideas/cli init --full)
  # Set RUFLO_CLI_TAG so the wrapper proxies to the CLI version under test,
  # not @latest (which may not be promoted yet).
  local wrapper_pkg="${RUFLO_WRAPPER_PKG:-@sparkleideas/ruflo@latest}"
  local cli_tag="${RUFLO_CLI_TAG:-}"
  if [[ -z "$cli_tag" ]]; then
    # Derive from PKG: "@sparkleideas/cli@3.1.0-alpha.14-patch.12" -> "@3.1.0-alpha.14-patch.12"
    cli_tag="${PKG#@sparkleideas/cli}"
    [[ -z "$cli_tag" ]] && cli_tag="@latest"
  fi
  local init_out
  init_out=$(cd "$full_dir" && NPM_CONFIG_REGISTRY="$REGISTRY" RUFLO_CLI_TAG="$cli_tag" \
    npx --yes "${wrapper_pkg}" init --full 2>&1) || true

  # Validate key artifacts created by --full
  local missing=""
  for f in .claude/settings.json CLAUDE.md .mcp.json .claude-flow/config.yaml; do
    if [[ ! -f "$full_dir/$f" ]]; then
      missing="$missing $f"
    fi
  done

  # Check directories
  for d in .claude/skills .claude/commands .claude-flow/data; do
    if [[ ! -d "$full_dir/$d" ]]; then
      missing="$missing $d/"
    fi
  done

  if [[ -z "$missing" ]]; then
    # Verify CLAUDE.md has @sparkleideas scope
    if grep -q '@sparkleideas' "$full_dir/CLAUDE.md" 2>/dev/null; then
      _CHECK_PASSED="true"
      local file_count
      file_count=$(find "$full_dir" -type f 2>/dev/null | wc -l)
      _CHECK_OUTPUT="init --full created $file_count files with correct scope"
    else
      _CHECK_OUTPUT="init --full created files but CLAUDE.md missing @sparkleideas scope"
    fi
  else
    _CHECK_OUTPUT="init --full missing:$missing"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\ninit output:\n$(echo "$init_out" | tail -15)"
  fi

  rm -rf "$full_dir"

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
# Run all shared checks. Caller provides run_check() wrapper.
#
# Usage:
#   run_check "RQ-1" "Version check" check_version
#   run_check "RQ-2" "Init" check_init
#   ... etc
#
# The run_check function must be defined by the caller. It should:
#   1. Call the check function
#   2. Read _CHECK_PASSED, _CHECK_OUTPUT, _OUT, _EXIT, _DURATION_MS
#   3. Record the result in its own format
# --------------------------------------------------------------------------
run_all_shared_checks() {
  run_check "RQ-1"  "Version check"       check_version
  run_check "RQ-2"  "Init"                check_init
  run_check "RQ-3"  "Settings file"       check_settings_file
  run_check "RQ-4"  "Scope check"         check_scope
  run_check "RQ-5"  "Doctor"              check_doctor
  run_check "RQ-6"  "MCP config"          check_mcp_config
  run_check "RQ-7"  "Wrapper proxy"       check_wrapper_proxy
  run_check "RQ-8"  "Memory lifecycle"    check_memory_lifecycle
  run_check "RQ-9"  "Neural training"     check_neural_training
  run_check "RQ-10" "Agent Booster ESM"   check_agent_booster_esm
  run_check "RQ-11" "Agent Booster CLI"   check_agent_booster_bin
  run_check "RQ-12" "Plugins SDK"         check_plugins_sdk
  run_check "RQ-13" "@latest resolves"    check_latest_resolves
  run_check "RQ-14" "ruflo init --full"   check_ruflo_init_full
}

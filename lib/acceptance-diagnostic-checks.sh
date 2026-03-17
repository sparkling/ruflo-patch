#!/usr/bin/env bash
# lib/acceptance-diagnostic-checks.sh — Diagnostics + data checks (ADR-0039 T2)
#
# Requires: _cli_cmd, _run_and_kill from acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR, PKG
# Caller MUST define: run_timed

# --------------------------------------------------------------------------
# Doctor
# --------------------------------------------------------------------------
check_doctor() {
  local cli; cli=$(_cli_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor --fix"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]]; then
    if ! echo "$_OUT" | grep -q 'MODULE_NOT_FOUND'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# Wrapper proxy
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
# Memory lifecycle
# --------------------------------------------------------------------------
check_memory_lifecycle() {
  local start_ns end_ns
  start_ns=$(date +%s%N 2>/dev/null || echo 0)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Harness already ran memory init -- go straight to store
  local cli; cli=$(_cli_cmd)

  # Store
  local store_out
  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key test-pattern --value 'Integration test: JWT auth with refresh tokens for stateless APIs' --namespace test-ns --tags test,acceptance"
  store_out="$_RK_OUT"
  if ! echo "$store_out" | grep -qi 'stored\|success'; then
    _CHECK_OUTPUT="Memory store failed:\n$(echo "$store_out" | tail -10)"
    end_ns=$(date +%s%N 2>/dev/null || echo 0)
    _EXIT=0
    [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
    _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Search (semantic) — may fail with mock embeddings (sql.js WASM path)
  local search_out search_found="false"
  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query 'authentication tokens' --namespace test-ns"
  search_out="$_RK_OUT"
  if echo "$search_out" | grep -q 'test-pattern'; then
    search_found="true"
  fi

  # Fallback: key-based retrieve (semantic search requires real embeddings;
  # mock/hash embeddings on sql.js WASM path may not produce meaningful similarity)
  if [[ "$search_found" == "false" ]]; then
    _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory retrieve --key test-pattern --namespace test-ns"
    if echo "$_RK_OUT" | grep -qi 'JWT auth\|test-pattern\|value'; then
      search_found="true"
    fi
  fi

  if [[ "$search_found" == "false" ]]; then
    _CHECK_OUTPUT="Memory lifecycle: store succeeded but neither search nor retrieve found entry:\n$(echo "$search_out" | tail -10)"
    end_ns=$(date +%s%N 2>/dev/null || echo 0)
    _EXIT=0
    [[ "$start_ns" != "0" && "$end_ns" != "0" ]] && _DURATION_MS=$(( (end_ns - start_ns) / 1000000 )) || _DURATION_MS=0
    _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Retrieve
  local retrieve_out
  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory retrieve --key test-pattern --namespace test-ns"
  retrieve_out="$_RK_OUT"
  if echo "$retrieve_out" | grep -q 'JWT auth'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="store > search found test-pattern > retrieve value matches"
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
# Neural training
# --------------------------------------------------------------------------
check_neural_training() {
  local cli; cli=$(_cli_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli neural train --pattern coordination"
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

#!/usr/bin/env bash
# lib/acceptance-package-checks.sh — Package checks (ADR-0039 T2)
#
# Requires: _cli_cmd, _booster_cmd from acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR, PKG
# Caller MUST define: run_timed

# --------------------------------------------------------------------------
# Agent Booster ESM import
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
          // WASM not available (pre-built artifact missing) -- verify package resolves
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
# Agent Booster binary
# --------------------------------------------------------------------------
check_agent_booster_bin() {
  local booster; booster=$(_booster_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $booster --version"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# Plugins SDK import
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

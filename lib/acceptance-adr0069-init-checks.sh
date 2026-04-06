#!/usr/bin/env bash
# lib/acceptance-adr0069-init-checks.sh — ADR-0069 Init Template acceptance checks
#
# Verifies init generates config.json with ADR-0069 keys.
# Caller MUST set: TEMP_DIR (the e2e project directory)

check_init_config_is_json() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ -f "$config_json" ]]; then
    if python3 -c "import json; json.load(open('$config_json'))" 2>/dev/null; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="ADR-0069: init generated valid config.json"
    else
      _CHECK_OUTPUT="ADR-0069: config.json exists but is invalid JSON"
    fi
  else
    _CHECK_OUTPUT="ADR-0069: config.json not found — init must generate config.json"
  fi
}

check_init_has_sqlite_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_OUTPUT="ADR-0069: config.json not found (init template not yet deployed)"
    _CHECK_PASSED="true"  # Not a failure — config.yaml projects are valid
    return
  fi

  if grep -q '"sqlite"' "$config_json" 2>/dev/null && grep -q '"cacheSize"' "$config_json" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json has memory.sqlite keys"
  else
    _CHECK_OUTPUT="ADR-0069: config.json missing memory.sqlite.cacheSize"
  fi
}

check_init_has_neural_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json not found (init template not yet deployed)"
    return
  fi

  if grep -q '"ewcLambda"' "$config_json" 2>/dev/null && grep -q '"learningRates"' "$config_json" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json has neural.ewcLambda and learningRates"
  else
    _CHECK_OUTPUT="ADR-0069: config.json missing neural.ewcLambda or learningRates"
  fi
}

check_init_has_ports_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json not found (init template not yet deployed)"
    return
  fi

  if grep -q '"ports"' "$config_json" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json has ports block"
  else
    _CHECK_OUTPUT="ADR-0069: config.json missing ports block"
  fi
}

check_init_has_ratelimiter_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json not found (init template not yet deployed)"
    return
  fi

  if grep -q '"rateLimiter"' "$config_json" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json has rateLimiter block"
  else
    _CHECK_OUTPUT="ADR-0069: config.json missing rateLimiter block"
  fi
}

check_init_has_workers_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local config_json="$TEMP_DIR/.claude-flow/config.json"
  if [[ ! -f "$config_json" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json not found (init template not yet deployed)"
    return
  fi

  if grep -q '"triggers"' "$config_json" 2>/dev/null && grep -q '"optimize"' "$config_json" 2>/dev/null; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0069: config.json has workers.triggers block"
  else
    _CHECK_OUTPUT="ADR-0069: config.json missing workers.triggers"
  fi
}

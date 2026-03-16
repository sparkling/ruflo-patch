#!/usr/bin/env bash
# lib/acceptance-security-checks.sh — Security & reliability checks (ADR-0039 T2)
#
# ADR-0040/0041/0042: Security controllers (D4/D5/D6), composite architecture,
# and wiring remediation fixes in published packages.
#
# Uses dedicated MCP tools (not agentdb_health). No fallback success paths.
#
# Requires: _cli_cmd, _run_and_kill from acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR, PKG

check_security_controllers() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Use agentdb_controllers (registry entries only) — NOT agentdb_health
  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_controllers"
  local ctrl_out="$_RK_OUT"

  if [[ -z "$ctrl_out" ]]; then
    _CHECK_OUTPUT="Security controllers: agentdb_controllers returned no output"
    return
  fi

  # Parse with node via stdin to avoid argv quoting issues with multi-line output
  local result
  result=$(echo "$ctrl_out" | node -e "
    const fs = require('fs');
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    const names = ['resourceTracker', 'rateLimiter', 'circuitBreakerController'];
    const found = [], missing = [], notEnabled = [];
    for (const n of names) {
      if (raw.includes(n)) {
        found.push(n);
        const idx = raw.indexOf(n);
        const slice = raw.substring(idx, idx + 60);
        if (slice.includes('enabled') && slice.includes('false')) {
          notEnabled.push(n);
        }
      } else {
        missing.push(n);
      }
    }
    console.log(found.length + '|' + missing.join(',') + '|' + notEnabled.join(','));
  " 2>/dev/null) || result="0|parse-error|"

  local found missing not_enabled
  found="${result%%|*}"
  result="${result#*|}"
  missing="${result%%|*}"
  not_enabled="${result#*|}"

  if [[ "$found" == "3" && -z "$not_enabled" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Security controllers: all 3 (D4/D5/D6) present and enabled"
  elif [[ "$found" == "3" && -n "$not_enabled" ]]; then
    _CHECK_OUTPUT="Security controllers: 3 present but disabled: ${not_enabled}"
  else
    _CHECK_OUTPUT="Security controllers: $found/3 found, missing: ${missing}"
  fi
}

check_rate_limit_status() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Use dedicated agentdb_rate_limit_status — NOT agentdb_health
  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_rate_limit_status"
  local rl_out="$_RK_OUT"

  if [[ -z "$rl_out" ]]; then
    _CHECK_OUTPUT="Rate limiter: agentdb_rate_limit_status returned no output"
    return
  fi

  if ! echo "$rl_out" | grep -q '"success"'; then
    _CHECK_OUTPUT="Rate limiter: no success field in response"
    return
  fi

  local bucket_count=0 missing_buckets=""
  for bucket in insert search delete batch; do
    if echo "$rl_out" | grep -qi "$bucket"; then
      bucket_count=$((bucket_count + 1))
    else
      missing_buckets="${missing_buckets}${bucket} "
    fi
  done

  if [[ $bucket_count -eq 4 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Rate limiter: all 4 buckets (insert/search/delete/batch) present"
  else
    _CHECK_OUTPUT="Rate limiter: $bucket_count/4 buckets, missing: ${missing_buckets}"
  fi
}

check_circuit_breaker_status() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_circuit_status"
  local cb_out="$_RK_OUT"

  if [[ -z "$cb_out" ]]; then
    _CHECK_OUTPUT="Circuit breaker: agentdb_circuit_status returned no output"
    return
  fi

  if ! echo "$cb_out" | grep -q '"success"'; then
    _CHECK_OUTPUT="Circuit breaker: no success field in response"
    return
  fi

  if echo "$cb_out" | grep -q '"OPEN"'; then
    _CHECK_OUTPUT="Circuit breaker: found OPEN breakers on fresh init (expected all CLOSED)"
    return
  fi

  local total
  total=$(echo "$cb_out" | grep -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$') || total="?"

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="Circuit breaker: active, no OPEN breakers (total: ${total})"
}

check_resource_tracker() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_resource_usage"
  local ru_out="$_RK_OUT"

  if [[ -z "$ru_out" ]]; then
    _CHECK_OUTPUT="Resource tracker: agentdb_resource_usage returned no output"
    return
  fi

  if ! echo "$ru_out" | grep -q '"success"'; then
    _CHECK_OUTPUT="Resource tracker: no success field in response"
    return
  fi

  if ! echo "$ru_out" | grep -qi "ceiling"; then
    _CHECK_OUTPUT="Resource tracker: missing ceiling field in response"
    return
  fi

  if ! echo "$ru_out" | grep -qi "overlimit"; then
    _CHECK_OUTPUT="Resource tracker: missing overLimit field in response"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="Resource tracker: active with ceiling and overLimit fields"
}

check_controller_composition() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_controllers"
  local ctrl_out="$_RK_OUT"

  if [[ -z "$ctrl_out" ]]; then
    _CHECK_OUTPUT="Controller composition: agentdb_controllers returned no output"
    return
  fi

  local total
  total=$(echo "$ctrl_out" | grep -o '"total"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$') || total="0"
  if [[ "$total" -lt 7 ]]; then
    _CHECK_OUTPUT="Controller composition: registry too small (total=$total, expected >= 7)"
    return
  fi

  local leaked=0 leaked_names=""
  for child in semanticQueryRouter sonaLearningBackend contrastiveTrainer temporalCompressor; do
    if echo "$ctrl_out" | grep -q "$child"; then
      leaked=$((leaked + 1))
      leaked_names="${leaked_names}${child} "
    fi
  done

  if [[ $leaked -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Controller composition: $total controllers, no composite children leaked"
  else
    _CHECK_OUTPUT="Controller composition: $leaked composite children leaked as top-level: ${leaked_names}"
  fi
}

check_wiring_remediation() {
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_controllers"
  local ctrl_out="$_RK_OUT"

  if [[ -z "$ctrl_out" ]]; then
    _CHECK_OUTPUT="Wiring remediation: agentdb_controllers returned no output"
    return
  fi

  local issues=""

  if echo "$ctrl_out" | grep -q 'graphTransformer'; then
    issues="${issues}graphTransformer still present (BUG-3); "
  fi

  if echo "$ctrl_out" | grep -q '"mmrDiversity"'; then
    issues="${issues}stale mmrDiversity name found (BUG-2); "
  fi

  local positive=0
  for ctrl in memoryGraph memoryConsolidation hierarchicalMemory; do
    if echo "$ctrl_out" | grep -q "$ctrl"; then
      positive=$((positive + 1))
    fi
  done
  if [[ $positive -lt 2 ]]; then
    issues="${issues}only $positive/3 expected controllers found (need >= 2); "
  fi

  if [[ -z "$issues" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Wiring remediation: no stale names, $positive/3 positive confirmations"
  else
    _CHECK_OUTPUT="Wiring remediation: ${issues}"
  fi
}

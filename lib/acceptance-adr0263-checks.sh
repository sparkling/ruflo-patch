#!/usr/bin/env bash
# lib/acceptance-adr0263-checks.sh — ADR-0263 replay-verification harness checks.

_adr0263_setup_shared_temp() {
  local td registry log
  registry="${REGISTRY:-http://localhost:4873}"
  td=$(mktemp -d /tmp/ruflo-adr0263-shared-XXXXX) || return 1
  log="${td}/_setup.log"

  echo '{"name":"adr0263-shared","version":"1.0.0","private":true}' > "${td}/package.json"
  echo "registry=${registry}" > "${td}/.npmrc"

  if ! (cd "$td" && npm install @sparkleideas/ruflo@latest \
      --registry "$registry" --no-audit --no-fund \
      > "$log" 2>&1); then
    echo "[adr0263-shared-setup] FATAL: npm install failed (see $log)" >&2
    return 1
  fi

  local cli=""
  for name in ruflo claude-flow cli; do
    if [[ -x "${td}/node_modules/.bin/${name}" ]]; then
      cli="${td}/node_modules/.bin/${name}"
      break
    fi
  done
  if [[ -z "$cli" ]]; then
    echo "[adr0263-shared-setup] FATAL: cli binary not found" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" init --full --force >> "$log" 2>&1); then
    echo "[adr0263-shared-setup] FATAL: cli init --full --force failed (see $log)" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" memory init --force >> "$log" 2>&1); then
    echo "[adr0263-shared-setup] FATAL: cli memory init --force failed (see $log)" >&2
    return 1
  fi

  export ADR0263_SMOKE_SHARED_TEMP="$td"
  echo "[adr0263-shared-setup] shared temp ready: $td" >&2
  return 0
}

_adr0263_cleanup_shared_temp() {
  if [[ -n "${ADR0263_SMOKE_SHARED_TEMP:-}" && -d "${ADR0263_SMOKE_SHARED_TEMP}" ]]; then
    rm -rf "${ADR0263_SMOKE_SHARED_TEMP}" 2>/dev/null || true
  fi
  unset ADR0263_SMOKE_SHARED_TEMP
}

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

_check_adr0263_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0263-${script_name}-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/${script_name}" ]]; then
    _CHECK_OUTPUT="missing: scripts/${script_name}"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/${script_name}" > "${log_path}" 2>&1
  local rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -50: $(tail -50 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

check_adr0263_replay_verification() {
  _check_adr0263_smoke "smoke-adr0263-replay-verification.mjs"
}

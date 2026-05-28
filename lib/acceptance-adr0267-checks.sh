#!/usr/bin/env bash
# lib/acceptance-adr0267-checks.sh — ADR-0267 RVF lock regression fix.
#
# Single smoke (Task #9 acceptance): verifies CLI memory store works alongside
# a running MCP server. Without the fix at fork mcp-server.ts the smoke would
# fail with a 30s timeout on the lock.
#
# Reuses ADR-0255 shared-temp infra (registry-agnostic wrapper install).

_adr0267_setup_shared_temp() {
  # Reuse ADR-0255 shared-temp because the install shape is identical (cli init
  # --full --force + memory init --force). Saves a redundant ~30s setup.
  if [[ -n "${ADR0255_SMOKE_SHARED_TEMP:-}" && -d "${ADR0255_SMOKE_SHARED_TEMP}" ]]; then
    export ADR0267_SMOKE_SHARED_TEMP="${ADR0255_SMOKE_SHARED_TEMP}"
    # The 0255 shared lib uses ADR0255_SMOKE_SHARED_TEMP env; 0267 smoke reuses
    # the same env name via setupSmokeTempDir delegation.
    echo "[adr0267-shared-setup] reusing ADR0255 shared temp: ${ADR0267_SMOKE_SHARED_TEMP}" >&2
    return 0
  fi

  # Standalone fallback if 0255 shared-temp isn't set up.
  local td registry log
  registry="${REGISTRY:-http://localhost:4873}"
  td=$(mktemp -d /tmp/ruflo-adr0267-shared-XXXXX) || return 1
  log="${td}/_setup.log"

  echo '{"name":"adr0267-shared","version":"1.0.0","private":true}' > "${td}/package.json"
  echo "registry=${registry}" > "${td}/.npmrc"

  if ! (cd "$td" && npm install @sparkleideas/ruflo@latest \
      --registry "$registry" --no-audit --no-fund \
      > "$log" 2>&1); then
    echo "[adr0267-shared-setup] FATAL: npm install failed (see $log)" >&2
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
    echo "[adr0267-shared-setup] FATAL: cli binary not found" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" init --full --force >> "$log" 2>&1); then
    echo "[adr0267-shared-setup] FATAL: cli init failed (see $log)" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" memory init --force >> "$log" 2>&1); then
    echo "[adr0267-shared-setup] FATAL: memory init failed (see $log)" >&2
    return 1
  fi

  # Smoke uses ADR0255_SMOKE_SHARED_TEMP env via shared lib
  export ADR0255_SMOKE_SHARED_TEMP="$td"
  export ADR0267_SMOKE_SHARED_TEMP="$td"
  return 0
}

_adr0267_cleanup_shared_temp() {
  # Only clean up if we created our OWN temp (not reused from 0255).
  if [[ "${ADR0267_SMOKE_SHARED_TEMP:-}" == "${ADR0255_SMOKE_SHARED_TEMP:-}" ]]; then
    # Reused — let 0255's cleanup handle it.
    unset ADR0267_SMOKE_SHARED_TEMP
    return
  fi
  if [[ -n "${ADR0267_SMOKE_SHARED_TEMP:-}" && -d "${ADR0267_SMOKE_SHARED_TEMP}" ]]; then
    rm -rf "${ADR0267_SMOKE_SHARED_TEMP}" 2>/dev/null || true
  fi
  unset ADR0267_SMOKE_SHARED_TEMP ADR0255_SMOKE_SHARED_TEMP
}

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

_check_adr0267_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0267-${script_name}-XXXXXX.log")

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

# ─── Single smoke: RVF lock release while MCP server running ─────
check_adr0267_rvf_lock() {
  _check_adr0267_smoke "smoke-adr0267-rvf-lock.mjs"
}

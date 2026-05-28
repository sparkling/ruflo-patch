#!/usr/bin/env bash
# lib/acceptance-adr0266-checks.sh — ADR-0266 (ADR-129 Phases 1-3) acceptance checks.
#
# Mirrors lib/acceptance-adr0265-checks.sh structurally:
#   - shared-temp helper (_adr0266_setup_shared_temp / cleanup) installs
#     @sparkleideas/ruflo from Verdaccio once, runs `cli init --full --force` +
#     `memory init --force`, exports ADR0266_SMOKE_SHARED_TEMP for smokes
#     to reuse. Saves ~30-45s × 5 smokes per release.
#   - canonical _check_adr0266_smoke delegator (recognised by ADR-0082
#     silent-pass lint).
#   - 5 per-criterion check_adr0266_* entrypoints.
#
# Smokes (5):
#   §Group1 smoke-adr0266-group1-introspection   — 5 read-only tools
#   §Group2 smoke-adr0266-group2-reset           — mutator + re-snapshot
#   §Group3 smoke-adr0266-group3-gallery         — 10 gallery tools
#   §Group4 smoke-adr0266-group4-compose         — compose builder + AIDefence
#   §Allow  smoke-adr0266-allowlist              — 29-entry resolution gate

_adr0266_setup_shared_temp() {
  local td registry log
  registry="${REGISTRY:-http://localhost:4873}"
  td=$(mktemp -d /tmp/ruflo-adr0266-shared-XXXXX) || return 1
  log="${td}/_setup.log"

  echo '{"name":"adr0266-shared","version":"1.0.0","private":true}' > "${td}/package.json"
  echo "registry=${registry}" > "${td}/.npmrc"

  # @latest tag forces npm to re-resolve from registry (avoids stale cache
  # per ADR-0265 §L4 lesson).
  if ! (cd "$td" && npm install @sparkleideas/ruflo@latest \
      --registry "$registry" --no-audit --no-fund \
      > "$log" 2>&1); then
    echo "[adr0266-shared-setup] FATAL: npm install failed (see $log)" >&2
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
    echo "[adr0266-shared-setup] FATAL: cli binary not found after install" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" init --full --force >> "$log" 2>&1); then
    echo "[adr0266-shared-setup] FATAL: cli init --full --force failed (see $log)" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" memory init --force >> "$log" 2>&1); then
    echo "[adr0266-shared-setup] FATAL: cli memory init --force failed (see $log)" >&2
    return 1
  fi

  export ADR0266_SMOKE_SHARED_TEMP="$td"
  echo "[adr0266-shared-setup] shared temp ready: $td" >&2
  return 0
}

_adr0266_cleanup_shared_temp() {
  if [[ -n "${ADR0266_SMOKE_SHARED_TEMP:-}" && -d "${ADR0266_SMOKE_SHARED_TEMP}" ]]; then
    rm -rf "${ADR0266_SMOKE_SHARED_TEMP}" 2>/dev/null || true
  fi
  unset ADR0266_SMOKE_SHARED_TEMP
}

# Defensive fallbacks
if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

# Canonical smoke delegator (ADR-0082 silent-pass lint compatible).
_check_adr0266_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0266-${script_name}-XXXXXX.log")

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

# ─── §Group1: 5 introspection tools ──────────────────────
check_adr0266_group1_introspection() {
  _check_adr0266_smoke "smoke-adr0266-group1-introspection.mjs"
}

# ─── §Group2: reset mutator + re-snapshot ────────────────
check_adr0266_group2_reset() {
  _check_adr0266_smoke "smoke-adr0266-group2-reset.mjs"
}

# ─── §Group3: 10 gallery tools ───────────────────────────
check_adr0266_group3_gallery() {
  _check_adr0266_smoke "smoke-adr0266-group3-gallery.mjs"
}

# ─── §Group4: compose builder + AIDefence ────────────────
check_adr0266_group4_compose() {
  _check_adr0266_smoke "smoke-adr0266-group4-compose.mjs"
}

# ─── §Allow: 29-entry allowlist resolution gate ─────────
check_adr0266_allowlist() {
  _check_adr0266_smoke "smoke-adr0266-allowlist.mjs"
}

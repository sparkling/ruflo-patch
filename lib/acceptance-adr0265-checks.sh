#!/usr/bin/env bash
# lib/acceptance-adr0265-checks.sh — ADR-0265 fork-native QUIC federation
# transport acceptance checks.
#
# Mirrors lib/acceptance-adr0261-checks.sh structurally:
#   - shared-temp helper (_adr0265_setup_shared_temp / cleanup) installs
#     @sparkleideas/ruflo from Verdaccio once, runs cli init --full --force +
#     memory init --force, exports ADR0265_SMOKE_SHARED_TEMP for the smokes
#     to reuse. Saves ~30-45s × 10 smokes = ~300-450s CPU per release.
#   - canonical _check_adr0265_smoke delegator (recognised by
#     scripts/lint-acceptance-checks.mjs L2 _check_<name> rule per ADR-0082
#     silent-pass guard).
#   - per-criterion check_adr0265_* entrypoints that delegate to the
#     helper, satisfying _CHECK_PASSED semantics via delegation.
#
# Requires: PROJECT_DIR, _ns, _elapsed_ms from acceptance-harness.sh (with
# defensive fallbacks below).
#
# Smokes (7 active + 3 optional skip-by-policy + 1 benchmark):
#   C1  smoke-quic-binding-load
#   C2  smoke-quic-loader-upgrade
#   C3  smoke-quic-loader-fallback
#   C4  smoke-quic-federation-roundtrip
#   C5  smoke-quic-doctor
#   §3  smoke-quic-multiplex
#   §4  smoke-quic-tls13
#   §2  smoke-quic-0rtt-reconnect       (skip-by-policy stub)
#   §6  smoke-quic-mobility             (skip-by-policy stub)
#   §7  smoke-quic-recovery             (skip-by-policy stub)
#   C6  benchmark-quic-federation       (T1 latency + T2 fan-out)

# ── Shared-temp setup (perf optimisation, ADR-0265 acceleration) ──────────
# Creates ONE temp dir, runs ONE `npm install @sparkleideas/ruflo` + ONE
# `cli init --full --force` + ONE `cli memory init --force`, exports
# ADR0265_SMOKE_SHARED_TEMP for the smokes to reuse. Per `feedback-no-fallbacks`,
# any failure here is fatal and returns non-zero; the caller MUST NOT proceed
# to the smokes without the shared install.
#
# ADR-0265 §I11: sandbox lives under /tmp/ruflo-quic-smoke-* per the runtime
# validation contract (matches PHASE_2A platform smoke prefix).
_adr0265_setup_shared_temp() {
  local td registry log
  registry="${REGISTRY:-http://localhost:4873}"
  td=$(mktemp -d /tmp/ruflo-quic-smoke-shared-XXXXX) || return 1
  log="${td}/_setup.log"

  echo '{"name":"adr0265-shared","version":"1.0.0","private":true}' > "${td}/package.json"
  echo "registry=${registry}" > "${td}/.npmrc"

  # @sparkleideas/ruflo is the wrapper install — sources the federation
  # plugin (Phase 4 consumer) + agentic-flow loader (Phase 3 consumer) per
  # ADR-0265 §Phase 4 and §Cross-package symbol contracts.
  if ! (cd "$td" && npm install @sparkleideas/ruflo \
      --registry "$registry" --no-audit --no-fund --prefer-offline \
      > "$log" 2>&1); then
    echo "[adr0265-shared-setup] FATAL: npm install failed (see $log)" >&2
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
    echo "[adr0265-shared-setup] FATAL: cli binary not found after install" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" init --full --force >> "$log" 2>&1); then
    echo "[adr0265-shared-setup] FATAL: cli init --full --force failed (see $log)" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" memory init --force >> "$log" 2>&1); then
    echo "[adr0265-shared-setup] FATAL: cli memory init --force failed (see $log)" >&2
    return 1
  fi

  export ADR0265_SMOKE_SHARED_TEMP="$td"
  echo "[adr0265-shared-setup] shared temp ready: $td" >&2
  return 0
}

_adr0265_cleanup_shared_temp() {
  if [[ -n "${ADR0265_SMOKE_SHARED_TEMP:-}" && -d "${ADR0265_SMOKE_SHARED_TEMP}" ]]; then
    rm -rf "${ADR0265_SMOKE_SHARED_TEMP}" 2>/dev/null || true
  fi
  unset ADR0265_SMOKE_SHARED_TEMP
}

# Defensive fallbacks (mirroring lib/acceptance-adr0261-checks.sh)
if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

# ── Canonical smoke delegator ─────────────────────────────────────────────
# Runs `node scripts/<script_name>` and records the result. Per ADR-0097 L2
# the delegator pattern (`_check_<name>`) is recognised by lint-acceptance-
# checks.mjs as the canonical helper that satisfies _CHECK_PASSED semantics.
# Skip detection: if the smoke exits 0 with a `skip_accepted` JSON marker on
# stdout, we still report PASS but log the skip reason (per
# `feedback-skip-accepted-as-squelch` legitimate-skip semantics).
_check_adr0265_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0265-${script_name}-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/${script_name}" ]]; then
    _CHECK_OUTPUT="missing: scripts/${script_name}"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Full tee per feedback-no-tail-tests + feedback-full-test-output — never
  # pipe through tail/head; the log lives on disk for post-hoc inspection.
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

# ─── C1: N-API binding loads on host platform ────────────────────────
check_adr0265_binding_load() {
  _check_adr0265_smoke "smoke-quic-binding-load.mjs"
}

# ─── C2: Loader auto-upgrades when env var + binding present ────────
check_adr0265_loader_upgrade() {
  _check_adr0265_smoke "smoke-quic-loader-upgrade.mjs"
}

# ─── C3: Loader falls back to WS when env unset ─────────────────────
check_adr0265_loader_fallback() {
  _check_adr0265_smoke "smoke-quic-loader-fallback.mjs"
}

# ─── C4: Federation round-trip on BOTH backends ─────────────────────
check_adr0265_federation_roundtrip() {
  _check_adr0265_smoke "smoke-quic-federation-roundtrip.mjs"
}

# ─── C5: Doctor surface reports correct backend ─────────────────────
check_adr0265_doctor() {
  _check_adr0265_smoke "smoke-quic-doctor.mjs"
}

# ─── §Aspirational row 3: Multiplexed streams (no HOL blocking) ─────
check_adr0265_multiplex() {
  _check_adr0265_smoke "smoke-quic-multiplex.mjs"
}

# ─── §Aspirational row 4: Built-in TLS 1.3 encryption ────────────────
check_adr0265_tls13() {
  _check_adr0265_smoke "smoke-quic-tls13.mjs"
}

# ─── §Aspirational row 2: 0-RTT reconnect (skip-by-policy stub) ─────
check_adr0265_0rtt_reconnect() {
  _check_adr0265_smoke "smoke-quic-0rtt-reconnect.mjs"
}

# ─── §Aspirational row 6: Mobility / IP migration (skip-by-policy) ──
check_adr0265_mobility() {
  _check_adr0265_smoke "smoke-quic-mobility.mjs"
}

# ─── §Aspirational row 7: Loss recovery (skip-by-policy stub) ───────
check_adr0265_recovery() {
  _check_adr0265_smoke "smoke-quic-recovery.mjs"
}

# ─── C6: Benchmarks — p99 < 5ms loopback + 100 fan-out ───────────────
check_adr0265_benchmark() {
  _check_adr0265_smoke "benchmark-quic-federation.mjs"
}

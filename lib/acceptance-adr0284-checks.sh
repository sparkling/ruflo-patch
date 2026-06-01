#!/usr/bin/env bash
# lib/acceptance-adr0284-checks.sh — ADR-0284 RVF concurrent-write durability
# (the t3-2 high-concurrency silent-loss gate).
#
# Runs scripts/smoke-adr0284-concurrent-durability.mjs: K rounds of N concurrent
# `memory store` against a freshly-seeded SMALL .rvf each round (--reset-each-round),
# asserting BOTH a durable (manifest listMetadataIds) AND visible (memory list)
# count == N per round. Pre-fix (per-process nextNativeId counter + .jslock) loses
# on round 1; post-fix (deterministic hash ids + single-flock collapse) is 0 loss.
# Deterministic gate — unlike the legacy single-shot N=6 t3-2 which passed ~75% on
# broken code. No skip_accepted.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0284_concurrent_durability() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0284-concurrent-durability-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0284-concurrent-durability.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0284-concurrent-durability.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # K defaults to 10 (release gate); CI can lower via ADR0284_K for speed.
  ADR0284_K="${ADR0284_K:-10}" ADR0284_N="${ADR0284_N:-16}" \
    node "${PROJECT_DIR}/scripts/smoke-adr0284-concurrent-durability.mjs" > "${log_path}" 2>&1
  rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -40: $(tail -40 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

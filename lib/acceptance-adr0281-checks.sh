#!/usr/bin/env bash
# lib/acceptance-adr0281-checks.sh — ADR-0281 hierarchical keyed upsert +
# delete-by-key.
#
# Runs scripts/smoke-adr0281-hierarchical-upsert-delete.mjs: stores the SAME
# adr/<id> key twice, asserts the keyed UPSERT kept exactly 1 entry (append-only
# would leave 2), deletes by key (real delete, not controller=native-unsupported,
# and the '/' key is accepted), then asserts the key is gone. FAILs pre-impl
# (append-only store + no-op delete + '/'-rejecting validation), PASSes after
# ADR-0281 lands. Reuses the main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0281_hierarchical_upsert_delete() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0281-hierarchical-upsert-delete-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0281-hierarchical-upsert-delete.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0281-hierarchical-upsert-delete.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0281-hierarchical-upsert-delete.mjs" > "${log_path}" 2>&1
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

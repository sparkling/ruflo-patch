#!/usr/bin/env bash
# lib/acceptance-adr0176-query-key.sh — ADR-0176 amendment (2026-05-30) /
# WS0: `agentdb_hierarchical-query` globs the stored KEY (metadata.key), not the
# value/content blob.
#
# Distinct from adr0178-hquery-e2e: that check writes value==path (key==content),
# so it passes even against the pre-fix content-glob. This smoke stores a record
# whose key is `adr/...` but whose content is a distinct non-path blob, so it
# FAILS pre-fix (0 results) and PASSES post-fix (1 result). Reuses the main
# ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP — no dedicated per-ADR install.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0176_query_key() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0176-query-key-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0176-query-key.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0176-query-key.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0176-query-key.mjs" > "${log_path}" 2>&1
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

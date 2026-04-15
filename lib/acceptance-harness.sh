#!/usr/bin/env bash
# lib/acceptance-harness.sh — Generic acceptance test framework (ADR-0037)
#
# Extracted from scripts/test-acceptance.sh to keep the main script under 500
# lines and allow reuse.
#
# Contract:
#   Caller MUST define: _ns, _elapsed_ms, log (timing/logging helpers)
#   Caller MUST define: run_timed (sets _OUT, _EXIT, _DURATION_MS)
#   This file provides: _escape_json, run_check, run_check_bg, collect_parallel,
#     _record_phase, and the result-tracking variables.

# ══════════════════════════════════════════════════════════════════════════════
# Result tracking
# ══════════════════════════════════════════════════════════════════════════════
pass_count=0
fail_count=0
skip_count=0   # ADR-0090 Tier A2: accepted-skip bucket (NOT counted as PASS)
total_count=0
results_json="[]"

# ══════════════════════════════════════════════════════════════════════════════
# Phase timing
# ══════════════════════════════════════════════════════════════════════════════
PHASE_TIMINGS=""
TIMING_FILE="/tmp/ruflo-acceptance-timing.jsonl"
: > "$TIMING_FILE"

_record_phase() {
  local name="$1" ms="$2"
  PHASE_TIMINGS="${PHASE_TIMINGS} ${name}:${ms}"
  printf '{"phase":"%s","duration_ms":%d}\n' "$name" "$ms" >> "$TIMING_FILE"
  if [[ $ms -ge 1000 ]]; then
    log "  Phase '${name}': ${ms}ms ($(( ms / 1000 ))s)"
  else
    log "  Phase '${name}': ${ms}ms"
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# JSON escaping
# ══════════════════════════════════════════════════════════════════════════════
_escape_json() {
  local s="${1:-}"
  s="${s:0:4096}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

# ══════════════════════════════════════════════════════════════════════════════
# Sequential check runner
# ══════════════════════════════════════════════════════════════════════════════
run_check() {
  local id="$1" name="$2" fn="$3" group="$4"
  total_count=$((total_count + 1))
  local c_start c_end c_ms=0
  c_start=$(_ns)
  "$fn"
  c_end=$(_ns)
  c_ms=$(_elapsed_ms "$c_start" "$c_end")

  # ADR-0090 Tier A2: three-way result (pass / fail / skip_accepted).
  # skip_accepted is ONLY for checks where a prerequisite is legitimately
  # absent from the build (e.g. native binary missing). It is NOT PASS —
  # it is bucketed as a WARNING so missing coverage stays visible.
  local passed_bool="false"
  local status_field="\"failed\""
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    pass_count=$((pass_count + 1)); passed_bool="true"
    status_field="\"passed\""
    log "  PASS  ${id}: ${name} (${c_ms}ms)"
  elif [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    skip_count=$((skip_count + 1))
    status_field="\"skip_accepted\""
    log "  SKIP  ${id}: ${name} (${c_ms}ms)  [accepted]"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  else
    fail_count=$((fail_count + 1))
    log "  FAIL  ${id}: ${name} (${c_ms}ms)"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  fi
  [[ $c_ms -gt 15000 ]] && log "  SLOW  ${id}: ${c_ms}ms"

  local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
  local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"status":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$group" "$passed_bool" "$status_field" "$escaped" "$c_ms")
  [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
}

# ══════════════════════════════════════════════════════════════════════════════
# Parallel check runner
# ══════════════════════════════════════════════════════════════════════════════
PARALLEL_DIR=""
BG_PIDS=()

run_check_bg() {
  local id="$1" name="$2" fn="$3" group="$4"
  (
    set +u  # disable strict unset — check functions may leave vars unset in helper chains
    _CHECK_PASSED="false"; _CHECK_OUTPUT=""
    local c_start c_end c_ms=0
    c_start=$(_ns)
    "$fn" || true  # don't let function failure crash subshell
    c_end=$(_ns)
    c_ms=$(_elapsed_ms "$c_start" "$c_end")
    local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
    echo "${_CHECK_PASSED:-false}|${c_ms:-0}|${escaped}" > "${PARALLEL_DIR}/${id}"
  ) &
  BG_PIDS+=($!)
}

collect_parallel() {
  local group="$1"; shift
  wait "${BG_PIDS[@]}"
  BG_PIDS=()
  for spec in "$@"; do
    local id="${spec%%|*}" name="${spec#*|}"
    total_count=$((total_count + 1))
    local result_file="${PARALLEL_DIR}/${id}"
    if [[ -f "$result_file" ]]; then
      IFS='|' read -r passed dur_ms escaped_output < "$result_file"
      # ADR-0090 Tier A2: three-way bucketing (see run_check above)
      local passed_bool="false"
      local status_field="\"failed\""
      if [[ "$passed" == "true" ]]; then
        pass_count=$((pass_count + 1)); passed_bool="true"
        status_field="\"passed\""
        log "  PASS  ${id}: ${name} (${dur_ms:-0}ms)"
      elif [[ "$passed" == "skip_accepted" ]]; then
        skip_count=$((skip_count + 1))
        status_field="\"skip_accepted\""
        log "  SKIP  ${id}: ${name} (${dur_ms:-0}ms)  [accepted]"
      else
        fail_count=$((fail_count + 1))
        log "  FAIL  ${id}: ${name} (${dur_ms:-0}ms)"
      fi
      [[ "${dur_ms:-0}" -gt 15000 ]] && log "  SLOW  ${id}: ${dur_ms}ms"
      local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"status":%s,"output":%s,"duration_ms":%d}' \
        "$id" "$name" "$group" "$passed_bool" "$status_field" "${escaped_output:-\"\"}" "${dur_ms:-0}")
      [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
    else
      fail_count=$((fail_count + 1))
      log "  FAIL  ${id}: ${name} (subprocess crashed)"
    fi
  done
  for spec in "$@"; do
    local id="${spec%%|*}"
    rm -f "${PARALLEL_DIR}/${id}"
  done
}

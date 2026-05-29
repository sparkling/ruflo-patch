#!/usr/bin/env bash
# lib/acceptance-adr0268-checks.sh — ADR-0268 autonomous skill-promotion flywheel.
#
# Round-trip smoke: hooks post-task ×3 (record episodes with a derived task_type)
# → hooks session-end (promote: routeSessionOp 'end' batch consolidation) →
# assert the episodes + the promoted skill exist. Reuses the main acceptance
# install (ACCEPT_TEMP, threaded via ADR0255_SMOKE_SHARED_TEMP by the caller) —
# NO dedicated per-ADR npm install (the per-ADR-install waste flagged in the
# acceptance-perf analysis / ADR-0182).

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

_check_adr0268_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0268-${script_name}-XXXXXX.log")

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

check_adr0268_flywheel() {
  _check_adr0268_smoke "smoke-adr0268-flywheel.mjs"
}

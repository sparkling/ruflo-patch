# lib/acceptance-adr0245-checks.sh — ADR-0245 pipeline robustness trip-wire.
#
# Wires Batch 2's ADR-0245 (F-02-003/-005/-006/-008/-010 + CC-02-B set-e
# discipline) per-script gates into the fast acceptance runner. Three
# checks:
#
#   1. lint-set-e-discipline passes on current scripts/ + lib/ corpus.
#   2. Behavioural snapshot: run_phase_norevert appears ≥2x in
#      scripts/publish-verdaccio.sh (proves Phase 4 + Phase 6 are wrapped,
#      not bypassed via copy-paste of the old `|| log` swallow shape).
#   3. Anti-regression snapshot: the old `|| log ` swallow pattern is
#      absent from the tolerant-phase blocks (lines 140-220) of
#      publish-verdaccio.sh.
#
# Per ADR-0233 second-pass §Per-ADR validation gates.

_RUFLO_PATCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_adr0245_lint_set_e_discipline() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if ! command -v node >/dev/null 2>&1; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: node not available"
    return
  fi

  local lint="${_RUFLO_PATCH_ROOT}/scripts/lint-set-e-discipline.mjs"
  if [[ ! -f "$lint" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: lint script not present at scripts/lint-set-e-discipline.mjs"
    return
  fi

  local log
  log=$(mktemp /tmp/adr0245-lint-XXXXX.log)
  node "$lint" >"$log" 2>&1
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail_out
    tail_out=$(tail -10 "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: lint-set-e-discipline exit=$rc; tail: $tail_out"
    rm -f "$log"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="lint-set-e-discipline: all .sh files conform to set-e + DELIBERATE rules"
  rm -f "$log"
}

check_adr0245_publish_verdaccio_norevert_wraps() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local target="${_RUFLO_PATCH_ROOT}/scripts/publish-verdaccio.sh"
  if [[ ! -f "$target" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: scripts/publish-verdaccio.sh missing"
    return
  fi

  # grep -c exits 1 on count=0; capture-and-default per reference-grep-c-bash-trap
  local count
  count=$(grep -c "run_phase_norevert" "$target" 2>/dev/null)
  count=${count:-0}

  if [[ "$count" -lt 2 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥2 run_phase_norevert invocations in publish-verdaccio.sh (Phase 4 + Phase 6); found $count"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="run_phase_norevert appears $count times in publish-verdaccio.sh (Phase 4 + Phase 6 wrapped)"
}

check_adr0245_publish_verdaccio_no_log_swallow() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local target="${_RUFLO_PATCH_ROOT}/scripts/publish-verdaccio.sh"
  if [[ ! -f "$target" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: scripts/publish-verdaccio.sh missing"
    return
  fi

  # Inspect tolerant-phase region (lines 140-220, the wave Phase 4-6 block).
  # The old `|| log "<msg>"` swallow shape MUST be absent — replaced by
  # run_phase_norevert + per-call RECOVERABLE_PATTERNS allowlist.
  local count
  count=$(sed -n '140,220p' "$target" | grep -c '|| log "' 2>/dev/null)
  count=${count:-0}

  if [[ "$count" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: legacy '|| log \"...\"' swallow pattern detected $count time(s) in lines 140-220; should be run_phase_norevert with per-call allowlist"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="No '|| log \"...\"' swallow pattern in tolerant-phase region (lines 140-220)"
}

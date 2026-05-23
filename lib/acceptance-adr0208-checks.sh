# lib/acceptance-adr0208-checks.sh — ADR-0208 acceptance trip-wire (B3).
#
# Wires scripts/check-manifest-flag-drift.mjs into the fast acceptance
# runner. A drift in any of the 3 hooks manifests or 5 shipped hooks docs
# fails the suite.
#
# Sequenced per ADR-0208 Option D′: this trip-wire is meaningful only after
# Stage B2 cleanup landed (the B2 commits brought the lint to exit 0). Wiring
# the trip-wire on top of a 42-drift baseline would have been a squelch per
# [[feedback-skip-accepted-as-squelch]].
#
# Exit-code mapping:
#   lint rc=0 → check PASSES
#   lint rc=1 → check FAILS (drift detected; surface the count in output)
#   lint rc=2 → check SKIP_ACCEPTED (sources unavailable — e.g. fork repo
#                missing in a CI environment that doesn't have it; legitimate
#                skip per the lint script's own informational exit)

check_adr0208_manifest_flag_drift() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if ! command -v node >/dev/null 2>&1; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: node not on PATH"
    return
  fi

  local lint_script="$PROJECT_DIR/scripts/check-manifest-flag-drift.mjs"
  if [[ ! -f "$lint_script" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: lint script missing at $lint_script"
    return
  fi

  local out rc
  out=$(node "$lint_script" 2>&1)
  rc=$?

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="Lint clean — every manifest/doc flag and subcommand resolves to a declaration"
    return
  fi

  if [[ $rc -eq 2 ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: lint sources unavailable (rc=2, fork path missing)"
    return
  fi

  # rc=1 — drift detected. Extract the headline summary.
  local headline
  headline=$(printf '%s\n' "$out" | grep -E '^\[lint\] FAIL' | head -1)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="${headline:-FAIL: manifest-vs-CLI drift detected (run node $lint_script for details)}"
}

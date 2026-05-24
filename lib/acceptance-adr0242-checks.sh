# lib/acceptance-adr0242-checks.sh — ADR-0242 shared error library +
# MCP envelope honesty advisory lints trip-wire.
#
# Five checks per ADR-0242 §Confirmation:
#
#   1. @claude-flow/errors package present + built (dist/index.js +
#      dist/index.d.ts exist).
#   2. Package exports the 5 canonical symbols (RufloError,
#      RufloErrorCode, wrapError, getErrorMessage, isRufloError) —
#      asserted via the dist/index.d.ts file content.
#   3. gastown-bridge/errors.ts re-export shim: GasTownError IS-A
#      RufloError (the load-bearing invariant per ADR-0242 §pre-flight
#      check #1). Asserted via grep on the source file shape.
#   4. Both advisory lints baseline correctly (count > 0, exit 0).
#   5. INTEGRATION-LEDGER has ≥2 ADR-0242 rows (per ADR-0242
#      §Improvements #3).
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 4.
# Per [[reference-acceptance-runcheck-vs-collect]] — these check_*
# functions are dispatched from test-acceptance-fast.sh.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"
_PATCH_ROOT="/Users/henrik/source/ruflo-patch"

check_adr0242_errors_package_built() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local pkg="${_FORK_RUFLO}/v3/@claude-flow/errors"
  if [[ ! -d "$pkg" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: @claude-flow/errors package directory missing at $pkg"
    return
  fi

  if [[ ! -f "$pkg/package.json" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: @claude-flow/errors/package.json missing"
    return
  fi

  if [[ ! -f "$pkg/dist/index.js" || ! -f "$pkg/dist/index.d.ts" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: @claude-flow/errors/dist build artifacts missing (run npx tsc in the package)"
    return
  fi

  if [[ ! -f "$pkg/README.md" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: @claude-flow/errors/README.md missing (canon documentation per ADR-0242 §Decision scope #2)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="@claude-flow/errors package present + built + documented"
}

check_adr0242_errors_exports() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dts="${_FORK_RUFLO}/v3/@claude-flow/errors/dist/index.d.ts"
  if [[ ! -f "$dts" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: dist/index.d.ts missing"
    return
  fi

  # The 5 canonical exports per ADR-0242 §Decision scope #1.
  local missing=""
  for sym in "RufloError" "RufloErrorCode" "wrapError" "getErrorMessage" "isRufloError"; do
    if ! grep -qE "\\b$sym\\b" "$dts"; then
      missing="${missing} $sym"
    fi
  done

  if [[ -n "$missing" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: @claude-flow/errors missing exports:$missing"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="@claude-flow/errors exports all 5 canonical symbols (RufloError, RufloErrorCode, wrapError, getErrorMessage, isRufloError)"
}

check_adr0242_gastown_bridge_shim() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local shim="${_FORK_RUFLO}/v3/plugins/gastown-bridge/src/errors.ts"
  if [[ ! -f "$shim" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: gastown-bridge/errors.ts missing"
    return
  fi

  # Load-bearing invariant: GasTownError extends RufloError, and
  # the file imports from @claude-flow/errors.
  if ! grep -qE "from\s+['\"]@claude-flow/errors['\"]" "$shim"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: gastown-bridge/errors.ts does not import from @claude-flow/errors"
    return
  fi

  if ! grep -qE "class\s+GasTownError\s+extends\s+RufloError" "$shim"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: gastown-bridge/errors.ts: GasTownError does not extend RufloError (re-export shim broken)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="gastown-bridge/errors.ts shim: GasTownError extends RufloError (imports from @claude-flow/errors)"
}

check_adr0242_lints_baseline() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local script_throw="${_PATCH_ROOT}/scripts/check-throw-new-error.mjs"
  local script_mcp="${_PATCH_ROOT}/scripts/check-mcp-handler-fatal-throw.mjs"

  if [[ ! -f "$script_throw" || ! -f "$script_mcp" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ADR-0242 lint scripts missing (throw=$([[ -f $script_throw ]] && echo 1 || echo 0) mcp=$([[ -f $script_mcp ]] && echo 1 || echo 0))"
    return
  fi

  # Both must exit 0 advisory-first and produce non-zero baseline counts.
  local out_throw rc_throw out_mcp rc_mcp
  out_throw=$(cd "$_PATCH_ROOT" && node "$script_throw" 2>&1)
  rc_throw=$?
  out_mcp=$(cd "$_PATCH_ROOT" && node "$script_mcp" 2>&1)
  rc_mcp=$?

  if [[ $rc_throw -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: check-throw-new-error.mjs exit=$rc_throw (expected 0 advisory-first per ADR-0242 §Decision scope #3)"
    return
  fi

  if [[ $rc_mcp -ne 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: check-mcp-handler-fatal-throw.mjs exit=$rc_mcp (expected 0 advisory-first per ADR-0242 §Decision scope #4)"
    return
  fi

  # Baseline counts must be > 0 (else baseline was not populated).
  local n_throw n_mcp
  n_throw=$(echo "$out_throw" | grep -oE "[0-9]+ naked throw" | grep -oE "^[0-9]+" | head -1)
  n_mcp=$(echo "$out_mcp" | grep -oE "[0-9]+ fatal-swallow" | grep -oE "^[0-9]+" | head -1)
  n_throw=${n_throw:-0}
  n_mcp=${n_mcp:-0}

  if [[ "$n_throw" -lt 1 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: throw-new-error baseline=0 (expected > 0; run --update to regenerate allowlist)"
    return
  fi

  if [[ "$n_mcp" -lt 1 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: mcp-handler-fatal-throw baseline=0 (expected > 0; run --update to regenerate allowlist)"
    return
  fi

  # Also verify the delta is 0 (allowlist matches baseline).
  if ! echo "$out_throw" | grep -qE "└ 0 not in allowlist"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: throw-new-error has non-zero delta from baseline (run --update or investigate new sites)"
    return
  fi

  if ! echo "$out_mcp" | grep -qE "└ 0 not in allowlist"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: mcp-handler-fatal-throw has non-zero delta from baseline (run --update or investigate new sites)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="advisory lints: throw-new-error=$n_throw + mcp-handler-fatal-throw=$n_mcp, baselines exit 0 with delta=0"
}

check_adr0242_ledger_rows() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local ledger="${_PATCH_ROOT}/docs/upstream/INTEGRATION-LEDGER.md"
  if [[ ! -f "$ledger" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: INTEGRATION-LEDGER.md missing"
    return
  fi

  # Per `[[reference-grep-c-bash-trap]]`: do NOT use `|| echo 0` (produces "0\n0").
  local n
  n=$(grep -c "ADR-0242" "$ledger" 2>/dev/null)
  n=${n:-0}

  if [[ "$n" -lt 2 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥2 ADR-0242 rows in INTEGRATION-LEDGER.md, found $n"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INTEGRATION-LEDGER.md has $n ADR-0242 rows (≥2 expected)"
}

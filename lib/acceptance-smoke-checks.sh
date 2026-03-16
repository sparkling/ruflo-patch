#!/usr/bin/env bash
# lib/acceptance-smoke-checks.sh — Smoke group checks (ADR-0039 T2)
#
# Requires: _cli_cmd, _run_and_kill from acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR, PKG
# Caller MUST define: run_timed

# --------------------------------------------------------------------------
# Version check
# --------------------------------------------------------------------------
check_version() {
  local cli; cli=$(_cli_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli --version"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 && -n "$_OUT" ]]; then
    if echo "$_OUT" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
      _CHECK_PASSED="true"
    fi
  fi
}

# --------------------------------------------------------------------------
# @latest dist-tag resolves to a working version
# --------------------------------------------------------------------------
check_latest_resolves() {
  _CHECK_PASSED="false"

  # Use `npm view` instead of `npx --version` to verify @latest resolves.
  # npx installs all transitive deps (including better-sqlite3 native compile
  # via cc1) which takes ~58s and wastes CPU. npm view is a metadata-only
  # check that takes <1s. See MEMORY.md "Post-promote smoke test" note.
  local ver_out
  ver_out=$(npm view "@sparkleideas/cli@latest" version \
    --registry "$REGISTRY" 2>&1) || true

  if echo "$ver_out" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="cli@latest = $(echo "$ver_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[^ ]*' | head -1)"
  else
    _CHECK_OUTPUT="cli@latest failed to resolve (broken dist-tag?)"
    _CHECK_OUTPUT="$_CHECK_OUTPUT\n$(echo "$ver_out" | head -5)"
  fi

  _EXIT=0
  _DURATION_MS=0
  _OUT="$_CHECK_OUTPUT"
}

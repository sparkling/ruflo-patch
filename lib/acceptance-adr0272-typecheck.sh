#!/usr/bin/env bash
# lib/acceptance-adr0272-typecheck.sh — ADR-0272 §Confirmation.
#
# Gates the agentdb fork's SHIPPED code (`src/`) on a clean type-check:
#
#   tsc --noEmit -p tsconfig.build.json   (must exit 0)
#
# ADR-0272 chose a two-tier model: the full `tsc` (tsconfig.json over
# src+benchmarks+examples+tests) keeps emitting dist/ despite dev-dir errors
# (noEmitOnError stays false), while THIS scoped config — src/ minus
# src/examples/** — is the one CI gates on. The 6 shipped-code errors it
# caught (incl. the real `agentdb-mcp-server.ts:2266` missing-`await` bug)
# are fixed; this check keeps that class of bug from re-hiding in dev-dir noise.
#
# Mirrors the gate-as-acceptance-check shape of lib/acceptance-adr0176-tool-names.sh.
#
# Verdict source: _CHECK_PASSED (run_check_bg + _fast_run both read it).
# Caller MAY set: AGENTDB_FORK_DIR (default: ${PROJECT_DIR}/../forks/agentdb).

# Portable timeout shim (same approach as acceptance-adr0176): prefer the
# harness _timeout, fall back to timeout/gtimeout, else run bare.
_adr0272_timeout() {
  if declare -f _timeout >/dev/null 2>&1; then
    _timeout "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout --signal=KILL "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --signal=KILL "$@"
  else
    shift  # drop the seconds arg
    "$@"
  fi
}

_adr0272_finalize() {
  _OUT="$_CHECK_OUTPUT"
  _EXIT=0
  if declare -f _ns >/dev/null 2>&1 && declare -f _elapsed_ms >/dev/null 2>&1; then
    _DURATION_MS=$(_elapsed_ms "${_adr0272_t0:-0}" "$(_ns)")
  else
    _DURATION_MS=0
  fi
}

check_adr0272_typecheck() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  if declare -f _ns >/dev/null 2>&1; then _adr0272_t0=$(_ns); else _adr0272_t0=0; fi

  # Locate the agentdb fork tree (where the scoped tsconfig + src/ live).
  local fork="${AGENTDB_FORK_DIR:-${PROJECT_DIR}/../forks/agentdb}"
  if [[ -d "$fork" ]]; then fork="$(cd "$fork" && pwd)"; fi

  if [[ -z "$fork" || ! -d "$fork" ]]; then
    _CHECK_OUTPUT="ADR-0272 failed: agentdb fork dir not found at '${fork}' (set AGENTDB_FORK_DIR)"
    _adr0272_finalize; return
  fi
  if [[ ! -f "$fork/tsconfig.build.json" ]]; then
    _CHECK_OUTPUT="ADR-0272 failed: ${fork}/tsconfig.build.json missing — the scoped src/ gate config is not present"
    _adr0272_finalize; return
  fi

  local log rc
  log="$( cd "$fork" && _adr0272_timeout 240 npx --no-install tsc --noEmit -p tsconfig.build.json 2>&1 )"
  rc=$?

  if [[ $rc -ne 0 ]]; then
    local n
    n=$(printf '%s\n' "$log" | grep -c "error TS")
    _CHECK_OUTPUT="ADR-0272 failed: 'tsc --noEmit -p tsconfig.build.json' exited ${rc} with ${n} shipped-src/ type error(s):"$'\n'"$(printf '%s\n' "$log" | grep 'error TS' | head -20)"
    _adr0272_finalize; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0272 PASS: agentdb shipped src/ type-clean (tsc --noEmit -p tsconfig.build.json exit 0)"
  _adr0272_finalize
}

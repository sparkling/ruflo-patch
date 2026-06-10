#!/usr/bin/env bash
# lib/acceptance-adr0310-checks.sh — ADR-0310 FederationHubServer DOA repair
# acceptance check.
#
# T4 is a single end-to-end criterion: from the SHIPPED agentic-flow CLI,
# start the hub, push an episode from one process, pull it from a SEPARATE
# process (correct vector clock), and confirm cross-tenant isolation
# (dataLen:0). The same smoke also gates the 2026-06-10 amendment's critical
# Fix 5 — the published CLI no longer ENOENTs at cli-proxy.js:43 (un-bricks
# the whole agentic-flow CLI, not just federation).
#
#   T4  smoke-federation-cross-process
#
# Structure mirrors lib/acceptance-adr0265-checks.sh's canonical
# _check_<name> delegator (recognised by scripts/lint-acceptance-checks.mjs's
# L2 silent-pass guard per ADR-0082). UNLIKE ADR-0265/0266 there is NO
# shared-temp helper: the smoke is self-contained (it installs
# @sparkleideas/agentic-flow directly — federation is shipped by agentic-flow,
# so no @sparkleideas/ruflo wrapper or `cli init` is required).
#
# Requires: PROJECT_DIR, _ns, _elapsed_ms from acceptance-harness.sh (with
# defensive fallbacks below, matching the sibling libs).

# Defensive fallbacks (mirroring lib/acceptance-adr0265-checks.sh)
if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

# ── Canonical smoke delegator ─────────────────────────────────────────────
# Runs `node scripts/<script_name>` and records the result via _CHECK_PASSED /
# _CHECK_OUTPUT. Per ADR-0097 L2 the `_check_<name>` delegator is recognised
# by lint-acceptance-checks.mjs as the canonical helper that satisfies
# _CHECK_PASSED semantics (so the entry point below need not set it directly).
# Full tee to disk per feedback-no-tail-tests + feedback-full-test-output —
# never pipe through tail/head; the log lives on disk for post-hoc inspection.
_check_adr0310_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0310-${script_name}-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/${script_name}" ]]; then
    _CHECK_OUTPUT="missing: scripts/${script_name}"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/${script_name}" > "${log_path}" 2>&1
  rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -50: $(tail -50 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

# ─── T4: shipped-CLI cross-process federation round-trip + tenant isolation ──
# (also gates Fix 5: the base agentic-flow CLI no longer ENOENTs)
check_adr0310_federation_cross_process() {
  _check_adr0310_smoke "smoke-federation-cross-process.mjs"
}

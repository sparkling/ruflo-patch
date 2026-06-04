#!/usr/bin/env bash
# lib/acceptance-adr0297-checks.sh — ADR-0297 C5 Security & Safety
# re-convergence fixes (aidefence ADR-118 detection refresh; federation
# package unbreak; security defend text-renderer bind).
#
# Runs scripts/smoke-adr0297-c5-reconvergence.mjs against the shared
# ACCEPT_TEMP install. Synthetic test strings ONLY — no paid LLM calls, no
# real PII/credentials. Asserts (both directions):
#   R1 aidefence ADR-118 detection — the three ported pattern families
#      ((a) OVERRIDE_VERBS→0..6-modifier-window→OVERRIDE_NOUNS, (b) `behave
#      (as|like)` role-hijack widening, (c) `(god|root|admin|sudo)\s*mode`
#      jailbreak) close the must-alert FALSE-NEGATIVES on TWO surfaces (MCP
#      aidefence_is_safe + CLI `security defend --output json`): the DA's
#      must-alert positives (indirect override; god-mode) flag safe:false,
#      and the benign negatives (incl. "ignore the deprecation warning") still
#      pass safe:true. Content source = the upstream 3.0.3 ARTIFACT.
#   R2 federation package unbreak — a fresh `npx -y -p
#      @sparkleideas/plugin-agent-federation@latest ruflo-federation init`
#      exits 0 WITHOUT agentic-flow installed (isolated cache → optional
#      peer-dep absent), in self-disclosing local-only mode; ed25519 key files
#      are 0600 (dir 0700). The published alpha.5 static-imports an undeclared
#      agentic-flow → ERR_MODULE_NOT_FOUND at module-load.
#   W1 security defend default-TEXT renderer — a real-threat
#      `security defend -i "<injection>"` (DEFAULT text) exits 0 and renders
#      the threats (no unbound-OutputFormatter "reading 'color'" crash); the
#      benign default-text path still exits 0.
# FAILs against the published cli/aidefence/federation artifacts (patch.938
# era — the two must-alert strings pass as safe; federation init crashes;
# defend text crashes); PASSes after the ADR-0297 fixes ship. Reuses
# ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0297_c5_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0297-c5-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0297-c5-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0297-c5-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0297-c5-reconvergence.mjs" > "${log_path}" 2>&1
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
